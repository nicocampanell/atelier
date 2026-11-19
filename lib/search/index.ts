// Hybrid search: Postgres full-text (words) + cosine over stored embeddings (meaning),
// combined per save. All queries are scoped by user_id and skip deleted saves.
import { randomUUID } from "node:crypto";
import { scoreWithJev } from "./jev";
import { jevFormat, loadSaveImage } from "./image";
import { tagSearchText } from "./tags";
import { db, sbError } from "../db";
import type { Save, SaveKind, SearchHit, SearchResponse, SaveStatus } from "../types";
import { chunkText } from "./chunk";
import { embed, isSemanticEnabled } from "./embed";
import { coverage, cosine, hybridScore, isIdLike, queryTerms, rankHybrid, splitWeaker, zGate } from "./score";

export interface IndexableDoc {
  title: string;
  description: string | null;
  /** Extracted plain text of the page or file (may be empty). */
  text: string;
  sourceUrl: string | null;
  kind: SaveKind;
  /** Visual tags (images); indexed with their synonyms so descriptions find untitled images. */
  tags?: readonly string[] | null;
}

const MAX_CHUNKS = 200;
const MAX_RESULTS = 50;
const KEYWORD_ROW_LIMIT = 2000;
const JEV_MIN = 0.5;

async function safeEmbed(text: string): Promise<number[] | null> {
  try {
    return await embed({ text });
  } catch {
    return null; // embedding failures never fail indexing
  }
}

/** Replace all search segments for a save. */
export async function indexSave(userId: string, saveId: string, doc: IndexableDoc): Promise<void> {
  const head = [doc.title, doc.description, doc.tags?.length ? tagSearchText(doc.tags) : null].filter((s): s is string => Boolean(s && s.trim())).join("\n");
  const chunks = chunkText(doc.text ?? "").slice(0, MAX_CHUNKS);
  const segs: { text: string; start: number; end: number | null }[] = [];
  if (head) segs.push({ text: head, start: 0, end: null });
  for (const c of chunks) segs.push({ text: c.text, start: c.start, end: c.end });

  const vectors: (number[] | null)[] = new Array(segs.length).fill(null);
  if (isSemanticEnabled()) {
    const CONC = 4;
    let next = 0;
    await Promise.all(
      Array.from({ length: CONC }, async () => {
        while (next < segs.length) {
          const i = next++;
          vectors[i] = await safeEmbed(segs[i].text);
        }
      }),
    );
  }

  // ponytail: delete-then-insert without a multi-statement tx (single-user).
  const { error: dErr } = await db().from("segment").delete().eq("user_id", userId).eq("save_id", saveId);
  if (dErr) sbError(dErr);
  if (!segs.length) return;
  const { error: iErr } = await db().from("segment").insert(
    segs.map((s, i) => ({
      id: randomUUID(),
      user_id: userId,
      save_id: saveId,
      modality: "text",
      loc_kind: "chunk",
      loc_start: s.start,
      loc_end: s.end,
      text: s.text,
      embedding: vectors[i],
    })),
  );
  if (iErr) sbError(iErr);
}

export async function removeSaveIndex(userId: string, saveId: string): Promise<void> {
  const { error } = await db().from("segment").delete().eq("user_id", userId).eq("save_id", saveId);
  if (error) sbError(error);
}

interface SegRow {
  id: string;
  save_id: string;
  modality: string;
  loc_kind: string;
  loc_start: number;
  loc_end: number | null;
  text: string | null;
  title: string;
  rank?: number;
  embedding?: number[] | null;
}

