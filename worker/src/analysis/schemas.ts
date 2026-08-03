import { COMPETENCIES, COMPETENCY_LEVELS } from "./framework.js";

const competencyScoreSchema = {
  type: "object",
  properties: {
    level: { type: "string", enum: COMPETENCY_LEVELS },
    rationale: { type: "string" },
  },
  required: ["level", "rationale"],
  additionalProperties: false,
} as const;

/** Call 1: score the transcript against the competency framework and extract factual claims worth checking. */
export const SCORE_AND_EXTRACT_SCHEMA = {
  name: "record_assessment",
  description: "Record the competency assessment and the factual claims that need verification against external sources.",
  input_schema: {
    type: "object",
    properties: {
      competency_scores: {
        type: "object",
        properties: Object.fromEntries(COMPETENCIES.map((c) => [c, competencyScoreSchema])),
        required: [...COMPETENCIES],
        additionalProperties: false,
      },
      claims: {
        type: "array",
        description: "Factual claims the agent made to the customer that can be checked against a verified source. Omit opinions, small talk, or claims with no checkable factual content.",
        items: {
          type: "object",
          properties: {
            claim_text: { type: "string", description: "The factual claim as stated, in plain English." },
            topic_keywords: {
              type: "array",
              items: { type: "string" },
              description: "3-6 keywords to help locate the relevant source page (e.g. qualification name, policy area).",
            },
          },
          required: ["claim_text", "topic_keywords"],
          additionalProperties: false,
        },
      },
    },
    required: ["competency_scores", "claims"],
    additionalProperties: false,
  },
} as const;

/** Call 2: given fetched source excerpts, classify each claim. */
export const VERIFY_CLAIMS_SCHEMA = {
  name: "record_claim_verdicts",
  description: "Record a verification verdict for each claim, grounded only in the provided source excerpts.",
  input_schema: {
    type: "object",
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            claim_index: { type: "integer", description: "Index of the claim in the input list, 0-based." },
            flag_status: {
              type: "string",
              enum: ["verified", "drift", "unverifiable", "source_conflict", "fetch_failed"],
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            rationale: { type: "string" },
            cited_sources: {
              type: "array",
              description: "Which of the provided sources (by domain) support this verdict.",
              items: { type: "string" },
            },
          },
          required: ["claim_index", "flag_status", "confidence", "rationale", "cited_sources"],
          additionalProperties: false,
        },
      },
    },
    required: ["verdicts"],
    additionalProperties: false,
  },
} as const;
