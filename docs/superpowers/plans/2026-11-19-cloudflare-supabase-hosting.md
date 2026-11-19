# Cloudflare Workers + Supabase Hosting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Host Atelier for a single owner on Cloudflare (Next API on Workers + Vite canvas on Pages) with Supabase Auth/Postgres/Storage and an email/password extension login, starting from an empty library.

**Architecture:** Keep the existing `/api/*` contract. Replace `ATELIER_TOKEN` + PGlite + local `fs` with Supabase JWT auth, Postgres, and private Storage. Run the Next API on Cloudflare Workers via vinext (OpenNext only if vinext fails). Canvas and extension send `Authorization: Bearer <access_token>`.

**Tech Stack:** Next.js (backend worktree), vinext → Cloudflare Workers, Vite → Cloudflare Pages, Supabase (Auth + Postgres + Storage), WXT Chrome MV3 extension, TypeSafe Jev (optional).

**Spec:** [`docs/superpowers/specs/2026-11-19-cloudflare-supabase-hosting-design.md`](../specs/2026-11-19-cloudflare-supabase-hosting-design.md)

## Global Constraints

- Single user only; API must reject any JWT whose email ≠ `ATELIER_OWNER_EMAIL`
- Fresh hosted library — no PGlite data migration
- Preserve existing HTTP API shapes in `lib/types.ts`
- Never commit secrets (`.env.local`, service role key, passwords)
- vinext first for Next-on-Workers; OpenNext only after a documented vinext blocker
- Extension stays sideloaded (no Chrome Web Store)
- Image prep: send within Jev limits first; no Node `sharp` on the hosted path
- Jobs v1: `waitUntil(processSave)`; cron requeue if needed; Queues only if waitUntil drops work
- Worktrees: backend/extension = `.claude/worktrees/orchestration-browser-extension-f8ab55`; canvas = `.claude/worktrees/infinite-canvas-frontend-4a2f39`

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `supabase/migrations/20261119_init.sql` | Schema + RLS + storage policies (new, in backend worktree) |
| `lib/supabase.ts` | Server Supabase clients (anon/user JWT + service role) |
| `lib/auth.ts` | JWT verify + owner allowlist (replaces shared token) |
| `lib/db.ts` | Thin query helpers over Supabase Postgres (replaces PGlite) |
| `lib/assets.ts` | Storage upload/download + signed URLs (replaces `fs`) |
| `lib/jobs.ts` | `processSave` + `waitUntil` scheduling + stuck requeue |
| `lib/search/image.ts` | Workers-safe image load (no `sharp`) |
| `scripts/verify-auth-supabase.ts` | Auth allowlist + unauthorized checks |
| `extension/lib/contracts.ts` | Settings shape: tokens instead of shared secret |
| `extension/utils/settings.ts` / `signin.ts` / popup UI | Email+password session |
| `web/src/api/client.ts` + sign-in UI | Canvas JWT session + API base URL |
| `wrangler.toml` / vinext config | Workers deploy |
| Canvas Pages env | `VITE_API_TARGET` / public API URL |

---

### Task 1: Supabase schema + RLS migration

**Files:**
- Create: `.claude/worktrees/orchestration-browser-extension-f8ab55/supabase/migrations/20261119_init.sql`
- Create: `.claude/worktrees/orchestration-browser-extension-f8ab55/supabase/README.md` (apply steps only)
- Test: apply migration in a fresh Supabase project (SQL editor or `supabase db push`)

**Interfaces:**
- Produces: tables `save`, `asset`, `segment`, `board`, `board_item`, `idempotency`, `job` with `user_id uuid not null` referencing `auth.users`; private bucket `atelier-assets`; RLS `user_id = auth.uid()`

- [ ] **Step 1: Write migration SQL**

Port from current `lib/db.ts` SCHEMA + MIGRATE. Use `uuid` for `user_id` (Supabase auth). Keep text ids for save/board/item ids. Include `tags text[]` on `save`. Enable RLS on all tables. Example policy pattern:

```sql
alter table save enable row level security;
create policy save_owner on save
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

Repeat for `asset`, `segment`, `board`, `board_item`, `idempotency`, `job`.

Storage:

```sql
insert into storage.buckets (id, name, public) values ('atelier-assets', 'atelier-assets', false);
create policy asset_objects_owner on storage.objects
  for all using (
    bucket_id = 'atelier-assets' and auth.uid()::text = (storage.foldername(name))[1]
  ) with check (
    bucket_id = 'atelier-assets' and auth.uid()::text = (storage.foldername(name))[1]
  );
