// Verification for multi-project support: checks P1-P12 from docs/goals/extension.md.
// Run from the repo root:  pnpm exec tsx scripts/verify-projects.ts
// Starts its own `next dev` (port 3220, NEXT_DIST_DIR=.next-verify-projects, data dir
// ./.data-verify-projects wiped at start). Never prints tokens or file contents.
// Sub-modes (own processes so PGlite is fresh): --db-ownership, --migrate-make, --migrate-check.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import type { ApiResult, Board, BoardItem, Project, Save, SaveCreated } from "../lib/types";

const ROOT = process.cwd();
const PORT = 3220;
const DATA_DIR = "./.data-verify-projects";
const MIGRATE_DIR = "./.data-verify-projects-old";
const BACKEND_DATA_DIR = "./.data-verify-backend";
const DIST_DIR = ".next-verify-projects";
const TOKEN = "testtoken";
const ORIGIN = "chrome-extension://abcdefghijklmnop";
const BASE = `http://127.0.0.1:${PORT}`;

type Outcome = "PASS" | "FAIL" | "SKIPPED";
const results: { n: number; outcome: Outcome }[] = [];
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function check(n: number, name: string, fn: () => Promise<string | void>): Promise<void> {
  try {
    const detail = (await fn()) ?? "";
    results.push({ n, outcome: "PASS" });
    console.log(`PASS     P${n}. ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    results.push({ n, outcome: "FAIL" });
    console.log(`FAIL     P${n}. ${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

interface Res<T = unknown> {
  status: number;
  body: ApiResult<T> | null;
  raw: Response;
}
async function api<T = unknown>(
  method: string,
  p: string,
  opts: { token?: string | null; json?: unknown; form?: FormData; headers?: Record<string, string> } = {},
): Promise<Res<T>> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const token = opts.token === undefined ? TOKEN : opts.token;
  if (token) headers.authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) body = opts.form;
  const raw = await fetch(BASE + p, { method, headers, body });
  let parsed: ApiResult<T> | null = null;
  if ((raw.headers.get("content-type") ?? "").includes("application/json")) parsed = (await raw.clone().json()) as ApiResult<T>;
  return { status: raw.status, body: parsed, raw };
}
function data<T>(r: Res<T>, what: string): T {
  assert(r.body && r.body.ok, `${what}: HTTP ${r.status} ${r.body && !r.body.ok ? r.body.error.message : "(no envelope)"}`);
  return r.body.data;
}
function errCode(r: Res): string | null {
  return r.body && !r.body.ok ? r.body.error.code : null;
}

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000005000155a3d5e80000000049454e44ae426082",
  "hex",
);
function pngForm(extra: Record<string, string> = {}): FormData {
  const f = new FormData();
  f.append("file", new Blob([new Uint8Array(PNG)], { type: "image/png" }), "pic.png");
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return f;
}

let server: ChildProcess | null = null;
let serverLog = "";
async function startServer(): Promise<void> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ATELIER_TOKEN: TOKEN,
    ATELIER_DATA_DIR: DATA_DIR,
    ATELIER_ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173`,
    NEXT_DIST_DIR: DIST_DIR,
    PORT: String(PORT),
  };
  delete env.EMBEDDING_API_KEY;
  serverLog = "";
  server = spawn("pnpm", ["exec", "next", "dev", "--port", String(PORT)], { cwd: ROOT, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout?.on("data", (d: Buffer) => (serverLog += d.toString()));
  server.stderr?.on("data", (d: Buffer) => (serverLog += d.toString()));
  const end = Date.now() + 120_000;
  while (Date.now() < end) {
    if (server.exitCode !== null) throw new Error(`server exited early:\n${serverLog.slice(-2000)}`);
    try {
      if ((await fetch(`${BASE}/api/health`)).status === 200) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`server did not come up:\n${serverLog.slice(-2000)}`);
}
async function stopServer(): Promise<void> {
  const s = server;
  server = null;
  if (!s || s.pid === undefined || s.exitCode !== null) return;
  try {
    process.kill(-s.pid, "SIGTERM");
  } catch {
    /* gone */
  }
  const end = Date.now() + 10_000;
  while (s.exitCode === null && s.signalCode === null && Date.now() < end) await sleep(200);
  try {
    process.kill(-s.pid, "SIGKILL");
  } catch {
    /* gone */
  }
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${BASE}/api/health`);
      await sleep(200);
    } catch {
      return;
    }
  }
}

