import { EditorState } from "@codemirror/state";
import { parser } from "@lezer/markdown";
import {
  collectListLineStyles,
  collectOrderedListMarkers,
  computeDropIndents,
  fenceMeasureLines,
  formatOrderedListMarker,
  getBlockRange,
  indentCharsForColumns,
  insertBlockBelow,
  listNestingDepth,
  moveBlock,
  pickIndentByDrag,
  placeHandleControls,
  scanFences,
  stripIndentColumns,
} from "./bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
};

const makeView = (text) => {
  let state = EditorState.create({ doc: text });
  return {
    get state() { return state; },
    dispatch(spec) { state = state.update(spec).state; },
    focus() {},
  };
};

/* Ordered labels match native counter semantics, including wide alpha and
   Roman values and decimal fallback outside Roman's supported range. */
{
  ok("alpha counter reaches z", formatOrderedListMarker(26, 1) === "z.");
  ok("alpha counter continues at aa", formatOrderedListMarker(27, 1) === "aa.");
  ok("Roman counter uses source delimiter", formatOrderedListMarker(14, 2, ")") === "xiv)");
  ok("Roman zero falls back to decimal", formatOrderedListMarker(0, 2) === "0.");
}

/* Obsidian Live Preview exposes HyperMD line nodes rather than semantic
   OrderedList/BulletList containers. An empty semantic tree exercises the
   source fallback used by that runtime. */
{
  const text = [
    "1. one",
    "1. two",
    "\t1. alpha",
    "\t\t1. roman",
    "2. three",
    "",
    "- bullet",
    "\t- inner",
  ].join("\n");
  const state = EditorState.create({ doc: text });
  const hyperMdTree = { topNode: { firstChild: null } };
  const labels = collectOrderedListMarkers(hyperMdTree, state.doc)
    .map((marker) => marker.label);
  const phases = collectListLineStyles(hyperMdTree, state.doc)
    .map((line) => line.phase);
  ok(
    "HyperMD fallback produces ordered cycle",
    JSON.stringify(labels) === '["1.","2.","a.","i.","3."]',
    JSON.stringify(labels)
  );
  ok(
    "HyperMD fallback produces mixed depth phases",
    JSON.stringify(phases) === "[0,0,1,2,0,0,1]",
    JSON.stringify(phases)
  );
}

/* Nested widget rendering strips only the container indentation; Markdown
   markers and body text stay byte-for-byte intact. */
{
  ok(
    "nested Callout render removes absolute spaces",
    stripIndentColumns("           > [!note] A callout", 11) ===
      "> [!note] A callout"
  );
  ok(
    "nested Callout render removes tab stops",
    stripIndentColumns("\t   > body", 7) === "> body"
  );
}

/* Repeated source `1.` markers still display the sequence Reading view
   produces, and mixed UL/OL ancestry contributes to the same depth cycle. */
{
  const text = [
    "1. one",
    "1. two",
    "   1. alpha",
    "   1. beta",
    "2. three",
    "",
    "- bullet",
    "  - inner",
    "    1) roman",
    "    1) second",
  ].join("\n");
  const state = EditorState.create({ doc: text });
  const tree = parser.parse(text);
  const labels = collectOrderedListMarkers(tree, state.doc).map((marker) => marker.label);
  ok(
    "ordered marker sequence and phases",
    JSON.stringify(labels) === '["1.","2.","a.","b.","3.","i)","ii)"]',
    JSON.stringify(labels)
  );
  const phases = collectListLineStyles(tree, state.doc).map((line) => line.phase);
  ok(
    "mixed list line phases",
    JSON.stringify(phases) === "[0,0,1,1,0,0,1,2,2]",
    JSON.stringify(phases)
  );
}

/* Four-column child markers are not extra content depths. Structural
   blocks move 0 -> 2 -> 6 and remain children of both list ancestors. */
