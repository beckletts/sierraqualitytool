import { useState } from "react";
import { FLAG_LABELS } from "../lib/types";
import type { Claim, FlagStatus } from "../lib/types";

const FLAG_OPTIONS: FlagStatus[] = ["verified", "drift", "unverifiable", "source_conflict", "fetch_failed"];

interface Props {
  claim: Claim;
  onConfirm: () => Promise<void>;
  onOverride: (newStatus: FlagStatus, note: string) => Promise<void>;
}

export function ClaimFlagRow({ claim, onConfirm, onOverride }: Props) {
  const [overriding, setOverriding] = useState(false);
  const [newStatus, setNewStatus] = useState<FlagStatus>(claim.flag_status);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    setSaving(true);
    await onConfirm();
    setSaving(false);
  }

  async function handleOverrideSave() {
    setSaving(true);
    await onOverride(newStatus, note);
    setSaving(false);
    setOverriding(false);
    setNote("");
  }

  return (
    <div className={`claim-card flag-${claim.flag_status}`}>
      <div className="claim-card-header">
        <span className={`badge badge-flag-${claim.flag_status}`}>{FLAG_LABELS[claim.flag_status]}</span>
        {claim.confidence != null && <span className="confidence">confidence {claim.confidence.toFixed(2)}</span>}
      </div>
      <p className="claim-text">&ldquo;{claim.claim_text}&rdquo;</p>
      <p className="rationale">{claim.rationale}</p>
      <ul className="source-list">
        {claim.sources.map((s, i) => (
          <li key={i} className={s.fetch_ok ? "source-ok" : "source-failed"}>
            <strong>{s.domain}</strong>
            {s.fetch_ok ? (
              <>
                {" "}
                — <a href={s.url ?? undefined} target="_blank" rel="noreferrer">
                  {s.url}
                </a>
              </>
            ) : (
              " — fetch failed"
            )}
          </li>
        ))}
      </ul>
      {overriding ? (
        <div className="edit-block">
          <select value={newStatus} onChange={(e) => setNewStatus(e.target.value as FlagStatus)}>
            {FLAG_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {FLAG_LABELS[f]}
              </option>
            ))}
          </select>
          <textarea placeholder="Reason for override (required)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="edit-actions">
            <button onClick={() => void handleOverrideSave()} disabled={saving || !note.trim()}>
              Save override
            </button>
            <button className="secondary" onClick={() => setOverriding(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="edit-actions">
          <button onClick={() => void handleConfirm()} disabled={saving}>
            Confirm flag
          </button>
          <button className="secondary" onClick={() => setOverriding(true)} disabled={saving}>
            Override
          </button>
        </div>
      )}
    </div>
  );
}
