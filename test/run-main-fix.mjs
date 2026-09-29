// Round 2, final fix pass (R2-W3-FIX): integration fixes after wave 3 and the
// remaining confirmed review findings. Each block names the item it covers.
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  makeCalloutEditPlugin,
  selectionEntersSpan,
  snapOutOfHiddenPrefix,
  hiddenPrefixLeftTarget,
  makeDragHandlePlugin,
  blockCaretAwayEffect,
  blockCaretAwayField,
  DEFAULT_SETTINGS,
  columnsEntryPlan,
  parseColumnsSource,
  columnInnerSource,
  widgetContainerFor,
  innerBlockAt,
  columnToggleBodyPlan,
  codeBlockUpPlan,
  lineFormatSegments,
  segmentsActive,
  toggleDualFormat,
  isDualFormatActive,
  applyTextColor,
  TEXT_COLORS,
  bindCaptionOwner,
  captionOwnedInSource,
} from "./bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) return;
  fail++;
  console.error(`FAIL ${name}${extra ? ` — ${extra}` : ""}`);
};

const ALL_ON = { calloutEditing: true, codeBlockEditing: true, toggleBlocks: true, columnLayout: true };

/** One build pass of the Callout edit plugin over `text` with `selection`. */
function editPass(text, anchor, head = anchor) {
  const state = EditorState.create({ doc: text, selection: { anchor, head } });
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: { clientWidth: 700, style: { setProperty() {} } },
    dom: { closest: (selector) => (String(selector).includes("is-live-preview") ? {} : null) },
  };
  const Plugin = makeCalloutEditPlugin({ settings: ALL_ON, app: {} });
  const instance = Object.create(Plugin.prototype);
  const ranges = [...instance.build.call(instance, view)];
  const hidden = [...instance.hidden].map((r) => [r.from, r.to]);
  return { state, instance, ranges, hidden };
}
const widgetsOn = (pass, n) => {
  const line = pass.state.doc.line(n);
  return pass.ranges
    .filter((r) => r.kind === "replace" && r.from >= line.from && r.to <= line.to && r.spec?.widget)
    .map((r) => r.spec.widget.constructor.name);
};

/* ---------- fix-toggle-title-marker: the triangle stays on the caret's header row ---------- */
{
  ok("selectionEntersSpan: a caret inside", selectionEntersSpan([{ anchor: 5, head: 5 }], 2, 16));
  ok("selectionEntersSpan: a caret at either edge is outside",
    !selectionEntersSpan([{ anchor: 2, head: 2 }], 2, 16) && !selectionEntersSpan([{ anchor: 16, head: 16 }], 2, 16));
  ok("selectionEntersSpan: a range sweeping over the span is outside", !selectionEntersSpan([{ anchor: 0, head: 30 }], 2, 16));
  ok("selectionEntersSpan: a range ending inside", selectionEntersSpan([{ anchor: 30, head: 9 }], 2, 16));
  ok("selectionEntersSpan: a range starting inside", selectionEntersSpan([{ anchor: 9, head: 30 }], 2, 16));
  ok("selectionEntersSpan: any of several ranges", selectionEntersSpan([{ anchor: 30, head: 30 }, { anchor: 3, head: 3 }], 2, 16));

  // What /toggle writes: an empty title, the caret at its end.
  const fresh = "Before\n\n> [!nf-toggle]+ ";
  const head = fresh.length;
  let pass = editPass(fresh, head);
  ok("fresh /toggle: the header shows the triangle with the caret on it", widgetsOn(pass, 3).includes("ToggleMarkWidget"),
    JSON.stringify(widgetsOn(pass, 3)));
  const line3 = pass.state.doc.line(3);
  ok("fresh /toggle: the gap and triangle are one atom up to the title",
    pass.hidden.some(([from, to]) => from === line3.from && to === line3.to), JSON.stringify(pass.hidden));
  ok("fresh /toggle: the header's markers are a zone ending at the title",
    pass.instance.zones.some((z) => z.from === line3.from && z.to === line3.to), JSON.stringify(pass.instance.zones));

  // Typing a title: the triangle stays at every step.
  let text = fresh;
  for (const ch of "Title") {
    text += ch;
    pass = editPass(text, text.length);
    ok(`typing "${text.slice(line3.from + 16)}": the triangle stays`, widgetsOn(pass, 3).includes("ToggleMarkWidget"));
  }
  // A collapsed header too.
  pass = editPass("> [!nf-toggle]- Folded\n> body", 18);
  ok("collapsed header with the caret on its title: the triangle stays", widgetsOn(pass, 1).includes("ToggleMarkWidget"));
  // A caret inside the token shows the source (and no atom or zone keeps it out).
  pass = editPass(text, line3.from + 6);
  ok("caret inside the token: the source is shown", !widgetsOn(pass, 3).includes("ToggleMarkWidget"));
  ok("caret inside the token: no header atom", !pass.hidden.some(([from]) => from === line3.from));
  ok("caret inside the token: no header zone", !pass.instance.zones.some((z) => z.from === line3.from));
  // A selection sweeping over the whole header keeps the triangle.
  pass = editPass(text, 0, text.length);
  ok("a sweep over the header keeps the triangle", widgetsOn(pass, 3).includes("ToggleMarkWidget"));

  // The header zone behaves as a body row's: a click at the row's left edge
  // lands on the title, and ArrowLeft from the title goes to the row above.
  pass = editPass(text, text.length);
  const snapped = snapOutOfHiddenPrefix(EditorSelection.single(line3.from), pass.instance.zones, pass.state.doc);
  ok("a caret at the header's line start snaps to the title", snapped?.main.head === line3.from + 16, JSON.stringify(snapped?.main));
  ok("ArrowLeft from the title goes to the row above",
    hiddenPrefixLeftTarget(pass.state.doc, line3.from + 16, pass.instance.zones) === pass.state.doc.line(2).to);

  // A nested toggle's header: the atom spans both markers and the token.
  const nested = "> [!note] Box\n> > [!nf-toggle]+ Inner\n> > body";
  pass = editPass(nested, nested.indexOf("Inner") + 2);
  const l2 = pass.state.doc.line(2);
  ok("nested header: the triangle stays with the caret on the title", widgetsOn(pass, 2).includes("ToggleMarkWidget"));
  ok("nested header: one atom from the row start to the title",
    pass.hidden.some(([from, to]) => from === l2.from && to === l2.from + "> > [!nf-toggle]+ ".length), JSON.stringify(pass.hidden));
  console.log("PASS fix-toggle-title-marker: the triangle stays on the caret's header row; source only inside the token");
}

