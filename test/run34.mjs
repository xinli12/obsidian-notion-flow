/*
 * Nesting × editing stress harness.
 *
 * Everything below is generated: a corpus of deeply nested documents is
 * crossed with every caret position and every key plan the plugin owns.
 * The plan is applied, and the resulting document is re-checked against the
 * same structural invariants. A plan that corrupts structure therefore
 * fails here rather than in the editor.
 */
import { EditorState } from "@codemirror/state";
import {
  calloutEditBlocks,
  countColumns,
  columnFenceBackspacePlan,
  columnFenceEnterPlan,
  fenceBackspacePlan,
  fenceEnterPlan,
  fenceExitPlan,
  fenceVisualTokenRange,
  getBlockRange,
  insertBlockBelow,
  innerBlockAt,
  moveBlock,
  buildBlockCaption,
  getTableRange,
  parseBlockCaption,
  parseCalloutHeader,
  tableCaptionMeta,
  parseColumnsSource,
  columnInnerSource,
  projectColumnTextChange,
  quoteBackspacePlan,
  quoteEnterPlan,
  quoteInnerBlocks,
  scanFences,
  turnQuoteBlockInto,
  visualAnalysisWindow,
} from "./bundle.mjs";

let fail = 0;
let checks = 0;
const ok = (name, cond, extra = "") => {
  checks++;
  if (!cond) {
    fail++;
    console.log(`FAIL ${name}${extra ? " :: " + extra : ""}`);
  }
};
const pass = (name) => {
  checks++;
  console.log(`PASS ${name}`);
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));

const stateOf = (lines) =>
  EditorState.create({ doc: Array.isArray(lines) ? lines.join("\n") : lines });
const docOf = (lines) => stateOf(lines).doc;

/** Block scaffolding a conversion is allowed to add or remove: list
 *  bullets, task boxes, heading hashes and the "[!type]" token. */
const RE_TOKEN = /^(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?|\[![^\]]*\][+-]?\s*)/;

/* ------------------------------------------------------------------ */
/* Corpus                                                              */
/* ------------------------------------------------------------------ */

const CORPUS = {
  "quote > list > fence": [
    "intro",
    "",
    "> [!note] Title",
    "> - first item",
    "> - second item",
    ">   ```js",
    ">   const a = 1;",
    ">   ```",
    "> tail",
    "",
    "after",
  ],
  "callout in list": [
    "- item",
    "  > [!warning] Careful",
    "  > body",
    "  > - a",
    "  > - b",
    "- next",
  ],
  "two-level quote with fence": [
    "> outer",
    "> > inner",
    "> >   ```py",
    "> >   x = 1",
    "> >   ```",
    "> > more",
    "> back",
  ],
  columns: [
    "> [!nf-cols]",
    "> > [!nf-col]",
    "> > left text",
    "> > - bullet",
    ">",
    "> > [!nf-col|30]",
    "> > right text",
    "> > ```js",
    "> > code();",
    "> > ```",
    "",
    "below",
  ],
  "toggle nesting": [
    "> [!nf-toggle]+ Outer",
    "> body line",
    "> > [!nf-toggle]- Inner",
    "> > hidden",
    "> tail",
  ],
  "toggle holding a table and code": [
    "> [!nf-toggle]+ Data",
    "> | a | b |",
    "> | --- | --- |",
    "> | 1 | 2 |",
    ">",
    "> ```sh",
    "> echo hi",
    "> ```",
  ],
  "fence with caption": [
    "```js",
    "run();",
    "```",
    '<small class="nf-caption" data-nf-kind="code">A caption</small>',
    "",
    "![[img.png]]",
    '<small class="nf-caption" data-nf-kind="image">Picture</small>',
  ],
  "captioned fence inside a callout": [
    "> [!note] N",
    "> ```js",
    "> run();",
    "> ```",
    '> <small class="nf-caption" data-nf-kind="code" data-nf-collapsed="true"></small>',
    "> after",
  ],
  "nested lists with a fence at depth": [
    "- a",
    "  - b",
    "    - c",
    "      ```ts",
    "      let v = 2;",
    "      ```",
    "    - d",
    "- e",
  ],
  "fence opening on a list marker": [
    "- ```python",
    "  print(1)",
    "  ```",
    "- next",
  ],
  "unclosed fence at EOF": ["text", "", "```js", "let dangling = 1;"],
  "unclosed fence in a quote": ["> [!note] T", "> ```js", "> dangling"],
  "quote holding a table": [
    "> [!info] T",
    "> | h | i |",
    "> | --- | --- |",
    "> | 1 | 2 |",
    "> after",
  ],
  "deep quote ladder": [
    "> a",
    "> > b",
    "> > > c",
    "> > > > d",
    "> > > c2",
    "> > b2",
    "> a2",
  ],
  "columns holding a toggle": [
    "> [!nf-cols]",
    "> > [!nf-col]",
    "> > > [!nf-toggle]+ T",
    "> > > inner",
    ">",
    "> > [!nf-col]",
    "> > plain",
  ],
  "blank-separated quote blocks": [
    "> [!note] A",
    "> one",
    ">",
    "> two",
    "",
    "> [!note] B",
    "> three",
  ],
  "tilde fence in a quote": [
    "> [!note] T",
    "> ~~~js",
    "> code",
    "> ~~~",
    "> tail",
  ],
  "heading + hr + quotes": [
    "# Head",
    "---",
    "> quote",
    "text",
    "---",
    "> [!tip] Tip",
    "> body",
  ],
  "empty callout rows": ["> [!note] T", ">", ">", "> body", ">"],
  "list inside quote inside list": [
    "- outer",
    "  > [!note] N",
    "  > - x",
    "  >   - y",
    "  > - z",
    "  > end",
  ],
};

