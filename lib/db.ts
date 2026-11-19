// Data directory (local asset bytes) + Supabase service client for all queries.
import path from "node:path";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "./supabase";

type G = typeof globalThis & { __atelierJobsKicked?: boolean };

/** Root of uploaded files on disk. Storage bucket rewrite is Task 4. */
export function getDataDir(): string {
  return path.resolve(process.env.ATELIER_DATA_DIR ?? "./.data");
}

/**
 * Service-role client for route-layer mutations.
 * Every query must still filter by userId (RLS is bypassed).
 */
export function db(): SupabaseClient {
  kickJobsOnce();
  return getServiceClient();
}

function kickJobsOnce(): void {
  const g = globalThis as G;
  if (g.__atelierJobsKicked) return;
  g.__atelierJobsKicked = true;
  // Fire-and-forget: re-queue saves left in accepted/processing.
  setTimeout(() => {
    import("./jobs").then((m) => m.requeueStuck()).catch(() => {});
  }, 0);
}

export function sbError(error: PostgrestError | null, fallback = "Database error"): never {
  throw new Error(error?.message ?? fallback);
}

export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}
