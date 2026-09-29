// Round 2, wave 3 (R2-W3-MAIN): editor structure fixes and the wiring of the
// wave-2 modules. Each block names the item it covers.
import { EditorSelection, EditorState, Facet, Text } from "@codemirror/state";
import {
  blockTypeAt,
  calloutEditBlocks,
  calloutHeaderAt,
  calloutHeaderKeyPlan,
  captionSourceTarget,
  makeCalloutEditPlugin,
  makeNestedIndentPlugin,
  opensQuote,
  quoteEnterPlan,
  scanFences,
  dependentRowState,
  dependentStates,
  settingGroupHidden,
  splitDescription,
  GATE_SETTING,
  SlashSuggest,
  SLASH_COMMANDS,
  CALLOUT_SLASH_COMMANDS,
  SLASH_GROUP_ORDER,
  slashEntries,
  slashMenuLayout,
  slashRowDescription,
  columnSlashCompletion,
  formatSlashDate,
  editorHelpSections,
  tocChipRanges,
  tocOptionsFor,
  CODE_LANGUAGES,
  DEFAULT_SETTINGS,
  settingsAtDefaults,
  editorSensitiveKey,
  calloutIconFromMetadata,
  setCalloutMetaToken,
  VisualCalloutLeadWidget,
  blockColorTarget,
  blockColorValues,
  blockColorChanges,
  slashBlockColorPlan,
  turnIntoPagePlan,
  contiguousBlockSpan,
  RE_SLASH_TRIGGER,
  COLOR_SLASH_COMMANDS,
  turnBlockChange,
  buildBlockWrap,
  innerBlockAt,
  setImageAlign,
  imageAlignOf,
  imageSizePresets,
  setImageWidth,
  imageWidthOf,
  dropLevelAnchor,
  canRehover,
  computeDropLevels,
  emptyBlockHint,
  emptyHintEnabled,
  headingMarkerDeletePlan,
  backspaceMarkerPlan,
  listRenderingUnaffected,
  ownedBlockCaption,
  cachedFences,
  listNestingDepth,
  collectSourceListRendering,
  toggleDualFormat,
  applyTextColor,
  TEXT_COLORS,
  batchToggleFormatChanges,
  inlineFormatSpan,
  stepOverHiddenRows,
  snapOutOfHiddenPrefix,
  guardPopoverCommand,
  focusInPluginPopover,
  linkSavePlan,
  buildBlockCaption,
} from "./bundle.mjs";
import NotionFlowPlugin from "./bundle.mjs";
import { COMPONENTS, COMPONENT_KEYS, NOTE_STYLE_DEFAULTS, searchSlashCommands, languageLabel, whatsNewRows, findColorTagPairs, clearBodyStyle, parseChord, chordTakenByOther, codeSpanRanges, linkCardTarget, markdownLinksOnLine, wikiLinksOnLine, enclosingWikiLink, enclosingMarkdownLink, wikiLinkFields, normalizeLinkDest, createCaptionEditingExtensions } from "./features.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
};
const eq = (name, actual, expected) =>
  ok(name, JSON.stringify(actual) === JSON.stringify(expected),
    `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);

const ALL_ON = { calloutEditing: true, codeBlockEditing: true, toggleBlocks: true, columnLayout: true };

/** The Callout edit plugin's decorations over `text`, caret at `caret`
 *  (null: no caret anywhere near, as if the view held it elsewhere). */
function editPass(text, caret, settings = ALL_ON) {
  const state = EditorState.create({ doc: text, selection: { anchor: caret ?? 0 } });
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: { clientWidth: 700, style: { setProperty() {} } },
    dom: { closest: (selector) => (String(selector).includes("is-live-preview") ? {} : null) },
  };
  const Plugin = makeCalloutEditPlugin({ settings, app: {} });
  const instance = Object.create(Plugin.prototype);
  const ranges = instance.build.call(instance, view);
  return { state, instance, ranges: [...ranges] };
}

/** The line classes / inline style the edit pass gives line `n` (1-based). */
function rowOf(pass, n) {
  const from = pass.state.doc.line(n).from;
  const lines = pass.ranges.filter((r) => r.kind === "line" && r.from === from);
  return {
    cls: lines.map((r) => r.spec.attributes?.class ?? "").join(" ").split(/\s+/).filter(Boolean),
    style: lines.map((r) => r.spec.attributes?.style ?? "").join(""),
  };
}

/** The nested-indent pass (a real RangeSet) over `text`, flattened. */
function nestedPass(text) {
  const state = EditorState.create({ doc: text });
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    dom: { ownerDocument: { defaultView: {} } },
  };
  const Cls = makeNestedIndentPlugin({ settings: ALL_ON, app: {} });
  const instance = Object.create(Cls.prototype);
  instance.view = view;
  instance.fences = scanFences(state.doc);
  instance.codeSpans = new Map();
  const set = instance.build.call(instance, view);
  const out = [];
  for (const it = set.iter(); it.value; it.next()) {
    out.push({ from: it.from, to: it.to, kind: it.value.kind, spec: it.value.spec });
  }
  return { state, ranges: out };
}

/* ---------- w2c-qlist-lead: one element spans a quoted list row's "- " ---------- */
{
  const pass = nestedPass("> - a\n> 1. b\n> - [ ] c\n>   - deep");
  const doc = pass.state.doc;
  const marks = (cls) => pass.ranges.filter((r) => r.kind === "mark" && (r.spec?.class ?? "").split(" ").includes(cls));
  const slices = (cls) => marks(cls).map((r) => doc.sliceString(r.from, r.to));
  eq("qlist: the lead spans each marker and the spaces after it", slices("nf-qlist-lead"), ["- ", "1. ", "- ", "- "]);
  eq("qlist: the marker mark is unchanged (the glyph only)", slices("nf-qlist-marker"), ["-", "1.", "-", "-"]);
  const lead = marks("nf-qlist-lead")[0];
  ok("qlist: the lead ends where the text starts", lead.to === doc.line(1).from + 4, JSON.stringify(lead));
  // Same start, later end: CodeMirror orders marks of one set by their end
  // and draws the longer one outside, so the marker nests in the lead.
  const inner = marks("nf-qlist-marker")[0];
  ok("qlist: the lead starts with the marker and ends after it",
    lead.from === inner.from && lead.to > inner.to, JSON.stringify({ lead, inner }));
  const lineCls = (n) => pass.ranges.filter((r) => r.kind === "line" && r.from === doc.line(n).from)
    .map((r) => r.spec.attributes?.class ?? "").join(" ");
  ok("qlist: a to-do row says so (nf-qlist-task), so the lead's floor can spare its checkbox",
    lineCls(3).includes("nf-qlist-task") && !lineCls(1).includes("nf-qlist-task") && !lineCls(2).includes("nf-qlist-task"),
    [1, 2, 3].map(lineCls).join(" | "));
  ok("qlist: plain prose in a quote gets no lead", nestedPass("> text").ranges.every((r) => r.spec?.class !== "nf-qlist-lead"));
}

/* ---------- w2c-qlist-lead: nf-co-qlist marks list rows of an open box ---------- */
{
  const text = "> [!note] T\n> - item one\n> para\n> 1. two";
  const open = editPass(text, text.indexOf("item one") + 2);
  ok("qlist: a list row in an open Callout carries nf-co-qlist", rowOf(open, 2).cls.includes("nf-co-qlist"), rowOf(open, 2).cls.join(" "));
  ok("qlist: …an ordered one too", rowOf(open, 4).cls.includes("nf-co-qlist"), rowOf(open, 4).cls.join(" "));
  ok("qlist: prose rows do not", !rowOf(open, 3).cls.includes("nf-co-qlist") && rowOf(open, 3).cls.includes("nf-co-hang"));
  ok("qlist: the header does not", !rowOf(open, 1).cls.includes("nf-co-qlist"));
  ok("qlist: a list row has no hang of its own", !rowOf(open, 2).cls.includes("nf-co-hang"));
  const toggle = "> [!nf-toggle]+ T\n> - item";
  const t = editPass(toggle, toggle.length);
  ok("qlist: a list row in an open toggle carries it", rowOf(t, 2).cls.includes("nf-co-qlist"), rowOf(t, 2).cls.join(" "));
  const shut = editPass("para\n\n" + text, 0);
  ok("qlist: a closed top-level Callout's rows do not (Obsidian draws it)", !rowOf(shut, 4).cls.includes("nf-co-qlist"), rowOf(shut, 4).cls.join(" "));
  const fenced = "> [!note] T\n> ```\n> - not a list\n> ```";
  const f = editPass(fenced, fenced.indexOf("not"));
  ok("qlist: a code row that looks like a list does not", !rowOf(f, 3).cls.includes("nf-co-qlist"), rowOf(f, 3).cls.join(" "));
}

/* ---------- w2c-callout-header-opens-quote: only a quote's first row is a header ---------- */
{
  const doc = (text) => Text.of(text.split("\n"));
  const spans = (text) => calloutEditBlocks(doc(text), 1, doc(text).lines).map((b) => [b.startLine, b.endLine]);
  eq("opens: a [!type] row in the middle of a quote is no Callout",
    spans("> quote first line\n> [!warning]- not a header"), []);
  eq("opens: a header after a paragraph and a blank row is one",
    spans("para\n\n> [!warning]- x\n> body"), [[3, 4]]);
  eq("opens: a header on line 1 is one", spans("> [!note] T\n> body"), [[1, 2]]);
  eq("opens: a nested header under a shallower row is one",
    spans("> [!note] N\n> > [!tip] T\n> > body"), [[1, 3], [2, 3]]);
  eq("opens: a header under an equal-depth quote row is not (> > quote / > > [!tip])",
    spans("> > quote\n> > [!tip] T"), []);
  eq("opens: nor one after a quoted blank row — the box above runs on",
    spans("> [!note] One\n> first\n>\n> [!warning] Two\n> second"), [[1, 5]]);
  eq("opens: a Callout after a lower-depth blank row inside a quote is one",
    spans("> > [!a] A\n> > x\n>\n> > [!b] B"), [[1, 2], [4, 4]]);
  ok("opens: opensQuote / calloutHeaderAt agree",
    opensQuote(doc("> q\n> [!x] y"), 2) === false && calloutHeaderAt(doc("> q\n> [!x] y"), 2) === null &&
      calloutHeaderAt(doc("q\n> [!x] y"), 2)?.type === "x");

  // Live Preview: the mid-quote row carries no nf-co-* class, caret in or out.
  const text = "> quote first line\n> [!warning]- not a header";
  for (const [where, caret] of [["away", null], ["on the row", text.length]]) {
    const pass = editPass("para\n\n" + text, caret == null ? 0 : caret + 6);
    const cls = rowOf(pass, 4).cls;
    ok(`opens: LP paints no Callout row (caret ${where})`, !cls.some((c) => c.startsWith("nf-co-")), cls.join(" "));
    ok(`opens: …and no lead widget replaces its token (caret ${where})`,
      !pass.ranges.some((r) => r.kind === "replace" && r.from >= pass.state.doc.line(4).from && r.spec?.widget?.constructor?.name === "VisualCalloutLeadWidget"));
  }
  // Inside an open Callout, a later "[!type]" body row stays prose.
  const box = "> [!note] One\n> first\n>\n> [!warning] Two";
  const inBox = editPass(box, box.indexOf("first"));
  const leads = inBox.ranges.filter((r) => r.kind === "replace" && r.spec?.widget?.constructor?.name === "VisualCalloutLeadWidget");
  eq("opens: an open box draws one lead widget, on its own header", leads.map((r) => inBox.state.doc.lineAt(r.from).number), [1]);
  ok("opens: the [!warning] body row hangs like prose", rowOf(inBox, 4).cls.includes("nf-co-hang") && !rowOf(inBox, 4).cls.includes("nf-co-first"),
    rowOf(inBox, 4).cls.join(" "));

  // Block typing reads it as text, and the header keys leave it alone.
  eq("opens: blockTypeAt reads the mid-quote row as text",
    blockTypeAt(doc("> [!note] One\n>\n> [!tip] Two"), { startLine: 3, endLine: 3, quotePrefix: "> " }), "text");
  eq("opens: …and a real header as a Callout",
    blockTypeAt(doc("para\n> [!tip] Two"), { startLine: 2, endLine: 2 }), "callout");
  const mid = doc("> quote\n> [!warning] x");
  ok("opens: Home on a mid-quote [!type] row is the editor's own", calloutHeaderKeyPlan(mid, mid.line(2).to, "Home") === null);
  const real = doc("> [!warning] x");
  ok("opens: Home on a real header still goes to the title", calloutHeaderKeyPlan(real, real.line(1).to, "Home")?.cursor === "> [!warning] ".length);
  const enter = doc("> quote\n> [!note] x\n>");
  const plan = quoteEnterPlan(enter, enter.line(2).to);
  ok("opens: Enter at the end of a mid-quote [!type] row makes a new row, not a move into the one below",
    plan && plan.insert.startsWith("\n"), JSON.stringify(plan));
}

/* ---------- w2c-caption-source-target: a caption deep in a rendered Callout ---------- */
{
  // The rendered Callout is one block widget; posAtDOM of anything in it is
  // the widget's first row. Fake just that much DOM.
  const text = [
    "# T",                                                        // 1
    "",                                                           // 2
    "> [!note] Box",                                              // 3
    "> intro",                                                    // 4
    "> ```js",                                                    // 5
    "> let a = 1;",                                               // 6
    "> ```",                                                      // 7
    '> <small class="nf-caption" data-nf-kind="code">One</small>', // 8
    "> ```py",                                                    // 9
    "> b = 2",                                                    // 10
    "> ```",                                                      // 11
    '> <small class="nf-caption" data-nf-kind="code">Two</small>', // 12
    "",                                                           // 13
    "```",                                                        // 14
    "top",                                                        // 15
    "```",                                                        // 16
    '<small class="nf-caption" data-nf-kind="code">Three</small>',  // 17
  ].join("\n");
  const state = EditorState.create({ doc: text });
  const el = (props) => ({
    dataset: {},
    matches: () => false,
    closest: () => null,
    querySelectorAll: () => [],
    ...props,
  });
  const lineFrom = (n) => state.doc.line(n).from;
  const view = {
    state,
    contentDOM: { contains: () => true },
    posAtDOM: (node) => node.pos,
  };
  const editorEl = { __nfView: view };
  const widget = el({ pos: lineFrom(3), matches: (sel) => sel === ".cm-callout" });
  const captions = [1, 2].map(() => el({ dataset: { nfKind: "code" }, pos: lineFrom(3) }));
  widget.querySelectorAll = () => captions;
  for (const caption of captions) {
    caption.closest = (sel) => (sel === ".cm-editor" ? editorEl : sel === ".cm-embed-block" ? widget : null);
  }
  const first = captionSourceTarget(captions[0]);
  const second = captionSourceTarget(captions[1]);
  ok("caption: the first caption in a rendered Callout resolves to its own code block (line 5)",
    first?.kind === "code" && first?.ownerLine === 5, JSON.stringify(first && { kind: first.kind, ownerLine: first.ownerLine }));
  ok("caption: the second, six rows below the widget's first row, to its own (line 9)",
    second?.ownerLine === 9, JSON.stringify(second && { ownerLine: second.ownerLine }));
  // A caption on its own row keeps the search near that row.
  const own = el({ dataset: { nfKind: "code" }, pos: lineFrom(17) });
  own.closest = (sel) => (sel === ".cm-editor" ? editorEl : null);
  ok("caption: a caption on its own row still finds its block", captionSourceTarget(own)?.ownerLine === 14);
  // A caption inside an embedded note inside the box is not this box's.
  const embed = el({});
  widget.contains = (node) => node === embed;
  const embedded = el({ dataset: { nfKind: "code" }, pos: lineFrom(3) });
  embedded.closest = (sel) => (sel === ".cm-editor" ? editorEl : sel === ".cm-embed-block" ? widget
    : sel.includes("markdown-embed") ? embed : null);
  ok("caption: a caption from an embedded note is not matched to the box's rows", captionSourceTarget(embedded) === null);
}

