# Product and features

Status: Draft — no features committed.

## Working core journey

Capture a URL or file with minimal interruption; see it in an unsorted library immediately; search by words or meaning; open the matching source or specific passage; and place relevant references on a board with notes explaining the connection. A later agent integration can retrieve selected, authorized saves with citations. [Reference study](09-reference-research.md) distinguishes observed behavior from proposed behavior.

The original pitch included an optional personal note at capture. The current direction prioritizes bringing references together and finding them again; capturing a note is optional and should never interrupt saving. Searching for a mood or aesthetic across different media is a desired outcome to validate.

**Proposed first experiment:** an authenticated web library with URL and image upload, immediate durable capture, asynchronous metadata and search indexing, search with source previews, and a small manually curated board. Keep browser extension capture, automated source sync, agent actions, video/audio indexing, and automatic connection suggestions as follow-on experiments until their value and operating cost are understood. This is a suggested sequencing, not a commitment to exclude them from the vision.

Save states must be truthful: saving → saved/processing → ready, or failed with a retry. A URL can be saved even if extraction fails; never claim that enrichment succeeded just because a request was accepted. Let users remove a save, retry processing, and see duplicates. Users should control any AI-proposed edits before they are applied.

## Core experience

- **Main user goal:** [Fill in]
- **Starting situation:** [Fill in]
- **Shortest path to a useful result:** [Fill in]
- **What the user has accomplished at the end:** [Fill in]
- **How quickly should a new user reach that result?** [Fill in]

## First release

- **The smallest complete promise we can deliver:** [Fill in]
- **Required capabilities:** [Fill in]
- **Explicitly outside this release:** [Fill in]
- **Constraints: time, budget, platform, or integrations:** [Fill in]

## Feature list

Use Must / Next / Later for priority and Idea / Validating / Ready / Building / Done for status. A Must should be necessary to deliver the first-release promise.

| Feature | User problem | Priority | Status | Evidence or reason | Dependency |
| --- | --- | --- | --- | --- | --- |
| [Fill in] | [Fill in] | [Choose] | Idea | [Fill in] | [Fill in] |

## Feature brief

Copy this section below for each feature when it is ready to explore or build.

### [Feature name]

- **User and situation:** [Fill in]
- **Desired outcome:** [Fill in]
- **Behavior:** [Fill in]
- **Scope and exclusions:** [Fill in]
- **User flow or design link:** [Fill in]
- **Data and permissions involved:** [Fill in]
- **Empty, loading, error, and recovery states:** [Fill in]
- **Dependencies and open questions:** [Fill in]
- **How we will know it helps:** [Fill in]

Acceptance criteria — observable behavior someone can verify:

- [ ] Given [starting condition], when [action], then [result].
- [ ] If [failure or edge case], the user can [recover safely].

## Next action

- [ ] Choose one core journey and define the features required to complete it.
