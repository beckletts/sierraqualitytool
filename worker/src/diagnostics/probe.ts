import * as cheerio from "cheerio";
import { classifyResponse, classifyTransportError, type Classification } from "./classify.js";
import { inspectPdf } from "./pdf.js";
import { probeKnowledgeApi } from "./salesforce.js";
import { buildTargets, type ProbeTarget, type BuildTargetsOptions } from "./targets.js";
import type { SourceDomain } from "../sources/domains.js";

const TIMEOUT_MS = 20_000;
const BODY_SAMPLE_CHARS = 1200;
/** Enough to classify anything; a 30,000-entry sitemap is not worth pulling whole into a diagnostic. */
const MAX_BODY_BYTES = 3_000_000;

/**
 * The same headers `sources/fetch.ts` sends, so that a difference between the
 * probe's result and the pipeline's result is a real difference and not an
 * artefact of the probe looking like a different client.
 */
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

export interface ProbeResult {
  target: ProbeTarget;
  verdict: Classification["verdict"];
  detail: string;
  httpStatus: number | null;
  contentType: string | null;
  bytes: number | null;
  elapsedMs: number;
  bodySample: string | null;
  findings: Record<string, unknown>;
}

/**
 * PostgreSQL `text` cannot hold a NUL, and a binary body sliced for a sample
 * is full of them — a PDF body sample would fail the insert and lose the whole
 * run, which is a poor way for a diagnostic to behave. Other C0 controls are
 * stripped too: they store fine but render as invisible junk in the Admin page,
 * and the only reason the sample exists is to be read.
 */
function sanitiseForText(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "·");
}

function extractProse(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, noscript").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

function countSitemapEntries(xml: string): number {
  return (xml.match(/<url>/g) ?? []).length;
}

function headerMap(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

async function probeOne(target: ProbeTarget): Promise<ProbeResult> {
  const started = Date.now();

  let res: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      res = await fetch(target.url, { headers: BROWSER_HEADERS, signal: controller.signal, redirect: "follow" });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const classification = classifyTransportError(err);
    return {
      target,
      verdict: classification.verdict,
      detail: classification.detail,
      httpStatus: null,
      contentType: null,
      bytes: null,
      elapsedMs: Date.now() - started,
      bodySample: null,
      findings: {},
    };
  }

  const buffer = Buffer.from((await res.arrayBuffer()).slice(0, MAX_BODY_BYTES));
  const elapsedMs = Date.now() - started;
  const contentType = res.headers.get("content-type");
  const findings: Record<string, unknown> = {};

  // Decoded as latin1 so that PDF and other binary bodies produce a readable
  // sample instead of replacement characters — the sample is read by a person
  // deciding who refused the request, and mojibake hides the answer.
  const isProbablyText = !(contentType ?? "").includes("pdf");
  const bodyText = isProbablyText ? buffer.toString("utf-8") : buffer.toString("latin1");
  const bodySample = sanitiseForText(bodyText.slice(0, BODY_SAMPLE_CHARS));

  let extractedTextLength: number | undefined;
  if (target.expectProse && (contentType ?? "").includes("html")) {
    const prose = extractProse(bodyText);
    extractedTextLength = prose.length;
    findings.extracted_text_chars = prose.length;
    // jsonb rejects a NUL escape just as `text` rejects the byte, so the same
    // sanitisation applies to anything going into `findings`.
    findings.extracted_text_sample = sanitiseForText(prose.slice(0, 500));
  }

  if (target.countSitemapUrls) {
    const entries = countSitemapEntries(bodyText);
    findings.sitemap_url_count = entries;
    findings.sitemap_truncated = buffer.byteLength >= MAX_BODY_BYTES;
  }

  if (target.expectPdf) {
    const shape = inspectPdf(buffer);
    findings.pdf = {
      is_pdf: shape.isPdf,
      text_layer: shape.textLayer,
      font_refs: shape.fontRefs,
      image_xobjects: shape.imageXObjects,
      text_operators: shape.textOperators,
      page_count_estimate: shape.pageCountEstimate,
      summary: shape.summary,
    };
  }

  const classification = classifyResponse({
    status: res.status,
    contentType,
    headers: headerMap(res),
    bodySample,
    byteLength: buffer.byteLength,
    extractedTextLength,
    okStatuses: target.okStatuses,
  });

  // The PDF reading is the answer for a PDF target, so it leads the detail —
  // "HTTP 200, 400,000 bytes" is true and useless next to "scanned, no text".
  const detail =
    target.expectPdf && classification.verdict === "ok"
      ? `${classification.detail} ${(findings.pdf as { summary: string }).summary}`
      : classification.detail;

  return {
    target,
    verdict: classification.verdict,
    detail,
    httpStatus: res.status,
    contentType,
    bytes: buffer.byteLength,
    elapsedMs,
    bodySample,
    findings,
  };
}

/** Modest concurrency: enough to keep a ~20-target run under a minute, gentle enough not to look like a crawl. */
const CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface RunProbesOptions extends BuildTargetsOptions {
  onResult?: (result: ProbeResult) => void;
}

export async function runProbes(sources: SourceDomain[], options: RunProbesOptions = {}): Promise<ProbeResult[]> {
  const { referenceOnly, onResult } = options;
  const targets = buildTargets(sources, { referenceOnly });

  const httpResults = await mapWithConcurrency(targets, CONCURRENCY, async (target) => {
    const result = await probeOne(target);
    onResult?.(result);
    return result;
  });

  const knowledge = await probeKnowledgeApi();
  const knowledgeResult: ProbeResult = {
    target: {
      kind: "knowledge_api",
      domain: "support.pearson.com",
      label: "Salesforce Knowledge API (published article count)",
      url: knowledge.url,
      expectProse: false,
      expectPdf: false,
      countSitemapUrls: false,
    },
    verdict: knowledge.classification.verdict,
    detail: knowledge.classification.detail,
    httpStatus: knowledge.httpStatus,
    contentType: null,
    bytes: null,
    elapsedMs: knowledge.elapsedMs,
    bodySample: null,
    findings: knowledge.findings,
  };
  onResult?.(knowledgeResult);

  return [...httpResults, knowledgeResult];
}
