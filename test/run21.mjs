import { EditorState } from "@codemirror/state";
import { blocksInLineSpan, batchTurnIntoChanges } from "./bundle.mjs";

let fail = 0;
const check = (name, got, expected) => {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: got ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`
  );
};

const doc = EditorState.create({
  doc: [
    "alpha",
    "",
    "## beta",
    "",
    "- parent",
    "  - child",
    "",
    "```js",
    "const x = 1;",
    "```",
    "",
    "> quote",
    "> continued",
    "",
    "| a |",
    "| - |",
  ].join("\n"),
}).doc;

// Blank separator rows are not blocks: the span skips them.
check(
  "line span returns logical blocks once",
  blocksInLineSpan(doc, 1, 6),
  [
    { startLine: 1, endLine: 1 },
    { startLine: 3, endLine: 3 },
    { startLine: 5, endLine: 6 },
  ]
);

const blocks = blocksInLineSpan(doc, 1, doc.lines);
const result = batchTurnIntoChanges(doc, blocks, "# ");
// A fence and a table still have no line prefix that could describe them.
// A multi-line quote no longer counts: it is retyped as a whole block in
// one change — by its first row, the way a Callout goes by its title; the
// rows below shed the quote level and follow the heading as its body.
check("batch conversion skips structural blocks", result.skipped, 2);
check(
  "batch conversion changes ordinary block first lines",
  result.changes.map((change) => change.insert),
  ["# alpha", "# beta", "# parent", "# quote\n\ncontinued"]
);

if (fail) process.exit(1);
