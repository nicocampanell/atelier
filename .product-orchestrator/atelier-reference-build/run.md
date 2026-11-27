# Build from Atelier references

## Contract

Nico approved building the prior reference-to-build proposal with subagents. The first milestone equips a coding agent to inspect visual evidence from a saved reference, adapt the chosen pattern, and get an independent review through Paseo.

- **R1** Discover the existing MCP tools and inspect a saved image by stable ID or exact saved URL. Return an image block and provenance, or an explicit missing-media result.
- **R2** Use the application's existing owner authentication for private images and public link previews. Bound preview reads, check media bytes, and keep credentials away from external origins.
- **R3** Validate the Paseo workflow and its inspection, approval, build, review, and repair handoffs. Carry intent per save and support motion briefs from user-provided timestamped stills.
- **R4** Document and check the standalone MCP setup, test entry points, and the preview endpoint's release dependency.

The baseline is `cffd04f4672d464bfe7864946e6b41dda21b026d` with unrelated local changes. The previous MCP package existed only in the backend worktree and passed four fixture-based brief tests. Notion searches for the two project spellings did not identify a canonical page. The research and current delivery summary remain here pending a verified project record.

## Architecture

Reuse Node, the MCP SDK's stdio transport, Supabase JWT authentication, the owner-filtered Atelier API, and Supabase Storage. Place the standalone package under the root `mcp/` directory with its own lockfile. Preserve existing tools and add an image-bearing read to the same client. Authenticated upload previews use the existing asset endpoint and a restricted Storage redirect. A separate Atelier read route fetches and validates public saved preview images using the existing bounded URL fetcher. No schema change is needed.

The reviewed alternative is to proxy both uploaded and linked images through the new API endpoint. Keeping the existing private asset path allows uploaded images to work with the current API and avoids proxying those bytes through Workers. Revisit this split if Storage origins or signed redirect shapes vary across environments.

Keep the current client authentication for this milestone. Hosted MCP browser sign-in and automatic video sampling are subsequent product work. This milestone uses manually selected stills for motion.

## Ownership

- `mcp_core` owns the standalone MCP implementation and its tests.
- `api_preview` owns the owner-scoped save lookup and external preview API path.
- `playbooks` owns the Paseo workflow and role contracts.
- The lead owns this record, integration docs and root package isolation. A separate verifier checks the combined result.

## Verification

The pilot check uses synthetic save data and the real MCP stdio entry point. The preview route check uses controlled responses and verifies the auth gate, bounds, and media types. Paseo validation checks the configured graph and wiring. A saved-board run against the hosted service requires an authorized owner session, the deployed preview route for link saves, and a target component on the playbook's remote base.

### Reproduce the focused checks

- **R1:** Build with `pnpm --dir mcp build` and run `pnpm --dir mcp test`. The loopback fixture at `/tmp/atelier-reference-fixture.mjs` also exercises the compiled stdio process, the actual Atelier route handlers, and synthetic Supabase HTTP and Storage. Run it from the repository root with `node --import tsx --test /tmp/atelier-reference-fixture.mjs`.
- **R2:** Run `node --experimental-test-module-mocks --import tsx --test 'app/api/saves/*/preview/*.test.ts'`. The loopback fixture covers owner separation, direct source lookup, and a signed download without the owner bearer.
- **R3:** Validate `build-from-atelier` in Paseo. The installed plugin's loader and engine were also exercised with the synthetic step reports in `/tmp/opencode/atelier-playbook-engine.test.mjs`.
- **R4:** Follow `mcp/README.md` in a clean copy of the package, then run the documented typecheck and build. Exercise the CLI through a symlink as well as its direct path.

Initial independent review identified two packaging failures: pnpm 12 ignored the inherited esbuild approval settings, and a symlinked CLI could exit before opening stdio. The lead moved build approval into the package's own workspace settings and fixed entrypoint path resolution. The first review was interrupted by provider quota after the repairs. Root typecheck output remained identical before and after the feature changes, with existing errors in the web environment types and the Cloudflare Worker request types. The affected API routes passed focused typechecking.

The resumed independent review passed R1–R4 on snapshot `b048519496349fb0e617b441cd24a5cb499e01db2984f6e7d0ccbd74026c5496`. The [evidence report](verification/report.json) and adjacent logs record the clean package install, 13 MCP tests, six preview-route tests, the compiled stdio loopback fixture, and four Playbooks engine cases. The lead reran the evidence gate and it matched this artifact. A production library and live Paseo run remain unverified. The new preview endpoint has no production deployment from this run.
