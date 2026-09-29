import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    dispatch(name) { for (const callback of [...(listeners.get(name) ?? [])]) callback({ type: name }); },
    listenerCount: () => [...listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0),
  };
}

function element(doc, rect = { left: 0, top: 0, right: 1200, bottom: 900, width: 1200, height: 900 }) {
  const classes = new Set();
  const properties = new Map();
  return {
    ...eventTarget(), ownerDocument: doc, isConnected: true, classes, properties,
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle(name, force) {
        const present = force === undefined ? !classes.has(name) : !!force;
        if (present) classes.add(name); else classes.delete(name);
        return present;
      },
    },
    style: {
      getPropertyValue: name => properties.get(name) ?? '',
      setProperty: (name, value) => properties.set(name, value),
      removeProperty: name => properties.delete(name),
    },
    getBoundingClientRect: () => rect,
  };
}

/**
 * A card being edited: the outer node, its preview and container, and a native
 * CodeMirror stand-in in a separate iframe document. The editor's content
 * height follows its current width, and the scroller takes a topic's copied
 * inset the way the plugin CSS gives it.
 */
function fixture(Surface, {
  ready = true, comfortable = true, card = { width: 112, height: 52 }, widen = false,
  anchor = { x: 0, y: 0 }, room = undefined, border = 1, text = 'Short', lineHeight = 24,
} = {}) {
  let sequence = 0;
  const frames = new Map(), timers = new Map(), mutations = new Set(), resizes = new Set();
  const outerWindow = {
    ...eventTarget(),
    requestAnimationFrame(callback) { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback) { const id = ++sequence; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    // The native editor belongs to another document. Reading its style from
    // the canvas window would miss the iframe's editor styles.
    getComputedStyle(target) {
      assert.equal(target.ownerDocument, outerDocument, 'read native editor styles from its owner window');
      if (target === container) return { borderTopWidth: `${border}px`, borderBottomWidth: `${border}px`, borderLeftWidth: `${border}px`, borderRightWidth: `${border}px` };
      if (target === sizer) return { justifyContent: sizer.style.getPropertyValue('justify-content') || 'normal' };
      assert.equal(target, preview, 'only the card preview, container and sizer are read from the outer window');
      return {
        fontSize: target.style.getPropertyValue('font-size'),
        getPropertyValue: name => target.style.getPropertyValue(name),
      };
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.target = null; mutations.add(this); }
      observe(target, options) { this.target = target; this.options = options; }
      disconnect() { this.target = null; }
    },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.targets = new Set(); resizes.add(this); }
      observe(target) { this.targets.add(target); }
      unobserve(target) { this.targets.delete(target); }
      disconnect() { this.targets.clear(); }
    },
  };
  const outerDocument = {
    defaultView: outerWindow,
    createElement(name) {
      assert.equal(name, 'canvas');
      return { getContext: () => ({ font: '', measureText: value => ({ width: [...value].length * 8 }) }) };
    },
  };
  const iframeDocument = {
    defaultView: { getComputedStyle: target => {
      assert.equal(target.ownerDocument, iframeDocument, 'native font and padding measurements use the iframe window');
      // A topic's scroller takes the card's inset from the copied variables, as the plugin CSS does.
      const topic = target === cm.scrollDOM && target.classes.has('nf-canvas-topic-editor');
      const inset = (side, fallback) => topic ? target.style.getPropertyValue(`--nf-topic-padding-${side}`) || fallback : fallback;
      return {
        fontStyle: 'normal', fontWeight: '400', fontSize: '16px', fontFamily: 'Test', letterSpacing: 'normal',
        paddingTop: inset('top', '0px'), paddingBottom: inset('bottom', '0px'),
        paddingLeft: inset('left', '16px'), paddingRight: inset('right', '16px'),
      };
    } },
  };
  iframeDocument.body = element(iframeDocument);
  iframeDocument.body.style.setProperty('background-color', 'white');
  const node = element(outerDocument, { left: 100, top: 100, right: 212, bottom: 152, width: 112, height: 52 });
  const preview = element(outerDocument);
  const sizer = element(outerDocument);
  const container = element(outerDocument);
  let previewAvailable = true;
  node.querySelector = selector => {
    if (selector === '.canvas-node-container') return container;
    assert.equal(selector, '.markdown-preview-view');
    return previewAvailable ? preview : null;
  };
  preview.querySelector = selector => {
    assert.equal(selector, ':scope > .markdown-preview-sizer');
    return sizer;
  };
  const size = { ...card };
  const readWidths = [];
  let draft = text, nativeReady = ready, nativeFrame = 0, lookups = 0, expanded = comfortable, editorKeys = 0;
  // Words wrap at the editor's text width: eight units a letter, a line at a time.
  let height = width => {
    const inner = width - 2 * border - 32;
    return Math.max(1, ...draft.split('\n').map(line => Math.ceil(([...line].length * 8) / inner) || 1)) * lineHeight
      + (draft.split('\n').length - 1) * lineHeight;
  };
  const requests = new Map();
  const cm = {
    dom: element(iframeDocument), scrollDOM: element(iframeDocument), contentDOM: element(iframeDocument),
    state: { doc: { toString: () => draft } }, composing: false,
    defaultCharacterWidth: 8, defaultLineHeight: lineHeight,
    get contentHeight() {
      const width = Number.parseFloat(node.style.getPropertyValue('--nf-editor-width')) || size.width;
      readWidths.push(width);
      return height(width);
    },
    requestMeasure(request) {
      if (request) requests.set(request.key ?? request, request);
      if (nativeFrame) return;
      nativeFrame = outerWindow.requestAnimationFrame(() => {
        nativeFrame = 0;
        const current = [...requests.values()];
        requests.clear();
        const values = current.map(item => item.read(cm));
        current.forEach((item, index) => item.write?.(values[index], cm));
      });
    },
  };
  const surface = new Surface(node, () => { lookups++; return nativeReady ? cm : undefined; },
    () => ({ size, widen, anchor, ...(room === undefined ? {} : { room }) }), () => expanded, () => editorKeys++);
  const nextFrame = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback();
  };
  const flush = () => {
    let count = 0;
    while (frames.size && count++ < 30) nextFrame();
    assert.equal(frames.size, 0, 'editor measurements settle instead of forming a frame loop');
  };
  return {
    surface, node, preview, sizer, container, wrapperless: true, cm, iframeDocument, outerWindow, frames, timers, mutations, resizes,
    size, readWidths, nextFrame, flush,
    get editorKeys() { return editorKeys; },
    setReady(value) { nativeReady = value; },
    setComfortable(value) { expanded = value; surface.update(); },
    setPreviewAvailable(value) { previewAvailable = value; },
    get lookups() { return lookups; },
    runTimers() { const callbacks = [...timers.values()]; timers.clear(); for (const callback of callbacks) callback(); },
    type(value) {
      draft = value;
      cm.dom.dispatch('input');
    },
    /** A widget inside the words renders at a new height, with no new text. */
    render(measured) { height = () => measured; },
    mutate(type = 'characterData') {
      for (const observer of mutations) if (observer.target === cm.contentDOM && observer.options[type]) observer.callback([{ type, target: cm.contentDOM }]);
    },
    resizeContent() { for (const observer of resizes) if (observer.targets.has(cm.contentDOM)) observer.callback([{ target: cm.contentDOM }]); },
    box: () => ({
      width: Number.parseFloat(node.style.getPropertyValue('--nf-editor-width')),
      height: Number.parseFloat(node.style.getPropertyValue('--nf-editor-height')),
      x: Number.parseFloat(node.style.getPropertyValue('--nf-editor-x')),
      y: Number.parseFloat(node.style.getPropertyValue('--nf-editor-y')),
    }),
  };
}

