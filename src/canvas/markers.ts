import { setIcon } from "obsidian";
import { t } from "../i18n";
import { orderedChildren } from "./graph";
import type { CanvasData, CanvasNodeData, Forest } from "./graph";

/** A card's markers: small icons at its corner, as in mind-map apps. */
export const MARKERS_KEY = "nfMarkers";
/** Stored on a map's root: every topic shows its number (1, 1.2, 1.2.3). */
export const NUMBERING_KEY = "nfNumbering";

export type MarkerGroup = "priority" | "status" | "flag" | "symbol";

export interface Marker {
  id: string;
  group: MarkerGroup;
  /** Shown in the picker and read by screen readers. */
  label: string;
  color: string;
  /** A Lucide icon, or `text` for markers that show a character. */
  icon?: string;
  text?: string;
}

export const MARKER_GROUPS: readonly [MarkerGroup, string][] = [
  ["priority", "Priority"], ["status", "Status"], ["flag", "Flags"], ["symbol", "Symbols"],
];

const RED = "#E5484D";
const ORANGE = "#F76B15";
const AMBER = "#D9A300";
const GREEN = "#30A46C";
const BLUE = "#0090FF";
const INDIGO = "#3E63DD";
const VIOLET = "#7C5CD6";
const PINK = "#E93D82";
const TEAL = "#12A594";
const GREY = "#8B8D98";

/**
 * The catalogue. Priorities are exclusive (a topic has one); everything
 * else stacks. Colors are chosen to read on light and dark canvases.
 */
export const MARKERS: readonly Marker[] = [
  { id: "p1", group: "priority", label: "Priority 1", text: "1", color: RED },
  { id: "p2", group: "priority", label: "Priority 2", text: "2", color: ORANGE },
  { id: "p3", group: "priority", label: "Priority 3", text: "3", color: AMBER },
  { id: "p4", group: "priority", label: "Priority 4", text: "4", color: INDIGO },
  { id: "p5", group: "priority", label: "Priority 5", text: "5", color: GREY },
  { id: "done", group: "status", label: "Done", icon: "check", color: GREEN },
  { id: "doing", group: "status", label: "In progress", icon: "clock", color: BLUE },
  { id: "blocked", group: "status", label: "Blocked", icon: "x", color: RED },
  { id: "warning", group: "status", label: "Attention", icon: "triangle-alert", color: ORANGE },
  { id: "question", group: "status", label: "Question", icon: "circle-help", color: VIOLET },
  { id: "idea", group: "status", label: "Idea", icon: "lightbulb", color: AMBER },
  { id: "flag-red", group: "flag", label: "Red flag", icon: "flag", color: RED },
  { id: "flag-orange", group: "flag", label: "Orange flag", icon: "flag", color: ORANGE },
  { id: "flag-yellow", group: "flag", label: "Yellow flag", icon: "flag", color: AMBER },
  { id: "flag-green", group: "flag", label: "Green flag", icon: "flag", color: GREEN },
  { id: "flag-blue", group: "flag", label: "Blue flag", icon: "flag", color: BLUE },
  { id: "flag-purple", group: "flag", label: "Purple flag", icon: "flag", color: VIOLET },
  { id: "star", group: "symbol", label: "Star", icon: "star", color: AMBER },
  { id: "heart", group: "symbol", label: "Heart", icon: "heart", color: PINK },
  { id: "pin", group: "symbol", label: "Pin", icon: "pin", color: RED },
  { id: "fire", group: "symbol", label: "Hot", icon: "flame", color: ORANGE },
  { id: "bolt", group: "symbol", label: "Quick win", icon: "zap", color: AMBER },
  { id: "rocket", group: "symbol", label: "Launch", icon: "rocket", color: VIOLET },
  { id: "target", group: "symbol", label: "Goal", icon: "target", color: TEAL },
  { id: "bookmark", group: "symbol", label: "Bookmark", icon: "bookmark", color: BLUE },
  { id: "like", group: "symbol", label: "Like", icon: "thumbs-up", color: GREEN },
  { id: "smile", group: "symbol", label: "Smile", icon: "smile", color: AMBER },
];

const BY_ID = new Map(MARKERS.map((marker) => [marker.id, marker]));

/** Emoji markers: any one emoji, stored as `emoji:` followed by the character. */
export const EMOJI_PREFIX = "emoji:";
/** A card shows at most this many emoji. */
export const EMOJI_LIMIT = 3;
/** An emoji with its skin tone, flag pair or joiners is a few code units; anything longer is text. */
const EMOJI_MAX_LENGTH = 8;
/** Emoji offered without typing: reactions, states, and a few pointers. */
export const COMMON_EMOJI: readonly string[] = [
  "👍", "❤️", "🔥", "⭐", "✅", "❌", "⚠️", "💡", "❓", "📌", "🎯", "🚀", "📝", "💬", "⏰", "🏆",
];
export const RECENT_EMOJI_LIMIT = 12;
/** The `app.saveLocalStorage` key of the emoji used most recently. */
export const RECENT_EMOJI_KEY = "nf-canvas-emoji-recent";

