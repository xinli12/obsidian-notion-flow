import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { EditorState, Extension, Text } from "@codemirror/state";
import { editorLivePreviewField } from "obsidian";
import { t } from "../i18n";
import { findColorTagPairs } from "../core/inline-tags";
import { guard } from "../editor/safe-build";
import { STYLE_HUES } from "./style-presets";

/* Block colour: a whole block's text colour or background, as Notion's
 * block menu sets it. Both are plain Markdown/HTML the note keeps:
 *
 *   text        each line's content wrapped in the toolbar's own colour span,
 *               `<span style="color:var(--nf-red, #b5554d)">…</span>`
 *   background  one empty marker at the end of the block's FIRST line,
 *               `para <span class="nf-blk-blue"></span> ^id`, before any
 *               block id and trailing whitespace
 *
 * Reading view tints the owning <p>/<li>/<blockquote> from the marker with
 * CSS alone (`:has(> span.nf-blk-blue)`). Live Preview cannot: a block's
 * lines are separate .cm-line elements and only the first holds the
 * marker, so makeBlockBackgroundPlugin decorates every line of the block.
 *
 * Headings take a text colour only (a marker would leak into heading links
 * and the outline), setext ones (`Title` over `===`) too, which is why the
 * helpers take the line below; callout headers, tables, fences, math,
 * rules, images, captions, `^id` rows, link-reference definitions, `%%`
 * comments and HTML blocks take neither. A footnote definition is coloured
 * after its `[^1]:` label, so it stays a definition; a last backslash (a
 * hard break) stays the line's last character, outside both. The helpers
 * are line-level and know nothing of frontmatter: the host never offers
 * block colour there. Nothing here imports main.ts (it imports
 * src/features). */

export type BlockHue = (typeof STYLE_HUES)[number];

/** Every line of a block with a background carries this class. */
export const BLOCK_BG_CLASS = "nf-blk-bg";

/** The i18n key of each hue's name, the same keys as main.ts COLOR_LABELS. */
export const COLOR_LABEL_KEYS: Record<BlockHue, string> = {
  gray: "Gray",
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  cyan: "Cyan",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
};

/** "nf-blk-blue": the marker's class, and the hue class of the tinted lines. */
export function blockBgClass(hue: BlockHue): string {
  return "nf-blk-" + hue;
}

const HUE_GROUP = STYLE_HUES.join("|");
/** The marker where it counts: at the end of the line, before an optional
 * block id and trailing whitespace, or before a hard break's backslash.
 * Anywhere else (inside inline code, in the middle of a sentence) it is
 * literal text and ignored everywhere. */
const RE_MARKER_AT_END = new RegExp(
  ` ?<span class="nf-blk-(${HUE_GROUP})"></span>(?=\\\\$|(?:\\s+\\^[A-Za-z0-9-]+)?\\s*$)`
);
/** The same marker ending a string (block id and whitespace already cut). */
const RE_MARKER_TAIL = new RegExp(` ?<span class="nf-blk-(${HUE_GROUP})"></span>$`);
/** `text ^abc123` → the block id tail, whitespace before it included. */
const RE_ID_TAIL = /\s+\^[A-Za-z0-9-]+$/;
/** What `findColorTagPairs` recognises as a colour value: a css outside
 * it would never be concealed, so a write with it is refused. */
const RE_SAFE_CSS = /^[-\w(),.%# ]{1,64}$/;

/** One layer of what comes before a line's inline content. Peeled in a
 * loop, in whatever order they come: `> - [ ] x`, `- > x`, `> ## T`. */
const RE_PEEL_QUOTE = /^(?:[ \t]*>)+[ \t]?/;
const RE_PEEL_LIST = /^(?:[-*+]|\d+[.)])[ \t]+/;
const RE_PEEL_TASK = /^\[[ xX]\][ \t]+/;
const RE_PEEL_HEADING = /^#{1,6}[ \t]+/;
/** A footnote definition's label: the colour goes on the text after it, as
 * a span before `[^1]:` would stop the line being a definition. */
