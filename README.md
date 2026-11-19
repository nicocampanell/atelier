# Project workbook

Working documents for shaping this project and taking it from an idea to a useful product. The product, audience, and technical approach are still open.

Start with the first three documents. Write rough answers, leave blanks when needed, and revisit them as you learn. You do not need to complete every worksheet before experimenting or building.

| Order | Document | What to work out |
| --- | --- | --- |
| 1 | [Mission](docs/01-mission.md) | Why this should exist and what success means |
| 2 | [Users and research](docs/02-users-and-research.md) | Who needs it, what they do today, and what evidence we have |
| 3 | [Positioning and business](docs/03-positioning-and-business.md) | Why people would choose it and how it can sustain itself |
| 4 | [Product and features](docs/04-product-and-features.md) | The core experience and smallest useful release |
| 5 | [Design](docs/05-design.md) | User journeys, interaction principles, and visual direction |
| 6 | [Engineering](docs/06-engineering.md) | Architecture, data, security, and implementation constraints |
| 7 | [Roadmap and launch](docs/07-roadmap-and-launch.md) | What happens next and how we know it works |
| Ongoing | [Decisions and questions](docs/08-decisions-and-questions.md) | Decisions, assumptions, risks, and unresolved questions |

## How to use these documents

- Replace `[Fill in]` with your answer. `Unknown` is a useful answer too.
- Label untested beliefs as **assumptions** and link evidence when available.
- Keep each topic in its own document; link to it elsewhere instead of copying it.
- Record consequential decisions in the decision log, including why they were made.
- When direction changes, update the affected documents and preserve the decision history.

## Run the front end

The front end lives in `web/` (Vite, React, TypeScript).

```bash
cd web
cp .env.example .env.local   # VITE_SUPABASE_* required for sign-in
npm install
npm run dev
```

Open the printed local URL (http://localhost:5173). `npm run build` type-checks and builds for production.

Hosted deploy (Cloudflare Pages): see [web/docs/deploy-pages.md](web/docs/deploy-pages.md). Production builds need `VITE_API_URL` pointing at the Workers API.

## Reference research

- [Reference study and hosted implementation](docs/09-reference-research.md) — video observations, thread feedback, source-code findings, and a proposed backend architecture.
- The current concept and design direction are recorded in the mission, product, design, and engineering worksheets. These are working hypotheses, not validated requirements.
