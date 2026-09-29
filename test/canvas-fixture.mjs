import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

// A stand-in for Canvas and its document, shared by the canvas controller
// tests. Only the DOM behaviors used by the adapter: class changes, observer delivery,
// focus, scoped keyboard handlers, animation-frame coalescing, and a rendered
// Markdown box whose wrapping changes with its measured width.
export class FakeElement {
  constructor(doc, tag = 'div') {
    this.ownerDocument = doc;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.events = new Map();
    this.classes = new Set();
    this.classList = {
      contains: name => this.classes.has(name),
      add: (...names) => this.setClasses([...this.classes, ...names]),
      remove: (...names) => this.setClasses([...this.classes].filter(name => !names.includes(name))),
      toggle: (name, enabled = !this.classes.has(name)) => {
        if (enabled) this.classList.add(name); else this.classList.remove(name);
        return enabled;
      },
    };
    this._text = '';
    this.dataset = {};
    const props = new Map();
    this.styleProperties = props;
    this.style = {
      setProperty: (name, value) => props.set(name, value),
      getPropertyValue: name => props.get(name) ?? '',
      removeProperty: name => props.delete(name),
    };
  }
  setClasses(names) {
    const oldValue = this.className;
    this.classes = new Set(names);
    if (oldValue !== this.className) this.ownerDocument.notify({ type: 'attributes', attributeName: 'class', oldValue, target: this });
  }
  get className() { return [...this.classes].join(' '); }
  set className(value) { this.setClasses(value.split(/\s+/).filter(Boolean)); }
  get textContent() { return this.textProvider?.() ?? this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) {
    if (this._text !== value) {
      this._text = value;
      this.ownerDocument.notify({ type: 'childList', target: this });
    }
  }
  append(...elements) {
    for (const element of elements) {
      if (element.parentElement) element.remove();
      element.parentElement = this;
      this.children.push(element);
    }
    this.ownerDocument.notify({ type: 'childList', target: this, addedNodes: elements, removedNodes: [] });
  }
  appendChild(element) { this.append(element); return element; }
  replaceChildren(...elements) {
    for (const child of [...this.children]) child.remove();
    this.append(...elements);
  }
  remove() {
    const parent = this.parentElement;
    if (!parent) return;
    parent.children = parent.children.filter(child => child !== this);
    this.parentElement = null;
    // As in a browser, taking the focused element out of the page drops the focus to the body.
    const active = this.ownerDocument.activeElement;
    if (active && active !== this.ownerDocument.body && this.contains(active)) this.ownerDocument.activeElement = this.ownerDocument.body;
    this.ownerDocument.notify({ type: 'childList', target: parent, addedNodes: [], removedNodes: [this] });
  }
  setAttribute(name, value) {
    if (name === 'class') this.className = String(value);
    else this.attributes.set(name, String(value));
  }
  getAttribute(name) { return name === 'class' ? this.className : this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, handler) {
    if (!this.events.has(name)) this.events.set(name, new Set());
    this.events.get(name).add(handler);
  }
  removeEventListener(name, handler) { this.events.get(name)?.delete(handler); }
  dispatch(name, detail = {}) {
    const event = { type: name, target: this, defaultPrevented: false,
      stopPropagation() {}, stopImmediatePropagation() {}, preventDefault() { this.defaultPrevented = true; }, ...detail };
    for (const handler of this.events.get(name) ?? []) handler(event);
    return event;
  }
  matches(selector) {
    return selector.split(',').some(part => {
      const term = part.trim();
      if (term.includes('>')) {
        const path = term.split('>').map(item => item.trim()).reverse();
        let current = this;
        return path.every(item => {
          const match = current?.matches(item);
          current = current?.parentElement;
          return match;
        });
      }
      if (term.startsWith('.')) return term.slice(1).split('.').every(name => this.classes.has(name));
      if (term.startsWith('[')) {
        const [name, value] = term.slice(1, -1).split('=');
        return value === undefined ? this.attributes.has(name) : this.getAttribute(name) === value.replace(/["']/g, '');
      }
      return this.tagName.toLowerCase() === term;
    });
  }
  contains(element) {
    for (let current = element; current; current = current.parentElement) if (current === this) return true;
    return false;
  }
  closest(selector) {
    for (let current = this; current; current = current.parentElement) if (current.matches(selector)) return current;
    return null;
  }
  querySelectorAll(selector) {
    if (selector.startsWith(':scope > ')) return this.children.filter(child => child.matches(selector.slice(9)));
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  cloneNode(deep = false) {
    const copy = new FakeElement(this.ownerDocument, this.tagName);
    copy.className = this.className;
    copy.attributes = new Map(this.attributes);
    copy.dataset = { ...this.dataset };
    copy._text = this.textProvider?.() ?? this._text;
    for (const [name, value] of this.styleProperties) copy.style.setProperty(name, value);
    if (deep) copy.append(...this.children.map(child => child.cloneNode(true)));
    return copy;
  }
  get isConnected() { return this.ownerDocument.body?.contains(this) ?? false; }
  get childElementCount() { return this.children.length; }
  get clientWidth() {
    const node = this.closest('.canvas-node');
    return node ? Math.max(0, (parseFloat(node.style.getPropertyValue('width')) || 0) - 2) : 0;
  }
  get scrollHeight() {
    if (!this.matches('.markdown-preview-view') || !this.isConnected) return 0;
    this.ownerDocument.measurementReads++;
    const columns = Math.max(1, Math.floor((this.clientWidth - 32) / 8));
    const sizer = this.querySelector('.markdown-preview-sizer');
    return 20 + (sizer?.children ?? []).reduce((total, child) => {
      // Obsidian's pusher is a sliver above the first block.
      if (child.classes.has('markdown-preview-pusher')) return total;
      // Wide code and tables scroll horizontally; responsive images get
      // shorter when narrowed. Neither is safely fit from height alone.
      if (['PRE', 'TABLE', 'IMG'].includes(child.tagName)) {
        if (this.closest('.nf-canvas-measuring')) this.ownerDocument.measuredRichTags.add(child.tagName);
        if (child.tagName === 'IMG') {
          const width = Number(child.getAttribute('width')) || 640;
          const height = Number(child.getAttribute('height')) || 360;
          return total + Math.ceil(Math.min(width, this.clientWidth - 32) * height / width);
        }
        if (child.tagName === 'TABLE') return total + 20 * Math.max(1, child.children.length);
        return total + 20 * child.textContent.split('\n').length;
      }
      const lines = child.textContent.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil([...line].length / columns)), 0);
      return total + 20 * lines;
    }, 0);
  }
  get firstChild() { return this.children[0] ?? null; }
  get parentNode() { return this.parentElement; }
  get previousSibling() {
    const siblings = this.parentElement?.children ?? [];
    return siblings[siblings.indexOf(this) - 1] ?? null;
  }
  get nextSibling() {
    const siblings = this.parentElement?.children ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  insertBefore(element, reference) {
    if (element.parentElement) element.remove();
    element.parentElement = this;
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index < 0) this.children.push(element); else this.children.splice(index, 0, element);
    this.ownerDocument.notify({ type: 'childList', target: this });
  }
  focus() { this.ownerDocument.activeElement = this; }
}

export function fakeDocument() {
  const observers = new Set();
  const frames = new Map();
  let nextFrame = 0;
  const doc = {
    measurementReads: 0,
    measuredRichTags: new Set(),
    notify(record) {
      for (const observer of observers) {
        if (observer.target && (observer.target === record.target || observer.options.subtree && observer.target.contains(record.target))) {
          if (record.type === 'childList' && observer.options.childList ||
              record.type === 'attributes' && observer.options.attributes && observer.options.attributeFilter.includes(record.attributeName)) {
            observer.records.push(record);
          }
        }
      }
    },
    createElement(tag) { return new FakeElement(doc, tag); },
    createElementNS(namespace, tag) { return new FakeElement(doc, tag); },
    listeners: new Map(),
    addEventListener(name, handler) { if (!doc.listeners.has(name)) doc.listeners.set(name, new Set()); doc.listeners.get(name).add(handler); },
    removeEventListener(name, handler) { doc.listeners.get(name)?.delete(handler); },
    flush() {
      for (let round = 0; round < 20; round++) {
        let work = false;
        for (const observer of observers) if (observer.records.length) {
          work = true;
          observer.callback(observer.records.splice(0));
        }
        const scheduled = [...frames.values()];
        frames.clear();
        for (const callback of scheduled) { work = true; callback(); }
        const timed = [...timers.values()];
        timers.clear();
        for (const callback of timed) { work = true; callback(); }
        if (!work) return;
      }
      throw new Error('Mutation/frame feedback loop');
    },
    pendingFrames: () => frames.size + timers.size,
    connectedObservers: () => [...observers].filter(observer => observer.target).length,
  };
  const timers = new Map();
  const windowEvents = new Map();
  doc.defaultView = {
    crypto: webcrypto,
    getComputedStyle() { return { borderTopWidth: '1px', borderBottomWidth: '1px', getPropertyValue: () => '' }; },
    requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback) { const id = ++nextFrame; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, handler) { if (!windowEvents.has(name)) windowEvents.set(name, new Set()); windowEvents.get(name).add(handler); },
    removeEventListener(name, handler) { windowEvents.get(name)?.delete(handler); },
    dispatch(name, detail = {}) {
      const event = { type: name, pointerId: 1, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, stopImmediatePropagation() {}, ...detail };
      for (const handler of [...(windowEvents.get(name) ?? [])]) handler(event);
      return event;
    },
    listeners: name => windowEvents.get(name)?.size ?? 0,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.records = []; observers.add(this); }
      observe(target, options) { this.target = target; this.options = options; }
      disconnect() { this.target = null; this.records = []; }
    },
  };
  doc.body = doc.createElement('body');
  doc.activeElement = doc.body;
  doc.querySelector = (selector) => doc.body.querySelector(selector);
  return doc;
}

