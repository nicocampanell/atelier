import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./index.js";
import { AtelierClient, type Save } from "./client.js";

const save: Save = { id: "s1", kind: "image", sourceUrl: "https://example.org/ref", title: "Reference", description: null, previewUrl: "/api/assets/a", asset: null, status: "ready", error: null, duplicateOf: null, tags: [], createdAt: "2026-01-01" };

test("MCP advertises existing tools and returns actual image content for a saved reference", async () => {
  const fake = {
    getSave: async (id: string) => { assert.equal(id, "s1"); return save; },
    inspectSaveImage: async () => ({ status: "available", mimeType: "image/png", data: "iVBORw0KGgo=" }),
  } as unknown as AtelierClient;
  const server = createServer(fake);
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const name of ["inspect_reference", "list_projects", "export_board_brief", "export_combined_brief", "search_references", "list_visual_tags", "get_reference", "get_reference_preview"]) assert.ok(names.includes(name));
    const result = await client.callTool({ name: "inspect_reference", arguments: { saveId: "s1" } });
    assert.ok(Array.isArray(result.content));
    assert.equal(result.content[1]?.type, "image");
    const metadata = JSON.parse((result.content[0] as { text: string }).text);
    assert.equal(metadata.reference.id, "s1");
    assert.equal(metadata.media.status, "available");
    const invalid = await client.callTool({ name: "inspect_reference", arguments: { saveId: "s1", sourceUrl: "https://example.org/ref" } });
    assert.equal(invalid.isError, true);
  } finally {
    await client.close();
    await server.close();
  }
});


test("MCP reads the saved object and image through the authenticated API", async () => {
  const config = { apiUrl: "https://atelier.example", supabaseUrl: "https://storage.example", supabaseAnonKey: "key", email: "test@example.org", password: "test" };
  const apiClient = new AtelierClient(config);
  (apiClient as unknown as { session: unknown }).session = { access_token: "owner-token", expires_at: Math.floor(Date.now() / 1000) + 3600 };
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push(String(input));
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer owner-token");
    if (String(input).endsWith("/api/saves/s1")) return Response.json({ ok: true, data: save });
    if (String(input).endsWith("/api/assets/a")) return new Response(Buffer.from("89504e470d0a1a0a", "hex"), { headers: { "content-type": "image/png" } });
    throw new Error("Unexpected fetch");
  };
  const server = createServer(apiClient);
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name: "inspect_reference", arguments: { saveId: "s1" } });
    assert.ok(Array.isArray(result.content));
    assert.equal(result.content[1]?.type, "image");
    assert.deepEqual(calls, ["https://atelier.example/api/saves/s1", "https://atelier.example/api/assets/a"]);
  } finally {
    globalThis.fetch = originalFetch;
    await client.close();
    await server.close();
  }
});
