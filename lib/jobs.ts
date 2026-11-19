// Background processing for saves (in-process). Status flow:
// accepted -> processing -> ready | failed. Every path ends in ready or failed.
import { getDb } from "./db";
import { decodeBody, extractHtml, MAX_TEXT_CHARS } from "./extract";
import { SafeFetchError, safeFetch } from "./fetch-safe";
import { indexSave } from "./search/index";
import { loadSaveImage } from "./search/image";
import { visualTags } from "./search/tags";
import { titleFromUrl } from "./saves";
import type { SaveKind } from "./types";

const OVERALL_TIMEOUT_MS = 60_000;
const MAX_CONCURRENT = 3;

type G = typeof globalThis & {
  __atelierJobs?: { inflight: Set<string>; queue: Array<() => Promise<void>>; active: number };
};
const g = globalThis as G;
const state = (g.__atelierJobs ??= { inflight: new Set(), queue: [], active: 0 });

function pump() {
  while (state.active < MAX_CONCURRENT && state.queue.length) {
    const job = state.queue.shift()!;
    state.active++;
    job().finally(() => {
      state.active--;
      pump();
    });
  }
}

function enqueue(key: string, run: () => Promise<void>): void {
  if (state.inflight.has(key)) return;
  state.inflight.add(key);
  state.queue.push(async () => {
    try {
      await run();
    } finally {
      state.inflight.delete(key);
    }
  });
  pump();
}

/** Queue background processing for a save. Safe to call twice for the same id. */
export function enqueueProcessing(userId: string, saveId: string): void {
  enqueue(`${userId}:${saveId}`, () => processSave(userId, saveId));
}

/** On first DB open: pick up saves a previous process left half-done, then tag untagged ones. */
export async function requeueStuck(): Promise<void> {
  const db = await getDb();
  const r = await db.query<{ id: string; user_id: string }>(
    `select id, user_id from save where deleted_at is null and status in ('accepted','processing') order by created_at`,
  );
  for (const row of r.rows) enqueueProcessing(row.user_id, row.id);
  if (!process.env.TYPESAFE_API_KEY?.trim()) return;
  const untagged = await db.query<{ id: string; user_id: string }>(
    `select id, user_id from save where deleted_at is null and status = 'ready' and tags is null order by created_at desc`,
  );
  for (const row of untagged.rows) {
    enqueue(`${row.user_id}:${row.id}:tags`, () => retagSave(row.user_id, row.id).catch(() => {}));
  }
}

function readable(e: unknown): string {
  if (e instanceof SafeFetchError) return e.message;
  if (e instanceof Error && e.message === "TIMEOUT") return "Processing took too long. Try again later.";
  return "Something went wrong while processing this save.";
}

async function markFailed(userId: string, id: string, message: string) {
  try {
    const db = await getDb();
    await db.query(
      `update save set status = 'failed', error = $3
       where user_id = $1 and id = $2 and deleted_at is null and status in ('accepted','processing')`,
      [userId, id, message.slice(0, 500)],
    );
  } catch {
    /* nothing more we can do */
  }
}

export async function processSave(userId: string, saveId: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      doProcess(userId, saveId),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("TIMEOUT")), OVERALL_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    if (!(e instanceof SafeFetchError)) console.error("[jobs] processing failed:", e instanceof Error ? e.message : "unknown");
    await markFailed(userId, saveId, readable(e));
  } finally {
    clearTimeout(timer);
  }
}

interface Row {
  kind: SaveKind;
  source_url: string | null;
  title: string;
  title_user: boolean;
  description: string | null;
  preview_url: string | null;
  note: string | null;
  extracted_text: string | null;
}

