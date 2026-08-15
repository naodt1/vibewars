/* House API key: /api/config discovery, and the /api/sandbox/complete proxy's
 * auth, phase, size and round-cap gates. The upstream call itself uses a
 * fabricated key against the real provider host (never a genuine credential),
 * so it always fails upstream - that is fine here, since the point is to
 * prove every gate in front of it works, not to complete a real generation. */
const { spawn } = require('child_process');
const WebSocket = require('ws');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  -> ' + extra : ''));
  cond ? pass++ : fail++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function bootServer(port, env) {
  const srv = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', () => {});
  let stderr = '';
  srv.stderr.on('data', (d) => { stderr += d; process.stderr.write('[srv:' + port + '] ' + d); });
  srv.getStderr = () => stderr;
  return srv;
}

function open(port) {
  const ws = new WebSocket(`ws://localhost:${port}`);
  ws.inbox = [];
  ws.on('message', (d) => { try { ws.inbox.push(JSON.parse(d.toString())); } catch (_) {} });
  ws.on('error', () => {});
  return new Promise((res, rej) => {
    ws.on('open', () => res(ws));
    ws.on('error', rej);
  });
}
const send = (ws, o) => ws.send(JSON.stringify(o));
const last = (ws, type) => [...ws.inbox].reverse().find((m) => m.type === type);

(async () => {
  // ------------------------------------------------------- no house keys --
  const PORT_A = 4499;
  const srvA = bootServer(PORT_A, {
    HOUSE_OPENAI_API_KEY: '', HOUSE_OPENAI_MODEL: '',
    HOUSE_ANTHROPIC_API_KEY: '', HOUSE_ANTHROPIC_MODEL: '',
    HOUSE_GOOGLE_API_KEY: '', HOUSE_GOOGLE_MODEL: '',
    HOUSE_XAI_API_KEY: '', HOUSE_XAI_MODEL: '',
  });
  await wait(900);

  try {
    const cfgA = await (await fetch(`http://localhost:${PORT_A}/api/config`)).json();
    ok('no env vars: every provider disabled', Object.values(cfgA.house).every((v) => v === false), JSON.stringify(cfgA.house));
    ok('config exposes the per-round cap', typeof cfgA.houseCallsPerRound === 'number', String(cfgA.houseCallsPerRound));

    // A request against a disabled provider is refused before it touches
    // anything else - no lobby needed to prove that.
    const refused = await fetch(`http://localhost:${PORT_A}/api/sandbox/complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lobbyId: 'XXXXXX', participantId: 'x', token: 'x', provider: 'anthropic', messages: [] }),
    });
    ok('disabled provider rejected', refused.status === 400, String(refused.status));
  } catch (e) {
    console.error('SERVER A TEST ERROR', e);
    fail++;
  }
  srvA.kill();

  // --------------------------------------------- key set, model missing --
  const PORT_B = 4498;
  const srvB = bootServer(PORT_B, {
    HOUSE_OPENAI_API_KEY: 'sk-test-not-real', HOUSE_OPENAI_MODEL: '',
  });
  await wait(900);
  try {
    const cfgB = await (await fetch(`http://localhost:${PORT_B}/api/config`)).json();
    ok('key without model stays disabled', cfgB.house.openai === false, JSON.stringify(cfgB.house));
    ok('startup warns about the half-configured provider', /HOUSE_OPENAI_MODEL is not/.test(srvB.getStderr()));
  } catch (e) {
    console.error('SERVER B TEST ERROR', e);
    fail++;
  }
  srvB.kill();

  // -------------------------------------------------- fully configured --
  const PORT_C = 4497;
  const srvC = bootServer(PORT_C, {
    HOUSE_ANTHROPIC_API_KEY: 'sk-ant-test-not-real', // fabricated, not a real credential
    HOUSE_ANTHROPIC_MODEL: 'claude-haiku-4-5-20251001',
  });
  await wait(900);

  try {
    const cfgC = await (await fetch(`http://localhost:${PORT_C}/api/config`)).json();
    ok('key + model: provider enabled', cfgC.house.anthropic === true, JSON.stringify(cfgC.house));
    ok('other providers stay off', cfgC.house.openai === false && cfgC.house.google === false && cfgC.house.xai === false);

    const post = (body) =>
      fetch(`http://localhost:${PORT_C}/api/sandbox/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });

    // Unknown lobby.
    const noLobby = await post({ lobbyId: 'ZZZZZZ', participantId: 'x', token: 'x', provider: 'anthropic', messages: [{ role: 'user', content: 'hi' }] });
    ok('unknown lobby rejected', noLobby.status === 404, String(noLobby.status));

    // A real solo lobby to test against - one participant is enough to start.
    const ws = await open(PORT_C);
    send(ws, { type: 'solo', name: 'Tester', tool: 'Claude Opus 5' });
    await wait(300);
    const joined = last(ws, 'joined');
    const lobbyId = joined.lobbyId, participantId = joined.participantId, token = joined.token;
    ok('solo lobby created', !!lobbyId);

    // Right lobby, wrong token.
    const badToken = await post({ lobbyId, participantId, token: 'not-the-real-token', provider: 'anthropic', messages: [{ role: 'user', content: 'hi' }] });
    ok('bad token rejected', badToken.status === 403, String(badToken.status));

    // Right everything, but the round has not started - still in 'lobby' phase.
    const notActive = await post({ lobbyId, participantId, token, provider: 'anthropic', messages: [{ role: 'user', content: 'hi' }] });
    ok('inactive phase rejected', notActive.status === 409, String(notActive.status));

    send(ws, { type: 'set_minutes', minutes: 3 });
    await wait(150);
    send(ws, { type: 'start' });
    await wait(400);
    ok('round is active', last(ws, 'state').lobby.phase === 'active');

    // Oversized single prompt.
    const tooLong = await post({ lobbyId, participantId, token, provider: 'anthropic', messages: [{ role: 'user', content: 'x'.repeat(20000) }] });
    ok('oversized prompt rejected', tooLong.status === 400, String(tooLong.status));

    // No messages at all.
    const empty = await post({ lobbyId, participantId, token, provider: 'anthropic', messages: [] });
    ok('empty message list rejected', empty.status === 400, String(empty.status));

    // A legitimate request: reaches the real gate, then fails upstream on the
    // fabricated key - proves the whole pipeline runs, without needing a
    // genuine credential or a successful generation.
    const real = await post({ lobbyId, participantId, token, provider: 'anthropic', messages: [{ role: 'user', content: 'Build a button.' }] });
    const realBody = await real.json().catch(() => ({}));
    ok('legitimate request reaches upstream and fails cleanly', real.status === 502, real.status + ' ' + JSON.stringify(realBody));

    // Spend the rest of the round's budget, then confirm the cap bites.
    for (let i = 0; i < 5; i++) {
      await post({ lobbyId, participantId, token, provider: 'anthropic', messages: [{ role: 'user', content: 'again' }] });
    }
    const overCap = await post({ lobbyId, participantId, token, provider: 'anthropic', messages: [{ role: 'user', content: 'one more' }] });
    const overCapBody = await overCap.json().catch(() => ({}));
    ok('round cap enforced after 6 attempts', overCap.status === 429, overCap.status + ' ' + JSON.stringify(overCapBody));

    // Server survives all of that.
    const finalCfg = await fetch(`http://localhost:${PORT_C}/api/config`);
    ok('server still serving', finalCfg.ok);
  } catch (e) {
    console.error('SERVER C TEST ERROR', e);
    fail++;
  }
  srvC.kill();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
