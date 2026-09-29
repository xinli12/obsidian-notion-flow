import { EditorSelection, EditorState } from "@codemirror/state";
import {
  linkSavePlan, wikiLinkUnlinkChange, enclosingWikiLinkOnLine, enclosingLinkOnLine,
  normalizeStyleSettings, loadedSettings, DEFAULT_SETTINGS, settingsAtDefaults,
  noteStyleEnv, trackMenu, hideTrackedMenus, OPEN_PLUGIN_MENUS,
  concealMarkSpec, makeConcealPlugin,
  editorSensitiveKey, noteStyleKey, persistedSettings,
  inCanvasCardEditor,
  lineFormatSegments, formatAcrossLines, segmentsActive, toggleWrap, toggleDualFormat, toggleUnderline,
  applyTextColor, applyHighlightColor, applyDefaultHighlight, removeHighlight, isDualFormatActive,
  TEXT_COLORS, BG_COLORS,
  blockTypeAt, batchTurnIntoChanges, blocksTouchedBySelection, turnContainerInto, turnBlockChange,
  innerBlockAt, addTurnIntoSection,
  snapOutOfHiddenPrefix, hiddenPrefixLeftTarget, makeCalloutEditPlugin,
  widgetContainerFor, columnsHeaderAbove, openVisualColumnAt, SlashSuggest, SLASH_COMMANDS,
  columnsEntryPlan, columnsAwareBlockRange, getBlockRange,
  blockCaretAwayEffect, blockCaretAwayField, closeVisualColumnEditor,
  nestedEditorFor, focusInPluginPopover, openColumnEditorView, stepOverHiddenRows,
  columnResizeCommits, codeFoldClick,
  captionOwnerIn, tabOnCaptionRows, ownedBlockCaption, buildBlockCaption,
  emptyToggleBodyPlan, listSiblingInsert, bareListMarkerRow, blockInsertAbovePlan, insertBlockAbove, insertBlockBelow,
  blockActionChords, pluginDefaultHotkeys, fenceExitPlan, tablePasteLanding,
  blockMenuAnchor, mergeSelectionRects,
  tableToolbarTop, tableToolbarLeft, toolbarPaneRect, TABLE_STRUCTURE_ROWS, TABLE_DELETE_ICONS,
  caretBlockEscapeKeymap,
  makeToolbarPlugin, openLinkPopover, commandHotkey, ariaKeyshortcuts, expandProseChords, editorHelpSections, blockChordRows,
  backspaceMarkerPlan,
  quoteBackspacePlan, calloutHeaderKeyPlan,
} from "./bundle.mjs";
import { keymap as cmKeymap, runScopeHandlers as cmRunScopeHandlers } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import NotionFlowPlugin from "./bundle.mjs";
import { computeBodyStyle, applyBodyStyle, clearBodyStyle, canvasPaletteFor } from "./features.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
};
/** A state over `text` with the selection anchor..head. */
const at = (text, anchor, head = anchor) => EditorState.create({ doc: text, selection: { anchor, head } });
/** Apply a { from, to, insert } change to `text`. */
const apply = (text, change) => text.slice(0, change.from) + change.insert + text.slice(change.to);

/* ---------- w1c: the link card edits wikilinks (no `[[[…]]](url)`) ---------- */
{
  const LINE = "See [[notion-flow-demo|the demo]] for more.";
  const lineFrom = 10;
  const doc = "x".repeat(lineFrom - 1) + "\n" + LINE;
  const inAlias = LINE.indexOf("the demo") + 2;
  const wiki = enclosingWikiLinkOnLine(at(LINE, inAlias));
  const whole = enclosingWikiLinkOnLine(at(LINE, LINE.indexOf("[["), LINE.indexOf("]]") + 2));
  ok("w1c: the caret inside the alias finds the wikilink", wiki && wiki.target === "notion-flow-demo");
  ok("w1c: a selection over the whole wikilink finds it too", whole && whole.start === wiki.start && whole.end === wiki.end);
  const sel = { from: lineFrom + inAlias, to: lineFrom + inAlias };
  const plan = (over) => linkSavePlan({
    lineText: LINE, lineFrom, sel, md: null, wiki, text: "the demo", dest: "notion-flow-demo",
    resolves: true, useMarkdownLinks: false, ...over,
  });
  const run = (over) => { const c = plan(over); return c ? apply(doc, c).slice(lineFrom) : null; };

  ok("w1c: new text keeps the wikilink", run({ text: "demo note" }) === "See [[notion-flow-demo|demo note]] for more.", run({ text: "demo note" }));
  ok("w1c: a URL turns the whole wikilink into one Markdown link",
    run({ text: "the demo", dest: "https://obsidian.md" }) === "See [the demo](https://obsidian.md) for more.",
    run({ text: "the demo", dest: "https://obsidian.md" }));
  ok("w1c: never nested", !run({ dest: "https://obsidian.md" }).includes("[[["));
  ok("w1c: an unresolved target writes Markdown",
    run({ text: "demo note", dest: "missing-note", resolves: false }) === "See [demo note](missing-note) for more.",
    run({ text: "demo note", dest: "missing-note", resolves: false }));
  ok("w1c: a vault writing Markdown links writes Markdown",
    run({ text: "demo note", useMarkdownLinks: true }) === "See [demo note](notion-flow-demo) for more.",
    run({ text: "demo note", useMarkdownLinks: true }));
  ok("w1c: a path with spaces stays a wikilink without <…>",
    run({ text: "demo note", dest: "<my note>" }) === "See [[my note|demo note]] for more.",
    run({ text: "demo note", dest: "<my note>" }));
  ok("w1c: text equal to the target writes [[target]]",
    run({ text: "notion-flow-demo" }) === "See [[notion-flow-demo]] for more.", run({ text: "notion-flow-demo" }));
  ok("w1c: unchanged fields leave the line as it was (nothing to write: review3-MODS-2)", plan({}) === null, run({}));
  ok("w1c: an invalid destination writes nothing", plan({ dest: "  " }) === null);
  const caret = plan({ text: "demo note" });
  ok("w1c: the caret lands right after the link",
    apply(doc, caret).slice(caret.caret, caret.caret + 9) === " for more", String(caret.caret));

  const unlink = wikiLinkUnlinkChange(lineFrom, LINE, wiki);
  ok("w1c: Unlink leaves the display text", apply(doc, unlink).slice(lineFrom) === "See the demo for more.", apply(doc, unlink).slice(lineFrom));
  ok("w1c: Unlink's range covers the display text", apply(doc, unlink).slice(unlink.from, unlink.caret) === "the demo");

  // A Markdown link and plain text keep today's plans.
  const MD = "See [docs page](https://example.com/docs) now.";
  const md = enclosingLinkOnLine(at(MD, 7));
  const mdOut = linkSavePlan({ lineText: MD, lineFrom: 0, sel: { from: 7, to: 7 }, md, wiki: null, text: "docs", dest: "https://x.y", resolves: false, useMarkdownLinks: false });
  ok("w1c: a Markdown link is rewritten in place", apply(MD, mdOut) === "See [docs](https://x.y) now.", apply(MD, mdOut));
  const PLAIN = "Some text to link right here.";
  const s = { from: PLAIN.indexOf("link right"), to: PLAIN.indexOf("link right") + 10 };
  const plain = linkSavePlan({ lineText: PLAIN, lineFrom: 0, sel: s, md: null, wiki: null, text: "link right", dest: "my note.md", resolves: false, useMarkdownLinks: false });
  ok("w1c: plain text becomes [text](<dest>)", apply(PLAIN, plain) === "Some text to [link right](<my note.md>) here.", apply(PLAIN, plain));

  // The toolbar's Link button lights inside a wikilink, never on an embed.
  ok("w1c: enclosingWikiLinkOnLine inside the alias", enclosingWikiLinkOnLine(at(LINE, inAlias)) != null);
  ok("w1c: no wikilink outside it", enclosingWikiLinkOnLine(at(LINE, 1)) == null && enclosingLinkOnLine(at(LINE, 1)) == null);
  ok("w1c: an embed is not a link the card edits", enclosingWikiLinkOnLine(at("x ![[pic.png]] y", 6)) == null);
}

/* ---------- item 1: note style settings, validation and migration ---------- */
{
  const n = (s) => normalizeStyleSettings({ ...DEFAULT_SETTINGS, ...s });
  ok("item 1: defaults need no patch", Object.keys(normalizeStyleSettings({ ...DEFAULT_SETTINGS })).length === 0,
    JSON.stringify(normalizeStyleSettings({ ...DEFAULT_SETTINGS })));
  ok("item 1: unknown palette -> classic", n({ palette: "bogus" }).palette === "classic");
  ok("item 1: unknown look -> classic", n({ look: 3 }).look === "classic");
  ok("item 1: a known palette stays", !("palette" in n({ palette: "rose-pine" })));
  ok("item 1: calloutStyle rail is valid", !("calloutStyle" in n({ calloutStyle: "rail" })));
  ok("item 1: calloutStyle x -> auto", n({ calloutStyle: "x" }).calloutStyle === "auto");
  ok("item 1: decorColor palette is valid", !("decorColor" in n({ decorColor: "palette" })));
  ok("item 1: codeTheme github is valid", !("codeTheme" in n({ codeTheme: "github" })));
  ok("item 1: codeTheme default is valid", !("codeTheme" in n({ codeTheme: "default" })));
  ok("item 1: codeTheme x -> auto", n({ codeTheme: "x" }).codeTheme === "auto");
  ok("item 1: quoteBarColor text is valid", !("quoteBarColor" in n({ quoteBarColor: "text" })));
  ok("item 1: listMarkerColor text is not", n({ listMarkerColor: "text" }).listMarkerColor === "auto");
  ok("item 1: tableHeaderColor none is valid", !("tableHeaderColor" in n({ tableHeaderColor: "none" })));
  ok("item 1: canvasUserSchemes x -> []", Array.isArray(n({ canvasUserSchemes: "x" }).canvasUserSchemes));
  ok("item 1: paletteHeadings yes -> false", n({ paletteHeadings: "yes" }).paletteHeadings === false);
  ok("item 1: canvasFollowPalette 0 -> true", n({ canvasFollowPalette: 0 }).canvasFollowPalette === true);
  ok("item 1: paletteSurface x -> theme", n({ paletteSurface: "x" }).paletteSurface === "theme");
  ok("item 1: garbage in never throws", typeof normalizeStyleSettings(null) === "object");

  // The user's data.json (the six style keys as stored, no styleSchema).
  const FIXTURE = {
    concealMarkdown: false, tableHeaderColor: "default", tableStripes: false,
    listMarkerColor: "accent", quoteBarColor: "accent", inlineCodeColor: "pink", codeTheme: "github",
    lastSeenVersion: undefined,
  };
  const first = loadedSettings(FIXTURE);
  const st = first.settings;
  ok("item 1: the fixture migrates once", first.persist === true);
  ok("item 1: migrated values (§4.4)",
    st.listMarkerColor === "auto" && st.quoteBarColor === "accent" && st.inlineCodeColor === "pink" &&
    st.codeTheme === "github" && st.calloutStyle === "auto" && st.tableHeaderColor === "auto" && st.styleSchema === 1,
    JSON.stringify([st.listMarkerColor, st.quoteBarColor, st.inlineCodeColor, st.codeTheme, st.calloutStyle, st.tableHeaderColor, st.styleSchema]));
  ok("item 1: other preferences survive", st.concealMarkdown === false && st.dragHandles === true);
  ok("item 1: lastSeenVersion is no setting", !("lastSeenVersion" in st));
  ok("item 1: canvasUserSchemes is a fresh array",
    Array.isArray(st.canvasUserSchemes) && st.canvasUserSchemes !== DEFAULT_SETTINGS.canvasUserSchemes);
  const stored = JSON.parse(JSON.stringify(st));
  const second = loadedSettings(stored);
  ok("item 1: a second load writes nothing", second.persist === false);
  ok("item 1: a second load is identical", JSON.stringify(second.settings) === JSON.stringify(st));
  const pinned = loadedSettings({ ...stored, listMarkerColor: "accent" });
  ok("item 1: an explicit accent chosen after migration survives", pinned.settings.listMarkerColor === "accent" && pinned.persist === false);
  const fresh = loadedSettings(null);
  ok("item 1: a fresh install loads the defaults and writes nothing",
    fresh.persist === false && settingsAtDefaults(fresh.settings) && fresh.settings.calloutStyle === "auto", JSON.stringify(fresh));
  const bad = loadedSettings({ styleSchema: 1, palette: "neon", calloutStyle: 7, canvasUserSchemes: [{ id: "a" }] });
  ok("item 1: invalid stored values resolve in memory only",
    bad.persist === false && bad.settings.palette === "classic" && bad.settings.calloutStyle === "auto");
  ok("item 1: saved canvas schemes are copied",
    bad.settings.canvasUserSchemes.length === 1 && bad.settings.canvasUserSchemes[0].id === "a");
}

/* ---------- item 2: one computed body style; tracked menus ---------- */
{
  /** A <body> stand-in: Set-backed classList, Map-backed style. */
  const fakeBody = () => {
    const classes = new Set();
    const props = new Map();
    return {
      classes, props,
      classList: { contains: (c) => classes.has(c), add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)) },
      style: {
        setProperty: (n, v) => props.set(n, v),
        removeProperty: (n) => { const v = props.get(n) ?? ""; props.delete(n); return v; },
        getPropertyValue: (n) => props.get(n) ?? "",
      },
    };
  };
  const migrated = loadedSettings({
    tableHeaderColor: "default", listMarkerColor: "accent", quoteBarColor: "accent", inlineCodeColor: "pink", codeTheme: "github",
  }).settings;
  const body = fakeBody();
  applyBodyStyle(body, computeBodyStyle(migrated, noteStyleEnv));
  const classes = [...body.classes].sort().join(" ");
  ok("item 2: the migrated fixture's classes", classes === "nf-code-color nf-code-theme-github nf-list-color nf-quote-color", classes);
  ok("item 2: list marker follows the palette, accent under Classic",
    body.props.get("--nf-list-marker") === "var(--nf-style-list-marker, var(--interactive-accent))", body.props.get("--nf-list-marker"));
  ok("item 2: quote bar keeps the explicit accent", body.props.get("--nf-quote-bar") === "var(--interactive-accent)");
  ok("item 2: inline code keeps the explicit pink ink (paletteTextColor)", body.props.get("--nf-inline-code") === "var(--nf-pink, #a85480)",
    body.props.get("--nf-inline-code"));
  ok("item 2: no other inline value", body.props.size === 3, JSON.stringify([...body.props]));
  const tinted = fakeBody();
  applyBodyStyle(tinted, computeBodyStyle({ ...migrated, tableHeaderColor: "blue" }, noteStyleEnv));
  ok("item 2: a hue header uses paletteTint", tinted.props.get("--nf-table-header-bg") === "rgba(var(--nf-blue-rgb, 74,124,166), 0.16)",
    tinted.props.get("--nf-table-header-bg"));
  const nord = fakeBody();
  applyBodyStyle(nord, computeBodyStyle({ ...migrated, palette: "nord" }, noteStyleEnv));
  ok("item 2: a palette adds its classes", nord.classes.has("nf-palette") && nord.classes.has("nf-palette-nord"));
  applyBodyStyle(nord, computeBodyStyle(migrated, noteStyleEnv));
  ok("item 2: back to Classic drops them", !nord.classes.has("nf-palette") && !nord.classes.has("nf-palette-nord"));
  const defaults = fakeBody();
  applyBodyStyle(defaults, computeBodyStyle({ ...DEFAULT_SETTINGS }, noteStyleEnv));
  ok("item 2: the defaults reproduce the old default classes",
    [...defaults.classes].sort().join(" ") === "nf-code-color nf-list-color nf-quote-color", [...defaults.classes].join(" "));
  clearBodyStyle(body);
  ok("item 2: clearBodyStyle empties the body", body.classes.size === 0 && body.props.size === 0);

  // trackMenu: one hide callback that also untracks the menu.
  const fakeMenu = () => ({ onHide(cb) { this.cb = cb; }, hide() { this.cb?.(); } });
  let calls = 0;
  const m1 = trackMenu(fakeMenu(), () => calls++);
  ok("item 2: trackMenu returns the menu and tracks it", OPEN_PLUGIN_MENUS.has(m1));
  m1.hide();
  ok("item 2: hiding runs the cleanup once and untracks", calls === 1 && !OPEN_PLUGIN_MENUS.has(m1), String(calls));
  const m2 = trackMenu(fakeMenu());
  const m3 = trackMenu(fakeMenu(), () => calls++);
  hideTrackedMenus();
  ok("item 2: hideTrackedMenus hides every tracked menu", OPEN_PLUGIN_MENUS.size === 0 && calls === 2, String(calls));
  const bare = trackMenu({});
  ok("item 2: a menu without onHide is left alone", !OPEN_PLUGIN_MENUS.has(bare));
  void m2;
}

