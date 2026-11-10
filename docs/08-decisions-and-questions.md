# Decisions and questions

Use this log for choices that affect product direction, design, engineering, or delivery. Nothing below is a confirmed decision until it is recorded as accepted.

## Direction recorded from Nico — 2026-11-09

- The concept should draw on the cited references for effortless saving, multimodal retrieval, connections, and an expressive interface. Explore Surface Field in the UI.
- Build for a hosted web app with backend processing; do not assume the local desktop architecture of Pond or DigUp transfers unchanged.
- Open: first audience and specific first-release promise; source integrations and permissions; hosting and inference costs; how proactive connections earn trust. See [reference research](09-reference-research.md).

## Answers from Nico — 2026-11-10

- **First audience:** designers (still a hypothesis to test with real people).
- **Core promise:** Find, Connect and Use together. Self-reflection/taste analytics is out of the first release.
- **Capture:** paste a URL, upload images/files, and a browser extension based on Pond's. Source sync from social saves is not requested.
- **Stack:** Next.js + Postgres (pgvector for search).
- **To check:** Pond's extension talks to a local desktop host through native messaging, so it needs a hosted API in its place. Confirm Pond's license permits reuse before copying code. The scope is larger than the experiment proposed in [04](04-product-and-features.md).

## Open questions

| Question | Why it matters | How to answer it | Owner | Status |
| --- | --- | --- | --- | --- |
| Who is the first audience? | Sets the scope for research and the first release | Complete the users worksheet and gather evidence | Unassigned | Open |
| What is the core promise? | Determines which features are necessary | Complete the mission and product worksheets | Unassigned | Open |

## Risks and assumptions

| Risk or assumption | Impact if wrong | Evidence or mitigation needed | Owner | Status |
| --- | --- | --- | --- | --- |
| [Fill in] | [Fill in] | [Fill in] | [Fill in] | Open |

## Decision log

Copy the entry below for each consequential decision. Use Proposed / Accepted / Superseded / Rejected for status. Preserve old entries; link to the replacement when a decision changes.

### D-001: [Decision title]

- **Date:** [YYYY-MM-DD]
- **Status:** Proposed
- **Context and constraints:** [Fill in]
- **Options considered:** [Fill in]
- **Decision:** [Fill in]
- **Reason and supporting evidence:** [Fill in]
- **Tradeoffs and consequences:** [Fill in]
- **Affected documents or implementation:** [Fill in]
- **When to revisit:** [Fill in]

## Working review

When you learn something material or complete a milestone:

- [ ] Update the relevant worksheet with the evidence.
- [ ] Resolve or revise affected questions and assumptions.
- [ ] Record any consequential decision and its reasoning.
- [ ] Adjust the next tasks to reflect what changed.
