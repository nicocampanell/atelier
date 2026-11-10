import type { NextConfig } from "next";

const config: NextConfig = {
  // PGlite is the embedded Postgres used for local development.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default config;