for (const [name, blockText] of [
  ["quote", "> quote\n> body"],
  ["Callout", "> [!tip] Callout\n> body"],
  ["fenced code", "```js\ncode\n```"],
]) {
  const view = makeView(`${blockText}\n\n- outer\n    - inner\n      tail`);
  const fences = scanFences(view.state.doc);
  const block = getBlockRange(view.state.doc, 1, fences);
  const target = view.state.doc.lines + 1;
  const levels = computeDropIndents(view.state.doc, fences, target, block);
  ok(
    `${name}: content levels skip marker-only column`,
    JSON.stringify(levels) === "[0,2,6]",
    JSON.stringify(levels)
  );
  ok(
    `${name}: two horizontal steps select inner content`,
    pickIndentByDrag(levels, 0, 72, 36) === 6
  );
  const start = moveBlock(view, block, target, fences, 6);
  const movedFences = scanFences(view.state.doc);
  ok(`${name}: moved block has two list ancestors`, start != null && listNestingDepth(view.state.doc, start, movedFences) === 2);
  const movedLines = start == null
    ? []
    : Array.from(
        { length: getBlockRange(view.state.doc, start, movedFences).endLine - start + 1 },
        (_, i) => view.state.doc.line(start + i).text
      );
  ok(
    `${name}: every nonblank row uses exact six-column prefix`,
    movedLines.filter((line) => line.trim()).every((line) => line.startsWith("      ")),
    JSON.stringify(movedLines)
  );
}

/* In-place horizontal drags resolve past the source block and loose-list
   blank rows to the same semantic ancestors. */
for (const [name, blockText] of [
  ["quote", "> quote\n> body"],
  ["Callout", "> [!tip] Callout\n> body"],
  ["fenced code", "```js\ncode\n```"],
]) {
  const view = makeView(`- outer\n    - inner\n      tail\n\n${blockText}`);
  const fences = scanFences(view.state.doc);
  const block = getBlockRange(view.state.doc, 5, fences);
  const levels = computeDropIndents(
    view.state.doc,
    fences,
    block.startLine,
    block
  );
  ok(
    `${name}: in-place levels cross loose-list blank`,
    JSON.stringify(levels) === "[0,2,6]",
    JSON.stringify(levels)
  );
  moveBlock(view, block, block.startLine, fences, 6);
  const movedFences = scanFences(view.state.doc);
  ok(
    `${name}: in-place indent reaches inner list`,
    listNestingDepth(view.state.doc, block.startLine, movedFences) === 2,
    view.state.doc.toString()
  );
}

/* A moved list item uses one candidate per semantic depth while matching an
   existing child list's non-canonical four-column marker indentation. */
{
  const view = makeView("- moved\n\n- outer\n    - inner\n      tail");
  const fences = scanFences(view.state.doc);
  const block = getBlockRange(view.state.doc, 1, fences);
  const target = view.state.doc.lines + 1;
  const levels = computeDropIndents(view.state.doc, fences, target, block);
  ok("list drag de-duplicates semantic levels", JSON.stringify(levels) === "[0,4,6]", JSON.stringify(levels));
  ok("list drag reaches inner child in two steps", pickIndentByDrag(levels, 0, 72, 36) === 6);
  const start = moveBlock(view, block, target, fences, 6);
  ok(
    "moved list item has two ancestors",
    start != null && listNestingDepth(view.state.doc, start, scanFences(view.state.doc)) === 2,
    view.state.doc.toString()
  );
}

/* Outdenting a shallow fence terminates the former parent list instead of
   being reabsorbed as its lazy paragraph continuation. */
{
  const view = makeView("- outer\n    - inner\n      tail\n      ```js\n      code\n      ```");
  const fences = scanFences(view.state.doc);
  const block = getBlockRange(view.state.doc, 4, fences);
  moveBlock(view, block, block.startLine, fences, 0);
  const movedFences = scanFences(view.state.doc);
  const topFence = movedFences.find((fence) => fence.indent === 0);
  const inner = getBlockRange(view.state.doc, 2, movedFences);
  ok("outdented fence is top-level", !!topFence && listNestingDepth(view.state.doc, topFence.startLine, movedFences) === 0, view.state.doc.toString());
  ok("former parent stops before shallow fence", !!topFence && inner.endLine < topFence.startLine, JSON.stringify(inner));
}

