/**
 * The two affordances that make a block say what it is: the code chip's
 * language control, and the empty-line hint.
 *
 * The language edit is the risky half — it rewrites part of a fence's
 * opening line, and getting the range wrong there either eats the fence
 * marker or leaves a second language behind. The hint is display-only, so
 * what it has to prove is the opposite: that it appears on exactly one
 * line and never inside code.
 */
import { EditorState } from "@codemirror/state";
import {
  fenceLanguageSpan,
  fenceLanguagePlan,
  emptyHintLine,
  scanFences,
} from "./bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));

const docOf = (lines) => EditorState.create({ doc: lines.join("\n") }).doc;

/** The opening line after retyping its language, or null for a no-op. */
const retype = (lines, language, startLine = 1) => {
  const doc = docOf(lines);
  const plan = fenceLanguagePlan(doc, startLine, language);
  if (!plan) return null;
  const text = doc.toString();
  return (text.slice(0, plan.from) + plan.insert + text.slice(plan.to)).split("\n")[
    startLine - 1
  ];
};

/* ------------------------------------------------------------------ */
/* Reading the language off a fence                                    */
/* ------------------------------------------------------------------ */

eq(
  "the language is the first word of the info string",
  fenceLanguageSpan(docOf(["```js title=x", "code", "```"]), 1)?.language,
  "js"
);
eq(
  "a fence with no info string has no language",
  fenceLanguageSpan(docOf(["```", "code", "```"]), 1)?.language,
  ""
);
eq(
  "a quoted fence reads the same",
  fenceLanguageSpan(docOf(["> ```python", "> code", "> ```"]), 1)?.language,
  "python"
);
ok(
  "an ordinary line is not a fence",
  fenceLanguageSpan(docOf(["plain text"]), 1) === null
);
ok(
  "a line number off the end is not a fence",
  fenceLanguageSpan(docOf(["```", "```"]), 9) === null
);

/* ------------------------------------------------------------------ */
/* Retyping it                                                         */
/* ------------------------------------------------------------------ */

eq("a language is replaced", retype(["```js", "x", "```"], "python"), "```python");
eq("a language is added", retype(["```", "x", "```"], "python"), "```python");
eq("a language is cleared", retype(["```js", "x", "```"], ""), "```");
ok(
  "retyping the language it already has changes nothing",
  retype(["```js", "x", "```"], "js") === null
);
ok(
  "clearing a fence that has no language changes nothing",
  retype(["```", "x", "```"], "") === null
);

eq(
  "the rest of the info string survives a replacement",
  retype(["```js title=x", "y", "```"], "python"),
  "```python title=x"
);
eq(
  "…and survives the language being cleared",
  retype(["```js title=x", "y", "```"], ""),
  "``` title=x"
);
eq(
  "stray padding is absorbed rather than pushed along",
  retype(["```   ", "x", "```"], "js"),
  "```js"
);
eq(
  "clearing takes the padding with it",
  retype(["``` js", "x", "```"], ""),
  "```"
);

eq(
  "a quoted fence keeps its markers",
  retype(["> ```js", "> x", "> ```"], "python"),
  "> ```python"
);
eq(
  "a fence opening on a list marker keeps the bullet",
  retype(["- ```js", "  x", "  ```"], "python"),
  "- ```python"
);
eq(
  "an indented fence keeps its column",
  retype(["  ```js", "  x", "  ```"], "python"),
  "  ```python"
);
eq(
  "a tilde fence is a fence too",
  retype(["~~~js", "x", "~~~"], "python"),
  "~~~python"
);
eq(
  "a longer marker run is preserved",
  retype(["````js", "```", "````"], "python"),
  "````python"
);

{
  // The fence being retyped is the one addressed, not the first in the note.
  const lines = ["```js", "a", "```", "", "```py", "b", "```"];
  eq("a later fence is addressed by its own line", retype(lines, "rust", 5), "```rust");
}

/* ------------------------------------------------------------------ */
/* Where the empty-line hint may appear                                */
/* ------------------------------------------------------------------ */

const carets = (...heads) => ({
  ranges: heads.map((head) => ({ head, empty: true })),
});
const hint = (lines, lineNo, ch = 0) => {
  const doc = docOf(lines);
  const pos = doc.line(lineNo).from + ch;
  return emptyHintLine(doc, carets(pos), scanFences(doc));
};

eq("an empty line holding the caret is hinted", hint(["text", ""], 2), 2);
ok("a line with text is not", hint(["text", ""], 1) === null);
eq(
  "a whitespace-only line still counts as empty",
  hint(["text", "   "], 2, 3),
  2
);
eq(
  "an empty row inside a Callout is an empty block too",
  hint(["> [!note] Title", "> "], 2, 2),
  2
);
ok(
  "a blank row inside a fence is code, not an empty block",
  hint(["```js", "", "```"], 2) === null
);
ok(
  "two carets are not one empty block",
  (() => {
    const doc = docOf(["", ""]);
    return emptyHintLine(doc, carets(doc.line(1).from, doc.line(2).from)) === null;
  })()
);
ok(
  "a selection is not a caret waiting for content",
  (() => {
    const doc = docOf(["", "text"]);
    return (
      emptyHintLine(doc, { ranges: [{ head: doc.line(2).to, empty: false }] }) === null
    );
  })()
);

if (fail) process.exit(1);
console.log("ALL PASS");
