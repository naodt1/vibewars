/**
 * vibewars - multiplayer vibe coding battle
 * Single-process, in-memory demo server. State is lost on restart, by design.
 */

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 4300;

const MIN_PARTICIPANTS = 4;
const MAX_PARTICIPANTS = 6;
// How long a disconnected participant keeps their slot, so a page reload resumes
// instead of dropping them (and freeing their name) mid-lobby.
const DISCONNECT_GRACE_MS = 20000;

const CRITERIA = ['requirements', 'functionality', 'aesthetic', 'approach'];
const CRITERIA_LABELS = {
  requirements: 'Requirements Met',
  functionality: 'Functionality',
  aesthetic: 'Aesthetic',
  approach: 'Approach/Problem-Solving',
};

// ------------------------------------------------------ prompt generator ----

// Challenges are rolled by the server, not written by the host. The host only
// picks a topic and a difficulty; the exact brief is always a surprise.
const TOPICS = {
  SPEED: [
    { context: 'A boutique sneaker shop.', task: 'Build the size picker and add-to-cart panel.', flavour: 'Heavy type, raw edges, high contrast.' },
    { context: 'A hyper-local weather app.', task: 'Build the 7-day forecast strip and current conditions.', flavour: 'Massive numbers, monochrome, sharp borders.' },
    { context: 'A tip and bill splitter.', task: 'Build the amount entry and per-person breakdown.', flavour: 'One screen, no scrolling, thumb friendly.' },
    { context: 'A bedside alarm clock.', task: 'Build the set-alarm screen and the active alarm display.', flavour: 'Glowing numerals on a pitch black canvas.' },
    { context: 'A unit converter for cooking.', task: 'Build the conversion input and the live result list.', flavour: 'Kitchen-legible: big targets, greasy-thumb proof.' },
  ],
  CREATIVE: [
    { context: 'A space travel booking site.', task: 'Build the planet picker and ticket summary.', flavour: 'Retro-futurism, HUD panels, neon on deep space.' },
    { context: 'A potion vending machine.', task: 'Build the flavour selector and the dispensing animation.', flavour: 'Mystical purples and golds, glass vial shapes.' },
    { context: 'A dating app for ghosts.', task: 'Build the match card stack and the profile detail.', flavour: 'Frosted, floating, pale blues, soft glow.' },
    { context: 'A smart mirror for vampires.', task: 'Build the nightly schedule and reflection toggle.', flavour: 'Gothic chic: blood red, absolute black, ornate framing.' },
    { context: 'A museum of imaginary animals.', task: 'Build the exhibit browser and a creature detail card.', flavour: 'Editorial layout, generous whitespace, serif headlines.' },
  ],
  UX: [
    { context: 'An emergency dispatch console.', task: 'Build the incident queue and the responder assignment panel.', flavour: 'Glanceable under stress. Unmistakable targets.' },
    { context: 'A stock trading terminal.', task: 'Build the watchlist table and the quick-trade widget.', flavour: 'Information dense, strict grid, monospaced numerals.' },
    { context: 'An ER triage board.', task: 'Build the patient queue and a critical vitals card.', flavour: 'Colour-coded urgency, nothing ambiguous.' },
    { context: 'A city transit planner.', task: 'Build the next-departure board and the route input.', flavour: 'High contrast, never rely on colour alone.' },
    { context: 'A password manager.', task: 'Build the vault list and the entry detail with reveal.', flavour: 'Calm, trustworthy, obvious affordances.' },
  ],
  GAMES: [
    { context: 'A browser toy nobody asked for.', task: 'Build a working memory match game with a move counter.', flavour: 'Must actually be playable, not a mockup.' },
    { context: 'An arcade cabinet screen.', task: 'Build a reaction-time tester with a high score list.', flavour: 'CRT glow, chunky pixels, coin-op energy.' },
    { context: 'A pub quiz machine.', task: 'Build a 5-question quiz with scoring and a result screen.', flavour: 'Loud, colourful, slightly obnoxious.' },
    { context: 'A tabletop companion.', task: 'Build a dice roller with history and custom dice sides.', flavour: 'Feels physical: weight, shadow, satisfying press.' },
    { context: 'A typing trainer.', task: 'Build a words-per-minute test with live accuracy.', flavour: 'Distraction free, focus on the text itself.' },
  ],
  DATA: [
    { context: 'A personal finance tracker.', task: 'Build a spending-by-category breakdown with a total.', flavour: 'Charts drawn by hand: no chart libraries.' },
    { context: 'A server status page.', task: 'Build the uptime grid and the incident timeline.', flavour: 'Calm greens, honest reds, scannable at a glance.' },
    { context: 'A habit tracker.', task: 'Build the streak calendar and a per-habit summary.', flavour: 'A year of data on one screen without clutter.' },
    { context: 'A race results board.', task: 'Build the live standings table with position changes.', flavour: 'Broadcast graphics energy, tabular numerals.' },
    { context: 'A warehouse dashboard.', task: 'Build the stock level list with reorder warnings.', flavour: 'Industrial, dense, built for a wall-mounted screen.' },
  ],
  CHAOS: [
    { context: "A hacker collective's chat client.", task: 'Build the channel list and the message composer.', flavour: 'Green on black, monospace, ascii borders.' },
    { context: 'A malfunctioning robot control panel.', task: 'Build the error log and the reboot sequence.', flavour: 'Glitched, overlapping, jarring diagonals.' },
    { context: 'A social network for dogs.', task: 'Build the feed and the "sniff" interaction.', flavour: 'Absurdly oversized, primary colours only.' },
    { context: 'A doomsday device.', task: 'Build the countdown and the final authorisation modal.', flavour: 'Cold, industrial, menacing typography.' },
    { context: 'A vending machine possessed by a spirit.', task: 'Build the product grid and the haunted checkout.', flavour: 'It should argue with the user.' },
  ],
};

