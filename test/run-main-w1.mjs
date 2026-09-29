import assert from "node:assert/strict";
import { EditorState, Text } from "@codemirror/state";
import { columnExitPlan, toggleInlineFormatIn, strayConcealSelectionAction, clampRangeOutOfTags, findColorTagPairs, toggleUnderline, applyTextColor, toggleDualFormat, isDualFormatActive, getWrapState, tableCellAnchor, tableInsertRow, tableInsertRowIndex, tableInsertColumn, editorHelpSections, makeCalloutEditPlugin, pluginDefaultHotkeys, confirmEnterAction, blockChordRows, codeBlockDownPlan, fenceExitPlan, buildBlockCaption, SlashSuggest, SLASH_COMMANDS, quoteEnterPlan, quoteBackspacePlan, buildToggleTemplate, renderedCalloutRoot, calloutRowsFromDom, DEFAULT_SETTINGS } from "./bundle.mjs";

/** A stand-in for EditorView: the state plus a dispatch that applies it. */
function fakeView(doc, anchor, head = anchor) {
  const view = { composing: false, state: EditorState.create({ doc, selection: { anchor, head } }) };
  view.dispatch = (spec) => {
    view.last = spec;
    view.state = view.state.update(spec).state;
  };
  return view;
}

/* ---------- item 2: leaving a columns row never lazy-merges ---------- */
{
  const ROW = "> [!nf-cols]\n> > [!nf-col]\n> > col text\n>\n> > [!nf-col]\n> > other";
  const rowEnd = ROW.split("\n").length; // 6
  /** Apply the plan: [text, caret line number]. */
  const exit = (text, end = rowEnd) => {
    const doc = Text.of(text.split("\n"));
    const plan = columnExitPlan(doc, end);
    const out = doc.replace(plan.from, plan.to, Text.of(plan.insert.split("\n")));
    return { text: out.toString(), line: out.lineAt(plan.cursor).number, cursor: plan.cursor, plan, out };
  };
  const cases = [
    // [before (after the row), after (after the row)]
    ["", "\n\n"],                       // the row is the last line
    ["\n", "\n\n"],                     // one blank, then EOF
    ["\n\n", "\n\n"],                   // blank, blank, EOF: reuse
    ["\n\n\n", "\n\n\n"],               // blank, blank, blank: reuse
    ["\n\n\nEnd.", "\n\n\n\nEnd."],     // blank, blank, content
    ["\n\nEnd.", "\n\n\n\nEnd."],       // blank, content
    ["\nlazy", "\n\n\n\nlazy"],         // content right below (already lazy)
  ];
  for (const [tail, want] of cases) {
    const r = exit(ROW + tail);
    assert.equal(r.text, ROW + want, `layout for ${JSON.stringify(tail)}`);
    assert.equal(r.line, rowEnd + 2, `caret two lines below the row for ${JSON.stringify(tail)}`);
    assert.equal(r.out.line(r.line).text, "", "the caret line is empty");
    assert.equal(r.out.line(rowEnd + 1).text, "", "a blank seam stays between the row and the caret");
    const below = r.line < r.out.lines ? r.out.line(r.line + 1).text : "";
    assert.equal(below.trim(), "", "a blank line or EOF follows the caret line");
    // Idempotent: the plan applied to its own output changes nothing.
    const again = columnExitPlan(r.out, rowEnd);
    assert.equal(again.from, again.to);
    assert.equal(again.insert, "", `second exit is a no-op for ${JSON.stringify(tail)}`);
    assert.equal(r.out.lineAt(again.cursor).number, rowEnd + 2);
  }
  // The row's own source is never touched, and typed text is its own paragraph.
  {
    const before = "# Cols\n\nIntro para.\n\n" + ROW + "\n\nEnd.\n";
    const doc = Text.of(before.split("\n"));
    const plan = columnExitPlan(doc, 10);
    const view = fakeView(before, 0);
    view.dispatch({ changes: { from: plan.from, to: plan.to, insert: plan.insert }, selection: { anchor: plan.cursor } });
    view.dispatch(view.state.replaceSelection("x中文"));
    assert.equal(view.state.doc.toString(), "# Cols\n\nIntro para.\n\n" + ROW + "\n\nx中文\n\nEnd.\n");
  }
  console.log("PASS column exit plan: six layouts, idempotent, typed text lands below the row");
}

/* ---------- item 3: ⌘B / ⌘I routed into a column editor ---------- */
{
  const bold = (view) => toggleInlineFormatIn(view, "**", "<b>", "</b>");
  const sel = (view) => view.state.doc.sliceString(view.state.selection.main.from, view.state.selection.main.to);
  let view = fakeView("col text", 0, 3);
  assert.equal(bold(view), true);
  assert.equal(view.state.doc.toString(), "**col** text", "a selection is wrapped");
  assert.equal(sel(view), "col", "the selection stays on the text");
  assert.equal(bold(view), true);
  assert.equal(view.state.doc.toString(), "col text", "and unwrapped again");

  view = fakeView("col text", 1);
  bold(view);
  assert.equal(view.state.doc.toString(), "**col** text", "a caret inside a word formats the word");

  view = fakeView("col text", 3);
  bold(view);
  assert.equal(view.state.doc.toString(), "col**** text", "a caret at a word edge opens a pair");
  assert.equal(view.state.selection.main.head, 5, "with the caret between");
  view = fakeView("col  text", 4);
  bold(view);
  assert.equal(view.state.doc.toString(), "col **** text", "a caret between spaces opens a pair");
  assert.equal(view.state.selection.main.head, 6);

  view = fakeView("```js\ncol text\n```", 6, 9);
  bold(view);
  assert.equal(view.state.doc.toString(), "```js\n<b>col</b> text\n```", "code keeps its text: HTML tags");
  view = fakeView("```js\ncol text\n```", 7);
  toggleInlineFormatIn(view, "*", "<i>", "</i>");
  assert.equal(view.state.doc.toString(), "```js\n<i>col</i> text\n```");

  view = fakeView("some <u>col</u> text", 8, 11);
  bold(view);
  assert.equal(view.state.doc.toString(), "some <u><b>col</b></u> text", "inside an HTML run the format stays HTML");

  view = fakeView("col text", 0, 3);
  view.composing = true;
  assert.equal(bold(view), false, "never during an IME composition");
  assert.equal(view.state.doc.toString(), "col text");
  console.log("PASS toggleInlineFormatIn: selection, word, empty pair, fences, HTML runs, IME");
}

