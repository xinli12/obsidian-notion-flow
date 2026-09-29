import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Branch line geometry, framed branches, levels, task progress, and
// presentation stops: the pure parts of the fourth round of Canvas work.
const directory = await mkdtemp(join(tmpdir(), 'notion-flow-canvas-lines-'));
try {
  const entry = join(directory, 'entry.ts');
  const source = (file) => JSON.stringify(fileURLToPath(new URL(`../src/canvas/${file}`, import.meta.url)));
  await writeFile(entry, [
    `export * from ${source('graph.ts')};`,
    `export * from ${source('lines.ts')};`,
    `export * from ${source('tasks.ts')};`,
    `export { mapSteps, canvasSteps, readingOrder } from ${source('presentation.ts')};`,
  ].join('\n'));
  const outfile = join(directory, 'lines.mjs');
  await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
    alias: { obsidian: fileURLToPath(new URL('./obsidian-stub.mjs', import.meta.url)) },
  });
  const {
    anchor, linePath, lineStyleFor, asLineChoice, organicWidths, roundedPolyline,
    buildForest, planMapLayout, boundaryBoxes, hiddenNodes, planLevels, MAP_GAPS,
    countTasks, taskProgress, mapSteps, canvasSteps, readingOrder,
  } = await import(pathToFileURL(outfile).href);

  const node = (id, x = 0, y = 0, width = 200, height = 60, extra = {}) => ({ id, type: 'text', x, y, width, height, text: id, ...extra });
  const edge = (fromNode, toNode, extra = {}) => ({ id: `${fromNode}-${toNode}`, fromNode, toNode, ...extra });
  const apply = (data, plan) => ({
    ...data,
    nodes: data.nodes.map(item => plan.positions.has(item.id) ? { ...item, ...plan.positions.get(item.id) } : item),
    edges: data.edges.map(item => plan.edgeSides.has(item.id) ? { ...item, ...plan.edgeSides.get(item.id) } : item),
  });
  const tidy = (data, rootId) => apply(data, planMapLayout(data, buildForest(data), rootId));
  const numbers = (d) => d.match(/-?\d+(?:\.\d+)?/g).map(Number);

  /* ---------- line styles ---------- */
  assert.equal(asLineChoice('elbow'), 'elbow');
  assert.equal(asLineChoice('zigzag'), null);
  assert.equal(asLineChoice(undefined), null);
  for (const layout of ['balanced', 'left', 'right']) assert.equal(lineStyleFor('auto', layout), 'organic', `${layout} maps taper`);
  for (const layout of ['down', 'up', 'tree', 'timeline', 'timeline-vertical']) assert.equal(lineStyleFor('auto', layout), 'elbow', `${layout} maps use elbows`);
  assert.equal(lineStyleFor('straight', 'balanced'), 'straight', 'an explicit choice wins over the structure');

  const box = { minX: 0, minY: 0, maxX: 100, maxY: 40 };
  assert.deepEqual(anchor(box, 'right'), { x: 100, y: 20 });
  assert.deepEqual(anchor(box, 'left'), { x: 0, y: 20 });
  assert.deepEqual(anchor(box, 'top'), { x: 50, y: 0 });
  assert.deepEqual(anchor(box, 'bottom'), { x: 50, y: 40 });

  // Curves: the tapered line's centre, stroked, reaching sideways only.
  assert.deepEqual(linePath('curve', { x: 0, y: 0 }, 'right', { x: 100, y: 50 }, 'left'),
    { d: 'M0 0 C50 0 50 50 100 50', spine: 'M0 0 C50 0 50 50 100 50', filled: false });
  assert.deepEqual(linePath('curve', { x: 0, y: 0 }, 'bottom', { x: 80, y: 120 }, 'top'),
    { d: 'M0 0 C0 60 80 60 80 120', spine: 'M0 0 C0 60 80 60 80 120', filled: false }, 'org charts reach down');
  {
    // Siblings from one parent never braid: they share x(t), and y(t) keeps their order.
    const ends = [-400, -200, -60, 60, 200, 400];
    const curves = ends.map((y) => numbers(linePath('curve', { x: 0, y: 0 }, 'right', { x: 300, y }, 'left').d));
    const at = ([ax, ay, c1x, c1y, c2x, c2y, bx, by], t) => {
      const u = 1 - t;
      const f = (a, b, c, d) => u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
      return { x: f(ax, c1x, c2x, bx), y: f(ay, c1y, c2y, by) };
    };
    for (let i = 1; i <= 19; i++) {
      const t = i / 20;
      const points = curves.map((curve) => at(curve, t));
      assert.ok(points.every((p) => Math.abs(p.x - points[0].x) < 1e-9), `siblings share x at t=${t}`);
      for (let k = 1; k < points.length; k++) assert.ok(points[k].y > points[k - 1].y, `in order at t=${t}`);
    }
  }
  const straight = linePath('straight', { x: 0, y: 0 }, 'right', { x: 100, y: 50 }, 'left');
  assert.deepEqual(straight, { d: 'M0 0 L100 50', spine: 'M0 0 L100 50', filled: false });

  // Elbows: sides facing each other turn halfway, so siblings share a trunk.
  const elbow = linePath('elbow', { x: 0, y: 0 }, 'right', { x: 100, y: 80 }, 'left');
  assert.equal(elbow.filled, false);
  assert.equal(elbow.d, 'M0 0 L38 0 Q50 0 50 12 L50 68 Q50 80 62 80 L100 80');
  const sibling = linePath('elbow', { x: 0, y: 0 }, 'right', { x: 100, y: -120 }, 'left');
  assert.ok(sibling.d.includes('Q50 0 50 -12'), 'a sibling above turns on the same trunk');
  // Org charts: down, across at half height, down.
  assert.equal(linePath('elbow', { x: 0, y: 0 }, 'bottom', { x: -60, y: 100 }, 'top').d,
    'M0 0 L0 38 Q0 50 -12 50 L-48 50 Q-60 50 -60 62 L-60 100');
  // Outlines: straight down the trunk, then one turn into the child.
  assert.equal(linePath('elbow', { x: 0, y: 0 }, 'bottom', { x: 110, y: 90 }, 'left').d,
    'M0 0 L0 78 Q0 90 12 90 L110 90');
  // Aligned cards need no bend at all; a timeline's spine stays a line.
  assert.equal(linePath('elbow', { x: 0, y: 30 }, 'right', { x: 64, y: 30 }, 'left').d, 'M0 30 L64 30');
  // Small offsets round off within the room they have.
  assert.equal(roundedPolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 20, y: 6 }], 12),
    'M0 0 L7 0 Q10 0 10 3 Q10 6 13 6 L20 6');
  assert.equal(roundedPolyline([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 }], 12), 'M0 0 L5 0', 'repeated points are dropped');

  // Tapered: a filled outline around a centre line the pointer can grab.
  const organic = linePath('organic', { x: 0, y: 0 }, 'right', { x: 200, y: 100 }, 'left', [9, 3]);
  assert.equal(organic.filled, true);
  assert.equal(organic.spine, 'M0 0 C100 0 100 100 200 100', 'the branch leaves and enters square to each card');
  assert.ok(organic.d.startsWith('M0 4.5 ') || organic.d.startsWith('M0 -4.5 '), 'full width where it leaves the parent');
  assert.ok(organic.d.endsWith(' Z'));
  const points = numbers(organic.d);
  const pairs = [];
  for (let i = 0; i < points.length; i += 2) pairs.push({ x: points[i], y: points[i + 1] });
  assert.equal(pairs.length, 50, 'both edges of 25 samples');
  const width = (i) => Math.hypot(pairs[i].x - pairs[pairs.length - 1 - i].x, pairs[i].y - pairs[pairs.length - 1 - i].y);
  assert.ok(Math.abs(width(0) - 9) < 0.2, 'nine wide at the parent');
  assert.ok(Math.abs(width(24) - 3) < 0.2, 'three wide at the child');
  for (let i = 1; i <= 24; i++) assert.ok(width(i) <= width(i - 1) + 0.2, 'it only ever narrows');
  assert.ok(width(6) < 6, 'and narrows early, like a branch');
  const left = linePath('organic', { x: 0, y: 0 }, 'left', { x: -200, y: 0 }, 'right', [4, 2]);
  assert.equal(left.spine, 'M0 0 C-100 0 -100 0 -200 0');
  const down = linePath('organic', { x: 0, y: 0 }, 'bottom', { x: 110, y: 200 }, 'left', [4, 2]);
  assert.equal(down.spine, 'M0 0 C0 100 55 200 110 200', 'an outline branch drops, then sweeps into its card');
  const close = linePath('organic', { x: 0, y: 0 }, 'right', { x: 4, y: 0 }, 'left', [4, 2]);
  assert.equal(close.spine, 'M0 0 C12 0 -8 0 4 0', 'very close cards still leave and enter square');
  assert.deepEqual(linePath('organic', { x: 5, y: 5 }, 'right', { x: 5, y: 5 }, 'left'), { d: 'M5 5 L5 5', spine: 'M5 5 L5 5', filled: false });
  assert.deepEqual(organicWidths(0), [9, 3.6]);
  assert.deepEqual(organicWidths(1), [3.6, 2.3]);
  assert.deepEqual(organicWidths(9), [1.7, 1.7]);
  assert.deepEqual(organicWidths(0, 0.5), [4.5, 1.8]);

  /* ---------- boundaries ---------- */
  const plain = {
    nodes: [
      node('root', 0, 0, 200, 60, { nfLayout: 'right' }),
      node('a', 400, -200), node('a1', 800, -300), node('a2', 800, -100),
      node('b', 400, 200), node('b1', 800, 200),
    ],
    edges: [edge('root', 'a'), edge('a', 'a1'), edge('a', 'a2'), edge('root', 'b'), edge('b', 'b1')],
  };
  const before = tidy(plain, 'root');
  const framed = { ...before, nodes: before.nodes.map(item => item.id === 'a' ? { ...item, nfBoundary: true } : item) };
  const after = tidy(framed, 'root');
  const at = (data, id) => data.nodes.find(item => item.id === id);
  const pad = MAP_GAPS.boundary;
  assert.equal(pad, 14);
  assert.equal(at(after, 'a').x, at(before, 'a').x, 'a framed branch keeps its distance from its parent');
  const forest = buildForest(after);
  const boxes = boundaryBoxes(after, forest);
  assert.deepEqual([...boxes.keys()], ['a']);
  const frame = boxes.get('a');
  const members = ['a', 'a1', 'a2'].map(id => at(after, id));
  assert.equal(frame.minX, Math.min(...members.map(item => item.x)) - pad);
  assert.equal(frame.maxX, Math.max(...members.map(item => item.x + item.width)) - 0 + pad);
  assert.equal(frame.minY, Math.min(...members.map(item => item.y)) - pad);
  assert.equal(frame.maxY, Math.max(...members.map(item => item.y + item.height)) + pad);
  const b = at(after, 'b');
  assert.ok(b.y - frame.maxY >= MAP_GAPS.horizontal.cross - 0.5, 'the next branch keeps its gap from the boundary, not from the cards');
  assert.ok(at(after, 'b').y - at(before, 'b').y > 0 || at(after, 'a').y - at(before, 'a').y < 0, 'siblings make room for the boundary');
  assert.deepEqual(tidy(after, 'root'), after, 'a framed layout is a fixed point');

  // Nested boundaries: the outer one wraps the inner one with room to spare.
  const nested = { ...after, nodes: after.nodes.map(item => item.id === 'root' || item.id === 'a1' ? { ...item, nfBoundary: true } : item) };
  const nestedLaid = tidy(nested, 'root');
  const nestedBoxes = boundaryBoxes(nestedLaid, buildForest(nestedLaid));
  const inner = nestedBoxes.get('a1');
  const outer = nestedBoxes.get('a');
  assert.ok(outer.minX <= inner.minX - pad && outer.maxX >= inner.maxX + pad && outer.minY <= inner.minY - pad,
    'a boundary contains the boundaries inside it');
  assert.ok(nestedBoxes.get('root').minX < outer.minX, 'a framed root frames the whole map');
  // Folding hides a framed card's boundary with it; its own card stays framed.
  const folded = { ...nestedLaid, nodes: nestedLaid.nodes.map(item => item.id === 'a' ? { ...item, nfCollapsed: true } : item) };
  const foldedForest = buildForest(folded);
  const foldedBoxes = boundaryBoxes(folded, foldedForest, hiddenNodes(folded, foldedForest));
  assert.equal(foldedBoxes.has('a1'), false, 'a folded-away boundary is not drawn');
  const aCard = at(folded, 'a');
  assert.deepEqual(foldedBoxes.get('a'), { minX: aCard.x - pad, minY: aCard.y - pad, maxX: aCard.x + aCard.width + pad, maxY: aCard.y + aCard.height + pad });
  // Live geometry wins over stored positions, as cards glide.
  const moved = boundaryBoxes(after, forest, new Set(), (id) => ({ ...at(after, id), x: at(after, id).x + 10 }));
  assert.equal(moved.get('a').minX, frame.minX + 10);
  // Boundaries outside maps, or on nothing, draw nothing.
  assert.equal(boundaryBoxes({ nodes: [node('lone', 0, 0, 100, 40, { nfBoundary: true })], edges: [] }, buildForest({ nodes: [], edges: [] })).size, 0);

  // Every structure keeps a framed card in its slot and makes room around it.
  for (const layout of ['balanced', 'left', 'down', 'up', 'tree', 'timeline', 'timeline-vertical']) {
    const data = { ...framed, nodes: framed.nodes.map(item => item.id === 'root' ? { ...item, nfLayout: layout } : item) };
    const laid = tidy(tidy(data, 'root'), 'root');
    const laidForest = buildForest(laid);
    assert.deepEqual([...laidForest.nodes.keys()].sort(), ['a', 'a1', 'a2', 'b', 'b1', 'root'], `${layout}: structure survives the boundary`);
    const frameBox = boundaryBoxes(laid, laidForest).get('a');
    for (const other of ['root', 'b', 'b1']) {
      const item = at(laid, other);
      const clear = item.x >= frameBox.maxX || item.x + item.width <= frameBox.minX
        || item.y >= frameBox.maxY || item.y + item.height <= frameBox.minY;
      assert.ok(clear, `${layout}: ${other} stays outside the boundary`);
    }
    assert.deepEqual(tidy(laid, 'root'), laid, `${layout}: fixed point`);
  }
  // In an outline a framed child keeps its indent; the boundary reaches back into it.
  const tree = tidy({ ...framed, nodes: framed.nodes.map(item => item.id === 'root' ? { ...item, nfLayout: 'tree' } : item) }, 'root');
  assert.equal(at(tree, 'a').x, at(tree, 'root').x + at(tree, 'root').width / 2 + MAP_GAPS.list.indent);

  /* ---------- levels ---------- */
  const deep = {
    nodes: [node('r', 0, 0, 200, 60, { nfLayout: 'right' }), node('x'), node('x1'), node('x11'), node('y'), node('y1', 0, 0, 200, 60, { nfCollapsed: true }), node('y11')],
    edges: [edge('r', 'x'), edge('x', 'x1'), edge('x1', 'x11'), edge('r', 'y'), edge('y', 'y1'), edge('y1', 'y11')],
  };
  const deepForest = buildForest(tidy(deep, 'r'));
  assert.deepEqual(planLevels(deep, deepForest, 'r', 1), { fold: ['x', 'y'], unfold: [] }, 'level 1 folds the main branches');
  assert.deepEqual(planLevels(deep, deepForest, 'r', 2), { fold: ['x1'], unfold: [] }, 'level 2 folds the next row; a folded one stays folded');
  assert.deepEqual(planLevels(deep, deepForest, 'r', 3), { fold: [], unfold: ['y1'] }, 'level 3 opens what lies above it');
  const shallow = { ...deep, nodes: deep.nodes.map(item => item.id === 'r' ? { ...item, nfCollapsed: true } : item) };
  assert.deepEqual(planLevels(shallow, buildForest(shallow), 'r', 1).unfold, ['r'], 'a folded root opens');

  /* ---------- tasks ---------- */
  assert.deepEqual(countTasks('- [ ] a\n- [x] b\n  * [X] c\n1. [ ] d\n> - [x] quoted\n- [-] cancelled\n- [/] doing'), { done: 3, total: 6 });
  assert.deepEqual(countTasks('```\n- [ ] in code\n```\n- [ ] out\n~~~md\n- [x] tilde\n~~~'), { done: 0, total: 1 }, 'code blocks are skipped');
  assert.deepEqual(countTasks('- [ ]\n- [x]'), { done: 1, total: 2 }, 'empty tasks count');
  assert.deepEqual(countTasks('[ ] not a list\n- [ ]no space\n-[ ] tight'), { done: 0, total: 0 });
  const taskMap = {
    nodes: [
      node('t', 0, 0, 200, 60, { nfLayout: 'right', text: 'Plan' }),
      node('t1', 0, 0, 200, 60, { text: '- [x] Book' }), node('t2', 0, 0, 200, 60, { text: 'Pack', nfCollapsed: true }),
      node('t21', 0, 0, 200, 60, { text: '- [ ] Shoes\n- [x] Hat' }),
      node('file', 0, 0, 200, 60, { type: 'file', file: 'Trip.md' }),
      node('loose', 900, 900, 200, 60, { text: '- [ ] one\n- [x] two' }), node('single', 900, 1200, 200, 60, { text: '- [ ] only' }),
    ],
    edges: [edge('t', 't1'), edge('t', 't2'), edge('t2', 't21'), edge('t', 'file')],
  };
  const taskForest = buildForest(taskMap);
  const progress = taskProgress(taskMap, taskForest, (id) => id === 'file' ? { done: 2, total: 5 } : null);
  assert.deepEqual(progress.get('t'), { done: 4, total: 8 }, 'a centre sums its whole map, notes and folded cards included');
  assert.deepEqual(progress.get('t2'), { done: 1, total: 2 });
  assert.equal(progress.has('t1'), false, 'one task speaks for itself');
  assert.deepEqual(progress.get('t21'), { done: 1, total: 2 }, 'a checklist card shows its own count');
  assert.deepEqual(progress.get('loose'), { done: 1, total: 2 }, 'free cards too');
  assert.equal(progress.has('single'), false);
  assert.equal(progress.has('file'), true, 'a file card with a checklist in its note');

  /* ---------- presentation stops ---------- */
  const map = tidy({
    nodes: [node('c', 0, 0, 200, 60, { nfLayout: 'balanced' }), node('p1', 400, -100), node('p2', 400, 100), node('p3', -400, 0), node('q', 700, -100), node('far', 3000, 3000)],
    edges: [edge('c', 'p1'), edge('c', 'p2'), edge('c', 'p3'), edge('p1', 'q')],
  }, 'c');
  const mapForest = buildForest(map);
  const steps = mapSteps(map, mapForest, new Set(), 'c');
  assert.deepEqual(steps.map(step => step.title), ['c', 'p1', 'p2', 'p3', 'c'], 'overview, branches clockwise, overview');
  assert.deepEqual(steps[1].frame, ['p1', 'q'], 'a stop frames its branch');
  assert.deepEqual(steps[1].spotlight, ['c', 'p1', 'q'], 'with the centre still lit');
  assert.equal(steps[0].frame.includes('far'), false, 'other cards are not part of the map’s story');
  const foldedMap = { ...map, nodes: map.nodes.map(item => item.id === 'p1' ? { ...item, nfCollapsed: true } : item) };
  const foldedMapForest = buildForest(foldedMap);
  assert.deepEqual(mapSteps(foldedMap, foldedMapForest, hiddenNodes(foldedMap, foldedMapForest), 'c')[1].frame, ['p1'], 'folded cards stay out of view');
  assert.deepEqual(mapSteps({ nodes: [node('solo', 0, 0, 200, 60, { nfLayout: 'right' })], edges: [] },
    buildForest({ nodes: [node('solo', 0, 0, 200, 60, { nfLayout: 'right' })], edges: [] }), new Set(), 'solo').length, 1, 'a lone centre is a single stop');

  const board = {
    nodes: [
      node('g2', 1000, 0, 600, 400, { type: 'group', label: 'Second' }), node('in2', 1100, 100),
      node('g1', 0, 20, 600, 400, { type: 'group', label: 'First' }), node('in1', 100, 100),
      node('m', 0, 800, 200, 60, { nfLayout: 'right' }), node('m1', 400, 800),
      node('note', 1100, 820),
    ],
    edges: [edge('m', 'm1')],
  };
  const boardSteps = canvasSteps(tidy(board, 'm'), buildForest(tidy(board, 'm')), new Set());
  assert.deepEqual(boardSteps.map(step => step.title), [null, 'g1', 'g2', 'm', 'm1', 'note', null],
    'groups, maps branch by branch, and cards read like a page, and the whole canvas closes');
  assert.deepEqual(boardSteps[1].spotlight.sort(), ['g1', 'in1'], 'a group’s slide lights what it holds');
  assert.deepEqual(boardSteps[3].frame, ['m', 'm1'], 'a map opens on its overview');
  assert.deepEqual(boardSteps[4].spotlight, ['m', 'm1'], 'then its branches, the centre still lit');
  assert.deepEqual(boardSteps[6].frame, boardSteps[0].frame, 'the close shows everything again');
  // Without a map, groups and cards are one stop each.
  const flat = { nodes: board.nodes.filter(item => item.id !== 'm' && item.id !== 'm1'), edges: [] };
  assert.deepEqual(canvasSteps(flat, buildForest(flat), new Set()).map(step => step.title), [null, 'g1', 'g2', 'note', null]);
  // A canvas that is one map is told as that map, not as a single overview.
  const onlyMap = { ...map, nodes: map.nodes.filter(item => item.id !== 'far') };
  const onlyMapForest = buildForest(onlyMap);
  const onlyMapSteps = canvasSteps(onlyMap, onlyMapForest, new Set());
  assert.deepEqual(onlyMapSteps.map(step => step.title), ['c', 'p1', 'p2', 'p3', 'c'], 'one map: its overview, each branch, and its overview');
  assert.deepEqual(onlyMapSteps, mapSteps(onlyMap, onlyMapForest, new Set(), 'c'), 'exactly as with its centre selected');
  assert.ok(onlyMapSteps[1].spotlight.includes('c'));
  // A summary is told with its map: a one-map canvas stays that map's story, and no summary is a stop of its own.
  const summed = { ...onlyMap, nodes: [...onlyMap.nodes, node('s', 700, 0, 160, 60, { nfSummary: { parent: 'c', from: 'p1', to: 'p2' } })] };
  const summedForest = buildForest(summed);
  const summedSteps = canvasSteps(summed, summedForest, new Set());
  assert.deepEqual(summedSteps, mapSteps(summed, summedForest, new Set(), 'c'), 'one map with a summary is still told as that map');
  assert.deepEqual(summedSteps.map(step => step.title), ['c', 'p1', 'p2', 'p3', 'c']);
  assert.ok(summedSteps[0].frame.includes('s'), 'the summary shows with its map');
  const mixed = { ...summed, nodes: [...summed.nodes, node('far', 3000, 3000)] };
  const mixedSteps = canvasSteps(mixed, buildForest(mixed), new Set());
  assert.deepEqual(mixedSteps.map(step => step.title), [null, 'c', 'p1', 'p2', 'p3', 'far', null], 'among other cards, too');
  // A summary whose run is gone is a loose card again.
  const stray = { ...onlyMap, nodes: [...onlyMap.nodes, node('s', 700, 0, 160, 60, { nfSummary: { parent: 'c', from: 'gone', to: 'gone' } })] };
  assert.deepEqual(canvasSteps(stray, buildForest(stray), new Set()).map(step => step.title), [null, 'c', 'p1', 'p2', 'p3', 's', null]);
  // Folded all the way, the one map is still one stop, never none.
  const closed = { ...onlyMap, nodes: onlyMap.nodes.map(item => item.id === 'c' ? { ...item, nfCollapsed: true } : item) };
  const closedForest = buildForest(closed);
  const closedSteps = canvasSteps(closed, closedForest, hiddenNodes(closed, closedForest));
  assert.deepEqual(closedSteps.map(step => step.title), ['c'], 'a folded map is a single stop');
  assert.deepEqual(closedSteps, mapSteps(closed, closedForest, hiddenNodes(closed, closedForest), 'c'));
  assert.equal(canvasSteps({ nodes: [node('only')], edges: [] }, buildForest({ nodes: [], edges: [] }), new Set()).length, 1,
    'one card needs no slides beyond the overview');
  assert.deepEqual(canvasSteps({ nodes: [], edges: [] }, buildForest({ nodes: [], edges: [] }), new Set()), []);
  const rowItems = [
    { id: 'b', box: { minX: 500, minY: 10, maxX: 600, maxY: 100 } },
    { id: 'a', box: { minX: 0, minY: 0, maxX: 100, maxY: 100 } },
    { id: 'c', box: { minX: 0, minY: 200, maxX: 100, maxY: 300 } },
  ];
  assert.deepEqual(readingOrder(rowItems).map(item => item.id), ['a', 'b', 'c'], 'a row reads left to right before the next row');

  console.log('PASS canvas lines: elbow, straight, and tapered geometry; framed branches in every structure; levels; task progress; presentation stops');
} finally {
  await rm(directory, { recursive: true, force: true });
}
