import assert from "node:assert/strict";
import { tsvToMarkdownTable } from "./features.mjs";
import { preferTsvOverHtml, tablePasteLanding } from "./bundle.mjs";

assert.equal(
  tsvToMarkdownTable("Name\tAge\tCity\nAda\t36\tLondon\nLin\t28\tShanghai"),
  "| Name | Age | City |\n| --- | --- | --- |\n| Ada | 36 | London |\n| Lin | 28 | Shanghai |",
  "3x3 TSV: header, delimiter row, body"
);
assert.equal(
  tsvToMarkdownTable("Name\tAge\r\nAda\t36\r\n"),
  "| Name | Age |\n| --- | --- |\n| Ada | 36 |",
  "CRLF and a trailing newline are tolerated"
);
assert.equal(
  tsvToMarkdownTable("k\tv\na|b\tc"),
  "| k | v |\n| --- | --- |\n| a\\|b | c |",
  "a pipe inside a cell is escaped"
);
assert.equal(
  tsvToMarkdownTable("k\tv\na\\|b\tc"),
  "| k | v |\n| --- | --- |\n| a\\|b | c |",
  "an already escaped pipe is not doubled"
);
assert.equal(
  tsvToMarkdownTable("姓名\t城市\n李雷\t上海"),
  "| 姓名 | 城市 |\n| --- | --- |\n| 李雷 | 上海 |",
  "CJK cells"
);
assert.equal(
  tsvToMarkdownTable('id\tnote\n1\t"quoted, text"'),
  '| id | note |\n| --- | --- |\n| 1 | "quoted, text" |',
  "quoted cell text is kept verbatim"
);
assert.equal(
  tsvToMarkdownTable("a\tb\n  padded \t\n"),
  "| a | b |\n| --- | --- |\n| padded |  |",
  "cells are trimmed and empty cells stay empty"
);
assert.equal(
  tsvToMarkdownTable("Name\tAge\n\t36\nBob\t40"),
  "| Name | Age |\n| --- | --- |\n|  | 36 |\n| Bob | 40 |",
  "a blank first cell in a two-column table"
);
assert.equal(
  tsvToMarkdownTable("\tAge\nBob\t40"),
  "|  | Age |\n| --- | --- |\n| Bob | 40 |",
  "a blank top-left header cell (row labels without a heading)"
);
assert.equal(
  tsvToMarkdownTable("\tfoo\nbar\tbaz"),
  "|  | foo |\n| --- | --- |\n| bar | baz |",
  "a tab-led line among filled rows is a blank cell, not indentation"
);

/* ---- the formatter hook ---- */
let seen = null;
const out = tsvToMarkdownTable("a\tb\nc\td", { format: (md) => { seen = md; return "FORMATTED"; } });
assert.equal(seen, "| a | b |\n| --- | --- |\n| c | d |", "the formatter receives the raw table");
assert.equal(out, "FORMATTED", "…and its result is returned");

/* ---- not tables ---- */
assert.equal(tsvToMarkdownTable("one\ntwo\nthree"), null, "single column: no tabs");
assert.equal(tsvToMarkdownTable("a\tb"), null, "a single line is not a table");
assert.equal(tsvToMarkdownTable("a\tb\n\n"), null, "…nor with blank lines after it");
assert.equal(tsvToMarkdownTable("a\tb\nc\td\te"), null, "uneven tab counts");
assert.equal(tsvToMarkdownTable("a\tb\ncd"), null, "a line without tabs");
assert.equal(tsvToMarkdownTable("\tconst x = 1;\n\treturn x;"), null, "tab-indented code");
assert.equal(tsvToMarkdownTable("\tfoo\n\tbar baz"), null, "every line tab-indented: prose");
assert.equal(tsvToMarkdownTable("\t\n\t"), null, "only empty cells");
assert.equal(tsvToMarkdownTable("a\t\nb\t"), null, "no row with two filled cells");
assert.equal(tsvToMarkdownTable(""), null);
console.log("PASS tsv table: spreadsheet pastes become tables, indented text and prose do not");

