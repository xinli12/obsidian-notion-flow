import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
  enclosingMarkdownLink, isValidLinkDest, normalizeLinkDest, rewriteMarkdownLink, unlinkMarkdownLink, LinkPopover,
} from "./features.mjs";

// The wikilink half of the core is not in features.mjs (feature-entry.ts
// belongs to another package); the module is pure, so bundle it alone.
const bundleDir = await mkdtemp(join(tmpdir(), "notion-flow-markdown-links-"));
let core;
try {
  const outfile = join(bundleDir, "markdown-links.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("../src/core/markdown-links.ts", import.meta.url))],
    bundle: true, format: "esm", platform: "node", outfile, logLevel: "silent",
  });
  core = await import(pathToFileURL(outfile).href);
} finally {
  await rm(bundleDir, { recursive: true, force: true });
}
const {
  wikiLinksOnLine, enclosingWikiLink, wikiLinkDisplay, wikiLinkFields, unwrapLinkDest, canWriteWikiLink,
  rewriteWikiLink, wikiLinkToMarkdown, unlinkWikiLink, markdownLinksOnLine, linkCardTarget, escapeLinkLabelPipes,
} = core;

/* ---- detection ---- */
const line = "see [docs](https://ex.com/a) and ![img](pic.png) or [[wiki]] then [b](n.md)";
const docs = enclosingMarkdownLink(line, 6, 6);
assert.deepEqual(docs, {
  start: 4, end: 28, text: "docs", dest: "https://ex.com/a",
  textStart: 5, textEnd: 9, destStart: 11, destEnd: 27,
});
assert.equal(line.slice(docs.start, docs.end), "[docs](https://ex.com/a)");
assert.equal(line.slice(docs.textStart, docs.textEnd), "docs");
assert.equal(line.slice(docs.destStart, docs.destEnd), "https://ex.com/a");
assert.deepEqual(enclosingMarkdownLink(line, 4, 4), docs, "at the opening bracket");
assert.deepEqual(enclosingMarkdownLink(line, 28, 28), docs, "right after the closing paren");
assert.deepEqual(enclosingMarkdownLink(line, 4, 28), docs, "the whole link selected");
assert.deepEqual(enclosingMarkdownLink(line, 5, 9), docs, "selection inside the text");
assert.equal(enclosingMarkdownLink(line, 3, 3), null, "before the link");
assert.equal(enclosingMarkdownLink(line, 29, 29), null, "after the link");
assert.equal(enclosingMarkdownLink(line, 3, 6), null, "selection spilling out of the link");
assert.equal(enclosingMarkdownLink(line, 20, 40), null, "selection spanning two things");
assert.equal(enclosingMarkdownLink(line, 36, 36), null, "images are not editable links");
assert.equal(enclosingMarkdownLink(line, 56, 56), null, "wikilinks are not inline links");
assert.equal(enclosingMarkdownLink(line, 70, 70)?.dest, "n.md", "later link on the line");
assert.equal(enclosingMarkdownLink("[[a](b)", 1, 1), null, "[[…](…) is skipped");
assert.equal(enclosingMarkdownLink("[](x)", 1, 1)?.text, "", "empty text still detected");
assert.equal(enclosingMarkdownLink("plain text", 2, 2), null);
assert.equal(enclosingMarkdownLink("[a](b) [c](d)", 3, 3)?.text, "a");
assert.equal(enclosingMarkdownLink("[a](b) [c](d)", 8, 8)?.text, "c");

/* ---- parentheses, angle brackets and nested brackets ---- */
const parenLine = "[Note (1)](Note%20(1).md) tail";
const paren = enclosingMarkdownLink(parenLine, 1, 1);
assert.equal(paren.dest, "Note%20(1).md", "parentheses in the destination nest");
assert.equal(paren.end, 25);
assert.equal(paren.destEnd, 24);
assert.equal(rewriteMarkdownLink(parenLine, paren, { text: "Note (1)", dest: "Other.md" }), "[Note (1)](Other.md) tail");
assert.equal(unlinkMarkdownLink(parenLine, paren), "Note (1) tail");
const wikiLine = "[Foo](https://en.wikipedia.org/wiki/Foo_(bar))";
const wiki = enclosingMarkdownLink(wikiLine, 2, 2);
assert.equal(wiki.dest, "https://en.wikipedia.org/wiki/Foo_(bar)");
assert.equal(rewriteMarkdownLink(wikiLine, wiki, { text: "Foo", dest: "https://x.com" }), "[Foo](https://x.com)");
assert.equal(enclosingMarkdownLink("[a](<foo (1).md>)", 1, 1)?.dest, "<foo (1).md>", "an angle-bracket destination is taken whole");
assert.equal(enclosingMarkdownLink("[a](b(c", 1, 1), null, "an unclosed destination is not a link");
assert.equal(enclosingMarkdownLink("[a](foo\\)bar)", 1, 1)?.dest, "foo\\)bar", "an escaped paren does not close the destination");
assert.equal(enclosingMarkdownLink("[see [ref]](url)", 2, 2)?.text, "see [ref]", "brackets nest in the text");
assert.equal(enclosingMarkdownLink("[a\\]b](c)", 1, 1)?.text, "a\\]b", "an escaped bracket does not close the text");
assert.equal(enclosingMarkdownLink("[a [b](c)", 5, 5)?.text, "b", "an unclosed bracket before a link is ignored");
assert.equal(enclosingMarkdownLink("[a [b](c)", 1, 1), null);

