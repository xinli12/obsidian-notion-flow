import {
  Component,
  FuzzySuggestModal,
  MarkdownView,
  Menu,
  Notice,
  TFile,
  getLinkpath,
  normalizePath,
  setIcon,
  type App,
  type Plugin,
  type WorkspaceLeaf,
} from "obsidian";
import type { EditorView } from "@codemirror/view";
import { t, tl } from "../i18n";
import { guardAsync } from "../editor/safe-build";
import { NOTE_EMOJI, NOTE_EMOJI_RECENT_KEY, isEmojiChar, openIconPicker, type IconPicker } from "../ui/callout-icon-picker";

/* A Notion-style page header: an emoji icon and a cover band above the
 * note's title, edited by hovering there. Everything is plain frontmatter
 * the Properties view shows and other tools can read:
 *
 *   icon: 🚀            one emoji (anything else, e.g. an Iconize id, is ignored and never overwritten)
 *   cover: "[[a.png]]"  an image (wikilink, Markdown image, vault path or http(s) URL) or a CSS colour
 *   cover-style: dawn   a designed gradient, drawn from the palette tokens (so every palette re-skins it)
 *   cover-y: 40         the image's vertical focus, in percent
 *
 * `cover` holds only what other tools (Bases, banner plugins) can read as
 * an image, which is why a gradient lives in its own property. A valid
 * `cover` wins over `cover-style`. The header steps aside entirely while
 * Banners, Pixel Banner or Iconize is enabled. */

export const PAGE_ICON_PROP = "icon";
export const PAGE_COVER_PROP = "cover";
export const PAGE_COVER_STYLE_PROP = "cover-style";
export const PAGE_COVER_Y_PROP = "cover-y";
/** Plugins that draw their own banner or read `icon` their own way. */
export const CONFLICTING_PLUGINS = ["obsidian-banners", "pexels-banner", "obsidian-icon-folder"] as const;

export interface CoverGradient {
  id: string;
  name: { en: string; zh: string };
  css: string;
}

/** The built-in covers. Colours come only from the palette tokens, so the
 * active palette (and dark mode) re-skins every one; the ids are stored in
 * notes and must not change. */
export const COVER_GRADIENTS: readonly CoverGradient[] = [
  {
    id: "dawn",
    name: { en: "Dawn", zh: "晨曦" },
    css: "linear-gradient(120deg, rgba(var(--nf-orange-rgb), .55), rgba(var(--nf-pink-rgb), .45))",
  },
  {
    id: "mist",
    name: { en: "Mist", zh: "薄雾" },
    css: "linear-gradient(135deg, rgba(var(--nf-cyan-rgb), .35), rgba(var(--nf-blue-rgb), .45))",
  },
  {
    id: "sea-salt",
    name: { en: "Sea salt", zh: "海盐" },
    css: "linear-gradient(160deg, rgba(var(--nf-blue-rgb), .30), rgba(var(--nf-cyan-rgb), .18) 55%, rgba(var(--nf-green-rgb), .30))",
  },
  {
    id: "dusk",
    name: { en: "Dusk", zh: "暮色" },
    css: "linear-gradient(120deg, rgba(var(--nf-purple-rgb), .50), rgba(var(--nf-orange-rgb), .40))",
  },
  {
    id: "aurora",
    name: { en: "Aurora", zh: "极光" },
    css: "linear-gradient(115deg, rgba(var(--nf-green-rgb), .45), rgba(var(--nf-cyan-rgb), .40) 45%, rgba(var(--nf-purple-rgb), .45))",
  },
  {
    id: "ink",
    name: { en: "Ink wash", zh: "水墨" },
    css: "linear-gradient(180deg, rgba(var(--nf-gray-rgb), .45), rgba(var(--nf-gray-rgb), .08))",
  },
  {
    id: "forest",
    name: { en: "Forest", zh: "森林" },
    css: "linear-gradient(140deg, rgba(var(--nf-green-rgb), .55), rgba(var(--nf-yellow-rgb), .30))",
  },
  {
    id: "paper",
    name: { en: "Paper", zh: "纸笺" },
    css: "linear-gradient(160deg, rgba(var(--nf-yellow-rgb), .22), rgba(var(--nf-orange-rgb), .10))",
  },
];

export type CoverSpec =
  | { kind: "image"; link: string }
  | { kind: "url"; url: string }
  | { kind: "color"; css: string }
  | { kind: "gradient"; id: string };

export interface PageHeaderSpec {
  icon: string | null;
  cover: CoverSpec | null;
  /** 0–100: the image's vertical focus. */
  coverY: number;
}

