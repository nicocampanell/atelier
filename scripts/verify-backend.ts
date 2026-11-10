// Backend verification for Atelier: runs checks 1-15 from docs/goals/backend.md
// and prints PASS / FAIL / SKIPPED per check.
//
// Run from the repo root:  pnpm exec tsx scripts/verify-backend.ts
// Env (optional): VERIFY_PORT (default 3210), VERIFY_DATA_DIR (default ./.data-test).
//
// It starts its own `next dev` with ATELIER_TOKEN=testtoken, a separate data dir and
// no EMBEDDING_API_KEY, stops it again, and never prints the token or file contents.
// Sub-modes used internally: --db-ownership (direct DB phase of check 14) and
// --unit (check 15); both run in their own process so the PGlite instance is fresh.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ApiResult, Board, BoardItem, Save, SearchResponse } from "../lib/types";

const ROOT = process.cwd();
const PORT = Number(process.env.VERIFY_PORT ?? 3210);
const DATA_DIR = process.env.VERIFY_DATA_DIR ?? "./.data-test";
const TOKEN = "testtoken";
const BASE = `http://127.0.0.1:${PORT}`;

type Outcome = "PASS" | "FAIL" | "SKIPPED";
const results: { n: number; name: string; outcome: Outcome; detail: string }[] = [];

class Skip extends Error {}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function check(n: number, name: string, fn: () => Promise<string | void>): Promise<void> {
  try {
    const detail = (await fn()) ?? "";
    results.push({ n, name, outcome: "PASS", detail });
    console.log(`PASS     ${n}. ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    const skipped = e instanceof Skip;
    const detail = e instanceof Error ? e.message : String(e);
    results.push({ n, name, outcome: skipped ? "SKIPPED" : "FAIL", detail });
    console.log(`${skipped ? "SKIPPED" : "FAIL   "}  ${n}. ${name} — ${detail}`);
  }
}

// ---------------------------------------------------------------- HTTP helpers

interface Res<T = unknown> {
  status: number;
  body: ApiResult<T> | null;
  raw: Response;
}

async function api<T = unknown>(
  method: string,
  p: string,
  opts: { token?: string | null; json?: unknown; form?: FormData } = {},
): Promise<Res<T>> {
  const headers: Record<string, string> = {};
  const token = opts.token === undefined ? TOKEN : opts.token;
  if (token) headers.authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form;
  }
  const raw = await fetch(BASE + p, { method, headers, body });
  let parsed: ApiResult<T> | null = null;
  const ct = raw.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) parsed = (await raw.clone().json()) as ApiResult<T>;
  return { status: raw.status, body: parsed, raw };
}

function data<T>(r: Res<T>, what: string): T {
  assert(r.body && r.body.ok, `${what}: HTTP ${r.status} ${r.body && !r.body.ok ? r.body.error.message : "(no envelope)"}`);
  return r.body.data;
}

async function waitFor(id: string, done: (s: Save) => boolean, timeoutMs = 30_000): Promise<{ save: Save; seen: string[] }> {
  const seen: string[] = [];
  const end = Date.now() + timeoutMs;
  for (;;) {
    const s = data(await api<Save>("GET", `/api/saves/${id}`), `GET save ${id}`);
    if (seen[seen.length - 1] !== s.status) seen.push(s.status);
    if (done(s)) return { save: s, seen };
    if (Date.now() > end) throw new Error(`save ${id} stuck in "${s.status}" after ${timeoutMs / 1000}s (seen: ${seen.join(" -> ")})`);
    await sleep(150);
  }
}
const settled = (s: Save) => s.status === "ready" || s.status === "failed";

// 1x1 transparent PNG
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000005000155a3d5e80000000049454e44ae426082",
  "hex",
);

function fileForm(bytes: Uint8Array, name: string, type: string, title?: string): FormData {
  const f = new FormData();
  f.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
  if (title) f.append("title", title);
  return f;
}

// ---------------------------------------------------------------- server control

let server: ChildProcess | null = null;
let serverLog = "";

async function startServer(): Promise<void> {
  const env: NodeJS.ProcessEnv = { ...process.env, ATELIER_TOKEN: TOKEN, ATELIER_DATA_DIR: DATA_DIR, PORT: String(PORT) };
  delete env.EMBEDDING_API_KEY;
  serverLog = "";
  server = spawn("pnpm", ["exec", "next", "dev", "--port", String(PORT)], {
    cwd: ROOT,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (d: Buffer) => (serverLog += d.toString()));
  server.stderr?.on("data", (d: Buffer) => (serverLog += d.toString()));
  const end = Date.now() + 120_000;
  while (Date.now() < end) {
    if (server.exitCode !== null) throw new Error(`server exited early:\n${serverLog.slice(-2000)}`);
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.status === 200) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`server did not come up on port ${PORT}:\n${serverLog.slice(-2000)}`);
}

async function stopServer(): Promise<void> {
  const s = server;
  server = null;
  if (!s || s.pid === undefined || s.exitCode !== null) return;
  const pid = s.pid;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    /* already gone */
  }
  const end = Date.now() + 10_000;
  while (s.exitCode === null && s.signalCode === null && Date.now() < end) await sleep(200);
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    /* already gone */
  }
  // wait for the port to be free
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${BASE}/api/health`);
      await sleep(200);
    } catch {
      return;
    }
  }
}

