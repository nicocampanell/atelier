// Adapted from Pond (MIT) apps/extension/entrypoints/overlay.content/region/index.tsx @ deb305e
// Drag to select; Enter or Save confirms, Esc or Cancel aborts. (Pond's click-to-snap and handles are not ported.)
import { useEffect, useState, type PointerEvent } from "react";
import { clampPoint, rectBetween, viewportRect, type Point, type Rect } from "./geometry";

export interface RegionRect { x: number; y: number; w: number; h: number; dpr: number }

export function Region({ onFinish }: { onFinish: (rect: RegionRect | null) => void }) {
  const [start, setStart] = useState<Point | null>(null);
  const [box, setBox] = useState<Rect | null>(null);
  const [drawing, setDrawing] = useState(false);

  const confirm = () => {
    const rect = box && viewportRect(box);
    onFinish(rect);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onFinish(null); }
      if (e.key === "Enter" && box) { e.preventDefault(); e.stopPropagation(); confirm(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const at = (e: PointerEvent) => clampPoint(e.clientX, e.clientY);

  return (
    <div
      className="region"
      data-testid="region-surface"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic pointers can't always be captured; the surface covers the viewport anyway */
        }
        const p = at(e);
        setStart(p);
        setBox(null);
        setDrawing(true);
      }}
      onPointerMove={(e) => {
        if (drawing && start) setBox(rectBetween(start, at(e)));
      }}
      onPointerUp={() => setDrawing(false)}
    >
      {!box && <div className="hint">Drag to select an area. Esc to cancel.</div>}
      {box && (
        <div className="box" style={{ left: box.x, top: box.y, width: box.width, height: box.height }}>
          <span className="size">{Math.round(box.width)} × {Math.round(box.height)}</span>
        </div>
      )}
      {box && !drawing && (
        <div
          className="actions"
          style={{ left: Math.max(8, Math.min(innerWidth - 168, box.x + box.width - 160)), top: Math.min(innerHeight - 44, box.y + box.height + 8) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button type="button" className="btn" data-testid="region-cancel" onClick={() => onFinish(null)}>Cancel</button>
          <button type="button" className="btn primary" data-testid="region-save" onClick={confirm}>Save</button>
        </div>
      )}
    </div>
  );
}
