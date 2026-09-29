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
  calloutHeaderVisualRange,
  calloutActivationCursor,
  calloutSourceTextAnchor,
  calloutHeaderKeyPlan,
  setCalloutType,
  toggleCalloutFold,
  quoteToCallout,
  calloutToQuote,
  setCalloutMetaToken,
  calloutMetaColor,
  calloutColorValue,
  calloutSurfaceValue,
  columnWidthPercent,
  setColumnWidths,
  splitDescription,
  descriptionUnits,
  collectListLineStyles,
  collectOrderedListMarkers,
} from "./bundle.mjs";
import { parser } from "@lezer/markdown";

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
/* Row 2 has a sibling row below it, so there is no level to exit here:
 * shedding one would have left "body" outside the Callout and everything
 * under it still inside. Backspace at a line start joins upward instead —
 * except onto a Callout's title (w1c-callout-first-row-backspace): the first
 * body row steps onto the title's end and changes nothing. */
check(
  "backspace on a Callout's first body row steps onto the title, no join",
  quoteBackspacePlan(doc, l2.from + 2),
  { from: l2.from + 2, to: l2.from + 2, insert: "", cursor: l1.to }
);
check("backspace mid-content falls back", quoteBackspacePlan(doc, l2.from + 3), null);
check("backspace at col 0 falls back", quoteBackspacePlan(doc, l2.from), null);
// The row ends the Callout, so shedding its marker leaves the box; like
// Enter there, a sealing blank keeps the caret off the row right under
// "> body", where typing would join that paragraph lazily.
check(
  "backspace on empty marker line seals like enter",
  quoteBackspacePlan(doc, l3.from + 2),
  { from: l3.from, to: l3.to, insert: "\n", cursor: l3.from + 1 }
);
/* On the FIRST row of a nested quote that has more rows below, "remove this
 * block's marker" can only mean the whole nested quote — dedenting just this
 * row would leave the next one nested a level deeper than its own header. */
check(
  "backspace on a nested block's first row unwraps the whole block",
  quoteBackspacePlan(nested, nested.line(1).from + 4),
  { from: 0, to: 13, insert: "> deep\n>", cursor: 2 }
);
/* With nothing below it, the same row really is leaving the level. */
check(
  "backspace on the last nested row still sheds one level",
  quoteBackspacePlan(Text.of(["> > deep"]), 4),
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
  { type: "note", fold: "", typeFrom: 4, typeTo: 8, foldAt: 9, metadata: [] }
);
check(
  "header folded uppercase",
  parseCalloutHeader("> [!TIP]- x"),
  { type: "tip", fold: "-", typeFrom: 4, typeTo: 7, foldAt: 8, metadata: [] }
);
check("header alias resolves", parseCalloutHeader("> [!error] x")?.type, "danger");
check("header metadata", parseCalloutHeader("> [!note|no-icon]+ x")?.fold, "+");
check("header nested quote", parseCalloutHeader("> > [!info] x")?.type, "info");
check("plain quote is not header", parseCalloutHeader("> plain"), null);
check(
  "visual header range includes metadata, fold marker, and separator",
  calloutHeaderVisualRange("> [!note|no-icon]- Title"),
  { from: 0, to: 19 }
);

const protectedHeader = Text.of(["> [!note|x]- Title", "> body"]);
const protectedTitle = calloutHeaderVisualRange(protectedHeader.line(1).text).to;
check(
  "Home lands at the visible Callout title",
  calloutHeaderKeyPlan(protectedHeader, protectedHeader.line(1).to, "Home"),
  {
    from: protectedHeader.line(1).to,
    to: protectedHeader.line(1).to,
    insert: "",
    cursor: protectedTitle,
  }
);
// Every caret position up to the title is drawn in the same place, so
// Backspace means the same thing in all of them: unwrap the Callout. It
// used to only nudge the caret from one invisible spot to another, which
// read as a dead key — the press did nothing a user could see.
const unwrapped = {
  from: 0,
  to: protectedHeader.length,
  insert: "Title\nbody",
  cursor: 0,
};
check(
  "Backspace inside the hidden Callout token unwraps, like at the title",
  calloutHeaderKeyPlan(protectedHeader, 5, "Backspace"),
  unwrapped
);
check(
  "Backspace at the title start does the same",
  calloutHeaderKeyPlan(protectedHeader, protectedTitle, "Backspace"),
  unwrapped
);
check(
  "Delete inside the hidden Callout token only restores the title caret",
  calloutHeaderKeyPlan(protectedHeader, 5, "Delete"),
  { from: 5, to: 5, insert: "", cursor: protectedTitle }
);
check(
  "Delete at a real title falls through to ordinary text editing",
  calloutHeaderKeyPlan(protectedHeader, protectedTitle, "Delete"),
  null
);
const emptyHeader = Text.of(["> [!note]"]);
check(
  "Delete cannot cross an empty hidden Callout header",
  calloutHeaderKeyPlan(emptyHeader, emptyHeader.length, "Delete"),
  {
    from: emptyHeader.length,
    to: emptyHeader.length,
    insert: "",
    cursor: emptyHeader.length,
  }
);

