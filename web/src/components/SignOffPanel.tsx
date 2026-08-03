import { useState } from "react";
import type { Interaction } from "../lib/types";

interface Props {
  interaction: Interaction;
  onAddNote: (note: string) => Promise<void>;
  onSignOff: () => Promise<void>;
}

export function SignOffPanel({ interaction, onAddNote, onSignOff }: Props) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAddNote() {
    if (!note.trim()) return;
    setSaving(true);
    await onAddNote(note);
    setSaving(false);
    setNote("");
  }

  async function handleSignOff() {
    setSaving(true);
    await onSignOff();
    setSaving(false);
  }

  if (interaction.status === "reviewed") {
    return (
      <div className="sign-off-panel signed-off">
        Signed off {interaction.signed_off_at ? new Date(interaction.signed_off_at).toLocaleString() : ""}
      </div>
    );
  }

  return (
    <div className="sign-off-panel">
      <textarea placeholder="Coaching note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="edit-actions">
        <button className="secondary" onClick={() => void handleAddNote()} disabled={saving || !note.trim()}>
          Add note
        </button>
        <button onClick={() => void handleSignOff()} disabled={saving}>
          Mark reviewed & sign off
        </button>
      </div>
    </div>
  );
}
