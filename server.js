/**
 * vibewars - multiplayer vibe coding battle
 * Single-process, in-memory demo server. State is lost on restart, by design.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const archive = require('./supabase');

const PORT = process.env.PORT || 4300;

const MIN_PARTICIPANTS = 4;
const MAX_PARTICIPANTS = 6;
// How long a disconnected participant keeps their slot, so a page reload resumes
// instead of dropping them (and freeing their name) mid-lobby.
const DISCONNECT_GRACE_MS = 20000;

/* Hard caps on anything that arrives over the socket. The browser enforces its
 * own friendlier limits, but anything can open a WebSocket, so these are the
 * ones that actually hold. Names and tools are echoed to every player on every
 * broadcast, so an uncapped one is a bandwidth amplifier as well as a memory
 * leak. */
const MAX_NAME = 24;
const MAX_TOOL = 64;
const MAX_LOBBY_NAME = 48;
const MAX_CODE = 128 * 1024; // a self-contained HTML page, generously
const MAX_LOBBIES = 200; // total live lobbies, server-wide
// Per-connection message budget. Drafts autosave roughly every 400ms, so a
// real client sits far under this; a flooder trips it immediately.
const RATE_WINDOW_MS = 10000;
const RATE_MAX_MESSAGES = 300;

/* House keys: a shared, server-held key per provider so the sandbox works
 * with no setup, funded by whoever runs this instance rather than by each
 * player. This is real money on someone else's card, so every knob here
 * exists to keep a single greedy tab (or a bug) from draining it:
 *   - scoped to one round per participant, not the whole session
 *   - capped in size, so nobody pays for one enormous prompt
 *   - capped server-wide, so many lobbies at once cannot add up unbounded
 * A provider only goes live if BOTH its key and its model are set - there is
 * deliberately no hardcoded model id here. The model landscape moves too
 * fast to guess correctly, and a wrong guess fails on every single request
 * rather than once at review time. */
const HOUSE_CALLS_PER_ROUND = 6;
const HOUSE_MAX_PROMPT_CHARS = 4000; // one user message
const HOUSE_MAX_PAYLOAD_CHARS = 24000; // the whole running conversation sent up
const HOUSE_WINDOW_MS = 60000;
const HOUSE_MAX_CALLS_PER_WINDOW = 60; // across every lobby combined

const HOUSE_PROVIDERS = {
  openai: {
    key: process.env.HOUSE_OPENAI_API_KEY,
    model: process.env.HOUSE_OPENAI_MODEL,
    url: () => 'https://api.openai.com/v1/chat/completions',
    headers: (key) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }),
    body: (model, messages) => ({ model, messages, max_tokens: 4096 }),
    text: (j) => j.choices?.[0]?.message?.content || '',
    usage: (j) => ({ in: j.usage?.prompt_tokens || 0, out: j.usage?.completion_tokens || 0 }),
  },
  anthropic: {
    key: process.env.HOUSE_ANTHROPIC_API_KEY,
    model: process.env.HOUSE_ANTHROPIC_MODEL,
    url: () => 'https://api.anthropic.com/v1/messages',
    headers: (key) => ({
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }),
    body: (model, messages) => ({
      model,
      max_tokens: 4096,
      system: messages.find((m) => m.role === 'system')?.content,
      messages: messages.filter((m) => m.role !== 'system'),
    }),
    text: (j) => (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(''),
    usage: (j) => ({ in: j.usage?.input_tokens || 0, out: j.usage?.output_tokens || 0 }),
  },
  google: {
    key: process.env.HOUSE_GOOGLE_API_KEY,
    model: process.env.HOUSE_GOOGLE_MODEL,
    url: (key, model) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (model, messages) => {
      const sys = messages.find((m) => m.role === 'system');
      return {
        systemInstruction: sys ? { parts: [{ text: sys.content }] } : undefined,
        contents: messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      };
    },
    text: (j) => (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join(''),
    usage: (j) => ({
      in: j.usageMetadata?.promptTokenCount || 0,
      out: j.usageMetadata?.candidatesTokenCount || 0,
    }),
  },
  xai: {
    key: process.env.HOUSE_XAI_API_KEY,
    model: process.env.HOUSE_XAI_MODEL,
    url: () => 'https://api.x.ai/v1/chat/completions',
    headers: (key) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }),
    body: (model, messages) => ({ model, messages, max_tokens: 4096 }),
    text: (j) => j.choices?.[0]?.message?.content || '',
    usage: (j) => ({ in: j.usage?.prompt_tokens || 0, out: j.usage?.completion_tokens || 0 }),
  },
};

/** A provider is house-enabled only when both its key and model are set. */
function houseEnabled(providerId) {
  const p = HOUSE_PROVIDERS[providerId];
  return !!(p && p.key && p.model);
}

for (const id of Object.keys(HOUSE_PROVIDERS)) {
  if (HOUSE_PROVIDERS[id].key && !HOUSE_PROVIDERS[id].model) {
    console.warn(
      `HOUSE_${id.toUpperCase()}_API_KEY is set but HOUSE_${id.toUpperCase()}_MODEL is not - ` +
        `that provider stays off. Set both to enable it.`
    );
  }
}

// Global sliding window across every house-key call, regardless of lobby.
let houseWindowStart = Date.now();
let houseWindowCalls = 0;
function houseGlobalBudgetOk() {
  const now = Date.now();
  if (now - houseWindowStart > HOUSE_WINDOW_MS) {
    houseWindowStart = now;
    houseWindowCalls = 0;
  }
  return houseWindowCalls < HOUSE_MAX_CALLS_PER_WINDOW;
}

const CRITERIA = ['requirements', 'functionality', 'aesthetic', 'approach'];
const CRITERIA_LABELS = {
  requirements: 'Requirements Met',
  functionality: 'Functionality',
  aesthetic: 'Aesthetic',
  approach: 'Approach/Problem-Solving',
};

// ------------------------------------------------------ prompt generator ----

