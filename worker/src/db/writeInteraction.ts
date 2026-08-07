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
 * Writes an interaction + its claims. Dedupes on sierra_conversation_id so
 * reruns of the worker are idempotent — a conversation already present is
 * skipped rather than duplicated.
 */
export async function writeInteraction(
  sierraConversationId: string,
  transcript: TranscriptMessage[],
  analysis: AnalysisResult,
  metadata: ConversationMetadata = {}
): Promise<{ skipped: boolean }> {
  const pool = getPool();

  const existing = await pool.query("select id from interactions where sierra_conversation_id = $1", [sierraConversationId]);
  if (existing.rows.length > 0) return { skipped: true };

  const conversationStartedAt = metadata.startTimestamp ? new Date(metadata.startTimestamp * 1000).toISOString() : null;

  const inserted = await pool.query(
    `insert into interactions
       (sierra_conversation_id, transcript, competency_scores, intervention_priority, status, conversation_started_at, tags, custom_fields, device)
     values ($1, $2, $3, $4, 'pending', $5, $6, $7, $8)
     returning id`,
    [
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
 * Updates conversation_started_at/tags/custom_fields/device on an existing
 * row without touching competency_scores or claims — for backfilling
 * conversations pulled before those columns existed, with no re-analysis
 * and no Claude calls. No-ops (returns updated: false) if the conversation
 * isn't in the database yet — that's what a normal pull is for.
 */
export async function backfillMetadata(
  sierraConversationId: string,
  metadata: ConversationMetadata
): Promise<{ updated: boolean }> {
  const pool = getPool();
  const conversationStartedAt = metadata.startTimestamp ? new Date(metadata.startTimestamp * 1000).toISOString() : null;

  const result = await pool.query(
    `update interactions
     set conversation_started_at = $1, tags = $2, custom_fields = $3, device = $4
     where sierra_conversation_id = $5
     returning id`,
    [conversationStartedAt, JSON.stringify(metadata.tags ?? []), JSON.stringify(metadata.customFields ?? {}), metadata.device ?? null, sierraConversationId]
  );

  return { updated: result.rows.length > 0 };
}
