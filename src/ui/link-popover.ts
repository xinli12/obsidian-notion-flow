import { AbstractInputSuggest, prepareFuzzySearch, setIcon, type App, type TFile } from "obsidian";
import { t } from "../i18n";
import { RE_HTTP_URL } from "../core/url-links";
import { isValidLinkDest, normalizeLinkDest } from "../core/markdown-links";

/** Viewport rectangle the card hangs below (or above, when short of room). */
export interface LinkAnchorRect {
  left: number;
  top: number;
  bottom: number;
}

/** A viewport box a floating card stays inside (a `DOMRect` is one). */
export interface PopoverBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type LinkKind = "markdown" | "wiki";

/** Why the card closed: Escape, a write (Save, Unlink), a click outside,
 * or anything else (Open, a stale card cancelled, the editor closing). */
export type LinkCloseReason = "escape" | "save" | "unlink" | "outside" | "cancel";

export interface LinkPopoverOptions {
  /** The editor's document, so the card lands in the right (popout) window. */
  doc: Document;
  /** Where to anchor; a getter keeps the card in place while the editor
   * scrolls or the window resizes. */
  anchor: LinkAnchorRect | (() => LinkAnchorRect | null);
  text: string;
  dest: string;
  /** Editing an existing link (offers Unlink) rather than creating one. */
  hasLink: boolean;
  /** The link's syntax: `"wiki"` for `[[target|text]]`, where spaces in the
   * target are legal, so no `<…>` note is shown. Defaults to `"markdown"`.
   * Either way the destination reaches onSave normalized. */
  kind?: LinkKind;
  /** Enables note search in the destination field. */
  app?: App;
  /** The note being edited, so a picked note gets the link text Obsidian
   * itself would write from there. */
  sourcePath?: string;
  /** The pane the card belongs to; it stays inside (8px in) instead of
   * merely inside the window. */
  bounds?: () => PopoverBox | null | undefined;
  /** Receives the trimmed text (the destination when text is empty) and the
   * normalized destination — whitespace paths arrive wrapped in `<…>`. */
  onSave: (text: string, dest: string) => void;
  onOpen?: (dest: string) => void;
  onUnlink?: () => void;
  /** Runs once, after the card is gone. Escape hands the selection back
   * to the editor, which then shows its toolbar again. */
  onClose?: (reason: LinkCloseReason) => void;
}

/** Distance a card keeps from the edges of its box. */
const EDGE = 8;
/** Distance between a card and the text it is anchored to. */
const GAP = 8;

/** One axis of the area a card may use: the box's span (clipped to the
 * window) when the card fits inside it, else the whole window's. */
function span(from: number, to: number, windowSize: number, size: number): [number, number] {
  const lo = Math.max(0, from);
  const hi = Math.min(windowSize, to);
  return hi - lo - 2 * EDGE >= size ? [lo, hi] : [0, windowSize];
}

function spans(
  size: { w: number; h: number },
  viewport: { w: number; h: number },
  bounds: PopoverBox | null
): PopoverBox {
  const [left, right] = bounds ? span(bounds.left, bounds.right, viewport.w, size.w) : [0, viewport.w];
  const [top, bottom] = bounds ? span(bounds.top, bounds.bottom, viewport.h, size.h) : [0, viewport.h];
  return { left, top, right, bottom };
}

/** Where a card of `size` may sit: `bounds` inset by 8px and intersected
 * with the window — or, on an axis where that box is too small for the
 * card, the window inset by 8px. */
export function popoverArea(
  size: { w: number; h: number },
  viewport: { w: number; h: number },
  bounds: PopoverBox | null
): PopoverBox {
  const area = spans(size, viewport, bounds);
  return { left: area.left + EDGE, top: area.top + EDGE, right: area.right - EDGE, bottom: area.bottom - EDGE };
}

/** Placement shared by the link and comment cards: below the anchor when
 * it fits, else above when that fits, else on the side with more room —
 * then clamped into the area (see popoverArea). Without an anchor the
 * card is centred, 30% down the box. */