/* ---------- item 4: selections inside concealed runs survive ---------- */
{
  const act = (o) => strayConcealSelectionAction({ domFrom: 10, domTo: 15, selFrom: 10, selTo: 15, fresh: false, detail: 0, inEmbed: false, ...o });
  assert.equal(act({}), "keep", "keyboard / programmatic selection mirrored into the DOM");
  assert.equal(act({ fresh: true, detail: 1, inEmbed: true }), "keep", "a mirrored selection stays even right after a click");
  assert.equal(act({ selFrom: 12, selTo: 12, fresh: true, detail: 1, inEmbed: false }), "keep", "a click outside a widget (a drag's end, the toolbar)");
  assert.equal(act({ selFrom: 12, selTo: 12, fresh: false, detail: 1, inEmbed: true }), "keep", "a stale click");
  assert.equal(act({ selFrom: 12, selTo: 12, fresh: true, detail: 1, inEmbed: true }), "caret", "the stray full-element selection after a click");
  assert.equal(act({ selFrom: 12, selTo: 12, fresh: true, detail: 2, inEmbed: true }), "word", "a double-click selects the word");
  assert.equal(act({ selFrom: 12, selTo: 12, fresh: true, detail: 3, inEmbed: true }), "keep", "a triple-click is left alone");
  // Obsidian selects the whole element ~150 ms after a click on its widget,
  // and CodeMirror mirrors that before the DOM reports it.
  assert.equal(act({ fresh: true, detail: 1, inEmbed: true, whole: true }), "caret", "the mirrored whole-element selection after a widget click");
  assert.equal(act({ fresh: false, detail: 1, inEmbed: true, whole: true }), "keep", "a whole-run selection made later is real");
  assert.equal(act({ fresh: true, detail: 1, inEmbed: false, whole: true }), "keep", "so is one after a click elsewhere");

  const text = 'alpha beta <span style="color:var(--nf-red, #b5554d)">gamma delta epsilon</span> zeta.';
  const pairs = findColorTagPairs(text);
  const close = text.indexOf("</span>");
  assert.equal(clampRangeOutOfTags(pairs, close + 6, close + 7), null, "the hidden '>' alone is nothing to format");
  assert.deepEqual(clampRangeOutOfTags(pairs, text.indexOf("epsilon"), close + 3), { from: text.indexOf("epsilon"), to: close }, "an end inside </span> moves to its start");
  const openTo = text.indexOf("gamma");
  assert.deepEqual(clampRangeOutOfTags(pairs, 20, openTo + 5), { from: openTo, to: openTo + 5 }, "a start inside the open tag moves past it");
  assert.deepEqual(clampRangeOutOfTags(pairs, 0, openTo), { from: 0, to: text.indexOf("<span") }, "an end right after the open tag drops it");
  assert.deepEqual(clampRangeOutOfTags(pairs, close, text.length), { from: close + 7, to: text.length }, "a start on the close tag drops it");
  assert.deepEqual(clampRangeOutOfTags(pairs, text.indexOf("<span"), close + 7), { from: text.indexOf("<span"), to: close + 7 }, "a whole run stays whole");
  assert.deepEqual(clampRangeOutOfTags(pairs, openTo, close), { from: openTo, to: close }, "the inner text stays");
  const nested = "x <b><u>y</u></b> z";
  const np = findColorTagPairs(nested);
  assert.deepEqual(clampRangeOutOfTags(np, nested.indexOf("</u>") + 2, nested.length), { from: nested.indexOf("</b>") + 4, to: nested.length }, "settles across adjacent tags");

  // A format keeps its selection on the inner text, and that selection,
  // mirrored in the DOM, is one the conceal plugin keeps.
  let view = fakeView("alpha beta gamma", 6, 10);
  toggleUnderline(view);
  assert.equal(view.state.doc.toString(), "alpha <u>beta</u> gamma");
  const s = view.state.selection.main;
  assert.equal(view.state.sliceDoc(s.from, s.to), "beta", "the selection stays on the inner text");
  assert.equal(strayConcealSelectionAction({ domFrom: s.from, domTo: s.to, selFrom: s.from, selTo: s.to, fresh: true, detail: 1, inEmbed: false }), "keep");

  // Recolouring a selection of the hidden '>' writes nothing.
  view = fakeView(text, close + 6, close + 7);
  applyTextColor(view, "green");
  assert.equal(view.state.doc.toString(), text, "no </span<span …>> corruption");
  // A selection reaching into the close tag is pulled back before formatting.
  view = fakeView("one <u>two three</u> four", 11, 18);
  toggleUnderline(view);
  assert.equal(view.state.doc.toString(), "one two three four", "the run is un-underlined, its tags intact until removed whole");
  assert.equal(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to), "three");
  console.log("PASS conceal: stray-selection decision table, tags clamped out of a format's range");
}

