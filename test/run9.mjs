import { EditorState } from "@codemirror/state";
import {
  parseRow,
  isDelimRow,
  displayWidth,
  formatTable,
  emptyRow,
  buildTableTemplate,
  tableAddRow,
  tableAddRowTop,
  tableAddColumn,
  tableInsertRow,
  tableInsertRowIndex,
  tableDeleteRow,
  tableInsertColumn,
  tableDeleteColumn,
  tableColumnAlignment,
  nearestTableDataRow,
  tableSetAlignment,
  tableSetAllAlignment,
  cellWithBg,
  cellBgColorAt,
  setCellBgAt,
  tableBgColor,
  tableWithBg,
  tableNavigate,
  tableRowBelow,
  moveBlock,
  getTableRange,
  getBlockRange,
  scanFences,
  SlashSuggest,
  SLASH_COMMANDS,
} from "./bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
};

/* ---------- row parsing ---------- */
{
  ok("parseRow basic", JSON.stringify(parseRow("| a | b |")) === '["a","b"]', JSON.stringify(parseRow("| a | b |")));
  ok("parseRow escaped pipe", JSON.stringify(parseRow("| a \\| x | b |")) === '["a \\\\| x","b"]', JSON.stringify(parseRow("| a \\| x | b |")));
  ok("parseRow unclosed row", JSON.stringify(parseRow("| a | b")) === '["a","b"]', JSON.stringify(parseRow("| a | b")));
  ok("delim row detected", isDelimRow("| --- | :-: |") === true);
  ok("data row not delim", isDelimRow("| a | b |") === false);
  ok("CJK width doubles", displayWidth("中文") === 4 && displayWidth("ab") === 2, `${displayWidth("中文")},${displayWidth("ab")}`);
}

/* ---------- formatTable ---------- */
{
  const src = "| 名称 | qty |\n| --- | :-: |\n| 苹果啊 | 3 |";
  const out = formatTable(src);
  ok(
    "format pads CJK-aware and keeps alignment",
    out === "| 名称   | qty |\n| ------ | :-: |\n| 苹果啊 | 3   |",
    JSON.stringify(out)
  );
  ok("format is idempotent", formatTable(out) === out, JSON.stringify(formatTable(out)));
  const ind = formatTable("  | a | b |\n  | --- | --- |");
  ok("format keeps indent", ind.startsWith("  |") && ind.split("\n")[1].startsWith("  |"), JSON.stringify(ind));
}

/* ---------- add row / add column ---------- */
{
  const src = "| a | b |\n| --- | --- |\n| 1 | 2 |";
  const plus = tableAddRow(src);
  const lines = plus.split("\n");
  ok("addRow appends one line", lines.length === 4, JSON.stringify(plus));
  ok("addRow last row is empty cells", JSON.stringify(parseRow(lines[3])) === '["",""]', JSON.stringify(lines[3]));

  const wide = tableAddColumn(src);
  const cols = wide.split("\n").map((l) => parseRow(l).length);
  ok("addColumn widens every row", cols.every((n) => n === 3), JSON.stringify(wide));
  ok("addColumn keeps delim row valid", isDelimRow(wide.split("\n")[1]), JSON.stringify(wide.split("\n")[1]));

  const unclosed = tableAddColumn("| a | b\n| --- | ---");
  ok("addColumn closes unclosed rows", unclosed.split("\n").every((l) => l.endsWith("|")), JSON.stringify(unclosed));
  ok("emptyRow shape", emptyRow(2, "  ") === "  |   |   |", JSON.stringify(emptyRow(2, "  ")));
  const picked = buildTableTemplate(2, 4).replace("‸", "").split("\n");
  ok("table picker builds requested rendered rows", picked.length === 3, JSON.stringify(picked));
  ok("table picker builds requested columns", picked.every((line) => parseRow(line).length === 4), JSON.stringify(picked));
  ok("table picker keeps a valid delimiter", isDelimRow(picked[1]), picked[1]);
  const headerOnly = tableAddRow("| a | b |").split("\n");
  ok("addRow completes a header-only table", headerOnly.length === 3 && isDelimRow(headerOnly[1]) && parseRow(headerOnly[2]).every((cell) => cell === ""), JSON.stringify(headerOnly));

  const top = tableAddRowTop("| a | b |\n| --- | --- |\n| 1 | 2 |").split("\n");
  ok("addRowTop inserts first body row", top.length === 4 && parseRow(top[2]).every((cell) => cell === "") && JSON.stringify(parseRow(top[3])) === '["1","2"]', JSON.stringify(top));
}