/* ---------- review3-main2-2: every non-edit way out of a caret-away selection shows the caret ---------- */
class FakeEl extends EventTarget {
  constructor(doc, tag, opts = {}) {
    super();
    this.ownerDocument = doc; this.tagName = tag.toUpperCase(); this.children = []; this.parent = null;
    this.attrs = {}; this.classes = new Set(); this.textContent = opts.text ?? ""; this.value = "";
    this.style = { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } };
    this.classList = {
      add: (...c) => c.forEach((x) => this.classes.add(x)),
      remove: (...c) => c.forEach((x) => this.classes.delete(x)),
      toggle: (c, on) => { const v = on ?? !this.classes.has(c); if (v) this.classes.add(c); else this.classes.delete(c); return v; },
      contains: (c) => this.classes.has(c),
    };
    for (const c of String(opts.cls ?? "").split(/\s+/).filter(Boolean)) this.classes.add(c);
    for (const [k, v] of Object.entries(opts.attr ?? {})) this.attrs[k] = String(v);
  }
  createEl(tag, opts = {}) { const el = new FakeEl(this.ownerDocument, tag, opts); el.parent = this; this.children.push(el); return el; }
  createDiv(opts) { return this.createEl("div", opts); }
  createSpan(opts) { return this.createEl("span", opts); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addClass(...c) { c.forEach((x) => this.classes.add(x)); }
  removeClass(...c) { c.forEach((x) => this.classes.delete(x)); }
  toggleClass(c, on) { if (on) this.classes.add(c); else this.classes.delete(c); }
  setText(text) { this.textContent = text; }
  empty() { this.children = []; }
  remove() { this.removed = true; }
  closest() { return null; }
  contains(node) { for (let x = node; x; x = x.parent) if (x === this) return true; return false; }
  get isConnected() { return !this.removed; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 300, bottom: 40, width: 300, height: 40 }; }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
}
{
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const TEXT = "Intro\n\n> [!note] Box\n> body\n\nAfter";
  /** A DragHandleView over TEXT with a landed Callout selected and the caret kept away. */
  const landed = () => {
    const doc = Object.assign(new EventTarget(), { activeElement: null });
    doc.body = new FakeEl(doc, "body");
    doc.defaultView = Object.assign(new EventTarget(), {
      setTimeout, clearTimeout, innerWidth: 1280, innerHeight: 860,
      requestAnimationFrame: (cb) => setTimeout(cb, 0), cancelAnimationFrame: clearTimeout,
      getSelection: () => null, navigator: { clipboard: {} },
    });
    let state = EditorState.create({ doc: TEXT, extensions: [blockCaretAwayField] });
    const view = {
      get state() { return state; },
      dom: new FakeEl(doc, "div"), scrollDOM: new FakeEl(doc, "div"), contentDOM: new FakeEl(doc, "div"),
      hasFocus: true, composing: false,
      dispatch(spec) { state = state.update(spec).state; },
      focus() {},
      coordsAtPos: () => ({ left: 100, right: 110, top: 200, bottom: 220 }),
      posAtCoords: () => 0,
    };
    const leafRefs = [];
    const plugin = {
      settings: { ...DEFAULT_SETTINGS },
      operations: { capture: () => ({ isCurrent: () => true, finish() {}, cancel() {} }) },
      app: {
        workspace: {
          on: (name, fn) => { const ref = { name, fn }; leafRefs.push(ref); return ref; }, offref() {},
          getLeavesOfType: () => [], getLastOpenFiles: () => [],
        },
        vault: { getFiles: () => [], getConfig: () => false },
        metadataCache: { fileToLinktext: (file) => file.path, getFirstLinkpathDest: () => null },
      },
    };
    const DragHandle = makeDragHandlePlugin(plugin);
    const dh = new DragHandle(view);
    const block = { startLine: 3, endLine: 4 };
    dh.selectedBlocks = [block];
    view.dispatch({ effects: blockCaretAwayEffect.of(true) });
    const toolbar = doc.body.children.find((el) => el.classes.has("nf-block-selection-toolbar"));
    return { dh, view, doc, toolbar, leafRefs, away: () => view.state.field(blockCaretAwayField) };
  };
  const click = (el) => el.dispatchEvent(new Event("click", { cancelable: true }));

  let f = landed();
  ok("main2-2: control — the landing keeps the caret away", f.away() === true);
  const close = f.toolbar?.all().find((el) => el.classes.has("nf-block-selection-close"));
  ok("main2-2: the toolbar has its X", !!close);
  click(close);
  ok("main2-2: X ends the selection", f.dh.selectedBlocks.length === 0);
  ok("main2-2: X shows the caret again", f.away() === false);

  f = landed();
  f.dh.openMenuFor = () => { f.menuAway = f.away(); };
  const more = f.toolbar.all().find((el) => el.classes.has("nf-block-selection-more"));
  click(more);
  ok("main2-2: More (one block) shows the caret before its menu opens", f.menuAway === false && f.away() === false, String(f.menuAway));

  f = landed();
  f.dh.onWindowBlur();
  ok("main2-2: switching apps (window blur) shows the caret again", f.dh.selectedBlocks.length === 0 && f.away() === false);

  f = landed();
  ok("main2-2: the view listens for leaf changes", f.leafRefs.some((r) => r.name === "active-leaf-change"));
  f.leafRefs.find((r) => r.name === "active-leaf-change").fn();
  ok("main2-2: changing leaf shows the caret again", f.dh.selectedBlocks.length === 0 && f.away() === false);

  f = landed();
  f.view.hasFocus = false; // the command palette took focus
  f.dh.onEditorBlur();
  await sleep(5);
  ok("main2-2: the blur timer (palette opened, then cancelled) shows the caret again", f.dh.selectedBlocks.length === 0 && f.away() === false);

  f = landed();
  f.view.hasFocus = false;
  f.dh.onKeyDown({ key: "x", preventDefault() {}, stopPropagation() {} });
  ok("main2-2: a key meant for another pane (stale scope) shows the caret again", f.dh.selectedBlocks.length === 0 && f.away() === false);

  // No caret-away state: nothing is dispatched.
  f = landed();
  f.view.dispatch({ effects: blockCaretAwayEffect.of(false) });
  let dispatched = 0;
  const dispatch = f.view.dispatch;
  f.view.dispatch = (spec) => { dispatched++; dispatch(spec); };
  click(f.toolbar.all().find((el) => el.classes.has("nf-block-selection-close")));
  ok("main2-2: without the caret-away state X dispatches nothing", dispatched === 0, String(dispatched));
  console.log("PASS review3-main2-2: X, More, window blur, leaf change, blur timer and a stale key all show the caret again");
}