```

Object key convention: `{user_id}/{asset_id}`.

- [ ] **Step 2: Apply to a Supabase project**

Create project (dashboard). Run migration. Confirm tables + bucket exist.

- [ ] **Step 3: Commit**

```bash
cd .claude/worktrees/orchestration-browser-extension-f8ab55
git add supabase/
git commit -m "Add Supabase schema and RLS for hosted Atelier."
```

---

### Task 2: Supabase clients + JWT auth (replace ATELIER_TOKEN)

**Files:**
- Create: `lib/supabase.ts`
- Modify: `lib/auth.ts`
- Modify: `.env.example`
- Create: `scripts/verify-auth-supabase.ts`
- Modify: any route still documenting `ATELIER_TOKEN` in comments only after tests pass

**Interfaces:**
- Consumes: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ATELIER_OWNER_EMAIL`
- Produces:
  - `getUserClient(jwt: string): SupabaseClient`
  - `getServiceClient(): SupabaseClient`
  - `authenticate(req: Request): Promise<string | null>` → auth user uuid
  - `requireUser(req: Request): Promise<string | Response>`

- [ ] **Step 1: Write failing verify script**

```ts
// scripts/verify-auth-supabase.ts
import assert from "node:assert/strict";
import { authenticate, requireUser } from "../lib/auth";

async function main() {
  process.env.ATELIER_OWNER_EMAIL = "owner@example.com";
  // Without Authorization → null / 401
  assert.equal(await authenticate(new Request("http://x")), null);
  const denied = await requireUser(new Request("http://x"));
  assert.ok(denied instanceof Response && denied.status === 401);

  // Mock: set a test double if auth uses injectable verify in unit mode.
  // Full path: signInWithPassword against real Supabase in manual smoke (Task 9).
  console.log("verify-auth-supabase: ok");
}
main();
```

- [ ] **Step 2: Run — expect fail (old auth still sync / wrong shape)**

Run: `pnpm exec tsx scripts/verify-auth-supabase.ts`  
Expected: FAIL (authenticate not async / still token-based)

- [ ] **Step 3: Implement `lib/supabase.ts` + rewrite `lib/auth.ts`**

```ts
// lib/supabase.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function getServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export function getUserClient(jwt: string): SupabaseClient {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_ANON_KEY!;
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
}

export function bearerFrom(req: Request): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization")?.trim() ?? "");
  return m ? m[1].trim() : null;
}
```

```ts
// lib/auth.ts — hosted path
import { fail } from "./http";
import { bearerFrom, getServiceClient } from "./supabase";

export async function authenticate(req: Request): Promise<string | null> {
  const jwt = bearerFrom(req);
  if (!jwt) return null;
  const { data, error } = await getServiceClient().auth.getUser(jwt);
  if (error || !data.user?.id || !data.user.email) return null;
  const owner = process.env.ATELIER_OWNER_EMAIL?.trim().toLowerCase();
  if (!owner || data.user.email.toLowerCase() !== owner) return null;
  return data.user.id;
}

export async function requireUser(req: Request): Promise<string | Response> {
  const userId = await authenticate(req);
  if (userId) return userId;
  return fail(401, "unauthorized", "Missing or invalid access token.", {
    "WWW-Authenticate": "Bearer",
  });
}
```

Update every route that calls `requireUser` to `await requireUser(req)`. Remove `allowQueryToken` / `?token=` for hosted. Remove `OWNER_USER_ID = "owner"` hardcode; user id is the Supabase uuid.

Update `.env.example`:

```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ATELIER_OWNER_EMAIL=you@example.com
# Optional local fallback only during transition — remove once PGlite path is deleted:
# ATELIER_TOKEN=
TYPESAFE_API_KEY=
```

- [ ] **Step 4: Fix compile — all `requireUser` call sites async**

Grep `requireUser` / `authenticate` under `app/` and `lib/`; await them. Run `pnpm exec tsc --noEmit` (or project check). Expected: typecheck clean for auth changes.

- [ ] **Step 5: Run verify script**

Run: `pnpm exec tsx scripts/verify-auth-supabase.ts`  
Expected: `verify-auth-supabase: ok`

