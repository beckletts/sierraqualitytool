import { supabase } from "./supabaseClient";
import type { ReviewAction } from "./types";

interface RecordReviewArgs {
  interactionId: string;
  claimId?: string;
  reviewerId: string;
  reviewerEmail: string;
  action: ReviewAction;
  field?: string;
  previousValue?: unknown;
  newValue?: unknown;
  note?: string;
}

/** Every edit in the app must go through this — it's the only path that writes an audit row. */
export async function recordReview(args: RecordReviewArgs): Promise<void> {
  const { error } = await supabase.from("reviews").insert({
    interaction_id: args.interactionId,
    claim_id: args.claimId ?? null,
    reviewer_id: args.reviewerId,
    reviewer_email: args.reviewerEmail,
    action: args.action,
    field: args.field ?? null,
    previous_value: args.previousValue ?? null,
    new_value: args.newValue ?? null,
    note: args.note ?? null,
  });
  if (error) throw error;
}
