import { EditorState } from "@codemirror/state";
import {
  SlashSuggest,
  SLASH_COMMANDS,
  clampHandlePairLeft,
  getBlockRange,
  isWidgetSourcePosition,
  listNestingDepth,
  moveBlock,
  nestedCalloutRepair,
  pickIndentByDrag,
  reindentBlock,
  scanFences,
} from "./bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
};

class MockEditor {
  constructor(lines) {
    this.lines = lines;
    this.cursor = { line: 0, ch: 0 };
  }
  getLine(n) { return this.lines[n]; }
  setLine(n, text) { this.lines[n] = text; }
  setCursor(pos) { this.cursor = pos; }
  replaceRange(text, from, to) {
    const head = this.lines[from.line].slice(0, from.ch);
    const tail = this.lines[to.line].slice(to.ch);
    this.lines.splice(from.line, to.line - from.line + 1, ...(head + text + tail).split("\n"));
  }
  text() { return this.lines.join("\n"); }
}

const command = (id) => SLASH_COMMANDS.find((item) => item.id === id);
const insert = (line, id, start, end = line.length) => {
  const suggest = new SlashSuggest({ app: {}, settings: { slashCommands: true } });
  suggest.plugin = { settings: { slashCommands: true } };
  const editor = new MockEditor([line]);
  suggest.context = {
    editor,
    start: { line: 0, ch: start },
    end: { line: 0, ch: end },
  };
  suggest.selectSuggestion(command(id), {});
  return editor;
};

const makeView = (text) => {
  let state = EditorState.create({ doc: text });
  return {
    get state() { return state; },
    dispatch(spec) { state = state.update(spec).state; },
  };
};

/* Drag controls stay visible without losing their ideal wide-pane X. */
{
  ok("wide pane keeps ideal handle pair X", clampHandlePairLeft(300, 0, 800) === 250);
  ok("narrow pane clamps handle pair at left", clampHandlePairLeft(26, 0, 400) === 4);
  ok("negative/scrolled anchor stays visible", clampHandlePairLeft(-20, 40, 400) === 44);
  ok("deep anchor clamps complete pair at right", clampHandlePairLeft(900, 0, 500) === 450);
  ok("widget still owns its final source character", isWidgetSourcePosition(19, 10, 19));
  ok("widget does not capture next sibling start", !isWidgetSourcePosition(20, 10, 19));
}

/* Legacy list Callouts can be repaired explicitly without touching ordinary
   nested quotes or already-correct Callouts. */
{
  const state = EditorState.create({
    doc: "- parent\n    >[!tip] Legacy\n    > body\n    - sibling",
  });
  const repair = nestedCalloutRepair(state.doc, 2);
  ok("legacy Callout repair is offered", !!repair);
  ok(
    "legacy Callout repairs to parent content column",
    repair?.insert === "  > [!tip] Legacy\n  > body" && repair.targetIndent === 2,
    JSON.stringify(repair)
  );
  ok(
    "legacy repair does not reach back from sibling",
    nestedCalloutRepair(state.doc, 4) == null
  );
}
{
  const state = EditorState.create({ doc: "- parent\n  > [!tip] Correct\n  > body" });
  ok("correct nested Callout needs no repair", nestedCalloutRepair(state.doc, 2) == null);
}
{
  const state = EditorState.create({ doc: "- parent\n    > ordinary quote\n    > body" });
  ok("ordinary nested quote is never rewritten", nestedCalloutRepair(state.doc, 2) == null);
}
{
  const state = EditorState.create({
    doc: "- parent\n  ```text\n    >[!tip] literal\n    > body\n  ```",
  });
  ok(
    "Callout-looking code text is never rewritten",
    nestedCalloutRepair(state.doc, 3) == null
  );
}

/* Partial tabs are rebuilt to the exact target column. */
{
  const got = reindentBlock("\t> [!tip] T\n\t> body", -2, { width: 4, useTab: true });
  ok("partial tab outdent keeps two columns", got === "  > [!tip] T\n  > body", JSON.stringify(got));
}

