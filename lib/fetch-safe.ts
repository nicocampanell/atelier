// SSRF-safe HTTP fetch.
//
// Defences:
//  - Only http/https, no URL credentials, ports limited to ALLOWED_PORTS
//    (80, 443, 8080, 8443; the scheme default when no port is given).
//  - IP-literal hosts are checked before connecting (they never reach `lookup`).
//  - Named hosts are resolved by our own `lookup` callback: ALL returned
//    addresses must be public, and the socket connects to those vetted
//    addresses, so DNS rebinding between "check" and "connect" is impossible.
//  - Redirects are followed manually and every hop is fully re-validated.
//  - Body size is enforced while streaming (after decompression), plus a total
//    wall-clock timeout across all hops.
//  - No cookies or Authorization header are ever sent.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import type { IncomingMessage } from "node:http";
import type { Readable } from "node:stream";

export const ALLOWED_PORTS = [80, 443, 8080, 8443];
export const PRIVATE_MESSAGE = "That address points to a private network and can't be saved.";

export type SafeFetchErrorCode =
  | "invalid_url"
  | "unsupported_scheme"
  | "private_address"
  | "too_large"
  | "timeout"
  | "too_many_redirects"
  | "network";

export class SafeFetchError extends Error {
  code: SafeFetchErrorCode;
  constructor(code: SafeFetchErrorCode, message: string) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
  }
}

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  body: Buffer;
}

// ---------- IP classification ----------

function parseV4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n <= 255) ? o : null;
}

function isPrivateV4(o: number[]): boolean {
  const [a, b, c] = o;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0/24
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function parseV6(input: string): number[] | null {
  let s = input.split("%")[0].toLowerCase();
  const lastColon = s.lastIndexOf(":");
  if (lastColon < 0) return null;
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseV4(tail);
    if (!v4) return null;
    s =
      s.slice(0, lastColon + 1) +
      ((v4[0] << 8) | v4[1]).toString(16) +
      ":" +
      ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...Array<string>(fill).fill("0"), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

function v4FromGroups(hi: number, lo: number): number[] {
  return [hi >> 8, hi & 255, lo >> 8, lo & 255];
}

function isPrivateV6(g: number[]): boolean {
  const firstFiveZero = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
  // IPv4-mapped ::ffff:a.b.c.d (dotted or hex form both parse to the same groups)
  if (firstFiveZero && g[5] === 0xffff) return isPrivateV4(v4FromGroups(g[6], g[7]));
  // NAT64 64:ff9b::/96 embeds an IPv4 address
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
    return isPrivateV4(v4FromGroups(g[6], g[7]));
  }
  // 64:ff9b:1::/48 local-use NAT64
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true;
  // 6to4 2002::/16 embeds an IPv4 address in bits 16..48
  if (g[0] === 0x2002) return isPrivateV4(v4FromGroups(g[1], g[2]));
  // Everything outside global unicast 2000::/3 is refused (::, ::1, fc00::/7,
  // fe80::/10, fec0::/10, ff00::/8, IPv4-compatible, ...).
  if ((g[0] & 0xe000) !== 0x2000) return true;
  // Within 2000::/3: Teredo, IETF protocol assignments, documentation.
  if (g[0] === 0x2001 && (g[1] < 0x200 || g[1] === 0x0db8)) return true;
  if (g[0] === 0x3fff) return true; // documentation 3fff::/20
  return false;
}

/** True for private, loopback, link-local, reserved, multicast or unparseable addresses. */
export function isPrivateAddress(ip: string): boolean {
  const bare = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
  const family = net.isIP(bare);
  if (family === 4) {
    const o = parseV4(bare);
    return o ? isPrivateV4(o) : true;
  }
  if (family === 6) {
    const g = parseV6(bare);
    return g ? isPrivateV6(g) : true;
  }
  return true; // not an IP: fail closed
}

// ---------- URL validation ----------

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

const BLOCKED_NAME = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)\.?$/i;

/**
 * Parse and validate a user-supplied URL without touching the network.
 * Rejects bad syntax, non-http(s) schemes, credentials, odd ports, and
 * literal private hosts. Names that merely resolve to private IPs are
 * caught later at connect time.
 */
export function assertPublicHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SafeFetchError("invalid_url", "That doesn't look like a valid web address.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new SafeFetchError("unsupported_scheme", "Only http and https links can be saved.");
  }
  if (u.username || u.password) {
    throw new SafeFetchError("invalid_url", "Links with a username or password can't be saved.");
  }
  if (u.port && !ALLOWED_PORTS.includes(Number(u.port))) {
    throw new SafeFetchError("invalid_url", "Links to that port can't be saved.");
  }
  const host = stripBrackets(u.hostname);
  if (!host) throw new SafeFetchError("invalid_url", "That doesn't look like a valid web address.");
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new SafeFetchError("private_address", PRIVATE_MESSAGE);
  } else if (BLOCKED_NAME.test(host)) {
    throw new SafeFetchError("private_address", PRIVATE_MESSAGE);
  }
  return u;
}

// ---------- vetted DNS lookup ----------

type LookupCb = (err: Error | null, address?: string | dns.LookupAddress[], family?: number) => void;

