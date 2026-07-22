import { Text } from "@codemirror/state";
import {
  scanFences,
  fenceBodyRange,
  fenceEnterPlan,
  fenceBackspacePlan,
  fenceExitPlan,
  findColorTagPairs,
  extractHtmlTitle,
  buildTitledLink,
} from "./bundle.mjs";

let fail = 0;
const check = (name, got, expected) => {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: got ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`
  );
};

/* ---------- scanFences closed flag ---------- */
{
  const doc = Text.of(["```js", "code", "```", "", "```", "tail"]);
  const fences = scanFences(doc);
  check("closed flag on paired fence", fences[0].closed, true);
  check("open flag on trailing fence", fences[1].closed, false);
  check("trailing fence runs to EOF", fences[1].endLine, 6);
}

/* ---------- fenceBodyRange ---------- */
{
  const doc = Text.of(["a", "```", "body", "```", "b"]);
  const body = doc.line(3);
  check(
    "body line is inside",
    fenceBodyRange(doc, body.from, body.to) != null,
    true
  );
  check(
    "opener line is not body",
    fenceBodyRange(doc, doc.line(2).from, doc.line(2).to),
    null
  );
  check(
    "closer line is not body",
    fenceBodyRange(doc, doc.line(4).from, doc.line(4).to),
    null
  );
  check(
    "selection crossing out is not body",
    fenceBodyRange(doc, body.from, doc.line(5).to),
    null
  );
  check("plain line is not body", fenceBodyRange(doc, 0, 1), null);
}

/* ---------- fences inside blockquotes ---------- */
{
  const doc = Text.of(["> before", "> ```js", "> const x = 1;", "> ```", "> after"]);
  const fences = scanFences(doc);
  check("quoted fence recognized", fences.length, 1);
  check("quoted fence range", [fences[0].startLine, fences[0].endLine], [2, 4]);
  check("quoted fence prefix", fences[0].bodyPrefix, "> ");
  check("quoted fence depth", fences[0].quoteDepth, 1);
  const body = doc.line(3);
  check("quoted fence Enter keeps quote", fenceEnterPlan(doc, body.to, fences), {
    from: body.to,
    to: body.to,
    insert: "\n> ",
    cursor: body.to + 3,
  });
  check("quoted fence body formatting detected", fenceBodyRange(doc, body.from + 2, body.to, fences) != null, true);
}
{
  const doc = Text.of(["```", "tail"]);
  const tail = doc.line(2);
  check(
    "unclosed fence body reaches EOF",
    fenceBodyRange(doc, tail.from, tail.to) != null,
    true
  );
}

/* ---------- fenceEnterPlan ---------- */
{
  // Nested in a list: body lines keep their leading indentation.
  const doc = Text.of(["- item", "\t```js", "\tcode();", "\t```"]);
  const body = doc.line(3);
  check("enter keeps indent", fenceEnterPlan(doc, body.to), {
    from: body.to,
    to: body.to,
    insert: "\n\t",
    cursor: body.to + 2,
  });
  check(
    "enter splits after indent",
    fenceEnterPlan(doc, body.from + 5),
    { from: body.from + 5, to: body.from + 5, insert: "\n\t", cursor: body.from + 7 }
  );
  check("enter inside leading ws falls through", fenceEnterPlan(doc, body.from), null);
  const opener = doc.line(2);
  check("enter at closed opener indents body", fenceEnterPlan(doc, opener.to), {
    from: opener.to,
    to: opener.to,
    insert: "\n\t",
    cursor: opener.to + 2,
  });
  check("enter mid-info-string falls through", fenceEnterPlan(doc, opener.to - 1), null);
  const closer = doc.line(4);
  check("enter on closer falls through", fenceEnterPlan(doc, closer.to), null);
  check("enter outside fence falls through", fenceEnterPlan(doc, doc.line(1).to), null);
}
{
  // Unclosed opener auto-closes, keeping list indentation.
  const doc = Text.of(["- item", "\t```js", "\ttext below"]);
  const opener = doc.line(2);
  check("enter auto-closes fresh fence", fenceEnterPlan(doc, opener.to), {
    from: opener.to,
    to: opener.to,
    insert: "\n\t\n\t```",
    cursor: opener.to + 2,
  });
}

