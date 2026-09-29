import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'notion-flow-canvas-outline-'));
try {
  const outfile = join(directory, 'outline.mjs');
  await build({
    stdin: {
      contents: `export * from './src/canvas/outline.ts'; export { buildForest } from './src/canvas/graph.ts';`,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts',
    },
    bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
  });
  const { parseOutline, branchOutline, countOutline, cardText, buildForest, noteOutline, topicText, noteFileName } = await import(pathToFileURL(outfile).href);
  const shape = items => items.map(item => item.children.length ? [item.text, shape(item.children)] : item.text);

  assert.equal(parseOutline('Just a paragraph.\nAnother line.'), null);
  assert.equal(parseOutline(''), null);

  const nested = parseOutline([
    'Plan',
    '',
    '- Research',
    '\t- Sources',
    '\t\t1. Papers',
    '\t\t2) Interviews',
    '    - Budget',
    '- [ ] Draft',
    '  keeps going here',
    '  ```js',
    '  - not an item',
    '  ```',
    '* Review',
    '',
    'Closing note.',
  ].join('\n'));
  assert.equal(nested.lead, 'Plan');
  assert.equal(nested.trail, 'Closing note.');
  assert.deepEqual(shape(nested.items), [
    ['Research', [['Sources', ['Papers', 'Interviews']], 'Budget']],
    '- [ ] Draft\nkeeps going here\n```js\n- not an item\n```',
    'Review',
  ]);
  assert.equal(countOutline(nested.items), 7);

  const headings = parseOutline('# Topic\n## One\n- a\n  - b\n## Two\ntext under two\n# Other\n- c');
  assert.deepEqual(shape(headings.items), [
    ['# Topic', [['## One', [['a', ['b']]]], '## Two\ntext under two']],
    ['# Other', ['c']],
  ]);

  const crlf = parseOutline('- a\r\n  - b\r\n- c');
  assert.deepEqual(shape(crlf.items), [['a', ['b']], 'c']);

  const node = (id, x, y, extra = {}) => ({ id, type: 'text', x, y, width: 200, height: 60, ...extra });
  const edge = (fromNode, toNode, extra = {}) => ({ id: `${fromNode}-${toNode}`, fromNode, toNode, ...extra });
  const map = {
    nodes: [
      node('root', 0, 0, { text: '# Central', nfLayout: 'balanced' }),
      node('r1', 300, -100, { text: 'First\nsecond line' }), node('r2', 300, 100, { text: '- [x] Done' }),
      node('l1', -300, 100, { text: 'Left low' }), node('l2', -300, -100, { type: 'file', file: 'Notes/Idea.md', subpath: '#Part' }),
      node('deep', 600, -100, { type: 'link', url: 'https://example.com' }),
    ],
    edges: [edge('root', 'r2'), edge('root', 'r1'), edge('root', 'l1'), edge('root', 'l2'), edge('r1', 'deep'), edge('l1', 'root', { label: 'back' })],
  };
  const outline = branchOutline(map, buildForest(map), 'root');
  assert.equal(outline.count, 6);
  assert.equal(outline.markdown, [
    '- Central',
    '\t- First',
    '\t  second line',
    '\t\t- https://example.com',
    '\t- [x] Done',
    '\t- Left low',
    '\t- [[Notes/Idea#Part]]',
  ].join('\n'), 'clockwise reading order, headings flattened, tasks kept, files linked');
  const reparsed = parseOutline(outline.markdown);
  assert.deepEqual(shape(reparsed.items), [['Central', [['First\nsecond line', ['https://example.com']], '- [x] Done', 'Left low', '[[Notes/Idea#Part]]']]], 'outlines round-trip');

  const free = {
    nodes: [node('a', 0, 0, { text: 'A' }), node('b', 300, 200, { text: 'B' }), node('c', 300, -200, { text: 'C' }), node('g', 0, 0, { type: 'group', label: 'G' })],
    edges: [edge('a', 'b'), edge('a', 'c'), edge('b', 'a'), edge('c', 'b'), edge('a', 'g'), edge('a', 'c', { id: 'labelled', label: 'x' })],
  };
  assert.equal(branchOutline(free, buildForest(free), 'a').markdown, '- A\n\t- C\n\t- B', 'free branches follow connections once, top to bottom');
  assert.equal(branchOutline(free, buildForest(free), 'missing').count, 0);
  assert.equal(cardText({ id: 'g', type: 'group', label: 'Box' }), 'Box');
  assert.equal(cardText({ id: 'u', type: 'unknown' }), '');

  /* ---------- notes as maps ---------- */
  assert.equal(topicText('## Heading'), 'Heading');
  assert.equal(topicText('#tag is not a heading'), '#tag is not a heading');
  assert.equal(topicText('Plain\n## second line stays'), 'Plain\n## second line stays');

  const titled = noteOutline('---\ntags: [a]\n---\n# Project\nWhy it matters.\n\n## Goals\n- Ship\n- Learn\n## Risks\n', 'Work/Project');
  assert.equal(titled.root, '[[Work/Project|Project]]\n\nWhy it matters.', 'one top heading names the linked root; frontmatter is skipped');
  assert.deepEqual(shape(titled.items), [['## Goals', ['Ship', 'Learn']], '## Risks']);
  const loose = noteOutline('Intro line.\n\n- A\n\t- A1\n- B\n\nClosing words.', 'Loose');
  assert.equal(loose.root, '[[Loose]]');
  assert.deepEqual(shape(loose.items), ['Intro line.', ['A', ['A1']], 'B', 'Closing words.'], 'lead and trail become first and last branches');
  assert.equal(noteOutline('Only prose here.', 'Prose'), null);
  assert.equal(noteOutline('# A | [weird] title\n- x', 'N').root, '[[N|A weird title]]', 'link-breaking characters leave the alias');
  assert.equal(noteOutline('﻿---\na: 1\n---\n- one\n- two', 'Bom').root, '[[Bom]]');

  assert.equal(noteFileName('What: a/b? "plan" #1 [draft]', 'Mind map'), 'What a b plan 1 draft');
  assert.equal(noteFileName('   ', 'Mind map'), 'Mind map');
  assert.equal(noteFileName('...hidden', 'Mind map'), 'hidden');
  assert.equal(noteFileName('x'.repeat(200), 'Mind map').length, 80);

  console.log('PASS canvas outline: lists, headings, tasks, continuations, code fences, reading order, round trips, and notes as maps');
} finally {
  await rm(directory, { recursive: true, force: true });
}