interface Cand {
  row: SegRow;
  rank: number;
  meaning: number;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** "foo bar" -> "foo:* | bar:*" using only safe characters. */
function prefixQuery(q: string): string {
  return queryTerms(q)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((t) => t.length >= 2)
    .map((t) => `${t}:*`)
    .join(" | ");
}

function excerptFor(text: string, query: string): string | null {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  const lower = flat.toLowerCase();
  let pos = -1;
  for (const t of queryTerms(query)) {
    const p = lower.indexOf(t.length > 4 ? t.slice(0, t.length - 1) : t);
    if (p >= 0 && (pos < 0 || p < pos)) pos = p;
  }
  const from = pos > 60 ? pos - 60 : 0;
  const slice = flat.slice(from, from + 200);
  return `${from > 0 ? "…" : ""}${slice}${from + 200 < flat.length ? "…" : ""}`;
}

export async function search(
  userId: string,
  query: string,
  opts?: { kinds?: SaveKind[] },
): Promise<SearchResponse> {
  const q = query.trim();
  let semantic = false;
  if (!q) return { query: q, hits: [], weaker: [], semantic };

  const kinds = opts?.kinds?.length ? opts.kinds : null;
  const idLike = isIdLike(q);
  const cands = new Map<string, Cand>();

  // --- words: full-text OR prefix form, plus title ILIKE for short / ID-like queries ---
  const useIlike = idLike || q.length <= 24;
  const { data: kwRows, error: kwErr } = await db().rpc("search_segments", {
    uid: userId,
    q,
    prefix_q: prefixQuery(q),
    kinds,
    use_ilike: useIlike,
    ilike_pat: `%${escapeLike(q)}%`,
    lim: KEYWORD_ROW_LIMIT,
  });
  if (kwErr) sbError(kwErr);
  for (const r of (kwRows ?? []) as SegRow[]) cands.set(r.id, { row: r, rank: r.rank ?? 0, meaning: 0 });

  // --- meaning: cosine in TypeScript, z-gated per modality ---
  if (isSemanticEnabled()) {
    let qv: number[] | null = null;
    try {
      qv = await embed({ text: q });
    } catch {
      qv = null;
    }
    if (qv) {
      semantic = true;
      const { data: allSegs, error: aErr } = await db()
        .from("segment")
        .select("id, save_id, modality, loc_kind, loc_start, loc_end, text, embedding")
        .eq("user_id", userId)
        .not("embedding", "is", null)
        .limit(KEYWORD_ROW_LIMIT);
      if (aErr) sbError(aErr);

      const saveIds = [...new Set((allSegs ?? []).map((s) => s.save_id))];
      const titleBySave = new Map<string, string>();
      const liveIds = new Set<string>();
      if (saveIds.length) {
        let sq2 = db()
          .from("save")
          .select("id, title, kind")
          .eq("user_id", userId)
          .is("deleted_at", null)
          .in("id", saveIds)
          .limit(saveIds.length);
        if (kinds) sq2 = sq2.in("kind", kinds);
        const { data: saves, error: sErr } = await sq2;
        if (sErr) sbError(sErr);
        for (const s of saves ?? []) {
          liveIds.add(s.id);
          titleBySave.set(s.id, s.title);
        }
      }

      const byModality = new Map<string, { row: SegRow; sim: number }[]>();
      for (const r of allSegs ?? []) {
        if (!liveIds.has(r.save_id) || !r.embedding) continue;
        const row: SegRow = { ...r, title: titleBySave.get(r.save_id) ?? "", embedding: r.embedding };
        const list = byModality.get(r.modality) ?? [];
        list.push({ row, sim: cosine(qv, r.embedding) });
        byModality.set(r.modality, list);
      }
      for (const list of byModality.values()) {
        for (const i of zGate(list.map((x) => x.sim))) {
          const { row, sim } = list[i];
          const meaning = Math.max(0, Math.min(1, sim));
          const ex = cands.get(row.id);
          if (ex) ex.meaning = meaning;
          else cands.set(row.id, { row, rank: 0, meaning });
        }
      }
    }
  }

  // Jev scores a bounded, tenant-filtered set. Keyword matches are included first;
  // recent saves fill the remaining slots so meaning-only results can be found.
  if (process.env.TYPESAFE_API_KEY?.trim()) {
    let recentQ = db()
      .from("save")
      .select("id, title, description, preview_url, tags, extracted_text, created_at, kind")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200);
    if (kinds) recentQ = recentQ.in("kind", kinds);
    const { data: recentSaves, error: rErr } = await recentQ;
    if (rErr) sbError(rErr);

    const recentIds = (recentSaves ?? []).map((s) => s.id);
    const segBySave = new Map<string, SegRow>();
    if (recentIds.length) {
      const { data: segs, error: sErr } = await db()
        .from("segment")
        .select("id, save_id, modality, loc_kind, loc_start, loc_end, text")
        .eq("user_id", userId)
        .in("save_id", recentIds)
        .order("loc_start", { ascending: true })
        .limit(KEYWORD_ROW_LIMIT);
      if (sErr) sbError(sErr);
      for (const seg of segs ?? []) {
        if (!segBySave.has(seg.save_id)) {
          const save = (recentSaves ?? []).find((s) => s.id === seg.save_id)!;
          segBySave.set(seg.save_id, { ...seg, title: save.title });
        }
      }
    }

    const { data: assets, error: aErr } = recentIds.length
      ? await db().from("asset").select("save_id, storage_path, media_type, bytes").eq("user_id", userId).in("save_id", recentIds).limit(recentIds.length)
      : { data: [], error: null };
    if (aErr) sbError(aErr);
    const assetBySave = new Map((assets ?? []).map((a) => [a.save_id, a]));

    type RecentRow = SegRow & {
      storage_path: string | null;
      media_type: string | null;
      bytes: number | null;
      preview_url: string | null;
      tags: string[] | null;
      description: string | null;
      body: string | null;
    };
    const recent: RecentRow[] = [];
    for (const s of recentSaves ?? []) {
      const seg = segBySave.get(s.id);
      if (!seg) continue;
      const a = assetBySave.get(s.id);
      recent.push({
        ...seg,
        title: s.title,
        storage_path: a?.storage_path ?? null,
        media_type: a?.media_type ?? null,
        bytes: a?.bytes ?? null,
        preview_url: s.preview_url,
        tags: s.tags,
        description: s.description,
        body: s.extracted_text ? String(s.extracted_text).slice(0, 2500) : null,
      });
    }

    const bySave = new Map(recent.map((r) => [r.save_id, r]));
    const selected: RecentRow[] = [];
    const seen = new Set<string>();
    const covBySave = new Map<string, number>();
    for (const c of cands.values()) {
      const cov = coverage(q, `${c.row.title} ${c.row.text ?? ""}`);
      if (cov > (covBySave.get(c.row.save_id) ?? -1)) covBySave.set(c.row.save_id, cov);
    }
    for (const [id] of [...covBySave].sort((a, b) => b[1] - a[1])) {
      const r = bySave.get(id);
      if (r && !seen.has(id)) {
        selected.push(r);
        seen.add(id);
      }
    }
    for (const row of recent) {
      if (!seen.has(row.save_id)) {
        selected.push(row);
        seen.add(row.save_id);
      }
    }
    const limited = selected.slice(0, 24);
    const candidates = await Promise.all(
      limited.map(async (r) => {
        const bytes = await loadSaveImage(userId, {
          storagePath: r.storage_path,
          mediaType: r.media_type,
          bytes: r.bytes,
          previewUrl: r.preview_url,
        });
        const text = [r.title, r.tags?.length ? `Visual tags: ${r.tags.join(", ")}` : null, r.description, r.body]
          .filter(Boolean)
          .join("\n");
        const format = bytes ? jevFormat(bytes) : null;
        return { text, image: bytes && format ? { bytes, format } : undefined };
      }),
    );
    const scores = await scoreWithJev(q, candidates);
    if (scores) {
      semantic = true;
      const jev = new Map<string, number>();
      for (let i = 0; i < scores.length; i++) {
        const score = scores[i];
        // ponytail: Jev reranks candidates, so near-even answers still order them; 0.5 was set
        // from a handful of library queries (good matches ~0.7 +- 0.05), not a labelled eval.
        if (score !== null && score >= JEV_MIN) jev.set(limited[i].save_id, score);
      }
      const covered = new Set<string>();
      for (const c of cands.values()) {
        const score = jev.get(c.row.save_id);
        if (score !== undefined) {
          c.meaning = Math.max(c.meaning, score);
          covered.add(c.row.save_id);
        }
      }
      for (const r of limited) {
        const score = jev.get(r.save_id);
        if (score !== undefined && !covered.has(r.save_id)) cands.set(r.id, { row: r, rank: 0, meaning: score });
      }
    }
  }