/* ---------- item 5: toolbar Italic on **bold** adds italics ---------- */
{
  const italic = (view) => toggleDualFormat(view, "*", "<i>", "</i>");
  const bold = (view) => toggleDualFormat(view, "**", "<b>", "</b>");
  const active = (view) => isDualFormatActive(view.state, "*", "<i>", "</i>");
  const sel = (view) => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
  const ALPHA = "alpha **gamma delta** zeta.";
  const from = ALPHA.indexOf("**"), to = ALPHA.lastIndexOf("**") + 2;

  // A drag over rendered bold selects the markers too.
  let view = fakeView(ALPHA, from, to);
  assert.equal(getWrapState(view.state, "*"), "none", "**x** is bold only, not italic");
  assert.equal(active(view), false, "the Italic button is off on bold text");
  italic(view);
  assert.equal(view.state.doc.toString(), "alpha ***gamma delta*** zeta.", "italic is added, bold kept");
  assert.equal(sel(view), "**gamma delta**", "the selection follows the bold run");
  assert.equal(active(view), true, "the Italic button is on for bold italic");
  italic(view);
  assert.equal(view.state.doc.toString(), ALPHA, "italic twice restores the bold text");

  // The whole bold-italic run selected: only the italic comes off.
  view = fakeView("***x***", 0, 7);
  assert.equal(active(view), true);
  italic(view);
  assert.equal(view.state.doc.toString(), "**x**");
  // Plain italic is still removed.
  view = fakeView("*x*", 0, 3);
  italic(view);
  assert.equal(view.state.doc.toString(), "x");
  // The inner text of bold gets italic around it.
  view = fakeView("**x**", 2, 3);
  assert.equal(active(view), false);
  italic(view);
  assert.equal(view.state.doc.toString(), "***x***");
  assert.equal(sel(view), "x");
  assert.equal(active(view), true);
  italic(view);
  assert.equal(view.state.doc.toString(), "**x**", "and the inner italic comes off again");
  // Bold on the whole bold-italic run still strips the bold (unchanged).
  view = fakeView("***x***", 0, 7);
  bold(view);
  assert.equal(view.state.doc.toString(), "*x*");
  console.log("PASS italic inside bold: **x** gains italics, ***x*** loses only them, button state follows");
}

/* ---------- item 6: a table action leaves the caret in its target cell ---------- */
{
  const TABLE = "| Name | Qty |\n| --- | --- |\n| Apple | 3 |\n| Pear | 4 |";
  const FROM = 20; // the table starts somewhere inside a note
  const cellText = (out, anchor) => {
    const i = anchor - FROM;
    const lineStart = out.lastIndexOf("\n", i - 1) + 1;
    const lineEnd = out.indexOf("\n", i);
    return [out.slice(lineStart, lineEnd < 0 ? undefined : lineEnd), out.slice(i).split(/\s*\|/)[0]];
  };
  // Insert row below "Apple": the caret lands in the new, empty body row.
  const below = tableInsertRow(TABLE, 2, "below");
  const newRow = tableInsertRowIndex(TABLE, 2, "below");
  assert.equal(newRow, 3);
  let a = tableCellAnchor(FROM, below, newRow, 1);
  let [line, text] = cellText(below, a);
  assert.equal(below.split("\n")[3], line, "the anchor is on the inserted row");
  assert.equal(text, "", "in its (empty) second cell");
  assert.equal(below[a - FROM - 1], " ", "just after the pipe's padding");
  // Insert column right of "Qty" in the header: the caret moves into it.
  const right = tableInsertColumn(TABLE, 1, "right");
  a = tableCellAnchor(FROM, right, 0, 2);
  [line, text] = cellText(right, a);
  assert.equal(line, right.split("\n")[0]);
  assert.equal(right.slice(0, a - FROM).split("|").length - 1, 3, "third cell of the header");
  // A requested delimiter row or out-of-range row/col is clamped onto data.
  a = tableCellAnchor(FROM, TABLE, 1, 0);
  assert.equal(TABLE.slice(a - FROM, a - FROM + 4), "Name", "the delimiter row falls back to the header");
  a = tableCellAnchor(FROM, TABLE, 99, 9);
  assert.equal(TABLE.slice(a - FROM, a - FROM + 1), "4", "past the end: last row, last cell");
  a = tableCellAnchor(FROM, TABLE, 2, 0);
  assert.equal(TABLE.slice(a - FROM, a - FROM + 5), "Apple");
  console.log("PASS tableCellAnchor: new row, new column, delimiter and range clamps");
}

/* ---------- item 7: Esc selects the caret's block (keyboard guide row) ---------- */
{
  // The guards are DOM-bound and checked in the app; the guide must keep
  // advertising the key exactly when the setting enables it.
  const rows = (settings) => editorHelpSections(settings).flatMap((section) => section.rows);
  const escRow = (settings) => rows(settings).some((row) => row.desc === "Select the block holding the caret");
  assert.equal(escRow({ ...DEFAULT_SETTINGS, blockSelectKey: true }), true, "Esc row listed while the key is on");
  assert.equal(escRow({ ...DEFAULT_SETTINGS, blockSelectKey: false }), false, "and hidden while it is off");
  console.log("PASS esc selects block: keyboard guide lists Escape only while blockSelectKey is on");
}