// ---------------------------------------------------------------- sub-mode: check 14 DB phase

async function dbOwnershipMode(): Promise<void> {
  // argv: --db-ownership <ownerSaveId> <ownerAssetId>
  const [ownerSaveId, ownerAssetId] = process.argv.slice(3);
  const { getDb, closeDb } = await import("../lib/db");
  const { getSave, listSaves } = await import("../lib/saves");
  const { readAsset } = await import("../lib/assets");
  const { getBoard } = await import("../lib/board");
  const { search } = await import("../lib/search/index");
  const db = await getDb();
  const intruder = "intruder";
  const now = new Date().toISOString();
  await db.query(
    `insert into save (id, user_id, kind, title, status, created_at) values ('intruder-save', $1, 'note', 'intruder secret quokkasecret', 'ready', $2)`,
    [intruder, now],
  );
  await db.query(
    `insert into asset (id, user_id, save_id, media_type, bytes, storage_path, created_at)
     values ('intruder-asset', $1, 'intruder-save', 'image/png', 1, 'assets/intruder/nope', $2)`,
    [intruder, now],
  );
  const problems: string[] = [];
  if (await getSave(intruder, ownerSaveId)) problems.push("intruder can getSave the owner's save");
  const list = await listSaves(intruder, { limit: 100, cursor: null });
  if (list.saves.some((s) => s.id !== "intruder-save")) problems.push("intruder's list contains owner saves");
  if (!list.saves.some((s) => s.id === "intruder-save")) problems.push("intruder's own save missing (insert failed?)");
  if (await readAsset(intruder, ownerAssetId)) problems.push("intruder can read the owner's asset");
  const board = await getBoard(intruder);
  if (board.items.length) problems.push("intruder board has items");
  const sr = await search(intruder, "example");
  if (sr.hits.length || sr.weaker.length) problems.push("intruder search returns owner saves");
  await closeDb();
  if (problems.length) {
    console.log(problems.join("; "));
    process.exit(1);
  }
  console.log("direct DB: intruder could not read owner save, list, asset, board or search");
  process.exit(0);
}

// ---------------------------------------------------------------- sub-mode: check 15 unit

