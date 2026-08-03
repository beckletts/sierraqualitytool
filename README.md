# Sierra Pre-Go-Live Quality Review

Prototype tool for the CSX quality team to validate Sierra transcripts before go-live: score each transcript against Pearson's competency framework, cross-check factual claims against three verified sources, and review/sign off in a purpose-built UI. See [`docs/solution_design_sierra_qa.md`](docs/solution_design_sierra_qa.md) for the full design.

This is a bounded, off-Salesforce prototype (Supabase + a Node worker + a React front end) for a few hundred transcripts, not a durable operational system — see the design doc's "Platform note" for why.

## Repo layout
```
/worker    Node + TypeScript: pulls transcripts from Sierra, runs the Claude analysis, writes to Supabase
/supabase  SQL migrations (schema + RLS)
/web       React + TypeScript (Vite): the review UI
/docs      solution design doc
```

## Prerequisites
- Node 20+
- A Supabase project (free tier is fine)
- A Sierra Admin API token (Read scope, redacted transcripts)
- An Anthropic API key

## 1. Supabase setup
1. Create a project at [supabase.com](https://supabase.com).
2. Run `supabase/migrations/0001_init.sql` against it (SQL editor, or the Supabase CLI).
3. In Authentication → Users, manually create an account per reviewer (email/password). There's no self-signup flow — this is a small trusted team.
4. Note down: Project URL, `anon` public key, and the `service_role` key (Settings → API).

## 2. Worker
```
cd worker
cp .env.example .env   # fill in SIERRA_API_TOKEN, ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
npm install
```

Prove the analysis loop against the bundled fixture first (no Sierra credentials needed, still calls Claude + does live source fetches):
```
npm run pull -- --fixture
```

Once that looks right, pull real transcripts:
```
npm run pull -- --limit=10
```

The worker is idempotent — rerunning it skips conversations already written (deduped on `sierra_conversation_id`).

**Known gap to validate for real:** every direct fetch to qualifications.pearson.com, jcq.org.uk, and support.pearson.com (including their `sitemap.xml`) returned HTTP 403 when probed from the environment this was built in — matching the design doc's called-out scraping-reliability risk. The fetch module (`worker/src/sources/fetch.ts`) is built to fail gracefully (`fetch_failed`, never silently scored as `unverifiable`), but its search-result parsing is unverified against real markup. Test it from wherever the worker will actually run, and expect to tune `worker/src/sources/domains.ts` (seed URLs, search URL patterns) once you can see real responses.

**Also a placeholder:** `worker/src/analysis/framework.ts` has a rubric drafted from the design doc's one-line summary of each competency, not the full framework document. Replace `descriptors` there with the real text before trusting scores beyond prototype validation.

## 3. Web app
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
