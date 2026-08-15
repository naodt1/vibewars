/**
 * End-to-end lifecycle test: 4 real websocket clients against a live server.
 * Run:  node e2e-test.js      (server must NOT already be running on TEST_PORT)
 */

const { spawn } = require('child_process');
const WebSocket = require('ws');

const TEST_PORT = 4399;
const URL = `ws://localhost:${TEST_PORT}`;

let failures = 0;
function check(label, cond, extra) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  -> ' + extra : ''}`);
  if (!cond) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(name, tool) {
    this.name = name;
    this.tool = tool;
    this.state = null;
    this.errors = [];
  }
  connect() {
    return new Promise((resolve) => {
      this.ws = new WebSocket(URL);
      this.ws.on('open', resolve);
      this.ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'state') this.state = msg;
        if (msg.type === 'joined') this.id = msg.participantId;
        if (msg.type === 'error') this.errors.push(msg.message);
      });
    });
  }
  send(m) {
    this.ws.send(JSON.stringify(m));
  }
  get phase() {
    return this.state?.lobby.phase;
  }
  find(name) {
    return this.state.participants.find((p) => p.name === name);
  }
  async waitFor(pred, ms = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (pred(this)) return true;
      await sleep(50);
    }
    return false;
  }
  /** Wait for an error that arrives *after* this call, not one already in the log. */
  async nextError(ms = 3000) {
    const mark = this.errors.length;
    await this.waitFor((c) => c.errors.length > mark, ms);
    return this.errors[mark] || '(no error received)';
  }
}

