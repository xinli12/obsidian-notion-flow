import { Text } from "@codemirror/state";
import { getBlockRange } from "./bundle.mjs";

const doc = Text.of([
  "# Title",            // 1 heading
  "",                   // 2
  "Para line one",      // 3 paragraph (3-4)
  "para line two",      // 4
  "",                   // 5
  "- item A",           // 6 list (6-8: children)
  "  - child A1",       // 7
  "    deep note",      // 8
  "- item B",           // 9 list (9)
  "",                   // 10
  "> [!note] Callout",  // 11 quote (11-12)
  "> body",             // 12
  "",                   // 13
  "```js",              // 14 fence (14-16)
  "code();",            // 15
  "```",                // 16
  "last para",          // 17
]);

const cases = [
  [1, [1,1], "heading"],
  [3, [3,4], "paragraph down"],
  [4, [3,4], "paragraph up"],
  [6, [6,8], "list with children"],
  [7, [7,8], "child item"],
  [9, [9,9], "single list item"],
  [11, [11,12], "callout"],
  [14, [14,16], "code fence"],
  [17, [17,17], "last line"],
  [2, [2, 2], "blank line is its own block"],
];

let fail = 0;
for (const [line, expected, name] of cases) {
  const r = getBlockRange(doc, line);
  const got = r ? [r.startLine, r.endLine] : null;
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: got ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`);
}
process.exit(fail);