const RE_PEEL_FOOTNOTE = /^\[\^[^\]\r\n]+\]:[ \t]*/;

const RE_HR = /^(?:-[ \t]*){3,}$|^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$/;
const RE_HEADING = /^#{1,6}(?:[ \t]|$)/;
const RE_FENCE_OPEN = /^(`{3,}|~{3,})/;
const RE_ID_ROW = /^\^[A-Za-z0-9-]+[ \t]*$/;
const RE_IMAGE_ONLY = /^(?:!\[[^\]\r\n]*\]\([^\r\n)]+\)|!\[\[[^\]\r\n]+\]\])[ \t]*$/;
/** An HTML block, CommonMark's seven kinds: a raw-text or block-level tag
 * (plus media and images), a comment, `<?`, `<!X`, CDATA, or any other tag
 * alone on its line. The plugin's own inline spans (a colour, a comment
 * anchor) share their line with text, so a coloured paragraph stays one. */
const RE_HTML_BLOCK = new RegExp(
  "^<(?:!--|\\?|![A-Za-z]|!\\[CDATA\\[|/?(?:address|article|aside|audio|base|basefont|blockquote|body|caption|center|col|colgroup|" +
    "dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|img|" +
    "legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|pre|script|search|section|style|summary|table|tbody|" +
    "td|textarea|tfoot|th|thead|title|tr|track|ul|video)(?=[\\s/>]|$))",
  "i"
);
const RE_HTML_LONE_TAG =
  /^(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>)[ \t]*$/;
/** `[ref]: https://…` defines a link target; any tag before or after it
 * turns it back into a paragraph and every `[text][ref]` loses its target. */
const RE_LINK_REFERENCE = /^\[(?!\^)(?:\\.|[^\\[\]\r\n])+\]:/;
/** An Obsidian comment (`%%`): a span around its opening would close
 * inside the hidden text. */
const RE_OBSIDIAN_COMMENT = /^%%/;
const RE_CAPTION = /^<small class="nf-caption"/;
/** A setext underline as Obsidian reads it: `=` or `-` only, nothing after
 * (`=== ` and `- ` are text and a list item). */
const RE_SETEXT_UNDERLINE = /^(?:=+|-+)$/;

/** Where a line's inline content starts: past indent, quote markers, a
 * list marker, a task box, a footnote label and (with `heading`) a
 * heading's hashes. */
function contentStart(text: string, heading: boolean): { at: number; quoted: boolean } {
  let at = text.match(/^[ \t]*/)![0].length;
  let quoted = false;
  for (let peeled = true; peeled; ) {
    peeled = false;
    const rest = text.slice(at);
    const quote = RE_PEEL_QUOTE.exec(rest);
    const layer =
      quote ??
      RE_PEEL_LIST.exec(rest) ??
      RE_PEEL_TASK.exec(rest) ??
      RE_PEEL_FOOTNOTE.exec(rest) ??
      (heading ? RE_PEEL_HEADING.exec(rest) : null);
    if (layer && layer[0].length > 0) {
      if (layer === quote) quoted = true;
      at += layer[0].length;
      at += text.slice(at).match(/^[ \t]*/)![0].length;
      peeled = true;
    }
  }
  return { at, quoted };
}

/** Whether `text` ends (at `end`, not before `start`) in an odd run of
 * backslashes: the last one escapes what follows, the `<` of a closing
 * tag, say, and at the end of a line it is a hard break. */
function endsInEscape(text: string, end = text.length, start = 0): boolean {
  let run = 0;
  while (end - run > start && text[end - run - 1] === "\\") run++;
  return run % 2 === 1;
}

/** The width of leading whitespace, a tab reaching the next multiple of 4. */
function indentWidth(ws: string): number {
  let width = 0;
  for (const ch of ws) width = ch === "\t" ? width + 4 - (width % 4) : width + 1;
  return width;
}

/** A line's quote depth, and what follows its quote markers. */
function unquote(text: string): { depth: number; rest: string } {
  const quote = RE_PEEL_QUOTE.exec(text);
  if (!quote) return { depth: 0, rest: text };
  return { depth: quote[0].split(">").length - 1, rest: text.slice(quote[0].length) };
}

/** Whether `below` underlines the paragraph line `above` into a setext
 * heading, as Obsidian reads it: `===` or `---` (a lone `-` too) and
 * nothing else, in the same quote, and no further in than the paragraph
 * (an indented `  ===` is text) or, under a list item, at least as far in
 * as the item's text. The caller knows `above` is paragraph text. */
function underlines(above: string, below: string): boolean {
  const top = unquote(above);
  const under = unquote(below);
  if (top.depth !== under.depth) return false;
  const lead = under.rest.match(/^[ \t]*/)![0];
  if (!RE_SETEXT_UNDERLINE.test(under.rest.slice(lead.length))) return false;
  const topLead = top.rest.match(/^[ \t]*/)![0];
  const item = RE_PEEL_LIST.exec(top.rest.slice(topLead.length));
  if (item) return indentWidth(lead) >= indentWidth(topLead) + item[0].length;
  return indentWidth(lead) <= indentWidth(topLead);
}

/** Whether `below` is the setext underline of the paragraph line `above`. */
function isSetextUnderline(above: string, below: string): boolean {
  return blockColorSupport(above).background && underlines(above, below);
}

/**
 * Which colours a block whose first line is `firstLineText` can take;
 * `nextLineText` is the document line below it (none at the end), which
 * can make it a setext heading. Headings: text only. Blank lines, fences,
 * `$$`, table rows, rules, `^id` rows, captions, image-only lines, HTML
 * blocks, `%%` comments, link-reference definitions and callout headers:
 * neither. Everything else (paragraph, list and task items, quotes,
 * footnote definitions): both.
 */
export function blockColorSupport(firstLineText: string, nextLineText?: string | null): { text: boolean; background: boolean } {
  const none = { text: false, background: false };
  const line = firstLineText.replace(/^[ \t]+/, "");
  if (line.trim() === "" || RE_HR.test(line.trimEnd())) return none;
  const { at, quoted } = contentStart(firstLineText, false);
  const content = firstLineText.slice(at);
  if (quoted && content.startsWith("[!")) return none;
  if (RE_FENCE_OPEN.test(content) || content.startsWith("$$") || content.startsWith("|")) return none;
  if (RE_HR.test(content.trimEnd()) || RE_ID_ROW.test(content) || RE_CAPTION.test(content)) return none;
  if (RE_IMAGE_ONLY.test(content) || RE_HTML_BLOCK.test(content) || RE_HTML_LONE_TAG.test(content)) return none;
  if (RE_LINK_REFERENCE.test(content) || RE_OBSIDIAN_COMMENT.test(content)) return none;
  if (RE_HEADING.test(content)) return { text: true, background: false };
  if (nextLineText != null && underlines(firstLineText, nextLineText)) return { text: true, background: false };
  return { text: true, background: true };
}

/** The end-anchored background marker on a line (the range removing it
 * takes out, its one leading space included), or null. */
export function findBlockBgMarker(lineText: string): { hue: BlockHue; from: number; to: number } | null {
  if (!lineText.includes("nf-blk-")) return null;
  const m = RE_MARKER_AT_END.exec(lineText);
  if (!m) return null;
  // The space of an empty `- ` item is the list marker's, not the marker's.
  const from = m[0].startsWith(" ") && m.index < contentStart(lineText, false).at ? m.index + 1 : m.index;
  return { hue: m[1] as BlockHue, from, to: m.index + m[0].length };
}

/**
 * The line with its background marker set to `hue`, or removed with null.
 * The marker goes after the content and before a trailing ` ^id` and
 * trailing whitespace (a hard break's two spaces survive). Null when a hue
 * is asked of a line that cannot take a background (`nextLineText`, the
 * line below, as for blockColorSupport); removing never fails. Idempotent.
 */
export function setBlockBgMarker(lineText: string, hue: BlockHue | null, nextLineText?: string | null): string | null {
  if (hue != null && !blockColorSupport(lineText, nextLineText).background) return null;
  // The prefix (list marker, quote) is never split: an empty `- ` item's
  // space is the marker's padding, not trailing whitespace.
  const prefixEnd = contentStart(lineText, false).at;
  const prefix = lineText.slice(0, prefixEnd);
  const body = lineText.slice(prefixEnd);
  const trailing = body.match(/\s*$/)![0];
  let head = body.slice(0, body.length - trailing.length);
  const id = RE_ID_TAIL.exec(head);
  const tail = id ? id[0] : "";
  if (id) head = head.slice(0, id.index);
  // A backslash ending the line is a hard break: the marker goes before
  // it, so it stays the line's last character, and without a space, which
  // would show before a backslash that ends a block (a path, say).
  const hardBreak = !tail && !trailing && endsInEscape(head) ? "\\" : "";
  if (hardBreak) head = head.slice(0, -1);
  for (let m = RE_MARKER_TAIL.exec(head); m; m = RE_MARKER_TAIL.exec(head)) head = head.slice(0, m.index);
  let before = prefix + head;
  if (hue != null) {
    const marker = `<span class="${blockBgClass(hue)}"></span>`;
    before += before === "" || hardBreak || /[ \t]$/.test(before) ? marker : " " + marker;
  }
  return before + hardBreak + tail + trailing;
}

/** Fence bookkeeping shared by the scans: ``` / ~~~ (a closer of the same
 * character, at least as long) and `$$` math. `step` says whether a line
 * is inside, or opens or closes, such a block. */
function blockTracker() {
  let fence: { char: string; length: number } | null = null;
  let math = false;
  return (text: string): boolean => {
    const cheap = text.includes("```") || text.includes("~~~") || text.includes("$$");
    if (!cheap && !fence && !math) return false;
    const content = text.slice(contentStart(text, false).at);
    if (fence) {
      const close = RE_FENCE_OPEN.exec(content);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length && content.slice(close[1].length).trim() === "") fence = null;
      return true;
    }
    if (math) {
      if (content.includes("$$")) math = false;
      return true;
    }
    const open = RE_FENCE_OPEN.exec(content);
    if (open) {
      fence = { char: open[1][0], length: open[1].length };
      return true;
    }
    if (content.startsWith("$$")) {
      // `$$x$$` on one line is a whole math block.
      math = !content.slice(2).includes("$$");
      return true;
    }
    return false;
  };
}

