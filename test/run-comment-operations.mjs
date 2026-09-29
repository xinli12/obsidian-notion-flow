import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { CommentController, CommentPopover, EditorOperationScope, operationLifecycle } from "./features.mjs";

// Small event-capable DOM fixture: exercise the actual popover handlers,
// controller and real CodeMirror transactions, rather than source strings.
class Element extends EventTarget {
  constructor(doc, tag, options = {}) {
    super(); this.doc = doc; this.tag = tag; this.options = options;
    this.style = {}; this.value = ""; this.scrollHeight = 50;
    this.offsetWidth = 320; this.offsetHeight = 150; this.children = [];
    doc.elements.push(this);
  }
  createEl(tag, options = {}) { const el = new Element(this.doc, tag, options); this.children.push(el); return el; }
  createDiv(options) { return this.createEl("div", options); }
  createSpan(options) { return this.createEl("span", options); }
  setAttribute(name, value) { (this.attrs ??= {})[name] = value; }
  focus() { this.doc.activeElement = this; }
  setSelectionRange() {}
  remove() { this.removed = true; }
}
function fixture(source = "SAME TEXT in A") {
  const doc = Object.assign(new EventTarget(), { elements: [] });
  doc.defaultView = Object.assign(new EventTarget(), { innerWidth: 1200, innerHeight: 900 });
  doc.body = new Element(doc, "body");
  let state = EditorState.create({ doc: source, selection: { anchor: 0, head: 9 } });
  const f = { file: "A.md", enabled: true, writes: 0, doc };
  f.view = {
    get state() { return state; }, dom: { ownerDocument: doc, isConnected: true },
    coordsAtPos() { return { left: 50, top: 100, bottom: 120 }; }, focus() {},
    dispatch(spec) { state = state.update(spec).state; f.writes++; f.lifecycle.update(); },
  };
  f.replace = (text) => { state = EditorState.create({ doc: text }); };
  f.operations = new EditorOperationScope();
  f.lifecycle = new (operationLifecycle(f.operations))(f.view);
  f.comments = new CommentController({ operations: f.operations, identity: () => f.file, enabled: () => f.enabled });
  f.card = () => doc.elements.filter((el) => el.options.cls === "nf-cmt-pop").at(-1);
  f.input = () => doc.elements.filter((el) => el.tag === "textarea").at(-1);
  f.key = (key, extra = {}) => {
    const event = new Event("keydown", { cancelable: true });
    Object.assign(event, { key, ...extra });
    f.input().dispatchEvent(event);
  };
  return f;
}
for (const [name, invalidate] of [
  ["file changed with identical text", (f) => { f.file = "B.md"; }],
  ["document replaced", (f) => f.replace("SAME TEXT in B")],
  ["editor disconnected", (f) => { f.view.dom.isConnected = false; }],
  ["comments disabled", (f) => { f.enabled = false; }],
  ["plugin unloaded", (f) => f.operations.dispose()],
  ["editor destroyed", (f) => f.lifecycle.destroy()],
]) {
  const f = fixture(); f.comments.add(f.view); f.input().value = "Only for A";
  invalidate(f); f.operations.check();
  assert.equal(f.card().removed, true, `${name}: popover closes`);
  f.key("Enter");
  assert.equal(f.writes, 0, `${name}: stale event cannot write`);
}
{
  const f = fixture(); f.comments.add(f.view); f.input().value = "新批注";
  f.key("Enter", { isComposing: true }); assert.equal(f.writes, 0);
  const inside = new Event("mousedown");
  inside.composedPath = () => [f.input(), f.card(), f.doc];
  f.doc.dispatchEvent(inside);
  assert.equal(f.card().removed, undefined, "inside click keeps the card open across DOM realms");
  f.key("Enter");
  assert.equal(f.writes, 1);
  assert.equal(f.view.state.doc.toString(), '<span class="nf-cmt" data-nf-cmt="新批注">SAME TEXT</span> in A');
}
for (const action of ["Escape", "outside"]) {
  const f = fixture(); f.comments.add(f.view); f.input().value = "draft";
  if (action === "outside") f.doc.dispatchEvent(new Event("mousedown")); else f.key(action);
  assert.equal(f.writes, action === "outside" ? 1 : 0);
  assert.equal(f.card().removed, true);
}
for (const stale of [false, true]) {
  const f = fixture('<span class="nf-cmt" data-nf-cmt="old">SAME TEXT</span>');
  f.comments.open(f.view, 38);
  const resolve = f.doc.elements.find((el) => el.tag === "button" && el.options.cls?.includes("nf-cmt-pop-resolve"));
  // Icon-only: the check glyph, named by its tooltip.
  assert.equal(resolve.options.cls, "clickable-icon nf-cmt-pop-resolve");
  assert.equal(resolve.options.attr["aria-label"], "Resolve");
  assert.equal(resolve.options.text, undefined);
  assert.equal(resolve.children.length, 0, "no label span");
  if (stale) f.file = "B.md";
  resolve.dispatchEvent(new Event("click"));
  assert.equal(f.writes, stale ? 0 : 1);
  if (!stale) assert.equal(f.view.state.doc.toString(), "SAME TEXT");
}
{
  // One short hint line.
  const f = fixture(); f.comments.add(f.view);
  assert.equal(f.doc.elements.find((el) => el.options.cls === "nf-cmt-hint").options.text, "↵ Save · ⇧↵ New line");
}
{
  // The card stays in the note's pane (.view-content), not merely the window.
  const pane = (box) => (selector) => (selector === ".view-content" ? { getBoundingClientRect: () => box } : null);
  const short = { left: 0, top: 0, right: 1200, bottom: 200 };
  const f = fixture(); f.view.dom.closest = pane(short); f.comments.add(f.view);
  assert.equal(f.card().attrs["data-placement"], "above", "no room below inside the pane");
  assert.equal(f.card().style.top, "8px", "clamped to the pane's top");
  assert.equal(f.card().style.left, "38px");
  const g = fixture(); g.comments.add(g.view);
  assert.equal(g.card().style.top, "128px", "no pane: the window");
  assert.equal(g.card().attrs["data-placement"], "below");
  // A caller's bounds win over the pane lookup.
  const h = fixture(); h.view.dom.closest = pane(short);
  const pop = new CommentPopover(h.view, 0, null, () => {}, null, {
    isCurrent: () => true, onClose() {}, bounds: () => ({ left: 0, top: 0, right: 1200, bottom: 900 }),
  });
  pop.open();
  assert.equal(h.card().style.top, "128px", "lifecycle.bounds overrides the pane");
  assert.equal(h.card().attrs["data-placement"], "below");
  pop.close();
  // Without coordinates the card keeps to the editor's corner, inside the pane.
  const k = fixture(); k.view.dom.closest = pane({ left: 100, top: 300, right: 900, bottom: 800 });
  k.view.dom.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1200, bottom: 900 });
  k.view.coordsAtPos = () => null;
  k.comments.add(k.view);
  assert.equal(k.card().style.left, "108px");
  assert.equal(k.card().style.top, "308px");
}
console.log("PASS comments: save, cancel, outside/inside clicks, IME, resolve, file identity and editor/plugin teardown");
