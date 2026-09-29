import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'notion-flow-canvas-graph-'));
try {
  const outfile = join(directory, 'graph.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('../src/canvas/graph.ts', import.meta.url))],
    bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
  });
  const {
    buildBranch, findParent, findNewNodePosition, findDirectionalNeighbor, buildForest, descendants,
    hiddenNodes, mapMembers, orderedChildren, planMapLayout, planMapInsertion, planSiblingMove,
    planBranchColors, planBranchColor, planFreeCard, mapSpacing, spacingGaps, mapNeighbor, MAP_GAPS,
  } = await import(pathToFileURL(outfile).href);
  const node = (id, x = 0, y = 0, width = 260, height = 120, extra = {}) => ({ id, type: 'text', x, y, width, height, ...extra });
  const edge = (fromNode, toNode, extra = {}) => ({ id: `${fromNode}-${toNode}`, fromNode, toNode, ...extra });
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
  const apply = (data, plan) => ({
    ...data,
    nodes: data.nodes.map(item => plan.positions.has(item.id) ? { ...item, ...plan.positions.get(item.id) } : item),
    edges: data.edges.map(item => plan.edgeSides.has(item.id) ? { ...item, ...plan.edgeSides.get(item.id) } : item),
  });
  const assertNoOverlap = (nodes) => {
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      assert.equal(overlaps(nodes[i], nodes[j]), false, `${nodes[i].id} overlaps ${nodes[j].id}`);
    }
  };
  const center = item => ({ x: item.x + item.width / 2, y: item.y + item.height / 2 });
  const tidy = (data, rootId, options) => {
    const plan = planMapLayout(data, buildForest(data), rootId, options);
    return apply(data, plan);
  };

  /* ---------- free-canvas helpers ---------- */
  const cyclic = {
    customMetadata: { keep: true },
    nodes: [node('a'), node('b', 400, 100), node('c', 700, 200), node('unrelated', -800), node('group', 5000, 5000, 200, 200, { type: 'group' })],
    edges: [edge('a', 'a'), edge('a', 'b'), edge('b', 'c'), edge('c', 'a'), edge('a', 'c', { id: 'cross', customEdgeProperty: 'keep' }), edge('a', 'group'), edge('group', 'unrelated'), edge('a', 'missing')],
  };
  assert.deepEqual([...buildBranch(cyclic, 'a')].sort(), ['a', 'b', 'c']);
  assert.equal(buildBranch(cyclic, 'group').size, 0);
  assert.equal(buildBranch(cyclic, 'missing').size, 0);

  const parentData = { nodes: [node('a'), node('b'), node('c'), node('g', 5000, 5000, 100, 100, { type: 'group' })], edges: [edge('a', 'b'), edge('a', 'b', { id: 'parallel' }), edge('b', 'b'), edge('g', 'b')] };
  assert.equal(findParent(parentData, 'b'), 'a');
  assert.equal(findParent(parentData, 'a'), null);
  parentData.edges.push(edge('c', 'b'));
  assert.equal(findParent(parentData, 'b'), null);
  assert.equal(findNewNodePosition(parentData, 'b', 'sibling'), null);

  const addData = { nodes: [node('root'), node('obstacle', 356, -100, 260, 600), node('group', 350, 500, 300, 600, { type: 'group' })], edges: [] };
  const newChild = findNewNodePosition(addData, 'root', 'child');
  assert.equal(newChild.parentId, 'root');
  assert.equal(newChild.fromSide, 'right');
  assert.equal(newChild.toSide, 'left');
  for (const obstacle of addData.nodes) assert.equal(overlaps({ ...newChild, width: 260, height: 120 }, obstacle), false);
  assert.equal(findNewNodePosition(addData, 'root', 'sibling'), null);
  assert.equal(findNewNodePosition(addData, 'missing', 'child'), null);
  assert.equal(findNewNodePosition(addData, 'root', 'child', -1), null);
  const leftData = { nodes: [node('root', 700), node('left', 250, 0, 200, 100)], edges: [edge('root', 'left', { fromSide: 'left', toSide: 'right' })] };
  const newLeftChild = findNewNodePosition(leftData, 'left', 'child');
  assert.ok(newLeftChild.x + 260 < 250, 'left-hand free branch continues growing left');
  assert.equal(newLeftChild.fromSide, 'left');
  const grouped = { nodes: [node('root'), node('inside', 450, 100), node('g', 400, 0, 400, 300, { type: 'group' })], edges: [edge('root', 'inside')] };
  assert.equal(findNewNodePosition(grouped, 'inside', 'child'), null, 'free placement never moves cards in or out of groups');

  const navigation = { nodes: [node('center'), node('right', 400), node('left', -400), node('up', 0, -250), node('down', 0, 250), node('diagonal', 280, 700), node('g', 280, 0, 50, 50, { type: 'group' })], edges: [] };
  for (const direction of ['right', 'left', 'up', 'down']) assert.equal(findDirectionalNeighbor(navigation, 'center', direction), direction);
  assert.equal(findDirectionalNeighbor(navigation, 'missing', 'right'), null);
  assert.equal(findDirectionalNeighbor({ nodes: [node('one')], edges: [] }, 'one', 'left'), null);

  /* ---------- forest ---------- */
  const mapped = {
    nodes: [
      node('root', 0, 0, 300, 100, { nfLayout: 'right' }),
      node('a', 900, 300), node('b', 400, -200), node('c', 1200, 0), node('d', 50, 900),
      node('labelled', 2000, 0), node('other', -900, 0, 260, 120, { nfLayout: 'left' }), node('o1', -1400, 0),
      node('free', 5000, 0), node('box', 4000, -100, 900, 600, { type: 'group' }), node('boxed', 4100, 0),
    ],
    edges: [
      edge('root', 'a'), edge('root', 'b'), edge('a', 'c'), edge('b', 'c', { id: 'cross' }),
      edge('root', 'labelled', { label: 'see also' }), edge('root', 'other'), edge('other', 'o1'),
      edge('c', 'root'), edge('root', 'boxed'), edge('d', 'root'),
    ],
  };
  const forest = buildForest(mapped);
  assert.deepEqual(forest.roots.sort(), ['other', 'root']);
  assert.deepEqual(mapMembers(forest, 'root').sort(), ['a', 'b', 'c', 'root']);
  assert.equal(forest.nodes.has('labelled'), false, 'labelled connections are relationships, not branches');
  assert.equal(forest.nodes.get('other').parent, null, 'another map root is never adopted');
  assert.equal(forest.nodes.get('o1').root, 'other');
  assert.equal(forest.nodes.has('boxed'), false, 'a card inside a group the root is not in stays out');
  assert.equal(forest.nodes.has('d'), false, 'incoming connections do not adopt');
  assert.equal(forest.nodes.get('c').parent, 'a', 'ties keep the older connection');
  assert.deepEqual(descendants(forest, 'root').sort(), ['a', 'b', 'c']);
  assert.deepEqual(buildForest({ ...mapped, edges: [...mapped.edges].reverse() }).nodes.get('c').parent, 'b', 'edge order breaks ties deterministically');

  // A tidy map keeps its tree when a cross-link is added later.
  const tree = {
    nodes: [node('root', 0, 0, 200, 80, { nfLayout: 'right' }), node('x', 0, 0), node('y', 0, 0), node('x1', 0, 0), node('y1', 0, 0)],
    edges: [edge('root', 'x'), edge('root', 'y'), edge('x', 'x1'), edge('y', 'y1')],
  };
  const tidyTree = tidy(tree, 'root');
  const linked = { ...tidyTree, edges: [...tidyTree.edges, edge('x', 'y1', { id: 'a-late-link' })] };
  assert.equal(buildForest(linked).nodes.get('y1').parent, 'y', 'a later cross-link never takes over a branch');
  // Equal-width siblings share a slot column; only memory can break that tie
  // when an undo re-creates the tree connection after the cross-link.
  const reordered0 = { ...linked, edges: [linked.edges.at(-1), ...linked.edges.slice(0, -1)] };
  assert.equal(buildForest(reordered0).nodes.get('y1').parent, 'x');
  assert.equal(buildForest(reordered0, new Map(), new Map([['y1', 'y']])).nodes.get('y1').parent, 'y', 'the previous parent wins ties');
  const skewed = { ...linked, nodes: linked.nodes.map(item => item.id === 'x' ? { ...item, width: 300 } : item) };
  assert.equal(buildForest({ ...skewed, edges: reordered0.edges }).nodes.get('y1').parent, 'y', 'slot geometry outranks connection order');
  const moved = { ...linked, nodes: linked.nodes.map(item => item.id === 'y1' ? { ...item, x: item.x + 333, y: item.y + 50 } : item) };
  const before = new Map(linked.nodes.map(item => [item.id, item]));
  assert.equal(buildForest(moved, before).nodes.get('y1').parent, 'y', 'pre-gesture geometry keeps parents while dragging');

  /* ---------- layout ---------- */
  const sized = {
    nodes: [
      node('root', 50, 80, 420, 170, { nfLayout: 'right', color: '3' }), node('late', 100, 200, 180, 100),
      node('early', 200, -200, 400, 320), node('e1', 900, -500, 500, 80), node('e2', 800, -300, 120, 600),
      node('l1', 0, 0, 700, 280), node('outside', -3000, -3000),
    ],
    edges: [edge('root', 'late'), edge('root', 'early'), edge('early', 'e1'), edge('early', 'e2'), edge('late', 'l1')],
  };
  const original = structuredClone(sized);
  for (const layout of ['right', 'left', 'down', 'up', 'balanced']) {
    const data = { ...sized, nodes: sized.nodes.map(item => item.id === 'root' ? { ...item, nfLayout: layout } : item) };
    const plan = planMapLayout(data, buildForest(data), 'root', { rebalance: layout === 'balanced' });
    assert.deepEqual(plan.positions.get('root'), { x: 50, y: 80 }, `${layout}: the root stays anchored`);
    assert.equal(plan.positions.has('outside'), false, `${layout}: cards outside the map are untouched`);
    const laid = apply(data, plan);
    assertNoOverlap(laid.nodes.filter(item => item.id !== 'outside'));
    const at = id => laid.nodes.find(item => item.id === id);
    const r = at('root');
    if (layout === 'right') for (const id of ['late', 'early']) assert.equal(at(id).x, r.x + r.width + MAP_GAPS.horizontal.main);
    if (layout === 'left') for (const id of ['late', 'early']) assert.equal(at(id).x + at(id).width, r.x - MAP_GAPS.horizontal.main);
    if (layout === 'down') for (const id of ['late', 'early']) assert.equal(at(id).y, r.y + r.height + MAP_GAPS.vertical.main);
    if (layout === 'up') for (const id of ['late', 'early']) assert.equal(at(id).y + at(id).height, r.y - MAP_GAPS.vertical.main);
    if (layout === 'right' || layout === 'left') {
      assert.ok(at('early').y < at('late').y, `${layout}: sibling order follows the previous vertical order`);
      assert.ok(Math.abs(center(r).y - (center(at('early')).y + center(at('late')).y) / 2) <= 1, 'parent is centred on its children');
    }
    if (layout === 'balanced') {
      const sides = ['early', 'late'].map(id => Math.sign(center(at(id)).x - center(r).x));
      assert.deepEqual(sides.sort(), [-1, 1], 'a balanced map puts branches on both sides');
    }
    for (const [id, sides] of plan.edgeSides) assert.ok(sides.fromSide && sides.toSide, id);
    // Tidy output is a fixed point, so auto-layout never drifts.
    const again = planMapLayout(laid, buildForest(laid), 'root');
    assert.deepEqual([...again.positions].filter(([id, p]) => {
      const item = at(id); return item.x !== p.x || item.y !== p.y;
    }), [], `${layout}: layout is idempotent`);
    assert.deepEqual(laid.nodes.map(({ x, y, ...rest }) => rest), data.nodes.map(({ x, y, ...rest }) => rest), 'only positions change');
  }
  assert.deepEqual(sized, original, 'planning never mutates its input');

  const tieOrder = { nodes: [node('root', 0, 0, 260, 120, { nfLayout: 'right' }), node('second'), node('first')], edges: [edge('root', 'first'), edge('root', 'second')] };
  const tied = tidy(tieOrder, 'root');
  assert.ok(tied.nodes.find(item => item.id === 'second').y < tied.nodes.find(item => item.id === 'first').y, 'original card order breaks geometry ties');

  // Dragging a card past its sibling reorders it.
  const reordered = tidyTree.nodes.map(item => item.id === 'y' ? { ...item, y: -500 } : item);
  const afterDrag = tidy({ ...tidyTree, nodes: reordered }, 'root');
  assert.ok(afterDrag.nodes.find(item => item.id === 'y').y < afterDrag.nodes.find(item => item.id === 'x').y);
  assert.ok(afterDrag.nodes.find(item => item.id === 'y1').y < afterDrag.nodes.find(item => item.id === 'x1').y, 'branches move with their card');

  // Balanced: kept sides versus redistribution.
  const lopsided = {
    nodes: [node('root', 0, 0, 200, 80, { nfLayout: 'balanced' }), ...['a', 'b', 'c', 'd'].map((id, i) => node(id, 400, i * 200 - 300, 200, 80))],
    edges: ['a', 'b', 'c', 'd'].map(id => edge('root', id)),
  };
  const kept = tidy(lopsided, 'root');
  assert.ok(kept.nodes.filter(item => item.id !== 'root').every(item => item.x > 0), 'tidy keeps every branch on its side');
  const rebalanced = tidy(lopsided, 'root', { rebalance: true });
  const sideOf = (data, id) => Math.sign(center(data.nodes.find(item => item.id === id)).x - 100);
  assert.deepEqual(['a', 'b', 'c', 'd'].map(id => sideOf(rebalanced, id)), [1, 1, -1, -1], 'rebalancing splits the clockwise order');
  assert.ok(rebalanced.nodes.find(item => item.id === 'd').y < rebalanced.nodes.find(item => item.id === 'c').y, 'the left side reads bottom-up');
  assert.deepEqual(tidy(rebalanced, 'root', { rebalance: true }).nodes, rebalanced.nodes, 'rebalancing is idempotent');
  assert.deepEqual(tidy(rebalanced, 'root').nodes, rebalanced.nodes, 'tidy keeps a rebalanced map');
  const moveLeft = { ...rebalanced, nodes: rebalanced.nodes.map(item => item.id === 'a' ? { ...item, x: -600 } : item) };
  assert.equal(sideOf(tidy(moveLeft, 'root'), 'a'), -1, 'dragging a branch across the root switches sides');

  // Folded branches take no space and travel with their card.
  const folded = {
    ...tidyTree,
    nodes: tidyTree.nodes.map(item => item.id === 'x' ? { ...item, nfCollapsed: true } : item),
  };
  const foldForest = buildForest(folded);
  assert.deepEqual([...hiddenNodes(folded, foldForest)], ['x1']);
  const foldedLayout = tidy(folded, 'root');
  const x = foldedLayout.nodes.find(item => item.id === 'x');
  const x1 = foldedLayout.nodes.find(item => item.id === 'x1');
  const xBefore = folded.nodes.find(item => item.id === 'x');
  const x1Before = folded.nodes.find(item => item.id === 'x1');
  assert.deepEqual({ dx: x1.x - x.x, dy: x1.y - x.y }, { dx: x1Before.x - xBefore.x, dy: x1Before.y - xBefore.y }, 'a folded branch keeps its shape');
  const unfoldedSpan = tidyTree.nodes.find(item => item.id === 'y').y - tidyTree.nodes.find(item => item.id === 'x').y;
  const foldedSpan = foldedLayout.nodes.find(item => item.id === 'y').y - x.y;
  assert.ok(foldedSpan <= unfoldedSpan, 'folding never needs more room');
  assert.deepEqual(tidy(foldedLayout, 'root').nodes, foldedLayout.nodes, 'folded layout is idempotent');
  assert.equal(hiddenNodes({ ...folded, nodes: folded.nodes.map(item => ({ ...item, nfLayout: undefined })) }, buildForest({ nodes: [], edges: [] })).size, 0, 'folding outside a map hides nothing');

  /* ---------- growing ---------- */
  const growth = tidy({
    nodes: [node('root', 0, 0, 200, 80, { nfLayout: 'right' }), node('p', 0, 0, 200, 80), node('q', 0, 0, 200, 80), node('p1', 0, 0, 200, 80)],
    edges: [edge('root', 'p'), edge('root', 'q'), edge('p', 'p1')],
  }, 'root');
  const growthForest = buildForest(growth);
  const insert = (data, forestIn, selected, kind, id) => {
    const slot = planMapInsertion(data, forestIn, selected, kind, 240, 60);
    const next = {
      ...data,
      nodes: [...data.nodes, node(id, slot.x, slot.y, 240, 60)],
      edges: [...data.edges, edge(slot.parentId, id)],
    };
    return { slot, data: tidy(next, 'root') };
  };
  const readingOrder = (data, id) => orderedChildren(data, buildForest(data), id);
  let grown = insert(growth, growthForest, 'p', 'sibling', 'new-sibling');
  assert.equal(grown.slot.parentId, 'root');
  assert.deepEqual(readingOrder(grown.data, 'root'), ['p', 'new-sibling', 'q'], 'a sibling lands right after the selected card');
  grown = insert(growth, growthForest, 'root', 'child', 'last');
  assert.deepEqual(readingOrder(grown.data, 'root'), ['p', 'q', 'last'], 'a child lands after the last child');
  assertNoOverlap(grown.data.nodes);
  assert.equal(planMapInsertion(growth, growthForest, 'root', 'sibling', 240, 60), null, 'the root has no siblings');
  assert.equal(planMapInsertion(growth, growthForest, 'missing', 'child', 240, 60), null);
  const balancedGrowth = { ...rebalanced, nodes: rebalanced.nodes.filter(item => item.id !== 'd'), edges: rebalanced.edges.filter(item => item.toNode !== 'd') };
  assert.equal(planMapInsertion(balancedGrowth, buildForest(balancedGrowth), 'root', 'child', 240, 60).direction, 'left', 'a balanced map grows its lighter side');

  assert.equal(planSiblingMove(growth, growthForest, 'p', -1), null, 'the first card cannot move up');
  const down = planSiblingMove(growth, growthForest, 'p', 1);
  const swapped = tidy({ ...growth, nodes: growth.nodes.map(item => item.id === 'p' ? { ...item, ...down } : item) }, 'root');
  assert.deepEqual(readingOrder(swapped, 'root'), ['q', 'p']);
  assert.equal(planSiblingMove(growth, growthForest, 'root', 1), null);

  const colors = planBranchColors(growth, growthForest, 'root');
  assert.equal(colors.nodes.get('p'), '1');
  assert.equal(colors.nodes.get('p1'), '1', 'a branch shares one colour');
  assert.equal(colors.nodes.get('q'), '2');
  assert.equal(colors.nodes.has('root'), false);
  assert.equal(colors.edges.get('p-p1'), '1');

  // One branch: the card, its descendants, the lines into them, and its summaries; nothing else.
  const summarised = { ...growth, nodes: [...growth.nodes, node('sum', 900, 0, 200, 80, { nfSummary: { parent: 'p', from: 'p1', to: 'p1' } })] };
  const summarisedForest = buildForest(summarised);
  const branch = planBranchColor(summarised, summarisedForest, 'p', '3');
  assert.deepEqual([...branch.nodes].sort(), [['p', '3'], ['p1', '3'], ['sum', '3']], 'the branch, its cards and its summary take the colour');
  assert.deepEqual([...branch.edges].sort(), [['p-p1', '3'], ['root-p', '3']], 'with the lines into each card');
  assert.equal(branch.nodes.has('q'), false, 'sibling branches keep theirs');
  assert.equal(branch.nodes.has('root'), false);
  const cleared = planBranchColor(summarised, summarisedForest, 'p', null);
  assert.deepEqual([...cleared.nodes.values()], [null, null, null], 'null clears the same cards');
  assert.deepEqual([...cleared.edges.values()], [null, null]);
  const whole = planBranchColor(summarised, summarisedForest, 'root', '5');
  assert.deepEqual([...whole.nodes.keys()].sort(), ['p', 'p1', 'q', 'root', 'sum'], 'the root colours the whole map');
  assert.equal(planBranchColor(summarised, summarisedForest, 'nowhere', '1').nodes.size, 0, 'a card outside any map colours nothing');

  /* ---------- spacing ---------- */
  assert.equal(mapSpacing({}), 'standard');
  assert.equal(mapSpacing({ nfSpacing: 'compact' }), 'compact');
  assert.equal(mapSpacing({ nfSpacing: 'huge' }), 'standard', 'unknown spacing reads as standard');
  assert.deepEqual(spacingGaps('standard'), MAP_GAPS);
  const spaced = spacing => ({
    nodes: [node('r', 0, 0, 100, 40, { nfLayout: 'right', ...(spacing ? { nfSpacing: spacing } : {}) }),
      node('a', 900, 300, 100, 40), node('b', 900, 600, 100, 40)],
    edges: [edge('r', 'a'), edge('r', 'b')],
  });
  const gapsOf = data => {
    const a = data.nodes.find(item => item.id === 'a');
    const b = data.nodes.find(item => item.id === 'b');
    return { main: a.x - 100, cross: b.y - (a.y + a.height) };
  };
  assert.deepEqual(gapsOf(tidy(spaced(), 'r')), MAP_GAPS.horizontal);
  const compact = tidy(spaced('compact'), 'r');
  const roomy = tidy(spaced('roomy'), 'r');
  assert.deepEqual(gapsOf(compact), spacingGaps('compact').horizontal, 'compact maps sit closer');
  assert.deepEqual(gapsOf(roomy), spacingGaps('roomy').horizontal, 'roomy maps breathe');
  assert.ok(gapsOf(compact).main < MAP_GAPS.horizontal.main && gapsOf(roomy).main > MAP_GAPS.horizontal.main);
  assert.deepEqual(gapsOf(tidy(spaced('compact'), 'r', { spacing: 'roomy' })), spacingGaps('roomy').horizontal, 'a planned spacing overrides the stored one');
  const compactTwice = apply(compact, planMapLayout(compact, buildForest(compact), 'r'));
  assert.deepEqual(compactTwice.nodes, compact.nodes, 'spaced layouts are fixed points');
  // Slot recognition follows the map's spacing: a compact child keeps its parent.
  const crossed = { ...compact, edges: [...compact.edges, edge('b', 'a', { id: 'late' })] };
  assert.equal(buildForest(crossed).nodes.get('a').parent, 'r', 'a slot at compact spacing still wins');
  const compactSlot = planMapInsertion(compact, buildForest(compact), 'r', 'child', 100, 40);
  assert.equal(compactSlot.x, 100 + spacingGaps('compact').horizontal.main, 'new cards use the map spacing');

  /* ---------- inserting above, and choosing a side ---------- */
  const around = tidy({
    nodes: [node('r', 0, 0, 100, 40, { nfLayout: 'balanced' }), node('p', 300, -100, 100, 40), node('q', 300, 100, 100, 40), node('l', -300, 0, 100, 40)],
    edges: [edge('r', 'p'), edge('r', 'q'), edge('r', 'l')],
  }, 'r');
  const aroundForest = buildForest(around);
  const aroundAt = id => around.nodes.find(item => item.id === id);
  const above = planMapInsertion(around, aroundForest, 'q', 'before', 100, 40);
  const below = planMapInsertion(around, aroundForest, 'q', 'sibling', 100, 40);
  assert.equal(above.parentId, 'r');
  assert.ok(above.y + 20 < center(aroundAt('q')).y && above.y + 20 > center(aroundAt('p')).y, 'before sorts between the previous sibling and the card');
  assert.ok(below.y + 20 > center(aroundAt('q')).y, 'a sibling goes after');
  assert.equal(planMapInsertion(around, aroundForest, 'r', 'child', 100, 40, 'left').direction, 'left', 'a balanced root can grow on a chosen side');
  assert.equal(planMapInsertion(around, aroundForest, 'r', 'child', 100, 40, 'right').direction, 'right');
  assert.equal(planMapInsertion(around, aroundForest, 'r', 'before', 100, 40), null, 'a root has no siblings');

  /* ---------- arrow keys follow the map ---------- */
  const walk = tidy({
    nodes: [node('r', 0, 0, 120, 40, { nfLayout: 'balanced' }),
      node('p', 300, -200, 80, 40), node('q', 300, 200, 300, 40), node('l', -300, 0, 100, 40),
      node('p1', 600, -300, 100, 40), node('p2', 600, -250, 100, 40), node('q1', 600, 200, 60, 40), node('l1', -600, 0, 100, 40)],
    edges: [edge('r', 'p'), edge('r', 'q'), edge('r', 'l'), edge('p', 'p1'), edge('p', 'p2'), edge('q', 'q1'), edge('l', 'l1')],
  }, 'r');
  const walkForest = buildForest(walk);
  const go = (id, key, hidden) => mapNeighbor(walk, walkForest, id, key, hidden);
  assert.equal(go('p', 'left'), 'r', 'away from the children is the parent');
  assert.equal(go('q', 'left'), 'r', 'even past a narrower sibling');
  assert.equal(go('l', 'right'), 'r', 'on the left side too');
  assert.equal(go('p', 'down'), 'q', 'across is the next sibling');
  assert.equal(go('q', 'up'), 'p');
  assert.equal(go('q', 'down'), null, 'the last sibling stops');
  assert.equal(go('p2', 'down'), 'q1', 'past the siblings comes the cousin');
  assert.ok(['p1', 'p2'].includes(go('p', 'right')), 'toward the children is a child');
  assert.equal(go('r', 'left'), 'l', 'a balanced root reaches either side');
  assert.equal(go('r', 'up'), null);
  assert.equal(go('l', 'left'), 'l1');
  assert.equal(go('p', 'right', new Set(['p1', 'p2'])), null, 'folded children are out of reach');
  assert.equal(go('missing', 'left'), null);
  const downMap = tidy({ nodes: [node('t', 0, 0, 100, 40, { nfLayout: 'down' }), node('u', 0, 200, 100, 40), node('v', 300, 200, 100, 40)], edges: [edge('t', 'u'), edge('t', 'v')] }, 't');
  const downForest = buildForest(downMap);
  assert.equal(mapNeighbor(downMap, downForest, 'u', 'up'), 't', 'vertical maps turn the keys');
  assert.equal(mapNeighbor(downMap, downForest, 'u', 'right'), 'v');
  assert.equal(mapNeighbor(downMap, downForest, 't', 'up'), null);

  /* ---------- tree charts and timelines ---------- */
  const edgeOf = (data, to) => data.edges.find(item => item.toNode === to);
  const sidesOf = (data, to) => [edgeOf(data, to).fromSide, edgeOf(data, to).toSide];
  const find = (data, id) => data.nodes.find(item => item.id === id);
  const assertFixed = (data, rootId, message) => {
    const againChart = apply(data, planMapLayout(data, buildForest(data), rootId));
    assert.deepEqual(againChart.nodes, data.nodes, message);
    assert.deepEqual(againChart.edges, data.edges, message);
  };

  // Tree chart: an indented outline hanging from the root.
  const treeData = {
    nodes: [node('r', 0, 0, 100, 40, { nfLayout: 'tree' }), node('a', 500, 50, 80, 30), node('b', 500, 400, 120, 30),
      node('a1', 900, 100, 60, 30), node('a2', 900, 200, 60, 30), node('c', 500, 900, 80, 30)],
    edges: [edge('r', 'a'), edge('r', 'b'), edge('a', 'a1'), edge('a', 'a2'), edge('r', 'c')],
  };
  const treeForest = buildForest(treeData);
  assert.equal(treeForest.nodes.get('r').flow, 'list');
  assert.equal(treeForest.nodes.get('a').direction, 'list');
  assert.equal(treeForest.nodes.get('a').flow, 'list', 'every level of a tree chart is a list');
  const treeChart = tidy(treeData, 'r');
  const T = id => find(treeChart, id);
  assert.deepEqual([T('r').x, T('r').y], [0, 0], 'the root stays put');
  assert.equal(T('a').x, 0 + 50 + MAP_GAPS.list.indent, 'children indent past the parent\'s middle');
  assert.equal(T('a').y, 40 + MAP_GAPS.list.main, 'and start below it');
  assert.equal(T('a1').x, T('a').x + 40 + MAP_GAPS.list.indent);
  assert.equal(T('a1').y, T('a').y + 30 + MAP_GAPS.list.main);
  assert.equal(T('a2').y, T('a1').y + 30 + MAP_GAPS.list.cross);
  assert.equal(T('b').y, T('a2').y + 30 + MAP_GAPS.list.cross, 'the next sibling comes after the whole branch');
  assert.ok(T('b').y < T('c').y, 'siblings keep their order');
  assert.deepEqual(sidesOf(treeChart, 'a'), ['bottom', 'left'], 'the trunk drops from the parent and turns into each child');
  assertNoOverlap(treeChart.nodes);
  assertFixed(treeChart, 'r', 'a tree chart is a fixed point');
  const treeTidyForest = buildForest(treeChart);
  const slotChart = planMapInsertion(treeChart, treeTidyForest, 'a', 'child', 60, 30);
  assert.deepEqual([slotChart.direction, slotChart.x], ['list', T('a1').x], 'a new child slots into the list');
  assert.ok(slotChart.y > T('a2').y);
  const move = planSiblingMove(treeChart, treeTidyForest, 'b', -1);
  assert.ok(move.y + 15 < T('a').y + 15 + 1 && move.x === T('b').x, 'reordering a list moves up and down');
  const walkTree = (id, key) => mapNeighbor(treeChart, treeTidyForest, id, key);
  assert.equal(walkTree('r', 'down'), 'a', 'down from the root enters the outline');
  assert.equal(walkTree('r', 'right'), 'a');
  assert.equal(walkTree('a', 'down'), 'a1', 'an outline reads row by row');
  assert.equal(walkTree('a2', 'down'), 'b', 'out of a branch to the next row');
  assert.equal(walkTree('b', 'up'), 'a2');
  assert.equal(walkTree('a', 'up'), 'r');
  assert.equal(walkTree('c', 'down'), null, 'the last row stops');
  assert.equal(walkTree('a', 'right'), 'a1', 'right enters the children');
  assert.equal(walkTree('a1', 'left'), 'a', 'left returns to the parent');
  assert.equal(mapNeighbor(treeChart, treeTidyForest, 'a', 'down', new Set(['a1', 'a2'])), 'b', 'folded rows are skipped');

  // Timeline: events along a line, details listed under each event.
  const lineData = {
    nodes: [node('t', 0, 0, 120, 50, { nfLayout: 'timeline' }), node('e1', 300, 0, 100, 40), node('e2', 600, 30, 100, 40),
      node('e3', 900, -30, 140, 40), node('d1', 300, 200, 160, 30), node('d2', 300, 300, 80, 30)],
    edges: [edge('t', 'e1'), edge('t', 'e2'), edge('t', 'e3'), edge('e1', 'd1'), edge('e1', 'd2')],
  };
  const lineForest = buildForest(lineData);
  assert.deepEqual([lineForest.nodes.get('t').flow, lineForest.nodes.get('e1').direction, lineForest.nodes.get('e1').flow, lineForest.nodes.get('d1').direction],
    ['row', 'row', 'list', 'list']);
  const line = tidy(lineData, 't');
  const L = id => find(line, id);
  for (const id of ['e1', 'e2', 'e3']) assert.equal(center(L(id)).y, center(L('t')).y, `${id} sits on the line`);
  assert.equal(L('e1').x, 120 + MAP_GAPS.row.main, 'the first event follows the start');
  const e1Block = Math.max(100, 50 + MAP_GAPS.list.indent + 160);
  assert.equal(L('e2').x, L('e1').x + e1Block + MAP_GAPS.row.cross, 'the next event clears the one before and its details');
  assert.equal(L('e3').x, L('e2').x + 100 + MAP_GAPS.row.cross);
  assert.equal(L('d1').x, L('e1').x + 50 + MAP_GAPS.list.indent, 'details list under their event');
  assert.equal(L('d1').y, L('e1').y + 40 + MAP_GAPS.list.main);
  assert.deepEqual(sidesOf(line, 'e2'), ['right', 'left'], 'events hang on one straight spine');
  assert.deepEqual(sidesOf(line, 'd2'), ['bottom', 'left']);
  assertNoOverlap(line.nodes);
  assertFixed(line, 't', 'a timeline is a fixed point');
  const lineTidyForest = buildForest(line);
  const nextEvent = planMapInsertion(line, lineTidyForest, 't', 'child', 100, 40);
  assert.equal(nextEvent.direction, 'row');
  assert.ok(nextEvent.x > L('e3').x, 'a new event joins the end of the line');
  assert.equal(nextEvent.y + 20, center(L('t')).y);
  const between = planMapInsertion(line, lineTidyForest, 'e1', 'sibling', 100, 40);
  assert.ok(between.x + 50 > center(L('e1')).x && between.x + 50 < center(L('e2')).x, 'Enter adds the next event right after');
  const earlier = planSiblingMove(line, lineTidyForest, 'e2', -1);
  assert.ok(earlier.x + 50 < center(L('e1')).x && earlier.y === L('e2').y, 'events reorder along the line');
  const walkLine = (id, key) => mapNeighbor(line, lineTidyForest, id, key);
  assert.equal(walkLine('t', 'right'), 'e1');
  assert.equal(walkLine('e1', 'right'), 'e2', 'left and right walk the events');
  assert.equal(walkLine('e2', 'left'), 'e1');
  assert.equal(walkLine('e1', 'left'), 't', 'before the first event is the start');
  assert.equal(walkLine('e1', 'down'), 'd1', 'down enters the details');
  assert.equal(walkLine('d1', 'down'), 'd2');
  assert.equal(walkLine('d1', 'up'), 'e1');
  assert.equal(walkLine('d1', 'left'), 'e1');
  assert.equal(walkLine('e2', 'up'), 't', 'up leaves the line');
  assert.equal(walkLine('e3', 'right'), null);
  // A folded event keeps its details with it and the line closes up.
  const lineFolded = { ...line, nodes: line.nodes.map(item => item.id === 'e1' ? { ...item, nfCollapsed: true } : item) };
  const closed = tidy(lineFolded, 't');
  assert.equal(find(closed, 'e2').x, L('e1').x + 100 + MAP_GAPS.row.cross, 'folded details take no room');
  assert.equal(find(closed, 'd1').x - find(closed, 'e1').x, L('d1').x - L('e1').x, 'and travel with their event');
  assert.deepEqual(sidesOf(closed, 'd1'), ['bottom', 'left']);

  // Vertical timeline: events down a line, details as logic charts beside them.
  const columnData = {
    nodes: [node('v', 0, 0, 120, 50, { nfLayout: 'timeline-vertical' }), node('f1', 0, 300, 100, 40), node('f2', 50, 600, 160, 40),
      node('g1', 400, 250, 80, 30), node('g2', 400, 330, 80, 30), node('g3', 400, 420, 80, 30)],
    edges: [edge('v', 'f1'), edge('v', 'f2'), edge('f1', 'g1'), edge('f1', 'g2'), edge('f1', 'g3')],
  };
  const column = tidy(columnData, 'v');
  const C = id => find(column, id);
  for (const id of ['f1', 'f2']) assert.equal(center(C(id)).x, center(C('v')).x, `${id} sits on the vertical line`);
  const f1Top = Math.min(C('f1').y, C('g1').y);
  assert.equal(f1Top, 50 + MAP_GAPS.column.main, 'the first event block starts below the start');
  assert.ok(C('f2').y >= Math.max(C('g3').y + 30, C('f1').y + 40) + MAP_GAPS.column.cross, 'the next event clears the details');
  assert.equal(C('g1').x, C('f1').x + 100 + MAP_GAPS.horizontal.main, 'details grow to the right');
  assert.ok(Math.abs(center(C('f1')).y - (center(C('g1')).y + center(C('g3')).y) / 2) <= 1, 'the event is centred on its details');
  assert.deepEqual(sidesOf(column, 'f2'), ['bottom', 'top']);
  assert.deepEqual(sidesOf(column, 'g2'), ['right', 'left']);
  assertNoOverlap(column.nodes);
  assertFixed(column, 'v', 'a vertical timeline is a fixed point');
  const columnForest = buildForest(column);
  assert.equal(mapNeighbor(column, columnForest, 'v', 'down'), 'f1');
  assert.equal(mapNeighbor(column, columnForest, 'f1', 'down'), 'f2', 'up and down walk the events');
  assert.equal(mapNeighbor(column, columnForest, 'f1', 'up'), 'v');
  assert.equal(mapNeighbor(column, columnForest, 'f1', 'right'), 'g2', 'right enters the details');
  assert.equal(mapNeighbor(column, columnForest, 'g2', 'left'), 'f1');
  assert.equal(planMapInsertion(column, columnForest, 'v', 'child', 100, 40).direction, 'column');

  // Switching structure on the same cards, and spacing applies to the new flows.
  const asTree = tidy(lineData, 't', { layout: 'tree' });
  assertNoOverlap(asTree.nodes);
  assert.deepEqual(sidesOf(asTree, 'e1'), ['bottom', 'left']);
  const compactTree = tidy({ ...treeData, nodes: treeData.nodes.map(item => item.id === 'r' ? { ...item, nfSpacing: 'compact' } : item) }, 'r');
  assert.equal(find(compactTree, 'a').x, 50 + spacingGaps('compact').list.indent);
  // Slot recognition: a cross-link does not steal a card from its list.
  const crossedTree = { ...treeChart, edges: [...treeChart.edges, edge('b', 'a1', { id: 'late' })] };
  assert.equal(buildForest(crossedTree).nodes.get('a1').parent, 'a');
  const crossedLine = { ...line, edges: [...line.edges, edge('e3', 'd1', { id: 'late' })] };
  assert.equal(buildForest(crossedLine).nodes.get('d1').parent, 'e1');

  /* ---------- free cards in every direction ---------- */
  const lone = { nodes: [node('s', 0, 0, 200, 100)], edges: [] };
  const toward = direction => planFreeCard(lone, 's', direction, 200, 100);
  assert.deepEqual(toward('right'), { x: 296, y: 0, fromSide: 'right', toSide: 'left' });
  assert.deepEqual(toward('left'), { x: -296, y: 0, fromSide: 'left', toSide: 'right' });
  assert.deepEqual(toward('down'), { x: 0, y: 172, fromSide: 'bottom', toSide: 'top' });
  assert.deepEqual(toward('up'), { x: 0, y: -172, fromSide: 'top', toSide: 'bottom' });
  const blocked = { nodes: [node('s', 0, 0, 200, 100), node('below', 0, 180, 200, 100)], edges: [] };
  const sideways = planFreeCard(blocked, 's', 'down', 200, 100);
  assert.equal(sideways.y, 172, 'a blocked card keeps its row');
  assert.equal(overlaps({ ...sideways, width: 200, height: 100 }, blocked.nodes[1]), false, 'and slides sideways into open space');
  const boxed = { nodes: [node('box', -50, -50, 900, 400, { type: 'group' }), node('s', 0, 0, 200, 100)], edges: [] };
  const inside = planFreeCard(boxed, 's', 'right', 200, 100);
  assert.equal(inside.y, 0, 'the group holding the card is not an obstacle');
  assert.equal(planFreeCard(lone, 'missing', 'right'), null);
  assert.equal(planFreeCard(lone, 's', 'right', 0, 10), null);

  /* ---------- scale ---------- */
  const count = 20000;
  const deep = { nodes: Array.from({ length: count }, (_, i) => node(String(i), i * 2, 0, 1, 1, i === 0 ? { nfLayout: 'right' } : {})), edges: Array.from({ length: count - 1 }, (_, i) => edge(String(i), String(i + 1))) };
  deep.edges.push(edge(String(count - 1), '0'));
  assert.equal(buildBranch(deep, '0').size, count);
  const deepForest = buildForest(deep);
  assert.equal(deepForest.nodes.size, count, 'deep cyclic maps avoid recursion');
  const deepLayout = planMapLayout(deep, deepForest, '0');
  assert.equal(deepLayout.positions.size, count);
  assert.equal(deepLayout.positions.get(String(count - 1)).x, (count - 1) * (1 + MAP_GAPS.horizontal.main));
  assert.equal(deepLayout.positions.get(String(count - 1)).y, 0);
  const wide = { nodes: [node('root', 0, 0, 100, 40, { nfLayout: 'balanced' }), ...Array.from({ length: 3000 }, (_, i) => node(`w${i}`, (i % 2 ? -1 : 1) * 500, i * 7, 100, 40))], edges: Array.from({ length: 3000 }, (_, i) => edge('root', `w${i}`)) };
  const started = performance.now();
  planMapLayout(wide, buildForest(wide), 'root', { rebalance: true });
  assert.ok(performance.now() - started < 1000, 'wide maps lay out quickly');

  console.log('PASS canvas graph: map forest, relations, groups, eight layouts (tree chart and timelines included), spacing, folding, growth above/below/aside, free cards in four directions, reordering, colours, one branch’s colour, and 20,000-card depth');
} finally {
  await rm(directory, { recursive: true, force: true });
}