/* ---------- review2-css-w2-1: every Callout edit row publishes --nf-co-boxes ---------- */
{
  const boxes = (pass, n) => Number(rowOf(pass, n).style.match(/--nf-co-boxes:(\d+);/)?.[1] ?? NaN);
  const depth = (pass, n) => Number(rowOf(pass, n).style.match(/--nf-co-depth:(\d+);/)?.[1] ?? NaN);
  // A Callout inside a toggle: one box (the Callout), two layers.
  const ct = "> [!nf-toggle]+ T\n> > [!note] N\n> > note body";
  const p1 = editPass(ct, ct.length);
  eq("boxes: Callout in a toggle — the toggle's own rows count no box", [1, 2, 3].map((n) => boxes(p1, n)), [0, 1, 1]);
  eq("boxes: …while the depth still counts both layers", [1, 2, 3].map((n) => depth(p1, n)), [1, 2, 2]);
  // Callout in a Callout: two boxes on the inner rows.
  const cc = "> [!note] A\n> > [!tip] B\n> > body";
  const p2 = editPass(cc, cc.length);
  eq("boxes: Callout in a Callout — the inner rows count both boxes", [1, 2, 3].map((n) => boxes(p2, n)), [1, 2, 2]);
  // Toggle in a toggle in a Callout: one box on every row.
  const ttc = "> [!note] C\n> > [!nf-toggle]+ A\n> > > [!nf-toggle]+ B\n> > > body";
  const p3 = editPass(ttc, ttc.length);
  eq("boxes: toggle in a toggle in a Callout — only the Callout is a box", [1, 2, 3, 4].map((n) => boxes(p3, n)), [1, 1, 1, 1]);
  // Fence rows publish it too.
  const fc = "> [!nf-toggle]+ T\n> > [!note] N\n> > ```\n> > code\n> > ```";
  const p4 = editPass(fc, fc.indexOf("code"));
  eq("boxes: a fence's rows inside the Callout carry it", [3, 4, 5].map((n) => boxes(p4, n)), [1, 1, 1]);
  // With toggles drawn as plain Callouts, a toggle is a box.
  const p5 = editPass(ct, ct.length, { ...ALL_ON, toggleBlocks: false });
  eq("boxes: with toggle blocks off, the toggle is a box like any Callout", [1, 2, 3].map((n) => boxes(p5, n)), [1, 2, 2]);
}

/* ---------- w2c-plain-quote-container-rest: a box in a plain quote is drawn open at rest ---------- */
{
  const widgets = (pass, n) => pass.ranges
    .filter((r) => r.kind === "replace" && pass.state.doc.lineAt(r.from).number === n)
    .map((r) => r.spec?.widget?.constructor?.name ?? "hidden");
  const same = (a, b, n) => JSON.stringify({ cls: rowOf(a, n).cls, style: rowOf(a, n).style, w: widgets(a, n) }) ===
    JSON.stringify({ cls: rowOf(b, n).cls, style: rowOf(b, n).style, w: widgets(b, n) });
  for (const [name, text, rows] of [
    ["toggle", "para\n\n> quote\n> > [!nf-toggle]+ T\n> > body", [4, 5]],
    ["toggle two deep", "para\n\n> quote\n> > > [!nf-toggle]+ T\n> > > body", [4, 5]],
    ["Callout", "para\n\n> quote\n> > [!note] N\n> > body", [4, 5]],
    ["Callout opening the quote", "para\n\n> > [!note] N\n> > body", [3, 4]],
  ]) {
    const rest = editPass(text, 0);
    const body = rows[1];
    const inside = editPass(text, rest.state.doc.line(body).to);
    ok(`quoted ${name}: the body row hides its "> " at rest`,
      widgets(rest, body).includes("VisualStructureGapWidget") &&
        rest.instance.zones.some((z) => z.from === rest.state.doc.line(body).from), JSON.stringify(widgets(rest, body)));
    ok(`quoted ${name}: the body row hangs at rest`, rowOf(rest, body).cls.includes("nf-co-hang"), rowOf(rest, body).cls.join(" "));
    ok(`quoted ${name}: the body row is the same at rest and with the caret in it`, same(rest, inside, body),
      JSON.stringify([rowOf(rest, body), widgets(rest, body), rowOf(inside, body), widgets(inside, body)]));
    if (name.startsWith("Callout")) {
      ok(`quoted ${name}: its header shows the lead widget at rest`, widgets(rest, rows[0]).includes("VisualCalloutLeadWidget"),
        JSON.stringify(widgets(rest, rows[0])));
      ok(`quoted ${name}: the header row is the same in both states`, same(rest, inside, rows[0]));
    } else {
      ok(`quoted ${name}: its header shows the triangle at rest`, widgets(rest, rows[0]).includes("ToggleMarkWidget"),
        JSON.stringify(widgets(rest, rows[0])));
    }
  }
  // A top-level Callout or toggle stays Obsidian's widget at rest.
  for (const text of ["para\n\n> [!note] N\n> body", "para\n\n> [!nf-toggle]+ T\n> body"]) {
    const rest = editPass(text, 0);
    // (The toggle's triangle mark is laid down regardless; Obsidian's widget
    // covers the rows at rest.)
    const drawn = rest.ranges.filter((r) => r.kind === "replace" && /Gap|Lead/.test(r.spec?.widget?.constructor?.name ?? ""));
    ok(`top-level ${text.includes("toggle") ? "toggle" : "Callout"}: no gap or lead is drawn at rest`,
      drawn.length === 0 && rest.instance.zones.length === 0, JSON.stringify(drawn));
  }
  // A Callout inside a Callout inside a plain quote: the outer box is the
  // quoted one; the inner opens with it.
  const nested = "para\n\n> quote\n> > [!note] A\n> > > [!tip] B\n> > > body";
  const n1 = editPass(nested, 0);
  ok("quoted nest: the inner box is open at rest too", widgets(n1, 6).includes("VisualStructureGapWidget") && widgets(n1, 5).includes("VisualCalloutLeadWidget"),
    JSON.stringify([widgets(n1, 5), widgets(n1, 6)]));
}

/* ---------- Item 8: dependent settings rows follow every parent ---------- */
{
  const on = { a: true, b: true };
  eq("dependentRowState: no parents is on", dependentRowState([], on, new Map()), "on");
  eq("dependentRowState: one off parent with one row dims", dependentRowState(["a"], { a: false }, new Map([["a", 1]])), "dim");
  eq("dependentRowState: one off parent with 17 rows hides", dependentRowState(["a"], { a: false }, new Map([["a", 17]])), "hide");
  eq("dependentRowState: of two parents only the 6-row one off hides",
    dependentRowState(["a", "b"], { a: true, b: false }, new Map([["a", 17], ["b", 6]])), "hide");
  eq("dependentRowState: of two parents only the 1-row one off dims",
    dependentRowState(["a", "b"], { a: false, b: true }, new Map([["a", 1], ["b", 6]])), "dim");
  eq("dependentRowState: both on", dependentRowState(["a", "b"], on, new Map([["a", 17], ["b", 6]])), "on");
  eq("dependentRowState: exactly 3 rows still dim", dependentRowState(["a"], { a: false }, new Map([["a", 3]])), "dim");

  // The tab's registrations: the canvas rows, the three lone dependents and
  // the Note style section's gated Customize rows (dimOnly).
  const canvasOnly = ["keyboard", "editorKeys", "autoLayout", "autoFit", "comfortable", "cardSize", "animation", "minimap", "progress", "appearance", "background"]
    .map((name) => ({ name, parents: ["canvasEnhancements"] }));
  const canvasLook = ["mapStyle", "followPalette", "lineStyle", "font", "shape", "lineWeight", "textScale"]
    .map((name) => ({ name, parents: ["canvasEnhancements", "canvasAppearance"] }));
  const lone = [
    { name: "emptyLineHint", parents: ["slashCommands"] },
    { name: "blockSelectKey", parents: ["dragHandles"] },
    { name: "commentHoverCard", parents: ["commenting"] },
  ];
  const custom = COMPONENT_KEYS.filter((k) => COMPONENTS[k].gate)
    .map((k) => ({ name: k, parents: [GATE_SETTING[COMPONENTS[k].gate]], dimOnly: true }));
  const rows = [...canvasOnly, ...canvasLook, ...lone, ...custom];
  const all = { canvasEnhancements: true, canvasAppearance: true, slashCommands: true, dragHandles: true, commenting: true,
    cleanRendering: true, calloutEditing: true, tableStyle: true, toggleBlocks: true, columnLayout: true };
  const pick = (values, state) => rows.filter((_, i) => dependentStates(rows, values)[i] === state).map((r) => r.name);
  eq("dependentStates: everything on", pick(all, "on").length, rows.length);
  eq("dependentStates: Canvas enhancements off hides every canvas row", [pick({ ...all, canvasEnhancements: false }, "hide").length, pick({ ...all, canvasEnhancements: false }, "dim")],
    [canvasOnly.length + canvasLook.length, []]);
  eq("dependentStates: Canvas appearance off hides the look rows only", pick({ ...all, canvasAppearance: false }, "hide"), canvasLook.map((r) => r.name));
  ok("dependentStates: Fit, Card sizing and Background stay on without appearance",
    ["autoFit", "cardSize", "background"].every((n) => pick({ ...all, canvasAppearance: false }, "on").includes(n)));
  eq("dependentStates: Drag-and-drop off dims Select blocks", pick({ ...all, dragHandles: false }, "dim"), ["blockSelectKey"]);
  eq("dependentStates: Cleaner rendering off dims exactly its 5 Customize rows, never hides them",
    [pick({ ...all, cleanRendering: false }, "dim"), pick({ ...all, cleanRendering: false }, "hide")],
    [["headingStyle", "quoteStyle", "checkboxStyle", "dividerStyle", "inlineCodeStyle"], []]);
  eq("dependentStates: Notion-style tables off dims Table look only", pick({ ...all, tableStyle: false }, "dim"), ["tableLook"]);
  ok("GATE_SETTING maps every component gate to a boolean settings key",
    COMPONENT_KEYS.every((k) => !COMPONENTS[k].gate || typeof all[GATE_SETTING[COMPONENTS[k].gate]] === "boolean"));

  eq("settingGroupHidden: every row hidden", settingGroupHidden([{ row: true, hidden: true }, { row: true, hidden: true }]), true);
  eq("settingGroupHidden: one row shown", settingGroupHidden([{ row: true, hidden: true }, { row: true, hidden: false }]), false);
  eq("settingGroupHidden: other content keeps the group", settingGroupHidden([{ row: true, hidden: true }, { row: false, hidden: false }]), false);
  eq("settingGroupHidden: an empty list is not hidden", settingGroupHidden([]), false);
}

