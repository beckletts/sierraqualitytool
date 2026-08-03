/**
 * The three verified sources. Per the design doc, none is ground truth on its own —
 * jcq.org.uk is not Pearson-managed and can legitimately disagree with Pearson's pages.
 *
 * `searchUrl` is a best-effort guess at each site's search pattern — during planning,
 * every probe to these domains (including sitemap.xml) returned HTTP 403 from this
 * sandbox, so none of this could be verified against real markup. Treat the search-result
 * parsing in fetch.ts as unverified until it's run from the real target network.
 *
 * `seedUrls` starts empty by design — fabricating specific article URLs here would be
 * worse than having none. Populate it with known key pages as the team discovers which
 * topics come up most (e.g. specific policy/FAQ pages), so fetch.ts has a fallback that
 * doesn't depend on search working at all.
 */

export interface SourceDomain {
  domain: string;
  baseUrl: string;
  searchUrl: (query: string) => string;
  seedUrls: string[];
}

export const SOURCE_DOMAINS: SourceDomain[] = [
  {
    domain: "qualifications.pearson.com",
    baseUrl: "https://qualifications.pearson.com",
    searchUrl: (query) => `https://qualifications.pearson.com/en/search-results.html?q=${encodeURIComponent(query)}`,
    seedUrls: [],
  },
  {
    domain: "jcq.org.uk",
    baseUrl: "https://www.jcq.org.uk",
    searchUrl: (query) => `https://www.jcq.org.uk/?s=${encodeURIComponent(query)}`,
    seedUrls: [],
  },
  {
    domain: "support.pearson.com",
    baseUrl: "https://support.pearson.com",
    searchUrl: (query) => `https://support.pearson.com/getsupport?q=${encodeURIComponent(query)}`,
    seedUrls: [],
  },
];
