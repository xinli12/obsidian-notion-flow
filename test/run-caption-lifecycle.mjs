import assert from 'node:assert/strict';
import { EditorState, EditorSelection, Facet, StateEffect, Transaction } from '@codemirror/state';
import { createCaptionEditingExtensions, ownedBlockCaption, buildBlockCaption } from './bundle.mjs';

const mode = Facet.define({ combine: values => values[0] ?? true });
let enabled = true;
const exts = createCaptionEditingExtensions({
  enabled: () => enabled,
  livePreview: state => state.facet(mode),
  captionAt: ownedBlockCaption,
});
const [filter, Cleanup] = exts;
const caption = buildBlockCaption('image', '', false, '', true);
const image = '![[image.png]]';
function stateFor(lines, live = true) {
  return EditorState.create({ doc: lines.join('\n'), extensions: [filter, mode.of(live), EditorState.allowMultipleSelections.of(true)] });
}
async function leave(lines, { beforeFlush, live = true, userEvent, secondary } = {}) {
  const clean = new Cleanup();
  let state = stateFor(lines, live);
  const body = state.doc.line(2).from + (ownedBlockCaption(state.doc, 2)?.bodyFrom ?? 0);
  state = state.update({ selection: { anchor: body } }).state;
  const target = state.doc.line(3).from;
  const selection = secondary ? EditorSelection.create([EditorSelection.cursor(body), EditorSelection.cursor(target)], 1) : { anchor: target };
  const tr = state.update({ selection, userEvent });
  const view = { state: tr.state, writes: [], dispatch(spec) { this.writes.push(spec); this.state = this.state.update(spec).state; } };
  clean.update({ view, startState: state, state: tr.state, changes: tr.changes, selectionSet: true, docChanged: false, transactions: [tr] });
  beforeFlush?.(view, clean);
  await Promise.resolve();
  return view;
}

assert.equal((await leave(['```html', caption, '```'])).state.doc.toString(), ['```html', caption, '```'].join('\n'));
assert.equal((await leave(['orphan', caption, 'tail'])).writes.length, 0);
assert.equal((await leave([image, caption, 'tail'], { live: false })).writes.length, 0);
assert.equal((await leave([image, caption, 'tail'], { secondary: true })).writes.length, 0);
assert.equal((await leave([image, caption, 'tail'], { userEvent: 'undo' })).writes.length, 0);
assert.equal((await leave([image, caption, 'tail'], { userEvent: 'redo' })).writes.length, 0);
const normal = await leave([image, caption, 'tail']);
assert.equal(normal.state.doc.toString(), image + '\ntail');
assert.equal(normal.writes[0].annotations.type, Transaction.addToHistory);
assert.equal(normal.writes[0].annotations.value, false);
assert.equal((await leave([image, buildBlockCaption('image', 'keep'), 'tail'])).writes.length, 0);
assert.equal((await leave([image, caption, 'tail'], { beforeFlush: (_v, c) => c.destroy() })).writes.length, 0);
const edited = await leave([image, caption, 'tail'], { beforeFlush: v => { v.state = v.state.update({ changes: { from: 3, insert: 'long-' } }).state; } });
assert.equal(edited.state.doc.toString(), '![[long-image.png]]\n' + caption + '\ntail');
const returned = await leave([image, caption, 'tail'], { beforeFlush: v => { v.state = v.state.update({ selection: { anchor: v.state.doc.line(2).from } }).state; } });
assert.equal(returned.writes.length, 0);
const replaced = await leave([image, caption, 'tail'], { beforeFlush: v => { v.state = stateFor([image, caption, 'different note']); } });
assert.equal(replaced.writes.length, 0);
const disabled = await leave([image, caption, 'tail'], { beforeFlush: () => { enabled = false; } });
assert.equal(disabled.writes.length, 0);
enabled = true;

