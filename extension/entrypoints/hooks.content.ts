// Adapted from Pond (MIT) apps/extension/entrypoints/hooks.content.ts @ deb305e
import { hookSourceForUrl, HOOK_MATCHES } from "../sources";
import { bridgeMessage, createRateLimit } from "../utils/bridge";

export default defineContentScript({
  matches: HOOK_MATCHES,
  runAt: "document_start",
  main() {
    const expected = hookSourceForUrl(location.href);
    if (!expected) return;
    const allow = createRateLimit(30, 60_000);
    window.addEventListener("message", (event: MessageEvent) => {
      const message = bridgeMessage(event, window, expected);
      if (!message || !allow(Date.now())) return;
      // The background decides whether this source's hook is enabled; we only forward.
      void browser.runtime.sendMessage(message).catch(() => {});
    });
  },
});