async function doProcess(userId: string, saveId: string): Promise<void> {
  const db = await getDb();
  const claimed = await db.query<Row>(
    `update save set status = 'processing', error = null
     where user_id = $1 and id = $2 and deleted_at is null and status in ('accepted','processing')
     returning kind, source_url, title, title_user, description, preview_url, note, extracted_text`,
    [userId, saveId],
  );
  const row = claimed.rows[0];
  if (!row) return; // deleted or already finished

  let title = row.title;
  let description = row.description;
  let previewUrl = row.preview_url;
  let text = row.extracted_text ?? "";

  if (row.kind === "url" && row.source_url) {
    const r = await safeFetch(row.source_url, { maxBytes: 5 * 1024 * 1024, timeoutMs: 15_000, maxRedirects: 5 });
    if (r.status >= 400) throw new SafeFetchError("network", `The site responded with an error (HTTP ${r.status}).`);
    const ct = r.contentType.split(";")[0].trim();
    const fallbackTitle = titleFromUrl(new URL(r.finalUrl));
    if (ct === "text/html" || ct === "application/xhtml+xml" || ct === "") {
      const info = extractHtml(decodeBody(r.body, r.contentType), r.finalUrl);
      if (!row.title_user) title = info.title ?? fallbackTitle;
      description = info.description;
      previewUrl = info.image;
      text = info.text;
    } else if (ct.startsWith("image/")) {
      if (!row.title_user) title = fallbackTitle;
      previewUrl = r.finalUrl;
      text = "";
    } else if (ct === "text/plain") {
      if (!row.title_user) title = fallbackTitle;
      text = decodeBody(r.body, r.contentType).slice(0, MAX_TEXT_CHARS);
    } else if (!row.title_user) {
      title = fallbackTitle;
    }
    await db.query(
      `update save set title = $3, description = $4, preview_url = $5, extracted_text = $6
       where user_id = $1 and id = $2 and deleted_at is null`,
      [userId, saveId, title, description, previewUrl, text],
    );
  }

  const tags = await tagsFor(userId, saveId, previewUrl);
  await indexSave(userId, saveId, { title, description, text: indexText(row, text), sourceUrl: row.source_url, kind: row.kind, tags });

  const done = await db.query(
    `update save set status = 'ready', error = null, tags = $3
     where user_id = $1 and id = $2 and deleted_at is null and status = 'processing' returning id`,
    [userId, saveId, tags],
  );
  if (done.rows.length === 0) {
    // Deleted while we were working: make sure nothing lingers in the index.
    const { removeSaveIndex } = await import("./search/index");
    await removeSaveIndex(userId, saveId).catch(() => {});
  }
}

function indexText(row: Pick<Row, "kind" | "note">, text: string): string {
  return row.note && row.kind === "url" ? `${row.note}\n${text}` : text;
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Visual tags for a save: [] when it has no image, null when tagging failed (retried on next startup). */
async function tagsFor(userId: string, saveId: string, previewUrl: string | null): Promise<string[] | null> {
  const db = await getDb();
  const asset = (await db.query<{ storage_path: string; media_type: string; bytes: number }>(
    `select storage_path, media_type, bytes from asset where user_id = $1 and save_id = $2 limit 1`,
    [userId, saveId],
  )).rows[0];
  const hasImage = asset ? IMAGE_TYPES.includes(asset.media_type) : Boolean(previewUrl && /^https?:\/\//i.test(previewUrl));
  if (!hasImage) return [];
  if (!process.env.TYPESAFE_API_KEY?.trim()) return null;
  const image = await loadSaveImage(
    { storagePath: asset?.storage_path ?? null, mediaType: asset?.media_type ?? null, bytes: asset?.bytes ?? null, previewUrl },
    10_000,
  );
  return image ? visualTags(image) : null;
}

/** Tag a ready save that has no tags yet and re-index it with them. */
async function retagSave(userId: string, saveId: string): Promise<void> {
  const db = await getDb();
  const row = (await db.query<Row>(
    `select kind, source_url, title, title_user, description, preview_url, note, extracted_text
     from save where user_id = $1 and id = $2 and deleted_at is null and status = 'ready' and tags is null`,
    [userId, saveId],
  )).rows[0];
  if (!row) return;
  const tags = await tagsFor(userId, saveId, row.preview_url);
  if (!tags) return;
  await indexSave(userId, saveId, {
    title: row.title, description: row.description, text: indexText(row, row.extracted_text ?? ""),
    sourceUrl: row.source_url, kind: row.kind, tags,
  });
  await db.query(`update save set tags = $3 where user_id = $1 and id = $2 and deleted_at is null`, [userId, saveId, tags]);
}
