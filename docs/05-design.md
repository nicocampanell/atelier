# Design

Status: Working visual direction recorded; details and usability remain unvalidated.

## Working direction from the references

An airy creative workspace with restrained chrome, a warm near-white canvas, dark readable text, and the saved material providing the color. Large whitespace, small labels, subtle borders and soft shadows create hierarchy without competing with imagery. Use a consistent readable sans serif; exact font, colors, radii, and type scale remain design decisions rather than measurements from the videos. Reference cards should preserve aspect ratio and legibility, with source, title, and type discoverable without overwhelming the image.

The library is a compact left navigation plus a visual, varied-height grid, with search and filters prominent. Opening a result reveals a larger preview, source and metadata; the user can return to the library without losing context. The board is a spacious, zoomable surface with images, notes, documents, and labeled relationships. Cards and connections should be the content; background motion stays quiet.

**Capture:** follow Noe's immediate save, transient confirmation, Undo, and optional collection picker. Confirm durable acceptance separately from background processing. Support keyboard and touch alternatives to hover or drag. **Search to board:** Lorenzo's overlay suggests showing recent items and results as tangible previews that can be placed on the board; offer an explicit Add to board button alongside dragging. **Connections:** a line needs an editable explanation, provenance, and distinction between a user-created link and an AI suggestion. A reply to David's post explicitly asks how to question the lines; the creator says the lines can carry notes.

