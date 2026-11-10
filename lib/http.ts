import type { ApiResult } from "./types";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json<T>(body: ApiResult<T>, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

export function ok<T>(data: T, status = 200): Response {
  return json<T>({ ok: true, data }, status);
}

export function fail(status: number, code: string, message: string, headers?: HeadersInit): Response {
  return json<never>({ ok: false, error: { code, message } }, status, headers);
}

/** Run a route body; turn ApiError into an envelope and anything else into a generic 500. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) return fail(e.status, e.code, e.message);
    console.error("[api] unexpected error:", e instanceof Error ? e.message : "unknown");
    return fail(500, "internal", "Something went wrong on our side. Please try again.");
  }
}
