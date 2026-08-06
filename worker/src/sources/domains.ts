/**
 * The verified sources — loaded from the `knowledge_sources` table (editable
 * via the web app's Settings page), not hardcoded here anymore. See
 * `config/loadConfig.ts` for the loader.
 *
 * Per the design doc, none is ground truth on its own — jcq.org.uk is not
 * Pearson-managed and can legitimately disagree with Pearson's own pages.
 *
 * `searchUrlTemplate` is a best-effort guess at each site's search pattern —
 * during planning, every probe to these domains (including sitemap.xml)
 * returned HTTP 403 from the build sandbox, so none of this could be
 * verified against real markup. Treat the search-result parsing in fetch.ts
 * as unverified until it's run from the real target network.
 *
 * `seedUrls` starts empty by design — fabricating specific article URLs here
 * would be worse than having none. Populate it via Settings with known key
 * pages as the team discovers which topics come up most, so fetch.ts has a
 * fallback that doesn't depend on search working at all.
 */

export interface SourceDomain {
  domain: string;
  baseUrl: string;
  /** Contains the literal placeholder "{query}", substituted at fetch time. */
  searchUrlTemplate: string;
  seedUrls: string[];
}

export function buildSearchUrl(source: SourceDomain, query: string): string {
  return source.searchUrlTemplate.replace("{query}", encodeURIComponent(query));
}
