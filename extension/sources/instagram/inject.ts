// Adapted from Pond (MIT) apps/extension/sources/instagram/inject.ts @ deb305e
// Pond's DOM click fallback and like hooks are not ported: Atelier observes only the page's
// own save request, so a click that the site rejects never captures anything.
import { emitHook } from "../_lib/emit";
import { installInterceptor, type RequestLens } from "../_lib/intercept";
import { extractMediaIdFromBody, isSaveMutation, mediaIdToShortcode } from "./requests";

const GRAPHQL_RE = /\/graphql\/query\b/;

export function inject(): void {
  installInterceptor({
    id: "instagram",
    match: (req: RequestLens) => req.method === "POST" && GRAPHQL_RE.test(req.url),
    async onResponse(req, res) {
      if (!res.ok) return;
      const body = await req.readBody();
      if (!isSaveMutation(req.getHeader, body)) return;
      const mediaId = extractMediaIdFromBody(body);
      const shortcode = mediaId ? mediaIdToShortcode(mediaId) : null;
      if (!shortcode) return;
      emitHook("instagram", { kind: "page", url: `https://www.instagram.com/p/${shortcode}/` }, `instagram:post:${shortcode}`);
    },
  });
}
