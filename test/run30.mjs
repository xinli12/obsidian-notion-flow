import { EditorState } from "@codemirror/state";
import {
  calloutEditBlocks,
  getBlockRange,
  scanFences,
  visualAnalysisWindow,
} from "./bundle.mjs";

let failures = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
};
const equal = (name, got, expected) =>
  ok(name, JSON.stringify(got) === JSON.stringify(expected), JSON.stringify(got));

const docOf = (source) => EditorState.create({ doc: source }).doc;
/** Viewport covering source lines [a, b] the way EditorView reports it. */
const viewport = (doc, a, b) => [
  { from: doc.line(a).from, to: doc.line(b).to },
];

/* The decoration pass only paints visible lines, so it analyses a window
   instead of the whole note. The window has to widen to structural edges,
   or a block scrolled half into view would resolve against a truncated
   document and lose its Callout/fence identity. */

{
  const doc = docOf(
    [
      "intro paragraph", // 1
      "", // 2
      "```js", // 3
      "const a = 1;", // 4
      "const b = 2;", // 5
      "const c = 3;", // 6
      "```", // 7
      "", // 8
      "tail paragraph", // 9
    ].join("\n")
  );
  const fences = scanFences(doc);
  const w = visualAnalysisWindow(doc, viewport(doc, 5, 5), fences);
  ok(
    "viewport inside a fence widens to the opening line",
    w.fromLine <= 3,
    JSON.stringify(w)
  );
  ok("…and to the closing line", w.toLine >= 7, JSON.stringify(w));
}

{
  const doc = docOf(
    [
      "before", // 1
      "", // 2
      "> [!note] Title", // 3
      "> body one", // 4
      "> body two", // 5
      "> body three", // 6
      "", // 7
      "after", // 8
    ].join("\n")
  );
  const fences = scanFences(doc);
  const w = visualAnalysisWindow(doc, viewport(doc, 5, 5), fences);
  ok(
    "viewport inside a Callout widens to its header",
    w.fromLine <= 3,
    JSON.stringify(w)
  );
  const blocks = calloutEditBlocks(doc, w.fromLine, w.toLine, fences);
  equal(
    "…so the Callout is still recognised from its middle",
    blocks.map((b) => [b.startLine, b.endLine]),
    [[3, 6]]
  );
}

{
  // A caption row trails its owner block, and the caption pass consults the
  // membership sets built from the window.
  const doc = docOf(
    ["```js", "code();", "```", "<small>nf-caption: Hi</small>", "after"].join(
      "\n"
    )
  );
  const fences = scanFences(doc);
  const w = visualAnalysisWindow(doc, viewport(doc, 1, 3), fences);
  ok(
    "window reaches the caption row after the last visible block",
    w.toLine >= 4,
    JSON.stringify(w)
  );
}

equal("no visible ranges yields no window", visualAnalysisWindow(docOf("a"), [], []), null);

{
  const doc = docOf(["a", "b", "c"].join("\n"));
  const w = visualAnalysisWindow(doc, viewport(doc, 1, 3), scanFences(doc));
  ok("window never runs past the last line", w.toLine <= doc.lines, JSON.stringify(w));
  ok("window never starts before line 1", w.fromLine >= 1, JSON.stringify(w));
}

