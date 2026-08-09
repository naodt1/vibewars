/* Solo practice and spectator paths, driven over real sockets.
 * The load-bearing check here is that a live draft reaches a watcher and never
 * reaches a rival. */
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 4488;
const URL = `ws://localhost:${PORT}`;
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  -> ' + extra : ''));
  cond ? pass++ : fail++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function open() {
  const ws = new WebSocket(URL);
  ws.inbox = [];
  ws.on('message', (d) => {
    try { ws.inbox.push(JSON.parse(d.toString())); } catch (_) {}
  });
  ws.on('error', () => {});
  return new Promise((res, rej) => {
    ws.on('open', () => res(ws));
    ws.on('error', rej);
  });
}
const send = (ws, o) => ws.send(JSON.stringify(o));
const last = (ws, type) => [...ws.inbox].reverse().find((m) => m.type === type);

(async () => {
  const srv = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', () => {});
  srv.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));
  await wait(900);

  try {
    // ---------------------------------------------------------------- solo --
    const solo = await open();
    send(solo, { type: 'solo', name: 'Practicer', tool: 'gpt-test' });
    await wait(300);
    let s = last(solo, 'state');
    ok('solo lobby created', !!s && s.lobby.mode === 'solo', s && s.lobby.mode);
    ok('solo has exactly one player', s && s.participants.length === 1, s && String(s.participants.length));

    // Practice runs must not appear publicly.
    const listed = await (await fetch(`http://localhost:${PORT}/api/lobbies`)).json();
    ok('solo lobby is unlisted', !listed.some((l) => l.id === s.lobby.id), `${listed.length} listed`);

    // Bots are refused in practice.
    solo.inbox.length = 0;
    send(solo, { type: 'add_bot' });
    await wait(200);
    ok('solo refuses fake players', !!last(solo, 'error'), last(solo, 'error') && last(solo, 'error').message);

    // Starts with one player, no min-roster complaint.
    send(solo, { type: 'set_minutes', minutes: 0.1 });
    await wait(150);
    solo.inbox.length = 0;
    send(solo, { type: 'start' });
    await wait(300);
    s = last(solo, 'state');
    ok('solo starts with one player', s && s.lobby.phase === 'active', s && s.lobby.phase);

    send(solo, { type: 'submit', code: '<h1>practice</h1>' });
    await wait(400);
    s = last(solo, 'state');
    ok('solo ends in practice, not voting', s && s.lobby.phase === 'practice', s && s.lobby.phase);
    ok('solo has no leaderboard', s && !s.leaderboard, JSON.stringify(s && s.leaderboard));
    // The practice screen renders your own build, so the code has to come back.
    ok('practice returns your own code',
       s && s.participants[0].code === '<h1>practice</h1>',
       s && JSON.stringify(s.participants[0].code));

    // A watcher may not enter a practice run.
    const nosy = await open();
    send(nosy, { type: 'spectate', lobbyId: s.lobby.id });
    await wait(250);
    ok('solo cannot be watched', !!last(nosy, 'error'), last(nosy, 'error') && last(nosy, 'error').message);
    nosy.close();

    // ----------------------------------------------------------- spectator --
    const host = await open();
    send(host, { type: 'create', name: 'Host', tool: 'gpt-test' });
    await wait(300);
    const matchId = last(host, 'state').lobby.id;
    const rival = await open();
    send(rival, { type: 'join', lobbyId: matchId, name: 'Rival', tool: 'claude-test' });
    await wait(250);

    const watcher = await open();
    send(watcher, { type: 'spectate', lobbyId: matchId });
    await wait(300);
    ok('spectate accepted', !!last(watcher, 'spectating'), matchId);
    ok('watcher snapshot is flagged', last(watcher, 'state') && last(watcher, 'state').spectating === true);
    ok('players see the watcher count', last(host, 'state') && last(host, 'state').spectators === 1,
       String(last(host, 'state') && last(host, 'state').spectators));

    send(host, { type: 'set_minutes', minutes: 0.4 });
    await wait(150);
    send(host, { type: 'start', allowUnderMin: true });
    await wait(400);

    // The host types. The watcher should see it; the rival must not.
    const secret = '<h1>host work in progress</h1>';
    send(host, { type: 'draft', code: secret });
    watcher.inbox.length = 0;
    rival.inbox.length = 0;
    await wait(2200); // past one spectator tick

    const wState = last(watcher, 'state');
    const hostId = wState.participants.find((p) => p.name === 'Host').id;
    ok('watcher receives the live draft',
       wState && wState.drafts && wState.drafts[hostId] === secret,
       wState && wState.drafts ? JSON.stringify(wState.drafts[hostId]).slice(0, 40) : 'none');

    const rState = last(rival, 'state');
    const rivalSeesDraft = !!(rState && (rState.drafts ||
      (rState.participants || []).some((p) => typeof p.code === 'string' && p.code.includes('work in progress'))));
    ok('rival never receives the draft', !rivalSeesDraft);

    // Watching does not take a seat.
    ok('watcher takes no seat', wState.participants.length === 2, String(wState.participants.length));

    // Leaving stops the feed and settles the count.
    send(watcher, { type: 'stop_spectate' });
    await wait(300);
    ok('stop_spectate acknowledged', !!last(watcher, 'stopped_spectating'));
    ok('watcher count returns to zero', last(host, 'state').spectators === 0,
       String(last(host, 'state').spectators));

    // Re-attach and follow the match through the buzzer to the reveal.
    send(watcher, { type: 'spectate', lobbyId: matchId });
    await wait(300);
    watcher.inbox.length = 0;
    await wait(26000); // 0.4 min round plus slack
    const revealState = last(watcher, 'state');
    ok('watcher follows through to reveal/results',
       revealState && ['reveal', 'results'].includes(revealState.lobby.phase),
       revealState && revealState.lobby.phase);
    ok('watcher sees submitted code at reveal',
       revealState && revealState.participants.some((p) => typeof p.code === 'string'),
       'code present');

    // Watchers must not be able to vote.
    watcher.inbox.length = 0;
    send(watcher, { type: 'vote', targetId: hostId, scores: { requirements: 5, functionality: 5, aesthetic: 5, approach: 5 } });
    await wait(250);
    ok('watcher cannot vote', !!last(watcher, 'error'), last(watcher, 'error') && last(watcher, 'error').message);

    // Watch list exposes live matches.
    const live = await (await fetch(`http://localhost:${PORT}/api/lobbies`)).json();
    const entry = live.find((l) => l.id === matchId);
    ok('match list marks it watchable', entry && entry.watchable === true, entry && String(entry.watchable));

    // Server survives.
    const final = await open();
    send(final, { type: 'solo', name: 'Last', tool: 'x' });
    await wait(300);
    ok('server still serving', !!last(final, 'state'));
  } catch (e) {
    console.error('TEST ERROR', e);
    fail++;
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  srv.kill();
  process.exit(fail ? 1 : 0);
})();
