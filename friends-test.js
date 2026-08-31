/* Players and friends: the username registry, the request/accept lifecycle,
 * and the two properties that matter most about it.
 *
 *  1. The player_id in a POST body is a bearer credential. Presenting someone
 *     else's username must never be enough to act as them, and a search must
 *     not hand ids back to whoever asks.
 *  2. The whole feature is optional. With no Supabase configured every route
 *     answers 503 and the game itself is untouched - nobody is locked out of
 *     the gate because the registry is missing.
 *
 * The first group needs a real database, so it is skipped (not failed) when
 * SUPABASE_URL is absent. The second group is the one that must always run,
 * because "the archive is off" is the default for anyone who clones this. */
const { spawn } = require('child_process');

let pass = 0, fail = 0, skip = 0;
const ok = (name, cond, extra = '') => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  -> ' + extra : ''));
  cond ? pass++ : fail++;
};
const skipped = (name, why) => { console.log('SKIP  ' + name + '  -> ' + why); skip++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function bootServer(port, env) {
  const srv = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', () => {});
  srv.stderr.on('data', (d) => process.stderr.write('[srv:' + port + '] ' + d));
  return srv;
}

const post = (port, path, body) =>
  fetch(`http://localhost:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

/* Ids are namespaced so a failed run leaves rows that are obviously test data
 * and can be swept by prefix rather than guessed at. */
const stamp = Date.now().toString(36);
const ID = (who) => `test-${who}-${stamp}`;
const NAME = (who) => `t_${who}_${stamp}`.slice(0, 20);

async function sweep() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  // friendships and friend_requests are ON DELETE CASCADE from players.
  await fetch(`${url}/rest/v1/players?player_id=like.test-*${encodeURIComponent('-' + stamp)}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
  }).catch(() => {});
}

