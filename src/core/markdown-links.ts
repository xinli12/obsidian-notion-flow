/** An inline Markdown link `[text](dest)` found in one line of text. All
 * offsets are columns into that line; `end` is exclusive. */
export interface MarkdownLink {
  start: number;
  end: number;
  text: string;
  dest: string;
  textStart: number;
  textEnd: number;
  destStart: number;
  destEnd: number;
  /** A CommonMark title written after the destination (`"…"`, `'…'` or
   * `(…)`), delimiters included; absent when the link has none. */
  title?: string;
}

/** A destination followed by a title: `dest "title"`, `dest 'title'`,
 * `dest (title)` or `<dest with spaces> "title"`. */
const RE_DEST_TITLE = /^(<[^>]*>|\S+)\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\([^()]*\))$/;

/** Whether the character at `pos` is escaped by an odd run of backslashes. */
function escapedAt(line: string, pos: number): boolean {
  let slashes = 0;
  for (let i = pos - 1; i >= 0 && line[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}

/**
 * The inline code spans of a line, backticks included (`to` exclusive),
 * as CommonMark reads them: a backtick run opens a span closed by the next
 * run of the same length, a run with no such closer is literal text, and a
 * backtick escaped by `\` is literal (inside a span nothing is escaped).
 * Link syntax inside a span is code, never a link.
 */
export function codeSpanRanges(line: string): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      i++;
      continue;
    }
    let run = 0;
    while (line[i + run] === "`") run++;
    let start = i;
    if (escapedAt(line, i)) {
      start++;
      run--;
    }
    if (run === 0) {
      i = start;
      continue;
    }
    let close = -1;
    for (let j = start + run; j < line.length; ) {
      if (line[j] !== "`") {
        j++;
        continue;
      }
      let len = 0;
      while (line[j + len] === "`") len++;
      if (len === run) {
        close = j;
        break;
      }
      j += len;
    }
    if (close === -1) {
      i = start + run;
      continue;
    }
    spans.push({ from: start, to: close + run });
    i = close + run;
  }
  return spans;
}

/** Whether column `pos` lies inside one of `spans`. */
function inCodeSpan(spans: readonly { from: number; to: number }[], pos: number): boolean {
  return spans.some((span) => pos >= span.from && pos < span.to);
}

/** The column of the `]` closing the link text opened at `open`, or -1.
 * Brackets nest (`[see [ref]](url)`) and `\` escapes the next character. */
function closingBracket(line: string, open: number): number {
  let depth = 1;
  for (let i = open + 1; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\") i++;
    else if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) return i;
  }
  return -1;
}

/** The column of the `)` closing the destination that starts at `from`,
 * or -1. Parentheses nest (`Note%20(1).md`), `\` escapes the next
 * character, and a `<…>` destination is taken whole, so `<foo (1).md>`
 * is never split at its paren. */
