import { browser } from "wxt/browser";
import type { Project } from "../../../lib/types";
import { DEFAULT_SERVER_URL } from "../../lib/contracts";
import { apiFetch } from "../../utils/api";
import { normalizeServerUrl, setSettings } from "../../utils/settings";

/** Validates the token with GET /api/projects; stores nothing unless it works. */
export async function signIn(serverInput: string, token: string): Promise<{ ok: true; projects: Project[] } | { ok: false; message: string }> {
  const serverUrl = normalizeServerUrl(serverInput || DEFAULT_SERVER_URL);
  const trimmed = token.trim();
  let origin: string;
  try {
    const u = new URL(serverUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
    origin = u.origin;
  } catch {
    return { ok: false, message: "Enter a valid server URL, e.g. http://localhost:3000." };
  }
  if (!trimmed) return { ok: false, message: "Paste your access token." };
  if (origin !== new URL(DEFAULT_SERVER_URL).origin) {
    const granted = await browser.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
    if (!granted) return { ok: false, message: `Atelier needs permission to talk to ${new URL(origin).host}.` };
  }
  const res = await apiFetch<{ projects: Project[] }>({ serverUrl, token: trimmed }, "/api/projects");
  if (!res.ok) {
    return { ok: false, message: res.error.status === 401 ? "That token was not accepted." : res.error.message };
  }
  await setSettings({ serverUrl, token: trimmed, projectId: res.data.projects[0]?.id ?? null });
  return { ok: true, projects: res.data.projects };
}
