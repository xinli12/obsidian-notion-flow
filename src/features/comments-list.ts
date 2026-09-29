import { Keymap, MarkdownView, Notice, SuggestModal, prepareFuzzySearch, type App, type Editor, type Plugin } from "obsidian";
import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { t, tl } from "../i18n";
import { findColorTagPairs } from "../core/inline-tags";
import { decodeCommentAttr } from "../core/comments";
import { chordLabel } from "../core/keys";
import { guardAsync } from "../editor/safe-build";

/* Every comment in a note, as a searchable list: Enter jumps to the
 * commented words, Mod+Enter resolves the comment and keeps the list open
 * for the next one. Comments are otherwise only found by scrolling to
 * their yellow anchors. */

export interface CommentEntry {
  /** 1-based line of the anchor. */
  line: number;
  /** Absolute range of the commented words (between the two tags). */
  from: number;
  to: number;
  /** Absolute range of the whole anchor, tags included. */
  openFrom: number;
  closeTo: number;
  /** The commented words as the reader sees them: tags stripped,
   * whitespace collapsed; "…" when nothing is left. */
  anchorText: string;
  /** The comment itself, decoded (it may hold line breaks). */
  note: string;
}

/** The two things the list needs from the plugin's comment controller. */
export interface CommentsListHost {
  /** Resolve the innermost comment whose anchor, tags included, holds
   * `pos` (the list passes a position inside the open tag). */
  resolve(view: EditorView, pos: number): void;
  /** False hides the command (commenting is off: resolve would be a no-op). */
  enabled?(): boolean;
}

const RE_TAG = /<\/?[A-Za-z][^<>]*>/g;

/** One line of text, for the list rows and the search. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Every well-formed comment anchor, in document order. Comments never
 * span lines (buildCommentWrap refuses a newline), so each line is paired
 * on its own, as the controller's resolve does — the whole-document cache
 * could pair tags across lines on malformed input. */
export function collectComments(doc: Text): CommentEntry[] {
  const entries: CommentEntry[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (!line.text.includes("data-nf-cmt")) continue;
    const pairs = findColorTagPairs(line.text)
      .filter((pair) => pair.comment != null)
      // Pairs come out as their close tags are met (inner first).
      .sort((a, b) => a.open.from - b.open.from);
    for (const pair of pairs) {
      const inner = line.text.slice(pair.open.to, pair.close.from);
      entries.push({
        line: n,
        from: line.from + pair.open.to,
        to: line.from + pair.close.from,
        openFrom: line.from + pair.open.from,
        closeTo: line.from + pair.close.to,
        anchorText: oneLine(inner.replace(RE_TAG, "")) || "…",
        note: decodeCommentAttr(pair.comment ?? ""),
      });
    }
  }
  return entries;
}

/** The same comment in a newer document: same anchor start, same text. */
function refind(doc: Text, entry: CommentEntry): CommentEntry | null {
  return collectComments(doc).find((item) => item.openFrom === entry.openFrom && item.note === entry.note) ?? null;
}

/** Where to point the host's resolve for `entry`: inside its own open tag.
 * Only this pair and the anchors around it hold that spot, and the
 * controller takes the innermost. The commented words' start would not
 * do: an outer anchor's words can open with an inner anchor's tag, and a
 * pair's first character is also the end of the pair before it. */
function resolvePos(entry: CommentEntry): number {
  return entry.openFrom + 1;
}

/** Obsidian's result list; internal, so every field is optional. */
interface Chooser {
  values?: CommentEntry[];
  selectedItem?: number;
  setSelectedItem?(index: number, evt: KeyboardEvent | null): void;
}

export class CommentsListModal extends SuggestModal<CommentEntry> {
  private entries: CommentEntry[];

  constructor(
    app: App,
    private readonly editor: Editor,
    private readonly view: EditorView,
    private readonly host: CommentsListHost,
    entries: CommentEntry[]
  ) {
    super(app);
    // SuggestModal shows its first 100 results; in a heavily annotated
    // note the comments nearest its end would silently never appear.
    this.limit = 0;
    this.entries = entries;
    this.setPlaceholder(t("Search comments"));
    this.setInstructions([
      { command: "↵", purpose: t("Jump to comment") },
      { command: chordLabel(["Mod"], "Enter"), purpose: t("Resolve comment") },
    ]);
    this.emptyStateText = tl({ en: "No matching comments", zh: "没有匹配的批注" });
    this.modalEl?.addClass?.("nf-comments-list");
    // The chooser's own Enter is registered with no modifiers, which does
    // not match Mod+Enter, so this handler is the one that runs.
    this.scope.register(["Mod"], "Enter", (evt) => {
      this.resolveHighlighted(evt);
      return false;
    });
  }

