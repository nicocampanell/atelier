// Adapted from Pond (MIT) apps/extension/utils/intercept.ts @ deb305e
// Atelier: fetch/XHR observer only (no sendBeacon, no zod). Runs in the page's MAIN world.
// It never alters a request or response: bodies are read from clones after the page's own call.

type JsonSafeBody = Document | BodyInit | null | undefined;

export interface RequestLens {
  readonly url: string;
  readonly method: string;
  getHeader(name: string): string | null;
  readBody(): Promise<string | null>;
}

export interface ResponseLens {
  readonly status: number;
  readonly ok: boolean;
  readText(): Promise<string | null>;
}

export interface SourceInterceptor {
  id: string;
  match(req: RequestLens): boolean;
  onResponse(req: RequestLens, res: ResponseLens): void | Promise<void>;
}

interface Registry {
  handlers: SourceInterceptor[];
  ids: Set<string>;
  patchedFetch: boolean;
  patchedXhr: boolean;
  restore: Array<() => void>;
}

const REGISTRY_KEY = Symbol.for("atelier.interceptors");

type WindowWithRegistry = Window & { [REGISTRY_KEY]?: Registry };

function registry(): Registry {
  const w = window as WindowWithRegistry;
  const existing = w[REGISTRY_KEY];
  if (existing) return existing;
  const created: Registry = {
    handlers: [],
    ids: new Set(),
    patchedFetch: false,
    patchedXhr: false,
    restore: [],
  };
  w[REGISTRY_KEY] = created;
  return created;
}

/** Undo every patch and forget handlers. Used by tests; never called in the page. */
export function resetInterceptors(): void {
  const w = window as WindowWithRegistry;
  const reg = w[REGISTRY_KEY];
  if (!reg) return;
  for (const undo of reg.restore.reverse()) undo();
  delete w[REGISTRY_KEY];
}

function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | undefined;
  return () => {
    if (!cached) cached = fn();
    return cached;
  };
}

function normalizeHeaders(source: HeadersInit | Headers | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!source) return out;
  if (typeof Headers !== "undefined" && source instanceof Headers) {
    source.forEach((value, key) => out.set(key.toLowerCase(), value));
    return out;
  }
  if (Array.isArray(source)) {
    for (const entry of source) {
      if (Array.isArray(entry) && entry.length >= 2) out.set(String(entry[0]).toLowerCase(), String(entry[1]));
    }
    return out;
  }
  for (const [key, value] of Object.entries(source)) out.set(key.toLowerCase(), String(value));
  return out;
}

async function bodyToText(body: JsonSafeBody): Promise<string | null> {
  if (body == null) return null;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const params = new URLSearchParams();
    body.forEach((value, key) => {
      params.append(key, typeof value === "string" ? value : "[file]");
    });
    return params.toString();
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    try {
      return await body.text();
    } catch {
      return null;
    }
  }
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
  return null;
}

function safeMatch(handler: SourceInterceptor, req: RequestLens): boolean {
  try {
    return handler.match(req);
  } catch {
    return false;
  }
}

function dispatch(matched: SourceInterceptor[], req: RequestLens, res: ResponseLens): void {
  for (const handler of matched) {
    try {
      const result = handler.onResponse(req, res);
      if (result instanceof Promise) result.catch(() => {});
    } catch {
      /* hooks never throw into the page */
    }
  }
}

function patchFetch(reg: Registry): void {
  if (reg.patchedFetch) return;
  reg.patchedFetch = true;
  const origFetch = window.fetch;
  reg.restore.push(() => {
    window.fetch = origFetch;
  });

  window.fetch = function patchedFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let matched: SourceInterceptor[] = [];
    let req: RequestLens | null = null;
    try {
      const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
      const url = request ? request.url : String(input);
      const method = String(init?.method ?? request?.method ?? "GET").toUpperCase();
      const headers = normalizeHeaders(init?.headers ?? request?.headers);
      if (reg.handlers.length > 0) {
        // Clone before the page consumes the body; reading happens later, off the page's path.
        let requestClone: Request | null = null;
        if (request && init?.body == null) {
          try {
            requestClone = request.clone();
          } catch {
            requestClone = null;
          }
        }
        const readBody = once(async () => {
          if (init?.body != null) return bodyToText(init.body);
          if (requestClone) {
            try {
              return await requestClone.text();
            } catch {
              return null;
            }
          }
          return null;
        });
        const lens: RequestLens = {
          url,
          method,
          getHeader: (name) => headers.get(name.toLowerCase()) ?? null,
          readBody,
        };
        req = lens;
        matched = reg.handlers.filter((h) => safeMatch(h, lens));
      }
    } catch {
      matched = [];
    }

    const promise = origFetch.call(this as Window, input, init);
    if (matched.length === 0 || !req) return promise;

    const activeReq = req;
    const activeMatched = matched;
    promise
      .then((response) => {
        let clone: Response | null = null;
        try {
          clone = response.clone();
        } catch {
          clone = null;
        }
        const readText = once(async () => {
          if (!clone) return null;
          try {
            return await clone.text();
          } catch {
            return null;
          }
        });
        dispatch(activeMatched, activeReq, { status: response.status, ok: response.ok, readText });
      })
      .catch(() => {});
    return promise;
  };
}

interface XhrState {
  method: string;
  url: string;
  headers: Map<string, string>;
}

function patchXhr(reg: Registry): void {
  if (reg.patchedXhr) return;
  reg.patchedXhr = true;

  const proto = XMLHttpRequest.prototype;
  const origOpen = proto.open;
  const origSend = proto.send;
  const origSetHeader = proto.setRequestHeader;
  reg.restore.push(() => {
    proto.open = origOpen;
    proto.send = origSend;
    proto.setRequestHeader = origSetHeader;
  });
  const states = new WeakMap<XMLHttpRequest, XhrState>();

  proto.open = function patchedOpen(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    states.set(this, { method: String(method ?? "GET").toUpperCase(), url: String(url ?? ""), headers: new Map() });
    return (origOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof proto.open;

  proto.setRequestHeader = function patchedSetRequestHeader(this: XMLHttpRequest, name: string, value: string) {
    states.get(this)?.headers.set(String(name).toLowerCase(), String(value));
    return origSetHeader.call(this, name, value);
  };

  proto.send = function patchedSend(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    try {
      const state = states.get(this);
      if (state && reg.handlers.length > 0) {
        const req: RequestLens = {
          url: state.url,
          method: state.method,
          getHeader: (name) => state.headers.get(name.toLowerCase()) ?? null,
          readBody: once(() => bodyToText(body ?? null)),
        };
        const matched = reg.handlers.filter((h) => safeMatch(h, req));
        if (matched.length > 0) {
          this.addEventListener(
            "load",
            () => {
              const readText = once(async () =>
                this.responseType === "" || this.responseType === "text" ? this.responseText : null,
              );
              dispatch(matched, req, {
                status: this.status,
                ok: this.status >= 200 && this.status < 300,
                readText,
              });
            },
            { once: true },
          );
        }
      }
    } catch {
      /* never interfere with the page's request */
    }
    return origSend.call(this, body);
  };
}

export function installInterceptor(def: SourceInterceptor): void {
  const reg = registry();
  if (reg.ids.has(def.id)) return;
  reg.ids.add(def.id);
  reg.handlers.push(def);
  patchFetch(reg);
  patchXhr(reg);
}