/* ------------------------------------------------------------------ */
/* Invariants                                                          */
/* ------------------------------------------------------------------ */

/** Every structural query on every line of `doc` must stay in bounds and
 *  own the line it was asked about. Returns a list of violations. */
function structureViolations(doc) {
  const bad = [];
  const lines = doc.lines;
  let fences;
  try {
    fences = scanFences(doc);
  } catch (err) {
    return [`scanFences threw: ${err.message}`];
  }

  let previousEnd = 0;
  for (const fence of fences) {
    if (!(fence.startLine >= 1 && fence.endLine <= lines))
      bad.push(`fence out of bounds ${fence.startLine}-${fence.endLine}`);
    if (fence.startLine > fence.endLine)
      bad.push(`fence inverted ${fence.startLine}-${fence.endLine}`);
    if (fence.startLine <= previousEnd)
      bad.push(`fences overlap at ${fence.startLine}`);
    previousEnd = fence.endLine;
  }

  for (let n = 1; n <= lines; n++) {
    let block;
    try {
      block = getBlockRange(doc, n, fences);
    } catch (err) {
      bad.push(`getBlockRange(${n}) threw: ${err.message}`);
      continue;
    }
    if (!block) {
      bad.push(`getBlockRange(${n}) = null`);
      continue;
    }
    if (!(block.startLine >= 1 && block.endLine <= lines))
      bad.push(`block ${n} out of bounds ${block.startLine}-${block.endLine}`);
    // A caption row resolves to the block above it, so the line is allowed
    // to sit at the range's end but never outside it.
    if (!(block.startLine <= n && n <= block.endLine))
      bad.push(`block ${n} excludes its line: ${block.startLine}-${block.endLine}`);

    let inner;
    try {
      inner = innerBlockAt(doc, n, fences);
    } catch (err) {
      bad.push(`innerBlockAt(${n}) threw: ${err.message}`);
      continue;
    }
    if (inner) {
      if (!(inner.startLine >= 1 && inner.endLine <= lines))
        bad.push(`inner ${n} out of bounds ${inner.startLine}-${inner.endLine}`);
      if (!(inner.startLine <= n && n <= inner.endLine))
        bad.push(`inner ${n} excludes its line: ${inner.startLine}-${inner.endLine}`);
    }
  }

  // Callout edit blocks: ordered and laminar (children may nest, but two
  // sibling intervals may never cross), each headed by a real header.
  let blocks;
  try {
    blocks = calloutEditBlocks(doc, 1, lines, fences);
  } catch (err) {
    return bad.concat(`calloutEditBlocks threw: ${err.message}`);
  }
  let lastStart = 0;
  const parents = [];
  for (const block of blocks) {
    if (block.startLine <= lastStart)
      bad.push(`callout blocks out of order at ${block.startLine}`);
    while (
      parents.length > 0 &&
      block.startLine > parents[parents.length - 1].endLine
    ) {
      parents.pop();
    }
    const parent = parents[parents.length - 1];
    if (parent && block.endLine > parent.endLine) {
      bad.push(
        `callout blocks cross at ${block.startLine}: ` +
          `${parent.startLine}-${parent.endLine} vs ` +
          `${block.startLine}-${block.endLine}`
      );
    }
    if (block.startLine > block.endLine)
      bad.push(`callout block inverted ${block.startLine}-${block.endLine}`);
    if (block.endLine > lines)
      bad.push(`callout block past EOF ${block.endLine}`);
    if (!parseCalloutHeader(doc.line(block.startLine).text))
      bad.push(`callout block ${block.startLine} has no header`);
    lastStart = block.startLine;

    parents.push(block);
  }

  // The visual window must cover any structure it is asked to decorate.
  for (let n = 1; n <= lines; n++) {
    const line = doc.line(n);
    const window = visualAnalysisWindow(doc, [{ from: line.from, to: line.to }], fences);
    if (!window) {
      bad.push(`visualAnalysisWindow(${n}) = null`);
      continue;
    }
    if (!(window.fromLine >= 1 && window.toLine <= lines))
      bad.push(`window ${n} out of bounds ${window.fromLine}-${window.toLine}`);
    if (!(window.fromLine <= n && n <= window.toLine))
      bad.push(`window ${n} excludes its line`);
    const fence = fences.find((f) => f.startLine <= n && n <= f.endLine);
    if (fence && (window.fromLine > fence.startLine || window.toLine < fence.endLine))
      bad.push(
        `window ${n} clips its fence ${fence.startLine}-${fence.endLine}: ` +
          `${window.fromLine}-${window.toLine}`
      );
  }

  // Fence tokens stay inside their own line.
  for (const fence of fences) {
    for (const closing of [false, true]) {
      const token = fenceVisualTokenRange(doc, fence, closing);
      if (!token) continue;
      const line = doc.line(closing ? fence.endLine : fence.startLine);
      if (token.from < line.from || token.to > line.to || token.from > token.to)
        bad.push(
          `fence token ${closing ? "close" : "open"} escapes its line: ` +
            `${token.from}-${token.to} vs ${line.from}-${line.to}`
        );
    }
  }
  return bad;
}

