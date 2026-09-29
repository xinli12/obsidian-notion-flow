import { EditorSuggest, prepareFuzzySearch, setIcon } from "obsidian";
import type { App, Editor, EditorPosition, EditorSuggestContext, EditorSuggestTriggerInfo, TFile } from "obsidian";
import { t } from "../i18n";
import { cardLinkText } from "./attachments";
import type { LinkableCard } from "./link-picker";

type Fuzzy = (query: string) => (text: string) => { score: number } | null;

/**
 * Whether the words before the caret are a link to a card being typed:
 * `[[^`, `[[#` or `[[#^` and then some of the card's name. In a note these
 * link a block or heading of the note itself; a canvas has neither in
 * Obsidian's index, so there they are free, and a card is the canvas's
 * block. `[[^^` and `[[##` search the whole vault and stay Obsidian's.
 * Returns where the link starts, at its `[[`, and the words typed.
 */
export function cardLinkTrigger(before: string): { start: number; query: string } | null {
  const open = before.lastIndexOf("[[");
  if (open < 0 || before.indexOf("]", open) >= 0) return null;
  const rest = before.slice(open + 2);
  const lead = /^(?:#\^?|\^)(?![#^])/.exec(rest);
  if (!lead) return null;
  const query = rest.slice(lead[0].length);
  return /[[\]|#^\n]/.test(query) ? null : { start: open, query };
}

/** The cards a few words find, best first, by their names and then where they sit; no words, the first ones. */
export function matchCards(cards: readonly LinkableCard[], query: string, limit = 30, fuzzy: Fuzzy = prepareFuzzySearch as Fuzzy): LinkableCard[] {
  const words = query.trim();
  if (!words) return cards.slice(0, limit);
  const match = fuzzy(words);
  return cards
    .map((card, order) => ({ card, order, score: match(card.title)?.score ?? (card.context ? match(`${card.title} ${card.context}`)?.score : undefined) }))
    .filter((hit): hit is { card: LinkableCard; order: number; score: number } => typeof hit.score === "number")
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((hit) => hit.card);
}

export interface CardLinkHost {
  /**
   * The cards the words of a card being typed in with this editor can link
   * to, and whether the vault writes Markdown links; null for any other editor.
   */
  cardsFor(editor: Editor): { cards: LinkableCard[]; markdown: boolean } | null;
}

/**
 * Link another card from a card's words: `[[^` and a few words of its name
 * list the canvas's cards, and choosing one writes `[[#^id|Name]]`, which a
 * click on the card follows to that card.
 */
export class CardLinkSuggest extends EditorSuggest<LinkableCard> {
  private cards: LinkableCard[] = [];
  private markdown = false;

  constructor(app: App, private host: CardLinkHost) {
    super(app);
    this.limit = 30;
    this.setInstructions([
      { command: "↑↓", purpose: t("to navigate") },
      { command: "↵", purpose: t("to link") },
      { command: "esc", purpose: t("to dismiss") },
    ]);
  }

  onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
    if (file && file.extension !== "canvas") return null;
    const trigger = cardLinkTrigger(editor.getLine(cursor.line).slice(0, cursor.ch));
    if (!trigger) return null;
    const found = this.host.cardsFor(editor);
    if (!found) return null;
    this.cards = found.cards;
    this.markdown = found.markdown;
    return { start: { line: cursor.line, ch: trigger.start }, end: cursor, query: trigger.query };
  }

  getSuggestions(context: EditorSuggestContext): LinkableCard[] {
    return matchCards(this.cards, context.query, this.limit);
  }

  renderSuggestion(card: LinkableCard, el: HTMLElement) {
    // Obsidian's own two-line item, as the link picker draws a card.
    el.addClass("mod-complex", "nf-canvas-link-choice");
    const content = el.createDiv({ cls: "suggestion-content" });
    content.createDiv({ cls: "suggestion-title", text: card.title });
    if (card.context) content.createDiv({ cls: "suggestion-note", text: card.context });
    const aux = el.createDiv({ cls: "suggestion-aux" });
    aux.createSpan({ cls: "nf-canvas-link-kind", text: t("Card") });
    setIcon(aux.createSpan({ cls: "suggestion-flair" }), "locate-fixed");
  }

  selectSuggestion(card: LinkableCard) {
    const context = this.context;
    if (!context) return;
    const { editor, start, end } = context;
    // Obsidian closes the brackets as they are typed: the link takes them.
    const closing = { line: end.line, ch: end.ch + 2 };
    const to = editor.getRange(end, closing) === "]]" ? closing : end;
    const text = cardLinkText(card.id, card.title, this.markdown);
    editor.replaceRange(text, start, to);
    editor.setCursor({ line: start.line, ch: start.ch + text.length });
    this.close();
  }
}