- [ ] **Step 6: Commit**

```bash
git add lib/supabase.ts lib/auth.ts .env.example scripts/verify-auth-supabase.ts app/
git commit -m "Replace shared ATELIER_TOKEN with Supabase JWT owner auth."
```

---

### Task 3: Postgres via Supabase (replace PGlite)

**Files:**
- Modify: `lib/db.ts` (replace PGlite with query helpers using `getUserClient` / service client)
- Modify: `lib/saves.ts`, `lib/board.ts`, `lib/projects.ts`, `lib/search/index.ts`, and any `db.query` call sites
- Test: `scripts/verify-projects.ts` adapted to require Supabase env (or a new `scripts/verify-db-supabase.ts` for CRUD smoke)

**Interfaces:**
- Consumes: authenticated `userId` uuid string; Supabase clients
- Produces: same high-level functions (`getSave`, `listSaves`, `createUrlSave`, project/board helpers) with identical external return types from `lib/types.ts`

- [ ] **Step 1: Inventory PGlite SQL usage**

Grep `getDb(` / `.query(` / `.exec(` in `lib/`. List each call site. Prefer rewriting helpers to Supabase `.from(...).select/insert/update` rather than raw SQL unless FTS needs RPC.

- [ ] **Step 2: Add FTS RPC if needed**

If GIN `tsvector` search cannot be expressed in the JS client cleanly, add migration:

```sql
create or replace function search_segments(uid uuid, q text, lim int)
returns setof segment
language sql
stable
as $$
  select * from segment
  where user_id = uid and tsv @@ plainto_tsquery('english', q)
  order by ts_rank(tsv, plainto_tsquery('english', q)) desc
  limit lim;
$$;
```

- [ ] **Step 3: Implement `lib/db.ts` without PGlite**

Remove `PGlite`, `mkdir`, disk paths. Export helpers that take `(client, userId)` or resolve client from JWT in the route layer. Do not keep a dual PGlite/Supabase switch long-term — hosted path only once Task 3 lands (local also uses Supabase).

- [ ] **Step 4: Run a minimal CRUD smoke**