/* ---- spreadsheet HTML vs. the TSV path ---- */
{
  const plain = "Name\tQty\tPrice\nApple\t3\t1.2";
  const excel =
    '<meta name=ProgId content=Excel.Sheet><table><tr><td>Name</td><td>Qty</td><td>Price</td></tr>' +
    "<tr><td>Apple</td><td>3</td><td>1.2</td></tr></table>";
  const sheets =
    '<google-sheets-html-origin><table dir="ltr" border="1"><colgroup><col width="100"/></colgroup><tbody>' +
    "<tr><td>Name</td><td>Qty</td><td>Price</td></tr><tr><td>Apple</td><td>3</td><td>1.2</td></tr></tbody></table>";
  const libre = '<meta name="generator" content="LibreOffice"/><table><tr><td>Name</td><td>Qty</td></tr></table>';
  const headed = "<table><thead><tr><th>Name</th><th>Qty</th><th>Price</th></tr></thead><tbody><tr><td>Apple</td><td>3</td><td>1.2</td></tr></tbody></table>";
  const linked = '<table><tr><td><a href="https://x.test">Name</a></td><td>Qty</td><td>Price</td></tr><tr><td>Apple</td><td>3</td><td>1.2</td></tr></table>';
  const bare = "<table><tr><td>Name</td><td>Qty</td><td>Price</td></tr><tr><td>Apple</td><td>3</td><td>1.2</td></tr></table>";
  assert.equal(preferTsvOverHtml(excel, plain), true, "Excel HTML (ProgId, td only) takes the TSV path");
  assert.equal(preferTsvOverHtml(sheets, plain), true, "Google Sheets HTML takes the TSV path");
  assert.equal(preferTsvOverHtml(libre, "Name\tQty\nApple\t3"), true, "LibreOffice HTML takes the TSV path");
  assert.equal(preferTsvOverHtml(headed, plain), false, "a <thead>/<th> table keeps Obsidian's conversion");
  assert.equal(preferTsvOverHtml("<table><tr><th>A</th><th>B</th></tr></table>", "A\tB\n1\t2"), false, "a bare <th> too");
  assert.equal(preferTsvOverHtml(linked, plain), false, "a web table with links keeps Obsidian's conversion");
  assert.equal(preferTsvOverHtml(bare, plain), true, "a bare td-only web table with plain cells takes the TSV path");
  assert.equal(preferTsvOverHtml(bare.replace("Apple", "Ap<br>ple"), plain), false, "a <br> inside a cell keeps Obsidian's conversion");
  assert.equal(preferTsvOverHtml("<p>tablet <b>x</b></p>", plain), true, "no <table>: today's TSV path");
  assert.equal(preferTsvOverHtml("", plain), true, "no HTML at all");
  assert.equal(preferTsvOverHtml(null, plain), true, "…null HTML too");
  assert.equal(preferTsvOverHtml(excel, "just some prose"), false, "plain text that is not TSV leaves the HTML table to Obsidian");
  assert.equal(preferTsvOverHtml('<abbr title="x"><table><tr><td>a</td><td>b</td></tr></table></abbr>', "a\tb\nc\td"), true, "<abbr> is not a link");
  console.log("PASS tsv table: spreadsheet clipboards take the TSV path, headed and linked web tables do not");
}

/* ---- the caret lands below a pasted table ---- */
{
  const md = "| a | b |\n| --- | --- |\n| c | d |";
  const quoted = "| a | b |\n> | --- | --- |\n> | c | d |";
  assert.deepEqual(
    tablePasteLanding("", "", md),
    { insert: md, caretLineOffset: 3, caretCh: 0 },
    "a blank next row is reused, so no double blank line"
  );
  assert.deepEqual(
    tablePasteLanding("", "", md, { following: "" }),
    { insert: md, caretLineOffset: 3, caretCh: 0 },
    "…also when a blank row follows it"
  );
  assert.deepEqual(
    tablePasteLanding("", "", md, { following: "After." }),
    { insert: md + "\n", caretLineOffset: 3, caretCh: 0 },
    "a blank row right above content stays as the seam: typing never merges into that paragraph"
  );
  assert.deepEqual(
    tablePasteLanding("", "next para", md),
    { insert: md + "\n\n", caretLineOffset: 3, caretCh: 0 },
    "content below: a new empty row plus a blank seam"
  );
  assert.deepEqual(
    tablePasteLanding("", null, md),
    { insert: md + "\n", caretLineOffset: 3, caretCh: 0 },
    "end of the note: a new empty row is appended"
  );
  assert.deepEqual(
    tablePasteLanding("> ", "> body", md),
    { insert: quoted + "\n> \n>", caretLineOffset: 3, caretCh: 2 },
    "inside a quote the new row keeps the marker, and a '>' seam keeps typing out of 'body'"
  );
  assert.deepEqual(
    tablePasteLanding("> ", ">", md),
    { insert: quoted, caretLineOffset: 3, caretCh: 1 },
    "a bare '>' row of the same quote is reused"
  );
  assert.deepEqual(
    tablePasteLanding("> ", "> ", md, { following: "After." }),
    { insert: quoted + "\n> ", caretLineOffset: 3, caretCh: 2 },
    "a quoted blank row above a lazy-continuation risk is kept as the seam"
  );
  assert.deepEqual(
    tablePasteLanding("> ", "", md),
    { insert: quoted + "\n> ", caretLineOffset: 3, caretCh: 2 },
    "a blank row outside the quote is not reused: the caret stays in the quote"
  );
  assert.deepEqual(
    tablePasteLanding("", "> ", md).insert,
    md + "\n",
    "a quoted blank row below a top-level paste is not reused"
  );
  assert.deepEqual(
    tablePasteLanding("", "", md, { previous: "Before." }),
    { insert: "\n" + md, caretLineOffset: 4, caretCh: 0 },
    "a paragraph right above gets a blank seam first, or the table would render as text"
  );
  assert.deepEqual(
    tablePasteLanding("", "After.", md, { previous: "Before." }),
    { insert: "\n" + md + "\n\n", caretLineOffset: 4, caretCh: 0 },
    "glued between two paragraphs: seams above and below the caret row"
  );
  assert.deepEqual(
    tablePasteLanding("", null, md, { previous: "" }),
    { insert: md + "\n", caretLineOffset: 3, caretCh: 0 },
    "a blank row above needs no seam"
  );
  assert.deepEqual(
    tablePasteLanding("> ", "> body", md, { previous: "> [!note] Box" }),
    { insert: quoted + "\n> \n>", caretLineOffset: 3, caretCh: 2 },
    "right under a Callout title: no seam above"
  );
  assert.deepEqual(
    tablePasteLanding("> ", null, md, { previous: "> body" }),
    { insert: "\n> " + quoted + "\n> ", caretLineOffset: 4, caretCh: 2 },
    "under a quoted paragraph the seam keeps the marker"
  );
  assert.deepEqual(
    tablePasteLanding("", null, md, { previous: "| x | y |" }),
    { insert: "\n" + md + "\n", caretLineOffset: 4, caretCh: 0 },
    "under another table: a seam, so the two tables stay apart"
  );
  console.log("PASS tsv table: the caret lands on its own row after the pasted table");
}