/* ---------- item 10: an entered toggle keeps the toggle look ---------- */
{
  const SETTINGS = { calloutEditing: true, codeBlockEditing: true, toggleBlocks: true, columnLayout: true };
  /** One build pass of the Callout edit plugin with the caret on `caretLine`. */
  const build = (lines, caretLine, caretCh = 2) => {
    const state = EditorState.create({ doc: lines.join("\n") });
    const anchor = Math.min(state.doc.line(caretLine).from + caretCh, state.doc.line(caretLine).to);
    const view = {
      state: state.update({ selection: { anchor } }).state,
      visibleRanges: [{ from: 0, to: state.doc.length }],
      contentDOM: { clientWidth: 700, style: { setProperty() {} } },
      dom: { closest: (sel) => (String(sel).includes("is-live-preview") ? {} : null) },
    };
    const Cls = makeCalloutEditPlugin({ settings: SETTINGS, app: {} });
    const instance = Object.create(Cls.prototype);
    const ranges = [...instance.build.call(instance, view)];
    const doc = view.state.doc;
    const rows = new Map();
    for (let n = 1; n <= doc.lines; n++) rows.set(n, { cls: "", style: "", gaps: [], marks: 0 });
    for (const range of ranges) {
      const row = rows.get(doc.lineAt(range.from).number);
      if (range.kind === "line") {
        row.cls += " " + (range.spec?.attributes?.class ?? "");
        row.style += range.spec?.attributes?.style ?? "";
      } else if (range.kind === "replace" && range.spec?.widget?.constructor?.name === "VisualStructureGapWidget") {
        const line = doc.lineAt(range.from);
        row.gaps.push({ from: range.from - line.from, to: range.to - line.from, widget: range.spec.widget });
      } else if (range.kind === "replace" && range.spec?.widget?.constructor?.name === "ToggleMarkWidget") {
        row.marks++;
      }
    }
    return rows;
  };
  /** The gap's own inline geometry, through a fake document. */
  const gapDom = (widget) => {
    const props = {};
    const el = {
      className: "",
      style: { setProperty: (k, v) => { props[k] = v; }, width: "" },
      setAttribute() {},
    };
    widget.toDOM({ dom: { ownerDocument: { createElement: () => el } } });
    return { cls: el.className, width: el.style.width, props };
  };

  // A top-level toggle, caret in its body.
  const TOP = ["Para before.", "", "> [!nf-toggle]+ Open toggle", "> body one", "> body two", "", "Para after."];
  let rows = build(TOP, 4);
  for (const n of [3, 4, 5]) {
    const row = rows.get(n);
    assert.equal(row.gaps.length, 1, `row ${n}: one gap hides its "> "`);
    assert.deepEqual([row.gaps[0].from, row.gaps[0].to, row.gaps[0].widget.kind], [0, 2, "toggle"], `row ${n}: gap over "> "`);
    assert.match(row.cls, /\bnf-co-toggle\b/, `row ${n} keeps nf-co-toggle`);
    assert.match(row.cls, /\bnf-co-toggle-hang\b/, `row ${n} declares the toggle column`);
    assert.match(row.style, /--nf-co-toggle-boxes:0;--nf-co-toggle-depth:1;/, `row ${n} counts`);
  }
  assert.equal(rows.get(3).marks, 1, "the header shows the triangle while the caret is in the body");
  // Header: no width of its own (the triangle is the column); body: one toggle inset.
  let head = gapDom(rows.get(3).gaps[0].widget);
  let body = gapDom(rows.get(4).gaps[0].widget);
  assert.equal(head.cls, "nf-visual-prefix nf-toggle-prefix");
  assert.deepEqual([head.props["--nf-prefix-toggle-depth"], head.props["--nf-prefix-inner-depth"], head.props["--nf-prefix-callout-depth"]], ["0", "0", "0"], "header spends nothing");
  assert.deepEqual([body.props["--nf-prefix-toggle-depth"], body.props["--nf-prefix-inner-depth"], body.props["--nf-prefix-callout-depth"]], ["1", "0", "0"], "body spends one toggle inset");
  assert.match(body.width, /--nf-prefix-toggle-depth,0\) \* var\(--nf-toggle-content-inset,24px\)/, "width is written inline");
  // Caret on the header's title: the triangle stays (fix-toggle-title-marker),
  // as a Callout header keeps its lead; the gap stays.
  rows = build(TOP, 3, 20);
  assert.equal(rows.get(3).marks, 1, "the triangle stays on the caret's header row");
  assert.deepEqual([rows.get(3).gaps.length, rows.get(4).gaps.length], [1, 1], "gaps stay while the header is edited");
  // Caret inside the "[!nf-toggle]+" token itself: the source is shown.
  rows = build(TOP, 3, 5);
  assert.equal(rows.get(3).marks, 0, "no triangle while the caret is inside the token");
  assert.deepEqual([rows.get(3).gaps.length, rows.get(4).gaps.length], [1, 1], "gaps stay while the token is edited");
  // Caret outside: the rendered toggle owns its rows, nothing is replaced.
  rows = build(TOP, 7, 0);
  assert.ok([3, 4, 5].every((n) => rows.get(n).gaps.length === 0 && !/nf-co-toggle-hang/.test(rows.get(n).cls)), "a closed toggle is left to its rendered widget");

  // A toggle inside a Callout: one box, then the toggle.
  const NESTED = ["> [!note] Box", "> > [!nf-toggle]+ Inner", "> > inner body"];
  rows = build(NESTED, 3, 6);
  head = gapDom(rows.get(2).gaps[0].widget);
  body = gapDom(rows.get(3).gaps[0].widget);
  assert.deepEqual([rows.get(2).gaps[0].from, rows.get(2).gaps[0].to], [0, 4], "nested header gap over both markers");
  assert.deepEqual([head.props["--nf-prefix-callout-depth"], head.props["--nf-prefix-toggle-depth"], head.props["--nf-prefix-inner-depth"]], ["1", "0", "0"], "nested header: the box's inset only");
  assert.deepEqual([body.props["--nf-prefix-callout-depth"], body.props["--nf-prefix-toggle-depth"], body.props["--nf-prefix-inner-depth"]], ["1", "1", "0"], "nested body: box + toggle");
  assert.match(rows.get(3).style, /--nf-co-toggle-boxes:1;--nf-co-toggle-depth:1;/);

  // A toggle in a toggle, with a plain quote inside the inner one.
  const TT = ["> [!nf-toggle]+ Outer", "> outer body", "> > [!nf-toggle]+ Inner", "> > inner body", "> > > quoted"];
  rows = build(TT, 4, 6);
  const props = (n) => gapDom(rows.get(n).gaps[0].widget).props;
  assert.deepEqual([props(3)["--nf-prefix-toggle-depth"], props(3)["--nf-prefix-inner-depth"]], ["1", "0"], "inner header: the outer toggle's inset");
  assert.deepEqual([props(4)["--nf-prefix-toggle-depth"], props(4)["--nf-prefix-inner-depth"]], ["2", "0"], "inner body: two toggle insets");
  assert.deepEqual([props(5)["--nf-prefix-toggle-depth"], props(5)["--nf-prefix-inner-depth"]], ["2", "1"], "quote in the inner toggle: plus one quote step");
  assert.match(rows.get(4).style, /--nf-co-toggle-boxes:0;--nf-co-toggle-depth:2;/);

  // Fence rows are code rows on the toggle's column (w1c-toggle-fence-rows-signal:
  // a toggle gap plus the card's padding, no 39px box); list rows keep Obsidian's wrap.
  const MIXED = ["> [!nf-toggle]+ T", "> - item", "> ```js", "> x", "> ```", "> tail"];
  rows = build(MIXED, 6, 3);
  assert.equal(rows.get(2).gaps.length, 1, "a list row hides its quote marker");
  assert.doesNotMatch(rows.get(2).cls, /nf-co-toggle-hang/, "a list row leaves its wrap to be measured");
  const codeGap = rows.get(4).gaps.find((g) => g.widget.kind === "toggle");
  assert.ok(codeGap && codeGap.widget.insideCode, "the code row's gap is a toggle code gap");
  assert.deepEqual([gapDom(codeGap.widget).props["--nf-prefix-callout-depth"], gapDom(codeGap.widget).props["--nf-prefix-toggle-depth"]], ["0", "1"], "…one toggle inset, no box");
  assert.ok([3, 4, 5].every((n) => /\bnf-co-toggle-code\b/.test(rows.get(n).cls) && /--nf-co-toggle-boxes:0;--nf-co-toggle-depth:1;/.test(rows.get(n).style)), "fence rows say they sit in a toggle");
  assert.ok([3, 4, 5].every((n) => !/nf-co-toggle-hang/.test(rows.get(n).cls)), "fence rows are no prose hang rows");

  // eq(): the toggle depth is part of the widget's identity.
  const Gap = rows.get(4).gaps[0].widget.constructor;
  const gap = (toggles) => new Gap("toggle", 2, false, 0, 0, toggles);
  assert.equal(gap(2).eq(gap(2)), true, "same shape, same widget");
  assert.equal(gap(2).eq(gap(1)), false, "a different toggle depth redraws");
  console.log("PASS toggle edit rows: every row's \"> \" hidden by a toggle gap, header/body/nested insets, hang counts");
}

