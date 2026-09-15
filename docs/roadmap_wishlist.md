# Overwatch roadmap: the CSX wishlist

Status of the wishlist raised in September 2026, and the sequence for building
it. Phase 1 is built; everything after it is planned, not started.

The original wishlist:

| Item | Priority given | Note as given |
| --- | --- | --- |
| User profiles | Essential | User profile for each AI agent |
| Containment rating | Essential | Two levels: 1) AI bot gave the correct answer and customer confirmed, 2) agent gave a correct answer before customer disconnected |
| Human agent check | Value add | — |
| Knowledge mismatch flagging | Nice to have | — |
| Repeat contacts | (blank) | — |
| Coaching quality | Future review | — |

## A note on scope

Containment, repeat contacts and coaching quality are ongoing operational QA
metrics, not pre-go-live gate checks. The solution design chose to build off
Salesforce specifically *because* the scope was a bounded, throwaway validation
gate — see its "Platform note". If this wishlist is the direction of travel,
that platform decision needs revisiting deliberately rather than being quietly
outgrown.

## What unblocked this

Sierra's transfer-tracking documentation and the PSQ tag list settled two
questions that looked like blockers:

- **Transfers are visible in conversation tags.** The `@transfer` computed tag
  is an Agent Studio construct, but it is defined over the raw `transfer` tag
  that Sierra writes on the conversation itself — and the worker already stores
  every conversation's tags (`interactions.tags`, migration `0002`). So
  containment does **not** need unredacted data or a new Sierra scope.
- **The hang-up tags carry the level-2 signal.** `hang-up:user` is a customer
  disconnect. `hang-up:agent:reason:abuse` and `:urgent` are not quality
  failures and must be excluded from containment rather than counted against
  it — a containment rate that includes them will read worse than reality.

Because tags are already stored, containment can be computed **retroactively**
over conversations already pulled: `--backfill-metadata` refreshes tags without
re-running the Claude analysis.

## Phase 1 — Agent identity (built)

Every later phase needs to know which agent produced an interaction, so this
went first.

- `agents` table: Sierra agent ID, name, environment, base URL, org ID, the
  name of the env var holding its token, enabled flag, notes.
  **No credentials in the table** — every signed-in reviewer can read it, so a
  token column would be a token handed to the whole team. Only the variable
  *name* is stored; the worker resolves the value from its own environment.
- `interactions.agent_id`, not null, foreign key to `agents`.
- Dedupe key changed from `sierra_conversation_id` alone to
  `(agent_id, sierra_conversation_id)` — Sierra conversation IDs are only
  unique within an org, which starts to matter with a second environment.
- Worker loops over every enabled agent; `--limit` is now per agent;
  `--agent=<id or name>` runs one. A missing token variable fails the run
  rather than skipping that agent.
- Settings page maintains agents; the queue and insights filter by agent, and
  the queue shows an Agent column.
- Migration seeds a disabled "Unidentified agent" placeholder and assigns every
  pre-existing interaction to it, so the not-null constraint holds without
  inventing an owner. Running `--backfill-metadata` reassigns each conversation
  to the agent whose export actually returned it.

Verified by applying all four migrations to a real Postgres 16 — both on an
empty database and over pre-existing interaction rows — and by exercising the
worker's DB paths against it: idempotent rewrites, per-agent dedupe, the
not-null constraint, the placeholder reassignment, and the foreign key that
stops an agent being deleted out from under its own history.

## Phase 2 — Containment rating

Waiting on a definition from the wishlist's author. Built as a **configurable
tag ruleset** stored in the database, alongside `knowledge_sources` and
`competency_guidelines`, so landing on a definition is a Settings edit rather
than a rebuild.

Strawman to react to:

| Outcome | Rule |
| --- | --- |
| Contained — confirmed | No transfer, customer explicitly confirmed resolution |
| Contained — unconfirmed | No transfer, answer given and verified correct, `hang-up:user` or inactivity |
| Not contained — transferred | `transfer` tag present |
| Not contained — unresolved | No transfer, answer wrong or never given |
| Excluded | `hang-up:agent:reason:abuse` / `:urgent` |

Two design commitments worth stating:

- **"Correct answer" derives from the existing claim verdicts**, not a second
  unanchored model question. Otherwise containment and the knowledge flags can
  contradict each other about the same transcript.
- **The transfer expression is evaluated in Overwatch**, mirroring the agent's
  system definition rather than depending on Sierra's computed tag surviving
  the export. That keeps the rule visible and editable here, and the two can be
  reconciled if the counts ever disagree.

Reviewer overrides work like every other edit: a new `reviews.action` value,
audited with reviewer and timestamp.

## Phase 3 — Agent profiles

Per-agent scorecard: volume, competency mix, flag rates, containment rate,
trend over time, plus which framework and knowledge sources apply to it.
Mostly aggregation over phases 1–2, so it follows them.

## Phase 4 — Knowledge mismatch (source divergence)

Not the existing drift check. Today `source_conflict` only fires when a
transcript claim happens to touch a topic where two sources disagree. What was
asked for is the three verified sources compared **against each other
directly** — where has our published guidance drifted out of sync — whether or
not a bot ever mentioned it.

That is a standing report useful to the knowledge owners independently of
Sierra, and nothing in the build does it today. New table, new page, seeded
from the topics transcripts actually cover.

## Phase 5 — Human agent check

Waiting on a definition. Two readings: score human-handled interactions with
the same framework for a bot-vs-human comparison, or check that escalations
were appropriate and well handled. The `transfer` tag already gives the
escalation boundary either way.

## Parked

- **Repeat contacts.** Not possible under redaction, and that is the right
  trade rather than a gap to work around: linking two conversations to one
  person needs an identifier the redacted export deliberately withholds. If a
  case or ticket reference ever appears in `custom_fields` (non-PII), it
  becomes possible without reopening the redaction decision.
- **Coaching quality.** Future review, per the wishlist.
