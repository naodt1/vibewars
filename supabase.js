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

/** Freeze the finished battle into plain rows before any network call. */
function takeSnapshot(lobby, leaderboard) {
  const p = lobby.prompt || {};
  const byId = new Map([...lobby.participants.values()].map((x) => [x.id, x]));

  const battle = {
    lobby_code: lobby.id,
    lobby_name: lobby.name,
    round: lobby.round,
    topic: p.topic || 'UNKNOWN',
    level: p.level || 0,
    level_name: p.levelName || null,
    context: p.context || '',
    task: p.task || '',
    vibe: p.flavour || null,
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

module.exports = { isEnabled, recordBattle, toolStandings, recentBattles };
