import { useCallback, useState } from 'react';

const KEY = 'atelier.recently-viewed.v1';
const SEED = ['r-chair-1', 'r-grad-2', 'l-surface', 'r-headphones', 'n-chairs', 'r-arch-white'];
const MAX = 12;

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // An explicitly cleared (empty) list stays empty; only a missing/corrupt entry seeds.
        return parsed.filter((s): s is string => typeof s === 'string').slice(0, MAX);
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

export function useRecentlyViewed() {
  const [ids, setIds] = useState<string[]>(load);

  const add = useCallback((id: string) => {
    setIds((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, MAX);
      save(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setIds([]);
    save([]);
  }, []);

  return { ids, add, clear };
}
