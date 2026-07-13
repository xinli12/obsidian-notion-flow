import { EditorState, EditorSelection } from "@codemirror/state";
import { applyTextColor, applyHighlightColor, clearInlineFormatting, TEXT_COLORS } from "./bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
};
const mk = (text, from, to) => {
  let state = EditorState.create({ doc: text, selection: EditorSelection.single(from, to) });
  return { get state() { return state; }, dispatch(s) { state = state.update(s).state; }, focus() {} };
};

// wrap text color
{
  const v = mk("hello world", 0, 5);
  applyTextColor(v, "#eb5757");
  ok("color wrap", v.state.doc.toString() === '<span style="color:#eb5757">hello</span> world', v.state.doc.toString());
  // selection still on "hello" → recolor in place
  applyTextColor(v, "#2f80ed");
  ok("recolor in place", v.state.doc.toString() === '<span style="color:#2f80ed">hello</span> world', v.state.doc.toString());
  // remove
  applyTextColor(v, null);
  ok("uncolor", v.state.doc.toString() === "hello world", v.state.doc.toString());
}
// highlight color
{
  const v = mk("note this", 0, 4);
  applyHighlightColor(v, "rgba(242,201,76,0.32)");
  ok("mark wrap", v.state.doc.toString() === '<mark style="background:rgba(242,201,76,0.32);color:inherit">note</mark> this', v.state.doc.toString());
  applyHighlightColor(v, null);
  ok("mark unwrap", v.state.doc.toString() === "note this", v.state.doc.toString());
}
// clear formatting: markdown + color spans
{
  const v = mk('**bold** and <span style="color:#eb5757">red</span>', 0, 51);
  clearInlineFormatting(v);
  ok("clear strips everything", v.state.doc.toString() === "bold and red", v.state.doc.toString());
}
// clear formatting when selection surrounded by markers
{
  const v = mk("**word**", 2, 6);
  clearInlineFormatting(v);
  ok("clear unwraps surrounding bold", v.state.doc.toString() === "word", v.state.doc.toString());
}
ok("palette has 8 text colors", TEXT_COLORS.length === 8);

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILURES`);
process.exit(fail);