interface GraphemeSegmenter { segment(text: string): Iterable<unknown> }
type SegmenterCtor = new (locale?: string, options?: { granularity: string }) => GraphemeSegmenter;
// Intl.Segmenter counts user-perceived characters; the ES2020 lib predates it.
const segmenter: GraphemeSegmenter | null = (() => {
  const ctor = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  try {
    return ctor ? new ctor(undefined, { granularity: "grapheme" }) : null;
  } catch {
    return null;
  }
})();

/** Whether the text is one user-perceived character, as an emoji with its skin tone, flag pair or joiners is. */
export function isSingleGrapheme(text: string): boolean {
  if (!text || text.length > EMOJI_MAX_LENGTH || /\s/.test(text)) return false;
  if (!segmenter) return Array.from(text).length <= 3;
  const parts = segmenter.segment(text)[Symbol.iterator]();
  return !parts.next().done && !!parts.next().done;
}

export function isEmojiId(id: string): boolean {
  return id.startsWith(EMOJI_PREFIX) && isSingleGrapheme(id.slice(EMOJI_PREFIX.length));
}

/** Whether an id names a marker: one of the catalogue, or an emoji. */
export function isMarkerId(id: string): boolean {
  return BY_ID.has(id) || isEmojiId(id);
}

/** The marker id for typed text, or null unless it is one emoji; a stray letter or digit is not. */
export function emojiMarkerId(text: string): string | null {
  const char = text.trim();
  if (!isSingleGrapheme(char) || /^[\x20-\x7e]$/.test(char)) return null;
  return EMOJI_PREFIX + char;
}

/** The character an emoji marker shows. */
export function emojiOf(id: string): string {
  return id.slice(EMOJI_PREFIX.length);
}

/** The recents with `char` first, without repeats, capped. */
export function rememberEmoji(recent: readonly string[], char: string): string[] {
  return [char, ...recent.filter((item) => item !== char)].slice(0, RECENT_EMOJI_LIMIT);
}

/** A stored recents list as a clean list of emoji; anything else reads as none. */
export function recentEmojiFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const clean: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && isSingleGrapheme(item) && !clean.includes(item)) clean.push(item);
  }
  return clean.slice(0, RECENT_EMOJI_LIMIT);
}

/** An emoji marker is made up from its id: the character is its face and its name. */
function emojiMarker(id: string): Marker {
  const char = emojiOf(id);
  return { id, group: "symbol", label: char, text: char, color: "transparent" };
}

export function markerById(id: string): Marker | undefined {
  return BY_ID.get(id) ?? (isEmojiId(id) ? emojiMarker(id) : undefined);
}

/** The markers a card carries, in the order they were added; unknown ids are dropped. */
export function markersOf(node: { [key: string]: unknown } | undefined): string[] {
  const value = node?.[MARKERS_KEY];
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !isMarkerId(item) || seen.has(item)) continue;
    seen.add(item);
    ids.push(item);
  }
  return ids;
}

/**
 * Add or remove a marker. Priorities replace one another, so a topic never
 * carries two priorities; a card keeps at most three emoji, so a fourth is
 * refused; any other marker simply toggles.
 */
export function toggleMarker(current: readonly string[], id: string): string[] {
  const marker = markerById(id);
  if (!marker) return [...current];
  if (current.includes(id)) return current.filter((item) => item !== id);
  if (isEmojiId(id) && current.filter(isEmojiId).length >= EMOJI_LIMIT) return [...current];
  const kept = marker.group === "priority"
    ? current.filter((item) => BY_ID.get(item)?.group !== "priority") : [...current];
  return [...kept, id];
}

/** The node as it should be saved with these markers; none removes the field. */
export function withMarkers(node: CanvasNodeData, markers: readonly string[]): CanvasNodeData {
  const next = { ...node };
  if (markers.length) next[MARKERS_KEY] = [...markers];
  else delete next[MARKERS_KEY];
  return next;
}

export function hasNumbering(node: { [key: string]: unknown } | undefined): boolean {
  return node?.[NUMBERING_KEY] === true;
}

/**
 * Topic numbers for the maps whose roots number their branches: main
 * branches count 1, 2, 3 and their children 1.1, 1.2, in reading order.
 * Roots carry no number. Numbers are display-only, never written.
 */
