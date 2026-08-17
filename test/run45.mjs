/**
 * Turn-into as a keyboard action: the shared conversion behind the block
 * handle menu and the Mod+Alt+digit commands.
 *
 * The menu path only ever ran with the pointer, so where the caret landed
 * afterwards did not matter. A chord is pressed mid-sentence, so it does:
 * these checks pin the caret as much as the text.
 */
import { EditorState } from "@codemirror/state";
import {
  canTurnBlockInto,
  turnBlockInto,
  getBlockRange,
  innerBlockAt,
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
const rows = (view) => view.state.doc.toString().split("\n");
const caretOf = (view) => {
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.head);
  return [line.number, sel.head - line.from];
};

/** Convert the block holding `caret`, the way the commands do. */
const turn = (lines, caret, prefix) => {
  const view = makeView(lines, caret);
  const doc = view.state.doc;
  const fences = scanFences(doc);
  const block = innerBlockAt(doc, doc.lineAt(caret).number, fences);
  const applied = turnBlockInto(view, block, prefix, fences);
  return { applied, rows: rows(view), caret: caretOf(view) };
};
/** Offset of `ch` on 1-based `lineNo`. */
const at = (lines, lineNo, ch) =>
  EditorState.create({ doc: lines.join("\n") }).doc.line(lineNo).from + ch;

/* ------------------------------------------------------------------ */
/* What is convertible                                                 */
/* ------------------------------------------------------------------ */

const doc = (lines) => EditorState.create({ doc: lines.join("\n") }).doc;

{
  const lines = [
    "alpha",
    "",
    "```js",
    "const x = 1;",
    "```",
    "",
    "| a |",
    "| - |",
    "",
    "> [!note] Title",
    "> body",
    "",
    "> [!nf-cols]",
    "> > [!nf-col]",
    "> > held",
  ];
  const d = doc(lines);
  const fences = scanFences(d);
  const can = (lineNo) =>
    canTurnBlockInto(d, getBlockRange(d, lineNo, fences), fences);

  ok("a paragraph converts", can(1));
  ok("a fenced code block does not", !can(3));
  ok("a table does not", !can(7));
  ok("a multi-line Callout converts as a whole", can(10));
  ok("column scaffolding is left to Unwrap columns", !can(13));
}

/* ------------------------------------------------------------------ */
/* Text and caret                                                      */
/* ------------------------------------------------------------------ */

{
  // Caret after "al" in "alpha" — the writer is mid-word.
  const lines = ["alpha", "beta"];
  const r = turn(lines, at(lines, 1, 2), "## ");
  ok("paragraph → heading applies", r.applied);
  eq("paragraph → heading text", r.rows, ["## alpha", "beta"]);
  eq("caret keeps its place in the word", r.caret, [1, 5]);
}

{
  // Retyping one prefix as another must not stack them.
  const lines = ["- [ ] task"];
  const r = turn(lines, at(lines, 1, 8), "# ");
  eq("to-do → heading replaces the marker", r.rows, ["# task"]);
  eq("caret follows the text, not the offset", r.caret, [1, 4]);
}

{
  const lines = ["# heading"];
  const r = turn(lines, at(lines, 1, 9), "");
  eq("heading → text strips the marker", r.rows, ["heading"]);
  eq("caret at line end stays at line end", r.caret, [1, 7]);
}

{
  // A caret parked inside the old marker has no text to hold onto; it
  // belongs at the start of the content, never adrift in the new prefix.
  const lines = ["### heading"];
  const r = turn(lines, at(lines, 1, 1), "- ");
  eq("heading → bullet", r.rows, ["- heading"]);
  ok("caret inside the old marker lands in content", r.caret[1] >= 2);
}

/* ------------------------------------------------------------------ */
/* Containers                                                          */
/* ------------------------------------------------------------------ */

{
  // Inside a Callout the "> " is the container, not the block: it stays.
  const lines = ["> [!note] Title", "> alpha", "> beta"];
  const r = turn(lines, at(lines, 2, 4), "- ");
  eq("a row of a Callout keeps its marker", r.rows, [
    "> [!note] Title",
    "> - alpha",
    "> beta",
  ]);
  eq("caret rides the two added characters", r.caret, [2, 6]);
}

{
  // From the header row the block IS the Callout, so the whole-block
  // transform runs and every row sheds one quote level at once.
  const lines = ["> [!note] Title", "> alpha", "> beta", "", "after"];
  const r = turn(lines, at(lines, 1, 12), "");
  eq("Callout → text unwraps every row", r.rows, [
    "Title",
    "alpha",
    "beta",
    "",
    "after",
  ]);
  ok("caret stays inside the unwrapped block", r.caret[0] <= 3);
}

{
  // From a body row the block is that row, so converting it to text
  // touches that row's own marker and leaves the container standing —
  // the same thing the caret would mean anywhere else.
  const lines = ["> [!note] Title", "> - item", "> beta"];
  const r = turn(lines, at(lines, 2, 6), "");
  eq("a body row converts as itself", r.rows, [
    "> [!note] Title",
    "> item",
    "> beta",
  ]);
}

{
  // A fence and a table are refused rather than mangled.
  const lines = ["```js", "const x = 1;", "```"];
  const r = turn(lines, at(lines, 2, 3), "# ");
  ok("a code block is refused", !r.applied);
  eq("a refused block is left alone", r.rows, lines);
}

{
  const lines = ["| a |", "| - |"];
  const r = turn(lines, at(lines, 1, 2), "- ");
  ok("a table is refused", !r.applied);
  eq("a refused table is left alone", r.rows, lines);
}

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */

{
  // Converting a parent must not drag the children's markers with it:
  // only the block's first line carries the prefix.
  const lines = ["- parent", "  - child", "next"];
  const r = turn(lines, at(lines, 1, 4), "1. ");
  eq("only the first line is retyped", r.rows, [
    "1. parent",
    "  - child",
    "next",
  ]);
}

{
  const lines = ["  - indented"];
  const r = turn(lines, at(lines, 1, 6), "# ");
  eq("indentation survives the retype", r.rows, ["  # indented"]);
}

if (fail) process.exit(1);
console.log("ALL PASS");
