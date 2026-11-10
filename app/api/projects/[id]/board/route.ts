import { requireUser } from "@/lib/auth";
import { getBoard, putBoard } from "@/lib/board";
import { ApiError, handle, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const userId = requireUser(req);
    if (typeof userId !== "string") return userId;
    const { id } = await params;
    return ok(await getBoard(userId, id));
  });
}

export async function PUT(req: Request, { params }: Ctx) {
  return handle(async () => {
    const userId = requireUser(req);
    if (typeof userId !== "string") return userId;
    const { id } = await params;
    const text = await req.text();
    if (text.length > 8 * 1024 * 1024) throw new ApiError(413, "too_large", "That board is too large.");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError(400, "bad_request", "Request body must be valid JSON.");
    }
    return ok(await putBoard(userId, body, id));
  });
}
