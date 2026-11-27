# Atelier MCP

Build from saved visual references and board notes in Codex, Cursor, Claude Code, or another stdio MCP client. The MCP reads your Atelier API with the same Supabase account as the canvas.

## Connect

Install and build the standalone package from the repository root with Node.js 22 or newer and pnpm:

```sh
pnpm --dir mcp install --frozen-lockfile
pnpm --dir mcp build
```

If `mcp/dist/index.js` is current and dependencies are installed, use that build.

Add this to your Codex MCP configuration. Use the absolute path for this checkout so agents can launch from another worktree.

```toml
[mcp_servers.atelier]
command = "node"
args = ["/absolute/path/to/atelier/mcp/dist/index.js"]
env_vars = ["ATELIER_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY", "ATELIER_EMAIL", "ATELIER_PASSWORD"]
```

For Cursor or Claude Code, use the same command and argument in the client's stdio configuration. Supply the settings from your local secret manager or the environment that launches the client and its Paseo agents:

| Variable | Value |
| --- | --- |
| `ATELIER_URL` | Atelier API origin. The hosted API is `https://atelier-api.nicocampanell.workers.dev`. |
| `SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_ANON_KEY` | Supabase publishable or anon key. |
| `ATELIER_EMAIL` | Email of the account allowed by the Atelier API. |
| `ATELIER_PASSWORD` | Password for that account. |

The MCP also accepts `ATELIER_SUPABASE_URL` and `ATELIER_SUPABASE_ANON_KEY`. Include the chosen names in `env_vars`. Keep the password out of project config, prompts, and execution logs. Restart the MCP client after configuring it and call `list_projects` to verify the session can read hosted boards.

## Build from a save or board

- Open one saved reference with `inspect_reference`. Pass either `saveId` or the exact saved `sourceUrl`. The tool returns the save's provenance and an image when the preview is available.
- Use `export_board_brief` to read a hosted board. `direction` draws from its visuals, `implement` includes the notes as requirements, and `full` includes both. Open the saves you intend to use before building.
- Use `export_combined_brief` with roles per board when different boards set palette, layout, or motion. `search_references` and `list_visual_tags` help you find specific details. The metadata-only `get_reference` and URL-only `get_reference_preview` remain available.

In Paseo, run **Build from Atelier references**. Provide a hosted board or saved references, the target component, and what the build should borrow. A motion brief can name multiple saved stills with timestamps you supply. The run gives you the evidence and scope to approve before an isolated build and independent verification.

The isolated playbook starts from the target repository's remote base branch. Ensure that base has the component or project area you want to change. A board visible only in a browser's local canvas must sync to the API before the MCP can open it. See the [playbook setup](../.paseo/plugins/playbooks/README.md) to use it in another repository.

Uploaded images use Atelier's authenticated asset route. Link previews use the API's `GET /api/saves/{id}/preview` route, which must be available in the environment you connect to. If an image is unavailable, the tool still returns the reference metadata and reports the missing evidence. For motion, save stills you want the agent to inspect and provide their order or timestamps to the playbook.

## Check locally

```sh
pnpm --dir mcp typecheck
pnpm --dir mcp test
```
