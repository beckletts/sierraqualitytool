import { getPool } from "./client.js";
import type { AnalysisResult } from "../analysis/pipeline.js";
import type { TranscriptMessage } from "../analysis/prompts.js";

export interface ConversationMetadata {
  startTimestamp?: number;
  tags?: string[];
  customFields?: Record<string, unknown>;
  device?: string | null;
}

/**
 * Writes an interaction + its claims. Dedupes on (agent, sierra_conversation_id)
 * so reruns of the worker are idempotent — a conversation already present is
 * skipped rather than duplicated. The agent is part of the key because Sierra
 * conversation IDs are only unique within an org.
 */
export async function writeInteraction(
  agentId: string,
  sierraConversationId: string,
  transcript: TranscriptMessage[],
  analysis: AnalysisResult,
  metadata: ConversationMetadata = {}
): Promise<{ skipped: boolean }> {
  const pool = getPool();

  const existing = await pool.query("select id from interactions where agent_id = $1 and sierra_conversation_id = $2", [
    agentId,
    sierraConversationId,
  ]);
  if (existing.rows.length > 0) return { skipped: true };

  const conversationStartedAt = metadata.startTimestamp ? new Date(metadata.startTimestamp * 1000).toISOString() : null;

  const inserted = await pool.query(
    `insert into interactions
       (agent_id, sierra_conversation_id, transcript, competency_scores, intervention_priority, status, conversation_started_at, tags, custom_fields, device)
     values ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9)
     returning id`,
    [
      agentId,
      sierraConversationId,
      JSON.stringify(transcript),
      JSON.stringify(analysis.competency_scores),
      analysis.intervention_priority,
      conversationStartedAt,
      JSON.stringify(metadata.tags ?? []),
      JSON.stringify(metadata.customFields ?? {}),
      metadata.device ?? null,
    ]
  );
  const interactionId: string = inserted.rows[0].id;

  if (analysis.claims.length > 0) {
    const values: unknown[] = [];
    const placeholders = analysis.claims
      .map((claim, i) => {
        const base = i * 6;
        values.push(interactionId, claim.claim_text, claim.flag_status, claim.confidence, claim.rationale, JSON.stringify(claim.sources));
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
      })
      .join(", ");
    await pool.query(
      `insert into claims (interaction_id, claim_text, flag_status, confidence, rationale, sources) values ${placeholders}`,
      values
    );
  }

  return { skipped: false };
}

/**
 * Updates agent_id/conversation_started_at/tags/custom_fields/device on an
 * existing row without touching competency_scores or claims — for backfilling
 * conversations pulled before those columns existed, with no re-analysis and no
 * Claude calls. No-ops (returns updated: false) if the conversation isn't in the
 * database yet — that's what a normal pull is for.
 *
 * Matching is on the conversation ID alone, deliberately: this is the path that
 * reassigns rows still pointing at the `unidentified` placeholder agent, so it
 * cannot filter on the agent it is about to set. Whichever agent's export
 * returned the conversation owns it, which holds as long as IDs don't collide
 * across agents — true within an org.
 */
export async function backfillMetadata(
  agentId: string,
  sierraConversationId: string,
  metadata: ConversationMetadata
): Promise<{ updated: boolean }> {
  const pool = getPool();
  const conversationStartedAt = metadata.startTimestamp ? new Date(metadata.startTimestamp * 1000).toISOString() : null;

  const result = await pool.query(
    `update interactions
     set agent_id = $1, conversation_started_at = $2, tags = $3, custom_fields = $4, device = $5
     where sierra_conversation_id = $6
     returning id`,
    [
      agentId,
      conversationStartedAt,
      JSON.stringify(metadata.tags ?? []),
      JSON.stringify(metadata.customFields ?? {}),
      metadata.device ?? null,
      sierraConversationId,
    ]
  );

  return { updated: result.rows.length > 0 };
}
