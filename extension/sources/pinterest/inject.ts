// Adapted from Pond (MIT) apps/extension/sources/pinterest/inject.ts @ deb305e
import { emitHook, itemRequest } from "../_lib/emit";
import { installInterceptor, type RequestLens } from "../_lib/intercept";
import { asRecordOrNull, firstHttpUrl, nonEmpty, parseJsonValue, at } from "../_lib/json";
import { pinIdFromBody, pinTitleFromBody } from "./save-request";

const SAVE_RE = /\/resource\/(?:Repin|RepinSave|BoardPickerSave|UserPin|Pin)Resource\/create\/?(?:\?|$)/i;

/** Pinterest returns the saved pin in resource_response.data; take its biggest image. */
function imageFromResponse(text: string | null): { imageUrl?: string; title?: string } {
  const data = at(parseJsonValue(text) ?? undefined, "resource_response", "data");
  if (!asRecordOrNull(data)) return {};
  const imageUrl = firstHttpUrl(data, [
    ["images", "orig", "url"],
    ["images", "1200x", "url"],
    ["images", "736x", "url"],
    ["images", "564x", "url"],
    ["images", "474x", "url"],
    ["images", "236x", "url"],
  ]);
  return {
    // Save responses often list only grid thumbnails; every pin is also served at 736x.
    imageUrl: imageUrl?.replace(/^(https:\/\/i\.pinimg\.com\/)(?:236x|474x|564x)\//, "$1736x/"),
    title: nonEmpty(at(data, "title")) ?? nonEmpty(at(data, "grid_title")),
  };
}

export function inject(): void {
  installInterceptor({
    id: "pinterest",
    match: (req: RequestLens) => req.method === "POST" && SAVE_RE.test(req.url),
    async onResponse(req, res) {
      if (!res.ok) return;
      const body = await req.readBody();
      const id = pinIdFromBody(body);
      if (!id) return;
      const found = imageFromResponse(await res.readText());
      const title = pinTitleFromBody(body) ?? found.title;
      emitHook("pinterest", itemRequest(`https://www.pinterest.com/pin/${id}/`, found.imageUrl, title), `pinterest:pin:${id}`);
    },
  });
}
