import { setIcon } from "obsidian";
import { t } from "../i18n";
import { keyLabel } from "../core/keys";
import { placePopover } from "../ui/link-popover";
import { toggleTask } from "./attachments";

export type NoteMode = "view" | "edit";

/** A box in window coordinates, as getBoundingClientRect() gives it. */
export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface NotePanelHost {
  /** The card's name, shown in the panel's head. */
  title(): string;
  /**
   * The card's notes as it has them now, in order. While a note is written
   * they keep the places they had when writing began, an emptied one too.
   */
  notes(): string[];
  /** Whether the notes may change: not on a read-only canvas, nor while presenting. */
  editable(): boolean;
  /** Draw each note's Markdown into its element; called with every note at once. */
  render(items: readonly { markdown: string; el: HTMLElement }[]): void;
  /** A link in a note was clicked; true when the host opened it. */
  follow?(link: HTMLAnchorElement, evt: MouseEvent): boolean;
  /** The pointer came onto a link in a note, for a page preview. */
  hover?(link: HTMLAnchorElement, evt: MouseEvent): void;
  /** A note rewritten while it is read, as one undo step: a task ticked in it. */
  rewrite?(index: number, text: string): void;
  /**
   * Editing the `index`-th note starts, or a new note after the last one:
   * whatever is typed from here on is one undo step.
   */
  editing(index: number): void;
  /** The words so far of the note being edited, kept on the card as they are typed. */
  input(index: number, text: string): void;
  /** What was typed into the note being written becomes one undo step: Done, or another note taken up. */
  done(): void;
  /** Delete the `index`-th note; past the last one, the new note being written. */
  remove(index: number): void;
  /** Put the panel away, keeping what was typed. */
  close(): void;
}

/** The editor grows with its words up to this height, then scrolls. */
const TEXTAREA_MAX = 360;
/** Names the panel and its editor by the title, since an aria-label would also show as a tooltip. */
let titleIds = 0;

/** One note as the panel shows it: its words drawn, with its own Edit and Delete. */
interface NoteItem {
  el: HTMLElement;
  body: HTMLElement;
  tools: HTMLElement;
}

/**
 * A card's notes in a small panel beside the card: each note's Markdown
 * drawn as in a note, one under the other, each with Edit and Delete, and
 * Add and Close in the head. Double-clicking a note's words or Edit opens a
 * plain editor in its place; Esc or Mod+Enter keeps what was typed and
 * closes, Done keeps it and shows the notes again. One note is written at a
 * time.
 */
export class NotePanel {
  readonly el: HTMLElement;
  mode: NoteMode = "view";
  /** The note being written: its place among the notes, or the count of them for a new one. */
  editingIndex: number | null = null;
  private titleEl: HTMLElement;
  private addButton: HTMLButtonElement;
  private list: HTMLElement;
  private items: NoteItem[] = [];
  /** The item holding the editor, while a note is written. */
  private editItem: HTMLElement | null = null;
  private field: HTMLTextAreaElement;
  private foot: HTMLElement;
  /** The notes last drawn, so unchanged notes are not drawn again. */
  private shown: string | null = null;
  private composing = false;

