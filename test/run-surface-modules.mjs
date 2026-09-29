// The surface feature modules (R2-W2-SURFMOD): comments list, page style,
// page icon and cover, and the shared icon picker's pure parts. Nothing in
// main.ts calls them yet, so they are bundled here on their own, each as a
// namespace (an `export *` name clash could otherwise drop one silently),
// with @codemirror/state bundled in so EditorState and Text are the very
// instances the modules see.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Modules of this package; the ones not written yet are skipped, so the
// suite grows with the package.
const MODULES = [
  ["comments", "src/features/comments-list.ts"],
  ["pageStyle", "src/features/page-style.ts"],
  ["pageHeader", "src/features/page-header.ts"],
  ["blockColor", "src/features/block-color.ts"],
  ["iconPicker", "src/ui/callout-icon-picker.ts"],
  ["whatsNew", "src/ui/whats-new.ts"],
].filter(([, path]) => existsSync(join(root, path)));

let checks = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const ok = (value, label) => { assert.ok(value, label); checks++; };
const tick = () => new Promise((done) => setTimeout(done, 0));

const directory = await mkdtemp(join(tmpdir(), "nf-surface-"));
try {
  const outfile = join(directory, "surface.mjs");
  await build({
    stdin: {
      resolveDir: root,
      loader: "ts",
      contents: [
        ...MODULES.map(([name, path]) => `export * as ${name} from "./${path}";`),
        // The comment controller the list resolves through, as the host wires it.
        ...(existsSync(join(root, "src/features/comments.ts")) ? [`export { CommentController } from "./src/features/comments.ts";`] : []),
        `export { EditorState, Text } from "@codemirror/state";`,
        // The stub's Platform, so a test can play macOS.
        `export { Platform } from "obsidian";`,
      ].join("\n"),
    },
    bundle: true, format: "esm", platform: "node", outfile, logLevel: "silent",
    alias: {
      obsidian: resolve(root, "test/obsidian-stub.mjs"),
      "@codemirror/view": resolve(root, "test/view-stub.mjs"),
      "@codemirror/language": resolve(root, "test/language-stub.mjs"),
    },
  });
  const surface = await import(pathToFileURL(outfile).href);
  // The same bundle again with the UI in Chinese (i18n reads the language once, at import).
  globalThis.window = { localStorage: { getItem: (k) => (k === "language" ? "zh" : null) } };
  let surfaceZh;
  try {
    surfaceZh = await import(`${pathToFileURL(outfile).href}?zh`);
  } finally {
    delete globalThis.window;
  }
  const { EditorState } = surface;
  const docOf = (text) => EditorState.create({ doc: text }).doc;

  /* ------------------------------------------------------------------ */
  /* Comments list                                                       */
  /* ------------------------------------------------------------------ */
  {
    const { collectComments, CommentsListModal, registerCommentsList } = surface.comments;
    const L1 = 'Intro <span class="nf-cmt" data-nf-cmt="say &quot;hi&quot;">alpha</span> text';
    const L2 = '<span style="color:var(--nf-red, #b5554d)">red <span class="nf-cmt" data-nf-cmt="two&#10;lines">be<span style="color:var(--nf-blue, #3a6e9e)">ta</span></span></span> and <span class="nf-cmt" data-nf-cmt="third">gam  ma</span>';
    const L3 = 'broken <span class="nf-cmt" data-nf-cmt="open">never closed';
    const TEXT = [L1, L2, L3].join("\n");
    const entries = collectComments(docOf(TEXT));
    eq(entries, [
      { line: 1, from: 60, to: 65, openFrom: 6, closeTo: 72, anchorText: "alpha", note: 'say "hi"' },
      { line: 2, from: 174, to: 229, openFrom: 125, closeTo: 236, anchorText: "beta", note: "two\nlines" },
      { line: 2, from: 289, to: 296, openFrom: 248, closeTo: 303, anchorText: "gam ma", note: "third" },
    ], "collectComments: document order, exact offsets, tags stripped, note decoded, unclosed anchor ignored");
    eq(TEXT.slice(174, 229), 'be<span style="color:var(--nf-blue, #3a6e9e)">ta</span>', "from/to span the raw inner text");
    eq(collectComments(docOf("plain\n<span class=\"nf-cmt\" data-nf-cmt=\"x\"></span>")).map((e) => e.anchorText), ["…"], "an empty anchor reads …");
    eq(collectComments(docOf("no comments here")), [], "no comments");

    // A fake EditorView, and the host as the plugin wires it: the real
    // CommentController's resolve (review2-surfmod-1), calls recorded.
    const makeView = (text) => ({ state: EditorState.create({ doc: text }), dispatch(tr) { this.state = this.state.update(tr).state; } });
    ok(surface.CommentController, "CommentController bundled");
    const makeHost = () => {
      const controller = new surface.CommentController({ enabled: () => true, operations: {}, identity: () => "note.md" });
      return {
        calls: [],
        resolve(v, pos) {
          this.calls.push(pos);
          controller.resolve(v, pos);
        },
      };
    };
    const fakeEditor = () => ({
      log: [],
      offsetToPos(offset) { return { line: 0, ch: offset }; },
      setSelection(a, b) { this.log.push(["setSelection", a.ch, b.ch]); },
      scrollIntoView(range, center) { this.log.push(["scrollIntoView", range.from.ch, range.to.ch, center]); },
      focus() { this.log.push(["focus"]); },
    });

    const view = makeView(TEXT);
    const host = makeHost(view);
    const editor = fakeEditor();
    const modal = new CommentsListModal({}, editor, view, host, collectComments(view.state.doc));
    eq(modal.placeholder, "Search comments", "placeholder");
    eq(modal.instructions.map((i) => i.purpose), ["Jump to comment", "Resolve comment"], "instructions");
    eq(modal.instructions[1].command, "Ctrl+↩", "Mod+Enter label (non-Mac stub)");
    eq(modal.emptyStateText, "No matching comments", "empty-state text");
    eq(modal.getSuggestions("").map((e) => e.anchorText), ["alpha", "beta", "gam ma"], "empty query: all, in order");
    eq(modal.getSuggestions("hi").map((e) => e.anchorText), ["alpha", "gam ma"], "a query narrows in document order");
    eq(modal.getSuggestions("lines").map((e) => e.anchorText), ["beta"], "the note is searched too");
    eq(modal.getSuggestions("xyz"), [], "no match");

    modal.onChooseSuggestion(modal.getSuggestions("")[2], { metaKey: false, ctrlKey: false });
    eq(editor.log, [["setSelection", 289, 296], ["scrollIntoView", 289, 296, true], ["focus"]], "Enter selects the anchor text, centred, and focuses");
    eq(host.calls, [], "a jump resolves nothing");

    // Mod+Enter through the registered scope handler (the stub's
    // handleKey ignores modifiers, so the handler is called directly).
    const handler = modal.scope.keys.find((h) => h.key === "Enter" && h.modifiers?.includes("Mod"));
    ok(handler, "Mod+Enter handler registered");
    const chooser = { values: modal.getSuggestions(""), selectedItem: 1, setSelectedItem(i) { this.selectedItem = i; } };
    modal.chooser = chooser;
    // What Obsidian's SuggestModal does on input: re-query, highlight row 0.
    modal.inputEl.addEventListener("input", () => { chooser.values = modal.getSuggestions(modal.inputEl.value); chooser.selectedItem = 0; });
    let closed = 0;
    modal.close = () => { closed++; };
    eq(handler.func({ key: "Enter", metaKey: true }), false, "the handler consumes the key");
    eq(host.calls, [126], "Mod+Enter resolves the highlighted comment, pointing inside its open tag");
    eq(view.state.doc.line(2).text, '<span style="color:var(--nf-red, #b5554d)">red be<span style="color:var(--nf-blue, #3a6e9e)">ta</span></span> and <span class="nf-cmt" data-nf-cmt="third">gam  ma</span>', "exactly that pair's two tags are gone");
    eq(chooser.values.map((e) => e.anchorText), ["alpha", "gam ma"], "the list refreshes");
    eq(chooser.selectedItem, 1, "the highlight stays in place");
    eq(closed, 0, "the list stays open");
    handler.func({ key: "Enter", metaKey: true });
    eq(chooser.values.map((e) => e.anchorText), ["alpha"], "resolving the last row");
    eq(chooser.selectedItem, 0, "the highlight clamps to the last row");
    handler.func({ key: "Enter", metaKey: true });
    eq(closed, 1, "nothing left: the list closes");
    eq(collectComments(view.state.doc), [], "all resolved");

    // Mod+click resolves (the modal has already closed then).
    const view2 = makeView(TEXT);
    const host2 = makeHost(view2);
    const modal2 = new CommentsListModal({}, fakeEditor(), view2, host2, collectComments(view2.state.doc));
    modal2.onChooseSuggestion(modal2.getSuggestions("")[0], { metaKey: true });
    eq(host2.calls, [7], "Mod+click resolves, pointing inside the open tag");
    // Without a reachable chooser the handler falls back to picking the row.
    const evt = { key: "Enter", ctrlKey: true };
    modal2.scope.keys.find((h) => h.key === "Enter" && h.modifiers?.includes("Mod")).func(evt);
    eq(modal2.activeSelections, [evt], "fallback: selectActiveSuggestion with the Mod event");

    // review2-surfmod-1: nested anchors that share a start or an end, and
    // adjacent ones: Mod+Enter and Mod+click resolve exactly the row's own.
    const C = (note, words) => `<span class="nf-cmt" data-nf-cmt="${note}">${words}</span>`;
    const shapes = {
      "shared start": C("outer", C("inner", "hello") + " world"),
      "shared end": C("outer", "world " + C("inner", "hello")),
      "adjacent": C("a", "x") + C("b", "y"),
      "three deep": C("o", C("m", C("i", "core") + " mid") + " out"),
      "nested in colour": `<span style="color:var(--nf-red, #b5554d)">${C("outer", C("inner", "hi"))}</span>`,
    };
    for (const [shape, text] of Object.entries(shapes)) {
      const notes = collectComments(docOf(text)).map((e) => e.note);
      for (let row = 0; row < notes.length; row++) {
        for (const how of ["Mod+Enter", "Mod+click"]) {
          const v = makeView(text);
          const m = new CommentsListModal({}, fakeEditor(), v, makeHost(), collectComments(v.state.doc));
          if (how === "Mod+Enter") {
            m.chooser = { values: m.getSuggestions(""), selectedItem: row, setSelectedItem(i) { this.selectedItem = i; } };
            m.close = () => {};
            m.scope.keys.find((h) => h.key === "Enter" && h.modifiers?.includes("Mod")).func({ key: "Enter", metaKey: true });
          } else {
            m.onChooseSuggestion(m.getSuggestions("")[row], { metaKey: true });
          }
          eq(collectComments(v.state.doc).map((e) => e.note), notes.filter((_, i) => i !== row), `${shape}: ${how} on ${notes[row]} resolves only it`);
        }
      }
    }
    eq(
      (() => { const v = makeView(shapes["shared start"]); const m = new CommentsListModal({}, fakeEditor(), v, makeHost(), collectComments(v.state.doc)); m.onChooseSuggestion(m.getSuggestions("")[0], { metaKey: true }); return v.state.doc.toString(); })(),
      C("inner", "hello") + " world",
      "shared start: resolving the outer comment keeps the inner one's tags and words"
    );

    // review2-surfmod-5: SuggestModal caps its list at 100 unless told
    // otherwise; every comment of a heavily annotated note is listed.
    const MANY = Array.from({ length: 150 }, (_, i) => `Line ${i + 1} ${C(`note ${i + 1}`, `word${i + 1}`)}`).join("\n");
    const many = new CommentsListModal({}, fakeEditor(), makeView(MANY), makeHost(), collectComments(docOf(MANY)));
    eq(many.limit, 0, "no cap on the list (SuggestModal's default is 100)");
    eq(many.getSuggestions("").length, 150, "all 150 comments listed");
    eq(many.getSuggestions("").at(-1).note, "note 150", "the last comment in the note is reachable");
    eq(many.getSuggestions("note").length, 150, "a query matching them all lists them all");

    // A stale entry (its text changed) is left alone.
    const stale = { ...entries[0], openFrom: 999 };
    const editor3 = fakeEditor();
    new CommentsListModal({}, editor3, makeView(TEXT), makeHost(), entries).onChooseSuggestion(stale, {});
    eq(editor3.log, [], "a comment that is gone: no jump");

    // The command.
    const commands = [];
    let active = null;
    let enabled = true;
    const plugin = {
      app: { workspace: { getActiveViewOfType: () => active } },
      addCommand(command) { commands.push(command); },
    };
    registerCommentsList(plugin, { resolve() {}, enabled: () => enabled });
    eq(commands.map((c) => [c.id, c.name, c.icon, c.hotkeys]), [["show-comments", "Show comments in this note", "message-square", undefined]], "command registered, no default hotkey");
    const command = commands[0];
    eq(command.checkCallback(true), false, "no Markdown view: unavailable");
    const makeMdView = (text, mode) => {
      const mdView = {
        mode,
        states: [],
        editor: { cm: makeView(text) },
        getMode() { return this.mode; },
        getState() { return { mode: this.mode === "preview" ? "preview" : "source", source: false, file: "a.md" }; },
        async setState(state, result) { this.states.push([state, result]); this.mode = state.mode; this.editor = { cm: makeView(text), fresh: true }; },
      };
      return mdView;
    };
    active = makeMdView("nothing to see", "source");
    enabled = false;
    eq(command.checkCallback(true), false, "commenting off: unavailable");
    enabled = true;
    eq(command.checkCallback(true), true, "available in a Markdown view");
    globalThis.__nfNotices = [];
    globalThis.__nfOpenedModals = [];
    command.checkCallback(false);
    await tick();
    eq(globalThis.__nfNotices, ["No comments in this note"], "no comments: a Notice");
    eq(globalThis.__nfOpenedModals.length, 0, "no comments: no modal");
    active = makeMdView(TEXT, "preview");
    command.checkCallback(false);
    await tick();
    await tick();
    eq(active.states.map(([state, result]) => [state.mode, state.source, state.file, result]), [["source", false, "a.md", { history: false }]], "Reading view switches to Live Preview");
    eq(globalThis.__nfOpenedModals.length, 1, "then the list opens");
    eq(globalThis.__nfOpenedModals[0].getSuggestions("").length, 3, "with every comment");
    ok(globalThis.__nfOpenedModals[0].view === active.editor.cm, "on the fresh editor");
    active = makeMdView(TEXT, "source");
    command.checkCallback(false);
    await tick();
    eq(active.states, [], "Source mode stays Source mode");
    eq(globalThis.__nfOpenedModals.length, 2, "and opens the list");
  }

  /* ------------------------------------------------------------------ */
  /* Page style                                                          */
  /* ------------------------------------------------------------------ */
  {
    const { cssClassList, pageStyleOf, nextCssClasses, registerPageStyle, PAGE_FONT_CLASSES } = surface.pageStyle;
    eq(PAGE_FONT_CLASSES, { serif: "nf-serif", mono: "nf-mono", kai: "nf-kai" }, "font classes");
    eq(cssClassList(["a", "nf-serif"]), ["a", "nf-serif"], "cssClassList: list");
    eq(cssClassList("a nf-serif, b"), ["a", "nf-serif", "b"], "cssClassList: string form");
    eq(cssClassList(null), [], "cssClassList: null");
    eq(cssClassList([" a ", 3, "", "b"]), ["a", "b"], "cssClassList: junk dropped");
    eq(nextCssClasses(["my-class", "nf-serif"], { font: "kai" }), ["my-class", "nf-kai"], "font replaces font");
    eq(nextCssClasses(["nf-serif", "my-class", "nf-mono"], { font: "default" }), ["my-class"], "default removes every font");
    eq(nextCssClasses(["nf-serif", "my-class"], { font: "mono" }), ["my-class", "nf-mono"], "new font goes last");
    eq(nextCssClasses(["my-class"], { toggle: "small" }), ["my-class", "nf-small"], "toggle small on");
    eq(nextCssClasses(["nf-small", "my-class"], { toggle: "small" }), ["my-class"], "toggle small off");
    eq(nextCssClasses(["nf-wide", "a"], { wide: true }), ["nf-wide", "a"], "wide:true is idempotent (keeps place)");
    eq(nextCssClasses(["a"], { wide: true }), ["a", "nf-wide"], "wide:true adds");
    eq(nextCssClasses(["a", "nf-wide"], { wide: false }), ["a"], "wide:false removes");
    eq(nextCssClasses(["a"], { small: false }), ["a"], "small:false when off");
    eq(nextCssClasses(["a", "b", "a"], { toggle: "wide" }), ["a", "b", "nf-wide"], "duplicates removed");
    eq(nextCssClasses("a nf-kai", { font: "serif" }), ["a", "nf-serif"], "string input");
    eq(nextCssClasses(["nf-small"], { toggle: "small" }), [], "empty result");
    eq(pageStyleOf(["x", "nf-kai", "nf-serif", "nf-small"]), { font: "kai", small: true, wide: false }, "pageStyleOf: first font wins");
    eq(pageStyleOf("nf-wide"), { font: "default", small: false, wide: true }, "pageStyleOf: string");
    eq(pageStyleOf(undefined), { font: "default", small: false, wide: false }, "pageStyleOf: none");

    const handlers = {};
    const commands = [];
    const events = [];
    let fm = { cssclasses: ["my-class"] };
    const writes = [];
    let activeFile = null;
    const md = { stubFile: true, path: "notes/a.md", extension: "md" };
    const app = {
      workspace: { on(name, cb) { handlers[name] = cb; return { name }; }, getActiveFile: () => activeFile },
      metadataCache: { getFileCache: () => ({ frontmatter: fm }) },
      fileManager: { async processFrontMatter(file, fn) { writes.push(file.path); fn(fm); } },
    };
    const plugin = { app, registerEvent(ref) { events.push(ref); }, addCommand(command) { commands.push(command); } };
    registerPageStyle(plugin);
    eq(events.map((ref) => ref.name), ["file-menu"], "file-menu registered through registerEvent");
    const menuFor = (file, source) => {
      const menu = { items: [], addItem(cb) { const item = new (class {
        setTitle(v) { this.title = v; return this; } setIcon(v) { this.icon = v; return this; } setSection(v) { this.section = v; return this; }
        setIsLabel(v) { this.isLabel = v; return this; } setChecked(v) { this.checked = v; return this; } onClick(fn) { this.click = fn; return this; }
        setSubmenu() { this.submenu = { items: [], separators: [], addItem: menu.addItem, addSeparator() { this.separators.push(this.items.length); return this; } }; return this.submenu; }
      })(); cb(item); this.items.push(item); return this; } };
      handlers["file-menu"](menu, file, source);
      return menu;
    };
    eq(menuFor(md, "file-explorer-context-menu").items.length, 0, "only the ⋯ menu");
    eq(menuFor({ stubFile: true, path: "a.canvas", extension: "canvas" }, "more-options").items.length, 0, "only Markdown notes");
    eq(menuFor({ path: "folder" }, "more-options").items.length, 0, "not a folder");
    fm = { cssclasses: ["my-class", "nf-kai", "nf-wide"] };
    const menu = menuFor(md, "more-options");
    eq(menu.items.map((i) => [i.title, i.icon, i.section]), [["Page style", "type", "view"]], "one Page style item in the view section");
    const sub = menu.items[0].submenu;
    eq(sub.items.map((i) => [i.title, i.checked]), [["Default", false], ["Serif", false], ["Mono", false], ["Kai", true], ["Small text", false], ["Full width", true]], "fonts (one checked) and toggles");
    eq(sub.separators, [4], "a separator between fonts and toggles");
    fm = { cssclasses: ["my-class"] };
    sub.items[1].click();
    await tick();
    eq(fm, { cssclasses: ["my-class", "nf-serif"] }, "Serif writes nf-serif after the user's class");
    eq(writes, ["notes/a.md"], "one write");
    fm = { cssclasses: ["nf-serif"], title: "x" };
    sub.items[0].click();
    await tick();
    eq(fm, { title: "x" }, "an empty list deletes the key");
    writes.length = 0;
    sub.items[0].click();
    await tick();
    eq(writes, [], "a change that changes nothing does not write");
    // Without submenus the entries follow a label row inline.
    const flat = { items: [], separators: [], addItem(cb) { const item = { setTitle(v) { this.title = v; return this; }, setIcon() { return this; }, setSection(v) { this.section = v; return this; }, setIsLabel(v) { this.isLabel = v; return this; }, setChecked(v) { this.checked = v; return this; }, onClick(fn) { this.click = fn; return this; } }; cb(item); this.items.push(item); return this; }, addSeparator() { this.separators.push(this.items.length); return this; } };
    handlers["file-menu"](flat, md, "more-options");
    eq(flat.items.map((i) => [i.title, !!i.isLabel, i.section]), [["Page style", true, "view"], ["Default", false, "view"], ["Serif", false, "view"], ["Mono", false, "view"], ["Kai", false, "view"], ["Small text", false, "view"], ["Full width", false, "view"]], "fallback: label row plus inline items");

    eq(commands.map((c) => [c.id, c.name]), [
      ["page-font-default", "Page font: Default"],
      ["page-font-serif", "Page font: Serif"],
      ["page-font-mono", "Page font: Mono"],
      ["page-font-kai", "Page font: Kai"],
      ["toggle-small-text", "Toggle small text"],
      ["toggle-full-width", "Toggle full width"],
    ], "six commands");
    eq(commands[1].checkCallback(true), false, "no active file: unavailable");
    activeFile = { stubFile: true, path: "a.canvas", extension: "canvas" };
    eq(commands[1].checkCallback(true), false, "a canvas: unavailable");
    activeFile = md;
    eq(commands[1].checkCallback(true), true, "a note: available");
    fm = { cssclasses: ["my-class"] };
    commands[3].checkCallback(false);
    await tick();
    commands[4].checkCallback(false);
    await tick();
    commands[5].checkCallback(false);
    await tick();
    eq(fm, { cssclasses: ["my-class", "nf-kai", "nf-small", "nf-wide"] }, "commands write the listed classes");
    commands[0].checkCallback(false);
    await tick();
    commands[4].checkCallback(false);
    await tick();
    eq(fm, { cssclasses: ["my-class", "nf-wide"] }, "Default font and toggle off");
    // A failed write is reported, not thrown.
    const failing = { ...plugin, app: { ...app, fileManager: { processFrontMatter: async () => { throw new Error("locked"); } } } };
    const failCommands = [];
    registerPageStyle({ ...failing, addCommand: (c) => failCommands.push(c) });
    globalThis.__nfNotices = [];
    const quiet = console.error;
    console.error = () => {};
    try {
      failCommands[1].checkCallback(false);
      await tick();
      await tick();
    } finally {
      console.error = quiet;
    }
    eq(globalThis.__nfNotices, ["Could not update the page style."], "a failed write shows a Notice");
  }

  /* ------------------------------------------------------------------ */
  /* Page header                                                         */
  /* ------------------------------------------------------------------ */
  {
    const { parsePageHeader, coverGradientCss, defaultCoverFor, COVER_GRADIENTS, CONFLICTING_PLUGINS } = surface.pageHeader;
    const p = (fm, supports) => parsePageHeader(fm, supports);
    eq(p({ icon: "🚀" }).icon, "🚀", "icon: emoji");
    eq(p({ icon: "LiRocket" }).icon, null, "icon: Iconize id ignored");
    eq(p({ icon: "中" }).icon, null, "icon: a CJK character is not an emoji");
    eq(p({ icon: "🇨🇳" }).icon, "🇨🇳", "icon: a flag");
    eq(p({ icon: ["📚"] }).icon, "📚", "icon: list");
    eq(p({ icon: 5 }).icon, null, "icon: a number");
    eq(p(null), { icon: null, cover: null, coverY: 50 }, "no frontmatter");
    const cover = (value, supports) => p({ cover: value }, supports).cover;
    eq(cover("[[a.png]]"), { kind: "image", link: "a.png" }, "cover: wikilink");
    eq(cover("![[b.jpg|x]]"), { kind: "image", link: "b.jpg" }, "cover: embed with alias");
    eq(cover("![](<my img.png>)"), { kind: "image", link: "my img.png" }, "cover: Markdown image, <…>");
    eq(cover("![](my%20img.png)"), { kind: "image", link: "my img.png" }, "cover: Markdown image, %20");
    eq(cover("![x](https://x/y.png)"), { kind: "url", url: "https://x/y.png" }, "cover: Markdown image with a URL");
    eq(cover("img/c.webp"), { kind: "image", link: "img/c.webp" }, "cover: vault path");
    eq(cover("https://x/y.png"), { kind: "url", url: "https://x/y.png" }, "cover: URL");
    eq(cover("#abc"), { kind: "color", css: "#abc" }, "cover: hex");
    eq(cover("#abcdef80"), { kind: "color", css: "#abcdef80" }, "cover: hex with alpha");
    eq(cover("#abcde"), null, "cover: bad hex");
    eq(cover("rgb(1, 2, 3)"), { kind: "color", css: "rgb(1, 2, 3)" }, "cover: rgb()");
    eq(cover("oklch(70% 0.1 200 / 50%)"), { kind: "color", css: "oklch(70% 0.1 200 / 50%)" }, "cover: oklch()");
    eq(cover("url(javascript:1)"), null, "cover: url() refused");
    eq(cover("color-mix(in srgb, url(x) 50%, red)"), null, "cover: url() inside a function refused");
    eq(cover("red; color: blue"), null, "cover: a second declaration refused");
    eq(cover('rgb(1,2,3)"'), null, "cover: quotes refused");
    eq(cover("teal"), null, "cover: bare name without a checker");
    eq(cover("teal", (v) => v === "teal"), { kind: "color", css: "teal" }, "cover: bare name the browser knows");
    eq(cover("tealish", (v) => v === "teal"), null, "cover: unknown bare name");
    eq(cover("just text"), null, "cover: text");
    eq(cover(["[[a.png]]", "x"]), { kind: "image", link: "a.png" }, "cover: list, first string");
    eq(cover([["a.png"]]), { kind: "image", link: "a.png" }, "cover: unquoted [[a.png]] (YAML nested list)");
    eq(p({ "cover-style": "mist" }).cover, { kind: "gradient", id: "mist" }, "cover-style");
    eq(p({ "cover-style": "Sea-Salt" }).cover, { kind: "gradient", id: "sea-salt" }, "cover-style: case-insensitive");
    eq(p({ "cover-style": "neon" }).cover, null, "cover-style: unknown");
    eq(p({ cover: "#abc", "cover-style": "dawn" }).cover, { kind: "color", css: "#abc" }, "a valid cover wins");
    eq(p({ cover: "nonsense", "cover-style": "dawn" }).cover, { kind: "gradient", id: "dawn" }, "an invalid cover falls back to cover-style");
    const y = (value) => p({ "cover-y": value }).coverY;
    eq([y(40), y("40"), y("40%"), y(-5), y(500), y("x"), y(undefined), y(33.6), y([70])], [40, 40, 40, 0, 100, 50, 50, 34, 70], "cover-y");

    eq(COVER_GRADIENTS.map((g) => g.id), ["dawn", "mist", "sea-salt", "dusk", "aurora", "ink", "forest", "paper"], "gradient ids, fixed order");
    for (const gradient of COVER_GRADIENTS) {
      ok(gradient.name.en && gradient.name.zh, `gradient ${gradient.id}: named in both languages`);
      const css = coverGradientCss(gradient.id);
      ok(css.startsWith("linear-gradient("), `gradient ${gradient.id}: a linear gradient`);
      const vars = css.match(/var\([^)]*\)/g) ?? [];
      ok(vars.length >= 2 && vars.every((v) => /^var\(--nf-(gray|red|orange|yellow|green|cyan|blue|purple|pink)-rgb\)$/.test(v)), `gradient ${gradient.id}: palette tokens only`);
      ok(!/#|rgb\(\d/.test(css), `gradient ${gradient.id}: no literal colours`);
    }
    eq(coverGradientCss("neon"), null, "unknown gradient");
    const ids = new Set(COVER_GRADIENTS.map((g) => g.id));
    eq(defaultCoverFor("notes/a.md"), defaultCoverFor("notes/a.md"), "defaultCoverFor is stable");
    const picks = new Set(Array.from({ length: 40 }, (_, i) => defaultCoverFor(`notes/n${i}.md`)));
    ok([...picks].every((id) => ids.has(id)), "defaultCoverFor: always a valid id");
    ok(picks.size >= 5, "defaultCoverFor: notes get varied covers");
    eq(defaultCoverFor(""), defaultCoverFor(""), "defaultCoverFor: empty path");
    ok(["obsidian-banners", "pexels-banner", "obsidian-icon-folder"].every((id) => CONFLICTING_PLUGINS.includes(id)), "conflicting plugins");
    eq(surface.pageHeader.PAGE_COVER_STYLE_PROP, "cover-style", "property names");

    // The header's lifecycle, driven through its private methods with fakes
    // (the in-app runs cover the real DOM).
    const { PageHeader } = surface.pageHeader;
    const fakeDoc = () => {
      const doc = { body: { tag: "body" }, listeners: [] };
      doc.activeElement = doc.body;
      doc.addEventListener = (type, fn, capture) => doc.listeners.push([type, fn, !!capture]);
      doc.removeEventListener = (type, fn, capture) => { doc.listeners = doc.listeners.filter((l) => !(l[0] === type && l[1] === fn && l[2] === !!capture)); };
      return doc;
    };
    const fakeEl = (doc, extra = {}) => ({
      ownerDocument: doc, isConnected: true, classes: new Set(), attrs: {}, style: {}, focused: [],
      addClass(c) { this.classes.add(c); }, removeClass(c) { this.classes.delete(c); },
      setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener() {}, removeEventListener() {}, remove() { this.isConnected = false; },
      focus(options) { this.focused.push(options ?? null); doc.activeElement = this; },
      querySelector: () => null,
      ...extra,
    });
    const makeMount = (doc, view, mode) => ({
      view, mode, target: {}, el: fakeEl(doc), scroller: null, observer: { disconnect() {} }, resize: null, height: 0,
    });
    {
      // review2-surfmod-7: closing the tab mid-Reposition removes the capture Escape listener.
      const doc = fakeDoc();
      const view = { editor: { cm: { requestMeasure() {} } } };
      const header = new PageHeader({ app: { workspace: {} } }, { enabled: () => true });
      const mount = makeMount(doc, view, "lp");
      header.mounts.set(mount.target, mount);
      const img = { style: {} };
      header.toggleReposition(mount, fakeEl(doc), img, fakeEl(doc), 40);
      eq(doc.listeners.map(([type, , capture]) => [type, capture]), [["keydown", true]], "Reposition listens for Esc on the document");
      header.unmount(mount);
      eq(doc.listeners, [], "unmounting its header ends Reposition: no Esc listener left behind");
      eq([header.reposition, img.style.objectPosition, header.mounts.size], [null, "50% 40%", 0], "and forgets the detached header, the image back at its stored focus");
      const other = makeMount(doc, view, "lp");
      header.mounts.set(other.target, other);
      header.toggleReposition(mount, fakeEl(doc), img, fakeEl(doc), 40);
      header.unmount(other);
      eq(doc.listeners.length, 1, "another header's unmount leaves a Reposition alone");
      header.reposition.cancel();
      eq(doc.listeners, [], "Esc path still cleans up");
    }
    {
      // review2-surfmod-6: the icon picker's close hands the focus back.
      const doc = fakeDoc();
      const log = [];
      const view = { editor: { focus: () => log.push("editor"), cm: { requestMeasure() {} } } };
      let active = view;
      const app = { workspace: { getActiveViewOfType: () => active } };
      const header = new PageHeader({ app }, { enabled: () => true });
      const lp = makeMount(doc, view, "lp");
      header.mounts.set(lp.target, lp);
      header.restoreFocus(lp);
      eq(log, ["editor"], "Live Preview: focus lost with the picker → the editor (its selection is kept)");
      doc.activeElement = { tag: "input" };
      header.restoreFocus(lp);
      eq(log, ["editor"], "focus already elsewhere (a click on another control): left there");
      doc.activeElement = null;
      active = { other: true };
      header.restoreFocus(lp);
      eq(log, ["editor"], "another view is active: nothing");
      active = view;
      header.mounts.delete(lp.target);
      header.restoreFocus(lp);
      eq(log, ["editor"], "a header already unmounted: nothing");
      const icon = fakeEl(doc);
      const rv = makeMount(doc, view, "rv");
      const selectors = [];
      rv.el.querySelector = (selector) => (selectors.push(selector), icon);
      header.mounts.set(rv.target, rv);
      doc.activeElement = doc.body;
      header.restoreFocus(rv);
      eq([log, selectors, icon.focused], [["editor"], ['.nf-page-icon, [data-action="add-icon"]'], [{ preventScroll: true }]], "Reading view: the header's icon control, without scrolling");
    }
  }

  /* ------------------------------------------------------------------ */
  /* Block colour                                                        */
  /* ------------------------------------------------------------------ */
  if (surface.blockColor) {
    const {
      setBlockBgMarker, findBlockBgMarker, blockColorSupport, blockBgMarkers, blockTextColorChanges,
      currentBlockColors, blockColorMenuLabel, makeBlockBackgroundPlugin, blockBgClass, BLOCK_BG_CLASS, COLOR_LABEL_KEYS,
    } = surface.blockColor;
    const BLUE_MARK = '<span class="nf-blk-blue"></span>';
    const RED_MARK = '<span class="nf-blk-red"></span>';
    const RED = "var(--nf-red, #b5554d)";
    const BLUE = "var(--nf-blue, #4a7ca6)";
    eq([BLOCK_BG_CLASS, blockBgClass("blue")], ["nf-blk-bg", "nf-blk-blue"], "classes");

    // setBlockBgMarker
    const set = setBlockBgMarker;
    eq(set("para", "blue"), 'para <span class="nf-blk-blue"></span>', "marker: paragraph");
    eq(set("- item", "blue"), '- item <span class="nf-blk-blue"></span>', "marker: list item");
    eq(set("- [ ] task", "blue"), '- [ ] task <span class="nf-blk-blue"></span>', "marker: task");
    eq(set("> quote", "blue"), '> quote <span class="nf-blk-blue"></span>', "marker: quote");
    eq(set("1. x", "blue"), '1. x <span class="nf-blk-blue"></span>', "marker: numbered item");
    eq(set('para <span class="nf-blk-red"></span>', "blue"), 'para <span class="nf-blk-blue"></span>', "marker: red → blue");
    eq(set('para <span class="nf-blk-red"></span>', null), "para", "marker: removed with its space");
    eq(set("para", null), "para", "marker: removing none changes nothing");
    eq(set(set("para ^abc", "blue"), "blue"), 'para <span class="nf-blk-blue"></span> ^abc', "marker: idempotent");
    eq(set("para ^abc", "blue"), 'para <span class="nf-blk-blue"></span> ^abc', "marker: before the block id");
    eq(set('para <span class="nf-blk-blue"></span> ^abc', null), "para ^abc", "marker: removed, id kept");
    eq(set("para  ", "blue"), 'para <span class="nf-blk-blue"></span>  ', "marker: a hard break's two spaces survive");
    eq(set("- ", "blue"), '- <span class="nf-blk-blue"></span>', "marker: empty item, no extra space");
    eq(set('- <span class="nf-blk-blue"></span>', null), "- ", "marker: empty item restored");
    eq(set("  - child", "green"), '  - child <span class="nf-blk-green"></span>', "marker: nested item");
    eq(set(`para ${RED_MARK}${BLUE_MARK}`, "pink"), 'para <span class="nf-blk-pink"></span>', "marker: stacked markers collapse to one");
    for (const line of ["## H", "> [!note] T", "```js", "| a |", "---", "![[a.png]]", '<small class="nf-caption" data-nf-kind="image">cap</small>', "^abc", "", "   ", "$$", "<div>x</div>"]) {
      eq(set(line, "blue"), null, `marker: ${JSON.stringify(line)} takes no background`);
    }
    eq(set('## H <span class="nf-blk-blue"></span>', null), "## H", "marker: removal works on any line");
    const inCode = 'use `<span class="nf-blk-red"></span>` here';
    eq(findBlockBgMarker(inCode), null, "marker mid-line (inline code) is text");
    eq(set(inCode, null), inCode, "marker mid-line left alone on removal");
    eq(set(inCode, "blue"), inCode + ' <span class="nf-blk-blue"></span>', "marker mid-line left alone on insert");
    // findBlockBgMarker agrees with setBlockBgMarker.
    for (const line of ["para", "- item ^x1", "> q  ", "- "]) {
      const marked = set(line, "cyan");
      const found = findBlockBgMarker(marked);
      eq(found?.hue, "cyan", `find agrees: ${JSON.stringify(line)}`);
      eq(marked.slice(0, found.from) + marked.slice(found.to), set(marked, null), `find range = what removal takes: ${JSON.stringify(line)}`);
    }
    eq(findBlockBgMarker('x <span class="nf-blk-teal"></span>'), null, "only the nine palette hues");
    // Footnote definitions keep their label first; link references and
    // setext headings take no marker (review2-surfmod-2).
    eq(set("[^1]: The footnote text.", "blue"), '[^1]: The footnote text. <span class="nf-blk-blue"></span>', "marker: footnote definition");
    eq(set("[^1]: Text ^fn", "blue"), '[^1]: Text <span class="nf-blk-blue"></span> ^fn', "marker: footnote definition with a block id");
    eq(set("[^1]:", "blue"), '[^1]: <span class="nf-blk-blue"></span>', "marker: empty footnote definition");
    eq(set('[ref]: https://example.com "Title"', "blue"), null, "marker: link reference definition refused");
    eq(set("Title", "blue", "==="), null, "marker: setext heading refused");
    eq(set("Title", "blue", "-"), null, "marker: setext heading (a lone -) refused");
    eq(set("Title", "blue", "- "), 'Title <span class="nf-blk-blue"></span>', "marker: a paragraph over a list item");
    eq(set('Title <span class="nf-blk-blue"></span>', null, "==="), "Title", "marker: removal works over an underline");
    // A backslash ending the line is a hard break: the marker goes before
    // it, so it stays the line's last character (review2-surfmod-4).
    const BS = "\\";
    eq(set(`Line one${BS}`, "blue"), `Line one<span class="nf-blk-blue"></span>${BS}`, "marker: before a hard break's backslash, no space");
    eq(set(`Line one<span class="nf-blk-blue"></span>${BS}`, "red"), `Line one<span class="nf-blk-red"></span>${BS}`, "marker: recoloured before the backslash");
    eq(set(`Line one<span class="nf-blk-blue"></span>${BS}`, null), `Line one${BS}`, "marker: removed, the hard break kept");
    eq(set(`Line one <span class="nf-blk-blue"></span>${BS}`, null), `Line one${BS}`, "marker: removed with a space before it");
    eq(set(`Line one ${BS}`, "blue"), `Line one <span class="nf-blk-blue"></span>${BS}`, "marker: a space before the backslash is kept");
    eq(set(set(`Line one${BS}`, "blue"), "blue"), set(`Line one${BS}`, "blue"), "marker: idempotent before a backslash");
    eq(set(`- C:${BS}Users${BS}me${BS}`, "green"), `- C:${BS}Users${BS}me<span class="nf-blk-green"></span>${BS}`, "marker: a path ending in a backslash reads the same");
    eq(set(`two${BS}${BS}`, "blue"), `two${BS}${BS} <span class="nf-blk-blue"></span>`, "marker: an escaped backslash is text, the marker goes after it");
    eq(set(`foo${BS} ^abc`, "blue"), `foo${BS} <span class="nf-blk-blue"></span> ^abc`, "marker: a backslash before a block id is text");
    eq(set(`foo${BS}  `, "blue"), `foo${BS} <span class="nf-blk-blue"></span>  `, "marker: a backslash before a two-space break is text");
    eq(findBlockBgMarker(`para <span class="nf-blk-blue"></span>${BS}`), { hue: "blue", from: 4, to: 4 + 1 + BLUE_MARK.length }, "find: a marker before the hard break");
    eq(findBlockBgMarker(`para<span class="nf-blk-blue"></span>${BS}`), { hue: "blue", from: 4, to: 4 + BLUE_MARK.length }, "find: a marker hugging the hard break");
    eq(findBlockBgMarker(`para <span class="nf-blk-blue"></span>${BS}${BS}`), null, "find: a marker before an escaped backslash is mid-line");
    eq(findBlockBgMarker(`para <span class="nf-blk-blue"></span>${BS} x`), null, "find: a marker before other text is mid-line");
    for (const line of [`Line one${BS}`, `- item${BS}`, `> quoted${BS}`]) {
      const marked = set(line, "cyan");
      const found = findBlockBgMarker(marked);
      eq(found?.hue, "cyan", `find agrees: ${JSON.stringify(line)}`);
      eq(marked.slice(0, found.from) + marked.slice(found.to), set(marked, null), `find range = what removal takes: ${JSON.stringify(line)}`);
      eq(set(marked, null), line, `round trip: ${JSON.stringify(line)}`);
    }
    for (const line of ["[^1]: note", "[^1]:"]) {
      const marked = set(line, "cyan");
      const found = findBlockBgMarker(marked);
      eq(marked.slice(0, found.from) + marked.slice(found.to), set(marked, null), `find range = what removal takes: ${JSON.stringify(line)}`);
    }

    // blockColorSupport
    const BOTH = { text: true, background: true };
    const TEXT = { text: true, background: false };
    const NONE = { text: false, background: false };
    const support = [
      ["para", BOTH], ["- item", BOTH], ["- [x] done", BOTH], ["> quote", BOTH], ["- ", BOTH], ["  - nested", BOTH],
      ['<span style="color:var(--nf-red, #b5554d)">x</span>', BOTH], ["#tag at start", BOTH],
      ["## Heading", TEXT], ["> ## Quoted heading", TEXT], ["#", TEXT],
      ["", NONE], ["  ", NONE], ["```js", NONE], ["~~~", NONE], ["$$", NONE], ["| a | b |", NONE], ["---", NONE], ["* * *", NONE],
      ["^abc", NONE], ['<small class="nf-caption" data-nf-kind="table">t</small>', NONE], ["![[a.png]]", NONE], ["![alt](b.png)", NONE],
      ["<div>", NONE], ["<details>", NONE], ["> [!tip] T", NONE], ["> > [!note]- T", NONE],
    ];
    for (const [line, expected] of support) eq(blockColorSupport(line), expected, `support: ${JSON.stringify(line)}`);

    // Definitions and setext headings (review2-surfmod-2).
    const definitions = [
      ["[^1]: The footnote text.", BOTH], ["[^long note]: x", BOTH], ["[^1]:", BOTH], ["- [^1]: in a list", BOTH],
      ['[ref]: https://example.com "Title"', NONE], ["[ref]:/url", NONE], ["[ref]:", NONE], ["[a\\]b]: /u", NONE],
      ["> [ref]: /u", NONE], ["- [site]: https://x", NONE], ["- [x]: done", NONE],
      ["[[note]]: text", BOTH], ["[text][ref] and more", BOTH], ["[text](url): colon", BOTH], ["[ref] : spaced", BOTH],
    ];
    for (const [line, expected] of definitions) eq(blockColorSupport(line), expected, `support: ${JSON.stringify(line)}`);
    // What Obsidian (1.13, metadataCache and Reading view) reads as a setext
    // heading: `===`/`---`/`-` alone and flush; `=== ` and `  ===` are text,
    // `- ` a list item; inside a list the underline sits under the item's text.
    const setext = [
      ["Title", "===", TEXT], ["Title", "=", TEXT], ["Title", "-", TEXT], ["Title", "--", TEXT], ["Title", "---", TEXT], ["  Title", "===", TEXT],
      ["> T", "> ===", TEXT], ["> > T", "> > ---", TEXT], ["- a", "  ===", TEXT], ["- a", "\t===", TEXT], ["- a", "  -", TEXT],
      ["- [ ] t", "  ===", TEXT], ["1. a", "   ===", TEXT], ["  - child", "    ---", TEXT], ["para ^abc", "===", TEXT],
      ["Title", "- ", BOTH], ["Title", "=== ", BOTH], ["Title", "-- ", BOTH], ["Title", "  ===", BOTH], ["Title", "\t===", BOTH],
      ["Title", "   ---", BOTH], ["Title", "\\===", BOTH], ["Title", "=-=", BOTH], ["> T", "===", BOTH], ["T", "> ===", BOTH],
      ["- a", "-", BOTH], ["- a", "===", BOTH], ["- a", "  - ", BOTH], ["1. a", "  ===", BOTH], ["Title", "next", BOTH],
      ["Title", "", BOTH], ["Title", undefined, BOTH], ["Title", null, BOTH],
      ["## H", "===", TEXT], ["| a |", "===", NONE], ["[ref]: /u", "===", NONE], ["", "===", NONE],
    ];
    for (const [line, next, expected] of setext) eq(blockColorSupport(line, next), expected, `support: ${JSON.stringify(line)} over ${JSON.stringify(next)}`);

    // The eligibility contract with R2-W3-MAIN (review2-surfmod-3): HTML
    // blocks are CommonMark's, so the host needs no `^\s*<` rule of its own;
    // the plugin's own inline tags at the start of a line do not count.
    const html = [
      ["<p>x</p>", NONE], ["<ul>", NONE], ["</div>", NONE], ["<h2 id=a>T</h2>", NONE], ["<blockquote>", NONE], ["<script>", NONE],
      ["<style>", NONE], ["<textarea>", NONE], ["<!-- note -->", NONE], ["<?php x ?>", NONE], ["<!DOCTYPE html>", NONE], ["<![CDATA[x]]>", NONE],
      ["<span>", NONE], ['<span style="color:red">', NONE], ["</span>", NONE], ["<br>", NONE], ["<br/>  ", NONE], ["<img src=x>", NONE],
      ["> <div>", NONE], ["- <table>", NONE], ["%% comment %%", NONE], ["%%", NONE],
      ['<span class="nf-cmt" data-nf-cmt="n">para</span> tail', BOTH], ['<span style="color:var(--nf-red, #b5554d)">x</span>', BOTH],
      ["<mark>hi</mark> there", BOTH], ["<u>x</u>", BOTH], ["<kbd>Ctrl</kbd> + C", BOTH], ["<span>x</span>", BOTH], ["<pretty> text", BOTH],
      ["<b>bold</b>", BOTH], ["a < b", BOTH], ["<3 you", BOTH], ["text %% inline %%", BOTH],
    ];
    for (const [line, expected] of html) eq(blockColorSupport(line), expected, `support: ${JSON.stringify(line)}`);
    const recolorLine = (line, css) => {
      const state = EditorState.create({ doc: line });
      return state.update({ changes: blockTextColorChanges(state.doc, { startLine: 1, endLine: 1 }, css) }).state.doc.toString();
    };
    // A block keeps its Block color after its first text colour, so the
    // colour can still be changed or removed from the menu.
    for (const start of ["para", "- item", "> quote", "## Heading", "[^1]: note"]) {
      const coloured = recolorLine(start, "var(--nf-red, #b5554d)");
      ok(coloured.includes('<span style="color:var(--nf-red, #b5554d)">'), `coloured: ${JSON.stringify(start)}`);
      eq(blockColorSupport(coloured), blockColorSupport(start), `support survives a text colour: ${JSON.stringify(coloured)}`);
      eq(blockColorSupport(set(coloured, "blue") ?? coloured), blockColorSupport(start), `support survives a background too: ${JSON.stringify(start)}`);
    }
    // A blank line has nothing to colour: no marker is written there (the
    // host's slash path shows "Nothing to color in this block").
    for (const blank of ["", "   ", "\t"]) {
      eq(blockColorSupport(blank), NONE, `blank ${JSON.stringify(blank)}: no colour offered`);
      eq(set(blank, "blue"), null, `blank ${JSON.stringify(blank)}: no marker`);
    }
    // An empty item or quote line is a block of its own: it takes the marker.
    eq([set("- ", "blue"), set("> ", "blue")], ['- <span class="nf-blk-blue"></span>', '> <span class="nf-blk-blue"></span>'], "empty item and quote line take a marker");

    // blockBgMarkers
    const markerDoc = docOf([
      "---", `k: v ${BLUE_MARK}`, "---",
      `para ${RED_MARK}`,
      "```", `code ${BLUE_MARK}`, "```",
      `- item ${BLUE_MARK} ^id1`,
      "  ~~~~", `  x ${BLUE_MARK}`, "  ~~~", `  y ${BLUE_MARK}`, "  ~~~~",
      `after ${RED_MARK}`,
    ].join("\n"));
    const markers = blockBgMarkers(markerDoc);
    eq(markers, [{ line: 4, hue: "red" }, { line: 8, hue: "blue" }, { line: 14, hue: "red" }], "markers: frontmatter and fences skipped (a shorter closer does not close)");
    ok(blockBgMarkers(markerDoc) === markers, "markers: cached per document");

    // blockTextColorChanges, applied for real.
    const recolor = (text, range, css) => {
      const state = EditorState.create({ doc: text });
      return state.update({ changes: blockTextColorChanges(state.doc, range, css) }).state.doc.toString();
    };
    const whole = (text) => ({ startLine: 1, endLine: text.split("\n").length });
    const W = (css, s) => `<span style="color:${css}">${s}</span>`;
    eq(recolor("para", whole("para"), RED), W(RED, "para"), "text colour: paragraph");
    eq(recolor("## T", whole("## T"), RED), '## <span style="color:var(--nf-red, #b5554d)">T</span>', "text colour: heading");
    eq(recolor("> - [ ] task", whole("x"), RED), `> - [ ] ${W(RED, "task")}`, "text colour: quoted task");
    eq(recolor("line one\nline two", whole("a\nb"), RED), `${W(RED, "line one")}\n${W(RED, "line two")}`, "text colour: every line of a paragraph");
    const LIST = "- item\n  continuation\n  - child\n  ```js\n  - not a list\n  ```\n  | a | b |";
    eq(recolor(LIST, whole(LIST), RED), `- ${W(RED, "item")}\n  ${W(RED, "continuation")}\n  - ${W(RED, "child")}\n  \`\`\`js\n  - not a list\n  \`\`\`\n  | a | b |`, "text colour: list item with continuation, child, nested fence and table");
    eq(recolor("para ^abc", whole("x"), RED), `${W(RED, "para")} ^abc`, "text colour: block id stays outside");
    eq(recolor(`para ${BLUE_MARK}`, whole("x"), RED), `${W(RED, "para")} ${BLUE_MARK}`, "text colour: background marker stays outside");
    eq(recolor(`para ${BLUE_MARK} ^abc`, whole("x"), RED), `${W(RED, "para")} ${BLUE_MARK} ^abc`, "text colour: marker and id outside");
    const redPara = `${W(RED, "para")}\n${W(RED, "two")}`;
    const toBlue = blockTextColorChanges(docOf(redPara), whole(redPara), BLUE);
    eq(toBlue.length, 2, "recolour: one change per line (the open tag)");
    eq(recolor(redPara, whole(redPara), BLUE), `${W(BLUE, "para")}\n${W(BLUE, "two")}`, "recolour: red → blue");
    eq(recolor(redPara, whole(redPara), null), "para\ntwo", "remove: both tags go");
    eq(blockTextColorChanges(docOf("para"), whole("x"), null), [], "remove without a wrap: nothing");
    eq(blockTextColorChanges(docOf("para"), whole("x"), "red;x"), [], "a css the tag matcher refuses: nothing");
    const inline = `${W(BLUE, "a")} b`;
    eq(blockTextColorChanges(docOf(inline), whole(inline), null), [], "an inline colour is not the block's");
    eq(recolor(inline, whole(inline), RED), W(RED, inline), "block colour wraps inline colours");
    const commented = '<span class="nf-cmt" data-nf-cmt="n">para</span>';
    eq(recolor(commented, whole("x"), RED), W(RED, commented), "a comment anchor is not a colour wrap");
    eq(recolor("$$\nx^2\n$$\nafter", whole("a\nb\nc\nd"), RED), `$$\nx^2\n$$\n${W(RED, "after")}`, "math lines skipped");
    eq(recolor("- ", whole("x"), RED), "- ", "empty content skipped");
    const sorted = blockTextColorChanges(docOf("a\nb"), whole("a\nb"), RED).map((c) => c.from);
    eq(sorted, [0, 1, 2, 3], "changes sorted by from");
    // review2-surfmod-2: definitions stay definitions, underlines stay underlines.
    eq(recolor("[^1]: The footnote text.", whole("x"), RED), `[^1]: ${W(RED, "The footnote text.")}`, "text colour: footnote body only");
    eq(recolor(`[^1]: ${W(RED, "x")}`, whole("x"), null), "[^1]: x", "text colour: footnote colour removed");
    eq(currentBlockColors(docOf(`[^1]: ${W(RED, "x")}`), { startLine: 1, endLine: 1 }), { text: RED, background: null }, "footnote: current text colour");
    const REFS = '[ref]: https://example.com "Title"\n[b]: /u';
    eq(recolor(REFS, whole(REFS), RED), REFS, "text colour: link reference definitions untouched");
    eq(recolor("Title\n===", whole("a\nb"), RED), `${W(RED, "Title")}\n===`, "text colour: setext heading, underline untouched");
    eq(recolor("Title\n-", whole("a\nb"), RED), `${W(RED, "Title")}\n-`, "text colour: setext (lone -), underline untouched");
    eq(recolor("> T\n> ---", whole("a\nb"), RED), `> ${W(RED, "T")}\n> ---`, "text colour: quoted setext heading");
    eq(recolor(`${W(RED, "Title")}\n===`, whole("a\nb"), null), "Title\n===", "text colour: setext colour removed");
    eq(recolor("para\n  ===", whole("a\nb"), RED), `${W(RED, "para")}\n  ${W(RED, "===")}`, "text colour: an indented === is paragraph text");
    eq(recolor("## H\n===", whole("a\nb"), RED), `## ${W(RED, "H")}\n${W(RED, "===")}`, "text colour: === under an ATX heading is a paragraph");
    // review2-surfmod-4: a last backslash stays outside the span, where it
    // escapes nothing and a hard break stays one.
    const B = "\\";
    const HB = `Line one ends with a hard break${B}\nline two`;
    eq(recolor(HB, whole(HB), RED), `${W(RED, "Line one ends with a hard break")}${B}\n${W(RED, "line two")}`, "text colour: hard break kept outside the span");
    eq(recolor(recolor(HB, whole(HB), RED), whole(HB), null), HB, "text colour: removed around a hard break");
    eq(recolor(recolor(HB, whole(HB), RED), whole(HB), BLUE), recolor(HB, whole(HB), BLUE), "text colour: recoloured around a hard break");
    eq(currentBlockColors(docOf(recolor(HB, whole(HB), RED)), whole(HB)), { text: RED, background: null }, "current colour read past the backslash");
    eq(recolor(`- Save to C:${B}Users${B}me${B}`, whole("x"), RED), `- ${W(RED, `Save to C:${B}Users${B}me`)}${B}`, "text colour: a path ending in a backslash");
    eq(recolor(`two${B}${B}`, whole("x"), RED), W(RED, `two${B}${B}`), "text colour: an escaped backslash stays inside");
    eq(recolor(`three${B}${B}${B}`, whole("x"), RED), `${W(RED, `three${B}${B}`)}${B}`, "text colour: an odd run gives up one backslash");
    eq(recolor(`foo${B} ^abc`, whole("x"), RED), `${W(RED, "foo")}${B} ^abc`, "text colour: a backslash before a block id");
    eq(recolor(`foo \\`, whole("x"), RED), `${W(RED, "foo")} ${B}`, "text colour: space and backslash stay outside");
    eq(recolor(`para <span class="nf-blk-blue"></span>${B}`, whole("x"), RED), `${W(RED, "para")} <span class="nf-blk-blue"></span>${B}`, "text colour: marker and hard break outside");
    eq(recolor(`para<span class="nf-blk-blue"></span>${B}`, whole("x"), RED), `${W(RED, "para")}<span class="nf-blk-blue"></span>${B}`, "text colour: hugging marker and hard break outside");
    eq(recolor(`para${B} <span class="nf-blk-blue"></span>`, whole("x"), RED), `${W(RED, "para")}${B} <span class="nf-blk-blue"></span>`, "text colour: a backslash before an old marker");
    eq(recolor(`- ${B}`, whole("x"), RED), `- ${B}`, "text colour: a lone backslash has nothing to colour");
    for (const line of [`Line one${B}`, `a${B}${B}${B}`, `x${B} ^id`]) {
      const out = recolor(line, whole("x"), RED);
      ok(!out.includes(`${B}</span>`) || out.includes(`${B}${B}</span>`), `no escaped close tag: ${JSON.stringify(out)}`);
    }

    // currentBlockColors
    eq(currentBlockColors(docOf(`${W(RED, "para")} ${BLUE_MARK}\n${W(RED, "two")}`), { startLine: 1, endLine: 2 }), { text: RED, background: "blue" }, "current colours");
    eq(currentBlockColors(docOf("para"), { startLine: 1, endLine: 1 }), { text: null, background: null }, "no colours");
    eq(currentBlockColors(docOf(`## ${W(RED, "T")}`), { startLine: 1, endLine: 1 }), { text: RED, background: null }, "heading text colour");
    eq(currentBlockColors(docOf(`${W(BLUE, "a")} b`), { startLine: 1, endLine: 1 }), { text: null, background: null }, "a partial colour is not the block's");

    // Menu labels, and the label keys against main.ts.
    eq([blockColorMenuLabel("red", "background"), blockColorMenuLabel("red", "text"), blockColorMenuLabel(null, "background")], ["Red background", "Red", "Default"], "menu labels");
    const mainText = readFileSync(join(root, "src/main.ts"), "utf8");
    const labelsBlock = /const COLOR_LABELS: Record<string, string> = \{([^}]*)\}/.exec(mainText)?.[1] ?? "";
    const mainLabels = Object.fromEntries([...labelsBlock.matchAll(/(\w+): "([^"]+)"/g)].map((m) => [m[1], m[2]]));
    ok(Object.keys(mainLabels).length === 9, "COLOR_LABELS parsed from main.ts");
    eq({ ...COLOR_LABEL_KEYS }, mainLabels, "COLOR_LABEL_KEYS mirror main.ts COLOR_LABELS");

    // The Live Preview plugin (the view-stub's fromClass returns the class).
    const decoOf = (text, rangeAt, options = { livePreview: () => true }, visible) => {
      const state = EditorState.create({ doc: text });
      const Plugin = makeBlockBackgroundPlugin(rangeAt, options);
      const view = { state, visibleRanges: visible ?? [{ from: 0, to: state.doc.length }] };
      return { plugin: new Plugin(view), state, view };
    };
    const lines = (plugin, state) => [...plugin.decorations].map((d) => [state.doc.lineAt(d.from).number, d.spec.class]);
    const LIST4 = `- a ${BLUE_MARK}\n  cont\n  - child\n  - child2\npara`;
    const flat = decoOf(LIST4, (_s, n) => (n === 1 ? { startLine: 1, endLine: 4 } : null));
    eq(lines(flat.plugin, flat.state), [
      [1, "nf-blk-bg nf-blk-blue nf-blk-first"], [2, "nf-blk-bg nf-blk-blue"], [3, "nf-blk-bg nf-blk-blue"], [4, "nf-blk-bg nf-blk-blue nf-blk-last"],
    ], "every line of the block, first and last marked");
    ok(flat.plugin.decorations.every((d) => d.kind === "line" && d.from === d.to), "line decorations");
    const NESTED = `- a ${BLUE_MARK}\n  cont\n  - child ${RED_MARK}\n    grand\n  - child2`;
    const nested = decoOf(NESTED, (_s, n) => ({ 1: { startLine: 1, endLine: 5 }, 3: { startLine: 3, endLine: 4 } })[n] ?? null);
    eq(lines(nested.plugin, nested.state), [
      [1, "nf-blk-bg nf-blk-blue nf-blk-first"], [2, "nf-blk-bg nf-blk-blue"],
      [3, "nf-blk-bg nf-blk-red nf-blk-first"], [4, "nf-blk-bg nf-blk-red nf-blk-last"],
      [5, "nf-blk-bg nf-blk-blue nf-blk-last"],
    ], "an inner block's own colour wins for its lines");
    eq(decoOf(LIST4, () => ({ startLine: 1, endLine: 4 }), { livePreview: () => false }).plugin.decorations.size, 0, "not Live Preview: nothing");
    eq(decoOf(LIST4, () => ({ startLine: 1, endLine: 4 }), {}).plugin.decorations.size, 0, "default check: no Live Preview field, nothing");
    const lone = decoOf(`para ${BLUE_MARK}\nnext`, () => null);
    eq(lines(lone.plugin, lone.state), [[1, "nf-blk-bg nf-blk-blue nf-blk-first nf-blk-last"]], "no block model: the marker's own line");
    const list4 = docOf(LIST4);
    const clipped = decoOf(LIST4, () => ({ startLine: 1, endLine: 4 }), undefined, [{ from: list4.line(2).from + 1, to: list4.line(3).to }]);
    eq(lines(clipped.plugin, clipped.state), [[2, "nf-blk-bg nf-blk-blue"], [3, "nf-blk-bg nf-blk-blue"]], "only visible lines; first/last stay the block's real ends");
    const quiet = console.error;
    console.error = () => {};
    let thrown = null;
    let broken;
    try {
      broken = decoOf(LIST4, () => { throw new Error("boom"); });
    } catch (error) {
      thrown = error;
    } finally {
      console.error = quiet;
    }
    eq(thrown, null, "a throwing block model does not throw");
    eq(broken.plugin.decorations.size, 0, "a throwing block model: no decorations");
    // update(): rebuilds on a document change, keeps the set otherwise.
    const live = decoOf(`para\nnext`, () => null);
    const before = live.plugin.decorations;
    eq(before.size, 0, "no marker yet");
    live.plugin.update({ docChanged: false, viewportChanged: false, state: live.state, startState: live.state, view: live.view });
    ok(live.plugin.decorations === before, "no change: same set");
    const next = live.state.update({ changes: { from: 4, insert: " " + BLUE_MARK } }).state;
    live.plugin.update({ docChanged: true, viewportChanged: false, state: next, startState: live.state, view: { state: next, visibleRanges: [{ from: 0, to: next.doc.length }] } });
    eq(lines(live.plugin, next), [[1, "nf-blk-bg nf-blk-blue nf-blk-first nf-blk-last"]], "a document change rebuilds");
  }

  /* ------------------------------------------------------------------ */
  /* Icon picker: data and pure helpers                                  */
  /* ------------------------------------------------------------------ */
  {
    const { CALLOUT_ICONS, NOTE_EMOJI, NOTE_EMOJI_RECENT_KEY, CALLOUT_ICON_PREFIX, CALLOUT_EMOJI_TOKEN, isEmojiChar, gridMove } = surface.iconPicker;
    eq(CALLOUT_ICONS.map((i) => i.name), [
      "lightbulb", "sparkles", "rocket", "star", "flag", "target",
      "pin", "bookmark", "book-open", "graduation-cap", "brain", "code-2",
      "link", "calendar", "clock", "check-circle-2", "alert-triangle", "info",
      "help-circle", "flame", "heart", "coffee", "map-pin", "quote",
    ], "24 callout icons in order");
    ok(CALLOUT_ICONS.every((i) => i.label.en && i.label.zh), "icons labelled in both languages");
    eq(NOTE_EMOJI.length, 48, "48 note emoji");
    eq(new Set(NOTE_EMOJI).size, 48, "no repeats");
    ok(NOTE_EMOJI.every((char) => isEmojiChar(char)), "every note emoji is one emoji");
    eq(NOTE_EMOJI.slice(0, 3), ["👍", "❤️", "🔥"], "the common set first");
    eq([NOTE_EMOJI_RECENT_KEY, CALLOUT_ICON_PREFIX, CALLOUT_EMOJI_TOKEN], ["nf-note-emoji-recent", "nfi-", "nfi-emoji"], "keys and tokens");
    ok(NOTE_EMOJI_RECENT_KEY !== "nf-canvas-emoji-recent", "not the canvas recents key");
    eq(["🚀", "🇨🇳", "👍🏽", "👩‍💻", "❤️", "中", "a", "1", "🚀🚀", "", "ab"].map(isEmojiChar),
      [true, true, true, true, true, false, false, false, false, false, false], "isEmojiChar");
    const moves = [
      [0, "ArrowRight", 1], [5, "ArrowRight", 6], [23, "ArrowRight", 23], [0, "ArrowLeft", 0], [7, "ArrowLeft", 6],
      [2, "ArrowDown", 8], [20, "ArrowDown", 23], [3, "ArrowUp", 0], [9, "ArrowUp", 3], [10, "Home", 0], [10, "End", 23], [10, "a", 10],
    ];
    for (const [from, key, to] of moves) eq(gridMove(from, key, 6, 24), to, `gridMove ${from} ${key}`);
    // A short last row (20 items: 6, 6, 6, 2).
    eq(gridMove(14, "ArrowDown", 6, 20), 19, "down into a short row lands on its last item");
    eq(gridMove(13, "ArrowDown", 6, 20), 19, "down from column 1 into the short row");
    eq(gridMove(12, "ArrowDown", 6, 20), 18, "down onto an existing cell");
    eq(gridMove(19, "ArrowDown", 6, 20), 19, "down from the last row stays");
    eq(gridMove(19, "ArrowUp", 6, 20), 13, "up from the short row");
    eq(gridMove(0, "End", 6, 0), 0, "an empty grid");

    // Callout header tokens.
    const { setCalloutIconToken, calloutIconFromMeta, currentCalloutIcon, CALLOUT_HEAD_RE } = surface.iconPicker;
    if (setCalloutIconToken) {
      const rocket = { kind: "lucide", name: "rocket" };
      const star = { kind: "lucide", name: "star" };
      const emoji = (char) => ({ kind: "emoji", char });
      const s = setCalloutIconToken;
      eq(s("> [!note] T", rocket), "> [!note|nfi-rocket] T", "icon: token added");
      eq(s("> [!tip|nf-green] T", rocket), "> [!tip|nf-green nfi-rocket] T", "icon: after the colour");
      eq(s("> [!tip|nfi-rocket nf-green] T", star), "> [!tip|nfi-star nf-green] T", "icon: replaced in place");
      eq(s("> [!nf-col|30 nf-red]", rocket), "> [!nf-col|30 nf-red nfi-rocket]", "icon: column width and colour kept");
      eq(s("> [!note]- T", rocket), "> [!note|nfi-rocket]- T", "icon: fold marker kept");
      eq(s("> > [!note] T", rocket), "> > [!note|nfi-rocket] T", "icon: nested callout");
      eq(s("> [!note]  two  spaces ", rocket), "> [!note|nfi-rocket]  two  spaces ", "icon: title text untouched");
      eq(s("> [!tip|nf-green nfi-rocket] Title", null), "> [!tip|nf-green] Title", "icon: default removes the token");
      eq(s("> [!tip|nfi-rocket]", null), "> [!tip]", "icon: no token left, no bar");
      eq(s("> [!tip|nf-green] Title", emoji("💡")), "> [!tip|nf-green nfi-emoji] 💡 Title", "emoji: token plus the emoji before the title");
      eq(s("> [!tip|nf-green nfi-emoji] 💡 Title", emoji("🚀")), "> [!tip|nf-green nfi-emoji] 🚀 Title", "emoji: replaces the leading emoji");
      eq(s("> [!tip|nf-green nfi-emoji] 💡 Title", rocket), "> [!tip|nf-green nfi-rocket] Title", "emoji → icon: the emoji goes");
      eq(s("> [!tip|nf-green nfi-emoji] 💡 Title", null), "> [!tip|nf-green] Title", "emoji → default: token and emoji go");
      eq(s("> [!note|nfi-emoji] 💡 Note", null), "> [!note]", "emoji → default: a title equal to the rendered default goes too");
      eq(s("> [!warning]", emoji("⚠️")), "> [!warning|nfi-emoji] ⚠️ Warning", "emoji on an empty title: the rendered default title");
      eq(s("> [!warning|nfi-emoji] ⚠️ Warning", null), "> [!warning]", "…and back");
      eq(s("> [!my-type]", emoji("💡")), "> [!my-type|nfi-emoji] 💡 My type", "rendered default: dashes become spaces");
      eq(s("> [!tip] 🎉 Party", emoji("💡")), "> [!tip|nfi-emoji] 💡 🎉 Party", "an emoji the user wrote is not ours");
      eq(s("> [!tip|nfi-emoji] Title", null), "> [!tip] Title", "emoji mode without an emoji: only the token goes");
      eq(s("> [!tip|nfi-emoji] 👩‍💻 Dev", emoji("🚀")), "> [!tip|nfi-emoji] 🚀 Dev", "a joined emoji is one character");
      eq(s("plain text", rocket), null, "not a header");
      eq(s("> quote", null), null, "a quote is not a header");
      // The colour writer (main.ts setCalloutMetaToken(line, "nf-", …)) never touches the icon.
      const recolour = (line, value) => {
        const m = CALLOUT_HEAD_RE.exec(line);
        const tokens = m[3].startsWith("|") ? m[3].slice(1, -1).trim().split(/\s+/).filter(Boolean) : [];
        const i = tokens.findIndex((token) => token.startsWith("nf-"));
        if (i >= 0) tokens[i] = value; else tokens.push(value);
        return line.slice(0, m[1].length + m[2].length) + (tokens.length ? `|${tokens.join(" ")}` : "") + line.slice(m[1].length + m[2].length + m[3].length - 1);
      };
      eq(recolour("> [!tip|nf-green nfi-rocket] T", "nf-blue"), "> [!tip|nf-blue nfi-rocket] T", "recolour keeps nfi-rocket");
      eq(recolour("> [!tip|nfi-rocket] T", "nf-blue"), "> [!tip|nfi-rocket nf-blue] T", "a first colour keeps nfi-rocket");
      eq(calloutIconFromMeta(["nf-green", "nfi-rocket"]), rocket, "meta: lucide");
      eq(calloutIconFromMeta(["nfi-emoji"]), { kind: "emoji" }, "meta: emoji");
      eq(calloutIconFromMeta(["nfi-zzz"]), null, "meta: unknown name");
      eq(calloutIconFromMeta(["30", "nf-red"]), null, "meta: none");
      eq(calloutIconFromMeta([]), null, "meta: empty");
      eq(currentCalloutIcon("> [!tip|nf-green nfi-rocket] T"), rocket, "current: lucide");
      eq(currentCalloutIcon("> [!tip|nfi-emoji] 💡 T"), emoji("💡"), "current: emoji");
      eq(currentCalloutIcon("> [!tip|nfi-emoji] T"), null, "current: emoji mode without an emoji");
      eq(currentCalloutIcon("> [!tip] 💡 T"), null, "current: the user's emoji is not an icon");
      eq(currentCalloutIcon("> [!tip] T"), null, "current: the type's icon");
      eq(currentCalloutIcon("para"), null, "current: not a header");
      // Drift guard: the copy must equal main.ts RE_CALLOUT_HEAD.
      const mainText = readFileSync(join(root, "src/main.ts"), "utf8");
      const literal = /const RE_CALLOUT_HEAD = \/(.+)\/;\n/.exec(mainText)?.[1];
      ok(literal, "RE_CALLOUT_HEAD found in main.ts");
      eq(CALLOUT_HEAD_RE.source, literal, "CALLOUT_HEAD_RE is a byte-identical copy of RE_CALLOUT_HEAD");
    }
  }

  /* ------------------------------------------------------------------ */
  /* What's new                                                          */
  /* ------------------------------------------------------------------ */
  if (surface.whatsNew) {
    const { WHATS_NEW_ITEMS, whatsNewRows, tourFolder, tourFiles, createTourNote, noticeLink, RELEASES_URL } = surface.whatsNew;
    eq(RELEASES_URL, "https://github.com/xinli12/obsidian-notion-flow/releases/latest", "release notes URL");
    eq(WHATS_NEW_ITEMS.map((i) => i.id), ["note-style", "style-switcher", "link-card", "block-color", "callout-icons", "page-header", "comments-list", "tables-captions"], "highlights, in order");
    ok(WHATS_NEW_ITEMS.every((i) => i.title.en && i.title.zh && i.body.en && i.body.zh && i.icon), "every highlight is written in both languages");
    ok(WHATS_NEW_ITEMS.every((i) => !i.action || i.action.settings === true || i.action.command.startsWith("notion-flow:")), "commands are the plugin's own");
    ok(WHATS_NEW_ITEMS.every((i) => i.body.en.includes("{chord}") === !!i.chord && i.body.zh.includes("{chord}") === !!i.chord), "{chord} exactly where a chord is given");
    const available = (id) => id !== "notion-flow:change-note-style";
    const rows = whatsNewRows({ version: "1.6.0", onTour() {}, run() {} }, available);
    eq(rows.map((r) => [r.id, r.action]), [
      ["note-style", null], ["style-switcher", null], ["link-card", { command: "notion-flow:insert-link" }],
      ["block-color", { command: "notion-flow:open-block-menu" }], ["callout-icons", null], ["page-header", null],
      ["comments-list", { command: "notion-flow:show-comments" }], ["tables-captions", null],
    ], "Try it only for available commands; no settings action without openSettings");
    eq(whatsNewRows({ version: "1", onTour() {}, run() {}, openSettings() {} }, available)[0].action, { settings: true }, "the settings row with openSettings");
    eq(rows[2].body, "Ctrl+K edits a link's text and destination in a small card, opens it or unlinks it.", "{chord} replaced (non-Mac stub)");
    eq(rows[6].body, "Show comments in this note lists them; Enter jumps, Ctrl+↩ resolves.", "{chord} replaced as the comments list prints it");
    eq(rows[0].title, "Note style: palettes and looks", "EN titles");

    // Try it: close first, then run on the next frame; a command that
    // cannot run (no editor) or that reports false gets a Notice.
    {
      const { WhatsNewModal } = surface.whatsNew;
      const order = [];
      let ready = null;
      const app = { commands: { findCommand: (id) => ({ id, checkCallback: () => ready }) } };
      let runResult = true;
      const options = {
        version: "1.6.0", onTour() {},
        run(id) { order.push(["run", id]); return runResult; },
        openSettings() { order.push(["settings"]); },
      };
      const modal = new WhatsNewModal(app, options);
      modal.contentEl = { ownerDocument: { defaultView: { requestAnimationFrame: (cb) => { order.push(["frame"]); cb(); } } } };
      modal.close = () => order.push(["close"]);
      globalThis.__nfNotices = [];
      modal.tryIt({ command: "notion-flow:insert-link" });
      eq(order, [["close"], ["frame"]], "no editor: closed, nothing run");
      eq(globalThis.__nfNotices, ["Open a note first, then try again."], "no editor: a Notice");
      order.length = 0;
      ready = true;
      modal.tryIt({ command: "notion-flow:insert-link" });
      eq(order, [["close"], ["frame"], ["run", "notion-flow:insert-link"]], "an editor: closed, then run on the next frame");
      eq(globalThis.__nfNotices.length, 1, "no Notice when it ran");
      runResult = false;
      modal.tryIt({ command: "notion-flow:insert-link" });
      eq(globalThis.__nfNotices.length, 2, "the host reporting false: a Notice");
      order.length = 0;
      modal.tryIt({ settings: true });
      eq(order, [["close"], ["frame"], ["settings"]], "the settings row opens the settings");
    }

    // The tour files.
    const folder = tourFolder();
    eq(folder, "Notion Flow tour", "tour folder");
    const files = tourFiles();
    eq(files.map((f) => f.path), ["Notion Flow tour/Notion Flow tour.md", "Notion Flow tour/Mind map.canvas"], "two files in the folder");
    const note = files[0].content;
    ok(note.startsWith("---\nicon: 🧭\ncover-style: aurora\n---\n"), "the tour shows off its own icon and cover");
    ok(note.split("\n").length <= 70, "the tour stays short");
    for (const heading of ["## 1. Blocks", "## 2. Slash menu", "## 3. Color", "## 4. Callouts", "## 5. Comments", "## 6. Page icon, cover and style", "## 7. Note style", "## 8. Canvas mind maps", "## 9. Shortcuts"]) {
      ok(note.includes(`\n${heading}\n`), `tour section ${heading}`);
    }
    ok(note.includes("[[Mind map.canvas]]"), "the tour links its canvas");
    ok(note.includes("**Show comments in this note**"), "comments command named");
    // The note is synced to every platform: its chords never depend on this
    // machine (review2-surfmod-8), while the modal rows, drawn at run time, do.
    ok(note.includes("press Cmd/Ctrl+Shift+M to ") && note.includes("Enter jumps to it, Cmd/Ctrl+Enter resolves it."), "platform-neutral chords");
    ok(!/[⌘⇧⌥⌃↩]/.test(note), "no platform key glyphs in the note");
    surface.Platform.isMacOS = true;
    try {
      eq(tourFiles(), files, "macOS writes the very same tour files");
      const macRows = whatsNewRows({ version: "1", onTour() {}, run() {} }, available);
      ok(macRows[2].body.startsWith("⌘K edits") && macRows[6].body.endsWith("Enter jumps, ⌘↩ resolves."), `the modal prints this platform's chords: ${macRows[6].body}`);
    } finally {
      surface.Platform.isMacOS = false;
    }
    // US spelling in the English UI and tour (review2-i18n-w2-06).
    const enCopy = [...WHATS_NEW_ITEMS.flatMap((i) => [i.title.en, i.body.en]), note, files[1].content];
    for (const text of enCopy) ok(!/colour/i.test(text), `US spelling: ${text.slice(0, 40)}`);
    eq(rows[3].title, "Block color", "the Block color row is named as its menu item");
    eq(rows[3].body, "Color a whole block's text or background from its ⋮⋮ menu, or type /red or /blue background.", "Block color body");
    if (surface.comments) {
      const found = surface.comments.collectComments(docOf(note));
      eq(found.map((c) => [c.anchorText, c.note]), [["comment on them", "Comments live in the note itself, as plain HTML."]], "the tour's comment anchor round-trips");
    }
    if (surface.blockColor) {
      const lines = note.split("\n");
      const marked = surface.blockColor.blockBgMarkers(docOf(note));
      eq(marked.map((m) => m.hue), ["blue"], "the tour carries one block background");
      ok(lines[marked[0].line - 1].startsWith("Select words and pick a color"), "on the colour paragraph");
    }
    const calloutLine = note.split("\n").find((l) => l.startsWith("> [!"));
    eq(surface.iconPicker.currentCalloutIcon(calloutLine), { kind: "lucide", name: "rocket" }, "the tour's callout has the rocket icon");
    const canvas = JSON.parse(files[1].content);
    eq([canvas.nodes.length, canvas.edges.length], [4, 3], "canvas: a root and three children");
    const canvasIds = [...canvas.nodes, ...canvas.edges].map((x) => x.id);
    eq(new Set(canvasIds).size, 7, "canvas: unique ids");
    ok(canvasIds.every((id) => /^[0-9a-f]{16}$/.test(id)), "canvas: 16-hex ids");
    ok(canvas.nodes.every((n) => n.type === "text" && n.width === 260 && n.height === 60 && n.text), "canvas: text cards 260×60");
    eq(canvas.nodes[0].text, "Notion Flow", "canvas: the root");
    ok(canvas.edges.every((e) => e.fromNode === canvas.nodes[0].id && canvas.nodes.some((n) => n.id === e.toNode)), "canvas: every edge from the root to a child");
    for (const file of files) {
      for (const line of file.content.split("\n")) {
        ok(!/\b(title|desc):\s*["'`]/.test(line) && !/["'`](Canvas|Table): /.test(line), `no coverage-scanner trap in ${file.path}: ${line.slice(0, 40)}`);
      }
    }

    // createTourNote with a map-backed vault.
    const vaultFiles = new Map();
    const folders = new Set();
    const log = [];
    const opened = [];
    let failing = false;
    const app = {
      vault: {
        getAbstractFileByPath: (path) => vaultFiles.get(path) ?? (folders.has(path) ? { path, children: [] } : null),
        async createFolder(path) { log.push(["folder", path]); folders.add(path); },
        async create(path, content) {
          if (failing) throw new Error("disk full");
          log.push(["file", path]);
          const file = { stubFile: true, path, content };
          vaultFiles.set(path, file);
          return file;
        },
      },
      workspace: { getLeaf: (kind) => ({ async openFile(file) { opened.push([kind, file.path]); } }) },
    };
    globalThis.__nfNotices = [];
    const first = await createTourNote(app);
    eq(log, [["folder", "Notion Flow tour"], ["file", "Notion Flow tour/Notion Flow tour.md"], ["file", "Notion Flow tour/Mind map.canvas"]], "first run: the folder and both files");
    eq(first?.path, "Notion Flow tour/Notion Flow tour.md", "returns the note");
    eq(opened, [["tab", "Notion Flow tour/Notion Flow tour.md"]], "opens the note in a new tab");
    eq(globalThis.__nfNotices, ["Tour notes created in Notion Flow tour"], "and says where");
    const second = await createTourNote(app);
    eq(log.length, 3, "second run: nothing created, nothing overwritten");
    ok(second === first, "second run: the same note");
    eq(opened.length, 2, "second run: opened again");
    eq(globalThis.__nfNotices.length, 1, "second run: no created Notice");
    vaultFiles.delete("Notion Flow tour/Mind map.canvas");
    await createTourNote(app);
    eq(log.at(-1), ["file", "Notion Flow tour/Mind map.canvas"], "a missing file is written again");
    eq(vaultFiles.get("Notion Flow tour/Notion Flow tour.md"), first, "the existing note is kept");
    vaultFiles.clear();
    failing = true;
    const quiet = console.error;
    console.error = () => {};
    let failed;
    try {
      failed = await createTourNote(app);
    } finally {
      console.error = quiet;
    }
    eq(failed, null, "a failed write returns null");
    eq(globalThis.__nfNotices.at(-1), "Could not create the tour notes.", "and says so");

    // noticeLink.
    const calls = [];
    const container = Object.assign(new EventTarget(), {
      classes: [], attrs: {}, style: {},
      addClass(c) { this.classes.push(c); },
      setAttribute(k, v) { this.attrs[k] = v; },
    });
    const spans = [];
    const notice = { containerEl: container, messageEl: { createSpan(o) { spans.push(o); } }, hide() { calls.push("hide"); } };
    noticeLink(notice, () => calls.push("click"));
    eq([container.classes, container.style.cursor, container.attrs.role], [["nf-notice-link"], "pointer", "button"], "the notice reads as a link");
    eq(spans, [{ cls: "nf-notice-arrow", text: " →" }], "an arrow after the message");
    container.dispatchEvent(new Event("click"));
    eq(calls, ["hide", "click"], "a click hides the notice, then runs the action");
    noticeLink({ hide() {} }, () => {});
    ok(true, "a notice without elements is left alone");

    // The Chinese copy: what the modal shows and what the tour writes into
    // the vault follow the glossary (review2-i18n-w2-01, -03): mind-map
    // topics are 主题 / 子主题, a note look is 版式 as in the note-style UI.
    const zh = surfaceZh.whatsNew;
    const zhRows = zh.whatsNewRows({ version: "1.6.0", onTour() {}, run() {} }, available);
    eq([zhRows[0].title, zhRows[0].body], ["笔记样式：配色与版式", "九套配色、六种版式，一次统一标注、标题、表格、引用与代码。"], "ZH note-style row");
    eq(zhRows[1].body, "在命令面板里实时预览配色与版式，按 Esc 保留当前样式。", "ZH switcher row");
    const zhFiles = zh.tourFiles();
    eq(zhFiles.map((f) => f.path), ["Notion Flow 导览/Notion Flow 导览.md", "Notion Flow 导览/思维导图.canvas"], "ZH tour files");
    const zhNote = zhFiles[0].content;
    ok(zhNote.includes("提供九套配色、六种版式，统一标注、标题、表格、引用与代码。"), "ZH tour: 版式");
    ok(zhNote.includes("打开 [[思维导图.canvas]]。选中卡片后按 Tab 新建子主题。在卡片里输入时，Enter 结束编辑；之后再按 Enter 新建下一张卡片，按 Tab 新建子主题。Shift+Enter 换行。"), "ZH tour: the canvas keys");
    ok(zhNote.includes("选中文字后按 Cmd/Ctrl+Shift+M 即可") && zhNote.includes("Enter 跳转，Cmd/Ctrl+Enter 解决。"), "ZH tour: platform-neutral chords");
    eq(JSON.parse(zhFiles[1].content).nodes.map((n) => n.text), ["Notion Flow", "Tab 新建子主题", "Enter 完成，再按一次新建下一张", "Shift+Enter 换行"], "ZH tour canvas cards");
    ok(!/[⌘⇧⌥⌃↩]/.test(zhNote), "ZH tour: no platform key glyphs");
    // run-i18n-coverage's glossary, over the literals it cannot see (tl() and vault text).
    const GLOSSARY = [
      [/(子|同级|父)节点/, "mind-map items are 主题 / 子主题"], [/外观/, "a note look is 版式"], [/转换为/, "Turn into is 转为"],
      [/解除批注|「解除」/, "Resolve is 解决"], [/[一-龥],|,(?=[一-龥])/, "full-width ，"], [/[一-龥]\(/, "full-width （"], [/[“”]/, "quote with 「」"],
    ];
    const zhCopy = [...zhRows.flatMap((r) => [r.title, r.body]), ...zhNote.split("\n"), ...JSON.parse(zhFiles[1].content).nodes.map((n) => n.text)];
    const offences = zhCopy.flatMap((text) => GLOSSARY.filter(([re]) => re.test(text)).map(([, rule]) => `${rule}: ${text.slice(0, 50)}`));
    eq(offences, [], "the ZH What's new rows and tour files follow the glossary");
  }

  /* ------------------------------------------------------------------ */
  /* i18n guard                                                          */
  /* ------------------------------------------------------------------ */
  {
    const ALLOWED = new Set([
      "Show comments in this note", "Search comments", "No comments in this note", "Jump to comment", "Resolve comment",
      "Page style", "Page font: Default", "Page font: Serif", "Page font: Mono", "Page font: Kai",
      "Small text", "Full width", "Toggle small text", "Toggle full width", "Default", "Serif", "Kai", "Mono",
      "Add icon", "Add cover", "Change cover", "Remove cover", "Remove icon", "Image from vault…", "Reposition",
      "Background color", "{color} background", "Block color", "Text color", "Remove color",
      "Gray", "Red", "Orange", "Yellow", "Green", "Cyan", "Blue", "Purple", "Pink",
      "Icon", "Icon…", "Default icon", "Search icons", "Recent",
      "What's new in Notion Flow {version}", "Try it", "Create tour notes in my vault", "Release notes on GitHub",
      "Tour notes created in {folder}", "What's new", "Close",
    ]);
    // Quote-aware: "What's new" holds an apostrophe.
    const RE_T = /(?<![\w$.])t\(\s*(["'`])((?:(?!\1)[^\\])+)\1/g;
    for (const [name, path] of MODULES) {
      const text = readFileSync(join(root, path), "utf8");
      for (const m of text.matchAll(RE_T)) ok(ALLOWED.has(m[2]), `${name}: t("${m[2]}") is a pinned key`);
      ok(!/\b(?:title|desc):\s*["'`]/.test(text), `${name}: no title:/desc: literal (coverage-scanner trap)`);
    }
  }

  console.log(`PASS surface modules: ${checks} checks`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