// ---------------------------------------------------------------- sub-modes

async function dbOwnershipMode(): Promise<void> {
  // argv: --db-ownership <ownerProjectId>
  const ownerPid = process.argv[3];
  const { closeDb, getDb } = await import("../lib/db");
  const { listProjects, getProject, renameProject, deleteProject, createProject, assertProject } = await import("../lib/projects");
  const { getBoard, putBoard } = await import("../lib/board");
  const { createUrlSave } = await import("../lib/saves");
  const intruder = "intruder";
  const notes: string[] = [];
  const must404 = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      const err = e as { status?: number; code?: string };
      if (err.status === 404 && err.code === "project_not_found") return;
      throw new Error(`${what}: threw ${String(e)}`);
    }
    throw new Error(`${what}: intruder was allowed`);
  };
  const mine = await createProject(intruder, "Intruder board");
  const list = await listProjects(intruder);
  if (list.some((p) => p.id === ownerPid)) throw new Error("intruder list shows owner project");
  if (!list.some((p) => p.id === mine.id)) throw new Error("intruder cannot list own project");
  if ((await getProject(intruder, ownerPid)) !== null) throw new Error("intruder read owner project");
  await must404("rename", () => renameProject(intruder, ownerPid, "pwned"));
  await must404("delete", () => deleteProject(intruder, ownerPid));
  await must404("get board", () => getBoard(intruder, ownerPid));
  await must404("put board", () => putBoard(intruder, { camera: { x: 0, y: 0, zoom: 1 }, items: [] }, ownerPid));
  await must404("assert", () => assertProject(intruder, ownerPid));
  const db = await getDb();
  const before = (await db.query<{ n: number | string }>(`select count(*) as n from save where user_id = $1`, [intruder])).rows[0].n;
  await must404("place", () => createUrlSave(intruder, { url: new URL("https://example.com/x") }, { projectId: ownerPid }));
  const after = (await db.query<{ n: number | string }>(`select count(*) as n from save where user_id = $1`, [intruder])).rows[0].n;
  if (Number(before) !== Number(after)) throw new Error("rejected placement still created a save");
  const items = (await db.query(`select 1 from board_item where user_id = $1`, [intruder])).rows.length;
  if (items !== 0) throw new Error("intruder has board items");
  notes.push("intruder: list/read/rename/delete/board get+put/place all refused, nothing saved");
  console.log(notes.join("; "));
  await closeDb();
}

const OLD_SCHEMA = `
create table save (id text primary key, user_id text not null, kind text not null, source_url text, normalized_url text,
  title text not null, title_user boolean not null default false, description text, preview_url text, status text not null,
  error text, duplicate_of text, note text, created_at timestamptz not null default now(), deleted_at timestamptz, extracted_text text);
create table board (id text primary key, user_id text not null unique, camera jsonb not null);
create table board_item (id text not null, user_id text not null, board_id text not null, pos integer not null default 0,
  type text not null, save_id text, text text, x double precision not null, y double precision not null,
  w double precision not null, h double precision not null, z double precision not null, primary key (user_id, id));
`;

async function migrateMakeMode(): Promise<void> {
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = path.join(path.resolve(process.env.ATELIER_DATA_DIR!), "db");
  mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir);
  await db.waitReady;
  await db.exec(OLD_SCHEMA);
  await db.query(`insert into save (id, user_id, kind, source_url, title, status) values ('old-save','owner','url','https://example.com/old','Old','ready')`);
  await db.query(`insert into board (id, user_id, camera) values ('old-board','owner','{"x":5,"y":6,"zoom":2}'::jsonb)`);
  await db.query(
    `insert into board_item (id, user_id, board_id, pos, type, save_id, text, x, y, w, h, z) values
     ('oi1','owner','old-board',0,'save','old-save',null,10,20,300,200,1),
     ('oi2','owner','old-board',1,'note',null,'hello',400,20,100,100,2)`,
  );
  await db.close();
}