// Challenges are rolled by the server, not written by the host. The host
// only picks a topic; the exact brief is always a surprise. Each entry
// already carries its own (optional) constraint, so there is no separate
// difficulty axis to mix in.
const TOPICS = {
  EASY: [
    { productName: "PlantMind", challenge: "Fake Startup", task: "Build a landing page for an AI that can understand what houseplants are thinking.", constraints: ["Include a hero section, features, pricing, and a call-to-action."] },
    { productName: "BananaMatch", challenge: "Ridiculous Dating App", task: "Build a dating app where bananas can find their perfect match.", constraints: ["Include profiles, matching, likes, and at least one match."] },
    { productName: "VillainHire", challenge: "Supervillain Portfolio", task: "Build a professional portfolio website for a supervillain looking for work.", constraints: ["Include their skills, previous crimes, achievements, and contact section."] },
    { productName: "PremiumAir", challenge: "Useless Product", task: "Build an ecommerce page selling premium air in different flavors.", constraints: ["Include product variants, pricing, benefits, and checkout."] },
    { productName: "Procrastinati", challenge: "Fake University", task: "Build the website for the world's leading university for procrastination.", constraints: ["Include courses, professors, campus life, and an application page."] },
    { productName: "SockSwap", challenge: "Niche Marketplace", task: "Build a marketplace where people can trade their unmatched socks.", constraints: ["Include listings, search, categories, and a listing detail page."] },
    { productName: "PawCEO", challenge: "Pet Business", task: "Build a corporate website for a dog that runs a billion-dollar company.", constraints: ["Include about, services, leadership, investors, and press sections."] },
    { productName: "MoonTrip", challenge: "Travel Website", task: "Build a travel booking website for the first commercial trips to the moon.", constraints: ["Include destinations, packages, pricing, and booking."] },
    { productName: "SnackStack", challenge: "Food App", task: "Build an app that helps people decide what snack to eat.", constraints: ["Include categories, random selection, and a personalized recommendation."] },
    { productName: "VillainJobs", challenge: "Job Board", task: "Build a job board for completely ridiculous professions.", constraints: ["Include job cards, search, filters, and an application flow."] },
    { productName: "FakeFlix", challenge: "Streaming Platform", task: "Build a streaming platform containing movies that don't exist.", constraints: ["Include categories, movie cards, search, and a movie detail page."] },
    { productName: "SleepBank", challenge: "Finance App", task: "Build a banking app where users can deposit, withdraw, and spend hours of sleep.", constraints: ["Include balance, transactions, transfers, and a dashboard."] },
    { productName: "AlienAir", challenge: "Airline Website", task: "Build an airline website for an alien civilization.", constraints: ["Include destinations, flights, booking, and strange travel rules."] },
    { productName: "Ghostbnb", challenge: "Hotel Platform", task: "Build a hotel booking platform for haunted houses.", constraints: ["Include listings, ratings, prices, amenities, and booking."] },
    { productName: "PetFlix", challenge: "Entertainment Platform", task: "Build a streaming platform designed specifically for pets.", constraints: ["Include animal profiles, personalized recommendations, and categories."] },
    { productName: "Coffeebucks", challenge: "Coffee Brand", task: "Build a coffee shop website for people who absolutely hate mornings.", constraints: ["Include menu, ordering, locations, and a loyalty program."] },
    { productName: "VillainMart", challenge: "Online Store", task: "Build an ecommerce store selling gadgets for aspiring supervillains.", constraints: ["Include product listings, product details, cart, and checkout."] },
    { productName: "TimeTour", challenge: "Travel Planner", task: "Build a travel booking website for time travelers.", constraints: ["Users must be able to choose a destination year and book a trip."] },
    { productName: "MoodMeals", challenge: "Recipe App", task: "Build a recipe app that recommends food based entirely on your mood.", constraints: ["Include moods, recipes, filters, and a recommendation system."] },
    { productName: "SleepFit", challenge: "Fitness App", task: "Build a fitness app for people whose primary exercise is sleeping.", constraints: ["Include workouts, progress tracking, goals, and achievements."] },
    { productName: "DoomDaily", challenge: "News Website", task: "Build a news website reporting breaking news from a world where everything is slightly wrong.", constraints: ["Include headlines, categories, articles, and trending stories."] },
    { productName: "AlienAcademy", challenge: "Education Platform", task: "Build an online learning platform teaching humans how to communicate with aliens.", constraints: ["Include courses, lessons, progress, and certificates."] },
    { productName: "MysteryBox", challenge: "Subscription Service", task: "Build a subscription service that sends users one completely random object every month.", constraints: ["Include subscription tiers, previous boxes, and checkout."] },
    { productName: "PigeonPost", challenge: "Communication App", task: "Build a modern messaging app where messages are delivered by pigeons.", constraints: ["Include conversations, contacts, message sending, and delivery status."] },
    { productName: "DreamAir", challenge: "Luxury Brand", task: "Build a luxury brand selling bottled dreams.", constraints: ["Include products, story, pricing, and a premium checkout."] },
    { productName: "RentAFriend", challenge: "Marketplace", task: "Build a marketplace where people can temporarily rent a friend for different activities.", constraints: ["Include profiles, categories, availability, and booking."] },
    { productName: "CloudCafe", challenge: "Restaurant Website", task: "Build a restaurant website for a cafe located above the clouds.", constraints: ["Include menu, reservations, location, and atmosphere."] },
    { productName: "PlanetPost", challenge: "Social Network", task: "Build a social network where planets have their own profiles and interact with each other.", constraints: ["Include profiles, posts, likes, comments, and trending topics."] },
    { productName: "FutureFind", challenge: "Marketplace", task: "Build an ecommerce marketplace selling products from the year 2100.", constraints: ["Include categories, product pages, cart, and checkout."] },
    { productName: "OddlySpecific", challenge: "Community Platform", task: "Build an online community for people with an extremely specific shared interest.", constraints: ["Include profiles, posts, comments, and discovery."] },
  ],
  CONSTRAINTS: [
    { productName: "ChaosMix", challenge: "Three Words", task: "Build a website inspired by three random words.", constraints: ["All three words must visibly influence the final website."] },
    { productName: "EmojiWorld", challenge: "One Emoji", task: "Turn a single emoji into a complete web experience.", constraints: ["The emoji is the only starting inspiration."] },
    { productName: "Mono", challenge: "One Color", task: "Build a complete website using only one color and its shades.", constraints: ["No additional accent colors."] },
    { productName: "NoPic", challenge: "No Images", task: "Build a visually impressive website without using any images.", constraints: ["Use only typography, CSS, shapes, gradients, and interaction."] },
    { productName: "Silent", challenge: "No Text", task: "Build a website that communicates its purpose without written words.", constraints: ["Users must understand what to do through visuals and interaction."] },
    { productName: "One", challenge: "One Button", task: "Build an entire web experience around a single button.", constraints: ["The button must have meaningful behavior."] },
    { productName: "Viewport", challenge: "One Screen", task: "Build an entire product experience inside a single screen.", constraints: ["No scrolling."] },
    { productName: "Web2003", challenge: "Retro Web", task: "Build a website that feels like it was made in 2003.", constraints: ["Use authentic early-web visual conventions."] },
    { productName: "Web2050", challenge: "Future Web", task: "Build a website that looks like it came from 2050.", constraints: ["Make it feel like a believable evolution of the web."] },
    { productName: "Brutal", challenge: "Web Brutalism", task: "Build a brutalist website for a completely normal product.", constraints: ["Avoid polished SaaS aesthetics."] },
    { productName: "LuxuryOS", challenge: "Luxury", task: "Make an ordinary product look like an ultra-premium luxury brand.", constraints: ["The product itself must remain ordinary."] },
    { productName: "UglyWeb", challenge: "Ugliest Website", task: "Build the ugliest website possible while keeping it functional.", constraints: ["Intentionally break modern design conventions."] },
    { productName: "Minimal", challenge: "Extreme Minimalism", task: "Build a useful website using as little visual material as possible.", constraints: ["Maximum three colors, two fonts, and five major visible elements."] },
    { productName: "Type", challenge: "Typography Only", task: "Build a website where typography is the primary visual experience.", constraints: ["Images should play almost no role."] },
    { productName: "Motion", challenge: "Animation", task: "Build a website where animation is the main attraction.", constraints: ["Every major animation must respond to user interaction."] },
    { productName: "SoundWeb", challenge: "Sound", task: "Build a web experience where sound plays an important role.", constraints: ["The website must still work without sound."] },
    { productName: "Physical", challenge: "Physical Object", task: "Turn an ordinary physical object into an interactive website.", constraints: ["The object should remain recognizable."] },
    { productName: "RealUI", challenge: "Real-World Interface", task: "Recreate a familiar physical interface as a website.", constraints: ["Examples include an airport board, vending machine, arcade cabinet, or restaurant menu."] },
    { productName: "WikiWarp", challenge: "Wikipedia", task: "Transform a random Wikipedia article into an entirely different web experience.", constraints: ["The original subject must still be recognizable."] },
    { productName: "PixelPerfect", challenge: "Screenshot Recreation", task: "Recreate a provided website screenshot as accurately as possible.", constraints: ["Do not inspect the original website or source code."] },
    { productName: "MemoryWeb", challenge: "Memory Recreation", task: "Recreate a familiar website entirely from memory.", constraints: ["The original website cannot be viewed during the challenge."] },
    { productName: "Opposite", challenge: "Opposite Audience", task: "Take a familiar product and redesign it for its complete opposite audience.", constraints: ["The original product should still be recognizable."] },
    { productName: "PirateNet", challenge: "Genre Swap", task: "Redesign a familiar modern website as if it belonged to pirates.", constraints: ["The original product's core purpose must remain intact."] },
    { productName: "RandomUser", challenge: "Random Audience", task: "Build a website specifically for an extremely unusual audience.", constraints: ["The audience must influence the product, language, and interface."] },
    { productName: "NoScroll", challenge: "Fixed Canvas", task: "Build a complete interactive experience without scrolling.", constraints: ["Everything must happen inside one fixed canvas."] },
    { productName: "TinyUI", challenge: "Five Components", task: "Build a useful product using only five major UI components.", constraints: ["You must choose exactly five."] },
    { productName: "MobileFirst", challenge: "Mobile Only", task: "Build a website designed specifically for a phone.", constraints: ["Desktop layouts should not be the focus."] },
    { productName: "Desktop", challenge: "Desktop Only", task: "Build an experience that takes advantage of a large desktop screen.", constraints: ["The design should intentionally use horizontal space."] },
    { productName: "GenreShift", challenge: "Genre Transformation", task: "Take a normal product and completely change its visual genre.", constraints: ["The core functionality must remain recognizable."] },
    { productName: "ImpossibleUI", challenge: "Impossible Interface", task: "Build a web interface that could never exist as a normal physical interface.", constraints: ["Take advantage of the fact that this is software."] },
  ],
  CHAOS: [
    { productName: "Pointless", challenge: "Useless Website", task: "Build a website that has absolutely no useful purpose but is impossible not to interact with.", constraints: [] },
    { productName: "RoastMe", challenge: "Insult Generator", task: "Build a website that progressively roasts the user as they interact with it.", constraints: ["Keep the humor playful and fictional."] },
    { productName: "MoonCoin", challenge: "Fake Scam", task: "Build a completely fictional investment website promising an absurd opportunity.", constraints: ["Make it look suspiciously convincing while clearly being fictional."] },
    { productName: "PigeonTruth", challenge: "Conspiracy Board", task: "Build an interactive conspiracy theory website proving that pigeons are secretly running society.", constraints: ["Include connected evidence, documents, and theories."] },
    { productName: "WorstUX", challenge: "Bad UX", task: "Build the worst user experience imaginable.", constraints: ["The website must technically remain usable."] },
    { productName: "WhyMe", challenge: "Gaslighting UI", task: "Build an interface that constantly makes the user question what just happened.", constraints: ["Keep it playful rather than genuinely frustrating."] },
    { productName: "AngryApp", challenge: "Angry Website", task: "Build a website that becomes increasingly angry the more the user interacts with it.", constraints: [] },
    { productName: "Passive", challenge: "Passive Aggression", task: "Build a website that communicates entirely through passive-aggressive messages.", constraints: [] },
    { productName: "WrongWeb", challenge: "Everything Is Wrong", task: "Build a completely normal website where every tiny detail is slightly incorrect.", constraints: ["The mistakes should be intentional and discoverable."] },
    { productName: "PotatoAuth", challenge: "Pointless Login", task: "Build a website requiring an absurd authentication process to access something completely useless.", constraints: ["The final reward should be hilariously pointless."] },
    { productName: "Infinite", challenge: "Infinite Button", task: "Build a button that becomes increasingly ridiculous every time it is clicked.", constraints: [] },
    { productName: "DoomClock", challenge: "Doomsday App", task: "Build a dashboard showing the fictional end of the world.", constraints: ["Include a countdown, alerts, and live-looking metrics."] },
    { productName: "AlienOS", challenge: "Alien Website", task: "Build a website designed by aliens who fundamentally misunderstand humans.", constraints: [] },
    { productName: "WrongYear", challenge: "Time Traveler", task: "Build a website belonging to someone who accidentally traveled to the wrong year.", constraints: ["The website should reveal clues about where and when they are."] },
    { productName: "Alive", challenge: "Sentient Website", task: "Build a website that genuinely believes it is alive.", constraints: [] },
    { productName: "Me.com", challenge: "Website About Itself", task: "Build a website whose entire subject is the website itself.", constraints: ["The website should have a personality."] },
    { productName: "SockCorp", challenge: "Corporate Nonsense", task: "Build an extremely serious corporate website for a company solving the problem of lost socks.", constraints: [] },
    { productName: "SandwichOS", challenge: "Overengineering", task: "Build an absurdly complicated interface for choosing what sandwich to eat.", constraints: ["Include unnecessary settings, analytics, and decision-making steps."] },
    { productName: "DefinitelyNotWatching", challenge: "Paranoia", task: "Build a fictional website that behaves as if it knows suspiciously much about the user.", constraints: ["Use only randomly generated or fictional information."] },
    { productName: "NPCWeb", challenge: "NPC Website", task: "Build a website that behaves like an NPC from a video game.", constraints: [] },
    { productName: "RepublicOfNothing", challenge: "Fake Government", task: "Build the official government website of an absurd fictional country.", constraints: ["Include government departments, laws, services, and national information."] },
    { productName: "CrisisOS", challenge: "Crisis Simulator", task: "Build a dashboard where an increasingly ridiculous fictional crisis unfolds in real time.", constraints: [] },
    { productName: "OneStar", challenge: "Terrible Product", task: "Build a product page for something that has terrible reviews but somehow keeps selling.", constraints: ["Include reviews and customer complaints."] },
    { productName: "Honestly", challenge: "Overly Honest", task: "Build a brutally honest landing page for a product that nobody really needs.", constraints: [] },
    { productName: "PremiumEverything", challenge: "Everything Is Premium", task: "Build a website where every tiny feature is locked behind an absurd premium tier.", constraints: [] },
    { productName: "CheckoutHell", challenge: "Confusing Checkout", task: "Build an unnecessarily complicated ecommerce checkout experience.", constraints: ["The user must eventually be able to complete the purchase."] },
    { productName: "BadGPT", challenge: "Bad AI", task: "Build an AI assistant that is hilariously terrible at its job.", constraints: ["It must respond interactively to user input."] },
    { productName: "BreakingBanana", challenge: "Fake Breaking News", task: "Build a breaking-news website covering an absurd fictional event.", constraints: ["Make it feel like a real news site."] },
    { productName: "ExistCalc", challenge: "Existential Calculator", task: "Build a calculator that answers ridiculous questions about the user's life.", constraints: ["Example: How many Mondays have you wasted?"] },
    { productName: "DoNotClick", challenge: "Do Not Click", task: "Build a website centered around a giant button labeled DO NOT CLICK.", constraints: ["Clicking it must trigger an escalating sequence of events."] },
  ],
  GAMES: [
    { productName: "OneTap", challenge: "One Button Game", task: "Build a complete game that can only be controlled with one button.", constraints: [] },
    { productName: "TenSeconds", challenge: "10 Second Game", task: "Build a game that lasts exactly ten seconds.", constraints: [] },
    { productName: "Reflex", challenge: "Reaction Test", task: "Build a reaction-time game where players compete for the fastest score.", constraints: [] },
    { productName: "CookieEmpire", challenge: "Clicker", task: "Build an addictive incremental clicker game.", constraints: ["Include at least three upgrades."] },
    { productName: "FlapRush", challenge: "Flying Game", task: "Build a simple one-button flying game where the player avoids obstacles.", constraints: [] },
    { productName: "Dodge", challenge: "Survival Game", task: "Build a game where the player survives increasingly difficult obstacles.", constraints: [] },
    { productName: "MemoryRush", challenge: "Memory Game", task: "Build a fast-paced memory game that tests how much the player can remember.", constraints: [] },
    { productName: "TypeRace", challenge: "Typing Game", task: "Build a competitive typing game where players race against the clock.", constraints: [] },
    { productName: "AimRush", challenge: "Aim Trainer", task: "Build a browser-based aiming and reaction challenge.", constraints: [] },
    { productName: "Higher", challenge: "Higher or Lower", task: "Build a game where players predict whether the next number will be higher or lower.", constraints: [] },
    { productName: "WordTrap", challenge: "Word Game", task: "Build a fast word guessing game with one original mechanic.", constraints: [] },
    { productName: "MiniGolf", challenge: "Mini Golf", task: "Build a single-hole mini-golf game playable entirely in the browser.", constraints: [] },
    { productName: "Penalty", challenge: "Penalty Shootout", task: "Build a penalty shootout game where players compete against a goalkeeper.", constraints: [] },
    { productName: "RPSPlus", challenge: "Rock Paper Scissors", task: "Build a Rock Paper Scissors game with one completely original twist.", constraints: [] },
    { productName: "CoinChaos", challenge: "Coin Flip", task: "Turn a simple coin flip into a strategic game.", constraints: [] },
    { productName: "CursorHunter", challenge: "Avoid The Cursor", task: "Build a game where the player must prevent an enemy from catching their cursor.", constraints: [] },
    { productName: "ImpossibleClick", challenge: "Impossible Button", task: "Build a game where the player has to successfully click an increasingly difficult target.", constraints: [] },
    { productName: "Balance", challenge: "Balance Game", task: "Build a game where the player must keep an object balanced for as long as possible.", constraints: [] },
    { productName: "PerfectMoment", challenge: "Timing Game", task: "Build a game where players must stop an animation at exactly the right moment.", constraints: [] },
    { productName: "Pattern", challenge: "Pattern Game", task: "Build a game where players identify increasingly complicated patterns.", constraints: [] },
    { productName: "TinyEscape", challenge: "Escape Room", task: "Build a tiny escape room that can be solved in under two minutes.", constraints: [] },
    { productName: "WeirdTrivia", challenge: "Trivia Game", task: "Build a rapid-fire trivia game focused on strange and unexpected questions.", constraints: [] },
    { productName: "RiskIt", challenge: "Risk Game", task: "Build a game where players repeatedly choose between a safe reward and a risky reward.", constraints: [] },
    { productName: "DoubleOrNothing", challenge: "Luck Game", task: "Build a game where players decide how much to risk before revealing the outcome.", constraints: [] },
    { productName: "Grow", challenge: "Growing Game", task: "Build a game where an object grows every time the player succeeds.", constraints: [] },
    { productName: "BossRush", challenge: "Boss Fight", task: "Build a tiny boss fight that can be completed in under two minutes.", constraints: [] },
    { productName: "MazeMouse", challenge: "Cursor Maze", task: "Build a maze that must be completed using only the mouse.", constraints: [] },
    { productName: "Speedrun", challenge: "Speedrun", task: "Build a tiny game where the goal is to achieve the fastest possible completion time.", constraints: [] },
    { productName: "BotBattle", challenge: "AI Opponent", task: "Build a simple browser game where the player competes against a computer opponent.", constraints: [] },
    { productName: "RuleBreak", challenge: "Chaos Game", task: "Build a game where the rules randomly change while the player is playing.", constraints: [] },
  ],
};

