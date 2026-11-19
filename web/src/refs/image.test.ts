import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES } from './contracts';
import { blockSize, dominantColor, fitWithin, hasTransparency, isAnimatedGif, validateImageFile } from './image';

const f = (type: string, size = 1000, name = 'a.png') => ({ type, size, name });

describe('validateImageFile', () => {
  it.each(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])('accepts %s', (t) => {
    expect(validateImageFile(f(t))).toEqual({ ok: true });
  });

  it('rejects other types with the contract message', () => {
    expect(validateImageFile(f('application/pdf', 10, 'doc.pdf'))).toEqual({
      ok: false,
      error: '“doc.pdf” isn\'t a supported image (PNG, JPEG, WebP, GIF or AVIF).',
    });
    expect(validateImageFile(f('', 10, 'x'))).toMatchObject({ ok: false });
    expect(validateImageFile(f('image/svg+xml'))).toMatchObject({ ok: false });
  });

  it('accepts exactly 25 MB and rejects one byte more', () => {
    expect(MAX_IMAGE_BYTES).toBe(25 * 1024 * 1024);
    expect(validateImageFile(f('image/png', MAX_IMAGE_BYTES))).toEqual({ ok: true });
    expect(validateImageFile(f('image/png', MAX_IMAGE_BYTES + 1, 'big.png'))).toEqual({
      ok: false,
      error: '“big.png” is larger than 25 MB.',
    });
  });

  it('checks the type before the size', () => {
    const r = validateImageFile(f('text/plain', MAX_IMAGE_BYTES + 1, 'a.txt'));
    expect(r.ok === false && r.error).toContain('supported image');
  });
});

describe('fitWithin', () => {
  it('scales landscape and portrait to the long side', () => {
    expect(fitWithin(3200, 1600, 1600)).toEqual({ width: 1600, height: 800 });
    expect(fitWithin(1000, 4000, 640)).toEqual({ width: 160, height: 640 });
  });
  it('keeps squares square', () => {
    expect(fitWithin(2000, 2000, 640)).toEqual({ width: 640, height: 640 });
  });
  it('never upscales', () => {
    expect(fitWithin(300, 200, 640)).toEqual({ width: 300, height: 200 });
    expect(fitWithin(640, 100, 640)).toEqual({ width: 640, height: 100 });
  });
  it('rounds to integers of at least 1', () => {
    expect(fitWithin(1001, 3, 500)).toEqual({ width: 500, height: 1 });
    const r = fitWithin(1234, 777, 640);
    expect(Number.isInteger(r.width) && Number.isInteger(r.height)).toBe(true);
    expect(fitWithin(0, 0, 640)).toEqual({ width: 1, height: 1 });
  });
});

describe('blockSize', () => {
  it('makes the long side 240', () => {
    expect(blockSize(1200, 600)).toEqual({ w: 240, h: 120 });
    expect(blockSize(600, 1200)).toEqual({ w: 120, h: 240 });
    expect(blockSize(500, 500)).toEqual({ w: 240, h: 240 });
  });
  it('upscales small images and rounds', () => {
    expect(blockSize(60, 30)).toEqual({ w: 240, h: 120 });
    expect(blockSize(1000, 333)).toEqual({ w: 240, h: 80 });
    expect(blockSize(10000, 1)).toEqual({ w: 240, h: 1 });
  });
  it('takes a custom long side', () => {
    expect(blockSize(400, 200, 100)).toEqual({ w: 100, h: 50 });
  });
});

const rgba = (...px: number[][]) => new Uint8ClampedArray(px.flat());

describe('dominantColor', () => {
  it('averages opaque pixels', () => {
    expect(dominantColor(rgba([255, 0, 0, 255], [0, 0, 255, 255]))).toBe('#800080');
  });
  it('ignores near-transparent pixels', () => {
    expect(dominantColor(rgba([10, 20, 30, 255], [255, 255, 255, 0], [255, 255, 255, 10]))).toBe('#0a141e');
  });
  it('falls back to a neutral colour when nothing is visible', () => {
    expect(dominantColor(rgba([0, 0, 0, 0]))).toBe('#e9e6e0');
    expect(dominantColor(new Uint8ClampedArray(0))).toBe('#e9e6e0');
  });
  it('samples a large buffer', () => {
    const big = new Uint8ClampedArray(32 * 32 * 4);
    for (let i = 0; i < big.length; i += 4) big.set([40, 80, 120, 255], i);
    expect(dominantColor(big)).toBe('#285078');
  });
});

describe('hasTransparency / isAnimatedGif', () => {
  it('detects alpha', () => {
    expect(hasTransparency(rgba([0, 0, 0, 255], [1, 1, 1, 255]))).toBe(false);
    expect(hasTransparency(rgba([0, 0, 0, 255], [1, 1, 1, 100]))).toBe(true);
  });

  const header = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x00, 0, 0];
  const frame = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x00, 2, 2, 0x44, 0x01, 0x00];
  const gce = [0x21, 0xf9, 4, 0, 0, 0, 0, 0];
  it('counts frames', () => {
    expect(isAnimatedGif(new Uint8Array([...header, ...gce, ...frame, 0x3b]))).toBe(false);
    expect(isAnimatedGif(new Uint8Array([...header, ...gce, ...frame, ...gce, ...frame, 0x3b]))).toBe(true);
    expect(isAnimatedGif(new Uint8Array([1, 2, 3]))).toBe(false);
  });
});
