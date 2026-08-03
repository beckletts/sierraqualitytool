import { useMemo } from "react";
import type { Interaction } from "../lib/types";

interface Props {
  interactions: Interaction[];
}

export function SignOffProgress({ interactions }: Props) {
  const { total, signedOff, pending, pct } = useMemo(() => {
    const total = interactions.length;
    const signedOff = interactions.filter((i) => i.status === "reviewed").length;
    return { total, signedOff, pending: total - signedOff, pct: total === 0 ? 0 : Math.round((signedOff / total) * 100) };
  }, [interactions]);

  if (total === 0) return null;

  return (
    <div className="progress-card">
      <div className="kpi-row">
        <div className="stat-tile">
          <span className="stat-value">{total}</span>
          <span className="stat-label">Total interactions</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{signedOff}</span>
          <span className="stat-label">Signed off</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{pending}</span>
          <span className="stat-label">Pending review</span>
        </div>
      </div>
      <div className="meter-row">
        <div className="meter-track">
          <div className="meter-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="meter-label">{pct}% signed off</span>
      </div>
    </div>
  );
}
