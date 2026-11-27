import { browser } from "wxt/browser";
import type { Project } from "../../../lib/types";
import { DEFAULT_SERVER_URL } from "../../lib/contracts";
import { apiFetch } from "../../utils/api";
import { normalizeServerUrl, setSettings } from "../../utils/settings";
import { supabase } from "../../utils/supabase";

/** Email/password via Supabase; stores JWT pair only after GET /api/projects succeeds. */
export async function signIn(
  serverInput: string,
  email: string,
  password: string,
): Promise<{ ok: true; projects: Project[] } | { ok: false; message: string }> {
  if (!supabase) {
    return { ok: false, message: "Missing WXT_SUPABASE_URL / WXT_SUPABASE_ANON_KEY — rebuild with those set." };
  }
  const serverUrl = normalizeServerUrl(serverInput || DEFAULT_SERVER_URL);
  const trimmedEmail = email.trim();
  let origin: string;
  try {
    const u = new URL(serverUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
    origin = u.origin;
  } catch {
    return { ok: false, message: "Enter a valid server URL, e.g. http://localhost:3000." };
  }
  if (!trimmedEmail || !password) return { ok: false, message: "Enter email and password." };
  // Always request — baked DEFAULT can match origin while host_permissions still omit it
  // (wxt.config reads process.env before Vite loads .env.local).
  const granted = await browser.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
  if (!granted) return { ok: false, message: `Atelier needs permission to talk to ${new URL(origin).host}.` };
  try {
    const supabaseOrigin = new URL(import.meta.env.WXT_SUPABASE_URL as string).origin;
    const supabaseGranted = await browser.permissions
      .request({ origins: [`${supabaseOrigin}/*`] })
      .catch(() => false);
    if (!supabaseGranted) {
      return { ok: false, message: `Atelier needs permission to talk to ${new URL(supabaseOrigin).host}.` };
    }
  } catch {
    return { ok: false, message: "Invalid WXT_SUPABASE_URL — rebuild with a valid Supabase project URL." };
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email: trimmedEmail, password });
  if (error || !data.session) {
    return { ok: false, message: error?.message ?? "Sign-in failed." };
  }
  const accessToken = data.session.access_token;
  const refreshToken = data.session.refresh_token;
  const res = await apiFetch<{ projects: Project[] }>(
    { serverUrl, accessToken, refreshToken },
    "/api/projects",
  );
  if (!res.ok) {
    return {
      ok: false,
      message: res.error.status === 401 ? "Signed in, but the API rejected this account." : res.error.message,
    };
  }
  await setSettings({
    serverUrl,
    accessToken,
    refreshToken,
    email: trimmedEmail,
    projectId: res.data.projects[0]?.id ?? null,
  });
  return { ok: true, projects: res.data.projects };
}