/* ---------- item 4: caret-line highlights carry nf-hl ---------- */
{
  const MARK = '<mark style="background:rgba(var(--nf-yellow-rgb, 169,130,47), 0.2);color:inherit">x</mark>';
  const SPAN = '<span style="color:var(--nf-blue, #4a7ca6)">y</span>';
  const doc = `a ${MARK} b ${SPAN} <u>z</u>`;
  // ViewPlugin.fromClass is the identity in the view stub, so this is the
  // ConcealView class; build() needs none of the constructor's listeners.
  const Cls = makeConcealPlugin({ settings: { concealHtml: true, commenting: false, commentHoverCard: false } });
  const conceal = Object.create(Cls.prototype);
  conceal.build({
    state: EditorState.create({ doc }),
    visibleRanges: [{ from: 0, to: doc.length }],
    dom: { closest: () => ({ classList: { contains: () => true } }) },
  });
  const marks = [...conceal.decorations].filter((d) => d.kind === "mark");
  const markFor = (text) => marks.find((d) => doc.slice(d.from, d.to) === text);
  ok("item 4: three styled pairs become marks", marks.length === 3, String(marks.length));
  ok("item 4: a <mark> highlight's inner text carries nf-hl", markFor("x")?.spec.class === "nf-hl", JSON.stringify(markFor("x")?.spec));
  ok("item 4: the highlight keeps its inline style",
    markFor("x")?.spec.attributes.style === "background:rgba(var(--nf-yellow-rgb, 169,130,47), 0.2)", markFor("x")?.spec.attributes.style);
  ok("item 4: a colour span has no class", markFor("y") && !("class" in markFor("y").spec), JSON.stringify(markFor("y")?.spec));
  ok("item 4: an underline has no class", markFor("z") && !("class" in markFor("z").spec), JSON.stringify(markFor("z")?.spec));
  ok("item 4: concealMarkSpec on a background", concealMarkSpec("background:red").class === "nf-hl");
  ok("item 4: concealMarkSpec on a colour", concealMarkSpec("color:red").class === undefined);
}

/* ---------- item 5: canvas palette bridge; editors reconfigure only when needed ---------- */
{
  const base = { ...DEFAULT_SETTINGS, slashRecent: ["todo"], canvasUserSchemes: [] };
  const key = editorSensitiveKey(base);
  const same = (name, over) => ok(`item 5: ${name} does not reconfigure editors`, editorSensitiveKey({ ...base, ...over }) === key);
  same("lastTextColor", { lastTextColor: "blue" });
  same("lastHighlightColor", { lastHighlightColor: "default" });
  same("slashRecent", { slashRecent: ["h1", "todo"] });
  same("palette", { palette: "nord" });
  same("look", { look: "editorial" });
  same("calloutStyle", { calloutStyle: "flat" });
  same("codeTheme", { codeTheme: "github" });
  same("tableHeaderColor", { tableHeaderColor: "blue" });
  same("canvasMinimap", { canvasMinimap: false });
  same("canvasUserSchemes", { canvasUserSchemes: [{ id: "a" }] });
  same("canvasFollowPalette", { canvasFollowPalette: false });
  same("canvasFallbackPalette", { canvasFallbackPalette: "nord" });
  same("styleSchema", { styleSchema: 2 });
  ok("item 5: dragHandles reconfigures editors", editorSensitiveKey({ ...base, dragHandles: false }) !== key);
  ok("item 5: concealHtml reconfigures editors", editorSensitiveKey({ ...base, concealHtml: false }) !== key);
  ok("item 5: tableStripes reconfigures editors (not on the list)", editorSensitiveKey({ ...base, tableStripes: true }) !== key);
  ok("item 5: key order does not matter",
    editorSensitiveKey(Object.fromEntries(Object.entries(base).reverse())) === key);
  const style = noteStyleKey(base);
  ok("item 5: a palette changes the note-style key", noteStyleKey({ ...base, palette: "nord" }) !== style);
  ok("item 5: a component changes the note-style key", noteStyleKey({ ...base, calloutStyle: "flat" }) !== style);
  ok("item 5: a colour key changes the note-style key", noteStyleKey({ ...base, listMarkerColor: "red" }) !== style);
  ok("item 5: a remembered colour leaves the note-style key", noteStyleKey({ ...base, lastTextColor: "red" }) === style);

  const data = persistedSettings({ ...base, canvasFallbackPalette: "nord" }, "9.9.9");
  ok("item 5: data.json never holds canvasFallbackPalette", !("canvasFallbackPalette" in data), Object.keys(data).join());
  ok("item 5: data.json is stamped with the version", data.lastSeenVersion === "9.9.9");
  ok("item 5: data.json keeps the settings", data.palette === "classic" && data.slashRecent[0] === "todo" && data.canvasFollowPalette === true);
  const src = { ...base, canvasFallbackPalette: "nord" };
  persistedSettings(src, "1");
  ok("item 5: persistedSettings leaves the settings alone", src.canvasFallbackPalette === "nord");

  ok("item 5: nord follows as nord", canvasPaletteFor({ palette: "nord", canvasFollowPalette: true }) === "nord");
  ok("item 5: notion pairs with mist", canvasPaletteFor({ palette: "notion", canvasFollowPalette: true }) === "mist");
  ok("item 5: follow off gives none", canvasPaletteFor({ palette: "nord", canvasFollowPalette: false }) === null);
  ok("item 5: classic gives none", canvasPaletteFor({ palette: "classic", canvasFollowPalette: true }) === null);
  const loaded = loadedSettings({ palette: "nord", canvasFallbackPalette: "stale", styleSchema: 1 }).settings;
  ok("item 5: the defaults follow the palette", loaded.canvasFollowPalette === true && DEFAULT_SETTINGS.canvasFollowPalette === true);
  void loaded;
}

/* ---------- w1c: Escape in a Canvas card's iframe editor is left to the card ---------- */
{
  // A fake editor DOM: `closest` answers from a set of matching selectors;
  // `frame` is the window's frameElement (or a getter that throws).
  const fakeDom = (own, frame) => ({
    closest: (sel) => (own.includes(sel) ? {} : null),
    ownerDocument: { defaultView: frame === undefined ? {} : Object.defineProperty({}, "frameElement", {
      get: () => { if (frame === "throw") throw new Error("cross-origin"); return frame; },
    }) },
  });
  const frameIn = (sels) => ({ closest: (sel) => (sels.includes(sel) ? {} : null) });
  ok("w1c: an editor inside .canvas-node is a card editor", inCanvasCardEditor(fakeDom([".canvas-node"])) === true);
  ok("w1c: an iframe editor whose frame sits in .canvas-node is a card editor",
    inCanvasCardEditor(fakeDom([], frameIn([".canvas-node"]))) === true);
  ok("w1c: a plain note editor is not", inCanvasCardEditor(fakeDom([])) === false);
  ok("w1c: an iframe outside any card is not", inCanvasCardEditor(fakeDom([], frameIn([".workspace-leaf"]))) === false);
  ok("w1c: a null frameElement is not", inCanvasCardEditor(fakeDom([], null)) === false);
  ok("w1c: a cross-origin frame is not (no throw)", inCanvasCardEditor(fakeDom([], "throw")) === false);
}

/* ---------- item 6: a selection across lines is formatted line by line ---------- */
{
  /** A fake view over `text` with one range per [anchor, head] (multiple selections allowed). */
  const fv = (text, ...ranges) => {
    let state = EditorState.create({
      doc: text,
      selection: EditorSelection.create(ranges.map(([a, h]) => EditorSelection.range(a, h))),
      extensions: EditorState.allowMultipleSelections.of(true),
    });
    const v = { dispatches: 0, get state() { return state; }, dispatch(spec) { v.dispatches++; state = state.update(spec).state; } };
    return v;
  };
  const all = (text) => fv(text, [0, text.length]);
  const bold = (v) => toggleDualFormat(v, "**", "<b>", "</b>");
  const italic = (v) => toggleDualFormat(v, "*", "<i>", "</i>");
  const boldOn = (s) => isDualFormatActive(s, "**", "<b>", "</b>");
  const P = "First paragraph words here.\n\nSecond paragraph words here.";
  const pSel = () => fv(P, [6, P.indexOf("Second") + 16]);
  const BLUE = TEXT_COLORS[6], RED = TEXT_COLORS[1], YELLOW_BG = BG_COLORS[3];
  const span = (c, x) => `<span style="color:${c}">${x}</span>`;
  const mark = (c, x) => `<mark style="background:${c};color:inherit">${x}</mark>`;

  let v = pSel();
  bold(v);
  ok("item 6: bold across paragraphs wraps each line", v.state.doc.toString() === "First **paragraph words here.**\n\n**Second paragraph** words here.", v.state.doc.toString());
  ok("item 6: one transaction (one undo)", v.dispatches === 1, String(v.dispatches));
  const sel = v.state.selection.main;
  ok("item 6: the selection runs from the first piece to the last",
    v.state.doc.sliceString(sel.from, sel.to) === "paragraph words here.**\n\n**Second paragraph", v.state.doc.sliceString(sel.from, sel.to));
  ok("item 6: bold is lit across both lines afterwards", segmentsActive(v.state, boldOn) === true);
  ok("item 6: not lit before", segmentsActive(pSel().state, boldOn) === false);
  bold(v);
  ok("item 6: bold again restores the text", v.state.doc.toString() === P, v.state.doc.toString());
  v = pSel(); bold(v); italic(v);
  ok("item 6: italic over the bolded pieces makes bold italic",
    v.state.doc.toString() === "First ***paragraph words here.***\n\n***Second paragraph*** words here.", v.state.doc.toString());

  v = fv(P, [P.indexOf("Second") + 16, 6]);
  bold(v);
  ok("item 6: a backward selection stays backward", v.state.selection.main.head < v.state.selection.main.anchor);

  v = all("- item one\n- item two");
  bold(v);
  ok("item 6: list items are bolded after their markers", v.state.doc.toString() === "- **item one**\n- **item two**", v.state.doc.toString());
  bold(v);
  ok("item 6: and back", v.state.doc.toString() === "- item one\n- item two", v.state.doc.toString());

  v = pSel();
  applyTextColor(v, BLUE);
  ok("item 6: text colour gives one span per line",
    v.state.doc.toString() === `First ${span(BLUE, "paragraph words here.")}\n\n${span(BLUE, "Second paragraph")} words here.`, v.state.doc.toString());
  applyTextColor(v, RED);
  ok("item 6: a second colour recolours both spans in place",
    v.state.doc.toString() === `First ${span(RED, "paragraph words here.")}\n\n${span(RED, "Second paragraph")} words here.`, v.state.doc.toString());
  applyTextColor(v, null);
  ok("item 6: removing the colour restores the text", v.state.doc.toString() === P, v.state.doc.toString());

  v = pSel();
  applyHighlightColor(v, YELLOW_BG);
  ok("item 6: highlight gives one mark per line",
    v.state.doc.toString() === `First ${mark(YELLOW_BG, "paragraph words here.")}\n\n${mark(YELLOW_BG, "Second paragraph")} words here.`, v.state.doc.toString());
  removeHighlight(v);
  ok("item 6: removing the highlight restores the text", v.state.doc.toString() === P, v.state.doc.toString());
  ok("item 6: removal is one transaction", v.dispatches === 2, String(v.dispatches));

  v = pSel();
  applyDefaultHighlight(v);
  ok("item 6: the theme highlight wraps each line in ==",
    v.state.doc.toString() === "First ==paragraph words here.==\n\n==Second paragraph== words here.", v.state.doc.toString());
  removeHighlight(v);
  ok("item 6: and Remove clears both", v.state.doc.toString() === P, v.state.doc.toString());

  v = pSel();
  toggleWrap(v, "`");
  ok("item 6: inline code gives two backtick pairs",
    v.state.doc.toString() === "First `paragraph words here.`\n\n`Second paragraph` words here.", v.state.doc.toString());
  toggleWrap(v, "`");
  ok("item 6: inline code toggles back", v.state.doc.toString() === P, v.state.doc.toString());

  v = pSel();
  toggleUnderline(v);
  ok("item 6: underline gives two <u> pairs",
    v.state.doc.toString() === "First <u>paragraph words here.</u>\n\n<u>Second paragraph</u> words here.", v.state.doc.toString());
  toggleUnderline(v);
  ok("item 6: underline toggles back", v.state.doc.toString() === P, v.state.doc.toString());

  const FENCE = "para one\n```\ncode a\n  code b\n```\npara two";
  v = all(FENCE); bold(v);
  ok("item 6: fence delimiters untouched, code lines get <b> per line",
    v.state.doc.toString() === "**para one**\n```\n<b>code a</b>\n  <b>code b</b>\n```\n**para two**", v.state.doc.toString());

  const TABLE = "text\n| a | b |\n| - | - |\n| 1 | 2 |\nmore";
  v = all(TABLE); bold(v);
  ok("item 6: table rows are skipped", v.state.doc.toString() === "**text**\n| a | b |\n| - | - |\n| 1 | 2 |\n**more**", v.state.doc.toString());

  v = all("> [!note] Title\n> body line\n> second"); bold(v);
  ok("item 6: a Callout header is skipped", v.state.doc.toString() === "> [!note] Title\n> **body line**\n> **second**", v.state.doc.toString());

  v = all("# Title\n\npara"); bold(v);
  ok("item 6: a heading is bolded after its marker", v.state.doc.toString() === "# **Title**\n\n**para**", v.state.doc.toString());

  v = all("a\n\n---\n\nb"); bold(v);
  ok("item 6: a rule is skipped", v.state.doc.toString() === "**a**\n\n---\n\n**b**", v.state.doc.toString());

  v = all("a\n$$\nx^2\n$$\nb"); bold(v);
  ok("item 6: display math lines are skipped", v.state.doc.toString() === "**a**\n$$\nx^2\n$$\n**b**", v.state.doc.toString());
  v = all("a\n$$E=mc^2$$\n> $$\n> y\n> $$\nb"); bold(v);
  ok("item 6: one-line and quoted display math are skipped too",
    v.state.doc.toString() === "**a**\n$$E=mc^2$$\n> $$\n> y\n> $$\n**b**", v.state.doc.toString());

  v = all("**bold**\nplain"); bold(v);
  ok("item 6: a mixed selection gains bold everywhere (no unwrap)", v.state.doc.toString() === "**bold**\n**plain**", v.state.doc.toString());

  const B = "x <b>one</b>\n<b>two</b> y";
  v = fv(B, [B.indexOf("one"), B.indexOf("two") + 3]);
  bold(v);
  ok("item 6: pieces inside HTML bold runs unwrap them", v.state.doc.toString() === "x one\ntwo y", v.state.doc.toString());

  ok("item 6: no segments for a one-line selection", lineFormatSegments(fv("one two\nthree", [0, 3]).state) === null);
  ok("item 6: no segments for a selection inside one line of a longer note", lineFormatSegments(fv("a\none two\nb", [2, 5]).state) === null);
  ok("item 6: no segments for a caret", lineFormatSegments(fv("a\nb", [1, 1]).state) === null);
  const segs = lineFormatSegments(fv("ab\n\ncd", [1, 5]).state);
  ok("item 6: segments clamp to the selection and skip blank lines",
    JSON.stringify(segs) === JSON.stringify([{ from: 1, to: 2 }, { from: 4, to: 5 }]), JSON.stringify(segs));
  ok("item 6: formatAcrossLines leaves one-line selections to the caller",
    formatAcrossLines(fv("one two", [0, 3]), null, () => { throw new Error("ran"); }) === false);
  v = fv("one\n\ntwo", [0, 1]);
  bold(v);
  ok("item 6: the single-line path is unchanged", v.state.doc.toString() === "**o**ne\n\ntwo", v.state.doc.toString());
}

