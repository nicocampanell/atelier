// Authenticated fetch client. Access token only goes in the Authorization header.
import type { ApiResult } from "../../lib/types";
import type { ExtensionSettings } from "../lib/contracts";
import { setSettings } from "./settings";
import { supabase } from "./supabase";

export interface ApiError {
  code: string;
  message: string;
  status: number;
  /** Network failures and 5xx / 408 / 429 are worth retrying; other 4xx are not. */
  retry: boolean;
}
export type Envelope<T> = { ok: true; data: T; status: number } | { ok: false; error: ApiError };

export interface ApiInit {
  method?: string;
  json?: unknown;
  form?: FormData;
  idempotencyKey?: string;
}

export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

type AuthSettings = Pick<ExtensionSettings, "serverUrl" | "accessToken" | "refreshToken">;

async function refreshOnce(refreshToken: string): Promise<{ accessToken: string; refreshToken: string } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) return null;
  const next = { accessToken: data.session.access_token, refreshToken: data.session.refresh_token };
  await setSettings(next);
  return next;
}

export async function apiFetch<T>(
  settings: AuthSettings,
  path: string,
  init: ApiInit = {},
  retried = false,
): Promise<Envelope<T>> {
  const headers: Record<string, string> = {};
  if (settings.accessToken) headers.authorization = `Bearer ${settings.accessToken}`;
  if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  } else if (init.form) {
    body = init.form;
  }
  let res: Response;
  try {
    res = await fetch(settings.serverUrl.replace(/\/+$/, "") + path, {
      method: init.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    let host = settings.serverUrl;
    try {
      host = new URL(settings.serverUrl).host;
    } catch {}
    return {
      ok: false,
      error: { code: "network", message: `Can't reach Atelier at ${host}. Is it running?`, status: 0, retry: true },
    };
  }

  if (res.status === 401 && !retried && settings.refreshToken) {
    const next = await refreshOnce(settings.refreshToken);
    if (next) return apiFetch({ ...settings, ...next }, path, init, true);
  }

  let parsed: ApiResult<T> | null = null;
  try {
    parsed = (await res.json()) as ApiResult<T>;
  } catch {}
  if (parsed && parsed.ok && res.ok) return { ok: true, data: parsed.data, status: res.status };
  if (parsed && !parsed.ok && parsed.error) {
    return {
      ok: false,
      error: { code: parsed.error.code, message: parsed.error.message, status: res.status, retry: isRetryableStatus(res.status) },
    };
  }
  return {
    ok: false,
    error: {
      code: "http_" + res.status,
      message: res.status >= 500 ? "Atelier had a problem. Try again." : `Atelier refused the request (${res.status}).`,
      status: res.status,
      retry: isRetryableStatus(res.status),
    },
  };
}
