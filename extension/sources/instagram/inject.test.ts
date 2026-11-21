import { afterEach, describe, expect, it, vi } from "vitest";
import { resetInterceptors } from "../_lib/intercept";
import { fakeXhr, settle, setup } from "../_lib/testing";
import { inject } from "./inject";

afterEach(() => {
  resetInterceptors();
  vi.restoreAllMocks();
});

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function mediaIdFor(shortcode: string): string {
  let n = 0n;
  for (const ch of shortcode) n = n * 64n + BigInt(ALPHABET.indexOf(ch));
  return n.toString();
}
const MEDIA_ID = mediaIdFor("Dej-BYWjXyx");
const GQL = "https://www.instagram.com/graphql/query";
const form = (name: string, variables: object) =>
  new URLSearchParams({ fb_api_caller_class: "RelayModern", fb_api_req_friendly_name: name, variables: JSON.stringify(variables), doc_id: "1" }).toString();
const saveBody = form("usePolarisSaveMediaSaveMutation", { input: { media_id: MEDIA_ID } });
const ok = JSON.stringify({ data: { xig_media_save: { status: "ok" } } });

describe("instagram hook", () => {
  it("fetch: one page event, response untouched", async () => {
    const { events, original } = setup({ body: ok });
    inject();
    const res = await window.fetch(GQL, { method: "POST", body: saveBody });
    expect(await res.text()).toBe(ok);
    expect(original).toHaveBeenCalledTimes(1);
    await settle();
    expect(events).toEqual([
      {
        channel: "atelier.hook.v1",
        source: "instagram",
        request: { kind: "page", url: "https://www.instagram.com/p/Dej-BYWjXyx/" },
        dedupeKey: "instagram:post:Dej-BYWjXyx",
      },
    ]);
  });

  it("XHR with the friendly-name header: one event", async () => {
    const body = new URLSearchParams({ variables: JSON.stringify({ input: { media_id: MEDIA_ID } }) }).toString();
    const { events } = setup({ body: ok });
    fakeXhr({ body: ok });
    inject();
    const xhr = new XMLHttpRequest();
    xhr.open("POST", GQL);
    // The fake setRequestHeader is a no-op, so headers reach the lens only via the patched prototype.
    xhr.setRequestHeader("x-fb-friendly-name", "usePolarisSaveMediaSaveMutation");
    xhr.send(body);
    await settle();
    expect(events).toHaveLength(1);
  });

  it("ignores unsave, likes, other graphql, and failed requests", async () => {
    const { events } = setup({ body: ok });
    inject();
    await window.fetch(GQL, { method: "POST", body: form("usePolarisSaveMediaUnsaveMutation", { input: { media_id: MEDIA_ID } }) });
    await window.fetch(GQL, { method: "POST", body: form("usePolarisLikeMediaLikeMutation", { media_id: MEDIA_ID }) });
    await window.fetch(GQL, { method: "POST", body: form("PolarisFeedQuery", {}) });
    await window.fetch("https://www.instagram.com/api/v1/web/likes/123/like/", { method: "POST" });
    await settle();
    expect(events).toHaveLength(0);
    const failing = setup({ status: 400, body: "{}" });
    inject();
    await window.fetch(GQL, { method: "POST", body: saveBody });
    await settle();
    expect(failing.events).toHaveLength(0);
  });
});
