import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import {
  PROBE_TARGET_KIND_LABELS,
  PROBE_VERDICT_LABELS,
  probeSeverity,
  type ProbeRow,
  type ProbeTargetKind,
} from "../lib/types";

/**
 * Shows the most recent source-reachability probe run.
 *
 * The panel exists because `fetch_failed` on a claim is not an answer. "Pearson
 * refused us", "our own egress refused us", "that page has no HTML to read" and
 * "that URL is wrong" need four different fixes and are indistinguishable from
 * inside the worker. Each row here carries the verdict *and* the evidence, so a
 * reviewer can disagree with the classification rather than inherit it.
 */

const KIND_ORDER: ProbeTargetKind[] = [
  "control",
  "knowledge_api",
  "reference_page",
  "reference_pdf",
  "sitemap",
  "search",
  "robots",
  "seed_url",
];

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Pulls the handful of `findings` keys worth a reviewer's attention out of the
 * JSON blob. Everything else stays in the database for whoever needs it.
 */
function highlightFindings(row: ProbeRow): string[] {
  const out: string[] = [];
  const f = row.findings ?? {};

  if (typeof f.sitemap_url_count === "number") {
    out.push(`${f.sitemap_url_count.toLocaleString()} sitemap entries${f.sitemap_truncated ? " (response truncated — count is a floor)" : ""}`);
  }
  if (typeof f.extracted_text_chars === "number") {
    out.push(`${f.extracted_text_chars.toLocaleString()} characters of readable text`);
  }
  const pdf = f.pdf as { summary?: string } | undefined;
  if (pdf?.summary) out.push(pdf.summary);
  if (typeof f.published_article_count === "number") {
    out.push(`${f.published_article_count.toLocaleString()} published Knowledge articles`);
  }
  if (Array.isArray(f.missing_env_vars) && f.missing_env_vars.length > 0) {
    out.push(`Needs: ${(f.missing_env_vars as string[]).join(", ")}`);
  }
  return out;
}

export function SourceProbePanel() {
  const [rows, setRows] = useState<ProbeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.rpc("latest_source_probe_run");
      if (error) setError(error.message);
      else setRows((data ?? []) as ProbeRow[]);
    })();
  }, []);

  const grouped = useMemo(() => {
    if (!rows) return [];
    const byKind = new Map<ProbeTargetKind, ProbeRow[]>();
    for (const row of rows) {
      if (!row.label) continue; // left join with no probes yet
      const list = byKind.get(row.target_kind) ?? [];
      list.push(row);
      byKind.set(row.target_kind, list);
    }
    return KIND_ORDER.filter((kind) => byKind.has(kind)).map((kind) => ({ kind, rows: byKind.get(kind)! }));
  }, [rows]);

  const run = rows?.[0];
  const probes = rows?.filter((r) => r.label) ?? [];

  const controlsFailed = probes.some((r) => r.target_kind === "control" && r.verdict !== "ok");
  const blockedInTransit = probes.filter((r) => r.verdict === "blocked_by_proxy" || r.verdict === "tls_failure");

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (error) return <p className="error-text">{error}</p>;
  if (rows === null) return <p>Loading source diagnostics...</p>;

  if (!run || probes.length === 0) {
    return (
      <p className="muted-note">
        No probe run recorded yet. Run <code>npm run probe -- --from=cookie-pod</code> in the worker to check whether this
        environment can reach the knowledge sources, then reload.
      </p>
    );
  }

  return (
    <>
      <p className="muted-note">
        Last run from <strong>{run.ran_from}</strong> on {new Date(run.started_at).toLocaleString()}
        {run.notes ? ` — ${run.notes}` : ""}. Each row shows what the verdict was based on, so you can disagree with it.
      </p>

      {/* Read the controls before anything else: if general HTTPS is down, every
          other row is a consequence of that and says nothing about the source. */}
      {controlsFailed ? (
        <div className="probe-callout probe-callout-warn">
          <strong>Read nothing into the rest of this run.</strong> The control targets failed, so general outbound HTTPS was not
          working from <strong>{run.ran_from}</strong>. Fix that first — the source failures below follow from it.
        </div>
      ) : blockedInTransit.length > 0 ? (
        <div className="probe-callout probe-callout-warn">
          <strong>
            {blockedInTransit.length} target{blockedInTransit.length === 1 ? "" : "s"} refused in transit.
          </strong>{" "}
          General HTTPS worked, so this points at <strong>{run.ran_from}</strong>&rsquo;s egress policy rather than at the
          sources. Confirm by running the same probe from an unrestricted network — the hosts need allowlisting, not
          working around.
        </div>
      ) : (
        <div className="probe-callout probe-callout-ok">
          <strong>Controls passed and nothing was refused in transit.</strong> The results below are about the sources
          themselves.
        </div>
      )}

      {grouped.map(({ kind, rows: kindRows }) => (
        <section key={kind} className="probe-group">
          <h3>{PROBE_TARGET_KIND_LABELS[kind]}</h3>
          <table className="queue-table">
            <thead>
              <tr>
                <th scope="col">Target</th>
                <th scope="col">Result</th>
                <th scope="col">Status</th>
                <th scope="col">Size</th>
                <th scope="col">Time</th>
              </tr>
            </thead>
            <tbody>
              {kindRows.map((row) => {
                const rowId = `${row.target_kind}:${row.domain ?? ""}:${row.label}`;
                const isOpen = expanded.has(rowId);
                const findings = highlightFindings(row);
                return (
                  <tr key={rowId}>
                    <td>
                      <div className="probe-label">{row.label}</div>
                      {row.domain && <div className="muted-note">{row.domain}</div>}
                      <div className="probe-detail">{row.detail}</div>
                      {findings.length > 0 && (
                        <ul className="probe-findings">
                          {findings.map((finding) => (
                            <li key={finding}>{finding}</li>
                          ))}
                        </ul>
                      )}
                      <button type="button" className="link-button" onClick={() => toggle(rowId)} aria-expanded={isOpen}>
                        {isOpen ? "Hide evidence" : "Show evidence"}
                      </button>
                      {isOpen && (
                        <div className="probe-evidence">
                          <div className="probe-url">{row.url}</div>
                          {row.content_type && <div className="muted-note">Content type: {row.content_type}</div>}
                          {row.body_sample ? (
                            <pre>{row.body_sample}</pre>
                          ) : (
                            <p className="muted-note">No response body was received.</p>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`badge badge-probe-${probeSeverity(row.verdict)}`}>
                        {PROBE_VERDICT_LABELS[row.verdict] ?? row.verdict}
                      </span>
                    </td>
                    <td>{row.http_status ?? "—"}</td>
                    <td>{formatBytes(row.bytes)}</td>
                    <td>{row.elapsed_ms === null ? "—" : `${row.elapsed_ms} ms`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}
