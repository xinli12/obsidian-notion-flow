/* Rendered-column click positions map back onto Markdown source rows. */
import { markdownCursorForRenderedOffset } from "./bundle.mjs";

let fail = 0;
const check = (name, got, expected) => {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: got ${JSON.stringify(got)}` +
      (ok ? "" : ` expected ${JSON.stringify(expected)}`)
  );
};

check(
  "bold markers are skipped at a rendered click",
  markdownCursorForRenderedOffset("left **bold**", "left bold", 6),
  8
);
check(
  "a click after rendered bold text lands before its closing markers",
  markdownCursorForRenderedOffset("left **bold**", "left bold", 9),
  11
);
check(
  "heading structure is not part of the rendered caret",
  markdownCursorForRenderedOffset("## Title", "Title", 2),
  5
);
check(
  "task markers are skipped",
  markdownCursorForRenderedOffset("- [ ] task", "task", 4),
  10
);
check(
  "link destination remains behind the rendered label",
  markdownCursorForRenderedOffset("[Open](https://example.com)", "Open", 4),
  5
);
check(
  "collapsed whitespace maps after the source whitespace run",
  markdownCursorForRenderedOffset("a   b", "a b", 2),
  4
);
check(
  "unrelated rendered text does not guess a source position",
  markdownCursorForRenderedOffset("alpha", "missing", 3),
  null
);

if (fail) process.exit(1);