/* ---------- cursor-relative insert / delete ---------- */
{
  const src = "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |";
  // insert row below the header's first body row (table line index 2)
  const rb = tableInsertRow(src, 2, "below").split("\n");
  ok("insertRow below adds a row", rb.length === 5, JSON.stringify(rb));
  ok("insertRow below is blank at index 3", JSON.stringify(parseRow(rb[3])) === '["",""]', JSON.stringify(rb[3]));
  // insert row "above" the header clamps below the delimiter (never splits header/delim)
  const ra = tableInsertRow(src, 0, "above").split("\n");
  ok("insertRow above header clamps into body", isDelimRow(ra[1]) && !isDelimRow(ra[2]) && parseRow(ra[2]).every((c) => c === ""), JSON.stringify(ra));
  ok("insert target below header skips delimiter", tableInsertRowIndex(src, 0, "below") === 2);
  ok("insert target above body is exact row", tableInsertRowIndex(src, 3, "above") === 3);
  const fragmentInsert = tableInsertRow("| a | b |", 0, "below").split("\n");
  ok("insertRow completes a header-only table", fragmentInsert.length === 3 && isDelimRow(fragmentInsert[1]), JSON.stringify(fragmentInsert));
  // delete a body row
  const dr = tableDeleteRow(src, 2).split("\n");
  ok("deleteRow removes body row", dr.length === 3 && JSON.stringify(parseRow(dr[2])) === '["3","4"]', JSON.stringify(dr));
  // header and delimiter are protected
  ok("deleteRow no-op on header", tableDeleteRow(src, 0) === src);
  ok("deleteRow no-op on delimiter", tableDeleteRow(src, 1) === src);
  const headerOnly = tableDeleteRow("| a | b |\n| --- | --- |\n| 1 | 2 |", 2);
  ok("cursor fallback after deleting only body is header", nearestTableDataRow(headerOnly, 2) === 0);
}
{
  const src = "| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |";
  const il = tableInsertColumn(src, 1, "left").split("\n");
  ok("insertColumn left widens rows", parseRow(il[0]).length === 4, JSON.stringify(il[0]));
  ok("insertColumn left blanks the new cell", parseRow(il[0])[1] === "", JSON.stringify(il[0]));
  ok("insertColumn keeps delim valid", isDelimRow(il[1]), JSON.stringify(il[1]));
  const ir = tableInsertColumn(src, 1, "right").split("\n");
  ok("insertColumn right blanks after current column", parseRow(ir[0])[2] === "", JSON.stringify(ir[0]));
  const dc = tableDeleteColumn(src, 1).split("\n");
  ok("deleteColumn narrows rows", parseRow(dc[0]).length === 2 && JSON.stringify(parseRow(dc[2])) === '["1","3"]', JSON.stringify(dc));
  ok("deleteColumn no-op on single column", tableDeleteColumn("| a |\n| --- |", 0) === "| a |\n| --- |");
}

