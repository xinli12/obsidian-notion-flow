/*
 * Alternating Markdown containers: Callout > list item > blockquote.
 *
 * A structural prefix is not always "indent, then every quote marker".
 * Markdown may alternate containers, as in `> - parent` followed by
 * `>   > child`. Every model that consumes the child row must preserve that
 * complete path: fences, tables, captions, quoted lists, block conversion,
 * and whole-block formatting.
 */
import { EditorState } from "@codemirror/state";
import {
  batchToggleFormatChanges,
  blocksInLineSpan,
  fenceMeasureLines,
  getTableRange,
  innerBlockAt,
  makeCalloutEditPlugin,
  parseBlockCaption,
  quoteBackspacePlan,
  quotedListMarker,
  scanFences,
  turnQuoteBlockInto,
} from "./bundle.mjs";

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
const ok = (name, condition, extra = "") => {
  if (!condition) fail++;
  console.log(
    `${condition ? "PASS" : "FAIL"} ${name}` +
      (condition || !extra ? "" : ` :: ${extra}`)
  );
};

const docOf = (lines) =>
  EditorState.create({ doc: lines.join("\n") }).doc;
const applyChange = (text, change) =>
  change == null
    ? null
    : text.slice(0, change.from) + change.insert + text.slice(change.to);
const applyChanges = (text, changes) => {
  let out = text;
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, change.from) + change.insert + out.slice(change.to);
  }
  return out;
};

/* ------------------------------------------------------------------ */
/* Every block model recognises the complete alternating prefix        */
/* ------------------------------------------------------------------ */

const FENCE = [
  "> [!note] T",
  "> - parent",
  ">   > ```js",
  ">   > const x = 1;",
  ">   > ```",
  "> - tail",
];

{
  const doc = docOf(FENCE);
  const fences = scanFences(doc);
  equal(
    "Callout > list > quote fence is recognised",
    fences.map((fence) => [fence.startLine, fence.endLine, fence.closed]),
    [[3, 5, true]]
  );
  equal(
    "interleaved fence keeps its exact body prefix",
    fences[0]?.bodyPrefix,
    ">   > "
  );
  equal(
    "interleaved fence records both quote levels",
    fences[0]?.quoteDepth,
    2
  );
}

{
  const doc = docOf(["> [!note] T", "> ```js", "> final body row"]);
  const fence = scanFences(doc)[0];
  equal(
    "an unclosed fence measures its final body row",
    fence ? fenceMeasureLines(doc, fence) : [],
    [3]
  );
}

const TABLE = [
  "> [!note] T",
  "> - parent",
  ">   > | h | v |",
  ">   > | --- | --- |",
  ">   > | x | y |",
  "> - tail",
];

{
  const doc = docOf(TABLE);
  const fences = scanFences(doc);
  for (const lineNo of [3, 4, 5]) {
    equal(
      `interleaved table is found from row ${lineNo}`,
      getTableRange(doc, lineNo, fences),
      { startLine: 3, endLine: 5 }
    );
  }
}

equal(
  "caption parser keeps an interleaved owner prefix",
  parseBlockCaption(
    '>   > <small class="nf-caption" data-nf-kind="code" data-nf-collapsed="true">Inside</small>'
  ),
  {
    kind: "code",
    caption: "Inside",
    collapsed: true,
    prefix: ">   > ",
  }
);

equal(
  "bullet inside the interleaved quote is recognised",
  quotedListMarker(">   > - nested"),
  { from: 6, to: 7, ordered: false }
);
equal(
  "ordered marker inside the interleaved quote is recognised",
  quotedListMarker(">   > 12) nested"),
  { from: 6, to: 9, ordered: true }
);

/* ------------------------------------------------------------------ */
/* Removing the inner quote keeps the rows in their parent list item   */
/* ------------------------------------------------------------------ */

const INNER_CALLOUT = [
  "> [!note] T",
  "> - parent",
  ">   > [!tip] Inner",
  ">   > body",
  ">   >",
  ">   > more",
  "> - tail",
];
const UNWRAPPED = [
  "> [!note] T",
  "> - parent",
  ">   Inner",
  ">   body",
  ">",
  ">   more",
  "> - tail",
].join("\n");

{
  const source = INNER_CALLOUT.join("\n");
  const doc = docOf(INNER_CALLOUT);
  const header = doc.line(3);
  const plan = quoteBackspacePlan(doc, header.from + 6, scanFences(doc));
  ok("Backspace produces an inner-Callout unwrap plan", plan != null);
  equal(
    "Backspace preserves the parent list content column",
    applyChange(source, plan),
    UNWRAPPED
  );
}

{
  const source = INNER_CALLOUT.join("\n");
  const doc = docOf(INNER_CALLOUT);
  const fences = scanFences(doc);
  const block = innerBlockAt(doc, 3, fences);
  equal(
    "nested Callout resolves independently inside the list item",
    block && [block.startLine, block.endLine],
    [3, 6]
  );
  const change = block ? turnQuoteBlockInto(doc, block, "") : null;
  ok("Turn into Text produces a nested-Callout change", change != null);
  equal(
    "Turn into Text preserves the parent list content column",
    applyChange(source, change),
    UNWRAPPED
  );
}