/* ---------- item 7: Turn into converts every selected block; containers go by their title ---------- */
{
  const docOf = (text) => EditorState.create({ doc: text }).doc;
  const applyAll = (text, changes) =>
    [...changes].sort((a, b) => b.from - a.from).reduce((out, c) => apply(out, c), text);
  const typeOf = (text, line = 1) => { const d = docOf(text); return blockTypeAt(d, innerBlockAt(d, line)); };
  ok("item 7: a Callout reads as callout", typeOf("> [!note] T\n> body") === "callout");
  ok("item 7: a one-row Callout too", typeOf("> [!tip] T") === "callout");
  ok("item 7: a toggle reads as toggle", typeOf("> [!nf-toggle]+ T\n> body") === "toggle");
  ok("item 7: a columns row is not a Callout (text)", typeOf("> [!nf-cols]\n> > [!nf-col]\n> > a") === "text");
  ok("item 7: a plain quote is still a quote", typeOf("> a\n> b") === "quote");
  ok("item 7: a Callout nested in a Callout reads as callout", typeOf("> [!note] O\n> > [!tip] I\n> > d", 2) === "callout");
  ok("item 7: a row inside a Callout keeps its own type", typeOf("> [!note] O\n> - item\n> more", 2) === "bullet");

  // The batch shares the single-block change: a Callout row keeps its "> ".
  {
    const text = "> [!note] Title\n> row one\n>\n> row two";
    const d = docOf(text);
    const rows = [{ startLine: 2, endLine: 2, quotePrefix: "> " }, { startLine: 4, endLine: 4, quotePrefix: "> " }];
    const r = batchTurnIntoChanges(d, rows, "- ");
    ok("item 7: the batch keeps a Callout row's marker",
      applyAll(text, r.changes) === "> [!note] Title\n> - row one\n>\n> - row two" && r.skipped === 0,
      JSON.stringify(applyAll(text, r.changes)));
    const whole = batchTurnIntoChanges(d, [innerBlockAt(d, 1)], "## ");
    ok("item 7: the batch retypes a whole Callout by its title",
      applyAll(text, whole.changes) === "## Title\n\nrow one\n\nrow two", JSON.stringify(applyAll(text, whole.changes)));
    const rule = batchTurnIntoChanges(docOf("> [!note] T\n> ---\n> x"), [{ startLine: 2, endLine: 2, quotePrefix: "> " }], "- ");
    ok("item 7: a rule inside a Callout is skipped, not prefixed", rule.changes.length === 0 && rule.skipped === 1, JSON.stringify(rule));
  }

  // The selection helper: distinct blocks in document order, seams skipped.
  {
    const text = "# T\nline a\n\nline b\n\nline c";
    const d = docOf(text);
    const blocks = blocksTouchedBySelection(d, d.line(2).from, d.length);
    ok("item 7: three paragraphs are three blocks, the seams none",
      JSON.stringify(blocks.map((b) => [b.startLine, b.endLine])) === "[[2,2],[4,4],[6,6]]", JSON.stringify(blocks));
    ok("item 7: …and become three bullets in one batch",
      applyAll(text, batchTurnIntoChanges(d, blocks, "- ").changes) === "# T\n- line a\n\n- line b\n\n- line c");
    const t2 = "# T\nline a\nline b\n\nline c";
    const d2 = docOf(t2);
    const b2 = blocksTouchedBySelection(d2, d2.line(2).from, d2.length);
    ok("item 7: a two-row paragraph is one block, retyped on its first row",
      applyAll(t2, batchTurnIntoChanges(d2, b2, "- ").changes) === "# T\n- line a\nline b\n\n- line c", JSON.stringify(b2));
    ok("item 7: …and ⌘⌥2 over it gives two headings",
      applyAll(t2, batchTurnIntoChanges(d2, b2, "## ").changes) === "# T\n## line a\nline b\n\n## line c");
    ok("item 7: a selection ending at a row start stops before that row",
      blocksTouchedBySelection(d, d.line(2).from, d.line(4).from).length === 1);
    ok("item 7: a backward selection gives the same blocks",
      JSON.stringify(blocksTouchedBySelection(d, d.length, d.line(2).from)) === JSON.stringify(blocks));
    const t3 = "para\n\n> [!note] T\n> body one\n> body two\n\nafter";
    const d3 = docOf(t3);
    const b3 = blocksTouchedBySelection(d3, 0, d3.length);
    ok("item 7: a Callout inside the selection is one block, not its rows too",
      JSON.stringify(b3.map((b) => [b.startLine, b.endLine])) === "[[1,1],[3,5],[7,7]]", JSON.stringify(b3));
    ok("item 7: blank-only selections touch no block", blocksTouchedBySelection(docOf("a\n\n\nb"), 2, 3).length === 0);
  }

  // Containers by title.
  {
    const one = (text, prefix, line = 1) => {
      const d = docOf(text);
      const c = turnBlockChange(d, innerBlockAt(d, line), prefix);
      return c ? apply(text, c) : null;
    };
    ok("item 7: Callout → H2 changes the title only", one("> [!note] Title\n> body one\n> body two", "## ") === "## Title\n\nbody one\nbody two");
    ok("item 7: Callout → bullet indents the body", one("> [!note] Title\n> body one\n> body two", "- ") === "- Title\n\n  body one\n  body two");
    ok("item 7: toggle → bullet keeps the child nested", one("> [!nf-toggle]+ Tog\n> - child", "- ") === "- Tog\n  - child");
    ok("item 7: one-row Callout → H2", one("> [!note] Title", "## ") === "## Title");
    ok("item 7: Callout → Text unchanged", one("> [!note] Title\n> body", "") === "Title\nbody");
    ok("item 7: Callout → Quote unchanged for a plain body", one("> [!note] Title\n> body", "> ") === "> Title\n> body");
    ok("item 7: turnContainerInto leaves plain blocks alone", turnContainerInto(docOf("para"), { startLine: 1, endLine: 1 }, "## ") === null);
    ok("item 7: …and a one-row plain quote to the one-row path", turnContainerInto(docOf("> q"), { startLine: 1, endLine: 1 }, "## ") === null);
  }

  // The menu reads "Turn into · Callout" with Callout ticked, Quote not.
  {
    const fakeDoc = {
      createDocumentFragment() {
        const parts = [];
        return { parts, createSpan({ text }) { parts.push(text); }, appendChild() {}, toString() { return parts.join(" "); } };
      },
      createTextNode(text) { return text; },
    };
    const titleOf = (item) => typeof item.title === "string" ? item.title : item.title.parts[0];
    const build = (current, wraps) => {
      const items = [];
      const menu = {
        addItem(cb) {
          const item = {
            setTitle(v) { this.title = v; return this; }, setIcon() { return this; },
            setChecked(v) { this.checked = v; return this; }, onClick(fn) { this.click = fn; return this; },
            setIsLabel() { return this; },
            setSubmenu() { this.sub = []; const sub = { addItem: (cb2) => { const it = { ...item0() }; cb2(it); this.sub.push(it); return sub; }, addSeparator() { return sub; } }; return sub; },
          };
          cb(item); items.push(item); return menu;
        },
        addSeparator() { return menu; },
      };
      const item0 = () => ({
        setTitle(v) { this.title = v; return this; }, setIcon() { return this; },
        setChecked(v) { this.checked = v; return this; }, onClick(fn) { this.click = fn; return this; },
      });
      const wrapped = [];
      addTurnIntoSection(menu, fakeDoc, null, {
        current, turnable: true, wraps, onTurn: () => {}, onWrap: (kind) => wrapped.push(kind),
      });
      return { items, wrapped };
    };
    const { items, wrapped } = build("callout", ["toggle", "code"]);
    const row = items[0];
    ok("item 7: the handle menu reads Turn into · Callout", row.title === "Turn into · Callout", row.title);
    const sub = row.sub ?? [];
    const callout = sub.find((it) => titleOf(it) === "Callout");
    const quote = sub.find((it) => titleOf(it) === "Quote");
    ok("item 7: the Callout row is listed and ticked", !!callout && callout.checked === true);
    ok("item 7: the Quote row is not ticked", !!quote && quote.checked === false);
    ok("item 7: no TURN_INTO row is ticked", sub.filter((it) => it.checked).length === 1);
    callout?.click?.();
    ok("item 7: the ticked Callout row is inert", wrapped.length === 0);
    const tog = build("toggle", ["callout", "code"]);
    ok("item 7: a toggle reads Turn into · Toggle", tog.items[0].title === "Turn into · Toggle");
    ok("item 7: …with the Toggle row ticked", (tog.items[0].sub ?? []).some((it) => titleOf(it) === "Toggle" && it.checked));
    const para = build("text", ["callout", "toggle", "code"]);
    ok("item 7: a paragraph still reads Turn into · Text", para.items[0].title === "Turn into · Text");
  }
}

/* ---------- w1c: no caret rests inside a Callout/toggle body row's hidden "> " ---------- */
{
  const ALL_ON = { calloutEditing: true, codeBlockEditing: true, toggleBlocks: true, columnLayout: true };
  /** Build the Callout edit plugin over `text` with the caret at `caret`. */
  const built = (text, caret) => {
    const state = EditorState.create({ doc: text, selection: { anchor: caret } });
    const view = {
      state,
      visibleRanges: [{ from: 0, to: state.doc.length }],
      contentDOM: { clientWidth: 700, style: { setProperty() {} } },
      dom: { closest: (selector) => (String(selector).includes("is-live-preview") ? {} : null) },
    };
    const Plugin = makeCalloutEditPlugin({ settings: ALL_ON, app: {} });
    const instance = Object.create(Plugin.prototype);
    const ranges = instance.build.call(instance, view);
    return { state, instance, ranges };
  };
  for (const [name, text] of [
    ["toggle", "> [!nf-toggle]+ T\n> body one\n> body two"],
    ["Callout", "> [!note] T\n> body one\n> body two"],
  ]) {
    const { state, instance } = built(text, text.indexOf("body one") + 3);
    const doc = state.doc;
    const zones = instance.zones;
    // fix-toggle-title-marker: a toggle's header draws its triangle whatever
    // row the caret is on, so its markers are a zone ending at the title too.
    const head = name === "toggle" ? [{ from: 0, to: "> [!nf-toggle]+ ".length }] : [];
    ok(`w1c: the ${name}'s body rows have hidden zones`,
      JSON.stringify(zones) === JSON.stringify([...head, { from: doc.line(2).from, to: doc.line(2).from + 2 }, { from: doc.line(3).from, to: doc.line(3).from + 2 }]),
      JSON.stringify(zones));
    const atoms = [...instance.hidden].filter((r) => r.from === doc.line(2).from && r.to === doc.line(2).from + 2);
    ok(`w1c: the ${name}'s body gap is an atomic range`, atoms.length === 1, JSON.stringify(instance.hidden));
    const two = doc.line(3).from;
    const snap = (anchor, head = anchor) =>
      snapOutOfHiddenPrefix(EditorSelection.create([EditorSelection.range(anchor, head)]), zones);
    ok(`w1c: ${name}: a caret at ch 0 goes to ch 2`, snap(two)?.main.head === two + 2);
    ok(`w1c: ${name}: a caret at ch 1 goes to ch 2`, snap(two + 1)?.main.head === two + 2);
    ok(`w1c: ${name}: a caret at the text start is left alone`, snap(two + 2) === null);
    const range = snap(doc.line(1).to, two);
    ok(`w1c: ${name}: a range keeps its anchor, only the head moves`,
      range?.main.anchor === doc.line(1).to && range?.main.head === two + 2, JSON.stringify(range?.main));
    ok(`w1c: ${name}: ArrowLeft from the text start goes to the end of the row above`,
      hiddenPrefixLeftTarget(doc, two + 2, zones) === doc.line(2).to);
    ok(`w1c: ${name}: …and from mid-text it is CodeMirror's own step`, hiddenPrefixLeftTarget(doc, two + 4, zones) === null);
  }
  {
    // The toggle header's markers and token sit behind its triangle
    // (fix-toggle-title-marker): a zone up to the title, like a body row's,
    // unless the caret is inside the token, where the source is shown.
    const text = "> [!nf-toggle]+ T\n> body";
    const { instance } = built(text, text.length);
    ok("w1c: a toggle header's zone ends at its title",
      instance.zones.some((z) => z.from === 0 && z.to === "> [!nf-toggle]+ ".length), JSON.stringify(instance.zones));
    const inside = built(text, 6).instance;
    ok("w1c: a caret inside the token: no header zone", !inside.zones.some((z) => z.from === 0), JSON.stringify(inside.zones));
  }
  {
    // A plain quote is not a Callout: its markers keep today's behaviour.
    const text = "> one\n> two";
    const { instance } = built(text, text.length);
    ok("w1c: a plain quote has no zones", instance.zones.length === 0);
  }
  {
    // Multi-cursor: each head is snapped on its own.
    const zones = [{ from: 10, to: 12 }, { from: 20, to: 22 }];
    const sel = EditorSelection.create([EditorSelection.cursor(10), EditorSelection.cursor(15), EditorSelection.cursor(21)], 2);
    const out = snapOutOfHiddenPrefix(sel, zones);
    ok("w1c: every head snaps, the main index is kept",
      JSON.stringify(out?.ranges.map((r) => r.head)) === "[12,15,22]" && out?.mainIndex === 2, JSON.stringify(out?.ranges.map((r) => r.head)));
  }
}

/* ---------- w1c: toggle gaps charge a quote level the shared --nf-quote-inset ---------- */
{
  const text = "> > [!nf-toggle]+ T\n> > body";
  const state = EditorState.create({ doc: text, selection: { anchor: text.length } });
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: { clientWidth: 700, style: { setProperty() {} } },
    dom: { closest: (selector) => (String(selector).includes("is-live-preview") ? {} : null) },
  };
  const Plugin = makeCalloutEditPlugin({ settings: { calloutEditing: true, codeBlockEditing: true, toggleBlocks: true, columnLayout: true }, app: {} });
  const instance = Object.create(Plugin.prototype);
  const ranges = instance.build.call(instance, view);
  const gaps = [...ranges].filter((r) => r.kind === "replace" && r.spec?.widget?.kind === "toggle");
  const widths = gaps.map((r) => {
    const el = { style: { width: "", setProperty() {} }, setAttribute() {}, className: "" };
    r.spec.widget.toDOM({ dom: { ownerDocument: { createElement: () => el } } });
    return el.style.width;
  });
  ok("w1c: the toggle rows have gap widgets", widths.length === 2, JSON.stringify(widths));
  ok("w1c: an outer quote level costs var(--nf-quote-inset,0.7em), not a literal 0.7em",
    widths.every((w) => w.includes("var(--nf-prefix-outer-depth,0) * var(--nf-quote-inset,0.7em)") && !/\* 0\.7em/.test(w)), JSON.stringify(widths));
}

/* ---------- item 8: /cols and drops open the column editor; widget landings select the whole box ---------- */
{
  const docOf = (lines) => EditorState.create({ doc: lines.join("\n") }).doc;
  const span = (b) => (b ? [b.startLine, b.endLine] : null);
  const cols = ["intro", "", "> [!nf-cols]", "> > [!nf-col]", "> > left", ">", "> > [!nf-col]", "> > right", "", "tail"];
  const d = docOf(cols);
  ok("item 8: a paragraph landed inside a column → the whole columns row",
    JSON.stringify(span(widgetContainerFor(d, 8, 1, true))) === "[3,8]", JSON.stringify(widgetContainerFor(d, 8, 1, true)));
  ok("item 8: a columns row that landed itself → that row",
    JSON.stringify(span(widgetContainerFor(d, 3, 6, false))) === "[3,8]");
  ok("item 8: columnsHeaderAbove walks up to the header", columnsHeaderAbove(d, 8) === 3 && columnsHeaderAbove(d, 3) === 3);
  ok("item 8: …and stops at a plain row", columnsHeaderAbove(d, 10) === null && columnsHeaderAbove(d, 1) === null);
  const callout = docOf(["a", "", "> [!note] T", "> body", "", "b"]);
  ok("item 8: a Callout moved whole → itself", JSON.stringify(span(widgetContainerFor(callout, 3, 2, false))) === "[3,4]");
  ok("item 8: a row landed inside a regular Callout → null (it keeps its caret)", widgetContainerFor(callout, 4, 1, true) === null);
  const table = docOf(["a", "", "| x | y |", "| - | - |", "| 1 | 2 |", "", "b"]);
  ok("item 8: a table → itself", JSON.stringify(span(widgetContainerFor(table, 3, 3, false))) === "[3,5]");
  ok("item 8: a plain paragraph → null", widgetContainerFor(table, 1, 1, false) === null);
  const embed = docOf(["a", "", "![[pic.png]]", "", "b"]);
  ok("item 8: an embed line → itself", JSON.stringify(span(widgetContainerFor(embed, 3, 1, false))) === "[3,3]");
  ok("item 8: a span wider than the widget is left to the row-by-row landing",
    widgetContainerFor(callout, 3, 4, false) === null);
  const nested = docOf(["> [!note] O", "> > [!tip] I", "> > deep"]);
  ok("item 8: a Callout nested in another is no top-level widget", widgetContainerFor(nested, 2, 2, false) === null);

  // /cols2 puts the caret on column 1's first content row (existing behaviour, kept).
  let lines = ["/cols2"];
  const writer = {
    getLine: (n) => lines[n] ?? "",
    setCursor(cur) { writer.cursor = cur; },
    replaceRange(text, from, to) {
      const head = lines[from.line].slice(0, from.ch);
      const tail = lines[to.line].slice(to.ch);
      lines.splice(from.line, to.line - from.line + 1, ...(head + text + tail).split("\n"));
    },
  };
  const cols2 = SLASH_COMMANDS.find((command) => command.id === "cols2");
  SlashSuggest.insertSnippetInto(writer, { line: 0, ch: 0 }, { line: 0, ch: 6 }, cols2);
  ok("item 8: /cols2 writes a two-column row", lines[0] === "> [!nf-cols]" && lines.filter((l) => l.includes("[!nf-col]")).length === 2, JSON.stringify(lines));
  ok("item 8: …with the caret on column 1's first content row",
    writer.cursor && lines[writer.cursor.line].startsWith("> > ") && lines[writer.cursor.line - 1] === "> > [!nf-col]" &&
      lines.slice(0, writer.cursor.line).filter((l) => l.includes("[!nf-col]")).length === 1, JSON.stringify(writer.cursor));
  ok("item 8: the header is found from that caret row", columnsHeaderAbove(docOf(lines), writer.cursor.line + 1) === 1);
  // review3-main3-2: /cols2 right under a Callout's last row gets a blank seam, so it is not glued into the Callout.
  lines = ["> [!note] T", "> body", "/cols2"];
  SlashSuggest.insertSnippetInto(writer, { line: 2, ch: 0 }, { line: 2, ch: 6 }, cols2);
  ok("main3-2: /cols2 under '> body' leaves a blank row", lines.slice(0, 4).join("\n") === "> [!note] T\n> body\n\n> [!nf-cols]", JSON.stringify(lines));
  ok("main3-2: …and the columns row is found from its caret", columnsHeaderAbove(docOf(lines), writer.cursor.line + 1) === 4, JSON.stringify(writer.cursor));
  lines = ["> [!note] T", "> body", "", "/cols3"];
  SlashSuggest.insertSnippetInto(writer, { line: 3, ch: 0 }, { line: 3, ch: 6 }, SLASH_COMMANDS.find((command) => command.id === "cols3"));
  ok("main3-2: an existing blank row is not doubled", lines.slice(0, 4).join("\n") === "> [!note] T\n> body\n\n> [!nf-cols]", JSON.stringify(lines));
  lines = ["Para", "/cols2"];
  SlashSuggest.insertSnippetInto(writer, { line: 1, ch: 0 }, { line: 1, ch: 6 }, cols2);
  ok("main3-2: under a paragraph nothing changes", lines.slice(0, 2).join("\n") === "Para\n> [!nf-cols]", JSON.stringify(lines));

  // openVisualColumnAt: dispatches the column effect only on a columns row in Live Preview with columns on.
  const viewOver = (text, live = true) => {
    let state = EditorState.create({ doc: text });
    const specs = [];
    return {
      get state() { return state; },
      dispatch(spec) { specs.push(spec); state = state.update({ selection: spec.selection }).state; },
      dom: { closest: (sel) => (live && String(sel).includes("is-live-preview") ? {} : null) },
      specs,
    };
  };
  const text = cols.join("\n");
  let v = viewOver(text);
  ok("item 8: openVisualColumnAt opens a columns row", openVisualColumnAt({ settings: { columnLayout: true } }, v, 3, 1) === true && v.specs.length === 1);
  const eff = v.specs[0]?.effects?.value;
  ok("item 8: …on the asked column, spanning the whole row, caret at the header",
    eff && eff.column === 1 && eff.from === d.line(3).from && eff.to === d.line(8).to && v.specs[0].selection.anchor === d.line(3).from, JSON.stringify(eff));
  v = viewOver(text);
  ok("item 8: not on a paragraph", openVisualColumnAt({ settings: { columnLayout: true } }, v, 1, 0) === false && v.specs.length === 0);
  v = viewOver(text);
  ok("item 8: not with columns off", openVisualColumnAt({ settings: { columnLayout: false } }, v, 3, 0) === false && v.specs.length === 0);
  v = viewOver(text, false);
  ok("item 8: not in Source mode", openVisualColumnAt({ settings: { columnLayout: true } }, v, 3, 0) === false && v.specs.length === 0);
}

