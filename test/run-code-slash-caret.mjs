// "/code" + typing puts the code INSIDE the new block, in every context.
//
// Live Preview draws a code block's opener row as its language chip, and the
// Callout edit plugin's selection filter carries a caret that lands on that
// row past it (stepOverHiddenRows). The slash menu writes its snippet and then
// places the caret in a second, programmatic transaction (Obsidian's
// Editor.setCursor carries no user event). The filter used to read that
// placement as a user's move back onto the chip and sent the caret to the end
// of the row above, so "/code" + "console.log(1)" wrote the code over the
// block: "Before\nconsole.log(1)\n```\n\n```".
//
// The harness below is a Live Preview editor made of a real CodeMirror state
// with the real filter installed; after every transaction the Callout edit
// plugin draws the new state (what its update() does in the app), so the
// filter always sees the rows the state was drawn with.
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  SlashSuggest, SLASH_COMMANDS, makeCalloutEditPlugin, hiddenRowsSelectionFilter, hiddenPrefixLeftTarget,
} from "./bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
};

const SETTINGS = {
  calloutEditing: true, codeBlockEditing: true, toggleBlocks: true, columnLayout: true,
  slashCommands: true, slashRecent: [],
};
const Plugin = makeCalloutEditPlugin({ settings: SETTINGS, app: {} });
const code = SLASH_COMMANDS.find((command) => command.id === "code");

/**
 * An editor over `lines` with the caret at (line, ch), 0-based.
 * `live`: Live Preview (the opener is drawn as its chip) or Source mode.
 * `exposeView`: whether `editor.cm` reaches the CodeMirror view, as Obsidian's
 *   editor does; false models a writer that only speaks the Editor API.
 * `column`: replaceRange behaves like the column editor's adapter (one
 *   transaction carrying the change, a caret at its end and "input.complete").
 */
function liveEditor(lines, line, ch, { live = true, exposeView = true, column = false } = {}) {
  let state = EditorState.create({
    doc: lines.join("\n"),
    extensions: [EditorState.transactionFilter.of(hiddenRowsSelectionFilter)],
  });
  const off = (pos) => {
    const row = state.doc.line(Math.max(1, Math.min(state.doc.lines, pos.line + 1)));
    return Math.min(row.to, row.from + pos.ch);
  };
  const draw = () => {
    new Plugin({
      state,
      visibleRanges: [{ from: 0, to: state.doc.length }],
      contentDOM: { clientWidth: 700, style: { setProperty() {} } },
      dom: { closest: (selector) => (live && String(selector).includes("is-live-preview") ? {} : null) },
      requestMeasure() {},
    });
  };
  const dispatch = (spec) => {
    state = state.update(spec).state;
    draw();
  };
  state = state.update({ selection: { anchor: off({ line, ch }) } }).state;
  draw();
  const editor = {
    getLine: (n) => (n >= 0 && n < state.doc.lines ? state.doc.line(n + 1).text : ""),
    lineCount: () => state.doc.lines,
    getCursor: () => {
      const head = state.selection.main.head;
      const row = state.doc.lineAt(head);
      return { line: row.number - 1, ch: head - row.from };
    },
    replaceRange(text, from, to = from) {
      const start = off(from);
      dispatch(
        column
          ? { changes: { from: start, to: off(to), insert: text }, selection: { anchor: start + text.length }, userEvent: "input.complete" }
          : { changes: { from: start, to: off(to), insert: text } }
      );
    },
    // Obsidian's Editor.setCursor: a bare selection, no user event.
    setCursor(pos) {
      dispatch({ selection: { anchor: off(pos) }, scrollIntoView: true });
    },
  };
  if (exposeView) editor.cm = { get state() { return state; } };
  return {
    editor,
    get state() { return state; },
    dispatch,
    type(text) {
      const head = state.selection.main.head;
      dispatch({ changes: { from: head, insert: text }, selection: { anchor: head + text.length }, userEvent: "input.type" });
    },
    text: () => state.doc.toString(),
  };
}

/** Type "/code" at the end of row `line`, pick "Code block" as Enter does,
 *  then type "console.log(1)". Returns the editor. */
function slashCode(lines, line, options) {
  const withSlash = lines.slice();
  withSlash[line] += "/code";
  const ch = withSlash[line].length;
  const ed = liveEditor(withSlash, line, ch, options);
  const suggest = new SlashSuggest({ app: {}, settings: SETTINGS });
  suggest.plugin = { settings: SETTINGS, saveSettings() {} };
  suggest.context = {
    editor: ed.editor,
    start: { line, ch: ch - "/code".length },
    end: { line, ch },
    query: "code",
  };
  suggest.selectSuggestion(code, { key: "Enter" });
  ed.type("console.log(1)");
  return ed;
}