/* ---------- fenceBackspacePlan ---------- */
{
  const doc = Text.of(["```", "\t\tdeep", "  two", "flat", "```"]);
  const fences = scanFences(doc);
  const tabUnit = { width: 4, useTab: true };
  const deep = doc.line(2);
  check(
    "backspace removes one tab level",
    fenceBackspacePlan(doc, deep.from + 2, fences, tabUnit),
    { from: deep.from, to: deep.from + 2, insert: "\t", cursor: deep.from + 1 }
  );
  const two = doc.line(3);
  check(
    "partial indent drops to lower stop",
    fenceBackspacePlan(doc, two.from + 2, fences, tabUnit),
    { from: two.from, to: two.from + 2, insert: "", cursor: two.from }
  );
  check(
    "no indent falls through",
    fenceBackspacePlan(doc, doc.line(4).from, fences, tabUnit),
    null
  );
  check(
    "mid-text falls through",
    fenceBackspacePlan(doc, deep.from + 4, fences, tabUnit),
    null
  );
  check(
    "outside fence falls through",
    fenceBackspacePlan(Text.of(["  plain"]), 2, scanFences(Text.of(["  plain"])), tabUnit),
    null
  );
}
{
  const doc = Text.of(["```", "    four", "```"]);
  const spaceUnit = { width: 4, useTab: false };
  const line = doc.line(2);
  check(
    "space unit dedents four columns",
    fenceBackspacePlan(doc, line.from + 4, scanFences(doc), spaceUnit),
    { from: line.from, to: line.from + 4, insert: "", cursor: line.from }
  );
}

/* ---------- fenceExitPlan ---------- */
{
  const doc = Text.of(["- item", "\t```", "\tcode", "\t```", "next"]);
  const body = doc.line(3);
  const closer = doc.line(4);
  check("exit inserts indented line after closer", fenceExitPlan(doc, body.from + 2), {
    from: closer.to,
    to: closer.to,
    insert: "\n\t",
    cursor: closer.to + 2,
  });
}
{
  const doc = Text.of(["```", "code", "```", "", "next"]);
  const blank = doc.line(4);
  check("exit reuses existing blank line", fenceExitPlan(doc, doc.line(2).from), {
    from: blank.to,
    to: blank.to,
    insert: "",
    cursor: blank.to,
  });
}
{
  const doc = Text.of(["\t```js", "\tcode"]);
  const last = doc.line(2);
  check("exit writes missing closer", fenceExitPlan(doc, last.to), {
    from: last.to,
    to: last.to,
    insert: "\n\t```\n\t",
    cursor: last.to + 7,
  });
  check("exit outside fence falls through", fenceExitPlan(Text.of(["plain"]), 0), null);
}

/* ---------- fences opening on a list-marker line ---------- */
{
  const doc = Text.of(["- ```python", "  a", "  ```", "- next"]);
  const fences = scanFences(doc);
  check("item fence recognized", fences.length, 1);
  check("item fence range", [fences[0].startLine, fences[0].endLine], [1, 3]);
  check("item fence markerOpener", fences[0].markerOpener, true);
  check("item fence indent is content column", fences[0].indent, 2);
  check("item fence bodyPrefix", JSON.stringify(fences[0].bodyPrefix), '"  "');
  const body = doc.line(2);
  check(
    "item fence enter keeps content indent",
    fenceEnterPlan(doc, body.to, fences),
    { from: body.to, to: body.to, insert: "\n  ", cursor: body.to + 3 }
  );
}
{
  const doc = Text.of(["\t- ```js", "\t  x"]);
  const fences = scanFences(doc);
  check("tab item fence markerOpener", fences[0].markerOpener, true);
  check("tab item fence open", fences[0].closed, false);
  check(
    "tab item bodyPrefix keeps tab",
    JSON.stringify(fences[0].bodyPrefix),
    JSON.stringify("\t  ")
  );
  const opener = doc.line(1);
  check(
    "tab item opener enter auto-closes",
    fenceEnterPlan(doc, opener.to, fences),
    {
      from: opener.to,
      to: opener.to,
      insert: "\n\t  \n\t  ```",
      cursor: opener.to + 4,
    }
  );
  const last = doc.line(2);
  check("tab item exit writes closer", fenceExitPlan(doc, last.to, fences), {
    from: last.to,
    to: last.to,
    insert: "\n\t  ```\n\t  ",
    cursor: last.to + 11,
  });
}
{
  // A plain list item is not a fence; an ordered-item fence is.
  check("plain item is no fence", scanFences(Text.of(["- just text"])), []);
  const ordered = scanFences(Text.of(["2. ```", "x", "```"]));
  check("ordered item fence recognized", ordered.length, 1);
  check("ordered item content column", ordered[0].indent, 3);
}

