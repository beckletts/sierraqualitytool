# Overwatch roadmap: the CSX wishlist

Status of the wishlist raised in September 2026, and the sequence for building
it.

**Current state (October 2026).** Phase 1 is built. Phase 4 is now **designed**
but not built — see [`knowledge_corpus_design.md`](knowledge_corpus_design.md),
and note its scope has changed from the reading in this document (below).
Phases 2, 3 and 5 are still planned, not started. Two pieces of work have also
landed outside the phase plan — see
[Built alongside the phases](#built-alongside-the-phases).

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

## Built alongside the phases

Neither of these is a wishlist item. Both were built because the knowledge check
could not be trusted without them, and both are prerequisites for Phase 4 rather
than detours from it.

### Citation-grounded claim verification (built)

The pull now requests `include_events=true` and extracts each message's
`knowledge_citations`, so a claim can be checked against the text the agent
itself retrieved. A claim that contradicts its own cited source is strong
evidence of drift regardless of what the external sites say.

Worth knowing why this matters to the sequencing: it is the **only** knowledge
check that needs no external network access, because the evidence is already in
the data we pull. So it keeps working while Phase 4's access questions are
unresolved, and it is the check to trust first.

### Source reachability diagnostic (built)

`npm run probe` (see the README) attributes a failed fetch to the site, our own
egress, a client-rendered page, or a wrong URL, keeping the raw evidence beside
each verdict. It also measures two things Phase 4 needs scoped: how many PDFs
the qualifications site actually publishes, and whether they carry a text layer
or need OCR.

It exists because `fetch_failed` on its own is not an answer, and because this
build's own planning was shaped by a misread 403 — recorded at the time as
"Pearson blocks crawlers", most likely a sandbox egress policy. **The diagnostic
has not yet been run from the deployed environment**, so that question is open
rather than settled.

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

**Designed, not built.** Full design:
[`knowledge_corpus_design.md`](knowledge_corpus_design.md). Intent confirmed by
the wishlist's author in October 2026 (this closed open question 11).

Not the existing drift check. Today `source_conflict` only fires when a
transcript claim happens to touch a topic where two sources disagree. What was
asked for is our published guidance compared **against itself** — where has it
drifted out of sync — whether or not a bot ever mentioned it. A standing report
useful to the knowledge owners independently of Sierra.

Three corrections to the reading first recorded here:

**It is two systems, not three.** `support.pearson.com` is Salesforce Knowledge
behind an Experience Cloud front end — its `/s/article/` URLs are a Lightning
single-page app, so the article body is never in the HTML. It is not a separate
source to compare and not a scraping target; it is Salesforce Knowledge, read
through the API. So the comparison is **Salesforce Knowledge (=
support.pearson.com)** against **qualifications.pearson.com and its PDFs**. JCQ
stays nice-to-have, and since it is not Pearson-managed, a JCQ difference is
information rather than a defect.

**It needs an indexed corpus, not live fetches.** A divergence report is an
audit artefact: if the same claim checked twice retrieves different text and
lands on a different flag, the report is not evidence of anything. And
"every topic both systems cover" is a query over a list, which no
question-answering interface can produce. So the retrieval has to be
deterministic over stored documents, with the model doing the reading and
judging.

**Ingestion goes Knowledge-first.** `robots.txt` implies the qualifications site
publishes 30,000–35,000 PDFs, not the low hundreds first assumed. Mirroring them
is off the table. Instead: ingest Knowledge (hundreds to low thousands of
articles), derive the topic list from it, then pull only the matching site
documents. Divergence is only meaningful where **both** systems cover a topic —
which is what makes the PDF volume tractable, because most are never looked at.

Three outputs, kept distinct rather than collapsed into one flag:

| Output | Meaning |
| --- | --- |
| `source_conflict` | Both systems cover it and they disagree — the finding asked for |
| `coverage_gap` | The site (usually a PDF) covers something Knowledge does not — a candidate article, not a contradiction |
| `stale` | Both agree, but one side is materially older |

Blocked on OCTO: a Salesforce connected app with read scope on `Knowledge__kav`,
an egress decision for `qualifications.pearson.com`, and whether an Azure AI
Search index (or SharePoint with Graph-indexed extraction) is available — which
would remove the PDF extraction and OCR work entirely.

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