export function placePopover(
  anchor: LinkAnchorRect | null,
  size: { w: number; h: number },
  viewport: { w: number; h: number },
  bounds: PopoverBox | null
): { left: number; top: number; below: boolean } {
  const box = spans(size, viewport, bounds);
  const area = popoverArea(size, viewport, bounds);
  if (!anchor) {
    return {
      left: Math.max(area.left, Math.round(box.left + (box.right - box.left - size.w) / 2)),
      top: Math.max(area.top, Math.round(box.top + (box.bottom - box.top) * 0.3)),
      below: true,
    };
  }
  const left = Math.min(Math.max(area.left, anchor.left - 12), area.right - size.w);
  const belowTop = anchor.bottom + GAP;
  const aboveTop = anchor.top - GAP - size.h;
  const below =
    belowTop + size.h <= area.bottom
      ? true
      : aboveTop >= area.top
        ? false
        : area.bottom - belowTop >= anchor.top - GAP - area.top;
  // An anchor scrolled out of view (the editor still reports its
  // coordinates) must not take the focused card out of its box with it.
  const top = Math.min(
    Math.max(area.top, below ? belowTop : aboveTop),
    Math.max(area.top, area.bottom - size.h)
  );
  return { left, top, below };
}

/** A URL or other scheme (`https:`, `mailto:`, `obsidian:`). */
const RE_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

type FuzzyMatcher = (text: string) => { score: number } | null;

/** Vault files for a typed destination: a note whose name IS the query
 * first (case and Unicode form aside), then recently opened files, then
 * the best fuzzy match (a basename match beats one found only in the
 * folder path), then the shorter path. Nothing for a URL, a `<…>` path or
 * a heading/alias (`#`, `|`) — Enter must keep saving those. Scans every
 * file per keystroke, which is fine for a few thousand notes. */
