import { t } from "../i18n";
import { keyLabel } from "../core/keys";

/** One line of a guide: the keys or button names it is about, and what happens. */
export interface HelpRow {
  /** Chords, already labelled or in Obsidian's Mod/Alt/Shift form; shown as <kbd>. */
  keys?: string[];
  /** Buttons and gestures named in the interface, shown as words. */
  words?: string[];
  /** What the keys or words do. */
  desc: string;
}

export interface HelpSection {
  title: string;
  rows: HelpRow[];
}

/**
 * Render guide sections into `container` with the row structure of the
 * canvas guide (HelpPanel): `${prefix}-section` > `${prefix}-heading` and
 * `${prefix}-row` > `${prefix}-keys` (<kbd class="${prefix}-key"> and
 * <span class="${prefix}-word">) + `${prefix}-text`. Titles, words and
 * descriptions are translated here, so callers pass the English keys; chords
 * go through keyLabel, which leaves already labelled chords alone.
 */
export function renderHelpSections(container: HTMLElement, sections: HelpSection[], classPrefix: string): void {
  const doc = container.ownerDocument;
  for (const { title, rows } of sections) {
    const section = doc.createElement("section");
    section.className = `${classPrefix}-section`;
    const heading = doc.createElement("div");
    heading.className = `${classPrefix}-heading`;
    heading.textContent = t(title);
    section.append(heading);
    for (const { keys = [], words = [], desc } of rows) {
      const row = doc.createElement("div");
      row.className = `${classPrefix}-row`;
      const cell = doc.createElement("div");
      cell.className = `${classPrefix}-keys`;
      for (const key of keys) {
        const kbd = doc.createElement("kbd");
        kbd.className = `${classPrefix}-key`;
        kbd.textContent = keyLabel(key);
        cell.append(kbd);
      }
      for (const word of words) {
        const span = doc.createElement("span");
        span.className = `${classPrefix}-word`;
        span.textContent = t(word);
        cell.append(span);
      }
      const text = doc.createElement("div");
      text.className = `${classPrefix}-text`;
      text.textContent = t(desc);
      row.append(cell, text);
      section.append(row);
    }
    container.append(section);
  }
}