/* ---------- w1c: a column holding code opens; the closing ``` is never a typing position ---------- */
{
  const NOTE = ["# Cols", "", "Intro para.", "", "> [!nf-cols]", "> > [!nf-col]", "> > col text", "> >", "> > ```js", "> > let x = 1;", "> > ```", ">", "> > [!nf-col]", "> > other", "", "End."];
  const d = EditorState.create({ doc: NOTE.join("\n") }).doc;
  const span = (b) => (b ? [b.startLine, b.endLine] : null);
  ok("w1c: getBlockRange alone stops the row at its code (the bug)", JSON.stringify(span(getBlockRange(d, 5))) === "[5,8]");
  ok("w1c: columnsAwareBlockRange carries the row across the code", JSON.stringify(span(columnsAwareBlockRange(d, 5))) === "[5,14]");
  ok("w1c: …and leaves other blocks alone", JSON.stringify(span(columnsAwareBlockRange(d, 3))) === "[3,3]");
  const at = (n, ch = 0) => d.line(n).from + ch;
  // Entering from outside opens the column holding the landing row.
  let plan = columnsEntryPlan(d, at(3, 11), at(5));
  ok("w1c: an arrow from above into the row opens column 1 at its start",
    plan?.kind === "open" && plan.column === 0 && plan.cursor === 0 && plan.from === at(5) && plan.to === d.line(14).to, JSON.stringify(plan));
  plan = columnsEntryPlan(d, at(16), at(14, 2));
  ok("w1c: an arrow from below opens the last column at its end",
    plan?.kind === "open" && plan.column === 1 && plan.cursor === "other".length, JSON.stringify(plan));
  plan = columnsEntryPlan(d, at(3), at(10, 4));
  ok("w1c: a landing on the code row opens its column", plan?.kind === "open" && plan.column === 0, JSON.stringify(plan));
  // Inside raw source (the Source button): only the closer is redirected.
  ok("w1c: raw source: moving between ordinary rows is left alone", columnsEntryPlan(d, at(7, 2), at(10, 2)) === null);
  plan = columnsEntryPlan(d, at(10, 12), at(11, 0));
  // review3-main1-4: on to the next column's first row, not past the whole row.
  ok("w1c: raw source: ArrowDown onto the closer goes on to the next column's first row", plan?.kind === "past" && plan.pos === at(14, 4), JSON.stringify(plan));
  // (A closer ending the row: a mid-row closer goes on to the next column's first row, above.)
  const seamLast = EditorState.create({ doc: NOTE.slice(0, 13).concat(["> > ```py", "> > y", "> > ```", ""]).join("\n") }).doc;
  plan = columnsEntryPlan(seamLast, seamLast.line(15).to, seamLast.line(16).from);
  ok("w1c: raw source: with only a blank seam below, the column opens instead", plan?.kind === "open" && plan.column === 1, JSON.stringify(plan));
  plan = columnsEntryPlan(d, at(12, 1), at(11, 2));
  ok("w1c: raw source: ArrowUp onto the closer stops on the code's last row", plan?.kind === "past" && plan.pos === d.line(10).to, JSON.stringify(plan));
  const last = EditorState.create({ doc: NOTE.slice(0, 11).concat([">", "> > [!nf-col]", "> > ```", "> > y", "> > ```"]).join("\n") }).doc;
  plan = columnsEntryPlan(last, last.line(15).to, last.line(16).from);
  ok("w1c: raw source: a closer ending the note opens the column instead", plan?.kind === "open" && plan.column === 1, JSON.stringify(plan));
  ok("w1c: moves outside any columns row are left alone", columnsEntryPlan(d, at(1), at(3)) === null && columnsEntryPlan(d, at(3), at(16)) === null);
  const nested = EditorState.create({ doc: ["> [!note] Box", "> > [!nf-cols]", "> > > [!nf-col]", "> > > a", "> >", "> > > [!nf-col]", "> > > b"].join("\n") }).doc;
  ok("w1c: a columns row nested in a Callout is not taken over", columnsEntryPlan(nested, 0, nested.line(4).from) === null);
}

/* ---------- w1c: no caret rests in front of a code block's opener chip ---------- */
{
  const ALL_ON = { calloutEditing: true, codeBlockEditing: true, toggleBlocks: true, columnLayout: true };
  const text = "col text\n\n```js\nlet x = 1;\n```";
  const state = EditorState.create({ doc: text, selection: { anchor: 0 } });
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: { clientWidth: 700, style: { setProperty() {} } },
    dom: { closest: (selector) => (String(selector).includes("is-live-preview") ? {} : null) },
  };
  const Plugin = makeCalloutEditPlugin({ settings: ALL_ON, app: {} });
  const instance = Object.create(Plugin.prototype);
  instance.build.call(instance, view);
  const doc = state.doc;
  ok("w1c: the opener row is a skipped row", JSON.stringify(instance.skips) === JSON.stringify([
    { from: doc.line(3).from, to: doc.line(3).to, before: doc.line(2).to, after: doc.line(4).from },
  ]), JSON.stringify(instance.skips));
  const sel = (head, anchor = head) => EditorSelection.create([EditorSelection.range(anchor, head)]);
  let out = stepOverHiddenRows(sel(doc.line(2).from), sel(doc.line(3).from), instance.skips);
  ok("w1c: ArrowDown onto the opener goes on to the first code row", out?.main.head === doc.line(4).from, JSON.stringify(out?.main));
  out = stepOverHiddenRows(sel(doc.line(4).from + 3), sel(doc.line(3).to), instance.skips);
  ok("w1c: ArrowUp onto the opener goes back to the row above", out?.main.head === doc.line(2).to, JSON.stringify(out?.main));
  out = stepOverHiddenRows(sel(0), sel(doc.line(3).from, 0), instance.skips);
  ok("w1c: a Shift-extension keeps its anchor", out?.main.anchor === 0 && out?.main.head === doc.line(4).from);
  ok("w1c: heads off the opener are left alone", stepOverHiddenRows(sel(0), sel(doc.line(4).from), instance.skips) === null);
  const quoted = [{ from: 10, to: 17, before: 9, after: 20 }];
  ok("w1c: a quoted body row's hidden markers are stepped past", stepOverHiddenRows(sel(5), sel(10), quoted)?.main.head === 20);
}

/* ---------- review-MA-1: leaving a column selects the row and shows no competing caret ---------- */
{
  const f = (state) => state.field(blockCaretAwayField);
  let st = EditorState.create({ doc: "a\n\nb", extensions: [blockCaretAwayField] });
  ok("MA-1: the caret-away state starts off", f(st) === false);
  st = st.update({ effects: blockCaretAwayEffect.of(true), selection: { anchor: 1 } }).state;
  ok("MA-1: an explicit effect sets it, even with the selection it moves", f(st) === true);
  ok("MA-1: an effect-only transaction (a scroll) keeps it", f(st.update({ effects: [] }).state) === true);
  ok("MA-1: typing ends it", f(st.update({ changes: { from: 0, insert: "x" } }).state) === false);
  ok("MA-1: a caret move ends it", f(st.update({ selection: { anchor: 0 } }).state) === false);
  ok("MA-1: an explicit release ends it", f(st.update({ effects: blockCaretAwayEffect.of(false) }).state) === false);

  // closeVisualColumnEditor("after"), as Esc / Done run it.
  const ROW = ["Intro", "", "> [!nf-cols]", "> > [!nf-col]", "> > a", ">", "> > [!nf-col]", "> > b", "", "After"];
  const run = (selectionTakes) => {
    let state = EditorState.create({ doc: ROW.join("\n"), extensions: [blockCaretAwayField] });
    const doc0 = state.doc;
    const outer = { get state() { return state; }, dispatch(spec) { state = state.update(spec).state; }, focus() {} };
    const blocks = { selectedBlocks: [], setBlockSelection(b) { if (selectionTakes) this.selectedBlocks = b; } };
    const plugin = { settings: { dragHandles: true, blockSelectKey: true }, blockSelectionFor: () => blocks };
    const runtime = { outerView: outer, model: { from: doc0.line(3).from, to: doc0.line(8).to } };
    closeVisualColumnEditor(runtime, "after", plugin);
    return { state, blocks };
  };
  const { state, blocks } = run(true);
  const caretLine = state.doc.lineAt(state.selection.main.head);
  ok("MA-1: Esc/Done selects the whole row", JSON.stringify(blocks.selectedBlocks.map((b) => [b.startLine, b.endLine])) === "[[3,8]]", JSON.stringify(blocks.selectedBlocks));
  ok("MA-1: …with the caret on a prepared empty line below it", caretLine.number > 8 && caretLine.text === "", JSON.stringify(state.doc.toString()));
  ok("MA-1: …and that caret marked away, so it is not drawn and the hint stays off", f(state) === true);
  const failed = run(false);
  ok("MA-1: when no block selection takes, the caret is shown again", f(failed.state) === false);
}

/* ---------- review-MA-3: column routing does not depend on DOM focus ---------- */
{
  const fakeEl = (classes, parent = null) => ({
    classes, parent,
    closest(sel) {
      const wanted = sel.split(",").map((x) => x.trim().replace(/^\./, ""));
      for (let e = this; e; e = e.parent) if (e.classes.some((c) => wanted.includes(c))) return e;
      return null;
    },
    contains(other) { for (let e = other; e; e = e.parent) if (e === this) return true; return false; },
  });
  const body = fakeEl(["body"]);
  const outerDom = fakeEl(["cm-editor"], body);
  const host = fakeEl(["nf-column-editor-host"], outerDom);
  const childDom = fakeEl(["cm-editor"], host);
  const card = fakeEl(["nf-link-pop"], body);
  const input = fakeEl(["nf-link-pop-input"], card);
  const doc = { activeElement: null };
  outerDom.ownerDocument = doc;
  let columnOpen = true;
  const childView = { dom: childDom, id: "child" };
  const outer = {
    dom: outerDom,
    contentDOM: { querySelector: (sel) => (columnOpen && sel.includes("nf-column-editor-host") ? childDom : null) },
  };
  const find = (el) => (el === childDom ? childView : el === outerDom ? outer : null);
  doc.activeElement = input;
  ok("MA-3: focus in the link card is recognised", focusInPluginPopover(doc) === true);
  ok("MA-3: with focus in the card, the open column is still the editor to act on", nestedEditorFor(outer, {}, find) === childView);
  doc.activeElement = childDom;
  ok("MA-3: focus in the column child: that child", nestedEditorFor(outer, {}, find) === childView);
  doc.activeElement = outerDom;
  ok("MA-3: focus on the note with a column open: still the column", nestedEditorFor(outer, {}, find) === childView);
  columnOpen = false;
  ok("MA-3: no column open: the note itself (null)", nestedEditorFor(outer, {}, find) === null && openColumnEditorView(outer, find) === null);
  doc.activeElement = fakeEl(["other"], body);
  ok("MA-3: focus elsewhere is no card", focusInPluginPopover(doc) === false);

  // The wrapped Obsidian commands never fall through to the outer editor.
  const calls = [];
  const commands = {
    "editor:toggle-bold": { editorCallback: () => calls.push("bold") },
    "editor:toggle-italics": { editorCallback: () => calls.push("italic") },
    "editor:insert-link": { editorCallback: () => calls.push("link") },
  };
  const plugin = Object.create(NotionFlowPlugin.prototype);
  plugin.app = { commands: { commands } };
  plugin.settings = { floatingToolbar: true };
  plugin.register = () => {};
  const outerView = {
    dom: Object.assign(fakeEl(["cm-editor"], body), { ownerDocument: doc }),
    contentDOM: { querySelector: () => null },
    state: EditorState.create({ doc: "> [!nf-cols]" }),
  };
  plugin.editorView = () => outerView;
  plugin.routeEditorChords();
  doc.activeElement = input;
  commands["editor:toggle-bold"].editorCallback({}, {});
  commands["editor:toggle-italics"].editorCallback({}, {});
  commands["editor:insert-link"].editorCallback({}, {});
  ok("MA-3: ⌘B/⌘I/⌘K typed in the link card never reach Obsidian's command on the note", calls.length === 0, JSON.stringify(calls));
  doc.activeElement = fakeEl(["toolbar-button"], body);
  const colEl = fakeEl(["cm-editor"], fakeEl(["nf-column-editor-host"], outerView.dom));
  let childState = EditorState.create({ doc: "word here", selection: { anchor: 0, head: 4 } });
  colEl.__nfView = {
    dom: colEl, composing: false,
    get state() { return childState; },
    dispatch(spec) { childState = childState.update(spec).state; },
  };
  outerView.contentDOM = { querySelector: (sel) => (sel.includes("nf-column-editor-host") ? colEl : null) };
  commands["editor:toggle-bold"].editorCallback({}, {});
  ok("MA-3: with a column open and focus on the toolbar, bold never writes before `> [!nf-cols]`", calls.length === 0 && outerView.state.doc.toString() === "> [!nf-cols]", JSON.stringify(calls));
  ok("MA-3: …it bolds the column's own selection instead", childState.doc.toString() === "**word** here", childState.doc.toString());
  colEl.__nfView = null;
  commands["editor:toggle-italics"].editorCallback({}, {});
  ok("MA-3: backstop: with the column's editor unreachable, the note is still never written", calls.length === 0, JSON.stringify(calls));
  outerView.contentDOM = { querySelector: () => null };
  commands["editor:toggle-bold"].editorCallback({}, {});
  ok("MA-3: with no column and no card, Obsidian's own bold still runs", JSON.stringify(calls) === '["bold"]', JSON.stringify(calls));
}

/* ---------- item 10: a click on a column divider writes nothing ---------- */
{
  ok("item 10: a 1 px press is a click, not a resize", columnResizeCommits(100, 101) === false);
  ok("item 10: no movement is a click", columnResizeCommits(100, 100) === false);
  ok("item 10: 3 px to the right commits", columnResizeCommits(100, 103) === true);
  ok("item 10: 3 px to the left commits", columnResizeCommits(100, 97) === true);
}

