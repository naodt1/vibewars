# Contributing

Thanks for taking a look. This is a small codebase on purpose, and it should stay that way.

## Running it

```bash
npm install
npm start          # http://localhost:4300
node e2e-test.js   # full lifecycle against a real server on port 4399
```

Please run `node e2e-test.js` before opening a pull request. It boots a real server and drives a
whole battle with real WebSocket clients, so it catches most breakage in one shot. If you change
game rules, add a check to it rather than testing by hand.

## Ground rules

- **No build step.** The client is one HTML file, one CSS block and one JS file, served as-is.
  Anything that needs compiling, bundling or transpiling is out.
- **No browser dependencies.** The syntax highlighter, the confetti and the tool picker are all
  hand-rolled. If you want a library in the browser, that is a discussion first.
- **The server is the authority.** Never trust the client for phase, timing, locking or scoring.
  Every rule that matters is enforced in `server.js`, and the client only renders.
- **Keep it accessible.** Respect `prefers-reduced-motion`, keep the star ratings as real radio
  inputs, and keep controls reachable by keyboard.

## The easy first contribution

Add challenges. `TOPICS` and `CONSTRAINTS` at the top of `server.js` are plain arrays: a topic is
five scenarios, a scenario is a context, a task and a one-line vibe. Nothing else needs to change.

Good scenarios are buildable in a single HTML file inside ten minutes, specific enough to judge
against, and leave room for interpretation. Constraints should be annoying but survivable.

## Where things live

| File | What it holds |
| --- | --- |
| `server.js` | State machine, WebSocket protocol, timers, prompt generator, fake players, scoring |
| `supabase.js` | Optional battle archive. Best-effort; the game runs fine without it |
| `supabase/migrations/` | Tables, RLS policies and the `tool_standings` view |
| `public/index.html` | Markup, the whole stylesheet, info page templates |
| `public/app.js` | Client rendering, tool picker, syntax highlighter, confetti |
| `e2e-test.js` | Full lifecycle test |

## Reporting things

Include what you expected, what happened, and how many people were in the lobby. If it involves
timing or the buzzer, the round length matters too.
