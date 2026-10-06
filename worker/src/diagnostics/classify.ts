/**
 * Turns one HTTP attempt into a verdict.
 *
 * The distinction this file exists to draw is between a site refusing us and
 * our own network refusing us. Both surface as a failed fetch, and the fix for
 * one (talk to the site owner, respect robots.txt, use an API instead) is
 * nothing like the fix for the other (an egress allowlist entry). Getting this
 * wrong is not hypothetical: this app's own README records "every probe
 * returned 403" as evidence that Pearson blocks crawlers, which is very likely
 * a build sandbox's egress policy misread as a site-level refusal.
 *
 * Every rule below is a heuristic on observable signals, so the caller stores
 * the raw status, content type and body slice next to the verdict. When the
 * verdict and the evidence disagree, the evidence wins.
 */

export type Verdict =
  | "ok"
  | "js_shell"
  | "empty_body"
  | "http_error"
  | "blocked_by_proxy"
  | "dns_failure"
  | "tls_failure"
  | "timeout"
  | "transport_error"
  | "not_configured";

export interface Classification {
  verdict: Verdict;
  detail: string;
}

/** Node surfaces the useful part of a network failure on `cause.code`, not on `message`. */
function errorCode(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const cause = (err as { cause?: unknown }).cause;
  const code = (cause as { code?: unknown })?.code ?? (err as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const causeMessage = cause instanceof Error ? cause.message : null;
    return causeMessage && causeMessage !== err.message ? `${err.message}: ${causeMessage}` : err.message;
  }
  return String(err);
}

const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN"]);

const TLS_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/**
 * A TLS-terminating proxy that refuses a CONNECT mid-handshake produces these
 * rather than a clean HTTP response, so they read as transport faults even
 * though the cause is policy. Reported as `blocked_by_proxy` with the code
 * quoted, because a genuine network fault looks the same and the code is the
 * only way for a reader to tell.
 */
const PROXY_TRANSPORT_CODES = new Set(["ECONNRESET", "EPROTO", "ERR_TLS_HANDSHAKE_TIMEOUT"]);

const PROXY_TRANSPORT_MESSAGES = [
  "client network socket disconnected before secure tls connection was established",
  "tunneling socket could not be established",
  "connect tunnel failed",
  "proxy connection ended before receiving connect response",
  "blocked by the network egress proxy",
];

/**
 * Markers that a 4xx came from the site's own edge rather than from something
 * in the middle. Akamai and Cloudflare both serve recognisable bodies, and
 * qualifications.pearson.com sits behind Akamai — an Akamai reference number
 * in a 403 body is close to proof that the request reached Pearson.
 */
const SITE_EDGE_MARKERS = [
  "akamai",
  "reference #",
  "cloudflare",
  "cf-ray",
  "access denied",
  "you don't have permission to access",
  "request could not be satisfied",
  "<!doctype html",
  "<html",
];

/** Shapes a single-page app serves before its JavaScript runs. */
const SPA_MARKERS = [
  "auraconfig", // Salesforce Lightning / Experience Cloud
  "lightning/",
  "window.__initialstate__",
  "<div id=\"root\"></div>",
  "<div id=\"app\"></div>",
  "please enable javascript",
  "you need to enable javascript",
];

/** Below this much extracted prose, an HTML 200 has nothing a verifier could read. */
const MIN_USEFUL_TEXT_CHARS = 400;

export function classifyTransportError(err: unknown): Classification {
  const code = errorCode(err);
  const message = errorMessage(err);
  const lower = message.toLowerCase();

  if (err instanceof Error && err.name === "AbortError") {
    return { verdict: "timeout", detail: "No response before the timeout — no status to report." };
  }

  if (code && DNS_CODES.has(code)) {
    return { verdict: "dns_failure", detail: `Hostname did not resolve (${code}). Check the URL before suspecting the network.` };
  }

  if (code && TLS_CODES.has(code)) {
    return {
      verdict: "tls_failure",
      detail: `TLS verification failed (${code}). Usually an intercepting proxy presenting its own certificate — the CA bundle needs trusting, not the check disabling.`,
    };
  }

  if (PROXY_TRANSPORT_MESSAGES.some((m) => lower.includes(m))) {
    return {
      verdict: "blocked_by_proxy",
      detail: `Connection refused before any HTTPS response: "${message}". This is the network between us and the site, not the site.`,
    };
  }

  if (code && PROXY_TRANSPORT_CODES.has(code)) {
    return {
      verdict: "blocked_by_proxy",
      detail: `Connection dropped during setup (${code}). Typical of a proxy declining the tunnel, though a genuine network fault looks identical — re-run before concluding.`,
    };
  }

  return { verdict: "transport_error", detail: `Request failed before a response: ${message}` };
}

