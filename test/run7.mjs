import { EditorState, EditorSelection } from "@codemirror/state";
import {
  applyTextColor,
  applyHighlightColor,
  clearInlineFormatting,
  findMathRanges,
  withMathColorClass,
  BG_COLORS,
  TEXT_COLORS,
  enclosingLinkOnLine,
  linkRewriteChange,
  linkUnlinkChange,
} from "./bundle.mjs";

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
ok(
  "every swatch is a plugin var with a hex fallback",
  TEXT_COLORS.every((c) => /^var\(--nf-[a-z]+, #[0-9a-f]{6}\)$/.test(c)),
  TEXT_COLORS.join(" ")
);
ok(
  "highlights tint the same ink",
  BG_COLORS.every((c) => /^rgba\(var\(--nf-[a-z]+-rgb, [\d, ]+\), 0\.\d+\)$/.test(c)),
  BG_COLORS.join(" ")
);
ok(
  "swatch styles fit the conceal parser's charset",
  [...TEXT_COLORS, ...BG_COLORS].every(
    (c) => c.length <= 64 && /^[-\w(),.%# ]+$/.test(c)
  )
);

/* ---------- LaTeX ---------- */
const RED = TEXT_COLORS[1];
const YELLOW = BG_COLORS[3];

{
  const found = findMathRanges("a $x^2$ b $$\\int_0^1 f$$ c");
  ok("finds inline and display math", found.length === 2, JSON.stringify(found));
  ok("inline body excludes delimiters", found[0].bodyFrom === 3 && found[0].bodyTo === 6);
  ok("display math is flagged", found[1].display === true && found[0].display === false);
}
ok("prices are not formulas", findMathRanges("costs $5 and $7 today").length === 0);
ok("code spans are literal", findMathRanges("`$x$` plain").length === 0);
ok(
  "fenced code is literal",
  findMathRanges("```\n$x^2$\n```\n").length === 0
);
ok("escaped dollars are literal", findMathRanges("\\$x\\$ y").length === 0);

// Coloring a formula rewrites its body instead of wrapping it in a span,
// which Live Preview would render as literal dollar signs.
{
  const v = mk("see $E=mc^2$ ok", 4, 12);
  applyTextColor(v, RED);
  ok(
    "formula takes a class, not a span",
    v.state.doc.toString() === "see $\\class{mjx-nf-red}{E=mc^2}$ ok",
    v.state.doc.toString()
  );
}
{
  const v = mk("$\\class{mjx-nf-blue}{x}$", 0, 23);
  applyTextColor(v, RED);
  ok(
    "recoloring replaces the old class",
    v.state.doc.toString() === "$\\class{mjx-nf-red}{x}$",
    v.state.doc.toString()
  );
  applyHighlightColor(v, YELLOW);
  ok(
    "highlight rides alongside the text color",
    v.state.doc.toString() === "$\\class{mjx-nf-red mjx-nfbg-yellow}{x}$",
    v.state.doc.toString()
  );
}
{
  const v = mk("$\\class{mjx-nf-red}{x}$", 0, 23);
  applyTextColor(v, null);
  ok(
    "removing the color unwraps the formula",
    v.state.doc.toString() === "$x$",
    v.state.doc.toString()
  );
}
ok(
  "a hand-written class survives",
  withMathColorClass("\\class{tall}{x}", "color", "red") ===
    "\\class{tall mjx-nf-red}{x}",
  withMathColorClass("\\class{tall}{x}", "color", "red")
);
ok(
  "a class that is not the whole body is left alone",
  withMathColorClass("\\class{tall}{x} + y", "color", "red") ===
    "\\class{mjx-nf-red}{\\class{tall}{x} + y}"
);

// Prose and formula in one selection: tags for the words, class for the math.
{
  const v = mk("see $x^2$ now", 0, 13);
  applyTextColor(v, RED);
  ok(
    "mixed selection keeps the tags off the math",
    v.state.doc.toString() ===
      `<span style="color:${RED}">see</span> $\\class{mjx-nf-red}{x^2}$ <span style="color:${RED}">now</span>`,
    v.state.doc.toString()
  );
  clearInlineFormatting(v);
  ok(
    "clear formatting also unwraps the formula",
    v.state.doc.toString() === "see $x^2$ now",
    v.state.doc.toString()
  );
}

// Link popover helpers: the link the selection sits in, and the changes
// that rewrite or unlink it touching only the link's own span.
{
  const text = "intro\nsee [docs](https://ex.com/a \"Docs\") here\ntail";
  const lineFrom = "intro\n".length;
  const lineText = "see [docs](https://ex.com/a \"Docs\") here";
  const inside = mk(text, lineFrom + 6, lineFrom + 6);
  const link = enclosingLinkOnLine(inside.state);
  ok("caret inside the link finds it", link != null && link.text === "docs" && link.dest === "https://ex.com/a", JSON.stringify(link));
  ok("caret outside the link finds nothing", enclosingLinkOnLine(mk(text, lineFrom + 1, lineFrom + 1).state) == null);
  ok("a selection spanning lines finds nothing", enclosingLinkOnLine(mk(text, 2, lineFrom + 6).state) == null);

  const rewrite = linkRewriteChange(lineFrom, lineText, link, { text: "the docs", dest: "my note.md" });
  ok("rewrite spans exactly the link", rewrite.from === lineFrom + 4 && rewrite.to === lineFrom + 4 + '[docs](https://ex.com/a "Docs")'.length, JSON.stringify(rewrite));
  ok("rewrite wraps a spaced destination and keeps the title", rewrite.insert === '[the docs](<my note.md> "Docs")', rewrite.insert);
  ok("rewrite caret lands after the link", rewrite.caret === rewrite.from + rewrite.insert.length);
  inside.dispatch({ changes: { from: rewrite.from, to: rewrite.to, insert: rewrite.insert } });
  ok(
    "rewritten document keeps the rest of the line",
    inside.state.doc.toString() === 'intro\nsee [the docs](<my note.md> "Docs") here\ntail',
    inside.state.doc.toString()
  );

  const v2 = mk(text, lineFrom + 6, lineFrom + 6);
  const unlink = linkUnlinkChange(lineFrom, lineText, enclosingLinkOnLine(v2.state));
  ok("unlink replaces the link with its text", unlink.insert === "docs" && unlink.from === lineFrom + 4, JSON.stringify(unlink));
  v2.dispatch({ changes: { from: unlink.from, to: unlink.to, insert: unlink.insert } });
  ok("unlinked document", v2.state.doc.toString() === "intro\nsee docs here\ntail", v2.state.doc.toString());
  ok("unlink caret covers the text end", unlink.caret === unlink.from + 4);
}

// Mid-run recolour / removal: the selection sits inside a colour run but
// does not hug its tags, so the run is split around the selected words.
{
  const red = TEXT_COLORS[1];
  const blue = TEXT_COLORS[6];
  const text = `<span style="color:${red}">hello big world</span> tail`;
  const open = `<span style="color:${red}">`;
  const from = open.length + "hello ".length;
  const to = from + "big".length;
  const v = mk(text, from, to);
  applyTextColor(v, null);
  ok(
    "remove mid-run splits the span",
    v.state.doc.toString() === `${open}hello </span>big${open} world</span> tail`,
    v.state.doc.toString()
  );
  const sel = v.state.selection.main;
  ok("remove mid-run keeps the words selected", v.state.sliceDoc(sel.from, sel.to) === "big", v.state.sliceDoc(sel.from, sel.to));

  const v2 = mk(text, from, to);
  applyTextColor(v2, blue);
  const blueOpen = `<span style="color:${blue}">`;
  ok(
    "recolor mid-run splits the span around the new colour",
    v2.state.doc.toString() === `${open}hello </span>${blueOpen}big</span>${open} world</span> tail`,
    v2.state.doc.toString()
  );
  const sel2 = v2.state.selection.main;
  ok("recolor mid-run keeps the words selected", v2.state.sliceDoc(sel2.from, sel2.to) === "big", v2.state.sliceDoc(sel2.from, sel2.to));

  // At the run's start: the empty left half is dropped, so the original
  // open tag simply becomes the new colour and the run resumes after.
  const v3 = mk(text, open.length, open.length + "hello".length);
  applyTextColor(v3, blue);
  ok(
    "recolor at run start drops the empty left half",
    v3.state.doc.toString() === `${blueOpen}hello</span>${open} big world</span> tail`,
    v3.state.doc.toString()
  );
  const sel3 = v3.state.selection.main;
  ok("recolor at run start keeps the words selected", v3.state.sliceDoc(sel3.from, sel3.to) === "hello", v3.state.sliceDoc(sel3.from, sel3.to));

  // At the run's end: nothing is reopened after the selection.
  const endFrom = open.length + "hello big ".length;
  const v4 = mk(text, endFrom, endFrom + "world".length);
  applyTextColor(v4, blue);
  ok(
    "recolor at run end drops the empty right half",
    v4.state.doc.toString() === `${open}hello big </span>${blueOpen}world</span> tail`,
    v4.state.doc.toString()
  );
  const v5 = mk(text, endFrom, endFrom + "world".length);
  applyTextColor(v5, null);
  ok(
    "remove at run end closes the run before the words",
    v5.state.doc.toString() === `${open}hello big </span>world tail`,
    v5.state.doc.toString()
  );
}
// The <mark> variant follows the same rules.
{
  const yellow = BG_COLORS[3];
  const green = BG_COLORS[4];
  const open = `<mark style="background:${yellow};color:inherit">`;
  const greenOpen = `<mark style="background:${green};color:inherit">`;
  const text = `${open}one two three</mark>`;
  const from = open.length + "one ".length;
  const v = mk(text, from, from + "two".length);
  applyHighlightColor(v, green);
  ok(
    "mark recolor mid-run",
    v.state.doc.toString() === `${open}one </mark>${greenOpen}two</mark>${open} three</mark>`,
    v.state.doc.toString()
  );
  const v2 = mk(text, from, from + "two".length);
  applyHighlightColor(v2, null);
  ok(
    "mark remove mid-run",
    v2.state.doc.toString() === `${open}one </mark>two${open} three</mark>`,
    v2.state.doc.toString()
  );
  // A selection outside any run still wraps as before.
  const v3 = mk("plain words", 0, 5);
  applyHighlightColor(v3, green);
  ok("no run → wrap", v3.state.doc.toString() === `${greenOpen}plain</mark> words`, v3.state.doc.toString());
}

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILURES`);
process.exit(fail);