(async () => {
  /* ------------------------------------------------- registry switched off --
   * No SUPABASE_URL at all: the routes must say "unavailable" rather than
   * crash, and nothing about the rest of the server may change. */
  const PORT_OFF = 4501;
  const srvOff = bootServer(PORT_OFF, { SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' });
  await wait(900);

  const cfg = await fetch(`http://localhost:${PORT_OFF}/api/config`).then((r) => r.json());
  ok('config reports friends unavailable', cfg.friends === false, String(cfg.friends));
  ok('config still reports avatars', Array.isArray(cfg.avatars));

  for (const path of ['/api/player', '/api/player/available', '/api/players/search',
                      '/api/friends', '/api/friends/request', '/api/friends/respond']) {
    const r = await post(PORT_OFF, path, { playerId: ID('off'), username: 'anyone', q: 'an' });
    ok(`${path} answers 503 with the registry off`, r.status === 503, String(r.status));
  }

  const lobbies = await fetch(`http://localhost:${PORT_OFF}/api/lobbies`).then((r) => r.status);
  ok('the game itself is unaffected', lobbies === 200, String(lobbies));
  srvOff.kill();
  await wait(300);

  /* ------------------------------------------------------ registry running -- */
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    skipped('registry behaviour', 'SUPABASE_URL / service role key not set');
    console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
    process.exit(fail ? 1 : 0);
  }

  const PORT = 4502;
  const srv = bootServer(PORT, {});
  await wait(1200);

  const alice = ID('alice'), bob = ID('bob'), mallory = ID('mallory');
  const aliceName = NAME('alice'), bobName = NAME('bob');

  try {
    let r = await post(PORT, '/api/player', { playerId: alice, username: aliceName });
    ok('a player can claim a name', r.status === 200, String(r.status));

    r = await post(PORT, '/api/player', { playerId: bob, username: aliceName.toUpperCase() });
    ok('names are unique regardless of case', r.status === 409 && r.body.error === 'taken',
       r.status + ' ' + JSON.stringify(r.body));

    r = await post(PORT, '/api/player', { playerId: bob, username: bobName });
    ok('a second player claims their own name', r.status === 200);

    r = await post(PORT, '/api/player', { playerId: '', username: NAME('nobody') });
    ok('a missing player id is refused', r.status === 400, String(r.status));

    // Renaming is the same call, and must free the old name for anyone else.
    const aliceNew = NAME('alice2');
    r = await post(PORT, '/api/player', { playerId: alice, username: aliceNew });
    ok('a player can rename themselves', r.status === 200 && r.body.player.username === aliceNew);
    r = await post(PORT, '/api/player/available', { playerId: bob, username: aliceName });
    ok('the abandoned name is free again', r.body.available === true);
    r = await post(PORT, '/api/player/available', { playerId: alice, username: aliceNew });
    ok('a player still holds their own name', r.body.available === true);
    r = await post(PORT, '/api/player/available', { playerId: bob, username: aliceNew });
    ok('someone else sees that name as taken', r.body.available === false);

    // ---- search ----
    r = await post(PORT, '/api/players/search', { playerId: alice, q: bobName.slice(0, 6) });
    ok('search finds a player by prefix', r.body.results.some((p) => p.username === bobName));
    ok('search never returns a player id', !JSON.stringify(r.body).includes(bob));
    r = await post(PORT, '/api/players/search', { playerId: alice, q: aliceNew });
    ok('search excludes the searcher', !r.body.results.some((p) => p.username === aliceNew));

    // ---- requests ----
    r = await post(PORT, '/api/friends/request', { playerId: alice, username: bobName });
    ok('a request can be sent', r.status === 200 && r.body.sent === true);

    r = await post(PORT, '/api/friends/request', { playerId: alice, username: bobName });
    ok('the same request cannot be sent twice', r.status === 409, r.body.error);

    r = await post(PORT, '/api/friends/request', { playerId: alice, username: aliceNew });
    ok('nobody can befriend themselves', r.status === 409 && r.body.error === 'self');

    r = await post(PORT, '/api/friends/request', { playerId: alice, username: NAME('ghost') });
    ok('an unknown username is a 404', r.status === 404);

    r = await post(PORT, '/api/friends', { playerId: bob });
    const reqId = r.body.incoming[0] && r.body.incoming[0].id;
    ok('the recipient sees the request', r.body.incoming.length === 1);
    ok('the sender is named, not identified', !JSON.stringify(r.body).includes(alice));

    // The credential check: a third party who knows the request id must not be
    // able to answer it, and neither may the person who sent it.
    r = await post(PORT, '/api/friends/respond', { playerId: mallory, requestId: reqId, accept: true });
    ok('a stranger cannot answer a request', r.status === 403, String(r.status));
    r = await post(PORT, '/api/friends/respond', { playerId: alice, requestId: reqId, accept: true });
    ok('the sender cannot answer their own request', r.status === 403, String(r.status));

    r = await post(PORT, '/api/friends/respond', { playerId: bob, requestId: reqId, accept: true });
    ok('the recipient can accept', r.status === 200 && r.body.accepted === true);

    const aView = await post(PORT, '/api/friends', { playerId: alice });
    const bView = await post(PORT, '/api/friends', { playerId: bob });
    ok('the friendship is mutual',
       aView.body.friends.length === 1 && bView.body.friends.length === 1,
       aView.body.friends[0].username + ' <-> ' + bView.body.friends[0].username);
    ok('the inbox is cleared once answered', bView.body.incoming.length === 0);
    ok('presence is reported', typeof aView.body.friends[0].online === 'boolean');
    ok('nobody is playing yet', aView.body.friends[0].online === false);

    // A rename must not break an existing friendship: the link is on the id.
    const aliceFinal = NAME('alice3');
    await post(PORT, '/api/player', { playerId: alice, username: aliceFinal });
    const after = await post(PORT, '/api/friends', { playerId: bob });
    ok('a friendship survives a rename',
       after.body.friends.length === 1 && after.body.friends[0].username === aliceFinal,
       after.body.friends[0] && after.body.friends[0].username);
  } finally {
    srv.kill();
    await wait(200);
    await sweep();
  }

  console.log(`\n${pass} passed, ${fail} failed${skip ? ', ' + skip + ' skipped' : ''}`);
  process.exit(fail ? 1 : 0);
})();