export interface ResponseFacts {
  status: number;
  contentType: string | null;
  /** Response headers, lowercased keys — proxy products tend to announce themselves here. */
  headers: Record<string, string>;
  bodySample: string;
  byteLength: number;
  /** Prose extracted from an HTML body, where the target was HTML. */
  extractedTextLength?: number;
  /** Non-2xx statuses that still prove reachability for this particular target. */
  okStatuses?: number[];
}

/** Header names that only a middlebox sets. Their presence on a refusal names the refuser. */
const PROXY_HEADER_HINTS = ["x-deny-reason", "x-agentproxy", "proxy-agent", "proxy-authenticate", "x-squid-error", "via"];

/**
 * Phrases a middlebox uses to explain itself. Unlike the header and body-size
 * heuristics below, a match here is close to conclusive — no site describes its
 * own refusal in terms of an allowlist or an egress policy — so it is checked
 * first and reported without hedging.
 */
const PROXY_DENIAL_MARKERS = [
  "not in allowlist",
  "not in the allowlist",
  "host_not_allowed",
  "egress settings",
  "egress policy",
  "egress proxy",
  "denied by policy",
  "blocked by network policy",
  "proxy policy",
];

export function classifyResponse(facts: ResponseFacts): Classification {
  const { status, contentType, headers, bodySample, byteLength } = facts;
  const lowerBody = bodySample.toLowerCase();

  // Checked before the refusal rules below, because the statuses that prove a
  // reachability probe worked (an API answering 401 to an unauthenticated
  // request) are the same ones that mean refusal anywhere else.
  if (facts.okStatuses?.includes(status)) {
    return { verdict: "ok", detail: `HTTP ${status} — the expected answer to an unauthenticated request, so the host is reachable.` };
  }

  if (status === 407) {
    return { verdict: "blocked_by_proxy", detail: "HTTP 407 Proxy Authentication Required — the refusal is from our proxy, which the site never saw." };
  }

  if (status === 403 || status === 401) {
    const proxyMarker = PROXY_DENIAL_MARKERS.find((m) => lowerBody.includes(m));
    if (proxyMarker) {
      const reason = headers["x-deny-reason"];
      return {
        verdict: "blocked_by_proxy",
        detail: `Refused by this network, not by the site: HTTP ${status} explaining itself as "${proxyMarker}"${reason ? ` (x-deny-reason: ${reason})` : ""}. The request never left our egress. Add the host to the allowlist and re-run.`,
      };
    }

    const proxyHeader = PROXY_HEADER_HINTS.find((h) => h in headers);
    const looksLikeSiteEdge = SITE_EDGE_MARKERS.some((m) => lowerBody.includes(m));

    if (proxyHeader && !looksLikeSiteEdge) {
      return {
        verdict: "blocked_by_proxy",
        detail: `HTTP ${status} carrying a "${proxyHeader}" header and no site content — refused in transit rather than by the site.`,
      };
    }
    if (looksLikeSiteEdge) {
      return {
        verdict: "http_error",
        detail: `HTTP ${status} from the site's own edge (its error page came back). The request reached the site and was refused there — a robots or permission conversation, not a firewall one.`,
      };
    }
    // A bare, bodiless 403 is the signature this app's README mistook for a
    // site-level block on crawlers.
    if (byteLength < 200) {
      return {
        verdict: "blocked_by_proxy",
        detail: `HTTP ${status} with an almost empty body (${byteLength} bytes) and no site error page — more like a policy denial in transit than a refusal by the site, but not conclusive. Re-run from a different network to confirm.`,
      };
    }
    return { verdict: "http_error", detail: `HTTP ${status}. Body present but unattributable — read the sample before concluding who refused.` };
  }

  if (status >= 400) {
    return { verdict: "http_error", detail: `HTTP ${status}${status === 404 ? " — the URL is wrong or the page has moved." : "."}` };
  }

  if (byteLength === 0) {
    return { verdict: "empty_body", detail: `HTTP ${status} with a zero-length body.` };
  }

  const isHtml = (contentType ?? "").includes("html");
  if (isHtml && facts.extractedTextLength !== undefined && facts.extractedTextLength < MIN_USEFUL_TEXT_CHARS) {
    const spaMarker = SPA_MARKERS.find((m) => lowerBody.includes(m));
    return {
      verdict: "js_shell",
      detail: spaMarker
        ? `HTTP ${status}, but the HTML is a JavaScript shell (${facts.extractedTextLength} chars of text; matched "${spaMarker}"). The content is rendered client-side, so no amount of fetching will read it — this source needs an API.`
        : `HTTP ${status}, but only ${facts.extractedTextLength} characters of readable text came back. Likely rendered client-side.`,
    };
  }

  return { verdict: "ok", detail: `HTTP ${status}, ${byteLength.toLocaleString()} bytes of ${contentType ?? "unknown type"}.` };
}
