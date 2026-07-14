import {
  App,
  Component,
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  Menu,
  MarkdownRenderer,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  editorLivePreviewField,
  setIcon,
} from "obsidian";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  keymap,
} from "@codemirror/view";
import {
  EditorSelection,
  EditorState,
  Prec,
  Range,
  RangeSetBuilder,
  Text,
  findClusterBreak,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode, Tree } from "@lezer/common";
import { t } from "./i18n";

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

interface NotionFlowSettings {
  dragHandles: boolean;
  slashCommands: boolean;
  floatingToolbar: boolean;
  cleanRendering: boolean;
  pasteUrlLinks: boolean;
  tableEditing: boolean;
  /** Notion-like table chrome: rounded border, header wash, row hover. */
  tableStyle: boolean;
  /** Hide the plugin's own inline HTML color tags while editing. */
  concealHtml: boolean;
  /** Conceal inline Markdown formatting markers in Live Preview. */
  concealMarkdown: boolean;
  /** "default" (theme), "none", or a theme palette color name (red …). */
  tableHeaderColor: string;
  tableStripes: boolean;
  /** "accent", "default" (theme), or a theme palette color name. */
  listMarkerColor: string;
}

const DEFAULT_SETTINGS: NotionFlowSettings = {
  dragHandles: true,
  slashCommands: true,
  floatingToolbar: true,
  cleanRendering: true,
  pasteUrlLinks: true,
  tableEditing: true,
  tableStyle: true,
  concealHtml: true,
  concealMarkdown: false,
  tableHeaderColor: "default",
  tableStripes: false,
  listMarkerColor: "accent",
};

/** Theme palette color names Obsidian defines as --color-<name>-rgb. */
const PALETTE_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "purple",
  "pink",
] as const;

/* ------------------------------------------------------------------ */
/* Paste URL over selection → markdown link                            */
/* ------------------------------------------------------------------ */

const RE_URL = /^(https?|obsidian):\/\/\S+$/i;

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

/* ------------------------------------------------------------------ */
/* Block detection (shared by drag & drop)                             */
/* ------------------------------------------------------------------ */

interface BlockRange {
  startLine: number; // 1-based
  endLine: number; // 1-based, inclusive
}

// Keep the complete marker padding: CommonMark permits 1–4 spaces after a
// marker, and that padding determines the real content column.
const RE_LIST = /^(\s*)(?:[-*+]|\d+[.)])([ \t]+)/;
const RE_LIST_MARKER = /^(\s*)([-*+]|\d+[.)])([ \t]+)/;
const RE_HEADING = /^#{1,6}\s/;
const RE_HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const RE_FENCE = /^\s*(```|~~~)/;
const RE_QUOTE = /^\s*>/;
const RE_BLANK = /^\s*$/;

function indentWidth(s: string): number {
  const m = s.match(/^\s*/);
  return m ? m[0].replace(/\t/g, "    ").length : 0;
}

/** Markdown content column immediately after a list marker. */
function listContentIndent(text: string): number | null {
  const m = text.match(RE_LIST);
  if (!m) return null;
  // Tabs advance to a four-column stop. Counting characters would report
  // "-   item" as column 2 even though its content really begins at 4.
  let column = 0;
  for (const ch of m[0]) {
    column += ch === "\t" ? 4 - (column % 4) : 1;
  }
  return column;
}

/** Shared three-step list-style cycle. `depth` is zero-based. */
export type ListStylePhase = 0 | 1 | 2;

export function listStylePhase(depth: number): ListStylePhase {
  const normalized = Math.max(0, Math.floor(depth) || 0);
  return (normalized % 3) as ListStylePhase;
}

function alphabeticCounter(value: number): string | null {
  if (!Number.isSafeInteger(value) || value < 1) return null;
  let out = "";
  while (value > 0) {
    value--;
    out = String.fromCharCode(97 + (value % 26)) + out;
    value = Math.floor(value / 26);
  }
  return out;
}

function romanCounter(value: number): string | null {
  if (!Number.isSafeInteger(value) || value < 1 || value > 3999) return null;
  const numerals: Array<[number, string]> = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"],
    [100, "c"], [90, "xc"], [50, "l"], [40, "xl"],
    [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let out = "";
  for (const [amount, glyph] of numerals) {
    while (value >= amount) {
      out += glyph;
      value -= amount;
    }
  }
  return out;
}

/** Marker shown by the Live Preview decoration for one ordered-list item. */
export function formatOrderedListMarker(
  value: number,
  phase: ListStylePhase | number,
  delimiter: "." | ")" = "."
): string {
  const normalized = Number.isSafeInteger(value) ? value : 1;
  const style = listStylePhase(phase);
  const counter = style === 1
    ? alphabeticCounter(normalized)
    : style === 2
      ? romanCounter(normalized)
      : null;
  return `${counter ?? normalized}${delimiter}`;
}

export interface OrderedListMarker {
  from: number;
  to: number;
  value: number;
  phase: ListStylePhase;
  label: string;
}

export interface ListLineStyle {
  from: number;
  phase: ListStylePhase;
}

interface ListRenderingData {
  markers: OrderedListMarker[];
  lines: ListLineStyle[];
}

/**
 * Obsidian Live Preview uses a HyperMD line-oriented syntax tree rather than
 * the nested OrderedList/BulletList nodes exposed by @lezer/markdown. Build
 * the same rendering model directly from source so the editor runtime and
 * parser-based tests share identical depth/counter semantics.
 */
function collectSourceListRendering(doc: Text): ListRenderingData {
  interface ItemContext {
    id: number;
    contentIndent: number;
  }
  interface CounterContext {
    parentId: number;
    ordered: boolean;
    value: number;
  }

  const markers: OrderedListMarker[] = [];
  const lines: ListLineStyle[] = [];
  const stack: ItemContext[] = [];
  const counters: Array<CounterContext | undefined> = [];
  const fences = scanFences(doc);
  let nextItemId = 1;
  let rootSequence = 0;

  const leaveItemsShallowerThan = (indent: number): boolean => {
    const before = stack.length;
    while (
      stack.length > 0 &&
      indent < stack[stack.length - 1].contentIndent
    ) stack.pop();
    return before > 0 && stack.length === 0;
  };

  for (let lineNo = 1; lineNo <= doc.lines; lineNo++) {
    const line = doc.line(lineNo);
    const fence = fenceAt(fences, lineNo);
    if (fence) {
      // Only the opener determines whether this fence is still inside the
      // current list item. Body rows may intentionally have no indentation.
      if (lineNo === fence.startLine && leaveItemsShallowerThan(fence.indent)) {
        rootSequence++;
        counters.length = 0;
      }
      continue;
    }

    const match = line.text.match(RE_LIST_MARKER);
    if (match) {
      const markerIndent = indentWidth(match[1]);
      leaveItemsShallowerThan(markerIndent);
      const depth = stack.length;
      const phase = listStylePhase(depth);
      const markerText = match[2];
      const ordered = /^\d/.test(markerText);
      const parentId = stack[stack.length - 1]?.id ?? -1 - rootSequence;
      const previous = counters[depth];
      const sameContainer = !!previous &&
        previous.parentId === parentId &&
        previous.ordered === ordered;
      let value = ordered
        ? Number.parseInt(markerText, 10)
        : 0;
      if (ordered && sameContainer) value = previous.value + 1;

      lines.push({ from: line.from, phase });
      if (ordered && Number.isSafeInteger(value)) {
        const delimiter = markerText.endsWith(")") ? ")" : ".";
        const from = line.from + match[1].length;
        markers.push({
          from,
          to: from + markerText.length,
          value,
          phase,
          label: formatOrderedListMarker(value, phase, delimiter),
        });
      }

      counters.length = depth + 1;
      counters[depth] = { parentId, ordered, value };
      stack.push({
        id: nextItemId++,
        contentIndent: listContentIndent(line.text) ?? markerIndent,
      });
      continue;
    }

    if (RE_BLANK.test(line.text)) continue;
    if (leaveItemsShallowerThan(indentWidth(line.text))) {
      rootSequence++;
      counters.length = 0;
    }
  }

  return { markers, lines };
}

/** One syntax-tree walk shared by Live Preview bullets and ordered labels. */
function collectListRendering(tree: Tree, doc: Text): ListRenderingData {
  const markers: OrderedListMarker[] = [];
  const lines = new Map<number, ListStylePhase>();

  const visitChildren = (node: SyntaxNode, listDepth: number) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      visit(child, listDepth);
    }
  };

  const visit = (node: SyntaxNode, listDepth: number): void => {
    if (node.name === "OrderedList" || node.name === "BulletList") {
      const phase = listStylePhase(listDepth);
      let value: number | null = null;
      for (let item = node.firstChild; item; item = item.nextSibling) {
        if (item.name !== "ListItem") continue;
        let mark = item.firstChild;
        while (mark && mark.name !== "ListMark") mark = mark.nextSibling;
        if (!mark) continue;
        lines.set(doc.lineAt(mark.from).from, phase);
        if (node.name !== "OrderedList") continue;
        const raw = doc.sliceString(mark.from, mark.to);
        const match = raw.match(/^(\d+)([.)])$/);
        if (!match) continue;
        if (value == null) value = Number.parseInt(match[1], 10);
        else value++;
        if (!Number.isSafeInteger(value)) continue;
        const delimiter = match[2] as "." | ")";
        markers.push({
          from: mark.from,
          to: mark.to,
          value,
          phase,
          label: formatOrderedListMarker(value, phase, delimiter),
        });
      }
      visitChildren(node, listDepth + 1);
      return;
    }
    visitChildren(node, listDepth);
  };

  visit(tree.topNode, 0);
  const rendering = {
    markers: markers.sort((a, b) => a.from - b.from),
    lines: [...lines].map(([from, phase]) => ({ from, phase }))
      .sort((a, b) => a.from - b.from),
  };
  // Obsidian 1.12+ exposes HyperMD-list-line-* nodes instead of semantic
  // list containers. The source model is intentionally independent of tree
  // dialect and therefore remains stable across Live Preview versions.
  return rendering.lines.length > 0
    ? rendering
    : collectSourceListRendering(doc);
}

/**
 * Read ordered markers from the Markdown syntax tree. The first source
 * number starts each list; following items increment like Reading view,
 * even when the Markdown intentionally repeats `1.` for every item.
 */
export function collectOrderedListMarkers(
  tree: Tree,
  doc: Text
): OrderedListMarker[] {
  return collectListRendering(tree, doc).markers;
}

/** Source-line phases for both ordered and unordered Live Preview lists. */
export function collectListLineStyles(tree: Tree, doc: Text): ListLineStyle[] {
  return collectListRendering(tree, doc).lines;
}

/** Add the same depth phase to Reading-view UL and OL containers. */
export function annotateReadingListPhases(root: HTMLElement): void {
  const lists: HTMLElement[] = [
    ...(root.matches("ul, ol") ? [root] : []),
    ...Array.from(root.querySelectorAll<HTMLElement>("ul, ol")),
  ];
  for (const list of lists) {
    let depth = 0;
    let parent = list.parentElement?.closest<HTMLElement>("ul, ol") ?? null;
    while (parent) {
      depth++;
      parent = parent.parentElement?.closest<HTMLElement>("ul, ol") ?? null;
    }
    list.dataset.nfListPhase = String(listStylePhase(depth));
  }
}

/** First line of the contiguous quote/callout containing `lineNo`. */
function quoteGroupStart(doc: Text, lineNo: number): number {
  const indent = indentWidth(doc.line(lineNo).text);
  let start = lineNo;
  while (
    start > 1 &&
    RE_QUOTE.test(doc.line(start - 1).text) &&
    indentWidth(doc.line(start - 1).text) === indent
  ) {
    start--;
  }
  return start;
}

/**
 * Obsidian's Reading View treats an unindented quote immediately following
 * a list item as attached content, while Live Preview often lays it out at
 * the editor edge. Preserve that useful interpretation for visual depth and
 * block dragging, without treating a quote after a blank line as attached.
 */
function attachedListParent(
  doc: Text,
  lineNo: number
): { lineNo: number; contentIndent: number } | null {
  if (!RE_QUOTE.test(doc.line(lineNo).text)) return null;
  const start = quoteGroupStart(doc, lineNo);
  if (start <= 1) return null;
  const quoteIndent = indentWidth(doc.line(start).text);
  const parentText = doc.line(start - 1).text;
  const contentIndent = listContentIndent(parentText);
  if (contentIndent == null || indentWidth(parentText) !== quoteIndent) return null;
  return { lineNo: start - 1, contentIndent };
}

/** Number of list ancestors that visually contain this source line. */
export function listNestingDepth(
  doc: Text,
  lineNo: number,
  fences: FenceRange[] = scanFences(doc)
): number {
  if (lineNo < 1 || lineNo > doc.lines) return 0;
  let depth = 0;
  for (let n = lineNo - 1; n >= 1; n--) {
    const text = doc.line(n).text;
    if (!RE_LIST.test(text)) continue;
    // The list range is the containment proof. Merely finding an earlier,
    // shallower marker is not enough: a paragraph/blank may have ended that
    // list long before this indented top-level block.
    const range = getBlockRange(doc, n, fences);
    if (range?.startLine === n && range.endLine >= lineNo) depth++;
  }
  return depth;
}

/** Structural indentation to preserve while dragging a block. */
function effectiveBlockIndent(doc: Text, lineNo: number): number {
  return attachedListParent(doc, lineNo)?.contentIndent ?? indentWidth(doc.line(lineNo).text);
}

/** A fenced code block, marker lines included (1-based, inclusive). */
export interface FenceRange {
  startLine: number;
  endLine: number;
  indent: number; // indent of the opening marker
}

const RE_FENCE_OPEN = /^(\s*)(`{3,}|~{3,})(.*)$/;

/**
 * Scan the whole document once and return all fenced code blocks.
 * Handles indented fences (inside lists/quotes), tilde fences, marker-length
 * matching per CommonMark, and an unclosed trailing fence.
 */
export function scanFences(doc: Text): FenceRange[] {
  const fences: FenceRange[] = [];
  let openLine = -1;
  let openChar = "";
  let openLen = 0;
  let openIndent = 0;
  for (let i = 1; i <= doc.lines; i++) {
    const m = doc.line(i).text.match(RE_FENCE_OPEN);
    if (openLine < 0) {
      // Backtick info strings cannot themselves contain a backtick.
      if (m && !(m[2][0] === "`" && m[3].includes("`"))) {
        openLine = i;
        openChar = m[2][0];
        openLen = m[2].length;
        openIndent = indentWidth(m[1]);
      }
    } else if (
      m &&
      m[2][0] === openChar &&
      m[2].length >= openLen &&
      /^[ \t]*$/.test(m[3]) &&
      indentWidth(m[1]) <= openIndent + 3
    ) {
      fences.push({ startLine: openLine, endLine: i, indent: openIndent });
      openLine = -1;
    }
  }
  if (openLine > 0) fences.push({ startLine: openLine, endLine: doc.lines, indent: openIndent });
  return fences;
}

function fenceAt(fences: FenceRange[], lineNo: number): FenceRange | null {
  for (const f of fences) {
    if (lineNo >= f.startLine && lineNo <= f.endLine) return f;
  }
  return null;
}

/** Leading characters that reach `columns` (tabs advance to 4-column stops).
 * Stops early at the first non-whitespace character, so a body line that is
 * shallower than its fence opener anchors at its own outermost column. */
export function indentCharsForColumns(text: string, columns: number): number {
  let column = 0;
  let i = 0;
  while (i < text.length && column < columns) {
    const ch = text[i];
    if (ch === " ") column += 1;
    else if (ch === "\t") column += 4 - (column % 4);
    else break;
    i++;
  }
  return i;
}

/** Lines that can anchor a nested fence's painted layer: non-blank body
 * rows only. Marker rows are unreliable anchors — Live Preview replaces
 * their fence syntax with widgets while the cursor is outside the block,
 * so measuring them would return the collapsed replacement's edge. */
export function fenceMeasureLines(doc: Text, fence: FenceRange): number[] {
  const lines: number[] = [];
  for (let n = fence.startLine + 1; n < fence.endLine; n++) {
    if (doc.line(n).text.trim()) lines.push(n);
  }
  return lines;
}

/** Compute the logical block containing the given line. */
export function getBlockRange(
  doc: Text,
  lineNo: number,
  fences: FenceRange[] = scanFences(doc)
): BlockRange | null {
  if (lineNo < 1 || lineNo > doc.lines) return null;

  // Any line inside a fenced code block (markers, code, blank lines, and
  // lines that merely LOOK like lists/headings) → the whole fence.
  const fence = fenceAt(fences, lineNo);
  if (fence) return { startLine: fence.startLine, endLine: fence.endLine };

  const line = doc.line(lineNo);
  const text = line.text;
  // A blank line is its own single-line block, so it can be hovered,
  // dragged out of the way, or deleted from the handle menu like any
  // other block (Notion treats empty blocks the same way).
  if (RE_BLANK.test(text)) return { startLine: lineNo, endLine: lineNo };

  // Heading: single line.
  if (RE_HEADING.test(text)) return { startLine: lineNo, endLine: lineNo };

  // Horizontal rule: single line. Treating it as a paragraph would make a
  // drag/delete carry the following paragraph and may create a setext H2.
  if (RE_HR.test(text)) return { startLine: lineNo, endLine: lineNo };

  // Quote / callout: contiguous ">" lines (never crossing a fence).
  if (RE_QUOTE.test(text)) {
    const indent = indentWidth(text);
    let start = lineNo;
    let end = lineNo;
    while (
      start > 1 &&
      !fenceAt(fences, start - 1) &&
      RE_QUOTE.test(doc.line(start - 1).text) &&
      indentWidth(doc.line(start - 1).text) === indent
    )
      start--;
    while (
      end < doc.lines &&
      !fenceAt(fences, end + 1) &&
      RE_QUOTE.test(doc.line(end + 1).text) &&
      indentWidth(doc.line(end + 1).text) === indent
    )
      end++;
    // CommonMark permits an unmarked lazy continuation of the paragraph at
    // the end of a blockquote (`> foo\nbar`). Keep that text in the same
    // draggable/editable block, but never cross a structural block start.
    const quoteTail = doc.line(end).text.replace(/^\s*>[ \t]?/, "");
    if (lazyGrabbable(quoteTail)) {
      while (
        end < doc.lines &&
        !fenceAt(fences, end + 1) &&
        lazyGrabbable(doc.line(end + 1).text)
      ) end++;
    }
    return { startLine: start, endLine: end };
  }

  // Table: contiguous "|" rows (header, delimiter, body) are one block —
  // dragging, highlighting, or deleting a table always takes all of it.
  if (RE_TABLE.test(text)) {
    return getTableRange(doc, lineNo, fences);
  }

  // List item: this line plus its nested content — deeper-indented lines,
  // nested code fences (which may contain blank or oddly indented lines),
  // and blank separators of a loose list when deeper content follows.
  const listMatch = text.match(RE_LIST);
  if (listMatch) {
    const indent = indentWidth(listMatch[1]);
    const contentIndent = listContentIndent(text) ?? indent + 2;
    let lazyParagraphOpen = lazyGrabbable(text.slice(listMatch[0].length));
    let end = lineNo;
    let i = lineNo + 1;
    while (i <= doc.lines) {
      // A nested fence swallows everything up to its closing marker.
      const f = fenceAt(fences, i);
      if (f) {
        if (f.indent >= contentIndent) {
          end = f.endLine;
          i = f.endLine + 1;
          lazyParagraphOpen = false;
          continue;
        }
        // A shallower fence is outside this item. Letting its opener fall
        // through as a lazy paragraph continuation makes a top-level fence
        // look nested again after an in-place outdent.
        break;
      }
      const t = doc.line(i).text;
      // Match Obsidian Reading View's lazy list attachment: an immediately
      // adjacent quote/callout at the item's marker column belongs to this
      // item. This also makes the parent handle carry the whole callout.
      if (i === lineNo + 1 && RE_QUOTE.test(t) && indentWidth(t) === indent) {
        const attached = getBlockRange(doc, i, fences);
        end = attached?.endLine ?? i;
        i = end + 1;
        lazyParagraphOpen = false;
        continue;
      }
      if (RE_BLANK.test(t)) {
        // Loose list: keep going only if the next non-blank line is still
        // part of this item (deeper indent or a deeper nested fence).
        let j = i + 1;
        while (j <= doc.lines && RE_BLANK.test(doc.line(j).text)) j++;
        if (j > doc.lines) break;
        const nf = fenceAt(fences, j);
        const nextText = doc.line(j).text;
        const nextIndent = indentWidth(nextText);
        const structural =
          !!nf || RE_QUOTE.test(nextText) || RE_LIST.test(nextText) ||
          RE_TABLE.test(nextText) || RE_HEADING.test(nextText) || RE_HR.test(nextText);
        const deeper = nf
          ? nf.indent >= contentIndent
          : structural
            ? nextIndent >= contentIndent
            : nextIndent > indent;
        if (!deeper) break;
        i = j; // skip the blanks; the next iteration includes line j
        lazyParagraphOpen = false;
        continue;
      }
      const lineIndent = indentWidth(t);
      const structural =
        RE_QUOTE.test(t) || RE_LIST.test(t) || RE_TABLE.test(t) ||
        RE_HEADING.test(t) || RE_HR.test(t);
      const lazyContinuation = !structural && lazyParagraphOpen;
      if (
        structural ? lineIndent >= contentIndent : lineIndent > indent || lazyContinuation
      ) {
        // A nested list/quote/table can itself own lazy continuation lines.
        // Consume that semantic child as a whole so dragging the outer list
        // never strands part of the child's paragraph behind.
        const child = structural ? getBlockRange(doc, i, fences) : null;
        end = child?.endLine ?? i;
        i = end + 1;
        lazyParagraphOpen = !structural;
        continue;
      }
      break;
    }
    return { startLine: lineNo, endLine: end };
  }

  // Hovering a lazy continuation should resolve back to the owning quote or
  // list paragraph, not produce a second independently draggable block.
  if (lazyGrabbable(text)) {
    let ownerLine = lineNo - 1;
    while (
      ownerLine >= 1 &&
      !fenceAt(fences, ownerLine) &&
      lazyGrabbable(doc.line(ownerLine).text)
    ) ownerLine--;
    if (
      ownerLine >= 1 &&
      (RE_QUOTE.test(doc.line(ownerLine).text) || RE_LIST.test(doc.line(ownerLine).text))
    ) {
      const owner = getBlockRange(doc, ownerLine, fences);
      if (owner && owner.endLine >= lineNo) return owner;
    }
  }

  // Plain paragraph: contiguous non-blank, non-special lines (never
  // absorbing fence lines).
  const isPlain = (n: number) => {
    if (fenceAt(fences, n)) return false;
    const t = doc.line(n).text;
    return (
      !RE_BLANK.test(t) &&
      !RE_HEADING.test(t) &&
      !RE_HR.test(t) &&
      !RE_QUOTE.test(t) &&
      !RE_LIST.test(t) &&
      !RE_TABLE.test(t)
    );
  };
  let start = lineNo;
  let end = lineNo;
  while (start > 1 && isPlain(start - 1)) start--;
  while (end < doc.lines && isPlain(end + 1)) end++;
  return { startLine: start, endLine: end };
}

export interface NestedCalloutRepair {
  from: number;
  to: number;
  insert: string;
  targetIndent: number;
}

/**
 * Build an explicit, undoable repair for legacy Callouts that were indented
 * farther than their parent list marker's content column. Obsidian renders
 * those rows as a gray code `<pre>` after their list context is lost. This
 * function only recognizes an actual `[!type]` Callout under a containing
 * list item; ordinary nested quotes/code blocks are never rewritten.
 */
