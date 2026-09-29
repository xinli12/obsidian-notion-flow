import { getIcon, setIcon } from "obsidian";
import { t, tl } from "../i18n";
import { placePopover, type PopoverBox } from "./link-popover";
import { COMMON_EMOJI, isSingleGrapheme, recentEmojiFrom, rememberEmoji } from "../canvas/markers";

/* The icon popover: a small floating card with a search field, a grid of
 * Lucide icons (callouts), a grid of emoji and a Default button. It is a
 * custom DOM card on purpose — with `nativeMenus` on, Obsidian's menus
 * render plain text only, so a grid of icons inside a Menu would show as
 * a column of empty rows. The page header (page icon) shares it with the
 * emoji grid only.
 *
 * Deliberately imports nothing from main.ts: main.ts imports src/ui, so
 * the reverse import would be a cycle and would pull the whole plugin
 * into every test bundle. */

/** Metadata token prefix for a callout icon: `[!tip|nfi-rocket]`. Not
 * `nf-icon-`: the colour writer replaces any token starting with `nf-`. */
export const CALLOUT_ICON_PREFIX = "nfi-";
/** The token of a callout whose icon is the emoji at the start of its title. */
export const CALLOUT_EMOJI_TOKEN = "nfi-emoji";
/** `app.loadLocalStorage` key of the emoji picked most recently for notes
 * and callouts (the canvas keeps its own). */
export const NOTE_EMOJI_RECENT_KEY = "nf-note-emoji-recent";

export interface CalloutIconDef {
  /** Lucide id; R2-W3-CSS writes one `nfi-<name>` rule per entry. */
  name: string;
  label: { en: string; zh: string };
}

/** The icon grid, row by row (6 columns). The list is fixed: styles.css
 * has one rule per name, so a name Obsidian's icon set lacks is skipped at
 * open time rather than removed here. */
export const CALLOUT_ICONS: readonly CalloutIconDef[] = [
  { name: "lightbulb", label: { en: "Light bulb", zh: "灯泡" } },
  { name: "sparkles", label: { en: "Sparkles", zh: "闪光" } },
  { name: "rocket", label: { en: "Rocket", zh: "火箭" } },
  { name: "star", label: { en: "Star", zh: "星标" } },
  { name: "flag", label: { en: "Flag", zh: "旗帜" } },
  { name: "target", label: { en: "Target", zh: "目标" } },
  { name: "pin", label: { en: "Pin", zh: "图钉" } },
  { name: "bookmark", label: { en: "Bookmark", zh: "书签" } },
  { name: "book-open", label: { en: "Book", zh: "书本" } },
  { name: "graduation-cap", label: { en: "Graduation cap", zh: "学位帽" } },
  { name: "brain", label: { en: "Brain", zh: "大脑" } },
  { name: "code-2", label: { en: "Code", zh: "代码" } },
  { name: "link", label: { en: "Link", zh: "链接" } },
  { name: "calendar", label: { en: "Calendar", zh: "日历" } },
  { name: "clock", label: { en: "Clock", zh: "时钟" } },
  { name: "check-circle-2", label: { en: "Done", zh: "完成" } },
  { name: "alert-triangle", label: { en: "Warning", zh: "警告" } },
  { name: "info", label: { en: "Info", zh: "信息" } },
  { name: "help-circle", label: { en: "Question", zh: "疑问" } },
  { name: "flame", label: { en: "Flame", zh: "火焰" } },
  { name: "heart", label: { en: "Heart", zh: "爱心" } },
  { name: "coffee", label: { en: "Coffee", zh: "咖啡" } },
  { name: "map-pin", label: { en: "Location", zh: "地点" } },
  { name: "quote", label: { en: "Quote", zh: "引用" } },
];

/** Emoji offered for a page icon: the canvas's common set, then subjects
 * notes are about (books, places, work, food, nature). 48, no repeats. */
export const NOTE_EMOJI: readonly string[] = [
  ...COMMON_EMOJI,
  "📚", "📖", "🗂️", "📅", "🧠", "💼", "🏠", "✈️", "🎨", "🎵", "🌱", "🌙", "☀️", "🌊", "🔬", "🧪",
  "💻", "🛠️", "📊", "📈", "🗺️", "🎓", "🧘", "🍳", "☕", "🎁", "🐱", "🌸", "✨", "🧭", "📎", "🔖",
].filter((char, i, all) => all.indexOf(char) === i);

