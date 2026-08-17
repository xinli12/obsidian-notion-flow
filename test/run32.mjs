import { EditorState } from "@codemirror/state";
import {
  batchToggleFormatChanges,
  blocksInLineSpan,
  fenceEnterPlan,
  fenceExitPlan,
  fenceVisualTokenRange,
  innerBlockAt,
  insertBlockBelow,
  lineContentSpan,
  moveBlock,
  quotedListMarker,
  scanFences,
  seamRowBetween,
} from "./bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));

const docOf = (lines) => EditorState.create({ doc: lines.join("\n") }).doc;
const makeView = (lines) => {
  let state = EditorState.create({ doc: lines.join("\n") });
  return {
    get state() { return state; },
    dispatch(spec) { state = state.update(spec).state; },
    focus() {},
    dom: { ownerDocument: { defaultView: { setTimeout() {} } } },
  };
};
const rows = (view) => view.state.doc.toString().split("\n");
/** Apply a key plan and return the resulting rows. */
const applyPlan = (lines, plan) => {
  const text = lines.join("\n");
  return plan
    ? (text.slice(0, plan.from) + plan.insert + text.slice(plan.to)).split("\n")
    : null;
};
const endOf = (doc, lineNo) => doc.line(lineNo).to;

/* ------------------------------------------------------------------ */
/* A fence keeps its identity wherever Markdown lets one live          */
/*                                                                     */
/* The scanner used to match three fixed shapes: indented, quoted, or  */
/* opened on a list marker. A code block inside a list inside a        */
/* Callout is all of those at once, and matched none of them — so the  */
/* rows rendered as literal backticks, their contents were parsed as   */
/* Markdown, and Enter continued them as quote lines.                  */
/* ------------------------------------------------------------------ */

{
  const shape = (lines) =>
    scanFences(docOf(lines)).map((f) => [
      f.startLine,
      f.endLine,
      f.bodyPrefix,
      f.quoteDepth,
      f.markerOpener,
    ]);

  eq(
    "a fence indented inside a quote is a fence",
    shape([">   ```js", ">   x", ">   ```"]),
    [[1, 3, ">   ", 1, false]]
  );
  eq(
    "…and inside a list inside a Callout",
    shape(["> [!note] T", "> - item", ">   ```js", ">   x", ">   ```"]),
    [[3, 5, ">   ", 1, false]]
  );
  eq(
    "…at the deeper list level too",
    shape(["> - a", ">   - b", ">     ```js", ">     x", ">     ```"]),
    [[3, 5, ">     ", 1, false]]
  );
  eq(
    "…opening right on a quoted list marker",
    shape(["> - ```js", ">   x", ">   ```"]),
    [[1, 3, ">   ", 1, true]]
  );
  eq(
    "…and inside a nested quote",
    shape(["> >   ~~~py", "> >   x", "> >   ~~~"]),
    [[1, 3, "> >   ", 2, false]]
  );
  eq(
    "an unclosed quoted-list fence still runs to the end",
    shape(["> - a", ">   ```js", ">   x"]),
    [[2, 3, ">   ", 1, false]]
  );

  // Shapes that already worked keep their exact bookkeeping.
  eq("a plain fence is unchanged", shape(["```js", "x", "```"]), [
    [1, 3, "", 0, false],
  ]);
  eq("an indented fence is unchanged", shape(["  ```js", "  x", "  ```"]), [
    [1, 3, "  ", 0, false],
  ]);
  eq("a quoted fence is unchanged", shape(["> ```js", "> x", "> ```"]), [
    [1, 3, "> ", 1, false],
  ]);
  eq("a marker-opened fence is unchanged", shape(["- ```js", "  x", "  ```"]), [
    [1, 3, "  ", 0, true],
  ]);

  // Leaving the quote implicitly ends its unfinished fence. The bare marker
  // is then a new top-level opener, exactly as Lezer/CommonMark parse it;
  // neither block may swallow the paragraph between them.
  eq(
    "a bare closer cannot close a quoted fence",
    shape(["> ```js", "x", "```"]),
    [
      [1, 1, "> ", 1, false],
      [3, 3, "", 0, false],
    ]
  );
  eq(
    "a quoted closer cannot close a bare fence",
    shape(["```js", "> ```", "```"]),
    [[1, 3, "", 0, false]]
  );
}

