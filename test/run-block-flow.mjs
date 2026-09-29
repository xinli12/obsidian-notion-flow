import { EditorState, EditorSelection } from "@codemirror/state";
import {
  moveBlock, blocksInLineSpan, scanFences, getBlockRange,
  toggleTaskLines, batchWrapIntoChanges, sameBlockRange, TURN_INTO_MODIFIERS,
  sameMetrics, caretMoveSwapsWidgets, landedBlocks, indentBlockChange,
  reindentInPlaceChange, selectionLineKey, batchTurnIntoChanges,
  innerBlockAt, findNextBlock, findPrevBlockStart, seamRowBetween, duplicateBlockChange,
} from "./bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
};
const mk = (text) => {
  let state = EditorState.create({ doc: text });
  return { get state() { return state; }, dispatch(s) { state = state.update(s).state; } };
};
const blockText = (doc, block) =>
  doc.sliceString(doc.line(block.startLine).from, doc.line(block.endLine).to);

/* ---- Drop landing: moveBlock returns the landed first line, and the
   span it covers resolves to exactly the moved block ---- */
{
  const v = mk("one\ntwo\n\nthree");
  const f = scanFences(v.state.doc);
  const block = getBlockRange(v.state.doc, 1, f);
  ok("two-line paragraph is one block", block.startLine === 1 && block.endLine === 2);
  const landed = moveBlock(v, block, v.state.doc.lines + 1, f);
  const doc = v.state.doc;
  // The protected removal leaves the block's first row behind as a seam.
  ok("moved below the third block", doc.toString().endsWith("three\n\none\ntwo"), JSON.stringify(doc.toString()));
  ok("landed is the moved block's first line", doc.line(landed).text === "one", String(landed));
  const blocks = blocksInLineSpan(doc, landed, landed + 1, scanFences(doc));
  ok("landing span is exactly one block", blocks.length === 1, JSON.stringify(blocks));
  ok("landed block text is the moved text", blockText(doc, blocks[0]) === "one\ntwo", JSON.stringify(blockText(doc, blocks[0])));
}

