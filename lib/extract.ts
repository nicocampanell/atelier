// Small, dependency-free HTML metadata and text extraction.
export const MAX_TEXT_CHARS = 200_000;

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–",
  hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©",
  middot: "·", bull: "•", laquo: "«", raquo: "»",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return " ";
      try {
        return String.fromCodePoint(code);
      } catch {
        return " ";
      }
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const collapse = (s: string) => decodeEntities(s).replace(/\s+/g, " ").trim();

export function decodeBody(body: Buffer, contentType: string): string {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (!charset) {
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(body.subarray(0, 4096).toString("latin1"))?.[1];
  }
  try {
    return new TextDecoder(charset ?? "utf-8").decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

export interface HtmlInfo {
  title: string | null;
  description: string | null;
  image: string | null;
  text: string;
}

function metaMap(html: string): Map<string, string> {
  const map = new Map<string, string>();
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const attrs: Record<string, string> = {};
    for (const m of tag.matchAll(/([a-zA-Z_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
    }
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (key && attrs.content !== undefined && !map.has(key)) map.set(key, collapse(attrs.content));
  }
  return map;
}

export function extractHtml(html: string, baseUrl: string): HtmlInfo {
  const meta = metaMap(html);
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1];
  const title = (titleTag ? collapse(titleTag) : "") || meta.get("og:title") || null;
  const description = meta.get("og:description") || meta.get("description") || null;

  let image: string | null = null;
  const rawImage = meta.get("og:image") || meta.get("twitter:image");
  if (rawImage) {
    try {
      const u = new URL(rawImage, baseUrl);
      if (u.protocol === "http:" || u.protocol === "https:") image = u.toString();
    } catch {
      image = null;
    }
  }

  let h = html.replace(/<!--[\s\S]*?-->/g, " ");
  h = h.replace(/<(script|style|noscript|template|svg|head|iframe)\b[\s\S]*?<\/\1\s*>/gi, " ");
  h = h.replace(/<\/?(p|div|br|li|tr|h[1-6]|section|article|header|footer|ul|ol|table|blockquote|pre)\b[^>]*>/gi, "\n");
  h = h.replace(/<[^>]*>/g, " ");
  h = decodeEntities(h)
    .replace(/[ \t\f\v\r ]+/g, " ")
    .replace(/ ?\n[ \n]*/g, "\n")
    .trim();
  return {
    title: title ? title.slice(0, 300) : null,
    description: description ? description.slice(0, 1000) : null,
    image,
    text: h.slice(0, MAX_TEXT_CHARS),
  };
}
