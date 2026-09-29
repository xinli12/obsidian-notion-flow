import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'notion-flow-canvas-typography-'));
try {
  const outfile = join(directory, 'typography.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/canvas/typography.ts', import.meta.url))],
    bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
  });
  const { topicTypography, applyTopicTypography, clearTopicTypography } = await import(pathToFileURL(outfile).href);

  const topics = Array.from({ length: 5 }, (_, depth) => topicTypography(depth));
  assert.deepEqual(topics.map(({ scale }) => scale * 16), [24, 20, 17, 16, 15], 'titles distinguish each of the first five levels');
  assert.deepEqual(topics.map(({ weight }) => weight), [700, 600, 500, 400, 400], 'roots and main branches carry progressively less emphasis');
  assert.ok(topics.every(({ leading }) => leading === 1.5), 'wrapped titles retain readable line spacing');

  const notes = Array.from({ length: 5 }, (_, depth) => topicTypography(depth, true));
  assert.deepEqual(notes.map(({ scale }) => scale * 16), [20, 18, 17, 16, 15], 'rich notes retain a gentler size hierarchy');
  assert.deepEqual(notes.map(({ weight }) => weight), [500, 400, 400, 400, 400], 'rich note body text is not made uniformly bold');
  assert.ok(notes.every(({ leading }) => leading === 1.6));

  for (const rich of [false, true]) {
    for (const deep of [5, 10, 1000, Number.MAX_SAFE_INTEGER]) {
      assert.deepEqual(topicTypography(deep, rich), topicTypography(4, rich), 'deep nesting never keeps shrinking the type');
    }
    for (const invalid of [undefined, null, -1, 0.5, NaN, Infinity, -Infinity, '0']) {
      assert.deepEqual(topicTypography(invalid, rich), topicTypography(3, rich), 'invalid depths use ordinary body typography');
    }
  }
  const first = topicTypography(0);
  first.scale = 99;
  assert.equal(topicTypography(0).scale, 1.5, 'callers cannot mutate the hierarchy policy');

  const properties = new Map([['--unrelated', 'keep'], ['font-size', '18px']]);
  let writes = 0;
  const element = { style: {
    getPropertyValue: property => properties.get(property) ?? '',
    setProperty: (property, value) => { properties.set(property, value); writes++; },
    removeProperty: property => { const previous = properties.get(property) ?? ''; properties.delete(property); writes++; return previous; },
  } };
  assert.equal(applyTopicTypography(element, 0), true);
  assert.equal(properties.get('--nf-size'), '1.5');
  assert.equal(properties.get('--nf-weight'), '700');
  assert.equal(properties.get('--nf-leading'), '1.5');
  assert.equal(writes, 3);
  assert.equal(applyTopicTypography(element, 0), false, 'unchanged refresh does not mutate the DOM');
  assert.equal(writes, 3);

  assert.equal(applyTopicTypography(element, 4), true, 'moving a branch updates its typography');
  assert.equal(properties.get('--nf-size'), '0.9375');
  assert.equal(properties.get('--nf-weight'), '400');
  assert.equal(writes, 5, 'only changed variables are written');
  assert.equal(applyTopicTypography(element, 4, true), true, 'changing to a rich note updates line spacing');
  assert.equal(properties.get('--nf-leading'), '1.6');
  assert.equal(clearTopicTypography(element), true);
  assert.deepEqual([...properties], [['--unrelated', 'keep'], ['font-size', '18px']], 'cleanup only removes the map typography variables');
  const afterClear = writes;
  assert.equal(clearTopicTypography(element), false);
  assert.equal(writes, afterClear, 'repeated cleanup is idempotent');

  console.log('PASS canvas typography: five hierarchy levels, bounded deep branches, rich notes, safe fallback, and reversible display-only styles');
} finally {
  await rm(directory, { recursive: true, force: true });
}
