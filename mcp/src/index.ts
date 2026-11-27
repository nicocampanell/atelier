#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { AtelierClient, loadConfig } from "./client.js";
import { buildBoardBrief, combineBriefs, type BriefMode } from "./brief.js";
import { listVisualTags } from "./tags.js";

const modeSchema = z.enum(["direction", "implement", "full"]).default("full");

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }], isError: true as const };
}

export function createServer(client: AtelierClient) {
  const server = new McpServer({ name: "atelier", version: "0.1.0" });

  server.registerTool(
    "list_projects",
    { description: "List Atelier projects (boards/folders). Use names or ids with export_board_brief." },
    async () => {
      try {
        return text(await client.listProjects());
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "export_board_brief",
    {
      description:
        "Export one Atelier board as an agent brief: notes (spec), tagged references with preview URLs, and a derived visual direction. Modes: direction (look only), implement (notes as requirements + comps), full (both). Cite save ids when applying look or building UI.",
      inputSchema: {
        project: z.string().describe("Project id or name (e.g. Food)"),
        mode: modeSchema.describe("direction | implement | full"),
      },
    },
    async ({ project, mode }) => {
      try {
        const p = await client.resolveProject(project);
        const board = await client.getBoard(p.id);
        const saveIds = board.items.filter((i) => i.type === "save" && i.saveId).map((i) => i.saveId!);
        const saves = await client.getSaves([...new Set(saveIds)]);
        return text(buildBoardBrief(p, board, saves, (mode ?? "full") as BriefMode));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "export_combined_brief",
    {
      description:
        "Combine 2+ Atelier boards into one brief (all notes + inspiration). Optional roles map board name/id → role (e.g. {\"Color\":\"palette\",\"Interiors\":\"layout\"}).",
      inputSchema: {
        projects: z.array(z.string()).min(2).describe("Project ids or names"),
        roles: z.record(z.string()).optional().describe("Optional role per project name or id"),
        mode: modeSchema,
      },
    },
    async ({ projects, roles, mode }) => {
      try {
        const briefs = [];
        for (const name of projects) {
          const p = await client.resolveProject(name);
          const board = await client.getBoard(p.id);
          const saveIds = board.items.filter((i) => i.type === "save" && i.saveId).map((i) => i.saveId!);
          const saves = await client.getSaves([...new Set(saveIds)]);
          briefs.push(buildBoardBrief(p, board, saves, "full"));
        }
        return text(combineBriefs(briefs, roles, (mode ?? "full") as BriefMode));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "search_references",
    {
      description:
        "Search the Atelier library when no board is named. Always returns tags on each save. Prefer export_board_brief when the user names a folder/board.",
      inputSchema: {
        q: z.string().describe("Search query"),
        kinds: z.array(z.enum(["url", "image", "file", "note"])).optional(),
        tags: z.array(z.string()).optional().describe("Keep hits that include all of these tags"),
      },
    },
    async ({ q, kinds, tags }) => {
      try {
        const res = await client.search(q, kinds);
        const filter = (hits: typeof res.hits) =>
          !tags?.length ? hits : hits.filter((h) => tags.every((t: string) => (h.save.tags ?? []).includes(t)));
        return text({
          query: res.query,
          semantic: res.semantic,
          hits: filter(res.hits),
          weaker: filter(res.weaker),
        });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "list_visual_tags",
    {
      description:
        "Fixed visual tag vocabulary + synonyms (cream, typography, minimal, …). Map user language to tags before search.",
    },
    async () => text({ tags: listVisualTags() }),
  );

  server.registerTool(
    "inspect_reference",
    {
      description: "Open a saved reference by save ID or exact source URL. Returns metadata and the image itself when an Atelier asset can be accessed. Review its evidence before building.",
      inputSchema: {
        saveId: z.string().trim().min(1).max(200).optional().describe("Atelier save ID"),
        sourceUrl: z.string().url().max(2048).optional().describe("Exact source URL recorded by Atelier"),
      },
    },
    async ({ saveId, sourceUrl }) => {
      try {
        if (Boolean(saveId) === Boolean(sourceUrl)) throw new Error("Provide exactly one of saveId or sourceUrl.");
        const save = saveId ? await client.getSave(saveId) : await client.getSaveBySourceUrl(sourceUrl!);
        const image = await client.inspectSaveImage(save);
        const metadata = {
          reference: save,
          credit: null,
          media: image.status === "available"
            ? { status: image.status, mimeType: image.mimeType }
            : image,
        };
        const content: Array<{ type: "text"; text: string } | { type: "image"; mimeType: string; data: string }> = [
          { type: "text", text: JSON.stringify(metadata, null, 2) },
        ];
        if (image.status === "available") content.push({ type: "image", mimeType: image.mimeType, data: image.data });
        return { content };
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "get_reference",
    {
      description: "Fetch one Atelier save by id. Includes tags and previewUrl. For image content use inspect_reference.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      try {
        return text(await client.getSave(id));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "get_reference_preview",
    {
      description: "Return the preview URL for a save. Atelier asset paths require authentication; use inspect_reference for image content.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      try {
        const save = await client.getSave(id);
        return text({
          id: save.id,
          title: save.title,
          tags: save.tags ?? [],
          previewUrl: save.previewUrl,
          sourceUrl: save.sourceUrl,
        });
      } catch (e) {
        return err(e);
      }
    },
  );

  return server;
}

async function main() {
  const server = createServer(new AtelierClient(loadConfig()));
  await server.connect(new StdioServerTransport());
}

const entrypoint = process.argv[1];
if (entrypoint && existsSync(entrypoint) && realpathSync(entrypoint) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
