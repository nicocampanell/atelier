// Adapted from Pond (MIT) apps/extension/entrypoints/overlay.content/store.ts @ deb305e
import type { CaptureState } from "../../lib/contracts";

export interface ToastItem {
  state: CaptureState;
  updatedAt: number;
}
export interface OverlayState {
  toasts: ToastItem[];
  region: boolean;
  hidden: boolean;
}

let state: OverlayState = { toasts: [], region: false, hidden: false };
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function set(next: Partial<OverlayState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export const getState = () => state;
export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** How long a toast stays once it reaches this state. "saved" outlives polling (~30 s) and is replaced by "ready". */
function lifetime(s: CaptureState): number | null {
  switch (s.state) {
    case "sending": return null;
    case "saved": return 40_000;
    case "failed": return s.retry ? 20_000 : 8_000;
    default: return 4_500;
  }
}

export function dismiss(captureId: string) {
  clearTimeout(timers.get(captureId));
  timers.delete(captureId);
  set({ toasts: state.toasts.filter((t) => t.state.captureId !== captureId) });
}

export function showState(update: CaptureState) {
  const others = state.toasts.filter((t) => t.state.captureId !== update.captureId);
  const existing = state.toasts.find((t) => t.state.captureId === update.captureId);
  const item = { state: update, updatedAt: Date.now() };
  // Keep position when updating in place.
  const toasts = existing
    ? state.toasts.map((t) => (t.state.captureId === update.captureId ? item : t))
    : [...others, item];
  clearTimeout(timers.get(update.captureId));
  const ms = lifetime(update);
  if (ms !== null) timers.set(update.captureId, setTimeout(() => dismiss(update.captureId), ms));
  set({ toasts, hidden: false });
  // Shared-DOM trail so tests (and curious users) can see the real sequence of states.
  const host = document.querySelector("atelier-overlay");
  if (host) {
    const trail = (host.getAttribute("data-history") ?? "").split(",").filter(Boolean);
    if (trail[trail.length - 1] !== update.state) trail.push(update.state);
    host.setAttribute("data-history", trail.join(","));
  }
}

export const setRegion = (region: boolean) => set({ region });
export const setHidden = (hidden: boolean) => set({ hidden, region: hidden ? false : state.region });
