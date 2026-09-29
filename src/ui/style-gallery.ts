import { App, DropdownComponent, Setting, ToggleComponent } from "obsidian";
import { t, tl, tn } from "../i18n";
import {
  COLOR_KEY_LABELS, COMPONENTS, COMPONENT_KEYS, LOOKS, PALETTES, STYLE_HUES,
  followAll, overriddenKeys, resolveNoteStyle,
} from "../features/style-presets";
import type { ColorKey, ComponentKey, LookDef, NoteStyleSettings, PaletteDef } from "../features/style-presets";
import { CODE_THEME_LABELS, bindRadioGrid, keepInSettingsTabOrder, syncRadioGrid } from "./settings-preview";

/* The Settings "Note style" section (DESIGN-SPEC §7.1): a gallery of live
 * palette previews, the paper / heading / link options, a gallery of look
 * thumbnails drawn in the current palette, the suggested-look hint, the
 * override notice and the per-component "Customize components" rows.
 *
 * Picking a palette or look only sets that axis; component settings are
 * never rewritten (only the explicit "Follow the style for all" resets them).
 * Rows are built once; every later change updates them in place, so focus
 * stays on the card just chosen and the tab's dependents map never collects
 * stale rows. Runs of rows sit in native 1.13 setting cards; the galleries
 * keep the full width between them (three cards a row), and stay in
 * Settings' Tab order with the other controls placed between rows. Cross-window: Settings is its own window, so nothing here
 * touches the global document or window, and nothing writes to the settings
 * window's body (Obsidian mirrors the main body there). */

export type GateSettingKey = "cleanRendering" | "calloutEditing" | "tableStyle" | "toggleBlocks" | "columnLayout";
/** Feature class a component's CSS is scoped under → the boolean setting that adds it. */
export const GATE_SETTING: Record<"nf-clean" | "nf-callout-menu" | "nf-tables" | "nf-toggles" | "nf-columns", GateSettingKey> = {
  "nf-clean": "cleanRendering",
  "nf-callout-menu": "calloutEditing",
  "nf-tables": "tableStyle",
  "nf-toggles": "toggleBlocks",
  "nf-columns": "columnLayout",
};

export interface NoteStyleHost {
  app: App;
  /** The live plugin settings, mutated in place. */
  settings: NoteStyleSettings;
  save(): Promise<void>;
  /** Write the body classes and properties for the current settings on every window, without saving. */
  apply(): void;
  /** Write the body classes and properties for `s`, without saving (the switcher's live preview). */
  preview(s: NoteStyleSettings): void;
  /** Register a gated Customize row with the tab's dependents map and dim
   * it now if `key` is off. `key` is already the boolean SETTINGS key
   * ("cleanRendering", …): the section maps the component's gate class
   * through GATE_SETTING itself, so the tab uses it as is, with no map of
   * its own: `(dependents.get(key) ?? dependents.set(key, []).get(key)!)
   * .push(setting)`, then dims from `settings[key]`. */
  dependsOn(setting: Setting, key: GateSettingKey): void;
  /** Re-render the whole tab (after "Follow the style for all"). Optional:
   * changed() already brings every row back in line, and a re-render
   * loses the scroll position and the focus. */
  redisplay?(): void;
  /** After every change the section makes, once it is saved. Required: the
   * section, the code-theme gallery and the tab's colour rows share one
   * settings object and hear about each other only through this. The tab
   * refreshes them all here: section.refresh(), the code gallery's
   * refresh(), and each colour row's dropdown value and dot. */
  changed(): void;
}

/** Effective callout style → the mini callout variant the palette cards draw. */
const CALLOUT_LOOK: Record<string, string> = {
  header: "classic", flat: "classic", rail: "rail", card: "card", outline: "outline", minimal: "minimal", gradient: "gradient",
};
const MODIFIERS = [
  ...["classic", "rail", "card", "outline", "minimal", "gradient"].map((look) => `is-look-${look}`), "is-paper", "is-headings",
];
/** One-character ink names for the Chinese mini preview (the English one shows "Aa"). */
const INK_GLYPH: Record<string, string> = {
  gray: "灰", red: "朱", orange: "橙", yellow: "缃", green: "翠", cyan: "青", blue: "靛", purple: "紫", pink: "粉",
};

type Loose = Partial<Record<string, unknown>>;
const loose = (s: unknown): Loose => (typeof s === "object" && s !== null ? s as Loose : {});
const isHue = (v: string) => (STYLE_HUES as readonly string[]).includes(v);

