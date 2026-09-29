import { App, Component, MarkdownRenderer } from "obsidian";
import { t, tl } from "../i18n";
import { CODE_THEME_IDS, COLOR_VALUES, STYLE_HUES } from "../features/style-presets";
import type { Bilingual, NoteStyleSettings } from "../features/style-presets";

/* Settings previews for the note style (DESIGN-SPEC §7): the radio-card grid
 * behaviour every gallery in the tab shares (palette and look galleries in
 * style-gallery.ts, the code-theme gallery here), the colour dots before the
 * four colour dropdowns, the live Markdown preview card and the code-theme
 * gallery.
 *
 * The lowest UI layer: it imports only obsidian, ../i18n and the pure style
 * model, and style-gallery.ts imports it (never the reverse). Side-effect
 * free at import, and cross-window safe: Settings is its own window in
 * Obsidian 1.13, so everything goes through the element's own `win`.
 *
 * Nothing here re-renders on a style change. Obsidian mirrors the main
 * window's body classes and inline properties into the Settings window, so
 * the dots, the preview card and the "Follow palette" code card follow the
 * palette, look and colour settings through CSS alone. */

/** Code-block theme id → English i18n key: the code gallery's card names
 * and the override notice's values. The only copy (main.ts's code-theme
 * dropdown became this gallery). */
export const CODE_THEME_LABELS: Readonly<Record<string, string>> = {
  default: "Theme default",
  obsidian: "Obsidian adaptive",
  github: "GitHub",
  vscode: "VS Code",
  "one-dark": "One Dark",
  catppuccin: "Catppuccin",
  "tokyo-night": "Tokyo Night",
  gruvbox: "Gruvbox",
  dracula: "Dracula",
  nord: "Nord",
  solarized: "Solarized",
};

/* ---------- radio-card grids ---------- */

const RADIO = '[role="radio"]';

/** Where a key moves focus in a grid of `count` cards laid out in `columns`
 * columns, or null for a key the grid does not handle. ←/→ wrap; ↓ falls
 * back to the last card when it sits in a later, shorter row; ↑ stops at
 * the first row. */
export function gridMove(index: number, key: string, count: number, columns: number): number | null {
  if (count <= 0) return null;
  const cols = Math.max(1, Math.floor(columns) || 1);
  const last = count - 1;
  const i = Math.min(Math.max(0, Math.floor(index) || 0), last);
  switch (key) {
    case "ArrowRight": return (i + 1) % count;
    case "ArrowLeft": return (i - 1 + count) % count;
    case "ArrowDown":
      if (i + cols < count) return i + cols;
      return Math.floor(last / cols) > Math.floor(i / cols) ? last : i;
    case "ArrowUp": return i - cols >= 0 ? i - cols : i;
    case "Home": return 0;
    case "End": return last;
    default: return null;
  }
}

/** The grid's current column count, read from its own window (Settings is a
 * popout: the main window's getComputedStyle would see another document). */
export function columnsOf(grid: HTMLElement): number {
  const value = grid.win?.getComputedStyle(grid).gridTemplateColumns ?? "";
  if (!value || value === "none") return 1;
  return value.split(" ").filter(Boolean).length || 1;
}

const cardsOf = (grid: HTMLElement) => Array.from(grid.querySelectorAll<HTMLElement>(RADIO));

/** Keyboard and click behaviour of a `[role=radiogroup]` of cards: arrows,
 * Home and End move focus (not the selection), Enter and Space select, a
 * click focuses and selects. Escape and modified keys pass through, so
 * Escape still closes Settings. Listeners live on the grid only. */
export function bindRadioGrid(grid: HTMLElement, activate: (card: HTMLElement) => void): void {
  const cardFrom = (target: EventTarget | null): HTMLElement | null => {
    const el = target as HTMLElement | null;
    const card = el && typeof el.closest === "function" ? el.closest<HTMLElement>(RADIO) : null;
    return card && grid.contains(card) ? card : null;
  };
  grid.addEventListener("keydown", (evt) => {
    if (evt.altKey || evt.ctrlKey || evt.metaKey || evt.isComposing) return;
    const card = cardFrom(evt.target);
    if (!card) return;
    if (evt.key === "Enter" || evt.key === " " || evt.key === "Spacebar") {
      // Space would scroll the settings pane.
      evt.preventDefault();
      activate(card);
      return;
    }
    const cards = cardsOf(grid);
    const next = gridMove(cards.indexOf(card), evt.key, cards.length, columnsOf(grid));
    if (next === null) return;
    evt.preventDefault();
    cards[next]?.focus();
  });
  grid.addEventListener("click", (evt) => {
    const card = cardFrom(evt.target);
    if (!card) return;
    card.focus();
    activate(card);
  });
}

