import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { t } from "../i18n";

/**
 * `/toc`: a table of contents written as plain Markdown, a nested list of
 * `[[#Heading]]` links behind a `<!-- nf-toc -->` marker, so it survives
 * without the plugin. The marker lets a refresh find and rewrite the list in
 * one undoable edit. Links follow Obsidian's own heading resolution, so
 * duplicate headings ("Notes" under each week) link to the right one.
 */

export interface TocHeading { level: number; heading: string }
export interface TocOptions {
  /** One nesting step; the host passes the vault's indent unit (default a tab). */
  indent?: string;
  /** The host's exact code-fence test (1-based lines); replaces the built-in fence scan. */
  skipLine?: (lineNo: number) => boolean;
}

export const TOC_MARKER = "<!-- nf-toc -->";
export const TOC_USER_EVENT = "input.toc-refresh";

const RE_MARKER = /^([\s>]*)<!--\s*nf-toc\s*-->\s*$/i;
const RE_LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s/;
const RE_LIST_MARKER = /^(?:[-*+]|\d{1,9}[.)])[ \t]+/;
const RE_ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const RE_QUOTE_PREFIX = /^[ \t]*(?:>[ \t]?)*/;
/** Markup that must not end up inside a link target (HTML, emphasis, code, maths, brackets). */
const RE_TARGET_MARKUP = /[<>`*$[\]]/;

/** Obsidian 1.13.7's `stripHeading`: how heading links are compared. */
export function stripHeading(heading: string): string {
  return heading.replace(/[!"#$%&()*+,.:;<=>?@^`{|}~/[\]\\\r\n]/g, " ").replace(/\s+/g, " ").trim();
}

