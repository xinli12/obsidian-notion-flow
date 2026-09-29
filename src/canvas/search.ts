import { FuzzySuggestModal, setIcon } from "obsidian";
import type { App, FuzzyMatch, TFile } from "obsidian";
import { t } from "../i18n";
import type { CanvasNodeData } from "./graph";

/** A card as one line of plain text, for finding and naming it. */
export function cardLabel(node: CanvasNodeData): string {
  switch (node.type) {
    case "text": return plainText(typeof node.text === "string" ? node.text : "");
    case "file": {
      const file = typeof node.file === "string" ? node.file : "";
      const name = file.split("/").pop() ?? file;
      const subpath = typeof node.subpath === "string" ? node.subpath.replace(/^#\^?/, " › ") : "";
      return `${name.replace(/\.md$/i, "")}${subpath}`;
    }
    case "link": return typeof node.url === "string" ? node.url : "";
    case "group": return typeof node.label === "string" ? node.label.trim() : "";
    default: return "";
  }
}

/** A card's name: the words of its first line, kept short. */
export function cardTitle(node: CanvasNodeData, max = 48): string {
  const line = node.type === "text"
    ? String(node.text ?? "").split("\n").find((text) => text.trim()) ?? "" : "";
  const label = line ? plainText(line) : cardLabel(node);
  return label.length > max ? `${label.slice(0, max)}…` : label;
}

/** Markdown reduced to the words a reader sees. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/^(?:---\n[\s\S]*?\n---\n)/, "")
    .replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
    .replace(/!\[\[([^\]|#]+)(?:[^\]]*)\]\]/g, (_, target: string) => target.split("/").pop() ?? target)
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, (_, target: string) => (target.split("/").pop() ?? target).replace(/#\^?/, " › "))
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+\[[ xX]\][ \t]+|[-*+][ \t]+|\d{1,9}[.)][ \t]+)/gm, "")
    .replace(/(\*\*|~~|==|\*|`)(?=\S)([\s\S]*?\S)\1/g, "$2")
    // Underscores emphasise only at word edges: snake_case stays.
    .replace(/(?<!\w)(__?)(?=\S)([\s\S]*?\S)\1(?!\w)/g, "$2")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The cards whose words contain the query, folded ones included, in reading
 * order: top to bottom, then left to right. Canvas keeps its nodes in
 * z-order, which changes with every selection, so the order is by position.
 */
export function findCards(nodes: CanvasNodeData[], query: string, label: (node: CanvasNodeData) => string = cardLabel): string[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const hits: CanvasNodeData[] = [];
  for (const node of nodes) {
    if (label(node).toLocaleLowerCase().includes(needle)) hits.push(node);
  }
  hits.sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return hits.map((node) => node.id);
}

export interface FindBarHost {
  /** The words changed; the first match is shown. */
  search(query: string): void;
  /** Walk to the next match, or the one before. */
  step(delta: 1 | -1): void;
  close(): void;
}

export interface FindBarState {
  query: string;
  total: number;
  /** The current match's place among them, from 1; 0 while none is current. */
  index: number;
  /** How many matches lie in folded branches. */
  folded: number;
}

/**
 * A bar over the canvas that finds cards by their words as they are typed:
 * Enter and Shift+Enter walk the matches, Escape puts it away. What the
 * host does with a match (light it up, unfold, frame) stays with the host.
 */
export class FindBar {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  private count: HTMLElement;
  private previous: HTMLButtonElement;
  private next: HTMLButtonElement;

  constructor(doc: Document, host: FindBarHost) {
    const el = this.el = doc.createElement("div");
    el.className = "nf-canvas-find nf-canvas-ui";
    el.setAttribute("role", "search");
    el.setAttribute("aria-label", t("Find in map"));
    for (const name of ["pointerdown", "mousedown", "dblclick", "wheel", "contextmenu", "click"]) {
      el.addEventListener(name, (evt) => evt.stopPropagation());
    }
    // The buttons leave the keyboard in the box, so Enter keeps walking.
    el.addEventListener("mousedown", (evt) => {
      if ((evt.target as Element).closest?.("button")) evt.preventDefault();
    });
    el.addEventListener("keydown", (evt) => {
      if (evt.isComposing) return;
      if (evt.key === "Escape") host.close();
      else if (evt.key === "Enter") host.step(evt.shiftKey ? -1 : 1);
      else return;
      evt.preventDefault();
      evt.stopPropagation();
    });
    const icon = doc.createElement("span");
    icon.className = "nf-canvas-find-icon";
    icon.setAttribute("aria-hidden", "true");
    setIcon(icon, "search");
    const input = this.input = doc.createElement("input");
    input.type = "text";
    input.className = "nf-canvas-find-input";
    input.placeholder = t("Find in map");
    input.setAttribute("aria-label", t("Find in map"));
    input.autocomplete = "off";
    input.spellcheck = false;
    input.addEventListener("input", (evt) => {
      if ((evt as InputEvent).isComposing) return;
      host.search(input.value);
    });
    input.addEventListener("compositionend", () => host.search(input.value));
    this.count = doc.createElement("span");
    this.count.className = "nf-canvas-find-count";
    this.count.setAttribute("aria-live", "polite");
    this.previous = this.button(doc, "nf-canvas-find-previous", "chevron-up", t("Previous match"), () => host.step(-1));
    this.next = this.button(doc, "nf-canvas-find-next", "chevron-down", t("Next match"), () => host.step(1));
    const close = this.button(doc, "nf-canvas-find-close", "x", t("Close"), () => host.close());
    el.append(icon, input, this.count, this.previous, this.next, close);
  }

  private button(doc: Document, cls: string, icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = `clickable-icon ${cls}`;
    button.setAttribute("aria-label", label);
    setIcon(button, icon);
    button.addEventListener("click", onClick);
    return button;
  }

  /** Bring the keyboard to the box; `select` offers its words for replacing. */
  focus(select = false) {
    this.input.focus();
    if (select && typeof this.input.select === "function") this.input.select();
  }

  /** Show where the walk stands, touching the DOM only on change. */
  sync(state: FindBarState) {
    const typed = state.query.trim().length > 0;
    let text = "";
    if (typed) {
      text = t("{n} of {total}").replace("{n}", String(state.index)).replace("{total}", String(state.total));
      if (state.folded) text += ` · ${t("{k} folded").replace("{k}", String(state.folded))}`;
    }
    if (this.count.textContent !== text) this.count.textContent = text;
    const none = state.total === 0;
    for (const button of [this.previous, this.next]) {
      if (button.disabled !== none) button.disabled = none;
    }
    const missing = typed && none;
    if (this.el.classList.contains("is-missing") !== missing) this.el.classList.toggle("is-missing", missing);
  }

  destroy() {
    this.el.remove();
  }
}

export interface CardHit {
  id: string;
  label: string;
  /** Where the card sits: its map's central topic, or its group. */
  context: string;
  hidden: boolean;
}

/** Find any card by its words; hidden (folded) cards are found too. */
export class CardSearchModal extends FuzzySuggestModal<CardHit> {
  constructor(app: App, private hits: CardHit[], private choose: (hit: CardHit) => void, placeholder: string) {
    super(app);
    this.setPlaceholder(placeholder);
    this.limit = 50;
  }

  getItems(): CardHit[] {
    return this.hits;
  }

  getItemText(hit: CardHit): string {
    return hit.label;
  }

  renderSuggestion(match: FuzzyMatch<CardHit>, el: HTMLElement) {
    super.renderSuggestion(match, el);
    el.addClass("nf-canvas-search-item");
    if (match.item.context) el.createDiv({ cls: "nf-canvas-search-context", text: match.item.context });
  }

  onChooseItem(hit: CardHit) {
    this.choose(hit);
  }
}

/** Pick a Markdown note to grow a mind map from. */
export class NotePickerModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private choose: (file: TFile) => void, placeholder: string) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles().sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  getItemText(file: TFile): string {
    return file.path.replace(/\.md$/i, "");
  }

  onChooseItem(file: TFile) {
    this.choose(file);
  }
}