/* ---------- per-table / per-cell backgrounds ---------- */
{
  ok("cellWithBg wraps", cellWithBg("hi", "red") === '<span class="nf-cell-red">hi</span>');
  ok("cellWithBg recolors", cellWithBg('<span class="nf-cell-red">hi</span>', "blue") === '<span class="nf-cell-blue">hi</span>');
  ok("cellWithBg strips", cellWithBg('<span class="nf-cell-red">hi</span>', null) === "hi");
  ok("cellWithBg keeps inner spans", cellWithBg('<span class="nf-cell-red">a <span style="color:x">b</span></span>', null) === 'a <span style="color:x">b</span>');
  ok("cellWithBg wraps empty cell", cellWithBg("", "green") === '<span class="nf-cell-green"></span>');

  const src = "| a | b |\n| --- | --- |\n| 1 | 2 |";
  const c = setCellBgAt(src, 2, 1, "blue");
  ok("setCellBgAt colors one cell", c === '| a | b |\n| --- | --- |\n| 1 | <span class="nf-cell-blue">2</span> |', JSON.stringify(c));
  ok("cell color state is readable", cellBgColorAt(c, 2, 1) === "blue");
  ok("plain cell has no color state", cellBgColorAt(c, 2, 0) === null);
  ok("setCellBgAt clears", setCellBgAt(c, 2, 1, null) === src, JSON.stringify(setCellBgAt(c, 2, 1, null)));
  ok("setCellBgAt no-op on delim row", setCellBgAt(src, 1, 0, "red") === src);

  const tb = tableWithBg(src, "green");
  ok("tableWithBg marks first header cell", tb.startsWith('| <span class="nf-tbl-green"></span>a |'), JSON.stringify(tb));
  ok("table color state is readable", tableBgColor(tb) === "green");
  const tb2 = tableWithBg(tb, "pink");
  ok("tableWithBg recolors marker", tb2.startsWith('| <span class="nf-tbl-pink"></span>a |') && !tb2.includes("nf-tbl-green"), JSON.stringify(tb2));
  ok("tableWithBg clears", tableWithBg(tb, null) === src, JSON.stringify(tableWithBg(tb, null)));

  // The first header cell owns both marker types. They must stay siblings,
  // remain independently readable, and survive changes in either order.
  const cellFirst = setCellBgAt(src, 0, 0, "blue");
  const both = tableWithBg(cellFirst, "green");
  ok("cell then table colors coexist", cellBgColorAt(both, 0, 0) === "blue" && tableBgColor(both) === "green", JSON.stringify(both));
  const tableFirst = setCellBgAt(tableWithBg(src, "pink"), 0, 0, "yellow");
  ok("table then cell colors coexist", cellBgColorAt(tableFirst, 0, 0) === "yellow" && tableBgColor(tableFirst) === "pink", JSON.stringify(tableFirst));
  const recolored = setCellBgAt(both, 0, 0, "red");
  ok("recoloring first cell does not nest wrappers", cellBgColorAt(recolored, 0, 0) === "red" && (recolored.match(/nf-cell-/g) ?? []).length === 1, JSON.stringify(recolored));
  const noCell = setCellBgAt(both, 0, 0, null);
  ok("clearing first cell preserves table color", cellBgColorAt(noCell, 0, 0) === null && tableBgColor(noCell) === "green", JSON.stringify(noCell));
  const noTable = tableWithBg(both, null);
  ok("clearing table preserves first-cell color", tableBgColor(noTable) === null && cellBgColorAt(noTable, 0, 0) === "blue", JSON.stringify(noTable));

  // Column operations must keep the single whole-table marker anchored to
  // the first header cell, even when that column is inserted or deleted.
  const insertedLeft = tableInsertColumn(tb, 0, "left");
  ok("insert-left re-anchors table marker", parseRow(insertedLeft.split("\n")[0])[0].includes("nf-tbl-green") && (insertedLeft.match(/nf-tbl-/g) ?? []).length === 1, JSON.stringify(insertedLeft));
  const insertedRecolor = tableWithBg(insertedLeft, "purple");
  ok("insert-left table tint recolors once", tableBgColor(insertedRecolor) === "purple" && (insertedRecolor.match(/nf-tbl-/g) ?? []).length === 1, JSON.stringify(insertedRecolor));
  ok("insert-left table tint clears", tableBgColor(tableWithBg(insertedLeft, null)) === null && !tableWithBg(insertedLeft, null).includes("nf-tbl-"), JSON.stringify(tableWithBg(insertedLeft, null)));
  const deletedFirst = tableDeleteColumn(tb, 0);
  ok("delete-first preserves table tint", tableBgColor(deletedFirst) === "green" && parseRow(deletedFirst.split("\n")[0])[0].includes("nf-tbl-green"), JSON.stringify(deletedFirst));

  const stale = '| a | <span class="nf-tbl-red"></span>b |\n| --- | --- |\n| 1 | 2 |';
  const repaired = tableWithBg(stale, "cyan");
  ok("tableWithBg repairs stale markers", tableBgColor(repaired) === "cyan" && (repaired.match(/nf-tbl-/g) ?? []).length === 1 && parseRow(repaired.split("\n")[0])[0].includes("nf-tbl-cyan"), JSON.stringify(repaired));

  // width math ignores html so formatting a colored table stays sane
  ok("displayWidth ignores tags", displayWidth('<span class="nf-cell-red">中文</span>') === 4);
  const formatted = formatTable(tb);
  ok("format keeps table marker", formatted.includes("nf-tbl-green"), JSON.stringify(formatted));
  ok("format ignores marker width", formatted.split("\n")[1] === "| --- | --- |", JSON.stringify(formatted.split("\n")[1]));
}

