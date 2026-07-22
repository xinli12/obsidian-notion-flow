import { EditorState } from "@codemirror/state";
import { getBlockRange, scanFences, moveBlock, reindentBlock, computeTargetIndent } from "./bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
};

function makeView(text) {
  let state = EditorState.create({ doc: text });
  return { get state() { return state; }, dispatch(s) { state = state.update(s).state; } };
}

// This mirrors exactly what broke in real use: dragging the code block out
// of the list item and dropping it after the first paragraph.
const noteText = [
  "# Notion Flow Test",     // 1
  "",                       // 2
  "First paragraph.",       // 3
  "",                       // 4
  "- item with code",       // 5
  "  ```js",                // 6
  "  const x = 1;",         // 7
  "",                       // 8
  "  console.log(x);",      // 9
  "  ```",                  // 10
  "  child note",           // 11
  "- second item",          // 12
].join("\n");

// Drag fence (6-10) out of the list, drop before line 4 (blank above list).
{
  const v = makeView(noteText);
  const fences = scanFences(v.state.doc);
  const block = getBlockRange(v.state.doc, 7, fences); // hover inside code
  ok("hover inside code grabs fence", block.startLine === 6 && block.endLine === 10, JSON.stringify(block));
  moveBlock(v, block, 4, fences);
  const expected = [
    "# Notion Flow Test",
    "",
    "First paragraph.",
    "```js",              // de-indented to top level
    "const x = 1;",
    "",
    "console.log(x);",
    "```",
    "",
    "- item with code",
    "  child note",
    "- second item",
  ].join("\n");
  ok("fence dragged out of list is de-indented", v.state.doc.toString() === expected, "\n" + v.state.doc.toString());
}

// Drag "First paragraph." INTO the list item (drop before "  child note").
{
  const v = makeView(noteText);
  const fences = scanFences(v.state.doc);
  const block = getBlockRange(v.state.doc, 3, fences);
  moveBlock(v, block, 11, fences);
  const lines = v.state.doc.toString().split("\n");
  // The blanks that surrounded the paragraph collapse to one, so the
  // whole list sits one line higher than before the move. A blank is
  // sealed in below the dropped paragraph so "child note" stays its own
  // block instead of merging into the same paragraph.
  ok(
    "paragraph dropped into item is indented",
    lines[8] === "  First paragraph." && lines[9] === "" && lines[10] === "  child note",
    JSON.stringify(lines)
  );
}

// Drag whole list item (5-11) to very top.
{
  const v = makeView(noteText);
  const fences = scanFences(v.state.doc);
  const block = getBlockRange(v.state.doc, 5, fences);
  ok("item block includes fence + child", block.startLine === 5 && block.endLine === 11, JSON.stringify(block));
  moveBlock(v, block, 1, fences);
  const out = v.state.doc.toString().split("\n");
  ok("item moved to top intact", out[0] === "- item with code" && out[1] === "  ```js" && out[6] === "  child note", JSON.stringify(out.slice(0,7)));
}

// reindentBlock edge: negative delta strips at most existing indent
{
  ok("reindent negative", reindentBlock("  a\nb\n\n    c", -2) === "a\nb\n\n  c", JSON.stringify(reindentBlock("  a\nb\n\n    c", -2)));
  ok("reindent positive", reindentBlock("a\n\nb", 2) === "  a\n\n  b", JSON.stringify(reindentBlock("a\n\nb", 2)));
}

// computeTargetIndent: end-of-doc after list item → sibling indent
{
  const v = makeView("- a\n- b");
  const fences = scanFences(v.state.doc);
  ok("end after list = sibling", computeTargetIndent(v.state.doc, fences, 3) === 0);
  const v2 = makeView("- a\n  - b");
  ok("end after nested list = nested sibling", computeTargetIndent(v2.state.doc, scanFences(v2.state.doc), 3) === 2);
}

// Drop target before a nested fence line → fence opening indent
{
  const v = makeView("- a\n  ```\n  x\n  ```\npara");
  const fences = scanFences(v.state.doc);
  ok("indent before fence body uses fence indent", computeTargetIndent(v.state.doc, fences, 2) === 2);
}

// Dropping a fenced block on a quote row makes it quoted Markdown, and the
// scanner still exposes the result as one independently draggable fence.
{
  const v = makeView(["```js", "const x = 1;", "```", "", "> quoted text"].join("\n"));
  const fences = scanFences(v.state.doc);
  const block = getBlockRange(v.state.doc, 1, fences);
  moveBlock(v, block, 5, fences, 0, undefined, "> ");
  const out = v.state.doc.toString();
  ok(
    "fence dragged into quote gets quote markers",
    out === "\n> ```js\n> const x = 1;\n> ```\n> quoted text",
    JSON.stringify(out)
  );
  const moved = scanFences(v.state.doc);
  ok(
    "dragged quoted fence remains a code block",
    moved.length === 1 && moved[0].startLine === 2 && moved[0].endLine === 4,
    JSON.stringify(moved)
  );
}

// Moving that independently recognized fence back to ordinary prose strips
// only its quote container markers and keeps the surrounding quote intact.
{
  const v = makeView([
    "> before",
    "> ```js",
    "> > literal code character",
    "> ```",
    "> after",
    "",
    "plain",
  ].join("\n"));
  const fences = scanFences(v.state.doc);
  const block = getBlockRange(v.state.doc, 3, fences);
  moveBlock(v, block, 7, fences, 0, undefined, "");
  const out = v.state.doc.toString();
  ok(
    "quoted fence can be dragged back out",
    out === "> before\n> after\n\n```js\n> literal code character\n```\nplain",
    JSON.stringify(out)
  );
}

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILURES`);
process.exit(fail);