export type IconChoice = { kind: "lucide"; name: string } | { kind: "emoji"; char: string };

/** One emoji: a single grapheme (skin tones, flags and joiners included)
 * that is pictographic. A CJK character or a letter is not. */
export function isEmojiChar(text: string): boolean {
  return isSingleGrapheme(text) && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(text);
}

/* ---------- Callout header tokens ----------
 *
 *   > [!tip|nf-green nfi-rocket] Title     a Lucide icon from CALLOUT_ICONS
 *   > [!tip|nf-green nfi-emoji] 💡 Title    the emoji opening the title is the icon
 *
 * Other apps ignore the token; an emoji icon is ordinary title text, so the
 * note reads "💡 Title" everywhere. The colour writer replaces any token
 * starting with `nf-`, which `nfi-` does not. */

/** Byte-identical copy of main.ts RE_CALLOUT_HEAD (a test guards the
 * drift): importing it would pull main.ts into this module. */
export const CALLOUT_HEAD_RE = /^(\s*(?:>[ \t]*)+\[!)([^\]|\r\n]+)([^\]\r\n]*\])([+-]?)/;

const ICON_NAMES = new Set(CALLOUT_ICONS.map((def) => def.name));

/** The icon a header's metadata names: a Lucide icon of CALLOUT_ICONS, the
 * emoji mode, or null (none, or a name this version does not know). */
export function calloutIconFromMeta(
  metadata: readonly string[]
): { kind: "lucide"; name: string } | { kind: "emoji" } | null {
  for (const token of metadata) {
    if (token === CALLOUT_EMOJI_TOKEN) return { kind: "emoji" };
    if (token.startsWith(CALLOUT_ICON_PREFIX) && ICON_NAMES.has(token.slice(CALLOUT_ICON_PREFIX.length))) {
      return { kind: "lucide", name: token.slice(CALLOUT_ICON_PREFIX.length) };
    }
  }
  return null;
}

interface GraphemeSegmenter { segment(text: string): Iterable<{ segment: string }> }
type SegmenterCtor = new (locale?: string, options?: { granularity: string }) => GraphemeSegmenter;
let segmenter: GraphemeSegmenter | null | undefined;

/** The first user-perceived character (an emoji with its joiners, skin
 * tone or flag pair counts as one). */
function firstGrapheme(text: string): string {
  if (!text) return "";
  if (segmenter === undefined) {
    // Intl.Segmenter is newer than the ES2020 lib this builds against.
    const ctor = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
    try {
      segmenter = ctor ? new ctor(undefined, { granularity: "grapheme" }) : null;
    } catch {
      segmenter = null;
    }
  }
  if (segmenter) for (const part of segmenter.segment(text)) return part.segment;
  const first = Array.from(text)[0] ?? "";
  return text.startsWith(first + "️") ? first + "️" : first;
}

/** The title Obsidian renders for a header without one: the raw type
 * token, dashes as spaces, first letter capitalised (`my-type` → "My type"). */
