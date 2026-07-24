import { EditorState, EditorSelection } from "@codemirror/state";
import {
  convertAdjacentMarkersToTags,
  enclosingTagPairIn,
  isDualFormatActive,
  isUnderlineActive,
  rangeTouchesHtmlPairIn,
  toggleDualFormat,
  toggleHtmlWrap,
  toggleUnderline,
} from "./bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
};

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

const MARK_OPEN =
  '<mark style="background:var(--text-highlight-bg);color:inherit">';

/* ---------- format coexistence: everything stays in one family ---------- */

// underline over markdown bold converts the ** layer to <b>
{
  const v = makeView("**text** end", 2, 6);
  toggleUnderline(v);
  ok(
    "U over **bold** converts to tags",
    v.state.doc.toString() === "<b><u>text</u></b> end",
    v.state.doc.toString()
  );
  const sel = v.state.selection.main;
  ok(
    "U over **bold** keeps text selected",
    v.state.doc.sliceString(sel.from, sel.to) === "text",
    v.state.doc.sliceString(sel.from, sel.to)
  );
}

// underline over stacked markdown layers converts them all, inner→outer
{
  const v = makeView("~~**text**~~ end", 4, 8);
  toggleUnderline(v);
  ok(
    "U over ~~**x**~~ converts both layers",
    v.state.doc.toString() === "<s><b><u>text</u></b></s> end",
    v.state.doc.toString()
  );
}

// *** run peels as ** then *
{
  const v = makeView("***text*** end", 3, 7);
  toggleUnderline(v);
  ok(
    "U over ***x*** peels bold then italic",
    v.state.doc.toString() === "<i><b><u>text</u></b></i> end",
    v.state.doc.toString()
  );
}

// == highlight converts to the theme mark tag
{
  const v = makeView("==text== end", 2, 6);
  toggleUnderline(v);
  ok(
    "U over ==x== converts highlight to mark",
    v.state.doc.toString() === `${MARK_OPEN}<u>text</u></mark> end`,
    v.state.doc.toString()
  );
}

// underline toggle-off through an inner tag
{
  const v = makeView("<u><b>text</b></u> end", 6, 10);
  toggleUnderline(v);
  ok(
    "U off through inner <b>",
    v.state.doc.toString() === "<b>text</b> end",
    v.state.doc.toString()
  );
}
{
  const state = EditorState.create({
    doc: "<u><b>text</b></u>",
    selection: EditorSelection.single(6, 10),
  });
  ok("underline active through inner <b>", isUnderlineActive(state));
}

// bold via toolbar on underlined text uses <b>, not **
{
  const v = makeView("<u>text</u> end", 3, 7);
  toggleDualFormat(v, "**", "<b>", "</b>");
  ok(
    "B inside <u> writes <b>",
    v.state.doc.toString() === "<u><b>text</b></u> end",
    v.state.doc.toString()
  );
}

// second press toggles the <b> back off
{
  const v = makeView("<u><b>text</b></u> end", 6, 10);
  toggleDualFormat(v, "**", "<b>", "</b>");
  ok(
    "B off when <b> hugs selection",
    v.state.doc.toString() === "<u>text</u> end",
    v.state.doc.toString()
  );
}

// toggle-off sees the <b> pair through an inner <u>
{
  const v = makeView("<b><u>text</u></b> end", 6, 10);
  toggleDualFormat(v, "**", "<b>", "</b>");
  ok(
    "B off through inner <u>",
    v.state.doc.toString() === "<u>text</u> end",
    v.state.doc.toString()
  );
}

// bold on a selection containing a color span stays HTML
{
  const doc = '<span style="color:var(--color-red)">red</span> tail';
  const v = makeView(doc, 0, 47);
  toggleDualFormat(v, "**", "<b>", "</b>");
  ok(
    "B around a span uses <b>",
    v.state.doc.toString() === `<b>${doc.slice(0, 47)}</b> tail`,
    v.state.doc.toString()
  );
}

// plain text still gets markdown markers
{
  const v = makeView("plain text", 0, 5);
  toggleDualFormat(v, "**", "<b>", "</b>");
  ok(
    "B on plain text stays markdown",
    v.state.doc.toString() === "**plain** text",
    v.state.doc.toString()
  );
}

// partial selection deep inside a <u> pair also stays HTML
{
  const v = makeView("<u>some long text</u>", 8, 12);
  toggleDualFormat(v, "**", "<b>", "</b>");
  ok(
    "B on part of underlined text nests <b> inside <u>",
    v.state.doc.toString() === "<u>some <b>long</b> text</u>",
    v.state.doc.toString()
  );
}

// active-state detection through tags
{
  const state = EditorState.create({
    doc: "<b><u>text</u></b>",
    selection: EditorSelection.single(6, 10),
  });
  ok(
    "bold active through inner <u>",
    isDualFormatActive(state, "**", "<b>", "</b>")
  );
}
{
  const state = EditorState.create({
    doc: "**text**",
    selection: EditorSelection.single(2, 6),
  });
  ok(
    "bold active on markdown markers",
    isDualFormatActive(state, "**", "<b>", "</b>")
  );
}

/* ---------- helpers ---------- */

{
  const source = "<u>abc</u> plain";
  ok("touches: inside pair", rangeTouchesHtmlPairIn(source, 4, 6));
  ok("touches: outside pair", !rangeTouchesHtmlPairIn(source, 11, 16));
}
{
  const source = "<u>a <u>b</u> c</u>";
  const pair = enclosingTagPairIn(source, 8, 9, "<u>", "</u>");
  ok("enclosing picks the smallest pair", pair !== null && pair.open.from === 5);
}

// convertAdjacentMarkersToTags is a no-op without adjacent markers
{
  const v = makeView("plain text", 0, 5);
  convertAdjacentMarkersToTags(v);
  ok(
    "convert no-op on plain text",
    v.state.doc.toString() === "plain text",
    v.state.doc.toString()
  );
}

// toggleHtmlWrap does not nest a duplicate pair
{
  const v = makeView("<u>text</u>", 3, 7);
  toggleHtmlWrap(v, "<u>", "</u>");
  ok(
    "toggleHtmlWrap unwraps instead of nesting",
    v.state.doc.toString() === "text",
    v.state.doc.toString()
  );
}

if (fail > 0) process.exit(1);
console.log("ALL PASS");
