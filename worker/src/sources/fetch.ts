import * as cheerio from "cheerio";
import { SOURCE_DOMAINS, type SourceDomain } from "./domains.js";
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

function extractMainText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, noscript").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return text.slice(0, MAX_EXCERPT_CHARS);
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
  const searchHtml = await fetchWithRetry(source.searchUrl(query));
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
      return { domain: source.domain, url, excerpt: extractMainText(html), fetch_ok: true };
    }
  }

  return { domain: source.domain, url: null, excerpt: null, fetch_ok: false };
}

/** Fetches all three verified sources for a single claim, in parallel. */
export async function fetchAllSources(topicKeywords: string[]): Promise<SourceExcerpt[]> {
  return Promise.all(SOURCE_DOMAINS.map((source) => fetchSourceExcerpt(source, topicKeywords)));
}
