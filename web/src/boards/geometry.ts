import type { BoardItem, Camera } from '../types';
import { BOARD_TILE_H as TILE_H, BOARD_TILE_W as TILE_W, type BoardMeta } from '../state/contracts';
import { nextTileSlot } from '../state/boards';
import { FRAME_PAD } from '../canvas/surfaceBridge';
import { fitCamera } from '../canvas/useCamera';

/** Everything here is in world px unless noted. A tile is the outer frame, TILE_W x TILE_H. */
export { TILE_W, TILE_H };

/** The live preview sits inside the white card, inset a little, and is ~70% of the card height. */
export const PREVIEW_INSET = 8;
export const PREVIEW_X = FRAME_PAD + PREVIEW_INSET;
export const PREVIEW_Y = FRAME_PAD + PREVIEW_INSET;
export const PREVIEW_W = TILE_W - PREVIEW_X * 2;
export const PREVIEW_H = 190;

/** Overview fit limits. */
export const OVERVIEW_MIN_ZOOM = 0.35;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where "+ New board" sits: the same slot `store.create` will pick. */
export const newTileSlot = (boards: readonly BoardMeta[]) => nextTileSlot([...boards]);

export const tileRect = (b: { x: number; y: number }): Rect => ({ x: b.x, y: b.y, w: TILE_W, h: TILE_H });

/** A tile as Surface Field sees it: the card, so the bridge's frame padding restores the outer frame. */
export function tileFieldItem(id: string, b: { x: number; y: number }): BoardItem {
  return { id, refId: '', x: b.x + FRAME_PAD, y: b.y + FRAME_PAD, w: TILE_W - FRAME_PAD * 2, h: TILE_H - FRAME_PAD * 2, z: 0 };
}

/** All tile rects including the "+ New board" slot. */
export function overviewRects(boards: readonly BoardMeta[], extra: readonly Rect[] = []): Rect[] {
  return [...boards.filter((b) => !b.parentId).map(tileRect), tileRect(nextTileSlot([...boards])), ...extra];
}

export function overviewFit(boards: readonly BoardMeta[], w: number, h: number, extra: readonly Rect[] = []): Camera {
  return fitCamera(overviewRects(boards, extra), w, h, { minZoom: OVERVIEW_MIN_ZOOM, maxZoom: 1 });
}

/** How the mini items are laid out inside the preview box (preview px). */
export interface PreviewLayout {
  /** Scale applied to item coordinates. */
  zoom: number;
  /** Offset of the item-space origin inside the box. */
  x: number;
  y: number;
}

/** The same fit math as the board's own fit-to-content, run for the preview box and not clamped. */
export function previewLayout(items: readonly Rect[]): PreviewLayout {
  const cam = fitCamera(items as Rect[], PREVIEW_W, PREVIEW_H, { minZoom: 0, maxZoom: 1, clamp: false });
  return { zoom: cam.zoom, x: cam.x, y: cam.y };
}

export interface ZoomGeometry {
  /** Camera at the end of the zoom: the tile's preview box is under the frame, enlarged until its
   *  mini items sit exactly where the real items will be. */
  zoomed: Camera;
  /** The board's own fit-to-content camera. */
  fit: Camera;
}

/**
 * Shared-element zoom math. In the overview a mini item sits at
 *   P + zp * (item - c)
 * (P = preview center in world px, c = the items' bounds center, zp = preview zoom). The board's fit camera
 * puts the same item at frameCenter + zb * (item - c). A camera of zoom Z = zb / zp that sends P to
 * the frame center satisfies both, for any aspect ratio, so the swap from tile to board is invisible.
 */
export function zoomGeometry(meta: BoardMeta, items: readonly Rect[], fw: number, fh: number): ZoomGeometry {
  const px = meta.x + PREVIEW_X + PREVIEW_W / 2;
  const py = meta.y + PREVIEW_Y + PREVIEW_H / 2;
  const fit = fitCamera(items as Rect[], fw, fh, { maxZoom: 1 });
  let Z: number;
  if (items.length) {
    Z = fit.zoom / previewLayout(items).zoom;
  } else {
    // Nothing to match: just open the empty preview up to most of the frame.
    Z = Math.min((fw * 0.8) / PREVIEW_W, (fh * 0.8) / PREVIEW_H);
  }
  return { fit, zoomed: { zoom: Z, x: fw / 2 - Z * px, y: fh / 2 - Z * py } };
}

/**
 * CSS transform for the overview layer that keeps the tile preview exactly where it was under the
 * `from` camera while the world is now drawn with the `to` camera.
 */
export function compensate(from: Camera, to: Camera): string {
  const s = from.zoom / to.zoom;
  return `translate(${(from.x - to.x) / to.zoom}px, ${(from.y - to.y) / to.zoom}px) scale(${s})`;
}