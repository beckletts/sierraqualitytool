import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/auth";
import type { Claim, Interaction, InterventionPriority } from "../lib/types";
import { COMPETENCY_LABELS, interactionDate } from "../lib/types";

const PRIORITY_RANK: Record<InterventionPriority, number> = { hard_flag: 0, soft_flag: 1, none: 2 };
const PRIORITY_LABELS: Record<InterventionPriority, string> = {
  hard_flag: "Needs intervention",
  soft_flag: "Review recommended",
  none: "No flags",
};

type DatePreset = "today" | "7d" | "30d" | "all" | "custom";

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom" },
];

interface ClaimCounts {
  hard: number;
  soft: number;
}

interface SearchableClaims {
  counts: ClaimCounts;
  text: string;
}

function toDayInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function Queue() {
  const { signOut } = useAuth();
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [claimsByInteraction, setClaimsByInteraction] = useState<Record<string, SearchableClaims>>({});
  const [loading, setLoading] = useState(true);
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [customStart, setCustomStart] = useState(() => toDayInputValue(new Date(Date.now() - 7 * 86_400_000)));
  const [customEnd, setCustomEnd] = useState(() => toDayInputValue(new Date()));
  const [search, setSearch] = useState("");

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

    const { data: claimRows } = await supabase.from("claims").select("interaction_id, flag_status, claim_text");
    const byInteraction: Record<string, SearchableClaims> = {};
    for (const claim of (claimRows ?? []) as Pick<Claim, "interaction_id" | "flag_status" | "claim_text">[]) {
      const entry = byInteraction[claim.interaction_id] ?? { counts: { hard: 0, soft: 0 }, text: "" };
      if (claim.flag_status === "drift" || claim.flag_status === "source_conflict") entry.counts.hard += 1;
      if (claim.flag_status === "unverifiable" || claim.flag_status === "fetch_failed") entry.counts.soft += 1;
      entry.text += ` ${claim.claim_text}`;
      byInteraction[claim.interaction_id] = entry;
    }
    setClaimsByInteraction(byInteraction);
    setLoading(false);
  }

  const dateCutoff = useMemo((): { start: number; end: number } | null => {
    const now = Date.now();
    if (datePreset === "all") return null;
    if (datePreset === "today") return { start: now - 24 * 3_600_000, end: now };
    if (datePreset === "7d") return { start: now - 7 * 86_400_000, end: now };
    if (datePreset === "30d") return { start: now - 30 * 86_400_000, end: now };
    // custom: end-of-day on the end date, matching the worker CLI's date handling
    const start = new Date(customStart).getTime();
    const end = new Date(customEnd).getTime() + 86_400_000;
    return { start, end };
  }, [datePreset, customStart, customEnd]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return interactions.filter((interaction) => {
      if (dateCutoff) {
        const t = new Date(interactionDate(interaction)).getTime();
        if (t < dateCutoff.start || t > dateCutoff.end) return false;
      }
      if (!query) return true;
      if (interaction.sierra_conversation_id.toLowerCase().includes(query)) return true;
      if ((interaction.tags ?? []).some((tag) => tag.toLowerCase().includes(query))) return true;
      if (interaction.transcript.some((m) => m.text.toLowerCase().includes(query))) return true;
      if ((claimsByInteraction[interaction.id]?.text ?? "").toLowerCase().includes(query)) return true;
      return false;
    });
  }, [interactions, dateCutoff, search, claimsByInteraction]);

  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        const rankDiff = PRIORITY_RANK[a.intervention_priority] - PRIORITY_RANK[b.intervention_priority];
        if (rankDiff !== 0) return rankDiff;
        return new Date(b.pulled_at).getTime() - new Date(a.pulled_at).getTime();
      }),
    [filtered]
  );

  if (loading) return <div className="page-shell">Loading...</div>;

  return (
    <div className="page-shell">
      <header className="page-header">
        <h1>Review queue</h1>
        <nav className="header-nav">
          <Link to="/insights">Insights</Link>
          <button className="link-button" onClick={() => void signOut()}>
            Sign out
          </button>
        </nav>
      </header>

      <div className="filter-bar">
        <div className="date-presets">
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset.key}
              className={datePreset === preset.key ? "preset-active" : "preset"}
              onClick={() => setDatePreset(preset.key)}
            >
              {preset.label}
            </button>
          ))}
          {datePreset === "custom" && (
            <span className="custom-range">
              <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
              <span>to</span>
              <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
            </span>
          )}
        </div>
        <input
          className="search-input"
          type="search"
          placeholder="Search by conversation ID, keyword, or tag..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <table className="queue-table">
        <thead>
          <tr>
            <th>Priority</th>
            <th>Conversation</th>
            <th>Date</th>
            <th>Tags</th>
            {Object.values(COMPETENCY_LABELS).map((label) => (
              <th key={label}>{label}</th>
            ))}
            <th>Flags</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((interaction) => {
            const counts = claimsByInteraction[interaction.id]?.counts ?? { hard: 0, soft: 0 };
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
                <td>{new Date(interactionDate(interaction)).toLocaleString()}</td>
                <td>
                  {(interaction.tags ?? []).map((tag) => (
                    <span key={tag} className="tag-chip">
                      {tag}
                    </span>
                  ))}
                </td>
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
      {sorted.length === 0 && interactions.length === 0 && (
        <p>No interactions yet — run the worker to pull and analyze transcripts.</p>
      )}
      {sorted.length === 0 && interactions.length > 0 && <p>No interactions match the current filters.</p>}
    </div>
  );
}