/* ---------- review3-main1-2: arrowing into a column never puts its caret on a fence row ---------- */
{
  const NOTE = ["Intro.", "", "> [!nf-cols]", "> > [!nf-col]", "> > ```py", "> > print(1)", "> > ```", ">", "> > [!nf-col]", "> > ```js", "> > log(1)", "> > ```", "", "After."];
  const d = EditorState.create({ doc: NOTE.join("\n") }).doc;
  const at = (n, ch = 0) => d.line(n).from + ch;
  const inner = (column) => {
    const layout = parseColumnsSource(d.sliceString(at(3), d.line(12).to).split("\n"));
    return columnInnerSource(layout, column).doc;
  };
  const typeAt = (doc, pos) => doc.sliceString(0, pos) + "x" + doc.sliceString(pos);
  // From above: the column opens with its code block — the caret goes into the code.
  let plan = columnsEntryPlan(d, at(1, 6), at(3));
  ok("main1-2: from above the column opens", plan?.kind === "open" && plan.column === 0, JSON.stringify(plan));
  let doc = inner(0);
  ok("main1-2: from above the caret is on the first code row, not the opener", doc.lineAt(plan.cursor).number === 2 && plan.cursor === doc.line(2).from, JSON.stringify(plan));
  ok("main1-2: typing there keeps the fence", typeAt(doc, plan.cursor) === "```py\nxprint(1)\n```", JSON.stringify(typeAt(doc, plan.cursor)));
  // From below: the last column ends with code — the caret goes to the last code row.
  plan = columnsEntryPlan(d, at(13), at(12, 3));
  doc = inner(1);
  ok("main1-2: from below the last column opens", plan?.kind === "open" && plan.column === 1, JSON.stringify(plan));
  ok("main1-2: from below the caret ends the last code row, not the closer", plan.cursor === doc.line(2).to, JSON.stringify(plan));
  ok("main1-2: typing there keeps the fence", typeAt(doc, plan.cursor) === "```js\nlog(1)x\n```", JSON.stringify(typeAt(doc, plan.cursor)));
  // No regression: a column starting or ending with text keeps its caret at its start / end.
  const TEXT = ["Intro.", "", "> [!nf-cols]", "> > [!nf-col]", "> > one", "> > ```py", "> > p", "> > ```", ">", "> > [!nf-col]", "> > two", "", "After."];
  const t = EditorState.create({ doc: TEXT.join("\n") }).doc;
  plan = columnsEntryPlan(t, t.line(1).to, t.line(3).from);
  ok("main1-2: a column starting with text opens at its start", plan?.kind === "open" && plan.cursor === 0, JSON.stringify(plan));
  plan = columnsEntryPlan(t, t.line(12).from, t.line(11).from + 2);
  ok("main1-2: a column ending with text opens at its end", plan?.kind === "open" && plan.column === 1 && plan.cursor === "two".length, JSON.stringify(plan));
  // A code block with no code rows ending the column: the caret goes above it.
  const EMPTY = ["Intro.", "", "> [!nf-cols]", "> > [!nf-col]", "> > a", ">", "> > [!nf-col]", "> > b", "> > ```js", "> > ```", "", "After."];
  const e = EditorState.create({ doc: EMPTY.join("\n") }).doc;
  plan = columnsEntryPlan(e, e.line(11).from, e.line(10).from + 2);
  ok("main1-2: an empty code block ending the column: the caret ends the row above it", plan?.kind === "open" && plan.column === 1 && plan.cursor === "b".length, JSON.stringify(plan));
  // A column opening with an empty code block: the caret goes to the row after its closer.
  const EMPTY2 = ["Intro.", "", "> [!nf-cols]", "> > [!nf-col]", "> > ```js", "> > ```", "> > a", ">", "> > [!nf-col]", "> > b", "", "After."];
  const e2 = EditorState.create({ doc: EMPTY2.join("\n") }).doc;
  plan = columnsEntryPlan(e2, e2.line(1).to, e2.line(3).from);
  ok("main1-2: an empty code block opening the column: the caret starts the row after it", plan?.kind === "open" && plan.column === 0 && plan.cursor === "```js\n```\n".length, JSON.stringify(plan));
  console.log("PASS review3-main1-2: a column opening or ending with code is entered in the code, not on a fence row");
}

