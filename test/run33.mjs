import { EditorState, Text } from "@codemirror/state";
import {
  SLASH_COMMANDS,
  SlashSuggest,
  applyLinePrefix,
  batchToggleFormatChanges,
  blocksInLineSpan,
  cellBgColorAt,
  formatTable,
  getTableRange,
  innerBlockAt,
  isDelimRow,
  isTableRow,
  nearestTableDataRow,
  parseRow,
  scanFences,
  seamRowBetween,
  setCellBgAt,
  tableAddColumn,
  tableAddRow,
  tableBgColor,
  tableColumnAlignment,
  tableDeleteColumn,
  tableDeleteRow,
  tableInsertColumn,
  tableInsertRow,
  tableNavigate,
  tableRowBelow,
  tableRowPrefix,
  tableSetAlignment,
  tableWithBg,
} from "./bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));

const docOf = (lines) => EditorState.create({ doc: lines.join("\n") }).doc;
const rowsOf = (text) => text.split("\n");

/* ------------------------------------------------------------------ */
/* A table inside a Callout is a table                                 */
/*                                                                     */
/* The model recognised rows by leading whitespace alone, so every     */
/* table entry point — Tab navigation, the toolbar, the handle menu,   */
/* the row/column commands — went dark the moment a table lived        */
/* inside a Callout. A row's quote markers are just a longer prefix;   */
/* everything else already worked from the first "|" onward.           */
/* ------------------------------------------------------------------ */

{
  const shape = (text) => [isTableRow(text), tableRowPrefix(text)];
  eq("a plain row is a row", shape("| a |"), [true, ""]);
  eq("an indented row keeps its indent", shape("  | a |"), [true, "  "]);
  eq("a quoted row is a row", shape("> | a |"), [true, "> "]);
  eq("…with no space after the marker", shape(">| a |"), [true, ">"]);
  eq("…nested two deep", shape("> > | a |"), [true, "> > "]);
  eq("…inside an indented Callout", shape("  > | a |"), [true, "  > "]);
  eq("…at a list's content column", shape(">   | a |"), [true, ">   "]);
  eq("prose containing a pipe is not a row", shape("text | a |"), [false, ""]);
  eq("a list item holding a pipe is not a row", shape("> - | a |"), [false, ""]);

  ok("a quoted delimiter row is recognised", isDelimRow("> | --- | --- |"));
  ok("…indented and with colons", isDelimRow("  > | :-: | ---: |"));
  ok("a quoted body row is not a delimiter", !isDelimRow("> | a | b |"));
}

{
  const doc = docOf([
    "> [!note] T",
    "> | a | b |",
    "> | --- | --- |",
    "> | 1 | 2 |",
    "> after",
  ]);
  const fences = scanFences(doc);
  eq("the table is found from its header row", getTableRange(doc, 2, fences), {
    startLine: 2,
    endLine: 4,
  });
  eq("…and from a body row", getTableRange(doc, 4, fences), {
    startLine: 2,
    endLine: 4,
  });
  eq("a prose row in the Callout is not a table", getTableRange(doc, 5, fences), null);
  eq("neither is the Callout title", getTableRange(doc, 1, fences), null);

  // Depth bounds the block: an outer table must not absorb an inner one.
  const nested = docOf(["> | a |", "> | --- |", "> > | x |", "> > | --- |"]);
  const nestedFences = scanFences(nested);
  eq("the outer table stops at the nested one", getTableRange(nested, 1, nestedFences), {
    startLine: 1,
    endLine: 2,
  });
  eq("…and the nested one stands alone", getTableRange(nested, 3, nestedFences), {
    startLine: 3,
    endLine: 4,
  });

  // A fence still ends a table, quoted or not.
  const fenced = docOf(["> | a |", "> ```", "> | x |", "> ```"]);
  eq(
    "a quoted fence bounds a quoted table",
    getTableRange(fenced, 1, scanFences(fenced)),
    { startLine: 1, endLine: 1 }
  );
}