/** Check the card whose data-id is `checkedId` and give it the grid's one
 * tabindex="0" (the first card's when none matches): roving tabindex, so Tab
 * enters a grid on its checked card and leaves on the next row. */
export function syncRadioGrid(grid: HTMLElement, checkedId: string): void {
  const cards = cardsOf(grid);
  const checked = cards.find((card) => card.getAttr("data-id") === checkedId) ?? null;
  cards.forEach((card, i) => {
    const on = card === checked;
    card.setAttr("aria-checked", on ? "true" : "false");
    card.setAttr("tabindex", (checked ? on : i === 0) ? "0" : "-1");
  });
}

/** Obsidian's navigable settings rows, and the scopes whose controls its
 * Tab sequence contains (Settings in 1.13). */
const SETTING_ROW = ".setting-item:not(.setting-item-heading)";
const ROW_SCOPE = ".setting-item, .setting-group-search";
const TABBABLE = ["a[href]", "button", "input", "select", "textarea", "summary", "[tabindex]"]
  .map((s) => `${s}:not([disabled]):not([tabindex="-1"])`).join(", ");

/** Obsidian 1.13's Settings runs Tab through a sequence of its own: the
 * setting rows and the controls inside rows. What a section places between
 * rows — a gallery's tab stop, a hint's button, a disclosure's summary —
 * would be stepped over. This merges those into the sequence, in document
 * order, for Tab and Shift+Tab pressed inside `root`; every other step is
 * left to Obsidian. A focused card stands for its grid's tab stop. */
export function keepInSettingsTabOrder(root: HTMLElement): void {
  root.addEventListener("keydown", (evt) => {
    if (evt.key !== "Tab" || evt.defaultPrevented || evt.altKey || evt.ctrlKey || evt.metaKey || evt.isComposing) return;
    const focused = root.doc.activeElement as HTMLElement | null;
    if (!focused || !root.contains(focused)) return;
    const grid = focused.closest<HTMLElement>('[role="radiogroup"]');
    const from = grid?.querySelector<HTMLElement>(`${RADIO}[tabindex="0"]`) ?? focused;
    const own = (el: Element) => root.contains(el) && !el.closest(ROW_SCOPE);
    const shown = (el: HTMLElement) => (typeof el.isShown === "function" ? el.isShown() : true);
    const scope = root.closest<HTMLElement>(".vertical-tab-content") ?? root;
    const sequence = Array.from(scope.querySelectorAll<HTMLElement>(`${SETTING_ROW}, ${TABBABLE}`))
      .filter((el) => shown(el) && (el.matches(SETTING_ROW) || el.closest(ROW_SCOPE) !== null || own(el)));
    const at = sequence.indexOf(from);
    const next = at < 0 ? undefined : sequence[at + (evt.shiftKey ? -1 : 1)];
    if (!next || !(own(from) || own(next))) return;
    evt.preventDefault();
    next.focus({ focusVisible: true } as FocusOptions);
  });
}

/* ---------- colour dots ---------- */

export type DotKey = "listMarkerColor" | "quoteBarColor" | "inlineCodeColor" | "tableHeaderColor";

/** What each key's `auto` paints: the palette's token, with today's colour
 * as the fallback under Classic (the same expressions computeBodyStyle
 * writes for the notes). */
const AUTO_DOT: Record<DotKey, string> = {
  listMarkerColor: "var(--nf-style-list-marker, var(--interactive-accent))",
  quoteBarColor: "var(--nf-style-quote-bar, var(--text-normal))",
  inlineCodeColor: "var(--nf-style-inline-code, var(--nf-red))",
  // An untinted header is whatever the table CSS paints (--nf-dot-thead,
  // set on the dot by body class: the Notion-style wash, which carries the
  // palette's header under auto, or the ruled/card look's header).
  tableHeaderColor: "var(--nf-dot-thead, var(--nf-style-thead, var(--table-header-background)))",
};
/** The theme's own colour behind each key's `default`. */
const DEFAULT_DOT: Record<DotKey, string> = {
  listMarkerColor: "var(--list-marker-color)",
  quoteBarColor: "var(--blockquote-border-color)",
  // The --code-normal the dot inherits. A palette (code theme Follow
  // palette) and every code theme set the notes' --code-normal on the note
  // views only, so styles.css lists `.nf-setting-dot[data-key=
  // "inlineCodeColor"]` beside those selectors; without that the dot shows
  // the theme's root value while notes show another.
  inlineCodeColor: "var(--code-normal)",
  tableHeaderColor: "var(--nf-dot-thead, var(--table-header-background))",
};