export function nestedCalloutRepair(
  doc: Text,
  lineNo: number,
  fences: FenceRange[] = scanFences(doc)
): NestedCalloutRepair | null {
  if (lineNo < 1 || lineNo > doc.lines) return null;
  // The command/menu must originate on this quote itself. Otherwise a
  // same-indent sibling can make quoteGroupStart walk back into the prior
  // Callout, and a `>[!tip]` literal inside fenced code could be rewritten.
  if (!RE_QUOTE.test(doc.line(lineNo).text) || fenceAt(fences, lineNo)) return null;
  const start = quoteGroupStart(doc, lineNo);
  const head = doc.line(start).text;
  if (!/^\s*>\s*\[![^\]\r\n]+\][+-]?/.test(head)) return null;

  const sourceIndent = indentWidth(head);
  let end = start;
  while (
    end < doc.lines &&
    RE_QUOTE.test(doc.line(end + 1).text) &&
    indentWidth(doc.line(end + 1).text) === sourceIndent
  ) end++;

  let targetIndent: number | null = null;
  for (let n = start - 1; n >= 1; n--) {
    const contentIndent = listContentIndent(doc.line(n).text);
    if (contentIndent == null) continue;
    const parent = getBlockRange(doc, n, fences);
    if (parent?.startLine === n && parent.endLine >= end) {
      targetIndent = contentIndent;
      break;
    }
  }
  if (targetIndent == null) return null;

  const missingMarkerSpace = /^\s*>\[!/.test(head);
  const overIndented = sourceIndent > targetIndent;
  if (!overIndented && !missingMarkerSpace) return null;

  const lines: string[] = [];
  for (let n = start; n <= end; n++) {
    const original = doc.line(n).text;
    const leading = original.match(/^\s*/)?.[0] ?? "";
    const prefix = overIndented ? " ".repeat(targetIndent) : leading;
    let content = original.slice(leading.length);
    if (n === start) content = content.replace(/^>\s*(?=\[!)/, "> ");
    lines.push(prefix + content);
  }
  return {
    from: doc.line(start).from,
    to: doc.line(end).to,
    insert: lines.join("\n"),
    targetIndent,
  };
}

/** Editor indentation unit: how wide one nesting step is, and whether
 *  new indentation is written with tabs (matching the Tab key). */
export interface IndentUnit {
  width: number;
  useTab: boolean;
}

const DEFAULT_INDENT_UNIT: IndentUnit = { width: 4, useTab: false };

/** Indent unit from the vault's editor settings ("Indent using tabs" /
 *  "Tab indent size"), so dragged blocks nest exactly like Tab does. */
function vaultIndentUnit(app: App): IndentUnit {
  const vault = app.vault as unknown as { getConfig?: (key: string) => unknown };
  const get = vault.getConfig?.bind(app.vault);
  const useTab = get ? get("useTab") !== false : true;
  const tabSize = Number(get?.("tabSize")) || 4;
  // indentWidth() counts a tab as 4 columns, so tab indents step by 4.
  return { width: useTab ? 4 : tabSize, useTab };
}

/** `delta` columns of fresh indentation in the unit's preferred chars. */
function indentPrefix(delta: number, unit: IndentUnit): string {
  if (!unit.useTab) return " ".repeat(delta);
  return "\t".repeat(Math.floor(delta / 4)) + " ".repeat(delta % 4);
}

/** Remove at most `columns` of leading indentation without touching text. */
export function stripIndentColumns(text: string, columns: number): string {
  if (columns <= 0) return text;
  let index = 0;
  let column = 0;
  while (index < text.length && column < columns) {
    const ch = text[index];
    if (ch !== " " && ch !== "\t") break;
    const width = ch === "\t" ? 4 - (column % 4) : 1;
    if (column + width > columns) break;
    column += width;
    index++;
  }
  return text.slice(index);
}

/** Shift every non-blank line of a block by `delta` columns. */
export function reindentBlock(
  text: string,
  delta: number,
  unit: IndentUnit = DEFAULT_INDENT_UNIT
): string {
  if (delta === 0) return text;
  return text
    .split("\n")
    .map((l) => {
      if (RE_BLANK.test(l)) return l;
      const ws = l.match(/^\s*/)?.[0] ?? "";
      const target = Math.max(0, indentWidth(ws) + delta);
      // Rebuild the prefix by columns. Removing two columns from a leading
      // tab must leave two spaces, not consume all four columns at once.
      return indentPrefix(target, unit) + l.slice(ws.length);
    })
    .join("\n");
}

/**
 * Indentation a block should adopt when inserted before `targetLine`:
 * match the line the block will sit on top of; when dropping at the very
 * end, stay a sibling of a trailing list item, otherwise go top-level.
 */
export function computeTargetIndent(
  doc: Text,
  fences: FenceRange[],
  targetLine: number
): number {
  for (let n = Math.min(targetLine, doc.lines); n <= doc.lines && n > 0; n++) {
    const t = doc.line(n).text;
    if (RE_BLANK.test(t) && !fenceAt(fences, n)) continue;
    const f = fenceAt(fences, n);
    return f ? f.indent : indentWidth(t);
  }
  for (let n = Math.min(targetLine - 1, doc.lines); n >= 1; n--) {
    const t = doc.line(n).text;
    if (RE_BLANK.test(t) && !fenceAt(fences, n)) continue;
    if (RE_LIST.test(t)) return indentWidth(t);
    return 0;
  }
  return 0;
}

/** Lines a block directly above can absorb as lazy continuation:
 *  plain paragraph text and table rows. Headings, lists, fences, and
 *  dividers interrupt a paragraph, so they always stay separate. */
function lazyGrabbable(s: string): boolean {
  return (
    !RE_BLANK.test(s) &&
    !RE_HEADING.test(s) &&
    !RE_LIST.test(s) &&
    !RE_HR.test(s) &&
    !RE_FENCE.test(s) &&
    !RE_QUOTE.test(s)
  );
}

/** Lines that keep a paragraph "open": a quote/callout, list item, or
 *  paragraph line pulls a following lazyGrabbable line into itself. */
function continuable(s: string): boolean {
  return RE_QUOTE.test(s) || RE_LIST.test(s) || lazyGrabbable(s);
}

/** Whether adjacent source lines need a blank seam to stay separate. */
function needsBlankBetween(above: string, below: string): boolean {
  if (!above || !below || RE_BLANK.test(above) || RE_BLANK.test(below)) return false;
  // An unindented quote directly after a list marker is interpreted as
  // attached list content. A deliberate outdent needs a blank to detach it.
  if (
    RE_LIST.test(above) &&
    RE_QUOTE.test(below) &&
    indentWidth(below) <= indentWidth(above)
  ) return true;
  if (RE_QUOTE.test(above)) {
    // Quotes/callouts merge with another quote, absorb lazy paragraphs, and
    // in Live Preview keep a same/shallower sibling inside their edit widget.
    return indentWidth(below) <= indentWidth(above);
  }
  // A paragraph placed under a list marker without a blank is merely a
  // continuation of that item's first paragraph, not an independent block.
  if (RE_LIST.test(above) && lazyGrabbable(below)) return true;
  return (
    continuable(above) &&
    lazyGrabbable(below) &&
    indentWidth(below) <= indentWidth(above)
  );
}

/** Stronger semantic seam protection. Tables and horizontal rules need a
 * blank above even though they are not lazy paragraph continuations: without
 * it a table stops rendering and `---` turns the preceding text into H2. */
function needsProtectedSeam(above: string, below: string): boolean {
  if (!above || !below || RE_BLANK.test(above) || RE_BLANK.test(below)) return false;
  return RE_TABLE.test(below) || RE_HR.test(below) || needsBlankBetween(above, below);
}

/** Deletion span for a block: its lines plus the newline that separates it. */
function blockRemovalRange(doc: Text, block: BlockRange): { from: number; to: number } {
  let from = doc.line(block.startLine).from;
  const lastLine = doc.line(block.endLine);
  const hasTrailingNewline = lastLine.to < doc.length;
  let to = hasTrailingNewline ? lastLine.to + 1 : lastLine.to;
  // Block sits at the very end of the doc: also consume the newline before it
  // so we don't leave a stray blank line behind.
  if (!hasTrailingNewline && from > 0) from -= 1;
  // Blank lines on BOTH sides would merge into a double blank where the
  // block used to be — consume the one below as well.
  const nextLineNo = block.endLine + 1;
  if (
    hasTrailingNewline &&
    block.startLine > 1 &&
    RE_BLANK.test(doc.line(block.startLine - 1).text) &&
    nextLineNo <= doc.lines &&
    RE_BLANK.test(doc.line(nextLineNo).text)
  ) {
    const nl = doc.line(nextLineNo);
    to = nl.to < doc.length ? nl.to + 1 : nl.to;
  }
  return { from, to };
}

/** Removal range that does not fuse the source block's former neighbors. */
function protectedBlockRemovalRange(
  doc: Text,
  block: BlockRange
): { from: number; to: number } {
  const range = blockRemovalRange(doc, block);
  const above = block.startLine > 1 ? doc.line(block.startLine - 1).text : "";
  const below = block.endLine < doc.lines ? doc.line(block.endLine + 1).text : "";
  const nestedListContinuation =
    RE_LIST.test(above) && indentWidth(below) > indentWidth(above);
  if (needsProtectedSeam(above, below) && !nestedListContinuation) {
    return {
      from: doc.line(block.startLine).from,
      to: doc.line(block.endLine).to,
    };
  }
  return range;
}

/**
 * Valid indentation levels for a block inserted before `targetLine`,
 * sorted ascending. During an actual drag (`exclude` is present), each
 * ancestor contributes exactly one semantic level: content columns for
 * ordinary blocks, or an existing child marker column for moved list items.
 * Calls without a moving block retain the broader source-position query.
 */
export function computeDropIndents(
  doc: Text,
  fences: FenceRange[],
  targetLine: number,
  exclude?: BlockRange
): number[] {
  const cands = new Set<number>([0]);
  // Lines of the block being dragged don't count as context — they are
  // about to move, and must not offer a "nest under itself" level.
  const skip = (n: number) =>
    exclude !== undefined && n >= exclude.startLine && n <= exclude.endLine;

  // A non-list block belongs at a list item's content column. A moved list
  // joins an existing child marker column when available. In either case,
  // treating both columns as separate visual depths creates false levels in
  // four-space or tab-indented lists. Semantic containment exposes exactly
  // one candidate per ancestor.
  const movingList = exclude !== undefined &&
    !fenceAt(fences, exclude.startLine) &&
    RE_LIST.test(doc.line(exclude.startLine).text);
  if (exclude !== undefined) {
    let contextLine = Math.min(doc.lines, Math.max(0, targetLine - 1));
    // In-place horizontal drags point at the source block itself; loose
    // lists may also leave one or more blank separator rows. Resolve the
    // destination context to the closest real row above both.
    while (
      contextLine >= 1 &&
      (skip(contextLine) ||
        (RE_BLANK.test(doc.line(contextLine).text) &&
          !fenceAt(fences, contextLine)))
    ) contextLine--;

    const ancestors: Array<{ markerIndent: number; contentIndent: number }> = [];
    let ceiling = Infinity;
    for (let n = contextLine; n >= 1; n--) {
      if (skip(n)) continue;
      const text = doc.line(n).text;
      const contentIndent = listContentIndent(text);
      if (contentIndent == null) continue;
      const markerIndent = indentWidth(text);
      if (markerIndent >= ceiling) continue;
      const parent = getBlockRange(doc, n, fences);
      if (parent?.startLine === n && parent.endLine >= contextLine) {
        ancestors.push({ markerIndent, contentIndent });
        ceiling = markerIndent;
        if (markerIndent === 0) break;
      }
    }
    ancestors.reverse();
    for (let i = 0; i < ancestors.length; i++) {
      if (movingList) {
        // Match an existing child list's marker column at this semantic
        // depth; otherwise use the parent item's canonical content column.
        // This collapses equivalent 2/4-column spellings into one visual
        // drag step while still joining the existing Markdown list.
        cands.add(ancestors[i + 1]?.markerIndent ?? ancestors[i].contentIndent);
      } else {
        cands.add(ancestors[i].contentIndent);
      }
    }
    return [...cands].sort((a, b) => a - b);
  }

  // Below reference: joining the level of what follows is always valid.
  for (let n = Math.min(targetLine, doc.lines); n <= doc.lines && n >= 1; n++) {
    if (skip(n)) continue;
    const f = fenceAt(fences, n);
    const t = doc.line(n).text;
    if (RE_BLANK.test(t) && !f) continue;
    cands.add(f ? f.indent : indentWidth(t));
    break;
  }

  // Ancestor chain above: walk upward through strictly shallower lines.
  let ceiling = Infinity;
  for (let n = Math.min(targetLine - 1, doc.lines); n >= 1; n--) {
    if (skip(n)) continue;
    const f = fenceAt(fences, n);
    const t = doc.line(n).text;
    if (RE_BLANK.test(t) && !f) continue;
    const ind = f ? f.indent : indentWidth(t);
    if (ind >= ceiling) continue;
    ceiling = ind;
    cands.add(ind);
    if (!f) {
      const m = t.match(RE_LIST);
      // A list item's child level is its real Markdown content column:
      // 2 after "- ", 3 after "1. ", etc. Using the editor's four-column
      // Tab width here turns an indented callout into an indented code
      // block, so block dragging must follow Markdown structure instead.
      if (m) {
        const contentIndent = listContentIndent(t);
        if (contentIndent != null) cands.add(contentIndent);
      }
    }
    if (ind === 0) break;
  }
  return [...cands].sort((a, b) => a - b);
}

/** The candidate indent closest to `desired` (ties go shallower). */
export function pickIndent(cands: number[], desired: number): number {
  let best = cands[0] ?? 0;
  let bestDist = Math.abs(desired - best);
  for (const c of cands) {
    const d = Math.abs(desired - c);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Pick a structural indent from horizontal drag distance. A vertical drag
 * starts at the candidate closest to the block's current indent; only a
 * deliberate horizontal move of roughly one visual list step changes level.
 */
export function pickIndentByDrag(
  cands: number[],
  currentIndent: number,
  deltaX: number,
  visualStepPx: number
): number {
  if (cands.length === 0) return 0;
  const current = pickIndent(cands, currentIndent);
  const baseIndex = Math.max(0, cands.indexOf(current));
  const step = Math.max(12, visualStepPx || 0);
  const shift = Math.round(deltaX / step);
  return cands[Math.max(0, Math.min(cands.length - 1, baseIndex + shift))];
}

/**
 * Left edge for the 46px `+` / drag-handle pair. The ideal pair starts
 * 50px before the block's real visual anchor, but narrow editor panes must
 * keep the complete control group inside the scroll viewport.
 */
export function clampHandlePairLeft(
  anchorX: number,
  viewportLeft: number,
  viewportRight: number,
  pairWidth = 46,
  viewportPadding = 4
): number {
  const min = viewportLeft + viewportPadding;
  const max = Math.max(min, viewportRight - viewportPadding - pairWidth);
  return Math.max(min, Math.min(anchorX - 50, max));
}

export interface HandleControlPlacement {
  left: number;
  compact: boolean;
  edge: boolean;
}

/**
 * Place the handle pair without covering a native fold indicator. When a
 * narrow pane cannot fit both 22px controls, keep the drag/menu handle and
 * hide `+` (insertion remains available from the handle menu).
 */
export function placeHandleControls(
  anchorX: number,
  viewportLeft: number,
  viewportRight: number,
  foldLeft?: number,
  pairWidth = 46,
  compactWidth = 22,
  viewportPadding = 4,
  obstacleGap = 4
): HandleControlPlacement {
  const min = viewportLeft + viewportPadding;
  const maxRight = Math.max(min, viewportRight - viewportPadding);
  const foldRightLimit = Number.isFinite(foldLeft)
    ? (foldLeft as number) - obstacleGap
    : Infinity;
  const desiredRight = Math.min(anchorX - 4, foldRightLimit, maxRight);
  const fullLeft = desiredRight - pairWidth;
  if (fullLeft >= min) return { left: fullLeft, compact: false, edge: false };
  const compactLeft = desiredRight - compactWidth;
  if (compactLeft >= min) {
    return { left: compactLeft, compact: true, edge: false };
  }
  // With a fold lane hard against the viewport edge, forcing the handle
  // back to `min` would recreate the overlap. Keep a single handle on the
  // far edge of the hovered row instead.
  if (Number.isFinite(foldLeft)) {
    return {
      left: Math.max(min, maxRight - compactWidth),
      compact: true,
      edge: true,
    };
  }
  return {
    left: Math.max(min, compactLeft),
    compact: true,
    edge: false,
  };
}

/** Half-open editor widgets can report `to` at the next line's start.
 * Match only the source characters that genuinely belong to the widget. */
export function isWidgetSourcePosition(
  pos: number,
  sourceFrom: number,
  sourceEnd: number
): boolean {
  return pos >= sourceFrom && pos <= sourceEnd;
}

/**
 * Move a block so it starts at targetLine (1-based, doc.lines + 1 = end),
 * re-indenting it to fit the destination context — dragging a nested code
 * block out of a list de-indents it; dropping a paragraph between list
 * children indents it to match. `indentOverride` (from the drag's mouse X)
 * takes precedence over the inferred indentation.
 */
export function moveBlock(
  view: EditorView,
  block: BlockRange,
  targetLine: number,
  fences: FenceRange[] = scanFences(view.state.doc),
  indentOverride?: number,
  unit: IndentUnit = DEFAULT_INDENT_UNIT
): number | null {
  const doc = view.state.doc;
  const inPlace = targetLine >= block.startLine && targetLine <= block.endLine + 1;
  if (inPlace && indentOverride === undefined) return null;

  const baseIndent = indentWidth(doc.line(block.startLine).text);
  const targetIndent =
    indentOverride !== undefined
      ? pickIndent(computeDropIndents(doc, fences, targetLine, block), indentOverride)
      : computeTargetIndent(doc, fences, targetLine);

  // Dropped back onto its own position: a horizontal drag still changes
  // the nesting level, so reindent the block where it stands.
  if (inPlace) {
    if (targetIndent === baseIndent) return null;
    const from = doc.line(block.startLine).from;
    const to = doc.line(block.endLine).to;
    const source = doc.sliceString(from, to);
    const structural = source
      .split("\n")
      .some((line) => RE_QUOTE.test(line) || RE_FENCE.test(line) || RE_TABLE.test(line));
    let shifted = reindentBlock(
      source,
      targetIndent - baseIndent,
      structural ? { ...unit, useTab: false } : unit
    );
    const shiftedLines = shifted.split("\n");
    const above = block.startLine > 1 ? doc.line(block.startLine - 1).text : "";
    const below = block.endLine < doc.lines ? doc.line(block.endLine + 1).text : "";
    const sealAbove = needsProtectedSeam(above, shiftedLines[0]);
    const sealBelow = needsProtectedSeam(
      shiftedLines[shiftedLines.length - 1],
      below
    );
    if (sealAbove) shifted = "\n" + shifted;
    if (sealBelow) shifted += "\n";
    view.dispatch({
      changes: {
        from,
        to,
        insert: shifted,
      },
      userEvent: "move.block",
    });
    return block.startLine + (sealAbove ? 1 : 0);
  }

  const { from, to } = protectedBlockRemovalRange(doc, block);
  let text = doc.sliceString(doc.line(block.startLine).from, doc.line(block.endLine).to);
  // Tabs plus a partial content-column remainder (for example "\t  >")
  // produce unstable Live Preview widgets. Structural multi-line blocks use
  // exact spaces when moved; ordinary text/list lines still honor the vault.
  const structural = text
    .split("\n")
    .some((line) => RE_QUOTE.test(line) || RE_FENCE.test(line) || RE_TABLE.test(line));
  text = reindentBlock(
    text,
    targetIndent - baseIndent,
    structural ? { ...unit, useTab: false } : unit
  );

  // Blank-line sealing at the destination seams, so a drop never changes
  // the meaning of its neighbors. Above: a table or divider directly under
  // a text line would not render (a divider even turns that line into a
  // setext heading); a quote dropped against a quote merges into one
  // callout; a paragraph dropped directly under a quote, list item, or
  // paragraph is absorbed into it. Below: the dropped block would swallow
  // a following paragraph-ish line the same way.
  const movedLines = text.split("\n");
  const firstMoved = movedLines[0];
  const lastMoved = movedLines[movedLines.length - 1];
  let prev = targetLine - 1;
  if (prev >= block.startLine && prev <= block.endLine) prev = block.startLine - 1;
  const prevText = prev >= 1 && prev <= doc.lines ? doc.line(prev).text : "";
  const sealAbove = needsProtectedSeam(prevText, firstMoved);
  if (sealAbove) text = "\n" + text;
  const nextText = targetLine <= doc.lines ? doc.line(targetLine).text : "";
  const sealBelow = needsProtectedSeam(lastMoved, nextText);
  if (sealBelow) text += "\n";

  let insertPos: number;
  let insert: string;
  let blockOffset: number;
  if (targetLine > doc.lines) {
    insertPos = doc.length;
    insert = "\n" + text;
    blockOffset = 1 + (sealAbove ? 1 : 0);
  } else {
    insertPos = doc.line(targetLine).from;
    insert = text + "\n";
    blockOffset = sealAbove ? 1 : 0;
  }

  view.dispatch({
    changes: [
      { from, to },
      { from: insertPos, insert },
    ],
    userEvent: "move.block",
  });
  // Changes use original-document coordinates. Account for a source removal
  // before a downward insertion, then return the actual first line so
  // keyboard moves can keep the cursor on the block rather than its seam.
  const mappedInsertPos = insertPos - (to <= insertPos ? to - from : 0);
  const startPos = Math.max(
    0,
    Math.min(view.state.doc.length, mappedInsertPos + blockOffset)
  );
  return view.state.doc.lineAt(startPos).number;
}

/** First line of the block preceding this one (for keyboard moves). */
export function findPrevBlockStart(
  doc: Text,
  fences: FenceRange[],
  block: BlockRange
): number | null {
  for (let n = block.startLine - 1; n >= 1; n--) {
    if (RE_BLANK.test(doc.line(n).text) && !fenceAt(fences, n)) continue;
    const b = getBlockRange(doc, n, fences);
    return b ? b.startLine : n;
  }
  return null;
}

/** The block following this one (for keyboard moves). */
export function findNextBlock(
  doc: Text,
  fences: FenceRange[],
  block: BlockRange
): BlockRange | null {
  for (let n = block.endLine + 1; n <= doc.lines; n++) {
    if (RE_BLANK.test(doc.line(n).text) && !fenceAt(fences, n)) continue;
    return getBlockRange(doc, n, fences);
  }
  return null;
}

const RE_LINE_PREFIX = /^(#{1,6}\s|>\s?|(?:[-*+]|\d+[.)])\s(?:\[.\]\s)?)/;

/** Swap a line's block prefix (heading/list/quote/task) for a new one. */
export function applyLinePrefix(lineText: string, prefix: string): string {
  const ws = lineText.match(/^\s*/)?.[0] ?? "";
  let rest = lineText.slice(ws.length);
  // Strip nested prefixes like "> [!note]" or "- [ ]" one layer at a time.
  for (let i = 0; i < 3; i++) {
    const m = rest.match(RE_LINE_PREFIX);
    if (!m) break;
    rest = rest.slice(m[0].length);
    if (prefix.startsWith(m[0])) break;
  }
  return ws + prefix + rest;
}

/* ------------------------------------------------------------------ */
/* Table model (parse / format / edit)                                 */
/* ------------------------------------------------------------------ */

export const RE_TABLE = /^\s*\|/;
const RE_DELIM_ROW = /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/;

export function isDelimRow(line: string): boolean {
  return RE_DELIM_ROW.test(line);
}

/** The table block around lineNo: contiguous "|" rows outside fences. */
export function getTableRange(
  doc: Text,
  lineNo: number,
  fences: FenceRange[]
): BlockRange | null {
  if (fenceAt(fences, lineNo) || !RE_TABLE.test(doc.line(lineNo).text)) return null;
  let start = lineNo;
  let end = lineNo;
  while (
    start > 1 &&
    !fenceAt(fences, start - 1) &&
    RE_TABLE.test(doc.line(start - 1).text)
  )
    start--;
  while (
    end < doc.lines &&
    !fenceAt(fences, end + 1) &&
    RE_TABLE.test(doc.line(end + 1).text)
  )
    end++;
  return { startLine: start, endLine: end };
}

/** Positions of unescaped "|" in a row line. */
export function pipePositions(line: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") {
      i++;
      continue;
    }
    if (line[i] === "|") out.push(i);
  }
  return out;
}

/** Trimmed cell texts of a row (surrounding pipes dropped, "\|" kept). */
export function parseRow(line: string): string[] {
  const pipes = pipePositions(line);
  if (pipes.length === 0) return [line.trim()];
  const cells: string[] = [];
  for (let i = 0; i < pipes.length - 1; i++) {
    cells.push(line.slice(pipes[i] + 1, pipes[i + 1]).trim());
  }
  // A row typed without its closing pipe still has a last cell.
  const tail = line.slice(pipes[pipes.length - 1] + 1).trim();
  if (tail) cells.push(tail);
  return cells;
}

/** Rendered width of cell text: CJK and fullwidth characters occupy two
 *  columns, so mixed Chinese/English tables still align in the editor.
 *  HTML tags (color markers, inline spans) render invisibly — skip them. */
export function displayWidth(s: string): number {
  s = s.replace(/<[^>]*>/g, "");
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    w +=
      (c >= 0x1100 && c <= 0x115f) || // Hangul Jamo
      (c >= 0x2e80 && c <= 0xa4cf) || // CJK radicals … Yi syllables
      (c >= 0xac00 && c <= 0xd7a3) || // Hangul syllables
      (c >= 0xf900 && c <= 0xfaff) || // CJK compatibility ideographs
      (c >= 0xfe30 && c <= 0xfe4f) || // CJK compatibility forms
      (c >= 0xff00 && c <= 0xff60) || // fullwidth forms
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x20000 && c <= 0x3fffd) // CJK extensions B+
        ? 2
        : 1;
  }
  return w;
}

/** Pretty-print a table: pad every column to its widest cell (CJK-aware)
 *  and rebuild the delimiter row, preserving alignment colons. */
export function formatTable(text: string): string {
  const lines = text.split("\n");
  const indent = lines[0].match(/^\s*/)?.[0] ?? "";
  const rows = lines.map(parseRow);
  const delims = lines.map(isDelimRow);
  const nCols = Math.max(...rows.map((r) => r.length));
  const widths: number[] = [];
  for (let c = 0; c < nCols; c++) {
    let w = 3;
    rows.forEach((r, i) => {
      if (!delims[i]) w = Math.max(w, displayWidth(r[c] ?? ""));
    });
    widths.push(w);
  }
  return lines
    .map((_, i) => {
      const cells = widths.map((w, c) => {
        if (delims[i]) {
          const cell = rows[i][c] ?? "---";
          const left = cell.startsWith(":");
          const right = cell.endsWith(":");
          const dashes = "-".repeat(Math.max(1, w - (left ? 1 : 0) - (right ? 1 : 0)));
          return " " + (left ? ":" : "") + dashes + (right ? ":" : "") + " ";
        }
        const cell = rows[i][c] ?? "";
        return " " + cell + " ".repeat(w - displayWidth(cell)) + " ";
      });
      return indent + "|" + cells.join("|") + "|";
    })
    .join("\n");
}

/** A blank row with n columns: "|   |   |". */
export function emptyRow(n: number, indent = ""): string {
  return indent + "|" + Array(n).fill("   ").join("|") + "|";
}

/** Markdown skeleton for a rendered `rows` × `cols` table. The delimiter
 * row is structural and does not count toward the rendered row total. */
export function buildTableTemplate(rows = 3, cols = 3): string {
  rows = Math.max(1, Math.min(20, Math.floor(rows) || 1));
  cols = Math.max(1, Math.min(20, Math.floor(cols) || 1));
  const cells = Array(cols).fill("     ");
  const header = [...cells];
  header[0] = " ‸    ";
  const line = (values: string[]) => `|${values.join("|")}|`;
  const out = [line(header), line(Array(cols).fill(" --- "))];
  for (let row = 1; row < rows; row++) out.push(line(cells));
  return out.join("\n");
}

/** Append an empty row and re-align the whole table. */
export function tableAddRow(text: string): string {
  return tableInsertRow(text, text.split("\n").length - 1, "below");
}

/** Insert an empty body row immediately below the header delimiter. */
export function tableAddRowTop(text: string): string {
  return tableInsertRow(text, 0, "below");
}

/** Append an empty column on the right and re-align the whole table. */
export function tableAddColumn(text: string): string {
  const out = text.split("\n").map((l) => {
    const body = l.replace(/\s*$/, "");
    const closed = body.endsWith("|") ? body : body + " |";
    return closed + (isDelimRow(l) ? " --- |" : "   |");
  });
  return formatTable(out.join("\n"));
}

/** A table as parsed rows (cells + delimiter flag), padded to a rectangle. */
interface ParsedTable {
  indent: string;
  rows: { delim: boolean; cells: string[] }[];
  nCols: number;
}

function parseTable(text: string): ParsedTable {
  const lines = text.split("\n");
  const indent = lines[0].match(/^\s*/)?.[0] ?? "";
  const rows = lines.map((l) => ({ delim: isDelimRow(l), cells: parseRow(l) }));
  const nCols = Math.max(1, ...rows.map((r) => r.cells.length));
  for (const r of rows) while (r.cells.length < nCols) r.cells.push(r.delim ? "---" : "");
  return { indent, rows, nCols };
}

/** Reassemble parsed rows into aligned markdown. */
function rebuildTable({ indent, rows }: ParsedTable): string {
  const raw = rows
    .map((r) => indent + "|" + r.cells.map((c) => ` ${c} `).join("|") + "|")
    .join("\n");
  return formatTable(raw);
}

/** Index of the delimiter row, or -1 for a header-only fragment. */
function delimIndex(rows: { delim: boolean }[]): number {
  return rows.findIndex((r) => r.delim);
}

/** Markdown row index at which an above/below insertion will land. Keeping
 * this separate makes cursor re-homing use exactly the same clamping rules
 * as the edit itself (especially when invoked from the header row). */
export function tableInsertRowIndex(
  text: string,
  row: number,
  where: "above" | "below"
): number {
  const tbl = parseTable(text);
  const d = delimIndex(tbl.rows);
  const minBody = d < 0 ? 2 : d + 1;
  // Synthesizing a missing delimiter shifts every pre-existing row after
  // the header down by one before the relative insertion is calculated.
  const mappedRow = d < 0 && row >= 1 ? row + 1 : row;
  const requested = where === "below" ? mappedRow + 1 : mappedRow;
  const finalLength = tbl.rows.length + (d < 0 ? 1 : 0);
  return Math.max(minBody, Math.min(requested, finalLength));
}

/** Insert a blank row above/below `row`, never between header and delimiter. */
export function tableInsertRow(text: string, row: number, where: "above" | "below"): string {
  const tbl = parseTable(text);
  const at = tableInsertRowIndex(text, row, where);
  if (delimIndex(tbl.rows) < 0) {
    tbl.rows.splice(1, 0, { delim: true, cells: Array(tbl.nCols).fill("---") });
  }
  tbl.rows.splice(at, 0, { delim: false, cells: Array(tbl.nCols).fill("") });
  return rebuildTable(tbl);
}

/** Delete a body row (header and delimiter are protected — no-op there). */
export function tableDeleteRow(text: string, row: number): string {
  const tbl = parseTable(text);
  const d = delimIndex(tbl.rows);
  if (row <= (d < 0 ? 0 : d) || row >= tbl.rows.length) return text;
  tbl.rows.splice(row, 1);
  return rebuildTable(tbl);
}

/** Insert a blank column left/right of `col`. */
export function tableInsertColumn(text: string, col: number, where: "left" | "right"): string {
  // The table tint marker is anchored to the first header cell. Moving a
  // column across that cell must move the marker too, rather than leaving a
  // stale marker in a later column that can no longer be recolored/cleared.
  const tableColor = tableBgColor(text);
  const tbl = parseTable(text.replace(RE_TBL_MARKER, ""));
  const at = Math.max(0, Math.min(where === "right" ? col + 1 : col, tbl.nCols));
  for (const r of tbl.rows) r.cells.splice(at, 0, r.delim ? "---" : "");
  return tableWithBg(rebuildTable(tbl), tableColor);
}

/** Delete a column (no-op on a single-column table). */
export function tableDeleteColumn(text: string, col: number): string {
  const tbl = parseTable(text);
  if (tbl.nCols <= 1) return text;
  const tableColor = tableBgColor(text);
  // Remove every old table marker before rebuilding, then restore exactly
  // one marker in the new first header cell.
  const clean = parseTable(text.replace(RE_TBL_MARKER, ""));
  const at = Math.max(0, Math.min(col, tbl.nCols - 1));
  for (const r of clean.rows) r.cells.splice(at, 1);
  return tableWithBg(rebuildTable(clean), tableColor);
}

