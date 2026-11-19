import { isJevHealthy } from "@/lib/search/jev";
import { ok } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return ok({ semantic: isJevHealthy() });
}
