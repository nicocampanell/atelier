// Projects are named boards. Every query filters on user_id.
import { randomUUID } from "node:crypto";
import { db, sbError } from "./db";
import { resolveBoard } from "./board";
import { ApiError } from "./http";
import type { Project } from "./types";

export const MAX_PROJECT_NAME = 120;

interface BoardMeta {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

function toProject(
  b: BoardMeta,
  itemCount: number,
  coverUrl: string | null,
): Project {
  return {
    id: b.id,
    name: b.name,
    itemCount,
    coverUrl,
    createdAt: new Date(b.created_at).toISOString(),
    updatedAt: new Date(b.updated_at).toISOString(),
  };
}

/** Live item counts + cover preview for a set of boards (one round-trip each). */
async function enrich(userId: string, boards: BoardMeta[]): Promise<Project[]> {
  if (!boards.length) return [];
  const ids = boards.map((b) => b.id);
  const { data: items, error } = await db()
    .from("board_item")
    .select("board_id, type, save_id, pos")
    .eq("user_id", userId)
    .in("board_id", ids);
  if (error) sbError(error);

  const saveIds = [...new Set((items ?? []).filter((i) => i.type === "save" && i.save_id).map((i) => i.save_id as string))];
  const live = new Map<string, { deleted_at: string | null; preview_url: string | null }>();
  if (saveIds.length) {
    const { data: saves, error: sErr } = await db()
      .from("save")
      .select("id, deleted_at, preview_url")
      .eq("user_id", userId)
      .in("id", saveIds);
    if (sErr) sbError(sErr);
    for (const s of saves ?? []) live.set(s.id, s);
  }

  const byBoard = new Map<string, { count: number; cover: string | null; coverPos: number }>();
  for (const id of ids) byBoard.set(id, { count: 0, cover: null, coverPos: -1 });
  for (const it of items ?? []) {
    const slot = byBoard.get(it.board_id)!;
    if (it.type === "save") {
      const s = it.save_id ? live.get(it.save_id) : undefined;
      if (!s || s.deleted_at) continue;
      slot.count++;
      if (s.preview_url && it.pos >= slot.coverPos) {
        slot.cover = s.preview_url;
        slot.coverPos = it.pos;
      }
    } else {
      slot.count++;
    }
  }
  return boards.map((b) => {
    const e = byBoard.get(b.id)!;
    return toProject(b, e.count, e.cover);
  });
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
  const { data, error } = await db()
    .from("board")
    .select("id, name, created_at, updated_at")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) sbError(error);
  if (!data) return null;
  return (await enrich(userId, [data]))[0];
}

export async function listProjects(userId: string): Promise<Project[]> {
  await resolveBoard(userId); // creates the default project if none
  const { data, error } = await db()
    .from("board")
    .select("id, name, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true });
  if (error) sbError(error);
  return enrich(userId, data ?? []);
}

export async function createProject(userId: string, rawName: unknown): Promise<Project> {
  const name = parseName(rawName);
  await resolveBoard(userId); // make sure the default (oldest) exists first
  const id = randomUUID();
  const { error } = await db()
    .from("board")
    .insert({ id, user_id: userId, camera: { x: 0, y: 0, zoom: 1 }, name });
  if (error) sbError(error);
  return (await getProject(userId, id))!;
}

export async function renameProject(userId: string, id: string, rawName: unknown): Promise<Project> {
  const name = parseName(rawName);
  const { data, error } = await db()
    .from("board")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", id)
    .select("id");
  if (error) sbError(error);
  if (!data?.length) throw new ApiError(404, "project_not_found", "That project doesn't exist.");
  return (await getProject(userId, id))!;
}

export async function deleteProject(userId: string, id: string): Promise<{ id: string }> {
  const { data: mine, error } = await db().from("board").select("id").eq("user_id", userId);
  if (error) sbError(error);
  if (!(mine ?? []).some((b) => b.id === id)) throw new ApiError(404, "project_not_found", "That project doesn't exist.");
  if ((mine ?? []).length <= 1) throw new ApiError(409, "last_project", "You can't delete your only project.");
  // ponytail: no multi-statement tx via supabase-js; delete items then board (single-user).
  const { error: iErr } = await db().from("board_item").delete().eq("user_id", userId).eq("board_id", id);
  if (iErr) sbError(iErr);
  const { error: bErr } = await db().from("board").delete().eq("user_id", userId).eq("id", id);
  if (bErr) sbError(bErr);
  return { id };
}

/** Throws 404 project_not_found unless the project belongs to this user. */
export async function assertProject(userId: string, id: string): Promise<void> {
  await resolveBoard(userId, id);
}

const GAP = 60;

/**
 * Place a save to the right of the board's existing content (top aligned to the
 * topmost item), or at the origin when empty.
 * Throws 404 when the project isn't this user's.
 */
export async function placeSave(
  userId: string,
  projectId: string,
  saveId: string,
  size: { w: number; h: number },
): Promise<{ projectId: string; itemId: string }> {
  const { data: board, error } = await db()
    .from("board")
    .select("id")
    .eq("user_id", userId)
    .eq("id", projectId)
    .maybeSingle();
  if (error) sbError(error);
  if (!board) throw new ApiError(404, "project_not_found", "That project doesn't exist.");

  const { data: items, error: iErr } = await db()
    .from("board_item")
    .select("type, save_id, x, y, w, h, z, pos")
    .eq("user_id", userId)
    .eq("board_id", projectId);
  if (iErr) sbError(iErr);

  const saveIds = [...new Set((items ?? []).filter((i) => i.type === "save" && i.save_id).map((i) => i.save_id as string))];
  const live = new Set<string>();
  if (saveIds.length) {
    const { data: saves, error: sErr } = await db()
      .from("save")
      .select("id")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .in("id", saveIds);
    if (sErr) sbError(sErr);
    for (const s of saves ?? []) live.add(s.id);
  }

  let right: number | null = null;
  let top: number | null = null;
  let maxZ: number | null = null;
  let maxPos = -1;
  for (const it of items ?? []) {
    maxPos = Math.max(maxPos, it.pos);
    if (it.type === "save" && (!it.save_id || !live.has(it.save_id))) continue;
    right = right === null ? it.x + it.w : Math.max(right, it.x + it.w);
    top = top === null ? it.y : Math.min(top, it.y);
    maxZ = maxZ === null ? it.z : Math.max(maxZ, it.z);
  }

  const itemId = randomUUID();
  const { error: insErr } = await db().from("board_item").insert({
    id: itemId,
    user_id: userId,
    board_id: projectId,
    pos: maxPos + 1,
    type: "save",
    save_id: saveId,
    text: null,
    x: right === null ? 0 : right + GAP,
    y: top === null ? 0 : top,
    w: size.w,
    h: size.h,
    z: (maxZ ?? 0) + 1,
  });
  if (insErr) sbError(insErr);
  const { error: uErr } = await db()
    .from("board")
    .update({ updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", projectId);
  if (uErr) sbError(uErr);
  return { projectId, itemId };
}
