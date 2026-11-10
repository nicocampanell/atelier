// Upload sniffing, storage and lookup of asset bytes.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDataDir, getDb } from "./db";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface Sniffed {
  kind: "image" | "file";
  mediaType: string;
  text: string | null;
}

function startsWith(b: Uint8Array, sig: number[], offset = 0): boolean {
  return sig.every((v, i) => b[offset + i] === v);
}

/** Identify an upload by its bytes only. Returns null when it isn't on the allowlist. */
export function sniffUpload(b: Uint8Array): Sniffed | null {
  if (b.length === 0) return null;
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: "image", mediaType: "image/png", text: null };
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { kind: "image", mediaType: "image/jpeg", text: null };
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(b, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) {
    return { kind: "image", mediaType: "image/gif", text: null };
  }
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { kind: "image", mediaType: "image/webp", text: null };
  }
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { kind: "file", mediaType: "application/pdf", text: null };

  // Plain text: valid UTF-8, no NUL bytes, and not markup that browsers would render.
  if (b.includes(0)) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    return null;
  }
  if (/^\s*<(\?xml|!doctype|html|svg|script|head|body)/i.test(text.replace(/^﻿/, ""))) return null;
  return { kind: "file", mediaType: "text/plain", text: text.replace(/^﻿/, "") };
}

function safeSegment(s: string): string {
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : Buffer.from(s).toString("hex").slice(0, 64);
}

/** Write bytes under assets/<user>/<random id>. Returns the path relative to the data dir. */
export async function storeAssetBytes(userId: string, bytes: Uint8Array): Promise<string> {
  const rel = path.join("assets", safeSegment(userId), randomUUID());
  const full = path.join(getDataDir(), rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes, { flag: "wx", mode: 0o600 });
  return rel;
}

export interface AssetFile {
  mediaType: string;
  bytes: Buffer;
}

/** Owner-filtered lookup; null when missing, foreign, or its save is deleted. */
export async function readAsset(userId: string, assetId: string): Promise<AssetFile | null> {
  const db = await getDb();
  const r = await db.query<{ media_type: string; storage_path: string }>(
    `select a.media_type, a.storage_path
     from asset a join save s on s.id = a.save_id and s.user_id = a.user_id
     where a.user_id = $1 and a.id = $2 and s.deleted_at is null`,
    [userId, assetId],
  );
  const row = r.rows[0];
  if (!row) return null;
  const root = path.resolve(getDataDir(), "assets") + path.sep;
  const full = path.resolve(getDataDir(), row.storage_path);
  if (!full.startsWith(root)) return null;
  try {
    return { mediaType: row.media_type, bytes: await readFile(full) };
  } catch {
    return null;
  }
}
