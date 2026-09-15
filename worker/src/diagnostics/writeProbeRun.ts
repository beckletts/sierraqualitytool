import { getPool } from "../db/client.js";
import type { ProbeResult } from "./probe.js";

/**
 * Persists a probe run so the Admin page can show it, and — more to the point —
 * so two runs from two networks can be compared. A probe result without the
 * network it came from is an anecdote.
 */
export async function writeProbeRun(
  ranFrom: string,
  results: ProbeResult[],
  notes: string | null
): Promise<{ runId: string }> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const run = await client.query<{ id: string }>(
      "insert into source_probe_runs (ran_from, notes, finished_at) values ($1, $2, now()) returning id",
      [ranFrom, notes]
    );
    const runId = run.rows[0].id;

    for (const result of results) {
      await client.query(
        `insert into source_probes
           (run_id, target_kind, domain, label, url, verdict, http_status, content_type, bytes, elapsed_ms, detail, body_sample, findings)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          runId,
          result.target.kind,
          result.target.domain,
          result.target.label,
          result.target.url,
          result.verdict,
          result.httpStatus,
          result.contentType,
          result.bytes,
          result.elapsedMs,
          result.detail,
          result.bodySample,
          JSON.stringify(result.findings),
        ]
      );
    }

    await client.query("commit");
    return { runId };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
