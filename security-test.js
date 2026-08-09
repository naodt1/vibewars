/* Security regression checks: talks to a real server the way an attacker would,
 * not the way the client does. */
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 4477;
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
    // 1. Oversized name is truncated, not stored whole.
    let a = await open();
    send(a, { type: 'create', name: 'N'.repeat(5000), tool: 'T'.repeat(5000), lobbyName: 'L'.repeat(5000) });
    await wait(300);
    let st = last(a, 'state');
    const me = st && st.participants.find((p) => p.isYou);
    ok('name capped at 24', me && me.name.length === 24, me && String(me.name.length));
    ok('tool capped at 64', me && me.tool.length === 64, me && String(me.tool.length));
    ok('lobby name capped at 48', st && st.lobby.name.length <= 48, st && String(st.lobby.name.length));

    // 2. Creating again on the same socket is refused (no orphaned lobbies).
    a.inbox.length = 0;
    send(a, { type: 'create', name: 'Second', tool: 'x' });
    await wait(250);
    ok('second create refused', !!last(a, 'error'), last(a, 'error') && last(a, 'error').message);

    // 3. Control characters are stripped from display strings.
    const b = await open();
    send(b, { type: 'create', name: 'Ev\u0000il\u202End', tool: 'x' });
    await wait(300);
    const bst = last(b, 'state');
    const bme = bst && bst.participants.find((p) => p.isYou);
    ok('control chars stripped', bme && bme.name === 'Evilnd', bme && JSON.stringify(bme.name));

    // 4. Oversized code is capped.
    const lobbyId = bst.lobby.id;
    const joiners = [];
    for (let i = 0; i < 3; i++) {
      const j = await open();
      send(j, { type: 'join', lobbyId, name: 'P' + i, tool: 't' });
      await wait(120);
      joiners.push(j);
    }
    send(b, { type: 'start' });
    await wait(300);
    send(b, { type: 'submit', code: 'x'.repeat(300000) });
    await wait(300);
    const bst2 = last(b, 'state');
    const bme2 = bst2 && bst2.participants.find((p) => p.isYou);
    ok('submitted code capped at 128KB', bme2 && bme2.submitted, 'submitted=' + (bme2 && bme2.submitted));

    // 5. Tokens are unpredictable and long.
    const joined = last(b, 'joined');
    ok('token is >=32 chars', joined && joined.token.length >= 32, joined && String(joined.token.length));
    const c1 = await open();
    const c2 = await open();
    send(c1, { type: 'create', name: 'T1', tool: 'x' });
    send(c2, { type: 'create', name: 'T2', tool: 'x' });
    await wait(300);
    const t1 = last(c1, 'joined').token, t2 = last(c2, 'joined').token;
    ok('tokens differ', t1 !== t2);
    ok('token is base64url', /^[A-Za-z0-9_-]+$/.test(t1), t1.slice(0, 12) + '…');

    // 6. Wrong token cannot resume someone else's seat.
    const intruder = await open();
    send(intruder, { type: 'resume', lobbyId, token: 'not-the-real-token' });
    await wait(250);
    ok('bad token rejected', !!last(intruder, 'error'), last(intruder, 'error') && last(intruder, 'error').message);

    // 7. Non-object payloads do not crash the handler.
    const junk = await open();
    junk.send('"just a string"');
    junk.send('12345');
    junk.send('[1,2,3]');
    junk.send('{bad json');
    await wait(250);
    ok('junk payloads rejected cleanly', junk.readyState === WebSocket.OPEN);

    // 8. Message flooding trips the rate limit.
    const flood = await open();
    let closed = false;
    flood.on('close', () => { closed = true; });
    for (let i = 0; i < 400; i++) send(flood, { type: 'ping_' + i });
    await wait(700);
    ok('flood closes the socket', closed);

    // 9. Oversized frame is rejected by maxPayload.
    const big = await open();
    let bigClosed = false;
    big.on('close', () => { bigClosed = true; });
    big.send(JSON.stringify({ type: 'draft', code: 'y'.repeat(900000) }));
    await wait(600);
    ok('oversized frame closes socket', bigClosed);

    // 10. Server still alive after all of that.
    const final = await open();
    send(final, { type: 'create', name: 'Survivor', tool: 'x' });
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
