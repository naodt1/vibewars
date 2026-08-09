-- vibewars battle history
--
-- Apply this to the vibewars Supabase project (lumzzjavztuitgxuwdec) via the
-- SQL editor, or:
--   supabase link --project-ref lumzzjavztuitgxuwdec
--   supabase db push
--
-- Live lobbies stay in memory in the Node process. Only finished battles land
-- here, so the game keeps working with no database attached.

create table if not exists battles (
  id            uuid primary key default gen_random_uuid(),
  lobby_code    text        not null,
  lobby_name    text,
  round         int         not null,
  topic         text        not null,
  level         int         not null,
  level_name    text,
  context       text        not null,
  task          text        not null,
  vibe          text,
  constraints   text[]      not null default '{}',
  duration_min  numeric     not null,
  player_count  int         not null,
  finished_at   timestamptz not null default now()
);

create table if not exists entries (
  id                 uuid primary key default gen_random_uuid(),
  battle_id          uuid not null references battles(id) on delete cascade,
  player_name        text not null,
  tool               text not null,       -- the declared model, the interesting column
  is_bot             boolean not null default false,
  dnf                boolean not null default false,
  auto_submitted     boolean not null default false,
  ms_remaining       int  not null default 0,
  code               text,
  rank               int  not null,
  total              numeric not null,
  avg_requirements   numeric not null,
  avg_functionality  numeric not null,
  avg_aesthetic      numeric not null,
  avg_approach       numeric not null,
  voter_count        int  not null
);

-- One row per ballot, so scoring can be recomputed or audited later.
create table if not exists ballots (
  id           uuid primary key default gen_random_uuid(),
  battle_id    uuid not null references battles(id) on delete cascade,
  voter_name   text not null,
  target_name  text not null,
  requirements int  not null check (requirements between 1 and 5),
  functionality int not null check (functionality between 1 and 5),
  aesthetic    int  not null check (aesthetic between 1 and 5),
  approach     int  not null check (approach between 1 and 5)
);

create index if not exists entries_battle_idx on entries (battle_id);
create index if not exists entries_tool_idx   on entries (tool);
create index if not exists ballots_battle_idx on ballots (battle_id);
create index if not exists battles_finished_idx on battles (finished_at desc);

-- Row level security -------------------------------------------------------
-- Reads are public so the stats page can use the publishable key. Writes are
-- left with no policy at all, which means only the service role (which bypasses
-- RLS) can insert. Without this, anyone holding the publishable key could
-- stuff the leaderboard.
alter table battles enable row level security;
alter table entries enable row level security;
alter table ballots enable row level security;

drop policy if exists "battles are public" on battles;
drop policy if exists "entries are public" on entries;
drop policy if exists "ballots are public" on ballots;

create policy "battles are public" on battles for select using (true);
create policy "entries are public" on entries for select using (true);
create policy "ballots are public" on ballots for select using (true);

-- Which model actually wins -------------------------------------------------
create or replace view tool_standings as
select
  tool,
  count(*)                                        as battles,
  count(*) filter (where rank = 1)                as wins,
  round(avg(total)::numeric, 2)                   as avg_total,
  round(avg(avg_requirements)::numeric, 2)        as avg_requirements,
  round(avg(avg_functionality)::numeric, 2)       as avg_functionality,
  round(avg(avg_aesthetic)::numeric, 2)           as avg_aesthetic,
  round(avg(avg_approach)::numeric, 2)            as avg_approach,
  count(*) filter (where dnf)                     as dnfs
from entries
where not is_bot
group by tool
order by wins desc, avg_total desc;
