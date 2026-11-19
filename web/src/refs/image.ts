// Image validation, resize maths and decode/resize. Pure helpers are unit-tested; processImage
// needs a browser (createImageBitmap + canvas).

import { IMAGE_TYPES, MAX_IMAGE_BYTES } from './contracts';

export const ORIGINAL_MAX = 1600;
export const THUMB_MAX = 640;
export const WEBP_QUALITY = 0.86;
export const NEUTRAL_COLOR = '#e9e6e0';

export function validateImageFile(file: {
  type: string;
  size: number;
  name: string;
}): { ok: true } | { ok: false; error: string } {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, error: `“${file.name}” isn't a supported image (PNG, JPEG, WebP, GIF or AVIF).` };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: `“${file.name}” is larger than 25 MB.` };
  }
  return { ok: true };
}

const posInt = (n: number) => (Number.isFinite(n) && n >= 1 ? n : 1);

/** Scales (w, h) down so the long side is at most `max`. Never upscales; integers ≥ 1. */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  const long = Math.max(w, h);
  const scale = long > max && long > 0 ? max / long : 1;
  return {
    width: Math.max(1, Math.round(posInt(w) * scale)),
    height: Math.max(1, Math.round(posInt(h) * scale)),
  };
}

/** World-px block size whose long side is exactly `long` (scales up as well as down). */
export function blockSize(w: number, h: number, long = 240): { w: number; h: number } {
  const pw = posInt(w);
  const ph = posInt(h);
  const scale = long / Math.max(pw, ph);
  return { w: Math.max(1, Math.round(pw * scale)), h: Math.max(1, Math.round(ph * scale)) };
}

const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** Average colour of an RGBA buffer, sampling up to ~1024 pixels and ignoring near-transparent ones. */
export function dominantColor(pixels: Uint8ClampedArray): string {
  const count = Math.floor(pixels.length / 4);
  const step = Math.max(1, Math.floor(count / 1024));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < count; i += step) {
    const o = i * 4;
    if (pixels[o + 3] < 32) continue;
    r += pixels[o];
    g += pixels[o + 1];
    b += pixels[o + 2];
    n++;
  }
  if (!n) return NEUTRAL_COLOR;
  return `#${toHex(r / n)}${toHex(g / n)}${toHex(b / n)}`;
}

/** True when any pixel is meaningfully transparent. */
export function hasTransparency(pixels: Uint8ClampedArray): boolean {
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 250) return true;
  return false;
}

/** Counts frames in a GIF byte stream; more than one means animated. */
export function isAnimatedGif(bytes: Uint8Array): boolean {
  if (bytes.length < 13 || bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) return false;
  let p = 10;
  const packed = bytes[p++];
  p += 2; // background colour index + aspect ratio
  if (packed & 0x80) p += 3 * 2 ** ((packed & 7) + 1);
  const skipSubBlocks = () => {
    while (p < bytes.length && bytes[p] !== 0) p += bytes[p] + 1;
    p++;
  };
  let frames = 0;
  while (p < bytes.length) {
    const b = bytes[p++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      p++; // extension label
      skipSubBlocks();
    } else if (b === 0x2c) {
      frames++;
      if (frames > 1) return true;
      p += 8;
      const lp = bytes[p++];
      if (lp & 0x80) p += 3 * 2 ** ((lp & 7) + 1);
      p++; // LZW minimum code size
      skipSubBlocks();
    } else {
      break;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Browser-only                                                        */
/* ------------------------------------------------------------------ */

export interface ProcessedImage {
  /** Original, resized to ≤1600 px (or the untouched file for an animated GIF). */
  original: Blob;
  /** ≤640 px thumbnail. */
  thumb: Blob;
  /** Natural size of the source image. */
  width: number;
  height: number;
  color: string;
  animated: boolean;
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release(): void;
}

async function decodeViaImg(blob: Blob): Promise<Decoded> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
}

async function decode(blob: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob);
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch {
      /* fall back to <img> */
    }
  }
  return decodeViaImg(blob);
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type AnyContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function draw(source: CanvasImageSource, w: number, h: number): { canvas: AnyCanvas; ctx: AnyContext } {
  let canvas: AnyCanvas;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(w, h);
  } else {
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as AnyContext | null;
  if (!ctx) throw new Error('Canvas is unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return { canvas, ctx };
}

function exportCanvas(canvas: AnyCanvas, type: string, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality),
  );
}

/** Decodes, resizes and encodes an image, and samples its dominant colour. */
export async function processImage(file: Blob): Promise<ProcessedImage> {
  const decoded = await decode(file);
  try {
    const { width, height, source } = decoded;
    if (!width || !height) throw new Error('Empty image');

    const sample = draw(source, 32, 32).ctx.getImageData(0, 0, 32, 32).data;
    const color = dominantColor(sample);

    const animated =
      file.type === 'image/gif' && isAnimatedGif(new Uint8Array(await file.arrayBuffer()));
    const outType = file.type === 'image/png' && hasTransparency(sample) ? 'image/png' : 'image/webp';

    const t = fitWithin(width, height, THUMB_MAX);
    const thumb = await exportCanvas(draw(source, t.width, t.height).canvas, animated ? 'image/webp' : outType, WEBP_QUALITY);

    let original: Blob = file;
    if (!animated) {
      const o = fitWithin(width, height, ORIGINAL_MAX);
      original = await exportCanvas(draw(source, o.width, o.height).canvas, outType, WEBP_QUALITY);
    }
    return { original, thumb, width, height, color, animated };
  } finally {
    decoded.release();
  }
}
