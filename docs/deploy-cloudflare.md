# Deploy Atelier API to Cloudflare Workers (vinext)

The Next.js `/api/*` app deploys via **vinext** (not OpenNext). `vinext check` reported 100% compatibility for this codebase.

## One-time setup

```bash
pnpm install
pnpm exec cf auth login          # or: npx wrangler login
# optional if multi-account:
export CLOUDFLARE_ACCOUNT_ID=…
```

Copy `.dev.vars.example` → `.dev.vars` for local `pnpm run dev:vinext` (workerd). Keep using `.env.local` for plain `pnpm dev` (Node Next).

## Secrets (production)

Declare bindings live in `cloudflare.config.ts` (`bindings.secret()`). Values are never committed.

After the Worker exists (first deploy, or build + `cf deploy --prebuilt --secrets-file`):

```bash
# Preferred (cf / vinext path):
pnpm exec cf workers secrets update --worker atelier-api --type secret_text

# Or wrangler equivalents from the plan:
npx wrangler secret put SUPABASE_URL --name atelier-api
npx wrangler secret put SUPABASE_ANON_KEY --name atelier-api
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --name atelier-api
npx wrangler secret put ATELIER_OWNER_EMAIL --name atelier-api
npx wrangler secret put TYPESAFE_API_KEY --name atelier-api   # optional
npx wrangler secret put CRON_SECRET --name atelier-api        # optional but needed for cron
npx wrangler secret put ATELIER_ALLOWED_ORIGINS --name atelier-api  # canvas origin(s)
```

First deploy when secrets are still unset: build, then upload with a secrets file (JSON or `.env`, not committed):

```bash
pnpm run build:vinext
pnpm exec cf deploy --prebuilt --mode production --secrets-file ./secrets.env
```

## Deploy / preview

```bash
pnpm run deploy          # alias: deploy:vinext → vinext-cloudflare deploy
pnpm run preview         # local vite preview of the Worker build
pnpm run build:vinext    # production build only
pnpm run start:vinext    # same as preview
```

Worker name: `atelier-api` → URL shape `https://atelier-api.<subdomain>.workers.dev`.

Smoke:

```bash
export WORKER_URL=https://atelier-api.<subdomain>.workers.dev
curl -sS "$WORKER_URL/api/health"
# Authenticated routes: 401 without Bearer, 200 with owner Supabase JWT
```

## Cron

`cloudflare.config.ts` schedules `0 * * * *` (hourly UTC). `worker/index.ts` `scheduled()` POSTs `/api/cron/requeue` with `Authorization: Bearer $CRON_SECRET`. You can also hit that route manually with the same header.

## Local vinext

```bash
pnpm run dev:vinext   # port 3001 (Next `pnpm dev` still on 3000)
```
