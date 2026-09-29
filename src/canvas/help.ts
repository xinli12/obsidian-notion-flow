import { setIcon } from "obsidian";
import { t } from "../i18n";
import { keyLabel } from "../core/keys";

/** A setting a row depends on: the canvas keys, or Enter and Tab while typing. */
export type HelpNeed = "keyboard" | "editorKeys";
/** One line of the guide: the keys or button it names, what happens, and the setting it needs. */
type HelpRow = [keys: string[], text: string, needs?: HelpNeed];
type HelpSection = [icon: string, title: string, rows: HelpRow[]];

/**
 * Everything the canvas can do, in the order people look for it: growing a
 * map, connecting cards, arranging, viewing, and the mind-map components.
 * Keys are shown as they are typed on this platform.
 */
const SECTIONS: HelpSection[] = [
  ["corner-down-right", "Grow a map", [
    [["Tab"], "New child topic; on a lone card this starts a mind map", "keyboard"],
    [["Enter"], "Add the next card: a sibling below, a main topic from the centre, a new card below a lone card · Shift+Enter a sibling above", "keyboard"],
    [["+"], "Click the + at a card's edge to grow it that way"],
    [["Double-click"], "Double-click empty canvas for a free card"],
    [["Enter", "Tab"], "While typing: Enter finishes the card and keeps it selected, so Enter again adds the next card and Tab a child; Tab also finishes and adds a child at once, Shift+Tab takes a topic up a level; Shift+Enter breaks the line, and in lists, quotes and code Enter keeps writing (Esc finishes there); a new card left empty vanishes", "editorKeys"],
    [["Space", "F2"], "Space starts editing with the caret at the end; F2 selects the words to replace them", "keyboard"],
    [["Esc"], "Finish editing and return to the card"],
    [["Mod+Enter"], "Finish editing and return to the card", "editorKeys"],
  ]],
  ["spline", "Connect cards", [
    [["Connect"], "Select a card, click Connect, then click the card to join it to · Esc cancels"],
    [["Shift+click", "Connect"], "Select two or more cards, then Connect joins them in that order"],
    [["Drag"], "Or hover a card's edge and drag the dot that appears onto another card"],
    [["Double-click"], "Double-click a line to give it a label"],
    [[], "Lines between map cards are relations: dashed, and they never change the branch structure"],
  ]],
  ["network", "Arrange", [
    [["Drag"], "Dragging a card carries its branch; drop it on another card to move it there, or past a sibling to reorder"],
    [["Alt+Shift+↑↓"], "Reorder among siblings · arrows walk the map · Shift+Tab goes to the parent", "keyboard"],
    [["Mod+[", "Mod+]"], "Outdent a card to its parent's level, or indent it under the sibling before it; its branch goes along", "keyboard"],
    [["Layout"], "Mind map, logic chart, org chart, tree chart, timeline, and spacing; each branch may take a structure of its own, and children can centre on their parent or line up from the top"],
    [["Style"], "Color schemes, looks, branch lines, typeface, spacing, and boundaries"],
    [["Delete", "Shift+Delete"], "Delete keeps the children; Shift+Delete removes the whole branch", "keyboard"],
  ]],
  ["focus", "View", [
    [["Mod+/"], "Fold or unfold a branch, or click the dot on its line · More shows 1, 2, or 3 levels", "keyboard"],
    [["Focus"], "Fade everything but the selected branch · Esc or Show all returns"],
    [["Mod+F"], "Find any card, including folded ones", "keyboard"],
    [["Present"], "Walk the map branch by branch · ← → PageUp PageDown · F full screen · Esc stops"],
  ]],
  ["flag", "Components", [
    [["Markers"], "Priorities, status icons, flags, and symbols on a card; select several cards to mark them together"],
    [["Note", "F4"], "Notes kept behind the card: click the note icon at its lower right corner to read them, double-click a note to edit it"],
    [["Shift+F4"], "Add another note to the card; its icon shows how many it has", "keyboard"],
    [["Esc", "Mod+Enter"], "While writing a note: keep the words and close it"],
    [["Link", "Mod+K"], "Link a card to web pages, notes or their headings, and other cards, as many as it needs; click a link icon to go there"],
    [["Mod+click"], "On a link icon: open the note in a new tab"],
    [["[[^", "Mod+Shift+K"], "While typing in a card: link to another card on this canvas by its name; a click on the link goes there"],
    [["Numbering"], "Number the topics 1, 1.1, 1.2 · in the Style panel and More menu"],
    [["Summary"], "Select one or more sibling branches, then Summary adds a brace and a card past them; type the summary, and select it again to remove it"],
    [["Boundary"], "A dashed frame around a branch, in the Style panel"],
    [["Style"], "Card shape, text size, and line weight, in the Style panel and the settings"],
    [["- [ ]"], "Cards with tasks show how many are done"],
    [["More"], "Insert a note as a map, export a branch as a note, turn a list into branches, copy a branch as an outline"],
  ]],
];