/* ---------- Per-table / per-cell backgrounds ----------------------- */
/* Colors live in the markdown itself as class-only spans, so they      */
/* survive sync/copy and render in reading view: a cell's content is    */
/* wrapped in <span class="nf-cell-COLOR">…</span>, and a whole table   */
/* carries an invisible <span class="nf-tbl-COLOR"></span> marker in    */
/* its first header cell. styles.css turns the markers into cell / row  */
/* tints via :has().                                                    */

const RE_CELL_BG = /^<span class="nf-cell-[a-z]+">([\s\S]*)<\/span>$/;
const RE_CELL_BG_COLOR = /^<span class="nf-cell-([a-z]+)">/;
const RE_TBL_MARKER = /<span class="nf-tbl-[a-z]+"><\/span>[ \t]*/g;
const RE_TBL_COLOR = /<span class="nf-tbl-([a-z]+)"><\/span>/;

/** A whole-table marker shares the first header cell with its content but
 * is not part of that cell's background wrapper. Pull it out before reading
 * or replacing nf-cell-* so the two independent colors never nest/corrupt
 * each other, regardless of which one the user applied first. */
function splitTableMarkers(content: string): { markers: string; inner: string } {
  const markers: string[] = [];
  const inner = content
    .replace(RE_TBL_MARKER, (marker) => {
      markers.push(marker.trim());
      return "";
    })
    .trim();
  return { markers: markers.join(""), inner };
}

/** Stored background color of one cell, if present. */
export function cellBgColorAt(text: string, row: number, col: number): string | null {
  const lines = text.split("\n");
  if (row < 0 || row >= lines.length || isDelimRow(lines[row])) return null;
  const cell = parseRow(lines[row])[col] ?? "";
  return splitTableMarkers(cell).inner.match(RE_CELL_BG_COLOR)?.[1] ?? null;
}

/** Stored whole-table tint, if present. */
export function tableBgColor(text: string): string | null {
  return text.match(RE_TBL_COLOR)?.[1] ?? null;
}

/** Wrap/unwrap one cell's markdown in a background-color marker. */
export function cellWithBg(content: string, color: string | null): string {
  const parts = splitTableMarkers(content);
  const m = parts.inner.match(RE_CELL_BG);
  const inner = (m ? m[1] : parts.inner).trim();
  const wrapped = color ? `<span class="nf-cell-${color}">${inner}</span>` : inner;
  return parts.markers + wrapped;
}

/** Set/clear the background of one cell in table `text` (row = markdown
 *  line index within the table, col = cell index). */
export function setCellBgAt(
  text: string,
  row: number,
  col: number,
  color: string | null
): string {
  const lines = text.split("\n");
  if (row < 0 || row >= lines.length || isDelimRow(lines[row])) return text;
  const pipes = pipePositions(lines[row]);
  if (pipes.length < 2) return text;
  const c = Math.max(0, Math.min(col, pipes.length - 2));
  const content = lines[row].slice(pipes[c] + 1, pipes[c + 1]).trim();
  lines[row] =
    lines[row].slice(0, pipes[c]) +
    "| " +
    cellWithBg(content, color) +
    " " +
    lines[row].slice(pipes[c + 1]);
  return lines.join("\n");
}

/** Set/clear the whole table's tint: an invisible marker span in the
 *  first header cell drives table-scoped CSS. */
export function tableWithBg(text: string, color: string | null): string {
  // Normalize legacy/stale markers anywhere in the table before writing the
  // single canonical marker. This also repairs tables produced by older
  // column operations where the marker could drift out of the first cell.
  const lines = text.replace(RE_TBL_MARKER, "").split("\n");
  const i = lines.findIndex((l) => RE_TABLE.test(l) && !isDelimRow(l));
  if (i < 0) return text;
  const pipes = pipePositions(lines[i]);
  if (pipes.length < 2) return text;
  const content = lines[i]
    .slice(pipes[0] + 1, pipes[1])
    .trim()
    .replace(RE_TBL_MARKER, "");
  const marked = color ? `<span class="nf-tbl-${color}"></span>${content}` : content;
  lines[i] = lines[i].slice(0, pipes[0]) + "| " + marked + " " + lines[i].slice(pipes[1]);
  return lines.join("\n");
}

export type ColumnAlign = "left" | "center" | "right" | "none";

/** Explicit alignment stored in a column's delimiter cell. */
export function tableColumnAlignment(text: string, col: number): ColumnAlign {
  const tbl = parseTable(text);
  const d = delimIndex(tbl.rows);
  if (d < 0) return "none";
  const at = Math.max(0, Math.min(col, tbl.nCols - 1));
  const marker = tbl.rows[d].cells[at]?.trim() ?? "";
  const left = marker.startsWith(":");
  const right = marker.endsWith(":");
  return left && right ? "center" : right ? "right" : left ? "left" : "none";
}

/** Closest editable (non-delimiter) markdown row after a structural edit. */
export function nearestTableDataRow(text: string, preferred: number): number {
  const lines = text.split("\n");
  const rows = lines
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => !isDelimRow(line) && pipePositions(line).length >= 2)
    .map(({ i }) => i);
  if (rows.length === 0) return 0;
  return rows.reduce((best, row) =>
    Math.abs(row - preferred) < Math.abs(best - preferred) ? row : best
  );
}

/** Set a column's alignment via the delimiter row's colons; a header-only
 *  fragment gains a delimiter row so the alignment has somewhere to live. */
export function tableSetAlignment(text: string, col: number, align: ColumnAlign): string {
  const tbl = parseTable(text);
  const at = Math.max(0, Math.min(col, tbl.nCols - 1));
  const marker =
    align === "left" ? ":---" : align === "center" ? ":---:" : align === "right" ? "---:" : "---";
  let d = delimIndex(tbl.rows);
  if (d < 0) {
    tbl.rows.splice(1, 0, { delim: true, cells: Array(tbl.nCols).fill("---") });
    d = 1;
  }
  tbl.rows[d].cells[at] = marker;
  return rebuildTable(tbl);
}

/** Apply one alignment to every column. Used by the whole-table handle menu,
 * where there is deliberately no active row/column target. */
export function tableSetAllAlignment(text: string, align: ColumnAlign): string {
  const tableColor = tableBgColor(text);
  const tbl = parseTable(text.replace(RE_TBL_MARKER, ""));
  const marker =
    align === "left" ? ":---" : align === "center" ? ":---:" : align === "right" ? "---:" : "---";
  let d = delimIndex(tbl.rows);
  if (d < 0) {
    tbl.rows.splice(1, 0, { delim: true, cells: Array(tbl.nCols).fill("---") });
    d = 1;
  }
  tbl.rows[d].cells = Array(tbl.nCols).fill(marker);
  return tableWithBg(rebuildTable(tbl), tableColor);
}

const RE_TBL_MARKER_PREFIX = /^<span class="nf-tbl-[a-z]+"><\/span>[ \t]*/;
const RE_CELL_BG_PREFIX = /^<span class="nf-cell-[a-z]+">/;

/** Editable content-start position of cell c. Color markers are storage
 * wrappers, not text: navigation must land inside them so subsequent typing
 * keeps the table/cell tint intact. */
function cellStart(line: string, c: number): number {
  const pipes = pipePositions(line);
  const p = pipes[Math.max(0, Math.min(c, pipes.length - 2))];
  const base = p + (line[p + 1] === " " ? 2 : 1);
  let pos = base;
  while (line[pos] === " " || line[pos] === "\t") pos++;
  let rest = line.slice(pos);
  // Ordinary leading/placeholder spaces are editable content. Only cross
  // the extra whitespace when it actually introduces one of our markers.
  if (!RE_TBL_MARKER_PREFIX.test(rest) && !RE_CELL_BG_PREFIX.test(rest)) return base;
  let marker = rest.match(RE_TBL_MARKER_PREFIX);
  while (marker) {
    pos += marker[0].length;
    rest = line.slice(pos);
    marker = rest.match(RE_TBL_MARKER_PREFIX);
  }
  const cellWrapper = rest.match(RE_CELL_BG_PREFIX);
  if (cellWrapper) pos += cellWrapper[0].length;
  return pos;
}

/** Cell index at ch: how many pipes sit strictly before the cursor. */
function cellAt(line: string, ch: number): number {
  const pipes = pipePositions(line);
  return Math.max(0, Math.min(pipes.filter((p) => p < ch).length - 1, pipes.length - 2));
}

/**
 * Where Tab / Shift-Tab lands from (row, ch) inside table `lines`
 * (row is 0-based within the table). Skips the delimiter row; returns
 * "append" when tabbing forward out of the very last cell.
 */
export function tableNavigate(
  lines: string[],
  row: number,
  ch: number,
  dir: 1 | -1
): { row: number; ch: number } | "append" | null {
  const dataRows = lines
    .map((_, i) => i)
    .filter((i) => !isDelimRow(lines[i]) && pipePositions(lines[i]).length >= 2);
  if (dataRows.length === 0) return null;
  const cellCount = (i: number) => pipePositions(lines[i]).length - 1;

  let r = dataRows.indexOf(row);
  let c: number;
  if (r < 0) {
    // On the delimiter row: hop into the neighboring data row.
    if (dir === 1) {
      r = dataRows.findIndex((i) => i > row);
      if (r < 0) return "append";
      c = 0;
    } else {
      r = -1;
      for (let j = 0; j < dataRows.length; j++) if (dataRows[j] < row) r = j;
      if (r < 0) return null;
      c = cellCount(dataRows[r]) - 1;
    }
  } else {
    c = cellAt(lines[row], ch);
    if (dir === 1) {
      if (c + 1 < cellCount(row)) c++;
      else if (r + 1 < dataRows.length) {
        r++;
        c = 0;
      } else return "append";
    } else {
      if (c > 0) c--;
      else if (r > 0) {
        r--;
        c = cellCount(dataRows[r]) - 1;
      } else return null;
    }
  }
  const target = dataRows[r];
  return { row: target, ch: cellStart(lines[target], c) };
}

/** Enter inside a table: the same-column cell in the row below, skipping
 *  the delimiter row; "append" when there is no row below. */
export function tableRowBelow(
  lines: string[],
  row: number,
  ch: number
): { row: number; ch: number } | "append" {
  const c = cellAt(lines[row], ch);
  for (let i = row + 1; i < lines.length; i++) {
    if (isDelimRow(lines[i]) || pipePositions(lines[i]).length < 2) continue;
    return { row: i, ch: cellStart(lines[i], c) };
  }
  return "append";
}

/* ------------------------------------------------------------------ */
/* Table keymap (Tab / Shift-Tab / Enter cell navigation)              */
/*                                                                     */
/* Active only while the cursor sits on a raw "|" line — in Live       */
/* Preview a finished table is a rendered widget with Obsidian's own   */
/* table editor, so this covers source mode and tables mid-creation    */
/* (e.g. a lone "| a | b" header line, before it renders).             */
/* ------------------------------------------------------------------ */

interface TableCtx {
  doc: Text;
  range: BlockRange;
  lines: string[];
  row: number; // 0-based within the table
  ch: number;
  indent: string;
}

function makeTableKeymap(plugin: NotionFlowPlugin) {
  const context = (view: EditorView): TableCtx | null => {
    if (!plugin.settings.tableEditing) return null;
    const sel = view.state.selection.main;
    if (!sel.empty) return null;
    const doc = view.state.doc;
    const line = doc.lineAt(sel.head);
    if (!RE_TABLE.test(line.text)) return null;
    const range = getTableRange(doc, line.number, scanFences(doc));
    if (!range) return null;
    const lines: string[] = [];
    for (let n = range.startLine; n <= range.endLine; n++) lines.push(doc.line(n).text);
    return {
      doc,
      range,
      lines,
      row: line.number - range.startLine,
      ch: sel.head - line.from,
      indent: lines[0].match(/^\s*/)?.[0] ?? "",
    };
  };

  /** New empty row at the table's end; a lone header line also gets its
   *  delimiter row, so "| a | b" + Tab completes the table skeleton. */
  const appendRow = (view: EditorView, ctx: TableCtx) => {
    const { doc, range, lines, indent } = ctx;
    const nCols = Math.max(1, ...lines.map((l) => parseRow(l).length));
    const end = doc.line(range.endLine).to;
    const delim = lines.some(isDelimRow)
      ? ""
      : "\n" + indent + "|" + Array(nCols).fill(" --- ").join("|") + "|";
    const row = emptyRow(nCols, indent);
    view.dispatch({
      changes: { from: end, insert: delim + "\n" + row },
      selection: { anchor: end + delim.length + 1 + indent.length + 2 },
      userEvent: "input",
    });
  };

  const moveTo = (view: EditorView, ctx: TableCtx, res: { row: number; ch: number }) => {
    const line = ctx.doc.line(ctx.range.startLine + res.row);
    view.dispatch({ selection: { anchor: Math.min(line.from + res.ch, line.to) } });
  };

  const nav = (view: EditorView, dir: 1 | -1): boolean => {
    const ctx = context(view);
    if (!ctx) return false;
    const res = tableNavigate(ctx.lines, ctx.row, ctx.ch, dir);
    if (res === null) return dir === -1; // swallow Shift-Tab at the first cell
    if (res === "append") appendRow(view, ctx);
    else moveTo(view, ctx, res);
    return true;
  };

  const enter = (view: EditorView): boolean => {
    const ctx = context(view);
    if (!ctx) return false;
    const { doc, range, lines, row, ch } = ctx;
    if (isDelimRow(lines[row])) return false;
    // Enter on an empty last row leaves the table onto a fresh line below.
    if (
      row === lines.length - 1 &&
      row > 0 &&
      parseRow(lines[row]).every((c) => c === "")
    ) {
      const line = doc.line(range.startLine + row);
      view.dispatch({
        changes: { from: line.from, to: line.to },
        selection: { anchor: line.from },
        userEvent: "input",
      });
      return true;
    }
    const res = tableRowBelow(lines, row, ch);
    if (res === "append") appendRow(view, ctx);
    else moveTo(view, ctx, res);
    return true;
  };

  return Prec.high(
    keymap.of([
      { key: "Tab", run: (v) => nav(v, 1), shift: (v) => nav(v, -1) },
      { key: "Enter", run: enter },
    ])
  );
}

/* ------------------------------------------------------------------ */
/* Drag handle view plugin                                             */
/* ------------------------------------------------------------------ */

/** Measure each logical source line inside a pre-wrap DOM node. Ranges keep
 * wrapped lines at their real height; missing (usually empty) rows are
 * interpolated from measured neighbors and the element's CSS line-height. */
function sourceTextRows(
  source: HTMLElement,
  count: number,
  fallbackLineHeight: number
): Array<{ top: number; bottom: number }> | null {
  const owner = source.ownerDocument;
  const walker = owner.createTreeWalker(source, 4 /* SHOW_TEXT */);
  const nodes: Array<{ node: Node; length: number }> = [];
  let combined = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.textContent ?? "";
    nodes.push({ node, length: value.length });
    combined += value;
  }
  if (nodes.length === 0) return null;

  const pointAt = (rawOffset: number): { node: Node; offset: number } => {
    const offset = Math.max(0, Math.min(combined.length, rawOffset));
    let seen = 0;
    for (const entry of nodes) {
      if (offset <= seen + entry.length) {
        return { node: entry.node, offset: offset - seen };
      }
      seen += entry.length;
    }
    const last = nodes[nodes.length - 1];
    return { node: last.node, offset: last.length };
  };

  const starts = [0];
  for (let i = 0; i < combined.length; i++) {
    if (combined[i] === "\n") starts.push(i + 1);
  }
  const rows: Array<{ top: number; bottom: number } | null> = [];
  for (let i = 0; i < count; i++) {
    const start = starts[i] ?? combined.length;
    const end = Math.max(
      start,
      i + 1 < starts.length ? starts[i + 1] - 1 : combined.length
    );
    const a = pointAt(start);
    const b = pointAt(end);
    const range = owner.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    const fragments = Array.from(range.getClientRects()).filter((r) => r.height > 0);
    const collapsed = fragments.length === 0 ? range.getBoundingClientRect() : null;
    if (collapsed && collapsed.height > 0) fragments.push(collapsed);
    rows.push(
      fragments.length > 0
        ? {
            top: Math.min(...fragments.map((r) => r.top)),
            bottom: Math.max(...fragments.map((r) => r.bottom)),
          }
        : null
    );
  }

  const box = source.getBoundingClientRect();
  const cssLineHeight = Number.parseFloat(
    owner.defaultView?.getComputedStyle(source).lineHeight ?? ""
  );
  const lineHeight = Number.isFinite(cssLineHeight)
    ? cssLineHeight
    : fallbackLineHeight;
  let i = 0;
  while (i < rows.length) {
    if (rows[i]) {
      i++;
      continue;
    }
    const first = i;
    while (i < rows.length && !rows[i]) i++;
    const missing = i - first;
    const prev = first > 0 ? rows[first - 1]?.bottom ?? box.top : box.top;
    const next = i < rows.length ? rows[i]?.top ?? box.bottom : box.bottom;
    const available = next - prev;
    const step = available >= missing ? available / missing : lineHeight;
    const runTop =
      first === 0 && i < rows.length
        ? Math.max(box.top, next - step * missing)
        : prev;
    for (let j = 0; j < missing; j++) {
      const top = runTop + step * j;
      rows[first + j] = { top, bottom: top + step };
    }
  }
  return rows as Array<{ top: number; bottom: number }>;
}

/** Insert a correctly-indented empty block and open the slash suggester. */
export function insertBlockBelow(
  view: EditorView,
  block: BlockRange,
  openSlashMenu: boolean
): void {
  const doc = view.state.doc;
  const end = doc.line(block.endLine).to;
  const firstText = doc.line(block.startLine).text;
  const contentIndent = listContentIndent(firstText);
  const indent = contentIndent ?? effectiveBlockIndent(doc, block.startLine);
  // Spaces are deliberate: partial-tab prefixes are parsed inconsistently
  // by Live Preview for quote/callout widgets.
  const prefix = " ".repeat(indent);
  const separator = RE_BLANK.test(doc.line(block.endLine).text) ? "\n" : "\n\n";
  const insert = separator + prefix;
  view.dispatch({
    changes: { from: end, insert },
    selection: { anchor: end + insert.length },
    userEvent: "input",
  });
  view.focus();
  if (!openSlashMenu) return;
  const ownerWindow = view.dom.ownerDocument.defaultView ?? window;
  // Separate transaction: EditorSuggest observes this as typed input.
  ownerWindow.setTimeout(() => {
    const head = view.state.selection.main.head;
    view.dispatch({
      changes: { from: head, insert: "/" },
      selection: { anchor: head + 1 },
      userEvent: "input.type",
    });
  }, 0);
}

