import { browser } from "wxt/browser";
import {
  DEFAULT_SERVER_URL,
  SETTINGS_KEY,
  type ExtensionSettings,
} from "../lib/contracts";

export const DEFAULT_SETTINGS: ExtensionSettings = {
  serverUrl: DEFAULT_SERVER_URL,
  token: null,
  projectId: null,
  hooks: { pinterest: true, arena: true, twitter: true, instagram: true },
};

export function normalizeServerUrl(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = (await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as
    | Partial<ExtensionSettings>
    | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    hooks: { ...DEFAULT_SETTINGS.hooks, ...(stored?.hooks ?? {}) },
  };
}

export async function setSettings(
  patch: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const next = { ...(await getSettings()), ...patch };
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
