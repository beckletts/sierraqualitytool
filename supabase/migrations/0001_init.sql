-- Sierra Pre-Go-Live Quality Review: initial schema
-- interactions / claims / reviews per solution design doc.

create extension if not exists "pgcrypto";

create table if not exists interactions (
  id uuid primary key default gen_random_uuid(),
  sierra_conversation_id text not null unique,
  transcript jsonb not null,
  pulled_at timestamptz not null default now(),
  competency_scores jsonb not null,
  intervention_priority text not null check (intervention_priority in ('hard_flag', 'soft_flag', 'none')),
  status text not null default 'pending' check (status in ('pending', 'reviewed')),
  signed_off_at timestamptz,
  signed_off_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists interactions_priority_idx on interactions (intervention_priority, pulled_at desc);

create table if not exists claims (
  id uuid primary key default gen_random_uuid(),
  interaction_id uuid not null references interactions(id) on delete cascade,
  claim_text text not null,
  flag_status text not null check (flag_status in ('verified', 'drift', 'unverifiable', 'source_conflict', 'fetch_failed')),
  confidence numeric,
  rationale text,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists claims_interaction_idx on claims (interaction_id);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  interaction_id uuid not null references interactions(id) on delete cascade,
  claim_id uuid references claims(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id),
  reviewer_email text not null,
  action text not null check (action in ('confirm_flag', 'override_flag', 'adjust_competency', 'add_note', 'sign_off')),
  field text,
  previous_value jsonb,
  new_value jsonb,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists reviews_interaction_idx on reviews (interaction_id, created_at desc);

alter table interactions enable row level security;
alter table claims enable row level security;
alter table reviews enable row level security;

-- Small trusted review team: any authenticated user can read/write.
-- The worker writes via the service role key, which bypasses RLS entirely.
create policy "authenticated read interactions" on interactions
  for select to authenticated using (true);
create policy "authenticated update interactions" on interactions
  for update to authenticated using (true);

create policy "authenticated read claims" on claims
  for select to authenticated using (true);

create policy "authenticated read reviews" on reviews
  for select to authenticated using (true);
create policy "authenticated insert reviews" on reviews
  for insert to authenticated with check (auth.uid() = reviewer_id);
