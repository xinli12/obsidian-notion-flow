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
check("batch conversion skips structural blocks", result.skipped, 3);
check(
  "batch conversion changes ordinary block first lines",
  result.changes.map((change) => change.insert),
  ["# alpha", "# ", "# beta", "# ", "# parent", "# ", "# ", "# "]
);

if (fail) process.exit(1);
