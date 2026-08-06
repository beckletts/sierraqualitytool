/**
 * Structural constants for the Pearson competency framework — the 4
 * competencies and 4 levels are fixed (the schema, the score dropdowns, and
 * the Supabase check constraints are all built around them). The actual
 * descriptor text per cell is editable data, loaded from the
 * `competency_guidelines` table — see `config/loadConfig.ts`.
 */

export const COMPETENCY_LEVELS = ["Training Need", "Developing", "Good", "Excellent"] as const;
export type CompetencyLevel = (typeof COMPETENCY_LEVELS)[number];

export const COMPETENCIES = ["data_protection", "communication", "knowledge_guidance", "ownership"] as const;
export type Competency = (typeof COMPETENCIES)[number];

export const COMPETENCY_TITLES: Record<Competency, string> = {
  data_protection: "Data Protection",
  communication: "Communication",
  knowledge_guidance: "Knowledge & Guidance",
  ownership: "Ownership",
};
