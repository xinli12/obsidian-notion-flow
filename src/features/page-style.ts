import { Notice, TFile, type App, type Menu, type Plugin } from "obsidian";
import { t, tl } from "../i18n";

/* Per-page style, the way Notion sets it per page: a font (Default, Serif,
 * Mono, Kai), Small text and Full width. Stored as the note's own
 * frontmatter `cssclasses`, so it is plain Markdown that travels with the
 * note; Obsidian puts the classes on .markdown-source-view and
 * .markdown-preview-view, and styles.css does the rest. Offered from the
 * pane's ⋯ menu (plain-text items, so they work with native menus) and as
 * commands. */

export type PageFont = "default" | "serif" | "mono" | "kai";
export const PAGE_FONT_CLASSES: Record<Exclude<PageFont, "default">, string> = {
  serif: "nf-serif",
  mono: "nf-mono",
  kai: "nf-kai",
};
export const PAGE_SMALL_CLASS = "nf-small";
export const PAGE_WIDE_CLASS = "nf-wide";
export type PageStyleChange = { font: PageFont } | { small: boolean } | { wide: boolean } | { toggle: "small" | "wide" };

const FONT_ORDER: readonly Exclude<PageFont, "default">[] = ["serif", "mono", "kai"];

/** A `cssclasses` value as a list: a YAML list, or the older
 * "a b, c" string form; anything else is no classes. */
export function cssClassList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,]+/) : [];
  return items.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

/** The page style a `cssclasses` value sets; the first font class wins. */
export function pageStyleOf(value: unknown): { font: PageFont; small: boolean; wide: boolean } {
  const list = cssClassList(value);
  let font: PageFont = "default";
  for (const cls of list) {
    const found = FONT_ORDER.find((key) => PAGE_FONT_CLASSES[key] === cls);
    if (found) {
      font = found;
      break;
    }
  }
  return { font, small: list.includes(PAGE_SMALL_CLASS), wide: list.includes(PAGE_WIDE_CLASS) };
}

/** The `cssclasses` after a change. Pure. The person's own classes keep
 * their place; fonts are exclusive (a new one goes at the end); a flag
 * is appended or removed; repeats are dropped. */
export function nextCssClasses(current: unknown, change: PageStyleChange): string[] {
  const list: string[] = [];
  for (const cls of cssClassList(current)) if (!list.includes(cls)) list.push(cls);
  const setFlag = (cls: string, on: boolean) => {
    const at = list.indexOf(cls);
    if (on && at < 0) list.push(cls);
    else if (!on && at >= 0) list.splice(at, 1);
  };
  if ("font" in change) {
    const fonts = Object.values(PAGE_FONT_CLASSES);
    const kept = list.filter((cls) => !fonts.includes(cls));
    list.length = 0;
    list.push(...kept);
    if (change.font !== "default") list.push(PAGE_FONT_CLASSES[change.font]);
  } else if ("small" in change) setFlag(PAGE_SMALL_CLASS, change.small);
  else if ("wide" in change) setFlag(PAGE_WIDE_CLASS, change.wide);
  else {
    const cls = change.toggle === "small" ? PAGE_SMALL_CLASS : PAGE_WIDE_CLASS;
    setFlag(cls, !list.includes(cls));
  }
  return list;
}

/** Write a change into the note's frontmatter. An empty result deletes
 * the key (never `cssclasses: []`); the legacy singular `cssclass` is
 * left alone. */
export function applyPageStyle(app: App, file: TFile, change: PageStyleChange): Promise<void> {
  // Nothing to change (Default on a page without a font, say): no write,
  // so the note is not touched and no empty frontmatter appears.
  const cached = app.metadataCache.getFileCache(file)?.frontmatter?.cssclasses;
  if (sameList(cssClassList(cached), nextCssClasses(cached, change))) return Promise.resolve();
  return app.fileManager
    .processFrontMatter(file, (fm: Record<string, unknown>) => {
      const next = nextCssClasses(fm.cssclasses, change);
      if (next.length > 0) fm.cssclasses = next;
      else delete fm.cssclasses;
    })
    .catch((error: unknown) => {
      console.error("Notion Flow: updating the page style failed", error);
      new Notice(tl({ en: "Could not update the page style.", zh: "无法更新页面样式。" }));
    });
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/** The ⋯ → Page style entries, into `menu` (a submenu, or the pane menu
 * itself when submenus are unavailable). */
function populatePageStyleMenu(app: App, menu: Menu, file: TFile, section: string | null) {
  const state = pageStyleOf(app.metadataCache.getFileCache(file)?.frontmatter?.cssclasses);
  const fonts: [PageFont, string][] = [
    ["default", t("Default")],
    ["serif", t("Serif")],
    ["mono", t("Mono")],
    ["kai", t("Kai")],
  ];
  const add = (title: string, checked: boolean, change: PageStyleChange) =>
    menu.addItem((item) => {
      item.setTitle(title).setChecked(checked).onClick(() => void applyPageStyle(app, file, change));
      if (section) item.setSection(section);
    });
  for (const [font, title] of fonts) add(title, state.font === font, { font });
  if (!section) menu.addSeparator();
  add(t("Small text"), state.small, { toggle: "small" });
  add(t("Full width"), state.wide, { toggle: "wide" });
}

/** ⋯ (More options) → Page style, and the six page-style commands. */
export function registerPageStyle(plugin: Plugin): void {
  const { app } = plugin;
  plugin.registerEvent(
    app.workspace.on("file-menu", (menu, file, source) => {
      if (source !== "more-options" || !(file instanceof TFile) || file.extension !== "md") return;
      let placed = false;
      menu.addItem((item) => {
        item.setTitle(t("Page style")).setIcon("type").setSection("view");
        const withSub = item as unknown as { setSubmenu?: () => Menu };
        if (typeof withSub.setSubmenu === "function") {
          populatePageStyleMenu(app, withSub.setSubmenu(), file, null);
          placed = true;
        } else {
          // No submenu support: this row becomes the label and the
          // choices follow it inline, in the same section.
          item.setIsLabel(true);
        }
      });
      if (!placed) populatePageStyleMenu(app, menu, file, "view");
    })
  );
  const commands: [string, string, PageStyleChange][] = [
    ["page-font-default", t("Page font: Default"), { font: "default" }],
    ["page-font-serif", t("Page font: Serif"), { font: "serif" }],
    ["page-font-mono", t("Page font: Mono"), { font: "mono" }],
    ["page-font-kai", t("Page font: Kai"), { font: "kai" }],
    ["toggle-small-text", t("Toggle small text"), { toggle: "small" }],
    ["toggle-full-width", t("Toggle full width"), { toggle: "wide" }],
  ];
  for (const [id, name, change] of commands) {
    plugin.addCommand({
      id,
      name,
      checkCallback: (checking: boolean) => {
        const file = app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) void applyPageStyle(app, file, change);
        return true;
      },
    });
  }
}
