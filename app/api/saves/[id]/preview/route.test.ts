import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { SafeFetchError } from "../../../../../lib/fetch-safe";
import type { SafeFetchOptions, SafeFetchResult } from "../../../../../lib/fetch-safe";

let authenticated = true;
let savedPreview: string | null = "https://images.example.com/saved.png";
let requestedOwner: string | null = null;
let fetched: { url: string; options: SafeFetchOptions } | null = null;
let fetchResult: SafeFetchResult | Error;

const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

mock.module(new URL("../../../../../lib/auth.ts", import.meta.url), {
  exports: {
    requireUser: async () => authenticated ? "owner-id" : new Response(null, { status: 401 }),
  },
});
mock.module(new URL("../../../../../lib/saves.ts", import.meta.url), {
  exports: {
    getSave: async (userId: string, id: string) => {
      requestedOwner = userId;
      return id === "owner-save" ? { previewUrl: savedPreview } : null;
    },
  },
});
mock.module(new URL("../../../../../lib/fetch-safe.ts", import.meta.url), {
  exports: {
    SafeFetchError,
    safeFetch: async (url: string, options: SafeFetchOptions) => {
      fetched = { url, options };
      if (fetchResult instanceof Error) throw fetchResult;
      return fetchResult;
    },
  },
});
const { GET } = await import("./route");

function reset() {
  authenticated = true;
  savedPreview = "https://images.example.com/saved.png";
  requestedOwner = null;
  fetched = null;
  fetchResult = { finalUrl: savedPreview, status: 200, contentType: "image/png", body: png };
}

function request(id = "owner-save") {
  return GET(new Request("http://localhost/api/saves/owner-save/preview?url=https://attacker.example/image"), {
    params: Promise.resolve({ id }),
  });
}

test("returns the owner's saved image with bounded retrieval and private headers", async () => {
  reset();
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  assert.equal(requestedOwner, "owner-id");
  assert.deepEqual(fetched, {
    url: savedPreview,
    options: { maxBytes: 4 * 1024 * 1024, timeoutMs: 8_000 },
  });
});

test("does not fetch a preview without authorization or an owned save", async () => {
  reset();
  authenticated = false;
  let response = await request();
  assert.equal(response.status, 401);
  assert.equal(fetched, null);
  authenticated = true;
  response = await request("foreign-save");
  assert.equal(response.status, 404);
  assert.equal(fetched, null);
});

test("does not fetch missing or internal asset paths", async () => {
  reset();
  savedPreview = null;
  assert.equal((await request()).status, 404);
  savedPreview = "/api/assets/private-id";
  assert.equal((await request()).status, 404);
  assert.equal(fetched, null);
});

test("rejects mismatched and unsupported image bytes", async () => {
  reset();
  fetchResult = { finalUrl: savedPreview!, status: 200, contentType: "image/jpeg", body: png };
  assert.equal((await request()).status, 415);
  fetchResult = { finalUrl: savedPreview!, status: 200, contentType: "image/png", body: Buffer.from("<svg></svg>") };
  assert.equal((await request()).status, 415);
});

test("reports oversized previews and upstream failures", async () => {
  reset();
  fetchResult = new SafeFetchError("too_large", "too large");
  assert.equal((await request()).status, 413);
  fetchResult = new SafeFetchError("private_address", "private");
  assert.equal((await request()).status, 502);
  fetchResult = { finalUrl: savedPreview!, status: 404, contentType: "image/png", body: png };
  assert.equal((await request()).status, 502);
});
