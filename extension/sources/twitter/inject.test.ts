import { afterEach, describe, expect, it, vi } from "vitest";
import { resetInterceptors } from "../_lib/intercept";
import { fakeXhr, settle, setup } from "../_lib/testing";
import { inject } from "./inject";

afterEach(() => {
  resetInterceptors();
  vi.restoreAllMocks();
});

const URL_ = "https://x.com/i/api/graphql/aoDbu3RHznuiSkQ9aNM67Q/CreateBookmark";
const body = JSON.stringify({ variables: { tweet_id: "1850000000000000001" }, queryId: "aoDbu3RHznuiSkQ9aNM67Q" });
const ok = JSON.stringify({ data: { tweet_bookmark_put: "Done" } });

describe("twitter hook", () => {
  it("fetch: one page event, response untouched", async () => {
    const { events, original } = setup({ body: ok });
    inject();
    const res = await window.fetch(URL_, { method: "POST", body, headers: { "content-type": "application/json" } });
    expect(await res.text()).toBe(ok);
    expect(original).toHaveBeenCalledTimes(1);
    await settle();
    expect(events).toEqual([
      {
        channel: "atelier.hook.v1",
        source: "twitter",
        request: { kind: "page", url: "https://x.com/i/web/status/1850000000000000001" },
        dedupeKey: "twitter:tweet:1850000000000000001",
      },
    ]);
  });

  it("XHR: one event", async () => {
    const { events } = setup({ body: ok });
    fakeXhr({ body: ok });
    inject();
    const xhr = new XMLHttpRequest();
    xhr.open("POST", URL_);
    xhr.send(body);
    await settle();
    expect(events).toHaveLength(1);
  });

  it("ignores likes, deletions, GETs, errors in the response", async () => {
    const { events } = setup({ body: ok });
    inject();
    await window.fetch("https://x.com/i/api/graphql/abc/FavoriteTweet", { method: "POST", body });
    await window.fetch("https://x.com/i/api/graphql/abc/DeleteBookmark", { method: "POST", body });
    await window.fetch(URL_);
    await settle();
    expect(events).toHaveLength(0);
    const bad = setup({ body: JSON.stringify({ errors: [{ message: "nope" }] }) });
    inject();
    await window.fetch(URL_, { method: "POST", body });
    await settle();
    expect(bad.events).toHaveLength(0);
  });
});
