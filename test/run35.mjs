/*
 * What a block LOOKS like while it is being edited.
 *
 * The edit-view decoration pass is the whole of that appearance: it hides
 * structural markers behind widgets, paints the Callout box back onto the
 * source rows, and turns a fence into a language chip. Its output is a set
 * of ranges, so the appearance is checkable without an Obsidian window —
 * which is the only way to cover a caret at every position of every nested
 * shape.
 *
 * The invariants below are the ones a broken build pass violates first:
 * overlapping replacements (two widgets fighting for the same text), a
 * replacement crossing a line boundary (CodeMirror renders that as a block,
 * collapsing rows), a marker left exposed (the ">" the user should never
 * see), and prose swallowed by a widget (text that vanishes as you type).
 */
import { EditorState } from "@codemirror/state";
import {
  makeCalloutEditPlugin,
  parseCalloutHeader,
  quoteMarkerPrefix,
  scanFences,
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

const ALL_ON = {
  calloutEditing: true,
  codeBlockEditing: true,
  toggleBlocks: true,
  columnLayout: true,
};

const PluginFor = (settings) =>
  makeCalloutEditPlugin({ settings, app: {} });

/** Run one decoration pass over `lines` with the caret at `anchor`. */
const buildAt = (lines, anchor, settings = ALL_ON, head = anchor) => {
  const doc = lines.join("\n");
  const state = EditorState.create({
    doc,
    selection: { anchor: Math.min(anchor, doc.length), head: Math.min(head, doc.length) },
  });
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: { clientWidth: 700, style: { setProperty() {} } },
    dom: { closest: (sel) => (String(sel).includes("is-live-preview") ? {} : null) },
  };
  const Cls = PluginFor(settings);
  const instance = Object.create(Cls.prototype);
  return { ranges: instance.build.call(instance, view), state };
};

const SHAPES = {
  callout: ["> [!note] T", "> body", "> more"],
  "callout + fence": ["> [!note] T", "> body", "> ```js", "> code();", "> ```", "> tail"],
  "callout + list + fence": [
    "> [!tip] T",
    "> - first",
    ">   ```py",
    ">   x = 1",
    ">   ```",
    "> - second",
  ],
  // A fence opening ON the list marker: the token has to start after the
  // bullet, so the row needs its own gap or it alone shows a bare ">".
  "callout + marker-opener fence": [
    "> [!note] T",
    "> - item",
    "> - ```sh",
    ">   echo hi",
    ">   ```",
    "> tail",
  ],
  "plain quote": ["> one", "> two", "", "after"],
  "nested quotes": ["> a", "> > b", "> > > c", "> a2"],
  toggle: ["> [!nf-toggle]+ Outer", "> body", "> > [!nf-toggle]- Inner", "> > deep"],
  columns: [
    "> [!nf-cols]",
    "> > [!nf-col]",
    "> > left",
    ">",
    "> > [!nf-col|30]",
    "> > right",
  ],
  "bare fence": ["```ts", "let v = 1;", "```", "after"],
  "fence + caption": [
    "```js",
    "run();",
    "```",
    '<small class="nf-caption" data-nf-kind="code">Cap</small>',
  ],
  "collapsed fence": [
    "```js",
    "run();",
    "```",
    '<small class="nf-caption" data-nf-kind="code" data-nf-collapsed="true">Folded</small>',
  ],
  "callout + table": ["> [!info] T", "> | a | b |", "> | --- | --- |", "> | 1 | 2 |"],
  "callout + caption": [
    "> [!note] N",
    "> ```js",
    "> run();",
    "> ```",
    '> <small class="nf-caption" data-nf-kind="code">In a box</small>',
  ],
  "table + caption": [
    "| a | b |",
    "| --- | --- |",
    "| 1 | 2 |",
    '<small class="nf-caption" data-nf-kind="table">Q3 figures</small>',
  ],
  "callout + table + caption": [
    "> [!info] T",
    "> | a | b |",
    "> | --- | --- |",
    '> <small class="nf-caption" data-nf-kind="table">Boxed</small>',
    "> after",
  ],
  "image + caption": [
    "![[pic.png]]",
    '<small class="nf-caption" data-nf-kind="image">Shot</small>',
  ],
  "unclosed fence": ["> [!note] T", "> ```js", "> dangling"],
  "callout in list": ["- item", "  > [!warning] W", "  > body", "- next"],
};

/* ------------------------------------------------------------------ */
/* 1. Well-formed decoration sets                                      */
/* ------------------------------------------------------------------ */

/** Structural problems in one decoration set. */
function decorationViolations(ranges, state) {
  const bad = [];
  const doc = state.doc;
  const replaces = [];
  for (const range of ranges) {
    if (!(range.from >= 0 && range.to <= doc.length && range.from <= range.to)) {
      bad.push(`${range.kind} out of bounds ${range.from}-${range.to}`);
      continue;
    }
    const line = doc.lineAt(range.from);
    if (range.kind === "line") {
      if (range.from !== line.from || range.to !== line.from)
        bad.push(`line decoration not at a line start: ${range.from}-${range.to}`);
      continue;
    }
    if (range.to > line.to)
      bad.push(
        `${range.kind} ${range.from}-${range.to} crosses the end of line ` +
          `${line.number} (${line.to})`
      );
    if (range.kind === "replace") replaces.push(range);
  }
  replaces.sort((a, b) => a.from - b.from || a.to - b.to);
  for (let i = 1; i < replaces.length; i++) {
    const previous = replaces[i - 1];
    const current = replaces[i];
    // Zero-width replacements never collide; a real overlap is two widgets
    // claiming the same characters.
    if (current.from < previous.to && current.to > previous.from)
      bad.push(
        `replacements overlap: ${previous.from}-${previous.to} and ` +
          `${current.from}-${current.to}`
      );
  }
  return bad;
}

