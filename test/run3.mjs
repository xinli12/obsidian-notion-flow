import { EditorState, Text } from "@codemirror/state";
import { getBlockRange, scanFences, moveBlock } from "./bundle.mjs";

const doc = Text.of([
  "- item with code",     // 1  list item, children 2-7
  "  ```js",              // 2  nested fence 2-6
  "",                     // 3  blank INSIDE fence
  "  - fake list",        // 4  looks like a list, inside fence
  "  code();",            // 5
  "  ```",                // 6  closing marker
  "  child para",         // 7  still child of item 1
  "- next item",          // 8
  "",                     // 9
  "- loose item",         // 10 loose list, children across blank
  "",                     // 11
  "  second para",        // 12
  "",                     // 13
  "not part",             // 14 plain paragraph
  "~~~",                  // 15 tilde fence 15-17
  "tilde body",           // 16
  "~~~",                  // 17
  "> quote",              // 18
  "```",                  // 19 unclosed fence 19-20
  "trailing code",        // 20
]);

const cases = [
  [1,  [1, 7],   "list item swallows nested fence + child para"],
  [2,  [2, 6],   "fence opening marker"],
  [3,  [2, 6],   "blank line inside fence"],
  [4,  [2, 6],   "fake list inside fence"],
  [5,  [2, 6],   "code line inside fence"],
  [6,  [2, 6],   "closing fence marker"],
  [7,  [7, 7],   "child para alone (no fence bleed)"],
  [8,  [8, 8],   "adjacent list item"],
  [10, [10, 12], "loose list crosses blank separator"],
  [14, [14, 14], "paragraph does not absorb fence below"],
  [15, [15, 17], "tilde fence open"],
  [16, [15, 17], "tilde fence body"],
  [18, [18, 18], "quote does not cross fences"],
  [19, [19, 20], "unclosed fence open"],
  [20, [19, 20], "unclosed fence body"],
];

let fail = 0;
const fences = scanFences(doc);
for (const [line, expected, name] of cases) {
  const r = getBlockRange(doc, line, fences);
  const got = r ? [r.startLine, r.endLine] : null;
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: got ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`);
}

// Fence marker length: ```` closes only with >= 4 backticks
const doc2 = Text.of(["````", "``` not a close", "````", "after"]);
const f2 = scanFences(doc2);
{
  const ok = f2.length === 1 && f2[0].startLine === 1 && f2[0].endLine === 3;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} marker-length matching: ${JSON.stringify(f2)}`);
}

// Move the whole list-item-with-code below "- next item"
{
  let state = EditorState.create({ doc });
  const view = { get state() { return state; }, dispatch(s) { state = state.update(s).state; } };
  const block = getBlockRange(state.doc, 1, scanFences(state.doc));
  moveBlock(view, block, 9); // insert before line 9 (blank after "- next item")
  const out = state.doc.toString();
  const expected = [
    "- next item",
    "- item with code",
    "  ```js",
    "",
    "  - fake list",
    "  code();",
    "  ```",
    "  child para",
    "",
    "- loose item",
    "",
    "  second para",
    "",
    "not part",
    "~~~",
    "tilde body",
    "~~~",
    "> quote",
    "```",
    "trailing code",
  ].join("\n");
  const ok = out === expected;
  if (!ok) { fail++; console.log(`FAIL move list+fence\n--- got ---\n${out}\n--- expected ---\n${expected}`); }
  else console.log("PASS move list+fence keeps code block intact");
}

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILURES`);
process.exit(fail);
