/* Popout DOM ownership and focused block-selection hotkey scope. */
import { readFileSync } from "node:fs";
import { EditorState } from "@codemirror/state";
import {
  blockSelectionScopeIsCurrent,
  makeCalloutEditPlugin,
} from "./bundle.mjs";

let fail = 0;
const ok = (name, condition, detail = "") => {
  if (!condition) fail++;
  console.log(
    `${condition ? "PASS" : "FAIL"} ${name}` +
      (condition || !detail ? "" : ` :: ${detail}`)
  );
};

/* ------------------------------------------------------------------ */
/* A stale or unfocused block selection never owns app-wide hotkeys.  */
/* ------------------------------------------------------------------ */

{
  const doc = EditorState.create({ doc: "one\n\ntwo" }).doc;
  const blocks = [
    { startLine: 1, endLine: 1 },
    { startLine: 3, endLine: 3 },
  ];
  ok(
    "focused mounted editor owns a valid block selection",
    blockSelectionScopeIsCurrent(doc, blocks, true, true)
  );
  ok(
    "search or another pane focus stands the scope down",
    !blockSelectionScopeIsCurrent(doc, blocks, false, true)
  );
  ok(
    "a detached editor stands the scope down",
    !blockSelectionScopeIsCurrent(doc, blocks, true, false)
  );
  ok(
    "an empty selection never owns shortcuts",
    !blockSelectionScopeIsCurrent(doc, [], true, true)
  );
  ok(
    "a selection made stale by fewer document lines is rejected",
    !blockSelectionScopeIsCurrent(doc, [{ startLine: 2, endLine: 4 }], true, true)
  );
  ok(
    "overlapping or unordered ranges are rejected",
    !blockSelectionScopeIsCurrent(
      doc,
      [
        { startLine: 2, endLine: 3 },
        { startLine: 1, endLine: 1 },
      ],
      true,
      true
    )
  );
}

/* ------------------------------------------------------------------ */
/* Popout widgets and selection repair use their editor's DOM realm.  */
/* ------------------------------------------------------------------ */

{
  const text = "> [!nf-toggle]- Title\n> body\nafter";
  const state = EditorState.create({
    doc: text,
    selection: { anchor: text.indexOf("body") },
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
  const PluginView = makeCalloutEditPlugin({
    settings: {
      calloutEditing: true,
      codeBlockEditing: true,
      toggleBlocks: true,
      columnLayout: true,
    },
    app: {},
  });
  const instance = Object.create(PluginView.prototype);
  const widget = instance
    .build.call(instance, view)
    .map((range) => range.spec?.widget)
    .find((candidate) => candidate?.constructor?.name === "ToggleMarkWidget");
  const created = [];
  const ownerDocument = {
    createElement(tag) {
      created.push(tag);
      return { className: "" };
    },
  };
  const dom = widget?.toDOM({ dom: { ownerDocument } });
  ok("toggle widget exists", !!widget);
  ok(
    "toggle widget uses the editor ownerDocument",
    created.join() === "span" && !!dom
  );
}

/* The integration classes are intentionally private. Narrow source checks
 * keep their lifecycle wiring from silently regressing without exporting UI. */
{
  const source = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

  const concealStart = source.indexOf("function makeConcealPlugin");
  const concealEnd = source.indexOf("function makeMarkdownConcealPlugin", concealStart);
  const conceal = source.slice(concealStart, concealEnd);
  const globalDocumentApi =
    /\bdocument\.(?:getSelection|caretRangeFromPoint|createTreeWalker|addEventListener|removeEventListener)/;
  ok("ConcealView resolves its editor ownerDocument", conceal.includes("view.dom.ownerDocument"));
  ok("ConcealView has no main-window document API", !globalDocumentApi.test(conceal));
  ok("ConcealView uses the owner-window DOM realm", conceal.includes("this.ownerWindow.Element"));

  const commentStart = source.indexOf("class CommentPopover");
  const commentEnd = source.indexOf("let activeCommentPopover", commentStart);
  const commentPopover = source.slice(commentStart, commentEnd);
  ok(
    "comment popover recognizes clicks across DOM realms",
    commentPopover.includes("evt.composedPath().includes(this.el)") &&
      !commentPopover.includes("evt.target instanceof Node")
  );

  const dragStart = source.indexOf("function makeDragHandlePlugin");
  const dragEnd = source.indexOf("function makeListMarkerPlugin", dragStart);
  const drag = source.slice(dragStart, dragEnd);
  ok(
    "block scope checks the owning EditorView focus",
    drag.includes("this.view.hasFocus") && drag.includes("this.view.dom.isConnected")
  );
  ok(
    "editor blur and window blur clean the block selection",
    drag.includes('addEventListener("blur", this.onEditorBlur, true)') &&
      drag.includes('addEventListener("blur", this.onWindowBlur)')
  );
  ok(
    "active leaf changes clean the block selection",
    drag.includes('"active-leaf-change"') &&
      drag.includes("plugin.app.workspace.offref(this.activeLeafChangeRef)")
  );
  ok(
    "selection scope commands share the current-view guard",
    (drag.match(/runSelectionScopeCommand/g) ?? []).length >= 6
  );
}

if (fail === 0) console.log("ALL PASS");
process.exit(fail);
