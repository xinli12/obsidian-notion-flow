import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'notion-flow-canvas-sizing-'));
try {
  const outfile = join(directory, 'sizing.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/canvas/sizing.ts', import.meta.url))],
    bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
  });
  const { fittedCardSize, editorSurfaceSize, blankTopicSize } = await import(pathToFileURL(outfile).href);
  const previous = { width: 260, height: 120 };
  const fit = (options = {}) => fittedCardSize({
    before: previous, measured: { width: 60, height: 18 }, fitWidth: true,
    mode: 'comfortable', ...options,
  });

  assert.deepEqual(fit(), { width: 112, height: 52 }, 'short topics have a comfortable box');
  assert.deepEqual(fit({ depth: 0 }), { width: 160, height: 64 }, 'roots have more visual weight');
  assert.deepEqual(fit({ mode: 'compact' }), { width: 80, height: 36 });
  assert.deepEqual(fit({ mode: 'compact', depth: 0 }), { width: 112, height: 48 });
  assert.deepEqual(fit({ depth: -1 }), fit(), 'only an actual root gets root sizing');
  assert.deepEqual(fit({ measured: { width: 217.4, height: 99.1 } }), { width: 218, height: 100 }, 'fractional content never clips');
  assert.deepEqual(fit({ measured: { width: 900, height: 900 } }), { width: 480, height: 640 }, 'long content is bounded');
  assert.deepEqual(fit({ fitWidth: false }), { width: 260, height: 52 }, 'editing respects a user-set width');
  assert.deepEqual(fit({ mode: 'preserve' }), { width: 260, height: 52 }, 'preserve mode also respects width during explicit fits');
  assert.deepEqual(fit({ before: { width: 900, height: 100 }, fitWidth: false }), { width: 900, height: 52 }, 'manual width is not restricted by automatic-fit bounds');
  assert.deepEqual(fit({ before: { width: 72.5, height: 100 }, mode: 'preserve' }), { width: 72.5, height: 52 }, 'preserving means no rounding or minimum width changes');
  // Topics drawn without a box hug their words; the height minimum stays for clicking.
  assert.deepEqual(fit({ boxless: true, measured: { width: 58.2, height: 40 } }), { width: 59, height: 52 }, 'a boxless topic hugs its words');
  assert.deepEqual(fit({ boxless: true, mode: 'compact', measured: { width: 30, height: 20 } }), { width: 40, height: 36 }, 'down to a narrow minimum');
  assert.deepEqual(fit({ boxless: true, empty: true }), { width: 112, height: 52 }, 'an empty one keeps a readable placeholder');
  assert.deepEqual(fit({ boxless: true, depth: 0, measured: { width: 50, height: 40 } }), { width: 160, height: 64 }, 'a root is never boxless');
  assert.deepEqual(fit({ boxless: true, mode: 'preserve' }), { width: 260, height: 52 }, 'preserve mode keeps widths');
  assert.deepEqual(fit({ boxless: true, fitWidth: false }), { width: 260, height: 52 }, 'and editing keeps a set width');
  for (const mode of ['comfortable', 'compact', 'preserve']) {
    for (const depth of [0, 1, 4]) {
      assert.deepEqual(fit({ mode, depth, fitWidth: false, measured: { width: 999, height: 999 } }),
        { width: 260, height: 640 }, 'long text fits height without overriding a manual width at any depth');
      assert.deepEqual(fit({ mode, depth, measured: { width: 999, height: 999 } }),
        { width: mode === 'preserve' ? 260 : 480, height: 640 }, 'all size modes bound long content');
    }
  }
  assert.deepEqual(fit({ mode: 'preserve', depth: 0 }), { width: 260, height: 64 });
  assert.deepEqual(fit({ mode: 'compact', fitWidth: false, depth: 0 }), { width: 260, height: 48 });
  assert.deepEqual(fit({ mode: 'comfortable', fitWidth: false, depth: 0 }), { width: 260, height: 64 });

  for (const bad of [0, -1, NaN, Infinity, -Infinity]) {
    assert.deepEqual(fit({ measured: { width: bad, height: bad } }), previous, 'invalid measurement keeps the previous box');
    assert.deepEqual(fit({ measured: { width: bad, height: 70 } }), { width: 260, height: 70 }, 'only an invalid dimension falls back');
    assert.deepEqual(fit({ measured: { width: 170, height: bad } }), { width: 170, height: 120 });
    assert.deepEqual(fit({ before: { width: bad, height: bad }, measured: { width: bad, height: bad } }), { width: 112, height: 52 }, 'invalid prior data gets safe defaults');
    assert.deepEqual(fit({ before: { width: bad, height: 80 }, fitWidth: false }), { width: 112, height: 52 });
    assert.deepEqual(fit({ empty: true, measured: { width: bad, height: bad } }), { width: 112, height: 52 }, 'empty cards use the minimum regardless of their measurement');
  }
  assert.deepEqual(fit({ empty: true, measured: { width: 900, height: 900 }, depth: 0 }), { width: 160, height: 64 });
  assert.deepEqual(fit({ empty: true, fitWidth: false }), { width: 260, height: 52 });
  assert.deepEqual(fit({ empty: true, mode: 'compact', depth: 0 }), { width: 112, height: 48 });
  assert.deepEqual(fit({ empty: true, mode: 'preserve', depth: 0 }), { width: 260, height: 64 });
  assert.deepEqual(previous, { width: 260, height: 120 }, 'inputs are never mutated');

  // Free cards only gain height, never width, and never lose room they have.
  const grow = (options = {}) => fit({ grow: true, fitWidth: false, ...options });
  assert.deepEqual(grow({ measured: { width: 60, height: 180.2 } }), { width: 260, height: 181 }, 'overflowing words make a free card taller');
  assert.deepEqual(grow({ measured: { width: 900, height: 80 } }), { width: 260, height: 120 }, 'a free card never shrinks or changes width');
  assert.deepEqual(grow({ measured: { width: 60, height: 5000 } }), { width: 260, height: 640 }, 'growth stops at the card height limit');
  assert.deepEqual(grow({ before: { width: 300, height: 900 }, measured: { width: 60, height: 5000 } }), { width: 300, height: 900 }, 'a card taller than the limit keeps its own height');
  assert.deepEqual(grow({ empty: true, measured: { width: 60, height: 400 } }), { width: 260, height: 120 }, 'an emptied card keeps its size');
  for (const bad of [0, -1, NaN, Infinity]) assert.deepEqual(grow({ measured: { width: 60, height: bad } }), previous);

  // The editing box starts as the card and grows only for words that need room.
  const small = { width: 112, height: 52 };
  assert.deepEqual(editorSurfaceSize(small, { width: 0, height: 0 }), small, 'an editor opens at exactly its card: no minimum panel, no zoom scale');
  assert.deepEqual(editorSurfaceSize(small, { width: 90, height: 40 }), small, 'words that fit never shrink the card either');
  assert.deepEqual(editorSurfaceSize(small, { width: 300, height: 99.2 }), { width: 112, height: 100 }, 'taller words grow the height; without a width limit the width stays');
  assert.deepEqual(editorSurfaceSize(small, { width: 300.4, height: 40 }, 360), { width: 301, height: 52 }, 'a one-line topic widens with its line');
  assert.deepEqual(editorSurfaceSize(small, { width: 700, height: 40 }, 360), { width: 360, height: 52 }, 'up to its width limit');
  assert.deepEqual(editorSurfaceSize(small, { width: 700, height: 40 }, 2000), { width: 480, height: 52 }, 'which never passes the card width limit');
  assert.deepEqual(editorSurfaceSize(small, { width: 5000, height: 5000 }, 2000), { width: 480, height: 640 }, 'long drafts are bounded like fitted cards');
  assert.deepEqual(editorSurfaceSize({ width: 900, height: 900 }, { width: 5000, height: 5000 }, 2000), { width: 900, height: 900 }, 'a card already larger than the limits keeps its own size');
  assert.deepEqual(editorSurfaceSize({ width: NaN, height: -100 }, { width: 0, height: 0 }), { width: 112, height: 52 }, 'invalid card sizes use safe defaults');
  for (const bad of [0, -1, NaN, Infinity, -Infinity]) {
    assert.deepEqual(editorSurfaceSize(small, { width: bad, height: bad }, 360), small, 'invalid measurements leave the card as it is');
    assert.deepEqual(editorSurfaceSize(small, { width: 300, height: 40 }, bad), small, 'an invalid width limit never widens');
  }
  // A new blank topic opens at what an empty topic fits to at its depth.
  assert.deepEqual(blankTopicSize('comfortable', 0), { width: 160, height: 64 }, 'a blank centre');
  assert.deepEqual(blankTopicSize('comfortable', 1), { width: 112, height: 52 }, 'a blank main topic');
  assert.deepEqual(blankTopicSize('comfortable', 3), { width: 112, height: 52 }, 'deeper topics alike');
  assert.deepEqual(blankTopicSize('compact', 0), { width: 112, height: 48 });
  assert.deepEqual(blankTopicSize('compact', 2), { width: 80, height: 36 });
  assert.deepEqual(blankTopicSize('preserve', 1), blankTopicSize('comfortable', 1), 'preserved sizes start as comfortable ones');
  for (const depth of [0, 1, 2]) {
    for (const mode of ['comfortable', 'compact']) {
      assert.deepEqual(blankTopicSize(mode, depth), fittedCardSize({ before: { width: 240, height: 60 }, measured: { width: 0, height: 0 },
        fitWidth: true, mode, empty: true, depth }), 'exactly the size an empty topic is fitted to');
    }
  }
  console.log('PASS canvas sizing: comfortable and compact cards, preserved widths, growing free cards, invalid measurements, in-place editor surfaces, and blank topics');
} finally {
  await rm(directory, { recursive: true, force: true });
}
