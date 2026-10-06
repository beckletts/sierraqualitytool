import { classifyTransportError, type Classification } from "./classify.js";

/**
 * Probes Salesforce Knowledge.
 *
 * support.pearson.com is Salesforce Knowledge behind an Experience Cloud front
 * end — the `/s/article/` URLs are a Lightning single-page app, which is why
 * fetching one returns a shell with no article text in it. So this is not an
 * extra source alongside support.pearson.com; it *is* support.pearson.com,
 * reachable as data rather than as rendered HTML. It is also the only one of
 * the sources that can be read completely and deterministically, which makes
 * it the one worth asking OCTO for first.
 *
 * Until those credentials exist, the probe still reports — as
 * `not_configured`, naming the variables it needs. An absent dependency that
 * says what it wants is a to-do list; one that silently skips is a gap nobody
 * remembers.
 */

const REQUIRED_VARS = ["SALESFORCE_INSTANCE_URL", "SALESFORCE_CLIENT_ID", "SALESFORCE_CLIENT_SECRET"] as const;

const DEFAULT_API_VERSION = "v61.0";
const TIMEOUT_MS = 15_000;

export interface KnowledgeApiProbe {
  url: string;
  classification: Classification;
  httpStatus: number | null;
  elapsedMs: number;
  findings: Record<string, unknown>;
}

function missingVars(): string[] {
  return REQUIRED_VARS.filter((name) => !process.env[name]);
}

async function withTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Client-credentials flow: no user context, which is what a background reader
 * should have. The response carries an access token, so nothing from it is
 * returned to the caller beyond the status.
 */
async function fetchAccessToken(instanceUrl: string): Promise<{ token: string } | { failure: Classification; status: number | null }> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.SALESFORCE_CLIENT_ID!,
    client_secret: process.env.SALESFORCE_CLIENT_SECRET!,
  });

  let res: Response;
  try {
    res = await withTimeout(new URL("/services/oauth2/token", instanceUrl).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (err) {
    return { failure: classifyTransportError(err), status: null };
  }

  if (!res.ok) {
    // Salesforce returns `{"error":"invalid_client", ...}` here. The error code
    // is safe and is the whole diagnostic; the body could in principle carry
    // more, so only the recognised fields are read out of it.
    let errorCode = "unknown";
    let errorDescription = "";
    try {
      const parsed = (await res.json()) as { error?: unknown; error_description?: unknown };
      if (typeof parsed.error === "string") errorCode = parsed.error;
      if (typeof parsed.error_description === "string") errorDescription = parsed.error_description;
    } catch {
      // Non-JSON body — the status alone has to carry it.
    }
    return {
      failure: {
        verdict: "http_error",
        detail: `Token request refused: HTTP ${res.status} ${errorCode}${errorDescription ? ` (${errorDescription})` : ""}. The host was reached, so this is a credential or connected-app scope problem, not a network one.`,
      },
      status: res.status,
    };
  }

  const json = (await res.json()) as { access_token?: unknown };
  if (typeof json.access_token !== "string") {
    return {
      failure: { verdict: "http_error", detail: "Token endpoint answered 200 with no access_token in the body." },
      status: res.status,
    };
  }
  return { token: json.access_token };
}

export async function probeKnowledgeApi(): Promise<KnowledgeApiProbe> {
  const missing = missingVars();
  const instanceUrl = process.env.SALESFORCE_INSTANCE_URL ?? "";
  const apiVersion = process.env.SALESFORCE_API_VERSION ?? DEFAULT_API_VERSION;
  const started = Date.now();

  if (missing.length > 0) {
    return {
      url: instanceUrl || "(no SALESFORCE_INSTANCE_URL set)",
      classification: {
        verdict: "not_configured",
        detail: `Not attempted — ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} unset. This is the access to request from OCTO: a connected app with read scope on Knowledge, client-credentials flow.`,
      },
      httpStatus: null,
      elapsedMs: 0,
      findings: { missing_env_vars: missing, required_env_vars: [...REQUIRED_VARS], api_version: apiVersion },
    };
  }

  const auth = await fetchAccessToken(instanceUrl);
  if ("failure" in auth) {
    return {
      url: new URL("/services/oauth2/token", instanceUrl).toString(),
      classification: auth.failure,
      httpStatus: auth.status,
      elapsedMs: Date.now() - started,
      findings: { stage: "oauth_token", api_version: apiVersion },
    };
  }

  // COUNT() rather than a row fetch: the question at this stage is how large
  // the corpus is, and a count returns no article content to handle.
  const soql = "SELECT COUNT() FROM Knowledge__kav WHERE PublishStatus = 'Online'";
  const queryUrl = new URL(`/services/data/${apiVersion}/query`, instanceUrl);
  queryUrl.searchParams.set("q", soql);

  let res: Response;
  try {
    res = await withTimeout(queryUrl.toString(), { headers: { Authorization: `Bearer ${auth.token}` } });
  } catch (err) {
    return {
      url: queryUrl.toString(),
      classification: classifyTransportError(err),
      httpStatus: null,
      elapsedMs: Date.now() - started,
      findings: { stage: "query", api_version: apiVersion },
    };
  }

  const elapsedMs = Date.now() - started;

  if (!res.ok) {
    return {
      url: queryUrl.toString(),
      classification: {
        verdict: "http_error",
        detail: `Authenticated fine, but the Knowledge query returned HTTP ${res.status}. Usually means the connected app has no read access to Knowledge__kav — a permission-set change rather than a new credential.`,
      },
      httpStatus: res.status,
      elapsedMs,
      findings: { stage: "query", authenticated: true, api_version: apiVersion },
    };
  }

  const json = (await res.json()) as { totalSize?: unknown };
  const articleCount = typeof json.totalSize === "number" ? json.totalSize : null;

  return {
    url: queryUrl.toString(),
    classification: {
      verdict: "ok",
      detail:
        articleCount === null
          ? "Authenticated and queried Knowledge successfully."
          : `Authenticated and read Knowledge: ${articleCount.toLocaleString()} published article(s). This is support.pearson.com's content, as data — no scraping needed for that source.`,
    },
    httpStatus: res.status,
    elapsedMs,
    findings: { stage: "query", authenticated: true, api_version: apiVersion, published_article_count: articleCount },
  };
}
