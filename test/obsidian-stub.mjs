export class Plugin {}
export class Component {
  load(){} unload(){}
  // Recorded, so a test can fire what a component registered.
  register(cb) { (this.registered ??= []).push(cb); }
  registerEvent(ref) { (this.events ??= []).push(ref); }
  registerDomEvent(el, type, cb) { (this.domEvents ??= []).push({ el, type, cb }); }
  registerInterval(id) { return id; }
  addChild(child) { (this.children ??= []).push(child); return child; }
}
export class MarkdownRenderer { static async render(){} }
export class PluginSettingTab { display(){} hide(){} }
export class EditorSuggest { constructor(){} setInstructions(){} }
export class Setting { constructor(){} setName(){return this} setDesc(){return this} addToggle(){return this} }
// Records each message in globalThis.__nfNotices; messageEl / containerEl /
// noticeEl stay undefined unless a test sets them.
export class Notice {
  constructor(message, duration) { this.message = String(message); this.duration = duration; (globalThis.__nfNotices ??= []).push(this.message); }
  hide() { this.hidden = true; }
}
// Like Obsidian's: handlers run in order; a null key or modifiers match anything.
export class Scope {
  constructor(parent) { this.parent = parent; this.keys = []; }
  register(modifiers, key, func) { const handler = { scope: this, modifiers, key, func }; this.keys.push(handler); return handler; }
  unregister(handler) { this.keys = this.keys.filter(item => item !== handler); }
  handleKey(evt) {
    for (const handler of this.keys) {
      if (handler.key !== null && handler.key.toLowerCase() !== evt.key.toLowerCase()) continue;
      const result = handler.func(evt);
      if (result !== undefined || handler.key !== null || handler.modifiers !== null) return result;
    }
    return this.parent?.handleKey?.(evt);
  }
}
// Bundled copies of this stub each get their own class; files are recognised by a mark.
export class TFile {
  constructor(path) { this.path = path; this.stubFile = true; }
  static [Symbol.hasInstance](value) { return value?.stubFile === true; }
}
// Records every opened modal in globalThis.__nfModalsOpened.
export class Modal {
  constructor(app) { this.app = app; this.contentEl = null; this.scope = new Scope(); }
  setTitle(title) { this.title = title; return this; }
  open() { (globalThis.__nfModalsOpened ??= []).push(this); }
  close() {}
}
// Records opened suggesters so tests can pick an item.
export class FuzzySuggestModal extends Modal {
  setPlaceholder(text) { this.placeholder = text; }
  open() { (globalThis.__nfOpenedModals ??= []).push(this); }
}
export const setIcon = () => {};
// Like Obsidian's: Mod opens a tab, Mod+Alt a split, Mod+Alt+Shift a window; the middle button a tab.
export class Keymap {
  static isModEvent(evt) {
    if (!evt) return false;
    if (evt.button === 1) return "tab";
    if (!(evt.ctrlKey || evt.metaKey)) return false;
    return evt.altKey ? (evt.shiftKey ? "window" : "split") : "tab";
  }
  static isModifier(evt, modifier) {
    return modifier === "Mod" ? !!(evt?.metaKey || evt?.ctrlKey)
      : modifier === "Shift" ? !!evt?.shiftKey
      : modifier === "Alt" ? !!evt?.altKey
      : false;
  }
}
export const requestUrl = async (...args) => globalThis.__nfRequestUrl
  ? globalThis.__nfRequestUrl(...args)
  : ({ status: 200, headers: {}, text: "" });