  /** Document order, always: a search narrows the list, never re-sorts it. */
  getSuggestions(query: string): CommentEntry[] {
    const q = query.trim();
    if (!q) return this.entries.slice();
    const match = prepareFuzzySearch(q);
    return this.entries.filter((entry) => match(`${entry.anchorText} ${oneLine(entry.note)}`) != null);
  }

  renderSuggestion(entry: CommentEntry, el: HTMLElement): void {
    // Obsidian's native two-line row, so no styles.css is needed.
    el.addClass("mod-complex");
    const content = el.createDiv({ cls: "suggestion-content" });
    content.createDiv({ cls: "suggestion-title", text: entry.anchorText });
    content.createDiv({ cls: "suggestion-note", text: oneLine(entry.note) });
    const aux = el.createDiv({ cls: "suggestion-aux" });
    aux.createSpan({
      cls: "suggestion-flair",
      text: tl({ en: "Line {n}", zh: "第 {n} 行" }).replace("{n}", String(entry.line)),
    });
  }

  onChooseSuggestion(entry: CommentEntry, evt: MouseEvent | KeyboardEvent): void {
    // Mod+click on a row (and the fallback below) resolves; the modal is
    // already closed then, as it always is after a pick.
    if (Keymap.isModifier(evt, "Mod")) {
      const current = refind(this.view.state.doc, entry);
      if (current) this.host.resolve(this.view, resolvePos(current));
      return;
    }
    const current = refind(this.view.state.doc, entry);
    if (!current) return;
    // The Obsidian Editor API (not EditorView.scrollIntoView) keeps
    // @codemirror/view values out of this module. The new selection also
    // opens a fold that hides the anchor.
    const from = this.editor.offsetToPos(current.from);
    const to = this.editor.offsetToPos(current.to);
    this.editor.setSelection(from, to);
    this.editor.scrollIntoView({ from, to }, true);
    this.editor.focus();
  }

  /** Obsidian keeps it on the instance as `chooser`, so this helper must
   * not be named that. */
  private listChooser(): Chooser | null {
    return (this as unknown as { chooser?: Chooser }).chooser ?? null;
  }

  /** Mod+Enter: resolve the highlighted comment, keep the list open on
   * what is left (closing when nothing is), highlight staying in place. */
  private resolveHighlighted(evt: KeyboardEvent) {
    const chooser = this.listChooser();
    const index = chooser?.selectedItem;
    if (!chooser || !Array.isArray(chooser.values) || typeof index !== "number") {
      // No reachable chooser: pick the row the normal way; Mod is held,
      // so onChooseSuggestion resolves (and the modal closes).
      this.selectActiveSuggestion(evt);
      return;
    }
    const entry = chooser.values[index];
    if (!entry) return;
    const current = refind(this.view.state.doc, entry);
    if (current) this.host.resolve(this.view, resolvePos(current));
    this.entries = collectComments(this.view.state.doc);
    if (this.entries.length === 0) {
      this.close();
      return;
    }
    // SuggestModal re-queries on input, which resets the highlight to 0.
    this.inputEl.dispatchEvent(new Event("input"));
    const count = chooser.values?.length ?? 0;
    if (count > 0) chooser.setSelectedItem?.(Math.min(index, count - 1), null);
  }
}

/** The command "Show comments in this note" (id `show-comments`). It
 * disappears when `host.enabled()` is false — the plugin passes its
 * commenting setting, and with commenting off the controller's resolve
 * does nothing. */
export function registerCommentsList(plugin: Plugin, host: CommentsListHost): void {
  const cmOf = (view: MarkdownView) => (view.editor as unknown as { cm?: EditorView } | undefined)?.cm ?? null;
  const open = guardAsync("comments list", async (view: MarkdownView) => {
    // The editor's state is current even while Reading view shows.
    const cm = cmOf(view);
    if (!cm) return;
    if (collectComments(cm.state.doc).length === 0) {
      new Notice(t("No comments in this note"));
      return;
    }
    // Jumping needs the editor: Reading view switches to Live Preview
    // (Source mode stays Source mode).
    if (view.getMode() === "preview") {
      await view.setState({ ...view.getState(), mode: "source", source: false }, { history: false });
    }
    const fresh = cmOf(view);
    if (!fresh) return;
    const entries = collectComments(fresh.state.doc);
    if (entries.length === 0) return;
    new CommentsListModal(plugin.app, view.editor, fresh, host, entries).open();
  });
  plugin.addCommand({
    id: "show-comments",
    name: t("Show comments in this note"),
    icon: "message-square",
    checkCallback: (checking: boolean) => {
      if (host.enabled?.() === false) return false;
      const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) return false;
      if (!checking) open(view);
      return true;
    },
  });
}
