# Deploy canvas to Cloudflare Pages

## Env (Pages → Settings → Environment variables)

| Variable | Notes |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Public anon key |
| `VITE_API_URL` | Hosted Workers API origin, e.g. `https://atelier-api.<subdomain>.workers.dev` |

Vite inlines these at **build** time — set them before `npm run build` / in the Pages build env.

## Local build + deploy

```bash
cd web
cp .env.example .env.local   # fill values; never commit
npm run build
npx wrangler login           # once per machine
npm run deploy:pages
# or: npx wrangler pages deploy dist --project-name atelier-canvas
```

## First-time Pages project

If `atelier-canvas` does not exist yet:

```bash
npx wrangler pages project create atelier-canvas --production-branch main
npm run deploy:pages
```

## Smoke

1. Open the Pages URL → Sign in (email/password).
2. After sign-in, Boards/Library load; backend status reaches Connected when `VITE_API_URL` is correct.
3. Optional: DevTools → Network → `GET {VITE_API_URL}/api/projects` with `Authorization: Bearer <access_token>`.

## Note

This agent environment had no Cloudflare login (`wrangler whoami` unauthenticated). Config + script are scaffolded; a human must `wrangler login` and deploy.
