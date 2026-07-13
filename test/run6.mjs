import { EditorState } from "@codemirror/state";
import {
  getBlockRange, scanFences, moveBlock, computeDropIndents, pickIndent,
  findPrevBlockStart, findNextBlock, applyLinePrefix, getWrapState,
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

/* ---- computeMaxDropIndent: X-nesting is clamped to valid levels ---- */
{
  const v = mk("- parent\n  - child\npara");
  const f = scanFences(v.state.doc);
  ok("levels before nested child", JSON.stringify(computeDropIndents(v.state.doc, f, 2)) === "[0,2,4]",
    JSON.stringify(computeDropIndents(v.state.doc, f, 2)));
}
{
  const v = mk("para one\n\npara two");
  const f = scanFences(v.state.doc);
  ok("no free indent under paragraphs", JSON.stringify(computeDropIndents(v.state.doc, f, 3)) === "[0]");
}
// Child level steps by one indent unit (default 4, matching Tab).
{
  const v = mk("- item\n\nafter");
  const f = scanFences(v.state.doc);
  ok("after bullet item: levels 0 and 4", JSON.stringify(computeDropIndents(v.state.doc, f, 2)) === "[0,4]");
}
// A narrower unit still respects the marker's content indent as the floor.
{
  const v = mk("1. step one\n\nafter");
  const f = scanFences(v.state.doc);
  ok("after numbered item: levels 0 and 4", JSON.stringify(computeDropIndents(v.state.doc, f, 2)) === "[0,4]");
  ok("unit 2 clamps to numbered marker width 3",
    JSON.stringify(computeDropIndents(v.state.doc, f, 2, undefined, 2)) === "[0,3]",
    JSON.stringify(computeDropIndents(v.state.doc, f, 2, undefined, 2)));
}
// pickIndent snaps to nearest candidate
{
  ok("pick far right -> deepest", pickIndent([0,3], 12) === 3);
  ok("pick far left -> 0", pickIndent([0,3], 0.4) === 0);
  ok("pick between snaps down on tie-ish", pickIndent([0,2], 1.4) === 2);
}
// Drop a paragraph under a numbered item with a deep X: one unit deep
{
  const v = mk("1. step one\n\ndragged para");
  const f = scanFences(v.state.doc);
  const block = getBlockRange(v.state.doc, 3, f);
  moveBlock(v, block, 2, f, 9);
  ok("numbered child indent = 4", v.state.doc.toString() === "1. step one\n    dragged para\n", JSON.stringify(v.state.doc.toString()));
}

/* ---- indentOverride drop: drag paragraph to child depth via X ---- */
{
  const v = mk("- item\n\nmoved para");
  const f = scanFences(v.state.doc);
  const block = getBlockRange(v.state.doc, 3, f);
  moveBlock(v, block, 2, f, 3); // X near child depth → child content of "- item"
  ok("override indents into item", v.state.doc.toString() === "- item\n    moved para\n", JSON.stringify(v.state.doc.toString()));
}
{
  const v = mk("- item\n\nmoved para");
  const f = scanFences(v.state.doc);
  const block = getBlockRange(v.state.doc, 3, f);
  moveBlock(v, block, 2, f, 8); // absurd X → clamped to max valid (4)
  ok("override clamped to valid depth", v.state.doc.toString() === "- item\n    moved para\n", JSON.stringify(v.state.doc.toString()));
}
// Tab-indenting vaults get real tabs for fresh indentation.
{
  const v = mk("- item\n\nmoved para");
  const f = scanFences(v.state.doc);
  const block = getBlockRange(v.state.doc, 3, f);
  moveBlock(v, block, 2, f, 4, { width: 4, useTab: true });
  ok("tab unit writes tab char", v.state.doc.toString() === "- item\n\tmoved para\n", JSON.stringify(v.state.doc.toString()));
}
{
  const v = mk("- item\n  child\n\nlast");
  const f = scanFences(v.state.doc);
  const block = getBlockRange(v.state.doc, 2, f); // "  child"
  moveBlock(v, block, 4, f, 0); // X at far left → force top-level
  ok("override de-indents to top level", v.state.doc.toString() === "- item\n\nchild\nlast", JSON.stringify(v.state.doc.toString()));
}

/* ---- in-place horizontal drag: indent changes without moving ---- */
{
  const v = mk("- A\n- B");
  const f = scanFences(v.state.doc);
  const block = getBlockRange(v.state.doc, 2, f); // "- B"
  moveBlock(v, block, 3, f, 4); // dropped on itself, X at child depth
  ok("in-place drag indents item", v.state.doc.toString() === "- A\n    - B", JSON.stringify(v.state.doc.toString()));
}
{
  const v = mk("- A\n- B");
  const f = scanFences(v.state.doc);
  const block = getBlockRange(v.state.doc, 2, f);
  moveBlock(v, block, 3, f, 4, { width: 4, useTab: true });
  ok("in-place indent uses tab char", v.state.doc.toString() === "- A\n\t- B", JSON.stringify(v.state.doc.toString()));
}
{
  const v = mk("- A\n  - B\n- C");
  const f = scanFences(v.state.doc);
  const block = getBlockRange(v.state.doc, 2, f); // "  - B"
  moveBlock(v, block, 2, f, 0); // dropped on itself, X at far left
  ok("in-place drag outdents item", v.state.doc.toString() === "- A\n- B\n- C", JSON.stringify(v.state.doc.toString()));
}
{
  const v = mk("- A\n  - B1\n  - B2\n- C");
  const f = scanFences(v.state.doc);
  const block = getBlockRange(v.state.doc, 1, f); // "- A" + children
  moveBlock(v, block, 1, f, 0); // same spot, same level
  ok("in-place same indent is no-op", v.state.doc.toString() === "- A\n  - B1\n  - B2\n- C");
}
{
  const v = mk("- A\n- B");
  const f = scanFences(v.state.doc);
  const block = getBlockRange(v.state.doc, 2, f);
  moveBlock(v, block, 2, f); // keyboard move without override
  ok("in-place without override is no-op", v.state.doc.toString() === "- A\n- B");
}
// The dragged block itself must not offer a "nest under itself" level.
{
  const v = mk("- A\n  - B\nnext");
  const f = scanFences(v.state.doc);
  ok(
    "exclude drops self-child level",
    JSON.stringify(computeDropIndents(v.state.doc, f, 3, { startLine: 2, endLine: 2 })) === "[0,4]",
    JSON.stringify(computeDropIndents(v.state.doc, f, 3, { startLine: 2, endLine: 2 }))
  );
}

/* ---- keyboard block navigation ---- */
{
  const v = mk("# H\n\npara\n\n- a\n  - a1\n- b");
  const f = scanFences(v.state.doc);
  const para = getBlockRange(v.state.doc, 3, f);
  ok("prev of para is heading", findPrevBlockStart(v.state.doc, f, para) === 1);
  const next = findNextBlock(v.state.doc, f, para);
  ok("next of para is list item with child", next.startLine === 5 && next.endLine === 6, JSON.stringify(next));
  const first = getBlockRange(v.state.doc, 1, f);
  ok("prev of first is null", findPrevBlockStart(v.state.doc, f, first) === null);
}

/* ---- applyLinePrefix ---- */
{
  ok("plain -> h2", applyLinePrefix("hello", "## ") === "## hello");
  ok("h1 -> h2", applyLinePrefix("# hello", "## ") === "## hello");
  ok("bullet -> todo keeps bullet-compatible text", applyLinePrefix("- hello", "- [ ] ") === "- [ ] hello");
  ok("todo -> plain strips fully", applyLinePrefix("- [x] hello", "") === "hello");
  ok("quote -> bullet", applyLinePrefix("> hello", "- ") === "- hello");
  ok("nested indent preserved", applyLinePrefix("  - hello", "## ") === "  ## hello");
  ok("numbered -> h3", applyLinePrefix("3. hello", "### ") === "### hello");
}

/* ---- getWrapState (toolbar active detection) ---- */
{
  const st = (text, from, to) => EditorState.create({ doc: text, selection: { anchor: from, head: to } });
  ok("outside bold detected", getWrapState(st("**hi** x", 2, 4), "**") === "outside");
  ok("inside bold detected", getWrapState(st("**hi** x", 0, 6), "**") === "inside");
  ok("plain none", getWrapState(st("hi there", 0, 2), "**") === "none");
  ok("italic not fooled by bold", getWrapState(st("**hi** x", 2, 4), "*") === "none");
  ok("real italic detected", getWrapState(st("*hi* x", 1, 3), "*") === "outside");
}

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILURES`);
process.exit(fail);
