// Data access for saves. Every function takes userId first and every query
// filters on user_id.
import { randomUUID } from "node:crypto";
import { removeAssetObjects } from "./assets";
import { db, isUniqueViolation, sbError } from "./db";
import { ApiError } from "./http";
import { removeSaveIndex } from "./search/index";
import { placeSave } from "./projects";
import type { Save, SaveCreated, SaveKind, SaveStatus } from "./types";

/** Optional extras for creating a save: placement on a project's board and idempotency. */
export interface CreateCtx {
  projectId?: string | null;
  idempotencyKey?: string | null;
  /** Item size when placing; default 280x200. */
  size?: { w: number; h: number };
}

const IDEMPOTENCY_TTL_HOURS = 24;

/** Place + record the idempotency key after a save row exists. */
async function afterInsert(userId: string, saveId: string, ctx: CreateCtx | undefined): Promise<SaveCreated["placedIn"]> {
  let placedIn: SaveCreated["placedIn"] = null;
  if (ctx?.projectId) {
    placedIn = await placeSave(userId, ctx.projectId, saveId, ctx.size ?? { w: 280, h: 200 });
  }
  if (ctx?.idempotencyKey) {
    const { error } = await db().from("idempotency").insert({
      user_id: userId,
      key: ctx.idempotencyKey,
      save_id: saveId,
      project_id: placedIn?.projectId ?? null,
      item_id: placedIn?.itemId ?? null,
    });
    if (error) {
      if (isUniqueViolation(error) && ctx.idempotencyKey) {
        const prior = await findIdempotent(userId, ctx.idempotencyKey);
        if (prior) throw new IdempotentReplay(prior);
      }
      sbError(error);
    }
  }
  return placedIn;
}

/** The original SaveCreated for a key used within the last 24h, or null (expired keys are dropped). */
export async function findIdempotent(userId: string, key: string): Promise<SaveCreated | null> {
  const cutoff = new Date(Date.now() - IDEMPOTENCY_TTL_HOURS * 3600_000).toISOString();
  await db().from("idempotency").delete().eq("user_id", userId).eq("key", key).lt("created_at", cutoff);

  const { data: row, error } = await db()
    .from("idempotency")
    .select("save_id, project_id, item_id")
    .eq("user_id", userId)
    .eq("key", key)
    .maybeSingle();
  if (error) sbError(error);
  if (!row) return null;
  const save = await getSave(userId, row.save_id);
  if (!save) return null;
  return {
    ...save,
    placedIn: row.project_id && row.item_id ? { projectId: row.project_id, itemId: row.item_id } : null,
  };
}

interface SaveRow {
  id: string;
  kind: string;
  source_url: string | null;
  title: string;
  description: string | null;
  preview_url: string | null;
  status: string;
  error: string | null;
  duplicate_of: string | null;
  created_at: string;
  tags: string[] | null;
}

function toSave(r: SaveRow, asset: { media_type: string; bytes: number } | null): Save {
  return {
    id: r.id,
    kind: r.kind as SaveKind,
    sourceUrl: r.source_url,
    title: r.title,
    description: r.description,
    previewUrl: r.preview_url,
    asset: asset ? { mediaType: asset.media_type, bytes: asset.bytes } : null,
    status: r.status as SaveStatus,
    error: r.error,
    duplicateOf: r.duplicate_of,
    tags: r.tags ?? [],
    createdAt: new Date(r.created_at).toISOString(),
  };
}

async function assetsFor(userId: string, saveIds: string[]): Promise<Map<string, { media_type: string; bytes: number }>> {
  const map = new Map<string, { media_type: string; bytes: number }>();
  if (!saveIds.length) return map;
  const { data, error } = await db()
    .from("asset")
    .select("save_id, media_type, bytes")
    .eq("user_id", userId)
    .in("save_id", saveIds)
    .limit(saveIds.length);
  if (error) sbError(error);
  for (const a of data ?? []) map.set(a.save_id, { media_type: a.media_type, bytes: a.bytes });
  return map;
}

/** lowercase host (done by URL), no fragment, no trailing slash. */
export function normalizeUrl(u: URL): string {
  const p = u.pathname.replace(/\/+$/, "");
  return `${u.protocol}//${u.host}${p}${u.search}`;
}

export function titleFromUrl(u: URL): string {
  const p = u.pathname.replace(/\/+$/, "");
  return (u.hostname + p).slice(0, 200);
}

/** Run the creating path; on a lost idempotency race, surface the winner via IdempotentReplay. */
export class IdempotentReplay extends Error {
  constructor(public result: SaveCreated) {
    super("replay");
  }
}

