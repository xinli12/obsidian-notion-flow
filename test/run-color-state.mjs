import { EditorState, EditorSelection } from "@codemirror/state";
import {
  currentInlineColor,
  currentColorCss,
  paletteChoice,
  ariaKeyshortcuts,
  TEXT_COLORS,
  BG_COLORS,
} from "./bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
};
const state = (text, from, to = from) =>
  EditorState.create({ doc: text, selection: EditorSelection.single(from, to) });

const red = TEXT_COLORS[1];
const blue = TEXT_COLORS[6];
const yellow = BG_COLORS[3];
const spanRed = `<span style="color:${red}">`;
const spanBlue = `<span style="color:${blue}">`;
const markYellow = `<mark style="background:${yellow};color:inherit">`;

// Inside a run: the palette name, whether the selection hugs the tags or
// sits in the middle of the words.
{
  const text = `${spanRed}hello world</span> tail`;
  ok("caret inside a run", currentInlineColor(state(text, spanRed.length + 2), "color") === "red");
  ok(
    "selection inside a run",
    currentInlineColor(state(text, spanRed.length + 1, spanRed.length + 4), "color") === "red"
  );
  ok(
    "selection hugging the tags",
    currentInlineColor(state(text, spanRed.length, spanRed.length + "hello world".length), "color") === "red"
  );
  ok("outside the run", currentInlineColor(state(text, text.length - 2), "color") === null);
  ok("a text run is not a highlight", currentInlineColor(state(text, spanRed.length + 2), "bg") === null);
  ok(
    "selection crossing the closing tag",
    currentInlineColor(state(text, spanRed.length + 2, text.length), "color") === null
  );
}
// Nested runs: the innermost pair wins.
{
  const text = `${spanRed}aa ${spanBlue}bb</span> cc</span>`;
  const inner = spanRed.length + 3 + spanBlue.length;
  ok("innermost pair", currentInlineColor(state(text, inner, inner + 2), "color") === "blue");
  ok("outer pair beside the inner one", currentInlineColor(state(text, spanRed.length + 1), "color") === "red");
  ok(
    "selection spanning both leaves only the outer",
    currentInlineColor(state(text, spanRed.length + 1, inner + 1), "color") === "red"
  );
}
// Highlights: palette marks, the theme's own highlight over HTML, and ==.
{
  const text = `${markYellow}note this</mark> and ==that== too`;
  ok("mark run", currentInlineColor(state(text, markYellow.length + 1), "bg") === "yellow");
  ok("mark run is not a text colour", currentInlineColor(state(text, markYellow.length + 1), "color") === null);
  const theme = `<mark style="background:var(--text-highlight-bg);color:inherit">x</mark>`;
  ok("theme highlight mark reads as default", currentInlineColor(state(theme, theme.indexOf(">x") + 1), "bg") === "default");
  const eq = text.indexOf("that");
  ok("== around the selection reads as default", currentInlineColor(state(text, eq, eq + 4), "bg") === "default");
  ok("== with a caret only is nothing", currentInlineColor(state(text, eq + 1), "bg") === null);
}
// Multi-line selections and comment anchors never count.
{
  const text = `${spanRed}one\ntwo</span>`;
  ok("selection spanning lines", currentInlineColor(state(text, spanRed.length, text.length - 7), "color") === null);
  const cmt = `<span class="nf-cmt" data-nf-cmt="hi">word</span>`;
  ok("comment anchor is not a colour", currentInlineColor(state(cmt, cmt.indexOf("word") + 1), "color") === null);
  const raw = `<span style="color:#123456">odd</span>`;
  ok("non-palette colour comes back raw", currentInlineColor(state(raw, raw.indexOf("odd") + 1), "color") === "#123456");
}
// The CSS the toolbar paints its current-colour bar with.
{
  ok("css for a palette text colour", currentColorCss("red", "color") === TEXT_COLORS[1]);
  ok("css for a palette highlight", currentColorCss("yellow", "bg") === BG_COLORS[3]);
  ok("css for the default highlight", currentColorCss("default", "bg") === "var(--text-highlight-bg)");
  ok("css for a raw colour", currentColorCss("#123456", "color") === "#123456");
  ok("css for nothing", currentColorCss(null, "color") === null);
}
// Stored last-used colours are validated before they reach a swatch.
{
  ok("palette name is kept", paletteChoice("green", "color") === "green");
  ok("default highlight is kept", paletteChoice("default", "bg") === "default");
  ok("default means nothing for text", paletteChoice("default", "color") === null);
  ok("unknown name is dropped", paletteChoice("magenta", "bg") === null);
  ok("null is dropped", paletteChoice(null, "color") === null);
}
// aria-keyshortcuts spells the platform modifier.
{
  ok("Mod on a Mac is Meta", ariaKeyshortcuts("Mod+Shift+H", true) === "Meta+Shift+H");
  ok("Mod elsewhere is Control", ariaKeyshortcuts("Mod+B", false) === "Control+B");
  ok("backslash chord", ariaKeyshortcuts("Mod+\\", false) === "Control+\\");
}

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILURES`);
process.exit(fail);