/* ---------- review3-main1-4: raw source: ArrowDown off a column's code reaches the rest of the row ---------- */
{
  const NOTE = ["# T", "", "> [!nf-cols]", "> > [!nf-col]", "> > ```js", "> > let x = 1;", "> > ```", "> > more text in col 1", ">", "> > [!nf-col]", "> > other", "", "after"];
  const d = EditorState.create({ doc: NOTE.join("\n") }).doc;
  const at = (n, ch = 0) => d.line(n).from + ch;
  let plan = columnsEntryPlan(d, at(6, 13), at(7, 0));
  ok("main1-4: ArrowDown onto a mid-column closer goes to the column's next row", plan?.kind === "past" && plan.pos === at(8, 4), JSON.stringify(plan));
  plan = columnsEntryPlan(d, at(6, 13), at(7, 3));
  ok("main1-4: …from any column of the closer", plan?.kind === "past" && plan.pos === at(8, 4), JSON.stringify(plan));
  plan = columnsEntryPlan(d, at(8, 4), at(7, 2));
  ok("main1-4: ArrowUp onto it still stops on the code's last row", plan?.kind === "past" && plan.pos === d.line(6).to, JSON.stringify(plan));
  // A blank row of the column is a row text goes in.
  const blank = EditorState.create({ doc: ["> [!nf-cols]", "> > [!nf-col]", "> > ```js", "> > x", "> > ```", "> >", "> > y", ">", "> > [!nf-col]", "> > b", "", "after"].join("\n") }).doc;
  plan = columnsEntryPlan(blank, blank.line(4).to, blank.line(5).from);
  ok("main1-4: a blank column row after the closer takes the caret", plan?.kind === "past" && plan.pos === blank.line(6).to, JSON.stringify(plan));
  // Next row is a Callout header or another code opener: on past the whole row, as before.
  const callout = EditorState.create({ doc: ["> [!nf-cols]", "> > [!nf-col]", "> > ```js", "> > x", "> > ```", "> > > [!note] N", "> > > n", ">", "> > [!nf-col]", "> > b", "", "after"].join("\n") }).doc;
  plan = columnsEntryPlan(callout, callout.line(4).to, callout.line(5).from);
  ok("main1-4: a Callout header after the closer: past the row", plan?.kind === "past" && plan.pos === callout.line(12).from, JSON.stringify(plan));
  const code2 = EditorState.create({ doc: ["> [!nf-cols]", "> > [!nf-col]", "> > ```js", "> > x", "> > ```", ">", "> > [!nf-col]", "> > ```py", "> > y", "> > ```", "", "after"].join("\n") }).doc;
  plan = columnsEntryPlan(code2, code2.line(4).to, code2.line(5).from);
  ok("main1-4: the next column opening with code: past the row", plan?.kind === "past" && plan.pos === code2.line(12).from, JSON.stringify(plan));
  // A nested quote row of the column: after all its markers.
  const quoted = EditorState.create({ doc: ["> [!nf-cols]", "> > [!nf-col]", "> > ```js", "> > x", "> > ```", "> > > quoted", ">", "> > [!nf-col]", "> > b", "", "after"].join("\n") }).doc;
  plan = columnsEntryPlan(quoted, quoted.line(4).to, quoted.line(5).from);
  ok("main1-4: a quote row in the column: after its markers", plan?.kind === "past" && plan.pos === quoted.line(6).from + 6, JSON.stringify(plan));
  console.log("PASS review3-main1-4: raw source ArrowDown off a column's code goes to the next row, not past the whole row");
}

