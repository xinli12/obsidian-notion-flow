import { SuggestModal, prepareFuzzySearch, setIcon } from "obsidian";
import type { App, TFile } from "obsidian";
import { t } from "../i18n";
import { rankLinkTargets } from "../ui/link-popover";
import { cardLinkValue, cardRefOf, noteLinkValue, webAddress } from "./attachments";

/** A card the link can lead to: its name, and its map or group. */
export interface LinkableCard {
  id: string;
  title: string;
  context: string;
}

/**
 * `file` is a note; `attachment` any other file, such as a canvas, a PDF or
 * an image. `keep` is the link being edited, left as it is; `edit` is one
 * of the card's links, offered for editing while another is being added.
 */
export type LinkChoiceKind = "url" | "file" | "attachment" | "heading" | "card" | "new" | "keep" | "edit" | "remove";

/** One line of the picker; `value` is the link as stored, null to remove it. */
export interface LinkChoice {
  kind: LinkChoiceKind;
  value: string | null;
  title: string;
  detail: string;
  /** The card links there already, so choosing it adds nothing. */
  linked?: boolean;
}

type Fuzzy = (query: string) => (text: string) => { score: number } | null;

/** What the picker offers, from the vault and the canvas; a seam for tests. */
export interface LinkSources<F extends { path: string; basename: string; extension: string }> {
  files: readonly F[];
  /** Paths of the files opened lately, newest first. */
  recent: readonly string[];
  cards: readonly LinkableCard[];
  /** The shortest link text that reaches the file from the canvas. */
  linktext(file: F): string;
  headings(file: F): readonly { heading: string }[];
  /** The link being edited, as stored, and its name; null while a link is being added. */
  current: string | null;
  currentLabel: string;
  /** The card's links now, as stored, with their names. */
  links?: readonly { value: string; label: string }[];
  fuzzy?: Fuzzy;
}

const RECENT_FILES = 5;
const FIRST_CARDS = 8;
const MATCHED_FILES = 6;
const MATCHED_CARDS = 6;
const MATCHED_HEADINGS = 8;

function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash > 0 ? path.slice(0, slash) : "";
}

/**
 * The picker's lines for what is typed. Nothing typed: the link being
 * edited, or while one is added the card's links (to edit one), then the
 * notes opened lately and the canvas's first cards. A web address: that
 * page first. A name: matching notes, then matching cards, then a new
 * note of that name; `Note#` looks for headings in the matching notes, and
 * `#^id` (as a card's words link a card) finds that card. What the card
 * links already is marked. A link being edited can always be removed,
 * from the last line.
 */
