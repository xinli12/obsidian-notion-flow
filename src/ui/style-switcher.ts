import { App, Modal, Notice, setIcon } from "obsidian";
import { t, tl } from "../i18n";
import { LOOKS, PALETTES, resolveNoteStyle, withPreview } from "../features/style-presets";
import type { Bilingual, NoteStyleSettings, PaletteDef } from "../features/style-presets";

/* "Change note style…" (DESIGN-SPEC §7.2): a prompt over the note that
 * previews every palette and look live while you move through it. Only
 * Enter (or a click) saves, and only the axis of the chosen row; Escape or
 * any other close restores the saved style exactly.
 *
 * A plain Modal dressed in Obsidian's prompt classes rather than a
 * SuggestModal, which exposes no selection-change hook. The keyboard and
 * mouse conventions mirror SuggestModal's chooser. The state lives in the
 * pure SwitcherModel; the modal only draws it and schedules previews. */

export interface StyleSwitcherHost {
  settings: NoteStyleSettings;
  save(): Promise<void>;
  /** Write the body style for the saved settings on every window. */
  apply(): void;
  /** Write the body style for `s` without saving. */
  preview(s: NoteStyleSettings): void;
}

export interface SwitcherRow {
  group: "palette" | "look";
  id: string;
  name: Bilingual;
  desc: Bilingual;
  swatch?: PaletteDef["swatch"];
}

type Group = SwitcherRow["group"];
type Saved = Record<Group, string>;

/** Hovering a row makes it active after this long (ms). */
const HOVER_DELAY = 120;

/* ---------- pure parts ---------- */

/** Every row the switcher lists: the palettes, then the looks, in gallery order. */
export function switcherRows(): SwitcherRow[] {
  return [
    ...PALETTES.map((p): SwitcherRow => ({ group: "palette", id: p.id, name: p.name, desc: p.desc, swatch: p.swatch })),
    ...LOOKS.map((l): SwitcherRow => ({ group: "look", id: l.id, name: l.name, desc: l.desc })),
  ];
}

/** Case-insensitive substring match over the id, both names and both
 * descriptions. The query is one string (not split on spaces). */
export function rowMatches(row: SwitcherRow, query: string): boolean {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return true;
  return [row.id, row.name.en, row.name.zh, row.desc.en, row.desc.zh].some((text) => text.toLowerCase().includes(q));
}

/** The switcher's meaning of a key, or null for keys it leaves alone
 * (Escape stays with the modal; an IME keeps its Enter and arrows). */
export function switcherKeyAction(evt: { key: string; shiftKey?: boolean; isComposing?: boolean }): "up" | "down" | "group" | "commit" | null {
  if (evt.isComposing) return null;
  switch (evt.key) {
    case "ArrowUp": return "up";
    case "ArrowDown": return "down";
    case "Tab": return "group";
    case "Enter": return "commit";
    default: return null;
  }
}

/** The switcher's state: the filter, the visible rows and the active one. */
export class SwitcherModel {
  readonly rows: readonly SwitcherRow[];
  readonly saved: Saved;
  query = "";
  visible: SwitcherRow[];
  activeRow: SwitcherRow | null;
  /** The last row that was active, so clearing a filter that matched
   * nothing returns to it rather than to the top. */
  private lastActive: SwitcherRow | null;

  constructor(rows: readonly SwitcherRow[], saved: { palette: string; look: string }) {
    this.rows = rows;
    this.saved = { palette: saved.palette, look: saved.look };
    this.visible = [...rows];
    this.activeRow = this.savedRow("palette") ?? this.visible[0] ?? null;
    this.lastActive = this.activeRow;
  }

  private savedRow(group: Group): SwitcherRow | null {
    return this.visible.find((row) => row.group === group && row.id === this.saved[group]) ?? null;
  }

  /** Filter; the active row stays if still visible, else the first visible
   * row of its group, else the first visible row. */
  setQuery(query: string): void {
    this.query = query;
    this.visible = this.rows.filter((row) => rowMatches(row, query));
    const active = this.activeRow ?? this.lastActive;
    this.setActive(active && this.visible.includes(active) ? active
      : (active && this.visible.find((row) => row.group === active.group)) ?? this.visible[0] ?? null);
  }