/* ------------------------------------------------------------------ */
/* Part A — the corpus itself is structurally sound                    */
/* ------------------------------------------------------------------ */

for (const [name, lines] of Object.entries(CORPUS)) {
  const bad = structureViolations(docOf(lines));
  ok(`structure: ${name}`, bad.length === 0, bad.slice(0, 4).join(" | "));
}
pass(`structure invariants hold across ${Object.keys(CORPUS).length} nested documents`);

/* ------------------------------------------------------------------ */
/* Part B — every key plan, at every caret, keeps structure sound      */
/* ------------------------------------------------------------------ */

const PLANS = [
  ["Enter", (doc, pos) => quoteEnterPlan(doc, pos)],
  ["Enter/fence", (doc, pos) => fenceEnterPlan(doc, pos)],
  ["Backspace", (doc, pos) => quoteBackspacePlan(doc, pos)],
  ["Backspace/fence", (doc, pos) => fenceBackspacePlan(doc, pos)],
  ["ExitFence", (doc, pos) => fenceExitPlan(doc, pos)],
  ["Enter/col", (doc, pos) => columnFenceEnterPlan(doc, pos)],
  ["Backspace/col", (doc, pos) => columnFenceBackspacePlan(doc, pos)],
];

let planRuns = 0;
for (const [name, lines] of Object.entries(CORPUS)) {
  const doc = docOf(lines);
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    // Start of line, first content column, middle, and end: the positions
    // the plans actually branch on.
    const contentCh = line.text.match(/^[ \t>]*/)?.[0].length ?? 0;
    const positions = new Set([
      line.from,
      line.from + Math.min(contentCh, line.text.length),
      line.from + Math.floor(line.text.length / 2),
      line.to,
    ]);
    for (const pos of positions) {
      for (const [planName, run] of PLANS) {
        let plan;
        try {
          plan = run(doc, pos);
        } catch (err) {
          ok(`${planName} @ ${name}:${n}`, false, `threw ${err.message}`);
          continue;
        }
        if (!plan) continue;
        planRuns++;
        const label = `${planName} @ ${name}:${n}+${pos - line.from}`;
        if (
          !(
            plan.from >= 0 &&
            plan.to >= plan.from &&
            plan.to <= doc.length &&
            typeof plan.insert === "string"
          )
        ) {
          ok(label, false, `bad range ${plan.from}-${plan.to}`);
          continue;
        }
        const next = stateOf(doc.toString()).update({
          changes: { from: plan.from, to: plan.to, insert: plan.insert },
        }).state;
        if (!(plan.cursor >= 0 && plan.cursor <= next.doc.length)) {
          ok(label, false, `cursor ${plan.cursor} outside 0..${next.doc.length}`);
          continue;
        }
        const bad = structureViolations(next.doc);
        ok(`${label} keeps structure`, bad.length === 0, bad.slice(0, 3).join(" | "));
      }
    }
  }
}
pass(`${planRuns} key plans applied; structure survives each`);

/* ------------------------------------------------------------------ */
/* Part C — typing every prefix of a nested block, char by char        */
/*                                                                     */
/* The editor sees a structure half-written far more often than it     */
/* sees a finished one. Each prefix of these documents is a state a    */
/* user really passes through while typing.                            */
/* ------------------------------------------------------------------ */

const TYPED = [
  "> [!note] T\n> - a\n>   ```js\n>   x\n>   ```\n> tail",
  "> [!nf-cols]\n> > [!nf-col]\n> > a\n>\n> > [!nf-col]\n> > b",
  "> [!nf-toggle]+ T\n> body\n> > [!nf-toggle]- I\n> > deep",
  "- item\n  > [!note] N\n  > ```py\n  > code\n  > ```",
  "```js\nrun();\n```\n<small class=\"nf-caption\" data-nf-kind=\"code\">Cap</small>",
];

let typedStates = 0;
for (const [index, full] of TYPED.entries()) {
  for (let cut = 1; cut <= full.length; cut++) {
    typedStates++;
    const bad = structureViolations(docOf(full.slice(0, cut)));
    if (bad.length) {
      ok(
        `typing prefix ${index}:${cut}`,
        false,
        `${JSON.stringify(full.slice(0, cut))} → ${bad.slice(0, 2).join(" | ")}`
      );
      break;
    }
  }
}
pass(`${typedStates} partially-typed documents stay structurally sound`);

/* ------------------------------------------------------------------ */
/* Part D — deleting each line of a nested block                       */
/* ------------------------------------------------------------------ */

let deletions = 0;
for (const [name, lines] of Object.entries(CORPUS)) {
  for (let n = 0; n < lines.length; n++) {
    deletions++;
    const rest = lines.slice(0, n).concat(lines.slice(n + 1));
    if (rest.length === 0) continue;
    const bad = structureViolations(docOf(rest));
    ok(`delete line ${n + 1} of ${name}`, bad.length === 0, bad.slice(0, 2).join(" | "));
  }
}
pass(`${deletions} single-line deletions leave structure sound`);

/* ------------------------------------------------------------------ */
/* Part E — editing inside a container must not break the container    */
/* ------------------------------------------------------------------ */

/**
 * How much prose currently lives inside some Callout, in characters.
 *
 * A count rather than a set of lines, because a legitimate edit may move
 * text BETWEEN rows: joining a row onto the one above it rewrites both, and
 * every character stays in the block. Only an edit that pushes content out
 * of the container — the block being torn in half — reduces the total.
 */