**Surface Field:** requested as a possible canvas background. Its dots and lines clear around cards and respond to pointer and object movement. Use a low-intensity setting, preserve contrast and focus, and honor reduced motion. The component is decorative and requires the host to provide geometry; it is not the graph or the interaction layer. See [the repository](https://github.com/angelolibero/surface-field) and [reference study](09-reference-research.md).

## Local video reference index

The timestamps are approximate observations from sampled frames. The original creators retain rights to their material. Local research copies can be opened from `references/videos/` when present. The [reference study](09-reference-research.md) links to the original sources.

### [Knowledge board — David Pukha](../references/videos/knowledge-board.mp4) · 18 seconds

Original: [X post](https://x.com/davidpukhaa/status/2118364022646902816). Around 0:02, a wide off-white canvas shows loose clusters of cards connected by hairline curves. Images, document covers, text labels and stacked previews vary in size, which makes the board feel like working material rather than a uniform dashboard. Around 0:05–0:11, the view moves between clusters and closer material; a small floating tool strip sits low on the surface while the content remains central. Around 0:14–0:17, a short note and reference stack are joined by a line.

**Apply:** allow the user to place an item and a personal note on a spacious board, zoom between overview and detail, and attach a reason to a connection. Differentiate user-created and suggested connections; preserve source context. Explore soft shadows, fine lines and restrained tools, without assuming exact colors or font from the compressed recording.

### [Reference saving — Noe](../references/videos/reference-saving.mp4) · 6 seconds

Original: [X post](https://x.com/noechague/status/2116243745821937803). A rounded bookmark control sits over a visual card in a dense image feed. Around 0:01–0:02, clicking it produces a compact bottom confirmation: saved to an unsorted destination, with Undo and an optional add action. Around 0:03–0:05, the add action opens a lightweight collection list over the page; selection is confirmed without leaving the browsing context.

**Apply:** save immediately and keep the user's place. A small confirmation should communicate the actual persisted state, offer Undo and optional organization, and disappear without forcing a modal. The collection picker needs a keyboard path and an accessible label; capture notes should be quick and optional, while remaining easy to add or edit later.

### [Pond website demo](../references/videos/pond-website.mp4) · 64 seconds

User-provided website video; product source: [Pond](https://github.com/raphaelsalaja/pond). At approximately 0:00–0:12, floating imagery introduces a visual library assembled from multiple sources. Around 0:14–0:25, the demo moves from an X save into the library and emphasizes local file ownership. Around 0:30–0:42, it shows search and filters, including color, visual match, semantics, tags and folders. Around 0:42–0:50, an assistant answer refers to saved items; the final section shows a compact mosaic of additional capabilities.

**Apply:** give saved media the visual priority, but retain enough source/title information to make each card understandable. Contrast a dense browsing grid with a focused detail/reader view. In an assistant response, keep references visible and clickable rather than producing an unsupported answer. The video's local-file ownership is Pond's promise; our hosted product must explain its own storage and processing honestly.

### [Pond 2.0 / Fish](../references/videos/pond-2.mp4) · 46 seconds

Original: [X post](https://x.com/raphaelsalaja/status/2115483627916238970). Around 0:04–0:12, an ask interface narrows a scattered set of saves into a small relevant group. Around 0:12–0:20, proposed background organization is presented for review before applying. Around 0:20–0:30, the library uses a compact sidebar and a varied-height image grid; a detail preview places a large image beside structured metadata. The end demonstrates a readable article view inside the application.

**Apply:** keep AI proposals inspectable, show the specific items and changes, and preserve user-authored notes and tags. Support both scanning across the library and concentrating on one item. A thread reply asks for a change recap, which is a useful design test rather than proof that a recap solves trust.

### [DigUp search](../references/videos/digup.mp4) · 60 seconds

Original: [X post](https://x.com/googlegemma/status/2110044337849692644). Around 0:20–0:30, the search panel groups a video and image results; selecting the video displays a large preview and a matching timestamp. Around 0:30–0:40, a document result shows a page preview and highlights matching text. The dark, compact panel gives the result preview nearly as much importance as the result list.

**Apply:** return a preview of the *matching part*, with its page or timestamp and a route to the original. Pair semantic matching with exact words, and make loading, no-match and partial-index states clear. This is primarily a retrieval reference; the hosted implementation has different privacy and indexing constraints from DigUp.

### [Search overlay to canvas](../references/videos/search-to-canvas.mp4) · 23 seconds

Original: [X post](https://x.com/cabralorenzo/status/2099060380051943735). Around 0:03–0:07, a centered search overlay dims the canvas and shows recent searches, category chips and visual result tiles. Around 0:07–0:12, an item is placed on the board and alignment guides appear. Around 0:15–0:21, a contextual menu provides edit, duplicate, lock, copy and remove actions.

**Apply:** make results tangible and movable into a board without making drag the only route. Use a clearly named Add to board action, visible focus, placement feedback and reversible edits. Dimming creates focus but should not obscure the user's sense of where the item will go.

### [Surface Field](../references/videos/surface-field.mp4) · 97 seconds

Original: [X post](https://x.com/angeloldesigns/status/2103467857212231728), [source](https://github.com/angelolibero/surface-field). The field is a low-contrast grid of points and optional links around floating surfaces; its density and deformation change as the controls and objects move. At roughly 0:15–0:50 the demo adjusts spacing, brightness, line reach, cursor distortion and ripple. Later frames show presets, restrained ambient motion and a dark theme.

**Apply:** consider it as a quiet background for the board, with space cleared around cards; use semantic, user-controlled lines for actual relationships. Start with subtle movement, maintain contrast, and offer reduced or no motion. The component is decorative and the host must supply object geometry. Benchmark on realistic boards before adopting it.

## Experience goals

- **What should the experience feel like?** [Fill in]
- **What should be immediately understandable?** [Fill in]
- **What should the interface help people do most easily?** [Fill in]
- **What should it help prevent?** [Fill in]

## Core journey

| Step | User goal or action | Screen or surface | Information needed | Possible friction |
| --- | --- | --- | --- | --- |
| [Fill in] | [Fill in] | [Fill in] | [Fill in] | [Fill in] |

## Structure and navigation

- **Main screens or sections:** [Fill in]
- **Primary action on each:** [Fill in]
- **How users move between them:** [Fill in]
- **What a first-time user sees:** [Fill in]
- **What a returning user sees:** [Fill in]

## Visual direction

- **References and what specifically works about them:** [Fill in]
- **Typography:** [Fill in]
- **Color and contrast:** [Fill in]
- **Layout and spacing:** [Fill in]
- **Imagery, icons, and motion:** [Fill in]
- **Product voice and example copy:** [Fill in]

## Interaction and accessibility checklist

- [ ] Core tasks work with a keyboard and have visible focus.
- [ ] Controls have clear labels; meaning does not depend on color alone.
- [ ] Text and controls are readable, with adequate contrast and target sizes.
- [ ] Layout works on the intended screen sizes and with enlarged text.
- [ ] Empty, loading, success, error, and permission states are designed.
- [ ] Errors explain how to recover; destructive actions have appropriate safeguards.
- [ ] Motion respects reduced-motion preferences.

## Design validation

- **Prototype or mockup links:** [Fill in]
- **Task to ask someone to complete:** [Fill in]
- **What we observed:** [Fill in]
- **Changes to make:** [Fill in]

## Next action

- [ ] Sketch the core journey and test whether someone can follow it.
