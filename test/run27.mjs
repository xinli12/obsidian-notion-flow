import { EditorState } from "@codemirror/state";
import {
  computeDropLevels,
  findSiblingBlock,
  innerBlockAt,
  insertBlockBelow,
  moveBlock,
  pickDropLevel,
  quoteInnerBlocks,
  quotePrefixLadder,
  scanFences,
  seamRowBetween,
  splitQuoteMarkers,
} from "./bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));

const docOf = (text) => EditorState.create({ doc: text }).doc;
const makeView = (text) => {
  let state = EditorState.create({ doc: text });
  return {
    get state() { return state; },
    dispatch(spec) { state = state.update(spec).state; },
    focus() {},
    dom: { ownerDocument: { defaultView: { setTimeout() {} } } },
  };
};
const block = (doc, line) => {
  const range = innerBlockAt(doc, line, scanFences(doc));
  return range && [range.startLine, range.endLine, range.quotePrefix ?? ""];
};

/* ------------------------------------------------------------------ */
/* Rows inside a Callout are blocks of their own                       */
/* ------------------------------------------------------------------ */

{
  const doc = docOf(
    ["> [!note] Title", "> first", ">", "> second", "", "after"].join("\n")
  );
  eq("the title row grabs the whole Callout", block(doc, 1), [1, 4, ""]);
  eq("a body row is its own block", block(doc, 2), [2, 2, "> "]);
  eq("the row after the seam is its own block", block(doc, 4), [4, 4, "> "]);
  eq("the seam row is grabbable too", block(doc, 3), [3, 3, "> "]);
  eq("a marker-only row still reports a level", block(doc, 3)[2], "> ");
  eq("text outside is untouched", block(doc, 6), [6, 6, ""]);
}

{
  // A plain quote's rows ARE one paragraph — Markdown says so, and there
  // is nothing finer to grab.
  const doc = docOf(["> one", "> two"].join("\n"));
  eq("a soft-wrapped quote paragraph stays whole", block(doc, 2), [1, 2, ""]);
}

{
  const doc = docOf(["> [!info]", "> - a", "> - b", "> - c"].join("\n"));
  eq("a list item inside a Callout is one block", block(doc, 3), [3, 3, "> "]);
  eq(
    "every row of the Callout list is reachable",
    [block(doc, 2), block(doc, 4)],
    [[2, 2, "> "], [4, 4, "> "]]
  );
}

{
  const doc = docOf(
    ["> [!note]", "> - parent", ">   - child", ">", "> tail"].join("\n")
  );
  eq("a list item carries its children", block(doc, 2), [2, 3, "> "]);
  eq("the child alone is grabbable", block(doc, 3), [3, 3, "> "]);
  eq("the paragraph after the list is its own", block(doc, 5), [5, 5, "> "]);
}

{
  const doc = docOf(
    ["> [!note]", "> ```js", "> code", "> ```", "> after"].join("\n")
  );
  eq("a fence inside a Callout is one block", block(doc, 3), [2, 4, "> "]);
  eq("the row after the fence is its own", block(doc, 5), [5, 5, "> "]);
}

{
  const doc = docOf(
    [
      "> [!note] Outer",
      "> > [!warning] Inner",
      "> > body",
      "> >",
      "> > more",
    ].join("\n")
  );
  eq("the nested Callout header grabs the nested box", block(doc, 2), [2, 5, "> "]);
  eq("a row of the nested Callout is its own block", block(doc, 3), [3, 3, "> > "]);
  eq("and so is the one past its seam", block(doc, 5), [5, 5, "> > "]);
}

{
  const doc = docOf(["> [!note] Title", "> body"].join("\n"));
  eq(
    "quoteInnerBlocks lists what a Callout holds",
    quoteInnerBlocks(doc, { startLine: 1, endLine: 2 }, scanFences(doc)).map(
      (b) => [b.startLine, b.endLine]
    ),
    [[2, 2]]
  );
  const listDoc = docOf(
    ["> [!note]", "> intro", ">", "> - a", "> - b", "> end"].join("\n")
  );
  eq(
    "seam rows are not blocks to move",
    quoteInnerBlocks(listDoc, { startLine: 1, endLine: 6 }, scanFences(listDoc)).map(
      (b) => [b.startLine, b.endLine]
    ),
    [[2, 2], [4, 4], [5, 6]]
  );
}

eq("markers split off one level at a time", splitQuoteMarkers("> > x", 1), {
  prefix: "> ",
  rest: "> x",
});
eq("a lazy continuation carries no marker", splitQuoteMarkers("  tail", 2), {
  prefix: "",
  rest: "  tail",
});

/* ------------------------------------------------------------------ */
/* Moving a row inside, out of, and into a Callout                     */
/* ------------------------------------------------------------------ */

