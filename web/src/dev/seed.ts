// Dev-only: window.__atelierSeed(n = 1500) adds n fake notes, window.__atelierUnseed() removes them.
// Notes only: no IndexedDB blobs and no backend sync (image/link adds upload to a connected backend).
// Uses only the public refs API: addNote (actions.ts), removeRef (actions.ts), refsStore.getSnapshot (store.ts).

import { addNote, removeRef } from '../refs/actions';
import { refsStore } from '../refs/store';
import { markMainSeen } from '../state/boards';

const PREFIX = '[seed] ';
const WORDS = 'linen oak velvet brass terracotta moss walnut cream indigo ceramic rattan marble sage amber'.split(' ');
const pick = (i: number, k: number) => WORDS[(i * 7 + k * 3) % WORDS.length];

declare global {
  interface Window {
    __atelierSeed?: (n?: number) => number;
    __atelierUnseed?: () => number;
  }
}

window.__atelierSeed = (n = 1500) => {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = addNote(`${pick(i, 0)} ${pick(i, 1)} ${pick(i, 2)} `.repeat(1 + (i % 6)), `${PREFIX}${pick(i, 0)} ${i}`);
    if (r.ok) ids.push(r.ref.id);
  }
  // Same task as the adds: BoardsProvider's auto-place runs in a later timeout, so these never land in main.
  markMainSeen(ids);
  return ids.length;
};

window.__atelierUnseed = () => {
  const mine = refsStore.getSnapshot().list.filter((r) => r.userAdded && r.title.startsWith(PREFIX));
  for (const r of mine) removeRef(r.id)?.commit();
  return mine.length;
};
