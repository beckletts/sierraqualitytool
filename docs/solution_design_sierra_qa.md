# Solution Design: Sierra Pre-Go-Live Quality Review

## Problem
Before Sierra goes live handling customer interactions, the CSX quality team needs to validate that its transcripts meet Pearson's quality standards and that the knowledge it gives customers is accurate against verified sources. Today the only way to get transcripts out of Sierra is the Admin API, and the existing Power Automate + SharePoint + Copilot review path is clunky and laggy. This is a bounded, pre-go-live validation exercise — a few hundred transcripts — not an ongoing operational feed.

## Current workflow
1. Transcripts pulled from Sierra manually / via the Admin API.
2. Landed into a SharePoint list.
3. Copilot Studio agent scores them against quality standards, writing results back to SharePoint.
4. Reviewers work from the SharePoint list.

**Friction:** SharePoint-list-as-database plus Copilot round-trips make it slow and clunky. No structured knowledge-accuracy check against verified sources. No purpose-built review surface — the team works around a list, not a tool. Nothing flags where a human actually needs to intervene, so every transcript gets read with equal weight.

## Platform note (deliberate exception)
CSX defaults to the Salesforce platform. This build sits **off** it — Supabase (store + auth) and a React front end — by design. Rationale: this is a throwaway, bounded validation gate, not a durable operational record, so standing up a Salesforce custom object and its governance surface for something decommissioned after go-live would be the wrong trade. Transcripts are pulled **redacted** (Admin API Read scope, not the unredacted PII scope), which keeps the PII constraint off the table and makes the off-platform choice clean. If this ever becomes a permanent operational QA process, it should be revisited against the platform-first default.

## Recommended tool(s)
**Primary:** Supabase (Postgres + Auth) — self-service store the review team logs into; SQL suits "show me everything flagged for intervention, sorted by confidence" slicing far better than a document store.
**Supporting:**
- **React front end** (Pearson-branded) — the view/review/edit surface the team never leaves.
- **Node ingestion + analysis worker** — daily scheduled pull from Sierra, per-transcript LLM scoring, and the knowledge-vs-source check. Robust retry/pagination/error handling that low-code tools strain on.
- **GitHub Actions cron** — runs the daily pull server-side; reuses the pattern already in use for the daily Salesforce→Slack report. Sierra token lives here as a secret, never behind a user-facing button.

Rejected: **Copilot Studio / SharePoint** (the source of the current lag; not a system of record). **On-demand Sierra pull from the UI** (chosen scheduled/behind-the-scenes instead — cleaner token governance). **Firebase** (viable, but Postgres/SQL fits the querying better and Supabase's free tier covers it).

## New workflow
1. **Daily pull (server-side).** GitHub Actions cron fires the Node worker once a day. It calls Sierra `conversations/export` (Read scope, redacted), paginates with start/end/limit, and backs off with jitter on any 429. A few hundred transcripts sits comfortably under the 1000 req/min ceiling.
2. **Per-transcript analysis.** For each new transcript the worker makes a model call that returns two things:
   - **Quality assessment** against the Pearson competency framework — Data Protection plus the three competencies (Communication, Knowledge & Guidance, Ownership), each scored on the four-level scale (Training Need / Developing / Good / Excellent). Framework criteria chunked into a retrieval store rather than pasted whole into every prompt.
   - **Knowledge-confidence check** per factual claim, against the three verified sources.
3. **Write to Supabase.** Results land as they finish — `interactions`, `claims`, and `reviews` tables (schema below). UI fills in live.
4. **Review in-app.** Team logs in, sees the day's transcripts sorted by intervention priority (hard flags first), reads the AI's per-competency scores and per-claim flags, and edits: confirm/override a flag, adjust a competency level, add a coaching note, mark reviewed and sign off.
5. **Audit trail.** Every reviewer action stamped with reviewer + timestamp in the `reviews` table — satisfies the framework's "auditable" principle and gives a defensible record of who signed off each interaction before go-live.

### Scoring framework — quality + intervention flagging
Two separately-reliable signals, kept distinct:

- **Quality score** — the competency assessment above. Maps directly to the uploaded framework, so feedback language is already the team's own.
- **Knowledge-confidence flag** — the intervention trigger. Three states per claim:
  - **Verified** — claim matches a verified source. No human needed.
  - **Drift / contradiction** — claim conflicts with a verified source. **Hard flag, auto-recommend human intervention**, regardless of quality score.
  - **Unverifiable** — claim has no matching source or the model isn't confident enough to call it. **Soft flag, recommend review.** Catches the confident-but-ungrounded case — the core pre-go-live risk.

The queue sorts by intervention priority, not quality score, so a polished-sounding interaction containing an ungrounded claim surfaces to the top instead of being buried.

### Source-conflict handling (important)
The three sources are **qualifications.pearson.com**, **jcq.org.uk**, and **support.pearson.com**. JCQ is **not** Pearson-managed and the three can disagree. The check must not treat any single one as ground truth. When sources conflict on the same point, the claim is flagged **source-conflict** (a hard flag) with all conflicting sources cited, and a human decides — the tool surfaces the disagreement, it doesn't resolve it. This matters because a Sierra answer that matches Pearson's own guidance but contradicts JCQ is exactly the kind of thing a human must adjudicate, not the model.

## Prototype scope
**Build first (thinnest end-to-end slice):**
- Node worker: pull a small batch from Sierra (or a saved sample) → one model call producing the competency scores + per-claim flags as structured JSON → write to Supabase.
- Supabase schema + auth.
- React screen: list sorted by intervention priority, per-transcript detail with scores and flags, edit + sign-off with audit stamp.
- Prove the full loop on ~10 transcripts before scaling to the full batch.

**Deferred:**
- The daily GitHub Actions cron (run manually first; schedule once the loop is trusted).
- Confidence-threshold tuning for the "unverifiable" flag (see risks).
- Reviewer assignment / multi-reviewer workflow if needed.

**Risks / unknowns:**
- **"Unverifiable" over-fires early.** The model will flag correct-but-differently-phrased claims. Safe direction to err for a go-live gate, but needs a tunable confidence threshold; the team's early edits calibrate it. Flag this to the team up front so the first batch's flag count isn't a surprise.
- **Source fetch reliability.** All three sources are public, but structure/anti-scraping and page changes can break extraction. Needs graceful handling (fetch failure ≠ unverifiable claim).
- **Pass/fail gate definition.** The framework is deliberately not pass/fail. For a go-live *gate* you still need an agreed line — e.g. any Training Need on Data Protection or Expertise & Accuracy, or any hard knowledge flag, blocks go-live pending human review. Agree this with whoever owns the Sierra go-live decision.
- **Governance sign-off** on redacted transcript handling and the token living in GitHub Actions secrets.
