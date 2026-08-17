/**
 * Heading markers concealed on the active line.
 *
 * The risk in hiding structure the caret is sitting on is that it becomes
 * unreachable: a marker you cannot see, cannot step into, and cannot
 * delete is worse than one that never hid. These checks pin what stays
 * visible and where the marker comes back.
 */
import { EditorState } from "@codemirror/state";
import {
  collectHeadingPrefixes,
  headingPrefixHidden,
  headingMarkerDeletePlan,
  scanFences,
} from "./bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));

const docOf = (lines) => EditorState.create({ doc: lines.join("\n") }).doc;
const all = (lines) => {
  const doc = docOf(lines);
  return collectHeadingPrefixes(doc, 0, doc.length, scanFences(doc));
};
/** The marker text each collected prefix covers. */
const covered = (lines) => {
  const doc = docOf(lines);
  return all(lines).map((p) => JSON.stringify(doc.sliceString(p.from, p.to)));
};
const at = (lines, lineNo, ch) => docOf(lines).line(lineNo).from + ch;
const caret = (pos) => [{ from: pos, to: pos }];

/* ------------------------------------------------------------------ */
/* What counts as a concealable marker                                 */
/* ------------------------------------------------------------------ */

{
  const lines = [
    "# One",
    "###### Six",
    "####### Seven",
    "#NoSpace",
    "#",
    "# ",
    "  ### Indented",
    "not a heading",
    "> # Quoted",
    "```",
    "# in code",
    "```",
  ];
  eq("only real ATX headings are collected", covered(lines), [
    '"# "',
    '"###### "',
    '"### "',
    '"# "',
  ]);

  const doc = docOf(lines);
  const prefixes = all(lines);
  // The indented heading's marker starts after its own indentation, and
  // the quoted one after its container's "> ".
  eq(
    "a marker starts at the #, not at the line",
    prefixes.map((p) => p.from - doc.lineAt(p.from).from),
    [0, 0, 2, 2]
  );
}

{
  // "# " with nothing after it is a heading being typed. Hiding it would
  // empty the row and make the next keystroke unexplainable.
  eq("a marker with no text yet stays visible", covered(["# "]), []);
  eq("a bare # stays visible", covered(["#"]), []);
}

{
  // Seven hashes is not a heading in CommonMark, and neither is a hash
  // with no space after it.
  eq("seven hashes is not a heading", covered(["####### x"]), []);
  eq("a hash with no space is not a heading", covered(["#tag"]), []);
}

{
  // Four spaces of indentation is an indented code block, not a heading.
  eq("three spaces still a heading", covered(["   # x"]), ['"# "']);
  eq("four spaces is code, not a heading", covered(["    # x"]), []);
}

/* ------------------------------------------------------------------ */
/* Where the marker comes back                                         */
/* ------------------------------------------------------------------ */

{
  const lines = ["## Title", "body"];
  const [prefix] = all(lines);
  const line = docOf(lines).line(1);

  ok(
    "hidden with the caret where typing leaves it",
    headingPrefixHidden(prefix, caret(line.from + 3))
  );
  ok(
    "hidden with the caret further into the text",
    headingPrefixHidden(prefix, caret(line.from + 6))
  );
  ok(
    "hidden with the caret on another line",
    headingPrefixHidden(prefix, caret(at(lines, 2, 2)))
  );
  ok(
    "revealed with the caret in front of the text",
    !headingPrefixHidden(prefix, caret(line.from))
  );
  ok(
    "revealed by a selection reaching into it",
    !headingPrefixHidden(prefix, [{ from: line.from + 1, to: line.from + 5 }])
  );
  ok(
    "revealed by a selection covering the whole line",
    !headingPrefixHidden(prefix, [{ from: line.from, to: line.to }])
  );
}

/* ------------------------------------------------------------------ */
/* Getting back out                                                    */
/* ------------------------------------------------------------------ */

/** Apply a delete plan and return the resulting rows. */
const applyPlan = (lines, plan) => {
  const text = lines.join("\n");
  return plan
    ? (text.slice(0, plan.from) + plan.insert + text.slice(plan.to)).split("\n")
    : null;
};

{
  // Backspace at the heading text takes the whole marker, not one "#":
  // deleting one would leave a heading a level down that nobody chose.
  const lines = ["## Title", "body"];
  const doc = docOf(lines);
  const plan = headingMarkerDeletePlan(doc, at(lines, 1, 3));
  eq("Backspace at the text start unwrites the heading", applyPlan(lines, plan), [
    "Title",
    "body",
  ]);
}

{
  // Anywhere but the text start it is an ordinary Backspace.
  const lines = ["## Title"];
  const doc = docOf(lines);
  ok(
    "mid-word Backspace is left alone",
    headingMarkerDeletePlan(doc, at(lines, 1, 6)) === null
  );
  ok(
    "Backspace in front of a revealed marker is left alone",
    headingMarkerDeletePlan(doc, at(lines, 1, 1)) === null
  );
}

{
  // Inside a Callout only the heading's own marker goes; the container's
  // "> " is not this key's to remove.
  const lines = ["> # Quoted"];
  const doc = docOf(lines);
  const plan = headingMarkerDeletePlan(doc, at(lines, 1, 4));
  eq("a quoted heading keeps its container", applyPlan(lines, plan), ["> Quoted"]);
}

{
  const lines = ["plain text"];
  ok(
    "a paragraph has no marker to remove",
    headingMarkerDeletePlan(docOf(lines), at(lines, 1, 0)) === null
  );
}

if (fail) process.exit(1);
console.log("ALL PASS");