const calloutProseLength = (doc) => {
  let total = 0;
  for (const block of calloutEditBlocks(doc, 1, doc.lines)) {
    for (let n = block.startLine; n <= block.endLine; n++) {
      total += doc.line(n).text.replace(/^[ \t]*(?:>[ \t]?)*/, "").length;
    }
  }
  return total;
};

/** Mirrors the plugin's own notion of "which rows sit at this row's quote
 *  depth": the first and last of that run are where leaving it is meant. */
const quoteDepthOf = (text) => (text.match(/^[ \t]*((?:>[ \t]?)*)/)?.[1].match(/>/g) ?? []).length;
const quoteLevelStart = (doc, lineNo) => {
  const depth = quoteDepthOf(doc.line(lineNo).text);
  let start = lineNo;
  while (start > 1 && quoteDepthOf(doc.line(start - 1).text) >= depth) start--;
  return start;
};
const quoteLevelEnd = (doc, lineNo) => {
  const depth = quoteDepthOf(doc.line(lineNo).text);
  let end = lineNo;
  while (end < doc.lines && quoteDepthOf(doc.line(end + 1).text) >= depth) end++;
  return end;
};

for (const [name, lines] of Object.entries(CORPUS)) {
  const doc = docOf(lines);
  const before = calloutProseLength(doc);
  if (before === 0) continue;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    // Leaving a container IS the meaning of these keys on its first and last
    // rows, so those two are deliberate exits and excluded. Everywhere in
    // between there is nothing to exit from — and that is exactly where the
    // old per-row dedent used to tear the block in half.
    const deliberateExit =
      quoteLevelStart(doc, n) === n || quoteLevelEnd(doc, n) === n;
    // Every row, prose included, not just the marker-only ones.
    for (const [key, plan] of [
      ["Enter", quoteEnterPlan(doc, line.to) ?? fenceEnterPlan(doc, line.to)],
      [
        "Backspace",
        quoteBackspacePlan(doc, line.from + (line.text.match(/^[ \t>]*/)?.[0].length ?? 0)),
      ],
    ]) {
      if (!plan || deliberateExit) continue;
      const next = stateOf(doc.toString()).update({
        changes: { from: plan.from, to: plan.to, insert: plan.insert },
      }).state.doc;
      const after = calloutProseLength(next);
      ok(
        `${key} at ${name}:${n} evicts nothing from its callout`,
        after >= before,
        `callout prose ${before} → ${after}:\n${next.toString()}`
      );
    }
  }
}
pass("Enter and Backspace never push content out of the callout holding it");

/* ------------------------------------------------------------------ */
/* Part F — moving a block never loses text                            */
/* ------------------------------------------------------------------ */

const makeView = (text) => {
  let state = stateOf(text);
  return {
    get state() {
      return state;
    },
    dispatch(spec) {
      state = state.update(spec).state;
    },
    focus() {},
    dom: { ownerDocument: { defaultView: { setTimeout() {} } } },
  };
};

/** Prose carried by a document, ignoring structural scaffolding: what a
 *  move is allowed to re-indent and re-quote, but never to lose. */
const prose = (doc) =>
  doc
    .toString()
    .split("\n")
    .map((text) => text.replace(/^[ \t>]*/, "").trim())
    .filter((text) => text.length > 0)
    .sort();

let moves = 0;
for (const [name, lines] of Object.entries(CORPUS)) {
  const source = lines.join("\n");
  const doc = docOf(lines);
  const before = prose(doc);
  for (let n = 1; n <= doc.lines; n++) {
    const block = innerBlockAt(doc, n) ?? getBlockRange(doc, n);
    if (!block || block.startLine !== n) continue;
    for (let target = 1; target <= doc.lines + 1; target++) {
      const view = makeView(source);
      let result;
      try {
        result = moveBlock(view, block, target);
      } catch (err) {
        ok(`move ${name}:${n}→${target}`, false, `threw ${err.message}`);
        continue;
      }
      if (result === null) continue;
      moves++;
      const after = prose(view.state.doc);
      eq(`move ${name}:${n}→${target} keeps every line`, after, before);
      const bad = structureViolations(view.state.doc);
      ok(
        `move ${name}:${n}→${target} keeps structure`,
        bad.length === 0,
        bad.slice(0, 2).join(" | ") + "\n" + view.state.doc.toString()
      );
    }
  }
}
pass(`${moves} block moves across nested documents lose no text`);

/* ------------------------------------------------------------------ */
/* Part G — "insert below" stays in the container it was invoked from  */
/* ------------------------------------------------------------------ */

for (const [name, lines] of Object.entries(CORPUS)) {
  const doc = docOf(lines);
  for (let n = 1; n <= doc.lines; n++) {
    const block = innerBlockAt(doc, n);
    if (!block || block.startLine !== n) continue;
    // The sibling row belongs beside the BLOCK, not beside its first line:
    // an nf-col nested in an nf-cols row sits one level in from its own
    // header, and a whole top-level Callout has no quote level at all.
    const depth = (block.quotePrefix ?? "").split(">").length - 1;
    if (depth === 0) continue;
    const view = makeView(lines.join("\n"));
    insertBlockBelow(view, block, false);
    const caretLine = view.state.doc.lineAt(view.state.selection.main.head);
    const newDepth = (caretLine.text.match(/^[ \t]*((?:>[ \t]?)*)/)?.[1] ?? "")
      .split(">")
      .length - 1;
    ok(
      `insert below ${name}:${n} keeps quote depth ${depth}`,
      newDepth === depth,
      `got depth ${newDepth} on ${JSON.stringify(caretLine.text)}`
    );
    const bad = structureViolations(view.state.doc);
    ok(
      `insert below ${name}:${n} keeps structure`,
      bad.length === 0,
      bad.slice(0, 2).join(" | ")
    );
  }
}
pass("insert-below keeps the new row inside its quote container");

