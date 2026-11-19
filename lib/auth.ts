import { fail } from "./http";
import { bearerFrom, getServiceClient } from "./supabase";

type GetUser = (jwt: string) => Promise<{ data: { user: { id?: string; email?: string } | null }; error: unknown }>;

// Injectable so scripts/verify-auth-supabase.ts runs without a live Supabase.
const supabaseGetUser: GetUser = (jwt) => getServiceClient().auth.getUser(jwt);

/** Returns the Supabase auth user uuid for the owner's JWT, or null. */
export async function authenticate(req: Request, getUser: GetUser = supabaseGetUser): Promise<string | null> {
  const jwt = bearerFrom(req);
  if (!jwt) return null;
  const { data, error } = await getUser(jwt);
  if (error || !data.user?.id || !data.user.email) return null;
  const owner = process.env.ATELIER_OWNER_EMAIL?.trim().toLowerCase();
  if (!owner || data.user.email.toLowerCase() !== owner) return null;
  return data.user.id;
}

/** Returns the user id, or a ready-to-return 401 Response. */
export async function requireUser(req: Request): Promise<string | Response> {
  const userId = await authenticate(req);
  if (userId) return userId;
  return fail(401, "unauthorized", "Missing or invalid access token.", { "WWW-Authenticate": "Bearer" });
}
