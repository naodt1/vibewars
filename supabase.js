/**
 * Supabase persistence: finished battles only.
 *
 * The live game never touches the network - lobbies, timers and voting all stay
 * in memory. When a battle reaches its leaderboard, one write records what
 * happened so the interesting question ("which model actually wins?") can be
 * answered later. Everything here is best-effort: if the database is missing,
 * misconfigured or down, the game carries on and only logs.
 */

const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
// The service role key bypasses row level security, which is what lets the
// server write while the publishable key stays read-only for everyone else.
// It is secret: it belongs in .env and must never reach the browser.
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

let client = null;
let warned = false;

if (url && key) {
  client = createClient(url, key, { auth: { persistSession: false } });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn(
      'supabase: only a publishable key is set. Reads will work, but row level ' +
        'security will reject writes. Set SUPABASE_SERVICE_ROLE_KEY to record battles.'
    );
  }
} else {
  console.log('supabase: not configured, battles will not be recorded (the game is unaffected)');
}

const isEnabled = () => client !== null;

/**
 * Record a finished battle. Never throws: a database problem must not take the
 * lobby down mid-celebration.
 */
async function recordBattle(lobby, leaderboard) {
  if (!client) return { skipped: true };

  // Snapshot everything up front, synchronously. The host can reset the lobby
  // for another round while these inserts are still in flight, and a reset
  // clears votes and rolls a new prompt - read any of it after an await and you
  // silently archive the next round's state, or no ballots at all.
  const snapshot = takeSnapshot(lobby, leaderboard);

  try {
    const { data: battle, error: battleErr } = await client
      .from('battles')
      .insert(snapshot.battle)
      .select('id')
      .single();
    if (battleErr) throw battleErr;

    const entries = snapshot.entries.map((e) => ({ ...e, battle_id: battle.id }));
    const ballots = snapshot.ballots.map((b) => ({ ...b, battle_id: battle.id }));

    const [entryRes, ballotRes] = await Promise.all([
      client.from('entries').insert(entries),
      ballots.length ? client.from('ballots').insert(ballots) : Promise.resolve({ error: null }),
    ]);
    if (entryRes.error) throw entryRes.error;
    if (ballotRes.error) throw ballotRes.error;

    console.log(
      `supabase: recorded battle ${snapshot.battle.lobby_code} round ${snapshot.battle.round} ` +
        `(${entries.length} entries, ${ballots.length} ballots)`
    );
    return { id: battle.id };
  } catch (err) {
    console.error('supabase: failed to record battle -', err.message || err);
    return { error: err };
  }
}

/* What a finished round was worth, worked out from the result the server
 * actually saw. This deliberately mirrors the client's own award rules for the
 * parts the archive can verify - showing up, shipping, and where you placed -
 * and leaves out the parts it cannot, like daily streaks, which live in one
 * browser and are nobody else's business. Unlike the client's copy, nothing
 * here is self-reported, so it is safe to rank strangers by. */
function xpForResult(rank, dnf, autoSubmitted) {
  let xp = 20;                                   // showing up and seeing it through
  if (!dnf) xp += 30;                            // shipped something
  if (rank === 1) xp += 100;
  else if (rank === 2 || rank === 3) xp += 50;
  if (!dnf && !autoSubmitted) xp += 10;          // in before the buzzer
  return xp;
}

/** Freeze the finished battle into plain rows before any network call. */
function takeSnapshot(lobby, leaderboard) {
  const p = lobby.prompt || {};
  const byId = new Map([...lobby.participants.values()].map((x) => [x.id, x]));

  const battle = {
    lobby_code: lobby.id,
    lobby_name: lobby.name,
    round: lobby.round,
    topic: p.topic || 'UNKNOWN',
    // The difficulty axis is gone: `level` stays 0 to satisfy the existing
    // not-null column, and `level_name`/`context` are repurposed to carry
    // the per-prompt challenge label and product name instead.
    level: 0,
    level_name: p.challenge || null,
    context: p.productName || '',
    task: p.task || '',
    vibe: null,
    constraints: p.constraints || [],
    duration_min: lobby.durationMinutes,
    player_count: lobby.participants.size,
  };

  const entries = leaderboard.map((row, i) => {
    const player = byId.get(row.participantId);
    return {
      player_name: row.name,
      player_id: player?.playerId || null,
      tool: row.tool,
      is_bot: !!player?.isBot,
      key_verified: !!player?.verified,
      dnf: row.dnf,
      auto_submitted: !!player?.autoSubmitted,
      ms_remaining: row.remainingMsAtSubmit,
      code: player?.code || '',
      rank: i + 1,
      total: Number(row.total.toFixed(4)),
      avg_requirements: Number(row.averages.requirements.toFixed(4)),
      avg_functionality: Number(row.averages.functionality.toFixed(4)),
      avg_aesthetic: Number(row.averages.aesthetic.toFixed(4)),
      avg_approach: Number(row.averages.approach.toFixed(4)),
      voter_count: row.voterCount,
      xp: xpForResult(i + 1, row.dnf, !!player?.autoSubmitted),
      // Self-reported by the player's client and already clamped server side;
      // a player on their own key never routes usage through us at all.
      tokens_in: player?.tokensIn || 0,
      tokens_out: player?.tokensOut || 0,
    };
  });

  const ballots = [];
  for (const [voterId, byTarget] of lobby.votes) {
    const voter = byId.get(voterId);
    if (!voter) continue;
    for (const [targetId, scores] of byTarget) {
      const target = byId.get(targetId);
      if (!target) continue;
      ballots.push({
        voter_name: voter.name,
        target_name: target.name,
        requirements: scores.requirements,
        functionality: scores.functionality,
        aesthetic: scores.aesthetic,
        approach: scores.approach,
      });
    }
  }

  return { battle, entries, ballots };
}