async function unitMode(): Promise<void> {
  const { chunkText } = await import("../lib/search/chunk");
  const { zGate, rankHybrid } = await import("../lib/search/score");
  const embedMod = await import("../lib/search/embed");
  const { getDb, closeDb } = await import("../lib/db");
  const { indexSave, search } = await import("../lib/search/index");
  const notes: string[] = [];

  // chunker
  const words = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ".repeat(200);
  const chunks = chunkText(words);
  assert(chunks.length >= 5, `expected several chunks, got ${chunks.length}`);
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    assert(words.slice(c.start, c.end) === c.text, `chunk ${i} offsets don't match its text`);
    if (i < chunks.length - 1) {
      assert(c.text.length >= 1600 && c.text.length <= 2000, `chunk ${i} length ${c.text.length} not ~1800`);
      const overlap = c.end - chunks[i + 1].start;
      assert(overlap >= 150 && overlap <= 250, `overlap ${i}->${i + 1} is ${overlap}, not ~200`);
    }
  }
  assert(chunkText("").length === 0, "empty text should give no chunks");
  notes.push(`chunks ${chunks.length}, len ${chunks[0].text.length}, overlap ${chunks[0].end - chunks[1].start}`);

  // z-score gate on random vectors (seeded LCG so the run is deterministic)
  let seed = 42;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  const vec = (d: number) => Array.from({ length: d }, rnd);
  const cos = (a: number[], b: number[]) => {
    let d = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
    return d / Math.sqrt(na * nb);
  };
  let fired = 0;
  for (let t = 0; t < 50; t++) {
    const q = vec(256);
    const sims = Array.from({ length: 200 }, () => cos(q, vec(256)));
    if (zGate(sims).length) fired++;
  }
  assert(fired === 0, `zGate let through random vectors in ${fired}/50 trials`);
  notes.push("zGate: 0/50 random trials passed");

  // hybrid ranker
  const ranked = rankHybrid(
    [
      { id: "weak-meaning", meaning: 0.3, coverage: 0 },
      { id: "exact-word", meaning: 0, coverage: 1 },
    ],
    "quokka",
  );
  assert(ranked[0]?.id === "exact-word", `ranker put ${ranked[0]?.id} first`);
  notes.push("exact word outranks weak meaning");

  // fake embed(): vector path used and location returned
  const D = 64;
  const groups: Record<string, number> = { dog: 1, puppy: 1, hound: 1, canine: 1, car: 2, truck: 2, ocean: 3, sea: 3, wave: 3, bread: 4, cake: 4, piano: 5, violin: 5 };
  const hash = (w: string) => [...w].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  embedMod.setEmbedderForTests((input) => {
    if (!("text" in input)) return null;
    const v = new Array<number>(D).fill(0);
    for (const w of input.text.toLowerCase().match(/[a-z]+/g) ?? []) {
      const g = groups[w];
      if (g) v[g] += 3;
      else v[8 + (hash(w) % (D - 8))] += 0.2;
    }
    return v;
  });
  assert(embedMod.isSemanticEnabled(), "isSemanticEnabled() should be true with a fake embedder");
  const db = await getDb();
  const docs: [string, string][] = [
    ["s-dog", "A loyal hound sleeping by the fire."],
    ["s-car", "A red truck parked on the street."],
    ["s-sea", "Big wave on the open sea at sunset."],
    ["s-bread", "Fresh cake from the corner bakery."],
    ["s-music", "An old violin in a velvet case."],
    ["s-misc1", "Notes about quarterly planning meetings."],
    ["s-misc2", "Typography specimen with serif letters."],
  ];
  const now = Date.now();
  for (let i = 0; i < docs.length; i++) {
    const [id, text] = docs[i];
    await db.query(`insert into save (id, user_id, kind, title, status, created_at) values ($1, 'owner', 'note', $2, 'ready', $3)`, [
      id,
      `Note ${i}`,
      new Date(now - i * 1000).toISOString(),
    ]);
    await indexSave("owner", id, { title: `Note ${i}`, description: null, text, sourceUrl: null, kind: "note" });
  }
  const r = await search("owner", "puppy");
  const top = r.hits[0];
  assert(r.semantic, "semantic should be true with the fake embedder");
  assert(top, `meaning query "puppy" returned no hits (weaker: ${r.weaker.length})`);
  assert(top.save.id === "s-dog", `top hit for "puppy" is ${top.save.id}, expected s-dog`);
  assert(top.matchedBy === "meaning" || top.matchedBy === "both", `matchedBy is ${top.matchedBy}`);
  assert(top.location && typeof top.location.start === "number", "hit has no location");
  notes.push(`fake embed: "puppy" -> s-dog by ${top.matchedBy}, location ${JSON.stringify(top.location)}`);
  embedMod.setEmbedderForTests(null);
  await closeDb();
  console.log(notes.join("; "));
  process.exit(0);
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  console.log(`verify-backend: port ${PORT}, data dir ${DATA_DIR}\n`);
  rmSync(path.resolve(ROOT, DATA_DIR), { recursive: true, force: true });

  await check(1, "pnpm typecheck", async () => {
    const r = spawnSync("pnpm", ["typecheck"], { cwd: ROOT, encoding: "utf8" });
    assert(r.status === 0, `exit ${r.status}\n${(r.stdout + r.stderr).trim().split("\n").slice(-15).join("\n")}`);
    return "exit 0";
  });

  try {
    await startServer();
  } catch (e) {
    console.log(`FAIL     server start — ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
    return;
  }

  // State shared between checks.
  let exampleId: string | null = null;
  let exampleReady = false;
  let pngSaveId: string | null = null;
  let pngAssetPath = null as string | null;
  let textSaveId: string | null = null;
  let boardSent: Board | null = null;

  await check(2, "GET /api/health without a token", async () => {
    const r = await api<{ semantic: boolean }>("GET", "/api/health", { token: null });
    assert(r.status === 200, `HTTP ${r.status}`);
    const d = data(r, "health");
    assert(d.semantic === false, `semantic is ${d.semantic}`);
    return "200, semantic:false";
  });

  await check(3, "Other routes without / with a wrong token -> 401", async () => {
    const routes: [string, string, unknown?][] = [
      ["GET", "/api/saves"],
      ["POST", "/api/saves", { url: "https://example.com" }],
      ["GET", "/api/saves/abc"],
      ["DELETE", "/api/saves/abc"],
      ["POST", "/api/saves/abc/retry"],
      ["GET", "/api/assets/abc"],
      ["GET", "/api/assets/abc?token=wrong"],
      ["GET", "/api/search?q=x"],
      ["GET", "/api/board"],
      ["PUT", "/api/board", { id: "b", items: [], camera: { x: 0, y: 0, zoom: 1 } }],
    ];
    const bad: string[] = [];
    for (const [m, p, j] of routes) {
      for (const token of [null, "wrong-token"]) {
        const r = await api(m, p, { token, json: j });
        if (r.status !== 401) bad.push(`${m} ${p} (${token ? "wrong" : "none"}) -> ${r.status}`);
      }
    }
    assert(bad.length === 0, bad.join(", "));
    return `${routes.length * 2} requests all 401`;
  });

  await check(4, "POST /api/saves public https URL -> accepted -> ready/failed", async () => {
    const r = await api<Save>("POST", "/api/saves", { json: { url: "https://example.com/" } });
    const s = data(r, "POST url");
    assert(s.status === "accepted", `initial status ${s.status}`);
    exampleId = s.id;
    const { save, seen } = await waitFor(s.id, settled);
    if (save.status === "ready") {
      assert(save.title && save.title !== "example.com", `title not filled from the page: "${save.title}"`);
      exampleReady = true;
      return `${seen.join(" -> ")}, title "${save.title}"`;
    }
    assert(save.error && save.error.length > 5, "failed without a readable error");
    if (/find that site|connect|secure connection|too long/i.test(save.error)) {
      throw new Skip(`network unavailable: failed with "${save.error}"`);
    }
    return `${seen.join(" -> ")}, error "${save.error}"`;
  });

  await check(5, "Same URL saved twice -> duplicateOf", async () => {
    assert(exampleId, "no first save from check 4");
    const s = data(await api<Save>("POST", "/api/saves", { json: { url: "https://example.com" } }), "POST dup");
    assert(s.duplicateOf === exampleId, `duplicateOf is ${s.duplicateOf}, expected ${exampleId}`);
    await waitFor(s.id, settled);
    // Delete the duplicate so later search checks see one example.com save.
    data(await api("DELETE", `/api/saves/${s.id}`), "delete dup");
    return `duplicateOf ${exampleId}`;
  });

  await check(6, "Private / non-http URLs refused (incl. DNS and redirect to private)", async () => {
    const literal = ["http://127.0.0.1", "http://localhost", "http://169.254.169.254/latest/meta-data/", "http://[::1]", "file:///etc/passwd", "http://2130706433/", "http://[::ffff:127.0.0.1]/"];
    const notes: string[] = [];
    for (const url of literal) {
      const r = await api<Save>("POST", "/api/saves", { json: { url } });
      assert(r.status >= 400 && r.status < 500, `${url} -> HTTP ${r.status} (not refused)`);
      assert(r.body && !r.body.ok && r.body.error.message.length > 5, `${url} refused without a clear message`);
    }
    notes.push(`${literal.length} literal URLs -> 4xx`);
    // DNS name that resolves to 127.0.0.1: refused up front or fails with a private-network error.
    const viaDns = async (url: string): Promise<string> => {
      const r = await api<Save>("POST", "/api/saves", { json: { url } });
      if (r.status >= 400) return "refused up front";
      const s = data(r, url);
      const { save } = await waitFor(s.id, settled);
      assert(save.status === "failed", `${url} reached "${save.status}"`);
      assert(/private/i.test(save.error ?? ""), `${url} failed with "${save.error}" (not a private-address refusal)`);
      data(await api("DELETE", `/api/saves/${s.id}`), "cleanup");
      return `failed: "${save.error}"`;
    };
    notes.push(`localtest.me ${await viaDns("http://localtest.me/")}`);
    // Public redirector that 302s to http://127.0.0.1/
    const redirectors = [
      "https://postman-echo.com/redirect-to?url=http%3A%2F%2F127.0.0.1%2F",
      "https://httpbin.org/redirect-to?url=http%3A%2F%2F127.0.0.1%2F",
    ];
    let redirectNote: string | null = null;
    for (const u of redirectors) {
      try {
        const probe = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(8000) });
        if (probe.status < 300 || probe.status >= 400) continue;
      } catch {
        continue;
      }
      redirectNote = `redirect ${new URL(u).host} -> 127.0.0.1 ${await viaDns(u)}`;
      break;
    }
    if (!redirectNote) throw new Skip(`${notes.join("; ")}; but no public redirector reachable to test redirect-to-private`);
    notes.push(redirectNote);
    return notes.join("; ");
  });

  await check(7, "Multipart PNG upload, asset round-trip; exe and oversized refused", async () => {
    const s = data(await api<Save>("POST", "/api/saves", { form: fileForm(PNG, "dot.png", "image/png", "Tiny dot") }), "upload png");
    assert(s.kind === "image", `kind ${s.kind}`);
    assert(s.asset && s.asset.mediaType === "image/png" && s.asset.bytes === PNG.length, `asset meta ${JSON.stringify(s.asset)}`);
    assert(s.previewUrl && s.previewUrl.startsWith("/api/assets/"), `previewUrl ${s.previewUrl}`);
    pngSaveId = s.id;
    pngAssetPath = s.previewUrl;
    await waitFor(s.id, settled);
    const a = await fetch(BASE + s.previewUrl, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert(a.status === 200, `asset HTTP ${a.status}`);
    assert((a.headers.get("content-type") ?? "").startsWith("image/png"), `content-type ${a.headers.get("content-type")}`);
    const bytes = Buffer.from(await a.arrayBuffer());
    assert(bytes.equals(PNG), "asset bytes differ from upload");
    const q = await fetch(`${BASE}${s.previewUrl}?token=${TOKEN}`);
    assert(q.status === 200, `?token= asset HTTP ${q.status}`);
    const noTok = await fetch(BASE + s.previewUrl);
    assert(noTok.status === 401, `asset without token -> ${noTok.status}`);

    const exe = Buffer.concat([Buffer.from("MZ\x90\x00\x03\x00\x00\x00", "binary"), Buffer.alloc(512)]);
    const e = await api("POST", "/api/saves", { form: fileForm(exe, "setup.exe", "image/png") });
    assert(e.status === 415 || e.status === 400, `exe disguised as png -> HTTP ${e.status}`);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const sv = await api("POST", "/api/saves", { form: fileForm(svg, "x.svg", "image/svg+xml") });
    assert(sv.status === 415 || sv.status === 400, `svg -> HTTP ${sv.status}`);
    const big = Buffer.concat([PNG, Buffer.alloc(26 * 1024 * 1024)]);
    const b = await api("POST", "/api/saves", { form: fileForm(big, "big.png", "image/png") });
    assert(b.status === 413, `26 MB upload -> HTTP ${b.status}`);
    return "kind image, bytes identical, image/png; exe 415, svg 415, 26 MB 413";
  });

  await check(8, "GET /api/saves newest first, pagination, deleted disappear", async () => {
    const made: string[] = [];
    for (let i = 0; i < 4; i++) {
      const s = data(await api<Save>("POST", "/api/saves", { json: { note: `pagination note ${i}` } }), "note");
      made.push(s.id);
      await sleep(15);
    }
    const all: Save[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const q: string = cursor ? `/api/saves?limit=2&cursor=${encodeURIComponent(cursor)}` : "/api/saves?limit=2";
      const page: { saves: Save[]; next: string | null } = data(await api<{ saves: Save[]; next: string | null }>("GET", q), "list");
      assert(page.saves.length <= 2, `page has ${page.saves.length} > limit`);
      all.push(...page.saves);
      cursor = page.next;
      pages++;
      assert(pages < 50, "pagination does not terminate");
    } while (cursor);
    const ids = all.map((s) => s.id);
    assert(new Set(ids).size === ids.length, "duplicate saves across pages");
    for (let i = 1; i < all.length; i++) {
      assert(all[i - 1].createdAt >= all[i].createdAt, `not newest first at index ${i}`);
    }
    assert(ids[0] === made[3], `newest save is ${ids[0]}, expected the last note ${made[3]}`);
    for (const id of made) assert(ids.includes(id), `note ${id} missing from list`);
    data(await api("DELETE", `/api/saves/${made[1]}`), "delete");
    const after = data(await api<{ saves: Save[]; next: string | null }>("GET", "/api/saves?limit=100"), "list after delete");
    assert(!after.saves.some((s) => s.id === made[1]), "deleted save still listed");
    return `${all.length} saves over ${pages} pages, newest first; deleted one gone`;
  });

  await check(9, "DELETE then GET: gone from saves, search and board", async () => {
    const text = Buffer.from("Field notes on the zorblaxian quokka migration across the dunes.\n");
    const s = data(await api<Save>("POST", "/api/saves", { form: fileForm(text, "notes.txt", "text/plain", "Dune notes") }), "upload txt");
    await waitFor(s.id, (x) => x.status === "ready");
    const before = data(await api<SearchResponse>("GET", "/api/search?q=zorblaxian"), "search before");
    assert(before.hits.some((h) => h.save.id === s.id), "uploaded text not findable before delete (search broken?)");
    const board = data(await api<Board>("GET", "/api/board"), "get board");
    const items: BoardItem[] = [{ id: "del-item", type: "save", saveId: s.id, text: null, x: 1, y: 2, w: 3, h: 4, z: 1 }];
    data(await api<Board>("PUT", "/api/board", { json: { ...board, items } }), "put board");
    data(await api("DELETE", `/api/saves/${s.id}`), "delete");
    const g = await api("GET", `/api/saves/${s.id}`);
    assert(g.status === 404, `GET deleted save -> ${g.status}`);
    const after = data(await api<SearchResponse>("GET", "/api/search?q=zorblaxian"), "search after");
    assert(![...after.hits, ...after.weaker].some((h) => h.save.id === s.id), "deleted save still in search");
    const b2 = data(await api<Board>("GET", "/api/board"), "board after");
    assert(!b2.items.some((i) => i.saveId === s.id), "deleted save still on board");
    const d2 = await api("DELETE", `/api/saves/${s.id}`);
    assert(d2.status === 404, `second DELETE -> ${d2.status}`);
    return "404 after delete, absent from search and board";
  });

  await check(10, "POST /api/saves/:id/retry on a failed save", async () => {
    const s = data(await api<Save>("POST", "/api/saves", { json: { url: "https://atelier-verify-nonexistent.invalid/" } }), "post bad host");
    const first = await waitFor(s.id, settled);
    assert(first.save.status === "failed", `expected failed, got ${first.save.status}`);
    const rr = data(await api<Save>("POST", `/api/saves/${s.id}/retry`), "retry");
    assert(rr.status === "accepted" || rr.status === "processing", `retry returned status ${rr.status}`);
    const second = await waitFor(s.id, settled);
    const notFailed = await api("POST", `/api/saves/${pngSaveId}/retry`);
    assert(notFailed.status === 409 || notFailed.status === 400, `retry on a ready save -> ${notFailed.status}`);
    data(await api("DELETE", `/api/saves/${s.id}`), "cleanup");
    return `failed -> retry returned "${rr.status}" -> ${second.seen.join(" -> ")} ("${second.save.error}"); retry on ready save -> ${notFailed.status}`;
  });

  await check(11, "GET /api/search keyword hits, unrelated query empty, shape", async () => {
    const t = Buffer.from("Moodboard brief: brutalist concrete staircases and terrazzo floors in Lisbon.\n");
    const s = data(await api<Save>("POST", "/api/saves", { form: fileForm(t, "brief.txt", "text/plain", "Lisbon brief") }), "upload");
    textSaveId = s.id;
    await waitFor(s.id, (x) => x.status === "ready");
    const shape = (r: SearchResponse, q: string) => {
      assert(r.query === q, `query echo "${r.query}"`);
      assert(Array.isArray(r.hits) && Array.isArray(r.weaker) && typeof r.semantic === "boolean", "bad SearchResponse shape");
      for (const h of [...r.hits, ...r.weaker]) {
        assert(h.save && typeof h.save.id === "string" && typeof h.score === "number", "bad hit");
        assert(["meaning", "words", "both"].includes(h.matchedBy), `bad matchedBy ${h.matchedBy}`);
        assert(h.location === null || ["page", "second", "chunk"].includes(h.location.kind), "bad location");
      }
    };
    const notes: string[] = [];
    const byText = data(await api<SearchResponse>("GET", "/api/search?q=terrazzo"), "search body word");
    shape(byText, "terrazzo");
    assert(byText.hits[0]?.save.id === s.id, "word in page text not found as top hit");
    notes.push(`"terrazzo" -> top hit by ${byText.hits[0].matchedBy}`);
    const byTitle = data(await api<SearchResponse>("GET", `/api/search?q=${encodeURIComponent("Lisbon brief")}`), "search title");
    assert(byTitle.hits.some((h) => h.save.id === s.id), "title search missed");
    notes.push(`"Lisbon brief" found`);
    if (exampleReady) {
      const ex = data(await api<SearchResponse>("GET", "/api/search?q=example"), "search example");
      assert(ex.hits.some((h) => h.save.id === exampleId), "example.com not found by its title word");
      const exBody = data(await api<SearchResponse>("GET", "/api/search?q=documentation"), "search example body");
      assert(exBody.hits.some((h) => h.save.id === exampleId), "example.com not found by a word in its page text");
      notes.push(`example.com found by title and body word`);
    }
    const none = data(await api<SearchResponse>("GET", `/api/search?q=${encodeURIComponent("zzqxv platypus helicopter")}`), "unrelated");
    shape(none, "zzqxv platypus helicopter");
    assert(none.hits.length === 0 && none.weaker.length === 0, `unrelated query returned ${none.hits.length}+${none.weaker.length} hits`);
    assert(none.semantic === false, "semantic should be false without a key");
    notes.push("unrelated -> 0 hits");
    return notes.join("; ");
  });

  await check(12, "PUT /api/board then GET round-trips; deleted-save items dropped", async () => {
    assert(pngSaveId && textSaveId, "needs saves from checks 7 and 11");
    const gone = data(await api<Save>("POST", "/api/saves", { json: { note: "to be deleted" } }), "note");
    const current = data(await api<Board>("GET", "/api/board"), "get");
    const items: BoardItem[] = [
      { id: "n1", type: "note", saveId: null, text: "Hello board ✓", x: 10.5, y: -20.25, w: 200, h: 120, z: 3 },
      { id: "s1", type: "save", saveId: pngSaveId, text: null, x: 300, y: 40, w: 160, h: 160, z: 1 },
      { id: "s2", type: "save", saveId: textSaveId, text: null, x: -1e3, y: 1234.5678, w: 240, h: 90, z: 2 },
    ];
    const sent: Board = { id: current.id, items, camera: { x: -150.5, y: 42, zoom: 1.75 } };
    const put = data(await api<Board>("PUT", "/api/board", { json: sent }), "put");
    const got = data(await api<Board>("GET", "/api/board"), "get after put");
    assert(JSON.stringify(got) === JSON.stringify(put), "GET differs from PUT response");
    assert(JSON.stringify(got.items) === JSON.stringify(items), `items differ:\n sent ${JSON.stringify(items)}\n got  ${JSON.stringify(got.items)}`);
    assert(JSON.stringify(got.camera) === JSON.stringify(sent.camera), "camera differs");
    // item pointing to a deleted save is dropped
    const withGone: Board = { ...sent, items: [...items, { id: "g1", type: "save", saveId: gone.id, text: null, x: 0, y: 0, w: 1, h: 1, z: 9 }] };
    data(await api<Board>("PUT", "/api/board", { json: withGone }), "put with soon-deleted");
    data(await api("DELETE", `/api/saves/${gone.id}`), "delete");
    const afterDel = data(await api<Board>("GET", "/api/board"), "get after delete");
    assert(JSON.stringify(afterDel.items) === JSON.stringify(items), "item for deleted save not dropped");
    const bogus: Board = { ...sent, items: [...items, { id: "g2", type: "save", saveId: "does-not-exist", text: null, x: 0, y: 0, w: 1, h: 1, z: 9 }] };
    const pb = await api<Board>("PUT", "/api/board", { json: bogus });
    if (pb.body?.ok) assert(!pb.body.data.items.some((i) => i.id === "g2"), "item for unknown save kept");
    const bad = await api("PUT", "/api/board", { json: { ...sent, items: [{ ...items[0], x: "nope" }] } });
    assert(bad.status === 400, `invalid board -> ${bad.status}`);
    data(await api<Board>("PUT", "/api/board", { json: sent }), "restore");
    boardSent = { ...sent, id: got.id };
    return "exact round-trip; deleted and unknown save items dropped; invalid body 400";
  });

  // ---- checks 13 + 14: stop server, direct DB ownership phase, restart.
  const savesBefore = data(await api<{ saves: Save[]; next: string | null }>("GET", "/api/saves?limit=100"), "list before restart").saves;
  const boardBefore = data(await api<Board>("GET", "/api/board"), "board before restart");
  await stopServer();

  const ownerAssetId = pngAssetPath ? pngAssetPath.split("/").pop() ?? "" : "";
  const own = spawnSync("pnpm", ["exec", "tsx", path.join(ROOT, "scripts/verify-backend.ts"), "--db-ownership", pngSaveId ?? "", ownerAssetId], {
    cwd: ROOT,
    env: { ...process.env, ATELIER_DATA_DIR: DATA_DIR, EMBEDDING_API_KEY: "" },
    encoding: "utf8",
    timeout: 120_000,
  });
  const ownOut = `${own.stdout ?? ""}${own.stderr ?? ""}`.trim().split("\n").slice(-5).join(" | ");

  let restarted = true;
  try {
    await startServer();
  } catch (e) {
    restarted = false;
    console.log(`FAIL     server restart — ${e instanceof Error ? e.message : e}`);
  }

  await check(13, "Restart: saves, assets and board persist", async () => {
    assert(restarted, "server did not restart");
    const after = data(await api<{ saves: Save[]; next: string | null }>("GET", "/api/saves?limit=100"), "list after").saves;
    const ownerAfter = after.filter((s) => s.id !== "intruder-save");
    assert(JSON.stringify(ownerAfter.map((s) => s.id)) === JSON.stringify(savesBefore.map((s) => s.id)), "save list changed across restart");
    assert(pngAssetPath, "no asset from check 7");
    const a = await fetch(BASE + pngAssetPath, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert(a.status === 200 && Buffer.from(await a.arrayBuffer()).equals(PNG), `asset after restart HTTP ${a.status} / bytes differ`);
    const b = data(await api<Board>("GET", "/api/board"), "board after");
    assert(JSON.stringify(b) === JSON.stringify(boardBefore), "board changed across restart");
    assert(boardSent && JSON.stringify(b.items) === JSON.stringify(boardSent.items), "board items differ from what was PUT");
    return `${ownerAfter.length} saves, PNG bytes and board identical after restart`;
  });

  await check(14, "Ownership: second user id cannot read owner data (and vice versa)", async () => {
    assert(own.status === 0, `direct DB phase failed: ${ownOut}`);
    assert(restarted, "server did not restart");
    const notes = [ownOut];
    const g = await api("GET", "/api/saves/intruder-save");
    assert(g.status === 404, `owner token GET intruder save -> ${g.status}`);
    const l = data(await api<{ saves: Save[]; next: string | null }>("GET", "/api/saves?limit=100"), "list");
    assert(!l.saves.some((s) => s.id === "intruder-save"), "owner list shows intruder save");
    const a = await api("GET", "/api/assets/intruder-asset");
    assert(a.status === 404, `owner token GET intruder asset -> ${a.status}`);
    const d = await api("DELETE", "/api/saves/intruder-save");
    assert(d.status === 404, `owner token DELETE intruder save -> ${d.status}`);
    const sr = data(await api<SearchResponse>("GET", "/api/search?q=quokkasecret"), "search");
    assert(![...sr.hits, ...sr.weaker].some((h) => h.save.id === "intruder-save"), "owner search shows intruder save");
    const pb = await api<Board>("PUT", "/api/board", {
      json: { ...(boardSent as Board), items: [{ id: "x", type: "save", saveId: "intruder-save", text: null, x: 0, y: 0, w: 1, h: 1, z: 1 }] },
    });
    if (pb.body?.ok) assert(!pb.body.data.items.some((i) => i.saveId === "intruder-save"), "owner board accepted intruder save item");
    data(await api<Board>("PUT", "/api/board", { json: boardSent }), "restore board");
    notes.push("API: intruder save/asset 404, not listed, not searchable, not placeable");
    return notes.join("; ");
  });

  await check(15, "Search internals (chunker, z-gate, hybrid ranker, fake embed)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "atelier-unit-"));
    try {
      const r = spawnSync("pnpm", ["exec", "tsx", path.join(ROOT, "scripts/verify-backend.ts"), "--unit"], {
        cwd: ROOT,
        env: { ...process.env, ATELIER_DATA_DIR: dir, EMBEDDING_API_KEY: "" },
        encoding: "utf8",
        timeout: 120_000,
      });
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-6).join(" | ");
      assert(r.status === 0, out);
      return out;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await stopServer();

  const count = (o: Outcome) => results.filter((r) => r.outcome === o).length;
  console.log(`\nSummary: ${count("PASS")} passed, ${count("FAIL")} failed, ${count("SKIPPED")} skipped (of 15)`);
  if (count("FAIL") || results.length < 15) process.exitCode = 1;
}

const mode = process.argv[2];
const run = mode === "--db-ownership" ? dbOwnershipMode : mode === "--unit" ? unitMode : main;
run().catch(async (e) => {
  console.error(`verify-backend crashed: ${e instanceof Error ? e.stack ?? e.message : e}`);
  await stopServer();
  process.exit(1);
});
process.on("SIGINT", () => {
  void stopServer().then(() => process.exit(130));
});