/* ---------- pure helpers ---------- */

/** The mini-callout variant for the effective callout style. */
export function calloutLookClass(s: NoteStyleSettings): string {
  return CALLOUT_LOOK[resolveNoteStyle(s).components.calloutStyle.value] ?? "classic";
}

/** Classes the palette gallery carries so its mini previews show the
 * current look's callout, the paper tone and tinted headings. */
export function galleryModifiers(s: NoteStyleSettings): string[] {
  const own = loose(s);
  const mods = [`is-look-${calloutLookClass(s)}`];
  if (own.paletteSurface === "page" || own.paletteSurface === "app") mods.push("is-paper");
  if (own.paletteHeadings === true) mods.push("is-headings");
  return mods;
}

/** The look the current palette was designed with, offered while the look
 * is still Classic; null when there is nothing to suggest. */
export function suggestionFor(s: NoteStyleSettings): LookDef | null {
  const { palette, look } = resolveNoteStyle(s);
  if (palette === "classic" || look !== "classic") return null;
  const suggested = PALETTES.find((p) => p.id === palette)?.suggestedLook;
  if (!suggested || suggested === "classic") return null;
  return LOOKS.find((l) => l.id === suggested) ?? null;
}

/** The translated label of one explicit value of a component or colour key. */
export function optionLabel(key: ComponentKey | ColorKey, value: string): string {
  if (key === "codeTheme") return t(CODE_THEME_LABELS[value] ?? value);
  const own = (COMPONENTS as Partial<Record<string, { optionLabels: Record<string, string> }>>)[key]?.optionLabels[value];
  if (own) return t(own);
  if (value === "accent") return t("Accent color");
  if (value === "text") return t("Text color");
  if (value === "default") return t("Theme default");
  if (value === "none") return t("None");
  if (isHue(value)) return t(COMPONENTS.decorColor.optionLabels[value]);
  return value;
}

/** The "auto" option of a Customize row: what the current look gives it. */
export function followLookLabel(s: NoteStyleSettings, key: ComponentKey): string {
  const look = LOOKS.find((l) => l.id === resolveNoteStyle(s).look) ?? LOOKS[0];
  return t("Follow look ({value})").replace("{value}", optionLabel(key, look.recipe[key]));
}

/** The override notice: which keys keep the user's own value, and whether
 * the notice shows (only once a palette or look is chosen). */
export function overrideSummary(s: NoteStyleSettings): { n: number; items: string[]; text: string; visible: boolean } {
  const keys = overriddenKeys(s);
  const own = loose(s);
  const items = keys.map((key) => {
    const label = t((COMPONENTS as Partial<Record<string, { label: string }>>)[key]?.label ?? COLOR_KEY_LABELS[key as ColorKey]);
    const value = optionLabel(key, String(own[key]));
    return tl({ en: `${label} (${value})`, zh: `${label}（${value}）` });
  });
  const n = keys.length;
  // A full-width "）" already carries its own space: no second one before the dot.
  const text = n === 0 ? "" : tn(
    "1 component keeps your own setting and does not follow the style: {list}",
    "{n} components keep your own setting and do not follow the style: {list}",
    n,
  ).replace("{list}", items.join(tl({ en: " · ", zh: "· " })));
  const { palette, look } = resolveNoteStyle(s);
  return { n, items, text, visible: n > 0 && (palette !== "classic" || look !== "classic") };
}

/* ---------- cards ---------- */

let serial = 0;

/** A radio card with the shared foot: name (plus the English name in the
 * Chinese UI) and the one-line description it is described by. */
function galleryCard(grid: HTMLElement, idBase: string, def: PaletteDef | LookDef): { card: HTMLElement; body: HTMLElement } {
  const name = tl(def.name);
  const english = name !== def.name.en ? def.name.en : "";
  const subId = `${idBase}-${def.id}`;
  const card = grid.createDiv({
    cls: "nf-gallery-card",
    attr: {
      role: "radio", "aria-checked": "false", tabindex: "-1", "data-id": def.id,
      "aria-label": english ? `${name} ${english}` : name, "aria-describedby": subId,
    },
  });
  const body = card.createDiv();
  const foot = card.createDiv({ cls: "nf-gallery-foot" });
  const nameEl = foot.createDiv({ cls: "nf-gallery-name", text: name });
  if (english) nameEl.createEl("small", { text: english });
  foot.createDiv({ cls: "nf-gallery-sub", text: tl(def.desc), attr: { id: subId } });
  return { card, body };
}