  constructor(private doc: Document, private host: NotePanelHost, mode: NoteMode) {
    const el = this.el = doc.createElement("div");
    el.className = "nf-canvas-note-panel nf-canvas-ui";
    el.setAttribute("role", "dialog");
    el.tabIndex = -1;
    for (const name of ["pointerdown", "mousedown", "dblclick", "wheel", "contextmenu", "click"]) {
      el.addEventListener(name, (evt) => evt.stopPropagation());
    }
    // Buttons and task boxes leave the keyboard where it was: in the editor, or with the canvas.
    el.addEventListener("mousedown", (evt) => {
      if ((evt.target as Element).closest?.("button, .task-list-item-checkbox")) evt.preventDefault();
    });
    el.addEventListener("keydown", (evt) => {
      if (evt.key !== "Escape" || evt.isComposing) return;
      evt.preventDefault();
      evt.stopPropagation();
      this.host.close();
    });

    const head = doc.createElement("div");
    head.className = "nf-canvas-note-head";
    const glyph = doc.createElement("span");
    glyph.className = "nf-canvas-note-glyph";
    glyph.setAttribute("aria-hidden", "true");
    setIcon(glyph, "sticky-note");
    this.titleEl = doc.createElement("div");
    this.titleEl.className = "nf-canvas-note-title";
    this.titleEl.id = `nf-note-title-${++titleIds}`;
    el.setAttribute("aria-labelledby", this.titleEl.id);
    this.addButton = this.button("nf-canvas-note-add", "plus", t("Add note"), () => this.add());
    const close = this.button("nf-canvas-note-close", "x", t("Close"), () => this.host.close());
    head.append(glyph, this.titleEl, this.addButton, close);

    this.list = doc.createElement("div");
    this.list.className = "nf-canvas-note-list";
    this.list.addEventListener("dblclick", (evt) => {
      const target = evt.target as Element;
      if (!this.host.editable() || target.closest?.("a, button, .task-list-item-checkbox, .nf-canvas-note-input")) return;
      const index = this.indexOf(target);
      if (index === null) return;
      evt.preventDefault();
      this.setMode("edit", index);
    });
    this.list.addEventListener("click", (evt) => {
      const target = evt.target as Element;
      const box = target.closest?.(".task-list-item-checkbox");
      if (box) {
        // A task ticked here is ticked in the note, as in Reading view; the
        // box shows the note's state, never a state of its own.
        evt.preventDefault();
        const index = this.indexOf(box);
        const item = index === null ? undefined : this.items[index];
        if (!item || index === null) return;
        const boxes = Array.from(item.body.querySelectorAll(".task-list-item-checkbox"));
        const text = this.host.editable() ? toggleTask(this.host.notes()[index] ?? "", boxes.indexOf(box)) : null;
        if (text !== null) this.host.rewrite?.(index, text);
        return;
      }
      const link = target.closest?.("a") as HTMLAnchorElement | null;
      if (link && this.host.follow?.(link, evt)) evt.preventDefault();
    });
    this.list.addEventListener("mouseover", (evt) => {
      const link = (evt.target as Element).closest?.("a.internal-link") as HTMLAnchorElement | null;
      if (link) this.host.hover?.(link, evt);
    });

    this.field = doc.createElement("textarea");
    this.field.className = "nf-canvas-note-input";
    this.field.placeholder = t("Write a note… Markdown works here");
    this.field.setAttribute("aria-labelledby", this.titleEl.id);
    this.field.spellcheck = true;
    this.field.addEventListener("compositionstart", () => { this.composing = true; });
    this.field.addEventListener("compositionend", () => {
      this.composing = false;
      this.typed();
    });
    this.field.addEventListener("input", (evt) => {
      if (this.composing || (evt as InputEvent).isComposing) return;
      this.typed();
    });
    this.field.addEventListener("keydown", (evt) => this.onFieldKey(evt));

    this.foot = doc.createElement("div");
    this.foot.className = "nf-canvas-note-foot";
    const hint = doc.createElement("span");
    hint.className = "nf-canvas-note-hint";
    hint.textContent = t("Saved as you type · Esc or {save} closes").replace("{save}", keyLabel("Mod+Enter"));
    const done = this.button("nf-canvas-note-done", "check", t("Save note"), () => {
      this.host.done();
      this.setMode("view");
    });
    const remove = this.button("nf-canvas-note-delete", "trash-2", t("Delete note"), () => {
      if (this.editingIndex !== null) this.host.remove(this.editingIndex);
    });
    this.foot.append(hint, done, remove);

    el.append(head, this.list);
    if (mode === "edit") this.setMode("edit", 0);
    else this.sync();
  }

