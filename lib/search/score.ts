// Scoring helpers, re-written in TypeScript from the ideas in DigUp (MIT):
// per-query z-score gate on similarities, hybrid meaning + word-coverage score.

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** Population z-scores. If the spread is ~0, everything is 0. */
export function zScores(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  if (std < 1e-9) return values.map(() => 0);
  return values.map((v) => (v - mean) / std);
}

export const GATE_MIN_CANDIDATES = 5;
/** Absolute cosine floor. Random 64-dim vectors have cosine std ~0.125, so 0.45 is ~3.6 sigma. */
export const GATE_SIM_FLOOR = 0.45;
/** The hit must also sit this far above the candidate mean in raw similarity
 *  (guards all-positive embeddings where tiny spreads give big z-scores). */
export const GATE_MIN_MARGIN = 0.15;

/**
 * Indices whose similarity is a real outlier: z >= threshold AND sim >= floor
 * AND sim - mean >= margin, and only when there are at least 5 candidates
 * (fewer -> no meaning signal at all). Unrelated queries give a flat
 * similarity distribution with no outliers, so nothing passes.
 */
export function zGate(sims: number[], threshold = 2): number[] {
  if (sims.length < GATE_MIN_CANDIDATES) return [];
  const mean = sims.reduce((s, v) => s + v, 0) / sims.length;
  const z = zScores(sims);
  const idx: number[] = [];
  for (let i = 0; i < sims.length; i++) {
    if (z[i] >= threshold && sims[i] >= GATE_SIM_FLOOR && sims[i] - mean >= GATE_MIN_MARGIN) idx.push(i);
  }
  return idx;
}

/** Codes like IMG_2041, v1.2.3, INV-2024-001, hex hashes, mixed letters+digits. */
export function isIdLike(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  const tokens = q.split(/\s+/);
  return tokens.some((t) => {
    if (t.length < 3) return false;
    const hasDigit = /\d/.test(t);
    const hasLetter = /[a-z]/i.test(t);
    if (hasDigit && hasLetter) return true; // IMG2041, abc123
    if (hasDigit && /[._-]/.test(t) && /\d[._-]\d|[._-]\d|\d[._-]/.test(t)) return true; // 1.2.3, 2024-001
    if (/^[0-9a-f]{8,}$/i.test(t)) return true; // hex-ish
    if (/^[A-Za-z]{2,}[_-][A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$/.test(t) && /[_-]/.test(t) && /[A-Z]/.test(t) && t === t.toUpperCase()) return true; // INV-ABC
    return false;
  });
}

const STOP = new Set([
  "a","an","the","and","or","of","to","in","on","for","with","is","are","was","at","by","it","this","that","as","be","from",
]);

function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && /(?:[sxz]|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Distinct query terms (stop words dropped unless that would leave none). */
export function queryTerms(query: string): string[] {
  const all = [...new Set(tokenize(query))];
  const kept = all.filter((t) => !STOP.has(t));
  return kept.length ? kept : all;
}

/** Fraction of distinct query terms present in text (light stemming). */
export function coverage(query: string, text: string): number {
  const terms = queryTerms(query);
  if (!terms.length || !text) return 0;
  const toks = tokenize(text);
  const have = new Set<string>();
  for (const t of toks) {
    have.add(t);
    have.add(stem(t));
  }
  let hit = 0;
  // A term also counts when it is a prefix (3+ chars) of a word, matching the prefix search.
  for (const t of terms) if (have.has(t) || have.has(stem(t)) || (t.length >= 3 && toks.some((w) => w.startsWith(t)))) hit++;
  return hit / terms.length;
}

export function hybridScore(meaning: number, cov: number, idLike: boolean): number {
  const c = Math.max(0, Math.min(1, cov)) ** 1.5;
  return idLike ? 0.5 * meaning + 4.0 * c : meaning + 2.0 * c;
}

export function rankHybrid(
  cands: { id: string; meaning: number; coverage: number }[],
  query: string,
): { id: string; score: number }[] {
  const idLike = isIdLike(query);
  return cands
    .map((c) => ({ id: c.id, score: hybridScore(c.meaning, c.coverage, idLike) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** Weaker = scored under half of the top score. Input must be sorted desc. */
export function splitWeaker<T extends { score: number }>(hits: T[]): { hits: T[]; weaker: T[] } {
  if (!hits.length) return { hits: [], weaker: [] };
  const top = Math.max(...hits.map((h) => h.score));
  return { hits: hits.filter((h) => h.score >= 0.5 * top), weaker: hits.filter((h) => h.score < 0.5 * top) };
}
