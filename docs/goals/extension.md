# Goal: Atelier browser extension saving into projects, verified by a loop

Repo root: this worktree. Backend is the Next.js app at the root (see `docs/goals/backend.md`, all 15 checks pass at the start). The extension is a separate WXT package in `extension/` (already scaffolded: `pnpm --dir extension build|typecheck|test`, installs use `--ignore-workspace`).

Read first:
- `lib/types.ts` — HTTP contract, including the new **Projects**, `SaveCreated`, `projectId`, `sourceUrl`, `Idempotency-Key` and CORS sections. Do not change it; ask the orchestrator.
- `extension/lib/contracts.ts` — extension-internal contract and **file ownership**. Do not change it; ask the orchestrator.
- Pond reference (MIT) at commit `deb305effb47f7984e52fe8c6b486387b7dafc02`: `gh api repos/raphaelsalaja/pond/contents/<path>?ref=deb305effb47f7984e52fe8c6b486387b7dafc02 --jq .content | base64 -d`. Port ideas and code with a header comment `// Adapted from Pond (MIT) apps/extension/<path> @ deb305e`. Never port `session.ts` (cookie forwarding), native messaging, `fish`, or Safari code.

## Workers and ownership

| Worker | Owns | Must not touch |
| --- | --- | --- |
| A — backend projects | `lib/**` (except `lib/types.ts`), `app/api/**`, `scripts/verify-projects.ts` | `extension/**`, `lib/types.ts`, `docs/**` |
| B — extension core | `extension/**` except Worker C's paths and `extension/lib/contracts.ts`; `scripts/verify-extension.ts` | `lib/**`, `app/**`, C's paths |
| C — site hooks | `extension/sources/**`, `extension/entrypoints/hooks.content.ts`, `extension/entrypoints/hooks-main.content.ts`, `extension/utils/bridge.ts`, tests beside them | everything else, incl. `extension/package.json` (ask the orchestrator for deps) |

Nobody commits, pushes, or runs `git stash`. Never print tokens or file contents.

## Checks — Worker A (`pnpm exec tsx scripts/verify-projects.ts`, starts its own server like `verify-backend.ts`)

| # | Check | Pass condition |
| --- | --- | --- |
| P1 | `pnpm typecheck` | exits 0 |
| P2 | `GET /api/projects` on a fresh data dir | returns exactly one default project with the `Project` shape |
| P3 | Create, rename, delete | names trimmed, empty / >120 chars → 400; delete of last project → 409 `last_project`; delete removes its board items but not saves |
| P4 | Project boards | `PUT/GET /api/projects/:id/board` round-trip exactly; two projects are independent; `/api/board` is the default project's board |
| P5 | Save with `projectId` (JSON) | `placedIn` set; item exists on that board with the save's id, does not overlap existing items, sits to the right of existing content; project `updatedAt` and `itemCount` change |
| P6 | Unknown / foreign `projectId` | 404 `project_not_found`; no save created |
| P7 | Multipart with `sourceUrl` + `projectId` | Save `kind: image`, `sourceUrl` stored, placed; private `sourceUrl` refused 400 |
| P8 | `Idempotency-Key` | repeat POST → status 200, same save id, still one save in the list; different key → new save |
| P9 | Migration | a data dir created with the **old** schema (one `board` row, `user_id unique`, items) opens fine; old items appear in the default project; `verify-backend.ts` data stays readable |
| P10 | Ownership | a second user id cannot list, read, rename, delete, place into, or read the board of the owner's projects (direct DB phase like backend check 14) |
| P11 | CORS | `OPTIONS` from an origin in `ATELIER_ALLOWED_ORIGINS` gets allow headers incl. `Authorization`; other origins get none |
| P12 | Regression | `pnpm exec tsx scripts/verify-backend.ts` still 15/15 |

## Checks — Worker B (`pnpm exec tsx scripts/verify-extension.ts`, from the repo root)

| # | Check | Pass condition |
| --- | --- | --- |
| E1 | Build | `pnpm --dir extension typecheck` and `build` exit 0; manifest is MV3; no `cookies`, `nativeMessaging`, `<all_urls>` host permission, or remote code; custom server origins use `optional_host_permissions` requested at sign-in |
| E2 | Unit tests (`pnpm --dir extension test`) | capture state machine: sending → saved → ready; duplicate; network / 5xx → failed `retry: true`; 4xx → failed `retry: false` with the server's message; signed-out sends nothing; same `dedupeKey` within 10 s dropped; `Idempotency-Key` header sent and identical on retry; hook capture dropped when `settings.hooks[source]` is false |
| E3 | E2E: page save | Playwright Chromium (`~/Library/Caches/ms-playwright/chromium-1200` exists) loads the built extension against a real server (`ATELIER_TOKEN=testtoken`, own data dir). With a project selected, triggering the page capture saves `https://example.com/` → save exists in that project's board via the API; overlay toast shows sending → saved → ready (or a truthful failure) and names the project |
| E4 | E2E: image | image capture of a public https image uploads bytes (multipart, `sourceUrl` = image URL); Save `kind: image`; asset bytes match the image |
| E5 | E2E: region screenshot | region capture uploads a PNG whose pixel size equals rect × dpr; placed in the project |
| E6 | E2E: popup | wrong token → visible error, nothing stored; right token → project list from the API; creating a project from the popup works and becomes selected; choice survives a popup reopen |
| E7 | E2E: failure + recovery | server stopped → toast shows failure with Retry; server restarted → Retry succeeds and only one save exists (idempotency) |
| E8 | Token hygiene | token only in `browser.storage.local` read by the background; never in messages to content scripts, never in console output (assert on captured console logs), never in URLs except `/api/assets/:id?token=` which the extension does not use |

E3–E7 may be SKIPPED only for a real reason (for example no network for example.com); say which.

## Checks — Worker C (`pnpm --dir extension test -- sources`)

| # | Check | Pass condition |
| --- | --- | --- |
| H1 | Pinterest, Are.na, X, Instagram hooks | for each site, a recorded fixture of the site's own save/bookmark request (fetch and XHR where the site uses it) produces exactly one `HookEvent` with the right `CaptureRequest` (best image URL / page URL, title when available) and a stable `dedupeKey`; unrelated requests produce none; the page's own request still goes through unchanged |
| H2 | Bridge | rejects wrong `channel`, unknown `source`, non-http(s) URLs, events whose `source !== window`, and payloads over 32 KB; valid events become one `CaptureMessage` with `origin: {type:"hook", source}` |
| H3 | Manifest | hook content scripts match only the four sites; main-world script runs at `document_start`; built output contains them |
| H4 | E2E (orchestrator runs after B is done) | Playwright routes a fake `https://www.pinterest.com/pin/1/` fixture page that fires the save request → a save appears in the selected project |

## Loop protocol (orchestrator)

1. Workers A, B, C run in parallel on disjoint files. Each builds its verify script early, then makes it green, and reports the final script output verbatim.
2. Orchestrator re-runs every script itself. Any FAIL → the failing check, its output and the suspected files go back to the owning worker, who fixes only that. Re-run all.
3. Up to 6 rounds. Stop and report what still fails and why.
4. Honest reporting: paste real output; never claim a pass that was not run.
