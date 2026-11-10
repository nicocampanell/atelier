import { fakeBrowser } from "wxt/testing/fake-browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_KEY, type CaptureMessage, type CaptureState } from "../lib/contracts";
import { resetPipelineForTests, retryCapture, startCapture, timing } from "../utils/pipeline";
import { apiFetch } from "../utils/api";

const TOKEN = "secret-test-token";
const page = (extra: Partial<CaptureMessage> = {}): CaptureMessage => ({
  type: "atelier.capture",
  request: { kind: "page", url: "https://example.com/", title: "Example" },
  origin: { type: "toolbar" },
  ...extra,
});

function env(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), { status, headers: { "content-type": "application/json" } });
}
function errEnv(code: string, message: string, status: number) {
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), { status, headers: { "content-type": "application/json" } });
}
const save = (over: Record<string, unknown> = {}) => ({
  id: "s1", kind: "url", sourceUrl: "https://example.com/", title: "Example", description: null, previewUrl: null,
  asset: null, status: "accepted", error: null, duplicateOf: null, createdAt: "", placedIn: { projectId: "p1", itemId: "i1" }, ...over,
});
const projects = () => env({ projects: [{ id: "p1", name: "Moodboard", itemCount: 0, coverUrl: null, createdAt: "", updatedAt: "" }] });

let calls: { url: string; init: RequestInit }[];
function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return handler(url, init);
  }));
}

async function setSettings(over: Record<string, unknown> = {}) {
  await fakeBrowser.storage.local.set({
    [SETTINGS_KEY]: { serverUrl: "http://localhost:3000", token: TOKEN, projectId: "p1", hooks: { pinterest: true, arena: true, twitter: true, instagram: true }, ...over },
  });
}

async function run(msg: CaptureMessage) {
  const states: CaptureState[] = [];
  const started = await startCapture(msg, { tabId: 1, windowId: 1 }, (s) => states.push(s));
  if (!started) return { started, states };
  states.unshift(started.reply);
  await started.done;
  return { started, states };
}

beforeEach(async () => {
  fakeBrowser.reset();
  resetPipelineForTests();
  timing.sleep = async () => {};
  await setSettings();
});

