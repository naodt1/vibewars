# vibewars

**Same brief. Same clock. Different models.**

MIT licensed &middot; no accounts &middot; no database &middot; no build step

[github.com/naodt1/vibewars](https://github.com/naodt1/vibewars)



Multiplayer "vibe coding battle": 4-6 people get the same prompt and a timer, each pastes raw
HTML as their solution, everything is revealed side-by-side in isolated iframes, and everyone
rates everyone else.

No build step, no database. One Node process holds all state in memory; restarting the server
wipes everything.

Dark-native and deliberately quiet: charcoal surfaces that separate by tone rather than by
outline (`#141414` page, `#1C1C1C` cards), one warm accent (`#FF7A2F`), no hard offset shadows,
1px hairlines, rounded corners and generous spacing. Type is DM Sans throughout at a few weights,
no display serif.

The earlier version was a light design with its colours inverted, which put light 2px borders and
hard light offset shadows on a dark background - harsh and noisy. This one is built for dark
first, with light as the secondary theme rather than the source of truth.

It is hand-written CSS in `public/index.html` rather than Tailwind, since this app has no build
step. The font loads from Google Fonts and falls back to the system sans offline.

## Run

```bash
npm install && npm start
```

Then open http://localhost:4300 in one tab per participant (each browser tab is its own
participant, since identity lives in `sessionStorage`). Set `PORT` to change the port.

## The code editor

Syntax highlighting is hand-rolled in `public/app.js` (`highlightHtml`), since the app pulls in
no libraries and has no build step. A `<pre>` layer paints the coloured tokens and a transparent
`<textarea>` sits on top holding the real text and caret; both layers share identical font,
padding, line-height and `white-space: pre`, and scroll is mirrored on both axes, so the caret
never drifts from the paint.

The tokenizer handles doctypes, comments, tags, attribute names and values, and switches into a
JavaScript pass inside `<script>` and a CSS pass inside `<style>`. Every token is escaped on the
way out, so nothing a player pastes can inject markup into the editor chrome. Above 60k
characters it drops to plain escaped text rather than get slow.

## Challenge generation