/* ---- titles ---- */
const titledLine = '[a](https://x.com "Title")';
const titled = enclosingMarkdownLink(titledLine, 1, 1);
assert.equal(titled.dest, "https://x.com", "the title is split off the destination");
assert.equal(titled.title, '"Title"');
assert.equal(titled.destEnd, 17);
assert.equal(titled.end, 26);
assert.equal(rewriteMarkdownLink(titledLine, titled, { text: "a", dest: "https://x.com" }), titledLine, "an unchanged destination keeps its title");
assert.equal(rewriteMarkdownLink(titledLine, titled, { text: "b", dest: "my note.md" }), '[b](<my note.md> "Title")');
assert.equal(unlinkMarkdownLink(titledLine, titled), "a", "unlink drops the title with the link");
const single = enclosingMarkdownLink("[a](u 'T')", 1, 1);
assert.equal(single.dest, "u");
assert.equal(single.title, "'T'");
const parenTitle = enclosingMarkdownLink("[a](u (T))", 1, 1);
assert.equal(parenTitle.dest, "u");
assert.equal(parenTitle.title, "(T)");
assert.equal(parenTitle.end, 10);
const angleTitle = enclosingMarkdownLink('[a](<my note.md> "T")', 1, 1);
assert.equal(angleTitle.dest, "<my note.md>");
assert.equal(angleTitle.title, '"T"');
assert.equal("title" in enclosingMarkdownLink("[a](u)", 1, 1), false, "no title, no field");
assert.equal(enclosingMarkdownLink("[a](u v)", 1, 1)?.dest, "u v", "a bare destination with spaces is not a title");

/* ---- destinations ---- */
assert.equal(isValidLinkDest("https://ex.com"), true);
assert.equal(isValidLinkDest("  note.md  "), true);
assert.equal(isValidLinkDest(""), false);
assert.equal(isValidLinkDest("   "), false);
assert.equal(isValidLinkDest("my note.md"), false);
assert.equal(isValidLinkDest("<my note.md>"), true);
assert.equal(normalizeLinkDest("  https://ex.com "), "https://ex.com");
assert.equal(normalizeLinkDest("my note.md"), "<my note.md>");
assert.equal(normalizeLinkDest("<my note.md>"), "<my note.md>");
assert.equal(normalizeLinkDest("  "), "");

/* ---- rewrite / unlink ---- */
const l2 = "a [t](d) z";
const link = enclosingMarkdownLink(l2, 3, 3);
assert.equal(rewriteMarkdownLink(l2, link, { text: "t", dest: "new" }), "a [t](new) z", "dest only");
assert.equal(rewriteMarkdownLink(l2, link, { text: "T2", dest: "n2" }), "a [T2](n2) z", "both");
assert.equal(rewriteMarkdownLink(l2, link, { text: "t", dest: "my note.md" }), "a [t](<my note.md>) z", "spaces get wrapped");
assert.equal(unlinkMarkdownLink(l2, link), "a t z");
assert.equal(unlinkMarkdownLink("[x](y)", enclosingMarkdownLink("[x](y)", 0, 0)), "x");
assert.equal(rewriteMarkdownLink("[中文](a)", enclosingMarkdownLink("[中文](a)", 1, 1), { text: "中文", dest: "b" }), "[中文](b)");