export class FakeScope {
  keys = [];
  register(modifiers, key, func) {
    const handler = { scope: this, modifiers, key, func };
    this.keys.push(handler);
    return handler;
  }
  unregister(handler) { this.keys = this.keys.filter(item => item !== handler); }
  // Like Obsidian: "Mod" is Cmd on macOS, and keys match regardless of case.
  dispatch(event) {
    const mods = [event.altKey && 'Alt', event.shiftKey && 'Shift', event.ctrlKey && 'Ctrl', event.metaKey && 'Meta'].filter(Boolean).sort();
    const handler = this.keys.find(item => item.key.toLowerCase() === event.key.toLowerCase()
      && [...item.modifiers].map(mod => mod === 'Mod' ? 'Meta' : mod).sort().join() === mods.join());
    return handler?.func(event);
  }
}

export const nodeData = (id, x = 0, y = 0, extra = {}) => ({ id, type: 'text', x, y, width: 260, height: 120, text: id, ...extra });
export const edgeData = (id, fromNode, toNode, extra = {}) => ({ id, fromNode, toNode, fromSide: 'right', toSide: 'left', ...extra });
export const clone = value => structuredClone(value);
export const keyEvent = (key, target, extra = {}) => ({ key, target, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, repeat: false, defaultPrevented: false, ...extra });

