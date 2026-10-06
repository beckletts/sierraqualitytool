# Design note: knowledge corpus and divergence detection

**Status:** proposal. Written to be forwarded to OCTO and to the
qualifications-site content owners — the asks are in
[What we need from other teams](#what-we-need-from-other-teams).

**Supersedes** the three-verified-sources approach in
[`solution_design_sierra_qa.md`](solution_design_sierra_qa.md) for the
knowledge-check half of the tool. The competency-scoring half is unaffected.

---

## What changed

The original design checked each factual claim a Sierra agent made by fetching
the relevant page from three sites at analysis time and asking a model whether
the claim held up. That framing treats the sites as ground truth and the bot as
the thing under test.

The requirement is broader than that. CSX's actual problem is that **the same
question can be answered differently by different Pearson systems**, and nobody
currently finds out until a customer is given the wrong answer. Salesforce
Knowledge, the qualifications site, and the PDF guidance on the qualifications
site can and do disagree. Some of that PDF guidance has no Salesforce equivalent
at all.

So the tool's job is not only "was the bot right" but "**do our own systems
disagree, and where**". That is a different problem, and it needs a different
architecture:

| | Judging the bot | Detecting divergence |
|---|---|---|
| Triggered by | A transcript mentioning a topic | A schedule, across the whole corpus |
| Needs | One page, now | Both systems' text on the same topic |
| Fails by | Missing a bad answer | Missing a contradiction nobody asked about |
| Evidence needed | A passage | Two passages, quotable side by side, and stable enough to re-check |

Divergence detection only works over an **indexed corpus**. You cannot sweep for
contradictions you have not enumerated, and you cannot report a contradiction
you cannot reproduce.

## Why retrieval should stop being an AI problem

A fair challenge to this design is whether it is over-engineered — Claude in a
chat window will find the right page and answer from it today, so why build a
corpus.

The honest split is that the **judgement** is an LLM problem and the
**retrieval** is not:

- **Reproducibility.** A divergence report is an audit artefact. If the same
  claim checked twice retrieves different text and lands on a different flag,
  the report is not evidence of anything. Live retrieval — whether a scrape or a
  search index — gives no such guarantee.
- **Quoting, not answering.** For divergence we need the source *passage*, not a
  summary of it. A generative answer puts a second model between us and the
  text, and when the two disagree there is no way to tell whose error it is.
- **Enumeration.** "Every topic both systems cover" is a query over a list. No
  question-answering interface can produce that list.

So: deterministic retrieval over a stored corpus, with the model doing the
reading and judging. The LLM stays, in the place it is good.

### Copilot Studio, assessed

Worth recording, because it is the obvious thing to reach for and Pearson
already has it. Adding the site URLs as knowledge does pull back content,
including from PDFs. It is still the wrong backend for this:

- **Public-website knowledge is Bing-index-backed and documented as reaching
  only two path levels deep.** The pages CSX needs look like
  `/en/support/support-topics/exams/special-requirements/access-arrangements.html`
  — six segments. The content we most need is what it least reliably reaches.
- **The URL cap is 25** in generative orchestration (four in classic, or four
  where knowledge is attached at a topic-level generative-answers node). The
  HTML corpus is low thousands of URLs.
- **It answers rather than quotes**, which is the reproducibility problem above.

The part of the idea that *does* hold up is **SharePoint as a knowledge source**:
Graph-indexed rather than Bing-indexed, and it handles PDF, PPTX and DOCX up to
512 MB with Microsoft doing extraction and OCR. PDF extraction is the most
expensive single piece of work in this design, so that is worth taking.

Note also that Copilot Studio plus SharePoint *is* the current review workflow,
and the existing design doc rejected it for this tool on lag and
system-of-record grounds. That judgement stands; this is a narrower question
about extraction.

## The source picture, corrected

Three findings changed the shape of this since the original design.

**1. support.pearson.com is Salesforce Knowledge.** Its article URLs are
`/uk/s/article/…` — the Salesforce Experience Cloud pattern. The page is a
Lightning single-page app, so the article body never appears in the HTML and no
amount of fetching will read it.

This is the most useful finding in the set. It means support.pearson.com is not
a scraping target at all: the Knowledge API returns the same content as data,
with article IDs, versions and publish dates. It also means we have **two**
systems to compare, not three:

```
Salesforce Knowledge  ═══ is ═══  support.pearson.com
         │
         │  compare
         ▼
qualifications.pearson.com  ──  HTML support pages
                            └─  PDF guidance  ← often has no Knowledge equivalent
```

JCQ remains nice-to-have. It is also not Pearson-managed, so it can legitimately
disagree with both — a JCQ difference is information, not a defect.

**2. The HTML corpus is small; the PDF corpus is not.** `sitemap1.xml` lists low
thousands of HTML URLs. It is also `Generated by Screaming Frog SEO Spider` —
a crawler's output, not a CMS export, which weakens the "ask for a content
export" path for HTML pages and is another reason to lean on the Knowledge API.

`robots.txt` separately declares paginated PDF sitemaps in steps of 5,000 up to
`offset=30000`. Nobody declares `offset=30000` unless there are entries near it,
so the PDF count is plausibly **30,000–35,000**, not the low hundreds first
assumed. That rules out mirroring the PDFs and makes the relevance filter
load-bearing rather than a refinement. The reachability probe
(`npm run probe`, see the README) counts entries at offsets 0, 30000 and 35000
to replace this inference with a measurement.

**3. The "Pearson blocks crawlers" finding is probably false.** The original
403s carry the signature of an egress policy refusing the connection before it
left the build environment, not of Pearson refusing the request. The two are
distinguished by what the refusal body says, which was never checked. The probe
now checks and attributes it. **Nothing in this design should be built around
the assumption that Pearson blocks us until that is re-established.**

## Knowledge as the spine

Given the scale asymmetry, the corpus is built **Knowledge-first**:

1. **Ingest Salesforce Knowledge in full.** A few hundred to a few thousand
   articles — the set CSX actually answers from, and the cleanest data available.
2. **Derive the topic list from it.** The topics that matter are the ones CSX has
   written articles about. This is better than a hand-maintained list because it
   cannot drift out of date, though a team-editable override list stays available
   in `knowledge_sources` for gaps.
3. **Pull only the corresponding qualifications-site documents.**

The ordering matters: **divergence is only meaningful where both systems cover a
topic.** A qualifications-site PDF with no Knowledge counterpart is not a
divergence, it is a gap — worth reporting separately, but not the same finding
and not a contradiction.

This inverts the original instinct (mirror the sites, then look for conflicts),
and it is what makes 30,000 PDFs tractable: we never look at most of them.

## Corpus model

Two tables. Chunks carry page numbers because citing "somewhere in this
60-page PDF" is not evidence.

```
source_documents
  source_system     'salesforce_knowledge' | 'qualifications_html' | 'qualifications_pdf' | 'jcq'
  url               canonical, query-string normalised
  external_id       Knowledge article number, where there is one
  title
  doc_type          'kb_article' | 'html' | 'pdf'
  version           Knowledge version, or the PDF's own revision where stated
  published_at      as the source states it
  fetched_at        when we read it
  content_hash      so an unchanged document is not re-chunked or re-judged
  page_count
  text

source_chunks
  document_id
  ordinal
  page_number       nullable (HTML and articles have none)
  heading           nearest enclosing heading, for citation context
  text
  tsv               generated tsvector
```

`content_hash` is what makes the nightly run cheap and what makes "this changed
on the 14th" answerable.

## Ingestion adapters

One per source, deliberately separate — they fail for unrelated reasons and
should fail independently.

**Salesforce Knowledge** (cleanest). Client-credentials connected app, read
scope on `Knowledge__kav`. Returns article ID, title, body, version and
last-modified. No HTML parsing, no crawling, no robots question. Already
probed by the diagnostic, which reports `not_configured` until credentials
exist so the ask stays visible.

**qualifications.pearson.com HTML.** Enumerate from `sitemap1.xml`, filter by
URL prefix (below), fetch, extract. Needs checking whether the support-topics
pages are server-rendered — if they turn out to be client-rendered like
support.pearson.com, this adapter cannot work and becomes a CMS-export
conversation instead.

**qualifications.pearson.com PDFs.** Enumerate from the paginated PDF sitemaps,
filter hard, fetch, extract text with page numbers. Two known hazards:

- **Scans.** The probe reports, per PDF, whether it carries a text layer, is an
  un-OCRed scan, or is a scan with OCR already applied. If a material share are
  un-OCRed, OCR is a separate piece of work with a separate budget — and the
  SharePoint/Azure route above becomes the cheaper answer.
- **Tables.** Qualification tables and deadline grids extract badly, and are
  exactly the content most likely to be the subject of a factual claim. Expect
  to special-case or exclude them rather than trust a mangled extraction.

**JCQ.** Deferred.

Ingestion is a **batch job, decoupled from analysis** — the pattern already used
for Sierra pulls. It can retry, run on a schedule, or run outside the pod and
upload. The nightly analysis run then needs no internet access at all, which
removes the egress question from the critical path whatever the answer turns out
to be.

## Relevance filter

Built in, not bolted on. From the sitemap, the CSX-relevant slice is narrow and
addressable by URL prefix — chiefly:

```
/en/support/support-topics/exams/special-requirements/*
/en/support/support-topics/results-certification/*
/en/support/support-topics/registrations-and-entries/*
/en/support/support-topics/centre-administration/*
/en/support/key-dates.html
/en/support/feedback-and-complaints*
```

covering access arrangements, special consideration, modified papers,
transferred candidates, transfer of credit, post-results services, grade
boundaries, key dates, late entries, private candidates, exam timetables and
fees.

Excluded, and it is most of the sitemap: per-subject monthly
`.updates.html?article=…` pages going back years, `.news.html?facets=…`,
`.coursematerials.html`, `.resources.html?filterQuery=…`, and large numbers of
UTM-tagged duplicates of pages already listed.

**Normalise and dedupe on canonical URL before hashing.** Otherwise the same
page is ingested nine times under nine query strings and the sweep reports
divergence between a page and itself.

## The divergence sweep

A scheduled job, independent of any transcript:

1. For each Knowledge article, retrieve the best-matching qualifications-site
   documents for its topic.
2. Where both sides cover it, ask the model a narrow question: **do these two
   passages state anything incompatible?** Not "summarise", not "which is
   right" — incompatibility only.
3. Record each finding with both passages quoted, both URLs, both versions, and
   page numbers where they exist.

Outputs three distinct things, which must not be collapsed into one:

- **`source_conflict`** — both systems cover it and they disagree. The finding
  CSX asked for.
- **`coverage_gap`** — the qualifications site (usually a PDF) covers something
  Knowledge does not. Not a contradiction; a candidate article.
- **`stale`** — both agree, but one side's `published_at` is far older.

## Confidence from evidence, not self-report

The tool should report a confidence per claim. It should **not** do so by asking
the model how confident it is: self-reported LLM confidence is poorly
calibrated and shifts between model versions, and a reviewer signing off against
"68%" is signing off against noise.

Compose it from things a reviewer can open up:

| Signal | Deterministic? |
|---|---|
| Was a candidate passage retrieved at all? | Yes |
| How strongly does it match the claim's topic? (retrieval rank) | Yes |
| Shown the passage, does the model say it supports / contradicts / does not address the claim? | No — but LLMs are reliable at this three-way call |
| Do the sources agree with each other? | Yes |

No passage retrieved is **`unverifiable`**, not low confidence — a different
thing, and it means the tool failed, not the agent. Sources disagreeing is
**`source_conflict`**, surfaced as a finding rather than averaged into a score.

Every verdict carries the quoted passage, its URL and its page. So a finding
reads: *"The agent said an application is required for 25% extra time on
Functional Skills. The guide says 25% is centre-delegated and needs no
application — page 4, quoted."* That is defensible. A percentage is not.

## Retrieval layer — open decision

Deliberately left open, because it depends on an answer from OCTO and the rest
of the design does not.

**Option A — PostgreSQL full-text search.** `tsvector`,
`websearch_to_tsquery`, `ts_rank_cd`. Deterministic, no new infrastructure, no
embeddings, no new vendor conversation. Ships now. Weaker on paraphrase: a claim
worded unlike the source may not retrieve it, producing `unverifiable` where a
human would have found the passage.

**Option B — Azure AI Search.** Blob indexer with PDF cracking and OCR
enrichment, returning chunks with document and page references, queryable
deterministically over an API. Replaces both the FTS layer *and* the PDF
extraction work while keeping the audit trail, and sits in the Microsoft estate
Pearson already has. It will not crawl the site for us — nothing will, so the
enumerate-and-fetch layer is required either way.

**Recommendation: build the enumerate-and-fetch and corpus layers first**, since
they are required under both options, and defer the storage choice until OCTO
answers. Semantic search over pgvector remains a later refinement under either,
not a prerequisite.

## robots.txt constraints

Any crawler we build respects `robots.txt`. The disallowed paths relevant here
are `*/secure/*`, `*/gold/*`, `*/silver/*`, `*/endorsed-resources/*`,
`*/events/*`, `*/case-studies/*`, `*/contact-list/*` and — awkwardly —
`*/faq-landing/*`, plus a long explicit list of BTEC specialist and NVQ
qualification pages and `/en/vocational-fees`.

`*/faq-landing/*` is the awkward one: FAQ content is plausibly exactly what CSX
answers from. If it matters, that is a conversation with the site owners about
getting the content another way — **not** something to crawl around. The
sitemaps themselves are declared in `robots.txt`, so enumerating from them is
explicitly invited.

## What we need from other teams

### From OCTO

1. **A Salesforce connected app with the client-credentials flow and read scope
   on `Knowledge__kav`.** No user context, no write scope. This is the single
   highest-value unblock in the design: it makes support.pearson.com readable as
   data instead of unreadable as HTML.
2. **Egress allowlist entries for `qualifications.pearson.com`** from wherever
   the ingestion job runs — or confirmation that ingestion should run outside
   and upload instead. The probe establishes which is needed.
3. **A view on Option B** — is an Azure AI Search index (or a SharePoint library
   with Graph-indexed extraction) something CSX can have? It removes the PDF
   extraction and OCR work from this project entirely.

### From the qualifications-site content owners

1. **Is there a CMS-native export or API** for the support-topics pages? The
   published sitemap is crawler-generated, which suggests not, but worth asking
   before building a crawler.
2. **Are the support-topics pages server-rendered?** If they are client-rendered,
   fetching them cannot work and we need the content another way.
3. **`*/faq-landing/*` is disallowed in `robots.txt`** but looks like content CSX
   answers from. Is that deliberate, and can we get at it another way?
4. **Roughly how many PDFs, and how many are scans?** The probe will measure
   both, but a straight answer is faster than inferring it from sitemap offsets.

## Already built

- **Source reachability diagnostic** (`npm run probe`) — attributes a failed
  fetch to the site, our own egress, a client-rendered page, or a wrong URL,
  keeping the raw evidence beside each verdict. Also counts PDF sitemap entries
  and reads each PDF's text layer, which answers the scale and OCR questions
  above. See the README.
- **Citation-grounded checking** — comparing an agent's claim against the
  knowledge text Sierra itself retrieved. Same judging logic as the corpus
  check, minus the retrieval step, so it needs no external access and works on
  real conversations today. This is the highest-signal check available and
  should ship first regardless of how the corpus question resolves.

## Open questions

1. Which flag the pod's test upload produced — `fetch_failed` (genuinely
   blocked) or `unverifiable` (fetch worked, nothing matched). Decides whether
   ingestion runs in the pod or outside it. The probe answers this directly.
2. The real PDF count. Inference says 30,000–35,000; the probe will measure.
3. What share of PDFs are un-OCRed scans. Changes the cost of the PDF adapter by
   an order of magnitude.
4. Whether the qualifications-site support pages are server-rendered.
5. Retrieval layer: Option A or B (above).