function makeDragHandlePlugin(plugin: NotionFlowPlugin) {
  return ViewPlugin.fromClass(
    class DragHandleView {
      view: EditorView;
      ownerDocument: Document;
      ownerWindow: Window;
      controls: HTMLElement;
      handle: HTMLElement;
      plus: HTMLElement;
      indicator: HTMLElement;
      highlight: HTMLElement;
      ghost: HTMLElement;
      hoverBlock: BlockRange | null = null;
      pendingDrag: { x: number; y: number; block: BlockRange } | null = null;
      dragging = false;
      dragBlock: BlockRange | null = null;
      dropLine = -1;
      dropIndent: number | undefined = undefined;
      dropCandidatesLine = -1;
      dropCandidates: number[] = [];
      fences: FenceRange[] = [];
      dragStartX = 0;
      dragBaseIndent = 0;
      visualIndentStep = 32;
      listIndentCache: number | null = null;
      lastX = 0;
      lastY = 0;
      scrollTimer: number | null = null;
      scrollSpeed = 0;
      handleKind: "block" | "table" = "block";

      onMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
      onScroll = () => this.hideHover();
      onLeave = (e: MouseEvent) => {
        if (this.dragging) return;
        const t = e.relatedTarget as HTMLElement | null;
        if (
          t &&
          (t === this.controls || this.controls.contains(t))
        )
          return;
        this.hideHover();
      };
      onDocMove = (e: MouseEvent) => this.handleDragMove(e);
      onDocUp = (e: MouseEvent) => this.handleDrop(e);
      onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        this.endDrag();
      };

      /** True for embedded editors (Live Preview table cells, canvas …):
       *  block UI belongs to the outer document editor only. */
      nested: boolean;

      constructor(view: EditorView) {
        this.view = view;
        this.ownerDocument = view.dom.ownerDocument;
        this.ownerWindow = this.ownerDocument.defaultView ?? window;
        this.nested = !!view.dom.parentElement?.closest(".cm-editor");
        this.fences = scanFences(view.state.doc);

        this.controls = this.ownerDocument.body.createDiv({
          cls: "nf-block-controls",
        });
        this.controls.style.display = "none";

        this.plus = this.controls.createEl("button", {
          cls: "clickable-icon nf-plus-btn",
          attr: { type: "button", "aria-label": t("Insert block below") },
        });
        setIcon(this.plus, "plus");
        this.plus.addEventListener("mousedown", (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
        });
        this.plus.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (this.hoverBlock) this.insertBelow(this.hoverBlock);
        });

        this.handle = this.controls.createEl("button", {
          cls: "clickable-icon nf-drag-handle",
          attr: { type: "button", "aria-label": t("Drag block") },
        });
        setIcon(this.handle, "grip-vertical");
        this.handle.addEventListener("mousedown", (e) => this.startDrag(e));
        this.handle.addEventListener("click", (e) => {
          // Pointer clicks are completed by the document-level mouseup
          // handler. A keyboard-generated button click has detail === 0.
          if (e.detail !== 0 || !this.hoverBlock) return;
          e.preventDefault();
          e.stopPropagation();
          const rect = this.handle.getBoundingClientRect();
          openBlockMenu(
            this.view,
            this.hoverBlock,
            this.fences,
            new MouseEvent("click", {
              clientX: rect.left + rect.width / 2,
              clientY: rect.bottom,
            }),
            plugin.settings.slashCommands
          );
        });

        // Notion-style: hovering the text only shows the buttons; the
        // block highlight appears when the pointer reaches the atomic
        // controls group, previewing exactly what a drag/menu will act on.
        this.controls.addEventListener("mouseenter", () => {
          if (this.hoverBlock && !this.dragging) this.showHighlight(this.hoverBlock);
        });
        this.controls.addEventListener("mouseleave", () => this.hideHover());

        this.indicator = this.ownerDocument.body.createDiv({ cls: "nf-drop-indicator" });
        this.indicator.style.display = "none";

        this.highlight = this.ownerDocument.body.createDiv({ cls: "nf-block-highlight" });
        this.highlight.style.display = "none";

        this.ghost = this.ownerDocument.body.createDiv({ cls: "nf-drag-ghost" });
        this.ghost.style.display = "none";

        if (!this.nested) {
          // Capture phase: Obsidian's table widget stops mouse events from
          // bubbling (it runs its own hover controls), so a bubble-phase
          // listener never fires over a rendered table.
          view.scrollDOM.addEventListener("mousemove", this.onMouseMove, true);
          view.scrollDOM.addEventListener("scroll", this.onScroll);
          view.scrollDOM.addEventListener("mouseleave", this.onLeave);
        }
      }

      /** Real visual rows for source text inside a pre-wrap widget. A source
       * line can wrap to several screen rows, so dividing total height by
       * line count sends hover/drag to the wrong Markdown line. */
      sourceRows(
        source: HTMLElement,
        count: number
      ): Array<{ top: number; bottom: number }> | null {
        return sourceTextRows(source, count, this.view.defaultLineHeight);
      }

      /** Source span and row geometry represented by an embed widget. */
      widgetInfo(widget: HTMLElement): {
        from: number;
        to: number;
        startLine: number;
        endLine: number;
        rect: DOMRect;
        sourceRows: Array<{ top: number; bottom: number }> | null;
      } | null {
        try {
          const mapped = this.view.posAtDOM(widget, 0);
          const block = this.view.lineBlockAt(mapped);
          const doc = this.view.state.doc;
          const from = block.from;
          const to = Math.max(from, Math.min(doc.length, block.to));
          const startLine = doc.lineAt(from).number;
          const endLine = doc.lineAt(Math.max(from, to > from ? to - 1 : to)).number;
          // Only an unrendered Callout widget exposes source rows matching
          // its full Markdown span. A rendered code widget also contains
          // <pre><code>, but omits its fence rows, so it must use the widget
          // geometry rather than being mistaken for a source editor.
          const renderedWidget = !!widget.querySelector(".callout") ||
            widget.classList.contains("cm-preview-code-block");
          const source = renderedWidget
            ? null
            : widget.querySelector<HTMLElement>("pre code") ??
              widget.querySelector<HTMLElement>("pre");
          const rows = Math.max(1, endLine - startLine + 1);
          return {
            from,
            to,
            startLine,
            endLine,
            rect: widget.getBoundingClientRect(),
            sourceRows: source ? this.sourceRows(source, rows) : null,
          };
        } catch {
          return null;
        }
      }

      widgetForPos(pos: number): { element: HTMLElement; info: NonNullable<ReturnType<DragHandleView["widgetInfo"]>> } | null {
        const widgets = Array.from(
          this.view.contentDOM.querySelectorAll<HTMLElement>(":scope > .cm-embed-block")
        );
        for (const element of widgets) {
          const info = this.widgetInfo(element);
          const sourceEnd = info
            ? this.view.state.doc.line(info.endLine).to
            : -1;
          if (
            info &&
            isWidgetSourcePosition(pos, info.from, sourceEnd)
          ) return { element, info };
        }
        return null;
      }

      sourceRowRect(pos: number): { top: number; bottom: number } | null {
        const found = this.widgetForPos(pos);
        if (!found?.info.sourceRows) return null;
        const doc = this.view.state.doc;
        const line = doc.lineAt(Math.min(pos, doc.length)).number;
        const row = Math.max(
          0,
          Math.min(found.info.endLine - found.info.startLine, line - found.info.startLine)
        );
        return found.info.sourceRows[row] ?? null;
      }

      /** Resolve the theme's visual list step to real pixels. */
      listIndentPx(): number {
        if (this.listIndentCache != null) return this.listIndentCache;
        const probe = this.view.dom.ownerDocument.createElement("span");
        probe.style.cssText =
          "position:absolute;display:block;visibility:hidden;pointer-events:none;" +
          "box-sizing:content-box;margin:0;padding:0;border:0;height:0;" +
          "width:var(--list-indent);";
        this.view.contentDOM.appendChild(probe);
        const width = probe.getBoundingClientRect().width;
        probe.remove();
        this.listIndentCache =
          width > 0 ? width : Math.max(24, this.view.defaultCharacterWidth * 4);
        return this.listIndentCache;
      }

      blockVisualOffset(block: BlockRange): number {
        return (
          listNestingDepth(this.view.state.doc, block.startLine, this.fences) *
          this.listIndentPx()
        );
      }

      /** Position at (x, y). Over a rendered widget (table, callout) the
       *  caret-based lookup does NOT fail — it snaps to the nearest text
       *  line, i.e. the line ABOVE the widget (contenteditable=false), so
       *  the hover would target the wrong block. Whenever the pointer is
       *  actually over an embed block, resolve through layout geometry
       *  instead; the caret lookup only serves real text. */
      posAt(x: number, y: number): number | null {
        const el = this.view.dom.ownerDocument.elementFromPoint(x, y);
        const widget = el?.closest<HTMLElement>(".cm-embed-block") ?? null;
        if (widget && this.view.contentDOM.contains(widget)) {
          const info = this.widgetInfo(widget);
          if (info) {
            if (info.sourceRows) {
              let row = 0;
              let nearest = Infinity;
              for (let i = 0; i < info.sourceRows.length; i++) {
                const rect = info.sourceRows[i];
                const distance =
                  y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
                if (distance < nearest) {
                  nearest = distance;
                  row = i;
                }
              }
              return this.view.state.doc.line(info.startLine + row).from;
            }
            return info.from;
          }
        }
        const overWidget = !!widget;
        if (!overWidget) {
          const pos = this.view.posAtCoords({ x, y });
          // The caret lookup snaps to the nearest text line, which is the
          // line ABOVE when y is level with a widget but x is outside it —
          // hovering the left margin beside a callout would re-target the
          // previous block and yank the handle away just as the pointer
          // reaches it. Only trust the caret when its line really spans y.
          if (pos != null) {
            try {
              const lb = this.view.lineBlockAt(pos);
              const top = this.view.documentTop + lb.top;
              if (y >= top && y <= top + lb.height) return pos;
            } catch {
              return pos;
            }
          }
        }
        try {
          const lb = this.view.lineBlockAtHeight(y - this.view.documentTop);
          const top = this.view.documentTop + lb.top;
          return y >= top && y <= top + lb.height ? lb.from : null;
        } catch {
          return null;
        }
      }

      /** Screen Y of a position's line edge; layout geometry covers lines
       *  hidden inside rendered widgets, where coordsAtPos returns null. */
      posY(pos: number, edge: "top" | "bottom"): number | null {
        const sourceRow = this.sourceRowRect(pos);
        if (sourceRow) return edge === "top" ? sourceRow.top : sourceRow.bottom;
        const c = this.view.coordsAtPos(pos);
        if (c) return edge === "top" ? c.top : c.bottom;
        try {
          const lb = this.view.lineBlockAt(pos);
          return this.view.documentTop + (edge === "top" ? lb.top : lb.bottom);
        } catch {
          return null;
        }
      }

      /** Screen rect of a block (top of first line → bottom of last line). */
      blockRect(block: BlockRange): { top: number; bottom: number } | null {
        const doc = this.view.state.doc;
        const top = this.posY(doc.line(block.startLine).from, "top");
        const bottom = this.posY(doc.line(block.endLine).to, "bottom");
        if (top == null || bottom == null) return null;
        return { top, bottom };
      }

      showHighlight(block: BlockRange) {
        const rect = this.blockRect(block);
        if (!rect) {
          this.highlight.style.display = "none";
          return;
        }
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const doc = this.view.state.doc;
        const firstLine = doc.line(block.startLine);
        // A fence/quote block already paints its own layer; the depth
        // estimate can land inside the first characters, so align the
        // hover tint with the real painted edge instead.
        const structural =
          !!fenceAt(this.fences, block.startLine) || RE_QUOTE.test(firstLine.text);
        const painted = structural
          ? this.structuralPaintLeft(firstLine.from)
          : undefined;
        const xOff = Math.min(this.blockVisualOffset(block), contentRect.width / 2);
        const left = painted != null && painted >= contentRect.left - 20
          ? painted - 2
          : contentRect.left + xOff - 6;
        this.highlight.style.display = "block";
        this.highlight.style.left = `${left}px`;
        this.highlight.style.width = `${contentRect.right + 6 - left}px`;
        this.highlight.style.top = `${rect.top - 2}px`;
        this.highlight.style.height = `${rect.bottom - rect.top + 4}px`;
      }

      setHandleKind(kind: "block" | "table") {
        if (kind === this.handleKind) return;
        this.handleKind = kind;
        const table = kind === "table";
        this.handle.classList.toggle("is-table-block", table);
        this.handle.setAttribute("aria-label", t(table ? "Drag table" : "Drag block"));
        setIcon(this.handle, table ? "table" : "grip-vertical");
      }

      /** Left edge of the structural layer actually painted for `pos`.
       *  `--list-indent` is em-based in Obsidian, so a fenced code row can
       *  resolve it against a smaller monospace font than ordinary editor
       *  text. Measuring the pseudo-element keeps controls beside the real
       *  background/rule instead of recomputing that offset in another
       *  font context. */
      structuralPaintLeft(pos: number): number | undefined {
        try {
          const mapped = this.view.domAtPos(pos).node;
          const element = mapped.nodeType === 1
            ? mapped as Element
            : mapped.parentElement;
          const line = element?.closest<HTMLElement>(".cm-line");
          if (!line) return undefined;
          const rect = line.getBoundingClientRect();
          const inset = Number.parseFloat(
            this.ownerWindow.getComputedStyle(line, "::before").left
          );
          return Number.isFinite(rect.left) && Number.isFinite(inset)
            ? rect.left + inset
            : undefined;
        } catch {
          return undefined;
        }
      }

      /** Left edge of a fold target that actually overlaps this block row. */
      foldIndicatorLeft(
        pos: number,
        targetTop: number,
        targetBottom: number
      ): number | undefined {
        try {
          const mapped = this.view.domAtPos(pos).node;
          const element = mapped.nodeType === 1
            ? mapped as Element
            : mapped.parentElement;
          const line = element?.closest<HTMLElement>(".cm-line");
          if (!line) return undefined;
          const candidates = [
            line.querySelector<HTMLElement>(
              ".cm-fold-indicator .collapse-indicator"
            ),
            line.querySelector<HTMLElement>(".cm-fold-indicator"),
            line.querySelector<HTMLElement>(".collapse-indicator"),
          ];
          for (const candidate of candidates) {
            if (!candidate) continue;
            const rect = candidate.getBoundingClientRect();
            const overlapsRow = rect.bottom > targetTop + 1 &&
              rect.top < targetBottom - 1;
            if (
              overlapsRow &&
              rect.width > 0 &&
              rect.height > 0 &&
              Number.isFinite(rect.left)
            ) {
              return rect.left;
            }
          }
        } catch {
          // The line can be redrawn between DOM lookup and measurement.
        }
        return undefined;
      }

      handleMouseMove(e: MouseEvent) {
        if (this.dragging || this.pendingDrag) return;
        if (!plugin.settings.dragHandles) {
          this.hideHover();
          return;
        }
        const pos = this.posAt(e.clientX, e.clientY);
        if (pos == null) {
          this.hideHover();
          return;
        }
        const line = this.view.state.doc.lineAt(pos);
        // The whole block the mouse is in — this is exactly what a drag
        // would move, and exactly what gets highlighted.
        const block = getBlockRange(this.view.state.doc, line.number, this.fences);
        if (!block) {
          this.hideHover();
          return;
        }
        this.hoverBlock = block;
        const doc = this.view.state.doc;
        const pointed = this.view.dom.ownerDocument.elementFromPoint(e.clientX, e.clientY);
        const tableWidget =
          typeof (pointed as Element | null)?.closest === "function"
            ? (pointed as Element).closest(".cm-table-widget")
            : null;
        const renderedTable =
          RE_TABLE.test(doc.line(block.startLine).text) && tableWidget
            ? tableWidget.querySelector("table")
            : null;
        if (renderedTable) {
          // Obsidian already owns the row/column handles around a rendered
          // table. Put the whole-table control in their empty top-left
          // corner and hide our generic insert-block button, so the two
          // control systems no longer look duplicated or overlap.
          this.setHandleKind("table");
          const tableRect = renderedTable.getBoundingClientRect();
          const scrollRect = this.view.scrollDOM.getBoundingClientRect();
          const tableHandleLeft = Math.max(
            scrollRect.left + 4,
            Math.min(tableRect.left - 18, scrollRect.right - 26)
          );
          this.controls.classList.add("is-compact");
          this.controls.classList.remove("is-edge");
          this.controls.style.display = "flex";
          this.controls.style.left = `${tableHandleLeft}px`;
          this.controls.style.top = `${tableRect.top - 18}px`;
          this.handle.style.display = "flex";
          this.plus.style.display = "none";
          return;
        }
        this.setHandleKind("block");
        const firstLine = doc.line(block.startLine);
        const startPos = firstLine.from;
        const leadingChars = firstLine.text.match(/^\s*/)?.[0].length ?? 0;
        const visualPos = Math.min(firstLine.to, startPos + leadingChars);
        const sourceRow = this.sourceRowRect(startPos);
        const widgetAtStart = this.widgetForPos(startPos);
        // coordsAtPos(line.from) is the editor edge before literal Markdown
        // indentation. Quote/fence controls belong beside the visible block
        // marker/content column instead.
        const coords = sourceRow ? null : this.view.coordsAtPos(visualPos);
        const rectTop = coords ? null : this.posY(doc.line(block.startLine).from, "top");
        if (!coords && rectTop == null) {
          this.hideHover();
          return;
        }
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        // Vertically center on the first line (headings are taller); for a
        // widget-rendered block (table) sit at its top edge instead.
        const firstRow = sourceRow ??
          (widgetAtStart
            ? {
                top: widgetAtStart.info.rect.top,
                bottom: Math.min(
                  widgetAtStart.info.rect.bottom,
                  widgetAtStart.info.rect.top + this.view.defaultLineHeight
                ),
              }
            : coords
              ? { top: coords.top, bottom: coords.bottom }
              : {
                  top: rectTop as number,
                  bottom: (rectTop as number) + this.view.defaultLineHeight,
                });
        const rowTop = firstRow.top + (firstRow.bottom - firstRow.top) / 2 - 11;
        // Anchor to actual rendered geometry. contentDOM.left does not
        // include CodeMirror line padding, theme list spacing, or the CSS
        // margin on nested widgets, and made the pair disappear offscreen
        // in narrow panes. The logical offset remains a safe fallback for
        // hidden/unmeasurable rows.
        const xOff = Math.min(this.blockVisualOffset(block), contentRect.width / 2);
        const structuralSource = !widgetAtStart &&
          (!!fenceAt(this.fences, block.startLine) || RE_QUOTE.test(firstLine.text));
        const structuralLeft = structuralSource
          ? this.structuralPaintLeft(startPos) ?? contentRect.left + xOff - 16
          : undefined;
        const anchorX =
          widgetAtStart?.info.rect.left ??
          structuralLeft ??
          coords?.left ??
          contentRect.left + xOff;
        const scrollRect = this.view.scrollDOM.getBoundingClientRect();
        const placement = placeHandleControls(
          anchorX,
          scrollRect.left,
          scrollRect.right,
          this.foldIndicatorLeft(startPos, firstRow.top, firstRow.bottom)
        );
        this.controls.classList.toggle("is-compact", placement.compact);
        this.controls.classList.toggle("is-edge", placement.edge);
        this.controls.style.display = "flex";
        this.controls.style.left = `${placement.left}px`;
        this.controls.style.top = `${rowTop}px`;
        this.handle.style.display = "flex";
        this.plus.style.display = placement.compact ? "none" : "flex";
      }

      hideHover() {
        if (this.dragging || this.pendingDrag) return;
        this.controls.style.display = "none";
        this.highlight.style.display = "none";
        this.hoverBlock = null;
      }

      /** "+" button: open a fresh line below the block and pop the slash
       *  menu, ready to pick a block type. */
      insertBelow(block: BlockRange) {
        insertBlockBelow(this.view, block, plugin.settings.slashCommands);
        this.controls.style.display = "none";
        this.highlight.style.display = "none";
      }

      /** Mousedown arms a *pending* drag; movement > 4px turns it into a
       *  real drag, a clean mouseup opens the block menu instead. */
      startDrag(e: MouseEvent) {
        if (e.button !== 0 || !this.hoverBlock) return;
        e.preventDefault();
        e.stopPropagation();
        this.pendingDrag = { x: e.clientX, y: e.clientY, block: this.hoverBlock };
        // Capture phase: keep tracking even while the pointer crosses a
        // table widget that swallows bubbled mouse events.
        this.ownerDocument.addEventListener("mousemove", this.onDocMove, true);
        this.ownerDocument.addEventListener("mouseup", this.onDocUp, true);
        this.ownerDocument.addEventListener("keydown", this.onKeyDown, true);
      }

      beginRealDrag() {
        if (!this.pendingDrag) return;
        const pending = this.pendingDrag;
        this.dragBlock = pending.block;
        this.dragStartX = pending.x;
        this.dragBaseIndent = effectiveBlockIndent(
          this.view.state.doc,
          pending.block.startLine
        );
        this.visualIndentStep = this.listIndentPx();
        this.pendingDrag = null;
        this.dragging = true;
        this.dropLine = -1;
        this.dropIndent = undefined;
        this.dropCandidatesLine = -1;
        this.dropCandidates = [];
        this.ownerDocument.body.classList.add("nf-dragging");
        this.handle.classList.add("is-dragging");
        this.highlight.classList.add("is-dragging");
        this.showGhost(this.dragBlock);
      }

      showGhost(block: BlockRange) {
        const doc = this.view.state.doc;
        const raw = doc.sliceString(
          doc.line(block.startLine).from,
          doc.line(Math.min(block.endLine, block.startLine + 5)).to
        );
        const lines = block.endLine - block.startLine + 1;
        this.ghost.empty();
        this.ghost.createDiv({
          cls: "nf-drag-ghost-text",
          text: raw.trim() === "" ? t("Empty line") : raw.slice(0, 240),
        });
        if (lines > 6 || raw.length > 240) {
          this.ghost.createDiv({
            cls: "nf-drag-ghost-more",
            text: lines > 6 ? t("{n} lines").replace("{n}", String(lines)) : "…",
          });
        }
        this.ghost.style.display = "block";
      }

      handleDragMove(e: MouseEvent) {
        if (this.pendingDrag) {
          const dx = e.clientX - this.pendingDrag.x;
          const dy = e.clientY - this.pendingDrag.y;
          if (dx * dx + dy * dy < 16) return;
          this.beginRealDrag();
        }
        if (!this.dragging || !this.dragBlock) return;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.ghost.style.left = `${e.clientX + 14}px`;
        this.ghost.style.top = `${e.clientY + 10}px`;
        this.updateAutoScroll(e.clientY);
        this.updateDropTarget(e.clientX, e.clientY);
      }

      /** Keep scrolling while the pointer parks near an edge, retargeting
       *  the drop as content slides under the stationary mouse. */
      updateAutoScroll(clientY: number) {
        const rect = this.view.scrollDOM.getBoundingClientRect();
        const zone = 56;
        let speed = 0;
        if (clientY < rect.top + zone) {
          speed = -Math.min(24, Math.ceil((rect.top + zone - clientY) / 3));
        } else if (clientY > rect.bottom - zone) {
          speed = Math.min(24, Math.ceil((clientY - (rect.bottom - zone)) / 3));
        }
        this.scrollSpeed = speed;
        if (speed !== 0 && this.scrollTimer == null) {
          this.scrollTimer = this.ownerWindow.setInterval(() => {
            if (!this.dragging || this.scrollSpeed === 0) return;
            this.view.scrollDOM.scrollTop += this.scrollSpeed;
            this.updateDropTarget(this.lastX, this.lastY);
          }, 16);
        } else if (speed === 0) {
          this.stopAutoScroll();
        }
      }

      stopAutoScroll() {
        if (this.scrollTimer != null) {
          this.ownerWindow.clearInterval(this.scrollTimer);
          this.scrollTimer = null;
        }
        this.scrollSpeed = 0;
      }

      updateDropTarget(x: number, y: number) {
        if (!this.dragBlock) return;
        const pos = this.posAt(x, y);
        const doc = this.view.state.doc;
        let target: number;
        if (pos == null) {
          target = y < this.view.contentDOM.getBoundingClientRect().top ? 1 : doc.lines + 1;
        } else {
          const line = doc.lineAt(pos);
          const top = this.posY(line.from, "top");
          const bottom = this.posY(line.to, "bottom");
          const mid = top != null && bottom != null ? (top + bottom) / 2 : y;
          target = y < mid ? line.number : line.number + 1;
        }

        // Snap to block boundaries: never allow a drop that would split a
        // multi-line block (paragraph, fence, quote, list item + children).
        if (target >= 1 && target <= doc.lines) {
          const tb = getBlockRange(doc, target, this.fences);
          if (tb && tb.startLine < target && tb.endLine + 1 > target) {
            const rect = this.blockRect(tb);
            const mid = rect ? (rect.top + rect.bottom) / 2 : y;
            target = y < mid ? tb.startLine : tb.endLine + 1;
          }
        }
        this.dropLine = target;

        // Horizontal distance from the grab point chooses nesting. Keeping
        // X steady during an ordinary vertical reorder preserves the level.
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const cands = this.dropCandidatesLine === target
          ? this.dropCandidates
          : computeDropIndents(doc, this.fences, target, this.dragBlock);
        if (this.dropCandidatesLine !== target) {
          this.dropCandidatesLine = target;
          this.dropCandidates = cands;
        }
        const indent = pickIndentByDrag(
          cands,
          this.dragBaseIndent,
          x - this.dragStartX,
          this.visualIndentStep
        );
        this.dropIndent = indent;

        const visualLevel = Math.max(0, cands.indexOf(indent));
        const xOff = Math.min(visualLevel * this.visualIndentStep, contentRect.width / 2);
        let indicatorY: number;
        if (target > doc.lines) {
          indicatorY = this.posY(doc.length, "bottom") ?? contentRect.bottom;
        } else {
          indicatorY = this.posY(doc.line(target).from, "top") ?? contentRect.top;
        }
        this.indicator.style.display = "block";
        this.indicator.style.left = `${contentRect.left + xOff}px`;
        this.indicator.style.width = `${contentRect.width - xOff}px`;
        this.indicator.style.top = `${indicatorY - 2}px`;
        // The dashed outline marking the source block scrolls with content.
        this.showHighlight(this.dragBlock);
      }

      /** Tear down every drag affordance (shared by drop, Esc, destroy). */
      endDrag() {
        this.ownerDocument.removeEventListener("mousemove", this.onDocMove, true);
        this.ownerDocument.removeEventListener("mouseup", this.onDocUp, true);
        this.ownerDocument.removeEventListener("keydown", this.onKeyDown, true);
        this.stopAutoScroll();
        this.pendingDrag = null;
        this.dragging = false;
        this.dragBlock = null;
        this.dropLine = -1;
        this.dropIndent = undefined;
        this.dropCandidatesLine = -1;
        this.dropCandidates = [];
        this.dragStartX = 0;
        this.dragBaseIndent = 0;
        this.ownerDocument.body.classList.remove("nf-dragging");
        this.handle.classList.remove("is-dragging");
        this.highlight.classList.remove("is-dragging");
        this.indicator.style.display = "none";
        this.ghost.style.display = "none";
        this.controls.style.display = "none";
        this.highlight.style.display = "none";
        this.hoverBlock = null;
      }

      handleDrop(e: MouseEvent) {
        const pending = this.pendingDrag;
        const wasDragging = this.dragging;
        const block = this.dragBlock;
        const dropLine = this.dropLine;
        const dropIndent = this.dropIndent;
        this.endDrag();
        if (pending) {
          // Click without drag → block menu.
          openBlockMenu(
            this.view,
            pending.block,
            this.fences,
            e,
            plugin.settings.slashCommands
          );
        } else if (wasDragging && block && dropLine > 0) {
          moveBlock(
            this.view,
            block,
            dropLine,
            this.fences,
            dropIndent,
            vaultIndentUnit(plugin.app)
          );
        }
      }

      update(update: ViewUpdate) {
        if (update.geometryChanged) this.listIndentCache = null;
        if (update.geometryChanged || update.viewportChanged) this.hideHover();
        if (update.docChanged) {
          this.fences = scanFences(update.state.doc);
          this.dropCandidatesLine = -1;
          this.dropCandidates = [];
          // Hover geometry is stale after an edit; next mousemove re-shows.
          this.hideHover();
        }
      }

      destroy() {
        this.view.scrollDOM.removeEventListener("mousemove", this.onMouseMove, true);
        this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
        this.view.scrollDOM.removeEventListener("mouseleave", this.onLeave);
        this.ownerDocument.removeEventListener("mousemove", this.onDocMove, true);
        this.ownerDocument.removeEventListener("mouseup", this.onDocUp, true);
        this.ownerDocument.removeEventListener("keydown", this.onKeyDown, true);
        this.stopAutoScroll();
        if (this.dragging) this.ownerDocument.body.classList.remove("nf-dragging");
        this.controls.remove();
        this.indicator.remove();
        this.highlight.remove();
        this.ghost.remove();
      }
    }
  );
}

/* ------------------------------------------------------------------ */
/* Live Preview ordered-list markers                                  */
/*                                                                     */
/* CodeMirror displays the literal Markdown `1.` span rather than an   */
/* HTML <ol> marker. Mark decorations attach the Reading-view value so  */
/* CSS can show decimal / alphabetic / Roman phases on inactive lines  */
/* while the active line keeps its editable source marker.             */
/* ------------------------------------------------------------------ */

function makeListMarkerPlugin() {
  return ViewPlugin.fromClass(
    class ListMarkerView {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(update: ViewUpdate) {
        const treeChanged = syntaxTree(update.startState) !== syntaxTree(update.state);
        if (update.docChanged || treeChanged) {
          this.decorations = this.build(update.view);
        }
      }

      build(view: EditorView): DecorationSet {
        const ranges: Range<Decoration>[] = [];
        const tree = syntaxTree(view.state);
        const rendering = collectListRendering(tree, view.state.doc);
        for (const line of rendering.lines) {
          ranges.push(
            Decoration.line({
              attributes: { "data-nf-list-phase": String(line.phase) },
            }).range(line.from)
          );
        }
        for (const marker of rendering.markers) {
          ranges.push(
            Decoration.mark({
              class: "nf-ordered-list-marker",
              attributes: { "data-nf-marker": marker.label },
            }).range(marker.from, marker.to)
          );
        }
        return Decoration.set(ranges, true);
      }
    },
    { decorations: (view) => view.decorations }
  );
}

/* ------------------------------------------------------------------ */
/* Nested-block visual indent                                          */
/*                                                                     */
/* Source lines and rendered widgets are separate Live Preview layers. */
/* Annotate both with the same logical list depth so CSS can keep each  */
/* complete block (text, rule/background, and active source) aligned.   */
/* ------------------------------------------------------------------ */

function visualNestCss(depth: number): string {
  if (depth <= 1) return "var(--list-indent)";
  return `calc(${Array(depth).fill("var(--list-indent)").join(" + ")})`;
}

