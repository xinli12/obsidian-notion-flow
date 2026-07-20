import { Text } from "@codemirror/state";
import {
  calloutEditBlocks,
  quoteMarkerPrefix,
  dedentQuoteLine,
  quoteEnterPlan,
  quoteBackspacePlan,
  columnContentQuoteDepth,
  columnFenceEnterPlan,
  columnFenceBackspacePlan,
  buildQuotedPaste,
  parseCalloutHeader,
  setCalloutType,
  toggleCalloutFold,
  quoteToCallout,
  calloutToQuote,
} from "./bundle.mjs";

let fail = 0;
const check = (name, got, expected) => {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: got ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`
  );
};

/* ---------- quoteMarkerPrefix ---------- */
check("prefix simple", quoteMarkerPrefix("> foo"), "> ");
check("prefix tight", quoteMarkerPrefix(">foo"), ">");
check("prefix nested indented", quoteMarkerPrefix("  > > x"), "  > > ");
check("prefix plain line", quoteMarkerPrefix("plain"), null);
check("prefix empty", quoteMarkerPrefix(""), null);

/* ---------- dedentQuoteLine ---------- */
check("dedent one level", dedentQuoteLine("> foo"), { text: "foo", cursor: 0 });
check("dedent nested", dedentQuoteLine("> > foo"), { text: "> foo", cursor: 2 });
check("dedent empty exit", dedentQuoteLine("> "), { text: "", cursor: 0 });
check("dedent nested empty", dedentQuoteLine("> > "), { text: "> ", cursor: 2 });
check("dedent keeps indent", dedentQuoteLine("  > x"), { text: "  x", cursor: 2 });
check("dedent trailing spaces", dedentQuoteLine(">   "), { text: "", cursor: 0 });

/* ---------- quoteEnterPlan ---------- */
const doc = Text.of([
  "> [!note] Title", // 1 (0-14)
  "> body",          // 2 (16-21)
  "> ",              // 3 (23-24)
  "text",            // 4
  "```",             // 5
  "> quoted code",   // 6
  "```",             // 7
]);
const l1 = doc.line(1);
const l2 = doc.line(2);
const l3 = doc.line(3);
check(
  "enter continues title line",
  quoteEnterPlan(doc, l1.to),
  { from: l1.to, to: l1.to, insert: "\n> ", cursor: l1.to + 3 }
);
check(
  "enter splits body content",
  quoteEnterPlan(doc, l2.from + 4),
  { from: l2.from + 4, to: l2.from + 4, insert: "\n> ", cursor: l2.from + 7 }
);
check(
  "enter exits empty marker line with a sealing blank",
  quoteEnterPlan(doc, l3.to),
  { from: l3.from, to: l3.to, insert: "\n", cursor: l3.from + 1 }
);
check(
  "enter exits a lone marker line without sealing",
  quoteEnterPlan(Text.of(["text", "> "]), 7),
  { from: 5, to: 7, insert: "", cursor: 5 }
);
check("enter inside marker falls back", quoteEnterPlan(doc, l1.from + 1), null);
check("enter plain line falls back", quoteEnterPlan(doc, doc.line(4).to), null);
check("enter in fence falls back", quoteEnterPlan(doc, doc.line(6).to), null);
check(
  "enter on list in quote falls back",
  quoteEnterPlan(Text.of(["> - item"]), 8),
  null
);
const nested = Text.of(["> > deep", "> > "]);
const n2 = nested.line(2);
check(
  "enter dedents nested empty line",
  quoteEnterPlan(nested, n2.to),
  { from: n2.from, to: n2.to, insert: "> ", cursor: n2.from + 2 }
);

/* ---------- quoteBackspacePlan ---------- */
check(
  "backspace unwraps at content start",
  quoteBackspacePlan(doc, l2.from + 2),
  { from: l2.from, to: l2.to, insert: "body", cursor: l2.from }
);
check("backspace mid-content falls back", quoteBackspacePlan(doc, l2.from + 3), null);
check("backspace at col 0 falls back", quoteBackspacePlan(doc, l2.from), null);
check(
  "backspace on empty marker line",
  quoteBackspacePlan(doc, l3.from + 2),
  { from: l3.from, to: l3.to, insert: "", cursor: l3.from }
);
check(
  "backspace nested unwraps one level",
  quoteBackspacePlan(nested, nested.line(1).from + 4),
  { from: 0, to: 8, insert: "> deep", cursor: 2 }
);

/* Column markers are structural: editing an empty block must not tear it
 * out of its [!nf-col], while a user-authored deeper quote can dedent. */
const columns = Text.of([
  "> [!nf-cols]",
  "> > [!nf-col]",
  "> > left",
  "> > ",
  ">",
  "> > [!nf-col]",
  "> > > nested",
]);
const emptyColumnLine = columns.line(4);
check("column depth resolves", columnContentQuoteDepth(columns, 4), 2);
check(
  "enter keeps empty block in column",
  quoteEnterPlan(columns, emptyColumnLine.to),
  {
    from: emptyColumnLine.to,
    to: emptyColumnLine.to,
    insert: "\n> > ",
    cursor: emptyColumnLine.to + 5,
  }
);
check(
  "backspace protects column prefix",
  quoteBackspacePlan(columns, emptyColumnLine.to),
  {
    from: emptyColumnLine.to,
    to: emptyColumnLine.to,
    insert: "",
    cursor: emptyColumnLine.to,
  }
);
const nestedColumnLine = columns.line(7);
check("nested content keeps column floor", columnContentQuoteDepth(columns, 7), 2);
check(
  "backspace may dedent user quote to column floor",
  quoteBackspacePlan(columns, nestedColumnLine.from + 6),
  {
    from: nestedColumnLine.from,
    to: nestedColumnLine.to,
    insert: "> > nested",
    cursor: nestedColumnLine.from + 4,
  }
);

