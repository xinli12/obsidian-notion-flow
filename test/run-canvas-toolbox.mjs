import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { nodeData, edgeData, keyEvent, fixture } from './canvas-fixture.mjs';

// The toolbar's grouped, labelled buttons; the connect tool; markers and
// numbering; the guide; and Enter/Tab while typing a topic.
const directory = await mkdtemp(join(tmpdir(), 'notion-flow-canvas-toolbox-'));
try {
  const outfile = join(directory, 'enhancements.mjs');
  await build({ entryPoints: [fileURLToPath(new URL('../src/canvas/enhancements.ts', import.meta.url))], bundle: true,
    alias: { obsidian: fileURLToPath(new URL('./obsidian-stub.mjs', import.meta.url)) },
    format: 'esm', platform: 'node', outfile, logLevel: 'silent' });
  const { CanvasEnhancements } = await import(pathToFileURL(outfile).href);

  const map = () => ({ nodes: [
    nodeData('root', 0, 0, { nfLayout: 'right' }), nodeData('a', 400, -200), nodeData('b', 400, 200), nodeData('a1', 800, -200),
    nodeData('free', 0, 900), nodeData('free2', 600, 900),
  ], edges: [edgeData('e-a', 'root', 'a'), edgeData('e-b', 'root', 'b'), edgeData('e-a1', 'a', 'a1')] });
  const pointer = (canvas, id, extra = {}) => {
    const rect = canvas.nodes.get(id).getData();
    return { clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, pointerType: 'mouse', pointerId: 1, button: 0, isPrimary: true, ...extra };
  };
  // The toolbar's buttons, named with their shortcut ("Add child · Tab"); cards carry "+" buttons with the same names.
  const tb = (f, label) => f.canvas.wrapperEl.querySelector('.nf-canvas-toolbar').querySelectorAll('button').find((item) => (item.getAttribute('aria-label') ?? '').split(' · ')[0] === label);
  // The passive summary in the toolbar, and the pill under it that says what is going on.
  const statusOf = (f) => f.canvas.wrapperEl.querySelector('.nf-canvas-status');
  const hintOf = (f) => f.canvas.wrapperEl.querySelector('.nf-canvas-hint');
  const svgLayer = (f) => {
    const layer = f.doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    f.canvas.wrapperEl.append(layer);
    f.canvas.edgeContainerEl = layer;
    return layer;
  };

  /* ---------- toolbar ---------- */
  {
    const f = fixture(CanvasEnhancements, map());
    const toolbar = f.canvas.wrapperEl.querySelector('.nf-canvas-toolbar');
    const labels = toolbar.querySelectorAll('button').map((button) => button.getAttribute('aria-label'));
    assert.deepEqual(labels, ['New topic', 'Add sibling · Enter / Alt+Enter', 'Connect', 'Layout', 'Style', 'Markers', 'Note · F4', 'Link · Ctrl+K', 'Summary', 'Fold branch · Ctrl+/', 'Focus branch', 'Find card · Ctrl+F', 'Present', 'More', 'Guide'],
      'grouped: grow, structure, view, tools, more; names carry the shortcut as it is typed here');
    assert.ok(toolbar.querySelectorAll('button').every((button) => button.title === undefined && button.getAttribute('data-tooltip-position') === 'bottom'),
      'one tooltip per button, drawn from its name, under it');
    for (const label of ['New topic', 'Add sibling', 'Connect', 'Layout', 'Style', 'Markers']) {
      assert.equal(tb(f, label).querySelector('.nf-canvas-action-text')?.textContent, label, `${label} is labelled`);
      assert.ok(tb(f, label).classList.contains('nf-canvas-action-labelled'));
    }
    assert.equal(tb(f, 'Fold branch').querySelector('.nf-canvas-action-text'), null, 'view buttons show icons only');
    assert.ok(tb(f, 'Layout').classList.contains('nf-canvas-action-separated'), 'a hairline before each group');
    assert.ok(tb(f, 'Add sibling').classList.contains('nf-canvas-action-separated') === false);
    assert.equal(tb(f, 'Minimap'), undefined, 'the minimap toggle moved to More');
    assert.equal(tb(f, 'Show all'), undefined, 'Show all replaces Focus while a branch is focused');
    assert.equal(tb(f, 'New topic').disabled, false, 'with nothing selected the first button starts a topic');
    assert.equal(tb(f, 'Connect').disabled, true);
    assert.equal(tb(f, 'Markers').disabled, true);
    assert.equal(tb(f, 'Guide').disabled, false);
    assert.equal(statusOf(f).textContent, 'Select a card, or start a new topic');
    assert.equal(hintOf(f).textContent, '', 'nothing is going on');
    assert.ok(hintOf(f).classList.contains('is-empty') && hintOf(f).classList.contains('nf-canvas-ui'));

    f.canvas.selectOnly(f.canvas.nodes.get('a')); f.doc.flush();
    assert.equal(tb(f, 'New topic'), undefined);
    assert.equal(tb(f, 'Add child').disabled, false, 'with a card selected the first button grows it');
    assert.equal(tb(f, 'Add child').querySelector('.nf-canvas-action-text').textContent, 'Add child');
    assert.equal(tb(f, 'Add child').querySelector('.nf-canvas-action-glyph').dataset.icon, 'corner-down-right');
    assert.equal(tb(f, 'Connect').disabled, false);
    assert.equal(tb(f, 'Markers').disabled, false);
    assert.equal(tb(f, 'Fold branch').getAttribute('aria-pressed'), 'false');
    assert.equal(tb(f, 'Add child').getAttribute('aria-label'), 'Add child · Tab', 'the name carries the shortcut');
    assert.equal(tb(f, 'Add child').getAttribute('aria-keyshortcuts'), 'Tab', 'the raw chord stays for assistive technology');
    assert.equal(tb(f, 'Add sibling').getAttribute('aria-label'), 'Add sibling · Enter / Alt+Enter', 'Enter adds a sibling');
    assert.equal(tb(f, 'Add sibling').getAttribute('aria-keyshortcuts'), 'Enter / Alt+Enter');
    assert.match(statusOf(f).textContent, /^Mind map · .+ · 4$/, 'the status sums up the map');
    f.canvas.selectOnly(f.canvas.nodes.get('free')); f.doc.flush();
    assert.equal(tb(f, 'Add sibling').getAttribute('aria-keyshortcuts'), 'Enter / Alt+Enter', 'Enter adds the next card beside a free card too');
    assert.equal(tb(f, 'Add sibling').disabled, false, 'a card of its own gets the next card below it');
    assert.equal(statusOf(f).textContent, 'Enter: next card · Tab: child');
    f.settings.canvasKeyboard = false; f.manager.refresh(); f.doc.flush();
    assert.equal(tb(f, 'Add sibling').getAttribute('aria-label'), 'Add sibling', 'no shortcut while the canvas keys are off');
    assert.equal(tb(f, 'Add sibling').getAttribute('aria-keyshortcuts'), '');
    f.settings.canvasKeyboard = true;
    f.canvas.selectOnly(f.canvas.nodes.get('a')); f.doc.flush();
    assert.equal(tb(f, 'Add child').getAttribute('aria-label'), 'Add child · Tab', 'the name is rebuilt from the plain label, never from itself');

    f.command('focus'); f.doc.flush();
    assert.equal(tb(f, 'Focus branch'), undefined);
    assert.equal(tb(f, 'Show all').getAttribute('aria-pressed'), 'true', 'Focus becomes Show all while focused');
    assert.equal(tb(f, 'Show all').querySelector('.nf-canvas-action-glyph').dataset.icon, 'maximize');
    tb(f, 'Show all').dispatch('click'); f.doc.flush();
    assert.equal(tb(f, 'Focus branch').getAttribute('aria-pressed'), 'false');

    f.command('fold'); f.doc.flush();
    assert.equal(tb(f, 'Unfold branch').getAttribute('aria-pressed'), 'true', 'the fold button names what it will do');
    f.command('fold'); f.doc.flush();
    assert.equal(tb(f, 'Fold branch').getAttribute('aria-pressed'), 'false');

    // The floating menu above the card holds only the frequent actions.
    const menuEl = f.doc.createElement('div');
    f.canvas.menu = { menuEl, render() { this.renders = (this.renders ?? 0) + 1; } };
    f.manager.refresh(); f.doc.flush();
    const quick = menuEl.querySelectorAll('.nf-canvas-menu-action').map((button) => button.dataset.action);
    assert.deepEqual(quick, ['child', 'sibling', 'connect', 'fold', 'markers', 'note', 'link']);
    assert.deepEqual(menuEl.querySelectorAll('.nf-canvas-menu-action').map((button) => button.getAttribute('aria-label')),
      ['Add child (Tab)', 'Add sibling (Enter)', 'Connect', 'Fold branch (Ctrl+/)', 'Markers', 'Note (F4)', 'Link (Ctrl+K)'], 'menu names show the shortcut as typed here');
    f.manager.destroy();
  }

  /* ---------- new topic ---------- */
  {
    const f = fixture(CanvasEnhancements, map());
    const before = f.canvas.nodes.size;
    f.canvas.getViewportBBox = () => ({ minX: 1000, minY: 1000, maxX: 1400, maxY: 1300 });
    assert.equal(f.command('newTopic', true), true);
    assert.equal(f.command('child', true), false);
    tb(f, 'New topic').dispatch('click'); f.doc.flush();
    assert.equal(f.canvas.nodes.size, before + 1);
    const created = [...f.canvas.nodes.values()].find((node) => !map().nodes.some((item) => item.id === node.id));
    assert.deepEqual([created.getData().x, created.getData().y, created.getData().text], [1200 - 120, 1150 - 30, ''], 'centred in the view');
    assert.equal(created.isEditing, true, 'ready to type into');
    assert.equal([...f.canvas.selection][0], created);
    f.canvas.undo(); f.manager.refresh(); f.doc.flush();
    assert.equal(f.canvas.nodes.size, before, 'one undo removes it');
    f.canvas.redo(); f.manager.refresh(); f.doc.flush();
    // A second topic avoids the first (redo rebuilt it as a new object).
    const first = f.canvas.nodes.get(created.id);
    f.canvas.selection.clear(); f.manager.refresh(); f.doc.flush();
    first.isEditing = false;
    f.command('newTopic'); f.doc.flush();
    const second = [...f.canvas.nodes.values()].find((node) => node.id !== first.id && !map().nodes.some((item) => item.id === node.id));
    assert.ok(second.getData().y > first.getData().y + 60, 'a new topic steps below one already in the middle');
    f.manager.destroy();
  }

  /* ---------- connect: several selected cards ---------- */
  {
    const f = fixture(CanvasEnhancements, map());
    f.canvas.selectAll([f.canvas.nodes.get('free'), f.canvas.nodes.get('free2')]); f.manager.refresh(); f.doc.flush();
    assert.equal(hintOf(f).textContent, '2 cards selected · Fold, Focus and Connect act on all of them', 'the pill says what a selection can do');
    assert.equal(hintOf(f).classList.contains('is-empty'), false);
    assert.equal(statusOf(f).textContent, '', 'free cards have no map to sum up');
    const step = f.canvas.history.current;
    assert.equal(f.command('connect', true), true);
    tb(f, 'Connect').dispatch('click'); f.doc.flush();
    const arrow = [...f.canvas.edges.values()].map((edge) => edge.getData()).find((edge) => edge.fromNode === 'free' && edge.toNode === 'free2');
    assert.deepEqual([arrow.fromSide, arrow.toSide, arrow.nfRelation, arrow.label], ['right', 'left', undefined, undefined], 'free cards get a plain arrow');
    assert.equal(f.canvas.history.current, step + 1, 'one undo step');
    tb(f, 'Connect').dispatch('click'); f.doc.flush();
    assert.equal(f.canvas.edges.size, 4, 'already joined cards are not joined again');

    f.canvas.selectAll([f.canvas.nodes.get('a1'), f.canvas.nodes.get('b'), f.canvas.nodes.get('free')]); f.manager.refresh(); f.doc.flush();
    f.command('connect'); f.doc.flush();
    const relations = [...f.canvas.edges.values()].map((edge) => edge.getData()).filter((edge) => edge.nfRelation === true);
    assert.deepEqual(relations.map((edge) => [edge.fromNode, edge.toNode]), [['a1', 'b'], ['b', 'free']], 'a chain in selection order; map cards get relations');
    assert.equal(f.canvas.nodes.get('b').nodeEl.classList.contains('nf-canvas-map-node'), true);
    assert.equal(f.canvas.nodes.get('free').nodeEl.classList.contains('nf-canvas-map-node'), false, 'a relation does not adopt the free card');
    for (const edge of f.canvas.edges.values()) {
      const relation = edge.getData().nfRelation === true;
      assert.equal(edge.lineGroupEl.classList.contains('nf-canvas-relation'), relation, `${edge.getData().id} relation class`);
      assert.equal(edge.lineGroupEl.classList.contains('nf-canvas-map-edge'), !relation && edge.getData().fromNode !== 'free');
    }
    f.canvas.undo(); f.manager.refresh(); f.doc.flush();
    assert.equal([...f.canvas.edges.values()].some((edge) => edge.getData().nfRelation), false, 'one undo removes the whole chain');
    f.manager.destroy();
  }

  /* ---------- connect: the tool ---------- */
  {
    const f = fixture(CanvasEnhancements, map());
    const layer = svgLayer(f);
    f.canvas.selectOnly(f.canvas.nodes.get('a')); f.doc.flush();
    f.canvas.wrapperEl.dispatch('pointermove', pointer(f.canvas, 'a')); f.doc.flush();
    tb(f, 'Connect').dispatch('click'); f.doc.flush();
    assert.equal(f.canvas.wrapperEl.classList.contains('nf-canvas-connecting'), true);
    assert.equal(tb(f, 'Cancel connecting').getAttribute('aria-pressed'), 'true');
    assert.equal(hintOf(f).textContent, 'Click the card to connect to · Esc cancels');
    assert.match(statusOf(f).textContent, /^Mind map · /, 'the status keeps the passive summary');
    const line = layer.querySelector('.nf-canvas-connect-line');
    assert.ok(line, 'a preview line lives in the connection layer');
    f.canvas.wrapperEl.dispatch('pointermove', pointer(f.canvas, 'b')); f.doc.flush();
    assert.equal(f.canvas.nodes.get('b').nodeEl.classList.contains('nf-canvas-connect-target'), true, 'the card under the pointer is the destination');
    assert.match(line.getAttribute('d'), /^M530 -80 C/, 'the preview leaves the bottom of a, which faces b');
    assert.match(line.getAttribute('d'), / 530 200$/, 'and ends at the top of b');
    f.canvas.wrapperEl.dispatch('pointermove', { clientX: 2000, clientY: 2000, pointerType: 'mouse' }); f.doc.flush();
    assert.equal(f.canvas.nodes.get('b').nodeEl.classList.contains('nf-canvas-connect-target'), false);
    assert.match(line.getAttribute('d'), / 2000 2000$/, 'over empty canvas the preview follows the pointer');

    // Escape leaves the tool without touching the canvas.
    const saves = f.canvas.saves;
    const escape = f.canvas.wrapperEl.dispatch('keydown', keyEvent('Escape', f.canvas.wrapperEl));
    assert.equal(escape.defaultPrevented, true);
    f.doc.flush();
    assert.equal(f.canvas.wrapperEl.classList.contains('nf-canvas-connecting'), false);
    assert.equal(layer.querySelector('.nf-canvas-connect-line'), null);
    assert.equal(hintOf(f).textContent, '', 'the pill empties with the tool');
    assert.equal(f.canvas.saves, saves);
    assert.equal(f.canvas.edges.size, 3);

    // A click on a card joins it; the selection moves to the new line.
    tb(f, 'Connect').dispatch('click'); f.doc.flush();
    const step = f.canvas.history.current;
    let selected = null;
    f.canvas.selectOnly = (item) => { selected = item; };
    const down = f.canvas.wrapperEl.dispatch('pointerdown', { ...pointer(f.canvas, 'b'), target: f.canvas.nodes.get('b').nodeEl });
    assert.equal(down.defaultPrevented, true, 'Canvas does not also select or drag');
    f.doc.flush();
    const relation = [...f.canvas.edges.values()].map((edge) => edge.getData()).find((edge) => edge.fromNode === 'a' && edge.toNode === 'b');
    assert.deepEqual([relation.fromSide, relation.toSide, relation.nfRelation], ['bottom', 'top', true]);
    assert.equal(f.canvas.wrapperEl.classList.contains('nf-canvas-connecting'), false, 'the tool ends after one connection');
    assert.equal(f.canvas.history.current, step + 1);
    assert.equal(selected, null, 'a line without select() is left unselected');
    // Canvas's lines can be selected; the stand-in's gain that now.
    Object.getPrototypeOf(f.canvas.edges.get(relation.id)).select = function () {};
    f.canvas.selectOnly = (item) => { selected = item; };
    f.canvas.selectAll([f.canvas.nodes.get('a1')]); f.manager.refresh(); f.doc.flush();
    f.command('connect'); f.doc.flush();
    f.canvas.wrapperEl.dispatch('pointerdown', { ...pointer(f.canvas, 'free'), target: f.canvas.nodes.get('free').nodeEl }); f.doc.flush();
    assert.equal(selected?.getData?.().toNode, 'free', 'a selectable line is selected');
    assert.equal(f.canvas.nodes.get('free').nodeEl.classList.contains('nf-canvas-map-node'), false);

    // A click on empty canvas cancels; a click on the source does nothing.
    f.canvas.selectAll([f.canvas.nodes.get('b')]); f.manager.refresh(); f.doc.flush();
    f.command('connect'); f.doc.flush();
    f.canvas.wrapperEl.dispatch('pointerdown', { clientX: 3000, clientY: 3000, pointerType: 'mouse', pointerId: 1, button: 0, isPrimary: true, target: f.canvas.wrapperEl }); f.doc.flush();
    assert.equal(f.canvas.wrapperEl.classList.contains('nf-canvas-connecting'), false);
    assert.equal(f.canvas.edges.size, 5);
    f.command('connect'); f.doc.flush();
    f.canvas.wrapperEl.dispatch('pointerdown', { ...pointer(f.canvas, 'b'), target: f.canvas.nodes.get('b').nodeEl }); f.doc.flush();
    assert.equal(f.canvas.edges.size, 5, 'a card is not joined to itself');

    // The same pair again is refused, and the tool is put away by a file change and by teardown.
    f.canvas.selectAll([f.canvas.nodes.get('a')]); f.manager.refresh(); f.doc.flush();
    f.command('connect'); f.doc.flush();
    f.canvas.wrapperEl.dispatch('pointerdown', { ...pointer(f.canvas, 'b'), target: f.canvas.nodes.get('b').nodeEl }); f.doc.flush();
    assert.equal(f.canvas.edges.size, 5);
    f.command('connect'); f.doc.flush();
    f.view.file = { path: 'another.canvas' }; f.manager.refresh(); f.doc.flush();
    assert.equal(f.canvas.wrapperEl.classList.contains('nf-canvas-connecting'), false, 'a new file puts the tool away');
    f.canvas.selectAll([f.canvas.nodes.get('a')]); f.manager.refresh(); f.doc.flush();
    f.command('connect'); f.doc.flush();
    f.manager.destroy();
    assert.equal(f.canvas.wrapperEl.classList.contains('nf-canvas-connecting'), false);
    assert.equal(layer.querySelector('.nf-canvas-connect-line'), null);
    assert.equal(f.canvas.wrapperEl.querySelectorAll('.nf-canvas-connect-target').length, 0);
  }

  /* ---------- markers ---------- */
  {
    const f = fixture(CanvasEnhancements, map());
    const badge = (id) => f.canvas.nodes.get(id).nodeEl.querySelector('.nf-canvas-badges');
    assert.equal(f.command('markers', true), false, 'nothing selected, nothing to mark');
    f.canvas.selectAll([f.canvas.nodes.get('a'), f.canvas.nodes.get('b')]); f.manager.refresh(); f.doc.flush();
    tb(f, 'Markers').dispatch('click'); f.doc.flush();
    const panel = f.canvas.wrapperEl.querySelector('.nf-canvas-marker-panel');
    assert.ok(panel, 'the picker opens');
    assert.equal(tb(f, 'Markers').getAttribute('aria-pressed'), 'true');
    const option = (id) => panel.querySelectorAll('.nf-canvas-marker-option').find((button) => button.dataset.marker === id);
    assert.equal(panel.querySelectorAll('.nf-canvas-marker-option').length, 27);
    const step = f.canvas.history.current;
    option('p1').dispatch('click'); f.doc.flush();
    for (const id of ['a', 'b']) {
      assert.deepEqual(f.canvas.nodes.get(id).getData().nfMarkers, ['p1'], `${id} is marked`);
      assert.equal(badge(id).querySelectorAll('.nf-canvas-marker').find((el) => el.dataset.marker === 'p1').textContent, '1');
    }
    assert.equal(f.canvas.history.current, step + 1, 'marking two cards is one step');
    assert.equal(option('p1').getAttribute('aria-pressed'), 'true');
    assert.equal(panel.classList.contains('is-empty'), false);
    option('p3').dispatch('click'); f.doc.flush();
    assert.deepEqual(f.canvas.nodes.get('a').getData().nfMarkers, ['p3'], 'one priority at a time');
    option('star').dispatch('click'); f.doc.flush();
    assert.deepEqual(f.canvas.nodes.get('b').getData().nfMarkers, ['p3', 'star']);
    assert.equal(badge('b').querySelectorAll('.nf-canvas-marker').length, 2);
    assert.equal(badge('b').getAttribute('aria-label'), 'Priority 3 · Star');
    assert.equal(badge('b').classList.contains('nf-canvas-ui'), true, 'badges are not canvas changes');

    f.canvas.selectOnly(f.canvas.nodes.get('a')); f.doc.flush();
    option('flag-red').dispatch('click'); f.doc.flush();
    f.canvas.selectAll([f.canvas.nodes.get('a'), f.canvas.nodes.get('b')]); f.manager.refresh(); f.doc.flush();
    assert.equal(option('flag-red').getAttribute('aria-pressed'), 'mixed', 'a marker on some of the selected cards');
    assert.equal(option('star').getAttribute('aria-pressed'), 'true');
    option('star').dispatch('click'); f.doc.flush();
    assert.deepEqual([f.canvas.nodes.get('a').getData().nfMarkers, f.canvas.nodes.get('b').getData().nfMarkers], [['p3', 'flag-red'], ['p3']], 'a shared marker comes off both');
    panel.querySelector('.nf-canvas-marker-clear').dispatch('click'); f.doc.flush();
    assert.equal('nfMarkers' in f.canvas.nodes.get('a').getData(), false, 'clearing removes the field');
    assert.equal(badge('a'), null);
    f.canvas.undo(); f.manager.refresh(); f.doc.flush();
    assert.deepEqual(f.canvas.nodes.get('a').getData().nfMarkers, ['p3', 'flag-red']);
    assert.equal(badge('a').querySelectorAll('.nf-canvas-marker').length, 2, 'undo brings the badges back');

    // Folded cards hide their badges; deleting a card drops its badge.
    f.canvas.selectOnly(f.canvas.nodes.get('root')); f.doc.flush();
    f.command('fold'); f.doc.flush();
    assert.equal(badge('a'), null, 'hidden cards show no badges');
    f.command('fold'); f.doc.flush();
    assert.ok(badge('a'));
    f.canvas.selection.clear(); f.manager.refresh(); f.doc.flush();
    assert.equal(panel.classList.contains('is-empty'), true, 'with nothing selected the picker waits');
    const escape = f.canvas.wrapperEl.dispatch('keydown', keyEvent('Escape', f.canvas.wrapperEl));
    assert.equal(escape.defaultPrevented, true);
    f.doc.flush();
    assert.equal(f.canvas.wrapperEl.querySelector('.nf-canvas-marker-panel'), null, 'Escape closes the picker');
    f.canvas.selectOnly(f.canvas.nodes.get('a')); f.doc.flush();
    f.command('markers'); f.doc.flush();
    f.canvas.wrapperEl.dispatch('pointerdown', { ...pointer(f.canvas, 'b'), target: f.canvas.nodes.get('b').nodeEl }); f.doc.flush();
    assert.equal(f.canvas.wrapperEl.querySelector('.nf-canvas-marker-panel'), null, 'a click elsewhere closes the picker');
    f.command('markers'); f.doc.flush();
    f.command('presets'); f.doc.flush();
    assert.equal(f.canvas.wrapperEl.querySelector('.nf-canvas-marker-panel'), null, 'the style panel takes the picker’s place');
    assert.ok(f.canvas.wrapperEl.querySelector('.nf-canvas-style-panel'));
    f.canvas.readonly = true; f.manager.refresh(); f.doc.flush();
    assert.equal(f.command('markers', true), false, 'a read-only canvas cannot be marked');
    f.canvas.readonly = false;
    f.manager.destroy();
    assert.equal(f.canvas.wrapperEl.querySelectorAll('.nf-canvas-badges').length, 0, 'teardown removes badges');
  }

  /* ---------- numbering ---------- */
  {
    const f = fixture(CanvasEnhancements, map());
    const number = (id) => f.canvas.nodes.get(id).nodeEl.querySelector('.nf-canvas-number')?.textContent ?? null;
    assert.equal(f.command('numbering', true), true, 'with nothing selected, the canvas’s only map');
    f.canvas.selectOnly(f.canvas.nodes.get('a1')); f.doc.flush();
    f.command('numbering'); f.doc.flush();
    assert.equal(f.canvas.nodes.get('root').getData().nfNumbering, true, 'stored on the root');
    assert.deepEqual([number('root'), number('a'), number('b'), number('a1'), number('free')], [null, '1', '2', '1.1', null]);
    f.command('sibling'); f.doc.flush();
    const added = [...f.canvas.nodes.values()].find((node) => !map().nodes.some((item) => item.id === node.id));
    assert.equal(number(added.id), '1.2', 'a new sibling takes the next number');
    added.data.text = 'new'; added.isEditing = false; f.manager.refresh(); f.doc.flush();
    assert.equal(number(added.id), '1.2');
    f.canvas.selectOnly(f.canvas.nodes.get('b')); f.doc.flush();
    f.command('numbering'); f.doc.flush();
    assert.equal('nfNumbering' in f.canvas.nodes.get('root').getData(), false, 'toggling off removes the field');
    assert.equal(number('a'), null);
    f.manager.destroy();
  }

  /* ---------- guide ---------- */
  {
    const f = fixture(CanvasEnhancements, map());
    f.canvas.readonly = true; f.manager.refresh(); f.doc.flush();
    assert.equal(f.command('help', true), true, 'the guide reads on any canvas');
    tb(f, 'Guide').dispatch('click'); f.doc.flush();
    const guide = f.canvas.wrapperEl.querySelector('.nf-canvas-help-panel');
    assert.ok(guide);
    assert.equal(tb(f, 'Guide').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(guide.querySelectorAll('.nf-canvas-help-heading').map((el) => el.textContent), ['Grow a map', 'Connect cards', 'Arrange', 'View', 'Components']);
    assert.ok(guide.querySelectorAll('.nf-canvas-help-row').length >= 20);
    assert.ok(guide.querySelectorAll('.nf-canvas-help-text').some((el) => el.textContent.includes('Connect')), 'connecting is explained');
    // Shift+click is a key held during a gesture: a key, then a word; chords read as typed here.
    const rowsOf = (panel) => panel.querySelectorAll('.nf-canvas-help-row');
    const textOf = (row) => row.querySelector('.nf-canvas-help-text').textContent;
    const rowStarting = (panel, start) => rowsOf(panel).find((row) => textOf(row).startsWith(start));
    const chips = (row) => row.querySelector('.nf-canvas-help-keys').children.map((el) => [el.tagName, el.className, el.textContent]);
    assert.deepEqual(chips(rowStarting(guide, 'Select two or more')),
      [['KBD', 'nf-canvas-help-key', 'Shift'], ['SPAN', 'nf-canvas-help-word', 'click'], ['SPAN', 'nf-canvas-help-word', 'Connect']]);
    assert.deepEqual(chips(rowStarting(guide, 'Outdent a card')), [['KBD', 'nf-canvas-help-key', 'Ctrl+['], ['KBD', 'nf-canvas-help-key', 'Ctrl+]']]);
    assert.deepEqual(chips(rowStarting(guide, 'Delete keeps')), [['KBD', 'nf-canvas-help-key', 'Delete'], ['KBD', 'nf-canvas-help-key', 'Shift+Delete']]);
    // Rows that need a setting stay when it is off, and say so.
    const off = (panel) => rowsOf(panel).filter((row) => row.classList.contains('nf-canvas-help-off')).map(textOf);
    assert.deepEqual(off(guide).map((text) => text.slice(0, 12)), ['While typing', 'Finish editi'], 'the typing flow is off in this fixture');
    assert.ok(textOf(rowStarting(guide, 'While typing')).endsWith(' · Off in settings'));
    assert.equal(rowStarting(guide, 'Finish editing').classList.contains('nf-canvas-help-off'), false, 'native keys are never off');
    const finishRows = rowsOf(guide).filter((row) => textOf(row).startsWith('Finish editing'));
    assert.deepEqual(finishRows.map(chips), [[['KBD', 'nf-canvas-help-key', 'Esc']], [['KBD', 'nf-canvas-help-key', 'Ctrl+Enter']]],
      'Esc and Mod+Enter both finish editing');
    assert.equal(finishRows[1].classList.contains('nf-canvas-help-off'), true, 'Mod+Enter is part of the typing flow');
    tb(f, 'Guide').dispatch('click'); f.doc.flush();
    assert.equal(f.canvas.wrapperEl.querySelector('.nf-canvas-help-panel'), null);
    f.settings.canvasKeyboard = false; f.settings.canvasEditorKeys = true;
    tb(f, 'Guide').dispatch('click'); f.doc.flush();
    const rebuilt = f.canvas.wrapperEl.querySelector('.nf-canvas-help-panel');
    assert.equal(off(rebuilt).length, 9, 'every row of canvas keys says they are off');
    assert.ok(rowStarting(rebuilt, 'New child topic').classList.contains('nf-canvas-help-off'));
    assert.ok(rowStarting(rebuilt, 'Find any card').classList.contains('nf-canvas-help-off'));
    assert.equal(rowStarting(rebuilt, 'While typing').classList.contains('nf-canvas-help-off'), false, 'the typing flow is a setting of its own');
    assert.equal(rowStarting(rebuilt, 'Double-click empty').classList.contains('nf-canvas-help-off'), false, 'gestures need no setting');
    tb(f, 'Guide').dispatch('click'); f.doc.flush();
    f.settings.canvasKeyboard = true;
    tb(f, 'Guide').dispatch('click'); f.doc.flush();
    assert.deepEqual(off(f.canvas.wrapperEl.querySelector('.nf-canvas-help-panel')), [], 'with everything on, no row is marked');
    tb(f, 'Guide').dispatch('click'); f.doc.flush();
    f.settings.canvasEditorKeys = false;
    f.canvas.readonly = false;
    f.canvas.selectOnly(f.canvas.nodes.get('a')); f.doc.flush();
    f.command('help'); f.command('markers'); f.doc.flush();
    assert.equal(f.canvas.wrapperEl.querySelector('.nf-canvas-help-panel'), null, 'one panel at a time');
    f.manager.destroy();
    assert.equal(f.canvas.wrapperEl.querySelector('.nf-canvas-marker-panel'), null);
  }

  /* ---------- Enter and Tab while typing ---------- */
  {
    const editor = (f, id, text, caret = text.length) => {
      const node = f.canvas.nodes.get(id);
      const dom = f.doc.createElement('div');
      const scrollDOM = f.doc.createElement('div');
      const contentDOM = f.doc.createElement('div');
      dom.append(scrollDOM); scrollDOM.append(contentDOM);
      const cm = {
        dom, scrollDOM, contentDOM, composing: false, defaultLineHeight: 20, defaultCharacterWidth: 8, contentHeight: 20,
        state: { doc: { toString: () => text, get length() { return text.length; } }, selection: { main: { head: caret } } },
        requestMeasure(spec) { if (spec?.read) spec.write(spec.read()); },
        // Here only a finished card's trailing blank lines change the words.
        dispatch({ changes }) { if (changes) text = text.slice(0, changes.from) + (changes.insert ?? '') + text.slice(changes.to); },
      };
      let editing = true;
      node.child = {
        getMode: () => editing ? 'source' : 'preview',
        editMode: { cm },
        showPreview(save) { node.child.saved = save ? text : null; editing = false; node.child.editMode = null; node.nodeEl.classList.remove('is-editing'); },
      };
      node.setIsEditing = (value) => { node.isEditing = value; };
      node.isEditing = true; node.nodeEl.classList.add('is-editing');
      f.canvas.selectOnly(node);
      f.manager.refresh(); f.doc.flush();
      return { node, cm, key: (key, extra = {}) => { const evt = cm.contentDOM.dispatch('keydown', keyEvent(key, cm.contentDOM, extra)); f.doc.flush(); return evt; } };
    };
    const f = fixture(CanvasEnhancements, map());
    f.settings.canvasComfortableEdit = true;
    f.settings.canvasEditorKeys = true;
    const before = f.canvas.nodes.size;
    const parentOf = (id) => f.manager.bindings.get(f.view).snapshot().forest.nodes.get(id)?.parent;

    // Enter finishes the card and leaves it selected, the keyboard back on the canvas.
    let e = editor(f, 'a', 'Alpha');
    assert.equal(e.key('Enter').defaultPrevented, true);
    assert.equal(e.node.child.saved, 'Alpha', 'the text is saved the way Escape saves it');
    assert.equal(e.node.isEditing, false, 'the card is done at once, not after the next click');
    assert.equal(f.canvas.nodes.size, before, 'Enter while typing creates nothing');
    assert.deepEqual([...f.canvas.selection].map((node) => node.id), ['a'], 'the card stays selected');
    assert.equal(f.doc.activeElement, f.canvas.wrapperEl, 'the keyboard is back on the canvas');
    // Then Enter adds the next card, ready to type into.
    assert.equal(f.scope.dispatch(keyEvent('Enter', f.canvas.wrapperEl)), false);
    let created = [...f.canvas.selection][0];
    assert.equal(created.isEditing, true, 'the sibling is ready to type into');
    assert.equal(parentOf(created.id), 'root', 'a sibling of a hangs from root');
    created.data.text = 'typed'; created.isEditing = false;
    // Tab while typing finishes and starts a child at once.
    e = editor(f, 'b', 'Beta');
    assert.equal(e.key('Tab').defaultPrevented, true);
    assert.equal(e.node.child.saved, 'Beta');
    created = [...f.canvas.selection][0];
    assert.equal(parentOf(created.id), 'b');
    created.data.text = 'typed'; created.isEditing = false;
    const count = f.canvas.nodes.size;

    // Enter finishes any line of plain words, in a note of several lines too.
    for (const [text, caret, saved, why] of [
      ['Multi\nline', undefined, 'Multi\nline', 'a note of several lines'],
      ['# Heading', undefined, '# Heading', 'a heading'],
      ['Title\n- item', 5, 'Title\n- item', 'a plain line above a list'],
      ['- one\n- two\n', undefined, '- one\n- two', 'the empty line left after ending a list'],
      ['Alpha  \n\n', undefined, 'Alpha', 'blank lines left at the end go'],
    ]) {
      e = editor(f, 'a1', text, caret);
      assert.equal(e.key('Enter').defaultPrevented, true, why);
      assert.equal(e.node.child.saved, saved, `${why}: saved`);
      assert.equal(f.canvas.nodes.size, count, `${why}: nothing grows`);
    }

    // Keys that stay with the editor.
    const popup = f.doc.createElement('div'); popup.className = 'suggestion-container';
    for (const [text, key, extra, why] of [
      ['Alpha', 'Enter', { shiftKey: true }, 'Shift+Enter breaks the line'],
      ['Alpha', 'Enter', { isComposing: true }, 'IME composition'],
      ['Alpha', 'Enter', { keyCode: 229 }, 'a key an input method is still composing with'],
      ['Alpha', 'Enter', { repeat: true }, 'a held key'],
      ['Alpha', 'Enter', { metaKey: true, ctrlKey: true }, 'a shortcut with both modifiers'],
      ['Alpha', 'Enter', { altKey: true }, 'Alt+Enter'],
      ['- item', 'Tab', {}, 'Tab indents a list'],
      ['- item', 'Enter', {}, 'Enter continues a list'],
      ['1. item', 'Enter', {}, 'a numbered list too'],
      ['- [ ] task', 'Enter', {}, 'and a task list'],
      ['- item', 'Tab', { shiftKey: true }, 'Shift+Tab outdents a list item'],
      ['> quote', 'Enter', {}, 'a quote continues'],
      ['```js\nconst a = 1;', 'Enter', {}, 'code is written line by line'],
      ['Intro\n- item', 'Enter', {}, 'the caret\'s own line decides'],
      ['Alpha', 'popup', {}, 'a suggestion popup owns Enter'],
      ['Alpha', 'a', {}, 'other keys'],
    ]) {
      e = editor(f, 'a1', text);
      if (key === 'popup') f.doc.body.append(popup);
      assert.equal(e.key(key === 'popup' ? 'Enter' : key, extra).defaultPrevented, false, why);
      popup.remove();
      assert.equal(e.node.child.editMode !== null, true, `${why}: still editing`);
      e.node.child.showPreview(true); e.node.isEditing = false; f.manager.refresh(); f.doc.flush();
    }
    assert.equal(f.canvas.nodes.size, count);
    // Mod+Enter, when no hotkey takes it first, finishes from anywhere, a list included.
    e = editor(f, 'a1', '- item');
    assert.equal(e.key('Enter', { metaKey: true }).defaultPrevented, true, 'Mod+Enter finishes a list too');
    assert.equal(e.node.child.editMode, null);
    assert.equal(f.canvas.nodes.size, count);
    // Esc finishes from anywhere too, ahead of the note editor's own Escape
    // (which would select the caret's block inside the card).
    e = editor(f, 'a1', '- item\n');
    assert.equal(e.key('Escape').defaultPrevented, true, 'Esc finishes a list');
    assert.equal(e.node.child.saved, '- item', 'the words are kept, the trailing line break trimmed');
    assert.equal(e.node.isEditing, false);
    assert.deepEqual([...f.canvas.selection].map((node) => node.id), ['a1'], 'the card stays selected');
    assert.equal(f.doc.activeElement, f.canvas.wrapperEl, 'the keyboard is back on the canvas');
    assert.equal(f.canvas.nodes.size, count, 'Esc adds nothing');
    e = editor(f, 'a1', 'Alpha');
    f.doc.body.append(popup);
    assert.equal(e.key('Escape').defaultPrevented, false, 'a suggestion popup owns Esc');
    popup.remove();
    assert.equal(e.key('Escape', { shiftKey: true }).defaultPrevented, false, 'Shift+Esc stays the editor\'s');
    assert.equal(e.key('Escape', { isComposing: true }).defaultPrevented, false, 'Esc ending a composition stays the input method\'s');
    assert.notEqual(e.node.child.editMode, null);
    e.node.child.showPreview(true); e.node.isEditing = false; f.manager.refresh(); f.doc.flush();

    // Shift+Tab: the topic moves up a level and typing goes on in it.
    const edgeTo = (id) => [...f.canvas.edges.values()].map((edge) => edge.getData()).find((edge) => edge.toNode === id);
    const at = (id) => f.canvas.nodes.get(id).getData();
    e = editor(f, 'a1', 'Deep');
    let starts = 0;
    e.node.startEditing = () => { starts++; e.node.isEditing = true; };
    let step = f.canvas.history.current;
    assert.equal(e.key('Tab', { shiftKey: true }).defaultPrevented, true);
    assert.equal(e.node.child.saved, 'Deep', 'the words are kept');
    assert.equal(edgeTo('a1').fromNode, 'root', 'a1 now hangs from the centre');
    assert.ok(at('a1').y > at('a').y && at('a1').y < at('b').y, 'right after the branch it left');
    assert.equal(f.canvas.history.current, step + 1, 'one undo step');
    assert.equal([...f.canvas.selection][0].id, 'a1');
    assert.equal(starts, 1, 'typing goes on in the same card');
    assert.equal(f.canvas.nodes.size, count, 'nothing is added');
    e.node.isEditing = false; f.manager.refresh(); f.doc.flush();
    // A main branch cannot go higher: its parent takes the typing instead.
    e = editor(f, 'b', 'Beta');
    const centre = f.canvas.nodes.get('root');
    let centreStarts = 0;
    centre.startEditing = () => { centreStarts++; centre.isEditing = true; };
    step = f.canvas.history.current;
    assert.equal(e.key('Tab', { shiftKey: true }).defaultPrevented, true);
    assert.equal(edgeTo('b').fromNode, 'root', 'the structure is unchanged');
    assert.equal(f.canvas.history.current, step, 'and nothing is recorded');
    assert.equal([...f.canvas.selection][0].id, 'root', 'the centre is selected');
    assert.equal(centreStarts, 1, 'and edited');
    centre.isEditing = false; e.node.isEditing = false; f.manager.refresh(); f.doc.flush();

    // An empty topic only finishes, even on Tab; the setting turns the keys off.
    e = editor(f, 'a1', '   ');
    assert.equal(e.key('Tab').defaultPrevented, true);
    assert.equal(e.node.child.editMode, null, 'finished');
    assert.equal(f.canvas.nodes.size, count, 'nothing grows from a blank');
    e.node.isEditing = false;
    e = editor(f, 'root', 'Centre');
    assert.equal(e.key('Enter').defaultPrevented, true, 'the centre finishes like any card');
    assert.equal(f.canvas.nodes.size, count);
    e.node.isEditing = false;
    f.settings.canvasEditorKeys = false;
    e = editor(f, 'a1', 'Alpha');
    assert.equal(e.key('Enter').defaultPrevented, false, 'the setting restores the ordinary editor');
    assert.equal(e.key('Escape').defaultPrevented, false, 'and its own Escape');
    e.node.child.showPreview(true); e.node.isEditing = false; f.settings.canvasEditorKeys = true;
    // A free card finishes on Enter as well; Shift+Tab, with no level to go up, stays the editor's.
    e = editor(f, 'free', 'Loose');
    assert.equal(e.key('Tab', { shiftKey: true }).defaultPrevented, false, 'outside a map Shift+Tab stays the editor’s');
    assert.equal(e.key('Enter').defaultPrevented, true, 'a free card finishes on Enter too');
    assert.equal(e.node.child.saved, 'Loose');
    assert.equal(f.canvas.nodes.size, count, 'and nothing grows');
    assert.equal([...f.canvas.selection][0].id, 'free');
    // Enter on it then adds the next card of its own below it, not joined to it.
    assert.equal(f.scope.dispatch(keyEvent('Enter', f.canvas.wrapperEl)), false);
    const next = [...f.canvas.selection][0];
    assert.equal(f.canvas.nodes.size, count + 1);
    assert.equal(next.isEditing, true, 'ready to type into');
    assert.equal([...f.canvas.edges.values()].some((edge) => [edge.getData().fromNode, edge.getData().toNode].includes(next.id)), false, 'a card of its own');
    assert.equal(next.getData().x, at('free').x, 'right below it');
    assert.ok(next.getData().y >= at('free').y + at('free').height, 'after it');
    assert.equal(next.getData().width, at('free').width, 'as wide');
    next.child = { getMode: () => 'preview' }; next.isEditing = false; next.nodeEl.classList.remove('is-editing');
    f.manager.refresh(); f.doc.flush();
    assert.equal(f.canvas.nodes.has(next.id), false, 'left empty, it is taken away again');
    assert.equal([...f.canvas.selection][0]?.id, 'free', 'and the card it came from is selected, so Tab or Enter can follow');
    f.manager.destroy();
    assert.equal(e.cm.contentDOM.events.get('keydown')?.size ?? 0, 0, 'teardown unbinds the editor keys');

    // A card of its own: Tab while typing makes it the centre of a new map.
    const lone = fixture(CanvasEnhancements, { nodes: [nodeData('solo', 0, 0), nodeData('solo2', 0, 900)], edges: [] });
    lone.settings.canvasEditorKeys = true;
    e = editor(lone, 'solo', 'Root');
    const edgesBefore = lone.canvas.edges.size;
    assert.equal(e.key('Tab').defaultPrevented, true, 'Tab on a lone card is taken');
    assert.equal(e.node.child.saved, 'Root', 'its words are saved as typed');
    assert.equal(e.node.child.saved.includes('\t'), false, 'and no tab is typed into them');
    const kid = [...lone.canvas.selection][0];
    assert.notEqual(kid.id, 'solo', 'the new child is selected');
    assert.equal(kid.isEditing, true, 'and ready to type into');
    assert.equal(lone.canvas.edges.size, edgesBefore + 1, 'one connection joins them');
    const joined = [...lone.canvas.edges.values()].map((edge) => edge.getData());
    assert.deepEqual(joined.map(({ fromNode, toNode }) => [fromNode, toNode]), [['solo', kid.id]]);
    assert.equal(lone.canvas.nodes.get('solo').getData().nfLayout, 'right', 'the card became a map growing right');
    // Canvas keeps what is typed in the card's data; Enter then only finishes it.
    kid.data.text = 'Kid';
    const size = lone.canvas.nodes.size;
    e = editor(lone, kid.id, 'Kid');
    assert.equal(e.key('Enter').defaultPrevented, true);
    assert.equal(e.node.child.saved, 'Kid');
    assert.equal(lone.canvas.nodes.size, size, 'Enter while typing adds no card');
    assert.deepEqual([...lone.canvas.selection].map((node) => node.id), [kid.id], 'the child stays selected');
    e.node.isEditing = false; lone.manager.refresh(); lone.doc.flush();
    // Enter on a lone card only finishes it.
    e = editor(lone, 'solo2', 'Only');
    assert.equal(e.key('Enter').defaultPrevented, true);
    assert.equal(e.node.child.saved, 'Only');
    assert.equal(lone.canvas.nodes.size, size, 'a lone card finishes without growing');
    assert.deepEqual([...lone.canvas.selection].map((node) => node.id), ['solo2']);
    lone.manager.destroy();

    // A new card left empty goes, and the card it grew from is selected, not
    // its parent: after Enter, Shift+Enter, and Tab while typing.
    const leaveEmpty = (g, card) => {
      card.child = { getMode: () => 'preview' }; card.isEditing = false; card.nodeEl.classList.remove('is-editing');
      g.manager.refresh(); g.doc.flush();
    };
    for (const [extra, why] of [[{}, 'Enter adds a sibling below'], [{ shiftKey: true }, 'Shift+Enter adds one above']]) {
      const g = fixture(CanvasEnhancements, map());
      g.settings.canvasEditorKeys = true;
      g.canvas.selectOnly(g.canvas.nodes.get('a1')); g.manager.refresh(); g.doc.flush();
      assert.equal(g.scope.dispatch(keyEvent('Enter', g.canvas.wrapperEl, extra)), false, why);
      const blank = [...g.canvas.selection][0];
      assert.notEqual(blank.id, 'a1', `${why}: a new card`);
      assert.equal(blank.isEditing, true, `${why}: ready to type into`);
      assert.equal(g.manager.bindings.get(g.view).snapshot().forest.nodes.get(blank.id)?.parent, 'a', `${why}: under a`);
      leaveEmpty(g, blank);
      assert.equal(g.canvas.nodes.has(blank.id), false, `${why}: the blank is taken away`);
      assert.deepEqual([...g.canvas.selection].map((node) => node.id), ['a1'], `${why}: the card it grew from is selected, not a`);
      g.manager.destroy();
    }
    {
      const g = fixture(CanvasEnhancements, map());
      g.settings.canvasEditorKeys = true;
      const typed = editor(g, 'a1', 'Deep');
      assert.equal(typed.key('Tab').defaultPrevented, true);
      const blank = [...g.canvas.selection][0];
      assert.equal(g.manager.bindings.get(g.view).snapshot().forest.nodes.get(blank.id)?.parent, 'a1', 'Tab adds a child of a1');
      leaveEmpty(g, blank);
      assert.equal(g.canvas.nodes.has(blank.id), false, 'the empty child is taken away');
      assert.deepEqual([...g.canvas.selection].map((node) => node.id), ['a1'], 'and a1 is selected again');
      g.manager.destroy();
    }

    // The toolbar while a topic is typed in: its buttons act on the card as
    // if it were selected and done, and a click finishes it first.
    {
      const g = fixture(CanvasEnhancements, map());
      g.settings.canvasEditorKeys = true;
      const binding = g.manager.bindings.get(g.view);
      const faces = () => g.canvas.wrapperEl.querySelector('.nf-canvas-toolbar').querySelectorAll('button')
        .map((button) => `${button.getAttribute('aria-label').split(' · ')[0]}:${button.disabled}`);
      const parentIn = (id) => binding.snapshot().forest.nodes.get(id)?.parent;
      g.canvas.selectOnly(g.canvas.nodes.get('a')); g.manager.refresh(); g.doc.flush();
      const selectedFaces = faces();
      let typed = editor(g, 'a', 'Alpha');
      assert.deepEqual(faces(), selectedFaces, 'every button is enabled exactly as with the card selected');
      for (const label of ['Add child', 'Add sibling', 'Connect', 'Layout', 'Style', 'Markers', 'Fold branch', 'Focus branch', 'More', 'Guide']) {
        assert.equal(tb(g, label).disabled, false, `${label} works while typing`);
      }
      assert.equal(tb(g, 'New topic'), undefined, 'the first button grows the card being typed in');
      assert.equal(statusOf(g).textContent, 'Editing · Enter done · Tab child · Shift+Tab up · Shift+Enter new line');
      assert.equal(binding.toolbarEditing, null, 'only the toolbar pass sees the card as selected');
      assert.equal(binding.selected(), null, 'everything else still sees a card being typed in');
      assert.equal(binding.markableNodes().length, 0);
      typed = editor(g, 'a1', 'Leaf');
      assert.equal(tb(g, 'Fold branch').disabled, true, 'a card without children has nothing to fold, typed in or not');
      assert.equal(tb(g, 'Add child').disabled, false);
      // Add child finishes the words, then grows a child ready to type into.
      const size = g.canvas.nodes.size;
      tb(g, 'Add child').dispatch('click'); g.doc.flush();
      assert.equal(typed.node.child.saved, 'Leaf', 'the words are saved the way Enter saves them');
      assert.equal(typed.node.isEditing, false);
      assert.equal(g.canvas.nodes.size, size + 1);
      const child = [...g.canvas.selection][0];
      assert.equal(parentIn(child.id), 'a1', 'a child of the card that was typed in');
      assert.equal(child.isEditing, true, 'ready to type into');
      // From a blank new topic, Add child only finishes: nothing grows from a blank.
      typed = editor(g, child.id, '');
      tb(g, 'Add child').dispatch('click'); g.doc.flush();
      assert.equal(typed.node.child.editMode, null, 'the blank is finished');
      assert.equal([...binding.snapshot().forest.nodes.values()].some((info) => info.parent === child.id), false, 'and grows nothing');
      assert.ok(g.canvas.nodes.size <= size + 1, 'no card is added');
      g.manager.refresh(); g.doc.flush();
      // Any other button on a blank new topic takes the blank away at once, and
      // acts on the card it grew from: never on a card about to vanish.
      {
        svgLayer(g);
        g.canvas.selectOnly(g.canvas.nodes.get('b')); g.manager.refresh(); g.doc.flush();
        tb(g, 'Add child').dispatch('click'); g.doc.flush();
        let blank = [...g.canvas.selection][0];
        assert.equal(blank.isEditing, true, 'a blank child of b to type into');
        typed = editor(g, blank.id, '');
        const edges = g.canvas.edges.size;
        tb(g, 'Connect').dispatch('click'); g.doc.flush();
        assert.equal(g.canvas.nodes.has(blank.id), false, 'the blank is gone before the action runs');
        assert.equal(g.canvas.edges.size, edges - 1, 'with its line');
        assert.deepEqual([...g.canvas.selection].map((node) => node.id), ['b'], 'the card it grew from is selected again');
        assert.equal(binding.connecting?.from, 'b', 'and the connection starts from it');
        g.canvas.wrapperEl.dispatch('pointerdown', { ...pointer(g.canvas, 'a1'), target: g.canvas.nodes.get('a1').nodeEl }); g.doc.flush();
        assert.ok([...g.canvas.edges.values()].some((edge) => edge.getData().fromNode === 'b' && edge.getData().toNode === 'a1'), 'the line is drawn');
        // A summary asked for on a blank goes with the card the blank grew from, and points at cards that exist.
        g.canvas.selectOnly(g.canvas.nodes.get('a')); g.manager.refresh(); g.doc.flush();
        tb(g, 'Add sibling').dispatch('click'); g.doc.flush();
        blank = [...g.canvas.selection][0];
        typed = editor(g, blank.id, '');
        tb(g, 'Summary').dispatch('click'); g.doc.flush();
        assert.equal(g.canvas.nodes.has(blank.id), false);
        const summary = [...g.canvas.nodes.values()].find((node) => node.getData().nfSummary);
        assert.deepEqual(summary?.getData().nfSummary, { parent: 'root', from: 'a', to: 'a' }, 'a summary of a');
        summary.isEditing = false; summary.data.text = 'Sum'; g.manager.refresh(); g.doc.flush();
        binding.run('summary'); g.manager.refresh(); g.doc.flush();
        assert.equal([...g.canvas.nodes.values()].some((node) => node.getData().nfSummary), false);
      }
      // An open input-method composition is not words yet: the click waits for it.
      {
        typed = editor(g, 'a1', 'Leaf qian duan');
        typed.cm.composing = true;
        const cards = g.canvas.nodes.size;
        tb(g, 'Add child').dispatch('click'); g.doc.flush();
        assert.notEqual(typed.node.child.editMode, null, 'the card is still being typed in');
        assert.equal(typed.node.child.saved, undefined, 'nothing is saved');
        assert.equal(g.canvas.nodes.size, cards, 'and no child grows');
        tb(g, 'Markers').dispatch('click'); g.doc.flush();
        assert.equal(g.canvas.wrapperEl.querySelector('.nf-canvas-marker-panel'), null, 'no other button acts either');
        typed.cm.composing = false;
        tb(g, 'Add child').dispatch('click'); g.doc.flush();
        assert.equal(typed.node.child.saved, 'Leaf qian duan', 'once it is committed the click finishes the card');
        const kid = [...g.canvas.selection][0];
        kid.data.text = 'x'; kid.isEditing = false; g.manager.refresh(); g.doc.flush();
      }
      // Add sibling finishes too, then adds the next card.
      typed = editor(g, 'b', 'Beta');
      tb(g, 'Add sibling').dispatch('click'); g.doc.flush();
      assert.equal(typed.node.child.saved, 'Beta');
      const sibling = [...g.canvas.selection][0];
      assert.equal(parentIn(sibling.id), 'root', 'a sibling of b');
      sibling.data.text = 'typed'; sibling.isEditing = false; g.manager.refresh(); g.doc.flush();
      // The guide opens without finishing the card.
      typed = editor(g, 'b', 'Beta again');
      tb(g, 'Guide').dispatch('click'); g.doc.flush();
      assert.ok(g.doc.body.querySelector('.nf-canvas-help-panel') || g.canvas.wrapperEl.querySelector('.nf-canvas-help-panel'), 'the guide opens');
      assert.notEqual(typed.node.child.editMode, null, 'and the card is still being typed in');
      tb(g, 'Guide').dispatch('click'); g.doc.flush();
      // Style finishes the words, then opens the panel on the card's map.
      tb(g, 'Style').dispatch('click'); g.doc.flush();
      assert.equal(typed.node.child.saved, 'Beta again');
      assert.equal(tb(g, 'Style').getAttribute('aria-pressed'), 'true', 'the style panel is open');
      tb(g, 'Style').dispatch('click'); g.doc.flush();
      // With the typing keys off, the status sums up the card's map instead.
      g.settings.canvasEditorKeys = false;
      typed = editor(g, 'b', 'Beta');
      assert.match(statusOf(g).textContent, /^Mind map · .+ · \d+$/);
      typed.node.child.showPreview(true); typed.node.isEditing = false; g.manager.refresh(); g.doc.flush();
      assert.equal(binding.toolbarEditing, null);
      g.manager.destroy();
    }

    // Mod+Enter finishes the card from anywhere through a scope of its own,
    // above the hotkeys that would take the key first.
    {
      const pushed = [];
      const popped = [];
      const g = fixture(CanvasEnhancements, map(), { keymap: { pushScope: (scope) => pushed.push(scope), popScope: (scope) => popped.push(scope) } });
      g.settings.canvasEditorKeys = true;
      const mod = (target, extra = {}) => keyEvent('Enter', target, { metaKey: true, ...extra });
      let typed = editor(g, 'a1', '- item');
      assert.equal(pushed.length, 1, 'one scope while a card is typed in');
      const scope = pushed[0];
      assert.equal(scope.parent, g.view.scope, 'keys it does not take go on to the view');
      assert.equal(scope.handleKey(keyEvent('a', typed.cm.contentDOM)), undefined, 'other keys fall through');
      assert.equal(scope.handleKey(keyEvent('Enter', typed.cm.contentDOM)), undefined, 'plain Enter is the editor\'s');
      assert.equal(scope.handleKey(mod(typed.cm.contentDOM, { shiftKey: true })), undefined, 'Mod+Shift+Enter falls through');
      assert.equal(scope.handleKey(mod(g.canvas.wrapperEl)), undefined, 'a key typed outside the card falls through');
      assert.equal(scope.handleKey(mod(typed.cm.contentDOM)), false, 'Mod+Enter is taken');
      assert.equal(typed.node.child.saved, '- item', 'and finishes a list too');
      assert.equal(typed.node.isEditing, false);
      assert.equal(g.canvas.nodes.size, map().nodes.length, 'nothing is added');
      g.doc.flush();
      assert.deepEqual(popped, [scope], 'the scope goes once the editor closes');
      // On a link, Obsidian opens the link.
      typed = editor(g, 'a1', 'see [[Note]] here', 8);
      assert.equal(pushed.length, 2);
      assert.equal(pushed[1].handleKey(mod(typed.cm.contentDOM)), undefined, 'on a link the key falls through');
      assert.notEqual(typed.node.child.editMode, null, 'the card is still being typed in');
      g.settings.canvasEditorKeys = false;
      assert.equal(pushed[1].handleKey(mod(typed.cm.contentDOM)), undefined, 'the setting turns it off');
      g.settings.canvasEditorKeys = true;
      typed.node.child.showPreview(true); typed.node.isEditing = false; g.manager.refresh(); g.doc.flush();
      assert.deepEqual(popped, [scope, pushed[1]], 'Esc and every other close pops it too');
      typed = editor(g, 'b', 'Beta');
      assert.equal(pushed.length, 3);
      g.manager.destroy();
      assert.deepEqual(popped.at(-1), pushed[2], 'teardown pops a scope still held');
      assert.equal(popped.length, 3);
    }

    // An empty topic's editor asks for a topic rather than a block; a free card keeps the note's hint.
    {
      const g = fixture(CanvasEnhancements, map());
      let typed = editor(g, 'a1', '');
      assert.equal(typed.cm.scrollDOM.style.getPropertyValue('--nf-empty-hint'), '"Type a topic…"');
      typed.node.child.showPreview(true); typed.node.isEditing = false; g.manager.refresh(); g.doc.flush();
      typed = editor(g, 'free', '');
      assert.equal(typed.cm.scrollDOM.style.getPropertyValue('--nf-empty-hint'), '');
      g.manager.destroy();
    }

    // With Vim keys, Escape stays Vim's: it leaves insert mode.
    {
      const g = fixture(CanvasEnhancements, map(), { vault: { getConfig: (key) => key === 'vimMode' } });
      g.settings.canvasEditorKeys = true;
      const typed = editor(g, 'a1', 'Alpha');
      assert.equal(typed.key('Escape').defaultPrevented, false, 'Vim keeps its Escape');
      assert.notEqual(typed.node.child.editMode, null);
      assert.equal(typed.key('Enter').defaultPrevented, true, 'while Enter still finishes the card');
      g.manager.destroy();
    }

    // Words added to a card that hugs them, then Tab: the card grows taller at
    // once, into the new child's step, rather than clipping in its old box
    // while the child is typed in. Nothing moves meanwhile, and it keeps its
    // width until the typing ends: wider, it would reach across the gap.
    {
      const data = map();
      Object.assign(data.nodes.find((node) => node.id === 'a1'), { width: 48, height: 52 });
      const g = fixture(CanvasEnhancements, data);
      g.settings.canvasEditorKeys = true;
      g.settings.canvasAnimation = false;
      g.doc.flush();
      // The fixture renders no words: a preview is as tall as its card's inset, and Canvas saves the words on close.
      const measured = (node) => Object.defineProperty(node.nodeEl.querySelector('.markdown-preview-view'), 'clientHeight',
        { configurable: true, get: () => node.getData().height - 12 });
      const typing = (id, text) => {
        const typed = editor(g, id, text);
        const show = typed.node.child.showPreview;
        typed.node.child.showPreview = (save) => { show(save); if (save) typed.node.data.text = typed.node.child.saved; };
        measured(typed.node);
        return typed;
      };
      const size = (id) => { const { x, y, width, height } = g.canvas.nodes.get(id).getData(); return { x, y, width, height }; };
      const hugged = size('a1');
      let typed = typing('a1', 'Words that need more room');
      assert.equal(typed.key('Tab').defaultPrevented, true);
      const child = [...g.canvas.selection][0];
      assert.equal(child.isEditing, true, 'the child is being typed in');
      const steps = g.canvas.history.data.length;
      const placed = size(child.id);
      const finished = size('a1');
      g.doc.flush();
      const fitted = size('a1');
      assert.ok(fitted.height > hugged.height, 'the parent takes the height its new words need');
      assert.deepEqual([fitted.x, fitted.y, fitted.width], [finished.x, finished.y, hugged.width], 'in place, and no wider yet');
      assert.equal(child.isEditing, true, 'while its child is still typed in');
      assert.deepEqual(size(child.id), placed, 'and nothing moves');
      assert.equal(g.canvas.history.data.length, steps, 'no undo step of its own');
      assert.deepEqual(g.canvas.history.data[g.canvas.history.current].nodes.find((node) => node.id === 'a1').height, fitted.height,
        'it joins the step that made the child');
      // A card that would narrow waits for the typing to end.
      measured(child);
      typed = typing(child.id, 'Kid');
      typed.key('Tab'); g.doc.flush();
      const grandchild = [...g.canvas.selection][0];
      assert.equal(grandchild.isEditing, true);
      assert.deepEqual([size(child.id).width, size(child.id).height], [placed.width, placed.height],
        'a card with room to spare keeps its box while the next is typed in');
      grandchild.data.text = 'Deep'; grandchild.isEditing = false; grandchild.nodeEl.classList.remove('is-editing');
      g.manager.refresh(); g.doc.flush();
      assert.ok(size(child.id).width < placed.width, 'and narrows to its words once the typing ends');
      assert.ok(size('a1').width > hugged.width, 'the parent is fitted to its words then too');
      g.manager.destroy();
    }

    // The same on a balanced map: a branch hanging left keeps clear of the
    // centre, and one hanging right keeps clear of the child being typed.
    for (const side of ['left', 'right']) {
      const data = { nodes: [
        nodeData('root', 0, 0, { nfLayout: 'balanced', width: 160, height: 64 }),
        nodeData('R', 232, 0, { width: 112, height: 52 }),
        nodeData('L', -184, 0, { width: 112, height: 52 }),
      ], edges: [edgeData('e-R', 'root', 'R'), { ...edgeData('e-L', 'root', 'L'), fromSide: 'left', toSide: 'right' }] };
      const g = fixture(CanvasEnhancements, data);
      Object.assign(g.settings, { canvasEditorKeys: true, canvasAnimation: false, canvasAutoLayout: true, canvasAutoFit: true });
      g.doc.flush();
      const box = (id) => { const { x, y, width, height } = g.canvas.nodes.get(id).getData(); return { x, y, width, height, right: x + width }; };
      const id = side === 'left' ? 'L' : 'R';
      const start = box(id);
      const typed = editor(g, id, 'Words that need a lot more room than before');
      const show = typed.node.child.showPreview;
      typed.node.child.showPreview = (save) => { show(save); if (save) typed.node.data.text = typed.node.child.saved; };
      Object.defineProperty(typed.node.nodeEl.querySelector('.markdown-preview-view'), 'clientHeight',
        { configurable: true, get: () => typed.node.getData().height - 12 });
      typed.key('Tab');
      const child = [...g.canvas.selection][0];
      assert.equal(child.isEditing, true);
      g.doc.flush();
      const during = box(id);
      assert.ok(during.height > start.height, `${side}: the finished branch grows taller`);
      assert.deepEqual([during.x, during.right], [start.x, start.right], `${side}: and no wider while its child is typed`);
      if (side === 'left') assert.ok(during.right <= box('root').x, 'a left branch never reaches over the centre');
      else assert.ok(during.right <= box(child.id).x, 'a right branch never reaches under the child being typed');
      g.manager.destroy();
    }

    // A map started from a scheme tile types like any other: Enter finishes
    // the centre, then Enter or Tab adds a main topic, which opens at its own size.
    const tileStart = () => {
      const g = fixture(CanvasEnhancements, { nodes: [], edges: [] });
      g.settings.canvasEditorKeys = true;
      g.doc.flush();
      g.canvas.wrapperEl.querySelector('.nf-canvas-empty').querySelectorAll('.nf-canvas-empty-tile')
        .find((tile) => tile.dataset.preset === 'guose').dispatch('click');
      g.doc.flush();
      const root = [...g.canvas.nodes.values()][0];
      assert.equal(root.isEditing, true);
      assert.equal(g.doc.activeElement, g.canvas.wrapperEl, 'the keyboard is with the canvas, not a tile that left');
      return { g, root, parentIn: (id) => g.manager.bindings.get(g.view).snapshot().forest.nodes.get(id)?.parent };
    };
    {
      const { g, root, parentIn } = tileStart();
      // Canvas keeps what is typed in the card's data.
      root.data.text = 'Launch';
      const typed = editor(g, root.id, 'Launch');
      assert.equal(typed.key('Enter').defaultPrevented, true);
      assert.equal(typed.node.child.saved, 'Launch', 'Enter finishes the centre');
      assert.equal(g.canvas.nodes.size, 1, 'and adds nothing');
      assert.deepEqual([...g.canvas.selection].map((node) => node.id), [root.id], 'the centre stays selected');
      assert.equal(g.scope.dispatch(keyEvent('Enter', g.canvas.wrapperEl)), false);
      const topic = [...g.canvas.selection][0];
      assert.equal(parentIn(topic.id), root.id, 'a centre has no siblings: Enter adds a main topic');
      assert.equal(topic.isEditing, true, 'ready to type into');
      assert.equal(topic.getData().width, 112, 'at the width it becomes');
      assert.equal(root.getData().nfPalette, 'guose', 'the map keeps its scheme');
      const blank = editor(g, topic.id, '');
      assert.equal(blank.cm.scrollDOM.style.getPropertyValue('--nf-empty-hint'), '"Type a topic…"', 'its editor asks for a topic');
      g.manager.destroy();
    }
    {
      const { g, root, parentIn } = tileStart();
      root.data.text = 'Launch';
      const typed = editor(g, root.id, 'Launch');
      assert.equal(typed.key('Tab').defaultPrevented, true);
      assert.equal(typed.node.child.saved, 'Launch');
      const topic = [...g.canvas.selection][0];
      assert.equal(parentIn(topic.id), root.id, 'Tab adds a main topic');
      assert.equal(topic.getData().width, 112);
      topic.child = { getMode: () => 'preview' }; topic.isEditing = false; topic.nodeEl.classList.remove('is-editing');
      g.manager.refresh(); g.doc.flush();
      assert.equal(g.canvas.nodes.has(topic.id), false, 'left empty, it is taken away');
      assert.deepEqual([...g.canvas.selection].map((node) => node.id), [root.id], 'and the centre is selected');
      g.manager.destroy();
    }
    {
      // Closed without a word, the blank centre goes and the canvas offers the panel again.
      const { g, root } = tileStart();
      root.child = { getMode: () => 'preview' }; root.isEditing = false; root.nodeEl.classList.remove('is-editing');
      g.manager.refresh(); g.doc.flush();
      assert.equal(g.canvas.nodes.size, 0, 'an untouched centre is taken away');
      assert.ok(g.canvas.wrapperEl.querySelector('.nf-canvas-empty'), 'and the panel returns');
      g.manager.destroy();
    }
  }

  /* ---------- summaries ---------- */
  {
    const f = fixture(CanvasEnhancements, map());
    const layer = svgLayer(f);
    assert.equal(f.command('summary', true), false, 'nothing selected');
    f.canvas.selectOnly(f.canvas.nodes.get('root')); f.doc.flush();
    assert.equal(f.command('summary', true), false, 'the centre has no siblings to sum up');
    f.canvas.selectAll([f.canvas.nodes.get('a'), f.canvas.nodes.get('free')]); f.manager.refresh(); f.doc.flush();
    assert.equal(f.command('summary', true), false, 'a free card and a branch share no parent');
    f.canvas.selectAll([f.canvas.nodes.get('a'), f.canvas.nodes.get('b')]); f.manager.refresh(); f.doc.flush();
    assert.equal(tb(f, 'Summary').disabled, false);
    const before = f.canvas.nodes.size;
    const step = f.canvas.history.current;
    tb(f, 'Summary').dispatch('click'); f.doc.flush();
    assert.equal(f.canvas.nodes.size, before + 1);
    const created = [...f.canvas.nodes.values()].find((node) => !map().nodes.some((item) => item.id === node.id));
    assert.deepEqual(created.getData().nfSummary, { parent: 'root', from: 'a', to: 'b' }, 'the run it covers, in reading order');
    assert.equal(created.isEditing, true, 'ready to type into');
    assert.equal(f.canvas.history.current, step + 1, 'one undo step');
    assert.equal(created.nodeEl.classList.contains('nf-canvas-summary'), true);
    assert.equal(created.nodeEl.classList.contains('nf-canvas-map-node'), true, 'dressed like a topic of its map');
    assert.equal(created.nodeEl.style.getPropertyValue('--nf-size'), '1.0625', 'and sized like a deep topic');
    const right = Math.max(...['a', 'a1', 'b'].map((id) => f.canvas.nodes.get(id).getData().x + f.canvas.nodes.get(id).getData().width));
    assert.ok(created.getData().x > right, 'placed past the deepest covered branch');
    const braces = layer.querySelectorAll('.nf-canvas-brace');
    assert.equal(braces.length, 1, 'a brace is drawn in the connection layer');
    assert.match(braces[0].getAttribute('d'), /^M/);
    assert.equal(layer.querySelectorAll('.nf-canvas-brace-tail').length, 1);
    // A summary grows nothing and cannot be summarised again; it can be edited and fitted.
    created.isEditing = false; f.canvas.selectOnly(created); f.doc.flush();
    for (const action of ['child', 'sibling', 'fold', 'boundary', 'numbering']) assert.equal(f.command(action, true), action === 'numbering', `${action} on a summary`);
    assert.equal(f.manager.bindings.get(f.view).canRun('edit'), true, 'a summary can be edited');
    assert.equal(tb(f, 'Add child').disabled, true);
    assert.equal(f.command('summary', true), true, 'the action removes a selected summary');
    // Asking for the same run again selects the existing summary.
    f.canvas.selectAll([f.canvas.nodes.get('b'), f.canvas.nodes.get('a')]); f.manager.refresh(); f.doc.flush();
    f.command('summary'); f.doc.flush();
    assert.equal(f.canvas.nodes.size, before + 1, 'one summary per run');
    assert.equal([...f.canvas.selection][0].id, created.id);
    // Dragging the centre carries the summary; folding hides it and its brace.
    const start = created.getData();
    const root = f.canvas.nodes.get('root');
    f.canvas.wrapperEl.dispatch('pointerdown', { ...pointer(f.canvas, 'root'), target: root.nodeEl }); f.doc.flush();
    root.moveTo({ x: root.getData().x + 100, y: root.getData().y + 50 });
    f.doc.defaultView.dispatch('pointermove', { pointerId: 1, clientX: 0, clientY: 0 }); f.doc.flush();
    assert.deepEqual([created.getData().x - start.x, created.getData().y - start.y], [100, 50], 'the summary travels with the dragged branch');
    f.doc.defaultView.dispatch('pointerup', { pointerId: 1, clientX: 0, clientY: 0 }); f.canvas.requestSave(); f.doc.flush();
    f.canvas.selectOnly(root); f.doc.flush();
    f.command('fold'); f.doc.flush();
    assert.equal(created.nodeEl.classList.contains('nf-canvas-hidden'), true, 'folded away with the branches it covers');
    assert.equal(layer.querySelectorAll('.nf-canvas-brace').length, 0, 'no brace for a hidden summary');
    f.command('fold'); f.doc.flush();
    assert.equal(created.nodeEl.classList.contains('nf-canvas-hidden'), false);
    assert.equal(layer.querySelectorAll('.nf-canvas-brace').length, 1);
    // Removing it.
    f.canvas.selectOnly(created); f.doc.flush();
    f.command('summary'); f.doc.flush();
    assert.equal(f.canvas.nodes.has(created.id), false, 'the summary is taken away');
    assert.equal([...f.canvas.selection][0]?.id, 'root', 'the card it hung from is selected');
    assert.equal(layer.querySelectorAll('.nf-canvas-brace').length, 0);
    f.canvas.undo(); f.manager.refresh(); f.doc.flush();
    assert.equal(f.canvas.nodes.has(created.id), true, 'undo brings it back');
    assert.equal(layer.querySelectorAll('.nf-canvas-brace').length, 1);
    const restored = f.canvas.nodes.get(created.id);
    f.manager.destroy();
    assert.equal(layer.querySelectorAll('.nf-canvas-braces').length, 0, 'teardown removes the braces');
    assert.equal(restored.nodeEl.classList.contains('nf-canvas-summary'), false);
  }

  /* ---------- style options: shape, text size, line weight ---------- */
  {
    const f = fixture(CanvasEnhancements, map());
    f.canvas.selectOnly(f.canvas.nodes.get('a')); f.doc.flush();
    f.command('shape-pill'); f.doc.flush();
    assert.equal(f.canvas.nodes.get('root').getData().nfShape, 'pill', 'stored on the root');
    for (const id of ['root', 'a', 'a1']) assert.equal(f.canvas.nodes.get(id).nodeEl.classList.contains('nf-shape-pill'), true, `${id} takes the shape`);
    assert.equal(f.canvas.nodes.get('free').nodeEl.classList.contains('nf-shape-pill'), false);
    f.command('shape-rounded'); f.doc.flush();
    assert.equal('nfShape' in f.canvas.nodes.get('root').getData(), false, 'the default removes the field');
    f.command('scale-large'); f.doc.flush();
    assert.equal(f.canvas.nodes.get('a').nodeEl.style.getPropertyValue('--nf-map-scale'), '1.2');
    f.command('weight-bold'); f.doc.flush();
    assert.equal(f.canvas.edges.get('e-a').lineGroupEl.style.getPropertyValue('--nf-line-scale'), '1.5');
    assert.equal(f.canvas.nodes.get('a').nodeEl.style.getPropertyValue('--nf-line-scale'), '1.5');
    f.command('weight-normal'); f.doc.flush();
    assert.equal(f.canvas.edges.get('e-a').lineGroupEl.style.getPropertyValue('--nf-line-scale'), '');
    f.settings.canvasShape = 'square'; f.settings.canvasBackground = 'plain'; f.manager.refresh(); f.doc.flush();
    assert.equal(f.canvas.nodes.get('a').nodeEl.classList.contains('nf-shape-square'), true, 'the settings supply the default shape');
    assert.equal(f.canvas.wrapperEl.classList.contains('nf-canvas-bg-plain'), true);
    f.manager.destroy();
    assert.equal(f.canvas.nodes.get('a').nodeEl.classList.contains('nf-shape-square'), false);
    assert.equal(f.canvas.wrapperEl.classList.contains('nf-canvas-bg-plain'), false);
  }

  /* ---------- typing: Space, F2, Mod+Enter, empty topics ---------- */
  {
    const f = fixture(CanvasEnhancements, map());
    f.settings.canvasComfortableEdit = true;
    f.settings.canvasEditorKeys = true;
    const cmFor = (f, id, text) => {
      const node = f.canvas.nodes.get(id);
      const dom = f.doc.createElement('div'), scrollDOM = f.doc.createElement('div'), contentDOM = f.doc.createElement('div');
      dom.append(scrollDOM); scrollDOM.append(contentDOM);
      const placeholder = f.doc.createElement('div'); placeholder.className = 'cm-placeholder'; placeholder.textContent = 'Type / for blocks'; contentDOM.append(placeholder);
      const cm = { dom, scrollDOM, contentDOM, composing: false, defaultLineHeight: 20, defaultCharacterWidth: 8, contentHeight: 20, dispatches: [],
        state: { doc: { toString: () => text, length: text.length, get lines() { return text.split('\n').length; } } },
        requestMeasure(spec) { if (spec?.read) spec.write(spec.read()); }, dispatch(spec) { this.dispatches.push(spec); }, focus() { this.focused = true; } };
      let editing = true;
      node.child = { getMode: () => editing ? 'source' : 'preview', editMode: { cm }, showPreview(save) { node.child.saved = save; editing = false; node.child.editMode = null; } };
      node.isEditing = true; node.nodeEl.classList.add('is-editing');
      return cm;
    };
    // Space edits with the caret at the end; F2 selects all.
    f.canvas.selectOnly(f.canvas.nodes.get('a')); f.canvas.wrapperEl.focus(); f.doc.flush();
    assert.equal(f.scope.dispatch(keyEvent(' ', f.canvas.wrapperEl)), false, 'Space is taken');
    assert.equal(f.canvas.nodes.get('a').isEditing, true);
    let cm = cmFor(f, 'a', 'Alpha'); f.manager.refresh(); f.doc.flush();
    assert.deepEqual(cm.dispatches[0], { selection: { anchor: 5 } }, 'the caret lands after the words');
    assert.equal(cm.focused, true);
    assert.equal(cm.contentDOM.querySelector('.cm-placeholder').textContent, 'Type a topic…', 'the placeholder asks for a topic');
    f.canvas.nodes.get('a').child.showPreview(true); f.canvas.nodes.get('a').isEditing = false; f.manager.refresh(); f.doc.flush();
    f.canvas.selectOnly(f.canvas.nodes.get('b')); f.doc.flush();
    f.scope.dispatch(keyEvent('F2', f.canvas.wrapperEl));
    cm = cmFor(f, 'b', 'Beta'); f.manager.refresh(); f.doc.flush();
    assert.deepEqual(cm.dispatches[0], { selection: { anchor: 0, head: 4 } }, 'F2 selects the words');
    // Mod+Enter finishes a note of several lines without growing anything.
    const count = f.canvas.nodes.size;
    cm = cmFor(f, 'b', 'Two\nlines'); f.manager.refresh(); f.doc.flush();
    const done = cm.contentDOM.dispatch('keydown', keyEvent('Enter', cm.contentDOM, { metaKey: true }));
    f.doc.flush();
    assert.equal(done.defaultPrevented, true);
    assert.equal(f.canvas.nodes.get('b').child.editMode, null, 'finished');
    assert.equal(f.canvas.nodes.size, count, 'nothing grows');
    f.canvas.nodes.get('b').isEditing = false; f.manager.refresh(); f.doc.flush();
    // A fresh card left empty vanishes when its editor closes, and the card it grew from is selected.
    f.canvas.selectOnly(f.canvas.nodes.get('a1')); f.doc.flush();
    f.command('sibling'); f.doc.flush();
    const blank = [...f.canvas.selection][0];
    assert.equal(blank.isEditing, true);
    cm = cmFor(f, blank.id, ''); f.manager.refresh(); f.doc.flush();
    blank.child.showPreview(true); blank.isEditing = false; blank.nodeEl.classList.remove('is-editing'); f.manager.refresh(); f.doc.flush();
    assert.equal(f.canvas.nodes.has(blank.id), false, 'an empty new card is taken away');
    assert.equal(f.canvas.edges.size, 3, 'and its connection with it');
    assert.equal([...f.canvas.selection][0]?.id, 'a1', 'the card it grew from is selected');
    // With the typing flow off, empty cards stay.
    f.settings.canvasEditorKeys = false;
    f.canvas.selectOnly(f.canvas.nodes.get('a1')); f.doc.flush();
    f.command('sibling'); f.doc.flush();
    const kept = [...f.canvas.selection][0];
    kept.child = { getMode: () => 'preview' }; kept.isEditing = false; kept.nodeEl.classList.remove('is-editing'); f.manager.refresh(); f.doc.flush();
    assert.equal(f.canvas.nodes.has(kept.id), true);
    f.manager.destroy();
  }

  /* ---------- layout panel: structures, branch structures, alignment ---------- */
  {
    const f = fixture(CanvasEnhancements, map());
    f.canvas.selectOnly(f.canvas.nodes.get('a')); f.doc.flush();
    tb(f, 'Layout').dispatch('click'); f.doc.flush();
    const panel = f.canvas.wrapperEl.querySelector('.nf-canvas-layout-panel');
    assert.ok(panel, 'the layout panel opens like the style panel');
    assert.equal(tb(f, 'Layout').getAttribute('aria-pressed'), 'true');
    assert.equal(tb(f, 'Layout').classList.contains('nf-canvas-action-menu'), false, 'no menu caret any more');
    const tiles = panel.querySelectorAll('.nf-canvas-style-tile');
    assert.deepEqual(tiles.map((tile) => tile.dataset.layout), ['balanced', 'right', 'left', 'down', 'up', 'tree', 'timeline', 'timeline-vertical']);
    assert.ok(tiles.every((tile) => tile.querySelector('.nf-canvas-layout-thumb')), 'each structure has a miniature');
    assert.equal(tiles.find((tile) => tile.dataset.layout === 'right').getAttribute('aria-pressed'), 'true', 'the map\'s structure is marked');
    const option = (kind, value) => panel.querySelectorAll('.nf-canvas-style-option').find((button) => button.dataset.kind === kind && button.dataset.value === value);
    assert.equal(option('branch', 'inherit').getAttribute('aria-pressed'), 'true', 'a branch follows the map by default');
    assert.equal(option('align', 'center').getAttribute('aria-pressed'), 'true');
    assert.equal(option('spacing', 'standard').getAttribute('aria-pressed'), 'true');
    // A branch's structures carry the tiles' short names, which fit; the full name is read out and shown as the tooltip.
    const branchButtons = panel.querySelectorAll('.nf-canvas-style-option').filter((button) => button.dataset.kind === 'branch');
    assert.deepEqual(branchButtons.map((button) => button.querySelectorAll('span').at(-1).textContent),
      ['Default', 'Rightward', 'Leftward', 'Downward', 'Upward', 'Tree chart', 'Timeline', 'Vertical']);
    assert.equal(option('branch', 'right').getAttribute('aria-label'), 'Rightward · Logic chart (right)');
    assert.equal(option('branch', 'inherit').getAttribute('aria-label'), 'Default · Follow the map');
    assert.equal(option('branch', 'tree').getAttribute('aria-label'), 'Tree chart', 'one name when short and full agree');
    assert.equal(option('branch', 'right').title, undefined, 'no second tooltip');
    assert.equal(tiles.find((tile) => tile.dataset.layout === 'down').getAttribute('aria-label'), 'Downward · Org chart (down)', 'the tiles name themselves the same way');
    assert.equal(tiles.find((tile) => tile.dataset.layout === 'balanced').getAttribute('aria-label'), 'Mind map');
    const branchSection = panel.querySelectorAll('.nf-canvas-style-section')[1];
    const [, branchBody, branchNone] = branchSection.children;
    assert.equal(branchNone.textContent, 'Select a branch to lay it out on its own');
    assert.ok(branchNone.classList.contains('nf-canvas-style-hint'));
    assert.ok(branchBody.contains(option('branch', 'tree')), 'the options sit in their own wrapper');
    assert.equal(branchBody.hidden, false, 'with a branch selected its structures show');
    assert.equal(branchNone.hidden, true);
    // A structure tile lays the map out again.
    tiles.find((tile) => tile.dataset.layout === 'down').dispatch('click'); f.doc.flush();
    assert.equal(f.canvas.nodes.get('root').getData().nfLayout, 'down');
    assert.ok(f.canvas.nodes.get('a').getData().y > f.canvas.nodes.get('root').getData().y + 100, 'branches now hang below');
    assert.equal(tiles.find((tile) => tile.dataset.layout === 'down').getAttribute('aria-pressed'), 'true');
    tiles.find((tile) => tile.dataset.layout === 'right').dispatch('click'); f.doc.flush();
    // A branch takes a structure of its own; its children follow it, the rest of the map does not.
    const step = f.canvas.history.current;
    option('branch', 'tree').dispatch('click'); f.doc.flush();
    assert.equal(f.canvas.nodes.get('a').getData().nfBranch, 'tree', 'stored on the branch');
    assert.equal(f.canvas.history.current, step + 1, 'one undo step');
    const a = f.canvas.nodes.get('a').getData(), a1 = f.canvas.nodes.get('a1').getData(), b = f.canvas.nodes.get('b').getData(), root = f.canvas.nodes.get('root').getData();
    assert.ok(a1.y > a.y + a.height && a1.x > a.x, 'the child hangs below its branch, indented');
    assert.ok(b.x > root.x + root.width && Math.abs(b.y + b.height / 2 - (root.y + root.height / 2)) < 400, 'the other branch still grows right');
    assert.equal(option('branch', 'tree').getAttribute('aria-pressed'), 'true');
    assert.equal(f.canvas.nodes.get('a').nodeEl.querySelectorAll('.nf-canvas-add').length, 0, 'a branch with children shows no + handle');
    assert.equal(f.canvas.nodes.get('a1').nodeEl.querySelectorAll('.nf-canvas-add')[0]?.dataset.side, 'bottom', 'the leaf grows the way its structure goes');
    option('branch', 'inherit').dispatch('click'); f.doc.flush();
    assert.equal('nfBranch' in f.canvas.nodes.get('a').getData(), false, 'following the map removes the field');
    assert.ok(Math.abs(f.canvas.nodes.get('a1').getData().y + 60 - f.canvas.nodes.get('a').getData().y - 60) < 1, 'and the child is beside its branch again');
    // Children line up from the top.
    option('align', 'start').dispatch('click'); f.doc.flush();
    assert.equal(f.canvas.nodes.get('root').getData().nfAlign, 'start');
    assert.equal(f.canvas.nodes.get('a').getData().y, f.canvas.nodes.get('root').getData().y, 'the first branch starts level with the centre');
    option('align', 'center').dispatch('click'); f.doc.flush();
    assert.equal('nfAlign' in f.canvas.nodes.get('root').getData(), false);
    // The root has no branch structure; the section says what to do instead of showing dead buttons.
    f.canvas.selectOnly(f.canvas.nodes.get('root')); f.doc.flush();
    assert.equal(option('branch', 'inherit').disabled, true);
    assert.equal(branchBody.hidden, true, 'no disabled grid for the root');
    assert.equal(branchNone.hidden, false, 'one line saying how to lay out a branch');
    f.canvas.selectOnly(f.canvas.nodes.get('a')); f.doc.flush();
    assert.equal(branchBody.hidden, false);
    assert.equal(branchNone.hidden, true);
    f.canvas.selectOnly(f.canvas.nodes.get('root')); f.doc.flush();
    assert.equal(f.command('branch-tree', true), false);
    assert.equal(f.command('align-start', true), true);
    // One panel at a time; teardown.
    tb(f, 'Style').dispatch('click'); f.doc.flush();
    assert.equal(f.canvas.wrapperEl.querySelector('.nf-canvas-layout-panel'), null, 'the style panel takes its place');
    tb(f, 'Layout').dispatch('click'); f.doc.flush();
    assert.equal(f.canvas.wrapperEl.querySelector('.nf-canvas-style-panel:not(.nf-canvas-layout-panel)'), null);
    f.manager.destroy();
    assert.equal(f.canvas.wrapperEl.querySelector('.nf-canvas-layout-panel'), null);
  }

  /* ---------- dragging a map card: Canvas's snap guides stay out of it, for that drag only ---------- */
  {
    const f = fixture(CanvasEnhancements, map());
    const options = f.canvas.options = { snapToObjects: true, snapToGrid: true };
    const wrapper = f.canvas.wrapperEl;
    const win = f.doc.defaultView;
    const press = (id) => wrapper.dispatch('pointerdown', { ...pointer(f.canvas, id), target: f.canvas.nodes.get(id).nodeEl });
    press('a');
    assert.equal(options.snapToObjects, false, 'a map card drags without snapping to other cards');
    assert.equal(options.snapToGrid, true, 'the grid is left alone');
    assert.ok(wrapper.classList.contains('nf-canvas-map-drag'));
    assert.equal(win.listeners('blur'), 1);
    win.dispatch('pointerup', { ...pointer(f.canvas, 'a') });
    assert.equal(options.snapToObjects, false, 'still off while Canvas places the card on this pointerup');
    f.doc.flush();
    assert.equal(options.snapToObjects, true, 'given back once the drag is over');
    assert.equal(wrapper.classList.contains('nf-canvas-map-drag'), false);
    assert.equal(win.listeners('blur'), 0);
    // A quick second press keeps it off: the first release must not turn it on mid-drag.
    press('a');
    win.dispatch('pointerup', { ...pointer(f.canvas, 'a') });
    press('b');
    f.doc.flush();
    assert.equal(options.snapToObjects, false, 'the second drag is still without snapping');
    win.dispatch('pointerup', { ...pointer(f.canvas, 'b') }); f.doc.flush();
    assert.equal(options.snapToObjects, true);
    // Free cards and the empty canvas keep Canvas's snapping.
    press('free');
    assert.equal(options.snapToObjects, true, 'a free card snaps as always');
    assert.equal(wrapper.classList.contains('nf-canvas-map-drag'), false);
    win.dispatch('pointerup', { ...pointer(f.canvas, 'free') }); f.doc.flush();
    wrapper.dispatch('pointerdown', { clientX: 3000, clientY: 3000, pointerType: 'mouse', pointerId: 1, button: 0, isPrimary: true, target: wrapper });
    assert.equal(options.snapToObjects, true, 'so does a marquee');
    win.dispatch('pointerup', { clientX: 3000, clientY: 3000, pointerId: 1 }); f.doc.flush();
    // A connection point starts a connection, not a drag.
    const point = f.doc.createElement('div');
    point.className = 'canvas-node-connection-point';
    f.canvas.nodes.get('a').nodeEl.append(point);
    wrapper.dispatch('pointerdown', { ...pointer(f.canvas, 'a'), target: point });
    assert.equal(options.snapToObjects, true, 'dragging out a connection keeps snapping');
    win.dispatch('pointerup', { ...pointer(f.canvas, 'a') }); f.doc.flush();
    point.remove();
    // The window losing focus mid-drag gives it back.
    press('a');
    win.dispatch('blur');
    assert.equal(options.snapToObjects, true, 'a blur ends the hold');
    assert.equal(wrapper.classList.contains('nf-canvas-map-drag'), false);
    win.dispatch('pointerup', { ...pointer(f.canvas, 'a') }); f.doc.flush();
    assert.equal(options.snapToObjects, true);
    // A choice made in Canvas's own menu mid-drag stands.
    press('a');
    options.snapToObjects = true;
    win.dispatch('pointerup', { ...pointer(f.canvas, 'a') }); f.doc.flush();
    assert.equal(options.snapToObjects, true);
    options.snapToObjects = false;
    press('a');
    win.dispatch('pointerup', { ...pointer(f.canvas, 'a') }); f.doc.flush();
    assert.equal(options.snapToObjects, false, 'off before, off after: only our own change is undone');
    options.snapToObjects = true;
    // Teardown mid-drag gives it back too.
    press('a');
    f.manager.destroy();
    assert.equal(options.snapToObjects, true, 'destroy ends the hold');
    assert.equal(wrapper.classList.contains('nf-canvas-map-drag'), false);
    assert.equal(win.listeners('blur'), 0);
  }
  {
    // Options without the field: it is left without it.
    const f = fixture(CanvasEnhancements, map());
    const options = f.canvas.options = {};
    f.canvas.wrapperEl.dispatch('pointerdown', { ...pointer(f.canvas, 'a'), target: f.canvas.nodes.get('a').nodeEl });
    assert.equal(options.snapToObjects, false);
    f.doc.defaultView.dispatch('pointerup', { ...pointer(f.canvas, 'a') }); f.doc.flush();
    assert.equal(options.snapToObjects, undefined);
    assert.equal('snapToObjects' in options, false, 'nothing left behind to save');
    // No options at all: nothing happens, and nothing breaks.
    delete f.canvas.options;
    f.canvas.wrapperEl.dispatch('pointerdown', { ...pointer(f.canvas, 'a'), target: f.canvas.nodes.get('a').nodeEl });
    assert.equal(f.canvas.wrapperEl.classList.contains('nf-canvas-map-drag'), false);
    f.doc.defaultView.dispatch('pointerup', { ...pointer(f.canvas, 'a') }); f.doc.flush();
    f.manager.destroy();
  }

  console.log('PASS canvas toolbox: labelled toolbar, connect tool, markers, numbering, guide, typing flow, summaries, style options, the layout panel, and map drags without snapping');
} finally {
  await rm(directory, { recursive: true, force: true });
}
