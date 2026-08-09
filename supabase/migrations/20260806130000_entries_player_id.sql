-- The anonymous, client-generated player id. Not a Supabase auth user: there
-- are no accounts here. It only lets repeat visits from the same browser be
-- linked together for per-player history.
alter table entries add column if not exists player_id text;
create index if not exists entries_player_idx on entries (player_id);