function makeNestedIndentPlugin(plugin: NotionFlowPlugin) {
  return ViewPlugin.fromClass(
    class NestedIndentView {
      view: EditorView;
      decorations: DecorationSet;
      fences: FenceRange[];
      frame: number | null = null;
      calloutRenders = new Map<
        HTMLElement,
        { component: Component; signature: string; container: HTMLElement }
      >();

      constructor(view: EditorView) {
        this.view = view;
        this.fences = scanFences(view.state.doc);
        this.decorations = this.build(view);
        this.scheduleWidgetSync();
      }

      update(update: ViewUpdate) {
        if (update.docChanged) this.fences = scanFences(update.state.doc);
        if (update.docChanged || update.viewportChanged || update.geometryChanged) {
          this.decorations = this.build(update.view);
        }
        // Selection changes swap rendered callouts for source-edit widgets
        // without necessarily changing the document or viewport.
        this.scheduleWidgetSync();
      }

      scheduleWidgetSync() {
        const win = this.view.dom.ownerDocument.defaultView ?? window;
        if (this.frame != null) win.cancelAnimationFrame(this.frame);
        this.frame = win.requestAnimationFrame(() => {
          this.frame = null;
          this.syncWidgets();
          this.syncLineLayers();
        });
      }

      lineElement(pos: number): HTMLElement | null {
        try {
          const mapped = this.view.domAtPos(pos).node;
          const element = mapped.nodeType === 1
            ? (mapped as Element)
            : mapped.parentElement;
          return element?.closest<HTMLElement>(".cm-line") ?? null;
        } catch {
          return null;
        }
      }

      /** Rendered x of the first content column at `from + columns`. */
      measureTextLeft(
        from: number,
        text: string,
        columns: number
      ): number | null {
        try {
          const chars = indentCharsForColumns(text, columns);
          const coords = this.view.coordsAtPos(from + chars, 1);
          return coords ? coords.left : null;
        } catch {
          return null;
        }
      }

      /** Painted-layer x for a nested fence: the outermost measured code
       * column across its body rows, so no row's text sticks out of the
       * background. */
      measureFenceTextLeft(fence: FenceRange): number | null {
        const doc = this.view.state.doc;
        let left: number | null = null;
        for (const n of fenceMeasureLines(doc, fence)) {
          const line = doc.line(n);
          const x = this.measureTextLeft(line.from, line.text, fence.indent);
          if (x != null && (left == null || x < left)) left = x;
        }
        return left;
      }

      /** The decoration's `--nf-nest` is an estimate: depth × --list-indent
       * ems resolved against each line's own font. The text column instead
       * comes from literal indent chunks (`.cm-indent` spans, tab stops,
       * monospace vs text font sizes), so the two drift apart — a
       * spaces-indented fence under a tab-indented list paints its
       * background past the first characters. After layout, replace the
       * estimate with the measured text position; background, quote rule,
       * hover highlight, and handle anchor then share one x. */
      syncLineLayers() {
        const view = this.view;
        const doc = view.state.doc;
        const fenceLefts = new Map<number, number | null>();
        for (const range of view.visibleRanges) {
          let pos = range.from;
          while (pos <= range.to) {
            const line = doc.lineAt(pos);
            pos = line.to + 1;
            const fence = fenceAt(this.fences, line.number);
            const quote = !fence && RE_QUOTE.test(line.text);
            if (!quote && !(fence && fence.indent > 0)) continue;
            const anchorLine = fence ? fence.startLine : line.number;
            if (listNestingDepth(doc, anchorLine, this.fences) === 0) continue;
            let left: number | null;
            if (fence) {
              if (!fenceLefts.has(fence.startLine)) {
                fenceLefts.set(
                  fence.startLine,
                  this.measureFenceTextLeft(fence)
                );
              }
              left = fenceLefts.get(fence.startLine) ?? null;
            } else {
              left = this.measureTextLeft(
                line.from,
                line.text,
                indentWidth(line.text)
              );
            }
            if (left == null) continue;
            const el = this.lineElement(line.from);
            if (!el) continue;
            const offset = left - el.getBoundingClientRect().left;
            if (Number.isFinite(offset) && offset >= 0) {
              el.style.setProperty("--nf-nest", `${offset}px`);
            }
          }
        }
      }

      releaseCalloutRender(widget: HTMLElement) {
        const rendered = this.calloutRenders.get(widget);
        if (!rendered) return;
        this.calloutRenders.delete(widget);
        plugin.removeChild(rendered.component);
      }

      renderNestedCallout(
        widget: HTMLElement,
        block: BlockRange,
        indent: number
      ) {
        const doc = this.view.state.doc;
        const source = Array.from(
          { length: block.endLine - block.startLine + 1 },
          (_, index) => stripIndentColumns(
            doc.line(block.startLine + index).text,
            indent
          )
        ).join("\n");
        if (!/^>\s*\[![^\]\r\n]+\]/.test(source)) return;

        const container = widget.querySelector<HTMLElement>(
          ":scope > .markdown-rendered"
        );
        if (!container) return;
        const signature = `${block.startLine}:${block.endLine}:${source}`;
        const existing = this.calloutRenders.get(widget);
        if (existing?.signature === signature) return;
        if (existing) this.releaseCalloutRender(widget);

        const originalHtml = container.innerHTML;
        const component = plugin.addChild(new Component());
        const record = { component, signature, container };
        this.calloutRenders.set(widget, record);
        container.replaceChildren();
        widget.classList.add("nf-repairing-callout");
        const sourcePath = plugin.app.workspace.getActiveFile()?.path ?? "";
        void MarkdownRenderer.render(
          plugin.app,
          source,
          container,
          sourcePath,
          component
        ).then(() => {
          if (this.calloutRenders.get(widget) !== record) return;
          if (!widget.isConnected || !container.querySelector(".callout")) {
            throw new Error("Nested Callout renderer produced no Callout");
          }
          widget.classList.remove("nf-repairing-callout");
          widget.classList.add("nf-repaired-callout");
        }).catch(() => {
          if (this.calloutRenders.get(widget) !== record) return;
          this.calloutRenders.delete(widget);
          plugin.removeChild(component);
          if (widget.isConnected) container.innerHTML = originalHtml;
          widget.classList.remove(
            "nf-repairing-callout",
            "nf-repaired-callout"
          );
        });
      }

      syncWidgets() {
        const content = this.view.contentDOM;
        for (const widget of this.calloutRenders.keys()) {
          if (!widget.isConnected || !content.contains(widget)) {
            this.releaseCalloutRender(widget);
          }
        }
        for (const widget of Array.from(
          content.querySelectorAll<HTMLElement>(
            ":scope > .cm-embed-block.nf-nested-widget, :scope > .cm-embed-block.nf-mixed-widget"
          )
        )) {
          widget.classList.remove(
            "nf-nested-widget",
            "nf-mixed-widget"
          );
          widget.style.removeProperty("--nf-nest");
          widget.style.removeProperty("--nf-mixed-cut");
        }
        const doc = this.view.state.doc;
        for (const widget of Array.from(
          content.querySelectorAll<HTMLElement>(
            ":scope > .cm-embed-block.cm-callout, " +
              ":scope > .cm-embed-block.cm-preview-code-block"
          )
        )) {
          try {
            const pos = this.view.posAtDOM(widget, 0);
            const layout = this.view.lineBlockAt(pos);
            const startLine = doc.lineAt(layout.from).number;
            const endLine = doc.lineAt(
              Math.max(layout.from, layout.to > layout.from ? layout.to - 1 : layout.to)
            ).number;
            const isCallout = widget.classList.contains("cm-callout");
            const source = isCallout && !widget.querySelector(".callout")
              ? widget.querySelector<HTMLElement>("pre code") ??
                widget.querySelector<HTMLElement>("pre")
              : null;
            const fence = fenceAt(this.fences, startLine);
            if (!isCallout && !fence) continue;
            const primary = getBlockRange(doc, startLine, this.fences);
            const mixed = !!source && !!primary && primary.endLine < endLine;
            const depth = fence
              ? listNestingDepth(doc, fence.startLine, this.fences)
              : mixed
                ? (() => {
                    let shallowest = Infinity;
                    for (let n = startLine; n <= endLine; n++) {
                      shallowest = Math.min(
                        shallowest,
                        listNestingDepth(doc, n, this.fences)
                      );
                      if (shallowest === 0) break;
                    }
                    return Number.isFinite(shallowest) ? shallowest : 0;
                  })()
                : listNestingDepth(doc, startLine, this.fences);

            if (isCallout && source && primary && !mixed && depth > 0) {
              this.renderNestedCallout(
                widget,
                primary,
                indentWidth(doc.line(primary.startLine).text)
              );
            }

            if (mixed && source && primary) {
              widget.classList.add("nf-mixed-widget");
              const rows = sourceTextRows(
                source,
                endLine - startLine + 1,
                this.view.defaultLineHeight
              );
              const lastPrimaryRow = primary.endLine - startLine;
              const pre = source.closest<HTMLElement>("pre") ?? source;
              const row = rows?.[lastPrimaryRow];
              if (row) {
                const cut = Math.max(0, row.bottom - pre.getBoundingClientRect().top);
                widget.style.setProperty("--nf-mixed-cut", `${cut}px`);
              }
            }
            if (depth > 0) {
              widget.classList.add("nf-nested-widget");
              widget.style.setProperty("--nf-nest", visualNestCss(depth));
            }
          } catch {
            // A widget can be replaced between animation scheduling and
            // measurement; the next view update annotates its replacement.
          }
        }
      }

      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const doc = view.state.doc;
        for (const range of view.visibleRanges) {
          let pos = range.from;
          while (pos <= range.to) {
            const line = doc.lineAt(pos);
            const f = fenceAt(this.fences, line.number);
            const quote = !f && RE_QUOTE.test(line.text);
            const code = !!f && f.indent > 0;
            // A fence's body may contain empty or deliberately unindented
            // source lines. They still belong to the opener's list level,
            // so every painted code-background row uses the opener depth.
            const depth = quote
              ? listNestingDepth(doc, line.number, this.fences)
              : code
                ? listNestingDepth(doc, f.startLine, this.fences)
                : 0;
            if (depth > 0) {
              builder.add(
                line.from,
                line.from,
                Decoration.line({
                  attributes: {
                    class: quote
                      ? "nf-nested-block nf-nested-quote"
                      : "nf-nested-block",
                    style: `--nf-nest:${visualNestCss(depth)};`,
                  },
                })
              );
            }
            pos = line.to + 1;
          }
        }
        return builder.finish();
      }

      destroy() {
        const win = this.view.dom.ownerDocument.defaultView ?? window;
        if (this.frame != null) win.cancelAnimationFrame(this.frame);
        for (const widget of [...this.calloutRenders.keys()]) {
          this.releaseCalloutRender(widget);
        }
        for (const widget of Array.from(
          this.view.contentDOM.querySelectorAll<HTMLElement>(
            ":scope > .cm-embed-block.nf-nested-widget, :scope > .cm-embed-block.nf-mixed-widget"
          )
        )) {
          widget.classList.remove(
            "nf-nested-widget",
            "nf-mixed-widget"
          );
          widget.style.removeProperty("--nf-nest");
          widget.style.removeProperty("--nf-mixed-cut");
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
}

/* ------------------------------------------------------------------ */
/* Inline HTML formatting concealment                                 */
/*                                                                     */
/* The color tools write plain HTML (<span style="color:…">,           */
/* <mark style="background:…">, <span class="nf-cell-…">) so colors    */
/* survive sync and render everywhere. Underline uses the portable     */
/* <u> element for the same reason. But the moment the cursor           */
/* enters such a region, Live Preview reveals the raw tags — a wall    */
/* of markup around a few words. These decorations hide exactly the    */
/* plugin's own tag pairs and restyle the inner text directly, so      */
/* editing colored text looks the same as reading it. Selecting        */
/* across a tag reveals it (and the toolbar can always remove colors   */
/* without touching raw markup).                                       */
/* ------------------------------------------------------------------ */

/* Only the plugin's own exact shapes are matched, and style values are
 * restricted to a charset that cannot smuggle URLs or extra CSS
 * properties into the decoration (no ':', ';', '/' or quotes). */
const RE_NF_TAG =
  /<span style="color:([-\w(),.%# ]{1,64})">|<mark style="background:([-\w(),.%# ]{1,64});color:inherit">|<span class="nf-(?:cell|tbl)-[a-z]{1,12}">|<u>|<\/(?:span|mark|u)>/g;

export interface TagPair {
  open: { from: number; to: number };
  close: { from: number; to: number };
  /** Inline style re-applied to the inner text, or null (cell markers). */
  style: string | null;
}

/** Convert an offset measured in rendered/visible text back to its source
 * position while skipping concealed source ranges. */
export function sourceOffsetFromVisibleOffset(
  start: number,
  end: number,
  visibleOffset: number,
  hiddenRanges: readonly { from: number; to: number }[]
): number {
  let source = start;
  let remaining = Math.max(0, visibleOffset);
  const hidden = hiddenRanges
    .map((range) => ({
      from: Math.max(start, range.from),
      to: Math.min(end, range.to),
    }))
    .filter((range) => range.from < range.to)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  for (const range of hidden) {
    if (range.to <= source) continue;
    const visible = Math.max(0, range.from - source);
    if (remaining < visible || (remaining === visible && visible > 0)) {
      return Math.min(end, source + remaining);
    }
    remaining -= visible;
    source = range.to;
  }
  return Math.min(end, source + remaining);
}

/** All well-formed plugin color tag pairs in `text` (offsets into it). */
export function findColorTagPairs(text: string): TagPair[] {
  const pairs: TagPair[] = [];
  type Open = {
    from: number;
    to: number;
    el: "span" | "mark" | "u";
    style: string | null;
  };
  const stack: Open[] = [];
  RE_NF_TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_NF_TAG.exec(text))) {
    const from = m.index;
    const to = from + m[0].length;
    if (m[0].startsWith("</")) {
      const el = m[0].slice(2, -1) as Open["el"];
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].el !== el) continue;
        const open = stack.splice(i, 1)[0];
        pairs.push({
          open: { from: open.from, to: open.to },
          close: { from, to },
          style: open.style,
        });
        break;
      }
    } else {
      stack.push({
        from,
        to,
        el: m[0] === "<u>" ? "u" : m[0].startsWith("<mark") ? "mark" : "span",
        style:
          m[0] === "<u>"
            ? "text-decoration:underline"
            : m[1]
              ? `color:${m[1]}`
              : m[2]
                ? `background:${m[2]}`
                : null,
      });
    }
  }
  return pairs;
}

function makeConcealPlugin(plugin: NotionFlowPlugin) {
  return ViewPlugin.fromClass(
    class ConcealView {
      view: EditorView;
      decorations: DecorationSet = Decoration.none;
      /** Replace decorations only — the atomic ranges the cursor skips. */
      hidden: DecorationSet = Decoration.none;
      /** Concealed pairs (absolute positions) for the click handler. */
      pairs: { openFrom: number; openTo: number; closeFrom: number; closeTo: number }[] = [];

      mouseButtonDown = false;
      lastClick = { x: 0, y: 0, time: 0, detail: 0 };
      onMouseDown = () => {
        this.mouseButtonDown = true;
      };
      onMouseUp = () => {
        this.mouseButtonDown = false;
      };
      onClick = (e: MouseEvent) => {
        this.lastClick = { x: e.clientX, y: e.clientY, time: Date.now(), detail: e.detail };
      };

      /** Clicking Obsidian's rendered inline-HTML widget leaves (some
       *  ~150ms later) a native DOM selection covering the whole element
       *  while the editor selection stays put — the next keystroke would
       *  wipe the entire markup through the DOM observer. Watch the DOM
       *  selection and convert that stray full-element selection into an
       *  editor caret at the clicked character, so a click edits colored
       *  text exactly like plain text. Double-click keeps the selection
       *  (deliberately select the whole colored segment), and drags are
       *  never touched. */
      onSelChange = () => {
        if (this.mouseButtonDown || this.pairs.length === 0) return;
        const fresh = Date.now() - this.lastClick.time < 1200;
        if (fresh && this.lastClick.detail > 1) return;
        const dom = document.getSelection();
        if (!dom || dom.isCollapsed || dom.rangeCount === 0) return;
        const range = dom.getRangeAt(0);
        if (
          !this.view.dom.contains(range.startContainer) ||
          !this.view.dom.contains(range.endContainer)
        )
          return;
        let from: number;
        let to: number;
        try {
          from = this.view.posAtDOM(range.startContainer, range.startOffset);
          to = this.view.posAtDOM(range.endContainer, range.endOffset);
        } catch {
          return;
        }
        // Both endpoints inside ONE of this plugin's concealed pairs —
        // anything wider is a legitimate selection and stays.
        const pair = this.pairs.find(
          (p) => from >= p.openFrom && from <= p.closeTo && to >= p.openFrom && to <= p.closeTo
        );
        if (!pair) return;
        // Character-precise caret: the click offset inside the rendered
        // widget text mirrors the offset in the source inner text.
        let anchor = pair.closeFrom;
        const caret = fresh
          ? document.caretRangeFromPoint?.(this.lastClick.x, this.lastClick.y)
          : null;
        if (caret) {
          let root: Node | null =
            caret.startContainer instanceof Element
              ? caret.startContainer
              : caret.startContainer.parentElement;
          while (
            root instanceof Element &&
            root.parentElement &&
            !root.parentElement.classList.contains("cm-line")
          ) {
            root = root.parentElement;
          }
          if (root instanceof Element && root.contains(caret.startContainer)) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            let off = 0;
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
              if (n === caret.startContainer) {
                off += caret.startOffset;
                break;
              }
              off += n.textContent?.length ?? 0;
            }
            let markdownHidden: { from: number; to: number }[] = [];
            if (plugin.settings.concealMarkdown) {
              const groups = collectInlineSyntaxGroups(
                syntaxTree(this.view.state),
                this.view.state.doc,
                pair.openTo,
                pair.closeFrom
              );
              markdownHidden = groups
                .filter(
                  (group) =>
                    !isInlineSyntaxGroupBeingEdited(
                      group,
                      this.view.state.selection.ranges
                    )
                )
                .flatMap((group) => group.markers);
            }
            anchor = sourceOffsetFromVisibleOffset(
              pair.openTo,
              pair.closeFrom,
              off,
              markdownHidden
            );
          }
        }
        anchor = Math.min(Math.max(anchor, pair.openTo), pair.closeFrom);
        this.view.dispatch({ selection: { anchor } });
        this.view.focus();
      };

      constructor(view: EditorView) {
        this.view = view;
        this.build(view);
        view.dom.addEventListener("mousedown", this.onMouseDown, true);
        view.dom.addEventListener("click", this.onClick, true);
        document.addEventListener("mouseup", this.onMouseUp, true);
        document.addEventListener("selectionchange", this.onSelChange);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.build(update.view);
      }

      destroy() {
        this.view.dom.removeEventListener("mousedown", this.onMouseDown, true);
        this.view.dom.removeEventListener("click", this.onClick, true);
        document.removeEventListener("mouseup", this.onMouseUp, true);
        document.removeEventListener("selectionchange", this.onSelChange);
      }

      build(view: EditorView) {
        this.decorations = Decoration.none;
        this.hidden = Decoration.none;
        this.pairs = [];
        if (!plugin.settings.concealHtml) return;
        // Source mode shows source; conceal only in Live Preview (this
        // also covers editors embedded in Live Preview table cells).
        const mode = view.dom.closest(".markdown-source-view");
        if (mode && !mode.classList.contains("is-live-preview")) return;
        const marks: Range<Decoration>[] = [];
        const hide: Range<Decoration>[] = [];
        for (const range of view.visibleRanges) {
          const text = view.state.doc.sliceString(range.from, range.to);
          for (const pair of findColorTagPairs(text)) {
            const open = { from: range.from + pair.open.from, to: range.from + pair.open.to };
            const close = { from: range.from + pair.close.from, to: range.from + pair.close.to };
            hide.push(Decoration.replace({}).range(open.from, open.to));
            hide.push(Decoration.replace({}).range(close.from, close.to));
            if (pair.style && open.to < close.from) {
              marks.push(
                Decoration.mark({ attributes: { style: pair.style } }).range(open.to, close.from)
              );
            }
            this.pairs.push({
              openFrom: open.from,
              openTo: open.to,
              closeFrom: close.from,
              closeTo: close.to,
            });
          }
        }
        this.hidden = Decoration.set(hide, true);
        this.decorations = Decoration.set([...marks, ...hide], true);
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (p) =>
        EditorView.atomicRanges.of((view) => view.plugin(p)?.hidden ?? Decoration.none),
    }
  );
}

/* ------------------------------------------------------------------ */
/* Inline Markdown syntax concealment                                 */
/*                                                                     */
/* Use Obsidian's parsed Markdown tree instead of regular expressions: */
/* escaped markers, nested emphasis, and code spans must not be mistaken */
/* for ordinary source text. Hidden source ranges                         */
/* are atomic, so arrow keys and deletion never land inside an          */
/* invisible marker. Source mode always remains untouched.             */
/* ------------------------------------------------------------------ */

export interface InlineSyntaxGroup {
  from: number;
  to: number;
  markers: { from: number; to: number }[];
}

const INLINE_SYNTAX_MARKERS: Record<string, string> = {
  Emphasis: "EmphasisMark",
  StrongEmphasis: "EmphasisMark",
  Strikethrough: "StrikethroughMark",
  InlineCode: "CodeMark",
  Highlight: "HighlightMark",
};

function directChildren(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    children.push(child);
  }
  return children;
}

/** Parsed marker groups for the supported inline formats. Markdown links are
 * deliberately excluded so both their label and destination remain directly
 * editable in Live Preview. */
