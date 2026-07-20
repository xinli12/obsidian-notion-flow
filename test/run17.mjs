import {
  columnWidthPercent,
  dedentLines,
  buildColumnsWrap,
  appendColumnLines,
  buildColumnsTemplate,
  extractHtmlTitle,
  buildTitledLink,
  buildQuotedPaste,
  parseCalloutHeader,
  COLS_TYPE,
  COL_TYPE,
} from "./bundle.mjs";

let fail = 0;
const check = (name, got, expected) => {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: got ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`
  );
};

/* ---------- columnWidthPercent ---------- */
check("width plain", columnWidthPercent("30"), 30);
check("width bounds low", columnWidthPercent("9"), null);
check("width bounds high", columnWidthPercent("91"), null);
check("width min", columnWidthPercent("10"), 10);
check("width max", columnWidthPercent("90"), 90);
check("width trimmed", columnWidthPercent(" 40 "), 40);
check("width junk", columnWidthPercent("30%"), null);
check("width css injection", columnWidthPercent("30;position:fixed"), null);
check("width empty", columnWidthPercent(""), null);
check("width null", columnWidthPercent(null), null);

/* ---------- dedentLines ---------- */
check("dedent top-level unchanged", dedentLines(["a", "  b"]), ["a", "  b"]);
check(
  "dedent strips first-line indent",
  dedentLines(["    - item", "        child"]),
  ["- item", "    child"]
);
check(
  "dedent shallower line keeps content",
  dedentLines(["    a", "  b"]),
  ["a", "b"]
);
check("dedent tab indent", dedentLines(["\t- a", "\t\t- b"]), ["- a", "\t- b"]);
check(
  "dedent mixed tab and spaces by visual columns",
  dedentLines(["\t- item", "    continuation"]),
  ["- item", "continuation"]
);
check("dedent empty input", dedentLines([]), []);

/* ---------- buildColumnsWrap ---------- */
check(
  "wrap two paragraphs",
  buildColumnsWrap(["left"], ["right"]),
  [
    "> [!nf-cols]",
    "> > [!nf-col]",
    "> > left",
    ">",
    "> > [!nf-col]",
    "> > right",
  ]
);
check(
  "wrap keeps blank lines inside the block",
  buildColumnsWrap(["a", "", "b"], ["c"]),
  [
    "> [!nf-cols]",
    "> > [!nf-col]",
    "> > a",
    "> >",
    "> > b",
    ">",
    "> > [!nf-col]",
    "> > c",
  ]
);
check(
  "wrap dedents an indented block",
  buildColumnsWrap(["  - li", "    sub"], ["x"]),
  [
    "> [!nf-cols]",
    "> > [!nf-col]",
    "> > - li",
    "> >   sub",
    ">",
    "> > [!nf-col]",
    "> > x",
  ]
);
check(
  "wrap nests an existing quote",
  buildColumnsWrap(["> q"], ["x"])[2],
  "> > > q"
);

/* ---------- appendColumnLines ---------- */
check(
  "append one column",
  appendColumnLines(["tail"]),
  [">", "> > [!nf-col]", "> > tail"]
);

/* ---------- buildColumnsTemplate ---------- */
check(
  "template 2 columns",
  buildColumnsTemplate(2),
  "> [!nf-cols]\n> > [!nf-col]\n> > ‸\n>\n> > [!nf-col]\n> > "
);
check(
  "template 3 columns has three headers",
  buildColumnsTemplate(3).split("\n").filter((l) => l.includes("[!nf-col]")).length,
  3
);
check("template clamps below 2", buildColumnsTemplate(1), buildColumnsTemplate(2));

/* ---------- header parsing of the column types ---------- */
check("cols header parses", parseCalloutHeader("> [!nf-cols]")?.type, COLS_TYPE);
check("col header parses", parseCalloutHeader("> > [!nf-col]")?.type, COL_TYPE);
check(
  "col width metadata survives parsing",
  parseCalloutHeader("> > [!nf-col|30]")?.type,
  COL_TYPE
);

/* ---------- entity decoding (single pass, no double decode) ---------- */
check(
  "title decodes named entities",
  extractHtmlTitle("<title>A &amp; B &ndash; C</title>"),
  "A & B – C"
);
check(
  "title numeric entity",
  extractHtmlTitle("<title>&#65;&#x42;</title>"),
  "AB"
);
check(
  "title never double-decodes via &amp;",
  extractHtmlTitle("<title>&amp;lt;tag&amp;gt;</title>"),
  "&lt;tag&gt;"
);
check(
  "title never double-decodes via numeric amp",
  extractHtmlTitle("<title>&#38;lt;tag&#38;gt;</title>"),
  "&lt;tag&gt;"
);
check(
  "title survives out-of-range codepoint",
  extractHtmlTitle("<title>ok &#9999999; ok</title>"),
  "ok &#9999999; ok"
);
check(
  "title keeps unknown named entity",
  extractHtmlTitle("<title>a &unknown; b</title>"),
  "a &unknown; b"
);

/* ---------- buildTitledLink escaping ---------- */
check(
  "link escapes trailing backslash",
  buildTitledLink("https://x.y", "dir\\"),
  "[dir\\\\](https://x.y)"
);
check(
  "link escapes brackets",
  buildTitledLink("https://x.y", "a [b] c"),
  "[a \\[b\\] c](https://x.y)"
);

/* ---------- buildQuotedPaste trailing newline ---------- */
check(
  "quoted paste drops one trailing newline",
  buildQuotedPaste("> x", 2, "a\nb\n"),
  "a\n> b"
);
check(
  "quoted paste single line + newline pastes clean",
  buildQuotedPaste("> x", 2, "solo\n"),
  "solo"
);

if (fail > 0) {
  console.error(`${fail} FAILED`);
  process.exit(1);
}
console.log("ALL PASS");