/* ---------- column alignment ---------- */
{
  const src = "| a | b |\n| --- | --- |\n| 1 | 2 |";
  ok("align center sets colons", tableSetAlignment(src, 0, "center").split("\n")[1] === "| :-: | --- |", JSON.stringify(tableSetAlignment(src, 0, "center")));
  ok("alignment state reads center", tableColumnAlignment(tableSetAlignment(src, 0, "center"), 0) === "center");
  ok("align right", tableSetAlignment(src, 1, "right").split("\n")[1] === "| --- | --: |", JSON.stringify(tableSetAlignment(src, 1, "right")));
  ok("alignment state reads default", tableColumnAlignment(src, 1) === "none");
  ok("align left", tableSetAlignment(src, 0, "left").split("\n")[1] === "| :-- | --- |", JSON.stringify(tableSetAlignment(src, 0, "left")));
  ok("align none clears", tableSetAlignment(tableSetAlignment(src, 0, "center"), 0, "none").split("\n")[1] === "| --- | --- |", JSON.stringify(tableSetAlignment(tableSetAlignment(src, 0, "center"), 0, "none")));
  // header-only fragment gains a delimiter row
  const frag = tableSetAlignment("| a | b", 0, "center");
  ok("align synthesizes delim for header-only", frag.split("\n").length === 2 && isDelimRow(frag.split("\n")[1]), JSON.stringify(frag));

  const all = tableSetAllAlignment(src, "center");
  ok("align all columns", all.split("\n")[1] === "| :-: | :-: |", JSON.stringify(all));
  const tinted = tableSetAllAlignment(tableWithBg(src, "blue"), "right");
  ok("align all preserves table tint", tableBgColor(tinted) === "blue" && tinted.split("\n")[1] === "| --: | --: |", JSON.stringify(tinted));
}

/* ---------- Tab navigation ---------- */
{
  const lines = ["| a | b |", "| --- | --- |", "| c | d |"];
  ok("tab to next cell", JSON.stringify(tableNavigate(lines, 0, 2, 1)) === '{"row":0,"ch":6}', JSON.stringify(tableNavigate(lines, 0, 2, 1)));
  ok("tab skips delimiter row", JSON.stringify(tableNavigate(lines, 0, 6, 1)) === '{"row":2,"ch":2}', JSON.stringify(tableNavigate(lines, 0, 6, 1)));
  ok("tab at last cell appends", tableNavigate(lines, 2, 6, 1) === "append", JSON.stringify(tableNavigate(lines, 2, 6, 1)));
  ok("shift-tab back across delim", JSON.stringify(tableNavigate(lines, 2, 2, -1)) === '{"row":0,"ch":6}', JSON.stringify(tableNavigate(lines, 2, 2, -1)));
  ok("shift-tab at first cell stops", tableNavigate(lines, 0, 2, -1) === null);
  ok("tab from delimiter row lands below", JSON.stringify(tableNavigate(lines, 1, 3, 1)) === '{"row":2,"ch":2}', JSON.stringify(tableNavigate(lines, 1, 3, 1)));
  // cursor in indent (ch 0) counts as first cell
  ok("tab from line start", JSON.stringify(tableNavigate(lines, 0, 0, 1)) === '{"row":0,"ch":6}', JSON.stringify(tableNavigate(lines, 0, 0, 1)));
  const padded = ["| a |     |"];
  ok("tab lands at the left edge of a padded empty cell", JSON.stringify(tableNavigate(padded, 0, 2, 1)) === '{"row":0,"ch":6}', JSON.stringify(tableNavigate(padded, 0, 2, 1)));
}