/* ---- wikilinks: detection ---- */
const demo = "See [[notion-flow-demo|the demo]] for more.";
const demoLink = {
  start: 4, end: 33, target: "notion-flow-demo", targetStart: 6, targetEnd: 22,
  alias: "the demo", escapedPipe: false, embed: false,
};
assert.deepEqual(enclosingWikiLink(demo, 25), demoLink, "caret in the alias");
assert.deepEqual(enclosingWikiLink(demo, 25, 25), demoLink);
assert.deepEqual(enclosingWikiLink(demo, 4, 33), demoLink, "the whole wikilink selected");
assert.deepEqual(enclosingWikiLink(demo, 4), demoLink, "on the first bracket");
assert.deepEqual(enclosingWikiLink(demo, 33), demoLink, "right after ]]");
assert.equal(enclosingWikiLink(demo, 3), null, "before the link");
assert.equal(enclosingWikiLink(demo, 34), null, "after the link");
assert.equal(enclosingWikiLink(demo, 3, 10), null, "a selection spilling out of the link");
assert.equal(demo.slice(demoLink.targetStart, demoLink.targetEnd), "notion-flow-demo");
{
  const heading = enclosingWikiLink("[[t#Heading|a]]", 3);
  assert.equal(heading.target, "t#Heading");
  assert.equal(heading.alias, "a");
  assert.equal(enclosingWikiLink("[[t#^b1]]", 3).target, "t#^b1");
  assert.equal(enclosingWikiLink("[[t#^b1]]", 3).alias, null, "no separator, no alias");
  assert.equal(enclosingWikiLink("[[#Local]]", 3).target, "#Local");
  const cjk = enclosingWikiLink("见 [[笔记|别名]] 。", 5);
  assert.equal(cjk.target, "笔记");
  assert.equal(cjk.alias, "别名");
  assert.equal(enclosingWikiLink("[[t|]]", 2).alias, "", "an empty alias is not a missing one");
  assert.equal(enclosingWikiLink("[[a|b|c]]", 2).alias, "b|c", "a later pipe belongs to the alias");
}
{
  // Embeds are listed but never edited.
  const image = "![[image.png]] after";
  assert.equal(enclosingWikiLink(image, 5), null, "an embed is not an editable link");
  assert.equal(enclosingWikiLink(image, 0, 14), null);
  assert.deepEqual(wikiLinksOnLine(image), [{
    start: 0, end: 14, target: "image.png", targetStart: 3, targetEnd: 12, alias: null, escapedPipe: false, embed: true,
  }]);
  assert.equal(enclosingWikiLink("![[Note|x]]", 8), null);
}
assert.equal(enclosingWikiLink("[[unclosed", 3), null);
assert.deepEqual(wikiLinksOnLine("[[unclosed"), []);
assert.equal(enclosingWikiLink("[[]]", 2), null, "an empty wikilink is no link");
assert.equal(enclosingWikiLink("[[ ]]", 2), null);
assert.deepEqual(wikiLinksOnLine("[[a [[b]]").map((l) => [l.target, l.start]), [["b", 4]], "the later [[ owns the ]]");
assert.equal(enclosingWikiLink("[[a [[b]]", 1), null);
{
  const two = "[[a]] [[b]]";
  assert.equal(enclosingWikiLink(two, 2).target, "a");
  assert.equal(enclosingWikiLink(two, 8).target, "b");
  assert.equal(enclosingWikiLink(two, 2, 8), null, "a selection across two links");
  assert.deepEqual(wikiLinksOnLine(two).map((l) => l.target), ["a", "b"]);
}
{
  // Markdown and wiki detection never claim each other's links.
  const mixed = "[[w]] and [m](u)";
  assert.equal(enclosingMarkdownLink(mixed, 2, 2), null, "a wikilink is not a Markdown link");
  assert.equal(enclosingWikiLink(mixed, mixed.indexOf("m")), null, "a Markdown link is not a wikilink");
  assert.equal(enclosingMarkdownLink(mixed, 12, 12)?.dest, "u");
}
{
  // Inside a table row the pipe is escaped, and stays escaped.
  const row = "| [[t\\|a]] |";
  const cell = enclosingWikiLink(row, 4);
  assert.equal(cell.target, "t");
  assert.equal(cell.alias, "a");
  assert.equal(cell.escapedPipe, true);
  assert.equal(rewriteWikiLink(row, cell, { text: "b", dest: "t" }), "| [[t\\|b]] |");
  assert.equal(rewriteWikiLink(row, cell, { text: "x|y", dest: "t" }), "| [[t\\|x\\|y]] |", "label pipes are escaped too");
  assert.equal(unlinkWikiLink(row, cell), "| a |");
}

