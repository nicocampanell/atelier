// CORS for /api/*: only origins listed in ATELIER_ALLOWED_ORIGINS (comma-separated)
// get Access-Control-* headers. Next 16 calls this file convention "proxy".
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function allowedOrigins(): string[] {
  return (process.env.ATELIER_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function proxy(req: NextRequest) {
  const origin = req.headers.get("origin");
  const allowed = origin !== null && allowedOrigins().includes(origin);

  if (req.method === "OPTIONS") {
    const res = new NextResponse(null, { status: 204 });
    if (allowed) {
      res.headers.set("Access-Control-Allow-Origin", origin);
      res.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key");
      res.headers.set("Access-Control-Max-Age", "600");
      res.headers.set("Vary", "Origin");
    }
    return res;
  }

  const res = NextResponse.next();
  if (allowed) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
  }
  return res;
}

export const config = { matcher: "/api/:path*" };
