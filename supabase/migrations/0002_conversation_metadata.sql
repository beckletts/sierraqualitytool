-- Captures Sierra conversation metadata that the worker previously discarded
-- (start_timestamp, tags, custom_fields, device) so the queue can filter by
-- the actual conversation date instead of ingestion time, and so the
-- Insights view has real topic/volume signal to chart.

alter table interactions
  add column if not exists conversation_started_at timestamptz,
  add column if not exists tags jsonb not null default '[]'::jsonb,
  add column if not exists custom_fields jsonb not null default '{}'::jsonb,
  add column if not exists device text;

create index if not exists interactions_conversation_started_idx
  on interactions (conversation_started_at desc);

-- Existing rows predate this column and have no way to backfill it short of
-- re-fetching from Sierra — they'll show as null and the app falls back to
-- pulled_at for those. New pulls populate it going forward.