export function topicNumbers(data: CanvasData, forest: Forest): Map<string, string> {
  const numbers = new Map<string, string>();
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  for (const rootId of forest.roots) {
    if (!hasNumbering(byId.get(rootId))) continue;
    const pending: [string, string][] = [[rootId, ""]];
    while (pending.length) {
      const [id, prefix] = pending.shift()!;
      orderedChildren(data, forest, id).forEach((child, index) => {
        const number = prefix ? `${prefix}.${index + 1}` : String(index + 1);
        numbers.set(child, number);
        pending.push([child, number]);
      });
    }
  }
  return numbers;
}

/** A marker drawn as a small round badge; the same element serves cards and the picker. */
export function markerBadge(doc: Document, marker: Marker): HTMLElement {
  const badge = doc.createElement("span");
  badge.className = "nf-canvas-marker";
  badge.dataset.marker = marker.id;
  badge.style.setProperty("--nf-marker", marker.color);
  if (marker.text) {
    badge.textContent = marker.text;
    badge.classList.add("is-text");
    // An emoji is its own badge: no colored disc behind it.
    if (isEmojiId(marker.id)) badge.classList.add("is-emoji");
  } else if (marker.icon) {
    setIcon(badge, marker.icon);
    badge.classList.add(`is-${marker.icon}`);
  }
  badge.setAttribute("aria-label", t(marker.label));
  return badge;
}

export interface MarkerPanelHost {
  /** Markers on every selected card, on some of them, and how many cards are selected. */
  state(): { all: Set<string>; some: Set<string>; count: number };
  toggle(id: string): void;
  clear(): void;
  close(): void;
  /** Where the emoji used lately are kept between sessions; without it the panel forgets them. */
  recentEmoji?: { load(): unknown; save(ids: string[]): void };
}

/**
 * The marker picker: a small popover with the catalogue in groups. Clicking
 * a marker adds it to, or removes it from, every selected card; the panel
 * stays open so several can be set at once.
 */
export class MarkerPanel {
  readonly el: HTMLElement;
  private options = new Map<string, HTMLButtonElement>();
  /** The common emoji, and the recents row, which is rebuilt as it changes. */
  private emojiOptions = new Map<string, HTMLButtonElement>();
  private recentOptions = new Map<string, HTMLButtonElement>();
  private emojiInput: HTMLInputElement;
  private recentRow: HTMLElement;
  private recentGrid: HTMLElement;
  private recentKey = "";
  private recent: string[];
  private clearButton: HTMLButtonElement;
  private empty: HTMLElement;
  private body: HTMLElement;

  constructor(doc: Document, private host: MarkerPanelHost) {
    this.recent = recentEmojiFrom(host.recentEmoji?.load());
    const el = this.el = doc.createElement("div");
    el.className = "nf-canvas-marker-panel nf-canvas-ui";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", t("Markers"));
    for (const name of ["pointerdown", "mousedown", "dblclick", "wheel", "contextmenu", "click"]) {
      el.addEventListener(name, (evt) => evt.stopPropagation());
    }
    // Clicking a marker keeps the keyboard with the canvas and its selection.
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
    title.textContent = t("Markers");
    this.clearButton = doc.createElement("button");
    this.clearButton.type = "button";
    this.clearButton.className = "nf-canvas-marker-clear";
    this.clearButton.textContent = t("Clear");
    this.clearButton.addEventListener("click", () => this.host.clear());
    const close = doc.createElement("button");
    close.type = "button";
    close.className = "clickable-icon nf-canvas-marker-close";
    close.setAttribute("aria-label", t("Close"));
    setIcon(close, "x");
    close.addEventListener("click", () => this.host.close());
    head.append(title, this.clearButton, close);

    this.empty = doc.createElement("div");
    this.empty.className = "nf-canvas-marker-empty";
    this.empty.textContent = t("Select one or more cards to mark them.");

    this.body = doc.createElement("div");
    this.body.className = "nf-canvas-marker-body";
    for (const [group, label] of MARKER_GROUPS) {
      const members = MARKERS.filter((marker) => marker.group === group);
      if (!members.length) continue;
      const heading = doc.createElement("div");
      heading.className = "nf-canvas-marker-group";
      heading.textContent = t(label);
      const grid = doc.createElement("div");
      grid.className = "nf-canvas-marker-grid";
      for (const marker of members) {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "nf-canvas-marker-option";
        button.dataset.marker = marker.id;
        button.setAttribute("aria-pressed", "false");
        button.setAttribute("aria-label", t(marker.label));
        button.append(markerBadge(doc, marker));
        button.addEventListener("click", () => this.host.toggle(marker.id));
        this.options.set(marker.id, button);
        grid.append(button);
      }
      this.body.append(heading, grid);
    }

    // Emoji come last: any one typed, the ones used lately, and a common set.
    const emojiHeading = doc.createElement("div");
    emojiHeading.className = "nf-canvas-marker-group";
    emojiHeading.textContent = t("Emoji");
    const entry = doc.createElement("div");
    entry.className = "nf-canvas-emoji-entry";
    this.emojiInput = doc.createElement("input");
    this.emojiInput.type = "text";
    this.emojiInput.className = "nf-canvas-emoji-input";
    this.emojiInput.maxLength = EMOJI_MAX_LENGTH;
    this.emojiInput.placeholder = t("Type an emoji");
    this.emojiInput.setAttribute("aria-label", t("Type an emoji"));
    this.emojiInput.autocomplete = "off";
    this.emojiInput.spellcheck = false;
    this.emojiInput.addEventListener("input", (evt) => {
      if ((evt as InputEvent).isComposing) return;
      this.takeTyped(false);
    });
    this.emojiInput.addEventListener("keydown", (evt) => {
      if (evt.key !== "Enter" || evt.isComposing) return;
      evt.preventDefault();
      evt.stopPropagation();
      this.takeTyped(true);
    });
    entry.append(this.emojiInput);
    this.recentRow = doc.createElement("div");
    this.recentRow.className = "nf-canvas-emoji-recent is-empty";
    this.recentRow.hidden = true;
    const recentLabel = doc.createElement("div");
    recentLabel.className = "nf-canvas-emoji-label";
    recentLabel.textContent = t("Recent");
    this.recentGrid = doc.createElement("div");
    this.recentGrid.className = "nf-canvas-marker-grid nf-canvas-emoji-grid";
    this.recentRow.append(recentLabel, this.recentGrid);
    const common = doc.createElement("div");
    common.className = "nf-canvas-marker-grid nf-canvas-emoji-grid";
    for (const char of COMMON_EMOJI) common.append(this.emojiButton(doc, char, this.emojiOptions));
    this.body.append(emojiHeading, entry, this.recentRow, common);

    el.append(head, this.empty, this.body);
    this.sync();
  }