/* ---------- /code + typing: the code goes into the block ---------- */
{
  const cases = [
    ["a paragraph's empty row", ["Before", "", ""], 2,
      "Before\n\n```\nconsole.log(1)\n```"],
    ["the top of the note", [""], 0,
      "```\nconsole.log(1)\n```"],
    ["mid-line after text", ["Before "], 0,
      "Before \n```\nconsole.log(1)\n```"],
    ["a list item", ["- item "], 0,
      "- item \n  ```\n  console.log(1)\n  ```"],
    ["a nested list item", ["- a", "  - item "], 1,
      "- a\n  - item \n    ```\n    console.log(1)\n    ```"],
    ["a numbered item three deep", ["1. a", "   1. b", "      1. item "], 2,
      "1. a\n   1. b\n      1. item \n         ```\n         console.log(1)\n         ```"],
    ["a Callout's body row", ["> [!note] T", "> body "], 1,
      "> [!note] T\n> body \n> ```\n> console.log(1)\n> ```"],
    ["a Callout's empty row", ["> [!note] T", "> body", "> "], 2,
      "> [!note] T\n> body\n> ```\n> console.log(1)\n> ```"],
    ["a list item in a Callout", ["> [!note] T", "> - item "], 1,
      "> [!note] T\n> - item \n>   ```\n>   console.log(1)\n>   ```"],
    ["a plain quote", ["> quoted "], 0,
      "> quoted \n> ```\n> console.log(1)\n> ```"],
    ["a column (nested Callout rows)", ["> [!nf-cols]", "> > [!nf-col]", "> > text "], 2,
      "> [!nf-cols]\n> > [!nf-col]\n> > text \n> > ```\n> > console.log(1)\n> > ```"],
  ];
  for (const [name, lines, line, want] of cases) {
    const got = slashCode(lines, line).text();
    ok(`/code in ${name}: typed code lands in the block`, got === want, JSON.stringify(got));
  }
  // The column editor's own adapter: its replaceRange carries a caret, and a
  // writer that does not expose its view still gets the caret into the block
  // (the filter takes a placed caret forward, never back above the block).
  for (const [name, options] of [
    ["the column editor's adapter", { column: true }],
    ["a writer without a view", { exposeView: false }],
    ["the column editor's adapter without a view", { column: true, exposeView: false }],
  ]) {
    const got = slashCode(["> [!note] T", "> - item "], 1, options).text();
    ok(`/code through ${name}: typed code lands in the block`,
      got === "> [!note] T\n> - item \n>   ```\n>   console.log(1)\n>   ```", JSON.stringify(got));
    const para = slashCode(["Before", "", ""], 2, options).text();
    ok(`/code through ${name} in a paragraph too`, para === "Before\n\n```\nconsole.log(1)\n```", JSON.stringify(para));
  }
  // Source mode shows the opener as text: the caret still waits for the
  // language there, as the snippet's own marker says.
  const source = slashCode(["Before", "", ""], 2, { live: false }).text();
  ok("/code in Source mode: the caret waits for the language on the visible opener",
    source === "Before\n\n```console.log(1)\n\n```", JSON.stringify(source));
}

