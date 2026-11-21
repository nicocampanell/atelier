import { describe, expect, it } from "vitest";
import { HOOK_MATCHES, hookSourceForUrl } from ".";

describe("hook sources", () => {
  it("maps pages to the four sources", () => {
    expect(hookSourceForUrl("https://www.pinterest.com/pin/1/")).toBe("pinterest");
    expect(hookSourceForUrl("https://are.na/block/1")).toBe("arena");
    expect(hookSourceForUrl("https://x.com/home")).toBe("twitter");
    expect(hookSourceForUrl("https://twitter.com/home")).toBe("twitter");
    expect(hookSourceForUrl("https://www.instagram.com/p/x/")).toBe("instagram");
  });
  it("ignores everything else", () => {
    expect(hookSourceForUrl("https://example.com/")).toBeNull();
    expect(hookSourceForUrl("http://x.com/")).toBeNull();
    expect(hookSourceForUrl("https://evilx.com/")).toBeNull();
    expect(hookSourceForUrl("https://x.com.evil.com/")).toBeNull();
  });
  it("exposes only the four sites' match patterns", () => {
    expect(HOOK_MATCHES).toHaveLength(7);
    for (const p of HOOK_MATCHES) expect(p).toMatch(/^https:\/\/(?:\*\.|www\.)?(?:pinterest\.com|are\.na|x\.com|twitter\.com|instagram\.com)\/\*$/);
  });
});
