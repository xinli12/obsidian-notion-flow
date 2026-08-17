import { EditorState } from "@codemirror/state";
import {
  fenceVisualTokenRange,
  scanFences,
} from "./bundle.mjs";

let failures = 0;
const equal = (name, got, expected) => {
  const pass = JSON.stringify(got) === JSON.stringify(expected);
  if (!pass) failures++;
  console.log(
    `${pass ? "PASS" : "FAIL"} ${name}` +
      (pass ? "" : ` :: ${JSON.stringify(got)}`)
  );
};
const docOf = (source) => EditorState.create({ doc: source }).doc;
const token = (source, fenceIndex, closing) => {
  const doc = docOf(source);
  const fence = scanFences(doc)[fenceIndex];
  const range = fenceVisualTokenRange(doc, fence, closing);
  return range && {
    text: doc.sliceString(range.from, range.to),
    language: range.language,
  };
};

equal(
  "top-level opener becomes one visual language token",
  token("```ts\nconst x = 1;\n```", 0, false),
  { text: "```ts", language: "ts" }
);
equal(
  "top-level closer is fully concealed",
  token("```ts\nconst x = 1;\n```", 0, true),
  { text: "```", language: "" }
);
equal(
  "quoted fence includes its structural quote prefix",
  token("> ```js\n> alert(1)\n> ```", 0, false),
  { text: "> ```js", language: "js" }
);
equal(
  "quoted closer includes its structural quote prefix",
  token("> ```js\n> alert(1)\n> ```", 0, true),
  { text: "> ```", language: "" }
);
equal(
  "list marker stays visible when a fence opens on the item row",
  token("- ```python\n  pass\n  ```", 0, false),
  { text: "```python", language: "python" }
);
equal(
  "tilde fences use the same visual range",
  token("  ~~~~ rust\n  fn main() {}\n  ~~~~", 0, false),
  { text: "~~~~ rust", language: "rust" }
);

if (failures) process.exit(1);
