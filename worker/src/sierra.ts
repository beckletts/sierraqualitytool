import type { TranscriptMessage } from "./analysis/prompts.js";
import type { SierraAgent } from "./config/agents.js";

export interface SierraConversation {
  id: string;
  messages: TranscriptMessage[];
  startTimestamp: number;
  tags: string[];
  customFields: Record<string, unknown>;
  device: string | null;
}

interface SierraExportResponse {
  conversations: {
    id: string;
    messages: { author: "USER" | "AGENT"; text: string }[];
    start_timestamp: number;
    tags?: string[];
    custom_fields?: Record<string, unknown>;
    device?: string;
  }[];
  next_cursor?: string | null;
}

const MAX_RETRIES = 5;
const MAX_PAGE_LIMIT = 500;

function backoffMs(attempt: number): number {
  const base = 1000 * 2 ** attempt;
  return base + Math.floor(Math.random() * 500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pulls redacted conversations from Sierra's Admin API bulk conversation export
 * endpoint: GET /admin/1/orgs/{org_id}/agents/{agent_id}/conversations/export
 * Paginates via the `cursor` field returned as `next_cursor`, and backs off with
 * jitter on 429. `start`/`end` are Unix epoch seconds (the window is fixed for
 * the whole pull; only `cursor` advances between pages).
 *
 * The agent carries its own base URL, org, ID and token — each Sierra agent has
 * a separate token, and they may not all live in the same environment.
 */
export async function* pullConversations(options: {
  agent: SierraAgent;
  limit: number;
  startEpochSeconds: number;
  endEpochSeconds: number;
}): AsyncGenerator<SierraConversation> {
  const { baseUrl, orgId, sierraAgentId: agentId, token } = options.agent;

  let cursor: string | undefined;
  let remaining = options.limit;

  while (remaining > 0) {
    const url = new URL(`/admin/1/orgs/${orgId}/agents/${agentId}/conversations/export`, baseUrl);
    url.searchParams.set("start", String(options.startEpochSeconds));
    url.searchParams.set("end", String(options.endEpochSeconds));
    url.searchParams.set("limit", String(Math.min(remaining, MAX_PAGE_LIMIT)));
    url.searchParams.set("redacted", "true");
    if (cursor) url.searchParams.set("cursor", cursor);

    const page = await fetchPageWithBackoff(url.toString(), token);
    if (!page || page.conversations.length === 0) return;

    for (const conversation of page.conversations) {
      yield {
        id: conversation.id,
        messages: conversation.messages.map((m) => ({
          role: m.author === "AGENT" ? "agent" : "customer",
          text: m.text,
        })),
        startTimestamp: conversation.start_timestamp,
        tags: conversation.tags ?? [],
        customFields: conversation.custom_fields ?? {},
        device: conversation.device ?? null,
      };
      remaining -= 1;
      if (remaining <= 0) return;
    }

    if (!page.next_cursor) return;
    cursor = page.next_cursor;
  }
}

async function fetchPageWithBackoff(url: string, token: string): Promise<SierraExportResponse | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429) {
      if (attempt === MAX_RETRIES) throw new Error("Sierra API rate limit exceeded after retries");
      await sleep(backoffMs(attempt));
      continue;
    }
    if (!res.ok) {
      throw new Error(`Sierra API error ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as SierraExportResponse;
  }
  return null;
}
