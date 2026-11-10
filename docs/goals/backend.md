# Goal: working Atelier backend, verified by a loop

Repo root: this worktree. Read first: `lib/types.ts` (the API contract; do not change it, ask the orchestrator), `.env.example`, `next.config.ts`, `docs/06-engineering.md`, and the approved plan at `/Users/nicocampanell/.claude/plans/this-task-out-with-woolly-corbato.md`.

## Done means every check below passes, shown with real command output

Start the server with `pnpm dev` (port 3000, `ATELIER_TOKEN=testtoken`, `ATELIER_DATA_DIR=./.data-test`, no `EMBEDDING_API_KEY`).

| # | Check | Pass condition |
| --- | --- | --- |
| 1 | `pnpm typecheck` | exits 0 |
| 2 | `GET /api/health` without a token | 200, `semantic: false` |
| 3 | Any other route without or with a wrong token | 401 |
| 4 | `POST /api/saves` JSON with a public https URL | returns a Save with status `accepted`; polling `GET /api/saves/:id` reaches `ready` (title filled from the page) or `failed` with a readable error. Never stuck. |
| 5 | Same URL saved twice | second Save has `duplicateOf` set |
| 6 | `POST /api/saves` with `http://127.0.0.1`, `http://localhost`, `http://169.254.169.254`, `http://[::1]`, `file:///etc/passwd` | refused with a clear error (and a redirect to a private address is also refused) |
| 7 | Multipart upload of a small PNG | Save kind `image`, `GET /api/assets/:id` returns the same bytes with the right content type; a `.exe`-style or oversized file is refused |
| 8 | `GET /api/saves` | newest first, pagination works, deleted saves disappear |
| 9 | `DELETE /api/saves/:id`, then `GET` | gone, and gone from search and from the board's item list |
| 10 | `POST /api/saves/:id/retry` on a failed save | status goes back through processing |
| 11 | `GET /api/search?q=` | keyword hits found by title or words in the page text; an unrelated query returns no hits; response matches `SearchResponse` |
| 12 | `PUT /api/board` then `GET /api/board` | round-trips exactly; items pointing to deleted saves are dropped |
| 13 | Restart the server | saves, assets and board are still there |
| 14 | Ownership | every query filters by `user_id`; a second user id (inserted directly in the database) cannot read the first user's saves, assets or board |
| 15 | Search internals (unit-level, run with a script) | chunker gives about 1800-character chunks with 200 overlap; z-score gate returns nothing for random vectors; hybrid ranker puts an exact-word hit above a weak meaning hit; with a fake `embed()` the vector path is used and results include `location` |

## Loop protocol (the orchestrator runs this)

1. Write `scripts/verify-backend.sh` (or `.ts`) that runs checks 1–15 and prints PASS or FAIL per check. Build it early, before the code is finished.
2. Run it. If anything fails, send the failing check, its output and the suspected file to a Sonnet worker, who fixes only that. Re-run the whole script.
3. Repeat until all checks pass in the same run. Stop after 8 rounds and report what still fails and why.
4. A check may be marked SKIPPED only if it truly needs something unavailable (for example no network for check 4). Say which and why.
5. Report honestly: paste the final script output. Do not claim a pass that was not run.

## Constraints

- Do not commit, push or run `git stash`. Do not touch `docs/` except this file, or `app/page.tsx` and `components/` (a separate front-end worker owns those).
- Search embeddings go behind one `embed()` function in `lib/search/embed.ts`. With no key it returns null and search is keyword-only. Verify the provider and model name against current docs before writing the real call; if you can't verify, leave the real call as a clearly marked TODO and test with a fake.
- Never log tokens or file contents. Secrets only from env.
- DigUp (MIT) is a reference for ideas; re-write in TypeScript, don't paste Swift. Notes: chunks about 1800 chars with 200 overlap; z-score per query per modality; gate at z ≥ 2; score = meaning + 2.0 × coverage^1.5 (0.5 and 4.0 for ID-like queries); results under half the top score are "weaker".