const multiActivation = Text.of(["> [!note] Title", "> body"]);
check(
  "a multi-row Callout activates on its first body column",
  calloutActivationCursor(multiActivation, 1, 2),
  { anchor: multiActivation.line(2).from + 2, assoc: 1 }
);
const titledActivation = Text.of(["> [!note] Title"]);
check(
  "a one-row titled Callout activates inside visible title text",
  calloutActivationCursor(titledActivation, 1, 1),
  { anchor: calloutHeaderVisualRange(titledActivation.line(1).text).to + 1, assoc: 1 }
);
check(
  "a title-less Callout activates on the visual token's right side",
  calloutActivationCursor(emptyHeader, 1, 1),
  { anchor: emptyHeader.length, assoc: 1 }
);

const renderedAnchorDoc = Text.of([
  "> [!note] Anchor",
  "> first repeated value",
  "> **outer ending.**",
  "> repeated value",
]);
check(
  "rendered prose maps through Markdown formatting to its source offset",
  calloutSourceTextAnchor(
    renderedAnchorDoc,
    1,
    4,
    "outer ending.",
    6,
    renderedAnchorDoc.line(3).from
  ),
  renderedAnchorDoc.line(3).from + renderedAnchorDoc.line(3).text.indexOf("outer ending.") + 6
);
check(
  "repeated rendered text chooses the occurrence nearest the expected row",
  calloutSourceTextAnchor(
    renderedAnchorDoc,
    1,
    4,
    "repeated value",
    4,
    renderedAnchorDoc.line(4).from
  ),
  renderedAnchorDoc.line(4).from + renderedAnchorDoc.line(4).text.indexOf("repeated value") + 4
);
const hiddenTokenAnchor = Text.of(["> [!note] note"]);
check(
  "a rendered title never anchors into the hidden Callout token",
  calloutSourceTextAnchor(hiddenTokenAnchor, 1, 1, "note", 2, 4),
  hiddenTokenAnchor.line(1).text.lastIndexOf("note") + 2
);
check(
  "blank rendered text keeps the coordinate fallback",
  calloutSourceTextAnchor(renderedAnchorDoc, 1, 4, "   ", 1, 0),
  null
);

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

const siblingCallouts = Text.of([
  "> [!note] One",
  "> first",
  ">",
  "> [!warning] Two",
  "> second",
]);
// A quoted blank row does not end the blockquote, so "[!warning] Two" is a
// paragraph of the first box: Obsidian renders one note Callout whose body
// reads "[!warning] Two" (w2c-callout-header-opens-quote, checked in-app).
check(
  "a [!type] row after a quoted blank is text of the Callout above",
  calloutEditBlocks(siblingCallouts, 1, 5),
  [{ startLine: 1, endLine: 5, colorVar: "--callout-default" }]
);

const calloutWithFence = Text.of([
  "> [!note] Code",
  "> before",
  "> ```js",
  "> const answer = 42",
  "> ```",
  "> after",
]);
check(
  "edit blocks: a quoted fence stays inside its Callout chunk",
  calloutEditBlocks(calloutWithFence, 4, 4),
  [{ startLine: 1, endLine: 6, colorVar: "--callout-default" }]
);

check("callout to quote", calloutToQuote("> [!note] Title"), "> Title");
check("folded callout to quote", calloutToQuote("> [!note]- Title"), "> Title");
check("title-less callout to quote", calloutToQuote("> [!note]-"), "> ");
check("plain quote to quote", calloutToQuote("> plain"), null);

