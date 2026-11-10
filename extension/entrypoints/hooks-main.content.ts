// Adapted from Pond (MIT) apps/extension/entrypoints/hooks-main.content.ts @ deb305e
import { HOOK_MATCHES, hookSourceForUrl } from "../sources";
import { INJECTORS } from "../sources/inject";

export default defineContentScript({
  matches: HOOK_MATCHES,
  runAt: "document_start",
  world: "MAIN",
  main() {
    const source = hookSourceForUrl(location.href);
    if (source) INJECTORS[source]();
  },
});
