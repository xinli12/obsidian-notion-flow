import assert from "node:assert/strict";
import { EditorState, Text } from "@codemirror/state";
import { BlockClipboard, EditorOperationScope, operationLifecycle } from "./features.mjs";
import { blockIdPlacement, buildBlockCaption, getBlockRange, newBlockId, scanFences } from "./bundle.mjs";

function fixture() {
  let state = EditorState.create({ doc: "BLOCK A\n\nBLOCK B" });
  const pending = [];
  const f = { file: "A.md", selected: [1], available: true, commits: [], failed: 0 };
  f.view = { get state() { return state; }, dom: { isConnected: true } };
  f.edit = () => { state = state.update({ changes: { from: 0, insert: "X" } }).state; };
  f.operations = new EditorOperationScope();
  f.lifecycle = new (operationLifecycle(f.operations))(f.view);
  f.clipboard = new BlockClipboard({
    ...f, identity: () => f.file, selection: () => f.selected, available: () => f.available,
    clipboard: {
      writeText: (text) => new Promise((resolve, reject) => pending.push({ text, resolve, reject })),
      readText: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    }, failed: () => f.failed++,
  });
  f.pending = pending;
  return f;
}
for (const mode of ["cut", "paste"]) {
  const start = (f) => mode === "cut"
    ? f.clipboard.copy("BLOCK A", () => f.commits.push("delete A"))
    : f.clipboard.paste((text) => f.commits.push(text));
  for (const [name, change] of [
    ["normal", () => {}],
    ["select B", (f) => { f.selected = [3]; }],
    ["clear and reselect A", (f) => { f.selected = [1]; }],
    ["document edit", (f) => f.edit()],
    ["file switch with identical text", (f) => { f.file = "B.md"; }],
    ["disconnection", (f) => { f.view.dom.isConnected = false; }],
    ["lost focus", (f) => { f.available = false; }],
    ["editor destruction", (f) => f.lifecycle.destroy()],
    ["controller destruction", (f) => f.clipboard.destroy()],
    ["plugin unload", (f) => f.operations.dispose()],
  ]) {
    const f = fixture(), job = start(f);
    change(f);
    f.pending[0].resolve("PASTED");
    await job;
    assert.equal(f.commits.length, name === "normal" ? 1 : 0, `${mode}: ${name}`);
    if (mode === "cut") assert.equal(f.pending[0].text, "BLOCK A");
  }
  const f = fixture(), first = start(f), second = start(f);
  f.pending[1].resolve("new"); await second;
  f.pending[0].resolve("old"); await first;
  assert.equal(f.commits.length, 1, "only the latest operation commits");
  const denied = fixture(), job = start(denied);
  denied.pending[0].reject(new Error("Permission denied")); await job;
  assert.equal(denied.failed, 1);
  assert.deepEqual(denied.commits, []);
}
console.log("PASS clipboard operations: delayed I/O, selection/file changes, disposal, ordering and failures");

