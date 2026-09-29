import { setIcon } from "obsidian";
import { t } from "../i18n";
import { safeCanvasColor } from "./appearance";

/** The six colors Canvas offers on its own cards, as it names them. */
export const CANVAS_COLORS: [string, string][] = [["1", "Red"], ["2", "Orange"], ["3", "Yellow"], ["4", "Green"], ["5", "Cyan"], ["6", "Purple"]];

/** The hex colors last picked in the branch color picker, kept per device. */
export const RECENT_COLOR_KEY = "nf-canvas-color-recent";
export const RECENT_COLOR_LIMIT = 6;

/** Stored recents → lowercase #rrggbb colors, without repeats, at most RECENT_COLOR_LIMIT. */
export function recentColorsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const list: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !/^#[\da-f]{6}$/i.test(item)) continue;
    const color = item.toLowerCase();
    if (!list.includes(color)) list.push(color);
    if (list.length >= RECENT_COLOR_LIMIT) break;
  }
  return list;
}

/** The list with `hex` first, once. */
export function withRecentColor(list: readonly string[], hex: string): string[] {
  return recentColorsFrom([hex, ...list]);
}

export interface ColorPanelHost {
  /**
   * The selected branch card's own color (null for none) and the tones of
   * its map's palette as #rrggbb for the mode shown now; null without a map card.
   */
  state(): { color: string | null; tones: string[] } | null;
  /** Color the branch, or with null clear it. */
  pick(color: string | null): void;
  close(): void;
  /** Where the recent colors are kept, when anywhere. */
  recent?: { load(): unknown; save(list: string[]): void };
}

/**
 * The branch color picker: a small popover like the marker picker. The
 * map's own tones and the recent colors come first, then Canvas's six
 * colors, a hex field for any other, and Clear. It colors the selected
 * card's whole branch and stays open for the next card.
 */
export class BranchColorPanel {
  readonly el: HTMLElement;
  private hex: HTMLInputElement;
  private clearButton: HTMLButtonElement;
  private empty: HTMLElement;
  private body: HTMLElement;
  private schemeRow: HTMLElement;
  private schemeGrid: HTMLElement;
  private recentRow: HTMLElement;
  private recentGrid: HTMLElement;
  private tonesKey: string | null = null;
  private recent: string[];

  constructor(private doc: Document, private host: ColorPanelHost) {
    const el = this.el = doc.createElement("div");
    el.className = "nf-canvas-marker-panel nf-canvas-color-panel nf-canvas-ui";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", t("Branch color"));
    for (const name of ["pointerdown", "mousedown", "dblclick", "wheel", "contextmenu", "click"]) {
      el.addEventListener(name, (evt) => evt.stopPropagation());
    }
    // Clicking a color keeps the keyboard with the canvas and its selection.
    el.addEventListener("mousedown", (evt) => {
      if ((evt.target as Element).closest("button")) evt.preventDefault();
    });
    el.addEventListener("keydown", (evt) => {
      if (evt.key !== "Escape") return;
      evt.preventDefault();
      evt.stopPropagation();
      this.host.close();
    });

    const head = doc.createElement("div");
    head.className = "nf-canvas-marker-head";
    const title = doc.createElement("div");
    title.className = "nf-canvas-marker-title";
    title.textContent = t("Branch color");
    this.clearButton = doc.createElement("button");
    this.clearButton.type = "button";
    this.clearButton.className = "nf-canvas-marker-clear";
    this.clearButton.textContent = t("Clear color");
    this.clearButton.addEventListener("click", () => this.host.pick(null));
    const close = doc.createElement("button");
    close.type = "button";
    close.className = "clickable-icon nf-canvas-marker-close";
    close.setAttribute("aria-label", t("Close"));
    setIcon(close, "x");
    close.addEventListener("click", () => this.host.close());
    head.append(title, this.clearButton, close);

    this.empty = doc.createElement("div");
    this.empty.className = "nf-canvas-marker-empty";
    this.empty.textContent = t("Select a card in a mind map to color its branch.");

    this.body = doc.createElement("div");
    this.body.className = "nf-canvas-marker-body";
    // A picked tone or recent color is written as that hex, which stays put
    // when the theme later turns light or dark; Canvas's six colors follow it.
    const fixed = t("A written color does not follow later light/dark switches");
    [this.schemeRow, this.schemeGrid] = this.row("scheme", t("Map scheme"), fixed);
    [this.recentRow, this.recentGrid] = this.row("recent", t("Recent"), fixed);
    const [canvasRow, canvasGrid] = this.row("canvas", t("Canvas colors"));
    for (const [value, name] of CANVAS_COLORS) canvasGrid.append(this.swatch(value, t(name)));
    this.recent = recentColorsFrom(this.host.recent?.load());
    this.renderRecent();

    const custom = doc.createElement("div");
    custom.className = "nf-canvas-color-custom";
    this.hex = doc.createElement("input");
    this.hex.type = "text";
    this.hex.className = "nf-canvas-color-hex";
    this.hex.placeholder = "#4a90d9";
    this.hex.spellcheck = false;
    this.hex.setAttribute("aria-label", t("Custom (hex)"));
    this.hex.addEventListener("keydown", (evt) => {
      if (evt.key !== "Enter") return;
      evt.preventDefault();
      evt.stopPropagation();
      this.applyHex();
    });
    this.hex.addEventListener("change", () => this.applyHex());
    custom.append(this.hex);
    this.body.append(this.schemeRow, this.recentRow, canvasRow, custom);
    el.append(head, this.empty, this.body);
    this.sync();
  }

