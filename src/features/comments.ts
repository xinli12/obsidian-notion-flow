import { Notice, setIcon } from "obsidian";
import { WidgetType, type EditorView } from "@codemirror/view";
import { t } from "../i18n";
import { findColorTagPairs } from "../core/inline-tags";
import { encodeCommentAttr, decodeCommentAttr, buildCommentWrap } from "../core/comments";
import { CommentPopover, isCommentPopoverOpen } from "../ui/comment-popover";
import { EditorOperationScope } from "../editor/operation-scope";

interface CommentOptions {
  operations: EditorOperationScope;
  enabled(): boolean;
  /** Hovering commented text shows the card (else a plain tooltip). */
  hoverCard?(): boolean;
  identity(view: EditorView): string;
}

/** Commented text as the editor renders it: the plugin's own mark on an
 * active line, or Obsidian's inline-HTML widget of the raw span. */
export const COMMENT_HOVER_SELECTOR = ".nf-cmt-anchor, span.nf-cmt[data-nf-cmt]";

/** How long the pointer rests on commented text before the card opens,
 * and how long it may wander between the text and the card. */
export const COMMENT_HOVER_DELAY = 150;

/** A located comment: absolute tag ranges plus a check that they still
 * read the same, so a save or resolve never lands on edited text. */
interface LocatedComment {
  open: { from: number; to: number };
  close: { from: number; to: number };
  note: string;
  intact(): boolean;
}

/** Locate the comment pair whose anchor contains `pos` (tags included). */
function locateComment(view: EditorView, pos: number): LocatedComment | null {
  const doc = view.state.doc;
  if (pos < 0 || pos > doc.length) return null;
  const line = doc.lineAt(pos);
  const rel = pos - line.from;
  const pair = findColorTagPairs(line.text).find(
    (p) => p.comment != null && rel >= p.open.from && rel <= p.close.to
  );
  if (!pair) return null;
  const openText = line.text.slice(pair.open.from, pair.open.to);
  const closeText = line.text.slice(pair.close.from, pair.close.to);
  const open = { from: line.from + pair.open.from, to: line.from + pair.open.to };
  const close = { from: line.from + pair.close.from, to: line.from + pair.close.to };
  return {
    open,
    close,
    note: decodeCommentAttr(pair.comment ?? ""),
    intact: () =>
      view.state.doc.sliceString(open.from, Math.min(open.to, view.state.doc.length)) ===
        openText &&
      view.state.doc.sliceString(close.from, Math.min(close.to, view.state.doc.length)) ===
        closeText,
  };
}

/** What the hover card shows and offers for one anchor. */
interface HoverCardContent {
  note: string;
  onEdit?: () => void;
  onResolve?: () => void;
}

/**
 * The card that appears over commented text: the note, and in Live
 * Preview an Edit and a Resolve button. One per document, shared by every
 * editor in it; it never takes the pointer's click away from the text.
 */
export class CommentHoverCard {
  private el: HTMLElement | null = null;
  private anchor: HTMLElement | null = null;
  private openTimer: number | null = null;
  private closeTimer: number | null = null;
  private readonly win: Window;

  constructor(private readonly doc: Document) {
    this.win = doc.defaultView ?? window;
  }

  /** The pointer arrived on `anchor`: open after a pause (or keep an open
   * card for the same anchor). `content` is read only when it opens. */
  hover(anchor: HTMLElement, content: () => HoverCardContent | null, delay = COMMENT_HOVER_DELAY) {
    this.cancelClose();
    if (this.anchor === anchor && this.el) return;
    this.cancelOpen();
    this.openTimer = this.win.setTimeout(() => {
      this.openTimer = null;
      if (!anchor.isConnected || isCommentPopoverOpen()) return;
      const shown = content();
      if (shown) this.open(anchor, shown);
    }, delay);
  }

  /** The pointer left `anchor` for `to`: close unless it went to the card. */
  leave(anchor: HTMLElement, to: EventTarget | null) {
    const node = to instanceof Node ? to : null;
    if (node && (anchor.contains(node) || this.el?.contains(node))) return;
    this.cancelOpen();
    if (this.anchor === anchor) this.scheduleClose();
  }