const CONSTRAINTS = {
  1: [
    'Make it genuinely usable, nothing decorative-only.',
    'It has to work on a phone-sized screen.',
    'Every control needs a visible label.',
  ],
  2: [
    'Black and white only.',
    'Everything must fit on one screen, no scrolling.',
    'Maximum three font sizes.',
    'No rounded corners anywhere.',
    'Every control must be reachable by keyboard.',
  ],
  3: [
    'No text labels at all: shapes and icons only.',
    'No <button> elements allowed.',
    'The whole UI must fit in a 300x300 box.',
    'CSS only, not a single line of JavaScript.',
    'The primary action must be hidden until hover or focus.',
  ],
  4: [
    'Comic Sans or Papyrus, exclusively.',
    'Something on screen must never stop moving.',
    'All numbers must be shown as tally marks.',
    'Every colour must be a shade of the same hue.',
    'The user must solve a maths problem before the main action unlocks.',
  ],
};

const LEVEL_NAMES = { 1: 'Warmup', 2: 'Tricky', 3: 'Hard', 4: 'Chaos' };
const LEVEL_MINUTES = { 1: 5, 2: 7, 3: 10, 4: 12 };

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Roll a challenge. `topic` may be 'RANDOM'. Returns the structured brief plus a
 * flattened text version for anything that just wants a string.
 */
function generatePrompt(topic, level) {
  const topicNames = Object.keys(TOPICS);
  const chosenTopic = TOPICS[topic] ? topic : pickRandom(topicNames);
  const lvl = [1, 2, 3, 4].includes(level) ? level : 1 + Math.floor(Math.random() * 4);

  const scenario = pickRandom(TOPICS[chosenTopic]);
  const pool = [...CONSTRAINTS[lvl]].sort(() => 0.5 - Math.random());
  const count = lvl === 1 ? 1 : 2;
  const constraints = pool.slice(0, count);

  const text =
    `CONTEXT\n${scenario.context}\n\n` +
    `TASK\n${scenario.task}\n\n` +
    `VIBE\n${scenario.flavour}\n\n` +
    `CONSTRAINTS\n${constraints.map((c) => `- ${c}`).join('\n')}`;

  return {
    topic: chosenTopic,
    level: lvl,
    levelName: LEVEL_NAMES[lvl],
    context: scenario.context,
    task: scenario.task,
    flavour: scenario.flavour,
    constraints,
    text,
    suggestedMinutes: LEVEL_MINUTES[lvl],
  };
}

// ---------------------------------------------------------------- state ----

/** @type {Map<string, Lobby>} */
const lobbies = new Map();

