# Open questions on the Overwatch wishlist

Everything here blocks or shapes a specific piece of build work. Grouped by who
is likely to have the answer.

## For the Sierra platform side

**1. Does the conversation export return computed tags, or only raw ones?**
Sierra's documentation is explicit that `@transfer` is an Agent Studio
construct, and that its count can differ from the raw `transfer` tag written on
the conversation. Overwatch reads tags from the export, so it matters which it
gets.

*Why it matters:* containment depends on spotting transfers. The plan is to
evaluate `has(tags, 'transfer')` in Overwatch — mirroring the agent's system
definition — so the rule stays visible and editable, and so it doesn't depend on
a computed tag surviving the export. Confirming the raw tags come through is
enough to close this.

*What would settle it:* one real export payload for a conversation that was
transferred.

**2. Can we have the full PSQ tag list?**
We have seven tags from a search for "hang". The complete vocabulary would let
the containment ruleset be built against what Sierra actually writes rather
than inferred from a sample.

**3. Is transfer tracking enabled on all 3–4 agents?**
Confirmed on one. Where it's off, those conversations will have no `transfer`
tag and will silently look contained — the worst kind of wrong number, because
it looks like good news.

**4. Voice, chat, or both?**
"Caller" and "hang up" in the tag names read like voice. If any agent handles
voice, transcript shape and the containment rules both differ from chat.

**5. Is the US environment in scope?**
Not just a different base URL: US transcripts landing in this prototype's
database is a data residency question, and better asked before than after. The
build supports per-agent environments either way.

## For the wishlist's author

**6. Containment — what is the third state?**
The two levels given both assume a correct answer was given. What about a wrong
answer, or an escalation to a human? Proposed:

| Outcome | Rule |
| --- | --- |
| Contained — confirmed | No transfer, customer explicitly confirmed resolution (level 1) |
| Contained — unconfirmed | No transfer, answer given and verified correct, customer disconnected (level 2) |
| Not contained — transferred | `transfer` tag present |
| Not contained — unresolved | No transfer, answer wrong or never given |
| Excluded | Hang-ups for abuse or urgency |

Does that match the intent?

**7. Should abuse and urgency hang-ups be excluded from containment?**
Sierra tags `hang-up:agent:reason:abuse` and `:urgent`. An abusive caller being
cut off is not a containment failure, and counting it as one makes the metric
read worse than reality. Recommend excluding both — worth an explicit yes.

**8. Should "gave the correct answer" reuse the knowledge check?**
Overwatch already verifies factual claims against the three sources.
Recommendation is to derive "correct" from those verdicts rather than ask the
model a second, unanchored "was this right?" question — otherwise containment
and the knowledge flags can disagree about the same transcript. Any objection?

**9. Is "Not contained - caller hang up" applied by a person?**
It's written in a different style to the machine-generated tags. If the team
already tags containment by hand, the more valuable feature is reconciling
Overwatch's judgement against theirs — which also gives an accuracy measure for
the automated rating for free.

**10. Human agent check — which of these?**
(a) Score human-handled interactions with the same competency framework, so bot
and human can be compared, or (b) check that escalations were appropriate and
the handoff was handled well. Different builds.

**11. Knowledge mismatch — confirming the reading.**
Taken as: compare the three verified sources (Pearson knowledge base,
qualifications site, JCQ) **against each other** and surface where they have
drifted out of sync, independent of anything a bot said. That's a bigger and
more useful feature than the existing per-claim drift check, and useful to the
knowledge owners on its own. Confirming this is the intent before it's built.

**12. What is the priority on repeat contacts, and is the constraint accepted?**
It's the one row left blank on the wishlist, and also the most constrained:
transcripts are pulled redacted by design, so there is no identifier to link two
conversations to the same person. It is currently parked rather than
approximated. If it's genuinely essential, the route is an unredacted scope and
a fresh governance conversation — not something to build around quietly.

**13. What's the deadline, and what is the actual go-live gate?**
The solution design flags that the framework is deliberately not pass/fail, so
a gate still needs an agreed line (e.g. any Training Need on Data Protection,
or any hard knowledge flag, blocks go-live pending human review). That decision
belongs to whoever owns the Sierra go-live call.

## Answered, recorded for the trail

- **How many agents, and how are they credentialled?** 3–4, each with its own
  token, same environment, possibly a US environment too. Built for this: agents
  are per-row config with per-agent tokens resolved from the worker's
  environment.
- **Is there a handoff signal in the data?** Yes — conversation tags, which
  Overwatch already stores. This is what unblocked containment.
