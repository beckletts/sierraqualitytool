# Sierra Pre-Go-Live Quality Review

Prototype tool for the CSX quality team to validate Sierra transcripts before go-live: score each transcript against Pearson's competency framework, cross-check factual claims against three verified sources, and review/sign off in a purpose-built UI. See [`docs/solution_design_sierra_qa.md`](docs/solution_design_sierra_qa.md) for the full design.

This is a bounded, off-Salesforce prototype (Supabase + a Node worker + a React front end) for a few hundred transcripts, not a durable operational system — see the design doc's "Platform note" for why.

## Repo layout
```
/worker    Node + TypeScript: pulls transcripts from Sierra, runs the Claude analysis, writes to Supabase
/supabase  SQL migrations (schema + RLS)
/web       React + TypeScript (Vite): the review UI
/docs      solution design doc, the roadmap plan, and open questions
```

## Prerequisites
- Node 20+
- A Supabase project (free tier is fine)
- A Sierra Admin API token per AI agent (Read scope, redacted transcripts)
- An Anthropic API key

## 1. Supabase setup
1. Create a project at [supabase.com](https://supabase.com).
2. Run every file in `supabase/migrations/` against it **in filename order** (SQL editor, or the Supabase CLI).
3. In Authentication → Users, manually create an account per reviewer (email/password). There's no self-signup flow — this is a small trusted team.
4. Note down: Project URL, `anon` public key, and the `service_role` key (Settings → API).

## 2. Register your Sierra agents
Overwatch reviews several Sierra AI agents, each with its own Admin API token and
possibly its own environment. Add one row per agent on the **Settings** page
(or directly in the `agents` table) with:

| Field | What it is |
| --- | --- |
| Name | Display name for the queue, filters and charts |
| Sierra agent ID | The agent ID from Sierra's Admin API URLs |
| Sierra org ID | The org the agent belongs to |
| Environment | `eu`, `us`, … — labelling only |
| API base URL | e.g. `https://api.eu.sierra.ai` |
| Token env var | The **name** of the env var holding that agent's token |

Tokens themselves never go in the database — every signed-in reviewer can read
that table. Only the variable name is stored; the worker resolves the value from
its own environment.

Migration `0004` seeds a disabled placeholder agent ("Unidentified agent") and
points every interaction pulled before agents were tracked at it. Either edit
that row with the real agent's details, or add the real agent and run
`npm run pull -- --backfill-metadata` (below), which reassigns each conversation
to the agent whose export returned it.

## 3. Worker
```
cd worker
cp .env.example .env   # fill in DATABASE_URL, ANTHROPIC_API_KEY, and one token var per agent
npm install
```

Prove the analysis loop against the bundled fixture first (no Sierra credentials needed, still calls Claude + does live source fetches):
```
npm run pull -- --fixture
```

Once that looks right, pull real transcripts:
```
npm run pull -- --start=2026-07-29 --end=2026-08-03 --limit=10
```

The worker pulls from every **enabled** agent in turn. `--limit` is per agent,
not a total. To run a single agent, pass its Sierra agent ID or its name:
```
npm run pull -- --agent=<sierra agent id> --start=2026-07-29 --end=2026-08-03
```

If any enabled agent's token variable is missing the run fails rather than
skipping that agent — a silently skipped agent looks exactly like an agent with
no conversations, which is the wrong thing for a quality gate to be vague about.

The worker is idempotent — rerunning it skips conversations already written
(deduped on agent + `sierra_conversation_id`, since Sierra conversation IDs are
only unique within an org).

**Known gap to validate for real:** every direct fetch to qualifications.pearson.com, jcq.org.uk, and support.pearson.com (including their `sitemap.xml`) returned HTTP 403 when probed from the environment this was built in — matching the design doc's called-out scraping-reliability risk. The fetch module (`worker/src/sources/fetch.ts`) is built to fail gracefully (`fetch_failed`, never silently scored as `unverifiable`), but its search-result parsing is unverified against real markup. Test it from wherever the worker will actually run, and expect to tune `worker/src/sources/domains.ts` (seed URLs, search URL patterns) once you can see real responses.

**Also a placeholder:** `worker/src/analysis/framework.ts` has a rubric drafted from the design doc's one-line summary of each competency, not the full framework document. Replace `descriptors` there with the real text before trusting scores beyond prototype validation.

## 4. Web app
```
cd web
cp .env.example .env   # fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (the anon key, not service role)
npm install
npm run dev
```
Log in with a reviewer account created in step 1. The queue sorts hard-flag interactions first, then soft-flag, then clean ones. Every edit (competency override, flag override, note, sign-off) writes an audit row to the `reviews` table with the reviewer and timestamp.

## Deliberately not built yet
- **GitHub Actions daily cron.** Per the design doc, run the worker manually until the loop is trusted, then schedule it.
- **Confidence-threshold tuning** for the "unverifiable" flag — expect this to over-fire initially; use the first batch's overrides to calibrate.
- **Reviewer assignment / multi-reviewer workflow.**