  private button(cls: string, icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = this.doc.createElement("button");
    button.type = "button";
    button.className = `clickable-icon ${cls}`;
    button.setAttribute("aria-label", label);
    button.setAttribute("data-tooltip-position", "top");
    setIcon(button, icon);
    button.addEventListener("click", onClick);
    return button;
  }

  /** Which note an element in the list belongs to. */
  private indexOf(target: Element): number | null {
    const item = target.closest?.(".nf-canvas-note-item") as HTMLElement | null;
    if (!item) return null;
    const index = this.items.findIndex((entry) => entry.el === item);
    return index < 0 ? null : index;
  }

  private onFieldKey(evt: KeyboardEvent) {
    if (evt.isComposing || this.composing || evt.keyCode === 229) return;
    const mod = (evt.metaKey || evt.ctrlKey) && !evt.altKey;
    if (evt.key === "Escape" || (evt.key === "Enter" && mod && !evt.shiftKey)) {
      evt.preventDefault();
      evt.stopPropagation();
      this.host.close();
      return;
    }
    // Tab indents, as in a note; Esc is always the way out.
    if (evt.key === "Tab" && !mod && !evt.shiftKey && !evt.altKey) {
      evt.preventDefault();
      evt.stopPropagation();
      const field = this.field;
      if (typeof field.setRangeText === "function") field.setRangeText("\t", field.selectionStart, field.selectionEnd, "end");
      else field.value += "\t";
      this.typed();
    }
  }

  private typed() {
    this.fit();
    if (this.editingIndex !== null) this.host.input(this.editingIndex, this.field.value);
  }

  /** The editor grows with its words, up to a limit, then scrolls. */
  private fit() {
    const field = this.field;
    if (!field.isConnected || typeof field.scrollHeight !== "number") return;
    field.style.setProperty("height", "auto");
    field.style.setProperty("height", `${Math.min(field.scrollHeight + 2, TEXTAREA_MAX)}px`);
  }

  /** Start a new note after the others, the one being written kept first. */
  add() {
    if (!this.host.editable()) return;
    const count = this.host.notes().length;
    if (this.mode === "edit" && this.editingIndex !== null && this.editingIndex >= count) {
      // Already writing a new one, which holds no words yet.
      this.focus();
      return;
    }
    this.setMode("edit", count);
  }

  /**
   * Show the notes, or write one: the `index`-th, or with the count of
   * notes a new one after them. Moving from one note to another keeps the
   * first one's words as its own undo step.
   */
  setMode(mode: NoteMode, index = 0) {
    let notes = this.host.notes();
    const next = mode === "edit" && this.host.editable() ? "edit" : "view";
    let at = Math.max(0, Math.min(index, notes.length));
    if (next === "edit" && this.mode === "edit" && this.editingIndex === at) {
      this.focus();
      return;
    }
    // Leaving the editor, the keyboard stays with the panel, so Esc still closes it.
    if (this.mode === "edit" && this.el.ownerDocument.activeElement === this.field) this.el.focus();
    if (this.mode === "edit" && next === "edit") {
      // A note emptied while it was written is gone once it is kept: the others close up.
      at = notes.slice(0, at).filter((text) => text.trim()).length;
      this.host.done();
      this.leaveEditor();
      notes = this.host.notes();
      at = Math.min(at, notes.length);
    }
    this.mode = next;
    this.el.classList.toggle("is-editing", next === "edit");
    if (next === "view") {
      this.leaveEditor();
      this.sync();
      return;
    }
    this.editingIndex = at;
    this.host.editing(at);
    // The notes as they are now, the one being written among them.
    this.draw(this.host.notes());
    const item = this.items[at]?.el ?? this.newItem();
    item.classList.add("is-editing");
    item.append(this.field, this.foot);
    this.editItem = item;
    this.field.value = this.host.notes()[at] ?? "";
    this.sync();
    this.fit();
    if (typeof item.scrollIntoView === "function") item.scrollIntoView({ block: "nearest" });
    this.focus();
  }