const DEFAULT_MINUTES = 8;

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Roll a challenge. `topic` may be 'RANDOM'. Returns the structured brief plus a
 * flattened text version for anything that just wants a string.
 */
function generatePrompt(topic) {
  const topicNames = Object.keys(TOPICS);
  const chosenTopic = TOPICS[topic] ? topic : pickRandom(topicNames);
  const entry = pickRandom(TOPICS[chosenTopic]);
  return briefFrom(chosenTopic, entry);
}

/** The shared shape every brief takes, however it was chosen. */
function briefFrom(topic, entry, special = null) {
  const text =
    `${entry.productName} — ${entry.challenge}\n\n` +
    `TASK\n${entry.task}` +
    (entry.constraints.length
      ? `\n\nCONSTRAINTS\n${entry.constraints.map((c) => `- ${c}`).join('\n')}`
      : '');

  return {
    topic,
    productName: entry.productName,
    challenge: entry.challenge,
    task: entry.task,
    constraints: entry.constraints,
    text,
    suggestedMinutes: DEFAULT_MINUTES,
    // 'daily' | 'weekly' when this came from a rotating challenge, so clients
    // can badge it and count it toward a streak. Null for an ordinary roll.
    special,
  };
}

/* ------------------------------------------------- rotating challenges ----
 * Everyone playing on a given day gets the same daily brief, and the same
 * weekly one all week, with nothing persisted: the date string IS the seed.
 * That means no cron, no storage, no drift between server restarts, and any
 * two players can compare runs on "today's" challenge and know they had the
 * same task. UTC throughout, so the rotation is one global moment rather
 * than 24 staggered ones. */