/* ---- wikilinks: display, fields and destinations ---- */
const only = (text) => wikiLinksOnLine(text)[0];
assert.equal(wikiLinkDisplay(only("[[t|a]]")), "a");
assert.equal(wikiLinkDisplay(only("[[t]]")), "t");
assert.equal(wikiLinkDisplay(only("[[t#h]]")), "t > h");
assert.equal(wikiLinkDisplay(only("[[t#^b1]]")), "t > ^b1");
assert.equal(wikiLinkDisplay(only("[[#h]]")), "h");
assert.equal(wikiLinkDisplay(only("[[t|]]")), "t");
assert.equal(wikiLinkDisplay(only("[[t|  ]]")), "t", "a blank alias shows the target");
assert.deepEqual(wikiLinkFields(only(demo)), { text: "the demo", dest: "notion-flow-demo" });
assert.deepEqual(wikiLinkFields(only("[[t#h]]")), { text: "t#h", dest: "t#h" });
assert.deepEqual(wikiLinkFields(only("[[t|]]")), { text: "t", dest: "t" });
assert.equal(unwrapLinkDest("<a b>"), "a b");
assert.equal(unwrapLinkDest(" x "), "x");
assert.equal(unwrapLinkDest(" <a b> "), "a b");
assert.equal(unwrapLinkDest("<"), "<");
assert.equal(canWriteWikiLink("a", "https://x"), false, "a URL needs a Markdown link");
assert.equal(canWriteWikiLink("a", "mailto:x@y.z"), false);
assert.equal(canWriteWikiLink("a", "a|b"), false);
assert.equal(canWriteWikiLink("a", "a]b"), false);
assert.equal(canWriteWikiLink("a]]", "n"), false);
assert.equal(canWriteWikiLink("[[a", "n"), false);
assert.equal(canWriteWikiLink("a", "<My Note>"), true);
assert.equal(canWriteWikiLink("", "n"), true);
assert.equal(canWriteWikiLink("a", "  "), false);
assert.equal(canWriteWikiLink("a", "Note#Heading"), true);

/* ---- wikilinks: rewrite, convert, unlink ---- */
{
  const at = (text) => enclosingWikiLink(text, 2);
  for (const text of [demo, "[[t]]", "[[t#h|x]]", "[[t|]]", "x [[folder/Note]] y"]) {
    const link = wikiLinksOnLine(text)[0];
    assert.equal(rewriteWikiLink(text, link, wikiLinkFields(link)), text, `unchanged fields keep ${text}`);
  }
  assert.equal(rewriteWikiLink(demo, only(demo), { text: "a demo", dest: "notion-flow-demo" }), "See [[notion-flow-demo|a demo]] for more.");
  assert.equal(rewriteWikiLink("[[t|a]]", at("[[t|a]]"), { text: "t", dest: "t" }), "[[t]]", "text equal to the target");
  assert.equal(rewriteWikiLink("[[t|a]]", at("[[t|a]]"), { text: "  ", dest: "t" }), "[[t]]", "empty text");
  assert.equal(rewriteWikiLink("[[t|x]]", at("[[t|x]]"), { text: "x", dest: "<My Note>" }), "[[My Note|x]]");
  assert.equal(rewriteWikiLink("[[t|x]]", at("[[t|x]]"), { text: "x", dest: "folder/Note.md" }), "[[folder/Note|x]]");
  assert.equal(rewriteWikiLink("[[t|x]]", at("[[t|x]]"), { text: "x", dest: "Note.md#H" }), "[[Note#H|x]]");
  assert.equal(rewriteWikiLink("[[A]]", at("[[A]]"), { text: "A", dest: "B" }), "[[B|A]]", "a new target keeps the visible text");
  assert.equal(rewriteWikiLink("a [[t]] b", enclosingWikiLink("a [[t]] b", 4), { text: "n", dest: "t" }), "a [[t|n]] b");
  const md = "See [[t|the demo]] x";
  assert.equal(wikiLinkToMarkdown(md, enclosingWikiLink(md, 6), { text: "the demo", dest: "https://x.test" }), "See [the demo](https://x.test) x");
  assert.equal(wikiLinkToMarkdown(md, enclosingWikiLink(md, 6), { text: "the demo", dest: "my note" }), "See [the demo](<my note>) x");
  assert.equal(wikiLinkToMarkdown(md, enclosingWikiLink(md, 6), { text: "", dest: "<my note>" }), "See [my note](<my note>) x");
  for (const [text, plain] of [["[[t|a]]", "a"], ["[[t]]", "t"], ["[[t#h]]", "t > h"], ["[[#h]]", "h"], ["[[t|]]", "t"]]) {
    assert.equal(unlinkWikiLink(`x ${text} y`, enclosingWikiLink(`x ${text} y`, 3)), `x ${plain} y`, `unlink ${text}`);
  }
}