export const htmlToMarkdown = (html) => html;
export const editorLivePreviewField = {};
// Shared through a global, so a test can flip it for the copy bundled into test/bundle.mjs.
export const Platform = (globalThis.__nfStubPlatform ??= { isMacOS: false });
// Records its items (title, icon, click) and the menus shown, so tests can read and pick them.
export class Menu {
  items = [];
  /** items.length at each separator (separators are not items). */
  separators = [];
  addItem(cb) {
    const item = {
      setTitle(title) { this.title = title; return this; },
      setIcon(icon) { this.icon = icon; return this; },
      onClick(fn) { this.click = fn; return this; },
      setChecked(checked) { this.checked = checked; return this; },
      setSection(section) { this.section = section; return this; },
      setDisabled(disabled) { this.disabled = disabled; return this; },
      setIsLabel(isLabel) { this.isLabel = isLabel; return this; },
      setWarning(warning) { this.warning = warning; return this; },
      setSubmenu() { this.submenu = new Menu(); return this.submenu; },
    };
    cb(item);
    this.items.push(item);
    return this;
  }
  addSeparator() { this.separators.push(this.items.length); return this; }
  onHide(cb) { this.hideCallback = cb; return this; }
  hide() { this.hidden = true; this.hideCallback?.(); return this; }
  showAtMouseEvent() { (globalThis.__nfShownMenus ??= []).push(this); }
  showAtPosition(position) { this.position = position; (globalThis.__nfShownMenus ??= []).push(this); }
}
export class PopoverSuggest {
  constructor(app, scope) { this.app = app; this.scope = scope; this.isOpen = false; this.suggestEl = { style: {}, classList: { contains: () => false } }; }
  open() { this.isOpen = true; }
  close() { this.isOpen = false; }
}
// Records instances so tests can drive getSuggestions/selectSuggestion.
export class AbstractInputSuggest extends PopoverSuggest {
  constructor(app, textInputEl) { super(app); this.textInputEl = textInputEl; this.limit = 100; (globalThis.__nfInputSuggests ??= []).push(this); }
  setValue(value) { this.textInputEl.value = value; }
  getValue() { return this.textInputEl.value; }
  onSelect(cb) { this.selectCb = cb; return this; }
  selectSuggestion(value, evt) { this.selectCb?.(value, evt); }
}
export class SuggestModal extends Modal {
  // inputEl is an EventTarget, so a modal can re-query by dispatching "input".
  constructor(app) { super(app); this.limit = 100; this.emptyStateText = ""; this.inputEl = Object.assign(new EventTarget(), { value: "" }); this.resultContainerEl = {}; }
  setPlaceholder(text) { this.placeholder = text; }
  setInstructions(list) { this.instructions = list; }
  onNoSuggestion() {}
  selectSuggestion() {}
  selectActiveSuggestion(evt) { (this.activeSelections ??= []).push(evt); }
  open() { (globalThis.__nfOpenedModals ??= []).push(this); }
}
export class MarkdownView {}
export const getIcon = (id) => ({ id });
// Writes the text with its match ranges as <span class="suggestion-highlight">, like Obsidian's.
export function renderMatches(el, text, ranges) {
  if (!el) return;
  if (typeof el.setText === "function") el.setText(text);
  else el.textContent = text;
  el.matchRanges = ranges;
}
export const normalizePath = (path) => path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
export class MarkdownRenderChild extends Component { constructor(containerEl) { super(); this.containerEl = containerEl; } }
export class SettingGroup {
  constructor(containerEl) { this.containerEl = containerEl; this.settings = []; this.listEl = containerEl?.createDiv?.({ cls: "setting-items" }) ?? null; }
  setHeading(text) { this.heading = text; return this; }
  addClass() { return this; }
  addSetting(cb) { const s = new Setting(); cb(s); this.settings.push(s); return this; }
  addSearch(cb) { cb({ setPlaceholder() { return this; }, onChange() { return this; }, inputEl: { value: "" } }); return this; }
}
// Subsequence matcher shaped like Obsidian's: { score (higher = better, <= 0), matches } or null.
export function prepareFuzzySearch(query) {
  const q = query.toLowerCase().replace(/\s+/g, "");
  return (text) => {
    const t = text.toLowerCase(); let i = 0, score = 0, last = -1; const matches = [];
    for (let j = 0; j < t.length && i < q.length; j++) if (t[j] === q[i]) { matches.push([j, j + 1]); score -= last < 0 ? j : j - last - 1; last = j; i++; }
    return i === q.length ? { score, matches } : null;
  };
}
export const getLinkpath = (linktext) => linktext.replace(/[#|].*$/, "");
export const parseLinktext = (linktext) => { const h = linktext.indexOf("#"); return h < 0 ? { path: linktext, subpath: "" } : { path: linktext.slice(0, h), subpath: linktext.slice(h) }; };
