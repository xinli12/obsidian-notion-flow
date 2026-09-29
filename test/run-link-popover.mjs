import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { EditorState } from "@codemirror/state";
import { openLinkPopover, linkPendingEffect } from "./bundle.mjs";

// The link card driven the way the editor drives it: through a real
// EditorOperationScope whose lifecycle cancels stale cards inside the
// dispatch, rather than with bare callbacks (which is how the card once
// shipped closing its own operation before writing).
const directory = await mkdtemp(join(tmpdir(), "notion-flow-link-popover-"));
try {
  const outfile = join(directory, "link-popover.mjs");
  await build({
    stdin: {
      contents: [
        "export { LinkPopover, rankLinkTargets, placePopover } from './ui/link-popover';",
        "export { EditorOperationScope, operationLifecycle } from './editor/operation-scope';",
        "export * from './core/markdown-links';",
      ].join("\n"),
      loader: "ts",
      resolveDir: fileURLToPath(new URL("../src/", import.meta.url)),
    },
    bundle: true, format: "esm", platform: "node", outfile, logLevel: "silent",
    external: ["@codemirror/state"],
    alias: {
      obsidian: fileURLToPath(new URL("./obsidian-stub.mjs", import.meta.url)),
      "@codemirror/view": fileURLToPath(new URL("./view-stub.mjs", import.meta.url)),
    },
  });
  const {
    LinkPopover, rankLinkTargets, placePopover, EditorOperationScope, operationLifecycle,
    enclosingMarkdownLink, rewriteMarkdownLink, unlinkMarkdownLink, normalizeLinkDest,
  } = await import(pathToFileURL(outfile).href);

  /* ---- a small event-capable DOM fixture (as run-markdown-links) ---- */
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
    // Recorded too, so a test can call a listener directly and see what it
    // throws (EventTarget reports listener errors as uncaught instead).
    addEventListener(type, listener, options) {
      ((this.listeners ??= {})[type] ??= []).push(listener);
      super.addEventListener(type, listener, options);
    }
  }
  function makeDoc(opts = {}) {
    const doc = Object.assign(new EventTarget(), { elements: [] });
    doc.defaultView = Object.assign(new EventTarget(), {
      innerWidth: 1000, innerHeight: 800,
      navigator: { clipboard: { readText: async () => opts.clip ?? "" } },
    });
    doc.body = new Element(doc, "body");
    return doc;
  }
  const helpers = (f) => {
    f.card = () => f.doc.elements.filter((el) => el.options.cls === "nf-link-pop").at(-1);
    f.input = (kind) => f.doc.elements.filter((el) => el.tag === "input" && el.options.cls?.includes(`nf-link-${kind}`)).at(-1);
    f.button = (cls) => f.doc.elements.filter((el) => el.tag === "button" && el.options.cls?.includes(cls)).at(-1);
    f.hint = () => f.doc.elements.filter((el) => el.options.cls === "nf-link-hint").at(-1);
    f.type = (kind, value) => { f.input(kind).value = value; f.input(kind).dispatchEvent(new Event("input")); };
    f.key = (kind, key, extra = {}) => {
      const event = new Event("keydown", { cancelable: true });
      Object.assign(event, { key, ...extra });
      f.input(kind).dispatchEvent(event);
    };
    f.click = (cls) => f.button(cls).dispatchEvent(new Event("click"));
    return f;
  };
  /** A fake EditorView whose dispatch runs the operation lifecycle, as the
   * real ViewPlugin does on every update. */
  function makeView(source, selection, doc, scope) {
    let state = EditorState.create({ doc: source, selection });
    let lifecycle = null;
    const view = {
      get state() { return state; },
      dom: { ownerDocument: doc, isConnected: true, closest: () => null },
      coordsAtPos: () => ({ left: 100, top: 200, bottom: 220 }),
      focus() {},
      dispatch(spec) { state = state.update(spec).state; lifecycle?.update(); },
    };
    lifecycle = new (operationLifecycle(scope))(view);
    return view;
  }

  /* ---- Part A: LinkPopover wired to a real operation scope, mirroring openLinkPopover ---- */
  function editorFixture(source, anchor, head = anchor, opts = {}) {
    const doc = makeDoc(opts);
    const scope = new EditorOperationScope();
    const view = makeView(source, { anchor, head }, doc, scope);
    const f = helpers({ doc, view, scope, file: "A.md", closed: 0, reasons: [], openDuringSave: [], openDuringUnlink: [] });
    const sel = view.state.selection.main;
    const line = view.state.doc.lineAt(sel.from);
    const link = enclosingMarkdownLink(line.text, sel.from - line.from, sel.to - line.from);
    let pop = null;
    const operation = (f.operation = scope.capture(view, () => f.file, { onCancel: () => pop?.close() }));
    const settle = (from, to, insert, caret, selectText) => view.dispatch({
      changes: { from, to, insert },
      selection: selectText ? { anchor: from, head: caret } : { anchor: caret },
    });
    pop = f.pop = new LinkPopover({
      doc,
      anchor: () => view.coordsAtPos(sel.from),
      text: link?.text ?? view.state.doc.sliceString(sel.from, sel.to),
      dest: link?.dest ?? "",
      hasLink: link != null,
      onSave: (text, dest) => {
        f.openDuringSave.push(pop.isOpen);
        if (!operation.isCurrent()) return;
        const target = normalizeLinkDest(dest);
        const label = text.trim() || target;
        if (link) {
          const next = rewriteMarkdownLink(line.text, link, { text: label, dest: target });
          const insert = next.slice(link.start, next.length - (line.text.length - link.end));
          settle(line.from + link.start, line.from + link.end, insert, line.from + link.start + insert.length, false);
          return;
        }
        const insert = `[${label}](${target})`;
        settle(sel.from, sel.to, insert, sel.from + insert.length, false);
      },
      onOpen: () => {},
      onUnlink: link
        ? () => {
            f.openDuringUnlink.push(pop.isOpen);
            if (!operation.isCurrent()) return;
            const plain = unlinkMarkdownLink(line.text, link);
            const insert = plain.slice(link.start, plain.length - (line.text.length - link.end));
            settle(line.from + link.start, line.from + link.end, insert, line.from + link.start + insert.length, true);
          }
        : undefined,
      onClose: (reason) => { f.closed++; f.reasons.push(reason); operation.finish(); },
    });
    pop.open();
    return f;
  }
  const SENTENCE = "Some text to link right here please.";
  const LINKED = "Some text to [link right](https://obsidian.md) here please.";
  const selectWords = (text, words) => [text.indexOf(words), text.indexOf(words) + words.length];

  {
    // 1. Enter on a selection writes [text](dest), caret after the link, card gone.
    const f = editorFixture(SENTENCE, ...selectWords(SENTENCE, "link right"));
    assert.equal(f.doc.activeElement, f.input("dest"), "linking a selection focuses the destination");
    f.input("dest").value = "https://obsidian.md";
    f.key("dest", "Enter");
    assert.equal(f.view.state.doc.toString(), LINKED, "Enter writes the link");
    assert.equal(f.view.state.selection.main.head, LINKED.indexOf(")") + 1, "caret right after the link");
    assert.equal(f.view.state.selection.main.empty, true);
    assert.equal(f.card().removed, true, "the card is removed");
    assert.equal(f.pop.isOpen, false);
    assert.equal(f.closed, 1, "onClose fires exactly once");
    assert.equal(f.operation.isCurrent(), false, "the operation is over");
    assert.deepEqual(f.openDuringSave, [true], "onSave runs while the card is still open");
  }
  {
    // 2. The Save button does the same.
    const f = editorFixture(SENTENCE, ...selectWords(SENTENCE, "link right"));
    f.input("dest").value = "https://obsidian.md";
    f.click("mod-cta");
    assert.equal(f.view.state.doc.toString(), LINKED, "Save writes the link");
    assert.equal(f.card().removed, true);
    assert.equal(f.closed, 1);
  }
  {
    // Rewriting an existing link keeps its title and puts the caret after it.
    const source = 'See [docs](https://ex.com "T") now.';
    const f = editorFixture(source, 6);
    assert.equal(f.input("text").value, "docs");
    assert.equal(f.input("dest").value, "https://ex.com");
    f.input("dest").value = "https://ex.org";
    f.key("text", "Enter");
    assert.equal(f.view.state.doc.toString(), 'See [docs](https://ex.org "T") now.');
    assert.equal(f.view.state.selection.main.head, 'See [docs](https://ex.org "T")'.length);
    assert.equal(f.closed, 1);
  }
  {
    // 3. Unlink replaces the link with its text, and selects that text.
    const source = "See [docs page](https://example.com/docs) now.";
    const f = editorFixture(source, 7);
    f.click("mod-warning");
    assert.equal(f.view.state.doc.toString(), "See docs page now.");
    const { from, to } = f.view.state.selection.main;
    assert.equal(f.view.state.doc.sliceString(from, to), "docs page", "the unlinked text is selected");
    assert.equal(f.card().removed, true);
    assert.equal(f.closed, 1);
    assert.deepEqual(f.openDuringUnlink, [true], "onUnlink runs while the card is still open");
  }
  {
    // 4. A stale card (the note was switched) writes nothing; it is already closed.
    const f = editorFixture(SENTENCE, ...selectWords(SENTENCE, "link right"));
    f.input("dest").value = "https://obsidian.md";
    f.file = "B.md";
    f.scope.check();
    assert.equal(f.card().removed, true, "a stale card closes at once");
    assert.equal(f.closed, 1);
    f.key("dest", "Enter");
    assert.equal(f.view.state.doc.toString(), SENTENCE, "no write from a stale card");
    assert.equal(f.closed, 1);
  }
  {
    // A card whose document was edited elsewhere writes nothing either.
    const f = editorFixture(SENTENCE, ...selectWords(SENTENCE, "link right"));
    f.input("dest").value = "https://obsidian.md";
    f.view.dispatch({ changes: { from: 0, insert: "X" } });
    assert.equal(f.card().removed, true, "an edit elsewhere closes the card");
    f.key("dest", "Enter");
    assert.equal(f.view.state.doc.toString(), "X" + SENTENCE);
  }
  {
    // A throwing callback cannot leave an orphaned card behind.
    const doc = makeDoc();
    let closed = 0;
    const pop = new LinkPopover({
      doc, anchor: { left: 0, top: 0, bottom: 20 }, text: "t", dest: "d", hasLink: true,
      onSave: () => { throw new Error("boom"); },
      onUnlink: () => { throw new Error("boom"); },
      onClose: () => closed++,
    });
    const f = helpers({ doc, pop });
    const call = (el, type, event) => () => el.listeners[type].forEach((listener) => listener(event));
    pop.open();
    const enter = Object.assign(new Event("keydown", { cancelable: true }), { key: "Enter" });
    assert.throws(call(f.input("dest"), "keydown", enter), /boom/);
    assert.equal(pop.isOpen, false, "the card still closes");
    assert.equal(closed, 1);
    pop.open();
    assert.throws(call(f.button("mod-warning"), "click", new Event("click")), /boom/);
    assert.equal(pop.isOpen, false);
    assert.equal(closed, 2);
  }
  {
    // 5. Esc closes without writing and ends the operation.
    const f = editorFixture(SENTENCE, ...selectWords(SENTENCE, "link right"));
    f.input("dest").value = "https://obsidian.md";
    f.key("dest", "Escape");
    assert.equal(f.view.state.doc.toString(), SENTENCE);
    assert.equal(f.operation.isCurrent(), false);
    assert.equal(f.closed, 1);
    // …and so does an outside click.
    const g = editorFixture(SENTENCE, ...selectWords(SENTENCE, "link right"));
    g.input("dest").value = "https://obsidian.md";
    const outside = new Event("mousedown");
    outside.composedPath = () => [g.doc.body, g.doc];
    g.doc.dispatchEvent(outside);
    assert.equal(g.card().removed, true);
    assert.equal(g.view.state.doc.toString(), SENTENCE);
    assert.equal(g.closed, 1);
  }

  {
    // item 18: onClose says why the card closed, once. Escape is what
    // brings the toolbar back over the selection in openLinkPopover.
    const esc = editorFixture(SENTENCE, ...selectWords(SENTENCE, "link right"));
    esc.key("dest", "Escape");
    assert.deepEqual(esc.reasons, ["escape"], "Escape in a field");
    const onButton = editorFixture(SENTENCE, ...selectWords(SENTENCE, "link right"));
    onButton.card().dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" }));
    assert.deepEqual(onButton.reasons, ["escape"], "Escape with a button focused");
    const composing = editorFixture(SENTENCE, ...selectWords(SENTENCE, "link right"));
    composing.key("dest", "Escape", { isComposing: true });
    assert.deepEqual(composing.reasons, [], "an IME composition keeps its Escape");
    composing.pop.close();
    const out = editorFixture(SENTENCE, ...selectWords(SENTENCE, "link right"));
    const click = new Event("mousedown");
    click.composedPath = () => [out.doc.body, out.doc];
    out.doc.dispatchEvent(click);
    assert.deepEqual(out.reasons, ["outside"], "a click outside");
    const save = editorFixture(SENTENCE, ...selectWords(SENTENCE, "link right"));
    save.input("dest").value = "https://obsidian.md";
    save.key("dest", "Enter");
    assert.equal(save.view.state.doc.toString(), LINKED);
    assert.deepEqual(save.reasons, ["save"], "Save, although its own write cancelled the operation first");
    const unlink = editorFixture("See [docs page](https://example.com/docs) now.", 7);
    unlink.click("mod-warning");
    assert.deepEqual(unlink.reasons, ["unlink"], "Unlink");
    const stale = editorFixture(SENTENCE, ...selectWords(SENTENCE, "link right"));
    stale.file = "B.md";
    stale.scope.check();
    assert.deepEqual(stale.reasons, ["cancel"], "a stale card");
    const replaced = editorFixture(SENTENCE, ...selectWords(SENTENCE, "link right"));
    editorFixture(SENTENCE, ...selectWords(SENTENCE, "link right"));
    assert.deepEqual(replaced.reasons, ["cancel"], "a card replaced by a new one");
    LinkPopover.closeActive();
    const after = editorFixture(SENTENCE, ...selectWords(SENTENCE, "link right"));
    after.input("dest").value = "https://obsidian.md";
    after.key("dest", "Enter");
    const next = editorFixture(SENTENCE, ...selectWords(SENTENCE, "link right"));
    next.key("dest", "Escape");
    assert.deepEqual(next.reasons, ["escape"], "a save does not leak into the next card's reason");
  }

  /* ---- Part B: the real openLinkPopover from src/main.ts ---- */
  function pluginFixture(source, anchor, head = anchor, before = null) {
    const doc = makeDoc();
    const operations = new EditorOperationScope();
    const view = makeView(source, { anchor, head }, doc, operations);
    before?.(view);
    const leaf = { view: { editor: { cm: view }, file: { path: "A.md" } } };
    const plugin = {
      operations,
      app: {
        workspace: { getLeavesOfType: () => [leaf], openLinkText: async () => {}, getLastOpenFiles: () => [] },
        vault: { getFiles: () => [], getConfig: () => false },
        metadataCache: { fileToLinktext: (file) => file.path, getFirstLinkpathDest: () => null },
      },
    };
    const f = helpers({ doc, view, operations, leaf, plugin });
    openLinkPopover(view, plugin);
    return f;
  }
  {
    const f = pluginFixture(SENTENCE, ...selectWords(SENTENCE, "link right"));
    assert.equal(f.card().removed, undefined, "the card is open");
    f.input("dest").value = "https://obsidian.md";
    f.key("dest", "Enter");
    assert.equal(f.view.state.doc.toString(), LINKED, "openLinkPopover: Enter writes the link");
    assert.equal(f.view.state.selection.main.head, LINKED.indexOf(")") + 1);
    assert.equal(f.card().removed, true);
  }
  {
    const f = pluginFixture(SENTENCE, ...selectWords(SENTENCE, "link right"));
    f.input("dest").value = "https://obsidian.md";
    f.click("mod-cta");
    assert.equal(f.view.state.doc.toString(), LINKED, "openLinkPopover: Save writes the link");
  }
  {
    const source = "See [docs page](https://example.com/docs) now.";
    const f = pluginFixture(source, 7);
    f.input("dest").value = "https://example.org";
    f.key("dest", "Enter");
    assert.equal(f.view.state.doc.toString(), "See [docs page](https://example.org) now.", "openLinkPopover: rewrite");
    const g = pluginFixture(source, 7);
    g.click("mod-warning");
    assert.equal(g.view.state.doc.toString(), "See docs page now.", "openLinkPopover: Unlink");
    const { from, to } = g.view.state.selection.main;
    assert.equal(g.view.state.doc.sliceString(from, to), "docs page");
  }
  {
    const f = pluginFixture(SENTENCE, ...selectWords(SENTENCE, "link right"));
    f.input("dest").value = "https://obsidian.md";
    f.leaf.view.file.path = "B.md";
    f.operations.check();
    assert.equal(f.card().removed, true, "openLinkPopover: a switched note closes the card");
    f.key("dest", "Enter");
    assert.equal(f.view.state.doc.toString(), SENTENCE, "openLinkPopover: no stale write");
  }
  {
    const f = pluginFixture(SENTENCE, ...selectWords(SENTENCE, "link right"));
    f.input("dest").value = "https://obsidian.md";
    f.key("dest", "Escape");
    assert.equal(f.card().removed, true);
    assert.equal(f.view.state.doc.toString(), SENTENCE, "openLinkPopover: Esc writes nothing");
  }

  {
    // review3-MODS-6: a card opened over an open one (the command run from
    // the palette or a hotkey while a card is up) keeps its own tint: the
    // closed card's deferred clear no longer wipes it.
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    /** Every tint the view is sent: [from, to], or null for a clear. */
    const logTints = (log) => (view) => {
      const dispatch = view.dispatch.bind(view);
      view.dispatch = (spec) => {
        for (const effect of [spec.effects ?? []].flat()) {
          if (effect.is(linkPendingEffect)) log.push(effect.value && [effect.value.from, effect.value.to]);
        }
        return dispatch(spec);
      };
    };
    const [from, to] = selectWords(SENTENCE, "link right");
    const log = [];
    const f = pluginFixture(SENTENCE, from, to, logTints(log));
    assert.deepEqual(log, [[from, to]], "MODS-6: the first card tints its words");
    const first = f.card();
    openLinkPopover(f.view, f.plugin);
    assert.equal(first.removed, true, "MODS-6: the first card closed");
    assert.notEqual(f.card(), first, "MODS-6: a second card is open");
    await tick();
    assert.deepEqual(log, [[from, to], [from, to]], "MODS-6: the second card's tint outlives the first card's deferred clear");
    f.key("dest", "Escape");
    await tick();
    assert.deepEqual(log.at(-1), null, "MODS-6: closing the second card clears its tint");
    // A card closed on its own still clears its tint.
    const alone = [];
    const g = pluginFixture(SENTENCE, from, to, logTints(alone));
    g.key("dest", "Escape");
    await tick();
    assert.deepEqual(alone, [[from, to], null], "MODS-6: one card: tint, then clear");
  }
  {
    // item 18: a selection over text and a wikilink writes ONE link over
    // the grown span, its text the flattened display text — never nested.
    const source = "see [[x|the x]] here and more";
    const f = pluginFixture(source, 0, "see [[x|the".length);
    assert.equal(f.input("text").value, "see the x", "the card's text is flattened");
    f.input("dest").value = "https://obsidian.md";
    f.key("dest", "Enter");
    assert.equal(f.view.state.doc.toString(), "[see the x](https://obsidian.md) here and more", "one link over text + wikilink");
    assert.ok(!f.view.state.doc.toString().includes("[["), "no wikilink left inside the link");
    // Inside a Source-mode table row the written label keeps the cell whole.
    const row = "| a b | c |";
    const g = pluginFixture(row, 2, 5);
    g.input("text").value = "x|y";
    g.input("dest").value = "https://obsidian.md";
    g.key("dest", "Enter");
    assert.equal(g.view.state.doc.toString(), "| [x\\|y](https://obsidian.md) | c |", "review-MOD-1: pipes escaped in a row");
    // Escape hands the selection back untouched.
    const h = pluginFixture(source, 0, 3);
    h.key("dest", "Escape");
    assert.equal(h.view.state.doc.toString(), source);
    assert.deepEqual([h.view.state.selection.main.from, h.view.state.selection.main.to], [0, 3], "the selection is kept");
  }

  /* ---- the card on its own: note search, Open, hint and placement ---- */
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  function cardFixture(opts = {}) {
    const doc = makeDoc(opts);
    const f = helpers({ doc, saved: [], opened: [], closed: 0 });
    const before = (globalThis.__nfInputSuggests ??= []).length;
    f.pop = new LinkPopover({
      doc, anchor: opts.anchor ?? { left: 100, top: 200, bottom: 220 },
      text: opts.text ?? "", dest: opts.dest ?? "", hasLink: opts.hasLink ?? false,
      kind: opts.kind, app: opts.app, sourcePath: "A.md", bounds: opts.bounds,
      onSave: (text, dest) => f.saved.push([text, dest]),
      onOpen: (dest) => f.opened.push(dest),
      onUnlink: () => {},
      onClose: () => f.closed++,
    });
    f.pop.open();
    f.suggest = globalThis.__nfInputSuggests.length > before ? globalThis.__nfInputSuggests.at(-1) : null;
    f.open = () => f.button("nf-link-open");
    return f;
  }
  const file = (path) => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const dot = name.lastIndexOf(".");
    return { path, name, basename: name.slice(0, dot), extension: name.slice(dot + 1) };
  };
  const files = ["notes/demo.md", "notes/b-demo.md", "demo-folder/x.md", "img/demo.png", "other.md"].map(file);
  const app = {
    vault: { getFiles: () => files },
    workspace: { getLastOpenFiles: () => ["notes/b-demo.md"] },
    metadataCache: { fileToLinktext: (f, source, omitMd) => (omitMd ? f.path.replace(/\.md$/, "") : f.path) },
  };
  const paths = (list) => list.map((f) => f.path);

  {
    // Note search: gated until the destination is typed into, then ranked.
    const f = cardFixture({ text: "link right", app });
    assert.ok(f.suggest, "a suggester when the app is known");
    assert.equal(f.suggest.textInputEl, f.input("dest"), "…on the destination field");
    assert.equal(f.suggest.limit, 8);
    assert.equal(f.suggest.suggestEl.style.zIndex, "calc(var(--layer-menu, 65) + 2)", "the list renders above the card");
    assert.deepEqual(f.suggest.getSuggestions("demo"), [], "no list before any typing (a prefilled dest keeps Enter)");
    f.type("dest", "demo");
    assert.deepEqual(paths(f.suggest.getSuggestions("demo")),
      ["notes/demo.md", "img/demo.png", "notes/b-demo.md", "demo-folder/x.md"], "a note named exactly the query first (a note before an attachment), then recent, then by match");
    for (const query of ["https://x.test", "", "  ", "<a b>", "Note#h", "a|b", "mailto:x@y.z"]) {
      assert.deepEqual(f.suggest.getSuggestions(query), [], `no list for ${JSON.stringify(query)}`);
    }
    // Picking a note fills the destination and the empty text, and keeps the card.
    f.suggest.open();
    f.type("dest", "");
    assert.equal(f.open().style.display, "none");
    f.input("text").value = "";
    f.suggest.selectSuggestion(files[0], new Event("click"));
    assert.equal(f.input("dest").value, "notes/demo.md", "Markdown links keep .md");
    assert.equal(f.input("text").value, "demo", "an empty text takes the note's name");
    assert.equal(f.open().style.display, "", "Open shows for the picked note");
    assert.equal(f.suggest.isOpen, false, "the list closes");
    assert.equal(f.pop.isOpen, true, "the card stays open");
    assert.equal(f.doc.activeElement, f.input("dest"), "focus stays in the destination");
    assert.equal(f.hint().text, "");
    assert.deepEqual(f.suggest.getSuggestions("notes/demo.md"), [], "a pick re-arms the gate");
    f.key("dest", "Enter");
    assert.deepEqual(f.saved, [["demo", "notes/demo.md"]], "the next Enter saves");
  }
  {
    const f = cardFixture({ text: "keep", app, kind: "wiki" });
    f.type("dest", "de");
    f.suggest.selectSuggestion(files[0], new Event("click"));
    assert.equal(f.input("dest").value, "notes/demo", "wikilinks drop .md");
    assert.equal(f.input("text").value, "keep", "typed text is never replaced");
    const g = cardFixture({ app });
    g.type("dest", "img");
    g.suggest.selectSuggestion(files[3], new Event("click"));
    assert.equal(g.input("text").value, "demo.png", "an attachment is named with its extension");
    LinkPopover.closeActive();
  }
  {
    // A click on the list (outside the card) must not close the card.
    const f = cardFixture({ text: "t", app });
    const onList = new Event("mousedown");
    onList.composedPath = () => [{}, f.suggest.suggestEl, f.doc.body, f.doc];
    f.doc.dispatchEvent(onList);
    assert.equal(f.pop.isOpen, true, "clicking a suggestion keeps the card");
    const onOther = new Event("mousedown");
    onOther.composedPath = () => [{ classList: { contains: (c) => c === "suggestion-container" } }, f.doc.body];
    f.doc.dispatchEvent(onOther);
    assert.equal(f.pop.isOpen, true, "any suggestion container counts as the list");
    f.suggest.open();
    f.pop.close();
    assert.equal(f.suggest.isOpen, false, "closing the card closes its list");
    assert.equal(f.closed, 1);
    const before = globalThis.__nfInputSuggests.length;
    const n = cardFixture({ text: "t" });
    assert.equal(n.suggest, null, "no app, no suggester");
    assert.equal(globalThis.__nfInputSuggests.length, before);
    LinkPopover.closeActive();
  }

  /* ---- rankLinkTargets with a deterministic matcher ---- */
  {
    const prepare = (q) => (text) => (text.includes(q) ? { score: -text.indexOf(q) } : null);
    const list = ["a/zzfoo.md", "foo.md", "b/foo.md", "c/foo.md", "foo/bar.md", "long/path/foo.md"].map(file);
    assert.deepEqual(paths(rankLinkTargets("foo", list, [], prepare)),
      ["foo.md", "b/foo.md", "c/foo.md", "long/path/foo.md", "foo/bar.md", "a/zzfoo.md"],
      "score, then the shorter path, input order for full ties; a path-only match (0 - 1) trails equal basename matches");
    // "fo" names no file exactly, so recency is the first key that differs.
    assert.deepEqual(paths(rankLinkTargets("fo", list, ["foo/bar.md", "a/zzfoo.md"], prepare)).slice(0, 2),
      ["foo/bar.md", "a/zzfoo.md"], "recent files lead, in recency order");
    // w1c-link-suggest-exact-first: a note named exactly what was typed beats
    // a weakly matching recent file; recency still orders the rest.
    assert.deepEqual(paths(rankLinkTargets("foo", list, ["foo/bar.md", "a/zzfoo.md"], prepare)),
      ["foo.md", "b/foo.md", "c/foo.md", "long/path/foo.md", "foo/bar.md", "a/zzfoo.md"],
      "exact basename matches first (shorter path first among them), then the recent files");
    {
      const demo = ["demolition-notes.md", "demo.md"].map(file);
      assert.deepEqual(paths(rankLinkTargets("demo", demo, ["demolition-notes.md"], prepare)), ["demo.md", "demolition-notes.md"],
        "demo.md (never opened) before demolition-notes.md (recent)");
      assert.deepEqual(paths(rankLinkTargets("demo", demo, ["demolition-notes.md"])), ["demo.md", "demolition-notes.md"],
        "…with the default matcher too");
      const upper = ["Notes/Demo.md", "demolition-notes.md"].map(file);
      assert.equal(paths(rankLinkTargets(" DEMO ", upper, ["demolition-notes.md"], (q) => (t) => (t.toLowerCase().includes(q.toLowerCase()) ? { score: 0 } : null)))[0],
        "Notes/Demo.md", "case-insensitive, query trimmed");
      const nfc = ["caf\u00e9.md", "cafe-recent.md"].map(file);
      assert.equal(paths(rankLinkTargets("cafe\u0301", nfc, ["cafe-recent.md"], () => () => ({ score: 0 })))[0],
        "caf\u00e9.md", "a decomposed query matches the composed name (NFC)");
    }
    // w2c-link-suggest-md-first: among exact names the note wins over an
    // attachment with a shorter path, and recency does not reorder them.
    {
      const both = ["img/demo.png", "notes/demo.md"].map(file);
      assert.deepEqual(paths(rankLinkTargets("demo", both, [])), ["notes/demo.md", "img/demo.png"], "the note before the image");
      assert.deepEqual(paths(rankLinkTargets("demo", both, ["img/demo.png"])), ["notes/demo.md", "img/demo.png"], "…even when the image is recent");
      const pics = ["img/demo.png", "demo.jpg"].map(file);
      assert.deepEqual(paths(rankLinkTargets("demo", pics, [])), ["demo.jpg", "img/demo.png"], "two attachments keep the old order (shorter path first)");
    }
    assert.deepEqual(paths(rankLinkTargets("foo", list, [], prepare, 2)), ["foo.md", "b/foo.md"], "limit");
    assert.deepEqual(rankLinkTargets("nothing", list, [], prepare), []);
    assert.deepEqual(rankLinkTargets("<foo>", list, [], prepare), []);
    assert.deepEqual(rankLinkTargets("foo#h", list, [], prepare), []);
    assert.equal(rankLinkTargets("demo", files, []).length, 4, "the default matcher is Obsidian's (stubbed)");
    const many = Array.from({ length: 20 }, (_, i) => file(`n/foo${i}.md`));
    assert.equal(rankLinkTargets("foo", many, [], prepare).length, 8, "at most 8 by default");
  }

  /* ---- Open visibility and the hint ---- */
  {
    const f = cardFixture();
    assert.equal(f.open().style.display, "none", "nothing to open yet");
    assert.equal(f.open().options.attr["aria-label"], "Open", "icon-only, named for the tooltip");
    assert.equal(f.open().options.text, undefined);
    assert.equal(f.open().options.cls, "clickable-icon nf-link-open");
    assert.equal(f.hint().text, "Paste a URL or search notes");
    f.type("dest", "x");
    assert.equal(f.open().style.display, "");
    assert.equal(f.hint().text, "");
    f.type("dest", "a b.md");
    assert.equal(f.hint().text, "Spaces are wrapped in <…>");
    f.type("dest", "<a b.md>");
    assert.equal(f.hint().text, "");
    f.type("dest", "https://ex.com");
    assert.equal(f.hint().text, "");
    f.type("dest", "");
    assert.equal(f.open().style.display, "none", "cleared: hidden again");
    assert.equal(f.hint().text, "Paste a URL or search notes");
    f.click("mod-cta");
    assert.equal(f.hint().text, "Enter a destination");
    assert.ok(f.hint().classes.has("nf-link-hint-error"));
    f.type("dest", "a b.md");
    assert.equal(f.hint().text, "Spaces are wrapped in <…>", "typing restores the computed hint");
    assert.ok(!f.hint().classes.has("nf-link-hint-error"));
    const wiki = cardFixture({ text: "x", dest: "My Note", kind: "wiki" });
    assert.equal(wiki.hint().text, "", "spaces are legal in a wikilink");
    wiki.type("dest", "Other Note");
    assert.equal(wiki.hint().text, "");
    LinkPopover.closeActive();
  }
  {
    // A clipboard URL is set without an input event; Open still shows.
    const f = cardFixture({ text: "sel", clip: "https://ex.com" });
    assert.equal(f.open().style.display, "none");
    await tick();
    assert.equal(f.input("dest").value, "https://ex.com");
    assert.equal(f.open().style.display, "", "Open shows for the pasted URL");
    assert.equal(f.hint().text, "");
    LinkPopover.closeActive();
  }

  /* ---- placement ---- */
  {
    const size = { w: 320, h: 120 };
    const vp = { w: 1000, h: 800 };
    assert.deepEqual(placePopover({ left: 100, top: 200, bottom: 220 }, size, vp, null), { left: 88, top: 228, below: true });
    assert.deepEqual(placePopover({ left: 2, top: 760, bottom: 780 }, size, vp, null), { left: 8, top: 632, below: false });
    assert.deepEqual(placePopover({ left: 2, top: 760, bottom: 780 }, size, { w: 1000, h: 2000 }, null), { left: 8, top: 788, below: true });
    assert.equal(placePopover({ left: 100, top: -200, bottom: -180 }, size, vp, null).top, 8);
    assert.equal(placePopover({ left: 100, top: 900, bottom: 920 }, size, vp, null).top, 672);
    assert.deepEqual(placePopover({ left: 990, top: 200, bottom: 220 }, size, vp, null).left, 672, "right edge");
    const box = { left: 300, top: 100, right: 900, bottom: 500 };
    assert.deepEqual(placePopover({ left: 100, top: 440, bottom: 460 }, size, vp, box), { left: 308, top: 312, below: false },
      "flips above inside the pane and keeps 8px from its left edge");
    assert.deepEqual(placePopover({ left: 800, top: 200, bottom: 220 }, size, vp, box), { left: 572, top: 228, below: true });
    const tall = { w: 320, h: 200 };
    const strip = { left: 0, top: 100, right: 1000, bottom: 400 };
    assert.deepEqual(placePopover({ left: 100, top: 260, bottom: 280 }, tall, vp, strip), { left: 88, top: 108, below: false },
      "neither side fits: more room above, clamped to the pane's top");
    assert.deepEqual(placePopover({ left: 100, top: 120, bottom: 140 }, { w: 320, h: 270 }, vp, strip), { left: 88, top: 122, below: true },
      "neither side fits: more room below, clamped to the pane's bottom");
    assert.deepEqual(placePopover({ left: 100, top: 200, bottom: 220 }, size, vp, { left: 300, top: 100, right: 500, bottom: 500 }),
      { left: 88, top: 228, below: true }, "a pane narrower than the card: the window on that axis");
    assert.deepEqual(placePopover({ left: 100, top: 200, bottom: 220 }, size, vp, { left: 0, top: 100, right: 1000, bottom: 200 }).top, 228,
      "a pane shorter than the card: the window on that axis");
    assert.deepEqual(placePopover({ left: 100, top: 200, bottom: 220 }, size, vp, { left: -500, top: -100, right: 2000, bottom: 2000 }),
      { left: 88, top: 228, below: true }, "a pane larger than the window is clipped to it");
    assert.deepEqual(placePopover(null, size, vp, null), { left: 340, top: 240, below: true }, "no anchor: centred, 30% down");
    assert.deepEqual(placePopover(null, size, vp, box), { left: 440, top: 220, below: true });
    const f = cardFixture({ anchor: () => ({ left: 100, top: 440, bottom: 460 }), bounds: () => box });
    assert.equal(f.card().style.left, "308px", "LinkPopover honours its bounds");
    assert.equal(f.card().style.top, "312px");
    assert.equal(f.card().attrs["data-placement"], "above");
    const g = cardFixture({ anchor: () => ({ left: 100, top: 440, bottom: 460 }), bounds: () => null });
    assert.equal(g.card().style.top, "468px", "no box: the window");
    LinkPopover.closeActive();
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
console.log("PASS link popover: Save/Enter/Unlink write through a real operation scope, stale cards stay silent, note search, Open, hint and placement");
