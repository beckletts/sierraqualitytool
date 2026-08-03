import { callStructured } from "./claude.js";
import { buildScoreAndExtractPrompt, buildVerifyClaimsPrompt, dedupeSources, type TranscriptMessage } from "./prompts.js";
import { SCORE_AND_EXTRACT_SCHEMA, VERIFY_CLAIMS_SCHEMA } from "./schemas.js";
import { fetchAllSources } from "../sources/fetch.js";
import type { Competency, CompetencyLevel } from "./framework.js";

interface ScoreAndExtractResult {
  competency_scores: Record<Competency, { level: CompetencyLevel; rationale: string }>;
  claims: { claim_text: string; topic_keywords: string[] }[];
}

interface VerifyClaimsResult {
  verdicts: {
    claim_index: number;
    flag_status: "verified" | "drift" | "unverifiable" | "source_conflict" | "fetch_failed";
    confidence: number;
    rationale: string;
    cited_sources: string[];
  }[];
}

export interface AnalyzedClaim {
  claim_text: string;
  flag_status: VerifyClaimsResult["verdicts"][number]["flag_status"];
  confidence: number;
  rationale: string;
  sources: { domain: string; url: string | null; excerpt: string | null; fetch_ok: boolean }[];
}

export interface AnalysisResult {
  competency_scores: ScoreAndExtractResult["competency_scores"];
  claims: AnalyzedClaim[];
  intervention_priority: "hard_flag" | "soft_flag" | "none";
}

const HARD_FLAGS = new Set(["drift", "source_conflict"]);
const SOFT_FLAGS = new Set(["unverifiable", "fetch_failed"]);

function derivePriority(claims: AnalyzedClaim[]): AnalysisResult["intervention_priority"] {
  if (claims.some((c) => HARD_FLAGS.has(c.flag_status))) return "hard_flag";
  if (claims.some((c) => SOFT_FLAGS.has(c.flag_status))) return "soft_flag";
  return "none";
}

function normalizeClaimText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s%]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Collapses claims that are verbatim (modulo case/punctuation) restatements
 * of each other — agents often repeat the same fact within a transcript.
 * Deliberately exact-match only: a fuzzy similarity threshold risks merging
 * two claims that read alike but disagree on the substance (e.g. "up to 50%"
 * vs "up to 25%"), which would silently drop a claim that needed its own
 * verification.
 */
function dedupeClaims<T extends { claim_text: string }>(claims: T[]): T[] {
  const seen = new Map<string, T>();
  for (const claim of claims) {
    const key = normalizeClaimText(claim.claim_text);
    if (!seen.has(key)) seen.set(key, claim);
  }
  return Array.from(seen.values());
}

export async function analyzeTranscript(messages: TranscriptMessage[]): Promise<AnalysisResult> {
  const scoreAndExtract = await callStructured<ScoreAndExtractResult>(
    buildScoreAndExtractPrompt(messages),
    SCORE_AND_EXTRACT_SCHEMA
  );
  const claimsToVerify = dedupeClaims(scoreAndExtract.claims);

  if (claimsToVerify.length === 0) {
    return { competency_scores: scoreAndExtract.competency_scores, claims: [], intervention_priority: "none" };
  }

  const sourcesPerClaim = await Promise.all(claimsToVerify.map((claim) => fetchAllSources(claim.topic_keywords)));
  const { sources: dedupedSources, refsPerClaim } = dedupeSources(sourcesPerClaim);

  const verifyResult = await callStructured<VerifyClaimsResult>(
    buildVerifyClaimsPrompt(claimsToVerify, dedupedSources, refsPerClaim),
    VERIFY_CLAIMS_SCHEMA
  );

  const verdictByIndex = new Map(verifyResult.verdicts.map((v) => [v.claim_index, v]));

  const claims: AnalyzedClaim[] = claimsToVerify.map((claim, i) => {
    const verdict = verdictByIndex.get(i);
    if (!verdict) {
      return {
        claim_text: claim.claim_text,
        flag_status: "unverifiable",
        confidence: 0,
        rationale: "Model returned no verdict for this claim.",
        sources: sourcesPerClaim[i],
      };
    }
    return {
      claim_text: claim.claim_text,
      flag_status: verdict.flag_status,
      confidence: verdict.confidence,
      rationale: verdict.rationale,
      sources: sourcesPerClaim[i],
    };
  });

  return {
    competency_scores: scoreAndExtract.competency_scores,
    claims,
    intervention_priority: derivePriority(claims),
  };
}
