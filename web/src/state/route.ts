import { useCallback, useMemo, useSyncExternalStore } from 'react';

export type Route = { name: 'boards' } | { name: 'board'; id: string } | { name: 'library' };

/** '' | '#/' | unknown -> boards. Board ids are URI-encoded in the hash. */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').split('?')[0];
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'library') return { name: 'library' };
  if (parts[0] === 'boards' && parts[1]) {
    try {
      return { name: 'board', id: decodeURIComponent(parts[1]) };
    } catch {
      /* malformed escape: fall through */
    }
  }
  return { name: 'boards' };
}

export function formatRoute(route: Route): string {
  switch (route.name) {
    case 'boards':
      return '#/boards';
    case 'board':
      return `#/boards/${encodeURIComponent(route.id)}`;
    case 'library':
      return '#/library';
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

const getHash = () => window.location.hash;
const getServerHash = () => '';

export function useRoute(): [Route, (next: Route) => void] {
  const hash = useSyncExternalStore(subscribe, getHash, getServerHash);
  const route = useMemo(() => parseRoute(hash), [hash]);
  const navigate = useCallback((next: Route) => {
    const target = formatRoute(next);
    if (target === formatRoute(parseRoute(window.location.hash))) return;
    window.location.hash = target;
  }, []);
  return [route, navigate];
}
