import { defineConfig } from "wxt";

// Chrome MV3 build of the Atelier capture extension.
// Permissions are owned by the core worker; keep them minimal and never add
// "cookies" or "nativeMessaging".
//
// Test-only build knobs (used by scripts/verify-extension.ts, never set in production):
//   ATELIER_EXT_SERVER_ORIGIN  extra server origin granted as a host permission, e.g. http://127.0.0.1:3230
//   ATELIER_EXT_TEST=1         exposes a test hook in the service worker and grants <all_urls> (test build only) so
//                              headless Playwright can capture without a user gesture (activeTab)
//   ATELIER_EXT_OUTDIR         separate output directory for that build
const testMode = process.env.ATELIER_EXT_TEST === "1";
const extraOrigin = process.env.ATELIER_EXT_SERVER_ORIGIN;

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
    // Custom server origins are requested at sign-in.
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
