import { Text } from "@codemirror/state";
import {
  batchToggleFormatChanges,
  lineContentSpan,
} from "./bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
};

const doc = (...lines) => Text.of(lines);

/** Apply BlockTextChange[] to a Text and return the result string. */
function applyChanges(text, changes) {
  const sorted = [...changes].sort((a, b) => b.from - a.from || b.to - a.to);
  let out = text.toString();
  for (const c of sorted) {
    out = out.slice(0, c.from) + (c.insert ?? "") + out.slice(c.to);
  }
  return out;
}

const BOLD = { marker: "**", open: "<b>", close: "</b>" };
const ITALIC = { marker: "*", open: "<i>", close: "</i>" };
const UNDER = { open: "<u>", close: "</u>" };

/* ---------- lineContentSpan ---------- */

{
  const s = lineContentSpan("plain text");
  ok("span: plain line", s && s.from === 0 && s.to === 10, JSON.stringify(s));
}
{
  const s = lineContentSpan("## Heading ");
  ok("span: heading skips prefix and trailing space",
    s && s.from === 3 && s.to === 10, JSON.stringify(s));
}
{
  const s = lineContentSpan("  - [ ] task");
  ok("span: nested task prefix", s && s.from === 8 && s.to === 12, JSON.stringify(s));
}
{
  ok("span: blank line is null", lineContentSpan("   ") === null);
  ok("span: bare list marker is null", lineContentSpan("- ") === null);
  ok("span: callout header is null", lineContentSpan("> [!note] Title") === null);
}

/* ---------- batchToggleFormatChanges: wrapping ---------- */

{
  const d = doc("one", "two");
  const blocks = [
    { startLine: 1, endLine: 1 },
    { startLine: 2, endLine: 2 },
  ];
  const r = batchToggleFormatChanges(d, blocks, BOLD, []);
  ok("bold: wraps every line", applyChanges(d, r.changes) === "**one**\n**two**",
    applyChanges(d, r.changes));
  ok("bold: reports add", r.removed === false && r.skipped === 0);
}

{
  const d = doc("# Title", "- item");
  const blocks = [
    { startLine: 1, endLine: 1 },
    { startLine: 2, endLine: 2 },
  ];
  const r = batchToggleFormatChanges(d, blocks, BOLD, []);
  ok("bold: wraps content after prefixes",
    applyChanges(d, r.changes) === "# **Title**\n- **item**",
    applyChanges(d, r.changes));
}

{
  // Mixed state: only unformatted lines gain the format.
  const d = doc("**done**", "todo");
  const blocks = [
    { startLine: 1, endLine: 1 },
    { startLine: 2, endLine: 2 },
  ];
  const r = batchToggleFormatChanges(d, blocks, BOLD, []);
  ok("bold: mixed wraps the rest only",
    applyChanges(d, r.changes) === "**done**\n**todo**",
    applyChanges(d, r.changes));
}

{
  // All formatted → toggle off.
  const d = doc("**one**", "- **two**");
  const blocks = [
    { startLine: 1, endLine: 1 },
    { startLine: 2, endLine: 2 },
  ];
  const r = batchToggleFormatChanges(d, blocks, BOLD, []);
  ok("bold: full coverage toggles off",
    applyChanges(d, r.changes) === "one\n- two",
    applyChanges(d, r.changes));
  ok("bold: reports removal", r.removed === true);
}

{
  // Italic on bold text adds a third star, not a false "already italic".
  const d = doc("**bold**");
  const r = batchToggleFormatChanges(d, [{ startLine: 1, endLine: 1 }], ITALIC, []);
  ok("italic: bold text gains italic",
    applyChanges(d, r.changes) === "***bold***",
    applyChanges(d, r.changes));
}

{
  // Italic removal keeps a bold layer intact.
  const d = doc("***both***");
  const r = batchToggleFormatChanges(d, [{ startLine: 1, endLine: 1 }], ITALIC, []);
  ok("italic: removal keeps bold",
    applyChanges(d, r.changes) === "**both**",
    applyChanges(d, r.changes));
}

{
  // HTML-only underline.
  const d = doc("hello");
  const r = batchToggleFormatChanges(d, [{ startLine: 1, endLine: 1 }], UNDER, []);
  ok("underline: wraps with tags",
    applyChanges(d, r.changes) === "<u>hello</u>",
    applyChanges(d, r.changes));
  const d2 = doc("<u>hello</u>");
  const r2 = batchToggleFormatChanges(d2, [{ startLine: 1, endLine: 1 }], UNDER, []);
  ok("underline: toggles off",
    applyChanges(d2, r2.changes) === "hello" && r2.removed === true,
    applyChanges(d2, r2.changes));
}

{
  // Lines already carrying plugin HTML tags stay in the HTML family.
  const d = doc("<u>tagged</u>");
  const r = batchToggleFormatChanges(d, [{ startLine: 1, endLine: 1 }], BOLD, []);
  ok("bold: html line uses <b>",
    applyChanges(d, r.changes) === "<b><u>tagged</u></b>",
    applyChanges(d, r.changes));
}

{
  // <b>-wrapped counts as bold for the toggle, and comes off cleanly.
  const d = doc("<b>one</b>", "**two**");
  const blocks = [
    { startLine: 1, endLine: 1 },
    { startLine: 2, endLine: 2 },
  ];
  const r = batchToggleFormatChanges(d, blocks, BOLD, []);
  ok("bold: mixed md/html removal",
    applyChanges(d, r.changes) === "one\ntwo" && r.removed === true,
    applyChanges(d, r.changes));
}

{
  // Tables and fences are skipped, other blocks still format.
  const d = doc("| a | b |", "text");
  const blocks = [
    { startLine: 1, endLine: 1 },
    { startLine: 2, endLine: 2 },
  ];
  const r = batchToggleFormatChanges(d, blocks, BOLD, []);
  ok("skip: table reported",
    r.skipped === 1 && applyChanges(d, r.changes) === "| a | b |\n**text**",
    applyChanges(d, r.changes));
}

{
  const d = doc("```", "code", "```");
  const fences = [
    { startLine: 1, endLine: 3, indent: 0, closed: true, marker: "```", bodyPrefix: "" },
  ];
  const r = batchToggleFormatChanges(
    d,
    [{ startLine: 1, endLine: 3 }],
    BOLD,
    fences
  );
  ok("skip: fence untouched", r.changes.length === 0 && r.skipped === 1);
}

{
  // Multi-line quote block: every line's content wraps, callout header spared.
  const d = doc("> [!note] Head", "> body text");
  const r = batchToggleFormatChanges(d, [{ startLine: 1, endLine: 2 }], BOLD, []);
  ok("quote: body wraps, header spared",
    applyChanges(d, r.changes) === "> [!note] Head\n> **body text**",
    applyChanges(d, r.changes));
}

{
  // Blank lines inside the span are ignored, not wrapped.
  const d = doc("one", "", "two");
  const r = batchToggleFormatChanges(d, [{ startLine: 1, endLine: 3 }], BOLD, []);
  ok("blank lines ignored",
    applyChanges(d, r.changes) === "**one**\n\n**two**",
    applyChanges(d, r.changes));
}

process.exit(fail ? 1 : 0);
