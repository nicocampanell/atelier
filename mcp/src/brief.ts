import type { Board, BoardItem, Project, Save } from "./client.js";
import { COLOR_TAGS, TONE_TAGS } from "./tags.js";

export type BriefMode = "direction" | "implement" | "full";

export interface BriefNote {
  id: string;
  text: string;
  x: number;
  y: number;
  z: number;
  board?: string;
}

export interface BriefReference {
  id: string;
  title: string;
  kind: string;
  tags: string[];
  description: string | null;
  previewUrl: string | null;
  sourceUrl: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  board?: string;
}

export interface DirectionSummary {
  palette: string[];
  motifs: string[];
  tone: string[];
  tagFrequency: { tag: string; count: number }[];
  exemplars: { id: string; title: string; previewUrl: string | null; tags: string[] }[];
}

export interface BoardBrief {
  project: { id: string; name: string };
  mode: BriefMode;
  notes: BriefNote[];
  references: BriefReference[];
  direction: DirectionSummary;
  /** Notes as author requirements (for implement / full). */
  spec: string[];
  guidance: string;
}

const byZThenPos = (a: BoardItem, b: BoardItem) => a.z - b.z || a.y - b.y || a.x - b.x;

export function buildDirection(refs: BriefReference[]): DirectionSummary {
  const freq = new Map<string, number>();
  for (const r of refs) for (const t of r.tags) freq.set(t, (freq.get(t) ?? 0) + 1);
  const tagFrequency = [...freq.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  const palette = tagFrequency.filter((t) => COLOR_TAGS.has(t.tag)).map((t) => t.tag);
  const tone = tagFrequency.filter((t) => TONE_TAGS.has(t.tag)).map((t) => t.tag);
  const motifs = tagFrequency.filter((t) => !COLOR_TAGS.has(t.tag) && !TONE_TAGS.has(t.tag)).map((t) => t.tag);
  const scored = refs
    .map((r) => ({
      r,
      score: r.tags.length * 2 + (r.previewUrl ? 1 : 0) + (r.description ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.r.title.localeCompare(b.r.title));
  const exemplars = scored.slice(0, 8).map(({ r }) => ({
    id: r.id,
    title: r.title,
    previewUrl: r.previewUrl,
    tags: r.tags,
  }));
  return { palette, motifs, tone, tagFrequency, exemplars };
}

export function guidanceFor(mode: BriefMode): string {
  if (mode === "direction") {
    return "Apply visual direction only (tokens, type, color, density, motion). Cite exemplar save ids. Do not invent product features.";
  }
  if (mode === "implement") {
    return "Treat spec notes as requirements. Treat images + tags as comps / visual law. Cite save ids when matching look.";
  }
  return "Use direction for look and spec notes for features. Cite save ids. Prefer board evidence over invention.";
}

export function buildBoardBrief(
  project: Project,
  board: Board,
  saves: Map<string, Save>,
  mode: BriefMode = "full",
): BoardBrief {
  const ordered = [...board.items].sort(byZThenPos);
  const notes: BriefNote[] = [];
  const references: BriefReference[] = [];
  for (const item of ordered) {
    if (item.type === "note") {
      const text = (item.text ?? "").trim();
      if (!text) continue;
      notes.push({ id: item.id, text, x: item.x, y: item.y, z: item.z });
      continue;
    }
    if (!item.saveId) continue;
    const save = saves.get(item.saveId);
    if (!save) continue;
    references.push({
      id: save.id,
      title: save.title,
      kind: save.kind,
      tags: save.tags ?? [],
      description: save.description,
      previewUrl: save.previewUrl,
      sourceUrl: save.sourceUrl,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      z: item.z,
    });
  }
  const direction = buildDirection(references);
  const spec = notes.map((n) => n.text);
  const brief: BoardBrief = {
    project: { id: project.id, name: project.name },
    mode,
    notes: mode === "direction" ? [] : notes,
    references: mode === "implement" && references.length > 24 ? references.slice(0, 24) : references,
    direction,
    spec: mode === "direction" ? [] : spec,
    guidance: guidanceFor(mode),
  };
  if (mode === "direction") {
    // Keep exemplars via direction; still expose a short reference list for comps
    brief.references = references.filter((r) => direction.exemplars.some((e) => e.id === r.id));
  }
  return brief;
}

export function combineBriefs(
  briefs: BoardBrief[],
  roles?: Record<string, string>,
  mode: BriefMode = "full",
): Omit<BoardBrief, "project"> & { projects: { id: string; name: string; role?: string }[] } {
  const projects = briefs.map((b) => ({
    id: b.project.id,
    name: b.project.name,
    role: roles?.[b.project.name] ?? roles?.[b.project.id],
  }));
  const notes: BriefNote[] = [];
  const references: BriefReference[] = [];
  for (const b of briefs) {
    const role = roles?.[b.project.name] ?? roles?.[b.project.id];
    const prefix = role ? `[${b.project.name} · ${role}] ` : `[${b.project.name}] `;
    for (const n of b.notes) notes.push({ ...n, text: prefix + n.text, board: b.project.name });
    for (const r of b.references) references.push({ ...r, board: b.project.name });
  }
  // Role weighting: if a board is "palette", boost its color tags in direction by duplicating color-tagged refs in sort key via tagFrequency rebuild
  let directionRefs = references;
  if (roles && Object.keys(roles).length) {
    const weighted: BriefReference[] = [];
    for (const r of references) {
      const role = (r.board && roles[r.board]) || "";
      weighted.push(r);
      if (/palette|color/i.test(role)) {
        const colors = r.tags.filter((t) => COLOR_TAGS.has(t));
        if (colors.length) weighted.push({ ...r, tags: [...r.tags, ...colors, ...colors] });
      }
    }
    directionRefs = weighted;
  }
  return {
    projects,
    mode,
    notes: mode === "direction" ? [] : notes,
    references: mode === "direction" ? buildDirection(directionRefs).exemplars.map((e) => references.find((r) => r.id === e.id)!).filter(Boolean) : references,
    direction: buildDirection(directionRefs),
    spec: mode === "direction" ? [] : notes.map((n) => n.text),
    guidance: guidanceFor(mode) + " Combined from multiple boards; honor roles when present.",
  };
}