/** Aggregate standings by declared model, for the stats endpoint. */
async function toolStandings() {
  if (!client) return null;
  const { data, error } = await client.from('tool_standings').select('*').limit(50);
  if (error) {
    console.error('supabase: standings query failed -', error.message);
    return null;
  }
  return data;
}

/**
 * Per-player standings, aggregated in this process rather than in a view.
 *
 * The archive stores one row per player per battle, so everything the board
 * needs is already there - it just has to be grouped by player. Doing it here
 * rather than as a SQL view means it works against the existing schema with
 * no migration, which matters because the deployed archive is the one thing
 * here that cannot be changed from a code push alone.
 *
 * Stand-ins are excluded: a leaderboard of people should not rank the bots.
 */
async function playerStandings() {
  if (!client) return null;
  const { data, error } = await client
    .from('entries')
    .select('player_name, rank, total, avg_aesthetic, tokens_in, tokens_out, xp')
    .eq('is_bot', false)
    .limit(5000);
  if (error) {
    // tokens_in/xp are newer columns; an older archive will not have them, and
    // that should degrade to "no token data" rather than killing the board.
    console.error('supabase: player standings query failed -', error.message);
    return null;
  }

  const byName = new Map();
  for (const row of data || []) {
    const name = row.player_name;
    if (!name) continue;
    const p = byName.get(name) || {
      name, battles: 0, wins: 0, totalScore: 0, aestheticScore: 0, tokens: 0, xp: 0,
    };
    p.battles += 1;
    if (Number(row.rank) === 1) p.wins += 1;
    p.totalScore += Number(row.total) || 0;
    p.aestheticScore += Number(row.avg_aesthetic) || 0;
    p.tokens += (Number(row.tokens_in) || 0) + (Number(row.tokens_out) || 0);
    p.xp += Number(row.xp) || 0;
    byName.set(name, p);
  }

  return [...byName.values()].map((p) => ({
    name: p.name,
    battles: p.battles,
    wins: p.wins,
    xp: p.xp,
    tokens: p.tokens,
    avgTotal: p.battles ? p.totalScore / p.battles : 0,
    avgAesthetic: p.battles ? p.aestheticScore / p.battles : 0,
  }));
}

/** The most recent finished battles, newest first. */
async function recentBattles(limit = 10) {
  if (!client) return null;
  const { data, error } = await client
    .from('battles')
    .select('lobby_name, topic, level_name, task, player_count, finished_at')
    .order('finished_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('supabase: recent battles query failed -', error.message);
    return null;
  }
  return data;
}

/* ------------------------------------------------------ players & friends --
 * The player_id is the credential: whoever presents it is that player. Every
 * function here takes it as the caller's identity and never accepts a
 * username in its place, so knowing somebody's display name is never enough
 * to act as them. */

const MAX_USERNAME = 20;

/** Trim, collapse whitespace, and cap. Returns null if nothing usable is left. */
function cleanUsername(raw) {
  const v = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, MAX_USERNAME);
  return v.length >= 2 ? v : null;
}

/** Register or update this player's row. Returns { player } or { error }. */
async function upsertPlayer(playerId, username, avatar) {
  if (!client) return { error: 'offline' };
  const name = cleanUsername(username);
  if (!name) return { error: 'too_short' };

  const row = { player_id: playerId, username: name, last_seen: new Date().toISOString() };
  if (Number.isInteger(avatar)) row.avatar = avatar;

  const { data, error } = await client
    .from('players')
    .upsert(row, { onConflict: 'player_id' })
    .select()
    .single();

  if (error) {
    // 23505 is the case-insensitive username index. Report it as "taken"
    // rather than a database error, since that is what it means to a player.
    if (error.code === '23505') return { error: 'taken' };
    console.error('supabase: upsertPlayer failed -', error.message);
    return { error: 'failed' };
  }
  return { player: data };
}

/** Is this name free? Ignores the caller's own row so re-saving is not "taken". */
async function usernameAvailable(username, playerId) {
  if (!client) return { error: 'offline' };
  const name = cleanUsername(username);
  if (!name) return { available: false, reason: 'too_short' };
  const { data, error } = await client
    .from('players')
    .select('player_id')
    .ilike('username', name)
    .limit(1);
  if (error) return { error: 'failed' };
  const hit = (data || [])[0];
  return { available: !hit || hit.player_id === playerId, name };
}

