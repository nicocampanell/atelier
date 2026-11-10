import { MAX_UPLOAD_BYTES, sniffUpload, storeAssetBytes } from "@/lib/assets";
import { requireUser } from "@/lib/auth";
import { SafeFetchError, assertPublicHttpUrl } from "@/lib/fetch-safe";
import { ApiError, fail, handle, ok } from "@/lib/http";
import { enqueueProcessing } from "@/lib/jobs";
import { createNoteSave, createUploadSave, createUrlSave, listSaves } from "@/lib/saves";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Multipart framing adds a little on top of the file itself.
const BODY_SLACK = 1024 * 1024;

export async function GET(req: Request) {
  return handle(async () => {
    const userId = requireUser(req);
    if (typeof userId !== "string") return userId;
    const sp = new URL(req.url).searchParams;
    let limit = 50;
    const rawLimit = sp.get("limit");
    if (rawLimit !== null && rawLimit !== "") {
      limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1) throw new ApiError(400, "bad_request", "limit must be a positive integer.");
      limit = Math.min(limit, 100);
    }
    return ok(await listSaves(userId, { limit, cursor: sp.get("cursor") || null }));
  });
}

/** Read the request body with a hard byte cap (works with or without Content-Length). */
async function readCapped(req: Request, cap: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) throw tooLarge();
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

const tooLarge = () =>
  new ApiError(413, "too_large", `Files can be at most ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);

async function handleUpload(req: Request, userId: string): Promise<Response> {
  const raw = await readCapped(req, MAX_UPLOAD_BYTES + BODY_SLACK);
  let form: FormData;
  try {
    form = await new Response(Buffer.from(raw), { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
  } catch {
    throw new ApiError(400, "bad_request", "Couldn't read the upload.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "bad_request", "Attach a file in the \"file\" field.");
  if (file.size > MAX_UPLOAD_BYTES) throw tooLarge();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) throw new ApiError(400, "bad_request", "That file is empty.");

  const sniffed = sniffUpload(bytes);
  if (!sniffed) {
    throw new ApiError(415, "unsupported_type", "That file type isn't supported. Use PNG, JPEG, GIF, WebP, PDF or plain text.");
  }

  const rawTitle = form.get("title");
  const clientName = file.name.split(/[\\/]/).pop()?.trim() ?? "";
  const title =
    (typeof rawTitle === "string" && rawTitle.trim().slice(0, 300)) ||
    clientName.slice(0, 200) ||
    (sniffed.kind === "image" ? "Untitled image" : "Untitled file");

  const storagePath = await storeAssetBytes(userId, bytes);
  const save = await createUploadSave(userId, {
    kind: sniffed.kind,
    title,
    mediaType: sniffed.mediaType,
    bytes: bytes.length,
    storagePath,
    extractedText: sniffed.text ? sniffed.text.slice(0, 200_000) : null,
  });
  enqueueProcessing(userId, save.id);
  return ok(save, 202);
}

async function handleJson(req: Request, userId: string): Promise<Response> {
  const raw = await readCapped(req, 256 * 1024);
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch {
    throw new ApiError(400, "bad_request", "Request body must be valid JSON.");
  }
  if (!body || typeof body !== "object") throw new ApiError(400, "bad_request", "Request body must be a JSON object.");
  const { url, title, note } = body as Record<string, unknown>;
  if (title !== undefined && title !== null && (typeof title !== "string" || title.length > 500)) {
    throw new ApiError(400, "bad_request", "title must be a string up to 500 characters.");
  }
  if (note !== undefined && note !== null && (typeof note !== "string" || note.length > 20_000)) {
    throw new ApiError(400, "bad_request", "note must be a string up to 20000 characters.");
  }

  if (url === undefined || url === null || url === "") {
    if (typeof note !== "string" || !note.trim()) throw new ApiError(400, "bad_request", "Provide a url (or a note).");
    const save = await createNoteSave(userId, { note, title: title as string | null | undefined });
    enqueueProcessing(userId, save.id);
    return ok(save, 202);
  }
  if (typeof url !== "string" || url.length > 2048) throw new ApiError(400, "bad_request", "url must be a string up to 2048 characters.");

  let parsed: URL;
  try {
    parsed = assertPublicHttpUrl(url.trim());
  } catch (e) {
    if (e instanceof SafeFetchError) throw new ApiError(400, e.code, e.message);
    throw e;
  }
  const save = await createUrlSave(userId, { url: parsed, title: title as string | null | undefined, note: note as string | null | undefined });
  enqueueProcessing(userId, save.id); // background; not awaited
  return ok(save, 202);
}

export async function POST(req: Request) {
  return handle(async () => {
    const userId = requireUser(req);
    if (typeof userId !== "string") return userId;
    const ct = (req.headers.get("content-type") ?? "").toLowerCase();
    if (ct.startsWith("multipart/form-data")) return handleUpload(req, userId);
    if (ct.startsWith("application/json")) return handleJson(req, userId);
    return fail(415, "unsupported_type", "Send JSON or multipart/form-data.");
  });
}
