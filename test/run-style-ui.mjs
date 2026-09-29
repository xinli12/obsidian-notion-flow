import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// The note-style settings UI (src/ui/style-gallery.ts, style-switcher.ts,
// settings-preview.ts): pure helpers table-driven, then the real section,
// switcher, dots, code gallery and preview card rendered into a small fake
// DOM and driven with keys, clicks, frames and timers. The bundle carries its own
// inline obsidian stub, so it does not depend on test/obsidian-stub.mjs.

/* ---------- inline obsidian stub ---------- */
const STUB = String.raw`
export class Component {
  constructor() { this.children = []; this._loaded = false; }
  load() { this._loaded = true; }
  unload() { this._loaded = false; }
  addChild(child) { this.children.push(child); return child; }
}
export class Scope {
  constructor() { this.keys = []; }
  register(modifiers, key, func) { const handler = { modifiers, key, func }; this.keys.push(handler); return handler; }
  unregister(handler) { this.keys = this.keys.filter((h) => h !== handler); }
}
export class Modal {
  constructor(app) {
    this.app = app; this.scope = new Scope();
    const doc = globalThis.__nfFakeDoc;
    this.containerEl = doc.body.createDiv({ cls: "modal-container" });
    this.modalEl = this.containerEl.createDiv({ cls: "modal" });
    this.titleEl = this.modalEl.createDiv({ cls: "modal-title" });
    this.contentEl = this.modalEl.createDiv({ cls: "modal-content" });
  }
  open() { this.onOpen?.(); }
  close() { this.onClose?.(); }
}
export class Notice {
  constructor(message) { (globalThis.__nfNotices ??= []).push(message); }
}
export const MarkdownRenderer = {
  render(app, markdown, el, sourcePath, component) {
    (globalThis.__nfRenders ??= []).push({ app, markdown, el, sourcePath, component });
    return globalThis.__nfRenderFail ? Promise.reject(new Error("render failed")) : Promise.resolve();
  },
};
export function setIcon(el, icon) { el.setAttr("data-icon", icon); }
class DropdownComponent {
  constructor(controlEl) { this.selectEl = controlEl.createEl("select", { cls: "dropdown" }); this.disabled = false; }
  addOption(value, label) { this.selectEl.createEl("option", { value, text: label }); return this; }
  setValue(value) { this.selectEl.value = value; return this; }
  getValue() { return this.selectEl.value; }
  onChange(cb) { this.selectEl.addEventListener("change", () => cb(this.selectEl.value)); return this; }
  setDisabled(disabled) { this.disabled = disabled; this.selectEl.disabled = disabled; return this; }
}
// As Obsidian's: setValue calls the change callback when the value changes.
class ToggleComponent {
  constructor(controlEl) { this.toggleEl = controlEl.createDiv({ cls: "checkbox-container" }); this.on = false; this.disabled = false; }
  setValue(on) { if (this.on !== on) { this.on = on; this.toggleEl.toggleClass("is-enabled", on); this.cb?.(on); } return this; }
  getValue() { return this.on; }
  onChange(cb) { this.cb = cb; return this; }
  setDisabled(disabled) { this.disabled = disabled; return this; }
}
class ButtonComponent {
  constructor(controlEl) { this.buttonEl = controlEl.createEl("button"); }
  setButtonText(text) { this.buttonEl.setText(text); return this; }
  setCta() { this.buttonEl.addClass("mod-cta"); return this; }
  onClick(cb) { this.buttonEl.addEventListener("click", cb); return this; }
  setDisabled(disabled) { this.buttonEl.disabled = disabled; return this; }
}
export class Setting {
  constructor(containerEl) {
    this.settingEl = containerEl.createDiv({ cls: "setting-item" });
    this.infoEl = this.settingEl.createDiv({ cls: "setting-item-info" });
    this.nameEl = this.infoEl.createDiv({ cls: "setting-item-name" });
    this.descEl = this.infoEl.createDiv({ cls: "setting-item-description" });
    this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
    this.components = []; this.calls = []; this.disabled = false;
  }
  setName(name) { this.name = name; this.nameEl.setText(name); return this; }
  setDesc(desc) { this.desc = desc; this.descEl.setText(desc); return this; }
  setHeading() { this.heading = true; this.settingEl.addClass("setting-item-heading"); return this; }
  setClass(cls) { this.settingEl.addClass(cls); return this; }
  setDisabled(disabled) {
    this.disabled = disabled; this.calls.push(["setDisabled", disabled]);
    this.settingEl.toggleClass("is-disabled", disabled);
    for (const c of this.components) c.setDisabled(disabled);
    return this;
  }
  addDropdown(cb) { const c = new DropdownComponent(this.controlEl); this.components.push(c); cb(c); return this; }
  addToggle(cb) { const c = new ToggleComponent(this.controlEl); this.components.push(c); cb(c); return this; }
  addButton(cb) { const c = new ButtonComponent(this.controlEl); this.components.push(c); cb(c); return this; }
}
`;

/* ---------- fake DOM ---------- */
/** One compound selector part: tag, .class, [attr] and [attr="v"]. */
function matchesCompound(el, part) {
  const re = /(\.[\w-]+)|(\[([\w-]+)(?:="([^"]*)")?\])|(^[\w-]+)/g;
  let m, used = 0;
  while ((m = re.exec(part))) {
    used += m[0].length;
    if (m[1] && !el.classList.contains(m[1].slice(1))) return false;
    if (m[2] && (m[4] === undefined ? !(m[3] in el.attrs) : el.attrs[m[3]] !== m[4])) return false;
    if (m[5] && el.tag !== m[5]) return false;
  }
  return used === part.length && used > 0;
}
/** Descendant combinators only (whitespace outside brackets). */
function matches(el, selector) {
  const parts = selector.trim().match(/(?:[^\s[]+|\[[^\]]*\])+/g) ?? [];
  if (!parts.length || !matchesCompound(el, parts.at(-1))) return false;
  let i = parts.length - 2;
  for (let node = el.parent; node && i >= 0; node = node.parent) if (matchesCompound(node, parts[i])) i--;
  return i < 0;
}
class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { for (const x of c) this.set.add(x); }
  remove(...c) { for (const x of c) this.set.delete(x); }
  contains(c) { return this.set.has(c); }
  toggle(c, on = !this.set.has(c)) { on ? this.set.add(c) : this.set.delete(c); return on; }
  get value() { return [...this.set].join(" "); }
}
class El {
  constructor(doc, tag, o = {}) {
    this.doc = doc; this.win = doc.win; this.tag = tag; this.nodeType = 1;
    this.parent = null; this.children = []; this.nodes = []; this.attrs = {};
    this.classList = new ClassList(); this.style = {}; this.cssProps = {}; this.listeners = {}; this.scrolls = [];
    const opts = typeof o === "string" ? { cls: o } : o;
    if (opts.cls) this.classList.add(...[opts.cls].flat().join(" ").split(/\s+/).filter(Boolean));
    if (opts.attr) for (const [k, v] of Object.entries(opts.attr)) if (v !== null && v !== undefined) this.attrs[k] = String(v);
    if (opts.type) this.attrs.type = opts.type;
    if (opts.value !== undefined) this.value = opts.value;
    if (opts.text !== undefined) this.nodes.push({ nodeType: 3, textContent: String(opts.text) });
    if (tag === "select" || tag === "input") this.value = opts.value ?? "";
  }
  get className() { return this.classList.value; }
  get textContent() { return this.nodes.map((n) => n.textContent).join(""); }
  set textContent(v) { this.setText(v); }
  get text() { return this.textContent; }
  set text(v) { this.setText(v); }
  get options() { return this.children.filter((c) => c.tag === "option"); }
  get id() { return this.attrs.id ?? ""; }
  get isShown() { return this.style.display !== "none"; }
  createEl(tag, o = {}) {
    const el = new El(this.doc, tag, o);
    el.parent = this;
    if (o && o.prepend) { this.children.unshift(el); this.nodes.unshift(el); } else { this.children.push(el); this.nodes.push(el); }
    if (tag === "option" && this.tag === "select" && this.options.length === 1) this.value = el.value;
    return el;
  }
  createDiv(o) { return this.createEl("div", o); }
  createSpan(o) { return this.createEl("span", o); }
  appendText(s) { this.nodes.push({ nodeType: 3, textContent: String(s) }); }
  setText(s) { for (const c of this.children) c.parent = null; this.children = []; this.nodes = [{ nodeType: 3, textContent: String(s) }]; }
  empty() { for (const c of this.children) c.parent = null; this.children = []; this.nodes = []; }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent.nodes = this.parent.nodes.filter((c) => c !== this); this.parent = null; } }
  setAttr(k, v) { if (v === null || v === undefined || v === false) delete this.attrs[k]; else this.attrs[k] = String(v); }
  setAttrs(obj) { for (const [k, v] of Object.entries(obj)) this.setAttr(k, v); }
  getAttr(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.setAttr(k, v); }
  getAttribute(k) { return this.getAttr(k); }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  addClass(...c) { this.classList.add(...c); }
  removeClass(...c) { this.classList.remove(...c); }
  toggleClass(c, on) { for (const x of [c].flat()) this.classList.toggle(x, on); }
  hasClass(c) { return this.classList.contains(c); }
  toggle(show) { this.style.display = show ? "" : "none"; }
  setCssProps(props) { Object.assign(this.cssProps, props); }
  setCssStyles(styles) { Object.assign(this.style, styles); }
  instanceOf() { return true; }
  focus() { this.doc.activeElement = this; }
  blur() { if (this.doc.activeElement === this) this.doc.activeElement = this.doc.body; }
  scrollIntoView(opts) { this.scrolls.push(opts); }
  contains(el) { for (let n = el; n; n = n.parent) if (n === this) return true; return false; }
  closest(sel) { for (let n = this; n; n = n.parent) if (matches(n, sel)) return n; return null; }
  matches(sel) { return matches(this, sel); }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => { for (const c of n.children) { if (sel.split(",").some((s) => matches(c, s))) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn); }
  /** Bubbles from this element up to the document body. */
  dispatchEvent(evt) {
    evt.target ??= this;
    for (let n = this; n && !evt.stopped; n = n.parent) {
      evt.currentTarget = n;
      for (const fn of [...(n.listeners[evt.type] ?? [])]) fn.call(n, evt);
    }
    return !evt.defaultPrevented;
  }
}
function makeEvent(type, props = {}) {
  return {
    type, defaultPrevented: false, stopped: false, ...props,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
  };
}
function makeDoc() {
  const frames = [], timers = [];
  let now = 0, nextId = 1;
  const win = {
    getComputedStyle: (el) => ({ gridTemplateColumns: el.__cols ?? "196px 196px 196px" }),
    requestAnimationFrame(fn) { const id = nextId++; frames.push({ id, fn }); return id; },
    cancelAnimationFrame(id) { const i = frames.findIndex((f) => f.id === id); if (i >= 0) frames.splice(i, 1); },
    setTimeout(fn, ms = 0) { const id = nextId++; timers.push({ id, fn, at: now + ms }); return id; },
    clearTimeout(id) { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
  };
  const doc = { win, activeElement: null, frames, timers };
  win.document = doc;
  doc.body = new El(doc, "body");
  doc.activeElement = doc.body;
  doc.flushFrames = () => { const due = frames.splice(0); for (const f of due) f.fn(0); return due.length; };
  doc.advance = (ms) => {
    now += ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.splice(timers.indexOf(due), 1); due.fn();
    }
  };
  return doc;
}
const key = (el, k, extra = {}) => { const evt = makeEvent("keydown", { key: k, ...extra }); el.dispatchEvent(evt); return evt; };
const click = (el, extra = {}) => { const evt = makeEvent("click", extra); el.dispatchEvent(evt); return evt; };
const settle = () => new Promise((r) => setTimeout(r, 0));