describe("capture state machine", () => {
  it("goes sending -> saved -> ready and names the project", async () => {
    let polls = 0;
    mockFetch((url, init) => {
      if (url.endsWith("/api/projects")) return projects();
      if (init.method === "POST") return env(save(), 202);
      polls++;
      return env(save({ status: polls < 2 ? "processing" : "ready", title: "Example Domain" }));
    });
    const { states } = await run(page());
    expect(states.map((s) => s.state)).toEqual(["sending", "saved", "ready"]);
    const ready = states[2] as Extract<CaptureState, { state: "ready" }>;
    expect(ready.projectName).toBe("Moodboard");
    expect(ready.title).toBe("Example Domain");
    const post = calls.find((c) => c.init.method === "POST")!;
    expect(JSON.parse(post.init.body as string)).toEqual({ url: "https://example.com/", title: "Example", projectId: "p1" });
  });

  it("never claims ready when processing outlasts the polling window", async () => {
    let now = 0;
    timing.now = () => now;
    timing.sleep = async (ms) => { now += ms; };
    mockFetch((url, init) => (url.endsWith("/api/projects") ? projects() : init.method === "POST" ? env(save(), 202) : env(save({ status: "processing" }))));
    const { states } = await run(page());
    expect(states.map((s) => s.state)).toEqual(["sending", "saved"]);
    expect(calls.filter((c) => c.init.method === "GET" && c.url.includes("/api/saves/")).length).toBeGreaterThan(3);
    timing.now = () => Date.now();
  });

  it("reports duplicate when the server sets duplicateOf", async () => {
    mockFetch((url) => (url.endsWith("/api/projects") ? projects() : env(save({ duplicateOf: "s0" }), 202)));
    const { states } = await run(page());
    expect(states.map((s) => s.state)).toEqual(["sending", "duplicate"]);
  });

  it("network failure and 5xx are retryable", async () => {
    mockFetch(() => { throw new TypeError("fetch failed"); });
    let r = await run(page());
    expect(r.states[1]).toMatchObject({ state: "failed", retry: true });
    resetPipelineForTests();
    mockFetch(() => errEnv("internal", "boom", 503));
    r = await run(page());
    expect(r.states[1]).toMatchObject({ state: "failed", retry: true });
  });

  it("4xx is not retryable and shows the server message", async () => {
    mockFetch(() => errEnv("invalid_url", "That address is private.", 400));
    const { states } = await run(page());
    expect(states[1]).toMatchObject({ state: "failed", retry: false, message: "That address is private." });
  });

  it("signed out sends nothing", async () => {
    await setSettings({ token: null });
    mockFetch(() => env({}));
    const { states } = await run(page());
    expect(states.map((s) => s.state)).toEqual(["signed-out"]);
    expect(calls).toHaveLength(0);
  });

  it("drops a second message with the same dedupeKey within 10 s", async () => {
    mockFetch((url, init) => (url.endsWith("/api/projects") ? projects() : init.method === "POST" ? env(save({ status: "ready" }), 202) : env(save())));
    const first = await run(page({ dedupeKey: "pinterest:pin:1" }));
    expect(first.started).not.toBeNull();
    const second = await run(page({ dedupeKey: "pinterest:pin:1" }));
    expect(second.started).toBeNull();
    expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(1);
  });

  it("sends an Idempotency-Key that is identical on retry", async () => {
    let first = true;
    mockFetch((url, init) => {
      if (url.endsWith("/api/projects")) return projects();
      if (init.method === "POST") {
        if (first) { first = false; return errEnv("x", "down", 502); }
        return env(save({ status: "ready" }), 200);
      }
      return env(save());
    });
    const { started, states } = await run(page());
    expect(states[1]).toMatchObject({ state: "failed", retry: true });
    const id = started!.reply.captureId;
    const again: CaptureState[] = [];
    const r = await retryCapture(id, (s) => again.push(s));
    await r!.done;
    expect(again.map((s) => s.state)).toEqual(["sending", "ready"]);
    const keys = calls.filter((c) => c.init.method === "POST").map((c) => (c.init.headers as Record<string, string>)["idempotency-key"]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]);
  });

  it("drops hook captures when the site toggle is off", async () => {
    await setSettings({ hooks: { pinterest: false, arena: true, twitter: true, instagram: true } });
    mockFetch((url) => (url.endsWith("/api/projects") ? projects() : env(save({ status: "ready" }), 202)));
    const hook = page({ origin: { type: "hook", source: "pinterest" }, dedupeKey: "pinterest:pin:2" });
    expect((await run(hook)).started).toBeNull();
    expect(calls).toHaveLength(0);
    const arena = page({ origin: { type: "hook", source: "arena" }, dedupeKey: "arena:1" });
    expect((await run(arena)).started).not.toBeNull();
  });

  it("uploads image bytes with sourceUrl and projectId, falling back to a URL save", async () => {
    mockFetch((url, init) => {
      if (url === "https://img.example/a.png") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
      if (url.endsWith("/api/projects")) return projects();
      if (init.method === "POST") return env(save({ kind: "image", status: "ready" }), 202);
      return env(save());
    });
    const img: CaptureMessage = { type: "atelier.capture", origin: { type: "menu" }, request: { kind: "image", imageUrl: "https://img.example/a.png", pageUrl: "https://example.com/" } };
    await run(img);
    const post = calls.find((c) => c.init.method === "POST")!;
    const form = post.init.body as FormData;
    expect(form.get("sourceUrl")).toBe("https://img.example/a.png");
    expect(form.get("projectId")).toBe("p1");
    expect(form.get("file")).toBeInstanceOf(Blob);

    resetPipelineForTests();
    mockFetch((url, init) => {
      if (url === "https://img.example/a.png") throw new TypeError("CORS");
      if (url.endsWith("/api/projects")) return projects();
      return init.method === "POST" ? env(save({ status: "ready" }), 202) : env(save());
    });
    await run(img);
    const fallback = calls.find((c) => c.init.method === "POST")!;
    expect(JSON.parse(fallback.init.body as string)).toMatchObject({ url: "https://img.example/a.png", projectId: "p1" });
  });

  it("never puts the token anywhere but the Authorization header", async () => {
    const log = vi.spyOn(console, "log");
    mockFetch((url) => (url.endsWith("/api/projects") ? projects() : env(save({ status: "ready" }), 202)));
    await run(page());
    for (const c of calls) {
      expect(c.url).not.toContain(TOKEN);
      expect(String(c.init.body ?? "")).not.toContain(TOKEN);
    }
    expect(log).not.toHaveBeenCalled();
  });
});

describe("api client", () => {
  it("returns the envelope and error classes", async () => {
    mockFetch(() => errEnv("unauthorized", "Bad token", 401));
    const r = await apiFetch({ serverUrl: "http://x/", token: "t" }, "/api/projects");
    expect(r).toMatchObject({ ok: false, error: { status: 401, retry: false, message: "Bad token" } });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer t");
  });
});
