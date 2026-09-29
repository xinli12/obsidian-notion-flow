import assert from 'node:assert/strict';
import { Text } from '@codemirror/state';
import { listNestingDepth, getBlockRange, cachedFences } from './bundle.mjs';
const originalDepth = (doc, lineNo, fences) => {
  let depth = 0;
  for (let n = lineNo - 1; n >= 1; n--) {
    if (!/^(\s*)(?:[-*+]|\d+[.)])([ \t]+)/.test(doc.line(n).text)) continue;
    const range = getBlockRange(doc, n, fences);
    if (range?.startLine === n && range.endLine >= lineNo) depth++;
  }
  return depth;
};
const fixtures = [
  ['- parent', '  - child', '    text', '  > quote', '', '- next', '> attached', 'lazy', '', '> detached'],
  ['- parent', '', '  ```md', '  - literal', '  ```', '', '  continuation', 'outside'],
  ['- ```js', '- literal', '```', 'tail'],
  ['1. parent', '   1. child', '      > [!note] title', '      > body', '', '2. next'],
  ['- parent', '  > attached', '  lazy', '  | a |', '  | --- |', '', '> outside'],
  // Segment boundaries (typing-perf): a top-level paragraph after a blank row ends every list above it.
  ['- a', '  - b', '', 'para', '', '- c', '  - d', '', 'para two', '- e'],
  ['- a', 'lazy continuation', '  - b', '', 'para', '- c'],
  ['- a', '', '```', '- not a list', '```', '', '- b', '  - c'],
  ['- a', '  - b', '    > [!note] T', '    > body', '', 'para', '', '1. x', '   1. y'],
  ['- a', '\t- b', '\t\t- c', '', 'para', '\t- d', '- e', '\t- f'],
  ['para', '- a', '  - b', 'para', '', '- c'],
  ['- a', '', '  indented para', '', 'para', '  - b'],
];
for (const lines of fixtures) {
  const doc = Text.of(lines);
  for (const fences of [cachedFences(doc), []]) {
    for (let n = 1; n <= doc.lines; n++) assert.equal(listNestingDepth(doc, n, fences), originalDepth(doc, n, fences), `line ${n}: ${lines}`);
  }
}

// Seeded fuzz: random documents from line templates, every line, both fence lists.
{
  let seed = 20260929;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const templates = ['- a', '  - b', '\t- c', 'para', '', '> q', '> [!note]', '```', '1. x', '- [ ] t', '    - deep', '  para', '> - ql'];
  for (let d = 0; d < 300; d++) {
    const count = 3 + Math.floor(rand() * 30);
    const lines = Array.from({ length: count }, () => templates[Math.floor(rand() * templates.length)]);
    const doc = Text.of(lines);
    for (const fences of [cachedFences(doc), []]) {
      // Query in a shuffled order, so segments are built in every order.
      const order = Array.from({ length: doc.lines }, (_, i) => i + 1).sort(() => rand() - 0.5);
      for (const n of order) assert.equal(listNestingDepth(doc, n, fences), originalDepth(doc, n, fences), `fuzz ${d} line ${n}: ${JSON.stringify(lines)}`);
    }
  }
}

// Locality: after an edit in the last of five list segments, a query there reads only that segment.
{
  const seg = (k) => [...Array.from({ length: 1996 }, (_, i) => (i % 3 === 1 ? `  - child ${k}.${i}` : `- item ${k}.${i}`)), '', `para ${k}`, ''];
  const lines = [...seg(1), ...seg(2), ...seg(3), ...seg(4), ...seg(5).slice(0, -1)];
  const doc0 = Text.of(lines);
  const startOf5 = 4 * 1999 + 1;
  const edited = doc0.replace(doc0.line(startOf5 + 10).to, doc0.line(startOf5 + 10).to, Text.of(['x']));
  const fences = cachedFences(edited);
  const read = edited.line;
  let reads = 0, min = Infinity, max = 0;
  edited.line = function(n) { reads++; min = Math.min(min, n); max = Math.max(max, n); return read.call(this, n); };
  const q = startOf5 + 500;
  assert.equal(listNestingDepth(edited, q, fences), originalDepth(doc0, q, cachedFences(doc0)));
  edited.line = read;
  // Segment 5 starts at the "para 4" row (a boundary) and runs to the end.
  assert.ok(min >= startOf5 - 3 && max <= edited.lines, `reads stay in segment 5: ${min}..${max}`);
  // The same note with no boundary (every "para" row a list item) is one
  // segment: a query there walks the whole note, as every keystroke used to.
  const whole = Text.of(lines.map((l) => (l.startsWith('para') ? '- item' : l.trim() === '' ? '- gap' : l)));
  const wholeRead = whole.line;
  let wholeReads = 0;
  whole.line = function(n) { wholeReads++; return wholeRead.call(this, n); };
  listNestingDepth(whole, q, cachedFences(whole));
  whole.line = wholeRead;
  assert.ok(reads * 4 < wholeReads, `segment reads ${reads} vs whole-note ${wholeReads}`);
  let again = 0;
  edited.line = function(n) { again++; return read.call(this, n); };
  listNestingDepth(edited, q + 1, fences);
  edited.line = read;
  assert.equal(again, 0, 'a second query in the indexed segment reads no line');
  console.log(`PASS list depth locality: segment of ${edited.lines - startOf5 + 3} of ${edited.lines} lines, ${reads} reads in ${min}..${max} (whole note: ${wholeReads})`);
}

const large = Text.of([...Array.from({ length: 10000 }, (_, i) => `- item ${i}`), ...Array(60).fill('> quote')]);
const fences = cachedFences(large);
const measure = () => {
  const started = performance.now();
  for (let n = 10001; n <= large.lines; n++) assert.equal(listNestingDepth(large, n, fences), 1);
  return performance.now() - started;
};
const cold = measure();
const warm = measure();
// Instrument document reads rather than asserting machine-dependent timing.
const line = large.line;
let reads = 0;
large.line = function(n) { reads++; return line.call(this, n); };
measure();
assert.equal(reads, 0, 'cached viewport lookups must not rescan the document');
large.line = line;
const changed = large.replace(0, large.line(1).to, Text.of(['plain']));
assert.equal(listNestingDepth(changed, 2), 0, 'new document gets its own index');
console.log(`PASS list depth parity and caching; 10,060 lines / 60 viewport rows: cold ${cold.toFixed(1)} ms, warm ${warm.toFixed(2)} ms`);
