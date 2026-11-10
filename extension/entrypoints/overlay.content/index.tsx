// Adapted from Pond (MIT) apps/extension/entrypoints/overlay.content/index.tsx @ deb305e
import shadowCss from "./shadow.css?inline";
import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import type { CaptureStateMessage } from "../../lib/contracts";
import type { OverlayCommand, RegionResult } from "../../utils/messages";
import { Region, type RegionRect } from "./Region";
import { Toasts } from "./Toasts";
import { getState, setHidden, setRegion, showState, subscribe } from "./store";

function Layer() {
  const state = useSyncExternalStore(subscribe, getState);
  const finish = (rect: RegionRect | null) => {
    setRegion(false);
    void browser.runtime.sendMessage({ type: "atelier.region-result", rect } satisfies RegionResult).catch(() => {});
  };
  return (
    <div className="layer" data-hidden={state.hidden || undefined}>
      {state.region && <Region onFinish={finish} />}
      <Toasts toasts={state.toasts} />
    </div>
  );
}

export default defineContentScript({
  // Injected on demand (toolbar / shortcut / menu use activeTab), so no broad match pattern in the manifest.
  registration: "runtime",
  // The stylesheet is inlined into the shadow root below: a runtime-registered script has no
  // web_accessible_resources match, so WXT could not fetch a separate css file on arbitrary pages.
  cssInjectionMode: "manual",
  async main(ctx) {
    const onMessage = (raw: unknown) => {
      const m = raw as CaptureStateMessage | OverlayCommand;
      if (m?.type === "atelier.capture-state") {
        showState(m.update);
        return Promise.resolve(true);
      }
      if (m?.type === "atelier.overlay") {
        if (m.view === "region") setRegion(true);
        if (m.view === "clear") setHidden(true);
        return Promise.resolve(true);
      }
      return undefined;
    };
    browser.runtime.onMessage.addListener(onMessage);
    ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(onMessage));

    const ui = await createShadowRootUi(ctx, {
      name: "atelier-overlay",
      position: "inline",
      anchor: "html",
      onMount(container) {
        const style = document.createElement("style");
        style.textContent = shadowCss;
        (container.getRootNode() as ShadowRoot).append(style);
        const root = createRoot(container);
        root.render(<Layer />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();
  },
});