function closingParen(line: string, from: number): number {
  let i = from;
  if (line[i] === "<") {
    const gt = line.indexOf(">", i + 1);
    if (gt !== -1) i = gt + 1;
  }
  let depth = 0;
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\") i++;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

/** The inline link whose text opens with the `[` at column `start`, or
 * null. Images (`![…](…)`) and wikilink-shaped text (`[[…`) are not links
 * the popover should edit and give null. */
function markdownLinkAt(lineText: string, start: number): MarkdownLink | null {
  const before = lineText[start - 1];
  if (before === "!" || before === "[" || lineText[start + 1] === "[") return null;
  // "\[a](b)" is a literal bracket, not a link.
  if (escapedAt(lineText, start)) return null;
  const textEnd = closingBracket(lineText, start);
  if (textEnd === -1 || lineText[textEnd + 1] !== "(") return null;
  const destStart = textEnd + 2;
  const close = closingParen(lineText, destStart);
  if (close === -1) return null;
  const link: MarkdownLink = {
    start,
    end: close + 1,
    text: lineText.slice(start + 1, textEnd),
    dest: lineText.slice(destStart, close),
    textStart: start + 1,
    textEnd,
    destStart,
    destEnd: close,
  };
  const titled = RE_DEST_TITLE.exec(link.dest);
  if (titled) {
    link.dest = titled[1];
    link.destEnd = destStart + titled[1].length;
    link.title = titled[2];
  }
  return link;
}

/** The smallest inline link containing the columns `from..to` of
 * `lineText`, or null. Images (`![…](…)`) and wikilink-shaped text
 * (`[[…`) are not links the popover should edit and are skipped, and so is
 * link syntax inside a code span. */
export function enclosingMarkdownLink(
  lineText: string,
  from: number,
  to: number
): MarkdownLink | null {
  let best: MarkdownLink | null = null;
  const code = codeSpanRanges(lineText);
  for (let start = lineText.indexOf("["); start !== -1; start = lineText.indexOf("[", start + 1)) {
    if (inCodeSpan(code, start)) continue;
    const link = markdownLinkAt(lineText, start);
    if (!link || link.start > from || link.end < to) continue;
    if (best && link.end - link.start >= best.end - best.start) continue;
    best = link;
  }
  return best;
}

/** Every inline Markdown link on the line, left to right. A link found
 * owns its span: a `[` inside it starts no second one (link text cannot
 * hold a link). Images, wikilink-shaped text and link syntax inside a code
 * span are skipped, as in enclosingMarkdownLink. */
export function markdownLinksOnLine(lineText: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  const code = codeSpanRanges(lineText);
  for (let start = lineText.indexOf("["); start !== -1; start = lineText.indexOf("[", start + 1)) {
    if (inCodeSpan(code, start)) continue;
    const link = markdownLinkAt(lineText, start);
    if (!link) continue;
    links.push(link);
    start = link.end - 1;
  }
  return links;
}

/** A destination the link syntax can carry: non-empty, and either free of
 * whitespace or wrapped in `<…>` (CommonMark's form for such paths). */
export function isValidLinkDest(dest: string): boolean {
  const d = dest.trim();
  if (!d) return false;
  return !/\s/.test(d) || (d.startsWith("<") && d.endsWith(">"));
}

/** Trim a typed destination and wrap it in `<…>` when it contains
 * whitespace, so "my note.md" still round-trips as a valid link. */
export function normalizeLinkDest(dest: string): string {
  const d = dest.trim();
  if (!d || !/\s/.test(d) || (d.startsWith("<") && d.endsWith(">"))) return d;
  return `<${d}>`;
}

/** `line` with `link` replaced by `[text](dest)`; a title the link had
 * stays after the destination. */
export function rewriteMarkdownLink(
  line: string,
  link: MarkdownLink,
  next: { text: string; dest: string }
): string {
  const title = link.title ? ` ${link.title}` : "";
  return (
    line.slice(0, link.start) +
    `[${next.text}](${normalizeLinkDest(next.dest)}${title})` +
    line.slice(link.end)
  );
}

/** `line` with `link` reduced to its plain text. */
export function unlinkMarkdownLink(line: string, link: MarkdownLink): string {
  return line.slice(0, link.start) + link.text + line.slice(link.end);
}

/* ---- wikilinks ---- */

/** A `[[wikilink]]` (or `![[embed]]`) found in one line of text. All
 * offsets are columns into that line. */
export interface WikiLink {
  /** Column of the first `[` (of the `!` for an embed); `end` is exclusive, after `]]`. */
  start: number;
  end: number;
  /** Everything before the alias separator, subpath included:
   *  `Note`, `folder/Note`, `Note#Heading`, `Note#^block`, `#Local heading`. */
  target: string;
  targetStart: number;
  targetEnd: number;
  /** Text after the first separator; null when there is none ("" for `[[t|]]`). */
  alias: string | null;
  /** Written `[[t\|a]]` (a wikilink inside a table row): rewrites keep `\|`. */
  escapedPipe: boolean;
  /** `![[…]]`: an embed, which the link card never edits. */
  embed: boolean;
}

/** A URL or other scheme (`https:`, `mailto:`, `obsidian:`), which a
 * wikilink cannot point to. */
const RE_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Every wikilink and embed on the line, in order. A `[[` owns the first
 * `]]` after it unless a later `[[` comes first (`[[a [[b]]` holds only
 * `[[b]]`); an empty `[[]]` is no link, and an unclosed `[[` ends the
 * scan. A `[[` inside a code span, or escaped (`\[[`), is text. */
export function wikiLinksOnLine(lineText: string): WikiLink[] {
  const links: WikiLink[] = [];
  const code = codeSpanRanges(lineText);
  let open = lineText.indexOf("[[");
  while (open !== -1) {
    const close = lineText.indexOf("]]", open + 2);
    if (close === -1) break;
    const later = lineText.indexOf("[[", open + 1);
    if (later !== -1 && later < close) {
      open = later;
      continue;
    }
    const inner = lineText.slice(open + 2, close);
    if (inner.trim() && !inCodeSpan(code, open) && !escapedAt(lineText, open)) {
      const embed = lineText[open - 1] === "!";
      const bar = inner.indexOf("|");
      const escapedPipe = bar > 0 && inner[bar - 1] === "\\";
      const targetLength = bar === -1 ? inner.length : escapedPipe ? bar - 1 : bar;
      links.push({
        start: embed ? open - 1 : open,
        end: close + 2,
        target: inner.slice(0, targetLength),
        targetStart: open + 2,
        targetEnd: open + 2 + targetLength,
        alias: bar === -1 ? null : inner.slice(bar + 1),
        escapedPipe,
        embed,
      });
    }
    open = lineText.indexOf("[[", close + 2);
  }
  return links;
}

/** The wikilink containing the columns `from..to` of `lineText`, or null.
 * As with Markdown links, the caret on the first `[` or right after `]]`
 * counts as inside. Embeds are not links the card edits, and a range
 * reaching outside one link (or across two) finds none. */
export function enclosingWikiLink(lineText: string, from: number, to = from): WikiLink | null {
  for (const link of wikiLinksOnLine(lineText)) {
    if (!link.embed && link.start <= from && to <= link.end) return link;
  }
  return null;
}

/** What Obsidian shows for the link, and what Unlink leaves: the alias,
 * or the target with its subpath as `Note > Heading`. */
export function wikiLinkDisplay(link: WikiLink): string {
  if (link.alias?.trim()) return link.alias;
  const hash = link.target.indexOf("#");
  if (hash === -1) return link.target;
  const path = link.target.slice(0, hash);
  const sub = link.target.slice(hash + 1);
  return path && sub ? `${path} > ${sub}` : path || sub;
}

/** The link card's fields for a wikilink: its visible text and target. */
export function wikiLinkFields(link: WikiLink): { text: string; dest: string } {
  return { text: link.alias?.trim() ? link.alias : link.target, dest: link.target };
}

/** A destination as typed, without the `<…>` the link card wraps around
 * paths with spaces (a wikilink target never carries them). */
export function unwrapLinkDest(dest: string): string {
  const d = dest.trim();
  return d.length >= 2 && d.startsWith("<") && d.endsWith(">") ? d.slice(1, -1) : d;
}

/** Whether `[[dest|text]]` can carry this link: a non-empty note target
 * (no URL or scheme, no `[`, `]`, `|` or line break) and a label without
 * `[[`, `]]` or line breaks that does not end in `]` — `[[n|a]]]` closes
 * at the first `]]` and leaves the label's bracket outside the link. */
export function canWriteWikiLink(text: string, dest: string): boolean {
  const target = unwrapLinkDest(dest).trim();
  if (!target || /[[\]|\r\n]/.test(target) || RE_SCHEME.test(target)) return false;
  return !/\[\[|\]\]|[\r\n]/.test(text) && !/\]$/.test(text.trim());
}

