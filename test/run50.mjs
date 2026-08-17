/*
 * Folding a code block must never leave the caret inside it.
 *
 * A folded block hides every one of its rows — the opening fence included —
 * so a caret parked on any of them is invisible while still collecting
 * keystrokes: what the writer types disappears into the fence, or lands in
 * front of the caption HTML and breaks the fold chip outright. The caret
 * has to come out to the row after the chip, and where the block ends the
 * note that row has to be written, since there is nowhere else for it to go.
 */
import { EditorState } from "@codemirror/state";
import { codeFoldExitPlan, scanFences } from "./bundle.mjs";

let fail = 0;
const equal = (name, got, expected) => {
  const pass = JSON.stringify(got) === JSON.stringify(expected);
  if (!pass) fail++;
  console.log(
    `${pass ? "PASS" : "FAIL"} ${name}` +
      (pass
        ? ""
        : ` :: got ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`)
  );
};

const docOf = (lines) => EditorState.create({ doc: lines.join("\n") }).doc;
/** The plan resolved against the doc it was computed from: the line the
 * caret lands on, or the text appended when there is no such line. */
const landing = (doc, plan) =>
  plan.pos == null ? { append: plan.append } : doc.lineAt(plan.pos).text;

// A paragraph already follows the block: the caret takes its first column
// and the note is left exactly as it was.
{
  const doc = docOf(["```js", "const a = 1;", "```", "段落 B。"]);
  const fence = scanFences(doc)[0];
  const plan = codeFoldExitPlan(doc, fence, fence.endLine);
  equal("paragraph after: nothing written", plan.append, null);
  equal("paragraph after: caret on it", landing(doc, plan), "段落 B。");
  equal(
    "paragraph after: caret at its start",
    plan.pos,
    doc.line(4).from
  );
}

// The block already carries a caption row, so the block ends one line lower
// than the fence does and the row after it is the one to aim for.
{
  const doc = docOf([
    "```js",
    "const a = 1;",
    "```",
    '<small class="nf-caption" data-nf-kind="code">标题</small>',
    "",
    "段落 B。",
  ]);
  const fence = scanFences(doc)[0];
  const plan = codeFoldExitPlan(doc, fence, 4);
  equal("caption row: nothing written", plan.append, null);
  equal("caption row: caret clears it", landing(doc, plan), "");
}

// Nothing follows the block at all. A row is written rather than leaving
// the caret on the fence, which is about to go dark.
{
  const doc = docOf(["段落 A。", "", "```js", "const a = 1;", "```"]);
  const fence = scanFences(doc)[0];
  const plan = codeFoldExitPlan(doc, fence, fence.endLine);
  equal("end of note: row written", landing(doc, plan), { append: "\n" });
  equal("end of note: caret follows the write", plan.pos, null);
}

// Inside a list the written row keeps the item's content column, so the
// paragraph stays in the item the block sits in.
{
  const doc = docOf(["- 说明", "  ```js", "  const a = 1;", "  ```"]);
  const fence = scanFences(doc)[0];
  const plan = codeFoldExitPlan(doc, fence, fence.endLine);
  equal("nested in a list: indented row", plan.append, "\n  ");
}

// In a quote the markers are dropped: a row after the block means "after
// the Callout", the same call trailingParagraphPlan makes.
{
  const doc = docOf(["> ```js", "> const a = 1;", "> ```"]);
  const fence = scanFences(doc)[0];
  const plan = codeFoldExitPlan(doc, fence, fence.endLine);
  equal("quoted block: bare row", plan.append, "\n");
}

console.log(fail === 0 ? "run50 OK" : `run50 FAILED (${fail})`);
process.exit(fail === 0 ? 0 : 1);