const moveRow = (lines, from, to, prefix) => {
  const view = makeView(lines.join("\n"));
  const fences = scanFences(view.state.doc);
  const source = innerBlockAt(view.state.doc, from, fences);
  moveBlock(view, source, to, fences, 0, undefined, prefix);
  return view.state.doc.toString().split("\n");
};

eq(
  "a row reorders inside its Callout",
  moveRow(["> [!note]", "> a", ">", "> b"], 4, 2, "> "),
  ["> [!note]", "> b", ">", "> a"]
);

eq(
  "a list row reorders without gaining a seam",
  moveRow(["> [!note]", "> - a", "> - b", "> - c"], 4, 2, "> "),
  ["> [!note]", "> - c", "> - a", "> - b"]
);

eq(
  "a row dragged out of a Callout loses its markers, and its seam row",
  moveRow(["> [!note]", "> a", ">", "> b", "", "after"], 4, 6, ""),
  ["> [!note]", "> a", "", "b", "", "after"]
);

eq(
  "a paragraph dragged into a Callout gains them",
  moveRow(["> [!note]", "> a", "", "loose"], 4, 3, "> "),
  ["> [!note]", "> a", ">", "> loose", ""]
);

eq(
  "a whole Callout keeps its own markers when it moves",
  moveRow(["intro", "", "> [!note]", "> a", "", "tail"], 3, 1, ""),
  ["> [!note]", "> a", "", "intro", "", "tail"]
);

eq(
  "a Callout dropped into a Callout nests",
  moveRow(["> [!note]", "> a", "", "> [!tip]", "> b"], 4, 3, "> "),
  ["> [!note]", "> a", "> > [!tip]", "> > b", ""]
);

{
  // In place, but dragged left: the row leaves the container where it is.
  const view = makeView(["> [!note]", "> a", ">", "> b"].join("\n"));
  const fences = scanFences(view.state.doc);
  const row = innerBlockAt(view.state.doc, 4, fences);
  moveBlock(view, row, 4, fences, 0, undefined, "");
  eq(
    "a horizontal drag alone lifts a row out",
    view.state.doc.toString().split("\n"),
    ["> [!note]", "> a", ">", "", "b"]
  );
}

/* ------------------------------------------------------------------ */
/* Seams                                                               */
/* ------------------------------------------------------------------ */

eq(
  "two paragraphs inside a Callout need a quoted seam",
  seamRowBetween("> a", "> b", "> "),
  ">"
);
eq("a quoted fence needs no seam", seamRowBetween("> a", "> ```js", "> "), null);
eq("two plain paragraphs still take a blank line", seamRowBetween("a", "b"), "");
eq(
  "a list row inside a Callout needs no seam",
  seamRowBetween("> - a", "> - b", "> "),
  null
);
eq("nesting depth is respected", seamRowBetween("> > a", "> > b", "> > "), "> >");
eq(
  "a Callout title introduces its content",
  seamRowBetween("> [!note] T", "> body", "> "),
  null
);
eq(
  "two Callouts side by side still need a blank line",
  seamRowBetween("> [!a] one", "> [!b] two"),
  ""
);

/* ------------------------------------------------------------------ */
/* The drop ladder                                                     */
/* ------------------------------------------------------------------ */

eq("a ladder has one rung per marker", quotePrefixLadder("> > "), ["> ", "> > "]);
eq("no markers, no rungs", quotePrefixLadder(""), []);

{
  const doc = docOf(["> [!note]", "> a", "> b", "", "after"].join("\n"));
  const fences = scanFences(doc);
  const levels = computeDropLevels(doc, fences, 3, { startLine: 3, endLine: 3 });
  eq(
    "a seam inside a Callout offers inside and outside",
    levels,
    [{ quotePrefix: "", indent: 0 }, { quotePrefix: "> ", indent: 0 }]
  );
  eq(
    "pointing inside a Callout drops inside it",
    pickDropLevel(levels, "> ", 0, 0, 32),
    { quotePrefix: "> ", indent: 0 }
  );
  eq(
    "one step left lifts the drop out",
    pickDropLevel(levels, "> ", 0, -34, 32),
    { quotePrefix: "", indent: 0 }
  );
  eq(
    "pointing outside stays outside",
    pickDropLevel(levels, "", 0, 0, 32),
    { quotePrefix: "", indent: 0 }
  );
  eq(
    "one step right tucks a loose block in",
    pickDropLevel(levels, "", 0, 34, 32),
    { quotePrefix: "> ", indent: 0 }
  );
}

