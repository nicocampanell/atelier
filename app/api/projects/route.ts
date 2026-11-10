import { requireUser } from "@/lib/auth";
import { ApiError, handle, ok } from "@/lib/http";
import { createProject, listProjects } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const userId = requireUser(req);
    if (typeof userId !== "string") return userId;
    return ok({ projects: await listProjects(userId) });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const userId = requireUser(req);
    if (typeof userId !== "string") return userId;
    let body: unknown;
    try {
      body = JSON.parse(await req.text());
    } catch {
      throw new ApiError(400, "bad_request", "Request body must be valid JSON.");
    }
    if (!body || typeof body !== "object") throw new ApiError(400, "bad_request", "Expected a JSON object.");
    return ok(await createProject(userId, (body as Record<string, unknown>).name), 201);
  });
}