function newId(len = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function newToken() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function createLobby(name) {
  let id = newId();
  while (lobbies.has(id)) id = newId();
  const firstPrompt = generatePrompt('RANDOM');
  const lobby = {
    id,
    name: name || `Lobby ${id}`,
    hostId: null,
    topic: 'RANDOM', // host's filter, not necessarily the rolled prompt's topic
    level: firstPrompt.level,
    prompt: firstPrompt,
    challenge: firstPrompt.text,
    durationMinutes: firstPrompt.suggestedMinutes,
    minutesOverridden: false,
    phase: 'lobby', // lobby | active | reveal | results
    round: 0, // bumped every start; lets clients invalidate cached reveal tiles
    startedAt: null,
    endsAt: null,
    timer: null,
    participants: new Map(), // pid -> participant
    votes: new Map(), // voterId -> Map<targetId, scores>
    botTimers: [],
  };
  lobbies.set(id, lobby);
  return lobby;
}

function makeParticipant(name, tool, isBot = false) {
  return {
    id: newId(8),
    isBot,
    token: newToken(),
    name,
    tool,
    connected: true,
    draft: '', // live autosaved textarea content
    code: null, // final locked submission (null until submitted/locked)
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
      lobbies.delete(lobby.id);
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
  const revealing = lobby.phase === 'reveal' || lobby.phase === 'results';
  const base = {
    id: p.id,
    name: p.name,
    tool: p.tool,
    isBot: !!p.isBot,
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

function snapshotFor(lobby, viewerId) {
  return {
    type: 'state',
    serverNow: Date.now(),
    lobby: {
      id: lobby.id,
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
      level: lobby.level,
      topics: Object.keys(TOPICS),
      levelNames: LEVEL_NAMES,
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
  lobby.phase = 'reveal';
  scheduleBotVotes(lobby);
  broadcast(lobby);
}

function maybeAdvanceToReveal(lobby) {
  if (lobby.phase !== 'active') return;
  const all = [...lobby.participants.values()];
  if (all.length > 0 && all.every((p) => p.submitted)) {
    clearInterval(lobby.timer);
    lobby.timer = null;
    lobby.phase = 'reveal';
    scheduleBotVotes(lobby);
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
  // A new round deserves a new brief.
  lobby.prompt = generatePrompt(lobby.topic, lobby.level);
  lobby.challenge = lobby.prompt.text;
  if (!lobby.minutesOverridden) lobby.durationMinutes = lobby.prompt.suggestedMinutes;
  for (const p of lobby.participants.values()) {
    p.draft = '';
    p.code = null;
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
  if (expected > 0 && cast >= expected) lobby.phase = 'results';
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
      const name = String(msg.name || '').trim();
      const tool = String(msg.tool || '').trim();
      if (!name || !tool) return fail(ws, 'Name and LLM/tool are required.');
      const created = createLobby(String(msg.lobbyName || '').trim());
      const p = makeParticipant(name, tool);
      created.hostId = p.id;
      created.participants.set(p.id, p);
      attach(ws, created, p);
      broadcast(created);
      return;
    }

    case 'join': {
      const target = lobbies.get(String(msg.lobbyId || '').trim().toUpperCase());
      if (!target) return fail(ws, 'No lobby with that ID.');
      const name = String(msg.name || '').trim();
      const tool = String(msg.tool || '').trim();
      if (!name || !tool) return fail(ws, 'Name and LLM/tool are required.');
      if (target.phase !== 'lobby') return fail(ws, 'That battle has already started.');
      if (target.participants.size >= MAX_PARTICIPANTS) {
        return fail(ws, `Lobby is full (${MAX_PARTICIPANTS} max).`);
      }
      const taken = [...target.participants.values()].some(
        (p) => p.name.toLowerCase() === name.toLowerCase()
      );
      if (taken) return fail(ws, 'That name is already taken in this lobby.');
      const p = makeParticipant(name, tool);
      target.participants.set(p.id, p);
      attach(ws, target, p);
      broadcast(target);
      return;
    }

    case 'resume': {
      const target = lobbies.get(String(msg.lobbyId || '').trim().toUpperCase());
      if (!target) return fail(ws, 'That lobby no longer exists.');
      const p = [...target.participants.values()].find((x) => x.token === msg.token);
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
    // The host never writes the brief. They pick a topic and difficulty, and the
    // server rolls a random challenge from that pool.
    case 'roll_prompt': {
      if (!isHost) return fail(ws, 'Only the host can roll the challenge.');
      if (lobby.phase !== 'lobby') return fail(ws, 'Too late to change the challenge.');
      if (typeof msg.topic === 'string') {
        lobby.topic = TOPICS[msg.topic] ? msg.topic : 'RANDOM';
      }
      if (msg.level === 'RANDOM') lobby.level = null;
      else if ([1, 2, 3, 4].includes(Number(msg.level))) lobby.level = Number(msg.level);

      lobby.prompt = generatePrompt(lobby.topic, lobby.level);
      lobby.challenge = lobby.prompt.text;
      // Difficulty drives the clock unless the host has said otherwise.
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
        lobbies.delete(lobby.id);
        return;
      }
      broadcast(lobby);
      return;
    }

    case 'start': {
      if (!isHost) return fail(ws, 'Only the host can start the battle.');
      if (lobby.phase !== 'lobby') return fail(ws, 'Battle already started.');
      if (!lobby.challenge.trim()) return fail(ws, 'Set a challenge prompt first.');
      if (lobby.participants.size < MIN_PARTICIPANTS && !msg.allowUnderMin) {
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
      me.draft = String(msg.code || '');
      return;
    }

    case 'submit': {
      if (lobby.phase !== 'active') return fail(ws, 'Submissions are closed.');
      if (me.submitted) return fail(ws, 'You already submitted.');
      me.draft = String(msg.code || '');
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
      if (targetId === me.id) return fail(ws, 'You cannot vote on your own submission.');
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
      lobby.phase = 'results';
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
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/lobbies', (_req, res) => {
  res.json(
    [...lobbies.values()].map((l) => ({
      id: l.id,
      name: l.name,
      phase: l.phase,
      participants: l.participants.size,
      maxParticipants: MAX_PARTICIPANTS,
      joinable: l.phase === 'lobby' && l.participants.size < MAX_PARTICIPANTS,
    }))
  );
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (_) {
      return fail(ws, 'Malformed message.');
    }
    try {
      handle(ws, msg);
    } catch (err) {
      console.error('handler error', err);
      fail(ws, 'Server error: ' + err.message);
    }
  });

  ws.on('close', () => {
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