/* ------------------------------------------------------------------ */
/* Whole-block formatting never rewrites structural code/table rows   */
/* ------------------------------------------------------------------ */

const BOLD = { marker: "**", open: "<b>", close: "</b>" };
const boldAll = (lines) => {
  const source = lines.join("\n");
  const doc = docOf(lines);
  const fences = scanFences(doc);
  const result = batchToggleFormatChanges(
    doc,
    blocksInLineSpan(doc, 1, doc.lines, fences),
    BOLD,
    fences
  );
  return { text: applyChanges(source, result.changes), skipped: result.skipped };
};

{
  const result = boldAll(FENCE);
  equal(
    "whole-Callout bold skips an interleaved fence",
    result.text,
    [
      "> [!note] T",
      "> - **parent**",
      ">   > ```js",
      ">   > const x = 1;",
      ">   > ```",
      "> - **tail**",
    ].join("\n")
  );
  ok("interleaved fence is reported as skipped", result.skipped >= 1);
}

{
  const result = boldAll(TABLE);
  equal(
    "whole-Callout bold skips an interleaved table",
    result.text,
    [
      "> [!note] T",
      "> - **parent**",
      ">   > | h | v |",
      ">   > | --- | --- |",
      ">   > | x | y |",
      "> - **tail**",
    ].join("\n")
  );
  ok("interleaved table is reported as skipped", result.skipped >= 1);
}

/* ------------------------------------------------------------------ */
/* Nested Callouts keep independent visual layers while editing        */
/* ------------------------------------------------------------------ */

const ALL_ON = {
  calloutEditing: true,
  codeBlockEditing: true,
  toggleBlocks: true,
  columnLayout: true,
};

const visualRangesAt = (lines, lineNo) => {
  const source = lines.join("\n");
  const doc = docOf(lines);
  const state = EditorState.create({
    doc: source,
    selection: { anchor: doc.line(lineNo).to },
  });
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: { clientWidth: 700, style: { setProperty() {} } },
    dom: {
      closest: (selector) =>
        String(selector).includes("is-live-preview") ? {} : null,
    },
  };
  const Plugin = makeCalloutEditPlugin({ settings: ALL_ON, app: {} });
  const instance = Object.create(Plugin.prototype);
  return { doc, ranges: instance.build.call(instance, view) };
};

const lineDecorationAt = (doc, ranges, lineNo) =>
  ranges.find(
    (range) =>
      range.kind === "line" && range.from === doc.line(lineNo).from
  );

{
  const lines = [
    "> [!note] Outer",
    "> outer body",
    "> > [!warning] Inner",
    "> > inner body",
    "> tail",
  ];
  const { doc, ranges } = visualRangesAt(lines, 2);
  const innerHeader = lineDecorationAt(doc, ranges, 3);
  const innerBody = lineDecorationAt(doc, ranges, 4);
  ok(
    "an inner Callout keeps its own first-row box while the outer block is open",
    innerHeader?.spec?.attributes?.class?.includes("nf-co-first") &&
      innerHeader.spec.attributes.class.includes("nf-co-nested")
  );
  ok(
    "an inner Callout uses its own warning color and depth",
    innerHeader?.spec?.attributes?.style?.includes("--callout-warning") &&
      innerHeader.spec.attributes.style.includes(
        "--nf-co-parent-color:var(--callout-default)"
      ) &&
      innerHeader.spec.attributes.style.includes("--nf-co-depth:2") &&
      innerBody?.spec?.attributes?.style?.includes("--callout-warning")
  );
  const innerLead = ranges.find(
    (range) =>
      range.kind === "replace" &&
      range.from >= doc.line(3).from &&
      range.to <= doc.line(3).to &&
      range.spec?.widget?.constructor?.name === "VisualCalloutLeadWidget"
  );
  ok(
    "the inner Callout lead is aligned to its second Callout layer",
    innerLead?.spec?.widget?.calloutDepth === 2 &&
      innerLead.spec.widget.quoteDepth === 2
  );
}

{
  const lines = [
    "- parent",
    "  > [!warning] In a list",
    "  > body",
    "- next",
  ];
  const { doc, ranges } = visualRangesAt(lines, 3);
  const header = lineDecorationAt(doc, ranges, 2);
  ok(
    "a Callout in a list receives real Callout editing chrome",
    header?.spec?.attributes?.class?.includes("nf-co-first") &&
      header.spec.attributes.style.includes("--callout-warning")
  );
  ok(
    "a Callout in a list receives a semantic Callout lead",
    ranges.some(
      (range) =>
        range.kind === "replace" &&
        range.from >= doc.line(2).from &&
        range.to <= doc.line(2).to &&
        range.spec?.widget?.constructor?.name === "VisualCalloutLeadWidget"
    )
  );
}

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
