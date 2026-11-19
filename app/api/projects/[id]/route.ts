import { requireUser } from "@/lib/auth";
import { ApiError, handle, ok } from "@/lib/http";
import { deleteProject, renameProject } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const userId = await requireUser(req);
    if (typeof userId !== "string") return userId;
    const { id } = await params;
    let body: unknown;
    try {
      body = JSON.parse(await req.text());
    } catch {
      throw new ApiError(400, "bad_request", "Request body must be valid JSON.");
    }
    if (!body || typeof body !== "object") throw new ApiError(400, "bad_request", "Expected a JSON object.");
    return ok(await renameProject(userId, id, (body as Record<string, unknown>).name));
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return handle(async () => {
    const userId = await requireUser(req);
    if (typeof userId !== "string") return userId;
    const { id } = await params;
    return ok(await deleteProject(userId, id));
  });
}
