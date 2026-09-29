/*
 * Block selection × editing.
 *
 * A marquee decides WHICH blocks an edit is about; these are the edits it
 * then hands to the document. Everything here is checked as resulting text,
 * because that is what the note is left holding: a delete that fuses the
 * blocks it ran between, a paste that stops a table rendering, or a bold
 * pass that spells "---" inside asterisks are all invisible in a range list
 * and obvious in the document.
 */
import { EditorState } from "@codemirror/state";
import {
  blocksInLineSpan,
  blockSelectionRemovalRange,
  blockSelectionPasteInsert,
  batchToggleFormatChanges,
  batchTurnIntoChanges,
} from "./bundle.mjs";

let fail = 0;
const check = (name, got, expected) => {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: got ${JSON.stringify(got)}` +
      (ok ? "" : ` expected ${JSON.stringify(expected)}`)
  );
};

const doc = (lines) => EditorState.create({ doc: lines.join("\n") }).doc;
const apply = (text, changes) => {
  let out = text;
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, change.from) + change.insert + out.slice(change.to);
  }
  return out;
};

const BOLD = { marker: "**", open: "<b>", close: "</b>" };
const ITALIC = { marker: "*", open: "<i>", close: "</i>" };
const UNDERLINE = { open: "<u>", close: "</u>" };

/* ------------------------------------------------------------------ */
/* What a marquee resolves to                                          */
/* ------------------------------------------------------------------ */

// Every non-blank line the sweep covers belongs to exactly one block, in
// order. A line reported by two blocks would be edited twice by one
// transaction. Blank separator rows are not blocks and stay unselected.
const CORPUS = [
  ["alpha", "", "## beta", "", "- a", "  - b", "", "```js", "x", "```"],
  ["> [!note] Title", "> body", "> ", "> - item", "", "after"],
  ["1. one", "2. two", "3. three"],
  ["# h", "para lazy", "continuation", "", "- l", "  nested lazy"],
  ["", "", ""],
  ["| a | b |", "| - | - |", "| 1 | 2 |", "*table cap*", "next"],
  ["![](x.png)", "*cap*", "", "text", "---", "", "> q", "> r"],
  ["- [ ] task", "- [x] done"],
  ["> outer", ">> inner", "> outer2"],
];
let overlaps = 0;
let uncovered = 0;
let unordered = 0;
for (const lines of CORPUS) {
  const d = doc(lines);
  const blocks = blocksInLineSpan(d, 1, d.lines);
  const seen = new Set();
  for (const block of blocks) {
    for (let n = block.startLine; n <= block.endLine; n++) {
      if (seen.has(n)) overlaps++;
      seen.add(n);
    }
  }
  for (let n = 1; n <= d.lines; n++) {
    if (!seen.has(n) && !/^[\s>]*$/.test(d.line(n).text)) uncovered++;
  }
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].startLine <= blocks[i - 1].endLine) unordered++;
  }
}
check("no line lands in two selected blocks", overlaps, 0);
check("the sweep leaves no non-blank line unselected", uncovered, 0);
check("selected blocks come out in document order", unordered, 0);

// A sweep that starts inside a bigger block still yields whole blocks: from
// the nested child down, the parent item is not half-selected.
// The parent item reaches over its child, but the child answers for itself:
// a sweep that starts on the child selects the child, not the whole item.
check(
  "sweep from a nested child selects the child alone",
  blocksInLineSpan(doc(["- a", "  - b", "- c"]), 2, 2),
  [{ startLine: 2, endLine: 2 }]
);
check(
  "sweep from the parent takes the child with it",
  blocksInLineSpan(doc(["- a", "  - b", "- c"]), 1, 2),
  [{ startLine: 1, endLine: 2 }]
);
// A row inside a Callout resolves to the box: a marquee cannot select half
// of one, so the delete/format below always act on a whole container.
check(
  "sweep inside a Callout selects the whole box",
  blocksInLineSpan(doc(["> [!note] T", "> a", "> b"]), 2, 2),
  [{ startLine: 1, endLine: 3 }]
);
check(
  "sweep bounds are clamped to the document",
  blocksInLineSpan(doc(["only"]), -4, 99),
  [{ startLine: 1, endLine: 1 }]
);

/* ------------------------------------------------------------------ */
/* Delete                                                              */
/* ------------------------------------------------------------------ */

const afterDelete = (lines, from, to) => {
  const d = doc(lines);
  const range = blockSelectionRemovalRange(d, blocksInLineSpan(d, from, to));
  const text = d.toString();
  return range ? text.slice(0, range.from) + text.slice(range.to) : text;
};

check(
  "deleting a block leaves its neighbours separate",
  afterDelete(["above", "", "sel", "", "below"], 3, 3),
  "above\n\nbelow"
);
check(
  "deleting a block and both blank seams still leaves one",
  afterDelete(["above", "", "sel", "", "below"], 2, 4),
  "above\n\nbelow"
);
check(
  "deleting up to a table keeps the blank the table needs",
  afterDelete(["above", "", "sel", "", "| a |", "| - |"], 3, 4),
  "above\n\n| a |\n| - |"
);
check(
  "deleting the blank seam alone puts one back",
  afterDelete(["above", "", "| a |", "| - |"], 2, 2),
  "above\n\n| a |\n| - |"
);
check(
  "deleting a whole Callout takes all of its rows",
  afterDelete(["a", "", "> [!note] T", "> body", "", "b"], 3, 4),
  "a\n\nb"
);
check(
  "deleting a fence takes the closing marker with it",
  afterDelete(["a", "", "```js", "x", "```", "", "b"], 3, 5),
  "a\n\nb"
);
check(
  "deleting a rule does not fuse the paragraphs it separated",
  afterDelete(["a", "", "---", "", "b"], 3, 3),
  "a\n\nb"
);
check(
  "deleting sibling list items keeps the rest of the list",
  afterDelete(["- a", "- b", "- c"], 1, 2),
  "- c"
);
check(
  "deleting a nested child leaves its parent",
  afterDelete(["- a", "  - b", "- c"], 2, 2),
  "- a\n- c"
);
check(
  "deleting an image takes its caption",
  afterDelete(["above", "", "![](x.png)", "*cap*", "", "below"], 3, 4),
  "above\n\nbelow"
);
check("select-all then delete empties the note", afterDelete(["a", "", "b", "", "c"], 1, 5), "");
check("deleting the only block empties the note", afterDelete(["only"], 1, 1), "");
check("deleting an empty note is a no-op", afterDelete([""], 1, 1), "");

/* ------------------------------------------------------------------ */
/* Paste over a selection                                              */
/* ------------------------------------------------------------------ */

const afterPaste = (lines, from, to, clip) => {
  const d = doc(lines);
  // A span of blank rows alone selects nothing now; a seam can still be
  // held in a selection directly (its own drag handle), so hand it over.
  const span = blocksInLineSpan(d, from, to);
  const blocks = span.length > 0 ? span : [{ startLine: from, endLine: to }];
  const insert = blockSelectionPasteInsert(d, blocks, clip);
  const text = d.toString();
  return (
    text.slice(0, d.line(blocks[0].startLine).from) +
    insert +
    text.slice(d.line(blocks[blocks.length - 1].endLine).to)
  );
};

check(
  "a pasted table gets the blank line it needs to render",
  afterPaste(["above", "", "sel", "", "below"], 3, 3, "| a |\n| - |"),
  "above\n\n| a |\n| - |\n\nbelow"
);
check(
  "a pasted rule cannot turn the paragraph above into a heading",
  afterPaste(["above", "", "sel", "", "below"], 3, 3, "---"),
  "above\n\n---\n\nbelow"
);
check(
  "pasting over a blank seam held directly restores it",
  afterPaste(["above", "", "| a |", "| - |"], 2, 2, "text"),
  "above\n\ntext\n\n| a |\n| - |"
);
check(
  "a pasted list cannot swallow the paragraph below it",
  afterPaste(["above", "", "sel", "", "below"], 3, 3, "- item"),
  "above\n\n- item\n\nbelow"
);
check(
  "plain text keeps the seams the selection had",
  afterPaste(["above", "", "sel", "", "below"], 3, 3, "hello"),
  "above\n\nhello\n\nbelow"
);
check(
  "pasted blocks keep their own blank lines",
  afterPaste(["above", "", "sel", "", "below"], 3, 3, "one\n\ntwo"),
  "above\n\none\n\ntwo\n\nbelow"
);
check(
  "a trailing newline on the clipboard adds no empty block",
  afterPaste(["above", "", "sel", "", "below"], 3, 3, "hello\n"),
  "above\n\nhello\n\nbelow"
);
check(
  "CRLF from another app arrives as plain rows",
  afterPaste(["above", "", "sel", "", "below"], 3, 3, "one\r\ntwo\r\n"),
  "above\n\none\ntwo\n\nbelow"
);
check(
  "pasting at the top of a note needs no seam above",
  afterPaste(["sel", "", "below"], 1, 1, "| a |\n| - |"),
  "| a |\n| - |\n\nbelow"
);
check(
  "pasting at the end of a note needs no seam below",
  afterPaste(["above", "", "sel"], 3, 3, "---"),
  "above\n\n---"
);
check(
  "an empty clipboard is not a paste",
  blockSelectionPasteInsert(doc(["a", "", "b"]), blocksInLineSpan(doc(["a", "", "b"]), 3, 3), ""),
  ""
);
check(
  "with nothing selected there is nothing to replace",
  blockSelectionPasteInsert(doc(["a"]), [], "hello"),
  "hello"
);

/* ------------------------------------------------------------------ */
/* Toolbar formatting                                                  */
/* ------------------------------------------------------------------ */

const format = (lines, markers = BOLD) => {
  const d = doc(lines);
  const blocks = blocksInLineSpan(d, 1, d.lines);
  const result = batchToggleFormatChanges(d, blocks, markers);
  return { text: apply(d.toString(), result.changes), ...result };
};
const roundTrip = (lines, markers = BOLD) => {
  const on = format(lines, markers);
  const off = format(on.text.split("\n"), markers);
  return off.text;
};

check(
  "bold reaches the content of every block type",
  format(["alpha", "- item", "> quote", "# head", "- [ ] task"]).text,
  "**alpha**\n- **item**\n> **quote**\n# **head**\n- [ ] **task**"
);
check(
  "block prefixes and trailing spaces stay outside the markers",
  format(["  - item   "]).text,
  "  - **item**   "
);
check(
  "a Callout title keeps its syntax while its rows take the format",
  format(["> [!note] Title", "> body"]).text,
  "> [!note] Title\n> **body**"
);
check("fences are skipped, not formatted", format(["```js", "x=1", "```"]).skipped, 1);
check("tables are skipped, not formatted", format(["| a |", "| - |"]).skipped, 1);
check(
  "a rule is skipped rather than wrapped in asterisks",
  format(["alpha", "---", "beta"]).text,
  "**alpha**\n---\n**beta**"
);
check(
  "a rule inside a Callout is skipped too",
  format(["> [!note] T", "> ---", "> body"]).text,
  "> [!note] T\n> ---\n> **body**"
);
check("a rule counts as a skipped block", format(["---"]).skipped, 1);
check("blank blocks are quietly passed over", format(["alpha", "", "beta"]).text, "**alpha**\n\n**beta**");

// Notion semantics: the format comes off only when every eligible line has
// it, so one unformatted line in the sweep formats the rest instead.
check("a fully formatted selection toggles off", format(["**a**", "**b**"]).removed, true);
check("a partly formatted selection toggles on", format(["**a**", "b"]).removed, false);
check(
  "toggling on a partly formatted selection leaves it uniform",
  format(["**a**", "b"]).text,
  "**a**\n**b**"
);
check("bold survives a round trip", roundTrip(["alpha", "- item", "> quote"]), "alpha\n- item\n> quote");
check("italic survives a round trip", roundTrip(["alpha", "- item"], ITALIC), "alpha\n- item");
check(
  "underline has no Markdown spelling and uses tags",
  format(["alpha"], UNDERLINE).text,
  "<u>alpha</u>"
);
check("underline survives a round trip", roundTrip(["alpha", "beta"], UNDERLINE), "alpha\nbeta");
check(
  "a line already carrying tags keeps that family",
  format(["<b>alpha</b>", "beta"]).text,
  "<b>alpha</b>\n**beta**"
);
check("CJK content formats like any other", format(["层序遍历使用队列：", "1. 根节点入队。"]).text,
  "**层序遍历使用队列：**\n1. **根节点入队。**");
// "***a***" is bold+italic: stripping the bold pair must leave the italic.
check("nested emphasis unwraps one layer at a time", format(["***alpha***"]).text, "*alpha*");

/* ------------------------------------------------------------------ */
/* Turn into                                                           */
/* ------------------------------------------------------------------ */

const turn = (lines, prefix) => {
  const d = doc(lines);
  const result = batchTurnIntoChanges(d, blocksInLineSpan(d, 1, d.lines), prefix);
  return { text: apply(d.toString(), result.changes), skipped: result.skipped };
};

check("headings become list items", turn(["# h", "## i"], "- ").text, "- h\n- i");
check("a multi-row quote sheds its markers as a whole", turn(["> a", "> b"], "").text, "a\nb");
check(
  "a Callout keeps its title as ordinary text",
  turn(["> [!note] T", "> body"], "").text,
  "T\nbody"
);
check("a task keeps its text when it becomes a list item", turn(["- [ ] a"], "- ").text, "- a");
// A lone empty block selected on its own (Esc on an empty row) still takes
// a type; blank seams between other blocks never do.
check("an empty block can be given a type", (() => {
  const d = doc([""]);
  return apply(d.toString(), batchTurnIntoChanges(d, [{ startLine: 1, endLine: 1 }], "- ").changes);
})(), "- ");
check("a span of blank rows alone selects nothing to type", turn([""], "- ").text, "");
check(
  "structural blocks are reported rather than mangled",
  turn(["para", "", "| a |", "| - |", "```", "x", "```", "---"], "# "),
  { text: "# para\n\n| a |\n| - |\n```\nx\n```\n---", skipped: 3 }
);

if (fail) process.exit(1);