/** FNV-1a: tiny, deterministic, and good enough to shuffle a date into an index. */
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** YYYY-MM-DD in UTC. */
function utcDayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/** ISO-ish week key: YYYY-Www, rolling over on Monday UTC. */
function utcWeekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Thursday of this week decides the year, which is what makes week numbers
  // stable across a year boundary.
  const day = (t.getUTCDay() + 6) % 7; // Monday = 0
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const fDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fDay + 3);
  const week = 1 + Math.round((t - firstThursday) / (7 * 24 * 3600 * 1000));
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** When the current daily/weekly window ends, so clients can count down. */
function challengeExpiry(kind, now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  if (kind === 'daily') return end.getTime();
  // Weekly runs to the next Monday 00:00 UTC.
  const day = (now.getUTCDay() + 6) % 7; // Monday = 0
  end.setUTCDate(end.getUTCDate() + (6 - day));
  return end.getTime();
}

/**
 * The brief for the current daily or weekly window. Pure function of the
 * date: same input, same brief, on every process and every request.
 */
function rotatingChallenge(kind, now = new Date()) {
  const key = kind === 'weekly' ? utcWeekKey(now) : utcDayKey(now);
  // Salted per kind so the daily and the weekly never land on the same entry.
  const seed = hashSeed(kind + ':' + key);
  const topicNames = Object.keys(TOPICS);
  const topic = topicNames[seed % topicNames.length];
  const pool = TOPICS[topic];
  // A second, differently-derived index so topic and entry do not move in
  // lockstep as the seed increments day to day.
  const entry = pool[Math.floor(seed / topicNames.length) % pool.length];
  return { ...briefFrom(topic, entry, kind), periodKey: key, expiresAt: challengeExpiry(kind, now) };
}

// ---------------------------------------------------------------- state ----

/** @type {Map<string, Lobby>} */
const lobbies = new Map();

function newId(len = 6) {
  // Unbiased pick from a 32-character alphabet: 32 divides 256, so masking the
  // low 5 bits of a random byte is uniform with no rejection needed.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] & 31];
  return out;
}

/* The resume credential. Whoever holds this takes over that seat - their draft,
 * their submission, their vote - so it must not come from Math.random(), whose
 * internal state is recoverable from a handful of observed outputs. */
function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/** Length-safe, constant-time token comparison. */
function tokenMatches(stored, supplied) {
  if (typeof stored !== 'string' || typeof supplied !== 'string') return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(supplied);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function createLobby(name, mode = 'versus') {
  let id = newId();
  while (lobbies.has(id)) id = newId();
  const firstPrompt = generatePrompt('RANDOM');
  const solo = mode === 'solo';
  const lobby = {
    id,
    mode, // 'versus' (a real battle) | 'solo' (private practice, no scoring)
    name: name || (solo ? 'Practice run' : `Lobby ${id}`),
    hostId: null,
    topic: 'RANDOM', // host's filter, not necessarily the rolled prompt's topic
    prompt: firstPrompt,
    challenge: firstPrompt.text,
    durationMinutes: firstPrompt.suggestedMinutes,
    minutesOverridden: false,
    // lobby | active | reveal | results, plus 'practice' as the solo terminus
    phase: 'lobby',
    round: 0, // bumped every start; lets clients invalidate cached reveal tiles
    startedAt: null,
    endsAt: null,
    timer: null,
    participants: new Map(), // pid -> participant
    votes: new Map(), // voterId -> Map<targetId, scores>
    botTimers: [],
    // Watchers. Held as raw sockets rather than participants: they take no
    // seat, cast no ballot and count for nothing in scoring. Solo runs are
    // private, so they never accept any.
    spectators: new Set(),
    spectatorTimer: null,
  };
  lobbies.set(id, lobby);
  return lobby;
}

/** Practice runs are private: never listed, never watchable, never archived. */
function isSolo(lobby) {
  return lobby.mode === 'solo';
}

/** Anonymous ids come from the browser, so treat them as untrusted text. */
function cleanPlayerId(v) {
  const s = String(v || '').trim();
  return /^[A-Za-z0-9-]{8,64}$/.test(s) ? s : null;
}

/** A short display string: no control characters, trimmed, hard length cap.
 *  Control characters are stripped because these end up in the roster, the
 *  tiles and the leaderboard, where a stray newline or a bidi override just
 *  makes a mess of everyone else's screen. */
function cleanText(v, max) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .trim()
    .slice(0, max);
}

/** Submitted markup. Newlines and tabs are content here, so only the size is
 *  capped - the value is never parsed server-side, only stored and echoed into
 *  a sandboxed iframe. */
function cleanCode(v) {
  return String(v == null ? '' : v).slice(0, MAX_CODE);
}

function makeParticipant(name, tool, isBot = false, playerId = null, verified = false) {
  return {
    id: newId(8),
    isBot,
    playerId, // anonymous, client-generated, stable across visits
    // Whether the declared model was confirmed against the player's own API key.
    // Self-reported, so it is a claim the client makes, not proof.
    verified: !!verified,
    token: newToken(),
    name,
    tool,
    connected: true,
    draft: '', // live autosaved textarea content
    code: null, // final locked submission (null until submitted/locked)
    houseCalls: 0, // sandbox prompts spent against the shared house key this round
    submitted: false,
    dnf: false,
    autoSubmitted: false,
    submittedAt: null,
    remainingMsAtSubmit: 0,
    ws: null,
    departTimer: null,
  };
}

/** Drop a participant only if they fail to reconnect within the grace window. */
function scheduleDeparture(lobby, p) {
  clearTimeout(p.departTimer);
  p.departTimer = setTimeout(() => {
    if (p.connected) return; // came back
    if (lobby.phase !== 'lobby') return; // round underway: keep their slot and their code
    lobby.participants.delete(p.id);
    if (lobby.hostId === p.id) {
      const next = lobby.participants.values().next().value;
      lobby.hostId = next ? next.id : null;
    }
    if (lobby.participants.size === 0) {
      clearInterval(lobby.timer);
      closeLobby(lobby);
      return;
    }
    broadcast(lobby);
  }, DISCONNECT_GRACE_MS);
}

// ------------------------------------------------------------- scoring ----

function emptyScoreRow() {
  const row = {};
  for (const c of CRITERIA) row[c] = 0;
  return row;
}

/**
 * Average each criterion over all voters who rated the participant,
 * then sum the four averages into the total.
 */
function computeScores(lobby) {
  const rows = [];
  for (const p of lobby.participants.values()) {
    const sums = emptyScoreRow();
    let voterCount = 0;
    for (const [voterId, byTarget] of lobby.votes) {
      if (voterId === p.id) continue;
      const scores = byTarget.get(p.id);
      if (!scores) continue;
      voterCount++;
      for (const c of CRITERIA) sums[c] += scores[c];
    }
    const averages = emptyScoreRow();
    if (voterCount > 0) {
      for (const c of CRITERIA) averages[c] = sums[c] / voterCount;
    }
    const total = CRITERIA.reduce((acc, c) => acc + averages[c], 0);
    rows.push({
      participantId: p.id,
      name: p.name,
      tool: p.tool,
      dnf: p.dnf,
      voterCount,
      averages,
      total,
      remainingMsAtSubmit: p.remainingMsAtSubmit,
    });
  }

  rows.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total; // 1. total score
    if (b.averages.requirements !== a.averages.requirements) {
      return b.averages.requirements - a.averages.requirements; // 2. requirements met
    }
    return b.remainingMsAtSubmit - a.remainingMsAtSubmit; // 3. submitted earlier
  });

  return rows;
}

// -------------------------------------------------------- state -> wire ----

function participantPublic(lobby, p, viewerId) {
  // 'practice' is a solo lobby's terminus: there is exactly one participant and
  // it is the viewer, so handing back their own code reveals nothing.
  const revealing =
    lobby.phase === 'reveal' || lobby.phase === 'results' || lobby.phase === 'practice';
  const base = {
    id: p.id,
    name: p.name,
    tool: p.tool,
    isBot: !!p.isBot,
    verified: !!p.verified,
    connected: p.connected,
    isHost: lobby.hostId === p.id,
    isYou: p.id === viewerId,
    submitted: p.submitted,
    dnf: p.dnf,
    autoSubmitted: p.autoSubmitted,
    remainingMsAtSubmit: p.remainingMsAtSubmit,
  };
  if (revealing) base.code = p.code || '';
  return base;
}

function votesCast(lobby, voterId) {
  const byTarget = lobby.votes.get(voterId);
  if (!byTarget) return {};
  const out = {};
  for (const [targetId, scores] of byTarget) out[targetId] = scores;
  return out;
}

function votingProgress(lobby) {
  const ids = [...lobby.participants.keys()];
  let expected = 0;
  let cast = 0;
  for (const voterId of ids) {
    for (const targetId of ids) {
      if (voterId === targetId) continue;
      expected++;
      if (lobby.votes.get(voterId)?.has(targetId)) cast++;
    }
  }
  return { expected, cast };
}

/* A watcher's view. Same shape as a player's so the client can reuse its
 * renderers, with two differences: `spectating` is set, and during the build
 * phase every player's live draft is included. That draft is exactly what a
 * rival must never see, so it is only ever attached here, never in the
 * participant snapshot. */
