// Upload sniffing, storage and lookup of asset bytes.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { db, getDataDir, sbError } from "./db";

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
  const { data: row, error } = await db()
    .from("asset")
    .select("media_type, storage_path, save_id")
    .eq("user_id", userId)
    .eq("id", assetId)
    .maybeSingle();
  if (error) sbError(error);
  if (!row) return null;

  const { data: save, error: sErr } = await db()
    .from("save")
    .select("id")
    .eq("user_id", userId)
    .eq("id", row.save_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (sErr) sbError(sErr);
  if (!save) return null;

  const root = path.resolve(getDataDir(), "assets") + path.sep;
  const full = path.resolve(getDataDir(), row.storage_path);
  if (!full.startsWith(root)) return null;
  try {
    return { mediaType: row.media_type, bytes: await readFile(full) };
  } catch {
    return null;
  }
}

/** Pixel size from PNG / GIF / JPEG headers, or null (also for WebP and anything unknown). */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length >= 24 && startsWith(b, [0x89, 0x50, 0x4e, 0x47])) return { w: dv.getUint32(16), h: dv.getUint32(20) };
  if (b.length >= 10 && startsWith(b, [0x47, 0x49, 0x46])) return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: dv.getUint16(i + 5), w: dv.getUint16(i + 7) };
      i += 2 + dv.getUint16(i + 2);
    }
  }
  return null;
}