{
  // A row that only LOOKS like Markdown must stay code.
  const lines = [
    "> [!note] Title",
    "> - item",
    ">   ```md",
    ">   - not a list",
    ">   ```",
    "> - after",
  ];
  const doc = docOf(lines);
  const fences = scanFences(doc);
  const inFence = (n) => fences.some((f) => n >= f.startLine && n <= f.endLine);
  ok("a bullet inside quoted code is not a list row", inFence(4));
  ok(
    "…while the real quoted bullets still are",
    quotedListMarker(lines[1]) !== null && quotedListMarker(lines[5]) !== null
  );
  eq(
    "the fence's language chip hides the markers, not the bullet",
    (() => {
      const token = fenceVisualTokenRange(doc, fences[0], false);
      const line = doc.line(fences[0].startLine);
      return [line.text.slice(0, token.from - line.from), token.language];
    })(),
    ["", "md"]
  );
  eq(
    "a fence opened on a quoted marker keeps that marker visible",
    (() => {
      const d = docOf(["> - ```js", ">   x", ">   ```"]);
      const f = scanFences(d)[0];
      const token = fenceVisualTokenRange(d, f, false);
      return d.line(1).text.slice(0, token.from - d.line(1).from);
    })(),
    "> - "
  );
}

{
  // Enter inside that block continues the code column, not the quote.
  const lines = ["> - a", ">   ```js", ">   code", ">   ```"];
  const doc = docOf(lines);
  const fences = scanFences(doc);
  eq(
    "Enter in a quoted-list code body keeps the code column",
    applyPlan(lines, fenceEnterPlan(doc, endOf(doc, 3), fences)),
    ["> - a", ">   ```js", ">   code", ">   ", ">   ```"]
  );
  eq(
    "Enter on its opener writes the body at that column",
    applyPlan(lines, fenceEnterPlan(doc, endOf(doc, 2), fences)),
    ["> - a", ">   ```js", ">   ", ">   code", ">   ```"]
  );
  eq(
    "leaving the block lands back in the list item",
    applyPlan(lines, fenceExitPlan(doc, endOf(doc, 3), fences)),
    ["> - a", ">   ```js", ">   code", ">   ```", ">   "]
  );
}

/* ------------------------------------------------------------------ */
/* Seams inside a container are rows OF that container                 */
/*                                                                     */
/* A Callout nested in a list item carries the item's indentation on   */
/* every row. A seam spelled from the canonical "> " prefix landed at  */
/* column 0, where the quote's own same-indent rule ends the box and   */
/* Obsidian draws two Callouts instead of one.                         */
/* ------------------------------------------------------------------ */

{
  eq(
    "a seam repeats the indentation of the row it follows",
    seamRowBetween("  > para", "  > | a | b |", "> "),
    "  >"
  );
  eq(
    "…at the depth it is asked for",
    seamRowBetween("  > > x", "  > > | a | b |", "> > "),
    "  > >"
  );
  eq(
    "an unindented container is unchanged",
    seamRowBetween("> para", "> | a | b |", "> "),
    ">"
  );

  const lines = [
    "- one",
    "  > [!tip] T",
    "  > | a | b |",
    "  > | --- | --- |",
    "  >",
    "  > para",
  ];
  const doc = docOf(lines);
  const view = makeView(lines);
  moveBlock(view, innerBlockAt(doc, 6, scanFences(doc)), 3);
  eq(
    "dropping a row above a table in an indented Callout keeps one box",
    rows(view),
    [
      "- one",
      "  > [!tip] T",
      "  > para",
      "  >",
      "  > | a | b |",
      "  > | --- | --- |",
    ]
  );
}

{
  // Removing a row from between two different depths left a bare blank
  // line, which closes the outer Callout at that point.
  const lines = [
    "> [!note] Outer",
    "> body",
    "> > [!tip] Inner",
    "> > inner body",
    "> tail",
  ];
  const doc = docOf(lines);
  const view = makeView(lines);
  moveBlock(view, innerBlockAt(doc, 2, scanFences(doc)), 4);
  ok(
    "no bare blank row is left behind inside a Callout",
    rows(view).every((row) => row.trim() !== ""),
    JSON.stringify(rows(view))
  );
  eq("the vacated row keeps the container open", rows(view), [
    "> [!note] Outer",
    ">",
    "> > [!tip] Inner",
    ">",
    "> body",
    "> > inner body",
    "> tail",
  ]);
}

/* ------------------------------------------------------------------ */
/* A new row below one belongs to the same container                   */
/* ------------------------------------------------------------------ */