/* ---------- item 11: no default chord collides with core Obsidian ---------- */
{
  // Core Obsidian's default hotkeys, captured 2026-09-28 from Obsidian 1.13.7
  // (API 1.11.4) with every core plugin enabled:
  //   Object.entries(app.hotkeyManager.defaultKeys).filter(([id]) => !id.startsWith("notion-flow:"))
  //     .flatMap(([id, hs]) => hs.map((h) => [id, h.modifiers, h.key]))
  const OBSIDIAN_1_13_DEFAULT_HOTKEYS = [
    ["editor:save-file", ["Mod"], "S"],
    ["editor:follow-link", ["Alt"], "Enter"],
    ["editor:open-link-in-new-leaf", ["Mod"], "Enter"],
    ["editor:open-link-in-new-window", ["Mod", "Alt", "Shift"], "Enter"],
    ["editor:open-link-in-new-split", ["Mod", "Alt"], "Enter"],
    ["workspace:edit-file-title", [], "F2"],
    ["workspace:undo-close-pane", ["Mod", "Shift"], "T"],
    ["workspace:next-tab", ["Ctrl"], "Tab"],
    ["workspace:next-tab", ["Meta", "Shift"], "]"],
    ["workspace:goto-tab-1", ["Mod"], "1"],
    ["workspace:goto-tab-2", ["Mod"], "2"],
    ["workspace:goto-tab-3", ["Mod"], "3"],
    ["workspace:goto-tab-4", ["Mod"], "4"],
    ["workspace:goto-tab-5", ["Mod"], "5"],
    ["workspace:goto-tab-6", ["Mod"], "6"],
    ["workspace:goto-tab-7", ["Mod"], "7"],
    ["workspace:goto-tab-8", ["Mod"], "8"],
    ["workspace:goto-last-tab", ["Mod"], "9"],
    ["workspace:previous-tab", ["Ctrl", "Shift"], "Tab"],
    ["workspace:previous-tab", ["Meta", "Shift"], "["],
    ["workspace:new-tab", ["Mod"], "T"],
    ["workspace:close", ["Mod"], "W"],
    ["workspace:close-window", ["Mod", "Shift"], "W"],
    ["app:go-back", ["Mod", "Alt"], "ArrowLeft"],
    ["app:go-forward", ["Mod", "Alt"], "ArrowRight"],
    ["app:open-settings", ["Mod"], ","],
    ["markdown:toggle-preview", ["Mod"], "E"],
    ["markdown:add-metadata-property", ["Mod"], ";"],
    ["app:open-help", [], "F1"],
    ["file-explorer:new-file", ["Mod"], "N"],
    ["file-explorer:new-file-in-new-pane", ["Mod", "Shift"], "N"],
    ["editor:open-search", ["Mod"], "F"],
    ["editor:open-search-replace", ["Mod", "Alt"], "F"],
    ["editor:insert-link", ["Mod"], "K"],
    ["editor:toggle-bold", ["Mod"], "B"],
    ["editor:toggle-italics", ["Mod"], "I"],
    ["editor:toggle-comments", ["Mod"], "/"],
    ["editor:toggle-checklist-status", ["Mod"], "l"],
    ["editor:delete-paragraph", ["Mod"], "D"],
    ["global-search:open", ["Mod", "Shift"], "F"],
    ["switcher:open", ["Mod"], "O"],
    ["graph:open", ["Mod"], "G"],
    ["command-palette:open", ["Mod"], "P"],
  ];
  /** A chord as Obsidian compares it: Mod resolved for the platform,
   * modifiers sorted, the key case-insensitive. */
  const norm = (modifiers, key, mac) =>
    modifiers.map((m) => (m === "Mod" ? (mac ? "Meta" : "Ctrl") : m)).sort().join("+") + "+" + String(key).toLowerCase();
  for (const mac of [true, false]) {
    const core = new Map(OBSIDIAN_1_13_DEFAULT_HOTKEYS.map(([id, mods, key]) => [norm(mods, key, mac), id]));
    const mine = pluginDefaultHotkeys(mac);
    for (const { id, hotkey } of mine) {
      const clash = core.get(norm(hotkey.modifiers, hotkey.key, mac));
      assert.equal(clash, undefined, `notion-flow:${id} (${hotkey.modifiers.join("+")}+${hotkey.key}) collides with ${clash} on ${mac ? "macOS" : "Windows/Linux"}`);
    }
    const ids = mine.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length, "one default per command id");
    const chords = mine.map((entry) => norm(entry.hotkey.modifiers, entry.hotkey.key, mac));
    assert.equal(new Set(chords).size, chords.length, "no two plugin defaults share a chord");
    const byId = new Map(mine.map((entry) => [entry.id, entry.hotkey]));
    // review-MB-1: ⌘⌥= / ⌘⌥⇧= on macOS only. Off macOS Ctrl+Alt is AltGr,
    // so those commands ship without a default there.
    assert.deepEqual(byId.get("insert-block-below"), mac ? { modifiers: ["Mod", "Alt"], key: "=" } : undefined);
    assert.deepEqual(byId.get("insert-block-above"), mac ? { modifiers: ["Mod", "Alt", "Shift"], key: "=" } : undefined);
    if (!mac) {
      for (const { id, hotkey } of mine) {
        const mods = hotkey.modifiers.map((m) => (m === "Mod" ? "Ctrl" : m));
        assert.ok(
          !(mods.includes("Ctrl") && mods.includes("Alt") && String(hotkey.key).length === 1),
          `notion-flow:${id} pairs Ctrl+Alt (AltGr on Windows) with the character key ${hotkey.key}`
        );
      }
    }
    assert.deepEqual(byId.get("turn-into-h1").modifiers, mac ? ["Mod", "Alt"] : ["Mod", "Shift"], "turn-into modifiers per platform");
    assert.deepEqual(byId.get("open-block-menu").modifiers, mac ? ["Mod", "Alt"] : ["Mod", "Shift"], "block menu follows them");
  }
  // The snapshot does hold the two chords the insert commands used to take.
  assert.ok(OBSIDIAN_1_13_DEFAULT_HOTKEYS.some(([id]) => id === "editor:open-link-in-new-split"));
  console.log("PASS default hotkeys: no plugin default equals a core Obsidian 1.13 default on either platform");
}

