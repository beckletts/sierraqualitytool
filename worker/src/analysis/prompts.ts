import { renderFrameworkForPrompt } from "./framework.js";

export interface TranscriptMessage {
  role: string;
  text: string;
}

export function buildScoreAndExtractPrompt(messages: TranscriptMessage[]): string {
  const transcriptText = messages.map((m) => `${m.role}: ${m.text}`).join("\n");
  return `You are assessing a redacted customer service transcript from Sierra (Pearson's CSX support agent) before go-live.

## Task
1. Score the transcript against the Pearson competency framework below. Every competency must get exactly one level and a short rationale grounded in specific things said in the transcript.
2. Extract every factual claim the agent made to the customer that could be checked against a verified external source (qualification rules, deadlines, policies, processes). Skip small talk, opinions, and claims with no checkable factual content. If there are no checkable claims, return an empty list.

## Competency framework
${renderFrameworkForPrompt()}

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

export function buildVerifyClaimsPrompt(claims: ClaimWithSources[]): string {
  const claimsBlock = claims
    .map((c, i) => {
      const sourcesBlock = c.sources
        .map((s) => {
          if (!s.fetch_ok) {
            return `  - ${s.domain}: FETCH FAILED (no content retrieved — do not treat this as "no match", it is missing information)`;
          }
          return `  - ${s.domain} (${s.url}):\n    """\n${s.excerpt}\n    """`;
        })
        .join("\n");
      return `Claim ${i}: "${c.claim_text}"\nSources:\n${sourcesBlock}`;
    })
    .join("\n\n");

  return `You are verifying factual claims made by a Sierra support agent against three verified sources: qualifications.pearson.com, jcq.org.uk, and support.pearson.com.

## Rules
- None of the three sources is automatically "ground truth" — jcq.org.uk is not Pearson-managed and can legitimately disagree with Pearson's own pages.
- If the sources that successfully returned content agree with the claim: "verified".
- If the sources that successfully returned content contradict the claim: "drift" (hard flag).
- If two or more sources that successfully returned content disagree with EACH OTHER on the same point: "source_conflict" (hard flag), and cite every conflicting source.
- If every source for this claim failed to fetch (no content at all): "fetch_failed". This is a plumbing failure, not a confidence judgement — do not call it "unverifiable".
- If at least one source fetched successfully but none of the successfully-fetched content addresses the claim, or you are not confident enough to call it either way: "unverifiable" (soft flag).
- confidence is your confidence in the flag_status you chose, 0-1.
- cited_sources must list the domains you actually relied on (empty if fetch_failed).

## Claims to verify
${claimsBlock}`;
}