/* ------------------------------------------------------------------ */
/* Part H — a marker-only row mid-container is a row, not an exit      */
/*                                                                     */
/* Enter and Backspace on an empty ">" row used to shed a quote level  */
/* wherever the row sat. In the middle of a container that splits it:  */
/* the Callout keeps only the rows above the caret and everything      */
/* below falls out of the block. At the END of a container the same    */
/* edit is the Notion "press Enter twice to leave", so it stays.       */
/* ------------------------------------------------------------------ */

const applyAt = (lines, plan) => {
  const text = lines.join("\n");
  return plan ? (text.slice(0, plan.from) + plan.insert + text.slice(plan.to)).split("\n") : null;
};

{
  const mid = ["> [!note] A", "> one", ">", "> two"];
  const doc = docOf(mid);
  eq(
    "Enter on an empty row mid-Callout adds a row",
    applyAt(mid, quoteEnterPlan(doc, doc.line(3).to)),
    ["> [!note] A", "> one", ">", ">", "> two"]
  );
  eq(
    "Backspace on an empty row mid-Callout removes the row",
    applyAt(mid, quoteBackspacePlan(doc, doc.line(3).from + 1)),
    ["> [!note] A", "> one", "> two"]
  );

  const tail = ["> [!note] A", "> one", ">"];
  const tailDoc = docOf(tail);
  eq(
    "Enter on the trailing empty row still leaves the Callout",
    applyAt(tail, quoteEnterPlan(tailDoc, tailDoc.line(3).to)),
    ["> [!note] A", "> one", "", ""]
  );
  eq(
    "Backspace on the trailing empty row still sheds a level",
    applyAt(tail, quoteBackspacePlan(tailDoc, tailDoc.line(3).from + 1)),
    ["> [!note] A", "> one", ""]
  );

  // Backspace at a content start: shedding a level is an EXIT, so it only
  // happens where there is something to exit from.
  const body = ["> [!note] A", "> one", "> two", "> three"];
  const bodyDoc = docOf(body);
  eq(
    "Backspace mid-Callout joins the row above",
    applyAt(body, quoteBackspacePlan(bodyDoc, bodyDoc.line(3).from + 2)),
    ["> [!note] A", "> onetwo", "> three"]
  );
  eq(
    "Backspace on the Callout's own header unwraps the whole box",
    applyAt(body, quoteBackspacePlan(bodyDoc, bodyDoc.line(1).from + 2)),
    ["A", "one", "two", "three"]
  );
  eq(
    "Backspace on the last row still sheds one level",
    applyAt(body, quoteBackspacePlan(bodyDoc, bodyDoc.line(4).from + 2)),
    ["> [!note] A", "> one", "> two", "three"]
  );
  eq(
    "…and a nested quote unwraps only its own level",
    applyAt(
      ["> [!note] T", "> > a", "> > b", "> tail"],
      quoteBackspacePlan(docOf(["> [!note] T", "> > a", "> > b", "> tail"]), 16)
    ),
    ["> [!note] T", "> a", "> b", "> tail"]
  );
  {
    // Joining onto a fence or a table would break the block above instead.
    const guarded = ["> [!note] T", "> ```js", "> code", "> ```", "> after", "> end"];
    const guardedDoc = docOf(guarded);
    eq(
      "Backspace after a fence changes nothing",
      applyAt(guarded, quoteBackspacePlan(guardedDoc, guardedDoc.line(5).from + 2)),
      guarded
    );
  }

  const nested = ["> > deep", "> > ", "> > more"];
  const nestedDoc = docOf(nested);
  eq(
    "a nested empty row mid-block keeps both levels",
    applyAt(nested, quoteEnterPlan(nestedDoc, nestedDoc.line(2).to)),
    ["> > deep", "> > ", "> > ", "> > more"]
  );
  const nestedTail = ["> > deep", "> > "];
  const nestedTailDoc = docOf(nestedTail);
  eq(
    "…while at the end it still dedents one level",
    applyAt(nestedTail, quoteEnterPlan(nestedTailDoc, nestedTailDoc.line(2).to)),
    ["> > deep", "> "]
  );
}