export function rankLinkTargets<T extends { path: string; basename: string; extension: string }>(
  query: string,
  files: readonly T[],
  recentPaths: readonly string[],
  prepare: (query: string) => FuzzyMatcher = prepareFuzzySearch,
  limit = 8
): T[] {
  const q = query.trim();
  if (!q || RE_HTTP_URL.test(q) || RE_SCHEME.test(q) || q.startsWith("<") || /[#|]/.test(q)) return [];
  const match = prepare(q);
  const fold = (text: string) => text.normalize("NFC").toLowerCase();
  const exactName = fold(q);
  const recency = new Map<string, number>();
  recentPaths.forEach((path, i) => {
    if (!recency.has(path)) recency.set(path, i);
  });
  const ranked: { file: T; score: number; recent: number; exact: number }[] = [];
  for (const file of files) {
    let score = match(file.basename)?.score;
    if (score == null) {
      const bare = file.extension === "md" ? file.path.slice(0, -3) : file.path;
      const inPath = match(bare);
      if (!inPath) continue;
      score = inPath.score - 1;
    }
    ranked.push({
      file,
      score,
      recent: recency.get(file.path) ?? Infinity,
      // A weak match opened recently must not bury the note that is
      // literally named what was typed (the quick switcher's answer too);
      // among exact names a note comes before an attachment (demo.md
      // before img/demo.png, although that path is shorter).
      exact: fold(file.basename) === exactName ? (file.extension === "md" ? 0 : 1) : 2,
    });
  }
  // Infinity - Infinity is NaN, which falls through to the next key.
  ranked.sort(
    (a, b) =>
      a.exact - b.exact ||
      a.recent - b.recent ||
      b.score - a.score ||
      a.file.path.length - b.file.path.length
  );
  return ranked.slice(0, limit).map((item) => item.file);
}

interface LinkSuggestHost {
  wantsSuggestions(): boolean;
  picked(file: TFile): void;
}

/** Obsidian's own suggestion dropdown under the destination field. */
class LinkDestSuggest extends AbstractInputSuggest<TFile> {
  constructor(app: App, input: HTMLInputElement, private readonly host: LinkSuggestHost) {
    super(app, input);
    this.limit = 8;
    this.onSelect((file) => {
      this.close();
      host.picked(file);
    });
  }

  protected getSuggestions(query: string): TFile[] {
    if (!this.host.wantsSuggestions()) return [];
    return rankLinkTargets(query, this.app.vault.getFiles(), this.app.workspace.getLastOpenFiles());
  }

  renderSuggestion(file: TFile, el: HTMLElement) {
    // Obsidian's native two-line item, so no styles.css is needed.
    el.addClass("mod-complex");
    const content = el.createDiv({ cls: "suggestion-content" });
    content.createDiv({ cls: "suggestion-title", text: file.extension === "md" ? file.basename : file.name });
    const slash = file.path.lastIndexOf("/");
    if (slash > 0) content.createDiv({ cls: "suggestion-note", text: file.path.slice(0, slash) });
  }
}

/** The dropdown element; internal to Obsidian, but stable since 0.x. */
function suggestionList(suggest: LinkDestSuggest | null): HTMLElement | null {
  return (suggest as unknown as { suggestEl?: HTMLElement } | null)?.suggestEl ?? null;
}

/** The quiet line under the fields: what the destination accepts while it
 * is empty, and how a Markdown path with spaces will be written. */
function linkHint(dest: string, kind: LinkKind): string {
  const d = dest.trim();
  if (!d) return t("Paste a URL or search notes");
  if (kind === "markdown" && /\s/.test(d) && !(d.startsWith("<") && d.endsWith(">"))) {
    return t("Spaces are wrapped in <…>");
  }
  return "";
}

/** Notion-style link editor: a floating card with the link text and its
 * destination, anchored to the linked text instead of a modal. Enter saves
 * (IME composition is respected), Esc closes, and clicking elsewhere
 * closes without saving — a link edit is deliberate and Save is one key
 * away. An http(s) URL on the clipboard pre-fills an empty destination,
 * and typing in the destination searches the vault's notes. */
export class LinkPopover {
  private el: HTMLDivElement | null = null;
  private textInput: HTMLInputElement | null = null;
  private destInput: HTMLInputElement | null = null;
  private hint: HTMLSpanElement | null = null;
  private openBtn: HTMLButtonElement | null = null;
  private suggest: LinkDestSuggest | null = null;
  /** Typed into since the card opened (or since a note was picked): only
   * then may the dropdown appear and take over Enter. */
  private destEdited = false;
  /** The write in progress (Save or Unlink): a close it causes — its own
   * dispatch cancels the card's operation — reports that write. */
  private writing: LinkCloseReason | null = null;
  private readonly doc: Document;
  private readonly win: Window;
  private readonly kind: LinkKind;

  constructor(private readonly options: LinkPopoverOptions) {
    this.doc = options.doc;
    this.win = options.doc.defaultView ?? window;
    this.kind = options.kind ?? "markdown";
  }

  /** Close whichever link card is open (editor teardown, mode switch). */
  static closeActive() {
    activeLinkPopover?.close("cancel");
  }

  get isOpen(): boolean {
    return this.el != null;
  }

  open() {
    activeLinkPopover?.close("cancel");
    activeLinkPopover = this;
    this.writing = null;
    const { options } = this;
    const el = (this.el = this.doc.body.createDiv({ cls: "nf-link-pop" }));
    el.setAttribute("aria-label", t("Link"));
    el.setAttribute("data-kind", this.kind);
    el.addEventListener("keydown", this.onContainerKeyDown);
    const textInput = (this.textInput = el.createEl("input", {
      cls: "nf-link-input nf-link-text",
      type: "text",
      attr: { placeholder: t("Link text"), spellcheck: "false" },
    }));
    textInput.value = options.text;
    textInput.addEventListener("keydown", this.onInputKeyDown);
    const destInput = (this.destInput = el.createEl("input", {
      cls: "nf-link-input nf-link-dest",
      type: "text",
      attr: { placeholder: t("URL or note path"), spellcheck: "false" },
    }));
    destInput.value = options.dest;
    destInput.addEventListener("keydown", this.onInputKeyDown);
    // Registered before the suggester's own input listener, which asks
    // wantsSuggestions() on the very same event.
    this.destEdited = false;
    destInput.addEventListener("input", () => {
      this.destEdited = true;
      this.refreshDestState();
    });
    if (options.app) this.attachSuggest(options.app, destInput);
    const footer = el.createDiv({ cls: "nf-link-pop-footer" });
    this.hint = footer.createSpan({ cls: "nf-link-hint" });
    const actions = footer.createDiv({ cls: "nf-link-pop-actions" });
    if (options.onOpen) {
      // Icon-only, and hidden while there is nothing to open.
      const open = (this.openBtn = actions.createEl("button", {
        cls: "clickable-icon nf-link-open",
        attr: { "aria-label": t("Open"), "data-tooltip-position": "top", type: "button" },
      }));
      setIcon(open, "external-link");
      open.addEventListener("click", () => this.openDest());
    }
    if (options.hasLink && options.onUnlink) {
      const unlink = actions.createEl("button", { cls: "mod-warning", text: t("Unlink") });
      // The callback runs while the card is still open: closing first
      // would finish the caller's editor operation and turn the write
      // into a no-op. See submit().
      unlink.addEventListener("click", () => {
        this.writing = "unlink";
        try {
          options.onUnlink?.();
        } finally {
          this.close("unlink");
        }
      });
    }
    const save = actions.createEl("button", { cls: "mod-cta", text: t("Save") });
    save.addEventListener("click", () => this.submit());
    this.doc.addEventListener("mousedown", this.onDocMouseDown, true);
    this.doc.addEventListener("scroll", this.onReposition, true);
    this.win.addEventListener("resize", this.onReposition);
    this.refreshDestState();
    this.position();
    // Linking a selection or editing a link wants the destination; only a
    // link from nothing starts with its text.
    const focus = textInput.value ? destInput : textInput;
    focus.focus();
    focus.select();
    if (!destInput.value) this.prefillFromClipboard();
  }

  private attachSuggest(app: App, input: HTMLInputElement) {
    const suggest = (this.suggest = new LinkDestSuggest(app, input, {
      wantsSuggestions: () => this.destEdited,
      picked: (file) => this.pick(app, file),
    }));
    // Obsidian layers suggestions (--layer-notice) under menus; the card
    // sits just above menus, so its list goes one higher (tooltips: 70).
    const list = suggestionList(suggest);
    if (list) list.style.zIndex = "calc(var(--layer-menu, 65) + 2)";
  }

  /** A note chosen from the dropdown becomes the destination (and the
   * text, when there is none yet); focus stays, so Enter now saves. */
  private pick(app: App, file: TFile) {
    const dest = this.destInput;
    const text = this.textInput;
    if (!dest || !text) return;
    dest.value = app.metadataCache.fileToLinktext(file, this.options.sourcePath ?? "", this.kind === "wiki");
    if (!text.value.trim()) text.value = file.extension === "md" ? file.basename : file.name;
    this.destEdited = false;
    this.refreshDestState();
    dest.focus();
  }

  /** A URL sitting on the clipboard is almost always the destination about
   * to be pasted; offer it selected, so typing still replaces it. */
  private prefillFromClipboard() {
    try {
      const clipboard = this.win.navigator?.clipboard;
      if (!clipboard?.readText) return;
      clipboard
        .readText()
        .then((clip) => {
          const input = this.destInput;
          const url = (clip ?? "").trim();
          if (!input || input.value || !RE_HTTP_URL.test(url)) return;
          input.value = url;
          // Setting the value fires no input event.
          this.refreshDestState();
          if (this.doc.activeElement === input) input.select();
        })
        .catch(() => {
          // Clipboard access denied or empty: nothing to offer.
        });
    } catch {
      // No clipboard API in this window.
    }
  }

  private onInputKeyDown = (evt: KeyboardEvent) => {
    // An IME composition owns Enter/Escape while it is open. (While the
    // note dropdown is open, Obsidian's keymap takes Enter and Escape
    // before they get here: Enter picks, Esc closes only the list.)
    if (evt.isComposing || evt.keyCode === 229) return;
    if (evt.key === "Escape") {
      evt.preventDefault();
      evt.stopPropagation();
      this.close("escape");
      return;
    }
    if (evt.key === "Enter") {
      evt.preventDefault();
      evt.stopPropagation();
      this.submit();
    }
  };

  /** Esc also closes while a button has focus; inputs stop their own
   * Escape from reaching here, so it never runs twice. */
  private onContainerKeyDown = (evt: KeyboardEvent) => {
    if (evt.isComposing || evt.keyCode === 229 || evt.key !== "Escape") return;
    evt.preventDefault();
    evt.stopPropagation();
    this.close("escape");
  };

  private onDocMouseDown = (evt: MouseEvent) => {
    const path = evt.composedPath();
    if (this.el && path.includes(this.el)) return;
    // The dropdown hangs off the body, outside the card: a click on a
    // suggestion must reach the suggester, not close the card first.
    const list = suggestionList(this.suggest);
    if (list && path.includes(list)) return;
    if (path.some((node) => (node as Partial<HTMLElement>).classList?.contains("suggestion-container"))) return;
    this.close("outside");
  };

  private onReposition = () => this.position();

  private position() {
    const el = this.el;
    if (!el) return;
    const { anchor } = this.options;
    const rect = typeof anchor === "function" ? anchor() : anchor;
    const { left, top, below } = placePopover(
      rect,
      { w: el.offsetWidth, h: el.offsetHeight },
      { w: this.win.innerWidth, h: this.win.innerHeight },
      this.options.bounds?.() ?? null
    );
    // styles.css picks the entrance keyframe from this; it is set before
    // the first visible frame so the animation never restarts mid-flight.
    el.setAttribute("data-placement", below ? "below" : "above");
    el.style.left = left + "px";
    el.style.top = top + "px";
  }

  /** Open shows only with something to open; the hint follows the text. */
  private refreshDestState() {
    const dest = this.destInput?.value ?? "";
    if (this.openBtn) this.openBtn.style.display = dest.trim() ? "" : "none";
    this.setHint(null);
  }

  private setHint(message: string | null) {
    const hint = this.hint;
    if (!hint) return;
    hint.setText(message ?? linkHint(this.destInput?.value ?? "", this.kind));
    hint.toggleClass("nf-link-hint-error", message != null);
  }

  /** The destination as it would be written, or null (with the hint
   * explaining why) when there is nothing usable to write. */
  private destination(): string | null {
    const dest = normalizeLinkDest(this.destInput?.value ?? "");
    if (isValidLinkDest(dest)) return dest;
    this.setHint(t("Enter a destination"));
    this.destInput?.focus();
    return null;
  }

  private submit() {
    const dest = this.destination();
    if (dest == null) return;
    const typed = (this.textInput?.value ?? "").trim();
    const text = typed || (this.destInput?.value ?? "").trim();
    const { onSave } = this.options;
    this.writing = "save";
    // Write first, then close: onClose finishes the caller's editor
    // operation, after which its isCurrent() guard refuses every write.
    // The write's own dispatch usually closes the card already (the
    // operation lifecycle cancels on the new document), so this close is
    // then a no-op; `finally` keeps a throwing callback from leaving an
    // orphaned card holding focus.
    try {
      onSave(text, dest);
    } finally {
      this.close("save");
    }
  }

  private openDest() {
    const { onOpen } = this.options;
    if (!onOpen) return;
    const dest = this.destination();
    if (dest == null) return;
    this.close("cancel");
    onOpen(dest);
  }

  /** Close the card; `reason` defaults to the write in progress, if any
   * (see `writing`), else "cancel". */
  close(reason?: LinkCloseReason) {
    const el = this.el;
    if (!el) return;
    const why = reason ?? this.writing ?? "cancel";
    this.writing = null;
    if (activeLinkPopover === this) activeLinkPopover = null;
    this.doc.removeEventListener("mousedown", this.onDocMouseDown, true);
    this.doc.removeEventListener("scroll", this.onReposition, true);
    this.win.removeEventListener("resize", this.onReposition);
    // Closing the dropdown also pops its keymap scope at once, rather
    // than when Obsidian notices the detached input.
    const suggest = this.suggest;
    this.suggest = null;
    try {
      suggest?.close();
    } catch {
      // Already torn down with its window.
    }
    el.remove();
    this.el = null;
    this.textInput = null;
    this.destInput = null;
    this.hint = null;
    this.openBtn = null;
    // close() can run inside a CodeMirror update (the operation lifecycle
    // cancels a stale card); a throw there would crash that ViewPlugin
    // and stop stale cards from ever closing again.
    try {
      this.options.onClose?.(why);
    } catch (error) {
      console.error("Notion Flow: closing the link card failed", error);
    }
  }
}

let activeLinkPopover: LinkPopover | null = null;
