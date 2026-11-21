import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.WXT_SUPABASE_URL as string | undefined;
const anon = import.meta.env.WXT_SUPABASE_ANON_KEY as string | undefined;

/** Null when build env is missing — sign-in shows a config message. */
export const supabase: SupabaseClient | null =
  url && anon ? createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
