import {
  EditorSelection, EditorState, Prec, Transaction, type Line, type SelectionRange, type Text, type TransactionSpec,
} from "@codemirror/state";
import { keymap, ViewPlugin, type EditorView, type KeyBinding, type ViewUpdate } from "@codemirror/view";
import { guard } from "./safe-build";

interface Caption {
  bodyFrom: number;
  bodyTo: number;
  kind: "code" | "image" | "table";
  collapsed: boolean;
  /** Quote markers and indentation before the `<small>` tag. */
  prefix?: string;
}

interface CaptionEditingOptions {
  enabled(): boolean;
  livePreview(state: EditorState): boolean;
  captionAt(doc: Text, lineNo: number): Caption | null;
}

type CaptionLookup = Pick<CaptionEditingOptions, "captionAt">;

/** Every caption row carries this class, so a line without it cannot be a
 * caption: checking it first keeps the fence scan behind `captionAt` off
 * the ordinary keystroke path. */
const MARK = "nf-caption";

/** Lines that render as a widget (a fence opener, a table row, an embed):
 * ArrowDown leaves those to the default motion. */
const WIDGET_LINE = /^[ \t>]*(?:`{3,}|~{3,}|\||!\[)/;

export interface CaptionHit {
  line: Line;
  caption: Caption;
  /** The row's structural prefix, carried onto the row Enter opens. */
  prefix: string;
  /** Document positions of the caption text. */
  from: number;
  to: number;
}

/** The caption whose text `range` lies wholly inside, or null. */
function captionBody(state: EditorState, options: CaptionLookup, range: SelectionRange): CaptionHit | null {
  const line = state.doc.lineAt(range.from);
  if (range.to > line.to || !line.text.includes(MARK)) return null;
  const caption = options.captionAt(state.doc, line.number);
  if (!caption) return null;
  const from = line.from + caption.bodyFrom;
  const to = line.from + caption.bodyTo;
  if (range.from < from || range.to > to) return null;
  const prefix = caption.prefix ?? line.text.slice(0, Math.max(0, line.text.lastIndexOf("<small", caption.bodyFrom)));
  return { line, caption, prefix, from, to };
}

/** The caption under the one selection range, or null. */
export function captionUnder(state: EditorState, options: CaptionLookup): CaptionHit | null {
  return state.selection.ranges.length === 1 ? captionBody(state, options, state.selection.main) : null;
}

/** With several cursors no key splits or strips a caption: when `test`
 * matches any range, the key is swallowed (`true`); otherwise the default
 * runs (`null`). */
function multiRange(
  state: EditorState, options: CaptionLookup, test: (range: SelectionRange, hit: CaptionHit) => boolean
): true | null {
  return state.selection.ranges.some((range) => {
    const hit = captionBody(state, options, range);
    return !!hit && test(range, hit);
  }) ? true : null;
}

/** Enter (and Shift+Enter) in a caption leaves it: the row stays as it is
 * and the caret goes to the blank row below in the same container, which
 * is reused when present and inserted otherwise. */
export function captionExitPlan(state: EditorState, options: CaptionLookup): TransactionSpec | true | null {
  if (state.selection.ranges.length > 1) return multiRange(state, options, () => true);
  const hit = captionUnder(state, options);
  if (!hit) return null;
  const { line, prefix } = hit;
  if (line.number < state.doc.lines) {
    const next = state.doc.line(line.number + 1);
    if (next.text.trim() === prefix.trim()) {
      const anchor = next.from + prefix.length;
      return next.text === prefix
        ? { selection: { anchor }, scrollIntoView: true, userEvent: "select" }
        : { changes: { from: next.from, to: next.to, insert: prefix }, selection: { anchor }, scrollIntoView: true, userEvent: "input" };
    }
  }
  // "input", not "input.type": typing rules must not see this newline.
  return {
    changes: { from: line.to, insert: "\n" + prefix },
    selection: { anchor: line.to + 1 + prefix.length },
    scrollIntoView: true,
    userEvent: "input",
  };
}

/** Backspace at the start of a caption: an empty one is removed (the
 * caret returns to the end of its block), a written one stays put. The
 * default would delete the hidden opening tag in one step. */
export function captionBackspacePlan(state: EditorState, options: CaptionLookup): TransactionSpec | true | null {
  if (state.selection.ranges.length > 1) {
    return multiRange(state, options, (range, hit) => range.empty && range.head === hit.from);
  }
  const hit = captionUnder(state, options);
  const range = state.selection.main;
  if (!hit || !range.empty || range.head !== hit.from) return null;
  const { caption, line } = hit;
  // A collapsed code block keeps its fold state on this row.
  if (caption.bodyTo > caption.bodyFrom || (caption.kind === "code" && caption.collapsed)) return true;
  const previous = state.doc.line(line.number - 1);
  // A table's last row is a cell editor: a caret at its end makes Obsidian
  // focus that cell and re-pad the table source ("| 1 | 2 |" becomes
  // "| 1   | 2   |"), so cancelling would not leave the note as it was.
  // Land at the text start of the line after the table instead.
  let anchor = previous.to;
  if (caption.kind === "table" && line.number < state.doc.lines) {
    const next = state.doc.line(line.number + 1);
    anchor = previous.to + 1 + (next.text.match(/^[ \t]*(?:>[ \t]?)*[ \t]*/)?.[0].length ?? 0);
  }
  return {
    changes: { from: previous.to, to: line.to },
    selection: { anchor },
    scrollIntoView: true,
    userEvent: "delete.block-caption",
  };
}

/** Delete at the end of a caption does nothing: the default would remove
 * the hidden closing tag. */
export function captionDeletePlan(state: EditorState, options: CaptionLookup): true | null {
  if (state.selection.ranges.length > 1) {
    return multiRange(state, options, (range, hit) => range.empty && range.head === hit.to);
  }
  const hit = captionUnder(state, options);
  const range = state.selection.main;
  return hit && range.empty && range.head === hit.to ? true : null;
}

/** ArrowDown at the end of a caption goes to the start of the next line's
 * text; lines drawn as widgets keep the default motion. */
export function captionArrowDownPlan(state: EditorState, options: CaptionLookup): TransactionSpec | null {
  const hit = captionUnder(state, options);
  const range = state.selection.main;
  if (!hit || !range.empty || range.head !== hit.to || hit.line.number >= state.doc.lines) return null;
  const next = state.doc.line(hit.line.number + 1);
  if (WIDGET_LINE.test(next.text)) return null;
  const anchor = next.from + (next.text.match(/^[ \t]*(?:>[ \t]?)*[ \t]*/)?.[0].length ?? 0);
  return { selection: { anchor }, scrollIntoView: true, userEvent: "select" };
}

/**
 * A word or line deletion on a caption row, clamped to the caption text.
 * The tags are hidden atomic ranges, so Alt/Mod+Backspace at the text's
 * start and Alt/Mod+Delete at its end would take a whole `<small …>` or
 * `</small>` and leave raw markup behind. Each deleted range is taken on
 * its own, so a second cursor elsewhere changes nothing: one confined to
 * an owned caption row keeps only its part inside `[bodyFrom, bodyTo]`,
 * or stays whole when it covers the row's whole markup (a cut of the full
 * row: nothing half-written stays); any other range passes unchanged.
 * Null when the transaction is not such a deletion or no range was
 * clamped; otherwise the kept deletions (possibly none) in start-state
 * positions.
 */
export function clampCaptionDeletion(
  tr: Transaction,
  options: CaptionLookup
): { from: number; to: number }[] | null {
  if (!tr.docChanged || !tr.isUserEvent("delete") || tr.isUserEvent("delete.block-caption")) return null;
  if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) return null;
  const doc = tr.startState.doc;
  const deleted: { from: number; to: number }[] = [];
  let inserts = false;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (inserted.length) inserts = true;
    deleted.push({ from: fromA, to: toA });
  });
  if (inserts || !deleted.length) return null;
  let changed = false;
  const kept: { from: number; to: number }[] = [];
  for (const d of deleted) {
    const line = doc.lineAt(d.from);
    const caption = d.to <= line.to && line.text.includes(MARK) ? options.captionAt(doc, line.number) : null;
    if (!caption) {
      kept.push(d);
      continue;
    }
    const bodyFrom = line.from + caption.bodyFrom;
    const bodyTo = line.from + caption.bodyTo;
    const markupFrom = line.from + Math.max(0, line.text.lastIndexOf("<small", caption.bodyFrom));
    const markupTo = bodyTo + "</small>".length;
    if (d.from <= markupFrom && d.to >= markupTo) {
      kept.push(d);
      continue;
    }
    const from = Math.max(d.from, bodyFrom);
    const to = Math.min(d.to, bodyTo);
    if (from !== d.from || to !== d.to) changed = true;
    if (to > from) kept.push({ from, to });
  }
  return changed ? kept : null;
}

/**
 * A deletion that would join a caption row with its neighbour: Backspace at
 * the start of the row after a caption (the newline, perhaps with that
 * row's own markers, goes and its text lands after `</small>`), or Delete
 * at the end of the caption's owner row (the image, table or fence closer
 * runs into the `<small …>`). Either way the row stops being a caption and
 * its markup shows. Returns where the caret goes instead — the caption's
 * text end, or where it was — with nothing deleted; null for any other
 * transaction. Joining a blank row is fine (trailing whitespace keeps the
 * row a caption), and a deletion of whole rows up to the caption leaves it
 * at a line start, so neither is stopped. Only a deletion made at the
 * caret (Backspace, Alt/Mod+Backspace, Delete…) is a keystroke to stop; a
 * programmatic edit elsewhere is left to its caller.
 */
export function captionJoinGuard(tr: Transaction, options: CaptionLookup): { anchor: number } | null {
  if (!tr.docChanged || !tr.isUserEvent("delete") || tr.isUserEvent("delete.block-caption")) return null;
  if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) return null;
  const doc = tr.startState.doc;
  const deleted: { from: number; to: number }[] = [];
  let inserts = false;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (inserted.length) inserts = true;
    deleted.push({ from: fromA, to: toA });
  });
  if (inserts || deleted.length !== 1) return null;
  const { from, to } = deleted[0];
  const first = doc.lineAt(from);
  const last = doc.lineAt(to);
  if (first.number === last.number) return null;
  const caret = tr.startState.selection;
  if (caret.ranges.length !== 1 || !caret.main.empty) return null;
  // Backspace at the next row's start: the caption row loses its end.
  if (caret.main.head === to && from === first.to && first.text.includes(MARK)) {
    const caption = options.captionAt(doc, first.number);
    if (caption && /\S/.test(doc.sliceString(to, last.to))) return { anchor: first.from + caption.bodyTo };
  }
  // Delete at the owner row's end: the caption row loses its start.
  if (caret.main.head === from && to === last.from && from > first.from && last.text.includes(MARK) && options.captionAt(doc, last.number)) {
    return { anchor: from };
  }
  return null;
}

/** An editor suggestion popup (the `[[` link suggester, the slash menu)
 * owns Enter and ArrowDown while it is open. */
function suggestionOpen(view: EditorView): boolean {
  return !!(view as { dom?: HTMLElement }).dom?.ownerDocument?.querySelector?.(".suggestion-container");
}

/** Keep caption edits scoped to owned captions in Live Preview. Deferred
 * cleanup is valid only for the exact state that scheduled it. */
export function createCaptionEditingExtensions(options: CaptionEditingOptions) {
  const active = (state: EditorState) => options.enabled() && options.livePreview(state);
  const caretFilter = EditorState.transactionFilter.of((tr) => guard("caption caret", () => tr, () => {
    if (!tr.selection || !active(tr.state)) return tr;
    // Source-mode switches and history restoration must preserve their selection.
    if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) return tr;
    let moved = false;
    const ranges = tr.selection.ranges.map((range) => {
      if (!range.empty) {
        const clamped = clampCaptionRange(tr.newDoc, range);
        if (clamped !== range) moved = true;
        return clamped;
      }
      const line = tr.newDoc.lineAt(range.head);
      if (!line.text.includes(MARK)) return range;
      const caption = options.captionAt(tr.newDoc, line.number);
      if (!caption) return range;
      const head = Math.max(line.from + caption.bodyFrom,
        Math.min(line.from + caption.bodyTo, range.head));
      if (head === range.head) return range;
      moved = true;
      return EditorSelection.cursor(head);
    });
    return moved ? [tr, { selection: EditorSelection.create(ranges, tr.selection.mainIndex) }] : tr;
  }));
  /** A selection on one caption row keeps to the caption's text, both ends,
   *  in its direction: a Shift+Arrow past the text's start or end, or a
   *  second Shift+Home, would otherwise take a hidden tag, and typing,
   *  pasting, an IME commit or a cut over it then breaks the row. A range
   *  covering the row's whole markup (a cut of the full row) is left as it
   *  is, as clampCaptionDeletion does. */
  function clampCaptionRange(doc: Text, range: SelectionRange): SelectionRange {
    const line = doc.lineAt(range.from);
    if (range.to > line.to || !line.text.includes(MARK)) return range;
    const caption = options.captionAt(doc, line.number);
    if (!caption) return range;
    const bodyFrom = line.from + caption.bodyFrom;
    const bodyTo = line.from + caption.bodyTo;
    const markupFrom = line.from + Math.max(0, line.text.lastIndexOf("<small", caption.bodyFrom));
    const markupTo = bodyTo + "</small>".length;
    if (range.from <= markupFrom && range.to >= markupTo) return range;
    const clamp = (pos: number) => Math.max(bodyFrom, Math.min(bodyTo, pos));
    const anchor = clamp(range.anchor);
    const head = clamp(range.head);
    if (anchor === range.anchor && head === range.head) return range;
    return EditorSelection.range(anchor, head, range.goalColumn);
  }

  const cleanup = ViewPlugin.fromClass(class {
    private disposed = false;

    update(update: ViewUpdate) {
      if ((!update.selectionSet && !update.docChanged) || !active(update.state) || !active(update.startState)) return;
      if (update.transactions.some((tr) => tr.isUserEvent("undo") || tr.isUserEvent("redo"))) return;
      const state = update.state;
      const doc = state.doc;
      const changes: { from: number; to: number }[] = [];
      const seen = new Set<number>();
      for (const range of update.startState.selection.ranges) {
        const line = doc.lineAt(update.changes.mapPos(range.head, 1));
        if (seen.has(line.number)) continue;
        seen.add(line.number);
        if (!line.text.includes(MARK)) continue;
        if (state.selection.ranges.some((sel) => sel.from <= line.to && sel.to >= line.from)) continue;
        const caption = options.captionAt(doc, line.number);
        if (!caption || caption.bodyTo > caption.bodyFrom || (caption.kind === "code" && caption.collapsed)) continue;
        changes.push({ from: doc.line(line.number - 1).to, to: line.to });
      }
      if (!changes.length) return;
      changes.sort((a, b) => a.from - b.from);
      Promise.resolve().then(() => {
        if (this.disposed || update.view.state !== state || !active(state)) return;
        update.view.dispatch({
          changes,
          annotations: Transaction.addToHistory.of(false),
          userEvent: "delete.block-caption",
        });
      });
    }

    destroy() { this.disposed = true; }
  });

  /* The caption's two tags are hidden atomic ranges while the caret is on
   * the row, so the default Enter would split the row between them and
   * Backspace/Delete would swallow a whole tag. These run before Obsidian's
   * list/quote Enter and, registered first, before the plugin's own
   * Prec.high table/quote/code keymaps. */
  const bind = (plan: (state: EditorState, options: CaptionLookup) => TransactionSpec | true | null, yieldToPopup = false) =>
    (view: EditorView): boolean => guard("caption keys", () => false, () => {
      if (view.composing || !active(view.state)) return false;
      if (yieldToPopup && suggestionOpen(view)) return false;
      const spec = plan(view.state, options);
      if (!spec) return false;
      if (spec !== true) view.dispatch(spec);
      return true;
    });
  const enter = bind(captionExitPlan, true);
  const keys: KeyBinding[] = [
    { key: "Enter", run: enter, shift: enter },
    { key: "Backspace", run: bind(captionBackspacePlan) },
    { key: "Delete", run: bind(captionDeletePlan) },
    { key: "ArrowDown", run: bind(captionArrowDownPlan, true) },
  ];

  /* Word and line deletions (Alt/Mod+Backspace, Alt/Mod+Delete) come from
   * CodeMirror's own commands, which extend a deletion over a whole hidden
   * tag. Rather than rebinding every chord per platform, the deletion
   * itself is clamped to the caption text. */
  const deleteClamp = EditorState.transactionFilter.of((tr) => guard("caption delete", () => tr, () => {
    if (!active(tr.startState)) return tr;
    const join = captionJoinGuard(tr, options);
    if (join) {
      return { selection: EditorSelection.cursor(join.anchor), scrollIntoView: tr.scrollIntoView, userEvent: tr.annotation(Transaction.userEvent) };
    }
    const kept = clampCaptionDeletion(tr, options);
    if (!kept) return tr;
    const start = tr.startState.selection;
    if (!kept.length) return { selection: start, userEvent: tr.annotation(Transaction.userEvent) };
    const changes = tr.startState.changes(kept);
    return {
      changes,
      selection: EditorSelection.create(
        start.ranges.map((range) => EditorSelection.cursor(changes.mapPos(range.from, -1))),
        start.mainIndex
      ),
      effects: tr.effects,
      scrollIntoView: tr.scrollIntoView,
      userEvent: tr.annotation(Transaction.userEvent),
    };
  }));
  return [caretFilter, cleanup, Prec.high(keymap.of(keys)), deleteClamp];
}
