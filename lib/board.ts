// Board data access. Item order is preserved exactly as sent, via the `pos`
// column; GET returns items ordered by pos.
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { ApiError } from "./http";
import type { Board, BoardItem } from "./types";

export const MAX_BOARD_ITEMS = 2000;
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

async function ensureBoard(userId: string): Promise<{ id: string; camera: Board["camera"] }> {
  const db = await getDb();
  await db.query(
    `insert into board (id, user_id, camera) values ($1, $2, $3::jsonb) on conflict (user_id) do nothing`,
    [randomUUID(), userId, JSON.stringify(DEFAULT_CAMERA)],
  );
  const r = await db.query<{ id: string; camera: Board["camera"] }>(`select id, camera from board where user_id = $1`, [userId]);
  return r.rows[0];
}

export async function getBoard(userId: string): Promise<Board> {
  const db = await getDb();
  const board = await ensureBoard(userId);
  // Save items pointing at deleted or missing saves are dropped.
  const r = await db.query<ItemRow>(
    `select bi.id, bi.type, bi.save_id, bi.text, bi.x, bi.y, bi.w, bi.h, bi.z
     from board_item bi
     left join save s on s.id = bi.save_id and s.user_id = bi.user_id
     where bi.user_id = $1 and bi.board_id = $2
       and (bi.type <> 'save' or (s.id is not null and s.deleted_at is null))
     order by bi.pos`,
    [userId, board.id],
  );
  return { id: board.id, camera: board.camera, items: r.rows.map(toItem) };
}

export async function putBoard(userId: string, body: unknown): Promise<Board> {
  const { camera, items } = parseBoard(body);
  const db = await getDb();
  const board = await ensureBoard(userId);

  const saveIds = items.filter((i) => i.type === "save").map((i) => i.saveId as string);
  const live = new Set<string>();
  if (saveIds.length) {
    const r = await db.query<{ id: string }>(
      `select id from save where user_id = $1 and deleted_at is null and id = any($2::text[])`,
      [userId, saveIds],
    );
    for (const row of r.rows) live.add(row.id);
  }
  const kept = items.filter((i) => i.type === "note" || live.has(i.saveId as string));

  await db.transaction(async (tx) => {
    await tx.query(`update board set camera = $2::jsonb where user_id = $1`, [userId, JSON.stringify(camera)]);
    await tx.query(`delete from board_item where user_id = $1 and board_id = $2`, [userId, board.id]);
    let pos = 0;
    for (const it of kept) {
      await tx.query(
        `insert into board_item (id, user_id, board_id, pos, type, save_id, text, x, y, w, h, z)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [it.id, userId, board.id, pos++, it.type, it.saveId, it.text, it.x, it.y, it.w, it.h, it.z],
      );
    }
  });
  return getBoard(userId);
}