{
  // The separator between two columns is pure structure: Enter may add
  // another one (the parser ignores duplicates), but Backspace must not
  // delete it — the two [!nf-col] headers would become adjacent and render
  // as one column holding a nested Callout.
  const cols = [
    "> [!nf-cols]",
    "> > [!nf-col]",
    "> > left",
    ">",
    "> > [!nf-col]",
    "> > right",
  ];
  const doc = docOf(cols);
  eq(
    "Enter on a column separator keeps both columns",
    countColumns(applyAt(cols, quoteEnterPlan(doc, doc.line(4).to))),
    2
  );
  // Home leaves the caret at offset 0 on a marker-only row, and inserting
  // there used to split the ">" itself into a blank line plus ">>", which
  // ended the columns block. The new row is anchored at the row's end.
  eq(
    "…and Enter from the very start of that row does the same",
    applyAt(cols, quoteEnterPlan(doc, doc.line(4).from)),
    ["> [!nf-cols]", "> > [!nf-col]", "> > left", ">", ">", "> > [!nf-col]", "> > right"]
  );
  eq(
    "…still two columns",
    countColumns(applyAt(cols, quoteEnterPlan(doc, doc.line(4).from))),
    2
  );
  eq(
    "Backspace on a column separator changes nothing",
    applyAt(cols, quoteBackspacePlan(doc, doc.line(4).from + 1)),
    cols
  );
  // A widget stands in for the markers, so Home lands BEFORE them. Falling
  // through to CodeMirror there ate the newline and folded the separator
  // into the row above, merging the two columns — found in the editor, not
  // by the model tests, because only the real caret goes to offset 0.
  eq(
    "…including from the very start of the row",
    applyAt(cols, quoteBackspacePlan(doc, doc.line(4).from)),
    cols
  );
  eq(
    "…and on a protected column-content row",
    applyAt(cols, quoteBackspacePlan(doc, doc.line(3).from)),
    cols
  );
  eq(
    "…and on the [!nf-cols] header",
    applyAt(cols, quoteBackspacePlan(doc, doc.line(1).from)),
    cols
  );
  ok(
    "past the markers the row is ordinary text again",
    quoteBackspacePlan(doc, doc.line(1).from + 6) === null
  );
}

/* ------------------------------------------------------------------ */
/* Part I — no edit may change how many columns a row has              */
/* ------------------------------------------------------------------ */

/** Column counts of every [!nf-cols] block in a document, in order. */
const columnShape = (doc) => {
  const shape = [];
  const lines = doc.toString().split("\n");
  for (const block of calloutEditBlocks(doc, 1, doc.lines)) {
    if (parseCalloutHeader(doc.line(block.startLine).text)?.type !== "nf-cols") continue;
    shape.push(countColumns(lines.slice(block.startLine - 1, block.endLine)));
  }
  return shape;
};

for (const [name, lines] of Object.entries(CORPUS)) {
  const doc = docOf(lines);
  const before = columnShape(doc);
  if (before.length === 0) continue;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const contentCh = line.text.match(/^[ \t>]*/)?.[0].length ?? 0;
    for (const [key, plan] of [
      ["Enter", quoteEnterPlan(doc, line.to)],
      ["Backspace", quoteBackspacePlan(doc, line.from + contentCh)],
    ]) {
      if (!plan) continue;
      const next = stateOf(doc.toString()).update({
        changes: { from: plan.from, to: plan.to, insert: plan.insert },
      }).state.doc;
      const after = columnShape(next);
      ok(
        `${key} at ${name}:${n} keeps the column shape`,
        JSON.stringify(after) === JSON.stringify(before),
        `${JSON.stringify(before)} → ${JSON.stringify(after)}\n${next.toString()}`
      );
    }
  }
}
pass("no keystroke silently adds or drops a column");

/* ------------------------------------------------------------------ */
/* Part J — typing in a column round-trips through the source          */
/*                                                                     */
/* The visual column editor hands one column to a child EditorView as   */
/* plain Markdown and projects each edit back into the nested-quote     */
/* source. Every edit the child can produce must survive that trip:     */
/* re-projecting the rewritten source has to return exactly the text    */
/* the child now holds, or the two drift and the column rewrites        */
/* itself under the caret.                                              */
/* ------------------------------------------------------------------ */

const COLUMN_BLOCKS = [
  ["> [!nf-cols]", "> > [!nf-col]", "> > alpha", "> > beta", ">", "> > [!nf-col]", "> > right"],
  ["> [!nf-cols]", "> > [!nf-col|30]", "> > - one", "> > - two", ">", "> > [!nf-col]", "> > x"],
  [
    "> [!nf-cols]",
    "> > [!nf-col]",
    "> > text",
    "> > ```js",
    "> > code();",
    "> > ```",
    ">",
    "> > [!nf-col]",
    "> > tail",
  ],
  ["> [!nf-cols]", "> > [!nf-col]", "> >", ">", "> > [!nf-col]", "> > only"],
];

