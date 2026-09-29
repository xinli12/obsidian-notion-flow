import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { fakeDocument } from './canvas-fixture.mjs';

// The pure parts of the mind-map components: the connect tool's plans,
// relation lines in the forest, markers, and topic numbering.
const directory = await mkdtemp(join(tmpdir(), 'notion-flow-canvas-components-'));
try {
  const entry = join(directory, 'entry.ts');
  const source = (file) => JSON.stringify(fileURLToPath(new URL(`../src/canvas/${file}`, import.meta.url)));
  await writeFile(entry, [
    `export * from ${source('graph.ts')};`,
    `export * from ${source('connect.ts')};`,
    `export * from ${source('markers.ts')};`,
    `export * from ${source('outline.ts')};`,
    `export * from ${source('tasks.ts')};`,
    `export * from ${source('search.ts')};`,
  ].join('\n'));
  const outfile = join(directory, 'components.mjs');
  await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
    alias: { obsidian: fileURLToPath(new URL('./obsidian-stub.mjs', import.meta.url)) },
  });
  const {
    buildForest, isRelation, RELATION_KEY, planMapLayout, branchLayout, mapAlign, BRANCH_KEY, ALIGN_KEY, MAP_GAPS,
    connectionSides, sideToward, alreadyConnected, planConnection, planChain, previewPath,
    MARKERS, MARKERS_KEY, NUMBERING_KEY, markerById, markersOf, toggleMarker, withMarkers, hasNumbering, topicNumbers,
    EMOJI_PREFIX, EMOJI_LIMIT, COMMON_EMOJI, RECENT_EMOJI_LIMIT, isEmojiId, isSingleGrapheme, emojiMarkerId, emojiOf, rememberEmoji,
    recentEmojiFrom, isMarkerId, markerBadge, MarkerPanel, branchOutline,
    TextCache, findCards, FindBar,
  } = await import(pathToFileURL(outfile).href);

  const node = (id, x = 0, y = 0, width = 200, height = 60, extra = {}) => ({ id, type: 'text', x, y, width, height, text: id, ...extra });
  const edge = (fromNode, toNode, extra = {}) => ({ id: `${fromNode}-${toNode}`, fromNode, toNode, ...extra });

  /* ---------- sides ---------- */
  assert.deepEqual(connectionSides(node('a', 0, 0), node('b', 400, 20)), { fromSide: 'right', toSide: 'left' });
  assert.deepEqual(connectionSides(node('a', 400, 0), node('b', 0, 20)), { fromSide: 'left', toSide: 'right' });
  assert.deepEqual(connectionSides(node('a', 0, 0), node('b', 20, 300)), { fromSide: 'bottom', toSide: 'top' });
  assert.deepEqual(connectionSides(node('a', 0, 300), node('b', 20, 0)), { fromSide: 'top', toSide: 'bottom' });
  assert.equal(sideToward(node('a', 0, 0), { x: 500, y: 30 }), 'right');
  assert.equal(sideToward(node('a', 0, 0), { x: 100, y: -300 }), 'top');

  /* ---------- plans ---------- */
  const free = { nodes: [node('a', 0, 0), node('b', 400, 0), node('c', 0, 300), { ...node('g', -50, -50, 800, 800), type: 'group' }], edges: [] };
  const freeForest = buildForest(free);
  const arrow = planConnection(free, freeForest, 'a', 'b');
  assert.deepEqual(arrow, { kind: 'arrow', edge: { fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left' } }, 'free cards get a plain arrow');
  assert.equal(RELATION_KEY in arrow.edge, false);
  assert.equal(planConnection(free, freeForest, 'a', 'a'), null, 'a card is never joined to itself');
  assert.equal(planConnection(free, freeForest, 'a', 'missing'), null);
  assert.equal(planConnection(free, freeForest, 'a', 'g'), null, 'groups are containers, not cards');
  const joined = { ...free, edges: [edge('b', 'a')] };
  assert.equal(alreadyConnected(joined, 'a', 'b'), true, 'either direction counts');
  assert.equal(planConnection(joined, buildForest(joined), 'a', 'b'), null, 'a second line between the same cards is refused');

  const map = { nodes: [node('root', 0, 0, 200, 60, { nfLayout: 'right' }), node('one', 300, -100), node('two', 300, 100), node('loose', 700, 0)],
    edges: [edge('root', 'one'), edge('root', 'two')] };
  const forest = buildForest(map);
  const relation = planConnection(map, forest, 'one', 'two');
  assert.equal(relation.kind, 'relation');
  assert.equal(relation.edge[RELATION_KEY], true, 'map cards are joined by a relation');
  assert.deepEqual([relation.edge.fromSide, relation.edge.toSide], ['bottom', 'top']);
  assert.equal(planConnection(map, forest, 'two', 'loose').kind, 'relation', 'a map card to a free card is a relation too, so the free card is not adopted');
  assert.equal(isRelation({ ...relation.edge, id: 'r' }), true);
  assert.equal(isRelation({ id: 'x', fromNode: 'a', toNode: 'b', label: 'because' }), true, 'labelled lines stay relations');
  assert.equal(isRelation({ id: 'x', fromNode: 'a', toNode: 'b', label: '  ' }), false);
  assert.equal(isRelation({ id: 'x', fromNode: 'a', toNode: 'b', nfRelation: 'yes' }), false, 'only the boolean flag counts');
  const withRelation = { ...map, edges: [...map.edges, { id: 'r', ...relation.edge }, { id: 'r2', ...planConnection(map, forest, 'two', 'loose').edge }] };
  const after = buildForest(withRelation);
  assert.deepEqual(after.nodes.get('two').parent, 'root', 'a relation never re-parents');
  assert.equal(after.nodes.has('loose'), false, 'a relation never adopts a free card into the map');
  assert.equal(after.edges.has('r'), false);

  const chain = planChain(free, freeForest, ['a', 'b', 'c']);
  assert.deepEqual(chain.map((plan) => [plan.edge.fromNode, plan.edge.toNode]), [['a', 'b'], ['b', 'c']], 'a chain joins each card to the next');
  assert.deepEqual(planChain(joined, buildForest(joined), ['a', 'b', 'c']).map((plan) => [plan.edge.fromNode, plan.edge.toNode]), [['b', 'c']], 'pairs already joined are skipped');
  assert.deepEqual(planChain(free, freeForest, ['a']), []);
  assert.deepEqual(planChain(free, freeForest, ['a', 'b', 'a']).map((plan) => [plan.edge.fromNode, plan.edge.toNode]), [['a', 'b']], 'a chain does not draw the same pair twice');

  const preview = previewPath({ x: 0, y: 0 }, 'right', { x: 200, y: 100 });
  assert.match(preview, /^M0 0 C\d+(\.\d+)? 0 [\d.]+ [\d.]+ 200 100$/, 'a cubic curve that leaves the source side');
  assert.equal(previewPath({ x: 0, y: 0 }, 'top', { x: 0, y: -200 }), 'M0 0 C0 -100 0 -150 0 -200');

  /* ---------- markers ---------- */
  assert.equal(new Set(MARKERS.map((marker) => marker.id)).size, MARKERS.length, 'marker ids are unique');
  for (const marker of MARKERS) assert.ok(marker.icon || marker.text, `${marker.id} has a face`);
  assert.equal(markerById('p1').text, '1');
  assert.deepEqual(markersOf(undefined), []);
  assert.deepEqual(markersOf({ [MARKERS_KEY]: ['star', 'nope', 'star', 3, 'p2'] }), ['star', 'p2'], 'unknown and repeated markers are dropped');
  assert.deepEqual(markersOf({ [MARKERS_KEY]: 'star' }), [], 'only a list counts');
  assert.deepEqual(toggleMarker([], 'star'), ['star']);
  assert.deepEqual(toggleMarker(['star'], 'star'), []);
  assert.deepEqual(toggleMarker(['p1', 'star'], 'p3'), ['star', 'p3'], 'one priority at a time');
  assert.deepEqual(toggleMarker(['flag-red'], 'flag-blue'), ['flag-red', 'flag-blue'], 'flags stack');
  assert.deepEqual(toggleMarker(['star'], 'unknown'), ['star']);
  const card = node('c', 0, 0, 200, 60, { color: '2' });
  assert.deepEqual(withMarkers(card, ['p1']), { ...card, [MARKERS_KEY]: ['p1'] });
  assert.deepEqual(withMarkers({ ...card, [MARKERS_KEY]: ['p1'] }, []), card, 'no markers means no field');

  /* ---------- emoji markers ---------- */
  {
    const id = (char) => `${EMOJI_PREFIX}${char}`;
    assert.equal(EMOJI_PREFIX, 'emoji:');
    for (const char of ['🔥', '👍🏽', '❤️', '🇯🇵', '👩‍💻', '好', 'a']) assert.equal(isSingleGrapheme(char), true, `${char} is one character`);
    for (const text of ['', ' ', '🔥🔥', 'ab', '🔥 ', '👨‍👩‍👧‍👦']) assert.equal(isSingleGrapheme(text), false, `${JSON.stringify(text)} is not one emoji`);
    assert.equal(isEmojiId(id('🔥')), true);
    assert.equal(isEmojiId(id('🔥🔥')), false, 'one emoji per marker');
    assert.equal(isEmojiId('emoji:'), false);
    assert.equal(isEmojiId('star'), false, 'catalogue ids are not emoji');
    assert.equal(isMarkerId('star') && isMarkerId(id('🔥')), true);
    assert.equal(isMarkerId('nope'), false);
    assert.equal(emojiMarkerId('  🚀 '), id('🚀'), 'typed spaces are trimmed');
    assert.equal(emojiMarkerId('🚀🚀'), null);
    assert.equal(emojiMarkerId('a'), null, 'a stray letter is not an emoji');
    assert.equal(emojiMarkerId('好'), id('好'), 'a character outside ASCII is');
    assert.equal(emojiOf(id('🚀')), '🚀');
    assert.deepEqual(markerById(id('🔥')), { id: id('🔥'), group: 'symbol', label: '🔥', text: '🔥', color: 'transparent' }, 'an emoji marker is made up on the spot');
    assert.equal(markerById(id('🔥🔥')), undefined);
    assert.equal(markerById('star').icon, 'star', 'the catalogue is untouched');
    // Round trip: stored, read back, toggled off.
    const topic = node('c', 0, 0, 200, 60);
    const withEmoji = withMarkers(topic, toggleMarker(['star'], id('🔥')));
    assert.deepEqual(withEmoji[MARKERS_KEY], ['star', id('🔥')]);
    assert.deepEqual(markersOf(withEmoji), ['star', id('🔥')], 'an emoji id is kept');
    assert.deepEqual(markersOf({ [MARKERS_KEY]: [id('🔥🔥'), id('🔥'), 'emoji:'] }), [id('🔥')], 'malformed emoji ids are dropped');
    assert.deepEqual(toggleMarker(markersOf(withEmoji), id('🔥')), ['star'], 'and toggles off again');
    // At most three emoji per card; a fourth is refused, and the catalogue is not counted.
    const three = [id('🔥'), 'p1', id('⭐'), id('✅')];
    assert.equal(EMOJI_LIMIT, 3);
    assert.deepEqual(toggleMarker(three, id('🚀')), three, 'a fourth emoji is refused');
    assert.deepEqual(toggleMarker(three, 'star'), [...three, 'star'], 'other markers still stack');
    assert.deepEqual(toggleMarker(three, id('⭐')), [id('🔥'), 'p1', id('✅')], 'an emoji still comes off');
    assert.deepEqual(toggleMarker(toggleMarker(three, id('⭐')), id('🚀')), [id('🔥'), 'p1', id('✅'), id('🚀')], 'making room lets another in');
    // Recents: newest first, no repeats, capped.
    assert.deepEqual(rememberEmoji([], '🔥'), ['🔥']);
    assert.deepEqual(rememberEmoji(['🔥', '⭐'], '⭐'), ['⭐', '🔥'], 'a repeat moves to the front');
    assert.equal(rememberEmoji(Array.from({ length: RECENT_EMOJI_LIMIT }, (_, i) => String.fromCodePoint(0x1F600 + i)), '🔥').length, RECENT_EMOJI_LIMIT, 'capped');
    assert.deepEqual(recentEmojiFrom(['🔥', 3, '🔥🔥', '🔥', '⭐']), ['🔥', '⭐'], 'stored recents are cleaned');
    assert.deepEqual(recentEmojiFrom('🔥'), []);
    assert.equal(COMMON_EMOJI.length, 16);
    assert.equal(new Set(COMMON_EMOJI).size, 16, 'no common emoji twice');
    for (const char of COMMON_EMOJI) assert.equal(isEmojiId(id(char)), true, `${char} can be a marker`);
    // The badge for an emoji is the emoji itself.
    const doc = fakeDocument();
    const badge = markerBadge(doc, markerById(id('🔥')));
    assert.equal(badge.textContent, '🔥');
    assert.ok(badge.classList.contains('is-text') && badge.classList.contains('is-emoji'));
    assert.equal(badge.getAttribute('aria-label'), '🔥');
    assert.equal(markerBadge(doc, markerById('p1')).classList.contains('is-emoji'), false);
    // Outlines carry the words, never the markers.
    const mapped = { nodes: [node('root', 0, 0, 200, 60, { nfLayout: 'right' }), { ...withEmoji, x: 300 }], edges: [edge('root', 'c')] };
    assert.equal(branchOutline(mapped, buildForest(mapped), 'root').markdown, '- root\n\t- c', 'markers stay out of the outline');

    // The picker's last section: an input, the recents, and the common set.
    const marked = new Map([['c', ['star']]]);
    const saved = [];
    const host = {
      state: () => {
        const all = new Set(marked.get('c') ?? []);
        return { all, some: new Set(all), count: marked.size };
      },
      toggle: (mid) => { marked.set('c', toggleMarker(marked.get('c') ?? [], mid)); },
      clear: () => { marked.set('c', []); },
      close() {},
      recentEmoji: { load: () => ['⭐', 'bad', '🍕'], save: (ids) => { saved.push([...ids]); } },
    };
    const panel = new MarkerPanel(doc, host);
    const emojiOptions = () => panel.el.querySelectorAll('.nf-canvas-emoji-option').map((button) => button.dataset.marker);
    assert.equal(panel.el.querySelectorAll('.nf-canvas-marker-option').length, MARKERS.length, 'the catalogue keeps its own buttons');
    const recentRow = panel.el.querySelector('.nf-canvas-emoji-recent');
    const recentIn = () => recentRow.querySelectorAll('.nf-canvas-emoji-option').map((button) => button.dataset.marker);
    assert.deepEqual(recentIn(), [id('⭐'), id('🍕')], 'stored recents come back, cleaned');
    assert.equal(recentRow.hidden, false);
    assert.deepEqual(emojiOptions().slice(-16), COMMON_EMOJI.map(id), 'the common set follows');
    const input = panel.el.querySelector('.nf-canvas-emoji-input');
    assert.equal(input.getAttribute('aria-label'), 'Type an emoji');
    input.value = '🔥';
    input.dispatch('input', { isComposing: false });
    assert.deepEqual(marked.get('c'), ['star', id('🔥')], 'a typed emoji goes on the card at once');
    assert.equal(input.value, '', 'and the field is ready for the next');
    assert.deepEqual(saved.at(-1), ['🔥', '⭐', '🍕'], 'it is remembered');
    assert.deepEqual(recentIn(), [id('🔥'), id('⭐'), id('🍕')]);
    assert.equal(recentRow.querySelectorAll('.nf-canvas-emoji-option')[0].getAttribute('aria-pressed'), 'true');
    input.value = 'ab';
    input.dispatch('input', { isComposing: false });
    assert.equal(input.value, 'ab', 'text that is not an emoji is left to correct');
    assert.deepEqual(marked.get('c'), ['star', id('🔥')]);
    const enter = input.dispatch('keydown', { key: 'Enter', isComposing: false });
    assert.equal(enter.defaultPrevented, true);
    assert.equal(input.classList.contains('is-invalid'), true, 'Enter on it says so');
    // A common emoji is a click away, and comes off with another.
    const common = (char) => panel.el.querySelectorAll('.nf-canvas-emoji-option').find((button) => button.dataset.marker === id(char));
    common('✅').dispatch('click');
    assert.deepEqual(marked.get('c'), ['star', id('🔥'), id('✅')]);
    assert.equal(common('✅').getAttribute('aria-pressed'), 'true');
    common('✅').dispatch('click');
    assert.deepEqual(marked.get('c'), ['star', id('🔥')]);
    assert.equal(common('✅').getAttribute('aria-pressed'), 'false');
    // An emoji a card carries from elsewhere leads the recents, so it can be taken off.
    marked.set('c', [id('🎲')]);
    panel.sync();
    assert.equal(recentIn()[0], id('🎲'));
    assert.equal(recentRow.querySelectorAll('.nf-canvas-emoji-option')[0].getAttribute('aria-pressed'), 'true');
    recentRow.querySelectorAll('.nf-canvas-emoji-option')[0].dispatch('click');
    assert.deepEqual(marked.get('c'), []);
    // Without recents the row is out of the way.
    const bare = new MarkerPanel(doc, { ...host, recentEmoji: undefined, state: () => ({ all: new Set(), some: new Set(), count: 0 }) });
    const bareRow = bare.el.querySelector('.nf-canvas-emoji-recent');
    assert.equal(bareRow.hidden, true);
    assert.ok(bareRow.classList.contains('is-empty'));
    bare.destroy();
    panel.destroy();
  }

  /* ---------- numbering ---------- */
  const numbered = { nodes: [
    node('root', 0, 0, 200, 60, { nfLayout: 'right', [NUMBERING_KEY]: true }),
    node('b', 300, 200), node('a', 300, -200), node('a1', 600, -250), node('a2', 600, -150), node('a2x', 900, -150),
    node('free', 0, 800), node('other', 0, 1200, 200, 60, { nfLayout: 'right' }), node('otherChild', 300, 1200),
  ], edges: [edge('root', 'a'), edge('root', 'b'), edge('a', 'a1'), edge('a', 'a2'), edge('a2', 'a2x'), edge('other', 'otherChild')] };
  assert.equal(hasNumbering(numbered.nodes[0]), true);
  assert.equal(hasNumbering({ [NUMBERING_KEY]: 'true' }), false);
  const numbers = topicNumbers(numbered, buildForest(numbered));
  assert.deepEqual(Object.fromEntries(numbers), { a: '1', b: '2', a1: '1.1', a2: '1.2', a2x: '1.2.1' }, 'reading order, root unnumbered, other maps untouched');
  assert.equal(numbers.has('otherChild'), false, 'a map without numbering shows none');

  /* ---------- branch structures and alignment ---------- */
  {
    const apply = (data, plan) => ({ ...data, nodes: data.nodes.map((item) => plan.positions.has(item.id) ? { ...item, ...plan.positions.get(item.id) } : item) });
    const at = (data, id) => data.nodes.find((item) => item.id === id);
    const base = () => ({ nodes: [
      node('root', 0, 0, 200, 60, { nfLayout: 'right' }),
      node('a', 300, -200), node('a1', 600, -260), node('a2', 600, -140), node('a1x', 900, -260),
      node('b', 300, 200), node('b1', 600, 200),
    ], edges: [edge('root', 'a'), edge('a', 'a1'), edge('a', 'a2'), edge('a1', 'a1x'), edge('root', 'b'), edge('b', 'b1')] });
    assert.equal(branchLayout({ [BRANCH_KEY]: 'down' }), 'down');
    assert.equal(branchLayout({ [BRANCH_KEY]: 'balanced' }), null, 'a branch cannot grow both ways');
    assert.equal(branchLayout({ [BRANCH_KEY]: 'zigzag' }), null);
    assert.equal(mapAlign({ [ALIGN_KEY]: 'start' }), 'start');
    assert.equal(mapAlign({}), 'center');
    const plain = base();
    const plainForest = buildForest(plain);
    assert.deepEqual([plainForest.nodes.get('a').structure, plainForest.nodes.get('a').level, plainForest.nodes.get('a1x').level], ['right', 1, 3]);
    // Branch a follows an org chart: its children go down, and so do theirs.
    const mixed = { ...plain, nodes: plain.nodes.map((item) => item.id === 'a' ? { ...item, [BRANCH_KEY]: 'down' } : item) };
    const forest = buildForest(mixed);
    assert.deepEqual([forest.nodes.get('a').structure, forest.nodes.get('a').level, forest.nodes.get('a').flow], ['down', 0, 'down']);
    assert.deepEqual([forest.nodes.get('a1').direction, forest.nodes.get('a1').flow, forest.nodes.get('a1').level], ['down', 'down', 1], 'the branch\'s children hang below it and keep the flow');
    assert.deepEqual([forest.nodes.get('b').flow, forest.nodes.get('b1').direction], ['right', 'right'], 'the other branch follows the map');
    const laid = apply(mixed, planMapLayout(mixed, forest, 'root'));
    assert.ok(at(laid, 'a1').y >= at(laid, 'a').y + 60 + MAP_GAPS.vertical.main - 1, 'a\'s children are placed below it');
    assert.ok(at(laid, 'a2').y === at(laid, 'a1').y && at(laid, 'a2').x > at(laid, 'a1').x, 'side by side');
    assert.ok(at(laid, 'a1x').y > at(laid, 'a1').y, 'and their children below them');
    assert.ok(at(laid, 'b1').x > at(laid, 'b').x + 200 && Math.abs(at(laid, 'b1').y - at(laid, 'b').y) < 1, 'b still grows right');
    // A tree branch inside a mind map: an indented outline.
    const outline = { ...plain, nodes: plain.nodes.map((item) => item.id === 'a' ? { ...item, [BRANCH_KEY]: 'tree' } : item) };
    const outlined = apply(outline, planMapLayout(outline, buildForest(outline), 'root'));
    assert.equal(at(outlined, 'a1').x, at(outlined, 'a').x + 100 + MAP_GAPS.list.indent, 'indented past the branch\'s middle');
    assert.ok(at(outlined, 'a2').y > at(outlined, 'a1').y, 'one below another');
    assert.ok(at(outlined, 'a1x').x > at(outlined, 'a1').x, 'deeper items indent further');
    // A layout applied as an option keeps the branch structure.
    const asOrg = apply(mixed, planMapLayout(mixed, forest, 'root', { layout: 'down' }));
    assert.ok(at(asOrg, 'b').y > at(asOrg, 'root').y + 60, 'the map itself goes down');
    assert.ok(at(asOrg, 'a1').y > at(asOrg, 'a').y + 60, 'and so does the branch');
    // Alignment: from the start, the first child's card lines up with the parent's top.
    const centred = apply(plain, planMapLayout(plain, plainForest, 'root'));
    assert.ok(at(centred, 'a').y < at(centred, 'root').y && at(centred, 'b').y > at(centred, 'root').y, 'centred branches surround the centre');
    const started = apply(plain, planMapLayout(plain, plainForest, 'root', { align: 'start' }));
    assert.equal(at(started, 'a').y, at(started, 'root').y, 'the first branch starts level with the centre');
    assert.equal(at(started, 'a1').y, at(started, 'a').y, 'and so does each first child');
    assert.ok(at(started, 'b').y > at(started, 'a').y, 'the rest follow below');
    const stored = { ...plain, nodes: plain.nodes.map((item) => item.id === 'root' ? { ...item, [ALIGN_KEY]: 'start' } : item) };
    const fromField = apply(stored, planMapLayout(stored, buildForest(stored), 'root'));
    assert.equal(at(fromField, 'a').y, at(fromField, 'root').y, 'the root stores the alignment');
  }

  /* ---------- results kept by text ---------- */
  {
    let computed = 0;
    const cache = new TextCache((text) => { computed++; return text.length; }, 2);
    assert.equal(cache.get('ab'), 2);
    assert.equal(cache.get('ab'), 2);
    assert.equal(computed, 1, 'the same text is worked out once');
    cache.get('abc');
    cache.get('abcd');
    assert.equal(cache.size, 2, 'the oldest entry makes room');
    assert.equal(cache.get('ab'), 2);
    assert.equal(computed, 4, 'and is worked out again when asked for');
    cache.clear();
    assert.equal(cache.size, 0);
  }

  /* ---------- finding cards by their words ---------- */
  {
    const cards = [
      node('late', 0, 300, 200, 60, { text: 'Plan **B**' }),
      node('right', 400, 0, 200, 60, { text: 'plan a' }),
      node('left', 0, 0, 200, 60, { text: '# Planning' }),
      node('other', 0, 600, 200, 60, { text: 'Budget' }),
      { id: 'group', type: 'group', x: 0, y: 900, width: 400, height: 200, label: 'Plans for later' },
      { id: 'note', type: 'file', x: 0, y: 1200, width: 200, height: 60, file: 'Notes/Plan.md' },
    ];
    assert.deepEqual(findCards(cards, 'PLAN'), ['left', 'right', 'late', 'group', 'note'], 'case does not matter; the order is top to bottom, then left to right');
    assert.deepEqual(findCards(cards, ' plan b '), ['late'], 'Markdown marks are not words');
    assert.deepEqual(findCards(cards, ''), []);
    assert.deepEqual(findCards(cards, '   '), [], 'blank words match nothing');
    assert.deepEqual(findCards(cards, 'budget', (item) => item.id), [], 'the words can come from elsewhere');
    assert.deepEqual(findCards(cards, 'oth', (item) => item.id), ['other']);
  }

  /* ---------- the find bar ---------- */
  {
    const doc = fakeDocument();
    const calls = [];
    const bar = new FindBar(doc, { search: (query) => calls.push(['search', query]), step: (delta) => calls.push(['step', delta]), close: () => calls.push(['close']) });
    assert.equal(bar.el.className, 'nf-canvas-find nf-canvas-ui');
    assert.equal(bar.el.getAttribute('role'), 'search');
    const input = bar.el.querySelector('input');
    assert.equal(input.getAttribute('aria-label'), 'Find in map');
    assert.equal(input.title, undefined, 'one tooltip');
    assert.deepEqual(['.nf-canvas-find-previous', '.nf-canvas-find-next', '.nf-canvas-find-close'].map((cls) => bar.el.querySelector(cls).getAttribute('aria-label')),
      ['Previous match', 'Next match', 'Close']);
    input.value = 'pla'; input.dispatch('input');
    input.value = 'plan'; input.dispatch('input', { isComposing: true });
    input.dispatch('compositionend');
    assert.deepEqual(calls.splice(0), [['search', 'pla'], ['search', 'plan']], 'words are searched as typed, once a composition ends');
    const enter = bar.el.dispatch('keydown', { key: 'Enter', shiftKey: false, isComposing: false, preventDefault() { this.defaultPrevented = true; } });
    assert.equal(enter.defaultPrevented, true);
    bar.el.dispatch('keydown', { key: 'Enter', shiftKey: true, isComposing: false, preventDefault() {} });
    bar.el.dispatch('keydown', { key: 'Enter', shiftKey: false, isComposing: true, preventDefault() {} });
    bar.el.querySelector('.nf-canvas-find-next').dispatch('click');
    bar.el.querySelector('.nf-canvas-find-previous').dispatch('click');
    bar.el.dispatch('keydown', { key: 'Escape', isComposing: false, preventDefault() {} });
    bar.el.querySelector('.nf-canvas-find-close').dispatch('click');
    assert.deepEqual(calls.splice(0), [['step', 1], ['step', -1], ['step', 1], ['step', -1], ['close'], ['close']], 'Enter walks on, Shift+Enter back, Escape closes; a composition is left alone');
    const count = bar.el.querySelector('.nf-canvas-find-count');
    bar.sync({ query: '', total: 0, index: 0, folded: 0 });
    assert.equal(count.textContent, '', 'no words, no count');
    assert.equal(bar.el.classList.contains('is-missing'), false);
    bar.sync({ query: 'plan', total: 3, index: 2, folded: 1 });
    assert.equal(count.textContent, '2 of 3 · 1 folded');
    assert.equal(bar.el.querySelector('.nf-canvas-find-next').disabled, false);
    bar.sync({ query: 'plan', total: 3, index: 0, folded: 0 });
    assert.equal(count.textContent, '0 of 3', 'none is current until Enter');
    bar.sync({ query: 'zzz', total: 0, index: 0, folded: 0 });
    assert.equal(count.textContent, '0 of 0');
    assert.equal(bar.el.classList.contains('is-missing'), true, 'words that match nothing are said so');
    assert.equal(bar.el.querySelector('.nf-canvas-find-previous').disabled, true);
    doc.body.append(bar.el);
    bar.focus();
    assert.equal(doc.activeElement, input);
    bar.destroy();
    assert.equal(bar.el.parentElement, null);
  }

  console.log('PASS canvas components: connection plans, relation lines, markers, emoji markers, numbering, branch structures, alignment, text cache, and the find bar');
} finally {
  await rm(directory, { recursive: true, force: true });
}