/* ---------- block ids for "Copy link to block" ---------- */
{
  const place = (lines, lineNo, id = "abc123") => {
    const doc = Text.of(lines);
    const fences = scanFences(doc);
    return blockIdPlacement(doc, getBlockRange(doc, lineNo, fences), fences, id);
  };
  // Paragraph: the id trails the last row.
  let p = place(["first row", "second row", "", "other"], 1);
  assert.deepEqual(p, { line: 2, existing: null, insertAt: "first row\nsecond row".length, insertText: " ^abc123", id: "abc123" });
  // An id already there is reused, nothing inserted.
  p = place(["a paragraph ^keep01", "", "other"], 1);
  assert.equal(p.existing, "keep01");
  assert.equal(p.id, "keep01");
  assert.equal(p.insertText, "");
  // A list item carries the id on its own first row, so the link addresses
  // the item with its children rather than the last child.
  p = place(["- item", "  - child"], 1);
  assert.deepEqual([p.line, p.insertAt, p.insertText], [1, "- item".length, " ^abc123"]);
  p = place(["- item", "  - child"], 2);
  assert.deepEqual([p.line, p.insertText], [2, " ^abc123"], "the child itself is still addressable");
  // A parent already carrying an id is recognised as such: no second id.
  p = place(["- parent ^keep01", "  - child"], 1);
  assert.deepEqual([p.existing, p.id, p.insertText, p.line], ["keep01", "keep01", "", 1]);
  // A nested fence never gets text after its closer (that would unclose it);
  // the id sits on the item row.
  p = place(["- item", "  ```", "  code", "  ```", "", "after"], 1);
  assert.deepEqual([p.line, p.insertAt, p.insertText], [1, "- item".length, " ^abc123"]);
  // Likewise a quote child: an id inside a quote row would never resolve.
  p = place(["- item", "  > quote"], 1);
  assert.deepEqual([p.line, p.insertAt, p.insertText], [1, "- item".length, " ^abc123"]);
  // A divider stops being one with anything after it: no id.
  assert.equal(place(["---"], 1), null);
  assert.equal(place(["text", "", "***", "", "more"], 3), null);
  // A display equation closes with a bare `$$`, so the id takes the seam form.
  p = place(["$$", "x", "$$", "", "after"], 2);
  assert.deepEqual([p.insertAt, p.insertText], ["$$\nx\n$$".length, "\n\n^abc123"]);
  // Table: a `^id` row after a blank seam, after the caption row when there is one.
  const table = ["| a | b |", "| - | - |", "| 1 | 2 |"];
  p = place([...table, "", "after"], 2);
  assert.deepEqual([p.line, p.insertAt, p.insertText], [5, table.join("\n").length, "\n\n^abc123"]);
  const captioned = [...table, buildBlockCaption("table", "Sales")];
  p = place([...captioned, "", "after"], 1);
  assert.equal(p.insertAt, captioned.join("\n").length, "placed after the caption row");
  assert.equal(p.insertText, "\n\n^abc123");
  // An existing id row below the table is found from any row of the table.
  const withId = [...table, "", "^tbl001", "", "after"];
  p = place(withId, 3);
  assert.equal(p.existing, "tbl001");
  assert.equal(p.line, 5);
  // The id row and its seam travel with the table.
  const doc = Text.of(withId);
  assert.deepEqual(getBlockRange(doc, 1, []), { startLine: 1, endLine: 5 });
  assert.deepEqual(getBlockRange(doc, 4, []), { startLine: 1, endLine: 5 }, "the seam belongs to the table");
  assert.deepEqual(getBlockRange(doc, 5, []), { startLine: 1, endLine: 5 }, "the id row belongs to the table");
  assert.deepEqual(getBlockRange(doc, 7, []), { startLine: 7, endLine: 7 });
  // An orphan id row is its own block.
  const orphan = Text.of(["# Title", "", "^lost", "text"]);
  assert.deepEqual(getBlockRange(orphan, 3, []), { startLine: 3, endLine: 3 });
  assert.deepEqual(getBlockRange(orphan, 4, []), { startLine: 4, endLine: 4 }, "prose never absorbs an id row");
  // Fence and quote: seam + id row, like the table.
  p = place(["```js", "x", "```", "", "after"], 2);
  assert.deepEqual([p.insertAt, p.insertText], ["```js\nx\n```".length, "\n\n^abc123"]);
  const fenced = Text.of(["```js", "x", "```", "", "^code01", "after"]);
  assert.deepEqual(getBlockRange(fenced, 2, scanFences(fenced)), { startLine: 1, endLine: 5 }, "the fence carries its id row");
  assert.equal(place(["```js", "x", "```", "", "^code01", "after"], 1, "zzz").existing, "code01");
  p = place(["> quoted", "> more"], 1);
  assert.deepEqual([p.insertAt, p.insertText], ["> quoted\n> more".length, "\n\n^abc123"]);
  // Headings link by text; blank rows and Callout rows have no id.
  assert.equal(place(["# Heading"], 1), null);
  assert.equal(place([""], 1), null);
  assert.equal(blockIdPlacement(Text.of(["> [!note]", "> row"]), { startLine: 2, endLine: 2, quotePrefix: "> " }, [], "x"), null);
  // Generated ids are six base-36 characters.
  assert.match(newBlockId(), /^[0-9a-z]{6}$/);
  assert.match(place(["p"], 1, undefined).id, /^[0-9a-z]{6}$/);
  console.log("PASS block id placement: paragraph, list, existing id, table after caption, seam ownership, heading");
}

