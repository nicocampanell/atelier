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

You need Node 22+ and pnpm. Auth is a **Supabase JWT** for the single owner email (`ATELIER_OWNER_EMAIL`) — there is no shared `ATELIER_TOKEN`.

1. Install: `pnpm install` and `pnpm --dir extension install --ignore-workspace`.
2. Apply the Supabase schema ([supabase/README.md](supabase/README.md)), then create an Auth user whose email matches `ATELIER_OWNER_EMAIL`.
3. Copy `.env.example` → `.env.local` and fill `SUPABASE_*` + `ATELIER_OWNER_EMAIL`. For vinext/workerd locally, also copy `.dev.vars.example` → `.dev.vars`.
4. Start the API: `pnpm dev` (http://localhost:3000) or `pnpm run dev:vinext` (port 3001).
5. Canvas (separate worktree `infinite-canvas-frontend-4a2f39/web`): copy `web/.env.example` → `.env.local` (`VITE_SUPABASE_*`; leave `VITE_API_URL` unset so Vite proxies `/api`), then `npm run dev`.
6. Extension: copy `extension/.env.example` → `extension/.env.local` (`WXT_SUPABASE_*`), then `pnpm --dir extension build`.
7. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → `extension/.output/chrome-mv3`. Sign in with the owner email/password (Advanced → Server URL `http://localhost:3000` if needed).

### Hosted (Cloudflare + Supabase)

| Piece | Where | Notes |
| --- | --- | --- |
| Auth / DB / Storage | Supabase project | Migrations in `supabase/`; private bucket `atelier-assets` |
| API | Cloudflare Workers (`atelier-api`) | [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md) — `pnpm run deploy`, secrets via `cf`/`wrangler` |
| Canvas | Cloudflare Pages (`atelier-canvas`) | Canvas worktree `web/docs/deploy-pages.md` — set `VITE_SUPABASE_*` + `VITE_API_URL` at **build** time |
| Extension | Sideload unpacked build | Set `WXT_SUPABASE_*` and `WXT_API_URL` (Workers origin) before `pnpm --dir extension build` |

Worker secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ATELIER_OWNER_EMAIL`, optional `TYPESAFE_API_KEY` / `CRON_SECRET` / `ATELIER_ALLOWED_ORIGINS` (include the Pages origin). Optional later: `ATELIER_OWNER_USER_ID` (Auth uuid, checked alongside email).

**Owner signup lockdown** (do this before sharing any URL):

- Create the owner user in the Supabase Auth dashboard (email = `ATELIER_OWNER_EMAIL`).
- Disable public signup (Authentication → Providers / settings).
- Keep email confirmation enabled.
- Optional later: set `ATELIER_OWNER_USER_ID` to that user’s uuid for a second lock.

**Smoke checklist** (human; needs real Supabase + CF login):

1. Create owner user in Supabase Auth (email = `ATELIER_OWNER_EMAIL`).
2. Deploy Workers + Pages; open canvas Pages URL → sign in → create/open a board.
3. Sideload extension → sign in (same email/password) → save one page.
4. Item appears on the board; search finds it (tags need `TYPESAFE_API_KEY`).
5. A non-owner Auth user gets `401` on `/api/*`.

### Saving

- **Page:** click the toolbar icon, or press Alt+Shift+S.
- **Image:** right-click an image, then choose **Save image to Atelier**.
- **Screenshot of a region:** press Alt+Shift+R and drag.
- **Site saves:** saving or bookmarking on Pinterest, Are.na, X or Instagram also saves the item to Atelier. You can turn each site off in the popup.

A toast shows what really happened: **Sending**, then **Saved** (stored, still processing), then **Ready**. If a save fails, it shows the reason and, when a retry can help, a **Retry** button.

### Checks

JWT / Supabase hosting (current):

- `pnpm exec tsx scripts/verify-auth-supabase.ts`: owner JWT auth (no network).
- `pnpm exec tsx scripts/verify-db-supabase.ts`: live Supabase CRUD when env is set.

Legacy (not valid for JWT hosting until rewritten — still assume shared `ATELIER_TOKEN` / local PGlite):

- `pnpm exec tsx scripts/verify-backend.ts`
- `pnpm exec tsx scripts/verify-projects.ts`
- `pnpm exec tsx scripts/verify-extension.ts`

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