/* ---------- the filter still steps over the chip for real caret moves ---------- */
{
  const DOC = ["- item", "  ```js", "  let x = 1;", "  ```", "after"];
  const at = (ed, n, ch = 0) => ed.state.doc.line(n).from + ch;
  const head = (ed) => ed.state.selection.main.head;

  let ed = liveEditor(DOC, 0, 6);
  ed.dispatch({ selection: { anchor: at(ed, 2, 3) }, userEvent: "select" });
  ok("ArrowDown onto the opener goes on to the code's text, past the list indent",
    head(ed) === at(ed, 3, 2), JSON.stringify({ head: head(ed), want: at(ed, 3, 2) }));

  ed = liveEditor(DOC, 2, 5);
  ed.dispatch({ selection: { anchor: at(ed, 2, 5) }, userEvent: "select" });
  ok("ArrowUp onto the opener goes back to the end of the row above",
    head(ed) === at(ed, 1, 6), JSON.stringify({ head: head(ed), want: at(ed, 1, 6) }));

  ed = liveEditor(DOC, 2, 5);
  ed.dispatch({ selection: { anchor: at(ed, 2, 0) }, userEvent: "select.pointer" });
  ok("a click onto the opener from below goes back above it too", head(ed) === at(ed, 1, 6), String(head(ed)));

  ed = liveEditor(DOC, 0, 0);
  ed.dispatch({ selection: EditorSelection.range(0, at(ed, 2, 1)), userEvent: "select" });
  ok("Shift+ArrowDown keeps its anchor and steps its head",
    ed.state.selection.main.anchor === 0 && head(ed) === at(ed, 3, 2), JSON.stringify(ed.state.selection.main));

  ed = liveEditor(DOC, 0, 3);
  ed.dispatch({ selection: { anchor: at(ed, 3, 7) }, userEvent: "select" });
  ok("a move that ends in the code is left alone", head(ed) === at(ed, 3, 7), String(head(ed)));

  // A placement made by code (Editor.setCursor, a block operation parking
  // the caret) has no direction to read: it goes into the block, never
  // back above it, wherever the caret was before.
  ed = liveEditor(DOC, 4, 5);
  ed.dispatch({ selection: { anchor: at(ed, 2, 7) } });
  ok("a programmatic caret placed on the opener from below goes into the block",
    head(ed) === at(ed, 3, 2), JSON.stringify({ head: head(ed), want: at(ed, 3, 2) }));
  ed = liveEditor(DOC, 0, 0);
  ed.dispatch({ selection: { anchor: at(ed, 2, 0) } });
  ok("…and from above", head(ed) === at(ed, 3, 2), String(head(ed)));

  // A range set by code is an operation's span and stays exactly as asked.
  ed = liveEditor(DOC, 4, 5);
  ed.dispatch({ selection: EditorSelection.range(at(ed, 4, 5), at(ed, 2, 0)) });
  ok("a programmatic range whose head is on the opener is left alone",
    ed.state.selection.main.anchor === at(ed, 4, 5) && head(ed) === at(ed, 2, 0), JSON.stringify(ed.state.selection.main));

  // A selection that comes with a change is the change's own business.
  ed = liveEditor(DOC, 4, 5);
  ed.dispatch({ changes: { from: at(ed, 5), insert: "x" }, selection: { anchor: at(ed, 2, 3) } });
  ok("a selection carried by a doc change is never moved", head(ed) === at(ed, 2, 3), String(head(ed)));

  // Source mode draws no chip: nothing to step over.
  ed = liveEditor(DOC, 0, 6, { live: false });
  ed.dispatch({ selection: { anchor: at(ed, 2, 3) }, userEvent: "select" });
  ok("Source mode: the opener is an ordinary row", head(ed) === at(ed, 2, 3), String(head(ed)));

  // A Callout's list: the chip is stepped past to the text after ">   ".
  const CO = ["> [!note] T", "> - item", ">   ```", ">   code", ">   ```"];
  ed = liveEditor(CO, 1, 8);
  ed.dispatch({ selection: { anchor: at(ed, 3, 2) }, userEvent: "select" });
  ok("in a Callout's list item, ArrowDown lands after the quote marker and the item indent",
    head(ed) === at(ed, 4, 4), JSON.stringify({ head: head(ed), want: at(ed, 4, 4) }));
}

