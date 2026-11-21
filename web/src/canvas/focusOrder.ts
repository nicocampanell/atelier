import type { BoardItem } from '../types';

/** An item whose top is within this many px of the row's bottom still starts a new row. */
const ROW_SLACK = 8;

/** Reading order for the focus view: top-to-bottom rows, left-to-right within a row. Excludes sub-board cards (items with boardId). */
export function focusOrder(items: BoardItem[]): BoardItem[] {
  const byTop = items.filter((i) => !i.boardId).sort((a, b) => a.y - b.y);
  const rows: BoardItem[][] = [];
  let bottom = -Infinity;
  for (const it of byTop) {
    if (rows.length && it.y < bottom - ROW_SLACK) {
      rows[rows.length - 1].push(it);
      bottom = Math.max(bottom, it.y + it.h);
    } else {
      rows.push([it]);
      bottom = it.y + it.h;
    }
  }
  return rows.flatMap((r) => r.sort((a, b) => a.x - b.x));
}