export function fakeCanvas(doc, initial = { nodes: [], edges: [] }, seed = true) {
  const wrapperEl = doc.createElement('div');
  doc.body.append(wrapperEl);
  let metadata = clone(initial);
  let pending = null;
  const end = (id, side) => {
    const node = canvas.nodes.get(id);
    return { side, node: node && { getBBox() { const d = node.data; return { minX: d.x, minY: d.y, maxX: d.x + d.width, maxY: d.y + d.height }; } } };
  };
  const edgeProto = {
    getData() { return clone(this.data); },
    setData(data) { this.data = clone(data); },
    get id() { return this.data.id; },
    get from() { return end(this.data.fromNode, this.data.fromSide ?? 'right'); },
    get to() { return end(this.data.toNode, this.data.toSide ?? 'left'); },
    updatePath() {
      this.nativeDraws = (this.nativeDraws ?? 0) + 1;
      this.path.display.setAttribute('d', 'native');
      this.path.interaction.setAttribute('d', 'native');
    },
  };
  const canvas = {
    wrapperEl, nodes: new Map(), edges: new Map(), selection: new Set(), readonly: false,
    history: { data: [], current: 0 }, saves: 0, importCalls: 0, zooms: [],
    getData() { return { ...clone(metadata), nodes: [...this.nodes.values()].map(node => node.getData()), edges: [...this.edges.values()].map(edge => edge.getData()) }; },
    pushHistory(data) {
      this.history.data.splice(this.history.current + 1);
      this.history.data.push(clone(data));
      this.history.current = this.history.data.length - 1;
    },
    // Like Canvas: saving records an undo step unless told not to.
    requestSave(push = true) { this.saves++; if (push) pending = this.getData(); },
    requestPushHistory: { run() { if (pending) { canvas.pushHistory(pending); pending = null; } }, cancel() { pending = null; } },
    // Native: flush, then replace the current step with the present state.
    overrideHistory() { this.requestPushHistory.run(); this.history.data[this.history.current] = clone(this.getData()); },
    removeEdge(edge) { const id = edge.getData().id; edge.lineGroupEl.remove(); this.edges.delete(id); this.selection.delete(edge); },
    removeNode(node) {
      for (const [id, edge] of this.edges) if (edge.data.fromNode === node.id || edge.data.toNode === node.id) this.removeEdge(edge);
      node.nodeEl.remove(); this.nodes.delete(node.id); this.selection.delete(node);
    },
    selectAll(items) { this.selection.clear(); for (const item of items) this.selection.add(item); },
    deselect(item) { this.selection.delete(item); item.nodeEl?.classList.remove('is-focused'); },
    posFromEvt(evt) { return { x: evt.clientX, y: evt.clientY }; },
    importData(data, clear) {
      this.importCalls++;
      if (clear) {
        metadata = clone(data);
        for (const [id, node] of this.nodes) if (!data.nodes.some(item => item.id === id)) { node.nodeEl.remove(); this.nodes.delete(id); }
        for (const [id, edge] of this.edges) if (!data.edges.some(item => item.id === id)) { edge.lineGroupEl.remove(); this.edges.delete(id); }
        this.selection.clear();
      }
      for (const item of data.nodes) {
        let node = this.nodes.get(item.id);
        if (!node) {
          const nodeEl = doc.createElement('div');
          nodeEl.className = 'canvas-node';
          wrapperEl.append(nodeEl);
          node = { id: item.id, nodeEl, isEditing: false,
            getData() { return clone(this.data); },
            moveTo(pos) { Object.assign(this.data, pos); },
            resize(size) { this.resizeCalls = (this.resizeCalls ?? 0) + 1; Object.assign(this.data, size); },
            onResizeDblclick() { throw new Error('Native fitting would resize and save during measurement'); },
            attach() { if (!nodeEl.parentElement) wrapperEl.append(nodeEl); },
            render() {
              nodeEl.style.setProperty('width', `${this.data.width}px`);
              nodeEl.style.setProperty('height', `${this.data.height}px`);
            },
            startEditing() { this.isEditing = true; nodeEl.classList.add('is-editing'); },
          };
          const container = doc.createElement('div'); container.className = 'canvas-node-container';
          const content = doc.createElement('div'); content.className = 'canvas-node-content markdown-embed';
          const embed = doc.createElement('div'); embed.className = 'markdown-embed-content';
          const preview = doc.createElement('div'); preview.className = 'markdown-preview-view';
          const sizer = doc.createElement('div'); sizer.className = 'markdown-preview-sizer';
          const paragraph = doc.createElement('p'); paragraph.textProvider = () => String(node.data.text ?? '');
          sizer.append(paragraph); preview.append(sizer); embed.append(preview); content.append(embed); container.append(content); nodeEl.append(container);
          this.nodes.set(item.id, node);
        }
        node.data = clone(item);
        node.render();
      }
      for (const item of data.edges) {
        let edge = this.edges.get(item.id);
        if (!edge) {
          // Like Canvas: drawing lives on the prototype, the path in the edge's group.
          edge = Object.create(edgeProto);
          Object.assign(edge, { lineGroupEl: doc.createElement('g'), lineEndGroupEl: doc.createElement('g'), labelElement: { wrapperEl: doc.createElement('div') } });
          edge.path = { display: doc.createElement('path'), interaction: doc.createElement('path') };
          edge.lineGroupEl.append(edge.path.display, edge.path.interaction);
          wrapperEl.append(edge.lineGroupEl, edge.lineEndGroupEl, edge.labelElement.wrapperEl);
          this.edges.set(item.id, edge);
        }
        edge.data = clone(item);
        edge.updatePath();
      }
    },
    selectOnly(node) {
      for (const previous of this.selection) previous.nodeEl?.classList.remove('is-focused');
      this.selection.clear(); this.selection.add(node); node.nodeEl.classList.add('is-focused');
    },
    zoomToBbox(box) { this.zooms.push(box); },
    undo() { if (this.history.current > 0) this.importData(this.history.data[--this.history.current], true); },
    redo() { if (this.history.current + 1 < this.history.data.length) this.importData(this.history.data[++this.history.current], true); },
  };
  canvas.importData(initial, false);
  canvas.importCalls = 0;
  if (seed) canvas.pushHistory(canvas.getData());
  return canvas;
}

