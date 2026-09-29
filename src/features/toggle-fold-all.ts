import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Platform } from "obsidian";
import type { Editor, Hotkey, Plugin } from "obsidian";
import { t } from "../i18n";

/**
 * Collapse or expand every toggle and foldable Callout in a note at once
 * (Notion's ⌘⌥T). Only the `+`/`-` fold markers change, in one transaction,
 * so a single undo restores the note and titles are never rewritten.
 */

export type ToggleFoldMode = "collapse" | "expand" | "toggle";

export interface FoldTarget {
  /** 1-based line of the header. */
  line: number;
  kind: "toggle" | "callout";
  /** Lower-case callout type. */
  type: string;
  marker: "" | "+" | "-";
  collapsed: boolean;
  /** Absolute doc offset just after the header's `]`. */
  markerFrom: number;
  markerTo: number;
}

export interface ToggleFoldOptions {
  /** Default true; false treats `nf-toggle` like any Callout (it then needs a marker). */
  toggles?: boolean;
  /** Default true; false leaves foldable Callouts alone. */
  callouts?: boolean;
  /** The host's exact code-fence test (1-based lines); replaces the built-in fence scan. */
  skipLine?: (lineNo: number) => boolean;
}

export const TOGGLE_FOLD_USER_EVENT = "input.toggle-all";
/** macOS only: Ctrl+Alt is AltGr on European layouts, so no default elsewhere. */
export const TOGGLE_ALL_HOTKEY: Hotkey = { modifiers: ["Mod", "Alt"], key: "T" };

const TOGGLE_TYPE = "nf-toggle";
/** Column containers are structural and never fold. */
const STRUCTURAL_TYPES = new Set(["nf-cols", "nf-col"]);
/** Same header shape as main.ts's `RE_CALLOUT_HEAD`: prefix, type, metadata + `]`, fold marker. */
const RE_HEAD = /^(\s*(?:>[ \t]*)+\[!)([^\]|\r\n]+)([^\]\r\n]*\])([+-]?)/;
const RE_QUOTE_PREFIX = /^[ \t]*(?:>[ \t]?)*/;
const RE_FENCE_OPEN = /^(`{3,}|~{3,})(.*)$/;
/** A fence may open on a list-marker line ("1. ```bash"). */
const RE_LIST_MARKER = /^(?:[-*+]|\d{1,9}[.)])[ \t]+/;

function quoteDepth(text: string): number {
  return (text.match(RE_QUOTE_PREFIX)![0].match(/>/g) ?? []).length;
}

/**
 * Lines that cannot hold a header: YAML frontmatter and fenced code (quoted
 * fences included; a quoted fence ends with its quote, an unclosed one runs
 * to the end of the note). `skipLine` stands in for the fence scan.
 */
