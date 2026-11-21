// Test helpers: fake page network plus a spy on the HookEvents the main world posts.
import { vi } from "vitest";
import type { HookEvent } from "../../lib/contracts";
import { resetEmitted } from "./emit";
import { resetInterceptors } from "./intercept";

export interface FakeReply {
  status?: number;
  body: string;
}

export function setup(reply: FakeReply) {
  resetInterceptors();
  resetEmitted();
  const events: HookEvent[] = [];
  vi.spyOn(window, "postMessage").mockImplementation(((data: unknown) => {
    events.push(data as HookEvent);
  }) as typeof window.postMessage);
  const original = vi.fn(async () => new Response(reply.body, { status: reply.status ?? 200 }));
  window.fetch = original as unknown as typeof window.fetch;
  return { events, original };
}

export const settle = () => new Promise<void>((r) => setTimeout(r, 25));

/** Replaces XHR's native open/send with a fake network that answers immediately. */
export function fakeXhr(reply: FakeReply) {
  const proto = XMLHttpRequest.prototype;
  proto.open = function () {} as typeof proto.open;
  proto.setRequestHeader = function () {} as typeof proto.setRequestHeader;
  proto.send = function (this: XMLHttpRequest) {
    Object.defineProperty(this, "status", { value: reply.status ?? 200, configurable: true });
    Object.defineProperty(this, "responseText", { value: reply.body, configurable: true });
    queueMicrotask(() => this.dispatchEvent(new Event("load")));
  } as typeof proto.send;
}