const RE_IMAGE_PATH = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp)$/i;
const RE_HTTP = /^https?:\/\/\S+$/i;
const RE_HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RE_COLOR_FN = /^(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\([-\w\s(),.%#/]*\)$/i;
/** The header's icon control: the icon itself, or Add icon without one. */
const ICON_CONTROL = '.nf-page-icon, [data-action="add-icon"]';

/** The first string of a property (a list property holds several). */
function firstString(value: unknown): string | null {
  const item = Array.isArray(value) ? value.find((entry) => typeof entry === "string") : value;
  return typeof item === "string" && item.trim() ? item.trim() : null;
}

/** The `cover` text. An unquoted `cover: [[a.png]]` is YAML for a list
 * holding a list; it still means the wikilink. */
function coverText(value: unknown): string | null {
  if (Array.isArray(value) && Array.isArray(value[0]) && value[0].length === 1 && typeof value[0][0] === "string") {
    return `[[${value[0][0]}]]`;
  }
  return firstString(value);
}

/** A CSS colour value that is safe to put in a custom property: a hex
 * colour, a colour function, or a bare name the browser knows. Never
 * `url(`, `;`, quotes or backslashes, so nothing can load a resource or
 * smuggle in another declaration. */
function parseCoverColor(raw: string, supportsColor?: (value: string) => boolean): string | null {
  if (/url\(|[;"'`\\]/i.test(raw)) return null;
  if (RE_HEX_COLOR.test(raw) || RE_COLOR_FN.test(raw)) return !supportsColor || supportsColor(raw) ? raw : null;
  if (/^[a-z]+$/i.test(raw) && supportsColor?.(raw)) return raw.toLowerCase();
  return null;
}

function parseCover(raw: string | null, supportsColor?: (value: string) => boolean): CoverSpec | null {
  if (!raw) return null;
  const wiki = /^!?\[\[([^\]]+)\]\]$/.exec(raw);
  if (wiki) {
    const link = wiki[1].split("|")[0].trim();
    return link ? { kind: "image", link } : null;
  }
  const md = /^!?\[[^\]]*\]\((.+)\)$/.exec(raw);
  if (md) {
    let dest = md[1].trim();
    if (dest.startsWith("<") && dest.endsWith(">")) dest = dest.slice(1, -1).trim();
    if (RE_HTTP.test(dest)) return { kind: "url", url: dest };
    try {
      dest = decodeURI(dest);
    } catch {
      // A stray % stays as written.
    }
    return dest ? { kind: "image", link: dest } : null;
  }
  if (RE_HTTP.test(raw)) return { kind: "url", url: raw };
  if (RE_IMAGE_PATH.test(raw) && !/[<>"]/.test(raw)) return { kind: "image", link: raw };
  const css = parseCoverColor(raw, supportsColor);
  return css ? { kind: "color", css } : null;
}

function parseCoverY(value: unknown): number {
  const item = Array.isArray(value) ? value[0] : value;
  const n = typeof item === "number" ? item : typeof item === "string" ? parseFloat(item.trim().replace(/%$/, "")) : NaN;
  if (!Number.isFinite(n)) return 50;
  return Math.round(Math.max(0, Math.min(100, n)));
}

/** What a note's frontmatter asks the header to show. Pure. */
export function parsePageHeader(
  fm: Record<string, unknown> | null | undefined,
  supportsColor?: (value: string) => boolean
): PageHeaderSpec {
  const iconText = firstString(fm?.[PAGE_ICON_PROP]);
  const icon = iconText && isEmojiChar(iconText) ? iconText : null;
  let cover = parseCover(coverText(fm?.[PAGE_COVER_PROP]), supportsColor);
  if (!cover) {
    const style = firstString(fm?.[PAGE_COVER_STYLE_PROP])?.toLowerCase() ?? null;
    if (style && coverGradientCss(style)) cover = { kind: "gradient", id: style };
  }
  return { icon, cover, coverY: parseCoverY(fm?.[PAGE_COVER_Y_PROP]) };
}

/** The CSS of a built-in gradient, or null for an unknown id. Pure. */
export function coverGradientCss(id: string): string | null {
  return COVER_GRADIENTS.find((gradient) => gradient.id === id)?.css ?? null;
}

/** The gradient "Add cover" applies: picked by a stable hash of the
 * path, so notes get varied covers and the same note always the same. */
export function defaultCoverFor(path: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return COVER_GRADIENTS[(hash >>> 0) % COVER_GRADIENTS.length].id;
}

/** Whether `icon` holds something that is not ours to replace (an
 * Iconize id, text): then the header never offers or writes an icon. */
function iconLocked(value: unknown): boolean {
  if (value == null || value === "") return false;
  const text = firstString(value);
  return !(text && isEmojiChar(text));
}

export interface PageHeaderHost {
  enabled(): boolean;
}

type HeaderMode = "lp" | "rv";

/** One header, in one view's Live Preview sizer or Reading-view header. */
interface Mount {
  view: MarkdownView;
  mode: HeaderMode;
  target: HTMLElement;
  el: HTMLElement;
  scroller: HTMLElement | null;
  observer: MutationObserver;
  resize: ResizeObserver | null;
  height: number;
}

/** A tab whose icon shows the page emoji. */
interface TabIcon {
  el: HTMLElement;
  tab: HTMLElement;
  path: string;
  icon: string;
  observer: MutationObserver;
}

/** Private workspace fields, all optional. */
interface LeafHeaderParts {
  tabHeaderEl?: HTMLElement;
  tabHeaderInnerIconEl?: HTMLElement;
}
interface PreviewRenderer {
  header?: { el?: HTMLElement; resetCompute?: () => void } | null;
  previewEl?: HTMLElement;
  queueRender?: () => void;
}

type Frontmatter = Record<string, unknown>;

function windowOf(el: Element): Window & typeof globalThis {
  return (el.ownerDocument.defaultView ?? window) as Window & typeof globalThis;
}

/**
 * Keeps a header at the top of every Markdown leaf (both modes) in step
 * with its note's frontmatter. Refreshes are coalesced into one frame per
 * window; a header is rebuilt only when what it shows changed (typing
 * saves the note, and every save fires metadataCache `changed`).
 */
export class PageHeader extends Component {
  private readonly mounts = new Map<HTMLElement, Mount>();
  private readonly tabs = new Map<WorkspaceLeaf, TabIcon>();
  private readonly frames = new Map<Window, { id: number; paths: Set<string> | null }>();
  private picker: IconPicker | null = null;
  private menu: Menu | null = null;
  /** The header whose cover is being repositioned, and how to stop. */
  private reposition: { mount: Mount; cancel: () => void } | null = null;

  constructor(private readonly plugin: Plugin, private readonly host: PageHeaderHost) {
    super();
  }

  private get app(): App {
    return this.plugin.app;
  }

  onload(): void {
    const { workspace, metadataCache, vault } = this.app;
    const all = () => this.schedule(null);
    this.registerEvent(workspace.on("layout-change", all));
    this.registerEvent(workspace.on("file-open", all));
    this.registerEvent(workspace.on("active-leaf-change", all));
    this.registerEvent(workspace.on("css-change", all));
    this.registerEvent(workspace.on("window-open", all));
    this.registerEvent(metadataCache.on("changed", (file) => this.schedule(file.path)));
    this.registerEvent(vault.on("rename", all));
    workspace.onLayoutReady(all);
  }

  onunload(): void {
    for (const [win, frame] of this.frames) win.cancelAnimationFrame(frame.id);
    this.frames.clear();
    this.teardown();
  }

  /** Bring every header up to date now (the host calls this when its
   * setting changes). */
  refresh(): void {
    this.run(null, null);
  }

  private schedule(path: string | null) {
    const wins = new Set<Window>([window]);
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const win = leaf.view?.containerEl?.ownerDocument?.defaultView;
      if (win) wins.add(win);
    }
    for (const win of wins) {
      let frame = this.frames.get(win);
      if (!frame) {
        const next = { id: 0, paths: new Set<string>() as Set<string> | null };
        next.id = win.requestAnimationFrame(
          guardAsync("page header", () => {
            if (this.frames.get(win) !== next) return;
            this.frames.delete(win);
            this.run(win, next.paths);
          })
        );
        this.frames.set(win, (frame = next));
      }
      if (path == null) frame.paths = null;
      else frame.paths?.add(path);
    }
  }

  private active(): boolean {
    if (!this.host.enabled()) return false;
    const enabled = (this.app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins?.enabledPlugins;
    return !(enabled && CONFLICTING_PLUGINS.some((id) => enabled.has(id)));
  }

  /** Refresh the leaves in `win` (all windows for null) showing one of
   * `paths` (every leaf for null). */
  private run(win: Window | null, paths: Set<string> | null) {
    if (!this.active()) {
      this.teardown();
      return;
    }
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    const views = new Set<MarkdownView>();
    for (const leaf of leaves) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      views.add(view);
      if (win && view.containerEl.ownerDocument.defaultView !== win) continue;
      if (paths && !(view.file && paths.has(view.file.path))) continue;
      this.refreshView(view);
    }
    if (paths) return;
    // What closed leaves (or leaves now showing another view) left behind.
    for (const mount of [...this.mounts.values()]) if (!views.has(mount.view)) this.unmount(mount);
    for (const leaf of [...this.tabs.keys()]) {
      if (!leaves.includes(leaf) || !(leaf.view instanceof MarkdownView)) this.restoreTab(leaf);
    }
  }

  private refreshView(view: MarkdownView) {
    const file = view.file;
    const targets: [HeaderMode, HTMLElement | null][] = [
      ["lp", this.editTarget(view)],
      ["rv", this.readTarget(view)],
    ];
    for (const mount of [...this.mounts.values()]) {
      if (mount.view === view && !targets.some(([mode, target]) => mount.mode === mode && mount.target === target)) {
        this.unmount(mount);
      }
    }
    if (!file || file.extension !== "md") {
      for (const mount of [...this.mounts.values()]) if (mount.view === view) this.unmount(mount);
      this.restoreTab(view.leaf);
      return;
    }
    const fm = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? null) as Frontmatter | null;
    const spec = parsePageHeader(fm, (value) => this.supportsColor(view, value));
    const locked = iconLocked(fm?.[PAGE_ICON_PROP]);
    for (const [mode, target] of targets) {
      if (!target) continue;
      const mount = this.mount(view, mode, target);
      this.render(mount, file, spec, locked);
    }
    this.applyTab(view, file, spec.icon);
  }

  private supportsColor(view: MarkdownView, value: string): boolean {
    try {
      return windowOf(view.containerEl).CSS?.supports?.("color", value) ?? false;
    } catch {
      return false;
    }
  }

  /** Live Preview: the view's own `.cm-sizer` (inline title, properties
   * and the editor content live there, outside CodeMirror's content). */
  private editTarget(view: MarkdownView): HTMLElement | null {
    const sizer = (view as unknown as { editMode?: { sizerEl?: HTMLElement } }).editMode?.sizerEl;
    if (sizer) return sizer;
    return view.contentEl.querySelector<HTMLElement>(".markdown-source-view .cm-scroller > .cm-sizer");
  }

  /** Reading view: the renderer's header section (`.mod-header`), where
   * Obsidian puts the inline title and properties. */
  private readTarget(view: MarkdownView): HTMLElement | null {
    const header = this.renderer(view)?.header?.el;
    if (header) return header;
    return view.previewMode?.containerEl?.querySelector<HTMLElement>(".markdown-preview-sizer > .mod-header") ?? null;
  }

  private renderer(view: MarkdownView): PreviewRenderer | null {
    return (view.previewMode as unknown as { renderer?: PreviewRenderer } | undefined)?.renderer ?? null;
  }

  private scrollerOf(view: MarkdownView, mode: HeaderMode, target: HTMLElement): HTMLElement | null {
    if (mode === "lp") {
      const cm = (view.editor as unknown as { cm?: EditorView } | undefined)?.cm;
      return cm?.scrollDOM ?? target.closest<HTMLElement>(".cm-scroller");
    }
    return (
      this.renderer(view)?.previewEl ??
      view.previewMode?.containerEl?.querySelector<HTMLElement>(".markdown-preview-view") ??
      target.closest<HTMLElement>(".markdown-preview-view")
    );
  }

  private mount(view: MarkdownView, mode: HeaderMode, target: HTMLElement): Mount {
    const existing = this.mounts.get(target);
    if (existing && existing.view === view) {
      if (target.firstElementChild !== existing.el) target.prepend(existing.el);
      return existing;
    }
    if (existing) this.unmount(existing);
    const win = windowOf(target);
    const el = target.ownerDocument.createElement("div");
    el.className = "nf-page-header";
    el.setAttribute("data-nf-mode", mode);
    target.prepend(el);
    // Obsidian prepends the inline title and properties into the
    // Reading-view header on every switch to Reading view (and moves them
    // back into the sizer for editing): stay first. The condition is
    // what keeps our own prepend from looping.
    const observer = new win.MutationObserver(() => {
      if (el.parentElement === target && target.firstElementChild !== el) target.prepend(el);
      else if (!el.parentElement) target.prepend(el);
    });
    observer.observe(target, { childList: true });
    const mount: Mount = {
      view,
      mode,
      target,
      el,
      scroller: this.scrollerOf(view, mode, target),
      observer,
      resize: null,
      height: -1,
    };
    if (typeof win.ResizeObserver === "function") {
      const resize = new win.ResizeObserver(guardAsync("page header measure", () => this.measure(mount)));
      if (mount.scroller) resize.observe(mount.scroller);
      resize.observe(el);
      mount.resize = resize;
    }
    this.mounts.set(target, mount);
    return mount;
  }

  private unmount(mount: Mount) {
    // A Reposition in progress holds a capture Escape listener on the
    // window's document: it must not outlive its header (a closed tab).
    if (this.reposition?.mount === mount) this.reposition.cancel();
    mount.observer.disconnect();
    mount.resize?.disconnect();
    mount.el.remove();
    if (this.mounts.get(mount.target) === mount) this.mounts.delete(mount.target);
    this.afterHeightChange(mount);
  }

  /** Remove everything this instance made (disabled, a conflicting
   * plugin, unload). */
  private teardown() {
    this.reposition?.cancel();
    if (this.picker?.isOpen) this.picker.close();
    this.picker = null;
    this.menu?.hide();
    this.menu = null;
    for (const mount of [...this.mounts.values()]) this.unmount(mount);
    for (const leaf of [...this.tabs.keys()]) this.restoreTab(leaf);
  }

  private resolveImage(link: string, file: TFile): string | null {
    const { metadataCache, vault } = this.app;
    const dest =
      metadataCache.getFirstLinkpathDest(getLinkpath(link), file.path) ??
      vault.getAbstractFileByPath(normalizePath(link));
    return dest instanceof TFile ? vault.getResourcePath(dest) : null;
  }

  private render(mount: Mount, file: TFile, spec: PageHeaderSpec, locked: boolean) {
    const cover = spec.cover;
    const src =
      cover?.kind === "image" ? this.resolveImage(cover.link, file) : cover?.kind === "url" ? cover.url : null;
    const sig = JSON.stringify([spec, src, locked]);
    if (mount.el.getAttribute("data-nf-sig") === sig) return;
    mount.el.setAttribute("data-nf-sig", sig);
    if (this.reposition?.mount === mount) this.reposition.cancel();
    this.build(mount, spec, src, locked);
    this.measure(mount);
  }

  private build(mount: Mount, spec: PageHeaderSpec, src: string | null, locked: boolean) {
    const el = mount.el;
    // Rebuilding removes the icon control that holds the focus (Reading
    // view, after a pick): the new one takes it over below.
    const active = el.ownerDocument.activeElement;
    const refocus = !!active && el.contains(active) && active.matches(ICON_CONTROL);
    el.empty();
    el.toggleClass("has-cover", spec.cover != null);
    el.toggleClass("has-icon", spec.icon != null);
    if (spec.cover) this.buildCover(mount, spec.cover, spec.coverY, src);
    if (spec.icon) {
      const icon = el.createDiv({
        cls: "nf-page-icon",
        text: spec.icon,
        attr: { role: "button", tabindex: "0", "aria-label": t("Icon") },
      });
      icon.addEventListener("click", (evt) => {
        evt.preventDefault();
        this.openPicker(mount, icon);
      });
      icon.addEventListener("keydown", (evt) => {
        if (evt.key !== "Enter" && evt.key !== " ") return;
        evt.preventDefault();
        evt.stopPropagation();
        this.openPicker(mount, icon);
      });
    }
    const controls = el.createDiv({ cls: "nf-page-controls" });
    if (!spec.icon && !locked) {
      this.ghost(controls, "add-icon", "smile-plus", t("Add icon"), (button) => this.openPicker(mount, button));
    }
    if (!spec.cover) {
      this.ghost(controls, "add-cover", "image-plus", t("Add cover"), () => {
        // Notion's way: a cover at once; Change cover offers the rest.
        const file = mount.view.file;
        if (file) this.write(file, (fm) => void (fm[PAGE_COVER_STYLE_PROP] = defaultCoverFor(file.path)));
      });
    }
    if (refocus) el.querySelector<HTMLElement>(ICON_CONTROL)?.focus({ preventScroll: true });
  }

  private buildCover(mount: Mount, cover: CoverSpec, coverY: number, src: string | null) {
    const band = mount.el.createDiv({ cls: `nf-page-cover is-${cover.kind}` });
    // A click on the band itself is not a click into the note: the editor
    // keeps its focus and caret (its buttons still work).
    band.addEventListener("mousedown", (evt) => {
      if (!(evt.target as Element | null)?.closest?.("button")) evt.preventDefault();
    });
    let img: HTMLImageElement | null = null;
    if (cover.kind === "gradient") {
      band.setAttribute("data-cover-style", cover.id);
      // CSSOM, not cssText: a value can never add a second declaration.
      band.style.setProperty("--nf-page-cover-bg", coverGradientCss(cover.id) ?? "");
    } else if (cover.kind === "color") {
      band.style.setProperty("--nf-page-cover-bg", cover.css);
    } else if (!src) {
      band.addClass("is-missing");
    } else {
      const image = (img = band.createEl("img", { cls: "nf-page-cover-img", attr: { draggable: "false", alt: "" } }));
      image.style.objectPosition = `50% ${coverY}%`;
      image.addEventListener("error", () => band.addClass("is-missing"));
      image.src = src;
    }
    const actions = band.createDiv({ cls: "nf-page-cover-actions" });
    this.ghost(actions, "change", null, t("Change cover"), (button) => this.openCoverMenu(mount, button));
    if (img) {
      const image = img;
      this.ghost(actions, "reposition", null, t("Reposition"), (button) =>
        this.toggleReposition(mount, band, image, button, coverY)
      );
    }
    this.ghost(actions, "remove-cover", null, t("Remove cover"), () => {
      const file = mount.view.file;
      if (file) {
        this.write(file, (fm) => {
          delete fm[PAGE_COVER_PROP];
          delete fm[PAGE_COVER_STYLE_PROP];
          delete fm[PAGE_COVER_Y_PROP];
        });
      }
    });
  }

  private ghost(
    parent: HTMLElement,
    action: string,
    icon: string | null,
    label: string,
    onClick: (button: HTMLButtonElement) => void
  ): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "nf-page-ghost", attr: { type: "button", "data-action": action } });
    if (icon) setIcon(button.createSpan({ cls: "nf-page-ghost-icon" }), icon);
    button.createSpan({ cls: "nf-page-ghost-label", text: label });
    button.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      onClick(button);
    });
    return button;
  }

  private write(file: TFile, fn: (fm: Frontmatter) => void) {
    this.app.fileManager.processFrontMatter(file, fn).catch((error: unknown) => {
      console.error("Notion Flow: updating the page icon or cover failed", error);
      new Notice(tl({ en: "Could not update the page icon or cover.", zh: "无法更新页面图标或封面。" }));
    });
  }

  private openPicker(mount: Mount, anchor: HTMLElement) {
    const file = mount.view.file;
    if (!file) return;
    const { app } = this;
    const fm = (app.metadataCache.getFileCache(file)?.frontmatter ?? null) as Frontmatter | null;
    const current = parsePageHeader(fm).icon;
    this.picker = openIconPicker({
      doc: anchor.ownerDocument,
      anchor: () => (anchor.isConnected ? anchor.getBoundingClientRect() : null),
      lucide: false,
      emoji: NOTE_EMOJI,
      current: current ? { kind: "emoji", char: current } : null,
      defaultLabel: current ? t("Remove icon") : null,
      placeholder: tl({ en: "Type or paste an emoji", zh: "输入或粘贴表情" }),
      recent: {
        load: () => app.loadLocalStorage(NOTE_EMOJI_RECENT_KEY),
        save: (list) => app.saveLocalStorage(NOTE_EMOJI_RECENT_KEY, list),
      },
      bounds: () => mount.view.containerEl.getBoundingClientRect(),
      onPick: (choice) => {
        const char = choice?.kind === "emoji" ? choice.char : null;
        this.write(file, (fm) => {
          // Never replace an icon that is not an emoji (Iconize's ids).
          if (iconLocked(fm[PAGE_ICON_PROP])) return;
          if (char) fm[PAGE_ICON_PROP] = char;
          else delete fm[PAGE_ICON_PROP];
        });
      },
      onClose: () => {
        this.picker = null;
        this.restoreFocus(mount);
      },
    });
  }

  /** The picker took the keyboard focus along when it closed (Esc, a pick,
   * a click outside): give it back. Live Preview: the editor, whose
   * selection CodeMirror kept, so the caret is where it was. Reading view:
   * the header's icon control; a pick rebuilds the header on a later
   * frame, and build() then moves the focus to the new control. */
  private restoreFocus(mount: Mount) {
    const doc = mount.el.ownerDocument;
    const active = doc.activeElement;
    // Someone else has the focus (a click on another control): leave it.
    if (active && active !== doc.body) return;
    if (this.mounts.get(mount.target) !== mount || !mount.el.isConnected) return;
    if (this.app.workspace.getActiveViewOfType(MarkdownView) !== mount.view) return;
    if (mount.mode === "lp") {
      mount.view.editor.focus();
      return;
    }
    mount.el.querySelector<HTMLElement>(ICON_CONTROL)?.focus({ preventScroll: true });
  }

  /** Change cover: the gradients, an image from the vault, or none.
   * Plain-text items, so native menus show them too. */
  private openCoverMenu(mount: Mount, button: HTMLElement) {
    const file = mount.view.file;
    if (!file) return;
    const { app } = this;
    const fm = (app.metadataCache.getFileCache(file)?.frontmatter ?? null) as Frontmatter | null;
    const cover = parsePageHeader(fm).cover;
    const menu = new Menu();
    for (const gradient of COVER_GRADIENTS) {
      menu.addItem((item) =>
        item
          .setTitle(tl(gradient.name))
          .setChecked(cover?.kind === "gradient" && cover.id === gradient.id)
          .onClick(() =>
            // A pick means "this gradient": drop whatever `cover` held (it
            // would win) and the image's focus.
            this.write(file, (data) => {
              data[PAGE_COVER_STYLE_PROP] = gradient.id;
              delete data[PAGE_COVER_PROP];
              delete data[PAGE_COVER_Y_PROP];
            })
          )
      );
    }
    menu.addSeparator();
    menu.addItem((item) =>
      item.setTitle(t("Image from vault…")).onClick(() => {
        new CoverImageModal(app, (image) => {
          const link = app.metadataCache.fileToLinktext(image, file.path);
          this.write(file, (data) => {
            data[PAGE_COVER_PROP] = `[[${link}]]`;
            delete data[PAGE_COVER_STYLE_PROP];
            delete data[PAGE_COVER_Y_PROP];
          });
        }).open();
      })
    );
    menu.addItem((item) =>
      item.setTitle(t("Remove cover")).onClick(() =>
        this.write(file, (data) => {
          delete data[PAGE_COVER_PROP];
          delete data[PAGE_COVER_STYLE_PROP];
          delete data[PAGE_COVER_Y_PROP];
        })
      )
    );
    this.menu?.hide();
    this.menu = menu;
    menu.onHide(() => {
      if (this.menu === menu) this.menu = null;
    });
    const rect = button.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 }, button.ownerDocument);
  }

  /** Reposition: while on, a vertical drag on the image moves its focus
   * live; releasing writes `cover-y` and ends the mode. Esc or a second
   * click on Reposition ends it without writing. */
  private toggleReposition(mount: Mount, band: HTMLElement, img: HTMLImageElement, button: HTMLElement, startY: number) {
    if (this.reposition) {
      const same = this.reposition.mount === mount;
      this.reposition.cancel();
      if (same) return;
    }
    const doc = band.ownerDocument;
    let pos = startY;
    let drag: { y: number; from: number; overflow: number } | null = null;
    const show = (value: number) => (img.style.objectPosition = `50% ${value}%`);
    const onDown = (evt: PointerEvent) => {
      if (evt.button !== 0 || (evt.target as Element | null)?.closest?.(".nf-page-cover-actions")) return;
      evt.preventDefault();
      evt.stopPropagation();
      drag = { y: evt.clientY, from: pos, overflow: coverOverflow(img, band) };
      try {
        band.setPointerCapture(evt.pointerId);
      } catch {
        // Synthetic pointers cannot be captured; moves still arrive.
      }
    };
    const onMove = (evt: PointerEvent) => {
      if (!drag) return;
      evt.preventDefault();
      // Dragging the picture down shows more of its top: the focus rises.
      const delta = drag.overflow > 0 ? ((evt.clientY - drag.y) / drag.overflow) * 100 : 0;
      pos = Math.max(0, Math.min(100, drag.from - delta));
      show(pos);
    };
    const onUp = () => {
      if (!drag) return;
      const value = Math.round(pos);
      const changed = value !== Math.round(drag.from);
      drag = null;
      end();
      const file = mount.view.file;
      if (changed && file) this.write(file, (fm) => void (fm[PAGE_COVER_Y_PROP] = value));
    };
    const onKey = (evt: KeyboardEvent) => {
      if (evt.key !== "Escape") return;
      evt.preventDefault();
      evt.stopPropagation();
      cancel();
    };
    const end = () => {
      band.removeEventListener("pointerdown", onDown);
      band.removeEventListener("pointermove", onMove);
      band.removeEventListener("pointerup", onUp);
      band.removeEventListener("pointercancel", cancel);
      doc.removeEventListener("keydown", onKey, true);
      band.removeClass("is-repositioning");
      button.removeClass("is-active");
      button.setAttribute("aria-pressed", "false");
      if (this.reposition?.cancel === cancel) this.reposition = null;
    };
    const cancel = () => {
      show(startY);
      drag = null;
      end();
    };
    band.addEventListener("pointerdown", onDown);
    band.addEventListener("pointermove", onMove);
    band.addEventListener("pointerup", onUp);
    band.addEventListener("pointercancel", cancel);
    doc.addEventListener("keydown", onKey, true);
    band.addClass("is-repositioning");
    button.addClass("is-active");
    button.setAttribute("aria-pressed", "true");
    this.reposition = { mount, cancel };
  }

  /** Write the full-bleed offsets (whole px, rounded down, so the band can
   * never cause a horizontal scroll) and tell the editor about a new
   * header height. */
  private measure(mount: Mount) {
    const { el, scroller } = mount;
    if (!scroller || !el.isConnected) return;
    const box = scroller.getBoundingClientRect();
    if (box.width === 0 || scroller.clientWidth === 0) return;
    const rect = el.getBoundingClientRect();
    const inner = box.left + scroller.clientLeft;
    const bleed: [string, number][] = [
      ["--nf-bleed-left", Math.max(0, Math.floor(rect.left - inner))],
      ["--nf-bleed-right", Math.max(0, Math.floor(inner + scroller.clientWidth - rect.right))],
      ["--nf-bleed-top", Math.max(0, Math.floor(rect.top + scroller.scrollTop - box.top - scroller.clientTop))],
    ];
    for (const [name, px] of bleed) {
      const value = px + "px";
      if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
    }
    const height = Math.round(el.getBoundingClientRect().height);
    if (height !== mount.height) {
      mount.height = height;
      this.afterHeightChange(mount);
    }
  }

  /** CodeMirror caches where its content starts; Reading view caches each
   * section's height. Both must hear about a header that grew or shrank. */
  private afterHeightChange(mount: Mount) {
    try {
      if (mount.mode === "lp") {
        (mount.view.editor as unknown as { cm?: EditorView } | undefined)?.cm?.requestMeasure?.();
      } else {
        const renderer = this.renderer(mount.view);
        renderer?.header?.resetCompute?.();
        renderer?.queueRender?.();
      }
    } catch {
      // A view mid-teardown: nothing left to measure.
    }
  }

  /** The page emoji in the tab, replacing its file icon. Obsidian redraws
   * that icon on its own (renames, mode switches), so a watcher puts the
   * emoji back while the leaf still shows the note. */
  private applyTab(view: MarkdownView, file: TFile, icon: string | null) {
    const leaf = view.leaf;
    const parts = leaf as unknown as LeafHeaderParts;
    const el = parts.tabHeaderInnerIconEl;
    const tab = parts.tabHeaderEl;
    if (!icon || !el || !tab) {
      this.restoreTab(leaf);
      return;
    }
    let record = this.tabs.get(leaf);
    if (record && record.el !== el) {
      this.restoreTab(leaf);
      record = undefined;
    }
    if (!record) {
      const observer = new (windowOf(el).MutationObserver)(() => this.repaintTab(leaf));
      record = { el, tab, path: file.path, icon, observer };
      this.tabs.set(leaf, record);
      observer.observe(el, { childList: true, characterData: true, subtree: true });
    }
    record.path = file.path;
    record.icon = icon;
    this.paintTab(record);
  }

  private paintTab(record: TabIcon) {
    record.tab.addClass("nf-has-page-icon");
    if (record.el.textContent === record.icon && !record.el.querySelector("svg")) return;
    record.el.empty();
    record.el.createSpan({ cls: "nf-page-tab-emoji", text: record.icon });
  }

  private repaintTab(leaf: WorkspaceLeaf) {
    const record = this.tabs.get(leaf);
    if (!record) return;
    const view = leaf.view;
    if (!(view instanceof MarkdownView) || view.file?.path !== record.path || !this.active()) {
      this.restoreTab(leaf);
      return;
    }
    this.paintTab(record);
  }

  private restoreTab(leaf: WorkspaceLeaf) {
    const record = this.tabs.get(leaf);
    if (!record) return;
    this.tabs.delete(leaf);
    record.observer.disconnect();
    record.tab.removeClass("nf-has-page-icon");
    record.el.empty();
    try {
      setIcon(record.el, leaf.view.getIcon());
    } catch {
      // A leaf being detached has no view to ask.
    }
  }
}

/** How far an `object-fit: cover` image overflows its band vertically. */
function coverOverflow(img: HTMLImageElement, band: HTMLElement): number {
  const { naturalWidth: nw, naturalHeight: nh } = img;
  const { clientWidth: cw, clientHeight: ch } = band;
  if (!nw || !nh || !cw || !ch) return 0;
  const scale = Math.max(cw / nw, ch / nh);
  return Math.max(0, nh * scale - ch);
}

/** Change cover → Image from vault…: a fuzzy list of the vault's images. */
class CoverImageModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private readonly onPick: (file: TFile) => void) {
    super(app);
    this.setPlaceholder(tl({ en: "Search images in this vault", zh: "搜索库中的图片" }));
    this.emptyStateText = tl({ en: "No images in this vault", zh: "库中没有图片" });
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((file) => RE_IMAGE_PATH.test("." + file.extension));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onPick(file);
  }
}
