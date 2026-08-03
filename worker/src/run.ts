import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { analyzeTranscript } from "./analysis/pipeline.js";
import { writeInteraction } from "./db/writeInteraction.js";
import { pullConversations } from "./sierra.js";

const args = process.argv.slice(2);
const useFixture = args.includes("--fixture");
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 10;

async function runFixture() {
  const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "sample-transcript.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));
  console.log(`Analyzing fixture transcript ${fixture.sierra_conversation_id}...`);
  const analysis = await analyzeTranscript(fixture.messages);
  console.log(JSON.stringify(analysis, null, 2));

  if (process.env.SUPABASE_URL) {
    const result = await writeInteraction(fixture.sierra_conversation_id, fixture.messages, analysis);
    console.log(result.skipped ? "Already in Supabase, skipped." : "Written to Supabase.");
  } else {
    console.log("SUPABASE_URL not set — skipping write, printed analysis only.");
  }
}

async function runLive() {
  console.log(`Pulling up to ${limit} conversations from Sierra...`);
  let count = 0;
  let written = 0;
  for await (const conversation of pullConversations({ limit })) {
    count += 1;
    console.log(`[${count}/${limit}] Analyzing conversation ${conversation.id}...`);
    const analysis = await analyzeTranscript(conversation.messages);
    const result = await writeInteraction(conversation.id, conversation.messages, analysis);
    if (result.skipped) {
      console.log(`  already present, skipped`);
    } else {
      written += 1;
      console.log(`  written (${analysis.intervention_priority}, ${analysis.claims.length} claims)`);
    }
  }
  console.log(`Done. Pulled ${count}, wrote ${written} new interaction(s).`);
}

(useFixture ? runFixture() : runLive()).catch((err) => {
  console.error(err);
  process.exit(1);
});
