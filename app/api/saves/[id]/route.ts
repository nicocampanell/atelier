import { requireUser } from "@/lib/auth";
import { fail, handle, ok } from "@/lib/http";
import { deleteSave, getSave } from "@/lib/saves";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const userId = await requireUser(req);
    if (typeof userId !== "string") return userId;
    const { id } = await params;
    const save = await getSave(userId, id);
    return save ? ok(save) : fail(404, "not_found", "Save not found.");
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return handle(async () => {
    const userId = await requireUser(req);
    if (typeof userId !== "string") return userId;
    const { id } = await params;
    return (await deleteSave(userId, id)) ? ok({ id }) : fail(404, "not_found", "Save not found.");
  });
}