/** The colour a dot shows for one stored value of a colour key. Every value
 * is a CSS expression that resolves in the dot's own window, so hues and
 * `auto` follow the palette through the mirrored body tokens. A value the
 * key does not offer paints like `auto`. */
export function dotPaint(key: DotKey, value: string): { color: string; none: boolean } {
  const offered = (COLOR_VALUES[key] as readonly string[] | undefined) ?? [];
  const v = offered.includes(value) ? value : "auto";
  if (v === "auto") return { color: AUTO_DOT[key] ?? "transparent", none: false };
  if (v === "default") return { color: DEFAULT_DOT[key], none: false };
  if (v === "accent") return { color: "var(--interactive-accent)", none: false };
  if (v === "text") return { color: "var(--text-normal)", none: false };
  if (v === "none") return { color: "transparent", none: true };
  if ((STYLE_HUES as readonly string[]).includes(v)) {
    // The -rgb triplets are comma-separated: rgba(), never `rgb(… / a)`.
    return { color: key === "tableHeaderColor" ? `rgba(var(--nf-${v}-rgb), 0.16)` : `var(--nf-${v})`, none: false };
  }
  return { color: AUTO_DOT[key], none: false };
}

/** A swatch before a colour row's dropdown, as its legend. It repaints on
 * the select's own change and on refresh() (Follow-all, Reset). `data-key`
 * lets CSS follow a look that hides the coloured part (a pull quote has no
 * bar). */
export function colorDot(setting: { controlEl: HTMLElement }, key: DotKey, getValue: () => string): { refresh(): void } {
  const { controlEl } = setting;
  const dot = controlEl.createSpan({ cls: "nf-setting-dot", attr: { "aria-hidden": "true", "data-key": key }, prepend: true });
  const paint = (value: string) => {
    const { color, none } = dotPaint(key, value);
    dot.setCssProps({ "--nf-dot": color });
    dot.toggleClass("is-none", none);
  };
  const select = controlEl.querySelector("select");
  select?.addEventListener("change", () => paint(select.value));
  paint(getValue());
  return { refresh: () => paint(getValue()) };
}

/* ---------- live preview card ---------- */

/** The note the preview card renders: one of everything a style changes.
 * The to-do shares the bullet list (one list gap less in a clipped card),
 * and the blank line keeps the quote from nesting inside the ordered item. */
export const PREVIEW_SAMPLE: Bilingual = {
  en: [
    "## Weekly review",
    "Plain text with `inline code`, a ==highlight== and <span style=\"color:var(--nf-red, #b5554d)\">red ink</span>.",
    "- A bullet point",
    "- [ ] A small to-do",
    "1. A numbered step",
    "",
    "> A quiet quote.",
    "",
    "> [!tip] Tip",
    "> Callouts follow the look.",
    "",
    "```js",
    "const done = true; // comment",
    "```",
  ].join("\n"),
  zh: [
    "## 每周回顾",
    "正文里有 `行内代码`、==高亮== 和<span style=\"color:var(--nf-red, #b5554d)\">朱红墨色</span>。",
    "- 列表项",
    "- [ ] 一个小待办",
    "1. 编号步骤",
    "",
    "> 一段安静的引用。",
    "",
    "> [!tip] 提示",
    "> 标注跟随版式变化。",
    "",
    "```js",
    "const done = true; // 注释",
    "```",
  ].join("\n"),
};

/** A clipped, inert Reading view of PREVIEW_SAMPLE, rendered once. Palette,
 * look and colour changes reach it through the mirrored body classes, so it
 * never re-renders. The caller owns `component`: load() it before this call
 * (embedded children load with it) and unload() it when the tab hides. */