  // --- combine: best segment per save ---
  const qLower = q.toLowerCase();
  const best = new Map<string, { cand: Cand; cov: number; score: number }>();
  for (const c of cands.values()) {
    const text = c.row.text ?? "";
    let cov = coverage(q, `${c.row.title} ${text}`);
    if (c.row.title.toLowerCase().includes(qLower) || (idLike && text.toLowerCase().includes(qLower))) cov = 1;
    const score = hybridScore(c.meaning, cov, idLike);
    const cur = best.get(c.row.save_id);
    if (!cur || score > cur.score || (score === cur.score && c.rank > cur.cand.rank)) {
      best.set(c.row.save_id, { cand: c, cov, score });
    }
  }
  const ranked = rankHybrid(
    [...best.entries()].map(([id, b]) => ({ id, meaning: b.cand.meaning, coverage: b.cov })),
    q,
  ).slice(0, MAX_RESULTS);
  if (!ranked.length) return { query: q, hits: [], weaker: [], semantic };

  // --- load saves for the final ids ---
  const ids = ranked.map((r) => r.id);
  const { data: saveRows, error: sErr } = await db()
    .from("save")
    .select("id, kind, source_url, title, description, preview_url, status, error, duplicate_of, created_at, tags")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .in("id", ids);
  if (sErr) sbError(sErr);

