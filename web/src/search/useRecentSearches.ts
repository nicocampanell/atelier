import { useCallback, useState } from 'react';

const KEY = 'atelier.recent-searches.v1';
const SEED = ['chair', 'gradient', 'interior light'];
const MAX = 8;

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const list = parsed.filter((s): s is string => typeof s === 'string' && s.trim() !== '');
        return list.slice(0, MAX);
      }
    }
  } catch {
    /* storage unavailable or corrupt: fall through to seed */
  }
  return SEED;
}

function save(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function useRecentSearches() {
  const [recents, setRecents] = useState<string[]>(load);

  const add = useCallback((query: string) => {
    const q = query.trim().replace(/\s+/g, ' ');
    if (!q) return;
    setRecents((prev) => {
      const next = [q, ...prev.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, MAX);
      save(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setRecents([]);
    save([]);
  }, []);

  return { recents, add, clear };
}