/* ---------- Item 1: the plugin's note-style host ---------- */
{
  const plugin = Object.create(NotionFlowPlugin.prototype);
  plugin.app = {};
  plugin.settings = { ...NOTE_STYLE_DEFAULTS, cleanRendering: true };
  const log = [];
  plugin.saveSettings = async () => { log.push("save"); };
  plugin.styleDocuments = () => ["doc"];
  plugin.applyNoteStyle = (docs, style) => log.push(["apply", docs, style?.classes ?? null]);
  plugin.settingTab = { noteStyleChangedIfShown: () => log.push("tab") };
  const host = plugin.noteStyleHost();
  const replaced = { ...NOTE_STYLE_DEFAULTS, palette: "nord" };
  plugin.settings = replaced;
  ok("noteStyleHost().settings follows a replaced settings object", host.settings === replaced);
  host.preview({ ...NOTE_STYLE_DEFAULTS, palette: "notion", look: "soft" });
  ok("preview never saves", !log.includes("save"), JSON.stringify(log));
  const previewed = log.find((e) => Array.isArray(e) && e[0] === "apply");
  ok("preview writes the previewed style on every window",
    !!previewed && previewed[1][0] === "doc" && previewed[2].includes("nf-palette-notion") && previewed[2].includes("nf-callout-card"),
    JSON.stringify(previewed));
  log.length = 0;
  await host.save();
  eq("save saves, then refreshes the open settings tab", log, ["save", "tab"]);
  log.length = 0;
  host.changed();
  host.apply();
  eq("changed refreshes the tab; apply writes the saved style", log.map((e) => (Array.isArray(e) ? e[0] : e)), ["tab", "apply"]);
}

/* ---------- Item 9: settings copy ---------- */
{
  // The rewritten cleanRendering description keeps its promise visible.
  const clean = splitDescription("Apply display-only polish to quotes, dividers, headings, tasks, inline code, and Mermaid diagrams in Live Preview and Reading view. Bullet and number styles by list depth are unaffected. Your Markdown is never changed.");
  eq("cleanRendering description: first sentence visible, the rest behind Details",
    clean, { lead: "Apply display-only polish to quotes, dividers, headings, tasks, inline code, and Mermaid diagrams in Live Preview and Reading view.", rest: "Bullet and number styles by list depth are unaffected. Your Markdown is never changed." });
}

/* ---------- Item 3: grouped slash menu, date previews, Callout types ---------- */
{
  const settings = {
    ...DEFAULT_SETTINGS, slashCommands: true, columnLayout: true, toggleBlocks: true,
    dateFormat: "YYYY-MM-DD", timeFormat: "HH:mm",
    slashRecent: ["table", "bullet", "yesterday", "tomorrow", "datetime", "time"],
  };
  const host = { settings, saveData: async () => {} };
  const suggest = new SlashSuggest(host);
  const empty = suggest.getSuggestions({ query: "" });
  const labels = suggest.labels;
  eq("empty menu: 3 recents lead", empty.slice(0, 3).map((c) => c.id), ["table", "bullet", "yesterday"]);
  eq("the first recent carries Recent", labels.get(empty[0]), "Recent");
  const labelled = empty.filter((c) => labels.has(c));
  eq("7 labels: Recent and the 6 groups, in order",
    labelled.map((c) => labels.get(c)),
    ["Recent", "Basic blocks", "Lists", "Callouts & toggles", "Media & tables", "Advanced", "Dates"]);
  eq("Text opens Basic blocks", [empty[3].id, labels.get(empty[3])], ["text", "Basic blocks"]);
  const groupsAfterRecent = empty.slice(3).map((c) => SLASH_GROUP_ORDER.indexOf(c.group));
  ok("groups run in SLASH_GROUP_ORDER after the recents",
    groupsAfterRecent.every((g, i) => i === 0 || g >= groupsAfterRecent[i - 1]), JSON.stringify(groupsAfterRecent));
  ok("recents past the third go back to their group",
    ["tomorrow", "datetime", "time"].every((id) => empty.findIndex((c) => c.id === id) > 3));
  eq("…in their usual place: Dates in list order",
    empty.filter((c) => c.group === "date" && empty.indexOf(c) > 2).map((c) => c.id), ["date", "time", "datetime", "tomorrow"]);
  const shownIds = new Set(empty.map((c) => c.id));
  eq("the empty menu lists every built-in (the old 27 plus /toc) exactly once",
    [empty.length, shownIds.size], [SLASH_COMMANDS.length, SLASH_COMMANDS.length]);
  ok("no query-only Callout type in the empty menu", !empty.some((c) => c.id.startsWith("callout-")));
  settings.toggleBlocks = false;
  ok("a disabled entry is absent", !suggest.getSuggestions({ query: "" }).some((c) => c.id === "toggle"));
  settings.toggleBlocks = true;
  // A query-only entry used recently shows under Recent.
  settings.slashRecent = ["callout-warning", "h2"];
  const withTyped = suggest.getSuggestions({ query: "" });
  eq("a recent Callout type leads the empty menu", withTyped.slice(0, 2).map((c) => c.id), ["callout-warning", "h2"]);
  ok("…and is listed once", withTyped.filter((c) => c.id === "callout-warning").length === 1);
  settings.slashRecent = [];
  eq("no recents: no Recent label, Text first", [suggest.getSuggestions({ query: "" })[0].id, suggest.labels.get(suggest.getSuggestions({ query: "" })[0])], ["text", "Basic blocks"]);
  // A typed query: the ranking as is, no labels.
  const typed = suggest.getSuggestions({ query: "h" });
  eq("typed query: exactly the ranking", typed.map((c) => c.id), searchSlashCommands(slashEntries(host), "h", settings, []).map((c) => c.id));
  eq("typed query: no labels", suggest.labels.size, 0);
  const layout = slashMenuLayout([], ["x"], "");
  eq("layout of nothing", [layout.commands.length, layout.labels.size], [0, 0]);
  // Top results.
  const all = slashEntries(host);
  for (const [query, id] of [["warning", "callout-warning"], ["警告", "callout-warning"], ["提示", "callout-tip"], ["tip", "callout-tip"], ["callout", "callout"], ["标注", "callout"], ["danger", "callout-danger"], ["warn", "callout-warning"], ["toc", "toc"], ["目录", "toc"], ["mulu", "toc"]]) {
    eq(`/${query} → ${id}`, searchSlashCommands(all, query, settings, [])[0]?.id, id);
  }
  const warning = CALLOUT_SLASH_COMMANDS.find((c) => c.id === "callout-warning");
  eq("the warning entry writes a warning Callout", [warning.insert, warning.name, warning.group, warning.queryOnly], ["> [!warning] ‸\n> ", "Callout · Warning", "container", true]);
  eq("13 Callout types", CALLOUT_SLASH_COMMANDS.length, 13);
  ok("the generic Callout no longer claims 提示", !SLASH_COMMANDS.find((c) => c.id === "callout").keywords.includes("提示"));
  ok("every built-in has a group", SLASH_COMMANDS.every((c) => SLASH_GROUP_ORDER.includes(c.group)));
  // Date previews.
  const byId = (id) => SLASH_COMMANDS.find((c) => c.id === id);
  eq("date row previews today's date", slashRowDescription(byId("date"), settings), formatSlashDate("YYYY-MM-DD"));
  eq("tomorrow row previews tomorrow", slashRowDescription(byId("tomorrow"), settings), formatSlashDate("YYYY-MM-DD", 1));
  eq("datetime row previews both", slashRowDescription(byId("datetime"), settings), formatSlashDate("YYYY-MM-DD HH:mm"));
  eq("other rows keep their description", slashRowDescription(byId("table"), settings), byId("table").desc);
  // renderSuggestion: label row, group tint, preview class.
  const fakeEl = () => {
    const el = { classes: [], children: [], dataset: {}, text: "" };
    el.addClass = (...c) => el.classes.push(...c);
    el.createDiv = (o = {}) => { const child = fakeEl(); child.cls = o.cls ?? ""; child.text = o.text ?? ""; el.children.push(child); return child; };
    return el;
  };
  settings.slashRecent = ["h2"];
  const rows = suggest.getSuggestions({ query: "" });
  const first = fakeEl();
  suggest.renderSuggestion(rows[0], first);
  eq("the first row carries its label as first child", [first.classes, first.children[0].cls, first.children[0].text],
    [["nf-slash-item", "nf-slash-has-group"], "nf-slash-group", "Recent"]);
  eq("row and icon carry the group", [first.dataset.nfGroup, first.children[1].dataset.nfGroup], ["basic", "basic"]);
  const dateRow = fakeEl();
  suggest.renderSuggestion(rows.find((c) => c.id === "date"), dateRow);
  const dateMain = dateRow.children.find((c) => c.cls === "nf-slash-main");
  eq("a date row's description is its preview", dateMain.children.map((c) => [c.cls, c.text]),
    [["nf-slash-name", "Date"], ["nf-slash-desc nf-slash-preview", formatSlashDate("YYYY-MM-DD")]]);
  const plainRow = fakeEl();
  suggest.renderSuggestion(rows.find((c) => c.id === "quote"), plainRow);
  eq("a row inside a group has no label", [plainRow.classes, plainRow.children[0].cls], [["nf-slash-item"], "nf-slash-icon"]);
  // The column editor: same grouping as CodeMirror sections; no /toc.
  const ctx = (text) => ({ state: EditorState.create({ doc: text }), pos: text.length });
  const col = columnSlashCompletion(host, ctx("/"), (v) => v);
  const sections = [];
  for (const o of col.options) {
    if (!sections.length || sections.at(-1).name !== o.section?.name) sections.push(o.section);
  }
  eq("column: Dates in list order",
    col.options.filter((o) => o.section.name === "Dates").map((o) => o.nf.id), ["date", "time", "datetime", "tomorrow", "yesterday"]);
  eq("column sections: Recent then the groups, ranked",
    sections.map((x) => [x.name, x.rank]),
    [["Recent", 0], ["Basic blocks", 1], ["Lists", 2], ["Callouts & toggles", 3], ["Media & tables", 4], ["Advanced", 5], ["Dates", 6]]);
  ok("every column option has a section", col.options.every((o) => o.section));
  ok("the column menu never offers /toc", !col.options.some((o) => o.nf.id === "toc"));
  const colTyped = columnSlashCompletion(host, ctx("/warning"), (v) => v);
  eq("column: /warning → the warning Callout, no sections", [colTyped.options[0].nf.id, colTyped.options.some((o) => o.section)], ["callout-warning", false]);
  eq("column: the date row's detail is its preview", columnSlashCompletion(host, ctx("/date"), (v) => v).options[0].detail, formatSlashDate("YYYY-MM-DD"));
  eq("column: /toc lists nothing called toc", columnSlashCompletion(host, ctx("/toc"), (v) => v).options.some((o) => o.nf.id === "toc"), false);
  settings.slashRecent = [];
}

