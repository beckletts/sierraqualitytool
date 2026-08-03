import type { TranscriptMessage } from "./analysis/prompts.js";

export interface SierraConversation {
  id: string;
  messages: TranscriptMessage[];
}

interface SierraExportResponse {
  conversations: { id: string; messages: { role: string; text: string }[] }[];
  next_start?: string | null;
}

const MAX_RETRIES = 5;

function backoffMs(attempt: number): number {
  const base = 1000 * 2 ** attempt;
  return base + Math.floor(Math.random() * 500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pulls redacted conversations from Sierra's Admin API `conversations/export`
 * endpoint (Read scope), paginating via start/end/limit and backing off with
 * jitter on 429. Kept generic since the exact response shape is unverified
 * without live credentials — adjust field names once tested against the real API.
 */
export async function* pullConversations(options: {
  limit: number;
  start?: string;
  end?: string;
}): AsyncGenerator<SierraConversation> {
  const baseUrl = process.env.SIERRA_API_BASE_URL;
  const token = process.env.SIERRA_API_TOKEN;
  if (!baseUrl) throw new Error("SIERRA_API_BASE_URL is not set");
  if (!token) throw new Error("SIERRA_API_TOKEN is not set");

  let cursor: string | undefined = options.start;
  let remaining = options.limit;

  while (remaining > 0) {
    const url = new URL("/v1/conversations/export", baseUrl);
    url.searchParams.set("limit", String(Math.min(remaining, 100)));
    if (cursor) url.searchParams.set("start", cursor);
    if (options.end) url.searchParams.set("end", options.end);

    const page = await fetchPageWithBackoff(url.toString(), token);
    if (!page || page.conversations.length === 0) return;

    for (const conversation of page.conversations) {
      yield {
        id: conversation.id,
        messages: conversation.messages.map((m) => ({ role: m.role, text: m.text })),
      };
      remaining -= 1;
      if (remaining <= 0) return;
    }

    if (!page.next_start) return;
    cursor = page.next_start;
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