/** A palette card's live mini page, drawn with that palette's own tokens
 * (`.nf-palette-preview[data-palette]`), whatever palette the body has. */
function paletteMini(body: HTMLElement, def: PaletteDef): void {
  body.addClass("nf-mini", "nf-palette-preview");
  body.setAttrs({ "data-palette": def.id, "aria-hidden": "true" });
  body.createDiv({ cls: "nf-mini-h", text: tl({ en: "Aa Heading", zh: "Aa 标题" }) });
  const para = body.createDiv({ cls: "nf-mini-p", text: tl({ en: "Text", zh: "正文" }) });
  for (const hue of def.inkHues) {
    para.appendText(" ");
    para.createEl("b", { text: tl({ en: "Aa", zh: INK_GLYPH[hue] ?? "Aa" }) }).setCssStyles({ color: `var(--nf-${hue})` });
  }
  const wash = body.createDiv({ cls: "nf-mini-wash" });
  for (const hue of STYLE_HUES) {
    wash.createEl("i").setCssProps({
      "--w": `var(--nf-${hue}-rgb)`, "--k": `var(--nf-${hue})`, "--a": hue === "yellow" ? ".2" : ".18",
    });
  }
  const callout = body.createDiv({ cls: "nf-mini-co" });
  callout.createEl("b", { text: tl({ en: "Tip", zh: "提示" }) });
  callout.appendText(tl({ en: "A quiet callout", zh: "安静的标注" }));
  const row = body.createDiv({ cls: "nf-mini-row" });
  row.createSpan({ cls: "dot" });
  row.appendText(tl({ en: "List", zh: "列表" }));
  row.createSpan({ cls: "bar" });
  row.appendText(tl({ en: "Quote", zh: "引用" }) + " ");
  row.createEl("code", { text: "code" });
}

/** A look card's schematic page (bars, not text), drawn in `palette`. */
function lookThumb(body: HTMLElement, def: LookDef, palette: string): void {
  body.addClass("nf-look-thumb", "nf-palette-preview");
  body.setAttrs({ "data-palette": palette, "data-look": def.id, "aria-hidden": "true" });
  body.createDiv({ cls: "t-h1" });
  const first = body.createDiv({ cls: "t-p" });
  first.createEl("i").setCssStyles({ width: "26%" });
  first.createEl("b");
  first.createEl("i").setCssStyles({ width: "24%" });
  body.createDiv({ cls: "t-p" }).createEl("i").setCssStyles({ width: "72%" });
  body.createDiv({ cls: "t-co" }).createEl("s");
  const table = body.createDiv({ cls: "t-tb" });
  for (let i = 0; i < 9; i++) table.createEl("i");
  // Decorative: the editorial look's small-caps kicker (sample text, so
  // it speaks the UI's language: a Chinese page runs a 栏目 label there).
  if (def.id === "editorial") body.createSpan({ cls: "t-kicker", text: tl({ en: "KICKER", zh: "栏目" }) });
}

/* ---------- the section ---------- */

/** One native Obsidian 1.13 settings card (`.setting-group > .setting-items`)
 * for a run of rows, so they share a rounded card with dividers like the
 * tab's own groups. Returns the list the rows go into. */
function settingCard(parent: HTMLElement): HTMLElement {
  return parent.createDiv({ cls: "setting-group" }).createDiv({ cls: "setting-items" });
}