With real env vars: create project → create note save → list saves → delete. Expected: rows visible in Supabase table editor under your `auth.users` id.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts lib/saves.ts lib/board.ts lib/projects.ts lib/search/ supabase/
git commit -m "Drive Atelier data layer from Supabase Postgres instead of PGlite."
```

---

### Task 4: Private Storage for assets

**Files:**
- Modify: `lib/assets.ts`
- Modify: `app/api/assets/**` (signed URL or streaming)
- Modify: save upload paths that call `storeAssetBytes` / `readAsset`
- Test: upload PNG via API → object appears under `{uid}/{assetId}` → GET returns bytes or redirect to signed URL

**Interfaces:**
- Consumes: `storeAssetBytes(userId, bytes): Promise<string>` (returns storage key)
- Produces: `readAsset` / `signedAssetUrl(userId, assetId, expiresSec=120): Promise<string>`

- [ ] **Step 1: Rewrite store/read**

```ts
// lib/assets.ts (hosted)
export async function storeAssetBytes(userId: string, bytes: Uint8Array): Promise<string> {
  const id = crypto.randomUUID();
  const key = `${userId}/${id}`;
  const client = getServiceClient();
  const { error } = await client.storage.from("atelier-assets").upload(key, bytes, {
    contentType: sniffUpload(bytes)?.mediaType ?? "application/octet-stream",
    upsert: false,
  });
  if (error) throw error;
  // persist asset row elsewhere as today, storage_path = key
  return key;
}

export async function signedAssetUrl(userId: string, key: string, expiresSec = 120): Promise<string | null> {
  if (!key.startsWith(`${userId}/`)) return null;
  const { data, error } = await getServiceClient()
    .storage.from("atelier-assets")
    .createSignedUrl(key, expiresSec);
  if (error) return null;
  return data.signedUrl;
}
```

Remove `fs` / `unlink` local cleanup; delete Storage object on soft-delete when existing code unlinked files.

- [ ] **Step 2: Assets route returns signed URL or proxies with Bearer only**

No `?token=` query auth.

- [ ] **Step 3: Manual upload test**

Upload image save authenticated → confirm Storage object + `asset` row → preview loads.

- [ ] **Step 4: Commit**

```bash
git add lib/assets.ts lib/saves.ts app/api/assets/
git commit -m "Store save binaries in private Supabase Storage."
```

---

### Task 5: Jobs with waitUntil + Workers-safe image prep

**Files:**
- Modify: `lib/jobs.ts`
- Modify: `lib/search/image.ts` (remove `sharp`)
- Modify: save route handlers to schedule work after response
- Create: `app/api/cron/requeue/route.ts` (optional, protected by `CRON_SECRET`)

**Interfaces:**
- Consumes: `processSave(userId, saveId): Promise<void>`
- Produces: `scheduleProcessSave(ctx: { waitUntil(p: Promise<unknown>): void }, userId, saveId): void`

- [ ] **Step 1: Replace enqueue global queue**

```ts
export function scheduleProcessSave(
  waitUntil: ((p: Promise<unknown>) => void) | undefined,
  userId: string,
  saveId: string,
): void {
  const p = processSave(userId, saveId).catch(() => {});
  if (waitUntil) waitUntil(p);
  else void p; // local next dev
}
```

Wire from route: obtain `waitUntil` from Cloudflare/vinext request context when available.

- [ ] **Step 2: Remove sharp from `lib/search/image.ts`**

Load bytes from Storage; if over Jev limits, skip visual tagging and leave `tags` null (or text-only). Do not add WASM resize unless a real Jev rejection forces it (per spec).

- [ ] **Step 3: Add cron requeue route**

```ts
// app/api/cron/requeue/route.ts
export async function POST(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("unauthorized", { status: 401 });
  }
  await requeueStuck();
  return Response.json({ ok: true });
}
```

Document `CRON_SECRET` in `.env.example`. Schedule via Cloudflare Cron Trigger later in Task 6.

- [ ] **Step 4: Test**

Create URL save → status becomes `ready` (or `failed` with reason) without relying on process-global queue. Restart should not lose in-flight contract: stuck rows requeued by cron or startup call.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs.ts lib/search/image.ts app/api/cron/ .env.example
git commit -m "Run save processing via waitUntil without Node sharp."
```

---

### Task 6: Next.js on Cloudflare Workers (vinext)

**Files:**
- Create/modify: vinext / Wrangler config in backend worktree (follow current vinext Cloudflare docs)
- Modify: `package.json` scripts (`deploy`, `preview`)
- Test: `curl https://<worker>/api/health` with Bearer JWT

**Interfaces:**
- Produces: deployed Workers URL `https://<name>.<subdomain>.workers.dev` serving existing `/api/*`

- [ ] **Step 1: Install vinext Cloudflare skills/docs and run compatibility check**

```bash
npx skills add cloudflare/vinext
# follow migrate-to-vinext for this Next app; target Cloudflare Workers
```

If vinext blocks a required feature, document the blocker in `docs/superpowers/specs/` addendum and switch to OpenNext — do not silent-fallback.

- [ ] **Step 2: Configure secrets**

```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put ATELIER_OWNER_EMAIL
# optional:
wrangler secret put TYPESAFE_API_KEY
wrangler secret put CRON_SECRET
```

- [ ] **Step 3: Deploy**

```bash
pnpm deploy   # or vinext/wrangler script from package.json
curl -sS "$WORKER_URL/api/health"
```

Expected: health JSON; authenticated routes 401 without Bearer, 200 with owner JWT.

- [ ] **Step 4: Commit deploy config (no secrets)**

```bash
git add wrangler.toml package.json /* vinext config files */
git commit -m "Add Cloudflare Workers deploy path for the Next API."
```

---

### Task 7: Canvas on Pages + email/password session

**Files (canvas worktree `infinite-canvas-frontend-4a2f39/web`):**
- Modify: `src/api/client.ts` — token = Supabase access_token; support absolute API base
- Create: `src/auth/AuthGate.tsx` (or equivalent) — email/password form via `@supabase/supabase-js`
- Modify: `vite.config.ts` — production builds use `import.meta.env.VITE_API_URL`
- Create: Pages project config / `wrangler pages` or CF dashboard hook
- Test: sign in → list projects against Workers API

**Interfaces:**
- Consumes: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`
- Produces: `readToken()` returns current access_token; refresh via Supabase session

- [ ] **Step 1: Add Supabase client + AuthGate**

