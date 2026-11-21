import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function getServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export function getUserClient(jwt: string): SupabaseClient {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_ANON_KEY!;
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
}

export function bearerFrom(req: Request): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization")?.trim() ?? "");
  return m ? m[1].trim() : null;
}