/* ---------- Item 4: /toc, templates, language chip, fold-all help row ---------- */
{
  const settings = { ...DEFAULT_SETTINGS, slashCommands: true, slashRecent: [] };
  let lines = [];
  const editor = {
    getLine: (n) => lines[n] ?? "",
    setLine(n, text) { lines[n] = text; },
    setCursor(pos) { this.cursor = pos; },
    getCursor: () => ({ line: 2, ch: lines[2].length }),
    replaceRange(text, from, to = from) {
      const off = (p) => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.ch;
      const doc = lines.join("\n");
      lines = (doc.slice(0, off(from)) + text + doc.slice(off(to))).split("\n");
    },
    get cm() { return { state: EditorState.create({ doc: lines.join("\n") }) }; },
  };
  const host = { settings, saveData: async () => {} };
  const suggest = new SlashSuggest(host);
  const toc = SLASH_COMMANDS.find((c) => c.id === "toc");
  eq("/toc is a main-only advanced entry", [toc.kind, toc.mainOnly, toc.group], ["toc", true, "advanced"]);
  lines = ["# Title", "## Part one", "/toc", "", "### Deeper"];
  suggest.context = { editor, start: { line: 2, ch: 0 }, end: { line: 2, ch: 4 }, query: "toc" };
  suggest.selectSuggestion(toc, { key: "Enter" });
  const text = lines.join("\n");
  ok("/toc writes the marker then a list of heading links", text.includes("<!-- nf-toc -->\n- [[#Title]]"), text);
  ok("…nested by level", /\n\t- \[\[#Part one\]\]/.test(text) && /\n\t\t- \[\[#Deeper\]\]/.test(text), text);
  ok("the query is gone", !text.includes("/toc"), text);
  eq("/toc is remembered", settings.slashRecent[0], "toc");
  globalThis.__nfNotices = [];
  lines = ["plain", "text", "/toc"];
  suggest.selectSuggestion(toc, { key: "Enter" });
  eq("no headings: the query is removed, nothing inserted", lines, ["plain", "text", ""]);
  eq("…with the Notice", globalThis.__nfNotices, ["No headings in this note"]);
  // The indent follows the vault: spaces when "Indent using tabs" is off.
  const spaces = tocOptionsFor({ vault: { getConfig: (k) => (k === "useTab" ? false : k === "tabSize" ? 2 : undefined) } }, editor.cm);
  eq("TOC indent follows the vault", spaces.indent, "  ");

  // Templates: the row runs core Templates' insertTemplate on its file.
  const file = { path: "templates/Meeting.md", basename: "Meeting", extension: "md" };
  const inserted = [];
  const instance = { options: { folder: "templates" }, insertTemplate: async (f) => { inserted.push(f.path); } };
  const app = {
    internalPlugins: { getEnabledPluginById: (id) => (id === "templates" ? instance : null) },
    workspace: { activeEditor: { editor } },
    vault: { getAbstractFileByPath: (p) => (p === "templates" ? { children: [file] } : null) },
  };
  const tHost = { settings, saveData: async () => {}, app };
  const tSuggest = new SlashSuggest(tHost);
  lines = ["para", "", "/meet"];
  tSuggest.context = { editor, start: { line: 2, ch: 0 }, end: { line: 2, ch: 5 }, query: "meet" };
  const listed = tSuggest.getSuggestions({ ...tSuggest.context });
  eq("/meet lists the template first", [listed[0]?.id, listed[0]?.kind, listed[0]?.group, listed[0]?.mainOnly], ["template:templates/Meeting.md", "template", "advanced", true]);
  ok("…and keeps its minTier", listed[0]?.minTier === 80);
  tSuggest.selectSuggestion(listed[0], { key: "Enter" });
  await new Promise((r) => setTimeout(r, 0));
  eq("the template entry runs insertTemplate on its file", inserted, ["templates/Meeting.md"]);
  eq("…after the query was removed", lines, ["para", "", ""]);
  eq("…and joins the recents", settings.slashRecent[0], "template:templates/Meeting.md");
  ok("the column menu never offers templates",
    !columnSlashCompletion(tHost, { state: EditorState.create({ doc: "/meet" }), pos: 5 }, (v) => v).options.some((o) => o.nf.kind === "template"));
  // A template deleted between listing and running: logged, not unhandled.
  const errors = [];
  const origError = console.error;
  console.error = (...args) => errors.push(args[0]);
  let unhandled = 0;
  const onUnhandled = () => { unhandled++; };
  process.on("unhandledRejection", onUnhandled);
  instance.insertTemplate = () => Promise.reject(new Error("gone"));
  lines = ["para", "", "/meet"];
  tSuggest.selectSuggestion(listed[0], { key: "Enter" });
  await new Promise((r) => setTimeout(r, 10));
  console.error = origError;
  process.off("unhandledRejection", onUnhandled);
  eq("a rejecting insert is caught and logged", [errors, unhandled], [["Notion Flow: template insert failed"], 0]);

  // Language chips and the picker's list.
  eq("chip label: js → JavaScript, ts → TypeScript, custom kept, none empty",
    ["js", "ts", "dataviewjs", ""].map(languageLabel), ["JavaScript", "TypeScript", "dataviewjs", ""]);
  ok("CODE_LANGUAGES re-exports the module's longer list", CODE_LANGUAGES.length > 17 && CODE_LANGUAGES.some((l) => l.id === "javascript"));

  // Fold-all chord in the help: only where it is bound.
  const helpRow = () => editorHelpSections({ ...DEFAULT_SETTINGS }, null)
    .flatMap((section) => section.rows ?? []).find((row) => row.desc === "Collapse or expand all toggles");
  ok("no fold-all row off macOS (no default chord)", !helpRow());
  globalThis.__nfStubPlatform.isMacOS = true;
  try {
    ok("fold-all row on macOS", !!helpRow() && helpRow().keys.length === 1, JSON.stringify(helpRow()));
  } finally {
    globalThis.__nfStubPlatform.isMacOS = false;
  }
}

/* ---------- w2c-toc-marker-chip: the marker at rest is a chip ---------- */
{
  const doc = [
    "# A", "<!-- nf-toc -->", "- [[#A]]", "", "```", "<!-- nf-toc -->", "```", "",
    "> <!-- nf-toc -->", "> - [[#A]]", "", "> [!note] N", "> <!-- nf-toc -->", "> - [[#A]]", "", "- item", "\t<!-- nf-toc -->",
  ].join("\n");
  const at = (caret) => {
    const state = EditorState.create({ doc, selection: { anchor: caret } });
    const opts = tocOptionsFor(undefined, { state });
    return { state, ranges: tocChipRanges(state, opts) };
  };
  const { state, ranges } = at(0);
  eq("chips: the plain, quoted and list markers (not the fenced one, not the one in a Callout)",
    ranges.map((r) => r.markerLine), [2, 9, 17]);
  const line2 = state.doc.line(2), line9 = state.doc.line(9), line17 = state.doc.line(17);
  eq("each chip covers the marker after its prefix",
    ranges.map((r) => [r.from, r.to]), [[line2.from, line2.to], [line9.from + 2, line9.to], [line17.from + 1, line17.to]]);
  eq("no chip on the line holding the caret", at(line2.from + 3).ranges.map((r) => r.markerLine), [9, 17]);
  eq("a caret at the line's end reveals it too", at(line9.to).ranges.map((r) => r.markerLine), [2, 17]);
  eq("limited to the given lines", tocChipRanges(state, tocOptionsFor(undefined, { state }), { from: 3, to: 12 }).map((r) => r.markerLine), [9]);
}

/* ---------- wire-surface-modules: What's new, page header default ---------- */
{
  const { readFileSync, readdirSync } = await import("node:fs");
  const root = new URL("../", import.meta.url);
  const read = (rel) => readFileSync(new URL(rel, root), "utf8");
  const whatsNew = read("src/ui/whats-new.ts");
  const ids = [...whatsNew.matchAll(/command:\s*"([^"]+)"/g)].map((m) => m[1]);
  ok("What's new: its Try it rows name commands", ids.length >= 4, ids.join(","));
  const sources = [read("src/main.ts"), ...readdirSync(new URL("src/features/", root))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => read(`src/features/${name}`))].join("\n");
  const CORE_IDS = new Set(["editor:open-search", "command-palette:open"]);
  const missing = ids.filter((id) => {
    if (CORE_IDS.has(id)) return false;
    if (!id.startsWith("notion-flow:")) return true;
    return !sources.includes(`id: "${id.slice("notion-flow:".length)}"`);
  });
  eq("What's new: every Try it command is registered", missing, []);
  ok("What's new: the comments list registers show-comments", read("src/main.ts").includes("registerCommentsList(this"));

  eq("pageHeader defaults on", DEFAULT_SETTINGS.pageHeader, true);
  ok("a fresh copy of the defaults still reads as defaults", settingsAtDefaults({ ...DEFAULT_SETTINGS }));
  ok("pageHeader off is a customisation", !settingsAtDefaults({ ...DEFAULT_SETTINGS, pageHeader: false }));
  ok("pageHeader never reconfigures the editors",
    editorSensitiveKey({ ...DEFAULT_SETTINGS, pageHeader: false }) === editorSensitiveKey({ ...DEFAULT_SETTINGS }));

  // w2c-whats-new-open-settings: the plugin's dialog can open the settings,
  // so the Note style row keeps its Try it.
  const plugin = Object.create(NotionFlowPlugin.prototype);
  const calls = [];
  plugin.manifest = { id: "notion-flow", version: "1.6.0" };
  plugin.app = {
    setting: { open: () => calls.push("open"), openTabById: (id) => calls.push(["tab", id]) },
    commands: { executeCommandById: (id) => (calls.push(["run", id]), true) },
  };
  plugin.settingTab = { revealNoteStyle: () => calls.push("reveal") };
  globalThis.__nfModalsOpened = [];
  plugin.openWhatsNew();
  const modal = globalThis.__nfModalsOpened.at(-1);
  ok("openWhatsNew opens a modal with the plugin's options", !!modal?.options && modal.options.version === "1.6.0");
  const rows = whatsNewRows(modal.options, () => true);
  eq("the Note style row keeps its Try it (openSettings passed)",
    rows.find((row) => row.id === "note-style")?.action, { settings: true });
  eq("without openSettings the row has none",
    whatsNewRows({ version: "1", onTour() {}, run() {} }, () => true).find((row) => row.id === "note-style")?.action, null);
  modal.options.openSettings();
  eq("openSettings opens Settings → Notion Flow at the Note style section", calls, ["open", ["tab", "notion-flow"], "reveal"]);
  calls.length = 0;
  modal.options.run("notion-flow:show-comments");
  eq("Try it runs the command by id", calls, [["run", "notion-flow:show-comments"]]);
}

/* ---------- callout-icon-and-colour-menus ---------- */
{
  eq("icon: a Lucide token", calloutIconFromMetadata(["nfi-rocket", "nf-green"]), "rocket");
  eq("icon: emoji mode", calloutIconFromMetadata(["nfi-emoji"]), "emoji");
  eq("icon: an unknown name falls back to the type's", calloutIconFromMetadata(["nfi-bogus"]), null);
  eq("icon: none", calloutIconFromMetadata([]), null);
  eq("icon: a colour token alone is no icon", calloutIconFromMetadata(["nf-red"]), null);
  eq("recolouring keeps the icon token",
    setCalloutMetaToken("> [!tip|nfi-rocket nf-green] T", "nf-", "nf-red"), "> [!tip|nfi-rocket nf-red] T");
  eq("removing the colour keeps the icon token",
    setCalloutMetaToken("> [!tip|nfi-rocket nf-green] T", "nf-", null), "> [!tip|nfi-rocket] T");
  const a = new VisualCalloutLeadWidget("tip", false, 1, 1, "rocket");
  ok("lead: eq differs when only the icon differs", !a.eq(new VisualCalloutLeadWidget("tip", false, 1, 1, "star")));
  ok("lead: …and when one has none", !a.eq(new VisualCalloutLeadWidget("tip", false, 1, 1)));
  ok("lead: equal icons are equal", a.eq(new VisualCalloutLeadWidget("tip", false, 1, 1, "rocket")));
  // The edit pass hands the header's icon to its lead.
  const leadIcon = (text) => {
    const pass = editPass(text, text.indexOf("body") + 1);
    return pass.ranges.filter((r) => r.kind === "replace" && r.spec?.widget?.constructor?.name === "VisualCalloutLeadWidget")
      .map((r) => r.spec.widget.icon);
  };
  eq("edit pass: a Lucide icon reaches the lead", leadIcon("> [!tip|nfi-rocket nf-green] Title\n> body"), ["rocket"]);
  eq("edit pass: emoji mode reaches the lead", leadIcon("> [!tip|nfi-emoji] 💡 Title\n> body"), ["emoji"]);
  eq("edit pass: no token, the type's icon", leadIcon("> [!tip] Title\n> body"), [null]);
}

/* ---------- block-colour-and-page-actions ---------- */
{
  const target = (text, line = 1) => {
    const doc = Text.of(text.split("\n"));
    const fences = scanFences(doc);
    const block = innerBlockAt(doc, line, fences);
    const t = blockColorTarget(doc, block, fences);
    return t.text && t.background ? "both" : t.text ? "text" : t.background ? "bg" : "none";
  };
  const table = [
    ["paragraph", "para one", "both"],
    ["H2 (lead decision: no colour on headings)", "## Title", "none"],
    ["list item", "- item", "both"],
    ["to-do", "- [ ] task", "both"],
    ["quote", "> quoted", "both"],
    ["callout header", "> [!note] T\n> body", "none"],
    ["fence", "```js\nx\n```", "none"],
    ["table", "| a | b |\n| - | - |\n| 1 | 2 |", "none"],
    ["math", "$$\nx\n$$", "none"],
    ["divider", "text\n\n---", "none", 3],
    ["image", "![alt](a.png)", "none"],
    ["HTML block", "<div>", "none"],
    ["blank", "a\n\n\nb", "none", 2],
    ["a paragraph already coloured", '<span style="color:var(--nf-red, #b5554d)">para</span>', "both"],
    ["a comment anchor opens it", '<span class="nf-cmt" data-nf-cmt="n">para</span>', "both"],
    ["setext heading", "Title\n===", "none"],
    ["link reference", "[ref]: https://x", "none"],
    ["footnote definition", "[^1]: x", "both"],
    ["frontmatter", "---\ntitle: x\n---\npara", "none", 2],
    ["after frontmatter", "---\ntitle: x\n---\npara", "both", 4],
  ];
  for (const [name, text, want, line] of table) eq(`blockColorTarget: ${name}`, target(text, line ?? 1), want);

  // Changes: background before a block id, text on every row, Default off.
  const doc = Text.of(["para ^abc"]);
  const fences = scanFences(doc);
  const block = innerBlockAt(doc, 1, fences);
  eq("background goes before the block id",
    blockColorChanges(doc, block, fences, "bg", "green"),
    [{ from: 0, to: 9, insert: 'para <span class="nf-blk-green"></span> ^abc' }]);
  const item = Text.of(["- one", "  cont", "- two"]);
  const itemBlock = innerBlockAt(item, 1, scanFences(item));
  const red = blockColorChanges(item, itemBlock, scanFences(item), "text", "red");
  const recolored = item.toString() === "" ? "" : Text.of(["x"]);
  const applied = EditorState.create({ doc: item.toString() }).update({ changes: red }).state.doc;
  eq("text colour wraps each row of a list item", applied.toString(),
    '- <span style="color:var(--nf-red, #b5554d)">one</span>\n  <span style="color:var(--nf-red, #b5554d)">cont</span>\n- two');
  eq("…and the menu reads it back", blockColorValues(applied, innerBlockAt(applied, 1, scanFences(applied))), { text: "red", bg: null });
  const cleared = EditorState.create({ doc: applied.toString() }).update({
    changes: blockColorChanges(applied, innerBlockAt(applied, 1, scanFences(applied)), scanFences(applied), "text", null),
  }).state.doc;
  eq("Default unwraps it", cleared.toString(), item.toString());
  eq("a heading takes nothing", blockColorChanges(Text.of(["## H"]), { startLine: 1, endLine: 1 }, [], "text", "red"), null);
  void recolored;

  // Slash: the caret's block, notices for what takes no colour.
  const plan = (text, line, kind, color) => {
    const d = Text.of(text.split("\n"));
    return slashBlockColorPlan(d, line, kind, color, scanFences(d));
  };
  const hello = plan("Hello ", 1, "text", "red");
  eq("/red on 'Hello /red': the text is wrapped", hello.changes.map((c) => c.insert), ['<span style="color:var(--nf-red, #b5554d)">', "</span>"]);
  const bgPlan = (text, line, col) => {
    const d = Text.of(text.split("\n"));
    return slashBlockColorPlan(d, line, "bg", "blue", scanFences(d), d.line(line).from + col);
  };
  const bg = bgPlan("Hello ", 1, 6);
  eq("/blue background: one marker", bg.changes[0].insert, 'Hello <span class="nf-blk-blue"></span> ');
  eq("…caret after the typed space, before the marker's tag", bg.caret, 6);
  eq("…with no space before the '/', at the content end", bgPlan("中文", 1, 2).caret, 2);
  eq("…mid-row, the caret keeps its column", bgPlan("Hello  world", 1, 6).caret, 6);
  eq("…on a later row of the block, the edit maps it", bgPlan("one\ntwo ", 2, 4).caret, null);
  eq("/red on a heading: a notice", plan("## H", 1, "text", "red"), { notice: "Nothing to color in this block" });
  eq("/red background on a heading: the same notice", plan("## H", 1, "bg", "red"), { notice: "Nothing to color in this block" });
  eq("/red on an empty row: a notice", plan("a\n\n", 2, "text", "red"), { notice: "Nothing to color in this block" });

  // Turn into keeps or drops the marker.
  const marked = Text.of(['para <span class="nf-blk-blue"></span>']);
  const mBlock = innerBlockAt(marked, 1, scanFences(marked));
  eq("turn into bulleted list keeps the marker", turnBlockChange(marked, mBlock, "- ", scanFences(marked)).insert,
    '- para <span class="nf-blk-blue"></span>');
  eq("turn into heading drops it", turnBlockChange(marked, mBlock, "# ", scanFences(marked)).insert, "# para");
  eq("wrapping into code drops it", buildBlockWrap(['para <span class="nf-blk-blue"></span>', "two"], "code"), ["```", "para", "two", "```"]);
  eq("wrapping into a Callout drops it", buildBlockWrap(['para <span class="nf-blk-blue"></span>'], "callout"), ["> [!note] ", "> para"]);

  // The marker is a plugin tag: concealed, clamped and cleared like nf-tbl.
  const pairs = findColorTagPairs('a<span class="nf-blk-red"></span>');
  eq("an nf-blk marker is one style-null pair", pairs.map((p) => [p.open.from, p.close.to, p.style, p.comment]), [[1, 33, null, null]]);
  eq("table markers unchanged", findColorTagPairs('<span class="nf-tbl-red"></span>x').map((p) => p.style), [null]);
  eq("colour, comment and bare tags unchanged",
    findColorTagPairs('<span style="color:red">a</span><span class="nf-cmt" data-nf-cmt="n">b</span><u>c</u>').map((p) => p.style ?? p.comment),
    ["color:red", "n", "text-decoration:underline"]);
  ok("a marker with an unknown shape is no tag", findColorTagPairs('<span class="nf-blk-Red1"></span>').length === 0);

  // The trigger takes one inner space.
  const q = (text) => text.match(RE_SLASH_TRIGGER)?.[1] ?? null;
  eq("trigger: /red background", q("x /red background"), "red background");
  eq("trigger: a second space ends it", q("x /red  x"), null);
  eq("trigger: no leading space", q("/ x"), null);
  eq("trigger: /table4x6", q("/table4x6"), "table4x6");
  eq("trigger: /bg red", q("/bg red"), "bg red");
  eq("trigger: CJK before the slash", q("中文/红色背景"), "红色背景");
  eq("trigger: a trailing space keeps it open", q("/table "), "table ");

  // Search.
  const settings = { ...DEFAULT_SETTINGS, slashRecent: [] };
  const host = { settings, saveData: async () => {} };
  const all = slashEntries(host);
  for (const [query, id] of [["red background", "background-red"], ["bg red", "background-red"], ["红色背景", "background-red"], ["红色", "color-red"], ["red", "color-red"], ["hongse", "color-red"], ["blue background", "background-blue"], ["蓝色", "color-blue"], ["table", "table"], ["bg", "table"], ["表格", "table"]]) {
    eq(`/${query} → ${id}`, searchSlashCommands(all, query, settings, [])[0]?.id, id);
  }
  eq("18 colour entries, text then background per hue", [COLOR_SLASH_COMMANDS.length, COLOR_SLASH_COMMANDS[0].id, COLOR_SLASH_COMMANDS[1].id], [18, "color-gray", "background-gray"]);
  ok("colour entries are query-only and main-editor only", COLOR_SLASH_COMMANDS.every((c) => c.queryOnly && c.mainOnly));
  const suggest = new SlashSuggest(host);
  ok("the empty menu lists no colour entry", !suggest.getSuggestions({ query: "" }).some((c) => c.kind === "text-color" || c.kind === "bg-color"));
  settings.slashRecent = ["color-red", "background-blue", "h2"];
  eq("…nor as a recent", suggest.getSuggestions({ query: "" }).slice(0, 1).map((c) => c.id), ["h2"]);
  settings.slashRecent = [];
  const column = columnSlashCompletion(host, { state: EditorState.create({ doc: "/red" }), pos: 4 }, () => ({}));
  ok("the column menu has no colour entry", !(column?.options ?? []).some((o) => /^(color|background)-/.test(o.nfId ?? o.command?.id ?? "") || /background|Text color/.test(o.label)), JSON.stringify(column?.options?.map((o) => o.label)));

  // Turn into page.
  const page = (text, line = 1, prefix) => {
    const d = Text.of(text.split("\n"));
    const f = scanFences(d);
    const b = { ...innerBlockAt(d, line, f), ...(prefix ? { quotePrefix: prefix } : {}) };
    return turnIntoPagePlan(d, b, f);
  };
  eq("page: a paragraph", page("Some idea here"), { title: "Some idea here", content: "Some idea here", from: 0, to: 14, keepPrefix: "" });
  const idea = page("- Idea one\n  - detail\n- next");
  eq("page: a list item with its child", [idea.title, idea.content, idea.keepPrefix, idea.to], ["Idea one", "- Idea one\n  - detail", "- ", 21]);
  eq("page: a to-do keeps its marker, not the box", page("- [ ] Task it").keepPrefix, "- ");
  eq("page: an ordered item", page("3. Third").keepPrefix, "3. ");
  eq("page: the title is sanitised", page("# A/B: c?").title, "A B c");
  eq("page: colour spans and markers are stripped", page('<span style="color:var(--nf-red, #b5554d)">Red</span> idea <span class="nf-blk-blue"></span>').title, "Red idea");
  eq("page: a block id is dropped from the title", page("Para ^abc123").title, "Para");
  eq("page: nothing left → Untitled", page("- [[]]").title, "Untitled");
  eq("page: at most 100 characters", page("x".repeat(140)).title.length, 100);
  eq("page: an indented child is dedented", page("- a\n  - child\n    - deep", 2).content, "- child\n  - deep");
  eq("page: code is no page", page("```\nx\n```"), null);
  eq("page: a table is no page", page("| a |\n| - |"), null);
  eq("page: a Callout is no page", page("> [!note] T\n> b"), null);
  eq("page: a row inside a container is no page", page("> [!note] T\n> body", 2, "> "), null);
  eq("page: a blank block is no page", page("a\n\n\nb", 2), null);

  // A run of selected blocks.
  const run = Text.of(["one", "", "two", "", "three", "four"]);
  eq("contiguous: blank rows between are fine", contiguousBlockSpan(run, [{ startLine: 3, endLine: 3 }, { startLine: 1, endLine: 1 }]), { startLine: 1, endLine: 3 });
  eq("contiguous: text between breaks the run", contiguousBlockSpan(run, [{ startLine: 1, endLine: 1 }, { startLine: 5, endLine: 5 }]), null);
  eq("contiguous: different levels do not join", contiguousBlockSpan(run, [{ startLine: 1, endLine: 1 }, { startLine: 3, endLine: 3, quotePrefix: "> " }]), null);
}

/* ---------- Item 10: right-click in a table → one "Table ▸" submenu ---------- */
{
  const { Menu } = await import("./obsidian-stub.mjs");
  const doc = "| a | b | c |\n| --- | :-: | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |";
  const menuAt = (line, ch) => {
    const state = EditorState.create({ doc });
    const log = [];
    const view = { state, dispatch: (tr) => log.push(tr) };
    const plugin = Object.create(NotionFlowPlugin.prototype);
    plugin.editorView = () => view;
    const menu = new Menu();
    plugin.addTableMenu(menu, { getCursor: () => ({ line, ch }) });
    return { menu, log };
  };
  const { menu, log } = menuAt(0, 7);
  eq("table menu: the top level gains a separator and one item", [menu.items.length, menu.separators], [1, [0]]);
  const top = menu.items[0];
  eq("table menu: the item is Table with a submenu", [top.title, top.icon, !!top.submenu], ["Table", "table", true]);
  const sub = top.submenu;
  eq("table menu: the submenu holds 20 rows in group order", sub.items.map((i) => i.title), [
    "Insert row above", "Insert row below", "Insert column left", "Insert column right",
    "Duplicate row", "Move row up", "Move row down", "Move table column left", "Move table column right",
    "Sort column A→Z", "Sort column Z→A",
    "Default alignment", "Align left", "Align center", "Align right",
    "Cell background", "Table background", "Format table",
    "Delete row", "Delete column",
  ]);
  eq("table menu: separators split insert | move | sort | align | colour | delete", sub.separators, [4, 9, 11, 15, 18]);
  eq("table menu: the column's alignment is checked",
    sub.items.filter((i) => i.checked === true).map((i) => i.title), ["Align center"]);
  eq("table menu: on the header row, row edits and Delete row are disabled",
    sub.items.filter((i) => i.disabled).map((i) => i.title),
    ["Duplicate row", "Move row up", "Move row down", "Delete row"]);
  const cell = sub.items.find((i) => i.title === "Cell background");
  eq("table menu: Cell background is a nested submenu of 9 colours and Remove color",
    [cell.submenu?.items.length, cell.submenu?.items.at(-1).title], [10, "Remove color"]);
  eq("table menu: no title is a fragment", sub.items.every((i) => typeof i.title === "string"), true);
  sub.items.find((i) => i.title === "Align right").click();
  ok("table menu: a submenu row edits the table", log.length === 1 && log[0].changes.insert.split("\n")[1] === "| --- | --: | --- |", JSON.stringify(log[0]?.changes));
  const body = menuAt(2, 3).menu.items[0].submenu;
  eq("table menu: on a body row, Delete row is enabled and a warning",
    [body.items.find((i) => i.title === "Delete row").disabled, body.items.find((i) => i.title === "Delete row").warning], [undefined, true]);
  // Outside a table the menu is untouched.
  const plain = Object.create(NotionFlowPlugin.prototype);
  plain.editorView = () => ({ state: EditorState.create({ doc: "para" }) });
  const none = new Menu();
  plain.addTableMenu(none, { getCursor: () => ({ line: 0, ch: 1 }) });
  eq("table menu: nothing outside a table", [none.items.length, none.separators.length], [0, 0]);
}

/* ---------- Item 11: image alignment and column-relative size presets ---------- */
{
  const cases = [
    ["![[a.png|480]]", "center", "![[a.png|center|480]]"],
    ["![[a.png]]", "right", "![[a.png|right]]"],
    ["![[a.png|My photo|480]]", "center", "![[a.png|My photo center|480]]"],
    ["![](u)", "center", "![center](u)"],
    ["![center|480](u)", null, "![|480](u)"],
    ["![[a.png|center|480]]", null, "![[a.png|480]]"],
    ["![[a.png|center|480]]", "right", "![[a.png|right|480]]"],
    ["![[a.png|center]]", null, "![[a.png]]"],
    ["![[a.png|My center photo|480]]", "left", "![[a.png|My photo left|480]]"],
    ["![center](u)", null, "![](u)"],
    ["![|480](u)", "center", "![center|480](u)"],
    ["![Sunset|300](u)", "right", "![Sunset right|300](u)"],
    ["![[a.png|Sunset|center|300]]", null, "![[a.png|Sunset|300]]"],
    ["![[a.png|480]]", null, "![[a.png|480]]"],
    ["plain text", "center", "plain text"],
    ["> ![[a.png|480]] tail", "center", "> ![[a.png|center|480]] tail"],
  ];
  for (const [input, align, output] of cases) eq(`setImageAlign(${input}, ${align})`, setImageAlign(input, align), output);
  eq("imageAlignOf: a wiki token part", imageAlignOf("![[a.png|center|480]]"), "center");
  eq("imageAlignOf: a word in the alt", imageAlignOf("![[a.png|My photo right|480]]"), "right");
  eq("imageAlignOf: a Markdown alt", imageAlignOf("![left|120](u)"), "left");
  eq("imageAlignOf: a separate pipe part", imageAlignOf("![[a.png|Sunset|center|300]]"), "center");
  eq("imageAlignOf: none", imageAlignOf("![[a.png|480]]"), null);
  eq("imageAlignOf: the path never counts", imageAlignOf("![[center]]"), null);
  eq("imageAlignOf: a size part is not alt", imageAlignOf("![[a.png|480]]"), null);
  eq("imageAlignOf: case matters (Obsidian's alt~= does)", imageAlignOf("![[a.png|Center]]"), null);
  // `at` picks the second embed on a line.
  const two = "![[a.png|100]] ![[b.png|200]]";
  eq("setImageAlign: at picks the second embed", setImageAlign(two, "center", 16), "![[a.png|100]] ![[b.png|center|200]]");
  eq("imageAlignOf: at reads the second embed", imageAlignOf("![[a.png|left]] ![[b.png|right]]", 17), "right");
  eq("imageAlignOf: without at, the first embed", imageAlignOf("![[a.png|left]] ![[b.png|right]]"), "left");
  // Alignment and size stay independent.
  eq("size after align keeps the token", setImageWidth("![[a.png|center|480]]", 350), "![[a.png|center|350]]");
  eq("the emptied Markdown alt keeps 480 a size", imageWidthOf("![|480](u)"), 480);
  eq("original drops the size, keeps the token", setImageWidth("![center|480](u)", null), "![center](u)");

  const widths = (rows) => rows.map((r) => [r.title, r.width]);
  eq("imageSizePresets(700): 25/50/75 %, full column, Original", widths(imageSizePresets(700)), [
    ["25% width", 175], ["50% width", 350], ["75% width", 525], ["Full column width", 700], ["Original", null],
  ]);
  eq("imageSizePresets(null): the fixed presets", widths(imageSizePresets(null)), [
    ["Small", 240], ["Medium", 480], ["Large", 720], ["Original", null],
  ]);
  eq("imageSizePresets(120): widths under 40 are dropped", widths(imageSizePresets(120)), [
    ["50% width", 60], ["75% width", 90], ["Full column width", 120], ["Original", null],
  ]);
  eq("imageSizePresets(60): a tiny column keeps the presets that fit", widths(imageSizePresets(60)), [["Original", null]]);
  eq("imageSizePresets(500): the fixed fallback is not used", imageSizePresets(500).length, 5);
  eq("imageSizePresets(701.4): rounded", imageSizePresets(701.4).map((r) => r.width), [175, 351, 526, 701, null]);
}

/* ---------- Item 13: handle polish (drop-level anchors, re-hover) ---------- */
{
  const anchorOf = (lines, target, indent, exclude) => {
    const doc = Text.of(lines);
    return dropLevelAnchor(doc, target, indent, scanFences(doc), exclude);
  };
  const levels = (lines, target, exclude) => {
    const doc = Text.of(lines);
    return computeDropLevels(doc, scanFences(doc), target, exclude).map((l) => l.indent);
  };
  // The verifier's f3 shape: drag "Move me paragraph." (line 3) below the child.
  const space2 = ["# T", "", "Move me paragraph.", "", "- item", "  - child", "", "Tail para."];
  const tab = ["# T", "", "Move me paragraph.", "", "- item", "\t- child", "", "Tail para."];
  const moved = { startLine: 3, endLine: 3 };
  eq("drop levels, 2-space list", levels(space2, 7, moved), [0, 2, 4]);
  eq("drop levels, tab list (content columns 2 and 6)", levels(tab, 7, moved), [0, 2, 6]);
  eq("anchor 2-space, level 2 → the item's words", anchorOf(space2, 7, 2, moved), { line: 5, offset: 2 });
  eq("anchor 2-space, level 4 → the child's words", anchorOf(space2, 7, 4, moved), { line: 6, offset: 4 });
  eq("anchor tab, level 2 → the item's words", anchorOf(tab, 7, 2, moved), { line: 5, offset: 2 });
  eq("anchor tab, level 6 → the child's words", anchorOf(tab, 7, 6, moved), { line: 6, offset: 3 });
  eq("anchor tab, level 4 (a line indent, no content column) → none", anchorOf(tab, 7, 4, moved), null);
  eq("anchor level 0 → none (the caller uses 0)", anchorOf(tab, 7, 0, moved), null);
  const todo = ["- [ ] task", "  - [x] sub", ""];
  eq("anchor to-do → at its box (both views put a dropped block there)", anchorOf(todo, 3, 4), { line: 2, offset: 4 });
  eq("anchor to-do, outer level", anchorOf(todo, 3, 2), { line: 1, offset: 2 });
  eq("anchor ordered", anchorOf(["1. first", "   1. inner", ""], 3, 6), { line: 2, offset: 6 });
  eq("anchor: a top-level paragraph between ends the search",
    anchorOf(["- item", "", "Para.", "", ""], 5, 2), null);
  eq("anchor: the dragged block itself is skipped",
    anchorOf(["- item", "  - child", "- other"], 4, 4, { startLine: 2, endLine: 2 }), null);
  eq("anchor: code rows are skipped",
    anchorOf(["- item", "  ```", "  - not a list", "  ```", ""], 5, 2), { line: 1, offset: 2 });
  eq("anchor: quoted rows do not end the search", anchorOf(["- item", "> q", ""], 3, 2), { line: 1, offset: 2 });

  const base = { destroyed: false, dragging: false, pendingDrag: false, selecting: false, pendingSelect: false, hasPointer: true, enabled: true, editedSincePointer: false };
  eq("canRehover: a resting hover pointer", canRehover(base), true);
  for (const key of ["destroyed", "dragging", "pendingDrag", "selecting", "pendingSelect", "editedSincePointer"]) {
    eq(`canRehover: not while ${key}`, canRehover({ ...base, [key]: true }), false);
  }
  eq("canRehover: not without a pointer", canRehover({ ...base, hasPointer: false }), false);
  eq("canRehover: not with drag handles off", canRehover({ ...base, enabled: false }), false);
}

/* ---------- item 14: heading-placeholders ---------- */
{
  const hintOf = (lines, caretLine, caretCh) => {
    const doc = Text.of(lines);
    const line = doc.line(caretLine ?? lines.length);
    const head = caretCh == null ? line.to : line.from + caretCh;
    return emptyBlockHint(doc, { ranges: [{ empty: true, head }] });
  };
  eq("hint: '## ' → h2, marker 0..3", hintOf(["## "]), { lineNo: 1, kind: "h2", markerFrom: 0, markerTo: 3 });
  eq("hint: '###### ' → h6", hintOf(["###### "])?.kind, "h6");
  eq("hint: '# ' → h1", hintOf(["# "])?.kind, "h1");
  eq("hint: '- ' → bullet", hintOf(["- "]), { lineNo: 1, kind: "bullet" });
  eq("hint: '1. ' → number", hintOf(["1. "])?.kind, "number");
  eq("hint: '3) ' → number", hintOf(["3) "])?.kind, "number");
  eq("hint: '  * ' (nested) → bullet", hintOf(["- a", "  * "])?.kind, "bullet");
  eq("hint: '- [ ] ' → todo", hintOf(["- [ ] "])?.kind, "todo");
  eq("hint: '1. [ ] ' → todo", hintOf(["1. [ ] "])?.kind, "todo");
  eq("hint: '- [x] ' (checked) → none", hintOf(["- [x] "]), null);
  eq("hint: '> ' → quote", hintOf(["> "]), { lineNo: 1, kind: "quote" });
  eq("hint: '> > ' → quote", hintOf(["> > "])?.kind, "quote");
  eq("hint: quote row after text → quote", hintOf(["> words", "> "])?.kind, "quote");
  eq("hint: '> - ' in a plain quote → bullet", hintOf(["> - "])?.kind, "bullet");
  eq("hint: '> ## ' in a plain quote → h2, marker after the quote", hintOf(["> ## "]), { lineNo: 1, kind: "h2", markerFrom: 2, markerTo: 5 });
  eq("hint: '' → text", hintOf([""]), { lineNo: 1, kind: "text" });
  eq("hint: blank row mid-note → text", hintOf(["a", "", "b"], 2), { lineNo: 2, kind: "text" });
  eq("hint: blank row in a Callout → text", hintOf(["> [!note] T", "> "]), { lineNo: 2, kind: "text" });
  eq("hint: blank row in a nested plain quote inside a Callout → text", hintOf(["> [!note] T", "> > q", "> > "])?.kind, "text");
  eq("hint: blank row in a toggle → text", hintOf(["> [!nf-toggle]+ T", "> body", "> "])?.kind, "text");
  eq("hint: blank row in a Callout inside a quote → text", hintOf(["> quote", "> > [!note] N", "> > "])?.kind, "text");
  eq("hint: '[!x]' mid-quote is no header → quote", hintOf(["> q", "> [!warning] x", "> "])?.kind, "quote");
  eq("hint: '> ## ' in a Callout → none (its card has no placeholder)", hintOf(["> [!note] T", "> ## "]), null);
  eq("hint: '> - ' in a Callout → none", hintOf(["> [!note] T", "> - "]), null);
  eq("hint: blank row inside a fence → none", hintOf(["```", "", "```"], 2), null);
  eq("hint: '## ' inside a fence → none", hintOf(["```", "## ", "```"], 2), null);
  eq("hint: '## x' → none", hintOf(["## x"]), null);
  eq("hint: '- x' → none", hintOf(["- x"]), null);
  eq("hint: caret at the start of '## ' → none", hintOf(["## "], 1, 0), null);
  eq("hint: caret mid-marker → none", hintOf(["## "], 1, 2), null);
  eq("hint: '#tag' is no heading → none", hintOf(["#tag"]), null);
  eq("hint: '####### ' (7) → none", hintOf(["####### "]), null);
  {
    const doc = Text.of(["## "]);
    eq("hint: two carets → none", emptyBlockHint(doc, { ranges: [{ empty: true, head: 3 }, { empty: true, head: 0 }] }), null);
    eq("hint: a selection → none", emptyBlockHint(doc, { ranges: [{ empty: false, head: 3 }] }), null);
  }
  const S = (emptyLineHint, slashCommands, concealHeadings) => ({ emptyLineHint, slashCommands, concealHeadings });
  eq("gate: text needs the hint and the slash menu", [emptyHintEnabled("text", S(true, true, false)), emptyHintEnabled("text", S(true, false, true)), emptyHintEnabled("text", S(false, true, true))], [true, false, false]);
  eq("gate: headings follow conceal or the hint", [emptyHintEnabled("h2", S(false, false, true)), emptyHintEnabled("h2", S(true, false, false)), emptyHintEnabled("h2", S(false, true, false))], [true, true, false]);
  eq("gate: list/todo/quote follow the hint only", ["bullet", "number", "todo", "quote"].map((k) => [emptyHintEnabled(k, S(true, false, false)), emptyHintEnabled(k, S(false, true, true))]), [[true, false], [true, false], [true, false], [true, false]]);

  const del = (lines, head) => headingMarkerDeletePlan(Text.of(lines), head);
  eq("Backspace at the end of an empty '## ' takes the whole marker", del(["## "], 3), { from: 0, to: 3, insert: "" });
  eq("Backspace at the end of an empty '> ### ' keeps the quote", del(["> ### "], 6), { from: 2, to: 6, insert: "" });
  eq("Backspace mid empty marker → core", del(["## "], 2), null);
  eq("'## Title' at the text start still goes whole", del(["## Title"], 3), { from: 0, to: 3, insert: "" });
  eq("empty '## ' in a fence → core", del(["```", "## ", "```"], 7), null);
  eq("backspaceMarkerPlan: conceal only takes an empty '## ' whole",
    backspaceMarkerPlan({ markerBackspace: false, concealHeadings: true }, Text.of(["## "]), 3), { from: 0, to: 3, insert: "" });
}

/* ---------- item 15: typing-perf-and-leaks ---------- */
{
  const edit = (lines, spec) => {
    const state = EditorState.create({ doc: lines.join("\n") });
    const at = (line, ch) => state.doc.line(line).from + ch;
    const tr = state.update({ changes: spec(at, state.doc) });
    return listRenderingUnaffected(tr.startState.doc, tr.state.doc, tr.changes);
  };
  const prose = ["- a", "", "intro", "p1", "p2", "p3", "", "- b"];
  eq("list fast path: typing in a paragraph two rows from any list", edit(prose, (at) => ({ from: at(5, 1), insert: "x" })), true);
  eq("list fast path: typing in a paragraph right under a list item", edit(["- a", "lazy", "p"], (at) => ({ from: at(2, 2), insert: "x" })), false);
  eq("list fast path: typing ``` in a paragraph", edit(prose, (at) => ({ from: at(5, 0), insert: "```" })), false);
  eq("list fast path: typing ~~~ in a paragraph", edit(prose, (at) => ({ from: at(5, 0), insert: "~~~" })), false);
  eq("list fast path: emptying a paragraph row", edit(prose, (at) => ({ from: at(5, 0), to: at(5, 2) })), false);
  eq("list fast path: editing '> 1. x'", edit(["intro", "> 1. x", "p"], (at) => ({ from: at(2, 6), insert: "y" })), false);
  eq("list fast path: pasting 'a\\nb' into a paragraph", edit(prose, (at) => ({ from: at(5, 1), insert: "a\nb" })), true);
  eq("list fast path: pasting '- x'", edit(prose, (at) => ({ from: at(5, 2), insert: "\n- x" })), false);
  eq("list fast path: typing '- ' at a paragraph start", edit(prose, (at) => ({ from: at(5, 0), insert: "- " })), false);
  eq("list fast path: an indented row nearby", edit(["intro", "  indented", "p"], (at) => ({ from: at(3, 1), insert: "x" })), false);
  eq("list fast path: joining two paragraphs onto a list's row", edit(["- a", "p1", "p2"], (at) => ({ from: at(1, 3), to: at(2, 0) })), false);
  eq("list fast path: a quoted fence nearby", edit(["intro", "> ```", "p"], (at) => ({ from: at(3, 1), insert: "x" })), false);
  eq("list fast path: plain quote text", edit(["intro", "> quote", "p"], (at) => ({ from: at(2, 3), insert: "x" })), true);
  eq("list fast path: an edit at the very end", edit(["- a", "", "p1", "p2"], (at) => ({ from: at(4, 2), insert: "x" })), true);
  eq("list fast path: a paragraph between blank rows (the usual note)", edit(["1. a", "", "para", "", "2. b"], (at) => ({ from: at(3, 2), insert: "x" })), true);
  eq("list fast path: typing on a blank row", edit(["1. a", "", "para"], (at) => ({ from: at(2, 0), insert: "x" })), false);
  eq("list fast path: typing '>' at a paragraph start (quote depth changes)", edit(prose, (at) => ({ from: at(5, 0), insert: "> " })), false);
  eq("list fast path: the row above is indented", edit(["- a", "  cont", "p"], (at) => ({ from: at(3, 1), insert: "x" })), false);
  eq("list fast path: an edit on line 1", edit(["p1", "p2", "", "- a"], (at) => ({ from: at(1, 0), insert: "x" })), true);
  {
    const big = EditorState.create({ doc: Array.from({ length: 400 }, (_, i) => `p${i}`).join("\n") });
    const tr = big.update({ changes: { from: 0, to: big.doc.length, insert: Array.from({ length: 400 }, (_, i) => `q${i}`).join("\n") } });
    eq("list fast path: gives up past ~200 rows", listRenderingUnaffected(tr.startState.doc, tr.state.doc, tr.changes), false);
  }

  // Fuzz: whenever the fast path says "unaffected", mapping the old markers gives exactly the new rendering.
  {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pick = (a) => a[Math.floor(rand() * a.length)];
    const templates = ["1. a", "1. b", "  1. c", "- d", "\t- e", "para", "more text", "", "> q", "> 1. x", "```", "~~~", "  indented", "> ```"];
    const inserts = ["x", "```", "- ", "1. ", "\n", "a\nb", "> ", "  ", "\nplain", "~~~"];
    let fast = 0;
    for (let d = 0; d < 1500; d++) {
      const lines = Array.from({ length: 4 + Math.floor(rand() * 14) }, () => pick(templates));
      const state = EditorState.create({ doc: lines.join("\n") });
      const len = state.doc.length;
      const from = Math.floor(rand() * (len + 1));
      const to = rand() < 0.3 ? Math.min(len, from + Math.floor(rand() * 6)) : from;
      const tr = state.update({ changes: { from, to, insert: rand() < 0.2 ? "" : pick(inserts) } });
      if (!listRenderingUnaffected(tr.startState.doc, tr.state.doc, tr.changes)) continue;
      fast++;
      const old = collectSourceListRendering(tr.startState.doc);
      const mapped = {
        markers: old.markers.map((m) => ({ ...m, from: tr.changes.mapPos(m.from, 1), to: tr.changes.mapPos(m.to, 1) })),
        lines: old.lines.map((l) => ({ ...l, from: tr.changes.mapPos(l.from, 1) })),
      };
      const fresh = collectSourceListRendering(tr.state.doc);
      if (JSON.stringify(mapped) !== JSON.stringify(fresh)) {
        ok("list fast path fuzz: mapped == rebuilt", false, JSON.stringify({ lines, from, to, doc: tr.state.doc.toString() }));
        break;
      }
    }
    ok(`list fast path fuzz: ${fast} fast-path edits of 1500 all map to the rebuilt rendering`, fast > 20, String(fast));
  }

  // ownedBlockCaption: the fence scan now runs only after a caption parses; the answer is unchanged.
  const cap = (kind, text, prefix = "") => `${prefix}<small class="nf-caption" data-nf-kind="${kind}">${text}</small>`;
  const lines = [
    "intro", "```js", "let a = 1;", "```", cap("code", "Code cap"), "",
    "| a | b |", "| --- | --- |", "| 1 | 2 |", cap("table", "Table cap"), "",
    "![[pic.png]]", cap("image", "Image cap"), "",
    "```md", cap("code", "inside a fence"), "```", "",
    "orphan:", cap("image", "no owner"), "",
    "- item", "  ```py", "  x = 1", "  ```", cap("code", "list code", "  "), "",
    "> ![[q.png]]", cap("image", "quoted", "> "), cap("code", "second in a row"),
  ];
  const doc = Text.of(lines);
  const fences = cachedFences(doc);
  const lazy = [], eager = [];
  for (let n = 0; n <= doc.lines + 1; n++) {
    lazy.push(JSON.stringify(ownedBlockCaption(doc, n)));
    eager.push(JSON.stringify(ownedBlockCaption(doc, n, fences)));
  }
  eq("ownedBlockCaption: same answer with and without a fence list, every row", lazy, eager);
  eq("ownedBlockCaption: the owned rows", lines.map((_, i) => ownedBlockCaption(doc, i + 1)).map((m, i) => (m ? i + 1 : 0)).filter(Boolean), [5, 10, 13, 26, 29]);
  // A paragraph row reads no fence scan: an ordinary row answers without cachedFences.
  const plain = Text.of(["a", "b", "c"]);
  eq("ownedBlockCaption: an ordinary row is not a caption", ownedBlockCaption(plain, 2), null);

  // listNestingDepth keeps its answers across a segment boundary.
  const segDoc = Text.of(["- a", "  - b", "    text", "", "para", "", "- c", "  - d", "    text"]);
  eq("depth by segments", Array.from({ length: segDoc.lines }, (_, i) => listNestingDepth(segDoc, i + 1)), [0, 1, 2, 0, 0, 0, 0, 1, 2]);
}

/* ---------- w2c-clear-body-style-guard / w1c-feature-entry-key-exports ---------- */
{
  const removed = [];
  const body = { classList: { remove: (c) => removed.push(c) }, style: { removeProperty: (n) => removed.push(n) } };
  let threw = null;
  try { clearBodyStyle(body); } catch (e) { threw = e; }
  ok("clearBodyStyle: a body without classList.contains is cleaned", threw === null && removed.includes("nf-palette"), String(threw));
  ok("feature entry re-exports parseChord and chordTakenByOther", typeof parseChord === "function" && typeof chordTakenByOther === "function");
}

/* ---------- review3-main2-1: formatting across lines leaves captions, ids, embeds and footnote labels alone ---------- */
{
  const fv = (text, a, h) => {
    let state = EditorState.create({ doc: text, selection: EditorSelection.single(a, h) });
    const v = { dispatches: 0, get state() { return state; }, dispatch(spec) { v.dispatches++; state = state.update(spec).state; } };
    return v;
  };
  const bold = (v) => toggleDualFormat(v, "**", "<b>", "</b>");
  const cap = (kind, text, prefix = "") => `${prefix}<small class="nf-caption" data-nf-kind="${kind}">${text}</small>`;
  const all = (text) => fv(text, 0, text.length);
  const owned = (text) => { const d = Text.of(text.split("\n")); return Array.from({ length: d.lines }, (_, i) => i + 1).filter((n) => ownedBlockCaption(d, n)); };

  const CODE = ["para one", "```js", "x", "```", cap("code", "My caption"), "para two"].join("\n");
  let v = all(CODE); bold(v);
  eq("main2-1: bold across a captioned code block leaves the caption row", v.state.doc.toString(),
    ["**para one**", "```js", "<b>x</b>", "```", cap("code", "My caption"), "**para two**"].join("\n"));
  eq("main2-1: …which stays owned", owned(v.state.doc.toString()), [5]);
  const TABLE = ["intro", "| a | b |", "| --- | --- |", "| 1 | 2 |", cap("table", "Tbl"), "outro"].join("\n");
  v = all(TABLE); bold(v);
  eq("main2-1: a table caption row is left alone", v.state.doc.toString(), ["**intro**", "| a | b |", "| --- | --- |", "| 1 | 2 |", cap("table", "Tbl"), "**outro**"].join("\n"));
  const IMG = ["intro", "![[pic.png]]", cap("image", "Img"), "outro"].join("\n");
  v = all(IMG); bold(v);
  eq("main2-1: an image row and its caption are left alone", v.state.doc.toString(), ["**intro**", "![[pic.png]]", cap("image", "Img"), "**outro**"].join("\n"));
  eq("main2-1: …and the image caption stays owned", owned(v.state.doc.toString()), [3]);
  v = all(["a", "![alt](https://x.test/p.png)", "> ![[q.png]]", "b"].join("\n")); bold(v);
  eq("main2-1: Markdown and quoted embed rows are left alone", v.state.doc.toString(), ["**a**", "![alt](https://x.test/p.png)", "> ![[q.png]]", "**b**"].join("\n"));
  v = all(IMG); applyTextColor(v, TEXT_COLORS[1]);
  ok("main2-1: text colour skips the caption and image rows too",
    v.state.doc.toString().split("\n")[1] === "![[pic.png]]" && v.state.doc.toString().split("\n")[2] === cap("image", "Img"), v.state.doc.toString());

  const IDS = "Paragraph one ^abc123\n\nParagraph two ^def456";
  v = all(IDS); bold(v);
  eq("main2-1: a trailing block id stays outside the bold", v.state.doc.toString(), "**Paragraph one** ^abc123\n\n**Paragraph two** ^def456");
  bold(v);
  eq("main2-1: …and bold comes off again", v.state.doc.toString(), IDS);
  v = fv(IDS, IDS.indexOf("one"), IDS.indexOf("two") + 3);
  bold(v);
  eq("main2-1: a partial selection keeps the id at the row end", v.state.doc.toString(), "Paragraph **one** ^abc123\n\n**Paragraph two** ^def456");
  const IDROW = "| a | b |\n| --- | --- |\n| 1 | 2 |\n\n^tbl123\n\nafter";
  v = all(IDROW); bold(v);
  eq("main2-1: an id-only row is left alone", v.state.doc.toString(), "| a | b |\n| --- | --- |\n| 1 | 2 |\n\n^tbl123\n\n**after**");
  v = all("[^1]: the note\nplain"); bold(v);
  eq("main2-1: a footnote definition keeps its label", v.state.doc.toString(), "[^1]: **the note**\n**plain**");

  eq("inlineFormatSpan: caption row", inlineFormatSpan(cap("code", "c")), null);
  eq("inlineFormatSpan: quoted id row", inlineFormatSpan("> ^abc"), null);
  eq("inlineFormatSpan: list item with an id", inlineFormatSpan("- item ^x1"), { from: 2, to: 6 });
  eq("inlineFormatSpan: plain row", inlineFormatSpan("words here"), { from: 0, to: 10 });

  // Block mode (Esc-select + Bold) follows the same rows.
  const bd = Text.of(["para ^id1", "", "^tbl9", "", "- item ^x2"]);
  const r = batchToggleFormatChanges(bd, [{ startLine: 1, endLine: 1 }, { startLine: 3, endLine: 3 }, { startLine: 5, endLine: 5 }], { marker: "**", open: "<b>", close: "</b>" }, []);
  const applied = [...r.changes].sort((a, b) => b.from - a.from).reduce((t, c) => t.slice(0, c.from) + c.insert + t.slice(c.to), bd.toString());
  eq("main2-1: block-mode bold keeps ids outside and id rows alone", applied, "**para** ^id1\n\n^tbl9\n\n- **item** ^x2");
}

/* ---------- review3-main2-3: select-all + Bold in a long note is linear ---------- */
{
  const lines = Array.from({ length: 6000 }, (_, i) => (i % 2 ? "" : `Paragraph ${i} words`));
  const text = lines.join("\n");
  let state = EditorState.create({ doc: text, selection: EditorSelection.single(0, text.length) });
  const v = { dispatches: 0, get state() { return state; }, dispatch(spec) { v.dispatches++; state = state.update(spec).state; } };
  const t0 = performance.now();
  toggleDualFormat(v, "**", "<b>", "</b>");
  const ms = performance.now() - t0;
  const out = state.doc.toString().split("\n");
  ok(`main2-3: 3,000 pieces bolded in one dispatch (${ms.toFixed(0)} ms)`, v.dispatches === 1 && out.every((l, i) => (i % 2 ? l === "" : l === `**Paragraph ${i} words**`)), JSON.stringify(out.slice(0, 3)));
  ok("main2-3: …in well under the quadratic seconds", ms < 1500, `${ms.toFixed(0)} ms`);
  const t1 = performance.now();
  toggleDualFormat(v, "**", "<b>", "</b>");
  ok(`main2-3: and back (${(performance.now() - t1).toFixed(0)} ms)`, state.doc.toString() === text && performance.now() - t1 < 1500);
  {
    let st = EditorState.create({ doc: text, selection: EditorSelection.single(0, text.length) });
    const vc = { get state() { return st; }, dispatch(spec) { st = st.update(spec).state; } };
    const tc = performance.now();
    applyTextColor(vc, TEXT_COLORS[1]);
    const msc = performance.now() - tc;
    ok(`main2-3: a text colour over 3,000 pieces is linear too (${msc.toFixed(0)} ms)`, msc < 1500 && st.doc.line(1).text.startsWith("<span style="), `${msc.toFixed(0)} ms`);
  }
  // A tag pair that runs over rows takes the staged path, and still lands right.
  {
    const cross = 'a <u>one\ntwo</u> b\nthree';
    let st = EditorState.create({ doc: cross, selection: EditorSelection.single(0, cross.length) });
    const vx = { get state() { return st; }, dispatch(spec) { st = st.update(spec).state; } };
    toggleDualFormat(vx, "**", "<b>", "</b>");
    eq("main2-3: a cross-row tag pair keeps the staged path", st.doc.toString(), "<b>a <u>one</b>\n<b>two</u> b</b>\n**three**");
  }
  // Two ranges on one line take the composed path and still land right.
  let st2 = EditorState.create({
    doc: "one two three\nfour five",
    selection: EditorSelection.create([EditorSelection.range(0, 3), EditorSelection.range(8, 18)]),
    extensions: EditorState.allowMultipleSelections.of(true),
  });
  const v2 = { get state() { return st2; }, dispatch(spec) { st2 = st2.update(spec).state; } };
  toggleDualFormat(v2, "**", "<b>", "</b>");
  eq("main2-3: two ranges, one sharing a line with the other", st2.doc.toString(), "**one** two **three**\n**four** five");
}

/* ---------- review3-main3-1: editor commands stand down while a plugin card has focus ---------- */
{
  const calls = [];
  const plain = { id: "x", name: "X", editorCallback: (editor, ctx) => { calls.push(["cb", editor, ctx]); return "ran"; } };
  const check = { id: "y", name: "Y", editorCheckCallback: (checking, editor) => { calls.push(["check", checking, editor]); return true; } };
  const bare = { id: "z", name: "Z", callback: () => calls.push(["callback"]) };
  let focused = true;
  const g1 = guardPopoverCommand(plain, () => focused);
  const g2 = guardPopoverCommand(check, () => focused);
  const g3 = guardPopoverCommand(bare, () => focused);
  eq("main3-1: in a card, an editorCallback does nothing", [g1.editorCallback("ed", "ctx"), calls.length], [undefined, 0]);
  eq("main3-1: in a card, an editorCheckCallback reports false and does nothing", [g2.editorCheckCallback(false, "ed", "ctx"), g2.editorCheckCallback(true, "ed", "ctx"), calls.length], [false, false, 0]);
  focused = false;
  eq("main3-1: elsewhere the command runs as before", [g1.editorCallback("ed", "ctx"), g2.editorCheckCallback(true, "ed", "ctx")], ["ran", true]);
  eq("main3-1: …with its own arguments", calls, [["cb", "ed", "ctx"], ["check", true, "ed"]]);
  ok("main3-1: a plain callback command is left as it is", g3 === bare && g1.id === "x" && g1.name === "X");
  const el = (classes, parent = null) => ({ classes, parent, closest(sel) { for (let n = this; n; n = n.parent) if (sel.split(",").some((c) => n.classes.includes(c.trim().slice(1)))) return n; return null; } });
  const body = el(["body"]);
  eq("main3-1: focusInPluginPopover sees the link card, the comment card, and not the note",
    [el(["input"], el(["nf-link-pop"], body)), el(["textarea"], el(["nf-cmt-pop"], body)), el(["cm-content"], body)].map((activeElement) => focusInPluginPopover({ activeElement })),
    [true, true, false]);
}

/* ---------- review3-MODS-1: link syntax in code spans (and escaped) is text, and survives Save ---------- */
{
  const save = (line, selText, dest = "https://x.test") => {
    const from = line.indexOf(selText), to = from + selText.length;
    const t = linkCardTarget(line, from, to);
    const md = t.kind === "markdown" ? t.link : null, wiki = t.kind === "wiki" ? t.link : null;
    const span = t.kind === "text" ? { from: t.from, to: t.to } : { from, to };
    const text = md ? md.text : wiki ? wikiLinkFields(wiki).text : t.text;
    const ch = linkSavePlan({ lineText: line, lineFrom: 0, sel: span, md, wiki, text: text.trim(), dest, resolves: true, useMarkdownLinks: false });
    return { kind: t.kind, text, out: ch ? line.slice(0, ch.from) + ch.insert + line.slice(ch.to) : null };
  };
  eq("MODS-1: '`[text](url)`' round-trips inside the new link", save("Write `[text](url)` for links", "Write `[text](url)` for links").out, "[Write `[text](url)` for links](https://x.test)");
  eq("MODS-1: '`arr[0](fn)`' round-trips", save("Use `arr[0](fn)` to call it", "Use `arr[0](fn)` to call").out, "[Use `arr[0](fn)` to call](https://x.test) it");
  eq("MODS-1: '`[[Note]]`' round-trips", save("Type `[[Note]]` to link a note", "Type `[[Note]]` to link").out, "[Type `[[Note]]` to link](https://x.test) a note");
  eq("MODS-1: an escaped '\\[a](b)' round-trips", save("An escaped \\[a](b) bracket", "An escaped \\[a](b) bracket").out, "[An escaped \\[a](b) bracket](https://x.test)");
  eq("MODS-1: 'see [[x]] here' still flattens", save("see [[x]] here", "see [[x]] here").out, "[see x here](https://x.test)");
  eq("MODS-1: a real link beside a code span still flattens", save("a [b](c) and `[d](e)`", "a [b](c) and `[d](e)`").out, "[a b and `[d](e)`](https://x.test)");
  {
    const line = "Type `[[Note]]` to link a note";
    const col = line.indexOf("Note");
    eq("MODS-1: a caret inside '`[[Note]]`' opens no wikilink card", linkCardTarget(line, col, col).kind, "text");
    const md = "Say `[x](y)` here";
    eq("MODS-1: a caret inside '`[x](y)`' opens no Markdown link card", linkCardTarget(md, md.indexOf("x"), md.indexOf("x")).kind, "text");
    eq("MODS-1: enclosingMarkdownLink skips code", enclosingMarkdownLink(md, md.indexOf("x"), md.indexOf("x")), null);
    eq("MODS-1: enclosingWikiLink skips code", enclosingWikiLink(line, col, col), null);
  }
  eq("codeSpanRanges: single, double and unclosed runs", codeSpanRanges("a `b` c ``d ` e`` f ` g"), [{ from: 2, to: 5 }, { from: 8, to: 17 }]);
  eq("codeSpanRanges: an escaped backtick is literal", codeSpanRanges("\\`not` but `yes`"), [{ from: 5, to: 12 }]);
  eq("markdownLinksOnLine: code excluded, real kept", markdownLinksOnLine("`[a](b)` [c](d)").map((l) => l.text), ["c"]);
  eq("wikiLinksOnLine: code and escapes excluded", wikiLinksOnLine("`[[a]]` \\[[b]] [[c]]").map((l) => l.target), ["c"]);
}

/* ---------- review3-MODS-2: saving a wikilink untouched writes nothing ---------- */
{
  const plan = (line, { dest, text, resolves, useMarkdownLinks }) => {
    const wiki = wikiLinksOnLine(line)[0];
    const f = wikiLinkFields(wiki);
    const ch = linkSavePlan({ lineText: line, lineFrom: 0, sel: { from: wiki.start, to: wiki.end }, md: null, wiki,
      text: (text ?? f.text).trim(), dest: normalizeLinkDest(dest ?? f.dest), resolves, useMarkdownLinks });
    return ch ? line.slice(0, ch.from) + ch.insert + line.slice(ch.to) : null;
  };
  eq("MODS-2: an unresolved link saved untouched → no change", plan("Plan: [[Future note]] next.", { resolves: false, useMarkdownLinks: false }), null);
  eq("MODS-2: an unresolved alias link saved untouched → no change", plan("[[Some note|alias]] x", { resolves: false, useMarkdownLinks: false }), null);
  eq("MODS-2: a Markdown-links vault, saved untouched → no change", plan("See [[Existing|the demo]] now.", { resolves: true, useMarkdownLinks: true }), null);
  eq("MODS-2: a resolved link saved untouched → no change", plan("See [[Existing|the demo]] now.", { resolves: true, useMarkdownLinks: false }), null);
  eq("MODS-2: relabelling a not-yet-written note keeps the wikilink", plan("Plan: [[Future note]] next.", { text: "Soon", resolves: false, useMarkdownLinks: false }), "Plan: [[Future note|Soon]] next.");
  eq("MODS-2: a new URL destination still becomes Markdown", plan("See [[Existing]] now.", { dest: "https://x.test", resolves: false, useMarkdownLinks: false }), "See [Existing](https://x.test) now.");
  eq("MODS-2: a new unresolved destination still becomes Markdown", plan("See [[Existing]] now.", { dest: "Other note", resolves: false, useMarkdownLinks: false }), "See [Existing](<Other note>) now.");
  eq("MODS-2: an edited label in a Markdown-links vault still converts", plan("See [[Existing|the demo]] now.", { text: "demo", resolves: true, useMarkdownLinks: true }), "See [demo](Existing) now.");
}

/* ---------- review3-MODS-3 / MODS-4: a caption row keeps its hidden tags ---------- */
{
  const live = Facet.define({ combine: (v) => v[0] ?? true });
  const exts = createCaptionEditingExtensions({ enabled: () => true, livePreview: (s) => s.facet(live), captionAt: ownedBlockCaption });
  const cap = buildBlockCaption("image", "Old caption", false, "", true);
  const mk = (lines = ["![[image.png]]", cap, "tail words"], on = true) =>
    EditorState.create({ doc: lines.join("\n"), extensions: [exts[0], exts[3], live.of(on)] });
  let s = mk();
  const l2 = s.doc.line(2);
  const c = ownedBlockCaption(s.doc, 2);
  const bodyFrom = l2.from + c.bodyFrom, bodyTo = l2.from + c.bodyTo;
  // MODS-3: a selection reaching past the text's start (a second Shift+Home, Shift+Left at the start).
  s = s.update({ selection: { anchor: bodyTo } }).state;
  s = s.update({ selection: EditorSelection.range(bodyTo, l2.from), userEvent: "select" }).state;
  eq("MODS-3: a range to the row start stops at the caption text", [s.selection.main.anchor, s.selection.main.head], [bodyTo, bodyFrom]);
  const typed = s.update({ changes: { from: s.selection.main.from, to: s.selection.main.to, insert: "New" }, selection: { anchor: s.selection.main.from + 3 }, userEvent: "input.type" }).state;
  ok("MODS-3: typing over it keeps the caption owned", ownedBlockCaption(typed.doc, 2)?.text === "New" || ownedBlockCaption(typed.doc, 2) != null, JSON.stringify(typed.doc.line(2).text));
  eq("MODS-3: …and the row reads as the new caption", typed.doc.line(2).text, buildBlockCaption("image", "New", false, "", true));
  s = mk();
  s = s.update({ selection: EditorSelection.range(bodyFrom + 2, l2.to), userEvent: "select" }).state;
  eq("MODS-3: a range past the text's end stops before </small>", [s.selection.main.anchor, s.selection.main.head], [bodyFrom + 2, bodyTo]);
  s = mk();
  s = s.update({ selection: EditorSelection.range(l2.from, l2.to), userEvent: "select" }).state;
  eq("MODS-3: the whole row's markup is left as it is", [s.selection.main.from, s.selection.main.to], [l2.from, l2.to]);
  s = mk(undefined, false);
  s = s.update({ selection: EditorSelection.range(bodyTo, l2.from), userEvent: "select" }).state;
  eq("MODS-3: Source mode is left alone", [s.selection.main.anchor, s.selection.main.head], [bodyTo, l2.from]);
  s = mk();
  s = s.update({ selection: EditorSelection.range(s.doc.line(1).from, bodyFrom + 3), userEvent: "select" }).state;
  eq("MODS-3: a range over several rows is not clamped", [s.selection.main.anchor, s.selection.main.head], [s.doc.line(1).from, bodyFrom + 3]);

  // MODS-4: Backspace at the start of the row after the caption.
  s = mk();
  const l3 = s.doc.line(3);
  s = s.update({ selection: { anchor: l3.from } }).state;
  let tr = s.update({ changes: { from: l3.from - 1, to: l3.from }, userEvent: "delete.backward" });
  eq("MODS-4: Backspace after a caption does not join the row", tr.state.doc.toString(), s.doc.toString());
  eq("MODS-4: …the caret goes to the caption's end", tr.state.selection.main.head, bodyTo);
  // A blank next row may still be joined.
  s = mk(["![[image.png]]", cap, "   ", "after"]);
  const b3 = s.doc.line(3);
  s = s.update({ selection: { anchor: b3.from } }).state;
  tr = s.update({ changes: { from: b3.from - 1, to: b3.from }, userEvent: "delete.backward" });
  ok("MODS-4: joining a blank row is allowed", tr.state.doc.lines === 3 && ownedBlockCaption(tr.state.doc, 2) != null, JSON.stringify(tr.state.doc.toString()));
  // Delete at the owner row's end.
  s = mk();
  const l1 = s.doc.line(1);
  s = s.update({ selection: { anchor: l1.to } }).state;
  tr = s.update({ changes: { from: l1.to, to: l1.to + 1 }, userEvent: "delete.forward" });
  eq("MODS-4: Delete at the image row's end does not join the caption", tr.state.doc.toString(), s.doc.toString());
  // A code closer too.
  s = mk(["```js", "x", "```", buildBlockCaption("code", "Code", false, "", true), "after"]);
  const c3 = s.doc.line(3);
  s = s.update({ selection: { anchor: c3.to } }).state;
  tr = s.update({ changes: { from: c3.to, to: c3.to + 1 }, userEvent: "delete.forward" });
  eq("MODS-4: Delete at a fence closer's end does not join the caption", tr.state.doc.toString(), s.doc.toString());
  // Deleting whole rows up to the caption, and undo, are left alone.
  s = mk(["para", "![[image.png]]", cap]);
  s = s.update({ selection: EditorSelection.range(s.doc.line(2).from, s.doc.line(3).from) }).state;
  tr = s.update({ changes: { from: s.doc.line(2).from, to: s.doc.line(3).from }, userEvent: "delete.backward" });
  eq("MODS-4: deleting whole rows before a caption is left alone", tr.state.doc.toString(), "para\n" + cap);
  s = mk();
  s = s.update({ selection: { anchor: l3.from } }).state;
  tr = s.update({ changes: { from: l3.from - 1, to: l3.from }, userEvent: "undo" });
  eq("MODS-4: undo is exempt", tr.state.doc.lines, 2);
  s = mk();
  tr = s.update({ changes: { from: l3.from - 1, to: l3.from }, userEvent: "delete.backward" });
  eq("MODS-4: a join made away from the caret is left to its caller", tr.state.doc.lines, 2);
  // Alt+Backspace at the row start deletes the same newline: stopped too.
  s = mk(["![[image.png]]", cap, "> tail"]);
  const q3 = s.doc.line(3);
  s = s.update({ selection: { anchor: q3.from } }).state;
  tr = s.update({ changes: { from: q3.from - 1, to: q3.from }, userEvent: "delete.group.backward" });
  eq("MODS-4: Alt+Backspace at the row start is stopped as well", tr.state.doc.toString(), s.doc.toString());
}

if (fail) {
  console.log(`${fail} failure(s)`);
  process.exit(1);
}
console.log("PASS main w3");