/* ---------- review3-main1-5: a landed Callout holding code is selected whole ---------- */
{
  const docOf = (lines) => EditorState.create({ doc: lines.join("\n") }).doc;
  const span = (b) => (b ? `${b.startLine}-${b.endLine}` : "null");
  const cases = [
    ["code first", ["para", "", "> [!note] T", "> ```js", "> x", "> ```"], "3-6"],
    ["text then code", ["para", "", "> [!note] T", "> body", "> ```js", "> x", "> ```", "> tail"], "3-8"],
    ["blank row before code", ["para", "", "> [!tip] T", "> body", ">", "> ```js", "> x", "> ```"], "3-8"],
    ["toggle with code", ["para", "", "> [!nf-toggle]+ T", "> ```py", "> y", "> ```", "", "after"], "3-6"],
    ["no code (unchanged)", ["para", "", "> [!note] T", "> body", "", "after"], "3-4"],
  ];
  for (const [name, lines, want] of cases) {
    const d = docOf(lines);
    const box = innerBlockAt(d, 3);
    const got = widgetContainerFor(d, 3, box.endLine - box.startLine + 1, false);
    ok(`main1-5: ${name}: the whole Callout is the container`, span(got) === want, `${span(got)} (handle ${span(box)})`);
  }
  // Landed rows running past the Callout, or a landing below its header, are no container.
  const d = docOf(["para", "", "> [!note] T", "> ```js", "> x", "> ```", "", "after"]);
  ok("main1-5: a span beyond the box is not covered", widgetContainerFor(d, 3, 8, false) === null);
  ok("main1-5: a body row is no container", widgetContainerFor(d, 4, 3, false) === null);
  // Tables and embeds keep getBlockRange.
  const t = docOf(["para", "", "| a | b |", "| - | - |", "| 1 | 2 |", "", "after"]);
  ok("main1-5: a table stays whole", span(widgetContainerFor(t, 3, 3, false)) === "3-5");
  console.log("PASS review3-main1-5: a landed Callout holding code is its whole box");
}