/* ---- review-MOD-1: a link in a table row writes every pipe escaped ---- */
{
  // Reproduces the review probe first: without the flag a bare [[t]]
  // relabelled in a Source-mode row writes a raw separator (3 cells).
  const row = "| [[Old note]] | 12 |";
  const link = enclosingWikiLink(row, 4);
  const cells = (text) => text.replace(/\\\|/g, "").split("|").length - 2;
  assert.equal(cells(row), 2);
  assert.equal(rewriteWikiLink(row, link, { text: "Label", dest: "Old note" }), "| [[Old note|Label]] | 12 |",
    "the old behaviour, without inTable: 3 cells");
  const fixed = rewriteWikiLink(row, link, { text: "Label", dest: "Old note" }, { inTable: true });
  assert.equal(fixed, "| [[Old note\\|Label]] | 12 |", "inTable escapes the separator");
  assert.equal(cells(fixed), 2, "the row keeps its two cells");
  assert.equal(rewriteWikiLink(row, link, { text: "a|b", dest: "Old note" }, { inTable: true }), "| [[Old note\\|a\\|b]] | 12 |");
  assert.equal(rewriteWikiLink(row, link, { text: "Old note", dest: "Old note" }, { inTable: true }), row, "unchanged stays unchanged");
  const md = wikiLinkToMarkdown("| [[t]] | x |", enclosingWikiLink("| [[t]] | x |", 3), { text: "a|b", dest: "https://x.test" }, { inTable: true });
  assert.equal(md, "| [a\\|b](https://x.test) | x |", "Markdown fallback escapes the label's pipe");
  assert.equal(cells(md), 2);
  assert.equal(wikiLinkToMarkdown("[[t]] x", enclosingWikiLink("[[t]] x", 2), { text: "a|b", dest: "https://x.test" }), "[a|b](https://x.test) x",
    "outside a table nothing is escaped");
  assert.equal(escapeLinkLabelPipes("a|b", { inTable: true }), "a\\|b");
  assert.equal(escapeLinkLabelPipes("a\\|b", { inTable: true }), "a\\|b", "an escaped pipe stays one");
  assert.equal(escapeLinkLabelPipes("a|b"), "a|b");
}

/* ---- review-MOD-3: a label ending in "]" goes to Markdown, brackets escaped ---- */
{
  assert.equal(canWriteWikiLink("a]", "n"), false, "a]]] would close the link early");
  assert.equal(canWriteWikiLink("[x]", "n"), false);
  assert.equal(canWriteWikiLink("a] ", "n"), false, "trailing space trimmed first");
  assert.equal(canWriteWikiLink("a]b", "n"), true, "an inner ] round-trips");
  assert.equal(canWriteWikiLink("[a", "n"), true);
  const line = "x [[n]] y";
  const link = enclosingWikiLink(line, 3);
  for (const [text, label] of [["a]", "a\\]"], ["[x]", "\\[x\\]"], ["a]b", "a\\]b"], ["a\\]", "a\\]"]]) {
    const out = wikiLinkToMarkdown(line, link, { text, dest: "https://x.test" });
    assert.equal(out, `x [${label}](https://x.test) y`, `label ${text}`);
    // The written link reads back whole: its text is the escaped label.
    const back = enclosingMarkdownLink(out, 3, 3);
    assert.ok(back && back.dest === "https://x.test" && back.text === label, `reparse ${text}: ${JSON.stringify(back)}`);
  }
}