const markerCache = new WeakMap<Text, { line: number; hue: BlockHue }[]>();

/** Every background marker in the document (1-based line, hue), skipping
 * frontmatter, fences and math. One scan per document version. */
export function blockBgMarkers(doc: Text): { line: number; hue: BlockHue }[] {
  const cached = markerCache.get(doc);
  if (cached) return cached;
  const markers: { line: number; hue: BlockHue }[] = [];
  const inBlock = blockTracker();
  let n = 0;
  let frontmatter = false;
  for (const iter = doc.iterLines(); !iter.next().done; ) {
    const text = iter.value;
    n++;
    if (n === 1 && /^---[ \t]*$/.test(text)) {
      frontmatter = true;
      continue;
    }
    if (frontmatter) {
      if (/^(?:---|\.\.\.)[ \t]*$/.test(text)) frontmatter = false;
      continue;
    }
    if (inBlock(text)) continue;
    const marker = findBlockBgMarker(text);
    if (marker) markers.push({ line: n, hue: marker.hue });
  }
  markerCache.set(doc, markers);
  return markers;
}

/** The inline content of one line: after its prefix, before a block id,
 * a background marker, trailing whitespace and a trailing backslash. */
function contentRange(text: string): { start: number; end: number } {
  const start = contentStart(text, true).at;
  let end = text.length;
  const trimEnd = () => {
    while (end > start && /\s/.test(text[end - 1])) end--;
  };
  // Inside the span a last backslash would escape the `<` of `</span>`
  // (Reading view then prints the tag); outside, a hard break stays one.
  const trimEscape = () => {
    if (endsInEscape(text, end, start)) end--;
    trimEnd();
  };
  trimEnd();
  const id = RE_ID_TAIL.exec(text.slice(start, end));
  if (id) end = start + id.index;
  trimEscape();
  const marker = RE_MARKER_TAIL.exec(text.slice(start, end));
  if (marker) end = start + marker.index;
  trimEscape();
  return { start, end: Math.max(start, end) };
}

