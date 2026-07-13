import {
  App,
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  MarkdownView,
  Menu,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  setIcon,
} from "obsidian";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import { EditorState, RangeSetBuilder, Text } from "@codemirror/state";
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
}

const DEFAULT_SETTINGS: NotionFlowSettings = {
  dragHandles: true,
  slashCommands: true,
  floatingToolbar: true,
  cleanRendering: true,
  pasteUrlLinks: true,
};

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

const RE_LIST = /^(\s*)(?:[-*+]|\d+[.)])\s/;
const RE_HEADING = /^#{1,6}\s/;
const RE_FENCE = /^\s*(```|~~~)/;
const RE_QUOTE = /^\s*>/;
const RE_BLANK = /^\s*$/;

function indentWidth(s: string): number {
  const m = s.match(/^\s*/);
  return m ? m[0].replace(/\t/g, "    ").length : 0;
}

/** A fenced code block, marker lines included (1-based, inclusive). */
export interface FenceRange {
  startLine: number;
  endLine: number;
  indent: number; // indent of the opening marker
}

const RE_FENCE_OPEN = /^(\s*)(`{3,}|~{3,})/;

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
      if (m) {
        openLine = i;
        openChar = m[2][0];
        openLen = m[2].length;
        openIndent = indentWidth(m[1]);
      }
    } else if (m && m[2][0] === openChar && m[2].length >= openLen) {
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
  if (RE_BLANK.test(text)) return null;

  // Heading: single line.
  if (RE_HEADING.test(text)) return { startLine: lineNo, endLine: lineNo };

  // Quote / callout: contiguous ">" lines (never crossing a fence).
  if (RE_QUOTE.test(text)) {
    let start = lineNo;
    let end = lineNo;
    while (
      start > 1 &&
      !fenceAt(fences, start - 1) &&
      RE_QUOTE.test(doc.line(start - 1).text)
    )
      start--;
    while (
      end < doc.lines &&
      !fenceAt(fences, end + 1) &&
      RE_QUOTE.test(doc.line(end + 1).text)
    )
      end++;
    return { startLine: start, endLine: end };
  }

  // List item: this line plus its nested content — deeper-indented lines,
  // nested code fences (which may contain blank or oddly indented lines),
  // and blank separators of a loose list when deeper content follows.
  const listMatch = text.match(RE_LIST);
  if (listMatch) {
    const indent = indentWidth(listMatch[1]);
    let end = lineNo;
    let i = lineNo + 1;
    while (i <= doc.lines) {
      // A nested fence swallows everything up to its closing marker.
      const f = fenceAt(fences, i);
      if (f && f.indent > indent) {
        end = f.endLine;
        i = f.endLine + 1;
        continue;
      }
      const t = doc.line(i).text;
      if (RE_BLANK.test(t)) {
        // Loose list: keep going only if the next non-blank line is still
        // part of this item (deeper indent or a deeper nested fence).
        let j = i + 1;
        while (j <= doc.lines && RE_BLANK.test(doc.line(j).text)) j++;
        if (j > doc.lines) break;
        const nf = fenceAt(fences, j);
        const deeper = nf ? nf.indent > indent : indentWidth(doc.line(j).text) > indent;
        if (!deeper) break;
        i = j; // skip the blanks; the next iteration includes line j
        continue;
      }
      if (indentWidth(t) > indent) {
        end = i;
        i++;
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
      !RE_BLANK.test(t) &&
      !RE_HEADING.test(t) &&
      !RE_QUOTE.test(t) &&
      !RE_LIST.test(t)
    );
  };
  let start = lineNo;
  let end = lineNo;
  while (start > 1 && isPlain(start - 1)) start--;
  while (end < doc.lines && isPlain(end + 1)) end++;
  return { startLine: start, endLine: end };
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
      if (delta > 0) return indentPrefix(delta, unit) + l;
      let removed = 0;
      let i = 0;
      while (i < l.length && removed < -delta) {
        if (l[i] === " ") removed += 1;
        else if (l[i] === "\t") removed += 4;
        else break;
        i++;
      }
      return l.slice(i);
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

/** Deletion span for a block: its lines plus the newline that separates it. */
function blockRemovalRange(doc: Text, block: BlockRange): { from: number; to: number } {
  let from = doc.line(block.startLine).from;
  const lastLine = doc.line(block.endLine);
  const hasTrailingNewline = lastLine.to < doc.length;
  const to = hasTrailingNewline ? lastLine.to + 1 : lastLine.to;
  // Block sits at the very end of the doc: also consume the newline before it
  // so we don't leave a stray blank line behind.
  if (!hasTrailingNewline && from > 0) from -= 1;
  return { from, to };
}

/**
 * Valid indentation levels for a block inserted before `targetLine`,
 * sorted ascending. Levels are derived from the real markdown context:
 * every ancestor list item above contributes its own indent (sibling
 * position) plus its content indent (child position, offset by the
 * item's actual marker width — 2 for "- ", 3 for "1. "), and the line
 * below contributes its indent so a drop can join an existing level.
 */
export function computeDropIndents(
  doc: Text,
  fences: FenceRange[],
  targetLine: number,
  exclude?: BlockRange,
  unitWidth: number = DEFAULT_INDENT_UNIT.width
): number[] {
  const cands = new Set<number>([0]);
  // Lines of the block being dragged don't count as context — they are
  // about to move, and must not offer a "nest under itself" level.
  const skip = (n: number) =>
    exclude !== undefined && n >= exclude.startLine && n <= exclude.endLine;

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
      // A list item also offers the "child" level: one editor indent
      // unit (Tab key parity), but never less than the marker's real
      // content indent so the child still parses as nested.
      if (m) cands.add(ind + Math.max(m[0].length - m[1].length, unitWidth));
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
) {
  const doc = view.state.doc;
  const inPlace = targetLine >= block.startLine && targetLine <= block.endLine + 1;
  if (inPlace && indentOverride === undefined) return;

  const baseIndent = indentWidth(doc.line(block.startLine).text);
  const targetIndent =
    indentOverride !== undefined
      ? pickIndent(computeDropIndents(doc, fences, targetLine, block, unit.width), indentOverride)
      : computeTargetIndent(doc, fences, targetLine);

  // Dropped back onto its own position: a horizontal drag still changes
  // the nesting level, so reindent the block where it stands.
  if (inPlace) {
    if (targetIndent === baseIndent) return;
    const from = doc.line(block.startLine).from;
    const to = doc.line(block.endLine).to;
    view.dispatch({
      changes: {
        from,
        to,
        insert: reindentBlock(doc.sliceString(from, to), targetIndent - baseIndent, unit),
      },
      userEvent: "move.block",
    });
    return;
  }

  const { from, to } = blockRemovalRange(doc, block);
  let text = doc.sliceString(doc.line(block.startLine).from, doc.line(block.endLine).to);
  text = reindentBlock(text, targetIndent - baseIndent, unit);

  let insertPos: number;
  let insert: string;
  if (targetLine > doc.lines) {
    insertPos = doc.length;
    insert = "\n" + text;
  } else {
    insertPos = doc.line(targetLine).from;
    insert = text + "\n";
  }

  view.dispatch({
    changes: [
      { from, to },
      { from: insertPos, insert },
    ],
    userEvent: "move.block",
  });
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
/* Drag handle view plugin                                             */
/* ------------------------------------------------------------------ */

function makeDragHandlePlugin(plugin: NotionFlowPlugin) {
  return ViewPlugin.fromClass(
    class DragHandleView {
      view: EditorView;
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
      fences: FenceRange[] = [];
      lastX = 0;
      lastY = 0;
      scrollTimer: number | null = null;
      scrollSpeed = 0;

      onMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
      onScroll = () => this.hideHover();
      onLeave = (e: MouseEvent) => {
        if (this.dragging) return;
        const t = e.relatedTarget as HTMLElement | null;
        if (
          t &&
          (t === this.handle || this.handle.contains(t) ||
            t === this.plus || this.plus.contains(t))
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

      constructor(view: EditorView) {
        this.view = view;
        this.fences = scanFences(view.state.doc);

        this.handle = document.body.createDiv({ cls: "nf-drag-handle" });
        setIcon(this.handle, "grip-vertical");
        this.handle.style.display = "none";
        this.handle.addEventListener("mousedown", (e) => this.startDrag(e));

        this.plus = document.body.createDiv({
          cls: "nf-plus-btn",
          attr: { "aria-label": t("Insert block below") },
        });
        setIcon(this.plus, "plus");
        this.plus.style.display = "none";
        this.plus.addEventListener("mousedown", (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          if (this.hoverBlock) this.insertBelow(this.hoverBlock);
        });

        this.indicator = document.body.createDiv({ cls: "nf-drop-indicator" });
        this.indicator.style.display = "none";

        this.highlight = document.body.createDiv({ cls: "nf-block-highlight" });
        this.highlight.style.display = "none";

        this.ghost = document.body.createDiv({ cls: "nf-drag-ghost" });
        this.ghost.style.display = "none";

        view.scrollDOM.addEventListener("mousemove", this.onMouseMove);
        view.scrollDOM.addEventListener("scroll", this.onScroll);
        view.scrollDOM.addEventListener("mouseleave", this.onLeave);
      }

      /** Screen rect of a block (top of first line → bottom of last line). */
      blockRect(block: BlockRange): { top: number; bottom: number } | null {
        const doc = this.view.state.doc;
        const scrollRect = this.view.scrollDOM.getBoundingClientRect();
        const topC = this.view.coordsAtPos(doc.line(block.startLine).from);
        const botC = this.view.coordsAtPos(doc.line(block.endLine).to);
        const top = topC ? topC.top : scrollRect.top;
        const bottom = botC ? botC.bottom : scrollRect.bottom;
        if (!topC && !botC) return null;
        return { top, bottom };
      }

      showHighlight(block: BlockRange) {
        const rect = this.blockRect(block);
        if (!rect) {
          this.highlight.style.display = "none";
          return;
        }
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        this.highlight.style.display = "block";
        this.highlight.style.left = `${contentRect.left - 6}px`;
        this.highlight.style.width = `${contentRect.width + 12}px`;
        this.highlight.style.top = `${rect.top - 2}px`;
        this.highlight.style.height = `${rect.bottom - rect.top + 4}px`;
      }

      handleMouseMove(e: MouseEvent) {
        if (this.dragging || this.pendingDrag) return;
        if (!plugin.settings.dragHandles) {
          this.hideHover();
          return;
        }
        const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
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
        const coords = this.view.coordsAtPos(doc.line(block.startLine).from);
        if (!coords) {
          this.hideHover();
          return;
        }
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        // Vertically center on the first line (headings are taller).
        const rowTop = coords.top + (coords.bottom - coords.top) / 2 - 11;
        this.handle.style.display = "flex";
        this.handle.style.left = `${contentRect.left - 26}px`;
        this.handle.style.top = `${rowTop}px`;
        this.plus.style.display = "flex";
        this.plus.style.left = `${contentRect.left - 50}px`;
        this.plus.style.top = `${rowTop}px`;
        this.showHighlight(block);
      }

      hideHover() {
        if (this.dragging || this.pendingDrag) return;
        this.handle.style.display = "none";
        this.plus.style.display = "none";
        this.highlight.style.display = "none";
        this.hoverBlock = null;
      }

      /** "+" button: open a fresh line below the block and pop the slash
       *  menu, ready to pick a block type. */
      insertBelow(block: BlockRange) {
        const doc = this.view.state.doc;
        const end = doc.line(block.endLine).to;
        this.view.dispatch({
          changes: { from: end, insert: "\n" },
          selection: { anchor: end + 1 },
          userEvent: "input",
        });
        this.view.focus();
        this.plus.style.display = "none";
        this.handle.style.display = "none";
        this.highlight.style.display = "none";
        // Type the "/" in a separate transaction so the editor suggester
        // sees it as user input and opens the slash menu.
        window.setTimeout(() => {
          const head = this.view.state.selection.main.head;
          this.view.dispatch({
            changes: { from: head, insert: "/" },
            selection: { anchor: head + 1 },
            userEvent: "input.type",
          });
        }, 0);
      }

      /** Mousedown arms a *pending* drag; movement > 4px turns it into a
       *  real drag, a clean mouseup opens the block menu instead. */
      startDrag(e: MouseEvent) {
        if (e.button !== 0 || !this.hoverBlock) return;
        e.preventDefault();
        e.stopPropagation();
        this.pendingDrag = { x: e.clientX, y: e.clientY, block: this.hoverBlock };
        document.addEventListener("mousemove", this.onDocMove);
        document.addEventListener("mouseup", this.onDocUp);
        document.addEventListener("keydown", this.onKeyDown, true);
      }

      beginRealDrag() {
        if (!this.pendingDrag) return;
        this.dragBlock = this.pendingDrag.block;
        this.pendingDrag = null;
        this.dragging = true;
        this.dropLine = -1;
        this.dropIndent = undefined;
        document.body.classList.add("nf-dragging");
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
        this.ghost.createDiv({ cls: "nf-drag-ghost-text", text: raw.slice(0, 240) });
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
          this.scrollTimer = window.setInterval(() => {
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
          window.clearInterval(this.scrollTimer);
          this.scrollTimer = null;
        }
        this.scrollSpeed = 0;
      }

      updateDropTarget(x: number, y: number) {
        if (!this.dragBlock) return;
        const pos = this.view.posAtCoords({ x, y });
        const doc = this.view.state.doc;
        let target: number;
        if (pos == null) {
          target = y < this.view.contentDOM.getBoundingClientRect().top ? 1 : doc.lines + 1;
        } else {
          const line = doc.lineAt(pos);
          const coords = this.view.coordsAtPos(line.from);
          const mid = coords ? (coords.top + coords.bottom) / 2 : y;
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

        // Mouse X chooses the nesting depth, snapped to the valid levels
        // this exact position offers.
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const charW = this.view.defaultCharacterWidth || 8;
        const cands = computeDropIndents(
          doc,
          this.fences,
          target,
          this.dragBlock,
          vaultIndentUnit(plugin.app).width
        );
        const desired = Math.max(0, x - contentRect.left) / charW;
        const indent = pickIndent(cands, desired);
        this.dropIndent = indent;

        const xOff = Math.min(indent * charW, contentRect.width / 2);
        let indicatorY: number;
        if (target > doc.lines) {
          const c = this.view.coordsAtPos(doc.length);
          indicatorY = c ? c.bottom : contentRect.bottom;
        } else {
          const c = this.view.coordsAtPos(doc.line(target).from);
          indicatorY = c ? c.top : contentRect.top;
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
        document.removeEventListener("mousemove", this.onDocMove);
        document.removeEventListener("mouseup", this.onDocUp);
        document.removeEventListener("keydown", this.onKeyDown, true);
        this.stopAutoScroll();
        this.pendingDrag = null;
        this.dragging = false;
        this.dragBlock = null;
        this.dropLine = -1;
        this.dropIndent = undefined;
        document.body.classList.remove("nf-dragging");
        this.handle.classList.remove("is-dragging");
        this.highlight.classList.remove("is-dragging");
        this.indicator.style.display = "none";
        this.ghost.style.display = "none";
        this.handle.style.display = "none";
        this.plus.style.display = "none";
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
          openBlockMenu(plugin, this.view, pending.block, this.fences, e);
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
        if (update.docChanged) {
          this.fences = scanFences(update.state.doc);
          // Hover geometry is stale after an edit; next mousemove re-shows.
          this.hideHover();
        }
      }

      destroy() {
        this.view.scrollDOM.removeEventListener("mousemove", this.onMouseMove);
        this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
        this.view.scrollDOM.removeEventListener("mouseleave", this.onLeave);
        document.removeEventListener("mousemove", this.onDocMove);
        document.removeEventListener("mouseup", this.onDocUp);
        document.removeEventListener("keydown", this.onKeyDown, true);
        this.stopAutoScroll();
        this.handle.remove();
        this.plus.remove();
        this.indicator.remove();
        this.highlight.remove();
        this.ghost.remove();
      }
    }
  );
}

/* ------------------------------------------------------------------ */
/* Nested-block visual indent                                          */
/*                                                                     */
/* Obsidian's Live Preview draws code fences and callouts nested in    */
/* lists flush against the left content edge — only their two leading  */
/* spaces move. These line decorations shift the whole line box (with  */
/* its background) by the block's indent, so nested blocks visually    */
/* sit under their parent item like they do in Notion.                 */
/* ------------------------------------------------------------------ */

const RE_NESTED_QUOTE = /^(\s+)>/;

function makeNestedIndentPlugin(plugin: NotionFlowPlugin) {
  return ViewPlugin.fromClass(
    class NestedIndentView {
      decorations: DecorationSet;
      fences: FenceRange[];

      constructor(view: EditorView) {
        this.fences = scanFences(view.state.doc);
        this.decorations = this.build(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged) this.fences = scanFences(update.state.doc);
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.build(update.view);
        }
      }

      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        if (!plugin.settings.cleanRendering) return builder.finish();
        const doc = view.state.doc;
        for (const range of view.visibleRanges) {
          let pos = range.from;
          while (pos <= range.to) {
            const line = doc.lineAt(pos);
            let indent = 0;
            const f = fenceAt(this.fences, line.number);
            if (f && f.indent > 0) {
              indent = f.indent;
            } else if (!f) {
              const m = line.text.match(RE_NESTED_QUOTE);
              if (m) indent = indentWidth(m[1]);
            }
            if (indent > 0) {
              builder.add(
                line.from,
                line.from,
                Decoration.line({
                  attributes: {
                    class: "nf-nested-block",
                    style: `--nf-nest:${indent}ch;`,
                  },
                })
              );
            }
            pos = line.to + 1;
          }
        }
        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations }
  );
}

/* ------------------------------------------------------------------ */
/* Block menu (click the handle)                                       */
/* ------------------------------------------------------------------ */

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
  plugin: NotionFlowPlugin,
  view: EditorView,
  block: BlockRange,
  fences: FenceRange[],
  evt: MouseEvent
) {
  const doc = view.state.doc;
  const blockText = doc.sliceString(
    doc.line(block.startLine).from,
    doc.line(block.endLine).to
  );
  const menu = new Menu();

  const isFence = fenceAt(fences, block.startLine) != null;
  if (!isFence) {
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
      .setTitle(t("Duplicate"))
      .setIcon("copy-plus")
      .onClick(() => {
        const insertPos = doc.line(block.endLine).to;
        view.dispatch({
          changes: { from: insertPos, insert: "\n" + blockText },
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
      .onClick(() => {
        const { from, to } = blockRemovalRange(doc, block);
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
  // Peel wrappers that sit just outside/inside the selection first.
  applyTextColor(view, null);
  applyHighlightColor(view, null);
  for (const m of ["**", "~~", "==", "`", "*"]) {
    let guard = 0;
    while (getWrapState(view.state, m) !== "none" && guard++ < 4) toggleWrap(view, m);
  }
  const sel = view.state.selection.main;
  if (sel.empty) return;
  const selected = view.state.doc.sliceString(sel.from, sel.to);
  const stripped = selected
    .replace(/<\/?(?:span|mark)[^>]*>/g, "")
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

const TOOLBAR_ACTIONS: ToolbarAction[] = [
  { icon: "bold", tooltip: t("Bold"), marker: "**", run: (v) => toggleWrap(v, "**") },
  { icon: "italic", tooltip: t("Italic"), marker: "*", run: (v) => toggleWrap(v, "*") },
  { icon: "strikethrough", tooltip: t("Strikethrough"), marker: "~~", run: (v) => toggleWrap(v, "~~") },
  { icon: "code", tooltip: t("Inline code"), marker: "`", run: (v) => toggleWrap(v, "`") },
  { icon: "link", tooltip: t("Link"), run: insertLink },
];

function makeToolbarPlugin(plugin: NotionFlowPlugin) {
  return ViewPlugin.fromClass(
    class ToolbarView {
      view: EditorView;
      toolbar: HTMLElement;
      buttons: { el: HTMLElement; action: ToolbarAction }[] = [];

      // Document-level: callout/table widgets swallow mouseup before it
      // reaches the editor DOM, but it still bubbles to the document.
      onMouseUp = (e: MouseEvent) => {
        const t = e.target as HTMLElement | null;
        if (t && this.toolbar.contains(t)) return;
        window.setTimeout(() => {
          if (this.view.hasFocus || (t && this.view.dom.contains(t))) this.maybeShow();
        }, 0);
      };
      onKeyUp = (e: KeyboardEvent) => {
        if (e.key === "Escape") return this.hide();
        // Follow the real selection: covers Shift+arrows, Cmd+A, etc.
        if (this.view.state.selection.main.empty) this.hide();
        else this.maybeShow();
      };
      // Hide instantly when a click starts anywhere outside the toolbar —
      // prevents a stale toolbar from lingering while the selection moves.
      onMouseDown = (e: MouseEvent) => {
        const t = e.target as HTMLElement | null;
        if (t && this.toolbar.contains(t)) return;
        this.hide();
      };
      onBlur = () => window.setTimeout(() => this.hide(), 150);

      mainRow!: HTMLElement;
      palRow!: HTMLElement;
      palMode: "none" | "color" | "bg" = "none";
      colorBtn!: HTMLElement;
      bgBtn!: HTMLElement;

      constructor(view: EditorView) {
        this.view = view;
        this.toolbar = document.body.createDiv({ cls: "nf-toolbar" });
        this.toolbar.style.display = "none";
        this.mainRow = this.toolbar.createDiv({ cls: "nf-toolbar-row" });
        this.palRow = this.toolbar.createDiv({ cls: "nf-toolbar-row nf-toolbar-palette" });
        this.palRow.style.display = "none";

        const mkBtn = (parent: HTMLElement, icon: string, label: string) => {
          const btn = parent.createEl("button", {
            cls: "nf-toolbar-btn",
            attr: { "aria-label": label },
          });
          setIcon(btn, icon);
          return btn;
        };

        for (const action of TOOLBAR_ACTIONS.slice(0, 3)) {
          const btn = mkBtn(this.mainRow, action.icon, action.tooltip);
          btn.addEventListener("mousedown", (e) => {
            e.preventDefault(); // keep editor selection
            action.run(this.view);
            window.setTimeout(() => this.maybeShow(), 0);
          });
          this.buttons.push({ el: btn, action });
        }

        // Text color + highlight color open palettes.
        this.colorBtn = mkBtn(this.mainRow, "baseline", t("Text color"));
        this.colorBtn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          this.togglePalette("color");
        });
        this.bgBtn = mkBtn(this.mainRow, "highlighter", t("Highlight color"));
        this.bgBtn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          this.togglePalette("bg");
        });

        for (const action of TOOLBAR_ACTIONS.slice(3)) {
          const btn = mkBtn(this.mainRow, action.icon, action.tooltip);
          btn.addEventListener("mousedown", (e) => {
            e.preventDefault();
            action.run(this.view);
            window.setTimeout(() => this.maybeShow(), 0);
          });
          this.buttons.push({ el: btn, action });
        }

        const clearBtn = mkBtn(this.mainRow, "remove-formatting", t("Clear formatting"));
        clearBtn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          clearInlineFormatting(this.view);
          window.setTimeout(() => this.maybeShow(), 0);
        });

        document.addEventListener("mouseup", this.onMouseUp);
        document.addEventListener("mousedown", this.onMouseDown);
        view.dom.addEventListener("keyup", this.onKeyUp);
        view.contentDOM.addEventListener("blur", this.onBlur);
      }

      togglePalette(mode: "color" | "bg") {
        this.palMode = this.palMode === mode ? "none" : mode;
        this.colorBtn.classList.toggle("is-open", this.palMode === "color");
        this.bgBtn.classList.toggle("is-open", this.palMode === "bg");
        this.buildPalette();
        this.position();
      }

      buildPalette() {
        this.palRow.empty();
        if (this.palMode === "none") {
          this.palRow.style.display = "none";
          return;
        }
        this.palRow.style.display = "flex";
        const isText = this.palMode === "color";

        if (!isText) {
          // Default markdown highlight (==) first.
          const def = this.palRow.createEl("button", {
            cls: "nf-swatch nf-swatch-default",
            attr: { "aria-label": t("Default highlight (==)") },
          });
          def.addEventListener("mousedown", (e) => {
            e.preventDefault();
            toggleWrap(this.view, "==");
            window.setTimeout(() => this.maybeShow(), 0);
          });
        }
        const colors = isText ? TEXT_COLORS : BG_COLORS;
        for (const c of colors) {
          const sw = this.palRow.createEl("button", {
            cls: "nf-swatch",
            attr: { "aria-label": c },
          });
          if (isText) {
            sw.setText("A");
            sw.style.color = c;
          } else {
            sw.style.backgroundColor = c;
          }
          sw.addEventListener("mousedown", (e) => {
            e.preventDefault();
            if (isText) applyTextColor(this.view, c);
            else applyHighlightColor(this.view, c);
            window.setTimeout(() => this.maybeShow(), 0);
          });
        }
        const off = this.palRow.createEl("button", {
          cls: "nf-swatch nf-swatch-off",
          attr: { "aria-label": t("Remove color") },
        });
        setIcon(off, "ban");
        off.addEventListener("mousedown", (e) => {
          e.preventDefault();
          if (isText) applyTextColor(this.view, null);
          else {
            applyHighlightColor(this.view, null);
            if (getWrapState(this.view.state, "==") !== "none") toggleWrap(this.view, "==");
          }
          window.setTimeout(() => this.maybeShow(), 0);
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
        const domSel = window.getSelection();
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
        const rect = this.toolbar.getBoundingClientRect();
        const centerX = (r.left + r.right) / 2;
        let left = centerX - rect.width / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8));
        let top = r.top - rect.height - 8;
        if (top < 8) top = r.bottom + 8;
        this.toolbar.style.left = `${left}px`;
        this.toolbar.style.top = `${top}px`;
      }

      maybeShow() {
        if (!plugin.settings.floatingToolbar) return this.hide();
        const sel = this.view.state.selection.main;
        if (sel.empty) return this.hide();
        if (!this.selRect()) return this.hide();
        // Light up buttons whose format is already applied.
        for (const { el, action } of this.buttons) {
          if (!action.marker) continue;
          el.classList.toggle(
            "is-active",
            getWrapState(this.view.state, action.marker) !== "none"
          );
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
      }

      update(update: ViewUpdate) {
        if (update.docChanged && this.view.state.selection.main.empty) this.hide();
      }

      destroy() {
        document.removeEventListener("mouseup", this.onMouseUp);
        document.removeEventListener("mousedown", this.onMouseDown);
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
  /** Prefix applied to the current line (mutually exclusive with insert). */
  linePrefix?: string;
  /** Block text inserted at the cursor; "‸" marks the final cursor spot. */
  insert?: string;
}

// Keywords mix English and Chinese so either language filters the menu,
// whatever UI language is active.
export const SLASH_COMMANDS: SlashCommand[] = [
  { id: "h1", name: t("Heading 1"), icon: "heading-1", keywords: "h1 title 标题 一级标题", linePrefix: "# " },
  { id: "h2", name: t("Heading 2"), icon: "heading-2", keywords: "h2 subtitle 标题 二级标题", linePrefix: "## " },
  { id: "h3", name: t("Heading 3"), icon: "heading-3", keywords: "h3 标题 三级标题", linePrefix: "### " },
  { id: "bullet", name: t("Bulleted list"), icon: "list", keywords: "ul unordered 列表 无序列表", linePrefix: "- " },
  { id: "number", name: t("Numbered list"), icon: "list-ordered", keywords: "ol ordered 列表 有序列表 编号", linePrefix: "1. " },
  { id: "todo", name: t("To-do list"), icon: "check-square", keywords: "task checkbox 待办 任务 复选框", linePrefix: "- [ ] " },
  { id: "quote", name: t("Quote"), icon: "quote", keywords: "blockquote 引用", linePrefix: "> " },
  { id: "callout", name: t("Callout"), icon: "megaphone", keywords: "note info admonition 标注 提示", insert: "> [!note] ‸\n> " },
  { id: "toggle", name: t("Toggle (foldable callout)"), icon: "chevron-right", keywords: "fold collapse 折叠", insert: "> [!note]- ‸\n> " },
  { id: "code", name: t("Code block"), icon: "code-2", keywords: "fence snippet 代码 代码块", insert: "```‸\n\n```" },
  { id: "table", name: t("Table"), icon: "table", keywords: "grid 表格", insert: "| ‸ |  |\n| --- | --- |\n|  |  |" },
  { id: "divider", name: t("Divider"), icon: "minus", keywords: "hr rule separator 分割线 分隔线", insert: "---\n‸" },
  { id: "image", name: t("Image / embed"), icon: "image", keywords: "picture attach embed 图片 附件 嵌入", insert: "![[‸]]" },
  { id: "wikilink", name: t("Internal link"), icon: "link-2", keywords: "note wiki 链接 内链 双链", insert: "[[‸]]" },
];

export class SlashSuggest extends EditorSuggest<SlashCommand> {
  plugin: NotionFlowPlugin;

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
    // text/punctuation — CJK prose has no spaces before the slash.
    // Ranges: CJK punctuation+kana, unified ideographs, fullwidth forms.
    const m = before.match(
      /(?:^|[\s>]|[　-ヿ一-鿿＀-￯])\/([\w-]*)$/
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
    return SLASH_COMMANDS.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.keywords.includes(q) ||
        c.id.startsWith(q)
    );
  }

  renderSuggestion(cmd: SlashCommand, el: HTMLElement) {
    el.addClass("nf-slash-item");
    const iconEl = el.createDiv({ cls: "nf-slash-icon" });
    setIcon(iconEl, cmd.icon);
    el.createDiv({ cls: "nf-slash-name", text: cmd.name });
  }

  selectSuggestion(cmd: SlashCommand, _evt: MouseEvent | KeyboardEvent) {
    const ctx = this.context;
    if (!ctx) return;
    const { editor, start, end } = ctx;

    if (cmd.linePrefix !== undefined) {
      // Remove the trigger text, then swap the line's block prefix.
      editor.replaceRange("", start, end);
      const newLine = applyLinePrefix(editor.getLine(start.line), cmd.linePrefix);
      editor.setLine(start.line, newLine);
      editor.setCursor({ line: start.line, ch: newLine.length });
      return;
    }

    if (cmd.insert) {
      let insert = cmd.insert;
      // "---" directly under a text line would turn that line into a
      // setext heading — keep a blank line between them.
      if (
        cmd.id === "divider" &&
        start.ch === 0 &&
        start.line > 0 &&
        editor.getLine(start.line - 1).trim() !== ""
      ) {
        insert = "\n" + insert;
      }
      const cursorIdx = insert.indexOf("‸");
      const text = insert.replace("‸", "");
      editor.replaceRange(text, start, end);
      if (cursorIdx >= 0) {
        const beforeCursor = text.slice(0, cursorIdx);
        const lines = beforeCursor.split("\n");
        const line = start.line + lines.length - 1;
        const ch =
          lines.length === 1 ? start.ch + lines[0].length : lines[lines.length - 1].length;
        editor.setCursor({ line, ch });
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Plugin                                                              */
/* ------------------------------------------------------------------ */

export default class NotionFlowPlugin extends Plugin {
  settings: NotionFlowSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new NotionFlowSettingTab(this.app, this));

    this.registerEditorSuggest(new SlashSuggest(this));
    this.registerEditorExtension(makeDragHandlePlugin(this));
    this.registerEditorExtension(makeToolbarPlugin(this));
    this.registerEditorExtension(makeNestedIndentPlugin(this));

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
    const blockLen = block.endLine - block.startLine + 1;

    let newStart: number;
    if (dir === -1) {
      const prev = findPrevBlockStart(doc, fences, block);
      if (prev == null) return;
      moveBlock(view, block, prev, fences, undefined, vaultIndentUnit(this.app));
      newStart = prev;
    } else {
      const next = findNextBlock(doc, fences, block);
      if (!next) return;
      const target = next.endLine + 1;
      moveBlock(view, block, target, fences, undefined, vaultIndentUnit(this.app));
      newStart = target - blockLen;
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
    view.dispatch({
      changes: { from: doc.line(block.endLine).to, insert: "\n" + text },
      userEvent: "input.duplicate",
    });
    editor.setCursor({
      line: cur.line + (block.endLine - block.startLine + 1),
      ch: cur.ch,
    });
  }

  onunload() {
    document.body.classList.remove("nf-clean");
    document.body.classList.remove("nf-dragging");
  }

  applyCleanClass() {
    document.body.classList.toggle("nf-clean", this.settings.cleanRendering);
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

class NotionFlowSettingTab extends PluginSettingTab {
  plugin: NotionFlowPlugin;

  constructor(app: App, plugin: NotionFlowPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName(t("Drag-and-drop blocks"))
      .setDesc(t("Show a drag handle in the left margin to reorder paragraphs, headings, lists, quotes, and code blocks."))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.dragHandles).onChange(async (v) => {
          this.plugin.settings.dragHandles = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("Slash commands"))
      .setDesc(t("Type / to insert headings, lists, callouts, tables, and more."))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.slashCommands).onChange(async (v) => {
          this.plugin.settings.slashCommands = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("Floating format toolbar"))
      .setDesc(t("Show a formatting popup when you select text."))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.floatingToolbar).onChange(async (v) => {
          this.plugin.settings.floatingToolbar = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("Paste URLs as links"))
      .setDesc(t("Pasting a URL over selected text turns it into [text](url)."))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.pasteUrlLinks).onChange(async (v) => {
          this.plugin.settings.pasteUrlLinks = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("Cleaner WYSIWYG rendering"))
      .setDesc(t("Softer markdown syntax in Live Preview: rounded bullets, hidden quote markers, styled dividers."))
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.cleanRendering).onChange(async (v) => {
          this.plugin.settings.cleanRendering = v;
          await this.plugin.saveSettings();
        })
      );
  }
}
