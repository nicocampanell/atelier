/** Fixed visual vocabulary (mirrors lib/search/tags.ts). [tag, synonyms]. */
export const VISUAL_TAGS: [string, string][] = [
  ["cream", "beige ivory off-white tan paper"],
  ["white", ""],
  ["black", "dark"],
  ["red", "scarlet crimson"],
  ["orange", ""],
  ["yellow", "gold"],
  ["green", "olive"],
  ["blue", "navy"],
  ["pink", ""],
  ["purple", "violet"],
  ["brown", "wood"],
  ["magazine cover", "magazine cover issue publication editorial"],
  ["poster", "poster flyer print"],
  ["album cover", "album record vinyl music cover"],
  ["book cover", "book cover"],
  ["big lettering", "huge big large bold giant oversized lettering letters headline type"],
  ["typography", "typography type lettering letters text font typeface"],
  ["graphic design", "graphic design layout"],
  ["illustration", "illustration drawing drawn illustrated"],
  ["photograph", "photo photography"],
  ["painting", "painted art"],
  ["collage", ""],
  ["screenshot", "website app ui interface web screen"],
  ["logo", "brand branding"],
  ["pattern", "texture"],
  ["film still", "movie film cinema scene"],
  ["people", "person portrait face"],
  ["animal", ""],
  ["flowers", "flower plant botanical floral"],
  ["interior", "room furniture home"],
  ["architecture", "building"],
  ["landscape", "nature outdoors"],
  ["product", "object"],
  ["vintage", "retro old classic"],
  ["minimal", "minimalist simple clean"],
  ["abstract", ""],
  ["3d", "render rendered"],
  ["japanese", "asian"],
];

export const COLOR_TAGS = new Set([
  "cream",
  "white",
  "black",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "pink",
  "purple",
  "brown",
]);

export const TONE_TAGS = new Set(["vintage", "minimal", "abstract"]);

export function listVisualTags() {
  return VISUAL_TAGS.map(([tag, synonyms]) => ({
    tag,
    synonyms: synonyms
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean),
  }));
}
