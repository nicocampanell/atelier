import { browser } from "wxt/browser";
import {
  DEFAULT_SERVER_URL,
  SETTINGS_KEY,
  type ExtensionSettings,
} from "../lib/contracts";

export const DEFAULT_SETTINGS: ExtensionSettings = {
  serverUrl: DEFAULT_SERVER_URL,
  accessToken: null,
  refreshToken: null,
  email: null,
  projectId: null,
  hooks: { pinterest: true, arena: true, twitter: true, instagram: true },
};

export function normalizeServerUrl(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

type Stored = Partial<ExtensionSettings> & { token?: string | null };

function merge(stored?: Stored): ExtensionSettings {
  const { token: _legacy, ...rest } = stored ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...rest,
    // Legacy shared `token` forces re-login.
    accessToken: "token" in (stored ?? {}) ? null : (rest.accessToken ?? null),
    refreshToken: "token" in (stored ?? {}) ? null : (rest.refreshToken ?? null),
    email: "token" in (stored ?? {}) ? null : (rest.email ?? null),
    hooks: { ...DEFAULT_SETTINGS.hooks, ...(rest.hooks ?? {}) },
  };
}

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = (await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Stored | undefined;
  const next = merge(stored);
  if (stored && "token" in stored) {
    await browser.storage.local.set({ [SETTINGS_KEY]: next });
  }
  return next;
}

export async function setSettings(
  patch: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const next = { ...(await getSettings()), ...patch };
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
