// Visual tags for images: one Jev request asks a fixed set of yes/no questions about the
// picture. Tags make images findable by words ("cream magazine cover, huge red lettering")
// when their titles are only file names.
import { randomUUID } from "node:crypto";
import { jevFormat } from "./image";

/** [tag, yes/no question, extra words indexed for search]. */
const VOCAB: [string, string, string][] = [
  ["cream", "Is cream, beige, ivory or off-white one of the main colors?", "beige ivory off-white tan paper"],
  ["white", "Is white one of the main colors?", ""],
  ["black", "Is black one of the main colors?", "dark"],
  ["red", "Is red one of the main colors?", "scarlet crimson"],
  ["orange", "Is orange one of the main colors?", ""],
  ["yellow", "Is yellow one of the main colors?", "gold"],
  ["green", "Is green one of the main colors?", "olive"],
  ["blue", "Is blue one of the main colors?", "navy"],
  ["pink", "Is pink one of the main colors?", ""],
  ["purple", "Is purple one of the main colors?", "violet"],
  ["brown", "Is brown one of the main colors?", "wood"],
  ["magazine cover", "Is this the cover of a magazine?", "magazine cover issue publication editorial"],
  ["poster", "Is this a poster or flyer?", "poster flyer print"],
  ["album cover", "Is this an album, record or music cover?", "album record vinyl music cover"],
  ["book cover", "Is this the cover of a book?", "book cover"],
  ["big lettering", "Does huge, bold lettering fill a large part of the image?", "huge big large bold giant oversized lettering letters headline type"],
  ["typography", "Is typography or lettering a main element of the design?", "typography type lettering letters text font typeface"],
  ["graphic design", "Is this a piece of graphic design?", "graphic design layout"],
  ["illustration", "Is this a drawing or illustration?", "illustration drawing drawn illustrated"],
  ["photograph", "Is this a photograph?", "photo photography"],
  ["painting", "Is this a painting?", "painted art"],
  ["collage", "Is this a collage?", ""],
  ["screenshot", "Is this a screenshot of a website, app or interface?", "website app ui interface web screen"],
  ["logo", "Is this a logo or brand mark?", "brand branding"],
  ["pattern", "Is this a repeating pattern or texture?", "texture"],
  ["film still", "Is this a still from a film?", "movie film cinema scene"],
  ["people", "Are there people in the image?", "person portrait face"],
  ["animal", "Is there an animal in the image?", ""],
  ["flowers", "Are there flowers or plants in the image?", "flower plant botanical floral"],
  ["interior", "Is this an interior or room?", "room furniture home"],
  ["architecture", "Is a building or architecture the main subject?", "building"],
  ["landscape", "Is this an outdoor landscape or nature scene?", "nature outdoors"],
  ["product", "Is this a product shot?", "object"],
  ["vintage", "Does this look vintage or retro?", "retro old classic"],
  ["minimal", "Is the design minimal, with lots of empty space?", "minimalist simple clean"],
  ["abstract", "Is this abstract?", ""],
  ["3d", "Is this a 3D render?", "render rendered"],
  ["japanese", "Does the image contain Japanese or Chinese characters?", "asian"],
];
const BY_TAG = new Map(VOCAB.map(([tag, , words]) => [tag, words]));
/** Jev's suggested "yes" threshold. ponytail: not tuned on a labelled set; revisit with real misses. */
const YES = 0.7;

/** Tags for an image within Jev limits, or null when format unsupported / Jev unavailable. */
export async function visualTags(image: Uint8Array): Promise<string[] | null> {
  const key = process.env.TYPESAFE_API_KEY?.trim();
  const format = jevFormat(image);
  if (!key || !format) return null;
  const ref = randomUUID();
  try {
    const res = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "TypeSafe-Danger-Zone-Images": "true" },
      body: JSON.stringify({
        model: process.env.TYPESAFE_MODEL?.trim() || "jev-latest",
        state: { image: ref },
        assets: { [ref]: { type: "image", format, data_base64: Buffer.from(image).toString("base64") } },
        questions: Object.fromEntries(VOCAB.map(([, q], i) => [`t${i}`, { type: "noul", instructions: `About the image: ${q}` }])),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const answers = ((await res.json()) as { answers?: Record<string, { noul?: unknown }> }).answers ?? {};
    return VOCAB.filter((_, i) => {
      const n = answers[`t${i}`]?.noul;
      return typeof n === "number" && n >= YES;
    }).map(([tag]) => tag);
  } catch {
    return null;
  }
}

/** Searchable text for a save's tags: the tags plus their synonyms. */
export function tagSearchText(tags: readonly string[]): string {
  return tags.map((t) => `${t} ${BY_TAG.get(t) ?? ""}`.trim()).join(", ");
}