  private emojiButton(doc: Document, char: string, options: Map<string, HTMLButtonElement>): HTMLButtonElement {
    const id = EMOJI_PREFIX + char;
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "nf-canvas-emoji-option";
    button.dataset.marker = id;
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", char);
    button.append(markerBadge(doc, emojiMarker(id)));
    button.addEventListener("click", () => this.useEmoji(id));
    options.set(id, button);
    return button;
  }

  /** A typed emoji goes on the selection at once, and the field clears for the next. */
  private takeTyped(entered: boolean) {
    const typed = this.emojiInput.value;
    const id = emojiMarkerId(typed);
    if (!id) {
      // Half-typed text is left alone; Enter on it says it is not an emoji.
      this.emojiInput.classList.toggle("is-invalid", entered && !!typed.trim());
      return;
    }
    this.emojiInput.value = "";
    this.emojiInput.classList.remove("is-invalid");
    this.useEmoji(id);
  }

  private useEmoji(id: string) {
    this.recent = rememberEmoji(this.recent, emojiOf(id));
    this.host.recentEmoji?.save(this.recent);
    this.host.toggle(id);
    // A refused fourth emoji changes no card, so the host may not render; the row still moves.
    this.sync();
  }

  /** Show which markers the selection carries; called after every canvas render. */
  sync() {
    const state = this.host.state();
    const active = state.count > 0;
    this.el.classList.toggle("is-empty", !active);
    this.body.inert = !active;
    this.clearButton.disabled = !active || state.some.size === 0;
    this.syncRecent(state.some);
    for (const options of [this.options, this.emojiOptions, this.recentOptions]) {
      for (const [id, button] of options) {
        const pressed = state.all.has(id) ? "true" : state.some.has(id) ? "mixed" : "false";
        if (button.getAttribute("aria-pressed") !== pressed) button.setAttribute("aria-pressed", pressed);
      }
    }
  }

  /**
   * The recents row: the emoji used here lately, led by any on the selection
   * that the common set lacks, so every emoji a card carries can be taken off.
   */
  private syncRecent(some: ReadonlySet<string>) {
    const shown: string[] = [];
    for (const id of some) {
      const char = isEmojiId(id) ? emojiOf(id) : "";
      if (char && !COMMON_EMOJI.includes(char) && !shown.includes(char)) shown.push(char);
    }
    for (const char of this.recent) if (!shown.includes(char)) shown.push(char);
    const list = shown.slice(0, RECENT_EMOJI_LIMIT);
    const key = list.join("\n");
    if (key === this.recentKey) return;
    this.recentKey = key;
    this.recentOptions.clear();
    const doc = this.el.ownerDocument;
    this.recentGrid.replaceChildren(...list.map((char) => this.emojiButton(doc, char, this.recentOptions)));
    this.recentRow.hidden = !list.length;
    this.recentRow.classList.toggle("is-empty", !list.length);
  }

  destroy() {
    this.el.remove();
  }
}
