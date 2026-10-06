import "dotenv/config";
import { Pool } from "pg";

/**
 * One-off migration: copies interactions/claims/reviews from the old Supabase
 * Postgres into the new Cookie Postgres (overwatch-qa's DATABASE_URL).
 *
 * Interactions are deduped on sierra_conversation_id — any conversation the
 * new worker already pulled post-cutover is left alone, and only its claims
 * remain whatever the new pull produced (not overwritten from Supabase).
 * Explicit ids are preserved on insert so claims/reviews can reference their
 * parent interaction directly, without a remap step.
 *
 * Run with --dry-run first (default) to see counts with nothing written;
 * pass --apply to actually write.
 *
 * Requires SUPABASE_DB_URL (the old project's direct Postgres connection
 * string, from Supabase dashboard -> Settings -> Database -> Connection
 * string; NOT the SUPABASE_URL/anon key the frontend used) and DATABASE_URL
 * (already required for normal worker operation) in worker/.env.
 */

const apply = process.argv.includes("--apply");

interface SourceInteraction {
  id: string;
  sierra_conversation_id: string;
  transcript: unknown;
  pulled_at: string;
  conversation_started_at: string | null;
  tags: unknown;
  custom_fields: unknown;
  device: string | null;
  competency_scores: unknown;
  intervention_priority: string;
  status: string;
  signed_off_at: string | null;
  signed_off_by_email: string | null;
  created_at: string;
}

interface SourceClaim {
  id: string;
  interaction_id: string;
  claim_text: string;
  flag_status: string;
  confidence: string | null;
  rationale: string | null;
  sources: unknown;
  created_at: string;
}

interface SourceReview {
  id: string;
  interaction_id: string;
  claim_id: string | null;
  reviewer_email: string;
  action: string;
  field: string | null;
  previous_value: unknown;
  new_value: unknown;
  note: string | null;
  created_at: string;
}

async function main() {
  const sourceUrl = process.env.SUPABASE_DB_URL;
  const targetUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error("SUPABASE_DB_URL is not set");
  if (!targetUrl) throw new Error("DATABASE_URL is not set");

  const source = new Pool({ connectionString: sourceUrl });
  const target = new Pool({ connectionString: targetUrl });

  try {
    const { rows: interactions } = await source.query<SourceInteraction>(
      `select i.id, i.sierra_conversation_id, i.transcript, i.pulled_at, i.conversation_started_at,
              i.tags, i.custom_fields, i.device, i.competency_scores, i.intervention_priority,
              i.status, i.signed_off_at, au.email as signed_off_by_email, i.created_at
       from interactions i
       left join auth.users au on au.id = i.signed_off_by
       order by i.created_at`
    );
    console.log(`Source: ${interactions.length} interactions.`);

    const migratedIds: string[] = [];
    let skipped = 0;

    for (const row of interactions) {
      if (!apply) {
        const { rows: existing } = await target.query(
          "select 1 from interactions where sierra_conversation_id = $1",
          [row.sierra_conversation_id]
        );
        if (existing.length > 0) skipped++;
        else migratedIds.push(row.id);
        continue;
      }

      const { rows: inserted } = await target.query(
        `insert into interactions
           (id, sierra_conversation_id, transcript, pulled_at, conversation_started_at, tags,
            custom_fields, device, competency_scores, intervention_priority, status,
            signed_off_at, signed_off_by, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         on conflict (sierra_conversation_id) do nothing
         returning id`,
        [
          row.id,
          row.sierra_conversation_id,
          row.transcript,
          row.pulled_at,
          row.conversation_started_at,
          row.tags,
          row.custom_fields,
          row.device,
          row.competency_scores,
          row.intervention_priority,
          row.status,
          row.signed_off_at,
          row.signed_off_by_email,
          row.created_at,
        ]
      );
      if (inserted.length > 0) migratedIds.push(row.id);
      else skipped++;
    }

    console.log(`${apply ? "Migrated" : "Would migrate"}: ${migratedIds.length}. Skipped (already present): ${skipped}.`);

    if (migratedIds.length === 0) {
      console.log("Nothing further to copy — no claims/reviews to move for zero migrated interactions.");
      return;
    }

    const { rows: claims } = await source.query<SourceClaim>(
      `select id, interaction_id, claim_text, flag_status, confidence, rationale, sources, created_at
       from claims where interaction_id = any($1::uuid[])`,
      [migratedIds]
    );
    const { rows: reviews } = await source.query<SourceReview>(
      `select id, interaction_id, claim_id, reviewer_email, action, field, previous_value, new_value, note, created_at
       from reviews where interaction_id = any($1::uuid[])`,
      [migratedIds]
    );
    console.log(`Source: ${claims.length} claims and ${reviews.length} reviews for migrated interactions.`);

    if (!apply) return;

    for (const claim of claims) {
      await target.query(
        `insert into claims (id, interaction_id, claim_text, flag_status, confidence, rationale, sources, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (id) do nothing`,
        [claim.id, claim.interaction_id, claim.claim_text, claim.flag_status, claim.confidence, claim.rationale, claim.sources, claim.created_at]
      );
    }

    for (const review of reviews) {
      await target.query(
        `insert into reviews (id, interaction_id, claim_id, reviewer_email, action, field, previous_value, new_value, note, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (id) do nothing`,
        [review.id, review.interaction_id, review.claim_id, review.reviewer_email, review.action, review.field, review.previous_value, review.new_value, review.note, review.created_at]
      );
    }

    console.log(`Migrated ${claims.length} claims and ${reviews.length} reviews.`);
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