function spectatorSnapshot(lobby) {
  const snap = snapshotFor(lobby, null);
  snap.spectating = true;
  if (lobby.phase === 'active') {
    const drafts = {};
    for (const p of lobby.participants.values()) {
      drafts[p.id] = p.submitted ? p.code || '' : p.draft || '';
    }
    snap.drafts = drafts;
  }
  return snap;
}

function snapshotFor(lobby, viewerId) {
  return {
    type: 'state',
    serverNow: Date.now(),
    spectators: lobby.spectators.size,
    lobby: {
      id: lobby.id,
      mode: lobby.mode,
      name: lobby.name,
      phase: lobby.phase,
      round: lobby.round,
      challenge: lobby.challenge,
      durationMinutes: lobby.durationMinutes,
      startedAt: lobby.startedAt,
      endsAt: lobby.endsAt,
      hostId: lobby.hostId,
      prompt: lobby.prompt,
      topic: lobby.topic,
      topics: Object.keys(TOPICS),
      minParticipants: MIN_PARTICIPANTS,
      maxParticipants: MAX_PARTICIPANTS,
      criteria: CRITERIA,
      criteriaLabels: CRITERIA_LABELS,
    },
    you: viewerId,
    participants: [...lobby.participants.values()].map((p) => participantPublic(lobby, p, viewerId)),
    myVotes: votesCast(lobby, viewerId),
    voting: votingProgress(lobby),
    leaderboard: lobby.phase === 'results' ? computeScores(lobby) : null,
  };
}

function send(ws, payload) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function broadcast(lobby) {
  for (const p of lobby.participants.values()) {
    if (p.ws) send(p.ws, snapshotFor(lobby, p.id));
  }
  broadcastSpectators(lobby);
}

function broadcastSpectators(lobby) {
  if (!lobby.spectators.size) return;
  const snap = spectatorSnapshot(lobby);
  for (const ws of lobby.spectators) send(ws, snap);
}

/* Drafts change on every keystroke, which is far too often to broadcast. While
 * anyone is watching a live build, push the current state on a fixed tick
 * instead: fast enough to feel live, slow enough to stay cheap. */
const SPECTATOR_TICK_MS = 1500;

function startSpectatorFeed(lobby) {
  if (lobby.spectatorTimer) return;
  lobby.spectatorTimer = setInterval(() => {
    if (!lobby.spectators.size || lobby.phase !== 'active') return stopSpectatorFeed(lobby);
    broadcastSpectators(lobby);
  }, SPECTATOR_TICK_MS);
}

function stopSpectatorFeed(lobby) {
  clearInterval(lobby.spectatorTimer);
  lobby.spectatorTimer = null;
}

/** Tear a lobby down, releasing anyone watching it back to the match list. */
function closeLobby(lobby) {
  stopSpectatorFeed(lobby);
  for (const ws of lobby.spectators) {
    ws.spectatingId = null;
    send(ws, { type: 'match_over', reason: 'That match has finished.' });
  }
  lobby.spectators.clear();
  lobbies.delete(lobby.id);
}

function dropSpectator(ws) {
  const lobby = ws.spectatingId ? lobbies.get(ws.spectatingId) : null;
  ws.spectatingId = null;
  if (!lobby) return;
  lobby.spectators.delete(ws);
  if (!lobby.spectators.size) stopSpectatorFeed(lobby);
  // Players see the watcher count, so it has to settle when someone leaves.
  for (const p of lobby.participants.values()) {
    if (p.ws) send(p.ws, snapshotFor(lobby, p.id));
  }
}

// ------------------------------------------------------------ lifecycle ----

function startRound(lobby) {
  lobby.phase = 'active';
  lobby.round += 1;
  lobby.startedAt = Date.now();
  lobby.endsAt = lobby.startedAt + lobby.durationMinutes * 60 * 1000;
  clearInterval(lobby.timer);
  lobby.timer = setInterval(() => {
    if (lobby.phase !== 'active') return clearInterval(lobby.timer);
    if (Date.now() >= lobby.endsAt) lockSubmissions(lobby);
  }, 500);
  scheduleBotSubmissions(lobby); // no-op when the lobby has no fake players
  if (lobby.spectators.size) startSpectatorFeed(lobby);
  broadcast(lobby);
}

/** Time is up: lock everyone who has not explicitly submitted. */
function lockSubmissions(lobby) {
  if (lobby.phase !== 'active') return;
  clearInterval(lobby.timer);
  lobby.timer = null;
  for (const p of lobby.participants.values()) {
    if (p.submitted) continue;
    const draft = (p.draft || '').trim();
    if (draft.length === 0) {
      // Nothing typed at all -> DNF.
      p.code = '';
      p.dnf = true;
      p.submitted = true;
      p.submittedAt = Date.now();
      p.remainingMsAtSubmit = 0;
    } else {
      // Had work in progress at the buzzer -> auto-submitted, no time bonus.
      p.code = p.draft;
      p.submitted = true;
      p.autoSubmitted = true;
      p.submittedAt = Date.now();
      p.remainingMsAtSubmit = 0;
    }
  }
  if (isSolo(lobby)) {
    // Practice has nobody to judge it, so it ends at your own result.
    lobby.phase = 'practice';
    stopSpectatorFeed(lobby);
    broadcast(lobby);
    return;
  }
  lobby.phase = 'reveal';
  stopSpectatorFeed(lobby); // watchers now follow the reveal, not the drafts
  scheduleBotVotes(lobby);
  broadcast(lobby);
}

function maybeAdvanceToReveal(lobby) {
  if (lobby.phase !== 'active') return;
  const all = [...lobby.participants.values()];
  if (all.length > 0 && all.every((p) => p.submitted)) {
    clearInterval(lobby.timer);
    lobby.timer = null;
    stopSpectatorFeed(lobby);
    // Submitting early ends a practice run the same way the buzzer does: at
    // your own result, with nothing to vote on.
    lobby.phase = isSolo(lobby) ? 'practice' : 'reveal';
    if (!isSolo(lobby)) scheduleBotVotes(lobby);
  }
}

function resetLobby(lobby) {
  clearInterval(lobby.timer);
  lobby.timer = null;
  clearBotTimers(lobby);
  lobby.phase = 'lobby';
  lobby.startedAt = null;
  lobby.endsAt = null;
  lobby.votes = new Map();
  lobby.recorded = false; // the next round is a separate row
  // A new round deserves a new brief - unless this lobby is running a daily
  // or weekly challenge, where the whole point is that everyone plays the
  // same one, so "run it back" has to mean the same brief again.
  const special = lobby.prompt && lobby.prompt.special;
  lobby.prompt = special ? rotatingChallenge(special) : generatePrompt(lobby.topic);
  lobby.challenge = lobby.prompt.text;
  if (!lobby.minutesOverridden) lobby.durationMinutes = lobby.prompt.suggestedMinutes;
  for (const p of lobby.participants.values()) {
    p.draft = '';
    p.code = null;
    p.houseCalls = 0;
    p.submitted = false;
    p.dnf = false;
    p.autoSubmitted = false;
    p.submittedAt = null;
    p.remainingMsAtSubmit = 0;
    if (p.ws) send(p.ws, { type: 'draft', code: '' });
  }
}

function maybeAdvanceToResults(lobby) {
  if (lobby.phase !== 'reveal') return;
  const { expected, cast } = votingProgress(lobby);
  if (expected > 0 && cast >= expected) finishBattle(lobby);
}

/**
 * Close voting and hand the final standings to the archive. The write is fire
 * and forget: the leaderboard must never wait on the network, and a database
 * outage must not spoil the end of a battle.
 */
function finishBattle(lobby) {
  if (lobby.phase === 'results') return;
  lobby.phase = 'results';
  // Practice is unscored and private, so it never reaches the archive or the
  // public standings.
  if (!lobby.recorded && !isSolo(lobby)) {
    lobby.recorded = true;
    const standings = computeScores(lobby);
    archive.recordBattle(lobby, standings).catch(() => {});
  }
}

// ----------------------------------------------------------- fake players ----

// Stand-in opponents the host can drop into any lobby to test the full flow.
// Each has a distinctly different submission so the voting screen is worth looking at.
const BOTS = [
  {
    name: 'Nova',
    tool: 'GPT-5.6 Sol',
    submitDelayMs: 4000,
    // Generous voter.
    bias: 1,
    code: `<h1 style="font-family:system-ui">Split the bill</h1>
<p style="font-family:system-ui">Bill <input id="b" value="120" size="5"> Tip
<select id="t"><option>10</option><option selected>18</option><option>25</option></select>%
People <input id="n" value="4" size="3">
<button onclick="go()">Go</button></p>
<h2 id="out" style="font-family:system-ui">-</h2>
<script>
function go(){
  var total = b.value * (1 + t.value/100);
  out.textContent = "Total " + total.toFixed(2) + "  |  each " + (total/n.value).toFixed(2);
}
go();
<\/script>`,
  },
  {
    name: 'Mercury',
    tool: 'Gemini 3.5 Pro',
    submitDelayMs: 7000,
    // Harsh voter.
    bias: -1,
    code: `<div style="font-family:Georgia;padding:12px">
<h2>Tip helper</h2>
<label>Amount <input id="a" type="number" value="80"></label>
<div style="margin:8px 0">
  <button onclick="set(10)">10%</button>
  <button onclick="set(15)">15%</button>
  <button onclick="set(20)">20%</button>
</div>
<p id="r">Pick a tip.</p>
<script>
function set(p){
  var v = Number(a.value) || 0;
  r.textContent = "Tip " + (v*p/100).toFixed(2) + ", total " + (v*(1+p/100)).toFixed(2);
}
<\/script>
</div>`,
  },
  {
    name: 'Atlas',
    tool: 'Grok 4.5',
    submitDelayMs: 10000,
    bias: 0,
    code: `<h3 style="font-family:monospace">bill splitter (wip)</h3>
<input id="x" placeholder="total" style="font-family:monospace">
<button onclick="document.getElementById('o').textContent = (document.getElementById('x').value/3).toFixed(2)">/3</button>
<pre id="o" style="font-family:monospace">?</pre>`,
  },
];