/* ---------- item 12: the Block chords grid, and Enter in a confirm dialog ---------- */
{
  const modal = { nodes: new Set(), contains(node) { return this.nodes.has(node); } };
  const cancel = { tagName: "BUTTON" };
  const confirm = { tagName: "BUTTON" };
  const outside = { tagName: "BUTTON" };
  const body = { tagName: "BODY" };
  modal.nodes.add(cancel).add(confirm);
  assert.equal(confirmEnterAction(cancel, modal, confirm), "default", "Enter on Cancel activates Cancel");
  assert.equal(confirmEnterAction(confirm, modal, confirm), "confirm", "Enter on the warning button confirms");
  assert.equal(confirmEnterAction(body, modal, confirm), "confirm", "nothing focused in the dialog: Enter confirms");
  assert.equal(confirmEnterAction(outside, modal, confirm), "confirm", "a button outside the dialog does not count");
  assert.equal(confirmEnterAction(null, modal, confirm), "confirm");

  // The test bundle runs as Windows/Linux (the stub's Platform.isMacOS is
  // false). review-MB-1: there the insert commands have no default chord,
  // so their rows carry the name alone; macOS keeps ⌘⌥= (checked above).
  const rows = blockChordRows(null, DEFAULT_SETTINGS);
  const insert = rows.find((row) => row.label === "Insert block below");
  assert.ok(insert && insert.chord === "", `Insert block below has no chord off macOS: ${JSON.stringify(insert)}`);
  assert.equal(rows.find((row) => row.label === "Insert block above")?.chord, "");
  assert.ok(
    rows.every((row) => row.label.length > 0 && (row.chord.length > 0 || /^Insert block (below|above)$/.test(row.label))),
    "no empty chord (other than the two insert rows off macOS) or label"
  );
  assert.ok(rows.some((row) => row.label === "Toggle"), "the toggle row while toggles are on");
  assert.ok(!blockChordRows(null, { ...DEFAULT_SETTINGS, toggleBlocks: false }).some((row) => row.label === "Toggle"), "and not while they are off");
  assert.ok(rows.every((row) => typeof row.chord === "string" && !row.chord.includes("[object")));
  console.log("PASS settings chords and confirm: grid rows carry every chord, Enter on Cancel cancels");
}

