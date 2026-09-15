import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { analyzeTranscript, type AnalysisConfig } from "./analysis/pipeline.js";
import { backfillMetadata, writeInteraction } from "./db/writeInteraction.js";
import { pullConversations } from "./sierra.js";
import { loadFrameworkText, loadSourceDomains } from "./config/loadConfig.js";
import { loadAgentRecords, loadAgents } from "./config/agents.js";

async function loadAnalysisConfig(): Promise<AnalysisConfig> {
  const [frameworkText, sources] = await Promise.all([loadFrameworkText(), loadSourceDomains()]);
  return { frameworkText, sources };
}

/**
 * Accepts either raw Unix epoch seconds or a plain date (e.g. "2026-07-29") —
 * the Admin API only takes epoch seconds. A bare date used as `end` is bumped
 * to the start of the following day so "29th July to 3rd August" includes all
 * of the 3rd, not just its first instant.
 */
function parseTimestamp(value: string, endOfDay: boolean): number {
  if (/^\d+$/.test(value)) return Number(value);
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`Could not parse timestamp: "${value}"`);
  return Math.floor((isDateOnly && endOfDay ? ms + 24 * 60 * 60 * 1000 : ms) / 1000);
}

const args = process.argv.slice(2);
const useFixture = args.includes("--fixture");
const backfillOnly = args.includes("--backfill-metadata");
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 10;
const startArg = args.find((a) => a.startsWith("--start="));
const endArg = args.find((a) => a.startsWith("--end="));
const agentArg = args.find((a) => a.startsWith("--agent="))?.split("=")[1];

async function runFixture() {
  // The fixture never calls Sierra, so it needs an agent to file the result
  // under but not that agent's token.
  const [agent] = await loadAgentRecords(agentArg ? { only: agentArg } : {});
  if (!agent) {
    throw new Error("No enabled rows in `agents` — add a Sierra agent on the Settings page first.");
  }

  const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "sample-transcript.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));
  console.log("Loading framework + knowledge sources from the database...");
  const config = await loadAnalysisConfig();
  console.log(`Analyzing fixture transcript ${fixture.sierra_conversation_id} as agent "${agent.name}"...`);
  const analysis = await analyzeTranscript(fixture.messages, config);
  console.log(JSON.stringify(analysis, null, 2));

  const result = await writeInteraction(agent.id, fixture.sierra_conversation_id, fixture.messages, analysis);
  console.log(result.skipped ? "Already in the database, skipped." : "Written to the database.");
}

async function runLive() {
  if (!startArg || !endArg) {
    throw new Error("Sierra's export endpoint requires both --start= and --end= (a date like 2026-07-29 or epoch seconds)");
  }
  const startEpochSeconds = parseTimestamp(startArg.split("=")[1], false);
  const endEpochSeconds = parseTimestamp(endArg.split("=")[1], true);

  const agents = await loadAgents(agentArg ? { only: agentArg } : {});

  console.log(
    `Pulling up to ${limit} conversations per agent from ${agents.length} agent(s), ${new Date(startEpochSeconds * 1000).toISOString()} to ${new Date(endEpochSeconds * 1000).toISOString()}${backfillOnly ? " (backfill-metadata mode — no Claude calls, no new rows)" : ""}...`
  );

  let config: AnalysisConfig | null = null;
  if (!backfillOnly) {
    console.log("Loading framework + knowledge sources from the database...");
    config = await loadAnalysisConfig();
  }

  const summary: { agent: string; pulled: number; written: number }[] = [];

  for (const agent of agents) {
    console.log(`\n=== ${agent.name} (${agent.sierraAgentId}, ${agent.environment}) ===`);
    let count = 0;
    let written = 0;

    for await (const conversation of pullConversations({ agent, limit, startEpochSeconds, endEpochSeconds })) {
      count += 1;

      if (backfillOnly) {
        const result = await backfillMetadata(agent.id, conversation.id, {
          startTimestamp: conversation.startTimestamp,
          tags: conversation.tags,
          customFields: conversation.customFields,
          device: conversation.device,
        });
        console.log(`[${count}/${limit}] ${conversation.id}: ${result.updated ? "metadata backfilled" : "not in the database, skipped"}`);
        if (result.updated) written += 1;
        continue;
      }

      console.log(`[${count}/${limit}] Analyzing conversation ${conversation.id}...`);
      const analysis = await analyzeTranscript(conversation.messages, config!);
      const result = await writeInteraction(agent.id, conversation.id, conversation.messages, analysis, {
        startTimestamp: conversation.startTimestamp,
        tags: conversation.tags,
        customFields: conversation.customFields,
        device: conversation.device,
      });
      if (result.skipped) {
        console.log(`  already present, skipped`);
      } else {
        written += 1;
        console.log(`  written (${analysis.intervention_priority}, ${analysis.claims.length} claims)`);
      }
    }

    summary.push({ agent: agent.name, pulled: count, written });
  }

  console.log("");
  for (const row of summary) {
    console.log(
      backfillOnly
        ? `${row.agent}: pulled ${row.pulled}, backfilled metadata on ${row.written} existing row(s).`
        : `${row.agent}: pulled ${row.pulled}, wrote ${row.written} new interaction(s).`
    );
  }
  const totalPulled = summary.reduce((sum, row) => sum + row.pulled, 0);
  const totalWritten = summary.reduce((sum, row) => sum + row.written, 0);
  console.log(
    backfillOnly
      ? `Done. Pulled ${totalPulled} across ${summary.length} agent(s), backfilled metadata on ${totalWritten} existing row(s).`
      : `Done. Pulled ${totalPulled} across ${summary.length} agent(s), wrote ${totalWritten} new interaction(s).`
  );
}

(useFixture ? runFixture() : runLive()).catch((err) => {
  console.error(err);
  process.exit(1);
});
