/**
 * Pearson competency framework — placeholder rubric.
 *
 * This is drafted from the summary in the solution design doc (4 competencies,
 * 4-level scale) because the full framework document wasn't available at build
 * time. Replace `descriptors` below with the real rubric text before relying on
 * scores for anything beyond prototype validation.
 */

export const COMPETENCY_LEVELS = ["Training Need", "Developing", "Good", "Excellent"] as const;
export type CompetencyLevel = (typeof COMPETENCY_LEVELS)[number];

export const COMPETENCIES = ["data_protection", "communication", "knowledge_guidance", "ownership"] as const;
export type Competency = (typeof COMPETENCIES)[number];

export const FRAMEWORK: Record<Competency, { title: string; descriptors: Record<CompetencyLevel, string> }> = {
  data_protection: {
    title: "Data Protection",
    descriptors: {
      "Training Need": "Shares or requests personal/sensitive data without verification; no acknowledgement of data protection obligations.",
      Developing: "Generally cautious but inconsistent verification steps before sharing account-specific information.",
      Good: "Consistently verifies identity/authorisation before sharing personal data; follows data minimisation.",
      Excellent: "Proactively protects customer data, explains why information is or isn't shared, and flags risk correctly.",
    },
  },
  communication: {
    title: "Communication",
    descriptors: {
      "Training Need": "Unclear, jargon-heavy, or tone-inappropriate responses; fails to address the customer's actual question.",
      Developing: "Understandable but inconsistent clarity, structure, or empathy.",
      Good: "Clear, well-structured, appropriately empathetic responses that address the customer's question.",
      Excellent: "Consistently clear, warm, concise communication that anticipates follow-up confusion.",
    },
  },
  knowledge_guidance: {
    title: "Knowledge & Guidance",
    descriptors: {
      "Training Need": "Provides incorrect or ungrounded guidance; no reference to verified sources.",
      Developing: "Mostly correct guidance but with gaps, hedging, or missed nuance.",
      Good: "Accurate, complete guidance grounded in verified policy/process knowledge.",
      Excellent: "Accurate, complete, and proactively surfaces relevant caveats or next steps.",
    },
  },
  ownership: {
    title: "Ownership",
    descriptors: {
      "Training Need": "Deflects, provides no resolution path, or leaves the customer without next steps.",
      Developing: "Attempts resolution but with unclear ownership of next steps or follow-up.",
      Good: "Takes clear ownership of the interaction through to a resolution or explicit next step.",
      Excellent: "Takes ownership, confirms resolution, and closes loops proactively.",
    },
  },
};

export function renderFrameworkForPrompt(): string {
  return COMPETENCIES.map((key) => {
    const { title, descriptors } = FRAMEWORK[key];
    const levels = COMPETENCY_LEVELS.map((level) => `    - ${level}: ${descriptors[level]}`).join("\n");
    return `- ${title} (${key}):\n${levels}`;
  }).join("\n");
}
