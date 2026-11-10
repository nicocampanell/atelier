import { createHash, timingSafeEqual } from "node:crypto";
import { fail } from "./http";

/** Single-owner v1: a valid token maps to this user id. */
export const OWNER_USER_ID = "owner";

function sha(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

function tokenMatches(provided: string | null | undefined): boolean {
  const expected = process.env.ATELIER_TOKEN; // read per request
  if (!expected || !provided) return false; // never accept an empty token
  return timingSafeEqual(sha(provided), sha(expected));
}

/** Returns the user id for an authenticated request, or null. */
export function authenticate(req: Request, opts: { allowQueryToken?: boolean } = {}): string | null {
  const header = req.headers.get("authorization");
  let token: string | null = null;
  if (header) {
    const m = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (m) token = m[1].trim();
  }
  if (!token && opts.allowQueryToken) {
    token = new URL(req.url).searchParams.get("token");
  }
  return tokenMatches(token) ? OWNER_USER_ID : null;
}

/** Returns the user id, or a ready-to-return 401 Response. */
export function requireUser(req: Request, opts: { allowQueryToken?: boolean } = {}): string | Response {
  const userId = authenticate(req, opts);
  if (userId) return userId;
  return fail(401, "unauthorized", "Missing or invalid access token.", { "WWW-Authenticate": "Bearer" });
}
