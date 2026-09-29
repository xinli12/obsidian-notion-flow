import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { FakeElement, FakeScope, fakeDocument, nodeData, edgeData, clone, keyEvent, fakeCanvas, fixture } from './canvas-fixture.mjs';

const directory = await mkdtemp(join(tmpdir(), 'notion-flow-canvas-enhancements-'));
try {
  const outfile = join(directory, 'enhancements.mjs');
  await build({ entryPoints: [fileURLToPath(new URL('../src/canvas/enhancements.ts', import.meta.url))], bundle: true,
    alias: { obsidian: fileURLToPath(new URL('./obsidian-stub.mjs', import.meta.url)) },
    format: 'esm', platform: 'node', outfile, logLevel: 'silent' });
  const { CanvasEnhancements, canvasTransaction, canvasAdjustment, canvasKeyAction, supportedCanvas, cardCount } = await import(pathToFileURL(outfile).href);

  // Counts of cards: the singular key for one, the plural with its number otherwise.
  assert.equal(cardCount('Created 1 card from the list.', 'Created {count} cards from the list.', 1), 'Created 1 card from the list.');
  assert.equal(cardCount('Created 1 card from the list.', 'Created {count} cards from the list.', 4), 'Created 4 cards from the list.');
  assert.equal(cardCount('Unfold 1 card: {names}', 'Unfold {count} cards: {names}', 0), 'Unfold 0 cards: {names}', 'other placeholders are left for the caller');
  assert.equal(cardCount('已从列表生成 1 张卡片。', '已从列表生成 {count} 张卡片。', 12), '已从列表生成 12 张卡片。');

  const native = fakeCanvas(fakeDocument(), { nodes: [nodeData('root')], edges: [] });
  assert.equal(supportedCanvas(native), true);
  for (const bad of [null, {}, { ...native, history: null }, { ...native, nodes: { get: true } }, { ...native, requestSave: undefined }, { ...native, wrapperEl: { ownerDocument: { defaultView: null } } }]) assert.equal(supportedCanvas(bad), false);
  native.nodes.get('root').moveTo({ x: 10, y: 0 });
  native.requestSave(); // pending native move must become its own undo point
  canvasTransaction(native, () => native.nodes.get('root').moveTo({ x: 20, y: 0 }));
  canvasTransaction(native, () => native.nodes.get('root').moveTo({ x: 30, y: 0 }));
  assert.deepEqual(native.history.data.map(data => data.nodes[0].x), [0, 10, 20, 30], 'no duplicate undo points between native edits and rapid plugin actions');
  native.undo(); assert.equal(native.nodes.get('root').getData().x, 20);
  native.undo(); assert.equal(native.nodes.get('root').getData().x, 10);
  native.redo(); assert.equal(native.nodes.get('root').getData().x, 20);
  canvasTransaction(native, () => native.nodes.get('root').moveTo({ x: 40, y: 0 }));
  assert.deepEqual(native.history.data.map(data => data.nodes[0].x), [0, 10, 20, 40], 'a fresh action replaces only the redo branch');
  const blank = fakeCanvas(fakeDocument(), { nodes: [], edges: [] }, false);
  canvasTransaction(blank, () => blank.importData({ nodes: [nodeData('first')], edges: [] }, false));
  blank.undo(); assert.equal(blank.nodes.size, 0, 'the first action on a pristine canvas is undoable');
  assert.throws(() => canvasTransaction(native, () => { native.nodes.get('root').moveTo({ x: 50, y: 0 }); throw new Error('partial mutation'); }), /partial mutation/);
  native.undo(); assert.equal(native.nodes.get('root').getData().x, 40, 'partially failed actions remain undoable');

  assert.equal(canvasKeyAction(keyEvent('Tab')), 'child');
  assert.equal(canvasKeyAction(keyEvent('Tab', null, { shiftKey: true })), 'parent');
  assert.equal(canvasKeyAction(keyEvent('Enter', null, { altKey: true })), 'sibling');
  assert.equal(canvasKeyAction(keyEvent('ArrowRight', null, { altKey: true, shiftKey: true })), 'moveDown');
  assert.equal(canvasKeyAction(keyEvent('ArrowUp', null, { altKey: true, shiftKey: true })), 'moveUp');
  assert.equal(canvasKeyAction(keyEvent('/', null, { metaKey: true })), 'fold');
  assert.equal(canvasKeyAction(keyEvent('/', null, { ctrlKey: true })), 'fold');
  assert.equal(canvasKeyAction(keyEvent('F2')), 'edit');
  assert.equal(canvasKeyAction(keyEvent('f', null, { metaKey: true })), 'find', 'Mod+F finds in place');
  assert.equal(canvasKeyAction(keyEvent('F', null, { ctrlKey: true, shiftKey: true })), 'search', 'Mod+Shift+F opens the card search');
  assert.equal(canvasKeyAction(keyEvent('f', null, { metaKey: true, shiftKey: true, repeat: true })), null);
  assert.equal(canvasKeyAction(keyEvent('ArrowDown', null, { altKey: true, repeat: true })), 'down', 'held Alt+arrows keep walking');
  assert.equal(canvasKeyAction(keyEvent('F4')), 'note', 'F4 edits the card note, as in XMind');
  assert.equal(canvasKeyAction(keyEvent('F4', null, { shiftKey: true })), 'addNote', 'Shift+F4 adds another note');
  assert.equal(canvasKeyAction(keyEvent('k', null, { metaKey: true })), 'link', 'Mod+K links the card, as it links words');
  assert.equal(canvasKeyAction(keyEvent('K', null, { ctrlKey: true })), 'link');
  assert.equal(canvasKeyAction(keyEvent('k', null, { metaKey: true, shiftKey: true })), null);
  for (const event of [keyEvent('Enter'), keyEvent('ArrowRight'), keyEvent('Tab', null, { isComposing: true }), keyEvent('Tab', null, { repeat: true }), keyEvent('Tab', null, { metaKey: true }), keyEvent('Tab', null, { ctrlKey: true }), keyEvent('/', null, { metaKey: true, shiftKey: true }), keyEvent('/', null, { metaKey: true, repeat: true })]) assert.equal(canvasKeyAction(event), null);

  const data = { customMetadata: { retained: true }, nodes: [nodeData('root', 0, 0, { color: '3' }), nodeData('child', 500), nodeData('other', -500), nodeData('outside', -900)],
    edges: [edgeData('branch', 'root', 'child', { customField: 'keep' }), edgeData('elsewhere', 'other', 'outside', { label: 'other label' })] };
  const f = fixture(CanvasEnhancements, data);
  // Toolbar buttons are named with their shortcut: "Add child · Tab".
  const face = (fx, label) => fx.canvas.wrapperEl.querySelectorAll('button').find(item => (item.getAttribute('aria-label') ?? '').split(' · ')[0] === label);
  assert.equal(f.canvas.wrapperEl.querySelectorAll('.nf-canvas-toolbar').length, 1);
  f.manager.refresh(); f.workspace.emit('layout-change');
  assert.equal(f.canvas.wrapperEl.querySelectorAll('.nf-canvas-toolbar').length, 1, 'repeated layout events do not duplicate controls');
  assert.equal(f.scope.keys.length, 29);
  assert.deepEqual(f.scope.keys.slice(0, 5).map(handler => handler.key), ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Enter'], 'map keys run before Canvas’s own handlers');
  assert.equal(f.scope.keys.some(handler => handler.key === 'Escape'), false, 'native and parent Escape scopes are never shadowed');
  assert.equal(f.command('child', true), false);
  f.canvas.selectOnly(f.canvas.nodes.get('root')); f.doc.flush();
  assert.equal(face(f, 'Add child').disabled, false, 'single is-focused class changes refresh controls');
  assert.equal(face(f, 'Add sibling').disabled, false, 'a free card with no parent gets the next card of its own');
  f.canvas.selectOnly(f.canvas.nodes.get('child')); f.doc.flush();
  assert.equal(face(f, 'Add sibling').disabled, false);
  f.settings.canvasAppearance = false; f.manager.refresh();
  assert.equal(f.canvas.wrapperEl.classList.contains('nf-canvas-polished'), false);
  f.settings.canvasAppearance = true; f.manager.refresh();

  // Key safety must use both the event target and active DOM focus.
  f.canvas.wrapperEl.focus();
  const previousSaves = f.canvas.saves;
  for (const [tag, cls, editable] of [['input'], ['textarea'], ['select'], ['button'], ['div', 'cm-editor'], ['div', 'metadata-container'], ['div', 'inline-title'], ['div', '', true]]) {
    const control = f.doc.createElement(tag); control.className = cls ?? ''; if (editable) control.setAttribute('contenteditable', 'true');
    const child = f.doc.createElement('span'); control.append(child); f.canvas.wrapperEl.append(control); control.focus();
    assert.equal(f.scope.dispatch(keyEvent('Tab', child)), undefined);
    control.remove();
  }
  const modal = f.doc.createElement('div'); f.doc.body.append(modal); modal.focus();
  assert.equal(f.scope.dispatch(keyEvent('Tab', f.canvas.wrapperEl)), undefined, 'unrelated focused overlays are ignored');
  f.canvas.wrapperEl.focus();
  f.canvas.nodes.get('child').isEditing = true;
  assert.equal(f.scope.dispatch(keyEvent('Tab', f.canvas.wrapperEl)), undefined);
  f.canvas.nodes.get('child').child = { getMode: () => 'source' };
  assert.equal(f.command('child', true), false);
  const nativeEditorIframe = f.doc.createElement('iframe');
  f.canvas.nodes.get('child').nodeEl.append(nativeEditorIframe);
  f.canvas.nodes.get('child').child.getMode = () => 'preview';
  nativeEditorIframe.remove(); f.doc.flush();
  assert.equal(face(f, 'Add child').disabled, false, 'native Escape returning to preview overrides a stale isEditing flag');
  delete f.canvas.nodes.get('child').child;
  f.canvas.nodes.get('child').isEditing = false;
  for (const extra of [{ isComposing: true }, { repeat: true }, { defaultPrevented: true }]) assert.equal(f.scope.dispatch(keyEvent('Tab', f.canvas.wrapperEl, extra)), undefined);
  f.settings.canvasKeyboard = false; assert.equal(f.scope.dispatch(keyEvent('Tab', f.canvas.wrapperEl)), undefined); f.settings.canvasKeyboard = true;
  f.settings.canvasEnhancements = false; assert.equal(f.scope.dispatch(keyEvent('Tab', f.canvas.wrapperEl)), undefined); f.settings.canvasEnhancements = true;
  f.canvas.readonly = true;
  assert.equal(f.scope.dispatch(keyEvent('Tab', f.canvas.wrapperEl)), undefined);
  assert.equal(f.command('child', true), false);
  f.canvas.readonly = false;
  assert.equal(f.canvas.saves, previousSaves, 'ignored keys never save');
  assert.equal(f.scope.dispatch(keyEvent('Tab', f.canvas.wrapperEl, { shiftKey: true })), false);
  assert.equal([...f.canvas.selection][0].id, 'root', 'Shift+Tab selects the parent');
  assert.equal(f.scope.dispatch(keyEvent('ArrowRight', f.canvas.wrapperEl)), undefined, 'plain arrows remain native');
  assert.equal(f.scope.dispatch(keyEvent('ArrowRight', f.canvas.wrapperEl, { altKey: true })), false);
  assert.equal([...f.canvas.selection][0].id, 'child');
  f.canvas.selectOnly(f.canvas.nodes.get('child'));
  // Enter adds the next card: beside a free card, a sibling from the same parent, ready to type into.
  assert.equal(f.scope.dispatch(keyEvent('Enter', f.canvas.wrapperEl)), false, 'Enter adds a sibling beside a free card');
  const enterSibling = [...f.canvas.selection][0];
  assert.notEqual(enterSibling.id, 'child');
  assert.equal(enterSibling.isEditing, true);
  assert.equal([...f.canvas.edges.values()].find(edge => edge.getData().toNode === enterSibling.id).getData().fromNode, 'root');
  assert.ok(!f.canvas.nodes.get('child').isEditing, 'the selected card itself is not opened');
  f.canvas.undo();
  assert.deepEqual(f.canvas.getData(), data);
  f.canvas.selectOnly(f.canvas.nodes.get('child'));
  assert.equal(f.scope.dispatch(keyEvent('Enter', f.canvas.wrapperEl, { altKey: true })), false);
  const newSibling = [...f.canvas.selection][0];
  assert.equal(newSibling.isEditing, true);
  const createdEdge = [...f.canvas.edges.values()].find(edge => edge.getData().toNode === newSibling.id).getData();
  assert.equal(createdEdge.fromNode, 'root');
  assert.equal(newSibling.getData().color, '3');
  assert.deepEqual(f.canvas.getData().customMetadata, data.customMetadata);
  assert.equal(f.canvas.edges.get('branch').getData().customField, 'keep');
  f.canvas.undo();
  assert.deepEqual(f.canvas.getData(), data, 'one undo restores the entire child+edge action, including all metadata');

  f.canvas.selectOnly(f.canvas.nodes.get('root')); f.canvas.wrapperEl.focus();
  const rootPosition = f.canvas.nodes.get('root').getData();
  assert.equal(f.command('left'), true);
  assert.ok(f.canvas.nodes.get('child').getData().x < rootPosition.x);
  assert.deepEqual(f.canvas.nodes.get('root').getData(), { ...rootPosition, width: 160, height: 64, nfLayout: 'left' }, 'layout keeps its root anchored, fits its new type size, and marks the map');
  assert.deepEqual(f.canvas.nodes.get('other').getData(), data.nodes[2], 'layout preserves unrelated cards');
  assert.deepEqual(f.canvas.edges.get('branch').getData(), { ...data.edges[0], fromSide: 'left', toSide: 'right' }, 'layout changes only attachment sides on tree edges');
  assert.deepEqual(f.canvas.edges.get('elsewhere').getData(), data.edges[1]);
  const arrangedHistory = clone(f.canvas.history.data);
  const arrangedSaves = f.canvas.saves;
  assert.equal(f.command('left'), true);
  assert.deepEqual(f.canvas.history.data, arrangedHistory, 'repeating an identical layout adds no undo point');
  assert.equal(f.canvas.saves, arrangedSaves, 'no-op layout does not request a save');
  f.canvas.undo(); assert.deepEqual(f.canvas.getData(), data, 'layout undoes in one step');
  f.canvas.selectOnly(f.canvas.nodes.get('root'));
  f.canvas.selection.add(f.canvas.nodes.get('child'));
  assert.equal(f.command('child', true), false, 'multi-selection is never implicitly expanded');
  f.canvas.selectOnly(f.canvas.nodes.get('root'));
  assert.equal(f.scope.dispatch(keyEvent('Tab', f.canvas.wrapperEl)), false);
  assert.equal(f.canvas.nodes.size, data.nodes.length + 1);
  f.canvas.undo(); f.canvas.selectOnly(f.canvas.nodes.get('root')); f.doc.flush();
  assert.equal(f.command('focus'), true);
  assert.equal(f.canvas.nodes.get('other').nodeEl.classList.contains('nf-canvas-muted'), true);
  assert.equal(f.canvas.edges.get('elsewhere').labelElement.wrapperEl.classList.contains('nf-canvas-muted'), true, 'label controllers use their wrapperEl');
  assert.equal(f.canvas.edges.get('branch').lineGroupEl.classList.contains('nf-canvas-muted'), false);
  assert.equal(f.canvas.wrapperEl.dispatch('keydown', keyEvent('Escape', f.canvas.wrapperEl)).defaultPrevented, true);
  assert.equal(f.canvas.nodes.get('other').nodeEl.classList.contains('nf-canvas-muted'), false);
  assert.equal(f.canvas.wrapperEl.dispatch('keydown', keyEvent('Escape', f.canvas.wrapperEl)).defaultPrevented, false, 'Escape stays native when focus mode is inactive');
  f.command('focus'); f.view.file = { path: 'another.canvas' }; f.manager.refresh();
  assert.equal(f.canvas.nodes.get('other').nodeEl.classList.contains('nf-canvas-muted'), false, 'focus mode does not leak between files in a reused view');
  f.command('focus');
  const detached = f.canvas.nodes.get('other').nodeEl; detached.remove();
  const originalScope = f.scope; f.view.scope = new FakeScope();
  f.canvas.wrapperEl.dispatch('pointerup'); assert.ok(f.doc.pendingFrames() > 0);
  f.manager.destroy(); f.doc.flush();
  assert.equal(originalScope.keys.length, 0, 'teardown unregisters from the scope that originally owned each handler');
  assert.equal(f.doc.connectedObservers(), 0);
  assert.equal(f.doc.pendingFrames(), 0);
  assert.equal(detached.classList.contains('nf-canvas-muted'), false, 'detached offscreen nodes are cleaned');
  assert.equal(f.canvas.edges.get('elsewhere').labelElement.wrapperEl.classList.contains('nf-canvas-muted'), false);
  assert.equal(f.canvas.wrapperEl.querySelectorAll('.nf-canvas-toolbar').length, 0);
  assert.equal(f.canvas.wrapperEl.events.get('pointerup').size, 0);
  assert.equal(f.canvas.wrapperEl.events.get('keydown').size, 0);
  f.workspace.emit('layout-change'); assert.equal(f.canvas.wrapperEl.querySelectorAll('.nf-canvas-toolbar').length, 0, 'stopped managers cannot reattach');

  const lifecycle = fixture(CanvasEnhancements, data);
  lifecycle.canvas.selectOnly(lifecycle.canvas.nodes.get('root'));
  const retainedBinding = lifecycle.manager.bindings.get(lifecycle.view);
  const retainedMenuAction = () => retainedBinding.run('left');
  const untouchedHistory = clone(lifecycle.canvas.history.data);
  lifecycle.settings.canvasEnhancements = false;
  assert.equal(retainedMenuAction(), false, 'an open menu cannot mutate after the setting is disabled, even before refresh');
  assert.deepEqual(lifecycle.canvas.history.data, untouchedHistory);
  lifecycle.settings.canvasEnhancements = true;
  const savedCanvas = lifecycle.view.canvas;
  lifecycle.view.canvas = fakeCanvas(lifecycle.doc, data);
  assert.equal(retainedMenuAction(), false, 'an old menu cannot mutate a canvas after its view has replaced it');
  lifecycle.view.canvas = savedCanvas;
  lifecycle.settings.canvasEnhancements = false; lifecycle.manager.refresh();
  assert.equal(retainedMenuAction(), false, 'disposed binding closures remain inert');
  assert.equal(lifecycle.scope.keys.length, 0);
  assert.equal(lifecycle.canvas.wrapperEl.querySelectorAll('.nf-canvas-toolbar').length, 0);
  lifecycle.settings.canvasEnhancements = true; lifecycle.manager.refresh();
  assert.equal(lifecycle.scope.keys.length, 29);
  const oldCanvas = lifecycle.canvas;
  lifecycle.view.canvas = fakeCanvas(lifecycle.doc, data); lifecycle.manager.refresh();
  assert.equal(oldCanvas.wrapperEl.querySelectorAll('.nf-canvas-toolbar').length, 0);
  assert.equal(lifecycle.view.canvas.wrapperEl.querySelectorAll('.nf-canvas-toolbar').length, 1);
  lifecycle.workspace.leaves = []; lifecycle.workspace.emit('layout-change');
  assert.equal(lifecycle.scope.keys.length, 0);
  assert.equal(lifecycle.view.canvas.wrapperEl.querySelectorAll('.nf-canvas-toolbar').length, 0, 'closing a view disposes its binding');
  lifecycle.manager.destroy();
  assert.equal(retainedBinding.canRun('reset'), false, 'even display actions are disabled after disposal');

  const isolated = fixture(CanvasEnhancements, { nodes: [nodeData('root')], edges: [] });
  isolated.canvas.selectOnly(isolated.canvas.nodes.get('root'));
  assert.equal(isolated.command('right'), true);
  assert.equal(isolated.canvas.history.data.length, 2, 'marking a lone card as a map is one undo step');
  assert.equal(isolated.command('right'), true);
  assert.equal(isolated.canvas.history.data.length, 2, 'repeating it adds none');
  isolated.manager.destroy();


  /* ---------- follow-up adjustments join the native undo step ---------- */
  const amendCanvas = fakeCanvas(fakeDocument(), { nodes: [nodeData('n')], edges: [] });
  amendCanvas.nodes.get('n').moveTo({ x: 10, y: 0 }); amendCanvas.requestSave();
  assert.equal(canvasAdjustment(amendCanvas, () => { amendCanvas.nodes.get('n').moveTo({ x: 15, y: 0 }); return true; }), true);
  assert.deepEqual(amendCanvas.history.data.map(item => item.nodes[0].x), [0, 15], 'a pending native change and its adjustment are one step');
  assert.equal(canvasAdjustment(amendCanvas, () => { amendCanvas.nodes.get('n').moveTo({ x: 20, y: 0 }); return true; }), true);
  assert.deepEqual(amendCanvas.history.data.map(item => item.nodes[0].x), [0, 15, 20], 'without a pending change it is its own step');
  assert.equal(canvasAdjustment(amendCanvas, () => false), false);
  assert.equal(amendCanvas.history.data.length, 3, 'no change, no step');

  /* ---------- mind maps ---------- */
  const at = (m, id) => m.canvas.nodes.get(id).getData();
  const centerY = item => item.y + item.height / 2;
  const win = m => m.doc.defaultView;
  const drag = (m, id, to, pointer) => {
    const node = m.canvas.nodes.get(id);
    m.canvas.wrapperEl.dispatch('pointerdown', { button: 0, isPrimary: true, pointerId: 1, target: node.nodeEl });
    node.moveTo(to);
    win(m).dispatch('pointermove', { pointerId: 1, clientX: pointer?.x ?? -9999, clientY: pointer?.y ?? -9999 });
    m.doc.flush();
  };
  const drop = (m, pointer) => {
    win(m).dispatch('pointerup', { type: 'pointerup', pointerId: 1, clientX: pointer?.x ?? -9999, clientY: pointer?.y ?? -9999 });
    m.canvas.requestSave(); // Canvas records the drag after our capture listener
    m.doc.flush();
  };

  {
    // A compact persisted topic is edited in place, at its own size, without
    // changing either Canvas geometry or its undo stack. The fake preview above
    // measures actual wrapping at each candidate clone width; native fitting is forbidden.
    const e = fixture(CanvasEnhancements, {
      nodes: [nodeData('r', 0, 0, { nfLayout: 'right', width: 160, height: 64 }),
        nodeData('n', 232, 16, { width: 80, height: 32, text: 'Small' })],
      edges: [edgeData('r-n', 'r', 'n')],
    });
    e.settings.canvasAnimation = false;
    e.doc.flush();
    const begin = id => {
      const node = e.canvas.nodes.get(id);
      e.canvas.selectOnly(node); node.startEditing(); e.manager.refresh(); e.doc.flush();
      return node;
    };
    const end = (node, text, flush = true) => {
      const changed = text !== undefined && text !== node.data.text;
      if (text !== undefined) node.data.text = text;
      node.isEditing = false; node.nodeEl.classList.remove('is-editing'); node.render();
      if (changed) e.canvas.requestSave();
      e.manager.refresh();
      if (flush) e.doc.flush();
    };
    const before = clone(e.canvas.getData());
    const historyBefore = clone(e.canvas.history);
    const savesBefore = e.canvas.saves;
    const small = begin('n');
    assert.equal(small.nodeEl.classList.contains('nf-canvas-editing'), true);
    assert.equal(small.nodeEl.style.getPropertyValue('--nf-editor-width'), '80px', 'the editor opens at exactly the card: no minimum panel');
    assert.equal(small.nodeEl.style.getPropertyValue('--nf-editor-height'), '32px');
    assert.equal(small.nodeEl.style.getPropertyValue('--nf-editor-scale'), '', 'and no zoom compensation');
    assert.deepEqual(e.canvas.getData(), before, 'the editor never enters the saved card geometry');
    assert.deepEqual(e.canvas.history, historyBefore, 'opening an editor adds no history step');
    end(small);
    assert.equal(small.nodeEl.classList.contains('nf-canvas-editing'), false);
    assert.equal(small.nodeEl.style.getPropertyValue('--nf-editor-width'), '');
    assert.deepEqual(e.canvas.getData(), before, 'opening and closing without typing preserves a manual size');
    assert.deepEqual(e.canvas.history, historyBefore);
    assert.equal(e.canvas.saves, savesBefore);

    begin('n');
    const whileTyping = clone(e.canvas.getData());
    small.data.text = '中文内容 '.repeat(40);
    e.manager.refresh(); e.doc.flush();
    assert.deepEqual(e.canvas.getData().nodes.map(({ text, ...node }) => node), whileTyping.nodes.map(({ text, ...node }) => node),
      'typing never moves the map or persists the temporary editor dimensions');
    const nodeCount = e.canvas.nodes.size;
    assert.equal(e.scope.dispatch(keyEvent('Tab', e.canvas.wrapperEl, { isComposing: true })), undefined);
    assert.equal(e.scope.dispatch(keyEvent('Enter', e.canvas.wrapperEl, { isComposing: true })), undefined);
    assert.equal(e.canvas.nodes.size, nodeCount, 'IME confirmation keys never create topics');
    e.canvas.requestSave();
    end(small);
    assert.ok(small.data.width > 80 && small.data.width <= 480, 'longer text can grow a previously narrow card within the width limit');
    assert.ok(small.data.height >= 52 && small.data.height <= 640, 'the final preview has bounded comfortable height');
    assert.ok(e.doc.measurementReads > 1, 'the integration measures wrapped Markdown on hidden clones');
    assert.equal(e.canvas.wrapperEl.querySelectorAll('.nf-canvas-measuring').length, 0, 'measurement clones are always removed');
    assert.equal(e.canvas.history.current, historyBefore.current + 1, 'text, fitting, and layout share one undo step');
    assert.equal(small.resizeCalls, 1, 'measuring candidate widths performs only one final live resize');
    e.canvas.undo(); e.manager.refresh(); e.doc.flush();
    assert.deepEqual(e.canvas.getData(), before, 'one undo restores both the original text and small geometry');

    e.settings.canvasCardSize = 'preserve';
    const preserved = begin('n');
    end(preserved, 'A much longer note that should wrap inside its manually chosen narrow width.');
    assert.equal(preserved.data.width, 80, 'preserve mode respects an existing manual width');
    assert.ok(preserved.data.height > 52);
    e.canvas.selectOnly(preserved);
    assert.equal(e.command('fit'), true);
    assert.equal(preserved.data.width, 80, 'explicit fitting also respects preserve mode');

    e.settings.canvasAutoFit = false;
    const disabled = begin('n');
    const disabledSize = { width: disabled.data.width, height: disabled.data.height };
    const readCount = e.doc.measurementReads;
    end(disabled, 'Short');
    assert.deepEqual({ width: disabled.data.width, height: disabled.data.height }, disabledSize);
    assert.equal(e.doc.measurementReads, readCount, 'disabled automatic fitting does no preview measurement');
    e.settings.canvasComfortableEdit = false;
    const nativeEditor = begin('n');
    assert.equal(nativeEditor.nodeEl.classList.contains('nf-canvas-editing'), false, 'the editor surface setting can restore native sizing');
    end(nativeEditor);

    e.settings.canvasAutoFit = true;
    e.settings.canvasComfortableEdit = true;
    e.settings.canvasCardSize = 'comfortable';
    const quick = begin('n');
    end(quick, 'A pending fit must survive when the same topic is opened again immediately.', false);
    const binding = e.manager.bindings.get(e.view);
    assert.equal(binding.pending.fit.has('n'), true);
    quick.startEditing(); e.manager.refresh(); e.doc.flush();
    assert.equal(binding.pending.fit.has('n'), true, 'a pending fit is retained while editing resumes');
    const readsDuringReentry = e.doc.measurementReads;
    e.doc.flush();
    assert.equal(e.doc.measurementReads, readsDuringReentry, 'reentry never measures or resizes the active editor');
    end(quick);
    assert.equal(binding.pending.fit.size, 0, 'the retained fit finishes after the next real exit');
    assert.ok(quick.data.width > 80 && quick.data.width <= 480);

    const huge = begin('n');
    end(huge, 'A long line of text. '.repeat(2000));
    assert.ok(huge.data.width <= 480);
    assert.equal(huge.data.height, 640, 'very long text is capped at a usable preview height');
    const root = begin('r');
    end(root, 'Root');
    assert.equal(root.data.height, 64, 'a short root retains a larger visual minimum');

    e.settings.canvasAutoLayout = false;
    const missing = huge.nodeEl.querySelector('.markdown-preview-sizer');
    const missingParent = missing.parentElement;
    missing.remove();
    e.canvas.selectOnly(huge); e.doc.flush();
    const unrendered = clone(huge.data);
    const unrenderedSteps = e.canvas.history.current;
    assert.equal(e.command('fit'), true);
    assert.deepEqual(huge.data, unrendered, 'an unrendered preview is never squashed or sent through native fitting');
    assert.equal(e.canvas.history.current, unrenderedSteps);
    missingParent.append(missing);

    begin('n');
    e.manager.destroy();
    assert.equal(huge.nodeEl.classList.contains('nf-canvas-editing'), false, 'unloading removes the temporary editor surface');
    assert.equal(huge.nodeEl.style.getPropertyValue('--nf-editor-width'), '');
  }

  for (const tag of ['pre', 'table', 'img']) {
    const rich = fixture(CanvasEnhancements, {
      nodes: [nodeData('rich', 0, 0, { text: `A card containing ${tag}`, width: 240, height: 120 })], edges: [],
    });
    rich.settings.canvasAutoLayout = false;
    const node = rich.canvas.nodes.get('rich');
    const sizer = node.nodeEl.querySelector('.markdown-preview-sizer');
    for (const child of [...sizer.children]) child.remove();
    const content = rich.doc.createElement(tag);
    if (tag === 'img') {
      content.setAttribute('width', '640'); content.setAttribute('height', '360');
    } else if (tag === 'table') {
      for (const label of ['Column heading', 'A very wide cell '.repeat(20)]) {
        const row = rich.doc.createElement('tr');
        const cell = rich.doc.createElement('td'); cell.textContent = label;
        row.append(cell); content.append(row);
      }
    } else content.textContent = 'const veryWideLine = ' + 'a'.repeat(200);
    sizer.append(content);
    rich.canvas.selectOnly(node); rich.doc.flush();
    assert.equal(rich.command('fit'), true);
    assert.equal(node.data.width, 480, `${tag} retains a bounded reading width despite a misleading height measurement`);
    assert.equal(rich.doc.measuredRichTags.has(tag.toUpperCase()), true, `${tag} survives deep cloning into the measured DOM`);
    assert.equal(sizer.children[0], content, 'measuring leaves the original rich content in place');
    assert.equal(rich.canvas.wrapperEl.querySelectorAll('.nf-canvas-measuring').length, 0);
    assert.equal(node.resizeCalls, 1, 'only the final fitted size touches the live card');
    rich.manager.destroy();
  }

  {
    // Canvas can reuse its view/controller while loading another file. Work
    // scheduled after the old editor closes must not fit or tidy the new file.
    const switched = fixture(CanvasEnhancements, {
      nodes: [nodeData('r', 0, 0, { nfLayout: 'right' }), nodeData('n', 332, 0)],
      edges: [edgeData('r-n', 'r', 'n')],
    });
    switched.settings.canvasAnimation = false;
    const oldNode = switched.canvas.nodes.get('n');
    switched.canvas.selectOnly(oldNode); oldNode.startEditing(); switched.manager.refresh(); switched.doc.flush();
    oldNode.data.text = 'Changed in the previous canvas';
    oldNode.isEditing = false; oldNode.nodeEl.classList.remove('is-editing');
    switched.canvas.requestSave(); switched.canvas.requestPushHistory.run();
    switched.manager.refresh();
    const binding = switched.manager.bindings.get(switched.view);
    assert.equal(binding.pending.fit.has('n'), true, 'the first file has an unflushed fitting task');
    assert.ok(binding.settleTimer, 'the previous edit has a scheduled settlement');

    const incoming = {
      nodes: [nodeData('r', 50, 90, { nfLayout: 'right' }), nodeData('n', 900, 500)],
      edges: [edgeData('r-n', 'r', 'n')],
    };
    switched.canvas.importData(incoming, true);
    switched.canvas.requestPushHistory.cancel();
    switched.canvas.history = { data: [clone(switched.canvas.getData())], current: 0 };
    switched.view.file = { path: 'another.canvas' };
    const incomingHistory = clone(switched.canvas.history);
    const incomingSaves = switched.canvas.saves;
    switched.manager.refresh(); switched.doc.flush();
    assert.deepEqual(switched.canvas.getData(), incoming, 'an intentionally untidy new file keeps all its original geometry');
    assert.deepEqual(switched.canvas.history, incomingHistory, 'old settling never adds a new-file undo entry');
    assert.equal(switched.canvas.saves, incomingSaves, 'old settling never saves the new file');
    assert.equal(binding.pending.fit.size, 0);
    assert.equal(binding.settleTimer, 0);
    switched.manager.destroy();
  }

  for (const overtakes of ['undo', 'resize']) {
    // Native history can settle before the delayed Markdown measurement.
    // An intervening undo or manual resize invalidates that exact fitting job.
    const raced = fixture(CanvasEnhancements, {
      nodes: [nodeData('r', 0, 0, { nfLayout: 'right', width: 160, height: 64 }),
        nodeData('n', 232, 16, { width: 80, height: 32, text: 'Small' })],
      edges: [edgeData('r-n', 'r', 'n')],
    });
    raced.settings.canvasAnimation = false;
    raced.doc.flush();
    const original = clone(raced.canvas.getData());
    const node = raced.canvas.nodes.get('n');
    raced.canvas.selectOnly(node); node.startEditing(); raced.manager.refresh(); raced.doc.flush();
    node.data.text = 'A newly edited topic whose automatic fitting has not run yet.';
    node.isEditing = false; node.nodeEl.classList.remove('is-editing');
    raced.canvas.requestSave(); raced.manager.refresh();
    const binding = raced.manager.bindings.get(raced.view);
    assert.equal(binding.pending.fit.has('n'), true);
    raced.canvas.requestPushHistory.run();
    const edited = clone(raced.canvas.getData());
    if (overtakes === 'undo') raced.canvas.undo();
    else {
      node.resize({ width: 350, height: 180 }); node.render();
      raced.canvas.requestSave(); raced.canvas.requestPushHistory.run();
    }
    const expected = clone(raced.canvas.getData());
    const history = clone(raced.canvas.history);
    const saves = raced.canvas.saves;
    const reads = raced.doc.measurementReads;
    raced.manager.refresh(); raced.doc.flush();
    assert.deepEqual(raced.canvas.getData(), expected, `${overtakes} wins over the stale fitting request`);
    assert.deepEqual(raced.canvas.history, history, `${overtakes} is not followed by a new undo step or a lost redo branch`);
    assert.equal(raced.canvas.saves, saves, 'discarding an obsolete fitting request performs no save');
    assert.equal(raced.doc.measurementReads, reads, 'obsolete fitting requests do not measure the restored preview');
    assert.equal(binding.pending.fit.size, 0);
    if (overtakes === 'undo') {
      assert.deepEqual(raced.canvas.getData(), original, 'rapid undo preserves the original text and 80×32 geometry');
      raced.canvas.redo(); raced.manager.refresh(); raced.doc.flush();
      assert.deepEqual(raced.canvas.getData(), edited, 'the complete native text-edit state remains available to redo');
      assert.equal(raced.canvas.history.data.length, history.data.length);
      assert.equal(raced.canvas.saves, saves, 'redo remains free of a new automatic fitting save');
    } else {
      assert.deepEqual({ width: node.data.width, height: node.data.height }, { width: 350, height: 180 },
        'a manual size chosen after editing is not overwritten by delayed automatic fitting');
    }
    raced.manager.destroy();
  }

  // Tab on a lone card starts a map; Enter adds siblings; one undo each.
  const g = fixture(CanvasEnhancements, { nodes: [nodeData('r', 0, 0, { color: '5' })], edges: [] });
  g.canvas.wrapperEl.focus();
  g.canvas.selectOnly(g.canvas.nodes.get('r')); g.doc.flush();
  assert.equal(g.scope.dispatch(keyEvent('Tab', g.canvas.wrapperEl)), false);
  assert.equal(at(g, 'r').nfLayout, 'right', 'a lone card becomes a mind map');
  const first = [...g.canvas.selection][0];
  assert.equal(first.getData().x, at(g, 'r').width + 72, 'the child sits beside the newly fitted root');
  assert.equal(first.getData().color, '5');
  const firstEdge = [...g.canvas.edges.values()][0].getData();
  assert.deepEqual([firstEdge.fromSide, firstEdge.toSide, firstEdge.toEnd], ['right', 'left', 'none']);
  const afterTab = g.canvas.history.data.length;
  // A blank topic opens at the size an empty topic fits to: the minimum
  // width, one line of its type high (48 in this fixture, so the 52 minimum).
  assert.deepEqual([first.getData().width, first.getData().height], [112, 52], 'a new topic opens at the card it becomes');
  // Leaving a new card empty keeps its size: an empty card has nothing to fit.
  first.isEditing = false; first.nodeEl.classList.remove('is-editing'); g.doc.flush();
  assert.deepEqual([at(g, first.id).width, at(g, first.id).height], [112, 52], 'an empty topic is not squashed');
  assert.equal(first.nodeEl.classList.contains('nf-canvas-map-empty'), true, 'and shows that it is empty');
  first.isEditing = true; first.nodeEl.classList.add('is-editing'); g.doc.flush();
  first.isEditing = false; first.nodeEl.classList.remove('is-editing'); first.data.text = 'First';
  g.canvas.requestSave(); // native text save
  g.doc.flush();
  assert.equal(at(g, first.id).width, 112, 'a new topic narrows to a comfortable minimum');
  assert.equal(at(g, first.id).height, 52, 'and keeps enough room around a short line');
  assert.equal(g.canvas.history.data.length, afterTab + 1, 'the fit joins the text edit');
  g.canvas.selectOnly(first); g.doc.flush();
  assert.equal(g.scope.dispatch(keyEvent('Enter', g.canvas.wrapperEl)), false, 'Enter adds a sibling in a map');
  const second = [...g.canvas.selection][0];
  second.isEditing = false; second.nodeEl.classList.remove('is-editing'); g.doc.flush();
  assert.ok(centerY(at(g, second.id)) > centerY(at(g, first.id)), 'the sibling goes below');
  assert.ok(Math.abs(centerY(at(g, 'r')) - (centerY(at(g, first.id)) + centerY(at(g, second.id))) / 2) <= 1, 'the root re-centres');
  g.canvas.selectOnly(g.canvas.nodes.get('r')); g.doc.flush();
  const beforeCentreEnter = g.canvas.nodes.size;
  assert.equal(g.scope.dispatch(keyEvent('Enter', g.canvas.wrapperEl)), false, 'Enter on the centre, which has no siblings, adds a main topic');
  const third = [...g.canvas.selection][0];
  assert.equal(g.canvas.nodes.size, beforeCentreEnter + 1);
  assert.equal([...g.canvas.edges.values()].find(edge => edge.getData().toNode === third.id).getData().fromNode, 'r');
  assert.equal(third.isEditing, true, 'ready to type into');
  assert.ok(!g.canvas.nodes.get('r').isEditing, 'the centre itself is not opened');
  g.canvas.undo(); g.doc.flush();
  assert.equal(g.canvas.nodes.has(third.id), false);
  g.canvas.selectOnly(first); g.doc.flush();
  assert.equal(g.scope.dispatch(keyEvent('ArrowDown', g.canvas.wrapperEl)), false, 'arrows walk a map');
  assert.equal([...g.canvas.selection][0].id, second.id);
  assert.equal(g.scope.dispatch(keyEvent('ArrowLeft', g.canvas.wrapperEl)), false);
  assert.equal([...g.canvas.selection][0].id, 'r');
  const steps = g.canvas.history.data.length;
  g.canvas.undo(); g.doc.flush();
  assert.equal(g.canvas.nodes.has(second.id), false, 'undo removes the sibling');
  assert.equal(g.canvas.history.data.length, steps, 'undo is not re-arranged into a new step');
  g.canvas.undo(); g.canvas.undo(); g.doc.flush();
  assert.equal(at(g, 'r').nfLayout, undefined, 'undo returns the lone card');
  assert.equal(g.canvas.nodes.size, 1);
  g.manager.destroy();

  // The size a new topic opens at follows the card size; where nothing fits
  // it afterwards, or its editor cannot grow, it keeps Canvas's roomy box.
  for (const [settings, size, why] of [
    [{}, [112, 52], 'comfortable: the fitted minimum, one line high'],
    [{ canvasCardSize: 'compact' }, [80, 48], 'compact: the compact minimum width, one line of its type high'],
    [{ canvasCardSize: 'preserve' }, [240, 60], 'preserved sizes: nothing fits the card afterwards'],
    [{ canvasAutoFit: false }, [240, 60], 'no fitting: the editor does not widen either'],
    [{ canvasComfortableEdit: false }, [240, 60], 'the native editor does not grow with the words'],
  ]) {
    const h = fixture(CanvasEnhancements, { nodes: [nodeData('r', 0, 0)], edges: [] });
    Object.assign(h.settings, settings);
    h.canvas.wrapperEl.focus();
    h.canvas.selectOnly(h.canvas.nodes.get('r')); h.doc.flush();
    assert.equal(h.scope.dispatch(keyEvent('Tab', h.canvas.wrapperEl)), false);
    const child = [...h.canvas.selection][0];
    assert.notEqual(child.id, 'r');
    assert.deepEqual([child.getData().width, child.getData().height], size, why);
    assert.equal(child.getData().x, at(h, 'r').width + 72, `${why}: beside the root`);
    // Creation, fit and the blank's height are one step.
    h.canvas.undo(); h.doc.flush();
    assert.equal(h.canvas.nodes.has(child.id), false, `${why}: one undo removes it`);
    h.manager.destroy();
  }

  // An arranged map: fold, drag, drop, delete, paste, reorder.
  const mapData = {
    nodes: [nodeData('r', 0, 0, { nfLayout: 'right' }), nodeData('a'), nodeData('b'), nodeData('a1'), nodeData('free', 3000, 3000)],
    edges: [edgeData('ra', 'r', 'a'), edgeData('rb', 'r', 'b'), edgeData('aa1', 'a', 'a1')],
  };
  const m = fixture(CanvasEnhancements, mapData);
  m.canvas.wrapperEl.focus();
  m.canvas.selectOnly(m.canvas.nodes.get('r')); m.doc.flush();
  assert.equal(m.command('right'), true);
  m.doc.flush();
  const tidyPositions = Object.fromEntries(['r', 'a', 'b', 'a1'].map(id => [id, at(m, id)]));
  assert.ok(tidyPositions.a.y < tidyPositions.b.y);
  assert.equal(m.canvas.nodes.get('r').nodeEl.classList.contains('nf-canvas-map-root'), true);
  assert.equal(m.canvas.edges.get('ra').lineGroupEl.classList.contains('nf-canvas-map-trunk'), true);
  assert.equal(m.canvas.edges.get('aa1').lineGroupEl.classList.contains('nf-canvas-map-trunk'), false);
  assert.equal(m.canvas.nodes.get('free').nodeEl.classList.contains('nf-canvas-map-node'), false);

  // Folding hides the branch, shows a count, and never leaves a hidden card selected.
  m.canvas.selectOnly(m.canvas.nodes.get('a')); m.doc.flush();
  const badge = () => m.canvas.nodes.get('a').nodeEl.children.find(child => child.classList.contains('nf-canvas-fold'));
  assert.equal(badge().dataset.side, 'right');
  assert.equal(badge().textContent, '');
  assert.equal(badge().getAttribute('aria-label'), 'Fold branch');
  assert.equal(badge().getAttribute('data-tooltip-position'), 'top');
  assert.equal(badge().title, undefined, 'one tooltip, above the badge');
  const beforeFold = m.canvas.history.data.length;
  assert.equal(m.command('fold'), true);
  m.doc.flush();
  assert.equal(at(m, 'a').nfCollapsed, true);
  assert.equal(m.canvas.nodes.get('a1').nodeEl.classList.contains('nf-canvas-hidden'), true);
  assert.equal(m.canvas.edges.get('aa1').lineGroupEl.classList.contains('nf-canvas-hidden'), true);
  assert.equal(badge().textContent, '1');
  assert.equal(badge().classList.contains('is-collapsed'), true);
  assert.equal(badge().getAttribute('aria-label'), 'Unfold 1 card: a1', 'the badge names the topic it hides, one card in the singular');
  assert.equal(m.canvas.history.data.length, beforeFold + 1, 'folding is one undo step');
  m.canvas.selectAll([m.canvas.nodes.get('a1'), m.canvas.nodes.get('b')]);
  m.canvas.nodes.get('a1').nodeEl.classList.add('is-selected'); m.doc.flush();
  assert.deepEqual([...m.canvas.selection].map(item => item.id), ['b'], 'hidden cards are deselected');
  badge().dispatch('click');
  m.doc.flush();
  assert.equal(at(m, 'a').nfCollapsed, undefined, 'the badge unfolds');
  assert.equal(m.canvas.nodes.get('a1').nodeEl.classList.contains('nf-canvas-hidden'), false);
  for (const id of ['r', 'a', 'b', 'a1']) assert.deepEqual(at(m, id), { ...tidyPositions[id] }, 'unfolding restores the layout');

  // Dragging a card carries its branch; releasing it past a sibling reorders.
  const beforeDrag = m.canvas.history.data.length;
  drag(m, 'a', { x: tidyPositions.a.x + 40, y: tidyPositions.b.y + 200 });
  assert.equal(at(m, 'a1').x - at(m, 'a').x, tidyPositions.a1.x - tidyPositions.a.x, 'the branch follows');
  assert.equal(at(m, 'a1').y - at(m, 'a').y, tidyPositions.a1.y - tidyPositions.a.y);
  drop(m);
  assert.ok(at(m, 'b').y < at(m, 'a').y, 'the dropped card reorders');
  assert.equal(at(m, 'a').x, tidyPositions.a.x, 'and snaps into its column');
  assert.equal(m.canvas.history.data.length, beforeDrag + 1, 'the drag and the tidy are one step');
  assert.equal(win(m).listeners('pointermove'), 0, 'gesture listeners are released');
  m.canvas.undo(); m.doc.flush();
  for (const id of ['r', 'a', 'b', 'a1']) assert.deepEqual(at(m, id), tidyPositions[id], 'one undo restores the order');

  // Drop a card onto another to move it there.
  const target = at(m, 'a1');
  const pointer = { x: target.x + 10, y: target.y + 10 };
  drag(m, 'b', { x: target.x + 5, y: target.y + 5 }, pointer);
  assert.equal(m.canvas.nodes.get('a1').nodeEl.classList.contains('nf-canvas-drop-target'), true);
  drop(m, pointer);
  assert.equal(m.canvas.nodes.get('a1').nodeEl.classList.contains('nf-canvas-drop-target'), false);
  assert.equal(m.canvas.edges.has('rb'), false);
  const moved = [...m.canvas.edges.values()].map(item => item.getData()).find(item => item.toNode === 'b');
  assert.equal(moved.fromNode, 'a1', 'b now hangs from a1');
  assert.equal(at(m, 'b').x, at(m, 'a1').x + 260 + 72);
  m.canvas.undo(); m.doc.flush();
  assert.equal(m.canvas.edges.has('rb'), true, 'one undo restores the old parent');
  for (const id of ['r', 'a', 'b', 'a1']) assert.deepEqual(at(m, id), tidyPositions[id]);

  // Deleting a card keeps its children attached to the map.
  m.canvas.selectOnly(m.canvas.nodes.get('a')); m.canvas.wrapperEl.focus();
  m.canvas.wrapperEl.dispatch('keydown', keyEvent('Delete', m.canvas.wrapperEl));
  m.canvas.removeNode(m.canvas.nodes.get('a')); m.canvas.requestSave(); m.doc.flush();
  const rescued = [...m.canvas.edges.values()].map(item => item.getData()).find(item => item.toNode === 'a1');
  assert.equal(rescued?.fromNode, 'r', 'orphans move up to the nearest ancestor');
  assert.equal(at(m, 'a1').x, tidyPositions.a.x, 'and the map closes the gap');
  m.canvas.undo(); m.doc.flush();
  assert.equal(m.canvas.nodes.has('a'), true);
  assert.equal(m.canvas.edges.has('aa1'), true, 'one undo restores the card and its branch');
  for (const id of ['r', 'a', 'b', 'a1']) assert.deepEqual(at(m, id), tidyPositions[id]);

  // Alt+Shift+arrows reorder siblings.
  m.canvas.selectOnly(m.canvas.nodes.get('a')); m.doc.flush();
  assert.equal(m.scope.dispatch(keyEvent('ArrowDown', m.canvas.wrapperEl, { altKey: true, shiftKey: true })), false);
  assert.ok(at(m, 'b').y < at(m, 'a').y);
  assert.equal(m.scope.dispatch(keyEvent('ArrowDown', m.canvas.wrapperEl, { altKey: true, shiftKey: true })), undefined, 'the last card stays last');
  m.canvas.undo(); m.doc.flush();

  // Pasting a Markdown outline onto a map card grows branches.
  m.canvas.selectOnly(m.canvas.nodes.get('b')); m.doc.flush();
  const beforePaste = m.canvas.history.current;
  const paste = m.canvas.wrapperEl.dispatch('paste', { clipboardData: { types: ['text/plain'], getData: () => '- x\n\t- y\n- z' } });
  assert.equal(paste.defaultPrevented, true);
  m.doc.flush();
  const children = id => [...m.canvas.edges.values()].map(item => item.getData()).filter(item => item.fromNode === id)
    .map(item => at(m, item.toNode).text);
  assert.deepEqual(children('b').sort(), ['x', 'z']);
  assert.equal(m.canvas.history.current, beforePaste + 1, 'paste and fit are one step');
  assert.equal(m.canvas.history.data.length, beforePaste + 2, 'nothing waits to be recorded');
  const pastedX = [...m.canvas.nodes.values()].find(item => item.getData().text === 'x');
  assert.deepEqual(children(pastedX.id), ['y']);
  assert.equal(globalThis.__nfNotices.at(-1), 'Pasted 3 cards as branches.');
  assert.equal(pastedX.getData().height, 52, 'pasted topics fit their text with a comfortable minimum height');
  assert.ok(pastedX.getData().width >= 40 && pastedX.getData().width < 112, 'and, drawn as plain words below a main branch, hug it');
  m.canvas.undo(); m.doc.flush();
  assert.equal(m.canvas.nodes.size, mapData.nodes.length, 'one undo removes the pasted branches');
  m.canvas.selectOnly(m.canvas.nodes.get('b')); m.doc.flush();
  m.canvas.wrapperEl.dispatch('paste', { clipboardData: { types: ['text/plain'], getData: () => '- lone' } }); m.doc.flush();
  assert.equal(globalThis.__nfNotices.at(-1), 'Pasted 1 card as a branch.', 'one pasted card reads in the singular');
  m.canvas.undo(); m.doc.flush();
  assert.equal(m.canvas.nodes.size, mapData.nodes.length);
  const cardPaste = m.canvas.wrapperEl.dispatch('paste', { clipboardData: { types: ['text/plain', 'obsidian/canvas'], getData: () => '- x' } });
  assert.equal(cardPaste.defaultPrevented, false, 'copied cards keep Canvas’s own paste');
  m.canvas.selectOnly(m.canvas.nodes.get('free')); m.doc.flush();
  assert.equal(m.canvas.wrapperEl.dispatch('paste', { clipboardData: { types: ['text/plain'], getData: () => '- x' } }).defaultPrevented, false, 'free cards keep native paste');

  // Turning a card's list into branches; a lone heading has nothing to turn.
  m.canvas.importData({ nodes: [{ ...at(m, 'free'), text: '# Only a title' }], edges: [] }, false);
  m.canvas.selectOnly(m.canvas.nodes.get('free')); m.doc.flush();
  assert.equal(m.command('explode', true), false);
  m.canvas.importData({ nodes: [{ ...at(m, 'free'), text: 'Topic\n\n- one\n- two\n\t- deeper' }], edges: [] }, false);
  m.canvas.selectOnly(m.canvas.nodes.get('free')); m.doc.flush();
  assert.equal(m.command('explode'), true);
  m.doc.flush();
  assert.equal(at(m, 'free').text, 'Topic');
  assert.equal(at(m, 'free').height, 64, 'the new map centre keeps only its title with comfortable height');
  assert.equal(at(m, 'free').width, 160, 'the new map centre fits its title with the root minimum');
  assert.equal(at(m, 'free').nfLayout, 'right', 'the card becomes a map');
  assert.deepEqual(children('free').sort(), ['one', 'two']);
  assert.equal(globalThis.__nfNotices.at(-1), 'Created 3 cards from the list.');
  // One card is one card, not "1 cards".
  m.canvas.importData({ nodes: [{ ...at(m, 'a1'), text: 'Solo\n\n- only' }], edges: [] }, false);
  m.canvas.selectOnly(m.canvas.nodes.get('a1')); m.doc.flush();
  assert.equal(m.command('explode'), true);
  m.doc.flush();
  assert.equal(globalThis.__nfNotices.at(-1), 'Created 1 card from the list.', 'a one-item list reads in the singular');
  m.canvas.undo(); m.doc.flush();

  // Free layout returns the map to native placement.
  m.canvas.selectOnly(m.canvas.nodes.get('a')); m.doc.flush();
  assert.equal(m.command('release'), true);
  assert.equal(at(m, 'r').nfLayout, undefined);
  m.doc.flush();
  const releasedChild = at(m, 'a1');
  assert.equal(releasedChild.width, tidyPositions.a1.width, 'returning to ordinary text preserves the free card width');
  assert.equal(m.canvas.nodes.get('a').nodeEl.children.some(child => child.classList.contains('nf-canvas-fold')), false, 'free cards have no fold badge');
  drag(m, 'a', { x: 5000, y: 5000 }); drop(m);
  assert.deepEqual(at(m, 'a1'), releasedChild, 'free cards move alone');
  assert.equal(at(m, 'a').x, 5000, 'and stay where they are dropped');
  m.manager.destroy();
  assert.equal(m.canvas.wrapperEl.querySelectorAll('.nf-canvas-fold').length, 0);

  // Auto layout off: no tidy, no branch-follow, but explicit actions still arrange.
  const off = fixture(CanvasEnhancements, mapData);
  off.settings.canvasAutoLayout = false;
  off.canvas.wrapperEl.focus();
  off.canvas.selectOnly(off.canvas.nodes.get('r')); off.doc.flush();
  off.command('right'); off.doc.flush();
  const arranged = at(off, 'a1');
  drag(off, 'a', { x: 9000, y: 9000 }); drop(off);
  assert.deepEqual(at(off, 'a1'), arranged, 'without auto layout a card moves alone');
  assert.equal(at(off, 'a').x, 9000);
  off.manager.destroy();

  /* ---------- "+" handles ---------- */
  const handles = (h, id) => h.canvas.nodes.get(id).nodeEl.children.filter(child => child.classList.contains('nf-canvas-add'));
  const sidesOf = (h, id) => handles(h, id).map(button => button.dataset.side).sort();
  const hmap = fixture(CanvasEnhancements, {
    nodes: [nodeData('r', 0, 0, { nfLayout: 'right' }), nodeData('a', 332, 0), nodeData('lone', 0, 900), nodeData('x', 3000, 0), nodeData('y', 3500, 0)],
    edges: [edgeData('ra', 'r', 'a'), edgeData('xy', 'x', 'y', { toEnd: 'arrow' })],
  });
  hmap.canvas.wrapperEl.focus(); hmap.doc.flush();
  assert.deepEqual(sidesOf(hmap, 'a'), ['right'], 'a map leaf offers a child where children grow');
  assert.deepEqual(sidesOf(hmap, 'r'), [], 'a card with children shows its fold badge instead');
  assert.deepEqual(sidesOf(hmap, 'x'), [], 'free cards show handles only when selected');
  hmap.canvas.selectOnly(hmap.canvas.nodes.get('x')); hmap.doc.flush();
  assert.deepEqual(sidesOf(hmap, 'x'), ['bottom', 'left', 'right', 'top']);
  assert.ok(handles(hmap, 'x').every(button => button.getAttribute('aria-label') === 'Add a connected card'
    && button.getAttribute('data-tooltip-position') === 'top' && button.title === undefined), 'handles name what they add, with one tooltip');
  assert.equal(handles(hmap, 'a')[0].getAttribute('aria-label'), 'Add child');
  const handleSteps = hmap.canvas.history.data.length;
  handles(hmap, 'x').find(button => button.dataset.side === 'bottom').dispatch('click');
  const below = [...hmap.canvas.selection][0];
  assert.notEqual(below.id, 'x');
  assert.ok(below.getData().y > at(hmap, 'x').y + at(hmap, 'x').height, 'the new card grows below');
  const belowEdge = [...hmap.canvas.edges.values()].map(item => item.getData()).find(item => item.toNode === below.id);
  assert.deepEqual([belowEdge.fromNode, belowEdge.fromSide, belowEdge.toSide, belowEdge.toEnd], ['x', 'bottom', 'top', 'arrow']);
  assert.equal(below.isEditing, true, 'and opens for typing');
  assert.equal(at(hmap, 'x').nfLayout, undefined, 'a connected free card stays free');
  assert.equal(hmap.canvas.history.data.length, handleSteps + 1, 'one undo step');
  below.isEditing = false; below.nodeEl.classList.remove('is-editing');
  hmap.canvas.undo(); hmap.doc.flush();
  hmap.canvas.selectOnly(hmap.canvas.nodes.get('lone')); hmap.doc.flush();
  handles(hmap, 'lone').find(button => button.dataset.side === 'bottom').dispatch('click');
  assert.equal(at(hmap, 'lone').nfLayout, 'down', 'a lone card starts a map growing the way it was pulled');
  const downChild = [...hmap.canvas.selection][0];
  assert.equal(downChild.getData().y, at(hmap, 'lone').y + at(hmap, 'lone').height + 56);
  downChild.isEditing = false; downChild.nodeEl.classList.remove('is-editing');
  hmap.canvas.undo(); hmap.doc.flush();
  handles(hmap, 'a')[0].dispatch('click');
  const grown = [...hmap.canvas.selection][0];
  assert.equal([...hmap.canvas.edges.values()].map(item => item.getData()).find(item => item.toNode === grown.id).fromNode, 'a', 'a leaf handle adds its child');
  grown.isEditing = false; grown.nodeEl.classList.remove('is-editing');
  hmap.canvas.undo(); hmap.doc.flush();
  // Hover is tracked with reach, since Canvas covers hovered cards with its own handles.
  const hovering = id => hmap.canvas.nodes.get(id).nodeEl.classList.contains('nf-canvas-hover');
  const aRect = at(hmap, 'a');
  hmap.canvas.wrapperEl.dispatch('pointermove', { pointerType: 'mouse', clientX: aRect.x + aRect.width + 30, clientY: aRect.y + 10 });
  hmap.doc.flush();
  assert.equal(hovering('a'), true, 'the pointer on its way to a handle keeps the card hovered');
  hmap.canvas.wrapperEl.dispatch('pointermove', { pointerType: 'mouse', clientX: aRect.x + aRect.width + 200, clientY: aRect.y });
  hmap.doc.flush();
  assert.equal(hovering('a'), false, 'and lets go further out');
  hmap.canvas.wrapperEl.dispatch('pointermove', { pointerType: 'mouse', clientX: aRect.x + 5, clientY: aRect.y + 5 });
  hmap.doc.flush();
  assert.equal(hovering('a'), true);
  hmap.canvas.wrapperEl.dispatch('pointerleave', {});
  assert.equal(hovering('a'), false, 'leaving the canvas clears it');
  hmap.canvas.readonly = true; hmap.doc.flush(); hmap.manager.refresh();
  assert.deepEqual(sidesOf(hmap, 'a'), [], 'read-only canvases have no handles');
  hmap.canvas.readonly = false; hmap.manager.refresh();
  const balancedEmpty = fixture(CanvasEnhancements, { nodes: [nodeData('c', 0, 0, { nfLayout: 'balanced' })], edges: [] });
  assert.deepEqual(sidesOf(balancedEmpty, 'c'), ['left', 'right'], 'an empty balanced map grows either way');
  handles(balancedEmpty, 'c').find(button => button.dataset.side === 'left').dispatch('click');
  assert.ok([...balancedEmpty.canvas.selection][0].getData().x < 0, 'the left handle grows left');
  balancedEmpty.manager.destroy();
  hmap.manager.destroy();
  assert.equal(hmap.canvas.wrapperEl.querySelectorAll('.nf-canvas-add').length, 0, 'handles are removed on teardown');

  /* ---------- Shift+Enter, deletion, spacing ---------- */
  const k = fixture(CanvasEnhancements, mapData);
  k.canvas.wrapperEl.focus();
  k.canvas.selectOnly(k.canvas.nodes.get('r')); k.doc.flush();
  k.command('right'); k.doc.flush();
  k.canvas.selectOnly(k.canvas.nodes.get('b')); k.doc.flush();
  assert.equal(k.scope.dispatch(keyEvent('Enter', k.canvas.wrapperEl, { shiftKey: true })), false, 'Shift+Enter adds a sibling above');
  const aboveB = [...k.canvas.selection][0];
  aboveB.isEditing = false; aboveB.nodeEl.classList.remove('is-editing'); k.doc.flush();
  assert.ok(at(k, 'a').y < at(k, aboveB.id).y && at(k, aboveB.id).y < at(k, 'b').y, 'between a and b');
  k.canvas.undo(); k.doc.flush();
  k.canvas.selectOnly(k.canvas.nodes.get('r')); k.doc.flush();
  assert.equal(k.scope.dispatch(keyEvent('Enter', k.canvas.wrapperEl, { shiftKey: true })), undefined, 'a root has nothing above it');
  k.canvas.selectOnly(k.canvas.nodes.get('free')); k.doc.flush();
  assert.equal(k.scope.dispatch(keyEvent('Enter', k.canvas.wrapperEl, { shiftKey: true })), undefined, 'free cards keep Shift+Enter');

  // Deleting a map card selects its next sibling so typing can go on.
  k.canvas.selectOnly(k.canvas.nodes.get('a')); k.doc.flush();
  k.canvas.wrapperEl.dispatch('keydown', keyEvent('Delete', k.canvas.wrapperEl));
  k.canvas.removeNode(k.canvas.nodes.get('a')); k.canvas.requestSave(); k.doc.flush();
  assert.deepEqual([...k.canvas.selection].map(item => item.id), ['a1'], 'the orphan that took its place is next in line');
  k.canvas.undo(); k.doc.flush();
  k.canvas.selectOnly(k.canvas.nodes.get('b')); k.doc.flush();
  k.canvas.wrapperEl.dispatch('keydown', keyEvent('Delete', k.canvas.wrapperEl));
  k.canvas.removeNode(k.canvas.nodes.get('b')); k.canvas.requestSave(); k.doc.flush();
  assert.deepEqual([...k.canvas.selection].map(item => item.id), ['a'], 'the last sibling falls back to the one before');
  k.canvas.undo(); k.doc.flush();

  // Spacing is one undo step and lives on the root.
  k.canvas.selectOnly(k.canvas.nodes.get('a')); k.doc.flush();
  const roomyBefore = at(k, 'a').x;
  const spacingSteps = k.canvas.history.current;
  const kBinding = k.manager.bindings.get(k.view);
  assert.equal(kBinding.run('roomy'), true);
  assert.equal(at(k, 'r').nfSpacing, 'roomy');
  assert.ok(at(k, 'a').x > roomyBefore, 'branches move out');
  assert.equal(k.canvas.history.current, spacingSteps + 1, 'one undo step');
  assert.equal(kBinding.run('standard'), true);
  assert.equal(at(k, 'r').nfSpacing, undefined, 'standard spacing writes no field');
  assert.equal(at(k, 'a').x, roomyBefore);
  k.canvas.undo(); k.canvas.undo(); k.doc.flush();
  k.canvas.selectOnly(k.canvas.nodes.get('free')); k.doc.flush();
  assert.equal(kBinding.canRun('compact'), false, 'spacing needs a map');
  k.manager.destroy();

  /* ---------- finding cards ---------- */
  globalThis.__nfOpenedModals = [];
  const s = fixture(CanvasEnhancements, mapData, {});
  s.canvas.wrapperEl.focus();
  s.canvas.selectOnly(s.canvas.nodes.get('r')); s.doc.flush();
  s.command('right'); s.doc.flush();
  s.canvas.selectOnly(s.canvas.nodes.get('a')); s.doc.flush();
  s.command('fold'); s.doc.flush();
  s.canvas.selectOnly(s.canvas.nodes.get('free')); s.doc.flush();
  assert.equal(s.scope.dispatch(keyEvent('f', s.canvas.wrapperEl, { metaKey: true, shiftKey: true })), false, 'Mod+Shift+F opens card search');
  const search = globalThis.__nfOpenedModals.pop();
  assert.deepEqual(search.getItems().map(hit => hit.id).sort(), ['a', 'a1', 'b', 'free', 'r']);
  const hiddenHit = search.getItems().find(hit => hit.id === 'a1');
  assert.equal(hiddenHit.hidden, true, 'folded cards are found too');
  assert.equal(hiddenHit.context, 'r · in a folded branch', 'with their map for context, and where they hide');
  assert.equal(search.getItems().find(hit => hit.id === 'b').context, 'r');
  const findSteps = s.canvas.history.current;
  search.onChooseItem(hiddenHit);
  assert.equal(s.canvas.nodes.get('a1').nodeEl.classList.contains('nf-canvas-found'), true, 'with a brief ring');
  s.doc.flush();
  assert.equal(s.canvas.nodes.get('a1').nodeEl.classList.contains('nf-canvas-found'), false, 'that fades');
  assert.equal(at(s, 'a').nfCollapsed, undefined, 'jumping to a folded card unfolds its branch');
  assert.equal(s.canvas.nodes.get('a1').nodeEl.classList.contains('nf-canvas-hidden'), false);
  assert.deepEqual([...s.canvas.selection].map(item => item.id), ['a1'], 'and selects it');
  assert.ok(s.canvas.zooms.length > 0, 'and frames it');
  assert.equal(s.canvas.history.current, findSteps + 1, 'unfolding is one undo step');
  s.canvas.readonly = true;
  assert.equal(s.command('search', true), true, 'search works on read-only canvases');
  s.canvas.readonly = false;
  s.manager.destroy();
  assert.equal(s.canvas.nodes.get('a1').nodeEl.classList.contains('nf-canvas-found'), false);

  /* ---------- the native selection menu ---------- */
  const n = fixture(CanvasEnhancements, mapData);
  let menuRenders = 0;
  n.canvas.menu = { menuEl: n.doc.createElement('div'), render(rebuild) { assert.equal(rebuild, false); menuRenders++; } };
  n.canvas.wrapperEl.append(n.canvas.menu.menuEl);
  n.canvas.wrapperEl.focus();
  n.canvas.selectOnly(n.canvas.nodes.get('a')); n.doc.flush();
  const group = n.canvas.menu.menuEl.children.find(child => child.classList.contains('nf-canvas-menu-group'));
  assert.ok(group, 'mind-map actions join Canvas’s floating menu');
  assert.equal(menuRenders, 1, 'which re-centres itself once');
  const menuButton = action => group.children.find(button => button.dataset.action === action);
  assert.equal(menuButton('fold').hidden, false);
  n.canvas.selectOnly(n.canvas.nodes.get('b')); n.doc.flush();
  assert.equal(menuButton('fold').hidden, true, 'actions that do not apply are hidden');
  assert.equal(menuRenders, 1, 'no re-render while the group is in place');
  n.canvas.menu.menuEl.children = []; group.parentElement = null; n.doc.flush(); n.manager.refresh();
  assert.equal(n.canvas.menu.menuEl.children.length, 1, 'rebuilt menus get the actions back');
  const rebuilt = n.canvas.menu.menuEl.children[0];
  rebuilt.children.find(button => button.dataset.action === 'child').dispatch('click');
  const fromMenu = [...n.canvas.selection][0];
  assert.equal([...n.canvas.edges.values()].map(item => item.getData()).find(item => item.toNode === fromMenu.id).fromNode, 'b');
  fromMenu.isEditing = false; fromMenu.nodeEl.classList.remove('is-editing');
  n.canvas.selection.clear(); n.doc.flush(); n.manager.refresh();
  assert.equal(n.canvas.menu.menuEl.children.length, 0, 'nothing selected, nothing added');
  n.manager.destroy();

  /* ---------- motion ---------- */
  const mo = fixture(CanvasEnhancements, mapData);
  mo.settings.canvasAnimation = true;
  let clock = 0;
  win(mo).performance = { now: () => clock };
  mo.canvas.wrapperEl.focus();
  mo.canvas.selectOnly(mo.canvas.nodes.get('r')); mo.doc.flush();
  mo.command('right');
  const recorded = mo.canvas.history.data[mo.canvas.history.current].nodes.find(item => item.id === 'b');
  const settled = { ...at(mo, 'b'), x: recorded.x, y: recorded.y };
  assert.deepEqual({ x: recorded.x, y: recorded.y }, { x: tidyPositions.b.x, y: tidyPositions.b.y }, 'the undo step records where cards land');
  assert.deepEqual({ x: at(mo, 'b').x, y: at(mo, 'b').y }, { x: 0, y: 0 }, 'while cards start from where they were');
  const pendingBefore = mo.doc.pendingFrames();
  assert.ok(pendingBefore > 0, 'an animation frame is pending');
  // A save made mid-way (by Canvas, e.g. an edit) must not keep half-way positions.
  mo.canvas.data = 'saved elsewhere';
  clock += 500;
  mo.doc.flush();
  assert.deepEqual(at(mo, 'b'), { ...settled }, 'cards land exactly');
  const top = mo.canvas.history.data[mo.canvas.history.current].nodes.find(item => item.id === 'b');
  assert.deepEqual({ x: top.x, y: top.y }, { x: settled.x, y: settled.y }, 'the landing is recorded over a mid-way save');
  // Pressing a key mid-glide lands the cards first.
  mo.canvas.selectOnly(mo.canvas.nodes.get('a')); mo.doc.flush();
  mo.command('fold');
  mo.canvas.selectOnly(mo.canvas.nodes.get('a')); mo.command('fold');
  assert.equal(mo.scope.dispatch(keyEvent('ArrowDown', mo.canvas.wrapperEl)), false);
  assert.equal(at(mo, 'a1').x, tidyPositions.a1.x - tidyPositions.r.x + at(mo, 'r').x, 'a key press lands every card');
  clock += 1000; mo.doc.flush();
  mo.settings.canvasAnimation = false;
  mo.manager.destroy();
  assert.equal(mo.doc.pendingFrames(), 0, 'teardown leaves no frames');

  /* ---------- folding glides into the holder before it hides ---------- */
  {
    const fo = fixture(CanvasEnhancements, mapData);
    fo.settings.canvasAnimation = true;
    let clock = 0;
    win(fo).performance = { now: () => clock };
    fo.canvas.wrapperEl.focus();
    fo.canvas.selectOnly(fo.canvas.nodes.get('r')); fo.doc.flush();
    fo.command('right'); clock += 1000; fo.doc.flush();
    fo.canvas.selectOnly(fo.canvas.nodes.get('a')); fo.doc.flush();
    const holder = at(fo, 'a');
    const leaf = at(fo, 'a1');
    const leafEl = fo.canvas.nodes.get('a1').nodeEl;
    const lineEl = fo.canvas.edges.get('aa1').lineGroupEl;
    const foldSteps = fo.canvas.history.data.length;
    assert.equal(fo.command('fold'), true);
    assert.equal(at(fo, 'a').nfCollapsed, true);
    assert.equal(leafEl.classList.contains('nf-canvas-folding'), true, 'a folding card glides into its holder');
    assert.equal(leafEl.classList.contains('nf-canvas-hidden'), false, 'and stays in view meanwhile');
    assert.equal(leafEl.style.getPropertyValue('--nf-fold-dx'), `${Math.round(holder.x + holder.width / 2 - leaf.x - leaf.width / 2)}px`, 'carrying the way to the holder’s centre');
    assert.equal(leafEl.style.getPropertyValue('--nf-fold-dy'), `${Math.round(holder.y + holder.height / 2 - leaf.y - leaf.height / 2)}px`);
    assert.equal(lineEl.classList.contains('nf-canvas-folding'), true, 'its line goes with it');
    assert.equal(lineEl.classList.contains('nf-canvas-hidden'), false);
    assert.equal(fo.canvas.history.data.length, foldSteps + 1, 'the glide adds no step of its own');
    clock += 1000; fo.doc.flush();
    assert.equal(leafEl.classList.contains('nf-canvas-hidden'), true, 'then it hides');
    assert.equal(leafEl.classList.contains('nf-canvas-folding'), false);
    assert.equal(leafEl.style.getPropertyValue('--nf-fold-dx'), '', 'and carries nothing more');
    assert.equal(lineEl.classList.contains('nf-canvas-hidden'), true);
    assert.equal(fo.canvas.history.data.length, foldSteps + 1, 'landing writes nothing');
    fo.canvas.selectOnly(fo.canvas.nodes.get('a')); fo.doc.flush();
    fo.command('fold'); clock += 1000; fo.doc.flush();
    assert.equal(leafEl.classList.contains('nf-canvas-hidden'), false, 'unfolding shows it again');
    assert.equal(leafEl.classList.contains('nf-canvas-folding'), false, 'without any glide back');
    // Fold all and Show N levels fold the same way.
    fo.canvas.selectOnly(fo.canvas.nodes.get('r')); fo.doc.flush();
    fo.command('foldAll');
    assert.equal(leafEl.classList.contains('nf-canvas-folding'), true, 'folding every branch glides too');
    clock += 1000; fo.doc.flush();
    assert.equal(leafEl.classList.contains('nf-canvas-hidden'), true);
    fo.command('unfoldAll'); clock += 1000; fo.doc.flush();
    fo.canvas.selectOnly(fo.canvas.nodes.get('r')); fo.doc.flush();
    fo.command('level-1');
    assert.equal(leafEl.classList.contains('nf-canvas-folding'), true, 'so does showing one level');
    clock += 1000; fo.doc.flush();
    assert.equal(leafEl.classList.contains('nf-canvas-hidden'), true);
    // Without animation, folded cards hide at once.
    fo.settings.canvasAnimation = false;
    fo.command('level-2'); fo.doc.flush();
    fo.canvas.selectOnly(fo.canvas.nodes.get('a')); fo.doc.flush();
    fo.command('fold');
    assert.equal(leafEl.classList.contains('nf-canvas-hidden'), true, 'no animation, no glide');
    assert.equal(leafEl.classList.contains('nf-canvas-folding'), false);
    fo.doc.flush();
    fo.manager.destroy();
    assert.equal(fo.doc.pendingFrames(), 0, 'teardown leaves no fold timer');
  }

  /* ---------- a dragged card shows where it would land ---------- */
  {
    const ins = fixture(CanvasEnhancements, {
      nodes: [nodeData('r', 0, 0, { nfLayout: 'right' }), nodeData('a'), nodeData('b'), nodeData('c'), nodeData('d'), nodeData('a1')],
      edges: [edgeData('ra', 'r', 'a'), edgeData('rb', 'r', 'b'), edgeData('rc', 'r', 'c'), edgeData('rd', 'r', 'd'), edgeData('aa1', 'a', 'a1')],
    });
    ins.canvas.wrapperEl.focus();
    ins.canvas.selectOnly(ins.canvas.nodes.get('r')); ins.doc.flush();
    ins.command('right'); ins.doc.flush();
    const container = ins.doc.createElement('svg');
    ins.canvas.wrapperEl.append(container);
    ins.canvas.edgeContainerEl = container;
    const bar = () => container.querySelector('.nf-canvas-insert');
    const line = () => bar().querySelector('line');
    const num = name => Number(line().getAttribute(name));
    const stale = () => ins.canvas.edges.get('rb').lineGroupEl.classList.contains('nf-canvas-drag-stale');
    const [a, c, d] = ['a', 'c', 'd'].map(id => at(ins, id));
    assert.ok(a.y < c.y && c.y < d.y);
    // The middle sibling dragged past its neighbour: the bar sits between the two it now lies between.
    const b = at(ins, 'b');
    drag(ins, 'b', { x: b.x, y: (centerY(c) + centerY(d)) / 2 - b.height / 2 });
    assert.ok(bar(), 'a bar shows where the card would land');
    assert.ok(bar().classList.contains('nf-canvas-ui'), 'which is not a canvas change');
    assert.equal(num('y1'), num('y2'), 'across the column of siblings');
    assert.ok(num('y1') > c.y + c.height && num('y1') < d.y, 'between the two neighbours');
    assert.ok(num('x1') <= Math.min(c.x, d.x) && num('x2') >= Math.max(c.x + c.width, d.x + d.width), 'as wide as they are');
    assert.equal(stale(), true, 'its old connection dims meanwhile');
    drop(ins);
    assert.equal(bar(), null, 'the bar leaves with the drop');
    assert.equal(stale(), false, 'and the connection is live again');
    assert.ok(at(ins, 'c').y < at(ins, 'b').y && at(ins, 'b').y < at(ins, 'd').y, 'the card lands where the bar was');
    // Before the first sibling, the bar sits above it.
    const top = at(ins, 'a');
    drag(ins, 'b', { x: top.x, y: top.y - top.height - 40 });
    assert.ok(num('y1') < top.y, 'above the first sibling');
    drop(ins);
    assert.ok(at(ins, 'b').y < at(ins, 'a').y);
    // Its own parent is no drop target: that drop re-links nothing. Nudged
    // within its own slot the card announces nothing; carried past its
    // siblings, the bar between them says where the drop reorders it.
    const home = { x: at(ins, 'r').x + 10, y: at(ins, 'r').y + 10 };
    const first = at(ins, 'b');
    drag(ins, 'b', { x: first.x + 4, y: first.y + 6 }, home);
    assert.equal(ins.canvas.nodes.get('r').nodeEl.classList.contains('nf-canvas-drop-target'), false, 'its own parent is no drop target');
    assert.equal(bar(), null, 'no bar while the card stays in its own slot');
    assert.equal(stale(), false, 'and its connection stays live');
    drop(ins, home);
    assert.equal(ins.canvas.edges.has('rb'), true, 'the card still hangs from its parent');
    assert.deepEqual(at(ins, 'b'), first, 'and snaps back into its slot');
    const [c2, d2] = ['c', 'd'].map(id => at(ins, id));
    drag(ins, 'b', { x: first.x, y: (centerY(c2) + centerY(d2)) / 2 - first.height / 2 }, home);
    assert.equal(ins.canvas.nodes.get('r').nodeEl.classList.contains('nf-canvas-drop-target'), false, 'still no drop target over its parent');
    assert.ok(bar(), 'past its siblings the bar shows where it lands');
    assert.ok(num('y1') > c2.y + c2.height && num('y1') < d2.y, 'between the two it now lies between');
    assert.equal(stale(), true, 'its connection dims as for any reorder');
    drop(ins, home);
    assert.equal(bar(), null);
    assert.equal(ins.canvas.edges.has('rb'), true, 'the drop keeps its parent');
    assert.equal([...ins.canvas.edges.values()].filter(item => item.getData().toNode === 'b').length, 1, 'with one connection');
    assert.ok(at(ins, 'c').y < at(ins, 'b').y && at(ins, 'b').y < at(ins, 'd').y, 'and reorders it by where it was dropped');
    // Over another card, the bar marks the slot for a new child.
    const a1 = at(ins, 'a1');
    const pointer = { x: a1.x + 10, y: a1.y + 10 };
    drag(ins, 'b', { x: a1.x + 5, y: a1.y + 5 }, pointer);
    assert.equal(ins.canvas.nodes.get('a1').nodeEl.classList.contains('nf-canvas-drop-target'), true);
    assert.ok(num('x1') >= a1.x + a1.width, 'the bar sits in the slot beyond the card');
    assert.equal(num('y1'), num('y2'));
    assert.equal(stale(), true);
    drop(ins, pointer);
    assert.equal(bar(), null);
    assert.equal([...ins.canvas.edges.values()].map(item => item.getData()).find(item => item.toNode === 'b').fromNode, 'a1');
    assert.equal(win(ins).listeners('pointermove'), 0);
    ins.manager.destroy();
    assert.equal(container.querySelector('.nf-canvas-insert'), null);
  }

  /* ---------- the layout panel previews an arrangement as ghosts ---------- */
  {
    const lp = fixture(CanvasEnhancements, {
      nodes: [nodeData('r', 0, 0, { nfLayout: 'right' }), nodeData('a', 332, -100), nodeData('b', 332, 100), nodeData('a1', 664, -100)],
      edges: [edgeData('ra', 'r', 'a'), edgeData('rb', 'r', 'b'), edgeData('aa1', 'a', 'a1')],
    });
    lp.settings.canvasAnimation = false;
    const container = lp.doc.createElement('svg');
    lp.canvas.wrapperEl.append(container);
    lp.canvas.edgeContainerEl = container;
    lp.canvas.selectOnly(lp.canvas.nodes.get('a')); lp.doc.flush();
    lp.button('Layout').dispatch('click'); lp.doc.flush();
    const panel = lp.canvas.wrapperEl.querySelector('.nf-canvas-layout-panel');
    assert.ok(panel, 'the layout panel opens');
    const before = clone(lp.canvas.getData());
    const history = lp.canvas.history.data.length;
    const saves = lp.canvas.saves;
    const ghosts = () => container.querySelector('.nf-canvas-ghosts');
    const tile = layout => panel.querySelectorAll('.nf-canvas-style-tile').find(item => item.dataset.layout === layout);
    const option = (kind, value) => panel.querySelectorAll('.nf-canvas-style-option').find(item => item.dataset.kind === kind && item.dataset.value === value);
    tile('down').dispatch('pointerenter');
    assert.equal(ghosts(), null, 'a pointer crossing the panel draws nothing yet');
    lp.doc.flush();
    assert.ok(ghosts(), 'hovering a structure shows where the cards would go');
    assert.ok(ghosts().classList.contains('nf-canvas-ui'), 'which is not a canvas change');
    assert.equal(container.firstChild, ghosts(), 'behind everything else in the connection layer');
    const rects = ghosts().querySelectorAll('rect');
    assert.ok(rects.length >= 3, 'one ghost per card that would move');
    assert.ok(rects.every(rect => rect.classList.contains('nf-canvas-ghost')));
    // Each ghost carries its card's name, centred on it, over all the outlines.
    const labels = ghosts().querySelectorAll('text');
    assert.equal(labels.length, rects.length, 'every ghost is named (every card here has words)');
    labels.forEach((label, index) => {
      const rect = rects[index];
      assert.ok(label.classList.contains('nf-canvas-ghost-label'));
      assert.equal(Number(label.getAttribute('x')), Math.round(Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')) / 2));
      assert.equal(Number(label.getAttribute('y')), Math.round(Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')) / 2));
      assert.equal(label.getAttribute('text-anchor'), 'middle');
      assert.equal(label.getAttribute('font-size'), '15', 'in canvas units: the words scale with the map');
    });
    assert.deepEqual(labels.map(label => label.textContent).sort(), ['a', 'a1', 'b'], 'named after the cards that move');
    assert.ok(ghosts().children.indexOf(labels[0]) > ghosts().children.indexOf(rects.at(-1)), 'names over every outline');
    assert.ok(lp.canvas.wrapperEl.classList.contains('nf-canvas-previewing'), 'the live map fades while ghosts show');
    const r = at(lp, 'r');
    assert.ok(rects.some(rect => Number(rect.getAttribute('y')) >= r.y + r.height), 'an org chart hangs its branches below the centre');
    assert.deepEqual(lp.canvas.getData(), before, 'a preview writes nothing');
    assert.equal(lp.canvas.history.data.length, history, 'and adds no undo step');
    assert.equal(lp.canvas.saves, saves, 'and asks for no save');
    option('spacing', 'roomy').dispatch('pointerenter');
    assert.ok(ghosts(), 'a later choice redraws at once');
    option('spacing', 'roomy').dispatch('blur');
    assert.equal(ghosts(), null, 'leaving a choice takes the ghosts away');
    assert.equal(lp.canvas.wrapperEl.classList.contains('nf-canvas-previewing'), false, 'and the fade');
    option('branch', 'tree').dispatch('focus'); lp.doc.flush();
    assert.ok(ghosts(), 'the keyboard previews too');
    assert.ok(ghosts().querySelectorAll('rect').some(rect => rect.getAttribute('x') !== String(at(lp, 'a1').x)), 'a branch structure moves its own cards');
    panel.querySelectorAll('.nf-canvas-style-options')[0].dispatch('pointerleave');
    assert.equal(ghosts(), null);
    assert.equal(lp.canvas.wrapperEl.classList.contains('nf-canvas-previewing'), false);
    tile('down').dispatch('pointerenter'); lp.doc.flush();
    assert.ok(ghosts());
    assert.ok(lp.canvas.wrapperEl.classList.contains('nf-canvas-previewing'));
    panel.querySelector('.nf-canvas-style-close').dispatch('click'); lp.doc.flush();
    assert.equal(lp.canvas.wrapperEl.querySelector('.nf-canvas-layout-panel'), null, 'the panel closes');
    assert.equal(ghosts(), null, 'and takes its ghosts with it');
    assert.equal(lp.canvas.wrapperEl.classList.contains('nf-canvas-previewing'), false, 'and the fade');
    assert.deepEqual(lp.canvas.getData(), before);
    assert.equal(lp.canvas.history.data.length, history);
    lp.manager.destroy();
    assert.equal(lp.doc.pendingFrames(), 0);
  }

  /* ---------- panels respect the map: previews zoom out once, side panels pan, popovers sit beside the card ---------- */
  {
    // A view like Canvas's: the wrapper's middle shows (x, y) at scale 2^zoom; the glide ends at once.
    const viewport = (m, view, wrapper = { left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 }) => {
      const c = m.canvas;
      const state = { calls: 0 };
      Object.assign(c, { ...view, tx: view.x, ty: view.y, tZoom: view.zoom,
        markViewportChanged() { state.calls++; this.x = this.tx; this.y = this.ty; this.zoom = this.tZoom; } });
      c.getViewportBBox = () => {
        const s = 2 ** c.zoom;
        return { minX: c.x - wrapper.width / 2 / s, minY: c.y - wrapper.height / 2 / s, maxX: c.x + wrapper.width / 2 / s, maxY: c.y + wrapper.height / 2 / s };
      };
      return { state, wrapper };
    };
    const target = (m) => ({ x: m.canvas.tx, y: m.canvas.ty, zoom: m.canvas.tZoom });
    // Layout reads for the fake DOM: the wrapper, the side panels and the popovers.
    const panelRect = { left: 628, top: 60, right: 944, bottom: 700, width: 316, height: 640 };
    let wrapperRect = null;
    FakeElement.prototype.getBoundingClientRect = function () {
      if (this.classList.contains('nf-canvas-style-panel')) return panelRect;
      if (wrapperRect && this === this.ownerDocument.body.children[0]) return wrapperRect;
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    };
    const popover = { width: 300, height: 200 };
    // A side panel's offset width (0: not laid out, as in the other tests).
    let sideWidth = 0;
    Object.defineProperty(FakeElement.prototype, 'offsetWidth', { configurable: true, get() {
      if (this.classList.contains('nf-canvas-marker-panel')) return popover.width;
      return this.classList.contains('nf-canvas-style-panel') ? sideWidth : 0;
    } });
    Object.defineProperty(FakeElement.prototype, 'offsetHeight', { configurable: true, get() { return this.classList.contains('nf-canvas-marker-panel') ? popover.height : 0; } });
    const mapData = () => ({
      nodes: [nodeData('r', 0, 0, { nfLayout: 'right' }), nodeData('a', 332, -100), nodeData('b', 332, 100), nodeData('a1', 664, -100), nodeData('free', 100, 300)],
      edges: [edgeData('ra', 'r', 'a'), edgeData('rb', 'r', 'b'), edgeData('aa1', 'a', 'a1')],
    });
    try {
      /* The layout preview zooms out once, only as far as needed, and comes back. */
      {
        const lp = fixture(CanvasEnhancements, mapData());
        lp.settings.canvasAnimation = false;
        const container = lp.doc.createElement('svg');
        lp.canvas.wrapperEl.append(container);
        lp.canvas.edgeContainerEl = container;
        const { state, wrapper } = viewport(lp, { x: 462, y: 60, zoom: 0 });
        wrapperRect = wrapper;
        lp.canvas.selectOnly(lp.canvas.nodes.get('a')); lp.doc.flush();
        const before = target(lp);
        lp.button('Layout').dispatch('click'); lp.doc.flush();
        const panel = lp.canvas.wrapperEl.querySelector('.nf-canvas-layout-panel');
        const tile = layout => panel.querySelectorAll('.nf-canvas-style-tile').find(item => item.dataset.layout === layout);
        const grid = panel.querySelector('.nf-canvas-layout-tiles');
        const opened = target(lp);
        // The map reaches under the panel; its left edge (38 px in) lets it move only 14 px.
        assert.deepEqual(opened, { ...before, x: before.x + 14 }, 'opening the panel pans the map as far as its left edge allows');
        const base = state.calls;
        tile('down').dispatch('pointerenter'); lp.doc.flush();
        assert.equal(state.calls, base + 1, 'the first ghosts zoom the view out once');
        assert.ok(lp.canvas.tZoom < opened.zoom, 'out, since the arrangement is wider than the room beside the panel');
        const zoomed = target(lp);
        tile('up').dispatch('pointerenter'); lp.doc.flush();
        assert.equal(state.calls, base + 1, 'another choice in the same preview does not move the view again');
        assert.deepEqual(target(lp), zoomed);
        grid.dispatch('pointerleave');
        assert.deepEqual(target(lp), zoomed, 'a moment of grace for a pointer crossing to the next row');
        lp.doc.flush();
        assert.deepEqual(target(lp), opened, 'leaving the choices puts the view back');
        assert.equal(state.calls, base + 2);
        // Crossing to another row within the grace keeps the view as it is.
        tile('down').dispatch('pointerenter'); lp.doc.flush();
        assert.equal(state.calls, base + 3);
        grid.dispatch('pointerleave');
        const spacing = panel.querySelectorAll('.nf-canvas-style-option').find(item => item.dataset.kind === 'spacing' && item.dataset.value === 'roomy');
        spacing.dispatch('pointerenter'); lp.doc.flush();
        assert.equal(state.calls, base + 3, 'no back and forth between rows');
        spacing.parentElement.dispatch('pointerleave'); lp.doc.flush();
        assert.deepEqual(target(lp), opened);
        assert.equal(state.calls, base + 4);
        // A choice made keeps the zoomed-out view: the map has that shape now.
        // Canvas's own fit would centre the new shape under the panel; it is not asked while a panel is open.
        const fits = [];
        lp.canvas.zoomToBbox = (box) => { fits.push(box); };
        tile('down').dispatch('pointerenter'); lp.doc.flush();
        const chosen = target(lp);
        assert.equal(state.calls, base + 5);
        tile('down').dispatch('click'); lp.doc.flush();
        assert.equal(at(lp, 'r').nfLayout, 'down', 'the layout is applied');
        assert.deepEqual(target(lp), chosen, 'and the view stays out');
        assert.equal(fits.length, 0, 'the new shape shows beside the panel, not centred under it');
        assert.equal(state.calls, base + 5, 'the preview already showed it: no further move');
        grid.dispatch('pointerleave'); lp.doc.flush();
        assert.deepEqual(target(lp), chosen);
        // A choice made with no preview first (the keyboard's Enter on a tile, say) still shows the shape beside the panel.
        Object.assign(lp.canvas, { x: opened.x, y: opened.y, zoom: opened.zoom, tx: opened.x, ty: opened.y, tZoom: opened.zoom });
        lp.manager.bindings.get(lp.view).run('left');
        lp.doc.flush();
        assert.equal(at(lp, 'r').nfLayout, 'left');
        assert.equal(fits.length, 0);
        {
          const s = 2 ** lp.canvas.tZoom;
          const nodes = lp.canvas.getData().nodes.filter(node => node.id !== 'free');
          const right = Math.max(...nodes.map(node => node.x + node.width));
          const left = Math.min(...nodes.map(node => node.x));
          assert.ok(wrapperRect.width / 2 + (right - lp.canvas.tx) * s <= panelRect.left - 8, 'the right end clears the panel');
          assert.ok(wrapperRect.width / 2 + (left - lp.canvas.tx) * s >= 8, 'and the left end stays in view');
          assert.ok(lp.canvas.tZoom <= opened.zoom, 'never zoomed in');
        }
        fits.length = 0;
        const ran = state.calls;
        // A view the user moved meanwhile is left alone.
        Object.assign(lp.canvas, { x: opened.x, y: opened.y, zoom: opened.zoom, tx: opened.x, ty: opened.y, tZoom: opened.zoom });
        tile('right').dispatch('pointerenter'); lp.doc.flush();
        assert.equal(state.calls, ran + 1);
        lp.canvas.tx += 100; lp.canvas.x += 100;
        const moved = target(lp);
        grid.dispatch('pointerleave'); lp.doc.flush();
        assert.deepEqual(target(lp), moved, 'not restored over the user\'s move');
        // Closing the panel mid-preview puts the view back at once.
        Object.assign(lp.canvas, { x: opened.x, y: opened.y, zoom: opened.zoom, tx: opened.x, ty: opened.y, tZoom: opened.zoom });
        tile('right').dispatch('pointerenter'); lp.doc.flush();
        assert.notDeepEqual(target(lp), opened);
        panel.querySelector('.nf-canvas-style-close').dispatch('click');
        assert.deepEqual(target(lp), before, 'closing the panel ends the preview and its zoom, then its pan');
        // With no panel open, a new structure is framed by Canvas as before.
        lp.canvas.selectOnly(lp.canvas.nodes.get('a')); lp.doc.flush();
        lp.manager.bindings.get(lp.view).run('down');
        assert.equal(fits.length, 1, 'Canvas frames the new shape when nothing covers it');
        lp.manager.destroy();
        assert.equal(lp.doc.pendingFrames(), 0);
      }

      /* The style and layout panels pan the map out from under themselves. */
      {
        const st = fixture(CanvasEnhancements, mapData());
        st.settings.canvasAnimation = false;
        // Half scale, the map's middle at the wrapper's: its right end is 103 px under the panel.
        const { state, wrapper } = viewport(st, { x: 462, y: 60, zoom: -1 });
        wrapperRect = wrapper;
        st.canvas.selectOnly(st.canvas.nodes.get('r')); st.doc.flush();
        const v0 = target(st);
        st.button('Style').dispatch('click'); st.doc.flush();
        assert.equal(state.calls, 1, 'one move');
        assert.equal(st.canvas.tx, v0.x + (103 + 24) / 0.5, 'panned left by the overlap and a margin');
        assert.equal(st.canvas.ty, v0.y);
        assert.equal(st.canvas.tZoom, v0.zoom);
        st.button('Style').dispatch('click'); st.doc.flush();
        assert.deepEqual(target(st), v0, 'closing pans back');
        assert.equal(state.calls, 2);
        // Just opened, the panel still scales in from its top right corner, drawn 5 px right of where it
        // settles: the pan reckons with where it comes to rest.
        panelRect.left += 5; sideWidth = 316;
        st.button('Style').dispatch('click'); st.doc.flush();
        assert.equal(st.canvas.tx, v0.x + (103 + 24) / 0.5, 'the same pan as with the panel at rest');
        st.button('Style').dispatch('click'); st.doc.flush();
        assert.deepEqual(target(st), v0);
        panelRect.left -= 5; sideWidth = 0;
        // Moved meanwhile: left where the user put it.
        st.button('Style').dispatch('click'); st.doc.flush();
        st.canvas.tx += 40; st.canvas.x += 40;
        const moved = target(st);
        st.button('Style').dispatch('click'); st.doc.flush();
        assert.deepEqual(target(st), moved, 'not restored over the user\'s move');
        Object.assign(st.canvas, { x: v0.x, tx: v0.x });
        // Style, then Layout in its place: the pan carries over, and closing Layout brings the map back.
        const calls = state.calls;
        st.button('Style').dispatch('click'); st.doc.flush();
        const panned = target(st);
        st.button('Layout').dispatch('click'); st.doc.flush();
        assert.ok(st.canvas.wrapperEl.querySelector('.nf-canvas-layout-panel'));
        assert.deepEqual(target(st), panned, 'switching panels keeps the pan: no back and forth');
        assert.equal(state.calls, calls + 1);
        st.button('Layout').dispatch('click'); st.doc.flush();
        assert.deepEqual(target(st), v0, 'and the last panel to close brings the map back');
        // A map clear of the panel stays put.
        Object.assign(st.canvas, { x: 900, tx: 900 });
        const clear = target(st);
        st.button('Style').dispatch('click'); st.doc.flush();
        assert.deepEqual(target(st), clear, 'nothing under the panel, no pan');
        st.button('Style').dispatch('click'); st.doc.flush();
        // Opening markers closes the panel, and pans back too.
        Object.assign(st.canvas, { x: v0.x, tx: v0.x });
        st.button('Style').dispatch('click'); st.doc.flush();
        assert.notDeepEqual(target(st), v0);
        st.command('markers'); st.doc.flush();
        assert.ok(st.canvas.wrapperEl.querySelector('.nf-canvas-marker-panel'));
        assert.deepEqual(target(st), v0);
        st.manager.destroy();
      }

      /* The marker and color popovers sit beside their card. */
      {
        const pp = fixture(CanvasEnhancements, mapData());
        pp.settings.canvasAnimation = false;
        // Scale 1, the view centred on (462, 60): a card's screen box is its canvas box moved by (38, 340).
        const { wrapper } = viewport(pp, { x: 462, y: 60, zoom: 0 });
        wrapperRect = wrapper;
        const screen = id => { const d = at(pp, id); return { left: d.x + 38, top: d.y + 340, right: d.x + d.width + 38, bottom: d.y + d.height + 340 }; };
        const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        const placed = el => {
          const match = /^(-?\d+)px auto auto (-?\d+)px$/.exec(el.style.inset ?? '');
          assert.ok(match, `anchored with the physical inset shorthand: ${el.style.inset}`);
          const top = Number(match[1]), left = Number(match[2]);
          return { left, top, right: left + popover.width, bottom: top + popover.height };
        };
        const inside = box => box.left >= wrapper.left + 8 && box.top >= wrapper.top + 60 && box.right <= wrapper.right - 56 && box.bottom <= wrapper.bottom - 8;
        pp.canvas.selectOnly(pp.canvas.nodes.get('a')); pp.doc.flush();
        pp.command('colorBranch'); pp.doc.flush();
        const color = pp.canvas.wrapperEl.querySelector('.nf-canvas-color-panel');
        let box = placed(color);
        assert.ok(box.left >= screen('a').right + 12, 'beside the card, on the side away from the map\'s middle');
        assert.equal(box.left, screen('a').right + 12);
        assert.equal(box.top, (screen('a').top + screen('a').bottom) / 2 - popover.height / 2, 'vertically centred on it');
        assert.equal(color.style.translate, 'none', 'no longer centred under the toolbar');
        assert.ok(color.classList.contains('is-anchored'));
        assert.equal(color.dataset.side, 'right');
        assert.equal(overlap(box, screen('a')), 0);
        assert.ok(inside(box));
        // It follows the selection.
        pp.canvas.selectOnly(pp.canvas.nodes.get('b')); pp.doc.flush();
        box = placed(color);
        assert.equal(overlap(box, screen('b')), 0);
        assert.equal(box.top, (screen('b').top + screen('b').bottom) / 2 - popover.height / 2, 'next to the newly selected card');
        // A card near the right edge: the popover flips to its left.
        pp.canvas.selectOnly(pp.canvas.nodes.get('a1')); pp.doc.flush();
        box = placed(color);
        assert.equal(color.dataset.side, 'left');
        assert.equal(box.right, screen('a1').left - 12);
        assert.equal(overlap(box, screen('a1')), 0);
        assert.ok(inside(box));
        // Nothing to color: back under the toolbar.
        pp.canvas.deselect(pp.canvas.nodes.get('a1')); pp.canvas.selection.clear(); pp.manager.refresh(); pp.doc.flush();
        assert.ok(pp.canvas.wrapperEl.querySelector('.nf-canvas-color-panel'), 'still open, showing its empty state');
        assert.ok(!color.style.inset, 'the inline placement is removed');
        assert.ok(!color.style.translate);
        assert.equal(color.classList.contains('is-anchored'), false);
        pp.command('colorBranch'); pp.doc.flush();
        // The marker popover, also for a free card: away from the wrapper's middle, or where there is room.
        pp.canvas.selectOnly(pp.canvas.nodes.get('free')); pp.doc.flush();
        pp.command('markers'); pp.doc.flush();
        const markers = pp.canvas.wrapperEl.querySelector('.nf-canvas-marker-panel');
        box = placed(markers);
        assert.equal(markers.dataset.side, 'right', 'the free card is left of the middle, but has no room on its left');
        assert.equal(overlap(box, screen('free')), 0);
        assert.ok(inside(box));
        // Several cards: beside all of them.
        pp.canvas.selectAll([pp.canvas.nodes.get('a'), pp.canvas.nodes.get('b')]); pp.manager.refresh(); pp.doc.flush();
        box = placed(markers);
        assert.equal(overlap(box, screen('a')) + overlap(box, screen('b')), 0);
        pp.manager.destroy();
      }
    } finally {
      delete FakeElement.prototype.getBoundingClientRect;
      delete FakeElement.prototype.offsetWidth;
      delete FakeElement.prototype.offsetHeight;
    }
  }

  /* ---------- colouring one branch ---------- */
  {
    const cb = fixture(CanvasEnhancements, {
      nodes: [nodeData('r', 0, 0, { nfLayout: 'right' }), nodeData('a', 332, -100), nodeData('b', 332, 100), nodeData('a1', 664, -100),
        nodeData('s', 664, 0, { nfSummary: { parent: 'a', from: 'a1', to: 'a1' } })],
      edges: [edgeData('ra', 'r', 'a'), edgeData('rb', 'r', 'b'), edgeData('aa1', 'a', 'a1')],
    });
    cb.settings.canvasAnimation = false;
    assert.equal(cb.command('colorBranch', true), false, 'nothing selected, nothing to colour');
    cb.canvas.selectOnly(cb.canvas.nodes.get('a')); cb.doc.flush();
    assert.equal(cb.command('colorBranch'), true);
    cb.doc.flush();
    const opened = () => cb.canvas.wrapperEl.querySelector('.nf-canvas-color-panel');
    const panel = opened();
    assert.ok(panel, 'the colour picker opens');
    assert.ok(panel.classList.contains('nf-canvas-marker-panel') && panel.classList.contains('nf-canvas-ui'), 'dressed like the marker picker');
    assert.equal(panel.classList.contains('is-empty'), false);
    const swatch = value => panel.querySelectorAll('.nf-canvas-color-swatch').find(item => item.dataset.color === value);
    assert.equal(panel.querySelectorAll('.nf-canvas-color-swatch').length, 6, 'the six Canvas colours');
    assert.equal(swatch('3').getAttribute('aria-label'), 'Yellow');
    assert.equal(swatch('3').style.getPropertyValue('--nf-swatch'), 'var(--canvas-color-3)');
    const clear = panel.querySelector('.nf-canvas-marker-clear');
    assert.equal(clear.disabled, true, 'nothing to clear yet');
    const steps = cb.canvas.history.data.length;
    swatch('3').dispatch('click'); cb.doc.flush();
    for (const id of ['a', 'a1', 's']) assert.equal(at(cb, id).color, '3', `${id} takes the colour`);
    for (const id of ['r', 'b']) assert.equal(at(cb, id).color, undefined, `${id} keeps none`);
    assert.equal(cb.canvas.edges.get('ra').getData().color, '3', 'the line into the branch too');
    assert.equal(cb.canvas.edges.get('aa1').getData().color, '3');
    assert.equal(cb.canvas.edges.get('rb').getData().color, undefined);
    assert.equal(cb.canvas.history.data.length, steps + 1, 'colouring is one undo step');
    assert.equal(swatch('3').getAttribute('aria-pressed'), 'true', 'the picker shows the branch’s colour');
    assert.equal(clear.disabled, false);
    assert.ok(opened(), 'and stays open for the next card');
    const hex = panel.querySelector('.nf-canvas-color-hex');
    assert.equal(hex.getAttribute('aria-label'), 'Custom (hex)');
    hex.value = '4A90D9';
    hex.dispatch('keydown', { key: 'Enter' }); cb.doc.flush();
    assert.equal(at(cb, 'a1').color, '#4a90d9', 'a typed hex colour is normalised');
    assert.equal(swatch('3').getAttribute('aria-pressed'), 'false');
    hex.value = 'nope';
    hex.dispatch('change'); cb.doc.flush();
    assert.equal(at(cb, 'a1').color, '#4a90d9', 'nonsense changes nothing');
    assert.equal(hex.classList.contains('is-invalid'), true, 'and is marked');
    clear.dispatch('click'); cb.doc.flush();
    for (const id of ['a', 'a1', 's']) assert.equal(at(cb, id).color, undefined, `clearing takes ${id}’s colour away`);
    assert.equal(cb.canvas.edges.get('aa1').getData().color, undefined);
    cb.canvas.undo(); cb.doc.flush();
    assert.equal(at(cb, 'a1').color, '#4a90d9', 'one undo restores the colour');
    cb.canvas.selectOnly(cb.canvas.nodes.get('s')); cb.doc.flush();
    assert.equal(panel.classList.contains('is-empty'), true, 'a summary is not a branch');
    cb.canvas.selectOnly(cb.canvas.nodes.get('b')); cb.doc.flush();
    assert.equal(panel.classList.contains('is-empty'), false);
    assert.equal(cb.canvas.wrapperEl.dispatch('keydown', keyEvent('Escape', cb.canvas.wrapperEl)).defaultPrevented, true, 'Escape closes the picker');
    cb.doc.flush();
    assert.equal(opened(), null);
    assert.equal(cb.command('colorBranch'), true); cb.doc.flush();
    assert.ok(opened(), 'the command reopens it');
    assert.equal(cb.command('colorBranch'), true); cb.doc.flush();
    assert.equal(opened(), null, 'and closes it again');
    cb.command('colorBranch'); cb.doc.flush();
    cb.manager.destroy();
    assert.equal(opened(), null, 'teardown removes it');
  }

  /* ---------- the branch colour offers the map's own tones and the recent colours ---------- */
  {
    const store = {};
    const app = { loadLocalStorage: (key) => store[key], saveLocalStorage: (key, value) => { store[key] = value; } };
    // The page resolves light-dark(A, B) to A in a light theme; the fake reads A back as rgb().
    const probed = [];
    const computed = (color) => {
      probed.push(color);
      const hex = /^light-dark\((#[0-9a-f]{6}),/i.exec(color)?.[1] ?? (/^#[0-9a-f]{6}$/i.test(color) ? color : null);
      if (!hex) return '';
      return `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
    };
    const data = (palette) => ({
      nodes: [nodeData('r', 0, 0, { nfLayout: 'right', ...(palette ? { nfPalette: palette } : {}) }), nodeData('a', 332, -100), nodeData('b', 332, 100), nodeData('a1', 664, -100)],
      edges: [edgeData('ra', 'r', 'a'), edgeData('rb', 'r', 'b'), edgeData('aa1', 'a', 'a1')],
    });
    const tc = fixture(CanvasEnhancements, data('sakura'), app, { computed });
    tc.settings.canvasAnimation = false;
    tc.canvas.selectOnly(tc.canvas.nodes.get('a')); tc.doc.flush();
    tc.command('colorBranch'); tc.doc.flush();
    const panel = tc.canvas.wrapperEl.querySelector('.nf-canvas-color-panel');
    const row = (name) => panel.querySelectorAll('.nf-canvas-color-row').find((item) => item.dataset.row === name);
    const colors = (name) => row(name).querySelectorAll('.nf-canvas-color-swatch').map((item) => item.dataset.color);
    const sakura = ['#C5788D', '#9876AE', '#619CB3', '#67A490', '#C99A70', '#817FB5'].map((color) => color.toLowerCase());
    assert.deepEqual(panel.querySelectorAll('.nf-canvas-color-row').map((item) => item.dataset.row), ['scheme', 'recent', 'canvas'], 'three rows, the map’s first');
    assert.equal(row('scheme').hidden, false);
    assert.deepEqual(colors('scheme'), sakura, 'the map scheme row holds sakura’s six tones as hex');
    const label = row('scheme').querySelector('.nf-canvas-marker-group');
    assert.equal(label.textContent, 'Map scheme');
    assert.equal(label.getAttribute('aria-label'), 'A written color does not follow later light/dark switches', 'its label says a hex stays put');
    assert.equal(row('canvas').querySelector('.nf-canvas-marker-group').getAttribute('aria-label'), null, 'Canvas’s own colours do follow the theme');
    assert.equal(row('recent').hidden, true, 'no recent colours yet');
    assert.deepEqual(colors('canvas'), ['1', '2', '3', '4', '5', '6']);
    const probes = probed.length;
    tc.manager.refresh(); tc.doc.flush();
    assert.equal(probed.length, probes, 'the tones are read once per palette and mode, not per render');
    const steps = tc.canvas.history.data.length;
    row('scheme').querySelectorAll('.nf-canvas-color-swatch')[1].dispatch('click'); tc.doc.flush();
    for (const id of ['a', 'a1']) assert.equal(at(tc, id).color, sakura[1], `${id} takes the tone as hex`);
    assert.equal(tc.canvas.edges.get('ra').getData().color, sakura[1]);
    assert.equal(at(tc, 'b').color, undefined);
    assert.equal(tc.canvas.history.data.length, steps + 1, 'one undo step');
    assert.equal(row('recent').hidden, false, 'a recent row appears');
    assert.deepEqual(colors('recent'), [sakura[1]]);
    assert.deepEqual(store['nf-canvas-color-recent'], [sakura[1]], 'kept in local storage');
    assert.deepEqual(panel.querySelectorAll('.nf-canvas-color-swatch').filter((item) => item.getAttribute('aria-pressed') === 'true').map((item) => item.dataset.color),
      [sakura[1], sakura[1]], 'both swatches of that colour are pressed');
    const hex = panel.querySelector('.nf-canvas-color-hex');
    hex.value = '#ABCDEF';
    hex.dispatch('keydown', { key: 'Enter' }); tc.doc.flush();
    assert.equal(at(tc, 'a').color, '#abcdef');
    assert.deepEqual(colors('recent'), ['#abcdef', sakura[1]], 'the newest first');
    row('canvas').querySelectorAll('.nf-canvas-color-swatch')[2].dispatch('click'); tc.doc.flush();
    assert.equal(at(tc, 'a').color, '3');
    assert.deepEqual(store['nf-canvas-color-recent'], ['#abcdef', sakura[1]], 'Canvas’s own colours have their row and are not recorded');
    // A Recent pick from the keyboard: the swatch moves first and keeps the focus.
    const recentButtons = () => row('recent').querySelectorAll('.nf-canvas-color-swatch');
    const [newest, older] = recentButtons();
    older.focus();
    older.dispatch('click'); tc.doc.flush();
    assert.equal(at(tc, 'a').color, sakura[1]);
    assert.deepEqual(colors('recent'), [sakura[1], '#abcdef'], 'the picked recent colour moves first');
    assert.ok(recentButtons()[0] === older && recentButtons()[1] === newest, 'the same buttons, reordered');
    assert.ok(tc.doc.activeElement === older, 'the focused swatch keeps the focus');
    assert.ok(panel.contains(tc.doc.activeElement), 'inside the picker, where Escape still closes it');
    older.dispatch('click'); tc.doc.flush();
    assert.ok(recentButtons()[0] === older && tc.doc.activeElement === older, 'picking the newest again moves nothing');
    // A three-digit hex goes on as #rrggbb and is recorded.
    hex.value = 'f80';
    hex.dispatch('keydown', { key: 'Enter' }); tc.doc.flush();
    assert.equal(at(tc, 'a').color, '#ff8800', 'a short hex is written in full');
    assert.equal(hex.classList.contains('is-invalid'), false);
    assert.deepEqual(colors('recent'), ['#ff8800', sakura[1], '#abcdef'], 'and joins Recent');
    assert.deepEqual(store['nf-canvas-color-recent'], ['#ff8800', sakura[1], '#abcdef']);
    assert.deepEqual(panel.querySelectorAll('.nf-canvas-color-swatch').filter((item) => item.getAttribute('aria-pressed') === 'true').map((item) => item.dataset.color),
      ['#ff8800'], 'its Recent swatch shows pressed');
    hex.value = '#ABC';
    hex.dispatch('keydown', { key: 'Enter' }); tc.doc.flush();
    assert.equal(at(tc, 'a').color, '#aabbcc', 'with or without # and in any case');
    tc.command('colorBranch'); tc.doc.flush();
    tc.command('colorBranch'); tc.doc.flush();
    const reopened = tc.canvas.wrapperEl.querySelector('.nf-canvas-color-panel');
    assert.notEqual(reopened, panel);
    assert.deepEqual(reopened.querySelectorAll('.nf-canvas-color-row').find((item) => item.dataset.row === 'recent').querySelectorAll('.nf-canvas-color-swatch')
      .map((item) => item.dataset.color), ['#aabbcc', '#ff8800', sakura[1], '#abcdef'], 'a new picker loads the recent colours');
    tc.manager.destroy();

    for (const palette of ['none', null]) {
      const plain = fixture(CanvasEnhancements, data(palette), app, { computed });
      plain.canvas.selectOnly(plain.canvas.nodes.get('a')); plain.doc.flush();
      plain.command('colorBranch'); plain.doc.flush();
      const p = plain.canvas.wrapperEl.querySelector('.nf-canvas-color-panel');
      assert.equal(p.querySelectorAll('.nf-canvas-color-row').find((item) => item.dataset.row === 'scheme').hidden, true, `${palette}: no map scheme row`);
      plain.manager.destroy();
    }
    // A map without a palette of its own shows the paired one, and offers its tones.
    const paired = fixture(CanvasEnhancements, data(null), app, { computed });
    paired.settings.canvasFallbackPalette = 'nord';
    paired.canvas.selectOnly(paired.canvas.nodes.get('b')); paired.doc.flush();
    paired.command('colorBranch'); paired.doc.flush();
    const pp = paired.canvas.wrapperEl.querySelector('.nf-canvas-color-panel');
    assert.deepEqual(pp.querySelectorAll('.nf-canvas-color-row').find((item) => item.dataset.row === 'scheme').querySelectorAll('.nf-canvas-color-swatch')
      .map((item) => item.dataset.color), ['#81a1c1', '#88c0d0', '#a3be8c', '#b48ead', '#d08770', '#ebcb8b']);
    paired.manager.destroy();

    // Tones built on page variables follow a theme, accent or snippet change
    // (same light mode, same CSS strings) at the next opening of the picker.
    const themes = {
      A: ['#e93147', '#ec7500', '#e0ac00', '#08b94e', '#00bfbc', '#7852ee'],
      B: ['#bf616a', '#d08770', '#ebcb8b', '#a3be8c', '#88c0d0', '#b48ead'],
    };
    let theme = 'A';
    const byVariable = (color) => {
      const hex = themes[theme][Number(/^var\(--canvas-color-([1-6])\)$/.exec(color)?.[1]) - 1];
      return hex ? `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})` : '';
    };
    const digits = { nfPalette: 'custom', nfPaletteColors: { rootColor: '5', branchColors: ['1', '2', '3', '4', '5', '6'] } };
    const vt = fixture(CanvasEnhancements, {
      nodes: [nodeData('r', 0, 0, { nfLayout: 'right', ...digits }), nodeData('a', 332, 0)], edges: [edgeData('ra', 'r', 'a')],
    }, app, { computed: byVariable });
    vt.settings.canvasAnimation = false;
    vt.canvas.selectOnly(vt.canvas.nodes.get('a')); vt.doc.flush();
    const tones = () => vt.canvas.wrapperEl.querySelector('.nf-canvas-color-panel').querySelectorAll('.nf-canvas-color-row')
      .find((item) => item.dataset.row === 'scheme').querySelectorAll('.nf-canvas-color-swatch').map((item) => item.dataset.color);
    vt.command('colorBranch'); vt.doc.flush();
    assert.deepEqual(tones(), themes.A, 'the digits read as the current theme’s colours');
    theme = 'B';
    vt.manager.refresh(); vt.doc.flush();
    vt.command('colorBranch'); vt.doc.flush();
    vt.command('colorBranch'); vt.doc.flush();
    assert.deepEqual(tones(), themes.B, 'reopened after the theme changed, the picker offers the new tones');
    vt.manager.destroy();
  }

  /* ---------- structures and styles ---------- */
  const st = fixture(CanvasEnhancements, {
    nodes: [nodeData('r', 0, 0, { nfLayout: 'right' }), nodeData('a'), nodeData('b', 0, 0, { color: '4' }), nodeData('a1')],
    edges: [edgeData('ra', 'r', 'a'), edgeData('rb', 'r', 'b', { color: '4' }), edgeData('aa1', 'a', 'a1')],
  });
  st.canvas.wrapperEl.focus();
  st.canvas.selectOnly(st.canvas.nodes.get('a')); st.doc.flush();
  assert.equal(st.command('timeline'), true, 'any map can become a timeline');
  st.doc.flush();
  assert.equal(at(st, 'r').nfLayout, 'timeline');
  assert.equal(centerY(at(st, 'a')), centerY(at(st, 'r')), 'events sit on the line');
  assert.equal(centerY(at(st, 'b')), centerY(at(st, 'r')));
  assert.ok(at(st, 'a1').y > at(st, 'a').y + at(st, 'a').height, 'details hang below their event');
  assert.deepEqual([st.canvas.edges.get('aa1').getData().fromSide, st.canvas.edges.get('aa1').getData().toSide], ['bottom', 'left']);
  const badgeSide = st.canvas.nodes.get('a').nodeEl.children.find(child => child.classList.contains('nf-canvas-fold')).dataset.side;
  assert.equal(badgeSide, 'bottom', 'the fold badge sits where the details leave');
  st.canvas.selectOnly(st.canvas.nodes.get('a')); st.doc.flush();
  assert.equal(st.scope.dispatch(keyEvent('Enter', st.canvas.wrapperEl)), false, 'Enter adds the next event');
  const nextEvent = [...st.canvas.selection][0];
  nextEvent.isEditing = false; nextEvent.nodeEl.classList.remove('is-editing'); st.doc.flush();
  assert.equal(centerY(at(st, nextEvent.id)), centerY(at(st, 'r')), 'on the line');
  assert.ok(at(st, nextEvent.id).x > at(st, 'a').x && at(st, nextEvent.id).x < at(st, 'b').x, 'right after the selected event');
  st.canvas.undo(); st.doc.flush();
  st.canvas.selectOnly(st.canvas.nodes.get('a')); st.doc.flush();
  assert.equal(st.command('tree'), true);
  assert.equal(at(st, 'r').nfLayout, 'tree');
  assert.ok(at(st, 'a').y > at(st, 'r').y + at(st, 'r').height && at(st, 'a').x > at(st, 'r').x, 'a tree chart indents below');
  assert.equal(st.command('timeline-vertical'), true);
  assert.equal(at(st, 'a').x + at(st, 'a').width / 2, at(st, 'r').x + at(st, 'r').width / 2, 'a vertical timeline lines events up under the start');
  st.canvas.undo(); st.canvas.undo(); st.canvas.undo(); st.doc.flush();
  assert.equal(at(st, 'r').nfLayout, 'right', 'each structure change is one undo step');

  // Changing structure keeps the reading order, not an order read off positions.
  const order = fixture(CanvasEnhancements, {
    nodes: [nodeData('r', 0, 0, { nfLayout: 'balanced' }), nodeData('a', 400, -200), nodeData('b', 400, 200),
      nodeData('c', -400, 200), nodeData('d', -400, -200)],
    edges: [edgeData('ra', 'r', 'a'), edgeData('rb', 'r', 'b'), edgeData('rc', 'r', 'c', { fromSide: 'left', toSide: 'right' }),
      edgeData('rd', 'r', 'd', { fromSide: 'left', toSide: 'right' })],
  });
  order.canvas.wrapperEl.focus();
  order.canvas.selectOnly(order.canvas.nodes.get('r')); order.doc.flush();
  assert.equal(order.command('timeline'), true);
  const byX = ['a', 'b', 'c', 'd'].sort((p, q) => at(order, p).x - at(order, q).x);
  assert.deepEqual(byX, ['a', 'b', 'c', 'd'], 'clockwise reading order becomes the timeline, left to right');
  assert.equal(order.command('balanced'), true);
  assert.deepEqual(['a', 'b'].map(id => at(order, id).x > at(order, 'r').x), [true, true], 'and back: the first half reads down the right side');
  assert.ok(at(order, 'a').y < at(order, 'b').y);
  assert.ok(at(order, 'd').y < at(order, 'c').y, 'the rest reads up the left side');
  order.manager.destroy();

  // Styles: per map, over the default; the vivid palette is display-only.
  st.canvas.selectOnly(st.canvas.nodes.get('a')); st.doc.flush(); st.manager.refresh();
  const themed = (id, theme) => st.canvas.nodes.get(id).nodeEl.classList.contains(`nf-theme-${theme}`);
  assert.equal(themed('a', 'clean'), true, 'maps follow the default style');
  assert.equal(st.button('Style').disabled, false);
  const styleSteps = st.canvas.history.current;
  assert.equal(st.manager.bindings.get(st.view).run('theme-vivid'), true);
  assert.equal(at(st, 'r').nfTheme, 'vivid', 'a chosen style is stored on the root');
  assert.equal(st.canvas.history.current, styleSteps + 1, 'in one undo step');
  assert.equal(themed('a', 'vivid') && themed('a1', 'vivid') && !themed('a', 'clean'), true);
  assert.equal(st.canvas.edges.get('ra').lineGroupEl.classList.contains('nf-theme-vivid'), true, 'branch lines take the style too');
  const auto = id => st.canvas.nodes.get(id).nodeEl.style.getPropertyValue('--nf-auto');
  assert.equal(auto('a'), 'var(--canvas-color-1)', 'uncoloured branches take the palette in order');
  assert.equal(auto('a1'), 'var(--canvas-color-1)', 'down the whole branch');
  assert.equal(auto('b'), '', 'a card with its own colour keeps it');
  assert.equal(auto('r'), '', 'the centre keeps the accent');
  assert.equal(st.canvas.edges.get('aa1').lineGroupEl.style.getPropertyValue('--nf-auto'), 'var(--canvas-color-1)');
  assert.equal(st.canvas.edges.get('rb').lineGroupEl.style.getPropertyValue('--nf-auto'), '');
  assert.equal(at(st, 'a').color, undefined, 'and nothing is written');
  st.settings.canvasMapStyle = 'minimal'; st.manager.refresh();
  assert.equal(themed('a', 'vivid'), true, 'a map with its own style ignores the default');
  st.manager.bindings.get(st.view).run('theme-cards');
  assert.equal(auto('a'), '', 'leaving vivid clears the palette');
  st.canvas.undo(); st.canvas.undo(); st.doc.flush(); st.manager.refresh();
  assert.equal(at(st, 'r').nfTheme, undefined);
  assert.equal(themed('a', 'minimal'), true, 'without its own style a map follows the new default');
  st.settings.canvasMapStyle = 'clean';

  // Clearing branch colours takes the palette off cards and lines at once.
  st.canvas.selectOnly(st.canvas.nodes.get('a')); st.doc.flush();
  const colourSteps = st.canvas.history.current;
  assert.equal(st.command('uncolor'), true);
  assert.equal(at(st, 'b').color, undefined);
  assert.equal(st.canvas.edges.get('rb').getData().color, undefined);
  assert.equal(st.canvas.history.current, colourSteps + 1);
  assert.equal(st.command('uncolor', true), false, 'nothing left to clear');
  st.canvas.undo(); st.doc.flush();
  assert.equal(at(st, 'b').color, '4', 'one undo brings the colours back');

  // Presets have a visible palette while manually coloured cards and relations
  // retain their colour. Disabling it wins over vivid's legacy default palette.
  st.canvas.selectOnly(st.canvas.nodes.get('a')); st.doc.flush();
  assert.equal(st.command('preset-mist'), true);
  assert.match(auto('r'), /^#[0-9a-f]{6}$/i, 'the centre uses the selected preset colour');
  assert.match(auto('a'), /^#[0-9a-f]{6}$/i, 'branches use the selected preset palette');
  assert.equal(auto('b'), '', 'explicit card colours take precedence');
  assert.equal(st.canvas.edges.get('ra').lineGroupEl.style.getPropertyValue('--nf-auto'), auto('a'));
  assert.equal(st.canvas.edges.get('rb').lineGroupEl.style.getPropertyValue('--nf-auto'), '', 'explicit line colours take precedence');
  st.settings.canvasAppearance = false; st.manager.refresh();
  assert.equal(auto('r'), ''); assert.equal(auto('a'), '', 'turning appearance off removes automatic colours');
  st.settings.canvasAppearance = true; st.manager.refresh();
  assert.match(auto('a'), /^#[0-9a-f]{6}$/i);
  st.manager.bindings.get(st.view).run('theme-vivid');
  assert.equal(st.command('palette-off'), true);
  assert.equal(auto('r'), ''); assert.equal(auto('a'), '', 'palette-off also disables vivid automatic colours');
  assert.equal(st.canvas.edges.get('ra').lineGroupEl.style.getPropertyValue('--nf-auto'), '');
  st.manager.destroy();
  assert.equal(st.canvas.nodes.get('a').nodeEl.classList.contains('nf-theme-clean'), false, 'teardown removes style classes');
  assert.equal(st.canvas.nodes.get('a').nodeEl.style.getPropertyValue('--nf-auto'), '');

  /* ---------- notes and maps ---------- */
  const files = new Map([['Ideas/Plan.md', '# Plan\n## Goals\n- Ship\n## Risks']]);
  const created = [];
  const opened = [];
  const noteApp = {
    vault: {
      async cachedRead(file) { return files.get(file.path); },
      getAbstractFileByPath(path) { return files.has(path) ? { path } : null; },
      async create(path, text) { files.set(path, text); created.push(path); return { path }; },
      getMarkdownFiles() { return []; },
    },
    metadataCache: { fileToLinktext(file) { return file.path.replace(/\.md$/, '').split('/').pop(); } },
  };
  const nf = fixture(CanvasEnhancements, { nodes: [nodeData('old', 0, 0)], edges: [] }, noteApp);
  nf.workspace.getLeaf = () => ({ async openFile(file) { opened.push(file.path); } });
  nf.view.file = { path: 'Boards/Map.canvas' };
  nf.manager.refresh();
  const binding = nf.manager.bindings.get(nf.view);
  const noteSteps = nf.canvas.history.data.length;
  assert.equal(await binding.insertNote({ path: 'Ideas/Plan.md' }), true);
  nf.doc.flush();
  const rootCard = [...nf.canvas.nodes.values()].map(item => item.getData()).find(item => item.nfLayout);
  assert.equal(rootCard.text, '[[Plan|Plan]]', 'the note becomes the linked central topic');
  const texts = [...nf.canvas.nodes.values()].map(item => item.getData().text).sort();
  assert.deepEqual(texts, ['Goals', 'Plan', 'Risks', 'Ship', 'old', '[[Plan|Plan]]'].filter(text => text !== 'Plan').sort(), 'headings lose their marks as topics');
  assert.ok(rootCard.x >= 260, 'the map does not land on existing cards');
  assert.equal(nf.canvas.history.current, noteSteps, 'the whole map is one undo step');
  assert.equal(globalThis.__nfNotices.at(-1), 'Mapped 4 cards from the note.');
  nf.canvas.undo(); nf.doc.flush();
  assert.equal(nf.canvas.nodes.size, 1, 'and undo removes it');
  assert.equal(await binding.insertNote({ path: 'Ideas/Plan.md' }), true);
  nf.doc.flush();
  files.set('Ideas/Prose.md', 'Just prose.');
  assert.equal(await binding.insertNote({ path: 'Ideas/Prose.md' }), false, 'prose alone has nothing to map');

  const mapRoot = [...nf.canvas.nodes.values()].find(item => item.getData().nfLayout);
  nf.canvas.selectOnly(mapRoot); nf.doc.flush();
  files.set('Boards/Plan.md', 'taken');
  assert.equal(nf.command('exportNote'), true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(created, ['Boards/Plan 1.md'], 'exports land beside the canvas under a free name');
  assert.equal(files.get('Boards/Plan 1.md'), '- [[Plan|Plan]]\n\t- Goals\n\t\t- Ship\n\t- Risks\n');
  assert.deepEqual(opened, ['Boards/Plan 1.md'], 'and open in a new tab');
  assert.equal(globalThis.__nfNotices.at(-1), 'Exported 4 cards to Boards/Plan 1.md.');
  nf.manager.destroy();

  /* ---------- Round four: branch lines, boundaries, levels, progress, presenting ---------- */
  {
    const lineData = {
      nodes: [
        nodeData('c', 0, 0, { nfLayout: 'balanced', width: 200, height: 60 }),
        nodeData('r1', 400, -100, { width: 200, height: 60 }), nodeData('r1a', 800, -100, { width: 200, height: 60 }),
        nodeData('r2', 400, 100, { width: 200, height: 60 }), nodeData('l1', -500, 0, { width: 200, height: 60 }),
        nodeData('free', 2000, 2000),
      ],
      edges: [edgeData('c-r1', 'c', 'r1'), edgeData('r1-r1a', 'r1', 'r1a'), edgeData('c-r2', 'c', 'r2'),
        edgeData('c-l1', 'c', 'l1', { fromSide: 'left', toSide: 'right' }), edgeData('rel', 'r2', 'free', { label: 'see also' })],
    };
    const l = fixture(CanvasEnhancements, lineData);
    l.manager.refresh(); l.doc.flush();
    const edge = id => l.canvas.edges.get(id);
    const own = id => Object.prototype.hasOwnProperty.call(edge(id), 'updatePath');
    assert.equal(own('c-r1'), true, 'map connections carry the line override');
    assert.equal(own('rel'), false, 'relationship lines stay entirely native');
    const trunk = edge('c-r1').path.display.getAttribute('d');
    assert.match(trunk, /^M.* Z$/, 'mind maps draw tapered branches by default');
    assert.match(edge('c-r1').path.interaction.getAttribute('d'), /^M[\d. -]+ C/, 'the pointer grabs the centre line');
    assert.equal(edge('c-r1').lineGroupEl.classList.contains('nf-line-organic'), true);
    assert.equal(edge('rel').path.display.getAttribute('d'), 'native');
    // Canvas redraws a connection whenever a card moves: the style survives.
    l.canvas.nodes.get('r1').moveTo({ x: 420, y: -80 });
    edge('c-r1').updatePath();
    assert.notEqual(edge('c-r1').path.display.getAttribute('d'), trunk, 'the line follows the card');
    assert.match(edge('c-r1').path.display.getAttribute('d'), / Z$/);
    assert.ok(edge('c-r1').nativeDraws >= 2, 'Canvas still draws first, so its own bookkeeping runs');
    l.canvas.undo(); l.manager.refresh();
    const widths = (id) => {
      const d = edge(id).path.display.getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number);
      return Math.abs(d[1] - d[d.length - 1]);
    };
    assert.ok(Math.abs(widths('c-r1') - 9) < 0.2, 'main branches leave the centre thick');
    assert.ok(Math.abs(widths('r1-r1a') - 3.6) < 0.2, 'sub-branches start where their parent line ended');

    l.canvas.selectOnly(l.canvas.nodes.get('r1a')); l.doc.flush();
    assert.equal(edge('r1-r1a').lineGroupEl.classList.contains('nf-canvas-trail'), true, 'the way back to the centre is marked');
    assert.equal(edge('c-r1').lineGroupEl.classList.contains('nf-canvas-trail'), true);
    assert.equal(edge('c-r2').lineGroupEl.classList.contains('nf-canvas-trail'), false);

    const steps = l.canvas.history.current;
    assert.equal(l.command('line-elbow'), true);
    assert.equal(l.canvas.nodes.get('c').getData().nfLine, 'elbow', 'a map’s lines are stored on its centre');
    assert.equal(l.canvas.history.current, steps + 1, 'in one undo step');
    assert.match(edge('c-r1').path.display.getAttribute('d'), / Q/, 'elbows round their bends');
    assert.doesNotMatch(edge('c-r1').path.display.getAttribute('d'), / Z$/);
    assert.equal(edge('c-r1').lineGroupEl.classList.contains('nf-line-elbow'), true);
    assert.equal(edge('c-r1').lineGroupEl.classList.contains('nf-line-organic'), false);
    assert.equal(l.command('line-curve'), true);
    assert.match(edge('c-r1').path.display.getAttribute('d'), /^M[\d. -]+ C[\d. -]+$/, 'curves are one stroked bezier, drawn so siblings fan out');
    assert.equal(edge('c-r1').path.display.getAttribute('d'), edge('c-r1').path.interaction.getAttribute('d'), 'the pointer grabs the line itself');
    assert.equal(edge('c-r1').lineGroupEl.classList.contains('nf-line-curve'), true);
    assert.equal(edge('c-r1').lineGroupEl.classList.contains('nf-line-elbow'), false);
    assert.equal(own('rel'), false, 'relationship lines stay native with curved branches too');
    assert.equal(edge('rel').path.display.getAttribute('d'), 'native');
    l.canvas.undo(); l.manager.refresh();
    assert.match(edge('c-r1').path.display.getAttribute('d'), / Q/, 'undo brings the elbows back');
    l.canvas.undo(); l.manager.refresh();
    assert.equal(l.canvas.nodes.get('c').getData().nfLine, undefined);
    l.settings.canvasLineStyle = 'straight'; l.manager.refresh();
    assert.match(edge('c-r1').path.display.getAttribute('d'), /^M[\d. -]+ L[\d. -]+$/, 'maps without a choice follow the settings');
    l.settings.canvasLineStyle = 'auto';
    l.settings.canvasAppearance = false; l.manager.refresh();
    assert.equal(edge('c-r1').path.display.getAttribute('d'), 'native', 'line styles are part of the appearance');
    l.settings.canvasAppearance = true; l.manager.refresh();
    assert.match(edge('c-r1').path.display.getAttribute('d'), / Z$/);
    // A connection Canvas replaces (undo, redo) is shaped afresh; the old one is let go.
    const binding = l.manager.bindings.get(l.view);
    l.canvas.removeEdge(edge('c-l1'));
    l.canvas.importData({ nodes: [], edges: [edgeData('c-l1b', 'c', 'l1', { fromSide: 'left', toSide: 'right' })] }, false);
    l.doc.flush();
    assert.match(edge('c-l1b').path.display.getAttribute('d'), / Z$/);
    assert.equal([...binding.patchedEdges].some(item => !l.canvas.edges.has(item.getData().id)), false);
    // Canvas builds a connection's path only when it first draws it, near the view.
    const offscreen = edgeData('c-r2b', 'c', 'r3');
    l.canvas.importData({ nodes: [nodeData('r3', 400, 400, { width: 200, height: 60 })], edges: [offscreen] }, false);
    const unbuilt = edge('c-r2b');
    const built = unbuilt.path;
    delete unbuilt.path;
    unbuilt.nativeDraws = 0;
    Object.getPrototypeOf(unbuilt).updatePath = function () {
      if (!this.path) throw new TypeError("Cannot read properties of undefined (reading 'interaction')");
      this.nativeDraws = (this.nativeDraws ?? 0) + 1;
      this.path.display.setAttribute('d', 'native');
      this.path.interaction.setAttribute('d', 'native');
    };
    assert.doesNotThrow(() => l.manager.refresh(), 'connections Canvas has not drawn yet are left alone');
    assert.equal(unbuilt.nativeDraws, 0);
    assert.equal(Object.prototype.hasOwnProperty.call(unbuilt, 'updatePath'), true, 'but carry the override for their first drawing');
    unbuilt.path = built;
    unbuilt.updatePath();
    assert.match(built.display.getAttribute('d'), / Z$/, 'which draws them in the map’s style');
    l.canvas.removeNode(l.canvas.nodes.get('r3'));
    l.manager.refresh();

    /* Boundaries */
    const container = l.doc.createElement('svg');
    l.canvas.wrapperEl.append(container);
    l.canvas.edgeContainerEl = container;
    container.append(edge('c-r1').lineGroupEl);
    l.canvas.selectOnly(l.canvas.nodes.get('r1')); l.doc.flush();
    const r2Before = l.canvas.nodes.get('r2').getData().y;
    const boundarySteps = l.canvas.history.current;
    assert.equal(l.command('boundary'), true);
    assert.equal(l.canvas.nodes.get('r1').getData().nfBoundary, true);
    assert.equal(l.canvas.history.current, boundarySteps + 1, 'framing is one undo step');
    assert.notEqual(l.canvas.nodes.get('r2').getData().y, r2Before, 'neighbours make room for the boundary');
    const layer = container.firstChild;
    assert.equal(layer.classList.contains('nf-canvas-boundaries'), true, 'boundaries sit behind every connection');
    const rect = layer.children[0];
    const r1 = l.canvas.nodes.get('r1').getData();
    const r1a = l.canvas.nodes.get('r1a').getData();
    assert.equal(Number(rect.getAttribute('x')), r1.x - 14);
    assert.equal(Number(rect.getAttribute('width')), r1a.x + r1a.width - r1.x + 28, 'it frames the whole branch');
    assert.equal(rect.style.getPropertyValue('--nf-boundary'), 'var(--interactive-accent)');
    assert.equal(l.canvas.nodes.get('r1a').nodeEl.style.getPropertyValue('--nf-under'),
      'color-mix(in srgb, var(--interactive-accent) 7%, var(--canvas-background, var(--background-primary)))',
      'words inside a boundary mask the lines with its tint');
    assert.equal(l.canvas.nodes.get('r2').nodeEl.style.getPropertyValue('--nf-under'), '', 'cards outside it keep the canvas colour');
    // Cards gliding or dragged carry their boundary along, frame by frame.
    l.canvas.nodes.get('r1a').moveTo({ x: r1a.x + 50, y: r1a.y });
    binding.syncBoundaryGeometry();
    assert.equal(Number(rect.getAttribute('width')), r1a.x + 50 + r1a.width - r1.x + 28);
    l.canvas.undo(); l.manager.refresh();
    assert.equal(container.firstChild?.classList.contains('nf-canvas-boundaries') ?? false, false, 'undo takes the boundary away');
    l.canvas.redo(); l.manager.refresh();
    assert.equal(container.firstChild.classList.contains('nf-canvas-boundaries'), true);
    l.canvas.selectOnly(l.canvas.nodes.get('r2')); l.doc.flush();
    assert.equal(l.command('focus'), true);
    assert.equal(container.firstChild.children[0].getAttribute('class'), 'nf-canvas-boundary is-faded', 'outside a focused branch it fades');
    assert.equal(l.command('reset'), true);

    /* Levels */
    l.canvas.selectOnly(l.canvas.nodes.get('r1a')); l.doc.flush();
    assert.equal(l.command('level-2', true), false, 'nothing to fold below the second level');
    const levelSteps = l.canvas.history.current;
    assert.equal(l.command('level-1'), true);
    assert.equal(l.canvas.nodes.get('r1').getData().nfCollapsed, true, 'level 1 shows the main branches only');
    assert.equal(l.canvas.nodes.get('r2').getData().nfCollapsed, undefined, 'leaves have nothing to fold');
    assert.equal(l.canvas.history.current, levelSteps + 1);
    assert.equal([...l.canvas.selection][0].id, 'r1', 'a selected card folded away hands the selection up');
    assert.equal(l.canvas.nodes.get('r1a').nodeEl.classList.contains('nf-canvas-hidden'), true);
    assert.equal(l.command('level-1', true), false);
    assert.equal(l.command('level-2'), true);
    assert.equal(l.canvas.nodes.get('r1').getData().nfCollapsed, undefined, 'level 2 opens the first');
    l.manager.destroy();
    assert.equal(own('c-r1'), false, 'unloading removes every override');
    assert.equal(edge('c-r1').path.display.getAttribute('d'), 'native', 'and Canvas draws its own lines again');
    assert.equal(container.children.some(child => child.classList.contains('nf-canvas-boundaries')), false);
  }

  {
    /* Task progress */
    const { TFile } = await import(pathToFileURL(fileURLToPath(new URL('./obsidian-stub.mjs', import.meta.url))).href);
    const noteTasks = new Map([['Trip.md', [{ task: ' ' }, { task: 'x' }, { task: '-' }, {}]]]);
    const taskApp = {
      vault: { getAbstractFileByPath: path => noteTasks.has(path) ? Object.assign(new TFile(path), { path }) : null },
      metadataCache: { getFileCache: file => ({ listItems: noteTasks.get(file.path) }), on() { return {}; } },
    };
    const p = fixture(CanvasEnhancements, {
      nodes: [
        nodeData('plan', 0, 0, { nfLayout: 'right', text: 'Plan' }), nodeData('book', 400, 0, { text: '- [x] Book' }),
        nodeData('pack', 400, 200, { text: '- [ ] Shoes\n- [ ] Hat' }), nodeData('trip', 400, 400, { type: 'file', file: 'Trip.md' }),
      ],
      edges: [edgeData('p-b', 'plan', 'book'), edgeData('p-p', 'plan', 'pack'), edgeData('p-t', 'plan', 'trip')],
    }, taskApp);
    p.manager.refresh(); p.doc.flush();
    const badge = id => p.canvas.nodes.get(id).nodeEl.children.find(child => child.classList.contains('nf-canvas-progress'));
    assert.equal(badge('plan').children.at(-1).textContent, '2/5', 'a centre counts every task in its map, and in the notes it shows');
    assert.equal(badge('plan').dataset.state, 'partial');
    assert.equal(badge('plan').getAttribute('aria-label'), '2 of 5 tasks done');
    assert.equal(badge('plan').children[0].children[1].getAttribute('stroke-dasharray'), '40 100', 'the ring fills to match');
    assert.equal(badge('pack').children.at(-1).textContent, '0/2', 'a checklist card counts its own');
    assert.equal(badge('pack').dataset.state, 'open');
    assert.equal(badge('book'), undefined, 'a single task needs no count');
    p.canvas.nodes.get('pack').data.text = '- [x] Shoes\n- [x] Hat';
    noteTasks.set('Trip.md', [{ task: 'x' }]);
    p.manager.refresh();
    assert.equal(badge('plan').children.at(-1).textContent, '4/4');
    assert.equal(badge('plan').dataset.state, 'done');
    p.settings.canvasTaskProgress = false; p.manager.refresh();
    assert.equal(badge('plan'), undefined, 'the setting turns counts off');
    p.settings.canvasTaskProgress = true; p.manager.refresh();
    assert.ok(badge('plan'));
    p.manager.destroy();
    assert.equal(badge('plan'), undefined, 'unloading removes the counts');
  }

  {
    /* Presenting */
    const pushed = [];
    const popped = [];
    const { Scope } = await import(pathToFileURL(fileURLToPath(new URL('./obsidian-stub.mjs', import.meta.url))).href);
    const global = new Scope();
    global.register(['Mod'], 'p', () => 'palette');
    const stageApp = { scope: global, keymap: { pushScope: scope => pushed.push(scope), popScope: scope => popped.push(scope) } };
    const stageData = {
      nodes: [
        nodeData('c', 0, 0, { nfLayout: 'balanced', width: 200, height: 60 }),
        nodeData('r1', 400, -100, { width: 200, height: 60 }), nodeData('r1a', 800, -100, { width: 200, height: 60 }),
        nodeData('r2', 400, 100, { width: 200, height: 60 }), nodeData('far', 3000, 3000),
      ],
      edges: [edgeData('c-r1', 'c', 'r1'), edgeData('r1-r1a', 'r1', 'r1a'), edgeData('c-r2', 'c', 'r2')],
    };
    const st = fixture(CanvasEnhancements, stageData, stageApp);
    Object.assign(st.canvas, { canvasRect: { width: 1000, height: 800 }, x: 7, y: 8, zoom: -1, tx: 7, ty: 8, tZoom: -1, viewportChanges: 0,
      markViewportChanged() { this.viewportChanges++; }, deselectAll() { this.selection.clear(); } });
    st.manager.refresh(); st.doc.flush();
    st.canvas.selectOnly(st.canvas.nodes.get('r1')); st.doc.flush();
    const before = clone(st.canvas.getData());
    const historyBefore = st.canvas.history.data.length;
    assert.equal(st.command('present'), true);
    const wrapper = st.canvas.wrapperEl;
    assert.equal(wrapper.classList.contains('nf-canvas-presenting'), true);
    assert.equal(st.canvas.selection.size, 0, 'nothing stays selected on stage');
    const bar = wrapper.querySelectorAll('.nf-canvas-stage')[0];
    const count = bar.children.find(child => child.classList.contains('nf-canvas-stage-count'));
    const title = bar.children.find(child => child.classList.contains('nf-canvas-stage-title'));
    assert.equal(count.textContent, '1 / 4', 'the map, its two branches, and the map again');
    assert.equal(title.textContent, 'c');
    assert.equal(pushed.length, 1, 'the stage holds the keys while it lasts');
    const lit = id => !st.canvas.nodes.get(id).nodeEl.classList.contains('nf-canvas-offstage');
    assert.deepEqual(['c', 'r1', 'r1a', 'r2', 'far'].map(lit), [true, true, true, true, false], 'the whole map is in the light');
    const mapBox = ['c', 'r1', 'r1a', 'r2'].map(id => st.canvas.nodes.get(id).getData());
    assert.equal(st.canvas.tx, (Math.min(...mapBox.map(n => n.x)) + Math.max(...mapBox.map(n => n.x + n.width))) / 2, 'the view centres the map');
    assert.ok(st.canvas.tZoom <= Math.log2(1.5), 'and never zooms in past one and a half');
    const key = (k, extra = {}) => pushed[0].handleKey(keyEvent(k, wrapper, extra));
    assert.equal(key('ArrowRight'), false);
    assert.equal(count.textContent, '2 / 4');
    assert.equal(title.textContent, 'r1');
    assert.deepEqual(['c', 'r1', 'r1a', 'r2', 'far'].map(lit), [true, true, true, false, false], 'a branch, with the centre still lit');
    assert.equal(st.canvas.edges.get('c-r2').lineGroupEl.classList.contains('nf-canvas-offstage'), true);
    const branchBox = ['r1', 'r1a'].map(id => st.canvas.nodes.get(id).getData());
    assert.equal(st.canvas.tx, (Math.min(...branchBox.map(n => n.x)) + Math.max(...branchBox.map(n => n.x + n.width))) / 2, 'the view moves to the branch');
    assert.equal(key(' '), false);
    assert.equal(count.textContent, '3 / 4');
    assert.equal(key(' ', { shiftKey: true }), false, 'Shift+Space goes back');
    assert.equal(count.textContent, '2 / 4');
    assert.equal(key('End'), false);
    assert.equal(count.textContent, '4 / 4');
    assert.equal(key('ArrowRight'), false, 'past the end stays at the end');
    assert.equal(count.textContent, '4 / 4');
    assert.equal(key('Home'), false);
    assert.equal(key('p', { metaKey: true }), 'palette', 'app hotkeys still work');
    assert.equal(key('Delete'), undefined, 'Canvas’s own keys are not reachable from the stage');
    // A click on a card shows its stop; nothing is selected, dragged, or edited.
    const click = wrapper.dispatch('click', { target: st.canvas.nodes.get('r2').nodeEl, button: 0 });
    assert.equal(click.defaultPrevented, true);
    assert.equal(count.textContent, '3 / 4');
    wrapper.dispatch('click', { target: st.canvas.nodes.get('c').nodeEl, button: 0 });
    assert.equal(count.textContent, '1 / 4', 'the centre card shows the opening overview, not the closing one');
    wrapper.dispatch('click', { target: st.canvas.nodes.get('r2').nodeEl, button: 0 });
    assert.equal(count.textContent, '3 / 4');
    assert.equal(bar.style.getPropertyValue('--nf-stage-progress'), '0.75', 'the bar knows how far along the talk is');
    // A click on empty canvas walks on, back with Shift; the second click of
    // a double click is not a step, and the bar's own clicks stay its own.
    assert.equal(wrapper.dispatch('click', { target: wrapper, button: 0 }).defaultPrevented, true);
    assert.equal(count.textContent, '4 / 4', 'a click on empty canvas advances');
    assert.equal(bar.style.getPropertyValue('--nf-stage-progress'), '1');
    wrapper.dispatch('click', { target: wrapper, button: 0, shiftKey: true });
    assert.equal(count.textContent, '3 / 4', 'Shift+click goes back');
    wrapper.dispatch('click', { target: wrapper, button: 0, detail: 2 });
    assert.equal(count.textContent, '3 / 4', 'the second click of a double click is not a step');
    wrapper.dispatch('click', { target: bar, button: 0 });
    assert.equal(count.textContent, '3 / 4', 'the bar’s own clicks are not steps');
    const press = wrapper.dispatch('pointerdown', { target: st.canvas.nodes.get('r1').nodeEl, button: 0, pointerId: 1 });
    assert.equal(press.defaultPrevented, true);
    assert.equal(wrapper.dispatch('pointerdown', { target: wrapper, button: 1, pointerId: 1 }).defaultPrevented, false, 'the middle button still pans');
    assert.equal(wrapper.dispatch('dblclick', { target: wrapper }).defaultPrevented, true, 'no new cards from a double click');
    assert.equal(key('Escape'), false);
    assert.equal(wrapper.classList.contains('nf-canvas-presenting'), false);
    assert.deepEqual(popped, pushed, 'leaving gives the keys back');
    assert.equal(wrapper.querySelectorAll('.nf-canvas-stage').length, 0);
    assert.deepEqual([st.canvas.tx, st.canvas.ty, st.canvas.tZoom], [7, 8, -1], 'and returns the view to where it was');
    assert.equal(lit('far'), true);
    assert.deepEqual(st.canvas.getData(), before, 'presenting changes nothing');
    assert.equal(st.canvas.history.data.length, historyBefore);
    // With no map card selected, the whole canvas is presented; read-only canvases too.
    st.canvas.readonly = true;
    st.canvas.selection.clear(); st.doc.flush();
    assert.equal(st.command('present'), true);
    assert.equal(wrapper.querySelectorAll('.nf-canvas-stage-count')[0].textContent, '1 / 6', 'everything, the map and its two branches, the loose card, everything again');
    assert.equal(wrapper.querySelectorAll('.nf-canvas-stage-title')[0].textContent, 'Overview', 'every stop has a caption, so the bar keeps its size');
    // Moving to another pane ends the presentation.
    st.workspace.activeLeaf = { view: {} };
    st.workspace.emit('active-leaf-change');
    assert.equal(wrapper.classList.contains('nf-canvas-presenting'), false);
    assert.equal(popped.length, 2);
    st.workspace.activeLeaf = { view: st.view };
    st.canvas.readonly = false;
    assert.equal(st.command('present'), true);
    st.manager.destroy();
    assert.equal(wrapper.classList.contains('nf-canvas-presenting'), false, 'unloading ends a presentation');
    assert.equal(popped.length, 3);

    // A group's stop shows the label Canvas draws above the group's box.
    const board = fixture(CanvasEnhancements, { nodes: [
      { id: 'g', type: 'group', label: 'Notes', x: 0, y: 0, width: 400, height: 200 }, nodeData('inside', 40, 40, { width: 200, height: 60 }),
      nodeData('loose', 1000, 0),
    ], edges: [] });
    Object.assign(board.canvas, { canvasRect: { width: 1000, height: 800 }, x: 0, y: 0, zoom: 0, tx: 0, ty: 0, tZoom: 0,
      markViewportChanged() {}, deselectAll() { this.selection.clear(); } });
    assert.equal(board.command('present'), true);
    const boardKeys = board.doc.defaultView;
    boardKeys.dispatch('keydown', keyEvent('ArrowRight', board.canvas.wrapperEl));
    assert.equal(board.canvas.wrapperEl.querySelectorAll('.nf-canvas-stage-title')[0].textContent, 'Notes');
    assert.equal(board.canvas.ty - 36 / 2 ** board.canvas.tZoom, (-40 + 200) / 2, 'the frame reaches up to the group’s label');
    board.manager.destroy();

    // Without a keymap to push onto, the stage listens on the window instead.
    const bare = fixture(CanvasEnhancements, stageData);
    bare.canvas.selectOnly(bare.canvas.nodes.get('c')); bare.doc.flush();
    assert.equal(bare.command('present'), true);
    const win = bare.doc.defaultView;
    assert.equal(win.listeners('keydown'), 1);
    assert.equal(win.dispatch('keydown', keyEvent('ArrowDown', bare.canvas.wrapperEl)).defaultPrevented, true);
    assert.equal(bare.canvas.wrapperEl.querySelectorAll('.nf-canvas-stage-count')[0].textContent, '2 / 4');
    assert.equal(bare.command('present'), true, 'the command stops a presentation too');
    assert.equal(win.listeners('keydown'), 0);
    // Present from here opens at the stop about the selected card.
    bare.canvas.selectOnly(bare.canvas.nodes.get('r1a')); bare.doc.flush();
    assert.equal(bare.command('presentFrom'), true);
    assert.equal(bare.canvas.wrapperEl.querySelectorAll('.nf-canvas-stage-count')[0].textContent, '2 / 4', 'the stop about the card, not the overview');
    assert.equal(bare.canvas.wrapperEl.querySelectorAll('.nf-canvas-stage-title')[0].textContent, 'r1');
    assert.equal(bare.canvas.wrapperEl.querySelectorAll('.nf-canvas-stage')[0].style.getPropertyValue('--nf-stage-progress'), '0.5');
    assert.equal(bare.command('presentFrom', true), false, 'and is not offered while presenting');
    assert.equal(bare.command('present'), true);
    bare.canvas.selectOnly(bare.canvas.nodes.get('c')); bare.doc.flush();
    assert.equal(bare.command('presentFrom'), true);
    assert.equal(bare.canvas.wrapperEl.querySelectorAll('.nf-canvas-stage-count')[0].textContent, '1 / 4', 'the centre opens the overview');
    assert.equal(bare.command('present'), true);
    // The card menu offers it.
    const titles = [];
    const menu = { addItem(cb) { const item = { setTitle(title) { titles.push(title); return item; }, setIcon() { return item; }, onClick() { return item; } }; cb(item); return menu; } };
    bare.manager.bindings.get(bare.view).fillNodeMenu(menu);
    assert.ok(titles.includes('Present from here'));
    bare.manager.destroy();
  }

  {
    // The style panel: one map with nothing selected is still styled; hover
    // previews are drawn but never saved; a click is one undo step.
    const styled = fixture(CanvasEnhancements, {
      nodes: [nodeData('r', 0, 0, { nfLayout: 'right', nfPalette: 'ocean' }), nodeData('a', 332, 0), nodeData('b', 332, 200, { text: '## Heading\n\nA note' }),
        nodeData('loose', 0, 900)],
      edges: [edgeData('r-a', 'r', 'a'), edgeData('r-b', 'r', 'b')],
    });
    styled.settings.canvasAnimation = false;
    styled.doc.flush();
    const nodeEl = id => styled.canvas.nodes.get(id).nodeEl;
    assert.equal(nodeEl('r').classList.contains('nf-canvas-text'), true, 'every text card gets the card typography');
    assert.equal(nodeEl('loose').classList.contains('nf-canvas-text'), true);
    assert.equal(nodeEl('loose').classList.contains('nf-canvas-map-text'), false);
    assert.equal(nodeEl('a').classList.contains('nf-canvas-map-rich'), false, 'a one-line topic is a topic');
    assert.equal(nodeEl('b').classList.contains('nf-canvas-map-rich'), true, 'a card with a heading reads as a note');
    assert.equal(nodeEl('a').dataset.nfHang, 'right', 'cards know the side their line arrives from');
    assert.equal(nodeEl('r').dataset.nfHang, undefined, 'the centre hangs from nothing');

    const before = clone(styled.canvas.getData());
    const history = styled.canvas.history.data.length;
    assert.equal(styled.command('presets'), true, 'the panel opens from the command');
    styled.doc.flush();
    const panel = styled.canvas.wrapperEl.querySelector('.nf-canvas-style-panel');
    assert.ok(panel, 'the panel floats in the canvas');
    assert.equal(panel.classList.contains('is-empty'), false, 'with one map and nothing selected, the panel styles that map');
    assert.equal(styled.button('Style').getAttribute('aria-pressed'), 'true');
    const tile = id => panel.querySelectorAll('.nf-canvas-style-tile').find(item => item.dataset.preset === id);
    assert.equal(panel.querySelectorAll('.nf-canvas-style-tile').length, 23, 'one tile per scheme, and no pinned tile without a note-palette pairing');
    assert.equal(tile('ocean').getAttribute('aria-pressed'), 'true', 'the current scheme is marked');

    tile('aurora').dispatch('pointerenter');
    styled.doc.flush();
    assert.equal(nodeEl('a').classList.contains('nf-theme-gradient'), true, 'hovering a scheme previews its look');
    assert.match(nodeEl('a').style.getPropertyValue('--nf-auto'), /^#|^light-dark/, 'and its colours');
    assert.deepEqual(styled.canvas.getData(), before, 'a preview writes nothing');
    assert.equal(styled.canvas.history.data.length, history, 'a preview adds no undo step');
    panel.querySelectorAll('.nf-canvas-style-tiles')[0].dispatch('pointerleave');
    styled.doc.flush();
    assert.equal(nodeEl('a').classList.contains('nf-theme-clean'), true, 'leaving the schemes restores the saved look');

    const fontOption = value => panel.querySelectorAll('.nf-canvas-style-option').find(item => item.dataset.kind === 'font' && item.dataset.value === value);
    fontOption('serif').dispatch('pointerenter');
    styled.doc.flush();
    assert.equal(nodeEl('b').classList.contains('nf-font-serif'), true, 'typefaces preview too');
    assert.equal(nodeEl('loose').classList.contains('nf-font-serif'), false, 'only the map changes');
    fontOption('serif').dispatch('click');
    styled.doc.flush();
    assert.equal(styled.canvas.nodes.get('r').getData().nfFont, 'serif');
    assert.equal(fontOption('serif').getAttribute('aria-pressed'), 'true');
    assert.equal(styled.canvas.history.data.length, history + 1, 'choosing a typeface is one undo step');
    fontOption('default').dispatch('click');
    styled.doc.flush();
    assert.equal('nfFont' in styled.canvas.nodes.get('r').getData(), false, 'the note font is the default and is not stored');
    assert.equal(nodeEl('b').classList.contains('nf-font-serif'), false);

    tile('journal').dispatch('click');
    styled.doc.flush();
    const root = styled.canvas.nodes.get('r').getData();
    assert.deepEqual([root.nfPalette, root.nfTheme, root.nfLine, root.nfFont], ['journal', 'pastel', 'organic', 'kai'], 'a scheme brings its face');
    assert.equal(tile('journal').getAttribute('aria-pressed'), 'true');
    tile('ocean').dispatch('click');
    styled.doc.flush();
    assert.equal('nfFont' in styled.canvas.nodes.get('r').getData(), false, 'a scheme without a face returns to the note font');
    styled.canvas.undo(); styled.doc.flush();
    assert.equal(styled.canvas.nodes.get('r').getData().nfFont, 'kai', 'undo restores the previous face');

    const themeOption = value => panel.querySelectorAll('.nf-canvas-style-option').find(item => item.dataset.kind === 'theme' && item.dataset.value === value);
    themeOption('pastel').dispatch('click');
    styled.doc.flush();
    assert.equal(styled.canvas.nodes.get('r').getData().nfTheme, 'pastel');
    assert.equal(nodeEl('a').classList.contains('nf-theme-pastel'), true);

    // A second map: without a selection the panel keeps the one it showed.
    styled.canvas.importData({ nodes: [nodeData('r2', 0, 1400, { nfLayout: 'right' }), nodeData('c2', 332, 1400)], edges: [edgeData('r2-c2', 'r2', 'c2')] }, false);
    styled.canvas.requestSave(); styled.canvas.requestPushHistory.run();
    styled.doc.flush();
    assert.equal(panel.classList.contains('is-empty'), false, 'the panel keeps its map when another appears');
    styled.canvas.selectOnly(styled.canvas.nodes.get('c2')); styled.manager.refresh(); styled.doc.flush();
    themeOption('vivid').dispatch('click');
    styled.doc.flush();
    assert.equal(styled.canvas.nodes.get('r2').getData().nfTheme, 'vivid', 'a selected card points the panel at its own map');
    assert.equal(styled.canvas.nodes.get('r').getData().nfTheme, 'pastel');

    // Keys inside the panel never reach the cards.
    const arrow = styled.scope.dispatch(keyEvent('ArrowRight', themeOption('vivid')));
    assert.equal(arrow, undefined);
    assert.equal(styled.canvas.selection.has(styled.canvas.nodes.get('c2')), true);

    panel.dispatch('keydown', { key: 'Escape' });
    styled.doc.flush();
    assert.equal(styled.canvas.wrapperEl.querySelector('.nf-canvas-style-panel'), null, 'Escape closes the panel');
    assert.equal(styled.button('Style').getAttribute('aria-pressed'), 'false');

    styled.button('Style').dispatch('click');
    styled.doc.flush();
    assert.ok(styled.canvas.wrapperEl.querySelector('.nf-canvas-style-panel'), 'the toolbar button opens it');
    styled.canvas.readonly = true; styled.manager.refresh(); styled.doc.flush();
    assert.equal(styled.canvas.wrapperEl.querySelector('.nf-canvas-style-panel'), null, 'a read-only canvas closes the panel');
    styled.canvas.readonly = false;
    styled.button('Style').dispatch('click');
    styled.doc.flush();
    styled.manager.destroy();
    assert.equal(styled.canvas.wrapperEl.querySelector('.nf-canvas-style-panel'), null, 'teardown removes the panel');
    assert.equal(nodeEl('a').classList.contains('nf-canvas-text'), false, 'teardown removes the typography classes');
    assert.equal(nodeEl('a').dataset.nfHang, undefined);
  }

  {
    // "Save as my scheme": the colours the map shows, hand-set ones over the
    // palette, and its look go to the settings; the canvas is not touched.
    const settingsStore = {};
    const mine = fixture(CanvasEnhancements, {
      nodes: [nodeData('r', 0, 0, { nfLayout: 'right', nfPalette: 'sakura', nfTheme: 'pastel', nfLine: 'organic', nfSpacing: 'roomy' }),
        nodeData('a', 332, -200), nodeData('b', 332, 0, { color: '#112233' }), nodeData('c', 332, 200)],
      edges: [edgeData('r-a', 'r', 'a'), edgeData('r-b', 'r', 'b'), edgeData('r-c', 'r', 'c')],
    }, {}, { save: (patch) => { Object.assign(settingsStore, patch); Object.assign(mine.settings, patch); } });
    mine.settings.canvasAnimation = false;
    mine.doc.flush();
    const before = clone(mine.canvas.getData());
    const steps = mine.canvas.history.data.length;
    const saves = mine.canvas.saves;
    mine.command('presets'); mine.doc.flush();
    const panel = mine.canvas.wrapperEl.querySelector('.nf-canvas-style-panel');
    const block = panel.querySelector('.nf-canvas-style-mine');
    assert.equal(block.hidden, false, 'the panel offers my schemes');
    const save = block.querySelectorAll('.nf-canvas-style-action').find((button) => button.textContent === 'Save as my scheme');
    assert.equal(save.disabled, false, 'a map with a palette has colours to save');
    save.dispatch('click');
    const input = block.querySelector('.nf-canvas-style-scheme-name');
    assert.equal(input.value, 'Map scheme 1');
    input.dispatch('keydown', { key: 'Enter' }); mine.doc.flush();
    const saved = mine.settings.canvasUserSchemes;
    assert.equal(saved.length, 1, 'one scheme saved');
    assert.deepEqual(settingsStore.canvasUserSchemes, saved, 'through the save callback');
    const sakura = { rootColor: '#AD5D7C', branchColors: ['#C5788D', '#9876AE', '#619CB3', '#67A490', '#C99A70', '#817FB5'],
      dark: { rootColor: '#FF9AC0', branchColors: ['#F692AE', '#C699E3', '#71C1E0', '#77C9AF', '#ECB079', '#A8A5EC'] } };
    const lower = (list) => list.map((color) => color.toLowerCase());
    assert.equal(saved[0].name, 'Map scheme 1');
    assert.equal(saved[0].branchColors[1], '#112233', 'a colour set by hand wins');
    assert.equal(saved[0].dark.branchColors[1], '#112233', 'in dark mode too');
    assert.equal(saved[0].rootColor, sakura.rootColor.toLowerCase());
    assert.deepEqual(saved[0].branchColors.filter((_, i) => i !== 1), lower(sakura.branchColors).filter((_, i) => i !== 1), 'the rest are sakura’s');
    assert.deepEqual(saved[0].dark.branchColors.filter((_, i) => i !== 1), lower(sakura.dark.branchColors).filter((_, i) => i !== 1));
    assert.equal(saved[0].dark.rootColor, sakura.dark.rootColor.toLowerCase());
    assert.deepEqual([saved[0].theme, saved[0].line, saved[0].spacing, saved[0].shape], ['pastel', 'organic', 'roomy', undefined], 'and the map’s look');
    assert.deepEqual(mine.canvas.getData(), before, 'saving writes nothing to the canvas');
    assert.equal(mine.canvas.history.data.length, steps, 'and records no undo step');
    assert.equal(mine.canvas.saves, saves, 'nor asks Canvas to save');
    const tile = block.querySelectorAll('.nf-canvas-style-tile').find((item) => item.dataset.scheme === saved[0].id);
    assert.ok(tile, 'the scheme shows as a tile');
    assert.equal(tile.getAttribute('aria-pressed'), 'false', 'a preset map does not carry it');
    tile.dispatch('click'); mine.doc.flush();
    const root = mine.canvas.nodes.get('r').getData();
    assert.equal(root.nfPalette, 'custom', 'applying it copies its colours onto the root');
    assert.deepEqual(root.nfPaletteColors, { rootColor: saved[0].rootColor, branchColors: saved[0].branchColors, dark: saved[0].dark });
    assert.equal(mine.canvas.history.data.length, steps + 1, 'as one undo step');
    assert.equal(tile.getAttribute('aria-pressed'), 'true', 'and marks it');
    const auto = (id) => mine.canvas.nodes.get(id).nodeEl.style.getPropertyValue('--nf-auto');
    assert.match(auto('a'), /c5788d/i, 'the map draws its own colours');
    block.querySelector('.nf-canvas-style-tile-delete').dispatch('click'); mine.doc.flush();
    assert.deepEqual(mine.settings.canvasUserSchemes, [], 'deleting empties the list');
    assert.equal(block.querySelectorAll('.nf-canvas-style-tile-wrap').length, 0);
    assert.equal(mine.canvas.nodes.get('r').getData().nfPalette, 'custom', 'the map keeps the colours');
    assert.match(auto('a'), /c5788d/i);
    mine.manager.destroy();

    // A map without a palette or colours has nothing to save.
    const bare = fixture(CanvasEnhancements, { nodes: [nodeData('r', 0, 0, { nfLayout: 'right' }), nodeData('a', 332, 0)], edges: [edgeData('r-a', 'r', 'a')] });
    bare.command('presets'); bare.doc.flush();
    const bareSave = bare.canvas.wrapperEl.querySelector('.nf-canvas-style-mine').querySelectorAll('.nf-canvas-style-action')[0];
    assert.equal(bareSave.disabled, true, 'no colours, nothing to save');
    bare.settings.canvasMapStyle = 'vivid';
    bare.manager.refresh(); bare.doc.flush();
    assert.equal(bareSave.disabled, false, 'the vivid look draws colours');
    bareSave.dispatch('click');
    bare.canvas.wrapperEl.querySelector('.nf-canvas-style-scheme-name').dispatch('keydown', { key: 'Enter' }); bare.doc.flush();
    assert.deepEqual(bare.settings.canvasUserSchemes[0].branchColors, ['1', '2', '3', '4', '5', '6'], 'vivid branches are Canvas’s colours');
    assert.equal(bare.settings.canvasUserSchemes[0].rootColor, '#3d8bd9', 'with the accent at the centre, where it cannot be read');
    bare.settings.canvasMapStyle = undefined;
    bare.settings.canvasUserSchemes = Array.from({ length: 36 }, (_, i) => ({ ...bare.settings.canvasUserSchemes[0], id: `x${i}` }));
    bare.canvas.nodes.get('a').data.color = '4';
    bare.manager.refresh(); bare.doc.flush();
    assert.equal(bareSave.disabled, true, 'thirty-six is the limit');
    bare.manager.destroy();
  }

  {
    // Words that no longer fit their card are refitted once after the file opens.
    const cramped = fixture(CanvasEnhancements, {
      nodes: [nodeData('r', 0, 0, { nfLayout: 'right' }), nodeData('long', 332, 0, { width: 120, height: 52,
        text: 'A long topic whose words wrap across several lines in a narrow card' })],
      edges: [edgeData('r-long', 'r', 'long')],
    });
    cramped.settings.canvasAnimation = false;
    const preview = cramped.canvas.nodes.get('long').nodeEl.querySelector('.markdown-preview-view');
    Object.defineProperty(preview, 'clientHeight', { get: () => 40 });
    const steps = cramped.canvas.history.data.length;
    cramped.doc.flush();
    const fitted = cramped.canvas.nodes.get('long').getData();
    assert.ok(fitted.height > 52 || fitted.width > 120, 'the cramped card grows to its words');
    assert.equal(cramped.canvas.history.data.length, steps + 1, 'the repair is one undo step');
    cramped.canvas.nodes.get('long').resize({ width: 120, height: 52 });
    cramped.manager.refresh(); cramped.doc.flush();
    assert.equal(cramped.canvas.nodes.get('long').getData().height, 52, 'only once per file: a card the user shrinks again stays shrunk');
    cramped.manager.destroy();

    const locked = fixture(CanvasEnhancements, {
      nodes: [nodeData('r', 0, 0, { nfLayout: 'right' }), nodeData('long', 332, 0, { width: 120, height: 52, text: 'A long topic whose words wrap across several lines' })],
      edges: [edgeData('r-long', 'r', 'long')],
    });
    locked.settings.canvasAutoFit = false;
    Object.defineProperty(locked.canvas.nodes.get('long').nodeEl.querySelector('.markdown-preview-view'), 'clientHeight', { get: () => 40 });
    locked.doc.flush();
    assert.equal(locked.canvas.nodes.get('long').getData().height, 52, 'without automatic fitting nothing is resized');
    locked.manager.destroy();

    // Empty topics stored as hairlines grow back to a clickable placeholder
    // on open, amending the current step rather than adding one.
    const hairlineData = {
      nodes: [nodeData('r', 0, 0, { nfLayout: 'right', width: 160, height: 64 }), nodeData('h', 232, 29, { width: 80, height: 6, text: '' }),
        nodeData('t', 232, 200, { width: 80, height: 6, text: '\t' })],
      edges: [edgeData('r-h', 'r', 'h'), edgeData('r-t', 'r', 't')],
    };
    const hair = fixture(CanvasEnhancements, hairlineData);
    hair.settings.canvasAnimation = false;
    const hairSteps = hair.canvas.history.data.length;
    hair.doc.flush();
    for (const id of ['h', 't']) {
      const { width, height } = hair.canvas.nodes.get(id).getData();
      assert.deepEqual({ width, height }, { width: 112, height: 52 }, `${id}: a hairline heals to the empty-topic size`);
    }
    assert.equal(hair.canvas.history.data.length, hairSteps, 'the repair adds no undo step');
    assert.equal(hair.canvas.history.data[hair.canvas.history.current].nodes.find((node) => node.id === 'h').height, 52, 'it amends the current one');
    const healed = hair.canvas.getData();
    hair.manager.destroy();
    const again = fixture(CanvasEnhancements, healed);
    again.settings.canvasAnimation = false;
    const againSteps = again.canvas.history.data.length;
    again.doc.flush();
    assert.deepEqual(again.canvas.getData().nodes, healed.nodes, 'opening again changes nothing');
    assert.equal(again.canvas.history.data.length, againSteps);
    again.manager.destroy();
    const preserved = fixture(CanvasEnhancements, hairlineData);
    preserved.settings.canvasCardSize = 'preserve';
    preserved.doc.flush();
    assert.deepEqual([preserved.canvas.nodes.get('h').getData().width, preserved.canvas.nodes.get('h').getData().height], [80, 52],
      'preserve mode heals the height and keeps the width');
    preserved.manager.destroy();
    const unfitted = fixture(CanvasEnhancements, hairlineData);
    unfitted.settings.canvasAutoFit = false;
    unfitted.doc.flush();
    assert.equal(unfitted.canvas.nodes.get('h').getData().height, 6, 'without automatic fitting nothing is healed');
    unfitted.manager.destroy();
  }

  {
    // Topics drawn without a box hug their words; a look with boxes widens them again.
    const box = fixture(CanvasEnhancements, {
      nodes: [nodeData('r', 0, 0, { nfLayout: 'right', width: 160, height: 64 }), nodeData('a', 232, 0, { width: 112, height: 52, text: 'Branch' }),
        nodeData('a1', 400, 0, { width: 112, height: 52, text: 'Hi' })],
      edges: [edgeData('r-a', 'r', 'a'), edgeData('a-a1', 'a', 'a1')],
    });
    box.settings.canvasAnimation = false;
    const steps = box.canvas.history.data.length;
    box.doc.flush();
    const binding = box.manager.bindings.get(box.view);
    const widthOf = (id) => box.canvas.nodes.get(id).getData().width;
    assert.ok(widthOf('a1') < 112, `a Clean sub-topic is plain words: its card hugs them (${widthOf('a1')})`);
    assert.ok(widthOf('a1') >= 40);
    assert.equal(widthOf('a'), 112, 'a Clean main branch keeps its box');
    assert.equal(box.canvas.history.data.length, steps + 1, 'refitting widths fitted to a box is one undo step');
    binding.fitNode('a1', true);
    const hugged = widthOf('a1');
    assert.equal(binding.fitNode('a1', true), false, 'hugging is stable');
    const root = box.canvas.nodes.get('r');
    root.data.nfTheme = 'cards';
    binding.fitStyledMap('r');
    assert.ok(widthOf('a1') >= 112, 'cards draw a box: the topic takes the box width again');
    root.data.nfTheme = 'minimal';
    binding.fitStyledMap('r');
    assert.equal(widthOf('a1'), hugged, 'minimal draws none below the centre');
    assert.ok(widthOf('a') < 112, 'not even for main branches');
    root.data.nfTheme = 'cards'; root.data.nfShape = 'underline';
    binding.fitStyledMap('r');
    assert.equal(widthOf('a1'), hugged, 'an underline is no box either');
    delete root.data.nfShape; delete root.data.nfTheme;
    box.settings.canvasAppearance = false;
    binding.fitStyledMap('r');
    assert.ok(widthOf('a1') >= 112, 'without map looks nothing is boxless');
    box.settings.canvasAppearance = true;
    box.canvas.nodes.get('a1').data.text = '';
    binding.fitNode('a1', true);
    assert.equal(widthOf('a1'), 112, 'an empty topic keeps a readable placeholder');
    box.manager.destroy();
  }

  {
    // A connection's label, added by Canvas after its line, gets its look on the first open.
    const rel = fixture(CanvasEnhancements, {
      nodes: [nodeData('r', 0, 0, { nfLayout: 'right' }), nodeData('a', 400, 0), nodeData('b', 400, 300)],
      edges: [edgeData('r-a', 'r', 'a'), edgeData('r-b', 'r', 'b'), edgeData('a-b', 'a', 'b', { label: 'depends on' })],
    });
    rel.doc.flush();
    const edge = rel.canvas.edges.get('a-b');
    const binding = rel.manager.bindings.get(rel.view);
    const wrapperEl = rel.doc.createElement('div');
    wrapperEl.className = 'canvas-path-label-wrapper';
    edge.labelElement = { wrapperEl };
    let renders = 0;
    const render = binding.render.bind(binding);
    binding.render = (...args) => { renders++; return render(...args); };
    rel.canvas.wrapperEl.append(wrapperEl);
    rel.doc.flush();
    assert.ok(wrapperEl.classList.contains('nf-canvas-relation'), 'the late label is a pill');
    assert.equal(renders, 1, 'drawn once more for it');
    wrapperEl.remove(); rel.canvas.wrapperEl.append(wrapperEl);
    rel.doc.flush();
    assert.equal(renders, 1, 'Canvas taking the label off screen and back is not a change');
    rel.manager.destroy();
  }

  for (const timing of ['before-exit', 'after-exit', 'unrelated-step']) {
    // Native history is debounced independently from our preview measurement:
    // a pause while typing, or just after Escape, can commit the text first.
    const recorded = fixture(CanvasEnhancements, {
      nodes: [nodeData('r', 0, 0, { nfLayout: 'right', width: 160, height: 64 }),
        nodeData('n', 232, -19, { width: 377, height: 103, text: 'A long paragraph before editing.' })],
      edges: [edgeData('r-n', 'r', 'n')],
    });
    recorded.settings.canvasAnimation = false;
    recorded.doc.flush();
    const original = clone(recorded.canvas.getData());
    const node = recorded.canvas.nodes.get('n');
    recorded.canvas.selectOnly(node); node.startEditing(); recorded.manager.refresh(); recorded.doc.flush();
    node.data.text = 'Short';
    recorded.canvas.requestSave();
    if (timing !== 'after-exit') recorded.canvas.requestPushHistory.run();
    if (timing === 'unrelated-step') {
      recorded.canvas.nodes.get('r').data.color = '4';
      recorded.canvas.requestSave(); recorded.canvas.requestPushHistory.run();
    }
    const textStep = recorded.canvas.history.current;
    const priorHistory = clone(recorded.canvas.history.data);
    node.isEditing = false; node.nodeEl.classList.remove('is-editing'); node.render();
    recorded.manager.refresh();
    if (timing === 'after-exit') recorded.canvas.requestPushHistory.run();
    recorded.doc.flush();
    assert.equal(node.data.width, 112, 'a short replacement title shrinks to its content');
    if (timing === 'unrelated-step') {
      assert.equal(recorded.canvas.history.current, textStep + 1, 'fitting does not overwrite a later unrelated history step');
      assert.deepEqual(recorded.canvas.history.data.slice(0, priorHistory.length), priorHistory);
      recorded.canvas.undo(); recorded.manager.refresh(); recorded.doc.flush();
      assert.equal(recorded.canvas.nodes.get('r').data.color, '4', 'undoing the fit preserves the separate colour edit');
    } else {
      assert.equal(recorded.canvas.history.current, 1, 'committed native text and automatic sizing share one undo step');
      recorded.canvas.undo(); recorded.manager.refresh(); recorded.doc.flush();
      assert.deepEqual(recorded.canvas.getData(), original, 'one undo restores the old text and geometry after native history has committed');
    }
    recorded.manager.destroy();
  }

  for (const outcome of ['ready', 'undo', 'resize', 'unrendered']) {
    // Markdown may replace the editor after the first settling timer fires.
    // Keep that exact fitting request alive without repeatedly saving the map.
    const delayed = fixture(CanvasEnhancements, {
      nodes: [nodeData('r', 0, 0, { nfLayout: 'right', width: 160, height: 64 }),
        nodeData('n', 232, 16, { width: 80, height: 32, text: 'Small' })],
      edges: [edgeData('r-n', 'r', 'n')],
    });
    delayed.settings.canvasAnimation = false;
    delayed.doc.flush();
    const original = clone(delayed.canvas.getData());
    const initialSteps = delayed.canvas.history.current;
    const node = delayed.canvas.nodes.get('n');
    delayed.canvas.selectOnly(node); node.startEditing(); delayed.manager.refresh(); delayed.doc.flush();
    node.data.text = 'A longer card whose Markdown preview will only arrive after the first fitting attempt.';
    node.isEditing = false; node.nodeEl.classList.remove('is-editing');
    const sizer = node.nodeEl.querySelector('.markdown-preview-sizer');
    const preview = sizer.parentElement;
    sizer.remove();
    delayed.canvas.requestSave(); delayed.manager.refresh();
    const binding = delayed.manager.bindings.get(delayed.view);
    const waitingTimer = binding.settleTimer;
    binding.settleSoon();
    assert.equal(binding.settleTimer, waitingTimer, 'a layout refresh preserves the existing preview wait');
    const version = binding.pending.fitVersion.get('n');
    const beforeFit = clone(delayed.canvas.getData());
    const beforeRetrySaves = delayed.canvas.saves;
    delayed.doc.defaultView.clearTimeout(binding.settleTimer); binding.settleTimer = 0;
    binding.settle();
    assert.equal(binding.pending.fit.has('n'), true, 'a temporarily unrendered preview is retried');
    assert.equal(binding.pending.fitVersion.get('n'), version, 'retry preserves the original text and size version');
    assert.deepEqual(delayed.canvas.getData(), beforeFit, 'waiting for Markdown does not resize or rearrange cards');
    assert.equal(delayed.canvas.saves, beforeRetrySaves, 'waiting for Markdown performs no save');

    if (outcome === 'ready') preview.append(sizer);
    if (outcome === 'undo') delayed.canvas.undo();
    if (outcome === 'resize') {
      node.resize({ width: 350, height: 180 }); node.render();
      preview.append(sizer);
      delayed.canvas.requestSave(); delayed.canvas.requestPushHistory.run();
    }
    const overtaken = clone(delayed.canvas.getData());
    const history = clone(delayed.canvas.history);
    const saves = delayed.canvas.saves;
    delayed.manager.refresh(); delayed.doc.flush();
    assert.equal(binding.pending.fit.size, 0, 'fitting finishes or gives up after a bounded number of attempts');
    if (outcome === 'ready') {
      assert.ok(node.data.width > 80, 'the arriving preview is fitted without another edit');
      assert.equal(delayed.canvas.history.current, initialSteps + 1, 'delayed fitting joins the original text edit');
      delayed.canvas.undo(); delayed.manager.refresh(); delayed.doc.flush();
      assert.deepEqual(delayed.canvas.getData(), original, 'one undo restores text, size, and layout after delayed rendering');
    } else {
      assert.deepEqual(delayed.canvas.getData(), overtaken, `${outcome} is not overwritten by a delayed fit`);
      assert.deepEqual(delayed.canvas.history, history, `${outcome} retains its undo and redo history`);
      assert.equal(delayed.canvas.saves, saves, `${outcome} triggers no delayed save`);
    }
    delayed.manager.destroy();
  }

  for (const action of ['reparent', 'delete-parent', 'delete-root', 'autofit-off', 'appearance-off']) {
    // A structural action must measure the whole affected branch with its new
    // type scale, and commit geometry with the action rather than on refresh.
    const hierarchy = fixture(CanvasEnhancements, {
      nodes: [nodeData('r', 0, 0, { nfLayout: 'right' }), nodeData('a', 332, -100),
        nodeData('a1', 664, -100), nodeData('a2', 996, -100), nodeData('b', 332, 100)],
      edges: [edgeData('r-a', 'r', 'a'), edgeData('a-a1', 'a', 'a1'),
        edgeData('a1-a2', 'a1', 'a2'), edgeData('r-b', 'r', 'b')],
    });
    hierarchy.settings.canvasAnimation = false;
    if (action === 'autofit-off') hierarchy.settings.canvasAutoFit = false;
    if (action === 'appearance-off') hierarchy.settings.canvasAppearance = false;
    hierarchy.canvas.selectOnly(hierarchy.canvas.nodes.get('r'));
    hierarchy.command('right'); hierarchy.doc.flush();
    const state = () => {
      const data = hierarchy.canvas.getData();
      data.nodes.sort((a, b) => a.id.localeCompare(b.id));
      data.edges.sort((a, b) => a.id.localeCompare(b.id));
      return data;
    };
    const original = state();
    const step = hierarchy.canvas.history.current;
    const measured = new Map();
    for (const [id, node] of hierarchy.canvas.nodes) {
      const cloneNode = node.nodeEl.cloneNode;
      node.nodeEl.cloneNode = function (deep) {
        measured.set(id, {
          scale: this.style.getPropertyValue('--nf-size'),
          weight: this.style.getPropertyValue('--nf-weight'),
          map: this.classList.contains('nf-canvas-map-node'),
          root: this.classList.contains('nf-canvas-map-root'),
        });
        return cloneNode.call(this, deep);
      };
    }
    if (action.startsWith('delete-')) {
      const id = action === 'delete-root' ? 'r' : 'a';
      hierarchy.canvas.selectOnly(hierarchy.canvas.nodes.get(id));
      hierarchy.canvas.wrapperEl.focus(); hierarchy.doc.flush();
      hierarchy.canvas.wrapperEl.dispatch('keydown', keyEvent('Delete', hierarchy.canvas.wrapperEl));
      hierarchy.canvas.removeNode(hierarchy.canvas.nodes.get(id));
      hierarchy.canvas.requestSave(); hierarchy.doc.flush();
    } else {
      const target = at(hierarchy, 'b');
      const pointer = { x: target.x + 10, y: target.y + 10 };
      drag(hierarchy, 'a', { x: target.x + 5, y: target.y + 5 }, pointer);
      drop(hierarchy, pointer);
    }
    if (action === 'autofit-off' || action === 'appearance-off') {
      assert.equal(measured.size, 0, `${action} preserves manually sized boxes during reparenting`);
      for (const node of original.nodes) {
        const current = at(hierarchy, node.id);
        assert.deepEqual([current.width, current.height], [node.width, node.height]);
      }
    } else if (action === 'delete-root') {
      assert.deepEqual([...measured.keys()].sort(), ['a', 'a1', 'a2', 'b'], 'removing a map root refits all surviving former map cards');
      for (const [id, style] of measured) {
        assert.deepEqual(style, { scale: '', weight: '', map: false, root: false }, 'free cards are measured with their ordinary text style');
        assert.equal(at(hierarchy, id).width, 260, 'losing the map preserves each free card width');
      }
    } else {
      const expected = action === 'reparent'
        ? { a: ['1.0625', '500'], a1: ['1', '400'], a2: ['0.9375', '400'] }
        : { a1: ['1.25', '600'], a2: ['1.0625', '500'] };
      assert.deepEqual([...measured.keys()].sort(), Object.keys(expected).sort(), 'only cards whose level changed are measured');
      for (const [id, [scale, weight]] of Object.entries(expected)) {
        assert.deepEqual(measured.get(id), { scale, weight, map: true, root: false }, 'the new hierarchy typography is active before measurement');
        // Main branches of a Clean map keep a box; plain-word sub-topics hug their words.
        if (scale === '1.25') assert.equal(at(hierarchy, id).width, 112, 'affected titles refit inside the structural action');
        else assert.ok(at(hierarchy, id).width >= 40 && at(hierarchy, id).width < 112, `affected plain-word titles refit to hug their words: ${id}`);
      }
    }
    assert.equal(hierarchy.canvas.history.current, step + 1, `${action} and fitting share one undo step`);
    const result = state();
    const history = clone(hierarchy.canvas.history.data);
    hierarchy.canvas.undo(); hierarchy.manager.refresh(); hierarchy.doc.flush();
    assert.deepEqual(state(), original, `${action}: one undo restores structure and all card sizes`);
    hierarchy.canvas.redo(); hierarchy.manager.refresh(); hierarchy.doc.flush();
    assert.deepEqual(state(), result, `${action}: redo restores the fitted result`);
    assert.deepEqual(hierarchy.canvas.history.data, history, 'rendering an undo or redo does not create a fitting step');
    const saves = hierarchy.canvas.saves;
    hierarchy.canvas.readonly = true; hierarchy.manager.refresh(); hierarchy.doc.flush();
    assert.deepEqual(state(), result, 'read-only refresh only updates the visible type styles');
    assert.equal(hierarchy.canvas.saves, saves, 'read-only refresh does not save geometry');
    hierarchy.manager.destroy();
  }

  /* ---------- delete branch ---------- */
  {
    const three = fixture(CanvasEnhancements, {
      nodes: [nodeData('r', 0, 0, { nfLayout: 'right' }), nodeData('m', 400, 0), nodeData('leaf', 800, 0)],
      edges: [edgeData('rm', 'r', 'm'), edgeData('ml', 'm', 'leaf')],
    });
    three.canvas.wrapperEl.focus();
    three.canvas.selectOnly(three.canvas.nodes.get('m')); three.doc.flush();
    assert.equal(three.command('deleteBranch', true), true);
    const binding = three.manager.bindings.get(three.view);
    three.canvas.wrapperEl.dispatch('keydown', keyEvent('Delete', three.canvas.wrapperEl, { shiftKey: true }));
    assert.equal(binding.pending.deleted, undefined, 'Shift+Delete takes no orphan snapshot');
    const step = three.canvas.history.current;
    assert.equal(three.scope.dispatch(keyEvent('Delete', three.canvas.wrapperEl, { shiftKey: true })), false, 'Shift+Delete is taken');
    three.doc.flush();
    assert.deepEqual([...three.canvas.nodes.keys()], ['r'], 'the middle card goes with everything below it');
    assert.equal(three.canvas.edges.size, 0);
    assert.equal(three.canvas.history.current, step + 1, 'one undo step');
    assert.deepEqual([...three.canvas.selection].map(item => item.id), ['r'], 'the parent is selected');
    three.canvas.undo(); three.manager.refresh(); three.doc.flush();
    assert.deepEqual([...three.canvas.nodes.keys()].sort(), ['leaf', 'm', 'r'], 'undo brings the branch back');
    assert.equal(three.canvas.edges.size, 2);
    three.canvas.selectOnly(three.canvas.nodes.get('leaf')); three.doc.flush();
    assert.equal(three.scope.dispatch(keyEvent('Backspace', three.canvas.wrapperEl, { shiftKey: true })), false, 'Shift+Backspace too');
    three.doc.flush();
    assert.equal(three.canvas.nodes.has('leaf'), false);
    three.canvas.undo(); three.manager.refresh(); three.doc.flush();
    three.canvas.readonly = true; three.manager.refresh();
    assert.equal(three.command('deleteBranch', true), false, 'not on a read-only canvas');
    three.canvas.readonly = false;
    three.manager.destroy();
  }

  /* ---------- outdent and indent; fold, focus and boundary on a selection ---------- */
  {
    const x = fixture(CanvasEnhancements, {
      nodes: [nodeData('r', 0, 0, { nfLayout: 'right' }), nodeData('a'), nodeData('b'), nodeData('c'), nodeData('a1'), nodeData('a2'),
        nodeData('b1'), nodeData('free', 3000, 3000)],
      edges: [edgeData('ra', 'r', 'a'), edgeData('rb', 'r', 'b'), edgeData('rc', 'r', 'c'), edgeData('aa1', 'a', 'a1'), edgeData('aa2', 'a', 'a2'),
        edgeData('bb1', 'b', 'b1')],
    });
    x.canvas.wrapperEl.focus();
    x.canvas.selectOnly(x.canvas.nodes.get('r')); x.doc.flush();
    x.command('right'); x.doc.flush();
    const edgeTo = id => [...x.canvas.edges.values()].map(edge => edge.getData()).find(edge => edge.toNode === id);
    const pos = id => x.canvas.nodes.get(id).getData();
    const select = (...ids) => { x.canvas.selectAll(ids.map(id => x.canvas.nodes.get(id))); x.manager.refresh(); x.doc.flush(); };
    const muted = id => x.canvas.nodes.get(id).nodeEl.classList.contains('nf-canvas-muted');
    const tb = label => x.canvas.wrapperEl.querySelector('.nf-canvas-toolbar').querySelectorAll('button').find(button => (button.getAttribute('aria-label') ?? '').split(' · ')[0] === label);

    // Mod+[ takes a card up a level, right after its parent; Mod+] tucks it under the sibling before it.
    for (const id of ['r', 'a', 'free']) {
      x.canvas.selectOnly(x.canvas.nodes.get(id)); x.doc.flush();
      assert.equal(x.command('outdent', true), false, `${id} cannot go up a level`);
      assert.equal(x.command('indent', true), false, `${id} has nothing before it`);
    }
    x.canvas.selectOnly(x.canvas.nodes.get('a2')); x.doc.flush();
    let step = x.canvas.history.current;
    assert.equal(x.scope.dispatch(keyEvent('[', x.canvas.wrapperEl, { metaKey: true })), false, 'Mod+[ is taken');
    x.doc.flush();
    assert.equal(edgeTo('a2').fromNode, 'r', 'a2 now hangs from the centre');
    assert.equal(x.canvas.edges.has('aa2'), false, 'its old connection is gone');
    assert.ok(pos('a2').y > pos('a1').y && pos('a2').y < pos('b').y, 'placed right after the branch it left');
    assert.equal(pos('a2').x, pos('a').x, 'in the column of its new siblings');
    assert.equal(x.canvas.history.current, step + 1, 'one undo step');
    assert.deepEqual([...x.canvas.selection].map(item => item.id), ['a2'], 'and still selected');
    assert.equal(x.scope.dispatch(keyEvent(']', x.canvas.wrapperEl, { metaKey: true })), false, 'Mod+] is taken');
    x.doc.flush();
    assert.equal(edgeTo('a2').fromNode, 'a', 'back under the sibling before it');
    assert.ok(pos('a2').y > pos('a1').y, 'as its last child');
    assert.equal(x.canvas.history.current, step + 2);
    x.canvas.undo(); x.canvas.undo(); x.manager.refresh(); x.doc.flush();
    assert.equal(edgeTo('a2').id, 'aa2', 'two undos restore the original connection');
    // Indenting under a folded sibling unfolds it.
    x.canvas.selectOnly(x.canvas.nodes.get('b')); x.doc.flush();
    x.command('fold'); x.doc.flush();
    assert.equal(pos('b').nfCollapsed, true);
    x.canvas.selectOnly(x.canvas.nodes.get('c')); x.doc.flush();
    assert.equal(x.command('indent'), true);
    x.doc.flush();
    assert.equal(edgeTo('c').fromNode, 'b');
    assert.equal(pos('b').nfCollapsed, undefined, 'the new parent opens to show it');
    assert.equal(x.canvas.nodes.get('c').nodeEl.classList.contains('nf-canvas-hidden'), false);
    x.canvas.undo(); x.canvas.undo(); x.manager.refresh(); x.doc.flush();
    assert.equal(edgeTo('c').fromNode, 'r');

    // Fold acts on every selected branch: they fold while any is open, and unfold once all are folded.
    select('a', 'b');
    assert.equal(x.command('fold', true), true);
    assert.equal(tb('Fold branch').disabled, false);
    step = x.canvas.history.current;
    x.command('fold'); x.doc.flush();
    assert.deepEqual([pos('a').nfCollapsed, pos('b').nfCollapsed], [true, true], 'both fold');
    assert.equal(x.canvas.history.current, step + 1, 'in one step');
    for (const id of ['a1', 'a2', 'b1']) assert.equal(x.canvas.nodes.get(id).nodeEl.classList.contains('nf-canvas-hidden'), true, `${id} is hidden`);
    assert.equal(tb('Unfold branch').getAttribute('aria-pressed'), 'true', 'the button now unfolds');
    x.command('fold'); x.doc.flush();
    assert.deepEqual([pos('a').nfCollapsed, pos('b').nfCollapsed], [undefined, undefined], 'both unfold');
    x.canvas.selectOnly(x.canvas.nodes.get('a')); x.doc.flush();
    x.command('fold'); x.doc.flush();
    select('a', 'b');
    assert.equal(tb('Fold branch').getAttribute('aria-pressed'), 'false', 'one open branch means the button folds');
    x.command('fold'); x.doc.flush();
    assert.deepEqual([pos('a').nfCollapsed, pos('b').nfCollapsed], [true, true], 'the open one joins the folded one');
    x.command('fold'); x.doc.flush();
    select('a1', 'c');
    assert.equal(x.command('fold', true), false, 'leaves have nothing to fold');
    // The floating menu shows what acts on all of them.
    const menuEl = x.doc.createElement('div');
    x.canvas.menu = { menuEl, render() {} };
    select('a', 'b');
    const shown = menuEl.querySelectorAll('.nf-canvas-menu-action').filter(button => !button.hidden).map(button => button.dataset.action);
    assert.deepEqual(shown, ['connect', 'fold', 'markers'], 'a selection of map cards gets Connect, Fold and Markers');
    select('free', 'a');
    assert.equal(menuEl.querySelectorAll('.nf-canvas-menu-group').length, 0, 'not when one is a free card');
    x.canvas.menu = undefined;

    // Boundary toggles each selected card.
    select('a', 'c');
    step = x.canvas.history.current;
    x.command('boundary'); x.doc.flush();
    assert.deepEqual([pos('a').nfBoundary, pos('c').nfBoundary], [true, true]);
    assert.equal(x.canvas.history.current, step + 1, 'one step');
    x.canvas.selectOnly(x.canvas.nodes.get('a')); x.doc.flush();
    x.command('boundary'); x.doc.flush();
    select('a', 'c');
    x.command('boundary'); x.doc.flush();
    assert.deepEqual([pos('a').nfBoundary, pos('c').nfBoundary], [true, undefined], 'each card toggles on its own');
    x.command('boundary'); x.doc.flush();
    x.canvas.selectOnly(x.canvas.nodes.get('c')); x.doc.flush();
    x.command('boundary'); x.doc.flush();
    assert.deepEqual([pos('a').nfBoundary, pos('c').nfBoundary], [undefined, undefined]);

    // Focus over two branches keeps both in the light.
    select('a', 'c');
    assert.equal(x.command('focus', true), true);
    x.command('focus'); x.doc.flush();
    for (const id of ['a', 'a1', 'a2', 'c']) assert.equal(muted(id), false, `${id} is in focus`);
    for (const id of ['r', 'b', 'b1', 'free']) assert.equal(muted(id), true, `${id} fades`);
    assert.equal(x.canvas.nodes.get('a').nodeEl.classList.contains('nf-canvas-root'), true);
    assert.equal(x.canvas.nodes.get('c').nodeEl.classList.contains('nf-canvas-root'), true);
    assert.equal(tb('Show all').getAttribute('aria-pressed'), 'true');
    assert.equal(x.canvas.wrapperEl.querySelector('.nf-canvas-hint').textContent, 'Branch focus: 4', 'the pill under the toolbar says so at any width');
    assert.match(x.canvas.wrapperEl.querySelector('.nf-canvas-status').textContent, /^Mind map · /, 'cards of one map are summed up as that map');
    x.command('focus'); x.doc.flush();
    assert.equal(muted('b'), false, 'focusing the same selection again shows everything');
    select('a', 'c');
    x.command('focus'); x.doc.flush();
    x.canvas.selectOnly(x.canvas.nodes.get('b')); x.doc.flush();
    assert.equal(muted('b'), true, 'selecting outside the focus keeps it');
    assert.equal(x.canvas.wrapperEl.dispatch('keydown', keyEvent('Escape', x.canvas.wrapperEl)).defaultPrevented, true);
    x.doc.flush();
    assert.equal(muted('b'), false, 'Escape shows everything');
    x.manager.destroy();
  }

  /* ---------- an empty canvas says how to begin ---------- */
  {
    const e = fixture(CanvasEnhancements, { nodes: [], edges: [] });
    const panel = () => e.canvas.wrapperEl.querySelector('.nf-canvas-empty');
    // A canvas is bound before its file is read, so the panel waits a moment for the cards.
    assert.equal(panel(), null, 'no panel the instant an empty canvas is bound');
    assert.equal(e.canvas.wrapperEl.querySelector('.nf-canvas-status').textContent, '', 'and nothing is announced yet');
    assert.ok(e.doc.pendingFrames() > 0, 'the panel is on its way');
    e.doc.flush();
    assert.ok(panel(), 'an empty canvas shows the onboarding panel');
    assert.ok(panel().classList.contains('nf-canvas-ui'), 'which is not a canvas change');
    assert.equal(panel().querySelector('.nf-canvas-empty-title').textContent, 'Start a mind map');
    const text = panel().querySelector('.nf-canvas-empty-text');
    assert.equal(text.textContent, 'Double-click the canvas for a free card, or start a topic and press Tab for children.');
    assert.deepEqual(text.querySelectorAll('kbd').map(el => el.textContent), ['Tab'], 'the key reads as a key');
    const buttons = panel().querySelector('.nf-canvas-empty-actions').querySelectorAll('button');
    assert.deepEqual(buttons.map(button => button.textContent), ['New topic', 'Open the guide']);
    assert.ok(buttons[0].classList.contains('mod-cta'), 'the topic is the way in');
    // Or a map in a designed scheme: a tile per look, drawn as on the Style panel.
    const schemes = panel().querySelector('.nf-canvas-empty-schemes');
    assert.ok(schemes, 'the panel offers colour schemes');
    assert.equal(schemes.querySelector('.nf-canvas-empty-schemes-label').textContent, 'Color schemes');
    const grid = schemes.querySelector('.nf-canvas-empty-tiles');
    assert.ok(grid.classList.contains('nf-canvas-style-tiles'), 'laid out like the Style panel tiles');
    assert.deepEqual([grid.getAttribute('role'), grid.getAttribute('aria-label')], ['group', 'Color schemes']);
    const tiles = grid.querySelectorAll('.nf-canvas-empty-tile');
    assert.deepEqual(tiles.map(tile => tile.dataset.preset), ['mist', 'sakura', 'nord', 'guose', 'vivid', 'aurora']);
    assert.deepEqual(tiles.map(tile => tile.querySelector('.nf-canvas-style-tile-name').textContent),
      ['Soft mist', 'Sakura', 'Nordic', 'Chinese classic', 'Vivid ideas', 'Aurora']);
    assert.equal(tiles[1].getAttribute('aria-label'), 'Sakura · Petal-soft blocks in rose, lilac and celadon.', 'the name, then what it is');
    for (const tile of tiles) {
      assert.ok(tile.classList.contains('nf-canvas-style-tile'));
      assert.equal(tile.type, 'button');
      assert.equal(tile.getAttribute('aria-pressed'), null, 'a tile starts a map; it is not a toggle');
      const thumb = tile.querySelector('.nf-canvas-style-thumb');
      assert.equal(thumb?.tagName, 'SVG', 'a miniature of the scheme');
      assert.deepEqual([thumb.getAttribute('width'), thumb.getAttribute('height')], ['96', '50'], 'small even without the stylesheet');
      assert.equal(tile.querySelector('.nf-canvas-style-dots')?.tagName, 'SVG', 'and its six branch colours');
    }
    assert.ok(tiles[3].querySelector('.nf-canvas-style-tile-name').classList.contains('nf-font-sample-serif'), 'a scheme with a typeface shows it');
    let tileStops = 0;
    for (const name of ['pointerdown', 'dblclick']) tiles[0].dispatch(name, { stopPropagation() { tileStops++; } });
    assert.equal(tileStops, 2, 'the tiles keep their presses from Canvas too');
    assert.equal(e.canvas.wrapperEl.querySelector('.nf-canvas-status').textContent, 'Click New topic to start');
    assert.equal(e.canvas.wrapperEl.querySelector('.nf-canvas-hint').textContent, '');
    // The buttons keep their presses from Canvas, which would start a marquee or a card.
    let stopped = 0;
    for (const name of ['pointerdown', 'dblclick']) buttons[0].dispatch(name, { stopPropagation() { stopped++; } });
    assert.equal(stopped, 2);
    buttons[1].dispatch('click'); e.doc.flush();
    assert.ok(e.canvas.wrapperEl.querySelector('.nf-canvas-help-panel'), 'the guide opens');
    assert.ok(panel(), 'and the panel stays while the canvas is empty');
    buttons[1].dispatch('click'); e.doc.flush();
    assert.ok(e.canvas.wrapperEl.querySelector('.nf-canvas-help-panel'), 'the button opens the guide; it never closes it');
    buttons[0].dispatch('click'); e.doc.flush();
    assert.equal(e.canvas.nodes.size, 1, 'New topic starts a card');
    assert.equal([...e.canvas.selection][0].isEditing, true, 'ready to type into');
    assert.equal(panel(), null, 'the panel leaves with the first card');
    assert.notEqual(e.canvas.wrapperEl.querySelector('.nf-canvas-status').textContent, 'Click New topic to start');
    e.canvas.undo(); e.manager.refresh(); e.doc.flush();
    assert.ok(panel(), 'and returns once the canvas is empty again');
    // A read-only canvas has nothing to offer.
    e.canvas.readonly = true; e.manager.refresh(); e.doc.flush();
    assert.equal(panel(), null);
    e.canvas.readonly = false; e.manager.refresh(); e.doc.flush();
    assert.ok(panel());
    e.manager.destroy();
    assert.equal(panel(), null, 'teardown removes it');
    assert.equal(e.canvas.wrapperEl.querySelector('.nf-canvas-hint'), null, 'and the pill');
    // A canvas whose cards arrive in time never flashes the panel.
    const late = fixture(CanvasEnhancements, { nodes: [], edges: [] });
    late.canvas.importData({ nodes: [nodeData('a')], edges: [] }, false); late.manager.refresh(); late.doc.flush();
    assert.equal(late.canvas.wrapperEl.querySelector('.nf-canvas-empty'), null, 'a canvas filled before the moment passes shows no panel');
    assert.notEqual(late.canvas.wrapperEl.querySelector('.nf-canvas-status').textContent, 'Click New topic to start');
    late.manager.destroy();
    // Teardown while the panel is still on its way leaves no timer behind.
    const gone = fixture(CanvasEnhancements, { nodes: [], edges: [] });
    gone.manager.destroy();
    assert.equal(gone.doc.pendingFrames(), 0, 'teardown clears the pending panel');
    assert.equal(gone.canvas.wrapperEl.querySelector('.nf-canvas-empty'), null);
  }

  /* ---------- starting a map in a scheme ---------- */
  {
    const LOOK = ['nfPalette', 'nfPaletteColors', 'nfTheme', 'nfLine', 'nfSpacing', 'nfFont', 'nfShape'];
    const look = (data) => Object.fromEntries(LOOK.map(key => [key, data[key]]));
    const start = (preset, settings = {}) => {
      const s = fixture(CanvasEnhancements, { nodes: [], edges: [] });
      Object.assign(s.settings, settings);
      s.doc.flush();
      s.canvas.getViewportBBox = () => ({ minX: 1000, minY: 1000, maxX: 1400, maxY: 1300 });
      const panel = () => s.canvas.wrapperEl.querySelector('.nf-canvas-empty');
      const before = s.canvas.history.current;
      panel().querySelectorAll('.nf-canvas-empty-tile').find(tile => tile.dataset.preset === preset).dispatch('click');
      s.doc.flush();
      return { s, panel, before, root: [...s.canvas.nodes.values()][0] };
    };

    const { s, panel, before, root } = start('guose');
    assert.equal(s.canvas.nodes.size, 1, 'a tile starts one card');
    const data = root.getData();
    assert.equal(data.text, '');
    assert.equal(data.nfLayout, 'right', 'the centre of a map from the start');
    assert.deepEqual(look(data), { nfPalette: 'guose', nfPaletteColors: undefined, nfTheme: 'clean', nfLine: 'organic',
      nfSpacing: 'standard', nfFont: 'serif', nfShape: undefined }, 'in the scheme: palette, look, lines, spacing and typeface');
    assert.deepEqual([data.width, data.height], [160, 64], 'at the size a blank centre fits to');
    assert.deepEqual([data.x, data.y], [1200 - 80, 1150 - 32], 'in the middle of the view');
    assert.equal(root.isEditing, true, 'ready to type into');
    assert.deepEqual([...s.canvas.selection], [root]);
    assert.ok(root.nodeEl.classList.contains('nf-canvas-map-root'), 'drawn as a map centre while typed in');
    assert.ok(root.nodeEl.classList.contains('nf-font-serif'), 'in its typeface');
    assert.equal(panel(), null, 'the panel leaves with the first card');
    assert.equal(s.canvas.history.current, before + 1, 'the card, its scheme and its size are one step');
    // Exactly what the Style panel stores for the same preset on a map.
    const styled = fixture(CanvasEnhancements, { nodes: [nodeData('r', 0, 0, { nfLayout: 'right' })], edges: [] });
    styled.canvas.selectOnly(styled.canvas.nodes.get('r')); styled.doc.flush();
    assert.equal(styled.manager.bindings.get(styled.view).run('preset-guose'), true);
    assert.deepEqual(look(styled.canvas.nodes.get('r').getData()), look(data), 'the same fields as the Style panel writes');
    styled.manager.destroy();
    s.canvas.undo(); s.manager.refresh(); s.doc.flush();
    assert.equal(s.canvas.nodes.size, 0, 'one undo takes it away');
    assert.ok(panel(), 'and the panel returns');
    // Every look.
    for (const [preset, theme, shape, font] of [['sakura', 'pastel', 'pill', undefined], ['vivid', 'vivid', undefined, undefined],
      ['mist', 'clean', undefined, undefined], ['nord', 'cards', undefined, undefined], ['aurora', 'gradient', undefined, undefined]]) {
      const other = start(preset);
      const got = other.root.getData();
      assert.deepEqual([got.nfPalette, got.nfTheme, got.nfShape, got.nfFont], [preset, theme, shape, font], preset);
      other.s.manager.destroy();
    }
    // Without the map look a scheme would not show: no tiles, and back with it.
    s.settings.canvasAppearance = false; s.manager.refresh(); s.doc.flush();
    assert.ok(panel(), 'the panel stays');
    assert.equal(panel().querySelector('.nf-canvas-empty-schemes'), null, 'without its schemes');
    assert.deepEqual(panel().querySelector('.nf-canvas-empty-actions').querySelectorAll('button').map(button => button.textContent),
      ['New topic', 'Open the guide'], 'and with its buttons');
    s.settings.canvasAppearance = true; s.manager.refresh(); s.doc.flush();
    assert.equal(panel().querySelectorAll('.nf-canvas-empty-tile').length, 6, 'the schemes come back with the look');
    assert.equal(s.canvas.wrapperEl.querySelectorAll('.nf-canvas-empty').length, 1, 'in one panel');
    s.manager.destroy();
    // The blank centre's size follows the card size, as other new topics do.
    for (const [settings, size, why] of [
      [{ canvasAutoFit: false }, [240, 60], 'no fitting: Canvas\'s roomy box'],
      [{ canvasCardSize: 'compact' }, [112, 48], 'compact'],
      [{ canvasCardSize: 'preserve' }, [240, 60], 'preserved sizes'],
    ]) {
      const other = start('mist', settings);
      const got = other.root.getData();
      assert.deepEqual([got.width, got.height], size, why);
      assert.equal(got.x, 1200 - size[0] / 2, `${why}: centred`);
      assert.equal(got.nfPalette, 'mist', `${why}: in its scheme`);
      other.s.manager.destroy();
    }
    // A read-only canvas shows no panel; a tile pressed as it turns read-only starts nothing.
    const locked = fixture(CanvasEnhancements, { nodes: [], edges: [] });
    locked.doc.flush();
    const tile = locked.canvas.wrapperEl.querySelector('.nf-canvas-empty').querySelectorAll('.nf-canvas-empty-tile')[0];
    locked.canvas.readonly = true;
    tile.dispatch('click'); locked.doc.flush();
    assert.equal(locked.canvas.nodes.size, 0);
    locked.manager.destroy();
  }

  {
    /* Refresh cost: virtualization is not a change, the same state is not drawn twice, and a note reaches only the canvases showing it */
    const { TFile } = await import(pathToFileURL(fileURLToPath(new URL('./obsidian-stub.mjs', import.meta.url))).href);
    const listeners = [];
    const noteTasks = new Map([['Trip.md', [{ task: ' ' }, { task: 'x' }]]]);
    const noteApp = {
      vault: { getAbstractFileByPath: path => noteTasks.has(path) ? Object.assign(new TFile(path), { path }) : null },
      metadataCache: { getFileCache: file => ({ listItems: noteTasks.get(file.path) }), on(name, callback) { listeners.push([name, callback]); return {}; } },
    };
    const rc = fixture(CanvasEnhancements, {
      nodes: [nodeData('plan', 0, 0, { nfLayout: 'right', text: 'Plan' }), nodeData('trip', 400, 0, { type: 'file', file: 'Trip.md' }), nodeData('loose', 0, 600)],
      edges: [edgeData('p-t', 'plan', 'trip')],
    }, noteApp);
    rc.doc.flush();
    const binding = rc.manager.bindings.get(rc.view);
    let renders = 0;
    const render = binding.render;
    binding.render = function (...args) { renders++; return render.apply(this, args); };
    let scheduled = 0;
    const schedule = binding.schedule;
    binding.schedule = () => { scheduled++; schedule(); };
    // Canvas takes off-screen cards and lines out of the document and puts them back.
    const loose = rc.canvas.nodes.get('loose');
    loose.nodeEl.remove(); loose.attach();
    const line = rc.canvas.edges.get('p-t').lineGroupEl;
    line.remove(); rc.canvas.wrapperEl.append(line);
    rc.doc.flush();
    assert.equal(scheduled, 0, 'virtualization is not a change');
    assert.equal(renders, 0);
    assert.equal(rc.doc.pendingFrames(), 0);
    rc.manager.refresh();
    assert.equal(renders, 0, 'the same state is not drawn again');
    rc.canvas.selectOnly(loose); rc.doc.flush();
    assert.equal(renders, 1, 'a selection is');
    rc.canvas.nodes.get('plan').data.text = 'Plan B'; rc.manager.refresh();
    assert.equal(renders, 2, 'so are new words on a card');
    rc.manager.refresh();
    assert.equal(renders, 2);
    const seen = scheduled;
    const stranger = rc.doc.createElement('div'); stranger.className = 'canvas-node';
    rc.canvas.wrapperEl.append(stranger); rc.doc.flush();
    assert.equal(scheduled, seen + 1, 'an element this binding never drew is looked at');
    assert.equal(renders, 2, 'though a canvas that has not changed is still not drawn again');
    stranger.remove(); rc.doc.flush();
    assert.equal(scheduled, seen + 2);
    binding.schedule = schedule;
    rc.canvas.importData({ nodes: [nodeData('new', 800, 0)], edges: [] }, false); rc.doc.flush();
    assert.ok(renders > 2, 'a new card is drawn');
    // While the canvas is dragged or wheeled, a refresh that just ran is followed at a walking pace, not the next frame.
    rc.canvas.isDragging = true; binding.lastRefreshAt = Date.now();
    rc.canvas.wrapperEl.dispatch('pointerup');
    assert.ok(binding.refreshTimer > 0 && binding.frame === 0, 'held back while dragging');
    rc.doc.flush(); rc.canvas.isDragging = false;
    assert.equal(binding.refreshTimer, 0);
    rc.canvas.wrapperEl.dispatch('wheel'); binding.lastRefreshAt = Date.now();
    rc.canvas.wrapperEl.dispatch('pointerup');
    assert.ok(binding.refreshTimer > 0 && binding.frame === 0, 'held back while wheeling');
    rc.doc.flush();
    binding.lastRefreshAt = 0; binding.lastWheelAt = 0;
    rc.canvas.wrapperEl.dispatch('pointerup');
    assert.ok(binding.frame > 0 && binding.refreshTimer === 0, 'otherwise the next frame');
    rc.doc.flush();
    // A note changing elsewhere refreshes only the canvases showing it as a card.
    const base = renders;
    const changed = listeners.find(([name]) => name === 'changed')[1];
    changed({ path: 'Other.md' });
    assert.equal(renders, base, 'a note no card shows is not this canvas’s business');
    const badge = () => rc.canvas.nodes.get('plan').nodeEl.children.find(child => child.classList.contains('nf-canvas-progress'));
    assert.equal(badge().children.at(-1).textContent, '1/2');
    noteTasks.set('Trip.md', [{ task: 'x' }, { task: 'x' }]);
    changed({ path: 'Trip.md' });
    assert.equal(renders, base + 1, 'the note a card shows is');
    assert.equal(badge().children.at(-1).textContent, '2/2', 'and its tasks are counted again');
    rc.manager.destroy();
    assert.equal(rc.doc.pendingFrames(), 0);
    assert.equal(rc.canvas.wrapperEl.events.get('wheel').size, 0, 'teardown takes the wheel listener with it');
  }

  {
    /* Inline find: matches light up and the rest dim, Enter walks them, folded matches are counted and unfolded on the way */
    const fb = fixture(CanvasEnhancements, {
      nodes: [nodeData('r', 0, 0, { nfLayout: 'right', text: 'Plan' }), nodeData('a', 0, 0, { text: 'Alpha task' }), nodeData('b', 0, 0, { text: 'Beta' }),
        nodeData('a1', 0, 0, { text: 'Alpha **detail**' }), nodeData('free', 3000, 3000, { text: 'alpha, free' })],
      edges: [edgeData('ra', 'r', 'a'), edgeData('rb', 'r', 'b'), edgeData('aa1', 'a', 'a1')],
    });
    const has = (id, cls) => fb.canvas.nodes.get(id).nodeEl.classList.contains(cls);
    fb.canvas.wrapperEl.focus();
    fb.canvas.selectOnly(fb.canvas.nodes.get('r')); fb.doc.flush();
    fb.command('right'); fb.doc.flush();
    fb.canvas.selectOnly(fb.canvas.nodes.get('a')); fb.doc.flush();
    fb.command('fold'); fb.doc.flush();
    assert.equal(has('a1', 'nf-canvas-hidden'), true);
    fb.canvas.selection.clear(); fb.doc.flush();
    const findButton = fb.canvas.wrapperEl.querySelectorAll('button').find(item => (item.getAttribute('aria-label') ?? '').startsWith('Find card'));
    assert.equal(findButton.getAttribute('aria-keyshortcuts'), 'Mod+F', 'the toolbar button carries the shortcut of the bar it opens');
    assert.equal(fb.scope.dispatch(keyEvent('f', fb.canvas.wrapperEl, { metaKey: true })), false, 'Mod+F opens the find bar');
    const bar = fb.canvas.wrapperEl.querySelector('.nf-canvas-find');
    assert.ok(bar, 'the bar is up');
    assert.equal(bar.classList.contains('nf-canvas-ui'), true, 'and is ours, not a canvas change');
    assert.equal(fb.canvas.wrapperEl.classList.contains('nf-canvas-finding'), true);
    const input = bar.querySelector('input');
    assert.equal(fb.doc.activeElement, input, 'with the keyboard in the box');
    assert.equal(findButton.getAttribute('aria-pressed'), 'true');
    const count = () => bar.querySelector('.nf-canvas-find-count').textContent;
    assert.equal(count(), '', 'nothing is counted before words are typed');
    assert.equal(fb.scope.dispatch(keyEvent('Tab', input)), undefined, 'keys in the box never grow the map');
    assert.equal(fb.scope.dispatch(keyEvent('Enter', input)), undefined);
    const type = words => { input.value = words; input.dispatch('input'); };
    type('detail');
    assert.equal(count(), '0 of 1 · 1 folded', 'a match folded away is counted, but none is current');
    assert.equal(fb.canvas.selection.size, 0, 'and nothing hidden gets selected');
    bar.dispatch('keydown', keyEvent('Enter', input));
    assert.equal(count(), '1 of 1', 'Enter shows it');
    assert.deepEqual([...fb.canvas.selection].map(item => item.id), ['a1']);
    assert.equal(at(fb, 'a').nfCollapsed, undefined);
    fb.canvas.selectOnly(fb.canvas.nodes.get('a')); fb.command('fold'); fb.doc.flush();
    assert.equal(has('a1', 'nf-canvas-hidden'), true);
    assert.ok(fb.canvas.wrapperEl.querySelector('.nf-canvas-find'), 'folding leaves the bar up');
    fb.canvas.selection.clear(); fb.doc.flush();
    type('alpha');
    assert.equal(count(), '1 of 3 · 1 folded', 'matches are counted, folded ones included');
    assert.deepEqual(['a', 'a1', 'free'].map(id => has(id, 'nf-canvas-found')), [true, true, true], 'matches light up');
    assert.deepEqual(['r', 'b'].map(id => has(id, 'nf-canvas-muted')), [true, true], 'the rest dim');
    assert.equal(has('a', 'nf-canvas-muted'), false);
    assert.equal(fb.canvas.edges.get('rb').lineGroupEl.classList.contains('nf-canvas-muted'), true, 'and so do their connections');
    assert.deepEqual([...fb.canvas.selection].map(item => item.id), ['a'], 'the first match in view is selected as typing goes');
    assert.equal(at(fb, 'a').nfCollapsed, true, 'without unfolding anything');
    assert.equal(fb.doc.activeElement, input, 'or taking the keyboard');
    const steps = fb.canvas.history.current;
    bar.dispatch('keydown', keyEvent('Enter', input));
    assert.deepEqual([...fb.canvas.selection].map(item => item.id), ['a1'], 'Enter walks to the next match');
    assert.equal(at(fb, 'a').nfCollapsed, undefined, 'unfolding the branch that hid it');
    assert.equal(fb.canvas.history.current, steps + 1, 'as one undo step');
    assert.equal(count(), '2 of 3', 'which is folded no more');
    assert.equal(fb.doc.activeElement, input, 'while the keyboard stays in the box');
    assert.equal(has('a1', 'nf-canvas-found'), true);
    fb.doc.flush();
    assert.equal(has('a1', 'nf-canvas-found'), true, 'a match stays lit after its ring');
    bar.dispatch('keydown', keyEvent('Enter', input));
    assert.equal(count(), '3 of 3');
    assert.ok(fb.canvas.zooms.length > 0, 'each match is framed');
    bar.dispatch('keydown', keyEvent('Enter', input));
    assert.equal(count(), '1 of 3', 'and the walk wraps around');
    bar.dispatch('keydown', keyEvent('Enter', input, { shiftKey: true }));
    assert.equal(count(), '3 of 3', 'Shift+Enter walks back');
    bar.querySelector('.nf-canvas-find-previous').dispatch('click');
    assert.equal(count(), '2 of 3', 'as does the button');
    type('zzz');
    assert.equal(count(), '0 of 0');
    assert.equal(bar.classList.contains('is-missing'), true, 'no match is said so');
    assert.equal(bar.querySelector('.nf-canvas-find-next').disabled, true);
    assert.deepEqual(['r', 'a', 'b', 'a1', 'free'].some(id => has(id, 'nf-canvas-muted') || has(id, 'nf-canvas-found')), false, 'and nothing is dimmed or lit');
    type('beta');
    assert.equal(count(), '1 of 1');
    fb.canvas.nodes.get('b').data.text = 'Gamma'; fb.manager.refresh();
    assert.equal(count(), '0 of 0', 'a card changing its words leaves the matches');
    assert.equal(fb.command('find', true), true);
    fb.command('find');
    assert.equal(fb.canvas.wrapperEl.querySelectorAll('.nf-canvas-find').length, 1, 'Mod+F again keeps the one bar');
    fb.canvas.wrapperEl.focus();
    fb.canvas.wrapperEl.dispatch('keydown', keyEvent('Escape', fb.canvas.wrapperEl));
    assert.equal(fb.canvas.wrapperEl.querySelector('.nf-canvas-find'), null, 'Escape on the canvas puts the bar away');
    assert.equal(fb.canvas.wrapperEl.classList.contains('nf-canvas-finding'), false);
    assert.equal(findButton.getAttribute('aria-pressed'), 'false');
    fb.command('find');
    const again = fb.canvas.wrapperEl.querySelector('.nf-canvas-find');
    again.querySelector('input').value = 'alpha'; again.querySelector('input').dispatch('input');
    assert.equal(has('free', 'nf-canvas-found'), true);
    again.dispatch('keydown', keyEvent('Escape', again.querySelector('input')));
    assert.equal(fb.canvas.wrapperEl.querySelector('.nf-canvas-find'), null, 'Escape in the box closes it too');
    assert.equal(fb.doc.activeElement, fb.canvas.wrapperEl, 'and hands the keyboard back to the canvas');
    assert.deepEqual(['r', 'a', 'b', 'a1', 'free'].some(id => has(id, 'nf-canvas-muted') || has(id, 'nf-canvas-found')), false, 'with every card as it was');
    fb.canvas.readonly = true; fb.manager.refresh();
    assert.equal(fb.command('find', true), true, 'finding works on read-only canvases');
    fb.canvas.readonly = false;
    fb.command('find');
    fb.view.file = { path: 'elsewhere.canvas' }; fb.manager.refresh();
    assert.equal(fb.canvas.wrapperEl.querySelector('.nf-canvas-find'), null, 'another file starts without the bar');
    fb.manager.destroy();
    assert.equal(fb.doc.pendingFrames(), 0);
  }

  {
    /* Render cost: hundreds of cards with tasks refresh within budget, the plan is kept while structure and looks stand, and task counts are cached by text */
    const nodes = [nodeData('root', 0, 0, { nfLayout: 'right', text: 'Root' })];
    const edges = [];
    for (let branch = 0; branch < 24; branch++) {
      const bid = `b${branch}`;
      nodes.push(nodeData(bid, 400, branch * 700, { text: `Branch ${branch}\n- [ ] one\n- [x] two` }));
      edges.push(edgeData(`e-${bid}`, 'root', bid));
      for (let sub = 0; sub < 24; sub++) {
        const sid = `${bid}s${sub}`;
        nodes.push(nodeData(sid, 800, branch * 700 + sub * 28, { text: `Topic ${branch}.${sub}\n- [ ] a\n- [x] b\n- [ ] c` }));
        edges.push(edgeData(`e-${sid}`, bid, sid));
      }
    }
    assert.equal(nodes.length, 601);
    const big = fixture(CanvasEnhancements, { nodes, edges });
    big.doc.flush();
    const binding = big.manager.bindings.get(big.view);
    const plan = binding.plan;
    assert.ok(plan, 'a render leaves its plan behind');
    const badge = id => big.canvas.nodes.get(id).nodeEl.children.find(child => child.classList.contains('nf-canvas-progress')).children.at(-1).textContent;
    assert.equal(badge('root'), '600/1776', 'the map sums every branch’s tasks');
    let renders = 0;
    const render = binding.render;
    binding.render = function (...args) { renders++; return render.apply(this, args); };
    const started = performance.now();
    for (let round = 0; round < 20; round++) {
      big.canvas.selectOnly(big.canvas.nodes.get(round % 2 ? 'b1' : 'b2'));
      big.manager.refresh();
    }
    const elapsed = performance.now() - started;
    assert.equal(renders, 20, 'each selection is drawn');
    assert.ok(elapsed < 2000, `20 refreshes of 600 cards took ${Math.round(elapsed)} ms`);
    assert.equal(binding.plan, plan, 'the plan is reused while structure and looks stand');
    assert.ok(binding.taskCounts.size > 0 && binding.taskCounts.size <= 601, 'task counts are kept by text');
    big.canvas.nodes.get('b0s0').data.text = 'Topic\n- [x] a\n- [x] b\n- [x] c'; big.manager.refresh();
    assert.equal(badge('root'), '602/1776', 'new words are counted');
    assert.equal(binding.plan, plan, 'without a new plan: words are not structure');
    big.canvas.nodes.get('b0').moveTo({ x: 401, y: 0 }); big.manager.refresh();
    assert.notEqual(binding.plan, plan, 'a card moving is');
    const moved = binding.plan;
    big.canvas.nodes.get('root').data.color = '2'; big.manager.refresh();
    assert.notEqual(binding.plan, moved, 'and so is a colour');
    const coloured = binding.plan;
    big.settings.canvasMapStyle = 'vivid'; big.manager.refresh();
    assert.notEqual(binding.plan, coloured, 'as is a default look from the settings');
    delete big.settings.canvasMapStyle;
    let cleared = 0;
    const clear = binding.taskCounts.clear.bind(binding.taskCounts);
    binding.taskCounts.clear = () => { cleared++; clear(); };
    big.view.file = { path: 'another.canvas' }; big.manager.refresh();
    assert.equal(cleared, 1, 'another file starts with empty caches');
    big.manager.destroy();
    assert.equal(big.doc.pendingFrames(), 0);
  }

  {
    /* Minimap: the selected cards are marked, and a jump shows the map for a moment */
    const mm = fixture(CanvasEnhancements, { nodes: [nodeData('a', 0, 0), nodeData('b', 3000, 3000)], edges: [] });
    Object.assign(mm.canvas, { canvasEl: mm.doc.createElement('div'), x: 0, y: 0, tx: 0, ty: 0,
      getViewportBBox() { return { minX: -500, minY: -500, maxX: 500, maxY: 500 }; }, markViewportChanged() {} });
    mm.settings.canvasMinimap = true; mm.manager.refresh(); mm.doc.flush();
    const minimap = mm.canvas.wrapperEl.querySelector('.nf-canvas-minimap');
    assert.ok(minimap, 'the minimap is up');
    const marks = () => minimap.querySelectorAll('rect').filter(rect => rect.classList.contains('nf-canvas-minimap-card'))
      .map(rect => [rect.getAttribute('x'), rect.classList.contains('is-selected')]);
    assert.deepEqual(marks(), [['0', false], ['3000', false]]);
    mm.canvas.selectOnly(mm.canvas.nodes.get('b')); mm.doc.flush();
    assert.deepEqual(marks(), [['0', false], ['3000', true]], 'the selected card is marked');
    mm.canvas.nodes.get('a').moveTo({ x: 10, y: 0 }); mm.manager.refresh(); mm.doc.flush();
    assert.deepEqual(marks(), [['10', false], ['3000', true]], 'and stays marked when the cards are drawn again');
    mm.canvas.selection.clear(); mm.manager.refresh();
    assert.deepEqual(marks(), [['10', false], ['3000', false]]);
    assert.equal(minimap.classList.contains('is-peek'), false);
    assert.equal(mm.manager.bindings.get(mm.view).jumpTo('a'), true);
    assert.equal(minimap.classList.contains('is-peek'), true, 'a jump shows the minimap for a moment');
    assert.deepEqual(marks(), [['10', true], ['3000', false]]);
    mm.doc.flush();
    assert.equal(minimap.classList.contains('is-peek'), false, 'and then it may hide again');
    mm.manager.destroy();
    assert.equal(mm.doc.pendingFrames(), 0);
  }

  console.log('PASS canvas controller: atomic undo/redo, metadata, labelled-edge focus, scoped input safety, selection observers, settings, replacement, onboarding, fold glide, drag insertion bar, layout preview, branch colour, presenting clicks, refresh cost, inline find, render plan reuse, minimap marks, and complete teardown');
} finally {
  await rm(directory, { recursive: true, force: true });
}
