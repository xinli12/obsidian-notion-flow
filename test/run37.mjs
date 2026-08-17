/*
 * The closing fence row.
 *
 * With code-block editing on, a closed fence's ``` row is replaced by a
 * zero-size widget and collapsed by CSS to the card's 4px bottom edge. That
 * is right until a caret lands there: the row would then hold an invisible
 * cursor, and a typed character would append to the ``` marker — which stops
 * being a closer, so the block swallows the rest of the note. The row has to
 * come back while the caret is on it.
 */
import { EditorState } from "@codemirror/state";
import { makeCalloutEditPlugin } from "./bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond || !extra ? "" : " :: " + extra}`);
};

const buildAt = (lines, anchor, head = anchor) => {
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
  const Cls = makeCalloutEditPlugin({
    settings: { calloutEditing: true, codeBlockEditing: true, toggleBlocks: true, columnLayout: true },
    app: {},
  });
  const instance = Object.create(Cls.prototype);
  return { ranges: instance.build.call(instance, view), state };
};

const LINES = ["text", "```js", "code();", "```", "after"];
const posOf = (lineNo, ch = 0) => {
  const state = EditorState.create({ doc: LINES.join("\n") });
  return state.doc.line(lineNo).from + ch;
};

const hasCloser = (ranges) =>
  ranges.some(
    (r) => r.kind === "line" && /\bnf-visual-fence-close\b/.test(r.spec?.attributes?.class ?? "")
  );
const closerReplaced = (ranges, state) => {
  const line = state.doc.line(4);
  return ranges.some((r) => r.kind === "replace" && r.from >= line.from && r.to === line.to);
};

for (const [name, lineNo] of [["opener", 2], ["body", 3], ["line after", 5]]) {
  const { ranges, state } = buildAt(LINES, posOf(lineNo));
  ok(`caret on the ${name}: closer stays collapsed`, hasCloser(ranges));
  ok(`caret on the ${name}: closer text stays hidden`, closerReplaced(ranges, state));
}

for (const ch of [0, 1, 3]) {
  const { ranges, state } = buildAt(LINES, posOf(4, ch));
  ok(`caret at ch ${ch} of the closer: row is restored`, !hasCloser(ranges));
  ok(`caret at ch ${ch} of the closer: marker is editable`, !closerReplaced(ranges, state));
}

// A sweep across the block must not reflow the rows being selected.
{
  const { ranges, state } = buildAt(LINES, posOf(2), posOf(4, 3));
  ok("selection across the block keeps the closer collapsed", hasCloser(ranges));
  ok("selection across the block keeps ``` hidden", closerReplaced(ranges, state));
}

if (fail === 0) console.log("ALL PASS");
process.exit(fail);
