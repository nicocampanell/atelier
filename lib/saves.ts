// Data access for saves. Every function takes userId first and every query
// filters on user_id.
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { getDataDir, getDb } from "./db";
import { ApiError } from "./http";
import { removeSaveIndex } from "./search/index";
import type { Save, SaveKind, SaveStatus } from "./types";

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
  created_at: Date | string;
  media_type: string | null;
  bytes: number | null;
}

const SELECT = `
  select s.id, s.kind, s.source_url, s.title, s.description, s.preview_url, s.status,
         s.error, s.duplicate_of, s.created_at, a.media_type, a.bytes
  from save s
  left join asset a on a.save_id = s.id and a.user_id = s.user_id`;

function toSave(r: SaveRow): Save {
  return {
    id: r.id,
    kind: r.kind as SaveKind,
    sourceUrl: r.source_url,
    title: r.title,
    description: r.description,
    previewUrl: r.preview_url,
    asset: r.media_type ? { mediaType: r.media_type, bytes: r.bytes ?? 0 } : null,
    status: r.status as SaveStatus,
    error: r.error,
    duplicateOf: r.duplicate_of,
    createdAt: new Date(r.created_at).toISOString(),
  };
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

export async function getSave(userId: string, id: string): Promise<Save | null> {
  const db = await getDb();
  const r = await db.query<SaveRow>(`${SELECT} where s.user_id = $1 and s.id = $2 and s.deleted_at is null`, [userId, id]);
  return r.rows[0] ? toSave(r.rows[0]) : null;
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
  const db = await getDb();
  let rows: SaveRow[];
  if (opts.cursor) {
    const c = decodeCursor(opts.cursor);
    if (!c) throw new ApiError(400, "bad_cursor", "That page cursor isn't valid.");
    rows = (
      await db.query<SaveRow>(
        `${SELECT} where s.user_id = $1 and s.deleted_at is null
           and (s.created_at, s.id) < ($2::timestamptz, $3)
         order by s.created_at desc, s.id desc limit $4`,
        [userId, c.iso, c.id, limit + 1],
      )
    ).rows;
  } else {
    rows = (
      await db.query<SaveRow>(
        `${SELECT} where s.user_id = $1 and s.deleted_at is null
         order by s.created_at desc, s.id desc limit $2`,
        [userId, limit + 1],
      )
    ).rows;
  }
  const page = rows.slice(0, limit).map(toSave);
  const last = page[page.length - 1];
  return { saves: page, next: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null };
}

async function findDuplicate(userId: string, normalized: string): Promise<string | null> {
  const db = await getDb();
  const r = await db.query<{ id: string }>(
    `select id from save where user_id = $1 and normalized_url = $2 and deleted_at is null
     order by created_at desc, id desc limit 1`,
    [userId, normalized],
  );
  return r.rows[0]?.id ?? null;
}

/** Insert a URL save with status "accepted". `url` must already be validated. */
export async function createUrlSave(
  userId: string,
  input: { url: URL; title?: string | null; note?: string | null },
): Promise<Save> {
  const db = await getDb();
  const id = randomUUID();
  const normalized = normalizeUrl(input.url);
  const dup = await findDuplicate(userId, normalized);
  const userTitle = input.title?.trim() || null;
  await db.query(
    `insert into save (id, user_id, kind, source_url, normalized_url, title, title_user, status, duplicate_of, note, created_at)
     values ($1,$2,'url',$3,$4,$5,$6,'accepted',$7,$8,$9::timestamptz)`,
    [
      id, userId, input.url.toString(), normalized, userTitle ?? titleFromUrl(input.url),
      userTitle !== null, dup, input.note?.trim() || null, new Date().toISOString(),
    ],
  );
  return (await getSave(userId, id))!;
}

export async function createNoteSave(userId: string, input: { note: string; title?: string | null }): Promise<Save> {
  const db = await getDb();
  const id = randomUUID();
  const firstLine = input.note.trim().split("\n")[0].slice(0, 120);
  const userTitle = input.title?.trim() || null;
  await db.query(
    `insert into save (id, user_id, kind, title, title_user, status, note, extracted_text, created_at)
     values ($1,$2,'note',$3,$4,'accepted',$5,$5,$6::timestamptz)`,
    [id, userId, userTitle ?? (firstLine || "Note"), userTitle !== null, input.note.trim(), new Date().toISOString()],
  );
  return (await getSave(userId, id))!;
}

/** Insert an uploaded file: save + asset rows (bytes are already on disk). */
export async function createUploadSave(
  userId: string,
  input: {
    kind: "image" | "file";
    title: string;
    mediaType: string;
    bytes: number;
    storagePath: string; // relative to the data dir
    extractedText: string | null;
  },
): Promise<Save> {
  const db = await getDb();
  const saveId = randomUUID();
  const assetId = randomUUID();
  const previewUrl = input.kind === "image" ? `/api/assets/${assetId}` : null;
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.query(
      `insert into save (id, user_id, kind, title, title_user, preview_url, status, extracted_text, created_at)
       values ($1,$2,$3,$4,true,$5,'accepted',$6,$7::timestamptz)`,
      [saveId, userId, input.kind, input.title, previewUrl, input.extractedText, now],
    );
    await tx.query(
      `insert into asset (id, user_id, save_id, media_type, bytes, storage_path, created_at)
       values ($1,$2,$3,$4,$5,$6,$7::timestamptz)`,
      [assetId, userId, saveId, input.mediaType, input.bytes, input.storagePath, now],
    );
  });
  return (await getSave(userId, saveId))!;
}

/** Soft delete. Also removes board items, asset file + rows, and the search index. */
export async function deleteSave(userId: string, id: string): Promise<boolean> {
  const db = await getDb();
  const paths = (
    await db.query<{ storage_path: string }>(`select storage_path from asset where user_id = $1 and save_id = $2`, [userId, id])
  ).rows.map((r) => r.storage_path);

  const deleted = await db.transaction(async (tx) => {
    const r = await tx.query(
      `update save set deleted_at = now(), extracted_text = null where user_id = $1 and id = $2 and deleted_at is null returning id`,
      [userId, id],
    );
    if (r.rows.length === 0) return false;
    await tx.query(`delete from board_item where user_id = $1 and save_id = $2`, [userId, id]);
    await tx.query(`delete from asset where user_id = $1 and save_id = $2`, [userId, id]);
    await tx.query(`delete from job where user_id = $1 and save_id = $2`, [userId, id]);
    return true;
  });
  if (!deleted) return false;

  const root = path.resolve(getDataDir(), "assets") + path.sep;
  for (const rel of paths) {
    const full = path.resolve(getDataDir(), rel);
    if (full.startsWith(root)) await unlink(full).catch(() => {});
  }
  try {
    await removeSaveIndex(userId, id);
  } catch {
    console.error("[saves] failed to remove search index for a deleted save");
  }
  return true;
}

/** Failed -> accepted. Returns null when the save is missing, "conflict" when it isn't failed. */
export async function resetForRetry(userId: string, id: string): Promise<Save | null | "conflict"> {
  const db = await getDb();
  const r = await db.query(
    `update save set status = 'accepted', error = null
     where user_id = $1 and id = $2 and deleted_at is null and status = 'failed' returning id`,
    [userId, id],
  );
  if (r.rows.length === 0) {
    return (await getSave(userId, id)) ? "conflict" : null;
  }
  return getSave(userId, id);
}