/* ---------- item 11: folding code never moves a caret that is outside ---------- */
{
  const fakeView = (text, anchor) => {
    let state = EditorState.create({ doc: text, selection: { anchor } });
    return { get state() { return state; }, dispatch(spec) { state = state.update(spec).state; }, focus() {} };
  };
  const NOTE = "# Code test\n\n```js\nconst a = 1;\n```\n\nAfter.";
  const v = fakeView(NOTE, 3);
  codeFoldClick(v, 3, "", true);
  const folded = v.state.doc.toString();
  ok("item 11: folding writes the collapsed caption row", folded !== NOTE && folded.split("\n").length === NOTE.split("\n").length + 1, JSON.stringify(folded));
  ok("item 11: a caret outside the block stays put when it folds", v.state.selection.main.head === 3, String(v.state.selection.main.head));
  codeFoldClick(v, 3, "", false);
  ok("item 11: unfolding restores the note", v.state.doc.toString() === NOTE, JSON.stringify(v.state.doc.toString()));
  ok("item 11: …and leaves the caret where it was", v.state.selection.main.head === 3, String(v.state.selection.main.head));
  const inside = fakeView(NOTE, NOTE.indexOf("const") + 2);
  codeFoldClick(inside, 3, "", true);
  const doc = inside.state.doc;
  const headLine = doc.lineAt(inside.state.selection.main.head).number;
  ok("item 11: a caret inside the folded block moves out below it", headLine > 6 && !/const|```/.test(doc.line(headLine).text),
    JSON.stringify([headLine, doc.toString()]));
  const LAST = "# Code test\n\n```js\nx\n```";
  const last = fakeView(LAST, 3);
  codeFoldClick(last, 3, "", true);
  ok("item 11: folding the last block with the caret outside appends no line",
    last.state.doc.lines === LAST.split("\n").length + 1 && last.state.selection.main.head === 3,
    JSON.stringify(last.state.doc.toString()));
}

/* ---------- item 12: Reading view binds captions across the section seam ---------- */
{
  /** A minimal element: tag, classes, children, and the three selector
   * shapes captionOwnerIn asks (":scope > a > b", "a b", "a"). */
  class El {
    constructor(tag, cls = [], parent = null) {
      this.tagName = tag.toUpperCase(); this.cls = new Set(cls); this.children = []; this.parentElement = null;
      if (parent) { this.parentElement = parent; parent.children.push(this); }
    }
    get previousElementSibling() { const s = this.parentElement?.children ?? []; const i = s.indexOf(this); return i > 0 ? s[i - 1] : null; }
    is(simple) {
      const m = simple.trim().match(/^([a-z]*)((?:\.[\w-]+)*)$/i);
      if (!m) return false;
      if (m[1] && m[1].toUpperCase() !== this.tagName) return false;
      return m[2].split(".").filter(Boolean).every((c) => this.cls.has(c));
    }
    *descendants() { for (const c of this.children) { yield c; yield* c.descendants(); } }
    matchesPart(part, root) {
      part = part.trim();
      if (part.startsWith(":scope")) {
        const steps = part.slice(6).split(">").map((x) => x.trim()).filter(Boolean);
        let el = this;
        for (let i = steps.length - 1; i >= 0; i--) { if (!el || !el.is(steps[i])) return false; el = el.parentElement; }
        return el === root;
      }
      const tokens = part.split(/\s+/);
      if (!this.is(tokens[tokens.length - 1])) return false;
      let el = this.parentElement, need = tokens.length - 2;
      while (need >= 0 && el && el !== root) { if (el.is(tokens[need])) need--; el = el.parentElement; }
      return need < 0;
    }
    querySelector(sel) {
      const parts = sel.split(",");
      for (const d of this.descendants()) if (parts.some((p) => d.matchesPart(p, this))) return d;
      return null;
    }
  }
  // Reading view: a table section, then the caption's own section.
  const root = new El("div", ["markdown-preview-section"]);
  const tableSec = new El("div", ["el-table"], root);
  const scroll = new El("div", ["nf-table-scroll"], tableSec);
  const table = new El("table", [], scroll);
  const capSec = new El("div", ["el-p"], root);
  const capP = new El("p", [], capSec);
  new El("small", ["nf-caption"], capP);
  ok("item 12: a caption opening its section sees no owner on its own", captionOwnerIn(capP, "table") === null);
  ok("item 12: …and finds the table (inside the scroll wrapper) across the seam", captionOwnerIn(capP, "table", capSec) === table);
  const bareSec = new El("div", ["el-table"], root);
  const bareTable = new El("table", [], bareSec);
  const cap2 = new El("div", ["el-p"], root);
  const cap2P = new El("p", [], cap2);
  ok("item 12: …or the bare table before our wrapper runs", captionOwnerIn(cap2P, "table", cap2) === bareTable);
  const preSec = new El("div", ["el-pre"], root);
  const pre = new El("pre", [], preSec);
  const cap3 = new El("div", ["el-p"], root);
  const cap3P = new El("p", [], cap3);
  ok("item 12: a code caption finds the pre across the seam", captionOwnerIn(cap3P, "code", cap3) === pre);
  ok("item 12: a table caption does not take a pre", captionOwnerIn(cap3P, "table", cap3) === null);
  const paraSec = new El("div", ["el-p"], root);
  new El("p", [], paraSec);
  const cap4 = new El("div", ["el-p"], root);
  const cap4P = new El("p", [], cap4);
  ok("item 12: a paragraph above is no owner", captionOwnerIn(cap4P, "code", cap4) === null);
  // Inside one container (a Callout, or Live Preview): the element before.
  const content = new El("div", ["callout-content"]);
  const cpre = new El("pre", [], content);
  const cP = new El("p", [], content);
  ok("item 12: inside a Callout the pre right before is the owner", captionOwnerIn(cP, "code") === cpre);
  const wrapped = new El("div", ["callout-content"]);
  const tw = new El("div", ["table-wrapper"], wrapped);
  const wt = new El("table", [], tw);
  const wP = new El("p", [], wrapped);
  ok("item 12: …and a table inside a theme's wrapper", captionOwnerIn(wP, "table") === wt);
  const mixed = new El("div", ["callout-content"]);
  new El("p", [], mixed);
  const mP = new El("p", [], mixed);
  ok("item 12: a caption with a non-owner right before it never looks further", captionOwnerIn(mP, "code", mixed) === null);
  // An image shares the caption's paragraph.
  const imgP = new El("p");
  const embed = new El("span", ["internal-embed", "image-embed"], imgP);
  const img = new El("img", [], embed);
  new El("small", ["nf-caption"], imgP);
  ok("item 12: an image caption finds the image in its own paragraph", captionOwnerIn(imgP, "image") === img);
  const loading = new El("p");
  new El("span", ["internal-embed", "image-embed"], loading);
  ok("item 12: an embed still loading has no image yet", captionOwnerIn(loading, "image") === null);
}

/* ---------- w1c: Tab on a caption row does nothing ---------- */
{
  const cap = buildBlockCaption("code", "Listing");
  const doc = ["```js", "x", "```", cap, "", "- item"].join("\n");
  const on = (lineNo, ch = 30) => {
    const state = EditorState.create({ doc });
    const line = state.doc.line(lineNo);
    return EditorState.create({ doc, selection: { anchor: line.from + Math.min(ch, line.length) } });
  };
  ok("w1c: an owned caption row is guarded", ownedBlockCaption(on(4).doc, 4) && tabOnCaptionRows(on(4)));
  ok("w1c: a list item is not", !tabOnCaptionRows(on(6, 3)));
  ok("w1c: a code row is not", !tabOnCaptionRows(on(2, 1)));
  const multi = EditorState.create({
    doc, extensions: [EditorState.allowMultipleSelections.of(true)],
    selection: EditorSelection.create([EditorSelection.cursor(doc.indexOf("Listing")), EditorSelection.cursor(doc.length - 2)]),
  });
  ok("w1c: a second caret on another row lets Tab through", !tabOnCaptionRows(multi));
  const orphan = ["para", "", cap].join("\n");
  ok("w1c: an orphan caption row (not owned) is ordinary text",
    !tabOnCaptionRows(EditorState.create({ doc: orphan, selection: { anchor: orphan.length - 10 } })));
}

/* ---------- item 13: a click on an empty toggle's hint opens a body row ---------- */
{
  const run = (lines, headerLine) => {
    const doc = EditorState.create({ doc: lines.join("\n") }).doc;
    const plan = emptyToggleBodyPlan(doc, headerLine);
    if (!plan) return null;
    const state = EditorState.create({ doc: lines.join("\n") }).update({ changes: plan.changes, selection: { anchor: plan.anchor } }).state;
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    return { rows: state.doc.toString().split("\n"), caret: [line.number, head - line.from], changes: plan.changes.length };
  };
  const plus = run(["> [!nf-toggle]+ Plus title only", "", "after"], 1);
  ok("item 13: title only → a body row, caret on it", JSON.stringify(plus.rows) === JSON.stringify(["> [!nf-toggle]+ Plus title only", "> ", "", "after"]) && plus.caret.join() === "2,2", JSON.stringify(plus));
  const typed = plus.rows.slice(); typed[1] += "X";
  ok("item 13: …typing X gives \"> X\"", typed[1] === "> X");
  const empty = run(["> [!nf-toggle]+ Plus empty", "> ", "", "after"], 1);
  ok("item 13: an existing body row is used, nothing added", empty.changes === 0 && empty.rows.length === 4 && empty.caret.join() === "2,2", JSON.stringify(empty));
  const bareRow = run(["> [!nf-toggle]+ T", ">", "after"], 1);
  ok("item 13: a bare \">\" body row becomes \"> \"", bareRow.rows[1] === "> " && bareRow.caret.join() === "2,2", JSON.stringify(bareRow));
  const foldless = run(["> [!nf-toggle] Empty toggle", "", "after"], 1);
  ok("item 13: a fold-less toggle is opened with + and gets a body row",
    JSON.stringify(foldless.rows.slice(0, 2)) === JSON.stringify(["> [!nf-toggle]+ Empty toggle", "> "]) && foldless.caret.join() === "2,2", JSON.stringify(foldless));
  const closed = run(["> [!nf-toggle]- Closed", "", "x"], 1);
  ok("item 13: a closed toggle opens too", closed.rows[0] === "> [!nf-toggle]+ Closed" && closed.rows[1] === "> ", JSON.stringify(closed));
  const nested = run(["> [!note] Outer", "> > [!nf-toggle]+ T", "> more"], 2);
  ok("item 13: a toggle inside a Callout gets a \"> > \" body row, before the Callout's own row",
    JSON.stringify(nested.rows) === JSON.stringify(["> [!note] Outer", "> > [!nf-toggle]+ T", "> > ", "> more"]) && nested.caret.join() === "3,4", JSON.stringify(nested));
  const last = run(["para", "", "> [!nf-toggle]+ Last"], 3);
  ok("item 13: at the end of the note the row is appended", last.rows[3] === "> " && last.caret.join() === "4,2", JSON.stringify(last));
  const withBody = run(["> [!nf-toggle]+ T", "> child"], 1);
  ok("item 13: with a body already there the caret goes to its end", withBody.changes === 0 && withBody.caret.join() === "2,7", JSON.stringify(withBody));
  const indented = run(["- item", "  > [!nf-toggle] In list", "- next"], 2);
  ok("item 13: a toggle in a list item keeps its indentation on the body row",
    indented.rows[1] === "  > [!nf-toggle]+ In list" && indented.rows[2] === "  > " && indented.caret.join() === "3,4", JSON.stringify(indented));
  ok("item 13: the title text is never touched", [plus, empty, foldless, closed, nested].every((r) => /(Plus title only|Plus empty|Empty toggle|Closed| T)$/.test(r.rows.find((x) => x.includes("[!nf-toggle]")))));
  ok("item 13: not a toggle → null", emptyToggleBodyPlan(EditorState.create({ doc: "> [!note] N" }).doc, 1) === null);
}

/* ---------- item 14: + on a list item adds a sibling; bare markers give way ---------- */
{
  const docOf = (lines) => EditorState.create({ doc: lines.join("\n") }).doc;
  const sib = (lines, lineNo) => {
    const doc = docOf(lines);
    const block = innerBlockAt(doc, lineNo);
    const plan = listSiblingInsert(doc, block);
    return plan && { text: doc.sliceString(0, plan.from) + plan.insert + doc.sliceString(plan.from), caret: plan.caret, plan };
  };
  let r = sib(["- item one", "- item two"], 1);
  ok("item 14: bullet → \"- \" sibling right after, no blank row", r.text === "- item one\n- \n- item two" && r.caret === "- item one\n- ".length, JSON.stringify(r));
  r = sib(["* a", "* b"], 1);
  ok("item 14: the item's own bullet character", r.text === "* a\n* \n* b", JSON.stringify(r?.text));
  r = sib(["3) three", "4) four"], 1);
  ok("item 14: ordered \"3)\" → \"4) \"", r.text === "3) three\n4) \n4) four", JSON.stringify(r?.text));
  r = sib(["1. one", "2. two"], 1);
  ok("item 14: ordered \"1.\" → \"2. \"", r.text === "1. one\n2. \n2. two", JSON.stringify(r?.text));
  r = sib(["- [x] done", "- [ ] b"], 1);
  ok("item 14: a to-do gets an empty box", r.text === "- [x] done\n- [ ] \n- [ ] b", JSON.stringify(r?.text));
  r = sib(["- parent", "  - child", "- next"], 2);
  ok("item 14: a nested item's sibling keeps its indentation", r.text === "- parent\n  - child\n  - \n- next", JSON.stringify(r?.text));
  r = sib(["> [!note] N", "> - a", "> - b"], 2);
  ok("item 14: inside a Callout the sibling keeps the markers", r.text === "> [!note] N\n> - a\n> - \n> - b", JSON.stringify(r?.text));
  r = sib(["- item", "  continued", "- next"], 1);
  ok("item 14: after the item's last row", r.text === "- item\n  continued\n- \n- next", JSON.stringify(r?.text));
  ok("item 14: a paragraph has no sibling item", sib(["para"], 1) === null);
  ok("item 14: a Callout is not a list item", sib(["> [!note] N", "> body"], 1) === null);
  // insertBlockBelow on a list item uses it (no slash here).
  const fakeView = (text) => {
    let state = EditorState.create({ doc: text });
    return { get state() { return state; }, dispatch(spec) { state = state.update(spec).state; }, focus() {}, dom: { ownerDocument: { defaultView: { setTimeout() {} } } } };
  };
  const v = fakeView("- item one\n- item two");
  insertBlockBelow(v, innerBlockAt(v.state.doc, 1), false);
  ok("item 14: + on \"- item one\" (no slash) gives a sibling row", v.state.doc.toString() === "- item one\n- \n- item two" && v.state.selection.main.head === 13, JSON.stringify(v.state.doc.toString()));

  ok("item 14: bareListMarkerRow \"- \"", JSON.stringify(bareListMarkerRow("- ")) === JSON.stringify({ indent: "", containerPrefix: "" }));
  ok("item 14: bareListMarkerRow \"  1. \"", bareListMarkerRow("  1. ")?.indent === "  ");
  ok("item 14: bareListMarkerRow \"- [ ] \"", !!bareListMarkerRow("- [ ] "));
  ok("item 14: bareListMarkerRow \"> - \"", bareListMarkerRow("> - ")?.containerPrefix === "> ");
  ok("item 14: bareListMarkerRow rejects text", bareListMarkerRow("- a") === null && bareListMarkerRow("para") === null && bareListMarkerRow("") === null && bareListMarkerRow("> text") === null);

  class Ed {
    constructor(lines) { this.lines = lines; this.cursor = null; }
    getLine(n) { return this.lines[n]; }
    lineCount() { return this.lines.length; }
    setLine(n, text) { this.lines[n] = text; }
    setCursor(pos) { this.cursor = pos; }
    getCursor() { return this.cursor; }
    replaceRange(text, from, to) {
      const head = this.lines[from.line].slice(0, from.ch);
      const tail = this.lines[to.line].slice(to.ch);
      this.lines.splice(from.line, to.line - from.line + 1, ...(head + text + tail).split("\n"));
    }
  }
  const pick = (lines, lineNo, id) => {
    const suggest = new SlashSuggest({ app: {}, settings: { slashCommands: true } });
    suggest.plugin = { settings: { ...DEFAULT_SETTINGS, slashCommands: true, slashRecent: [] }, saveSettings() {}, persistSettings() {} };
    const editor = new Ed([...lines]);
    const end = { line: lineNo, ch: lines[lineNo].length };
    editor.cursor = end;
    suggest.context = { editor, start: { line: lineNo, ch: lines[lineNo].indexOf("/") }, end, query: lines[lineNo].slice(lines[lineNo].indexOf("/") + 1) };
    suggest.selectSuggestion(SLASH_COMMANDS.find((c) => c.id === id), {});
    return { text: editor.lines.join("\n"), cursor: editor.cursor };
  };
  let p = pick(["- item one", "- /", "- item two"], 1, "text");
  ok("item 14: bare \"- /\" + Text → its own paragraph between blank rows", p.text === "- item one\n\n\n\n- item two" && p.cursor.line === 2 && p.cursor.ch === 0, JSON.stringify(p));
  const hello = p.text.split("\n"); hello[2] = "hello";
  ok("item 14: …so \"hello\" is not glued to item one", hello.join("\n") === "- item one\n\nhello\n\n- item two");
  p = pick(["- item one", "- /", "- item two"], 1, "callout");
  ok("item 14: bare \"- /\" + Callout → a top-level Callout between blank rows",
    p.text === "- item one\n\n> [!note] \n> \n\n- item two" && p.cursor.line === 2 && p.cursor.ch === "> [!note] ".length, JSON.stringify(p));
  p = pick(["- item one", "- /", "- item two"], 1, "bullet");
  ok("item 14: bare \"- /\" + Bulleted list keeps today's behaviour", p.text === "- item one\n- \n- item two", JSON.stringify(p.text));
  p = pick(["- item one", "- /", "- item two"], 1, "h2");
  ok("item 14: bare \"- /\" + Heading 2 → a heading row between blank rows", p.text === "- item one\n\n## \n\n- item two", JSON.stringify(p.text));
  p = pick(["- item one", "- /"], 1, "code");
  ok("item 14: bare \"- /\" at the end + Code → no trailing seam", p.text === "- item one\n\n```\n\n```", JSON.stringify(p.text));
  p = pick(["> [!note] N", "> - a", "> - /", "> - b"], 2, "callout");
  ok("item 14: bare \"> - /\" in a Callout + Callout → a nested Callout between marker rows",
    p.text === "> [!note] N\n> - a\n>\n> > [!note] \n> > \n>\n> - b", JSON.stringify(p.text));
  p = pick(["- item /", "- two"], 0, "callout");
  ok("item 14: a list item WITH text still nests the block under it (unchanged)", p.text === "- item \n  > [!note] \n  > \n\n- two", JSON.stringify(p.text));
  // The static serializer on its own, as the column editor calls it.
  const ed = new Ed(["- item one", "- /", "- item two"]);
  SlashSuggest.insertSnippetInto(ed, { line: 1, ch: 2 }, { line: 1, ch: 3 }, SLASH_COMMANDS.find((c) => c.id === "callout"), undefined, DEFAULT_SETTINGS);
  ok("item 14: insertSnippetInto from a bare marker row (column editor path)", ed.lines.join("\n") === "- item one\n\n> [!note] \n> \n\n- item two", JSON.stringify(ed.lines));
}

/* ---------- w1c: insert above leaves the seam its text will need ---------- */
{
  const docOf = (text) => EditorState.create({ doc: text }).doc;
  const above = (text, lineNo, typed = "new") => {
    const doc = docOf(text);
    const block = innerBlockAt(doc, lineNo);
    const plan = blockInsertAbovePlan(doc, block);
    const out = doc.sliceString(0, plan.caret) + typed + doc.sliceString(plan.caret, plan.from) + plan.insert.slice(plan.caret - plan.from) + doc.sliceString(plan.from);
    return out;
  };
  ok("w1c: above \"para one\" → para zero, new, para one as three paragraphs",
    above("para zero\n\npara one", 3) === "para zero\n\nnew\n\npara one", JSON.stringify(above("para zero\n\npara one", 3)));
  ok("w1c: above the note's first line", above("para one", 1) === "new\n\npara one", JSON.stringify(above("para one", 1)));
  ok("w1c: inside a Callout the seam is a marker row",
    above("> [!note] T\n> para one", 2) === "> [!note] T\n> new\n>\n> para one", JSON.stringify(above("> [!note] T\n> para one", 2)));
  ok("w1c: blockInsertAbovePlan: above a list item no seam: typing \"- c\" makes an item",
    above("- a\n- b", 2, "- c") === "- a\n- c\n- b", JSON.stringify(above("- a\n- b", 2, "- c")));
  // review3-main2-6: insertBlockAbove on a list item adds the item before it (listSiblingAboveInsert).
  {
    const ins = (text, lineNo) => {
      let state = EditorState.create({ doc: text });
      const view = { get state() { return state; }, dispatch(spec) { state = state.update(spec).state; }, focus() {}, dom: { ownerDocument: { defaultView: { setTimeout() {} } } } };
      insertBlockAbove(view, innerBlockAt(state.doc, lineNo), false);
      const head = state.selection.main.head;
      const doc = state.doc.toString();
      return doc.slice(0, head) + "‸" + doc.slice(head);
    };
    ok("main2-6: + above '- b' gives '- a\\n- ‸\\n- b'", ins("- a\n- b", 2) === "- a\n- ‸\n- b", JSON.stringify(ins("- a\n- b", 2)));
    ok("main2-6: a nested item keeps its indent", ins("- a\n  - b", 2) === "- a\n  - ‸\n  - b", JSON.stringify(ins("- a\n  - b", 2)));
    ok("main2-6: an ordered '3)' item repeats its own number", ins("2) a\n3) b", 2) === "2) a\n3) ‸\n3) b", JSON.stringify(ins("2) a\n3) b", 2)));
    ok("main2-6: a task gets an empty box", ins("- [x] a\n- [x] b", 2) === "- [x] a\n- [ ] ‸\n- [x] b", JSON.stringify(ins("- [x] a\n- [x] b", 2)));
    ok("main2-6: an item inside a Callout keeps the markers", ins("> [!note] T\n> - a\n> - b", 3) === "> [!note] T\n> - a\n> - ‸\n> - b", JSON.stringify(ins("> [!note] T\n> - a\n> - b", 3)));
    ok("main2-6: a paragraph keeps the seam path", ins("para zero\n\npara one", 3) === "para zero\n\n‸\n\npara one", JSON.stringify(ins("para zero\n\npara one", 3)));
    ok("main2-6: the first item of a list", ins("- a\n- b", 1) === "- ‸\n- a\n- b", JSON.stringify(ins("- a\n- b", 1)));
  }
  const v = (() => { let state = EditorState.create({ doc: "para zero\n\npara one" }); return { get state() { return state; }, dispatch(spec) { this.n = (this.n ?? 0) + 1; state = state.update(spec).state; }, focus() {}, dom: { ownerDocument: { defaultView: { setTimeout() {} } } } }; })();
  insertBlockAbove(v, innerBlockAt(v.state.doc, 3), false);
  ok("w1c: insertBlockAbove is one transaction (one undo step)", v.n === 1 && v.state.doc.toString() === "para zero\n\n\n\npara one" && v.state.doc.lineAt(v.state.selection.main.head).number === 3, JSON.stringify([v.n, v.state.doc.toString()]));
}

/* ---------- review-MB-1: no Ctrl+Alt+character default off macOS ---------- */
{
  const off = pluginDefaultHotkeys(false);
  const ids = off.map((e) => e.id);
  ok("MB-1: off macOS the insert commands have no default", !ids.includes("insert-block-below") && !ids.includes("insert-block-above"), JSON.stringify(ids));
  const altGr = off.filter(({ hotkey }) => {
    const mods = hotkey.modifiers.map((m) => (m === "Mod" ? "Ctrl" : m));
    return mods.includes("Ctrl") && mods.includes("Alt") && String(hotkey.key).length === 1;
  });
  ok("MB-1: no default off macOS pairs Ctrl+Alt (AltGr) with a character key", altGr.length === 0, JSON.stringify(altGr));
  const mac = new Map(pluginDefaultHotkeys(true).map((e) => [e.id, e.hotkey]));
  ok("MB-1: macOS keeps ⌘⌥= and ⌘⌥⇧=",
    JSON.stringify(mac.get("insert-block-below")) === JSON.stringify({ modifiers: ["Mod", "Alt"], key: "=" }) &&
    JSON.stringify(mac.get("insert-block-above")) === JSON.stringify({ modifiers: ["Mod", "Alt", "Shift"], key: "=" }));
  ok("MB-1: the table is the one the defaults come from", blockActionChords(false)["insert-block-below"] === null && blockActionChords(true)["move-block-up"].key === "ArrowUp");
}

/* ---------- review-MB-3: ⌘⇧Enter out of code in a list keeps the list tight ---------- */
{
  const run = (lines, lineNo, ch, typed = "new") => {
    const doc = EditorState.create({ doc: lines.join("\n") }).doc;
    const plan = fenceExitPlan(doc, doc.line(lineNo).from + ch);
    const text = doc.sliceString(0, plan.from) + plan.insert + doc.sliceString(plan.to);
    return text.slice(0, plan.cursor) + typed + text.slice(plan.cursor);
  };
  ok("MB-3: code in a list item, sibling item below → no blank row (tight list)",
    run(["- item", "  ```js", "  x", "  ```", "- next"], 3, 3) === "- item\n  ```js\n  x\n  ```\n  new\n- next", JSON.stringify(run(["- item", "  ```js", "  x", "  ```", "- next"], 3, 3)));
  ok("MB-3: …to-dos and numbers too",
    run(["1. item", "   ```js", "   x", "   ```", "2. next"], 3, 3) === "1. item\n   ```js\n   x\n   ```\n   new\n2. next");
  ok("MB-3: a top-level list after top-level code needs no seam",
    run(["```js", "x", "```", "- item"], 2, 1) === "```js\nx\n```\nnew\n- item");
  ok("MB-3: a paragraph below still gets the seam",
    run(["```js", "x", "```", "after"], 2, 1) === "```js\nx\n```\nnew\n\nafter");
  ok("MB-3: an indented paragraph in the same item still gets the seam",
    run(["- item", "  ```js", "  x", "  ```", "  more text"], 3, 3) === "- item\n  ```js\n  x\n  ```\n  new\n\n  more text");
  ok("MB-3: \"2.\" cannot interrupt a paragraph at the same column: seam kept",
    run(["```js", "x", "```", "2. two"], 2, 1) === "```js\nx\n```\nnew\n\n2. two");
  ok("MB-3: inside a quote, a list item below needs no marker seam",
    run(["> - item", ">   ```js", ">   x", ">   ```", "> - next"], 3, 5) === "> - item\n>   ```js\n>   x\n>   ```\n>   new\n> - next",
    JSON.stringify(run(["> - item", ">   ```js", ">   x", ">   ```", "> - next"], 3, 5)));
}

/* ---------- review-MB-4: a table pasted under a title-only Callout stays a table ---------- */
{
  const md = "| a | b |\n| --- | --- |\n| c | d |";
  const land = (lines, n) => {
    const text = lines[n];
    const r = tablePasteLanding(text, n + 1 < lines.length ? lines[n + 1] : null, md, { previous: n > 0 ? lines[n - 1] : null, following: n + 2 < lines.length ? lines[n + 2] : null });
    const prefix = (text.match(/^(?:[ \t]*>)+[ \t]?/) ?? [""])[0];
    const out = [...lines.slice(0, n), prefix + r.insert, ...lines.slice(n + 1)].join("\n");
    return out;
  };
  const top = land(["> [!info] Title only", "", "Next paragraph."], 1);
  ok("MB-4: the top-level blank under a title-only Callout gets a seam", top.startsWith("> [!info] Title only\n\n| a | b |"), JSON.stringify(top));
  const inside = land(["> [!info] Title only", "> ", "> body"], 1);
  ok("MB-4: a \"> \" row inside that Callout takes the table right under the title", inside.startsWith("> [!info] Title only\n> | a | b |"), JSON.stringify(inside));
  const nested = land(["> > [!note] Inner", "> ", "> after"], 1);
  ok("MB-4: a \"> \" row under a deeper Callout's title is outside it: seam", nested.startsWith("> > [!note] Inner\n> \n> | a | b |"), JSON.stringify(nested));
  const para = land(["Para", "", "x"], 1);
  ok("MB-4: under a paragraph, unchanged", para.startsWith("Para\n\n| a | b |"), JSON.stringify(para));
}

/* ---------- item 15: the block menu opens beside the handle ---------- */
{
  const handle = { left: 300, top: 200 };
  const anchor = blockMenuAnchor(handle);
  ok("item 15: the anchor sits 6 px left of the handle, at its top, opening leftwards",
    anchor.x === 294 && anchor.y === 200 && anchor.left === true, JSON.stringify(anchor));
  // Obsidian 1.13's Menu.showAtPosition, from app.js: with no width the
  // menu opens at x+2 or ends at x-2; `left` prefers the left side when
  // it fits; top = y + 2.
  const place = (pos, w, winWidth) => {
    const right = pos.x + 2, leftEnd = pos.x - 2;
    const fitsLeft = leftEnd - w >= 0;
    const left = !(right + w <= winWidth) || (pos.left && fitsLeft) ? Math.max(0, leftEnd - w) : right;
    return { left, right: left + w, top: pos.y + 2 };
  };
  const menu = place(anchor, 240, 1280);
  ok("item 15: with room, the menu ends left of the handle and covers none of the block",
    menu.right <= handle.left && Math.abs(menu.top - handle.top) <= 4, JSON.stringify(menu));
  const narrow = place(blockMenuAnchor({ left: 120, top: 200 }), 240, 1280);
  ok("item 15: without room on the left, Obsidian falls back to opening rightwards",
    narrow.left === 116, JSON.stringify(narrow));
}

/* ---------- item 16: one merged selection ring ---------- */
{
  const r = (top, bottom) => ({ top, bottom });
  ok("item 16: abutting marks (gap 2) merge",
    JSON.stringify(mergeSelectionRects([r(0, 20), r(22, 40)], [false])) === JSON.stringify([r(0, 40)]));
  ok("item 16: a 27 px seam of blank rows merges",
    JSON.stringify(mergeSelectionRects([r(0, 20), r(47, 70)], [true])) === JSON.stringify([r(0, 70)]));
  ok("item 16: a 27 px gap that is not blank rows stays split",
    JSON.stringify(mergeSelectionRects([r(0, 20), r(47, 70)], [false])) === JSON.stringify([r(0, 20), r(47, 70)]));
  ok("item 16: a single mark is unchanged",
    JSON.stringify(mergeSelectionRects([r(5, 25)], [])) === JSON.stringify([r(5, 25)]));
  ok("item 16: three paragraphs and two seams make one mark",
    JSON.stringify(mergeSelectionRects([r(0, 20), r(47, 67), r(94, 114)], [true, true])) === JSON.stringify([r(0, 114)]));
  ok("item 16: only the contiguous run merges",
    JSON.stringify(mergeSelectionRects([r(0, 20), r(22, 40), r(90, 110)], [false, false])) ===
      JSON.stringify([r(0, 40), r(90, 110)]));
  const input = [r(0, 20), r(22, 40)];
  mergeSelectionRects(input, [false]);
  ok("item 16: the input rects are not mutated", input[0].bottom === 20);
}

/* ---------- item 17 + w1c-table-toolbar-horizontal: table toolbar placement ---------- */
{
  const fallback = { top: 300, placement: "above" };
  const above = tableToolbarTop({ tableTop: 200, tableBottom: 400, height: 40, paneTop: 100, paneBottom: 800, fallback });
  ok("item 17: room above the table: the bar sits 8 px above it",
    above.top === 152 && above.placement === "above" && above.atTable && above.top + 40 <= 200 - 6, JSON.stringify(above));
  const below = tableToolbarTop({ tableTop: 120, tableBottom: 400, height: 40, paneTop: 100, paneBottom: 800, fallback });
  ok("item 17: no room above: the bar sits 8 px below the table",
    below.top === 408 && below.placement === "below" && below.atTable, JSON.stringify(below));
  const tall = tableToolbarTop({ tableTop: -500, tableBottom: 1500, height: 40, paneTop: 100, paneBottom: 800, fallback });
  ok("item 17: a table taller than the pane keeps the caret placement",
    tall.top === 300 && tall.placement === "above" && !tall.atTable, JSON.stringify(tall));
  const scrolled = tableToolbarTop({ tableTop: 40, tableBottom: 500, height: 40, paneTop: 100, paneBottom: 800, fallback });
  ok("item 17: a table whose top is scrolled away goes below it, not over its rows",
    scrolled.top === 508 && scrolled.placement === "below", JSON.stringify(scrolled));
  ok("item 17: exactly enough room above counts",
    tableToolbarTop({ tableTop: 148, tableBottom: 300, height: 40, paneTop: 100, paneBottom: 800, fallback }).placement === "above");

  ok("w1c: the table bar aligns with the table's left edge",
    tableToolbarLeft({ tableLeft: 420, width: 300, paneLeft: 200, paneRight: 1200 }) === 420);
  ok("w1c: a table flush with the pane edge keeps the bar 8 px inside",
    tableToolbarLeft({ tableLeft: 200, width: 300, paneLeft: 200, paneRight: 1200 }) === 208);
  ok("w1c: a bar that would run past the right edge is pulled in",
    tableToolbarLeft({ tableLeft: 1000, width: 300, paneLeft: 200, paneRight: 1200 }) === 892);
  ok("w1c: a pane narrower than the bar pins it to the left inset",
    tableToolbarLeft({ tableLeft: 250, width: 500, paneLeft: 200, paneRight: 500 }) === 208);

  const pane = toolbarPaneRect({ left: 280, right: 1400, top: 80, bottom: 900 }, 1280, 860);
  ok("item 17: the pane is the note area clipped to the window",
    JSON.stringify(pane) === JSON.stringify({ left: 280, right: 1280, top: 80, bottom: 860 }), JSON.stringify(pane));
  ok("item 17: no note area: the window",
    JSON.stringify(toolbarPaneRect(null, 1280, 860)) === JSON.stringify({ left: 0, right: 1280, top: 0, bottom: 860 }));

  // Icon ids that exist in Obsidian 1.13.7's Lucide set (checked in app.js).
  const KNOWN = new Set(["arrow-down-az", "arrow-down-za", "rows-2", "columns-2", "copy",
    "arrow-up", "arrow-down", "arrow-left", "arrow-right"]);
  const unknown = TABLE_STRUCTURE_ROWS.map((row) => row.icon).filter((id) => !KNOWN.has(id));
  ok("item 17: every table structure row uses a known icon id", unknown.length === 0, JSON.stringify(unknown));
  ok("item 17: the sorts use arrow-down-az / arrow-down-za",
    TABLE_STRUCTURE_ROWS.find((row) => row.kind === "sort-asc")?.icon === "arrow-down-az" &&
      TABLE_STRUCTURE_ROWS.find((row) => row.kind === "sort-desc")?.icon === "arrow-down-za");
  ok("item 17: Delete row and Delete column show different known glyphs",
    TABLE_DELETE_ICONS.row !== TABLE_DELETE_ICONS.column &&
      KNOWN.has(TABLE_DELETE_ICONS.row) && KNOWN.has(TABLE_DELETE_ICONS.column));
}

/* ---------- review-MB-2: Escape leaves editable embeds and image edits to Obsidian ---------- */
{
  // CodeMirror's real keymap: every Escape binding runs in precedence order
  // until one returns true.
  const escape = { key: "Escape", keyCode: 27, type: "keydown", altKey: false, ctrlKey: false,
    metaKey: false, shiftKey: false, preventDefault() {}, stopPropagation() {} };
  const press = (extensions) => cmRunScopeHandlers({ state: EditorState.create({ extensions }) }, escape, "editor");
  const setup = (pluginExt, calls, embed) => [
    // Obsidian's markdown binding: clear search highlights, decline.
    cmKeymap.of([{ key: "Escape", run: () => { calls.push("markdown"); return false; }, preventDefault: true }]),
    // app.workspace.editorExtensions come before the embed's own binding.
    pluginExt,
    ...(embed ? [cmKeymap.of([{ key: "Escape", run: () => { calls.push("embed"); return true; } }])] : []),
  ];
  const pluginRun = (calls) => () => { calls.push("plugin"); return true; };
  const cmOf = (bindings) => cmKeymap.of(bindings);
  // The defect first: at Prec.highest the plugin took Escape from the embed.
  const before = [];
  press(setup(Prec.highest(cmKeymap.of([{ key: "Escape", run: pluginRun(before) }])), before, true));
  ok("MB-2: (control) a Prec.highest binding runs before the embed's and takes the key",
    JSON.stringify(before) === JSON.stringify(["plugin"]), JSON.stringify(before));
  const embed = [];
  press(setup(caretBlockEscapeKeymap(pluginRun(embed), cmOf), embed, true));
  ok("MB-2: in an editable embed, the embed's Escape runs and the plugin never sees the key",
    JSON.stringify(embed) === JSON.stringify(["markdown", "embed"]), JSON.stringify(embed));
  const plain = [];
  const handled = press(setup(caretBlockEscapeKeymap(pluginRun(plain), cmOf), plain, false));
  ok("MB-2: in a plain note, Obsidian's binding declines and the plugin still selects the block",
    handled && JSON.stringify(plain) === JSON.stringify(["markdown", "plugin"]), JSON.stringify(plain));
  const image = [];
  press([
    ...setup(caretBlockEscapeKeymap(pluginRun(image), cmOf), image, false),
    Prec.high(cmKeymap.of([{ key: "Escape", run: () => { image.push("image"); return true; } }])),
  ]);
  ok("MB-2: an image's URL/alias edit (Prec.high exitImageEdit) keeps Escape",
    JSON.stringify(image) === JSON.stringify(["image"]), JSON.stringify(image));
}

/* ---------- chunk 7: a small DOM for the toolbar and the link card ---------- */
class FakeEl extends EventTarget {
  constructor(doc, tag, opts = {}) {
    super();
    this.ownerDocument = doc; this.tagName = tag.toUpperCase(); this.children = []; this.parent = null;
    this.attrs = {}; this.classes = new Set(); this.textContent = opts.text ?? ""; this.value = ""; this.disabled = false;
    this.style = { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } };
    this.classList = {
      add: (...c) => c.forEach((x) => this.classes.add(x)),
      remove: (...c) => c.forEach((x) => this.classes.delete(x)),
      toggle: (c, on) => { const v = on ?? !this.classes.has(c); if (v) this.classes.add(c); else this.classes.delete(c); return v; },
      contains: (c) => this.classes.has(c),
    };
    for (const c of String(opts.cls ?? "").split(/\s+/).filter(Boolean)) this.classes.add(c);
    for (const [k, v] of Object.entries(opts.attr ?? {})) this.attrs[k] = String(v);
    if (opts.type) this.attrs.type = opts.type;
    this.offsetWidth = 300; this.offsetHeight = 40;
  }
  createEl(tag, opts = {}) { const el = new FakeEl(this.ownerDocument, tag, opts); el.parent = this; this.children.push(el); return el; }
  createDiv(opts) { return this.createEl("div", opts); }
  createSpan(opts) { return this.createEl("span", opts); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  addClass(...c) { c.forEach((x) => this.classes.add(x)); }
  removeClass(...c) { c.forEach((x) => this.classes.delete(x)); }
  toggleClass(c, on) { if (on) this.classes.add(c); else this.classes.delete(c); }
  setText(text) { this.textContent = text; }
  empty() { this.children = []; }
  remove() { this.removed = true; }
  contains(node) { for (let x = node; x; x = x.parent) if (x === this) return true; return false; }
  closest() { return null; }
  get isConnected() { return !this.removed; }
  focus() { this.ownerDocument.activeElement = this; }
  select() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 300, bottom: 40, width: 300, height: 40 }; }
  /** Every element below this one, depth first. */
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
}
function fakeEditor(text, anchor, head = anchor, app = {}) {
  const doc = Object.assign(new EventTarget(), { activeElement: null });
  doc.body = new FakeEl(doc, "body");
  doc.defaultView = Object.assign(new EventTarget(), {
    setTimeout, clearTimeout, innerWidth: 1280, innerHeight: 860,
    requestAnimationFrame: (cb) => setTimeout(cb, 0), cancelAnimationFrame: clearTimeout,
    getSelection: () => null,
  });
  let state = EditorState.create({ doc: text, selection: { anchor, head } });
  const view = {
    get state() { return state; },
    dom: new FakeEl(doc, "div"), contentDOM: new FakeEl(doc, "div"),
    hasFocus: true, composing: false,
    dispatch(spec) { state = state.update(spec).state; },
    focus() {},
    coordsAtPos: () => ({ left: 100, right: 110, top: 200, bottom: 220 }),
  };
  const leaf = { view: { editor: { cm: view }, file: { path: "A.md" } } };
  const plugin = {
    settings: { ...DEFAULT_SETTINGS },
    operations: { capture: () => ({ isCurrent: () => true, finish() {}, cancel() {} }) },
    app: {
      ...app,
      workspace: { getLeavesOfType: () => [leaf], openLinkText: async () => {}, getLastOpenFiles: () => [] },
      vault: { getFiles: () => [], getConfig: () => false },
      metadataCache: { fileToLinktext: (file) => file.path, getFirstLinkpathDest: () => null },
    },
  };
  return { doc, view, plugin };
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const buttons = (toolbarEl) => toolbarEl.all().filter((el) => el.tagName === "BUTTON");
const byLabel = (toolbarEl, label) =>
  buttons(toolbarEl).find((b) => (b.attrs["aria-label"] ?? "").split(" · ")[0] === label);

/* ---------- review-css-5 / item 19: the toolbar's buttons ---------- */
{
  const { view, plugin, doc } = fakeEditor("some words here", 5, 10);
  const Toolbar = makeToolbarPlugin(plugin);
  const tv = new Toolbar(view);
  const bar = doc.body.children.find((el) => el.classes.has("nf-toolbar"));
  ok("css-5: the toolbar was built", !!bar);
  const color = byLabel(bar, "Text color");
  const bg = byLabel(bar, "Highlight color");
  ok("css-5: Text color carries nf-color-btn (the current-colour bar's hook)", color?.classes.has("nf-color-btn"), JSON.stringify([...(color?.classes ?? [])]));
  ok("css-5: Highlight color carries nf-color-btn", bg?.classes.has("nf-color-btn"));
  ok("css-5: Bold does not", !byLabel(bar, "Bold")?.classes.has("nf-color-btn"));
  const label = (name) => byLabel(bar, name)?.attrs["aria-label"];
  const aria = (name) => byLabel(bar, name)?.getAttribute("aria-keyshortcuts");
  ok("item 19: Bold · Ctrl+B", label("Bold") === "Bold · Ctrl+B" && aria("Bold") === "Control+B", `${label("Bold")} ${aria("Bold")}`);
  ok("item 19: Italic · Ctrl+I", label("Italic") === "Italic · Ctrl+I");
  ok("item 19: Underline · Ctrl+U", label("Underline") === "Underline · Ctrl+U" && aria("Underline") === "Control+U", `${label("Underline")} ${aria("Underline")}`);
  ok("item 19: Strikethrough names no chord", label("Strikethrough") === "Strikethrough" && aria("Strikethrough") === null, `${label("Strikethrough")} ${aria("Strikethrough")}`);
  ok("item 19: Inline code names no chord (⌘E is Reading view)", label("Inline code") === "Inline code" && aria("Inline code") === null, `${label("Inline code")} ${aria("Inline code")}`);
  ok("item 19: Link · Ctrl+K", label("Link") === "Link · Ctrl+K");
  // A person who binds strikethrough sees it; one who unbinds Bold does not.
  const mgr = {
    getHotkeys: (id) => ({ "editor:toggle-strikethrough": [{ modifiers: ["Mod", "Shift"], key: "X" }], "editor:toggle-bold": [] })[id],
    getDefaultHotkeys: (id) => ({ "editor:toggle-bold": [{ modifiers: ["Mod"], key: "B" }] })[id],
    customKeys: {}, defaultKeys: {},
  };
  const bound = fakeEditor("some words here", 5, 10, { hotkeyManager: mgr });
  const tv2 = new (makeToolbarPlugin(bound.plugin))(bound.view);
  const bar2 = bound.doc.body.children.find((el) => el.classes.has("nf-toolbar"));
  ok("item 19: a bound strikethrough shows its chord, aria follows",
    byLabel(bar2, "Strikethrough")?.attrs["aria-label"] === "Strikethrough · Ctrl+Shift+X" &&
      byLabel(bar2, "Strikethrough")?.getAttribute("aria-keyshortcuts") === "Control+Shift+X",
    JSON.stringify(byLabel(bar2, "Strikethrough")?.attrs));
  ok("item 19: an unbound Bold shows none and announces none",
    byLabel(bar2, "Bold")?.attrs["aria-label"] === "Bold" && byLabel(bar2, "Bold")?.getAttribute("aria-keyshortcuts") === null,
    JSON.stringify(byLabel(bar2, "Bold")?.attrs));
  tv.destroy(); tv2.destroy();
}

/* ---------- review3-MODS-7: an explicit Ctrl binding is announced as Control ---------- */
{
  ok("MODS-7: Ctrl is Control on a Mac", ariaKeyshortcuts("Ctrl+B", true) === "Control+B", ariaKeyshortcuts("Ctrl+B", true));
  ok("MODS-7: …and elsewhere", ariaKeyshortcuts("Ctrl+Shift+B", false) === "Control+Shift+B");
  ok("MODS-7: Mod on a Mac is still Meta, beside an explicit Ctrl", ariaKeyshortcuts("Mod+Ctrl+B", true) === "Meta+Control+B");
  ok("MODS-7: Meta, Alt and Shift pass through", ariaKeyshortcuts("Meta+Alt+Shift+B", true) === "Meta+Alt+Shift+B");
  // The toolbar, for a Mac user who bound Bold to ⌃B.
  const platform = globalThis.__nfStubPlatform;
  const was = platform.isMacOS;
  platform.isMacOS = true;
  try {
    const mgr = {
      getHotkeys: (id) => ({ "editor:toggle-bold": [{ modifiers: ["Ctrl"], key: "B" }] })[id],
      getDefaultHotkeys: () => undefined,
      customKeys: {}, defaultKeys: {},
    };
    const f = fakeEditor("some words here", 5, 10, { hotkeyManager: mgr });
    const tv = new (makeToolbarPlugin(f.plugin))(f.view);
    const bar = f.doc.body.children.find((el) => el.classes.has("nf-toolbar"));
    const aria = byLabel(bar, "Bold")?.getAttribute("aria-keyshortcuts");
    ok("MODS-7: the toolbar announces a ⌃B Bold as Control+B", aria === "Control+B", String(aria));
    tv.destroy();
  } finally {
    platform.isMacOS = was;
  }
}

/* ---------- item 18: Escape on the link card brings the toolbar back ---------- */
{
  const run = async (withKeyup) => {
    const f = fakeEditor("Some words here to link.", 5, 10);
    const tv = new (makeToolbarPlugin(f.plugin))(f.view);
    let shown = 0, hidden = 0;
    tv.maybeShow = () => { shown++; };
    tv.hide = () => { hidden++; };
    openLinkPopover(f.view, f.plugin);
    const card = f.doc.body.children.find((el) => el.classes.has("nf-link-pop") && !el.removed);
    const dest = card?.all().find((el) => el.classes.has("nf-link-dest"));
    dest.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" }));
    const closed = card.removed === true;
    if (withKeyup) tv.onKeyUp({ key: "Escape" });
    await sleep(withKeyup ? 20 : 360);
    tv.destroy();
    return { closed, shown, hidden, doc: f.view.state.doc.toString(), sel: [f.view.state.selection.main.from, f.view.state.selection.main.to] };
  };
  const a = await run(true);
  ok("item 18: Escape closes the card and writes nothing", a.closed && a.doc === "Some words here to link." && a.sel.join() === "5,10", JSON.stringify(a));
  ok("item 18: that Escape's keyup shows the toolbar instead of hiding it", a.shown === 1 && a.hidden === 0, JSON.stringify(a));
  const b = await run(false);
  ok("item 18: with no keyup, the toolbar still returns (300 ms fallback)", b.shown === 1 && b.hidden === 0, JSON.stringify(b));
  // A plain Escape (no card) still hides the toolbar, as before.
  const f = fakeEditor("Some words", 0, 4);
  const tv = new (makeToolbarPlugin(f.plugin))(f.view);
  let hidden = 0, shown = 0;
  tv.hide = () => { hidden++; };
  tv.maybeShow = () => { shown++; };
  tv.onKeyUp({ key: "Escape" });
  await sleep(10);
  ok("item 18: a plain Escape keyup hides the toolbar", hidden === 1 && shown === 0, `${hidden} ${shown}`);
  tv.destroy();
}

/* ---------- item 18 / review-MOD-1: what Save writes ---------- */
{
  const plan = (lineText, from, to, text, dest, over = {}) => {
    const md = over.md ?? null;
    const wiki = over.wiki ?? null;
    const change = linkSavePlan({
      lineText, lineFrom: 0, sel: { from, to }, md, wiki, text, dest,
      resolves: over.resolves ?? false, useMarkdownLinks: over.useMarkdownLinks ?? false, inTable: over.inTable,
    });
    return change ? apply(lineText, change) : null;
  };
  const DEMO = "See [[notion-flow-demo|the demo]] for more.";
  const wiki = enclosingWikiLinkOnLine(at(DEMO, 26));
  ok("item 18: wiki kept when it resolves",
    plan(DEMO, 26, 26, "demo note", "notion-flow-demo", { wiki, resolves: true }) === "See [[notion-flow-demo|demo note]] for more.");
  ok("item 18: wiki → Markdown when unresolved",
    plan(DEMO, 26, 26, "demo note", "missing", { wiki }) === "See [demo note](missing) for more.");
  ok("item 18: wiki → Markdown for a URL",
    plan(DEMO, 26, 26, "demo note", "https://obsidian.md", { wiki, resolves: true }) === "See [demo note](https://obsidian.md) for more.");
  ok("item 18: wiki → Markdown when the vault writes Markdown links",
    plan(DEMO, 26, 26, "demo note", "notion-flow-demo", { wiki, resolves: true, useMarkdownLinks: true }) === "See [demo note](notion-flow-demo) for more.");
  const overWhole = enclosingWikiLinkOnLine(at(DEMO, 4, 33));
  const nested = plan(DEMO, 4, 33, "the demo", "https://obsidian.md", { wiki: overWhole, resolves: true });
  ok("item 18: a selection over the whole wikilink never nests it", nested === "See [the demo](https://obsidian.md) for more." && !nested.includes("[[["), nested);
  ok("review-MOD-3: a label ending in ] is written as Markdown with the bracket escaped",
    plan("x [[n]] y", 3, 3, "a]", "n", { wiki: enclosingWikiLinkOnLine(at("x [[n]] y", 3)), resolves: true }) === "x [a\\]](n) y",
    plan("x [[n]] y", 3, 3, "a]", "n", { wiki: enclosingWikiLinkOnLine(at("x [[n]] y", 3)), resolves: true }));
  // The flattened span (linkCardTarget grew it) takes one Markdown link.
  const SEE = "see [[x]] here";
  ok("item 18: flattening 'see [[x]] here' writes one link over the span",
    plan(SEE, 0, SEE.length, "see x here", "https://obsidian.md") === "[see x here](https://obsidian.md)");
  const ROW = "| [[Old note]] | 12 |";
  const cellLink = enclosingWikiLinkOnLine(at(ROW, 4));
  const inRow = plan(ROW, 4, 4, "Label", "Old note", { wiki: cellLink, resolves: true, inTable: true });
  ok("review-MOD-1: a relabelled bare wikilink in a table row escapes its pipe", inRow === "| [[Old note\\|Label]] | 12 |", inRow);
  const noFlag = plan(ROW, 4, 4, "Label", "Old note", { wiki: cellLink, resolves: true });
  ok("review-MOD-1: (the defect, without the row flag: 3 cells)", noFlag === "| [[Old note|Label]] | 12 |", noFlag);
  ok("review-MOD-1: a plain selection in a row escapes the label's pipe",
    plan("| a b | c |", 2, 5, "x|y", "https://x.test", { inTable: true }) === "| [x\\|y](https://x.test) | c |");
  const MDROW = "| [a](u) | c |";
  const mdInRow = enclosingLinkOnLine(at(MDROW, 3));
  ok("review-MOD-1: a Markdown link rewritten in a row escapes the label's pipe",
    plan(MDROW, 3, 3, "a|b", "u", { md: mdInRow, inTable: true }) === "| [a\\|b](u) | c |");
}

/* ---------- item 19: honest chords ---------- */
{
  ok("item 19: Cmd/Ctrl+Shift+Enter → ⌘⇧↩ on a Mac",
    expandProseChords("Leave with Cmd/Ctrl+Shift+Enter (the Exit code block command).", true) === "Leave with ⌘⇧↩ (the Exit code block command).",
    expandProseChords("Leave with Cmd/Ctrl+Shift+Enter (the Exit code block command).", true));
  ok("item 19: … and Ctrl+Shift+↩ elsewhere",
    expandProseChords("Leave with Cmd/Ctrl+Shift+Enter (x)", false) === "Leave with Ctrl+Shift+↩ (x)");
  ok("item 19: Mod+/ folds → ⌘/ folds", expandProseChords("Mod+/ folds", true) === "⌘/ folds");
  ok("item 19: Mod+F finds → ⌘F", expandProseChords("Mod+F finds a card.", true) === "⌘F finds a card.");
  ok("item 19: Cmd/Ctrl+Shift+M. → ⌘⇧M.", expandProseChords("press Cmd/Ctrl+Shift+M.", true) === "press ⌘⇧M.");
  ok("item 19: Alt+arrows stays (no real key)", expandProseChords("Alt+arrows move", true) === "Alt+arrows move");
  ok("item 19: Alt+Shift+arrows stays", expandProseChords("and Alt+Shift+arrows reorder", true) === "and Alt+Shift+arrows reorder");
  ok("item 19: Shift+Enter a sibling → ⇧↩ a sibling", expandProseChords("Shift+Enter a sibling", true) === "⇧↩ a sibling");
  ok("item 19: Shift+Tab → ⇧Tab", expandProseChords("Shift+Tab selects", true) === "⇧Tab selects");
  ok("item 19: Chinese prose keeps its words", expandProseChords("按 Shift+Enter换行，Shift+点击多选", true) === "按 ⇧↩换行，Shift+点击多选",
    expandProseChords("按 Shift+Enter换行，Shift+点击多选", true));
  ok("item 19: Alt+F10 → ⌥F10", expandProseChords("Alt+F10 focuses", true) === "⌥F10 focuses");
  ok("item 19: plain words untouched", expandProseChords("Space or F2 edits, Enter adds", true) === "Space or F2 edits, Enter adds");

  const mgr = (custom, defaults, commands) => ({
    hotkeyManager: {
      getHotkeys: (id) => custom[id], getDefaultHotkeys: (id) => defaults[id],
      customKeys: custom, defaultKeys: defaults,
    },
    ...(commands ? { commands: { findCommand: (id) => commands.includes(id) } } : {}),
  });
  const hk = (modifiers, key) => ({ modifiers, key });
  ok("item 19: commandHotkey: a custom binding beats the default",
    JSON.stringify(commandHotkey(mgr({ x: [hk(["Mod", "Shift"], "U")] }, { x: [hk(["Mod"], "U")] }), "x", "Mod+U")) === JSON.stringify(hk(["Mod", "Shift"], "U")));
  ok("item 19: commandHotkey: [] (unbound) → null", commandHotkey(mgr({ x: [] }, { x: [hk(["Mod"], "U")] }), "x", "Mod+U") === null);
  ok("item 19: commandHotkey: a fallback another command owns → null",
    commandHotkey(mgr({}, { other: [hk(["Mod"], "U")] }, ["other"]), "x", "Mod+U") === null);
  ok("item 19: commandHotkey: a free fallback → its parts",
    JSON.stringify(commandHotkey(mgr({}, {}), "x", "Mod+U")) === JSON.stringify(hk(["Mod"], "U")));
  ok("item 19: commandHotkey: a physical code reads as its key",
    JSON.stringify(commandHotkey(mgr({ x: [{ modifiers: ["Mod"], code: "KeyU" }] }, {}), "x", null)) === JSON.stringify(hk(["Mod"], "U")));
  ok("item 19: commandHotkey: no manager, no fallback → null", commandHotkey({}, "x", null) === null);

  const rows = (settings, app = null) => editorHelpSections(settings, app).flatMap((s) => s.rows);
  const all = rows(DEFAULT_SETTINGS);
  const keys = all.flatMap((r) => r.keys);
  ok("item 19: the guide has no ⌘E / Ctrl+E row", !keys.some((k) => /^(⌘E|Ctrl\+E)$/.test(k)), JSON.stringify(keys));
  ok("item 19: the guide lists Underline with its chord", all.some((r) => r.desc === "Underline" && r.keys.join() === "Ctrl+U"));
  ok("item 19: no Inline code / Strikethrough / colour rows while they have no chord",
    !all.some((r) => ["Inline code", "Strikethrough", "Text color", "Highlight color"].includes(r.desc)));
  ok("item 19: no chip is spaced or spells Enter", !keys.some((k) => /[⌘⌥⇧⌃] |Enter/.test(k)), JSON.stringify(keys.filter((k) => /[⌘⌥⇧⌃] |Enter/.test(k))));
  ok("item 19: every row has a chip", all.every((r) => r.keys.length > 0 && r.keys.every((k) => typeof k === "string" && k)));
  const bound = mgr({ "editor:toggle-code": [hk(["Mod", "Shift"], "C")], "notion-flow:turn-into-h1": [] }, {});
  const withApp = rows(DEFAULT_SETTINGS, bound);
  ok("item 19: a bound Inline code gets its row", withApp.some((r) => r.desc === "Inline code" && r.keys.join() === "Ctrl+Shift+C"));
  const turnRows = editorHelpSections(DEFAULT_SETTINGS, bound).find((s) => s.title === "Turn into").rows;
  ok("item 19: an unbound turn-into row is left out", !turnRows.some((r) => r.desc === "Heading 1"), JSON.stringify(turnRows));
  ok("item 19: the other turn-into rows stay", turnRows.some((r) => r.desc === "Heading 2" && r.keys.join() === "Ctrl+Shift+2"));
  const grid = blockChordRows(bound, DEFAULT_SETTINGS);
  ok("item 19: the settings grid shows an unbound command's name without a chord",
    grid.find((r) => r.label === "Heading 1")?.chord === "", JSON.stringify(grid.find((r) => r.label === "Heading 1")));
  const defaults = new Map(pluginDefaultHotkeys(true).map((e) => [e.id, e.hotkey]));
  ok("item 19: toggle-underline ships ⌘U", JSON.stringify(defaults.get("toggle-underline")) === JSON.stringify({ modifiers: ["Mod"], key: "U" }));
  ok("item 19: the colour-row commands ship no chord", !defaults.has("open-text-color") && !defaults.has("open-highlight-color"));
}

/* ---------- item 20: Backspace after a heading marker ---------- */
{
  const doc = EditorState.create({ doc: "## 小标题" }).doc;
  const plan = (markerBackspace, concealHeadings) => backspaceMarkerPlan({ markerBackspace, concealHeadings }, doc, 3);
  const run = (p) => (p ? doc.toString().slice(0, p.from) + p.insert + doc.toString().slice(p.to) : null);
  ok("item 20: concealed + markers: the marker goes whole", run(plan(true, true)) === "小标题");
  ok("item 20: concealed only: the marker goes whole", run(plan(false, true)) === "小标题");
  ok("item 20: markers only (a visible ## ): whole, not '##小标题'", run(plan(true, false)) === "小标题", String(run(plan(true, false))));
  ok("item 20: both off: core's Backspace (no plan)", plan(false, false) === null);
  ok("item 20: not at the text start: no plan", backspaceMarkerPlan({ markerBackspace: true, concealHeadings: false }, doc, 4) === null);
}

/* ---------- w1c: fence rows in a toggle, and Callouts/toggles in a toggle, say so ---------- */
{
  const ALL_ON = { calloutEditing: true, codeBlockEditing: true, toggleBlocks: true, columnLayout: true };
  /** Build the Callout edit plugin over `text` with the caret on `caretLine`. */
  const build = (text, caretLine, settings = ALL_ON) => {
    const state = EditorState.create({ doc: text });
    const caret = state.doc.line(caretLine).from + Math.min(2, state.doc.line(caretLine).length);
    const s2 = state.update({ selection: { anchor: caret } }).state;
    const view = {
      state: s2,
      visibleRanges: [{ from: 0, to: s2.doc.length }],
      contentDOM: { clientWidth: 700, style: { setProperty() {} } },
      dom: { closest: (selector) => (String(selector).includes("is-live-preview") ? {} : null) },
    };
    const Plugin = makeCalloutEditPlugin({ settings, app: {} });
    const instance = Object.create(Plugin.prototype);
    const ranges = [...instance.build.call(instance, view)];
    const doc = s2.doc;
    /** The line decoration of row n (1-based): class list and style vars. */
    const row = (n) => {
      const from = doc.line(n).from;
      const lines = ranges.filter((r) => r.kind === "line" && r.from === from && /nf-co-(edit|code)/.test(r.spec?.attributes?.class ?? ""));
      const attrs = lines[0]?.spec?.attributes ?? {};
      const vars = {};
      for (const m of String(attrs.style ?? "").matchAll(/(--[\w-]+):([^;]*);/g)) vars[m[1]] = m[2];
      return { cls: String(attrs.class ?? "").split(/\s+/).filter(Boolean), vars, count: lines.length };
    };
    /** The prefix gap widget on row n, rendered through the fake document. */
    const gap = (n) => {
      const line = doc.line(n);
      const r = ranges.find((x) => x.kind === "replace" && x.from === line.from && typeof x.spec?.widget?.toggleDepth === "number");
      if (!r) return null;
      const props = {};
      const el = { style: { width: "", setProperty(k, v) { props[k] = v; } }, setAttribute() {}, className: "" };
      r.spec.widget.toDOM({ dom: { ownerDocument: { createElement: () => el } } });
      return { kind: r.spec.widget.kind, width: el.style.width, props, className: el.className };
    };
    return { doc, row, gap };
  };
  {
    const text = "> [!nf-toggle]+ T\n> ```js\n> x\n> ```";
    const { row, gap } = build(text, 3);
    for (const n of [2, 3, 4]) {
      const r = row(n);
      ok(`w1c: toggle fence row ${n} carries nf-co-code + nf-co-toggle-code`,
        r.count === 1 && r.cls.includes("nf-co-code") && r.cls.includes("nf-co-toggle-code"), JSON.stringify(r));
      ok(`w1c: toggle fence row ${n}: boxes 0, depth 1`,
        r.vars["--nf-co-toggle-boxes"] === "0" && r.vars["--nf-co-toggle-depth"] === "1", JSON.stringify(r.vars));
    }
    const g = gap(3);
    ok("w1c: a toggle's code row gap is a toggle gap (no 39px box)",
      g?.kind === "toggle" && g.props["--nf-prefix-callout-depth"] === "0" && g.props["--nf-prefix-toggle-depth"] === "1", JSON.stringify(g));
    ok("w1c: …that also clears the card's code padding",
      /var\(--nf-co-code-pad,16px\)/.test(g?.width ?? "") && g.className.includes("is-code"), JSON.stringify(g));
    ok("w1c: the toggle's title row keeps its hang and counts",
      row(1).cls.includes("nf-co-toggle-hang") && row(1).vars["--nf-co-toggle-depth"] === "1" && !row(1).cls.includes("nf-co-toggle-code"));
  }
  {
    // A fence in a toggle inside a Callout: one box around the toggle.
    const text = "> [!note] N\n> > [!nf-toggle]+ T\n> > ```js\n> > x\n> > ```";
    const { row, gap } = build(text, 4);
    ok("w1c: a toggle-in-Callout fence row: boxes 1, depth 1",
      row(4).cls.includes("nf-co-toggle-code") && row(4).vars["--nf-co-toggle-boxes"] === "1" && row(4).vars["--nf-co-toggle-depth"] === "1", JSON.stringify(row(4)));
    const g = gap(4);
    ok("w1c: …its gap spends one box and one toggle",
      g?.kind === "toggle" && g.props["--nf-prefix-callout-depth"] === "1" && g.props["--nf-prefix-toggle-depth"] === "1" && g.props["--nf-prefix-inner-depth"] === "0", JSON.stringify(g));
  }
  {
    // A fence straight in a Callout keeps its Callout gap and no toggle signal.
    const text = "> [!note] N\n> ```js\n> x\n> ```";
    const { row, gap } = build(text, 3);
    ok("w1c: a Callout's fence row has no toggle class or counts",
      !row(3).cls.includes("nf-co-toggle-code") && !("--nf-co-toggle-boxes" in row(3).vars), JSON.stringify(row(3)));
    ok("w1c: …and keeps its Callout code gap", gap(3)?.kind === "callout" && gap(3).className.includes("is-code"));
  }
  {
    // Toggles off: a toggle is a Callout box, nothing changes.
    const text = "> [!nf-toggle]+ T\n> ```js\n> x\n> ```";
    const { row, gap } = build(text, 3, { ...ALL_ON, toggleBlocks: false });
    ok("w1c: toggles off: no toggle code signal", !row(3).cls.includes("nf-co-toggle-code") && gap(3)?.kind === "callout");
  }
  {
    const text = "> [!nf-toggle]+ T\n> > [!note] N\n> > body";
    const { row } = build(text, 3);
    for (const n of [2, 3]) {
      const r = row(n);
      ok(`w1c: the note's row ${n} in a toggle carries nf-co-parent-toggle`, r.cls.includes("nf-co-parent-toggle"), JSON.stringify(r));
      ok(`w1c: the note's row ${n}: boxes 0, depth 1 (the toggle, not the note)`,
        r.vars["--nf-co-toggle-boxes"] === "0" && r.vars["--nf-co-toggle-depth"] === "1", JSON.stringify(r.vars));
    }
    ok("w1c: the toggle's own title row has no parent-toggle class", !row(1).cls.includes("nf-co-parent-toggle"));
  }
  {
    const text = "> [!note] O\n> > [!tip] I\n> > body";
    const { row } = build(text, 3);
    ok("w1c: a Callout in a Callout does not get nf-co-parent-toggle",
      !row(2).cls.includes("nf-co-parent-toggle") && !row(3).cls.includes("nf-co-parent-toggle") && !("--nf-co-toggle-boxes" in row(3).vars), JSON.stringify(row(3)));
  }
  {
    // A toggle in a toggle: the class, with the toggle's own counts (itself included).
    const text = "> [!nf-toggle]+ A\n> > [!nf-toggle]+ B\n> > body";
    const { row } = build(text, 3);
    ok("w1c: a toggle in a toggle carries nf-co-parent-toggle, boxes 0, depth 2",
      row(3).cls.includes("nf-co-parent-toggle") && row(3).vars["--nf-co-toggle-boxes"] === "0" && row(3).vars["--nf-co-toggle-depth"] === "2", JSON.stringify(row(3)));
  }
  {
    // A Callout in a toggle in a Callout: boxes around it 1, toggles 1.
    const text = "> [!note] O\n> > [!nf-toggle]+ T\n> > > [!tip] I\n> > > body";
    const { row } = build(text, 4);
    ok("w1c: a Callout in a toggle in a Callout: boxes 1, depth 1",
      row(4).cls.includes("nf-co-parent-toggle") && row(4).vars["--nf-co-toggle-boxes"] === "1" && row(4).vars["--nf-co-toggle-depth"] === "1", JSON.stringify(row(4)));
  }
}