export function collectInlineSyntaxGroups(
  tree: Tree,
  source: Text,
  from = 0,
  to = tree.length
): InlineSyntaxGroup[] {
  const groups = new Map<string, InlineSyntaxGroup>();
  tree.iterate({
    from,
    to,
    enter(ref) {
      const node = ref.node;
      let markers: { from: number; to: number }[] = [];
      const markerName = INLINE_SYNTAX_MARKERS[node.name];
      if (markerName) {
        markers = directChildren(node)
          .filter((child) => child.name === markerName)
          .map((child) => ({ from: child.from, to: child.to }));
        // An incomplete format is editable source, not something to hide.
        if (markers.length < 2) return;
      } else {
        // Obsidian's HyperMD tree exposes formatting leaves directly under
        // Document rather than nesting them below StrongEmphasis/Link. Match
        // those stable name fragments, then verify the exact source token.
        const name = node.name;
        const text = source.sliceString(node.from, node.to);
        const flatMarker =
          (name.includes("formatting-strong") && (text === "**" || text === "__")) ||
          (name.includes("formatting-em") && (text === "*" || text === "_")) ||
          (name.includes("formatting-strikethrough") && text === "~~") ||
          (name.includes("formatting-code") &&
            name.includes("inline-code") &&
            /^`+$/.test(text)) ||
          (name.includes("formatting-highlight") && text === "==");
        if (flatMarker) {
          markers = [{ from: node.from, to: node.to }];
        } else {
          return;
        }
      }
      markers = markers.filter((marker) => marker.from < marker.to);
      if (markers.length === 0) return;
      groups.set(`${node.name}:${node.from}:${node.to}`, {
        from: node.from,
        to: node.to,
        markers,
      });
    },
  });
  return [...groups.values()].sort((a, b) => a.from - b.from || a.to - b.to);
}

/** Reveal a group only when the user is directly editing one of its hidden
 * ranges. A non-empty selection always keeps markers concealed, even when
 * CodeMirror expands its source endpoints across an atomic marker. */
export function isInlineSyntaxGroupBeingEdited(
  group: InlineSyntaxGroup,
  selections: readonly { from: number; to: number }[]
): boolean {
  return selections.some(
    (selection) =>
      selection.from === selection.to &&
      group.markers.some(
        (marker) =>
          selection.from > marker.from && selection.from < marker.to
      )
  );
}

export interface ConcealedBoundaryDeletePlan {
  from: number;
  to: number;
  anchor: number;
}

function graphemeBoundary(doc: Text, pos: number, direction: -1 | 1): number {
  if (direction < 0) {
    if (pos <= 0) return 0;
    const line = doc.lineAt(pos);
    return pos > line.from
      ? line.from + findClusterBreak(line.text, pos - line.from, false)
      : pos - 1; // The line break before this line.
  }
  if (pos >= doc.length) return doc.length;
  const line = doc.lineAt(pos);
  return pos < line.to
    ? line.from + findClusterBreak(line.text, pos - line.from, true)
    : pos + 1; // The line break after this line.
}

/** Plan a deletion at an atomic-conceal boundary. The concealed ranges are
 * skipped, then one adjacent visible grapheme is deleted. At the document
 * edge the key is deliberately swallowed instead of deleting source syntax. */
export function planConcealedBoundaryDelete(
  doc: Text,
  head: number,
  direction: -1 | 1,
  concealedRanges: readonly { from: number; to: number }[]
): ConcealedBoundaryDeletePlan | null {
  const sorted = concealedRanges
    .map((range) => ({
      from: Math.max(0, Math.min(doc.length, range.from)),
      to: Math.max(0, Math.min(doc.length, range.to)),
    }))
    .filter((range) => range.from < range.to)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const ranges: { from: number; to: number }[] = [];
  for (const range of sorted) {
    const previous = ranges[ranges.length - 1];
    if (previous && range.from < previous.to) {
      previous.to = Math.max(previous.to, range.to);
    } else {
      ranges.push({ ...range });
    }
  }
  let edge = head;
  let skipped = false;
  while (true) {
    let adjacent: { from: number; to: number } | undefined;
    if (direction < 0) {
      for (let i = ranges.length - 1; i >= 0; i--) {
        if (ranges[i].to === edge) {
          adjacent = ranges[i];
          break;
        }
      }
    } else {
      adjacent = ranges.find((range) => range.from === edge);
    }
    if (!adjacent) break;
    edge = direction < 0 ? adjacent.from : adjacent.to;
    skipped = true;
  }
  if (!skipped) return null;
  const target = graphemeBoundary(doc, edge, direction);
  if (target === edge) return { from: edge, to: edge, anchor: head };
  return direction < 0
    ? { from: target, to: edge, anchor: head - (edge - target) }
    : { from: edge, to: target, anchor: head };
}

function isLivePreviewEditor(view: EditorView): boolean {
  return (
    view.state.field(editorLivePreviewField, false) ||
    !!view.dom.closest(".markdown-source-view.is-live-preview")
  );
}

function activeConcealedRanges(
  view: EditorView,
  plugin: NotionFlowPlugin
): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  if (view.visibleRanges.length === 0) return ranges;
  const first = view.visibleRanges[0];
  const last = view.visibleRanges[view.visibleRanges.length - 1];
  const selections = view.state.selection.ranges;
  if (plugin.settings.concealMarkdown) {
    for (const group of collectInlineSyntaxGroups(
      syntaxTree(view.state),
      view.state.doc,
      first.from,
      last.to
    )) {
      if (!isInlineSyntaxGroupBeingEdited(group, selections)) {
        ranges.push(...group.markers);
      }
    }
  }
  // HTML and Markdown markers can be directly adjacent, for example
  // <u>**text**</u>. Protect the union or deletion can cross one atomic
  // range only to remove the neighbouring hidden range.
  if (plugin.settings.concealHtml) {
    for (const visible of view.visibleRanges) {
      const text = view.state.doc.sliceString(visible.from, visible.to);
      for (const pair of findColorTagPairs(text)) {
        ranges.push(
          { from: visible.from + pair.open.from, to: visible.from + pair.open.to },
          { from: visible.from + pair.close.from, to: visible.from + pair.close.to }
        );
      }
    }
  }
  return ranges;
}

function makeMarkdownConcealPlugin(plugin: NotionFlowPlugin) {
  const concealView = ViewPlugin.fromClass(
    class MarkdownConcealView {
      decorations: DecorationSet = Decoration.none;
      hidden: DecorationSet = Decoration.none;

      constructor(view: EditorView) {
        this.build(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.build(update.view);
        }
      }

      build(view: EditorView) {
        this.decorations = Decoration.none;
        this.hidden = Decoration.none;
        if (!plugin.settings.concealMarkdown) return;
        if (!isLivePreviewEditor(view)) return;
        if (view.visibleRanges.length === 0) return;

        const first = view.visibleRanges[0];
        const last = view.visibleRanges[view.visibleRanges.length - 1];
        const groups = collectInlineSyntaxGroups(
          syntaxTree(view.state),
          view.state.doc,
          first.from,
          last.to
        );
        const selections = view.state.selection.ranges;
        const seen = new Set<string>();
        const hidden: Range<Decoration>[] = [];
        for (const group of groups) {
          if (isInlineSyntaxGroupBeingEdited(group, selections)) continue;
          for (const marker of group.markers) {
            const key = `${marker.from}:${marker.to}`;
            if (seen.has(key)) continue;
            seen.add(key);
            hidden.push(Decoration.replace({}).range(marker.from, marker.to));
          }
        }
        this.hidden = Decoration.set(hidden, true);
        this.decorations = this.hidden;
      }
    },
    {
      decorations: (view) => view.decorations,
      provide: (extension) =>
        EditorView.atomicRanges.of(
          (view) => view.plugin(extension)?.hidden ?? Decoration.none
        ),
    }
  );
  const protectBoundaryDelete = (view: EditorView, direction: -1 | 1): boolean => {
    if (
      (!plugin.settings.concealMarkdown && !plugin.settings.concealHtml) ||
      !isLivePreviewEditor(view)
    )
      return false;
    if (view.state.selection.ranges.some((range) => !range.empty)) return false;
    const concealed = activeConcealedRanges(view, plugin);
    const plans = view.state.selection.ranges.map((range) =>
      planConcealedBoundaryDelete(view.state.doc, range.head, direction, concealed)
    );
    if (!plans.some(Boolean)) return false;
    const spec = view.state.changeByRange((range) => {
      const protectedPlan = planConcealedBoundaryDelete(
        view.state.doc,
        range.head,
        direction,
        concealed
      );
      const target = protectedPlan
        ? null
        : graphemeBoundary(view.state.doc, range.head, direction);
      const plan =
        protectedPlan ??
        (direction < 0
          ? { from: target!, to: range.head, anchor: target! }
          : { from: range.head, to: target!, anchor: range.head });
      return plan.from === plan.to
        ? { range: EditorSelection.cursor(plan.anchor) }
        : {
            changes: { from: plan.from, to: plan.to },
            range: EditorSelection.cursor(plan.anchor),
          };
    });
    if (!spec.changes.empty) {
      view.dispatch({
        ...spec,
        scrollIntoView: true,
        userEvent: direction < 0 ? "delete.backward" : "delete.forward",
      });
    }
    return true;
  };
  return [
    concealView,
    Prec.highest(
      keymap.of([
        { key: "Backspace", run: (view) => protectBoundaryDelete(view, -1) },
        { key: "Delete", run: (view) => protectBoundaryDelete(view, 1) },
      ])
    ),
  ];
}

/* ------------------------------------------------------------------ */
/* Block menu (click the handle)                                       */
/* ------------------------------------------------------------------ */

const BLOCK_MENU_OPEN_CLASS = "nf-block-menu-open";
const BLOCK_MENU_OPEN_EVENT = "nf:block-menu-open";

function isBlockMenuTarget(target: EventTarget | null): boolean {
  const el = target as Element | null;
  return typeof el?.closest === "function" && !!el.closest(".nf-block-menu-anchor");
}

const TURN_INTO: { title: string; icon: string; prefix: string }[] = [
  { title: t("Text"), icon: "pilcrow", prefix: "" },
  { title: t("Heading 1"), icon: "heading-1", prefix: "# " },
  { title: t("Heading 2"), icon: "heading-2", prefix: "## " },
  { title: t("Heading 3"), icon: "heading-3", prefix: "### " },
  { title: t("Bulleted list"), icon: "list", prefix: "- " },
  { title: t("Numbered list"), icon: "list-ordered", prefix: "1. " },
  { title: t("To-do"), icon: "check-square", prefix: "- [ ] " },
  { title: t("Quote"), icon: "quote", prefix: "> " },
];

function openBlockMenu(
  view: EditorView,
  block: BlockRange,
  fences: FenceRange[],
  evt: MouseEvent,
  slashCommandsEnabled: boolean
) {
  const doc = view.state.doc;
  const blockText = doc.sliceString(
    doc.line(block.startLine).from,
    doc.line(block.endLine).to
  );
  const ownerDoc = view.dom.ownerDocument;
  const menuHost = ownerDoc.body.createDiv({ cls: "nf-block-menu-anchor" });
  const menu = new Menu()
    .setUseNativeMenu(false)
    .setParentElement(menuHost);

  // The table toolbar and the handle menu are alternative controls for the
  // same block. Broadcast before showing so every editor in the leaf hides
  // its toolbar, including the nested editor that owns a rendered cell.
  ownerDoc.body.classList.add(BLOCK_MENU_OPEN_CLASS);
  const OwnerEvent = ownerDoc.defaultView?.Event ?? Event;
  ownerDoc.dispatchEvent(new OwnerEvent(BLOCK_MENU_OPEN_EVENT));
  menu.onHide(() => {
    menuHost.remove();
    if (!ownerDoc.querySelector(".nf-block-menu-anchor")) {
      ownerDoc.body.classList.remove(BLOCK_MENU_OPEN_CLASS);
    }
  });

  const addLabel = (title: string) =>
    menu.addItem((item) => item.setTitle(t(title)).setIsLabel(true));

  const isFence = fenceAt(fences, block.startLine) != null;
  const isTable = !isFence && RE_TABLE.test(doc.line(block.startLine).text);
  const isMultiLineQuote =
    block.endLine > block.startLine && RE_QUOTE.test(doc.line(block.startLine).text);

  if (isTable) {
    addLabel("Table");
    const replaceTable = (make: (s: string) => string) =>
      view.dispatch({
        changes: {
          from: doc.line(block.startLine).from,
          to: doc.line(block.endLine).to,
          insert: make(blockText),
        },
        userEvent: "input",
      });
    menu.addItem((item) =>
      item
        .setTitle(t("Add row at top"))
        .setIcon("arrow-up-to-line")
        .onClick(() => replaceTable(tableAddRowTop))
    );
    menu.addItem((item) =>
      item
        .setTitle(t("Add row at bottom"))
        .setIcon("arrow-down-to-line")
        .onClick(() => replaceTable(tableAddRow))
    );
    menu.addItem((item) =>
      item
        .setTitle(t("Add column on left"))
        .setIcon("arrow-left-to-line")
        .onClick(() => replaceTable((text) => tableInsertColumn(text, 0, "left")))
    );
    menu.addItem((item) =>
      item
        .setTitle(t("Add column on right"))
        .setIcon("arrow-right-to-line")
        .onClick(() => replaceTable(tableAddColumn))
    );
    const tableSubmenu = (
      title: string,
      icon: string,
      populate: (submenu: Menu) => void
    ) =>
      menu.addItem((item) => {
        item.setTitle(t(title)).setIcon(icon);
        const withSub = item as unknown as { setSubmenu?: () => Menu };
        if (typeof withSub.setSubmenu === "function") populate(withSub.setSubmenu());
      });
    tableSubmenu("Table alignment", "align-horizontal-distribute-center", (submenu) => {
      const alignmentItems: { value: ColumnAlign; title: string; icon: string }[] = [
        { value: "none", title: "Default alignment", icon: "minus" },
        { value: "left", title: "Align left", icon: "align-left" },
        { value: "center", title: "Align center", icon: "align-center" },
        { value: "right", title: "Align right", icon: "align-right" },
      ];
      for (const alignment of alignmentItems) {
        submenu.addItem((item) =>
          item
            .setTitle(t(alignment.title))
            .setIcon(alignment.icon)
            .onClick(() => replaceTable((text) => tableSetAllAlignment(text, alignment.value)))
        );
      }
    });
    tableSubmenu("Table background", "paint-bucket", (submenu) => {
      const current = tableBgColor(blockText);
      for (const color of PALETTE_COLORS) {
        submenu.addItem((item) =>
          item
            .setTitle(t(COLOR_LABELS[color]))
            .setIcon("circle")
            .setChecked(current === color)
            .onClick(() => replaceTable((text) => tableWithBg(text, color)))
        );
      }
      submenu.addSeparator();
      submenu.addItem((item) =>
        item
          .setTitle(t("Remove color"))
          .setIcon("ban")
          .setChecked(current == null)
          .onClick(() => replaceTable((text) => tableWithBg(text, null)))
      );
    });
    menu.addItem((item) =>
      item
        .setTitle(t("Format table"))
        .setIcon("wand-2")
        .onClick(() => replaceTable(formatTable))
    );
    menu.addSeparator();
  }

  const calloutRepair = nestedCalloutRepair(doc, block.startLine, fences);
  if (calloutRepair) {
    menu.addItem((item) =>
      item
        .setTitle(t("Repair nested Callout"))
        .setIcon("wand-2")
        .onClick(() =>
          view.dispatch({
            changes: {
              from: calloutRepair.from,
              to: calloutRepair.to,
              insert: calloutRepair.insert,
            },
            userEvent: "input.repair-callout",
          })
        )
    );
    menu.addSeparator();
  }

  // Applying a one-line prefix to a multi-line quote/callout leaves all
  // remaining ">" lines behind and silently splits the block. Keep the
  // unsafe conversion out of that block's menu until it can be expressed
  // as a deliberate whole-block transform.
  if (!isFence && !isTable && !isMultiLineQuote) {
    addLabel("Turn into");
    for (const t of TURN_INTO) {
      menu.addItem((item) =>
        item
          .setTitle(t.title)
          .setIcon(t.icon)
          .onClick(() => {
            const line = doc.line(block.startLine);
            view.dispatch({
              changes: {
                from: line.from,
                to: line.to,
                insert: applyLinePrefix(line.text, t.prefix),
              },
              userEvent: "input.turninto",
            });
          })
      );
    }
    menu.addSeparator();
  }

  menu.addItem((item) =>
    item
      .setTitle(t("Insert block below"))
      .setIcon("plus")
      .onClick(() => insertBlockBelow(view, block, slashCommandsEnabled))
  );
  menu.addItem((item) =>
    item
      .setTitle(t("Duplicate"))
      .setIcon("copy-plus")
      .onClick(() => {
        const insertPos = doc.line(block.endLine).to;
        const lines = blockText.split("\n");
        const separator = needsProtectedSeam(lines[lines.length - 1], lines[0])
          ? "\n\n"
          : "\n";
        const nextText = block.endLine < doc.lines
          ? doc.line(block.endLine + 1).text
          : "";
        const suffix = needsProtectedSeam(lines[lines.length - 1], nextText)
          ? "\n"
          : "";
        view.dispatch({
          changes: { from: insertPos, insert: separator + blockText + suffix },
          userEvent: "input.duplicate",
        });
      })
  );
  menu.addItem((item) =>
    item
      .setTitle(t("Copy text"))
      .setIcon("clipboard-copy")
      .onClick(() => navigator.clipboard.writeText(blockText))
  );
  menu.addSeparator();
  menu.addItem((item) =>
    item
      .setTitle(t("Delete block"))
      .setIcon("trash-2")
      .setWarning(true)
      .onClick(() => {
        const { from, to } = protectedBlockRemovalRange(doc, block);
        view.dispatch({ changes: { from, to }, userEvent: "delete.block" });
      })
  );

  menu.showAtMouseEvent(evt);
}

/* ------------------------------------------------------------------ */
/* Floating format toolbar                                             */
/* ------------------------------------------------------------------ */

interface ToolbarAction {
  icon: string;
  tooltip: string;
  run: (view: EditorView) => void;
  /** Marker pair used to light the button up when already applied. */
  marker?: string;
  endMarker?: string;
  /** Custom active-state detection for formats that can wrap other markup. */
  isActive?: (state: EditorState) => boolean;
}

interface TableToolbarTarget {
  kind: "widget" | "source";
  view: EditorView;
  from: number;
  to: number;
  text: string;
  row: number;
  col: number;
}

/** How the current selection relates to a marker pair. */
export function getWrapState(
  state: EditorState,
  marker: string,
  endMarker?: string
): "inside" | "outside" | "none" {
  const end = endMarker ?? marker;
  const sel = state.selection.main;
  if (sel.empty) return "none";
  const doc = state.doc;
  const selected = doc.sliceString(sel.from, sel.to);

  if (
    selected.startsWith(marker) &&
    selected.endsWith(end) &&
    selected.length >= marker.length + end.length
  ) {
    return "inside";
  }

  const before = doc.sliceString(Math.max(0, sel.from - marker.length), sel.from);
  const after = doc.sliceString(sel.to, Math.min(doc.length, sel.to + end.length));
  if (before !== marker || after !== end) return "none";

  // For single-char emphasis markers ("*"), a surrounding run of exactly two
  // is BOLD, not italic — treat as unwrapped so toggling wraps (→ bold+italic).
  if (marker.length === 1) {
    const ch = marker[0];
    let rb = 0;
    for (let p = sel.from - 1; p >= 0 && doc.sliceString(p, p + 1) === ch; p--) rb++;
    let ra = 0;
    for (let p = sel.to; p < doc.length && doc.sliceString(p, p + 1) === ch; p++) ra++;
    if (rb === 2 && ra === 2) return "none";
  }
  return "outside";
}

export function toggleWrap(view: EditorView, marker: string, endMarker?: string) {
  const end = endMarker ?? marker;
  const sel = view.state.selection.main;
  if (sel.empty) return;
  const doc = view.state.doc;
  const state = getWrapState(view.state, marker, endMarker);

  if (state === "inside") {
    const selected = doc.sliceString(sel.from, sel.to);
    const inner = selected.slice(marker.length, selected.length - end.length);
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: inner },
      selection: { anchor: sel.from, head: sel.from + inner.length },
    });
    return;
  }

  if (state === "outside") {
    view.dispatch({
      changes: [
        { from: sel.from - marker.length, to: sel.from },
        { from: sel.to, to: sel.to + end.length },
      ],
      selection: {
        anchor: sel.from - marker.length,
        head: sel.to - marker.length,
      },
    });
    return;
  }

  view.dispatch({
    changes: [
      { from: sel.from, insert: marker },
      { from: sel.to, insert: end },
    ],
    selection: {
      anchor: sel.from + marker.length,
      head: sel.to + marker.length,
    },
  });
}

/** The smallest well-formed underline pair whose inner text contains the
 * current selection. Unlike a direct marker check, this also finds underline
 * around nested Markdown such as `<u>**text**</u>`. */
function enclosingUnderlinePair(state: EditorState): TagPair | null {
  const sel = state.selection.main;
  if (sel.empty) return null;
  const source = state.doc.toString();
  return (
    findColorTagPairs(source)
      .filter(
        (pair) =>
          pair.style === "text-decoration:underline" &&
          source.slice(pair.open.from, pair.open.to) === "<u>" &&
          source.slice(pair.close.from, pair.close.to) === "</u>" &&
          pair.open.to <= sel.from &&
          sel.to <= pair.close.from
      )
      .sort(
        (a, b) =>
          a.close.to - a.open.from - (b.close.to - b.open.from)
      )[0] ?? null
  );
}

/** Whether the selection itself or any smallest enclosing HTML pair is
 * underlined. Kept shared with toggleUnderline so button state and action
 * cannot disagree when another inline format sits between text and `<u>`. */
export function isUnderlineActive(state: EditorState): boolean {
  return (
    getWrapState(state, "<u>", "</u>") !== "none" ||
    enclosingUnderlinePair(state) !== null
  );
}

/** Toggle portable HTML underline without nesting a second `<u>` inside an
 * existing underlined region. */
export function toggleUnderline(view: EditorView) {
  const sel = view.state.selection.main;
  if (sel.empty) return;

  // A Source-mode selection may include both tags. The generic helper
  // already unwraps that shape and keeps the selected inner text selected.
  if (getWrapState(view.state, "<u>", "</u>") === "inside") {
    toggleWrap(view, "<u>", "</u>");
    return;
  }

  const pair = enclosingUnderlinePair(view.state);
  if (!pair) {
    toggleWrap(view, "<u>", "</u>");
    return;
  }

  const openingLength = pair.open.to - pair.open.from;
  view.dispatch({
    changes: [
      { from: pair.open.from, to: pair.open.to },
      { from: pair.close.from, to: pair.close.to },
    ],
    selection: {
      anchor: sel.anchor - openingLength,
      head: sel.head - openingLength,
    },
  });
}

/* ---------- Inline color (rendered by Obsidian as inline HTML) ---------- */

/**
 * Theme-native palette: Obsidian defines --color-red … --color-pink (and
 * -rgb variants) in every theme, tuned separately for light and dark mode.
 * Colors written with these variables always match the user's theme and
 * flip automatically when the theme changes.
 */
export const TEXT_COLORS = [
  "var(--color-red)", "var(--color-orange)", "var(--color-yellow)",
  "var(--color-green)", "var(--color-cyan)", "var(--color-blue)",
  "var(--color-purple)", "var(--color-pink)",
];
export const BG_COLORS = [
  "rgba(var(--color-red-rgb),0.18)", "rgba(var(--color-orange-rgb),0.18)",
  "rgba(var(--color-yellow-rgb),0.20)", "rgba(var(--color-green-rgb),0.18)",
  "rgba(var(--color-cyan-rgb),0.18)", "rgba(var(--color-blue-rgb),0.18)",
  "rgba(var(--color-purple-rgb),0.18)", "rgba(var(--color-pink-rgb),0.18)",
];

const spanOpen = (c: string) => `<span style="color:${c}">`;
const markOpen = (c: string) => `<mark style="background:${c};color:inherit">`;
const RE_SPAN_BEFORE = /<span style="color:[^"]*">$/;
const RE_MARK_BEFORE = /<mark style="background:[^"]*;color:inherit">$/;

function applyTagColor(
  view: EditorView,
  color: string | null,
  reBefore: RegExp,
  open: (c: string) => string,
  close: string
) {
  const sel = view.state.selection.main;
  if (sel.empty) return;
  const doc = view.state.doc;
  const before = doc.sliceString(Math.max(0, sel.from - 64), sel.from);
  const after = doc.sliceString(sel.to, Math.min(doc.length, sel.to + close.length));
  const m = before.match(reBefore);

  if (m && after === close) {
    const openFrom = sel.from - m[0].length;
    if (color === null) {
      // Strip both tags.
      view.dispatch({
        changes: [
          { from: openFrom, to: sel.from },
          { from: sel.to, to: sel.to + close.length },
        ],
        selection: { anchor: openFrom, head: sel.to - m[0].length },
      });
    } else {
      // Recolor in place.
      const newOpen = open(color);
      view.dispatch({
        changes: { from: openFrom, to: sel.from, insert: newOpen },
        selection: {
          anchor: openFrom + newOpen.length,
          head: sel.to - m[0].length + newOpen.length,
        },
      });
    }
    return;
  }
  if (color === null) return;

  const openTag = open(color);
  view.dispatch({
    changes: [
      { from: sel.from, insert: openTag },
      { from: sel.to, insert: close },
    ],
    selection: {
      anchor: sel.from + openTag.length,
      head: sel.to + openTag.length,
    },
  });
}

export function applyTextColor(view: EditorView, color: string | null) {
  applyTagColor(view, color, RE_SPAN_BEFORE, spanOpen, "</span>");
}

export function applyHighlightColor(view: EditorView, color: string | null) {
  applyTagColor(view, color, RE_MARK_BEFORE, markOpen, "</mark>");
}

/** Strip every inline format from the selection: markdown tokens,
 *  surrounding wrappers, and color span/mark tags. */
export function clearInlineFormatting(view: EditorView) {
  const markdownWrappers = [
    ["**", "**"],
    ["~~", "~~"],
    ["==", "=="],
    ["`", "`"],
    ["*", "*"],
  ] as const;

  // Different formats can surround each other in either order. Re-run the
  // peel in bounded passes so removing an inner wrapper exposes and removes
  // the next outer wrapper as well.
  const MAX_PEEL_PASSES = 32;
  for (let pass = 0; pass < MAX_PEEL_PASSES; pass++) {
    const beforeLength = view.state.doc.length;
    applyTextColor(view, null);
    applyHighlightColor(view, null);
    for (const [open, close] of markdownWrappers) {
      if (getWrapState(view.state, open, close) !== "none") {
        toggleWrap(view, open, close);
      }
    }
    if (isUnderlineActive(view.state)) toggleUnderline(view);
    if (view.state.doc.length === beforeLength) break;
  }

  const sel = view.state.selection.main;
  if (sel.empty) return;
  const selected = view.state.doc.sliceString(sel.from, sel.to);
  const stripped = selected
    // Require the complete tag name. In particular, `<u>` must never make
    // clear-formatting consume unrelated `<ul>` or `<unknown>` elements.
    .replace(/<\/?(?:span|mark|u)(?:\s[^<>]*)?>/gi, "")
    .replace(/(\*\*|~~|==|`|\*)/g, "");
  if (stripped !== selected) {
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: stripped },
      selection: { anchor: sel.from, head: sel.from + stripped.length },
    });
  }
}

export function insertLink(view: EditorView) {
  const sel = view.state.selection.main;
  if (sel.empty) return;
  const text = view.state.doc.sliceString(sel.from, sel.to);
  const insert = `[${text}]()`;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert },
    selection: { anchor: sel.from + insert.length - 1 },
  });
  view.focus();
}

const PRIMARY_TOOLBAR_ACTIONS: ToolbarAction[] = [
  { icon: "bold", tooltip: t("Bold"), marker: "**", run: (v) => toggleWrap(v, "**") },
  { icon: "italic", tooltip: t("Italic"), marker: "*", run: (v) => toggleWrap(v, "*") },
  {
    icon: "underline",
    tooltip: t("Underline"),
    marker: "<u>",
    endMarker: "</u>",
    isActive: isUnderlineActive,
    run: toggleUnderline,
  },
  { icon: "strikethrough", tooltip: t("Strikethrough"), marker: "~~", run: (v) => toggleWrap(v, "~~") },
];

const SECONDARY_TOOLBAR_ACTIONS: ToolbarAction[] = [
  { icon: "code", tooltip: t("Inline code"), marker: "`", run: (v) => toggleWrap(v, "`") },
  { icon: "link", tooltip: t("Link"), run: insertLink },
];

function makeToolbarPlugin(plugin: NotionFlowPlugin) {
  return ViewPlugin.fromClass(
    class ToolbarView {
      view: EditorView;
      doc: Document;
      win: Window & typeof globalThis;
      toolbar: HTMLElement;
      buttons: { el: HTMLElement; action: ToolbarAction }[] = [];

      // Document-level: callout/table widgets swallow mouseup before it
      // reaches the editor DOM, but it still bubbles to the document.
      onMouseUp = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if ((target && this.toolbar.contains(target)) || isBlockMenuTarget(target)) return;
        this.win.setTimeout(() => {
          if (this.doc.body.classList.contains(BLOCK_MENU_OPEN_CLASS)) {
            this.hide();
            return;
          }
          if (this.view.hasFocus || (target && this.view.dom.contains(target))) {
            this.maybeShow();
          }
        }, 0);
      };
      onKeyUp = (e: KeyboardEvent) => {
        if (e.key === "Escape") return this.hide();
        // Follow the real selection: covers Shift+arrows, Cmd+A, etc.
        if (!this.view.state.selection.main.empty) return this.maybeShow();
        const navigation = new Set([
          "Tab",
          "Enter",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
        ]);
        if (navigation.has(e.key) && this.tableTarget()) this.maybeShow();
        else this.hide(); // typing should not leave chrome over the cell
      };
      // Hide instantly when a click starts anywhere outside the toolbar —
      // prevents a stale toolbar from lingering while the selection moves.
      onMouseDown = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if (target && this.toolbar.contains(target)) return;
        this.hide();
      };
      onBlockMenuOpen = () => this.hide();
      hideIfFocusOutside = () => {
        const active = this.doc.activeElement;
        if (active && (this.toolbar.contains(active) || this.view.dom.contains(active))) return;
        this.hide();
      };
      onBlur = () => this.win.setTimeout(this.hideIfFocusOutside, 0);
      onToolbarFocusOut = () => this.win.setTimeout(this.hideIfFocusOutside, 0);
      onScroll = (e: Event) => {
        const t = e.target as Node | null;
        if (t && this.toolbar.contains(t)) return;
        this.hide();
      };
      positionFrame: number | null = null;
      schedulePosition = () => {
        if (this.positionFrame != null) this.win.cancelAnimationFrame(this.positionFrame);
        this.positionFrame = this.win.requestAnimationFrame(() => {
          this.positionFrame = null;
          if (this.toolbar.isConnected && this.toolbar.style.display !== "none") this.position();
        });
      };
      onResize = () => this.schedulePosition();
      onToolbarKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          this.hide();
          this.view.focus();
          return;
        }
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const current = e.target as HTMLButtonElement | null;
        const row = current?.closest(".nf-toolbar-row");
        if (!row || current?.tagName !== "BUTTON") return;
        const buttons = Array.from(
          row.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")
        );
        const index = buttons.indexOf(current);
        if (index < 0 || buttons.length < 2) return;
        e.preventDefault();
        const delta = e.key === "ArrowRight" ? 1 : -1;
        buttons[(index + delta + buttons.length) % buttons.length].focus();
      };
      onEditorKeyDown = (e: KeyboardEvent) => {
        if (!e.altKey || e.key !== "F10") return;
        e.preventDefault();
        e.stopPropagation();
        this.maybeShow();
        const row =
          this.tableRow.style.display !== "none" ? this.tableRow : this.mainRow;
        row.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
      };

      mainRow!: HTMLElement;
      tableRow!: HTMLElement;
      palRow!: HTMLElement;
      palMode: "none" | "color" | "bg" | "cell" | "table" = "none";
      colorBtn!: HTMLButtonElement;
      bgBtn!: HTMLButtonElement;
      cellBtn!: HTMLButtonElement;
      tblBtn!: HTMLButtonElement;
      insertRowBtn!: HTMLButtonElement;
      insertColBtn!: HTMLButtonElement;
      deleteRowBtn!: HTMLButtonElement;
      deleteColBtn!: HTMLButtonElement;
      alignBtns: Partial<Record<ColumnAlign, HTMLButtonElement>> = {};

      constructor(view: EditorView) {
        this.view = view;
        this.doc = view.dom.ownerDocument;
        this.win = (this.doc.defaultView ?? window) as Window & typeof globalThis;
        this.toolbar = this.doc.body.createDiv({ cls: "nf-toolbar" });
        this.toolbar.setAttribute("role", "toolbar");
        this.toolbar.setAttribute("aria-label", t("Formatting toolbar"));
        this.toolbar.setAttribute("aria-keyshortcuts", "Alt+F10");
        this.toolbar.style.display = "none";
        this.mainRow = this.toolbar.createDiv({ cls: "nf-toolbar-row nf-toolbar-main" });
        this.tableRow = this.toolbar.createDiv({ cls: "nf-toolbar-row nf-toolbar-table" });
        this.tableRow.setAttribute("role", "group");
        this.tableRow.setAttribute("aria-label", t("Table actions"));
        this.tableRow.style.display = "none";
        this.palRow = this.toolbar.createDiv({ cls: "nf-toolbar-row nf-toolbar-palette" });
        this.palRow.setAttribute("role", "group");
        this.palRow.style.display = "none";

        const mkBtn = (parent: HTMLElement, icon: string, label: string) => {
          const btn = parent.createEl("button", {
            cls: "nf-toolbar-btn",
            attr: {
              "aria-label": label,
              "data-tooltip-position": "top",
              type: "button",
            },
          });
          setIcon(btn, icon);
          return btn;
        };
        const onPress = (btn: HTMLButtonElement, run: () => void) => {
          // Preventing mousedown keeps the editor selection intact; click
          // handles mouse, touch, and keyboard activation uniformly.
          btn.addEventListener("mousedown", (e) => e.preventDefault());
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            if (!btn.disabled) run();
          });
        };
        const mkSep = (parent = this.mainRow) => parent.createDiv({ cls: "nf-toolbar-sep" });

        for (const action of PRIMARY_TOOLBAR_ACTIONS) {
          const btn = mkBtn(this.mainRow, action.icon, action.tooltip);
          onPress(btn, () => {
            action.run(this.view);
            this.win.setTimeout(() => this.maybeShow(), 0);
          });
          this.buttons.push({ el: btn, action });
        }
        mkSep(this.mainRow);

        // Text color + highlight color open palettes.
        this.colorBtn = mkBtn(this.mainRow, "baseline", t("Text color"));
        onPress(this.colorBtn, () => this.togglePalette("color"));
        this.bgBtn = mkBtn(this.mainRow, "highlighter", t("Highlight color"));
        onPress(this.bgBtn, () => this.togglePalette("bg"));
        mkSep(this.mainRow);

        for (const action of SECONDARY_TOOLBAR_ACTIONS) {
          const btn = mkBtn(this.mainRow, action.icon, action.tooltip);
          onPress(btn, () => {
            action.run(this.view);
            this.win.setTimeout(() => this.maybeShow(), 0);
          });
          this.buttons.push({ el: btn, action });
        }

        const clearBtn = mkBtn(this.mainRow, "remove-formatting", t("Clear formatting"));
        onPress(clearBtn, () => {
          clearInlineFormatting(this.view);
          this.win.setTimeout(() => this.maybeShow(), 0);
        });

        // A dedicated table row stays compact and discoverable. It appears
        // on a simple cell click (no text selection required), while text
        // formatting remains in the row above when text is selected.
        const label = this.tableRow.createSpan({ cls: "nf-toolbar-label" });
        label.setText(t("Table"));
        const tableBtn = (icon: string, title: string, run: () => void) => {
          const btn = mkBtn(this.tableRow, icon, t(title));
          onPress(btn, run);
          return btn;
        };

        this.insertRowBtn = tableBtn("arrow-down-to-line", "Insert row below", () =>
          this.applyTableEdit(
            (text, row) => tableInsertRow(text, row, "below"),
            (row, col, oldText) => ({
              row: tableInsertRowIndex(oldText, row, "below"),
              col,
            })
          )
        );
        this.insertColBtn = tableBtn("arrow-right-to-line", "Insert column right", () =>
          this.applyTableEdit(
            (text, _row, col) => tableInsertColumn(text, col, "right"),
            (row, col) => ({ row, col: col + 1 })
          )
        );
        mkSep(this.tableRow);

        const align = (value: ColumnAlign, title: string, icon: string) => {
          const btn = tableBtn(icon, title, () =>
            this.applyTableEdit(
              (text, _row, col) => tableSetAlignment(text, col, value),
              (row, col) => ({ row, col })
            )
          );
          this.alignBtns[value] = btn;
        };
        align("none", "Default alignment", "align-justify");
        align("left", "Align left", "align-left");
        align("center", "Align center", "align-center");
        align("right", "Align right", "align-right");
        mkSep(this.tableRow);

        this.cellBtn = tableBtn("paint-bucket", "Cell background", () =>
          this.togglePalette("cell")
        );
        this.tblBtn = tableBtn("table", "Table background", () =>
          this.togglePalette("table")
        );
        tableBtn("wand-2", "Format table", () =>
          this.applyTableEdit(
            (text) => formatTable(text),
            (row, col, _oldText, newText) => ({
              row: nearestTableDataRow(newText, row),
              col,
            })
          )
        );
        mkSep(this.tableRow);

        this.deleteRowBtn = tableBtn("trash-2", "Delete row", () =>
          this.applyTableEdit(
            (text, row) => tableDeleteRow(text, row),
            (row, col, _oldText, newText) => ({
              row: nearestTableDataRow(newText, row),
              col,
            })
          )
        );
        this.deleteRowBtn.classList.add("is-danger");
        this.deleteColBtn = tableBtn("columns-2", "Delete column", () =>
          this.applyTableEdit(
            (text, _row, col) => tableDeleteColumn(text, col),
            (row, col, _oldText, newText) => ({
              row,
              col: Math.min(
                col,
                Math.max(0, ...newText.split("\n").map((line) => parseRow(line).length - 1))
              ),
            })
          )
        );
        this.deleteColBtn.classList.add("is-danger");

        for (const btn of [this.colorBtn, this.bgBtn, this.cellBtn, this.tblBtn]) {
          btn.setAttribute("aria-expanded", "false");
          btn.setAttribute("aria-haspopup", "true");
        }

        this.doc.addEventListener("mouseup", this.onMouseUp);
        this.doc.addEventListener("mousedown", this.onMouseDown);
        this.doc.addEventListener(BLOCK_MENU_OPEN_EVENT, this.onBlockMenuOpen);
        this.doc.addEventListener("scroll", this.onScroll, true);
        this.win.addEventListener("resize", this.onResize);
        this.toolbar.addEventListener("keydown", this.onToolbarKeyDown);
        this.toolbar.addEventListener("focusout", this.onToolbarFocusOut);
        view.dom.addEventListener("keydown", this.onEditorKeyDown);
        view.dom.addEventListener("keyup", this.onKeyUp);
        view.contentDOM.addEventListener("blur", this.onBlur);
      }

      /** Current table and cell, for both raw Markdown and Live Preview's
       * embedded cell editor. All contextual actions share this one mapping
       * so color, structure, alignment, and deletion cannot drift apart. */
      tableTarget(): TableToolbarTarget | null {
        const td = this.view.dom.closest("td, th") as HTMLTableCellElement | null;
        if (td) {
          const widget = this.view.dom.closest(".cm-embed-block");
          const outerEl = widget?.parentElement?.closest(".cm-editor");
          const outer = outerEl ? EditorView.findFromDOM(outerEl as HTMLElement) : null;
          if (!widget || !outer) return null;
          let pos: number;
          try {
            pos = outer.posAtDOM(widget);
          } catch {
            return null;
          }
          const doc = outer.state.doc;
          const range = getTableRange(doc, doc.lineAt(pos).number, scanFences(doc));
          if (!range) return null;
          const from = doc.line(range.startLine).from;
          const to = doc.line(range.endLine).to;
          const text = doc.sliceString(from, to);
          const lines = text.split("\n");
          const d = lines.findIndex(isDelimRow);
          const renderedRow = (td.parentElement as HTMLTableRowElement).rowIndex;
          // Rendered row → markdown line: the delimiter follows the header
          // but is not rendered, so body row indices skip over it.
          const row =
            renderedRow === 0 ? Math.max(0, d - 1) : d < 0 ? renderedRow : d + renderedRow;
          return {
            kind: "widget",
            view: outer,
            from,
            to,
            text,
            row,
            col: td.cellIndex,
          };
        }

        const state = this.view.state;
        const sel = state.selection.main;
        const doc = state.doc;
        const line = doc.lineAt(sel.head);
        if (!RE_TABLE.test(line.text)) return null;
        const range = getTableRange(doc, line.number, scanFences(doc));
        if (!range) return null;
        const from = doc.line(range.startLine).from;
        const to = doc.line(range.endLine).to;
        return {
          kind: "source",
          view: this.view,
          from,
          to,
          text: doc.sliceString(from, to),
          row: line.number - range.startLine,
          col: cellAt(line.text, sel.head - line.from),
        };
      }

      tableKind(): "widget" | "source" | null {
        return this.tableTarget()?.kind ?? null;
      }

      /** Apply a cursor-relative table transformation. Source-mode edits
       * keep the cursor in the nearest editable cell; Live Preview edits
       * update the owning outer editor and let Obsidian rebuild its widget. */
      applyTableEdit(
        edit: (text: string, row: number, col: number) => string,
        target?: (
          row: number,
          col: number,
          oldText: string,
          newText: string
        ) => { row: number; col: number }
      ) {
        const ctx = this.tableTarget();
        if (!ctx) return;
        const out = edit(ctx.text, ctx.row, ctx.col);
        if (out === ctx.text) return;
        let selection: { anchor: number } | undefined;
        if (ctx.kind === "source") {
          const requested = target?.(ctx.row, ctx.col, ctx.text, out) ?? {
            row: ctx.row,
            col: ctx.col,
          };
          const lines = out.split("\n");
          const row = nearestTableDataRow(
            out,
            Math.max(0, Math.min(requested.row, lines.length - 1))
          );
          const cols = Math.max(1, parseRow(lines[row]).length);
          const col = Math.max(0, Math.min(requested.col, cols - 1));
          const before = lines.slice(0, row).reduce((sum, line) => sum + line.length + 1, 0);
          selection = { anchor: ctx.from + before + cellStart(lines[row], col) };
        }
        // Mouse activation keeps focus in the editor via preventDefault;
        // keyboard activation focuses a toolbar button. Restore that latter
        // path after the edit so typing/navigation never gets stranded on a
        // button that has just been hidden or rebuilt.
        const restoreEditorFocus = this.toolbar.contains(this.doc.activeElement);
        this.hide();
        ctx.view.dispatch({
          changes: { from: ctx.from, to: ctx.to, insert: out },
          selection,
          userEvent: "input.table",
        });
        if (restoreEditorFocus) this.win.requestAnimationFrame(() => ctx.view.focus());
      }

      applyTableColor(scope: "cell" | "table", color: string | null) {
        this.applyTableEdit(
          (text, row, col) =>
            scope === "table" ? tableWithBg(text, color) : setCellBgAt(text, row, col, color),
          (row, col) => ({ row, col })
        );
      }

      togglePalette(mode: "color" | "bg" | "cell" | "table") {
        this.palMode = this.palMode === mode ? "none" : mode;
        this.colorBtn.classList.toggle("is-open", this.palMode === "color");
        this.bgBtn.classList.toggle("is-open", this.palMode === "bg");
        this.cellBtn.classList.toggle("is-open", this.palMode === "cell");
        this.tblBtn.classList.toggle("is-open", this.palMode === "table");
        this.colorBtn.setAttribute("aria-expanded", String(this.palMode === "color"));
        this.bgBtn.setAttribute("aria-expanded", String(this.palMode === "bg"));
        this.cellBtn.setAttribute("aria-expanded", String(this.palMode === "cell"));
        this.tblBtn.setAttribute("aria-expanded", String(this.palMode === "table"));
        this.buildPalette();
        this.position();
      }

      buildPalette() {
        this.palRow.empty();
        if (this.palMode === "none") {
          this.palRow.style.display = "none";
          this.palRow.removeAttribute("aria-label");
          return;
        }
        const paletteLabel: Record<Exclude<typeof this.palMode, "none">, string> = {
          color: "Text color",
          bg: "Highlight color",
          cell: "Cell background",
          table: "Table background",
        };
        this.palRow.setAttribute("aria-label", t(paletteLabel[this.palMode]));
        this.palRow.style.display = "flex";
        const press = (button: HTMLButtonElement, run: () => void) => {
          button.addEventListener("mousedown", (e) => e.preventDefault());
          button.addEventListener("click", (e) => {
            e.preventDefault();
            run();
          });
        };

        // Cell / table background palettes: theme tints + remove.
        if (this.palMode === "cell" || this.palMode === "table") {
          const scope = this.palMode;
          const target = this.tableTarget();
          const current = target
            ? scope === "table"
              ? tableBgColor(target.text)
              : cellBgColorAt(target.text, target.row, target.col)
            : null;
          for (const name of PALETTE_COLORS) {
            const sw = this.palRow.createEl("button", {
              cls: "nf-swatch",
              attr: {
                "aria-label": t(COLOR_LABELS[name]),
                "aria-pressed": String(current === name),
                "data-tooltip-position": "top",
                type: "button",
              },
            });
            sw.classList.toggle("is-active", current === name);
            sw.style.backgroundColor = `rgba(var(--color-${name}-rgb), 0.35)`;
            press(sw, () => this.applyTableColor(scope, name));
          }
          const off = this.palRow.createEl("button", {
            cls: "nf-swatch nf-swatch-off",
            attr: {
              "aria-label": t("Remove color"),
              "aria-pressed": String(current == null),
              "data-tooltip-position": "top",
              type: "button",
            },
          });
          off.classList.toggle("is-active", current == null);
          setIcon(off, "ban");
          press(off, () => this.applyTableColor(scope, null));
          return;
        }

        const isText = this.palMode === "color";
        if (!isText) {
          // Default markdown highlight (==) first.
          const def = this.palRow.createEl("button", {
            cls: "nf-swatch nf-swatch-default",
            attr: {
              "aria-label": t("Default highlight (==)"),
              "data-tooltip-position": "top",
              type: "button",
            },
          });
          press(def, () => {
            toggleWrap(this.view, "==");
            this.win.setTimeout(() => this.maybeShow(), 0);
          });
        }
        const colors = isText ? TEXT_COLORS : BG_COLORS;
        for (const [index, c] of colors.entries()) {
          const colorName = PALETTE_COLORS[index];
          const sw = this.palRow.createEl("button", {
            cls: "nf-swatch",
            attr: {
              "aria-label": t(COLOR_LABELS[colorName]),
              "data-tooltip-position": "top",
              type: "button",
            },
          });
          if (isText) {
            sw.setText("A");
            sw.style.color = c;
          } else {
            sw.style.backgroundColor = c;
          }
          press(sw, () => {
            if (isText) applyTextColor(this.view, c);
            else applyHighlightColor(this.view, c);
            this.win.setTimeout(() => this.maybeShow(), 0);
          });
        }
        const off = this.palRow.createEl("button", {
          cls: "nf-swatch nf-swatch-off",
          attr: {
            "aria-label": t("Remove color"),
            "data-tooltip-position": "top",
            type: "button",
          },
        });
        setIcon(off, "ban");
        press(off, () => {
          if (isText) applyTextColor(this.view, null);
          else {
            applyHighlightColor(this.view, null);
            if (getWrapState(this.view.state, "==") !== "none") toggleWrap(this.view, "==");
          }
          this.win.setTimeout(() => this.maybeShow(), 0);
        });
      }

      /** Screen rect of the selection. Falls back to the DOM selection when
       *  the editor positions sit inside a rendered widget (callouts,
       *  tables), where coordsAtPos returns null. */
      selRect(): { left: number; right: number; top: number; bottom: number } | null {
        const sel = this.view.state.selection.main;
        const start = this.view.coordsAtPos(sel.from);
        const endC = this.view.coordsAtPos(sel.to);
        if (start && endC) {
          return { left: start.left, right: endC.right, top: start.top, bottom: endC.bottom };
        }
        const domSel = this.win.getSelection();
        if (domSel && domSel.rangeCount > 0 && !domSel.isCollapsed) {
          const r = domSel.getRangeAt(0).getBoundingClientRect();
          if (r && (r.width > 0 || r.height > 0)) {
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
          }
        }
        return null;
      }

      position() {
        const r = this.selRect();
        if (!r) return;
        const pane = this.view.dom.closest(".workspace-leaf-content")?.getBoundingClientRect();
        const paneLeft = Math.max(8, pane?.left ?? 8);
        const paneRight = Math.min(
          this.win.innerWidth - 8,
          pane?.right ?? this.win.innerWidth - 8
        );
        const paneTop = Math.max(8, pane?.top ?? 8);
        const paneBottom = Math.min(
          this.win.innerHeight - 8,
          pane?.bottom ?? this.win.innerHeight - 8
        );
        this.toolbar.style.maxWidth = `${Math.max(1, paneRight - paneLeft)}px`;
        this.toolbar.style.maxHeight = `${Math.max(1, paneBottom - paneTop)}px`;
        const rect = this.toolbar.getBoundingClientRect();
        const centerX = (r.left + r.right) / 2;
        let left = centerX - rect.width / 2;
        const maxLeft = Math.max(paneLeft, paneRight - rect.width);
        left = Math.max(paneLeft, Math.min(left, maxLeft));
        const above = r.top - rect.height - 8;
        const below = r.bottom + 8;
        let top = above >= paneTop ? above : below;
        const maxTop = Math.max(paneTop, paneBottom - rect.height);
        top = Math.max(paneTop, Math.min(top, maxTop));
        this.toolbar.style.left = `${left}px`;
        this.toolbar.style.top = `${top}px`;
      }

      /** In Live Preview a table cell is its own embedded editor nested in
       *  the document editor, and both track a selection — only the editor
       *  that owns the DOM selection may show its toolbar, or two toolbars
       *  appear (the outer one positioned far from the cell). */
      ownsSelection(): boolean {
        const domSel = this.win.getSelection();
        const node = domSel?.anchorNode ?? null;
        const el =
          node instanceof this.win.Element ? node : node?.parentElement ?? null;
        const content = el?.closest(".cm-content");
        return !content || content === this.view.contentDOM;
      }

      maybeShow() {
        if (!plugin.settings.floatingToolbar) return this.hide();
        if (this.doc.body.classList.contains(BLOCK_MENU_OPEN_CLASS)) return this.hide();
        const sel = this.view.state.selection.main;
        const target = this.tableTarget();
        if (sel.empty && !target) return this.hide();
        if (!this.ownsSelection()) return this.hide();
        if (!this.selRect()) return this.hide();
        this.mainRow.style.display = sel.empty ? "none" : "flex";
        this.tableRow.style.display = target ? "flex" : "none";
        // Light up buttons whose format is already applied.
        for (const { el, action } of this.buttons) {
          if (!action.marker && !action.isActive) continue;
          const active = action.isActive
            ? action.isActive(this.view.state)
            : getWrapState(this.view.state, action.marker!, action.endMarker) !== "none";
          el.classList.toggle("is-active", active);
          el.setAttribute("aria-pressed", String(active));
        }
        if (target) {
          const lines = target.text.split("\n");
          const delimiter = lines.findIndex(isDelimRow);
          const onBodyRow =
            !isDelimRow(lines[target.row] ?? "") &&
            target.row > (delimiter < 0 ? 0 : delimiter);
          const nCols = Math.max(1, ...lines.map((line) => parseRow(line).length));
          this.deleteRowBtn.disabled = !onBodyRow;
          this.deleteColBtn.disabled = nCols <= 1;
          this.cellBtn.disabled = isDelimRow(lines[target.row] ?? "");
          const alignment = tableColumnAlignment(target.text, target.col);
          for (const value of ["none", "left", "center", "right"] as const) {
            const btn = this.alignBtns[value];
            if (!btn) continue;
            const active = alignment === value;
            btn.classList.toggle("is-active", active);
            btn.setAttribute("aria-pressed", String(active));
          }
        }
        if (!target && (this.palMode === "cell" || this.palMode === "table")) {
          this.palMode = "none";
          this.buildPalette();
        }
        this.toolbar.style.display = "flex";
        this.position();
      }

      hide() {
        this.toolbar.style.display = "none";
        this.palMode = "none";
        this.palRow.style.display = "none";
        this.palRow.empty();
        this.colorBtn?.classList.remove("is-open");
        this.bgBtn?.classList.remove("is-open");
        this.cellBtn?.classList.remove("is-open");
        this.tblBtn?.classList.remove("is-open");
        for (const btn of [this.colorBtn, this.bgBtn, this.cellBtn, this.tblBtn]) {
          btn?.setAttribute("aria-expanded", "false");
        }
      }

      update(update: ViewUpdate) {
        if (update.docChanged && this.view.state.selection.main.empty) this.hide();
        // coordsAtPos reads layout and is illegal synchronously inside a CM6
        // ViewPlugin.update. Defer geometry-driven repositioning a frame.
        else if (update.geometryChanged && this.toolbar.style.display !== "none") {
          this.schedulePosition();
        }
      }

      destroy() {
        this.doc.removeEventListener("mouseup", this.onMouseUp);
        this.doc.removeEventListener("mousedown", this.onMouseDown);
        this.doc.removeEventListener(BLOCK_MENU_OPEN_EVENT, this.onBlockMenuOpen);
        this.doc.removeEventListener("scroll", this.onScroll, true);
        this.win.removeEventListener("resize", this.onResize);
        this.toolbar.removeEventListener("keydown", this.onToolbarKeyDown);
        this.toolbar.removeEventListener("focusout", this.onToolbarFocusOut);
        if (this.positionFrame != null) this.win.cancelAnimationFrame(this.positionFrame);
        this.view.dom.removeEventListener("keydown", this.onEditorKeyDown);
        this.view.dom.removeEventListener("keyup", this.onKeyUp);
        this.view.contentDOM.removeEventListener("blur", this.onBlur);
        this.toolbar.remove();
      }
    }
  );
}

