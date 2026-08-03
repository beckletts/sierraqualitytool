import { useState } from "react";
import { COMPETENCY_LEVELS } from "../lib/types";
import type { Competency, CompetencyLevel, CompetencyScore } from "../lib/types";

interface Props {
  competency: Competency;
  label: string;
  score: CompetencyScore;
  onOverride: (newLevel: CompetencyLevel, note: string) => Promise<void>;
}

export function CompetencyScoreCard({ label, score, onOverride }: Props) {
  const [editing, setEditing] = useState(false);
  const [level, setLevel] = useState<CompetencyLevel>(score.level);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onOverride(level, note);
    setSaving(false);
    setEditing(false);
    setNote("");
  }

  return (
    <div className="competency-card">
      <div className="competency-card-header">
        <strong>{label}</strong>
        <span className="competency-level">{score.level}</span>
      </div>
      <p className="rationale">{score.rationale}</p>
      {editing ? (
        <div className="edit-block">
          <select value={level} onChange={(e) => setLevel(e.target.value as CompetencyLevel)}>
            {COMPETENCY_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <textarea placeholder="Coaching note (required)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="edit-actions">
            <button onClick={() => void handleSave()} disabled={saving || !note.trim()}>
              Save override
            </button>
            <button className="secondary" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button className="link-button" onClick={() => setEditing(true)}>
          Override level
        </button>
      )}
    </div>
  );
}