/* ---------- review3-main1-6: the empty toggle hint in a column opens the column on the new row ---------- */
{
  const NOTE = ["Intro", "", "> [!nf-cols]", "> > [!nf-col]", "> > > [!nf-toggle]+ Empty", ">", "> > [!nf-col]", "> > b", "> > > [!nf-toggle]- Shut", "", "After"];
  const d = EditorState.create({ doc: NOTE.join("\n") }).doc;
  const apply = (plan) => EditorState.create({ doc: d }).update({ changes: plan.changes }).state.doc;
  let plan = columnToggleBodyPlan(d, 5);
  ok("main1-6: a toggle in column 1 gets a plan", !!plan, JSON.stringify(plan));
  let next = apply(plan);
  ok("main1-6: the body row is written under the title", next.line(6).text === "> > > ", JSON.stringify(next.toString()));
  ok("main1-6: the column editor opens on column 1 over the whole row",
    plan.column === 0 && plan.from === next.line(3).from && plan.to === next.line(10).to, JSON.stringify(plan));
  const layout = parseColumnsSource(next.sliceString(plan.from, plan.to).split("\n"));
  let inner = columnInnerSource(layout, plan.column).doc;
  ok("main1-6: its caret is on the new body row, after its marker", inner.lineAt(plan.cursor).number === 2 && plan.cursor === inner.line(2).to && inner.line(2).text === "> ",
    `${plan.cursor} in ${JSON.stringify(inner.toString())}`);
  // A collapsed toggle in column 2: it is opened and gets its body row there.
  plan = columnToggleBodyPlan(d, 9);
  next = apply(plan);
  inner = columnInnerSource(parseColumnsSource(next.sliceString(plan.from, plan.to).split("\n")), plan.column).doc;
  ok("main1-6: a toggle in column 2 opens column 2 on its new row",
    plan.column === 1 && next.line(9).text === "> > > [!nf-toggle]+ Shut" && next.line(10).text === "> > > " && plan.cursor === inner.line(3).to,
    JSON.stringify({ plan, next: next.toString() }));
  // Outside a columns row: no column plan (the hint writes in place).
  const plain = EditorState.create({ doc: "Intro\n\n> [!nf-toggle]+ Empty\n\nAfter" }).doc;
  ok("main1-6: a top-level toggle is not a column's", columnToggleBodyPlan(plain, 3) === null);
  const inCallout = EditorState.create({ doc: "> [!note] N\n> > [!nf-toggle]+ Empty\n\nAfter" }).doc;
  ok("main1-6: a toggle in a Callout is not a column's", columnToggleBodyPlan(inCallout, 2) === null);
  const nested = EditorState.create({ doc: ["> [!note] Box", "> > [!nf-cols]", "> > > [!nf-col]", "> > > > [!nf-toggle]+ E", "> >", "> > > [!nf-col]", "> > > b"].join("\n") }).doc;
  ok("main1-6: a columns row nested in a Callout is left alone", columnToggleBodyPlan(nested, 4) === null);
  console.log("PASS review3-main1-6: the empty toggle hint in a column writes the row and opens the column on it");
}

/* ---------- review3-main1-7: a note opening with code gets a paragraph above it from the keyboard ---------- */
{
  const docOf = (text) => EditorState.create({ doc: text }).doc;
  const d = docOf("```js\nlet a = 1;\n```\n\ntext");
  const row = d.line(2);
  const plan = codeBlockUpPlan(d, row.from);
  ok("main1-7: ArrowUp at the first code row opens a paragraph above", JSON.stringify(plan) === JSON.stringify({ from: 0, to: 0, insert: "\n", cursor: 0 }), JSON.stringify(plan));
  const after = EditorState.create({ doc: d }).update({ changes: plan, selection: { anchor: plan.cursor } }).state;
  ok("main1-7: …the code block stays whole under it, the caret above", after.doc.toString() === "\n```js\nlet a = 1;\n```\n\ntext" && after.selection.main.head === 0);
  ok("main1-7: ArrowUp mid-row too", codeBlockUpPlan(d, row.from + 4)?.cursor === 0);
  ok("main1-7: ArrowLeft at the row's text start", codeBlockUpPlan(d, row.from, undefined, "left")?.cursor === 0);
  ok("main1-7: ArrowLeft mid-row is the editor's own", codeBlockUpPlan(d, row.from + 1, undefined, "left") === null);
  ok("main1-7: a later code row is not this rule", codeBlockUpPlan(docOf("```js\na\nb\n```"), 8) === null);
  ok("main1-7: the closer is not this rule", codeBlockUpPlan(d, d.line(3).from) === null);
  ok("main1-7: a note not opening with code", codeBlockUpPlan(docOf("para\n```js\nx\n```"), 5) === null && codeBlockUpPlan(docOf("para\nmore"), 5) === null);
  ok("main1-7: a block with no code rows", codeBlockUpPlan(docOf("```js\n```\ntext"), 6) === null);
  ok("main1-7: an unclosed block", codeBlockUpPlan(docOf("```js\nx"), 6)?.cursor === 0);
  const list = docOf("- ```js\n  x\n  ```");
  ok("main1-7: in a list item: ArrowLeft at the code's text start", codeBlockUpPlan(list, list.line(2).from + 2, undefined, "left")?.cursor === 0);
  ok("main1-7: in a list item: not in front of the item's indent", codeBlockUpPlan(list, list.line(2).from, undefined, "left") === null);
  console.log("PASS review3-main1-7: ArrowUp / ArrowLeft from a note-opening code block open a paragraph above it");
}

