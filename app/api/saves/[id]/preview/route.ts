import { sniffUpload } from "@/lib/assets";
import { requireUser } from "@/lib/auth";
import { SafeFetchError, safeFetch } from "@/lib/fetch-safe";
import { fail, handle } from "@/lib/http";
import { getSave } from "@/lib/saves";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;
const PREVIEW_TIMEOUT_MS = 8_000;

/** Return a saved external preview to its owner without exposing their bearer to the source. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const response = await handle(async () => {
    const userId = await requireUser(req);
    if (typeof userId !== "string") return userId;

    const { id } = await params;
    const save = await getSave(userId, id);
    if (!save?.previewUrl || save.previewUrl.startsWith("/")) {
      return fail(404, "not_found", "External preview not found.");
    }

    let preview;
    try {
      preview = await safeFetch(save.previewUrl, { maxBytes: MAX_PREVIEW_BYTES, timeoutMs: PREVIEW_TIMEOUT_MS });
    } catch (error) {
      if (error instanceof SafeFetchError && error.code === "too_large") {
        return fail(413, "too_large", "Preview exceeds the 4 MiB limit.");
      }
      return fail(502, "preview_unavailable", "Couldn't retrieve the saved preview.");
    }

    if (preview.status < 200 || preview.status >= 300) {
      return fail(502, "preview_unavailable", "Couldn't retrieve the saved preview.");
    }
    const image = sniffUpload(preview.body);
    const contentType = preview.contentType.split(";", 1)[0].trim().toLowerCase();
    if (!image || image.kind !== "image" || contentType !== image.mediaType) {
      return fail(415, "unsupported_preview", "Saved preview is not a supported image.");
    }
    return new Response(new Uint8Array(preview.body), {
      headers: {
        "Content-Type": image.mediaType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
