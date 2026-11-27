# Reference research: capture, connect, and rediscover

Research snapshot: 2026-11-09. This document records observed behavior, source-code findings, and proposals separately. The project is a hosted web app; the desktop products below are references, not existing dependencies or a ready-made server. Video descriptions are based on sampled frames; timing, audio, and behavior between frames may be missed. Thread replies are a limited, potentially incomplete sample, not representative user research.

## The thesis

Inspiration is fragmented across social saves, websites, screenshots, documents, photos, and video. The current direction is to bring a person's references together in one place so they can find and use them whenever needed. The user can then compare or connect them while making something. A personal visual research space is a working hypothesis for the first audience and experience. It is grounded in Nico's account in the [Moody's interview](https://notes.wisprflow.ai/shared/zUYRLWyv9_XygXH_awzqmz59q1iPdEWCfiIIadd7fxU); Todd's question, “what is the output?”, is a useful test for every feature.

Three outcomes make the concept concrete:

1. **Find:** “Show me that chair / article / moment I remember, even if I forgot where I saved it.”
2. **Connect:** “Show these references together and help me explain the relationship.”
3. **Use:** “Bring a selected, cited set of references into a project or an agent.”

The product should let people choose what enters their library and understand what is stored, processed, and sent to an AI provider. Collection, search, and AI synthesis are separate permissions and promises.

## Reference library

### Pond — visual library and quiet capture

Sources: [Pond post](https://x.com/raphaelsalaja/status/2115483627916238970), [Pond repository](https://github.com/raphaelsalaja/pond), and the user-supplied 64-second `pond.mp4` website demo. Source code inspected at commit [`deb305e`](https://github.com/raphaelsalaja/pond/tree/deb305effb47f7984e52fe8c6b486387b7dafc02).

**Observed in the supplied demo:** floating references resolve into a library: a compact navigation sidebar, filter/search bar, and dense image-led grid. It shows bookmarking on X, content appearing in the library, a file on disk, image details, search filters for color, visual match, semantics, tags, folders and shape, and an assistant answer with referenced save cards. The demo explicitly describes its local-first ownership model. It also shows a range of integrations and utilities; the sampled frames do not establish their underlying implementation or completeness.

**Observed in the 2.0 social demo:** Fish answers questions about a library, runs routines on newly arriving saves, and presents proposed changes for review. A clearer library, detail preview and in-app article reader keep the content close to the user's task. The review screen is a useful trust pattern: distinguish recommendations from changes already made.

**Visual and interaction lessons:** use a neutral, quietly structured shell; let the images supply variety. Keep controls small but legible, maintain generous spacing, and let cards show their source or type. The grid enables scanning; detail views support deeper reading without treating every save as a generic link. Use a restrained hierarchy of sidebar, search, cards and preview, with a clear return path and persistent search context. Do not infer exact typefaces, colors, motion curves, or product performance from a compressed video.

**Thread feedback:** one user reported that a Cosmos import lost cluster organization, titles and original sources ([reply](https://x.com/i/web/status/2115526059265519914)); this is a reported experience, not an independently reproduced defect. Another asked for a recap of automatic changes ([reply](https://x.com/i/web/status/2115771198449541510)), and another wanted existing tags protected ([reply](https://x.com/i/web/status/2115730469048418472)). For our import and assistant designs, preserve source attribution and user organization where permissions and available data allow, show what changed, and never silently overwrite user-authored tags.

**Code:** the [extension README](https://github.com/raphaelsalaja/pond/blob/deb305effb47f7984e52fe8c6b486387b7dafc02/apps/extension/README.md) lists page, image, region and screenshot capture, context menus, shortcuts, optional details, and supported site bookmark hooks. The main-world hook observes supported site actions, an isolated bridge validates/relays them, and the extension background sends a `capture.accept` request through native messaging to a desktop host. [`capture.ts`](https://github.com/raphaelsalaja/pond/blob/deb305effb47f7984e52fe8c6b486387b7dafc02/apps/extension/entrypoints/background/capture.ts) creates a UUID, announces sending, handles duplicate/failure/accepted outcomes, and polls `capture.status` at 750 ms up to 20 times. Its fallback treats an accepted request as saved if polling cannot settle; a hosted implementation should instead show durable acceptance and processing as distinct states. Optional details and `Ask Where to Save` mean not every Pond path is one click.

Pond's [supported sources](https://github.com/raphaelsalaja/pond/blob/deb305effb47f7984e52fe8c6b486387b7dafc02/docs/supported-sources.md) distinguish capture, source-specific sync, and session, handle, or API-key connection. Its desktop design can use an existing signed-in browser session locally. Copying that approach to a remote backend would change the risk and trust model substantially: do not silently export a user's site cookies; prefer explicit user-initiated capture or permitted source APIs, and assess each platform's access and content rules.

Pond has separate text and media enrichment. Its [media embedding code](https://github.com/raphaelsalaja/pond/blob/deb305effb47f7984e52fe8c6b486387b7dafc02/apps/desktop/src/renderer/src/features/enrichment/lib/enrichers/media-embedding.ts) embeds a representative image, bounded audio, or sampled video. For video it samples up to 32 frames over the first 32 seconds, combines frame representations, and optionally combines an audio vector; it stores a normalized media vector per save. The [architecture notes](https://github.com/raphaelsalaja/pond/blob/deb305effb47f7984e52fe8c6b486387b7dafc02/docs/contributing/architecture.md) describe a shared multimodal bundle, bounded audio decoding, and a serialized inference worker. This bounded aggregate is useful for item-level similarity; it should not be assumed to identify a precise moment in a long video.

### DigUp — find the matching part

Sources: [Google Gemma post](https://x.com/googlegemma/status/2110044337849692644) and [DigUp repository](https://github.com/ARahim3/DigUp), inspected at [`dc2651a`](https://github.com/ARahim3/DigUp/tree/dc2651ad8299160bbe91e972f857e1a1599a8419).

**Observed:** a compact Spotlight-like search shows results grouped by file type and a large contextual preview. “Zebra in a video” selects a matching frame with a timestamp; a lease search shows the matching PDF page. Returning the exact useful place is more valuable than merely returning a file.

**Code:** its [README architecture](https://github.com/ARahim3/DigUp/blob/dc2651ad8299160bbe91e972f857e1a1599a8419/README.md#how-it-works) describes readers → EmbeddingGemma 2 through llama.cpp → SQLite vectors for images, pages, passages, frames and 30-second sound segments, plus a keyword index. Text queries are embedded in the same 768-dimensional space, and exact words receive a boost. The [searcher](https://github.com/ARahim3/DigUp/blob/dc2651ad8299160bbe91e972f857e1a1599a8419/Sources/DigUpKit/Searcher.swift) combines semantic and FTS signals and retains segment location. This is more granular than Pond's one aggregate media vector; it supports page or timestamp return but has greater indexing and storage cost. Search scoring and model behavior should be evaluated on our own data rather than copied blindly.

DigUp's repository is MIT licensed, and its README identifies the model as Apache 2.0; inspect the exact versions and all bundled dependencies before reuse. DigUp's desktop privacy promise does not automatically apply to a hosted derivative. The hosted service must explain what leaves the device, which processors receive it, and retention/deletion.

### Knowledge board — connections with reasons

[David Pukha's post](https://x.com/davidpukhaa/status/2118364022646902816) shows a bright, spatial canvas containing image stacks, text cards and documents, with thin links and a small toolbar. A reply says the creator's scattered research becomes one board per project, with notes from conversation. When asked whether links were inferred or source-based, the creator says the displayed links were mostly theirs and each line can carry an explanation ([question](https://x.com/i/web/status/2118652068613230768), [reply](https://x.com/i/web/status/2118741802799051027)). This suggests connections should be inspectable, labeled, editable, and explicit about whether a user or model suggested them. Treat similarity as a prompt to explore, not proof that two sources support a claim. The creator later says it was open sourced; the destination and license were not independently verified here.

### One-click reference capture

[Noe's post](https://x.com/noechague/status/2116243745821937803) and sampled video show a visual feed with a bookmark control, immediate “Saved to Unsorted” feedback, Undo, and an optional collection picker. Its text says saved references reach an agent through MCP; the backend implementation is not established by the demo. Design lesson: capture should not require a classification decision; organization can follow. Provide a durable pending state, undo semantics, and a keyboard-accessible explicit action. Any agent should receive only authorized items, and saved material should remain visible and independently usable without an agent.

Replies ask about [X and Instagram bookmarks](https://x.com/i/web/status/2116510936559481207), [bulk export of X saves](https://x.com/i/web/status/2116256053025534168), and [tags and pricing](https://x.com/i/web/status/2116559105733333378). The creator described the first two as forthcoming at the time. These are individual requests rather than confirmed demand or evidence that those integrations exist.

### Search overlay to canvas

[Lorenzo Cabra's post](https://x.com/cabralorenzo/status/2099060380051943735) shows a centered search overlay with recent searches, filter chips and visual thumbnails. A result is dragged to a spacious canvas; selection outlines, alignment guides and a contextual menu support manipulation. A [reply](https://x.com/i/web/status/2099073659067408530) says the feature was easy to miss: make “Add to board” and drag affordances discoverable, and support keyboard placement. The underlying code and license were not verified.

### Surface Field — background, not relationships

[Angelo Libero's post](https://x.com/angeloldesigns/status/2103467857212231728) and [repository](https://github.com/angelolibero/surface-field) show a quiet field of dots/lines that clears around surfaces, reacts to their movement and lights near the pointer. The demo exposes spacing, light, line reach, distortion, ripple, color and light/dark modes. The author acknowledged feedback that constant motion could become tiring and says the effect was tuned around surfaces ([reply](https://x.com/i/web/status/2103864408514744664)). The MIT-licensed React component is decorative, `aria-hidden`, does not intercept pointer events, supports a still reduced-motion frame, and needs the host to provide dimensions and surface rectangles. Its repository includes a React Flow integration example and optional worker rendering with a main-thread fallback. Use it behind the canvas, not as the semantic connection graph; test readability, contrast, battery and motion sensitivity.

## Proposed hosted implementation

### 1. Save immediately, process asynchronously

1. User pastes a URL, uploads a file, or explicitly triggers an extension action. The client creates an idempotency key and optimistically shows a pending card. An extension would use the app's scoped authentication rather than Pond's native host.
2. The API authenticates the user, validates the input and ownership, records a durable save and an outbox/job in the same transaction, then returns its ID and `queued`. Client shows “Saved · processing” only after durable acceptance; network failure shows retry rather than false success. Repeated idempotency keys return the existing result. A canonical URL or content fingerprint can identify potential duplicates without deleting the user's intentional copies.
3. Workers fetch allowed public URLs or process uploaded bytes; store original source URL, attribution, capture time, content type, permitted snapshot and thumbnails. Explicit source authorization and content rights govern what may be fetched, retained, or synchronized. Links remain useful even when a site denies extraction.
4. Workers extract title, text and preview, then segment, embed and index. Persist stage status and safe error codes. Retries use bounded exponential backoff and idempotent writes; permanent failures remain visible and retryable. A user may search metadata and open the original while processing is incomplete.
5. Undo should cancel or soft-delete the specific new save within a short window; queued jobs must check ownership and deletion before writing. Deletion removes derived text, embeddings, cached content and objects according to an explicit retention policy. Define what happens to shared references before implementing sharing.

Start with user-initiated URL and file saving. Intercepting each site's bookmark action requires a site adapter, browser permissions, frequent maintenance and careful consent. A user clicking a platform's own save is not, by itself, permission to upload their entire account or session to the service. Use official APIs or explicitly supported, authorized methods when available; browser-only capture and server-side retrieval have different access and failure modes.

### 2. Data and service boundaries

Suggested minimum entities: `user`; `save` (owner, source URL, metadata, status, created/deleted timestamps); `asset` (private object key, media type, checksum); `segment` (save, type, text or object reference, page/time range); `embedding` (segment, model/version, vector); `collection`; `board`, `board_item`, and `connection` (endpoints, note, origin, evidence, review status); and `job`/outbox. Keep original, derived, and user-authored content distinguishable. Auth and per-user authorization must apply to API reads, vector and keyword searches, previews, background jobs and MCP tools—not just the UI.

For a small pilot, a relational database with full-text and vector support, private object storage, and a durable worker queue is a reasonable candidate. It is not a committed provider or performance claim. Use direct signed uploads for large media where appropriate, short-lived access to objects, and a separate bounded media worker; serve low-resolution previews without exposing original object paths. Introduce external search infrastructure only when measurements justify it.

### 3. Multimodal indexing and search

- Extract readable text from documents and webpages; preserve page or passage coordinates. OCR screenshots and images where needed. Segment long text with overlap and source offsets.
- Index images as images as well as any extracted text. For long video, store sampled frame or clip vectors with timestamps and transcript segments with time ranges; for audio, segment sound and/or speech with timestamps. The sampling interval is a cost/recall tradeoff. Pond's bounded first-32-second aggregate is a useful inexpensive item-level baseline; DigUp's segment approach better supports exact moments. Evaluate both on real examples.
- Use a compatible multimodal embedding model for both queries and indexed modalities; store the model/version, dimension and preprocessing version. Vectors from incompatible models must not be compared. Re-index when the model or preprocessing changes; separate indexes during migration.
- Run tenant-filtered keyword and vector searches, merge/rerank results, and collapse multiple matching segments into a save while retaining the best matching page or timestamp. Exact identifiers and names need lexical matching; semantic similarity is not a confidence guarantee. Show why a result appeared, preview the matching material, and link to its original source.
- Define an evaluation set with real user queries: exact word, paraphrase, image-by-description, cross-format, partial memory, noisy OCR, multilingual and no-match cases. Measure recall and usefulness, time to first usable result, processing latency, cost, and false matches. Do not claim search quality before measuring it.

### 4. Ask, connect, and use

An assistant retrieves only a user's authorized saves, answers from retrieved excerpts and returns clickable citations. Treat retrieved webpages and documents as untrusted data, never as instructions to the system. For connections, store an evidence-backed rationale and distinguish explicit user links, machine suggestions, and claims supported by sources. AI suggestions must be reviewable and dismissible; avoid background edits to collections without approval. A future MCP endpoint can expose scoped, revocable, read-only search and retrieval first; require a separate authorization and review flow for mutations.

### 5. Hosted privacy and reliability

Pond and DigUp's on-device processing avoids uploading the indexed corpus to their servers. A hosted version creates different responsibilities: clear consent and source-specific permissions, private object storage, encryption in transit and at rest, tenant isolation in every retrieval query, limited retention, export, account deletion, and an honest description of model vendors and subprocessors. Do not assume embeddings are anonymous. Avoid logging content, tokens, private URLs, or session credentials. Check whether the user can delete provider-side data and how long derived artifacts remain.

Treat URLs and files as hostile: prevent server-side requests to private addresses and metadata services, validate redirects and DNS resolution, limit bytes and processing time, sandbox parsers, and cap media duration and decompression. Document provider outages, extraction denials, failed jobs and backup/recovery. Respect platform rules and copyright; store only content for which the service has a lawful basis and clearly explain availability. These are engineering requirements for a hosted service, not claims that any reference has identical risks.

## Open questions and next experiments

1. Which first user and recurring task: a designer finding a past reference, or a researcher building a board? Observe several real workflows before treating the choice as validated.
2. Prototype a URL/image save → search → open source → place on board. Measure whether a person finds a known item and makes a useful connection without help.
3. Compare text-only, image-plus-text and segment-level retrieval on a small consented corpus; record indexing cost, latency and quality. Test a cloud-hosted model before committing to one vendor or GPU architecture.
4. Prototype capture feedback and failure recovery, including duplicate, inaccessible URL, processing delay and removal. Investigate extension capture only after the web flow is useful.
5. Test a restrained Surface Field prototype behind real content, including reduced motion and keyboard navigation. Determine whether it helps orientation over extended use.
6. Review source and dependency licenses before reusing code, maintain copyright notices as required, and verify third-party platform permissions separately. Pond, DigUp and Surface Field are MIT at the inspected snapshots; that does not grant rights to saved third-party content or every bundled model/dependency.