/* ---- item 18: what the link card opens on (linkCardTarget) ---- */
{
  assert.deepEqual(markdownLinksOnLine("a [b](c) d [e [f]](g) ![h](i) [[j]]").map((l) => [l.text, l.dest]),
    [["b", "c"], ["e [f]", "g"]], "Markdown links left to right; images and wikilinks skipped");
  const demoLine = "See [[notion-flow-demo|the demo]] for more.";
  const inAlias = linkCardTarget(demoLine, 26, 26);
  assert.equal(inAlias.kind, "wiki", "caret inside the alias edits the wikilink");
  assert.equal(inAlias.link.target, "notion-flow-demo");
  const whole = linkCardTarget(demoLine, 4, 33);
  assert.equal(whole.kind, "wiki", "a selection over exactly the wikilink edits it");
  const spaced = linkCardTarget(demoLine, 3, 34);
  assert.equal(spaced.kind, "wiki", "only whitespace beside the one link: still that link");
  const partial = linkCardTarget(demoLine, 0, 12);
  assert.deepEqual(partial, { kind: "text", from: 0, to: 33, text: "See the demo", flattened: true },
    "text plus part of a wikilink grows to the whole link, flattened to its display text");
  const covers = "see [[x]] here";
  assert.deepEqual(linkCardTarget(covers, 0, covers.length),
    { kind: "text", from: 0, to: 14, text: "see x here", flattened: true }, "see [[x]] here flattens");
  const two = "a [b](u) c [[d|D]] e";
  assert.deepEqual(linkCardTarget(two, 0, two.length), { kind: "text", from: 0, to: two.length, text: "a b c D e", flattened: true },
    "several links of both kinds");
  assert.deepEqual(linkCardTarget(two, 5, 13), { kind: "text", from: 2, to: 18, text: "b c D", flattened: true },
    "partial overlaps at both ends grow to both links");
  const mdPart = linkCardTarget("say [hello there](u) now", 0, 9);
  assert.deepEqual(mdPart, { kind: "text", from: 0, to: 20, text: "say hello there", flattened: true });
  assert.equal(linkCardTarget("say [hello there](u) now", 5, 10).kind, "markdown", "inside the Markdown link");
  const plain = "no links here";
  assert.deepEqual(linkCardTarget(plain, 3, 8), { kind: "text", from: 3, to: 8, text: "links", flattened: false });
  assert.deepEqual(linkCardTarget(plain, 3, 3), { kind: "text", from: 3, to: 3, text: "", flattened: false });
  // An embed is never flattened: the span stops before it, or starts after.
  const emb = "look ![[pic.png]] and [[n]] end";
  assert.deepEqual(linkCardTarget(emb, 0, 12), { kind: "text", from: 0, to: 4, text: "look", flattened: false },
    "ends before the embed");
  assert.deepEqual(linkCardTarget(emb, 5, emb.length), { kind: "text", from: 18, to: 31, text: "and n end", flattened: true },
    "starts after the embed when nothing precedes it");
  assert.deepEqual(linkCardTarget("![[pic.png]]", 0, 12), { kind: "text", from: 0, to: 12, text: "![[pic.png]]", flattened: false },
    "only an embed: left as it was");
  // A wikilink written inside a Markdown link's text belongs to that link.
  assert.equal(linkCardTarget("x [see [[w]]](u) y", 0, 18).text, "x see [[w]] y");
}