Briefs are rolled server-side, in the shape UIWars uses: a **context** ("A doomsday device."), a
**task** ("Build the countdown and the final authorisation modal."), a one-line **vibe**, and
**constraints** drawn from the chosen difficulty. Level 1 adds one constraint, levels 2-4 add two,
and the pools get progressively more hostile ("No `<button>` elements allowed", "All numbers must
be shown as tally marks").

Difficulty also sets the clock (5/7/10/12 minutes), which the host can override; once overridden,
rerolling no longer moves it. Resetting for another round rolls a fresh brief within the same
topic and difficulty, so a group can play several rounds without repeating.

Everything lives in `TOPICS` and `CONSTRAINTS` at the top of `server.js` - six topics of five
scenarios each. Add to those arrays to extend the pool; no other code needs to change.

## Fake players

Everything is multiplayer; there is no separate solo mode. To test a full battle without
rounding up four people, the host can hit "+ Add fake player" in the waiting room (up to the
6-player cap, removable one by one). Fake players count toward the 4-player minimum, so one real
person plus three fakes can start a normal round.

During the round they paste their own submissions at 4, 7 and 10 seconds; after the reveal they
fill in their ballots a few seconds apart, leaving only your own votes to cast. Their submissions
are deliberately uneven in quality and their scoring bias differs (Nova generous, Mercury harsh,
Atlas neutral), so the leaderboard is not a flat tie. They are defined in `BOTS` in `server.js`.

## Getting around

- The navbar has a **Leave lobby** button whenever you are in one (it confirms first if a battle
  is underway). Leaving frees your name, hands the host seat to the next real player, and deletes
  the lobby if only fake players remain.
- The **Open lobbies** list on the front page refreshes itself and each row has a **Join** button.
  Clicking it fills in the lobby ID; if your name and tool are not set yet it says so instead of
  failing silently. Rows for full or in-progress lobbies are disabled and say why.
- On the results screen the host gets **Reset lobby for another round**, which returns everyone to
  the waiting room with the same roster.

## Test

```bash
node e2e-test.js
```

Boots a server on port 4399 and drives a full lobby lifecycle with real websocket clients:
join limits, host permissions, the timer, explicit vs. auto submission, DNF, self-vote and
double-vote rejection, leaderboard math, tiebreakers, a second round after reset, leaving a
lobby, and a full round played against fake players.

## Flow

1. **Create/join** - the front page asks one thing first: create or join. Each path then asks a
   single question per screen (name, then tool, then lobby name / code) rather than showing two
   forms at once. Enter advances, Back steps out to the fork. Hitting "Join" on a row in the open
   lobbies list drops you into the join flow with the code already filled in.
   The creator becomes host and gets a 6-character lobby ID. Others join with
   that ID plus their name and the LLM/tool they are using, picked from an expandable dropdown
   grouped by provider (ChatGPT, Claude, Gemini, Grok, Meta, open weights, coding agents) with a
   free-text option for anything else. Live roster, max 6. The model list is the `TOOL_GROUPS`
   constant at the top of `public/app.js` - it is only a label on a tile, so edit it freely as
   models ship.
2. **Challenge** - nobody writes the brief. The server rolls one the moment the lobby is created.
   The host only picks a **topic** (SPEED, CREATIVE, UX, GAMES, DATA, CHAOS, or "any") and a
   **difficulty** (1 Warmup to 4 Chaos) from dropdowns, and can keep hitting "Roll again" until
   they like what comes up. Changing either dropdown rolls immediately.
3. **Build** - everyone gets a syntax-highlighted editor and a countdown. Submitting locks your
   code and banks your remaining time (used as the final tiebreaker).
4. **Reveal** - at zero (or when everyone has submitted, or when the host ends the round early)
   submissions lock and render in sandboxed `srcdoc` iframes, labeled with name and tool.
5. **Vote** - one contestant at a time rather than a wall of tiles. The submission fills the full
   page width with the four criteria laid out 2x2 beneath it, and a single toolbar underneath
   carries Back/Next, the position, the jump dots, the ballot count and the host's close-voting
   button. Dots jump straight to anyone (lime = already rated, grey = you), and casting a ballot
   advances you to the next unrated contestant automatically. 1-5 stars on Requirements
   Met, Functionality, Aesthetic, and Approach/Problem-Solving, for every submission except your
   own. One ballot per voter per target, no changes after. The stars are real radio inputs styled
   with a reversed-row sibling selector, so keyboard and screen-reader behaviour survives. All
   tiles stay mounted while you step, so an iframe never reloads and loses its state.
6. **Leaderboard** - shown once every ballot is in, or when the host closes voting. The winner
   gets a banner above the table and a confetti burst: a small canvas particle system in
   `public/app.js` (`fireConfetti`), palette-matched and throwing the same four-point sparkle used
   across the UI. It fires once per round, never when nobody scored, honours
   `prefers-reduced-motion`, and defers itself until the tab is visible - `requestAnimationFrame`
   is suspended in a background tab, so an unguarded burst would be swallowed for anyone who
   tabbed away while voting closed.

## Scoring

Each criterion is averaged over the voters who rated that participant, and the four averages are
summed into the total (max 20). Ties break on Requirements Met average, then on time remaining at
submission.

## Behaviour worth knowing

- **Buzzer handling.** The textarea autosaves to the server as you type. At time-up, anyone who
  never clicked Submit gets their last autosaved draft locked in and flagged
  "auto-submitted at buzzer"; an empty textarea is marked DNF instead. The spec called for a plain
  DNF here, but silently discarding visible work someone had on screen seemed worse than banking
  it with no time bonus, and DNF still applies when there is genuinely nothing to bank.
- **Under 4 participants.** Starting is blocked below 4, with an "allow starting with fewer than 4"
  checkbox so the demo can be driven with 2-3 tabs.
- **Reloading.** Identity lives in `sessionStorage`, and a disconnected participant keeps their
  slot for 20 seconds, so a refresh resumes rather than dropping you.
- **Isolation.** Submissions run in `sandbox="allow-scripts allow-forms allow-modals allow-popups"`
  iframes without `allow-same-origin`, so submitted scripts execute but cannot reach the host page
  or each other.
- **Host controls.** End round now (locks everyone immediately), close voting (shows the
  leaderboard before all ballots are in), and reset (returns to the lobby for another round with
  the same people).

## Files

- `server.js` - state machine, websocket protocol, timers, prompt generator, fake players, scoring
- `public/index.html` - markup, the whole stylesheet, info page templates
- `public/app.js` - client rendering, tool picker, syntax highlighter, confetti
- `e2e-test.js` - full-lifecycle test

## Theme

Dark by default, with a light theme behind the moon/sun toggle in the navbar; the choice is kept
in `localStorage` and applied before first paint so returning users never see a flash. Both
themes are the same rules with swapped tokens: `--bg`, `--surface`, `--surface-2/3` for the tonal
steps, `--fg`/`--muted`/`--faint` for text, `--line` for hairlines, and `--accent` with
`--on-accent` for anything sitting on the accent fill. Submissions always render on a white
iframe background regardless of theme, since they are written assuming a white page.

## Sponsors

Four placeholder slots sit in fixed rails either side of the board, shown once the window is wide
enough to spare the space (1640px). They are plain markup rendered by the site - no ad network, no
third-party script, nothing that phones home. Nothing is sold; see the Sponsor page in the app.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The easiest useful change is adding challenges: `TOPICS`
and `CONSTRAINTS` at the top of `server.js` are plain arrays. Run `npm test` before a PR.

## License

MIT - see [LICENSE](LICENSE).
