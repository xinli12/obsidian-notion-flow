import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Pure helpers the canvas panels place and color themselves with: where a
// popover goes beside its card, how far a side panel pans the map, the view
// a layout preview zooms out to (placement.ts), and reading a CSS color off
// the page as #rrggbb (color-probe.ts).
const directory = await mkdtemp(join(tmpdir(), 'notion-flow-placement-'));
try {
  const source = file => JSON.stringify(fileURLToPath(new URL(`../src/canvas/${file}`, import.meta.url)));
  const entry = join(directory, 'entry.ts');
  await writeFile(entry, `export * from ${source('color-probe.ts')};\nexport * from ${source('placement.ts')};\n`);
  const outfile = join(directory, 'placement.mjs');
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' });
  const { parseRgb, rgbHex, resolveColor, roomyView, sameView, anchorBeside, panelShift } = await import(pathToFileURL(outfile).href);

  /* ---- roomyView: the view that shows a box beside the panel, zooming out only ---- */
  {
    // A 1000×800 area at scale 1 centred on (0, 0); the panel takes 300 px on the right, the toolbar 60 on top.
    const area = { width: 1000, height: 800 };
    const insets = { top: 60, right: 300, bottom: 8, left: 8 };
    const view = { x: 0, y: 0, zoom: 0 };
    const pad = 24;
    const free = (v) => {
      const s = 2 ** v.zoom;
      return { minX: v.x - area.width / 2 / s + (insets.left + pad) / s, maxX: v.x + area.width / 2 / s - (insets.right + pad) / s,
        minY: v.y - area.height / 2 / s + (insets.top + pad) / s, maxY: v.y + area.height / 2 / s - (insets.bottom + pad) / s };
    };
    const inside = (box, region) => box.minX >= region.minX - 1e-6 && box.maxX <= region.maxX + 1e-6 && box.minY >= region.minY - 1e-6 && box.maxY <= region.maxY + 1e-6;
    const room = free(view);
    assert.equal(roomyView({ minX: room.minX + 10, minY: room.minY + 10, maxX: room.maxX - 10, maxY: room.maxY - 10 }, view, area, insets), null, 'a box that fits needs no move');
    const freeWidth = area.width - insets.left - insets.right - 2 * pad;
    const freeHeight = area.height - insets.top - insets.bottom - 2 * pad;
    const wide = { minX: -freeWidth, minY: -50, maxX: freeWidth, maxY: 50 };
    const out = roomyView(wide, view, area, insets);
    assert.ok(out, 'a box twice the free width moves the view');
    assert.ok(Math.abs(out.zoom - Math.log2(freeWidth / (2 * freeWidth))) < 1e-9, 'zooming out by exactly what it takes (one step of log2 2)');
    assert.ok(inside(wide, free(out)), 'and then it fits beside the panel');
    const right = { minX: room.maxX - 100, minY: -50, maxX: room.maxX + 50, maxY: 50 };
    const panned = roomyView(right, view, area, insets);
    assert.equal(panned.zoom, 0, 'a box that only overhangs the panel is panned to, not zoomed out for');
    assert.ok(inside(right, free(panned)), 'and shows');
    assert.ok(panned.x > 0, 'the view moves toward it');
    // Never in: a small box far away is panned to at the same zoom.
    const far = roomyView({ minX: 5000, minY: 5000, maxX: 5010, maxY: 5010 }, { x: 0, y: 0, zoom: -1 }, area, insets);
    assert.equal(far.zoom, -1, 'never zooms in');
    // Never below the floor.
    const huge = roomyView({ minX: -1e6, minY: -10, maxX: 1e6, maxY: 10 }, view, area, insets);
    assert.equal(huge.zoom, -4, 'clamped at minZoom');
    assert.equal(roomyView({ minX: -1e6, minY: -10, maxX: 1e6, maxY: 10 }, view, area, insets, 24, -2).zoom, -2);
    assert.equal(roomyView(wide, view, { width: 200, height: 100 }, insets), null, 'no free area, no move');
    assert.ok(freeHeight > 0);
  }

  /* ---- sameView ---- */
  assert.equal(sameView({ x: 0, y: 0, zoom: 0 }, { x: 0.5, y: -0.5, zoom: 0 }, 1), true, 'within half a pixel');
  assert.equal(sameView({ x: 0, y: 0, zoom: 0 }, { x: 0.25, y: 0, zoom: 0 }, 2), true, 'half a pixel at scale 2');
  assert.equal(sameView({ x: 0, y: 0, zoom: 0 }, { x: 1.5, y: 0, zoom: 0 }, 1), false, 'beyond a pixel');
  assert.equal(sameView({ x: 0, y: 0, zoom: 0 }, { x: 0.75, y: 0, zoom: 0 }, 2), false, 'a pixel and a half at scale 2');
  assert.equal(sameView({ x: 0, y: 0, zoom: 0 }, { x: 0, y: 0, zoom: 0.002 }, 1), false, 'a zoom apart');
  assert.equal(sameView({ x: 0, y: 0, zoom: -1 }, { x: 0, y: 0, zoom: -1.0005 }, 0.5), true);

  /* ---- anchorBeside: a popover next to its card, never over it ---- */
  {
    const bounds = { left: 0, top: 60, right: 1000, bottom: 800 };
    const size = { width: 300, height: 200 };
    const card = (left, top, width = 120, height = 60) => ({ left, top, right: left + width, bottom: top + height });
    const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const box = (at) => ({ left: at.left, top: at.top, right: at.left + size.width, bottom: at.top + size.height });
    const within = (at) => at.left >= bounds.left && at.top >= bounds.top && at.left + size.width <= bounds.right && at.top + size.height <= bounds.bottom;
    let at = anchorBeside(card(400, 300), 300, size, bounds);
    assert.equal(at.side, 'right', 'right of the map middle, it opens to the right');
    assert.equal(at.left, 400 + 120 + 12);
    assert.equal(at.top, 330 - 100, 'vertically centred on the card');
    at = anchorBeside(card(400, 300), 600, size, bounds);
    assert.equal(at.side, 'left', 'left of the middle, to the left');
    assert.equal(at.left, 400 - 12 - 300);
    at = anchorBeside(card(800, 300), 300, size, bounds);
    assert.equal(at.side, 'left', 'no room on the right: the other side');
    assert.equal(anchorBeside(card(400, 300), 460, size, bounds).side, 'right', 'a card exactly at the middle opens right');
    // Neither side: below, then above.
    const narrow = { left: 0, top: 60, right: 500, bottom: 800 };
    at = anchorBeside(card(100, 200, 300), 250, size, narrow);
    assert.equal(at.side, 'below');
    assert.equal(at.top, 260 + 12);
    assert.ok(at.left >= narrow.left && at.left + size.width <= narrow.right, 'clamped across');
    at = anchorBeside(card(100, 650, 300), 250, size, narrow);
    assert.equal(at.side, 'above');
    assert.equal(at.top, 650 - 12 - 200);
    // Nothing fits: inside the bounds anyway.
    const tight = { left: 0, top: 60, right: 400, bottom: 320 };
    at = anchorBeside(card(50, 100, 300, 200), 200, size, tight);
    assert.ok(at.left >= tight.left && at.left + size.width <= tight.right && at.top >= tight.top && at.top + size.height <= tight.bottom, 'clamped inside');
    // The vertical clamp near the top and the bottom.
    at = anchorBeside(card(400, 62, 120, 20), 300, size, bounds);
    assert.equal(at.top, bounds.top);
    at = anchorBeside(card(400, 780, 120, 20), 300, size, bounds);
    assert.equal(at.top + size.height, bounds.bottom);
    // Property: wherever the card is, a side that fits never covers it, and the popover stays inside.
    let checked = 0;
    for (let x = 0; x <= 880; x += 40) for (let y = 60; y <= 740; y += 40) for (const middle of [200, 500, 800]) {
      const c = card(x, y);
      const spot = anchorBeside(c, middle, size, bounds);
      assert.ok(within(spot), `inside the bounds at ${x},${y}`);
      assert.equal(overlap(box(spot), c), 0, `never over the card at ${x},${y}`);
      checked++;
    }
    assert.ok(checked > 1000);
    // A card scrolled out of view: the popover waits at the nearest edge of the
    // bounds instead of following the card out of the (clipping) wrapper.
    at = anchorBeside(card(1400, 300), 800, size, bounds);
    assert.equal(at.left, bounds.right - size.width, 'card off to the right: flush with the right edge');
    assert.ok(within(at), 'and inside the bounds');
    at = anchorBeside(card(-400, 300), 200, size, bounds);
    assert.equal(at.left, bounds.left, 'card off to the left: flush with the left edge');
    assert.ok(within(at), 'and inside the bounds');
    at = anchorBeside(card(100, 1200, 300), 250, size, narrow);
    assert.equal(at.top, narrow.bottom - size.height, 'card below a narrow pane: flush with the bottom');
    at = anchorBeside(card(100, -400, 300), 250, size, narrow);
    assert.equal(at.top, narrow.top, 'card above a narrow pane: flush with the top');
    // Property over a grid that runs far past every edge: always inside.
    let outside = 0;
    for (let x = -1200; x <= 2200; x += 50) for (let y = -900; y <= 1700; y += 50) for (const middle of [200, 500, 800]) {
      if (!within(anchorBeside(card(x, y), middle, size, bounds))) outside++;
      const n = anchorBeside(card(x, y, 300), middle, size, narrow);
      if (!(n.left >= narrow.left && n.top >= narrow.top && n.left + size.width <= narrow.right && n.top + size.height <= narrow.bottom)) outside++;
    }
    assert.equal(outside, 0, 'never outside the bounds, wherever the card is');
  }

  /* ---- panelShift: how far a map pans left out from under a side panel ---- */
  {
    const wrapper = { left: 344, top: 78, right: 1280, bottom: 860 };
    const panel = { left: 908, top: 138, right: 1224, bottom: 700 };
    assert.equal(panelShift({ left: 500, top: 710, right: 1100, bottom: 800 }, panel, wrapper), 0, 'no vertical overlap');
    assert.equal(panelShift({ left: 600, top: 200, right: 1008, bottom: 500 }, panel, wrapper), 124, '100 px under it: 100 + 24');
    assert.equal(panelShift({ left: 400, top: 200, right: 1008, bottom: 500 }, panel, wrapper), 400 - 344 - 24, 'the map keeps its left edge on screen');
    assert.equal(panelShift({ left: 400, top: 200, right: 900, bottom: 500 }, panel, wrapper), 0, 'already left of the panel');
    assert.equal(panelShift({ left: 369, top: 200, right: 1008, bottom: 500 }, panel, wrapper), 0, 'under 2 px is no pan');
  }

  /* ---- parseRgb / rgbHex ---- */
  assert.deepEqual(parseRgb('rgb(181, 83, 60)'), [181, 83, 60, 1]);
  assert.deepEqual(parseRgb('rgb(181 83 60 / 1)'), [181, 83, 60, 1], 'space-separated with alpha');
  assert.deepEqual(parseRgb('rgba(0,0,0,0.5)'), [0, 0, 0, 0.5]);
  assert.deepEqual(parseRgb('rgb(10 20 30 / 50%)'), [10, 20, 30, 0.5]);
  assert.deepEqual(parseRgb('#abc'), [170, 187, 204, 1]);
  assert.deepEqual(parseRgb('#AABBCC'), [170, 187, 204, 1]);
  for (const other of ['oklch(0.6 0.13 277.467)', 'red', '', 'rgb(1, 2)', 'rgb(a, b, c)', '#12345', 'color(srgb 1 0 0)']) {
    assert.equal(parseRgb(other), null, `not rgb: ${other}`);
  }
  assert.equal(rgbHex(181, 83, 60), '#b5533c');
  assert.equal(rgbHex(-4, 300, 127.6), '#00ff80', 'clamped and rounded');

  /* ---- resolveColor: a probe inside the host, read back and removed ---- */
  const host = (computed) => {
    const appended = [];
    const doc = {
      createElement: (tag) => {
        const props = new Map();
        const el = { tag, className: '', removed: false, style: { setProperty: (k, v) => props.set(k, v), getPropertyValue: (k) => props.get(k) ?? '' },
          remove() { this.removed = true; } };
        return el;
      },
      defaultView: computed === undefined ? {} : { getComputedStyle: (el) => ({ color: computed(el.style.getPropertyValue('color'), el.style.getPropertyValue('color-scheme')) }) },
    };
    return { ownerDocument: doc, append: (el) => appended.push(el), appended };
  };
  const seen = [];
  const h = host((color, scheme) => { seen.push([color, scheme]); return 'rgb(1, 2, 3)'; });
  assert.equal(resolveColor(h, 'var(--interactive-accent)'), '#010203');
  assert.deepEqual(seen.at(-1), ['var(--interactive-accent)', ''], 'the probe carries the color, and no scheme unless asked');
  assert.equal(h.appended.length, 1);
  assert.equal(h.appended[0].className, 'nf-canvas-ui', 'the binding’s observer ignores the probe');
  assert.equal(h.appended[0].removed, true, 'and it is taken away again');
  assert.equal(h.appended[0].style.getPropertyValue('visibility'), 'hidden');
  resolveColor(h, 'light-dark(#fff, #000)', 'dark');
  assert.deepEqual(seen.at(-1), ['light-dark(#fff, #000)', 'dark'], 'a scheme forces one side of light-dark()');
  assert.equal(resolveColor(host(() => 'rgba(1, 2, 3, 0.5)'), 'x'), null, 'a see-through color is no answer');
  assert.equal(resolveColor(host(() => ''), 'x'), null);
  assert.equal(resolveColor(host(undefined), 'x'), null, 'no getComputedStyle, no answer, and no exception');
  assert.equal(resolveColor(host(() => { throw new Error('boom'); }), 'x'), null, 'a failing probe is no answer');
  assert.equal(resolveColor({}, 'x'), null);
  // A color left in its own space (oklch) is painted on a 1×1 canvas and read back.
  {
    const h2 = host(() => 'oklch(0.6 0.13 277.467)');
    let fill = '';
    h2.ownerDocument.createElement = ((make) => (tag) => tag !== 'canvas' ? make(tag) : {
      getContext: () => ({
        clearRect() {}, fillRect() {},
        get fillStyle() { return fill; }, set fillStyle(value) { fill = value; },
        getImageData: () => ({ data: fill.startsWith('oklch') ? [110, 119, 204, 255] : [0, 0, 0, 255] }),
      }),
    })(h2.ownerDocument.createElement);
    assert.equal(resolveColor(h2, 'oklch(from var(--interactive-accent) 0.6 0.13 h)'), '#6e77cc');
    const h3 = host(() => 'nonsense(1)');
    h3.ownerDocument.createElement = ((make) => (tag) => tag !== 'canvas' ? make(tag) : {
      getContext: () => ({ clearRect() {}, fillRect() {}, get fillStyle() { return fill; }, set fillStyle(value) { if (!value.startsWith('nonsense')) fill = value; },
        getImageData: () => ({ data: [1, 2, 3, 255] }) }),
    })(h3.ownerDocument.createElement);
    assert.equal(resolveColor(h3, 'x'), null, 'a value the canvas cannot read is no answer');
  }

  console.log('PASS canvas placement: popovers beside their card, side panels pan the map, previews zoom out only as needed; colours read off the page as hex');
} finally {
  await rm(directory, { recursive: true, force: true });
}