/* ---------- Callout metadata: colour token beside column widths ---------- */
check(
  "header metadata tokens",
  parseCalloutHeader("> [!nf-col|30 nf-red]- Title")?.metadata,
  ["30", "nf-red"]
);
check(
  "header metadata trims and splits runs of spaces",
  parseCalloutHeader("> [!note|  nf-blue   no-icon ] x")?.metadata,
  ["nf-blue", "no-icon"]
);
check("header without metadata", parseCalloutHeader("> [!note] x")?.metadata, []);
check(
  "meta token added to a bare header",
  setCalloutMetaToken("> [!note] Title", "nf-", "nf-red"),
  "> [!note|nf-red] Title"
);
check(
  "meta token replaced in place, other tokens kept",
  setCalloutMetaToken("> > [!nf-col|30 nf-red] x", "nf-", "nf-blue"),
  "> > [!nf-col|30 nf-blue] x"
);
check(
  "meta token appended after a width",
  setCalloutMetaToken("> [!nf-col|30]", "nf-", "nf-green"),
  "> [!nf-col|30 nf-green]"
);
check(
  "meta token removed, width kept",
  setCalloutMetaToken("> [!nf-col|30 nf-red]- x", "nf-", null),
  "> [!nf-col|30]- x"
);
check(
  "removing the only token drops the bar",
  setCalloutMetaToken("> [!tip|nf-red]+ x", "nf-", null),
  "> [!tip]+ x"
);
check("removing an absent token is a no-op", setCalloutMetaToken("> [!tip] x", "nf-", null), "> [!tip] x");
check("meta token on a plain quote", setCalloutMetaToken("> plain", "nf-", "nf-red"), null);
check(
  "metadata survives setCalloutType",
  setCalloutType("> [!note|30 nf-red] T", "tip"),
  "> [!tip|30 nf-red] T"
);
check(
  "metadata survives toggleCalloutFold",
  toggleCalloutFold("> [!note|nf-red] T"),
  "> [!note|nf-red]- T"
);
check(
  "metadata survives the fold round trip",
  toggleCalloutFold(toggleCalloutFold("> [!note|nf-red] T")),
  "> [!note|nf-red] T"
);
check("callout with metadata to quote leaves no residue", calloutToQuote("> [!note|nf-red] T"), "> T");
check(
  "quote to callout starts without metadata",
  parseCalloutHeader(quoteToCallout("> T", "note"))?.metadata,
  []
);
check("meta colour red", calloutMetaColor(["30", "nf-red"]), "red");
check("meta colour none", calloutMetaColor(["30", "no-icon"]), null);
check("meta colour unknown name", calloutMetaColor(["nf-teal"]), null);
// A palette colour's ink is the hue's ink token (a note palette re-inks
// it; under Classic it equals the triplet), its fill source the triplet.
check("colour value: plugin triplet is the ink", calloutColorValue("--nf-red-rgb"), "var(--nf-red, #b5554d)");
check("colour value: theme variable", calloutColorValue("--callout-warning"), "var(--callout-warning)");
check("surface value: plugin triplet", calloutSurfaceValue("--nf-red-rgb"), "rgb(var(--nf-red-rgb))");
check("surface value: theme type reads the palette wash first", calloutSurfaceValue("--callout-tip"), "var(--nf-co-wash-tip, var(--callout-tip))");
check(
  "edit blocks: metadata colour beats the type colour",
  calloutEditBlocks(Text.of(["> [!warning|nf-blue] T", "> body"]), 1, 2),
  [{ startLine: 1, endLine: 2, colorVar: "--nf-blue-rgb" }]
);
check("width with mixed tokens", columnWidthPercent("30 nf-red"), 30);
check("width after a colour token", columnWidthPercent("nf-red 30"), 30);
check("width with only a colour token", columnWidthPercent("nf-red"), null);
check("width alone", columnWidthPercent("30"), 30);
check("width out of range", columnWidthPercent("95 nf-red"), null);
check(
  "setColumnWidths keeps a colour token",
  setColumnWidths(["> [!nf-cols]", "> > [!nf-col|30 nf-red]", "> > a", "> > [!nf-col]", "> > b"], [40, 60]),
  ["> [!nf-cols]", "> > [!nf-col|40 nf-red]", "> > a", "> > [!nf-col|60]", "> > b"]
);
check(
  "setColumnWidths clears a width but keeps the colour",
  setColumnWidths(["> [!nf-cols]", "> > [!nf-col|30 nf-red]", "> > a"], [null]),
  ["> [!nf-cols]", "> > [!nf-col|nf-red]", "> > a"]
);

