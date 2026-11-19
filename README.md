# Project workbook

Working documents for shaping this project and taking it from an idea to a useful product. The product, audience, and technical approach are still open.

Start with the first three documents. Write rough answers, leave blanks when needed, and revisit them as you learn. You do not need to complete every worksheet before experimenting or building.

| Order | Document | What to work out |
| --- | --- | --- |
| 1 | [Mission](docs/01-mission.md) | Why this should exist and what success means |
| 2 | [Users and research](docs/02-users-and-research.md) | Who needs it, what they do today, and what evidence we have |
| 3 | [Positioning and business](docs/03-positioning-and-business.md) | Why people would choose it and how it can sustain itself |
| 4 | [Product and features](docs/04-product-and-features.md) | The core experience and smallest useful release |
| 5 | [Design](docs/05-design.md) | User journeys, interaction principles, and visual direction |
| 6 | [Engineering](docs/06-engineering.md) | Architecture, data, security, and implementation constraints |
| 7 | [Roadmap and launch](docs/07-roadmap-and-launch.md) | What happens next and how we know it works |
| Ongoing | [Decisions and questions](docs/08-decisions-and-questions.md) | Decisions, assumptions, risks, and unresolved questions |

## How to use these documents

- Replace `[Fill in]` with your answer. `Unknown` is a useful answer too.
- Label untested beliefs as **assumptions** and link evidence when available.
- Keep each topic in its own document; link to it elsewhere instead of copying it.
- Record consequential decisions in the decision log, including why they were made.
- When direction changes, update the affected documents and preserve the decision history.

## Run it locally

You need Node 22+ and pnpm.

1. Install: `pnpm install` and `pnpm --dir extension install --ignore-workspace`.
2. Copy `.env.example` to `.env.local` and fill Supabase + `ATELIER_OWNER_EMAIL` (see that file). Auth is a Supabase JWT for the owner email.
3. Start the backend: `pnpm dev` (http://localhost:3000). For the Workers-shaped local stack: `pnpm run dev:vinext` (port 3001).
4. Build the extension: `pnpm --dir extension build`.
5. In Chrome, open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and pick `extension/.output/chrome-mv3`.
6. Click the Atelier icon, enter the server URL (`http://localhost:3000`) and sign in with the owner email/password.

### Deploy API to Cloudflare Workers

See [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md): vinext + `pnpm run deploy`, secrets via `cf`/`wrangler` (never commit values).

### Saving

- **Page:** click the toolbar icon, or press Alt+Shift+S.
- **Image:** right-click an image, then choose **Save image to Atelier**.
- **Screenshot of a region:** press Alt+Shift+R and drag.
- **Site saves:** saving or bookmarking on Pinterest, Are.na, X or Instagram also saves the item to Atelier. You can turn each site off in the popup.

A toast shows what really happened: **Sending**, then **Saved** (stored, still processing), then **Ready**. If a save fails, it shows the reason and, when a retry can help, a **Retry** button.

### Checks

- `pnpm exec tsx scripts/verify-backend.ts`: the original backend checks.
- `pnpm exec tsx scripts/verify-projects.ts`: projects, placement and idempotency.
- `pnpm exec tsx scripts/verify-extension.ts`: a real Chrome run of the extension against a real server.

The goal and check lists are in [docs/goals/](docs/goals/).

## Reference research

- [Reference study and hosted implementation](docs/09-reference-research.md) — video observations, thread feedback, source-code findings, and a proposed backend architecture.
- The current concept and design direction are recorded in the mission, product, design, and engineering worksheets. These are working hypotheses, not validated requirements.

### Search by meaning with Jev

Keyword search works without configuration. To enable the Jev demo, add
`TYPESAFE_API_KEY=your-key` to `.env.local` and restart the server. Optionally set
`TYPESAFE_MODEL` (default `jev-latest`). Each search sends its query and up to
24 tenant-filtered saved text snippets to TypeSafe for relevance scoring; local
PNG, JPEG, WebP and GIF uploads up to 25 MB are resized and padded to fit Jev’s image limits, then sent as JPEG when available. Images use TypeSafe's
experimental image API. Requests run at most four at a time with a ten-second
shared deadline; failed or unscored items retain keyword search. Jev is a bounded
reranker: it considers keyword matches among the newest 200 indexed saves first,
then fills remaining places with recent saves, so meaning search does not cover
the entire library. Public web preview images are fetched safely when available (up to 5 MB); inaccessible previews fall back to text. Audio, video, PDFs, other image formats and larger images are not visually analyzed. Search results report
semantic mode only when at least one candidate was scored successfully; health
reports the most recent in-process scoring outcome and starts false after restart.
The model and threshold have not been evaluated on this library.

Run `pnpm exec tsx scripts/verify-jev.ts` for mocked provider, image, tenant,
failure and timeout checks. This test sends no requests to TypeSafe.

With a key, each image is also tagged once when it is saved: one Jev request asks a fixed
list of yes/no questions (colors, format such as poster or magazine cover, big lettering,
subject) and the tags plus synonyms are indexed, so a description like "cream magazine cover
with huge red lettering" finds an image whose title is only a file name. Saves made before
tagging existed are tagged in the background on server start. The vocabulary lives in
`lib/search/tags.ts`; `scripts/verify-tags.ts` checks it without calling TypeSafe.
