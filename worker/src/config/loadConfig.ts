import { getSupabase } from "../db/client.js";
import { COMPETENCIES, COMPETENCY_LEVELS, COMPETENCY_TITLES, type Competency, type CompetencyLevel } from "../analysis/framework.js";
import type { SourceDomain } from "../sources/domains.js";

interface GuidelineRow {
  competency: Competency;
  level: CompetencyLevel;
  descriptor: string;
}

interface KnowledgeSourceRow {
  domain: string;
  base_url: string;
  search_url_template: string;
  seed_urls: string[];
  enabled: boolean;
}

/**
 * Loads the competency rubric from Supabase (editable via the web app's
 * Settings page) and renders it into the same prompt block shape the
 * worker previously built from a hardcoded constant.
 */
export async function loadFrameworkText(): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("competency_guidelines").select("competency, level, descriptor");
  if (error) throw error;

  const rows = (data ?? []) as GuidelineRow[];
  const byCompetency = new Map<string, Map<string, string>>();
  for (const row of rows) {
    const levels = byCompetency.get(row.competency) ?? new Map<string, string>();
    levels.set(row.level, row.descriptor);
    byCompetency.set(row.competency, levels);
  }

  const missing: string[] = [];
  const blocks = COMPETENCIES.map((competency) => {
    const levels = byCompetency.get(competency);
    const lines = COMPETENCY_LEVELS.map((level) => {
      const descriptor = levels?.get(level);
      if (!descriptor) missing.push(`${competency}/${level}`);
      return `    - ${level}: ${descriptor ?? "(no guideline set)"}`;
    }).join("\n");
    return `- ${COMPETENCY_TITLES[competency]} (${competency}):\n${lines}`;
  }).join("\n");

  if (missing.length > 0) {
    console.warn(`Warning: competency_guidelines is missing rows for: ${missing.join(", ")}`);
  }

  return blocks;
}

/** Loads the verified source list from Supabase (editable via the web app's Settings page). */
export async function loadSourceDomains(): Promise<SourceDomain[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("knowledge_sources")
    .select("domain, base_url, search_url_template, seed_urls")
    .eq("enabled", true);
  if (error) throw error;

  const rows = (data ?? []) as KnowledgeSourceRow[];
  if (rows.length === 0) {
    throw new Error("No enabled rows in knowledge_sources — nothing to verify claims against. Check the Settings page.");
  }

  return rows.map((row) => ({
    domain: row.domain,
    baseUrl: row.base_url,
    searchUrlTemplate: row.search_url_template,
    seedUrls: row.seed_urls ?? [],
  }));
}
