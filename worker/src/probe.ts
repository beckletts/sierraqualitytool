import "dotenv/config";
import { hostname } from "node:os";
import { runProbes, type ProbeResult } from "./diagnostics/probe.js";
import { writeProbeRun } from "./diagnostics/writeProbeRun.js";
import { loadSourceDomains } from "./config/loadConfig.js";

/**
 * Source reachability diagnostic.
 *
 * When a claim comes back `fetch_failed`, the pipeline knows only that the
 * fetch failed. This tells you why, per source, with the raw evidence kept —
 * because "Pearson blocks us", "our own egress policy blocks us", "that page
 * has no HTML to read" and "that URL is wrong" need four different fixes and
 * look the same from inside the worker.
 *
 *   npm run probe -- --from=cookie-pod
 *   npm run probe -- --from=my-laptop --reference-only --no-save
 *
 * Run it from the deployed environment and from a network known to be
 * unrestricted, then compare. A target that works from one and not the other
 * is a policy question. A target that fails from both is a real one.
 */

const VERDICT_LABELS: Record<string, string> = {
  ok: "OK",
  js_shell: "JS SHELL",
  empty_body: "EMPTY",
  http_error: "HTTP ERR",
  blocked_by_proxy: "PROXY?",
  dns_failure: "DNS",
  tls_failure: "TLS",
  timeout: "TIMEOUT",
  transport_error: "TRANSPORT",
  not_configured: "NOT SET",
};

const args = process.argv.slice(2);
const fromArg = args.find((a) => a.startsWith("--from="))?.split("=")[1];
const notesArg = args.find((a) => a.startsWith("--notes="))?.slice("--notes=".length) ?? null;
const referenceOnly = args.includes("--reference-only");
// `--reference-only` exists so the probe can run somewhere with no database —
// so it skips saving when there is nowhere to save to, but not when there is.
// Discarding a run that could have been recorded would be a surprise, and
// comparing two networks is the whole point.
const noSave = args.includes("--no-save") || !process.env.DATABASE_URL;

const ranFrom = fromArg ?? hostname();

function summarise(results: ProbeResult[]): void {
  const byVerdict = new Map<string, number>();
  for (const r of results) byVerdict.set(r.verdict, (byVerdict.get(r.verdict) ?? 0) + 1);

  console.log("\n─── Summary ───");
  for (const [verdict, count] of [...byVerdict].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${(VERDICT_LABELS[verdict] ?? verdict).padEnd(10)} ${count}`);
  }

  const controlsOk = results.filter((r) => r.target.kind === "control").every((r) => r.verdict === "ok");
  const pearsonBlocked = results.filter(
    (r) => r.target.domain?.endsWith("pearson.com") && (r.verdict === "blocked_by_proxy" || r.verdict === "tls_failure")
  );

  console.log("");
  if (!controlsOk) {
    console.log("Read nothing else into this run: the control targets failed, so general outbound HTTPS is not working here.");
    console.log("Fix that first — every Pearson result below is a consequence of it, not evidence about Pearson.");
  } else if (pearsonBlocked.length > 0) {
    console.log(
      `General HTTPS works, but ${pearsonBlocked.length} Pearson target(s) were refused in transit. That points at this network's`
    );
    console.log("egress policy rather than at Pearson — worth confirming by running the same probe from an unrestricted network.");
  } else {
    console.log("Controls passed and no Pearson target was refused in transit, so the results below are about the sources themselves.");
  }

  // The two findings that decide sections of the corpus design, surfaced rather
  // than left inside the JSON. Only reported where the probe actually
  // succeeded: "0 entries" from a refused request reads as a measurement, and
  // it is the absence of one.
  const pdfSitemaps = results.filter((r) => r.verdict === "ok" && r.target.countSitemapUrls && r.target.url.includes("type=pdf"));
  if (pdfSitemaps.length > 0) {
    console.log("\nPDF sitemap entry counts (the scale question):");
    for (const r of pdfSitemaps) {
      const offset = new URL(r.target.url).searchParams.get("offset");
      console.log(`  offset=${String(offset).padEnd(6)} ${r.findings.sitemap_url_count} entries`);
    }
  }

  const pdfShape = results.find((r) => r.verdict === "ok" && r.findings.pdf);
  if (pdfShape) {
    console.log(`\nPDF text layer: ${(pdfShape.findings.pdf as { summary: string }).summary}`);
  }

  const unmeasured = results.filter((r) => r.verdict !== "ok" && (r.target.countSitemapUrls || r.target.expectPdf));
  if (unmeasured.length > 0) {
    console.log(`\n${unmeasured.length} sitemap/PDF target(s) could not be read, so the scale and text-layer questions stay open.`);
  }
}

async function main(): Promise<void> {
  const sources = referenceOnly ? [] : await loadSourceDomains();

  console.log(
    `Probing ${referenceOnly ? "control and reference targets only" : `${sources.length} configured source(s) plus controls and reference targets`}, from "${ranFrom}"...\n`
  );

  const results = await runProbes(sources, {
    referenceOnly,
    onResult: (result) => {
      const verdict = (VERDICT_LABELS[result.verdict] ?? result.verdict).padEnd(10);
      const scope = result.target.domain ?? "control";
      console.log(`${verdict} ${scope} — ${result.target.label}`);
      console.log(`           ${result.detail}`);
      // On a refusal the body is the evidence for who refused, so it is shown
      // rather than left for whoever thinks to query the table.
      if (result.verdict !== "ok" && result.bodySample) {
        const oneLine = result.bodySample.replace(/\s+/g, " ").trim().slice(0, 200);
        if (oneLine) console.log(`           body: ${oneLine}`);
      }
    },
  });

  summarise(results);

  if (noSave) {
    console.log(`\nNot saved (${process.env.DATABASE_URL ? "--no-save" : "DATABASE_URL is not set"}).`);
    return;
  }

  const { runId } = await writeProbeRun(ranFrom, results, notesArg);
  console.log(`\nSaved as run ${runId}. It is now the latest run on the Admin page.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