/* ---------- bundle ---------- */
const directory = await mkdtemp(join(tmpdir(), "notion-flow-style-ui-"));
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
try {
  const outfile = join(directory, "style-ui.mjs");
  await build({
    stdin: {
      contents: [
        "export * from './ui/settings-preview';",
        "export * from './ui/style-gallery';",
        "export * from './ui/style-switcher';",
        "export * as SP from './features/style-presets';",
      ].join("\n"),
      loader: "ts",
      resolveDir: fileURLToPath(new URL("../src/", import.meta.url)),
    },
    bundle: true, format: "esm", platform: "node", outfile, logLevel: "silent",
    plugins: [{
      name: "nf-stub",
      setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "nf-stub" }));
        b.onLoad({ filter: /.*/, namespace: "nf-stub" }, () => ({ contents: STUB, loader: "js" }));
      },
    }],
  });
  const url = pathToFileURL(outfile).href;
  const EN = await import(url);
  globalThis.window = { localStorage: { getItem: (k) => (k === "language" ? "zh" : null) } };
  const ZH = await import(`${url}?zh`);
  delete globalThis.window;
  const { SP } = EN;
  const base = (extra = {}) => ({ ...SP.NOTE_STYLE_DEFAULTS, ...extra });

  /* 1. gridMove */
  const moves = [
    [9, 3, [["ArrowRight", 8, 0], ["ArrowLeft", 0, 8], ["ArrowDown", 1, 4], ["ArrowDown", 7, 7], ["ArrowUp", 4, 1],
      ["ArrowUp", 1, 1], ["Home", 5, 0], ["End", 2, 8]]],
    [9, 2, [["ArrowDown", 7, 8], ["ArrowDown", 8, 8]]],
    [12, 5, [["ArrowDown", 9, 11]]],
    [1, 1, ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].map((k) => [k, 0, 0])],
  ];
  for (const [n, cols, cases] of moves) {
    for (const [k, from, to] of cases) eq(EN.gridMove(from, k, n, cols), to, `gridMove ${k} ${from} (n=${n}, cols=${cols})`);
  }
  eq(EN.gridMove(0, "a", 9, 3), null, "gridMove ignores other keys");

  /* 2. columnsOf */
  {
    const doc = makeDoc();
    const grid = doc.body.createDiv();
    for (const [cols, want] of [["196px 196px 196px", 3], ["none", 1], ["", 1], ["240px 240px", 2]]) {
      grid.__cols = cols;
      eq(EN.columnsOf(grid), want, `columnsOf "${cols}"`);
    }
  }

  /* 4. calloutLookClass / galleryModifiers */
  eq(EN.galleryModifiers(base({ look: "editorial" })), ["is-look-rail"], "editorial → rail");
  eq(EN.galleryModifiers(base({ look: "editorial", calloutStyle: "flat" })), ["is-look-classic"], "own flat callout wins");
  eq(EN.calloutLookClass(base({ look: "gradient" })), "gradient", "gradient callout");
  eq(EN.calloutLookClass(base({ look: "soft" })), "card", "soft → card");
  ok(EN.galleryModifiers(base({ paletteSurface: "page" })).includes("is-paper"), "page surface → is-paper");
  ok(!EN.galleryModifiers(base({ paletteSurface: "theme" })).includes("is-paper"), "theme surface: no paper");
  ok(EN.galleryModifiers(base({ paletteHeadings: true })).includes("is-headings"), "tinted headings");
  for (const garbage of [null, undefined, 42, "x", {}, { calloutStyle: "nope", look: 7 }]) {
    eq(EN.galleryModifiers(garbage), ["is-look-classic"], `garbage ${JSON.stringify(garbage)}`);
  }

  /* 5. suggestionFor */
  eq(EN.suggestionFor(base({ palette: "notion" }))?.id, "soft", "notion suggests soft");
  eq(EN.suggestionFor(base({ palette: "notion", look: "soft" })), null, "a look is chosen");
  eq(EN.suggestionFor(base()), null, "classic palette");
  eq(EN.suggestionFor(base({ palette: "guose" }))?.id, "editorial", "guose suggests editorial");
  eq(EN.suggestionFor(base({ palette: "nord" }))?.id, "outline", "nord suggests outline");
  eq(EN.suggestionFor(base({ palette: "bogus" })), null, "unknown palette is classic");

  /* 6. overrideSummary */
  {
    const user = base({ quoteBarColor: "accent", inlineCodeColor: "pink", codeTheme: "github", palette: "nord" });
    const en = EN.overrideSummary(user);
    eq(en.n, 3, "3 overrides");
    eq(en.items, ["Quote bar color (Accent color)", "Inline code color (Pink)", "Code block theme (GitHub)"], "EN items");
    ok(en.visible, "visible under a palette");
    eq(en.text, "3 components keep your own setting and do not follow the style: "
      + "Quote bar color (Accent color) · Inline code color (Pink) · Code block theme (GitHub)", "EN text");
    const zh = ZH.overrideSummary(user);
    eq(zh.items, ["引用条颜色（强调色）", "行内代码颜色（粉）", "代码块主题（GitHub）"], "ZH items, full-width parentheses");
    eq(zh.text, "3 个组件使用你自己的设置，不随样式变化：引用条颜色（强调色）· 行内代码颜色（粉）· 代码块主题（GitHub）", "ZH text");
    const classic = EN.overrideSummary({ ...user, palette: "classic", look: "classic" });
    ok(!classic.visible && classic.n === 3, "hidden under Classic × Classic, still counted");
    ok(EN.overrideSummary({ ...user, palette: "classic", look: "soft" }).visible, "a look alone shows it");
    const one = EN.overrideSummary(base({ palette: "nord", bulletStyle: "dash" }));
    ok(one.text.startsWith("1 component keeps") && one.text.endsWith("Bullet style (Dash)"), "singular");
    eq(EN.overrideSummary(base({ palette: "nord", decorColor: "palette" })).items, ["Decoration color (Palette color)"], "decor palette label");
    eq(EN.overrideSummary(base({ palette: "nord" })), { n: 0, items: [], text: "", visible: false }, "no overrides");
  }

  /* 7. optionLabel / followLookLabel */
  eq(EN.followLookLabel(base(), "calloutStyle"), "Follow look (Header strip)", "classic callout");
  eq(EN.followLookLabel(base({ look: "editorial" }), "calloutStyle"), "Follow look (Side rail)", "editorial callout");
  eq(EN.followLookLabel(base(), "decorColor"), "Follow look (Palette color)", "decor palette");
  eq(EN.followLookLabel(base({ look: "minimal" }), "decorColor"), "Follow look (Neutral gray)", "minimal decor");
  eq(ZH.followLookLabel(base({ look: "editorial" }), "calloutStyle"), "跟随版式（侧线）", "ZH editorial callout");
  eq(EN.optionLabel("tableHeaderColor", "none"), "None", "none");
  eq(EN.optionLabel("quoteBarColor", "text"), "Text color", "text");
  eq(EN.optionLabel("listMarkerColor", "default"), "Theme default", "default");
  eq(EN.optionLabel("inlineCodeColor", "cyan"), "Cyan", "hue");
  eq(EN.optionLabel("codeTheme", "tokyo-night"), "Tokyo Night", "code theme");
  eq(EN.optionLabel("decorColor", "accent"), "Accent color", "decor accent");
  eq(ZH.optionLabel("listMarkerColor", "accent"), "强调色", "ZH accent");

  /* 3. dotPaint: every cell of the table, exact strings */
  {
    const hue = (h) => `var(--nf-${h})`;
    const table = {
      listMarkerColor: {
        auto: "var(--nf-style-list-marker, var(--interactive-accent))", accent: "var(--interactive-accent)",
        default: "var(--list-marker-color)",
      },
      quoteBarColor: {
        auto: "var(--nf-style-quote-bar, var(--text-normal))", accent: "var(--interactive-accent)",
        text: "var(--text-normal)", default: "var(--blockquote-border-color)",
      },
      inlineCodeColor: { auto: "var(--nf-style-inline-code, var(--nf-red))", default: "var(--code-normal)" },
      tableHeaderColor: {
        auto: "var(--nf-dot-thead, var(--nf-style-thead, var(--table-header-background)))",
        default: "var(--nf-dot-thead, var(--table-header-background))", none: "transparent",
      },
    };
    for (const [k, cells] of Object.entries(table)) {
      for (const h of SP.STYLE_HUES) cells[h] = k === "tableHeaderColor" ? `rgba(var(--nf-${h}-rgb), 0.16)` : hue(h);
      for (const [value, color] of Object.entries(cells)) {
        eq(EN.dotPaint(k, value), { color, none: k === "tableHeaderColor" && value === "none" }, `dotPaint ${k} ${value}`);
      }
      // "—" cells and unknown values paint like auto.
      for (const other of ["accent", "text", "default", "none", "bogus", "", "auto"].filter((v) => !(v in cells) || v === "auto")) {
        eq(EN.dotPaint(k, other), { color: cells.auto, none: false }, `dotPaint ${k} ${other || "(empty)"} = auto`);
      }
      for (const value of ["auto", "accent", "text", "default", "none", ...SP.STYLE_HUES]) {
        ok(!EN.dotPaint(k, value).color.includes(" / "), `no slash alpha: ${k} ${value}`);
      }
    }
    eq(Object.keys(table.tableHeaderColor).length, 12, "table header: auto, default, none and 9 hues");
  }

  /* 8. switcherRows / rowMatches */
  {
    const rows = EN.switcherRows();
    eq(rows.length, 15, "15 rows");
    eq(rows.map((r) => `${r.group}:${r.id}`), [...SP.PALETTES.map((p) => `palette:${p.id}`), ...SP.LOOKS.map((l) => `look:${l.id}`)], "palettes, then looks, in order");
    eq(rows[2].swatch, SP.PALETTES[2].swatch, "palette rows carry the swatch");
    ok(rows.slice(9).every((r) => r.swatch === undefined), "look rows have no swatch");
    const hits = (q) => rows.filter((r) => EN.rowMatches(r, q)).map((r) => `${r.group}:${r.id}`);
    eq(hits("nord"), ["palette:nord"], "nord");
    eq(hits("  NORD "), ["palette:nord"], "trimmed, case-insensitive");
    eq(hits("ROSÉ"), ["palette:rose-pine"], "ROSÉ");
    eq(hits("卡片"), ["look:soft"], "卡片");
    eq(hits("莫兰迪"), ["palette:morandi"], "莫兰迪");
    eq(hits("rose-pine"), ["palette:rose-pine"], "by id");
    eq(hits("").length, 15, "empty query");
    eq(hits("zzz"), [], "zzz");
    eq(hits("soft cards"), ["look:soft"], "not split on spaces");
  }

  /* 9. SwitcherModel */
  {
    const saved = { palette: "classic", look: "classic" };
    const m = new EN.SwitcherModel(EN.switcherRows(), saved);
    const at = () => m.activeRow && `${m.activeRow.group}:${m.activeRow.id}`;
    eq(at(), "palette:classic", "starts on the saved palette");
    eq(new EN.SwitcherModel(EN.switcherRows(), { palette: "guose", look: "soft" }).activeRow.id, "guose", "saved palette row");
    m.move(+1);
    eq(at(), "palette:notion", "move +1");
    m.move(-1); m.move(-1);
    eq(at(), "look:gradient", "move -1 wraps to the last look");
    m.move(+1);
    eq(at(), "palette:classic", "move +1 wraps to the first palette");
    m.switchGroup();
    eq(at(), "look:classic", "switchGroup → saved look");
    m.switchGroup();
    eq(at(), "palette:classic", "and back to the saved palette");
    eq(m.patch(), { palette: "classic" }, "palette patch");
    m.switchGroup(); m.move(+1);
    eq(m.patch(), { look: "editorial" }, "look patch");
    eq(SP.withPreview(base(saved), m.patch()).palette, "classic", "withPreview keeps the other axis");
    eq(SP.withPreview(base(saved), m.patch()).look, "editorial", "withPreview sets the look");
    m.setQuery("nord");
    eq(at(), "palette:nord", "active hidden → first visible row");
    m.switchGroup();
    eq(at(), "palette:nord", "switchGroup is a no-op without the other group");
    m.setQuery("n");
    eq(at(), "palette:nord", "a still-visible active row stays");
    m.setQuery("zzz");
    eq(m.activeRow, null, "nothing visible");
    eq(m.patch(), null, "no patch");
    m.move(+1); m.switchGroup();
    eq(m.activeRow, null, "moves are no-ops with no rows");
    m.setQuery("");
    eq(at(), "palette:nord", "clearing the filter returns to the last active row");
    m.activate("look", "minimal");
    eq(at(), "look:minimal", "activate");
    m.setQuery("nord");
    eq(at(), "palette:nord", "active look hidden, no visible look → first visible row");
    m.setQuery("");
    m.activate("look", "outline");
    m.setQuery("o");
    ok(m.visible.includes(m.activeRow) && m.activeRow.id === "outline", "keeps outline");
    m.setQuery("卡片");
    eq(at(), "look:soft", "first visible row of the same group");
    m.activate("palette", "nord");
    eq(at(), "look:soft", "activate ignores hidden rows");
  }

  /* 10. switcherKeyAction */
  eq(EN.switcherKeyAction({ key: "ArrowDown" }), "down", "ArrowDown");
  eq(EN.switcherKeyAction({ key: "ArrowUp" }), "up", "ArrowUp");
  eq(EN.switcherKeyAction({ key: "Tab" }), "group", "Tab");
  eq(EN.switcherKeyAction({ key: "Tab", shiftKey: true }), "group", "Shift+Tab");
  eq(EN.switcherKeyAction({ key: "Enter" }), "commit", "Enter");
  eq(EN.switcherKeyAction({ key: "Enter", isComposing: true }), null, "IME Enter");
  eq(EN.switcherKeyAction({ key: "ArrowDown", isComposing: true }), null, "IME arrow");
  eq(EN.switcherKeyAction({ key: "Escape" }), null, "Escape");

  /* 11b. codeThemeOptions */
  {
    const options = EN.codeThemeOptions();
    eq(options.length, 12, "12 code-theme options");
    eq(options[0], { id: "auto", label: "Follow palette", darkOnly: false }, "Follow palette first");
    eq(options.slice(1).map((o) => o.id), [...SP.CODE_THEME_IDS], "then every code theme");
    eq(options.filter((o) => o.darkOnly).map((o) => o.id), ["one-dark", "dracula", "nord"], "dark-only themes");
    eq([...EN.DARK_ONLY_CODE_THEMES], ["one-dark", "dracula", "nord"], "DARK_ONLY_CODE_THEMES");
    eq(options.find((o) => o.id === "tokyo-night").label, "Tokyo Night", "labels");
    eq(ZH.codeThemeOptions()[0].label, "跟随配色方案", "ZH Follow palette");
    eq(ZH.codeThemeOptions()[1].label, "主题默认", "ZH Theme default");
  }

  /* 12. PREVIEW_SAMPLE */
  for (const lang of ["en", "zh"]) {
    const md = EN.PREVIEW_SAMPLE[lang];
    for (const part of ["## ", "`", "==", "- ", "1. ", "- [ ] ", "> [!tip]", "```", "var(--nf-red, #b5554d)"]) {
      ok(md.includes(part), `${lang} sample has ${JSON.stringify(part)}`);
    }
  }
  ok(EN.PREVIEW_SAMPLE.zh.includes("每周回顾") && EN.PREVIEW_SAMPLE.en.includes("Weekly review"), "sample headings");
  for (const lang of ["en", "zh"]) {
    // The quote must not continue the list above it (it would nest in the last item).
    const lines = EN.PREVIEW_SAMPLE[lang].split("\n");
    lines.forEach((line, i) => {
      if (line.startsWith("> ") && i > 0 && !lines[i - 1].startsWith(">")) eq(lines[i - 1], "", `${lang}: a blank line before the quote on line ${i + 1}`);
    });
  }
  eq(EN.PREVIEW_SAMPLE.en.split("\n").length, EN.PREVIEW_SAMPLE.zh.split("\n").length, "same structure in both languages");

  /* 11. the code-theme labels: one table, in CODE_THEME_IDS order (main.ts
   * mounts the gallery and keeps no copy of its own) */
  {
    const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
    ok(!/const CODE_THEME_LABELS\b/.test(main), "main.ts keeps no second CODE_THEME_LABELS");
    eq(Object.keys(EN.CODE_THEME_LABELS), [...SP.CODE_THEME_IDS], "same ids and order as CODE_THEME_IDS");
  }

  /* 13. DOM smoke: renderNoteStyleSection */
  const makeHost = (settings, extra = {}) => {
    const log = [], deps = [], saves = [];
    const host = {
      app: { customCss: { theme: "" } }, settings, log, deps, saves,
      apply() { log.push("apply"); },
      save() { log.push("save"); return new Promise((resolve) => saves.push(() => { log.push("saved"); resolve(); })); },
      preview() { log.push("preview"); },
      dependsOn(setting, k) { deps.push([setting.name, k]); },
      changed() { log.push("changed"); },
      ...extra,
    };
    host.flushSaves = async () => { while (saves.length) saves.shift()(); await settle(); };
    return host;
  };
  const render = (M, host) => {
    const doc = makeDoc();
    globalThis.__nfFakeDoc = doc;
    const root = doc.body.createDiv({ cls: "vertical-tab-content" });
    const section = M.renderNoteStyleSection(root, host);
    const [palettes, looks] = section.el.querySelectorAll('[role="radiogroup"]');
    const card = (grid, id) => grid.querySelector(`[role="radio"][data-id="${id}"]`);
    const select = (k) => {
      const label = M === ZH ? null : SP.COMPONENTS[k].label;
      return section.el.querySelectorAll(".nf-style-custom .setting-item").find((row) => row.querySelector(".setting-item-name").textContent === label)?.querySelector("select");
    };
    const row = (name) => section.el.querySelectorAll(".setting-item").find((r) => r.querySelector(".setting-item-name").textContent === name);
    return { doc, root, section, palettes, looks, card, select, row, el: section.el };
  };
  {
    const host = makeHost(base({ cleanRendering: true, quoteBarColor: "accent" }), { redisplay() { host.log.push("redisplay"); } });
    const f = render(EN, host);
    // Structure.
    ok(f.el.hasClass("nf-style-section") && f.el.parent === f.root, "one wrapper appended to the container");
    eq(f.el.querySelectorAll('[role="radiogroup"]').length, 2, "two radio groups");
    eq(f.palettes.querySelectorAll('[role="radio"]').map((c) => c.getAttr("data-id")), SP.PALETTES.map((p) => p.id), "9 palette cards in order");
    eq(f.looks.querySelectorAll('[role="radio"]').map((c) => c.getAttr("data-id")), SP.LOOKS.map((l) => l.id), "6 look cards in order");
    ok(f.palettes.hasClass("nf-gallery") && f.palettes.hasClass("nf-gallery-palettes") && f.looks.hasClass("nf-gallery-looks"), "grid classes");
    eq(f.palettes.getAttr("aria-label"), "Palette", "palette group label");
    for (const grid of [f.palettes, f.looks]) {
      const zero = grid.querySelectorAll('[tabindex="0"]');
      eq(zero.length, 1, "one tab stop per grid");
      eq(zero[0].getAttr("aria-checked"), "true", "the tab stop is the checked card");
      eq(zero[0].getAttr("data-id"), "classic", "classic is checked");
    }
    const nordCard = f.card(f.palettes, "nord");
    eq(nordCard.getAttr("aria-label"), "Nord", "EN aria-label has no duplicate name");
    const sub = nordCard.querySelector(".nf-gallery-sub");
    eq(nordCard.getAttr("aria-describedby"), sub.id, "described by its sub line");
    ok(sub.id.startsWith("nf-sg-"), "unique sub id");
    const mini = nordCard.querySelector(".nf-mini");
    ok(mini.hasClass("nf-palette-preview") && mini.getAttr("data-palette") === "nord" && mini.getAttr("aria-hidden") === "true", "mini preview in its own palette");
    eq(mini.querySelector(".nf-mini-h").textContent, "Aa Heading", "EN mini heading");
    eq(mini.querySelectorAll(".nf-mini-p b").map((b) => b.style.color), SP.PALETTES[2].inkHues.map((h) => `var(--nf-${h})`), "mini inks");
    eq(mini.querySelector(".nf-mini-p").textContent, "Text Aa Aa Aa Aa", "EN mini text");
    eq(mini.querySelectorAll(".nf-mini-wash i").length, 9, "9 washes");
    eq(mini.querySelectorAll(".nf-mini-wash i")[3].cssProps, { "--w": "var(--nf-yellow-rgb)", "--k": "var(--nf-yellow)", "--a": ".2" }, "yellow wash");
    eq(mini.querySelector(".nf-mini-row").textContent, "ListQuote code", "mini row text");
    const thumbs = f.looks.querySelectorAll(".nf-look-thumb");
    eq(thumbs.map((t) => t.getAttr("data-palette")), Array(6).fill("classic"), "thumbnails in the current palette");
    eq(thumbs.map((t) => t.getAttr("data-look")), SP.LOOKS.map((l) => l.id), "thumbnail looks");
    eq(thumbs.map((t) => t.querySelectorAll(".t-kicker").length), [0, 1, 0, 0, 0, 0], "kicker on editorial only");
    eq(thumbs[1].querySelector(".t-kicker").textContent, "KICKER", "EN kicker sample");
    eq(thumbs[0].querySelectorAll(".t-p i").map((i) => i.style.width), ["26%", "24%", "72%"], "schematic line widths");
    eq(f.el.querySelectorAll(".nf-style-custom select").length, 12, "12 Customize rows");
    eq(f.select("calloutStyle").options[0].text, "Follow look (Header strip)", "Follow-look label");
    eq(f.select("calloutStyle").options.map((o) => o.value), ["auto", ...SP.COMPONENTS.calloutStyle.values], "callout options");
    eq(f.select("decorColor").options[1].text, "Palette color", "decor palette option");
    const details = f.el.querySelector("details.nf-style-custom");
    eq(details.open, true, "Customize opens itself with overrides");
    const chip = details.querySelector("summary .nf-style-modified");
    ok(chip.isShown && chip.textContent === "1 changed", "changed chip");
    const hint = f.el.querySelector(".nf-style-hint");
    const notice = f.el.querySelector(".nf-style-overrides");
    ok(!hint.isShown, "no hint under Classic");
    ok(!notice.isShown, "no notice under Classic × Classic");
    const paper = f.row("Paper background");
    eq(paper.querySelector("select").value, "theme", "paper value");
    ok(paper.hasClass("nf-setting-dependent") && paper.querySelector("select").disabled, "paper dimmed under Classic");
    ok(f.row("Tinted headings").hasClass("nf-setting-dependent") && f.row("Links use the palette").hasClass("nf-setting-dependent"), "toggles dimmed");
    ok(!paper.querySelector(".nf-setting-note").isShown, "no community-theme note");
    ok(f.el.querySelectorAll(".setting-item-heading").length === 1 && f.el.children[0].hasClass("setting-item-heading"), "heading first");
    // Gates.
    eq(host.deps, [
      ["Callout style", "calloutEditing"], ["Heading accents", "cleanRendering"], ["Table look", "tableStyle"],
      ["Quote style", "cleanRendering"], ["To-do checkbox", "cleanRendering"], ["Divider style", "cleanRendering"],
      ["Toggle arrow", "toggleBlocks"], ["Column divider", "columnLayout"], ["Inline code look", "cleanRendering"],
    ], "dependsOn for exactly the gated components");
    eq(host.log, [], "rendering saves and applies nothing");

    // Keys: arrows move focus only.
    const classicCard = f.card(f.palettes, "classic");
    classicCard.focus();
    const right = key(classicCard, "ArrowRight");
    ok(right.defaultPrevented, "ArrowRight handled");
    eq(f.doc.activeElement, f.card(f.palettes, "notion"), "ArrowRight focuses notion");
    eq(host.settings.palette, "classic", "focus does not select");
    key(f.doc.activeElement, "ArrowDown");
    eq(f.doc.activeElement.getAttr("data-id"), "paper", "ArrowDown moves by the column count");
    f.palettes.__cols = "196px 196px";
    key(f.doc.activeElement, "ArrowUp");
    eq(f.doc.activeElement.getAttr("data-id"), "nord", "ArrowUp by 2 columns");
    delete f.palettes.__cols;
    key(f.doc.activeElement, "End");
    eq(f.doc.activeElement.getAttr("data-id"), "guose", "End");
    key(f.doc.activeElement, "Home");
    eq(f.doc.activeElement.getAttr("data-id"), "classic", "Home");
    key(f.doc.activeElement, "ArrowLeft");
    eq(f.doc.activeElement.getAttr("data-id"), "guose", "ArrowLeft wraps");
    const esc = key(f.doc.activeElement, "Escape");
    ok(!esc.defaultPrevented && !esc.stopped, "Escape passes through");
    const modified = key(f.doc.activeElement, "ArrowRight", { metaKey: true });
    ok(!modified.defaultPrevented && f.doc.activeElement.getAttr("data-id") === "guose", "modified arrows pass through");
    ok(!key(f.doc.activeElement, "ArrowRight", { isComposing: true }).defaultPrevented, "IME composition passes through");
    eq(host.log, [], "moving focus changes nothing");
    // Space selects notion.
    key(f.doc.activeElement, "Home"); key(f.doc.activeElement, "ArrowRight");
    const notion = f.card(f.palettes, "notion");
    const space = key(notion, " ");
    ok(space.defaultPrevented, "Space handled (no pane scroll)");
    eq(host.settings.palette, "notion", "Space selects");
    eq(host.log, ["apply", "save"], "applied before the save resolves");
    await host.flushSaves();
    eq(host.log, ["apply", "save", "saved", "changed"], "changed after the save");
    eq(notion.getAttr("aria-checked"), "true", "aria-checked moved");
    eq(f.card(f.palettes, "classic").getAttr("aria-checked"), "false", "classic unchecked");
    eq(f.palettes.querySelectorAll('[tabindex="0"]'), [notion], "tab stop moved");
    eq(f.doc.activeElement, notion, "focus stays on the chosen card");
    eq(f.looks.querySelectorAll(".nf-look-thumb").map((t) => t.getAttr("data-palette")), Array(6).fill("notion"), "thumbnails follow");
    eq(paper.hasClass("nf-setting-dependent"), false, "paper row enabled");
    eq(f.row("Paper background") && host.settings.paletteSurface, "theme", "surface untouched");
    ok(hint.isShown, "hint shown for notion + classic");
    eq(hint.querySelector("span").textContent, "Try the Soft cards look with this palette", "hint text");
    ok(notice.isShown, "notice shown under a palette");
    eq(notice.querySelector("span").textContent, "1 component keeps your own setting and does not follow the style: Quote bar color (Accent color)", "notice text");
    const paperSetting = paper;
    ok(paperSetting.querySelector("select").disabled === false, "paper select enabled");
    // Clicking the checked card again changes nothing.
    host.log.length = 0;
    click(notion);
    eq(host.log, [], "re-choosing the same palette saves nothing");
    ok(hint.isShown, "re-choosing a palette keeps the hint armed");

    // Look: Enter on editorial.
    const editorial = f.card(f.looks, "editorial");
    editorial.focus();
    const enter = key(editorial, "Enter");
    ok(enter.defaultPrevented, "Enter handled");
    eq(host.settings.look, "editorial", "Enter selects the look");
    await host.flushSaves();
    eq(f.select("calloutStyle").options[0].text, "Follow look (Side rail)", "Follow-look label follows the look");
    eq(f.select("calloutStyle").value, "auto", "component value untouched");
    ok(f.palettes.hasClass("is-look-rail") && !f.palettes.hasClass("is-look-classic"), "palette grid shows the rail callout");
    ok(!hint.isShown, "choosing a look dismisses the hint");
    for (const k of SP.COMPONENT_KEYS) eq(host.settings[k], "auto", `${k} untouched by the look`);
    eq(host.settings.quoteBarColor, "accent", "colour override untouched");
    // Back to classic look: the hint stays dismissed until the palette changes.
    click(f.card(f.looks, "classic"));
    await host.flushSaves();
    ok(!hint.isShown, "hint stays dismissed after picking classic");
    click(f.card(f.palettes, "nord"));
    await host.flushSaves();
    ok(hint.isShown && hint.querySelector("span").textContent === "Try the Outline look with this palette", "a palette change re-arms the hint");
    // Apply: sets the look and focuses its card.
    host.log.length = 0;
    click(hint.querySelector("button"));
    eq(host.settings.look, "outline", "Apply sets the suggested look");
    eq(f.doc.activeElement, f.card(f.looks, "outline"), "focus moves to the new look card");
    ok(!hint.isShown, "hint gone");
    await host.flushSaves();
    eq(host.log, ["apply", "save", "saved", "changed"], "Apply saves once");

    // Settings rows.
    const paperSelect = paper.querySelector("select");
    paperSelect.value = "page";
    paperSelect.dispatchEvent(makeEvent("change"));
    eq(host.settings.paletteSurface, "page", "paper dropdown writes the setting");
    ok(f.palettes.hasClass("is-paper"), "paper modifier");
    await host.flushSaves();
    host.app.customCss.theme = "Minimal";
    paperSelect.value = "app";
    paperSelect.dispatchEvent(makeEvent("change"));
    ok(paper.querySelector(".nf-setting-note").isShown, "community-theme note for the whole app");
    await host.flushSaves();
    const calloutSelect = f.select("calloutStyle");
    calloutSelect.value = "gradient";
    calloutSelect.dispatchEvent(makeEvent("change"));
    eq(host.settings.calloutStyle, "gradient", "Customize row writes the component");
    ok(f.palettes.hasClass("is-look-gradient"), "own callout style drives the mini callout");
    eq(chip.textContent, "2 changed", "chip counts the new override");
    ok(notice.querySelector("span").textContent.startsWith("2 components keep"), "notice counts it too");
    await host.flushSaves();

    // refresh(): external changes, without saving (the toggle's setValue fires its callback).
    host.log.length = 0;
    Object.assign(host.settings, { calloutStyle: "auto", paletteHeadings: true, tableLook: "ruled" });
    f.section.refresh();
    eq(host.log, [], "refresh saves nothing");
    eq(f.select("calloutStyle").value, "auto", "refresh re-reads the rows");
    eq(f.select("tableLook").value, "ruled", "refresh re-reads another row");
    ok(f.palettes.hasClass("is-headings") && f.palettes.hasClass("is-look-outline"), "refresh re-syncs the modifiers");
    eq(chip.textContent, "2 changed", "refresh re-counts");

    // Follow the style for all.
    const follow = notice.querySelector("button");
    eq(follow.textContent, "Follow the style for all", "follow button");
    follow.focus();
    click(follow);
    for (const k of [...SP.COMPONENT_KEYS, ...SP.COLOR_KEYS]) eq(host.settings[k], "auto", `${k} follows`);
    eq(Object.keys(SP.followAll()).length, 17, "17 keys");
    eq(host.settings.palette, "nord", "palette kept");
    eq(host.settings.look, "outline", "look kept");
    ok(!notice.isShown && !chip.isShown, "notice and chip hidden");
    eq(f.doc.activeElement, details.querySelector("summary"), "focus continues on the disclosure");
    eq(host.log.slice(0, 2), ["apply", "save"], "applied, then saved");
    await host.flushSaves();
    eq(host.log.slice(-2), ["changed", "redisplay"], "then changed and redisplay");
    f.section.destroy();
  }
  {
    // Without redisplay the rows update in place.
    const host = makeHost(base({ palette: "catppuccin", look: "soft", bulletStyle: "dash", codeTheme: "nord" }));
    const f = render(EN, host);
    eq(f.select("bulletStyle").value, "dash", "stored value shown");
    ok(f.el.querySelector(".nf-style-overrides").isShown, "notice visible");
    ok(!f.el.querySelector(".nf-style-hint").isShown, "no hint once a look is chosen");
    click(f.el.querySelector(".nf-style-overrides button"));
    eq(f.el.querySelectorAll(".nf-style-custom select").map((s) => s.value), Array(12).fill("auto"), "every Customize row reads auto");
    await host.flushSaves();
    ok(!host.log.includes("redisplay"), "no redisplay without the hook");
    // Settings from before the style model (no palette/look keys at all).
    const legacy = makeHost({ calloutStyle: "header", cleanRendering: false });
    const g = render(EN, legacy);
    eq(g.palettes.querySelector('[aria-checked="true"]').getAttr("data-id"), "classic", "legacy settings check classic");
    eq(g.select("calloutStyle").value, "header", "a stored value is shown as an override");
    ok(g.el.querySelector(".nf-style-custom").open, "and opens Customize");
  }
  {
    // ZH: English names ride along in <small>, the hint reads naturally.
    const host = makeHost(base({ palette: "notion" }));
    const f = render(ZH, host);
    const notion = f.card(f.palettes, "notion");
    eq(notion.getAttr("aria-label"), "Notion 原味 Notion", "ZH aria-label carries the English name");
    eq(notion.querySelector(".nf-gallery-name small").textContent, "Notion", "small English name");
    eq(notion.querySelector(".nf-mini-p").textContent, "正文 朱 靛 翠 紫", "ZH mini inks");
    eq(f.card(f.palettes, "everforest").querySelector(".nf-mini-p").textContent, "正文 朱 橙 翠 青", "per-palette ink hues");
    eq(f.el.querySelector(".nf-style-hint span").textContent, "试试与「柔和卡片」版式搭配", "ZH hint");
    // fix-kicker-zh: the Editorial thumbnail's kicker is Chinese sample text too.
    eq(f.looks.querySelector('.nf-look-thumb[data-look="editorial"] .t-kicker').textContent, "栏目", "ZH kicker sample");
    eq(f.el.querySelector(".nf-style-hint button").textContent, "应用", "ZH apply");
    eq(f.el.querySelector(".nf-style-custom summary").textContent.startsWith("自定义各组件"), true, "ZH summary");
    ok(!f.el.querySelector(".nf-style-custom").open, "closed without overrides");
    ok(!f.el.querySelector(".nf-style-modified").isShown, "no chip without overrides");
  }

  /* 13b. The settings tab's host, wired as the R2-W3-MAIN contract says
   * (review2-styleui-3, -4): dependsOn gets the boolean settings key and the
   * tab dims from settings[key]; one changed() refreshes the section, the
   * code gallery and the colour rows. */
  {
    const src = await readFile(new URL("../src/ui/style-gallery.ts", import.meta.url), "utf8");
    const previewSrc = await readFile(new URL("../src/ui/settings-preview.ts", import.meta.url), "utf8");
    ok(/\n  changed\(\): void;/.test(src) && !/changed\?\(\)/.test(src), "NoteStyleHost.changed is required");
    ok(/interface CodeThemeHost \{[^}]*\n  changed\(\): void;/.test(previewSrc), "CodeThemeHost.changed is required");
    eq(Object.values(EN.GATE_SETTING).sort(), ["calloutEditing", "cleanRendering", "columnLayout", "tableStyle", "toggleBlocks"], "GATE_SETTING's values are the settings keys");
    const gates = [...new Set(SP.COMPONENT_KEYS.map((k) => SP.COMPONENTS[k].gate).filter(Boolean))].sort();
    eq(gates, Object.keys(EN.GATE_SETTING).sort(), "GATE_SETTING covers every component gate");

    const doc = makeDoc();
    globalThis.__nfFakeDoc = doc;
    const root = doc.body.createDiv({ cls: "vertical-tab-content" });
    const settings = base({ cleanRendering: true, calloutEditing: true, tableStyle: true, toggleBlocks: true, columnLayout: true, palette: "nord", quoteBarColor: "accent" });
    // The tab (main.ts): its dependents map and syncDependents, verbatim from the contract.
    const dependents = new Map();
    const syncDependents = () => {
      for (const [key, rows] of dependents) {
        for (const row of rows) {
          row.setDisabled(!settings[key]);
          row.settingEl.toggleClass("nf-setting-dependent", !settings[key]);
        }
      }
    };
    // Its colour rows: a select and a dot each.
    const colorRows = ["listMarkerColor", "quoteBarColor", "inlineCodeColor", "tableHeaderColor"].map((k) => {
      const controlEl = root.createDiv({ cls: "setting-item-control" });
      const select = controlEl.createEl("select");
      for (const v of ["auto", ...SP.COLOR_VALUES[k]]) select.createEl("option", { value: v, text: v });
      select.value = settings[k];
      const dot = EN.colorDot({ controlEl }, k, () => settings[k]);
      return { k, select, dot, dotEl: controlEl.children[0] };
    });
    let section = null, gallery = null;
    const host = makeHost(settings, {
      dependsOn(setting, k) {
        (dependents.get(k) ?? dependents.set(k, []).get(k)).push(setting);
        syncDependents();
      },
      changed() {
        host.log.push("changed");
        section.refresh();
        gallery.refresh();
        for (const row of colorRows) {
          row.select.value = settings[row.k];
          row.dot.refresh();
        }
      },
    });
    section = EN.renderNoteStyleSection(root, host);
    gallery = EN.codeThemeGallery(root.createDiv(), host);
    const disabledRows = () => section.el.querySelectorAll(".nf-style-custom .setting-item").filter((r) => r.hasClass("is-disabled")).map((r) => r.querySelector(".setting-item-name").textContent);
    eq(disabledRows(), [], "every gate on: no Customize row is disabled");
    ok([...dependents.keys()].every((k) => typeof settings[k] === "boolean"), "the tab's keys are boolean settings");
    settings.cleanRendering = false;
    syncDependents();
    eq(disabledRows(), ["Heading accents", "Quote style", "To-do checkbox", "Divider style", "Inline code look"], "Cleaner rendering off: exactly its 5 rows");
    settings.cleanRendering = true;
    settings.tableStyle = false;
    syncDependents();
    eq(disabledRows(), ["Table look"], "Table styling off: the table row only");
    settings.tableStyle = true;
    syncDependents();
    eq(disabledRows(), [], "all back on");

    // A code theme picked in its gallery reaches the section's notice and chip.
    const noticeText = () => section.el.querySelector(".nf-style-overrides span").textContent;
    const chipText = () => section.el.querySelector(".nf-style-modified").textContent;
    eq(chipText(), "1 changed", "one override to start");
    click(gallery.el.querySelector('[data-id="github"]'));
    await host.flushSaves();
    eq(noticeText(), "2 components keep your own setting and do not follow the style: Quote bar color (Accent color) · Code block theme (GitHub)", "the notice lists the code theme");
    eq(chipText(), "2 changed", "the chip counts it");
    // A colour row's own change: the tab calls section.refresh() from its onChange.
    settings.inlineCodeColor = "pink";
    colorRows[2].select.value = "pink";
    section.refresh();
    eq(chipText(), "3 changed", "a colour row's change reaches the chip");
    // Follow the style for all: the gallery, the selects and the dots follow.
    click(section.el.querySelector(".nf-style-overrides button"));
    await host.flushSaves();
    eq(gallery.el.querySelectorAll('[aria-checked="true"]').map((c) => c.getAttr("data-id")), ["auto"], "the code gallery shows Follow palette");
    eq(colorRows.map((r) => r.select.value), ["auto", "auto", "auto", "auto"], "the colour selects read auto");
    eq(colorRows.map((r) => r.dotEl.cssProps["--nf-dot"]), colorRows.map((r) => EN.dotPaint(r.k, "auto").color), "the dots repaint");
    ok(!host.log.includes("redisplay") && section.el.parent === root, "no re-render: the section stays in place");
    section.destroy();
  }

  /* 14. DOM smoke: StyleSwitcherModal */
  const switcherHost = (settings) => {
    const log = [], previews = [];
    return {
      settings, log, previews,
      apply() { log.push("apply"); },
      save() { log.push("save"); return Promise.resolve(); },
      preview(s) { log.push("preview"); previews.push({ palette: s.palette, look: s.look }); },
    };
  };
  const scopeKey = (modal, k, mods = []) => modal.scope.keys.find((h) => h.key === k && JSON.stringify(h.modifiers) === JSON.stringify(mods))?.func;
  const press = (modal, k, extra = {}) => scopeKey(modal, k, extra.shiftKey ? ["Shift"] : [])(makeEvent("keydown", { key: k, ...extra }));
  {
    const doc = makeDoc();
    globalThis.__nfFakeDoc = doc;
    globalThis.__nfNotices = [];
    const host = switcherHost(base());
    const modal = new EN.StyleSwitcherModal({}, host);
    // Keys registered once, with the exact modifiers Obsidian's scope matches.
    eq(modal.scope.keys.map((h) => `${h.modifiers.join("+")}|${h.key}`), ["|ArrowDown", "|ArrowUp", "|Tab", "Shift|Tab", "|Enter"], "scope keys");
    modal.open();
    const m = modal.modalEl;
    ok(m.hasClass("prompt") && m.hasClass("nf-style-switcher") && !m.hasClass("modal"), "prompt classes");
    ok(!m.querySelector(".modal-title") && !m.querySelector(".modal-content"), "built from scratch");
    const input = m.querySelector(".prompt-input-container input.prompt-input");
    const list = m.querySelector(".prompt-results");
    eq(input.getAttr("placeholder"), "Search palettes and looks", "placeholder");
    eq([input.getAttr("role"), input.getAttr("aria-expanded"), input.getAttr("aria-autocomplete"), input.getAttr("type")], ["combobox", "true", "list", "text"], "combobox");
    eq(input.getAttr("aria-controls"), list.id, "controls the listbox");
    eq(list.getAttr("role"), "listbox", "listbox");
    eq([input.getAttr("autocapitalize"), input.getAttr("spellcheck")], ["off", "false"], "no autocorrect");
    eq(doc.activeElement, input, "input focused");
    const rows = m.querySelectorAll(".nf-sw-row");
    eq(rows.length, 15, "15 rows");
    ok(rows.every((r) => r.hasClass("suggestion-item") && r.hasClass("mod-complex") && r.getAttr("role") === "option"), "option rows");
    eq(rows.map((r) => r.id), EN.switcherRows().map((r) => `nf-sw-${r.group}-${r.id}`), "row ids");
    const groups = m.querySelectorAll(".nf-sw-group");
    eq(groups.map((g) => g.querySelector(".nf-sw-group-header").textContent), ["Palette", "Note look"], "group headers");
    eq(groups.map((g) => g.getAttr("aria-labelledby")), groups.map((g) => g.querySelector(".nf-sw-group-header").id), "groups labelled by their headers");
    eq(groups.map((g) => g.querySelectorAll(".nf-sw-row").length), [9, 6], "9 + 6");
    eq(input.getAttr("aria-activedescendant"), "nf-sw-palette-classic", "saved palette active");
    eq(m.querySelectorAll(".is-selected").map((r) => r.id), ["nf-sw-palette-classic"], "one selected row");
    eq(rows.map((r) => r.getAttr("aria-selected")), ["true", ...Array(14).fill("false")], "aria-selected");
    eq(m.querySelectorAll('[aria-current="true"]').map((r) => r.id), ["nf-sw-palette-classic", "nf-sw-look-classic"], "✓ rows");
    eq(m.querySelectorAll('[data-icon="check"]').length, 2, "two checks");
    eq(rows[1].querySelectorAll(".nf-sw-dots span").map((d) => d.cssProps["--nf-dot"]), [...SP.PALETTES[1].swatch.light], "light swatch dots");
    ok(rows.slice(9).every((r) => !r.querySelector(".nf-sw-dots")), "looks have no dots");
    eq(rows[10].querySelector(".suggestion-note").textContent, SP.LOOKS[1].desc.en, "look recipe line");
    eq(rows[1].querySelector(".suggestion-title").textContent, "Notion", "EN title without small");
    eq(m.querySelectorAll(".prompt-instructions .prompt-instruction").map((i) => i.children.map((c) => c.textContent)),
      [["↑↓", "preview"], ["↵", "apply"], ["Tab", "switch group"], ["esc", "restore"]], "instructions");
    ok(m.querySelector(".prompt-instruction .prompt-instruction-command"), "instruction command spans");
    ok(!m.querySelector(".suggestion-empty").isShown, "no empty state");
    eq(doc.frames.length, 0, "opening previews nothing");

    // ArrowDown previews on the next frame.
    eq(press(modal, "ArrowDown"), false, "ArrowDown handled");
    eq(doc.frames.length, 1, "one frame scheduled");
    eq(input.getAttr("aria-activedescendant"), "nf-sw-palette-notion", "notion active");
    const notionRow = m.querySelector('[id="nf-sw-palette-notion"]');
    ok(notionRow.hasClass("is-selected") && notionRow.getAttr("aria-selected") === "true", "notion selected");
    eq(notionRow.scrolls.at(-1), { block: "nearest" }, "keyboard move scrolls into view");
    eq(host.previews, [], "not before the frame");
    doc.flushFrames();
    eq(host.previews, [{ palette: "notion", look: "classic" }], "preview notion × saved look");
    press(modal, "ArrowDown"); press(modal, "ArrowDown");
    eq(doc.frames.length, 1, "two moves, one frame");
    doc.flushFrames();
    eq(host.previews.length, 2, "coalesced into one preview");
    eq(host.previews.at(-1), { palette: "morandi", look: "classic" }, "the latest row");
    // IME: Enter confirms the candidate, not the row.
    eq(press(modal, "Enter", { isComposing: true }), undefined, "composing Enter passes through");
    eq(press(modal, "ArrowDown", { isComposing: true }), undefined, "composing arrow passes through");
    eq(host.settings.palette, "classic", "nothing committed");
    // Tab: the saved look, then looks preview with the palette at its saved value.
    eq(press(modal, "Tab"), false, "Tab handled");
    eq(input.getAttr("aria-activedescendant"), "nf-sw-look-classic", "Tab → saved look");
    press(modal, "ArrowDown");
    doc.flushFrames();
    eq(host.previews.at(-1), { palette: "classic", look: "editorial" }, "look preview keeps the saved palette");
    eq(press(modal, "Tab", { shiftKey: true }), false, "Shift+Tab handled");
    eq(input.getAttr("aria-activedescendant"), "nf-sw-palette-classic", "Shift+Tab → saved palette");
    // Close with a frame pending: cancelled, restored once, nothing previewed after.
    press(modal, "ArrowUp");
    eq(input.getAttr("aria-activedescendant"), "nf-sw-look-gradient", "ArrowUp wraps");
    eq(doc.frames.length, 1, "frame pending");
    host.log.length = 0;
    const previewsBefore = host.previews.length;
    modal.close();
    eq(doc.frames.length, 0, "frame cancelled");
    eq(host.log, ["apply"], "restored once, no save");
    doc.flushFrames();
    eq(host.previews.length, previewsBefore, "no preview after close");
    eq([host.settings.palette, host.settings.look], ["classic", "classic"], "settings untouched");

    // Reopen: hover.
    modal.open();
    const m2 = modal.modalEl;
    const results = m2.querySelector(".prompt-results");
    const nordRow = m2.querySelector('[data-id="nord"]');
    eq(m2.querySelectorAll(".nf-sw-row").length, 15, "reopened with 15 rows");
    eq(m2.querySelector("input").getAttr("aria-activedescendant"), "nf-sw-palette-classic", "reopened on the saved palette");
    const title = nordRow.querySelector(".suggestion-title");
    title.dispatchEvent(makeEvent("mousemove", { clientX: 40, clientY: 120 }));
    doc.advance(60);
    eq(m2.querySelector("input").getAttr("aria-activedescendant"), "nf-sw-palette-classic", "60 ms: nothing yet");
    eq(doc.frames.length, 0, "60 ms: no preview");
    doc.advance(100);
    eq(m2.querySelector("input").getAttr("aria-activedescendant"), "nf-sw-palette-nord", "160 ms: hovered row active");
    eq(nordRow.scrolls.length, 0, "hover does not scroll");
    doc.flushFrames();
    eq(host.previews.at(-1), { palette: "nord", look: "classic" }, "hover previews");
    // A synthetic move at the same position (rows scrolling under a still pointer).
    press(modal, "ArrowDown");
    doc.flushFrames();
    m2.querySelector('[data-id="paper"]').dispatchEvent(makeEvent("mousemove", { clientX: 40, clientY: 120 }));
    eq(doc.timers.length, 0, "same position: ignored");
    m2.querySelector('[data-id="paper"]').dispatchEvent(makeEvent("mousemove", { clientX: 41, clientY: 150 }));
    eq(doc.timers.length, 1, "a real move starts the timer");
    results.dispatchEvent(makeEvent("mouseleave"));
    eq(doc.timers.length, 0, "leaving the list clears it");
    m2.querySelector('[data-id="paper"]').dispatchEvent(makeEvent("mousemove", { clientX: 42, clientY: 150 }));
    press(modal, "ArrowDown");
    eq(doc.timers.length, 0, "a key move cancels a pending hover");
    const down = makeEvent("mousedown");
    nordRow.dispatchEvent(down);
    ok(down.defaultPrevented, "mousedown keeps the input focused");

    // Filter.
    const typeQuery = (q) => { const el = m2.querySelector("input"); el.value = q; el.dispatchEvent(makeEvent("input")); };
    typeQuery("nord");
    eq(m2.querySelectorAll(".nf-sw-row").filter((r) => r.isShown).map((r) => r.id), ["nf-sw-palette-nord"], "nord only");
    eq(m2.querySelectorAll(".nf-sw-group").map((g) => g.isShown), [true, false], "empty group hidden");
    eq(m2.querySelector("input").getAttr("aria-activedescendant"), "nf-sw-palette-nord", "nord active");
    typeQuery("zzz");
    ok(m2.querySelector(".suggestion-empty").isShown, "empty state");
    eq(m2.querySelector(".suggestion-empty").textContent, "No palette or look matches.", "empty text");
    eq(m2.querySelector("input").getAttr("aria-activedescendant"), null, "no active descendant");
    doc.flushFrames();
    eq(host.previews.at(-1), { palette: "classic", look: "classic" }, "empty state previews the saved style");
    eq(press(modal, "Enter"), false, "Enter with no row");
    eq(host.settings.palette, "classic", "no row: nothing saved");
    eq(globalThis.__nfNotices.length, 0, "no notice");
    typeQuery("nord");
    host.log.length = 0;
    press(modal, "Enter");
    eq(host.settings.palette, "nord", "Enter commits the palette");
    eq(host.settings.look, "classic", "the look stays");
    eq(host.log.filter((x) => x !== "preview"), ["apply", "save"], "no restore; applied, then saved");
    eq(globalThis.__nfNotices, ["Note style: Nord · Classic"], "notice");
    doc.flushFrames();
    eq(host.previews.at(-1), { palette: "classic", look: "classic" }, "no preview after the commit");

    // Reopen: the check follows the save; a click commits the look.
    modal.open();
    const m3 = modal.modalEl;
    eq(m3.querySelectorAll('[aria-current="true"]').map((r) => r.id), ["nf-sw-palette-nord", "nf-sw-look-classic"], "✓ follows the save");
    eq(m3.querySelector("input").getAttr("aria-activedescendant"), "nf-sw-palette-nord", "opens on the saved palette");
    const clickEvt = click(m3.querySelector('[data-id="soft"] .suggestion-note'));
    ok(clickEvt.defaultPrevented, "click handled");
    eq([host.settings.palette, host.settings.look], ["nord", "soft"], "click commits the look, palette kept");
    eq(globalThis.__nfNotices.at(-1), "Note style: Nord · Soft cards", "click notice");
  }
  {
    // ZH, dark mode: dark swatches, English names in <small>, IME text filter, ZH notice.
    const doc = makeDoc();
    doc.body.addClass("theme-dark");
    globalThis.__nfFakeDoc = doc;
    globalThis.__nfNotices = [];
    const host = switcherHost(base({ palette: "bogus", look: "soft" }));
    const modal = new ZH.StyleSwitcherModal({}, host);
    modal.open();
    const m = modal.modalEl;
    eq(m.querySelector('[data-id="nord"] .nf-sw-dots span').cssProps["--nf-dot"], SP.PALETTES[2].swatch.dark[0], "dark swatch");
    eq(m.querySelector('[data-id="nord"] .suggestion-title').textContent, "北境Nord", "ZH title + small EN");
    eq(m.querySelector('[data-id="nord"] .suggestion-title small').textContent, "Nord", "small EN name");
    eq(m.querySelector('[data-id="classic"] .suggestion-title small')?.textContent, "Classic", "classic small");
    eq(m.querySelectorAll('[aria-current="true"]').map((r) => r.id), ["nf-sw-palette-classic", "nf-sw-look-soft"], "unknown palette reads classic");
    eq(m.querySelector("input").getAttr("placeholder"), "搜索配色方案与版式", "ZH placeholder");
    eq(m.querySelectorAll(".nf-sw-group-header").map((h) => h.textContent), ["配色方案", "版式"], "ZH headers");
    const el = m.querySelector("input");
    el.value = "莫兰迪"; el.dispatchEvent(makeEvent("input"));
    eq(m.querySelectorAll(".nf-sw-row").filter((r) => r.isShown).map((r) => r.getAttr("data-id")), ["morandi"], "莫兰迪");
    el.value = "卡片"; el.dispatchEvent(makeEvent("input"));
    eq(m.querySelectorAll(".nf-sw-row").filter((r) => r.isShown).map((r) => r.getAttr("data-id")), ["soft"], "卡片");
    el.value = "北境"; el.dispatchEvent(makeEvent("input"));
    press(modal, "Enter");
    eq(globalThis.__nfNotices, ["笔记样式：北境 · 柔和卡片"], "ZH notice");
    eq(m.querySelector(".suggestion-empty").textContent, "没有匹配的配色方案或版式。", "ZH empty text");
  }
  {
    // A failing save is caught.
    const doc = makeDoc();
    globalThis.__nfFakeDoc = doc;
    const warns = [];
    const warn = console.warn;
    console.warn = (...a) => warns.push(a);
    try {
      const host = { ...switcherHost(base()), save: () => Promise.reject(new Error("disk full")) };
      const modal = new EN.StyleSwitcherModal({}, host);
      modal.open();
      press(modal, "ArrowDown");
      press(modal, "Enter");
      await settle();
      eq(host.settings.palette, "notion", "committed");
      eq(warns.length, 1, "save failure warned, not thrown");
    } finally {
      console.warn = warn;
    }
  }

  /* 15. DOM smoke: colorDot */
  {
    const doc = makeDoc();
    const control = doc.body.createDiv({ cls: "setting-item-control" });
    const select = control.createEl("select", { cls: "dropdown" });
    for (const v of ["auto", "accent", "default", "green", "none"]) select.createEl("option", { value: v, text: v });
    let stored = "accent";
    const dot = EN.colorDot({ controlEl: control }, "listMarkerColor", () => stored);
    const el = control.children[0];
    ok(el.hasClass("nf-setting-dot") && el.getAttr("aria-hidden") === "true", "the dot is the first child");
    eq(el.getAttr("data-key"), "listMarkerColor", "keyed for CSS");
    eq(control.children[1], select, "before the select");
    eq(el.cssProps["--nf-dot"], "var(--interactive-accent)", "painted at creation from getValue");
    select.value = "green";
    select.dispatchEvent(makeEvent("change"));
    eq(el.cssProps["--nf-dot"], "var(--nf-green)", "repaints on change from select.value");
    stored = "default";
    dot.refresh();
    eq(el.cssProps["--nf-dot"], "var(--list-marker-color)", "refresh uses getValue");
    const thead = doc.body.createDiv({ cls: "setting-item-control" });
    const theadSelect = thead.createEl("select");
    for (const v of ["auto", "none", "red"]) theadSelect.createEl("option", { value: v, text: v });
    let value = "none";
    const theadDot = EN.colorDot({ controlEl: thead }, "tableHeaderColor", () => value);
    const tEl = thead.children[0];
    ok(tEl.hasClass("is-none") && tEl.cssProps["--nf-dot"] === "transparent", "none: dashed ring");
    theadSelect.value = "red";
    theadSelect.dispatchEvent(makeEvent("change"));
    ok(!tEl.hasClass("is-none") && tEl.cssProps["--nf-dot"] === "rgba(var(--nf-red-rgb), 0.16)", "a hue clears is-none");
    value = "auto";
    theadDot.refresh();
    eq(tEl.cssProps["--nf-dot"], "var(--nf-dot-thead, var(--nf-style-thead, var(--table-header-background)))", "auto: the table CSS's header");
    const bare = doc.body.createDiv();
    EN.colorDot({ controlEl: bare }, "quoteBarColor", () => "text").refresh();
    eq(bare.children[0].cssProps["--nf-dot"], "var(--text-normal)", "works without a select");
  }

  /* 16. DOM smoke: codeThemeGallery */
  {
    const doc = makeDoc();
    const root = doc.body.createDiv();
    const host = makeHost(base({ codeTheme: "bogus" }));
    const gallery = EN.codeThemeGallery(root, host);
    const grid = gallery.el;
    ok(grid.parent === root && grid.hasClass("nf-gallery") && grid.hasClass("nf-code-gallery"), "grid appended");
    eq([grid.getAttr("role"), grid.getAttr("aria-label")], ["radiogroup", "Code block theme"], "radiogroup");
    const cards = grid.querySelectorAll('[role="radio"]');
    eq(cards.length, 12, "12 cards");
    ok(cards.every((c) => c.hasClass("nf-gallery-card") && c.hasClass("nf-code-card")), "card classes");
    eq(cards.map((c) => c.getAttr("data-id")), ["auto", ...SP.CODE_THEME_IDS], "card order");
    const badges = grid.querySelectorAll(".nf-code-badge");
    eq(badges.map((b) => b.textContent), ["Dark only", "Dark only", "Dark only"], "3 Dark only badges");
    eq(badges.map((b) => b.closest('[role="radio"]').getAttr("data-id")), ["one-dark", "dracula", "nord"], "on the fixed dark themes");
    eq(cards.map((c) => c.querySelector(".nf-gallery-name").nodes[0].textContent),
      ["Follow palette", ...SP.CODE_THEME_IDS.map((id) => EN.CODE_THEME_LABELS[id])], "names");
    eq(grid.querySelector('[data-id="dracula"]').getAttr("aria-label"), "Dracula (Dark only)", "badge in the accessible name");
    eq(grid.querySelector('[data-id="github"]').getAttr("aria-label"), "GitHub", "plain accessible name");
    const sample = grid.querySelector('[data-id="github"] .nf-code-sample');
    eq([sample.getAttr("data-code-theme"), sample.getAttr("aria-hidden")], ["github", "true"], "sample keyed by theme");
    eq(sample.children.map((line) => line.textContent), ["const n = 42;", "greet(\"hi\") // ok", "<a href=\"#\">"], "three lines");
    eq(sample.children[0].children.map((s) => s.className), ["nf-ct-kw", "nf-ct-op", "nf-ct-val", "nf-ct-punct"], "line 1 tokens");
    eq(sample.children[1].children.map((s) => s.className), ["nf-ct-fn", "nf-ct-punct", "nf-ct-str", "nf-ct-punct", "nf-ct-cm"], "line 2 tokens");
    eq(sample.children[2].children.map((s) => s.className), ["nf-ct-punct", "nf-ct-tag", "nf-ct-prop", "nf-ct-op", "nf-ct-str", "nf-ct-punct"], "line 3 tokens");
    const checked = () => grid.querySelectorAll('[aria-checked="true"]').map((c) => c.getAttr("data-id"));
    eq(checked(), ["auto"], "an invalid stored theme checks Follow palette");
    eq(grid.querySelectorAll('[tabindex="0"]').map((c) => c.getAttr("data-id")), ["auto"], "one tab stop");
    // Click.
    click(grid.querySelector('[data-id="github"] .nf-ct-kw'));
    eq(host.settings.codeTheme, "github", "click selects");
    eq(host.log, ["apply", "save"], "applied, then saved");
    await host.flushSaves();
    eq(host.log, ["apply", "save", "saved", "changed"], "changed after the save");
    eq(checked(), ["github"], "checked moved");
    eq(doc.activeElement.getAttr("data-id"), "github", "click focuses the card");
    // Keys.
    const right = key(doc.activeElement, "ArrowRight");
    ok(right.defaultPrevented && doc.activeElement.getAttr("data-id") === "vscode", "ArrowRight moves focus");
    eq(host.settings.codeTheme, "github", "focus does not select");
    grid.__cols = "140px 140px 140px 140px";
    key(doc.activeElement, "ArrowDown");
    eq(doc.activeElement.getAttr("data-id"), "gruvbox", "ArrowDown by 4 columns");
    const enter = key(doc.activeElement, "Enter");
    ok(enter.defaultPrevented && host.settings.codeTheme === "gruvbox", "Enter selects");
    await host.flushSaves();
    host.log.length = 0;
    key(doc.activeElement, " ");
    eq(host.log, [], "re-choosing the checked theme saves nothing");
    ok(!key(doc.activeElement, "Escape").defaultPrevented, "Escape passes through");
    // refresh re-reads the settings.
    host.settings.codeTheme = "nord";
    gallery.refresh();
    eq(checked(), ["nord"], "refresh");
    host.settings.codeTheme = "auto";
    gallery.refresh();
    eq(checked(), ["auto"], "refresh to auto");
    const zh = ZH.codeThemeGallery(doc.body.createDiv(), makeHost(base()));
    eq(zh.el.querySelectorAll(".nf-code-badge").map((b) => b.textContent), ["仅深色", "仅深色", "仅深色"], "ZH badges");
    eq(zh.el.querySelector('[data-id="nord"]').getAttr("aria-label"), "Nord（仅深色）", "ZH accessible name");
    eq(zh.el.getAttr("aria-label"), "代码块主题", "ZH group label");
  }

  /* 17. DOM smoke: renderSettingsPreview */
  {
    globalThis.__nfRenders = [];
    const doc = makeDoc();
    const box = doc.body.createDiv();
    const app = { id: "app" }, component = { id: "component" };
    const root = EN.renderSettingsPreview(box, app, component);
    eq(globalThis.__nfRenders.length, 1, "rendered once");
    const [call] = globalThis.__nfRenders;
    eq([call.app, call.component, call.sourcePath, call.markdown], [app, component, "", EN.PREVIEW_SAMPLE.en], "render arguments");
    eq(box.children[0].className, "nf-settings-preview-label", "label first");
    eq(box.children[0].textContent, "Preview", "label text");
    eq(box.children[1], root, "then the root");
    ok(root.hasClass("markdown-reading-view") && root.hasClass("nf-settings-preview"), "root classes");
    eq(root.getAttr("inert"), "", "inert");
    eq(root.getAttr("aria-label"), "Preview", "labelled");
    eq(call.el, root.children[0], "renders into the inner view");
    ok(call.el.hasClass("markdown-preview-view") && call.el.hasClass("markdown-rendered"), "inner classes");
    globalThis.__nfRenders = [];
    ZH.renderSettingsPreview(doc.body.createDiv(), app, component);
    eq(globalThis.__nfRenders[0].markdown, EN.PREVIEW_SAMPLE.zh, "ZH sample");
    // A failed render is caught and warned.
    const warns = [];
    const warn = console.warn;
    console.warn = (...a) => warns.push(a);
    globalThis.__nfRenderFail = true;
    try {
      EN.renderSettingsPreview(doc.body.createDiv(), app, component);
      await settle();
      eq(warns.length, 1, "render failure warned");
      eq(warns[0][0], "Notion Flow: settings preview", "warning text");
    } finally {
      console.warn = warn;
      delete globalThis.__nfRenderFail;
    }
  }

  console.log(`PASS run-style-ui (${checks} checks)`);
} finally {
  delete globalThis.__nfFakeDoc;
  delete globalThis.__nfNotices;
  delete globalThis.__nfRenders;
  await rm(directory, { recursive: true, force: true });
}