async function migrateCheckMode(): Promise<void> {
  // argv: --migrate-check <expectItems: number|any>
  const expect = process.argv[3];
  const { closeDb } = await import("../lib/db");
  const { listProjects } = await import("../lib/projects");
  const { getBoard } = await import("../lib/board");
  const { listSaves } = await import("../lib/saves");
  const out: string[] = [];
  for (let round = 0; round < 2; round++) {
    // second round: a fresh open of the already-migrated dir would need a new process; same-process re-run is checked via exec below
    const projects = await listProjects("owner");
    if (projects.length < 1) throw new Error("no default project after migration");
    const board = await getBoard("owner");
    if (expect !== "any") {
      if (projects.length !== 1) throw new Error(`expected 1 project, got ${projects.length}`);
      if (projects[0].name !== "Moodboard") throw new Error(`default name ${projects[0].name}`);
      if (board.id !== "old-board") throw new Error("default project is not the old board");
      if (board.items.map((i) => i.id).join() !== "oi1,oi2") throw new Error("old items missing");
      if (board.camera.zoom !== 2) throw new Error("old camera lost");
      if (projects[0].itemCount !== 2) throw new Error(`itemCount ${projects[0].itemCount}`);
    }
    if (round === 0) {
      const { getDb } = await import("../lib/db");
      const db = await getDb();
      // re-running the migration statements must be a no-op
      const src = (await import("node:fs")).readFileSync(path.join(ROOT, "lib/db.ts"), "utf8");
      const m = /const MIGRATE = `([\s\S]*?)`;/.exec(src);
      if (!m) throw new Error("MIGRATE not found");
      await db.exec(m[1]);
    }
    out.push(`round${round + 1} ok`);
  }
  const l = await listSaves("owner", { limit: 100 });
  out.push(`${l.saves.length} saves readable`);
  console.log(out.join(", "));
  await closeDb();
}