/* Every line of a nested slash template inherits a safe space prefix. */
{
  const editor = insert("  /callout", "callout", 2);
  ok(
    "nested callout slash indents title and body",
    editor.text() === "  > [!note] \n  > ",
    JSON.stringify(editor.text())
  );
}
{
  const editor = insert("    /code", "code", 4);
  ok(
    "nested code slash indents both fences",
    editor.text() === "    ```\n\n    ```",
    JSON.stringify(editor.text())
  );
}
{
  const editor = insert("- parent /callout", "callout", 9);
  const text = editor.text();
  ok(
    "slash in list item creates child callout",
    text === "- parent \n  > [!note] \n  > ",
    JSON.stringify(text)
  );
  const view = makeView(text);
  const block = getBlockRange(view.state.doc, 1, scanFences(view.state.doc));
  ok("parent range contains generated callout", block.startLine === 1 && block.endLine === 3, JSON.stringify(block));
}
{
  const line = "-   parent /callout";
  const editor = insert(line, "callout", line.indexOf("/"));
  ok(
    "multi-space marker keeps its real content column",
    editor.text() === "-   parent \n    > [!note] \n    > ",
    JSON.stringify(editor.text())
  );
}

/* Reading View's directly-attached quote interpretation is reflected in
   visual depth and in the parent list subtree used by the drag handle. */
{
  const view = makeView("- parent\n> [!tip] T\n> body\n- next");
  const fences = scanFences(view.state.doc);
  const parent = getBlockRange(view.state.doc, 1, fences);
  ok("attached callout belongs to parent range", parent.startLine === 1 && parent.endLine === 3, JSON.stringify(parent));
  ok("attached callout has one visual list level", listNestingDepth(view.state.doc, 2) === 1);
}
{
  const view = makeView("- parent\n\n> [!tip] detached\n> body");
  const parent = getBlockRange(view.state.doc, 1, scanFences(view.state.doc));
  ok("blank line ends attached-callout parent range", parent.startLine === 1 && parent.endLine === 1, JSON.stringify(parent));
  ok("blank line keeps callout at top level", listNestingDepth(view.state.doc, 3) === 0);
}
{
  const view = makeView("- old\n\nparagraph\n\n  > top-level quote");
  ok("unrelated earlier list is not an ancestor", listNestingDepth(view.state.doc, 5) === 0);
}
{
  const view = makeView("- top\n    - child\n      > [!tip] nested\n      > body");
  ok("nested list item visual depth", listNestingDepth(view.state.doc, 2) === 1);
  ok("nested callout visual depth", listNestingDepth(view.state.doc, 3) === 2);
}
{
  const view = makeView("- P\n    - C\n    > [!tip] attached\n    > body");
  ok("attached child callout counts both list ancestors", listNestingDepth(view.state.doc, 3) === 2);
}
{
  for (const text of ["1. item\n  > shallow quote", "- item\n > shallow quote"]) {
    const view = makeView(text);
    const parent = getBlockRange(view.state.doc, 1, scanFences(view.state.doc));
    ok("too-shallow structural block stays outside list", parent.endLine === 1, JSON.stringify({ text, parent }));
    ok("too-shallow structural block has no list depth", listNestingDepth(view.state.doc, 2) === 0, text);
  }
}
{
  for (const text of ["- foo\nbar", "> foo\nbar"]) {
    const view = makeView(text);
    const fences = scanFences(view.state.doc);
    const owner = getBlockRange(view.state.doc, 1, fences);
    const lazy = getBlockRange(view.state.doc, 2, fences);
    ok("lazy continuation stays in owner block", owner.startLine === 1 && owner.endLine === 2, JSON.stringify({ text, owner }));
    ok("hovering lazy continuation resolves owner", lazy.startLine === 1 && lazy.endLine === 2, JSON.stringify({ text, lazy }));
  }
}
{
  const cases = [
    { text: "- outer\n  - child\nchild continuation", depth: 2 },
    { text: "- outer\n  > quote\ncontinuation", depth: 1 },
  ];
  for (const { text, depth } of cases) {
    const view = makeView(text);
    const fences = scanFences(view.state.doc);
    const outer = getBlockRange(view.state.doc, 1, fences);
    ok("outer list contains nested lazy continuation", outer.endLine === 3, JSON.stringify({ text, outer }));
    ok("nested lazy continuation keeps full list depth", listNestingDepth(view.state.doc, 3) === depth, JSON.stringify({ text, got: listNestingDepth(view.state.doc, 3) }));
  }
}