let passes = 0;
for (const [name, lines] of Object.entries(SHAPES)) {
  const text = lines.join("\n");
  for (let anchor = 0; anchor <= text.length; anchor++) {
    passes++;
    const { ranges, state } = buildAt(lines, anchor);
    const bad = decorationViolations(ranges, state);
    ok(`${name} @${anchor} decorates cleanly`, bad.length === 0, bad.slice(0, 2).join(" | "));
  }
  // A selection spanning the whole shape is the other extreme.
  const { ranges, state } = buildAt(lines, 0, ALL_ON, text.length);
  const bad = decorationViolations(ranges, state);
  ok(`${name} select-all decorates cleanly`, bad.length === 0, bad.slice(0, 2).join(" | "));
}
pass(`${passes} caret positions across ${Object.keys(SHAPES).length} shapes decorate cleanly`);

/* ------------------------------------------------------------------ */
/* 2. Feature switches never produce a half-decorated row              */
/* ------------------------------------------------------------------ */

const SWITCHES = [
  ["all off", { calloutEditing: false, codeBlockEditing: false, toggleBlocks: false, columnLayout: false }],
  ["callouts only", { calloutEditing: true, codeBlockEditing: false, toggleBlocks: false, columnLayout: false }],
  ["code only", { calloutEditing: false, codeBlockEditing: true, toggleBlocks: false, columnLayout: false }],
  ["no toggles", { calloutEditing: true, codeBlockEditing: true, toggleBlocks: false, columnLayout: true }],
];
for (const [label, settings] of SWITCHES) {
  for (const [name, lines] of Object.entries(SHAPES)) {
    const text = lines.join("\n");
    for (let anchor = 0; anchor <= text.length; anchor += 7) {
      const { ranges, state } = buildAt(lines, anchor, settings);
      const bad = decorationViolations(ranges, state);
      ok(
        `${label}: ${name} @${anchor} decorates cleanly`,
        bad.length === 0,
        bad.slice(0, 2).join(" | ")
      );
    }
  }
}
pass("every combination of the editing switches produces a well-formed set");

/* ------------------------------------------------------------------ */
/* 3. An open Callout still looks like a Callout                       */
/*                                                                     */
/* Entering a Callout swaps Obsidian's rendered widget for source      */
/* rows. Every one of those rows must have its quote markers hidden    */
/* behind a widget, or the box visibly collapses into "> " text.       */
/* ------------------------------------------------------------------ */

for (const [name, lines] of Object.entries(SHAPES)) {
  const doc = EditorState.create({ doc: lines.join("\n") }).doc;
  if (!parseCalloutHeader(doc.line(1).text)) continue;
  const type = parseCalloutHeader(doc.line(1).text).type;
  // Columns and toggles deliberately keep no Callout chrome.
  if (type === "nf-cols" || type === "nf-col" || type === "nf-toggle") continue;
  const fences = scanFences(doc);

  // Caret on the second row: the block is open for editing.
  const anchor = doc.line(2).to;
  const { ranges } = buildAt(lines, anchor);
  const covered = ranges.filter((range) => range.kind === "replace");
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const prefix = quoteMarkerPrefix(line.text);
    if (!prefix) continue;
    const leading = line.text.match(/^[ \t]*/)[0].length;
    const markerFrom = line.from + leading;
    const markerTo = line.from + prefix.length;
    const hidden = covered.some(
      (range) => range.from <= markerFrom && range.to >= markerTo
    );
    ok(
      `${name}: row ${n} hides its quote markers while open`,
      hidden,
      `${JSON.stringify(line.text)} markers ${markerFrom}-${markerTo} left exposed`
    );
  }
}
pass("an open Callout never exposes the quote markers it is made of");

/* ------------------------------------------------------------------ */
/* 4. No widget ever swallows prose                                    */
/*                                                                     */
/* A replacement may only cover structure: quote markers, a "[!type]"  */
/* token, fence markers and their info string, or a caption's HTML.    */
/* Anything else means text disappearing as the user types.            */
/* ------------------------------------------------------------------ */

const STRUCTURE = /^(?:[ \t>]*|[ \t>]*\[![^\]]*\][+-]?[ \t]?|[ \t>]*(?:`{3,}|~{3,})[^\n]*|<small class="nf-caption"[^>]*>.*<\/small>)$/;

for (const [name, lines] of Object.entries(SHAPES)) {
  const text = lines.join("\n");
  for (let anchor = 0; anchor <= text.length; anchor += 3) {
    const { ranges, state } = buildAt(lines, anchor);
    for (const range of ranges) {
      if (range.kind !== "replace" || range.from === range.to) continue;
      const covered = state.doc.sliceString(range.from, range.to);
      ok(
        `${name} @${anchor}: replacement covers only structure`,
        STRUCTURE.test(covered),
        `hid ${JSON.stringify(covered)}`
      );
    }
  }
}
pass("no widget hides anything but structural markers");

console.log(fail === 0 ? `ALL PASS (${checks} checks)` : `${fail} FAILED`);
process.exit(fail ? 1 : 0);
