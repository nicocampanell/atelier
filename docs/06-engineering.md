# Engineering

Status: Hosted web app requested; architecture proposed and stack undecided.

## Proposed hosted architecture

The requested destination is a web app with a backend, rather than an on-device library. Treat this as the product constraint; exact vendors and models remain undecided. A practical first implementation is a web client and optional browser extension → authenticated API → relational database plus private object storage → durable background queue and isolated workers → search index. A worker obtains permitted content, extracts text and previews, embeds supported media, and updates searchable status. Search combines tenant-filtered lexical and vector retrieval, then returns source-linked passages or timestamps. See [the implementation study](09-reference-research.md) for the capture lifecycle, data model, permissions, retrieval, and source-code links.

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
| Application platform / framework | Undecided | [Fill in] | [Fill in] |
| Data storage, if needed | Undecided | [Fill in] | [Fill in] |
| Authentication, if needed | Undecided | [Fill in] | [Fill in] |
| Hosting and deployment | Undecided | [Fill in] | [Fill in] |

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