/** A table row separates cells with `|`, so a wikilink inside one writes
 * every pipe of its label escaped. */
function escapePipes(label: string, escaped: boolean): string {
  return escaped ? label.replace(/\\?\|/g, "\\|") : label;
}

/** Where a rewritten link lands. `inTable`: the line is a Markdown table
 * row (Source mode, or the outer editor over a table), so every `|` the
 * link writes is escaped — a bare `[[t]]` there had none to keep. A Live
 * Preview cell editor holds the cell's un-escaped text and needs nothing:
 * Obsidian re-escapes it when the cell is written back. */
export interface LinkWriteOptions {
  inTable?: boolean;
}

/** A Markdown link label with its pipes escaped inside a table row. */
export function escapeLinkLabelPipes(label: string, opts?: LinkWriteOptions): string {
  return escapePipes(label, !!opts?.inTable);
}

/** `line` with `link` rewritten to `[[target|label]]` — or `[[target]]`
 * when the label is empty or the target itself. The target loses a `.md`
 * (Obsidian never writes it in wikilinks), and unchanged fields leave the
 * line untouched. Everything outside the link is kept. */
export function rewriteWikiLink(
  line: string,
  link: WikiLink,
  next: { text: string; dest: string },
  opts?: LinkWriteOptions
): string {
  const current = wikiLinkFields(link);
  if (next.text.trim() === current.text.trim() && unwrapLinkDest(next.dest) === unwrapLinkDest(current.dest)) {
    return line;
  }
  const raw = unwrapLinkDest(next.dest).trim();
  const hash = raw.indexOf("#");
  const target = hash === -1
    ? raw.replace(/\.md$/i, "")
    : raw.slice(0, hash).replace(/\.md$/i, "") + raw.slice(hash);
  const label = next.text.trim();
  const escaped = link.escapedPipe || !!opts?.inTable;
  const separator = escaped ? "\\|" : "|";
  const body = !label || label === target
    ? target
    : `${target}${separator}${escapePipes(label, escaped)}`;
  return line.slice(0, link.start) + `${link.embed ? "!" : ""}[[${body}]]` + line.slice(link.end);
}