// `save` persists a setting changed from the canvas (by default into `settings`);
// `computed(color, colorScheme)` answers getComputedStyle's color for the colour probe.
export function fixture(Enhancements, data, app = {}, { save, computed } = {}) {
  const doc = fakeDocument();
  if (computed) {
    const plain = doc.defaultView.getComputedStyle;
    doc.defaultView.getComputedStyle = (el) => ({ ...plain(el),
      color: computed(el.style.getPropertyValue('color'), el.style.getPropertyValue('color-scheme')) ?? '' });
  }
  const canvas = fakeCanvas(doc, data);
  const scope = new FakeScope();
  const view = { canvas, scope, file: { path: 'test.canvas' } };
  // The typing flow (Enter/Tab in an editor, empty new cards taken away) is
  // opted into by the tests that cover it; the rest keep empty cards.
  const settings = { canvasEnhancements: true, canvasAppearance: true, canvasKeyboard: true, canvasAutoLayout: true, canvasAutoFit: true, canvasEditorKeys: false };
  const events = new Map();
  const workspace = {
    leaves: [{ view }], activeLeaf: { view },
    getLeavesOfType(type) { assert.equal(type, 'canvas'); return this.leaves; },
    on(name, callback) { if (!events.has(name)) events.set(name, []); events.get(name).push(callback); return { name, callback }; },
    emit(name, ...args) { for (const callback of events.get(name) ?? []) callback(...args); },
    onLayoutReady(callback) { callback(); },
    // Obsidian's own suggestions come first, as its link suggestion does.
    editorSuggest: { suggests: [{ native: 'link' }] },
  };
  const commands = new Map();
  const plugin = { app: { workspace, ...app }, registerEvent() {}, addCommand(command) { commands.set(command.id, command); },
    registerEditorSuggest(suggest) { workspace.editorSuggest.suggests.push(suggest); } };
  const manager = new Enhancements(plugin, () => settings, save ?? ((patch) => Object.assign(settings, patch)));
  const command = (id, checking = false) => commands.get(`canvas-${id}`).checkCallback(checking);
  const button = label => canvas.wrapperEl.querySelectorAll('button').find(item => item.getAttribute('aria-label') === label);
  return { doc, canvas, scope, view, settings, workspace, manager, command, button, commands };
}
