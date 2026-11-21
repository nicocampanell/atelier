import { requireUser } from "@/lib/auth";
import { fail, handle, ok } from "@/lib/http";
import { scheduleProcessSave } from "@/lib/jobs";
import { resetForRetry } from "@/lib/saves";
import { after } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const userId = await requireUser(req);
    if (typeof userId !== "string") return userId;
    const { id } = await params;
    const r = await resetForRetry(userId, id);
    if (r === null) return fail(404, "not_found", "Save not found.");
    if (r === "conflict") return fail(409, "not_failed", "Only failed saves can be retried.");
    scheduleProcessSave((p) => after(() => p), userId, id);
    return ok(r, 202);
  });
}