function vettedLookup(hostname: string, options: unknown, cb?: LookupCb): void {
  let callback = cb;
  let opts = (options ?? {}) as { all?: boolean; family?: number | string };
  if (typeof options === "function") {
    callback = options as LookupCb;
    opts = {};
  }
  const done = callback as LookupCb;
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return done(err);
    if (!addrs || addrs.length === 0) {
      return done(Object.assign(new Error("not found"), { code: "ENOTFOUND" }));
    }
    if (addrs.some((a) => isPrivateAddress(a.address))) {
      return done(new SafeFetchError("private_address", PRIVATE_MESSAGE));
    }
    let list = addrs;
    const fam = opts.family === 4 || opts.family === "IPv4" ? 4 : opts.family === 6 || opts.family === "IPv6" ? 6 : 0;
    if (fam) list = addrs.filter((a) => a.family === fam);
    if (list.length === 0) {
      return done(Object.assign(new Error("not found"), { code: "ENOTFOUND" }));
    }
    if (opts.all) return done(null, list);
    return done(null, list[0].address, list[0].family);
  });
}

// ---------- single hop ----------

interface HopResult {
  status: number;
  contentType: string;
  location: string | null;
  body: Buffer;
}

function friendlyNetworkError(e: unknown): SafeFetchError {
  if (e instanceof SafeFetchError) return e;
  const code = (e as { code?: string } | null)?.code ?? "";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return new SafeFetchError("network", "Couldn't find that site. Check the address and try again.");
  }
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EHOSTUNREACH" || code === "ENETUNREACH") {
    return new SafeFetchError("network", "Couldn't connect to that site.");
  }
  if (code === "ETIMEDOUT") return new SafeFetchError("timeout", "The site took too long to respond.");
  if (/CERT|SSL|TLS|ERR_TLS/i.test(code)) {
    return new SafeFetchError("network", "Couldn't establish a secure connection to that site.");
  }
  return new SafeFetchError("network", "Couldn't fetch that address.");
}

function hop(u: URL, maxBytes: number, deadline: number): Promise<HopResult> {
  return new Promise<HopResult>((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new SafeFetchError("timeout", "The site took too long to respond."));

    let settled = false;
    let req: http.ClientRequest | null = null;
    let res: IncomingMessage | null = null;
    let stream: Readable | null = null;
    const timer = setTimeout(() => finish(new SafeFetchError("timeout", "The site took too long to respond.")), remaining);

    function finish(err: unknown, value?: HopResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      res?.destroy();
      stream?.destroy();
      req?.destroy();
      if (err) reject(friendlyNetworkError(err));
      else resolve(value as HopResult);
    }

    const isHttps = u.protocol === "https:";
    const lib = isHttps ? https : http;
    try {
      req = lib.request(
        {
          protocol: u.protocol,
          hostname: stripBrackets(u.hostname),
          port: u.port || undefined,
          path: u.pathname + u.search,
          method: "GET",
          agent: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          lookup: vettedLookup as any,
          headers: {
            "User-Agent": "AtelierBot/0.1",
            Accept: "text/html,application/xhtml+xml,text/plain,image/*;q=0.8,*/*;q=0.5",
            "Accept-Encoding": "gzip, deflate, br",
          },
        },
        (response) => {
          res = response;
          const status = response.statusCode ?? 0;
          const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
          const location = typeof response.headers.location === "string" ? response.headers.location : null;

          if (status >= 300 && status < 400 && location) {
            return finish(null, { status, contentType, location, body: Buffer.alloc(0) });
          }

          const enc = String(response.headers["content-encoding"] ?? "").toLowerCase().trim();
          const cl = Number(response.headers["content-length"]);
          if (!enc && Number.isFinite(cl) && cl > maxBytes) {
            return finish(new SafeFetchError("too_large", "That page is too large to save."));
          }

          let source: Readable = response;
          if (enc === "gzip" || enc === "x-gzip") source = response.pipe(zlib.createGunzip());
          else if (enc === "deflate") source = response.pipe(zlib.createInflate());
          else if (enc === "br") source = response.pipe(zlib.createBrotliDecompress());
          else if (enc && enc !== "identity") {
            return finish(new SafeFetchError("network", "The site sent a response in an unsupported format."));
          }
          stream = source;

          const chunks: Buffer[] = [];
          let total = 0;
          source.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (total > maxBytes) {
              finish(new SafeFetchError("too_large", "That page is too large to save."));
              return;
            }
            chunks.push(chunk);
          });
          source.on("end", () => finish(null, { status, contentType, location: null, body: Buffer.concat(chunks) }));
          source.on("error", () => finish(new SafeFetchError("network", "The site sent a response we couldn't read.")));
          response.on("error", (e) => finish(e));
        },
      );
    } catch (e) {
      return finish(e);
    }
    req.on("error", (e) => finish(e));
    req.end();
  });
}

// ---------- public API ----------

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxRedirects = opts.maxRedirects ?? 5;
  const deadline = Date.now() + timeoutMs;

  let current = assertPublicHttpUrl(rawUrl);
  for (let redirects = 0; ; redirects++) {
    const r = await hop(current, maxBytes, deadline);
    if (r.location) {
      if (redirects >= maxRedirects) {
        throw new SafeFetchError("too_many_redirects", "That link redirected too many times.");
      }
      let next: URL;
      try {
        next = new URL(r.location, current);
      } catch {
        throw new SafeFetchError("invalid_url", "That link redirected to an invalid address.");
      }
      // Re-validate every hop: scheme, credentials, port, literal host.
      current = assertPublicHttpUrl(next.toString());
      continue;
    }
    return { finalUrl: current.toString(), status: r.status, contentType: r.contentType, body: r.body };
  }
}
