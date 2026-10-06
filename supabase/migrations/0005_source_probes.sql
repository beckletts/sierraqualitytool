-- Source reachability diagnostics.
--
-- The claim-verification pipeline depends on reaching knowledge sources over
-- HTTPS, and when a fetch fails the pipeline can only record *that* it failed
-- (`fetch_failed`) — not why. "Blocked by Pearson", "blocked by our own egress
-- policy", "the page is a JavaScript shell with no HTML to read" and "the URL
-- is wrong" all look identical from inside the worker, and they need four
-- different fixes.
--
-- These tables hold the output of `npm run probe` in the worker: one row per
-- target attempted, with the raw evidence (status, content type, size, the
-- first slice of the body) kept alongside the classification, so a human can
-- disagree with the verdict. The verdict is a heuristic; the evidence is not.

create table if not exists source_probe_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- Free-text label for where the probe ran from, e.g. 'cookie-pod' or a
  -- laptop. The whole point of the exercise is comparing one network's answer
  -- with another's, so the network has to be recorded with the result.
  ran_from text not null,
  notes text
);

create table if not exists source_probes (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references source_probe_runs(id) on delete cascade,

  -- What kind of thing was being checked. `control` targets are not Pearson
  -- knowledge sources at all — they establish whether general outbound HTTPS
  -- works, which is what separates "this domain is blocked" from "nothing is
  -- reachable".
  target_kind text not null check (target_kind in (
    'control', 'robots', 'sitemap', 'search', 'seed_url', 'reference_page', 'reference_pdf', 'knowledge_api'
  )),
  -- Which knowledge_sources row this target belongs to, where it belongs to
  -- one. Plain text rather than a foreign key: a probe result should survive
  -- someone deleting or renaming the source row it came from, because the
  -- point of the record is what the network did on a given date.
  domain text,
  label text not null,
  url text not null,

  verdict text not null check (verdict in (
    'ok', 'js_shell', 'empty_body', 'http_error', 'blocked_by_proxy',
    'dns_failure', 'tls_failure', 'timeout', 'transport_error', 'not_configured'
  )),
  http_status integer,
  content_type text,
  bytes integer,
  elapsed_ms integer,

  -- One plain sentence on what happened, written for the reviewer reading the
  -- Admin page rather than for a log parser.
  detail text not null,
  -- The first slice of the response body, kept verbatim. A 403 from Akamai and
  -- a 403 invented by an egress proxy are told apart by what the body says, so
  -- discarding it would discard the answer.
  body_sample text,
  -- Structured extras that only apply to some target kinds: extracted text
  -- length for HTML, the PDF text-layer heuristic, page-count estimates.
  findings jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists source_probes_run_idx on source_probes (run_id, domain, label);

alter table source_probe_runs enable row level security;
alter table source_probes enable row level security;

-- Read-only from the browser, for every signed-in reviewer: when the queue
-- shows `fetch_failed` on a claim, the reason belongs in front of the person
-- deciding whether that is the agent's fault or ours.
--
-- No insert/update/delete policies at all — the worker writes these rows over
-- its direct DATABASE_URL connection, which is not subject to RLS. A probe
-- result that the browser could write would be a probe result that proves
-- nothing about the network.
create policy "authenticated read source_probe_runs" on source_probe_runs
  for select to authenticated using (true);
create policy "authenticated read source_probes" on source_probes
  for select to authenticated using (true);

-- ── Latest-run convenience ──────────────────────────────────────────────
-- The Admin page almost always wants "the most recent run, whole", and doing
-- that from the client is two round trips plus a race if a probe is running.

create or replace function latest_source_probe_run()
returns table (
  run_id uuid,
  started_at timestamptz,
  finished_at timestamptz,
  ran_from text,
  notes text,
  target_kind text,
  domain text,
  label text,
  url text,
  verdict text,
  http_status integer,
  content_type text,
  bytes integer,
  elapsed_ms integer,
  detail text,
  body_sample text,
  findings jsonb
)
-- Deliberately NOT security definer: the two tables are already readable by
-- authenticated users through their own policies, so running as the caller
-- gives the same result today and keeps honouring those policies if they are
-- ever tightened. A definer function here would quietly outlive the change.
language sql
stable
set search_path = public
as $$
  select r.id, r.started_at, r.finished_at, r.ran_from, r.notes,
         p.target_kind, p.domain, p.label, p.url, p.verdict, p.http_status,
         p.content_type, p.bytes, p.elapsed_ms, p.detail, p.body_sample, p.findings
  from source_probe_runs r
  left join source_probes p on p.run_id = r.id
  where r.id = (select id from source_probe_runs order by started_at desc limit 1)
  order by p.target_kind, p.domain nulls first, p.label;
$$;

grant execute on function latest_source_probe_run() to authenticated;
