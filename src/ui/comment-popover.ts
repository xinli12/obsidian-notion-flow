import { setIcon } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { t } from "../i18n";
import { placePopover, popoverArea, type PopoverBox } from "./link-popover";

/** The longest run of the commented text the card quotes above the note. */
const QUOTE_LIMIT = 80;

/** The commented words, cut to one readable line for the card's quote. */
export function commentQuote(text: string, limit = QUOTE_LIMIT): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? flat.slice(0, limit - 1).trimEnd() + "…" : flat;
}

/** Notion-style inline comment editor: a small floating card anchored to
 * the commented text instead of a full-screen modal, so writing a note
 * never leaves the page. Enter saves (IME composition is respected, so
 * confirming Chinese input never submits), Shift+Enter breaks the line,
 * Esc cancels, and clicking elsewhere saves any change and closes. */
export class CommentPopover {
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
    private onResolve: (() => void) | null,
    private lifecycle: {
      isCurrent(): boolean;
      onClose(): void;
      quote?: string;
      /** The pane to stay inside; defaults to the editor's `.view-content`. */
      bounds?: () => PopoverBox | null | undefined;
    }
  ) {
    this.initial = initial ?? "";
    this.doc = view.dom.ownerDocument;
    this.win = this.doc.defaultView ?? window;
  }

  open() {
    if (!this.lifecycle.isCurrent()) { this.close(); return; }
    activeCommentPopover?.close();
    activeCommentPopover = this;
    const el = (this.el = this.doc.body.createDiv({ cls: "nf-cmt-pop" }));
    el.setAttribute("aria-label", t("Comment"));
    // The words the note belongs to, so an edit never has to look back
    // at the page to remember what it was about.
    const quote = commentQuote(this.lifecycle.quote ?? "");
    if (quote) el.createDiv({ cls: "nf-cmt-pop-quote", text: quote });
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
    footer.createSpan({ cls: "nf-cmt-hint", text: t("↵ Save · ⇧↵ New line") });
    const actions = footer.createDiv({ cls: "nf-cmt-pop-actions" });
    if (this.onResolve) {
      const resolve = this.onResolve;
      // Resolving is the ordinary way a comment ends, not a destructive
      // act: a quiet check icon, named by its tooltip, which also keeps
      // the footer (hint + actions) on one line.
      const btn = actions.createEl("button", {
        cls: "clickable-icon nf-cmt-pop-resolve",
        attr: { "aria-label": t("Resolve"), "data-tooltip-position": "top", type: "button" },
      });
      setIcon(btn, "check");
      btn.addEventListener("click", () => {
        const valid = this.lifecycle.isCurrent();
        this.close();
        if (valid) resolve();
      });
    }
    const cancel = actions.createEl("button", { cls: "nf-cmt-pop-cancel", text: t("Cancel") });
    cancel.addEventListener("click", () => {
      this.close();
      this.view.focus();
    });
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
    const valid = this.lifecycle.isCurrent();
    this.close();
    if (valid && text && text !== this.initial.trim()) this.onSave(text);
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
    const size = { w: el.offsetWidth, h: el.offsetHeight };
    const viewport = { w: this.win.innerWidth, h: this.win.innerHeight };
    // Stay in the note's pane: a split below, the tab bar or a sidebar
    // is never covered. Nested (table cell, column) editors sit inside the
    // note's .view-content; hover previews have none and use the window.
    const pane = this.view.dom.closest?.(".view-content") as HTMLElement | null | undefined;
    const box = this.lifecycle.bounds?.() ?? pane?.getBoundingClientRect() ?? null;
    let left: number;
    let top: number;
    let below = true;
    if (coords) {
      ({ left, top, below } = placePopover(coords, size, viewport, box));
    } else {
      const rect = this.view.dom.getBoundingClientRect();
      const area = popoverArea(size, viewport, box);
      left = Math.min(Math.max(area.left, rect.left + 24), area.right - size.w);
      top = Math.max(area.top, Math.min(area.bottom - size.h, rect.top + 48));
    }
    // styles.css picks the entrance keyframe from this; it is set before
    // the first visible frame so the animation never restarts mid-flight.
    el.setAttribute("data-placement", below ? "below" : "above");
    el.style.left = left + "px";
    el.style.top = top + "px";
  }

  private submit() {
    const text = (this.input?.value ?? "").trim();
    const valid = this.lifecycle.isCurrent();
    this.close();
    if (valid && text) this.onSave(text);
  }

  close() {
    this.lifecycle.onClose();
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

/** Whether a comment editor is open anywhere — hover cards stay away. */
export function isCommentPopoverOpen(): boolean {
  return activeCommentPopover != null;
}

