/* Selection-aware multi-line paste inside quotes and Callouts. */
import { Text } from "@codemirror/state";
import { buildQuotedPasteForSelection } from "./bundle.mjs";

let fail = 0;
const check = (name, got, expected) => {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: got ${JSON.stringify(got)}` +
      (ok ? "" : ` expected ${JSON.stringify(expected)}`)
  );
};
const at = (doc, line, ch) => doc.line(line).from + ch;

const callout = Text.of([
  "> [!note] Title",
  "> one",
  "> two",
  "> tail",
]);
check(
  "caret paste keeps every row in its Callout",
  buildQuotedPasteForSelection(callout, at(callout, 2, 2), at(callout, 2, 2), "a\nb"),
  "a\n> b"
);
check(
  "multi-row replacement stays in the same Callout",
  buildQuotedPasteForSelection(callout, at(callout, 2, 2), callout.line(3).to, "a\nb"),
  "a\n> b"
);
check(
  "selection ending before a quote marker falls back",
  buildQuotedPasteForSelection(callout, at(callout, 2, 2), callout.line(3).from, "a\nb"),
  null
);

const adjacent = Text.of([
  "> [!note] First",
  "> one",
  ">",
  "> [!warning] Second",
  "> two",
]);
check(
  "selection cannot cross adjacent Callout headers",
  buildQuotedPasteForSelection(adjacent, at(adjacent, 2, 2), adjacent.line(5).to, "a\nb"),
  null
);

const nested = Text.of(["> outer", "> > nested"]);
check(
  "selection cannot cross quote depth",
  buildQuotedPasteForSelection(nested, at(nested, 1, 2), nested.line(2).to, "a\nb"),
  null
);

const outside = Text.of(["> inside", "outside"]);
check(
  "selection cannot cross out of the quote",
  buildQuotedPasteForSelection(outside, at(outside, 1, 2), outside.line(2).to, "a\nb"),
  null
);

const fenced = Text.of(["> ```js", "> const value = 1;", "> ```"]);
check(
  "paste in quoted code keeps the code editor behavior",
  buildQuotedPasteForSelection(fenced, at(fenced, 2, 2), at(fenced, 2, 2), "a\nb"),
  null
);

if (fail) process.exit(1);
