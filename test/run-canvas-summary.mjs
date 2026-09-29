import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Summaries: the pure parts — reading them from the file, placing them in
// the tidy layout, hiding them with folded branches, and drawing braces.
const directory = await mkdtemp(join(tmpdir(), 'notion-flow-canvas-summary-'));
try {
  const entry = join(directory, 'entry.ts');
  const source = (file) => JSON.stringify(fileURLToPath(new URL(`../src/canvas/${file}`, import.meta.url)));
  await writeFile(entry, [
    `export * from ${source('graph.ts')};`,
    `export { mapSteps } from ${source('presentation.ts')};`,
  ].join('\n'));
  const outfile = join(directory, 'summary.mjs');
  await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
    alias: { obsidian: fileURLToPath(new URL('./obsidian-stub.mjs', import.meta.url)) },
  });
  const {
    SUMMARY_KEY, MAP_GAPS, buildForest, planMapLayout, summaryLink, isSummary, summaryIndex, mapSummaries, summarySide,
    hiddenSummaries, hiddenNodes, summaryBraces, bracePath, boundaryBoxes, mapSteps,
  } = await import(pathToFileURL(outfile).href);

  const node = (id, x = 0, y = 0, width = 200, height = 60, extra = {}) => ({ id, type: 'text', x, y, width, height, text: id, ...extra });
  const edge = (fromNode, toNode, extra = {}) => ({ id: `${fromNode}-${toNode}`, fromNode, toNode, ...extra });
  const summary = (id, parent, from, to, extra = {}) => node(id, 0, 0, 160, 40, { [SUMMARY_KEY]: { parent, from, to }, ...extra });
  const apply = (data, plan) => ({
    ...data,
    nodes: data.nodes.map(item => plan.positions.has(item.id) ? { ...item, ...plan.positions.get(item.id) } : item),
    edges: data.edges.map(item => plan.edgeSides.has(item.id) ? { ...item, ...plan.edgeSides.get(item.id) } : item),
  });
  const tidy = (data, rootId = 'root') => apply(data, planMapLayout(data, buildForest(data), rootId));
  const at = (data, id) => data.nodes.find(item => item.id === id);
  const bottom = (r) => r.y + r.height;
  const right = (r) => r.x + r.width;

  /* ---------- reading ---------- */
  assert.deepEqual(summaryLink(summary('s', 'p', 'a', 'b')), { parent: 'p', from: 'a', to: 'b' });
  assert.equal(summaryLink({ [SUMMARY_KEY]: { parent: 'p', from: 'a' } }), null, 'all three ids are needed');
  assert.equal(summaryLink({ [SUMMARY_KEY]: 'p' }), null);
  assert.equal(isSummary(node('x')), false);
  assert.equal(summarySide('right'), 'right');
  assert.equal(summarySide('left'), 'left');
  assert.equal(summarySide('down'), 'bottom');
  assert.equal(summarySide('up'), 'top');
  assert.equal(summarySide('list'), 'right');
  assert.equal(summarySide('row'), 'bottom');
  assert.equal(summarySide('column'), 'right');

  // A rightward map: root with four branches, the second of which has children.
  const base = () => ({
    nodes: [
      node('root', 0, 0, 200, 60, { nfLayout: 'right' }),
      node('a', 300, -300), node('b', 300, -100), node('b1', 600, -140), node('b2', 600, -60), node('c', 300, 100), node('d', 300, 300),
      summary('s', 'root', 'b', 'c'),
    ],
    edges: [edge('root', 'a'), edge('root', 'b'), edge('b', 'b1'), edge('b', 'b2'), edge('root', 'c'), edge('root', 'd')],
  });
  {
    const data = base();
    const forest = buildForest(data);
    assert.equal(forest.nodes.has('s'), false, 'a summary is not a branch');
    const index = summaryIndex(data, forest);
    assert.deepEqual([...index.keys()], ['root']);
    assert.deepEqual(index.get('root'), [{ id: 's', parent: 'root', from: 'b', to: 'c', flow: 'right' }]);
    assert.deepEqual(mapSummaries(forest, index, 'root').map(item => item.id), ['s']);
    // A reversed run reads in order; a run that lost one end shrinks to the other.
    const reversed = { ...data, nodes: data.nodes.map(item => item.id === 's' ? summary('s', 'root', 'c', 'b') : item) };
    assert.deepEqual(summaryIndex(reversed, buildForest(reversed)).get('root')[0].from, 'b');
    const lost = { ...data, nodes: data.nodes.filter(item => item.id !== 'c') , edges: data.edges.filter(item => item.toNode !== 'c') };
    const lostIndex = summaryIndex(lost, buildForest(lost)).get('root')[0];
    assert.deepEqual([lostIndex.from, lostIndex.to], ['b', 'b']);
    const orphan = { ...data, nodes: data.nodes.filter(item => !['b', 'c'].includes(item.id)), edges: data.edges.filter(item => !['b', 'c'].includes(item.toNode) && item.fromNode !== 'b') };
    assert.equal(summaryIndex(orphan, buildForest(orphan)).size, 0, 'a summary with no surviving sibling is an ordinary card');
    const stranger = { ...data, nodes: [...data.nodes, summary('t', 'nowhere', 'b', 'c')] };
    assert.equal(summaryIndex(stranger, buildForest(stranger)).get('root').length, 1, 'an unknown parent is ignored');
  }

  /* ---------- layout ---------- */
  {
    const data = tidy(base());
    const s = at(data, 's');
    const b = at(data, 'b'), b1 = at(data, 'b1'), b2 = at(data, 'b2'), c = at(data, 'c'), a = at(data, 'a'), d = at(data, 'd');
    const reach = MAP_GAPS.summary.brace + MAP_GAPS.summary.width + MAP_GAPS.summary.main;
    const extent = Math.max(right(b), right(b1), right(b2), right(c));
    assert.equal(s.x, extent + reach, 'the summary sits past the deepest covered branch');
    const runTop = Math.min(b.y, b1.y), runBottom = Math.max(bottom(c), bottom(b2));
    assert.ok(Math.abs((s.y + s.height / 2) - (runTop + runBottom) / 2) <= 1, 'centred on the run it covers');
    assert.ok(bottom(a) < b1.y && d.y > bottom(c), 'the other branches keep their order');
    // Tidying again changes nothing.
    const again = tidy(data);
    for (const item of data.nodes) assert.deepEqual([at(again, item.id).x, at(again, item.id).y], [item.x, item.y], `${item.id} is stable`);

    // A tall summary over one small branch takes room from it, so the next branch moves down.
    const tall = base();
    tall.nodes = tall.nodes.map(item => item.id === 's' ? summary('s', 'root', 'c', 'c', { height: 200 }) : item);
    const plain = tidy(base());
    const spaced = tidy(tall);
    const gap = at(spaced, 'd').y - bottom(at(spaced, 'c'));
    assert.ok(gap > at(plain, 'd').y - bottom(at(plain, 'c')) + 100, 'the branch after the run makes room for the summary');
    const st = at(spaced, 's');
    assert.ok(st.y + MAP_GAPS.summary.margin >= at(spaced, 'c').y - 1 && bottom(st) + MAP_GAPS.summary.margin <= at(spaced, 'd').y + 1, 'the summary overlaps no neighbour');

    // Leftward maps put the summary on the left; org charts below.
    const leftward = tidy({ ...base(), nodes: base().nodes.map(item => item.id === 'root' ? { ...item, nfLayout: 'left' } : item) }, 'root');
    const ls = at(leftward, 's');
    const lExtent = Math.min(...['b', 'b1', 'b2', 'c'].map(id => at(leftward, id).x));
    assert.equal(right(ls), lExtent - reach);
    const downward = tidy({ ...base(), nodes: base().nodes.map(item => item.id === 'root' ? { ...item, nfLayout: 'down' } : item) }, 'root');
    const ds = at(downward, 's');
    const dExtent = Math.max(...['b', 'b1', 'b2', 'c'].map(id => bottom(at(downward, id))));
    assert.equal(ds.y, dExtent + reach, 'an org chart puts the brace below the run');
    const dRun = ['b', 'b1', 'b2', 'c'].map(id => at(downward, id));
    const dMid = (Math.min(...dRun.map(r => r.x)) + Math.max(...dRun.map(right))) / 2;
    assert.ok(Math.abs(ds.x + ds.width / 2 - dMid) <= 1);

    // Folding the parent hides the summary and moves it along with the branch.
    const folded = { ...data, nodes: data.nodes.map(item => item.id === 'b' ? { ...item, nfCollapsed: true } : item) };
    const foldedForest = buildForest(folded);
    const hidden = hiddenNodes(folded, foldedForest);
    assert.equal(hidden.has('s'), false, 'the summary hangs under root, which is open');
    const innerSummary = { ...folded, nodes: [...folded.nodes, summary('t', 'b', 'b1', 'b2')] };
    const innerForest = buildForest(innerSummary);
    const innerHidden = hiddenSummaries(summaryIndex(innerSummary, innerForest), hiddenNodes(innerSummary, innerForest));
    assert.deepEqual([...innerHidden], ['t'], 'a summary of hidden branches is hidden');
    const before = tidy(innerSummary);
    const moved = { ...before, nodes: before.nodes.map(item => item.id === 'root' ? { ...item, x: item.x + 500, y: item.y + 40 } : item) };
    const after = tidy(moved);
    assert.deepEqual([at(after, 't').x - at(before, 't').x, at(after, 't').y - at(before, 't').y],
      [at(after, 'b').x - at(before, 'b').x, at(after, 'b').y - at(before, 'b').y], 'a hidden summary travels with its folded branch');
  }

  /* ---------- braces ---------- */
  {
    const data = tidy(base());
    const braces = summaryBraces(data, buildForest(data));
    const brace = braces.get('s');
    assert.ok(brace);
    const extent = Math.max(...['b', 'b1', 'b2', 'c'].map(id => right(at(data, id))));
    assert.equal(brace.side, 'right');
    assert.equal(brace.start.x, extent + MAP_GAPS.summary.brace);
    assert.equal(brace.end.x, brace.start.x);
    assert.equal(brace.start.y, Math.min(at(data, 'b').y, at(data, 'b1').y));
    assert.equal(brace.end.y, Math.max(bottom(at(data, 'c')), bottom(at(data, 'b2'))));
    assert.equal(brace.tip.x, brace.start.x + MAP_GAPS.summary.width);
    assert.equal(brace.tip.y, (brace.start.y + brace.end.y) / 2);
    assert.deepEqual(brace.target, { x: at(data, 's').x, y: at(data, 's').y + at(data, 's').height / 2 }, 'the brace points at the card');
    const path = bracePath(brace);
    assert.match(path, /^M[\d.-]+ [\d.-]+ Q.* L.* Q.* Q.* L.* Q[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+$/);
    assert.ok(path.includes(`${brace.tip.x} ${brace.tip.y}`), 'the path passes through the tip');
    // Live geometry: cards mid-glide draw the brace where they are.
    const live = summaryBraces(data, buildForest(data), new Set(), (id) => ({ ...at(data, id), x: at(data, id).x + 10 }));
    assert.equal(live.get('s').start.x, brace.start.x + 10);
    // A folded parent hides the brace; a missing card draws none.
    const folded = { ...data, nodes: data.nodes.map(item => item.id === 'root' ? { ...item, nfCollapsed: true } : item) };
    const foldedForest = buildForest(folded);
    assert.equal(summaryBraces(folded, foldedForest, hiddenNodes(folded, foldedForest)).size, 0);
    // A boundary around the parent includes the summary.
    const framed = { ...data, nodes: data.nodes.map(item => item.id === 'root' ? { ...item, nfBoundary: true } : item) };
    const box = boundaryBoxes(framed, buildForest(framed)).get('root');
    assert.ok(box.maxX >= right(at(data, 's')) + MAP_GAPS.boundary, 'the boundary reaches past the summary');
    // A vertical brace path for an org chart.
    const downward = tidy({ ...base(), nodes: base().nodes.map(item => item.id === 'root' ? { ...item, nfLayout: 'down' } : item) });
    const down = summaryBraces(downward, buildForest(downward)).get('s');
    assert.equal(down.side, 'bottom');
    assert.equal(down.start.y, down.end.y);
    assert.ok(down.tip.y > down.start.y);
  }

  /* ---------- presenting ---------- */
  {
    const data = tidy(base());
    const forest = buildForest(data);
    const steps = mapSteps(data, forest, new Set(), 'root');
    assert.ok(steps[0].frame.includes('s'), 'the overview shows the summary');
    const bStep = steps.find(step => step.title === 'b');
    assert.ok(bStep && !bStep.frame.includes('s'), 'a summary under the root is not part of one branch');
    const inner = { ...data, nodes: [...data.nodes, summary('t', 'b', 'b1', 'b2', { x: 900, y: -100 })] };
    const innerSteps = mapSteps(inner, buildForest(inner), new Set(), 'root');
    assert.ok(innerSteps.find(step => step.title === 'b').frame.includes('t'), 'a summary inside a branch is told with it');
  }

  console.log('PASS canvas summaries: links, layout, folding, braces, boundaries, and presentation');
} finally {
  await rm(directory, { recursive: true, force: true });
}
