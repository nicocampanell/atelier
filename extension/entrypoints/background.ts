// Adapted from Pond (MIT) apps/extension/entrypoints/background/{index,menus,toolbar,overlay}.ts @ deb305e
import { browser, type Browser } from "wxt/browser";
import type { CaptureMessage, CaptureState, CaptureStateMessage } from "../lib/contracts";
import { SETTINGS_KEY } from "../lib/contracts";
import { retryCapture, startCapture, type CaptureContext } from "../utils/pipeline";
import { getSettings } from "../utils/settings";
import type { BackgroundMessage, OverlayCommand } from "../utils/messages";

const OVERLAY_SCRIPT = "/content-scripts/overlay.js";
const MENU_PAGE = "atelier-save-page";
const MENU_IMAGE = "atelier-save-image";
const MENU_REGION = "atelier-save-region";
const MENU_SETTINGS = "atelier-settings";

function isWebUrl(url: string | undefined): url is string {
  return !!url && /^https?:\/\//i.test(url);
}

// ---------------------------------------------------------------- overlay delivery

async function sendToTab(tabId: number, message: unknown): Promise<boolean> {
  try {
    await browser.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    return false;
  }
}

/** Injecting twice would stack overlays, so only inject when nothing answered. False on pages that refuse scripts. */
async function deliver(tabId: number, message: unknown): Promise<boolean> {
  if (await sendToTab(tabId, message)) return true;
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: [OVERLAY_SCRIPT] });
  } catch {
    return false;
  }
  return sendToTab(tabId, message);
}

const BADGES: Partial<Record<CaptureState["state"], { text: string; color: string }>> = {
  saved: { text: "✓", color: "#1f9d55" },
  ready: { text: "✓", color: "#1f9d55" },
  duplicate: { text: "✓", color: "#1f9d55" },
  failed: { text: "!", color: "#cc3333" },
  "signed-out": { text: "!", color: "#dd9b00" },
};

function flashBadge(tabId: number | undefined, state: CaptureState) {
  const badge = BADGES[state.state];
  if (!badge || !browser.action) return;
  const target = tabId === undefined ? {} : { tabId };
  void browser.action.setBadgeBackgroundColor({ color: badge.color, ...target }).catch(() => {});
  void browser.action.setBadgeText({ text: badge.text, ...target }).catch(() => {});
  setTimeout(() => void browser.action.setBadgeText({ text: "", ...target }).catch(() => {}), 2500);
}

/** One chain per tab keeps states in order and stops two emits from both injecting the overlay. */
const chains = new Map<number, Promise<void>>();

function emit(update: CaptureState, ctx: CaptureContext) {
  const message: CaptureStateMessage = { type: "atelier.capture-state", update };
  const tabId = ctx.tabId;
  if (tabId === undefined) return flashBadge(undefined, update);
  const next = (chains.get(tabId) ?? Promise.resolve())
    .then(() => deliver(tabId, message))
    .then((shown) => {
      if (!shown) flashBadge(tabId, update);
    })
    .catch(() => {});
  chains.set(tabId, next);
}

// ---------------------------------------------------------------- capture entry points

async function capture(msg: CaptureMessage, ctx: CaptureContext) {
  const started = await startCapture(msg, ctx, emit);
  if (!started) return null;
  // The first state is shown right away; later ones arrive through emit().
  emit(started.reply, ctx);
  void started.done.catch(() => {});
  return started;
}

export type Tool = "page" | "region";

export async function runTool(tab: Browser.tabs.Tab, tool: Tool): Promise<void> {
  if (tab.id === undefined) return;
  if (!isWebUrl(tab.url)) {
    flashBadge(tab.id, { state: "failed", captureId: "", message: "", retry: false });
    return;
  }
  if (tool === "page") {
    await capture(
      { type: "atelier.capture", request: { kind: "page", url: tab.url, title: tab.title }, origin: { type: "toolbar" } },
      { tabId: tab.id, windowId: tab.windowId },
    );
    return;
  }
  await deliver(tab.id, { type: "atelier.overlay", view: "region" } satisfies OverlayCommand);
}

async function onCommand(command: string) {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  if (command === "save-page") {
    if (!isWebUrl(tab.url) || tab.id === undefined) return;
    await capture(
      { type: "atelier.capture", request: { kind: "page", url: tab.url, title: tab.title }, origin: { type: "shortcut" } },
      { tabId: tab.id, windowId: tab.windowId },
    );
  } else if (command === "screenshot-region") {
    await runTool(tab, "region");
  }
}