/* ---------- no caret rests in a nested code row's indentation ---------- */
// Obsidian's own vertical move steps over the opener chip by itself, so the
// chip skip never sees it: ArrowDown from "- item" column 0 lands on the code
// row's column 0, in front of the item's indentation, and a "Z" typed there
// pulled the row out of the list ("Z  let x = 1;"). A click on the card's
// left edge lands there too.
{
  const DOC = ["- item", "  ```js", "  let x = 1;", "  let y = 2;", "  ```", "- next"];
  const at = (ed, n, ch = 0) => ed.state.doc.line(n).from + ch;
  const head = (ed) => ed.state.selection.main.head;

  let ed = liveEditor(DOC, 0, 0);
  ed.dispatch({ selection: { anchor: at(ed, 3, 0) }, userEvent: "select" });
  ok("ArrowDown past the chip onto a list code row's column 0 lands at its text",
    head(ed) === at(ed, 3, 2), JSON.stringify({ head: head(ed), want: at(ed, 3, 2) }));
  ed.type("Z");
  ok("…so typing stays inside the list's code block",
    ed.text() === "- item\n  ```js\n  Zlet x = 1;\n  let y = 2;\n  ```\n- next", JSON.stringify(ed.text()));

  ed = liveEditor(DOC, 5, 0);
  ed.dispatch({ selection: { anchor: at(ed, 4, 0) }, userEvent: "select" });
  ok("ArrowUp onto a code row's column 0 lands at its text",
    head(ed) === at(ed, 4, 2), String(head(ed)));
  ed = liveEditor(DOC, 5, 0);
  ed.dispatch({ selection: { anchor: at(ed, 5, 0) }, userEvent: "select" });
  ok("ArrowUp onto the closer's column 0 lands in the item, in front of its ```",
    head(ed) === at(ed, 5, 2), String(head(ed)));
  ed = liveEditor(DOC, 5, 3);
  ed.dispatch({ selection: { anchor: at(ed, 4, 1) }, userEvent: "select.pointer" });
  ok("a click inside the indentation lands at the text", head(ed) === at(ed, 4, 2), String(head(ed)));
  ed = liveEditor(DOC, 5, 3);
  ed.dispatch({ selection: { anchor: at(ed, 4, 1) } });
  ok("a programmatic caret in the indentation goes to the text too", head(ed) === at(ed, 4, 2), String(head(ed)));
  ed = liveEditor(DOC, 3, 5);
  ed.dispatch({ selection: EditorSelection.range(at(ed, 3, 5), at(ed, 4, 0)), userEvent: "select" });
  ok("a range keeps its anchor and its head leaves the indentation",
    ed.state.selection.main.anchor === at(ed, 3, 5) && head(ed) === at(ed, 4, 2), JSON.stringify(ed.state.selection.main));

  // The code's OWN indentation, past the item's column, is ordinary text.
  const DEEP = ["- item", "  ```py", "  if x:", "      pass", "  ```"];
  ed = liveEditor(DEEP, 2, 3);
  ed.dispatch({ selection: { anchor: at(ed, 4, 3) }, userEvent: "select" });
  ok("a caret inside the code's own indentation stays", head(ed) === at(ed, 4, 3), String(head(ed)));
  ed = liveEditor(DEEP, 2, 3);
  ed.dispatch({ selection: { anchor: at(ed, 4, 0) }, userEvent: "select" });
  ok("…but not in front of the item's column", head(ed) === at(ed, 4, 2), String(head(ed)));

  // ArrowLeft from the text goes on to the row above (the zone is no stop).
  const zonesOf = (ed) => {
    const Plugin = makeCalloutEditPlugin({ settings: SETTINGS, app: {} });
    const view = new Plugin({
      state: ed.state,
      visibleRanges: [{ from: 0, to: ed.state.doc.length }],
      contentDOM: { clientWidth: 700, style: { setProperty() {} } },
      dom: { closest: (selector) => (String(selector).includes("is-live-preview") ? {} : null) },
      requestMeasure() {},
    });
    return view.zones;
  };
  ed = liveEditor(DOC, 3, 2);
  const zones = zonesOf(ed);
  ok("each code row of a list's fence has a zone over the item's indentation",
    JSON.stringify(zones) === JSON.stringify([
      { from: at(ed, 3), to: at(ed, 3, 2) },
      { from: at(ed, 4), to: at(ed, 4, 2) },
      { from: at(ed, 5), to: at(ed, 5, 2) },
    ]), JSON.stringify(zones));
  ok("ArrowLeft from a code row's text goes to the end of the row above",
    hiddenPrefixLeftTarget(ed.state.doc, at(ed, 4, 2), zones) === at(ed, 3, 12),
    String(hiddenPrefixLeftTarget(ed.state.doc, at(ed, 4, 2), zones)));

  // Quoted: the markers and the item's indentation are one zone.
  const QUOTED = ["> - item", ">   ```js", ">   let x = 1;", ">   ```", "> - next"];
  ed = liveEditor(QUOTED, 0, 3);
  ed.dispatch({ selection: { anchor: at(ed, 3, 0) }, userEvent: "select" });
  ok("a quoted list's code row: the caret lands past '>   '", head(ed) === at(ed, 3, 4), String(head(ed)));
  ed = liveEditor(QUOTED, 0, 3);
  ed.dispatch({ selection: { anchor: at(ed, 3, 1) }, userEvent: "select" });
  ok("…also from inside the markers", head(ed) === at(ed, 3, 4), String(head(ed)));

  // A top-level fence has no container column: Home and clicks reach column 0.
  const TOP = ["para", "```js", "  let x = 1;", "```"];
  ed = liveEditor(TOP, 0, 0);
  ed.dispatch({ selection: { anchor: at(ed, 3, 0) }, userEvent: "select" });
  ok("a top-level code row keeps column 0", head(ed) === at(ed, 3, 0), String(head(ed)));
  ok("a top-level fence has no zones", zonesOf(ed).length === 0, JSON.stringify(zonesOf(ed)));

  // Source mode draws the fence as text: nothing is snapped.
  ed = liveEditor(DOC, 0, 0, { live: false });
  ed.dispatch({ selection: { anchor: at(ed, 3, 0) }, userEvent: "select" });
  ok("Source mode: a list code row's column 0 is an ordinary position", head(ed) === at(ed, 3, 0), String(head(ed)));
}