  private setActive(row: SwitcherRow | null): void {
    this.activeRow = row;
    if (row) this.lastActive = row;
  }

  /** One row up or down, wrapping over both groups. */
  move(delta: number): void {
    const n = this.visible.length;
    if (!n) return;
    const i = this.activeRow ? this.visible.indexOf(this.activeRow) : -1;
    const next = i < 0 ? (delta > 0 ? 0 : n - 1) : (((i + Math.sign(delta)) % n) + n) % n;
    this.setActive(this.visible[next]);
  }

  /** To the other group's saved row (or its first visible row). */
  switchGroup(): void {
    const other: Group = this.activeRow?.group === "palette" ? "look" : "palette";
    const rows = this.visible.filter((row) => row.group === other);
    if (!rows.length) return;
    this.setActive(rows.find((row) => row.id === this.saved[other]) ?? rows[0]);
  }

  /** Make a visible row active (mouse). */
  activate(group: Group, id: string): void {
    const row = this.visible.find((r) => r.group === group && r.id === id);
    if (row) this.setActive(row);
  }

  /** What committing the active row would change. */
  patch(): { palette: string } | { look: string } | null {
    const row = this.activeRow;
    if (!row) return null;
    return row.group === "palette" ? { palette: row.id } : { look: row.id };
  }
}

/* ---------- the modal ---------- */

const rowId = (row: SwitcherRow) => `nf-sw-${row.group}-${row.id}`;

export class StyleSwitcherModal extends Modal {
  private readonly host: StyleSwitcherHost;
  private model: SwitcherModel;
  private inputEl: HTMLInputElement | null = null;
  private emptyEl: HTMLElement | null = null;
  private readonly rowEls = new Map<SwitcherRow, HTMLElement>();
  private readonly groupEls = new Map<Group, HTMLElement>();
  /** The window the modal opened in. Modal's own `win` is already null by
   * onClose (and modalEl detached), so the frame and timer need this one. */
  private openWin: Window | null = null;
  private frame: number | null = null;
  private hoverTimer: number | null = null;
  private pointer: { x: number; y: number } | null = null;
  private committed = false;
  private isOpen = false;

  constructor(app: App, host: StyleSwitcherHost) {
    super(app);
    this.host = host;
    this.model = new SwitcherModel(switcherRows(), resolveNoteStyle(host.settings));
    // A handler's `false` is Obsidian's preventDefault; undefined lets the
    // key through (IME composition). Escape stays with Modal's close.
    const onKey = (evt: KeyboardEvent) => this.onKey(evt);
    this.scope.register([], "ArrowDown", onKey);
    this.scope.register([], "ArrowUp", onKey);
    // The scope matches modifiers exactly: Tab and Shift+Tab separately.
    this.scope.register([], "Tab", onKey);
    this.scope.register(["Shift"], "Tab", onKey);
    this.scope.register([], "Enter", onKey);
  }

