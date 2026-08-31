-- Players, friends and friend requests.
--
-- Identity model: the browser's anonymous player_id is the credential. It is a
-- UUID minted client-side and never shown to anyone else, so it behaves like
-- the lobby resume token already does - whoever holds it is that player. There
-- is no password, which is a deliberate trade for the no-accounts promise, and
-- it has two consequences worth stating plainly in the UI: clearing site data
-- loses the account for good, and a leaked player_id is a full takeover.
--
-- Writes go through the service role only (see RLS at the bottom), so the
-- server is the single place that checks a player_id before acting on it.

create table if not exists players (
  player_id   text primary key,
  username    text not null,
  avatar      int  not null default 0,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

-- Case-insensitive uniqueness: "Naod" and "naod" are the same name, so the
-- index does the enforcing rather than a racy check-then-insert in the server.
create unique index if not exists players_username_lower_idx
  on players (lower(username));

-- Search by prefix wants the lowered column too.
create index if not exists players_username_search_idx
  on players (lower(username) text_pattern_ops);

/* Friendship is symmetric, so it is stored once with the ids ordered rather
   than twice. The check constraint is what stops the second copy sneaking in
   and stops anyone befriending themselves. */
create table if not exists friendships (
  a          text not null references players(player_id) on delete cascade,
  b          text not null references players(player_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (a, b),
  constraint friendship_ordered check (a < b)
);

create table if not exists friend_requests (
  id         uuid primary key default gen_random_uuid(),
  from_id    text not null references players(player_id) on delete cascade,
  to_id      text not null references players(player_id) on delete cascade,
  status     text not null default 'pending'
             check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint no_self_request check (from_id <> to_id)
);

-- One live request per direction. Partial, so a declined request can be sent
-- again later without tripping over the old row.
create unique index if not exists friend_requests_pending_idx
  on friend_requests (from_id, to_id) where status = 'pending';

create index if not exists friend_requests_inbox_idx
  on friend_requests (to_id) where status = 'pending';

-- Row level security ---------------------------------------------------------
-- No policies at all: every table is server-only. The publishable key can read
-- battle history, but nothing about players is world-readable - a public
-- SELECT here would hand out the whole username list and the social graph.
-- The service role bypasses RLS, so only the game server can touch these.
alter table players         enable row level security;
alter table friendships     enable row level security;
alter table friend_requests enable row level security;
