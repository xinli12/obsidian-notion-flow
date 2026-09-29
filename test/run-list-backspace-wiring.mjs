import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { listMarkerBackspace, makeMarkerBackspaceKeymap, DEFAULT_SETTINGS } from "./bundle.mjs";

/** A stand-in for EditorView: the state plus a dispatch that applies it,
 * the way test/run15.mjs drives plans through a stub. */
function fakeView(doc, head) {
  const view = { state: EditorState.create({ doc, selection: { anchor: head } }) };
  view.dispatch = (spec) => {
    view.last = spec;
    view.state = view.state.update(spec).state;
  };
  return view;
}

// Backspace right after "- [ ] " empties the line in one step.
let view = fakeView("- [ ] ", 6);
assert.equal(listMarkerBackspace(view), true);
assert.equal(view.state.doc.toString(), "");
assert.equal(view.state.selection.main.head, 0);
assert.equal(view.last.userEvent, "delete");

// A bullet with text keeps the text at its depth; nesting and quote markers stay.
view = fakeView("  - task", 4);
assert.equal(listMarkerBackspace(view), true);
assert.equal(view.state.doc.toString(), "  task");
assert.equal(view.state.selection.main.head, 2);
view = fakeView("> 1. numbered", 5);
assert.equal(listMarkerBackspace(view), true);
assert.equal(view.state.doc.toString(), "> numbered");

// Elsewhere on the line, nothing happens.
view = fakeView("- item", 6);
assert.equal(listMarkerBackspace(view), false);
assert.equal(view.state.doc.toString(), "- item");
view = fakeView("- item", 0);
assert.equal(listMarkerBackspace(view), false);

// Not for code, table rows, column scaffolding, or a non-empty selection.
view = fakeView("```\n- code\n```", 6);
assert.equal(listMarkerBackspace(view), false);
view = fakeView("| - | b |", 4);
assert.equal(listMarkerBackspace(view), false);
view = fakeView("> [!nf-col]", 2);
assert.equal(listMarkerBackspace(view), false);
view = { state: EditorState.create({ doc: "- item", selection: { anchor: 2, head: 4 } }), dispatch() { throw new Error("must not dispatch"); } };
assert.equal(listMarkerBackspace(view), false);
console.log("PASS list backspace wiring: marker ladder, depth kept, code/table/scaffold/selection untouched");

/* The keymap the note and a column's child editor share. The stub's
 * keymap.of returns its bindings; Prec.highest wraps them. */
{
  const bindingsOf = (ext) => {
    const inner = ext.inner ?? ext;
    return Array.isArray(inner) ? inner : [inner];
  };
  const pluginWith = (settings) => ({ settings: { ...DEFAULT_SETTINGS, ...settings } });
  const backspace = (plugin, headingMarkers, doc, head) => {
    const [binding] = bindingsOf(makeMarkerBackspaceKeymap(plugin, { headingMarkers }));
    assert.equal(binding.key, "Backspace");
    const view = fakeView(doc, head);
    return { handled: binding.run(view), text: view.state.doc.toString(), head: view.state.selection.main.head };
  };
  const on = pluginWith({ markerBackspace: true, concealHeadings: true });
  // The list ladder in both flavours: "- " then Backspace empties the line.
  for (const headingMarkers of [true, false]) {
    const r = backspace(on, headingMarkers, "- ", 2);
    assert.deepEqual([r.handled, r.text, r.head], [true, "", 0], `list marker, headingMarkers=${headingMarkers}`);
  }
  // R2-W2-MAIN item 20: the markers setting takes a visible "## " whole
  // too (core would leave "##x"), in a column editor (headingMarkers:false,
  // nothing concealed there) as in the note.
  let r = backspace(on, false, "## x", 3);
  assert.deepEqual([r.handled, r.text, r.head], [true, "x", 0], "visible heading marker goes whole in a column");
  // The note (headingMarkers:true) takes a concealed marker whole.
  r = backspace(on, true, "## x", 3);
  assert.deepEqual([r.handled, r.text, r.head], [true, "x", 0], "concealed heading marker goes in one step");
  // …and a visible one while the markers setting is on.
  r = backspace(pluginWith({ markerBackspace: true, concealHeadings: false }), true, "## x", 3);
  assert.deepEqual([r.handled, r.text], [true, "x"], "markers setting: a visible heading marker goes whole");
  // Concealed with the markers setting off: still whole (the only way back).
  r = backspace(pluginWith({ markerBackspace: false, concealHeadings: true }), true, "## x", 3);
  assert.deepEqual([r.handled, r.text], [true, "x"], "concealed marker without the markers setting");
  // A column with the markers setting off leaves a visible "## " to core.
  r = backspace(pluginWith({ markerBackspace: false, concealHeadings: true }), false, "## x", 3);
  assert.deepEqual([r.handled, r.text], [false, "## x"], "column, markers off: core's Backspace");
  // Both settings off: nothing is handled.
  r = backspace(pluginWith({ markerBackspace: false, concealHeadings: false }), true, "- x", 2);
  assert.deepEqual([r.handled, r.text], [false, "- x"], "both settings off");
  r = backspace(pluginWith({ markerBackspace: false, concealHeadings: false }), true, "## x", 3);
  assert.deepEqual([r.handled, r.text], [false, "## x"], "both settings off: core's ##x");
  console.log("PASS marker backspace keymap: list ladder in both editors; a heading marker goes whole when concealed or with the markers setting");
}
