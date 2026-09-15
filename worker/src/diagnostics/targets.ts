import { buildSearchUrl, type SourceDomain } from "../sources/domains.js";

export type TargetKind =
  | "control"
  | "robots"
  | "sitemap"
  | "search"
  | "seed_url"
  | "reference_page"
  | "reference_pdf"
  | "knowledge_api";

export interface ProbeTarget {
  kind: TargetKind;
  /** The knowledge_sources domain this belongs to, where it belongs to one. */
  domain: string | null;
  label: string;
  url: string;
  /** Extract prose and judge whether there was any. Only for targets meant to hold an article. */
  expectProse: boolean;
  /** Inspect the bytes as a PDF. */
  expectPdf: boolean;
  /** Count <url> entries, for sitemaps. */
  countSitemapUrls: boolean;
  /**
   * Statuses that mean "we reached it", beyond 2xx. An unauthenticated probe of
   * an API that answers 401 has proved reachability, which is the only thing
   * being asked.
   */
  okStatuses?: number[];
}

/**
 * Controls. Neither is a Pearson source — they exist so that a page of
 * failures can be read correctly. If these fail too, nothing is reachable and
 * no conclusion about Pearson can be drawn from the rest of the run.
 */
const CONTROLS: ProbeTarget[] = [
  {
    kind: "control",
    domain: null,
    label: "General outbound HTTPS",
    url: "https://example.com/",
    expectProse: false,
    expectPdf: false,
    countSitemapUrls: false,
  },
  {
    kind: "control",
    domain: null,
    label: "Anthropic API reachable (401 expected without a key)",
    url: "https://api.anthropic.com/v1/models",
    expectProse: false,
    expectPdf: false,
    countSitemapUrls: false,
    okStatuses: [401],
  },
];

/**
 * Fixed reference targets: the specific URLs that answer the questions open on
 * this design right now, rather than a general crawl.
 *
 * The two sitemap offsets are the PDF-count bracket test. robots.txt declares
 * PDF sitemap pages in steps of 5,000 up to offset=30000, which implies a PDF
 * count somewhere north of 30,000 — an order of magnitude above the working
 * estimate, and the difference between "mirror the PDFs" and "never mirror the
 * PDFs". Whether offset=30000 comes back full or nearly empty settles it, so
 * the probe counts the entries instead of leaving it as homework.
 */
const REFERENCE_TARGETS: ProbeTarget[] = [
  {
    kind: "sitemap",
    domain: "qualifications.pearson.com",
    label: "HTML sitemap",
    url: "https://qualifications.pearson.com/en/sitemap1.xml",
    expectProse: false,
    expectPdf: false,
    countSitemapUrls: true,
  },
  {
    kind: "sitemap",
    domain: "qualifications.pearson.com",
    label: "PDF sitemap, first page (bracket test: is it dense?)",
    url: "https://qualifications.pearson.com/en/sitemap1.xml?type=pdf&offset=0",
    expectProse: false,
    expectPdf: false,
    countSitemapUrls: true,
  },
  {
    kind: "sitemap",
    domain: "qualifications.pearson.com",
    label: "PDF sitemap, last declared page (bracket test: how many really?)",
    url: "https://qualifications.pearson.com/en/sitemap1.xml?type=pdf&offset=30000",
    expectProse: false,
    expectPdf: false,
    countSitemapUrls: true,
  },
  {
    kind: "sitemap",
    domain: "qualifications.pearson.com",
    label: "PDF sitemap, past the last declared page (expect empty)",
    url: "https://qualifications.pearson.com/en/sitemap1.xml?type=pdf&offset=35000",
    expectProse: false,
    expectPdf: false,
    countSitemapUrls: true,
  },
  {
    // The URL the app's own citation fixture points at, so a failure here is a
    // failure on the path the pipeline actually takes.
    kind: "reference_page",
    domain: "qualifications.pearson.com",
    label: "Access arrangements support page",
    url: "https://qualifications.pearson.com/en/support/support-topics/exams/access-arrangements.html",
    expectProse: true,
    expectPdf: false,
    countSitemapUrls: false,
  },
  {
    kind: "reference_page",
    domain: "qualifications.pearson.com",
    label: "Key dates support page",
    url: "https://qualifications.pearson.com/en/support/key-dates.html",
    expectProse: true,
    expectPdf: false,
    countSitemapUrls: false,
  },
  {
    // Expected to come back as a JavaScript shell: /s/article/ is Salesforce
    // Experience Cloud, so the article body never appears in the HTML. If that
    // is what the run shows, the conclusion is not "try harder at scraping" —
    // it is that this whole source has to come from the Knowledge API.
    kind: "reference_page",
    domain: "support.pearson.com",
    label: "Functional Skills access arrangements article (Salesforce-rendered)",
    url: "https://support.pearson.com/uk/s/article/Access-Arrangements-Guide-for-Functional-Skills-Access-Arrangements",
    expectProse: true,
    expectPdf: false,
    countSitemapUrls: false,
  },
  {
    // Same guidance as the article above, but as a static file. Known to load
    // without JavaScript, which is why it is the control for "the content is
    // reachable even when the page is not".
    kind: "reference_pdf",
    domain: "qualifications.pearson.com",
    label: "Functional Skills access arrangements guide (PDF)",
    url: "https://qualifications.pearson.com/content/dam/pdf/Support/Access-arrangements/guide-functional-skills-access-arrangements.pdf",
    expectProse: false,
    expectPdf: true,
    countSitemapUrls: false,
  },
];

