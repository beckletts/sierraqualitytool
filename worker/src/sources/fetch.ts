import * as cheerio from "cheerio";
import { buildSearchUrl, type SourceDomain } from "./domains.js";
import type { SourceExcerpt } from "../analysis/prompts.js";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const MAX_EXCERPT_CHARS = 4000;
const MAX_CANDIDATE_URLS = 3;

async function fetchWithRetry(url: string): Promise<string | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(url, { headers: BROWSER_HEADERS, signal: controller.signal });
        if (!res.ok) {
          if (res.status === 429 && attempt < MAX_RETRIES) {
            await sleep(backoffMs(attempt));
            continue;
          }
          return null;
        }
        return await res.text();
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      if (attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }
      return null;
    }
  }
  return null;
}

function backoffMs(attempt: number): number {
  const base = 500 * 2 ** attempt;
  return base + Math.floor(Math.random() * 250);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A flat first-N-chars slice often grabs boilerplate (breadcrumbs, cookie
 * notices, related-links lists) ahead of the actual relevant paragraph.
 * If a topic keyword literally appears in the page, center the window on
 * its first occurrence instead. Falls back to the start of the page when
 * no keyword matches (e.g. paraphrased wording) — same as before.
 */
function findWindowStart(text: string, topicKeywords: string[]): number {
  if (topicKeywords.length === 0) return 0;
  const lower = text.toLowerCase();
  let earliestMatch = -1;
  for (const keyword of topicKeywords) {
    const idx = lower.indexOf(keyword.toLowerCase());
    if (idx !== -1 && (earliestMatch === -1 || idx < earliestMatch)) earliestMatch = idx;
  }
  if (earliestMatch === -1) return 0;
  const leadIn = Math.floor(MAX_EXCERPT_CHARS * 0.25);
  return Math.max(0, earliestMatch - leadIn);
}

function extractMainText(html: string, topicKeywords: string[]): string {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, noscript").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const start = findWindowStart(text, topicKeywords);
  return text.slice(start, start + MAX_EXCERPT_CHARS);
}

/** Best-effort: pull candidate result links out of a search results page. Unverified against real markup (see domains.ts). */
function extractCandidateLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    if (links.size >= MAX_CANDIDATE_URLS) return;
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.hostname.endsWith(new URL(baseUrl).hostname) && !resolved.pathname.match(/search|\?s=/)) {
        links.add(resolved.toString());
      }
    } catch {
      // ignore malformed hrefs
    }
  });
  return Array.from(links);
}

async function resolveCandidateUrls(source: SourceDomain, query: string): Promise<string[]> {
  const searchHtml = await fetchWithRetry(buildSearchUrl(source, query));
  const found = searchHtml ? extractCandidateLinks(searchHtml, source.baseUrl) : [];
  if (found.length > 0) return found;
  return source.seedUrls;
}

/** Fetches the best-effort matching page for a claim from a single source domain. */
export async function fetchSourceExcerpt(source: SourceDomain, topicKeywords: string[]): Promise<SourceExcerpt> {
  const query = topicKeywords.join(" ");
  const candidates = await resolveCandidateUrls(source, query);

  for (const url of candidates) {
    const html = await fetchWithRetry(url);
    if (html) {
      return { domain: source.domain, url, excerpt: extractMainText(html, topicKeywords), fetch_ok: true };
    }
  }

  return { domain: source.domain, url: null, excerpt: null, fetch_ok: false };
}

/** Fetches all enabled verified sources for a single claim, in parallel. */
export async function fetchAllSources(topicKeywords: string[], sources: SourceDomain[]): Promise<SourceExcerpt[]> {
  return Promise.all(sources.map((source) => fetchSourceExcerpt(source, topicKeywords)));
}