async function main() {
  const server = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(TEST_PORT) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  server.stdout.on('data', (d) => process.stdout.write('[server] ' + d));
  await sleep(700);

  const [alice, bob, carol, dave, eve] = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve'].map(
    (n, i) => new Client(n, ['Claude', 'GPT', 'Gemini', 'Grok', 'Cursor'][i])
  );

  // -- 1. create + join ----------------------------------------------------
  await alice.connect();
  alice.send({ type: 'create', lobbyName: 'Test Battle', name: alice.name, tool: alice.tool });
  await alice.waitFor((c) => c.state);
  const lobbyId = alice.state.lobby.id;
  check('lobby created with id', !!lobbyId, lobbyId);
  check('creator is host', alice.state.lobby.hostId === alice.id);

  for (const c of [bob, carol, dave]) {
    await c.connect();
    c.send({ type: 'join', lobbyId, name: c.name, tool: c.tool });
    await c.waitFor((x) => x.state);
  }
  await alice.waitFor((c) => c.state.participants.length === 4);
  check('4 participants visible to host', alice.state.participants.length === 4);
  check('live list shows tools', alice.find('Bob').tool === 'GPT');

  // duplicate name rejected
  await eve.connect();
  eve.send({ type: 'join', lobbyId, name: 'Bob', tool: 'x' });
  await eve.waitFor((c) => c.errors.length);
  check('duplicate name rejected', /already taken/i.test(eve.errors[0]), eve.errors[0]);

  // -- 2. non-host cannot configure / start --------------------------------
  bob.send({ type: 'start' });
  await bob.waitFor((c) => c.errors.length);
  check('non-host cannot start', /only the host/i.test(bob.errors[0]), bob.errors[0]);

  // -- 3. generated challenge + timed start --------------------------------
  let e;
  const p0 = alice.state.lobby.prompt;
  check('lobby is created with a rolled prompt', !!p0 && !!p0.productName && !!p0.task, p0 && p0.productName);
  check('prompt carries a constraints array', Array.isArray(p0.constraints));
  check('prompt reaches guests too', !!dave.state.lobby.prompt.task);
  check('timer defaults to the pool default', alice.state.lobby.durationMinutes === p0.suggestedMinutes);

  bob.send({ type: 'roll_prompt', topic: 'CHAOS' });
  e = await bob.nextError();
  check('non-host cannot roll the prompt', /only the host/i.test(e), e);

  // Rolling within one topic must stay in that topic.
  const seen = new Set();
  for (let i = 0; i < 8; i++) {
    alice.send({ type: 'roll_prompt', topic: 'GAMES' });
    await sleep(40);
    seen.add(alice.state.lobby.prompt.productName);
  }
  check('topic filter is respected', alice.state.lobby.prompt.topic === 'GAMES');
  check('rolling actually varies the brief', seen.size > 1, `${seen.size} distinct briefs in 8 rolls`);
  check(
    'challenge text mirrors the structured prompt',
    alice.state.lobby.challenge.includes(alice.state.lobby.prompt.task)
  );

  alice.send({ type: 'set_minutes', minutes: 0.1 });
  await alice.waitFor((c) => c.state.lobby.durationMinutes === 0.1);
  check('host can override the timer', alice.state.lobby.durationMinutes === 0.1);
  alice.send({ type: 'roll_prompt', topic: 'EASY' });
  await sleep(80);
  check('an overridden timer survives a reroll', alice.state.lobby.durationMinutes === 0.1);

  alice.send({ type: 'start' });
  await alice.waitFor((c) => c.phase === 'active');
  check('phase -> active', alice.phase === 'active');
  check('timer window ~6s', Math.abs(alice.state.lobby.endsAt - alice.state.lobby.startedAt - 6000) < 50);
  check('guests see active phase', await carol.waitFor((c) => c.phase === 'active'));

  // -- 4. submissions ------------------------------------------------------
  alice.send({ type: 'submit', code: '<h1>Alice tip calc</h1>' });
  await alice.waitFor((c) => c.find('Alice').submitted);
  check('explicit submit banks remaining time', alice.find('Alice').remainingMsAtSubmit > 4000);

  await sleep(1200);
  bob.send({ type: 'submit', code: '<h1>Bob tip calc</h1>' });
  await bob.waitFor((c) => c.find('Bob').submitted);
  check(
    'later submitter banks less time',
    bob.find('Bob').remainingMsAtSubmit < alice.find('Alice').remainingMsAtSubmit
  );

  bob.send({ type: 'submit', code: 'again' });
  e = await bob.nextError();
  check('double submit rejected', /already submitted/i.test(e), e);

  // Carol has work in progress but never hits submit; Dave types nothing.
  carol.send({ type: 'draft', code: '<h1>Carol WIP</h1>' });
  await sleep(200);

  // -- 5. auto lock at zero -------------------------------------------------
  check('phase -> reveal on timeout', await alice.waitFor((c) => c.phase === 'reveal', 9000));
  check('carol draft auto-submitted', alice.find('Carol').autoSubmitted && !alice.find('Carol').dnf);
  check('carol code preserved', alice.state.participants.find((p) => p.name === 'Carol').code.includes('Carol WIP'));
  check('dave marked DNF', alice.find('Dave').dnf === true);
  check('code hidden before reveal was impossible / visible now', typeof alice.find('Bob').code === 'string');

  // late edits blocked
  dave.send({ type: 'submit', code: 'too late' });
  e = await dave.nextError();
  check('post-timer submit rejected', /closed/i.test(e), e);

  // -- 6. voting -----------------------------------------------------------
  const all = [alice, bob, carol, dave];
  const idOf = (n) => alice.state.participants.find((p) => p.name === n).id;

  alice.send({ type: 'vote', targetId: alice.id, scores: s(5, 5, 5, 5) });
  e = await alice.nextError();
  check('self-vote rejected', /yourself/i.test(e), e);

  bob.send({ type: 'vote', targetId: idOf('Alice'), scores: { requirements: 5, functionality: 5, aesthetic: 5 } });
  e = await bob.nextError();
  check('incomplete ballot rejected', /Rate every criterion/i.test(e), e);

  bob.send({ type: 'vote', targetId: idOf('Alice'), scores: s(9, 1, 1, 1) });
  e = await bob.nextError();
  check('out-of-range star rejected', /Rate every criterion/i.test(e), e);

  // Duplicate ballot on a target this voter already rated, while voting is open.
  bob.send({ type: 'vote', targetId: idOf('Carol'), scores: s(3, 3, 3, 3) });
  await bob.waitFor((c) => c.state.myVotes[idOf('Carol')]);
  check('first ballot recorded for voter', !!bob.state.myVotes[idOf('Carol')]);
  bob.send({ type: 'vote', targetId: idOf('Carol'), scores: s(5, 5, 5, 5) });
  e = await bob.nextError();
  check('double-voting the same target rejected', /already voted/i.test(e), e);
  check('recorded ballot unchanged after duplicate', bob.state.myVotes[idOf('Carol')].requirements === 3);

  // Deterministic ballots so the leaderboard math is checkable by hand.
  // Bob -> Carol is already cast above with the same 3s the table below expects.
  //   Alice gets 5/5/5/5 from Bob, 5/5/5/3 from Carol, 5/5/5/1 from Dave
  //   Bob   gets 4s from everyone
  //   Carol gets 2 from Alice, 3 from Bob (cast above), 2 from Dave
  //   Dave  gets 1s from everyone
  const ballots = {
    Alice: { Bob: s(5, 5, 5, 5), Carol: s(5, 5, 5, 3), Dave: s(5, 5, 5, 1) },
    Bob: { Alice: s(4, 4, 4, 4), Carol: s(4, 4, 4, 4), Dave: s(4, 4, 4, 4) },
    Carol: { Alice: s(2, 2, 2, 2), Dave: s(2, 2, 2, 2) },
    Dave: { Alice: s(1, 1, 1, 1), Bob: s(1, 1, 1, 1), Carol: s(1, 1, 1, 1) },
  };
  for (const [target, byVoter] of Object.entries(ballots)) {
    for (const [voterName, scores] of Object.entries(byVoter)) {
      const voter = all.find((c) => c.name === voterName);
      voter.send({ type: 'vote', targetId: idOf(target), scores });
      await sleep(30);
    }
  }

  await alice.waitFor((c) => c.state.voting.cast === 12);
  check('12 of 12 ballots recorded', alice.state.voting.cast === 12 && alice.state.voting.expected === 12);

  // -- 7. leaderboard -------------------------------------------------------
  check('phase -> results once every ballot is in', await alice.waitFor((c) => c.phase === 'results'));
  const lb = alice.state.leaderboard;
  check('leaderboard order', lb.map((r) => r.name).join(',') === 'Alice,Bob,Carol,Dave', lb.map((r) => r.name).join(','));
  // Alice approach avg = (5+3+1)/3 = 3 -> total 5+5+5+3 = 18
  check('averaged criteria summed correctly', near(lb[0].total, 18) && near(lb[0].averages.approach, 3), `total=${lb[0].total}`);
  check('Bob total 16', near(lb[1].total, 16));
  // Carol: (2 + 3 + 2) / 3 = 2.333 per criterion, x4 criteria
  check('Carol total 9.33', near(lb[2].total, (4 * 7) / 3), String(lb[2].total));
  check('Dave total 4 and DNF', near(lb[3].total, 4) && lb[3].dnf);
  check('voter counts', lb.every((r) => r.voterCount === 3));

  // -- 8. tiebreakers -------------------------------------------------------
  // Same totals, different Requirements Met -> higher requirements wins.
  const tieA = { averages: { requirements: 3, functionality: 5, aesthetic: 4, approach: 4 }, total: 16, remainingMsAtSubmit: 9999 };
  const tieB = { averages: { requirements: 5, functionality: 3, aesthetic: 4, approach: 4 }, total: 16, remainingMsAtSubmit: 1 };
  check('tiebreak 1 = Requirements Met', sortLike([tieA, tieB])[0] === tieB);
  // Fully tied criteria -> more time remaining at submit wins.
  const tieC = { averages: { requirements: 4, functionality: 4, aesthetic: 4, approach: 4 }, total: 16, remainingMsAtSubmit: 500 };
  const tieD = { averages: { requirements: 4, functionality: 4, aesthetic: 4, approach: 4 }, total: 16, remainingMsAtSubmit: 9000 };
  check('tiebreak 2 = more time remaining', sortLike([tieC, tieD])[0] === tieD);

  // -- 8b. reset + second round --------------------------------------------
  check('round counter is 1', alice.state.lobby.round === 1);
  alice.send({ type: 'reset' });
  await alice.waitFor((c) => c.phase === 'lobby');
  check(
    'reset clears submissions and DNF flags',
    alice.state.participants.every((p) => !p.submitted && !p.dnf && !p.autoSubmitted)
  );
  check('reset clears votes', alice.state.voting.cast === 0);

  alice.send({ type: 'start' });
  await alice.waitFor((c) => c.phase === 'active');
  check('round counter increments on restart', alice.state.lobby.round === 2);

  bob.send({ type: 'submit', code: '<h1>Bob round two</h1>' });
  await bob.waitFor((c) => c.find('Bob').submitted);
  alice.send({ type: 'force_end' });
  await alice.waitFor((c) => c.phase === 'reveal');
  const bobCode = alice.state.participants.find((p) => p.name === 'Bob').code;
  check('round two submission replaces round one', bobCode === '<h1>Bob round two</h1>', bobCode);
  check('non-submitters are DNF again in round two', alice.find('Alice').dnf === true);

  // -- 9. capacity ----------------------------------------------------------
  const lobby2 = new Client('Host2', 'Claude');
  await lobby2.connect();
  lobby2.send({ type: 'create', lobbyName: 'Full', name: 'Host2', tool: 'Claude' });
  await lobby2.waitFor((c) => c.state);
  const id2 = lobby2.state.lobby.id;
  const extras = [];
  for (let i = 0; i < 5; i++) {
    const c = new Client('P' + i, 'tool');
    await c.connect();
    c.send({ type: 'join', lobbyId: id2, name: c.name, tool: c.tool });
    await c.waitFor((x) => x.state || x.errors.length);
    extras.push(c);
  }
  await lobby2.waitFor((c) => c.state.participants.length === 6);
  check('lobby fills to 6', lobby2.state.participants.length === 6);
  const seventh = new Client('P7', 'tool');
  await seventh.connect();
  seventh.send({ type: 'join', lobbyId: id2, name: 'P7', tool: 'tool' });
  await seventh.waitFor((c) => c.errors.length);
  check('7th participant rejected', /full/i.test(seventh.errors[0]), seventh.errors[0]);

  const under = new Client('Solo', 'tool');
  await under.connect();
  under.send({ type: 'create', lobbyName: 'Solo', name: 'Solo', tool: 'tool' });
  await under.waitFor((c) => c.state);
  under.send({ type: 'start' });
  await under.waitFor((c) => c.errors.length);
  check('start blocked below 4 without override', /Need 4 participants/.test(under.errors[0]), under.errors[0]);
  under.send({ type: 'start', allowUnderMin: true });
  check('override starts anyway', await under.waitFor((c) => c.phase === 'active'));

  // -- 10. fake players ------------------------------------------------------
  const solo = new Client('Solo2', 'Claude Opus 5');
  await solo.connect();
  solo.send({ type: 'create', lobbyName: 'Bot test', name: 'Solo2', tool: 'Claude Opus 5' });
  await solo.waitFor((c) => c.state);

  const guest = new Client('Guest', 'tool');
  await guest.connect();
  guest.send({ type: 'join', lobbyId: solo.state.lobby.id, name: 'Guest', tool: 'tool' });
  await guest.waitFor((c) => c.state);
  guest.send({ type: 'add_bot' });
  e = await guest.nextError();
  check('non-host cannot add fake players', /only the host/i.test(e), e);
  guest.send({ type: 'leave' });
  await solo.waitFor((c) => c.state.participants.length === 1);
  check('leaving removes you from the roster', solo.state.participants.length === 1);

  for (let i = 0; i < 3; i++) {
    solo.send({ type: 'add_bot' });
    await sleep(60);
  }
  await solo.waitFor((c) => c.state.participants.length === 4);
  const bots = solo.state.participants.filter((p) => p.isBot);
  check('three fake players added', bots.length === 3, bots.map((b) => b.name).join(','));
  check('fake players have distinct names', new Set(bots.map((b) => b.name)).size === 3);
  check('fake players fill the minimum roster', solo.state.participants.length === 4);

  solo.send({ type: 'set_minutes', minutes: 0.4 });
  await solo.waitFor((c) => c.state.lobby.durationMinutes === 0.4);
  solo.send({ type: 'start' }); // 4 participants, no override needed
  await solo.waitFor((c) => c.phase === 'active');
  check('round starts with fake players counting toward the minimum', solo.phase === 'active');

  check(
    'fake players submit on their own',
    await solo.waitFor((c) => c.state.participants.filter((p) => p.isBot && p.submitted).length === 3, 15000)
  );

  solo.send({ type: 'submit', code: '<h1>human entry</h1>' });
  check('all submitted -> reveal', await solo.waitFor((c) => c.phase === 'reveal', 15000));
  check('fake player code is present at reveal', solo.state.participants.every((p) => (p.code || '').length > 0));

  check(
    'fake players cast every ballot',
    await solo.waitFor((c) => c.state.voting.cast === 9, 15000),
    String(solo.state.voting.cast)
  );

  const humanTargets = solo.state.participants.filter((p) => !p.isYou);
  for (const t of humanTargets) {
    solo.send({ type: 'vote', targetId: t.id, scores: s(4, 4, 4, 4) });
    await sleep(40);
  }
  check('results after the human votes', await solo.waitFor((c) => c.phase === 'results'));
  check('everyone scored', solo.state.leaderboard.every((r) => r.voterCount === 3));

  solo.send({ type: 'add_bot' });
  e = await solo.nextError();
  check('cannot add fake players mid-battle', /before the battle starts/i.test(e), e);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  server.kill();
  process.exit(failures === 0 ? 0 : 1);
}

function s(requirements, functionality, aesthetic, approach) {
  return { requirements, functionality, aesthetic, approach };
}
function near(a, b) {
  return Math.abs(a - b) < 1e-9;
}
// Mirror of the server's leaderboard comparator, for tiebreaker checks.
function sortLike(rows) {
  return [...rows].sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    if (b.averages.requirements !== a.averages.requirements) {
      return b.averages.requirements - a.averages.requirements;
    }
    return b.remainingMsAtSubmit - a.remainingMsAtSubmit;
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
