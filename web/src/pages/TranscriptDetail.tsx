import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/auth";
import { recordReview } from "../lib/reviews";
import { COMPETENCY_LABELS, interactionDate } from "../lib/types";
import type { Claim, Competency, CompetencyLevel, FlagStatus, Interaction } from "../lib/types";
import { CompetencyScoreCard } from "../components/CompetencyScoreCard";
import { ClaimFlagRow } from "../components/ClaimFlagRow";
import { SignOffPanel } from "../components/SignOffPanel";

export function TranscriptDetail() {
  const { id } = useParams<{ id: string }>();
  const { session } = useAuth();
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
  }, [id]);

  async function load() {
    if (!id) return;
    const [{ data: interactionRow, error: interactionError }, { data: claimRows, error: claimsError }] =
      await Promise.all([
        supabase.from("interactions").select("*").eq("id", id).single(),
        supabase.from("claims").select("*").eq("interaction_id", id).order("created_at"),
      ]);
    if (interactionError) console.error(interactionError);
    if (claimsError) console.error(claimsError);
    setInteraction((interactionRow ?? null) as Interaction | null);
    setClaims((claimRows ?? []) as Claim[]);
    setLoading(false);
  }

  async function handleCompetencyOverride(competency: Competency, newLevel: CompetencyLevel, note: string) {
    if (!interaction || !session) return;
    const previous = interaction.competency_scores[competency];
    const newScore = { level: newLevel, rationale: previous.rationale };
    const updatedScores = { ...interaction.competency_scores, [competency]: newScore };

    const { error } = await supabase
      .from("interactions")
      .update({ competency_scores: updatedScores })
      .eq("id", interaction.id);
    if (error) {
      console.error(error);
      return;
    }
    await recordReview({
      interactionId: interaction.id,
      reviewerId: session.user.id,
      reviewerEmail: session.user.email ?? "unknown",
      action: "adjust_competency",
      field: competency,
      previousValue: previous,
      newValue: newScore,
      note,
    });
    setInteraction({ ...interaction, competency_scores: updatedScores });
  }

  async function handleConfirmClaim(claim: Claim) {
    if (!interaction || !session) return;
    await recordReview({
      interactionId: interaction.id,
      claimId: claim.id,
      reviewerId: session.user.id,
      reviewerEmail: session.user.email ?? "unknown",
      action: "confirm_flag",
      field: "flag_status",
      previousValue: claim.flag_status,
      newValue: claim.flag_status,
    });
  }

  async function handleOverrideClaim(claim: Claim, newStatus: FlagStatus, note: string) {
    if (!interaction || !session) return;
    const { error } = await supabase.from("claims").update({ flag_status: newStatus }).eq("id", claim.id);
    if (error) {
      console.error(error);
      return;
    }
    await recordReview({
      interactionId: interaction.id,
      claimId: claim.id,
      reviewerId: session.user.id,
      reviewerEmail: session.user.email ?? "unknown",
      action: "override_flag",
      field: "flag_status",
      previousValue: claim.flag_status,
      newValue: newStatus,
      note,
    });
    setClaims(claims.map((c) => (c.id === claim.id ? { ...c, flag_status: newStatus } : c)));
  }

  async function handleAddNote(note: string) {
    if (!interaction || !session) return;
    await recordReview({
      interactionId: interaction.id,
      reviewerId: session.user.id,
      reviewerEmail: session.user.email ?? "unknown",
      action: "add_note",
      note,
    });
  }

  async function handleSignOff() {
    if (!interaction || !session) return;
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("interactions")
      .update({ status: "reviewed", signed_off_at: now, signed_off_by: session.user.id })
      .eq("id", interaction.id);
    if (error) {
      console.error(error);
      return;
    }
    await recordReview({
      interactionId: interaction.id,
      reviewerId: session.user.id,
      reviewerEmail: session.user.email ?? "unknown",
      action: "sign_off",
    });
    setInteraction({ ...interaction, status: "reviewed", signed_off_at: now, signed_off_by: session.user.id });
  }

  if (loading) return <div className="page-shell">Loading...</div>;
  if (!interaction) return <div className="page-shell">Not found.</div>;

  return (
    <div className="page-shell">
      <header className="page-header">
        <Link to="/">&larr; Back to queue</Link>
        <div className="detail-heading">
          <h1>{interaction.sierra_conversation_id}</h1>
          <span className="detail-date">{new Date(interactionDate(interaction)).toLocaleString()}</span>
        </div>
      </header>

      <section className="detail-columns">
        <div className="transcript-column">
          <h2>Transcript (redacted)</h2>
          <div className="transcript">
            {interaction.transcript.map((m, i) => (
              <p key={i} className={`transcript-line role-${m.role}`}>
                <strong>{m.role}:</strong> {m.text}
              </p>
            ))}
          </div>
        </div>

        <div className="review-column">
          <h2>Competency assessment</h2>
          {(Object.keys(COMPETENCY_LABELS) as Competency[]).map((key) => (
            <CompetencyScoreCard
              key={key}
              competency={key}
              label={COMPETENCY_LABELS[key]}
              score={interaction.competency_scores[key]}
              onOverride={(level, note) => handleCompetencyOverride(key, level, note)}
            />
          ))}

          <h2>Knowledge-confidence flags</h2>
          {claims.length === 0 && <p>No checkable claims were extracted from this transcript.</p>}
          {claims.map((claim) => (
            <ClaimFlagRow
              key={claim.id}
              claim={claim}
              onConfirm={() => handleConfirmClaim(claim)}
              onOverride={(status, note) => handleOverrideClaim(claim, status, note)}
            />
          ))}

          <h2>Sign-off</h2>
          <SignOffPanel interaction={interaction} onAddNote={handleAddNote} onSignOff={handleSignOff} />
        </div>
      </section>
    </div>
  );
}