/**
 * Create a save then place / record idempotency.
 * ponytail: no multi-statement tx via supabase-js — assert project first, and on
 * post-insert failure delete the orphan save (single-user; upgrade = RPC wrapper).
 * Call setId as soon as the save row exists so cleanup runs if a later insert throws.
 */
async function withCreate(
  userId: string,
  ctx: CreateCtx | undefined,
  insert: (setId: (id: string) => void) => Promise<string>,
): Promise<SaveCreated> {
  if (ctx?.projectId) {
    const { assertProject } = await import("./projects");
    await assertProject(userId, ctx.projectId);
  }
  let saveId: string | undefined;
  try {
    saveId = await insert((id) => {
      saveId = id;
    });
    const placedIn = await afterInsert(userId, saveId, ctx);
    return { ...(await getSave(userId, saveId))!, placedIn };
  } catch (e) {
    if (saveId) {
      await db().from("board_item").delete().eq("user_id", userId).eq("save_id", saveId);
      await db().from("asset").delete().eq("user_id", userId).eq("save_id", saveId);
      await db().from("save").delete().eq("user_id", userId).eq("id", saveId);
    }
    if (ctx?.idempotencyKey && (e instanceof IdempotentReplay || isUniqueViolation(e))) {
      const prior = e instanceof IdempotentReplay ? e.result : await findIdempotent(userId, ctx.idempotencyKey);
      if (prior) throw new IdempotentReplay(prior);
    }
    throw e;
  }
}

export async function getSave(userId: string, id: string): Promise<Save | null> {
  const { data, error } = await db()
    .from("save")
    .select("id, kind, source_url, title, description, preview_url, status, error, duplicate_of, created_at, tags")
    .eq("user_id", userId)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) sbError(error);
  if (!data) return null;
  const assets = await assetsFor(userId, [id]);
  return toSave(data as SaveRow, assets.get(id) ?? null);
}

function encodeCursor(iso: string, id: string): string {
  return Buffer.from(`${iso}|${id}`).toString("base64url");
}

function decodeCursor(c: string): { iso: string; id: string } | null {
  try {
    const [iso, id, extra] = Buffer.from(c, "base64url").toString("utf8").split("|");
    if (extra !== undefined || !iso || !id || Number.isNaN(Date.parse(iso))) return null;
    return { iso, id };
  } catch {
    return null;
  }
}

/** Newest first: created_at desc, id desc. Keyset pagination. */
export async function listSaves(
  userId: string,
  opts: { limit?: number; cursor?: string | null } = {},
): Promise<{ saves: Save[]; next: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  let q = db()
    .from("save")
    .select("id, kind, source_url, title, description, preview_url, status, error, duplicate_of, created_at, tags")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (opts.cursor) {
    const c = decodeCursor(opts.cursor);
    if (!c) throw new ApiError(400, "bad_cursor", "That page cursor isn't valid.");
    // (created_at, id) < (cursor) — quote ISO timestamps for PostgREST.
    q = q.or(`created_at.lt."${c.iso}",and(created_at.eq."${c.iso}",id.lt."${c.id}")`);
  }

  const { data: rows, error } = await q;
  if (error) sbError(error);
  const list = (rows ?? []) as SaveRow[];
  const pageRows = list.slice(0, limit);
  const assets = await assetsFor(userId, pageRows.map((r) => r.id));
  const page = pageRows.map((r) => toSave(r, assets.get(r.id) ?? null));
  const last = page[page.length - 1];
  return { saves: page, next: list.length > limit && last ? encodeCursor(last.createdAt, last.id) : null };
}

async function findDuplicate(userId: string, normalized: string): Promise<string | null> {
  const { data, error } = await db()
    .from("save")
    .select("id")
    .eq("user_id", userId)
    .eq("normalized_url", normalized)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) sbError(error);
  return data?.id ?? null;
}

/** Insert a URL save with status "accepted". `url` must already be validated. */
export async function createUrlSave(
  userId: string,
  input: { url: URL; title?: string | null; note?: string | null },
  ctx?: CreateCtx,
): Promise<SaveCreated> {
  const normalized = normalizeUrl(input.url);
  const dup = await findDuplicate(userId, normalized);
  const userTitle = input.title?.trim() || null;
  return withCreate(userId, ctx, async (setId) => {
    const id = randomUUID();
    const { error } = await db().from("save").insert({
      id,
      user_id: userId,
      kind: "url",
      source_url: input.url.toString(),
      normalized_url: normalized,
      title: userTitle ?? titleFromUrl(input.url),
      title_user: userTitle !== null,
      status: "accepted",
      duplicate_of: dup,
      note: input.note?.trim() || null,
      created_at: new Date().toISOString(),
    });
    if (error) sbError(error);
    setId(id);
    return id;
  });
}

