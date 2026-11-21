// Adapted from Pond (MIT) apps/extension/sources/twitter/inject.ts @ deb305e
// Pond also hooks FavoriteTweet (likes); Atelier saves bookmarks only.
import { emitHook } from "../_lib/emit";
import { installInterceptor, type RequestLens } from "../_lib/intercept";
import { asId, at, isRecord, parseJsonValue } from "../_lib/json";

const BOOKMARK_RE = /\/graphql\/[^/]+\/CreateBookmark(?:$|\?|\/)/;

export function tweetIdFromBody(body: string | null): string | null {
  if (!body) return null;
  const json = parseJsonValue(body);
  if (json) {
    return (
      asId(at(json, "variables", "tweet_id")) ??
      asId(at(json, "variables", "tweetId")) ??
      asId(at(json, "variables", "id")) ??
      null
    );
  }
  return body.match(/"tweet_?[Ii]d"\s*:\s*"?(\d+)"?/)?.[1] ?? null;
}

/** X answers 200 with an `errors` array when a bookmark is refused. */
function hasErrors(text: string | null): boolean {
  const json = parseJsonValue(text);
  const errors = isRecord(json ?? undefined) ? at(json ?? undefined, "errors") : undefined;
  return Array.isArray(errors) && errors.length > 0;
}

export function inject(): void {
  installInterceptor({
    id: "twitter",
    match: (req: RequestLens) => req.method === "POST" && BOOKMARK_RE.test(req.url),
    async onResponse(req, res) {
      if (!res.ok) return;
      const id = tweetIdFromBody(await req.readBody());
      if (!id || hasErrors(await res.readText())) return;
      emitHook("twitter", { kind: "page", url: `https://x.com/i/web/status/${id}` }, `twitter:tweet:${id}`);
    },
  });
}
