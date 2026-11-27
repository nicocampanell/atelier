import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBoardBrief, combineBriefs, buildDirection } from "./brief.js";
import type { Board, Project, Save } from "./client.js";

const project: Project = { id: "p1", name: "Food", itemCount: 2 };
const board: Board = {
  id: "p1",
  camera: { x: 0, y: 0, zoom: 1 },
  items: [
    { id: "n1", type: "note", saveId: null, text: "Use soft cream cards", x: 0, y: 0, w: 200, h: 100, z: 1 },
    { id: "i1", type: "save", saveId: "s1", text: null, x: 10, y: 20, w: 240, h: 180, z: 2 },
    { id: "i2", type: "save", saveId: "s2", text: null, x: 30, y: 40, w: 240, h: 180, z: 3 },
  ],
};
const saves = new Map<string, Save>([
  [
    "s1",
    {
      id: "s1",
      kind: "image",
      sourceUrl: null,
      title: "Cream plate",
      description: null,
      previewUrl: "https://example/a.jpg",
      asset: null,
      status: "ready",
      error: null,
      duplicateOf: null,
      tags: ["cream", "photograph", "minimal"],
      createdAt: "2026-01-01T00:00:00Z",
    },
  ],
  [
    "s2",
    {
      id: "s2",
      kind: "image",
      sourceUrl: null,
      title: "Red type",
      description: null,
      previewUrl: "https://example/b.jpg",
      asset: null,
      status: "ready",
      error: null,
      duplicateOf: null,
      tags: ["red", "typography", "poster"],
      createdAt: "2026-01-01T00:00:00Z",
    },
  ],
]);

describe("buildBoardBrief", () => {
  it("includes notes, tags, and direction palette", () => {
    const brief = buildBoardBrief(project, board, saves, "full");
    assert.equal(brief.notes.length, 1);
    assert.equal(brief.notes[0]!.text, "Use soft cream cards");
    assert.deepEqual(brief.spec, ["Use soft cream cards"]);
    assert.equal(brief.references.length, 2);
    assert.ok(brief.references.every((r) => Array.isArray(r.tags)));
    assert.ok(brief.direction.palette.includes("cream"));
    assert.ok(brief.direction.palette.includes("red"));
    assert.ok(brief.direction.motifs.includes("typography"));
    assert.ok(brief.direction.tone.includes("minimal"));
  });

  it("direction mode drops note bodies but keeps exemplars", () => {
    const brief = buildBoardBrief(project, board, saves, "direction");
    assert.equal(brief.notes.length, 0);
    assert.equal(brief.spec.length, 0);
    assert.ok(brief.direction.exemplars.length >= 1);
    assert.ok(brief.references.length >= 1);
  });
});

describe("combineBriefs", () => {
  it("prefixes notes with board name and merges tags", () => {
    const a = buildBoardBrief(project, board, saves, "full");
    const b = buildBoardBrief({ id: "p2", name: "Color", itemCount: 0 }, { ...board, id: "p2", items: [] }, new Map(), "full");
    const combined = combineBriefs([a, b], { Color: "palette", Food: "layout" });
    assert.equal(combined.projects.length, 2);
    assert.ok(combined.notes[0]!.text.includes("Food"));
    assert.ok(combined.direction.palette.length >= 1);
  });
});

describe("buildDirection", () => {
  it("ranks tag frequency", () => {
    const d = buildDirection([
      { id: "1", title: "a", kind: "image", tags: ["cream", "cream", "minimal"], description: null, previewUrl: null, sourceUrl: null, x: 0, y: 0, w: 1, h: 1, z: 0 },
    ]);
    // tags listed once per ref in buildDirection — frequency counts per tag occurrence in arrays
    assert.equal(d.tagFrequency[0]!.tag, "cream");
  });
});
