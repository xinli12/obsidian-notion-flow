import { EditorState, EditorSelection } from "@codemirror/state";
import {
  getWrapState,
  isUnderlineActive,
  toggleUnderline,
  toggleWrap,
  insertLink,
  SlashSuggest,
  SLASH_COMMANDS,
} from "./bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
};

/* ---------- toolbar: toggleWrap / insertLink ---------- */
function makeView(docText, from, to) {
  let state = EditorState.create({
    doc: docText,
    selection: EditorSelection.single(from, to),
  });
  return {
    get state() { return state; },
    dispatch(s) { state = state.update(s).state; },
    focus() {},
  };
}

// wrap
{
  const v = makeView("hello world", 0, 5);
  toggleWrap(v, "**");
  ok("bold wrap", v.state.doc.toString() === "**hello** world", v.state.doc.toString());
  const sel = v.state.selection.main;
  ok("bold wrap keeps selection on word", v.state.doc.sliceString(sel.from, sel.to) === "hello");
}
// unwrap when markers outside selection
{
  const v = makeView("**hello** world", 2, 7); // selects "hello"
  toggleWrap(v, "**");
  ok("bold unwrap (markers outside)", v.state.doc.toString() === "hello world", v.state.doc.toString());
}
// unwrap when markers inside selection
{
  const v = makeView("**hello** world", 0, 9); // selects "**hello**"
  toggleWrap(v, "**");
  ok("bold unwrap (markers inside)", v.state.doc.toString() === "hello world", v.state.doc.toString());
}
// italic inside bold
{
  const v = makeView("**hello** world", 2, 7);
  toggleWrap(v, "*");
  // NOTE: "*" just outside selection is the 2nd char of "**" — naive check
  // would strip bold. Assert we did NOT corrupt the bold markers.
  const out = v.state.doc.toString();
  ok("italic inside bold does not corrupt", out === "***hello*** world" || out === "***hello*** world" || out === "*hello* world" ? out === "***hello*** world" : false, out);
}
// highlight + code round trip
{
  const v = makeView("note taking", 0, 4);
  toggleWrap(v, "==");
  toggleWrap(v, "==");
  ok("highlight round-trip", v.state.doc.toString() === "note taking", v.state.doc.toString());
}
// underline uses portable HTML with different opening/closing markers
{
  const v = makeView("under this", 0, 5);
  toggleUnderline(v);
  ok("underline wrap", v.state.doc.toString() === "<u>under</u> this", v.state.doc.toString());
  ok(
    "underline active state",
    isUnderlineActive(v.state),
    getWrapState(v.state, "<u>", "</u>")
  );
  toggleUnderline(v);
  ok("underline round-trip", v.state.doc.toString() === "under this", v.state.doc.toString());
}
// underline remains active around nested Markdown and toggles the existing
// outer pair instead of adding a second <u> around the selected text
{
  const text = "<u>**under**</u> this";
  const from = text.indexOf("under");
  const v = makeView(text, from, from + "under".length);
  ok("nested underline active state", isUnderlineActive(v.state));
  toggleUnderline(v);
  ok("nested underline unwrap", v.state.doc.toString() === "**under** this", v.state.doc.toString());
  ok(
    "nested underline keeps text selected",
    v.state.doc.sliceString(v.state.selection.main.from, v.state.selection.main.to) === "under"
  );
}
// choose the smallest enclosing underline pair when underlines are nested
{
  const text = "<u>outer <u>inner</u></u>";
  const from = text.indexOf("inner");
  const v = makeView(text, from, from + "inner".length);
  toggleUnderline(v);
  ok(
    "smallest underline pair removed",
    v.state.doc.toString() === "<u>outer inner</u>",
    v.state.doc.toString()
  );
}
// link
{
  const v = makeView("click here", 6, 10);
  insertLink(v);
  ok("insert link", v.state.doc.toString() === "click [here]()", v.state.doc.toString());
  ok("cursor inside parens", v.state.selection.main.head === "click [here](".length);
}

/* ---------- slash commands: trigger + insertion ---------- */
class MockEditor {
  constructor(lines) { this.lines = lines; this.cursor = { line: 0, ch: 0 }; }
  getLine(n) { return this.lines[n]; }
  setLine(n, t) { this.lines[n] = t; }
  setCursor(p) { this.cursor = p; }
  replaceRange(text, from, to) {
    const line = this.lines[from.line];
    const head = line.slice(0, from.ch);
    const tail = this.lines[to.line].slice(to.ch);
    const inserted = (head + text + tail).split("\n");
    this.lines.splice(from.line, to.line - from.line + 1, ...inserted);
  }
  text() { return this.lines.join("\n"); }
}

function makeSuggest() {
  const s = new SlashSuggest({ app: {}, settings: { slashCommands: true } });
  s.plugin = { settings: { slashCommands: true } };
  return s;
}
const cmd = (id) => SLASH_COMMANDS.find((c) => c.id === id);