/** Keys as they are pressed here, shared with the shortcuts modal; kept exported from here for its callers. */
export { keyLabel } from "../core/keys";

/**
 * Buttons and gestures named in the guide, which are words rather than keys.
 * A key held during a gesture, as in Shift+click, is a key and then a word.
 */
const WORDS = new Set(["Connect", "Drag", "Double-click", "Layout", "Style", "Focus", "Present", "Markers", "Numbering",
  "Boundary", "Summary", "More", "+", "- [ ]", "click", "Note", "Link"]);

export interface HelpPanelHost {
  close(): void;
}

/** Which settings are on, so the rows that depend on one can say when it is off. */
export interface HelpFlags {
  keyboard: boolean;
  editorKeys: boolean;
}

/**
 * The guide: a panel beside the canvas that lists what the toolbar, the
 * cards and the keyboard can do, so nothing has to be found by trial.
 */
export class HelpPanel {
  readonly el: HTMLElement;

  constructor(doc: Document, host: HelpPanelHost, flags: HelpFlags = { keyboard: true, editorKeys: true }) {
    const el = this.el = doc.createElement("div");
    el.className = "nf-canvas-help-panel nf-canvas-ui";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", t("Canvas guide"));
    for (const name of ["pointerdown", "mousedown", "dblclick", "wheel", "contextmenu", "click"]) {
      el.addEventListener(name, (evt) => evt.stopPropagation());
    }
    el.addEventListener("keydown", (evt) => {
      if (evt.key !== "Escape") return;
      evt.preventDefault();
      evt.stopPropagation();
      host.close();
    });
    const head = doc.createElement("div");
    head.className = "nf-canvas-help-head";
    const title = doc.createElement("div");
    title.className = "nf-canvas-help-title";
    title.textContent = t("Canvas guide");
    const close = doc.createElement("button");
    close.type = "button";
    close.className = "clickable-icon nf-canvas-help-close";
    close.setAttribute("aria-label", t("Close"));
    setIcon(close, "x");
    close.addEventListener("click", () => host.close());
    head.append(title, close);
    const body = doc.createElement("div");
    body.className = "nf-canvas-help-body";
    for (const [icon, heading, rows] of SECTIONS) {
      const section = doc.createElement("section");
      section.className = "nf-canvas-help-section";
      const label = doc.createElement("div");
      label.className = "nf-canvas-help-heading";
      const glyph = doc.createElement("span");
      glyph.className = "nf-canvas-help-glyph";
      setIcon(glyph, icon);
      const text = doc.createElement("span");
      text.textContent = t(heading);
      label.append(glyph, text);
      section.append(label);
      for (const [keys, line, needs] of rows) {
        const row = doc.createElement("div");
        row.className = "nf-canvas-help-row";
        // A row whose setting is off stays, and says so, rather than vanishing.
        const off = !!needs && !flags[needs];
        if (off) row.classList.add("nf-canvas-help-off");
        const cell = doc.createElement("div");
        cell.className = "nf-canvas-help-keys";
        const chip = (text: string, word: boolean) => {
          const el = doc.createElement(word ? "span" : "kbd");
          el.className = word ? "nf-canvas-help-word" : "nf-canvas-help-key";
          el.textContent = word ? t(text) : keyLabel(text);
          return el;
        };
        for (const key of keys) {
          const held = WORDS.has(key) ? null : /^(.+)\+([a-z][a-z-]*)$/.exec(key);
          if (held && WORDS.has(held[2])) cell.append(chip(held[1], false), chip(held[2], true));
          else cell.append(chip(key, WORDS.has(key)));
        }
        const what = doc.createElement("div");
        what.className = "nf-canvas-help-text";
        what.textContent = t(line);
        if (off) {
          const note = doc.createElement("span");
          note.className = "nf-canvas-help-note";
          note.textContent = ` · ${t("Off in settings")}`;
          what.append(note);
        }
        row.append(cell, what);
        section.append(row);
      }
      body.append(section);
    }
    el.append(head, body);
  }

  destroy() {
    this.el.remove();
  }
}