/* ---------- review3-main1-1: whole-row selections keep the next row's hidden head ---------- */
{
  const at = (ed, n, ch = 0) => ed.state.doc.line(n).from + ch;
  const backspace = (ed) => {
    const { from, to } = ed.state.selection.main;
    ed.dispatch({ changes: { from, to }, userEvent: "delete.backward" });
  };
  // Callout: triple-click "aaa" (CM's range is [line.from, next line.from]), then Backspace.
  let ed = liveEditor(["> [!note] T", "> aaa", "> - item"], 1, 3);
  ed.dispatch({ selection: EditorSelection.range(at(ed, 2), at(ed, 3)), userEvent: "select.pointer" });
  ok("main1-1: a triple-click on a Callout row keeps its range", ed.state.selection.main.from === at(ed, 2) && ed.state.selection.main.to === at(ed, 3),
    JSON.stringify(ed.state.selection.main));
  backspace(ed);
  ok("main1-1: …and Backspace keeps the next row in the Callout", ed.text() === "> [!note] T\n> - item", JSON.stringify(ed.text()));
  // The header row, triple-clicked and deleted.
  ed = liveEditor(["> [!note] T", "> aaa", "> - item"], 1, 3);
  ed.dispatch({ selection: EditorSelection.range(at(ed, 1), at(ed, 2)), userEvent: "select.pointer" });
  backspace(ed);
  ok("main1-1: deleting a triple-clicked header keeps the body's markers", ed.text() === "> aaa\n> - item", JSON.stringify(ed.text()));
  // A Shift+click at the next row's left edge from mid-text still snaps past the markers.
  ed = liveEditor(["> [!note] T", "> aaa", "> - item"], 1, 3);
  ed.dispatch({ selection: EditorSelection.range(at(ed, 2, 3), at(ed, 3)), userEvent: "select.pointer" });
  ok("main1-1: a mid-text anchor still snaps the head past the markers", ed.state.selection.main.head === at(ed, 3, 2), JSON.stringify(ed.state.selection.main));
  backspace(ed);
  ok("main1-1: …so the join keeps one set of markers", ed.text() === "> [!note] T\n> a- item", JSON.stringify(ed.text()));
  // A drag upward that ends at a row's left edge is not whole rows: it snaps as before.
  ed = liveEditor(["> [!note] T", "> aaa", "> bbb"], 2, 4);
  ed.dispatch({ selection: EditorSelection.range(at(ed, 3, 4), at(ed, 2)), userEvent: "select.pointer" });
  ok("main1-1: a backward range to a row's left edge snaps as before", ed.state.selection.main.head === at(ed, 2, 2), JSON.stringify(ed.state.selection.main));
  // Code: triple-click "Example:" (the head was on that line before), then Backspace.
  const codeDoc = ["intro", "Example:", "```js", "let a = 1;", "```", "", "after"];
  ed = liveEditor(codeDoc, 1, 3);
  ed.dispatch({ selection: EditorSelection.range(at(ed, 2), at(ed, 3)), userEvent: "select.pointer" });
  ok("main1-1: a triple-click above a code opener keeps its range", ed.state.selection.main.to === at(ed, 3), JSON.stringify(ed.state.selection.main));
  backspace(ed);
  ok("main1-1: …and Backspace leaves the opener", ed.text() === "intro\n```js\nlet a = 1;\n```\n\nafter", JSON.stringify(ed.text()));
  // From a mid-line anchor, the head stops at the end of the row above instead.
  ed = liveEditor(codeDoc, 1, 3);
  ed.dispatch({ selection: EditorSelection.range(at(ed, 2, 3), at(ed, 3)), userEvent: "select.pointer" });
  ok("main1-1: a mid-line anchor: the head goes back to the row above's end", ed.state.selection.main.head === at(ed, 2, 8), JSON.stringify(ed.state.selection.main));
  backspace(ed);
  ok("main1-1: …so Backspace never takes the opener", ed.text() === "intro\nExa\n```js\nlet a = 1;\n```\n\nafter", JSON.stringify(ed.text()));
  // A caret landing on the opener still steps over it (unchanged).
  ed = liveEditor(codeDoc, 1, 3);
  ed.dispatch({ selection: { anchor: at(ed, 3) }, userEvent: "select" });
  ok("main1-1: a caret on the opener still steps into the code", ed.state.selection.main.head === at(ed, 4), JSON.stringify(ed.state.selection.main));
}

if (fail) {
  console.log(`${fail} failure(s)`);
  process.exit(1);
}
console.log("PASS code slash caret");
