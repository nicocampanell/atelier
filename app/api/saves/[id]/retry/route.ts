import { requireUser } from "@/lib/auth";
import { fail, handle, ok } from "@/lib/http";
import { enqueueProcessing } from "@/lib/jobs";
import { resetForRetry } from "@/lib/saves";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const userId = requireUser(req);
    if (typeof userId !== "string") return userId;
    const { id } = await params;
    const r = await resetForRetry(userId, id);
    if (r === null) return fail(404, "not_found", "Save not found.");
    if (r === "conflict") return fail(409, "not_failed", "Only failed saves can be retried.");
    enqueueProcessing(userId, id);
    return ok(r, 202);
  });
}