{
  const tbl = ["> | a | b |", "> | --- | --- |", "> | 1 | 2 |"].join("\n");
  const aligned = ["> | a   | b   |", "> | --- | --- |", "> | 1   | 2   |"];

  eq("format keeps every row inside the Callout", rowsOf(formatTable(tbl)), aligned);
  eq("add row", rowsOf(tableAddRow(tbl)), [...aligned, "> |     |     |"]);
  eq("add column", rowsOf(tableAddColumn(tbl)), [
    "> | a   | b   |     |",
    "> | --- | --- | --- |",
    "> | 1   | 2   |     |",
  ]);
  eq("insert row below", rowsOf(tableInsertRow(tbl, 2, "below")), [
    ...aligned,
    "> |     |     |",
  ]);
  eq("delete row", rowsOf(tableDeleteRow(tbl, 2)), aligned.slice(0, 2));
  eq("delete column", rowsOf(tableDeleteColumn(tbl, 1)), [
    "> | a |",
    "> | --- |",
    "> | 1   |",
  ]);
  eq("insert column", rowsOf(tableInsertColumn(tbl, 0, "right"))[1], "> | --- | --- | --- |");
  eq("set alignment", rowsOf(tableSetAlignment(tbl, 0, "center"))[1], "> | :-: | --- |");
  eq(
    "alignment reads back",
    tableColumnAlignment(tableSetAlignment(tbl, 0, "center"), 0),
    "center"
  );

  // Emoji, escaped pipes and joiner sequences are measured as they
  // render, so the padding lines the columns up.
  eq("an emoji cell is two columns wide", rowsOf(formatTable(["| ✅ | a |", "| --- | --- |", "| abc | b |"].join("\n"))), [
    "| ✅  | a   |",
    "| --- | --- |",
    "| abc | b   |",
  ]);
  eq("an escaped pipe counts once", rowsOf(formatTable(["| a\\|b | c |", "| --- | --- |", "| xyz | d |"].join("\n"))), [
    "| a\\|b | c   |",
    "| --- | --- |",
    "| xyz | d   |",
  ]);
  eq("a ZWJ family is one glyph", rowsOf(formatTable(["| 👨‍👩‍👧 | x |", "| --- | --- |", "| abc | y |"].join("\n"))), [
    "| 👨‍👩‍👧  | x   |",
    "| --- | --- |",
    "| abc | y   |",
  ]);
  eq("a text check mark stays narrow", rowsOf(formatTable(["| ✓ | y |", "| --- | --- |", "| abc | z |"].join("\n"))), [
    "| ✓   | y   |",
    "| --- | --- |",
    "| abc | z   |",
  ]);

  const indented = ["  > | a | b |", "  > | --- | --- |"].join("\n");
  eq("an indented Callout's table keeps both prefixes", rowsOf(formatTable(indented)), [
    "  > | a   | b   |",
    "  > | --- | --- |",
  ]);
  eq("…when a row is appended too", rowsOf(tableAddRow(indented))[2], "  > |     |     |");

  // Colour markers live in the cells, so they are prefix-agnostic — but
  // the anchor row lookup used to reject quoted rows outright.
  const celled = setCellBgAt(tbl, 2, 1, "blue");
  eq("a cell colour lands in the right cell", cellBgColorAt(celled, 2, 1), "blue");
  ok("…keeping the row's markers", celled.split("\n")[2].startsWith("> |"), celled);
  const tinted = tableWithBg(tbl, "red");
  eq("a table tint is stored", tableBgColor(tinted), "red");
  ok("…in the first header cell of a quoted row", tinted.split("\n")[0].startsWith("> | <span"), tinted);
  eq("cell and table colours coexist", tableBgColor(tableWithBg(celled, "red")), "red");
  eq("…without losing the cell colour", cellBgColorAt(tableWithBg(celled, "red"), 2, 1), "blue");
}

{
  const rows = rowsOf(formatTable(["> | a | b |", "> | --- | --- |", "> | 1 | 2 |"].join("\n")));
  eq("cells parse past the markers", parseRow(rows[0]), ["a", "b"]);
  eq("Tab moves to the next cell", tableNavigate(rows, 0, 4, 1), { row: 0, ch: 10 });
  eq("Tab skips the delimiter row", tableNavigate(rows, 0, 10, 1), { row: 2, ch: 4 });
  eq("Tab past the last cell appends", tableNavigate(rows, 2, 10, 1), "append");
  eq("Shift-Tab crosses the delimiter row", tableNavigate(rows, 2, 4, -1), { row: 0, ch: 10 });
  eq("Enter lands in the same column below", tableRowBelow(rows, 0, 4), { row: 2, ch: 4 });
  eq("re-homing skips the delimiter row", nearestTableDataRow(rows.join("\n"), 1), 0);
}

/* ------------------------------------------------------------------ */
/* Slash commands nest inside a list that is inside a Callout          */
/* ------------------------------------------------------------------ */

class MockEditor {
  constructor(lines) { this.lines = lines; }
  getLine(n) { return this.lines[n]; }
  setLine(n, text) { this.lines[n] = text; }
  setCursor() {}
  replaceRange(text, from, to) {
    const head = this.lines[from.line].slice(0, from.ch);
    const tail = this.lines[to.line].slice(to.ch);
    this.lines.splice(from.line, to.line - from.line + 1, ...(head + text + tail).split("\n"));
  }
  text() { return this.lines.join("\n"); }
}

const runSlash = (lines, lineNo, id, start) => {
  const suggest = new SlashSuggest({ app: {}, settings: { slashCommands: true } });
  suggest.plugin = { settings: { slashCommands: true } };
  const editor = new MockEditor([...lines]);
  suggest.context = {
    editor,
    start: { line: lineNo, ch: start },
    end: { line: lineNo, ch: lines[lineNo].length },
  };
  suggest.selectSuggestion(SLASH_COMMANDS.find((c) => c.id === id), {});
  return editor.text().split("\n");
};

