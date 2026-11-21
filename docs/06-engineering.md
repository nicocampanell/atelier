# Engineering

Status: Hosted path chosen — Cloudflare Workers (API) + Pages (canvas) + Supabase (Auth/Postgres/Storage); single-owner email allowlist.

## Proposed hosted architecture

The requested destination is a web app with a backend, rather than an on-device library. Treat this as the product constraint; exact vendors and models remain undecided. A practical first implementation is a web client and optional browser extension → authenticated API → relational database plus private object storage → durable background queue and isolated workers → search index. A worker obtains permitted content, extracts text and previews, embeds supported media, and updates searchable status. Search combines tenant-filtered lexical and vector retrieval, then returns source-linked passages or timestamps. See [the implementation study](09-reference-research.md) for the capture lifecycle, data model, permissions, retrieval, and source-code links.

An earlier prototype exists separately at `Documents/P2P/Proj1/atelier`; its README describes a hosted architecture and a local demo. Its code and production readiness have not been audited for this workspace. Review that implementation before choosing or rebuilding components; do not assume its development hash embeddings demonstrate semantic retrieval quality. See [positioning](03-positioning-and-business.md#prior-prototype).

Use durable capture IDs and idempotency for retries, validate ownership at every read and mutation, and never tell the user a queued job is fully processed. URL fetching needs SSRF defenses, redirect and DNS checks, size/time limits, and isolated parsers. Uploads require MIME validation, limits, private storage, and controlled previews. Hosted embeddings and summaries are derived personal data and must follow deletion and export policy. Do not send browser cookies to a backend by default; source access and rights need an explicit, source-specific design.

## Requirements and constraints

- **Platforms and supported devices:** [Fill in]
- **Expected initial usage:** [Fill in]
- **Performance and reliability needs:** [Fill in]
- **Budget and operating constraints:** [Fill in]
- **External services or integrations:** [Fill in]
- **Offline, accessibility, or other requirements:** [Fill in]

## Technical approach

Prefer the simplest approach that meets the first release's requirements. Record consequential choices and tradeoffs in the [decision log](08-decisions-and-questions.md).

| Area | Choice | Why it fits | Constraints or tradeoffs |
| --- | --- | --- | --- |
| Application platform / framework | Next.js API (vinext on Workers) + Vite canvas | Keeps existing `/api/*` contract; canvas stays a thin client | Workers runtime limits (no PGlite/`sharp`/Node `fs` for assets) |
| Data storage | Supabase Postgres + private Storage | RLS + signed URLs; one project for Auth/DB/files | Service role on API; client uses anon + JWT only |
| Authentication | Supabase email/password; Bearer access JWT | Same header shape as before; owner gated by `ATELIER_OWNER_EMAIL` | Single-user; no OAuth/CWS in this pass |
| Hosting and deployment | Cloudflare Workers (`atelier-api`) + Pages (`atelier-canvas`) | Fits vinext/Vite; cron via Workers | Secrets via wrangler/`cf`; live smoke needs human CF + Supabase login |

## System and data

- **Main components and responsibilities:** [Fill in]
- **How a core request moves through the system:** [Fill in]
- **Entities and relationships:** [Fill in]
- **External API contracts and failure handling:** [Fill in]
- **Data ownership, retention, export, and deletion:** [Fill in]

## Security and privacy

- **Sensitive data collected and why it is necessary:** [Fill in]
- **Who can read or change each type of data:** [Fill in]
- **Where inputs require validation and authorization:** [Fill in]
- **How secrets are stored outside the repository:** [Fill in]
- **Backup and recovery needs:** [Fill in]
- **Abuse cases and protections relevant to the product:** [Fill in]

## Development and verification

- **Local setup and commands:** Not available yet; add verified instructions to the root README when implemented.
- **Configuration variables needed, without secret values:** [Fill in]
- **Critical behavior to test:** [Fill in]
- **Checks required before release:** [Fill in]
- **Useful logs and error reporting, excluding sensitive data:** [Fill in]
- **Deployment and rollback procedure:** [Fill in]

## Next action

- [ ] Map the first release's core journey to the minimum technical components it needs.
