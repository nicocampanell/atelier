import assert from "node:assert/strict";
import { scoreWithJev, isJevHealthy } from "../lib/search/jev";

async function main() {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.TYPESAFE_API_KEY;
  try {
    delete process.env.TYPESAFE_API_KEY;
    assert.equal(await scoreWithJev("query", [{ text: "content" }]), null);
    process.env.TYPESAFE_API_KEY = "test-key";
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "jev-latest");
      assert.equal(body.state.query, "puppy");
      assert.equal(body.questions.relevant.type, "noul");
      if (body.assets) {
        assert.equal(new Headers(init?.headers).get("TypeSafe-Danger-Zone-Images"), "true");
        assert.equal(Object.values(body.assets).length, 1);
        assert.ok(body.assets[body.state.image]);
      }
      return Response.json({ answers: { relevant: { noul: 0.9 } } });
    };
    const scores = await scoreWithJev("puppy", [{ text: "hound" }, { text: "photo", image: { bytes: new Uint8Array([1, 2, 3]), format: "png" } }]);
    assert.deepEqual(scores, [0.9, 0.9]);
    assert.equal(calls, 2);
    assert.equal(isJevHealthy(), true);
    globalThis.fetch = async () => new Response("error", { status: 401 });
    assert.equal(await scoreWithJev("query", [{ text: "content" }]), null);
    assert.equal(isJevHealthy(), false);
    globalThis.fetch = async () => Response.json({ answers: { relevant: { noul: 2 } } });
    assert.equal(await scoreWithJev("query", [{ text: "content" }]), null);
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "atelier-jev-test-"));
    process.env.ATELIER_DATA_DIR = dir;
    const { getDb, closeDb } = await import("../lib/db");
    const { indexSave, search } = await import("../lib/search");
    const db = await getDb();
    for (const [id, owner, text] of [["own", "owner", "hound"], ["other", "other", "secret other user's text"]]) {
      await db.query(`insert into save (id, user_id, kind, title, status, created_at) values ($1,$2,'note',$3,'ready',now())`, [id, owner, text]);
      await indexSave(owner, id, { title: text, description: null, text, sourceUrl: null, kind: "note" });
    }
    const transmitted: string[] = [];
    globalThis.fetch = async (_url, init) => {
      transmitted.push(String(init?.body));
      return Response.json({ answers: { relevant: { noul: 0.95 } } });
    };
    const result = await search("owner", "puppy");
    assert.equal(result.semantic, true);
    assert.equal(result.hits[0]?.save.id, "own");
    assert.ok(transmitted.length > 0);
    assert.ok(transmitted.every((body) => !body.includes("secret other user's text")));
    await closeDb();
    await rm(dir, { recursive: true, force: true });
    globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    const started = Date.now();
    const keepAlive = setInterval(() => {}, 1000);
    try {
      assert.equal(await scoreWithJev("query", Array.from({ length: 24 }, () => ({ text: "content" }))), null);
      assert.ok(Date.now() - started < 13000, "overall deadline exceeded");
    } finally { clearInterval(keepAlive); }
    console.log("Jev mocked request, image schema, tenant isolation, failure fallback, health, and overall deadline passed");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = previousKey;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
