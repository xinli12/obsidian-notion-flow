import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'notion-flow-canvas-editor-keys-'));
try {
  const outfile = join(directory, 'editor-keys.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/canvas/editor-keys.ts', import.meta.url))],
    bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
  });
  const { markdownOwnsKeys, withoutTrailingBlank, linkAt } = await import(pathToFileURL(outfile).href);
  /** The caret is where `‸` is written. */
  const owns = (marked) => markdownOwnsKeys(marked.replace('‸', ''), marked.indexOf('‸'));

  // Plain words: Enter and Tab belong to the card.
  for (const marked of ['‸', 'Alpha‸', 'Al‸pha', '‸Alpha', 'Title\nsecond line‸', '# Heading‸', '## Heading\n\nA paragraph‸',
    'Price: 5 * 3‸', '-dash without a space‸', '2026 was a year‸', 'a | b‸', 'Done.\n‸']) {
    assert.equal(owns(marked), false, `plain words finish on Enter: ${JSON.stringify(marked)}`);
  }
  // Lists, tasks, quotes, callouts and tables keep their keys on their lines.
  for (const marked of ['- item‸', '- ‸', '* item‸', '+ item‸', '1. item‸', '12) item‸', '  - nested‸', '- [ ] task‸', '- [x] done‸',
    '> quote‸', '> [!note] Callout‸', '>‸', '| a | b |‸', '‸| a |', 'Intro\n- item‸', '- item\n- oth‸er', '2026. A numbered item‸']) {
    assert.equal(owns(marked), true, `Markdown keeps Enter and Tab: ${JSON.stringify(marked)}`);
  }
  // Only the caret's own line counts.
  assert.equal(owns('- item\nAfter the list‸'), false, 'a paragraph after a list finishes');
  assert.equal(owns('Heading‸\n- item'), false, 'a heading above a list finishes');
  // Code and maths are written line by line, from the fence that opens them.
  for (const marked of ['```‸', '```js‸', '~~~‸', '```\ncode‸', '```js\nconst a = 1;\n‸', '~~~~\ncode\n```\nstill code‸', '$$‸', '$$\nx^2‸',
    '   ```python‸', 'Before\n```\nline one\nline two‸']) {
    assert.equal(owns(marked), true, `code keeps Enter: ${JSON.stringify(marked)}`);
  }
  for (const marked of ['```\ncode\n```‸', '```\ncode\n```\nAfter‸', '~~~\ncode\n~~~\n‸', '$$\nx\n$$\nAfter‸', '``` inline ``` text\nAfter‸']) {
    assert.equal(owns(marked), marked.endsWith('```‸'), `a closed block gives Enter back: ${JSON.stringify(marked)}`);
  }
  assert.equal(owns('```\ncode\n~~~\nstill code‸'), true, 'a fence closes only with its own kind');
  assert.equal(owns('````\ncode\n```\nstill code‸'), true, 'and at least as long');
  assert.equal(owns('```\ncode\n``` not a close\nstill code‸'), true, 'with nothing after it');
  // Out-of-range carets are clamped rather than failing.
  assert.equal(markdownOwnsKeys('- item', 99), true);
  assert.equal(markdownOwnsKeys('Alpha', -5), false);
  assert.equal(markdownOwnsKeys('\n- item', 0), false, 'a caret on an empty first line reads that line');

  assert.equal(withoutTrailingBlank('Alpha'), 'Alpha');
  assert.equal(withoutTrailingBlank('Alpha\n'), 'Alpha', 'the line break that ended a paragraph goes');
  assert.equal(withoutTrailingBlank('- one\n- two\n\n  \n'), '- one\n- two', 'so do blank lines after a list');
  assert.equal(withoutTrailingBlank('Alpha  \n'), 'Alpha');
  assert.equal(withoutTrailingBlank('  \n\n'), '', 'a card of blanks is empty');
  assert.equal(withoutTrailingBlank('\n\nAlpha\n\nBeta'), '\n\nAlpha\n\nBeta', 'blank lines inside or before the words stay');

  // Mod+Enter on a link opens it; anywhere else it finishes the card.
  const onLink = (marked) => linkAt(marked.replace('‸', ''), marked.indexOf('‸'));
  for (const marked of ['[[No‸te]]', 'see [[Note]]‸', '![[img.png‸]]', '[la‸bel](https://x.y)', 'go https://exa‸mple.com now',
    '<https://a.b‸>', '‸[[Note]]', '[[Note|sh‸own]]', 'mailto:me@exa‸mple.com', 'first line\n[[No‸te]]']) {
    assert.equal(onLink(marked), true, `on a link: ${JSON.stringify(marked)}`);
  }
  for (const marked of ['Plain words‸', '[[Note]] and more‸', '‸', 'see [[Note]]\nnext line‸', 'next ‸line\n[[Note]]',
    '[[Note]]\n‸', 'https is a protocol‸', '[not a link]‸']) {
    assert.equal(onLink(marked), false, `not on a link: ${JSON.stringify(marked)}`);
  }
  assert.equal(linkAt('[[Note]]', 99), true, 'a caret past the end is clamped');

  console.log('PASS canvas editor keys: plain words, lists, tasks, quotes, tables, code and maths blocks, trailing blank lines, and links under the caret');
} finally {
  await rm(directory, { recursive: true, force: true });
}
