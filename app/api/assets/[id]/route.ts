import { readAsset } from "@/lib/assets";
import { requireUser } from "@/lib/auth";
import { fail, handle } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const userId = requireUser(req, { allowQueryToken: true });
    if (typeof userId !== "string") return userId;
    const { id } = await params;
    const asset = await readAsset(userId, id);
    if (!asset) return fail(404, "not_found", "File not found.");
    const isImage = asset.mediaType.startsWith("image/");
    return new Response(new Uint8Array(asset.bytes), {
      status: 200,
      headers: {
        "Content-Type": asset.mediaType === "text/plain" ? "text/plain; charset=utf-8" : asset.mediaType,
        "Content-Length": String(asset.bytes.length),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, max-age=3600",
        ...(isImage ? {} : { "Content-Disposition": "attachment" }),
      },
    });
  });
}
