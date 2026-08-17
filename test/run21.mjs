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

check(
  "line span returns logical blocks once",
  blocksInLineSpan(doc, 1, 6),
  [
    { startLine: 1, endLine: 1 },
    { startLine: 2, endLine: 2 },
    { startLine: 3, endLine: 3 },
    { startLine: 4, endLine: 4 },
    { startLine: 5, endLine: 6 },
  ]
);

const blocks = blocksInLineSpan(doc, 1, doc.lines);
const result = batchTurnIntoChanges(doc, blocks, "# ");
// A fence and a table still have no line prefix that could describe them.
// A multi-line quote no longer counts: it is retyped as a whole block, all
// of its rows shedding the quote level in one change.
check("batch conversion skips structural blocks", result.skipped, 2);
check(
  "batch conversion changes ordinary block first lines",
  result.changes.map((change) => change.insert),
  ["# alpha", "# ", "# beta", "# ", "# parent", "# ", "# ", "# quote\n# continued", "# "]
);

if (fail) process.exit(1);
