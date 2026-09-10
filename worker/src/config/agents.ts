import { getPool } from "../db/client.js";

/** An agent as stored — no credentials. Enough to identify and label it. */
export interface AgentRecord {
  id: string;
  sierraAgentId: string;
  name: string;
  environment: string;
  baseUrl: string;
  orgId: string;
  tokenEnvVar: string;
}

/** An agent the worker can actually pull from: a record plus its resolved token. */
export interface SierraAgent extends AgentRecord {
  token: string;
}

interface AgentRow {
  id: string;
  sierra_agent_id: string;
  name: string;
  environment: string;
  sierra_base_url: string;
  sierra_org_id: string;
  token_env_var: string;
}

/** Env var names only — anything else in that column is a mistake worth catching early. */
const ENV_VAR_PATTERN = /^[A-Z][A-Z0-9_]*$/;

function toRecord(row: AgentRow): AgentRecord {
  return {
    id: row.id,
    sierraAgentId: row.sierra_agent_id,
    name: row.name,
    environment: row.environment,
    baseUrl: row.sierra_base_url,
    orgId: row.sierra_org_id,
    tokenEnvVar: row.token_env_var,
  };
}

/**
 * Loads enabled agents from the `agents` table (editable via the web app's
 * Settings page). `only` narrows to a single agent by Sierra agent ID or by
 * name, case-insensitively — what `--agent=` passes through.
 *
 * No token resolution: use this where the worker labels data rather than
 * fetches it (fixture runs), so a missing token doesn't block work that
 * never touches Sierra.
 */
export async function loadAgentRecords(options: { only?: string } = {}): Promise<AgentRecord[]> {
  const pool = getPool();
  const { rows } = await pool.query<AgentRow>(
    `select id, sierra_agent_id, name, environment, sierra_base_url, sierra_org_id, token_env_var
     from agents
     where enabled = true
     order by name`
  );

  const records = rows.map(toRecord);
  if (!options.only) return records;

  const needle = options.only.trim().toLowerCase();
  const matched = records.filter(
    (agent) => agent.sierraAgentId.toLowerCase() === needle || agent.name.toLowerCase() === needle
  );
  if (matched.length === 0) {
    const available = records.map((a) => `${a.name} (${a.sierraAgentId})`).join(", ") || "none";
    throw new Error(`No enabled agent matches --agent="${options.only}". Enabled agents: ${available}`);
  }
  return matched;
}

/**
 * Loads enabled agents with their Admin API tokens resolved from the
 * environment. Every missing token is reported at once, and the run fails
 * rather than skipping that agent: a silently skipped agent looks identical to
 * an agent that had no conversations, which is exactly the wrong thing for a
 * quality gate to be vague about.
 *
 * Only env var *names* appear in errors — never a value.
 */
export async function loadAgents(options: { only?: string } = {}): Promise<SierraAgent[]> {
  const records = await loadAgentRecords(options);
  if (records.length === 0) {
    throw new Error("No enabled rows in `agents` — add a Sierra agent on the Settings page first.");
  }

  const problems: string[] = [];
  const agents: SierraAgent[] = [];

  for (const record of records) {
    if (!ENV_VAR_PATTERN.test(record.tokenEnvVar)) {
      problems.push(
        `${record.name}: "token_env_var" should be the NAME of an environment variable (e.g. SIERRA_TOKEN_SUPPORT), not a token or other value.`
      );
      continue;
    }
    const token = process.env[record.tokenEnvVar];
    if (!token) {
      problems.push(`${record.name} (${record.sierraAgentId}): ${record.tokenEnvVar} is not set.`);
      continue;
    }
    agents.push({ ...record, token });
  }

  if (problems.length > 0) {
    throw new Error(`Cannot pull from every enabled agent:\n  - ${problems.join("\n  - ")}`);
  }

  return agents;
}