/* ---------- w1c: Backspace on a Callout's first body row steps onto the title ---------- */
{
  const docOf = (text) => EditorState.create({ doc: text }).doc;
  const run = (text, lineNo, ch) => {
    const d = docOf(text);
    const pos = d.line(lineNo).from + ch;
    // What the quote keymap asks: the header plan first, then the quote plan.
    const plan = calloutHeaderKeyPlan(d, pos, "Backspace") ?? quoteBackspacePlan(d, pos);
    if (!plan) return null;
    const s = d.toString();
    return { text: s.slice(0, plan.from) + plan.insert + s.slice(plan.to), cursor: plan.cursor };
  };
  const T = "> [!note] T\n> one\n> two";
  let r = run(T, 2, 2);
  ok("w1c: first body row + more rows: the note is unchanged", r?.text === T, JSON.stringify(r));
  ok("w1c: …and the caret lands after 'T'", r?.cursor === "> [!note] T".length, JSON.stringify(r));
  // A second Backspace then edits the title, as today.
  const second = (() => {
    const d = docOf(T);
    const plan = calloutHeaderKeyPlan(d, r.cursor, "Backspace") ?? quoteBackspacePlan(d, r.cursor);
    return plan;
  })();
  ok("w1c: the second press is the editor's own (deletes the title's last character)", second === null);
  r = run(T, 3, 2);
  ok("w1c: a middle/last row keeps its behaviour (the last row seals)", r?.text === "> [!note] T\n> one\n\ntwo", JSON.stringify(r));
  r = run("> [!note] T\n> one\n> two\n> three", 3, 2);
  ok("w1c: a middle row still joins the row above", r?.text === "> [!note] T\n> onetwo\n> three", JSON.stringify(r));
  r = run("> [!note] T\n> one", 2, 2);
  ok("w1c: a Callout with one body row keeps W1's last-row seal", r?.text === "> [!note] T\n\none", JSON.stringify(r));
  const TOG = "> [!nf-toggle]+ Tog\n> one\n> two";
  r = run(TOG, 2, 2);
  ok("w1c: a toggle's first body row steps onto the title too", r?.text === TOG && r.cursor === "> [!nf-toggle]+ Tog".length, JSON.stringify(r));
  const NEST = "> [!note] O\n> > [!tip] I\n> > one\n> > two";
  r = run(NEST, 3, 4);
  ok("w1c: a nested Callout's first body row steps onto its own title", r?.text === NEST && r.cursor === NEST.split("\n").slice(0, 2).join("\n").length, JSON.stringify(r));
  const BARE = "> [!note]\n> one\n> two";
  r = run(BARE, 2, 2);
  ok("w1c: a title-less Callout: the caret goes to the header's end", r?.text === BARE && r.cursor === "> [!note]".length, JSON.stringify(r));
  r = run("> [!note] T  \n> one\n> two", 2, 2);
  ok("w1c: trailing spaces after the title are not visible text", r?.cursor === "> [!note] T".length, JSON.stringify(r));
  r = run("> quote a\n> one\n> two", 2, 2);
  ok("w1c: a plain quote still joins", r?.text === "> quote aone\n> two", JSON.stringify(r));
  r = run(T, 2, 3);
  ok("w1c: mid-text is not this rule", r === null, JSON.stringify(r));
}

if (fail) { console.log(`${fail} failure(s)`); process.exit(1); }
console.log("ALL PASS");