Sign-in form: email, password, submit → `signInWithPassword` → persist session → `writeToken(session.access_token)`. On 401, clear session and show sign-in.

- [ ] **Step 2: Point API client at Workers**

```ts
const API_BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";
// fetch(`${API_BASE}/api/projects`, { headers: { Authorization: `Bearer ${token}` } })
```

Dev may still proxy; production uses absolute `VITE_API_URL`.

- [ ] **Step 3: Deploy Pages**

```bash
cd web && npm run build
npx wrangler pages deploy dist --project-name atelier-canvas
```

- [ ] **Step 4: Commit**

```bash
git add web/src/api/client.ts web/src/auth/ web/vite.config.ts
git commit -m "Sign the canvas into Supabase and call the hosted API."
```

---

### Task 8: Extension email/password auth

**Files (backend worktree `extension/`):**
- Modify: `extension/lib/contracts.ts` — settings store `accessToken`, `refreshToken`, `email`; keep `serverUrl`, `projectId`, `hooks`
- Modify: `extension/utils/settings.ts`, `extension/utils/api.ts`
- Modify: `extension/entrypoints/popup/signin.ts` + popup UI
- Modify: `extension/wxt.config.ts` — host_permissions for production API origin
- Test: `pnpm --dir extension build`; sideload; sign in; save page to hosted API

**Interfaces:**
- Consumes: production default `DEFAULT_SERVER_URL = "https://<worker-host>"` (set after Task 6)
- Produces: `ExtensionSettings` with JWT pair; API client attaches Bearer access token; refresh on 401

- [ ] **Step 1: Update contracts**

```ts
export interface ExtensionSettings {
  serverUrl: string;
  accessToken: string | null;
  refreshToken: string | null;
  email: string | null;
  projectId: string | null;
  hooks: Record<SourceId, boolean>;
}
```

Migrate: if old `token` present, clear it (force re-login).

- [ ] **Step 2: Sign-in with password**

Popup fields: Server (advanced/defaulted), Email, Password. Call Supabase `signInWithPassword` from popup (anon key baked as build env `WXT_SUPABASE_URL` / `WXT_SUPABASE_ANON_KEY` — public anon key only). Store tokens. Request host permission for non-default server origins as today.

- [ ] **Step 3: API client uses accessToken; refresh helper**

On 401: `supabase.auth.refreshSession({ refresh_token })` → update storage → retry once.

- [ ] **Step 4: Build + sideload smoke**

```bash
pnpm --dir extension build
# Load extension/.output/chrome-mv3
```

Sign in as owner → save page → appears in Supabase `save` table and on canvas board.

- [ ] **Step 5: Commit**

```bash
git add extension/
git commit -m "Sign the extension in with Supabase email and password."
```

---

### Task 9: End-to-end smoke + docs

**Files:**
- Modify: backend `README.md` hosted section
- Modify: root/docs engineering notes if needed (`docs/06-engineering.md` choices table)
- Test: full smoke path from the spec

- [ ] **Step 1: Run smoke checklist**

1. Create owner user in Supabase Auth (email = `ATELIER_OWNER_EMAIL`)
2. Sign in on canvas → create/open board
3. Sign in on extension → save one page
4. Item appears on board; search finds it (tags if `TYPESAFE_API_KEY` set)
5. Non-owner account (if created) gets 401 on API

- [ ] **Step 2: Update README**

Replace local-only token instructions with: Supabase env, Workers URL, Pages URL, extension email/password, sideload steps. Keep local `pnpm dev` instructions pointing at Supabase.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/06-engineering.md
git commit -m "Document hosted Cloudflare and Supabase setup for Atelier."
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
| --- | --- |
| Single-user owner allowlist | Task 2 |
| Next on Workers (vinext first) | Task 6 |
| Email/password auth | Tasks 2, 7, 8 |
| Fresh library / no PGlite import | Tasks 1, 3 |
| Supabase Postgres + RLS | Tasks 1, 3 |
| Private Storage + signed URLs | Task 4 |
| waitUntil jobs; no sharp | Task 5 |
| Canvas on Pages | Task 7 |
| Extension JWT, default hosted URL | Task 8 |
| Smoke path | Task 9 |
| Out of scope (OAuth, CWS, migration, embeddings) | Not planned |

No TBD placeholders. Auth/db/storage interfaces use consistent `userId: string` (uuid) and Bearer JWT throughout.