{
  const insertBelow = (lines, lineNo) => {
    const doc = docOf(lines);
    const view = makeView(lines);
    insertBlockBelow(view, innerBlockAt(doc, lineNo, scanFences(doc)), false);
    return rows(view);
  };

  eq(
    "a row added inside a Callout nested in a list keeps the indentation",
    insertBelow(["- one", "  > [!tip] T", "  > body", "- two"], 3),
    ["- one", "  > [!tip] T", "  > body", "  >", "  > ", "- two"]
  );
  eq(
    "…at the nested Callout's own depth",
    insertBelow(["- one", "  > [!note] O", "  > > [!tip] I", "  > > body"], 4),
    ["- one", "  > [!note] O", "  > > [!tip] I", "  > > body", "  > >", "  > > "]
  );
  eq(
    "an unindented Callout is unchanged",
    insertBelow(["> [!tip] T", "> body"], 2),
    ["> [!tip] T", "> body", ">", "> "]
  );
}

/* ------------------------------------------------------------------ */
/* Formatting a selection spanning nested blocks                       */
/*                                                                     */
/* lineContentSpan() walked the block prefixes but not the indentation */
/* BETWEEN them, so a list nested inside a Callout had its bullet       */
/* wrapped in the markers — leaving a row of literal asterisks.         */
/* ------------------------------------------------------------------ */

{
  eq(
    "a nested bullet inside a quote is a prefix, not content",
    lineContentSpan(">   - list a1"),
    { from: 6, to: 13 }
  );
  eq(
    "a nested bullet inside a nested quote too",
    lineContentSpan("> >   1. thing"),
    { from: 9, to: 14 }
  );
  eq(
    "a directly quoted bullet is unchanged",
    lineContentSpan("> - list a"),
    { from: 4, to: 10 }
  );
  eq(
    "indentation with no prefix behind it stays content",
    lineContentSpan(">     plain text"),
    { from: 2, to: 16 }
  );

  const lines = [
    "> [!note] Title",
    "> body of callout",
    "> - list a",
    ">   - list a1",
    ">   ```js",
    ">   code();",
    ">   ```",
    "> > [!tip] Inner",
    "> > inner text",
    "> | a | b |",
    "> | --- | --- |",
  ];
  const doc = docOf(lines);
  const fences = scanFences(doc);
  const result = batchToggleFormatChanges(
    doc,
    blocksInLineSpan(doc, 1, lines.length, fences),
    { marker: "**", open: "<b>", close: "</b>" },
    fences
  );
  const text = lines.join("\n");
  let out = text;
  for (const change of [...result.changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, change.from) + change.insert + out.slice(change.to);
  }
  eq("bolding a whole Callout leaves every structure intact", out.split("\n"), [
    "> [!note] Title",
    "> **body of callout**",
    "> - **list a**",
    ">   - **list a1**",
    ">   ```js",
    ">   code();",
    ">   ```",
    "> > [!tip] Inner",
    "> > **inner text**",
    "> | a | b |",
    "> | --- | --- |",
  ]);
  ok("the nested code block and table are reported as skipped", result.skipped === 2,
    String(result.skipped));
}

/* ------------------------------------------------------------------ */
/* Grabbing a Callout by its title takes the whole box                 */
/*                                                                     */
/* getBlockRange() deliberately ends a quote at a fence inside it, so  */
/* the title of a Callout holding a code block resolved to only the    */
/* rows above that block — and dragging it tore the Callout in half.   */
/* ------------------------------------------------------------------ */

{
  const lines = [
    "intro",
    "",
    "> [!note] Callout with code",
    "> body before",
    "> ```js",
    "> code();",
    "> ```",
    "> body after",
    "",
    "tail",
  ];
  const doc = docOf(lines);
  const fences = scanFences(doc);
  const title = innerBlockAt(doc, 3, fences);
  eq("the title row resolves to the whole Callout", [title.startLine, title.endLine], [3, 8]);

  const view = makeView(lines);
  moveBlock(view, title, 1);
  eq("…so dragging it moves every row", rows(view), [
    "> [!note] Callout with code",
    "> body before",
    "> ```js",
    "> code();",
    "> ```",
    "> body after",
    "",
    "intro",
    "",
    "tail",
  ]);

  const nested = docOf([
    "- outer item",
    "  > [!tip] Nested callout",
    "  > body",
    "  > ```sh",
    "  > echo hi",
    "  > ```",
    "- second item",
  ]);
  const grabbed = innerBlockAt(nested, 2, scanFences(nested));
  eq(
    "an indented Callout is grabbed whole as well",
    [grabbed.startLine, grabbed.endLine],
    [2, 6]
  );

  // The rule is the Callout title, not "first row of any quote": a plain
  // blockquote's opening paragraph is still a block of its own.
  const plain = docOf(["> plain quote para", "> ```js", "> x", "> ```"]);
  const first = innerBlockAt(plain, 1, scanFences(plain));
  eq(
    "a plain quote's first paragraph stays its own block",
    [first.startLine, first.endLine],
    [1, 1]
  );
}

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
