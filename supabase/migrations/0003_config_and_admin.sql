-- Moves the competency rubric and the verified-source list out of static
-- worker code into editable tables, and adds an admin-only view of accounts.

-- ── Admin access ────────────────────────────────────────────────────────
-- A small allowlist table, locked down by RLS with no policies — the only
-- way in is through the SECURITY DEFINER functions below (or the SQL
-- editor / service role). Seeded with the account that owns this build;
-- add more rows the same way if other admins are needed later.

create table if not exists app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table app_admins enable row level security;

insert into app_admins (user_id)
select id from auth.users where email = 'lee.beckett@pearson.com'
on conflict (user_id) do nothing;

-- Cheap self-check any authenticated user can call to decide whether to
-- show the Admin nav link. Returns a bool only — no data leak either way.
create or replace function am_i_admin()
returns boolean
language sql
security definer
set search_path = public, auth
as $$
  select exists (select 1 from app_admins where user_id = auth.uid());
$$;

grant execute on function am_i_admin() to authenticated;

-- auth.users itself is not exposed via RLS/PostgREST — this function is the
-- only path to it, and it re-checks admin membership itself rather than
-- trusting the caller. Deliberately excludes anything beyond basic account
-- status (no password hash, phone, MFA state, or free-form metadata).
create or replace function admin_list_users()
returns table (
  id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  banned_until timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not exists (select 1 from app_admins where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;
  return query
    select au.id, au.email::text, au.created_at, au.last_sign_in_at, au.email_confirmed_at, au.banned_until
    from auth.users au
    order by au.created_at desc;
end;
$$;

grant execute on function admin_list_users() to authenticated;

-- ── Knowledge sources ───────────────────────────────────────────────────
-- Replaces the hardcoded SOURCE_DOMAINS array in worker/src/sources/domains.ts.
-- The three domains themselves are seeded from the design doc and expected
-- to stay fixed (none of the three is arbitrary — see docs/solution_design_sierra_qa.md);
-- what's editable here is the search URL pattern and the seed URLs, which
-- is exactly the knob the design doc flagged as needing real-world tuning.

create table if not exists knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  base_url text not null,
  search_url_template text not null, -- must contain the literal "{query}" placeholder
  seed_urls jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table knowledge_sources enable row level security;

create policy "authenticated read knowledge_sources" on knowledge_sources
  for select to authenticated using (true);
create policy "authenticated insert knowledge_sources" on knowledge_sources
  for insert to authenticated with check (true);
create policy "authenticated update knowledge_sources" on knowledge_sources
  for update to authenticated using (true);
create policy "authenticated delete knowledge_sources" on knowledge_sources
  for delete to authenticated using (true);

insert into knowledge_sources (domain, base_url, search_url_template, seed_urls, enabled) values
  ('qualifications.pearson.com', 'https://qualifications.pearson.com', 'https://qualifications.pearson.com/en/search-results.html?q={query}', '[]'::jsonb, true),
  ('jcq.org.uk', 'https://www.jcq.org.uk', 'https://www.jcq.org.uk/?s={query}', '[]'::jsonb, true),
  ('support.pearson.com', 'https://support.pearson.com', 'https://support.pearson.com/getsupport?q={query}', '[]'::jsonb, true)
on conflict (domain) do nothing;

-- ── Competency guidelines ───────────────────────────────────────────────
-- Replaces the FRAMEWORK constant in worker/src/analysis/framework.ts.
-- The 4 competencies and 4 levels are fixed structural constants (the
-- worker's JSON schema and the UI's score dropdowns are built around
-- them) — what's editable is the descriptor text for each of the 16 cells.
-- Seeded with the current placeholder text so nothing changes until
-- someone edits a cell.

create table if not exists competency_guidelines (
  competency text not null check (competency in ('data_protection', 'communication', 'knowledge_guidance', 'ownership')),
  level text not null check (level in ('Training Need', 'Developing', 'Good', 'Excellent')),
  descriptor text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (competency, level)
);

alter table competency_guidelines enable row level security;

create policy "authenticated read competency_guidelines" on competency_guidelines
  for select to authenticated using (true);
create policy "authenticated insert competency_guidelines" on competency_guidelines
  for insert to authenticated with check (true);
create policy "authenticated update competency_guidelines" on competency_guidelines
  for update to authenticated using (true);

insert into competency_guidelines (competency, level, descriptor) values
  ('data_protection', 'Training Need', 'Shares or requests personal/sensitive data without verification; no acknowledgement of data protection obligations.'),
  ('data_protection', 'Developing', 'Generally cautious but inconsistent verification steps before sharing account-specific information.'),
  ('data_protection', 'Good', 'Consistently verifies identity/authorisation before sharing personal data; follows data minimisation.'),
  ('data_protection', 'Excellent', 'Proactively protects customer data, explains why information is or isn''t shared, and flags risk correctly.'),
  ('communication', 'Training Need', 'Unclear, jargon-heavy, or tone-inappropriate responses; fails to address the customer''s actual question.'),
  ('communication', 'Developing', 'Understandable but inconsistent clarity, structure, or empathy.'),
  ('communication', 'Good', 'Clear, well-structured, appropriately empathetic responses that address the customer''s question.'),
  ('communication', 'Excellent', 'Consistently clear, warm, concise communication that anticipates follow-up confusion.'),
  ('knowledge_guidance', 'Training Need', 'Provides incorrect or ungrounded guidance; no reference to verified sources.'),
  ('knowledge_guidance', 'Developing', 'Mostly correct guidance but with gaps, hedging, or missed nuance.'),
  ('knowledge_guidance', 'Good', 'Accurate, complete guidance grounded in verified policy/process knowledge.'),
  ('knowledge_guidance', 'Excellent', 'Accurate, complete, and proactively surfaces relevant caveats or next steps.'),
  ('ownership', 'Training Need', 'Deflects, provides no resolution path, or leaves the customer without next steps.'),
  ('ownership', 'Developing', 'Attempts resolution but with unclear ownership of next steps or follow-up.'),
  ('ownership', 'Good', 'Takes clear ownership of the interaction through to a resolution or explicit next step.'),
  ('ownership', 'Excellent', 'Takes ownership, confirms resolution, and closes loops proactively.')
on conflict (competency, level) do nothing;
