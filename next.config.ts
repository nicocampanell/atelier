import type { NextConfig } from "next";

const config: NextConfig = {
  // PGlite is the embedded Postgres used for local development.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Lets verify scripts run their own dev server side by side (e.g. NEXT_DIST_DIR=.next-verify-ext).
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default config;
