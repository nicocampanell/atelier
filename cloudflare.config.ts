import { bindings, defineConfig, defineWorker, triggers } from "cf/config";

// Secrets stay out of git: set with `pnpm exec cf workers secrets update` (or
// `wrangler secret put`) after the first deploy. Local: use `.env.local` /
// `.dev.vars` (see docs/deploy-cloudflare.md).
export default defineConfig({
  worker: defineWorker({
    name: "atelier-api",
    entrypoint: "./worker/index.ts",
    compatibilityDate: "2026-11-19",
    observability: {
      enabled: true,
      traces: { enabled: true },
    },
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    // Hourly requeue of stuck/untagged saves → worker/index.ts scheduled().
    triggers: [triggers.scheduled({ schedule: "0 * * * *" })],
    env: {
      ASSETS: bindings.assets(),
      SUPABASE_URL: bindings.secret(),
      SUPABASE_ANON_KEY: bindings.secret(),
      SUPABASE_SERVICE_ROLE_KEY: bindings.secret(),
      ATELIER_OWNER_EMAIL: bindings.secret(),
      TYPESAFE_API_KEY: bindings.secret(),
      CRON_SECRET: bindings.secret(),
      ATELIER_ALLOWED_ORIGINS: bindings.secret(),
    },
  }),
});