{
  // Landing in front of a Callout header would stop it rendering, so the
  // seam above a Callout offers no quote level at all.
  const doc = docOf(["intro", "", "> [!note]", "> a"].join("\n"));
  const fences = scanFences(doc);
  const levels = computeDropLevels(doc, fences, 3);
  ok(
    "no rung leads in front of a Callout title",
    levels.every((level) => level.quotePrefix === ""),
    JSON.stringify(levels)
  );
  eq(
    "a row pointed at the title row still drops above the Callout",
    pickDropLevel(levels, "> ", 0, 0, 32).quotePrefix,
    ""
  );
}

/* ------------------------------------------------------------------ */
/* The whole gesture, end to end                                       */
/*                                                                     */
/* Mirrors what updateDropTarget()/handleDrop() do with a pointer:      */
/* resolve the row under it, snap to a block seam, pick the level from  */
/* horizontal travel, then move.                                       */
/* ------------------------------------------------------------------ */

const drag = (lines, grabLine, pointLine, half, deltaX = 0) => {
  const view = makeView(lines.join("\n"));
  const doc = view.state.doc;
  const fences = scanFences(doc);
  const source = innerBlockAt(doc, grabLine, fences);
  const pointed = doc.line(pointLine).text;
  const pointedPrefix = (pointed.match(/^[ \t]*(?:>[ \t]?)+/) ?? [""])[0]
    .replace(/^[ \t]+/, "");
  let target = half === "top" ? pointLine : pointLine + 1;
  const snap = target <= doc.lines ? innerBlockAt(doc, target, fences) : null;
  if (snap && snap.startLine < target && snap.endLine + 1 > target) {
    target = half === "top" ? snap.startLine : snap.endLine + 1;
  }
  const levels = computeDropLevels(doc, fences, target, source);
  const level = pickDropLevel(levels, pointedPrefix, 0, deltaX, 32);
  moveBlock(view, source, target, fences, level.indent, undefined, level.quotePrefix);
  return view.state.doc.toString().split("\n");
};

eq(
  "dragging a row onto another row of the same Callout reorders it",
  drag(["> [!note] T", "> a", ">", "> b", "", "tail"], 4, 2, "top"),
  ["> [!note] T", "> b", ">", "> a", "", "tail"]
);

eq(
  "dropping a row on the paragraph below the Callout leaves the box",
  drag(["> [!note] T", "> a", ">", "> b", "", "tail"], 2, 6, "top"),
  ["> [!note] T", "> b", "", "a", "", "tail"]
);

eq(
  "dropping a loose paragraph on a Callout row joins the Callout",
  drag(["> [!note] T", "> a", "", "tail"], 4, 2, "bottom"),
  ["> [!note] T", "> a", ">", "> tail", ""]
);

eq(
  "the same drop dragged one step left stays outside",
  drag(["> [!note] T", "> a", "", "tail"], 4, 2, "bottom", -40),
  ["> [!note] T", "> a", "", "tail"]
);

eq(
  "pointing at a Callout's title drops above the whole box",
  drag(["intro", "", "> [!note] T", "> a", "", "tail"], 6, 3, "top"),
  // One blank row between the two (item 9); the note keeps its ending.
  ["intro", "", "tail", "", "> [!note] T", "> a"]
);

/* ------------------------------------------------------------------ */
/* Keyboard moves stay inside the container                            */
/* ------------------------------------------------------------------ */

{
  const doc = docOf(["> [!note] T", "> a", "> ", "> b", "", "after"].join("\n"));
  const fences = scanFences(doc);
  const first = innerBlockAt(doc, 2, fences);
  const last = innerBlockAt(doc, 4, fences);
  eq(
    "the next sibling is the next row of the Callout",
    findSiblingBlock(doc, fences, first, 1)?.startLine,
    4
  );
  eq(
    "the previous sibling walks back over the seam",
    findSiblingBlock(doc, fences, last, -1)?.startLine,
    2
  );
  eq(
    "the first row has no previous sibling — the title is not one",
    findSiblingBlock(doc, fences, first, -1),
    null
  );
  eq(
    "the last row cannot leave the Callout",
    findSiblingBlock(doc, fences, last, 1),
    null
  );
}

/* ------------------------------------------------------------------ */
/* Insert below                                                        */
/* ------------------------------------------------------------------ */

{
  const view = makeView(["> [!note]", "> a", ">", "> b"].join("\n"));
  insertBlockBelow(view, innerBlockAt(view.state.doc, 2, scanFences(view.state.doc)), false);
  eq(
    "a new block below a Callout row stays in the Callout",
    view.state.doc.toString().split("\n"),
    ["> [!note]", "> a", ">", "> ", ">", "> b"]
  );
}

{
  const view = makeView(["> [!note]", "> a"].join("\n"));
  insertBlockBelow(view, innerBlockAt(view.state.doc, 1, scanFences(view.state.doc)), false);
  eq(
    "a new block below the Callout itself lands outside",
    view.state.doc.toString().split("\n"),
    ["> [!note]", "> a", "", ""]
  );
}

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
