/**
 * Tab as a block-level action.
 *
 * The point of routing this through computeDropLevels/moveBlock rather
 * than "add four spaces" is that Markdown indentation is not free: four
 * spaces under a paragraph is an indented code block, not a nested one.
 * These checks pin that Tab only ever lands on a level the drag would
 * also have offered, and declines rather than inventing one.
 */
import { EditorState } from "@codemirror/state";
import {
  blockIndentTarget,
  indentBlockStep,
  computeDropLevels,
  scanFences,
} from "./bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));

const makeView = (lines, caret = 0) => {
  let state = EditorState.create({
    doc: lines.join("\n"),
    selection: { anchor: caret },
  });
  return {
    get state() { return state; },
    dispatch(spec) { state = state.update(spec).state; },
    focus() {},
    dom: { ownerDocument: { defaultView: { setTimeout() {} } } },
  };
};
const docOf = (lines) => EditorState.create({ doc: lines.join("\n") }).doc;
const at = (lines, lineNo, ch) => docOf(lines).line(lineNo).from + ch;

/** Press Tab (dir 1) or Shift+Tab (dir -1) with the caret on `lineNo`. */
const tab = (lines, lineNo, dir) => {
  const view = makeView(lines, at(lines, lineNo, 0));
  const doc = view.state.doc;
  const fences = scanFences(doc);
  const block = blockIndentTarget(doc, lineNo, fences);
  const applied = block
    ? indentBlockStep(view, block, dir, fences, "  ")
    : false;
  return { applied, rows: view.state.doc.toString().split("\n") };
};
const indentOf = (row) => row.match(/^\s*/)[0].length;

/* ------------------------------------------------------------------ */
/* What Tab is allowed to touch                                        */
/* ------------------------------------------------------------------ */

{
  const lines = [
    "- item",
    "trailing",
    "",
    "paragraph",
    "",
    "```js",
    "code",
    "```",
    "",
    "| a |",
    "| - |",
    "",
    "> quote",
  ];
  const doc = docOf(lines);
  const fences = scanFences(doc);
  const target = (lineNo) => blockIndentTarget(doc, lineNo, fences);

  ok("a paragraph is Tab's to indent", target(4) !== null);
  ok("a quote is Tab's to indent", target(13) !== null);
  ok("a list item is left to Obsidian", target(1) === null);
  ok("a list item's lazy continuation is left alone", target(2) === null);
  ok("a fence keeps code indentation", target(7) === null);
  ok("a table keeps cell navigation", target(10) === null);
  ok("a blank line is left alone", target(3) === null);
}

/* ------------------------------------------------------------------ */
/* Nesting under a list                                                */
/* ------------------------------------------------------------------ */

{
  // The whole point: a standalone paragraph after a list item can become
  // that item's content, which is the one indent Markdown means here.
  const lines = ["- item", "", "paragraph"];
  const r = tab(lines, 3, 1);
  ok("a paragraph under a list item indents", r.applied);
  eq("it lands on the item's content column", r.rows, [
    "- item",
    "",
    "  paragraph",
  ]);
}

{
  const lines = ["- item", "", "  paragraph"];
  const r = tab(lines, 3, -1);
  ok("Shift+Tab steps back out", r.applied);
  eq("outdent returns it to the margin", r.rows, ["- item", "", "paragraph"]);
}

{
  // Nothing above offers a level, so Tab has no block meaning and must
  // decline — the fall-through is what still types an ordinary tab.
  const lines = ["alpha", "", "beta"];
  const r = tab(lines, 3, 1);
  ok("a paragraph with no container above declines", !r.applied);
  eq("declining changes nothing", r.rows, lines);
}

{
  const lines = ["alpha"];
  const r = tab(lines, 1, -1);
  ok("Shift+Tab at the margin declines", !r.applied);
  eq("declining at the margin changes nothing", r.rows, lines);
}

/* ------------------------------------------------------------------ */
/* Only levels the drag would offer                                    */
/* ------------------------------------------------------------------ */

{
  const lines = ["- outer", "  - inner", "", "paragraph"];
  const doc = docOf(lines);
  const fences = scanFences(doc);
  const block = blockIndentTarget(doc, 4, fences);
  const offered = computeDropLevels(doc, fences, block.startLine, block).map(
    (l) => l.indent
  );

  let rows = lines;
  const reached = [0];
  for (let n = 0; n < 6; n++) {
    const r = tab(rows, 4, 1);
    if (!r.applied) break;
    rows = r.rows;
    reached.push(indentOf(rows[3]));
  }
  ok(
    "every level Tab reaches is one the drag offers",
    reached.every((indent) => offered.includes(indent)),
    `reached ${JSON.stringify(reached)} offered ${JSON.stringify(offered)}`
  );
  ok(
    "Tab climbs past the first rung when the list nests",
    reached.length > 1,
    JSON.stringify(reached)
  );
  ok(
    "Tab stops at the deepest offered level",
    reached.length <= offered.length,
    `reached ${JSON.stringify(reached)} offered ${JSON.stringify(offered)}`
  );
}

/* ------------------------------------------------------------------ */
/* Multi-row blocks travel whole                                       */
/* ------------------------------------------------------------------ */

{
  // Indenting the first row only would break the paragraph in two.
  const lines = ["- item", "", "para one", "para two"];
  const r = tab(lines, 3, 1);
  ok("a two-row paragraph indents", r.applied);
  eq("both rows move together", r.rows, [
    "- item",
    "",
    "  para one",
    "  para two",
  ]);
}

{
  const lines = ["- item", "> quote", "> more"];
  const r = tab(lines, 2, 1);
  ok("a quote under a list item indents", r.applied);
  eq("every row of the quote moves together", r.rows, [
    "- item",
    "  > quote",
    "  > more",
  ]);
}

if (fail) process.exit(1);
console.log("ALL PASS");