  open(anchor: HTMLElement, content: HoverCardContent) {
    this.close();
    this.anchor = anchor;
    const el = (this.el = this.doc.body.createDiv({ cls: "nf-cmt-card nf-pop" }));
    el.setAttribute("aria-label", t("Comment"));
    const note = el.createDiv({ cls: "nf-cmt-card-note", text: content.note });
    note.style.whiteSpace = "pre-wrap";
    if (content.onEdit || content.onResolve) {
      const actions = el.createDiv({ cls: "nf-cmt-card-actions" });
      const button = (cls: string, icon: string, label: string, run: () => void) => {
        const btn = actions.createEl("button", { cls, attr: { type: "button" } });
        setIcon(btn, icon);
        btn.createSpan({ text: label });
        btn.addEventListener("mousedown", (evt) => evt.preventDefault());
        btn.addEventListener("click", (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          this.close();
          run();
        });
      };
      if (content.onEdit) button("nf-cmt-card-edit", "pencil", t("Edit"), content.onEdit);
      if (content.onResolve) {
        button("nf-cmt-card-resolve", "check", t("Resolve"), content.onResolve);
      }
    }
    el.addEventListener("mouseenter", this.cancelClose);
    el.addEventListener("mouseleave", () => this.scheduleClose());
    this.doc.addEventListener("mousedown", this.onDocMouseDown, true);
    this.doc.addEventListener("keydown", this.onKeyDown, true);
    this.doc.addEventListener("scroll", this.onScroll, true);
    this.position();
  }

  isOpen(): boolean {
    return this.el != null;
  }

  close() {
    this.cancelOpen();
    this.cancelClose();
    if (!this.el) return;
    this.doc.removeEventListener("mousedown", this.onDocMouseDown, true);
    this.doc.removeEventListener("keydown", this.onKeyDown, true);
    this.doc.removeEventListener("scroll", this.onScroll, true);
    this.el.remove();
    this.el = null;
    this.anchor = null;
  }

  private scheduleClose(delay = COMMENT_HOVER_DELAY) {
    this.cancelClose();
    this.closeTimer = this.win.setTimeout(() => {
      this.closeTimer = null;
      this.close();
    }, delay);
  }

  private cancelClose = () => {
    if (this.closeTimer != null) this.win.clearTimeout(this.closeTimer);
    this.closeTimer = null;
  };

  private cancelOpen() {
    if (this.openTimer != null) this.win.clearTimeout(this.openTimer);
    this.openTimer = null;
  }

  private onDocMouseDown = (evt: MouseEvent) => {
    if (this.el && evt.composedPath().includes(this.el)) return;
    this.close();
  };

  private onKeyDown = (evt: KeyboardEvent) => {
    if (evt.key === "Escape") this.close();
  };

  private onScroll = (evt: Event) => {
    if (this.el && evt.target instanceof Node && this.el.contains(evt.target)) return;
    this.close();
  };

  private position() {
    const el = this.el;
    const anchor = this.anchor;
    if (!el || !anchor) return;
    const rects = anchor.getClientRects();
    const rect = rects.length ? rects[rects.length - 1] : anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = this.win.innerWidth;
    const vh = this.win.innerHeight;
    let left = Math.min(Math.max(8, rect.left), vw - w - 8);
    let top = rect.bottom + 6;
    let below = true;
    if (top + h > vh - 8) {
      top = Math.max(8, rect.top - h - 6);
      below = false;
    }
    left = Math.max(8, left);
    el.setAttribute("data-placement", below ? "below" : "above");
    el.style.left = left + "px";
    el.style.top = top + "px";
  }
}

export class CommentController {
  /** One hover card per document, shared by the editors it holds. */
  private cards = new WeakMap<Document, CommentHoverCard>();

  constructor(private options: CommentOptions) {}

  private show(view: EditorView, anchor: number, initial: string | null,
    save: (text: string) => void, resolve: (() => void) | null, quote: string) {
    let popover: CommentPopover | undefined;
    const operation = this.options.operations.capture(view, () => this.options.identity(view), {
      valid: () => this.options.enabled(),
      onCancel: () => popover?.close(),
    });
    popover = new CommentPopover(view, anchor, initial, save, resolve, {
      isCurrent: () => operation.isCurrent(),
      onClose: () => operation.finish(),
      quote,
    });
    popover.open();
  }

  /** Open the editor for the comment whose anchor contains `pos`. Saving
   * rewrites the open tag's attribute; resolving deletes both tags and
   * leaves the anchored text as plain prose. Both re-verify that the tags
   * still sit untouched before dispatching. */
  open(view: EditorView, pos: number) {
    if (!this.options.enabled()) return;
    const found = locateComment(view, pos);
    if (!found) return;
    const { open, close, intact } = found;
    this.show(
      view,
      pos,
      found.note,
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
      () => this.resolveLocated(view, found),
      view.state.doc.sliceString(open.to, close.from)
    );
  }

  /** Resolve the comment whose anchor contains `pos`: both tags go and
   * the commented words stay as plain prose. */
  resolve(view: EditorView, pos: number) {
    if (!this.options.enabled()) return;
    const found = locateComment(view, pos);
    if (found) this.resolveLocated(view, found);
  }