/** A representative query, so the search probe exercises a real topic rather than an empty one. */
const SEARCH_PROBE_QUERY = "access arrangements extra time";

/**
 * Per-source targets derived from the editable `knowledge_sources` rows, so a
 * source added on the Settings page is probed without touching this file.
 */
function targetsForSource(source: SourceDomain): ProbeTarget[] {
  const targets: ProbeTarget[] = [
    {
      kind: "robots",
      domain: source.domain,
      label: "robots.txt",
      url: new URL("/robots.txt", source.baseUrl).toString(),
      expectProse: false,
      expectPdf: false,
      countSitemapUrls: false,
    },
    {
      kind: "search",
      domain: source.domain,
      label: `Site search ("${SEARCH_PROBE_QUERY}")`,
      url: buildSearchUrl(source, SEARCH_PROBE_QUERY),
      expectProse: true,
      expectPdf: false,
      countSitemapUrls: false,
    },
  ];

  for (const [index, url] of source.seedUrls.entries()) {
    targets.push({
      kind: "seed_url",
      domain: source.domain,
      label: `Seed URL ${index + 1}`,
      url,
      expectProse: !url.toLowerCase().endsWith(".pdf"),
      expectPdf: url.toLowerCase().endsWith(".pdf"),
      countSitemapUrls: false,
    });
  }

  return targets;
}

export interface BuildTargetsOptions {
  /**
   * Skip the database-driven per-source targets and probe only the controls
   * and the fixed reference URLs. This is the mode for running from a laptop
   * with no `DATABASE_URL` — the comparison that matters most is between the
   * deployed environment's answer and a known-good network's answer, and
   * requiring database access to get the second one would make it not happen.
   */
  referenceOnly?: boolean;
}

export function buildTargets(sources: SourceDomain[], options: BuildTargetsOptions = {}): ProbeTarget[] {
  if (options.referenceOnly) return [...CONTROLS, ...REFERENCE_TARGETS];

  const configuredDomains = new Set(sources.map((s) => s.domain));

  return [
    ...CONTROLS,
    ...sources.flatMap(targetsForSource),
    // A reference target for a source nobody has configured would report a
    // failure against a source the app does not use, which reads as a problem
    // when it is not one.
    ...REFERENCE_TARGETS.filter((t) => t.domain === null || configuredDomains.has(t.domain)),
  ];
}
