// Verification for the Atelier browser extension: runs checks E1-E8 from docs/goals/extension.md
// and prints PASS / FAIL / SKIPPED per check.
//
// Run from the repo root:  pnpm exec tsx scripts/verify-extension.ts
//
// E3-E8 start their own `next dev` (port 3230, NEXT_DIST_DIR=.next-verify-ext, data dir ./.data-verify-ext,
// ATELIER_TOKEN=testtoken), build a test flavour of the extension (see wxt.config.ts) into
// extension/.output-verify and drive it with Playwright Chromium. Never prints the token.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
// Playwright lives in extension/node_modules, so the root project has no types for it or for the
// browser-side `chrome` global; keep those loosely typed on purpose.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
declare const chrome: Any;
import type { ApiResult, Board, Project, Save } from "../lib/types";

const ROOT = process.cwd();
const EXT = path.join(ROOT, "extension");
const PORT = 3230;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "testtoken";
const DATA_DIR = "./.data-verify-ext";
const OUT_DIR = ".output-verify";
const PAGE_URL = "https://example.com/";
const PAGE2_URL = "https://example.org/";
const IMAGE_URL = "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png";

type Outcome = "PASS" | "FAIL" | "SKIPPED";
const results: { id: string; outcome: Outcome }[] = [];
class Skip extends Error {}
function assert(c: unknown, msg: string): asserts c {
  if (!c) throw new Error(msg);
}
const sleep = (ms: number) => new Promise((r: Any) => setTimeout(r, ms));

async function check(id: string, name: string, fn: () => Promise<string | void>) {
  try {
    const detail = (await fn()) ?? "";
    results.push({ id, outcome: "PASS" });
    console.log(`PASS     ${id}. ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    const skipped = e instanceof Skip;
    const detail = (e instanceof Error ? e.message : String(e)).split(TOKEN).join("<token>");
    results.push({ id, outcome: skipped ? "SKIPPED" : "FAIL" });
    console.log(`${skipped ? "SKIPPED" : "FAIL   "}  ${id}. ${name} — ${detail}`);
  }
}

function readdirSyncSafe(d: string): string[] {
  try {
    return readdirSync(d);
  } catch {
    return [];
  }
}

function sh(cmd: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8" });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// ---------------------------------------------------------------- server control (as verify-backend.ts)
let server: ChildProcess | null = null;
let serverLog = "";
async function startServer() {
  const env: NodeJS.ProcessEnv = {
    ...process.env, ATELIER_TOKEN: TOKEN, ATELIER_DATA_DIR: DATA_DIR, PORT: String(PORT), NEXT_DIST_DIR: ".next-verify-ext",
  };
  delete env.EMBEDDING_API_KEY;
  serverLog = "";
  server = spawn("pnpm", ["exec", "next", "dev", "--port", String(PORT)], { cwd: ROOT, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout?.on("data", (d: Buffer) => (serverLog += d.toString()));
  server.stderr?.on("data", (d: Buffer) => (serverLog += d.toString()));
  const end = Date.now() + 120_000;
  while (Date.now() < end) {
    if (server.exitCode !== null) throw new Error(`server exited early:\n${serverLog.slice(-1500)}`);
    try {
      if ((await fetch(`${BASE}/api/health`)).status === 200) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`server did not come up:\n${serverLog.slice(-1500)}`);
}
async function stopServer() {
  const s = server;
  server = null;
  if (!s || s.pid === undefined || s.exitCode !== null) return;
  const pid = s.pid;
  try { process.kill(-pid, "SIGTERM"); } catch {}
  const end = Date.now() + 10_000;
  while (s.exitCode === null && s.signalCode === null && Date.now() < end) await sleep(200);
  try { process.kill(-pid, "SIGKILL"); } catch {}
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${BASE}/api/health`); await sleep(200); } catch { return; }
  }
}