const columnCode = Text.of([
  "> [!nf-cols]",
  "> > [!nf-col]",
  "> > ```js",
  "> >   const x = 1;",
  "> > ```",
  ">",
  "> > [!nf-col]",
  "> > other",
]);
const columnCodeBody = columnCode.line(4);
check(
  "column code Enter keeps both structural and code indentation",
  columnFenceEnterPlan(columnCode, columnCodeBody.to),
  {
    from: columnCodeBody.to,
    to: columnCodeBody.to,
    insert: "\n> >   ",
    cursor: columnCodeBody.to + 7,
  }
);
check(
  "quote Enter delegates to the column code model",
  quoteEnterPlan(columnCode, columnCodeBody.to),
  columnFenceEnterPlan(columnCode, columnCodeBody.to)
);
check(
  "column code Backspace removes indentation, not column markers",
  columnFenceBackspacePlan(columnCode, columnCodeBody.from + 6),
  {
    from: columnCodeBody.from + 4,
    to: columnCodeBody.from + 6,
    insert: "",
    cursor: columnCodeBody.from + 4,
  }
);

/* ---------- buildQuotedPaste ---------- */
check(
  "paste prefixes following lines",
  buildQuotedPaste("> body", 4, "a\nb\nc"),
  "a\n> b\n> c"
);
check(
  "paste keeps blank lines in block",
  buildQuotedPaste("> body", 4, "a\n\nb"),
  "a\n> \n> b"
);
check(
  "paste nested prefix",
  buildQuotedPaste("  > > x", 7, "a\nb"),
  "a\n  > > b"
);
check("paste crlf normalized", buildQuotedPaste("> x", 3, "a\r\nb"), "a\n> b");
check("paste single line untouched", buildQuotedPaste("> x", 3, "abc"), null);
check("paste outside quote untouched", buildQuotedPaste("plain", 3, "a\nb"), null);
check("paste inside marker untouched", buildQuotedPaste("> x", 1, "a\nb"), null);

/* ---------- parseCalloutHeader ---------- */
check(
  "header basic",
  parseCalloutHeader("> [!note] Title"),
  { type: "note", fold: "", typeFrom: 4, typeTo: 8, foldAt: 9 }
);
check(
  "header folded uppercase",
  parseCalloutHeader("> [!TIP]- x"),
  { type: "tip", fold: "-", typeFrom: 4, typeTo: 7, foldAt: 8 }
);
check("header alias resolves", parseCalloutHeader("> [!error] x")?.type, "danger");
check("header metadata", parseCalloutHeader("> [!note|no-icon]+ x")?.fold, "+");
check("header nested quote", parseCalloutHeader("> > [!info] x")?.type, "info");
check("plain quote is not header", parseCalloutHeader("> plain"), null);

/* ---------- setCalloutType / toggleCalloutFold ---------- */
check("set type", setCalloutType("> [!note] T", "warning"), "> [!warning] T");
check(
  "set type keeps metadata and fold",
  setCalloutType("> [!note|no-icon]- T", "tip"),
  "> [!tip|no-icon]- T"
);
check("set type on plain quote", setCalloutType("> plain", "tip"), null);
check("fold on", toggleCalloutFold("> [!note] T"), "> [!note]- T");
check("fold off", toggleCalloutFold("> [!note]- T"), "> [!note] T");
check("fold off plus", toggleCalloutFold("> [!note]+ T"), "> [!note] T");

/* ---------- quoteToCallout / calloutToQuote ---------- */
check("quote to callout", quoteToCallout("> quote line", "note"), "> [!note] quote line");
check("tight quote to callout", quoteToCallout(">x", "tip"), ">[!tip] x");
check("existing callout untouched", quoteToCallout("> [!note] x", "tip"), null);
check("plain line untouched", quoteToCallout("plain", "tip"), null);
/* ---------- calloutEditBlocks ---------- */
const editDoc = Text.of([
  "> [!tip] Title",   // 1 callout 1-3 (lazy tail on 3)
  "> body",           // 2
  "lazy tail",        // 3
  "",                 // 4
  "> plain quote",    // 5 not a callout
  "",                 // 6
  "```",              // 7 fence 7-9
  "> [!note] fenced", // 8
  "```",              // 9
  "  > [!error] nested", // 10 alias type, indented
]);
check(
  "edit blocks: callout with lazy tail, alias color, fence skipped",
  calloutEditBlocks(editDoc, 1, 10),
  [
    { startLine: 1, endLine: 3, colorVar: "--callout-tip" },
    { startLine: 10, endLine: 10, colorVar: "--callout-error" },
  ]
);
check(
  "edit blocks: range entering mid-callout finds the header",
  calloutEditBlocks(editDoc, 2, 2),
  [{ startLine: 1, endLine: 3, colorVar: "--callout-tip" }]
);
check("edit blocks: plain quote has none", calloutEditBlocks(editDoc, 5, 5), []);

check("callout to quote", calloutToQuote("> [!note] Title"), "> Title");
check("folded callout to quote", calloutToQuote("> [!note]- Title"), "> Title");
check("title-less callout to quote", calloutToQuote("> [!note]-"), "> ");
check("plain quote to quote", calloutToQuote("> plain"), null);

process.exit(fail);
