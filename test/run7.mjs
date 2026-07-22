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
// clear formatting: markdown + color spans + underline HTML
{
  const text = '**bold** and <span style="color:#eb5757">red</span> plus <u>under</u>';
  const v = mk(text, 0, text.length);
  clearInlineFormatting(v);
  ok(
    "clear strips everything",
    v.state.doc.toString() === "bold and red plus under",
    v.state.doc.toString()
  );
}
// clear formatting when selection surrounded by markers
{
  const v = mk("**word**", 2, 6);
  clearInlineFormatting(v);
  ok("clear unwraps surrounding bold", v.state.doc.toString() === "word", v.state.doc.toString());
}
// Reverse wrapper orders both clear completely. A one-pass peel leaves the
// outer bold/span behind after removing the inner underline.
{
  const text = "**<u>word</u>**";
  const from = text.indexOf("word");
  const v = mk(text, from, from + "word".length);
  clearInlineFormatting(v);
  ok("clear reverse nested bold + underline", v.state.doc.toString() === "word", v.state.doc.toString());
}
{
  const text = '<span style="color:red"><u>word</u></span>';
  const from = text.indexOf("word");
  const v = mk(text, from, from + "word".length);
  clearInlineFormatting(v);
  ok("clear reverse nested color + underline", v.state.doc.toString() === "word", v.state.doc.toString());
}
// The underline tag alternative must be exact: <ul> and arbitrary custom
// elements are content, not formatting wrappers owned by the toolbar.
{
  const text = "<ul><li>item</li></ul> <unknown>keep</unknown>";
  const v = mk(text, 0, text.length);
  clearInlineFormatting(v);
  ok("clear preserves unrelated HTML", v.state.doc.toString() === text, v.state.doc.toString());
}
// A partial selection removes the WHOLE intersecting pair — no orphans.
{
  const text = "**bold text** tail";
  const v = mk(text, text.indexOf("text"), text.length);
  clearInlineFormatting(v);
  ok(
    "clear partial selection leaves no orphan markers",
    v.state.doc.toString() === "bold text tail",
    v.state.doc.toString()
  );
}
// Underscore emphasis is bold/italic too.
{
  const v = mk("_italic_ x", 1, 7);
  clearInlineFormatting(v);
  ok("clear underscore italics", v.state.doc.toString() === "italic x", v.state.doc.toString());
}
// Comments are notes, not formatting — the anchor stays, formats inside go.
{
  const text = '<span class="nf-cmt" data-nf-cmt="n">**word**</span>';
  const from = text.indexOf("word");
  const v = mk(text, from, from + 4);
  clearInlineFormatting(v);
  ok(
    "clear keeps comment anchors",
    v.state.doc.toString() === '<span class="nf-cmt" data-nf-cmt="n">word</span>',
    v.state.doc.toString()
  );
}
ok("palette has 9 text colors", TEXT_COLORS.length === 9);
ok("gray text follows Obsidian muted ink", TEXT_COLORS[0] === "var(--text-muted)");

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILURES`);
process.exit(fail);
