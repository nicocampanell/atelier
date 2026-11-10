import { afterEach, describe, expect, it, vi } from "vitest";
import { resetInterceptors } from "../_lib/intercept";
import { fakeXhr, settle, setup } from "../_lib/testing";
import { inject } from "./inject";

afterEach(() => {
  resetInterceptors();
  vi.restoreAllMocks();
});

const repin = { options: { board_id: "9", pin_id: "1139621880754595795", title: "A record" }, context: {} };
const saveBody = new URLSearchParams({ source_url: "/pin/1139621880754595795/", data: JSON.stringify(repin) }).toString();
const response = JSON.stringify({
  resource_response: {
    status: "success",
    data: { id: "999", images: { "236x": { url: "https://i.pinimg.com/236x/a.jpg" }, orig: { url: "https://i.pinimg.com/originals/a.jpg" } } },
  },
});
const SAVE_URL = "https://www.pinterest.com/resource/RepinResource/create/";

describe("pinterest hook", () => {
  it("fetch: one image HookEvent, response untouched", async () => {
    const { events, original } = setup({ body: response });
    inject();
    const res = await window.fetch(SAVE_URL, { method: "POST", body: saveBody });
    expect(await res.text()).toBe(response);
    expect(original).toHaveBeenCalledTimes(1);
    expect(original).toHaveBeenCalledWith(SAVE_URL, { method: "POST", body: saveBody });
    await settle();
    expect(events).toEqual([
      {
        channel: "atelier.hook.v1",
        source: "pinterest",
        request: {
          kind: "image",
          imageUrl: "https://i.pinimg.com/originals/a.jpg",
          pageUrl: "https://www.pinterest.com/pin/1139621880754595795/",
          title: "A record",
        },
        dedupeKey: "pinterest:pin:1139621880754595795",
      },
    ]);
  });

  it("fetch with a Request object falls back to a page request when the response has no image", async () => {
    const { events } = setup({ body: "{}" });
    inject();
    await window.fetch(new Request(SAVE_URL, { method: "POST", body: saveBody }));
    await settle();
    expect(events).toHaveLength(1);
    expect(events[0]?.request).toEqual({
      kind: "page",
      url: "https://www.pinterest.com/pin/1139621880754595795/",
      title: "A record",
    });
  });

  it("XHR: one event", async () => {
    const { events } = setup({ body: response });
    fakeXhr({ body: response });
    inject();
    const xhr = new XMLHttpRequest();
    xhr.open("POST", SAVE_URL);
    xhr.send(saveBody);
    await settle();
    expect(events).toHaveLength(1);
    expect(events[0]?.dedupeKey).toBe("pinterest:pin:1139621880754595795");
  });

  it("emits once for a repeated identical save", async () => {
    const { events } = setup({ body: response });
    inject();
    await window.fetch(SAVE_URL, { method: "POST", body: saveBody });
    await window.fetch(SAVE_URL, { method: "POST", body: saveBody });
    await settle();
    expect(events).toHaveLength(1);
  });

  it("ignores unrelated requests, GETs and failed saves", async () => {
    const { events } = setup({ body: response });
    inject();
    await window.fetch("https://www.pinterest.com/resource/UserHomefeedResource/get/", { method: "POST", body: saveBody });
    await window.fetch(SAVE_URL, { method: "GET" });
    await window.fetch("https://www.pinterest.com/resource/BoardResource/get/");
    await settle();
    expect(events).toHaveLength(0);
    const failing = setup({ status: 500, body: "{}" });
    inject();
    await window.fetch(SAVE_URL, { method: "POST", body: saveBody });
    await settle();
    expect(failing.events).toHaveLength(0);
  });
});
