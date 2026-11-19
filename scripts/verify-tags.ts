import assert from "node:assert/strict";
import { tagSearchText, visualTags } from "../lib/search/tags";

async function main() {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.TYPESAFE_API_KEY;
  try {
    delete process.env.TYPESAFE_API_KEY;
    assert.equal(await visualTags(new Uint8Array([1])), null);

    process.env.TYPESAFE_API_KEY = "test-key";
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.ok(body.assets[body.state.image], "image is sent as an asset");
      const answers: Record<string, { noul: number }> = {};
      for (const [id, q] of Object.entries<{ instructions: string }>(body.questions)) {
        answers[id] = { noul: /cream|red|huge, bold lettering|poster/i.test(q.instructions) ? 0.9 : /blue/.test(q.instructions) ? 0.69 : 0.1 };
      }
      return Response.json({ answers });
    };
    const tags = await visualTags(new Uint8Array([1]));
    assert.deepEqual(tags, ["cream", "red", "poster", "big lettering"], "only answers >= 0.7 become tags");
    assert.match(tagSearchText(tags!), /huge.*lettering/);

    globalThis.fetch = async () => new Response("nope", { status: 500 });
    assert.equal(await visualTags(new Uint8Array([1])), null, "provider failure is null, not []");

    // An untitled image is found by a description once its tags are indexed (keyword search only).
    delete process.env.TYPESAFE_API_KEY;
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "atelier-tags-test-"));
    process.env.ATELIER_DATA_DIR = dir;
    const { getDb, closeDb } = await import("../lib/db");
    const { indexSave, search } = await import("../lib/search");
    const db = await getDb();
    for (const [id, t] of [["cover", tags!], ["leopard", ["cream", "illustration", "animal"]]] as const) {
      await db.query(`insert into save (id, user_id, kind, title, status, tags, created_at) values ($1,'u','url','i.pinimg.com/474x/x.jpg','ready',$2,now())`, [id, t]);
      await indexSave("u", id, { title: "i.pinimg.com/474x/x.jpg", description: null, text: "Log in to see more posts.", sourceUrl: null, kind: "url", tags: t });
    }
    const query = "That cream magazine cover with the huge red lettering";
    const result = await search("u", query);
    assert.equal(result.hits[0]?.save.id, "cover");
    assert.deepEqual(result.hits[0]?.save.tags, tags);

    // Jev's per-save score combines with words matched in a different segment of that save.
    process.env.TYPESAFE_API_KEY = "test-key";
    globalThis.fetch = async (_url, init) => {
      const { state } = JSON.parse(String(init?.body));
      return Response.json({ answers: { relevant: { noul: /poster/.test(state.content) ? 0.86 : 0.1 } } });
    };
    const reranked = await search("u", query);
    assert.equal(reranked.hits[0]?.save.id, "cover");
    assert.equal(reranked.hits[0]?.matchedBy, "both");
    assert.ok(reranked.hits[0]!.score > result.hits[0]!.score, "Jev raises the keyword match");
    await closeDb();
    await rm(dir, { recursive: true, force: true });
    console.log("Visual tags: threshold, failure, synonyms and description search passed");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = previousKey;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