for (const live of [true, false]) {
  let state = stateFor([image, caption, 'tail'], live);
  const from = state.doc.line(2).from;
  const expected = from + (live ? ownedBlockCaption(state.doc, 2).bodyFrom : 0);
  assert.equal(state.update({ selection: { anchor: from } }).state.selection.main.head, expected);
  if (live) {
    state = state.update({ effects: StateEffect.reconfigure.of([filter, mode.of(false)]), selection: { anchor: from } }).state;
    assert.equal(state.selection.main.head, from, 'switching to source preserves source cursor');
  }
}
const code = stateFor(['```html', caption, '```']);
assert.equal(code.update({ selection: { anchor: code.doc.line(2).from } }).state.selection.main.head, code.doc.line(2).from);
for (const [lines, lineNo, expected] of [
  [['```js', 'x', '```', buildBlockCaption('code', '', true)], 4, 1],
  [['```js', 'x', '  ```', buildBlockCaption('code', 'caption')], 4, 1],
  [['  ```js', '  x', '   ```', buildBlockCaption('code', 'caption', false, '  ')], 4, 1],
  [['> ![[image.png]]', '> ' + caption], 2, 1],
  [['> ![[image.png]]', caption], 2, null],
  [['| a |', '| --- |', buildBlockCaption('table', 'caption')], 3, 1],
  [['```md', image, caption, '```'], 3, null],
]) {
  assert.equal(ownedBlockCaption(stateFor(lines).doc, lineNo)?.ownerLine ?? null, expected);
}
/* ---- the caption keymap: Enter leaves, edge keys keep the tags ---- */
const keyExt = exts[2];
const bindings = keyExt.inner ?? keyExt;
const binding = key => bindings.find(b => b.key === key);
const enter = binding('Enter');
const backspace = binding('Backspace');
const del = binding('Delete');
const down = binding('ArrowDown');
assert.equal(exts.length, 4, 'filter, cleanup, keymap, delete clamp');
assert.equal(enter.shift, enter.run, 'Shift+Enter leaves a caption the same way');

/** A fake view on `lines` with the caret on `lineNo`: at the caption body's
 * 'start', 'mid' or 'end', or at a column. */
function viewAt(lines, lineNo, at, { live = true, dom, ranges } = {}) {
  let state = stateFor(lines, live);
  const line = state.doc.line(lineNo);
  const cap = ownedBlockCaption(state.doc, lineNo);
  const pos = typeof at === 'number' ? line.from + at
    : at === 'start' ? line.from + cap.bodyFrom
    : at === 'end' ? line.from + cap.bodyTo
    : line.from + Math.floor((cap.bodyFrom + cap.bodyTo) / 2);
  state = state.update({ selection: ranges ? EditorSelection.create(ranges(state, pos), 0) : { anchor: pos } }).state;
  return { state, dom, composing: false, writes: [], dispatch(spec) { this.writes.push(spec); this.state = this.state.update(spec).state; } };
}
const lines = view => view.state.doc.toString().split('\n');
const caretAt = view => {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  return [line.number, head - line.from];
};