export async function handleMenuClick(info: Browser.contextMenus.OnClickData, tab?: Browser.tabs.Tab) {
  const id = String(info.menuItemId);
  if (id === MENU_SETTINGS) return openPopup();
  if (!tab || tab.id === undefined) return;
  const ctx = { tabId: tab.id, windowId: tab.windowId };
  const pageUrl = info.pageUrl ?? tab.url;
  if (id === MENU_PAGE) return void (await runTool(tab, "page"));
  if (id === MENU_REGION) return void (await runTool(tab, "region"));
  if (id === MENU_IMAGE && info.srcUrl && isWebUrl(info.srcUrl) && isWebUrl(pageUrl)) {
    await capture(
      { type: "atelier.capture", request: { kind: "image", imageUrl: info.srcUrl, pageUrl, title: tab.title }, origin: { type: "menu" } },
      ctx,
    );
  }
}

async function openPopup() {
  try {
    await browser.action.openPopup();
  } catch {
    await browser.tabs.create({ url: browser.runtime.getURL("/popup.html") });
  }
}

function createMenus() {
  void browser.contextMenus.removeAll().then(() => {
    browser.contextMenus.create({ id: MENU_PAGE, title: "Save page to Atelier", contexts: ["page", "selection"] });
    browser.contextMenus.create({ id: MENU_IMAGE, title: "Save image to Atelier", contexts: ["image"] });
    browser.contextMenus.create({ id: MENU_REGION, title: "Save region to Atelier", contexts: ["page", "selection", "image"] });
    browser.contextMenus.create({ id: MENU_SETTINGS, title: "Choose project…", contexts: ["action"] });
  });
}

/** Signed out: the toolbar opens the popup (sign-in). Signed in: one click saves the page. */
async function applyToolbar() {
  if (!browser.action) return;
  const { token } = await getSettings();
  await browser.action.setPopup({ popup: token ? "" : "popup.html" }).catch(() => {});
  await browser.action.setTitle({ title: token ? "Save to Atelier" : "Sign in to Atelier" }).catch(() => {});
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => createMenus());
  browser.runtime.onStartup.addListener(() => createMenus());
  void applyToolbar();
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[SETTINGS_KEY]) void applyToolbar();
  });

  browser.action?.onClicked.addListener((tab) => void runTool(tab, "page"));
  browser.commands.onCommand.addListener((c) => void onCommand(c));
  browser.contextMenus.onClicked.addListener((info, tab) => void handleMenuClick(info, tab));

  browser.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return false;
    const message = raw as CaptureMessage | BackgroundMessage;
    const tabId = sender.tab?.id;
    if (message?.type === "atelier.capture") {
      void capture(message, { tabId, windowId: sender.tab?.windowId }).then((s) => sendResponse(s?.reply ?? null));
      return true;
    }
    if (message?.type === "atelier.retry") {
      void retryCapture(message.captureId, emit);
      return false;
    }
    if (message?.type === "atelier.open-app") {
      void getSettings().then((s) => browser.tabs.create({ url: s.serverUrl }));
      return false;
    }
    if (message?.type === "atelier.region-result") {
      void onRegionResult(message, sender.tab);
      return false;
    }
    return false;
  });

  if (typeof __ATELIER_TEST__ !== "undefined" && __ATELIER_TEST__) {
    // Test hook: lets the E2E script drive the same functions the UI drives.
    (globalThis as Record<string, unknown>).__atelierTest = { runTool, handleMenuClick, onCommand };
  }
});

async function onRegionResult(message: Extract<BackgroundMessage, { type: "atelier.region-result" }>, tab?: Browser.tabs.Tab) {
  if (!tab || tab.id === undefined || !message.rect || !isWebUrl(tab.url)) return;
  // Clear Atelier's own UI first so it is not in the pixels.
  await sendToTab(tab.id, { type: "atelier.overlay", view: "clear" } satisfies OverlayCommand);
  await new Promise((r) => setTimeout(r, 120));
  await capture(
    { type: "atelier.capture", request: { kind: "screenshot", pageUrl: tab.url, title: tab.title, rect: message.rect }, origin: { type: "menu" } },
    { tabId: tab.id, windowId: tab.windowId },
  );
}