/* ---------- item 14: leaving a code block at the end of a note; /code in a list ---------- */
{
  /** [text, caret line, caret ch] after applying a plan (null stays null). */
  const run = (lines, lineNo, ch, planner) => {
    const doc = Text.of(lines);
    const plan = planner(doc, doc.line(lineNo).from + ch);
    if (!plan) return null;
    const out = doc.replace(plan.from, plan.to, Text.of(plan.insert.split("\n")));
    const line = out.lineAt(plan.cursor);
    return [out.toString(), line.number, plan.cursor - line.from];
  };
  const CODE = ["para", "", "```js", "const a = 1;", "```"];
  assert.deepEqual(
    run(CODE, 4, 12, codeBlockDownPlan),
    ["para\n\n```js\nconst a = 1;\n```\n", 6, 0],
    "the last body row at the end of the note: a new paragraph after the fence"
  );
  assert.deepEqual(run(CODE, 5, 3, codeBlockDownPlan), ["para\n\n```js\nconst a = 1;\n```\n", 6, 0], "the closing fence too");
  assert.equal(run([...CODE, "after"], 4, 12, codeBlockDownPlan), null, "a paragraph after the block: ArrowDown moves normally");
  assert.equal(run([...CODE, ""], 4, 12, codeBlockDownPlan), null, "a blank row after the block: ArrowDown moves normally");
  assert.equal(run(["```js", "a", "b", "```"], 2, 1, codeBlockDownPlan), null, "not on the last body row");
  assert.equal(run(["```js", "```"], 1, 3, codeBlockDownPlan), null, "the opener of an empty block is not a body row");
  assert.equal(run(["para", "```js", "const a = 1;"], 3, 3, codeBlockDownPlan), null, "an unclosed fence");
  const caption = buildBlockCaption("code", "Cap");
  assert.deepEqual(
    run([...CODE, caption], 4, 3, codeBlockDownPlan),
    ["para\n\n```js\nconst a = 1;\n```\n" + caption + "\n", 7, 0],
    "a caption row closes the block: the paragraph goes after it"
  );
  assert.deepEqual(
    run(["- item", "  ```js", "  x", "  ```"], 3, 3, codeBlockDownPlan),
    ["- item\n  ```js\n  x\n  ```\n  ", 5, 2],
    "in a list item the new row stays in the item"
  );

  assert.deepEqual(
    run(["```js", "x", "```", "after"], 2, 1, fenceExitPlan),
    ["```js\nx\n```\n\n\nafter", 4, 0],
    "⌘⇧Enter with a paragraph right below: the new row plus a blank seam"
  );
  {
    // …so typing "new" there leaves three separate blocks.
    const [text, line] = run(["```js", "x", "```", "after"], 2, 1, fenceExitPlan);
    const rows = text.split("\n");
    rows[line - 1] = "new";
    assert.equal(rows.join("\n"), "```js\nx\n```\nnew\n\nafter");
  }
  assert.deepEqual(
    run(["> [!note] T", "> ```js", "> x", "> ```", "> after"], 3, 3, fenceExitPlan),
    ["> [!note] T\n> ```js\n> x\n> ```\n> \n>\n> after", 5, 2],
    "inside a Callout the seam keeps its marker"
  );
  assert.deepEqual(
    run(["```js", "x", "```", "", "after"], 2, 1, fenceExitPlan),
    ["```js\nx\n```\n\nafter", 4, 0],
    "a waiting blank row is still reused"
  );
  assert.deepEqual(run(["```js", "x", "```"], 2, 1, fenceExitPlan), ["```js\nx\n```\n", 4, 0], "end of the note: no seam");
  assert.deepEqual(
    run(["```js", "x"], 2, 1, fenceExitPlan),
    ["```js\nx\n```\n", 4, 0],
    "an unclosed fence still gets its closer first"
  );

  let lines = [];
  const writer = {
    getLine: (n) => lines[n] ?? "",
    setCursor(cur) { writer.cursor = cur; },
    replaceRange(text, from, to) {
      const head = lines[from.line].slice(0, from.ch);
      const tail = lines[to.line].slice(to.ch);
      lines.splice(from.line, to.line - from.line + 1, ...(head + text + tail).split("\n"));
    },
  };
  const code = SLASH_COMMANDS.find((command) => command.id === "code");
  lines = ["- item /code"];
  SlashSuggest.insertSnippetInto(writer, { line: 0, ch: 7 }, { line: 0, ch: 12 }, code);
  assert.deepEqual(lines, ["- item ", "  ```", "  ", "  ```"], "/code in a list item indents the empty body row too");
  assert.deepEqual(writer.cursor, { line: 1, ch: 5 }, "the caret waits for the language");
  lines = ["/code"];
  SlashSuggest.insertSnippetInto(writer, { line: 0, ch: 0 }, { line: 0, ch: 5 }, code);
  assert.deepEqual(lines, ["```", "", "```"], "at the top level nothing changes");
  console.log("PASS code block exits: ArrowDown at the end of a note, ⌘⇧Enter seams, /code body row in a list");
}