  /** A labelled row of swatches; the label's tooltip, if any, says what picking one writes. */
  private row(name: string, label: string, tooltip?: string): [HTMLElement, HTMLElement] {
    const row = this.doc.createElement("div");
    row.className = "nf-canvas-color-row";
    row.dataset.row = name;
    const heading = this.doc.createElement("div");
    heading.className = "nf-canvas-marker-group";
    heading.textContent = label;
    if (tooltip) heading.setAttribute("aria-label", tooltip);
    const grid = this.doc.createElement("div");
    grid.className = "nf-canvas-marker-grid nf-canvas-color-grid";
    row.append(heading, grid);
    return [row, grid];
  }

  private swatch(value: string, label: string): HTMLButtonElement {
    const button = this.doc.createElement("button");
    button.type = "button";
    button.className = "nf-canvas-marker-option nf-canvas-color-swatch";
    button.dataset.color = value;
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", label);
    button.style.setProperty("--nf-swatch", safeCanvasColor(value)!);
    button.addEventListener("click", () => this.choose(value));
    return button;
  }

  /** Every pick goes here: a hex color also becomes the most recent one. */
  private choose(value: string | null) {
    this.host.pick(value);
    if (value && value.startsWith("#")) {
      this.recent = withRecentColor(this.recent, value);
      this.host.recent?.save(this.recent);
      this.renderRecent();
      this.syncPressed();
    }
  }

  /**
   * The recent swatches in their new order, reusing the buttons already
   * there. Moving the focused one (a Recent pick from the keyboard) drops the
   * focus, so it goes back to that same button, now first.
   */
  private renderRecent() {
    const current = Array.from(this.recentGrid.children) as HTMLButtonElement[];
    const next = this.recent.map((color) => current.find((button) => button.dataset.color === color) ?? this.swatch(color, color));
    if (next.length !== current.length || next.some((button, index) => button !== current[index])) {
      const active = this.doc.activeElement;
      const focused = next.find((button) => button === active);
      this.recentGrid.replaceChildren(...next);
      if (focused && this.doc.activeElement !== focused) focused.focus();
    }
    this.recentRow.hidden = !this.recent.length;
  }

  /** A typed color is applied once it reads as a hex color; anything else is left to correct. */
  private applyHex() {
    const typed = this.hex.value.trim();
    const value = (typed && !typed.startsWith("#") ? `#${typed}` : typed).toLowerCase();
    const valid = !!safeCanvasColor(value) && value.startsWith("#");
    this.hex.classList.toggle("is-invalid", !!typed && !valid);
    // #rgb goes on as #rrggbb, the form JSON Canvas writes and Recent keeps.
    if (valid) this.choose(value.length === 4 ? `#${[...value.slice(1)].map((digit) => digit + digit).join("")}` : value);
  }

  private syncPressed() {
    const state = this.host.state();
    for (const button of this.body.querySelectorAll<HTMLButtonElement>(".nf-canvas-color-swatch")) {
      const pressed = String(!!state && state.color === button.dataset.color);
      if (button.getAttribute("aria-pressed") !== pressed) button.setAttribute("aria-pressed", pressed);
    }
  }

  /** Show the selected branch's color and its map's tones; called after every canvas render. */
  sync() {
    const state = this.host.state();
    this.el.classList.toggle("is-empty", !state);
    this.body.inert = !state;
    this.clearButton.disabled = !state || state.color === null;
    const tones = state?.tones ?? [];
    const key = tones.join();
    if (key !== this.tonesKey) {
      this.tonesKey = key;
      this.schemeGrid.replaceChildren(...tones.map((color) => this.swatch(color, color)));
      this.schemeRow.hidden = !tones.length;
    }
    this.syncPressed();
    const hex = state?.color && state.color.startsWith("#") ? state.color : "";
    if (this.hex.value !== hex && this.hex.ownerDocument.activeElement !== this.hex) this.hex.value = hex;
  }

  destroy() {
    this.el.remove();
  }
}