/** The colour span wrapping a line's whole content, if there is one. */
function fullWrap(text: string, start: number, end: number) {
  return (
    findColorTagPairs(text).find(
      (pair) => pair.open.from === start && pair.close.to === end && pair.style?.startsWith("color:") && pair.comment == null
    ) ?? null
  );
}

/**
 * The edits that give every line of `range` the text colour `css` (a
 * palette value such as `var(--nf-red, #b5554d)`), or with null take the
 * block's colour off. Each line's content is wrapped on its own; fences,
 * math, structural rows (tables, captions, `^id` rows) and a setext
 * heading's underline are left alone.
 * A line already wholly wrapped gets its open tag replaced (recolour) or
 * both tags removed; inline colours inside a block survive. Sorted by
 * `from`. A css the plugin's tag matcher would not recognise is refused.
 */
export function blockTextColorChanges(
  doc: Text,
  range: { startLine: number; endLine: number },
  css: string | null
): { from: number; to: number; insert: string }[] {
  if (css != null && !RE_SAFE_CSS.test(css)) return [];
  const changes: { from: number; to: number; insert: string }[] = [];
  const inBlock = blockTracker();
  const last = Math.min(range.endLine, doc.lines);
  for (let n = Math.max(1, range.startLine); n <= last; n++) {
    const line = doc.line(n);
    const text = line.text;
    if (inBlock(text) || !blockColorSupport(text).text) continue;
    // A setext underline belongs to the heading above it: wrapped, it
    // would be text, and the heading a paragraph.
    if (n > 1 && isSetextUnderline(doc.line(n - 1).text, text)) continue;
    const { start, end } = contentRange(text);
    if (start >= end) continue;
    const wrap = fullWrap(text, start, end);
    if (wrap) {
      if (css == null) {
        changes.push({ from: line.from + wrap.open.from, to: line.from + wrap.open.to, insert: "" });
        changes.push({ from: line.from + wrap.close.from, to: line.from + wrap.close.to, insert: "" });
      } else {
        changes.push({ from: line.from + wrap.open.from, to: line.from + wrap.open.to, insert: `<span style="color:${css}">` });
      }
    } else if (css != null) {
      changes.push({ from: line.from + start, to: line.from + start, insert: `<span style="color:${css}">` });
      changes.push({ from: line.from + end, to: line.from + end, insert: "</span>" });
    }
  }
  // ChangeSet.of composes (rather than sorts) specs that step backwards.
  return changes.sort((a, b) => a.from - b.from || a.to - b.to);
}