/** `line` with `link` replaced by the Markdown link `[label](dest)`, for a
 * destination a wikilink cannot carry (a URL, an unresolved path) or a
 * vault set to write Markdown links. The label's own brackets are escaped
 * (`a]` → `a\]`): unbalanced, they would end the link text early. */
export function wikiLinkToMarkdown(
  line: string,
  link: WikiLink,
  next: { text: string; dest: string },
  opts?: LinkWriteOptions
): string {
  const text = (next.text.trim() || unwrapLinkDest(next.dest)).replace(/(?<!\\)[[\]]/g, "\\$&");
  const label = escapePipes(text, link.escapedPipe || !!opts?.inTable);
  return (
    line.slice(0, link.start) +
    `${link.embed ? "!" : ""}[${label}](${normalizeLinkDest(next.dest)})` +
    line.slice(link.end)
  );
}

/** `line` with `link` reduced to the text Obsidian displays for it. */
export function unlinkWikiLink(line: string, link: WikiLink): string {
  return line.slice(0, link.start) + wikiLinkDisplay(link) + line.slice(link.end);
}

/* ---- what the link card edits ---- */

/** What the link card opens on for the columns `from..to` of a line: the
 * Markdown link or wikilink the selection sits in (or overlaps alone, with
 * only whitespace beside it), or a span of text. A selection that covers
 * text AND links — whole or in part — grows to take every such link whole,
 * and the card's text is the flattened display text, so Save writes one
 * Markdown link over the span and never nests one link in another (Notion
 * replaces the inner links the same way). An embed (`![[…]]`) is never
 * flattened: the span stops before it, or starts after it when nothing
 * precedes it. `flattened` marks a span that took links in. */
export type LinkCardTarget =
  | { kind: "markdown"; link: MarkdownLink }
  | { kind: "wiki"; link: WikiLink }
  | { kind: "text"; from: number; to: number; text: string; flattened: boolean };

export function linkCardTarget(lineText: string, from: number, to: number): LinkCardTarget {
  const md = enclosingMarkdownLink(lineText, from, to);
  if (md) return { kind: "markdown", link: md };
  const wiki = enclosingWikiLink(lineText, from, to);
  if (wiki) return { kind: "wiki", link: wiki };
  const plain: LinkCardTarget = { kind: "text", from, to, text: lineText.slice(from, to), flattened: false };
  if (from >= to) return plain;
  type Found = { start: number; end: number; embed: boolean; display: string; target: LinkCardTarget };
  const markdown = markdownLinksOnLine(lineText);
  const found: Found[] = markdown.map((link) => ({
    start: link.start,
    end: link.end,
    embed: false,
    display: link.text,
    target: { kind: "markdown", link },
  }));
  for (const link of wikiLinksOnLine(lineText)) {
    // A wikilink written inside a Markdown link's text is part of that link.
    if (markdown.some((outer) => outer.start <= link.start && link.end <= outer.end)) continue;
    found.push({
      start: link.start,
      end: link.end,
      embed: link.embed,
      display: wikiLinkDisplay(link),
      target: { kind: "wiki", link },
    });
  }
  found.sort((a, b) => a.start - b.start);
  let lo = from;
  let hi = to;
  let shrunk = false;
  for (;;) {
    const embed = found.find((item) => item.embed && item.start < hi && item.end > lo);
    if (!embed) break;
    if (embed.start > lo && lineText.slice(lo, embed.start).trim()) hi = embed.start;
    else lo = Math.max(lo, embed.end);
    shrunk = true;
    if (lo >= hi) return plain;
  }
  if (shrunk) {
    while (lo < hi && /\s/.test(lineText[lo])) lo++;
    while (hi > lo && /\s/.test(lineText[hi - 1])) hi--;
    if (lo >= hi) return plain;
  }
  const hit = found.filter((item) => !item.embed && item.start < hi && item.end > lo);
  if (hit.length === 0) {
    return shrunk ? { kind: "text", from: lo, to: hi, text: lineText.slice(lo, hi), flattened: false } : plain;
  }
  if (hit.length === 1) {
    const only = hit[0];
    const beside = lineText.slice(lo, Math.max(lo, only.start)) + lineText.slice(Math.min(hi, only.end), hi);
    if (!beside.trim()) return only.target;
  }
  const start = Math.min(lo, hit[0].start);
  const end = Math.max(hi, hit[hit.length - 1].end);
  let text = "";
  let pos = start;
  for (const item of hit) {
    text += lineText.slice(pos, item.start) + item.display;
    pos = item.end;
  }
  text += lineText.slice(pos, end);
  return { kind: "text", from: start, to: end, text, flattened: true };
}