const cases = [
  ['image', [image], ''],
  ['image quoted', ['> ' + image], '> '],
  ['table', ['| a |', '| --- |', '| 1 |'], ''],
  ['table quoted', ['> | a |', '> | --- |', '> | 1 |'], '> '],
  ['code', ['```js', 'x', '```'], ''],
  ['code quoted', ['> ```js', '> x', '> ```'], '> '],
];
for (const [name, owner, prefix] of cases) {
  const kind = name.split(' ')[0];
  const row = buildBlockCaption(kind, 'Cap', false, prefix);
  const tail = prefix + 'tail';
  const capLine = owner.length + 1;
  assert.ok(ownedBlockCaption(stateFor([...owner, row]).doc, capLine), `${name}: the caption is owned`);
  for (const [how, at, key] of [['Enter at end', 'end', 'run'], ['Shift+Enter', 'end', 'shift'], ['Enter mid-caption', 'mid', 'run']]) {
    const view = viewAt([...owner, row, tail], capLine, at);
    assert.equal(enter[key](view), true, `${name} / ${how}: handled`);
    assert.deepEqual(lines(view), [...owner, row, prefix, tail], `${name} / ${how}: the row stays, one "${prefix}" row follows`);
    assert.deepEqual(caretAt(view), [capLine + 1, prefix.length], `${name} / ${how}: caret at the end of the new row`);
    assert.equal(view.writes[0].userEvent, 'input', `${name} / ${how}: not input.type, so no typing rule fires`);
    assert.equal(view.writes[0].scrollIntoView, true);
  }
}
const cap = buildBlockCaption('image', 'Cap');
const quotedCap = buildBlockCaption('image', 'Cap', false, '> ');
{
  const view = viewAt([image, cap, '', 'tail'], 2, 'end');
  assert.equal(enter.run(view), true);
  assert.deepEqual(lines(view), [image, cap, '', 'tail'], 'a blank next line is reused, nothing inserted');
  assert.deepEqual(caretAt(view), [3, 0]);
  assert.equal(view.writes[0].userEvent, 'select');
}
{
  const view = viewAt(['> ' + image, quotedCap, '>', '> tail'], 2, 'end');
  enter.run(view);
  assert.deepEqual(lines(view), ['> ' + image, quotedCap, '> ', '> tail'], 'a bare ">" is completed to the prefix');
  assert.deepEqual(caretAt(view), [3, 2]);
}
{
  const view = viewAt(['> ' + image, quotedCap, '', 'tail'], 2, 'end');
  enter.run(view);
  assert.deepEqual(lines(view), ['> ' + image, quotedCap, '> ', '', 'tail'], 'a blank line outside the quote is not the quote\'s');
  assert.deepEqual(caretAt(view), [3, 2]);
}
{
  const view = viewAt([image, cap], 2, 'end');
  enter.run(view);
  assert.deepEqual(lines(view), [image, cap, ''], 'the last line gets a row below');
  assert.deepEqual(caretAt(view), [3, 0]);
}
{
  const folded = buildBlockCaption('code', 'L', true);
  const view = viewAt(['```js', 'x', '```', folded, 'tail'], 4, 'end');
  assert.equal(enter.run(view), true);
  assert.deepEqual(lines(view), ['```js', 'x', '```', folded, '', 'tail'], 'a collapsed code caption exits too');
  assert.ok(lines(view)[3].includes('data-nf-collapsed="true"'), 'and keeps its fold');
}
for (const [why, view] of [
  ['source mode', viewAt([image, cap, 'tail'], 2, 'end', { live: false })],
  ['an orphan caption', viewAt(['orphan', cap, 'tail'], 2, 20)],
  ['a caption inside a fence', viewAt(['```md', image, cap, '```'], 3, 20)],
  ['a plain line', viewAt([image, cap, 'tail'], 3, 2)],
]) {
  for (const b of [enter, backspace, del, down]) assert.equal(b.run(view), false, `${why}: ${b.key} keeps the default`);
  assert.equal(view.writes.length, 0);
}
enabled = false;
{
  const view = viewAt([image, cap, 'tail'], 2, 'end');
  assert.equal(enter.run(view), false, 'caption editing off: the default Enter');
}
enabled = true;
{
  const suggesting = { ownerDocument: { querySelector: sel => (sel === '.suggestion-container' ? {} : null) } };
  const view = viewAt([image, cap, 'tail'], 2, 'end', { dom: suggesting });
  assert.equal(enter.run(view), false, 'an open suggester takes Enter');
  assert.equal(down.run(view), false, 'and ArrowDown');
  assert.equal(view.writes.length, 0);
}
{
  const view = viewAt([image, cap, 'tail'], 2, 'end', {
    ranges: (state, pos) => [EditorSelection.cursor(pos), EditorSelection.cursor(state.doc.line(3).to)],
  });
  assert.equal(view.state.selection.ranges.length, 2);
  assert.equal(enter.run(view), true, 'several cursors, one in a caption: Enter is swallowed');
  assert.equal(view.writes.length, 0);
}
{
  const empty = buildBlockCaption('image', '', false, '', true);
  const view = viewAt([image, empty, 'tail'], 2, 'start');
  assert.equal(backspace.run(view), true);
  assert.deepEqual(lines(view), [image, 'tail'], 'Backspace on an empty caption cancels it');
  assert.deepEqual(caretAt(view), [1, image.length], 'the caret returns to the end of its block');
  assert.equal(view.writes[0].userEvent, 'delete.block-caption');
  assert.equal(view.writes[0].annotations, undefined, 'a user action: it stays undoable');
}
/* w1c-table-caption-cancel-bytes: a cancelled table caption must not leave
   the caret at the end of the last row, where Obsidian's table editor
   focuses that cell and re-pads the source. */
{
  const empty = buildBlockCaption('table', '', false, '', true);
  const table = ['| 1 | 2 |', '| - | - |', '| a | b |'];
  const view = viewAt([...table, empty, '', 'next'], 4, 'start');
  assert.equal(backspace.run(view), true);
  assert.deepEqual(lines(view), [...table, '', 'next'], 'table caption cancel: the note is back to its bytes');
  assert.deepEqual(caretAt(view), [4, 0], 'the caret lands on the line after the table, not in its last row');
  const glued = viewAt([...table, empty, 'next'], 4, 'start');
  backspace.run(glued);
  assert.deepEqual(caretAt(glued), [4, 0], 'a line right after the table: its start');
  const quotedEmpty = buildBlockCaption('table', '', false, '> ', true);
  const quoted = viewAt(['> [!note] T', ...table.map((r) => '> ' + r), quotedEmpty, '> tail'], 5, 'start');
  backspace.run(quoted);
  assert.deepEqual(lines(quoted), ['> [!note] T', ...table.map((r) => '> ' + r), '> tail'], 'quoted table: the row goes');
  assert.deepEqual(caretAt(quoted), [5, 2], 'past the quote marker of the line after the table');
  const last = viewAt([...table, empty], 4, 'start');
  backspace.run(last);
  assert.deepEqual(lines(last), table, 'the table ends the note: the row goes');
  assert.deepEqual(caretAt(last), [3, table[2].length], 'nothing after the table: the end of its last row, as before');
}
{
  const view = viewAt([image, cap, 'tail'], 2, 'start');
  assert.equal(backspace.run(view), true, 'Backspace at the start of a written caption is swallowed');
  assert.deepEqual(lines(view), [image, cap, 'tail']);
  assert.equal(view.writes.length, 0);
  assert.equal(backspace.run(viewAt([image, cap, 'tail'], 2, 'end')), false, 'inside the text: ordinary Backspace');
  const folded = buildBlockCaption('code', '', true);
  const code = viewAt(['```js', 'x', '```', folded], 4, 'start');
  assert.equal(backspace.run(code), true, 'an empty collapsed code caption holds the fold');
  assert.deepEqual(lines(code), ['```js', 'x', '```', folded]);
  assert.equal(code.writes.length, 0);
}
{
  const view = viewAt([image, cap, 'tail'], 2, 'end');
  assert.equal(del.run(view), true, 'Delete at the end of a caption keeps </small>');
  assert.deepEqual(lines(view), [image, cap, 'tail']);
  assert.equal(del.run(viewAt([image, cap, 'tail'], 2, 'start')), false, 'Delete inside the text is ordinary');
}
{
  const view = viewAt([image, cap, 'tail'], 2, 'end');
  assert.equal(down.run(view), true);
  assert.deepEqual(caretAt(view), [3, 0], 'ArrowDown goes to the start of the next line');
  assert.equal(view.writes[0].userEvent, 'select');
  const quoted = viewAt(['> ' + image, quotedCap, '> more'], 2, 'end');
  down.run(quoted);
  assert.deepEqual(caretAt(quoted), [3, 2], 'past the quote marker');
  assert.equal(down.run(viewAt([image, cap, '```js', 'x', '```'], 2, 'end')), false, 'a widget line keeps the default motion');
  assert.equal(down.run(viewAt([image, cap], 2, 'end')), false, 'no line below: the default');
  assert.equal(down.run(viewAt([image, cap, 'tail'], 2, 'mid')), false, 'mid-caption: the default');
}