/* ---------- splitDescription (settings copy) ---------- */
check("short description stays whole", splitDescription("Shade every other table row."), {
  lead: "Shade every other table row.",
  rest: "",
});
check(
  "long description keeps whole sentences under the limit",
  splitDescription("One sentence here. Two sentences here. Three sentences here.", 40),
  { lead: "One sentence here. Two sentences here.", rest: "Three sentences here." }
);
check(
  "a first sentence longer than the limit is kept whole",
  splitDescription("This first sentence is long enough to pass the limit on its own. Short tail.", 20),
  { lead: "This first sentence is long enough to pass the limit on its own.", rest: "Short tail." }
);
check(
  "no sentence end means no split",
  splitDescription("A single sentence that runs past the limit without ever ending in a period", 20),
  { lead: "A single sentence that runs past the limit without ever ending in a period", rest: "" }
);
check(
  "a period inside a token is not a sentence end",
  splitDescription("What /time writes, in moment.js tokens and more words to pass. The rest.", 30),
  { lead: "What /time writes, in moment.js tokens and more words to pass.", rest: "The rest." }
);
check(
  "Chinese sentence ends count too",
  splitDescription("第一句话在这里。第二句话在这里。第三句话在这里。", 10),
  { lead: "第一句话在这里。", rest: "第二句话在这里。第三句话在这里。" }
);
// R2-W3-MAIN item 9: CJK and fullwidth characters weigh 2, so Chinese copy
// collapses behind Details at the visual length English does. The strings
// are the ZH entries of src/i18n.ts (the test bundle's t() is English).
check("descriptionUnits: CJK weighs 2", descriptionUnits("标注"), 4);
check("descriptionUnits: a fullwidth comma weighs 2", descriptionUnits("a，b"), 4);
check("descriptionUnits: an emoji is one code point", descriptionUnits("💬"), 1);
check("descriptionUnits: ASCII weighs 1", descriptionUnits("Shade every other table row."), 28);
{
  const tabZh = "Tab 与 Shift+Tab 让光标所在的块在「横向拖拽」提供的同一组层级之间移动——段落、标题、引用或标注可以缩进到上方列表项之下。列表项仍由 Obsidian 自己缩进，表格单元格仍用表格导航，代码块仍是代码缩进；当某个块无处可去时，Tab 保持原有含义。";
  const tabSplit = splitDescription(tabZh);
  check("ZH Tab row is past the limit in units", [tabZh.length <= 140, descriptionUnits(tabZh) > 140], [true, true]);
  check("ZH Tab row: lead ends at its first sentence", tabSplit.lead.endsWith("列表项之下。"), true);
  check("ZH Tab row: the rest goes behind Details", tabSplit.rest.startsWith("列表项仍由 Obsidian"), true);
  const colsZh = "Notion 式并排分栏。可通过斜杠命令「/分栏」插入、在块菜单选择「转为分栏」，或将块拖到另一个块的右缘创建。以嵌套的 [!nf-cols]/[!nf-col] 标注语法书写，在其他 Markdown 应用中显示为普通引用；「[!nf-col|30]」可将栏宽固定为 30%。";
  const colsSplit = splitDescription(colsZh);
  check("ZH Columns row weighs 222 units", descriptionUnits(colsZh), 222);
  check("ZH Columns row: lead ends with its second sentence", colsSplit.lead.endsWith("右缘创建。"), true);
  check("ZH Columns row: rest", colsSplit.rest.startsWith("以嵌套的"), true);
  const codeZh = "在代码块内：按 Enter 续行时保持当前缩进（列表内嵌套的代码块不再错位）；在代码文本开头按 Backspace 回退一级缩进；在未闭合的 ``` 行按 Enter 自动补全闭合围栏；按 Cmd/Ctrl+Shift+Enter（「跳出代码块」命令）跳出代码块。";
  check("ZH code-block row weighs 213 units", descriptionUnits(codeZh), 213);
  check("ZH code-block row: one sentence joined by ；stays whole", splitDescription(codeZh).rest, "");
}

/* ---------- list rendering: memoised source model, tree probe ---------- */
{
  // Obsidian's HyperMD tree has no list containers: the source model is
  // used, and it is computed once per document version.
  const doc = Text.of(["1. one", "1. two", "\t- inner", "2. three"]);
  const hyperMdTree = { topNode: { firstChild: null } };
  const first = collectListLineStyles(hyperMdTree, doc);
  check(
    "source model phases from a container-less tree",
    first.map((line) => line.phase),
    [0, 0, 1, 0]
  );
  check(
    "source model is memoised per document version",
    collectListLineStyles(hyperMdTree, doc) === first,
    true
  );
  check(
    "markers share the memoised walk",
    collectOrderedListMarkers(hyperMdTree, doc).map((m) => m.label),
    ["1.", "2.", "3."]
  );
  const edited = doc.replace(0, 0, Text.of(["0. zero", ""]));
  check(
    "a new document version is walked afresh",
    collectListLineStyles(hyperMdTree, edited).length,
    5
  );
  // A parser tree whose lists sit only inside a blockquote still takes
  // the tree path (the probe enters blockquotes); the source model does
  // not read quoted rows, so the labels can only come from the tree.
  const quotedText = "> 1. a\n> 1. b";
  const quotedDoc = Text.of(quotedText.split("\n"));
  check(
    "quoted lists are found by the tree probe",
    collectOrderedListMarkers(parser.parse(quotedText), quotedDoc).map((m) => m.label),
    ["1.", "2."]
  );
  // A parser tree without any list falls straight through to the source
  // model, which agrees with the container-less tree.
  const plainText = "just a paragraph\n\nanother one";
  const plainDoc = Text.of(plainText.split("\n"));
  check(
    "a tree without lists uses the source model",
    collectListLineStyles(parser.parse(plainText), plainDoc),
    collectListLineStyles(hyperMdTree, plainDoc)
  );
}

process.exit(fail);