/* Marker widths and tabs produce canonical content columns, never a false
   intermediate drag level. */
for (const [name, text, expected] of [
  ["mixed numbered parent", "> q\n\n1. outer\n    - inner\n      tail", "[0,3,6]"],
  ["tab-indented child", "> q\n\n- outer\n\t- inner\n      tail", "[0,2,6]"],
]) {
  const view = makeView(text);
  const fences = scanFences(view.state.doc);
  const block = getBlockRange(view.state.doc, 1, fences);
  const levels = computeDropIndents(view.state.doc, fences, view.state.doc.lines + 1, block);
  ok(name, JSON.stringify(levels) === expected, JSON.stringify(levels));
}

/* Controls reserve the measured fold lane and degrade to the handle alone
   when the left gutter cannot fit the full pair. */
{
  const normal = placeHandleControls(300, 0, 800);
  ok("controls keep ordinary ideal placement", normal.left === 250 && !normal.compact, JSON.stringify(normal));
  const folded = placeHandleControls(300, 0, 800, 274);
  ok("controls end before fold target", folded.left + 46 <= 270 && !folded.compact, JSON.stringify(folded));
  const narrow = placeHandleControls(26, 0, 400);
  ok("narrow gutter keeps handle-only fallback visible", narrow.left === 4 && narrow.compact, JSON.stringify(narrow));
  const foldedNarrow = placeHandleControls(26, 0, 400, 18);
  ok(
    "narrow fold lane moves compact handle to far edge",
    foldedNarrow.edge && foldedNarrow.left === 374 && foldedNarrow.left > 18,
    JSON.stringify(foldedNarrow)
  );
}

/* Painted nested-code layers anchor on measurable body rows at the fence's
   own column; marker rows (replaced by Live Preview widgets) never anchor. */
{
  const text = [
    "1. item",
    "\t1. child",
    "       ```js",
    "       const x = 1;",
    "",
    "       console.log(x);",
    "       ```",
  ].join("\n");
  const state = EditorState.create({ doc: text });
  const fences = scanFences(state.doc);
  ok("nested fence records opener column", fences[0]?.indent === 7, JSON.stringify(fences));
  ok(
    "fence measurement uses only non-blank body rows",
    JSON.stringify(fenceMeasureLines(state.doc, fences[0])) === "[4,6]",
    JSON.stringify(fenceMeasureLines(state.doc, fences[0]))
  );
  const empty = scanFences(EditorState.create({ doc: "\t```js\n\n```" }).doc);
  ok(
    "blank-bodied fence yields no anchor rows",
    fenceMeasureLines(EditorState.create({ doc: "\t```js\n\n```" }).doc, empty[0]).length === 0
  );
}

/* Column→character mapping honours tab stops and stops at content, so a
   shallower body row anchors at its own outermost character. */
{
  ok("spaces map one column each", indentCharsForColumns("       code", 7) === 7);
  ok("tab jumps to the next four-column stop", indentCharsForColumns("\tcode", 4) === 1);
  ok("mixed tab+space prefix", indentCharsForColumns("\t   code", 7) === 4);
  ok("mid-stop tab counts as remaining columns", indentCharsForColumns(" \tcode", 4) === 2);
  ok(
    "shallow row stops at its first character",
    indentCharsForColumns("  code", 7) === 2
  );
}

/* Disabling slash commands still creates a clean empty block; it must not
   leave a literal slash that can no longer open a suggester. */
{
  const view = makeView("paragraph");
  insertBlockBelow(view, { startLine: 1, endLine: 1 }, false);
  ok("insert without slash commands leaves no slash", view.state.doc.toString() === "paragraph\n\n", JSON.stringify(view.state.doc.toString()));
}

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILURES`);
process.exit(fail);
