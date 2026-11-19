// Hybrid search: Postgres full-text (words) + cosine over stored embeddings (meaning),
// combined per save. All queries are scoped by user_id and skip deleted saves.
import { randomUUID } from "node:crypto";
import { scoreWithJev } from "./jev";
import { loadSaveImage } from "./image";
import { tagSearchText } from "./tags";
import { getDb } from "../db";
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

function vecLiteral(v: number[] | null): string | null {
  return v && v.length && v.every(Number.isFinite) ? `{${v.join(",")}}` : null;
}

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

  const vectors: (string | null)[] = new Array(segs.length).fill(null);
  if (isSemanticEnabled()) {
    const CONC = 4;
    let next = 0;
    await Promise.all(
      Array.from({ length: CONC }, async () => {
        while (next < segs.length) {
          const i = next++;
          vectors[i] = vecLiteral(await safeEmbed(segs[i].text));
        }
      }),
    );
  }

  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.query(`delete from segment where user_id = $1 and save_id = $2`, [userId, saveId]);
    for (let i = 0; i < segs.length; i++) {
      await tx.query(
        `insert into segment (id, user_id, save_id, modality, loc_kind, loc_start, loc_end, text, embedding)
         values ($1,$2,$3,'text','chunk',$4,$5,$6,$7::real[])`,
        [randomUUID(), userId, saveId, segs[i].start, segs[i].end, segs[i].text, vectors[i]],
      );
    }
  });
}

export async function removeSaveIndex(userId: string, saveId: string): Promise<void> {
  const db = await getDb();
  await db.query(`delete from segment where user_id = $1 and save_id = $2`, [userId, saveId]);
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

  const db = await getDb();
  const kinds = opts?.kinds?.length ? opts.kinds : null;
  const idLike = isIdLike(q);
  const cands = new Map<string, Cand>();

  // --- words: full-text OR prefix form, plus title ILIKE for short / ID-like queries ---
  const useIlike = idLike || q.length <= 24;
  const rows = await db.query<SegRow>(
    `with qq as (
       select websearch_to_tsquery('english', $2) || to_tsquery('english', $3) as tq
     )
     select seg.id, seg.save_id, seg.modality, seg.loc_kind, seg.loc_start, seg.loc_end, seg.text, s.title,
            ts_rank(seg.tsv, qq.tq)::float8 as rank
     from segment seg
     join save s on s.id = seg.save_id and s.user_id = $1 and s.deleted_at is null
     cross join qq
     where seg.user_id = $1
       and ($4::text[] is null or s.kind = any($4::text[]))
       and (seg.tsv @@ qq.tq or ($5::boolean and s.title ilike $6 escape '\\'))
     order by rank desc
     limit ${KEYWORD_ROW_LIMIT}`,
    [userId, q, prefixQuery(q), kinds, useIlike, `%${escapeLike(q)}%`],
  );
  for (const r of rows.rows) cands.set(r.id, { row: r, rank: r.rank ?? 0, meaning: 0 });

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
      const all = await db.query<SegRow>(
        `select seg.id, seg.save_id, seg.modality, seg.loc_kind, seg.loc_start, seg.loc_end, seg.text, s.title, seg.embedding
         from segment seg
         join save s on s.id = seg.save_id and s.user_id = $1 and s.deleted_at is null
         where seg.user_id = $1 and seg.embedding is not null
           and ($2::text[] is null or s.kind = any($2::text[]))`,
        [userId, kinds],
      );
      const byModality = new Map<string, { row: SegRow; sim: number }[]>();
      for (const r of all.rows) {
        if (!r.embedding) continue;
        const list = byModality.get(r.modality) ?? [];
        list.push({ row: r, sim: cosine(qv, r.embedding) });
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
    const recent = await db.query<SegRow & {
      storage_path: string | null; media_type: string | null; bytes: number | null; preview_url: string | null;
      tags: string[] | null; description: string | null; body: string | null;
    }>(
      `select * from (select distinct on (s.id) seg.id, seg.save_id, seg.modality, seg.loc_kind, seg.loc_start, seg.loc_end, seg.text, s.title,
              a.storage_path, a.media_type, a.bytes, s.preview_url, s.tags, s.description, left(s.extracted_text, 2500) as body, s.created_at
       from save s join segment seg on seg.save_id = s.id and seg.user_id = s.user_id
       left join asset a on a.save_id = s.id and a.user_id = s.user_id
       where s.user_id = $1 and s.deleted_at is null and ($2::text[] is null or s.kind = any($2::text[]))
       order by s.id, seg.loc_start) candidates order by created_at desc limit 200`, [userId, kinds]);
    const bySave = new Map(recent.rows.map((r) => [r.save_id, r]));
    const selected: typeof recent.rows = [];
    const seen = new Set<string>();
    // Best word coverage first, so the strongest keyword matches always get a Jev score.
    const covBySave = new Map<string, number>();
    for (const c of cands.values()) {
      const cov = coverage(q, `${c.row.title} ${c.row.text ?? ""}`);
      if (cov > (covBySave.get(c.row.save_id) ?? -1)) covBySave.set(c.row.save_id, cov);
    }
    for (const [id] of [...covBySave].sort((a, b) => b[1] - a[1])) { const r = bySave.get(id); if (r && !seen.has(id)) { selected.push(r); seen.add(id); } }
    for (const row of recent.rows) if (!seen.has(row.save_id)) { selected.push(row); seen.add(row.save_id); }
    const limited = selected.slice(0, 24);
    const candidates = await Promise.all(limited.map(async (r) => {
      // Without an image, Jev scores the available text.
      const bytes = await loadSaveImage({ storagePath: r.storage_path, mediaType: r.media_type, bytes: r.bytes, previewUrl: r.preview_url });
      // Plain fields, not the synonym-padded index text: padding inflates every score alike.
      const text = [r.title, r.tags?.length ? `Visual tags: ${r.tags.join(", ")}` : null, r.description, r.body].filter(Boolean).join("\n");
      return { text, image: bytes ? { bytes, format: "jpg" as const } : undefined };
    }));
    const scores = await scoreWithJev(q, candidates);
    if (scores) {
      semantic = true;
      // Jev judges the whole save, so its score applies to every segment of that save
      // (otherwise it lands on one segment and never combines with another segment's words).
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
        if (score !== undefined) { c.meaning = Math.max(c.meaning, score); covered.add(c.row.save_id); }
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
  const saveRows = await db.query<{
    id: string; kind: string; source_url: string | null; title: string; description: string | null;
    preview_url: string | null; status: string; error: string | null; duplicate_of: string | null;
    created_at: Date | string; media_type: string | null; bytes: number | null; tags: string[] | null;
  }>(
    `select s.id, s.kind, s.source_url, s.title, s.description, s.preview_url, s.status, s.error,
            s.duplicate_of, s.created_at, a.media_type, a.bytes, s.tags
     from save s left join asset a on a.save_id = s.id and a.user_id = s.user_id
     where s.user_id = $1 and s.deleted_at is null and s.id = any($2::text[])`,
    [userId, ids],
  );
  const saves = new Map<string, Save>();
  for (const r of saveRows.rows) {
    saves.set(r.id, {
      id: r.id,
      kind: r.kind as SaveKind,
      sourceUrl: r.source_url,
      title: r.title,
      description: r.description,
      previewUrl: r.preview_url,
      asset: r.media_type ? { mediaType: r.media_type, bytes: r.bytes ?? 0 } : null,
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
