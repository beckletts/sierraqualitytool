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

export interface AdminUserRow {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  banned_until: string | null;
}