// ---- Paste as table: TSV/CSV parsing, blank-line gate, quote wrapping ----
{
  const { blankPasteLine, delimitedTextToTable, htmlHasTable, splitDelimitedRow, tablePasteReplacement, formatTable } =
    await import("./bundle.mjs");
  const raw = (md) => md;
  assert.deepEqual(splitDelimitedRow('a,"b, c",d', ","), ["a", "b, c", "d"]);
  assert.deepEqual(splitDelimitedRow('"x ""y"" z",1', ","), ['x "y" z', "1"]);
  assert.deepEqual(splitDelimitedRow("a\tb,c", "\t"), ["a", "b,c"], "tab rows never split on commas");
  assert.deepEqual(splitDelimitedRow("a,,b", ","), ["a", "", "b"]);
  assert.equal(
    delimitedTextToTable("a,b\n1,2", raw),
    "| a | b |\n| --- | --- |\n| 1 | 2 |",
    "comma-separated text is forced into a table"
  );
  assert.equal(
    delimitedTextToTable("a\tb,c\n1\t2", raw),
    "| a | b,c |\n| --- | --- |\n| 1 | 2 |",
    "a tab anywhere makes the paste tab-separated"
  );
  assert.equal(
    delimitedTextToTable("a,b,c\n1\n\n2,3", raw),
    "| a | b | c |\n| --- | --- | --- |\n| 1 |  |  |\n| 2 | 3 |  |",
    "ragged rows are padded, blank rows dropped"
  );
  assert.equal(delimitedTextToTable("only", raw), "| only |\n| --- |", "a single cell is a header-only table");
  assert.equal(delimitedTextToTable('k,v\n"a|b",c', raw), "| k | v |\n| --- | --- |\n| a\\|b | c |", "pipes are escaped");
  assert.equal(delimitedTextToTable("\n  \n"), null, "an empty clipboard is nothing to paste");
  assert.equal(delimitedTextToTable("a,b\n1,2"), formatTable("| a | b |\n| --- | --- |\n| 1 | 2 |"), "the default formatter pads columns");
  for (const line of ["", "   ", "> ", ">  \t", "> > "]) assert.ok(blankPasteLine(line), JSON.stringify(line));
  for (const line of ["x", "> x", "| a |", "- "]) assert.ok(!blankPasteLine(line), JSON.stringify(line));
  assert.ok(htmlHasTable("<html><body><table><tr><td>1</td></tr></table></body></html>"));
  assert.ok(htmlHasTable('<TABLE class="x">'));
  assert.ok(!htmlHasTable("<p>tablet</p>"));
  assert.ok(!htmlHasTable(null) && !htmlHasTable(""));
  const md = "| a | b |\n| --- | --- |\n| 1 | 2 |";
  assert.equal(tablePasteReplacement("", md), md);
  assert.equal(tablePasteReplacement("> ", md), "| a | b |\n> | --- | --- |\n> | 1 | 2 |", "quoted rows keep the marker");
  assert.equal(tablePasteReplacement("> > ", md), "| a | b |\n> > | --- | --- |\n> > | 1 | 2 |");
  console.log("PASS paste as table: CSV/TSV parsing, quoted cells, padding, blank-line gate, quote wrapping");
}

// ---- Image size: native |N suffix on wiki embeds and Markdown images ----
{
  const { hasImageEmbed, imageWidthOf, setImageWidth } = await import("./bundle.mjs");
  assert.equal(setImageWidth("![[a.png]]", 480), "![[a.png|480]]");
  assert.equal(setImageWidth("![[a.png|480]]", 720), "![[a.png|720]]", "an existing size is replaced");
  assert.equal(setImageWidth("![[a.png|alt|480]]", 240), "![[a.png|alt|240]]", "alt text survives");
  assert.equal(setImageWidth("![[a.png|alt]]", 240), "![[a.png|alt|240]]", "alt without a size gains one");
  assert.equal(setImageWidth("![[a.png|alt|480]]", null), "![[a.png|alt]]", "Original removes the size, keeps alt");
  assert.equal(setImageWidth("![[a.png|480]]", null), "![[a.png]]");
  assert.equal(setImageWidth("![[a.png|640x360]]", 300), "![[a.png|300]]", "width x height collapses to a width");
  assert.equal(setImageWidth("![alt|480](https://x/y.png)", 300), "![alt|300](https://x/y.png)");
  assert.equal(setImageWidth("![alt](https://x/y.png)", 300), "![alt|300](https://x/y.png)");
  assert.equal(setImageWidth("![](https://x/y.png)", 300), "![|300](https://x/y.png)");
  assert.equal(setImageWidth("![|300](https://x/y.png)", null), "![](https://x/y.png)");
  assert.equal(setImageWidth("![alt|300](https://x/y.png)", null), "![alt](https://x/y.png)");
  assert.equal(setImageWidth("  > ![[a.png]]  ", 100), "  > ![[a.png|100]]  ", "indent and quote markers are kept");
  assert.equal(setImageWidth("![[480.png]]", 200), "![[480.png|200]]", "a numeric file name is not a size");
  assert.equal(setImageWidth("![480](u)", 200), "![480|200](u)", "numeric alt text is not a size");
  assert.equal(setImageWidth("plain text", 200), "plain text", "no image: unchanged");
  assert.equal(setImageWidth("![[a.png]]", 99.6), "![[a.png|100]]", "widths are rounded");
  // Several images on one row: the offset picks the one under the pointer.
  const two = "![[a.png]] and ![[b.png|alt]]";
  assert.equal(setImageWidth(two, 100, 15), "![[a.png]] and ![[b.png|alt|100]]");
  assert.equal(setImageWidth(two, 100, 0), "![[a.png|100]] and ![[b.png|alt]]");
  assert.equal(setImageWidth(two, 100), "![[a.png|100]] and ![[b.png|alt]]", "no offset: the first image");
  assert.equal(imageWidthOf("![[a.png|alt|480]]"), 480);
  assert.equal(imageWidthOf("![alt|300](u)"), 300);
  assert.equal(imageWidthOf("![[a.png|640x360]]"), 640);
  assert.equal(imageWidthOf("![[a.png|alt]]"), null);
  assert.equal(imageWidthOf("text"), null);
  assert.equal(imageWidthOf(two, 15), null);
  assert.ok(hasImageEmbed("![[a.png]]") && hasImageEmbed(two, 20) && !hasImageEmbed("[[a.png]]"));
  console.log("PASS image size: set/replace/remove |N on wiki and Markdown images, alt preserved, offset targeting");
}