export async function createNoteSave(
  userId: string,
  input: { note: string; title?: string | null },
  ctx?: CreateCtx,
): Promise<SaveCreated> {
  const firstLine = input.note.trim().split("\n")[0].slice(0, 120);
  const userTitle = input.title?.trim() || null;
  const note = input.note.trim();
  return withCreate(userId, ctx, async (setId) => {
    const id = randomUUID();
    const { error } = await db().from("save").insert({
      id,
      user_id: userId,
      kind: "note",
      title: userTitle ?? (firstLine || "Note"),
      title_user: userTitle !== null,
      status: "accepted",
      note,
      extracted_text: note,
      created_at: new Date().toISOString(),
    });
    if (error) sbError(error);
    setId(id);
    return id;
  });
}

/** Insert an uploaded file: save + asset rows (bytes already in Storage). */
export async function createUploadSave(
  userId: string,
  input: {
    kind: "image" | "file";
    title: string;
    mediaType: string;
    bytes: number;
    storagePath: string; // `{userId}/{assetId}` Storage key
    extractedText: string | null;
    sourceUrl?: string | null;
  },
  ctx?: CreateCtx,
): Promise<SaveCreated> {
  const now = new Date().toISOString();
  try {
    return await withCreate(userId, ctx, async (setId) => {
      const saveId = randomUUID();
      const assetId = randomUUID();
      const previewUrl = input.kind === "image" ? `/api/assets/${assetId}` : null;
      const { error } = await db().from("save").insert({
        id: saveId,
        user_id: userId,
        kind: input.kind,
        source_url: input.sourceUrl ?? null,
        title: input.title,
        title_user: true,
        preview_url: previewUrl,
        status: "accepted",
        extracted_text: input.extractedText,
        created_at: now,
      });
      if (error) sbError(error);
      setId(saveId); // before asset insert — withCreate cleans up if asset fails
      const { error: aErr } = await db().from("asset").insert({
        id: assetId,
        user_id: userId,
        save_id: saveId,
        media_type: input.mediaType,
        bytes: input.bytes,
        storage_path: input.storagePath,
        created_at: now,
      });
      if (aErr) sbError(aErr);
      return saveId;
    });
  } catch (e) {
    // Drop the pre-uploaded object when row insert / idempotent race fails.
    await removeAssetObjects(userId, [input.storagePath]).catch(() => {});
    throw e;
  }
}

/** Soft delete. Also removes board items, asset file + rows, and the search index. */
export async function deleteSave(userId: string, id: string): Promise<boolean> {
  const { data: paths, error: pErr } = await db()
    .from("asset")
    .select("storage_path")
    .eq("user_id", userId)
    .eq("save_id", id);
  if (pErr) sbError(pErr);

  const { data: updated, error } = await db()
    .from("save")
    .update({ deleted_at: new Date().toISOString(), extracted_text: null })
    .eq("user_id", userId)
    .eq("id", id)
    .is("deleted_at", null)
    .select("id");
  if (error) sbError(error);
  if (!updated?.length) return false;

  const { error: biErr } = await db().from("board_item").delete().eq("user_id", userId).eq("save_id", id);
  if (biErr) sbError(biErr);
  const { error: aErr } = await db().from("asset").delete().eq("user_id", userId).eq("save_id", id);
  if (aErr) sbError(aErr);
  const { error: jErr } = await db().from("job").delete().eq("user_id", userId).eq("save_id", id);
  if (jErr) sbError(jErr);

  await removeAssetObjects(userId, (paths ?? []).map((r) => r.storage_path)).catch(() => {});
  try {
    await removeSaveIndex(userId, id);
  } catch {
    console.error("[saves] failed to remove search index for a deleted save");
  }
  return true;
}

/** Failed -> accepted. Returns null when the save is missing, "conflict" when it isn't failed. */
export async function resetForRetry(userId: string, id: string): Promise<Save | null | "conflict"> {
  const { data, error } = await db()
    .from("save")
    .update({ status: "accepted", error: null })
    .eq("user_id", userId)
    .eq("id", id)
    .is("deleted_at", null)
    .eq("status", "failed")
    .select("id");
  if (error) sbError(error);
  if (!data?.length) {
    return (await getSave(userId, id)) ? "conflict" : null;
  }
  return getSave(userId, id);
}
