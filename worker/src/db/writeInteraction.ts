import { getSupabase } from "./client.js";
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
  const supabase = getSupabase();

  const { data: existing, error: lookupError } = await supabase
    .from("interactions")
    .select("id")
    .eq("sierra_conversation_id", sierraConversationId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return { skipped: true };

  const { data: interaction, error: insertError } = await supabase
    .from("interactions")
    .insert({
      sierra_conversation_id: sierraConversationId,
      transcript,
      competency_scores: analysis.competency_scores,
      intervention_priority: analysis.intervention_priority,
      status: "pending",
      conversation_started_at: metadata.startTimestamp ? new Date(metadata.startTimestamp * 1000).toISOString() : null,
      tags: metadata.tags ?? [],
      custom_fields: metadata.customFields ?? {},
      device: metadata.device ?? null,
    })
    .select("id")
    .single();
  if (insertError) throw insertError;

  if (analysis.claims.length > 0) {
    const { error: claimsError } = await supabase.from("claims").insert(
      analysis.claims.map((claim) => ({
        interaction_id: interaction.id,
        claim_text: claim.claim_text,
        flag_status: claim.flag_status,
        confidence: claim.confidence,
        rationale: claim.rationale,
        sources: claim.sources,
      }))
    );
    if (claimsError) throw claimsError;
  }

  return { skipped: false };
}
