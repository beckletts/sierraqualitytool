export type CompetencyLevel = "Training Need" | "Developing" | "Good" | "Excellent";
export type Competency = "data_protection" | "communication" | "knowledge_guidance" | "ownership";
export type FlagStatus = "verified" | "drift" | "unverifiable" | "source_conflict" | "fetch_failed";
export type InterventionPriority = "hard_flag" | "soft_flag" | "none";
export type InteractionStatus = "pending" | "reviewed";

export interface TranscriptMessage {
  role: string;
  text: string;
}

export interface CompetencyScore {
  level: CompetencyLevel;
  rationale: string;
}

export interface SourceExcerpt {
  domain: string;
  url: string | null;
  excerpt: string | null;
  fetch_ok: boolean;
}

export interface Interaction {
  id: string;
  agent_id: string;
  sierra_conversation_id: string;
  transcript: TranscriptMessage[];
  pulled_at: string;
  conversation_started_at: string | null;
  tags: string[];
  custom_fields: Record<string, unknown>;
  device: string | null;
  competency_scores: Record<Competency, CompetencyScore>;
  intervention_priority: InterventionPriority;
  status: InteractionStatus;
  signed_off_at: string | null;
  signed_off_by: string | null;
  created_at: string;
}

/** conversation_started_at is null for interactions written before that column existed. */
export function interactionDate(interaction: Interaction): string {
  return interaction.conversation_started_at ?? interaction.pulled_at;
}

export interface Claim {
  id: string;
  interaction_id: string;
  claim_text: string;
  flag_status: FlagStatus;
  confidence: number | null;
  rationale: string | null;
  sources: SourceExcerpt[];
  created_at: string;
}

export type ReviewAction = "confirm_flag" | "override_flag" | "adjust_competency" | "add_note" | "sign_off";

export interface Review {
  id: string;
  interaction_id: string;
  claim_id: string | null;
  reviewer_id: string;
  reviewer_email: string;
  action: ReviewAction;
  field: string | null;
  previous_value: unknown;
  new_value: unknown;
  note: string | null;
  created_at: string;
}

export const COMPETENCY_LABELS: Record<Competency, string> = {
  data_protection: "Data Protection",
  communication: "Communication",
  knowledge_guidance: "Knowledge & Guidance",
  ownership: "Ownership",
};

export const COMPETENCY_LEVELS: CompetencyLevel[] = ["Training Need", "Developing", "Good", "Excellent"];

export const FLAG_LABELS: Record<FlagStatus, string> = {
  verified: "Verified",
  drift: "Drift / contradiction",
  unverifiable: "Unverifiable",
  source_conflict: "Source conflict",
  fetch_failed: "Fetch failed",
};

/**
 * A Sierra AI agent. Each one has its own Admin API token, which deliberately
 * lives in the worker's environment rather than in this table — `token_env_var`
 * names the variable, so the whole review team can maintain agents without
 * anyone handling a credential.
 */
export interface Agent {
  id: string;
  sierra_agent_id: string;
  name: string;
  environment: string;
  sierra_base_url: string;
  sierra_org_id: string;
  token_env_var: string;
  enabled: boolean;
  notes: string | null;
  updated_at: string;
}

export interface KnowledgeSource {
  id: string;
  domain: string;
  base_url: string;
  search_url_template: string;
  seed_urls: string[];
  enabled: boolean;
  updated_at: string;
}

export interface GuidelineRow {
  competency: Competency;
  level: CompetencyLevel;
  descriptor: string;
  updated_at: string;
}

/**
 * One HTTP attempt from a source-reachability probe run.
 *
 * `verdict` is a heuristic; `http_status`, `body_sample` and `findings` are the
 * evidence it was derived from, which is why the Admin page shows them rather
 * than just the verdict. When a claim in the queue reads `fetch_failed`, this
 * is where the reason lives.
 */
export type ProbeVerdict =
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

export type ProbeTargetKind =
  | "control"
  | "robots"
  | "sitemap"
  | "search"
  | "seed_url"
  | "reference_page"
  | "reference_pdf"
  | "knowledge_api";

/** A row of `latest_source_probe_run()` — the run's columns repeat on every probe row. */
export interface ProbeRow {
  run_id: string;
  started_at: string;
  finished_at: string | null;
  ran_from: string;
  notes: string | null;
  target_kind: ProbeTargetKind;
  domain: string | null;
  label: string;
  url: string;
  verdict: ProbeVerdict;
  http_status: number | null;
  content_type: string | null;
  bytes: number | null;
  elapsed_ms: number | null;
  detail: string;
  body_sample: string | null;
  findings: Record<string, unknown>;
}

export const PROBE_VERDICT_LABELS: Record<ProbeVerdict, string> = {
  ok: "Reachable",
  js_shell: "JavaScript shell",
  empty_body: "Empty response",
  http_error: "Refused by the site",
  blocked_by_proxy: "Blocked in transit",
  dns_failure: "Did not resolve",
  tls_failure: "TLS failure",
  timeout: "Timed out",
  transport_error: "Transport error",
  not_configured: "Not configured",
};

export const PROBE_TARGET_KIND_LABELS: Record<ProbeTargetKind, string> = {
  control: "Controls",
  robots: "robots.txt",
  sitemap: "Sitemaps",
  search: "Site search",
  seed_url: "Seed URLs",
  reference_page: "Reference pages",
  reference_pdf: "Reference PDFs",
  knowledge_api: "Knowledge API",
};

/**
 * Which verdicts are the app's problem to fix versus the source's. A blocked
 * or unresolved host is an egress or URL fix; a JavaScript shell means the
 * source needs an API rather than a fetch; a site refusal is a conversation
 * with the site owner. Grouping them this way keeps the Admin page from
 * reading as one undifferentiated wall of red.
 */
export function probeSeverity(verdict: ProbeVerdict): "ok" | "ours" | "theirs" | "unknown" {
  switch (verdict) {
    case "ok":
      return "ok";
    case "blocked_by_proxy":
    case "tls_failure":
    case "dns_failure":
    case "not_configured":
      return "ours";
    case "http_error":
    case "js_shell":
      return "theirs";
    default:
      return "unknown";
  }
}

export interface AdminUserRow {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  banned_until: string | null;
}
