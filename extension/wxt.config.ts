import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "wxt";

// Vite injects WXT_* into the bundle; manifest host_permissions need process.env here.
for (const name of [".env.local", ".env"]) {
  const path = resolve(import.meta.dirname, name);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^(WXT_[A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// Chrome MV3 build of the Atelier capture extension.
// Permissions are owned by the core worker; keep them minimal and never add
// "cookies" or "nativeMessaging".
//
// Test-only build knobs (used by scripts/verify-extension.ts, never set in production):
//   ATELIER_EXT_SERVER_ORIGIN  extra server origin granted as a host permission, e.g. http://127.0.0.1:3230
//   ATELIER_EXT_TEST=1         exposes a test hook in the service worker and grants <all_urls> (test build only) so
//                              headless Playwright can capture without a user gesture (activeTab)
//   ATELIER_EXT_OUTDIR         separate output directory for that build
//
// Auth / API build env (public anon only — see extension/.env.example):
//   WXT_SUPABASE_URL, WXT_SUPABASE_ANON_KEY  — URL origin also baked into host_permissions
//   WXT_API_URL                optional production Workers origin; baked into DEFAULT_SERVER_URL + host_permissions
// After deploy, either set WXT_API_URL at build time or ask the user to add the
// production origin under optional_host_permissions at sign-in (already supported).
const testMode = process.env.ATELIER_EXT_TEST === "1";
const extraOrigin = process.env.ATELIER_EXT_SERVER_ORIGIN;
function originHostPermission(envKey: string): string[] {
  const raw = process.env[envKey]?.trim();
  if (!raw) return [];
  try {
    return [`${new URL(raw).origin}/*`];
  } catch {
    return [];
  }
}
const apiHostPermission = () => originHostPermission("WXT_API_URL");
const supabaseHostPermission = () => originHostPermission("WXT_SUPABASE_URL");

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  outDir: process.env.ATELIER_EXT_OUTDIR ?? ".output",
  vite: () => ({
    define: { __ATELIER_TEST__: JSON.stringify(testMode) },
  }),
  manifest: {
    name: "Atelier",
    description: "Save pages, images and screenshots into your Atelier projects.",
    permissions: ["storage", "activeTab", "contextMenus", "scripting"],
    host_permissions: [
      "http://localhost:3000/*",
      ...apiHostPermission(),
      ...supabaseHostPermission(),
      // Hook sites: same sites the hook content scripts already run on. Lets the background inject
      // the overlay toast when a site-hook capture arrives without a user gesture (no activeTab).
      "https://*.pinterest.com/*",
      // Pinterest's image CDN sends no CORS headers; without this the pin's bytes can't be uploaded.
      "https://i.pinimg.com/*",
      "https://are.na/*",
      "https://www.are.na/*",
      "https://x.com/*",
      "https://twitter.com/*",
      "https://www.instagram.com/*",
      ...(extraOrigin ? [`${extraOrigin}/*`] : []),
      ...(testMode ? ["<all_urls>"] : []),
    ],
    // Custom / production server origins are requested at sign-in when not baked above.
    optional_host_permissions: ["http://*/*", "https://*/*"],
    action: { default_title: "Save to Atelier" },
    commands: {
      "save-page": {
        suggested_key: { default: "Alt+Shift+S", mac: "Alt+Shift+S" },
        description: "Save this page to Atelier",
      },
      "screenshot-region": {
        suggested_key: { default: "Alt+Shift+R", mac: "Alt+Shift+R" },
        description: "Screenshot a region into Atelier",
      },
    },
  },
});