let projections = 0;
for (const [index, lines] of COLUMN_BLOCKS.entries()) {
  const blockText = lines.join("\n");
  const layout = parseColumnsSource(lines);
  ok(`column block ${index} parses`, layout !== null);
  if (!layout) continue;
  for (let column = 0; column < countColumns(lines); column++) {
    const projection = columnInnerSource(layout, column);
    ok(`column ${index}.${column} projects`, projection != null);
    if (!projection) continue;
    const oldText = projection.doc.toString();
    const edits = [];
    for (let at = 0; at <= oldText.length; at++) {
      edits.push(["insert x", oldText.slice(0, at) + "x" + oldText.slice(at)]);
      edits.push(["insert newline", oldText.slice(0, at) + "\n" + oldText.slice(at)]);
      if (at < oldText.length)
        edits.push(["delete one", oldText.slice(0, at) + oldText.slice(at + 1)]);
    }
    edits.push(["replace all", "brand new"]);
    edits.push(["clear", ""]);
    for (const [what, newText] of edits) {
      const change = projectColumnTextChange(blockText, column, oldText, newText);
      if (!change) {
        ok(
          `${what} in column ${index}.${column} projects back`,
          oldText === newText,
          `no change produced for ${JSON.stringify(newText)}`
        );
        continue;
      }
      projections++;
      const rewritten =
        blockText.slice(0, change.from) + change.insert + blockText.slice(change.to);
      const nextLayout = parseColumnsSource(rewritten.split("\n"));
      if (!nextLayout) {
        ok(`${what} in column ${index}.${column} keeps a columns block`, false, rewritten);
        continue;
      }
      // An edit that breaks a fence marker leaves the column holding an
      // unclosed fence, and an unclosed fence really does run to the end of
      // the block — the later [!nf-col] is inside code at that point. The
      // projection is faithful; the source is simply mid-edit. Only the
      // write-back of well-formed text is a round-trip.
      const unclosed = scanFences(stateOf(newText).doc).some((fence) => !fence.closed);
      if (unclosed) continue;
      const roundTripped = columnInnerSource(nextLayout, column)?.doc.toString();
      ok(
        `${what} @${index}.${column} round-trips`,
        roundTripped === newText,
        `wanted ${JSON.stringify(newText)} got ${JSON.stringify(roundTripped)}\n${rewritten}`
      );
      eq(
        `${what} @${index}.${column} keeps the column count`,
        countColumns(rewritten.split("\n")),
        countColumns(lines)
      );
    }
  }
}
pass(`${projections} column edits project back into nested-quote source`);

/* ------------------------------------------------------------------ */
/* Part K — "Turn into" on a whole multi-line quote or Callout         */
/*                                                                     */
/* Previously hidden from the menu: a one-line prefix rewrite left the  */
/* remaining ">" rows behind and split the block. The whole container   */
/* now sheds one quote level in a single edit.                          */
/* ------------------------------------------------------------------ */

const turn = (lines, prefix, at = 1) => {
  const doc = docOf(lines);
  const block = innerBlockAt(doc, at) ?? getBlockRange(doc, at);
  const change = turnQuoteBlockInto(doc, block, prefix);
  if (!change) return null;
  const text = doc.toString();
  return (text.slice(0, change.from) + change.insert + text.slice(change.to)).split("\n");
};

{
  const callout = ["> [!note] Title", "> body", "> more"];
  eq("Callout → Text keeps the title as its first line", turn(callout, ""), [
    "Title",
    "body",
    "more",
  ]);
  eq("Callout → Heading 1 retypes every row", turn(callout, "# "), [
    "# Title",
    "# body",
    "# more",
  ]);
  eq("Callout → Quote drops only the token", turn(callout, "> "), [
    "> Title",
    "> body",
    "> more",
  ]);
  eq("Callout → To-do", turn(callout, "- [ ] "), [
    "- [ ] Title",
    "- [ ] body",
    "- [ ] more",
  ]);

  eq(
    "a title-less Callout leaves no empty first row",
    turn(["> [!info]", "> only"], ""),
    ["only"]
  );
  eq(
    "a plain multi-line quote unwraps",
    turn(["> one", "> two"], ""),
    ["one", "two"]
  );

  // Content the target prefix cannot describe is unquoted, never retyped.
  eq(
    "a fence inside the Callout survives Heading 1",
    turn(["> [!note] T", "> intro", "> ```js", "> code();", "> ```"], "# "),
    ["# T", "# intro", "```js", "code();", "```"]
  );
  // The "> " was holding the table apart from the row above it. Without a
  // blank line Obsidian will not start a table there at all, so the unwrap
  // has to put the separator back or the box turns into raw pipes.
  eq(
    "a table gets the blank line the quote marker used to give it",
    turn(["> [!note] T", "> | a | b |", "> | --- | --- |"], "# "),
    ["# T", "", "| a | b |", "| --- | --- |"]
  );
  eq(
    "…and so does a horizontal rule, which would otherwise become a setext heading",
    turn(["> [!note] T", "> body", "> ---", "> after"], ""),
    ["T", "body", "", "---", "after"]
  );
  eq(
    "a table already preceded by a blank row gains nothing",
    turn(["> [!note] T", ">", "> | a |", "> | --- |"], ""),
    ["T", "", "| a |", "| --- |"]
  );
  eq(
    "a nested unwrap spells the seam with the container's markers",
    turn(["> [!note] O", "> > [!tip] I", "> > | a |", "> > | --- |", "> tail"], "", 2),
    ["> [!note] O", "> I", ">", "> | a |", "> | --- |", "> tail"]
  );
  eq(
    "a nested Callout is unquoted whole, not retyped",
    turn(["> [!note] T", "> > [!tip] Inner", "> > deep"], "# "),
    ["# T", "> [!tip] Inner", "> deep"]
  );
  eq(
    "…and so is a plain nested quote",
    turn(["> outer", "> > inner", "> tail"], "# "),
    ["# outer", "> inner", "# tail"]
  );
  eq(
    "Text keeps an inner list intact",
    turn(["> [!note] T", "> - one", "> - two"], ""),
    ["T", "- one", "- two"]
  );
  eq(
    "marker-only rows become blank separators",
    turn(["> [!note] T", "> one", ">", "> two"], ""),
    ["T", "one", "", "two"]
  );

  // A Callout nested inside another keeps the outer container's markers.
  const nestedDoc = docOf(["> [!note] Outer", "> > [!tip] Inner", "> > deep", "> tail"]);
  const innerBlock = innerBlockAt(nestedDoc, 2);
  const nestedChange = turnQuoteBlockInto(nestedDoc, innerBlock, "");
  ok("a nested Callout converts", nestedChange !== null);
  if (nestedChange) {
    const text = nestedDoc.toString();
    eq(
      "…shedding only its own level",
      (
        text.slice(0, nestedChange.from) +
        nestedChange.insert +
        text.slice(nestedChange.to)
      ).split("\n"),
      ["> [!note] Outer", "> Inner", "> deep", "> tail"]
    );
  }

  // Columns are scaffolding with their own unwrap action.
  ok(
    "a columns row refuses the conversion",
    turn(["> [!nf-cols]", "> > [!nf-col]", "> > a", ">", "> > [!nf-col]", "> > b"], "") ===
      null
  );
  ok(
    "a single-line block is left to the one-line path",
    turnQuoteBlockInto(docOf(["plain text"]), { startLine: 1, endLine: 1 }, "# ") === null
  );
}

