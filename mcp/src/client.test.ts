import assert from "node:assert/strict";
import { test } from "node:test";
import { AtelierClient, type Save } from "./client.js";

const config = { apiUrl: "https://api.example", supabaseUrl: "https://storage.example", supabaseAnonKey: "key", email: "test@example.org", password: "test" };
const save = (id: string, sourceUrl: string): Save => ({ id, sourceUrl, kind: "url", title: id, description: null, previewUrl: null, asset: null, status: "ready", error: null, duplicateOf: null, tags: [], createdAt: "2026-01-01" });

test("exact source URL resolution reads subsequent pages and rejects duplicate or missing references", async () => {
  const client = new AtelierClient(config);
  const target = "https://site.example/reference";
  let duplicate = false;
  client.api = async <T>(path: string): Promise<T> => {
    if (path === "/api/saves/s2") return save("s2", target) as T;
    if (path.includes("cursor=next")) return { saves: [save("s2", target)], next: null } as T;
    return { saves: [save("s1", duplicate ? target : `${target}-other`)], next: "next" } as T;
  };
  assert.equal((await client.getSaveBySourceUrl(target)).id, "s2");
  await assert.rejects(client.getSaveBySourceUrl("https://site.example/missing"), /No saved reference/);
  duplicate = true;
  await assert.rejects(client.getSaveBySourceUrl(target), /Multiple saved references/);
});

test("exact source URL lookup stops if pagination repeats", async () => {
  const client = new AtelierClient(config);
  client.api = async <T>(): Promise<T> => ({ saves: [], next: "same" }) as T;
  await assert.rejects(client.getSaveBySourceUrl("https://site.example"), /repeated pagination cursor/);
});

test("uses the owner's exact-source lookup when the API confirms support", async () => {
  const client = new AtelierClient(config);
  const target = "https://site.example/a?x=1";
  const calls: string[] = [];
  client.api = async <T>(path: string): Promise<T> => {
    calls.push(path);
    if (path === "/api/saves/s1") return save("s1", target) as T;
    return { saves: [save("s1", target)], next: null, exactSource: true } as T;
  };
  assert.equal((await client.getSaveBySourceUrl(target)).id, "s1");
  assert.equal(new URL(calls[0]!, "https://api.example").searchParams.get("sourceUrl"), target);
  assert.equal(calls.length, 2);
});