/* ---- popover: a small event-capable DOM fixture, as run-comment-operations ---- */
class Element extends EventTarget {
  constructor(doc, tag, options = {}) {
    super(); this.doc = doc; this.tag = tag; this.options = options; this.classes = new Set();
    this.style = {}; this.value = options.value ?? ""; this.text = options.text ?? "";
    this.offsetWidth = 320; this.offsetHeight = 120; this.children = []; doc.elements.push(this);
  }
  createEl(tag, options = {}) { const el = new Element(this.doc, tag, options); this.children.push(el); return el; }
  createDiv(options) { return this.createEl("div", options); }
  createSpan(options) { return this.createEl("span", options); }
  setAttribute(name, value) { (this.attrs ??= {})[name] = value; }
  setText(text) { this.text = text; }
  toggleClass(cls, on) { on ? this.classes.add(cls) : this.classes.delete(cls); }
  focus() { this.doc.activeElement = this; }
  select() { this.selected = true; }
  remove() { this.removed = true; }
}
function fixture(opts = {}) {
  const doc = Object.assign(new EventTarget(), { elements: [] });
  doc.defaultView = Object.assign(new EventTarget(), {
    innerWidth: 1000, innerHeight: 800,
    navigator: { clipboard: { readText: async () => opts.clip ?? "" } },
  });
  doc.body = new Element(doc, "body");
  const f = { doc, saved: [], opened: [], unlinked: 0, closed: 0 };
  f.pop = new LinkPopover({
    doc, anchor: opts.anchor ?? { left: 100, top: 200, bottom: 220 }, text: opts.text ?? "", dest: opts.dest ?? "",
    hasLink: opts.hasLink ?? false, kind: opts.kind,
    onSave: (text, dest) => f.saved.push([text, dest]),
    onOpen: opts.noOpen ? undefined : (dest) => f.opened.push(dest),
    onUnlink: () => f.unlinked++,
    onClose: () => f.closed++,
  });
  f.card = () => doc.elements.find((el) => el.options.cls === "nf-link-pop");
  f.input = (kind) => doc.elements.find((el) => el.tag === "input" && el.options.cls?.includes(`nf-link-${kind}`));
  // Open is an icon (no text); the other actions are found by their label.
  f.button = (text) => doc.elements.find((el) => el.tag === "button" &&
    (text === "Open" ? el.options.cls?.includes("nf-link-open") : el.options.text === text));
  f.hint = () => doc.elements.find((el) => el.options.cls === "nf-link-hint");
  f.key = (kind, key, extra = {}) => {
    const event = new Event("keydown", { cancelable: true });
    Object.assign(event, { key, ...extra });
    f.input(kind).dispatchEvent(event);
  };
  f.pop.open();
  return f;
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

{
  // Structure, placeholders, anchoring and focus.
  const f = fixture({ text: "docs", dest: "https://ex.com" });
  assert.equal(f.pop.isOpen, true);
  assert.equal(f.input("text").options.attr.placeholder, "Link text");
  assert.equal(f.input("dest").options.attr.placeholder, "URL or note path");
  assert.equal(f.input("text").value, "docs");
  assert.equal(f.input("dest").value, "https://ex.com");
  assert.equal(f.hint().text, "", "nothing to explain for a plain URL");
  assert.equal(f.button("Save").options.cls, "mod-cta");
  assert.ok(f.button("Open"));
  assert.equal(f.button("Open").style.display, "", "Open shows for a destination");
  assert.equal(f.button("Unlink"), undefined, "no Unlink without an existing link");
  assert.equal(f.card().style.left, "88px", "12px left of the anchor");
  assert.equal(f.card().style.top, "228px", "8px below the anchor");
  assert.equal(f.doc.activeElement, f.input("dest"), "editing focuses the destination");
  assert.equal(f.input("dest").selected, true);
  f.key("dest", "Enter");
  assert.deepEqual(f.saved, [["docs", "https://ex.com"]]);
  assert.equal(f.card().removed, true);
  assert.equal(f.closed, 1);
  assert.equal(f.pop.isOpen, false);
  f.pop.close();
  assert.equal(f.closed, 1, "closing twice notifies once");
}
{
  // Clipboard URL pre-fills an empty destination, selected so typing replaces it.
  const f = fixture({ text: "sel", clip: "  https://ex.com/x  " });
  assert.equal(f.doc.activeElement, f.input("dest"), "linking a selection focuses the destination");
  await tick();
  assert.equal(f.input("dest").value, "https://ex.com/x");
  assert.equal(f.input("dest").selected, true);
  f.key("text", "Enter");
  assert.deepEqual(f.saved, [["sel", "https://ex.com/x"]], "Enter in either input saves");
}
{
  // Non-URL clipboard text and typed text are left alone.
  const f = fixture({ clip: "just words" });
  assert.equal(f.doc.activeElement, f.input("text"), "a link from nothing starts with its text");
  await tick();
  assert.equal(f.input("dest").value, "");
  const g = fixture({ dest: "note.md", clip: "https://ex.com" });
  await tick();
  assert.equal(g.input("dest").value, "note.md", "an existing destination is never replaced");
  const h = fixture({ clip: "https://late.example" });
  h.input("dest").value = "typed";
  await tick();
  assert.equal(h.input("dest").value, "typed", "text typed before the clipboard resolves wins");
}
{
  // An empty destination cannot be saved; the hint explains and focus moves there.
  const f = fixture({ text: "x" });
  f.input("text").focus();
  f.key("text", "Enter");
  assert.deepEqual(f.saved, []);
  assert.equal(f.card().removed, undefined, "stays open");
  assert.equal(f.hint().text, "Enter a destination");
  assert.ok(f.hint().classes.has("nf-link-hint-error"));
  assert.equal(f.doc.activeElement, f.input("dest"));
  f.input("dest").value = "a b.md";
  f.input("dest").dispatchEvent(new Event("input"));
  assert.equal(f.hint().text, "Spaces are wrapped in <…>", "typing clears the error");
  assert.ok(!f.hint().classes.has("nf-link-hint-error"));
  f.button("Save").dispatchEvent(new Event("click"));
  assert.deepEqual(f.saved, [["x", "<a b.md>"]], "whitespace paths are wrapped on save");
}
{
  // Empty text falls back to the destination; whitespace is trimmed.
  const f = fixture();
  f.input("dest").value = "  https://ex.com  ";
  f.key("dest", "Enter");
  assert.deepEqual(f.saved, [["https://ex.com", "https://ex.com"]]);
}
{
  // IME composition owns Enter and Escape.
  const f = fixture({ text: "t", dest: "d" });
  f.key("dest", "Enter", { isComposing: true });
  f.key("dest", "Escape", { keyCode: 229 });
  assert.deepEqual(f.saved, []);
  assert.equal(f.card().removed, undefined);
  f.key("dest", "Escape");
  assert.equal(f.card().removed, true, "Esc closes");
  assert.deepEqual(f.saved, [], "…without saving");
  assert.equal(f.closed, 1);
}
{
  // Clicking outside closes without saving; clicking inside keeps it open.
  const f = fixture({ text: "t", dest: "d" });
  f.input("dest").value = "changed";
  const inside = new Event("mousedown");
  inside.composedPath = () => [f.input("dest"), f.card(), f.doc];
  f.doc.dispatchEvent(inside);
  assert.equal(f.card().removed, undefined, "inside click keeps the card");
  const outside = new Event("mousedown");
  outside.composedPath = () => [f.doc.body, f.doc];
  f.doc.dispatchEvent(outside);
  assert.equal(f.card().removed, true);
  assert.deepEqual(f.saved, []);
  const stray = new Event("keydown", { cancelable: true });
  Object.assign(stray, { key: "Enter" });
  f.input("dest").dispatchEvent(stray);
  assert.deepEqual(f.saved, [], "a closed card ignores late keys");
}
{
  // Open and Unlink.
  const f = fixture({ text: "t", dest: "my note.md", hasLink: true });
  f.button("Open").dispatchEvent(new Event("click"));
  assert.deepEqual(f.opened, ["<my note.md>"]);
  assert.equal(f.card().removed, true);
  const g = fixture({ text: "t", dest: "d", hasLink: true });
  g.button("Unlink").dispatchEvent(new Event("click"));
  assert.equal(g.unlinked, 1);
  assert.equal(g.card().removed, true);
  assert.deepEqual(g.saved, []);
  const h = fixture({ text: "t", dest: "", hasLink: true });
  assert.equal(h.button("Open").style.display, "none", "hidden while there is nothing to open");
  h.button("Open").dispatchEvent(new Event("click"));
  assert.deepEqual(h.opened, [], "nothing to open");
  assert.equal(h.hint().text, "Enter a destination");
  const n = fixture({ noOpen: true });
  assert.equal(n.button("Open"), undefined, "no opener, no Open button");
  assert.equal(n.doc.elements.some((el) => el.options.cls?.includes("nf-link-open")), false);
}
{
  // Only one link card at a time; anchors can be getters and flip above when short of room.
  const a = fixture({ text: "a", dest: "a" });
  const b = fixture({ text: "b", dest: "b", anchor: () => ({ left: 2, top: 760, bottom: 780 }) });
  assert.equal(a.card().removed, true, "opening another card closes the first");
  assert.equal(a.closed, 1);
  assert.equal(b.card().style.left, "8px", "clamped to the viewport edge");
  assert.equal(b.card().style.top, "632px", "flipped above the anchor");
  b.doc.defaultView.innerHeight = 2000;
  b.doc.defaultView.dispatchEvent(new Event("resize"));
  assert.equal(b.card().style.top, "788px", "repositioned from the live anchor");
  LinkPopover.closeActive();
  assert.equal(b.card().removed, true);
}
{
  // An anchor scrolled out of the viewport keeps the card on screen.
  const above = fixture({ text: "a", dest: "a", anchor: () => ({ left: 100, top: -200, bottom: -180 }) });
  assert.equal(above.card().style.top, "8px", "clamped to the top edge");
  const below = fixture({ text: "b", dest: "b", anchor: () => ({ left: 100, top: 900, bottom: 920 }) });
  assert.equal(below.card().style.top, "672px", "clamped to the bottom edge");
  LinkPopover.closeActive();
}
{
  // The link's syntax is on the card.
  const md = fixture({ text: "a", dest: "b" });
  assert.equal(md.card().attrs["data-kind"], "markdown", "Markdown by default");
  const wiki = fixture({ text: "a", dest: "My Note", kind: "wiki" });
  assert.equal(wiki.card().attrs["data-kind"], "wiki");
  assert.equal(wiki.hint().text, "", "no <…> note for a wikilink target");
  LinkPopover.closeActive();
}
console.log("PASS markdown links: detection, destinations, rewrite/unlink, wikilinks and the link popover");
