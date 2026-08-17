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
  Platform,
  Plugin,
  PluginSettingTab,
  Scope,
  Setting,
  TFile,
  editorLivePreviewField,
  htmlToMarkdown,
  requestUrl,
  setIcon,
} from "obsidian";
import type { EventRef } from "obsidian";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  keymap,
  runScopeHandlers,
} from "@codemirror/view";
import {
  EditorSelection,
  EditorState,
  Prec,
  Range,
  RangeSetBuilder,
  StateEffect,
  StateField,
  Text,
  Transaction,
  findClusterBreak,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { autocompletion } from "@codemirror/autocomplete";
import type { Completion, CompletionContext } from "@codemirror/autocomplete";
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
  /** Pasting a bare URL fetches the page title → [Title](url). */
  pasteUrlTitles: boolean;
  tableEditing: boolean;
  /** Quote/Callout QoL: smart Enter/Backspace, quoted pastes, type menu. */
  calloutEditing: boolean;
  /** Code block QoL: indent-keeping Enter, indent-level Backspace,
   *  fence auto-close, and Mod+Shift+Enter to exit below the block. */
  codeBlockEditing: boolean;
  /** Tab / Shift+Tab step a non-list block through the same nesting
   *  levels a sideways drag offers. */
  blockIndent: boolean;
  /** Markdown shorthand that expands as it is typed: ">!" opens a Callout,
   *  "[]" a to-do. */
  inputRules: boolean;
  /** Escape selects the block holding the caret, arrows walk the
   *  selection, Enter returns to writing. */
  blockSelectKey: boolean;
  /** Show "Type / for commands" on the empty line holding the caret. */
  emptyLineHint: boolean;
  /** Notion-style columns: [!nf-cols]/[!nf-col] callouts render side by
   *  side; slash commands, the block menu, and right-edge drops build them. */
  columnLayout: boolean;
  /** Notion-style toggles: a [!nf-toggle] callout renders as a bare
   *  triangle + title whose content folds away, state kept in the note. */
  toggleBlocks: boolean;
  /** Notion-style comments: selection-anchored notes stored in a span's
   *  data attribute, shown as a yellow anchor + 💬 icon. */
  commenting: boolean;
  /** Notion-like table chrome: rounded border, header wash, row hover. */
  tableStyle: boolean;
  /** Hide the plugin's own inline HTML color tags while editing. */
  concealHtml: boolean;
  /** Conceal inline Markdown formatting markers in Live Preview. */
  concealMarkdown: boolean;
  /** Conceal a heading's "#" run on the active line too, so a heading
   *  looks like one the moment it is typed. */
  concealHeadings: boolean;
  /** "default" (theme), "none", or a theme palette color name (red …). */
  tableHeaderColor: string;
  tableStripes: boolean;
  /** "accent", "default" (theme), or a theme palette color name. */
  listMarkerColor: string;
  /** "text" (neutral ink), "accent", "default" (theme), or a palette color. */
  quoteBarColor: string;
  /** "default" (theme) or a theme palette color name. Notion inks `code`
   *  red, so red is the default. */
  inlineCodeColor: string;
  /** "default" keeps the active Obsidian theme; the other values apply a
   *  bundled syntax palette to fenced code blocks only. */
  codeTheme: string;
}

const DEFAULT_SETTINGS: NotionFlowSettings = {
  dragHandles: true,
  slashCommands: true,
  floatingToolbar: true,
  cleanRendering: true,
  pasteUrlLinks: true,
  pasteUrlTitles: true,
  tableEditing: true,
  calloutEditing: true,
  codeBlockEditing: true,
  blockIndent: true,
  inputRules: true,
  blockSelectKey: true,
  emptyLineHint: true,
  columnLayout: true,
  toggleBlocks: true,
  commenting: true,
  tableStyle: true,
  concealHtml: true,
  concealMarkdown: true,
  concealHeadings: true,
  tableHeaderColor: "default",
  tableStripes: false,
  listMarkerColor: "accent",
  quoteBarColor: "text",
  inlineCodeColor: "red",
  codeTheme: "default",
};

/** The writing palette. */
const PALETTE_COLORS = [
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "purple",
  "pink",
] as const;

type PaletteColor = (typeof PALETTE_COLORS)[number];

/**
 * Low-chroma ink, one hue per palette entry. Obsidian's --color-* variables
 * are UI signal colors (its light-mode red is a near-neon #e93147) and read
 * as shouting inside a sentence, so the palette is the plugin's own muted
 * set, defined per light/dark mode in styles.css as --nf-<name>. The hex
 * here is the light-mode value and rides along as the var() fallback, so a
 * colored note still carries its color where the plugin's CSS is absent
 * (HTML export, plugin disabled).
 */
const PALETTE_INK: Record<PaletteColor, { hex: string; rgb: string }> = {
  gray: { hex: "#7c7b77", rgb: "124,123,119" },
  red: { hex: "#b5554d", rgb: "181,85,77" },
  orange: { hex: "#b87333", rgb: "184,115,51" },
  yellow: { hex: "#a9822f", rgb: "169,130,47" },
  green: { hex: "#4e8060", rgb: "78,128,96" },
  cyan: { hex: "#43868c", rgb: "67,134,140" },
  blue: { hex: "#4a7ca6", rgb: "74,124,166" },
  purple: { hex: "#7f62a3", rgb: "127,98,163" },
  pink: { hex: "#a85480", rgb: "168,84,128" },
};

function paletteTextColor(color: PaletteColor | string): string {
  const ink = PALETTE_INK[color as PaletteColor];
  return ink ? `var(--nf-${color}, ${ink.hex})` : `var(--nf-${color})`;
}

function paletteTint(color: PaletteColor | string, alpha: number): string {
  const ink = PALETTE_INK[color as PaletteColor];
  return ink
    ? `rgba(var(--nf-${color}-rgb, ${ink.rgb}), ${alpha})`
    : `rgba(var(--nf-${color}-rgb), ${alpha})`;
}

const CODE_THEMES = [
  "default",
  "obsidian",
  "github",
  "vscode",
  "one-dark",
  "catppuccin",
  "tokyo-night",
  "gruvbox",
  "dracula",
  "nord",
  "solarized",
] as const;
const CODE_THEME_LABELS: Record<(typeof CODE_THEMES)[number], string> = {
  default: "Theme default",
  obsidian: "Obsidian adaptive",
  github: "GitHub",
  vscode: "VS Code",
  "one-dark": "One Dark",
  catppuccin: "Catppuccin",
  "tokyo-night": "Tokyo Night",
  gruvbox: "Gruvbox",
  dracula: "Dracula",
  nord: "Nord",
  solarized: "Solarized",
};

/** Responsive Mermaid sizing kept separate from the DOM hook so the wide
 * diagram threshold and cap remain predictable across themes and pane sizes. */
export function mermaidViewport(
  rawWidth: number,
  rawHeight: number,
  availableWidth: number
): { wide: boolean; width: number } {
  const available = Math.max(1, Number.isFinite(availableWidth) ? availableWidth : 1);
  const aspect = rawHeight > 0 && Number.isFinite(rawWidth / rawHeight)
    ? rawWidth / rawHeight
    : 1;
  const wide = aspect > 1.85;
  const width = wide
    ? Math.ceil(
        Math.min(1600, available * Math.min(2.2, Math.max(1.12, aspect / 1.55)))
      )
    : available;
  return { wide, width };
}

/* ------------------------------------------------------------------ */
/* Paste URL over selection → markdown link                            */
/* ------------------------------------------------------------------ */

const RE_URL = /^(https?|obsidian):\/\/\S+$/i;

const RE_HTTP_URL = /^https?:\/\/\S+$/i;

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

/* ------------------------------------------------------------------ */
/* Block detection (shared by drag & drop)                             */
/* ------------------------------------------------------------------ */

interface BlockRange {
  startLine: number; // 1-based
  endLine: number; // 1-based, inclusive
  /** Quote markers ("> ", "> > ") every row of this block carries because
   *  it is one row INSIDE a quote/Callout rather than the container itself.
   *  Absent for top-level blocks and for a whole quote container. */
  quotePrefix?: string;
}

export interface BlockTextChange {
  from: number;
  to: number;
  insert: string;
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
// A quote marker may follow the content indentation of a list item that is
// itself inside another quote (`>   > child`).  Keep that indentation in the
// prefix instead of requiring every marker to be adjacent.  Several block
// models share this exact spelling; having one definition prevents fences,
// tables, captions and drag/drop from disagreeing about the same Markdown.
const RE_QUOTE_PREFIX = /^(?:[ \t]*>)+[ \t]?/;
const RE_QUOTE_ONLY = /^(?:[ \t]*>)+[ \t]*$/;

/** A blockquote marker used as the first child of a list item on the same
 * source line (`- > quote`). Obsidian's HyperMD tree styles that row as a
 * list line, so Live Preview otherwise exposes the `>` as plain text and
 * omits the quote rule even though Reading view parses it as a blockquote. */
export function inlineListQuoteMarker(
  text: string
): { from: number; to: number } | null {
  const match = text.match(/^(\s*)(?:[-*+]|\d+[.)])([ \t]+)>/);
  if (!match) return null;
  const from = match[0].length - 1;
  return { from, to: from + 1 };
}

/** A list marker on a blockquote line (`> - item`). HyperMD gives lines
 * inside a quote nothing but quote classes — no HyperMD-list-line, no
 * cm-formatting-list — so Live Preview shows a literal dash where Reading
 * view draws a bullet. Offsets are into `text`. */
export function quotedListMarker(
  text: string
): { from: number; to: number; ordered: boolean } | null {
  const prefix = quoteMarkerPrefix(text);
  if (!prefix) return null;
  const rest = text.slice(prefix.length);
  const match = rest.match(/^([ \t]*)([-*+]|\d{1,9}[.)])(?=[ \t])/);
  if (!match) return null;
  const marker = match[2];
  const from = prefix.length + match[1].length;
  return {
    from,
    to: from + marker.length,
    ordered: !/^[-*+]$/.test(marker),
  };
}

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
  const fences = cachedFences(doc);
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
    // A fence opening right on a list-marker line ("- ```js") still IS a
    // list item — let it fall through to normal marker handling.
    if (fence && !(lineNo === fence.startLine && fence.markerOpener)) {
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
  fences: FenceRange[] = cachedFences(doc)
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
  indent: number; // content indent column of the block
  /** False only for a trailing fence that never found its closing marker. */
  closed: boolean;
  /** The opening ``` / ~~~ marker (used to write a matching closer). */
  marker: string;
  /** Leading text a body or closer line needs to sit in this block —
   *  the opener's whitespace, plus marker-width spaces when the fence
   *  opens directly on a list-item line ("- ```js"). */
  bodyPrefix: string;
  /** Quote markers before the fence (for example `> ` or `> > `), without
   *  the ordinary whitespace indentation that precedes them. */
  quotePrefix: string;
  quoteDepth: number;
  /** True when the opener shares its line with a list marker. */
  markerOpener: boolean;
}

export type BlockCaptionKind = "code" | "image" | "table";

/** Portable metadata/caption row written immediately after its block.
 * It remains ordinary readable HTML in other Markdown renderers, while
 * Notion Flow turns it into a Notion-style caption editor. */
export interface BlockCaptionMeta {
  kind: BlockCaptionKind;
  caption: string;
  collapsed: boolean;
  prefix: string;
}

const RE_BLOCK_CAPTION_BODY =
  /^<small class="nf-caption" data-nf-kind="(code|image|table)"(?: data-nf-collapsed="true")?>(.*?)<\/small>[ \t]*$/;

/** Indentation plus every quote/list-container marker before visible block
 * content. The quote matcher retains list content indentation between quote
 * levels (`>   >`) and this helper also absorbs indentation after the final
 * marker (`>   | cell |`). */
function structuralContentPrefix(text: string): string {
  const quoted = quoteMarkerPrefix(text);
  let end = quoted?.length ?? 0;
  if (!quoted) {
    end = text.match(/^[ \t]*/)?.[0].length ?? 0;
  } else {
    while (text[end] === " " || text[end] === "\t") end++;
  }
  return text.slice(0, end);
}

/** Parse one canonical Notion Flow caption row. */
export function parseBlockCaption(text: string): BlockCaptionMeta | null {
  const prefix = structuralContentPrefix(text);
  const match = text.slice(prefix.length).match(RE_BLOCK_CAPTION_BODY);
  if (!match) return null;
  return {
    kind: match[1] as BlockCaptionKind,
    caption: decodeCommentAttr(match[2]),
    collapsed: text.includes(' data-nf-collapsed="true"'),
    prefix,
  };
}

/** Serialize a caption row. Empty code captions are retained only when
 * they carry a collapsed state; image and table captions, which have no
 * fold state to remember, are always non-empty or absent. */
export function buildBlockCaption(
  kind: BlockCaptionKind,
  caption: string,
  collapsed = false,
  prefix = ""
): string | null {
  const body = caption.replace(/\r?\n+/g, " ").trim();
  if (!body && !(kind === "code" && collapsed)) return null;
  return (
    prefix +
    `<small class="nf-caption" data-nf-kind="${kind}"` +
    (kind === "code" && collapsed ? ' data-nf-collapsed="true"' : "") +
    `>${encodeCommentAttr(body)}</small>`
  );
}

const RE_FENCE_OPEN = /^(\s*)(`{3,}|~{3,})(.*)$/;
// CommonMark also allows a fence to open right on a list-marker line.
const RE_FENCE_OPEN_ITEM = /^(\s*)((?:[-*+]|\d+[.)])[ \t]+)(`{3,}|~{3,})(.*)$/;

/**
 * Every prefix a fence marker can carry: indentation, quote markers, the
 * indentation the fence has inside the quote, and a list marker it opens
 * on. Peeling these apart rather than matching a handful of fixed shapes
 * is what lets a code block live wherever Markdown allows one — a fence
 * inside a list inside a Callout is all four at once.
 *
 * Two passes, not one: in a single pattern the whitespace before and after
 * the (possibly empty) quote markers can be split any number of ways, and
 * a line that turns out to hold no fence makes the engine try all of them.
 * Matched separately, the container part always succeeds and the marker
 * part has only one place to start.
 */
const RE_FENCE_MARKER =
  /^([ \t]*)((?:[-*+]|\d+[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/;

interface FenceLineParts {
  /** Indentation before any quote markers. */
  ws: string;
  /** A list marker that comes before the first quote marker (`- > ``` `). */
  outerListMarker: string;
  /** Quote markers as the source spells them ("" outside a quote). */
  quotePrefix: string;
  quoteDepth: number;
  /** Indentation the fence has *inside* its quote container. */
  innerWs: string;
  /** List marker the fence opens on, or "". */
  listMarker: string;
  marker: string;
  info: string;
}

function fenceLineParts(text: string): FenceLineParts | null {
  const ws = text.match(/^[ \t]*/)?.[0] ?? "";
  let rest = text.slice(ws.length);
  let outerListMarker = "";
  let quotePrefix = "";

  // Quote-first is the common path, and quoteMarkerPrefix deliberately
  // accepts list content indentation between markers (`>   >`).
  const quoted = quoteMarkerPrefix(text);
  if (quoted) {
    quotePrefix = quoted.slice(ws.length);
    rest = text.slice(quoted.length);
  } else {
    // A fence may open on a list item whose first child is a quote:
    // `- > ```js`.  The list marker remains visible while the quote/fence
    // token becomes the visual code header; body rows carry the marker's
    // content indentation instead (`  > code`).
    const item = rest.match(/^((?:[-*+]|\d+[.)])[ \t]+)(?=>)/);
    if (item) {
      const afterItem = rest.slice(item[1].length);
      const innerQuote = quoteMarkerPrefix(afterItem);
      if (innerQuote) {
        outerListMarker = item[1];
        quotePrefix = innerQuote;
        rest = afterItem.slice(innerQuote.length);
      }
    }
  }

  const marker = rest.match(RE_FENCE_MARKER);
  if (!marker) return null;
  return {
    ws,
    outerListMarker,
    quotePrefix,
    quoteDepth: (quotePrefix.match(/>/g) ?? []).length,
    innerWs: marker[1],
    listMarker: marker[2] ?? "",
    marker: marker[3],
    info: marker[4],
  };
}

/** Source indentation carried between quote markers, beyond the single
 * optional padding character each marker owns.  This is the list content
 * column in a path such as `>   >` (two extra columns). */
function quoteInterMarkerIndent(prefix: string): number {
  const markers = [...prefix.matchAll(/>/g)];
  let columns = 0;
  for (let i = 0; i + 1 < markers.length; i++) {
    const from = (markers[i].index ?? 0) + 1;
    const to = markers[i + 1].index ?? from;
    let gap = prefix.slice(from, to);
    if (gap[0] === " " || gap[0] === "\t") gap = gap.slice(1);
    columns += indentWidth(gap);
  }
  return columns;
}

/**
 * Scan the whole document once and return all fenced code blocks.
 * Handles indented fences (inside lists/quotes), fences opening on a
 * list-marker line, tilde fences, marker-length matching per CommonMark,
 * and an unclosed trailing fence.
 */
export function scanFences(doc: Text): FenceRange[] {
  const fences: FenceRange[] = [];
  let openLine = -1;
  let openChar = "";
  let openLen = 0;
  let openIndent = 0;
  let openMarker = "";
  let openBodyPrefix = "";
  let openQuotePrefix = "";
  let openQuoteDepth = 0;
  let openOnItem = false;
  for (let i = 1; i <= doc.lines; i++) {
    const text = doc.line(i).text;
    // A fenced block cannot lazily continue after its blockquote container
    // ends.  Finalise it at that boundary instead of letting an unfinished
    // quoted fence swallow the rest of the note as code.
    if (
      openLine >= 0 &&
      openQuoteDepth > 0 &&
      quotePrefixDepth(quoteMarkerPrefix(text) ?? "") < openQuoteDepth
    ) {
      fences.push({
        startLine: openLine,
        endLine: Math.max(openLine, i - 1),
        indent: openIndent,
        closed: false,
        marker: openMarker,
        bodyPrefix: openBodyPrefix,
        quotePrefix: openQuotePrefix,
        quoteDepth: openQuoteDepth,
        markerOpener: openOnItem,
      });
      openLine = -1;
      i--;
      continue;
    }
    const parts = fenceLineParts(text);
    if (openLine < 0) {
      // Backtick info strings cannot themselves contain a backtick.
      if (parts && !(parts.marker[0] === "`" && parts.info.includes("`"))) {
        const outerIndent = indentWidth(parts.ws);
        const outerContentIndent = parts.outerListMarker
          ? listContentIndent(parts.ws + parts.outerListMarker) ?? outerIndent
          : outerIndent;
        openLine = i;
        openChar = parts.marker[0];
        openLen = parts.marker.length;
        openMarker = parts.marker;
        openOnItem =
          parts.outerListMarker !== "" || parts.listMarker !== "";
        openQuotePrefix = parts.quotePrefix;
        openQuoteDepth = parts.quoteDepth;
        if (parts.quoteDepth > 0) {
          // `indent` stays in the outer document's columns: it is what the
          // surrounding list compares its content column against. The body
          // prefix is the full container path, so a block nested in a list
          // inside a Callout keeps both the markers and the list column.
          const inner = parts.innerWs + parts.listMarker;
          const innerColumn = parts.listMarker
            ? listContentIndent(inner) ?? indentWidth(parts.innerWs)
            : indentWidth(parts.innerWs);
          openIndent =
            outerContentIndent +
            quoteInterMarkerIndent(parts.quotePrefix) +
            innerColumn;
          const beforeQuote = parts.outerListMarker
            ? parts.ws + " ".repeat(Math.max(0, outerContentIndent - outerIndent))
            : parts.ws;
          openBodyPrefix =
            beforeQuote + parts.quotePrefix + " ".repeat(innerColumn);
        } else if (parts.listMarker) {
          openIndent = listContentIndent(text) ?? outerIndent;
          openBodyPrefix =
            parts.ws + " ".repeat(Math.max(0, openIndent - outerIndent));
        } else {
          openIndent = outerIndent;
          openBodyPrefix = parts.ws;
        }
      }
    } else {
      // A closing marker never rides on a list marker: that row opens a new
      // item, so it cannot also be this block's terminator.
      if (!(
        parts &&
        parts.outerListMarker === "" &&
        parts.listMarker === "" &&
        parts.quoteDepth === openQuoteDepth &&
        parts.marker[0] === openChar &&
        parts.marker.length >= openLen &&
        /^[ \t]*$/.test(parts.info) &&
        indentWidth(parts.ws) <= openIndent + 3
      )) continue;
      fences.push({
        startLine: openLine,
        endLine: i,
        indent: openIndent,
        closed: true,
        marker: openMarker,
        bodyPrefix: openBodyPrefix,
        quotePrefix: openQuotePrefix,
        quoteDepth: openQuoteDepth,
        markerOpener: openOnItem,
      });
      openLine = -1;
    }
  }
  if (openLine > 0) {
    fences.push({
      startLine: openLine,
      endLine: doc.lines,
      indent: openIndent,
      closed: false,
      marker: openMarker,
      bodyPrefix: openBodyPrefix,
      quotePrefix: openQuotePrefix,
      quoteDepth: openQuoteDepth,
      markerOpener: openOnItem,
    });
  }
  return fences;
}

/** scanFences memoized on the (immutable) document identity. Key handlers,
 * paste hooks, and toolbar refreshes all ask for the same doc's fences many
 * times per keystroke — one scan serves them all.
 *
 * Keyed per document rather than held in one slot: split panes and the
 * column sub-editors interleave requests for different documents, and a
 * single slot made each of those a miss, re-scanning both documents on
 * every keystroke. Documents are immutable, so an entry stays valid for as
 * long as anything can still ask about it, and the map lets the rest go. */
const fenceCache = new WeakMap<Text, FenceRange[]>();
export function cachedFences(doc: Text): FenceRange[] {
  let fences = fenceCache.get(doc);
  if (!fences) {
    fences = scanFences(doc);
    fenceCache.set(doc, fences);
  }
  return fences;
}

/**
 * The fence containing `lineNo`, or null. Binary search rather than a walk:
 * this is the single hottest predicate in the plugin (every block-range,
 * quote-container and decoration pass consults it per line), so a linear
 * scan made whole-document analysis O(lines x fences). scanFences() emits
 * ranges in ascending, non-overlapping line order and every caller passes
 * either that array or an order-preserving filter of it, so the invariant
 * the search needs holds by construction.
 */
function fenceAt(fences: FenceRange[], lineNo: number): FenceRange | null {
  let lo = 0;
  let hi = fences.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const f = fences[mid];
    if (lineNo < f.startLine) hi = mid - 1;
    else if (lineNo > f.endLine) lo = mid + 1;
    else return f;
  }
  return null;
}

/** Caption metadata directly following a closed fence. */
export function codeCaptionMeta(
  doc: Text,
  fence: FenceRange
): (BlockCaptionMeta & { lineNo: number }) | null {
  if (!fence.closed || fence.endLine >= doc.lines) return null;
  const lineNo = fence.endLine + 1;
  const meta = parseBlockCaption(doc.line(lineNo).text);
  return meta?.kind === "code" ? { ...meta, lineNo } : null;
}

/** A full-line Markdown or wiki image/embed. Caption metadata is kept as
 * a second row in the same draggable block. */
const RE_IMAGE_BLOCK =
  /^[ \t]*(?:!\[[^\]\r\n]*\]\([^\r\n)]+\)|!\[\[[^\]\r\n]+\]\])[ \t]*$/;

export function isImageBlockLine(text: string): boolean {
  return RE_IMAGE_BLOCK.test(text);
}

export function imageCaptionMeta(
  doc: Text,
  imageLine: number
): (BlockCaptionMeta & { lineNo: number }) | null {
  if (imageLine < 1 || imageLine >= doc.lines) return null;
  const meta = parseBlockCaption(doc.line(imageLine + 1).text);
  return meta?.kind === "image" ? { ...meta, lineNo: imageLine + 1 } : null;
}

/** Caption metadata following a table. Unlike an image the owner spans
 * several rows, so the caption is looked up from the table's LAST row. */
export function tableCaptionMeta(
  doc: Text,
  tableEndLine: number
): (BlockCaptionMeta & { lineNo: number }) | null {
  if (tableEndLine < 1 || tableEndLine >= doc.lines) return null;
  const meta = parseBlockCaption(doc.line(tableEndLine + 1).text);
  return meta?.kind === "table" ? { ...meta, lineNo: tableEndLine + 1 } : null;
}

/**
 * The fence whose BODY (marker lines excluded) contains both document
 * positions, or null. Formatting switches to HTML tags there: Markdown
 * markers inside fenced code stay literal text and never render.
 */
export function fenceBodyRange(
  doc: Text,
  from: number,
  to: number,
  fences: FenceRange[] = cachedFences(doc)
): FenceRange | null {
  const a = doc.lineAt(from).number;
  const b = doc.lineAt(to).number;
  const fence = fenceAt(fences, a);
  if (!fence || fenceAt(fences, b) !== fence) return null;
  const bodyEnd = fence.closed ? fence.endLine - 1 : fence.endLine;
  return a > fence.startLine && b <= bodyEnd ? fence : null;
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
  const bodyEnd = fence.closed ? fence.endLine - 1 : fence.endLine;
  for (let n = fence.startLine + 1; n <= bodyEnd; n++) {
    if (doc.line(n).text.trim()) lines.push(n);
  }
  return lines;
}

/** The code a fence holds, as it would be pasted elsewhere: quote markers
 * and the block's own indentation shed, the code's own indentation kept. */
export function fenceBodyText(doc: Text, fence: FenceRange): string {
  const bodyEnd = fence.closed ? fence.endLine - 1 : fence.endLine;
  const rows: string[] = [];
  for (let n = fence.startLine + 1; n <= bodyEnd; n++) {
    let text = doc.line(n).text;
    if (fence.quoteDepth > 0) {
      const prefix = quoteMarkerPrefix(text);
      // A row without markers has left the quote; so has the code.
      if (prefix == null) break;
      text = text.slice(prefix.length);
    }
    rows.push(text.slice(indentCharsForColumns(text, fence.indent)));
  }
  return rows.join("\n");
}

/** Compute the logical block containing the given line. */
export function getBlockRange(
  doc: Text,
  lineNo: number,
  fences: FenceRange[] = cachedFences(doc)
): BlockRange | null {
  if (lineNo < 1 || lineNo > doc.lines) return null;

  // A caption row belongs to the media/code directly above it. Resolving
  // from either row must return the same block so drag, duplicate, copy,
  // and delete never strand the caption or folding state.
  // A line inside a fenced block is code, whatever it spells — including a
  // row that happens to look like a caption.
  const ownCaption = fenceAt(fences, lineNo)
    ? null
    : parseBlockCaption(doc.line(lineNo).text);
  if (ownCaption && lineNo > 1) {
    // Only a block that actually ENDS on the row above can adopt the
    // caption. When that row is itself absorbed by something larger — an
    // image taken as a quote's lazy continuation, say — adopting it would
    // put the same line in two different blocks.
    const above = getBlockRange(doc, lineNo - 1, fences);
    const previousText = doc.line(lineNo - 1).text;
    const previousFence = fenceAt(fences, lineNo - 1);
    const ownerStart =
      ownCaption.kind === "code"
        ? previousFence?.closed && previousFence.endLine === lineNo - 1
          ? previousFence.startLine
          : null
        : ownCaption.kind === "table"
          ? isTableRow(previousText)
            ? getTableRange(doc, lineNo - 1, fences)?.startLine ?? null
            : null
          : isImageBlockLine(previousText)
            ? lineNo - 1
            : null;
    // The owner must be exactly the block the row above starts — it either
    // ends there or already reaches this caption. If that row belongs to
    // something larger, the caption stays on its own.
    if (
      ownerStart !== null &&
      above?.startLine === ownerStart &&
      above.endLine >= lineNo - 1 &&
      above.endLine <= lineNo
    ) {
      return { startLine: ownerStart, endLine: lineNo };
    }
  }
  // A caption row whose owner is gone (deleted, or moved away) is its own
  // block. Falling through would send it to the paragraph branch, which
  // walks BACKWARD into the prose above — while that prose, scanning
  // forward, deliberately stops at a caption row. Two rows would then
  // report different ranges for the same block, so a marquee counted the
  // paragraph twice and dragging the orphan carried the paragraph with it.
  if (ownCaption) return { startLine: lineNo, endLine: lineNo };

  // Any line inside a fenced code block (markers, code, blank lines, and
  // lines that merely LOOK like lists/headings) → the whole fence.
  const fence = fenceAt(fences, lineNo);
  if (fence) {
    return {
      startLine: fence.startLine,
      endLine: codeCaptionMeta(doc, fence)?.lineNo ?? fence.endLine,
    };
  }

  const line = doc.line(lineNo);
  const text = line.text;

  // Hovering a lazy continuation should resolve back to the owning quote or
  // list paragraph, not produce a second independently draggable block.
  //
  // Asked before the per-type branches below, because the owner's answer is
  // what decides: a quote or list item extends over the rows it absorbs, and
  // an image or table row that lands inside that reach used to answer with
  // itself — the same line in two blocks, which double-counted a marquee
  // selection and let a drag take a row its owner still claimed. The
  // `endLine >= lineNo` guard keeps this to rows genuinely absorbed.
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

  // A blank line is its own single-line block, so it can be hovered,
  // dragged out of the way, or deleted from the handle menu like any
  // other block (Notion treats empty blocks the same way).
  if (RE_BLANK.test(text)) return { startLine: lineNo, endLine: lineNo };

  // Heading: single line.
  if (RE_HEADING.test(text)) return { startLine: lineNo, endLine: lineNo };

  // Horizontal rule: single line. Treating it as a paragraph would make a
  // drag/delete carry the following paragraph and may create a setext H2.
  if (RE_HR.test(text)) return { startLine: lineNo, endLine: lineNo };

  if (isImageBlockLine(text)) {
    return {
      startLine: lineNo,
      endLine: imageCaptionMeta(doc, lineNo)?.lineNo ?? lineNo,
    };
  }

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
        lazyGrabbable(doc.line(end + 1).text) &&
        // A caption belongs to the block it labels, never to a quote above
        // it. Absorbing one here would contradict the caption row's own
        // answer and put the same line in two blocks.
        !parseBlockCaption(doc.line(end + 1).text)
      ) end++;
    }
    return { startLine: start, endLine: end };
  }

  // Table: contiguous "|" rows (header, delimiter, body) are one block —
  // dragging, highlighting, or deleting a table always takes all of it.
  if (RE_TABLE.test(text)) {
    const table = getTableRange(doc, lineNo, fences);
    if (!table) return null;
    return {
      startLine: table.startLine,
      endLine: tableCaptionMeta(doc, table.endLine)?.lineNo ?? table.endLine,
    };
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
        RE_HEADING.test(t) || RE_HR.test(t) ||
        // A caption row resolves to the block it labels, so it can never be
        // this item's lazy paragraph continuation.
        parseBlockCaption(t) !== null;
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

  // Plain paragraph: contiguous non-blank, non-special lines (never
  // absorbing fence lines).
  const isPlain = (n: number) => {
    if (fenceAt(fences, n)) return false;
    const t = doc.line(n).text;
    return (
      !parseBlockCaption(t) &&
      !isImageBlockLine(t) &&
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

/* ------------------------------------------------------------------ */
/* Quote/Callout interiors                                             */
/*                                                                     */
/* getBlockRange() answers "which block is this line part of" and, for  */
/* a quote, deliberately answers with the whole container: that is the  */
/* thing Reading View draws as one box. Editing wants the opposite      */
/* answer too — the single paragraph, list item or fence a row really   */
/* is — so a row inside a Callout can be hovered, dragged and dropped   */
/* on its own. Both come from the same rules: strip the quote markers   */
/* and the body IS an ordinary document.                               */
/* ------------------------------------------------------------------ */

/**
 * Split `depth` quote markers off the front of a source row: the prefix is
 * what the row carries because it lives inside that many containers, the
 * rest is the content they hold. A lazy continuation row carries no marker
 * and keeps all of its text.
 */
export function splitQuoteMarkers(
  text: string,
  depth: number
): { prefix: string; rest: string } {
  let i = 0;
  let found = 0;
  for (let level = 0; level < depth; level++) {
    // Whitespace between quote markers is meaningful: it may be the content
    // column of an intervening list item (`>   >`).  It belongs to the
    // structural prefix and must survive projections and block rewrites.
    let marker = i;
    while (text[marker] === " " || text[marker] === "\t") marker++;
    if (text[marker] !== ">") break;
    i = marker + 1;
    if (text[i] === " " || text[i] === "\t") i++;
    found++;
  }
  if (found === 0) return { prefix: "", rest: text };
  return { prefix: text.slice(0, i), rest: text.slice(i) };
}

/** Remove the first quote marker in `text` while retaining indentation that
 * precedes it.  That indentation may be a parent list item's content column
 * and must not disappear when an inner quote/Callout is unwrapped. */
function removeFirstQuoteMarker(text: string): string {
  const whitespace = text.match(/^[ \t]*/)?.[0] ?? "";
  let end = whitespace.length;
  if (text[end] !== ">") return text;
  end++;
  if (text[end] === " " || text[end] === "\t") end++;
  return whitespace + text.slice(end);
}

/** "[!type]±" with its quote markers already stripped. */
const RE_CALLOUT_HEAD_CONTENT = /^\s*\[![^\]|\r\n]+[^\]\r\n]*\]/;

/** Quote nesting a marker prefix represents. */
function quotePrefixDepth(prefix: string | undefined): number {
  return prefix ? (prefix.match(/>/g)?.length ?? 0) : 0;
}

/** One canonical spelling per depth, so prefixes compare as levels. Source
 *  rows spell the same depth as ">", "> ", ">  " or ">\t". */
function normalizeQuotePrefix(prefix: string | undefined): string {
  return "> ".repeat(quotePrefixDepth(prefix));
}

/**
 * The contiguous quote container holding `lineNo`, or null outside one.
 * Unlike the quote branch of getBlockRange() this crosses a fenced code
 * block that lives inside the quote: from the container's point of view a
 * fence is one of its rows, not the end of it.
 */
function quoteContainerRange(
  doc: Text,
  lineNo: number,
  fences: FenceRange[]
): BlockRange | null {
  const inside = (n: number): boolean => {
    const fence = fenceAt(fences, n);
    if (fence) return fence.quotePrefix !== "";
    return RE_QUOTE.test(doc.line(n).text);
  };
  if (!inside(lineNo)) return null;
  const indentOf = (n: number) => {
    const fence = fenceAt(fences, n);
    return indentWidth(doc.line(fence ? fence.startLine : n).text);
  };
  const indent = indentOf(lineNo);
  let start = lineNo;
  let end = lineNo;
  while (start > 1 && inside(start - 1) && indentOf(start - 1) === indent) start--;
  while (end < doc.lines && inside(end + 1) && indentOf(end + 1) === indent) end++;
  // CommonMark's lazy continuation: unmarked text right after a quote's
  // last paragraph still belongs to it, and getBlockRange() keeps it.
  const tail = getBlockRange(doc, end, fences);
  if (tail && tail.endLine > end && !fenceAt(fences, end)) end = tail.endLine;
  return { startLine: start, endLine: end };
}

/** A quote container's body seen as an ordinary document: every row with
 *  one marker level removed, so lists, fences, tables, nested Callouts and
 *  lazy paragraphs inside it keep their normal Markdown meaning. */
interface QuoteProjection {
  startLine: number;
  /** Markers removed from each row; index 0 is `startLine`. */
  prefixes: string[];
  doc: Text;
  fences: FenceRange[];
}

// Hover recomputes this on every mouse move; documents are immutable, so a
// projection stays valid for as long as anything still holds its document.
const projectionCache = new WeakMap<Text, Map<string, QuoteProjection>>();

function quoteProjection(doc: Text, group: BlockRange): QuoteProjection {
  let perDoc = projectionCache.get(doc);
  if (!perDoc) {
    perDoc = new Map();
    projectionCache.set(doc, perDoc);
  }
  const key = `${group.startLine}:${group.endLine}`;
  const cached = perDoc.get(key);
  if (cached) return cached;
  const prefixes: string[] = [];
  const lines: string[] = [];
  for (let n = group.startLine; n <= group.endLine; n++) {
    const split = splitQuoteMarkers(doc.line(n).text, 1);
    prefixes.push(split.prefix);
    lines.push(split.rest);
  }
  // "[!note] Title" is a title, not the first line of a paragraph that the
  // next row continues. Projecting it as a seam keeps the body's first
  // block separate — which is how Obsidian renders it.
  if (RE_CALLOUT_HEAD_CONTENT.test(lines[0])) lines[0] = "";
  const projected = Text.of(lines);
  const value: QuoteProjection = {
    startLine: group.startLine,
    prefixes,
    doc: projected,
    fences: scanFences(projected),
  };
  perDoc.set(key, value);
  return value;
}

/**
 * The smallest block that owns `lineNo`. Outside a quote this is exactly
 * getBlockRange(). Inside one it descends: the container's own first row
 * still grabs the whole Callout — that row is its title, and Notion grabs
 * a Callout by its title too — while every row below resolves to the
 * paragraph, list item, fence, table or nested Callout that holds it.
 * Nesting comes for free: the body of a Callout is a document, so the same
 * question asked of that document answers for a Callout inside a Callout.
 */
export function innerBlockAt(
  doc: Text,
  lineNo: number,
  fences: FenceRange[] = cachedFences(doc)
): BlockRange | null {
  const outer = getBlockRange(doc, lineNo, fences);
  if (!outer) return null;
  const container = quoteContainerRange(doc, lineNo, fences);
  if (!container) return outer;
  if (lineNo <= container.startLine) {
    // Grabbing a Callout by its title has to hand back the whole box. Only
    // the container range spans it: getBlockRange() deliberately ends a
    // quote at a fenced code block inside it, so a Callout holding a code
    // block would otherwise drag away as its first few rows and leave the
    // remainder behind.
    return parseCalloutHeader(doc.line(container.startLine).text)
      ? container
      : outer;
  }
  const projection = quoteProjection(doc, container);
  const inner = innerBlockAt(
    projection.doc,
    lineNo - container.startLine + 1,
    projection.fences
  );
  if (!inner) return outer;
  const mapped: BlockRange = {
    startLine: container.startLine + inner.startLine - 1,
    endLine: container.startLine + inner.endLine - 1,
    quotePrefix:
      normalizeQuotePrefix(projection.prefixes[inner.startLine - 1]) +
      (inner.quotePrefix ?? ""),
  };
  // One block fills the whole container: there is nothing finer to grab,
  // so the container itself stays the answer.
  return mapped.startLine === container.startLine &&
    mapped.endLine === container.endLine
    ? container
    : mapped;
}

/** Every block a quote container holds directly, in document order. Blank
 *  rows are skipped: they are seams between blocks, not blocks to move. */
export function quoteInnerBlocks(
  doc: Text,
  group: BlockRange,
  fences: FenceRange[] = cachedFences(doc)
): BlockRange[] {
  const container = quoteContainerRange(doc, group.startLine, fences);
  if (!container) return [];
  const projection = quoteProjection(doc, container);
  const blocks: BlockRange[] = [];
  let n = 2; // row 1 is the container's own header/first row
  while (n <= projection.doc.lines) {
    const inner = getBlockRange(projection.doc, n, projection.fences);
    if (!inner) break;
    if (
      inner.startLine >= 2 &&
      !RE_BLANK.test(projection.doc.line(inner.startLine).text)
    ) {
      blocks.push({
        startLine: container.startLine + inner.startLine - 1,
        endLine: container.startLine + inner.endLine - 1,
        quotePrefix: normalizeQuotePrefix(projection.prefixes[inner.startLine - 1]),
      });
    }
    n = inner.endLine + 1;
  }
  return blocks;
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
  fences: FenceRange[] = cachedFences(doc)
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

/** Whether the vault runs the editor in Vim mode, where Escape belongs to
 *  Vim's own mode switch and no other feature may claim it. */
function vimModeEnabled(app: App): boolean {
  const vault = app.vault as unknown as { getConfig?: (key: string) => unknown };
  return vault.getConfig?.bind(app.vault)?.("vimMode") === true;
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

/**
 * The row that must sit between `above` and `below` to keep them separate
 * blocks, or null when they already are. Inside a quote/Callout the seam is
 * an empty quote row (">"), never a bare blank line — a bare blank line
 * would close the container and split it in two.
 */
export function seamRowBetween(
  above: string,
  below: string,
  containerPrefix = ""
): string | null {
  const depth = quotePrefixDepth(containerPrefix);
  const depthAbove = quotePrefixDepth(quoteMarkerPrefix(above) ?? "");
  // `below` rides inside a container that is open above it: the question is
  // about the content the container holds, not about the markers.
  if (depth > 0 && depthAbove >= depth) {
    const split = splitQuoteMarkers(above, depth);
    // "> [!note] Title" introduces its content; the row under it is the
    // Callout's first block, not a continuation of the title.
    if (RE_CALLOUT_HEAD_CONTENT.test(split.rest)) return null;
    return needsProtectedSeam(split.rest, splitQuoteMarkers(below, depth).rest)
      // Spelled from the row it follows rather than from the canonical
      // prefix: a Callout nested in a list item carries that item's
      // indentation on every row, and a seam that drops it sits at a
      // different column — which splits the box in two.
      ? split.prefix.trimEnd()
      : null;
  }
  return needsProtectedSeam(above, below) ? "" : null;
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
  // Separator rows on BOTH sides would merge into a double seam where the
  // block used to be — consume the one below as well. Inside a Callout the
  // separator is an empty quote row rather than a blank line.
  const nextLineNo = block.endLine + 1;
  const aboveText = block.startLine > 1 ? doc.line(block.startLine - 1).text : null;
  const belowText = nextLineNo <= doc.lines ? doc.line(nextLineNo).text : null;
  const seamDepth = (text: string | null) =>
    text == null || !RE_BLANK.test(text.replace(RE_QUOTE_PREFIX, ""))
      ? null
      : quotePrefixDepth(quoteMarkerPrefix(text) ?? "");
  const depthAbove = seamDepth(aboveText);
  const depthBelow = seamDepth(belowText);
  if (
    hasTrailingNewline &&
    depthAbove != null &&
    depthBelow != null &&
    depthAbove === depthBelow
  ) {
    const nl = doc.line(nextLineNo);
    return { from, to: nl.to < doc.length ? nl.to + 1 : nl.to };
  }
  // Last row of a Callout: the empty quote row that separated it from the
  // row above is now trailing the container.
  if (
    depthAbove != null &&
    depthAbove > 0 &&
    quotePrefixDepth(quoteMarkerPrefix(belowText ?? "") ?? "") < depthAbove
  ) {
    const seamFrom = doc.line(block.startLine - 1).from;
    return {
      from: !hasTrailingNewline && seamFrom > 0 ? seamFrom - 1 : seamFrom,
      to,
    };
  }
  // First row of a Callout: the separator below it would otherwise open the
  // container with an empty row.
  if (
    hasTrailingNewline &&
    depthBelow != null &&
    depthBelow > 0 &&
    aboveText != null &&
    RE_CALLOUT_HEAD_CONTENT.test(aboveText.replace(RE_QUOTE_PREFIX, ""))
  ) {
    const nl = doc.line(nextLineNo);
    return { from, to: nl.to < doc.length ? nl.to + 1 : nl.to };
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
  // Rows of one container: what is left behind still belongs to it, so the
  // removal needs no seam. Depths, not spellings — ">" and "> " are the
  // same level, and an empty seam row is spelled the short way.
  const removedDepth = quotePrefixDepth(
    quoteMarkerPrefix(doc.line(block.startLine).text) ?? ""
  );
  if (
    removedDepth > 0 &&
    quotePrefixDepth(quoteMarkerPrefix(above) ?? "") === removedDepth &&
    quotePrefixDepth(quoteMarkerPrefix(below) ?? "") === removedDepth
  ) {
    return range;
  }
  const nestedListContinuation =
    RE_LIST.test(above) && indentWidth(below) > indentWidth(above);
  if (needsProtectedSeam(above, below) && !nestedListContinuation) {
    // The block's own first row stays behind as the seam. Inside a quote
    // container it has to keep its markers — a bare blank row closes the
    // box, turning one Callout into two. Only the levels BOTH neighbours
    // still sit inside are kept, so the seam can never open a level of
    // its own between them.
    const start = doc.line(block.startLine);
    const seamDepth = Math.min(
      quotePrefixDepth(quoteMarkerPrefix(above) ?? ""),
      quotePrefixDepth(quoteMarkerPrefix(below) ?? "")
    );
    const seam =
      seamDepth > 0 ? splitQuoteMarkers(start.text, seamDepth).prefix.trimEnd() : "";
    return { from: start.from + seam.length, to: doc.line(block.endLine).to };
  }
  return range;
}

interface QuotePrefixParts {
  whitespace: string;
  quotePrefix: string;
  length: number;
}

/** Structural quote prefix at the start of a source row. */
function quotePrefixParts(text: string): QuotePrefixParts | null {
  const full = quoteMarkerPrefix(text);
  if (!full) return null;
  const whitespace = text.match(/^[ \t]*/)?.[0] ?? "";
  return {
    whitespace,
    quotePrefix: full.slice(whitespace.length),
    length: full.length,
  };
}

/** Replace only the quote-container markers of a block. Whitespace
 * indentation remains available to the ordinary list nesting model. */
function rewriteQuotePrefix(
  text: string,
  sourceDepth: number,
  targetQuotePrefix: string
): string {
  return text.split("\n").map((line) => {
    const whitespace = line.match(/^[ \t]*/)?.[0] ?? "";
    const split = splitQuoteMarkers(line, sourceDepth);
    const rest = split.prefix ? split.rest : line.slice(whitespace.length);
    return whitespace + targetQuotePrefix + rest;
  }).join("\n");
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

/** One place a dropped block can land at a seam: how deep inside the
 *  quote containers, and at which list indent. */
export interface DropLevel {
  quotePrefix: string;
  indent: number;
}

/** Every prefix from one marker up to `prefix` ("> ", "> > ", …). */
export function quotePrefixLadder(prefix: string): string[] {
  const ladder: string[] = [];
  for (const marker of prefix.matchAll(/>[ \t]?/g)) {
    const end = (marker.index ?? 0) + marker[0].length;
    ladder.push(prefix.slice(0, end));
  }
  return ladder;
}

/**
 * Where a drop before `targetLine` may land, shallowest first: the ordinary
 * list indents outside any quote, then one level per quote marker the seam
 * sits inside. Horizontal drag walks this single ladder, so the gesture that
 * outdents a list item is also the gesture that lifts a row out of a Callout
 * — and the one that tucks a paragraph into the Callout above it.
 *
 * Only the row ABOVE the seam decides how deep a drop may go: a container is
 * joinable where it is already open. Landing in front of a container's first
 * row would put content ahead of its "[!type]" header and stop it rendering.
 */
export function computeDropLevels(
  doc: Text,
  fences: FenceRange[],
  targetLine: number,
  exclude?: BlockRange
): DropLevel[] {
  const levels: DropLevel[] = computeDropIndents(
    doc,
    fences,
    targetLine,
    exclude
  ).map((indent) => ({ quotePrefix: "", indent }));

  let above = targetLine - 1;
  if (exclude && above >= exclude.startLine && above <= exclude.endLine) {
    above = exclude.startLine - 1;
  }
  if (above < 1 || above > doc.lines) return levels;
  const aboveText = doc.line(above).text;
  const openFence = fenceAt(fences, above);
  const markers = openFence
    ? openFence.quotePrefix
    : quotePrefixParts(aboveText)?.quotePrefix ?? "";
  const indent = indentWidth(aboveText);
  for (const quotePrefix of quotePrefixLadder(markers)) {
    levels.push({ quotePrefix, indent });
  }
  return levels;
}

/**
 * Pick a drop level from horizontal drag distance. The seam's own depth is
 * the starting point — pointing at a row inside a Callout means "here",
 * not "one step out" — and only a deliberate horizontal move of about one
 * visual step changes level.
 */
export function pickDropLevel(
  levels: DropLevel[],
  seamQuotePrefix: string,
  currentIndent: number,
  deltaX: number,
  visualStepPx: number
): DropLevel {
  if (levels.length === 0) return { quotePrefix: "", indent: 0 };
  const nearest = (pool: DropLevel[]) =>
    pool.reduce((best, level) =>
      Math.abs(level.indent - currentIndent) < Math.abs(best.indent - currentIndent)
        ? level
        : best
    );
  const exact = levels.filter((level) => level.quotePrefix === seamQuotePrefix);
  // A pointed row can sit deeper than the seam accepts (the first row of a
  // Callout: its container only opens below it). Clamp to the deepest
  // container the seam does leave open.
  const joinable = levels.filter(
    (level) => level.quotePrefix !== "" && seamQuotePrefix.startsWith(level.quotePrefix)
  );
  const plain = levels.filter((level) => level.quotePrefix === "");
  const base = exact.length > 0
    ? nearest(exact)
    : joinable.length > 0
      ? joinable[joinable.length - 1]
      : plain.length > 0
        ? nearest(plain)
        : levels[0];
  const baseIndex = Math.max(0, levels.indexOf(base));
  const step = Math.max(12, visualStepPx || 0);
  const shift = Math.round(deltaX / step);
  return levels[Math.max(0, Math.min(levels.length - 1, baseIndex + shift))];
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
  fences: FenceRange[] = cachedFences(view.state.doc),
  indentOverride?: number,
  unit: IndentUnit = DEFAULT_INDENT_UNIT,
  quotePrefixOverride?: string
): number | null {
  const doc = view.state.doc;
  // Whether the only thing between the block and the drop point is
  // separator rows — blank lines, or the empty quote rows that separate
  // blocks inside a Callout.
  const onlySeams = (from: number, to: number) => {
    for (let n = from; n <= to && n <= doc.lines; n++) {
      if (n < 1) continue;
      if (fenceAt(fences, n)) return false;
      if (!RE_BLANK.test(doc.line(n).text.replace(RE_QUOTE_PREFIX, ""))) return false;
    }
    return true;
  };
  const adjacent =
    (targetLine < block.startLine && onlySeams(targetLine, block.startLine - 1)) ||
    (targetLine > block.endLine + 1 && onlySeams(block.endLine + 1, targetLine - 1));
  // The quote markers this block carries as a passenger of its container.
  // A fence keeps its own tally; a whole container's markers are its own
  // content and must survive the move untouched.
  const sourceQuotePrefix = block.quotePrefix ??
    (fenceAt(fences, block.startLine)?.quotePrefix ?? "");
  const sourceQuoteDepth = quotePrefixDepth(sourceQuotePrefix);
  const requoting =
    quotePrefixOverride !== undefined && quotePrefixOverride !== sourceQuotePrefix;
  const inPlace = targetLine >= block.startLine && targetLine <= block.endLine + 1;
  if (inPlace && indentOverride === undefined && !requoting) return null;

  const baseIndent = indentWidth(doc.line(block.startLine).text);
  const targetIndent =
    indentOverride !== undefined
      ? pickIndent(computeDropIndents(doc, fences, targetLine, block), indentOverride)
      : computeTargetIndent(doc, fences, targetLine);
  const applyQuotePrefix = (source: string) =>
    quotePrefixOverride !== undefined &&
    (sourceQuoteDepth > 0 || quotePrefixOverride !== "")
      ? rewriteQuotePrefix(source, sourceQuoteDepth, quotePrefixOverride)
      : source;
  // Dropped on the other side of nothing but seam rows, at the level it
  // already has: the block is being put back exactly where it was, and
  // rewriting it would only shuffle blank rows around.
  if (adjacent && !requoting && targetIndent === baseIndent) return null;

  // Dropped back onto its own position: a horizontal drag still changes
  // the nesting level, so re-level the block where it stands.
  if (inPlace) {
    if (targetIndent === baseIndent && !requoting) return null;
    const from = doc.line(block.startLine).from;
    const to = doc.line(block.endLine).to;
    const source = doc.sliceString(from, to);
    const structural = source
      .split("\n")
      .some((line) => RE_QUOTE.test(line) || RE_FENCE.test(line) || RE_TABLE.test(line));
    let shifted = applyQuotePrefix(
      reindentBlock(
        source,
        targetIndent - baseIndent,
        structural ? { ...unit, useTab: false } : unit
      )
    );
    const shiftedLines = shifted.split("\n");
    const above = block.startLine > 1 ? doc.line(block.startLine - 1).text : "";
    const below = block.endLine < doc.lines ? doc.line(block.endLine + 1).text : "";
    const landing = quotePrefixOverride ?? sourceQuotePrefix;
    const seamAbove = seamRowBetween(above, shiftedLines[0], landing);
    const seamBelow = seamRowBetween(
      shiftedLines[shiftedLines.length - 1],
      below,
      landing
    );
    const sealAbove = seamAbove !== null;
    if (sealAbove) shifted = seamAbove + "\n" + shifted;
    if (seamBelow !== null) shifted += "\n" + seamBelow;
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
  text = applyQuotePrefix(
    reindentBlock(
      text,
      targetIndent - baseIndent,
      structural ? { ...unit, useTab: false } : unit
    )
  );

  // Seam rows at the destination, so a drop never changes the meaning of
  // its neighbors. Above: a table or divider directly under a text line
  // would not render (a divider even turns that line into a setext
  // heading); a quote dropped against a quote merges into one callout; a
  // paragraph dropped directly under a quote, list item, or paragraph is
  // absorbed into it. Below: the dropped block would swallow a following
  // paragraph-ish line the same way. Inside a Callout the seam is an empty
  // quote row, which separates two paragraphs without breaking the box.
  const movedLines = text.split("\n");
  const firstMoved = movedLines[0];
  const lastMoved = movedLines[movedLines.length - 1];
  let prev = targetLine - 1;
  if (prev >= block.startLine && prev <= block.endLine) prev = block.startLine - 1;
  const prevText = prev >= 1 && prev <= doc.lines ? doc.line(prev).text : "";
  const landing = quotePrefixOverride ?? sourceQuotePrefix;
  const seamAbove = seamRowBetween(prevText, firstMoved, landing);
  const sealAbove = seamAbove !== null;
  if (sealAbove) text = seamAbove + "\n" + text;
  const nextText = targetLine <= doc.lines ? doc.line(targetLine).text : "";
  const seamBelow = seamRowBetween(lastMoved, nextText, landing);
  if (seamBelow !== null) text += "\n" + seamBelow;

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
  const sibling = findSiblingBlock(doc, fences, block, -1);
  if (sibling) return sibling.startLine;
  if (block.quotePrefix) return null;
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
  const sibling = findSiblingBlock(doc, fences, block, 1);
  if (sibling) return sibling;
  if (block.quotePrefix) return null;
  for (let n = block.endLine + 1; n <= doc.lines; n++) {
    if (RE_BLANK.test(doc.line(n).text) && !fenceAt(fences, n)) continue;
    return getBlockRange(doc, n, fences);
  }
  return null;
}

/**
 * Neighbouring block at the same level inside the same quote container.
 * A row of a Callout moves within its Callout: its neighbours are the
 * other rows, never the Callout itself or whatever follows it. Null for
 * blocks that are not inside a container, and at a container's own ends.
 */
export function findSiblingBlock(
  doc: Text,
  fences: FenceRange[],
  block: BlockRange,
  direction: -1 | 1
): BlockRange | null {
  const context = quoteContext(doc, block, fences);
  if (!context) return null;
  const step = direction;
  let n =
    (direction === -1 ? block.startLine : block.endLine) - context.offset + step;
  while (n >= 1 && n <= context.doc.lines) {
    if (RE_BLANK.test(context.doc.line(n).text) && !fenceAt(context.fences, n)) {
      n += step;
      continue;
    }
    // Row 1 is the container's own first row (a Callout title), never a
    // sibling of the rows it introduces.
    const inner = getBlockRange(context.doc, n, context.fences);
    if (!inner || inner.startLine === 1) return null;
    return {
      startLine: context.offset + inner.startLine,
      endLine: context.offset + inner.endLine,
      quotePrefix: block.quotePrefix,
    };
  }
  return null;
}

/** The projected body of the container that directly holds `block`, with
 *  the offset that maps its line numbers back to the real document. */
function quoteContext(
  doc: Text,
  block: BlockRange,
  fences: FenceRange[]
): { doc: Text; fences: FenceRange[]; offset: number } | null {
  const depth = quotePrefixDepth(block.quotePrefix);
  if (depth === 0) return null;
  let body = doc;
  let bodyFences = fences;
  let offset = 0;
  for (let level = 0; level < depth; level++) {
    const container = quoteContainerRange(
      body,
      block.startLine - offset,
      bodyFences
    );
    if (!container) return null;
    const projection = quoteProjection(body, container);
    offset += container.startLine - 1;
    body = projection.doc;
    bodyFences = projection.fences;
  }
  return { doc: body, fences: bodyFences, offset };
}

const RE_LINE_PREFIX = /^(#{1,6}\s|>\s?|(?:[-*+]|\d+[.)])\s(?:\[.\]\s)?)/;

/** Swap a line's block prefix (heading/list/quote/task) for a new one. */
export function applyLinePrefix(lineText: string, prefix: string): string {
  const ws = lineText.match(/^\s*/)?.[0] ?? "";
  let rest = lineText.slice(ws.length);
  // Strip nested prefixes like "> [!note]" or "- [ ]" one layer at a time,
  // including the indentation between them — a list nested inside a quote
  // spells its depth as "> " plus spaces plus "- ", and stopping at the
  // marker would leave the old bullet stranded after the new prefix.
  for (let i = 0; i < 3; i++) {
    const gap = rest.match(RE_LEADING_WS)?.[0] ?? "";
    const m = rest.slice(gap.length).match(RE_LINE_PREFIX);
    if (!m) break;
    rest = rest.slice(gap.length + m[0].length);
    if (prefix.startsWith(m[0])) break;
  }
  return ws + prefix + rest;
}

/** Logical, non-overlapping blocks touched by an inclusive line span. */
/**
 * The next block above (`dir` -1) or below (`dir` 1) `block`, or null at
 * the ends of the document.
 *
 * Blank rows are stepped over. The drag handle treats one as a block of
 * its own — it is draggable, and a marquee that sweeps it takes it along —
 * but as a DESTINATION a seam is never what the writer meant, and every
 * gap would otherwise cost an extra press. A row resolving back to `block`
 * (its own later lines, a caption it owns) is skipped for the same reason:
 * one press always lands somewhere new.
 */
export function adjacentBlock(
  doc: Text,
  block: BlockRange,
  dir: 1 | -1,
  fences: FenceRange[] = cachedFences(doc)
): BlockRange | null {
  let lineNo = dir > 0 ? block.endLine + 1 : block.startLine - 1;
  while (lineNo >= 1 && lineNo <= doc.lines) {
    const next = getBlockRange(doc, lineNo, fences);
    if (
      next &&
      (next.startLine !== block.startLine || next.endLine !== block.endLine) &&
      !isBlankBlock(doc, next)
    ) return next;
    lineNo += dir;
  }
  return null;
}

/** A block made of nothing but blank rows — a seam between real blocks. */
function isBlankBlock(doc: Text, block: BlockRange): boolean {
  for (let n = block.startLine; n <= block.endLine; n++) {
    if (!RE_BLANK.test(doc.line(n).text.replace(RE_QUOTE_PREFIX, ""))) return false;
  }
  return true;
}

export function blocksInLineSpan(
  doc: Text,
  startLine: number,
  endLine: number,
  fences: FenceRange[] = cachedFences(doc)
): BlockRange[] {
  const first = Math.max(1, Math.min(startLine, endLine));
  const last = Math.min(doc.lines, Math.max(startLine, endLine));
  const blocks: BlockRange[] = [];
  let lineNo = first;
  while (lineNo <= last) {
    const block = getBlockRange(doc, lineNo, fences);
    if (!block) {
      lineNo++;
      continue;
    }
    const previous = blocks[blocks.length - 1];
    if (
      !previous ||
      previous.startLine !== block.startLine ||
      previous.endLine !== block.endLine
    ) blocks.push(block);
    lineNo = Math.max(lineNo + 1, block.endLine + 1);
  }
  return blocks;
}

/**
 * Deletion span for a whole block selection.
 *
 * Selected blocks are contiguous apart from the blank lines between them,
 * and those are blocks in their own right, so removing first-to-last is
 * exactly what the marquee swept — and sidesteps the overlapping per-block
 * ranges that removing them one at a time would produce.
 */
export function blockSelectionRemovalRange(
  doc: Text,
  blocks: readonly BlockRange[]
): { from: number; to: number } | null {
  if (blocks.length === 0) return null;
  return protectedBlockRemovalRange(doc, {
    startLine: blocks[0].startLine,
    endLine: blocks[blocks.length - 1].endLine,
  });
}

/**
 * Text that replaces a block selection on paste, with the seam rows that
 * keep it from fusing with the blocks it lands between.
 *
 * The selected span is deleted whole, so the clipboard's first row inherits
 * whatever sat above the selection and its last row inherits whatever sat
 * below — neighbours it was never written against. Without a seam, pasting
 * a table under a paragraph stops the table rendering, pasting a rule turns
 * the paragraph above into a setext heading, and pasting over the blank line
 * that separated two blocks silently merges them.
 */
export function blockSelectionPasteInsert(
  doc: Text,
  blocks: readonly BlockRange[],
  clip: string
): string {
  const body = clip.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  if (blocks.length === 0 || body.length === 0) return body;
  const startLine = blocks[0].startLine;
  const endLine = blocks[blocks.length - 1].endLine;
  const rows = body.split("\n");
  const above = startLine > 1 ? doc.line(startLine - 1).text : "";
  const below = endLine < doc.lines ? doc.line(endLine + 1).text : "";
  // Rows of a Callout are replaced inside it, so their seams are empty
  // quote rows; a bare blank line there would close the box. Taken from the
  // block itself — the first line of a whole selected Callout also starts
  // with markers, but what replaces it is not inside anything.
  const container = blocks[0].quotePrefix ?? "";
  const head = seamRowBetween(above, rows[0], container);
  const tail = seamRowBetween(rows[rows.length - 1], below, container);
  return (
    (head !== null ? head + "\n" : "") +
    body +
    (tail !== null ? "\n" + tail : "")
  );
}

/** A block hotkey may only target the still-mounted, focused editor whose
 * line-based selection remains ordered and inside the current document. */
export function blockSelectionScopeIsCurrent(
  doc: Text,
  blocks: readonly BlockRange[],
  viewHasFocus: boolean,
  viewConnected: boolean
): boolean {
  if (!viewHasFocus || !viewConnected || blocks.length === 0) return false;
  let previousEnd = 0;
  for (const block of blocks) {
    if (
      !Number.isInteger(block.startLine) ||
      !Number.isInteger(block.endLine) ||
      block.startLine < 1 ||
      block.endLine < block.startLine ||
      block.endLine > doc.lines ||
      block.startLine <= previousEnd
    ) return false;
    previousEnd = block.endLine;
  }
  return true;
}

/** "[!type]±" with its quote markers already gone, plus the space after it. */
const RE_CALLOUT_TOKEN = /^([ \t]*)\[![^\]|\r\n]+[^\]\r\n]*\][+-]?[ \t]?/;

/** Structural Callouts that are the plugin's own scaffolding rather than a
 *  block a user can retype. Columns have their own unwrap action. */
function isScaffoldCallout(type: string | undefined): boolean {
  return type === COLS_TYPE || type === COL_TYPE;
}

/**
 * Convert a whole multi-line quote or Callout to another block type.
 *
 * The single-line path cannot express this: rewriting only the first row
 * leaves every remaining "> " row behind, which splits the block in half —
 * which is why the menu used to hide the conversion entirely. The container
 * has to shed exactly one quote level across all of its rows at once, with
 * the "[!type]" token dropped and any title kept as ordinary text.
 *
 * "Text" is a pure unwrap: the rows inside keep their own syntax, so a list
 * or a nested quote survives being lifted out of the Callout. Every other
 * target retypes the rows it can describe and leaves the ones it cannot —
 * fenced code, table rows, a nested Callout header — merely unquoted, since
 * a heading marker in front of a "|" row would destroy the table.
 */
export function turnQuoteBlockInto(
  doc: Text,
  block: BlockRange,
  prefix: string
): BlockTextChange | null {
  const first = doc.line(block.startLine);
  const containerDepth = quotePrefixDepth(block.quotePrefix ?? "");
  if (quoteDepth(first.text) <= containerDepth) return null;
  if (isScaffoldCallout(parseCalloutHeader(first.text)?.type)) return null;

  const kept: string[] = [];
  const contents: string[] = [];
  for (let n = block.startLine; n <= block.endLine; n++) {
    const outer = splitQuoteMarkers(doc.line(n).text, containerDepth);
    kept.push(outer.prefix);
    contents.push(removeFirstQuoteMarker(outer.rest));
  }

  // "[!note] Title" becomes "Title"; a title-less header leaves no row.
  if (parseCalloutHeader(first.text)) {
    contents[0] = contents[0].replace(RE_CALLOUT_TOKEN, "$1");
    if (!contents[0].trim()) {
      kept.shift();
      contents.shift();
    }
  }
  if (contents.length === 0) return null;

  // Fences are resolved against the unquoted body: one level down, the
  // rows are ordinary Markdown again.
  const bodyFences = scanFences(Text.of(contents));
  const rows = contents.map((content, index) => {
    const keep = kept[index];
    if (!content.trim()) return keep.trimEnd();
    // A row still carrying a ">" after the shed belongs to a container
    // nested inside this one — a quote, or a Callout and its body. Its
    // rows are not this block's to retype; unquoting it by one level is
    // the whole of the conversion for them.
    if (
      prefix === "" ||
      fenceAt(bodyFences, index + 1) ||
      isTableRow(content) ||
      RE_QUOTE.test(content) ||
      RE_CALLOUT_HEAD_CONTENT.test(content)
    ) {
      return keep + content;
    }
    return keep + applyLinePrefix(content, prefix);
  });

  // A container's walls double as block separators, and two constructs stop
  // parsing when they lose them: Obsidian will not begin a table or a rule on
  // the line after a paragraph or a fence, so an unwrapped Callout ends up
  // showing raw pipes where it used to show a table. Those get a blank row
  // back. Ordinary prose does NOT — consecutive rows inside a Callout are one
  // paragraph, and separating them would rewrite the text rather than unwrap
  // it. The row below the block needs the same care: it was shielded by the
  // container too, and is now sitting against plain text.
  const unquoted = (row: string) =>
    splitQuoteMarkers(row, quoteDepth(row)).rest;
  const fusesWithoutSeam = (above: string, belowRow: string) => {
    if (!above.trim() || !belowRow.trim()) return false;
    const content = unquoted(belowRow);
    const aboveContent = unquoted(above);
    // Only where the construct BEGINS. Its own later rows continue it, and a
    // blank between them would break the very table the seam is protecting.
    if (RE_TABLE.test(content)) return !RE_TABLE.test(aboveContent);
    if (RE_HR.test(content)) return !RE_HR.test(aboveContent);
    return false;
  };
  const stitched: string[] = [];
  rows.forEach((row, index) => {
    const previous = stitched[stitched.length - 1];
    if (previous !== undefined && fusesWithoutSeam(previous, row)) {
      // The seam belongs to the same container as the row it precedes.
      stitched.push(kept[index].trimEnd());
    }
    stitched.push(row);
  });
  const below = block.endLine < doc.lines ? doc.line(block.endLine + 1).text : "";
  if (fusesWithoutSeam(stitched[stitched.length - 1], below)) {
    stitched.push((block.quotePrefix ?? "").trimEnd());
  }
  return {
    from: first.from,
    to: doc.line(block.endLine).to,
    insert: stitched.join("\n"),
  };
}

/** Build one transaction's changes for a multi-block type conversion.
 * Structural blocks that the single-block menu cannot safely convert are
 * reported as skipped and left byte-for-byte intact. */
export function batchTurnIntoChanges(
  doc: Text,
  blocks: readonly BlockRange[],
  prefix: string,
  fences: FenceRange[] = cachedFences(doc)
): { changes: BlockTextChange[]; skipped: number } {
  const changes: BlockTextChange[] = [];
  let skipped = 0;
  for (const block of blocks) {
    const line = doc.line(block.startLine);
    const isFence = fenceAt(fences, block.startLine) != null;
    const isTable = !isFence && isTableRow(line.text);
    // A rule has no text to retype as anything else; giving it a prefix
    // just spells "---" inside a heading or list item.
    if (isFence || isTable || RE_HR.test(line.text)) {
      skipped++;
      continue;
    }
    if (block.endLine > block.startLine && RE_QUOTE.test(line.text)) {
      const whole = turnQuoteBlockInto(doc, block, prefix);
      if (!whole) {
        skipped++;
        continue;
      }
      if (whole.insert !== doc.sliceString(whole.from, whole.to)) changes.push(whole);
      continue;
    }
    const insert = applyLinePrefix(line.text, prefix);
    if (insert !== line.text) changes.push({ from: line.from, to: line.to, insert });
  }
  return { changes, skipped };
}

/** Inline-formattable span of a line: past leading whitespace and block
 * prefixes (heading/list/quote/task), trailing spaces excluded. Null for
 * blank lines and callout headers, whose syntax must stay intact. */
export function lineContentSpan(
  lineText: string
): { from: number; to: number } | null {
  const ws = lineText.match(/^\s*/)?.[0] ?? "";
  let offset = ws.length;
  let rest = lineText.slice(offset);
  for (let i = 0; i < 3; i++) {
    // Indentation BETWEEN two prefixes is structure as well: a list nested
    // inside a Callout spells its depth as "> " plus spaces plus "- ".
    // Stopping at the quote marker would wrap the bullet itself, which
    // leaves the row rendering as literal asterisks instead of a list item.
    const gap = rest.match(RE_LEADING_WS)?.[0] ?? "";
    const m = rest.slice(gap.length).match(RE_LINE_PREFIX);
    if (!m) break;
    offset += gap.length + m[0].length;
    rest = rest.slice(gap.length + m[0].length);
  }
  const trimmed = rest.replace(/\s+$/, "");
  if (trimmed.length === 0 || trimmed.startsWith("[!")) return null;
  return { from: offset, to: offset + trimmed.length };
}

export interface BatchFormatMarkers {
  /** Markdown pair; absent for HTML-only formats (underline). */
  marker?: string;
  endMarker?: string;
  /** HTML pair for lines that already carry plugin HTML tags — mixing
   * families breaks Live Preview (see rangeTouchesHtmlPairIn). */
  open: string;
  close: string;
}

function contentWrappedByMarkdown(
  text: string,
  marker: string,
  end: string
): boolean {
  if (!text.startsWith(marker) || !text.endsWith(end)) return false;
  if (text.length < marker.length + end.length) return false;
  if (marker.length === 1 && marker !== "`") {
    // A run of exactly two emphasis chars is BOLD, not italic.
    const ch = marker[0];
    let lead = 0;
    while (lead < text.length && text[lead] === ch) lead++;
    let tail = 0;
    while (tail < text.length - lead && text[text.length - 1 - tail] === ch) tail++;
    if (lead === 2 && tail === 2) return false;
  }
  return true;
}

/** Build one transaction's changes toggling an inline format across every
 * selected block's per-line content. Notion semantics: if every eligible
 * line already carries the format it comes off everywhere, otherwise the
 * unformatted lines gain it. Fences and tables are reported as skipped. */
export function batchToggleFormatChanges(
  doc: Text,
  blocks: readonly BlockRange[],
  markers: BatchFormatMarkers,
  fences: FenceRange[] = cachedFences(doc)
): { changes: BlockTextChange[]; removed: boolean; skipped: number } {
  const md = markers.marker;
  const mdEnd = markers.endMarker ?? markers.marker ?? "";
  interface Entry {
    from: number;
    to: number;
    text: string;
    wrap: "md" | "html" | null;
  }
  const entries: Entry[] = [];
  let skipped = 0;
  const skippedStructures = new Set<string>();
  const reportSkipped = (kind: string, startLine: number, endLine: number) => {
    const key = `${kind}:${startLine}:${endLine}`;
    if (skippedStructures.has(key)) return;
    skippedStructures.add(key);
    skipped++;
  };
  for (const block of blocks) {
    const first = doc.line(block.startLine);
    const firstFence = fenceAt(fences, block.startLine);
    const firstTable = !firstFence && isTableRow(first.text)
      ? getTableRange(doc, block.startLine, fences)
      : null;
    if (firstFence || firstTable || RE_HR.test(first.text)) {
      if (firstFence) {
        reportSkipped("fence", firstFence.startLine, firstFence.endLine);
      } else if (firstTable) {
        reportSkipped("table", firstTable.startLine, firstTable.endLine);
      } else {
        reportSkipped("rule", block.startLine, block.endLine);
      }
      continue;
    }
    for (let n = block.startLine; n <= block.endLine; n++) {
      const nestedFence = fenceAt(fences, n);
      if (nestedFence) {
        reportSkipped("fence", nestedFence.startLine, nestedFence.endLine);
        continue;
      }
      const line = doc.line(n);
      // A table inside a Callout: the block-level skip above only ever sees
      // the container, and wrapping a delimiter row in "**" stops the whole
      // table from rendering.
      if (isTableRow(line.text)) {
        const table = getTableRange(doc, n, fences);
        reportSkipped("table", table?.startLine ?? n, table?.endLine ?? n);
        continue;
      }
      const span = lineContentSpan(line.text);
      if (!span) continue;
      const text = line.text.slice(span.from, span.to);
      // A rule inside a Callout reaches this loop with its quote markers
      // already stripped; wrapping it stops it being a rule at all.
      if (RE_HR.test(text)) {
        reportSkipped("rule", n, n);
        continue;
      }
      let wrap: Entry["wrap"] = null;
      if (md && contentWrappedByMarkdown(text, md, mdEnd)) wrap = "md";
      else if (
        text.startsWith(markers.open) &&
        text.endsWith(markers.close) &&
        text.length >= markers.open.length + markers.close.length
      ) wrap = "html";
      entries.push({ from: line.from + span.from, to: line.from + span.to, text, wrap });
    }
  }
  if (entries.length === 0) return { changes: [], removed: false, skipped };
  const removed = entries.every((entry) => entry.wrap !== null);
  const changes: BlockTextChange[] = [];
  for (const entry of entries) {
    if (removed) {
      const head = entry.wrap === "md" ? md! : markers.open;
      const tail = entry.wrap === "md" ? mdEnd : markers.close;
      changes.push({ from: entry.from, to: entry.from + head.length, insert: "" });
      changes.push({ from: entry.to - tail.length, to: entry.to, insert: "" });
    } else if (entry.wrap === null) {
      const useHtml =
        !md || rangeTouchesHtmlPairIn(entry.text, 0, entry.text.length);
      const head = useHtml ? markers.open : md!;
      const tail = useHtml ? markers.close : mdEnd;
      changes.push({ from: entry.from, to: entry.from, insert: head });
      changes.push({ from: entry.to, to: entry.to, insert: tail });
    }
  }
  return { changes, removed, skipped };
}

/* ------------------------------------------------------------------ */
/* Table model (parse / format / edit)                                 */
/* ------------------------------------------------------------------ */

export const RE_TABLE = /^\s*\|/;

/**
 * A table row and the structural prefix it carries: indentation plus any
 * quote markers, captured as group 1.
 *
 * The prefix is the ONLY thing about a quoted table that differs from a
 * plain one. Everything below works from the first "|" onward — pipe
 * offsets, cell parsing, navigation, colour markers — so teaching the
 * model where a row's cells begin is enough to make a table inside a
 * Callout editable, without a projection or a second code path.
 *
 * `RE_TABLE` stays whitespace-only on purpose: it decides *block*
 * structure, where a quoted row is a row of its quote and must reach
 * getBlockRange()'s quote branch first.
 */
const RE_DELIM_ROW_CONTENT = /^\|(?:\s*:?-+:?\s*\|)+\s*$/;

function tableRowParts(text: string): { prefix: string; content: string } | null {
  const prefix = structuralContentPrefix(text);
  if (text[prefix.length] !== "|") return null;
  return { prefix, content: text.slice(prefix.length) };
}

/** Whether a source row is a table row, inside a quote/Callout or not. */
export function isTableRow(text: string): boolean {
  return tableRowParts(text) != null;
}

/** The indentation and quote markers a table row carries ("" when plain). */
export function tableRowPrefix(text: string): string {
  return tableRowParts(text)?.prefix ?? "";
}

export function isDelimRow(line: string): boolean {
  const row = tableRowParts(line);
  return !!row && RE_DELIM_ROW_CONTENT.test(row.content);
}

/** The table block around lineNo: contiguous "|" rows outside fences. Rows
 *  must share a quote depth, so a table in a Callout never merges with one
 *  in a Callout nested inside it. */
export function getTableRange(
  doc: Text,
  lineNo: number,
  fences: FenceRange[]
): BlockRange | null {
  if (fenceAt(fences, lineNo) || !isTableRow(doc.line(lineNo).text)) return null;
  const depthAt = (n: number) =>
    quotePrefixDepth(quoteMarkerPrefix(doc.line(n).text) ?? "");
  const depth = depthAt(lineNo);
  const joins = (n: number) =>
    !fenceAt(fences, n) && isTableRow(doc.line(n).text) && depthAt(n) === depth;
  let start = lineNo;
  let end = lineNo;
  while (start > 1 && joins(start - 1)) start--;
  while (end < doc.lines && joins(end + 1)) end++;
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
  const indent = tableRowPrefix(lines[0]);
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
  const indent = tableRowPrefix(lines[0]);
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
  const i = lines.findIndex((l) => isTableRow(l) && !isDelimRow(l));
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
  column: ColumnProjectionAtPosition | null;
}

function makeTableKeymap(plugin: NotionFlowPlugin) {
  const context = (view: EditorView): TableCtx | null => {
    if (!plugin.settings.tableEditing) return null;
    const sel = view.state.selection.main;
    if (!sel.empty) return null;
    const doc = view.state.doc;
    const line = doc.lineAt(sel.head);
    let tableDoc = doc;
    let tableLine = line;
    let column: ColumnProjectionAtPosition | null = null;
    if (!isTableRow(line.text)) {
      column = columnProjectionAtPosition(doc, sel.head);
      if (!column) return null;
      tableDoc = column.inner.doc;
      tableLine = tableDoc.lineAt(column.innerPos);
      if (!isTableRow(tableLine.text)) return null;
    }
    const range = getTableRange(
      tableDoc,
      tableLine.number,
      cachedFences(tableDoc)
    );
    if (!range) return null;
    const lines: string[] = [];
    for (let n = range.startLine; n <= range.endLine; n++) {
      lines.push(tableDoc.line(n).text);
    }
    return {
      doc: tableDoc,
      range,
      lines,
      row: tableLine.number - range.startLine,
      ch: column ? column.innerPos - tableLine.from : sel.head - line.from,
      indent: tableRowPrefix(lines[0]),
      column,
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
    const insert = delim + "\n" + row;
    const cursor = end + delim.length + 1 + indent.length + 2;
    if (ctx.column) {
      applyKeyPlan(
        view,
        mapColumnInnerPlan(ctx.column, {
          from: end,
          to: end,
          insert,
          cursor,
        }),
        "input"
      );
    } else {
      view.dispatch({
        changes: { from: end, insert },
        selection: { anchor: cursor },
        userEvent: "input",
      });
    }
  };

  const moveTo = (view: EditorView, ctx: TableCtx, res: { row: number; ch: number }) => {
    const line = ctx.doc.line(ctx.range.startLine + res.row);
    const target = Math.min(line.from + res.ch, line.to);
    const mapped = ctx.column
      ? mapColumnInnerOffset(ctx.column.inner, target)
      : target;
    if (mapped == null) return;
    view.dispatch({
      selection: {
        anchor: ctx.column ? ctx.column.blockFrom + mapped : mapped,
      },
    });
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
      if (ctx.column) {
        applyKeyPlan(
          view,
          mapColumnInnerPlan(ctx.column, {
            from: line.from,
            to: line.to,
            insert: "",
            cursor: line.from,
          }),
          "input"
        );
      } else {
        view.dispatch({
          changes: { from: line.from, to: line.to },
          selection: { anchor: line.from },
          userEvent: "input",
        });
      }
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
/* Quote / Callout editing                                             */
/*                                                                     */
/* Notion-style block behavior for "> " lines: Enter continues the     */
/* marker or exits on an empty marker line, Backspace at the content   */
/* start unwraps one marker level, multi-line pastes stay inside the   */
/* block, and the rendered Callout icon opens a type menu.             */
/* ------------------------------------------------------------------ */

/** Full marker prefix of a quote line ("  > > "), or null. */
export function quoteMarkerPrefix(text: string): string | null {
  const m = text.match(RE_QUOTE_PREFIX);
  return m ? m[0] : null;
}

/**
 * The line with its innermost quote marker removed, plus the column where
 * the caret should land (the reduced content start). Null on non-quote
 * lines. A fully unwrapped, otherwise empty line collapses to "".
 */
export function dedentQuoteLine(
  text: string
): { text: string; cursor: number } | null {
  const prefix = quoteMarkerPrefix(text);
  if (prefix == null) return null;
  let rest = text.slice(prefix.length);
  if (!rest.trim()) rest = "";
  let reduced = prefix.replace(/>[ \t]?$/, "");
  if (!rest && !reduced.includes(">")) reduced = "";
  return { text: reduced + rest, cursor: reduced.length };
}

/** A single-cursor document edit produced by the quote key handlers. */
export interface QuoteKeyPlan {
  from: number;
  to: number;
  insert: string;
  cursor: number;
}

/**
 * Whether a quote row is the last one at its OWN nesting depth.
 *
 * Shedding a quote level is the Notion idiom for leaving a block, but it is
 * only ever meant as an exit. Applied to a row that still has siblings below
 * it, the same edit splits the container in two: the Callout loses its tail,
 * a columns row loses the columns below the caret, a nested toggle is torn
 * out of its parent. So the level has to actually end here.
 *
 * Depth, not container, is what matters — a row two levels deep ends its own
 * inner quote as soon as the next row is shallower, even though the outer
 * Callout carries on for another twenty rows.
 */
function quoteRowEndsItsLevel(doc: Text, lineNo: number): boolean {
  const depth = quoteDepth(doc.line(lineNo).text);
  if (depth === 0) return true;
  for (let n = lineNo + 1; n <= doc.lines; n++) {
    const below = quoteDepth(doc.line(n).text);
    if (below === 0) return true;
    return below < depth;
  }
  return true;
}

/** First row of the run of lines that sit at `lineNo`'s quote depth — the
 *  header of the container the caret is directly inside. */
function quoteLevelStart(doc: Text, lineNo: number): number {
  const depth = quoteDepth(doc.line(lineNo).text);
  let start = lineNo;
  while (start > 1 && quoteDepth(doc.line(start - 1).text) >= depth) start--;
  return start;
}

/** The whole run of rows at `lineNo`'s depth, as a block whose quotePrefix
 *  names the levels that belong to its container and must survive. */
function quoteLevelBlock(doc: Text, lineNo: number): BlockRange {
  const depth = quoteDepth(doc.line(lineNo).text);
  const startLine = quoteLevelStart(doc, lineNo);
  let endLine = lineNo;
  while (endLine < doc.lines && quoteDepth(doc.line(endLine + 1).text) >= depth) endLine++;
  return { startLine, endLine, quotePrefix: "> ".repeat(Math.max(0, depth - 1)) };
}

/**
 * A marker-only row that separates two columns of an [!nf-cols] block. It
 * carries no content and belongs to no column, but removing it lets the two
 * [!nf-col] headers become adjacent, which Live Preview then renders as one
 * column holding a nested Callout. Structure, not text: Backspace consumes
 * it without changing the document.
 */
function isColumnSeparatorRow(
  doc: Text,
  lineNo: number,
  fences: FenceRange[]
): boolean {
  const container = quoteContainerRange(doc, lineNo, fences);
  if (!container || container.startLine === lineNo) return false;
  const header = parseCalloutHeader(doc.line(container.startLine).text);
  return (
    header?.type === COLS_TYPE &&
    quoteDepth(doc.line(lineNo).text) === quoteDepth(doc.line(container.startLine).text)
  );
}

/**
 * Enter inside a quote/Callout: continue the "> " marker on the new line,
 * or exit one level when the line holds nothing but markers — so a second
 * Enter at the end of a Callout leaves it, Notion-style. Null falls back
 * to the default Enter (including list continuation inside quotes, which
 * Obsidian already handles with the full "> - " prefix).
 */
export function quoteEnterPlan(
  doc: Text,
  pos: number,
  fences?: FenceRange[]
): QuoteKeyPlan | null {
  const columnFence = columnFenceEnterPlan(doc, pos);
  if (columnFence) return columnFence;
  const resolved = fences ?? cachedFences(doc);
  const line = doc.lineAt(pos);
  const prefix = quoteMarkerPrefix(line.text);
  if (prefix == null) return null;
  if (fenceAt(resolved, line.number)) return null;
  if (RE_QUOTE_ONLY.test(line.text)) {
    const columnDepth = columnContentQuoteDepth(doc, line.number);
    // The two quote markers of an nf-col are structure, not a quote level
    // the user can leave with Enter. Keep a fresh empty block in the same
    // column instead of silently turning "> >" into ">" and splitting the
    // columns row. Deeper, user-authored nested quotes can still dedent.
    //
    // The same holds for any marker-only row with more of its own container
    // below it: there is nothing to exit from mid-block, so Enter means
    // "another row here".
    if (
      (columnDepth != null && quoteDepth(line.text) <= columnDepth) ||
      !quoteRowEndsItsLevel(doc, line.number)
    ) {
      // Anchored at the end of the row, not at the caret. The row is nothing
      // but markers, and a widget stands in for them — so Home leaves the
      // caret at offset 0, where inserting would split the marker itself and
      // write ">>" onto the next line.
      pos = line.to;
      return {
        from: pos,
        to: pos,
        insert: "\n" + prefix,
        cursor: pos + 1 + prefix.length,
      };
    }
    const d = dedentQuoteLine(line.text)!;
    // Fully exiting drops the caret onto the line directly below the
    // block, where anything typed would rejoin it as a lazy continuation.
    // Leave a real blank line between the quote and the caret.
    const sealed =
      !d.text.includes(">") &&
      line.number > 1 &&
      RE_QUOTE.test(doc.line(line.number - 1).text);
    const insert = sealed ? d.text + "\n" : d.text;
    return {
      from: line.from,
      to: line.to,
      insert,
      cursor: line.from + (sealed ? insert.length : d.cursor),
    };
  }
  if (pos - line.from < prefix.length) return null;
  if (RE_LIST.test(line.text.slice(prefix.length))) return null;
  return { from: pos, to: pos, insert: "\n" + prefix, cursor: pos + 1 + prefix.length };
}

/**
 * Backspace with the caret exactly at a quote line's content start removes
 * one whole marker level instead of eating "> " character by character.
 */
export function quoteBackspacePlan(
  doc: Text,
  pos: number,
  fences?: FenceRange[]
): QuoteKeyPlan | null {
  const columnFence = columnFenceBackspacePlan(doc, pos);
  if (columnFence) return columnFence;
  const resolved = fences ?? cachedFences(doc);
  const line = doc.lineAt(pos);
  const prefix = quoteMarkerPrefix(line.text);
  if (prefix == null) return null;
  if (fenceAt(resolved, line.number)) return null;
  const offset = pos - line.from;
  const columnDepth = columnContentQuoteDepth(doc, line.number);
  // "[!nf-cols]" and "[!nf-col]" are scaffolding the plugin writes, not
  // prose the user typed: shedding their quote level leaves the literal
  // token behind as text and orphans every column under it. Unwrapping a
  // columns row is a deliberate action with its own menu item.
  const scaffoldType = parseCalloutHeader(line.text)?.type;
  if (
    (columnDepth != null && quoteDepth(line.text) <= columnDepth) ||
    scaffoldType === COLS_TYPE ||
    scaffoldType === COL_TYPE ||
    (RE_QUOTE_ONLY.test(line.text) &&
      isColumnSeparatorRow(doc, line.number, resolved))
  ) {
    // Anywhere in the markers, not just at their end. A widget stands in for
    // them, so Home puts the caret BEFORE them rather than after — and from
    // there CodeMirror's own Backspace would swallow the newline and fold the
    // row into the one above, which is exactly the structural damage this
    // branch exists to prevent. Past the markers the row is ordinary text
    // again and the key belongs to the editor.
    if (offset > prefix.length) return null;
    return { from: pos, to: pos, insert: "", cursor: pos };
  }
  if (offset !== prefix.length) return null;
  // An empty row in the middle of a container has no text to unquote, and
  // dedenting it would split the container. Remove the row instead, which
  // is what Backspace on an empty block means everywhere else.
  if (
    RE_QUOTE_ONLY.test(line.text) &&
    line.number > 1 &&
    !quoteRowEndsItsLevel(doc, line.number)
  ) {
    const previous = doc.line(line.number - 1);
    return { from: previous.to, to: line.to, insert: "", cursor: previous.to };
  }
  // Shedding one level is an EXIT, and a row with siblings below it has
  // nothing to exit from — doing it there tore the container in half, which
  // is the whole reason this branch exists. What the caret is actually
  // sitting in decides the answer:
  //
  //   - on the container's own first row, "remove this block's type" means
  //     the whole container, so unwrap every row of it at once;
  //   - anywhere further down, Backspace at a line start means what it means
  //     in every editor: join this row onto the one above.
  if (!quoteRowEndsItsLevel(doc, line.number)) {
    const block = quoteLevelBlock(doc, line.number);
    if (block.startLine === line.number) {
      const unwrapped = turnQuoteBlockInto(doc, block, "");
      if (unwrapped) {
        const outer = splitQuoteMarkers(
          line.text,
          quotePrefixDepth(block.quotePrefix ?? "")
        ).prefix;
        return { ...unwrapped, cursor: unwrapped.from + outer.length };
      }
    } else if (line.number > 1) {
      const previous = doc.line(line.number - 1);
      // Joining onto a fence marker or a table row would break the block
      // above rather than edit the one the caret is in.
      if (fenceAt(resolved, line.number - 1) || isTableRow(previous.text)) {
        return { from: pos, to: pos, insert: "", cursor: pos };
      }
      return {
        from: previous.to,
        to: line.from + prefix.length,
        insert: "",
        cursor: previous.to,
      };
    }
  }
  const d = dedentQuoteLine(line.text)!;
  return {
    from: line.from,
    to: line.to,
    insert: d.text,
    cursor: line.from + d.cursor,
  };
}

/**
 * Rewrite of a multi-line paste landing inside a quote/Callout so every
 * inserted line keeps the block's marker prefix. Null pastes unchanged.
 */
export function buildQuotedPaste(
  lineText: string,
  cursorCh: number,
  clip: string
): string | null {
  if (!clip.includes("\n")) return null;
  const prefix = quoteMarkerPrefix(lineText);
  if (prefix == null || cursorCh < prefix.length) return null;
  return clip
    .replace(/\r\n?/g, "\n")
    // Terminal/editor copies often end with a newline — pasting it would
    // leave a dangling bare-marker line under the block.
    .replace(/\n$/, "")
    .split("\n")
    .map((pasted, index) => (index === 0 ? pasted : prefix + pasted))
    .join("\n");
}

/**
 * Structural quote paste for a real selection. A selection that crosses a
 * Callout boundary, quote depth, lazy continuation, or fenced-code edge must
 * fall back to Obsidian's normal paste instead of silently pulling unrelated
 * rows into the starting Callout.
 */
export function buildQuotedPasteForSelection(
  doc: Text,
  from: number,
  to: number,
  clip: string,
  fences: FenceRange[] = scanFences(doc)
): string | null {
  if (!clip.includes("\n")) return null;
  const start = doc.lineAt(from);
  const end = doc.lineAt(to);
  const startPrefix = quoteMarkerPrefix(start.text);
  if (
    startPrefix == null ||
    from - start.from < startPrefix.length ||
    fenceAt(fences, start.number) ||
    fenceAt(fences, end.number)
  ) return null;

  if (end.number !== start.number) {
    const expected = normalizeQuotePrefix(startPrefix);
    const expectedDepth = quotePrefixDepth(startPrefix);
    const endPrefix = quoteMarkerPrefix(end.text);
    if (
      endPrefix == null ||
      normalizeQuotePrefix(endPrefix) !== expected ||
      to - end.from < endPrefix.length
    ) return null;
    for (let lineNo = start.number + 1; lineNo < end.number; lineNo++) {
      if (normalizeQuotePrefix(quoteMarkerPrefix(doc.line(lineNo).text) ?? "") !== expected) {
        return null;
      }
    }
    const startContainer = quoteContainerRange(doc, start.number, fences);
    const endContainer = quoteContainerRange(doc, end.number, fences);
    if (
      !startContainer ||
      !endContainer ||
      startContainer.startLine !== endContainer.startLine ||
      startContainer.endLine !== endContainer.endLine
    ) return null;

    // A contiguous quote may contain more than one Callout separated only
    // by a quoted blank row. Track the nearest same-depth Callout header so
    // a selection cannot rewrite the second card as part of the first.
    const ownerHeader = (lineNo: number): number | null => {
      for (let n = lineNo; n >= startContainer.startLine; n--) {
        const row = doc.line(n).text;
        const prefix = quoteMarkerPrefix(row);
        if (quotePrefixDepth(prefix ?? "") !== expectedDepth) continue;
        if (RE_CALLOUT_HEAD_CONTENT.test(splitQuoteMarkers(row, expectedDepth).rest)) {
          return n;
        }
      }
      return null;
    };
    if (ownerHeader(start.number) !== ownerHeader(end.number)) return null;
  }

  return buildQuotedPaste(start.text, from - start.from, clip);
}

/** A single-caret check shared by the quote and code block keymaps. */
function soloCaret(view: EditorView): number | null {
  if (view.composing) return null;
  const sel = view.state.selection;
  if (sel.ranges.length !== 1 || !sel.main.empty) return null;
  return sel.main.head;
}

/** Apply a key plan as one editor transaction; false lets the key fall
 * through to the next handler. */
function applyKeyPlan(
  view: EditorView,
  plan: QuoteKeyPlan | null,
  userEvent: string
): boolean {
  if (!plan) return false;
  view.dispatch({
    changes: { from: plan.from, to: plan.to, insert: plan.insert },
    selection: { anchor: plan.cursor },
    scrollIntoView: true,
    userEvent,
  });
  return true;
}

const RE_LEADING_WS = /^[ \t]*/;

/** Prefix to repeat when splitting a code body row. In a quote this keeps
 * the structural `>` markers and any code indentation after them. */
function fenceLinePrefix(text: string, fence: FenceRange): string {
  if (fence.quoteDepth === 0) return text.match(RE_LEADING_WS)?.[0] ?? "";
  const quoted = quotePrefixParts(text);
  if (!quoted) return fence.bodyPrefix;
  const restWs = text.slice(quoted.length).match(RE_LEADING_WS)?.[0] ?? "";
  return text.slice(0, quoted.length) + restWs;
}

type FenceIndentLanguage = "python" | "brace";
type FenceLexMode =
  | "code"
  | "lineComment"
  | "blockComment"
  | "single"
  | "double"
  | "template"
  | "tripleSingle"
  | "tripleDouble"
  | "regex";

interface FenceLexState {
  mode: FenceLexMode;
  escaped: boolean;
  regexClass: boolean;
}

const PYTHON_FENCE_LANGUAGES = new Set(["py", "python", "python3"]);
const BRACE_FENCE_LANGUAGES = new Set([
  "js",
  "javascript",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "typescript",
  "tsx",
  "json",
  "jsonc",
  "json5",
  "css",
  "scss",
  "less",
]);

/** Only explicit, familiar language tags opt into semantic indentation.
 * Unknown fences retain the exact old keep-indent behavior. */
function fenceIndentLanguage(
  doc: Text,
  fence: FenceRange
): FenceIndentLanguage | null {
  const parts = fenceLineParts(doc.line(fence.startLine).text);
  let tag = parts?.info.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  tag = tag.replace(/^language-/, "").replace(/^\{\./, "").replace(/\}$/, "");
  if (PYTHON_FENCE_LANGUAGES.has(tag)) return "python";
  return BRACE_FENCE_LANGUAGES.has(tag) ? "brace" : null;
}

/** Concealed Notion Flow formatting tags are presentation, not code. Keep
 * their source offsets but blank their characters before lexical analysis. */
function maskFenceFormattingTags(text: string): string {
  const masked = text.split("");
  for (const pair of findColorTagPairs(text)) {
    for (const range of [pair.open, pair.close]) {
      for (let i = range.from; i < range.to; i++) masked[i] = " ";
    }
  }
  return masked.join("");
}

function slashStartsRegex(code: string): boolean {
  const before = code.trimEnd();
  if (!before) return true;
  const last = before[before.length - 1];
  if ("([{:;,=!?&|+-*%^~<>".includes(last)) return true;
  const word = /([A-Za-z_$][\w$]*)$/.exec(before)?.[1];
  return !!word && /^(?:return|throw|case|delete|typeof|void|new|yield|await|else|do)$/.test(word);
}

/** A deliberately small lexer: it only distinguishes code from strings and
 * comments, which is enough to make bracket/colon rules safe without
 * bundling every fenced language grammar. */
function scanFenceCode(
  text: string,
  language: FenceIndentLanguage,
  incoming: FenceLexState
): { code: string; state: FenceLexState } {
  const state = { ...incoming };
  const chars = text.split("");
  const blank = (from: number, count = 1) => {
    for (let i = from; i < Math.min(chars.length, from + count); i++) chars[i] = " ";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1] ?? "";
    if (state.mode === "lineComment") {
      blank(i, text.length - i);
      break;
    }
    if (state.mode === "blockComment") {
      if (ch === "*" && next === "/") {
        blank(i, 2);
        i++;
        state.mode = "code";
      } else blank(i);
      continue;
    }
    if (state.mode === "tripleSingle" || state.mode === "tripleDouble") {
      const delimiter = state.mode === "tripleSingle" ? "'''" : '\"\"\"';
      if (text.startsWith(delimiter, i)) {
        blank(i, 3);
        i += 2;
        state.mode = "code";
        state.escaped = false;
      } else blank(i);
      continue;
    }
    if (
      state.mode === "single" ||
      state.mode === "double" ||
      state.mode === "template"
    ) {
      const delimiter = state.mode === "single" ? "'" : state.mode === "double" ? '\"' : "`";
      blank(i);
      if (state.escaped) state.escaped = false;
      else if (ch === "\\") state.escaped = true;
      else if (ch === delimiter) state.mode = "code";
      continue;
    }
    if (state.mode === "regex") {
      blank(i);
      if (state.escaped) state.escaped = false;
      else if (ch === "\\") state.escaped = true;
      else if (ch === "[" && !state.regexClass) state.regexClass = true;
      else if (ch === "]" && state.regexClass) state.regexClass = false;
      else if (ch === "/" && !state.regexClass) state.mode = "code";
      continue;
    }

    if (language === "python" && text.startsWith("'''", i)) {
      blank(i, 3);
      i += 2;
      state.mode = "tripleSingle";
      continue;
    }
    if (language === "python" && text.startsWith('\"\"\"', i)) {
      blank(i, 3);
      i += 2;
      state.mode = "tripleDouble";
      continue;
    }
    if (ch === "'" || ch === '\"' || (language === "brace" && ch === "`")) {
      blank(i);
      state.mode = ch === "'" ? "single" : ch === '\"' ? "double" : "template";
      state.escaped = false;
      continue;
    }
    if (language === "python" && ch === "#") {
      blank(i, text.length - i);
      state.mode = "lineComment";
      break;
    }
    if (language === "brace" && ch === "/" && next === "/") {
      blank(i, text.length - i);
      state.mode = "lineComment";
      break;
    }
    if (language === "brace" && ch === "/" && next === "*") {
      blank(i, 2);
      i++;
      state.mode = "blockComment";
      continue;
    }
    if (language === "brace" && ch === "/" && slashStartsRegex(chars.slice(0, i).join(""))) {
      blank(i);
      state.mode = "regex";
      state.escaped = false;
      state.regexClass = false;
    }
  }
  return { code: chars.join(""), state };
}

function finishFenceLexLine(state: FenceLexState): FenceLexState {
  // These constructs cannot legally cross a physical line without special
  // syntax. Recover on the next row instead of letting one half-typed quote
  // disable smart indentation for the remainder of the fence.
  if (
    state.mode === "lineComment" ||
    state.mode === "single" ||
    state.mode === "double" ||
    state.mode === "regex"
  ) {
    return { mode: "code", escaped: false, regexClass: false };
  }
  return { ...state, escaped: false };
}

function fenceLexStateBeforeLine(
  doc: Text,
  fence: FenceRange,
  lineNo: number,
  language: FenceIndentLanguage
): FenceLexState {
  let state: FenceLexState = { mode: "code", escaped: false, regexClass: false };
  for (let n = fence.startLine + 1; n < lineNo; n++) {
    const text = doc.line(n).text;
    const prefix = fenceLinePrefix(text, fence);
    state = finishFenceLexLine(
      scanFenceCode(maskFenceFormattingTags(text.slice(prefix.length)), language, state).state
    );
  }
  return state;
}

const MATCHING_DELIMITER: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

function openDelimiterStack(code: string): string[] | null {
  const stack: string[] = [];
  for (const ch of code) {
    if (MATCHING_DELIMITER[ch]) stack.push(ch);
    else if (ch === ")" || ch === "]" || ch === "}") {
      const open = stack.pop();
      if (!open || MATCHING_DELIMITER[open] !== ch) return null;
    }
  }
  return stack;
}

function pythonBlockHeader(code: string): boolean {
  const text = code.trim();
  if (!text.endsWith(":")) return false;
  const beforeColon = text.slice(0, -1);
  if ((openDelimiterStack(beforeColon) ?? ["mismatch"]).length !== 0) return false;
  if (/^(?:try|else|finally)\s*:$/.test(text)) return true;
  return /^(?:(?:async\s+)?(?:def|for|with)\b|(?:if|elif|while|class|match|case)\b|except(?:\*|\b))[\s\S]*:$/.test(text);
}

/**
 * Enter inside a fenced code block. Body lines continue their own leading
 * indentation — essential for blocks nested in (deep) lists, where every
 * code line must keep the list's content column. Known Python/brace-language
 * fences add one vault indent after an unclosed delimiter (or a Python block
 * header), and split an existing matching pair into an indented blank row
 * plus an aligned closer. Enter at the end of an unclosed opener also writes
 * the closing fence, so a freshly typed ``` stops swallowing the rest of the
 * note.
 */
export function fenceEnterPlan(
  doc: Text,
  pos: number,
  fences: FenceRange[] = cachedFences(doc),
  unit: IndentUnit = DEFAULT_INDENT_UNIT
): QuoteKeyPlan | null {
  const line = doc.lineAt(pos);
  const fence = fenceAt(fences, line.number);
  if (!fence) return null;
  const bodyWs = fence.bodyPrefix;
  if (line.number === fence.startLine) {
    // Only a caret at the end of the opener gets smart handling; edits
    // inside the info string keep their default behavior.
    if (pos !== line.to) return null;
    const insert = fence.closed
      ? "\n" + bodyWs
      : "\n" + bodyWs + "\n" + bodyWs + fence.marker;
    return { from: pos, to: pos, insert, cursor: pos + 1 + bodyWs.length };
  }
  if (fence.closed && line.number === fence.endLine) return null;
  const ws = fenceLinePrefix(line.text, fence);
  // A caret inside the leading whitespace would double the indentation.
  if (pos < line.from + ws.length) return null;
  const language = fenceIndentLanguage(doc, fence);
  if (!language) {
    return { from: pos, to: pos, insert: "\n" + ws, cursor: pos + 1 + ws.length };
  }

  const content = maskFenceFormattingTags(line.text.slice(ws.length));
  const caretCh = pos - line.from - ws.length;
  const state = fenceLexStateBeforeLine(doc, fence, line.number, language);
  const before = scanFenceCode(content.slice(0, caretCh), language, state);
  const after = scanFenceCode(content.slice(caretCh), language, before.state);
  const significantBefore = before.code.trimEnd();
  const significantAfter = after.code.trimStart();
  const stack = openDelimiterStack(before.code);
  const last = significantBefore[significantBefore.length - 1] ?? "";
  const first = significantAfter[0] ?? "";
  const step = indentPrefix(Math.max(1, unit.width), unit);

  // The caret is immediately between a syntactically visible matching pair.
  // Write both rows now so the suffix closer aligns with the outer code, not
  // with the caret's new inner indentation.
  if (
    before.state.mode === "code" &&
    stack?.[stack.length - 1] === last &&
    MATCHING_DELIMITER[last] === first &&
    before.code.endsWith(last) &&
    after.code.startsWith(first)
  ) {
    const inner = ws + step;
    const insert = "\n" + inner + "\n" + ws;
    return { from: pos, to: pos, insert, cursor: pos + 1 + inner.length };
  }

  // A line comment after real code is safe to ignore (`if (x) { // why`).
  // Active strings, templates, regexes and block/triple comments are not:
  // delimiters and colons there remain literal, so preserve indentation.
  const codeContext =
    before.state.mode === "code" || before.state.mode === "lineComment";
  const smartIndent =
    codeContext &&
    ((stack != null && stack.length > 0) ||
      (language === "python" && pythonBlockHeader(before.code)));
  const nextWs = smartIndent ? ws + step : ws;
  return {
    from: pos,
    to: pos,
    insert: "\n" + nextWs,
    cursor: pos + 1 + nextWs.length,
  };
}

/**
 * Backspace with the caret at a code line's content start removes one
 * whole indent level (vault-unit aligned) instead of one character.
 */
export function fenceBackspacePlan(
  doc: Text,
  pos: number,
  fences: FenceRange[] = cachedFences(doc),
  unit: IndentUnit = DEFAULT_INDENT_UNIT
): QuoteKeyPlan | null {
  const line = doc.lineAt(pos);
  const fence = fenceAt(fences, line.number);
  if (!fence) return null;
  if (
    line.number === fence.startLine ||
    (fence.closed && line.number === fence.endLine)
  )
    return null;
  const containerLength = fence.quoteDepth > 0
    ? quotePrefixParts(line.text)?.length ?? fence.bodyPrefix.length
    : 0;
  const ws = line.text.slice(containerLength).match(RE_LEADING_WS)?.[0] ?? "";
  if (ws.length === 0 || pos !== line.from + containerLength + ws.length) return null;
  const width = indentWidth(ws);
  const target =
    width % unit.width === 0
      ? width - unit.width
      : Math.floor(width / unit.width) * unit.width;
  const insert = indentPrefix(Math.max(0, target), unit);
  return {
    from: line.from + containerLength,
    to: line.from + containerLength + ws.length,
    insert,
    cursor: line.from + containerLength + insert.length,
  };
}

/**
 * Mod+Shift+Enter inside a fenced code block leaves the block downward: the
 * caret lands on a line after the closing fence (which is written first
 * when missing), keeping the fence's own indentation so a block nested
 * in a list item stays inside that item.
 */
export function fenceExitPlan(
  doc: Text,
  pos: number,
  fences: FenceRange[] = cachedFences(doc)
): QuoteKeyPlan | null {
  const line = doc.lineAt(pos);
  const fence = fenceAt(fences, line.number);
  if (!fence) return null;
  const bodyWs = fence.bodyPrefix;
  const metadataLine = codeCaptionMeta(doc, fence)?.lineNo;
  const blockEndLine = metadataLine ?? fence.endLine;
  if (fence.closed && blockEndLine < doc.lines) {
    // A blank line already waits below the block — just move there.
    const next = doc.line(blockEndLine + 1);
    if (RE_BLANK.test(next.text)) {
      return { from: next.to, to: next.to, insert: "", cursor: next.to };
    }
  }
  const last = doc.line(blockEndLine);
  let insert = "\n" + bodyWs;
  if (!fence.closed) {
    insert = "\n" + bodyWs + fence.marker + insert;
  }
  return {
    from: last.to,
    to: last.to,
    insert,
    cursor: last.to + insert.length,
  };
}

/**
 * Where the caret goes when a code block folds. Every row of the block —
 * its opening fence included — disappears behind the fold chip, so a caret
 * left on one would sit in a row nobody can see and every keystroke would
 * vanish into folded code (or land in front of the caption HTML and break
 * the chip). It goes to the start of the row after the chip instead, which
 * is also the paragraph a writer reaches for once a block is out of the
 * way; a block that ends the note gets that row written for it, exactly as
 * a click below the note would.
 *
 * `blockEnd` is the block's last line — its caption row when it already has
 * one — numbered in `doc`, the document BEFORE the caption change lands.
 * `pos` is therefore a position the caller maps through that change; `null`
 * means the caret belongs at the very end of the note, after `append`.
 */
export function codeFoldExitPlan(
  doc: Text,
  fence: FenceRange,
  blockEnd: number
): { pos: number | null; append: string | null } {
  if (blockEnd < doc.lines) {
    return { pos: doc.line(blockEnd + 1).from, append: null };
  }
  // Quote markers are deliberately dropped, matching trailingParagraphPlan:
  // a row after the block means "after the Callout", not one more line of it.
  const bodyPrefix = fence.quoteDepth > 0 ? "" : fence.bodyPrefix;
  return { pos: null, append: "\n" + bodyPrefix };
}

/**
 * A note whose last line belongs to a structural block has no place to put
 * the caret "after" that block: clicking the empty space below the document
 * lands at the end of the block's own last row. For a code block that row is
 * the closing fence — drawn as the card's 4px bottom edge — so the caret is
 * invisible and typing there silently turns the closer into a new opener,
 * swallowing the rest of the note. Notion answers the same click by adding a
 * paragraph, which is what this plan writes.
 *
 * Null when the note already ends somewhere a caret can simply go: a blank
 * line, ordinary prose, or a list item (all of which continue naturally).
 */
export function trailingParagraphPlan(
  doc: Text,
  fences: FenceRange[] = cachedFences(doc)
): QuoteKeyPlan | null {
  const last = doc.line(doc.lines);
  if (RE_BLANK.test(last.text)) return null;
  const fence = fenceAt(fences, last.number);
  // Inside a list the block's own indentation keeps the new paragraph in the
  // item that contains it; quote markers are deliberately dropped, since a
  // click below the note means "after the Callout", not "one more line of it".
  let prefix: string | null = null;
  if (fence) prefix = fence.quoteDepth > 0 ? "" : fence.bodyPrefix;
  else if (
    isTableRow(last.text) ||
    quoteMarkerPrefix(last.text) != null ||
    parseBlockCaption(last.text) != null ||
    isImageBlockLine(last.text) ||
    RE_HEADING.test(last.text) ||
    RE_HR.test(last.text)
  ) prefix = "";
  if (prefix == null) return null;
  const insert = "\n" + prefix;
  return {
    from: last.to,
    to: last.to,
    insert,
    cursor: last.to + insert.length,
  };
}

/**
 * Clicks in the empty space under the last block. The handler runs only for
 * a click that is genuinely below every line — one on the document's own
 * rows keeps CodeMirror's native caret placement.
 */
function makeTrailingClickPlugin() {
  return EditorView.domEventHandlers({
    mousedown(event: MouseEvent, view: EditorView) {
      if (event.button !== 0 || event.detail > 1 || view.state.readOnly) {
        return false;
      }
      if (event.altKey || event.shiftKey || event.metaKey || event.ctrlKey) {
        return false;
      }
      // Source mode shows the closing fence as ordinary text, so the caret
      // has somewhere visible to go and a click must not write anything.
      if (!isLivePreviewEditor(view)) return false;
      const target = event.target as Element | null;
      // Widgets (tables, embeds, rendered Callouts) own their own hit area
      // even where it extends past the last text row.
      if (target && target.closest(".cm-embed-block,.cm-table-widget")) {
        return false;
      }
      let bottom: number;
      try {
        bottom =
          view.lineBlockAt(view.state.doc.length).bottom + view.documentTop;
      } catch {
        return false;
      }
      if (event.clientY <= bottom) return false;
      const plan = trailingParagraphPlan(view.state.doc);
      if (!plan) return false;
      view.dispatch({
        changes: { from: plan.from, to: plan.to, insert: plan.insert },
        selection: { anchor: plan.cursor },
        scrollIntoView: true,
        userEvent: "input",
      });
      view.focus();
      event.preventDefault();
      return true;
    },
  });
}

function makeCodeBlockKeymap(plugin: NotionFlowPlugin) {
  const caret = (view: EditorView): number | null =>
    plugin.settings.codeBlockEditing ? soloCaret(view) : null;
  // Obsidian's own bold/italic hotkeys write ** and * — literal text
  // inside fenced code. Reroute them to the HTML tags the toolbar uses.
  const htmlToggle = (view: EditorView, open: string, close: string): boolean => {
    if (!plugin.settings.codeBlockEditing || view.composing) return false;
    const sel = view.state.selection.main;
    if (!fenceBodyRange(view.state.doc, sel.from, sel.to)) return false;
    if (sel.empty) {
      view.dispatch({
        changes: { from: sel.from, insert: open + close },
        selection: { anchor: sel.from + open.length },
        userEvent: "input",
      });
      return true;
    }
    toggleWrap(view, open, close);
    return true;
  };
  return Prec.high(
    keymap.of([
      { key: "Mod-b", run: (view) => htmlToggle(view, "<b>", "</b>") },
      { key: "Mod-i", run: (view) => htmlToggle(view, "<i>", "</i>") },
      {
        key: "Enter",
        run: (view) => {
          const pos = caret(view);
          if (pos == null) return false;
          return applyKeyPlan(
            view,
            fenceEnterPlan(
              view.state.doc,
              pos,
              cachedFences(view.state.doc),
              vaultIndentUnit(plugin.app)
            ),
            "input"
          );
        },
      },
      {
        key: "Backspace",
        run: (view) => {
          const pos = caret(view);
          if (pos == null) return false;
          return applyKeyPlan(
            view,
            fenceBackspacePlan(
              view.state.doc,
              pos,
              cachedFences(view.state.doc),
              vaultIndentUnit(plugin.app)
            ),
            "delete.dedent"
          );
        },
      },
      {
        key: "Mod-Shift-Enter",
        run: (view) => {
          const pos = caret(view);
          if (pos == null) return false;
          return applyKeyPlan(view, fenceExitPlan(view.state.doc, pos), "input");
        },
      },
    ])
  );
}

/**
 * Obsidian's own bold/italic/strikethrough hotkeys bypass CodeMirror
 * keymaps (the app's hotkey scope captures the key first) and insert a
 * Markdown marker pair in a single transaction. Inside a fenced code
 * block those markers are literal text, so rewrite the pair at the
 * transaction level into the HTML tags the toolbar uses — and remove an
 * existing tag pair when the same hotkey hits it again (toggle off).
 */
export const CODE_TAG_FOR_MARKER: Record<string, [string, string]> = {
  "**": ["<b>", "</b>"],
  "*": ["<i>", "</i>"],
  "~~": ["<s>", "</s>"],
};

function makeCodeMarkerRewriter(plugin: NotionFlowPlugin) {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;
    const inserts: { from: number; text: string }[] = [];
    let pureInsert = true;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, ins) => {
      if (fromA !== toA) pureInsert = false;
      inserts.push({ from: fromA, text: ins.toString() });
    });
    if (!pureInsert || inserts.length !== 2) return tr;
    const [head, tail] = inserts;
    const pair = CODE_TAG_FOR_MARKER[head.text];
    if (!pair || tail.text !== head.text) return tr;
    // Only toggle shapes: both inserts anchored exactly at the single
    // selection's ends, or — Obsidian's empty-selection toggle expands to
    // the word around the caret — bracketing that caret. Two CARETS each
    // typing "*" produce two RANGES, and one caret typing "*" produces one
    // insert, so literal keystrokes always fall through.
    const startSel = tr.startState.selection;
    if (startSel.ranges.length !== 1) return tr;
    const main = startSel.main;
    const exactWrap =
      !main.empty && head.from === main.from && tail.from === main.to;
    const wordWrap =
      main.empty &&
      head.from < tail.from &&
      head.from <= main.head &&
      main.head <= tail.from;
    if (!exactWrap && !wordWrap) return tr;
    const doc = tr.startState.doc;
    const [open, close] = pair;
    const inFence = !!fenceBodyRange(doc, head.from, tail.from, cachedFences(doc));
    if (inFence && !plugin.settings.codeBlockEditing) return tr;
    const before = doc.sliceString(Math.max(0, head.from - open.length), head.from);
    const after = doc.sliceString(tail.from, tail.from + close.length);
    if (!inFence && !(before === open && after === close)) {
      // Outside code the markers are real Markdown. Rewrite the hotkey only
      // when it would wrap HTML-tagged text, where Markdown cannot style
      // the rendered element (see rangeTouchesHtmlPairIn). A second press
      // inside an already tag-wrapped region toggles that pair off.
      const source = doc.toString();
      const enclosing = enclosingTagPairIn(
        source,
        head.from,
        tail.from,
        open,
        close
      );
      if (enclosing) {
        const openingLength = enclosing.open.to - enclosing.open.from;
        return [
          {
            changes: [
              { from: enclosing.open.from, to: enclosing.open.to },
              { from: enclosing.close.from, to: enclosing.close.to },
            ],
            selection: {
              anchor: head.from - openingLength,
              head: tail.from - openingLength,
            },
            scrollIntoView: true,
            userEvent: "input",
          },
        ];
      }
      if (!rangeTouchesHtmlPairIn(source, head.from, tail.from)) return tr;
    }
    if (before === open && after === close) {
      // The selection is already wrapped — the hotkey toggles it off.
      return [
        {
          changes: [
            { from: head.from - open.length, to: head.from },
            { from: tail.from, to: tail.from + close.length },
          ],
          selection: {
            anchor: head.from - open.length,
            head: tail.from - open.length,
          },
          scrollIntoView: true,
          userEvent: "input",
        },
      ];
    }
    return [
      {
        changes: [
          { from: head.from, insert: open },
          { from: tail.from, insert: close },
        ],
        selection: {
          anchor: head.from + open.length,
          head: tail.from + open.length,
        },
        scrollIntoView: true,
        userEvent: "input",
      },
    ];
  });
}

/**
 * Step a block one nesting level in or out, in place.
 *
 * The levels come from `computeDropLevels` and the edit from `moveBlock`,
 * which is the whole of what a sideways drag does — so Tab cannot offer a
 * depth the drag would refuse, and neither can spell a level the other
 * spells differently. `pickDropLevel` with a delta of exactly one step is
 * the same "where am I now, one over" question the drag asks per mouse
 * move, so the step lands on the same rung the pointer would have.
 *
 * Returns false when there is no level to move to, which is how Tab keeps
 * its ordinary meaning wherever the block has nowhere to go.
 */
export function indentBlockStep(
  view: EditorView,
  block: BlockRange,
  dir: -1 | 1,
  fences: FenceRange[],
  unit: IndentUnit
): boolean {
  const doc = view.state.doc;
  const levels = computeDropLevels(doc, fences, block.startLine, block);
  if (levels.length < 2) return false;
  const STEP = 24;
  const current = block.quotePrefix ?? "";
  const indent = indentWidth(doc.line(block.startLine).text);
  const here = pickDropLevel(levels, current, indent, 0, STEP);
  const next = pickDropLevel(levels, current, indent, dir * STEP, STEP);
  if (next.indent === here.indent && next.quotePrefix === here.quotePrefix) {
    return false;
  }
  return (
    moveBlock(
      view,
      block,
      block.startLine,
      fences,
      next.indent,
      unit,
      next.quotePrefix
    ) != null
  );
}

/**
 * Tab / Shift+Tab as a block-level action, the way Notion's Tab works.
 *
 * It claims the key only where Tab has no better meaning already: a list
 * item is Obsidian's own (it renumbers and re-marks siblings, which this
 * does not), a table cell belongs to the table keymap, and inside a fence
 * Tab is code indentation. Everything left — a paragraph, a heading, a
 * quote, a Callout — had no block meaning for Tab at all, and typing a
 * literal tab into one is what the fall-through still does when the block
 * has no level to step to.
 */
export function blockIndentTarget(
  doc: Text,
  lineNo: number,
  fences: FenceRange[]
): BlockRange | null {
  if (fenceAt(fences, lineNo)) return null;
  if (isTableRow(doc.line(lineNo).text)) return null;
  const block = innerBlockAt(doc, lineNo, fences);
  if (!block) return null;
  // The block's FIRST row decides, not the caret's. A line trailing a list
  // item is that item's lazy continuation — already its content, with no
  // indent of its own to give — and the item itself is Obsidian's to
  // indent, since it renumbers and re-marks siblings and this does not.
  const first = doc.line(block.startLine).text;
  const content = block.quotePrefix
    ? first.slice(quoteMarkerPrefix(first)?.length ?? 0)
    : first;
  if (RE_LIST.test(content)) return null;
  if (RE_BLANK.test(content)) return null;
  return block;
}

function makeBlockIndentKeymap(plugin: NotionFlowPlugin) {
  const step = (view: EditorView, dir: -1 | 1): boolean => {
    if (!plugin.settings.blockIndent) return false;
    const sel = view.state.selection.main;
    // A real selection means "indent this text", which is not this key's
    // question. One caret is the only shape a block step describes.
    if (!sel.empty || view.state.selection.ranges.length !== 1) return false;
    const doc = view.state.doc;
    const fences = cachedFences(doc);
    const block = blockIndentTarget(doc, doc.lineAt(sel.head).number, fences);
    if (!block) return false;
    return indentBlockStep(view, block, dir, fences, vaultIndentUnit(plugin.app));
  };
  return Prec.high(
    keymap.of([{ key: "Tab", run: (v) => step(v, 1), shift: (v) => step(v, -1) }])
  );
}

function makeQuoteKeymap(plugin: NotionFlowPlugin) {
  const caret = (view: EditorView): number | null =>
    plugin.settings.calloutEditing ? soloCaret(view) : null;
  const headerPlan = (
    view: EditorView,
    pos: number,
    key: "Home" | "Backspace" | "Delete"
  ) =>
    isLivePreviewEditor(view)
      ? calloutHeaderKeyPlan(view.state.doc, pos, key)
      : null;
  const apply = applyKeyPlan;
  return Prec.high(
    keymap.of([
      {
        key: "Enter",
        run: (view) => {
          const pos = caret(view);
          if (pos == null) return false;
          return apply(view, quoteEnterPlan(view.state.doc, pos), "input");
        },
      },
      {
        key: "Backspace",
        run: (view) => {
          const pos = caret(view);
          if (pos == null) return false;
          return apply(
            view,
            headerPlan(view, pos, "Backspace") ??
              quoteBackspacePlan(view.state.doc, pos),
            "delete.dequote"
          );
        },
      },
      {
        key: "Delete",
        run: (view) => {
          const pos = caret(view);
          if (pos == null) return false;
          return apply(
            view,
            headerPlan(view, pos, "Delete"),
            "delete.callout-header"
          );
        },
      },
      {
        key: "Home",
        run: (view) => {
          const pos = caret(view);
          if (pos == null) return false;
          return apply(
            view,
            headerPlan(view, pos, "Home"),
            "select.callout-title"
          );
        },
      },
    ])
  );
}

/** Obsidian's built-in Callout types; aliases resolve to these. */
export const CALLOUT_TYPES: { type: string; label: string; icon: string }[] = [
  { type: "note", label: "Note", icon: "pencil" },
  { type: "abstract", label: "Abstract", icon: "clipboard-list" },
  { type: "info", label: "Info", icon: "info" },
  { type: "todo", label: "To-do", icon: "check-circle-2" },
  { type: "tip", label: "Tip", icon: "flame" },
  { type: "success", label: "Success", icon: "check" },
  { type: "question", label: "Question", icon: "help-circle" },
  { type: "warning", label: "Warning", icon: "alert-triangle" },
  { type: "failure", label: "Failure", icon: "x" },
  { type: "danger", label: "Danger", icon: "zap" },
  { type: "bug", label: "Bug", icon: "bug" },
  { type: "example", label: "Example", icon: "list" },
  { type: "quote", label: "Quote", icon: "quote" },
];

const CALLOUT_ALIASES: Record<string, string> = {
  summary: "abstract",
  tldr: "abstract",
  hint: "tip",
  important: "tip",
  check: "success",
  done: "success",
  help: "question",
  faq: "question",
  caution: "warning",
  attention: "warning",
  fail: "failure",
  missing: "failure",
  error: "danger",
  cite: "quote",
};

export interface CalloutHeader {
  /** Canonical lowercase type, aliases resolved ("error" → "danger"). */
  type: string;
  fold: "" | "+" | "-";
  /** Offsets of the type token inside the line ("|metadata" excluded). */
  typeFrom: number;
  typeTo: number;
  /** Offset just after "]", where the fold marker sits or would go. */
  foldAt: number;
}

const RE_CALLOUT_HEAD = /^(\s*(?:>[ \t]*)+\[!)([^\]|\r\n]+)([^\]\r\n]*\])([+-]?)/;

/** Parse "> [!type]±" at the start of a line, or null. */
export function parseCalloutHeader(text: string): CalloutHeader | null {
  const m = text.match(RE_CALLOUT_HEAD);
  if (!m) return null;
  const raw = m[2].trim().toLowerCase();
  return {
    type: CALLOUT_ALIASES[raw] ?? raw,
    fold: m[4] as "" | "+" | "-",
    typeFrom: m[1].length,
    typeTo: m[1].length + m[2].length,
    foldAt: m[1].length + m[2].length + m[3].length,
  };
}

/** The source token represented by the visual Callout lead while editing.
 * Keep this boundary shared by the decoration, keyboard protection and the
 * click activator: one character of disagreement would either expose source
 * or leave an invisible character that Backspace can corrupt. */
export function calloutHeaderVisualRange(
  text: string
): { from: number; to: number } | null {
  const header = parseCalloutHeader(text);
  if (!header) return null;
  const from = text.match(RE_LEADING_WS)?.[0].length ?? 0;
  let to = header.foldAt + (header.fold === "" ? 0 : 1);
  if (text[to] === " " || text[to] === "\t") to++;
  return { from, to };
}

/** A stable source caret used only to open a rendered Callout before the
 * original pointer coordinates are mapped onto its editable rows. */
export function calloutActivationCursor(
  doc: Text,
  startLine: number,
  endLine: number
): { anchor: number; assoc: -1 | 1 } {
  if (endLine > startLine) {
    const body = doc.line(Math.min(doc.lines, startLine + 1));
    return {
      anchor: Math.min(body.to, body.from + (quoteMarkerPrefix(body.text)?.length ?? 0)),
      assoc: 1,
    };
  }

  const line = doc.line(startLine);
  const visual = calloutHeaderVisualRange(line.text);
  if (!visual) return { anchor: line.from, assoc: 1 };
  const titleStart = Math.min(line.to, line.from + visual.to);
  // A real title gives CodeMirror an unambiguous position inside ordinary
  // text. A title-less header has no such character, so stay on the right
  // side of the atomic visual token instead of falling back inside `[!type]`.
  return {
    anchor: titleStart < line.to ? titleStart + 1 : titleStart,
    assoc: 1,
  };
}

/** Map a rendered text node back to the same text in a Callout's Markdown.
 *
 * A rendered Callout can radically change height when it opens (tables and
 * lists are the common cases), so a clientY captured from the widget is not a
 * stable source coordinate. Text is stable. The DOM caret gives us one text
 * node plus its UTF-16 offset; find that exact fragment in the Callout source
 * and use the rendered row's approximate source position only to disambiguate
 * repeated text.
 *
 * Header tokens are deliberately excluded. A default rendered title such as
 * "Note" must never resolve into the hidden `[!note]` source and leave the
 * next keystroke editing structure instead of prose. */
export function calloutSourceTextAnchor(
  doc: Text,
  startLine: number,
  endLine: number,
  fragment: string,
  fragmentOffset: number,
  expectedPos: number
): number | null {
  if (!fragment || !fragment.trim()) return null;
  const first = Math.max(1, Math.min(doc.lines, startLine));
  const last = Math.max(first, Math.min(doc.lines, endLine));
  const from = doc.line(first).from;
  const to = doc.line(last).to;
  const source = doc.sliceString(from, to);
  const offset = Math.max(0, Math.min(fragment.length, fragmentOffset));
  const expected = Number.isFinite(expectedPos)
    ? Math.max(from, Math.min(to, expectedPos))
    : from + Math.floor((to - from) / 2);

  const hiddenHeaders: Array<{ from: number; to: number }> = [];
  for (let n = first; n <= last; n++) {
    const line = doc.line(n);
    const visual = calloutHeaderVisualRange(line.text);
    if (!visual) continue;
    hiddenHeaders.push({
      from: line.from + visual.from,
      to: line.from + visual.to,
    });
  }

  let best: { pos: number; distance: number } | null = null;
  for (let at = source.indexOf(fragment); at >= 0; at = source.indexOf(fragment, at + 1)) {
    const occurrenceFrom = from + at;
    const occurrenceTo = occurrenceFrom + fragment.length;
    if (
      hiddenHeaders.some(
        (hidden) => occurrenceFrom < hidden.to && occurrenceTo > hidden.from
      )
    ) {
      continue;
    }
    const pos = occurrenceFrom + offset;
    const distance = Math.abs(pos - expected);
    if (!best || distance < best.distance || (distance === best.distance && pos < best.pos)) {
      best = { pos, distance };
    }
  }
  return best?.pos ?? null;
}

/** Protect the hidden `> [!type] ` prefix and give Home a visible meaning.
 * Backspace at the actual title start deliberately keeps the existing
 * first-row behavior: it unwraps the whole Callout rather than deleting one
 * invisible token character. */
export function calloutHeaderKeyPlan(
  doc: Text,
  pos: number,
  key: "Home" | "Backspace" | "Delete"
): QuoteKeyPlan | null {
  const line = doc.lineAt(pos);
  const visual = calloutHeaderVisualRange(line.text);
  if (!visual) return null;
  const titleStart = line.from + visual.to;

  if (key === "Home") {
    return {
      from: pos,
      to: pos,
      insert: "",
      cursor: titleStart,
    };
  }
  if (key === "Backspace") {
    if (pos < titleStart) {
      return {
        from: pos,
        to: pos,
        insert: "",
        cursor: titleStart,
      };
    }
    if (pos === titleStart) {
      const prefix = quoteMarkerPrefix(line.text);
      if (prefix) {
        return quoteBackspacePlan(doc, line.from + prefix.length);
      }
    }
    return null;
  }

  if (pos < titleStart || (pos === titleStart && titleStart === line.to)) {
    return {
      from: pos,
      to: pos,
      insert: "",
      cursor: titleStart,
    };
  }
  return null;
}

/** The header line with its type token replaced ("|metadata" preserved). */
export function setCalloutType(text: string, type: string): string | null {
  const header = parseCalloutHeader(text);
  if (!header) return null;
  return text.slice(0, header.typeFrom) + type + text.slice(header.typeTo);
}

/** Add a "-" fold marker after "[!type]", or remove the existing one. */
export function toggleCalloutFold(text: string): string | null {
  const header = parseCalloutHeader(text);
  if (!header) return null;
  return header.fold
    ? text.slice(0, header.foldAt) + text.slice(header.foldAt + 1)
    : text.slice(0, header.foldAt) + "-" + text.slice(header.foldAt);
}

/** Promote a plain quote's first line to a Callout header. */
export function quoteToCallout(text: string, type: string): string | null {
  const prefix = quoteMarkerPrefix(text);
  if (prefix == null || parseCalloutHeader(text)) return null;
  return text.slice(0, prefix.length) + `[!${type}] ` + text.slice(prefix.length);
}

/** Strip "[!type]±" (and one following space) from a Callout header. */
export function calloutToQuote(text: string): string | null {
  const m = text.match(RE_CALLOUT_HEAD);
  if (!m) return null;
  const start = m[1].length - 2; // the "[!"
  let end = m[1].length + m[2].length + m[3].length + m[4].length;
  if (text[end] === " ") end++;
  return text.slice(0, start) + text.slice(end);
}

/* ------------------------------------------------------------------ */
/* Toggle (Notion-style foldable block)                                */
/*                                                                     */
/* A "[!nf-toggle]" Callout whose fold marker carries the open state:   */
/* "-" collapsed, "+" expanded. Obsidian folds it natively and writes   */
/* the marker back into the note, so — unlike Obsidian's list folding,  */
/* which lives in workspace state — the state travels with the file,    */
/* the way Notion's does. Any other Markdown reader sees a blockquote.  */
/* ------------------------------------------------------------------ */

export const TOGGLE_TYPE = "nf-toggle";

const RE_TOGGLE_HEAD = new RegExp(
  `^(\\s*(?:>[ \\t]*)+)\\[!${TOGGLE_TYPE}\\]([+-]?)[ \\t]?`,
  "i"
);

/** Parse a toggle header line, or null. `collapsed` follows the fold
 * marker; a toggle written without one is treated as open. */
export function parseToggleHeader(text: string): {
  prefix: string;
  collapsed: boolean;
  title: string;
  /** Offsets of the "[!nf-toggle]±" token, one trailing space included. */
  tokenFrom: number;
  tokenTo: number;
} | null {
  const m = text.match(RE_TOGGLE_HEAD);
  if (!m) return null;
  return {
    prefix: m[1],
    collapsed: m[2] === "-",
    title: text.slice(m[0].length),
    tokenFrom: m[1].length,
    tokenTo: m[0].length,
  };
}

/** The header line with its fold marker set. Returns null off a toggle. */
export function setToggleCollapsed(text: string, collapsed: boolean): string | null {
  const m = text.match(RE_TOGGLE_HEAD);
  if (!m) return null;
  const head = `${m[1]}[!${TOGGLE_TYPE}]${collapsed ? "-" : "+"} `;
  return head + text.slice(m[0].length);
}

/** Plain title text for a line being turned into a toggle: one block's
 * worth of leading Markdown (quote markers, list marker, heading hashes,
 * task box) is scaffolding for the OLD block, not part of the title. */
export function toggleTitleFromLine(text: string): string {
  return text
    .replace(/^\s*(?:>[ \t]*)*/, "")
    .replace(/^(?:#{1,6}[ \t]+|(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[.\][ \t]+)?)/, "")
    .trim();
}

/** Fresh toggle scaffold for the slash menu ("‸" marks the caret). New
 * toggles open, so the empty body line the caret can fall into is
 * visible — a collapsed empty toggle looks broken. */
export function buildToggleTemplate(): string {
  return `> [!${TOGGLE_TYPE}]+ ‸\n> `;
}

/** `lines` folded into a toggle: the first line becomes the title, the
 * rest becomes the content (an empty body line when there is no rest). */
export function buildToggleWrap(lines: string[]): string[] {
  const body = dedentLines(lines.slice(1)).filter(
    (line, i, all) => !(RE_BLANK.test(line) && i === all.length - 1)
  );
  return [
    `> [!${TOGGLE_TYPE}]+ ${toggleTitleFromLine(lines[0] ?? "")}`,
    ...(body.length
      ? body.map((line) => (RE_BLANK.test(line) ? ">" : "> " + line))
      : ["> "]),
  ];
}

/**
 * Block types a whole block is WRAPPED into, as opposed to the line-prefix
 * retyping `TURN_INTO` does: a Callout, a toggle, and a code fence each add
 * a container around the text rather than restating its first line.
 */
export type BlockWrapKind = "callout" | "toggle" | "code";

/**
 * `lines` folded into a container of `kind`.
 *
 * The first row is always the one the caret lands on afterwards — the
 * Callout's title, the toggle's title, the fence's language — so every
 * wrap ends in the same place: ready to name what was just wrapped.
 *
 * A block that is ALREADY quoted keeps its own markers and only gains the
 * header row above it; prefixing it again would bury the text one level
 * deeper than the box that is being built around it.
 */
export function buildBlockWrap(lines: string[], kind: BlockWrapKind): string[] {
  if (kind === "toggle") return buildToggleWrap(lines);
  if (kind === "code") return ["```", ...dedentLines(lines), "```"];
  const quoted = RE_QUOTE.test(lines[0] ?? "") && !parseCalloutHeader(lines[0] ?? "");
  const body = quoted
    ? lines
    : dedentLines(lines).map((line) => (RE_BLANK.test(line) ? ">" : "> " + line));
  return ["> [!note] ", ...body];
}

/**
 * Whether `block` can be wrapped in a container of `kind`.
 *
 * Deliberately narrower than `canTurnBlockInto`: a wrap rewrites the rows
 * around the text, so it only ever runs on a whole top-level block. A row
 * inside a Callout carries the CONTAINER's markers — re-wrapping it would
 * spell a level that is not the one it sits at — and the column scaffolding
 * owns its own transforms.
 */
export function canWrapBlockInto(
  doc: Text,
  block: BlockRange,
  fences: FenceRange[],
  kind: BlockWrapKind
): boolean {
  if (block.quotePrefix) return false;
  if (fenceAt(fences, block.startLine)) return false;
  const first = doc.line(block.startLine).text;
  if (RE_BLANK.test(first)) return false;
  const header = parseCalloutHeader(first);
  if (header && isScaffoldCallout(header.type)) return false;
  // A Callout already has a type menu, and a toggle already folds; wrapping
  // one in another of its own kind is never what the menu item means.
  if (kind === "callout" && header) return false;
  if (kind === "toggle" && header?.type === TOGGLE_TYPE) return false;
  if (kind === "code") {
    for (let n = block.startLine; n <= block.endLine; n++) {
      // The wrapper's own ``` would close on the block's fence and hand the
      // rest of the note to the code block.
      if (RE_FENCE.test(doc.line(n).text)) return false;
    }
  }
  return true;
}

/**
 * The single edit behind "Turn into Callout / toggle / code block". Shared
 * by the handle menu and the wrap commands, and false — dispatching
 * nothing — wherever `canWrapBlockInto` says no.
 */
export function wrapBlockInto(
  view: EditorView,
  block: BlockRange,
  kind: BlockWrapKind,
  fences: FenceRange[]
): boolean {
  const doc = view.state.doc;
  if (!canWrapBlockInto(doc, block, fences, kind)) return false;
  const from = doc.line(block.startLine).from;
  const to = doc.line(block.endLine).to;
  const wrapped = buildBlockWrap(doc.sliceString(from, to).split("\n"), kind);
  const above = block.startLine > 1 ? doc.line(block.startLine - 1).text : "";
  const below = block.endLine < doc.lines ? doc.line(block.endLine + 1).text : "";
  let text = wrapped.join("\n");
  let caret = from + wrapped[0].length;
  if (needsProtectedSeam(above, wrapped[0])) {
    text = "\n" + text;
    caret += 1;
  }
  if (needsProtectedSeam(wrapped[wrapped.length - 1], below)) text += "\n";
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: caret },
    scrollIntoView: true,
    userEvent: `input.${kind}`,
  });
  return true;
}

/* ------------------------------------------------------------------ */
/* Input rules (Markdown shorthand that expands as it is typed)        */
/*                                                                     */
/* Obsidian already grows a quote out of ">" and a list out of "-".    */
/* The blocks it does NOT is exactly the set that costs the most to    */
/* spell: "> [!note] " is twelve characters before the first word.     */
/* ">!" plus a space writes it, ">!tip" picks the type, and a trailing */
/* "+"/"-" sets the fold — all still legible if the rule never fires.  */
/* ------------------------------------------------------------------ */

/** Shorthand → Callout type, on top of the canonical types and their
 *  Obsidian aliases. Chinese spellings are here because the plugin's own
 *  UI is bilingual; an IME commit lands the same characters. */
const CALLOUT_SHORTHAND: Record<string, string> = {
  toggle: TOGGLE_TYPE,
  fold: TOGGLE_TYPE,
  折叠: TOGGLE_TYPE,
  笔记: "note",
  摘要: "abstract",
  信息: "info",
  待办: "todo",
  提示: "tip",
  成功: "success",
  问题: "question",
  注意: "warning",
  警告: "warning",
  失败: "failure",
  危险: "danger",
  缺陷: "bug",
  例子: "example",
  引用: "quote",
};

/** ">!type±" at the head of a line, the "!" preceded by at least one ">". */
const RE_RULE_CALLOUT = /^(\s*)((?:>[ \t]*)+)!(\p{L}*)([+-]?)$/u;
/** "[]" / "[x]" at the head of a line, a bullet optionally already there. */
const RE_RULE_TODO = /^(\s*(?:>[ \t]*)*(?:[-*+][ \t]+)?)\[([ xX]?)\]$/;

/**
 * What the line becomes when the space key completes a shorthand, or null
 * when it spells nothing — `from` is an offset within the line, so the
 * caller replaces `[line.from + from, caret]` with `insert`.
 *
 * An unknown type after ">!" deliberately expands to nothing: ">!foo " has
 * to stay literal, or a typo silently becomes a Callout named after it.
 */
export function inputRuleExpansion(
  before: string,
  options: { toggles: boolean }
): { from: number; insert: string } | null {
  const callout = before.match(RE_RULE_CALLOUT);
  if (callout) {
    const [, indent, markers, word, fold] = callout;
    const key = word.toLowerCase();
    const type = !key
      ? "note"
      : CALLOUT_SHORTHAND[key] ??
        CALLOUT_ALIASES[key] ??
        (CALLOUT_TYPES.some((entry) => entry.type === key) ? key : null);
    if (!type) return null;
    if (type === TOGGLE_TYPE && !options.toggles) return null;
    // A toggle written without a marker is read as open, but the marker is
    // what carries the state in the file — always write one.
    const marker = fold || (type === TOGGLE_TYPE ? "+" : "");
    const depth = (markers.match(/>/g) ?? []).length;
    return {
      from: 0,
      insert: `${indent}${"> ".repeat(depth)}[!${type}]${marker} `,
    };
  }
  const todo = before.match(RE_RULE_TODO);
  if (todo) {
    const [, prefix, state] = todo;
    // The bullet may already be there ("- []"), and inside a quote it sits
    // after the markers, where RE_LIST cannot see it.
    const bullet = /(?:[-*+][ \t]+)$/.test(prefix) ? "" : "- ";
    return { from: 0, insert: `${prefix}${bullet}[${state.trim() ? "x" : " "}] ` };
  }
  return null;
}

/**
 * The space key, filtered. A shorthand only expands when a single caret
 * types a single space at the END of its own line: mid-line the same
 * characters are prose, and a multi-caret or programmatic edit is not
 * someone typing.
 */
export function makeInputRuleFilter(plugin: NotionFlowPlugin) {
  return EditorState.transactionFilter.of((tr) => {
    if (!plugin.settings.inputRules || !tr.docChanged) return tr;
    if (!tr.isUserEvent("input.type")) return tr;
    let inserts = 0;
    let at = -1;
    let typedSpace = true;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, ins) => {
      inserts++;
      if (fromA !== toA || ins.toString() !== " ") typedSpace = false;
      at = fromA;
    });
    if (!typedSpace || inserts !== 1) return tr;
    const selection = tr.startState.selection;
    if (selection.ranges.length !== 1) return tr;
    if (!selection.main.empty || selection.main.head !== at) return tr;
    const doc = tr.startState.doc;
    const line = doc.lineAt(at);
    if (at !== line.to) return tr;
    // Inside a fence every one of these shapes is code, not shorthand.
    if (fenceAt(cachedFences(doc), line.number)) return tr;
    const rule = inputRuleExpansion(line.text, {
      toggles: plugin.settings.toggleBlocks,
    });
    if (!rule) return tr;
    return [
      {
        changes: { from: line.from + rule.from, to: line.to, insert: rule.insert },
        selection: { anchor: line.from + rule.from + rule.insert.length },
        scrollIntoView: true,
        userEvent: "input.inputrule",
      },
    ];
  });
}

/* ------------------------------------------------------------------ */
/* Columns (Notion-style side-by-side layout)                          */
/*                                                                     */
/* A column row is a "[!nf-cols]" Callout whose direct children are    */
/* "[!nf-col]" Callouts — plain nested quotes to any other Markdown    */
/* reader, flex columns here. "[!nf-col|30]" pins a width in percent.  */
/* ------------------------------------------------------------------ */

export const COLS_TYPE = "nf-cols";
export const COL_TYPE = "nf-col";

/** Structural quote depth of the nf-col containing `lineNo`, or null.
 * Content may add deeper user-authored quotes, but it must never be
 * dedented past the direct [!nf-col] header's depth. */
export function columnContentQuoteDepth(doc: Text, lineNo: number): number | null {
  if (lineNo < 1 || lineNo > doc.lines) return null;
  const currentDepth = quoteDepth(doc.line(lineNo).text);
  if (currentDepth < 2) return null;

  for (let i = lineNo; i >= 1; i--) {
    const text = doc.line(i).text;
    const depth = quoteDepth(text);
    const header = parseCalloutHeader(text);
    if (header?.type !== COL_TYPE || depth > currentDepth) {
      if (i < lineNo && depth === 0) return null;
      continue;
    }

    for (let outer = i - 1; outer >= 1; outer--) {
      const outerText = doc.line(outer).text;
      const outerDepth = quoteDepth(outerText);
      const outerHeader = parseCalloutHeader(outerText);
      if (outerHeader?.type === COLS_TYPE && outerDepth === depth - 1) {
        return depth;
      }
      if (!RE_BLANK.test(outerText) && outerDepth < depth - 1) break;
    }
    return null;
  }
  return null;
}

/** Sanitized column width from "[!nf-col|…]" metadata: an integer
 * percentage clamped to sane bounds, or null for anything else. */
export function columnWidthPercent(meta: string | null): number | null {
  if (!meta || !/^\d{1,2}$/.test(meta.trim())) return null;
  const n = Number(meta.trim());
  return n >= 10 && n <= 90 ? n : null;
}

export interface ColumnSourceSegment {
  /** Zero-based line index of the direct [!nf-col] header. */
  headerIndex: number;
  /** Exclusive zero-based end, excluding the outer marker seam. */
  endIndex: number;
  /** Header plus every source row owned by this column. */
  lines: string[];
  width: number | null;
}

export interface ColumnsSourceLayout {
  lines: string[];
  outerDepth: number;
  /** Marker-only form of the wrapper prefix ("> >", no trailing space). */
  outerMarker: string;
  /** Wrapper header and any source before the first direct column. */
  head: string[];
  columns: ColumnSourceSegment[];
  /** Wrapper-depth source between adjacent direct columns. */
  seams: string[][];
  /** Wrapper-depth source after the final direct column. */
  tail: string[];
}

export interface ColumnInnerLineOrigin {
  /** Line index inside the full nf-cols block source. */
  blockLineIndex: number;
  /** Character offset where editable content begins on that source line. */
  sourceCh: number;
  /** Character offsets inside the joined nf-cols block source. */
  sourceFrom: number;
  sourceTo: number;
}

export interface ColumnInnerSource {
  columnIndex: number;
  lines: string[];
  origins: ColumnInnerLineOrigin[];
  doc: Text;
}

/** Remove exactly `levels` leading quote markers and their optional one
 * following whitespace character. Null means the line is shallower. */
export function stripQuoteLevels(text: string, levels: number): string | null {
  let index = text.match(RE_LEADING_WS)?.[0].length ?? 0;
  for (let depth = 0; depth < levels; depth++) {
    if (text[index] !== ">") return null;
    index++;
    if (text[index] === " " || text[index] === "\t") index++;
  }
  return text.slice(index);
}

/** Remove quote markers `firstLevel…firstLevel + count - 1` (1-based)
 * while preserving ancestor markers before them and content markers after
 * them. Used when unwrapping nested column rows. */
export function removeQuoteLevels(
  text: string,
  firstLevel: number,
  count: number
): string | null {
  if (firstLevel < 1 || count < 1) return text;
  const leading = text.match(RE_LEADING_WS)?.[0].length ?? 0;
  const spans: Array<{ from: number; to: number }> = [];
  let index = leading;
  while (text[index] === ">") {
    const from = spans.length === 0 ? leading : index;
    index++;
    if (text[index] === " " || text[index] === "\t") index++;
    spans.push({ from, to: index });
  }
  const first = spans[firstLevel - 1];
  const last = spans[firstLevel + count - 2];
  if (!first || !last) return null;
  return text.slice(0, first.from) + text.slice(last.to);
}

/** Parse the direct columns of one nf-cols source block. Nested nf-cols
 * rows remain ordinary content of their parent segment. */
export function parseColumnsSource(lines: string[]): ColumnsSourceLayout | null {
  const first = lines[0] ?? "";
  if (parseCalloutHeader(first)?.type !== COLS_TYPE) return null;
  const outerDepth = quoteDepth(first);
  const directDepth = outerDepth + 1;
  const headers: number[] = [];
  let openFenceChar = "";
  let openFenceLength = 0;
  for (let index = 1; index < lines.length; index++) {
    const local = stripQuoteLevels(lines[index], directDepth);
    const plainFence = local?.match(RE_FENCE_OPEN) ?? null;
    if (openFenceChar) {
      if (
        plainFence &&
        plainFence[2][0] === openFenceChar &&
        plainFence[2].length >= openFenceLength &&
        /^[ \t]*$/.test(plainFence[3])
      ) {
        openFenceChar = "";
        openFenceLength = 0;
      }
      continue;
    }
    if (
      quoteDepth(lines[index]) === directDepth &&
      /^\[!nf-col(?:\|[^\]\r\n]*)?\](?:[+-])?(?:\s|$)/i.test(local ?? "") &&
      parseCalloutHeader(lines[index])?.type === COL_TYPE
    ) {
      headers.push(index);
      continue;
    }
    if (local != null) {
      const itemFence = plainFence ? null : local.match(RE_FENCE_OPEN_ITEM);
      const marker = plainFence?.[2] ?? itemFence?.[3];
      const info = plainFence?.[3] ?? itemFence?.[4];
      if (marker && info != null && !(marker[0] === "`" && info.includes("`"))) {
        openFenceChar = marker[0];
        openFenceLength = marker.length;
      }
    }
  }
  if (headers.length === 0) return null;
  const outerMarker = (quoteMarkerPrefix(first) ?? ">").trimEnd();
  const seams: string[][] = [];
  let tail: string[] = [];
  const columns = headers.map((headerIndex, columnIndex) => {
    const rawEnd = headers[columnIndex + 1] ?? lines.length;
    let endIndex = rawEnd;
    // The canonical seam between columns belongs to the wrapper, not to
    // either neighboring segment. Deeper marker-only rows are real blank
    // content and must stay with the column.
    while (
      endIndex > headerIndex + 1 &&
      quoteDepth(lines[endIndex - 1]) <= outerDepth
    ) {
      endIndex--;
    }
    const wrapperRows = lines.slice(endIndex, rawEnd);
    if (columnIndex < headers.length - 1) seams.push(wrapperRows);
    else tail = wrapperRows;
    const header = parseCalloutHeader(lines[headerIndex]);
    const meta =
      lines[headerIndex].match(/\[!nf-col(?:\|([^\]\r\n]*))?\]/i)?.[1] ?? null;
    return {
      headerIndex,
      endIndex,
      lines: lines.slice(headerIndex, endIndex),
      width: header?.type === COL_TYPE ? columnWidthPercent(meta) : null,
    };
  });
  return {
    lines,
    outerDepth,
    outerMarker,
    head: lines.slice(0, headers[0]),
    columns,
    seams,
    tail,
  };
}

/** Project one column body into ordinary Markdown by hiding every ancestor
 * and structural quote marker. Line count stays one-to-one for exact source
 * mapping; deeper user-authored quote markers remain in the inner text. */
export function columnInnerSource(
  layout: ColumnsSourceLayout,
  columnIndex: number
): ColumnInnerSource | null {
  const column = layout.columns[columnIndex];
  if (!column) return null;
  const sourceStarts: number[] = [];
  let sourceOffset = 0;
  for (const line of layout.lines) {
    sourceStarts.push(sourceOffset);
    sourceOffset += line.length + 1;
  }
  const lines: string[] = [];
  const origins: ColumnInnerLineOrigin[] = [];
  for (
    let blockLineIndex = column.headerIndex + 1;
    blockLineIndex < column.endIndex;
    blockLineIndex++
  ) {
    const source = layout.lines[blockLineIndex];
    const inner = stripQuoteLevels(source, layout.outerDepth + 1);
    const text = inner ?? source;
    const sourceCh = inner == null ? 0 : source.length - inner.length;
    lines.push(text);
    origins.push({
      blockLineIndex,
      sourceCh,
      sourceFrom: sourceStarts[blockLineIndex] + sourceCh,
      sourceTo: sourceStarts[blockLineIndex] + source.length,
    });
  }
  if (lines.length === 0) return null;
  return { columnIndex, lines, origins, doc: Text.of(lines) };
}

/** Relative source offset for an inner-document position. */
export function mapColumnInnerOffset(
  inner: ColumnInnerSource,
  pos: number
): number | null {
  if (pos < 0 || pos > inner.doc.length) return null;
  const line = inner.doc.lineAt(pos);
  const origin = inner.origins[line.number - 1];
  if (!origin) return null;
  return origin.sourceFrom + Math.min(pos - line.from, line.length);
}

/** Replace one projected column body and reapply its canonical structural
 * prefix to every line. This is the transaction primitive used by a visual
 * column editor; the outer Markdown remains the only source of truth. */
export function replaceColumnBody(
  lines: string[],
  columnIndex: number,
  innerLines: readonly string[]
): string[] | null {
  const layout = parseColumnsSource(lines);
  const column = layout?.columns[columnIndex];
  if (!layout || !column) return null;
  const childMarker = `${layout.outerMarker} >`;
  const body = (innerLines.length > 0 ? innerLines : [""]).map(
    (line) => `${childMarker} ${line}`
  );
  const segments = layout.columns.map((segment, index) =>
    index === columnIndex ? [segment.lines[0], ...body] : segment.lines
  );
  return serializeColumnsSource(layout, segments);
}

interface ColumnProjectionAtPosition {
  blockFrom: number;
  lines: string[];
  layout: ColumnsSourceLayout;
  inner: ColumnInnerSource;
  innerPos: number;
  innerLineIndex: number;
}

/** Column projection containing an outer-document position. This resolves
 * nested rows directly by quote depth rather than asking getBlockRange(),
 * whose quote semantics intentionally return the complete outer Callout. */
function columnProjectionAtPosition(
  doc: Text,
  pos: number
): ColumnProjectionAtPosition | null {
  const line = doc.lineAt(pos);
  const directDepth = columnContentQuoteDepth(doc, line.number);
  if (directDepth == null) return null;
  let outerLine = -1;
  for (let lineNo = line.number; lineNo >= 1; lineNo--) {
    const source = doc.line(lineNo).text;
    const header = parseCalloutHeader(source);
    if (header?.type === COLS_TYPE && quoteDepth(source) === directDepth - 1) {
      outerLine = lineNo;
      break;
    }
    if (lineNo < line.number && quoteDepth(source) < directDepth - 1) return null;
  }
  if (outerLine < 1) return null;

  let endLine = outerLine;
  while (endLine < doc.lines) {
    const next = doc.line(endLine + 1).text;
    if (quoteDepth(next) < directDepth - 1) break;
    endLine++;
  }
  const blockFrom = doc.line(outerLine).from;
  const blockTo = doc.line(endLine).to;
  const lines = doc.sliceString(blockFrom, blockTo).split("\n");
  const layout = parseColumnsSource(lines);
  if (!layout) return null;
  const blockLineIndex = line.number - outerLine;
  const columnIndex = layout.columns.findIndex(
    (column) =>
      blockLineIndex > column.headerIndex && blockLineIndex < column.endIndex
  );
  if (columnIndex < 0) return null;
  const inner = columnInnerSource(layout, columnIndex);
  if (!inner) return null;
  const innerLineIndex = inner.origins.findIndex(
    (origin) => origin.blockLineIndex === blockLineIndex
  );
  if (innerLineIndex < 0) return null;
  const origin = inner.origins[innerLineIndex];
  const ch = Math.max(0, Math.min(line.length - origin.sourceCh, pos - line.from - origin.sourceCh));
  const innerLine = inner.doc.line(innerLineIndex + 1);
  return {
    blockFrom,
    lines,
    layout,
    inner,
    innerPos: innerLine.from + ch,
    innerLineIndex,
  };
}

function mapColumnInnerPlan(
  projection: ColumnProjectionAtPosition,
  plan: QuoteKeyPlan | null
): QuoteKeyPlan | null {
  if (!plan) return null;
  const relativeFrom = mapColumnInnerOffset(projection.inner, plan.from);
  const relativeTo = mapColumnInnerOffset(projection.inner, plan.to);
  if (relativeFrom == null || relativeTo == null) return null;
  const origin = projection.inner.origins[projection.innerLineIndex];
  const sourceLine = projection.lines[origin.blockLineIndex];
  const prefix = sourceLine.slice(0, origin.sourceCh);
  const serialize = (text: string) => text.replace(/\n/g, "\n" + prefix);
  const insert = serialize(plan.insert);
  const cursorInInsert = Math.max(0, Math.min(plan.insert.length, plan.cursor - plan.from));
  return {
    from: projection.blockFrom + relativeFrom,
    to: projection.blockFrom + relativeTo,
    insert,
    cursor:
      projection.blockFrom + relativeFrom + serialize(plan.insert.slice(0, cursorInInsert)).length,
  };
}

/** Column-aware code plans reuse the ordinary fence model on projected
 * Markdown, then map the single edit back through structural quote prefixes. */
export function columnFenceEnterPlan(doc: Text, pos: number): QuoteKeyPlan | null {
  const projection = columnProjectionAtPosition(doc, pos);
  if (!projection) return null;
  return mapColumnInnerPlan(
    projection,
    fenceEnterPlan(projection.inner.doc, projection.innerPos)
  );
}

export function columnFenceBackspacePlan(
  doc: Text,
  pos: number,
  unit: IndentUnit = DEFAULT_INDENT_UNIT
): QuoteKeyPlan | null {
  const projection = columnProjectionAtPosition(doc, pos);
  if (!projection) return null;
  return mapColumnInnerPlan(
    projection,
    fenceBackspacePlan(
      projection.inner.doc,
      projection.innerPos,
      cachedFences(projection.inner.doc),
      unit
    )
  );
}

/** Rebuild a parsed row with canonical marker-only seams. Segment source
 * itself is preserved byte-for-byte, so moving a column never rewrites its
 * Markdown content. */
function serializeColumnsSource(
  layout: ColumnsSourceLayout,
  segments: readonly string[][]
): string[] {
  const out = [...layout.head];
  for (let index = 0; index < segments.length; index++) {
    if (index > 0) {
      const seam = layout.seams[index - 1];
      out.push(...(seam?.length ? seam : [layout.outerMarker]));
    }
    out.push(...segments[index]);
  }
  out.push(...layout.tail);
  return out;
}

function emptyColumnSource(layout: ColumnsSourceLayout): string[] {
  const childMarker = `${layout.outerMarker} >`;
  return [`${childMarker} [!${COL_TYPE}]`, `${childMarker} `];
}

/** Insert an empty column before `index` (0…length). */
export function insertColumnAt(lines: string[], index: number): string[] | null {
  const layout = parseColumnsSource(lines);
  if (!layout) return null;
  const segments = layout.columns.map((column) => column.lines);
  const at = Math.max(0, Math.min(index, segments.length));
  segments.splice(at, 0, emptyColumnSource(layout));
  return serializeColumnsSource(layout, segments);
}

/** Move one direct column by one or more slots. */
export function moveColumnTo(
  lines: string[],
  fromIndex: number,
  toIndex: number
): string[] | null {
  const layout = parseColumnsSource(lines);
  if (!layout || fromIndex < 0 || fromIndex >= layout.columns.length) return null;
  const segments = layout.columns.map((column) => column.lines);
  const [moved] = segments.splice(fromIndex, 1);
  const at = Math.max(0, Math.min(toIndex, segments.length));
  segments.splice(at, 0, moved);
  return serializeColumnsSource(layout, segments);
}

/** Delete one direct column. With one survivor the structural wrappers are
 * removed as well, leaving that content as normal stacked Markdown. */
export function removeColumnAt(lines: string[], index: number): string[] | null {
  const layout = parseColumnsSource(lines);
  if (!layout || layout.columns.length < 2 || index < 0 || index >= layout.columns.length) {
    return null;
  }
  const segments = layout.columns.map((column) => column.lines);
  segments.splice(index, 1);
  const rebuilt = serializeColumnsSource(layout, segments);
  return segments.length === 1 ? unwrapColumnsLines(rebuilt) : rebuilt;
}

/** Remove the first line's leading whitespace from every line, so an
 * indented block (a dragged list child) becomes top-level before it is
 * wrapped into a column. Shallower lines lose only their own prefix. */
export function dedentLines(lines: string[]): string[] {
  const lead = indentWidth(lines[0]?.match(RE_LEADING_WS)?.[0] ?? "");
  if (lead === 0) return lines;
  return lines.map((line) => stripIndentColumns(line, lead));
}

/** The lines of one "[!nf-col]" child holding `lines` as its content. */
function wrapAsColumn(lines: string[]): string[] {
  return [
    `> > [!${COL_TYPE}]`,
    ...lines.map((line) => (RE_BLANK.test(line) ? "> >" : "> > " + line)),
  ];
}

/** A whole columns block: `first` beside `second`. */
export function buildColumnsWrap(first: string[], second: string[]): string[] {
  return [
    `> [!${COLS_TYPE}]`,
    ...wrapAsColumn(dedentLines(first)),
    ">",
    ...wrapAsColumn(dedentLines(second)),
  ];
}

/** Lines appended to an existing "[!nf-cols]" block for one new column. */
export function appendColumnLines(lines: string[]): string[] {
  return [">", ...wrapAsColumn(dedentLines(lines))];
}

/** Fresh n-column scaffold for the slash menu ("‸" marks the caret). */
export function buildColumnsTemplate(n: number): string {
  const col = (caret: boolean) => `> > [!${COL_TYPE}]\n> > ${caret ? "‸" : ""}`;
  const cols = Array.from({ length: Math.max(2, n) }, (_, i) => col(i === 0));
  return `> [!${COLS_TYPE}]\n` + cols.join("\n>\n");
}

/** The actions every columns row offers: grow it, retune widths, undo it.
 * Shared by the block-handle menu and the row's hover ⋯ button. */
function addColumnsMenuItems(menu: Menu, view: EditorView, block: BlockRange) {
  const doc = view.state.doc;
  const blockLines = () => {
    const from = doc.line(block.startLine).from;
    const to = doc.line(block.endLine).to;
    return { from, to, lines: doc.sliceString(from, to).split("\n") };
  };
  const replaceBlock = (next: string[], userEvent: string) => {
    const { from, to } = blockLines();
    view.dispatch({
      changes: { from, to, insert: next.join("\n") },
      userEvent,
    });
  };
  menu.addItem((item) =>
    item
      .setTitle(t("Add column"))
      .setIcon("columns-3")
      .onClick(() => {
        const end = doc.line(block.endLine).to;
        const insert = "\n>\n> > [!" + COL_TYPE + "]\n> > ";
        view.dispatch({
          changes: { from: end, to: end, insert },
          selection: { anchor: end + insert.length },
          scrollIntoView: true,
          userEvent: "input.columns",
        });
      })
  );
  // Width presets for the common two-column case; more columns get the
  // equal-split reset. Custom values stay a "[!nf-col|N]" edit.
  menu.addItem((item) => {
    item.setTitle(t("Column widths")).setIcon("ruler");
    const withSub = item as unknown as { setSubmenu?: () => Menu };
    if (typeof withSub.setSubmenu !== "function") return;
    const sub = withSub.setSubmenu();
    const cols = countColumns(blockLines().lines);
    const presets: [string, (number | null)[]][] =
      cols === 2
        ? [
            [t("Equal widths"), [null, null]],
            [t("Narrow left (30%)"), [30, null]],
            [t("Narrow right (30%)"), [null, 30]],
          ]
        : [[t("Equal widths"), Array<number | null>(cols).fill(null)]];
    for (const [label, widths] of presets) {
      sub.addItem((entry) =>
        entry.setTitle(label).onClick(() => {
          dispatchColumnWidths(view, block, widths, "input.columns");
        })
      );
    }
  });
  menu.addItem((item) =>
    item
      .setTitle(t("Unwrap columns"))
      .setIcon("rows-3")
      .onClick(() => {
        const { lines } = blockLines();
        const flat = unwrapColumnsLines(lines);
        if (!flat) return;
        // The flattened content is ordinary blocks now — keep blank
        // seams so neighbors don't absorb the first/last of them.
        const above = block.startLine > 1 ? doc.line(block.startLine - 1).text : "";
        const below = block.endLine < doc.lines ? doc.line(block.endLine + 1).text : "";
        if (needsProtectedSeam(above, flat[0])) flat.unshift("");
        if (needsProtectedSeam(flat[flat.length - 1], below)) flat.push("");
        replaceBlock(flat, "input.columns");
      })
  );
}

/** Open the columns menu for the row whose injected ⋯ button was clicked.
 * The button lives inside rendered widget DOM, so the owning editor is
 * recovered from the DOM itself; outside an editor (Reading view, hover
 * previews) this quietly does nothing. */
function openColumnsMenuFromDOM(btn: HTMLElement, evt: MouseEvent) {
  const editorEl = btn.closest(".cm-editor");
  if (!(editorEl instanceof HTMLElement)) return;
  const view = EditorView.findFromDOM(editorEl);
  if (!view) return;
  try {
    const doc = view.state.doc;
    const lineNo = doc.lineAt(view.posAtDOM(btn)).number;
    const block = getBlockRange(doc, lineNo, cachedFences(doc));
    if (!block) return;
    if (parseCalloutHeader(doc.line(block.startLine).text)?.type !== COLS_TYPE) {
      return;
    }
    const menu = new Menu().setUseNativeMenu(false);
    addColumnsMenuItems(menu, view, block);
    menu.showAtMouseEvent(evt);
  } catch {
    // The widget was detached between click and lookup — nothing to do.
  }
}

/** Context menu for one visual column. Structural edits reuse the parsed
 * source model and replace the complete row in one outer-editor transaction. */
function openColumnMenuFromDOM(
  btn: HTMLElement,
  evt: MouseEvent,
  plugin: NotionFlowPlugin
) {
  const ctx = renderedColumnsContext(btn);
  const index = Number(btn.dataset.nfColumnIndex);
  if (!ctx || !Number.isInteger(index) || index < 0 || index >= ctx.columns.length) {
    return;
  }
  const sourceLines = ctx.text.split("\n");
  const replace = (next: string[] | null, userEvent: string) => {
    if (!next) return;
    const insert = next.join("\n");
    if (insert === ctx.text) return;
    ctx.view.dispatch({
      changes: { from: ctx.from, to: ctx.to, insert },
      userEvent,
    });
  };
  const menu = new Menu().setUseNativeMenu(false);
  menu.addItem((item) =>
    item
      .setTitle(t("Add column left"))
      .setIcon("panel-left-open")
      .onClick(() => replace(insertColumnAt(sourceLines, index), "input.columns"))
  );
  menu.addItem((item) =>
    item
      .setTitle(t("Add column right"))
      .setIcon("panel-right-open")
      .onClick(() => replace(insertColumnAt(sourceLines, index + 1), "input.columns"))
  );
  menu.addSeparator();
  menu.addItem((item) => {
    item
      .setTitle(t("Move column left"))
      .setIcon("arrow-left")
      .setDisabled(index === 0);
    if (index > 0) {
      item.onClick(() =>
        replace(moveColumnTo(sourceLines, index, index - 1), "move.columns")
      );
    }
  });
  menu.addItem((item) => {
    item
      .setTitle(t("Move column right"))
      .setIcon("arrow-right")
      .setDisabled(index === ctx.columns.length - 1);
    if (index < ctx.columns.length - 1) {
      item.onClick(() =>
        replace(moveColumnTo(sourceLines, index, index + 1), "move.columns")
      );
    }
  });
  menu.addSeparator();
  menu.addItem((item) =>
    item
      .setTitle(t("Delete this column"))
      .setIcon("trash-2")
      .setWarning(true)
      .onClick(() => {
        const layout = parseColumnsSource(sourceLines);
        const segment = layout?.columns[index];
        const hasContent = !!segment?.lines
          .slice(1)
          .some((line) => /[^>\s]/.test(line));
        const remove = () =>
          replace(removeColumnAt(sourceLines, index), "delete.columns");
        if (!hasContent) {
          remove();
          return;
        }
        new ConfirmModal(
          plugin.app,
          t("Delete this column and all of its content?"),
          t("Delete this column"),
          remove
        ).open();
      })
  );
  menu.showAtMouseEvent(evt);
}

/** Quote-marker depth of a line ("> > x" → 2). */
function quoteDepth(text: string): number {
  return (quoteMarkerPrefix(text) ?? "").split(">").length - 1;
}

/**
 * How a row's ">" levels divide up, given the Callouts it sits in.
 *
 * A count alone cannot say where the extra levels are: `> > text` is a plain
 * quote INSIDE a Callout when the Callout's header reads `> [!note]`, and a
 * Callout inside a plain quote when it reads `> > [!note]`. The two want
 * opposite treatment — an outer level indents the Callout box, an inner one
 * has to be indented BY it, with a quote bar of its own — so the header's own
 * depth is what settles it.
 */
export function quoteLevelSplit(
  rawDepth: number,
  calloutDepth: number,
  outermostHeaderDepth: number
): { outer: number; callouts: number; inner: number } {
  const outer = Math.max(0, outermostHeaderDepth - 1);
  const callouts = Math.max(0, calloutDepth);
  return {
    outer,
    callouts,
    inner: Math.max(0, rawDepth - outer - callouts),
  };
}

/** Direct (depth-2) "[!nf-col]" header line count of a columns block. */
export function countColumns(lines: string[]): number {
  return parseColumnsSource(lines)?.columns.length ?? 0;
}

/**
 * A columns block flattened back into ordinary stacked blocks: each
 * column's content in source order, blank lines between columns. Content
 * nested deeper than the two structural marker levels keeps its own
 * markers. Null when the lines are not an nf-cols block or hold nothing.
 */
export function unwrapColumnsLines(lines: string[]): string[] | null {
  const layout = parseColumnsSource(lines);
  if (!layout) return null;
  const out: string[] = [];
  for (let columnIndex = 0; columnIndex < layout.columns.length; columnIndex++) {
    if (columnIndex > 0 && out.length > 0 && out[out.length - 1] !== "") {
      out.push("");
    }
    for (const line of layout.columns[columnIndex].lines.slice(1)) {
      // Shed exactly the two structural levels: the nf-cols wrapper and
      // its nf-col child. Any deeper quote markers belong to real content.
      const stripped =
        removeQuoteLevels(line, layout.outerDepth, 2) ??
        removeQuoteLevels(line, layout.outerDepth, 1) ??
        line;
      if (!stripped.trim() && !RE_QUOTE.test(stripped)) {
        if (out.length > 0 && out[out.length - 1] !== "") out.push("");
        continue;
      }
      out.push(stripped);
    }
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.length > 0 ? out : null;
}

/** Rewrite the "[!nf-col|…]" width metadata of a block's direct columns:
 * widths[i] is a percentage or null (flexible). Nested column rows and
 * columns beyond the array keep whatever they had. */
export function setColumnWidths(
  lines: string[],
  widths: (number | null)[]
): string[] {
  const layout = parseColumnsSource(lines);
  if (!layout) return lines;
  const byLine = new Map(
    layout.columns.map((column, index) => [column.headerIndex, index] as const)
  );
  return lines.map((line, lineIndex) => {
    const col = byLine.get(lineIndex);
    if (col == null || col >= widths.length) return line;
    return columnHeaderWithWidth(line, widths[col]);
  });
}

function columnHeaderWithWidth(line: string, width: number | null): string {
  return line.replace(
    /\[!nf-col(?:\|[^\]\r\n]*)?\]/i,
    width == null ? `[!${COL_TYPE}]` : `[!${COL_TYPE}|${width}]`
  );
}

/** Width-only edits touch only direct nf-col header tokens. Keeping the
 * rest of the row outside the change set preserves rendered widget identity
 * and selection much better than replacing the complete callout block. */
function dispatchColumnWidths(
  view: EditorView,
  block: BlockRange,
  widths: (number | null)[],
  userEvent = "input.columns"
): boolean {
  const doc = view.state.doc;
  const from = doc.line(block.startLine).from;
  const to = doc.line(block.endLine).to;
  const lines = doc.sliceString(from, to).split("\n");
  const layout = parseColumnsSource(lines);
  if (!layout) return false;
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const changes = layout.columns.flatMap((column, index) => {
    if (index >= widths.length) return [];
    const oldHeader = lines[column.headerIndex];
    const nextHeader = columnHeaderWithWidth(oldHeader, widths[index]);
    if (nextHeader === oldHeader) return [];
    const headerFrom = from + starts[column.headerIndex];
    return [{ from: headerFrom, to: headerFrom + oldHeader.length, insert: nextHeader }];
  });
  if (changes.length === 0) return true;
  view.dispatch({ changes, userEvent });
  return true;
}

/** Convert measured column widths to stable integer percentages. Values
 * always total 100; for layouts of up to ten columns each track stays in
 * the same 10–90 range accepted by columnWidthPercent(). */
export function columnPercentsFromWidths(widths: readonly number[]): number[] {
  const n = widths.length;
  if (n === 0) return [];
  let weights: number[] = widths.map((value) =>
    Number.isFinite(value) && value > 0 ? value : 0
  );
  if (weights.every((value) => value === 0)) {
    weights = Array<number>(n).fill(1);
  }

  const min = n <= 10 ? 10 : 0;
  const max = n === 1 ? 100 : 90;
  const values = Array<number>(n).fill(0);
  const free = new Set(Array.from({ length: n }, (_, index) => index));
  let remaining = 100;

  while (free.size > 0) {
    const totalWeight = Array.from(free).reduce(
      (sum, index) => sum + weights[index],
      0
    );
    const unit = totalWeight > 0 ? remaining / totalWeight : remaining / free.size;
    const low: number[] = [];
    const high: number[] = [];
    for (const index of free) {
      const candidate = totalWeight > 0 ? weights[index] * unit : unit;
      if (candidate < min) low.push(index);
      else if (candidate > max) high.push(index);
    }
    if (low.length === 0 && high.length === 0) {
      for (const index of free) {
        values[index] = totalWeight > 0 ? weights[index] * unit : unit;
      }
      break;
    }
    for (const index of low) {
      values[index] = min;
      remaining -= min;
      free.delete(index);
    }
    for (const index of high) {
      values[index] = max;
      remaining -= max;
      free.delete(index);
    }
  }

  const rounded = values.map((value) => Math.floor(value));
  let left = 100 - rounded.reduce((sum, value) => sum + value, 0);
  const order = values
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    if (rounded[index] >= max) continue;
    rounded[index]++;
    left--;
  }
  return rounded;
}

interface RenderedColumnsContext {
  view: EditorView;
  block: BlockRange;
  from: number;
  to: number;
  text: string;
  row: HTMLElement;
  content: HTMLElement;
  columns: HTMLElement[];
}

/** Resolve an injected column control back to its one source block. */
function renderedColumnsContext(
  el: HTMLElement,
  knownView?: EditorView
): RenderedColumnsContext | null {
  const row = el.closest<HTMLElement>(`.callout[data-callout="${COLS_TYPE}"]`);
  const editorEl = row?.closest<HTMLElement>(".cm-editor");
  if (!row || !editorEl) return null;
  // Resolve from the outer rendered Callout widget, not from a descendant
  // nf-col element. posAtDOM(childColumn) may map to that child's header,
  // which makes getBlockRange return nf-col instead of the nf-cols row and
  // lets Obsidian's native whole-widget selection win on click.
  const widget = row.closest<HTMLElement>(".cm-embed-block.cm-callout");
  if (!widget) return null;
  const view = knownView ?? EditorView.findFromDOM(editorEl);
  if (!view) return null;
  const content = Array.from(row.children).find(
    (child) => child.classList.contains("callout-content")
  ) as HTMLElement | undefined;
  if (!content) return null;
  const columns = Array.from(content.children).filter(
    (child) => (child as HTMLElement).dataset.callout === COL_TYPE
  ) as HTMLElement[];
  if (columns.length < 2) return null;
  try {
    const doc = view.state.doc;
    const lineNo = doc.lineAt(view.posAtDOM(widget, 0)).number;
    const block = getBlockRange(doc, lineNo, cachedFences(doc));
    if (!block) return null;
    if (parseCalloutHeader(doc.line(block.startLine).text)?.type !== COLS_TYPE) {
      return null;
    }
    const from = doc.line(block.startLine).from;
    const to = doc.line(block.endLine).to;
    return {
      view,
      block,
      from,
      to,
      text: doc.sliceString(from, to),
      row,
      content,
      columns,
    };
  } catch {
    return null;
  }
}

function replaceRenderedColumnWidths(
  el: HTMLElement,
  widths: (number | null)[],
  userEvent = "input.columns"
): boolean {
  const ctx = renderedColumnsContext(el);
  if (!ctx) return false;
  return dispatchColumnWidths(ctx.view, ctx.block, widths, userEvent);
}

/** Pixel widths after moving one gutter, with a readable minimum track. */
function resizedColumnPixels(
  widths: readonly number[],
  divider: number,
  delta: number
): number[] {
  const next = [...widths];
  if (divider < 0 || divider + 1 >= next.length) return next;
  const pair = next[divider] + next[divider + 1];
  const total = next.reduce((sum, width) => sum + width, 0);
  const min = Math.min(pair / 2, Math.max(72, total * 0.1));
  const left = Math.max(min, Math.min(pair - min, next[divider] + delta));
  next[divider] = left;
  next[divider + 1] = pair - left;
  return next;
}

/** Pointer-driven gutter resize. DOM receives a live pixel preview; the
 * Markdown width metadata changes once on pointerup, so one undo restores
 * the previous layout. */
function startColumnResizeFromDOM(handle: HTMLElement, evt: PointerEvent): boolean {
  if (evt.button !== 0) return false;
  const ctx = renderedColumnsContext(handle);
  const divider = Number(handle.dataset.nfColumnDivider);
  if (!ctx || !Number.isInteger(divider) || divider < 0) return false;
  const widths = ctx.columns.map((column) => column.getBoundingClientRect().width);
  if (widths.some((width) => width <= 0)) return false;

  evt.preventDefault();
  evt.stopPropagation();
  const ownerDocument = handle.ownerDocument;
  const ownerWindow = ownerDocument.defaultView ?? window;
  const startX = evt.clientX;
  const rtl = ownerWindow.getComputedStyle(ctx.content).direction === "rtl";
  let next = [...widths];
  let frame = 0;
  let pendingX = startX;
  let finished = false;

  const paint = () => {
    frame = 0;
    const delta = (pendingX - startX) * (rtl ? -1 : 1);
    next = resizedColumnPixels(widths, divider, delta);
    for (let i = 0; i < ctx.columns.length; i++) {
      ctx.columns[i].style.flex = `0 0 ${next[i]}px`;
    }
    const percents = columnPercentsFromWidths(next);
    handle.dataset.nfColumnValue =
      `${percents[divider]}% · ${percents[divider + 1]}%`;
    handle.setAttribute("aria-valuenow", String(percents[divider]));
  };
  const onMove = (move: PointerEvent) => {
    if (move.pointerId !== evt.pointerId) return;
    move.preventDefault();
    pendingX = move.clientX;
    if (!frame) frame = ownerWindow.requestAnimationFrame(paint);
  };
  const cleanup = (commit: boolean) => {
    if (finished) return;
    finished = true;
    if (frame) ownerWindow.cancelAnimationFrame(frame);
    if (commit) paint();
    ownerDocument.removeEventListener("pointermove", onMove, true);
    ownerDocument.removeEventListener("pointerup", onUp, true);
    ownerDocument.removeEventListener("pointercancel", onCancel, true);
    ownerDocument.removeEventListener("keydown", onKey, true);
    ownerDocument.body.classList.remove("nf-resizing-columns");
    ctx.row.classList.remove("is-resizing");
    handle.classList.remove("is-resizing");
    handle.removeAttribute("data-nf-column-value");
    for (const column of ctx.columns) column.style.removeProperty("flex");
    try {
      if (handle.hasPointerCapture(evt.pointerId)) {
        handle.releasePointerCapture(evt.pointerId);
      }
    } catch {
      // Detached between pointerdown and pointerup.
    }
    if (
      commit &&
      ctx.view.state.doc.sliceString(ctx.from, ctx.to) === ctx.text
    ) {
      const percents = columnPercentsFromWidths(next);
      dispatchColumnWidths(
        ctx.view,
        ctx.block,
        percents,
        "input.columns.resize"
      );
    }
  };
  const onUp = (up: PointerEvent) => {
    if (up.pointerId === evt.pointerId) cleanup(true);
  };
  const onCancel = (cancel: PointerEvent) => {
    if (cancel.pointerId === evt.pointerId) cleanup(false);
  };
  const onKey = (key: KeyboardEvent) => {
    if (key.key !== "Escape") return;
    key.preventDefault();
    key.stopPropagation();
    cleanup(false);
  };

  ctx.row.classList.add("is-resizing");
  handle.classList.add("is-resizing");
  ownerDocument.body.classList.add("nf-resizing-columns");
  ownerDocument.addEventListener("pointermove", onMove, true);
  ownerDocument.addEventListener("pointerup", onUp, true);
  ownerDocument.addEventListener("pointercancel", onCancel, true);
  ownerDocument.addEventListener("keydown", onKey, true);
  try {
    handle.setPointerCapture(evt.pointerId);
  } catch {
    // Pointer capture is optional; document listeners are the fallback.
  }
  paint();
  return true;
}

function resizeColumnsFromKeyboard(handle: HTMLElement, evt: KeyboardEvent): boolean {
  if (evt.key !== "ArrowLeft" && evt.key !== "ArrowRight") return false;
  const ctx = renderedColumnsContext(handle);
  const divider = Number(handle.dataset.nfColumnDivider);
  if (!ctx || !Number.isInteger(divider)) return false;
  const widths = ctx.columns.map((column) => column.getBoundingClientRect().width);
  if (widths.some((width) => width <= 0)) return false;
  const rtl = (handle.ownerDocument.defaultView ?? window)
    .getComputedStyle(ctx.content).direction === "rtl";
  const total = widths.reduce((sum, width) => sum + width, 0);
  const step = total * (evt.shiftKey ? 0.05 : 0.01);
  const visual = evt.key === "ArrowRight" ? 1 : -1;
  const next = resizedColumnPixels(widths, divider, step * visual * (rtl ? -1 : 1));
  evt.preventDefault();
  evt.stopPropagation();
  return replaceRenderedColumnWidths(
    handle,
    columnPercentsFromWidths(next),
    "input.columns.resize"
  );
}

/* ------------------------------------------------------------------ */
/* Visual column editing                                               */
/*                                                                     */
/* The outer Obsidian EditorView remains the only document and history. */
/* One active nf-cols row is replaced by a stable flex widget: the      */
/* selected column gets a lightweight, history-free child EditorView;   */
/* siblings stay rendered Markdown. Child edits are projected back as   */
/* minimal outer changes, and outer undo/redo remains authoritative.     */
/* ------------------------------------------------------------------ */

interface ActiveVisualColumn {
  from: number;
  to: number;
  column: number;
  /** Caret offset in the projected child document for first mount. */
  cursor?: number;
}

const setVisualColumnEffect = StateEffect.define<ActiveVisualColumn | null>();

interface VisualColumnFieldValue {
  active: ActiveVisualColumn | null;
  decorations: DecorationSet;
}

interface ColumnPreviewRuntime {
  text: string;
  sourcePath: string;
  container: HTMLElement;
  component: Component;
}

interface ColumnPreviewRequest extends ColumnPreviewRuntime {}

interface VisualColumnRuntime {
  root: HTMLElement;
  model: VisualColumnWidget;
  outerView: EditorView;
  activeEditor: EditorView | null;
  activeColumn: number;
  previews: Map<number, ColumnPreviewRuntime>;
  previewRequests: Map<number, ColumnPreviewRequest>;
  syncing: boolean;
  observer: ResizeObserver | null;
  animationFrame: number | null;
  disposed: boolean;
}

const visualColumnRuntimes = new WeakMap<HTMLElement, VisualColumnRuntime>();

/** Resolve the file which owns one CodeMirror editor. Global active-file
 * state is deliberately irrelevant: another split or pop-out may be focused
 * while this editor is rendering relative links and embeds. */
export function sourcePathForEditorView(
  workspace: Pick<App["workspace"], "getLeavesOfType">,
  editorView: EditorView
): string {
  let candidate: EditorView | null = editorView;
  const seen = new Set<EditorView>();
  while (candidate && !seen.has(candidate)) {
    seen.add(candidate);
    for (const leaf of workspace.getLeavesOfType("markdown")) {
      const markdownView = leaf.view as unknown as {
        editor?: { cm?: EditorView };
        file?: { path?: string } | null;
      };
      if (markdownView.editor?.cm === candidate) {
        return markdownView.file?.path ?? "";
      }
    }
    // A visual-column editor is a real nested EditorView, so it has no
    // workspace leaf of its own. Follow its runtime back to the owning
    // note; this also keeps relative embeds correct in recursively nested
    // columns and in Callouts rendered from inside a column.
    const root: HTMLElement | null =
      candidate.dom?.closest?.(".nf-columns-editor") ?? null;
    candidate = root ? visualColumnRuntimes.get(root)?.outerView ?? null : null;
  }
  return "";
}

/** Render away from the visible container and replace its children only
 * after a successful, still-current result. A rejected or invalid render
 * leaves the last good DOM untouched. */
export async function commitStagedRender(
  container: HTMLElement,
  render: (staging: HTMLElement) => Promise<void>,
  options: {
    stagingClass?: string;
    shouldCommit?: () => boolean;
    validate?: (staging: HTMLElement) => boolean;
  } = {}
): Promise<boolean> {
  const staging = container.ownerDocument.createElement("div");
  if (options.stagingClass) staging.className = options.stagingClass;
  try {
    await render(staging);
    if (options.shouldCommit && !options.shouldCommit()) return false;
    if (options.validate && !options.validate(staging)) return false;
    container.replaceChildren(...Array.from(staging.childNodes));
    return true;
  } catch {
    return false;
  }
}

function diffText(oldText: string, newText: string): {
  from: number;
  to: number;
  insert: string;
} | null {
  if (oldText === newText) return null;
  let from = 0;
  const min = Math.min(oldText.length, newText.length);
  while (from < min && oldText.charCodeAt(from) === newText.charCodeAt(from)) from++;
  let oldTo = oldText.length;
  let newTo = newText.length;
  while (
    oldTo > from &&
    newTo > from &&
    oldText.charCodeAt(oldTo - 1) === newText.charCodeAt(newTo - 1)
  ) {
    oldTo--;
    newTo--;
  }
  return { from, to: oldTo, insert: newText.slice(from, newTo) };
}

/** Map one clean projected-column edit back into the preserved nf-cols
 * source. The result is relative to the start of `blockText`; callers can
 * add the outer document offset and keep the main EditorView authoritative. */
export function projectColumnTextChange(
  blockText: string,
  columnIndex: number,
  oldText: string,
  newText: string
): { from: number; to: number; insert: string } | null {
  const diff = diffText(oldText, newText);
  if (!diff) return null;
  const layout = parseColumnsSource(blockText.split("\n"));
  const projection = layout ? columnInnerSource(layout, columnIndex) : null;
  if (!layout || !projection || projection.doc.toString() !== oldText) return null;
  const from = mapColumnInnerOffset(projection, diff.from);
  const to = mapColumnInnerOffset(projection, diff.to);
  if (from == null || to == null) return null;
  const innerLine = projection.doc.lineAt(diff.from);
  const origin = projection.origins[innerLine.number - 1];
  if (!origin) return null;
  const sourceLine = layout.lines[origin.blockLineIndex];
  const prefix = sourceLine.slice(0, origin.sourceCh);
  return { from, to, insert: diff.insert.replace(/\n/g, "\n" + prefix) };
}

/** Map a caret in rendered text back onto one Markdown source row. Inline
 * markers are skipped by aligning the rendered characters as a subsequence
 * of the formattable source span. */
export function markdownCursorForRenderedOffset(
  lineText: string,
  renderedText: string,
  renderedOffset: number
): number | null {
  if (!renderedText) return null;
  const span = lineContentSpan(lineText) ?? { from: 0, to: lineText.length };
  const source = lineText.slice(span.from, span.to);
  const positions = new Array<number>(renderedText.length + 1);
  positions[0] = span.from;
  let sourceOffset = 0;
  let rendered = 0;
  while (rendered < renderedText.length) {
    if (/\s/.test(renderedText[rendered])) {
      const start = rendered;
      while (rendered < renderedText.length && /\s/.test(renderedText[rendered])) {
        rendered++;
      }
      let found = sourceOffset;
      while (found < source.length && !/\s/.test(source[found])) found++;
      if (found >= source.length) return null;
      while (found < source.length && /\s/.test(source[found])) found++;
      sourceOffset = found;
      for (let i = start + 1; i <= rendered; i++) {
        positions[i] = span.from + sourceOffset;
      }
      continue;
    }
    const found = source.indexOf(renderedText[rendered], sourceOffset);
    if (found < 0) return null;
    sourceOffset = found + 1;
    rendered++;
    positions[rendered] = span.from + sourceOffset;
  }
  const offset = Math.max(0, Math.min(renderedText.length, renderedOffset));
  return positions[offset] ?? span.from + sourceOffset;
}

function cleanupVisualColumnRuntime(root: HTMLElement) {
  const runtime = visualColumnRuntimes.get(root);
  if (!runtime) return;
  runtime.disposed = true;
  const ownerWindow = root.ownerDocument.defaultView;
  if (runtime.animationFrame != null) {
    ownerWindow?.cancelAnimationFrame(runtime.animationFrame);
    runtime.animationFrame = null;
  }
  runtime.observer?.disconnect();
  runtime.activeEditor?.destroy();
  for (const preview of runtime.previews.values()) preview.component.unload();
  for (const request of runtime.previewRequests.values()) request.component.unload();
  runtime.previews.clear();
  runtime.previewRequests.clear();
  visualColumnRuntimes.delete(root);
}

function visualColumnRuntimeIsCurrent(runtime: VisualColumnRuntime): boolean {
  return (
    !runtime.disposed &&
    visualColumnRuntimes.get(runtime.root) === runtime
  );
}

function closeVisualColumnEditor(
  runtime: VisualColumnRuntime,
  placement: "source" | "after"
) {
  const docLength = runtime.outerView.state.doc.length;
  const anchor = placement === "source"
    ? Math.min(docLength, runtime.model.from + 1)
    : Math.min(docLength, runtime.model.to + (runtime.model.to < docLength ? 1 : 0));
  runtime.outerView.dispatch({
    effects: setVisualColumnEffect.of(null),
    selection: { anchor },
    scrollIntoView: true,
  });
  runtime.outerView.focus();
}

function syncVisualColumnChild(
  runtime: VisualColumnRuntime,
  target: EditorView,
  text: string
) {
  if (
    !visualColumnRuntimeIsCurrent(runtime) ||
    runtime.activeEditor !== target ||
    target.state.doc.toString() === text
  ) return;
  runtime.syncing = true;
  try {
    target.dispatch({
      changes: { from: 0, to: target.state.doc.length, insert: text },
    });
  } finally {
    runtime.syncing = false;
  }
}

function authoritativeVisualColumnText(
  runtime: VisualColumnRuntime,
  columnIndex: number
): string | null {
  if (!visualColumnRuntimeIsCurrent(runtime)) return null;
  const model = runtime.model;
  const outer = runtime.outerView.state.doc;
  if (model.from < 0 || model.to > outer.length || model.from >= model.to) return null;
  const blockText = outer.sliceString(model.from, model.to);
  const layout = parseColumnsSource(blockText.split("\n"));
  return layout ? columnInnerSource(layout, columnIndex)?.doc.toString() ?? null : null;
}

function renderVisualColumnPreview(
  runtime: VisualColumnRuntime,
  index: number,
  text: string,
  container: HTMLElement,
  plugin: NotionFlowPlugin
) {
  const sourcePath = sourcePathForEditorView(
    plugin.app.workspace,
    runtime.outerView
  );
  const current = runtime.previews.get(index);
  const pending = runtime.previewRequests.get(index);
  if (
    pending?.text === text &&
    pending.sourcePath === sourcePath &&
    pending.container === container
  ) return;
  if (pending) {
    runtime.previewRequests.delete(index);
    pending.component.unload();
  }
  if (current?.container !== container) {
    runtime.previews.delete(index);
    current?.component.unload();
  } else if (current.text === text && current.sourcePath === sourcePath) {
    container.removeAttribute("aria-busy");
    return;
  }
  container.setAttribute("aria-busy", "true");
  const component = new Component();
  component.load();
  const request = { text, sourcePath, container, component };
  runtime.previewRequests.set(index, request);
  void commitStagedRender(
    container,
    (staging) => MarkdownRenderer.render(
      plugin.app,
      text || " ",
      staging,
      sourcePath,
      component
    ),
    {
      stagingClass: "nf-columns-editor-preview-stage",
      shouldCommit: () =>
        visualColumnRuntimeIsCurrent(runtime) &&
        runtime.previewRequests.get(index) === request,
    }
  ).then((committed) => {
    if (runtime.previewRequests.get(index) !== request) return;
    runtime.previewRequests.delete(index);
    if (!committed) {
      component.unload();
      container.removeAttribute("aria-busy");
      return;
    }
    runtime.previews.get(index)?.component.unload();
    runtime.previews.set(index, request);
    container.removeAttribute("aria-busy");
    runtime.outerView.requestMeasure();
  });
}

class VisualColumnWidget extends WidgetType {
  constructor(
    readonly plugin: NotionFlowPlugin,
    readonly from: number,
    readonly to: number,
    readonly column: number,
    readonly text: string,
    readonly cursor = 0
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof VisualColumnWidget &&
      other.from === this.from &&
      other.to === this.to &&
      other.column === this.column &&
      other.text === this.text &&
      other.cursor === this.cursor
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const root = view.dom.ownerDocument.createElement("div");
    root.className = "nf-columns-editor";
    this.mount(root, view, true);
    return root;
  }

  updateDOM(root: HTMLElement, view: EditorView): boolean {
    return this.mount(root, view, false);
  }

  destroy(root: HTMLElement) {
    cleanupVisualColumnRuntime(root);
  }

  ignoreEvent(): boolean {
    return true;
  }

  private mount(root: HTMLElement, outerView: EditorView, focus: boolean): boolean {
    const lines = this.text.split("\n");
    const layout = parseColumnsSource(lines);
    if (!layout || layout.columns.length < 2 || this.column >= layout.columns.length) {
      return false;
    }
    const existing = visualColumnRuntimes.get(root);
    const rebuild =
      !existing ||
      existing.activeColumn !== this.column ||
      root.querySelectorAll(":scope > .nf-columns-editor-grid > .nf-column-editor").length !==
        layout.columns.length;
    if (rebuild) {
      cleanupVisualColumnRuntime(root);
      root.replaceChildren();
      root.className = "nf-columns-editor";
      const runtime: VisualColumnRuntime = {
        root,
        model: this,
        outerView,
        activeEditor: null,
        activeColumn: this.column,
        previews: new Map(),
        previewRequests: new Map(),
        syncing: false,
        observer: null,
        animationFrame: null,
        disposed: false,
      };
      visualColumnRuntimes.set(root, runtime);
      this.buildDOM(root, layout, runtime);
      const ownerWindow = root.ownerDocument.defaultView ?? window;
      const Observer = ownerWindow.ResizeObserver;
      if (Observer) {
        runtime.observer = new Observer(() => {
          if (visualColumnRuntimeIsCurrent(runtime)) outerView.requestMeasure();
        });
        runtime.observer.observe(root);
      }
      runtime.animationFrame = ownerWindow.requestAnimationFrame(() => {
        runtime.animationFrame = null;
        if (!visualColumnRuntimeIsCurrent(runtime)) return;
        outerView.requestMeasure();
        if (focus || this.column !== existing?.activeColumn) {
          runtime.activeEditor?.focus();
        }
      });
      return true;
    }

    existing.model = this;
    existing.outerView = outerView;
    const inner = columnInnerSource(layout, this.column);
    if (!inner || !existing.activeEditor) return false;
    const authoritative = inner.doc.toString();
    syncVisualColumnChild(existing, existing.activeEditor, authoritative);
    for (let index = 0; index < layout.columns.length; index++) {
      const shell = root.querySelector<HTMLElement>(
        `:scope > .nf-columns-editor-grid > .nf-column-editor[data-nf-column-index="${index}"]`
      );
      if (!shell) return false;
      this.applyColumnWidth(shell, layout.columns[index].width);
      if (index === this.column) continue;
      const projected = columnInnerSource(layout, index);
      const container = shell.querySelector<HTMLElement>(":scope > .nf-column-preview");
      if (projected && container) {
        renderVisualColumnPreview(
          existing,
          index,
          projected.doc.toString(),
          container,
          this.plugin
        );
      }
    }
    outerView.requestMeasure();
    return true;
  }

  private buildDOM(
    root: HTMLElement,
    layout: ColumnsSourceLayout,
    runtime: VisualColumnRuntime
  ) {
    const ownerDocument = root.ownerDocument;
    const toolbar = ownerDocument.createElement("div");
    toolbar.className = "nf-columns-editor-toolbar";
    const sourceButton = ownerDocument.createElement("button");
    sourceButton.type = "button";
    sourceButton.className = "clickable-icon nf-columns-editor-action";
    sourceButton.setAttribute("aria-label", t("Edit column source"));
    sourceButton.title = t("Edit column source");
    setIcon(sourceButton, "code-2");
    sourceButton.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      closeVisualColumnEditor(runtime, "source");
    });
    const doneButton = ownerDocument.createElement("button");
    doneButton.type = "button";
    doneButton.className = "clickable-icon nf-columns-editor-action";
    doneButton.setAttribute("aria-label", t("Finish column editing"));
    doneButton.title = t("Finish column editing");
    setIcon(doneButton, "check");
    doneButton.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      closeVisualColumnEditor(runtime, "after");
    });
    toolbar.append(sourceButton, doneButton);
    root.appendChild(toolbar);

    const grid = ownerDocument.createElement("div");
    grid.className = "nf-columns-editor-grid";
    root.appendChild(grid);
    for (let index = 0; index < layout.columns.length; index++) {
      const shell = ownerDocument.createElement("section");
      shell.className = "nf-column-editor";
      shell.dataset.nfColumnIndex = String(index);
      this.applyColumnWidth(shell, layout.columns[index].width);
      const inner = columnInnerSource(layout, index);
      if (!inner) continue;
      if (index === this.column) {
        shell.classList.add("is-active");
        shell.setAttribute("aria-label", t("Editing column"));
        const host = ownerDocument.createElement("div");
        host.className = "nf-column-editor-host";
        shell.appendChild(host);
        this.createInnerEditor(host, inner.doc.toString(), runtime, index);
      } else {
        shell.classList.add("is-preview");
        const activate = () =>
          runtime.outerView.dispatch({
            effects: setVisualColumnEffect.of({
              from: runtime.model.from,
              to: runtime.model.to,
              column: index,
            }),
            selection: { anchor: runtime.model.from },
          });
        const editButton = ownerDocument.createElement("button");
        editButton.type = "button";
        editButton.className = "clickable-icon nf-column-preview-action";
        editButton.setAttribute("aria-label", t("Edit this column"));
        editButton.title = t("Edit this column");
        setIcon(editButton, "pencil");
        editButton.addEventListener("mousedown", (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
        });
        editButton.addEventListener("click", (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          activate();
        });
        shell.appendChild(editButton);
        const preview = ownerDocument.createElement("div");
        preview.className = "nf-column-preview markdown-rendered";
        shell.appendChild(preview);
        shell.addEventListener("mousedown", (evt) => {
          const target = evt.target as Element | null;
          if (target?.closest?.("a, button, input, textarea, select")) return;
          evt.preventDefault();
          evt.stopPropagation();
        });
        shell.addEventListener("click", (evt) => {
          const target = evt.target as Element | null;
          if (target?.closest?.("a, button, input, textarea, select")) return;
          evt.preventDefault();
          evt.stopPropagation();
          activate();
        });
        renderVisualColumnPreview(
          runtime,
          index,
          inner.doc.toString(),
          preview,
          this.plugin
        );
      }
      grid.appendChild(shell);
    }
  }

  private applyColumnWidth(shell: HTMLElement, width: number | null) {
    shell.style.flex = width == null ? "1 1 0" : `0 1 ${width}%`;
  }

  private createInnerEditor(
    host: HTMLElement,
    text: string,
    runtime: VisualColumnRuntime,
    columnIndex: number
  ) {
    const plugin = this.plugin;
    let innerView: EditorView;
    const visualInlineKeymap = keymap.of([
      {
        key: "Mod-b",
        preventDefault: true,
        stopPropagation: true,
        run: (view) => this.toggleVisualMarkdown(view, "**", "<b>", "</b>"),
      },
      {
        key: "Mod-i",
        preventDefault: true,
        stopPropagation: true,
        run: (view) => this.toggleVisualMarkdown(view, "*", "<i>", "</i>"),
      },
      {
        key: "Mod-k",
        preventDefault: true,
        stopPropagation: true,
        run: (view) => {
          if (inFenceBody(view.state)) return true;
          const sel = view.state.selection.main;
          if (sel.empty) {
            view.dispatch({
              changes: { from: sel.from, insert: "[]()" },
              selection: { anchor: sel.from + 1 },
              userEvent: "input",
            });
          } else {
            insertLink(view);
          }
          return true;
        },
      },
      {
        key: "Mod-\\",
        preventDefault: true,
        stopPropagation: true,
        run: (view) => {
          if (!view.state.selection.main.empty) clearInlineFormatting(view);
          return true;
        },
      },
    ]);
    const domHandlers = EditorView.domEventHandlers({
      keydown: (evt) => {
        if (evt.key === "Escape") {
          evt.preventDefault();
          evt.stopPropagation();
          closeVisualColumnEditor(runtime, "after");
          return true;
        }
        const mod = evt.metaKey || evt.ctrlKey;
        if (mod && !evt.altKey && (evt.key.toLowerCase() === "z" || evt.key.toLowerCase() === "y")) {
          runScopeHandlers(runtime.outerView, evt, "editor");
          evt.preventDefault();
          evt.stopPropagation();
          return true;
        }
        return false;
      },
    });
    // Embedded column editors do not pass through Obsidian's `editor-paste`
    // workspace event. Recreate the two structural paste affordances that
    // matter here so entering a column does not silently downgrade editing:
    // URL-over-selection still makes a link, and multi-line content pasted
    // inside a quote/Callout keeps every row in that container.
    const pasteHandlers = EditorView.domEventHandlers({
      paste: (evt, view) => {
        if (evt.defaultPrevented || view.state.readOnly) return false;
        const data = evt.clipboardData;
        if (!data || data.files.length > 0) return false;
        const selection = view.state.selection.main;
        const plain = data.getData("text/plain");
        if (plugin.settings.pasteUrlLinks) {
          const link = buildPasteLink(
            view.state.doc.sliceString(selection.from, selection.to),
            plain
          );
          if (link) {
            evt.preventDefault();
            view.dispatch({
              changes: { from: selection.from, to: selection.to, insert: link },
              selection: { anchor: selection.from + link.length },
              scrollIntoView: true,
              userEvent: "input.paste",
            });
            return true;
          }
        }
        if (!plugin.settings.calloutEditing) return false;
        const html = data.getData("text/html");
        const clip = html ? htmlToMarkdown(html) : plain;
        if (view.state.selection.ranges.length !== 1) return false;
        const replacement = buildQuotedPasteForSelection(
          view.state.doc,
          selection.from,
          selection.to,
          clip,
          cachedFences(view.state.doc)
        );
        if (replacement == null) return false;
        evt.preventDefault();
        view.dispatch({
          changes: {
            from: selection.from,
            to: selection.to,
            insert: replacement,
          },
          selection: { anchor: selection.from + replacement.length },
          scrollIntoView: true,
          userEvent: "input.paste",
        });
        return true;
      },
    });
    const editorAdapter = (view: EditorView): Editor =>
      ({
        getLine(lineNo: number) {
          return lineNo >= 0 && lineNo < view.state.doc.lines
            ? view.state.doc.line(lineNo + 1).text
            : "";
        },
        replaceRange(
          replacement: string,
          from: EditorPosition,
          to: EditorPosition = from
        ) {
          const startLine = view.state.doc.line(
            Math.max(1, Math.min(view.state.doc.lines, from.line + 1))
          );
          const endLine = view.state.doc.line(
            Math.max(1, Math.min(view.state.doc.lines, to.line + 1))
          );
          const start = Math.min(startLine.to, startLine.from + from.ch);
          const end = Math.min(endLine.to, endLine.from + to.ch);
          view.dispatch({
            changes: { from: start, to: Math.max(start, end), insert: replacement },
            selection: { anchor: start + replacement.length },
            scrollIntoView: true,
            userEvent: "input.complete",
          });
        },
        setCursor(position: EditorPosition) {
          const line = view.state.doc.line(
            Math.max(1, Math.min(view.state.doc.lines, position.line + 1))
          );
          view.dispatch({
            selection: { anchor: Math.min(line.to, line.from + position.ch) },
            scrollIntoView: true,
          });
        },
      } as unknown as Editor);
    const slashCompletion = autocompletion({
      activateOnTyping: true,
      maxRenderedOptions: 18,
      override: [
        (context: CompletionContext) => {
          if (!plugin.settings.slashCommands) return null;
          const line = context.state.doc.lineAt(context.pos);
          const before = line.text.slice(0, context.pos - line.from);
          const match = before.match(
            /(?:^|[\s>]|[　-ヿ一-鿿＀-￯])[/／]([\w　-ヿ一-鿿＀-￯-]*)$/
          );
          if (!match || fenceAt(cachedFences(context.state.doc), line.number)) {
            return null;
          }
          const query = match[1].toLowerCase();
          const all = plugin.settings.columnLayout
            ? SLASH_COMMANDS
            : SLASH_COMMANDS.filter((command) => !command.id.startsWith("cols"));
          const prefix = (command: SlashCommand) =>
            command.id.startsWith(query) ||
            command.name.toLowerCase().startsWith(query) ||
            command.keywords.split(" ").some((keyword) => keyword.startsWith(query));
          const commands = query
            ? all
                .filter(
                  (command) =>
                    command.id.startsWith(query) ||
                    command.name.toLowerCase().includes(query) ||
                    command.keywords.includes(query)
                )
                .sort((a, b) => Number(prefix(b)) - Number(prefix(a)))
            : all;
          const from = context.pos - match[1].length - 1;
          return {
            from,
            validFor: /^[/／][\w　-ヿ一-鿿＀-￯-]*$/,
            options: commands.map((command) => ({
              label: command.name,
              detail: command.desc ?? command.hint,
              type: "keyword",
              boost: prefix(command) ? 20 : 0,
              apply: (view: EditorView, _completion: Completion, start: number, end: number) => {
                const current = view.state.doc.lineAt(start);
                const startPos = {
                  line: current.number - 1,
                  ch: start - current.from,
                };
                const endLine = view.state.doc.lineAt(end);
                const endPos = {
                  line: endLine.number - 1,
                  ch: end - endLine.from,
                };
                if (command.linePrefix !== undefined) {
                  const withoutTrigger =
                    current.text.slice(0, startPos.ch) +
                    current.text.slice(end - current.from);
                  const quote = command.linePrefix.startsWith(">")
                    ? null
                    : quoteMarkerPrefix(withoutTrigger);
                  const replacement = quote
                    ? quote + applyLinePrefix(withoutTrigger.slice(quote.length), command.linePrefix)
                    : applyLinePrefix(withoutTrigger, command.linePrefix);
                  view.dispatch({
                    changes: { from: current.from, to: current.to, insert: replacement },
                    selection: { anchor: current.from + replacement.length },
                    scrollIntoView: true,
                    userEvent: "input.complete",
                  });
                  return;
                }
                SlashSuggest.insertSnippetInto(
                  editorAdapter(view),
                  startPos,
                  endPos,
                  command
                );
              },
            })),
          };
        },
      ],
    });
    const state = EditorState.create({
      doc: text,
      selection: {
        anchor: Math.max(0, Math.min(text.length, runtime.model.cursor)),
      },
      extensions: [
        // A real Markdown language tree is the foundation for list markers,
        // syntax highlighting, formatting concealment, and structural
        // navigation. Without it the column looked like a plain textarea
        // even though the surrounding note was in Live Preview.
        markdown(),
        EditorView.lineWrapping,
        domHandlers,
        pasteHandlers,
        slashCompletion,
        visualInlineKeymap,
        makeToolbarPlugin(plugin),
        makeListMarkerPlugin(),
        makeNestedIndentPlugin(plugin),
        makeConcealPlugin(plugin),
        makeMarkdownConcealPlugin(plugin),
        makeTableKeymap(plugin),
        makeQuoteKeymap(plugin),
        makeCodeBlockKeymap(plugin),
        makeTrailingClickPlugin(),
        makeCodeMarkerRewriter(plugin),
        makeVisualColumnEditor(plugin),
        makeCalloutIconMenu(plugin),
        Prec.highest(makeCalloutEditPlugin(plugin)),
      ],
    });
    innerView = new EditorView({
      state,
      parent: host,
      dispatchTransactions: (transactions, target) => {
        const oldText = target.state.doc.toString();
        target.update(transactions);
        if (runtime.syncing || !transactions.some((tr) => tr.docChanged)) return;
        const newText = target.state.doc.toString();
        const diff = diffText(oldText, newText);
        if (!diff) return;
        const restoreChild = () => {
          syncVisualColumnChild(runtime, target, oldText);
        };
        const model = runtime.model;
        const outerDoc = runtime.outerView.state.doc;
        if (outerDoc.sliceString(model.from, model.to) !== model.text) {
          restoreChild();
          return;
        }
        const projected = projectColumnTextChange(
          model.text,
          columnIndex,
          oldText,
          newText
        );
        if (!projected) {
          restoreChild();
          return;
        }
        const userEvent =
          transactions
            .map((tr) => tr.annotation(Transaction.userEvent))
            .find((value): value is string => typeof value === "string") ?? "input";
        runtime.outerView.dispatch({
          changes: {
            from: model.from + projected.from,
            to: model.from + projected.to,
            insert: projected.insert,
          },
          userEvent,
        });
        // Transaction filters may reject or rewrite an outer change. Never
        // leave a plausible-looking child draft detached from the note:
        // immediately reconcile it with the source that actually committed.
        const authoritative = authoritativeVisualColumnText(runtime, columnIndex);
        if (authoritative != null) {
          syncVisualColumnChild(runtime, target, authoritative);
        }
      },
    });
    runtime.activeEditor = innerView;
  }

  private toggleVisualMarkdown(
    view: EditorView,
    marker: string,
    codeOpen: string,
    codeClose: string
  ): boolean {
    if (view.composing) return false;
    const inCode = inFenceBody(view.state);
    const open = inCode ? codeOpen : marker;
    const close = inCode ? codeClose : marker;
    const sel = view.state.selection.main;
    if (sel.empty) {
      view.dispatch({
        changes: { from: sel.from, insert: open + close },
        selection: { anchor: sel.from + open.length },
        userEvent: "input",
      });
    } else {
      toggleWrap(view, open, close);
    }
    return true;
  }
}

function makeVisualColumnEditor(plugin: NotionFlowPlugin) {
  const empty = Decoration.none;
  const buildDecorations = (
    state: EditorState,
    active: ActiveVisualColumn | null
  ): DecorationSet => {
    if (!active || active.from < 0 || active.to > state.doc.length || active.from >= active.to) {
      return empty;
    }
    const text = state.doc.sliceString(active.from, active.to);
    const layout = parseColumnsSource(text.split("\n"));
    if (
      !layout ||
      layout.columns.length < 2 ||
      active.column >= layout.columns.length ||
      layout.columns.some((_column, index) => !columnInnerSource(layout, index))
    ) {
      return empty;
    }
    return Decoration.set([
      Decoration.replace({
        block: true,
        widget: new VisualColumnWidget(
          plugin,
          active.from,
          active.to,
          active.column,
          text,
          active.cursor
        ),
      }).range(active.from, active.to),
    ]);
  };
  const field = StateField.define<VisualColumnFieldValue>({
    create: () => ({ active: null, decorations: empty }),
    update: (value, transaction) => {
      let active = value.active;
      if (active && transaction.docChanged) {
        active = {
          ...active,
          from: transaction.changes.mapPos(active.from, -1),
          to: transaction.changes.mapPos(active.to, 1),
        };
      }
      let explicit = false;
      for (const effect of transaction.effects) {
        if (!effect.is(setVisualColumnEffect)) continue;
        active = effect.value;
        explicit = true;
      }
      if (!explicit && active && transaction.selection) {
        const head = transaction.newSelection.main.head;
        if (head < active.from || head > active.to) active = null;
      }
      const decorations = buildDecorations(transaction.state, active);
      if (active && decorations.size === 0) active = null;
      return { active, decorations };
    },
    provide: (source) => [
      Prec.highest(
        EditorView.decorations.from(source, (value) => value.decorations)
      ),
      EditorView.atomicRanges.of((view) => view.state.field(source).decorations),
    ],
  });
  return [
    field,
    EditorView.domEventHandlers({
      mousedown: (evt, view) => {
        const active = view.state.field(field).active;
        if (!active) return false;
        const target = evt.target as Element | null;
        if (target?.closest?.(".nf-columns-editor")) return false;
        view.dispatch({ effects: setVisualColumnEffect.of(null) });
        return false;
      },
    }),
  ];
}

function renderedColumnIndex(
  target: Element | null,
  knownView?: EditorView,
  point?: { x: number; y: number }
): {
  context: RenderedColumnsContext;
  index: number;
} | null {
  const column = target?.closest<HTMLElement>(`.callout[data-callout="${COL_TYPE}"]`);
  const row = target?.closest<HTMLElement>(`.callout[data-callout="${COLS_TYPE}"]`);
  const source = column ?? row ?? (target instanceof HTMLElement ? target : null);
  if (!source) return null;
  const context = renderedColumnsContext(source, knownView);
  if (!context) return null;
  const layout = parseColumnsSource(context.text.split("\n"));
  if (
    !layout ||
    layout.columns.length !== context.columns.length ||
    layout.columns.some((_segment, index) => !columnInnerSource(layout, index))
  ) return null;
  let index = column?.parentElement === context.content
    ? context.columns.indexOf(column)
    : -1;
  // Obsidian can retarget a click on rendered callout text to the outer
  // embed block. Fall back to the actual pointer position so a column is
  // still independently addressable instead of selecting the whole row.
  if (index < 0 && point) {
    index = context.columns.findIndex((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return (
        point.x >= rect.left &&
        point.x <= rect.right &&
        point.y >= rect.top &&
        point.y <= rect.bottom
      );
    });
  }
  return index >= 0 ? { context, index } : null;
}

function renderedColumnCursorAtPoint(
  context: RenderedColumnsContext,
  columnIndex: number,
  target: Element | null,
  point: { x: number; y: number }
): number {
  const layout = parseColumnsSource(context.text.split("\n"));
  const projection = layout ? columnInnerSource(layout, columnIndex) : null;
  const column = context.columns[columnIndex];
  if (!projection || !column) return 0;
  const content =
    column.querySelector<HTMLElement>(":scope > .callout-content") ?? column;
  const leafSelector =
    "p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, td, th, figcaption";
  const candidate = target?.closest<HTMLElement>(leafSelector) ?? null;
  const leaf = candidate && content.contains(candidate) ? candidate : null;
  const renderedText = leaf?.textContent ?? "";
  let renderedOffset: number | null = null;

  if (leaf && renderedText) {
    type CaretDocument = Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number
      ) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (
        x: number,
        y: number
      ) => { startContainer: Node; startOffset: number } | null;
    };
    const ownerDocument = column.ownerDocument as CaretDocument;
    const caret = ownerDocument.caretPositionFromPoint?.(point.x, point.y);
    const legacy = caret ? null : ownerDocument.caretRangeFromPoint?.(point.x, point.y);
    const node = caret?.offsetNode ?? legacy?.startContainer ?? null;
    const offset = caret?.offset ?? legacy?.startOffset ?? 0;
    if (node && (node === leaf || leaf.contains(node))) {
      try {
        const range = ownerDocument.createRange();
        range.selectNodeContents(leaf);
        range.setEnd(node, offset);
        renderedOffset = range.toString().length;
      } catch {
        renderedOffset = null;
      }
    }
    if (renderedOffset == null) {
      const rect = leaf.getBoundingClientRect();
      const ratio = rect.width > 0
        ? Math.max(0, Math.min(1, (point.x - rect.left) / rect.width))
        : 0;
      renderedOffset = Math.round(renderedText.length * ratio);
    }
  }

  if (renderedOffset != null) {
    for (let lineNo = 1; lineNo <= projection.doc.lines; lineNo++) {
      const line = projection.doc.line(lineNo);
      const offset = markdownCursorForRenderedOffset(
        line.text,
        renderedText,
        renderedOffset
      );
      if (offset != null) return line.from + offset;
    }
  }

  // Rendered blocks such as tables and nested lists may combine several
  // source rows. A geometry fallback still lands on the nearest row rather
  // than surprising the user by jumping to the very start of the column.
  const rect = content.getBoundingClientRect();
  const yRatio = rect.height > 0
    ? Math.max(0, Math.min(0.999999, (point.y - rect.top) / rect.height))
    : 0;
  const line = projection.doc.line(
    Math.min(projection.doc.lines, Math.floor(yRatio * projection.doc.lines) + 1)
  );
  const xRatio = rect.width > 0
    ? Math.max(0, Math.min(1, (point.x - rect.left) / rect.width))
    : 0;
  return line.from + Math.round(line.length * xRatio);
}

function activateRenderedColumn(
  target: Element | null,
  knownView?: EditorView,
  point?: { x: number; y: number }
): boolean {
  const hit = renderedColumnIndex(target, knownView, point);
  if (!hit) return false;
  const cursor = point
    ? renderedColumnCursorAtPoint(hit.context, hit.index, target, point)
    : 0;
  hit.context.view.dispatch({
    effects: setVisualColumnEffect.of({
      from: hit.context.from,
      to: hit.context.to,
      column: hit.index,
      cursor,
    }),
    selection: { anchor: hit.context.from },
  });
  return true;
}

/** Execute a right-edge drop: remove `dragged` from where it was and put
 * it beside `target` — a new columns row, or one more column when the
 * target already is one. One transaction, so a single undo restores both. */
function dropAsColumn(view: EditorView, dragged: BlockRange, target: BlockRange) {
  const doc = view.state.doc;
  const removal = protectedBlockRemovalRange(doc, dragged);
  const draggedLines = doc
    .sliceString(doc.line(dragged.startLine).from, doc.line(dragged.endLine).to)
    .split("\n");
  const tFrom = doc.line(target.startLine).from;
  const tTo = doc.line(target.endLine).to;
  const targetLines = doc.sliceString(tFrom, tTo).split("\n");
  const wrapped =
    parseCalloutHeader(targetLines[0])?.type === COLS_TYPE
      ? [...targetLines, ...appendColumnLines(draggedLines)]
      : buildColumnsWrap(targetLines, draggedLines);

  // Seam lines are read PAST the dragged block when it is the direct
  // neighbor — that neighbor is being removed by this same transaction.
  let prevNo = target.startLine - 1;
  if (prevNo >= dragged.startLine && prevNo <= dragged.endLine) {
    prevNo = dragged.startLine - 1;
  }
  let nextNo = target.endLine + 1;
  if (nextNo >= dragged.startLine && nextNo <= dragged.endLine) {
    nextNo = dragged.endLine + 1;
  }
  const above = prevNo >= 1 ? doc.line(prevNo).text : "";
  const below = nextNo <= doc.lines ? doc.line(nextNo).text : "";
  let text = wrapped.join("\n");
  if (needsProtectedSeam(above, wrapped[0])) text = "\n" + text;
  if (needsProtectedSeam(wrapped[wrapped.length - 1], below)) text += "\n";

  view.dispatch({
    changes: [
      { from: removal.from, to: removal.to },
      { from: tFrom, to: tTo, insert: text },
    ],
    userEvent: "move.block",
  });
}

/** Items that set (or assign) the Callout type of `lineNo`. */
function addCalloutTypeItems(menu: Menu, view: EditorView, lineNo: number) {
  const current = parseCalloutHeader(view.state.doc.line(lineNo).text)?.type;
  for (const entry of CALLOUT_TYPES) {
    menu.addItem((item) =>
      item
        .setTitle(t(entry.label))
        .setIcon(entry.icon)
        .setChecked(current === entry.type)
        .onClick(() => {
          const line = view.state.doc.line(lineNo);
          const next = parseCalloutHeader(line.text)
            ? setCalloutType(line.text, entry.type)
            : quoteToCallout(line.text, entry.type);
          if (next == null || next === line.text) return;
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: next },
            userEvent: "input.callout-type",
          });
        })
    );
  }
}

function addCalloutFoldItem(menu: Menu, view: EditorView, lineNo: number) {
  const header = parseCalloutHeader(view.state.doc.line(lineNo).text);
  if (!header) return;
  menu.addItem((item) =>
    item
      .setTitle(t("Foldable"))
      .setIcon("chevron-down")
      .setChecked(header.fold !== "")
      .onClick(() => {
        const line = view.state.doc.line(lineNo);
        const next = toggleCalloutFold(line.text);
        if (next == null) return;
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: next },
          userEvent: "input.callout-fold",
        });
      })
  );
}

/** Collapse/expand a toggle by rewriting its fold marker — the same edit
 * Obsidian makes when the triangle is clicked, reachable from the menu
 * (and from the keyboard) while the block is collapsed. */
function addToggleStateItem(menu: Menu, view: EditorView, lineNo: number) {
  const header = parseToggleHeader(view.state.doc.line(lineNo).text);
  if (!header) return;
  menu.addItem((item) =>
    item
      .setTitle(t(header.collapsed ? "Expand" : "Collapse"))
      .setIcon(header.collapsed ? "chevron-down" : "chevron-right")
      .onClick(() => {
        const line = view.state.doc.line(lineNo);
        const next = setToggleCollapsed(line.text, !header.collapsed);
        if (next == null) return;
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: next },
          userEvent: "input.toggle-fold",
        });
      })
  );
}

function addCalloutToQuoteItem(menu: Menu, view: EditorView, lineNo: number) {
  if (!parseCalloutHeader(view.state.doc.line(lineNo).text)) return;
  menu.addItem((item) =>
    item
      .setTitle(t("Turn into quote"))
      .setIcon("quote")
      .onClick(() => {
        const doc = view.state.doc;
        const line = doc.line(lineNo);
        const next = calloutToQuote(line.text);
        if (next == null) return;
        // A header reduced to bare markers is dropped entirely when body
        // lines follow, so the quote doesn't begin with a blank row.
        const dropLine =
          RE_QUOTE_ONLY.test(next) &&
          lineNo < doc.lines &&
          RE_QUOTE.test(doc.line(lineNo + 1).text);
        view.dispatch({
          changes: dropLine
            ? { from: line.from, to: line.to + 1 }
            : { from: line.from, to: line.to, insert: next },
          userEvent: "input.callout-type",
        });
      })
  );
}

function openCalloutTypeMenu(view: EditorView, lineNo: number, evt: MouseEvent) {
  const menu = new Menu().setUseNativeMenu(false);
  addCalloutTypeItems(menu, view, lineNo);
  menu.addSeparator();
  addCalloutFoldItem(menu, view, lineNo);
  addCalloutToQuoteItem(menu, view, lineNo);
  menu.showAtMouseEvent(evt);
}

interface RenderedTextCaret {
  text: string;
  offset: number;
  /** Screen-space center of the rendered caret row. */
  targetY: number;
}

interface PendingCalloutCaret {
  x: number;
  y: number;
  from: number;
  to: number;
  /** Stable source anchor captured before opening the rendered widget. */
  sourcePos: number | null;
  /** Where that text row sat before the widget changed height. */
  targetY: number;
}

/** Browser caret hit-testing, scoped to one rendered Callout widget. The
 * standards API is caretPositionFromPoint; Chromium/WebKit still expose the
 * older Range-shaped caretRangeFromPoint, so support both in the widget's
 * own DOM realm. */
function renderedTextCaretAtPoint(
  widget: HTMLElement,
  x: number,
  y: number
): RenderedTextCaret | null {
  type PointDocument = Document & {
    caretRangeFromPoint?: (
      x: number,
      y: number
    ) => { startContainer: Node; startOffset: number } | null;
    caretPositionFromPoint?: (
      x: number,
      y: number
    ) => { offsetNode: Node; offset: number } | null;
  };
  const owner = widget.ownerDocument as PointDocument;
  let node: Node | null = null;
  let offset = 0;
  try {
    const range = owner.caretRangeFromPoint?.(x, y) ?? null;
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    } else {
      const position = owner.caretPositionFromPoint?.(x, y) ?? null;
      if (position) {
        node = position.offsetNode;
        offset = position.offset;
      }
    }
  } catch {
    return null;
  }
  if (!node || node.nodeType !== 3 || !widget.contains(node)) return null;
  const text = node.nodeValue ?? "";
  offset = Math.max(0, Math.min(text.length, offset));

  // caret*FromPoint may snap vertical padding to the nearest text node. Keep
  // that genuinely blank click on the old coordinate fallback path instead
  // of pretending it hit the last visible row.
  let targetY = y;
  try {
    const probe = owner.createRange();
    probe.setStart(node, offset);
    probe.collapse(true);
    const rect = probe.getBoundingClientRect();
    if (Number.isFinite(rect.top) && Number.isFinite(rect.bottom) && rect.bottom > rect.top) {
      const tolerance = Math.max(4, rect.height * 0.25);
      if (y < rect.top - tolerance || y > rect.bottom + tolerance) return null;
      targetY = (rect.top + rect.bottom) / 2;
    }
  } catch {
    // The text fragment is still useful when a DOM implementation cannot
    // produce a collapsed Range rect (some embedded WebViews do this).
  }
  return { text, offset, targetY };
}

function expectedCalloutSourcePos(
  from: number,
  to: number,
  widget: HTMLElement,
  renderedY: number
): number {
  const rect = widget.getBoundingClientRect();
  if (!Number.isFinite(rect.top) || !Number.isFinite(rect.height) || rect.height <= 0) {
    return from + Math.floor((to - from) / 2);
  }
  const ratio = Math.max(0, Math.min(1, (renderedY - rect.top) / rect.height));
  return Math.round(from + (to - from) * ratio);
}

/** Live Preview mouse behavior for rendered Callout widgets:
 *  - clicking the icon opens the type menu instead of expanding the block;
 *  - clicking anywhere else converts Obsidian's native "select the whole
 *    embed" into a caret at the click point, so one click starts editing,
 *    Notion-style (a drag keeps the native block selection).
 *  The widget handles mouse events itself before they bubble to the
 *  editor, so every listener must run in the capture phase. */
function makeCalloutIconMenu(plugin: NotionFlowPlugin) {
  return ViewPlugin.fromClass(
    class CalloutIconMenuView {
      view: EditorView;
      /** Click-to-caret candidate remembered from mousedown. */
      pendingCaret: PendingCalloutCaret | null = null;

      constructor(view: EditorView) {
        this.view = view;
        view.dom.addEventListener("mousedown", this.onMouseDown, true);
        view.dom.addEventListener("click", this.onClick, true);
      }

      headerLineForIcon = (evt: Event): number | null => {
        if (!plugin.settings.calloutEditing) return null;
        const target = evt.target as Element | null;
        const icon = target?.closest?.(".callout-icon");
        if (!icon) return null;
        const visualLead = icon.closest<HTMLElement>(".nf-visual-callout-lead");
        if (visualLead && this.view.contentDOM.contains(visualLead)) {
          try {
            const line = visualLead.closest<HTMLElement>(".cm-line");
            if (!line) return null;
            const lineNo = this.view.state.doc.lineAt(
              this.view.posAtDOM(line, 0)
            ).number;
            return parseCalloutHeader(
              this.view.state.doc.line(lineNo).text
            )
              ? lineNo
              : null;
          } catch {
            return null;
          }
        }
        const widget = icon.closest<HTMLElement>(".cm-embed-block.cm-callout");
        if (!widget || !this.view.contentDOM.contains(widget)) return null;
        // Only the widget's own icon: a Callout nested inside the rendered
        // content keeps the native click-to-edit behavior.
        if (icon.closest(".callout") !== widget.querySelector(".callout")) {
          return null;
        }
        try {
          const doc = this.view.state.doc;
          const lineNo = doc.lineAt(this.view.posAtDOM(widget, 0)).number;
          return parseCalloutHeader(doc.line(lineNo).text) ? lineNo : null;
        } catch {
          return null;
        }
      };

      /** The source line of the toggle whose triangle this event hit.
       * Obsidian's own Callout fold is view-only in Live Preview — it
       * flips the rendered widget and forgets on reload. A Notion toggle
       * remembers, so the plugin takes the click and rewrites the +/-
       * marker; the widget then re-renders from the note. */
      toggleFoldLine = (evt: Event): number | null => {
        if (!plugin.settings.toggleBlocks) return null;
        const target = evt.target as Element | null;
        // The source-view stand-in sits on the header row itself, so its
        // position resolves directly.
        const mark = target?.closest?.(".nf-toggle-mark");
        if (mark && this.view.contentDOM.contains(mark)) {
          try {
            const doc = this.view.state.doc;
            const lineNo = doc.lineAt(this.view.posAtDOM(mark, 0)).number;
            return parseToggleHeader(doc.line(lineNo).text) ? lineNo : null;
          } catch {
            return null;
          }
        }
        const fold = target?.closest?.(".callout-fold");
        if (!fold || !this.view.contentDOM.contains(fold)) return null;
        const callout = fold.closest<HTMLElement>(".callout");
        if (callout?.dataset.callout?.toLowerCase() !== TOGGLE_TYPE) return null;
        const widget = fold.closest<HTMLElement>(".cm-embed-block.cm-callout");
        if (!widget) return null;
        try {
          const doc = this.view.state.doc;
          // One widget can hold several toggles (a toggle inside a
          // toggle). DOM order and source order are both pre-order, so
          // the clicked triangle's index picks its header line.
          const toggles = Array.from(
            widget.querySelectorAll<HTMLElement>(".callout[data-callout]")
          ).filter((el) => el.dataset.callout?.toLowerCase() === TOGGLE_TYPE);
          const index = toggles.indexOf(callout);
          if (index < 0) return null;
          const start = doc.lineAt(this.view.posAtDOM(widget, 0)).number;
          const block = getBlockRange(doc, start, cachedFences(doc));
          let seen = 0;
          for (let n = start; n <= (block?.endLine ?? start); n++) {
            if (!parseToggleHeader(doc.line(n).text)) continue;
            if (seen === index) return n;
            seen++;
          }
          return null;
        } catch {
          return null;
        }
      };

      /** The columns row whose hover ⋯ button this event hit, or null. */
      colsButtonBlock = (evt: Event): BlockRange | null => {
        if (!plugin.settings.columnLayout) return null;
        const target = evt.target as Element | null;
        const btn = target?.closest?.(".nf-cols-menu");
        if (!btn || !this.view.contentDOM.contains(btn)) return null;
        const widget = btn.closest<HTMLElement>(".cm-embed-block.cm-callout");
        if (!widget) return null;
        try {
          const doc = this.view.state.doc;
          const lineNo = doc.lineAt(this.view.posAtDOM(widget, 0)).number;
          const block = getBlockRange(doc, lineNo, cachedFences(doc));
          if (!block) return null;
          const header = parseCalloutHeader(doc.line(block.startLine).text);
          return header?.type === COLS_TYPE ? block : null;
        } catch {
          return null;
        }
      };

      onMouseDown = (evt: MouseEvent) => {
        if (evt.button !== 0) return;
        const eventTarget = evt.target as Element | null;
        if (eventTarget?.closest?.(".nf-columns-editor")) {
          this.pendingCaret = null;
          return;
        }
        // Pointerdown on a gutter already started the resize. Consume the
        // compatibility mousedown so Obsidian does not expand the widget.
        if (eventTarget?.closest?.(".nf-col-resizer")) {
          evt.preventDefault();
          evt.stopPropagation();
          return;
        }
        // Icon / columns button / toggle triangle: swallow mousedown so
        // the widget never expands or selects itself; the row stays
        // rendered under the menu (or through the fold).
        if (
          this.headerLineForIcon(evt) != null ||
          this.colsButtonBlock(evt) ||
          this.toggleFoldLine(evt) != null
        ) {
          evt.preventDefault();
          evt.stopPropagation();
          return;
        }
        if (
          plugin.settings.columnLayout &&
          !eventTarget?.closest?.(
            "a, button, input, textarea, select, .callout-fold, .nf-col-resizer"
          ) &&
          renderedColumnIndex(eventTarget, this.view, {
            x: evt.clientX,
            y: evt.clientY,
          })
        ) {
          // Keep Obsidian from expanding the whole Callout into linear
          // source. The click phase activates the one-column visual editor.
          evt.preventDefault();
          evt.stopPropagation();
          return;
        }
        // Elsewhere on the widget: let the native handling run, but
        // remember the press so a same-spot click can rewrite the block
        // selection into a caret. Fold chevrons, links, and embedded
        // controls keep their own click behavior.
        this.pendingCaret = null;
        if (!plugin.settings.calloutEditing || evt.detail > 1) return;
        const target = eventTarget;
        if (typeof target?.closest !== "function") return;
        if (
          target.closest(
            ".callout-fold, a, input, button, .nf-cols-menu, .nf-col-resizer"
          )
        ) return;
        const widget = target.closest<HTMLElement>(
          ".cm-embed-block.cm-callout"
        );
        if (!widget || !this.view.contentDOM.contains(widget)) return;
        try {
          const doc = this.view.state.doc;
          const widgetPos = this.view.posAtDOM(widget, 0);
          const lineNo = doc.lineAt(widgetPos).number;
          const block = calloutEditBlocks(
            doc,
            lineNo,
            lineNo,
            cachedFences(doc)
          )[0];
          if (!block) return;
          const from = doc.line(block.startLine).from;
          const to = doc.line(block.endLine).to;
          const renderedCaret = renderedTextCaretAtPoint(
            widget,
            evt.clientX,
            evt.clientY
          );
          const expected = expectedCalloutSourcePos(
            from,
            to,
            widget,
            evt.clientY
          );
          this.pendingCaret = {
            x: evt.clientX,
            y: evt.clientY,
            from,
            to,
            sourcePos: renderedCaret
              ? calloutSourceTextAnchor(
                  doc,
                  block.startLine,
                  block.endLine,
                  renderedCaret.text,
                  renderedCaret.offset,
                  expected
                )
              : null,
            targetY: renderedCaret?.targetY ?? evt.clientY,
          };
        } catch {
          this.pendingCaret = null;
        }
      };

      /** If the press left Obsidian's whole-block selection in place,
       *  replace it with a caret at the click point. */
      resolvePendingCaret = (pending: PendingCalloutCaret): boolean => {
        const pos = this.view.posAtCoords({ x: pending.x, y: pending.y });
        if (pos == null || pos < pending.from || pos > pending.to) return false;
        // A rendered Callout is itself focusable. Merely moving the
        // CodeMirror selection leaves keyboard focus on that widget, so
        // the first typed character can still act on the atomic block.
        // Return focus to the editor before opening the visual source row.
        this.view.focus();
        this.view.dispatch({
          selection: { anchor: pos },
          scrollIntoView: true,
        });
        return true;
      };

      /** Opening source rows can make a table/list several hundred pixels
       * taller. Keep the directly anchored text under the pointer by paying
       * that layout delta in the editor's own scroll container. */
      alignDirectCaret = (pending: PendingCalloutCaret) => {
        const pos = pending.sourcePos;
        if (pos == null || pos > this.view.state.doc.length) return;
        try {
          const coords = this.view.coordsAtPos(pos, 1);
          if (!coords) return;
          const sourceY = (coords.top + coords.bottom) / 2;
          const delta = sourceY - pending.targetY;
          if (Number.isFinite(delta) && Math.abs(delta) >= 0.5) {
            this.view.scrollDOM.scrollTop += delta;
          }
        } catch {
          // A concurrent document replacement can invalidate the captured
          // position. The caret dispatch below already clamps it safely.
        }
      };

      onClick = (evt: MouseEvent) => {
        if (evt.button !== 0) return;
        const eventTarget = evt.target as Element | null;
        if (eventTarget?.closest?.(".nf-columns-editor")) {
          this.pendingCaret = null;
          return;
        }
        const lineNo = this.headerLineForIcon(evt);
        if (lineNo != null) {
          evt.preventDefault();
          evt.stopPropagation();
          openCalloutTypeMenu(this.view, lineNo, evt);
          return;
        }
        const foldLine = this.toggleFoldLine(evt);
        if (foldLine != null) {
          evt.preventDefault();
          evt.stopPropagation();
          this.pendingCaret = null;
          const line = this.view.state.doc.line(foldLine);
          const header = parseToggleHeader(line.text);
          const next =
            header && setToggleCollapsed(line.text, !header.collapsed);
          if (next) {
            this.view.dispatch({
              changes: { from: line.from, to: line.to, insert: next },
              userEvent: "input.toggle-fold",
            });
          }
          return;
        }
        const colsBlock = this.colsButtonBlock(evt);
        if (colsBlock) {
          evt.preventDefault();
          evt.stopPropagation();
          const menu = new Menu().setUseNativeMenu(false);
          addColumnsMenuItems(menu, this.view, colsBlock);
          menu.showAtMouseEvent(evt);
          return;
        }
        const clickTarget = eventTarget;
        if (
          plugin.settings.columnLayout &&
          !clickTarget?.closest?.(
            "a, button, input, textarea, select, .callout-fold, .nf-col-resizer"
          ) &&
          activateRenderedColumn(clickTarget, this.view, {
            x: evt.clientX,
            y: evt.clientY,
          })
        ) {
          evt.preventDefault();
          evt.stopPropagation();
          this.pendingCaret = null;
          return;
        }
        const pending = this.pendingCaret;
        this.pendingCaret = null;
        if (!pending) return;
        // A real drag keeps the native block selection.
        if (
          Math.abs(evt.clientX - pending.x) > 4 ||
          Math.abs(evt.clientY - pending.y) > 4
        ) {
          return;
        }
        // Take ownership before Obsidian's widget click handler can leave
        // the complete Callout selected. A fast first keystroke after such
        // a selection would otherwise replace the whole block. Text clicks
        // already have a stable source anchor; blank padding first expands
        // at a safe boundary and retains the older coordinate fallback.
        evt.preventDefault();
        evt.stopPropagation();
        const doc = this.view.state.doc;
        const win = this.view.dom.ownerDocument.defaultView ?? window;
        if (
          pending.sourcePos != null &&
          pending.sourcePos >= pending.from &&
          pending.sourcePos <= pending.to &&
          pending.sourcePos <= doc.length
        ) {
          // The rendered text node already identified the source character at
          // mousedown time. Do not ask posAtCoords to reinterpret the old
          // clientY after tables/lists expand and move that character away.
          this.view.focus();
          this.view.dispatch({
            selection: EditorSelection.cursor(pending.sourcePos, 1),
          });
          win.requestAnimationFrame(() => this.alignDirectCaret(pending));
          return;
        }

        // Blank padding has no text anchor. Preserve the coordinate fallback
        // for that case: open at a safe source point, then remap once its rows
        // exist in the DOM.
        const startLine = doc.lineAt(pending.from).number;
        const endLine = doc.lineAt(pending.to).number;
        const activation = calloutActivationCursor(doc, startLine, endLine);
        this.view.focus();
        this.view.dispatch({
          // A cursor inside `[!note]` remains clamped to Obsidian's atomic
          // embed. Multi-row blocks open on their first body row; a one-row
          // Callout opens on the visible side of its header token.
          selection: EditorSelection.cursor(
            activation.anchor,
            activation.assoc
          ),
          // This is only a temporary activation point. Scrolling it into
          // view would invalidate the clientX/clientY captured above before
          // the next frame gets a chance to resolve the real click target.
        });
        win.requestAnimationFrame(() => {
          if (this.resolvePendingCaret(pending)) return;
          win.setTimeout(() => this.resolvePendingCaret(pending), 80);
        });
      };

      destroy() {
        this.view.dom.removeEventListener("mousedown", this.onMouseDown, true);
        this.view.dom.removeEventListener("click", this.onClick, true);
      }
    }
  );
}

/** Canonical Callout type → Obsidian theme color variable. */
const CALLOUT_COLOR_VARS: Record<string, string> = {
  note: "--callout-default",
  abstract: "--callout-summary",
  info: "--callout-info",
  todo: "--callout-todo",
  tip: "--callout-tip",
  success: "--callout-success",
  question: "--callout-question",
  warning: "--callout-warning",
  failure: "--callout-fail",
  danger: "--callout-error",
  bug: "--callout-bug",
  example: "--callout-example",
  quote: "--callout-quote",
  // Column structure paints neutral, not "unknown Callout" blue.
  [COLS_TYPE]: "--callout-quote",
  [COL_TYPE]: "--callout-quote",
  // A toggle is prose with a triangle, not a colored box.
  [TOGGLE_TYPE]: "--callout-quote",
};

export interface CalloutEditBlock {
  startLine: number;
  endLine: number;
  colorVar: string;
}

/** Exact Callout interval beginning on a header row. Unlike the broader
 * quote container, this stops when the source leaves the header's own quote
 * depth, so nested Callouts form proper child intervals instead of being
 * flattened into their outer box. */
function calloutRangeFromHeader(
  doc: Text,
  lineNo: number,
  fences: FenceRange[]
): BlockRange | null {
  if (fenceAt(fences, lineNo) || !parseCalloutHeader(doc.line(lineNo).text)) {
    return null;
  }
  const depth = quoteDepth(doc.line(lineNo).text);
  if (depth === 0) return null;
  const outerIndent = indentWidth(doc.line(lineNo).text);
  let endLine = lineNo;
  let siblingStart: number | null = null;
  for (let n = lineNo + 1; n <= doc.lines; n++) {
    const fence = fenceAt(fences, n);
    const rowDepth = fence?.quoteDepth ?? quoteDepth(doc.line(n).text);
    const rowIndent = fence
      ? indentWidth(doc.line(fence.startLine).text)
      : indentWidth(doc.line(n).text);
    if (rowDepth < depth || rowIndent !== outerIndent) break;
    // Two same-depth Callouts separated by a quoted blank row are siblings,
    // not one large outer Callout with the second painted as a child. Keep
    // the separator with the first card, then stop before the next header.
    if (
      rowDepth === depth &&
      parseCalloutHeader(doc.line(n).text) &&
      RE_QUOTE_ONLY.test(doc.line(n - 1).text)
    ) {
      siblingStart = n;
      break;
    }
    endLine = n;
  }

  // A top-level Callout at this indentation may own CommonMark's unmarked
  // lazy paragraph tail. Nested intervals deliberately do not borrow the
  // outer container's tail.
  const quoteGroup = quoteContainerRange(doc, lineNo, fences);
  let shallowestMarkedDepth = Number.POSITIVE_INFINITY;
  if (quoteGroup) {
    for (let n = quoteGroup.startLine; n <= quoteGroup.endLine; n++) {
      const ownFence = fenceAt(fences, n);
      const markedDepth = ownFence?.quoteDepth ?? quoteDepth(doc.line(n).text);
      if (markedDepth > 0) {
        shallowestMarkedDepth = Math.min(shallowestMarkedDepth, markedDepth);
      }
    }
  }
  if (
    quoteGroup?.startLine === lineNo &&
    quoteDepth(doc.line(quoteGroup.startLine).text) === depth &&
    shallowestMarkedDepth === depth
  ) {
    endLine = Math.max(
      endLine,
      siblingStart == null
        ? quoteGroup.endLine
        : Math.min(quoteGroup.endLine, siblingStart - 1)
    );
  }
  return { startLine: lineNo, endLine };
}

/**
 * Callout blocks whose quote lines intersect [fromLine, toLine]. When the
 * caret is inside a Callout, Live Preview swaps the rendered widget for
 * these source lines; the edit plugin re-paints the rendered box on them
 * so entering a Callout doesn't visually collapse it into bare source.
 */
export function calloutEditBlocks(
  doc: Text,
  fromLine: number,
  toLine: number,
  fences: FenceRange[] = cachedFences(doc)
): CalloutEditBlock[] {
  const blocks: CalloutEditBlock[] = [];
  const first = Math.max(1, Math.min(fromLine, doc.lines));
  const last = Math.max(first, Math.min(toLine, doc.lines));
  const startGroup = quoteContainerRange(doc, first, fences);
  const endGroup = quoteContainerRange(doc, last, fences);
  const scanFrom = startGroup?.startLine ?? first;
  const scanTo = endGroup?.endLine ?? last;
  const seen = new Set<string>();

  for (let n = scanFrom; n <= scanTo; n++) {
    const fence = fenceAt(fences, n);
    if (fence) {
      n = fence.endLine;
      continue;
    }
    const header = parseCalloutHeader(doc.line(n).text);
    if (!header) continue;
    const range = calloutRangeFromHeader(doc, n, fences);
    if (!range || range.endLine < first || range.startLine > last) continue;
    const key = `${range.startLine}:${range.endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    blocks.push({
      startLine: range.startLine,
      endLine: range.endLine,
      colorVar: CALLOUT_COLOR_VARS[header.type] ?? "--callout-default",
    });
  }
  return blocks;
}

/**
 * The line span the visual-structure pass must analyse to decorate the
 * viewport correctly.
 *
 * Decorations are only ever emitted for visible lines, so analysing the
 * whole document cost O(document) on every keystroke, caret move and
 * scroll. The window is the visible span widened until both edges sit on a
 * structural boundary, because the membership sets built from it are also
 * consulted for a straddling fence's opening line and for the caption row
 * that may trail the last block:
 *
 *   - an edge inside a fence widens to that whole fence, so a code block
 *     scrolled half out of view still resolves its own header/footer;
 *   - an edge inside a quote container widens to the container, so a
 *     Callout entered from its middle is still recognised as one;
 *   - one trailing line covers a caption row owned by the last block.
 *
 * Gaps between `visibleRanges` (folded regions) are spanned rather than
 * walked separately: the result is a superset, which stays correct, and
 * the gaps are small in practice.
 */
export function visualAnalysisWindow(
  doc: Text,
  ranges: readonly { from: number; to: number }[],
  fences: FenceRange[]
): { fromLine: number; toLine: number } | null {
  if (ranges.length === 0) return null;
  let fromLine = doc.lines;
  let toLine = 1;
  for (const range of ranges) {
    fromLine = Math.min(fromLine, doc.lineAt(range.from).number);
    toLine = Math.max(toLine, doc.lineAt(range.to).number);
  }
  const startFence = fenceAt(fences, fromLine);
  if (startFence) fromLine = Math.min(fromLine, startFence.startLine);
  // A viewport may begin on CommonMark's marker-less lazy continuation of
  // a quote paragraph. quoteContainerRange() cannot start from that row,
  // but getBlockRange() still resolves it to the owning quote/Callout.
  const startBlock = getBlockRange(doc, fromLine, fences);
  if (startBlock) fromLine = Math.min(fromLine, startBlock.startLine);
  const startContainer = quoteContainerRange(doc, fromLine, fences);
  if (startContainer) fromLine = Math.min(fromLine, startContainer.startLine);

  const endFence = fenceAt(fences, toLine);
  if (endFence) toLine = Math.max(toLine, endFence.endLine);
  const endBlock = getBlockRange(doc, toLine, fences);
  if (endBlock) toLine = Math.max(toLine, endBlock.endLine);
  const endContainer = quoteContainerRange(doc, toLine, fences);
  if (endContainer) toLine = Math.max(toLine, endContainer.endLine);

  return {
    fromLine: Math.max(1, fromLine),
    toLine: Math.min(doc.lines, toLine + 1),
  };
}

/** The triangle that stands in for "[!nf-toggle]±" while the caret is
 *  elsewhere in the block, so editing a toggle's body still looks like a
 *  toggle. Clicking it folds, exactly like the rendered one. */
class ToggleMarkWidget extends WidgetType {
  constructor(readonly collapsed: boolean) {
    super();
  }

  eq(other: ToggleMarkWidget) {
    return other.collapsed === this.collapsed;
  }

  toDOM(view: EditorView) {
    const el = view.dom.ownerDocument.createElement("span");
    el.className = "nf-toggle-mark" + (this.collapsed ? " is-collapsed" : "");
    setIcon(el, "chevron-down");
    return el;
  }

  ignoreEvent() {
    return false;
  }
}

type VisualStructureKind = "quote" | "callout";

/** Stable inline space standing in for structural quote markers. Keeping
 * the gap as a widget (rather than merely making `>` transparent) prevents
 * the text column and caret geometry from changing when Live Preview swaps
 * a rendered block for editable lines. */
class VisualStructureGapWidget extends WidgetType {
  constructor(
    readonly kind: VisualStructureKind,
    readonly depth: number,
    /** Row inside a fenced block within an open Callout. Such a row must
     *  clear the Callout's content inset AND the code card's own text
     *  padding, because the rendered block indents its code by both. The gap
     *  is what actually positions the text — padding on the line does not,
     *  since the widget is the line's first inline box. */
    readonly insideCode = false,
    /** Number of actual Callout boxes in this prefix. Any remaining quote
     * levels use the narrower blockquote inset instead. */
    readonly calloutDepth = kind === "callout" ? 1 : 0,
    /** Quote levels OUTSIDE the outermost Callout. The rest are a plain
     * quote nested inside it, which the box indents like the rendered one
     * does. Left unset, every extra level counts as outer — the shape this
     * widget saw before nesting inside a Callout was distinguished. */
    readonly outerDepth: number | null = null
  ) {
    super();
  }

  eq(other: VisualStructureGapWidget) {
    return (
      other.kind === this.kind &&
      other.depth === this.depth &&
      other.insideCode === this.insideCode &&
      other.calloutDepth === this.calloutDepth &&
      other.outerDepth === this.outerDepth
    );
  }

  toDOM(view: EditorView) {
    const el = view.dom.ownerDocument.createElement("span");
    el.className =
      `nf-visual-prefix nf-${this.kind}-prefix` +
      (this.insideCode ? " is-code" : "");
    const depth = Math.max(1, this.depth);
    const callouts = Math.max(0, Math.min(depth, this.calloutDepth));
    const outer = Math.max(
      0,
      Math.min(depth - callouts, this.outerDepth ?? depth - callouts)
    );
    el.style.setProperty("--nf-prefix-depth", String(depth));
    el.style.setProperty("--nf-prefix-callout-depth", String(callouts));
    el.style.setProperty("--nf-prefix-outer-depth", String(outer));
    el.style.setProperty(
      "--nf-prefix-inner-depth",
      String(Math.max(0, depth - callouts - outer))
    );
    el.setAttribute("aria-hidden", "true");
    return el;
  }
}

/** Notion-style Callout lead: the persisted `[!type]` token remains the
 * source of truth but is represented by its icon (and the default label
 * when the note has no custom title). */
class VisualCalloutLeadWidget extends WidgetType {
  constructor(
    readonly type: string,
    readonly showDefaultTitle: boolean,
    readonly quoteDepth = 1,
    readonly calloutDepth = 1
  ) {
    super();
  }

  eq(other: VisualCalloutLeadWidget) {
    return (
      other.type === this.type &&
      other.showDefaultTitle === this.showDefaultTitle &&
      other.quoteDepth === this.quoteDepth &&
      other.calloutDepth === this.calloutDepth
    );
  }

  toDOM(view: EditorView) {
    const el = view.dom.ownerDocument.createElement("span");
    el.className =
      "nf-visual-callout-lead" +
      (this.showDefaultTitle ? " has-default-title" : "");
    el.dataset.callout = this.type;
    const depth = Math.max(1, this.quoteDepth);
    const callouts = Math.max(1, Math.min(depth, this.calloutDepth));
    el.style.setProperty("--nf-prefix-depth", String(depth));
    el.style.setProperty("--nf-prefix-callout-depth", String(callouts));
    // A header row IS the Callout's own marker, so nothing quotes it from
    // the inside: every remaining level is outer.
    el.style.setProperty(
      "--nf-prefix-outer-depth",
      String(Math.max(0, depth - callouts))
    );
    el.style.setProperty("--nf-prefix-inner-depth", "0");

    const icon = el.createSpan({
      cls: "callout-icon",
      attr: {
        role: "button",
        // aria-label only. Obsidian renders it as a styled tooltip, so a
        // matching `title` would stack the browser's native tooltip on top
        // of Obsidian's and show the same words twice.
        "aria-label": t("Change callout type"),
      },
    });
    const entry = CALLOUT_TYPES.find((candidate) => candidate.type === this.type);
    setIcon(icon, entry?.icon ?? "message-square");

    if (this.showDefaultTitle) {
      el.createSpan({
        cls: "nf-visual-callout-default-title",
        text: t(entry?.label ?? this.type),
      });
    }
    return el;
  }

  ignoreEvent(event: Event) {
    return event.type !== "mousedown" && event.type !== "click";
  }
}

/** Compact language/fold control standing in for an opening code fence.
 * Language remains editable in Source mode; folding is persisted in the
 * portable caption row immediately after the block. */
class VisualCodeFenceWidget extends WidgetType {
  constructor(
    readonly plugin: NotionFlowPlugin,
    readonly language: string,
    readonly startLine: number,
    readonly collapsed: boolean
  ) {
    super();
  }

  eq(other: VisualCodeFenceWidget) {
    return (
      other.language === this.language &&
      other.startLine === this.startLine &&
      other.collapsed === this.collapsed
    );
  }

  toDOM(view: EditorView) {
    const el = view.dom.ownerDocument.createElement("span");
    el.className =
      "nf-visual-code-fence" + (this.collapsed ? " is-collapsed" : "");
    const fold = el.createEl("button", {
      cls: "nf-code-fold-toggle",
      attr: {
        type: "button",
        "aria-label": t(this.collapsed ? "Expand code block" : "Collapse code block"),
        "aria-expanded": String(!this.collapsed),
      },
    });
    setIcon(fold, "chevron-down");
    fold.addEventListener("mousedown", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
    });
    fold.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const doc = view.state.doc;
      const fence = cachedFences(doc).find(
        (candidate) => candidate.startLine === this.startLine
      );
      if (!fence) return;
      const current = codeCaptionMeta(doc, fence);
      setBlockCaptionMeta(
        view,
        "code",
        fence.startLine,
        current?.caption ?? "",
        !this.collapsed,
        true
      );
    });
    const icon = el.createSpan({ cls: "nf-visual-code-icon" });
    setIcon(icon, "code-2");
    // The chip stands in for the whole "```lang" token, so the language is
    // not otherwise reachable in Live Preview: the label has to BE the
    // control that changes it.
    const label = el.createEl("button", {
      cls: "nf-visual-code-language",
      text: this.language || t("Code"),
      attr: { type: "button", "aria-label": t("Change language") },
    });
    label.addEventListener("mousedown", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
    });
    label.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      openCodeLanguageMenu(this.plugin, view, this.startLine, evt);
    });
    // Reading view gets Obsidian's own copy button; Live Preview never did,
    // so the only way to lift code out of a note being edited was to select
    // it by hand — across rows whose quote markers are hidden widgets.
    const copy = el.createEl("button", {
      cls: "nf-code-copy",
      attr: { type: "button", "aria-label": t("Copy code") },
    });
    setIcon(copy, "copy");
    copy.addEventListener("mousedown", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
    });
    copy.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const fence = cachedFences(view.state.doc).find(
        (candidate) => candidate.startLine === this.startLine
      );
      if (!fence) return;
      navigator.clipboard
        .writeText(fenceBodyText(view.state.doc, fence))
        .then(() => {
          // The chip is a widget: it is rebuilt on the next update, so the
          // acknowledgement rides on the element only until then.
          copy.classList.add("is-copied");
          setIcon(copy, "check");
          new Notice(t("Code copied."));
        })
        .catch(() => new Notice(t("Could not write to the clipboard.")));
    });
    return el;
  }

  ignoreEvent() {
    return false;
  }
}

/** Retype a fence's language, leaving the rest of its info string alone. */
function setFenceLanguage(view: EditorView, startLine: number, language: string) {
  const plan = fenceLanguagePlan(view.state.doc, startLine, language);
  if (!plan) return;
  view.dispatch({ changes: plan, userEvent: "input.code-language" });
}

function openCodeLanguageMenu(
  plugin: NotionFlowPlugin,
  view: EditorView,
  startLine: number,
  evt: MouseEvent
) {
  const current = fenceLanguageSpan(view.state.doc, startLine)?.language ?? "";
  const known = CODE_LANGUAGES.some((entry) => entry.id === current.toLowerCase());
  const menu = new Menu().setUseNativeMenu(false);
  menu.addItem((item) =>
    item
      .setTitle(t("No language"))
      .setChecked(!current)
      .onClick(() => setFenceLanguage(view, startLine, ""))
  );
  menu.addSeparator();
  for (const entry of CODE_LANGUAGES) {
    menu.addItem((item) =>
      item
        .setTitle(entry.label)
        .setChecked(current.toLowerCase() === entry.id)
        .onClick(() => setFenceLanguage(view, startLine, entry.id))
    );
  }
  menu.addSeparator();
  menu.addItem((item) =>
    item
      // A language already set but missing from the list is checked here,
      // so the menu never shows a block as having no language when it has
      // one it simply does not list.
      .setTitle(t("Other language…"))
      .setIcon("pencil")
      .setChecked(!!current && !known)
      .onClick(() =>
        new TextPromptModal(plugin.app, {
          title: t("Code block language"),
          placeholder: t("For example: kotlin"),
          initial: current,
          onSave: (value) => setFenceLanguage(view, startLine, value.trim()),
        }).open()
      )
  );
  menu.showAtMouseEvent(evt);
}

class VisualCodeFenceEndWidget extends WidgetType {
  eq(other: VisualCodeFenceEndWidget) {
    return other instanceof VisualCodeFenceEndWidget;
  }

  toDOM(view: EditorView) {
    const el = view.dom.ownerDocument.createElement("span");
    el.className = "nf-visual-code-fence-end";
    el.setAttribute("aria-hidden", "true");
    return el;
  }
}

/** Clickable visual caption in place of its portable <small> source row. */
class VisualBlockCaptionWidget extends WidgetType {
  constructor(
    readonly plugin: NotionFlowPlugin,
    readonly kind: BlockCaptionKind,
    readonly ownerLine: number,
    readonly caption: string,
    readonly collapsed = false,
    readonly language = ""
  ) {
    super();
  }

  eq(other: VisualBlockCaptionWidget) {
    return (
      other.kind === this.kind &&
      other.ownerLine === this.ownerLine &&
      other.caption === this.caption &&
      other.collapsed === this.collapsed &&
      other.language === this.language
    );
  }

  toDOM(view: EditorView) {
    const el = view.dom.ownerDocument.createElement("span");
    el.className = `nf-block-caption nf-${this.kind}-caption`;
    if (this.kind === "code" && this.collapsed) {
      el.classList.add("is-code-collapsed");
      const fold = el.createEl("button", {
        cls: "nf-code-fold-toggle",
        attr: {
          type: "button",
          "aria-label": t("Expand code block"),
          "aria-expanded": "false",
        },
      });
      setIcon(fold, "chevron-right");
      fold.addEventListener("mousedown", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
      });
      fold.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        setBlockCaptionMeta(
          view,
          "code",
          this.ownerLine,
          this.caption,
          false,
          true
        );
      });
      const icon = el.createSpan({ cls: "nf-visual-code-icon" });
      setIcon(icon, "code-2");
      el.createSpan({
        cls: "nf-visual-code-language",
        text: this.language || t("Code"),
      });
    }
    const text = el.createSpan({ cls: "nf-caption-text" });
    text.setAttribute("role", "button");
    text.setAttribute("tabindex", "0");
    text.setAttribute("aria-label", t("Edit caption"));
    text.setAttribute("title", t("Edit caption"));
    text.textContent = this.caption || t("Add caption");
    if (!this.caption) text.classList.add("is-empty");
    const open = (evt: Event) => {
      evt.preventDefault();
      evt.stopPropagation();
      editBlockCaption(this.plugin, view, this.kind, this.ownerLine);
    };
    text.addEventListener("mousedown", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
    });
    text.addEventListener("click", open);
    text.addEventListener("keydown", (evt) => {
      if ((evt as KeyboardEvent).key === "Enter") open(evt);
    });
    return el;
  }

  ignoreEvent() {
    return false;
  }
}

/** A selection range reduced to the line numbers it spans. */
interface SelectionLineSpan {
  first: number;
  last: number;
}

/** Resolve each selection range to line numbers once per pass. The visual
 * pass asks "does the selection touch this block?" for every Callout and
 * fence it considers, and doc.lineAt() is a tree descent — recomputing it
 * per question made the answer cost scale with the number of blocks. */
function selectionLineSpans(
  doc: Text,
  ranges: readonly { from: number; to: number }[]
): SelectionLineSpan[] {
  return ranges.map((range) => {
    // CodeMirror ranges are half-open. A selection ending exactly at the
    // next row's `from` does not touch that row; treating `to` as inclusive
    // made selecting the paragraph above a Callout expand the Callout too.
    const lastPos = range.to > range.from ? range.to - 1 : range.to;
    return {
      first: doc.lineAt(range.from).number,
      last: doc.lineAt(Math.max(range.from, lastPos)).number,
    };
  });
}

function selectionTouchesLines(
  spans: readonly SelectionLineSpan[],
  startLine: number,
  endLine: number
): boolean {
  return spans.some((span) => span.first <= endLine && span.last >= startLine);
}

/** Character range occupied by a fence's structural opener/closer. Literal
 * list indentation stays outside the range so nested blocks retain their
 * exact text column. */
export function fenceVisualTokenRange(
  doc: Text,
  fence: FenceRange,
  closing: boolean
): { from: number; to: number; language: string } | null {
  const line = doc.line(closing ? fence.endLine : fence.startLine);
  if (closing && !fence.closed) return null;
  const parts = fenceLineParts(line.text);
  if (!parts) return null;
  // A list marker belongs to its item, not to the fence: leaving it outside
  // the token keeps the bullet drawn and the block in its content column.
  // Quote markers are the opposite — the structural gap widget already
  // stands in for them, so the token starts before them.
  const ch = parts.outerListMarker
    ? parts.ws.length + parts.outerListMarker.length
    : parts.listMarker
      ? parts.ws.length +
        parts.quotePrefix.length +
        parts.innerWs.length +
        parts.listMarker.length
      : parts.ws.length;
  return {
    from: line.from + ch,
    to: line.to,
    language: closing ? "" : parts.info.trim(),
  };
}

/**
 * The languages the code chip's menu offers, in the order it lists them.
 *
 * Deliberately a short list of common ones rather than every language
 * Prism can highlight: the menu is a shortcut, and anything missing is
 * still typable through "Other language…", which accepts any info string.
 */
export const CODE_LANGUAGES: { id: string; label: string }[] = [
  { id: "bash", label: "Bash" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "csharp", label: "C#" },
  { id: "css", label: "CSS" },
  { id: "go", label: "Go" },
  { id: "html", label: "HTML" },
  { id: "java", label: "Java" },
  { id: "javascript", label: "JavaScript" },
  { id: "json", label: "JSON" },
  { id: "markdown", label: "Markdown" },
  { id: "mermaid", label: "Mermaid" },
  { id: "python", label: "Python" },
  { id: "rust", label: "Rust" },
  { id: "sql", label: "SQL" },
  { id: "typescript", label: "TypeScript" },
  { id: "yaml", label: "YAML" },
];

/**
 * The language token on a fence's opening line: the FIRST word of the info
 * string, which is the part Obsidian highlights by.
 *
 * `only` records whether that word is the whole info string — a fence
 * written as "```js title=x" keeps everything after the language when the
 * language is replaced, and gives up its padding only when there is
 * nothing else to hold.
 */
export function fenceLanguageSpan(
  doc: Text,
  startLine: number
): { from: number; to: number; infoFrom: number; language: string; only: boolean } | null {
  if (startLine < 1 || startLine > doc.lines) return null;
  const line = doc.line(startLine);
  const parts = fenceLineParts(line.text);
  if (!parts) return null;
  const infoFrom = line.to - parts.info.length;
  const trimmed = parts.info.trimStart();
  const language = trimmed.split(/\s+/, 1)[0] ?? "";
  const from = infoFrom + (parts.info.length - trimmed.length);
  return {
    from,
    to: from + language.length,
    infoFrom,
    language,
    only: trimmed.length === language.length,
  };
}

/** The edit that retypes a fence's language, or null when it already reads
 *  that way. An empty `language` clears it. */
export function fenceLanguagePlan(
  doc: Text,
  startLine: number,
  language: string
): { from: number; to: number; insert: string } | null {
  const span = fenceLanguageSpan(doc, startLine);
  if (!span || span.language === language) return null;
  // With nothing else in the info string, the whole of it is replaced, so
  // clearing a language cannot leave "``` " behind and setting one on a
  // fence written "```  " cannot push it away from the marker.
  const from = span.only || !span.language ? span.infoFrom : span.from;
  const to = span.only ? doc.line(startLine).to : span.to;
  return { from, to, insert: language };
}

/**
 * Where a RENDERED Callout puts its own content, in px relative to the
 * Callout box. Every value is theme-defined — Obsidian's default moves the
 * padding off `.callout` and onto its title/content children, and snippets
 * move it again — so these cannot be computed, only measured.
 *
 * Edit mode previously hardcoded them (a 22px prefix gap, blockquote-derived
 * card insets), which is why opening a Callout shifted its body 15px left
 * and let a nested code block span the full editor width.
 */
export interface CalloutMetrics {
  /** Body text column. Drives the prefix gap AND the code card's leading
   *  edge, which a rendered Callout puts on that same column. */
  contentInset: number;
  /** Nested code card's inset from the Callout's trailing edge. */
  codeEnd: number;
  /** The card's own text padding, so code lands in the same column. */
  codePad: number;
  /** Space a rendered Callout leaves above/below a nested code block. */
  codeGap: number;
  /** The Callout's own air above its first row and below its last one. Kept
   *  free of the first/last child's own margin so it composes with the
   *  per-block gaps (codeGap) exactly the way the rendered box stacks them. */
  topAir: number;
  bottomAir: number;
}

/** Plausible px inset; rejects a mid-layout or collapsed measurement. */
function saneInset(value: number, max = 200): boolean {
  return Number.isFinite(value) && value >= 0 && value <= max;
}

/**
 * Measure the geometry off a Callout that Obsidian has actually rendered in
 * this editor.
 *
 * Measuring the real thing rather than a synthetic probe means the numbers
 * come from whatever the theme, snippets and font settings really produce,
 * with no second element to keep in sync and nothing inserted into
 * CodeMirror's managed DOM. A rendered Callout is available exactly when it
 * is needed: every Callout in the note is rendered until the caret enters
 * one, and the others stay rendered while it is open. Results are merged
 * into the previous measurement, so a note whose only Callout is currently
 * open keeps the column it was last seen with.
 */
export function measureCalloutMetrics(
  view: EditorView,
  previous: CalloutMetrics | null
): CalloutMetrics | null {
  // The plugin's own structural Callouts (column scaffolding, toggles) are
  // deliberately styled with different padding, so measuring one would
  // publish the wrong column for ordinary Callouts.
  const structural = new Set<string>([COLS_TYPE, COL_TYPE, TOGGLE_TYPE]);
  const callouts = Array.from(
    view.contentDOM.querySelectorAll<HTMLElement>(".callout")
  ).filter(
    (el) =>
      !structural.has(el.dataset.callout ?? "") &&
      el.getBoundingClientRect().width > 0
  );
  if (callouts.length === 0) return null;

  const next: CalloutMetrics = previous
    ? { ...previous }
    : {
        // Matches the polished Callout CSS before a rendered probe is
        // available (38px content padding + 1px border, 14px + border at
        // the trailing edge, and the card's 16px text padding).
        contentInset: 39,
        codeEnd: 15,
        codePad: 16,
        codeGap: 17,
        topAir: 11,
        bottomAir: 13,
      };
  let learned = false;

  // Prefer the content box's own logical padding: unlike a paragraph probe,
  // it also exists in list-only, table-only and code-only Callouts. Fall back
  // to a paragraph rect for older themes/test doubles that do not expose
  // logical padding through getComputedStyle().
  for (const callout of callouts) {
    const boxRect = callout.getBoundingClientRect();
    const content = callout.querySelector<HTMLElement>(
      ":scope > .callout-content"
    );
    const contentRect = content?.getBoundingClientRect();
    const contentStyle = content ? getComputedStyle(content) : null;
    const padStart = Number.parseFloat(
      contentStyle?.paddingInlineStart ?? contentStyle?.paddingLeft ?? ""
    );
    const padEnd = Number.parseFloat(
      contentStyle?.paddingInlineEnd ?? contentStyle?.paddingRight ?? ""
    );
    const para = callout.querySelector<HTMLElement>(".callout-content p");
    const inset =
      contentRect && Number.isFinite(padStart)
        ? contentRect.left - boxRect.left + padStart
        : para
          ? para.getBoundingClientRect().left - boxRect.left
          : Number.NaN;
    if (saneInset(inset)) {
      next.contentInset = inset;
      learned = true;
    }
    if (contentRect && Number.isFinite(padEnd)) {
      const end = boxRect.right - contentRect.right + padEnd;
      if (saneInset(end)) {
        // The rendered code card and ordinary content share this trailing
        // column in the polished Callout layout.
        next.codeEnd = end;
        learned = true;
      }
    }
    if (saneInset(inset)) break;
  }

  const body = callouts[0];
  const bodyRect = body.getBoundingClientRect();

  // Vertical air, measured the same way and for the same reason as the
  // horizontal insets: Obsidian's default puts 12px on `.callout` while edit
  // mode long assumed 8px, so an opened Callout sat visibly tighter than the
  // box it replaced. Themes move this padding onto the title/content children,
  // so read it off the rows rather than off `.callout`'s own style.
  const title = body.querySelector<HTMLElement>(":scope > .callout-title");
  const content = body.querySelector<HTMLElement>(":scope > .callout-content");
  // The first/last child's own margin is deliberately excluded: it belongs to
  // that block, not to the Callout, and edit mode adds it back per block (a
  // fence contributes codeGap). Keeping the two separate is what lets the
  // rendered stack — padding + block margin — be reproduced instead of
  // double-counted.
  const outerMargin = (el: HTMLElement, side: "Top" | "Bottom") => {
    const raw = Number.parseFloat(getComputedStyle(el)[`margin${side}`]);
    return Number.isFinite(raw) ? Math.max(0, raw) : 0;
  };
  const firstRow = title ?? (content?.firstElementChild as HTMLElement | null);
  if (firstRow) {
    const paddingTop = Number.parseFloat(getComputedStyle(firstRow).paddingTop);
    const air =
      firstRow.getBoundingClientRect().top -
      bodyRect.top -
      outerMargin(firstRow, "Top") +
      (Number.isFinite(paddingTop) ? paddingTop : 0);
    if (saneInset(air, 60)) {
      next.topAir = air;
      learned = true;
    }
  }
  // A collapsed Callout has no content element; the previous measurement then
  // stands, which is the same merge rule the insets use.
  const lastRow = content?.lastElementChild as HTMLElement | null;
  if (lastRow) {
    const air =
      bodyRect.bottom -
      lastRow.getBoundingClientRect().bottom -
      outerMargin(lastRow, "Bottom");
    if (saneInset(air, 60)) {
      next.bottomAir = air;
      learned = true;
    }
  }

  // Code geometry needs a Callout that actually contains a fenced block.
  for (const callout of callouts) {
    const pre = callout.querySelector<HTMLElement>("pre");
    const code = pre?.querySelector<HTMLElement>("code");
    if (!pre || !code) continue;
    const boxRect = callout.getBoundingClientRect();
    const preRect = pre.getBoundingClientRect();
    if (preRect.width <= 0) continue;
    // `start` is measured only to reject a block that is not laid out where
    // a rendered Callout would put it; the card's own leading edge comes
    // from contentInset, which the two states already agree on.
    const start = preRect.left - boxRect.left;
    const end = boxRect.right - preRect.right;
    const pad = code.getBoundingClientRect().left - preRect.left;
    const gap = Number.parseFloat(getComputedStyle(pre).marginTop);
    if (!saneInset(start) || !saneInset(end) || !saneInset(pad)) continue;
    next.codeEnd = end;
    next.codePad = pad;
    // A theme may pull the block up with a negative margin; clamp rather
    // than reject, since the insets above are still good.
    next.codeGap = Number.isFinite(gap) ? Math.max(0, gap) : 0;
    learned = true;
    break;
  }

  return learned ? next : null;
}

/** Publish the measured geometry as CSS variables the edit-mode rules read.
 *  Written on contentDOM so every row inherits one consistent column. */
function applyCalloutMetrics(view: EditorView, metrics: CalloutMetrics) {
  const style = view.contentDOM.style;
  style.setProperty("--nf-co-inset", `${metrics.contentInset}px`);
  style.setProperty("--nf-co-code-end", `${metrics.codeEnd}px`);
  style.setProperty("--nf-co-code-pad", `${metrics.codePad}px`);
  style.setProperty("--nf-co-code-gap", `${metrics.codeGap}px`);
  style.setProperty("--nf-co-top", `${metrics.topAir}px`);
  style.setProperty("--nf-co-bottom", `${metrics.bottomAir}px`);
}

/** Line decorations that keep an expanded (source-mode) Callout looking
 *  like its rendered box: type-colored background, rounded first/last
 *  rows, and a colored title line. Structural markers are replaced with
 *  stable visual tokens so entering the block never reveals Markdown. */
/** Exported for tests: the decoration pass is the whole of what a block
 *  looks like while it is being edited, and the ranges it produces have to
 *  be checkable without an Obsidian window. */
export function makeCalloutEditPlugin(plugin: NotionFlowPlugin) {
  return ViewPlugin.fromClass(
    class CalloutEditView {
      decorations: DecorationSet;
      /** Header replacements are structural atoms: arrows and pointer
       * placement must land on the visible title side, never inside the
       * hidden `> [!type] ` source token. */
      hidden: DecorationSet = Decoration.none;
      /** Last published geometry, so an unchanged remeasure writes nothing. */
      private metrics: CalloutMetrics | null = null;
      private measuredWidth = -1;

      constructor(view: EditorView) {
        this.decorations = this.build(view);
        this.syncMetrics(view);
      }

      update(update: ViewUpdate) {
        // The toggle triangle stands down on the row holding the caret,
        // so a plain cursor move has to rebuild too.
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = this.build(update.view);
        }
        // A rendered Callout can appear or disappear on any of these, and
        // the insets change when the pane resizes. Reading a few rects is
        // cheap, but it is still gated below so a settled editor does no
        // work per keystroke.
        if (
          update.geometryChanged ||
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          !this.metrics
        ) {
          this.syncMetrics(
            update.view,
            update.geometryChanged ||
              update.docChanged ||
              update.viewportChanged ||
              update.selectionSet
          );
        }
      }

      syncMetrics(view: EditorView, force = false) {
        if (!plugin.settings.calloutEditing || !isLivePreviewEditor(view)) return;
        const width = view.contentDOM.clientWidth;
        // A settled editor at the same width needs no work. Document,
        // viewport, selection and geometry changes force a new sample: they
        // can reveal a better candidate Callout or change theme/font metrics
        // without changing the pane width.
        if (!force && width === this.measuredWidth && this.metrics) return;
        const next = measureCalloutMetrics(view, this.metrics);
        if (!next) return;
        this.measuredWidth = width;
        this.metrics = next;
        applyCalloutMetrics(view, next);
      }

      build(view: EditorView): DecorationSet {
        this.hidden = Decoration.none;
        if (
          (!plugin.settings.calloutEditing &&
            !plugin.settings.codeBlockEditing) ||
          !isLivePreviewEditor(view)
        ) {
          return Decoration.none;
        }
        const doc = view.state.doc;
        const fences = cachedFences(doc);
        const window = visualAnalysisWindow(doc, view.visibleRanges, fences);
        if (!window) return Decoration.none;
        const selections = selectionLineSpans(doc, view.state.selection.ranges);
        // Only consulted for rows inside the window, so clamp it there:
        // a select-all would otherwise allocate one entry per document
        // line on every subsequent rebuild.
        const caretLines = new Set<number>();
        for (const span of selections) {
          const first = Math.max(span.first, window.fromLine);
          const last = Math.min(span.last, window.toLine);
          for (let n = first; n <= last; n++) caretLines.add(n);
        }
        // Rows holding a bare caret (no selected text). A sweep across the
        // block is deliberately excluded: revealing rows mid-drag would
        // reflow the very block being selected.
        const bareCaretLines = new Set<number>();
        for (const range of view.state.selection.ranges) {
          if (!range.empty) continue;
          const lineNo = doc.lineAt(range.head).number;
          if (lineNo >= window.fromLine && lineNo <= window.toLine) {
            bareCaretLines.add(lineNo);
          }
        }
        // Scoped to the analysis window, not the document: this runs on
        // every keystroke and caret move, so it must cost viewport-size.
        const allCallouts = plugin.settings.calloutEditing
          ? calloutEditBlocks(doc, window.fromLine, window.toLine, fences)
          : [];
        const calloutLines = new Set<number>();
        for (const block of allCallouts) {
          for (let n = block.startLine; n <= block.endLine; n++) {
            calloutLines.add(n);
          }
        }
        const activeCallouts = allCallouts.filter(
          (block) => {
            const type = parseCalloutHeader(
              doc.line(block.startLine).text
            )?.type;
            return (
              type !== COLS_TYPE &&
              type !== COL_TYPE &&
              selectionTouchesLines(
                selections,
                block.startLine,
                block.endLine
              )
            );
          }
        );
        const activeCalloutLines = new Set<number>();
        for (const block of activeCallouts) {
          for (let n = block.startLine; n <= block.endLine; n++) {
            activeCalloutLines.add(n);
          }
        }
        const typeOfCallout = (block: CalloutEditBlock) =>
          parseCalloutHeader(doc.line(block.startLine).text)?.type;
        const visibleCallouts = allCallouts.filter(
          (block) =>
            block.startLine <= window.toLine &&
            block.endLine >= window.fromLine
        );
        // Columns are rendered by their dedicated projection editor. They
        // remain in calloutLines for ownership/caption decisions, but never
        // become another painted Callout layer here.
        const layeredCallouts = visibleCallouts.filter((block) => {
          const type = typeOfCallout(block);
          return type !== COLS_TYPE && type !== COL_TYPE;
        });
        // Opening an outer Callout exposes the source rows of every child
        // Callout too. Paint those descendants even when the caret is not
        // inside the child itself, or the inner box collapses into raw rows.
        const visualCallouts = layeredCallouts.filter((candidate) =>
          activeCallouts.some(
            (active) =>
              candidate.startLine >= active.startLine &&
              candidate.endLine <= active.endLine
          )
        );
        const sameCallout = (
          a: CalloutEditBlock,
          b: CalloutEditBlock
        ) => a.startLine === b.startLine && a.endLine === b.endLine;
        const isVisualCallout = (candidate: CalloutEditBlock) =>
          visualCallouts.some((visual) => sameCallout(visual, candidate));
        const firstContentLines = new Set<number>();
        for (const block of visualCallouts) {
          for (let n = block.startLine + 1; n <= block.endLine; n++) {
            if (RE_QUOTE_ONLY.test(doc.line(n).text)) continue;
            firstContentLines.add(n);
            break;
          }
        }
        const visualCalloutDepthAt = (lineNo: number) =>
          visualCallouts.filter(
            (candidate) =>
              lineNo >= candidate.startLine && lineNo <= candidate.endLine
          ).length;
        /** Quote levels outside the outermost open Callout on this row, or
         * null where no Callout owns it and every level is a plain quote. */
        const outerQuoteDepthAt = (lineNo: number): number | null => {
          const containers = visualCallouts.filter(
            (candidate) =>
              lineNo >= candidate.startLine && lineNo <= candidate.endLine
          );
          if (containers.length === 0) return null;
          const outermost = containers.reduce((best, candidate) =>
            quoteDepth(doc.line(candidate.startLine).text) <
            quoteDepth(doc.line(best.startLine).text)
              ? candidate
              : best
          );
          return Math.max(
            0,
            quoteDepth(doc.line(outermost.startLine).text) - 1
          );
        };
        const visualFences = plugin.settings.codeBlockEditing
          ? fences.filter(
              (fence) => {
                const visible =
                  fence.startLine <= window.toLine &&
                  fence.endLine >= window.fromLine;
                return (
                  visible &&
                  (
                    !calloutLines.has(fence.startLine) ||
                    selectionTouchesLines(
                      selections,
                      fence.startLine,
                      fence.endLine
                    ) ||
                    activeCallouts.some(
                      (block) =>
                        fence.startLine >= block.startLine &&
                        fence.endLine <= block.endLine
                    )
                  )
                );
              }
            )
          : [];
        const visualFenceLines = new Set<number>();
        for (const fence of visualFences) {
          for (let n = fence.startLine; n <= fence.endLine; n++) {
            visualFenceLines.add(n);
          }
        }
        // Several semantic layers contribute ranges (Callout chrome, plain
        // quotes, then fences). Collect first and let Decoration.set sort;
        // RangeSetBuilder would require those independent walks to be
        // manually interleaved by source position.
        const visualRanges: Range<Decoration>[] = [];
        const hiddenRanges: Range<Decoration>[] = [];
        const builder = {
          add(from: number, to: number, decoration: Decoration) {
            visualRanges.push(decoration.range(from, to));
          },
        };
        if (plugin.settings.calloutEditing) {
          for (let n = window.fromLine; n <= window.toLine; n++) {
            const containing = layeredCallouts.filter(
              (block) => n >= block.startLine && n <= block.endLine
            );
            if (containing.length === 0) continue;
            const block = containing.reduce((best, candidate) => {
              const bestDepth = quoteDepth(doc.line(best.startLine).text);
              const candidateDepth = quoteDepth(
                doc.line(candidate.startLine).text
              );
              if (candidateDepth !== bestDepth) {
                return candidateDepth > bestDepth ? candidate : best;
              }
              const bestSpan = best.endLine - best.startLine;
              const candidateSpan = candidate.endLine - candidate.startLine;
              return candidateSpan < bestSpan ? candidate : best;
            });
            const visualContainers = visualCallouts.filter(
              (candidate) =>
                n >= candidate.startLine && n <= candidate.endLine
            );
            const calloutDepth = Math.max(1, visualContainers.length);
            const parentBlock = visualContainers
              .filter((candidate) => !sameCallout(candidate, block))
              .reduce<CalloutEditBlock | null>((best, candidate) => {
                if (!best) return candidate;
                const bestDepth = quoteDepth(doc.line(best.startLine).text);
                const candidateDepth = quoteDepth(
                  doc.line(candidate.startLine).text
                );
                return candidateDepth > bestDepth ? candidate : best;
              }, null);
            const line = doc.line(n);
            const prefix = quoteMarkerPrefix(line.text);
            const rawQuoteDepth = quotePrefixDepth(prefix ?? "");
            // The outermost box this row sits in decides how many of its
            // ">" levels are OUTSIDE the Callout — those indent the box
            // itself — and how many are a plain quote nested INSIDE it,
            // which the box has to indent instead.
            const outermost = visualContainers.reduce<CalloutEditBlock>(
              (best, candidate) =>
                quoteDepth(doc.line(candidate.startLine).text) <
                quoteDepth(doc.line(best.startLine).text)
                  ? candidate
                  : best,
              visualContainers[0] ?? block
            );
            const levels = quoteLevelSplit(
              rawQuoteDepth,
              calloutDepth,
              quoteDepth(doc.line(outermost.startLine).text)
            );
            const plainQuoteDepth = levels.outer;
            const blockIsToggle =
              plugin.settings.toggleBlocks &&
              typeOfCallout(block) === TOGGLE_TYPE;
            const blockIsVisual =
              isVisualCallout(block) && !blockIsToggle;

            // Column scaffolding rows ("> [!nf-cols]", "> > [!nf-col]")
            // are structure, not prose — fade them while editing.
            const headType = parseCalloutHeader(line.text)?.type;
            const meta = headType === COLS_TYPE || headType === COL_TYPE;
            const boundaryClasses =
              (n === block.startLine ? " nf-co-first" : "") +
              (n === block.endLine ? " nf-co-last" : "") +
              (firstContentLines.has(n) ? " nf-co-content-first" : "") +
              (calloutDepth > 1 ? " nf-co-nested" : "") +
              // A plain quote nested inside the box: the rendered Callout
              // gives it a bar and its own inset, so the edit rows have to
              // as well, or the block moves when the caret arrives.
              (levels.inner > 0 ? " nf-co-quote" : "") +
              (blockIsToggle ? " nf-co-toggle" : "");
            const cls =
              "nf-co-edit" + boundaryClasses + (meta ? " nf-co-meta" : "");
            // A wrapped row cannot see the width of the widget standing in
            // for the quote markers, so it resumes at the line's own text
            // column — and Obsidian's measured hanging indent, which would
            // otherwise supply one, is cached per line NUMBER and keyed by
            // a prefix ("> ") every row of every Callout shares, so it can
            // hand a row a column measured somewhere else entirely. Declare
            // the column here instead: `nf-co-hang` rows own their indent
            // outright. List rows are excluded on purpose — their wrap
            // belongs after the bullet, which only a measurement can find.
            const inFence = !!fenceAt(fences, n);
            const hang =
              blockIsVisual &&
              !!prefix &&
              !inFence &&
              !visualFenceLines.has(n) &&
              !quotedListMarker(line.text) &&
              // The column IS the widget: a header row that keeps its raw
              // token (no visual range to replace) has no widget, and
              // indenting it would pull its first row out of the box.
              (!headType || !!calloutHeaderVisualRange(line.text));
            builder.add(
              line.from,
              line.from,
              Decoration.line({
                attributes: {
                  class: inFence
                    ? "nf-co-code" + boundaryClasses
                    : cls + (hang ? " nf-co-hang" : ""),
                  style:
                    `--callout-color:var(${block.colorVar});` +
                    `--nf-co-parent-color:var(${parentBlock?.colorVar ?? block.colorVar});` +
                    `--nf-co-depth:${calloutDepth};` +
                    // Outer levels place the box; inner levels are placed by
                    // it. Only the first is a position for the box's layers.
                    `--nf-co-plain-depth:${plainQuoteDepth};` +
                    `--nf-co-quote-depth:${levels.inner};`,
                },
              })
            );

            const header = parseCalloutHeader(line.text);
            if (blockIsVisual && prefix && !visualFenceLines.has(n)) {
              const leading =
                line.text.match(RE_LEADING_WS)?.[0].length ?? 0;
              if (header) {
                const visual = calloutHeaderVisualRange(line.text);
                if (!visual) continue;
                const tokenFrom = line.from + visual.from;
                const tokenTo = line.from + visual.to;
                const hasCustomTitle =
                  line.text.slice(visual.to).trim().length > 0;
                const replacement = Decoration.replace({
                  widget: new VisualCalloutLeadWidget(
                    header.type,
                    !hasCustomTitle,
                    rawQuoteDepth,
                    calloutDepth
                  ),
                });
                builder.add(tokenFrom, tokenTo, replacement);
                hiddenRanges.push(replacement.range(tokenFrom, tokenTo));
              } else {
                builder.add(
                  line.from + leading,
                  line.from + prefix.length,
                  Decoration.replace({
                    widget: new VisualStructureGapWidget(
                      "callout",
                      rawQuoteDepth,
                      false,
                      calloutDepth,
                      levels.outer
                    ),
                  })
                );
              }
            }
            // The header's "[!nf-toggle]±" is scaffolding. Show the
            // triangle it stands for instead — unless the caret is on that
            // very row, where the source has to stay editable.
            if (!blockIsToggle || n !== block.startLine) continue;
            const toggleHeader = parseToggleHeader(line.text);
            if (!toggleHeader || caretLines.has(n)) continue;
            builder.add(
              line.from + toggleHeader.tokenFrom,
              line.from + toggleHeader.tokenTo,
              Decoration.replace({
                widget: new ToggleMarkWidget(toggleHeader.collapsed),
              })
            );
          }
        }

        // Plain blockquotes never need to expose their structural markers.
        // Callouts are excluded unless active (handled above), avoiding any
        // overlap with Obsidian's rendered embed replacement.
        if (plugin.settings.calloutEditing) {
          for (const range of view.visibleRanges) {
            let pos = range.from;
            while (pos <= range.to) {
              const line = doc.lineAt(pos);
              pos = line.to + 1;
              if (
                fenceAt(fences, line.number) ||
                calloutLines.has(line.number)
              ) continue;
              const prefix = quoteMarkerPrefix(line.text);
              if (!prefix) continue;
              const leading = line.text.match(RE_LEADING_WS)?.[0].length ?? 0;
              builder.add(
                line.from + leading,
                line.from + prefix.length,
                Decoration.replace({
                  widget: new VisualStructureGapWidget(
                    "quote",
                    quotePrefixDepth(prefix)
                  ),
                })
              );
            }
          }
        }

        // Caption metadata stays a readable <small> row in portable
        // Markdown, but Live Preview presents it as a direct, clickable
        // caption. An inactive rendered Callout owns its inner DOM, so its
        // postprocessor handles those captions until the Callout is opened.
        for (const range of view.visibleRanges) {
          let pos = range.from;
          while (pos <= range.to) {
            const line = doc.lineAt(pos);
            pos = line.to + 1;
            const meta = parseBlockCaption(line.text);
            if (!meta) continue;
            if (
              calloutLines.has(line.number) &&
              !activeCalloutLines.has(line.number)
            ) continue;
            const previousLine = line.number - 1;
            let ownerLine: number | null = null;
            let language = "";
            if (meta.kind === "code" && previousLine >= 1) {
              const fence = fenceAt(fences, previousLine);
              if (fence?.closed && fence.endLine === previousLine) {
                ownerLine = fence.startLine;
                language =
                  fenceVisualTokenRange(doc, fence, false)?.language ?? "";
              }
            } else if (meta.kind === "table" && previousLine >= 1) {
              // The owner is the table's FIRST row: that is what the caption
              // editor and the block menu address it by.
              const table = isTableRow(doc.line(previousLine).text)
                ? getTableRange(doc, previousLine, fences)
                : null;
              if (table?.endLine === previousLine) ownerLine = table.startLine;
            } else if (meta.kind === "image" && previousLine >= 1) {
              const previousText = doc.line(previousLine).text;
              const prefix = quoteMarkerPrefix(previousText) ?? "";
              if (isImageBlockLine(previousText.slice(prefix.length))) {
                ownerLine = previousLine;
              }
            }
            if (ownerLine == null) continue;
            builder.add(
              line.from,
              line.from,
              Decoration.line({
                // The kind rides on the line so the caption can adopt its
                // owner's text column: a code card insets its text, an
                // image starts at the content edge.
                attributes: {
                  class: `nf-caption-line nf-caption-line-${meta.kind}`,
                },
              })
            );
            builder.add(
              line.from + meta.prefix.length,
              line.to,
              Decoration.replace({
                widget: new VisualBlockCaptionWidget(
                  plugin,
                  meta.kind,
                  ownerLine,
                  meta.caption,
                  meta.collapsed,
                  language
                ),
              })
            );
          }
        }

        // Every visible fenced block uses one stable header and collapsed
        // footer. Code text stays in CodeMirror, preserving highlighting,
        // selection, and IME behavior without exposing fence source.
        for (const fence of visualFences) {
          const meta = codeCaptionMeta(doc, fence);
          const collapsed = meta?.collapsed ?? false;
          // The opener counts as part of what folds away, so it has to be
          // part of what a caret keeps open. Fold hides it too, and a caret
          // stranded there — restored by undo, dropped by a search hit —
          // would be invisible while every keystroke went into the fence.
          const hideBody =
            collapsed &&
            !selectionTouchesLines(
              selections,
              fence.startLine,
              fence.endLine
            );
          const open = fenceVisualTokenRange(doc, fence, false);
          if (open) {
            builder.add(
              doc.line(fence.startLine).from,
              doc.line(fence.startLine).from,
              Decoration.line({
                attributes: {
                  // Keyed to hideBody, not to `collapsed`. A folded block is
                  // represented by the single caption chip below it, so its
                  // opener row stands down to avoid showing the language
                  // twice. When the caret sits inside a collapsed block the
                  // body is revealed for editing, and then the opener has to
                  // come back or the visible code would have no header.
                  class:
                    "nf-visual-fence-open" +
                    (hideBody ? " nf-code-is-collapsed" : ""),
                },
              })
            );
            builder.add(
              open.from,
              open.to,
              Decoration.replace({
                widget: new VisualCodeFenceWidget(
                  plugin,
                  open.language,
                  fence.startLine,
                  collapsed
                ),
              })
            );
          }
          if (hideBody) {
            for (let n = fence.startLine + 1; n <= fence.endLine; n++) {
              builder.add(
                doc.line(n).from,
                doc.line(n).from,
                Decoration.line({
                  attributes: { class: "nf-code-folded-row" },
                })
              );
            }
          }
          const close = fenceVisualTokenRange(doc, fence, true);
          // The closer normally collapses to the card's 4px bottom edge. A
          // caret parked there would then be invisible — and anything typed
          // would land on the ``` row, turning the closer into a new opener
          // and swallowing the rest of the note. Give the row back its own
          // height and source while the caret is on it.
          if (close && !bareCaretLines.has(fence.endLine)) {
            builder.add(
              doc.line(fence.endLine).from,
              doc.line(fence.endLine).from,
              Decoration.line({
                attributes: { class: "nf-visual-fence-close" },
              })
            );
            builder.add(
              close.from,
              close.to,
              Decoration.replace({
                widget: new VisualCodeFenceEndWidget(),
              })
            );
          }
          // Quote markers on code body rows are structural too.
          if (fence.quoteDepth > 0) {
            // Normally the opening token starts before the quote markers and
            // hides them itself. It cannot when the fence opens on a list
            // marker ("> - ```sh"): the bullet belongs to the item and has to
            // keep its place, so the token has to start after it — leaving
            // this one row showing a bare ">" while every sibling row hides
            // one. Give the opener its own gap in that case.
            if (fence.markerOpener) {
              const line = doc.line(fence.startLine);
              const prefix = quoteMarkerPrefix(line.text);
              const leading = line.text.match(RE_LEADING_WS)?.[0].length ?? 0;
              if (prefix) {
                builder.add(
                  line.from + leading,
                  line.from + prefix.length,
                  Decoration.replace({
                    widget: new VisualStructureGapWidget(
                      activeCalloutLines.has(fence.startLine) ? "callout" : "quote",
                      quotePrefixDepth(prefix),
                      false,
                      visualCalloutDepthAt(fence.startLine),
                      outerQuoteDepthAt(fence.startLine)
                    ),
                  })
                );
              }
            }
            for (
              let n = fence.startLine + 1;
              n <= (fence.closed ? fence.endLine - 1 : fence.endLine);
              n++
            ) {
              const line = doc.line(n);
              const prefix = quoteMarkerPrefix(line.text);
              if (!prefix) continue;
              const leading =
                line.text.match(RE_LEADING_WS)?.[0].length ?? 0;
              builder.add(
                line.from + leading,
                line.from + prefix.length,
                Decoration.replace({
                  widget: new VisualStructureGapWidget(
                    activeCalloutLines.has(n)
                      ? "callout"
                      : "quote",
                    quotePrefixDepth(prefix),
                    // Inside an open Callout these are code rows, so the gap
                    // also has to cover the card's text padding.
                    activeCalloutLines.has(n),
                    visualCalloutDepthAt(n),
                    outerQuoteDepthAt(n)
                  ),
                })
              );
            }
          }
        }
        this.hidden = Decoration.set(hiddenRanges, true);
        return Decoration.set(visualRanges, true);
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (extension) =>
        EditorView.atomicRanges.of(
          (view) => view.plugin(extension)?.hidden ?? Decoration.none
        ),
    }
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

/**
 * Where an empty block goes when it is inserted ABOVE `block`.
 *
 * The new row carries the container's markers and the block's own indent,
 * so it opens at the same column inside the same Callout or list. It needs
 * no separator of its own: an empty row IS the seam, which is the whole
 * reason this reaches a Callout's first block or a note's first line —
 * the two places Live Preview leaves no room to type.
 */
export function blockInsertAbovePlan(
  doc: Text,
  block: BlockRange
): { from: number; insert: string; caret: number } {
  const from = doc.line(block.startLine).from;
  const firstText = doc.line(block.startLine).text;
  const quotePrefix = block.quotePrefix ?? "";
  const content = firstText.slice(
    quotePrefix ? quoteMarkerPrefix(firstText)?.length ?? 0 : 0
  );
  // The block's OWN column, not a list item's content column: inserting
  // below a list item continues that item, but there is no item above it
  // to continue — the new row belongs beside the block, not inside it.
  const containerIndent = quotePrefix
    ? firstText.match(RE_LEADING_WS)?.[0] ?? ""
    : "";
  const prefix = containerIndent + quotePrefix + " ".repeat(indentWidth(content));
  return { from, insert: prefix + "\n", caret: from + prefix.length };
}

/** Insert a correctly-indented empty block above `block`, caret in it. */
export function insertBlockAbove(
  view: EditorView,
  block: BlockRange,
  openSlashMenu: boolean
): void {
  const plan = blockInsertAbovePlan(view.state.doc, block);
  view.dispatch({
    changes: { from: plan.from, insert: plan.insert },
    selection: { anchor: plan.caret },
    userEvent: "input",
  });
  view.focus();
  if (openSlashMenu) openSlashSuggest(view);
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
  const quotePrefix = block.quotePrefix ?? "";
  const content = firstText.slice(
    quotePrefix ? quoteMarkerPrefix(firstText)?.length ?? 0 : 0
  );
  const contentIndent = listContentIndent(content);
  const indent = quotePrefix
    ? contentIndent ?? indentWidth(content)
    : contentIndent ?? effectiveBlockIndent(doc, block.startLine);
  // `block.quotePrefix` is a canonical depth ("> > "), carrying no
  // indentation. A Callout nested in a list item sits at that item's
  // content column and repeats it on every row, so the new row and its
  // separator have to as well — at column 0 they fall out of the box.
  const containerIndent = quotePrefix
    ? firstText.match(RE_LEADING_WS)?.[0] ?? ""
    : "";
  // Spaces are deliberate: partial-tab prefixes are parsed inconsistently
  // by Live Preview for quote/callout widgets.
  const prefix = containerIndent + quotePrefix + " ".repeat(indent);
  // Inside a Callout the blank separator is an empty quote row; a bare
  // blank line would end the container instead of spacing its rows.
  const lastText = doc.line(block.endLine).text;
  const blank = RE_BLANK.test(
    lastText.slice(quotePrefix ? quoteMarkerPrefix(lastText)?.length ?? 0 : 0)
  );
  const separator = blank
    ? "\n"
    : `\n${(containerIndent + quotePrefix).trimEnd()}\n`;
  const insert = separator + prefix;
  view.dispatch({
    changes: { from: end, insert },
    selection: { anchor: end + insert.length },
    userEvent: "input",
  });
  view.focus();
  if (openSlashMenu) openSlashSuggest(view);
}

/** Type the "/" that opens the block-type suggester at the caret. */
function openSlashSuggest(view: EditorView): void {
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

/** Keys that move the text caret rather than act on selected blocks. */
const CARET_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

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
      /** Vertical bar marking a "drop beside this block as a column" target. */
      colIndicator: HTMLElement;
      highlight: HTMLElement;
      ghost: HTMLElement;
      marquee: HTMLElement;
      selectionLayer: HTMLElement;
      selectionToolbar: HTMLElement;
      selectionCount: HTMLElement;
      selectedBlocks: BlockRange[] = [];
      /** The row a keyboard extension grows FROM: the marquee's start row,
       *  or the block Escape selected. Null when nothing is selected. */
      selectionAnchorLine: number | null = null;
      pendingSelect: {
        x: number;
        y: number;
        line: number;
        fromText: boolean;
      } | null = null;
      selecting = false;
      /** Non-zero while the selection toolbar runs one of its own edits.
       *  Every other document change invalidates the line numbers a block
       *  selection is made of and clears it; these deliberately do not,
       *  which is what lets formats chain on the same selection. */
      selfEdit = 0;
      /** Pushed while blocks are selected. Obsidian's app hotkey scope runs
       * before document-level capture listeners, so Mod+D ("Delete
       * paragraph") and Mod+A must be claimed through the keymap itself. */
      keyScope: Scope | null = null;
      activeLeafChangeRef: EventRef | null = null;
      focusCleanupTimer: number | null = null;
      hoverBlock: BlockRange | null = null;
      pendingDrag: { x: number; y: number; block: BlockRange } | null = null;
      dragging = false;
      dragBlock: BlockRange | null = null;
      dropColumnsTarget: BlockRange | null = null;
      dropLine = -1;
      dropIndent: number | undefined = undefined;
      dropQuotePrefix: string | undefined = undefined;
      dropCandidatesLine = -1;
      dropCandidates: DropLevel[] = [];
      fences: FenceRange[] = [];
      /** Row geometry of rendered Callout widgets, rebuilt per document. */
      calloutRowCache = new WeakMap<
        HTMLElement,
        { doc: Text; rows: Array<{ block: BlockRange; element: HTMLElement }> | null }
      >();
      dragStartX = 0;
      dragBaseIndent = 0;
      dragBaseQuotePrefix = "";
      visualIndentStep = 32;
      listIndentCache: number | null = null;
      lastX = 0;
      lastY = 0;
      scrollTimer: number | null = null;
      scrollSpeed = 0;
      handleKind: "block" | "table" = "block";

      onMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
      onScroll = () => {
        this.hideHover();
        if (this.selectedBlocks.length > 0) {
          this.ownerWindow.requestAnimationFrame(() => this.renderBlockSelection());
        }
      };
      onLeave = (e: MouseEvent) => {
        if (this.dragging || this.selecting) return;
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
      onEditorMouseDown = (e: MouseEvent) => this.handleSelectionStart(e);
      onSelectMove = (e: MouseEvent) => this.handleSelectionMove(e);
      onSelectUp = (e: MouseEvent) => this.handleSelectionEnd(e);
      onKeyDown = (e: KeyboardEvent) => {
        // The document listener is deliberately capture-phase, so guard the
        // brief blur → timer window too: a key meant for search/another pane
        // must never reach the old editor's block selection.
        if (
          this.selectedBlocks.length > 0 &&
          !this.selectionScopeIsCurrent()
        ) {
          this.clearBlockSelection();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          if (this.dragging || this.pendingDrag) this.endDrag();
          else this.clearBlockSelection();
          return;
        }
        if (
          this.selectedBlocks.length === 0 ||
          this.dragging || this.pendingDrag || this.selecting
        ) return;
        const plainKey = !e.metaKey && !e.ctrlKey && !e.altKey;
        // Up/Down walk the selection block by block, Shift grows it — the
        // arrows keep meaning "move", they just move a block instead of a
        // caret while one is selected.
        if (plainKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          e.stopPropagation();
          this.stepBlockSelection(e.key === "ArrowDown" ? 1 : -1, e.shiftKey);
          return;
        }
        // Enter puts the caret back where the selection ended, which is the
        // way out of block mode that does not lose your place.
        if (plainKey && !e.shiftKey && e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          this.editSelectedBlock();
          return;
        }
        // Moving the caret abandons the block selection. Leaving it painted
        // would show a highlight over blocks that the next keystroke has
        // stopped being about; the key itself still reaches the editor.
        if (CARET_KEYS.has(e.key)) {
          this.clearBlockSelection();
          return;
        }
        if (
          (e.key === "Backspace" || e.key === "Delete") &&
          !e.metaKey && !e.ctrlKey && !e.altKey
        ) {
          e.preventDefault();
          e.stopPropagation();
          this.deleteSelectedBlocks();
          return;
        }
        // Notion-style clipboard actions while blocks are selected. Keys
        // already claimed by the selection Scope arrive defaultPrevented —
        // running them here again would double the edit.
        if (
          !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey ||
          e.defaultPrevented
        ) return;
        const key = e.key.toLowerCase();
        if (!["c", "x", "v", "d", "a"].includes(key)) return;
        e.preventDefault();
        e.stopPropagation();
        if (key === "c") void this.copySelectedBlocks(false);
        else if (key === "x") void this.copySelectedBlocks(true);
        else if (key === "v") void this.pasteOverSelectedBlocks();
        else if (key === "d") this.duplicateSelectedBlocks();
        else this.selectAllBlocks();
      };
      /** Escape with nothing selected yet: select the block the caret is in.
       *  Notion's own way into block mode, and the only entry point this
       *  plugin had that was not a mouse gesture. */
      onSelectKeyDown = (e: KeyboardEvent) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        if (e.isComposing || e.keyCode === 229) return;
        if (!plugin.settings.blockSelectKey || !plugin.settings.dragHandles) return;
        if (this.selectedBlocks.length > 0) return;
        if (this.dragging || this.pendingDrag || this.selecting) return;
        if (!this.view.hasFocus) return;
        // Vim's own Escape leaves insert mode, and a popover or menu that
        // did not consume the key still owns it.
        if (vimModeEnabled(plugin.app)) return;
        // Rendered, not merely present: a hidden popup left in the DOM
        // would silently disable the key for the whole session.
        const popups = this.ownerDocument.querySelectorAll<HTMLElement>(
          ".modal-container, .suggestion-container, .menu, .nf-cmt-pop"
        );
        for (const popup of Array.from(popups)) {
          if (popup.getClientRects().length > 0) return;
        }
        const doc = this.view.state.doc;
        const fences = cachedFences(doc);
        const line = doc.lineAt(this.view.state.selection.main.head).number;
        const block = getBlockRange(doc, line, fences);
        if (!block) return;
        e.preventDefault();
        e.stopPropagation();
        this.selectionAnchorLine = block.startLine;
        this.setBlockSelection([block]);
      };
      onEditorBlur = () => {
        if (this.focusCleanupTimer != null) {
          this.ownerWindow.clearTimeout(this.focusCleanupTimer);
        }
        // Let focus finish moving. A transient blur followed by CodeMirror
        // immediately restoring its own contentDOM should keep the selection.
        this.focusCleanupTimer = this.ownerWindow.setTimeout(() => {
          this.focusCleanupTimer = null;
          if (
            this.selectedBlocks.length > 0 &&
            !this.selectionScopeIsCurrent()
          ) this.clearBlockSelection();
        }, 0);
      };
      onWindowBlur = () => {
        if (this.selectedBlocks.length > 0 || this.pendingSelect) {
          this.clearBlockSelection();
        }
      };
      onActiveLeafChange = () => {
        if (this.selectedBlocks.length > 0 || this.pendingSelect) {
          this.clearBlockSelection();
        }
      };

      /** True for embedded editors (Live Preview table cells, canvas …):
       *  block UI belongs to the outer document editor only. */
      nested: boolean;

      constructor(view: EditorView) {
        this.view = view;
        this.ownerDocument = view.dom.ownerDocument;
        this.ownerWindow = this.ownerDocument.defaultView ?? window;
        this.nested = !!view.dom.parentElement?.closest(".cm-editor");
        this.fences = cachedFences(view.state.doc);

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
            plugin,
            plugin.settings.slashCommands,
            plugin.settings.columnLayout,
            plugin.settings.toggleBlocks
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

        this.colIndicator = this.ownerDocument.body.createDiv({ cls: "nf-col-indicator" });
        this.colIndicator.style.display = "none";

        this.highlight = this.ownerDocument.body.createDiv({ cls: "nf-block-highlight" });
        this.highlight.style.display = "none";

        this.ghost = this.ownerDocument.body.createDiv({ cls: "nf-drag-ghost" });
        this.ghost.style.display = "none";

        this.marquee = this.ownerDocument.body.createDiv({ cls: "nf-block-marquee" });
        this.marquee.style.display = "none";

        this.selectionLayer = this.ownerDocument.body.createDiv({
          cls: "nf-block-selection-layer",
        });

        this.selectionToolbar = this.ownerDocument.body.createDiv({
          cls: "nf-block-selection-toolbar",
          attr: { role: "toolbar", "aria-label": t("Block selection") },
        });
        this.selectionToolbar.style.display = "none";
        this.selectionCount = this.selectionToolbar.createSpan({
          cls: "nf-block-selection-count",
        });
        const formatButton = (icon: string, label: string, run: () => void) => {
          const btn = this.selectionToolbar.createEl("button", {
            cls: "clickable-icon nf-block-selection-format",
            attr: { type: "button", "aria-label": label },
          });
          setIcon(btn, icon);
          btn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            run();
          });
        };
        formatButton("bold", t("Bold"), () =>
          this.formatSelectedBlocks({ marker: "**", open: "<b>", close: "</b>" })
        );
        formatButton("italic", t("Italic"), () =>
          this.formatSelectedBlocks({ marker: "*", open: "<i>", close: "</i>" })
        );
        formatButton("underline", t("Underline"), () =>
          this.formatSelectedBlocks({ open: "<u>", close: "</u>" })
        );
        formatButton("strikethrough", t("Strikethrough"), () =>
          this.formatSelectedBlocks({ marker: "~~", open: "<s>", close: "</s>" })
        );
        formatButton("remove-formatting", t("Clear formatting"), () =>
          this.clearFormattingOnSelectedBlocks()
        );
        this.selectionToolbar.createSpan({ cls: "nf-block-selection-divider" });
        const turnInto = this.selectionToolbar.createEl("button", {
          cls: "clickable-icon nf-block-selection-action",
          attr: { type: "button", "aria-label": t("Turn into") },
        });
        setIcon(turnInto, "replace");
        turnInto.createSpan({ text: t("Turn into") });
        turnInto.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.openBatchTurnIntoMenu(event as MouseEvent);
        });
        const copySelection = this.selectionToolbar.createEl("button", {
          cls: "clickable-icon nf-block-selection-action",
          attr: { type: "button", "aria-label": t("Copy text") },
        });
        setIcon(copySelection, "clipboard-copy");
        copySelection.createSpan({ text: t("Copy") });
        copySelection.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          void this.copySelectedBlocks(false);
        });
        const deleteSelection = this.selectionToolbar.createEl("button", {
          cls: "clickable-icon nf-block-selection-action nf-block-selection-delete",
          attr: { type: "button", "aria-label": t("Delete block") },
        });
        setIcon(deleteSelection, "trash-2");
        deleteSelection.createSpan({ text: t("Delete") });
        deleteSelection.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.deleteSelectedBlocks();
        });
        const closeSelection = this.selectionToolbar.createEl("button", {
          cls: "clickable-icon nf-block-selection-close",
          attr: { type: "button", "aria-label": t("Clear block selection") },
        });
        setIcon(closeSelection, "x");
        closeSelection.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.clearBlockSelection();
        });
        this.selectionToolbar.addEventListener("mousedown", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });

        if (!this.nested) {
          // Capture phase: Obsidian's table widget stops mouse events from
          // bubbling (it runs its own hover controls), so a bubble-phase
          // listener never fires over a rendered table.
          view.scrollDOM.addEventListener("mousemove", this.onMouseMove, true);
          view.scrollDOM.addEventListener("mousedown", this.onEditorMouseDown, true);
          view.scrollDOM.addEventListener("scroll", this.onScroll);
          view.scrollDOM.addEventListener("mouseleave", this.onLeave);
          view.contentDOM.addEventListener("blur", this.onEditorBlur, true);
          // Bubble phase, and always listening: this is the ONE key that has
          // to reach an editor with no block selection yet, and letting the
          // suggester, a modal, or a menu handle its own Escape first is
          // exactly what the bubble phase buys.
          view.contentDOM.addEventListener("keydown", this.onSelectKeyDown);
          this.ownerWindow.addEventListener("blur", this.onWindowBlur);
          this.activeLeafChangeRef = plugin.app.workspace.on(
            "active-leaf-change",
            this.onActiveLeafChange
          );
        }
      }

      /** Empty editor space starts a Notion-style marquee. Holding Alt/Option
       * deliberately opts into it even when the pointer starts over text.
       * "background" starts (empty rows, space below the document, Alt) own
       * the gesture outright; "text" starts (the margins of a row that has
       * text) stay pending until the drag proves vertical intent, so ordinary
       * text selections that begin just past a line's edge remain native. */
      marqueeStartKind(e: MouseEvent): "background" | "text" | null {
        if (e.button !== 0 || !plugin.settings.dragHandles) return null;
        const target = e.target as Element | null;
        if (
          !target ||
          target.closest(
            ".nf-block-controls,.nf-block-selection-toolbar,.nf-block-menu-anchor," +
            "button,input,textarea,select,a,.cm-table-widget,.cm-embed-block"
          )
        ) return null;
        // Code blocks need uninterrupted native text dragging, including
        // selections that begin in indentation or after the last character.
        // A whole code block can still be marquee-selected by starting the
        // gesture outside it and sweeping across its vertical range.
        if (
          target.closest(
            "pre,code,.HyperMD-codeblock,.cm-preview-code-block,.code-block-flair"
          )
        ) return null;
        const editorPos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (
          editorPos != null &&
          fenceAt(
            this.fences,
            this.view.state.doc.lineAt(editorPos).number
          )
        ) return null;
        if (e.altKey) return "background";
        const line = target.closest<HTMLElement>(".cm-line");
        if (!line) {
          return target === this.view.contentDOM || target === this.view.scrollDOM
            ? "background"
            : null;
        }
        const range = this.ownerDocument.createRange();
        range.selectNodeContents(line);
        const ink = Array.from(range.getClientRects()).filter(
          (rect) => rect.width > 0 && rect.height > 0
        );
        if (ink.length === 0) return "background";
        // Only rects on the pointer's visual row matter: a wrapped line's
        // other rows shouldn't turn its side margins into text.
        const row = ink.filter(
          (rect) => e.clientY >= rect.top - 2 && e.clientY <= rect.bottom + 2
        );
        // The vertical gap between rows (paragraph spacing, wrap leading) is
        // where text selections often begin a hair off-glyph — keep native.
        if (row.length === 0) return null;
        const onInk = row.some(
          (rect) => e.clientX >= rect.left - 3 && e.clientX <= rect.right + 8
        );
        return onInk ? null : "text";
      }

      lineAtSelectionY(y: number, x: number): number {
        const doc = this.view.state.doc;
        const direct = this.posAt(x, y);
        if (direct != null) return doc.lineAt(direct).number;
        const content = this.view.contentDOM.getBoundingClientRect();
        if (y <= content.top) return 1;
        if (y >= content.bottom) return doc.lines;
        try {
          const block = this.view.lineBlockAtHeight(y - this.view.documentTop);
          return doc.lineAt(Math.max(0, Math.min(doc.length, block.from))).number;
        } catch {
          return y < (content.top + content.bottom) / 2 ? 1 : doc.lines;
        }
      }

      handleSelectionStart(e: MouseEvent) {
        if (this.dragging || this.pendingDrag) return;
        const kind = this.marqueeStartKind(e);
        if (!kind) {
          // A right/middle click opens a menu rather than moving the caret,
          // so the selection it lands on is still what the menu is about.
          if (
            e.button === 0 &&
            this.selectedBlocks.length > 0 &&
            !(e.target as Element | null)?.closest?.(".nf-block-selection-toolbar")
          ) this.clearBlockSelection();
          return;
        }
        // Do not consume mousedown yet. A simple click in the whitespace at
        // the end of a line must still let CodeMirror place its text caret.
        // We only take ownership once pointer movement crosses the marquee
        // threshold in handleSelectionMove.
        this.clearBlockSelection();
        this.pendingSelect = {
          x: e.clientX,
          y: e.clientY,
          line: this.lineAtSelectionY(e.clientY, e.clientX),
          fromText: kind === "text",
        };
        this.ownerDocument.addEventListener("mousemove", this.onSelectMove, true);
        this.ownerDocument.addEventListener("mouseup", this.onSelectUp, true);
        this.ownerDocument.addEventListener("keydown", this.onKeyDown, true);
      }

      handleSelectionMove(e: MouseEvent) {
        const start = this.pendingSelect;
        if (!start) return;
        if (!this.selecting) {
          const dx = e.clientX - start.x;
          const dy = e.clientY - start.y;
          if (start.fromText) {
            // Starting beside text is ambiguous: only a clearly vertical
            // sweep becomes a marquee. A horizontal pull is a text
            // selection — hand the gesture back to CodeMirror for good.
            if (Math.abs(dx) >= Math.abs(dy) && dx * dx + dy * dy >= 64) {
              this.clearBlockSelection();
              return;
            }
            if (Math.abs(dy) < 8 || Math.abs(dy) <= Math.abs(dx)) return;
          } else if (dx * dx + dy * dy < 16) return;
          this.selecting = true;
          this.ownerDocument.body.classList.add("nf-selecting-blocks");
          this.controls.style.display = "none";
          // CodeMirror saw the original mousedown so a native text selection
          // may have started. Once this becomes a block marquee, discard that
          // DOM selection and intercept subsequent movement in capture phase.
          this.ownerDocument.getSelection()?.removeAllRanges();
        }
        e.preventDefault();
        e.stopPropagation();
        const scroll = this.view.scrollDOM.getBoundingClientRect();
        const x = Math.max(scroll.left, Math.min(scroll.right, e.clientX));
        const y = Math.max(scroll.top, Math.min(scroll.bottom, e.clientY));
        const left = Math.min(start.x, x);
        const top = Math.min(start.y, y);
        this.marquee.style.display = "block";
        this.marquee.style.left = `${left}px`;
        this.marquee.style.top = `${top}px`;
        this.marquee.style.width = `${Math.abs(x - start.x)}px`;
        this.marquee.style.height = `${Math.abs(y - start.y)}px`;

        const endLine = this.lineAtSelectionY(y, x);
        this.selectionAnchorLine = start.line;
        this.selectedBlocks = blocksInLineSpan(
          this.view.state.doc,
          start.line,
          endLine,
          this.fences
        );
        this.renderBlockSelection();
      }

      handleSelectionEnd(e: MouseEvent) {
        const didSelect = this.selecting;
        this.ownerDocument.removeEventListener("mousemove", this.onSelectMove, true);
        this.ownerDocument.removeEventListener("mouseup", this.onSelectUp, true);
        this.pendingSelect = null;
        this.selecting = false;
        this.ownerDocument.body.classList.remove("nf-selecting-blocks");
        this.marquee.style.display = "none";
        if (!didSelect || this.selectedBlocks.length === 0) {
          this.clearBlockSelection();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        // A marquee can begin in scroll padding outside contentDOM. Give the
        // resulting block selection a single, unambiguous owning editor.
        this.view.focus();
        this.armSelectionScope();
        this.renderBlockSelection();
      }

      /** Cheap vertical span of a whole block from the height map, used to
       *  discard blocks nowhere near the screen before paying for a rect. */
      blockSpanEstimate(block: BlockRange): { top: number; bottom: number } | null {
        const doc = this.view.state.doc;
        if (block.startLine > doc.lines || block.endLine > doc.lines) return null;
        const first = this.heightMapSpan(doc.line(block.startLine).from);
        if (!first) return null;
        const last = block.endLine === block.startLine
          ? first
          : this.heightMapSpan(doc.line(block.endLine).from);
        return { top: first.top, bottom: last ? last.bottom : first.bottom };
      }

      renderBlockSelection() {
        this.selectionLayer.empty();
        if (this.selectedBlocks.length === 0) {
          this.selectionToolbar.style.display = "none";
          return;
        }
        const content = this.view.contentDOM.getBoundingClientRect();
        // Marks are position:fixed, so nothing keeps them inside the editor
        // on its own — an unclipped one paints over the tab header, the
        // status bar, or the pane next door. Clipping also means a
        // select-all over a long note builds a handful of marks instead of
        // one per block in the whole document.
        const pane = this.view.scrollDOM.getBoundingClientRect();
        let resolved = false;
        let visibleTop = Infinity;
        let visibleBottom = -Infinity;
        const lines = this.view.state.doc.lines;
        for (const block of this.selectedBlocks) {
          // A render deferred to the next frame can land on a document the
          // selection no longer fits; measuring past its end would throw.
          if (block.startLine < 1 || block.endLine > lines) continue;
          const estimate = this.blockSpanEstimate(block);
          const offscreen = estimate &&
            (estimate.bottom < pane.top || estimate.top > pane.bottom);
          const rect = offscreen ? estimate : this.blockRect(block) ?? estimate;
          if (!rect) continue;
          resolved = true;
          const markTop = Math.max(rect.top, pane.top);
          const markBottom = Math.min(rect.bottom, pane.bottom);
          if (markBottom - markTop <= 0) continue;
          visibleTop = Math.min(visibleTop, markTop);
          visibleBottom = Math.max(visibleBottom, markBottom);
          const mark = this.selectionLayer.createDiv({ cls: "nf-multi-block-highlight" });
          mark.style.left = `${content.left - 6}px`;
          mark.style.top = `${markTop + 1}px`;
          mark.style.width = `${content.width + 12}px`;
          // Rows are contiguous, so the marks are inset by a hair rather
          // than grown: grown ones overlap, and every shared edge would
          // then draw its outline twice.
          mark.style.height = `${Math.max(1, markBottom - markTop - 2)}px`;
        }
        if (!resolved) {
          this.selectionToolbar.style.display = "none";
          return;
        }
        this.selectionCount.textContent = t("{n} blocks selected").replace(
          "{n}",
          String(this.selectedBlocks.length)
        );
        this.selectionToolbar.style.display = "flex";
        const toolbarWidth = this.selectionToolbar.offsetWidth || 220;
        const viewportWidth = this.ownerWindow.innerWidth;
        this.selectionToolbar.style.left = `${Math.max(
          8,
          Math.min(viewportWidth - toolbarWidth - 8, content.left + 8)
        )}px`;
        const toolbarHeight = this.selectionToolbar.offsetHeight || 36;
        // Anchor on the part of the selection that is actually on screen:
        // measured from the true first block, a selection running off the
        // top of a long note would park its toolbar above the window.
        const anchorTop = Number.isFinite(visibleTop) ? visibleTop : pane.top;
        const anchorBottom = Number.isFinite(visibleBottom)
          ? visibleBottom
          : pane.top;
        const above = anchorTop - toolbarHeight - 8;
        const placed = above >= pane.top + 4 ? above : anchorBottom + 8;
        this.selectionToolbar.style.top = `${Math.max(
          Math.min(pane.top + 4, this.ownerWindow.innerHeight - toolbarHeight - 4),
          Math.min(placed, pane.bottom - toolbarHeight - 4)
        )}px`;
      }

      clearBlockSelection() {
        if (this.focusCleanupTimer != null) {
          this.ownerWindow.clearTimeout(this.focusCleanupTimer);
          this.focusCleanupTimer = null;
        }
        this.ownerDocument.removeEventListener("mousemove", this.onSelectMove, true);
        this.ownerDocument.removeEventListener("mouseup", this.onSelectUp, true);
        if (!this.dragging && !this.pendingDrag) {
          this.ownerDocument.removeEventListener("keydown", this.onKeyDown, true);
        }
        this.disarmSelectionScope();
        this.pendingSelect = null;
        this.selecting = false;
        this.selectedBlocks = [];
        this.selectionAnchorLine = null;
        this.ownerDocument.body.classList.remove("nf-selecting-blocks");
        this.marquee.style.display = "none";
        this.selectionLayer.empty();
        this.selectionToolbar.style.display = "none";
      }

      /**
       * Walk the block selection one block up or down; `extend` grows it
       * from the anchor instead of moving it.
       *
       * The head is whichever end is not the anchor, so a selection grown
       * downwards shrinks from the bottom when the arrow reverses — the
       * same shape Shift+Arrow has over text.
       */
      stepBlockSelection(dir: 1 | -1, extend: boolean) {
        const doc = this.view.state.doc;
        const fences = cachedFences(doc);
        const first = this.selectedBlocks[0];
        const last = this.selectedBlocks[this.selectedBlocks.length - 1];
        if (!first || !last) return;
        const anchor = this.selectionAnchorLine ?? first.startLine;
        const head = anchor <= first.startLine ? last : first;
        const next = adjacentBlock(doc, head, dir, fences);
        if (!next) return;
        const blocks = extend
          ? blocksInLineSpan(doc, anchor, next.startLine, fences)
          : [next];
        if (blocks.length === 0) return;
        if (!extend) this.selectionAnchorLine = next.startLine;
        this.setBlockSelection(blocks);
        this.scrollBlockIntoView(dir > 0 ? next.endLine : next.startLine);
      }

      /** Keep the block a keyboard step landed on visible without moving
       *  the text caret, which would end the selection. */
      scrollBlockIntoView(lineNo: number) {
        const doc = this.view.state.doc;
        if (lineNo < 1 || lineNo > doc.lines) return;
        this.view.dispatch({
          effects: EditorView.scrollIntoView(doc.line(lineNo).from, {
            y: "nearest",
          }),
        });
      }

      /** Enter: leave block mode with the caret at the end of the selection. */
      editSelectedBlock() {
        const doc = this.view.state.doc;
        const last = this.selectedBlocks[this.selectedBlocks.length - 1];
        if (!last) return;
        const pos = doc.line(Math.min(last.endLine, doc.lines)).to;
        this.clearBlockSelection();
        this.view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
        this.view.focus();
      }

      /** Backspace/Delete with a block selection removes the whole swept
       * span in one edit. */
      deleteSelectedBlocks() {
        const range = blockSelectionRemovalRange(
          this.view.state.doc,
          this.selectedBlocks
        );
        if (!range) return;
        const { from, to } = range;
        this.view.dispatch({
          changes: { from, to },
          selection: { anchor: from },
          userEvent: "delete.block",
        });
        this.clearBlockSelection();
        this.view.focus();
      }

      /** Run an edit that rewrites the selected blocks in place, keeping the
       * selection alive across the transaction it dispatches. */
      asSelfEdit(run: () => void) {
        this.selfEdit++;
        try {
          run();
        } finally {
          this.selfEdit--;
        }
      }

      /** Toolbar formatting: toggle an inline format across every selected
       * block's text content. The selection survives so formats chain. */
      formatSelectedBlocks(markers: BatchFormatMarkers) {
        if (this.selectedBlocks.length === 0) return;
        const result = batchToggleFormatChanges(
          this.view.state.doc,
          this.selectedBlocks,
          markers,
          this.fences
        );
        if (result.changes.length > 0) {
          this.asSelfEdit(() =>
            this.view.dispatch({
              changes: result.changes,
              userEvent: result.removed ? "delete.format.batch" : "input.format.batch",
            })
          );
        }
        if (result.skipped > 0) {
          new Notice(
            t("Skipped {n} structural blocks.").replace(
              "{n}",
              String(result.skipped)
            )
          );
        }
        // Inline wrapping never adds or removes lines, so the line-number
        // based selection stays valid; only the on-screen rects moved.
        this.ownerWindow.requestAnimationFrame(() => this.renderBlockSelection());
      }

      /** Clear-formatting reuses the selection-driven stripper: point the
       * editor selection at each block's span, strip, then park the caret. */
      clearFormattingOnSelectedBlocks() {
        if (this.selectedBlocks.length === 0) return;
        const doc = this.view.state.doc;
        const home = doc.line(this.selectedBlocks[0].startLine).from;
        this.view.dispatch({
          selection: EditorSelection.create(
            this.selectedBlocks.map((block) =>
              EditorSelection.range(
                doc.line(block.startLine).from,
                doc.line(block.endLine).to
              )
            )
          ),
        });
        this.asSelfEdit(() => clearInlineFormatting(this.view));
        this.view.dispatch({ selection: { anchor: home } });
        this.ownerWindow.requestAnimationFrame(() => this.renderBlockSelection());
      }

      armSelectionScope() {
        if (this.keyScope || !this.selectionScopeIsCurrent()) return;
        const scope = new Scope(plugin.app.scope);
        scope.register(["Mod"], "D", () => {
          return this.runSelectionScopeCommand(() => this.duplicateSelectedBlocks());
        });
        scope.register(["Mod"], "A", () => {
          return this.runSelectionScopeCommand(() => this.selectAllBlocks());
        });
        scope.register(["Mod"], "B", () => {
          return this.runSelectionScopeCommand(() => {
            this.formatSelectedBlocks({ marker: "**", open: "<b>", close: "</b>" });
          });
        });
        scope.register(["Mod"], "I", () => {
          return this.runSelectionScopeCommand(() => {
            this.formatSelectedBlocks({ marker: "*", open: "<i>", close: "</i>" });
          });
        });
        scope.register(["Mod"], "U", () => {
          return this.runSelectionScopeCommand(() =>
            this.formatSelectedBlocks({ open: "<u>", close: "</u>" })
          );
        });
        this.keyScope = scope;
        plugin.app.keymap.pushScope(scope);
      }

      selectionScopeIsCurrent(): boolean {
        return blockSelectionScopeIsCurrent(
          this.view.state.doc,
          this.selectedBlocks,
          this.view.hasFocus,
          this.view.dom.isConnected
        );
      }

      /** Return false only when this scope legitimately owns the shortcut;
       * inactive stale scopes stand down so the newly focused UI can handle it. */
      runSelectionScopeCommand(run: () => void): boolean {
        if (!this.selectionScopeIsCurrent()) {
          this.clearBlockSelection();
          return true;
        }
        if (this.selecting || this.dragging || this.pendingDrag) return false;
        run();
        return false;
      }

      disarmSelectionScope() {
        if (!this.keyScope) return;
        plugin.app.keymap.popScope(this.keyScope);
        this.keyScope = null;
      }

      /** Document span of the selection: first block's first line through
       * the last block's last line (blank lines between blocks included,
       * matching what the marquee visibly swept). */
      selectedSpan(): { from: number; to: number; text: string } | null {
        if (this.selectedBlocks.length === 0) return null;
        const doc = this.view.state.doc;
        const from = doc.line(this.selectedBlocks[0].startLine).from;
        const to = doc.line(
          this.selectedBlocks[this.selectedBlocks.length - 1].endLine
        ).to;
        return { from, to, text: doc.sliceString(from, to) };
      }

      /** Programmatic selection (duplicate result, select-all) re-arms the
       * key handler that a marquee gesture normally attaches. */
      setBlockSelection(blocks: BlockRange[]) {
        if (blocks.length === 0) {
          this.clearBlockSelection();
          return;
        }
        this.selectedBlocks = blocks;
        if (!this.selectionScopeIsCurrent()) {
          this.clearBlockSelection();
          return;
        }
        this.ownerDocument.addEventListener("keydown", this.onKeyDown, true);
        this.armSelectionScope();
        this.ownerWindow.requestAnimationFrame(() => this.renderBlockSelection());
      }

      /** Cmd/Ctrl+C and +X. The selection survives a plain copy so a
       * follow-up paste can still replace it, Notion-style. */
      async copySelectedBlocks(cut: boolean) {
        const span = this.selectedSpan();
        if (!span) return;
        const count = this.selectedBlocks.length;
        try {
          await navigator.clipboard.writeText(span.text);
        } catch {
          // A cut that never reached the clipboard must not delete the
          // blocks it failed to carry.
          new Notice(t("Could not write to the clipboard."));
          return;
        }
        if (cut) {
          this.deleteSelectedBlocks();
        } else {
          new Notice(t("Copied {n} blocks.").replace("{n}", String(count)));
        }
      }

      /** Cmd/Ctrl+V replaces the selected blocks with the clipboard text. */
      async pasteOverSelectedBlocks() {
        let clip = "";
        try {
          clip = await navigator.clipboard.readText();
        } catch {
          return;
        }
        if (!clip) return;
        // Re-read the selection after the await: any document change in the
        // meantime cleared it, so a stale span can never be overwritten.
        const span = this.selectedSpan();
        if (!span) return;
        const insert = blockSelectionPasteInsert(
          this.view.state.doc,
          this.selectedBlocks,
          clip
        );
        this.view.dispatch({
          changes: { from: span.from, to: span.to, insert },
          selection: { anchor: span.from + insert.length },
          userEvent: "input.paste",
        });
        this.clearBlockSelection();
        this.view.focus();
      }

      /** Cmd/Ctrl+D inserts a copy below and selects it, ready to move. */
      duplicateSelectedBlocks() {
        const span = this.selectedSpan();
        if (!span) return;
        const doc = this.view.state.doc;
        const lastLine =
          this.selectedBlocks[this.selectedBlocks.length - 1].endLine;
        const lines = span.text.split("\n");
        const separator = needsProtectedSeam(lines[lines.length - 1], lines[0])
          ? "\n\n"
          : "\n";
        const nextText =
          lastLine < doc.lines ? doc.line(lastLine + 1).text : "";
        const suffix = needsProtectedSeam(lines[lines.length - 1], nextText)
          ? "\n"
          : "";
        this.view.dispatch({
          changes: { from: span.to, insert: separator + span.text + suffix },
          userEvent: "input.duplicate",
        });
        const startLine = lastLine + (separator === "\n\n" ? 2 : 1);
        this.setBlockSelection(
          blocksInLineSpan(
            this.view.state.doc,
            startLine,
            startLine + lines.length - 1,
            this.fences
          )
        );
      }

      /** Cmd/Ctrl+A grows an existing block selection to the whole note. */
      selectAllBlocks() {
        const doc = this.view.state.doc;
        this.setBlockSelection(
          blocksInLineSpan(doc, 1, doc.lines, this.fences)
        );
      }

      openBatchTurnIntoMenu(evt: MouseEvent) {
        if (this.selectedBlocks.length === 0) return;
        const menuHost = this.ownerDocument.body.createDiv({ cls: "nf-block-menu-anchor" });
        const menu = new Menu().setUseNativeMenu(false).setParentElement(menuHost);
        menu.onHide(() => menuHost.remove());
        for (const entry of TURN_INTO) {
          menu.addItem((item) =>
            item
              .setTitle(entry.title)
              .setIcon(entry.icon)
              .onClick(() => {
                const result = batchTurnIntoChanges(
                  this.view.state.doc,
                  this.selectedBlocks,
                  entry.prefix,
                  this.fences
                );
                if (result.changes.length > 0) {
                  this.view.dispatch({
                    changes: result.changes,
                    userEvent: "input.turninto.batch",
                  });
                }
                if (result.skipped > 0) {
                  new Notice(
                    t("Skipped {n} structural blocks.").replace(
                      "{n}",
                      String(result.skipped)
                    )
                  );
                }
                this.clearBlockSelection();
              })
          );
        }
        menu.showAtMouseEvent(evt);
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

      /**
       * Match a rendered Callout's DOM back onto the source rows it came
       * from, so a paragraph or list item inside the rendered box can be
       * pointed at, highlighted and dragged exactly like a bare source row.
       * The two orders are the same order — Markdown renders in document
       * order — so a straight zip is enough, with one wrinkle: a run of
       * list items renders as ONE <ul>, whose <li> children are the items.
       * Anything the zip cannot account for (a columns row with its
       * resizers, a plugin that injects markup) returns null and leaves the
       * whole Callout as the grabbable block.
       */
      calloutRows(
        widget: HTMLElement,
        info: { startLine: number; endLine: number }
      ): Array<{ block: BlockRange; element: HTMLElement }> | null {
        const doc = this.view.state.doc;
        const cached = this.calloutRowCache.get(widget);
        // Rects are read fresh every time, but a re-render replaces the
        // elements themselves — those measure as nothing.
        if (
          cached &&
          cached.doc === doc &&
          (!cached.rows || cached.rows[0].element.isConnected)
        ) return cached.rows;
        const rows = this.buildCalloutRows(widget, info, doc);
        this.calloutRowCache.set(widget, { doc, rows });
        return rows;
      }

      buildCalloutRows(
        widget: HTMLElement,
        info: { startLine: number; endLine: number },
        doc: Text
      ): Array<{ block: BlockRange; element: HTMLElement }> | null {
        const root = widget.querySelector<HTMLElement>(":scope > .callout");
        if (!root || info.endLine > doc.lines) return null;
        const title = root.querySelector<HTMLElement>(":scope > .callout-title");
        if (!title) return null;
        const group: BlockRange = {
          startLine: info.startLine,
          endLine: info.endLine,
        };
        const rows: Array<{ block: BlockRange; element: HTMLElement }> = [
          // The title row stands for itself; hovering it resolves to the
          // whole Callout through innerBlockAt().
          { block: { startLine: group.startLine, endLine: group.startLine }, element: title },
        ];
        const content = root.querySelector<HTMLElement>(":scope > .callout-content");
        const inner = quoteInnerBlocks(doc, group, this.fences);
        if (!content) return inner.length === 0 ? rows : null;
        let next = 0;
        for (const child of Array.from(content.children)) {
          const element = child as HTMLElement;
          const items = element.matches("ul, ol")
            ? Array.from(element.children).filter((li) => li.matches("li"))
            : null;
          for (const target of items ?? [element]) {
            const block = inner[next++];
            if (!block) return null;
            rows.push({ block, element: target as HTMLElement });
          }
        }
        return next === inner.length ? rows : null;
      }

      /** Rendered Callout row covering `lineNo`, smallest block first. */
      calloutRowFor(
        lineNo: number
      ): { block: BlockRange; element: HTMLElement } | null {
        const doc = this.view.state.doc;
        if (lineNo < 1 || lineNo > doc.lines) return null;
        // Only a quote can be inside a rendered Callout; skipping the rest
        // keeps this off the hot path of every hover and drag frame.
        if (!RE_QUOTE.test(doc.line(lineNo).text)) return null;
        const found = this.widgetForPos(doc.line(lineNo).from);
        if (!found) return null;
        const rows = this.calloutRows(found.element, found.info);
        if (!rows) return null;
        let best: { block: BlockRange; element: HTMLElement } | null = null;
        for (const row of rows) {
          if (lineNo < row.block.startLine || lineNo > row.block.endLine) continue;
          const span = row.block.endLine - row.block.startLine;
          if (!best || span < best.block.endLine - best.block.startLine) best = row;
        }
        return best;
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
            // A rendered Callout: aim at the row of the box the pointer is
            // actually over, so its paragraphs and list items are reachable
            // without opening the source first.
            const rows = this.calloutRows(widget, info);
            if (rows) {
              let best: BlockRange | null = null;
              let nearest = Infinity;
              for (const row of rows) {
                const rect = row.element.getBoundingClientRect();
                if (rect.height <= 0) continue;
                const distance =
                  y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
                if (distance < nearest) {
                  nearest = distance;
                  best = row.block;
                }
              }
              if (best) return this.view.state.doc.line(best.startLine).from;
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

      /** Vertical span of the ROW a position sits on — the `.cm-line` box,
       *  padding included.
       *
       *  coordsAtPos measures a caret, not a row, and the two differ twice
       *  over. It leaves out the padding Obsidian spells block spacing
       *  with; and asked about a line END — which is equally the start of
       *  the next line — CodeMirror resolves the position forward, so the
       *  bottom edge came from the row BELOW the block. Every highlight
       *  therefore reached a row too far and overlapped its neighbour,
       *  drawing its edges across the text in between. */
      lineRowRect(pos: number): { top: number; bottom: number } | null {
        const doc = this.view.state.doc;
        const line = doc.lineAt(Math.max(0, Math.min(doc.length, pos)));
        // Measured from the line's START, where that ambiguity does not
        // exist. A `.cm-line` box already spans every visual row the line
        // wraps to, so one lookup answers for both edges.
        try {
          const mapped = this.view.domAtPos(line.from).node;
          const element = mapped.nodeType === 1
            ? mapped as Element
            : mapped.parentElement;
          const row = element?.closest<HTMLElement>(".cm-line");
          if (row && this.view.contentDOM.contains(row)) {
            const rect = row.getBoundingClientRect();
            if (rect.height > 0) return { top: rect.top, bottom: rect.bottom };
          }
        } catch {
          // The line can be redrawn between DOM lookup and measurement.
        }
        return this.heightMapSpan(line.from);
      }

      /** Row span straight from CodeMirror's height map: no DOM lookup and
       *  no forced layout, and it answers for rows that are scrolled out of
       *  the rendered viewport entirely. */
      heightMapSpan(pos: number): { top: number; bottom: number } | null {
        try {
          const lb = this.view.lineBlockAt(pos);
          return {
            top: this.view.documentTop + lb.top,
            bottom: this.view.documentTop + lb.bottom,
          };
        } catch {
          return null;
        }
      }

      /** Screen Y of a position's line edge; layout geometry covers lines
       *  hidden inside rendered widgets, where coordsAtPos returns null. */
      posY(pos: number, edge: "top" | "bottom"): number | null {
        const sourceRow = this.sourceRowRect(pos);
        if (sourceRow) return edge === "top" ? sourceRow.top : sourceRow.bottom;
        const doc = this.view.state.doc;
        const calloutRow = this.calloutRowFor(
          doc.lineAt(Math.min(pos, doc.length)).number
        );
        if (calloutRow) {
          const rect = calloutRow.element.getBoundingClientRect();
          if (rect.height > 0) return edge === "top" ? rect.top : rect.bottom;
        }
        const row = this.lineRowRect(pos);
        if (row) return edge === "top" ? row.top : row.bottom;
        const c = this.view.coordsAtPos(pos);
        if (c) return edge === "top" ? c.top : c.bottom;
        return null;
      }

      /** Screen rect of a block (top of first line → bottom of last line). */
      blockRect(block: BlockRange): { top: number; bottom: number } | null {
        const doc = this.view.state.doc;
        // A whole rendered widget keeps its own box, padding included; the
        // per-row lookup below would trim it to its text.
        const widget = this.widgetForPos(doc.line(block.startLine).from);
        if (
          widget &&
          widget.info.startLine === block.startLine &&
          widget.info.endLine === block.endLine
        ) {
          const rect = widget.element.getBoundingClientRect();
          if (rect.height > 0) return { top: rect.top, bottom: rect.bottom };
        }
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
        // hover tint with the real painted edge instead. A row INSIDE a
        // Callout aligns with the row, not with the box around it.
        const structural =
          !!fenceAt(this.fences, block.startLine) ||
          (!block.quotePrefix && RE_QUOTE.test(firstLine.text));
        const insideCallout = block.quotePrefix
          ? this.calloutRowFor(block.startLine)?.element.getBoundingClientRect()
          : undefined;
        const painted = insideCallout?.width
          ? insideCallout.left
          : structural
            ? this.structuralPaintLeft(firstLine.from)
            : block.quotePrefix
              // Source rows of a Callout: start at the row's own text, not
              // at the editor edge outside the box.
              ? this.view.coordsAtPos(firstLine.from)?.left
              : undefined;
        const xOff = Math.min(this.blockVisualOffset(block), contentRect.width / 2);
        const left = painted != null && painted >= contentRect.left - 20
          ? painted - 2
          : contentRect.left + xOff - 6;
        const right = insideCallout?.width
          ? Math.min(insideCallout.right + 2, contentRect.right + 6)
          : contentRect.right + 6;
        this.highlight.style.display = "block";
        this.highlight.style.left = `${left}px`;
        this.highlight.style.width = `${Math.max(0, right - left)}px`;
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
        const eventTarget = e.target as Element | null;
        if (eventTarget?.closest?.(".nf-columns-editor")) {
          this.hideHover();
          return;
        }
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
        // The smallest block the mouse is in — this is exactly what a drag
        // would move, and exactly what gets highlighted. Inside a Callout
        // that is the row itself; its title row still grabs the whole box.
        const block = innerBlockAt(this.view.state.doc, line.number, this.fences);
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
          isTableRow(doc.line(block.startLine).text) && tableWidget
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
        const wholeWidget = this.widgetForPos(startPos);
        // One row of a rendered Callout carries its own geometry; the
        // widget's own box only belongs to the Callout as a whole.
        const calloutRow =
          wholeWidget &&
          (wholeWidget.info.startLine !== block.startLine ||
            wholeWidget.info.endLine !== block.endLine)
            ? this.calloutRowFor(block.startLine)
            : null;
        const calloutRect = calloutRow?.element.getBoundingClientRect();
        const widgetAtStart = calloutRect?.height ? null : wholeWidget;
        // coordsAtPos(line.from) is the editor edge before literal Markdown
        // indentation. Quote/fence controls belong beside the visible block
        // marker/content column instead.
        const coords = sourceRow || calloutRect?.height
          ? null
          : this.view.coordsAtPos(visualPos);
        const rectTop = coords ? null : this.posY(doc.line(block.startLine).from, "top");
        if (!coords && !calloutRect?.height && rectTop == null) {
          this.hideHover();
          return;
        }
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        // Vertically center on the first line (headings are taller); for a
        // widget-rendered block (table) sit at its top edge instead.
        const firstRow = sourceRow ??
          (calloutRect?.height
            ? {
                top: calloutRect.top,
                bottom: Math.min(
                  calloutRect.bottom,
                  calloutRect.top + this.view.defaultLineHeight
                ),
              }
            : widgetAtStart
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
        // A row inside a quote is anchored on its own content, not on the
        // container's painted edge — that edge belongs to the Callout.
        const structuralSource = !widgetAtStart && !calloutRect &&
          (!!fenceAt(this.fences, block.startLine) ||
            (!block.quotePrefix && RE_QUOTE.test(firstLine.text)));
        const structuralLeft = structuralSource
          ? this.structuralPaintLeft(startPos) ?? contentRect.left + xOff - 16
          : undefined;
        const anchorX =
          calloutRect?.left ??
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
        if (this.dragging || this.pendingDrag || this.selecting || this.pendingSelect) return;
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
        this.clearBlockSelection();
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
        this.dragBaseQuotePrefix = pending.block.quotePrefix ?? "";
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
        const depth = quotePrefixDepth(block.quotePrefix);
        const source = doc.sliceString(
          doc.line(block.startLine).from,
          doc.line(Math.min(block.endLine, block.startLine + 5)).to
        );
        // The ghost previews the block, not the container it is riding in.
        const raw = depth > 0 ? rewriteQuotePrefix(source, depth, "") : source;
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

      /** Notion's create-a-column gesture: the pointer parked at the right
       * edge of a top-level block targets "beside it", not "between rows". */
      columnDropTarget(x: number, y: number): BlockRange | null {
        const drag = this.dragBlock;
        if (!drag || !plugin.settings.columnLayout) return null;
        // A columns row is built out of quote markers, so a block that is
        // already riding inside a Callout has to leave it first.
        if (drag.quotePrefix) return null;
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const zone = Math.min(96, contentRect.width * 0.15);
        if (x < contentRect.right - zone) return null;
        const pos = this.posAt(x, y);
        if (pos == null) return null;
        const doc = this.view.state.doc;
        const target = getBlockRange(doc, doc.lineAt(pos).number, this.fences);
        if (!target) return null;
        // Never beside itself; only top-level, non-blank targets.
        if (target.startLine <= drag.endLine && target.endLine >= drag.startLine) {
          return null;
        }
        const first = doc.line(target.startLine).text;
        if (RE_BLANK.test(first) || indentWidth(first) !== 0) return null;
        return target;
      }

      updateDropTarget(x: number, y: number) {
        if (!this.dragBlock) return;

        const colTarget = this.columnDropTarget(x, y);
        const colRect = colTarget ? this.blockRect(colTarget) : null;
        // Only a target the bar can actually mark counts — state and
        // visuals must never disagree about what a drop will do.
        this.dropColumnsTarget = colRect ? colTarget : null;
        if (colTarget && colRect) {
          const contentRect = this.view.contentDOM.getBoundingClientRect();
          this.indicator.style.display = "none";
          this.colIndicator.style.display = "block";
          this.colIndicator.style.left = `${contentRect.right - 10}px`;
          this.colIndicator.style.top = `${colRect.top}px`;
          this.colIndicator.style.height = `${colRect.bottom - colRect.top}px`;
          this.showHighlight(this.dragBlock);
          return;
        }
        this.colIndicator.style.display = "none";

        const pos = this.posAt(x, y);
        const doc = this.view.state.doc;
        // An ordinary row means "outside any quote". This explicit empty
        // prefix also lets a previously quoted block be dragged back out.
        let pointedQuotePrefix = "";
        let target: number;
        if (pos == null) {
          target = y < this.view.contentDOM.getBoundingClientRect().top ? 1 : doc.lines + 1;
        } else {
          const line = doc.lineAt(pos);
          const hoveredFence = fenceAt(this.fences, line.number);
          pointedQuotePrefix = hoveredFence?.quotePrefix ??
            quotePrefixParts(line.text)?.quotePrefix ?? "";
          const top = this.posY(line.from, "top");
          const bottom = this.posY(line.to, "bottom");
          const mid = top != null && bottom != null ? (top + bottom) / 2 : y;
          target = y < mid ? line.number : line.number + 1;
        }

        // Snap to block boundaries: never allow a drop that would split a
        // block. Inside a Callout the boundaries are the rows of the
        // Callout, not the Callout — that is what makes the gaps between
        // them droppable.
        if (target >= 1 && target <= doc.lines) {
          const tb = innerBlockAt(doc, target, this.fences);
          if (tb && tb.startLine < target && tb.endLine + 1 > target) {
            const rect = this.blockRect(tb);
            const mid = rect ? (rect.top + rect.bottom) / 2 : y;
            target = y < mid ? tb.startLine : tb.endLine + 1;
          }
        }
        this.dropLine = target;

        // Horizontal distance from the grab point chooses the level: list
        // nesting outside a quote, quote depth inside one, on one ladder.
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const cands = this.dropCandidatesLine === target
          ? this.dropCandidates
          : computeDropLevels(doc, this.fences, target, this.dragBlock);
        if (this.dropCandidatesLine !== target) {
          this.dropCandidatesLine = target;
          this.dropCandidates = cands;
        }
        const level = pickDropLevel(
          cands,
          pointedQuotePrefix,
          this.dragBaseIndent,
          x - this.dragStartX,
          this.visualIndentStep
        );
        this.dropIndent = level.indent;
        this.dropQuotePrefix = level.quotePrefix;

        const visualLevel = Math.max(0, cands.indexOf(level));
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
        this.dropColumnsTarget = null;
        this.dropLine = -1;
        this.dropIndent = undefined;
        this.dropQuotePrefix = undefined;
        this.dropCandidatesLine = -1;
        this.dropCandidates = [];
        this.dragStartX = 0;
        this.dragBaseIndent = 0;
        this.dragBaseQuotePrefix = "";
        this.ownerDocument.body.classList.remove("nf-dragging");
        this.handle.classList.remove("is-dragging");
        this.highlight.classList.remove("is-dragging");
        this.indicator.style.display = "none";
        this.colIndicator.style.display = "none";
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
        const dropQuotePrefix = this.dropQuotePrefix;
        const colTarget = this.dropColumnsTarget;
        this.endDrag();
        if (pending) {
          // Click without drag → block menu.
          openBlockMenu(
            this.view,
            pending.block,
            this.fences,
            e,
            plugin,
            plugin.settings.slashCommands,
            plugin.settings.columnLayout,
            plugin.settings.toggleBlocks
          );
        } else if (wasDragging && block && colTarget) {
          dropAsColumn(this.view, block, colTarget);
        } else if (wasDragging && block && dropLine > 0) {
          moveBlock(
            this.view,
            block,
            dropLine,
            this.fences,
            dropIndent,
            vaultIndentUnit(plugin.app),
            dropQuotePrefix
          );
        }
      }

      update(update: ViewUpdate) {
        if (update.geometryChanged) this.listIndentCache = null;
        if (update.geometryChanged || update.viewportChanged) {
          this.hideHover();
          if (this.selectedBlocks.length > 0) {
            this.ownerWindow.requestAnimationFrame(() => this.renderBlockSelection());
          }
        }
        if (update.docChanged) {
          this.fences = cachedFences(update.state.doc);
          // An inline-format pass rewrites characters, never rows, so the
          // selection's line numbers still describe the same blocks. Any
          // other edit — typing, undo, a sync from disk — can move them, and
          // acting on stale numbers would edit whatever moved into place.
          if (
            this.selfEdit > 0 &&
            update.startState.doc.lines === update.state.doc.lines &&
            this.selectedBlocks.length > 0 &&
            this.selectedBlocks[this.selectedBlocks.length - 1].endLine <=
              update.state.doc.lines
          ) {
            this.ownerWindow.requestAnimationFrame(() => this.renderBlockSelection());
          } else {
            this.clearBlockSelection();
          }
          this.dropCandidatesLine = -1;
          this.dropCandidates = [];
          // Hover geometry is stale after an edit; next mousemove re-shows.
          this.hideHover();
        }
      }

      destroy() {
        this.view.scrollDOM.removeEventListener("mousemove", this.onMouseMove, true);
        this.view.scrollDOM.removeEventListener("mousedown", this.onEditorMouseDown, true);
        this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
        this.view.scrollDOM.removeEventListener("mouseleave", this.onLeave);
        this.view.contentDOM.removeEventListener("blur", this.onEditorBlur, true);
        this.view.contentDOM.removeEventListener("keydown", this.onSelectKeyDown);
        this.ownerWindow.removeEventListener("blur", this.onWindowBlur);
        if (this.activeLeafChangeRef) {
          plugin.app.workspace.offref(this.activeLeafChangeRef);
          this.activeLeafChangeRef = null;
        }
        if (this.focusCleanupTimer != null) {
          this.ownerWindow.clearTimeout(this.focusCleanupTimer);
          this.focusCleanupTimer = null;
        }
        this.ownerDocument.removeEventListener("mousemove", this.onDocMove, true);
        this.ownerDocument.removeEventListener("mouseup", this.onDocUp, true);
        this.ownerDocument.removeEventListener("mousemove", this.onSelectMove, true);
        this.ownerDocument.removeEventListener("mouseup", this.onSelectUp, true);
        this.ownerDocument.removeEventListener("keydown", this.onKeyDown, true);
        this.disarmSelectionScope();
        this.stopAutoScroll();
        if (this.dragging) this.ownerDocument.body.classList.remove("nf-dragging");
        this.controls.remove();
        this.indicator.remove();
        this.colIndicator.remove();
        this.highlight.remove();
        this.ghost.remove();
        this.marquee.remove();
        this.selectionLayer.remove();
        this.selectionToolbar.remove();
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
/* Syntax highlighting for code inside a quote or Callout              */
/*                                                                     */
/* Obsidian highlights a TOP-LEVEL fence with the CodeMirror 5 modes    */
/* its `window.CodeMirror` shim carries. Inside a blockquote its parser */
/* never recognises the fence at all (the body arrives as one long      */
/* inline-code span), so those rows stay a flat wall of text. Drive the */
/* very same modes here and emit the very same `cm-*` token classes, so */
/* quoted code is coloured by the vault's theme exactly like unquoted   */
/* code — no bundled highlighter, no second palette to keep in step.    */
/* ------------------------------------------------------------------ */

/** The slice of CodeMirror 5 that tokenizing needs. Obsidian publishes it
 * on `window`; tests pass a stand-in. */
interface LegacyCodeMirror {
  getMode(config: unknown, spec: unknown): LegacyMode | null;
  findModeByName?(name: string): { name?: string; mime?: string; mode?: string } | null;
  StringStream: new (
    text: string,
    tabSize: number,
    lineOracle?: unknown
  ) => LegacyStream;
}

interface LegacyStream {
  start: number;
  pos: number;
  eol(): boolean;
}

interface LegacyMode {
  name?: string;
  token(stream: LegacyStream, state: unknown): string | null | undefined;
  startState?: () => unknown;
  blankLine?: (state: unknown) => void;
}

export interface CodeTokenSpan {
  from: number;
  to: number;
  cls: string;
}

export function legacyCodeMirror(scope: unknown): LegacyCodeMirror | null {
  const cm = (scope as { CodeMirror?: LegacyCodeMirror } | null)?.CodeMirror;
  if (!cm || typeof cm.getMode !== "function") return null;
  if (typeof cm.StringStream !== "function") return null;
  return cm;
}

/** `getMode` answers an unknown language with the do-nothing "null" mode.
 * Resolving through the mode table first lets aliases ("py", "sh", "c++")
 * reach the same mode Obsidian's own language flair names. */
export function resolveLegacyMode(
  cm: LegacyCodeMirror,
  language: string
): LegacyMode | null {
  const name = language.trim().toLowerCase();
  if (!name) return null;
  let spec: unknown = name;
  try {
    const info = cm.findModeByName?.(name);
    if (info) spec = info.mime ?? info.mode ?? name;
  } catch {
    spec = name;
  }
  let mode: LegacyMode | null = null;
  try {
    mode = cm.getMode({ tabSize: 4, indentUnit: 4 }, spec);
  } catch {
    return null;
  }
  if (!mode || typeof mode.token !== "function") return null;
  return mode.name === "null" ? null : mode;
}

/** CodeMirror 5 styles are space-separated token names ("variable-2",
 * "string property"). Obsidian's stylesheet colours the `cm-` prefixed
 * form of each, which is exactly what a native code block renders. */
export function legacyTokenClass(style: string | null | undefined): string {
  if (!style) return "";
  return style
    .split(/\s+/)
    .filter((part) => part && !part.startsWith("line-"))
    .map((part) => `cm-${part}`)
    .join(" ");
}

/** Run one mode over consecutive code lines, carrying its state across
 * them: a template literal, a block comment or an unterminated string is
 * only coloured correctly when the rows are tokenized as one run. */
export function tokenizeCodeLines(
  cm: LegacyCodeMirror,
  mode: LegacyMode,
  lines: string[]
): CodeTokenSpan[][] {
  const state = mode.startState ? mode.startState() : {};
  const rows: CodeTokenSpan[][] = [];
  for (const text of lines) {
    const spans: CodeTokenSpan[] = [];
    if (!text) {
      try {
        mode.blankLine?.(state);
      } catch {
        // A mode that cannot digest an empty row still has to leave the
        // rows around it coloured.
      }
      rows.push(spans);
      continue;
    }
    let stream: LegacyStream;
    try {
      stream = new cm.StringStream(text, 4, {});
    } catch {
      rows.push(spans);
      continue;
    }
    let guard = 0;
    while (!stream.eol() && guard++ < text.length + 16) {
      let style: string | null | undefined = null;
      try {
        style = mode.token(stream, state);
      } catch {
        // Half-written source is normal while typing; keep whatever the
        // mode produced before it gave up and leave the rest plain.
        break;
      }
      // A mode that consumed nothing would spin forever. Step one
      // character so the row still finishes, uncoloured at worst.
      if (stream.pos <= stream.start) stream.pos = stream.start + 1;
      const cls = legacyTokenClass(style);
      if (cls) spans.push({ from: stream.start, to: stream.pos, cls });
      stream.start = stream.pos;
    }
    rows.push(spans);
  }
  return rows;
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

export function makeNestedIndentPlugin(plugin: NotionFlowPlugin) {
  return ViewPlugin.fromClass(
    class NestedIndentView {
      view: EditorView;
      decorations: DecorationSet;
      fences: FenceRange[];
      frame: number | null = null;
      styleWatch: MutationObserver;
      /** Token spans per quoted fence, keyed by its opening line. Cleared
       * whenever the document changes; scrolling reuses them. */
      codeSpans = new Map<number, Map<number, CodeTokenSpan[]>>();
      calloutRenders = new Map<
        HTMLElement,
        { component: Component; signature: string; container: HTMLElement }
      >();
      calloutRenderRequests = new Map<
        HTMLElement,
        { component: Component; signature: string; container: HTMLElement }
      >();

      constructor(view: EditorView) {
        this.view = view;
        this.fences = cachedFences(view.state.doc);
        this.decorations = this.build(view);
        // The measured layer offsets live in each line's style attribute,
        // which CM and Obsidian's own indent styling rewrite on their own
        // schedule (decoration redraws, async font/metric passes). Losing
        // the race leaves nested lines on the coarse estimate — visibly so
        // for --nf-quote-cont, whose fallback is 0. A measured --nf-nest is
        // always a px value, so a nested line whose --nf-nest still holds
        // the var()-based estimate marks a clobbered style: re-measure.
        this.styleWatch = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            const el = mutation.target as HTMLElement;
            if (!el.classList?.contains("nf-nested-block")) continue;
            const nest = el.style.getPropertyValue("--nf-nest");
            if (!nest || nest.includes("var(")) {
              this.scheduleWidgetSync();
              return;
            }
          }
        });
        this.styleWatch.observe(view.contentDOM, {
          attributes: true,
          attributeFilter: ["style"],
          subtree: true,
        });
        // Late font loading changes glyph metrics without any CM update.
        view.dom.ownerDocument.fonts?.ready
          ?.then(() => this.scheduleWidgetSync())
          .catch(() => {});
        this.scheduleWidgetSync();
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.fences = cachedFences(update.state.doc);
          this.codeSpans.clear();
        }
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
        // HyperMD only gives the FIRST line of a quote nested in a list the
        // list-line hanging indent (later lines' leading whitespace becomes
        // hmd-indent-in-quote before the list continuation branch runs), so
        // every following line of the block renders one list level too far
        // left. Measure each line's ">" column relative to its own box —
        // margin-invariant, so repeated syncs stay stable — and push
        // continuation lines right by the deficit via --nf-quote-cont.
        let prevQuote: {
          lineNo: number;
          indent: number;
          headOffset: number;
        } | null = null;
        for (const range of view.visibleRanges) {
          let pos = range.from;
          while (pos <= range.to) {
            const line = doc.lineAt(pos);
            pos = line.to + 1;
            const fence = fenceAt(this.fences, line.number);
            const quote = !fence && RE_QUOTE.test(line.text);
            const inlineQuote = !fence
              ? inlineListQuoteMarker(line.text)
              : null;
            if (!quote && !inlineQuote && !(fence && fence.indent > 0)) continue;

            if (inlineQuote) {
              try {
                const start = this.view.coordsAtPos(
                  line.from + inlineQuote.from,
                  1
                );
                const el = this.lineElement(line.from);
                if (start && el) {
                  const offset = start.left - el.getBoundingClientRect().left;
                  if (Number.isFinite(offset) && offset >= 0) {
                    el.style.setProperty("--nf-inline-quote-left", `${offset}px`);
                  }
                }
              } catch {
                // The visible line was replaced between the viewport walk
                // and measurement. The next animation frame recalculates it.
              }
              continue;
            }

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
            if (!quote || !Number.isFinite(offset)) continue;
            const indent = indentWidth(line.text);
            if (
              prevQuote &&
              prevQuote.lineNo === line.number - 1 &&
              prevQuote.indent === indent
            ) {
              const delta = prevQuote.headOffset - offset;
              if (delta > 0.5) {
                el.style.setProperty("--nf-quote-cont", `${delta}px`);
              } else {
                el.style.removeProperty("--nf-quote-cont");
              }
              prevQuote = {
                lineNo: line.number,
                indent,
                headOffset: prevQuote.headOffset,
              };
            } else {
              el.style.removeProperty("--nf-quote-cont");
              prevQuote = { lineNo: line.number, indent, headOffset: offset };
            }
          }
        }
      }

      releaseCalloutRender(widget: HTMLElement) {
        const rendered = this.calloutRenders.get(widget);
        if (rendered) {
          this.calloutRenders.delete(widget);
          plugin.removeChild(rendered.component);
        }
        const pending = this.calloutRenderRequests.get(widget);
        if (pending) {
          this.calloutRenderRequests.delete(widget);
          plugin.removeChild(pending.component);
        }
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
        const sourcePath = sourcePathForEditorView(
          plugin.app.workspace,
          this.view
        );
        const signature = `${sourcePath}\u0000${block.startLine}:${block.endLine}:${source}`;
        const existing = this.calloutRenders.get(widget);
        const pending = this.calloutRenderRequests.get(widget);
        if (
          pending?.signature === signature &&
          pending.container === container
        ) return;
        if (pending) {
          this.calloutRenderRequests.delete(widget);
          plugin.removeChild(pending.component);
        }
        if (existing?.container !== container) {
          this.calloutRenders.delete(widget);
          if (existing) plugin.removeChild(existing.component);
        } else if (existing.signature === signature) {
          widget.classList.remove("nf-repairing-callout");
          return;
        }

        const component = plugin.addChild(new Component());
        const record = { component, signature, container };
        this.calloutRenderRequests.set(widget, record);
        widget.classList.add("nf-repairing-callout");
        void commitStagedRender(
          container,
          (staging) => MarkdownRenderer.render(
            plugin.app,
            source,
            staging,
            sourcePath,
            component
          ),
          {
            shouldCommit: () =>
              this.calloutRenderRequests.get(widget) === record &&
              widget.isConnected &&
              widget.contains(container),
            validate: (staging) => !!staging.querySelector(".callout"),
          }
        ).then((committed) => {
          if (this.calloutRenderRequests.get(widget) !== record) return;
          this.calloutRenderRequests.delete(widget);
          if (!committed) {
            plugin.removeChild(component);
            widget.classList.remove("nf-repairing-callout");
            if (!this.calloutRenders.has(widget)) {
              widget.classList.remove("nf-repaired-callout");
            }
            return;
          }
          const previous = this.calloutRenders.get(widget);
          if (previous) plugin.removeChild(previous.component);
          this.calloutRenders.set(widget, record);
          widget.classList.remove("nf-repairing-callout");
          widget.classList.add("nf-repaired-callout");
        });
      }

      syncWidgets() {
        const content = this.view.contentDOM;
        const renderedWidgets = new Set([
          ...this.calloutRenders.keys(),
          ...this.calloutRenderRequests.keys(),
        ]);
        for (const widget of renderedWidgets) {
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

      /** Token spans for one quoted fence, keyed by source line. The whole
       * body is tokenized at once even when only part of it is on screen:
       * a mode's state is what makes row N's colour correct, so starting
       * at the viewport would paint a scrolled-into-view string as code. */
      quotedCodeSpans(
        doc: Text,
        fence: FenceRange
      ): Map<number, CodeTokenSpan[]> | null {
        const cached = this.codeSpans.get(fence.startLine);
        if (cached) return cached;
        const spans = new Map<number, CodeTokenSpan[]>();
        this.codeSpans.set(fence.startLine, spans);
        // A popout window is a separate global; Obsidian publishes the shim
        // on the main one, so that is the fallback.
        const cm =
          legacyCodeMirror(this.view.dom.ownerDocument.defaultView) ??
          legacyCodeMirror(typeof window === "undefined" ? null : window);
        if (!cm) return spans;
        const language = fenceLanguageSpan(doc, fence.startLine)?.language ?? "";
        const mode = resolveLegacyMode(cm, language);
        if (!mode) return spans;
        const lastLine = fence.closed ? fence.endLine - 1 : fence.endLine;
        const numbers: number[] = [];
        const texts: string[] = [];
        for (let n = fence.startLine + 1; n <= lastLine; n++) {
          const line = doc.line(n);
          const prefix = quoteMarkerPrefix(line.text);
          // A row that lost its quote markers has left the block; the rows
          // below it are no longer this fence's code.
          if (prefix == null) break;
          numbers.push(n);
          texts.push(line.text.slice(prefix.length));
        }
        const rows = tokenizeCodeLines(cm, mode, texts);
        for (let i = 0; i < numbers.length; i++) {
          if (rows[i]?.length) spans.set(numbers[i], rows[i]);
        }
        return spans;
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
            const inlineQuote = !f
              ? inlineListQuoteMarker(line.text)
              : null;
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
            // A fence or a list living inside a blockquote: HyperMD leaves
            // those rows as plain quote text, so the plugin supplies the
            // code-block chrome and the list bullet itself.
            // An unclosed fence runs to the end of the document, but a
            // quoted one really ends where its blockquote does — without
            // this the rows below an in-progress ``` would all be painted
            // as code while the user is still typing the opener.
            const quotedFence =
              f && f.quoteDepth > 0 && RE_QUOTE.test(line.text) ? f : null;
            const quotedList =
              !f && !inlineQuote ? quotedListMarker(line.text) : null;
            if (quotedFence) {
              const classes = ["nf-qcode"];
              if (line.number === quotedFence.startLine) {
                classes.push("nf-qcode-begin");
              }
              if (quotedFence.closed && line.number === quotedFence.endLine) {
                classes.push("nf-qcode-end");
              }
              builder.add(
                line.from,
                line.from,
                Decoration.line({
                  attributes: {
                    class: classes.join(" "),
                    // The gap widget that stands in for the ">" markers sizes
                    // itself from this depth. Publishing it on the line too
                    // lets a wrapped row resume at the same text column —
                    // the widget is inline, so the wrap cannot see its width.
                    style: `--nf-prefix-depth:${quotePrefixDepth(
                      quoteMarkerPrefix(line.text) ?? ""
                    )};`,
                  },
                })
              );
            }
            if (quotedList) {
              builder.add(
                line.from,
                line.from,
                Decoration.line({
                  attributes: {
                    class: quotedList.ordered
                      ? "nf-qlist nf-qlist-ol"
                      : "nf-qlist nf-qlist-ul",
                  },
                })
              );
            }
            if (inlineQuote) {
              builder.add(
                line.from,
                line.from,
                Decoration.line({
                  attributes: { class: "nf-inline-list-quote" },
                })
              );
              builder.add(
                line.from + inlineQuote.from,
                line.from + inlineQuote.to,
                Decoration.mark({ class: "nf-inline-list-quote-marker" })
              );
              if (line.from + inlineQuote.to < line.to) {
                builder.add(
                  line.from + inlineQuote.to,
                  line.to,
                  Decoration.mark({ class: "nf-inline-list-quote-content" })
                );
              }
            }
            if (quotedList) {
              // Obsidian's own .list-bullet paints the dot, so a quoted
              // bullet is the same glyph, size, and color as every other
              // one in the vault — including themes that restyle it.
              builder.add(
                line.from + quotedList.from,
                line.from + quotedList.to,
                Decoration.mark({
                  class: quotedList.ordered
                    ? "nf-qlist-marker"
                    : "nf-qlist-marker list-bullet",
                })
              );
            }
            // Colour the code Obsidian left plain. Added last on the row so
            // the builder still receives strictly increasing positions: the
            // line decorations above all sit at line.from, these never do.
            if (quotedFence && line.number > quotedFence.startLine) {
              const spans = this.quotedCodeSpans(doc, quotedFence)?.get(
                line.number
              );
              if (spans) {
                const prefix = quoteMarkerPrefix(line.text)?.length ?? 0;
                const limit = line.to - line.from - prefix;
                for (const span of spans) {
                  const from = Math.min(span.from, limit);
                  const to = Math.min(span.to, limit);
                  if (to <= from) continue;
                  builder.add(
                    line.from + prefix + from,
                    line.from + prefix + to,
                    Decoration.mark({ class: span.cls })
                  );
                }
              }
            }
            pos = line.to + 1;
          }
        }
        return builder.finish();
      }

      destroy() {
        const win = this.view.dom.ownerDocument.defaultView ?? window;
        if (this.frame != null) win.cancelAnimationFrame(this.frame);
        this.styleWatch.disconnect();
        const renderedWidgets = new Set([
          ...this.calloutRenders.keys(),
          ...this.calloutRenderRequests.keys(),
        ]);
        for (const widget of renderedWidgets) {
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
 * properties into the decoration (no ':', ';', '/' or quotes). The bare
 * <b>/<i>/<s> tags are what the toolbar writes inside fenced code blocks,
 * where Markdown markers would stay literal text. Comment anchors carry
 * their note in data-nf-cmt — the value is display-only text (tooltip,
 * modal, title attribute), never style or markup, so its charset only
 * excludes what would break the attribute itself. */
const RE_NF_TAG =
  /<span style="color:([-\w(),.%# ]{1,64})">|<mark style="background:([-\w(),.%# ]{1,64});color:inherit">|<span class="nf-cmt" data-nf-cmt="([^"<>]*)">|<span class="nf-(?:cell|tbl)-[a-z]{1,12}">|<[ubis]>|<\/(?:span|mark|u|b|i|s)>/g;

/** Rendered style for each bare formatting tag the plugin understands. */
const BARE_TAG_STYLES: Record<string, string> = {
  u: "text-decoration:underline",
  b: "font-weight:bold",
  i: "font-style:italic",
  s: "text-decoration:line-through",
};

export interface TagPair {
  open: { from: number; to: number };
  close: { from: number; to: number };
  /** Inline style re-applied to the inner text, or null (cell markers). */
  style: string | null;
  /** Raw (still attribute-encoded) comment text of an nf-cmt anchor. */
  comment: string | null;
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
    el: "span" | "mark" | "u" | "b" | "i" | "s";
    style: string | null;
    comment: string | null;
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
          comment: open.comment,
        });
        break;
      }
    } else {
      const bare = /^<([ubis])>$/.exec(m[0])?.[1];
      stack.push({
        from,
        to,
        el: bare
          ? (bare as Open["el"])
          : m[0].startsWith("<mark")
            ? "mark"
            : "span",
        style: bare
          ? BARE_TAG_STYLES[bare]
          : m[1]
            ? `color:${m[1]}`
            : m[2]
              ? `background:${m[2]}`
              : null,
        comment: m[3] ?? null,
      });
    }
  }
  return pairs;
}

export interface HtmlConcealPolicy {
  concealHtml: boolean;
  commenting: boolean;
}

/** Comment anchors and ordinary formatting tags have independent settings.
 * Keep this decision shared by decorations, atomic ranges, and boundary
 * deletion so no source token is protected unless it is actually hidden. */
export function shouldConcealTagPair(
  pair: Pick<TagPair, "comment">,
  policy: HtmlConcealPolicy
): boolean {
  return pair.comment != null ? policy.commenting : policy.concealHtml;
}

/** The exact tag pairs hidden by the current HTML/comment settings. */
export function concealedTagPairs(
  text: string,
  policy: HtmlConcealPolicy
): TagPair[] {
  return findColorTagPairs(text).filter((pair) =>
    shouldConcealTagPair(pair, policy)
  );
}

/** Whether the boundary-delete keymap has any concealed syntax to protect. */
export function concealBoundaryProtectionEnabled(
  policy: HtmlConcealPolicy & { concealMarkdown: boolean }
): boolean {
  return policy.concealMarkdown || policy.concealHtml || policy.commenting;
}

/* ------------------------------------------------------------------ */
/* Comments (Notion-style annotations)                                 */
/*                                                                     */
/* A comment lives entirely inside the note: the anchored text is       */
/* wrapped in <span class="nf-cmt" data-nf-cmt="…">…</span>, with the   */
/* note text attribute-encoded in data-nf-cmt. Live Preview shows a     */
/* yellow anchor plus a 💬 icon that opens the editor; Reading view     */
/* shows the anchor with a hover tooltip. Without the plugin the span   */
/* is inert HTML — the anchored text reads normally, the note stays     */
/* invisible.                                                           */
/* ------------------------------------------------------------------ */

/** Comment text → attribute-safe form. Only what would break the
 * attribute or the tag shape is escaped, so CJK text stays readable in
 * source. Newlines become &#10; to keep the tag on one line. */
export function encodeCommentAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r?\n/g, "&#10;");
}

/** Inverse of encodeCommentAttr. `&amp;` is decoded LAST, so encoded
 * literals ("&amp;#10;") can never double-decode. */
export function decodeCommentAttr(value: string): string {
  return value
    .replace(/&#10;/g, "\n")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** The full anchor markup for a comment on `selected`, or null when the
 * selection cannot carry one (empty, or spanning lines). */
export function buildCommentWrap(selected: string, comment: string): string | null {
  if (!selected || selected.includes("\n")) return null;
  const body = comment.trim();
  if (!body) return null;
  return `<span class="nf-cmt" data-nf-cmt="${encodeCommentAttr(body)}">${selected}</span>`;
}

/** Modal editor for one comment: write, save, or resolve (remove). */
/** Notion-style inline comment editor: a small floating card anchored to
 * the commented text instead of a full-screen modal, so writing a note
 * never leaves the page. Enter saves (IME composition is respected, so
 * confirming Chinese input never submits), Shift+Enter breaks the line,
 * Esc cancels, and clicking elsewhere saves any change and closes. */
class CommentPopover {
  private el: HTMLDivElement | null = null;
  private input: HTMLTextAreaElement | null = null;
  private readonly initial: string;
  private readonly doc: Document;
  private readonly win: Window;

  constructor(
    private view: EditorView,
    private anchor: number,
    initial: string | null,
    private onSave: (text: string) => void,
    private onResolve: (() => void) | null
  ) {
    this.initial = initial ?? "";
    this.doc = view.dom.ownerDocument;
    this.win = this.doc.defaultView ?? window;
  }

  open() {
    activeCommentPopover?.close();
    activeCommentPopover = this;
    const el = (this.el = this.doc.body.createDiv({ cls: "nf-cmt-pop" }));
    el.setAttribute("aria-label", t("Comment"));
    const input = (this.input = el.createEl("textarea", {
      cls: "nf-cmt-input",
      attr: { placeholder: t("Write a comment…"), rows: "3" },
    }));
    input.value = this.initial;
    input.addEventListener("input", () => {
      this.autogrow();
      this.position();
    });
    input.addEventListener("keydown", this.onKeyDown);
    const footer = el.createDiv({ cls: "nf-cmt-pop-footer" });
    footer.createSpan({
      cls: "nf-cmt-hint",
      text: t("Enter saves · Shift+Enter breaks the line"),
    });
    const actions = footer.createDiv({ cls: "nf-cmt-pop-actions" });
    if (this.onResolve) {
      const resolve = this.onResolve;
      const btn = actions.createEl("button", {
        cls: "mod-warning",
        text: t("Resolve"),
      });
      btn.addEventListener("click", () => {
        this.close();
        resolve();
      });
    }
    const save = actions.createEl("button", { cls: "mod-cta", text: t("Save") });
    save.addEventListener("click", () => this.submit());
    this.doc.addEventListener("mousedown", this.onDocMouseDown, true);
    this.doc.addEventListener("scroll", this.onReposition, true);
    this.win.addEventListener("resize", this.onReposition);
    this.autogrow();
    this.position();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  private onKeyDown = (evt: KeyboardEvent) => {
    // An IME composition owns Enter/Escape while it is open.
    if (evt.isComposing || evt.keyCode === 229) return;
    if (evt.key === "Escape") {
      evt.preventDefault();
      evt.stopPropagation();
      this.close();
      this.view.focus();
      return;
    }
    if (evt.key === "Enter" && !evt.shiftKey) {
      evt.preventDefault();
      this.submit();
    }
  };

  /** Clicking anywhere else keeps the click and commits any edit — losing
   * a typed note to a stray click would be worse than saving it. */
  private onDocMouseDown = (evt: MouseEvent) => {
    if (this.el && evt.composedPath().includes(this.el)) return;
    const text = (this.input?.value ?? "").trim();
    this.close();
    if (text && text !== this.initial.trim()) this.onSave(text);
  };

  private onReposition = () => this.position();

  private autogrow() {
    const input = this.input;
    if (!input) return;
    input.style.height = "auto";
    input.style.height =
      Math.min(input.scrollHeight + 2, Math.round(this.win.innerHeight * 0.4)) + "px";
  }

  private position() {
    const el = this.el;
    if (!el) return;
    let coords: { left: number; top: number; bottom: number } | null = null;
    try {
      coords = this.view.coordsAtPos(
        Math.min(this.anchor, this.view.state.doc.length)
      );
    } catch {
      // The editor may already be gone; keep the card where it was.
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = this.win.innerWidth;
    const vh = this.win.innerHeight;
    let left: number;
    let top: number;
    if (coords) {
      left = Math.min(Math.max(8, coords.left - 12), vw - w - 8);
      top = coords.bottom + 8;
      if (top + h > vh - 8) top = Math.max(8, coords.top - h - 8);
    } else {
      const rect = this.view.dom.getBoundingClientRect();
      left = Math.min(Math.max(8, rect.left + 24), vw - w - 8);
      top = Math.max(8, Math.min(vh - h - 8, rect.top + 48));
    }
    el.style.left = left + "px";
    el.style.top = top + "px";
  }

  private submit() {
    const text = (this.input?.value ?? "").trim();
    this.close();
    if (text) this.onSave(text);
  }

  close() {
    if (activeCommentPopover === this) activeCommentPopover = null;
    this.doc.removeEventListener("mousedown", this.onDocMouseDown, true);
    this.doc.removeEventListener("scroll", this.onReposition, true);
    this.win.removeEventListener("resize", this.onReposition);
    this.el?.remove();
    this.el = null;
    this.input = null;
  }
}

let activeCommentPopover: CommentPopover | null = null;

/** Open the editor for the comment whose anchor contains `pos`. Saving
 * rewrites the open tag's attribute; resolving deletes both tags and
 * leaves the anchored text as plain prose. Both re-verify that the tags
 * still sit untouched before dispatching. */
function openCommentAt(view: EditorView, pos: number) {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const rel = pos - line.from;
  const pair = findColorTagPairs(line.text).find(
    (p) => p.comment != null && rel >= p.open.from && rel <= p.close.to
  );
  if (!pair) return;
  const openText = line.text.slice(pair.open.from, pair.open.to);
  const closeText = line.text.slice(pair.close.from, pair.close.to);
  const open = { from: line.from + pair.open.from, to: line.from + pair.open.to };
  const close = { from: line.from + pair.close.from, to: line.from + pair.close.to };
  const intact = () =>
    view.state.doc.sliceString(open.from, Math.min(open.to, view.state.doc.length)) ===
      openText &&
    view.state.doc.sliceString(close.from, Math.min(close.to, view.state.doc.length)) ===
      closeText;
  new CommentPopover(
    view,
    pos,
    decodeCommentAttr(pair.comment ?? ""),
    (text) => {
      if (!intact()) return;
      view.dispatch({
        changes: {
          from: open.from,
          to: open.to,
          insert: `<span class="nf-cmt" data-nf-cmt="${encodeCommentAttr(text)}">`,
        },
        userEvent: "input.comment",
      });
    },
    () => {
      if (!intact()) return;
      view.dispatch({
        changes: [
          { from: open.from, to: open.to },
          { from: close.from, to: close.to },
        ],
        userEvent: "delete.comment",
      });
    }
  ).open();
}

/** Comment on the current selection: validate it, ask for the text, wrap. */
function startAddComment(plugin: NotionFlowPlugin, view: EditorView) {
  if (!plugin.settings.commenting) return;
  const sel = view.state.selection.main;
  const selected = view.state.sliceDoc(sel.from, sel.to);
  if (!selected) {
    new Notice(t("Select some text to comment on."));
    return;
  }
  if (selected.includes("\n")) {
    new Notice(t("Comments cover a single line of text."));
    return;
  }
  const { from, to } = sel;
  new CommentPopover(
    view,
    to,
    null,
    (text) => {
      if (view.state.doc.sliceString(from, to) !== selected) return;
      const wrap = buildCommentWrap(selected, text);
      if (!wrap) return;
      view.dispatch({
        changes: { from, to, insert: wrap },
        selection: { anchor: from + wrap.length },
        userEvent: "input.comment",
      });
      view.focus();
    },
    null
  ).open();
}

/** The 💬 marker rendered in place of a comment's closing tag. */
class CommentIconWidget extends WidgetType {
  constructor(readonly tooltip: string) {
    super();
  }

  eq(other: CommentIconWidget) {
    return other.tooltip === this.tooltip;
  }

  toDOM(view: EditorView): HTMLElement {
    const el = view.dom.ownerDocument.createElement("span");
    el.className = "nf-cmt-icon";
    el.setAttribute("title", this.tooltip);
    el.setAttribute("role", "button");
    // The same 💬 the raw-element paths draw via CSS ::after, so the
    // marker never changes shape when a line enters or leaves editing.
    el.textContent = "💬";
    el.addEventListener("mousedown", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
    });
    el.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      try {
        openCommentAt(view, view.posAtDOM(el));
      } catch {
        // The widget may already be detached from the editor.
      }
    });
    return el;
  }
}

/**
 * Reading view shows fenced code as literal text, so the HTML formatting
 * tags the toolbar writes inside code blocks would appear verbatim there.
 * Restyle a rendered <code> element in place: wrap each formatted stretch
 * of text in a real styled span, then delete the tag text itself. Only
 * text nodes are split, wrapped, or trimmed, so any structure the syntax
 * highlighter created stays intact.
 */
/** Text nodes of `el` with their global text offsets, in document order. */
function collectCodeTextNodes(el: HTMLElement) {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: { node: CharacterData; start: number }[] = [];
  let offset = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as CharacterData;
    nodes.push({ node, start: offset });
    offset += node.data.length;
  }
  return nodes;
}

/** Wrap each text-node slice covered by a span in a styled <span>. Only
 * text nodes are split, so highlighter structure survives. */
function applyCodeSpans(
  codeEl: HTMLElement,
  spans: { from: number; to: number; style: string }[]
) {
  const doc = codeEl.ownerDocument;
  for (const span of spans) {
    for (const { node, start } of collectCodeTextNodes(codeEl)) {
      const from = Math.max(span.from, start);
      const to = Math.min(span.to, start + node.data.length);
      if (from >= to) continue;
      const range = doc.createRange();
      range.setStart(node, from - start);
      range.setEnd(node, to - start);
      const el = doc.createElement("span");
      el.setAttribute("style", span.style);
      el.setAttribute("data-nf-code", "");
      range.surroundContents(el);
    }
  }
}

export function renderCodeFormattingTags(codeEl: HTMLElement) {
  const full = codeEl.textContent ?? "";
  if (!/<\/(?:span|mark|u|b|i|s)>/.test(full)) return;
  const pairs = findColorTagPairs(full).filter((pair) => pair.style != null);
  if (pairs.length === 0) return;
  const tags = pairs
    .flatMap((pair) => [pair.open, pair.close])
    .sort((a, b) => a.from - b.from);
  // Styled ranges expressed in post-deletion coordinates, so they can be
  // re-applied after any later re-render that keeps the clean text.
  const shiftAt = (pos: number) => {
    let shift = 0;
    for (const tag of tags) {
      if (tag.to > pos) break;
      shift += tag.to - tag.from;
    }
    return shift;
  };
  const spans = pairs
    .filter((pair) => pair.open.to < pair.close.from)
    .map((pair) => ({
      from: pair.open.to - shiftAt(pair.open.to),
      to: pair.close.from - shiftAt(pair.close.from),
      style: pair.style!,
    }));
  const expectedLength =
    full.length - tags.reduce((sum, tag) => sum + (tag.to - tag.from), 0);
  // Remove the tag text, back to front so earlier offsets stay valid
  // across tags. Within one tag the snapshot keeps node-local offsets
  // correct even when the tag spans several highlighter text nodes.
  for (const tag of [...tags].reverse()) {
    for (const { node, start } of collectCodeTextNodes(codeEl)) {
      const from = Math.max(tag.from, start);
      const to = Math.min(tag.to, start + node.data.length);
      if (from >= to) continue;
      node.deleteData(from - start, to - from);
    }
  }
  applyCodeSpans(codeEl, spans);
  // Obsidian's syntax highlighter may re-render the block later from its
  // (now clean) text, wiping the styled wrappers. Re-apply them once.
  const observer = new MutationObserver(() => {
    observer.disconnect();
    if (
      (codeEl.textContent ?? "").length === expectedLength &&
      !codeEl.querySelector("[data-nf-code]")
    ) {
      applyCodeSpans(codeEl, spans);
    }
  });
  observer.observe(codeEl, { childList: true, subtree: true });
}

function makeConcealPlugin(plugin: NotionFlowPlugin) {
  return ViewPlugin.fromClass(
    class ConcealView {
      view: EditorView;
      ownerDocument: Document;
      ownerWindow: Window & typeof globalThis;
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
        const dom = this.ownerDocument.getSelection();
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
          ? this.ownerDocument.caretRangeFromPoint?.(
              this.lastClick.x,
              this.lastClick.y
            )
          : null;
        if (caret) {
          let root: Node | null =
            caret.startContainer instanceof this.ownerWindow.Element
              ? caret.startContainer
              : caret.startContainer.parentElement;
          while (
            root instanceof this.ownerWindow.Element &&
            root.parentElement &&
            !root.parentElement.classList.contains("cm-line")
          ) {
            root = root.parentElement;
          }
          if (
            root instanceof this.ownerWindow.Element &&
            root.contains(caret.startContainer)
          ) {
            const walker = this.ownerDocument.createTreeWalker(
              root,
              this.ownerWindow.NodeFilter.SHOW_TEXT
            );
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
        this.ownerDocument = view.dom.ownerDocument;
        this.ownerWindow = (this.ownerDocument.defaultView ?? window) as Window &
          typeof globalThis;
        this.build(view);
        this.scheduleCommentTitles(view);
        view.dom.addEventListener("mousedown", this.onMouseDown, true);
        view.dom.addEventListener("click", this.onClick, true);
        this.ownerDocument.addEventListener("mouseup", this.onMouseUp, true);
        this.ownerDocument.addEventListener("selectionchange", this.onSelChange);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.build(update.view);
        // Inactive lines render comment spans as Obsidian's own inline-HTML
        // widgets, which carry no tooltip. Widgets (re)mount after this
        // update — including when the caret merely leaves the line — so
        // top up the title attributes a frame later.
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.scheduleCommentTitles(update.view);
        }
      }

      scheduleCommentTitles(view: EditorView) {
        if (!plugin.settings.commenting) return;
        const win = view.dom.ownerDocument.defaultView ?? window;
        win.requestAnimationFrame(() => {
          for (const el of Array.from(
            view.contentDOM.querySelectorAll<HTMLElement>(
              'span.nf-cmt[data-nf-cmt]:not([title])'
            )
          )) {
            el.setAttribute(
              "title",
              decodeCommentAttr(el.getAttribute("data-nf-cmt") ?? "")
            );
          }
        });
      }

      destroy() {
        this.view.dom.removeEventListener("mousedown", this.onMouseDown, true);
        this.view.dom.removeEventListener("click", this.onClick, true);
        this.ownerDocument.removeEventListener("mouseup", this.onMouseUp, true);
        this.ownerDocument.removeEventListener("selectionchange", this.onSelChange);
      }

      build(view: EditorView) {
        this.decorations = Decoration.none;
        this.hidden = Decoration.none;
        this.pairs = [];
        // Comment anchors render under their own setting, independent of
        // the generic HTML-tag concealment.
        if (!plugin.settings.concealHtml && !plugin.settings.commenting) return;
        // Source mode shows source; conceal only in Live Preview (this
        // also covers editors embedded in Live Preview table cells).
        const mode = view.dom.closest(".markdown-source-view");
        if (mode && !mode.classList.contains("is-live-preview")) return;
        const marks: Range<Decoration>[] = [];
        const hide: Range<Decoration>[] = [];
        for (const range of view.visibleRanges) {
          const text = view.state.doc.sliceString(range.from, range.to);
          for (const pair of concealedTagPairs(text, plugin.settings)) {
            const isComment = pair.comment != null;
            const open = { from: range.from + pair.open.from, to: range.from + pair.open.to };
            const close = { from: range.from + pair.close.from, to: range.from + pair.close.to };
            hide.push(Decoration.replace({}).range(open.from, open.to));
            if (isComment) {
              // The closing tag becomes the 💬 marker; the anchored text
              // itself gets the Notion-style highlight and a tooltip.
              const note = decodeCommentAttr(pair.comment ?? "");
              hide.push(
                Decoration.replace({
                  widget: new CommentIconWidget(note),
                }).range(close.from, close.to)
              );
              if (open.to < close.from) {
                marks.push(
                  Decoration.mark({
                    class: "nf-cmt-anchor",
                    attributes: { title: note },
                  }).range(open.to, close.from)
                );
              }
            } else {
              hide.push(Decoration.replace({}).range(close.from, close.to));
              if (pair.style && open.to < close.from) {
                marks.push(
                  Decoration.mark({ attributes: { style: pair.style } }).range(open.to, close.from)
                );
              }
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

/* ------------------------------------------------------------------ */
/* Heading markers on the active line                                  */
/*                                                                     */
/* Obsidian hides "## " once the caret leaves the row and shows it     */
/* again on the active one, which is why a heading you are still       */
/* writing does not look like a heading yet. Notion has no such state: */
/* the marker is consumed the moment it is typed. The Markdown must    */
/* keep it, so the marker is concealed instead — and revealed again    */
/* the moment the caret steps in front of it, which is the one place   */
/* it can still be read and deleted.                                   */
/* ------------------------------------------------------------------ */

/** A heading's "#…# " run: the marker and the whitespace after it. */
export interface HeadingPrefix {
  from: number;
  to: number;
}

const RE_HEADING_PREFIX = /^(#{1,6})([ \t]+)(?=\S)/;

/**
 * Concealable heading markers on the lines touching [from, to].
 *
 * A marker with no heading text after it is left alone: a lone "#" is a
 * heading being typed, and hiding it would make the row look empty and the
 * next keystroke unexplainable. Fenced code has no headings, and a heading
 * inside a quote or Callout keeps its container's markers — only the "#"
 * run belongs to the heading itself.
 */
export function collectHeadingPrefixes(
  doc: Text,
  from: number,
  to: number,
  fences: FenceRange[] = cachedFences(doc)
): HeadingPrefix[] {
  const prefixes: HeadingPrefix[] = [];
  const firstLine = doc.lineAt(Math.max(0, Math.min(from, doc.length))).number;
  const lastLine = doc.lineAt(Math.max(0, Math.min(to, doc.length))).number;
  for (let n = firstLine; n <= lastLine; n++) {
    if (fenceAt(fences, n)) continue;
    const line = doc.line(n);
    const quote = quoteMarkerPrefix(line.text) ?? "";
    const rest = line.text.slice(quote.length);
    // Leading spaces are the row's own indentation, not the marker's.
    const indent = rest.match(/^[ \t]{0,3}/)?.[0] ?? "";
    const match = RE_HEADING_PREFIX.exec(rest.slice(indent.length));
    if (!match) continue;
    const start = line.from + quote.length + indent.length;
    prefixes.push({ from: start, to: start + match[0].length });
  }
  return prefixes;
}

/**
 * Whether a heading marker stays hidden for this selection. Revealed when
 * a selection reaches into it or sits in front of it — a caret exactly at
 * the heading text, which is where typing "## " leaves it, is past the
 * marker and keeps it hidden.
 */
export function headingPrefixHidden(
  prefix: HeadingPrefix,
  selections: readonly { from: number; to: number }[]
): boolean {
  return !selections.some(
    (selection) => selection.from < prefix.to && selection.to >= prefix.from
  );
}

/**
 * Backspace at a heading's text start removes the whole marker, the way it
 * already removes a whole ">" in a quote. Concealed, this is the only way
 * back to a paragraph; and taking one "#" of the run instead would leave a
 * heading a level down that nobody asked for.
 */
export function headingMarkerDeletePlan(
  doc: Text,
  head: number,
  fences: FenceRange[] = cachedFences(doc)
): BlockTextChange | null {
  const line = doc.lineAt(head);
  const [prefix] = collectHeadingPrefixes(doc, line.from, line.from, fences);
  if (!prefix || prefix.to !== head) return null;
  return { from: prefix.from, to: prefix.to, insert: "" };
}

/**
 * Whether the line holding a single caret is an empty block waiting for
 * content — the one place a hint about the "/" menu belongs.
 *
 * Empty INSIDE its container: a blank row in a Callout is as empty as one
 * at the top level, and its markers are the container's, not content. A
 * blank row inside a fence is code, so it is left alone.
 */
export function emptyHintLine(
  doc: Text,
  selection: { ranges: readonly { empty: boolean; head: number }[] },
  fences: FenceRange[] = cachedFences(doc)
): number | null {
  if (selection.ranges.length !== 1 || !selection.ranges[0].empty) return null;
  const line = doc.lineAt(selection.ranges[0].head);
  if (!RE_BLANK.test(line.text.replace(RE_QUOTE_PREFIX, ""))) return null;
  if (fenceAt(fences, line.number)) return null;
  return line.number;
}

/**
 * Notion's empty-block hint. The text itself lives in CSS (`--nf-empty-hint`,
 * set from the translation once at load) because it is generated content:
 * a widget would be a real DOM node the caret and the selection would have
 * to be kept out of, for a string nobody can edit.
 */
function makeEmptyHintPlugin(plugin: NotionFlowPlugin) {
  return ViewPlugin.fromClass(
    class EmptyHintView {
      decorations: DecorationSet = Decoration.none;

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
        // The hint names the slash menu, so it stands down with it.
        if (!plugin.settings.emptyLineHint || !plugin.settings.slashCommands) return;
        if (!isLivePreviewEditor(view)) return;
        // A table cell runs its own editor: an empty cell is a cell, not an
        // empty block, and the slash menu does not open there.
        if (view.dom.parentElement?.closest(".cm-editor")) return;
        const doc = view.state.doc;
        const lineNo = emptyHintLine(doc, view.state.selection);
        if (lineNo == null) return;
        this.decorations = Decoration.set([
          Decoration.line({ class: "nf-empty-hint" }).range(doc.line(lineNo).from),
        ]);
      }
    },
    { decorations: (view) => view.decorations }
  );
}

function makeHeadingConcealPlugin(plugin: NotionFlowPlugin) {
  const headingView = ViewPlugin.fromClass(
    class HeadingConcealView {
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
        if (!plugin.settings.concealHeadings) return;
        if (!isLivePreviewEditor(view)) return;
        if (view.visibleRanges.length === 0) return;
        const doc = view.state.doc;
        const first = view.visibleRanges[0];
        const last = view.visibleRanges[view.visibleRanges.length - 1];
        const selections = view.state.selection.ranges;
        const hidden: Range<Decoration>[] = [];
        for (const prefix of collectHeadingPrefixes(doc, first.from, last.to)) {
          if (!headingPrefixHidden(prefix, selections)) continue;
          hidden.push(Decoration.replace({}).range(prefix.from, prefix.to));
        }
        this.hidden = Decoration.set(hidden, true);
        this.decorations = this.hidden;
      }
    },
    {
      decorations: (view) => view.decorations,
      // Atomic, so arrowing left off the heading text lands in front of the
      // marker rather than inside it — which is also what reveals it.
      provide: (extension) =>
        EditorView.atomicRanges.of(
          (view) => view.plugin(extension)?.hidden ?? Decoration.none
        ),
    }
  );
  // Above the quote keymap's Backspace: inside "> # Title" both have an
  // answer for the text start, and the heading marker is the inner one.
  const escape = Prec.highest(
    keymap.of([
      {
        key: "Backspace",
        run: (view) => {
          if (!plugin.settings.concealHeadings) return false;
          const selection = view.state.selection;
          if (selection.ranges.length !== 1 || !selection.main.empty) {
            return false;
          }
          const plan = headingMarkerDeletePlan(view.state.doc, selection.main.head);
          if (!plan) return false;
          view.dispatch({
            changes: plan,
            selection: { anchor: plan.from },
            scrollIntoView: true,
            userEvent: "delete.backward",
          });
          return true;
        },
      },
    ])
  );
  return [headingView, escape];
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
  // Heading markers are deliberately absent here. This protection skips
  // ACROSS a concealed range and deletes beyond it, which is right for an
  // inline marker mid-line and wrong for one at a line start: it would
  // reach past the marker to the line break and join the heading onto the
  // paragraph above. Backspace at a heading's text is handled instead by
  // headingMarkerDeletePlan, which removes the marker itself.
  //
  // HTML and Markdown markers can be directly adjacent, for example
  // <u>**text**</u>. Protect the union or deletion can cross one atomic
  // range only to remove the neighbouring hidden range.
  if (plugin.settings.concealHtml || plugin.settings.commenting) {
    for (const visible of view.visibleRanges) {
      const text = view.state.doc.sliceString(visible.from, visible.to);
      for (const pair of concealedTagPairs(text, plugin.settings)) {
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
      !concealBoundaryProtectionEnabled(plugin.settings) ||
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

function captionPrefixForImage(text: string): string {
  return (
    quoteMarkerPrefix(text) ??
    text.match(RE_LEADING_WS)?.[0] ??
    ""
  );
}

/** Insert, rewrite, or remove the metadata row owned by a code/image
 * block. The metadata is one transaction so undo restores both caption
 * and fold state together. */
function setBlockCaptionMeta(
  view: EditorView,
  kind: BlockCaptionKind,
  ownerLine: number,
  caption: string,
  collapsed = false,
  focusOwner = false
) {
  const doc = view.state.doc;
  const fences = cachedFences(doc);
  const fence = kind === "code" ? fenceAt(fences, ownerLine) : null;
  if (kind === "code" && !fence) return;
  // A table owner is given by its first row but ends several rows later.
  const table = kind === "table" ? getTableRange(doc, ownerLine, fences) : null;
  if (kind === "table" && !table) return;
  const ownerEnd = fence?.endLine ?? table?.endLine ?? ownerLine;
  const current =
    kind === "code"
      ? codeCaptionMeta(doc, fence!)
      : kind === "table"
        ? tableCaptionMeta(doc, table!.endLine)
        : imageCaptionMeta(doc, ownerLine);
  const prefix =
    current?.prefix ??
    (kind === "code"
      ? fence!.bodyPrefix
      : captionPrefixForImage(doc.line(ownerLine).text));
  const next = buildBlockCaption(kind, caption, collapsed, prefix);
  let changes:
    | { from: number; to?: number; insert?: string }
    | null = null;
  if (current) {
    const line = doc.line(current.lineNo);
    changes = next
      ? { from: line.from, to: line.to, insert: next }
      : {
          // Keep the following row's existing newline, removing only the
          // metadata row and the newline immediately before it.
          from: doc.line(current.lineNo - 1).to,
          to: line.to,
          insert: "",
        };
  } else if (next) {
    changes = {
      from: doc.line(ownerEnd).to,
      insert: "\n" + next,
    };
  }
  if (!changes) return;
  // Folding is the one direction that takes rows away. The fold button acts
  // from wherever the caret happens to be, and a caret already inside the
  // block would be swallowed by a fold triggered from anywhere else, so both
  // routes have to hand the caret out of the block before its rows go dark.
  const foldingAwayCaret =
    kind === "code" &&
    collapsed &&
    (focusOwner ||
      selectionTouchesLines(
        selectionLineSpans(doc, view.state.selection.ranges),
        fence!.startLine,
        fence!.endLine
      ));
  let anchor: number | null = focusOwner
    ? doc.line(fence?.startLine ?? ownerLine).to
    : null;
  if (foldingAwayCaret) {
    const exit = codeFoldExitPlan(doc, fence!, current?.lineNo ?? ownerEnd);
    if (exit.append) {
      // One combined insert: a separate change at the same position would
      // leave the two rows' order down to how the ChangeSet sorts them.
      changes = { ...changes, insert: (changes.insert ?? "") + exit.append };
    }
    const mapped = view.state.changes(changes);
    anchor = exit.pos == null ? mapped.newLength : mapped.mapPos(exit.pos, 1);
  }
  view.dispatch({
    changes,
    ...(anchor == null
      ? {}
      : { selection: { anchor }, scrollIntoView: true }),
    userEvent: "input.block-caption",
  });
  if (focusOwner) view.focus();
}

function editBlockCaption(
  plugin: NotionFlowPlugin,
  view: EditorView,
  kind: BlockCaptionKind,
  ownerLine: number
) {
  const doc = view.state.doc;
  const fences = cachedFences(doc);
  const fence = kind === "code" ? fenceAt(fences, ownerLine) : null;
  if (kind === "code" && !fence) return;
  const table = kind === "table" ? getTableRange(doc, ownerLine, fences) : null;
  if (kind === "table" && !table) return;
  const current =
    kind === "code"
      ? codeCaptionMeta(doc, fence!)
      : kind === "table"
        ? tableCaptionMeta(doc, table!.endLine)
        : imageCaptionMeta(doc, ownerLine);
  new TextPromptModal(plugin.app, {
    title: t("Edit caption"),
    placeholder: t("Write a caption…"),
    initial: current?.caption ?? "",
    onSave: (caption) =>
      setBlockCaptionMeta(
        view,
        kind,
        fence?.startLine ?? ownerLine,
        caption,
        current?.collapsed ?? false
      ),
  }).open();
}

const BLOCK_MENU_OPEN_CLASS = "nf-block-menu-open";
const BLOCK_MENU_OPEN_EVENT = "nf:block-menu-open";

function isBlockMenuTarget(target: EventTarget | null): boolean {
  const el = target as Element | null;
  return typeof el?.closest === "function" && !!el.closest(".nf-block-menu-anchor");
}

/**
 * The block types the handle menu and the turn-into commands share.
 *
 * `digit` is Notion's own chord for the type, kept in Notion's order so the
 * muscle memory transfers: 0 text, 1-3 headings, 4 to-do, 5 bulleted,
 * 6 numbered, 7 toggle. Notion spends 8 and 9 on code and sub-pages, which
 * have no turn-into here, so quote takes 9 and the digit row stays whole.
 */
const TURN_INTO: {
  id: string;
  title: string;
  command: string;
  icon: string;
  prefix: string;
  digit: string;
}[] = [
  { id: "text", title: t("Text"), command: t("Turn into text"), icon: "pilcrow", prefix: "", digit: "0" },
  { id: "h1", title: t("Heading 1"), command: t("Turn into Heading 1"), icon: "heading-1", prefix: "# ", digit: "1" },
  { id: "h2", title: t("Heading 2"), command: t("Turn into Heading 2"), icon: "heading-2", prefix: "## ", digit: "2" },
  { id: "h3", title: t("Heading 3"), command: t("Turn into Heading 3"), icon: "heading-3", prefix: "### ", digit: "3" },
  { id: "todo", title: t("To-do"), command: t("Turn into to-do"), icon: "check-square", prefix: "- [ ] ", digit: "4" },
  { id: "bullet", title: t("Bulleted list"), command: t("Turn into bulleted list"), icon: "list", prefix: "- ", digit: "5" },
  { id: "number", title: t("Numbered list"), command: t("Turn into numbered list"), icon: "list-ordered", prefix: "1. ", digit: "6" },
  { id: "quote", title: t("Quote"), command: t("Turn into quote"), icon: "quote", prefix: "> ", digit: "9" },
];

/**
 * The container types a block is wrapped INTO, sharing the handle menu and
 * a chord with `TURN_INTO` above.
 *
 * Notion's digits continue here — 7 toggle, 8 code — and the Callout, which
 * Notion has no block for, takes the letter of its own name rather than a
 * digit Notion spends elsewhere.
 */
const WRAP_INTO: {
  kind: BlockWrapKind;
  title: string;
  command: string;
  icon: string;
  key: string;
}[] = [
  { kind: "callout", title: t("Callout"), command: t("Turn into Callout"), icon: "megaphone", key: "C" },
  { kind: "toggle", title: t("Toggle"), command: t("Turn into toggle"), icon: "chevron-right", key: "7" },
  { kind: "code", title: t("Code block"), command: t("Turn into code block"), icon: "code-2", key: "8" },
];

/**
 * Whether a line prefix can retype this block.
 *
 * A fenced code block or a table is a structure the prefix would corrupt.
 * A multi-line quote or Callout cannot be retyped one line at a time —
 * that would leave every remaining ">" row behind and split the block — so
 * it goes through the whole-block transform instead, which the scaffolding
 * types (columns) are excluded from: they own "Unwrap columns".
 */
export function canTurnBlockInto(
  doc: Text,
  block: BlockRange,
  fences: FenceRange[]
): boolean {
  if (fenceAt(fences, block.startLine)) return false;
  const first = doc.line(block.startLine).text;
  if (isTableRow(first)) return false;
  if (!isMultiLineQuoteBlock(doc, block)) return true;
  return !isScaffoldCallout(parseCalloutHeader(first)?.type);
}

/** A quote or Callout spanning more than its own first row. */
function isMultiLineQuoteBlock(doc: Text, block: BlockRange): boolean {
  if (block.endLine <= block.startLine) return false;
  const text = doc.line(block.startLine).text;
  const content = block.quotePrefix
    ? text.slice(quoteMarkerPrefix(text)?.length ?? 0)
    : text;
  return RE_QUOTE.test(content);
}

/**
 * The single edit behind "Turn into <type>". Shared by the block handle
 * menu and the turn-into commands so the pointer and the keyboard retype a
 * block identically. Returns false — dispatching nothing — for a block
 * `canTurnBlockInto` rejects, which is how the commands stay inert inside
 * a code fence or a table instead of damaging one.
 */
export function turnBlockInto(
  view: EditorView,
  block: BlockRange,
  prefix: string,
  fences: FenceRange[]
): boolean {
  const doc = view.state.doc;
  if (!canTurnBlockInto(doc, block, fences)) return false;
  const line = doc.line(block.startLine);
  const whole = isMultiLineQuoteBlock(doc, block)
    ? turnQuoteBlockInto(doc, block, prefix)
    : null;
  // Inside a Callout the "> " markers are the container, not the block:
  // rewrite what they hold and leave them standing.
  const markers = block.quotePrefix ? quoteMarkerPrefix(line.text) ?? "" : "";
  const change = whole ?? {
    from: line.from,
    to: line.to,
    insert: markers + applyLinePrefix(line.text.slice(markers.length), prefix),
  };
  view.dispatch({
    changes: change,
    selection: turnCaret(doc, view.state.selection.main, change),
    userEvent: "input.turninto",
  });
  return true;
}

/**
 * Where the caret lands after a turn-into rewrite.
 *
 * Only a line's leading prefix changes, so the text under the caret keeps
 * its distance from the end of its own line — CodeMirror's own mapping
 * would collapse a caret inside the replaced range to the range's start,
 * dropping the writer at the margin on every conversion. Returns undefined
 * when the caret sits outside the rewrite, where that mapping is right.
 */
function turnCaret(
  doc: Text,
  caret: { head: number; empty: boolean },
  change: BlockTextChange
): { anchor: number } | undefined {
  if (!caret.empty) return undefined;
  if (caret.head < change.from || caret.head > change.to) return undefined;
  const caretLine = doc.lineAt(caret.head);
  const tail = caretLine.to - caret.head;
  const rows = change.insert.split("\n");
  // A title-less Callout header leaves no row behind, so the block can end
  // up one row shorter than it started; clamp rather than run off the end.
  const index = Math.min(
    caretLine.number - doc.lineAt(change.from).number,
    rows.length - 1
  );
  let start = change.from;
  for (let n = 0; n < index; n++) start += rows[n].length + 1;
  const end = start + rows[index].length;
  // A caret parked inside the old marker has no text to keep its distance
  // from, so it would fall out at the row start. The content it was about
  // to be typing in front of begins after the new prefix.
  const content = start + (lineContentSpan(rows[index])?.from ?? 0);
  return { anchor: Math.max(Math.min(content, end), end - tail) };
}

function openBlockMenu(
  view: EditorView,
  block: BlockRange,
  fences: FenceRange[],
  evt: MouseEvent,
  plugin: NotionFlowPlugin,
  slashCommandsEnabled: boolean,
  columnsEnabled = false,
  toggleEnabled = false
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

  const blockFence = fenceAt(fences, block.startLine);
  const isFence = blockFence != null;
  const isTable = !isFence && isTableRow(doc.line(block.startLine).text);
  // A row inside a Callout is quoted without being a quote: its markers are
  // the container's, and a "turn into" rewrites the content they hold.
  const quotePrefix = block.quotePrefix ?? "";
  const blockContent = (lineNo: number) => {
    const text = doc.line(lineNo).text;
    return quotePrefix ? text.slice(quoteMarkerPrefix(text)?.length ?? 0) : text;
  };
  const isImage =
    !isFence &&
    block.startLine <= doc.lines &&
    isImageBlockLine(blockContent(block.startLine));

  // The block reaches past the table when a caption row trails it, and a
  // caption is not a row any table transform may see. Every rewrite below
  // therefore addresses the table's own range.
  const tableRange = isTable ? getTableRange(doc, block.startLine, fences) : null;
  const tableText = tableRange
    ? doc.sliceString(
        doc.line(tableRange.startLine).from,
        doc.line(tableRange.endLine).to
      )
    : blockText;
  if (isTable && tableRange) {
    addLabel("Table");
    const replaceTable = (make: (s: string) => string) =>
      view.dispatch({
        changes: {
          from: doc.line(tableRange.startLine).from,
          to: doc.line(tableRange.endLine).to,
          insert: make(tableText),
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
      const current = tableBgColor(tableText);
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

  if (isTable && tableRange) {
    const meta = tableCaptionMeta(doc, tableRange.endLine);
    menu.addItem((item) =>
      item
        .setTitle(t(meta?.caption ? "Edit caption" : "Add caption"))
        .setIcon("captions")
        .onClick(() =>
          editBlockCaption(plugin, view, "table", tableRange.startLine)
        )
    );
    menu.addSeparator();
  }

  if (blockFence) {
    const meta = codeCaptionMeta(doc, blockFence);
    addLabel("Code block");
    menu.addItem((item) =>
      item
        .setTitle(t(meta?.collapsed ? "Expand code block" : "Collapse code block"))
        .setIcon(meta?.collapsed ? "chevron-down" : "chevron-right")
        .onClick(() =>
          setBlockCaptionMeta(
            view,
            "code",
            blockFence.startLine,
            meta?.caption ?? "",
            !(meta?.collapsed ?? false),
            true
          )
        )
    );
    menu.addItem((item) =>
      item
        .setTitle(t(meta?.caption ? "Edit caption" : "Add caption"))
        .setIcon("captions")
        .onClick(() =>
          editBlockCaption(plugin, view, "code", blockFence.startLine)
        )
    );
    menu.addSeparator();
  } else if (isImage) {
    const meta = imageCaptionMeta(doc, block.startLine);
    addLabel("Image");
    menu.addItem((item) =>
      item
        .setTitle(t(meta?.caption ? "Edit caption" : "Add caption"))
        .setIcon("captions")
        .onClick(() =>
          editBlockCaption(plugin, view, "image", block.startLine)
        )
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

  // Quote/Callout controls: pick (or assign) the Callout type, toggle the
  // fold marker, and downgrade a Callout to a plain quote. Column
  // scaffolding is structure, not a Callout — retyping it would shatter
  // the layout, so nf-cols/nf-col blocks get the Columns section instead.
  const headerType = parseCalloutHeader(doc.line(block.startLine).text)?.type;
  const isColumns = headerType === COLS_TYPE || headerType === COL_TYPE;
  const isToggle = toggleEnabled && headerType === TOGGLE_TYPE;
  if (isToggle) {
    addLabel("Toggle");
    addToggleStateItem(menu, view, block.startLine);
    addCalloutToQuoteItem(menu, view, block.startLine);
    menu.addSeparator();
  } else if (!isFence && !isColumns && RE_QUOTE.test(blockContent(block.startLine))) {
    addLabel("Callout");
    menu.addItem((item) => {
      item.setTitle(t("Callout type")).setIcon("megaphone");
      const withSub = item as unknown as { setSubmenu?: () => Menu };
      if (typeof withSub.setSubmenu === "function") {
        addCalloutTypeItems(withSub.setSubmenu(), view, block.startLine);
      }
    });
    addCalloutFoldItem(menu, view, block.startLine);
    addCalloutToQuoteItem(menu, view, block.startLine);
    menu.addSeparator();
  }

  // Any block can be wrapped in a container: a Callout keeps the text as
  // its content, a toggle keeps the first line as its title, a fence takes
  // the whole thing as code. What each one refuses is canWrapBlockInto's
  // call, so the menu and the wrap commands agree.
  let wrapped = false;
  for (const entry of WRAP_INTO) {
    if (entry.kind === "toggle" && !toggleEnabled) continue;
    if (!canWrapBlockInto(doc, block, fences, entry.kind)) continue;
    wrapped = true;
    menu.addItem((item) =>
      item
        .setTitle(entry.title)
        .setIcon(entry.icon)
        .onClick(() => wrapBlockInto(view, block, entry.kind, fences))
    );
  }
  if (wrapped) menu.addSeparator();

  // Columns: wrap a top-level block into a two-column row, or grow an
  // existing row by one column. (Notion's drag-to-the-right-edge gesture
  // does the same; the menu is the discoverable path.)
  const blockIsBlank = RE_BLANK.test(doc.line(block.startLine).text);
  if (
    columnsEnabled &&
    !blockIsBlank &&
    !quotePrefix &&
    indentWidth(doc.line(block.startLine).text) === 0
  ) {
    addLabel("Columns");
    if (headerType === COLS_TYPE) {
      addColumnsMenuItems(menu, view, block);
    } else {
      menu.addItem((item) =>
        item
          .setTitle(t("Turn into columns"))
          .setIcon("columns-2")
          .onClick(() => {
            const from = doc.line(block.startLine).from;
            const to = doc.line(block.endLine).to;
            const lines = doc.sliceString(from, to).split("\n");
            const wrapped = [
              `> [!${COLS_TYPE}]`,
              ...wrapAsColumn(dedentLines(lines)),
              ">",
              `> > [!${COL_TYPE}]`,
              "> > ",
            ];
            const above = block.startLine > 1 ? doc.line(block.startLine - 1).text : "";
            const below = block.endLine < doc.lines ? doc.line(block.endLine + 1).text : "";
            let text = wrapped.join("\n");
            let caret = from + text.length;
            if (needsProtectedSeam(above, wrapped[0])) {
              text = "\n" + text;
              caret += 1;
            }
            if (needsProtectedSeam(wrapped[wrapped.length - 1], below)) text += "\n";
            view.dispatch({
              changes: { from, to, insert: text },
              selection: { anchor: caret },
              scrollIntoView: true,
              userEvent: "input.columns",
            });
          })
      );
    }
    menu.addSeparator();
  }

  // Which blocks this section can describe is canTurnBlockInto's call, so
  // the menu and the turn-into commands agree on what is convertible.
  if (canTurnBlockInto(doc, block, fences)) {
    addLabel("Turn into");
    for (const entry of TURN_INTO) {
      menu.addItem((item) =>
        item
          .setTitle(entry.title)
          .setIcon(entry.icon)
          .onClick(() => turnBlockInto(view, block, entry.prefix, fences))
      );
    }
    menu.addSeparator();
  }

  menu.addItem((item) =>
    item
      .setTitle(t("Insert block above"))
      .setIcon("plus")
      .onClick(() => insertBlockAbove(view, block, slashCommandsEnabled))
  );
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
        const last = lines[lines.length - 1];
        const seam = seamRowBetween(last, lines[0], quotePrefix);
        const nextText = block.endLine < doc.lines
          ? doc.line(block.endLine + 1).text
          : "";
        const trailing = seamRowBetween(last, nextText, quotePrefix);
        view.dispatch({
          changes: {
            from: insertPos,
            insert:
              (seam === null ? "\n" : `\n${seam}\n`) +
              blockText +
              (trailing === null ? "" : `\n${trailing}`),
          },
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
  /** Grayed out while the selection sits inside a fenced code block. */
  disabledInCode?: boolean;
  /** Hidden while the Comments setting is off. */
  requiresCommenting?: boolean;
}

/** Whether the main selection lies inside a fenced code block's body. */
function inFenceBody(state: EditorState): boolean {
  const sel = state.selection.main;
  return fenceBodyRange(state.doc, sel.from, sel.to) != null;
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

/* Obsidian's Live Preview renders an inline HTML element as ONE widget
 * built from its RAW source on inactive lines. Markdown inside the element
 * therefore stays literal (`<u>**x**</u>` shows the asterisks), and
 * Markdown wrapped around it cannot restyle the widget's interior
 * (`**<u>x</u>**` is not bold). Combined formats only render when the
 * whole stack stays in ONE family — and since underline and colors have no
 * Markdown form, that family must be HTML: `<b><u>x</u></b>`. The helpers
 * below keep every mixed application inside the HTML family. */

/** Whether [from, to] overlaps any plugin HTML tag pair in `source`. */
export function rangeTouchesHtmlPairIn(
  source: string,
  from: number,
  to: number
): boolean {
  return findColorTagPairs(source).some(
    (pair) => pair.open.from < to && pair.close.to > from
  );
}

function selectionTouchesHtmlPair(state: EditorState): boolean {
  const sel = state.selection.main;
  if (sel.empty) return false;
  return rangeTouchesHtmlPairIn(state.doc.toString(), sel.from, sel.to);
}

/** The smallest pair written with exactly these tags whose inner text
 * contains [from, to]. Finds wrappers even when other formats sit between
 * the text and the tag, e.g. the `<u>` around `<u><b>text</b></u>`. */
export function enclosingTagPairIn(
  source: string,
  from: number,
  to: number,
  open: string,
  close: string
): TagPair | null {
  return (
    findColorTagPairs(source)
      .filter(
        (pair) =>
          source.slice(pair.open.from, pair.open.to) === open &&
          source.slice(pair.close.from, pair.close.to) === close &&
          pair.open.to <= from &&
          to <= pair.close.from
      )
      .sort(
        (a, b) =>
          a.close.to - a.open.from - (b.close.to - b.open.from)
      )[0] ?? null
  );
}

function enclosingTagPair(
  state: EditorState,
  open: string,
  close: string
): TagPair | null {
  const sel = state.selection.main;
  if (sel.empty) return null;
  return enclosingTagPairIn(state.doc.toString(), sel.from, sel.to, open, close);
}

/** Delete a pair's two tags, keeping the selection on the same text. */
function removeTagPair(view: EditorView, pair: TagPair) {
  const sel = view.state.selection.main;
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

/** Markdown marker layers convertible to HTML equivalents, longest first
 * so a `***` run peels as `**` then `*`. */
const MD_LAYER_TAGS: [marker: string, open: string, close: string][] = [
  ["**", "<b>", "</b>"],
  ["__", "<b>", "</b>"],
  ["~~", "<s>", "</s>"],
  [
    "==",
    '<mark style="background:var(--text-highlight-bg);color:inherit">',
    "</mark>",
  ],
  ["*", "<i>", "</i>"],
  ["_", "<i>", "</i>"],
];

/** Rewrite Markdown emphasis layers sitting immediately around the
 * selection (`**`, `*`, `~~`, `==`, `_`) into their HTML tag equivalents,
 * innermost outward, so that an HTML format applied next never leaves
 * Markdown wrapped around an HTML element. No-op without such layers. */
export function convertAdjacentMarkersToTags(view: EditorView) {
  const sel = view.state.selection.main;
  if (sel.empty) return;
  const doc = view.state.doc;
  const lineFrom = doc.lineAt(sel.from).from;
  const lineTo = doc.lineAt(sel.to).to;
  let outerFrom = sel.from;
  let outerTo = sel.to;
  const layers: [string, string][] = [];
  for (;;) {
    let matched = false;
    for (const [marker, open, close] of MD_LAYER_TAGS) {
      if (
        outerFrom - marker.length < lineFrom ||
        outerTo + marker.length > lineTo
      ) continue;
      if (
        doc.sliceString(outerFrom - marker.length, outerFrom) === marker &&
        doc.sliceString(outerTo, outerTo + marker.length) === marker
      ) {
        layers.push([open, close]);
        outerFrom -= marker.length;
        outerTo += marker.length;
        matched = true;
        break;
      }
    }
    if (!matched) break;
  }
  if (layers.length === 0) return;
  const prefix = layers.map(([open]) => open).reverse().join("");
  const suffix = layers.map(([, close]) => close).join("");
  view.dispatch({
    changes: [
      { from: outerFrom, to: sel.from, insert: prefix },
      { from: sel.to, to: outerTo, insert: suffix },
    ],
    selection: {
      anchor: outerFrom + prefix.length,
      head: outerFrom + prefix.length + (sel.to - sel.from),
    },
    userEvent: "input",
  });
}

/** Toggle an HTML tag pair without nesting a duplicate inside an already
 * wrapped region and without leaving Markdown markers around HTML. */
export function toggleHtmlWrap(view: EditorView, open: string, close: string) {
  const sel = view.state.selection.main;
  if (sel.empty) return;

  // A Source-mode selection may include both tags, or sit right between
  // them. The generic helper unwraps both shapes.
  if (getWrapState(view.state, open, close) !== "none") {
    toggleWrap(view, open, close);
    return;
  }

  const pair = enclosingTagPair(view.state, open, close);
  if (pair) {
    removeTagPair(view, pair);
    return;
  }

  convertAdjacentMarkersToTags(view);
  toggleWrap(view, open, close);
}

/** Whether the selection itself or any smallest enclosing HTML pair is
 * underlined. Kept shared with toggleUnderline so button state and action
 * cannot disagree when another inline format sits between text and `<u>`. */
export function isUnderlineActive(state: EditorState): boolean {
  return (
    getWrapState(state, "<u>", "</u>") !== "none" ||
    enclosingTagPair(state, "<u>", "</u>") !== null
  );
}

/** Toggle portable HTML underline without nesting a second `<u>` inside an
 * existing underlined region. */
export function toggleUnderline(view: EditorView) {
  toggleHtmlWrap(view, "<u>", "</u>");
}

/* ---------- Inline color (rendered by Obsidian as inline HTML) ---------- */

/**
 * Palette written into the note as CSS variables with a hex fallback, so a
 * color follows the light/dark ink defined in styles.css while still
 * surviving anywhere the plugin's CSS is not loaded.
 */
export const TEXT_COLORS = PALETTE_COLORS.map(paletteTextColor);
export const BG_COLORS = PALETTE_COLORS.map((color) =>
  paletteTint(color, color === "yellow" ? 0.2 : 0.18)
);

/** CSS value → palette name, for the paths that need the name back (math). */
const PALETTE_BY_CSS = new Map<string, PaletteColor>();
PALETTE_COLORS.forEach((name, i) => {
  PALETTE_BY_CSS.set(TEXT_COLORS[i], name);
  PALETTE_BY_CSS.set(BG_COLORS[i], name);
});

const spanOpen = (c: string) => `<span style="color:${c}">`;
const markOpen = (c: string) => `<mark style="background:${c};color:inherit">`;
const RE_SPAN_BEFORE = /<span style="color:[^"]*">$/;
const RE_MARK_BEFORE = /<mark style="background:[^"]*;color:inherit">$/;

/* ---------- LaTeX color ----------
 *
 * A formula cannot be colored the way text is. Wrapping `$e^{i\pi}$` in a
 * <span> breaks it: on inactive Live Preview lines Obsidian renders an
 * inline HTML element as one widget built from its RAW source, so the math
 * would show up as literal dollar signs. The color has to go INSIDE the
 * delimiters instead.
 *
 * Obsidian ships MathJax 3 (tex-chtml-full) with the `html` package, so
 * `\class{…}{…}` survives to the rendered element — and MathJax's `safe`
 * filter only lets through class names matching /^mjx-[-\w.]+$/, hence the
 * mjx- prefix. Styling by class (rather than a literal `\color{#hex}`)
 * keeps formulas on the same light/dark ink as colored text. */

const MATH_TEXT_CLASS = "mjx-nf-";
const MATH_BG_CLASS = "mjx-nfbg-";

export interface MathRange {
  from: number;
  to: number;
  /** Formula source between the delimiters. */
  bodyFrom: number;
  bodyTo: number;
  display: boolean;
}

/** Closing delimiter offset for a formula whose body starts at `from`, or
 * -1 when the run never closes. Inline math may not span a blank line, and
 * neither form may hug its delimiters with whitespace — that rules out
 * prose like "$5 and $7", which Obsidian does not typeset either. */
function mathCloseOffset(text: string, from: number, display: boolean): number {
  if (/\s/.test(text[from] ?? "")) return -1;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "\n" && !display && text[i + 1] === "\n") return -1;
    if (ch !== "$") continue;
    if (display && text[i + 1] !== "$") continue;
    return i > from && !/\s/.test(text[i - 1]) ? i : -1;
  }
  return -1;
}

/** Every `$…$` / `$$…$$` formula in `text`, skipping code fences and code
 * spans where dollar signs are literal. */
export function findMathRanges(text: string): MathRange[] {
  const out: MathRange[] = [];
  let fence: string | null = null;
  let i = 0;
  while (i < text.length) {
    if (i === 0 || text[i - 1] === "\n") {
      const eol = text.indexOf("\n", i);
      const end = eol === -1 ? text.length : eol;
      const opener = /^\s{0,3}(`{3,}|~{3,})/.exec(text.slice(i, end));
      if (opener) {
        if (fence === null) fence = opener[1][0];
        else if (fence === opener[1][0]) fence = null;
        i = end + 1;
        continue;
      }
      if (fence !== null) {
        i = end + 1;
        continue;
      }
    }
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") {
      let n = 1;
      while (text[i + n] === "`") n++;
      const close = text.indexOf("`".repeat(n), i + n);
      i = close === -1 ? i + n : close + n;
      continue;
    }
    if (ch === "$") {
      const display = text[i + 1] === "$";
      const width = display ? 2 : 1;
      const bodyFrom = i + width;
      const bodyTo = mathCloseOffset(text, bodyFrom, display);
      if (bodyTo >= 0) {
        out.push({ from: i, to: bodyTo + width, bodyFrom, bodyTo, display });
        i = bodyTo + width;
        continue;
      }
    }
    i++;
  }
  return out;
}

/** Formulas overlapping [from, to). Touching one at all counts: a formula
 * is colored as a whole, never in halves. */
function mathRangesIn(state: EditorState, from: number, to: number): MathRange[] {
  const text = state.doc.toString();
  return findMathRanges(text).filter((m) => m.from < to && m.to > from);
}

/** A `\class{…}{…}` wrapping the WHOLE formula body, or null. */
function parseMathClass(body: string): { classes: string[]; inner: string } | null {
  const head = /^\s*\\class\{([-\w ]*)\}\{/.exec(body);
  if (!head) return null;
  const open = head[0].length - 1;
  let depth = 0;
  for (let i = open; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      if (body.slice(i + 1).trim() !== "") return null;
      return {
        classes: head[1].split(/\s+/).filter(Boolean),
        inner: body.slice(open + 1, i),
      };
    }
  }
  return null;
}

/** Formula body with `kind`'s color set to `name` (or removed for null).
 * Classes the user wrote themselves are preserved. */
export function withMathColorClass(
  body: string,
  kind: "color" | "bg",
  name: string | null
): string {
  const prefix = kind === "color" ? MATH_TEXT_CLASS : MATH_BG_CLASS;
  const wrapped = parseMathClass(body);
  const inner = wrapped ? wrapped.inner : body;
  const classes = (wrapped ? wrapped.classes : []).filter(
    (c) => !c.startsWith(prefix)
  );
  if (name) classes.push(prefix + name);
  return classes.length ? `\\class{${classes.join(" ")}}{${inner}}` : inner;
}

/**
 * Color a selection that contains at least one formula. The formulas take
 * the `\class` treatment and the prose between them keeps the ordinary
 * span/mark tags, because a tag spanning both would swallow the math.
 */
function applyColorAcrossMath(
  view: EditorView,
  maths: MathRange[],
  color: string | null,
  kind: "color" | "bg",
  reBefore: RegExp,
  open: (c: string) => string,
  close: string
) {
  const doc = view.state.doc;
  const sel = view.state.selection.main;
  const name = color === null ? null : PALETTE_BY_CSS.get(color) ?? null;
  const changes: { from: number; to?: number; insert?: string }[] = [];

  // A color outside the palette (the theme's own highlight, say) has no
  // class to map to — leave those formulas as they are.
  if (color === null || name) {
    for (const math of maths) {
      const body = doc.sliceString(math.bodyFrom, math.bodyTo);
      const next = withMathColorClass(body, kind, name);
      if (next !== body) {
        changes.push({ from: math.bodyFrom, to: math.bodyTo, insert: next });
      }
    }
  }

  let at = sel.from;
  const gaps: { from: number; to: number }[] = [];
  for (const math of maths) {
    if (math.from > at) gaps.push({ from: at, to: Math.min(math.from, sel.to) });
    at = Math.max(at, math.to);
  }
  if (at < sel.to) gaps.push({ from: at, to: sel.to });

  for (const gap of gaps) {
    const text = doc.sliceString(gap.from, gap.to);
    if (!/\S/.test(text)) continue;
    // Hug the words: the whitespace that only separates prose from a
    // formula does not need to carry the color.
    const from = gap.from + (/^\s*/.exec(text)?.[0].length ?? 0);
    const to = gap.to - (/\s*$/.exec(text)?.[0].length ?? 0);
    const pair = enclosingColorTags(doc, from, to, reBefore, close);
    if (pair && color === null) {
      changes.push(
        { from: pair.openFrom, to: from },
        { from: to, to: to + close.length }
      );
    } else if (pair && color !== null) {
      changes.push({ from: pair.openFrom, to: from, insert: open(color) });
    } else if (color !== null) {
      changes.push({ from, insert: open(color) }, { from: to, insert: close });
    }
  }

  if (!changes.length) return;
  // ChangeSet.of composes rather than sorts when a spec steps backwards,
  // which would read the later positions against the already-edited doc.
  changes.sort((a, b) => a.from - b.from);
  view.dispatch({ changes, userEvent: "input.format" });
}

/** The plugin's own color tags wrapping exactly [from, to), or null. */
function enclosingColorTags(
  doc: Text,
  from: number,
  to: number,
  reBefore: RegExp,
  close: string
): { openFrom: number } | null {
  const before = doc.sliceString(Math.max(0, from - 64), from);
  const after = doc.sliceString(to, Math.min(doc.length, to + close.length));
  const m = before.match(reBefore);
  return m && after === close ? { openFrom: from - m[0].length } : null;
}

function applyTagColor(
  view: EditorView,
  color: string | null,
  reBefore: RegExp,
  open: (c: string) => string,
  close: string,
  kind: "color" | "bg"
) {
  const sel = view.state.selection.main;
  if (sel.empty) return;
  const maths = mathRangesIn(view.state, sel.from, sel.to);
  if (maths.length) {
    applyColorAcrossMath(view, maths, color, kind, reBefore, open, close);
    return;
  }
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

  // Markdown markers hugging the selection would end up wrapped around an
  // HTML element, which Live Preview cannot style. Convert them first.
  convertAdjacentMarkersToTags(view);
  const wrapSel = view.state.selection.main;
  const openTag = open(color);
  view.dispatch({
    changes: [
      { from: wrapSel.from, insert: openTag },
      { from: wrapSel.to, insert: close },
    ],
    selection: {
      anchor: wrapSel.from + openTag.length,
      head: wrapSel.to + openTag.length,
    },
  });
}

export function applyTextColor(view: EditorView, color: string | null) {
  applyTagColor(view, color, RE_SPAN_BEFORE, spanOpen, "</span>", "color");
}

export function applyHighlightColor(view: EditorView, color: string | null) {
  applyTagColor(view, color, RE_MARK_BEFORE, markOpen, "</mark>", "bg");
}

/** Strip every inline format from the selection: markdown tokens,
 *  surrounding wrappers, and color span/mark tags. Inside a fenced code
 *  block only the plugin's HTML tags are removed — `*`, `` ` `` and the
 *  rest are literal code there, never formatting. */
/** Marker ranges of the plugin's HTML tag pairs that intersect
 * [selFrom, selTo] in one line's text (offsets line-local). A pair that
 * merely TOUCHES the selection loses both tags — never one orphaned half.
 * Comment anchors are content, not formatting, and stay untouched. */
export function intersectingTagRanges(
  text: string,
  selFrom: number,
  selTo: number
): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (const pair of findColorTagPairs(text)) {
    if (pair.comment != null) continue;
    if (pair.open.from < selTo && pair.close.to > selFrom) {
      out.push({ from: pair.open.from, to: pair.open.to });
      out.push({ from: pair.close.from, to: pair.close.to });
    }
  }
  return out;
}

/**
 * Strip every inline format that INTERSECTS the selection — even when its
 * markers sit entirely outside it, which is the normal case in Live
 * Preview where concealed `<span>` tags and Markdown markers cannot be
 * selected. Whole marker pairs are removed via the parse tree (Markdown)
 * and the plugin's tag pairing (HTML), so a partial selection never
 * leaves an orphaned `**` or `</span>` behind. Inside a fenced code
 * block only the plugin's HTML tags are formatting — `*` and `` ` `` are
 * literal code there. Comments survive: they are notes, not formatting.
 */
export function clearInlineFormatting(view: EditorView) {
  const state = view.state;
  const doc = state.doc;
  const seen = new Set<string>();
  const ranges: { from: number; to: number }[] = [];
  const mathEdits: { from: number; to: number; insert: string }[] = [];
  const maths = findMathRanges(doc.toString());
  const push = (from: number, to: number) => {
    if (to <= from) return;
    const key = `${from}:${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    ranges.push({ from, to });
  };

  // Whatever the tree calls a marker, only genuine marker TEXT may be
  // deleted — Obsidian's HyperMD tree shapes nodes differently from the
  // reference Markdown tree, and a mis-shaped group must never take a
  // fragment of real content (or an HTML tag) with it.
  const MARKER_TEXT = /^(?:\*{1,3}|_{1,3}|~~|==|`+)$/;

  for (const sel of state.selection.ranges) {
    if (sel.empty) continue;
    // Markdown markers via the parse tree: bold/italic (both * and _),
    // strikethrough, highlight, and inline code backticks.
    if (!fenceBodyRange(doc, sel.from, sel.to)) {
      for (const group of collectInlineSyntaxGroups(
        syntaxTree(state),
        doc,
        sel.from,
        sel.to
      )) {
        if (group.from < sel.to && group.to > sel.from) {
          for (const marker of group.markers) {
            if (MARKER_TEXT.test(doc.sliceString(marker.from, marker.to))) {
              push(marker.from, marker.to);
            }
          }
        }
      }
    }
    // The plugin's own HTML tags: colors, highlight, underline, and the
    // <b>/<i>/<s> pairs written inside code fences.
    const fromLine = doc.lineAt(sel.from).number;
    const toLine = doc.lineAt(sel.to).number;
    for (let n = fromLine; n <= toLine; n++) {
      const line = doc.line(n);
      for (const range of intersectingTagRanges(
        line.text,
        Math.max(0, sel.from - line.from),
        Math.min(line.length, sel.to - line.from)
      )) {
        push(line.from + range.from, line.from + range.to);
      }
    }
    // Formulas carry their color as a \class wrapper, not as tags.
    for (const math of maths.filter((m) => m.from < sel.to && m.to > sel.from)) {
      const body = doc.sliceString(math.bodyFrom, math.bodyTo);
      const bare = withMathColorClass(
        withMathColorClass(body, "color", null),
        "bg",
        null
      );
      if (bare !== body) {
        mathEdits.push({ from: math.bodyFrom, to: math.bodyTo, insert: bare });
      }
    }
  }

  // A tag range inside a rewritten formula would overlap its replacement;
  // the rewrite already drops whatever sat in there.
  const kept = ranges.filter(
    (r) => !mathEdits.some((e) => r.from < e.to && r.to > e.from)
  );
  const changes = [...kept, ...mathEdits].sort((a, b) => a.from - b.from);
  if (changes.length === 0) return;
  view.dispatch({
    changes,
    scrollIntoView: true,
    userEvent: "delete.format",
  });
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

/** Markdown markers in plain text; the equivalent HTML tag pair inside a
 * fenced code block (where Markdown markers stay literal code) and around
 * any HTML-tagged text (where mixing families breaks Live Preview — see
 * the note above rangeTouchesHtmlPairIn). Toggling off recognizes both. */
export function isDualFormatActive(
  state: EditorState,
  marker: string,
  codeOpen: string,
  codeClose: string
): boolean {
  return inFenceBody(state)
    ? getWrapState(state, codeOpen, codeClose) !== "none"
    : getWrapState(state, marker) !== "none" ||
      getWrapState(state, codeOpen, codeClose) !== "none" ||
      enclosingTagPair(state, codeOpen, codeClose) !== null;
}

export function toggleDualFormat(
  v: EditorView,
  marker: string,
  codeOpen: string,
  codeClose: string
) {
  if (inFenceBody(v.state)) {
    toggleWrap(v, codeOpen, codeClose);
    return;
  }
  const state = v.state;
  if (getWrapState(state, marker) !== "none") {
    toggleWrap(v, marker);
    return;
  }
  if (getWrapState(state, codeOpen, codeClose) !== "none") {
    toggleWrap(v, codeOpen, codeClose);
    return;
  }
  const pair = enclosingTagPair(state, codeOpen, codeClose);
  if (pair) {
    removeTagPair(v, pair);
    return;
  }
  if (selectionTouchesHtmlPair(state)) toggleWrap(v, codeOpen, codeClose);
  else toggleWrap(v, marker);
}

const dualFormatAction = (
  icon: string,
  tooltip: string,
  marker: string,
  codeOpen: string,
  codeClose: string
): ToolbarAction => ({
  icon,
  tooltip,
  marker,
  isActive: (state) => isDualFormatActive(state, marker, codeOpen, codeClose),
  run: (v) => toggleDualFormat(v, marker, codeOpen, codeClose),
});

const PRIMARY_TOOLBAR_ACTIONS: ToolbarAction[] = [
  dualFormatAction("bold", t("Bold"), "**", "<b>", "</b>"),
  dualFormatAction("italic", t("Italic"), "*", "<i>", "</i>"),
  {
    icon: "underline",
    tooltip: t("Underline"),
    marker: "<u>",
    endMarker: "</u>",
    isActive: isUnderlineActive,
    run: toggleUnderline,
  },
  dualFormatAction("strikethrough", t("Strikethrough"), "~~", "<s>", "</s>"),
];

const SECONDARY_TOOLBAR_ACTIONS: ToolbarAction[] = [
  {
    icon: "code",
    tooltip: t("Inline code"),
    marker: "`",
    run: (v) => toggleWrap(v, "`"),
    disabledInCode: true,
  },
  { icon: "link", tooltip: t("Link"), run: insertLink, disabledInCode: true },
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

        // Comment on the selection — plugin-bound (the modal needs App),
        // so it lives outside the module-level action tables.
        const commentAction: ToolbarAction = {
          icon: "message-square-plus",
          tooltip: t("Add comment"),
          run: (v) => startAddComment(plugin, v),
          disabledInCode: true,
          requiresCommenting: true,
        };
        const commentBtn = mkBtn(this.mainRow, commentAction.icon, commentAction.tooltip);
        onPress(commentBtn, () => commentAction.run(this.view));
        this.buttons.push({ el: commentBtn, action: commentAction });

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
          const range = getTableRange(doc, doc.lineAt(pos).number, cachedFences(doc));
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
        if (!isTableRow(line.text)) return null;
        const range = getTableRange(doc, line.number, cachedFences(doc));
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
            sw.style.backgroundColor = paletteTint(name, 0.35);
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
            // == around an HTML element cannot restyle it in Live Preview;
            // stay in the HTML family with the theme's highlight color.
            if (selectionTouchesHtmlPair(this.view.state)) {
              applyHighlightColor(this.view, "var(--text-highlight-bg)");
            } else {
              toggleWrap(this.view, "==");
            }
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
        // Light up buttons whose format is already applied. Inline code and
        // links make no sense inside a fenced code block — gray them out.
        const inCode = inFenceBody(this.view.state);
        for (const { el, action } of this.buttons) {
          if (action.requiresCommenting) {
            el.style.display = plugin.settings.commenting ? "" : "none";
          }
          (el as HTMLButtonElement).disabled = Boolean(action.disabledInCode) && inCode;
          if (!action.marker && !action.isActive) continue;
          const active =
            !(el as HTMLButtonElement).disabled &&
            (action.isActive
              ? action.isActive(this.view.state)
              : getWrapState(this.view.state, action.marker!, action.endMarker) !== "none");
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
  /** One-line description under the name, Notion-style. */
  desc?: string;
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
  /** A paragraph line directly above swallows this block as a lazy
   *  continuation (quotes, Callouts, toggles), so a blank line has to
   *  come first — except under a list marker, where the item's own
   *  indentation already makes the block its child. */
  blankAbove?: boolean;
  /** Quote-style block that would absorb the following line as lazy
   *  continuation: keep a blank line below. */
  sealBelow?: boolean;
}

// Keywords mix English and Chinese so either language filters the menu,
// whatever UI language is active.
export const SLASH_COMMANDS: SlashCommand[] = [
  { id: "h1", name: t("Heading 1"), desc: t("Big section heading"), icon: "heading-1", keywords: "h1 title 标题 一级标题", hint: "#", linePrefix: "# " },
  { id: "h2", name: t("Heading 2"), desc: t("Medium section heading"), icon: "heading-2", keywords: "h2 subtitle 标题 二级标题", hint: "##", linePrefix: "## " },
  { id: "h3", name: t("Heading 3"), desc: t("Small section heading"), icon: "heading-3", keywords: "h3 标题 三级标题", hint: "###", linePrefix: "### " },
  { id: "bullet", name: t("Bulleted list"), desc: t("Plain list with bullets"), icon: "list", keywords: "ul unordered 列表 无序列表", hint: "-", linePrefix: "- " },
  { id: "number", name: t("Numbered list"), desc: t("List with numbering"), icon: "list-ordered", keywords: "ol ordered 列表 有序列表 编号", hint: "1.", linePrefix: "1. " },
  { id: "todo", name: t("To-do list"), desc: t("Tasks with checkboxes"), icon: "check-square", keywords: "task checkbox 待办 任务 复选框", hint: "- [ ]", linePrefix: "- [ ] " },
  { id: "quote", name: t("Quote"), desc: t("Quoted text with a bar"), icon: "quote", keywords: "blockquote 引用", hint: ">", linePrefix: "> " },
  { id: "callout", name: t("Callout"), desc: t("Colored info box"), icon: "megaphone", keywords: "note info admonition 标注 提示", hint: "> [!note]", insert: "> [!note] ‸\n> ", block: true, blankAbove: true, sealBelow: true },
  { id: "toggle", name: t("Toggle"), desc: t("Foldable block behind a triangle"), icon: "chevron-right", keywords: "fold collapse toggle 折叠 折叠块 收起 展开", hint: "▸", insert: buildToggleTemplate(), block: true, blankAbove: true, sealBelow: true },
  { id: "toggle-callout", name: t("Foldable callout"), desc: t("Colored box that folds"), icon: "chevrons-down-up", keywords: "fold collapse callout 折叠 标注", hint: "> [!note]-", insert: "> [!note]- ‸\n> ", block: true, blankAbove: true, sealBelow: true },
  { id: "cols2", name: t("Two columns"), desc: t("Blocks side by side"), icon: "columns-2", keywords: "columns cols layout 分栏 两栏 栏 布局 并排", hint: "[!nf-cols]", insert: buildColumnsTemplate(2), block: true, sealBelow: true },
  { id: "cols3", name: t("Three columns"), desc: t("Blocks side by side"), icon: "columns-3", keywords: "columns cols layout 分栏 三栏 栏 布局 并排", hint: "[!nf-cols]", insert: buildColumnsTemplate(3), block: true, sealBelow: true },
  { id: "code", name: t("Code block"), desc: t("Fenced code with highlighting"), icon: "code-2", keywords: "fence snippet 代码 代码块", hint: "```", insert: "```‸\n\n```", block: true },
  { id: "table", name: t("Table"), desc: t("Rows and columns"), icon: "table", keywords: "grid 表格", hint: "3×3", insert: buildTableTemplate(3, 3), block: true, needsBlank: true },
  { id: "divider", name: t("Divider"), desc: t("Horizontal rule"), icon: "minus", keywords: "hr rule separator 分割线 分隔线", hint: "---", insert: "---\n‸", block: true, needsBlank: true },
  { id: "image", name: t("Image / embed"), desc: t("Embed an image or file"), icon: "image", keywords: "picture attach embed 图片 附件 嵌入", hint: "![[ ]]", insert: "![[‸]]" },
  { id: "wikilink", name: t("Internal link"), desc: t("Link to another note"), icon: "link-2", keywords: "link internal note wiki 链接 内链 双链", hint: "[[ ]]", insert: "[[‸]]" },
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
    // fullwidth "／" (what a CJK keyboard layout produces) triggers too.
    // The query also accepts CJK so Chinese keywords ("/表格") are typable.
    // Ranges: CJK punctuation+kana, unified ideographs, fullwidth forms.
    const m = before.match(
      /(?:^|[\s>]|[　-ヿ一-鿿＀-￯])[/／]([\w　-ヿ一-鿿＀-￯-]*)$/
    );
    if (!m) return null;
    // Inside a code fence "/" is code, not a command.
    const view = (editor as unknown as { cm?: EditorView }).cm;
    if (view && fenceAt(cachedFences(view.state.doc), cursor.line + 1)) return null;
    const start = before.length - m[1].length - 1; // include the "/"
    return {
      start: { line: cursor.line, ch: start },
      end: cursor,
      query: m[1],
    };
  }

  /** Session-scoped recently-used ids, most recent first. */
  recent: string[] = [];

  getSuggestions(ctx: EditorSuggestContext): SlashCommand[] {
    const all = this.plugin.settings.columnLayout
      ? SLASH_COMMANDS
      : SLASH_COMMANDS.filter((c) => !c.id.startsWith("cols"));
    const q = ctx.query.toLowerCase();
    if (!q) {
      // Notion-style: what you used last sits on top of the full menu.
      if (this.recent.length === 0) return all;
      const boosted = this.recent
        .map((id) => all.find((c) => c.id === id))
        .filter((c): c is SlashCommand => c != null);
      return [...boosted, ...all.filter((c) => !this.recent.includes(c.id))];
    }
    // Prefix matches (id, name, or any keyword) rank above substring hits.
    const prefix = (c: SlashCommand) =>
      c.id.startsWith(q) ||
      c.name.toLowerCase().startsWith(q) ||
      c.keywords.split(" ").some((k) => k.startsWith(q));
    return all.filter(
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
    const main = el.createDiv({ cls: "nf-slash-main" });
    main.createDiv({ cls: "nf-slash-name", text: cmd.name });
    if (cmd.desc) main.createDiv({ cls: "nf-slash-desc", text: cmd.desc });
    if (cmd.hint) el.createDiv({ cls: "nf-slash-hint", text: cmd.hint });
  }

  insertSnippet(
    editor: Editor,
    start: EditorPosition,
    end: EditorPosition,
    cmd: SlashCommand,
    template = cmd.insert
  ) {
    SlashSuggest.insertSnippetInto(editor, start, end, cmd, template);
  }

  /** Shared by Obsidian's EditorSuggest and the visual column CodeMirror.
   * Keeping one serializer means `/callout`, `/code`, tables, list nesting,
   * and quote seams produce byte-for-byte identical Markdown in both. */
  static insertSnippetInto(
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
      // Tables and dividers need the blank line everywhere; quote-family
      // blocks need it only where a paragraph would swallow them.
      const blankAbove = cmd.needsBlank || cmd.blankAbove;
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
      const qp = quoteMarkerPrefix(lineText);
      if (qp) {
        // Triggered inside a quote/Callout/column: the block must stay in
        // the block. Every template line keeps the "> " marker prefix, and
        // seams use marker-only lines — a truly blank line would split
        // the surrounding quote (and a column row) in two.
        const sep = qp.replace(/[ \t]+$/, "");
        const beyond = before.slice(Math.min(qp.length, before.length));
        // A list item inside the Callout owns the new block just as one
        // outside a quote does: the template lands on that item's content
        // column, so "/code" in "> - item" nests under the bullet instead
        // of becoming its sibling. Seam rows stay at the container's own
        // column — they belong to the box, not to the item.
        const quotedListIndent = listContentIndent(beyond);
        const rowPrefix = qp + " ".repeat(quotedListIndent ?? 0);
        const body = template.split("\n").join("\n" + rowPrefix);
        if (/\S/.test(beyond)) {
          insert = (blankAbove ? "\n" + sep : "") + "\n" + rowPrefix + body;
        } else {
          insert = body;
          if (
            blankAbove &&
            start.line > 0 &&
            /\S/.test(lineAt(start.line - 1).replace(RE_QUOTE_PREFIX, ""))
          ) {
            replaceStart = { line: start.line, ch: 0 };
            insert = sep + "\n" + rowPrefix + body;
          }
        }
        if (
          (cmd.sealBelow || blankAbove) &&
          /\S/.test(lineAt(start.line + 1).replace(RE_QUOTE_PREFIX, ""))
        ) {
          insert += "\n" + sep;
        }
        SlashSuggest.commitSnippet(editor, insert, replaceStart, end);
        return;
      }
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
        insert = (blankAbove ? "\n\n" : "\n") +
          prefixLines(template, lineIndent);
      } else if (
        blankAbove &&
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
    SlashSuggest.commitSnippet(editor, insert, replaceStart, end);
  }

  /** Write the final snippet text and land the caret on its "‸" marker. */
  private static commitSnippet(
    editor: Editor,
    insert: string,
    replaceStart: EditorPosition,
    end: EditorPosition
  ) {
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
    this.recent = [cmd.id, ...this.recent.filter((id) => id !== cmd.id)].slice(0, 3);

    const pointer = _evt as MouseEvent;
    if (cmd.id === "table" && typeof pointer.clientX === "number") {
      this.openTablePicker(editor, start, end, cmd, pointer);
      return;
    }

    if (cmd.linePrefix !== undefined) {
      // Remove the trigger text, then swap the line's block prefix.
      editor.replaceRange("", start, end);
      const lineText = editor.getLine(start.line);
      // Inside a quote/Callout/column, the "> " markers are the block's
      // structure — a heading or list prefix applies to the CONTENT and
      // must not strip the markers (which would rip the line out of the
      // block). "/quote" itself keeps whole-line semantics (nesting).
      const qp = cmd.linePrefix.startsWith(">")
        ? null
        : quoteMarkerPrefix(lineText);
      const newLine = qp
        ? qp + applyLinePrefix(lineText.slice(qp.length), cmd.linePrefix)
        : applyLinePrefix(lineText, cmd.linePrefix);
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
  private mermaidMutationObservers = new Set<MutationObserver>();
  private mermaidResizeObservers = new Set<ResizeObserver>();
  private mermaidDocumentObservers = new Map<Document, MutationObserver>();

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
    this.registerEditorExtension(makeHeadingConcealPlugin(this));
    this.registerEditorExtension(makeEmptyHintPlugin(this));
    this.registerEditorExtension(makeTableKeymap(this));
    // After the table keymap: both claim Tab, and a table cell's own
    // navigation is the more specific meaning of the two.
    this.registerEditorExtension(makeBlockIndentKeymap(this));
    this.registerEditorExtension(makeQuoteKeymap(this));
    this.registerEditorExtension(makeCodeBlockKeymap(this));
    this.registerEditorExtension(makeTrailingClickPlugin());
    this.registerEditorExtension(makeCodeMarkerRewriter(this));
    this.registerEditorExtension(makeInputRuleFilter(this));
    this.registerEditorExtension(makeVisualColumnEditor(this));
    this.registerEditorExtension(makeCalloutIconMenu(this));
    // Highest precedence, deliberately. Obsidian's own Live Preview
    // decorations replace some of the very ranges this plugin presents:
    // the code-fence opener (its language "flair" widget) and any inline
    // HTML row (a caption). At equal precedence Obsidian's win, which made
    // the fence header flip between its flair and our language/fold chip
    // depending on where the caret sat, and left caption rows rendered as
    // raw 10px <small> embeds that never reached our widget or
    // postprocessor. Winning these ranges is what makes the block's
    // appearance stable while editing.
    this.registerEditorExtension(Prec.highest(makeCalloutEditPlugin(this)));

    // Reading View does not consistently provide the horizontal table
    // wrapper used by Live Preview. Add a narrowly scoped, focusable scroll
    // region around native Markdown tables so wide content never expands the
    // whole pane. Common plugin-generated table classes are left untouched.
    this.registerMarkdownPostProcessor((el) => {
      // Reading view has real nested list elements, so one shared phase
      // attribute gives UL bullets and OL numbers the same unlimited cycle,
      // including mixed unordered/ordered ancestry.
      annotateReadingListPhases(el);

      // Mermaid can finish rendering asynchronously after this processor
      // runs. Enhance both already-rendered SVGs and late arrivals, then
      // keep wide-diagram behavior in sync with pane resizing.
      if (this.settings.cleanRendering) {
        this.watchMermaidDocument(el.ownerDocument);
        const diagrams = [
          ...(el.matches(".mermaid") ? [el as HTMLElement] : []),
          ...Array.from(el.querySelectorAll<HTMLElement>(".mermaid")),
        ];
        for (const diagram of diagrams) this.enhanceMermaid(diagram);
      }

      // Formatting tags written inside fenced code blocks render as
      // styled text instead of literal markup, matching Live Preview.
      if (this.settings.concealHtml) {
        for (const code of Array.from(
          el.querySelectorAll<HTMLElement>("pre:not(.frontmatter) > code")
        )) {
          renderCodeFormattingTags(code);
        }
      }

      // Portable caption rows render as real <small> elements everywhere.
      // Associate each one with the media block immediately above it, and
      // honor a code block's saved collapsed state in Reading view and in
      // rendered Callouts. Live Preview's editable top-level code uses the
      // CodeMirror widgets registered below instead.
      for (const caption of Array.from(
        el.querySelectorAll<HTMLElement>(
          'small.nf-caption[data-nf-kind="code"], ' +
            'small.nf-caption[data-nf-kind="image"], ' +
            'small.nf-caption[data-nf-kind="table"]'
        )
      )) {
        caption.classList.add("nf-rendered-caption");
        const sourceTarget = () => {
          const editorEl = caption.closest<HTMLElement>(".cm-editor");
          const view = editorEl ? EditorView.findFromDOM(editorEl) : null;
          if (!view) return null;
          const anchors = [
            caption,
            caption.closest<HTMLElement>(".cm-embed-block"),
            caption.closest<HTMLElement>(".cm-line"),
          ].filter((candidate): candidate is HTMLElement => !!candidate);
          for (const anchor of anchors) {
            try {
              const near = view.state.doc.lineAt(view.posAtDOM(anchor, 0)).number;
              for (
                let lineNo = Math.max(1, near - 2);
                lineNo <= Math.min(view.state.doc.lines, near + 2);
                lineNo++
              ) {
                const meta = parseBlockCaption(view.state.doc.line(lineNo).text);
                if (!meta || meta.kind !== caption.dataset.nfKind) continue;
                if (meta.kind === "code") {
                  const fence = fenceAt(cachedFences(view.state.doc), lineNo - 1);
                  if (fence?.closed && fence.endLine === lineNo - 1) {
                    return { view, kind: meta.kind, ownerLine: fence.startLine };
                  }
                } else if (meta.kind === "table") {
                  const table = isTableRow(view.state.doc.line(lineNo - 1).text)
                    ? getTableRange(
                        view.state.doc,
                        lineNo - 1,
                        cachedFences(view.state.doc)
                      )
                    : null;
                  if (table) {
                    return { view, kind: meta.kind, ownerLine: table.startLine };
                  }
                } else {
                  return { view, kind: meta.kind, ownerLine: lineNo - 1 };
                }
              }
            } catch {
              // Try the next DOM anchor; inline HTML widgets vary between
              // Live Preview and rendered Callouts.
            }
          }
          return null;
        };
        if (caption.closest(".markdown-source-view.is-live-preview")) {
          caption.setAttribute("role", "button");
          caption.setAttribute("tabindex", "0");
          caption.setAttribute("title", t("Edit caption"));
          const edit = (evt: Event) => {
            if ((evt.target as Element | null)?.closest("button")) return;
            const target = sourceTarget();
            if (!target) return;
            evt.preventDefault();
            evt.stopPropagation();
            editBlockCaption(
              this,
              target.view,
              target.kind,
              target.ownerLine
            );
          };
          caption.addEventListener("click", edit);
          caption.addEventListener("keydown", (evt) => {
            if (evt.key === "Enter") edit(evt);
          });
        }
        const captionBlock =
          caption.parentElement?.tagName === "P"
            ? caption.parentElement
            : caption;
        const previous = captionBlock.previousElementSibling;
        const kind = caption.dataset.nfKind;
        if (kind === "image") {
          const image =
            previous?.querySelector<HTMLImageElement>(":scope > img") ??
            (previous?.tagName === "IMG" ? previous as HTMLImageElement : null);
          image?.classList.add("nf-captioned-image");
          captionBlock.classList.add("nf-image-caption-block");
          continue;
        }
        if (kind === "table") {
          // The table may already be inside the scroll wrapper added below,
          // so look through it as well as at it.
          const table =
            previous?.tagName === "TABLE"
              ? (previous as HTMLElement)
              : previous?.querySelector<HTMLElement>(":scope > table") ?? null;
          table?.classList.add("nf-captioned-table");
          captionBlock.classList.add("nf-table-caption-block");
          continue;
        }
        if (kind !== "code") continue;
        const collapsed = caption.dataset.nfCollapsed === "true";
        if (
          collapsed &&
          caption.closest(".markdown-source-view.is-live-preview") &&
          !caption.querySelector(":scope > .nf-inline-caption-fold")
        ) {
          caption.classList.add("nf-inline-code-caption-collapsed");
          const fold = caption.createEl("button", {
            cls: "nf-inline-caption-fold nf-rendered-code-fold is-collapsed",
            prepend: true,
            attr: {
              type: "button",
              "aria-label": t("Expand code block"),
              "aria-expanded": "false",
            },
          });
          setIcon(fold, "chevron-right");
          const code = caption.createSpan({
            cls: "nf-inline-caption-code",
            text: t("Code"),
            prepend: true,
          });
          caption.insertBefore(fold, code);
          fold.addEventListener("click", (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            const target = sourceTarget();
            if (!target || target.kind !== "code") return;
            const doc = target.view.state.doc;
            const fence = fenceAt(cachedFences(doc), target.ownerLine);
            if (!fence) return;
            setBlockCaptionMeta(
              target.view,
              "code",
              fence.startLine,
              codeCaptionMeta(doc, fence)?.caption ?? "",
              false,
              true
            );
          });
        }
        if (previous?.tagName !== "PRE") continue;
        const pre = previous as HTMLPreElement;
        pre.classList.add("nf-captioned-code");
        captionBlock.classList.add("nf-code-caption-block");
        pre.classList.toggle("nf-rendered-code-collapsed", collapsed);
        if (pre.querySelector(":scope > .nf-rendered-code-fold")) continue;
        const fold = pre.createEl("button", {
          cls: "nf-rendered-code-fold",
          attr: {
            type: "button",
            "aria-label": t(collapsed ? "Expand code block" : "Collapse code block"),
            "aria-expanded": String(!collapsed),
          },
        });
        setIcon(fold, "chevron-down");
        fold.addEventListener("click", (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          const nextCollapsed = !pre.classList.contains(
            "nf-rendered-code-collapsed"
          );
          // This postprocessor also renders Callout bodies inside Live
          // Preview, where an editor does exist. There the caption row is
          // the single source of truth, so write the state back instead of
          // styling the DOM: a class alone would be discarded the moment
          // the Callout re-rendered. Reading view has no editor to reach,
          // and folding stays a view-local affordance there.
          const target = sourceTarget();
          if (target?.kind === "code") {
            const doc = target.view.state.doc;
            const fence = fenceAt(cachedFences(doc), target.ownerLine);
            if (fence) {
              // Deliberately without focusOwner: folding is a view action,
              // and moving the caret into the block would open the
              // surrounding Callout as a side effect of a fold click.
              setBlockCaptionMeta(
                target.view,
                "code",
                fence.startLine,
                codeCaptionMeta(doc, fence)?.caption ?? "",
                nextCollapsed
              );
              return;
            }
          }
          pre.classList.toggle("nf-rendered-code-collapsed", nextCollapsed);
          fold.classList.toggle("is-collapsed", nextCollapsed);
          fold.setAttribute("aria-expanded", String(!nextCollapsed));
          fold.setAttribute(
            "aria-label",
            t(nextCollapsed ? "Expand code block" : "Collapse code block")
          );
        });
        fold.classList.toggle("is-collapsed", collapsed);
      }

      // Comment anchors in rendered Markdown (Reading view and Live
      // Preview callout content): Notion-style highlight + hover tooltip.
      // The note text only ever becomes a title attribute — inert.
      if (this.settings.commenting) {
        for (const cmt of Array.from(
          el.querySelectorAll<HTMLElement>('span.nf-cmt[data-nf-cmt]')
        )) {
          cmt.classList.add("nf-cmt-anchor");
          cmt.setAttribute(
            "title",
            decodeCommentAttr(cmt.getAttribute("data-nf-cmt") ?? "")
          );
        }
      }

      // Pinned column widths: "[!nf-col|30]" → flex-basis 30%. The value
      // is validated to a bare integer percentage before it touches CSS.
      if (this.settings.columnLayout) {
        for (const col of Array.from(
          el.querySelectorAll<HTMLElement>('.callout[data-callout="nf-col"]')
        )) {
          const width = columnWidthPercent(col.getAttribute("data-callout-metadata"));
          if (width != null) {
            col.classList.add("nf-col-sized");
            col.style.setProperty("--nf-col-w", `${width}%`);
          }
        }
        // Every rendered columns row carries a ⋯ button — the discoverable
        // entry to add/resize/unwrap. Its own listeners run in the target
        // phase, ahead of anything the surrounding widget does; Reading
        // view hides the button via CSS and the handler no-ops there.
        for (const cols of Array.from(
          el.querySelectorAll<HTMLElement>('.callout[data-callout="nf-cols"]')
        )) {
          // Visual-column sibling previews are deliberately inert. Adding
          // row menus or resize handles there would create nested editing
          // controls inside a button-like preview and duplicate listeners
          // every time MarkdownRenderer refreshes it.
          if (
            cols.closest(
              ".nf-columns-editor, .nf-columns-editor-preview-stage"
            )
          ) continue;
          const content = Array.from(cols.children).find(
            (child) => child.classList.contains("callout-content")
          ) as HTMLElement | undefined;
          const columns = content
            ? Array.from(content.children).filter(
                (child) => (child as HTMLElement).dataset.callout === COL_TYPE
              ) as HTMLElement[]
            : [];
          const interactive = !!cols.closest(".markdown-source-view.is-live-preview");

          for (let index = 0; index < columns.length; index++) {
            const column = columns[index];
            if (column.querySelector(":scope > .nf-col-menu")) continue;
            const columnButton = column.createEl("button", {
              cls: "nf-col-menu",
              attr: {
                type: "button",
                tabindex: interactive ? "0" : "-1",
                "aria-label": t("Column actions"),
              },
            });
            columnButton.dataset.nfColumnIndex = String(index);
            setIcon(columnButton, "more-horizontal");
            columnButton.addEventListener("mousedown", (evt) => {
              evt.preventDefault();
              evt.stopPropagation();
            });
            columnButton.addEventListener("click", (evt) => {
              evt.preventDefault();
              evt.stopPropagation();
              openColumnMenuFromDOM(columnButton, evt, this);
            });
          }

          // A real gutter between each direct child column: pointer drag
          // previews widths live and commits once; arrows adjust by 1%
          // (Shift = 5%), while double-click restores equal tracks.
          if (content && columns.length >= 2 && columns.length <= 10) {
            const currentPercents = columnPercentsFromWidths(
              columns.map(
                (column) =>
                  columnWidthPercent(
                    column.getAttribute("data-callout-metadata")
                  ) ?? 100 / columns.length
              )
            );
            for (const old of Array.from(
              content.querySelectorAll<HTMLElement>(":scope > .nf-col-resizer")
            )) old.remove();
            for (let index = 0; index < columns.length - 1; index++) {
              const handle = content.createDiv({
                cls: "nf-col-resizer",
                attr: {
                  role: "separator",
                  tabindex: interactive ? "0" : "-1",
                  "aria-orientation": "vertical",
                  // The usage hint was previously a `title`, which stacked a
                  // native tooltip on top of Obsidian's. Keep the richer
                  // wording and let the single aria-label tooltip carry it.
                  "aria-label": t("Drag to resize; double-click to distribute evenly"),
                  "aria-valuemin": "10",
                  "aria-valuemax": "90",
                  "aria-valuenow": String(currentPercents[index]),
                },
              });
              handle.dataset.nfColumnDivider = String(index);
              content.insertBefore(handle, columns[index + 1]);
              handle.addEventListener("pointerdown", (evt) => {
                startColumnResizeFromDOM(handle, evt);
              });
              handle.addEventListener("dblclick", (evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                replaceRenderedColumnWidths(
                  handle,
                  Array<number | null>(columns.length).fill(null)
                );
              });
              handle.addEventListener("keydown", (evt) => {
                resizeColumnsFromKeyboard(handle, evt);
              });
            }
          }

          if (cols.querySelector(":scope > .nf-cols-menu")) continue;
          const btn = cols.createEl("button", {
            cls: "nf-cols-menu",
            attr: {
              type: "button",
              tabindex: interactive ? "0" : "-1",
              "aria-label": t("Column options"),
            },
          });
          setIcon(btn, "columns-2");
          btn.addEventListener("mousedown", (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
          });
          btn.addEventListener("click", (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            openColumnsMenuFromDOM(btn, evt);
          });
        }
      }

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

    // Turn-into without the pointer. The handle menu is the discoverable
    // path; these are the one-chord path for someone already typing, which
    // is the only time the conversion is actually wanted.
    //
    // Notion's own modifier per platform, and for the same reason it split
    // them: Ctrl+Alt IS AltGr on the European layouts, where claiming
    // Ctrl+Alt+2 would take the key that types "@". Mod+Shift is free of
    // that and is what Notion uses off macOS.
    const turnIntoModifiers: ("Mod" | "Alt" | "Shift")[] = Platform.isMacOS
      ? ["Mod", "Alt"]
      : ["Mod", "Shift"];
    for (const entry of TURN_INTO) {
      this.addCommand({
        id: `turn-into-${entry.id}`,
        name: entry.command,
        icon: entry.icon,
        hotkeys: [{ modifiers: turnIntoModifiers, key: entry.digit }],
        editorCallback: (editor) => this.turnBlockAtCaret(editor, entry.prefix),
      });
    }

    for (const entry of WRAP_INTO) {
      this.addCommand({
        id: `wrap-into-${entry.kind}`,
        name: entry.command,
        icon: entry.icon,
        hotkeys: [{ modifiers: turnIntoModifiers, key: entry.key }],
        editorCallback: (editor) => this.wrapBlockAtCaret(editor, entry.kind),
      });
    }

    this.addCommand({
      id: "insert-block-below",
      name: t("Insert block below"),
      icon: "plus",
      // Mod+Alt rather than the turn-into modifiers: off macOS those are
      // Mod+Shift, and Mod+Shift+Enter already exits a code block.
      hotkeys: [{ modifiers: ["Mod", "Alt"], key: "Enter" }],
      editorCallback: (editor) => this.insertBlockAtCaret(editor, 1),
    });
    this.addCommand({
      id: "insert-block-above",
      name: t("Insert block above"),
      icon: "plus",
      hotkeys: [{ modifiers: ["Mod", "Alt", "Shift"], key: "Enter" }],
      editorCallback: (editor) => this.insertBlockAtCaret(editor, -1),
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
      id: "exit-code-block",
      name: t("Exit code block"),
      // Mod+Enter alone is taken by Obsidian's toggle-checkbox hotkey.
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "Enter" }],
      editorCallback: (editor) => {
        const view = this.editorView(editor);
        if (!view) return;
        const sel = view.state.selection.main;
        applyKeyPlan(view, fenceExitPlan(view.state.doc, sel.head), "input");
      },
    });
    this.addCommand({
      id: "clear-formatting",
      name: t("Clear formatting"),
      // Notion's own clear-formatting chord.
      hotkeys: [{ modifiers: ["Mod"], key: "\\" }],
      editorCallback: (editor) => {
        const view = this.editorView(editor);
        if (view) clearInlineFormatting(view);
      },
    });
    this.addCommand({
      id: "add-comment",
      name: t("Add comment"),
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "M" }],
      editorCallback: (editor) => {
        const view = this.editorView(editor);
        if (view) startAddComment(this, view);
      },
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
          cachedFences(view.state.doc)
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

    // Paste a bare URL with nothing selected → insert it immediately, then
    // fetch the page title in the background and upgrade the raw URL to
    // [Title](url), like Notion. Code contexts and link destinations keep
    // the plain URL; so does any page that cannot be reached in time.
    this.registerEvent(
      this.app.workspace.on("editor-paste", (evt, editor) => {
        if (!this.settings.pasteUrlTitles || evt.defaultPrevented) return;
        const clip = (evt.clipboardData?.getData("text/plain") ?? "").trim();
        if (!RE_HTTP_URL.test(clip) || editor.getSelection()) return;
        const cur = editor.getCursor();
        const view = this.editorView(editor);
        if (view && fenceAt(cachedFences(view.state.doc), cur.line + 1)) return;
        const before = editor.getLine(cur.line).slice(0, cur.ch);
        // Inside inline code (odd backtick count) a URL is data, and right
        // after "](", it is already a link destination.
        if (((before.match(/`/g) ?? []).length % 2) === 1) return;
        if (/\]\([^)\s]*$/.test(before)) return;
        evt.preventDefault();
        editor.replaceSelection(clip);
        void this.linkifyPastedUrl(editor, clip, cur);
      })
    );

    // Multi-line pastes inside a quote/Callout keep every line in the block.
    // Rich text goes through Obsidian's own HTML → Markdown conversion first,
    // so browser/Word content still pastes as Markdown, just prefixed. File
    // pastes (images, attachments) keep Obsidian's pipeline untouched.
    this.registerEvent(
      this.app.workspace.on("editor-paste", (evt, editor) => {
        if (!this.settings.calloutEditing || evt.defaultPrevented) return;
        const data = evt.clipboardData;
        if (!data || data.files.length > 0) return;
        const html = data.getData("text/html");
        const clip = html ? htmlToMarkdown(html) : data.getData("text/plain");
        const from = editor.getCursor("from");
        const to = editor.getCursor("to");
        const view = this.editorView(editor);
        const selection = view?.state.selection;
        const replacement = view && selection?.ranges.length === 1
          ? buildQuotedPasteForSelection(
              view.state.doc,
              selection.main.from,
              selection.main.to,
              clip,
              cachedFences(view.state.doc)
            )
          : from.line === to.line
            ? buildQuotedPaste(editor.getLine(from.line), from.ch, clip)
            : null;
        if (replacement == null) return;
        evt.preventDefault();
        editor.replaceSelection(replacement);
      })
    );

    this.applyCleanClass();
  }

  private watchMermaidDocument(ownerDocument: Document) {
    if (this.mermaidDocumentObservers.has(ownerDocument)) return;
    const scan = (root: ParentNode) => {
      const element = root as Element;
      if (typeof element.matches === "function" && element.matches(".mermaid")) {
        this.enhanceMermaid(element as HTMLElement);
      }
      for (const diagram of Array.from(
        root.querySelectorAll<HTMLElement>(".mermaid")
      )) this.enhanceMermaid(diagram);
    };
    scan(ownerDocument);
    const Observer = ownerDocument.defaultView?.MutationObserver;
    if (!Observer || !ownerDocument.body) return;
    const observer = new Observer((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          if (node.nodeType === 1) scan(node as Element);
        }
      }
    });
    observer.observe(ownerDocument.body, { childList: true, subtree: true });
    this.mermaidDocumentObservers.set(ownerDocument, observer);
  }

  private enhanceMermaid(diagram: HTMLElement) {
    if (diagram.dataset.nfMermaidEnhanced === "true") return;
    diagram.dataset.nfMermaidEnhanced = "true";
    diagram.classList.add("nf-mermaid");
    diagram.setAttribute("role", "region");
    diagram.setAttribute("aria-label", t("Mermaid diagram"));

    const connectSvg = (): boolean => {
      const svg = diagram.querySelector<SVGSVGElement>(":scope > svg, svg");
      if (!svg || svg.dataset.nfMermaidEnhanced === "true") return !!svg;
      svg.dataset.nfMermaidEnhanced = "true";
      svg.classList.add("nf-mermaid-svg");
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

      const sync = () => {
        if (!diagram.isConnected) return;
        const viewBox = svg.viewBox?.baseVal;
        const rawWidth = viewBox?.width || svg.getBoundingClientRect().width;
        const rawHeight = viewBox?.height || svg.getBoundingClientRect().height;
        const styles = diagram.ownerDocument.defaultView?.getComputedStyle(diagram);
        const padding =
          Number.parseFloat(styles?.paddingLeft ?? "0") +
          Number.parseFloat(styles?.paddingRight ?? "0");
        const available = Math.max(1, diagram.clientWidth - padding);
        // Mermaid viewBox units are layout coordinates, not CSS pixels.
        // Scaling them 1:1 makes some mindmaps enormous. Only genuinely
        // landscape diagrams need a readable scroll width, derived from the
        // pane itself and capped to a little over two pane widths.
        const viewport = mermaidViewport(rawWidth, rawHeight, available);
        const { wide } = viewport;
        if (wide) {
          diagram.style.setProperty("--nf-mermaid-natural-width", `${viewport.width}px`);
        } else {
          diagram.style.removeProperty("--nf-mermaid-natural-width");
        }
        diagram.classList.toggle("is-wide", wide);
        if (wide) {
          diagram.tabIndex = 0;
          diagram.setAttribute("aria-label", t("Scrollable Mermaid diagram"));
        } else {
          diagram.removeAttribute("tabindex");
          diagram.setAttribute("aria-label", t("Mermaid diagram"));
        }
      };

      const ownerWindow = diagram.ownerDocument.defaultView as
        (Window & typeof globalThis) | null;
      const Observer = ownerWindow?.ResizeObserver;
      if (Observer) {
        const observer = new Observer(() => {
          if (diagram.isConnected) {
            sync();
          } else {
            observer.disconnect();
            this.mermaidResizeObservers.delete(observer);
          }
        });
        observer.observe(diagram);
        observer.observe(svg);
        this.mermaidResizeObservers.add(observer);
      }
      ownerWindow?.requestAnimationFrame(sync);
      return true;
    };

    if (connectSvg()) return;
    const ownerWindow = diagram.ownerDocument.defaultView as
      (Window & typeof globalThis) | null;
    const Observer = ownerWindow?.MutationObserver;
    if (!Observer) return;
    const observer = new Observer(() => {
      // Renderers often build inside a detached fragment and attach it only
      // afterward, so disconnection alone is not a cleanup signal here.
      if (connectSvg()) {
        observer.disconnect();
        this.mermaidMutationObservers.delete(observer);
      }
    });
    observer.observe(diagram, { childList: true, subtree: true });
    this.mermaidMutationObservers.add(observer);
  }

  private editorView(editor: Editor): EditorView | null {
    return ((editor as unknown as { cm?: EditorView }).cm as EditorView) ?? null;
  }


  /**
   * Retype the block holding the caret. `innerBlockAt` is the same lookup
   * the move and duplicate commands use, so a row of a Callout converts as
   * that row and a list item brings its children — the block the writer
   * would point at, not the paragraph the cursor happens to sit in.
   */
  private turnBlockAtCaret(editor: Editor, prefix: string) {
    const view = this.editorView(editor);
    if (!view) return;
    const doc = view.state.doc;
    const fences = cachedFences(doc);
    const block = innerBlockAt(doc, editor.getCursor().line + 1, fences);
    if (!block) return;
    turnBlockInto(view, block, prefix, fences);
  }

  /** Wrap the block at the caret in a Callout, a toggle, or a fence. */
  private wrapBlockAtCaret(editor: Editor, kind: BlockWrapKind) {
    const view = this.editorView(editor);
    if (!view) return;
    const doc = view.state.doc;
    const fences = cachedFences(doc);
    const block = innerBlockAt(doc, editor.getCursor().line + 1, fences);
    if (!block) return;
    if (kind === "toggle" && !this.settings.toggleBlocks) return;
    wrapBlockInto(view, block, kind, fences);
  }

  /** Open an empty block above or below the one holding the caret — the
   *  keyboard's version of the ⊕ button, and the only way to write above a
   *  Callout that opens the note. */
  private insertBlockAtCaret(editor: Editor, dir: 1 | -1) {
    const view = this.editorView(editor);
    if (!view) return;
    const doc = view.state.doc;
    const fences = cachedFences(doc);
    const block = innerBlockAt(doc, editor.getCursor().line + 1, fences);
    if (!block) return;
    if (dir > 0) insertBlockBelow(view, block, this.settings.slashCommands);
    else insertBlockAbove(view, block, this.settings.slashCommands);
  }

  /** Upgrade a just-pasted bare URL to [Title](url) once the page title
   * arrives. The raw URL must still sit untouched at the paste position;
   * if any edit moved or changed it, the plain URL simply stays. */
  private async linkifyPastedUrl(
    editor: Editor,
    url: string,
    at: EditorPosition
  ) {
    let title: string | null = null;
    let timer = 0;
    try {
      const res = await Promise.race([
        requestUrl({ url, throw: false }),
        new Promise<null>((resolve) => {
          timer = window.setTimeout(() => resolve(null), 8000);
        }),
      ]);
      if (res && res.status >= 200 && res.status < 300) {
        const type = String(res.headers?.["content-type"] ?? "");
        if (!type || type.includes("html")) {
          title = extractHtmlTitle(res.text ?? "");
        }
      }
    } catch {
      // Offline, blocked, or a non-text body — keep the plain URL.
    } finally {
      window.clearTimeout(timer);
    }
    if (!title) return;
    const link = buildTitledLink(url, title);
    if (!link) return;
    try {
      const line = editor.getLine(at.line) ?? "";
      if (line.slice(at.ch, at.ch + url.length) !== url) return;
      editor.replaceRange(link, at, { line: at.line, ch: at.ch + url.length });
    } catch {
      // The editor may have been detached while the title loaded.
    }
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
    const range = getTableRange(doc, cur.line + 1, cachedFences(doc));
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
    const fences = cachedFences(doc);
    const cur = editor.getCursor();
    const block = innerBlockAt(doc, cur.line + 1, fences);
    if (!block) return;
    const offset = cur.line + 1 - block.startLine;
    // A row of a Callout stays in its Callout while it travels.
    const keepPrefix = block.quotePrefix;

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
        vaultIndentUnit(this.app),
        keepPrefix
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
        vaultIndentUnit(this.app),
        keepPrefix
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
    const fences = cachedFences(doc);
    const cur = editor.getCursor();
    const block = innerBlockAt(doc, cur.line + 1, fences);
    if (!block) return;
    const text = doc.sliceString(
      doc.line(block.startLine).from,
      doc.line(block.endLine).to
    );
    const lines = text.split("\n");
    const last = lines[lines.length - 1];
    const seam = seamRowBetween(last, lines[0], block.quotePrefix);
    const nextText = block.endLine < doc.lines
      ? doc.line(block.endLine + 1).text
      : "";
    const trailing = seamRowBetween(last, nextText, block.quotePrefix);
    view.dispatch({
      changes: {
        from: doc.line(block.endLine).to,
        insert:
          (seam === null ? "\n" : `\n${seam}\n`) +
          text +
          (trailing === null ? "" : `\n${trailing}`),
      },
      userEvent: "input.duplicate",
    });
    editor.setCursor({
      line:
        cur.line +
        (block.endLine - block.startLine + 1) +
        (seam === null ? 0 : 1),
      ch: cur.ch,
    });
  }

  onunload() {
    for (const observer of this.tableScrollObservers) observer.disconnect();
    this.tableScrollObservers.clear();
    for (const observer of this.mermaidMutationObservers) observer.disconnect();
    this.mermaidMutationObservers.clear();
    for (const observer of this.mermaidResizeObservers) observer.disconnect();
    this.mermaidResizeObservers.clear();
    for (const observer of this.mermaidDocumentObservers.values()) observer.disconnect();
    this.mermaidDocumentObservers.clear();
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
      "nf-resizing-columns",
      "nf-tables",
      "nf-table-stripes",
      "nf-thead-tint",
      "nf-list-color",
      "nf-quote-color",
      "nf-code-color",
      "nf-code-block-edit",
      "nf-callout-menu",
      "nf-columns",
      "nf-comments",
    ]) {
      document.body.classList.remove(cls);
    }
    for (const theme of CODE_THEMES) {
      if (theme !== "default") document.body.classList.remove(`nf-code-theme-${theme}`);
    }
    document.body.style.removeProperty("--nf-table-header-bg");
    document.body.style.removeProperty("--nf-list-marker");
    document.body.style.removeProperty("--nf-quote-bar");
    document.body.style.removeProperty("--nf-inline-code");
  }

  /** Each appearance feature drives its own body class, so table look,
   *  stripes, header tint, and marker color work independently of the
   *  cleaner-rendering toggle. */
  applyCleanClass() {
    document.body.classList.toggle("nf-clean", this.settings.cleanRendering);
    // Generated content cannot be localized from CSS, so the translated
    // hint is published as a CSS string once, here.
    document.body.style.setProperty(
      "--nf-empty-hint",
      JSON.stringify(t("Type / for commands"))
    );
    // Settings can be enabled after a note has already rendered. Upgrade the
    // current document immediately instead of waiting for another Markdown
    // render pass; pop-out documents are picked up by their post-processors.
    if (this.settings.cleanRendering) {
      this.watchMermaidDocument(document);
      for (const diagram of Array.from(
        document.querySelectorAll<HTMLElement>(".mermaid")
      )) this.enhanceMermaid(diagram);
    }
    document.body.classList.toggle(
      "nf-callout-menu",
      this.settings.calloutEditing
    );
    document.body.classList.toggle(
      "nf-code-block-edit",
      this.settings.codeBlockEditing
    );
    document.body.classList.toggle("nf-columns", this.settings.columnLayout);
    document.body.classList.toggle("nf-toggles", this.settings.toggleBlocks);
    document.body.classList.toggle("nf-comments", this.settings.commenting);
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
        paletteTint(c, 0.16)
      );
    } else {
      document.body.style.removeProperty("--nf-table-header-bg");
    }
    const lm = this.settings.listMarkerColor;
    document.body.classList.toggle("nf-list-color", lm !== "default");
    if (lm === "accent") {
      document.body.style.setProperty("--nf-list-marker", "var(--interactive-accent)");
    } else if ((PALETTE_COLORS as readonly string[]).includes(lm)) {
      document.body.style.setProperty("--nf-list-marker", paletteTextColor(lm));
    } else {
      document.body.style.removeProperty("--nf-list-marker");
    }
    const qb = this.settings.quoteBarColor;
    document.body.classList.toggle("nf-quote-color", qb !== "default");
    if (qb === "text") {
      document.body.style.setProperty("--nf-quote-bar", "var(--text-normal)");
    } else if (qb === "accent") {
      document.body.style.setProperty("--nf-quote-bar", "var(--interactive-accent)");
    } else if ((PALETTE_COLORS as readonly string[]).includes(qb)) {
      document.body.style.setProperty("--nf-quote-bar", paletteTextColor(qb));
    } else {
      document.body.style.removeProperty("--nf-quote-bar");
    }
    const ic = this.settings.inlineCodeColor;
    const validInlineCode = (PALETTE_COLORS as readonly string[]).includes(ic);
    document.body.classList.toggle("nf-code-color", validInlineCode);
    if (validInlineCode) {
      document.body.style.setProperty("--nf-inline-code", paletteTextColor(ic));
    } else {
      document.body.style.removeProperty("--nf-inline-code");
    }
    const codeTheme = (CODE_THEMES as readonly string[]).includes(this.settings.codeTheme)
      ? this.settings.codeTheme
      : "default";
    for (const theme of CODE_THEMES) {
      if (theme !== "default") {
        document.body.classList.toggle(
          `nf-code-theme-${theme}`,
          codeTheme === theme
        );
      }
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

/** Compact caption editor shared by code blocks and images. Captions are
 * single-line by design, matching Notion and keeping the portable HTML
 * metadata row structurally unambiguous. Saving an empty value removes
 * the caption (while a collapsed code block keeps its empty state row). */
/** One-line text prompt: the caption editor, and anything else that needs
 *  a value typed for a block a widget stands in for. */
class TextPromptModal extends Modal {
  private input!: HTMLInputElement;

  constructor(
    app: App,
    private options: {
      title: string;
      placeholder: string;
      initial: string;
      onSave: (value: string) => void;
    }
  ) {
    super(app);
  }

  onOpen() {
    this.contentEl.addClass("nf-caption-modal");
    this.contentEl.createEl("h2", { text: this.options.title });
    this.input = this.contentEl.createEl("input", {
      cls: "nf-caption-input",
      attr: {
        type: "text",
        placeholder: this.options.placeholder,
        "aria-label": this.options.title,
      },
    });
    this.input.value = this.options.initial;
    const actions = this.contentEl.createDiv({ cls: "nf-caption-actions" });
    const cancel = actions.createEl("button", { text: t("Cancel") });
    const save = actions.createEl("button", {
      cls: "mod-cta",
      text: t("Save"),
    });
    const commit = () => {
      const value = this.input.value;
      this.close();
      this.options.onSave(value);
    };
    cancel.addEventListener("click", () => this.close());
    save.addEventListener("click", commit);
    this.input.addEventListener("keydown", (evt) => {
      if (evt.key === "Escape") {
        evt.preventDefault();
        this.close();
      } else if (evt.key === "Enter") {
        evt.preventDefault();
        commit();
      }
    });
    this.input.focus();
    this.input.select();
  }

  onClose() {
    this.contentEl.empty();
  }
}

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
    key: "tableHeaderColor" | "listMarkerColor" | "quoteBarColor" | "inlineCodeColor",
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

  private codeThemeDropdown(parent: HTMLElement): Setting {
    return new Setting(parent)
      .setName(t("Code block theme"))
      .setDesc(t("Syntax colors for fenced code blocks in Live Preview and Reading view. Obsidian adaptive is designed for the default theme and follows light/dark mode."))
      .addDropdown((dd) => {
        for (const value of CODE_THEMES) {
          dd.addOption(value, t(CODE_THEME_LABELS[value]));
        }
        dd.setValue(this.plugin.settings.codeTheme).onChange(async (value) => {
          this.plugin.settings.codeTheme = value;
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
    this.containerEl.addClass("nf-settings");
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
    this.toggle(
      this.containerEl,
      "Paste URLs with page titles",
      "Pasting a URL with nothing selected fetches the page title in the background and turns the URL into [title](url). The plain URL stays when the page cannot be reached; code contexts are never touched.",
      "pasteUrlTitles"
    );
    this.toggle(
      this.containerEl,
      "Callout and quote enhancements",
      "Enter continues the block and exits on an empty line, Backspace at the text start removes a \">\" marker, multi-line pastes stay inside the block, a Callout keeps its rendered look while you edit inside it, and clicking its icon opens the type menu.",
      "calloutEditing"
    );
    this.toggle(
      this.containerEl,
      "Code block enhancements",
      "In fenced code blocks, Enter keeps the current line's indentation (so blocks nested in lists stay aligned), Backspace at the text start removes one indent level, Enter after an unclosed ``` writes the closing fence, and Cmd/Ctrl+Shift+Enter (the \"Exit code block\" command) exits below the block.",
      "codeBlockEditing"
    );
    this.toggle(
      this.containerEl,
      "Block indentation with Tab",
      "Tab and Shift+Tab step the block holding the caret through the same nesting levels a sideways drag offers — a paragraph, heading, quote, or Callout tucks under the list item above it. List items stay with Obsidian's own indent, table cells with table navigation, and code blocks with code indentation; where a block has nowhere to go, Tab keeps its ordinary meaning.",
      "blockIndent"
    );
    this.toggle(
      this.containerEl,
      "Shorthand while typing",
      'Type ">!" and a space for a Callout — ">!tip", ">!warning" pick the type, a trailing "+" or "-" makes it foldable — and "[]" and a space for a to-do. The shorthand only expands at the end of a line you are typing, never inside code, and one undo puts the characters back.',
      "inputRules"
    );
    this.toggle(
      this.containerEl,
      "Empty-line hint",
      'Show a faint "Type / for commands" on the empty line you are writing on, the way Notion labels an empty block. It is display-only — nothing is written to the note — and it never appears inside a code block or on a line that already has text.',
      "emptyLineHint"
    );
    this.toggle(
      this.containerEl,
      "Select blocks with Escape",
      "Escape selects the block holding the caret; ↑/↓ walk to the block above or below, Shift+↑/↓ extend the selection, and Enter returns to writing at its end. Everything the mouse selection already offers — copy, cut, duplicate, delete, format — works on it.",
      "blockSelectKey"
    );
    this.toggle(
      this.containerEl,
      "Columns",
      'Notion-style side-by-side layout. Insert with "/columns", pick "Turn into columns" from a block menu, or drag a block to the right edge of another. Written as nested [!nf-cols]/[!nf-col] callouts — plain quotes in any other Markdown app. "[!nf-col|30]" pins a column to 30% width.',
      "columnLayout"
    );
    this.toggle(
      this.containerEl,
      "Toggles",
      'Notion-style foldable blocks. Insert with "/toggle" or pick "Turn into toggle" from a block menu; click the triangle to fold. Written as a [!nf-toggle] callout whose +/- marker holds the open state, so it is saved in the note and travels with it — a plain quote in any other Markdown app.',
      "toggleBlocks"
    );
    this.toggle(
      this.containerEl,
      "Comments",
      'Select text and add a note to it — from the toolbar 💬 button, the "Add comment" command, or Cmd/Ctrl+Shift+M. The anchor highlights in yellow with a 💬 marker; click the marker to read, edit, or resolve. Comments are stored inside the note and stay invisible in other Markdown apps.',
      "commenting"
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
      "Apply display-only polish to quotes, dividers, headings, tasks, inline code, and Mermaid diagrams in Live Preview and Reading view. List cycles stay enabled independently. Your Markdown is never changed.",
      "cleanRendering"
    );
    this.toggle(
      this.containerEl,
      "Conceal HTML formatting tags",
      "Hide the raw <span>, <mark>, <u>, <b>, <i>, and <s> tags written by the formatting tools in Live Preview, and render them as styled text inside code blocks in Reading view.",
      "concealHtml"
    );
    this.colorDropdown(
      this.containerEl,
      "List marker color",
      "Color of bullets and list numbers.",
      "listMarkerColor",
      [["accent", "Accent color"], ["default", "Theme default"]]
    );
    this.colorDropdown(
      this.containerEl,
      "Quote bar color",
      "Color of the vertical bar beside quote blocks.",
      "quoteBarColor",
      [
        ["text", "Text color"],
        ["accent", "Accent color"],
        ["default", "Theme default"],
      ]
    );
    this.colorDropdown(
      this.containerEl,
      "Inline code color",
      "Ink of `inline code` text, Notion-style. Fenced code blocks are unaffected.",
      "inlineCodeColor",
      [["default", "Theme default"]]
    );
    this.codeThemeDropdown(this.containerEl);

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
    this.toggle(
      this.containerEl,
      "Conceal heading markers while writing",
      'Hide a heading\'s "#" run on the line you are writing, not only after you leave it, so typing "## " makes the line a heading the way Notion does. Move the caret in front of the text to bring the marker back, or press Backspace there to remove the whole marker at once. The Markdown is unchanged.',
      "concealHeadings"
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