function clearBotTimers(lobby) {
  for (const t of lobby.botTimers) clearTimeout(t);
  lobby.botTimers = [];
}

function laterInLobby(lobby, ms, fn) {
  const round = lobby.round;
  const timer = setTimeout(() => {
    if (lobby.round !== round) return; // round moved on; this action is stale
    try {
      fn();
    } catch (err) {
      console.error('bot action failed', err);
    }
  }, ms);
  lobby.botTimers.push(timer);
}

/** Drop one fake player into a lobby, picking an unused name. */
function addBot(lobby) {
  const taken = new Set([...lobby.participants.values()].map((p) => p.name.toLowerCase()));
  let spec = BOTS.find((b) => !taken.has(b.name.toLowerCase()));
  let name;
  if (spec) {
    name = spec.name;
  } else {
    // More fake players than templates: reuse a template under a numbered name.
    spec = BOTS[lobby.participants.size % BOTS.length];
    let n = 2;
    while (taken.has(`${spec.name} ${n}`.toLowerCase())) n++;
    name = `${spec.name} ${n}`;
  }
  const bot = makeParticipant(name, spec.tool, true);
  bot.botSpec = spec;
  lobby.participants.set(bot.id, bot);
  return bot;
}

/** Bots paste their submission partway through the round. */
function scheduleBotSubmissions(lobby) {
  const roundMs = lobby.endsAt - lobby.startedAt;
  for (const p of lobby.participants.values()) {
    if (!p.isBot) continue;
    // Never let a bot's delay outlast a short round.
    const delay = Math.min(p.botSpec.submitDelayMs, Math.max(500, roundMs - 1500));
    laterInLobby(lobby, delay, () => {
      if (lobby.phase !== 'active' || p.submitted) return;
      p.draft = p.botSpec.code;
      p.code = p.botSpec.code;
      p.submitted = true;
      p.submittedAt = Date.now();
      p.remainingMsAtSubmit = Math.max(0, lobby.endsAt - p.submittedAt);
      maybeAdvanceToReveal(lobby); // schedules the ballots if this ends the round
      broadcast(lobby);
    });
  }
}

/** Bots fill in their ballots a few seconds into the reveal. */
function scheduleBotVotes(lobby) {
  let delay = 2500;
  for (const voter of lobby.participants.values()) {
    if (!voter.isBot) continue;
    laterInLobby(lobby, delay, () => {
      if (lobby.phase !== 'reveal') return;
      if (!lobby.votes.has(voter.id)) lobby.votes.set(voter.id, new Map());
      const byTarget = lobby.votes.get(voter.id);
      for (const target of lobby.participants.values()) {
        if (target.id === voter.id || byTarget.has(target.id)) continue;
        byTarget.set(target.id, botScores(voter, target));
      }
      maybeAdvanceToResults(lobby);
      broadcast(lobby);
    });
    delay += 2000;
  }
}

function botScores(voter, target) {
  const scores = {};
  for (const c of CRITERIA) {
    // DNF submissions earn a 1 from everyone; otherwise 2-5 nudged by the voter's bias.
    let v = target.dnf ? 1 : 3 + Math.floor(Math.random() * 3) + voter.botSpec.bias;
    scores[c] = Math.max(1, Math.min(5, v));
  }
  return scores;
}

// ------------------------------------------------------------- handlers ----

function fail(ws, message) {
  send(ws, { type: 'error', message });
}

function attach(ws, lobby, participant) {
  if (participant.ws && participant.ws !== ws) {
    try {
      participant.ws.close();
    } catch (_) {}
  }
  participant.ws = ws;
  participant.connected = true;
  clearTimeout(participant.departTimer);
  participant.departTimer = null;
  ws.lobbyId = lobby.id;
  ws.participantId = participant.id;
  send(ws, {
    type: 'joined',
    lobbyId: lobby.id,
    participantId: participant.id,
    token: participant.token,
  });
}