/* Lines without the caption class never reach captionAt (and its fence scan). */
{
  let calls = 0;
  const [spyFilter, SpyCleanup, spyKeys] = createCaptionEditingExtensions({
    enabled: () => true,
    livePreview: state => state.facet(mode),
    captionAt: (doc, n) => { calls++; return ownedBlockCaption(doc, n); },
  });
  const spyBindings = spyKeys.inner ?? spyKeys;
  let state = EditorState.create({
    doc: [image, cap, 'plain one', 'plain two'].join('\n'),
    extensions: [spyFilter, mode.of(true)],
  });
  state = state.update({ selection: { anchor: state.doc.line(3).from } }).state;
  state = state.update({ selection: { anchor: state.doc.line(4).from } }).state;
  const three = state.doc.line(3);
  state = state.update({ changes: { from: three.to, insert: 'x' }, selection: { anchor: three.to + 1 }, userEvent: 'input.type' }).state;
  const tr = state.update({ selection: { anchor: state.doc.line(4).from } });
  const clean = new SpyCleanup();
  const fake = { state: tr.state, composing: false, writes: [], dispatch(spec) { this.writes.push(spec); this.state = this.state.update(spec).state; } };
  clean.update({ view: fake, startState: state, state: tr.state, changes: tr.changes, selectionSet: true, docChanged: false, transactions: [tr] });
  fake.state = state;
  for (const key of ['Enter', 'Backspace', 'Delete', 'ArrowDown']) {
    assert.equal(spyBindings.find(b => b.key === key).run(fake), false, `${key} on a plain line`);
  }
  await Promise.resolve();
  assert.equal(calls, 0, 'captionAt is never asked about a line without nf-caption');
  state.update({ selection: { anchor: state.doc.line(2).from } });
  assert.ok(calls > 0, 'a caption line is still looked up');
}
/* ---- w1c: word and line deletions stay inside the caption text ---- */
{
  const clamp = exts[3];
  const owners = {
    code: ['```js', 'x', '```'],
    table: ['| a |', '| --- |', '| 1 |'],
    image: [image],
  };
  const clampState = (lines, live = true) =>
    EditorState.create({ doc: lines.join('\n'), extensions: [filter, clamp, mode.of(live), EditorState.allowMultipleSelections.of(true)] });
  /** Run a deletion of [from, to) (line-relative on the caption row, or
   * 'start'/'end' for the caption body's edges) with `userEvent`. */
  const del = (lines, capLine, from, to, userEvent, caret, live = true) => {
    let state = clampState(lines, live);
    const line = state.doc.line(capLine);
    const cap = ownedBlockCaption(state.doc, capLine);
    const abs = (x) => line.from + (x === 'start' ? cap.bodyFrom : x === 'end' ? cap.bodyTo : x === 'lineEnd' ? line.length : x);
    state = state.update({ selection: { anchor: abs(caret) } }).state;
    const tr = state.update({ changes: { from: abs(from), to: abs(to) }, selection: { anchor: abs(from) }, userEvent });
    const head = tr.state.selection.main.head;
    return { text: tr.state.doc.toString(), head: head - tr.state.doc.line(capLine).from };
  };
  for (const [kind, owner] of Object.entries(owners)) {
    const row = buildBlockCaption(kind, 'Table one caption', false);
    const lines = [...owner, row, 'tail'];
    const capLine = owner.length + 1;
    const cap = ownedBlockCaption(clampState(lines).doc, capLine);
    const doc0 = lines.join('\n');
    // Alt+Backspace / Mod+Backspace at the body start: CodeMirror extends over the atomic <small …> tag.
    for (const ev of ['delete.backward', 'delete.group.backward']) {
      const r = del(lines, capLine, 0, 'start', ev, 'start');
      assert.equal(r.text, doc0, `${kind}: ${ev} at the caption start changes nothing`);
      assert.equal(r.head, cap.bodyFrom, `${kind}: …and the caret stays at the caption start`);
    }
    // Alt+Delete / Mod+Delete at the body end: over the atomic </small>.
    const endDel = del(lines, capLine, 'end', 'lineEnd', 'delete.forward', 'end');
    assert.equal(endDel.text, doc0, `${kind}: a forward word/line delete at the caption end changes nothing`);
    // Mid-body word delete: "Table one| caption" → deletes "one".
    const wordFrom = cap.bodyFrom + 'Table '.length, wordTo = cap.bodyFrom + 'Table one'.length;
    const mid = del(lines, capLine, wordFrom, wordTo, 'delete.backward', wordTo);
    assert.equal(mid.text, [...owner, buildBlockCaption(kind, 'Table  caption', false), 'tail'].join('\n'), `${kind}: a mid-caption word delete removes only that word`);
    // Mod+Backspace mid-body: the line-start deletion keeps the opening tag.
    const lineStart = del(lines, capLine, 0, wordTo, 'delete.backward', wordTo);
    assert.equal(lineStart.text, [...owner, row.slice(0, cap.bodyFrom) + row.slice(wordTo), 'tail'].join('\n'), `${kind}: a line-start delete stops at the caption text`);
    assert.equal(lineStart.head, cap.bodyFrom, `${kind}: …with the caret at the caption start`);
    // A full-row cut is not half-written markup: it stays whole.
    const cut = del(lines, capLine, 0, 'lineEnd', 'delete.cut', 'start');
    assert.equal(cut.text, [...owner, '', 'tail'].join('\n'), `${kind}: cutting the whole row still removes it`);
    // Source mode shows the tags: nothing is clamped there.
    const source = del(lines, capLine, 0, 'start', 'delete.backward', 'start', false);
    assert.notEqual(source.text, doc0, `${kind}: source mode deletes what it is asked to`);
  }
  {
    // "Add caption" then Backspace still removes the whole empty row.
    const empty = buildBlockCaption('image', '', false, '', true);
    const view = viewAt([image, empty, 'tail'], 2, 'start');
    view.state = EditorState.create({ doc: view.state.doc, selection: view.state.selection, extensions: [filter, clamp, mode.of(true)] });
    assert.equal(backspace.run(view), true);
    assert.deepEqual(lines(view), [image, 'tail'], 'delete.block-caption is never clamped');
  }
  {
    // A quoted caption keeps its prefix and tags too.
    const quoted = ['> ' + image, buildBlockCaption('image', 'Cap', false, '> '), '> tail'];
    const r = del(quoted, 2, 0, 'start', 'delete.backward', 'start');
    assert.equal(r.text, quoted.join('\n'), 'a quoted caption: the line-start delete keeps "> <small…>"');
  }
  {
    // A deletion that joins lines is not a caption-row edit: untouched.
    let state = clampState([image, cap, 'tail']);
    const line = state.doc.line(3);
    const tr = state.update({ changes: { from: line.from - 1, to: line.from }, userEvent: 'delete.backward' });
    assert.equal(tr.state.doc.toString(), [image, cap + 'tail'].join('\n'), 'a join across rows is left to the other guards');
    // Undo is never clamped.
    const undo = state.update({ changes: { from: state.doc.line(2).from, to: state.doc.line(2).from + 5 }, userEvent: 'undo' });
    assert.equal(undo.state.doc.line(2).text, cap.slice(5), 'undo passes through');
  }
  {
    // review3-MODS-5: a second cursor elsewhere does not lift the clamp. Each
    // deleted range is clamped on its own; the other cursor's range stays.
    const row = buildBlockCaption('image', 'My caption', false);
    const lines = [image, row, 'plain words'];
    let state = clampState(lines);
    const capRow = state.doc.line(2), next = state.doc.line(3), prev = state.doc.line(1);
    const bodyFrom = capRow.from + ownedBlockCaption(state.doc, 2).bodyFrom;
    const multi = (ranges, changes, userEvent = 'delete.group.backward') => {
      const s = state.update({ selection: EditorSelection.create(ranges.map((p) => EditorSelection.cursor(p)), 0) }).state;
      return s.update({ changes, userEvent });
    };
    // Alt+Backspace: the caption cursor would take "<small …>", the other the word "words".
    let tr = multi([bodyFrom, next.to], [{ from: capRow.from, to: bodyFrom }, { from: next.to - 'words'.length, to: next.to }]);
    assert.equal(tr.state.doc.toString(), [image, row, 'plain '].join('\n'), 'MODS-5: with a second cursor below, the <small> tag stays and only the other word goes');
    assert.deepEqual(tr.state.selection.ranges.map((r) => r.head), [bodyFrom, tr.state.doc.length], 'MODS-5: …each cursor where its deletion ends');
    // The second cursor on the line above instead.
    tr = multi([prev.from + 'image'.length + 3, bodyFrom], [{ from: prev.from + 3, to: prev.from + 3 + 'image'.length }, { from: capRow.from, to: bodyFrom }]);
    assert.equal(tr.state.doc.toString(), ['![[.png]]', row, 'plain words'].join('\n'), 'MODS-5: with a second cursor above, the tag stays too');
    // Mod+Backspace mid-caption with a second cursor: stops at the caption text.
    const mid = bodyFrom + 'My'.length;
    tr = multi([mid, next.to], [{ from: capRow.from, to: mid }, { from: next.from, to: next.to }], 'delete.backward');
    assert.equal(tr.state.doc.toString(), [image, row.replace('>My caption', '> caption'), ''].join('\n'), 'MODS-5: a line delete keeps the opening tag with another cursor too');
    // Alt+Delete at the caption's end with a second cursor.
    const bodyTo = capRow.from + ownedBlockCaption(state.doc, 2).bodyTo;
    tr = multi([bodyTo, next.from], [{ from: bodyTo, to: capRow.to }, { from: next.from, to: next.from + 'plain'.length }], 'delete.group.forward');
    assert.equal(tr.state.doc.toString(), [image, row, ' words'].join('\n'), 'MODS-5: the closing tag stays with another cursor');
    // Two cursors off caption rows: nothing to clamp, the transaction runs as is.
    tr = multi([prev.to, next.to], [{ from: prev.to - 2, to: prev.to }, { from: next.to - 5, to: next.to }]);
    assert.equal(tr.state.doc.toString(), [image.slice(0, -2), row, 'plain '].join('\n'), 'MODS-5: deletions away from captions pass through');
  }
}
console.log('PASS caption lifecycle: literal code, ownership, source mode, concurrent edits, multi-cursor, undo/redo, disposal, the Enter/Backspace/Delete/ArrowDown keymap, and clamped word/line deletions');
