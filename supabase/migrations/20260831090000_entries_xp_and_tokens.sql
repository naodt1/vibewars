-- Columns the standings query has always read but nothing ever created.
--
-- playerStandings() selects entries.xp, entries.tokens_in and entries.tokens_out.
-- None of them existed, so every call failed with 42703 (undefined column),
-- returned null, and the player leaderboard silently fell back to the founding
-- roster alone - real archived battles never appeared on it at all.
--
-- All three default to 0 so existing rows stay valid: battles archived before
-- this migration simply contributed no XP or tokens, which is true.

alter table entries add column if not exists xp integer not null default 0;
alter table entries add column if not exists tokens_in integer not null default 0;
alter table entries add column if not exists tokens_out integer not null default 0;

-- The board ranks by summed xp and tokens per player, always filtering out the
-- stand-in players first.
create index if not exists entries_player_standings_idx
  on entries (is_bot, player_name);