/**
 * The block's colours as its source spells them: `text`, the css of the
 * colour span wrapping the first colourable line's whole content (the host
 * maps it back to a hue); `background`, the marker's hue on the first line.
 */
export function currentBlockColors(
  doc: Text,
  range: { startLine: number; endLine: number }
): { text: string | null; background: BlockHue | null } {
  if (range.startLine < 1 || range.startLine > doc.lines) return { text: null, background: null };
  const background = findBlockBgMarker(doc.line(range.startLine).text)?.hue ?? null;
  let text: string | null = null;
  const inBlock = blockTracker();
  for (let n = range.startLine; n <= Math.min(range.endLine, doc.lines); n++) {
    const line = doc.line(n).text;
    if (inBlock(line) || !blockColorSupport(line).text) continue;
    const { start, end } = contentRange(line);
    if (start >= end) continue;
    const style = fullWrap(line, start, end)?.style;
    text = style ? style.slice("color:".length) : null;
    break;
  }
  return { text, background };
}

/** The text of a colour menu item: "Red" (text), "Red background", or "Default"
 * for null. Plain text, so native menus show it too. */
export function blockColorMenuLabel(hue: BlockHue | null, kind: "text" | "background"): string {
  if (hue == null) return t("Default");
  const name = t(COLOR_LABEL_KEYS[hue]);
  return kind === "text" ? name : t("{color} background").replace("{color}", name);
}