/* Dividers and valid fence closers are exact structural boundaries. */
{
  const view = makeView("---\nparagraph");
  const hr = getBlockRange(view.state.doc, 1, scanFences(view.state.doc));
  ok("horizontal rule is one block", hr.startLine === 1 && hr.endLine === 1, JSON.stringify(hr));
}
{
  const view = makeView("```\nalpha\n```js\nbeta\n```");
  const fences = scanFences(view.state.doc);
  ok("fence marker with trailing info is not a closer", fences.length === 1 && fences[0].endLine === 5, JSON.stringify(fences));
}
{
  const view = makeView("```\nalpha\n    ```\nbeta\n```");
  const fences = scanFences(view.state.doc);
  ok("over-indented top-level marker is not a closer", fences.length === 1 && fences[0].endLine === 5, JSON.stringify(fences));
}

/* A vertical drag preserves the closest available level; horizontal delta
   is the only input that changes nesting. */
{
  ok("vertical drag keeps nested indent", pickIndentByDrag([0, 2, 6], 6, 0, 36) === 6);
  ok("small horizontal jitter keeps level", pickIndentByDrag([0, 2, 4], 2, 7, 24) === 2);
  ok("one step left outdents once", pickIndentByDrag([0, 2, 6], 6, -36, 36) === 2);
  ok("one step right indents once", pickIndentByDrag([0, 2, 6], 0, 36, 36) === 2);
}

/* Moving a callout in front of a sibling list item leaves a blank seam so
   Live Preview's source widget cannot swallow that sibling. */
{
  const view = makeView("> [!tip] T\n> body\n\n- parent\n- sibling");
  const fences = scanFences(view.state.doc);
  const callout = getBlockRange(view.state.doc, 1, fences);
  moveBlock(view, callout, 5, fences, 2, { width: 4, useTab: true });
  const out = view.state.doc.toString();
  ok(
    "callout and sibling list get a blank seam",
    out.includes("  > body\n\n- sibling"),
    JSON.stringify(out)
  );
  ok("structural drag avoids mixed tab prefix", !out.includes("\t  >"), JSON.stringify(out));
}
{
  const view = makeView("- parent\n  > [!tip] T\n  > body\n- sibling");
  const fences = scanFences(view.state.doc);
  const callout = getBlockRange(view.state.doc, 2, fences);
  moveBlock(view, callout, 2, fences, 0);
  const out = view.state.doc.toString();
  ok(
    "in-place outdent detaches callout and seals sibling",
    out === "- parent\n\n> [!tip] T\n> body\n\n- sibling",
    JSON.stringify(out)
  );
}
{
  const view = makeView("paragraph\n# temporary\n---\ntail");
  const fences = scanFences(view.state.doc);
  const heading = getBlockRange(view.state.doc, 2, fences);
  moveBlock(view, heading, 5, fences);
  ok(
    "source removal preserves divider seam",
    view.state.doc.toString().startsWith("paragraph\n\n---"),
    JSON.stringify(view.state.doc.toString())
  );
}
{
  const view = makeView("# H\nparagraph A\n# H2\nparagraph B");
  const fences = scanFences(view.state.doc);
  const para = getBlockRange(view.state.doc, 4, fences);
  const start = moveBlock(view, para, 3, fences);
  ok("moveBlock returns actual start after prefix seam", start === 4, String(start));
  ok("moved block starts after the inserted blank", view.state.doc.line(start).text === "paragraph B");
}

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILURES`);
process.exit(fail);
