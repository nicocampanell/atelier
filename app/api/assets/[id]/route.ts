import { signedUrlForAsset } from "@/lib/assets";
import { requireUser } from "@/lib/auth";
import { fail, handle } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bearer only → short-lived signed URL redirect. No ?token= query auth. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const userId = await requireUser(req);
    if (typeof userId !== "string") return userId;
    const { id } = await params;
    const url = await signedUrlForAsset(userId, id);
    if (!url) return fail(404, "not_found", "File not found.");
    return Response.redirect(url, 302);
  });
}
