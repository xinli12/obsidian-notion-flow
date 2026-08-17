/**
 * Writing-flow batch: wrapping a block in a container, the typed shorthand
 * that expands into one, stepping a block selection with the arrows, and
 * opening a block ABOVE the one the caret is in.
 *
 * The risk in all four is the same: each one rewrites rows AROUND text the
 * writer did not select, so what they must never do is swallow a neighbour,
 * spell a level that is not the one the block sits at, or fire on prose
 * that merely looks like shorthand.
 */
import { EditorState, EditorSelection } from "@codemirror/state";
import {
  buildBlockWrap,
  canWrapBlockInto,
  wrapBlockInto,
  inputRuleExpansion,
  makeInputRuleFilter,
  adjacentBlock,
  blockInsertAbovePlan,
  insertBlockAbove,
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

const docOf = (lines) => EditorState.create({ doc: lines.join("\n") }).doc;
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

/* ------------------------------------------------------------------ */
/* buildBlockWrap                                                      */
/* ------------------------------------------------------------------ */

eq(
  "a paragraph becomes a Callout's content, title row left empty",
  buildBlockWrap(["first", "second"], "callout"),
  ["> [!note] ", "> first", "> second"]
);

eq(
  "a blank row inside the block stays a blank QUOTE row",
  buildBlockWrap(["first", "", "second"], "callout"),
  ["> [!note] ", "> first", ">", "> second"]
);

eq(
  "an already-quoted block keeps its own markers, gaining only the header",
  buildBlockWrap(["> quoted", "> more"], "callout"),
  ["> [!note] ", "> quoted", "> more"]
);

eq(
  "a deeper quote is content one level inside the new Callout",
  buildBlockWrap(["> > deep"], "callout"),
  ["> [!note] ", "> > deep"]
);

eq(
  "an indented block is dedented into the Callout",
  buildBlockWrap(["    indented"], "callout"),
  ["> [!note] ", "> indented"]
);

eq(
  "a toggle keeps the first line as its title",
  buildBlockWrap(["Title", "body"], "toggle"),
  ["> [!nf-toggle]+ Title", "> body"]
);

eq(
  "code wraps the block in a bare fence, language left to type",
  buildBlockWrap(["const x = 1", "  indented"], "code"),
  ["```", "const x = 1", "  indented", "```"]
);

ok(
  "every wrap ends its first row where the caret goes",
  buildBlockWrap(["x"], "callout")[0].endsWith(" ") &&
    buildBlockWrap(["x"], "code")[0] === "```"
);

/* ------------------------------------------------------------------ */
/* canWrapBlockInto                                                    */
/* ------------------------------------------------------------------ */

const canWrap = (lines, lineNo, kind) => {
  const doc = docOf(lines);
  const fences = scanFences(doc);
  const block = innerBlockAt(doc, lineNo, fences);
  return block ? canWrapBlockInto(doc, block, fences, kind) : false;
};

ok("a plain paragraph can be wrapped", canWrap(["text"], 1, "callout"));
ok("a heading can be wrapped", canWrap(["# Title"], 1, "callout"));
ok("a list item can be wrapped", canWrap(["- item"], 1, "toggle"));
ok("a plain quote can become a Callout", canWrap(["> quoted"], 1, "callout"));

ok(
  "a blank line has nothing to wrap",
  !canWrap(["text", "", "more"], 2, "callout")
);
ok(
  "a Callout is not wrapped in another Callout — it has a type menu",
  !canWrap(["> [!note] Title", "> body"], 1, "callout")
);
ok(
  "a Callout CAN still become a toggle",
  canWrap(["> [!note] Title", "> body"], 1, "toggle")
);
ok(
  "a toggle is not wrapped in another toggle",
  !canWrap(["> [!nf-toggle]+ Title", "> body"], 1, "toggle")
);
ok(
  "column scaffolding owns its own transforms",
  !canWrap(["> [!nf-cols]", "> > [!nf-col]", "> > text"], 1, "callout")
);
ok(
  "a row INSIDE a Callout carries the container's markers, so it is refused",
  !canWrap(["> [!note] Title", "> body"], 2, "callout")
);
ok(
  "a code block is not re-fenced",
  !canWrap(["```js", "code", "```"], 1, "code")
);
ok(
  "a block CONTAINING a fence is not fenced either",
  !canWrap(["- item", "  ```js", "  code", "  ```"], 1, "code")
);
ok(
  "…but that same block can still become a Callout",
  canWrap(["- item", "  ```js", "  code", "  ```"], 1, "callout")
);

/* ------------------------------------------------------------------ */
/* wrapBlockInto: the whole edit, seams and caret included             */
/* ------------------------------------------------------------------ */

/** Wrap the block holding `caret`, the way the command does. */
const wrap = (lines, caret, kind) => {
  const view = makeView(lines, caret);
  const doc = view.state.doc;
  const fences = scanFences(doc);
  const block = innerBlockAt(doc, doc.lineAt(caret).number, fences);
  const applied = wrapBlockInto(view, block, kind, fences);
  return { applied, rows: rows(view), caret: caretOf(view) };
};
const at = (lines, lineNo, ch) => docOf(lines).line(lineNo).from + ch;

{
  const lines = ["alpha", "", "beta", "still beta"];
  const got = wrap(lines, at(lines, 3, 2), "callout");
  eq(
    "wrapping a two-row paragraph keeps both rows in the box",
    got.rows,
    ["alpha", "", "> [!note] ", "> beta", "> still beta"]
  );
  eq("the caret waits at the end of the title row", got.caret, [3, 10]);
}

{
  // A quote interrupts a paragraph in CommonMark, so the Callout needs no
  // blank row invented above it — and inventing one would move text the
  // writer can see.
  const lines = ["alpha", "# beta"];
  const got = wrap(lines, at(lines, 2, 0), "callout");
  eq(
    "a Callout may open directly under the paragraph above it",
    got.rows,
    ["alpha", "> [!note] ", "> # beta"]
  );
  eq("…with the caret on the row it created", got.caret, [2, 10]);
}

{
  // A table, on the other hand, stops rendering without a blank line above
  // it — and the row above it is about to become "> beta".
  const lines = ["beta", "", "| a | b |", "| - | - |"];
  const got = wrap(lines, at(lines, 1, 0), "callout");
  eq(
    "the blank row a table needs below the wrap survives",
    got.rows,
    ["> [!note] ", "> beta", "", "| a | b |", "| - | - |"]
  );
}

{
  const lines = ["const x = 1", "", "after"];
  const got = wrap(lines, at(lines, 1, 0), "code");
  eq("code wraps in place", got.rows, ["```", "const x = 1", "```", "", "after"]);
  eq("the caret sits where the language is typed", got.caret, [1, 3]);
}

{
  const lines = ["```js", "code", "```"];
  const got = wrap(lines, at(lines, 2, 0), "code");
  ok("a refused wrap dispatches nothing", !got.applied);
  eq("…and leaves the document alone", got.rows, lines);
}

/* ------------------------------------------------------------------ */
/* insertBlockAbove                                                    */
/* ------------------------------------------------------------------ */

{
  const lines = ["> [!note] Title", "> body", "", "after"];
  const view = makeView(lines, at(lines, 1, 3));
  const doc = view.state.doc;
  insertBlockAbove(view, getBlockRange(doc, 1, scanFences(doc)), false);
  eq(
    "a note that opens with a Callout gains a row above it",
    rows(view),
    ["", "> [!note] Title", "> body", "", "after"]
  );
  eq("the caret is in the new row", caretOf(view), [1, 0]);
}

/* ------------------------------------------------------------------ */
/* inputRuleExpansion                                                  */
/* ------------------------------------------------------------------ */

const rule = (before, toggles = true) =>
  inputRuleExpansion(before, { toggles })?.insert ?? null;

eq('">!" opens a note Callout', rule(">!"), "> [!note] ");
eq('">!tip" picks the type', rule(">!tip"), "> [!tip] ");
eq('the type is case-insensitive', rule(">!TIP"), "> [!tip] ");
eq('an Obsidian alias resolves ("error" → danger)', rule(">!error"), "> [!danger] ");
eq("a Chinese type name resolves", rule(">!提示"), "> [!tip] ");
eq('a trailing "-" makes it foldable and collapsed', rule(">!note-"), "> [!note]- ");
eq('a trailing "+" makes it foldable and open', rule(">!warning+"), "> [!warning]+ ");
eq('">!toggle" writes a toggle, always with a marker', rule(">!toggle"), "> [!nf-toggle]+ ");
eq("折叠 is the same shorthand", rule(">!折叠"), "> [!nf-toggle]+ ");
ok("toggles off means the toggle shorthand does not fire", rule(">!toggle", false) === null);
eq("a nested shorthand keeps its depth", rule("> >!"), "> > [!note] ");
eq("the markers are normalized to one space each", rule(">   >!"), "> > [!note] ");
eq("indentation is preserved", rule("  >!"), "  > [!note] ");

ok("an unknown type stays literal", rule(">!foo") === null);
ok('"!" without a ">" is not shorthand', rule("!") === null);
ok("shorthand mid-line is prose", rule("see >!") === null);
ok("a plain quote marker is left to Obsidian", rule(">") === null);

eq('"[]" writes a to-do', rule("[]"), "- [ ] ");
eq('"[x]" writes a checked to-do', rule("[x]"), "- [x] ");
eq("a bullet already typed is not doubled", rule("- []"), "- [ ] ");
eq("inside a quote the to-do keeps the markers", rule("> []"), "> - [ ] ");
eq("an indented to-do keeps its column", rule("    []"), "    - [ ] ");
ok('"[]" after text is prose', rule("see []") === null);

/* ------------------------------------------------------------------ */
/* The rule as a transaction filter: WHEN it is allowed to fire        */
/* ------------------------------------------------------------------ */

const fakePlugin = (settings = {}) => ({
  settings: { inputRules: true, toggleBlocks: true, ...settings },
});

/** The state a writer is in just before the space lands: caret where the
 *  keystroke goes, filter installed. */
const stateAt = (lines, caret, settings) =>
  EditorState.create({
    doc: lines.join("\n"),
    selection: Array.isArray(caret)
      ? EditorSelection.create(caret.map((pos) => EditorSelection.cursor(pos)))
      : { anchor: caret },
    extensions: [makeInputRuleFilter(fakePlugin(settings))],
  });

/** Type `spec` into `lines` with the filter installed; returns the doc. */
const typed = (lines, spec, settings, caret = spec.changes.from) =>
  stateAt(lines, caret, settings).update(spec).state.doc.toString();
/** The ordinary shape: one caret typing one space at `pos`. */
const space = (pos) => ({
  changes: { from: pos, insert: " " },
  selection: { anchor: pos + 1 },
  userEvent: "input.type",
});

eq(
  "typing the space expands the shorthand",
  typed([">!"], space(2)),
  "> [!note] "
);
eq(
  "the expansion replaces only its own line",
  typed(["above", ">!", "below"], space(docOf(["above", ">!", "below"]).line(2).to)),
  "above\n> [!note] \nbelow"
);
eq(
  "a space typed mid-line is just a space",
  typed([">!x"], space(2)),
  ">! x"
);
eq(
  "a pasted space is not typing",
  typed([">!"], { ...space(2), userEvent: "input.paste" }),
  ">! "
);
eq(
  "an undo replaying a space is not typing",
  typed([">!"], { changes: { from: 2, insert: " " }, selection: { anchor: 3 } }),
  ">! "
);
eq(
  "a space typed inside a fence is code",
  typed(["```", ">!", "```"], space(docOf(["```", ">!", "```"]).line(2).to)),
  "```\n>! \n```"
);
eq(
  "the rule off leaves the shorthand alone",
  typed([">!"], space(2), { inputRules: false }),
  ">! "
);
{
  const lines = [">!", ">!"];
  const doc = docOf(lines);
  const ends = [doc.line(1).to, doc.line(2).to];
  eq(
    "two carets typing at once are not one shorthand",
    typed(
      lines,
      {
        changes: ends.map((from) => ({ from, insert: " " })),
        userEvent: "input.type",
      },
      undefined,
      ends
    ),
    ">! \n>! "
  );
}
{
  const next = stateAt(["[]"], 2).update(space(2)).state;
  eq("the to-do rule fires through the filter too", next.doc.toString(), "- [ ] ");
  eq("…leaving the caret ready to type", next.selection.main.head, 6);
}

/* ------------------------------------------------------------------ */
/* adjacentBlock                                                       */
/* ------------------------------------------------------------------ */

{
  const lines = [
    "first paragraph",
    "",
    "- list item",
    "  - nested",
    "",
    "> [!note] Callout",
    "> body",
  ];
  const doc = docOf(lines);
  const fences = scanFences(doc);
  const step = (lineNo, dir) => {
    const block = getBlockRange(doc, lineNo, fences);
    const next = adjacentBlock(doc, block, dir, fences);
    return next ? [next.startLine, next.endLine] : null;
  };

  eq("down steps over the blank seam to the list", step(1, 1), [3, 4]);
  eq("stepping from the seam itself still lands on a real block", step(2, 1), [3, 4]);
  eq("the whole list, nested rows included, is one step", step(3, 1), [6, 7]);
  // Asymmetric on purpose, and the same asymmetry the drag handle has:
  // stepping DOWN from the list leaves the whole list, because the nested
  // row is inside the block just left; stepping UP from below enters it,
  // because that row is a block of its own when addressed from itself.
  eq("up from the Callout lands on the nested row it passes", step(6, -1), [4, 4]);
  eq("up again leaves the list for its parent row", step(4, -1), [3, 4]);
  ok("there is nothing above the first block", step(1, -1) === null);
  ok("there is nothing below the last block", step(6, 1) === null);
}

{
  const lines = ["```js", "code", "```", "", "after"];
  const doc = docOf(lines);
  const fences = scanFences(doc);
  const block = getBlockRange(doc, 2, fences);
  const next = adjacentBlock(doc, block, 1, fences);
  eq(
    "a step out of a code block starts past its closing fence",
    next && [next.startLine, next.endLine],
    [5, 5]
  );
}

/* ------------------------------------------------------------------ */
/* blockInsertAbovePlan                                                */
/* ------------------------------------------------------------------ */

{
  const lines = ["> [!note] Title", "> body", "", "after"];
  const doc = docOf(lines);
  const plan = blockInsertAbovePlan(doc, getBlockRange(doc, 1, scanFences(doc)));
  eq(
    "a Callout opening the note gets a plain row above it",
    [plan.from, plan.insert, plan.caret],
    [0, "\n", 0]
  );
}

{
  const lines = ["text", "", "> [!note] Title", "> body"];
  const doc = docOf(lines);
  const fences = scanFences(doc);
  const block = innerBlockAt(doc, 4, fences);
  const plan = blockInsertAbovePlan(doc, block);
  ok(
    "a row inside a Callout gets a row with the container's markers",
    plan.insert === "> \n",
    JSON.stringify(plan)
  );
  ok(
    "…inserted at the start of that row, caret past the markers",
    plan.from === doc.line(4).from && plan.caret === plan.from + 2,
    JSON.stringify(plan)
  );
}

{
  const lines = ["- item", "  continued", "", "after"];
  const doc = docOf(lines);
  const plan = blockInsertAbovePlan(doc, getBlockRange(doc, 1, scanFences(doc)));
  eq(
    "a list item's new row opens at the item's own column",
    [plan.from, plan.insert],
    [0, "\n"]
  );
}

if (fail) process.exit(1);
console.log("ALL PASS");
