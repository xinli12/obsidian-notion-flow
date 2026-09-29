import assert from "node:assert/strict";
import {
  cellBgColorAt,
  displayWidth,
  formatTable,
  tableBgColor,
  tableColumnAlignment,
  tableDuplicateRow,
  tableEditRecipe,
  tableMoveColumn,
  tableMoveRow,
  tableSortByColumn,
  tableStructureEditEnabled,
  tableWithBg,
  setCellBgAt,
} from "./bundle.mjs";

const rows = (text) => text.split("\n");
const table = [
  "| name | n |",
  "| :--- | ---: |",
  "| b | 2 |",
  "| a | 10 |",
  "| c | 1 |",
].join("\n");
const cells = (text) => rows(text).map((line) => line.split("|").slice(1, -1).map((c) => c.trim()));

/* ---------- move row ---------- */
assert.deepEqual(cells(tableMoveRow(table, 2, 1)).map((r) => r[0]), ["name", ":---", "a", "b", "c"]);
assert.deepEqual(cells(tableMoveRow(table, 4, -1)).map((r) => r[0]), ["name", ":---", "b", "c", "a"]);
assert.equal(tableMoveRow(table, 2, -1), table, "the first body row cannot cross the delimiter");
assert.equal(tableMoveRow(table, 4, 1), table, "the last row cannot leave the table");
assert.equal(tableMoveRow(table, 0, 1), table, "the header never moves");
assert.equal(tableMoveRow(table, 1, 1), table, "neither does the delimiter");
assert.equal(tableMoveRow("| a |", 0, 1), "| a |", "a lone header is untouched");

/* ---------- move column: alignment colons and markers travel ---------- */
{
  const moved = tableMoveColumn(table, 0, 1);
  assert.deepEqual(cells(moved)[0], ["n", "name"]);
  assert.deepEqual(cells(moved)[1], ["--:", ":---"], "alignment colons travel with their column");
  assert.equal(tableColumnAlignment(moved, 0), "right");
  assert.equal(tableColumnAlignment(moved, 1), "left");
  assert.equal(tableMoveColumn(table, 0, -1), table, "no column left of the first");
  assert.equal(tableMoveColumn(table, 1, 1), table, "no column right of the last");
  assert.equal(tableMoveColumn(moved, 1, -1), formatTable(table), "moving back restores the table");
}
{
  const tinted = tableWithBg(setCellBgAt(table, 2, 1, "blue"), "red");
  const moved = tableMoveColumn(tinted, 1, -1);
  assert.equal(tableBgColor(moved), "red", "the table tint survives a column move");
  assert(rows(moved)[0].startsWith('| <span class="nf-tbl-red"></span>'), "…and stays in the first header cell");
  assert.equal(cellBgColorAt(moved, 2, 0), "blue", "the cell background moved with its cell");
  assert.equal(cellBgColorAt(moved, 2, 1), null);
  assert.equal((moved.match(/nf-tbl-red/g) ?? []).length, 1, "exactly one marker");
  const rowMoved = tableMoveRow(tinted, 2, 1);
  assert.equal(cellBgColorAt(rowMoved, 3, 1), "blue", "a cell background rides along with its row");
  assert.equal(tableBgColor(rowMoved), "red");
}

/* ---------- duplicate row ---------- */
{
  const dup = tableDuplicateRow(table, 3);
  assert.deepEqual(cells(dup).map((r) => r[0]), ["name", ":---", "b", "a", "a", "c"]);
  assert.equal(tableDuplicateRow(table, 0), table, "the header is not duplicated");
  assert.equal(tableDuplicateRow(table, 1), table, "nor the delimiter");
  const colored = tableDuplicateRow(setCellBgAt(table, 2, 0, "green"), 2);
  assert.equal(cellBgColorAt(colored, 3, 0), "green", "the copy keeps the cell color");
}