// onTrigger fires after "/" and captures query
{
  const s = makeSuggest();
  const ed = new MockEditor(["some /hea"]);
  const t = s.onTrigger({ line: 0, ch: 9 }, ed, null);
  ok("trigger fires mid-line", !!t && t.query === "hea" && t.start.ch === 5, JSON.stringify(t));
  const t2 = s.onTrigger({ line: 0, ch: 4 }, new MockEditor(["a/b c"]), null);
  ok("no trigger inside word", t2 === null, JSON.stringify(t2));
}
// heading command converts the line and strips old prefix
{
  const s = makeSuggest();
  const ed = new MockEditor(["- was a list /h1"]);
  s.context = { editor: ed, start: { line: 0, ch: 13 }, end: { line: 0, ch: 16 } };
  s.selectSuggestion(cmd("h1"), {});
  ok("h1 converts list line", ed.text() === "# was a list ", JSON.stringify(ed.text()));
}
// code block inserts fence with cursor on language slot
{
  const s = makeSuggest();
  const ed = new MockEditor(["/code"]);
  s.context = { editor: ed, start: { line: 0, ch: 0 }, end: { line: 0, ch: 5 } };
  s.selectSuggestion(cmd("code"), {});
  ok("code fence inserted", ed.text() === "```\n\n```", JSON.stringify(ed.text()));
  ok("cursor after opening fence", ed.cursor.line === 0 && ed.cursor.ch === 3, JSON.stringify(ed.cursor));
}
// table inserts a padded 3-column skeleton, cursor in first header cell
{
  const s = makeSuggest();
  const ed = new MockEditor(["/table"]);
  s.context = { editor: ed, start: { line: 0, ch: 0 }, end: { line: 0, ch: 6 } };
  s.selectSuggestion(cmd("table"), {});
  ok(
    "table inserted",
    ed.text() ===
      "|     |     |     |\n| --- | --- | --- |\n|     |     |     |\n|     |     |     |",
    JSON.stringify(ed.text())
  );
  ok("cursor in first cell", ed.cursor.line === 0 && ed.cursor.ch === 2, JSON.stringify(ed.cursor));
}
// filtering
{
  const s = makeSuggest();
  const got = s.getSuggestions({ query: "cal" }).map((c) => c.id);
  ok("filter 'cal' finds callout", got.includes("callout"), JSON.stringify(got));
  const links = s.getSuggestions({ query: "link" }).map((c) => c.id);
  ok("English link keyword finds internal link", links.includes("wikilink"), JSON.stringify(links));
}
// Chinese keywords filter the slash menu in any UI language
{
  const s = makeSuggest();
  const got = s.getSuggestions({ query: "标题" }).map((c) => c.id);
  ok("Chinese keyword finds headings", got.includes("h1") && got.includes("h3"), JSON.stringify(got));
  const got2 = s.getSuggestions({ query: "表格" }).map((c) => c.id);
  ok("Chinese keyword finds table", got2.includes("table"), JSON.stringify(got2));
  const got3 = s.getSuggestions({ query: "待办" }).map((c) => c.id);
  ok("Chinese keyword finds todo", got3.includes("todo"), JSON.stringify(got3));
}
// "/" right after CJK text triggers (no space needed)
{
  const s = makeSuggest();
  const t = s.onTrigger({ line: 0, ch: 3 }, new MockEditor(["中文/"]), null);
  ok("trigger after CJK char", !!t && t.start.ch === 2, JSON.stringify(t));
  const t2 = s.onTrigger({ line: 0, ch: 6 }, new MockEditor(["中文/hea"]), null);
  ok("CJK trigger captures query", !!t2 && t2.query === "hea", JSON.stringify(t2));
  const t3 = s.onTrigger({ line: 0, ch: 5 }, new MockEditor(["中文/表格"]), null);
  ok("Chinese query is typable", !!t3 && t3.query === "表格", JSON.stringify(t3));
}
// "/" inside a code fence must NOT trigger
{
  const s = makeSuggest();
  const ed = new MockEditor(["```", "/co", "```"]);
  ed.cm = { state: EditorState.create({ doc: "```\n/co\n```" }) };
  const t = s.onTrigger({ line: 1, ch: 3 }, ed, null);
  ok("no trigger inside code fence", t === null, JSON.stringify(t));
}
// divider under text keeps a blank line (no setext heading)
{
  const s = makeSuggest();
  const ed = new MockEditor(["some text", "/div"]);
  s.context = { editor: ed, start: { line: 1, ch: 0 }, end: { line: 1, ch: 4 } };
  s.selectSuggestion(cmd("divider"), {});
  ok("divider keeps blank line above", ed.text() === "some text\n\n---\n", JSON.stringify(ed.text()));
}
// divider on a line already below a blank stays as-is
{
  const s = makeSuggest();
  const ed = new MockEditor(["some text", "", "/div"]);
  s.context = { editor: ed, start: { line: 2, ch: 0 }, end: { line: 2, ch: 4 } };
  s.selectSuggestion(cmd("divider"), {});
  ok("divider after blank unchanged", ed.text() === "some text\n\n---\n", JSON.stringify(ed.text()));
}


// bold+italic: italic toggles cleanly on and off around bold
{
  const v = makeView("***hello*** world", 3, 8); // selects "hello"
  toggleWrap(v, "*");
  ok("italic off keeps bold", v.state.doc.toString() === "**hello** world", v.state.doc.toString());
}

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILURES`);
process.exit(fail);