export function renderNoteStyleSection(
  containerEl: HTMLElement,
  host: NoteStyleHost,
): { el: HTMLElement; refresh(): void; destroy(): void } {
  const idBase = `nf-sg-${++serial}`;
  const el = containerEl.createDiv({ cls: "nf-style-section" });
  let hintDismissed = false;
  let quiet = false;
  let destroyed = false;

  const persist = async () => {
    try {
      await host.save();
    } catch (error) {
      console.warn("Notion Flow: saving the note style failed", error);
    }
    host.changed();
  };
  /** A plain settings value changed: show it at once, then save. */
  const commit = async () => {
    host.apply();
    sync();
    await persist();
  };
  const storedComponent = (key: ComponentKey) => {
    const v = loose(host.settings)[key];
    return typeof v === "string" && COMPONENTS[key].values.includes(v) ? v : "auto";
  };
  const storedSurface = () => {
    const v = loose(host.settings).paletteSurface;
    return v === "page" || v === "app" ? v : "theme";
  };

  // 1. Heading.
  new Setting(el)
    .setName(t("Note style"))
    .setDesc(t("One palette and one look for everything the plugin draws in your notes. Display only: your Markdown never changes."))
    .setHeading();

  // 2. Palettes.
  new Setting(settingCard(el))
    .setName(t("Palette"))
    .setDesc(t("Recolor text colors, highlights, callouts, tables, list and quote accents, inline code and code blocks with one coordinated palette. Already-colored notes follow; their Markdown does not change."))
    .setClass("nf-style-gallery-row");
  const paletteGrid = el.createDiv({
    cls: "nf-gallery nf-gallery-palettes", attr: { role: "radiogroup", "aria-label": t("Palette") },
  });
  for (const def of PALETTES) paletteMini(galleryCard(paletteGrid, `${idBase}-palette`, def).body, def);

  // 3. Paper background; 4. tinted headings, palette links: one card.
  const options = settingCard(el);
  let paperDropdown!: DropdownComponent;
  const paper = new Setting(options)
    .setName(t("Paper background"))
    .setDesc(t("Lay the palette's paper tone under your notes. Note page tints only the note area; Whole app also repaints sidebars and dialogs."))
    .addDropdown((dd) => {
      paperDropdown = dd;
      dd.addOption("theme", t("Theme background"));
      dd.addOption("page", t("Note page"));
      dd.addOption("app", t("Whole app"));
      dd.setValue(storedSurface());
      dd.onChange((value) => {
        if (quiet) return;
        host.settings.paletteSurface = value;
        void commit();
      });
    });
  const paperNote = paper.descEl.createSpan({
    cls: "nf-setting-note", text: ` ${t("Designed for the default theme; a community theme may only partly follow.")}`,
  });

  const paletteToggle = (name: string, desc: string, key: "paletteHeadings" | "paletteLinks") => {
    let toggle!: ToggleComponent;
    const setting = new Setting(options)
      .setName(name)
      .setDesc(desc)
      .addToggle((tg) => {
        toggle = tg;
        tg.setValue(loose(host.settings)[key] === true).onChange((value) => {
          if (quiet) return;
          host.settings[key] = value;
          void commit();
        });
      });
    return { setting, toggle };
  };
  const headings = paletteToggle(t("Tinted headings"), t("Headings 1–3 take a deep ink of the palette's key color."), "paletteHeadings");
  const links = paletteToggle(t("Links use the palette"), t("Links take the palette's blue ink instead of the accent color."), "paletteLinks");

  // 5. Looks.
  new Setting(settingCard(el))
    .setName(t("Note look"))
    .setDesc(t("The shape of callouts, headings, highlights, tables, quotes and other blocks. Combine freely with any palette."))
    .setClass("nf-style-gallery-row");
  const lookGrid = el.createDiv({
    cls: "nf-gallery nf-gallery-looks", attr: { role: "radiogroup", "aria-label": t("Note look") },
  });
  const initial = resolveNoteStyle(host.settings);
  const thumbs = LOOKS.map((def) => {
    const { body } = galleryCard(lookGrid, `${idBase}-look`, def);
    lookThumb(body, def, initial.palette);
    return body;
  });

  // 6. Suggested look.
  const hint = el.createDiv({ cls: "nf-style-hint" });
  const hintText = hint.createSpan();
  const hintButton = hint.createEl("button", { text: t("Apply") });
  hintButton.addEventListener("click", () => {
    const look = suggestionFor(host.settings);
    if (!look) return;
    void chooseLook(look.id);
    // The button disappears with the hint: keep keyboard focus on the choice.
    lookGrid.querySelector<HTMLElement>(`[role="radio"][data-id="${look.id}"]`)?.focus();
  });

  // 7. Override notice.
  const notice = el.createDiv({ cls: "nf-style-overrides" });
  const noticeText = notice.createSpan();
  const followButton = notice.createEl("button", { cls: "mod-muted", text: t("Follow the style for all") });
  followButton.addEventListener("click", () => void followStyle());

  // 8. Customize components.
  const details = el.createEl("details", { cls: "nf-style-custom" });
  const summary = details.createEl("summary", { text: t("Customize components") });
  const chip = summary.createSpan({ cls: "nf-style-modified" });
  // Opened once, for whoever already has overrides; the user owns it after that.
  details.open = overriddenKeys(host.settings).length > 0;
  const dropdowns = new Map<ComponentKey, DropdownComponent>();
  const components = settingCard(details);
  for (const key of COMPONENT_KEYS) {
    const def = COMPONENTS[key];
    const setting = new Setting(components).setName(t(def.label)).addDropdown((dd) => {
      dropdowns.set(key, dd);
      dd.addOption("auto", followLookLabel(host.settings, key));
      for (const value of def.values) dd.addOption(value, optionLabel(key, value));
      dd.setValue(storedComponent(key));
      dd.onChange((value) => {
        if (quiet) return;
        host.settings[key] = value;
        void commit();
      });
    });
    if (def.gate) host.dependsOn(setting, GATE_SETTING[def.gate]);
  }

  /* ---- behaviour ---- */

  const choosePalette = async (id: string) => {
    hintDismissed = false;
    if (host.settings.palette === id) return sync();
    host.settings.palette = id;
    await commit();
  };
  const chooseLook = async (id: string) => {
    hintDismissed = true;
    if (host.settings.look === id) return sync();
    host.settings.look = id;
    await commit();
  };
  // The galleries, the hint and notice buttons and the disclosure sit
  // between rows: keep them in Settings' Tab order.
  keepInSettingsTabOrder(el);
  bindRadioGrid(paletteGrid, (card) => void choosePalette(card.getAttr("data-id") ?? ""));
  bindRadioGrid(lookGrid, (card) => void chooseLook(card.getAttr("data-id") ?? ""));

  const followStyle = async () => {
    const hadFocus = el.doc.activeElement === followButton;
    Object.assign(host.settings, followAll());
    host.apply();
    quiet = true;
    try {
      for (const dd of dropdowns.values()) dd.setValue("auto");
    } finally {
      quiet = false;
    }
    sync();
    // The notice (and its button) is gone: continue from the disclosure.
    if (hadFocus) summary.focus();
    await persist();
    if (!destroyed) host.redisplay?.();
  };

  const communityTheme = () => {
    const theme = (host.app as unknown as { customCss?: { theme?: unknown } }).customCss?.theme;
    return typeof theme === "string" && theme !== "";
  };

  /** Bring every row and card in line with host.settings, in place. */
  function sync(): void {
    if (destroyed) return;
    const s = host.settings;
    const style = resolveNoteStyle(s);
    syncRadioGrid(paletteGrid, style.palette);
    syncRadioGrid(lookGrid, style.look);
    const mods = galleryModifiers(s);
    for (const cls of MODIFIERS) paletteGrid.toggleClass(cls, mods.includes(cls));
    for (const thumb of thumbs) thumb.setAttr("data-palette", style.palette);

    const classic = style.palette === "classic";
    for (const row of [paper, headings.setting, links.setting]) {
      row.setDisabled(classic);
      row.settingEl.toggleClass("nf-setting-dependent", classic);
    }
    paperNote.toggle(communityTheme() && storedSurface() === "app");

    const suggested = hintDismissed ? null : suggestionFor(s);
    hint.toggle(!!suggested);
    if (suggested) hintText.setText(t("Try the {look} look with this palette").replace("{look}", tl(suggested.name)));

    const overrides = overrideSummary(s);
    notice.toggle(overrides.visible);
    noticeText.setText(overrides.text);
    chip.toggle(overrides.n > 0);
    chip.setText(t("{n} changed").replace("{n}", String(overrides.n)));

    for (const [key, dd] of dropdowns) {
      const option = dd.selectEl.options[0];
      const label = followLookLabel(s, key);
      if (!option || option.text === label) continue;
      option.text = label;
      // Refit the select to the renamed option when it is the one showing.
      if (dd.getValue() === "auto") dd.setValue("auto");
    }
  }

  sync();

  return {
    el,
    /** Re-read host.settings (a colour row, Reset or the switcher changed it). */
    refresh() {
      if (destroyed) return;
      quiet = true;
      try {
        paperDropdown.setValue(storedSurface());
        headings.toggle.setValue(loose(host.settings).paletteHeadings === true);
        links.toggle.setValue(loose(host.settings).paletteLinks === true);
        for (const [key, dd] of dropdowns) dd.setValue(storedComponent(key));
      } finally {
        quiet = false;
      }
      sync();
    },
    destroy() {
      destroyed = true;
    },
  };
}