/* ---------- Enter: row below ---------- */
{
  const lines = ["| a | b |", "| --- | --- |", "| c | d |"];
  const src = "| a | b |\n| --- | --- |\n| 1 | 2 |";
  ok("enter goes to same column below", JSON.stringify(tableRowBelow(lines, 0, 6)) === '{"row":2,"ch":6}', JSON.stringify(tableRowBelow(lines, 0, 6)));
  ok("enter on last row appends", tableRowBelow(lines, 2, 2) === "append");

  const colored = setCellBgAt(src, 2, 1, "blue").split("\n");
  const coloredTarget = tableNavigate(colored, 2, 2, 1);
  ok("tab lands inside a colored cell wrapper", typeof coloredTarget === "object" && coloredTarget.ch === colored[2].indexOf(">2") + 1, JSON.stringify(coloredTarget));
  const coloredBelow = tableRowBelow(colored, 0, 6);
  ok("enter lands inside a colored cell wrapper", typeof coloredBelow === "object" && coloredBelow.ch === colored[2].indexOf(">2") + 1, JSON.stringify(coloredBelow));

  const markedFirst = setCellBgAt(tableWithBg(src, "green"), 0, 0, "yellow").split("\n");
  const backToMarkedFirst = tableNavigate(markedFirst, 0, markedFirst[0].lastIndexOf("b"), -1);
  ok("navigation skips table marker and enters first-cell wrapper", typeof backToMarkedFirst === "object" && backToMarkedFirst.ch === markedFirst[0].indexOf(">a") + 1, JSON.stringify(backToMarkedFirst));
}

/* ---------- block detection ---------- */
{
  const doc = EditorState.create({
    doc: "para\n| a | b |\n| --- | --- |\n| c | d |\ntext",
  }).doc;
  const fences = scanFences(doc);
  const tb = getBlockRange(doc, 3, fences);
  ok("table is one block", tb.startLine === 2 && tb.endLine === 4, JSON.stringify(tb));
  const para = getBlockRange(doc, 1, fences);
  ok("paragraph above stays out of table", para.startLine === 1 && para.endLine === 1, JSON.stringify(para));
  const tail = getBlockRange(doc, 5, fences);
  ok("text below stays out of table", tail.startLine === 5 && tail.endLine === 5, JSON.stringify(tail));
  const tr = getTableRange(doc, 2, fences);
  ok("getTableRange from header", tr.startLine === 2 && tr.endLine === 4, JSON.stringify(tr));
  ok("getTableRange off-table is null", getTableRange(doc, 1, fences) === null);
}

/* ---------- dragging tables keeps them rendering ---------- */
{
  const mkView = (doc) => {
    let state = EditorState.create({ doc });
    return {
      get state() { return state; },
      dispatch(tr) { state = state.update(tr).state; },
    };
  };
  // Move the table (lines 3-5) to the end, under a text line: a blank
  // line is inserted above it, and the double blank left behind at the
  // source collapses to one.
  const v = mkView("para\n\n| a |\n| --- |\n| 1 |\n\ntail here");
  moveBlock(v, { startLine: 3, endLine: 5 }, 8);
  ok(
    "moved table keeps blank above, source blanks collapse",
    v.state.doc.toString() === "para\n\ntail here\n\n| a |\n| --- |\n| 1 |",
    JSON.stringify(v.state.doc.toString())
  );
  // A paragraph dropped under another paragraph stays its own block —
  // without the sealed blank they would merge into one paragraph.
  const v2 = mkView("zero\n\none\n\ntwo");
  moveBlock(v2, { startLine: 3, endLine: 3 }, 6);
  ok(
    "paragraph below paragraph gets sealed",
    v2.state.doc.toString() === "zero\n\ntwo\n\none",
    JSON.stringify(v2.state.doc.toString())
  );
}