export function linkChoices<F extends { path: string; basename: string; extension: string }>(query: string, sources: LinkSources<F>): LinkChoice[] {
  const fuzzy = sources.fuzzy ?? (prepareFuzzySearch as Fuzzy);
  const q = query.trim().replace(/^!?\[\[/, "").replace(/\]\]$/, "").trim();
  const choices: LinkChoice[] = [];
  const linked = new Set((sources.links ?? []).map((link) => link.value));
  linked.delete(sources.current ?? "");
  const mark = (choice: LinkChoice): LinkChoice => choice.value !== null && linked.has(choice.value)
    && choice.kind !== "keep" && choice.kind !== "edit" && choice.kind !== "remove" ? { ...choice, linked: true } : choice;
  const fileChoice = (file: F): LinkChoice => ({
    kind: file.extension === "md" ? "file" : "attachment", value: noteLinkValue(sources.linktext(file)),
    title: file.extension === "md" ? file.basename : `${file.basename}.${file.extension}`, detail: folderOf(file.path),
  });
  const cardChoice = (card: LinkableCard): LinkChoice => ({ kind: "card", value: cardLinkValue(card.id), title: card.title, detail: card.context });
  const remove: LinkChoice[] = sources.current ? [{ kind: "remove", value: null, title: t("Remove link"), detail: "" }] : [];
  if (!q) {
    if (sources.current) choices.push({ kind: "keep", value: sources.current, title: sources.currentLabel, detail: t("Current link") });
    else for (const link of sources.links ?? []) choices.push({ kind: "edit", value: link.value, title: link.label, detail: "" });
    // What the card links already is listed above, not again below.
    const fresh = (choice: LinkChoice) => choice.value === null || !linked.has(choice.value);
    const byPath = new Map(sources.files.map((file) => [file.path, file]));
    const recent = [...new Set(sources.recent)].map((path) => byPath.get(path)).filter((file): file is F => !!file);
    choices.push(...recent.map(fileChoice).filter(fresh).slice(0, RECENT_FILES));
    choices.push(...sources.cards.map(cardChoice).filter(fresh).slice(0, FIRST_CARDS));
    return [...choices, ...remove];
  }
  // A card named the way a card's words link it: `#^id`, `[[#^id|Name]]`.
  const ref = q.startsWith("#") ? cardRefOf(q.replace(/\|.*$/, "")) : null;
  const named = ref && !ref.path ? sources.cards.find((card) => card.id === ref.id) : undefined;
  if (named) return [mark(cardChoice(named)), ...remove];
  const web = webAddress(q);
  const url = (address: string): LinkChoice => ({ kind: "url", value: address, title: address, detail: t("Web page") });
  if (web?.explicit) return [mark(url(web.url)), ...remove];
  const hash = q.indexOf("#");
  if (hash >= 0) {
    // Headings of the notes the part before # names; with nothing after #, all of them.
    const fileQuery = q.slice(0, hash).trim();
    const headingQuery = q.slice(hash + 1).replace(/^\^/, "").trim();
    const match = headingQuery ? fuzzy(headingQuery) : null;
    const files = fileQuery ? rankLinkTargets(fileQuery, sources.files, sources.recent, fuzzy, 3) : [];
    let count = 0;
    for (const file of files) {
      for (const { heading } of sources.headings(file)) {
        if (count >= MATCHED_HEADINGS) break;
        if (match && !match(heading)) continue;
        const clean = heading.replace(/[[\]|#^]/g, " ").replace(/\s+/g, " ").trim();
        if (!clean) continue;
        choices.push({ kind: "heading", value: noteLinkValue(`${sources.linktext(file)}#${clean}`), title: heading, detail: fileChoice(file).title });
        count++;
      }
    }
  } else {
    for (const file of rankLinkTargets(q, sources.files, sources.recent, fuzzy, MATCHED_FILES)) choices.push(fileChoice(file));
  }
  const match = fuzzy(q);
  const cards = sources.cards.map((card) => ({ card, score: match(card.title)?.score }))
    .filter((hit): hit is { card: LinkableCard; score: number } => typeof hit.score === "number")
    .sort((a, b) => b.score - a.score).slice(0, MATCHED_CARDS);
  for (const { card } of cards) choices.push(cardChoice(card));
  // A bare domain could be a file's name too: the page comes after the notes.
  if (web) choices.push(url(web.url));
  const name = q.replace(/[|].*$/, "").trim();
  const lower = name.toLocaleLowerCase();
  // Written with or without its extension or folder, a file's name is not a new note.
  const exists = sources.files.some((file) => [file.basename, `${file.basename}.${file.extension}`, file.path, file.path.replace(/\.md$/i, "")]
    .some((form) => form.toLocaleLowerCase() === lower));
  if (name && hash < 0 && !exists && !/[\\:*?"<>]/.test(name)) {
    choices.push({ kind: "new", value: noteLinkValue(name), title: name, detail: t("New note") });
  }
  return [...choices.map(mark), ...remove];
}

const KIND_ICONS: Record<LinkChoiceKind, string> = {
  url: "globe", file: "file-text", attachment: "file", heading: "heading", card: "locate-fixed", new: "file-plus", keep: "check",
  edit: "pencil", remove: "unlink",
};
const KIND_LABELS: Record<LinkChoiceKind, string> = {
  url: "Web page", file: "Note", attachment: "File", heading: "Heading", card: "Card", new: "New note", keep: "Current link",
  edit: "Edit link", remove: "",
};

/**
 * Link a card, as XMind links a topic: paste a web address, or search the
 * vault's notes (`Note#` for their headings) and the canvas's cards. The
 * address or name typed is always on offer, so Enter links it at once.
 * A card takes several links: while one is added, the card's links come
 * first, and choosing one of them opens it for editing (`edit`).
 */
export class CardLinkModal extends SuggestModal<LinkChoice> {
  constructor(app: App, private sources: LinkSources<TFile>, private initial: string, private choose: (value: string | null) => void,
    private edit?: (value: string) => void) {
    super(app);
    this.limit = 30;
    this.setPlaceholder(t("Paste a URL, or search notes and cards"));
    this.setInstructions([
      { command: "↑↓", purpose: t("to navigate") },
      { command: "↵", purpose: t("to link") },
      { command: "esc", purpose: t("to dismiss") },
    ]);
    this.emptyStateText = t("Type a web address, or the name of a note or card");
  }

  onOpen() {
    super.onOpen();
    // The link now, ready to change or replace.
    if (!this.initial) return;
    this.inputEl.value = this.initial;
    this.inputEl.trigger("input");
    this.inputEl.select();
  }

  getSuggestions(query: string): LinkChoice[] {
    return linkChoices(query, this.sources);
  }

  renderSuggestion(choice: LinkChoice, el: HTMLElement) {
    // Obsidian's own two-line item, with the kind of link on the right.
    el.addClass("mod-complex", "nf-canvas-link-choice");
    if (choice.kind === "remove") el.addClass("is-remove");
    if (choice.linked) el.addClass("is-linked");
    const content = el.createDiv({ cls: "suggestion-content" });
    content.createDiv({ cls: "suggestion-title", text: choice.title });
    if (choice.detail && choice.kind !== "url" && choice.kind !== "new" && choice.kind !== "keep") {
      content.createDiv({ cls: "suggestion-note", text: choice.detail });
    }
    const aux = el.createDiv({ cls: "suggestion-aux" });
    const label = choice.linked ? "Linked" : KIND_LABELS[choice.kind];
    if (label) aux.createSpan({ cls: "nf-canvas-link-kind", text: t(label) });
    const flair = aux.createSpan({ cls: "suggestion-flair" });
    setIcon(flair, choice.linked ? "check" : KIND_ICONS[choice.kind]);
  }

  onChooseSuggestion(choice: LinkChoice) {
    if (choice.kind === "keep") return;
    if (choice.kind === "edit") {
      if (choice.value !== null) this.edit?.(choice.value);
      return;
    }
    this.choose(choice.value);
  }
}