/** Obsidian 1.13.7's `stripHeadingForLink`: what "Copy link to heading" writes. */
export function stripHeadingForLink(heading: string): string {
  return heading.replace(/([:#|^\\\r\n]|%%|\[\[|]])/g, " ").replace(/\s+/g, " ").trim();
}

/** A heading as it reads on screen: comments, a trailing block id, HTML, link syntax and emphasis removed. */
export function plainHeadingText(heading: string): string {
  return heading
    .replace(/%%[\s\S]*?%%/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(^|\s)\^[A-Za-z0-9-]+\s*$/, "$1")
    // Tags only: a `<` that opens no tag ("a <= b", "x <- y") is text.
    .replace(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g, "")
    .replace(/!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, target: string, alias?: string) => alias ?? target.replace(/#/g, " > "))
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__|~~|==)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, "$1$2")
    .replace(/(^|[^\w_])_(?=\S)([^_]*?\S)_(?![\w_])/g, "$1$2")
    .replace(/\[\[|\]\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The link segment for one heading; markup falls back to `stripHeading`, which still resolves. */
function linkSegment(heading: string): string {
  const segment = stripHeadingForLink(heading);
  return RE_TARGET_MARKUP.test(segment) ? stripHeading(heading) : segment;
}

/**
 * Alias text that Live Preview and Reading view render alike: Live Preview
 * hides every `|` inside a wikilink (not only the separator), and a final
 * `]` would close the link early (`]]]`), so a space goes before `]]`.
 */
function linkDisplay(text: string): string {
  const display = text.replace(/\|/g, "｜");
  return display.endsWith("]") ? `${display} ` : display;
}

const normalize = (text: string): string => stripHeading(text).toLowerCase();

/**
 * Which heading `[[#a#b#c]]` opens: a transcription of Obsidian's
 * `resolveSubpath` heading walk. `norms` holds each heading's `normalize`d
 * text, computed once per TOC: normalising inside the walk made a long note
 * quadratic in regex passes.
 */
function resolveHeading(headings: readonly TocHeading[], norms: readonly string[], segments: readonly string[]): number {
  const want = segments.map(normalize);
  let matched = 0;
  let level = 0;
  for (let k = 0; k < headings.length; k++) {
    if (headings[k].level > level && norms[k] === want[matched]) {
      matched++;
      level = headings[k].level;
      if (matched === segments.length) return k;
    }
  }
  return -1;
}

/**
 * One entry per heading (null = skipped because its link would be empty).
 * Depth comes from a heading stack, so a skipped level (H2 → H4) indents one
 * step; only ancestors that get a row count, so an empty heading ("##") in
 * between never pushes a row two steps under its parent (an indented code
 * line to Markdown). The target is the shortest `parent#…#heading` chain
 * that Obsidian resolves to this very heading; the display is the heading's
 * plain text when that differs from what Obsidian would show for the chain.
 */
export function tocLinks(headings: readonly TocHeading[]): ({ depth: number; link: string } | null)[] {
  const stack: number[] = [];
  const segments = headings.map((heading) => linkSegment(heading.heading));
  const norms = headings.map((heading) => normalize(heading.heading));
  // A one-segment link opens the first heading with that text (the walk's
  // first match), so only duplicates need the walk.
  const first = new Map<string, number>();
  headings.forEach((heading, k) => { if (heading.level > 0 && !first.has(norms[k])) first.set(norms[k], k); });
  return headings.map((heading, index) => {
    while (stack.length && headings[stack[stack.length - 1]].level >= heading.level) stack.pop();
    const ancestors = [...stack];
    stack.push(index);
    const segment = segments[index];
    if (!segment) return null;
    let chain = [segment];
    if (first.get(normalize(segment)) !== index) {
      for (let from = ancestors.length - 1; from >= 0; from--) {
        const parents = ancestors.slice(from).map((k) => segments[k]);
        if (parents.some((part) => !part)) break;
        const candidate = [...parents, segment];
        if (resolveHeading(headings, norms, candidate) === index) { chain = candidate; break; }
      }
    }
    const natural = chain.join(" > ");
    const display = linkDisplay(plainHeadingText(heading.heading) || natural);
    const link = `[[#${chain.join("#")}${display !== natural ? `|${display}` : ""}]]`;
    return { depth: ancestors.filter((k) => segments[k]).length, link };
  });
}

/** The nested list alone ("" when no heading is linkable). */
export function buildTocMarkdown(headings: readonly TocHeading[], options: TocOptions = {}): string {
  const indent = options.indent ?? "\t";
  return tocLinks(headings)
    .filter((entry): entry is { depth: number; link: string } => entry != null)
    .map((entry) => `${indent.repeat(entry.depth)}- ${entry.link}`)
    .join("\n");
}

/** The marker line, then the list with no blank line between (the marker alone when empty). */
export function tocBlockText(headings: readonly TocHeading[], options?: TocOptions): string {
  const list = buildTocMarkdown(headings, options);
  return list ? `${TOC_MARKER}\n${list}` : TOC_MARKER;
}

/**
 * The slash-menu snippet (`‸` = caret), or null when no heading is linkable.
 * The caret lands after a blank line: directly under the last item, typed
 * text would continue that list item.
 */
export function tocSnippet(headings: readonly TocHeading[], options?: TocOptions): string | null {
  const list = buildTocMarkdown(headings, options);
  return list ? `${TOC_MARKER}\n${list}\n\n‸` : null;
}

/**
 * Lines that are not Markdown text: YAML frontmatter and fenced code (plus
 * `$$` maths, `%%` comment blocks and multi-line `<!-- -->` comments when
 * `blocks` is set; these run even with `skipLine`). An unclosed fence or
 * comment runs to the end of the note; a quoted fence ends with its quote.
 */
function skippedLines(doc: Text, skipLine: ((lineNo: number) => boolean) | undefined, blocks: boolean): (lineNo: number) => boolean {
  const skipped = new Set<number>();
  let start = 1;
  if (doc.lines > 1 && doc.line(1).text === "---") {
    for (let n = 2; n <= doc.lines; n++) {
      if (/^(?:---|\.\.\.)[ \t]*$/.test(doc.line(n).text)) {
        for (let k = 1; k <= n; k++) skipped.add(k);
        start = n + 1;
        break;
      }
    }
  }
  let fence: { ch: string; len: number; depth: number } | null = null;
  let math = false;
  let comment = false;
  let html = false;
  /** The line above belongs to a list item (no blank line since). */
  let inItem = false;
  const depthOf = (text: string) => (text.match(RE_QUOTE_PREFIX)![0].match(/>/g) ?? []).length;
  for (let n = start; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    const underItem = inItem;
    if (!text.trim()) inItem = false;
    else if (/^\S/.test(text)) inItem = RE_LIST_ITEM.test(text);
    if (skipLine) {
      if (skipLine(n)) { skipped.add(n); continue; }
    } else {
      const depth = depthOf(text);
      const content = text.replace(RE_QUOTE_PREFIX, "").replace(/^[ \t]*/, "");
      if (fence) {
        if (depth < fence.depth) {
          fence = null;
        } else {
          skipped.add(n);
          const close = content.match(/^(`{3,}|~{3,})[ \t]*$/);
          if (close && close[1][0] === fence.ch && close[1].length >= fence.len) fence = null;
          continue;
        }
      }
      if (!math && !comment && !html) {
        // A fence may open on a list-marker line ("1. ```bash"); its body is
        // indented to the item's content, which the closer test ignores.
        const open = content.replace(RE_LIST_MARKER, "").match(/^(`{3,}|~{3,})(.*)$/);
        // Backtick info strings cannot themselves contain a backtick.
        if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
          fence = { ch: open[1][0], len: open[1].length, depth };
          skipped.add(n);
          continue;
        }
      }
    }
    if (!blocks) continue;
    const trimmed = text.trim();
    if (math || comment || html) skipped.add(n);
    if (html) {
      // An HTML block that opened with `<!--` ends on the line holding `-->`.
      if (text.includes("-->")) html = false;
    } else if (comment) {
      // Obsidian's block comment closes at the next `%%`, even mid-line.
      if (text.includes("%%")) comment = false;
    } else if ((math || trimmed.startsWith("$$")) && ((trimmed.match(/\$\$/g) ?? []).length % 2 === 1)) {
      if (!math) skipped.add(n);
      math = !math;
    } else if (!math && /^\s*%%[^%]*$/.test(text)) {
      // Only a line that starts with `%%` and has no other `%` opens one; a
      // `%%` elsewhere (`%%timeit` in inline code, "see %% below") is text.
      skipped.add(n);
      comment = true;
    } else if (!math && !underItem && /^ {0,3}<!--/.test(text) && !text.includes("-->")) {
      // Right under a list item, Obsidian reads `<!--` as the item's text
      // and a heading below it still counts.
      skipped.add(n);
      html = true;
    }
  }
  return (n) => skipped.has(n);
}

/**
 * Top-level ATX headings of the editor's own text (1-based `line`). Unlike
 * `metadataCache`, which is re-parsed only after Obsidian saves the file,
 * this is current right after an edit, so a refresh never writes stale links.
 */
export function scanHeadings(doc: Text, options: TocOptions = {}): (TocHeading & { line: number })[] {
  const skip = skippedLines(doc, options.skipLine, true);
  const headings: (TocHeading & { line: number })[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    if (skip(n)) continue;
    const m = doc.line(n).text.match(RE_ATX);
    if (!m) continue;
    const heading = (m[2] ?? "").replace(/(?:^|[ \t]+)#+[ \t]*$/, "").trim();
    headings.push({ level: m[1].length, heading, line: n });
  }
  return headings;
}

export interface TocBlock {
  /** 1-based lines. */
  markerLine: number;
  /** What precedes the marker (`> ` inside a quote, indentation inside a list item). */
  prefix: string;
  firstListLine: number | null;
  lastListLine: number | null;
}

/** Every TOC the plugin wrote: a marker line and the list that follows it. */
export function findTocBlocks(doc: Text, options: TocOptions = {}): TocBlock[] {
  const skip = skippedLines(doc, options.skipLine, false);
  const blocks: TocBlock[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    if (skip(n)) continue;
    const m = doc.line(n).text.match(RE_MARKER);
    if (!m) continue;
    const prefix = m[1];
    let last = n;
    while (last < doc.lines) {
      const text = doc.line(last + 1).text;
      if (!text.startsWith(prefix)) break;
      const rest = text.slice(prefix.length);
      if (!rest.trim() || !(RE_LIST_ITEM.test(rest) || /^\s+\S/.test(rest))) break;
      last++;
    }
    blocks.push({ markerLine: n, prefix, firstListLine: last > n ? n + 1 : null, lastListLine: last > n ? last : null });
    n = last;
  }
  return blocks;
}

/**
 * Rewrites every TOC's list from `headings`, keeping each block's prefix on
 * every line: a replace per block that changed, an insertion after the
 * marker when its list was empty, a deletion (with the newline before it)
 * when no heading is left. [] when everything is current.
 */
export function refreshTocChanges(
  doc: Text, headings: readonly TocHeading[], options?: TocOptions
): { from: number; to: number; insert: string }[] {
  const list = buildTocMarkdown(headings, options);
  const changes: { from: number; to: number; insert: string }[] = [];
  for (const block of findTocBlocks(doc, options)) {
    const text = list ? list.split("\n").map((line) => block.prefix + line).join("\n") : "";
    const marker = doc.line(block.markerLine);
    if (block.firstListLine == null || block.lastListLine == null) {
      if (!text) continue;
      // Keep a paragraph right under the marker from becoming a lazy continuation of the last item.
      const next = block.markerLine < doc.lines ? doc.line(block.markerLine + 1).text : "";
      const gap = next.replace(/^[\s>]*/, "") ? `\n${block.prefix.trimEnd()}` : "";
      changes.push({ from: marker.to, to: marker.to, insert: `\n${text}${gap}` });
      continue;
    }
    const from = doc.line(block.firstListLine).from;
    const to = doc.line(block.lastListLine).to;
    if (!text) changes.push({ from: marker.to, to, insert: "" });
    else if (doc.sliceString(from, to) !== text) changes.push({ from, to, insert: text });
  }
  return changes;
}

/** One transaction for every TOC in the note; false when all were current. */
export function applyTocRefresh(view: EditorView, headings: readonly TocHeading[], options?: TocOptions): boolean {
  const changes = refreshTocChanges(view.state.doc, headings, options);
  if (!changes.length) return false;
  view.dispatch({ changes, userEvent: TOC_USER_EVENT });
  return true;
}

/** The `/toc` slash command, in main.ts's `SlashCommand` shape. */
export const TOC_SLASH_ENTRY = {
  id: "toc",
  name: t("Table of contents"),
  desc: t("Links to every heading"),
  icon: "list-tree",
  keywords: "toc contents outline 目录 大纲",
  pinyin: "mulu ml",
  hint: "[[#]]",
  group: "advanced",
  block: true,
  needsBlank: true,
  sealBelow: true,
} as const;
