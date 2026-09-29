import { SuggestModal, renderMatches, setIcon } from "obsidian";
import type { App } from "obsidian";
import { t } from "../i18n";
import { LANGUAGE_RECENT_CAP, languageChange, pushRecentLanguage, rankLanguages } from "../core/code-languages";
import type { LanguageChoice } from "../core/code-languages";

/**
 * The code-block language picker: a searchable prompt (Obsidian's own
 * suggestion markup, so no new CSS) that understands aliases ("js" puts
 * JavaScript first), remembers recent picks and takes any typed token as a
 * custom language. A modal rather than a menu, so the check and notes
 * survive `nativeMenus`.
 */

/** The `app.saveLocalStorage` key of the languages picked most recently. */
export const LANGUAGE_RECENT_KEY = "nf-code-language-recent";

/** The stored recents, tolerating a missing, empty or malformed entry. */
export function loadRecentLanguages(app: App): string[] {
  const raw: unknown = typeof app?.loadLocalStorage === "function" ? app.loadLocalStorage(LANGUAGE_RECENT_KEY) : null;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string" && item.trim() !== "").slice(0, LANGUAGE_RECENT_CAP);
}

export function saveRecentLanguages(app: App, recent: readonly string[]): void {
  if (typeof app?.saveLocalStorage === "function") app.saveLocalStorage(LANGUAGE_RECENT_KEY, [...recent]);
}

export interface LanguagePickerOptions {
  /** The fence's language as written ("" for none). */
  current: string;
  recent: readonly string[];
  /** Called with the new fence language ("" removes it), only when it differs from `current`. */
  onPick: (token: string) => void;
  onRecent?: (recent: string[]) => void;
  /** Given, the unfiltered list ends with "Other language…", which calls it (a free-text prompt).
   * Typing any token already offers it as a row of its own. */
  onOther?: () => void;
}

/** The "Other language…" row: a hand-off, never written into the fence itself. */
function otherRow(): LanguageChoice {
  return { kind: "other", id: "", label: t("Other language…"), note: "", ranges: [], current: false, recent: false, score: 0 };
}

export class LanguageSuggestModal extends SuggestModal<LanguageChoice> {
  private readonly options: LanguagePickerOptions;
  private recent: string[];

  constructor(app: App, options: LanguagePickerOptions) {
    super(app);
    this.options = options;
    this.recent = [...options.recent];
    this.limit = 60;
    this.setPlaceholder(t("Search languages"));
    this.setInstructions([
      { command: "↑↓", purpose: t("navigate") },
      { command: "esc", purpose: t("dismiss") },
    ]);
  }

  getSuggestions(query: string): LanguageChoice[] {
    const rows = rankLanguages(query, { current: this.options.current, recent: this.recent, noneLabel: t("No language") });
    return this.options.onOther && !query.trim() ? [...rows, otherRow()] : rows;
  }

  renderSuggestion(choice: LanguageChoice, el: HTMLElement): void {
    el.addClass("mod-complex");
    const content = el.createDiv({ cls: "suggestion-content" });
    const title = content.createDiv({ cls: "suggestion-title" });
    renderMatches(title, choice.label, choice.ranges.length > 0 ? choice.ranges : null);
    // A recent custom language reads "Recent", so it stands apart from the typed-token row below it.
    const note = choice.kind === "custom" ? (choice.recent ? t("Recent") : t("Other language…")) : choice.note;
    if (note) content.createDiv({ cls: "suggestion-note", text: note });
    if (choice.kind === "other") {
      const flair = el.createDiv({ cls: "suggestion-aux" }).createSpan({ cls: "suggestion-flair" });
      setIcon(flair, "pencil");
    }
    if (choice.current) {
      const flair = el.createDiv({ cls: "suggestion-aux" }).createSpan({ cls: "suggestion-flair" });
      setIcon(flair, "check");
    }
  }

  onChooseSuggestion(choice: LanguageChoice): void {
    if (choice.kind === "other") {
      this.options.onOther?.();
      return;
    }
    const next = languageChange(this.options.current, choice.id);
    if (choice.kind !== "none") {
      this.recent = pushRecentLanguage(this.recent, choice.id);
      saveRecentLanguages(this.app, this.recent);
      this.options.onRecent?.(this.recent);
    }
    if (next !== null) this.options.onPick(next);
  }
}

/** Open the picker for a fence whose language is `current`; `onPick` receives the new language,
 * `onOther` (optional) the "Other language…" row. */
export function openLanguagePicker(
  app: App, current: string, onPick: (token: string) => void, onOther?: () => void
): LanguageSuggestModal {
  const modal = new LanguageSuggestModal(app, { current, recent: loadRecentLanguages(app), onPick, onOther });
  modal.open();
  return modal;
}
