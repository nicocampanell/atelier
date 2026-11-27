import assert from "node:assert/strict";
import { mock, test } from "node:test";

mock.module(new URL("../../../../../lib/auth.ts", import.meta.url), {
  exports: { requireUser: async () => "owner-id" },
});
mock.module(new URL("../../../../../lib/saves.ts", import.meta.url), {
  exports: { getSave: async () => ({ previewUrl: "http://127.0.0.1/private.png" }) },
});

const { GET } = await import("./route");

test("the real safe fetch rejects a saved private-network preview", async () => {
  const response = await GET(new Request("http://localhost/api/saves/id/preview"), {
    params: Promise.resolve({ id: "id" }),
  });
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "preview_unavailable", message: "Couldn't retrieve the saved preview." },
  });
});
