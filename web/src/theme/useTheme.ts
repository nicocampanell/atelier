import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'atelier.theme';

const initial = (): Theme => {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // storage blocked: fall through to the OS preference
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    // Surface Field recolours its dots when the root's class changes (it ignores data-theme).
    root.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // not persisted; still applies for this session
    }
    setTheme(next);
  };

  return { theme, toggle };
}