/* ---------- review3-main2-4: a run that soft line breaks wrap toggles as one run ---------- */
{
  /** A fake view over `text` with one range per [anchor, head]. */
  const fv = (text, ...ranges) => {
    let state = EditorState.create({
      doc: text,
      selection: EditorSelection.create(ranges.map(([a, h]) => EditorSelection.range(a, h))),
      extensions: EditorState.allowMultipleSelections.of(true),
    });
    const v = { dispatches: 0, get state() { return state; }, dispatch(spec) { v.dispatches++; state = state.update(spec).state; } };
    return v;
  };
  const bold = (v) => toggleDualFormat(v, "**", "<b>", "</b>");
  const italic = (v) => toggleDualFormat(v, "*", "<i>", "</i>");
  const boldOn = (s) => isDualFormatActive(s, "**", "<b>", "</b>");
  /** Bold toggled once over `text` with [a, h] selected: [lit before, text after]. */
  const boldOnce = (text, a, h) => {
    const v = fv(text, [a, h]);
    const lit = segmentsActive(v.state, boldOn);
    bold(v);
    return [lit, v.state.doc.toString()];
  };
  const R = "**line one\nline two**";
  let [lit, out] = boldOnce(R, 0, R.length);
  ok("main2-4: the whole run selected reads as bold", lit === true);
  ok("main2-4: Bold unbolds the whole run", out === "line one\nline two", JSON.stringify(out));
  [lit, out] = boldOnce(R, 2, R.length - 2);
  ok("main2-4: its inner text selected reads as bold", lit === true);
  ok("main2-4: Bold unbolds it from the inner text too", out === "line one\nline two", JSON.stringify(out));
  [lit, out] = boldOnce(R, R.length, 0);
  ok("main2-4: a backward selection unbolds it too", lit === true && out === "line one\nline two", JSON.stringify(out));
  // A drag over the run in Live Preview stops short of the closer's
  // markers: opener to just before the closer. The whole run all the same.
  [lit, out] = boldOnce(R, 0, R.length - 2);
  ok("main2-4: opener to the closer's start reads as bold", lit === true);
  ok("main2-4: and Bold unbolds the run", out === "line one\nline two", JSON.stringify(out));
  [lit, out] = boldOnce(R, 2, R.length);
  ok("main2-4: past the opener to the closer's end unbolds it too", lit === true && out === "line one\nline two", JSON.stringify(out));
  let v = fv(R, [R.length - 2, 0]);
  bold(v);
  ok("main2-4: the words stay selected, still backward",
    v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to) === "line one\nline two" &&
      v.state.selection.main.head < v.state.selection.main.anchor);
  ok("main2-4: one transaction (lopsided)", v.dispatches === 1, String(v.dispatches));
  v = fv(R, [0, R.length]);
  bold(v);
  ok("main2-4: one transaction", v.dispatches === 1, String(v.dispatches));
  v = fv(R, [0, R.length]);
  italic(v);
  ok("main2-4: Italic over the run makes it bold italic, not per-row markers",
    v.state.doc.toString() === "***line one\nline two***", JSON.stringify(v.state.doc.toString()));
  [lit, out] = boldOnce("**a\nb\nc**", 0, 9);
  ok("main2-4: a run over three rows", lit === true && out === "a\nb\nc", JSON.stringify(out));
  [lit, out] = boldOnce("> **a\n> b**", 2, 11);
  ok("main2-4: a run inside a quote", lit === true && out === "> a\n> b", JSON.stringify(out));
  [lit, out] = boldOnce("- **a\n  b**", 2, 11);
  ok("main2-4: a run over a list item's continuation row", lit === true && out === "- a\n  b", JSON.stringify(out));
  [lit, out] = boldOnce("x **a\nb** y", 2, 9);
  ok("main2-4: a run inside a longer paragraph", lit === true && out === "x a\nb y", JSON.stringify(out));
  [lit, out] = boldOnce("**a\nb** c **d\ne**", 10, 17);
  ok("main2-4: a second run opened after a closer", lit === true && out === "**a\nb** c d\ne", JSON.stringify(out));
  // Not one run: these keep one piece per row.
  ok("main2-4: two list items are two blocks", boldOnce("- **a\n- b**", 2, 11)[0] === false);
  ok("main2-4: a blank row ends the paragraph", boldOnce("**a\n\nb**", 0, 8)[0] === false);
  ok("main2-4: a heading ends at its row", boldOnce("# **a\nb**", 2, 9)[0] === false);
  [lit, out] = boldOnce("**a** b\nc **d**", 6, 9);
  ok("main2-4: two one-row runs are formatted per row", lit === false && out === "**a** **b**\n**c** **d**", JSON.stringify(out));
  ok("main2-4: markers in a code span do not pair", boldOnce("`**` a\nb **c**", 5, 7)[0] === false);
  // A colour keeps its per-row spans inside the run: they nest there.
  v = fv(R, [2, R.length - 2]);
  applyTextColor(v, TEXT_COLORS[1]);
  const span = (x) => `<span style="color:${TEXT_COLORS[1]}">${x}</span>`;
  ok("main2-4: a colour inside the run is one span per row, nested in it",
    v.state.doc.toString() === `**${span("line one")}\n${span("line two")}**`, JSON.stringify(v.state.doc.toString()));
  // A piece that is only markup is dropped.
  const M = "a\n**one two** b";
  ok("main2-4: a piece of only markers is not a piece",
    JSON.stringify(lineFormatSegments(fv(M, [0, 4]).state)) === JSON.stringify([{ from: 0, to: 1 }]),
    JSON.stringify(lineFormatSegments(fv(M, [0, 4]).state)));
  v = fv(M, [0, 4]);
  bold(v);
  ok("main2-4: so Bold leaves the opening ** alone", v.state.doc.toString() === "**a**\n**one two** b", JSON.stringify(v.state.doc.toString()));
  console.log("PASS review3-main2-4: a soft-wrapped emphasis run toggles as one run; markup-only pieces are dropped");
}

