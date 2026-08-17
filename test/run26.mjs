import {
  TOGGLE_TYPE,
  buildToggleTemplate,
  buildToggleWrap,
  parseToggleHeader,
  setToggleCollapsed,
  toggleTitleFromLine,
} from "./bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));

/* The fold marker carries the open state, so it round-trips through the
   note instead of living in workspace state the way list folding does. */
{
  eq("collapsed toggle parses", parseToggleHeader("> [!nf-toggle]- Title"), {
    prefix: "> ",
    collapsed: true,
    title: "Title",
    tokenFrom: 2,
    tokenTo: 16,
  });
  eq("expanded toggle parses", parseToggleHeader("> [!nf-toggle]+ Title"), {
    prefix: "> ",
    collapsed: false,
    title: "Title",
    tokenFrom: 2,
    tokenTo: 16,
  });
  ok(
    "a marker-less toggle counts as open",
    parseToggleHeader("> [!nf-toggle] Title")?.collapsed === false
  );
  eq("nested toggle keeps its own prefix", parseToggleHeader("> > [!nf-toggle]- x"), {
    prefix: "> > ",
    collapsed: true,
    title: "x",
    tokenFrom: 4,
    tokenTo: 18,
  });
  ok(
    "the token range covers exactly the scaffolding",
    (() => {
      const text = "> [!nf-toggle]- Title";
      const h = parseToggleHeader(text);
      return (
        text.slice(h.tokenFrom, h.tokenTo) === "[!nf-toggle]- " &&
        text.slice(h.tokenTo) === h.title
      );
    })()
  );
  ok("type is matched case-insensitively", parseToggleHeader("> [!NF-Toggle]- x") != null);
  ok("another callout is not a toggle", parseToggleHeader("> [!note]- x") == null);
  ok("a plain quote is not a toggle", parseToggleHeader("> text") == null);
}

/* Collapsing rewrites only the marker; the title survives untouched, and
   a toggle written without a marker gains one. */
{
  ok(
    "collapse sets the marker",
    setToggleCollapsed("> [!nf-toggle]+ Title", true) === "> [!nf-toggle]- Title"
  );
  ok(
    "expand sets the marker",
    setToggleCollapsed("> [!nf-toggle]- Title", false) === "> [!nf-toggle]+ Title"
  );
  ok(
    "a marker-less toggle gains one",
    setToggleCollapsed("> [!nf-toggle] Title", true) === "> [!nf-toggle]- Title"
  );
  ok(
    "an empty title stays empty",
    setToggleCollapsed("> [!nf-toggle]+ ", true) === "> [!nf-toggle]- "
  );
  ok("not a toggle → null", setToggleCollapsed("> [!note]- x", true) == null);
}

/* Turning a block into a toggle keeps its text as the title. The old
   block's own scaffolding (quote markers, list marker, hashes, task box)
   belonged to that block, not to the sentence. */
{
  ok("bullet marker dropped", toggleTitleFromLine("- Item") === "Item");
  ok("ordered marker dropped", toggleTitleFromLine("  12) Item") === "Item");
  ok("task box dropped", toggleTitleFromLine("- [x] Done") === "Done");
  ok("heading hashes dropped", toggleTitleFromLine("### Heading") === "Heading");
  ok("quote markers dropped", toggleTitleFromLine("> > Quoted") === "Quoted");
  ok("plain text survives", toggleTitleFromLine("  Just text  ") === "Just text");
  ok("a lone dash is not a marker", toggleTitleFromLine("---") === "---");
}

/* The wrap keeps the first line as the title and re-prefixes the rest as
   content; a single-line block gets one empty body row to type into. */
{
  eq("single line gets an empty body", buildToggleWrap(["Title"]), [
    "> [!nf-toggle]+ Title",
    "> ",
  ]);
  eq(
    "following lines become content",
    buildToggleWrap(["Title", "first", "", "second"]),
    ["> [!nf-toggle]+ Title", "> first", ">", "> second"]
  );
  eq(
    "content is dedented to the block's own column",
    buildToggleWrap(["- Item", "  child", "  more"]),
    ["> [!nf-toggle]+ Item", "> child", "> more"]
  );
  eq("a trailing blank is not carried in", buildToggleWrap(["Title", "body", ""]), [
    "> [!nf-toggle]+ Title",
    "> body",
  ]);
}

/* A fresh toggle opens, so the body row the caret lands in is visible. */
{
  const template = buildToggleTemplate();
  ok("template opens", template.startsWith(`> [!${TOGGLE_TYPE}]+ `), template);
  ok("template marks the caret", template.includes("‸"), template);
  ok(
    "template round-trips through the parser",
    parseToggleHeader(template.split("\n")[0])?.collapsed === false
  );
}

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILURES`);
process.exit(fail);
