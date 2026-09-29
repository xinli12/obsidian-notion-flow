import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const PREVIEW = '.canvas-node-content.markdown-embed > .markdown-embed-content > .markdown-preview-view';

// A rendered text fixture: line wrapping depends on the measured clone width,
// while the original card, editor classes, IDs, and inline styles are observable.
function fixture({ text = 'Short', glyph = 8, lineHeight = 24, rich = false,
  unbreakable = 0, connected = true, rendered = true, fail = false, image = false,
  gutter = 0, omitBottomPadding = false } = {}) {
  const state = { reads: 0, clones: [], appended: [], attached: new Set() };
  const style = () => {
    const values = new Map();
    return {
      values,
      setProperty: (name, value) => values.set(name, value),
      getPropertyValue: name => values.get(name) ?? '',
    };
  };
  const element = () => {
    const classes = new Set(['is-editing']);
    const attributes = new Map([['id', 'live-card']]);
    return {
      style: style(), classes, attributes,
      classList: { add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)) },
      setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: name => attributes.delete(name),
    };
  };
  // Elements a measurement adds to its copy: a sample paragraph.
  const created = (tag) => {
    const made = { ...element(), tagName: tag.toUpperCase(), children: [], _text: '' };
    made.classes.delete('is-editing');
    made.classList.contains = name => made.classes.has(name);
    Object.defineProperty(made, 'className', { get: () => [...made.classes].join(' '), set: value => { made.classes.clear(); value.split(/\s+/).filter(Boolean).forEach(name => made.classes.add(name)); } });
    Object.defineProperty(made, 'textContent', { get: () => made._text + made.children.map(child => child.textContent).join(''), set: value => { made._text = value; } });
    made.append = (...items) => made.children.push(...items);
    return made;
  };
  const doc = { createElement: created, defaultView: { getComputedStyle: el => el.role === 'preview'
    ? { paddingTop: '10px', paddingBottom: '10px', borderTopWidth: '0px', borderBottomWidth: '0px' }
    : { borderTopWidth: '1px', borderBottomWidth: '1px' } } };
  const parent = {
    appendChild(card) {
      card.isConnected = true;
      state.attached.add(card);
      state.appended.push({ editing: card.classes.has('is-editing'), id: card.attributes.has('id'),
        hidden: card.attributes.get('aria-hidden'), inert: card.attributes.has('inert') });
    },
  };
  const makeCard = isClone => {
    const card = element();
    const child = element();
    const container = element();
    const contentHeight = innerWidth => {
      const inner = Math.max(1, innerWidth);
      // A sample paragraph put in place of the card's words is measured instead of them.
      const sample = sizer.children.find(child => child.classList.contains('el-p'));
      if (sample) {
        const columns = Math.max(1, Math.floor(inner / glyph));
        return sample.textContent.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil([...line].length / columns)), 0) * lineHeight;
      }
      if (image) return Math.ceil(inner * 9 / 16);
      if (rich) return 68;
      const columns = Math.max(1, Math.floor(inner / glyph));
      const lines = text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil([...line].length / columns)), 0);
      return lines * lineHeight;
    };
    const pusher = created('div');
    pusher.className = 'markdown-preview-pusher';
    const words = created('div');
    words.className = 'el-p-own';
    // A blank card's sizer is empty: no pusher, no words.
    const sizer = { ...element(), children: rendered ? [pusher, words] : [],
      get childElementCount() { return this.children.length; },
      replaceChildren(...items) { this.children = items; },
      querySelector: () => rich && !sizer.children.some(child => child.classList.contains('el-p')) ? {} : null,
      get scrollHeight() { return contentHeight(preview.clientWidth - 32); } };
    const preview = { ...element(), role: 'preview', querySelector: () => sizer,
      get clientWidth() {
        const reserved = this.style.getPropertyValue('scrollbar-gutter') === 'auto' ? 0 : gutter;
        return Math.max(0, Number.parseFloat(card.style.getPropertyValue('width')) - 2 - reserved);
      },
      get scrollWidth() { return Math.max(this.clientWidth, unbreakable + 32); },
      get scrollHeight() {
        state.reads++;
        if (fail) throw new Error('render failed');
        // Chromium's constrained flex preview can omit trailing padding from
        // its overflow box even though the fitted card still needs that inset.
        return (omitBottomPadding ? 10 : 20) + contentHeight(this.clientWidth - 32);
      },
    };
    Object.assign(card, {
      ownerDocument: doc, parentElement: parent, isConnected: isClone ? false : connected,
      querySelector: selector => selector === PREVIEW ? preview : selector === '.canvas-node-container' ? container : null,
      querySelectorAll: () => [child],
      cloneNode: () => { const clone = makeCard(true); state.clones.push(clone); return clone; },
      remove: () => { card.isConnected = false; state.attached.delete(card); },
    });
    card.style.setProperty('width', '260px');
    card.style.setProperty('height', '120px');
    return card;
  };
  return { node: makeCard(false), state };
}

