import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { inspectImage } from "./media.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
const args = ["save-1", "https://atelier.example", "https://storage.example", "secret-token"] as const;

test("reads private storage without forwarding bearer to its signed redirect", async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
    if (calls.length === 1) return new Response(null, { status: 302, headers: { location: "https://storage.example/storage/v1/object/sign/atelier-assets/a?token=signed" } });
    return new Response(png, { headers: { "content-type": "image/png" } });
  };
  const result = await inspectImage("/api/assets/id", ...args);
  assert.equal(result.status, "available");
  if (result.status === "available") assert.equal(result.data, png.toString("base64"));
  assert.equal(calls[0]!.authorization, "Bearer secret-token");
  assert.equal(calls[1]!.authorization, null);
});

test("rejects untrusted storage redirects without fetching them", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 302, headers: { location: "https://attacker.example/storage/v1/object/sign/a" } }); };
  assert.equal((await inspectImage("/api/assets/id", ...args)).status, "unavailable");
  assert.equal(calls, 1);
});

test("uses the authorized preview endpoint for external images without requesting the external URL", async () => {
  const urls: string[] = [];
  globalThis.fetch = async (input, init) => {
    urls.push(String(input));
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer secret-token");
    return new Response(png, { headers: { "content-type": "image/png" } });
  };
  assert.equal((await inspectImage("https://cdn.example/image.png", ...args)).status, "available");
  assert.deepEqual(urls, ["https://atelier.example/api/saves/save-1/preview"]);
});

test("reports missing previews, API errors, oversized content and mismatched bytes", async () => {
  assert.equal((await inspectImage(null, ...args)).status, "missing");
  globalThis.fetch = async () => new Response(null, { status: 404 });
  assert.equal((await inspectImage("https://cdn.example/image.png", ...args)).status, "unavailable");
  globalThis.fetch = async () => new Response(null, { status: 413 });
  assert.equal((await inspectImage("https://cdn.example/image.png", ...args)).status, "too_large");
  globalThis.fetch = async () => new Response("not an image", { headers: { "content-type": "image/png" } });
  assert.equal((await inspectImage("/api/assets/id", ...args)).status, "unsupported");
  globalThis.fetch = async () => new Response(png, { headers: { "content-type": "image/png", "content-length": "20971521" } });
  assert.equal((await inspectImage("/api/assets/id", ...args)).status, "too_large");
});
