import { requireUser } from "@/lib/auth";
import { ApiError, handle, ok } from "@/lib/http";
import { search } from "@/lib/search";
import type { SaveKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: SaveKind[] = ["url", "image", "file", "note"];
const MAX_Q = 500;

export async function GET(req: Request) {
  return handle(async () => {
    const userId = await requireUser(req);
    if (typeof userId !== "string") return userId;
    const sp = new URL(req.url).searchParams;
    const q = (sp.get("q") ?? "").trim();
    if (q.length > MAX_Q) throw new ApiError(400, "bad_request", `q can be at most ${MAX_Q} characters.`);

    let kinds: SaveKind[] | undefined;
    const rawKinds = sp.get("kinds");
    if (rawKinds) {
      const parts = rawKinds.split(",").map((s) => s.trim()).filter(Boolean);
      const bad = parts.find((p) => !KINDS.includes(p as SaveKind));
      if (bad) throw new ApiError(400, "bad_request", `Unknown kind "${bad.slice(0, 20)}". Use ${KINDS.join(", ")}.`);
      kinds = parts as SaveKind[];
    }
    return ok(await search(userId, q, { kinds }));
  });
}