/* The refactor's core guarantee: analysing a window must decide the same
   thing about every visible line as analysing the whole document did. */
{
  const sources = [
    [
      "# Heading",
      "",
      "> [!note] Note title",
      "> note body",
      "",
      "plain paragraph",
      "",
      "> [!warning] Warned",
      "> ```js",
      "> inside();",
      "> ```",
      "> trailing body",
      "",
      "```py",
      "outside()",
      "```",
      "<small>nf-caption: cap</small>",
      "",
      "> plain quote",
      "> still quote",
      "",
      "- list item",
      "  - nested",
      "",
      "> [!info] Deep",
      "> > [!note] Inner",
      "> > inner body",
      "> outer body",
      "",
      "final paragraph",
    ].join("\n"),
    [
      "> [!note] Starts at line one",
      "> body",
      "text",
      "```",
      "unclosed fence body",
      "more body",
    ].join("\n"),
  ];

  for (const [index, source] of sources.entries()) {
    const doc = docOf(source);
    const fences = scanFences(doc);
    const whole = calloutEditBlocks(doc, 1, doc.lines, fences);
    const coveringWhole = (line) =>
      whole
        .filter((b) => b.startLine <= line && b.endLine >= line)
        .map((b) => [b.startLine, b.endLine, b.colorVar]);

    let mismatch = null;
    for (let line = 1; line <= doc.lines && !mismatch; line++) {
      const w = visualAnalysisWindow(doc, viewport(doc, line, line), fences);
      const windowed = calloutEditBlocks(doc, w.fromLine, w.toLine, fences)
        .filter((b) => b.startLine <= line && b.endLine >= line)
        .map((b) => [b.startLine, b.endLine, b.colorVar]);
      const expected = coveringWhole(line);
      if (JSON.stringify(windowed) !== JSON.stringify(expected)) {
        mismatch = `line ${line}: windowed ${JSON.stringify(
          windowed
        )} vs whole-doc ${JSON.stringify(expected)}`;
      }
    }
    ok(
      `doc ${index}: windowed analysis matches whole-doc for every single-line viewport`,
      !mismatch,
      mismatch ?? ""
    );

    // Wider viewports, which is what a real editor actually reports.
    mismatch = null;
    for (let a = 1; a <= doc.lines && !mismatch; a++) {
      for (let b = a; b <= Math.min(doc.lines, a + 6) && !mismatch; b++) {
        const w = visualAnalysisWindow(doc, viewport(doc, a, b), fences);
        for (let line = a; line <= b; line++) {
          const windowed = calloutEditBlocks(doc, w.fromLine, w.toLine, fences)
            .filter((x) => x.startLine <= line && x.endLine >= line)
            .map((x) => [x.startLine, x.endLine, x.colorVar]);
          if (JSON.stringify(windowed) !== JSON.stringify(coveringWhole(line))) {
            mismatch = `viewport ${a}-${b}, line ${line}`;
            break;
          }
        }
      }
    }
    ok(`doc ${index}: …and for multi-line viewports`, !mismatch, mismatch ?? "");
  }
}

/* fenceAt() became a binary search over the ascending fence list. Exercise
   it through getBlockRange on a note with many fences: every body line must
   still resolve to the fence that encloses it. */
{
  const lines = [];
  const expected = [];
  for (let i = 0; i < 40; i++) {
    const start = lines.length + 1;
    lines.push("```js", `line_a_${i}();`, `line_b_${i}();`, "```", "");
    expected.push({ start, end: start + 3 });
  }
  const doc = docOf(lines.join("\n"));
  const fences = scanFences(doc);
  equal("all fences found", fences.length, 40);

  let bad = null;
  for (const [i, want] of expected.entries()) {
    for (let n = want.start; n <= want.end && !bad; n++) {
      const range = getBlockRange(doc, n, fences);
      if (range.startLine !== want.start || range.endLine !== want.end) {
        bad = `fence ${i} line ${n} → ${JSON.stringify(range)}`;
      }
    }
  }
  ok("every fence line resolves to its own fence", !bad, bad ?? "");

  // Blank separator rows sit between fences and must not be absorbed.
  let blankBad = null;
  for (const want of expected) {
    const blank = want.end + 1;
    if (blank > doc.lines) continue;
    const range = getBlockRange(doc, blank, fences);
    if (range.startLine !== blank || range.endLine !== blank) {
      blankBad = `blank ${blank} → ${JSON.stringify(range)}`;
      break;
    }
  }
  ok("blank rows between fences stay their own block", !blankBad, blankBad ?? "");
}

console.log(failures === 0 ? "run30 OK" : `run30 FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