function skippedLines(doc: Text, skipLine?: (lineNo: number) => boolean): (lineNo: number) => boolean {
  let frontmatterEnd = 0;
  if (doc.lines > 1 && doc.line(1).text === "---") {
    for (let n = 2; n <= doc.lines; n++) {
      if (/^(?:---|\.\.\.)[ \t]*$/.test(doc.line(n).text)) { frontmatterEnd = n; break; }
    }
  }
  if (skipLine) return (n) => n <= frontmatterEnd || skipLine(n);
  const fenced = new Set<number>();
  let fence: { ch: string; len: number; depth: number } | null = null;
  for (let n = frontmatterEnd + 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    const depth = quoteDepth(text);
    const content = text.replace(RE_QUOTE_PREFIX, "").replace(/^[ \t]*/, "");
    if (fence) {
      if (depth < fence.depth) {
        fence = null;
      } else {
        fenced.add(n);
        const close = content.match(/^(`{3,}|~{3,})[ \t]*$/);
        if (close && close[1][0] === fence.ch && close[1].length >= fence.len) fence = null;
        continue;
      }
    }
    const open = content.replace(RE_LIST_MARKER, "").match(RE_FENCE_OPEN);
    // Backtick info strings cannot themselves contain a backtick.
    if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
      fence = { ch: open[1][0], len: open[1].length, depth };
      fenced.add(n);
    }
  }
  return (n) => n <= frontmatterEnd || fenced.has(n);
}

/**
 * Every header Obsidian renders as a foldable block: `[!nf-toggle]` with or
 * without a marker (none = open) and any other Callout that has a `+`/`-`
 * marker. A header must open its blockquote (the line above is quoted less
 * deeply), as in Obsidian; `nf-cols` / `nf-col` are never targets.
 */
export function findFoldTargets(doc: Text, options: ToggleFoldOptions = {}): FoldTarget[] {
  const toggles = options.toggles !== false;
  const callouts = options.callouts !== false;
  const skip = skippedLines(doc, options.skipLine);
  const targets: FoldTarget[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    if (skip(n)) continue;
    const line = doc.line(n);
    const m = line.text.match(RE_HEAD);
    if (!m) continue;
    const depth = quoteDepth(line.text);
    if (n > 1 && quoteDepth(doc.line(n - 1).text) >= depth) continue;
    const type = m[2].trim().toLowerCase();
    if (STRUCTURAL_TYPES.has(type)) continue;
    const marker = m[4] as FoldTarget["marker"];
    const kind = type === TOGGLE_TYPE && toggles ? "toggle" : "callout";
    if (kind === "callout" && (!callouts || !marker)) continue;
    const markerFrom = line.from + m[1].length + m[2].length + m[3].length;
    targets.push({
      line: n, kind, type, marker, collapsed: marker === "-", markerFrom, markerTo: markerFrom + marker.length,
    });
  }
  return targets;
}

/** `toggle` collapses everything while anything is open, otherwise expands. */
export function resolveToggleFoldMode(targets: readonly FoldTarget[], mode: ToggleFoldMode): "collapse" | "expand" {
  if (mode !== "toggle") return mode;
  return targets.some((target) => !target.collapsed) ? "collapse" : "expand";
}

/**
 * Marker edits (ascending, non-overlapping; [] = nothing to do). Collapse
 * writes `-` everywhere, so fold-less toggles gain one; expand turns `-`
 * into `+` and leaves fold-less toggles alone (a `+` there would be an
 * invisible edit that only dirties the file and the undo stack).
 */
export function planToggleFold(
  doc: Text, mode: ToggleFoldMode, options?: ToggleFoldOptions
): { from: number; to: number; insert: string }[] {
  const targets = findFoldTargets(doc, options);
  const collapse = resolveToggleFoldMode(targets, mode) === "collapse";
  const changes: { from: number; to: number; insert: string }[] = [];
  for (const target of targets) {
    if (collapse ? target.marker === "-" : target.marker !== "-") continue;
    changes.push({ from: target.markerFrom, to: target.markerTo, insert: collapse ? "-" : "+" });
  }
  return changes;
}

/** One dispatch (one undo step); the selection maps through the marker edits. */
export function runToggleFold(view: EditorView, mode: ToggleFoldMode, options?: ToggleFoldOptions): boolean {
  const changes = planToggleFold(view.state.doc, mode, options);
  if (!changes.length) return false;
  view.dispatch({ changes, userEvent: TOGGLE_FOLD_USER_EVENT });
  return true;
}

export interface ToggleFoldHost {
  /** The view the fold acts on (a focused column editor's own view, else the note's). */
  view(editor: Editor): EditorView | null;
  options?(view: EditorView): ToggleFoldOptions;
}

/**
 * "Collapse all toggles", "Expand all toggles" and "Collapse or expand all
 * toggles" (⌘⌥T on macOS). Each is offered only when the note has a target,
 * so the default hotkey falls through untouched everywhere else.
 */
export function registerToggleFoldCommands(plugin: Pick<Plugin, "addCommand">, host: ToggleFoldHost): void {
  const commands: { id: string; name: string; icon: string; mode: ToggleFoldMode; hotkey?: Hotkey }[] = [
    { id: "collapse-all-toggles", name: t("Collapse all toggles"), icon: "chevrons-down-up", mode: "collapse" },
    { id: "expand-all-toggles", name: t("Expand all toggles"), icon: "chevrons-up-down", mode: "expand" },
    {
      id: "toggle-all-toggles", name: t("Collapse or expand all toggles"), icon: "fold-vertical", mode: "toggle",
      hotkey: Platform.isMacOS ? TOGGLE_ALL_HOTKEY : undefined,
    },
  ];
  for (const { id, name, icon, mode, hotkey } of commands) {
    plugin.addCommand({
      id, name, icon,
      ...(hotkey ? { hotkeys: [{ modifiers: [...hotkey.modifiers], key: hotkey.key }] } : {}),
      editorCheckCallback: (checking: boolean, editor: Editor) => {
        const view = host.view(editor);
        if (!view) return false;
        const options = host.options?.(view);
        if (!findFoldTargets(view.state.doc, options).length) return false;
        if (!checking) runToggleFold(view, mode, options);
        return true;
      },
    });
  }
}