function handle(ws, msg) {
  const lobby = ws.lobbyId ? lobbies.get(ws.lobbyId) : null;
  const me = lobby ? lobby.participants.get(ws.participantId) : null;

  switch (msg.type) {
    // -- entry -------------------------------------------------------------
    case 'create': {
      if (ws.lobbyId) return fail(ws, 'Leave your current lobby first.');
      if (lobbies.size >= MAX_LOBBIES) return fail(ws, 'Too many lobbies open. Try again shortly.');
      const name = cleanText(msg.name, MAX_NAME);
      const tool = cleanText(msg.tool, MAX_TOOL);
      if (!name || !tool) return fail(ws, 'Name and LLM/tool are required.');
      const created = createLobby(cleanText(msg.lobbyName, MAX_LOBBY_NAME));
      const p = makeParticipant(name, tool, false, cleanPlayerId(msg.playerId), msg.verified === true);
      created.hostId = p.id;
      created.participants.set(p.id, p);
      attach(ws, created, p);
      broadcast(created);
      return;
    }

    // A private practice run: one player, no bots, no ballots, no archive.
    case 'solo': {
      if (ws.lobbyId) return fail(ws, 'Leave your current lobby first.');
      if (lobbies.size >= MAX_LOBBIES) return fail(ws, 'Too many lobbies open. Try again shortly.');
      const name = cleanText(msg.name, MAX_NAME) || 'You';
      const tool = cleanText(msg.tool, MAX_TOOL) || 'Unspecified';
      const created = createLobby('Practice run', 'solo');
      const p = makeParticipant(name, tool, false, cleanPlayerId(msg.playerId), msg.verified === true);
      created.hostId = p.id;
      created.participants.set(p.id, p);
      attach(ws, created, p);
      broadcast(created);
      return;
    }

    // Watching takes no seat, so it deliberately does not go through attach().
    case 'spectate': {
      if (ws.lobbyId) return fail(ws, 'Leave your lobby before watching another.');
      const target = lobbies.get(cleanText(msg.lobbyId, 16).toUpperCase());
      if (!target) return fail(ws, 'No match with that ID.');
      if (isSolo(target)) return fail(ws, 'Practice runs are private.');
      dropSpectator(ws); // moving between matches
      target.spectators.add(ws);
      ws.spectatingId = target.id;
      send(ws, { type: 'spectating', lobbyId: target.id });
      send(ws, spectatorSnapshot(target));
      if (target.phase === 'active') startSpectatorFeed(target);
      // Let the players know someone is watching.
      for (const p of target.participants.values()) {
        if (p.ws) send(p.ws, snapshotFor(target, p.id));
      }
      return;
    }

    case 'stop_spectate': {
      dropSpectator(ws);
      send(ws, { type: 'stopped_spectating' });
      return;
    }

    case 'join': {
      if (ws.lobbyId) return fail(ws, 'Leave your current lobby first.');
      const target = lobbies.get(cleanText(msg.lobbyId, 16).toUpperCase());
      if (!target) return fail(ws, 'No lobby with that ID.');
      const name = cleanText(msg.name, MAX_NAME);
      const tool = cleanText(msg.tool, MAX_TOOL);
      if (!name || !tool) return fail(ws, 'Name and LLM/tool are required.');
      if (target.phase !== 'lobby') return fail(ws, 'That battle has already started.');
      if (target.participants.size >= MAX_PARTICIPANTS) {
        return fail(ws, `Lobby is full (${MAX_PARTICIPANTS} max).`);
      }
      const taken = [...target.participants.values()].some(
        (p) => p.name.toLowerCase() === name.toLowerCase()
      );
      if (taken) return fail(ws, 'That name is already taken in this lobby.');
      const p = makeParticipant(name, tool, false, cleanPlayerId(msg.playerId), msg.verified === true);
      target.participants.set(p.id, p);
      attach(ws, target, p);
      broadcast(target);
      return;
    }

    case 'resume': {
      if (ws.lobbyId) return fail(ws, 'Already in a lobby.');
      const target = lobbies.get(cleanText(msg.lobbyId, 16).toUpperCase());
      if (!target) return fail(ws, 'That lobby no longer exists.');
      const token = cleanText(msg.token, 128);
      const p = [...target.participants.values()].find((x) => tokenMatches(x.token, token));
      if (!p) return fail(ws, 'Session not found in that lobby.');
      attach(ws, target, p);
      send(ws, { type: 'draft', code: p.code !== null ? p.code : p.draft });
      broadcast(target);
      return;
    }
  }

  if (!lobby || !me) return fail(ws, 'You are not in a lobby.');
  const isHost = lobby.hostId === me.id;

  switch (msg.type) {
    // -- setup -------------------------------------------------------------
    // The host never writes the brief. They pick a topic, and the server
    // rolls a random challenge from that pool.
    case 'roll_prompt': {
      if (!isHost) return fail(ws, 'Only the host can roll the challenge.');
      if (lobby.phase !== 'lobby') return fail(ws, 'Too late to change the challenge.');

      // 'daily'/'weekly' take the rotating brief instead of a fresh roll. The
      // topic filter is left alone so backing out to a normal roll still uses
      // whatever the host had picked.
      if (msg.special === 'daily' || msg.special === 'weekly') {
        lobby.prompt = rotatingChallenge(msg.special);
      } else {
        if (typeof msg.topic === 'string') {
          lobby.topic = TOPICS[msg.topic] ? msg.topic : 'RANDOM';
        }
        lobby.prompt = generatePrompt(lobby.topic);
      }
      lobby.challenge = lobby.prompt.text;
      if (!lobby.minutesOverridden) lobby.durationMinutes = lobby.prompt.suggestedMinutes;
      broadcast(lobby);
      return;
    }

    case 'set_minutes': {
      if (!isHost) return fail(ws, 'Only the host can set the timer.');
      if (lobby.phase !== 'lobby') return fail(ws, 'Too late to change the timer.');
      const mins = Number(msg.minutes);
      if (!Number.isFinite(mins) || mins <= 0) return fail(ws, 'Minutes must be a positive number.');
      lobby.durationMinutes = Math.min(mins, 24 * 60);
      lobby.minutesOverridden = true;
      broadcast(lobby);
      return;
    }

    case 'add_bot': {
      if (!isHost) return fail(ws, 'Only the host can add fake players.');
      if (isSolo(lobby)) return fail(ws, 'Practice runs are just you.');
      if (lobby.phase !== 'lobby') return fail(ws, 'Add fake players before the battle starts.');
      if (lobby.participants.size >= MAX_PARTICIPANTS) {
        return fail(ws, `Lobby is full (${MAX_PARTICIPANTS} max).`);
      }
      addBot(lobby);
      broadcast(lobby);
      return;
    }

    case 'remove_bot': {
      if (!isHost) return fail(ws, 'Only the host can remove fake players.');
      if (lobby.phase !== 'lobby') return fail(ws, 'Too late to change the roster.');
      const bot = lobby.participants.get(String(msg.participantId || ''));
      if (!bot || !bot.isBot) return fail(ws, 'That is not a fake player.');
      lobby.participants.delete(bot.id);
      broadcast(lobby);
      return;
    }

    case 'leave': {
      lobby.participants.delete(me.id);
      clearTimeout(me.departTimer);
      ws.lobbyId = null;
      ws.participantId = null;
      send(ws, { type: 'left' });
      if (lobby.hostId === me.id) {
        // Hand the lobby to the next human; fake players cannot run a battle.
        const nextHuman = [...lobby.participants.values()].find((p) => !p.isBot);
        lobby.hostId = nextHuman ? nextHuman.id : null;
      }
      if (![...lobby.participants.values()].some((p) => !p.isBot)) {
        // Only fake players left: tear the lobby down.
        clearInterval(lobby.timer);
        clearBotTimers(lobby);
        closeLobby(lobby);
        return;
      }
      broadcast(lobby);
      return;
    }

    case 'start': {
      if (!isHost) return fail(ws, 'Only the host can start the battle.');
      if (lobby.phase !== 'lobby') return fail(ws, 'Battle already started.');
      if (!lobby.challenge.trim()) return fail(ws, 'Set a challenge prompt first.');
      // A practice run is meant to be one person, so the roster floor does not
      // apply to it.
      if (!isSolo(lobby) && lobby.participants.size < MIN_PARTICIPANTS && !msg.allowUnderMin) {
        return fail(
          ws,
          `Need ${MIN_PARTICIPANTS} participants (have ${lobby.participants.size}). Tick "allow under ${MIN_PARTICIPANTS}" to start anyway.`
        );
      }
      startRound(lobby);
      return;
    }

    // -- submission --------------------------------------------------------
    case 'draft': {
      if (lobby.phase !== 'active' || me.submitted) return; // silently ignore late keystrokes
      me.draft = cleanCode(msg.code);
      return;
    }

    case 'submit': {
      if (lobby.phase !== 'active') return fail(ws, 'Submissions are closed.');
      if (me.submitted) return fail(ws, 'You already submitted.');
      me.draft = cleanCode(msg.code);
      me.code = me.draft;
      me.submitted = true;
      me.dnf = me.code.trim().length === 0;
      me.submittedAt = Date.now();
      me.remainingMsAtSubmit = Math.max(0, lobby.endsAt - me.submittedAt);
      maybeAdvanceToReveal(lobby);
      broadcast(lobby);
      return;
    }

    case 'force_end': {
      if (!isHost) return fail(ws, 'Only the host can end the round early.');
      if (lobby.phase !== 'active') return;
      lockSubmissions(lobby);
      return;
    }

    // -- voting ------------------------------------------------------------
    case 'vote': {
      if (lobby.phase !== 'reveal') return fail(ws, 'Voting is not open.');
      const targetId = String(msg.targetId || '');
      if (targetId === me.id) return fail(ws, 'Voting for yourself would be tacky.');
      if (!lobby.participants.has(targetId)) return fail(ws, 'Unknown submission.');
      if (!lobby.votes.has(me.id)) lobby.votes.set(me.id, new Map());
      const byTarget = lobby.votes.get(me.id);
      if (byTarget.has(targetId)) return fail(ws, 'You already voted on that submission.');

      const scores = {};
      for (const c of CRITERIA) {
        const v = Number(msg.scores?.[c]);
        if (!Number.isInteger(v) || v < 1 || v > 5) {
          return fail(ws, `Rate every criterion 1-5 (missing: ${CRITERIA_LABELS[c]}).`);
        }
        scores[c] = v;
      }
      byTarget.set(targetId, scores);
      maybeAdvanceToResults(lobby);
      broadcast(lobby);
      return;
    }

    case 'force_results': {
      if (!isHost) return fail(ws, 'Only the host can close voting.');
      if (lobby.phase !== 'reveal') return;
      finishBattle(lobby);
      broadcast(lobby);
      return;
    }

    case 'reset': {
      if (!isHost) return fail(ws, 'Only the host can reset.');
      resetLobby(lobby);
      broadcast(lobby);
      return;
    }

    default:
      return fail(ws, `Unknown message: ${msg.type}`);
  }
}

// ---------------------------------------------------------------- server ----

const app = express();

/* Baseline response headers. Deliberately not a full CSP: submissions render in
 * sandboxed iframes with an opaque origin, and a page-level script-src would
 * have to allow 'unsafe-inline' anyway for srcdoc to work, so it would be
 * decoration rather than a control. These four are the ones that actually pay
 * for themselves here. */
app.use((_req, res, next) => {
  // The game is never meant to be embedded; framing it is only useful for
  // clickjacking a host's Start or a voter's stars.
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // No camera, mic or location is ever used, so refuse them outright.
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  next();
});

// Caps body size well below HOUSE_MAX_PAYLOAD_CHARS so an oversized request is
// rejected by Express before it reaches any of the checks below.
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Which providers this instance can front with its own key, and the room
// left in the shared budget - lets the client know before anyone tries to
// prompt, rather than finding out on the first failed call.
/* Which provider logos are actually on disk. Read once at boot: the client
 * uses this to decide whether to request a logo at all, instead of firing a
 * request that 404s and letting an onerror handler clean up after it. */
const PROVIDER_LOGOS = (() => {
  try {
    return fs
      .readdirSync(path.join(__dirname, 'public', 'provider-logos'))
      .filter((f) => f.toLowerCase().endsWith('.svg'))
      .map((f) => f.replace(/\.svg$/i, ''));
  } catch (e) {
    return []; // folder missing entirely: every provider falls back to a monogram
  }
})();

app.get('/api/config', (_req, res) => {
  const house = {};
  for (const id of Object.keys(HOUSE_PROVIDERS)) house[id] = houseEnabled(id);
  res.json({ house, houseCallsPerRound: HOUSE_CALLS_PER_ROUND, providerLogos: PROVIDER_LOGOS });
});

/* Today's and this week's brief. Derived from the clock on every request, so
 * there is nothing to invalidate and every client agrees. */
app.get('/api/challenges', (_req, res) => {
  res.json({
    daily: rotatingChallenge('daily'),
    weekly: rotatingChallenge('weekly'),
    serverNow: Date.now(),
  });
});

/* The house-key sandbox proxy. A player's own key never touches this server -
 * this path exists only for the shared key, so it is deliberately narrow:
 * one active lobby, one real participant in it (proven by their resume
 * token, the same credential 'resume' trusts), one round's worth of calls,
 * one provider this instance actually funds. Nothing here is a general
 * "call any model with the house key" proxy. */