{
  // Whatever the target, the conversion must leave a document the rest of
  // the plugin can still parse.
  const shapes = [
    ["> [!note] T", "> body", "> ```js", "> code", "> ```", "> tail"],
    ["> [!nf-toggle]+ T", "> body", "> > [!nf-toggle]- I", "> > deep"],
    ["> a", "> > b", "> > > c", "> a2"],
    ["> [!note] T", "> | a |", "> | - |", ">", "> after"],
  ];
  for (const [index, lines] of shapes.entries()) {
    for (const prefix of ["", "# ", "- ", "1. ", "- [ ] ", "> "]) {
      const result = turn(lines, prefix);
      if (!result) continue;
      const bad = structureViolations(docOf(result));
      ok(
        `turn shape ${index} into ${JSON.stringify(prefix)} stays parseable`,
        bad.length === 0,
        bad.slice(0, 2).join(" | ") + "\n" + result.join("\n")
      );
      const before = docOf(lines)
        .toString()
        .split("\n")
        .map((line) => line.replace(/^[ \t>]*/, "").replace(RE_TOKEN, "").trim())
        .filter(Boolean)
        .sort();
      const after = result
        .map((line) => line.replace(/^[ \t>]*/, "").replace(RE_TOKEN, "").trim())
        .filter(Boolean)
        .sort();
      eq(`turn shape ${index} into ${JSON.stringify(prefix)} keeps its text`, after, before);
    }
  }
}
pass("whole-block Turn into never splits a container or drops text");

/* ------------------------------------------------------------------ */
/* Part L — a table can carry a caption, like code and images          */
/*                                                                     */
/* The caption is the same portable <small> row, but its owner spans    */
/* several lines: it is found from the table's LAST row and addressed   */
/* by its FIRST, and the block that drags, duplicates and deletes has   */
/* to cover both.                                                       */
/* ------------------------------------------------------------------ */

{
  const cap = (text) => '<small class="nf-caption" data-nf-kind="table">' + text + "</small>";
  const lines = ["intro", "", "| a | b |", "| --- | --- |", "| 1 | 2 |", cap("Q3 figures"), "", "tail"];
  const doc = docOf(lines);

  eq("a table caption parses", parseBlockCaption(cap("Q3 figures")), {
    kind: "table",
    caption: "Q3 figures",
    collapsed: false,
    prefix: "",
  });
  eq("buildBlockCaption writes one", buildBlockCaption("table", "Q3 figures"), cap("Q3 figures"));
  ok("an empty table caption is dropped", buildBlockCaption("table", "  ") === null);

  eq("the caption is found from the table's last row", tableCaptionMeta(doc, 5), {
    kind: "table",
    caption: "Q3 figures",
    collapsed: false,
    prefix: "",
    lineNo: 6,
  });
  ok("…and only from the last row", tableCaptionMeta(doc, 4) === null);

  // Both ends of the block resolve to the same range, so no entry point can
  // strand the caption.
  for (const n of [3, 4, 5, 6]) {
    eq(`line ${n} resolves to the captioned table`, getBlockRange(doc, n), {
      startLine: 3,
      endLine: 6,
    });
  }
  eq("the table's own range excludes the caption", getTableRange(doc, 3, scanFences(doc)), {
    startLine: 3,
    endLine: 5,
  });

  // Dragging the block takes the caption with it.
  const view = makeView(lines.join("\n"));
  moveBlock(view, getBlockRange(doc, 3), 1);
  ok(
    "moving the table carries its caption",
    view.state.doc.toString().split("\n").indexOf(cap("Q3 figures")) ===
      view.state.doc.toString().split("\n").indexOf("| 1 | 2 |") + 1,
    view.state.doc.toString()
  );

  // A quoted table's caption keeps the container's markers.
  const quoted = [
    "> [!note] T",
    "> | a |",
    "> | --- |",
    "> " + cap("Inside a box"),
    "> after",
  ];
  const quotedDoc = docOf(quoted);
  eq("a quoted table caption keeps its prefix", parseBlockCaption(quoted[3])?.prefix, "> ");
  eq("…and is found from the quoted table", tableCaptionMeta(quotedDoc, 3)?.caption, "Inside a box");

  for (const shape of [lines, quoted]) {
    const bad = structureViolations(docOf(shape));
    ok("a captioned table stays structurally sound", bad.length === 0, bad.slice(0, 2).join(" | "));
  }
}
pass("tables carry captions the same way code blocks and images do");

console.log(fail === 0 ? `ALL PASS (${checks} checks)` : `${fail} FAILED`);
process.exit(fail ? 1 : 0);