  onOpen(): void {
    const { modalEl } = this;
    this.openWin = modalEl.win;
    this.committed = false;
    this.isOpen = true;
    this.pointer = null;
    const saved = resolveNoteStyle(this.host.settings);
    this.model = new SwitcherModel(switcherRows(), saved);
    this.rowEls.clear();
    this.groupEls.clear();

    // Built the way SuggestModal builds its prompt, for the native look.
    modalEl.removeClass("modal");
    modalEl.addClass("prompt", "nf-style-switcher");
    modalEl.empty();
    const listId = "nf-sw-list";
    const input = modalEl.createDiv({ cls: "prompt-input-container" }).createEl("input", {
      cls: "prompt-input",
      type: "text",
      attr: {
        placeholder: t("Search palettes and looks"),
        role: "combobox", "aria-expanded": "true", "aria-controls": listId, "aria-autocomplete": "list",
        autocapitalize: "off", spellcheck: "false",
      },
    });
    this.inputEl = input;
    const results = modalEl.createDiv({ cls: "prompt-results", attr: { role: "listbox", id: listId } });

    const dark = modalEl.doc.body.classList.contains("theme-dark");
    for (const [group, label] of [["palette", t("Palette")], ["look", t("Note look")]] as const) {
      const headerId = `nf-sw-group-${group}`;
      const groupEl = results.createDiv({ cls: "nf-sw-group", attr: { role: "group", "aria-labelledby": headerId } });
      groupEl.createDiv({ cls: "nf-sw-group-header", text: label, attr: { id: headerId } });
      this.groupEls.set(group, groupEl);
      for (const row of this.model.rows.filter((r) => r.group === group)) {
        this.rowEls.set(row, this.renderRow(groupEl, row, row.id === saved[group], dark));
      }
    }
    this.emptyEl = results.createDiv({
      cls: "suggestion-empty", text: tl({ en: "No palette or look matches.", zh: "没有匹配的配色方案或版式。" }),
    });

    const instructions = modalEl.createDiv({ cls: "prompt-instructions" });
    for (const [command, purpose] of [["↑↓", t("preview")], ["↵", t("apply")], ["Tab", t("switch group")], ["esc", t("restore")]]) {
      const item = instructions.createDiv({ cls: "prompt-instruction" });
      item.createSpan({ cls: "prompt-instruction-command", text: command });
      item.createSpan({ text: purpose });
    }

    input.addEventListener("input", () => {
      const before = this.model.activeRow;
      this.model.setQuery(input.value);
      this.sync(true);
      if (this.model.activeRow !== before) this.schedulePreview();
    });
    results.addEventListener("mousemove", (evt) => this.onHover(evt, results));
    results.addEventListener("mouseleave", () => this.clearHover());
    // Keep the caret in the input while clicking a row.
    results.addEventListener("mousedown", (evt) => evt.preventDefault());
    results.addEventListener("click", (evt) => {
      const rowEl = this.rowElFrom(evt.target, results);
      if (!rowEl) return;
      evt.preventDefault();
      this.clearHover();
      this.model.activate(rowEl.getAttr("data-group") as Group, rowEl.getAttr("data-id") ?? "");
      this.commit();
    });

    this.sync(true);
    input.focus();
  }

  onClose(): void {
    // A frame or hover still pending would re-apply a preview after the restore.
    this.cancelPending();
    this.isOpen = false;
    if (!this.committed) this.host.apply();
  }

  /** One row: palette dots (palettes only), name, description, and a check
   * on the saved palette and the saved look. */
  private renderRow(groupEl: HTMLElement, row: SwitcherRow, saved: boolean, dark: boolean): HTMLElement {
    const el = groupEl.createDiv({
      cls: "suggestion-item mod-complex nf-sw-row",
      attr: { role: "option", id: rowId(row), "data-id": row.id, "data-group": row.group, "aria-selected": "false" },
    });
    if (row.swatch) {
      const dots = el.createDiv({ cls: "nf-sw-dots", attr: { "aria-hidden": "true" } });
      for (const hex of dark ? row.swatch.dark : row.swatch.light) dots.createSpan().setCssProps({ "--nf-dot": hex });
    }
    const content = el.createDiv({ cls: "suggestion-content" });
    const name = tl(row.name);
    const title = content.createDiv({ cls: "suggestion-title", text: name });
    if (name !== row.name.en) title.createEl("small", { text: row.name.en });
    content.createDiv({ cls: "suggestion-note", text: tl(row.desc) });
    const flair = el.createDiv({ cls: "suggestion-aux" }).createSpan({ cls: "suggestion-flair", attr: { "aria-hidden": "true" } });
    if (saved) {
      setIcon(flair, "check");
      el.setAttr("aria-current", "true");
    }
    return el;
  }