function sub(args: string[], env: Record<string, string>) {
  const r = spawnSync("pnpm", ["exec", "tsx", path.join(ROOT, "scripts/verify-projects.ts"), ...args], {
    cwd: ROOT,
    env: { ...process.env, EMBEDDING_API_KEY: "", ...env },
    encoding: "utf8",
    timeout: 120_000,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-4).join(" | ");
  return { ok: r.status === 0, out };
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  rmSync(DATA_DIR, { recursive: true, force: true });
  rmSync(MIGRATE_DIR, { recursive: true, force: true });

  await check(1, "pnpm typecheck", async () => {
    const r = spawnSync("pnpm", ["typecheck"], { cwd: ROOT, encoding: "utf8", timeout: 300_000 });
    assert(r.status === 0, `${r.stdout}${r.stderr}`.slice(-1500));
    return "exit 0";
  });

  await startServer();

  let defaultProject!: Project;
  await check(2, "GET /api/projects on a fresh data dir -> one default project", async () => {
    const { projects } = data(await api<{ projects: Project[] }>("GET", "/api/projects"), "list");
    assert(projects.length === 1, `expected 1 project, got ${projects.length}`);
    const p = projects[0];
    assert(typeof p.id === "string" && p.id && p.name === "Moodboard", `bad id/name ${p.name}`);
    assert(p.itemCount === 0 && p.coverUrl === null, "itemCount/coverUrl wrong");
    assert(!Number.isNaN(Date.parse(p.createdAt)) && !Number.isNaN(Date.parse(p.updatedAt)), "bad timestamps");
    assert(Object.keys(p).sort().join() === "coverUrl,createdAt,id,itemCount,name,updatedAt", `shape: ${Object.keys(p).join()}`);
    defaultProject = p;
    const again = data(await api<{ projects: Project[] }>("GET", "/api/projects"), "list2").projects;
    assert(again.length === 1 && again[0].id === p.id, "default project not stable");
    return `default "${p.name}"`;
  });

  let projA!: Project;
  let projB!: Project;
  await check(3, "Create, rename, delete", async () => {
    projA = data(await api<Project>("POST", "/api/projects", { json: { name: "  Alpha  " } }), "create A");
    assert(projA.name === "Alpha", `not trimmed: "${projA.name}"`);
    projB = data(await api<Project>("POST", "/api/projects", { json: { name: "Beta" } }), "create B");
    for (const bad of ["", "   ", "x".repeat(121)]) {
      const r = await api("POST", "/api/projects", { json: { name: bad } });
      assert(r.status === 400, `name length ${bad.length} -> ${r.status}`);
    }
    const nonString = await api("POST", "/api/projects", { json: { name: 5 } });
    assert(nonString.status === 400, `non-string name -> ${nonString.status}`);
    assert((await api("POST", "/api/projects", { json: { name: "x".repeat(120) } })).status < 300, "120-char name refused");
    const ren = data(await api<Project>("PATCH", `/api/projects/${projB.id}`, { json: { name: "  Beta2 " } }), "rename");
    assert(ren.name === "Beta2", "rename not trimmed");
    assert((await api("PATCH", `/api/projects/${projB.id}`, { json: { name: "" } })).status === 400, "empty rename not 400");
    assert((await api("PATCH", `/api/projects/${projB.id}`, { json: { name: "y".repeat(121) } })).status === 400, "long rename not 400");
    const nf = await api("PATCH", "/api/projects/nope", { json: { name: "z" } });
    assert(nf.status === 404 && errCode(nf) === "project_not_found", `rename unknown -> ${nf.status}`);
    assert((await api("DELETE", "/api/projects/nope")).status === 404, "delete unknown not 404");

    // delete removes board items, not saves
    const s = data(await api<SaveCreated>("POST", "/api/saves", { json: { url: "https://example.com/del-test", projectId: projB.id } }), "save into B");
    assert(data(await api<Board>("GET", `/api/projects/${projB.id}/board`), "board B").items.length === 1, "item not on B");
    const del = data(await api<{ id: string }>("DELETE", `/api/projects/${projB.id}`), "delete B");
    assert(del.id === projB.id, "delete id");
    assert((await api("GET", `/api/projects/${projB.id}/board`)).status === 404, "deleted project board still readable");
    assert(data(await api<Save>("GET", `/api/saves/${s.id}`), "save survives").id === s.id, "save gone");
    const list = data(await api<{ saves: Save[] }>("GET", "/api/saves?limit=100"), "saves").saves;
    assert(list.some((x) => x.id === s.id), "save missing from list");
    const leftover = await api("GET", "/api/projects");
    assert(!data(leftover as Res<{ projects: Project[] }>, "projects").projects.some((p) => p.id === projB.id), "deleted project listed");
    projB = data(await api<Project>("POST", "/api/projects", { json: { name: "Beta" } }), "recreate B");

    // last project -> 409: delete everything but one in a scratch loop
    const all = data(await api<{ projects: Project[] }>("GET", "/api/projects"), "all").projects;
    let last = all[0];
    for (const p of all.slice(1)) data(await api("DELETE", `/api/projects/${p.id}`), "prune");
    const refused = await api("DELETE", `/api/projects/${last.id}`);
    assert(refused.status === 409 && errCode(refused) === "last_project", `last delete -> ${refused.status} ${errCode(refused)}`);
    // rebuild a stable set: oldest must stay the default; recreate A and B
    const stillThere = data(await api<{ projects: Project[] }>("GET", "/api/projects"), "after").projects;
    assert(stillThere.length === 1, "last project was removed");
    defaultProject = stillThere[0];
    projA = data(await api<Project>("POST", "/api/projects", { json: { name: "Alpha" } }), "A again");
    projB = data(await api<Project>("POST", "/api/projects", { json: { name: "Beta" } }), "B again");
    void last;
    return "trim, 400s, 404s, items removed but saves kept, last_project 409";
  });

  const sampleItems = (prefix: string): Board => ({
    id: "",
    camera: { x: 12.5, y: -3, zoom: 1.5 },
    items: [
      { id: `${prefix}-n1`, type: "note", saveId: null, text: `note ${prefix}`, x: 10, y: 20, w: 200, h: 100, z: 1 },
      { id: `${prefix}-n2`, type: "note", saveId: null, text: null, x: 300.25, y: -40, w: 150, h: 90.5, z: 2 },
    ],
  });
  await check(4, "Project boards: round-trip, independence, /api/board = default", async () => {
    const bA = { ...sampleItems("same"), id: projA.id };
    const bB: Board = { ...sampleItems("same"), id: projB.id, camera: { x: 1, y: 2, zoom: 0.5 }, items: [sampleItems("same").items[0]] };
    const putA = data(await api<Board>("PUT", `/api/projects/${projA.id}/board`, { json: bA }), "put A");
    assert(JSON.stringify(putA) === JSON.stringify(bA), "PUT A response differs");
    data(await api<Board>("PUT", `/api/projects/${projB.id}/board`, { json: bB }), "put B");
    const gotA = data(await api<Board>("GET", `/api/projects/${projA.id}/board`), "get A");
    const gotB = data(await api<Board>("GET", `/api/projects/${projB.id}/board`), "get B");
    assert(JSON.stringify(gotA) === JSON.stringify(bA), "A round-trip differs");
    assert(JSON.stringify(gotB) === JSON.stringify(bB), "B round-trip differs / not independent (same item id reused)");
    assert(gotA.id === projA.id, "Board.id !== project id");
    const legacy = data(await api<Board>("GET", "/api/board"), "legacy board");
    assert(legacy.id === defaultProject.id, "/api/board is not the default project");
    assert(legacy.items.length === 0, "default board polluted by other projects");
    const dItems: BoardItem[] = [{ id: "d1", type: "note", saveId: null, text: "legacy", x: 1, y: 1, w: 10, h: 10, z: 1 }];
    data(await api<Board>("PUT", "/api/board", { json: { id: legacy.id, camera: legacy.camera, items: dItems } }), "put legacy");
    const viaProject = data(await api<Board>("GET", `/api/projects/${defaultProject.id}/board`), "default via project");
    assert(JSON.stringify(viaProject.items) === JSON.stringify(dItems), "legacy PUT not visible on default project");
    assert(data(await api<Board>("GET", `/api/projects/${projA.id}/board`), "A again").items.length === 2, "A changed by legacy PUT");
    assert((await api("GET", "/api/projects/nope/board")).status === 404, "unknown board not 404");
    assert((await api("PUT", "/api/projects/nope/board", { json: bA })).status === 404, "unknown board PUT not 404");
    return "exact round-trip, independent (shared item ids ok), /api/board is the default";
  });

  await check(5, "Save with projectId (JSON): placed right of content, no overlap, project bumped", async () => {
    // Board A currently: items x 10..210 and 300.25..450.25, tops -40 and 20.
    const before = data(await api<{ projects: Project[] }>("GET", "/api/projects"), "before").projects.find((p) => p.id === projA.id)!;
    await sleep(15);
    const r = await api<SaveCreated>("POST", "/api/saves", { json: { url: "https://example.com/place-me", title: "Placed", projectId: projA.id } });
    assert(r.status === 202, `status ${r.status}`);
    const s = data(r, "save");
    assert(s.status === "accepted", `status ${s.status}`);
    assert(s.placedIn && s.placedIn.projectId === projA.id && s.placedIn.itemId, "placedIn not set");
    const board = data(await api<Board>("GET", `/api/projects/${projA.id}/board`), "board A");
    const item = board.items.find((i) => i.id === s.placedIn!.itemId);
    assert(item && item.type === "save" && item.saveId === s.id, "item missing / not linked to save");
    const others = board.items.filter((i) => i !== item);
    const maxRight = Math.max(...others.map((i) => i.x + i.w));
    assert(item.x >= maxRight, `not right of content: x=${item.x} < ${maxRight}`);
    assert(item.y === Math.min(...others.map((i) => i.y)), `not top aligned: y=${item.y}`);
    for (const o of others) {
      const overlap = item.x < o.x + o.w && o.x < item.x + item.w && item.y < o.y + o.h && o.y < item.y + item.h;
      assert(!overlap, `overlaps ${o.id}`);
    }
    assert(item.w > 0 && item.h > 0, "bad size");
    const after = data(await api<{ projects: Project[] }>("GET", "/api/projects"), "after").projects.find((p) => p.id === projA.id)!;
    assert(after.itemCount === before.itemCount + 1, `itemCount ${before.itemCount} -> ${after.itemCount}`);
    assert(Date.parse(after.updatedAt) > Date.parse(before.updatedAt), "updatedAt not bumped");
    // empty board -> origin
    const empty = data(await api<Project>("POST", "/api/projects", { json: { name: "Empty" } }), "empty");
    const s2 = data(await api<SaveCreated>("POST", "/api/saves", { json: { url: "https://example.com/first", projectId: empty.id } }), "first");
    const eb = data(await api<Board>("GET", `/api/projects/${empty.id}/board`), "eb");
    assert(eb.items.length === 1 && eb.items[0].x === 0 && eb.items[0].y === 0, "empty board item not at origin");
    assert(s2.placedIn?.projectId === empty.id, "placedIn on empty");
    // no projectId -> no placement
    const s3 = data(await api<SaveCreated>("POST", "/api/saves", { json: { url: "https://example.com/unplaced" } }), "unplaced");
    assert(s3.placedIn === null, "placedIn should be null without projectId");
    // second placement lands right of the first
    const s4 = data(await api<SaveCreated>("POST", "/api/saves", { json: { url: "https://example.com/second", projectId: empty.id } }), "second");
    const eb2 = data(await api<Board>("GET", `/api/projects/${empty.id}/board`), "eb2");
    const first = eb2.items.find((i) => i.saveId === s2.id)!;
    const second = eb2.items.find((i) => i.saveId === s4.id)!;
    assert(second.x >= first.x + first.w, "second item overlaps first");
    return `placed at x=${item.x}, itemCount +1, updatedAt bumped`;
  });

  await check(6, "Unknown / foreign projectId -> 404 project_not_found, nothing saved", async () => {
    const count = async () => data(await api<{ saves: Save[] }>("GET", "/api/saves?limit=100"), "list").saves.length;
    const n0 = await count();
    const j = await api("POST", "/api/saves", { json: { url: "https://example.com/nope", projectId: "no-such-project" } });
    assert(j.status === 404 && errCode(j) === "project_not_found", `json -> ${j.status} ${errCode(j)}`);
    const jn = await api("POST", "/api/saves", { json: { note: "a note", projectId: "no-such-project" } });
    assert(jn.status === 404 && errCode(jn) === "project_not_found", `note -> ${jn.status}`);
    const m = await api("POST", "/api/saves", { form: pngForm({ projectId: "no-such-project" }) });
    assert(m.status === 404 && errCode(m) === "project_not_found", `multipart -> ${m.status} ${errCode(m)}`);
    assert((await count()) === n0, "a save was created");
    return "JSON, note and multipart all refused; save count unchanged";
  });

  await check(7, "Multipart with sourceUrl + projectId", async () => {
    const r = await api<SaveCreated>("POST", "/api/saves", {
      form: pngForm({ sourceUrl: "https://example.com/pic.png", projectId: projA.id, title: "Pic" }),
    });
    const s = data(r, "upload");
    assert(s.kind === "image", `kind ${s.kind}`);
    assert(s.sourceUrl === "https://example.com/pic.png", `sourceUrl ${s.sourceUrl}`);
    assert(s.asset?.mediaType === "image/png" && s.asset.bytes === PNG.length, "asset meta");
    assert(s.placedIn?.projectId === projA.id, "not placed");
    const board = data(await api<Board>("GET", `/api/projects/${projA.id}/board`), "board");
    const item = board.items.find((i) => i.id === s.placedIn!.itemId);
    assert(item && item.saveId === s.id && item.w === 280, `item ${JSON.stringify(item)}`);
    const got = data(await api<Save>("GET", `/api/saves/${s.id}`), "get");
    assert(got.sourceUrl === "https://example.com/pic.png", "sourceUrl not persisted");
    const n0 = data(await api<{ saves: Save[] }>("GET", "/api/saves?limit=100"), "l0").saves.length;
    for (const bad of ["http://127.0.0.1/x.png", "http://localhost/x.png", "http://10.0.0.5/x.png", "ftp://example.com/x.png"]) {
      const pr = await api("POST", "/api/saves", { form: pngForm({ sourceUrl: bad, projectId: projA.id }) });
      assert(pr.status === 400, `${bad} -> ${pr.status}`);
    }
    const n1 = data(await api<{ saves: Save[] }>("GET", "/api/saves?limit=100"), "l1").saves.length;
    assert(n0 === n1, "refused uploads created saves");
    return "image save, sourceUrl stored, placed w=280; private/non-http sourceUrl 400";
  });

  await check(8, "Idempotency-Key", async () => {
    const key = `key-${Date.now()}`;
    const h = { "idempotency-key": key };
    const first = await api<SaveCreated>("POST", "/api/saves", { json: { url: "https://example.com/idem", projectId: projA.id }, headers: h });
    assert(first.status === 202, `first status ${first.status}`);
    const a = data(first, "first");
    const second = await api<SaveCreated>("POST", "/api/saves", { json: { url: "https://example.com/idem", projectId: projA.id }, headers: h });
    assert(second.status === 200, `replay status ${second.status}`);
    const b = data(second, "replay");
    assert(b.id === a.id, "replay returned a different save");
    assert(JSON.stringify(b.placedIn) === JSON.stringify(a.placedIn), "placedIn differs on replay");
    const list = data(await api<{ saves: Save[] }>("GET", "/api/saves?limit=100"), "list").saves;
    assert(list.filter((s) => s.sourceUrl === "https://example.com/idem").length === 1, "more than one save for the key");
    const board = data(await api<Board>("GET", `/api/projects/${projA.id}/board`), "board");
    assert(board.items.filter((i) => i.saveId === a.id).length === 1, "placed twice");
    const other = data(await api<SaveCreated>("POST", "/api/saves", { json: { url: "https://example.com/idem", projectId: projA.id }, headers: { "idempotency-key": `${key}-2` } }), "other");
    assert(other.id !== a.id, "different key reused the save");
    // multipart replay, and key is per user-content independent
    const mk = { "idempotency-key": `${key}-mp` };
    const m1 = data(await api<SaveCreated>("POST", "/api/saves", { form: pngForm({ projectId: projA.id }), headers: mk }), "mp1");
    const m2 = await api<SaveCreated>("POST", "/api/saves", { form: pngForm({ projectId: projA.id }), headers: mk });
    assert(m2.status === 200 && data(m2, "mp2").id === m1.id, "multipart replay");
    const tooLong = await api("POST", "/api/saves", { json: { url: "https://example.com/z" }, headers: { "idempotency-key": "k".repeat(201) } });
    assert(tooLong.status === 400, `201-char key -> ${tooLong.status}`);
    // concurrent same-key requests -> a single save
    const ck = { "idempotency-key": `${key}-race` };
    const rs = await Promise.all([1, 2, 3].map(() => api<SaveCreated>("POST", "/api/saves", { json: { url: "https://example.com/race" }, headers: ck })));
    const ids = new Set(rs.map((r) => data(r, "race").id));
    assert(ids.size === 1, `concurrent same-key created ${ids.size} saves`);
    return "replay 200 same id/placedIn, one save, new key -> new save, concurrent safe";
  });

  await check(11, "CORS: allowed origin gets headers, others none", async () => {
    const pre = await fetch(`${BASE}/api/saves`, {
      method: "OPTIONS",
      headers: { origin: ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type,idempotency-key" },
    });
    assert(pre.status === 204 || pre.status === 200, `preflight ${pre.status}`);
    assert(pre.headers.get("access-control-allow-origin") === ORIGIN, "allow-origin missing");
    const hdrs = (pre.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    for (const h of ["authorization", "content-type", "idempotency-key"]) assert(hdrs.includes(h), `allow-headers lacks ${h}`);
    const methods = pre.headers.get("access-control-allow-methods") ?? "";
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) assert(methods.includes(m), `allow-methods lacks ${m}`);
    const bad = await fetch(`${BASE}/api/saves`, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    assert(bad.headers.get("access-control-allow-origin") === null, "evil origin got allow-origin");
    assert(bad.headers.get("access-control-allow-headers") === null, "evil origin got allow-headers");
    const real = await fetch(`${BASE}/api/projects`, { headers: { origin: ORIGIN, authorization: `Bearer ${TOKEN}` } });
    assert(real.status === 200 && real.headers.get("access-control-allow-origin") === ORIGIN, "actual response lacks allow-origin");
    const realBad = await fetch(`${BASE}/api/projects`, { headers: { origin: "https://evil.example", authorization: `Bearer ${TOKEN}` } });
    assert(realBad.headers.get("access-control-allow-origin") === null, "actual response to evil origin has allow-origin");
    const noOrigin = await fetch(`${BASE}/api/health`);
    assert(noOrigin.headers.get("access-control-allow-origin") === null, "header without Origin");
    return "preflight + actual responses honour ATELIER_ALLOWED_ORIGINS";
  });

  // ---- P10 (direct DB phase) and P9 need the server stopped.
  const ownerPid = projA.id;
  await stopServer();

  const own = sub(["--db-ownership", ownerPid], { ATELIER_DATA_DIR: DATA_DIR });
  await check(10, "Ownership: second user cannot touch owner's projects", async () => {
    assert(own.ok, `direct DB phase failed: ${own.out}`);
    await startServer();
    const list = data(await api<{ projects: Project[] }>("GET", "/api/projects"), "owner list").projects;
    assert(list.some((p) => p.id === ownerPid && p.name === "Alpha"), "owner project changed (renamed/deleted?)");
    assert(!list.some((p) => p.name === "Intruder board"), "owner sees intruder project");
    const b = data(await api<Board>("GET", `/api/projects/${ownerPid}/board`), "owner board");
    assert(b.items.length > 0, "owner board emptied");
    await stopServer();
    return own.out;
  });

  await check(9, "Migration: old-schema data dir opens, items in default project", async () => {
    const mk = sub(["--migrate-make"], { ATELIER_DATA_DIR: MIGRATE_DIR });
    assert(mk.ok, `could not create old-schema dir: ${mk.out}`);
    const chk = sub(["--migrate-check", "strict"], { ATELIER_DATA_DIR: MIGRATE_DIR });
    assert(chk.ok, chk.out);
    // reopen once more in a fresh process: migration is idempotent on an already-migrated dir
    const again = sub(["--migrate-check", "any"], { ATELIER_DATA_DIR: MIGRATE_DIR });
    assert(again.ok, `second open: ${again.out}`);
    return `${chk.out}; reopen ok`;
  });

  await check(12, "Regression: verify-backend.ts still 15/15", async () => {
    const r = spawnSync("pnpm", ["exec", "tsx", "scripts/verify-backend.ts"], {
      cwd: ROOT,
      env: { ...process.env, VERIFY_PORT: "3221", VERIFY_DATA_DIR: BACKEND_DATA_DIR, NEXT_DIST_DIR: ".next-verify-backend" },
      encoding: "utf8",
      timeout: 900_000,
    });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    const summary = out.split("\n").filter((l) => l.startsWith("Summary:")).pop() ?? out.slice(-500);
    assert(r.status === 0 && /15 passed, 0 failed/.test(summary), summary);
    // data left by verify-backend must stay readable by the migrated schema
    if (existsSync(BACKEND_DATA_DIR)) {
      const rd = sub(["--migrate-check", "any"], { ATELIER_DATA_DIR: BACKEND_DATA_DIR });
      assert(rd.ok, `verify-backend data not readable: ${rd.out}`);
      return `${summary} | data dir readable after migration`;
    }
    return summary;
  });

  const count = (o: Outcome) => results.filter((r) => r.outcome === o).length;
  console.log(`\nSummary: ${count("PASS")} passed, ${count("FAIL")} failed (of 12)`);
  if (count("FAIL") || results.length < 12) process.exitCode = 1;
}

const mode = process.argv[2];
const run =
  mode === "--db-ownership" ? dbOwnershipMode : mode === "--migrate-make" ? migrateMakeMode : mode === "--migrate-check" ? migrateCheckMode : main;
run().catch(async (e) => {
  console.error(`verify-projects crashed: ${e instanceof Error ? e.stack ?? e.message : e}`);
  await stopServer();
  process.exit(1);
});
process.on("SIGINT", () => {
  void stopServer().then(() => process.exit(130));
});