export function renderSettingsPreview(el: HTMLElement, app: App, component: Component): HTMLElement {
  el.createDiv({ cls: "nf-settings-preview-label", text: t("Preview") });
  const root = el.createDiv({ cls: "markdown-reading-view nf-settings-preview", attr: { "aria-label": t("Preview") } });
  // No focus, clicks or selection inside: the to-do, links and copy button stay inert.
  root.setAttr("inert", "");
  const inner = root.createDiv({ cls: "markdown-preview-view markdown-rendered" });
  MarkdownRenderer.render(app, tl(PREVIEW_SAMPLE), inner, "", component)
    .catch((error) => console.warn("Notion Flow: settings preview", error));
  return root;
}

/* ---------- code-theme gallery ---------- */

/** Fixed dark palettes: they stay dark on a light page. */
export const DARK_ONLY_CODE_THEMES: readonly string[] = ["one-dark", "dracula", "nord"];

export interface CodeThemeHost {
  settings: NoteStyleSettings;
  save(): Promise<void>;
  apply(): void;
  /** After a pick is saved. Required, as NoteStyleHost.changed: the note
   * style section's override notice and chip count the code theme too. */
  changed(): void;
}

/** The gallery's cards: "Follow palette" first, then every code theme. */
export function codeThemeOptions(): Array<{ id: string; label: string; darkOnly: boolean }> {
  return [
    { id: "auto", label: t("Follow palette"), darkOnly: false },
    ...CODE_THEME_IDS.map((id) => ({ id, label: t(CODE_THEME_LABELS[id] ?? id), darkOnly: DARK_ONLY_CODE_THEMES.includes(id) })),
  ];
}

/** Three lines of code, one span per token class (`null` = plain text). */
const CODE_LINES: ReadonlyArray<ReadonlyArray<readonly [string | null, string]>> = [
  [["kw", "const"], [null, " n "], ["op", "="], [null, " "], ["val", "42"], ["punct", ";"]],
  [["fn", "greet"], ["punct", "("], ["str", "\"hi\""], ["punct", ")"], [null, " "], ["cm", "// ok"]],
  [["punct", "<"], ["tag", "a"], [null, " "], ["prop", "href"], ["op", "="], ["str", "\"#\""], ["punct", ">"]],
];

/** One card per code theme, each drawn with that theme's own tokens
 * (`[data-code-theme]`), whatever theme the notes use now. */
export function codeThemeGallery(containerEl: HTMLElement, host: CodeThemeHost): { el: HTMLElement; refresh(): void } {
  const grid = containerEl.createDiv({
    cls: "nf-gallery nf-code-gallery", attr: { role: "radiogroup", "aria-label": t("Code block theme") },
  });
  for (const option of codeThemeOptions()) {
    const badge = option.darkOnly ? t("Dark only") : "";
    const card = grid.createDiv({
      cls: "nf-gallery-card nf-code-card",
      attr: {
        role: "radio", "aria-checked": "false", tabindex: "-1", "data-id": option.id,
        "aria-label": badge ? tl({ en: `${option.label} (${badge})`, zh: `${option.label}（${badge}）` }) : option.label,
      },
    });
    const sample = card.createDiv({ cls: "nf-code-sample", attr: { "data-code-theme": option.id, "aria-hidden": "true" } });
    for (const tokens of CODE_LINES) {
      const line = sample.createDiv();
      for (const [kind, text] of tokens) {
        if (kind) line.createSpan({ cls: `nf-ct-${kind}`, text });
        else line.appendText(text);
      }
    }
    const name = card.createDiv({ cls: "nf-gallery-foot" }).createDiv({ cls: "nf-gallery-name", text: option.label });
    if (badge) name.createSpan({ cls: "nf-code-badge", text: badge });
  }

  const stored = () => {
    const v = (host.settings as Partial<Record<string, unknown>>).codeTheme;
    return typeof v === "string" && (CODE_THEME_IDS as readonly string[]).includes(v) ? v : "auto";
  };
  const sync = () => syncRadioGrid(grid, stored());
  bindRadioGrid(grid, (card) => {
    const id = card.getAttr("data-id") ?? "auto";
    if (host.settings.codeTheme === id) return sync();
    host.settings.codeTheme = id;
    host.apply();
    sync();
    void (async () => {
      try {
        await host.save();
      } catch (error) {
        console.warn("Notion Flow: saving the code theme failed", error);
      }
      host.changed();
    })();
  });
  sync();
  return { el: grid, refresh: sync };
}
