// Background processing for saves (in-process). Status flow:
// accepted -> processing -> ready | failed. Every path ends in ready or failed.
import { getDb } from "./db";
import { decodeBody, extractHtml, MAX_TEXT_CHARS } from "./extract";
import { SafeFetchError, safeFetch } from "./fetch-safe";
import { indexSave } from "./search/index";
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

/** Queue background processing for a save. Safe to call twice for the same id. */
export function enqueueProcessing(userId: string, saveId: string): void {
  const key = `${userId}:${saveId}`;
  if (state.inflight.has(key)) return;
  state.inflight.add(key);
  state.queue.push(async () => {
    try {
      await processSave(userId, saveId);
    } finally {
      state.inflight.delete(key);
    }
  });
  pump();
}

/** On first DB open: pick up saves a previous process left half-done. */
export async function requeueStuck(): Promise<void> {
  const db = await getDb();
  const r = await db.query<{ id: string; user_id: string }>(
    `select id, user_id from save where deleted_at is null and status in ('accepted','processing') order by created_at`,
  );
  for (const row of r.rows) enqueueProcessing(row.user_id, row.id);
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

  const indexText = row.note && row.kind === "url" ? `${row.note}\n${text}` : text;
  await indexSave(userId, saveId, { title, description, text: indexText, sourceUrl: row.source_url, kind: row.kind });

  const done = await db.query(
    `update save set status = 'ready', error = null
     where user_id = $1 and id = $2 and deleted_at is null and status = 'processing' returning id`,
    [userId, saveId],
  );
  if (done.rows.length === 0) {
    // Deleted while we were working: make sure nothing lingers in the index.
    const { removeSaveIndex } = await import("./search/index");
    await removeSaveIndex(userId, saveId).catch(() => {});
  }
}
