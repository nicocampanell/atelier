import { requeueStuck } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cloudflare Cron Trigger (Task 6) hits this to requeue stuck/untagged saves. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  await requeueStuck();
  return Response.json({ ok: true });
}
