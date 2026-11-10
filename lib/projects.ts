// Projects are named boards. Every query filters on user_id.
import { randomUUID } from "node:crypto";
import type { Transaction } from "@electric-sql/pglite";
import { getDb } from "./db";
import { resolveBoard } from "./board";
import { ApiError } from "./http";
import type { Project } from "./types";

export const MAX_PROJECT_NAME = 120;

interface ProjectRow {
  id: string;
  name: string;
  created_at: Date | string;
  updated_at: Date | string;
  item_count: number | string;
  cover_url: string | null;
}

// Live items only (items pointing at deleted saves are not counted). The cover
// is the preview of the most recently placed (highest pos) save that has one.
const SELECT = `
  select b.id, b.name, b.created_at, b.updated_at,
    (select count(*) from board_item bi
       left join save s on s.id = bi.save_id and s.user_id = bi.user_id
      where bi.user_id = b.user_id and bi.board_id = b.id
        and (bi.type <> 'save' or (s.id is not null and s.deleted_at is null))) as item_count,
    (select s.preview_url from board_item bi
       join save s on s.id = bi.save_id and s.user_id = bi.user_id
      where bi.user_id = b.user_id and bi.board_id = b.id and bi.type = 'save'
        and s.deleted_at is null and s.preview_url is not null
      order by bi.pos desc limit 1) as cover_url
  from board b`;

function toProject(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    itemCount: Number(r.item_count),
    coverUrl: r.cover_url,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export function parseName(v: unknown): string {
  if (typeof v !== "string") throw new ApiError(400, "bad_request", "name must be a string.");
  const name = v.trim();
  if (name.length < 1 || name.length > MAX_PROJECT_NAME) {
    throw new ApiError(400, "bad_request", `name must be 1 to ${MAX_PROJECT_NAME} characters.`);
  }
  return name;
}

export async function getProject(userId: string, id: string): Promise<Project | null> {
  const db = await getDb();
  const r = await db.query<ProjectRow>(`${SELECT} where b.user_id = $1 and b.id = $2`, [userId, id]);
  return r.rows[0] ? toProject(r.rows[0]) : null;
}

export async function listProjects(userId: string): Promise<Project[]> {
  const db = await getDb();
  await resolveBoard(userId); // creates the default project if none
  const r = await db.query<ProjectRow>(`${SELECT} where b.user_id = $1 order by b.updated_at desc, b.id`, [userId]);
  return r.rows.map(toProject);
}

export async function createProject(userId: string, rawName: unknown): Promise<Project> {
  const name = parseName(rawName);
  const db = await getDb();
  await resolveBoard(userId); // make sure the default (oldest) exists first
  const id = randomUUID();
  await db.query(
    `insert into board (id, user_id, camera, name) values ($1, $2, '{"x":0,"y":0,"zoom":1}'::jsonb, $3)`,
    [id, userId, name],
  );
  return (await getProject(userId, id))!;
}

export async function renameProject(userId: string, id: string, rawName: unknown): Promise<Project> {
  const name = parseName(rawName);
  const db = await getDb();
  const r = await db.query(`update board set name = $3, updated_at = now() where user_id = $1 and id = $2 returning id`, [userId, id, name]);
  if (r.rows.length === 0) throw new ApiError(404, "project_not_found", "That project doesn't exist.");
  return (await getProject(userId, id))!;
}

export async function deleteProject(userId: string, id: string): Promise<{ id: string }> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const mine = await tx.query<{ id: string }>(`select id from board where user_id = $1`, [userId]);
    if (!mine.rows.some((b) => b.id === id)) throw new ApiError(404, "project_not_found", "That project doesn't exist.");
    if (mine.rows.length <= 1) throw new ApiError(409, "last_project", "You can't delete your only project.");
    await tx.query(`delete from board_item where user_id = $1 and board_id = $2`, [userId, id]);
    await tx.query(`delete from board where user_id = $1 and id = $2`, [userId, id]);
  });
  return { id };
}

/** Throws 404 project_not_found unless the project belongs to this user. */
export async function assertProject(userId: string, id: string): Promise<void> {
  await resolveBoard(userId, id);
}

const GAP = 60;

/**
 * Place a save to the right of the board's existing content (top aligned to the
 * topmost item), or at the origin when empty. Runs inside the caller's transaction.
 * Throws 404 when the project isn't this user's, which rolls the transaction back.
 */
export async function placeSaveInTx(
  tx: Transaction,
  userId: string,
  projectId: string,
  saveId: string,
  size: { w: number; h: number },
): Promise<{ projectId: string; itemId: string }> {
  const b = await tx.query<{ id: string }>(`select id from board where user_id = $1 and id = $2`, [userId, projectId]);
  if (!b.rows[0]) throw new ApiError(404, "project_not_found", "That project doesn't exist.");
  const ext = await tx.query<{ right: number | null; top: number | null; z: number | null; pos: number | null }>(
    `select max(bi.x + bi.w) as right, min(bi.y) as top, max(bi.z) as z, max(bi.pos) as pos
     from board_item bi
     left join save s on s.id = bi.save_id and s.user_id = bi.user_id
     where bi.user_id = $1 and bi.board_id = $2
       and (bi.type <> 'save' or (s.id is not null and s.deleted_at is null))`,
    [userId, projectId],
  );
  const e = ext.rows[0];
  const x = e.right === null ? 0 : e.right + GAP;
  const y = e.top === null ? 0 : e.top;
  const z = (e.z ?? 0) + 1;
  // pos must exceed every row, including hidden ones, so the new item is last.
  const maxPos = await tx.query<{ pos: number | null }>(
    `select max(pos) as pos from board_item where user_id = $1 and board_id = $2`,
    [userId, projectId],
  );
  const pos = (maxPos.rows[0].pos ?? -1) + 1;
  const itemId = randomUUID();
  await tx.query(
    `insert into board_item (id, user_id, board_id, pos, type, save_id, text, x, y, w, h, z)
     values ($1,$2,$3,$4,'save',$5,null,$6,$7,$8,$9,$10)`,
    [itemId, userId, projectId, pos, saveId, x, y, size.w, size.h, z],
  );
  await tx.query(`update board set updated_at = now() where user_id = $1 and id = $2`, [userId, projectId]);
  return { projectId, itemId };
}