function renderedDefaultTitle(rawType: string): string {
  const name = rawType.trim().replace(/-/g, " ").toLowerCase();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

interface CalloutHead {
  /** Up to and including the type token (`> [!tip`). */
  lead: string;
  rawType: string;
  tokens: string[];
  fold: string;
  /** Everything after the fold marker, verbatim. */
  rest: string;
  /** The space before the title (empty when there is none). */
  gap: string;
  title: string;
}

function readHead(line: string): CalloutHead | null {
  const m = CALLOUT_HEAD_RE.exec(line);
  if (!m) return null;
  const rest = line.slice(m[0].length);
  const gap = rest.startsWith(" ") || rest.startsWith("\t") ? rest[0] : "";
  return {
    lead: m[1] + m[2],
    rawType: m[2],
    tokens: m[3].startsWith("|") ? m[3].slice(1, -1).trim().split(/\s+/).filter(Boolean) : [],
    fold: m[4],
    rest,
    gap,
    title: rest.slice(gap.length),
  };
}

/** The emoji opening the title when the header is in emoji mode ("ours"),
 * else null: a title that merely starts with an emoji is the user's text. */
function ownEmoji(head: CalloutHead): string | null {
  if (!head.tokens.includes(CALLOUT_EMOJI_TOKEN)) return null;
  const first = firstGrapheme(head.title);
  return isEmojiChar(first) ? first : null;
}

/** The icon a Callout header line shows now, for marking the picker's
 * current cell; null for the type's own icon or a line that is no header. */
export function currentCalloutIcon(headerLine: string): IconChoice | null {
  const head = readHead(headerLine);
  if (!head) return null;
  const icon = calloutIconFromMeta(head.tokens);
  if (icon?.kind === "lucide") return icon;
  if (icon?.kind === "emoji") {
    const char = ownEmoji(head);
    return char ? { kind: "emoji", char } : null;
  }
  return null;
}

/**
 * The header line with its icon set to `choice` (null: back to the type's
 * icon), or null when the line is no Callout header. The `nfi-` token is
 * replaced in place or appended; every other token (colour, column widths)
 * stays where it is, and `|` goes when no token is left. An emoji is
 * written at the start of the title ("💡 Title"; an empty title becomes the
 * one Obsidian would render, so nothing visibly changes but the icon);
 * leaving emoji mode takes that emoji and its space out again, and drops a
 * title that is then just the rendered default.
 */
export function setCalloutIconToken(headerLine: string, choice: IconChoice | null): string | null {
  const head = readHead(headerLine);
  if (!head) return null;
  const tokens = head.tokens.slice();
  const index = tokens.findIndex((token) => token.startsWith(CALLOUT_ICON_PREFIX));
  const token = choice == null ? null : choice.kind === "emoji" ? CALLOUT_EMOJI_TOKEN : CALLOUT_ICON_PREFIX + choice.name;
  if (token == null) {
    if (index >= 0) tokens.splice(index, 1);
  } else if (index >= 0) {
    tokens[index] = token;
  } else {
    tokens.push(token);
  }

  let title = head.title;
  const own = ownEmoji(head);
  if (own) {
    title = title.slice(own.length);
    if (title.startsWith(" ")) title = title.slice(1);
  }
  const fallback = renderedDefaultTitle(head.rawType);
  if (choice?.kind === "emoji") title = `${choice.char} ${title || fallback}`;
  else if (own && title === fallback) title = "";

  const meta = tokens.length > 0 ? `|${tokens.join(" ")}` : "";
  const tail = title === head.title ? head.rest : title ? (head.gap || " ") + title : "";
  return `${head.lead}${meta}]${head.fold}${tail}`;
}

/** The cell a grid key moves to: ←/→ step one (no wrap), ↑/↓ a row (a
 * short last row lands on its last cell), Home/End the ends. Every index
 * stays inside [0, count − 1]; any other key leaves it where it is. */
export function gridMove(index: number, key: string, columns: number, count: number): number {
  if (count <= 0) return index;
  const clamp = (value: number) => Math.max(0, Math.min(count - 1, value));
  switch (key) {
    case "ArrowRight":
      return clamp(index + 1);
    case "ArrowLeft":
      return clamp(index - 1);
    case "ArrowDown":
      return clamp(index + columns);
    case "ArrowUp":
      return clamp(index - columns);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return index;
  }
}

export interface IconPickerOptions {
  /** The editor's document, so the card lands in the right (popout) window. */
  doc: Document;
  /** Where to anchor; a getter keeps the card in place while the pane scrolls. */
  anchor: DOMRect | (() => DOMRect | null);
  /** Show the Lucide grid (callouts); page icons are emoji only. */
  lucide: boolean;
  emoji: readonly string[];
  current: IconChoice | null;
  /** The Default / Remove button's text; null hides the button. */
  defaultLabel: string | null;
  placeholder: string;
  /** Recently picked emoji, shown under "Recent" and updated on an emoji pick. */
  recent?: { load(): unknown; save(list: string[]): void };
  /** The pane the card belongs to; it stays inside it (8px in). */
  bounds?: () => PopoverBox | null;
  onPick(choice: IconChoice | null): void;
  onClose?(): void;
}

/** Columns per grid: the icon grid is 6 wide (4 rows of 24), the emoji
 * grids 8. styles.css lays each grid out from `--nf-icon-cols`, so the
 * arrow keys and the drawing always agree. */
const ICON_COLUMNS = 6;
const EMOJI_COLUMNS = 8;

interface PickerGrid {
  el: HTMLElement;
  cells: HTMLButtonElement[];
  columns: number;
  /** The cell that takes focus when Tab enters the grid. */
  rover: number;
}

/**
 * The icon card. Focus starts in the search field; ↓ moves into the
 * grids, arrows walk a grid (roving tabindex), Tab / Shift+Tab step
 * between the field, each grid and the Default button, Enter or Space
 * picks, Esc closes without a change, and a click outside closes. Every
 * key it handles stops there, so arrows never reach the editor below.
 */
export class IconPicker {
  private el: HTMLDivElement | null = null;
  private input: HTMLInputElement | null = null;
  private grids: PickerGrid[] = [];
  private defaultButton: HTMLButtonElement | null = null;
  private readonly doc: Document;
  private readonly win: Window;

  constructor(private readonly options: IconPickerOptions) {
    this.doc = options.doc;
    this.win = options.doc.defaultView ?? window;
  }

  /** Close whichever icon card is open (editor teardown, mode switch). */
  static closeActive(): void {
    activePicker?.close();
  }

  get isOpen(): boolean {
    return this.el != null;
  }

  open(): void {
    activePicker?.close();
    activePicker = this;
    const { options } = this;
    const el = (this.el = this.doc.body.createDiv({ cls: "nf-icon-picker nf-pop" }));
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", t("Icon"));
    el.addEventListener("keydown", this.onKeyDown);
    const input = (this.input = el.createEl("input", {
      cls: "nf-icon-picker-input",
      type: "text",
      attr: { placeholder: options.placeholder, spellcheck: "false" },
    }));
    input.addEventListener("input", () => this.filter(input.value));
    if (options.lucide) {
      const cells: HTMLButtonElement[] = [];
      const grid = this.gridEl(ICON_COLUMNS);
      for (const def of CALLOUT_ICONS) {
        // Old Lucide aliases can vanish from Obsidian's icon set.
        if (!getIcon(def.name)) continue;
        const cell = this.cell(grid, tl(def.label), { kind: "lucide", name: def.name });
        cell.setAttribute("data-icon", def.name);
        cell.setAttribute("data-search", `${def.name} ${def.label.en} ${def.label.zh}`.toLowerCase());
        setIcon(cell, def.name);
        cells.push(cell);
      }
      this.addGrid(grid, cells, ICON_COLUMNS);
    }
    const recent = recentEmojiFrom(safeLoad(options.recent));
    if (recent.length > 0) {
      el.createDiv({ cls: "nf-icon-picker-section", text: t("Recent") });
      this.emojiGrid(recent);
    }
    this.emojiGrid(options.emoji);
    if (options.defaultLabel != null) {
      const button = (this.defaultButton = el.createEl("button", {
        cls: "nf-icon-picker-default",
        text: options.defaultLabel,
        attr: { type: "button" },
      }));
      button.addEventListener("click", () => this.pick(null));
    }
    this.doc.addEventListener("mousedown", this.onDocMouseDown, true);
    this.doc.addEventListener("scroll", this.onReposition, true);
    this.win.addEventListener("resize", this.onReposition);
    this.position();
    input.focus();
  }

  private gridEl(columns: number): HTMLElement {
    const grid = this.el!.createDiv({ cls: "nf-icon-picker-grid" });
    grid.setAttribute("role", "grid");
    grid.style.setProperty("--nf-icon-cols", String(columns));
    return grid;
  }

  private emojiGrid(chars: readonly string[]) {
    const grid = this.gridEl(EMOJI_COLUMNS);
    const cells = chars.map((char) => {
      const cell = this.cell(grid, char, { kind: "emoji", char });
      cell.setAttribute("data-emoji", char);
      cell.setText(char);
      return cell;
    });
    this.addGrid(grid, cells, EMOJI_COLUMNS);
  }

  private cell(grid: HTMLElement, label: string, choice: IconChoice): HTMLButtonElement {
    const cell = grid.createEl("button", { cls: "nf-icon-picker-cell", attr: { type: "button", "aria-label": label } });
    const active = sameChoice(this.options.current, choice);
    cell.toggleClass("is-active", active);
    cell.setAttribute("aria-pressed", active ? "true" : "false");
    cell.tabIndex = -1;
    cell.addEventListener("click", () => this.pick(choice));
    return cell;
  }

  private addGrid(el: HTMLElement, cells: HTMLButtonElement[], columns: number) {
    if (cells.length === 0) {
      el.remove();
      return;
    }
    const current = cells.findIndex((cell) => cell.hasClass("is-active"));
    const grid: PickerGrid = { el, cells, columns, rover: Math.max(0, current) };
    cells[grid.rover].tabIndex = 0;
    this.grids.push(grid);
  }

  /** Letters narrow the icon grid by name and by both labels; an emoji
   * (or nothing) shows everything. The emoji grids have no names. */
  private filter(query: string) {
    const q = query.trim().toLowerCase();
    const byName = q !== "" && !isEmojiChar(query.trim());
    for (const grid of this.grids) {
      for (const cell of grid.cells) {
        const search = cell.getAttribute("data-search");
        if (search != null) setHidden(cell, byName && !search.includes(q));
      }
      const shown = this.visible(grid);
      if (shown.length > 0 && !shown.includes(grid.cells[grid.rover])) this.setRover(grid, grid.cells.indexOf(shown[0]));
      setHidden(grid.el, shown.length === 0);
    }
    this.position();
  }

  private visible(grid: PickerGrid): HTMLButtonElement[] {
    return grid.cells.filter((cell) => !cell.hidden);
  }

  private setRover(grid: PickerGrid, index: number) {
    grid.cells[grid.rover].tabIndex = -1;
    grid.rover = index;
    grid.cells[index].tabIndex = 0;
  }

  private focusCell(grid: PickerGrid, index: number) {
    this.setRover(grid, index);
    grid.cells[index].focus();
  }

  /** The grids that still show a cell, in reading order. */
  private liveGrids(): PickerGrid[] {
    return this.grids.filter((grid) => this.visible(grid).length > 0);
  }

  /** The focus stops Tab walks: the field, each grid's roving cell, then
   * the Default button. */
  private stops(): HTMLElement[] {
    const stops: HTMLElement[] = [];
    if (this.input) stops.push(this.input);
    for (const grid of this.liveGrids()) stops.push(grid.cells[grid.rover]);
    if (this.defaultButton) stops.push(this.defaultButton);
    return stops;
  }

  private gridOf(target: EventTarget | null): PickerGrid | null {
    return this.grids.find((grid) => grid.cells.includes(target as HTMLButtonElement)) ?? null;
  }

  private onKeyDown = (evt: KeyboardEvent) => {
    // An IME composition owns every key while it is open.
    if (evt.isComposing || evt.keyCode === 229) return;
    const handled = this.handleKey(evt);
    if (handled) {
      evt.preventDefault();
      evt.stopPropagation();
    }
  };

  private handleKey(evt: KeyboardEvent): boolean {
    const target = evt.target;
    if (evt.key === "Escape") {
      this.close();
      return true;
    }
    if (evt.key === "Tab" && !evt.metaKey && !evt.ctrlKey && !evt.altKey) {
      const stops = this.stops();
      if (stops.length === 0) return true;
      const grid = this.gridOf(target);
      const at = grid ? stops.indexOf(grid.cells[grid.rover]) : stops.indexOf(target as HTMLElement);
      const next = (Math.max(0, at) + (evt.shiftKey ? stops.length - 1 : 1)) % stops.length;
      stops[next].focus();
      return true;
    }
    if (target === this.input) return this.handleInputKey(evt);
    const grid = this.gridOf(target);
    if (!grid) return false;
    if (evt.key === "Enter" || evt.key === " ") {
      (target as HTMLButtonElement).click();
      return true;
    }
    const shown = this.visible(grid);
    const at = shown.indexOf(target as HTMLButtonElement);
    if (at < 0) return false;
    if (evt.key === "ArrowUp" && at < grid.columns) {
      // From a grid's first row: the grid above, else back to the field.
      const above = this.liveGrids()[this.liveGrids().indexOf(grid) - 1];
      if (above) {
        const cells = this.visible(above);
        const lastRow = Math.floor((cells.length - 1) / above.columns) * above.columns;
        const cell = cells[Math.min(cells.length - 1, lastRow + Math.min(at, above.columns - 1))];
        this.focusCell(above, above.cells.indexOf(cell));
      } else this.input?.focus();
      return true;
    }
    if (evt.key === "ArrowDown" && Math.floor(at / grid.columns) === Math.floor((shown.length - 1) / grid.columns)) {
      // From a grid's last row: on into the next grid.
      const below = this.liveGrids()[this.liveGrids().indexOf(grid) + 1];
      if (below) {
        const cells = this.visible(below);
        this.focusCell(below, below.cells.indexOf(cells[Math.min(cells.length - 1, at % grid.columns)]));
        return true;
      }
    }
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(evt.key)) return false;
    const next = gridMove(at, evt.key, grid.columns, shown.length);
    this.focusCell(grid, grid.cells.indexOf(shown[next]));
    return true;
  }

  private handleInputKey(evt: KeyboardEvent): boolean {
    const input = this.input!;
    if (evt.key === "ArrowDown") {
      const grids = this.liveGrids();
      const current = grids.find((grid) => grid.cells[grid.rover].hasClass("is-active") && !grid.cells[grid.rover].hidden);
      const grid = current ?? grids[0];
      if (grid) this.focusCell(grid, current ? grid.rover : grid.cells.indexOf(this.visible(grid)[0]));
      return true;
    }
    if (evt.key === "Enter") {
      const typed = input.value.trim();
      if (isEmojiChar(typed)) {
        this.pick({ kind: "emoji", char: typed });
        return true;
      }
      if (typed) {
        // Enter with a filter picks the first icon still showing (the
        // emoji grids have no names, so they never answer a search).
        const icons = this.liveGrids().find((grid) => grid.cells[0].hasAttribute("data-search"));
        if (icons) this.visible(icons)[0].click();
      }
      return true;
    }
    return false;
  }

  private pick(choice: IconChoice | null) {
    const { options } = this;
    if (choice?.kind === "emoji" && options.recent) {
      try {
        options.recent.save(rememberEmoji(recentEmojiFrom(safeLoad(options.recent)), choice.char));
      } catch (error) {
        console.error("Notion Flow: saving recent emoji failed", error);
      }
    }
    // Write first, then close (onClose refocuses the editor).
    try {
      options.onPick(choice);
    } finally {
      this.close();
    }
  }

  private onDocMouseDown = (evt: MouseEvent) => {
    if (this.el && evt.composedPath().includes(this.el)) return;
    this.close();
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
    el.setAttribute("data-placement", below ? "below" : "above");
    el.style.left = left + "px";
    el.style.top = top + "px";
  }

  close(): void {
    const el = this.el;
    if (!el) return;
    if (activePicker === this) activePicker = null;
    this.doc.removeEventListener("mousedown", this.onDocMouseDown, true);
    this.doc.removeEventListener("scroll", this.onReposition, true);
    this.win.removeEventListener("resize", this.onReposition);
    el.remove();
    this.el = null;
    this.input = null;
    this.grids = [];
    this.defaultButton = null;
    try {
      this.options.onClose?.();
    } catch (error) {
      console.error("Notion Flow: closing the icon picker failed", error);
    }
  }
}

/** Hidden for the keys (the `hidden` flag) and for the eye: an inline
 * display wins over a stylesheet's `display: flex` on the cell. */
function setHidden(el: HTMLElement, hidden: boolean) {
  el.hidden = hidden;
  el.style.display = hidden ? "none" : "";
}

function safeLoad(recent: IconPickerOptions["recent"]): unknown {
  try {
    return recent?.load();
  } catch {
    return null;
  }
}

function sameChoice(a: IconChoice | null, b: IconChoice): boolean {
  if (!a || a.kind !== b.kind) return false;
  return a.kind === "lucide" ? a.name === (b as { name: string }).name : a.char === (b as { char: string }).char;
}

let activePicker: IconPicker | null = null;

/** Open the icon card (closing any other) and return it. */
export function openIconPicker(options: IconPickerOptions): IconPicker {
  const picker = new IconPicker(options);
  picker.open();
  return picker;
}