  private resolveLocated(view: EditorView, found: LocatedComment) {
    if (!found.intact()) return;
    view.dispatch({
      changes: [
        { from: found.open.from, to: found.open.to },
        { from: found.close.from, to: found.close.to },
      ],
      userEvent: "delete.comment",
    });
  }

  /** Whether hovering commented text should show the card. */
  hoverCardEnabled(): boolean {
    return this.options.enabled() && (this.options.hoverCard?.() ?? true);
  }

  private card(doc: Document): CommentHoverCard {
    let card = this.cards.get(doc);
    if (!card) {
      card = new CommentHoverCard(doc);
      this.cards.set(doc, card);
    }
    return card;
  }

  /** The comment behind a rendered anchor element. A mark on an active
   * line maps straight to its position; Obsidian's inline-HTML widget of a
   * raw span (an inactive line, or a line inside a rendered Callout) maps
   * to the widget's start, so the pair is then found by its raw note on
   * the following lines of that block. */
  private commentForElement(view: EditorView, el: HTMLElement): { pos: number; note: string } | null {
    let pos: number;
    try {
      pos = view.posAtDOM(el);
    } catch {
      return null;
    }
    const direct = locateComment(view, pos);
    if (direct) return { pos: direct.open.to, note: direct.note };
    const raw = el.getAttribute("data-nf-cmt");
    if (raw == null) return null;
    const doc = view.state.doc;
    const first = doc.lineAt(Math.min(pos, doc.length));
    for (let n = first.number; n <= doc.lines && n < first.number + 400; n++) {
      const line = doc.line(n);
      if (n > first.number && !/^\s*>/.test(line.text)) break;
      const pair = findColorTagPairs(line.text).find((p) => p.comment === raw);
      if (pair) return { pos: line.from + pair.open.to, note: decodeCommentAttr(raw) };
    }
    return null;
  }

  /** Live Preview: hover on commented text anywhere in the editor shows
   * the card with Edit and Resolve. Returns the detach function. */
  attachHover(view: EditorView): () => void {
    const doc = view.dom.ownerDocument;
    const anchorOf = (evt: Event) => {
      const target = evt.target;
      return target instanceof Element
        ? (target.closest(COMMENT_HOVER_SELECTOR) as HTMLElement | null)
        : null;
    };
    const onOver = (evt: MouseEvent) => {
      if (!this.hoverCardEnabled() || isCommentPopoverOpen()) return;
      const anchor = anchorOf(evt);
      if (!anchor || !view.dom.contains(anchor)) return;
      this.card(doc).hover(anchor, () => {
        const found = this.commentForElement(view, anchor);
        if (found) {
          return {
            note: found.note,
            onEdit: () => this.open(view, found.pos),
            onResolve: () => this.resolve(view, found.pos),
          };
        }
        const raw = anchor.getAttribute("data-nf-cmt");
        return raw == null ? null : { note: decodeCommentAttr(raw) };
      });
    };
    const onOut = (evt: MouseEvent) => {
      const anchor = anchorOf(evt);
      if (anchor) this.cards.get(doc)?.leave(anchor, evt.relatedTarget);
    };
    view.dom.addEventListener("mouseover", onOver);
    view.dom.addEventListener("mouseout", onOut);
    return () => {
      view.dom.removeEventListener("mouseover", onOver);
      view.dom.removeEventListener("mouseout", onOut);
      this.cards.get(doc)?.close();
    };
  }

  /** Rendered Markdown (Reading view): the card shows the note on hover or
   * click. Inside an editor the delegated Live Preview handler owns the
   * element instead, so nothing is attached twice. */
  attachReadingHover(el: HTMLElement) {
    const note = decodeCommentAttr(el.getAttribute("data-nf-cmt") ?? "");
    const owned = () => !this.hoverCardEnabled() || el.closest(".cm-editor") != null;
    el.addEventListener("mouseenter", () => {
      if (owned() || isCommentPopoverOpen()) return;
      this.card(el.ownerDocument).hover(el, () => ({ note }));
    });
    el.addEventListener("mouseleave", (evt) => {
      if (owned()) return;
      this.cards.get(el.ownerDocument)?.leave(el, evt.relatedTarget);
    });
    el.addEventListener("click", () => {
      if (owned() || isCommentPopoverOpen()) return;
      this.card(el.ownerDocument).open(el, { note });
    });
  }

  /** Comment on the current selection: validate it, ask for the text, wrap. */
  add(view: EditorView) {
    if (!this.options.enabled()) return;
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
    this.show(
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
      null,
      selected
    );
  }

}

/** The 💬 marker rendered in place of a comment's closing tag. */
export class CommentIconWidget extends WidgetType {
  constructor(readonly tooltip: string, private comments: CommentController) {
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
        this.comments.open(view, view.posAtDOM(el));
      } catch {
        // The widget may already be detached from the editor.
      }
    });
    return el;
  }
}

