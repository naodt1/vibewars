-- Did the player confirm this model against their own API key? Self-reported by
-- the client, so it records a claim rather than proof.
alter table entries add column if not exists key_verified boolean not null default false;