/* ---------- item 15: Enter-Enter leaves a new toggle; Backspace on a last row leaves the box ---------- */
{
  /** A tiny editor: text plus caret, typing and the two plans. */
  const ed = (text, cursor) => ({ text, cursor });
  const apply = (state, planner) => {
    const doc = Text.of(state.text.split("\n"));
    const plan = planner(doc, state.cursor);
    if (!plan) return null;
    return ed(doc.replace(plan.from, plan.to, Text.of(plan.insert.split("\n"))).toString(), plan.cursor);
  };
  const enter = (state) => apply(state, quoteEnterPlan) ?? ed(state.text.slice(0, state.cursor) + "\n" + state.text.slice(state.cursor), state.cursor + 1);
  const type = (state, str) => ed(state.text.slice(0, state.cursor) + str + state.text.slice(state.cursor), state.cursor + str.length);
  const at = (text, lineNo, ch) => { const doc = Text.of(text.split("\n")); return ed(text, doc.line(lineNo).from + ch); };
  const fromTemplate = (template) => ed(template.replace("‸", ""), template.indexOf("‸"));

  // Enter at the end of the title moves into the waiting empty row.
  for (const template of [buildToggleTemplate(), "> [!note] ‸\n> "]) {
    let st = type(fromTemplate(template), "My title");
    const header = st.text.split("\n")[0];
    st = enter(st);
    assert.equal(st.text, header + "\n> ", `no second body row for ${JSON.stringify(template)}`);
    assert.equal(st.cursor, st.text.length, "the caret is in the waiting row");
    st = enter(type(st, "child one"));
    st = enter(st);
    st = type(st, "outside");
    assert.equal(st.text, header + "\n> child one\n\noutside", `Enter-Enter leaves ${JSON.stringify(template)}`);
  }
  // …and not when the row below is not a lone empty row of the same box.
  assert.deepEqual(
    apply(at("> [!note] T\n> body", 1, 11), quoteEnterPlan),
    ed("> [!note] T\n> \n> body", 14),
    "a title with body content below still opens a new row"
  );
  assert.deepEqual(
    apply(at("> [!note] T\n> \n> more", 1, 11), quoteEnterPlan),
    ed("> [!note] T\n> \n> \n> more", 14),
    "an empty row with siblings below is not a waiting row"
  );
  assert.deepEqual(
    apply(at("> [!note] T\n> > ", 1, 11), quoteEnterPlan),
    ed("> [!note] T\n> \n> > ", 14),
    "an empty row of a deeper level is not this box's"
  );
  assert.deepEqual(
    apply(at("> [!note] T\n> ", 1, 10), quoteEnterPlan),
    ed("> [!note] \n> T\n> ", 13),
    "only from the end of the title: mid-title Enter still splits it"
  );
  assert.deepEqual(
    apply(at("> [!nf-toggle]- T\n> ", 1, 17), quoteEnterPlan),
    ed("> [!nf-toggle]- T\n> \n> ", 20),
    "a collapsed toggle hides the waiting row, so Enter keeps adding one"
  );
  assert.deepEqual(
    apply(at("> [!nf-cols]\n> ", 1, 12), quoteEnterPlan)?.text,
    "> [!nf-cols]\n> \n> ",
    "scaffolding headers keep their own behaviour"
  );

  // Backspace at the start of a box's last row really leaves the box.
  const bs = (text, lineNo, ch) => apply(at(text, lineNo, ch), quoteBackspacePlan);
  assert.deepEqual(bs("> a\n> b", 2, 2), ed("> a\n\nb", 5), "a plain quote");
  assert.deepEqual(bs("> [!note] T\n> body", 2, 2), ed("> [!note] T\n\nbody", 13), "a Callout");
  assert.deepEqual(bs("> [!nf-toggle]+ T\n> body", 2, 2), ed("> [!nf-toggle]+ T\n\nbody", 19), "a toggle");
  assert.deepEqual(
    bs("> [!note] T\n> > [!tip] I\n> > inner", 3, 4),
    ed("> [!note] T\n> > [!tip] I\n>\n> inner", 29),
    "a nested Callout's last row lands in the outer box, behind a '>' seam"
  );
  assert.deepEqual(bs("> a\n> b\n> c", 2, 2), ed("> ab\n> c", 3), "a middle row still joins the row above");
  assert.deepEqual(bs("para\n\n> b", 3, 2), ed("para\n\nb", 6), "a lone quote row needs no seam");
  console.log("PASS quote and toggle exits: title Enter moves into the waiting row, last-row Backspace seals");
}

/* ---------- item 16: rows inside a rendered Callout are grabbable ---------- */
{
  /** A fake element: tag, classes and children, nothing else. */
  const el = (tag, cls = "", children = [], name = "") => ({
    tagName: tag.toUpperCase(),
    name,
    classList: { contains: (token) => cls.split(" ").includes(token) },
    children,
  });
  const box = () =>
    el("div", "callout", [
      el("div", "callout-title", [], "title"),
      el("div", "callout-content", [
        el("p", "", [], "first"),
        el("ul", "", [el("li", "", [], "a"), el("li", "", [], "b")]),
      ]),
    ]);
  const modern = box();
  const widget113 = el("div", "cm-embed-block cm-callout", [el("div", "markdown-rendered show-indentation-guide", [modern])]);
  assert.equal(renderedCalloutRoot(widget113), modern, "Obsidian 1.13: .cm-embed-block > .markdown-rendered > .callout");
  const legacy = box();
  assert.equal(renderedCalloutRoot(el("div", "cm-embed-block", [legacy])), legacy, "older builds: .callout right under the widget");
  assert.equal(renderedCalloutRoot(el("div", "cm-embed-block", [el("div", "other", [box()])])), null, "no deep search");
  assert.equal(renderedCalloutRoot(el("div", "cm-embed-block", [el("p")])), null);

  const doc = Text.of(["# Menu", "", "> [!note] T", "> First row", ">", "> - a", "> - b", "", "After."]);
  const rows = calloutRowsFromDom(modern, { startLine: 3, endLine: 7 }, doc);
  assert.ok(rows, "the rows line up");
  assert.deepEqual(
    rows.map((row) => [row.element.name, row.block.startLine, row.block.endLine]),
    [["title", 3, 3], ["first", 4, 4], ["a", 6, 6], ["b", 7, 7]],
    "title row, paragraph, then one row per list item"
  );
  const extra = el("div", "callout", [
    el("div", "callout-title"),
    el("div", "callout-content", [el("p"), el("p"), el("p"), el("p")]),
  ]);
  assert.equal(calloutRowsFromDom(extra, { startLine: 3, endLine: 7 }, doc), null, "markup the zip cannot account for: no rows");
  assert.equal(calloutRowsFromDom(el("div", "callout", []), { startLine: 3, endLine: 7 }, doc), null, "no title: no rows");
  console.log("PASS rendered callout rows: the 1.13 widget shape resolves, rows zip with the source blocks");
}
