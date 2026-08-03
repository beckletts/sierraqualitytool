import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/auth";
import type { Claim, Interaction, InterventionPriority } from "../lib/types";
import { COMPETENCY_LABELS } from "../lib/types";

const PRIORITY_RANK: Record<InterventionPriority, number> = { hard_flag: 0, soft_flag: 1, none: 2 };
const PRIORITY_LABELS: Record<InterventionPriority, string> = {
  hard_flag: "Needs intervention",
  soft_flag: "Review recommended",
  none: "No flags",
};

interface ClaimCounts {
  hard: number;
  soft: number;
}

export function Queue() {
  const { signOut } = useAuth();
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [claimCounts, setClaimCounts] = useState<Record<string, ClaimCounts>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadInteractions();

    const channel = supabase
      .channel("interactions-queue")
      .on("postgres_changes", { event: "*", schema: "public", table: "interactions" }, () => {
        void loadInteractions();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  async function loadInteractions() {
    const { data: interactionRows, error } = await supabase
      .from("interactions")
      .select("*")
      .order("pulled_at", { ascending: false });
    if (error) {
      console.error(error);
      setLoading(false);
      return;
    }
    setInteractions((interactionRows ?? []) as Interaction[]);

    const { data: claimRows } = await supabase.from("claims").select("interaction_id, flag_status");
    const counts: Record<string, ClaimCounts> = {};
    for (const claim of (claimRows ?? []) as Pick<Claim, "interaction_id" | "flag_status">[]) {
      const bucket = counts[claim.interaction_id] ?? { hard: 0, soft: 0 };
      if (claim.flag_status === "drift" || claim.flag_status === "source_conflict") bucket.hard += 1;
      if (claim.flag_status === "unverifiable" || claim.flag_status === "fetch_failed") bucket.soft += 1;
      counts[claim.interaction_id] = bucket;
    }
    setClaimCounts(counts);
    setLoading(false);
  }

  const sorted = useMemo(
    () =>
      [...interactions].sort((a, b) => {
        const rankDiff = PRIORITY_RANK[a.intervention_priority] - PRIORITY_RANK[b.intervention_priority];
        if (rankDiff !== 0) return rankDiff;
        return new Date(b.pulled_at).getTime() - new Date(a.pulled_at).getTime();
      }),
    [interactions]
  );

  if (loading) return <div className="page-shell">Loading...</div>;

  return (
    <div className="page-shell">
      <header className="page-header">
        <h1>Review queue</h1>
        <button className="link-button" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <table className="queue-table">
        <thead>
          <tr>
            <th>Priority</th>
            <th>Conversation</th>
            <th>Pulled</th>
            {Object.values(COMPETENCY_LABELS).map((label) => (
              <th key={label}>{label}</th>
            ))}
            <th>Flags</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((interaction) => {
            const counts = claimCounts[interaction.id] ?? { hard: 0, soft: 0 };
            return (
              <tr key={interaction.id} className={`priority-${interaction.intervention_priority}`}>
                <td>
                  <span className={`badge badge-${interaction.intervention_priority}`}>
                    {PRIORITY_LABELS[interaction.intervention_priority]}
                  </span>
                </td>
                <td>
                  <Link to={`/interactions/${interaction.id}`}>{interaction.sierra_conversation_id}</Link>
                </td>
                <td>{new Date(interaction.pulled_at).toLocaleString()}</td>
                {(Object.keys(COMPETENCY_LABELS) as (keyof typeof COMPETENCY_LABELS)[]).map((key) => (
                  <td key={key}>{interaction.competency_scores?.[key]?.level ?? "-"}</td>
                ))}
                <td>
                  {counts.hard > 0 && <span className="badge badge-hard_flag">{counts.hard} hard</span>}{" "}
                  {counts.soft > 0 && <span className="badge badge-soft_flag">{counts.soft} soft</span>}
                </td>
                <td>{interaction.status}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {sorted.length === 0 && <p>No interactions yet — run the worker to pull and analyze transcripts.</p>}
    </div>
  );
}