  const { data: assetRows, error: asErr } = await db()
    .from("asset")
    .select("save_id, media_type, bytes")
    .eq("user_id", userId)
    .in("save_id", ids);
  if (asErr) sbError(asErr);
  const assetBySave = new Map((assetRows ?? []).map((a) => [a.save_id, a]));

  const saves = new Map<string, Save>();
  for (const r of saveRows ?? []) {
    const a = assetBySave.get(r.id);
    saves.set(r.id, {
      id: r.id,
      kind: r.kind as SaveKind,
      sourceUrl: r.source_url,
      title: r.title,
      description: r.description,
      previewUrl: r.preview_url,
      asset: a ? { mediaType: a.media_type, bytes: a.bytes ?? 0 } : null,
      status: r.status as SaveStatus,
      error: r.error,
      duplicateOf: r.duplicate_of,
      tags: r.tags ?? [],
      createdAt: new Date(r.created_at).toISOString(),
    });
  }

  const hits: SearchHit[] = [];
  for (const r of ranked) {
    const save = saves.get(r.id);
    const b = best.get(r.id);
    if (!save || !b) continue;
    const { row, meaning } = b.cand;
    const matchedBy = meaning > 0 && b.cov > 0 ? "both" : meaning > 0 ? "meaning" : "words";
    hits.push({
      save,
      score: r.score,
      matchedBy,
      location: {
        kind: row.loc_kind as "page" | "second" | "chunk",
        start: row.loc_start,
        end: row.loc_end ?? undefined,
      },
      excerpt: excerptFor(row.text ?? "", q),
    });
  }
  const { hits: strong, weaker } = splitWeaker(hits);
  return { query: q, hits: strong, weaker, semantic };
}
