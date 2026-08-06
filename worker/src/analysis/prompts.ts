export interface TranscriptMessage {
  role: string;
  text: string;
}

export function buildScoreAndExtractPrompt(messages: TranscriptMessage[], frameworkText: string): string {
  const transcriptText = messages.map((m) => `${m.role}: ${m.text}`).join("\n");
  return `You are assessing a redacted customer service transcript from Sierra (Pearson's CSX support agent) before go-live.

## Task
1. Score the transcript against the Pearson competency framework below. Every competency must get exactly one level and a short rationale grounded in specific things said in the transcript.
2. Extract every factual claim the agent made to the customer that could be checked against a verified external source (qualification rules, deadlines, policies, processes). Skip small talk, opinions, and claims with no checkable factual content. If there are no checkable claims, return an empty list.

## Competency framework
${frameworkText}

## Transcript
${transcriptText}`;
}

export interface SourceExcerpt {
  domain: string;
  url: string | null;
  excerpt: string | null;
  fetch_ok: boolean;
}

export interface ClaimWithSources {
  claim_text: string;
  sources: SourceExcerpt[];
}

interface DedupedSource extends SourceExcerpt {
  ref: string;
}

/**
 * Multiple claims in the same transcript often resolve to the same fetched
 * page (or the same failed fetch for a domain) — dedupe so that page's text
 * is embedded once in the prompt, not once per claim that references it.
 */
export function dedupeSources(sourcesPerClaim: SourceExcerpt[][]): {
  sources: DedupedSource[];
  refsPerClaim: string[][];
} {
  const registry = new Map<string, DedupedSource>();
  let nextRef = 1;
  const refsPerClaim = sourcesPerClaim.map((claimSources) =>
    claimSources.map((s) => {
      const key = `${s.domain}::${s.fetch_ok ? s.url : "FAILED"}`;
      let entry = registry.get(key);
      if (!entry) {
        entry = { ...s, ref: `S${nextRef++}` };
        registry.set(key, entry);
      }
      return entry.ref;
    })
  );
  return { sources: Array.from(registry.values()), refsPerClaim };
}

export function buildVerifyClaimsPrompt(
  claims: { claim_text: string }[],
  sources: DedupedSource[],
  refsPerClaim: string[][]
): string {
  const sourcesBlock = sources
    .map((s) => {
      if (!s.fetch_ok) {
        return `[${s.ref}] ${s.domain}: FETCH FAILED (no content retrieved — do not treat this as "no match", it is missing information)`;
      }
      return `[${s.ref}] ${s.domain} (${s.url}):\n"""\n${s.excerpt}\n"""`;
    })
    .join("\n\n");

  const claimsBlock = claims
    .map((c, i) => `Claim ${i}: "${c.claim_text}"\nRelevant sources: ${refsPerClaim[i].join(", ")}`)
    .join("\n\n");

  const domainList = Array.from(new Set(sources.map((s) => s.domain))).join(", ");

  return `You are verifying factual claims made by a Sierra support agent against these verified sources: ${domainList}.

## Rules
- None of these sources is automatically "ground truth" on its own — e.g. jcq.org.uk is not Pearson-managed and can legitimately disagree with Pearson's own pages.
- If the sources that successfully returned content agree with the claim: "verified".
- If the sources that successfully returned content contradict the claim: "drift" (hard flag).
- If two or more sources that successfully returned content disagree with EACH OTHER on the same point: "source_conflict" (hard flag), and cite every conflicting source.
- If every source for this claim failed to fetch (no content at all): "fetch_failed". This is a plumbing failure, not a confidence judgement — do not call it "unverifiable".
- If at least one source fetched successfully but none of the successfully-fetched content addresses the claim, or you are not confident enough to call it either way: "unverifiable" (soft flag).
- confidence is your confidence in the flag_status you chose, 0-1.
- cited_sources must list the domains you actually relied on (empty if fetch_failed).

## Sources
${sourcesBlock}

## Claims to verify
Each claim lists which of the sources above are relevant to it — a source ref may be shared by more than one claim (a repeated ref means the same page or the same failed fetch, not a new one).
${claimsBlock}`;
}
