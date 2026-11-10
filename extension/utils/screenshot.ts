// Adapted from Pond (MIT) apps/extension/entrypoints/background/screenshot.ts @ deb305e
// Visible-tab capture cropped to a CSS-pixel rect × dpr on an OffscreenCanvas in the service worker.
import { browser } from "wxt/browser";

export class ScreenshotError extends Error {}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
  dpr: number;
}

/** Pixel crop for a CSS-pixel rect; width/height are exactly round(rect × dpr) unless clipped by the bitmap. */
export function cropFor(rect: CropRect, bitmap: { width: number; height: number }) {
  const x = Math.max(0, Math.round(rect.x * rect.dpr));
  const y = Math.max(0, Math.round(rect.y * rect.dpr));
  const width = Math.max(1, Math.min(bitmap.width - x, Math.round(rect.w * rect.dpr)));
  const height = Math.max(1, Math.min(bitmap.height - y, Math.round(rect.h * rect.dpr)));
  return { x, y, width, height };
}

async function requireActiveTab(tabId: number, windowId: number) {
  const [current] = await browser.tabs.query({ active: true, windowId });
  if (current?.id !== tabId) {
    throw new ScreenshotError("The active tab changed. Go back to the page and capture it again.");
  }
}

export async function captureTab(tabId: number, windowId: number, rect?: CropRect): Promise<Blob> {
  await requireActiveTab(tabId, windowId);
  const dataUrl = await browser.tabs.captureVisibleTab(windowId, { format: "png" });
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  try {
    const crop = rect ? cropFor(rect, bitmap) : { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
    const canvas = new OffscreenCanvas(crop.width, crop.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ScreenshotError("Screenshots aren't available.");
    ctx.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    bitmap.close();
  }
}