async function api<T>(method: string, p: string, json?: unknown): Promise<{ status: number; body: ApiResult<T> | null; raw: Response }> {
  const headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` };
  if (json !== undefined) headers["content-type"] = "application/json";
  const raw = await fetch(BASE + p, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) });
  let body: ApiResult<T> | null = null;
  if ((raw.headers.get("content-type") ?? "").includes("application/json")) body = (await raw.clone().json()) as ApiResult<T>;
  return { status: raw.status, body, raw };
}
async function data<T>(method: string, p: string, json?: unknown): Promise<T> {
  const r = await api<T>(method, p, json);
  assert(r.body && r.body.ok, `${method} ${p}: HTTP ${r.status} ${r.body && !r.body.ok ? r.body.error.message : "(no envelope)"}`);
  return r.body.data;
}
async function waitUntil<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 45_000, step = 250): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(step);
  }
}
async function savesWithSource(url: string): Promise<Save[]> {
  const { saves } = await data<{ saves: Save[]; next: string | null }>("GET", "/api/saves?limit=200");
  return saves.filter((s) => s.sourceUrl === url);
}
async function boardHas(projectId: string, saveId: string) {
  const b = await data<Board>("GET", `/api/projects/${projectId}/board`);
  return b.items.some((i) => i.saveId === saveId);
}

// ---------------------------------------------------------------- main
async function main() {
  rmSync(path.join(ROOT, DATA_DIR), { recursive: true, force: true });

  // ---- E1 build
  await check("E1", "Build, typecheck, manifest", async () => {
    const tc = sh("pnpm", ["--dir", "extension", "typecheck"]);
    assert(tc.code === 0, `typecheck exit ${tc.code}:\n${tc.out.split("\n").filter((l) => /error/.test(l)).slice(0, 8).join("\n")}`);
    const b = sh("pnpm", ["--dir", "extension", "build"]);
    assert(b.code === 0, `build exit ${b.code}:\n${b.out.slice(-800)}`);
    const dir = path.join(EXT, ".output/chrome-mv3");
    const m = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
    assert(m.manifest_version === 3, "not MV3");
    const perms: string[] = [...(m.permissions ?? []), ...(m.optional_permissions ?? [])];
    for (const bad of ["cookies", "nativeMessaging"]) assert(!perms.includes(bad), `permission ${bad} present`);
    const hosts: string[] = m.host_permissions ?? [];
    assert(!hosts.some((h) => h === "<all_urls>" || h === "*://*/*"), `broad host permission: ${hosts.join(",")}`);
    const HOOK_HOSTS = ["https://*.pinterest.com/*", "https://are.na/*", "https://www.are.na/*", "https://x.com/*", "https://twitter.com/*", "https://www.instagram.com/*"];
    assert(hosts.every((h) => /^http:\/\/localhost/.test(h) || HOOK_HOSTS.includes(h)), `unexpected host permissions: ${hosts.join(",")}`);
    assert((m.optional_host_permissions ?? []).length > 0, "no optional_host_permissions for custom servers");
    assert(!m.content_security_policy, "custom CSP present");
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
    for (const f of walk(dir).filter((f) => /\.html$/.test(f))) assert(!/<script[^>]+src=["']https?:/i.test(readFileSync(f, "utf8")), `remote script in ${f}`);
    return "MV3, no cookies/nativeMessaging/<all_urls>, optional_host_permissions set";
  });

  // ---- E2 unit tests
  let unitOut = "";
  await check("E2", "Unit tests", async () => {
    const t = sh("pnpm", ["--dir", "extension", "test"]);
    unitOut = t.out;
    assert(t.code === 0, `vitest exit ${t.code}:\n${t.out.slice(-1200)}`);
    return (t.out.match(/Tests\s+[^\n]*/) ?? [""])[0].replace(/\s+/g, " ");
  });

  // ---- E3-E8 prerequisites
  const pwDir = path.join(process.env.HOME ?? "", "Library/Caches/ms-playwright/chromium-1200");
  let skipReason: string | null = null;
  try {
    const r = await fetch(PAGE_URL, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) skipReason = `${PAGE_URL} answered ${r.status}`;
  } catch {
    skipReason = `no network access to ${PAGE_URL}`;
  }
  // The cached Playwright chromium-1200 here has no Frameworks/ directory and cannot launch, so fall back
  // to an installed Chrome (CHROME_PATH overrides). Branded Chrome needs DisableLoadExtensionCommandLineSwitch.
  const candidates = [
    process.env.CHROME_PATH,
    path.join(pwDir, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
    ...readdirSyncSafe(path.join(process.env.HOME ?? "", ".agent-browser/browsers")).map((d) => path.join(process.env.HOME ?? "", ".agent-browser/browsers", d, "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter((c): c is string => !!c);
  const usable = (c: string) => existsSync(c) && existsSync(path.join(path.dirname(c), "../Frameworks"));
  const browserPath = candidates.find(usable);
  if (!skipReason && !browserPath) skipReason = "no launchable Chromium/Chrome found";
  const e2e = ["E3", "E4", "E5", "E6", "E7", "H4", "E8"];
  if (skipReason) {
    for (const id of e2e) {
      results.push({ id, outcome: "SKIPPED" });
      console.log(`SKIPPED  ${id}. — ${skipReason}`);
    }
    return finish(unitOut);
  }

  let setupError: string | null = null;
  try {
    const b = sh("pnpm", ["--dir", "extension", "build"], {
      ATELIER_EXT_TEST: "1", ATELIER_EXT_SERVER_ORIGIN: BASE, ATELIER_EXT_OUTDIR: OUT_DIR,
    });
    assert(b.code === 0, `test build exit ${b.code}:\n${b.out.slice(-600)}`);
    await startServer();
  } catch (e) {
    setupError = e instanceof Error ? e.message : String(e);
  }
  if (setupError) {
    for (const id of e2e) {
      results.push({ id, outcome: "FAIL" });
      console.log(`FAIL     ${id}. — setup failed: ${setupError}`);
    }
    await stopServer();
    return finish(unitOut);
  }

  const require = createRequire(path.join(EXT, "package.json"));
  const { chromium } = require("@playwright/test") as { chromium: Any };
  const extPath = path.join(EXT, OUT_DIR, "chrome-mv3");
  const profile = mkdtempSync(path.join(tmpdir(), "atelier-ext-"));
  const consoleLog: string[] = [];
  const requestUrls: string[] = [];
  const sentToTabs: string[] = [];
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: process.env.VERIFY_HEADED !== "1",
    executablePath: browserPath!,
    ignoreDefaultArgs: ["--disable-extensions"],
    viewport: { width: 1000, height: 700 },
    deviceScaleFactor: 2,
    args: ["--disable-features=DisableLoadExtensionCommandLineSwitch", `--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
  });
  try {
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker", { timeout: 20_000 }));
    const extId = new URL(sw.url()).host;
    sw.on("console", (m: Any) => consoleLog.push(m.text()));
    ctx.on("console", (m: Any) => consoleLog.push(m.text()));
    ctx.on("request", (r: Any) => requestUrls.push(r.url()));
    ctx.on("page", (p: Any) => p.on("console", (m: Any) => consoleLog.push(m.text())));
    await sw.evaluate(() => {
      const g = globalThis as unknown as { __sent: string[] };
      g.__sent = [];
      const orig = chrome.tabs.sendMessage.bind(chrome.tabs);
      (chrome.tabs as unknown as { sendMessage: unknown }).sendMessage = (...a: unknown[]) => {
        g.__sent.push(JSON.stringify(a));
        return (orig as (...x: unknown[]) => unknown)(...a);
      };
    });
    const storedSettings = () =>
      sw.evaluate(async () => (await chrome.storage.local.get("atelier.settings"))["atelier.settings"] as { token: string | null; projectId: string | null; serverUrl: string } | undefined);

    // ---- E6 popup (first: it signs in and creates the selected project)
    const openPopup = async () => {
      const p = await ctx.newPage();
      await p.goto(`chrome-extension://${extId}/popup.html`);
      return p;
    };
    let projectName = "";
    await check("E6", "Popup: sign-in, project list, create + select, persistence", async () => {
      let popup = await openPopup();
      await popup.getByTestId("server").fill(BASE);
      await popup.getByTestId("token").fill("wrong-token-value");
      await popup.getByTestId("signin").click();
      await popup.getByTestId("error").waitFor({ timeout: 10_000 });
      const errText = await popup.getByTestId("error").innerText();
      assert(errText.length > 0, "no visible error for wrong token");
      const afterWrong = await storedSettings();
      assert(!afterWrong?.token, "wrong token was stored");
      await popup.getByTestId("token").fill(TOKEN);
      await popup.getByTestId("signin").click();
      await popup.getByTestId("project").first().waitFor({ timeout: 10_000 });
      const listed = await data<{ projects: Project[] }>("GET", "/api/projects");
      const shown = await popup.getByTestId("project").count();
      assert(shown === listed.projects.length, `popup lists ${shown} projects, API has ${listed.projects.length}`);
      projectName = `Verify ${Date.now() % 100000}`;
      await popup.getByTestId("new-project").fill(projectName);
      await popup.getByTestId("create-project").click();
      const created = await waitUntil("project to exist", async () => (await data<{ projects: Project[] }>("GET", "/api/projects")).projects.find((p) => p.name === projectName));
      await waitUntil("created project selected", async () => (await storedSettings())?.projectId === created.id);
      await popup.close();
      popup = await openPopup();
      const checked = popup.locator('[data-testid="project"]:checked');
      await checked.waitFor({ timeout: 10_000 });
      const label = await checked.locator("xpath=..").innerText();
      assert(label.trim() === projectName, `reopened popup selection is "${label.trim()}"`);
      await popup.close();
      return `wrong token -> "${errText}"; created + persisted "${projectName}"`;
    });

    const settings = await storedSettings();
    const projectId = settings?.projectId ?? null;
    const needSetup = () => {
      if (!projectId) throw new Error("no selected project (E6 did not complete)");
    };

    const page = await ctx.newPage();
    const tabInfo = async (url: string) => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.bringToFront();
      return sw.evaluate(async (u: string) => {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        return tabs.find((t: Any) => t.url?.startsWith(u)) ?? null;
      }, url);
    };
    const trigger = async (url: string, info: Record<string, unknown>) => {
      const tab = await tabInfo(url);
      assert(tab, `no active tab for ${url}`);
      await sw.evaluate(async ([i, t]: Any) => {
        const hook = (globalThis as unknown as { __atelierTest: { handleMenuClick: (i: unknown, t: unknown) => Promise<void> } }).__atelierTest;
        await hook.handleMenuClick(i, t);
      }, [info, tab] as const);
    };
    const trail = () => page.evaluate(() => document.querySelector("atelier-overlay")?.getAttribute("data-history") ?? "");
    const toastText = async () =>
      (await page.evaluate(() => document.querySelector("atelier-overlay")?.shadowRoot?.querySelector(".toasts")?.textContent ?? "").catch(() => "")) || "";
    /** Polls the shared-DOM state trail and the visible toast text until `done` returns true. */
    const watchToast = async (done: (history: string, texts: string[]) => boolean, ms = 60_000) => {
      const texts: string[] = [];
      const end = Date.now() + ms;
      for (;;) {
        const t = await toastText();
        if (t && texts[texts.length - 1] !== t) texts.push(t);
        const h = await trail();
        if (done(h, texts)) return { history: h, texts };
        if (Date.now() > end) throw new Error(`toast never finished; trail="${h}" texts=${JSON.stringify(texts)}`);
        await sleep(60);
      }
    };

    // ---- E3 page save
    let e3SaveId = "";
    await check("E3", "Page save into the selected project, truthful toast", async () => {
      needSetup();
      await trigger(PAGE_URL, { menuItemId: "atelier-save-page", pageUrl: PAGE_URL });
      const { history, texts } = await watchToast((h, t) => h.includes("ready") || h.includes("failed"));
      assert(history.startsWith("sending"), `toast trail should start with sending: ${history}`);
      assert(history.includes("saved"), `no saved state before ready: ${history}`);
      assert(history.endsWith("ready"), `toast did not reach ready: ${history}`);
      assert(texts.some((t) => t.includes(projectName)), `toast never named the project "${projectName}": ${JSON.stringify(texts)}`);
      const save = await waitUntil("save in API", async () => (await savesWithSource(PAGE_URL))[0]);
      e3SaveId = save.id;
      assert(await boardHas(projectId!, save.id), "save is not on the project's board");
      return `trail ${history}`;
    });

    // ---- E4 image
    await check("E4", "Image capture uploads bytes", async () => {
      needSetup();
      const res = await fetch(IMAGE_URL, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
      if (!res || !res.ok) throw new Skip(`cannot fetch ${IMAGE_URL}`);
      const original = Buffer.from(await res.arrayBuffer());
      await trigger(PAGE_URL, { menuItemId: "atelier-save-image", srcUrl: IMAGE_URL, pageUrl: PAGE_URL });
      const save = await waitUntil("image save", async () => (await savesWithSource(IMAGE_URL))[0]);
      assert(save.kind === "image", `kind is ${save.kind}`);
      const ready = await waitUntil("image ready", async () => {
        const s = await data<Save>("GET", `/api/saves/${save.id}`);
        return s.status === "ready" || s.status === "failed" ? s : null;
      });
      assert(ready.status === "ready", `status ${ready.status}`);
      assert(ready.previewUrl, "no previewUrl");
      const bytes = Buffer.from(await (await fetch(ready.previewUrl.startsWith("http") ? ready.previewUrl : BASE + ready.previewUrl, { headers: { authorization: `Bearer ${TOKEN}` } })).arrayBuffer());
      const h = (b: Buffer) => createHash("sha256").update(b).digest("hex");
      assert(h(bytes) === h(original), `asset bytes differ (${bytes.length} vs ${original.length})`);
      assert(await boardHas(projectId!, save.id), "image save not on the board");
      return `${original.length} bytes identical`;
    });

    // ---- E5 region screenshot
    await check("E5", "Region screenshot size = rect x dpr", async () => {
      needSetup();
      const tab = await tabInfo(PAGE_URL);
      assert(tab, "no tab");
      const before = new Set((await savesWithSource(PAGE_URL)).map((s) => s.id));
      await sw.evaluate(async (t: Any) => {
        const hook = (globalThis as unknown as { __atelierTest: { runTool: (t: unknown, k: string) => Promise<void> } }).__atelierTest;
        await hook.runTool(t, "region");
      }, tab);
      const surface = page.locator("atelier-overlay").getByTestId("region-surface");
      await surface.waitFor({ timeout: 10_000 });
      const dpr = await page.evaluate(() => devicePixelRatio);
      await page.mouse.move(120, 140);
      await page.mouse.down();
      await page.mouse.move(300, 220, { steps: 5 });
      await page.mouse.move(420, 340, { steps: 5 });
      await page.mouse.up();
      const saveBtn = page.locator("atelier-overlay").getByTestId("region-save");
      await saveBtn.waitFor({ timeout: 5000 }).catch(async () => {
        const html = await page.evaluate(() => document.querySelector("atelier-overlay")?.shadowRoot?.innerHTML ?? "(no shadow root)");
        throw new Error(`region Save button never appeared; shadow DOM: ${html.slice(0, 600)}`);
      });
      await saveBtn.click();
      const watched = watchToast((h) => h.includes("failed") || h.includes("ready"), 20_000).catch(() => null);
      const save = await waitUntil("screenshot save", async () => (await savesWithSource(PAGE_URL)).find((s) => !before.has(s.id) && s.kind === "image"), 20_000).catch(async (e: Error) => {
        throw new Error(`${e.message}; toast ${JSON.stringify(await watched)}`);
      });
      const ready = await waitUntil("screenshot ready", async () => {
        const s = await data<Save>("GET", `/api/saves/${save.id}`);
        return s.status !== "accepted" && s.status !== "processing" ? s : null;
      });
      assert(ready.previewUrl, "no previewUrl");
      const buf = Buffer.from(await (await fetch(ready.previewUrl.startsWith("http") ? ready.previewUrl : BASE + ready.previewUrl, { headers: { authorization: `Bearer ${TOKEN}` } })).arrayBuffer());
      assert(buf.subarray(1, 4).toString() === "PNG", "asset is not a PNG");
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      const expW = Math.round(300 * dpr);
      const expH = Math.round(200 * dpr);
      assert(w === expW && h === expH, `PNG is ${w}x${h}, expected ${expW}x${expH} (rect 300x200, dpr ${dpr})`);
      assert(await boardHas(projectId!, save.id), "screenshot not placed in the project");
      return `${w}x${h} at dpr ${dpr}`;
    });

    // ---- E7 failure + recovery
    await check("E7", "Server down -> failed with Retry -> recovery without duplicates", async () => {
      needSetup();
      await stopServer();
      await trigger(PAGE2_URL, { menuItemId: "atelier-save-page", pageUrl: PAGE2_URL });
      const retry = page.locator("atelier-overlay").getByTestId("toast-retry");
      await retry.waitFor({ timeout: 20_000 });
      const failedText = await toastText();
      assert(/couldn.t save/i.test(failedText), `failure toast text: ${failedText}`);
      await startServer();
      await retry.click();
      const { history } = await watchToast((h) => h.endsWith("ready") || h.endsWith("failed"), 60_000);
      assert(history.endsWith("ready"), `after retry the trail is ${history}`);
      const saves = await savesWithSource(PAGE2_URL);
      assert(saves.length === 1, `${saves.length} saves for ${PAGE2_URL}`);
      assert(await boardHas(projectId!, saves[0]!.id), "retried save not on board");
      return `trail ${history}; one save`;
    });

    // ---- H4 site hook end-to-end (orchestrator check): a fake Pinterest pin page fires the site's own save request
    await check("H4", "Pinterest save hook -> save in the selected project", async () => {
      needSetup();
      const PIN = "https://www.pinterest.com/pin/1/";
      const pinResponse = JSON.stringify({ resource_response: { status: "success", data: { id: "1", images: { orig: { url: IMAGE_URL } } } } });
      const before = (await savesWithSource(IMAGE_URL)).length;
      await ctx.route("https://www.pinterest.com/**", (route: Any) => {
        const u = route.request().url();
        if (u.includes("/resource/RepinResource/create/")) {
          return route.fulfill({ status: 200, contentType: "application/json", body: pinResponse });
        }
        return route.fulfill({
          status: 200,
          contentType: "text/html",
          body: `<!doctype html><title>Pin</title><button id="save">Save</button><script>
            document.getElementById("save").onclick = () => {
              const body = new URLSearchParams({ source_url: "/pin/1/", data: JSON.stringify({ options: { board_id: "9", pin_id: "1", title: "Hook pin" }, context: {} }) });
              fetch("/resource/RepinResource/create/", { method: "POST", body });
            };</script>`,
        });
      });
      await page.goto(PIN, { waitUntil: "domcontentloaded" });
      await page.bringToFront();
      await page.click("#save");
      const save = await waitUntil("hook save", async () => {
        const list = await savesWithSource(IMAGE_URL);
        return list.length > before ? list[0] : null;
      });
      assert(save.kind === "image", `kind is ${save.kind}`);
      assert(save.title === "Hook pin", `title is "${save.title}"`);
      assert(await boardHas(projectId!, save.id), "hook save not on the project's board");
      await page.click("#save"); // same pin again within the dedupe window
      await sleep(3_000);
      const after = (await savesWithSource(IMAGE_URL)).length;
      assert(after === before + 1, `second click within dedupe window created another save (${after - before})`);
      await ctx.unroute("https://www.pinterest.com/**");
      return `image save "${save.title}" placed; repeat click deduped`;
    });

    // ---- E8 token hygiene
    await check("E8", "Token never leaks", async () => {
      const sent = await sw.evaluate(() => (globalThis as unknown as { __sent: string[] }).__sent);
      assert(sent.length > 0, "no messages were observed going to tabs");
      assert(!sent.some((m: Any) => m.includes(TOKEN)), "token found in a message to a content script");
      assert(!consoleLog.some((l) => l.includes(TOKEN)), "token found in console output");
      const leaked = requestUrls.filter((u) => u.includes(TOKEN) || /[?&]token=/.test(u));
      assert(leaked.length === 0, `token in a URL: ${leaked.length} request(s)`);
      const domHit = await page.evaluate((t: string) => document.documentElement.outerHTML.includes(t) || (document.querySelector("atelier-overlay")?.shadowRoot?.innerHTML ?? "").includes(t), TOKEN);
      assert(!domHit, "token present in page DOM");
      const stored = await storedSettings();
      assert(stored?.token === TOKEN, "token should live in storage.local for the background");
      return `${sent.length} tab messages, ${consoleLog.length} console lines, ${requestUrls.length} requests checked`;
    });
    void e3SaveId;
  } finally {
    await ctx.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
    await stopServer();
  }
  finish(unitOut);
}

function finish(_unit: string) {
  const bad = results.filter((r: Any) => r.outcome === "FAIL").length;
  console.log(`\n${results.filter((r: Any) => r.outcome === "PASS").length} PASS, ${bad} FAIL, ${results.filter((r: Any) => r.outcome === "SKIPPED").length} SKIPPED`);
  process.exitCode = bad ? 1 : 0;
}

main().catch(async (e) => {
  console.error("verify-extension crashed:", e instanceof Error ? e.message.split(TOKEN).join("<token>") : e);
  await stopServer();
  process.exit(1);
});