  private leaveEditor() {
    this.editingIndex = null;
    this.editItem?.classList.remove("is-editing");
    this.field.remove();
    this.foot.remove();
    this.editItem = null;
    this.shown = null;
  }

  /** An empty item after the notes, for a note not yet written. */
  private newItem(): HTMLElement {
    const el = this.doc.createElement("div");
    el.className = "nf-canvas-note-item is-new";
    this.list.append(el);
    return el;
  }

  /** The keyboard goes to the editor, caret after the words; in view, to the panel. */
  focus() {
    if (this.mode === "edit") {
      this.field.focus();
      const end = this.field.value.length;
      if (typeof this.field.setSelectionRange === "function") this.field.setSelectionRange(end, end);
    }
  }

  /** Draw every note again, each with its own tools. */
  private draw(notes: readonly string[]) {
    // Drawing again removes whatever in it had the keyboard; the panel keeps it, so Esc still closes.
    const focused = this.list.contains(this.el.ownerDocument.activeElement) && this.el.ownerDocument.activeElement !== this.field;
    this.list.replaceChildren();
    this.items = notes.map((_, index) => {
      const el = this.doc.createElement("div");
      el.className = "nf-canvas-note-item";
      const tools = this.doc.createElement("div");
      tools.className = "nf-canvas-note-tools";
      tools.append(
        this.button("nf-canvas-note-edit", "pencil", t("Edit note"), () => this.setMode("edit", index)),
        this.button("nf-canvas-note-delete", "trash-2", t("Delete note"), () => this.host.remove(index)),
      );
      const body = this.doc.createElement("div");
      body.className = "nf-canvas-note-body markdown-rendered";
      el.append(tools, body);
      this.list.append(el);
      return { el, body, tools };
    });
    this.shown = notes.join("\u0000");
    this.host.render(notes.map((markdown, index) => ({ markdown, el: this.items[index].body })));
    if (focused) this.el.focus();
  }

  /** Bring the panel up to date with its card; called after every canvas render. */
  sync() {
    const title = this.host.title() || t("Note");
    if (this.titleEl.textContent !== title) this.titleEl.textContent = title;
    const editable = this.host.editable();
    const notes = this.host.notes();
    // While a note is written, the others stay as drawn.
    if (this.mode === "view" && this.shown !== notes.join("\u0000")) this.draw(notes);
    this.addButton.hidden = !editable;
    for (const [index, item] of this.items.entries()) {
      const writing = this.mode === "edit" && this.editingIndex === index;
      item.tools.hidden = writing || !editable;
      item.body.hidden = writing;
    }
  }

  /**
   * Hang the panel under the card, its right edge on the card's, or over
   * it when there is no room below, inside the canvas. Without a card on
   * screen the panel waits out of sight.
   */
  place(anchor: ScreenBox | null, bounds: ScreenBox, viewport: { w: number; h: number }) {
    this.el.classList.toggle("is-offscreen", !anchor);
    if (!anchor) return;
    const size = { w: this.el.offsetWidth || 340, h: this.el.offsetHeight || 160 };
    const spot = placePopover({ left: anchor.right - size.w + 12, top: anchor.top, bottom: anchor.bottom }, size, viewport, bounds);
    this.el.style.setProperty("left", `${Math.round(spot.left - bounds.left)}px`);
    this.el.style.setProperty("top", `${Math.round(spot.top - bounds.top)}px`);
    this.el.dataset.placement = spot.below ? "below" : "above";
  }

  /** The note being written and its words so far, while editing. */
  get draft(): { index: number; text: string } | null {
    return this.mode === "edit" && this.editingIndex !== null ? { index: this.editingIndex, text: this.field.value } : null;
  }

  /** The note being written is deleted: what the editor holds goes with it. */
  forget() {
    this.field.value = "";
  }

  destroy() {
    this.el.remove();
  }
}