/* ---- Blank separator rows are not blocks: a marquee skips them, a span
   of nothing but blank rows selects nothing ---- */
{
  const doc = EditorState.create({ doc: "A\n\nB\n\nC" }).doc;
  const blocks = blocksInLineSpan(doc, 1, 5, scanFences(doc));
  ok("A, B and C are three blocks, the seams none",
    JSON.stringify(blocks.map((b) => [b.startLine, b.endLine])) === "[[1,1],[3,3],[5,5]]", JSON.stringify(blocks));
  const blank = EditorState.create({ doc: "\n\n" }).doc;
  ok("only blank rows: no blocks", blocksInLineSpan(blank, 1, blank.lines, scanFences(blank)).length === 0);
  // Even handed seam rows directly, a batch Turn into writes no bare prefix.
  const rows = [1, 2, 3, 4, 5].map((n) => ({ startLine: n, endLine: n }));
  let bare = 0;
  for (const prefix of ["# ", "## ", "- [ ] ", "- ", "1. ", "> "]) {
    const { changes, skipped } = batchTurnIntoChanges(doc, rows, prefix);
    bare += changes.filter((c) => /^(#+ |- \[ \] |- |1\. |> )$/.test(c.insert)).length;
    if (skipped !== 0) bare++;
  }
  ok("batch Turn into never turns a seam into a bare prefix", bare === 0, String(bare));
}

/* ---- Multi-block drag: a span over two paragraphs and their blank seam
   travels as one unit, seam and order intact ---- */
{
  const v = mk("a\n\nb\n\nc");
  const f = scanFences(v.state.doc);
  const selected = blocksInLineSpan(v.state.doc, 1, 3, f);
  ok("marquee over a..b holds two blocks (the blank seam is skipped)", selected.length === 2, String(selected.length));
  const first = selected[0];
  const last = selected[selected.length - 1];
  const span = { startLine: first.startLine, endLine: last.endLine, quotePrefix: first.quotePrefix, kind: "span" };
  const landed = moveBlock(v, span, v.state.doc.lines + 1, f);
  const doc = v.state.doc;
  ok("span moved below the third block, seam preserved", doc.toString().endsWith("c\n\na\n\nb"), JSON.stringify(doc.toString()));
  ok("landed is the span's first line", doc.line(landed).text === "a" && doc.line(landed + 2).text === "b", String(landed));
  const spanLines = span.endLine - span.startLine + 1;
  const reselected = blocksInLineSpan(doc, landed, landed + spanLines - 1, scanFences(doc));
  ok("re-selection covers a and b, not the seam", reselected.length === 2 &&
    blockText(doc, reselected[0]) === "a" && blockText(doc, reselected[1]) === "b",
    JSON.stringify(reselected));
}
{
  // Upward move of a span keeps the same shape.
  const v = mk("c\n\na\n\nb");
  const f = scanFences(v.state.doc);
  const landed = moveBlock(v, { startLine: 3, endLine: 5 }, 1, f);
  ok("span moved above", v.state.doc.toString().startsWith("a\n\nb\n\nc"), JSON.stringify(v.state.doc.toString()));
  ok("upward landed line is 1", landed === 1, String(landed));
}

/* ---- sameBlockRange ---- */
{
  ok("sameBlockRange matches rows", sameBlockRange({ startLine: 1, endLine: 2 }, { startLine: 1, endLine: 2, quotePrefix: "> " }));
  ok("sameBlockRange rejects different rows", !sameBlockRange({ startLine: 1, endLine: 2 }, { startLine: 1, endLine: 3 }));
  ok("sameBlockRange tolerates null", !sameBlockRange(null, { startLine: 1, endLine: 1 }));
}

/* ---- Mod+Enter: toggleTaskLines flips boxes, adds one to paragraphs ---- */
{
  const v = mk("para\n- [ ] a\n- [x] b");
  const f = scanFences(v.state.doc);
  const blocks = blocksInLineSpan(v.state.doc, 1, 3, f);
  const changes = toggleTaskLines(v.state.doc, blocks);
  v.dispatch({ changes });
  ok("tasks toggled, paragraph became a to-do",
    v.state.doc.toString() === "- [ ] para\n- [x] a\n- [ ] b", JSON.stringify(v.state.doc.toString()));
}
{
  const v = mk("# heading\n> quoted\n```\ncode\n```\n---\n| a |\n\n  indented para\n1. [X] upper");
  const f = scanFences(v.state.doc);
  const blocks = blocksInLineSpan(v.state.doc, 1, v.state.doc.lines, f);
  const changes = toggleTaskLines(v.state.doc, blocks);
  v.dispatch({ changes });
  ok("structural rows untouched, indented paragraph and numbered task handled",
    v.state.doc.toString() === "# heading\n> quoted\n```\ncode\n```\n---\n| a |\n\n  - [ ] indented para\n1. [ ] upper",
    JSON.stringify(v.state.doc.toString()));
}
{
  // A row inside a Callout keeps its quote markers ahead of the new box.
  const v = mk("> [!note]\n> body");
  const changes = toggleTaskLines(v.state.doc, [{ startLine: 2, endLine: 2, quotePrefix: "> " }]);
  v.dispatch({ changes });
  ok("callout row gets a box after its marker", v.state.doc.toString() === "> [!note]\n> - [ ] body", JSON.stringify(v.state.doc.toString()));
}
{
  // Bare list items take a box after their own marker (Obsidian's toggle
  // does the same); the numbered marker and indentation survive.
  const v = mk("- one\n- two\n\n1. three\n  * four");
  const f = scanFences(v.state.doc);
  const blocks = blocksInLineSpan(v.state.doc, 1, v.state.doc.lines, f);
  const changes = toggleTaskLines(v.state.doc, blocks);
  v.dispatch({ changes });
  ok("bullet items become to-dos",
    v.state.doc.toString() === "- [ ] one\n- [ ] two\n\n1. [ ] three\n  * [ ] four",
    JSON.stringify(v.state.doc.toString()));
}
{
  // A quoted list row inside a Callout keeps its quote markers and marker.
  const v = mk("> [!note]\n> - item");
  const changes = toggleTaskLines(v.state.doc, [{ startLine: 2, endLine: 2, quotePrefix: "> " }]);
  v.dispatch({ changes });
  ok("quoted list item gets a box after its marker", v.state.doc.toString() === "> [!note]\n> - [ ] item", JSON.stringify(v.state.doc.toString()));
}
{
  // Second press flips the boxes the first one added.
  const v = mk("- one\n- two");
  const f = scanFences(v.state.doc);
  const blocks = blocksInLineSpan(v.state.doc, 1, 2, f);
  v.dispatch({ changes: toggleTaskLines(v.state.doc, blocks) });
  v.dispatch({ changes: toggleTaskLines(v.state.doc, blocks) });
  ok("toggling twice ticks the new boxes", v.state.doc.toString() === "- [x] one\n- [x] two", JSON.stringify(v.state.doc.toString()));
}

/* ---- Wrap chords over a selection: one change set, structural skips ---- */
{
  const v = mk("a\n\nb\n\n```\ncode\n```");
  const f = scanFences(v.state.doc);
  const blocks = blocksInLineSpan(v.state.doc, 1, v.state.doc.lines, f).filter((b) => !/^\s*$/.test(blockText(v.state.doc, b)));
  const result = batchWrapIntoChanges(v.state.doc, blocks, "callout", f);
  ok("two paragraphs wrapped, fence skipped", result.changes.length === 2 && result.skipped === 1, JSON.stringify(result));
  v.dispatch({ changes: result.changes });
  ok("wrapped both into callouts",
    v.state.doc.toString() === "> [!note] \n> a\n\n> [!note] \n> b\n\n```\ncode\n```", JSON.stringify(v.state.doc.toString()));
}

/* ---- The turn-into chord modifiers are shared module state ---- */
{
  ok("TURN_INTO_MODIFIERS is a modifier list", Array.isArray(TURN_INTO_MODIFIERS) && TURN_INTO_MODIFIERS.includes("Mod"));
}

/* ---- Callout metrics: a remeasure within half a pixel publishes nothing ---- */
{
  const m = { contentInset: 39, codeEnd: 15, codePad: 16, codeGap: 17, topAir: 11, bottomAir: 13 };
  ok("identical metrics are the same", sameMetrics(m, { ...m }));
  ok("sub-pixel drift is the same", sameMetrics(m, { ...m, contentInset: 39.4, topAir: 10.6 }));
  ok("a 1px change is a new column", !sameMetrics(m, { ...m, codeGap: 18 }));
  ok("null against a measurement differs", !sameMetrics(null, m) && !sameMetrics(m, null));
  ok("two nulls are the same", sameMetrics(null, null));
}

/* ---- Nested-indent sync: only caret moves that can swap a widget for
   its source (or back) schedule a pass ---- */
{
  const text = "para one\n\npara two\n\n> [!note]\n> body\n\n```js\ncode\n```\n\n- item\n  > quoted\n- > inline";
  const v = mk(text);
  const doc = v.state.doc;
  const f = scanFences(doc);
  ok("same row is no swap", !caretMoveSwapsWidgets(doc, 1, 1, f));
  ok("paragraph to paragraph is no swap", !caretMoveSwapsWidgets(doc, 1, 3, f));
  ok("into a callout swaps", caretMoveSwapsWidgets(doc, 3, 6, f));
  ok("out of a callout swaps", caretMoveSwapsWidgets(doc, 5, 3, f));
  ok("inside one callout is no swap", !caretMoveSwapsWidgets(doc, 5, 6, f));
  ok("into a fence swaps", caretMoveSwapsWidgets(doc, 3, 9, f));
  ok("inside one fence is no swap", !caretMoveSwapsWidgets(doc, 8, 9, f));
  ok("fence to callout swaps", caretMoveSwapsWidgets(doc, 9, 6, f));
  ok("list item into its quoted row swaps", caretMoveSwapsWidgets(doc, 12, 13, f));
  ok("quoted row into an inline list quote swaps", caretMoveSwapsWidgets(doc, 13, 14, f));
  ok("paragraph to an inline list quote swaps", caretMoveSwapsWidgets(doc, 1, 14, f));
}

/* ---- Landing inside a Callout: the selection is the row that landed,
   not the whole box its ">" markers now belong to (flow-1) ---- */
{
  const v = mk("para\n\n> [!note]\n> one\n> two");
  const f = scanFences(v.state.doc);
  const block = getBlockRange(v.state.doc, 1, f);
  // Dropped between the two Callout rows, requoted into it.
  const landed = moveBlock(v, block, 5, f, undefined, undefined, "> ");
  const doc = v.state.doc;
  // The first block leaves no leading blank row behind (item 9).
  ok("paragraph joined the Callout between seam rows",
    doc.toString() === "> [!note]\n> one\n>\n> para\n>\n> two", JSON.stringify(doc.toString()));
  ok("landed is the moved row, not the seam sealed in above it",
    doc.line(landed).text === "> para", `${landed}: ${JSON.stringify(doc.line(landed).text)}`);
  const inside = landedBlocks(doc, landed, 1, true, scanFences(doc));
  ok("inside a Callout the landed row alone is selected, with its quote prefix",
    inside.length === 1 && inside[0].startLine === landed && inside[0].endLine === landed &&
      inside[0].quotePrefix === "> ",
    JSON.stringify(inside));
  const outside = landedBlocks(doc, landed, 1, false, scanFences(doc));
  ok("the plain span would have grabbed the whole Callout",
    outside.length === 1 && outside[0].startLine < landed && outside[0].endLine > landed,
    JSON.stringify(outside));
}
{
  // A right-edge column drop lands on a content row inside the columns box.
  const text = "> [!nf-cols]\n> > [!nf-col]\n> > a\n>\n> > [!nf-col]\n> > b";
  const doc = EditorState.create({ doc: text }).doc;
  const f = scanFences(doc);
  const inside = landedBlocks(doc, 6, 1, true, f);
  ok("column drop selects the dropped row inside its column",
    inside.length === 1 && inside[0].startLine === 6 && inside[0].endLine === 6 &&
      inside[0].quotePrefix === "> > ",
    JSON.stringify(inside));
  const outside = landedBlocks(doc, 6, 1, false, f);
  ok("the plain span would have grabbed the whole columns block",
    outside.length === 1 && outside[0].startLine === 1 && outside[0].endLine === 6,
    JSON.stringify(outside));
  // Top level: identical to blocksInLineSpan, seam rows skipped.
  const plain = EditorState.create({ doc: "a\n\nb\n\nc" }).doc;
  const span = landedBlocks(plain, 1, 3, false, scanFences(plain));
  ok("top-level landing is the marquee span (seam skipped)", span.length === 2, JSON.stringify(span));
}

/* ---- Tab over a selection: one change per block against the same
   document, dispatched as ONE transaction, so one undo restores all
   (flow-4) ---- */
{
  const v = mk("- a\n- b\n- c");
  const f = scanFences(v.state.doc);
  const blocks = blocksInLineSpan(v.state.doc, 2, 3, f);
  ok("two sibling items selected", blocks.length === 2, JSON.stringify(blocks));
  const changes = blocks.map((b) => indentBlockChange(v.state.doc, b, 1, f)).filter(Boolean);
  ok("both items can step in", changes.length === 2, JSON.stringify(changes));
  const tr = v.state.update({
    changes: changes.map(({ from, to, insert }) => ({ from, to, insert })),
    userEvent: "move.block.batch",
  });
  ok("one transaction steps both", tr.state.doc.toString() === "- a\n  - b\n  - c", JSON.stringify(tr.state.doc.toString()));
  const restored = tr.state.update({ changes: tr.changes.invert(tr.startState.doc) }).state.doc;
  ok("a single undo restores both", restored.toString() === "- a\n- b\n- c", JSON.stringify(restored.toString()));
  ok("mapped span ends cover the stepped rows",
    tr.state.doc.lineAt(tr.changes.mapPos(v.state.doc.line(2).from)).number === 2 &&
      tr.state.doc.lineAt(tr.changes.mapPos(v.state.doc.line(3).to, 1)).number === 3);
  // Same result as stepping one at a time, bottom-up.
  const w = mk("- a\n- b\n- c");
  for (let i = blocks.length - 1; i >= 0; i--) {
    const c = indentBlockChange(w.state.doc, blocks[i], 1, scanFences(w.state.doc));
    if (c) w.dispatch({ changes: { from: c.from, to: c.to, insert: c.insert } });
  }
  ok("batch equals sequential stepping", w.state.doc.toString() === tr.state.doc.toString());
}
{
  const v = mk("- a\n- b");
  const f = scanFences(v.state.doc);
  const b = getBlockRange(v.state.doc, 2, f);
  ok("no level to move to yields null", indentBlockChange(v.state.doc, b, -1, f) === null);
  ok("same indent, no requote is no change", reindentInPlaceChange(v.state.doc, b, 0, undefined, undefined, f) === null);
  const change = reindentInPlaceChange(v.state.doc, b, 2, undefined, undefined, f);
  ok("in-place change re-indents the row", change && change.insert === "  - b" && change.landedOffset === 0, JSON.stringify(change));
  const landed = moveBlock(v, b, 2, f, 2);
  ok("moveBlock in place spells the same edit", v.state.doc.toString() === "- a\n  - b" && landed === 2, JSON.stringify(v.state.doc.toString()));
}

console.log("PASS block flow: drop landing, span drag, task toggle, batch wrap, metrics, caret swaps, callout landing, batch indent");

/* ---- Comment tooltips: the title pass keys on the selection's line span ---- */
{
  const doc = "one\ntwo\nthree\nfour\nfive\nsix";
  const at = (spec) => EditorState.create({ doc, selection: spec });
  const line = (n) => EditorState.create({ doc }).doc.line(n);
  const a = at({ anchor: line(2).from });
  const b = at({ anchor: line(2).from + 2 });
  ok("caret sliding along one row keeps the key", selectionLineKey(a) === selectionLineKey(b), selectionLineKey(a));
  const multi = at({ anchor: line(6).from + 1, head: line(2).from + 1 });
  const collapsed = at({ anchor: line(2).from + 1 });
  ok("multi-line selection spans its lines", selectionLineKey(multi) === "2:6", selectionLineKey(multi));
  ok("collapsing onto the head's own line changes the key",
    selectionLineKey(multi) !== selectionLineKey(collapsed), selectionLineKey(collapsed));
  const extended = at({ anchor: line(2).from + 1, head: line(4).to });
  ok("extending the selection by a line changes the key",
    selectionLineKey(extended) !== selectionLineKey(collapsed) && selectionLineKey(extended) === "2:4",
    selectionLineKey(extended));
  const cursors = EditorState.create({
    doc,
    selection: EditorSelection.create([EditorSelection.cursor(line(2).from), EditorSelection.cursor(line(5).from)]),
    extensions: EditorState.allowMultipleSelections.of(true),
  });
  ok("a second cursor adds its line to the key", selectionLineKey(cursors) === "2:2,5:5", selectionLineKey(cursors));
}

/* ---- Item 9: moving blocks keeps one blank seam; a move and its opposite
   restore the note byte for byte ---- */
{
  // moveBlockVert without the editor.
  const down = (v, line) => {
    const f = scanFences(v.state.doc);
    const b = innerBlockAt(v.state.doc, line, f);
    const n = findNextBlock(v.state.doc, f, b);
    return moveBlock(v, b, n.endLine + 1, f);
  };
  const up = (v, line) => {
    const f = scanFences(v.state.doc);
    const b = innerBlockAt(v.state.doc, line, f);
    return moveBlock(v, b, findPrevBlockStart(v.state.doc, f, b), f);
  };
  const LIST_DOC = "Alpha para line one.\nAlpha line two.\n\n- item a\n- item b\n  - child b1\n- item c";
  {
    const v = mk(LIST_DOC);
    const landed = down(v, 1);
    ok("item 9: a paragraph moved into a list keeps a blank row on both sides",
      v.state.doc.toString() ===
        "- item a\n\nAlpha para line one.\nAlpha line two.\n\n- item b\n  - child b1\n- item c",
      JSON.stringify(v.state.doc.toString()));
    up(v, landed);
    ok("item 9: Alt+Down then Alt+Up restores the list doc", v.state.doc.toString() === LIST_DOC,
      JSON.stringify(v.state.doc.toString()));
  }
  const roundTrips = [
    ["a list item between paragraphs", "Para1\n\n- item\n\nPara2", 3],
    ["a quote", "P1 line.\n\n> quote", 1],
    ["a quote (moving the quote)", "P1 line.\n\n> quote\n\nP3", 3],
    ["a Callout", "P1\n\n> [!tip] T\n> body\n\nP2", 3],
    ["a fenced code block", "P1\n\n```js\nx\n```\n\nP2", 3],
    ["the note's first block", "AAA first\n\nBBB second\n\nCCC third", 1],
    ["the note's first block, trailing newline", "AAA first\n\nBBB second\n\nCCC third\n", 1],
    ["the last item of a list", "- a\n- b\n\nPara", 2],
  ];
  for (const [name, text, line] of roundTrips) {
    const v = mk(text);
    const landed = down(v, line);
    up(v, landed);
    ok(`item 9: down then up restores ${name}`, v.state.doc.toString() === text,
      JSON.stringify(v.state.doc.toString()));
  }
  for (const [name, text, line] of [
    ["the note's last block", "A\n\nB\n\nC\n", 5],
    ["the note's last block, no trailing newline", "A\n\nB\n\nC", 5],
    ["the first item of a list", "Para one.\n\nPara two.\n\n- a\n- b", 5],
  ]) {
    const v = mk(text);
    const landed = up(v, line);
    const mid = v.state.doc.toString();
    down(v, landed);
    ok(`item 9: up then down restores ${name}`, v.state.doc.toString() === text,
      JSON.stringify(mid) + " -> " + JSON.stringify(v.state.doc.toString()));
  }
  {
    const v = mk("A\n\nB\n\nC\n");
    up(v, 5);
    ok("item 9: moving the last block up keeps exactly one trailing newline",
      v.state.doc.toString() === "A\n\nC\n\nB\n", JSON.stringify(v.state.doc.toString()));
  }
  // End-of-note drops onto the final empty line keep one blank row above.
  for (const box of ["> [!tip] T\n> body", "> quote", "- item"]) {
    const v = mk("# T\n\n" + box + "\n\nFirst paragraph.\n\nThird paragraph.\n");
    const f = scanFences(v.state.doc);
    moveBlock(v, innerBlockAt(v.state.doc, 3, f), v.state.doc.lines, f);
    ok(`item 9: ${JSON.stringify(box.split("\n")[0])} dropped on the last empty line keeps a blank row`,
      v.state.doc.toString() === "# T\n\nFirst paragraph.\n\nThird paragraph.\n\n" + box + "\n",
      JSON.stringify(v.state.doc.toString()));
  }
  {
    // w1c-drag-first-block-seam: the drop path, first block to the end.
    for (const nl of ["", "\n"]) {
      const v = mk("AAA first\n\nBBB second\n\nCCC third" + nl);
      const f = scanFences(v.state.doc);
      moveBlock(v, innerBlockAt(v.state.doc, 1, f), v.state.doc.lines + 1, f);
      ok(`w1c: the first block dropped at the end leaves no leading blank${nl ? " (trailing newline kept)" : ""}`,
        v.state.doc.toString() === "BBB second\n\nCCC third\n\nAAA first" + nl,
        JSON.stringify(v.state.doc.toString()));
    }
  }
  {
    for (const [text, target] of [["# T\nFirst paragraph.\n\nX para", 2], ["# T\n\nFirst paragraph.\n\nX para", 3]]) {
      const v = mk(text);
      const f = scanFences(v.state.doc);
      moveBlock(v, innerBlockAt(v.state.doc, v.state.doc.lines, f), target, f);
      ok(`item 9: a paragraph dropped between "# T" and "First paragraph." gets blank rows on both sides (${target})`,
        v.state.doc.toString() === "# T\n\nX para\n\nFirst paragraph.", JSON.stringify(v.state.doc.toString()));
    }
    const tight = mk("- a\n- b\n- c");
    const f = scanFences(tight.state.doc);
    moveBlock(tight, innerBlockAt(tight.state.doc, 3, f), 1, f);
    ok("item 9: list items stay tight", tight.state.doc.toString() === "- c\n- a\n- b", JSON.stringify(tight.state.doc.toString()));
    const between = mk("- a\n- b\n\nPara");
    const f2 = scanFences(between.state.doc);
    moveBlock(between, innerBlockAt(between.state.doc, 4, f2), 2, f2);
    ok("item 9: a paragraph between list items has a blank row on both sides",
      between.state.doc.toString() === "- a\n\nPara\n\n- b", JSON.stringify(between.state.doc.toString()));
  }
  ok("item 9: style seam between a paragraph and a Callout", seamRowBetween("para", "> [!tip] T", "", "style") === "");
  ok("item 9: no style seam between two list items", seamRowBetween("- a", "- b", "", "style") === null);
  ok("item 9: indented rows keep the protected seam",
    seamRowBetween("- a", "  para", "", "style") === seamRowBetween("- a", "  para", ""));
  ok("item 9: no style seam next to a blank row", seamRowBetween("", "para", "", "style") === null);
  ok("item 9: protect mode is unchanged", seamRowBetween("# H", "para", "") === null && seamRowBetween("# H", "para", "", "style") === "");
  ok("item 9: containers are unchanged in style mode", seamRowBetween("> a", "> b", "> ", "style") === ">");
  // Duplicate: one change builder for both paths.
  {
    const apply = (text, line) => {
      const state = EditorState.create({ doc: text });
      const f = scanFences(state.doc);
      const block = innerBlockAt(state.doc, line, f);
      const copy = duplicateBlockChange(state.doc, block);
      const next = state.update({ changes: { from: copy.from, insert: copy.insert } }).state;
      return { copy, doc: next.doc, block };
    };
    const para = apply("Bravo para.\n\nNext", 1);
    ok("item 9: Duplicate puts a blank row between a paragraph and its copy",
      para.doc.toString() === "Bravo para.\n\nBravo para.\n\nNext", JSON.stringify(para.doc.toString()));
    ok("item 9: Duplicate landing line for a paragraph (seam \"\")",
      para.copy.seam === "" && para.copy.copyLine === para.block.endLine + 2 &&
        para.doc.line(para.copy.copyLine).text === "Bravo para.", JSON.stringify(para.copy));
    const item = apply("- a\n- b", 1);
    ok("item 9: Duplicate keeps list items tight (seam null)",
      item.doc.toString() === "- a\n- a\n- b" && item.copy.seam === null && item.copy.copyLine === 2,
      JSON.stringify([item.doc.toString(), item.copy]));
    const row = apply("> [!note] T\n> one\n> two", 2);
    ok("item 9: Duplicate inside a Callout seams with an empty quote row",
      row.doc.toString() === "> [!note] T\n> one\n> two\n>\n> one\n> two" && row.copy.copyLine === 5,
      JSON.stringify(row.doc.toString()));
  }
}

if (fail) { console.log(`${fail} failure(s)`); process.exit(1); }
