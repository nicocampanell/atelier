// Adapted from Pond (MIT) apps/extension/entrypoints/overlay.content/toasts/index.tsx @ deb305e
import { browser } from "wxt/browser";
import type { CaptureState } from "../../lib/contracts";
import { dismiss, type ToastItem } from "./store";

function copy(s: CaptureState): { title: string; detail: string | null } {
  const where = (name: string | null) => (name ? ` in ${name}` : "");
  switch (s.state) {
    case "sending": return { title: "Saving to Atelier…", detail: null };
    // Accepted by the server, not processed yet: say so.
    case "saved": return { title: `Saved${where(s.projectName)}`, detail: "Still processing" };
    case "ready": return { title: `Ready${where(s.projectName)}`, detail: s.title };
    case "duplicate": return { title: `Already saved${where(s.projectName)}`, detail: "Added again" };
    case "failed": return { title: "Couldn't save", detail: s.message };
    case "signed-out": return { title: "Sign in to Atelier", detail: "Open the Atelier toolbar button to connect." };
  }
}

function send(message: unknown) {
  void browser.runtime.sendMessage(message).catch(() => {});
}

export function Toasts({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="toasts" role="region" aria-label="Atelier">
      {toasts.map(({ state }) => {
        const { title, detail } = copy(state);
        return (
          <div key={state.captureId} className="toast" data-state={state.state} role={state.state === "failed" ? "alert" : "status"}>
            <div className="dot" aria-hidden />
            <div className="text">
              <div className="title">{title}</div>
              {detail && <div className="detail">{detail}</div>}
              <div className="row">
                {state.state === "failed" && state.retry && (
                  <button type="button" className="link" data-testid="toast-retry" onClick={() => send({ type: "atelier.retry", captureId: state.captureId })}>
                    Retry
                  </button>
                )}
                {(state.state === "saved" || state.state === "ready" || state.state === "duplicate") && (
                  <button type="button" className="link" onClick={() => send({ type: "atelier.open-app" })}>
                    Open Atelier
                  </button>
                )}
              </div>
            </div>
            <button type="button" className="close" aria-label="Dismiss" onClick={() => dismiss(state.captureId)}>×</button>
          </div>
        );
      })}
    </div>
  );
}