/* ---------- sort ---------- */
{
  const asc = tableSortByColumn(table, 0, "asc");
  assert.deepEqual(cells(asc.text).map((r) => r[0]), ["name", ":---", "a", "b", "c"]);
  assert.deepEqual(asc.rowMap, [0, 1, 3, 2, 4], "each original row knows its new place");
  const desc = tableSortByColumn(table, 0, "desc");
  assert.deepEqual(cells(desc.text).map((r) => r[0]), ["name", ":---", "c", "b", "a"]);
  const numeric = tableSortByColumn(table, 1, "asc");
  assert.deepEqual(cells(numeric.text).map((r) => r[1]).slice(2), ["1", "2", "10"], "numbers sort by value");
  assert.deepEqual(cells(tableSortByColumn(table, 1, "desc").text).map((r) => r[1]).slice(2), ["10", "2", "1"]);

  const ties = ["| k | v |", "| --- | --- |", "| x | 1 |", "| y | 2 |", "| x | 3 |", "| y | 4 |"].join("\n");
  assert.deepEqual(cells(tableSortByColumn(ties, 0, "asc").text).map((r) => r[1]), ["v", "---", "1", "3", "2", "4"], "stable: equal keys keep their order");
  assert.deepEqual(cells(tableSortByColumn(ties, 0, "desc").text).map((r) => r[1]), ["v", "---", "2", "4", "1", "3"], "…descending too");

  const headerOnly = "| b |\n| a |";
  assert.deepEqual(tableSortByColumn(headerOnly, 0, "asc"), { text: headerOnly, rowMap: [0, 1] }, "no delimiter, no sort");

  const colored = tableWithBg(setCellBgAt(table, 2, 0, "blue"), "red");
  const sorted = tableSortByColumn(colored, 0, "asc");
  assert.equal(cellBgColorAt(sorted.text, 3, 0), "blue", "a colored cell sorts by its text, not its markup");
  assert.equal(tableBgColor(sorted.text), "red");
  assert.equal(cellBgColorAt(sorted.text, 2, 0), null);
  const cased = ["| k |", "| --- |", "| Beta |", "| alpha |", "| Éclair |"].join("\n");
  assert.deepEqual(cells(tableSortByColumn(cased, 0, "asc").text).map((r) => r[0]).slice(2), ["alpha", "Beta", "Éclair"], "case and accents are ignored");
}

/* ---------- recipes and availability ---------- */
{
  const recipe = tableEditRecipe("sort-asc");
  const out = recipe.edit(table, 3, 0);
  assert.deepEqual(recipe.target(3, 0, table, out), { row: 2, col: 0 }, "the caret follows its row through a sort");
  assert.deepEqual(tableEditRecipe("move-row-down").target(2, 1, "", ""), { row: 3, col: 1 });
  assert.deepEqual(tableEditRecipe("move-column-left").target(2, 1, "", ""), { row: 2, col: 0 });
  assert.deepEqual(tableEditRecipe("duplicate-row").target(2, 1, "", ""), { row: 3, col: 1 });
  const enabled = (row, col) =>
    ["move-row-up", "move-row-down", "duplicate-row", "move-column-left", "move-column-right", "sort-asc"]
      .filter((kind) => tableStructureEditEnabled(table, row, col, kind));
  assert.deepEqual(enabled(0, 0), ["move-column-right", "sort-asc"], "a header cell: columns and sorts only");
  assert.deepEqual(enabled(2, 1), ["move-row-down", "duplicate-row", "move-column-left", "sort-asc"]);
  assert.deepEqual(enabled(4, 0), ["move-row-up", "duplicate-row", "move-column-right", "sort-asc"]);
  assert.equal(tableStructureEditEnabled("| a |\n| --- |\n| 1 |", 2, 0, "sort-asc"), false, "one row needs no sort");
  assert.equal(tableStructureEditEnabled("| a |\n| b |", 1, 0, "sort-asc"), false, "no delimiter, no sort");
}

/* ---------- display width: emoji, joiners, escaped pipes ---------- */
assert.equal(displayWidth("✅"), 2, "emoji presentation symbol");
assert.equal(displayWidth("✓"), 1, "a text-presentation check mark stays narrow");
assert.equal(displayWidth("👨‍👩‍👧"), 2, "a ZWJ family is one glyph");
assert.equal(displayWidth("👍🏽"), 2, "skin tone modifiers add nothing");
assert.equal(displayWidth("❤️"), 2, "a variation selector promotes a text symbol to emoji width");
assert.equal(displayWidth("✅\uFE0F"), 2, "…but adds nothing to a symbol that is already wide");
assert.equal(displayWidth("a\uFE0F"), 1, "…and nothing to a letter");
assert.equal(displayWidth("1️⃣"), 1, "keycap: digit plus invisible combiners");
assert.equal(displayWidth("🇨🇳"), 2, "a flag pair is one glyph");
assert.equal(displayWidth("é"), 1, "a combining accent adds nothing");
assert.equal(displayWidth("a\\|b"), 3, "an escaped pipe renders as one character");
assert.equal(displayWidth("中文ab"), 6);
console.log("PASS table model: move row/column, duplicate, sort, availability and emoji-aware widths");
