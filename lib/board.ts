// Board data access. Item order is preserved exactly as sent, via the `pos`
// column; GET returns items ordered by pos.
import { randomUUID } from "node:crypto";
import { db, sbError } from "./db";
import { ApiError } from "./http";
import type { Board, BoardItem } from "./types";

// Cap at PostgREST default max_rows (1000); raise db-max-rows in Supabase to go higher.
export const MAX_BOARD_ITEMS = 1000;
const MAX_NOTE_CHARS = 20_000;
const DEFAULT_CAMERA = { x: 0, y: 0, zoom: 1 };

interface ItemRow {
  id: string;
  type: string;
  save_id: string | null;
  text: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const bad = (msg: string) => new ApiError(400, "bad_request", msg);

function parseBoard(body: unknown): { camera: Board["camera"]; items: BoardItem[] } {
  if (!body || typeof body !== "object") throw bad("Expected a board object.");
  const b = body as Record<string, unknown>;

  let camera = DEFAULT_CAMERA;
  if (b.camera !== undefined) {
    const c = b.camera as Record<string, unknown> | null;
    if (!c || typeof c !== "object" || !fin(c.x) || !fin(c.y) || !fin(c.zoom) || c.zoom <= 0) {
      throw bad("camera must be {x, y, zoom} with finite numbers and zoom > 0.");
    }
    camera = { x: c.x, y: c.y, zoom: c.zoom };
  }

  if (!Array.isArray(b.items)) throw bad("items must be an array.");
  if (b.items.length > MAX_BOARD_ITEMS) throw bad(`A board can hold at most ${MAX_BOARD_ITEMS} items.`);

  const seen = new Set<string>();
  const items: BoardItem[] = b.items.map((raw, i) => {
    const it = raw as Record<string, unknown> | null;
    if (!it || typeof it !== "object") throw bad(`items[${i}] must be an object.`);
    if (typeof it.id !== "string" || !it.id || it.id.length > 200) throw bad(`items[${i}].id must be a non-empty string.`);
    if (seen.has(it.id)) throw bad(`Duplicate item id "${it.id.slice(0, 40)}".`);
    seen.add(it.id);
    if (it.type !== "save" && it.type !== "note") throw bad(`items[${i}].type must be "save" or "note".`);
    for (const k of ["x", "y", "w", "h", "z"] as const) {
      if (!fin(it[k])) throw bad(`items[${i}].${k} must be a finite number.`);
    }
    let saveId: string | null = null;
    let text: string | null = null;
    if (it.type === "save") {
      if (typeof it.saveId !== "string" || !it.saveId || it.saveId.length > 200) throw bad(`items[${i}].saveId must be a string.`);
      saveId = it.saveId;
      if (it.text !== undefined && it.text !== null && typeof it.text !== "string") throw bad(`items[${i}].text must be a string or null.`);
    } else {
      if (it.saveId !== undefined && it.saveId !== null) throw bad(`items[${i}].saveId must be null for notes.`);
      if (it.text !== undefined && it.text !== null) {
        if (typeof it.text !== "string" || it.text.length > MAX_NOTE_CHARS) throw bad(`items[${i}].text must be a string up to ${MAX_NOTE_CHARS} characters.`);
        text = it.text;
      }
    }
    return {
      id: it.id, type: it.type, saveId, text,
      x: it.x as number, y: it.y as number, w: it.w as number, h: it.h as number, z: it.z as number,
    };
  });
  return { camera, items };
}

function toItem(r: ItemRow): BoardItem {
  return { id: r.id, type: r.type as BoardItem["type"], saveId: r.save_id, text: r.text, x: r.x, y: r.y, w: r.w, h: r.h, z: r.z };
}

interface BoardRow {
  id: string;
  camera: Board["camera"];
}

/** The oldest board is the default project; created on first use. */
async function ensureDefaultBoard(userId: string): Promise<BoardRow> {
  const { data: existing, error } = await db()
    .from("board")
    .select("id, camera")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) sbError(error);
  if (existing) return existing as BoardRow;

  const id = randomUUID();
  const { error: insErr } = await db()
    .from("board")
    .insert({ id, user_id: userId, camera: DEFAULT_CAMERA });
  // Concurrent first-call race: unique isn't on user_id, so two inserts can land;
  // re-select oldest either way.
  if (insErr && (insErr as { code?: string }).code !== "23505") sbError(insErr);

  const { data: row, error: rErr } = await db()
    .from("board")
    .select("id, camera")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (rErr) sbError(rErr);
  return row as BoardRow;
}

/** Resolve a project's board for this user: the default when projectId is undefined, else 404. */
export async function resolveBoard(userId: string, projectId?: string): Promise<BoardRow> {
  if (projectId === undefined) return ensureDefaultBoard(userId);
  const { data, error } = await db()
    .from("board")
    .select("id, camera")
    .eq("user_id", userId)
    .eq("id", projectId)
    .maybeSingle();
  if (error) sbError(error);
  if (!data) throw new ApiError(404, "project_not_found", "That project doesn't exist.");
  return data as BoardRow;
}

export async function getBoard(userId: string, projectId?: string): Promise<Board> {
  const board = await resolveBoard(userId, projectId);
  const { data: items, error } = await db()
    .from("board_item")
    .select("id, type, save_id, text, x, y, w, h, z, pos")
    .eq("user_id", userId)
    .eq("board_id", board.id)
    .order("pos", { ascending: true })
    .limit(MAX_BOARD_ITEMS);
  if (error) sbError(error);

  const saveIds = [...new Set((items ?? []).filter((i) => i.type === "save" && i.save_id).map((i) => i.save_id as string))];
  const live = new Set<string>();
  if (saveIds.length) {
    const { data: saves, error: sErr } = await db()
      .from("save")
      .select("id")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .in("id", saveIds)
      .limit(saveIds.length);
    if (sErr) sbError(sErr);
    for (const s of saves ?? []) live.add(s.id);
  }

  const kept = (items ?? []).filter((i) => i.type !== "save" || (i.save_id && live.has(i.save_id)));
  return { id: board.id, camera: board.camera, items: kept.map((r) => toItem(r as ItemRow)) };
}

export async function putBoard(userId: string, body: unknown, projectId?: string): Promise<Board> {
  const { camera, items } = parseBoard(body);
  const board = await resolveBoard(userId, projectId);

  const saveIds = items.filter((i) => i.type === "save").map((i) => i.saveId as string);
  const live = new Set<string>();
  if (saveIds.length) {
    const { data, error } = await db()
      .from("save")
      .select("id")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .in("id", saveIds)
      .limit(saveIds.length);
    if (error) sbError(error);
    for (const row of data ?? []) live.add(row.id);
  }
  const kept = items.filter((i) => i.type === "note" || live.has(i.saveId as string));

  // ponytail: no multi-statement tx via supabase-js; replace items in two steps (single-user).
  const { error: uErr } = await db()
    .from("board")
    .update({ camera, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", board.id);
  if (uErr) sbError(uErr);

  const { error: dErr } = await db().from("board_item").delete().eq("user_id", userId).eq("board_id", board.id);
  if (dErr) sbError(dErr);

  if (kept.length) {
    const { error: iErr } = await db().from("board_item").insert(
      kept.map((it, pos) => ({
        id: it.id,
        user_id: userId,
        board_id: board.id,
        pos,
        type: it.type,
        save_id: it.saveId,
        text: it.text,
        x: it.x,
        y: it.y,
        w: it.w,
        h: it.h,
        z: it.z,
      })),
    );
    if (iErr) sbError(iErr);
  }
  return getBoard(userId, board.id);
}