/* ------------------------------------------------------------------ */
/* Slash command menu                                                  */
/* ------------------------------------------------------------------ */

interface SlashCommand {
  id: string;
  name: string;
  icon: string;
  keywords: string;
  /** Syntax hint shown faintly on the right of the menu row. */
  hint?: string;
  /** Prefix applied to the current line (mutually exclusive with insert). */
  linePrefix?: string;
  /** Block text inserted at the cursor; "‸" marks the final cursor spot. */
  insert?: string;
  /** Block-level insert: moves to its own fresh line when triggered mid-line. */
  block?: boolean;
  /** Won't render directly under a text line (tables, dividers): keep a
   *  blank line above. */
  needsBlank?: boolean;
  /** Quote-style block that would absorb the following line as lazy
   *  continuation: keep a blank line below. */
  sealBelow?: boolean;
}

// Keywords mix English and Chinese so either language filters the menu,
// whatever UI language is active.
export const SLASH_COMMANDS: SlashCommand[] = [
  { id: "h1", name: t("Heading 1"), icon: "heading-1", keywords: "h1 title 标题 一级标题", hint: "#", linePrefix: "# " },
  { id: "h2", name: t("Heading 2"), icon: "heading-2", keywords: "h2 subtitle 标题 二级标题", hint: "##", linePrefix: "## " },
  { id: "h3", name: t("Heading 3"), icon: "heading-3", keywords: "h3 标题 三级标题", hint: "###", linePrefix: "### " },
  { id: "bullet", name: t("Bulleted list"), icon: "list", keywords: "ul unordered 列表 无序列表", hint: "-", linePrefix: "- " },
  { id: "number", name: t("Numbered list"), icon: "list-ordered", keywords: "ol ordered 列表 有序列表 编号", hint: "1.", linePrefix: "1. " },
  { id: "todo", name: t("To-do list"), icon: "check-square", keywords: "task checkbox 待办 任务 复选框", hint: "- [ ]", linePrefix: "- [ ] " },
  { id: "quote", name: t("Quote"), icon: "quote", keywords: "blockquote 引用", hint: ">", linePrefix: "> " },
  { id: "callout", name: t("Callout"), icon: "megaphone", keywords: "note info admonition 标注 提示", hint: "> [!note]", insert: "> [!note] ‸\n> ", block: true, sealBelow: true },
  { id: "toggle", name: t("Toggle (foldable callout)"), icon: "chevron-right", keywords: "fold collapse 折叠", hint: "> [!note]-", insert: "> [!note]- ‸\n> ", block: true, sealBelow: true },
  { id: "code", name: t("Code block"), icon: "code-2", keywords: "fence snippet 代码 代码块", hint: "```", insert: "```‸\n\n```", block: true },
  { id: "table", name: t("Table"), icon: "table", keywords: "grid 表格", hint: "3×3", insert: buildTableTemplate(3, 3), block: true, needsBlank: true },
  { id: "divider", name: t("Divider"), icon: "minus", keywords: "hr rule separator 分割线 分隔线", hint: "---", insert: "---\n‸", block: true, needsBlank: true },
  { id: "image", name: t("Image / embed"), icon: "image", keywords: "picture attach embed 图片 附件 嵌入", hint: "![[ ]]", insert: "![[‸]]" },
  { id: "wikilink", name: t("Internal link"), icon: "link-2", keywords: "link internal note wiki 链接 内链 双链", hint: "[[ ]]", insert: "[[‸]]" },
];

export class SlashSuggest extends EditorSuggest<SlashCommand> {
  plugin: NotionFlowPlugin;
  tablePickerClose: (() => void) | null = null;

  constructor(plugin: NotionFlowPlugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.setInstructions([
      { command: "↑↓", purpose: t("navigate") },
      { command: "↵", purpose: t("insert") },
      { command: "esc", purpose: t("dismiss") },
    ]);
  }

  onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    _file: TFile | null
  ): EditorSuggestTriggerInfo | null {
    if (!this.plugin.settings.slashCommands) return null;
    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    // "/" opens the menu at line start, after whitespace/">", or after CJK
    // text/punctuation — CJK prose has no spaces before the slash. The
    // query also accepts CJK so Chinese keywords ("/表格") are typable.
    // Ranges: CJK punctuation+kana, unified ideographs, fullwidth forms.
    const m = before.match(
      /(?:^|[\s>]|[　-ヿ一-鿿＀-￯])\/([\w　-ヿ一-鿿＀-￯-]*)$/
    );
    if (!m) return null;
    // Inside a code fence "/" is code, not a command.
    const view = (editor as unknown as { cm?: EditorView }).cm;
    if (view && fenceAt(scanFences(view.state.doc), cursor.line + 1)) return null;
    const start = before.length - m[1].length - 1; // include the "/"
    return {
      start: { line: cursor.line, ch: start },
      end: cursor,
      query: m[1],
    };
  }

  getSuggestions(ctx: EditorSuggestContext): SlashCommand[] {
    const q = ctx.query.toLowerCase();
    if (!q) return SLASH_COMMANDS;
    // Prefix matches (id, name, or any keyword) rank above substring hits.
    const prefix = (c: SlashCommand) =>
      c.id.startsWith(q) ||
      c.name.toLowerCase().startsWith(q) ||
      c.keywords.split(" ").some((k) => k.startsWith(q));
    return SLASH_COMMANDS.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.keywords.includes(q) ||
        c.id.startsWith(q)
    ).sort((a, b) => Number(prefix(b)) - Number(prefix(a)));
  }

  renderSuggestion(cmd: SlashCommand, el: HTMLElement) {
    el.addClass("nf-slash-item");
    const iconEl = el.createDiv({ cls: "nf-slash-icon" });
    setIcon(iconEl, cmd.icon);
    el.createDiv({ cls: "nf-slash-name", text: cmd.name });
    if (cmd.hint) el.createDiv({ cls: "nf-slash-hint", text: cmd.hint });
  }

  insertSnippet(
    editor: Editor,
    start: EditorPosition,
    end: EditorPosition,
    cmd: SlashCommand,
    template = cmd.insert
  ) {
    if (!template) return;
    let insert = template;
    let replaceStart = start;
    const lineAt = (n: number) => {
      try {
        return editor.getLine(n) ?? "";
      } catch {
        return "";
      }
    };
    if (cmd.block) {
      const lineText = lineAt(start.line);
      const before = lineText.slice(0, start.ch);
      const leading = before.match(/^\s*/)?.[0] ?? "";
      const lineIndent = indentWidth(leading);
      const prefixLines = (value: string, indent: number) => {
        const prefix = " ".repeat(indent);
        return value
          .split("\n")
          .map((line) => (line.length > 0 ? prefix + line : ""))
          .join("\n");
      };
      const listIndent = listContentIndent(before);
      if (listIndent != null) {
        // "/callout" or "/code" typed in a list item becomes a child
        // block of that item. Every template line receives the exact safe
        // content-column indent; closing fences/body lines cannot escape.
        insert = (cmd.needsBlank ? "\n\n" : "\n") +
          prefixLines(template, listIndent);
      } else if (/\S/.test(before)) {
        // Mid-line trigger (common after CJK text): the block starts on
        // its own fresh line. Tables and dividers additionally need a
        // blank line, or they merge into the paragraph above / turn it
        // into a setext heading.
        insert = (cmd.needsBlank ? "\n\n" : "\n") +
          prefixLines(template, lineIndent);
      } else if (
        cmd.needsBlank &&
        start.line > 0 &&
        lineAt(start.line - 1).trim() !== ""
      ) {
        // Replace the raw whitespace too, normalizing mixed tab/space
        // prefixes before a structural block reaches Live Preview.
        replaceStart = { line: start.line, ch: 0 };
        insert = "\n" + prefixLines(template, lineIndent);
      } else {
        replaceStart = { line: start.line, ch: 0 };
        insert = prefixLines(template, lineIndent);
      }
    }
    // Callout-style blocks absorb the following line as lazy quote
    // continuation — keep a blank line between the block and the text.
    if (cmd.sealBelow && lineAt(start.line + 1).trim() !== "") {
      insert += "\n";
    }
    const cursorIdx = insert.indexOf("‸");
    const text = insert.replace("‸", "");
    editor.replaceRange(text, replaceStart, end);
    if (cursorIdx >= 0) {
      const beforeCursor = text.slice(0, cursorIdx);
      const lines = beforeCursor.split("\n");
      const line = replaceStart.line + lines.length - 1;
      const ch =
        lines.length === 1
          ? replaceStart.ch + lines[0].length
          : lines[lines.length - 1].length;
      editor.setCursor({ line, ch });
    }
  }

  openTablePicker(
    editor: Editor,
    start: EditorPosition,
    end: EditorPosition,
    cmd: SlashCommand,
    evt: MouseEvent
  ) {
    this.tablePickerClose?.();
    const eventTarget = evt.target as Node | null;
    const ownerDoc = eventTarget?.ownerDocument ?? document;
    const win = (ownerDoc.defaultView ?? window) as Window & typeof globalThis;
    const anchorEl = eventTarget as Element | null;
    const anchorRect =
      typeof anchorEl?.closest === "function"
        ? anchorEl.closest(".suggestion-item")?.getBoundingClientRect()
        : null;
    const picker = ownerDoc.body.createDiv({
      cls: "nf-table-picker",
      attr: {
        role: "dialog",
        "aria-label": t("Choose table size"),
        tabindex: "-1",
      },
    });
    const heading = picker.createDiv({ cls: "nf-table-picker-heading" });
    heading.createSpan({ text: t("Table size") });
    const sizeLabel = heading.createSpan({ cls: "nf-table-picker-size" });
    const grid = picker.createDiv({
      cls: "nf-table-picker-grid",
      attr: { role: "grid", "aria-label": t("Columns × rows") },
    });
    picker.createDiv({
      cls: "nf-table-picker-hint",
      text: t("Drag or use arrow keys, then press Enter"),
    });
    const maxRows = 10;
    const maxCols = 10;
    let rows = 3;
    let cols = 3;
    let dragging = false;
    let done = false;
    const cells: HTMLButtonElement[] = [];

    for (let row = 1; row <= maxRows; row++) {
      for (let col = 1; col <= maxCols; col++) {
        const cell = grid.createEl("button", {
          cls: "nf-table-picker-cell",
          attr: {
            type: "button",
            role: "gridcell",
            tabindex: "-1",
            "aria-label": `${col} × ${row}`,
          },
        });
        cell.dataset.row = String(row);
        cell.dataset.col = String(col);
        cells.push(cell);
      }
    }

    const update = (nextRows: number, nextCols: number) => {
      rows = Math.max(1, Math.min(maxRows, nextRows));
      cols = Math.max(1, Math.min(maxCols, nextCols));
      sizeLabel.setText(`${cols} × ${rows}`);
      for (const cell of cells) {
        const active = Number(cell.dataset.row) <= rows && Number(cell.dataset.col) <= cols;
        cell.classList.toggle("is-active", active);
        cell.setAttribute("aria-selected", String(active));
      }
    };
    const updateFromPoint = (x: number, y: number, fallback: EventTarget | null) => {
      const atPoint = ownerDoc.elementFromPoint(x, y) as Element | null;
      const raw = atPoint?.closest?.(".nf-table-picker-cell") ??
        (fallback as Element | null)?.closest?.(".nf-table-picker-cell");
      if (!(raw instanceof win.HTMLElement) || !grid.contains(raw)) return;
      update(Number((raw as HTMLElement).dataset.row), Number((raw as HTMLElement).dataset.col));
    };
    const onOutside = (e: PointerEvent) => {
      if (!picker.contains(e.target as Node)) close(true);
    };
    const onViewportChange = () => close(true);
    const close = (restoreFocus = false) => {
      if (done) return;
      done = true;
      ownerDoc.removeEventListener("pointerdown", onOutside, true);
      ownerDoc.removeEventListener("scroll", onViewportChange, true);
      win.removeEventListener("resize", onViewportChange);
      picker.remove();
      if (this.tablePickerClose === close) this.tablePickerClose = null;
      if (restoreFocus) editor.focus();
    };
    const confirm = () => {
      if (done) return;
      // Mark complete before inserting so editor updates cannot cause an
      // outside-click cleanup to steal focus from the new first cell.
      done = true;
      ownerDoc.removeEventListener("pointerdown", onOutside, true);
      ownerDoc.removeEventListener("scroll", onViewportChange, true);
      win.removeEventListener("resize", onViewportChange);
      picker.remove();
      if (this.tablePickerClose === close) this.tablePickerClose = null;
      this.insertSnippet(editor, start, end, cmd, buildTableTemplate(rows, cols));
      editor.focus();
    };

    grid.addEventListener("pointermove", (e) => {
      updateFromPoint(e.clientX, e.clientY, e.target);
    });
    grid.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging = true;
      updateFromPoint(e.clientX, e.clientY, e.target);
      try {
        grid.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture is optional (older Electron/mobile webviews).
      }
    });
    grid.addEventListener("pointerup", (e) => {
      if (!dragging || e.button !== 0) return;
      e.preventDefault();
      dragging = false;
      updateFromPoint(e.clientX, e.clientY, e.target);
      confirm();
    });
    grid.addEventListener("pointercancel", () => {
      dragging = false;
    });
    picker.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        confirm();
        return;
      }
      const next = {
        ArrowLeft: [rows, cols - 1],
        ArrowRight: [rows, cols + 1],
        ArrowUp: [rows - 1, cols],
        ArrowDown: [rows + 1, cols],
      }[e.key];
      if (!next) return;
      e.preventDefault();
      update(next[0], next[1]);
    });

    update(rows, cols);
    const rect = picker.getBoundingClientRect();
    const gap = 8;
    let left = anchorRect ? anchorRect.right + gap : evt.clientX + gap;
    if (left + rect.width > win.innerWidth - gap) {
      left = anchorRect ? anchorRect.left - rect.width - gap : evt.clientX - rect.width - gap;
    }
    let top = anchorRect?.top ?? evt.clientY;
    left = Math.max(gap, Math.min(left, win.innerWidth - rect.width - gap));
    top = Math.max(gap, Math.min(top, win.innerHeight - rect.height - gap));
    picker.style.left = `${left}px`;
    picker.style.top = `${top}px`;
    this.tablePickerClose = close;
    ownerDoc.addEventListener("pointerdown", onOutside, true);
    ownerDoc.addEventListener("scroll", onViewportChange, true);
    win.addEventListener("resize", onViewportChange);
    win.requestAnimationFrame(() => {
      if (!done) picker.focus({ preventScroll: true });
    });
  }

  selectSuggestion(cmd: SlashCommand, _evt: MouseEvent | KeyboardEvent) {
    const ctx = this.context;
    if (!ctx) return;
    const { editor, start, end } = ctx;

    const pointer = _evt as MouseEvent;
    if (cmd.id === "table" && typeof pointer.clientX === "number") {
      this.openTablePicker(editor, start, end, cmd, pointer);
      return;
    }

    if (cmd.linePrefix !== undefined) {
      // Remove the trigger text, then swap the line's block prefix.
      editor.replaceRange("", start, end);
      const newLine = applyLinePrefix(editor.getLine(start.line), cmd.linePrefix);
      editor.setLine(start.line, newLine);
      editor.setCursor({ line: start.line, ch: newLine.length });
      return;
    }

    this.insertSnippet(editor, start, end, cmd);
  }
}

/* ------------------------------------------------------------------ */
/* Plugin                                                              */
/* ------------------------------------------------------------------ */