/* ---------- slash insert placement ---------- */
class MockEditor {
  constructor(lines) { this.lines = lines; this.cursor = { line: 0, ch: 0 }; }
  getLine(n) { return this.lines[n]; }
  setLine(n, t) { this.lines[n] = t; }
  setCursor(p) { this.cursor = p; }
  replaceRange(text, from, to) {
    const line = this.lines[from.line];
    const head = line.slice(0, from.ch);
    const tail = this.lines[to.line].slice(to.ch);
    const inserted = (head + text + tail).split("\n");
    this.lines.splice(from.line, to.line - from.line + 1, ...inserted);
  }
  text() { return this.lines.join("\n"); }
}
function makeSuggest() {
  const s = new SlashSuggest({ app: {}, settings: { slashCommands: true } });
  s.plugin = { settings: { slashCommands: true } };
  return s;
}
const cmd = (id) => SLASH_COMMANDS.find((c) => c.id === id);

// mid-line trigger after CJK text: table moves to its own line + blank line
{
  const s = makeSuggest();
  const ed = new MockEditor(["前文/表格"]);
  s.context = { editor: ed, start: { line: 0, ch: 2 }, end: { line: 0, ch: 5 } };
  s.selectSuggestion(cmd("table"), {});
  ok("mid-line table gets own line + blank", ed.text().startsWith("前文\n\n|     |"), JSON.stringify(ed.text()));
  ok("mid-line table cursor in first cell", ed.cursor.line === 2 && ed.cursor.ch === 2, JSON.stringify(ed.cursor));
}
// table at line start directly under text: blank line inserted above
{
  const s = makeSuggest();
  const ed = new MockEditor(["text", "/table"]);
  s.context = { editor: ed, start: { line: 1, ch: 0 }, end: { line: 1, ch: 6 } };
  s.selectSuggestion(cmd("table"), {});
  ok("table under text keeps blank line", ed.text().startsWith("text\n\n|     |"), JSON.stringify(ed.text()));
}
// code block mid-line moves to its own line (no blank needed)
{
  const s = makeSuggest();
  const ed = new MockEditor(["中文/code"]);
  s.context = { editor: ed, start: { line: 0, ch: 2 }, end: { line: 0, ch: 7 } };
  s.selectSuggestion(cmd("code"), {});
  ok("mid-line code gets own line", ed.text() === "中文\n```\n\n```", JSON.stringify(ed.text()));
}
// callout keeps a blank line before following text (no lazy continuation)
{
  const s = makeSuggest();
  const ed = new MockEditor(["/callout", "below text"]);
  s.context = { editor: ed, start: { line: 0, ch: 0 }, end: { line: 0, ch: 8 } };
  s.selectSuggestion(cmd("callout"), {});
  ok("callout sealed below", ed.text() === "> [!note] \n> \n\nbelow text", JSON.stringify(ed.text()));
}
// callout at end of doc: no trailing blank added
{
  const s = makeSuggest();
  const ed = new MockEditor(["/callout"]);
  s.context = { editor: ed, start: { line: 0, ch: 0 }, end: { line: 0, ch: 8 } };
  s.selectSuggestion(cmd("callout"), {});
  ok("callout at EOF unchanged", ed.text() === "> [!note] \n> ", JSON.stringify(ed.text()));
}
// prefix matches rank first
{
  const s = makeSuggest();
  const got = s.getSuggestions({ query: "h1" }).map((c) => c.id);
  ok("prefix match ranks first", got[0] === "h1", JSON.stringify(got));
}

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILURES`);
process.exit(fail);