/** Prefix search, for the add-friend box. Never returns player_ids. */
async function searchPlayers(q, selfId, limit = 10) {
  if (!client) return null;
  const term = String(q || '').trim().slice(0, MAX_USERNAME);
  if (term.length < 2) return [];
  const { data, error } = await client
    .from('players')
    .select('player_id, username, avatar')
    .ilike('username', term + '%')
    .limit(limit + 1);
  if (error) {
    console.error('supabase: searchPlayers failed -', error.message);
    return null;
  }
  return (data || []).filter((p) => p.player_id !== selfId).slice(0, limit);
}

/* Friendship rows are stored with the ids ordered, so the pair is one row
 * rather than two that can disagree. */
const pairKey = (x, y) => (x < y ? { a: x, b: y } : { a: y, b: x });

async function sendFriendRequest(fromId, toUsername) {
  if (!client) return { error: 'offline' };
  const name = cleanUsername(toUsername);
  if (!name) return { error: 'not_found' };

  const { data: target } = await client
    .from('players').select('player_id, username').ilike('username', name).limit(1);
  const to = (target || [])[0];
  if (!to) return { error: 'not_found' };
  if (to.player_id === fromId) return { error: 'self' };

  const { a, b } = pairKey(fromId, to.player_id);
  const { data: already } = await client
    .from('friendships').select('a').eq('a', a).eq('b', b).limit(1);
  if ((already || []).length) return { error: 'already_friends' };

  // If they already asked us, treat this as accepting rather than opening a
  // second request pointing the other way, which would deadlock the pair.
  const { data: incoming } = await client
    .from('friend_requests').select('id')
    .eq('from_id', to.player_id).eq('to_id', fromId).eq('status', 'pending').limit(1);
  if ((incoming || []).length) {
    return respondToRequest(fromId, incoming[0].id, true);
  }

  const { error } = await client
    .from('friend_requests')
    .insert({ from_id: fromId, to_id: to.player_id });
  if (error) {
    if (error.code === '23505') return { error: 'already_sent' };
    console.error('supabase: sendFriendRequest failed -', error.message);
    return { error: 'failed' };
  }
  return { sent: true, to: to.username };
}

/** Accept or decline. Only the recipient may answer, checked server-side. */
async function respondToRequest(playerId, requestId, accept) {
  if (!client) return { error: 'offline' };
  const { data: reqs } = await client
    .from('friend_requests').select('*').eq('id', requestId).limit(1);
  const req = (reqs || [])[0];
  if (!req) return { error: 'not_found' };
  if (req.to_id !== playerId) return { error: 'not_yours' };
  if (req.status !== 'pending') return { error: 'already_answered' };

  await client
    .from('friend_requests')
    .update({ status: accept ? 'accepted' : 'declined', responded_at: new Date().toISOString() })
    .eq('id', requestId);

  if (accept) {
    const { a, b } = pairKey(req.from_id, req.to_id);
    // Ignore a duplicate here: both sides accepting at once is a race, not an
    // error, and the pair is already friends either way.
    await client.from('friendships').upsert({ a, b }, { onConflict: 'a,b' });
  }
  return { ok: true, accepted: !!accept };
}

async function removeFriend(playerId, otherId) {
  if (!client) return { error: 'offline' };
  const { a, b } = pairKey(playerId, otherId);
  await client.from('friendships').delete().eq('a', a).eq('b', b);
  return { ok: true };
}

/** Everything the friends panel needs in one round trip. */
async function friendState(playerId) {
  if (!client) return null;
  const [{ data: links }, { data: incoming }, { data: outgoing }] = await Promise.all([
    client.from('friendships').select('a, b').or(`a.eq.${playerId},b.eq.${playerId}`),
    client.from('friend_requests').select('id, from_id, created_at').eq('to_id', playerId).eq('status', 'pending'),
    client.from('friend_requests').select('id, to_id, created_at').eq('from_id', playerId).eq('status', 'pending'),
  ]);

  const friendIds = (links || []).map((l) => (l.a === playerId ? l.b : l.a));
  const ids = [...new Set([
    ...friendIds,
    ...(incoming || []).map((r) => r.from_id),
    ...(outgoing || []).map((r) => r.to_id),
  ])];

  let byId = {};
  if (ids.length) {
    const { data: people } = await client
      .from('players').select('player_id, username, avatar').in('player_id', ids);
    for (const p of people || []) byId[p.player_id] = p;
  }
  const named = (id) => byId[id] || { player_id: id, username: 'Unknown', avatar: 0 };

  return {
    friends: friendIds.map(named),
    // Incoming requests are what the notification dot counts.
    incoming: (incoming || []).map((r) => ({ id: r.id, from: named(r.from_id), at: r.created_at })),
    outgoing: (outgoing || []).map((r) => ({ id: r.id, to: named(r.to_id), at: r.created_at })),
  };
}

module.exports = {
  isEnabled, recordBattle, toolStandings, recentBattles, playerStandings,
  upsertPlayer, usernameAvailable, searchPlayers,
  sendFriendRequest, respondToRequest, removeFriend, friendState,
};
