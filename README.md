# Atelier

**Save what inspires you. Build from what you saved.**

Atelier is a private design reference library with an infinite canvas. Capture screenshots, images, and links as you browse. Arrange them on boards with notes about what caught your eye. When you're ready to build, hand the same references to your coding agent through MCP.

[Open Atelier](https://atelier-canvas.pages.dev) · [Connect your coding agent](mcp/README.md) · [Self-host Atelier](docs/deploy-cloudflare.md)

The hosted canvas requires a provisioned account. The Chrome extension is currently installed as an unpacked extension.

## How it works

1. **Capture.** Save a page with **Alt+Shift+S**, right-click to save an image, or use **Alt+Shift+R** to capture a region. The extension can also pick up supported saves from Pinterest, Are.na, X, and Instagram.
2. **Collect.** Search your library, put references on a canvas board, and add notes about the layout, palette, or interaction you want to borrow.
3. **Build.** Give your coding agent a board name or an individual save. Atelier MCP can export a brief or open a saved image with its source and any evidence gaps. In Paseo, the [Build from Atelier references playbook](.paseo/plugins/playbooks/README.md) lets you approve the brief before an isolated build and independent review.

For motion, save the key frames as screenshots and include their order or timestamps. Link preview images require the preview route in this revision of the API.

## Run locally

You’ll need Node.js 22 or newer, pnpm, and a Supabase project. The canvas also supports installing its dependencies with npm.

1. Run `pnpm install` at the repository root.
2. Apply the [Supabase migrations](supabase/README.md). Provision an Auth user, then copy `.env.example` to `.env.local` and set the Supabase values and `ATELIER_OWNER_EMAIL`. The API only accepts the configured owner.
3. Start the API with `pnpm dev` on port 3000.
4. Copy `web/.env.example` to `web/.env.local` and set the Supabase URL and anon key. Leave `VITE_API_URL` unset to use the local API proxy. Run `cd web && npm install && npm run dev`.
5. Copy `extension/.env.example` to `extension/.env.local` and set the Supabase URL and anon key. From the repository root, run `pnpm --dir extension install --ignore-workspace` and `pnpm --dir extension build`. In Chrome, enable Developer mode at `chrome://extensions` and load `extension/.output/chrome-mv3`. Set the extension's API URL to `http://localhost:3000` for local development.
6. To use Atelier from an agent, follow the [MCP setup](mcp/README.md).

Keyword search works out of the box. Set `TYPESAFE_API_KEY` to enable Jev visual tags and relevance ranking for recent candidates. Keep the key and the Supabase service-role key on the API server.

## Project layout

| Area | What it does |
| --- | --- |
| [web/](web/) | Vite and React canvas, boards, and library |
| [extension/](extension/) | Chrome capture extension |
| [app/api/](app/api/) and [lib/](lib/) | API for saves, boards, and search |
| [supabase/](supabase/) | Authentication, database schema, and private asset storage |
| [mcp/](mcp/) | Read-only MCP for boards, search, and reference images |

For hosted setup, see the [Cloudflare Workers API guide](docs/deploy-cloudflare.md) and [Cloudflare Pages canvas guide](web/docs/deploy-pages.md). Product direction and source studies are maintained in the [project docs](docs/).

## Development checks

- MCP: `pnpm --dir mcp typecheck` and `pnpm --dir mcp test`
- Canvas: `cd web && npm test`
- API authentication: `node --import tsx scripts/verify-auth-supabase.ts`
- Save previews: `node --experimental-test-module-mocks --import tsx --test 'app/api/saves/*/preview/*.test.ts'`