/** A map topic whose preview carries resolved type, inset and alignment. */
function asTopic(editor, { rich = false, centred = !rich } = {}) {
  editor.node.style.setProperty('--nf-size', '1.25');
  if (rich) editor.node.classList.add('nf-canvas-map-rich');
  for (const [name, value] of Object.entries({
    'font-size': '20px', 'font-weight': '600', 'font-family': 'Topic Sans', 'line-height': '24px', 'letter-spacing': '0.2px',
    color: 'rgb(1, 2, 3)', 'text-align': 'center', 'padding-top': '10px', 'padding-right': '16px', 'padding-bottom': '10px', 'padding-left': '16px',
  })) editor.preview.style.setProperty(name, value);
  if (centred) editor.sizer.style.setProperty('justify-content', 'safe center');
  editor.surface.update();
  editor.flush();
  return editor;
}

const directory = await mkdtemp(join(tmpdir(), 'notion-flow-canvas-editor-surface-'));
try {
  const outfile = join(directory, 'editor-surface.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/canvas/editor-surface.ts', import.meta.url))],
    bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
  });
  const { CanvasEditorSurface } = await import(pathToFileURL(outfile).href);

  /* ---------- opening changes nothing ---------- */
  const editor = fixture(CanvasEditorSurface);
  assert.deepEqual(editor.box(), { width: 112, height: 52, x: 0, y: 0 }, 'the editor opens at exactly the card box, before any frame');
  assert.equal(editor.editorKeys, 1, 'keys are bound as soon as the editor exists, leaving no gap for an early Enter or Tab');
  editor.flush();
  assert.deepEqual(editor.box(), { width: 112, height: 52, x: 0, y: 0 }, 'words that fit leave the card as it is: no minimum panel, no zoom scale');
  assert.equal(editor.node.properties.has('--nf-editor-scale'), false, 'the editor keeps the canvas zoom');
  assert.equal(editor.cm.scrollDOM.classes.has('nf-canvas-native-editor'), true, 'iframe styling is attached to the stable scroll element');
  assert.notEqual(editor.cm.dom.ownerDocument, editor.node.ownerDocument, 'the fixture keeps the editor in a separate document');
  assert.equal(editor.cm.scrollDOM.classes.has('nf-canvas-topic-editor'), false, 'ordinary canvas editors do not receive map typography');
  assert.equal(editor.cm.scrollDOM.classes.has('nf-canvas-card-headings'), false, 'nor card headings, without the polished card look');
  assert.deepEqual([...editor.cm.scrollDOM.properties.keys()], ['--nf-editor-inset'], 'only the card inset crosses into an ordinary editor');
  assert.equal(editor.cm.scrollDOM.style.getPropertyValue('--nf-editor-inset'), '2.2px', 'Canvas room around a card’s words follows the card height (52 → 2.2px)');
  assert.equal(editor.iframeDocument.body.style.getPropertyValue('background-color'), 'transparent', 'the editor page is see-through, so the card keeps its colour');

  /* ---------- growing for words that need room ---------- */
  editor.type('A paragraph long enough to wrap onto several lines in a narrow card');
  editor.flush();
  const grown = editor.box();
  assert.equal(grown.width, 112, 'a free card never widens');
  // 67 letters at 8 units in 78 units of text: 7 lines of 24, Canvas room of 16 above and below, borders, and a fitted card's slack.
  assert.equal(grown.height, 7 * 24 + 32 + 2 + 6, 'it takes the height a card fitted to its words has, so closing the editor moves nothing');
  assert.deepEqual([grown.x, grown.y], [0, 0], 'a free card grows downwards from where it is');
  editor.type('Long paragraph '.repeat(200));
  editor.mutate();
  editor.flush();
  assert.equal(editor.box().height, 640, 'native characterData mutations grow long content only up to the card height limit');
  editor.type('Short');
  editor.mutate('childList');
  editor.flush();
  assert.deepEqual(editor.box(), { width: 112, height: 52, x: 0, y: 0 }, 'deleting the words gives the card back its own size');
  editor.cm.composing = true;
  editor.type('正在输入'.repeat(300));
  editor.mutate();
  editor.flush();
  assert.deepEqual(editor.box(), { width: 112, height: 52, x: 0, y: 0 }, 'active IME composition does not move the editor surface');
  editor.cm.composing = false;
  editor.cm.dom.dispatch('compositionend');
  editor.flush();
  assert.equal(editor.box().height, 640, 'the committed composition is measured on its next frame');
  assert.deepEqual(editor.size, { width: 112, height: 52 }, 'editing never changes saved Canvas geometry');

  // A card sized a pixel tight by hand does not grow as its editor opens.
  const tight = fixture(CanvasEditorSurface, { card: { width: 112, height: 25 } });
  tight.flush();
  assert.deepEqual(tight.box(), { width: 112, height: 25, x: 0, y: 0 }, 'a card a little too small for its words opens as it is');

  /* ---------- topics keep their place ---------- */
  const typography = asTopic(fixture(CanvasEditorSurface));
  const topicProperties = ['font-size', 'font-weight', 'font-family', 'line-height', 'letter-spacing', 'color', 'text-align',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left'];
  const readEditor = (editorFixture, names = topicProperties) => names.map(name => editorFixture.cm.scrollDOM.style.getPropertyValue(`--nf-topic-${name}`));
  assert.equal(typography.cm.scrollDOM.classes.has('nf-canvas-topic-editor'), true, 'map editors opt into typography after binding inside the iframe');
  assert.deepEqual(readEditor(typography), ['20px', '600', 'Topic Sans', '24px', '0.2px', 'rgb(1, 2, 3)', 'center', '10px', '16px', '10px', '16px'],
    'the resolved size, weight, family, leading, tracking, colour, alignment and inset cross the iframe boundary');
  assert.equal(typography.cm.scrollDOM.classes.has('nf-canvas-topic-centred'), true, 'a topic shorter than its card sits in the middle, as on the card');
  const headingStyles = Object.entries({
    '--h1-size': '1.32em', '--h2-size': '1.2em', '--h3-size': '1.1em',
    '--h4-size': '1.04em', '--h5-size': '1em', '--h6-size': '0.94em',
    '--h1-line-height': '1.3', '--h2-line-height': '1.3', '--h3-line-height': '1.35',
  });
  for (const [name, value] of headingStyles) typography.preview.style.setProperty(name, value);
  typography.cm.scrollDOM.style.setProperty('--bold-weight', '800');
  typography.surface.update();
  typography.flush();
  assert.deepEqual(headingStyles.map(([name]) => typography.cm.scrollDOM.style.getPropertyValue(name)),
    headingStyles.map(([, value]) => value), 'Markdown titles use the same compact heading proportions in preview and editing');
  assert.equal(typography.cm.scrollDOM.classes.has('nf-canvas-card-headings'), true);
  assert.equal(typography.cm.scrollDOM.style.getPropertyValue('--bold-weight'), '800', 'body hierarchy does not overwrite explicit Markdown emphasis styling');
  assert.equal(typography.cm.dom.properties.size, 0, 'typography is applied to the stable native scroller rather than replacing CodeMirror styles');
  assert.deepEqual(typography.box(), { width: 112, height: 52, x: 0, y: 0 }, 'a topic that fits keeps its card box exactly');
  // The topic's empty-line hint ("Type a topic…") has one writer, the binding's
  // bindEditorKeys; the surface carries type and inset only.
  assert.equal(typography.cm.scrollDOM.style.getPropertyValue('--nf-empty-hint'), '', 'the surface leaves the empty-line hint alone');
  {
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = fileURLToPath(new URL('../src/canvas/', import.meta.url));
    const writers = readdirSync(dir).filter(name => name.endsWith('.ts')).flatMap(name =>
      [...readFileSync(join(dir, name), 'utf8').matchAll(/setProperty\??\.?\(\s*["']--nf-empty-hint["']/g)].map(() => name));
    assert.deepEqual(writers, ['enhancements.ts'], 'exactly one place in src/canvas writes --nf-empty-hint');
  }

  typography.preview.style.setProperty('font-size', '15px');
  typography.surface.update();
  typography.flush();
  assert.equal(typography.cm.scrollDOM.style.getPropertyValue('--nf-topic-font-size'), '15px', 'a depth or theme change refreshes the existing editor typography');

  // A note in a map (lists, headings) keeps its type and inset, not a topic's centring.
  typography.node.classList.add('nf-canvas-map-rich');
  typography.surface.update();
  typography.flush();
  assert.equal(typography.cm.scrollDOM.style.getPropertyValue('--nf-topic-text-align'), '', 'a rich card edits left-aligned, as notes do');
  assert.equal(typography.cm.scrollDOM.style.getPropertyValue('--nf-topic-padding-top'), '10px', 'but keeps its inset');
  assert.equal(typography.cm.scrollDOM.classes.has('nf-canvas-topic-centred'), false);
  typography.node.classList.remove('nf-canvas-map-rich');

  typography.node.style.removeProperty('--nf-size');
  typography.surface.update();
  typography.flush();
  assert.equal(typography.cm.scrollDOM.classes.has('nf-canvas-topic-editor'), false, 'leaving the map disables hierarchy styling');
  assert.deepEqual(readEditor(typography), topicProperties.map(() => ''), 'leaving the map clears all iframe font overrides');
  for (const [name] of headingStyles) assert.equal(typography.cm.scrollDOM.style.getPropertyValue(name), '', 'leaving the map removes card-specific heading proportions');
  assert.equal(typography.cm.scrollDOM.classes.has('nf-canvas-native-editor'), true, 'ordinary surface behavior remains bound when hierarchy is disabled');

  // A polished free card keeps its compact headings while it is typed in.
  typography.node.classList.add('nf-canvas-text');
  typography.surface.update();
  typography.flush();
  assert.equal(typography.cm.scrollDOM.style.getPropertyValue('--h1-size'), '1.32em', 'a free card’s headings stay the size they are on the card');
  assert.equal(typography.cm.scrollDOM.classes.has('nf-canvas-card-headings'), true);
  assert.deepEqual(readEditor(typography), topicProperties.map(() => ''), 'but it takes none of a topic’s type');
  typography.node.classList.remove('nf-canvas-text');

  typography.node.style.setProperty('--nf-size', '1.5');
  typography.surface.update();
  typography.flush();
  typography.setPreviewAvailable(false);
  typography.surface.update();
  typography.flush();
  assert.equal(typography.cm.scrollDOM.classes.has('nf-canvas-topic-editor'), false, 'a missing preview clears stale typography');
  assert.deepEqual(readEditor(typography), topicProperties.map(() => ''));
  typography.setPreviewAvailable(true);
  typography.preview.style.setProperty('font-size', '0px');
  typography.surface.update();
  typography.flush();
  assert.equal(typography.cm.scrollDOM.classes.has('nf-canvas-topic-editor'), false, 'invalid preview font size cannot hide the editor text');
  typography.surface.destroy();
  typography.flush();
  assert.equal(typography.cm.scrollDOM.classes.size, 0, 'closing removes every iframe class');
  assert.deepEqual(readEditor(typography), topicProperties.map(() => ''), 'closing removes every iframe typography property');
  for (const [name] of headingStyles) assert.equal(typography.cm.scrollDOM.style.getPropertyValue(name), '', 'closing removes every copied heading property');
  assert.equal(typography.cm.scrollDOM.style.getPropertyValue('--bold-weight'), '800');
  assert.equal(typography.node.style.getPropertyValue('--nf-size'), '1.5', 'editor cleanup retains the card preview hierarchy');
  assert.equal(typography.iframeDocument.body.style.getPropertyValue('background-color'), 'white', 'closing gives the editor page its own background back');

  /* ---------- a one-line topic widens, then wraps ---------- */
  const line = asTopic(fixture(CanvasEditorSurface, { widen: true, card: { width: 112, height: 46 } }));
  assert.deepEqual(line.box(), { width: 112, height: 46, x: 0, y: 0 });
  line.readWidths.length = 0;
  line.type('Beta with more');
  line.flush();
  // 14 letters (112) + an inset of 16 on each side + borders + room for a few letters.
  assert.deepEqual(line.box(), { width: 112 + 32 + 2 + 12, height: 46, x: 0, y: 0 }, 'a one-line topic widens with its line, keeping one line');
  line.type('A title that runs well past the point where a fitted card would wrap it');
  line.flush();
  // A line stays whole while it is cheaper than two: eight lines of height (8 × 24) of width, plus the card around it.
  assert.equal(line.box().width, 8 * 24 + 32 + 2 + 12, 'past the one-line reach it wraps as it will on the card');
  assert.ok(line.box().height > 46, 'and grows downwards instead');
  assert.ok(line.readWidths.includes(line.box().width), 'the height is measured again at the final width');
  line.type('Beta');
  line.flush();
  assert.deepEqual(line.box(), { width: 112, height: 46, x: 0, y: 0 }, 'deleting brings a widened topic back to its card');

  // Words with no box around them grow as snugly as they are fitted afterwards.
  const snug = asTopic(fixture(CanvasEditorSurface, { widen: true, room: 2, card: { width: 80, height: 46 } }));
  snug.type('Beta with more');
  snug.flush();
  assert.deepEqual(snug.box(), { width: 112 + 32 + 2 + 2, height: 46, x: 0, y: 0 }, 'a boxless topic keeps only its own spare width');

  const wrapped = asTopic(fixture(CanvasEditorSurface, { widen: true, text: 'Already more words than a line of this card holds', card: { width: 112, height: 200 } }));
  wrapped.type('Already more words than a line of this card holds, and more');
  wrapped.flush();
  assert.equal(wrapped.box().width, 112, 'a topic whose words already wrapped keeps its width');

  const noWiden = asTopic(fixture(CanvasEditorSurface, { widen: false, card: { width: 112, height: 46 } }));
  noWiden.type('Beta with more');
  noWiden.flush();
  assert.equal(noWiden.box().width, 112, 'a card that is not fitted afterwards never widens');

  /* ---------- growing away from the parent ---------- */
  const left = asTopic(fixture(CanvasEditorSurface, { widen: true, anchor: { x: 1, y: 0 }, card: { width: 112, height: 46 } }));
  left.type('Beta with more');
  left.flush();
  assert.deepEqual([left.box().x, left.box().y], [-46, 0], 'a topic left of its parent grows leftwards, its right edge on its line');
  const centre = asTopic(fixture(CanvasEditorSurface, { widen: true, anchor: { x: 0.5, y: 1 }, card: { width: 112, height: 46 } }));
  centre.type('Beta with more\nand a second line\nand a third');
  centre.flush();
  assert.equal(centre.box().x, -(centre.box().width - 112) / 2, 'a topic below or above its parent grows both ways');
  assert.equal(centre.box().y, -(centre.box().height - 46), 'and a topic above its parent grows upwards');

  /* ---------- comfortable editing off ---------- */
  const ordinary = asTopic(fixture(CanvasEditorSurface, { comfortable: false }));
  const geometryOverrides = () => [...ordinary.node.properties.keys()].filter(name => name.startsWith('--nf-editor-'));
  assert.deepEqual(geometryOverrides(), [], 'comfortable editing off never sizes a temporary surface');
  assert.equal(ordinary.cm.scrollDOM.classes.has('nf-canvas-native-editor'), false, 'ordinary editing does not take the comfortable classes');
  assert.equal(ordinary.cm.scrollDOM.classes.has('nf-canvas-topic-editor'), true);
  assert.equal(ordinary.cm.scrollDOM.style.getPropertyValue('--nf-topic-font-size'), '20px', 'ordinary editing still follows the card typography');
  assert.equal(ordinary.iframeDocument.body.style.getPropertyValue('background-color'), 'white', 'ordinary editing keeps the native editor page');
  assert.equal(ordinary.editorKeys, 1, 'Enter and Tab are bound in ordinary editing too');
  ordinary.setComfortable(true);
  ordinary.flush();
  assert.equal(ordinary.cm.scrollDOM.classes.has('nf-canvas-native-editor'), true, 'comfortable editing can be enabled without replacing the editor');
  assert.deepEqual(ordinary.box(), { width: 112, height: 52, x: 0, y: 0 });
  ordinary.type('Long paragraph '.repeat(30));
  ordinary.nextFrame(); // Turn off comfortable editing with an asynchronous native measurement pending.
  ordinary.setComfortable(false);
  ordinary.flush();
  assert.deepEqual(geometryOverrides(), [], 'turning it off removes dimensions and offsets despite a pending measurement');
  assert.equal(ordinary.cm.scrollDOM.style.getPropertyValue('--nf-topic-font-size'), '20px', 'turning it off preserves typography synchronization');
  ordinary.surface.destroy();
  ordinary.flush();
  assert.equal(ordinary.cm.scrollDOM.classes.size, 0, 'ordinary editor cleanup removes the topic class as well');
  assert.equal(ordinary.cm.scrollDOM.properties.size, 0, 'ordinary editor cleanup removes all copied fonts and heading proportions');

  /* ---------- widgets, cleanup and readiness ---------- */
  const widget = fixture(CanvasEditorSurface);
  widget.flush();
  widget.render(200);
  widget.resizeContent();
  widget.flush();
  assert.ok(widget.box().height >= 200, 'a rendered widget changing height is observed without requiring new text');
  widget.surface.destroy();

  editor.cm.dom.dispatch('keyup');
  assert.ok(editor.frames.size > 0, 'the fixture has an update queued when the editor closes');
  editor.surface.destroy();
  editor.flush();
  assert.equal(editor.node.properties.size, 0, 'closing removes every temporary size and position');
  assert.equal(editor.cm.scrollDOM.classes.has('nf-canvas-native-editor'), false);
  assert.equal(editor.cm.scrollDOM.properties.size, 0, 'closing removes the card inset from the iframe');
  for (const target of [editor.node, editor.outerWindow, editor.cm.dom]) assert.equal(target.listenerCount(), 0, 'closing removes event listeners from both documents');
  for (const observer of editor.mutations) assert.equal(observer.target, null);
  for (const observer of editor.resizes) assert.equal(observer.targets.size, 0);
  editor.cm.dom.dispatch('input');
  editor.mutate();
  editor.surface.update();
  assert.equal(editor.frames.size, 0, 'closed surfaces cannot enqueue another update');
  assert.equal(editor.timers.size, 0);

  const queued = fixture(CanvasEditorSurface);
  queued.nextFrame(); // Leave CodeMirror's asynchronous measurement in flight.
  queued.surface.destroy();
  queued.flush();
  assert.equal(queued.node.properties.size, 0, 'a pending native measurement cannot restore styles after destruction');

  const delayed = fixture(CanvasEditorSurface, { ready: false });
  assert.equal(delayed.editorKeys, 0, 'nothing is bound before the editor exists');
  delayed.flush();
  assert.equal(delayed.cm.scrollDOM.classes.has('nf-canvas-native-editor'), false);
  assert.ok(delayed.timers.size > 0, 'an iframe whose native editor is still loading schedules a readiness check');
  delayed.setReady(true);
  delayed.runTimers();
  delayed.flush();
  assert.equal(delayed.cm.scrollDOM.classes.has('nf-canvas-native-editor'), true, 'a delayed native editor binds without pointer or wheel events');
  assert.equal(delayed.editorKeys, 1, 'and gets its keys then');
  assert.equal(delayed.timers.size, 0, 'successful binding cancels remaining readiness checks');
  delayed.type('Long paragraph '.repeat(30));
  delayed.flush();
  assert.ok(delayed.box().height > 52, 'the delayed binding receives subsequent iframe input');
  delayed.surface.destroy();

  const waiting = fixture(CanvasEditorSurface, { ready: false });
  waiting.flush();
  assert.ok(waiting.timers.size > 0);
  waiting.surface.destroy();
  assert.equal(waiting.timers.size, 0, 'destroying an editor still waiting for CodeMirror cancels its retry timer');
  waiting.setReady(true);
  waiting.runTimers();
  waiting.flush();
  assert.equal(waiting.cm.scrollDOM.classes.has('nf-canvas-native-editor'), false);
  assert.equal(waiting.node.properties.size, 0, 'a destroyed waiting surface never restores its temporary styles');

  const absent = fixture(CanvasEditorSurface, { ready: false });
  absent.flush();
  for (let attempt = 0; attempt < 10 && absent.timers.size; attempt++) { absent.runTimers(); absent.flush(); }
  assert.equal(absent.timers.size, 0, 'a missing native editor cannot poll forever');
  assert.ok(absent.lookups <= 7, 'readiness retries remain bounded');
  absent.surface.destroy();

  console.log('PASS canvas editor surface: opens at the card box, grows in place to the fitted size, one-line widening and anchors, topic type and inset, see-through page, IME stability, cleanup, and readiness retries');
} finally {
  await rm(directory, { recursive: true, force: true });
}
