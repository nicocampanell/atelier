import { describe, expect, it } from "vitest";
import { HOOK_CHANNEL, type HookEvent } from "../lib/contracts";
import { bridgeMessage, createRateLimit, MAX_PAYLOAD_BYTES } from "./bridge";

const win = {};
const valid: HookEvent = {
  channel: HOOK_CHANNEL,
  source: "pinterest",
  request: { kind: "image", imageUrl: "https://i.pinimg.com/a.jpg", pageUrl: "https://www.pinterest.com/pin/1/", title: "T" },
  dedupeKey: "pinterest:pin:1",
};
const ev = (data: unknown, source: unknown = win) => ({ source, data });

describe("bridgeMessage", () => {
  it("turns a valid event into one CaptureMessage", () => {
    expect(bridgeMessage(ev(valid), win, "pinterest")).toEqual({
      type: "atelier.capture",
      request: valid.request,
      origin: { type: "hook", source: "pinterest" },
      dedupeKey: "pinterest:pin:1",
    });
    expect(bridgeMessage(ev(valid), win)).not.toBeNull();
  });
  it("accepts page requests and strips unknown fields", () => {
    const m = bridgeMessage(ev({ ...valid, request: { kind: "page", url: "https://www.pinterest.com/pin/1/", note: "x", extra: 1 } }), win);
    expect(m?.request).toEqual({ kind: "page", url: "https://www.pinterest.com/pin/1/" });
  });
  it("rejects wrong channel", () => {
    expect(bridgeMessage(ev({ ...valid, channel: "other" }), win)).toBeNull();
  });
  it("rejects unknown source", () => {
    expect(bridgeMessage(ev({ ...valid, source: "tiktok" }), win)).toBeNull();
    expect(bridgeMessage(ev({ ...valid, source: 5 }), win)).toBeNull();
  });
  it("rejects a source other than the page's site", () => {
    expect(bridgeMessage(ev(valid), win, "twitter")).toBeNull();
  });
  it("rejects events not from the same window", () => {
    expect(bridgeMessage(ev(valid, {}), win)).toBeNull();
    expect(bridgeMessage(ev(valid, null), win)).toBeNull();
  });
  it("rejects non-http(s) URLs", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "chrome://x", "not a url", 5]) {
      expect(bridgeMessage(ev({ ...valid, request: { kind: "page", url: bad } }), win)).toBeNull();
      expect(bridgeMessage(ev({ ...valid, request: { ...valid.request, imageUrl: bad } }), win)).toBeNull();
      expect(bridgeMessage(ev({ ...valid, request: { ...valid.request, pageUrl: bad } }), win)).toBeNull();
    }
  });
  it("rejects page URLs off the page's site and screenshot requests", () => {
    expect(bridgeMessage(ev({ ...valid, request: { kind: "page", url: "https://evil.example/" } }), win, "pinterest")).toBeNull();
    expect(bridgeMessage(ev({ ...valid, request: { kind: "screenshot", pageUrl: "https://www.pinterest.com/" } }), win)).toBeNull();
  });
  it("rejects payloads over 32 KB and accepts just under", () => {
    const big = { ...valid, request: { kind: "page", url: "https://www.pinterest.com/pin/1/", title: "x".repeat(MAX_PAYLOAD_BYTES) } };
    expect(bridgeMessage(ev(big), win)).toBeNull();
    const ok = { ...valid, request: { kind: "page", url: "https://www.pinterest.com/pin/1/", title: "x".repeat(MAX_PAYLOAD_BYTES - 400) } };
    expect(bridgeMessage(ev(ok), win)).not.toBeNull();
  });
  it("rejects malformed shapes", () => {
    expect(bridgeMessage(ev(null), win)).toBeNull();
    expect(bridgeMessage(ev("str"), win)).toBeNull();
    expect(bridgeMessage(ev({ ...valid, dedupeKey: undefined }), win)).toBeNull();
    expect(bridgeMessage(ev({ ...valid, request: null }), win)).toBeNull();
  });
});

describe("createRateLimit", () => {
  it("allows the limit then blocks until the window passes", () => {
    const allow = createRateLimit(2, 1000);
    expect([allow(0), allow(1), allow(2), allow(1001)]).toEqual([true, true, false, true]);
  });
});