{
  eq(
    "/code in a Callout's list item nests under the bullet",
    runSlash(["> [!note] T", "> - item /"], 1, "code", 9),
    ["> [!note] T", "> - item ", ">   ```", ">   ", ">   ```"]
  );
  eq(
    "/callout in a Callout's list item nests too",
    runSlash(["> [!note] T", "> - item /"], 1, "callout", 9),
    ["> [!note] T", "> - item ", ">", ">   > [!note] ", ">   > "]
  );
  eq(
    "/table in a Callout's list item nests too",
    runSlash(["> [!note] T", "> - item /"], 1, "table", 9).slice(3, 5),
    [">   |     |     |     |", ">   | --- | --- | --- |"]
  );
  // A bare bullet gives way to the block (item 14): no empty bullet is left
  // beside the code, which sits under the parent item at the bullet's own
  // column, every row alike, after a marker seam row.
  eq(
    "a deeper bare quoted bullet gives way to the block at its column",
    runSlash(["> [!note] T", "> - a", ">   - /"], 2, "code", 6),
    ["> [!note] T", "> - a", ">", ">   ```", ">   ", ">   ```"]
  );
  eq(
    "…and a deeper quoted item with text still nests the block under it",
    runSlash(["> [!note] T", "> - a", ">   - b /"], 2, "code", 8),
    ["> [!note] T", "> - a", ">   - b ", ">     ```", ">     ", ">     ```"]
  );
  // Directly in the Callout — no list — the block stays at the box column.
  eq(
    "/code directly in a Callout is unchanged",
    runSlash(["> [!note] T", "> body /"], 1, "code", 7),
    ["> [!note] T", "> body ", "> ```", "> ", "> ```"]
  );
  // Outside a quote the block nests under the item, its empty body row
  // included: a blank row there would end the list and leave the fence open.
  eq(
    "/code in a plain list item keeps every row in the item",
    runSlash(["- item /"], 0, "code", 7),
    ["- item ", "  ```", "  ", "  ```"]
  );
}

{
  // What the slash command writes has to be what the model reads back.
  const produced = runSlash(["> [!note] T", "> - item /"], 1, "table", 9);
  const doc = docOf(produced);
  const range = getTableRange(doc, 4, scanFences(doc));
  eq("the table it wrote is editable", range, { startLine: 4, endLine: 7 });

  const code = runSlash(["> [!note] T", "> - item /"], 1, "code", 9);
  const codeDoc = docOf(code);
  eq(
    "the code block it wrote is a fence",
    scanFences(codeDoc).map((f) => [f.startLine, f.endLine, f.bodyPrefix]),
    [[3, 5, ">   "]]
  );
}

/* ------------------------------------------------------------------ */
/* Turning a nested quoted row into something else                     */
/* ------------------------------------------------------------------ */

{
  eq(
    "a nested bullet inside a quote is fully replaced",
    applyLinePrefix(">   - nested", "- "),
    "- nested"
  );
  eq("a directly quoted row is unchanged", applyLinePrefix("> body", "# "), "# body");
  eq("a plain nested bullet is unchanged", applyLinePrefix("  - nested", "# "), "  # nested");
  eq("an indented quote keeps its indent", applyLinePrefix("  > body", "## "), "  ## body");
}

{
  // The whole-Callout selection: prose and lists gain the format, the code
  // block and the table are left alone.
  const lines = [
    "> [!note] Title",
    "> body",
    "> - list a",
    ">   - list a1",
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
  let out = lines.join("\n");
  for (const c of [...result.changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  }
  eq("bolding leaves the quoted table alone", out.split("\n"), [
    "> [!note] Title",
    "> **body**",
    "> - **list a**",
    ">   - **list a1**",
    "> | a | b |",
    "> | --- | --- |",
  ]);
}

/* ------------------------------------------------------------------ */
/* Duplicating a row inside an indented Callout                        */
/* ------------------------------------------------------------------ */

{
  const lines = ["- one", "  > [!tip] T", "  > | a | b |", "  > | --- | --- |"];
  const doc = docOf(lines);
  const block = innerBlockAt(doc, 3, scanFences(doc));
  const text = doc.sliceString(doc.line(block.startLine).from, doc.line(block.endLine).to);
  const rows = text.split("\n");
  const seam = seamRowBetween(rows[rows.length - 1], rows[0], block.quotePrefix);
  eq("the duplicate seam carries the container's indent", seam, "  >");
  ok(
    "…so the copy stays one box",
    seam === null || seam.trimStart().startsWith(">"),
    JSON.stringify(seam)
  );
}

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