/* ---------- findColorTagPairs: bare formatting tags ---------- */
{
  const pairs = findColorTagPairs("x <b>bold</b> y");
  check("bold pair found", pairs.length, 1);
  check("bold style", pairs[0].style, "font-weight:bold");
  check("bold open range", [pairs[0].open.from, pairs[0].open.to], [2, 5]);
  check("bold close range", [pairs[0].close.from, pairs[0].close.to], [9, 13]);
}
{
  const pairs = findColorTagPairs("<i>it</i><s>gone</s>");
  check("italic+strike pairs", pairs.length, 2);
  check(
    "styles",
    pairs.map((p) => p.style).sort(),
    ["font-style:italic", "text-decoration:line-through"]
  );
}
{
  check("lone <b> is no pair", findColorTagPairs("a ** b <b> c"), []);
  check("<br> is not matched", findColorTagPairs("<br><b>x</b>").length, 1);
  const nested = findColorTagPairs('<b><span style="color:red">x</span></b>');
  check("nested tags both pair", nested.length, 2);
}

/* ---------- extractHtmlTitle ---------- */
check(
  "title basic",
  extractHtmlTitle("<html><head><title>My Page</title></head></html>"),
  "My Page"
);
check(
  "title with attributes and entities",
  extractHtmlTitle('<title data-x="1">A &amp; B &lt;C&gt; &#20013;&#x6587;</title>'),
  "A & B <C> 中文"
);
check(
  "amp decoded last",
  extractHtmlTitle("<title>&amp;lt;kept&amp;gt;</title>"),
  "&lt;kept&gt;"
);
check(
  "title whitespace collapsed",
  extractHtmlTitle("<title>\n  Multi\n  line   title\n</title>"),
  "Multi line title"
);
check("no title", extractHtmlTitle("<html><body>x</body></html>"), null);
check("empty title", extractHtmlTitle("<title>   </title>"), null);
check(
  "empty SPA title falls back to og:title",
  extractHtmlTitle(
    '<title data-next-head=""></title>' +
      '<meta property="og:title" content="303. 区域和检索 - 力扣" data-next-head=""/>'
  ),
  "303. 区域和检索 - 力扣"
);
check(
  "twitter:title fallback with swapped attributes",
  extractHtmlTitle(
    "<title></title><meta content='Tweet Page' name=\"twitter:title\">"
  ),
  "Tweet Page"
);
check(
  "real title wins over og:title",
  extractHtmlTitle(
    '<title>Real</title><meta property="og:title" content="OG">'
  ),
  "Real"
);

/* ---------- buildTitledLink ---------- */
check(
  "link basic",
  buildTitledLink("https://a.b/c", "Hello"),
  "[Hello](https://a.b/c)"
);
check(
  "link escapes brackets",
  buildTitledLink("https://a.b", "x [1] y"),
  "[x \\[1\\] y](https://a.b)"
);
check("link empty title", buildTitledLink("https://a.b", "  "), null);
check(
  "link caps length",
  buildTitledLink("https://a.b", "t".repeat(200))?.length,
  1 + 160 + 2 + 11 + 1
);

process.exit(fail ? 1 : 0);
