// Adapted from Pond (MIT) apps/extension/sources/index.ts @ deb305e
// Atelier: four sites only; plain host matching instead of Pond's schema package.
import type { SourceId } from "../lib/contracts";
import { matches as arena } from "./arena/matches";
import { matches as instagram } from "./instagram/matches";
import { matches as pinterest } from "./pinterest/matches";
import { matches as twitter } from "./twitter/matches";

export const HOOK_SOURCES: Record<SourceId, { matches: readonly string[] }> = {
  pinterest: { matches: pinterest },
  arena: { matches: arena },
  twitter: { matches: twitter },
  instagram: { matches: instagram },
};

export const HOOK_SOURCE_IDS = Object.keys(HOOK_SOURCES) as SourceId[];

export const HOOK_MATCHES: string[] = HOOK_SOURCE_IDS.flatMap((id) => [...HOOK_SOURCES[id].matches]);

function hostMatches(pattern: string, hostname: string): boolean {
  const host = /^https:\/\/([^/]+)\//.exec(pattern)?.[1];
  if (!host) return false;
  if (host.startsWith("*.")) {
    const base = host.slice(2);
    return hostname === base || hostname.endsWith(`.${base}`);
  }
  return hostname === host;
}

export function hookSourceForUrl(url: string): SourceId | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const hostname = parsed.hostname.toLowerCase();
  return HOOK_SOURCE_IDS.find((id) => HOOK_SOURCES[id].matches.some((p) => hostMatches(p, hostname))) ?? null;
}
