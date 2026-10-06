-- Multi-agent support.
--
-- Overwatch covers 3-4 Sierra AI agents, each with its own Admin API token,
-- and possibly a second (US) Sierra environment with a different base URL and
-- org. The worker previously read one agent out of env vars, so nothing on an
-- interaction recorded which agent produced it. Every per-agent feature on the
-- roadmap (agent profiles, containment rate by agent) needs that link, so it
-- lands first.
--
-- Secrets deliberately do NOT live in this table. `token_env_var` names the
-- environment variable the worker reads the token from; the row holds only the
-- non-secret routing details. Every signed-in reviewer can read this table, so
-- a token column would be a token handed to the whole team.

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  -- The agent ID as it appears in Sierra's Admin API URLs.
  sierra_agent_id text not null unique,
  -- Display name for the queue, filters and (later) the agent profile page.
  name text not null,
  -- Which Sierra environment this agent lives in, e.g. 'eu' or 'us'.
  -- Free text rather than a check constraint: the US environment is unconfirmed
  -- and a guessed-at constraint would be a constraint on a guess.
  environment text not null default 'eu',
  sierra_base_url text not null,
  sierra_org_id text not null,
  -- Name of the env var holding this agent's token — NOT the token itself.
  token_env_var text not null,
  -- Disabled agents are skipped by the worker but kept for their history.
  enabled boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table agents enable row level security;

-- Same posture as knowledge_sources: a small trusted team maintains this, and
-- there is nothing sensitive in it to protect.
create policy "authenticated read agents" on agents
  for select to authenticated using (true);
create policy "authenticated insert agents" on agents
  for insert to authenticated with check (true);
create policy "authenticated update agents" on agents
  for update to authenticated using (true);
create policy "authenticated delete agents" on agents
  for delete to authenticated using (true);

-- ── Link interactions to their agent ────────────────────────────────────

alter table interactions
  add column if not exists agent_id uuid references agents(id);

create index if not exists interactions_agent_idx
  on interactions (agent_id, conversation_started_at desc);

-- A placeholder for conversations pulled before this migration: they came from
-- whatever single agent SIERRA_AGENT_ID pointed at, which the database has no
-- record of. Seeded disabled so the worker never tries to pull with it.
--
-- To correct it: either edit this row in Settings to the real agent's details,
-- or add the real agent and re-run the worker with --backfill-metadata, which
-- reassigns each conversation to the agent whose export returned it.
insert into agents (sierra_agent_id, name, environment, sierra_base_url, sierra_org_id, token_env_var, enabled, notes)
values (
  'unidentified',
  'Unidentified agent (pre-multi-agent pull)',
  'eu',
  'https://api.eu.sierra.ai',
  'unknown',
  'SIERRA_TOKEN_UNIDENTIFIED',
  false,
  'Placeholder for interactions pulled before agents were tracked. Edit this row with the real agent details, or run the worker with --backfill-metadata to reassign its conversations.'
)
on conflict (sierra_agent_id) do nothing;

update interactions
set agent_id = (select id from agents where sierra_agent_id = 'unidentified')
where agent_id is null;

-- Every interaction belongs to an agent — enforce it now that the existing
-- rows are accounted for, so a worker bug can't quietly write orphan rows.
alter table interactions
  alter column agent_id set not null;

-- Sierra conversation IDs are only guaranteed unique within an org, so the
-- dedupe key is (agent, conversation), not the conversation alone. Matters as
-- soon as a second environment is in play.
alter table interactions
  drop constraint if exists interactions_sierra_conversation_id_key;

create unique index if not exists interactions_agent_conversation_key
  on interactions (agent_id, sierra_conversation_id);