export default class NotionFlowPlugin extends Plugin {
  settings: NotionFlowSettings = DEFAULT_SETTINGS;
  private tableScrollDocuments = new Set<Document>();
  private tableScrollObservers = new Set<ResizeObserver>();

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new NotionFlowSettingTab(this.app, this));

    this.registerEditorSuggest(new SlashSuggest(this));
    this.registerEditorExtension(makeDragHandlePlugin(this));
    this.registerEditorExtension(makeToolbarPlugin(this));
    this.registerEditorExtension(makeListMarkerPlugin());
    this.registerEditorExtension(makeNestedIndentPlugin(this));
    this.registerEditorExtension(makeConcealPlugin(this));
    this.registerEditorExtension(makeMarkdownConcealPlugin(this));
    this.registerEditorExtension(makeTableKeymap(this));

    // Reading View does not consistently provide the horizontal table
    // wrapper used by Live Preview. Add a narrowly scoped, focusable scroll
    // region around native Markdown tables so wide content never expands the
    // whole pane. Common plugin-generated table classes are left untouched.
    this.registerMarkdownPostProcessor((el) => {
      // Reading view has real nested list elements, so one shared phase
      // attribute gives UL bullets and OL numbers the same unlimited cycle,
      // including mixed unordered/ordered ancestry.
      annotateReadingListPhases(el);

      const tables = [
        ...(el.matches("table") ? [el as HTMLTableElement] : []),
        ...Array.from(el.querySelectorAll<HTMLTableElement>("table")),
      ];
      for (const table of tables) {
        if (
          table.closest(
            ".nf-table-scroll, .table-wrapper, .cm-table-widget, .markdown-source-view, " +
              ".block-language-dataview, .block-language-dataviewjs"
          ) ||
          table.classList.contains("table-view-table")
        )
          continue;
        const parent = table.parentElement;
        if (!parent) continue;
        const ownerDocument = table.ownerDocument;
        const wrapper = ownerDocument.createElement("div");
        wrapper.className = "nf-table-scroll";
        parent.insertBefore(wrapper, table);
        wrapper.appendChild(table);
        this.tableScrollDocuments.add(ownerDocument);

        // A narrow table should not add a redundant landmark or Tab stop.
        // Keep those semantics in sync with real horizontal overflow as the
        // pane, font, or table content changes.
        const syncAccessibility = () => {
          const scrollable = wrapper.scrollWidth > wrapper.clientWidth + 1;
          if (scrollable) {
            wrapper.tabIndex = 0;
            wrapper.setAttribute("role", "region");
            wrapper.setAttribute("aria-label", t("Scrollable table"));
          } else {
            wrapper.removeAttribute("tabindex");
            wrapper.removeAttribute("role");
            wrapper.removeAttribute("aria-label");
          }
        };
        const ownerWindow = ownerDocument.defaultView as (Window & typeof globalThis) | null;
        const Observer = ownerWindow?.ResizeObserver;
        if (Observer) {
          let wasConnected = wrapper.isConnected;
          const observer = new Observer(() => {
            if (wrapper.isConnected) {
              wasConnected = true;
              syncAccessibility();
              return;
            }
            // Postprocessors may run on a fragment just before attachment;
            // only treat disconnection as cleanup after the wrapper has
            // actually appeared in a document once.
            if (wasConnected) {
              observer.disconnect();
              this.tableScrollObservers.delete(observer);
            }
          });
          observer.observe(wrapper);
          observer.observe(table);
          this.tableScrollObservers.add(observer);
        }
        ownerWindow?.requestAnimationFrame(syncAccessibility);
      }
    });

    this.addCommand({
      id: "move-block-up",
      name: t("Move block up"),
      hotkeys: [{ modifiers: ["Alt"], key: "ArrowUp" }],
      editorCallback: (editor) => this.moveBlockVert(editor, -1),
    });
    this.addCommand({
      id: "move-block-down",
      name: t("Move block down"),
      hotkeys: [{ modifiers: ["Alt"], key: "ArrowDown" }],
      editorCallback: (editor) => this.moveBlockVert(editor, 1),
    });
    this.addCommand({
      id: "duplicate-block",
      name: t("Duplicate block"),
      hotkeys: [{ modifiers: ["Alt", "Shift"], key: "D" }],
      editorCallback: (editor) => this.duplicateBlock(editor),
    });
    this.addCommand({
      id: "repair-nested-callout",
      name: t("Repair nested Callout"),
      editorCallback: (editor) => {
        const view = this.editorView(editor);
        if (!view) return;
        const repair = nestedCalloutRepair(
          view.state.doc,
          editor.getCursor().line + 1,
          scanFences(view.state.doc)
        );
        if (!repair) return;
        view.dispatch({
          changes: { from: repair.from, to: repair.to, insert: repair.insert },
          userEvent: "input.repair-callout",
        });
      },
    });
    this.addCommand({
      id: "format-table",
      name: t("Format table"),
      editorCallback: (editor) => this.withTable(editor, formatTable),
    });
    this.addCommand({
      id: "table-insert-row-below",
      name: t("Insert row below"),
      editorCallback: (editor) =>
        this.editTable(editor, (t, r) => tableInsertRow(t, r, "below"), (r, c, oldText) => ({
          row: tableInsertRowIndex(oldText, r, "below"),
          col: c,
        })),
    });
    this.addCommand({
      id: "table-insert-row-above",
      name: t("Insert row above"),
      editorCallback: (editor) =>
        this.editTable(editor, (t, r) => tableInsertRow(t, r, "above"), (r, c, oldText) => ({
          row: tableInsertRowIndex(oldText, r, "above"),
          col: c,
        })),
    });
    this.addCommand({
      id: "table-insert-column-right",
      name: t("Insert column right"),
      editorCallback: (editor) =>
        this.editTable(editor, (t, _r, c) => tableInsertColumn(t, c, "right"), (r, c) => ({ row: r, col: c + 1 })),
    });
    this.addCommand({
      id: "table-insert-column-left",
      name: t("Insert column left"),
      editorCallback: (editor) =>
        this.editTable(editor, (t, _r, c) => tableInsertColumn(t, c, "left"), (r, c) => ({ row: r, col: c })),
    });
    this.addCommand({
      id: "table-delete-row",
      name: t("Delete row"),
      editorCallback: (editor) =>
        this.editTable(editor, (t, r) => tableDeleteRow(t, r), (r, c, _oldText, newText) => ({
          row: nearestTableDataRow(newText, r),
          col: c,
        })),
    });
    this.addCommand({
      id: "table-delete-column",
      name: t("Delete column"),
      editorCallback: (editor) =>
        this.editTable(editor, (t, _r, c) => tableDeleteColumn(t, c), (r, c, _oldText, newText) => ({
          row: r,
          col: Math.min(c, Math.max(0, ...newText.split("\n").map((line) => parseRow(line).length - 1))),
        })),
    });

    // Right-click inside a table (source mode / mid-creation) → cell ops.
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        if (this.settings.tableEditing) this.addTableMenu(menu, editor);
      })
    );

    // Paste a URL over selected text → [text](url), like Notion.
    this.registerEvent(
      this.app.workspace.on("editor-paste", (evt, editor) => {
        if (!this.settings.pasteUrlLinks || evt.defaultPrevented) return;
        const clip = evt.clipboardData?.getData("text/plain") ?? "";
        const replacement = buildPasteLink(editor.getSelection(), clip);
        if (!replacement) return;
        evt.preventDefault();
        editor.replaceSelection(replacement);
      })
    );

    this.applyCleanClass();
  }

  private editorView(editor: Editor): EditorView | null {
    return ((editor as unknown as { cm?: EditorView }).cm as EditorView) ?? null;
  }

  /** Rewrite the table under the cursor with `fn`; no-op elsewhere. */
  private withTable(editor: Editor, fn: (text: string) => string) {
    this.editTable(editor, (text) => fn(text), (row, col, _oldText, newText) => ({
      row: nearestTableDataRow(newText, row),
      col,
    }));
  }

  /** The table the cursor is in, with its cell coordinates, or null. */
  private tableCtx(editor: Editor): {
    view: EditorView;
    from: number;
    to: number;
    text: string;
    lines: string[];
    row: number;
    col: number;
  } | null {
    const view = this.editorView(editor);
    if (!view) return null;
    const doc = view.state.doc;
    const cur = editor.getCursor();
    const range = getTableRange(doc, cur.line + 1, scanFences(doc));
    if (!range) return null;
    const from = doc.line(range.startLine).from;
    const to = doc.line(range.endLine).to;
    const text = doc.sliceString(from, to);
    const lines = text.split("\n");
    const row = cur.line + 1 - range.startLine;
    return { view, from, to, text, lines, row, col: cellAt(lines[row] ?? "", cur.ch) };
  }

  /**
   * Rewrite the current table with a cursor-aware op, then re-home the
   * cursor to (targetRow, targetCol) in the reformatted table so a series
   * of edits keeps typing where the user is looking.
   */
  private editTable(
    editor: Editor,
    fn: (text: string, row: number, col: number) => string,
    target?: (
      row: number,
      col: number,
      oldText: string,
      newText: string
    ) => { row: number; col: number }
  ) {
    const c = this.tableCtx(editor);
    if (!c) return;
    const newText = fn(c.text, c.row, c.col);
    if (newText === c.text) return;
    const newLines = newText.split("\n");
    let selection: { anchor: number } | undefined;
    if (target) {
      const tg = target(c.row, c.col, c.text, newText);
      const r = nearestTableDataRow(
        newText,
        Math.max(0, Math.min(tg.row, newLines.length - 1))
      );
      const col = Math.max(0, Math.min(tg.col, Math.max(0, parseRow(newLines[r]).length - 1)));
      const before = newLines.slice(0, r).reduce((s, l) => s + l.length + 1, 0);
      selection = { anchor: c.from + before + cellStart(newLines[r], col) };
    }
    c.view.dispatch({
      changes: { from: c.from, to: c.to, insert: newText },
      selection,
      userEvent: "input",
    });
  }

  /** Add cursor-relative table operations to a right-click editor menu. */
  private addTableMenu(menu: Menu, editor: Editor) {
    const c = this.tableCtx(editor);
    if (!c) return;
    const d = c.lines.findIndex(isDelimRow);
    const onBodyRow = !isDelimRow(c.lines[c.row]) && c.row > (d < 0 ? 0 : d);
    const nCols = Math.max(1, ...c.lines.map((l) => parseRow(l).length));
    const add = (
      title: string,
      icon: string,
      fn: (text: string, row: number, col: number) => string,
      target?: (
        row: number,
        col: number,
        oldText: string,
        newText: string
      ) => { row: number; col: number },
      opts: { disabled?: boolean; warning?: boolean; checked?: boolean } = {}
    ) =>
      menu.addItem((i) => {
        i.setTitle(t(title)).setIcon(icon);
        if (opts.disabled) i.setDisabled(true);
        if (opts.warning) i.setWarning(true);
        if (opts.checked != null) i.setChecked(opts.checked);
        if (!opts.disabled) i.onClick(() => this.editTable(editor, fn, target));
      });

    menu.addSeparator();
    add("Insert row above", "arrow-up-to-line", (t, r) => tableInsertRow(t, r, "above"), (r, col, oldText) => ({
      row: tableInsertRowIndex(oldText, r, "above"),
      col,
    }));
    add("Insert row below", "arrow-down-to-line", (t, r) => tableInsertRow(t, r, "below"), (r, col, oldText) => ({
      row: tableInsertRowIndex(oldText, r, "below"),
      col,
    }));
    add("Insert column left", "arrow-left-to-line", (t, _r, col) => tableInsertColumn(t, col, "left"), (r, col) => ({ row: r, col }));
    add("Insert column right", "arrow-right-to-line", (t, _r, col) => tableInsertColumn(t, col, "right"), (r, col) => ({ row: r, col: col + 1 }));
    menu.addSeparator();
    add("Delete row", "trash-2", (t, r) => tableDeleteRow(t, r), (r, col, _oldText, newText) => ({
      row: nearestTableDataRow(newText, r),
      col,
    }), { disabled: !onBodyRow, warning: onBodyRow });
    add("Delete column", "trash-2", (t, _r, col) => tableDeleteColumn(t, col), (r, col, _oldText, newText) => ({
      row: r,
      col: Math.min(col, Math.max(0, ...newText.split("\n").map((line) => parseRow(line).length - 1))),
    }), { disabled: nCols <= 1, warning: nCols > 1 });
    menu.addSeparator();
    const currentAlign = tableColumnAlignment(c.text, c.col);
    const align = (a: ColumnAlign, title: string, icon: string) =>
      add(title, icon, (t, _r, col) => tableSetAlignment(t, col, a), (r, col) => ({ row: r, col }), {
        checked: currentAlign === a,
      });
    align("none", "Default alignment", "minus");
    align("left", "Align left", "align-left");
    align("center", "Align center", "align-center");
    align("right", "Align right", "align-right");
    menu.addSeparator();
    // Color submenus (also reachable from the floating toolbar; the menu
    // additionally covers empty cells, where nothing can be selected).
    const colorMenu = (
      title: string,
      icon: string,
      current: string | null,
      apply: (color: string | null) => void
    ) =>
      menu.addItem((i) => {
        i.setTitle(t(title)).setIcon(icon);
        const withSub = i as unknown as { setSubmenu?: () => Menu };
        if (typeof withSub.setSubmenu !== "function") return;
        const sub = withSub.setSubmenu();
        for (const name of PALETTE_COLORS) {
          sub.addItem((si) =>
            si
              .setTitle(t(COLOR_LABELS[name]))
              .setIcon("circle")
              .setChecked(current === name)
              .onClick(() => apply(name))
          );
        }
        sub.addItem((si) =>
          si
            .setTitle(t("Remove color"))
            .setIcon("ban")
            .setChecked(current == null)
            .onClick(() => apply(null))
        );
      });
    colorMenu("Cell background", "paint-bucket", cellBgColorAt(c.text, c.row, c.col), (color) =>
      this.editTable(editor, (txt, r, col) => setCellBgAt(txt, r, col, color), (r, col) => ({ row: r, col }))
    );
    colorMenu("Table background", "table", tableBgColor(c.text), (color) =>
      this.withTable(editor, (txt) => tableWithBg(txt, color))
    );
    menu.addItem((i) =>
      i.setTitle(t("Format table")).setIcon("wand-2").onClick(() => this.withTable(editor, formatTable))
    );
  }

  /** Move the block under the cursor above/below its neighbor, cursor riding along. */
  moveBlockVert(editor: Editor, dir: -1 | 1) {
    const view = this.editorView(editor);
    if (!view) return;
    const doc = view.state.doc;
    const fences = scanFences(doc);
    const cur = editor.getCursor();
    const block = getBlockRange(doc, cur.line + 1, fences);
    if (!block) return;
    const offset = cur.line + 1 - block.startLine;

    let newStart: number;
    if (dir === -1) {
      const prev = findPrevBlockStart(doc, fences, block);
      if (prev == null) return;
      const movedStart = moveBlock(
        view,
        block,
        prev,
        fences,
        undefined,
        vaultIndentUnit(this.app)
      );
      if (movedStart == null) return;
      newStart = movedStart;
    } else {
      const next = findNextBlock(doc, fences, block);
      if (!next) return;
      const target = next.endLine + 1;
      const movedStart = moveBlock(
        view,
        block,
        target,
        fences,
        undefined,
        vaultIndentUnit(this.app)
      );
      if (movedStart == null) return;
      newStart = movedStart;
    }
    const line = newStart - 1 + offset;
    const ch = Math.min(cur.ch, editor.getLine(line)?.length ?? 0);
    editor.setCursor({ line, ch });
  }

  duplicateBlock(editor: Editor) {
    const view = this.editorView(editor);
    if (!view) return;
    const doc = view.state.doc;
    const fences = scanFences(doc);
    const cur = editor.getCursor();
    const block = getBlockRange(doc, cur.line + 1, fences);
    if (!block) return;
    const text = doc.sliceString(
      doc.line(block.startLine).from,
      doc.line(block.endLine).to
    );
    const lines = text.split("\n");
    const separator = needsProtectedSeam(lines[lines.length - 1], lines[0])
      ? "\n\n"
      : "\n";
    const nextText = block.endLine < doc.lines
      ? doc.line(block.endLine + 1).text
      : "";
    const suffix = needsProtectedSeam(lines[lines.length - 1], nextText)
      ? "\n"
      : "";
    view.dispatch({
      changes: {
        from: doc.line(block.endLine).to,
        insert: separator + text + suffix,
      },
      userEvent: "input.duplicate",
    });
    editor.setCursor({
      line:
        cur.line +
        (block.endLine - block.startLine + 1) +
        (separator === "\n\n" ? 1 : 0),
      ch: cur.ch,
    });
  }

  onunload() {
    for (const observer of this.tableScrollObservers) observer.disconnect();
    this.tableScrollObservers.clear();
    for (const doc of this.tableScrollDocuments) {
      for (const wrapper of Array.from(doc.querySelectorAll<HTMLElement>(".nf-table-scroll"))) {
        const table = wrapper.querySelector<HTMLTableElement>(":scope > table");
        if (table && wrapper.parentElement) wrapper.parentElement.insertBefore(table, wrapper);
        wrapper.remove();
      }
    }
    this.tableScrollDocuments.clear();
    for (const cls of [
      "nf-clean",
      "nf-dragging",
      "nf-tables",
      "nf-table-stripes",
      "nf-thead-tint",
      "nf-list-color",
    ]) {
      document.body.classList.remove(cls);
    }
    document.body.style.removeProperty("--nf-table-header-bg");
    document.body.style.removeProperty("--nf-list-marker");
  }

  /** Each appearance feature drives its own body class, so table look,
   *  stripes, header tint, and marker color work independently of the
   *  cleaner-rendering toggle. */
  applyCleanClass() {
    document.body.classList.toggle("nf-clean", this.settings.cleanRendering);
    document.body.classList.toggle("nf-tables", this.settings.tableStyle);
    document.body.classList.toggle("nf-table-stripes", this.settings.tableStripes);
    const c = this.settings.tableHeaderColor;
    document.body.classList.toggle("nf-thead-tint", c !== "default");
    if (c === "none") {
      document.body.style.setProperty("--nf-table-header-bg", "transparent");
    } else if ((PALETTE_COLORS as readonly string[]).includes(c)) {
      // Theme palette tint: follows the theme and light/dark mode.
      document.body.style.setProperty(
        "--nf-table-header-bg",
        `rgba(var(--color-${c}-rgb), 0.16)`
      );
    } else {
      document.body.style.removeProperty("--nf-table-header-bg");
    }
    const lm = this.settings.listMarkerColor;
    document.body.classList.toggle("nf-list-color", lm !== "default");
    if (lm === "accent") {
      document.body.style.setProperty("--nf-list-marker", "var(--interactive-accent)");
    } else if ((PALETTE_COLORS as readonly string[]).includes(lm)) {
      document.body.style.setProperty("--nf-list-marker", `var(--color-${lm})`);
    } else {
      document.body.style.removeProperty("--nf-list-marker");
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.applyCleanClass();
    // Re-evaluate editor extensions (nested-indent decorations, handles).
    this.app.workspace.updateOptions();
  }
}

/* ------------------------------------------------------------------ */
/* Settings tab                                                        */
/* ------------------------------------------------------------------ */

const COLOR_LABELS: Record<string, string> = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  cyan: "Cyan",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
};

const NOTION_FLOW_REPO_URL = "https://github.com/xinli12/obsidian-notion-flow";
const NOTION_FLOW_REPO_BLOB_URL = `${NOTION_FLOW_REPO_URL}/blob/main`;
const NOTION_FLOW_DOCS_EN_URL = `${NOTION_FLOW_REPO_BLOB_URL}/README.md`;
const NOTION_FLOW_DOCS_ZH_URL = `${NOTION_FLOW_REPO_BLOB_URL}/README.zh.md`;
const NOTION_FLOW_DEMO_EN_URL =
  `${NOTION_FLOW_REPO_BLOB_URL}/examples/notion-flow-demo.md`;
const NOTION_FLOW_DEMO_ZH_URL =
  `${NOTION_FLOW_REPO_BLOB_URL}/examples/notion-flow-demo.zh.md`;

type BooleanSettingKey = {
  [K in keyof NotionFlowSettings]: NotionFlowSettings[K] extends boolean ? K : never;
}[keyof NotionFlowSettings];

/** Obsidian has no built-in confirm dialog; window.confirm renders a
 * jarring OS chrome dialog and blocks the renderer. This matches the
 * app's modal styling and keyboard handling (Esc cancels). */
class ConfirmModal extends Modal {
  constructor(
    app: App,
    private message: string,
    private cta: string,
    private onConfirm: () => void
  ) {
    super(app);
  }

  onOpen() {
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText(t("Cancel")).onClick(() => this.close())
      )
      .addButton((button) =>
        button
          .setButtonText(this.cta)
          .setWarning()
          .onClick(() => {
            this.close();
            this.onConfirm();
          })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}

class NotionFlowSettingTab extends PluginSettingTab {
  plugin: NotionFlowPlugin;
  private resetButton: HTMLButtonElement | null = null;

  constructor(app: App, plugin: NotionFlowPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /** A toggle setting bound to a boolean settings key. */
  private toggle(
    parent: HTMLElement,
    name: string,
    desc: string,
    key: BooleanSettingKey
  ): Setting {
    return new Setting(parent)
      .setName(t(name))
      .setDesc(t(desc))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings[key]).onChange(async (v) => {
          this.plugin.settings[key] = v;
          await this.plugin.saveSettings();
          this.syncResetButton();
        })
      );
  }

  /** A dropdown of theme palette colors, with leading custom options. */
  private colorDropdown(
    parent: HTMLElement,
    name: string,
    desc: string,
    key: "tableHeaderColor" | "listMarkerColor",
    leading: [string, string][]
  ): Setting {
    return new Setting(parent)
      .setName(t(name))
      .setDesc(t(desc))
      .addDropdown((dd) => {
        for (const [value, label] of leading) dd.addOption(value, t(label));
        for (const c of PALETTE_COLORS) dd.addOption(c, t(COLOR_LABELS[c]));
        dd.setValue(this.plugin.settings[key]).onChange(async (v) => {
          this.plugin.settings[key] = v;
          await this.plugin.saveSettings();
          this.syncResetButton();
        });
      });
  }

  /** Native Obsidian settings heading (supported by the declared 1.5 minimum). */
  private heading(title: string, desc: string): Setting {
    return new Setting(this.containerEl)
      .setName(t(title))
      .setDesc(t(desc))
      .setHeading();
  }

  private usesDefaults(): boolean {
    return (Object.keys(DEFAULT_SETTINGS) as Array<keyof NotionFlowSettings>)
      .every((key) => this.plugin.settings[key] === DEFAULT_SETTINGS[key]);
  }

  private syncResetButton() {
    if (this.resetButton) this.resetButton.disabled = this.usesDefaults();
  }

  private openExternal(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  display(): void {
    this.containerEl.empty();
    this.resetButton = null;

    this.heading(
      "Editing",
      "Core controls for writing, inserting, formatting, and moving blocks."
    );
    this.toggle(
      this.containerEl,
      "Drag-and-drop blocks",
      "Show a drag handle in the left margin to reorder paragraphs, headings, lists, quotes, callouts, tables, and code blocks.",
      "dragHandles"
    );
    this.toggle(
      this.containerEl,
      "Slash commands",
      "Type / to insert headings, lists, callouts, tables, and more.",
      "slashCommands"
    );
    this.toggle(
      this.containerEl,
      "Floating format toolbar",
      "Show text formatting on selection and table actions when a cell is active.",
      "floatingToolbar"
    );
    this.toggle(
      this.containerEl,
      "Paste URLs as links",
      "Pasting a URL over selected text turns it into [text](url).",
      "pasteUrlLinks"
    );

    this.heading(
      "Tables",
      "Combine table editing, visual styling, header tint, and stripes independently."
    );
    this.toggle(
      this.containerEl,
      "Table editing enhancements",
      "In tables, Tab and Enter move between cells, and new rows are added automatically at the end.",
      "tableEditing"
    );
    this.toggle(
      this.containerEl,
      "Notion-style tables",
      "Rounded outer border, clearer focus and hover states, and comfortable cell spacing.",
      "tableStyle"
    );
    this.colorDropdown(
      this.containerEl,
      "Table header background",
      "Background tint of table header rows.",
      "tableHeaderColor",
      [["default", "Theme default"], ["none", "None"]]
    );
    this.toggle(
      this.containerEl,
      "Striped table rows",
      "Shade every other table row.",
      "tableStripes"
    );

    this.heading(
      "Appearance",
      "Tune Markdown rendering and colors without changing the meaning of your notes."
    );
    this.toggle(
      this.containerEl,
      "Cleaner WYSIWYG rendering",
      "Apply display-only polish to quotes, dividers, headings, tasks, and inline code in Live Preview and Reading view. List cycles stay enabled independently. Your Markdown is never changed.",
      "cleanRendering"
    );
    this.toggle(
      this.containerEl,
      "Conceal HTML formatting tags",
      "Hide the raw <span>, <mark>, and <u> tags written by the formatting tools in Live Preview.",
      "concealHtml"
    );
    this.colorDropdown(
      this.containerEl,
      "List marker color",
      "Color of bullets and list numbers.",
      "listMarkerColor",
      [["accent", "Accent color"], ["default", "Theme default"]]
    );

    this.heading(
      "Markdown syntax",
      "Choose whether inline formatting source should stay visible in Live Preview."
    );
    this.toggle(
      this.containerEl,
      "Conceal inline Markdown syntax",
      "Hide the non-text markers in **bold**, *italic*, ~~strikethrough~~, `inline code`, and ==highlight==. Links stay fully visible and editable. A marker reappears only when the caret enters its source; Source mode is unchanged.",
      "concealMarkdown"
    );

    this.heading(
      "Help & examples",
      "Open documentation and guided example notes in English or Chinese."
    );
    new Setting(this.containerEl)
      .setName(t("Documentation"))
      .setDesc(t("Complete setup, feature, keyboard, and troubleshooting guide."))
      .addButton((button) =>
        button
          .setButtonText("English")
          .onClick(() => this.openExternal(NOTION_FLOW_DOCS_EN_URL))
      )
      .addButton((button) =>
        button
          .setButtonText("简体中文")
          .onClick(() => this.openExternal(NOTION_FLOW_DOCS_ZH_URL))
      );
    new Setting(this.containerEl)
      .setName(t("Example notes"))
      .setDesc(t("Hands-on tours you can copy into your vault."))
      .addButton((button) =>
        button
          .setButtonText("English")
          .onClick(() => this.openExternal(NOTION_FLOW_DEMO_EN_URL))
      )
      .addButton((button) =>
        button
          .setButtonText("简体中文")
          .onClick(() => this.openExternal(NOTION_FLOW_DEMO_ZH_URL))
      );
    this.heading(
      "About",
      "Plugin version, source code, and issue reporting."
    );
    new Setting(this.containerEl)
      .setName(`Notion Flow v${this.plugin.manifest.version}`)
      .setDesc(t("Open source under the MIT license."))
      .addButton((button) =>
        button
          .setButtonText("GitHub")
          .setTooltip(NOTION_FLOW_REPO_URL)
          .onClick(() => this.openExternal(NOTION_FLOW_REPO_URL))
      )
      .addButton((button) =>
        button
          .setButtonText(t("Report an issue"))
          .setTooltip(`${NOTION_FLOW_REPO_URL}/issues`)
          .onClick(() => this.openExternal(`${NOTION_FLOW_REPO_URL}/issues`))
      );
    new Setting(this.containerEl)
      .setName(t("Restore defaults"))
      .setDesc(t("Reset every Notion Flow option to its original value."))
      .addButton((button) => {
        button
          .setButtonText(t("Restore defaults"))
          .setWarning()
          .onClick(() => {
            new ConfirmModal(
              this.app,
              t("Reset all Notion Flow settings to their defaults?"),
              t("Restore defaults"),
              async () => {
                this.plugin.settings = { ...DEFAULT_SETTINGS };
                await this.plugin.saveSettings();
                this.display();
                new Notice(t("Notion Flow settings restored."));
              }
            ).open();
          });
        this.resetButton = button.buttonEl;
      });
    this.syncResetButton();
  }
}
