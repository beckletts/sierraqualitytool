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

**Known gap to validate for real:** every direct fetch to qualifications.pearson.com, jcq.org.uk, and support.pearson.com (including their `sitemap.xml`) returned HTTP 403 when probed from the environment this was built in — matching the design doc's called-out scraping-reliability risk.

That 403 was read at the time as Pearson blocking crawlers. It probably wasn't. The same signature appears when a build sandbox's own egress policy refuses the connection, in which case the request never reached Pearson at all and the finding says nothing about the sites. The two are told apart by what the refusal body says, which wasn't checked. **Don't build on that finding — re-establish it with `npm run probe` (below) from wherever the worker will actually run.**

Either way, `worker/src/sources/fetch.ts` fails gracefully (`fetch_failed`, never silently scored as `unverifiable`), and its search-result parsing is still unverified against real markup. Expect to tune `worker/src/sources/domains.ts` (seed URLs, search URL patterns) once you can see real responses.

**Also a placeholder:** `worker/src/analysis/framework.ts` has a rubric drafted from the design doc's one-line summary of each competency, not the full framework document. Replace `descriptors` there with the real text before trusting scores beyond prototype validation.

## 3a. Source reachability diagnostic

When claim verification can't check a claim it records `fetch_failed` and nothing
more. That one flag covers four situations needing four different fixes:

| What actually happened | The fix |
|---|---|
| The source refused us | A robots/permission conversation with the site owner |
| Our own egress refused us | An allowlist entry — the request never left the pod |
| The page has no HTML to read | That source needs an API, not a better scraper |
| The URL is wrong | Correct the URL |

From inside the worker these are indistinguishable, and the note above shows what
guessing between them costs. So:

```bash
cd worker

# From the deployed environment, saved for the Admin page to show.
npm run probe -- --from=cookie-pod

# From anywhere — controls and fixed reference URLs only. Skips saving if
# DATABASE_URL is unset, so it runs on a laptop with no config at all.
npm run probe -- --from=my-laptop --reference-only
```

Run it from the deployed environment **and** from a network known to be
unrestricted, then compare. A target that works from one and not the other is a
policy question; one that fails from both is a real one. `--from` is stored with
the results, because a probe result without the network it came from is an
anecdote.

What it checks:

- **Controls** — general outbound HTTPS, and the Anthropic API. If these fail,
  nothing else in the run means anything, and both the CLI and the Admin page
  say so instead of presenting a page of red.
- **Every enabled `knowledge_sources` row** — its `robots.txt`, its search URL,
  and each seed URL. Add a source on the Settings page and it gets probed
  without touching code.
- **Fixed reference URLs** that answer the questions currently open on the
  knowledge-corpus design: whether the qualifications-site support pages read as
  HTML, whether `support.pearson.com` returns a JavaScript shell (it should —
  see below), and whether the PDFs carry a text layer or need OCR.
- **PDF sitemap offsets**, counting entries at `offset=0`, `30000` and `35000`.
  `robots.txt` declares PDF sitemap pages in steps of 5,000 up to
  `offset=30000`, implying tens of thousands of PDFs rather than the low
  hundreds first assumed — the difference between mirroring them and never
  mirroring them. The probe counts, rather than leaving it as homework.
- **The Salesforce Knowledge API**, reported as `not_configured` — naming the
  variables it wants — until credentials exist.

Results go to `source_probe_runs` / `source_probes` and appear on the **Admin**
page under *Knowledge source reachability*, grouped so problems on our side of
the wire read separately from properties of the source. Every row keeps the raw
evidence (status, content type, size, first slice of the body) beside the
verdict, because the verdicts are heuristics and the evidence isn't: a 403 from
Akamai and a 403 invented by a proxy are told apart by what the body says.

`npm test` in `worker/` covers those heuristics, pinning the distinctions worth
not losing when they're tuned against real results.

### support.pearson.com is Salesforce Knowledge

Its article URLs are `/uk/s/article/…` — the Salesforce Experience Cloud
pattern. The page is a Lightning single-page app, so the article body is never
in the HTML and no amount of fetching will read it.

That's not a scraping problem to solve but a source to read differently: the
Knowledge API returns the same content as data, with article IDs, versions and
publish dates. It also means `support.pearson.com` and Salesforce Knowledge are
one source rather than two — so the divergence this tool is meant to catch is
between Knowledge (= support.pearson.com) and the qualifications site plus its
PDFs.

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
