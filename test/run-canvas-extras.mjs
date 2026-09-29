import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'notion-flow-canvas-extras-'));
try {
  const outfile = join(directory, 'extras.mjs');
  await build({
    stdin: {
      contents: `export * from './src/canvas/search.ts'; export * from './src/canvas/minimap.ts'; export * from './src/canvas/motion.ts';`,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts',
    },
    alias: { obsidian: fileURLToPath(new URL('./obsidian-stub.mjs', import.meta.url)) },
    bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
  });
  const {
    plainText, cardLabel, cardTitle, minimapFrame, toMinimap, fromMinimap, fitsViewport, minimapSupported,
    Motion, ease, MOTION_LIMIT, CardSearchModal,
  } = await import(pathToFileURL(outfile).href);

  /* ---------- card words ---------- */
  assert.equal(plainText('# **Big** idea'), 'Big idea');
  assert.equal(plainText('- [ ] task with [[Notes/Page|alias]] and [[Other#Part]]'), 'task with alias and Other › Part');
  assert.equal(plainText('See [the site](https://x.y) and ![[pic.png]]'), 'See the site and pic.png');
  assert.equal(plainText('> quoted `code` ==mark== ~~gone~~ <b>html</b>'), 'quoted code mark gone html');
  assert.equal(plainText('1. first\n2) second\n\n\ttabbed'), 'first second tabbed');
  assert.equal(plainText('snake_case_name and _soft_ and __strong__'), 'snake_case_name and soft and strong', 'underscores emphasise only at word edges');
  assert.equal(cardLabel({ id: 't', type: 'text', text: '## Plan\nnext' }), 'Plan next');
  assert.equal(cardLabel({ id: 'f', type: 'file', file: 'Folder/Deep Note.md', subpath: '#Section' }), 'Deep Note › Section');
  assert.equal(cardLabel({ id: 'f', type: 'file', file: 'img/photo.png' }), 'photo.png');
  assert.equal(cardLabel({ id: 'l', type: 'link', url: 'https://example.com' }), 'https://example.com');
  assert.equal(cardLabel({ id: 'g', type: 'group', label: ' Box ' }), 'Box');
  assert.equal(cardLabel({ id: 'g', type: 'group' }), '');
  assert.equal(cardLabel({ id: 'u', type: 'mystery' }), '');
  assert.equal(cardTitle({ id: 't', type: 'text', text: '\n[[Note|Reading plan]]\n\nTwenty books.' }), 'Reading plan', 'a title is the first line');
  assert.equal(cardTitle({ id: 't', type: 'text', text: 'x'.repeat(60) }), `${'x'.repeat(48)}…`);
  assert.equal(cardTitle({ id: 'f', type: 'file', file: 'a/Deep.md' }), 'Deep');

  // The search modal lists what it was given and hands back the choice.
  let chosen = null;
  const hits = [{ id: 'a', label: 'Alpha', context: '', hidden: false }];
  const modal = new CardSearchModal({}, hits, hit => { chosen = hit.id; }, 'Find…');
  assert.deepEqual(modal.getItems(), hits);
  assert.equal(modal.getItemText(hits[0]), 'Alpha');
  assert.equal(modal.placeholder, 'Find…');
  modal.onChooseItem(hits[0]);
  assert.equal(chosen, 'a');

  /* ---------- minimap geometry ---------- */
  const viewport = { minX: 0, minY: 0, maxX: 1000, maxY: 500 };
  const content = { minX: -1000, minY: 0, maxX: 1000, maxY: 1000 };
  const frame = minimapFrame(content, viewport, 200, 132, 8);
  assert.deepEqual(frame.bounds, { minX: -1000, minY: 0, maxX: 1000, maxY: 1000 }, 'bounds cover content and viewport');
  assert.equal(frame.scale, Math.min(184 / 2000, 116 / 1000));
  const corner = toMinimap(frame, -1000, 0);
  assert.ok(corner.x >= 8 - 1e-9 && corner.y >= 8 - 1e-9, 'content fits inside the padding');
  const far = toMinimap(frame, 1000, 1000);
  assert.ok(far.x <= 192 + 1e-9 && far.y <= 124 + 1e-9);
  assert.ok(Math.abs((corner.x + far.x) / 2 - 100) < 1e-9 && Math.abs((corner.y + far.y) / 2 - 66) < 1e-9, 'centred');
  const back = fromMinimap(frame, 57, 33);
  const there = toMinimap(frame, back.x, back.y);
  assert.ok(Math.abs(there.x - 57) < 1e-9 && Math.abs(there.y - 33) < 1e-9, 'minimap and canvas points round-trip');
  const away = minimapFrame(content, { minX: 5000, minY: 5000, maxX: 6000, maxY: 5500 }, 200, 132);
  assert.equal(away.bounds.maxX, 6000, 'a far viewport stays in frame');
  assert.deepEqual(minimapFrame(null, viewport, 200, 132).bounds, viewport, 'an empty canvas frames the viewport');
  assert.equal(fitsViewport(null, viewport), true);
  assert.equal(fitsViewport({ minX: 10, minY: 10, maxX: 900, maxY: 400 }, viewport), true);
  assert.equal(fitsViewport(content, viewport), false);
  assert.equal(minimapSupported(null), false);
  assert.equal(minimapSupported({ canvasEl: { setAttribute() {} }, getViewportBBox() {}, markViewportChanged() {}, x: 0, y: 0 }), true);
  assert.equal(minimapSupported({ canvasEl: { setAttribute() {} }, getViewportBBox() {}, x: 0, y: 0 }), false);

  /* ---------- motion ---------- */
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  assert.ok(ease(0.5) > 0.5, 'eases out');
  assert.equal(ease(2), 1);
  let clock = 0;
  const frames = new Map();
  let nextFrame = 0;
  const win = {
    performance: { now: () => clock },
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  const tick = ms => { clock += ms; const due = [...frames.values()]; frames.clear(); for (const callback of due) callback(); };
  const card = (x, y) => {
    const node = { data: { x, y }, moves: 0, getData() { return { ...this.data }; }, moveTo(pos) { this.moves++; this.data = { ...pos }; } };
    return node;
  };
  const alive = new Set();
  const motion = new Motion(win, node => alive.has(node), 200);
  const a = card(100, 0);
  const b = card(0, 50);
  alive.add(a); alive.add(b);
  let landed = 0;
  assert.equal(motion.play([[a, { x: 0, y: 0 }], [b, { x: 0, y: 50 }]], () => landed++), true);
  assert.deepEqual(a.getData(), { x: 0, y: 0 }, 'a card starts where it was');
  assert.equal(b.moves, 0, 'a card that did not move is left alone');
  assert.equal(motion.active, true);
  tick(100);
  const midway = a.getData().x;
  assert.ok(midway > 50 && midway < 100, 'eases along the way');
  tick(150);
  assert.deepEqual(a.getData(), { x: 100, y: 0 }, 'and lands exactly');
  assert.equal(motion.active, false);
  assert.equal(landed, 1);
  assert.equal(frames.size, 0, 'no frame left behind');

  a.data = { x: 300, y: 0 };
  motion.play([[a, { x: 100, y: 0 }]], () => landed++);
  tick(50);
  motion.finish();
  assert.deepEqual(a.getData(), { x: 300, y: 0 }, 'finishing lands at once');
  assert.equal(landed, 2);
  assert.equal(frames.size, 0);
  motion.finish();
  assert.equal(landed, 2, 'finishing twice lands once');

  a.data = { x: 500, y: 0 };
  motion.play([[a, { x: 300, y: 0 }]]);
  alive.delete(a);
  const before = a.moves;
  tick(50);
  assert.equal(a.moves, before, 'a deleted card is never moved');
  motion.finish();

  assert.equal(motion.play([[a, { x: 0, y: 0 }]]), false, 'only live cards animate');
  const many = Array.from({ length: MOTION_LIMIT + 1 }, (_, i) => { const node = card(i, 0); alive.add(node); return [node, { x: i + 10, y: 0 }]; });
  assert.equal(motion.play(many), false, 'very large moves jump instead');
  assert.equal(many[0][0].getData().x, 0, 'and stay where the layout put them');

  const replay = card(200, 0); alive.add(replay);
  motion.play([[replay, { x: 0, y: 0 }]]);
  replay.data = { x: 260, y: 0 }; // a new layout moved it while it glided
  const second = card(10, 10); alive.add(second);
  motion.play([[second, { x: 0, y: 0 }]]);
  assert.equal(replay.getData().x, 200, 'a new animation first lands the old one');

  console.log('PASS canvas extras: card words, search modal, minimap geometry, and eased, interruptible card motion');
} finally {
  await rm(directory, { recursive: true, force: true });
}