/** The block a line belongs to (1-based, inclusive), from the host's
 * block model; null when there is none. */
export type BlockRangeAt = (state: EditorState, lineNo: number) => { startLine: number; endLine: number } | null;

/**
 * Live Preview only: tint every line of each block that carries a
 * background marker (`nf-blk-bg nf-blk-<hue>`, plus `nf-blk-first` and
 * `nf-blk-last` on the block's real first and last lines, for the rounded
 * corners). A nested block with its own marker wins over its parent's for
 * its lines. Only visible lines are decorated.
 */
export function makeBlockBackgroundPlugin(
  blockRangeAt: BlockRangeAt,
  options: { livePreview?: (state: EditorState) => boolean } = {}
): Extension {
  const livePreview = options.livePreview ?? ((state: EditorState) => !!state.field(editorLivePreviewField, false));
  const isLive = (state: EditorState) => {
    try {
      return livePreview(state);
    } catch {
      return false;
    }
  };

  const build = (view: EditorView): DecorationSet =>
    guard("block background", () => Decoration.none, () => {
      const { state } = view;
      if (!isLive(state)) return Decoration.none;
      const doc = state.doc;
      const markers = blockBgMarkers(doc);
      if (markers.length === 0) return Decoration.none;
      const visible = view.visibleRanges.map((r) => ({ from: doc.lineAt(r.from).number, to: doc.lineAt(r.to).number }));
      if (visible.length === 0) return Decoration.none;
      const lastVisible = visible[visible.length - 1].to;
      const blocks: { startLine: number; endLine: number; hue: BlockHue }[] = [];
      for (const marker of markers) {
        // A block starts on its marker's line, so one below the viewport
        // cannot reach into it.
        if (marker.line > lastVisible) break;
        const range = blockRangeAt(state, marker.line) ?? { startLine: marker.line, endLine: marker.line };
        blocks.push({ startLine: range.startLine, endLine: Math.min(range.endLine, doc.lines), hue: marker.hue });
      }
      // Outer blocks first, so an inner block (a later start; the shorter
      // one on a tie) overwrites the lines it covers.
      blocks.sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
      const lines = new Map<number, string>();
      for (const block of blocks) {
        for (const span of visible) {
          const from = Math.max(block.startLine, span.from);
          const to = Math.min(block.endLine, span.to);
          for (let n = from; n <= to; n++) {
            let cls = `${BLOCK_BG_CLASS} ${blockBgClass(block.hue)}`;
            if (n === block.startLine) cls += " nf-blk-first";
            if (n === block.endLine) cls += " nf-blk-last";
            lines.set(n, cls);
          }
        }
      }
      const decorations = [...lines.keys()]
        .sort((a, b) => a - b)
        .map((n) => Decoration.line({ class: lines.get(n)! }).range(doc.line(n).from));
      return Decoration.set(decorations, true);
    });

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || isLive(update.startState) !== isLive(update.state)) {
          this.decorations = build(update.view);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations }
  );
}