  /** Draw the model: visible rows and groups, the active row, the empty state. */
  private sync(scroll: boolean): void {
    const { visible, activeRow } = this.model;
    for (const [row, el] of this.rowEls) {
      el.toggle(visible.includes(row));
      const active = row === activeRow;
      el.toggleClass("is-selected", active);
      el.setAttr("aria-selected", active ? "true" : "false");
    }
    for (const [group, el] of this.groupEls) el.toggle(visible.some((row) => row.group === group));
    this.emptyEl?.toggle(visible.length === 0);
    if (activeRow) this.inputEl?.setAttr("aria-activedescendant", rowId(activeRow));
    else this.inputEl?.removeAttribute("aria-activedescendant");
    if (scroll && activeRow) this.rowEls.get(activeRow)?.scrollIntoView({ block: "nearest" });
  }

  private onKey(evt: KeyboardEvent): false | undefined {
    const action = switcherKeyAction(evt);
    if (!action || !this.isOpen) return undefined;
    if (action === "commit") {
      this.commit();
      return false;
    }
    const before = this.model.activeRow;
    if (action === "group") this.model.switchGroup();
    else this.model.move(action === "down" ? 1 : -1);
    this.clearHover();
    this.sync(true);
    if (this.model.activeRow !== before) this.schedulePreview();
    return false;
  }

  private rowElFrom(target: EventTarget | null, results: HTMLElement): HTMLElement | null {
    const el = target as HTMLElement | null;
    const rowEl = el && typeof el.closest === "function" ? el.closest<HTMLElement>(".nf-sw-row") : null;
    return rowEl && results.contains(rowEl) ? rowEl : null;
  }

  /** Hover activates after a pause. A move that did not change the pointer
   * position is Chromium's synthetic one while rows scroll under a still
   * mouse (keyboard navigation): it must not steal the selection. */
  private onHover(evt: MouseEvent, results: HTMLElement): void {
    const rowEl = this.rowElFrom(evt.target, results);
    if (!rowEl || !this.openWin) return;
    if (this.pointer && this.pointer.x === evt.clientX && this.pointer.y === evt.clientY) return;
    this.pointer = { x: evt.clientX, y: evt.clientY };
    this.clearHover();
    const group = rowEl.getAttr("data-group") as Group;
    const id = rowEl.getAttr("data-id") ?? "";
    this.hoverTimer = this.openWin.setTimeout(() => {
      this.hoverTimer = null;
      if (!this.isOpen) return;
      const before = this.model.activeRow;
      this.model.activate(group, id);
      if (this.model.activeRow === before) return;
      this.sync(false);
      this.schedulePreview();
    }, HOVER_DELAY);
  }

  private clearHover(): void {
    if (this.hoverTimer !== null) this.openWin?.clearTimeout(this.hoverTimer);
    this.hoverTimer = null;
  }

  /** Preview the active row on the next frame; bursts of moves coalesce into
   * one. The other axis stays at its saved value: exactly what Enter saves. */
  private schedulePreview(): void {
    if (!this.openWin || this.frame !== null) return;
    this.frame = this.openWin.requestAnimationFrame(() => {
      this.frame = null;
      if (!this.isOpen) return;
      const patch = this.model.patch();
      this.host.preview(patch ? withPreview(this.host.settings, patch) : this.host.settings);
    });
  }

  private cancelPending(): void {
    if (this.frame !== null) this.openWin?.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.clearHover();
  }

  /** Save the active row's axis; with no row (nothing matches) stay open. */
  private commit(): void {
    const row = this.model.activeRow;
    if (!row) return;
    const { host } = this;
    if (row.group === "palette") host.settings.palette = row.id;
    else host.settings.look = row.id;
    this.committed = true;
    this.close();
    host.apply();
    const style = resolveNoteStyle(host.settings);
    const palette = PALETTES.find((p) => p.id === style.palette) ?? PALETTES[0];
    const look = LOOKS.find((l) => l.id === style.look) ?? LOOKS[0];
    new Notice(t("Note style: {palette} · {look}").replace("{palette}", tl(palette.name)).replace("{look}", tl(look.name)));
    void (async () => {
      try {
        await host.save();
      } catch (error) {
        console.warn("Notion Flow: saving the note style failed", error);
      }
    })();
  }
}