/* ---------- review3-main2-5 / review3-main3-3: a re-rendered caption re-syncs its bound <pre> ---------- */
{
  const doc = { activeElement: null };
  /** A Reading-view <pre> (kept across renders) and a caption section rendered with `collapsed`. */
  const pre = new FakeEl(doc, "pre");
  pre.querySelector = (sel) => (sel.includes("nf-rendered-code-fold") ? pre.children.find((c) => c.classes.has("nf-rendered-code-fold")) ?? null : null);
  const captionOf = (collapsed) => {
    const caption = new FakeEl(doc, "small", { cls: "nf-caption nf-rendered-caption" });
    caption.dataset = { nfKind: "code", nfCollapsed: String(collapsed) };
    caption.closest = () => null;
    return caption;
  };
  const folds = () => pre.children.filter((c) => c.classes.has("nf-rendered-code-fold"));
  const state = () => {
    const fold = folds()[0];
    return {
      pre: pre.classes.has("nf-rendered-code-collapsed"),
      chevron: fold?.classes.has("is-collapsed"),
      expanded: fold?.getAttribute("aria-expanded"),
      label: fold?.getAttribute("aria-label"),
    };
  };
  bindCaptionOwner(captionOf(false), new FakeEl(doc, "p"), pre);
  let st = state();
  ok("main2-5: first bind, expanded", st.pre === false && st.chevron === false && st.expanded === "true" && st.label === "Collapse code block", JSON.stringify(st));
  // The fold is clicked in Live Preview: the caption row alone re-renders.
  bindCaptionOwner(captionOf(true), new FakeEl(doc, "p"), pre);
  st = state();
  ok("main2-5: a re-rendered caption that says collapsed folds the kept <pre>", st.pre === true, JSON.stringify(st));
  ok("main3-3: and its chevron follows (is-collapsed, aria-expanded, label)",
    st.chevron === true && st.expanded === "false" && st.label === "Expand code block", JSON.stringify(st));
  ok("main2-5: still one fold button", folds().length === 1, String(folds().length));
  bindCaptionOwner(captionOf(false), new FakeEl(doc, "p"), pre);
  st = state();
  ok("main3-3: and one that says expanded unfolds it again",
    st.pre === false && st.chevron === false && st.expanded === "true" && st.label === "Collapse code block", JSON.stringify(st));
  // The chevron still folds locally in Reading view (no editor to write to).
  folds()[0].dispatchEvent(Object.assign(new Event("click"), { preventDefault() {}, stopPropagation() {} }));
  st = state();
  ok("main3-3: the kept chevron still folds the block locally", st.pre === true && st.chevron === true && st.expanded === "false", JSON.stringify(st));
  console.log("PASS review3-main2-5 / main3-3: a caption bound again carries its fold state to the kept <pre>");
}

/* ---------- review3-main3-4: caption ownership reads CRLF source ---------- */
{
  const CAP = '<small class="nf-caption" data-nf-kind="code">cap</small>';
  const LF = "```js\nx\n```\n" + CAP + "\n";
  const CRLF = LF.replace(/\n/g, "\r\n");
  ok("main3-4: an LF note owns its code caption", captionOwnedInSource(LF, 3) === true);
  ok("main3-4: so does the same note with CRLF line ends", captionOwnedInSource(CRLF, 3) === true);
  ok("main3-4: and with lone CR line ends", captionOwnedInSource(LF.replace(/\n/g, "\r"), 3) === true);
  const TABLE = "Intro\r\n\r\n| a | b |\r\n| - | - |\r\n| 1 | 2 |\r\n" + CAP.replace("code", "table") + "\r\n";
  ok("main3-4: a CRLF table caption, lines still aligned", captionOwnedInSource(TABLE, 5) === true);
  ok("main3-4: a caption apart from its block (blank row) stays apart in CRLF too",
    captionOwnedInSource("```js\r\nx\r\n```\r\n\r\n" + CAP + "\r\n", 4) === false);
  ok("main3-4: a plain row is no caption", captionOwnedInSource("```js\r\nx\r\n```\r\ntext\r\n", 3) === false);
  console.log("PASS review3-main3-4: CRLF and CR notes bind captions across the Reading-view seam");
}

if (fail) {
  console.error(`${fail} check(s) failed`);
  process.exit(1);
}
console.log("PASS run-main-fix");