app.post('/api/sandbox/complete', async (req, res) => {
  const { lobbyId, participantId, token, provider, messages } = req.body || {};

  if (!houseGlobalBudgetOk()) {
    return res.status(429).json({ message: 'The house key is busy right now. Try again shortly.' });
  }
  if (!houseEnabled(provider)) {
    return res.status(400).json({ message: 'This instance has no house key for that provider.' });
  }
  const lobby = lobbies.get(cleanText(lobbyId, 16).toUpperCase());
  if (!lobby) return res.status(404).json({ message: 'That lobby no longer exists.' });
  const participant = lobby.participants.get(String(participantId || ''));
  if (!participant || !tokenMatches(participant.token, String(token || ''))) {
    return res.status(403).json({ message: 'Not a participant in that lobby.' });
  }
  if (lobby.phase !== 'active') {
    return res.status(409).json({ message: 'The house key only works during the build phase.' });
  }
  if (participant.houseCalls >= HOUSE_CALLS_PER_ROUND) {
    return res.status(429).json({
      message: `House key limit reached for this round (${HOUSE_CALLS_PER_ROUND} prompts). Connect your own key for more.`,
    });
  }
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ message: 'No prompt to send.' });
  }
  const lastTurn = messages[messages.length - 1];
  if (typeof lastTurn?.content !== 'string' || lastTurn.content.length > HOUSE_MAX_PROMPT_CHARS) {
    return res.status(400).json({ message: 'That prompt is too long for the house key.' });
  }
  const payloadSize = JSON.stringify(messages).length;
  if (payloadSize > HOUSE_MAX_PAYLOAD_CHARS) {
    return res.status(400).json({ message: 'This conversation has grown too long for the house key.' });
  }

  const spec = HOUSE_PROVIDERS[provider];
  houseWindowCalls += 1;
  participant.houseCalls += 1;
  try {
    const upstream = await fetch(spec.url(spec.key, spec.model), {
      method: 'POST',
      headers: spec.headers(spec.key),
      body: JSON.stringify(spec.body(spec.model, messages)),
    });
    if (!upstream.ok) {
      // The detail can carry the operator's own account info (billing, org
      // id), so it stays in the server log - players get a flat message.
      const detail = await upstream.text().catch(() => '');
      console.error(`house key (${provider}) returned ${upstream.status}:`, detail.slice(0, 500));
      const message =
        upstream.status === 429
          ? 'The provider rate-limited the house key. Try again shortly.'
          : 'The house key request failed upstream.';
      return res.status(502).json({ message });
    }
    const json = await upstream.json();
    res.json({ text: spec.text(json), usage: spec.usage(json) });
  } catch (err) {
    console.error('house key request error', err);
    res.status(502).json({ message: 'Could not reach the provider.' });
  }
});

app.get('/api/lobbies', (_req, res) => {
  res.json(
    [...lobbies.values()]
      .filter((l) => !isSolo(l)) // practice runs are private
      .map((l) => ({
        id: l.id,
        name: l.name,
        phase: l.phase,
        participants: l.participants.size,
        maxParticipants: MAX_PARTICIPANTS,
        joinable: l.phase === 'lobby' && l.participants.size < MAX_PARTICIPANTS,
        // Anything past the lobby has something to look at.
        watchable: l.phase !== 'lobby',
        spectators: l.spectators.size,
        round: l.round,
        topic: l.prompt ? l.prompt.topic : null,
        task: l.prompt ? l.prompt.task : null,
        endsAt: l.phase === 'active' ? l.endsAt : null,
        serverNow: Date.now(),
      }))
  );
});

// Battle history, when a database is attached. Returns 503 rather than
// pretending, so the client can just hide the section.
/* Founding roster.
 *
 * A leaderboard with nobody on it tells a new visitor nothing, so the board
 * ships with a few names on it. These are flagged `seeded: true` all the way
 * to the client, which labels them - the board should look alive without
 * passing invented results off as real play. Real players outrank them on
 * merit as soon as battles are archived: these are merged, never given
 * priority, and the whole block disappears once SEED_PLAYERS is emptied. */
const SEED_PLAYERS = [
  { name: 'Naod',  xp: 12480, tokens: 918400, wins: 34, battles: 41, avgTotal: 17.8, avgAesthetic: 4.7 },
  { name: 'Mira',  xp: 9310,  tokens: 642100, wins: 21, battles: 38, avgTotal: 16.2, avgAesthetic: 4.4 },
  { name: 'Dawit', xp: 7650,  tokens: 511900, wins: 15, battles: 33, avgTotal: 15.1, avgAesthetic: 4.6 },
];

/* The categories the board can be ranked by. Each is a key plus how to sort,
 * so adding one is a single line here and the client picks it up. */
const PLAYER_CATEGORIES = [
  { id: 'xp',        label: 'XP',            unit: 'XP',      key: (p) => p.xp },
  { id: 'tokens',    label: 'Tokens burned', unit: 'tokens',  key: (p) => p.tokens },
  { id: 'wins',      label: 'Wins',          unit: 'wins',    key: (p) => p.wins },
  { id: 'aesthetic', label: 'Most aesthetic', unit: '/5',     key: (p) => p.avgAesthetic },
];

/* Player standings, ranked every way the board offers. Real archived players
 * are merged with the seeded roster; a real player with the same name wins,
 * so seeding can never overwrite somebody's actual record. */
app.get('/api/players', async (_req, res) => {
  let real = [];
  try {
    if (archive.isEnabled()) real = (await archive.playerStandings()) || [];
  } catch (err) {
    console.error('player standings failed', err);
  }

  const byName = new Map();
  for (const p of SEED_PLAYERS) byName.set(p.name.toLowerCase(), { ...p, seeded: true });
  for (const p of real) byName.set(p.name.toLowerCase(), { ...p, seeded: false });
  const players = [...byName.values()];

  const boards = {};
  for (const cat of PLAYER_CATEGORIES) {
    boards[cat.id] = players
      .filter((p) => cat.key(p) > 0)
      .sort((a, b) => cat.key(b) - cat.key(a))
      .slice(0, 25)
      .map((p) => ({
        name: p.name,
        value: cat.key(p),
        battles: p.battles,
        wins: p.wins,
        seeded: !!p.seeded,
      }));
  }

  res.json({
    categories: PLAYER_CATEGORIES.map(({ id, label, unit }) => ({ id, label, unit })),
    boards,
    hasRealPlayers: real.length > 0,
  });
});

app.get('/api/stats', async (_req, res) => {
  if (!archive.isEnabled()) return res.status(503).json({ enabled: false });
  try {
    const [tools, battles] = await Promise.all([archive.toolStandings(), archive.recentBattles()]);
    if (!tools) return res.status(503).json({ enabled: false });
    res.json({ enabled: true, tools, battles });
  } catch (err) {
    // Express 4 does not catch rejections from async handlers, so an upstream
    // network blip would otherwise hang the request and warn on the process.
    console.error('stats query failed', err);
    res.status(503).json({ enabled: false });
  }
});

const server = http.createServer(app);
// Without maxPayload the ws default is 100MB per frame, which one client can
// send on repeat. The largest legitimate message is a submission, so cap a
// little above MAX_CODE to leave room for JSON escaping and the envelope.
const wss = new WebSocketServer({ server, maxPayload: 512 * 1024 });
wss.on('error', (err) => console.error('ws server error', err.message));

wss.on('connection', (ws) => {
  ws.msgCount = 0;
  ws.windowStart = Date.now();

  // A socket error is an EventEmitter 'error', which Node rethrows as an
  // uncaught exception when nothing is listening - so a single oversized frame
  // or a yanked network cable would take the whole server down with it, every
  // other battle included. Swallow it and let the 'close' handler tidy up.
  ws.on('error', (err) => {
    console.error('socket error', err.message);
    try { ws.close(); } catch (_) {}
  });

  ws.on('message', (raw) => {
    // Fixed-window throttle. A real client sends a couple of messages a second
    // at most; anything past the budget is a flood, so drop the connection
    // rather than keep servicing it.
    const now = Date.now();
    if (now - ws.windowStart > RATE_WINDOW_MS) {
      ws.windowStart = now;
      ws.msgCount = 0;
    }
    if (++ws.msgCount > RATE_MAX_MESSAGES) {
      fail(ws, 'Too many messages. Slow down.');
      return ws.close(1008, 'rate limit');
    }

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (_) {
      return fail(ws, 'Malformed message.');
    }
    // A non-object payload would make every msg.field read throw below.
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
      return fail(ws, 'Malformed message.');
    }
    try {
      handle(ws, msg);
    } catch (err) {
      // Log the detail, tell the client nothing: internal messages can carry
      // stack and path information that is none of a player's business.
      console.error('handler error', err);
      fail(ws, 'Something went wrong handling that.');
    }
  });

  ws.on('close', () => {
    // A watcher holds no seat, so it just drops off the set. Doing this first
    // means a socket that was watching never falls through to the participant
    // teardown below.
    dropSpectator(ws);
    const lobby = ws.lobbyId ? lobbies.get(ws.lobbyId) : null;
    if (!lobby) return;
    const p = lobby.participants.get(ws.participantId);
    if (!p || p.ws !== ws) return;
    p.connected = false;
    p.ws = null;
    // A reload looks identical to leaving, so hold the slot briefly either way.
    scheduleDeparture(lobby, p);
    broadcast(lobby);
  });
});

server.listen(PORT, () => {
  console.log(`vibewars running at http://localhost:${PORT}`);
});