const directory = await mkdtemp(join(tmpdir(), 'notion-flow-canvas-measurement-'));
try {
  const outfile = join(directory, 'measurement.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/canvas/measurement.ts', import.meta.url))],
    bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
  });
  const { measureCard } = await import(pathToFileURL(outfile).href);
  const fit = (options, width = 480, minimum = 112, fitWidth = true, room = undefined) => {
    const sample = fixture(options);
    const before = { style: [...sample.node.style.values], classes: [...sample.node.classes], attributes: [...sample.node.attributes] };
    const result = measureCard(sample.node, width, minimum, fitWidth, room);
    assert.deepEqual([...sample.node.style.values], before.style, 'measurement never resizes the live card');
    assert.deepEqual([...sample.node.classes], before.classes, 'the native editor keeps its classes');
    assert.deepEqual([...sample.node.attributes], before.attributes, 'the original IDs remain intact');
    assert.equal(sample.state.attached.size, 0, 'every measurement copy is removed');
    for (const appended of sample.state.appended) {
      assert.deepEqual(appended, { editing: false, id: false, hidden: 'true', inert: true }, 'measurement copies are inert and leave edit mode');
    }
    return { ...sample, result };
  };

  assert.deepEqual(fit({ text: 'Short' }).result, { width: 112, height: 52 }, 'short labels retain the comfortable minimum');
  assert.deepEqual(fit({ text: 'Root' }, 480, 160).result, { width: 160, height: 52 }, 'root width minimum is respected');
  const medium = fit({ text: 'x'.repeat(50) });
  assert.ok(medium.result.width > 200 && medium.result.width < 320, 'a medium topic can wrap instead of making a 434px strip');
  assert.equal(medium.result.height, 76, 'medium topics get a balanced two-line shape');
  const threshold = 34 + Math.ceil(50 / 2) * 8;
  assert.ok(medium.result.width >= threshold + 12, 'the chosen wrap leaves horizontal breathing room');
  assert.deepEqual(fit({ text: 'x'.repeat(50) }).result, medium.result, 'identical content produces stable dimensions');
  assert.ok(medium.state.reads <= 30, 'candidate comparisons and refinement have a small bounded cost');

  const chinese = fit({ text: '内容随卡片自然调整，修改时也能保持清楚舒适的阅读空间。', glyph: 16 });
  assert.ok(chinese.result.width > 160 && chinese.result.width < 400);
  assert.ok(chinese.result.height > 52, 'CJK wrapping is driven by actual glyph measurements');
  const largeType = fit({ text: 'x'.repeat(50), glyph: 12, lineHeight: 32 });
  assert.ok(largeType.result.width > medium.result.width || largeType.result.height > medium.result.height, 'larger type receives more room');
  const long = fit({ text: 'x'.repeat(2000) });
  assert.ok(long.result.width >= 440 && long.result.width <= 480, 'long notes retain a wide reading area');
  assert.ok(long.result.height > 640, 'measurement reports the whole document; the sizing policy owns the height cap');
  const literalLines = fit({ text: 'Short\nExplicit\nLines' });
  assert.equal(literalLines.result.height, 100, 'explicit line breaks survive fitting');

  // Words drawn without a box keep only a sliver of spare width: it shows as a gap before their line.
  const roomy = fit({ text: 'Short' }, 480, 40).result;
  const snug = fit({ text: 'Short' }, 480, 40, true, 2).result;
  assert.equal(roomy.width - snug.width, 10, 'a hugging card keeps 2px beside its words rather than 12');
  assert.equal(snug.height, roomy.height, 'and its words stay on one line');
  assert.ok(snug.width < 112, 'below the boxed minimum');
  assert.deepEqual(fit({ text: 'Short' }, 260, 112, false).result, { width: 260, height: 52 }, 'preserved widths are never narrowed');
  assert.equal(fit({ text: 'xxxx' }, 65.8, 112, false).result.height, 76,
    'a fractional preserved width must not be rounded wider and lose a wrapped line');
  assert.equal(fit({ text: 'Short' }, 260, 112, false).state.reads, 1, 'height-only fits need one measurement');
  assert.equal(fit({ text: 'x'.repeat(55), gutter: 15 }, 260, 112, false).result.height, 100,
    'height fitting preserves the native stable scrollbar gutter when computing line wraps');
  for (const gutter of [15, 30]) {
    const native = fit({ text: 'x'.repeat(50), gutter });
    native.node.style.setProperty('width', `${native.result.width}px`);
    const preview = native.node.querySelector(PREVIEW);
    assert.ok(native.result.height >= preview.scrollHeight + 2,
      'a fitted card contains the text when the live preview reserves one or both scrollbar gutters');
  }
  assert.equal(fit({ text: 'x'.repeat(55), omitBottomPadding: true }, 260, 112, false).result.height, 76,
    'the complete vertical inset is included even when flex overflow omits the bottom padding');
  assert.equal(fit({ text: 'x'.repeat(55), gutter: 15, omitBottomPadding: true }, 260, 112, false).result.height, 100,
    'native gutter and trailing padding are both included in a fixed-width card height');
  assert.equal(fit({ rich: true }).result.width, 480, 'tables and code keep the available reading width');
  assert.equal(fit({ rich: true, image: true }).result.width, 480, 'responsive media never get narrowed by their decreasing height');
  assert.ok(fit({ text: 'Literal', unbreakable: 380 }).result.width >= 425, 'unbreakable content cannot be collapsed merely because its height stays constant');
  assert.equal(fit({ text: 'Literal', unbreakable: 800 }).result.width, 480, 'content wider than the bound retains the full available width');
  assert.equal(fit({ text: 'Short' }, 90, 112).result.width, 90, 'an explicit maximum takes priority over the requested minimum');
  assert.equal(fit({ connected: false }).result, null, 'detached cards cannot collapse from an empty measurement');
  assert.equal(fit({ rendered: false }).result, null, 'unrendered previews cannot be fitted');
  // A blank card renders nothing; a sample line measures what one line of its type takes.
  const blank = fixture({ rendered: false, lineHeight: 24 });
  assert.deepEqual(measureCard(blank.node, 112, 112, false, undefined, 'Mg国'), { width: 112, height: 20 + 24 + 2 + 6 },
    'a blank card measures one line: insets, the line, borders and slack');
  const threeLines = fixture({ text: 'a\nb\nc', lineHeight: 24 });
  const lineOnly = measureCard(threeLines.node, 112, 112, false, undefined, 'Mg国');
  assert.equal(lineOnly.height, 52, 'the sample stands in for the card\'s own words');
  assert.equal(measureCard(threeLines.node, 112, 112, false).height, 20 + 3 * 24 + 2 + 6, 'without it, the words are measured');
  const kept = fixture({ rendered: false });
  measureCard(kept.node, 112, 112, false, undefined, 'Mg国');
  const copied = kept.state.clones[0].querySelector(PREVIEW).querySelector(':scope > .markdown-preview-sizer').children;
  assert.deepEqual(copied.map(child => child.className), ['markdown-preview-pusher', 'el-p'],
    'the copy gains the pusher a rendered card has (it takes the first block\'s top margin) and holds the sample');
  assert.deepEqual([copied[1].children[0].tagName, copied[1].children[0].attributes.get('dir'), copied[1].textContent], ['P', 'auto', 'Mg国'],
    'shaped as Canvas renders a one-line card');
  assert.equal(kept.node.querySelector(PREVIEW).querySelector(':scope > .markdown-preview-sizer').children.length, 0,
    'the live card keeps its own (empty) preview');
  const worded = fixture({ text: 'Words' });
  measureCard(worded.node, 112, 112, false, undefined, 'Mg国');
  const wordedCopy = worded.state.clones[0].querySelector(PREVIEW).querySelector(':scope > .markdown-preview-sizer').children;
  assert.deepEqual(wordedCopy.map(child => child.className), ['markdown-preview-pusher', 'el-p'], 'a card\'s own words give way to the sample');
  assert.equal(kept.state.attached.size, 0, 'and the copy is removed');
  for (const bad of [0, -1, NaN, Infinity]) assert.equal(fit({}, bad).result, null);
  const failed = fixture({ fail: true });
  assert.throws(() => measureCard(failed.node, 480, 112, true), /render failed/);
  assert.equal(failed.state.attached.size, 0, 'measurement failures also remove the cloned DOM');
  console.log('PASS canvas measurement: balanced wrapping, horizontal breathing room, actual font metrics, rich content, and isolated bounded measurements');
} finally {
  await rm(directory, { recursive: true, force: true });
}
