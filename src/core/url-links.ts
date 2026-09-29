import type { Text } from "@codemirror/state";

const RE_URL = /^(https?|obsidian):\/\/\S+$/i;

export const RE_HTTP_URL = /^https?:\/\/\S+$/i;

/** Match delimiter runs, rather than counting individual backticks. Runs
 * may contain shorter runs, escaped closing ticks, and single newlines. */
function inlineCodeRanges(text: string): { from: number; to: number }[] {
  const runs = Array.from(text.matchAll(/`+/g));
  const ranges: { from: number; to: number }[] = [];
  for (let i = 0; i < runs.length; i++) {
    const open = runs[i];
    let escapes = 0;
    for (let n = open.index! - 1; n >= 0 && text[n] === "\\"; n--) escapes++;
    if (escapes % 2) continue;
    const close = runs.findIndex((run, j) => j > i && run[0].length === open[0].length);
    if (close < 0) continue;
    ranges.push({ from: open.index!, to: runs[close].index! + runs[close][0].length });
    i = close;
  }
  return ranges;
}

/** Shared by selected-text linking, title fetching, and column editors. */
export function urlPasteContextAllowed(
  doc: Text, from: number, to: number,
  fences: readonly { startLine: number; endLine: number }[]
): boolean {
  if (from < 0 || to < from || to > doc.length) return false;
  const first = doc.lineAt(from);
  const last = doc.lineAt(to);
  if (fences.some((fence) => first.number <= fence.endLine && last.number >= fence.startLine)) return false;
  let start = first.number;
  let end = last.number;
  while (start > 1 && doc.line(start - 1).text.trim()) start--;
  while (end < doc.lines && doc.line(end + 1).text.trim()) end++;
  const offset = doc.line(start).from;
  const text = doc.sliceString(offset, doc.line(end).to);
  for (const range of inlineCodeRanges(text)) {
    const a = offset + range.from, b = offset + range.to;
    if (from === to ? from > a && from < b : from < b && to > a) return false;
  }
  // A URL pasted into a link destination is already a link.
  return !/\]\([^)\s]*$/.test(first.text.slice(0, from - first.from));
}

const NAMED_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  amp: "&",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  bull: "•",
};

/** Minimal HTML entity decoding plus whitespace normalization. A single
 * pass, so no decoded output ("&#38;lt;" → "&lt;") is ever re-decoded. */
function decodeHtmlText(text: string): string {
  return text
    .replace(
      /&(?:#(\d+)|#x([0-9a-f]+)|(\w{1,8}));/gi,
      (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
        if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
        const code = dec ? Number(dec) : parseInt(hex!, 16);
        return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Best-effort page title of an HTML document, entity-decoded, or null.
 * SPA pages (Next.js and friends) often ship an EMPTY <title> and set the
 * real one from JavaScript — fall back to Open Graph / Twitter metadata,
 * which such pages do render server-side. */
export function extractHtmlTitle(html: string): string | null {
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  const decodedTitle = title ? decodeHtmlText(title) : "";
  if (decodedTitle) return decodedTitle;
  const meta = html.match(
    /<meta[^>]*(?:property|name)=["'](?:og:title|twitter:title)["'][^>]*>/i
  )?.[0];
  const content = meta?.match(/content=["']([^"']*)["']/i)?.[1];
  const decodedMeta = content ? decodeHtmlText(content) : "";
  return decodedMeta || null;
}

/** Markdown link for a fetched page title: whitespace-collapsed,
 *  bracket-escaped, and length-capped. Null when the title is empty. */
export function buildTitledLink(url: string, title: string): string | null {
  const clean = title.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const capped =
    clean.length > 160 ? clean.slice(0, 159).trimEnd() + "…" : clean;
  // Backslash included: a trailing "\" would otherwise escape the "]".
  const safe = capped.replace(/([\\[\]])/g, "\\$1");
  return `[${safe}](${url})`;
}

/** Returns the replacement text when pasting `clip` over `selection`,
 *  or null when the paste should proceed normally. */
export function buildPasteLink(selection: string, clip: string): string | null {
  const url = clip.trim();
  if (!RE_URL.test(url)) return null;
  const sel = selection.trim();
  if (!sel) return null;
  if (RE_URL.test(sel)) return null; // don't wrap a URL in a URL
  if (sel.includes("\n")) return null; // keep multi-line pastes literal
  return `[${selection}](${url})`;
}
