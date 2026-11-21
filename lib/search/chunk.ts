// Splits text into ~1800-char chunks with ~200 chars of overlap. Offsets point
// into the original string, so text.slice(start, end) === chunk.text.
export interface Chunk {
  text: string;
  start: number;
  end: number;
}

/** Find a good break in [lo, hi]: prefer sentence/paragraph end, then whitespace. Returns end offset or -1. */
function findBreak(text: string, lo: number, hi: number): number {
  let space = -1;
  for (let i = hi; i >= lo; i--) {
    const c = text[i - 1];
    const next = text[i];
    if (c === "\n" || ((c === "." || c === "!" || c === "?") && (next === undefined || /\s/.test(next)))) return i;
    if (space < 0 && /\s/.test(c)) space = i;
  }
  return space;
}

export function chunkText(text: string, size = 1800, overlap = 200): Chunk[] {
  if (!text || !text.trim()) return [];
  const out: Chunk[] = [];
  const len = text.length;
  const slack = Math.floor(size * 0.1);
  let start = 0;
  for (;;) {
    let end = Math.min(start + size, len);
    if (end < len) {
      // Prefer a break just before the target size, else just after it (stays within +-10%).
      let b = findBreak(text, start + size - slack, start + size);
      if (b < 0) b = findBreak(text, start + size + 1, Math.min(start + size + slack, len));
      if (b > start) end = b;
    }
    const piece = text.slice(start, end);
    if (piece.trim()) out.push({ text: piece, start, end });
    if (end >= len) break;
    // Step back by ~overlap, then forward to a word boundary so chunks don't begin mid-word.
    let next = Math.max(end - overlap, start + 1);
    while (next < end && next > 0 && !/\s/.test(text[next - 1])) next++;
    if (next >= end) next = Math.max(end - overlap, start + 1);
    start = next;
  }
  return out;
}
