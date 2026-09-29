import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Self-bundled with a virtual `obsidian` module, so this test depends neither
// on test/obsidian-stub.mjs nor on test/feature-entry.ts.
const REPO = fileURLToPath(new URL("..", import.meta.url));
const dir = await mkdtemp(join(tmpdir(), "notion-flow-writing-modules-"));
let checks = 0;
const ok = (value, message) => { checks++; assert.ok(value, message); };
const eq = (actual, expected, message) => { checks++; assert.deepEqual(actual, expected, message); };
try {
  const outfile = join(dir, "writing.mjs");
  const stub = `
    const P = (globalThis.__nfPlatform ??= { isMacOS: true });
    export const Platform = P;
    export class Notice { constructor(m) { (globalThis.__nfNotices ??= []).push(String(m)); } }
    export const normalizePath = (p) => String(p).replace(/([\\\\/])+/g, "/").replace(/(^\\/+|\\/+$)/g, "") || "/";
    export const setIcon = (el, id) => { if (el) el.__icon = id; };
    export const renderMatches = (el, text, ranges) => { el.__matches = ranges; el.textContent = text; };
    export class Modal { constructor(app) { this.app = app; } open() { (globalThis.__nfOpenedModals ??= []).push(this); } close() {} }
    export class SuggestModal extends Modal { limit = 100; setPlaceholder(p) { this.placeholder = p; } setInstructions(i) { this.instructions = i; } }
    export class FuzzySuggestModal extends SuggestModal {}`;
  await build({
    stdin: {
      contents: `
        export * from "./src/core/slash-search";
        export * from "./src/features/toggle-fold-all";
        export * from "./src/features/toc";
        export * from "./src/features/slash-templates";
        export * from "./src/core/code-languages";
        export * from "./src/ui/language-picker";
        export { Text, EditorState } from "@codemirror/state";`,
      resolveDir: REPO, loader: "ts",
    },
    bundle: true, format: "esm", platform: "node", outfile, logLevel: "silent",
    plugins: [{
      name: "obsidian-stub",
      setup(b) {
        b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "nf-stub" }));
        b.onResolve({ filter: /^@codemirror\/view$/ }, () => ({ path: "view", namespace: "nf-stub" }));
        b.onLoad({ filter: /.*/, namespace: "nf-stub" }, (a) => ({
          contents: a.path === "obsidian" ? stub : "export class EditorView {}", loader: "js",
        }));
      },
    }],
  });
  const M = await import(pathToFileURL(outfile).href);
  const { Text, EditorState } = M;
  const docOf = (src) => Text.of(src.split("\n"));
  const apply = (src, changes) => EditorState.create({ doc: src }).update({ changes }).state.doc.toString();

  // ── toggle fold ───────────────────────────────────────────────────────────
  {
    const { findFoldTargets, planToggleFold, resolveToggleFoldMode, registerToggleFoldCommands } = M;
    /** The in-app sample note; line 27 starts with one TAB. Markers per target. */
    const sample = ({ first, nested, note, col, faq }) => `# Fold test

> [!nf-toggle]${first} First
> body 1
> > [!nf-toggle]${nested} Nested (no marker)
> > nested body

> [!note]${note} Foldable note
> text

> [!tip] Plain tip (not foldable)
> text

> [!nf-cols]
> > [!nf-col]
> > > [!nf-toggle]${col} In column
> > > col body

\`\`\`md
> [!nf-toggle]+ inside code
\`\`\`

> quote first line
> [!warning]- not a header

- item
\t> [!faq]${faq} In a list

## After`;
    const SAMPLE = sample({ first: "+", nested: "", note: "+", col: "-", faq: "+" });
    const COLLAPSED = sample({ first: "-", nested: "-", note: "-", col: "-", faq: "-" });
    const EXPANDED = sample({ first: "+", nested: "", note: "+", col: "+", faq: "+" });
    const ALL_OPEN = sample({ first: "+", nested: "+", note: "+", col: "+", faq: "+" });
    const targets = findFoldTargets(docOf(SAMPLE));
    eq(targets.map((x) => x.line), [3, 5, 8, 16, 27], "sample targets");
    eq(targets.map((x) => x.kind), ["toggle", "toggle", "callout", "toggle", "callout"]);
    eq(targets.map((x) => x.marker), ["+", "", "+", "-", "+"]);
    eq(targets.map((x) => x.collapsed), [false, false, false, true, false]);
    const first = targets[0];
    eq(SAMPLE.slice(first.markerFrom - 1, first.markerTo), "]+", "the marker sits just after ]");

    const plan = (src, mode, options) => planToggleFold(docOf(src), mode, options);
    eq(plan(SAMPLE, "collapse").length, 4, "collapse changes exactly four markers");
    eq(apply(SAMPLE, plan(SAMPLE, "collapse")), COLLAPSED);
    eq(plan(SAMPLE, "expand").length, 1, "expand changes only the collapsed column toggle");
    eq(apply(SAMPLE, plan(SAMPLE, "expand")), EXPANDED, "fold-less toggles stay fold-less on expand");
    eq(apply(SAMPLE, plan(SAMPLE, "toggle")), COLLAPSED, "toggle with anything open collapses");
    eq(apply(COLLAPSED, plan(COLLAPSED, "toggle")), ALL_OPEN, "toggle with everything collapsed expands");
    eq(apply(COLLAPSED, plan(COLLAPSED, "expand")), ALL_OPEN, "toggle twice equals collapse then expand");
    eq(plan(COLLAPSED, "collapse"), [], "nothing to do: no changes");
    eq(plan(EXPANDED, "expand"), [], "nothing to do: no changes");
    for (const mode of ["collapse", "expand", "toggle"]) {
      for (const change of plan(SAMPLE, mode)) {
        ok([0, 1].includes(change.to - change.from) && ["+", "-"].includes(change.insert), `${mode}: marker-only edits`);
      }
      const froms = plan(SAMPLE, mode).map((x) => x.from);
      eq(froms, [...froms].sort((a, b) => a - b), `${mode}: ascending changes`);
    }
    eq(apply("> [!nf-toggle]Title", plan("> [!nf-toggle]Title", "collapse")), "> [!nf-toggle]-Title", "titles are never touched");
    const upper = findFoldTargets(docOf("> [!NF-Toggle]+ x"));
    eq(upper.map((x) => [x.kind, x.type]), [["toggle", "nf-toggle"]], "the type is case-insensitive");
    const meta = "> [!tip|nf-yellow]- x";
    eq(findFoldTargets(docOf(meta)).map((x) => x.kind), ["callout"], "metadata callouts are targets");
    eq(apply(meta, plan(meta, "expand")), "> [!tip|nf-yellow]+ x", "the marker goes after the metadata's ]");
    eq(findFoldTargets(docOf("> [!tip] plain")), [], "a Callout without a marker does not fold");

    // A header opens its blockquote.
    eq(findFoldTargets(docOf("> quote\n> [!warning]- x")), [], "not a header mid-quote");
    eq(findFoldTargets(docOf(">\n> [!note]- x")), [], "not a header after an empty quote line");
    eq(findFoldTargets(docOf("Para\n> [!note]- x")).map((x) => x.line), [2], "a blockquote may interrupt a paragraph");
    eq(findFoldTargets(docOf("- item\n\t> [!faq]+ x")).map((x) => x.line), [2], "a header inside a list item");
    eq(findFoldTargets(docOf("> [!note]+ a\n> > [!faq]- b")).map((x) => x.line), [1, 2], "nested headers");
    eq(findFoldTargets(docOf("> [!nf-cols]\n> > [!nf-col]\n> > > text")), [], "columns are structural");

    // Skipped regions.
    const lines = (src, options) => findFoldTargets(docOf(src), options).map((x) => x.line);
    eq(lines("```\n> [!note]+ a\n```\n> [!note]+ b"), [4], "a fenced header is skipped");
    eq(lines("~~~~\n> [!note]+ a\n~~~\n> [!note]+ still code\n~~~~~\n> [!note]+ b"), [6], "~~~~ closes only with ≥ 4 tildes");
    eq(lines("> ```\n> > [!note]+ a\n> ```\n\n> [!note]+ b"), [5], "a quoted fence");
    eq(lines("```\n> [!note]+ a\n\n> [!note]+ b"), [], "an unclosed fence runs to the end");
    eq(lines("> ```\n> code\nPara\n> [!note]+ b"), [4], "a quoted fence ends with its quote");
    eq(lines("``` a ` b\n> [!note]+ x"), [2], "backtick info with a backtick opens no fence");
    eq(lines("1. ```md\n   > [!note]+ a\n   ```\n- ~~~\n  > [!note]+ b\n  ~~~\n> [!note]+ c"), [7], "a fence opened on a list-marker line");
    eq(lines("---\ntitle: x\n> [!note]+ fm\n---\n> [!note]+ b"), [5], "frontmatter is skipped");
    eq(lines("---\n> [!note]+ a"), [2], "an unclosed --- is not frontmatter");

    // Options.
    eq(findFoldTargets(docOf("> [!nf-toggle] a\n\n> [!nf-toggle]+ b"), { toggles: false }).map((x) => [x.line, x.kind]),
      [[3, "callout"]], "toggles: false needs a marker like any Callout");
    eq(lines("> [!note]+ a\n\n> [!nf-toggle] b", { callouts: false }), [3], "callouts: false");
    eq(lines(SAMPLE, { skipLine: (n) => n === 3 || (n >= 19 && n <= 21) }), [5, 8, 16, 27], "skipLine hides a line");
    eq(lines(SAMPLE, { skipLine: (n) => n === 3 }), [5, 8, 16, 20, 27], "…and is the whole fence test");
    eq(lines("```\n> [!note]+ a\n```", { skipLine: () => false }), [2], "skipLine replaces the built-in fence scan");

    eq(resolveToggleFoldMode([], "toggle"), "expand", "no targets: harmless expand");
    eq(resolveToggleFoldMode(findFoldTargets(docOf(COLLAPSED)), "toggle"), "expand");
    eq(resolveToggleFoldMode(findFoldTargets(docOf("> [!nf-toggle] open")), "toggle"), "collapse", "fold-less counts as open");
    eq(resolveToggleFoldMode(targets, "expand"), "expand");

    // Commands.
    const fakeView = (src) => ({
      state: EditorState.create({ doc: src }),
      specs: [],
      dispatch(spec) { this.specs.push(spec); this.state = this.state.update(spec).state; },
    });
    const register = (view) => {
      const commands = [];
      registerToggleFoldCommands({ addCommand: (command) => { commands.push(command); return command; } }, { view: () => view });
      return Object.fromEntries(commands.map((command) => [command.id, command]));
    };
    globalThis.__nfPlatform.isMacOS = true;
    const view = fakeView(SAMPLE);
    const cmds = register(view);
    eq(Object.keys(cmds), ["collapse-all-toggles", "expand-all-toggles", "toggle-all-toggles"]);
    eq(Object.values(cmds).map((c) => c.name), ["Collapse all toggles", "Expand all toggles", "Collapse or expand all toggles"]);
    eq(Object.values(cmds).map((c) => c.icon), ["chevrons-down-up", "chevrons-up-down", "fold-vertical"]);
    eq(cmds["toggle-all-toggles"].hotkeys, [{ modifiers: ["Mod", "Alt"], key: "T" }], "⌘⌥T on macOS");
    ok(!("hotkeys" in cmds["collapse-all-toggles"]) && !("hotkeys" in cmds["expand-all-toggles"]), "only the toggle has a hotkey");
    globalThis.__nfPlatform.isMacOS = false;
    ok(Object.values(register(view)).every((c) => !("hotkeys" in c)), "no default hotkey off macOS (Ctrl+Alt is AltGr)");
    globalThis.__nfPlatform.isMacOS = true;
    eq(cmds["collapse-all-toggles"].editorCheckCallback(true, {}), true, "offered in a note with toggles");
    eq(view.specs.length, 0, "checking never dispatches");
    eq(cmds["collapse-all-toggles"].editorCheckCallback(false, {}), true);
    eq(view.specs.length, 1, "one dispatch");
    eq(view.specs[0].userEvent, "input.toggle-all");
    eq(view.state.doc.toString(), COLLAPSED);
    cmds["collapse-all-toggles"].editorCheckCallback(false, {});
    eq(view.specs.length, 1, "collapsing a collapsed note does not dispatch");
    cmds["toggle-all-toggles"].editorCheckCallback(false, {});
    eq(view.state.doc.toString(), ALL_OPEN, "the toggle command expands a collapsed note");
    const plain = register(fakeView("# x\n\ntext\n"));
    eq(plain["toggle-all-toggles"].editorCheckCallback(true, {}), false, "not offered without targets (⌘⌥T falls through)");
    const none = register(null);
    eq(none["collapse-all-toggles"].editorCheckCallback(true, {}), false, "no view: not offered");
    const withOptions = [];
    registerToggleFoldCommands({ addCommand: (c) => withOptions.push(c) }, {
      view: () => fakeView("> [!nf-toggle] a"), options: () => ({ toggles: false }),
    });
    eq(withOptions[0].editorCheckCallback(true, {}), false, "host options are applied");
  }

  // ── toc ───────────────────────────────────────────────────────────────────
  {
    const {
      stripHeading, stripHeadingForLink, plainHeadingText, tocLinks, buildTocMarkdown, tocBlockText, tocSnippet,
      scanHeadings, findTocBlocks, refreshTocChanges, applyTocRefresh, TOC_MARKER, TOC_USER_EVENT, TOC_SLASH_ENTRY,
      searchSlashCommands,
    } = M;
    // Obsidian's own normalisation, pinned (1.13.7).
    const strip = {
      "C# basics": ["C basics", "C basics"], "A | B": ["A B", "A B"], "Step ^1": ["Step 1", "Step 1"],
      "x %% y": ["x y", "x y"], "[[a]] b": ["a b", "a b"], "a\\b": ["a b", "a b"], "Why?": ["Why?", "Why"],
      "Q&A": ["Q&A", "Q A"], "中文 标题": ["中文 标题", "中文 标题"],
    };
    for (const [heading, [forLink, compared]] of Object.entries(strip)) {
      eq(stripHeadingForLink(heading), forLink, `stripHeadingForLink(${heading})`);
      eq(stripHeading(heading), compared, `stripHeading(${heading})`);
    }
    const plain = {
      "**Bold** title": "Bold title", "`code` x": "code x", "See [[Other note|alias]]": "See alias", "[t](http://x)": "t",
      '<span style="color:var(--nf-red)">Red</span>': "Red", "snake_case_name and *it*": "snake_case_name and it",
      "==hi==": "hi", "x %%c%% y": "x y", "[[Note#Part]]": "Note > Part", "~~old~~ new": "old new",
      "Step ^1": "Step", "Intro ^intro-id ": "Intro", "a^b": "a^b", "A | B": "A | B",
      // Comparisons and arrows are not tags.
      "When a <= b and b >= c": "When a <= b and b >= c", "Case n < 10 vs n > 10": "Case n < 10 vs n > 10",
      "x -> y <- z -> w": "x -> y <- z -> w", "$a<b$ and $c>d$": "$a<b$ and $c>d$", "1<2>0": "1<2>0",
      "Vec<T>": "Vec", "a <br> b": "a b", "x<br/>y": "xy", "<b>Bold</b> <i class='x'>it</i>": "Bold it",
    };
    for (const [heading, text] of Object.entries(plain)) eq(plainHeadingText(heading), text, `plainHeadingText(${heading})`);

    /** Obsidian's resolveSubpath heading walk, written independently of the module. */
    const resolves = (headings, link) => {
      const target = link.slice(3, -2).split("|")[0];
      const segments = target.split("#");
      let matched = 0, level = 0;
      for (let k = 0; k < headings.length; k++) {
        const h = headings[k];
        if (h.level > level && stripHeading(h.heading).toLowerCase() === stripHeading(segments[matched]).toLowerCase()) {
          matched++; level = h.level;
          if (matched === segments.length) return k;
        }
      }
      return -1;
    };
    const H = (spec) => spec.map(([level, heading]) => ({ level, heading }));
    const GUIDE = H([
      [1, "Guide"], [2, "Week 1"], [3, "Notes"], [2, "Week 2"], [3, "Notes"], [2, "C# basics"], [2, "A | B"],
      [2, "**Bold** title"], [4, "Skipped level"], [2, "Step ^1"], [2, "See [[Other note|alias]]"], [2, "中文标题"],
      [2, "###"], [2, '<span style="color:var(--nf-red)">Red</span>'], [2, "snake_case_name and *it*"],
    ]);
    eq(buildTocMarkdown(GUIDE), [
      "- [[#Guide]]",
      "\t- [[#Week 1]]",
      "\t\t- [[#Notes]]",
      "\t- [[#Week 2]]",
      "\t\t- [[#Week 2#Notes|Notes]]",
      "\t- [[#C basics|C# basics]]",
      "\t- [[#A B|A ｜ B]]",
      "\t- [[#Bold title]]",
      "\t\t- [[#Skipped level]]",
      "\t- [[#Step 1|Step]]",
      "\t- [[#See Other note alias|See alias]]",
      "\t- [[#中文标题]]",
      "\t- [[#span style color var --nf-red Red span|Red]]",
      "\t- [[#snake_case_name and it]]",
    ].join("\n"), "the reference TOC");
    tocLinks(GUIDE).forEach((entry, index) => {
      if (entry) eq(resolves(GUIDE, entry.link), index, `${entry.link} opens its own heading`);
    });
    eq(tocLinks(GUIDE)[12], null, "## ### has no link");
    // Displays render alike in Live Preview and Reading view (measured in-app).
    eq(buildTocMarkdown(H([[2, "参考[1]"], [2, "Array[0] x"], [2, "a|b"]])),
      "- [[#参考 1|参考[1] ]]\n- [[#Array 0 x|Array[0] x]]\n- [[#a b|a｜b]]", "a final ] and every | are made safe");
    eq(buildTocMarkdown(H([[2, "When a <= b and b >= c"], [2, "Case n < 10 vs n > 10"]])),
      "- [[#When a b and b c|When a <= b and b >= c]]\n- [[#Case n 10 vs n 10|Case n < 10 vs n > 10]]", "comparisons keep their words");

    const depths = (spec) => tocLinks(H(spec)).map((entry) => entry.depth);
    eq(depths([[1, "a"], [2, "b"], [3, "c"], [2, "d"]]), [0, 1, 2, 1]);
    eq(depths([[2, "a"], [4, "b"], [3, "c"]]), [0, 1, 1], "a skipped level indents one step; H3 after H4 is a sibling");
    eq(depths([[3, "a"], [1, "b"]]), [0, 0]);
    // Empty headings get no row, so they do not count toward depth either.
    const rowDepths = (spec) => tocLinks(H(spec)).map((entry) => entry?.depth ?? null);
    eq(rowDepths([[1, ""], [2, "A"], [2, "B"]]), [null, 0, 0], "an empty first heading adds no indent");
    eq(rowDepths([[1, "Guide"], [2, ""], [3, "Setup"]]), [0, null, 1], "an empty heading in between indents one step");
    eq(rowDepths([[1, "Guide"], [2, "###"], [3, "Setup"], [4, "Step 1"], [2, "Next"]]), [0, null, 1, 2, 1]);
    eq(tocSnippet(H([[1, ""], [2, "A"], [2, "B"]])), "<!-- nf-toc -->\n- [[#A]]\n- [[#B]]\n\n‸",
      "no tab-indented rows under the marker (an indented code block)");
    eq(buildTocMarkdown(scanHeadings(docOf("# Guide\n##\n### Setup\n#### Step 1\n## Next"))),
      "- [[#Guide]]\n\t- [[#Setup]]\n\t\t- [[#Step 1]]\n\t- [[#Next]]");
    eq(buildTocMarkdown(H([[1, "a"], [2, "b"]]), { indent: "  " }), "- [[#a]]\n  - [[#b]]", "indent option");

    const topDup = H([[2, "Notes"], [2, "Notes"]]);
    eq(tocLinks(topDup).map((e) => e.link), ["[[#Notes]]", "[[#Notes]]"], "no disambiguating ancestor: plain link");
    const triple = H([[1, "A1"], [2, "B"], [3, "Notes"], [1, "A2"], [2, "B"], [3, "Notes"]]);
    const tripleLinks = tocLinks(triple).map((e) => e.link);
    eq(tripleLinks, ["[[#A1]]", "[[#B]]", "[[#Notes]]", "[[#A2]]", "[[#A2#B|B]]", "[[#A2#B#Notes|Notes]]"]);
    tripleLinks.forEach((link, index) => eq(resolves(triple, link), index, `${link} resolves to heading ${index}`));
    // Long notes stay fast: 3000 headings (every H3 a duplicate "Notes") took seconds when each walk re-normalised.
    const LONG = Array.from({ length: 3000 }, (_, k) => ({ level: 1 + (k % 3), heading: k % 3 === 2 ? "Notes" : `Heading ${k}` }));
    const started = performance.now();
    const longLinks = tocLinks(LONG);
    ok(performance.now() - started < 400, `3000 headings in ${Math.round(performance.now() - started)} ms`);
    ok(longLinks.every((entry, index) => resolves(LONG, entry.link) === index), "every long-note link opens its own heading");

    eq(buildTocMarkdown([]), "");
    eq(buildTocMarkdown(H([[2, "###"]])), "", "only empty headings");
    eq(tocSnippet([]), null);
    eq(tocSnippet(H([[2, "###"]])), null);
    eq(tocBlockText([]), TOC_MARKER);
    eq(TOC_MARKER, "<!-- nf-toc -->");
    eq(tocBlockText(H([[1, "a"]])), "<!-- nf-toc -->\n- [[#a]]");
    eq(tocSnippet(H([[1, "a"], [2, "b"]])), "<!-- nf-toc -->\n- [[#a]]\n\t- [[#b]]\n\n‸", "the caret lands after a blank line");

    // scanHeadings reads the editor text.
    const scanned = scanHeadings(docOf([
      "---", "title: x", "# in frontmatter", "---",
      "## Title ##", "#tag", "  ## indented ok", "    # four spaces",
      "```text", "# in code", "```",
      "$$", "# in math", "$$", "$$x$$",
      "%%", "# in comment", "%%",
      "## C#", "## ###", "## After %%inline%% comment",
      "> # quoted", "- # in list", "~~~", "# unclosed fence",
    ].join("\n")));
    eq(scanned.map((h) => [h.line, h.level, h.heading]), [
      [5, 2, "Title"], [7, 2, "indented ok"], [19, 2, "C#"], [20, 2, ""], [21, 2, "After %%inline%% comment"],
    ]);
    eq(scanHeadings(docOf("```\n# a\n```\n# b"), { skipLine: (n) => n === 4 }).map((h) => h.heading), ["a"],
      "skipLine replaces the fence scan");
    eq(scanHeadings(docOf("---\n# a")).map((h) => h.heading), ["a"], "an unclosed --- is not frontmatter");
    // Only an Obsidian block comment (a line that starts with %% and has no other %) hides headings.
    const scanOf = (src) => scanHeadings(docOf(src)).map((h) => `${h.level}:${h.heading}`);
    for (const prose of ["Obsidian comments start with `%%`.", "x `%%` y", "text %% more", "`%%timeit`",
      'Use `sprintf("%.1f%%", x)` here', "%%time and %%timeit"]) {
      eq(scanOf(`# Guide\n${prose}\n## Setup\n## Usage`), ["1:Guide", "2:Setup", "2:Usage"], `a %% in "${prose}" is text`);
    }
    eq(scanOf("# A\n%% a\n## h\nb %% c\n## After"), ["1:A", "2:After"], "a block comment closes at a mid-line %%");
    eq(scanOf("# A\n%%\n## h\n%%\n## After"), ["1:A", "2:After"]);
    eq(scanOf("# A\n  %% note\n## h"), ["1:A"], "an unclosed comment runs to the end");
    eq(scanOf("# A\n%% one %%\n## B"), ["1:A", "2:B"], "a one-line comment opens nothing");
    const guideNote = "# Guide\n\n<!-- nf-toc -->\n- [[#Guide]]\n\t- [[#Setup]]\n\t- [[#Usage]]\n\nUse `%%` to hide text.\n\n## Setup\n## Usage";
    eq(refreshTocChanges(docOf(guideNote), scanHeadings(docOf(guideNote))), [], "refresh keeps entries after an inline %%");
    // Code in a fence opened on a list-marker line, and multi-line HTML comments, hold no headings.
    eq(scanOf("# Install\n1. ```bash\n   # install deps\n   npm i\n   ```\n## Next"), ["1:Install", "2:Next"]);
    eq(scanOf("# A\n- ```python\n  # comment\n  ```\n* ~~~r\n  # r comment\n  ~~~\n## B"), ["1:A", "2:B"]);
    eq(scanOf("# A\n> 2) ```sh\n>    # quoted\n>    ```\n## B"), ["1:A", "2:B"], "…inside a quote too");
    eq(scanOf("# A\n<!--\n## Draft\n-->\n## B"), ["1:A", "2:B"]);
    eq(scanOf("# A\n  <!-- draft\n## Draft\nend -->\n## B"), ["1:A", "2:B"], "the comment ends on the line holding -->");
    eq(scanOf("# A\n<!-- one line -->\n## B\n<!--\n## Unclosed"), ["1:A", "2:B"], "a one-line comment opens nothing");
    eq(scanOf("<!--\n```\n-->\n## B"), ["2:B"], "a fence marker inside a comment opens no fence");
    eq(scanOf("# A\n    <!--\n## B"), ["1:A", "2:B"], "four spaces: indented code, not a comment");
    // Pinned to Obsidian 1.13.7's metadataCache: right under a list item, `<!--` is the item's text.
    eq(scanOf("# A\n- item\n<!--\n## Draft\n-->\n## B"), ["1:A", "2:Draft", "2:B"]);
    eq(scanOf("# A\n1. ```py\n   # c\n   ```\n<!--\n## Draft\n-->\n## B"), ["1:A", "2:Draft", "2:B"]);
    eq(scanOf("# A\n- item\n\n<!--\n## Draft\n-->\n## B"), ["1:A", "2:B"], "after a blank line it is a comment");
    eq(scanOf("# A\n> quote\n<!--\n## Draft\n-->\n## B"), ["1:A", "2:B"], "…and after a quote or a paragraph");
    eq(scanOf("# A\ntext <!-- x\n## Draft\n-->\n## B"), ["1:A", "2:Draft", "2:B"], "a comment opens only at the line start");
    eq(scanHeadings(docOf("# A\n<!--\n## Draft\n-->\n## B"), { skipLine: () => false }).map((h) => h.heading), ["A", "B"],
      "HTML comments are skipped with skipLine too");

    // findTocBlocks
    const blocksOf = (src) => findTocBlocks(docOf(src)).map((b) => [b.markerLine, b.prefix, b.firstListLine, b.lastListLine]);
    eq(blocksOf("<!-- nf-toc -->\n- [[#a]]\n\t- [[#b]]\n\ntext\n\n<!--nf-toc-->\n- [[#a]]"),
      [[1, "", 2, 3], [7, "", 8, 8]], "two blocks");
    eq(blocksOf("> [!note]\n> <!-- nf-toc -->\n> - [[#a]]\n> \t- [[#b]]\n>\n> after"), [[2, "> ", 3, 4]], "inside a Callout");
    eq(blocksOf("```\n<!-- nf-toc -->\n- x\n```"), [], "a marker in a fence is ignored");
    eq(blocksOf("- ```md\n  <!-- nf-toc -->\n  - x\n  ```"), [], "…also in a fence opened on a list-marker line");
    eq(blocksOf("<!-- NF-TOC -->   \n- [[#a]]\n\n- other list"), [[1, "", 2, 2]], "ended by a blank line; case-insensitive");
    eq(blocksOf("<!-- nf-toc -->\n- [[#a]]\nA paragraph"), [[1, "", 2, 2]], "a paragraph is not eaten");
    eq(blocksOf("<!-- nf-toc -->\n\n- x"), [[1, "", null, null]], "an empty list");
    eq(blocksOf("- item\n\t<!-- nf-toc -->\n\t- [[#a]]\n- next"), [[2, "\t", 3, 3]], "inside a list item");
    eq(blocksOf("text <!-- nf-toc -->"), [], "only a line of its own is a marker");

    // refreshTocChanges
    const refresh = (src, headings = scanHeadings(docOf(src)), options) =>
      apply(src, refreshTocChanges(docOf(src), headings, options));
    const note = (week2, list) => ["# Guide", "", "<!-- nf-toc -->", ...list, "", "## Week 1", "### Notes", `## ${week2}`, "### Notes"].join("\n");
    const LIST = ["- [[#Guide]]", "\t- [[#Week 1]]", "\t\t- [[#Notes]]", "\t- [[#Week 2]]", "\t\t- [[#Week 2#Notes|Notes]]"];
    const LIST_TWO = ["- [[#Guide]]", "\t- [[#Week 1]]", "\t\t- [[#Notes]]", "\t- [[#Week Two]]", "\t\t- [[#Week Two#Notes|Notes]]"];
    const current = note("Week 2", LIST);
    eq(refreshTocChanges(docOf(current), scanHeadings(docOf(current))), [], "current: no changes");
    const renamed = note("Week Two", LIST);
    const renamedChanges = refreshTocChanges(docOf(renamed), scanHeadings(docOf(renamed)));
    eq(renamedChanges.length, 1, "one replace");
    eq([renamedChanges[0].from, renamedChanges[0].to], [docOf(renamed).line(4).from, docOf(renamed).line(8).to], "only the list");
    eq(refresh(renamed), note("Week Two", LIST_TWO));
    eq(refresh(note("Week Two", LIST_TWO)), note("Week Two", LIST_TWO), "idempotent");
    eq(refreshTocChanges(docOf(note("Week Two", LIST_TWO)), scanHeadings(docOf(renamed))), [], "second call: []");
    eq(refresh("# A\n\n<!-- nf-toc -->\n\n## B"), "# A\n\n<!-- nf-toc -->\n- [[#A]]\n\t- [[#B]]\n\n## B", "empty list: insertion");
    eq(refresh("# A\n<!-- nf-toc -->\nA paragraph"), "# A\n<!-- nf-toc -->\n- [[#A]]\n\nA paragraph",
      "an insertion keeps a paragraph below apart");
    eq(refresh("<!-- nf-toc -->"), "<!-- nf-toc -->", "no headings, no list: nothing");
    eq(refresh("<!-- nf-toc -->\n- [[#Gone]]\n\ntext"), "<!-- nf-toc -->\n\ntext", "no headings: list deleted, marker kept");
    eq(refresh("# A\n\n> <!-- nf-toc -->\n> - [[#Old]]\n\n## B"), "# A\n\n> <!-- nf-toc -->\n> - [[#A]]\n> \t- [[#B]]\n\n## B",
      "the prefix is kept on every line");
    eq(refresh("# A\n\n<!-- nf-toc -->\n- [[#Old]]\n\n<!-- nf-toc -->\n- [[#A]]"), "# A\n\n<!-- nf-toc -->\n- [[#A]]\n\n<!-- nf-toc -->\n- [[#A]]",
      "every block, only the stale one changes");
    eq(refresh("# A\n## B\n<!-- nf-toc -->", undefined, { indent: "    " }), "# A\n## B\n<!-- nf-toc -->\n- [[#A]]\n    - [[#B]]");

    // applyTocRefresh: one transaction.
    const specs = [];
    const view = {
      state: EditorState.create({ doc: renamed }),
      dispatch(spec) { specs.push(spec); this.state = this.state.update(spec).state; },
    };
    eq(applyTocRefresh(view, scanHeadings(view.state.doc)), true);
    eq(specs.length, 1);
    eq(specs[0].userEvent, TOC_USER_EVENT);
    eq(TOC_USER_EVENT, "input.toc-refresh");
    eq(view.state.doc.toString(), note("Week Two", LIST_TWO));
    eq(applyTocRefresh(view, scanHeadings(view.state.doc)), false, "nothing stale: no transaction");
    eq(specs.length, 1);

    // The slash descriptor (main.ts SlashCommand field names).
    eq(TOC_SLASH_ENTRY.id, "toc");
    eq([TOC_SLASH_ENTRY.name, TOC_SLASH_ENTRY.desc, TOC_SLASH_ENTRY.icon, TOC_SLASH_ENTRY.group],
      ["Table of contents", "Links to every heading", "list-tree", "advanced"]);
    ok(TOC_SLASH_ENTRY.block && TOC_SLASH_ENTRY.needsBlank && TOC_SLASH_ENTRY.sealBelow, "block placement flags");
    for (const query of ["目录", "mulu", "toc", "ml", "contents"]) {
      eq(searchSlashCommands([TOC_SLASH_ENTRY], query, { columnLayout: true, toggleBlocks: true }).map((c) => c.id), ["toc"], `/${query}`);
    }
  }

  // ── templates ─────────────────────────────────────────────────────────────
  /** A vault of TFile-like nodes (folders have `children`), built from file paths. */
  const vaultOf = (paths) => {
    const nodes = new Map([["/", { path: "/", name: "", children: [] }]]);
    const parentOf = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "/");
    const folderAt = (path) => {
      if (!nodes.has(path)) {
        const node = { path, name: path.split("/").pop(), children: [] };
        folderAt(parentOf(path)).children.push(node);
        nodes.set(path, node);
      }
      return nodes.get(path);
    };
    for (const path of paths) {
      if (path.endsWith("/")) { folderAt(path.slice(0, -1)); continue; }
      const name = path.split("/").pop();
      const dot = name.lastIndexOf(".");
      const node = { path, name, basename: name.slice(0, dot), extension: name.slice(dot + 1) };
      folderAt(parentOf(path)).children.push(node);
      nodes.set(path, node);
    }
    return { getAbstractFileByPath: (path) => nodes.get(path) ?? null };
  };
  /** An Editor over a lines array: just what runTemplateEntry uses. */
  const fakeEditor = (lines) => ({
    lines: [...lines], cursor: { line: 0, ch: 0 },
    getLine(n) { return this.lines[n]; },
    replaceRange(text, from, to = from) {
      const offset = (p) => this.lines.slice(0, p.line).reduce((sum, line) => sum + line.length + 1, 0) + p.ch;
      const doc = this.lines.join("\n");
      this.lines = (doc.slice(0, offset(from)) + text + doc.slice(offset(to))).split("\n");
    },
    setCursor(p) { this.cursor = { line: p.line, ch: p.ch }; },
    getCursor() { return { ...this.cursor }; },
  });
  const TEMPLATE_VAULT = ["Templates/Meeting.md", "Templates/img.png", "Templates/Work/周报.md", "Other/x.md", "Empty/pic.png"];
  /** A fake app with core Templates; `getEnabled` uses the real app's lookup instead of `plugins`. */
  const templateApp = (opts = {}) => {
    const { paths = TEMPLATE_VAULT, enabled = true, insert = true, getEnabled = false, lines = [""] } = opts;
    const folder = "folder" in opts ? opts.folder : "Templates/";
    const calls = [], executed = [];
    const instance = { options: { folder } };
    if (insert) instance.insertTemplate = async (f) => { calls.push(f.path); };
    const plugins = { templates: { enabled, instance } };
    const editor = fakeEditor(lines);
    const app = {
      vault: vaultOf(paths),
      internalPlugins: getEnabled
        ? { plugins, getEnabledPluginById: (id) => (plugins[id]?.enabled ? plugins[id].instance : null) }
        : { plugins },
      workspace: { activeEditor: { editor } },
      commandOk: true,
      commands: { executeCommandById: (id) => (executed.push(id), app.commandOk) },
    };
    return { app, editor, calls, executed, instance, plugins };
  };
  {
    const {
      templateSlashEntries, runTemplateEntry, isTemplateSlashEntry, listTemplateFiles, templatesInstance,
      TEMPLATE_INSERT_COMMAND, TEMPLATE_INLINE_LIMIT, TOC_SLASH_ENTRY, searchSlashCommands, SLASH_STRONG_TIER,
    } = M;
    const F = { columnLayout: true, toggleBlocks: true };
    eq(TEMPLATE_INSERT_COMMAND, "insert-template", "core commands carry no plugin prefix (measured in 1.13.7)");
    eq(TEMPLATE_INLINE_LIMIT, 8);

    const { app, editor } = templateApp();
    ok(templatesInstance(app) === app.internalPlugins.plugins.templates.instance, "the enabled instance");
    eq(listTemplateFiles(app).map((f) => f.path), ["Templates/Meeting.md", "Templates/Work/周报.md"], "recursive .md only");
    const entries = templateSlashEntries(app);
    eq(entries.map((e) => e.id), ["template:Templates/Meeting.md", "template:Templates/Work/周报.md"]);
    eq(entries.map((e) => e.name), ["Template · Meeting", "Template · 周报"]);
    eq(entries.map((e) => e.desc), ["Templates/Meeting", "Templates/Work/周报"], "the vault path is the second line");
    eq(entries.map((e) => [e.icon, e.group, e.kind, e.pinyin, e.queryOnly]),
      [["file-plus", "template", "template", "muban mb", false], ["file-plus", "template", "template", "muban mb", false]]);
    ok(entries[1].keywords.split(" ").includes("work") && entries[1].keywords.includes("模板"), "keywords: folder and 模板");
    eq(entries[0].keywords, "meeting template templates 模板");
    ok(entries[0].templateFile === app.vault.getAbstractFileByPath("Templates/Meeting.md"), "the TFile rides along");
    ok(entries.every(isTemplateSlashEntry) && !isTemplateSlashEntry(TOC_SLASH_ENTRY) && !isTemplateSlashEntry(null));
    eq(templateSlashEntries(templateApp({ getEnabled: true }).app).length, 2, "getEnabledPluginById is used when present");
    eq(templateSlashEntries(templateApp({ folder: "/Templates" }).app).length, 2, "the folder path is normalised");

    // With the Item 1 search.
    const ids = (query, list = entries, recent) => searchSlashCommands(list, query, F, recent).map((e) => e.id);
    eq(ids("meet")[0], "template:Templates/Meeting.md", "/meet");
    eq(ids("周报"), ["template:Templates/Work/周报.md"], "/周报");
    eq(ids("work"), ["template:Templates/Work/周报.md"], "/work (folder)");
    eq(ids("template"), entries.map((e) => e.id), "/template finds both");
    eq(ids("模板"), entries.map((e) => e.id), "/模板 finds both");
    eq(ids("mb"), entries.map((e) => e.id), "/mb (pinyin) finds both");
    eq(ids(""), entries.map((e) => e.id), "the unfiltered menu lists both");

    // review2-WM-6: only deliberate matches list template rows. The shared keywords "template templates"
    // and the ids "template:….md" no longer answer fragments such as /em, /lat, /pla, /at or /md.
    eq(entries.map((e) => e.minTier), [SLASH_STRONG_TIER, SLASH_STRONG_TIER], "file rows: minTier");
    const picker = templateSlashEntries(templateApp({ folder: undefined }).app);
    eq(picker.map((e) => e.minTier), [SLASH_STRONG_TIER], "the picker row: minTier");
    const NOISE = ["em", "lat", "pla", "at", "ate", "la", "pl", "md", "es", "mp", "emp", "plat", "tmpl", ".md", "templates/"];
    for (const q of NOISE) {
      eq(ids(q), [], `/${q}: no template file rows`);
      eq(ids(q, picker), [], `/${q}: no picker row`);
    }
    for (const q of ["meet", "meeting", "周报", "work", "template", "templ", "temp", "templates", "模板", "mb", "muban"]) {
      ok(ids(q).length > 0, `/${q} still lists a template`);
    }
    for (const q of ["template", "temp", "模板", "mb", "muban"]) eq(ids(q, picker), ["template"], `/${q}: the picker row`);
    // Beside the built-in rows (a slice of main.ts's SLASH_COMMANDS, EN names), as W3 appends them.
    const BUILTIN = [
      { id: "text", name: "Text", keywords: "paragraph plain 正文 文本", pinyin: "wenben wb" },
      { id: "math", name: "Equation block", keywords: "equation latex tex math 公式 数学 方程", pinyin: "gongshi gs" },
      { id: "image", name: "Image / embed", keywords: "picture attach embed 图片 附件 嵌入", pinyin: "tupian tp" },
      { id: "date", name: "Date", keywords: "today date 日期 今天", pinyin: "riqi rq jintian jt" },
    ];
    const menu = (q, list = entries) => searchSlashCommands([...BUILTIN, ...list], q, F).map((e) => e.id);
    eq(menu("em"), ["image"], "/em: Image / embed only");
    eq(menu("lat"), ["math"], "/lat: Equation block only");
    eq(menu("pla"), ["text"], "/pla: Text only");
    for (const q of NOISE) eq(menu(q), menu(q, []), `/${q}: the built-in rows alone`);
    eq(menu("em", picker), ["image"], "/em, no folder: no picker row");
    eq(menu("meet"), ["template:Templates/Meeting.md"], "/meet");
    eq(menu("模板", picker), ["template"], "/模板, no folder");
    // Words inside a name are words of their own, so the gate loses no deliberate search.
    const named = templateSlashEntries(templateApp({
      paths: ["Templates/项目周报.md", "Templates/meeting-notes.md", "Templates/DailyLog.md", "Templates/读书笔记（精读）.md",
        "Templates/工作/会议记录_v2.md"],
    }).app);
    const byName = (q) => searchSlashCommands(named, q, F).map((e) => e.desc.replace("Templates/", ""));
    eq(byName("周报"), ["项目周报"], "/周报 finds 项目周报");
    eq(byName("项目"), ["项目周报"], "/项目");
    eq(byName("周"), ["项目周报"], "/周");
    eq(byName("笔记"), ["读书笔记（精读）"], "/笔记");
    eq(byName("精读"), ["读书笔记（精读）"], "/精读 inside full-width brackets");
    eq(byName("记录"), ["工作/会议记录_v2"], "/记录");
    eq(byName("工作"), ["工作/会议记录_v2"], "/工作 (folder)");
    eq(byName("v2"), ["工作/会议记录_v2"], "/v2 after an underscore");
    eq(byName("notes"), ["meeting-notes"], "/notes after a hyphen");
    eq(byName("log"), ["DailyLog"], "/log in camelCase");
    eq(byName("daily"), ["DailyLog"], "/daily");
    eq(byName("otes"), [], "/otes: a mid-word fragment is not a word");
    eq(named.find((e) => e.desc.endsWith("meeting-notes")).keywords, "meeting-notes meeting notes template templates 模板",
      "keywords: the name, then its words");

    // review2-WM-10 / review2-i18n-w2-04: "$" sequences in a file name are text, not String.replace patterns.
    const DOLLARS = ["Budget $$", "A $& B", "x $' y", "a $` b", "Price $1 $<n>"];
    const dollarApp = templateApp({ paths: DOLLARS.map((n) => `Templates/${n}.md`) }).app;
    const dollar = templateSlashEntries(dollarApp);
    eq(dollar.map((e) => e.name).sort(), DOLLARS.map((n) => `Template · ${n}`).sort(), "labels keep the file name");
    eq(searchSlashCommands(dollar, "budget", F).map((e) => e.name), ["Template · Budget $$"], "/budget finds the real name");

    // More than TEMPLATE_INLINE_LIMIT: one picker row up front, each file still searchable.
    const nine = ["Templates/Meeting.md", ...Array.from({ length: 8 }, (_, i) => `Templates/Note ${i + 2}.md`)];
    const many = templateSlashEntries(templateApp({ paths: nine }).app);
    eq(many.length, 10);
    eq([many[0].id, many[0].name, many[0].queryOnly, many[0].templateFile], ["template", "Template", false, null], "the picker row");
    ok(many.slice(1).every((e) => e.queryOnly === true && e.templateFile), "nine query-only files");
    eq(many.slice(1).map((e) => e.id).slice(0, 3), ["template:Templates/Meeting.md", "template:Templates/Note 2.md", "template:Templates/Note 3.md"],
      "sorted by path, numbers numerically");
    eq(ids("", many), ["template"], "unfiltered: only the picker row");
    eq(ids("meet", many), ["template:Templates/Meeting.md"], "a query finds the file");
    eq(ids("template", many)[0], "template", "/template: the picker row first");
    eq(ids("", many, ["template:Templates/Note 5.md"]), ["template:Templates/Note 5.md", "template"], "a recent file is listed");
    eq(templateSlashEntries(templateApp({ paths: nine.slice(0, 8) }).app).filter((e) => e.queryOnly).length, 0, "eight stay inline");

    // Fallbacks: exactly one picker row.
    const fallback = (label, fake) => {
      const list = templateSlashEntries(fake);
      eq(list.map((e) => [e.id, e.name, e.desc, e.icon, e.keywords, e.pinyin, e.group, e.kind, e.queryOnly, e.templateFile]),
        [["template", "Template", "Insert a template from your templates folder", "file-plus", "template templates 模板", "muban mb",
          "template", "template", false, null]], label);
    };
    for (const folder of [undefined, "", "   ", "/", "Missing", "Templates/Meeting.md", "Empty", 42]) {
      fallback(`folder ${JSON.stringify(folder)}`, templateApp({ folder }).app);
      eq(listTemplateFiles(templateApp({ folder }).app), folder === "Empty" ? [] : null, `listTemplateFiles, folder ${JSON.stringify(folder)}`);
    }
    fallback("plugin disabled", templateApp({ enabled: false }).app);
    fallback("plugin disabled (getEnabledPluginById)", templateApp({ enabled: false, getEnabled: true }).app);
    fallback("no insertTemplate", templateApp({ insert: false }).app);
    fallback("no internalPlugins", { ...app, internalPlugins: undefined });
    eq(templatesInstance(templateApp({ enabled: false }).app), null);

    // Only the active editor gets rows (insertTemplate writes there).
    eq(templateSlashEntries(app, fakeEditor([""])), [], "another editor: nothing");
    eq(templateSlashEntries(app, editor).length, 2, "the active editor: rows");
    eq(templateSlashEntries(templateApp({ folder: undefined }).app, fakeEditor([""])), [], "…the picker row too");

    // runTemplateEntry
    const meeting = (fake) => fake.app.vault.getAbstractFileByPath("Templates/Meeting.md");
    const notices = () => globalThis.__nfNotices ?? [];
    const run = async (lines, from, to, opts = {}) => {
      const fake = templateApp({ lines, ...opts });
      globalThis.__nfNotices = [];
      const file = opts.file === undefined ? meeting(fake) : opts.file;
      const result = await runTemplateEntry(fake.app, opts.editor ?? fake.editor, from, to, file);
      return { ...fake, result, lines: fake.editor.lines, cursor: fake.editor.cursor };
    };
    let r = await run(["# T", "/meet", "after"], { line: 1, ch: 0 }, { line: 1, ch: 5 });
    eq([r.result, r.lines, r.cursor, r.calls], [true, ["# T", "", "after"], { line: 1, ch: 0 }, ["Templates/Meeting.md"]], "/meet on its own line");
    r = await run(["  /meet"], { line: 0, ch: 2 }, { line: 0, ch: 7 });
    eq([r.lines, r.cursor], [[""], { line: 0, ch: 0 }], "leading spaces are not text, and go: the template starts at column 0");
    // review2-WM-5: a bare list, task or quote prefix is not text either. List and task markers
    // go with their indentation (no empty bullet left behind, no indented "## Meeting"); quote markers stay.
    const bare = async (line, label, lines = ["# T", line, "after"]) => {
      const at = line.indexOf("/");
      const got = await run(lines, { line: 1, ch: at }, { line: 1, ch: at + 5 });
      return [got.result, got.lines, got.cursor, got.calls];
    };
    const onLine = (text, ch) => [true, ["# T", text, "after"], { line: 1, ch }, ["Templates/Meeting.md"]];
    eq(await bare("- /meet"), onLine("", 0), "- /meet: the bullet goes");
    eq(await bare("* /meet"), onLine("", 0), "* /meet");
    eq(await bare("+ /meet"), onLine("", 0), "+ /meet");
    eq(await bare("1. /meet"), onLine("", 0), "1. /meet: the number goes");
    eq(await bare("12) /meet"), onLine("", 0), "12) /meet");
    eq(await bare("- [ ] /meet"), onLine("", 0), "- [ ] /meet: the checkbox goes");
    eq(await bare("- [x] /meet"), onLine("", 0), "- [x] /meet");
    eq(await bare("\t- /meet"), onLine("", 0), "\\t- /meet: the indentation goes too");
    eq(await bare("  - [ ] /meet"), onLine("", 0), "  - [ ] /meet");
    eq(await bare("    1. /meet"), onLine("", 0), "    1. /meet");
    eq(await bare("> /meet"), onLine("> ", 2), "> /meet: the quote marker stays");
    eq(await bare(">/meet"), onLine(">", 1), ">/meet");
    eq(await bare("> > /meet"), onLine("> > ", 4), "> > /meet: nested quote markers stay");
    eq(await bare("> - /meet"), onLine("> ", 2), "> - /meet: the bullet goes, the quote stays");
    eq(await bare("> \t- [ ] /meet"), onLine("> ", 2), "> \\t- [ ] /meet");
    eq(await bare("- 中文/meet"), [true, ["# T", "- 中文", "", "after"], { line: 2, ch: 0 }, ["Templates/Meeting.md"]],
      "- 中文/meet: real text before the query, so a fresh line");
    eq(await bare("> 中文 /meet"), [true, ["# T", "> 中文 ", "", "after"], { line: 2, ch: 0 }, ["Templates/Meeting.md"]],
      "> 中文 /meet: text inside a quote, a fresh line");
    eq(await bare("-- /meet"), [true, ["# T", "-- ", "", "after"], { line: 2, ch: 0 }, ["Templates/Meeting.md"]],
      "-- is text, not a list marker");
    eq(await bare("1.5 /meet"), [true, ["# T", "1.5 ", "", "after"], { line: 2, ch: 0 }, ["Templates/Meeting.md"]],
      "1.5 is text");
    eq(await bare("- /meet", "", ["# T", "- /meet tail", "after"]),
      [true, ["# T", " tail", "after"], { line: 1, ch: 0 }, ["Templates/Meeting.md"]], "text after the query stays after the caret");
    r = await run(["中文/meet", "next"], { line: 0, ch: 2 }, { line: 0, ch: 7 });
    eq([r.result, r.lines, r.cursor, r.calls], [true, ["中文", "", "next"], { line: 1, ch: 0 }, ["Templates/Meeting.md"]],
      "mid-line: the template goes on a fresh line");
    r = await run(["/meet", "next"], { line: 0, ch: 0 }, { line: 0, ch: 99 });
    eq([r.lines, r.cursor], [["", "next"], { line: 0, ch: 0 }], "a stale end is clamped to the line");
    r = await run(["/meet", "next"], { line: 0, ch: 0 }, { line: 1, ch: 2 });
    eq([r.result, r.lines, r.calls], [false, ["/meet", "next"], []], "a query never spans lines");
    r = await run(["/meet"], { line: 0, ch: 0 }, { line: 0, ch: 5 }, { editor: fakeEditor(["/meet"]) });
    eq([r.result, r.lines, r.calls, notices()], [false, ["/meet"], [], []], "another editor is active: nothing");
    r = await run(["/meet"], { line: 0, ch: 0 }, { line: 0, ch: 5 }, { enabled: false });
    eq([r.result, r.lines, r.calls, notices()], [false, ["/meet"], [], ["Set a template folder in Settings → Templates first"]],
      "core Templates off: our notice, the query stays");
    r = await run(["/template"], { line: 0, ch: 0 }, { line: 0, ch: 9 }, { file: null });
    eq([r.result, r.lines, r.executed, r.calls, notices()], [true, [""], ["insert-template"], [], []], "the picker row runs the core command");
    const failing = templateApp({ lines: ["/template"] });
    failing.app.commandOk = false;
    globalThis.__nfNotices = [];
    eq(await runTemplateEntry(failing.app, failing.editor, { line: 0, ch: 0 }, { line: 0, ch: 9 }, null), false);
    eq([failing.executed, notices()], [["insert-template"], ["Set a template folder in Settings → Templates first"]],
      "the command fails: one notice");
    const absent = templateApp({ lines: ["/template"] });
    absent.app.commands.findCommand = () => undefined;
    globalThis.__nfNotices = [];
    eq(await runTemplateEntry(absent.app, absent.editor, { line: 0, ch: 0 }, { line: 0, ch: 9 }, null), false);
    eq([absent.editor.lines, absent.executed, notices().length], [["/template"], [], 1], "no core command: the query stays");
    delete globalThis.__nfNotices;
  }

  // ── languages ─────────────────────────────────────────────────────────────
  /** A fake HTMLElement: the Obsidian helpers renderSuggestion uses, recording classes, text and children. */
  const fakeEl = (tag = "div", o = {}) => {
    const el = {
      tag, classes: new Set(String(o.cls ?? "").split(/\s+/).filter(Boolean)), text: o.text ?? "", children: [],
      addClass(...c) { c.flat().forEach((x) => this.classes.add(x)); },
      createEl(t, opts = {}) { const child = fakeEl(t, typeof opts === "string" ? { cls: opts } : opts); this.children.push(child); return child; },
      createDiv(opts) { return this.createEl("div", opts); },
      createSpan(opts) { return this.createEl("span", opts); },
    };
    return el;
  };
  const allOf = (el) => [el, ...el.children.flatMap(allOf)];
  const byClass = (el, cls) => allOf(el).filter((x) => x.classes.has(cls));
  {
    const {
      CODE_LANGUAGE_LIST, CODE_LANGUAGE_ALIASES, canonicalLanguage, findLanguage, languageLabel, languageChange,
      rankLanguages, pushRecentLanguage, LANGUAGE_RECENT_CAP, LANGUAGE_RECENT_KEY, loadRecentLanguages, saveRecentLanguages,
      LanguageSuggestModal, openLanguagePicker,
    } = M;
    // The list.
    const ids = CODE_LANGUAGE_LIST.map((l) => l.id);
    const labels = CODE_LANGUAGE_LIST.map((l) => l.label);
    eq(CODE_LANGUAGE_LIST.length, 40, "40 languages");
    eq(new Set(ids).size, 40, "ids unique");
    ok(ids.every((id) => id === id.toLowerCase()), "ids lower-case");
    eq(new Set(labels).size, 40, "labels unique");
    const lower = labels.map((l) => l.toLowerCase());
    eq(lower, [...lower].sort(), "ordered by lower-case label");
    const aliasOwner = new Map();
    for (const entry of CODE_LANGUAGE_LIST) {
      for (const alias of entry.aliases) {
        ok(!ids.includes(alias), `alias ${alias} is not an id`);
        ok(!aliasOwner.has(alias), `alias ${alias} belongs to one language`);
        aliasOwner.set(alias, entry.id);
      }
    }
    eq(Object.entries(CODE_LANGUAGE_ALIASES).sort(), [...aliasOwner].sort(), "CODE_LANGUAGE_ALIASES is derived from the list");
    ok(Object.values(CODE_LANGUAGE_ALIASES).every((id) => ids.includes(id)), "every alias maps to a listed id");
    ok(Object.isFrozen(CODE_LANGUAGE_ALIASES) && Object.isFrozen(CODE_LANGUAGE_LIST));
    const OLD = "bash c cpp csharp css go html java javascript json markdown mermaid python rust sql typescript yaml";
    const NEW = "kotlin swift php ruby r lua dart scala haskell toml dockerfile diff latex powershell xml graphql";
    for (const id of `${OLD} ${NEW}`.split(" ")) ok(ids.includes(id), `${id} is listed`);

    // canonicalLanguage / languageLabel / languageChange
    const canon = {
      js: "javascript", JSX: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", tsx: "typescript",
      mts: "typescript", cts: "typescript", py: "python", py3: "python", python3: "python", " Py ": "python",
      sh: "bash", zsh: "bash", shell: "bash", yml: "yaml", md: "markdown", "c++": "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp",
      cs: "csharp", "c#": "csharp", "C#": "csharp", rs: "rust", golang: "go", kt: "kotlin", kts: "kotlin", rb: "ruby",
      ps1: "powershell", pwsh: "powershell", tex: "latex", docker: "dockerfile", patch: "diff", gql: "graphql",
      hs: "haskell", objc: "objectivec", ex: "elixir", exs: "elixir", pl: "perl", make: "makefile", mk: "makefile",
      htm: "html", xhtml: "html", dataviewjs: "dataviewjs", DataviewJS: "dataviewjs", "": "", JavaScript: "javascript",
      constructor: "constructor", toString: "tostring",
    };
    for (const [token, id] of Object.entries(canon)) eq(canonicalLanguage(token), id, `canonicalLanguage(${JSON.stringify(token)})`);
    const labelOf = { js: "JavaScript", typescript: "TypeScript", "c++": "C++", cs: "C#", yml: "YAML", DataviewJS: "DataviewJS",
      " dataviewjs ": "dataviewjs", "": "", "  ": "" };
    for (const [token, label] of Object.entries(labelOf)) eq(languageLabel(token), label, `languageLabel(${JSON.stringify(token)})`);
    eq(findLanguage("JS")?.id, "javascript");
    eq(findLanguage("dataviewjs"), null);
    eq(languageChange("js", "javascript"), null, "js + JavaScript: no edit");
    eq(languageChange("js", "typescript"), "typescript");
    eq(languageChange("", ""), null);
    eq(languageChange("python", ""), "", "No language removes it");
    eq(languageChange("JS", "js"), null);
    eq(languageChange("", "dataviewjs"), "dataviewjs");
    eq(languageChange("dataviewjs", "DataviewJS"), null, "a custom token compares case-insensitively");

    // rankLanguages
    const rank = (query, ctx = { current: "" }) => rankLanguages(query, ctx);
    const top = (query, ctx) => rank(query, ctx).map((r) => r.kind === "custom" ? `custom:${r.id}` : r.id || r.kind);
    let rows = rank("", { current: "js" });
    eq([rows[0].id, rows[0].current, rows[0].kind], ["javascript", true, "language"], "the current language leads");
    eq(rows.at(-1).kind, "none", "No language last");
    eq(rows.filter((r) => r.current).length, 1, "one current row");
    eq(rows.length, 41, "40 languages + none, the current one not repeated");
    eq(rank("", { current: "" }).map((r) => r.id), ids, "no language: the plain list, no none row");
    eq(top("", { current: "", recent: ["python", "dataviewjs"] }).slice(0, 3), ["python", "custom:dataviewjs", "bash"], "recents next");
    ok(rank("", { current: "", recent: ["python"] })[0].recent, "recent rows are flagged");
    eq(top("", { current: "py", recent: ["python", "rust", "js"] }).slice(0, 4), ["python", "rust", "javascript", "bash"],
      "the current language is not repeated among recents");
    eq(top("", { current: "dataviewjs" })[0], "custom:dataviewjs", "a custom current language leads");
    eq(top("", { current: "", recent: ["x1", "x2", "x3", "x4", "x5", "x6"] }).slice(0, 6),
      ["custom:x1", "custom:x2", "custom:x3", "custom:x4", "custom:x5", "bash"], `at most ${LANGUAGE_RECENT_CAP} recents`);
    eq(rank("", { current: "PHP", noneLabel: "无语言" }).at(-1).label, "无语言", "noneLabel");

    eq(top("js"), ["javascript", "json"], "/js: JavaScript above JSON, no custom row");
    rows = rank("yml");
    eq([rows[0].id, rows[0].note], ["yaml", "yml"], "/yml: YAML, with the alias as note");
    eq(top("kot"), ["kotlin", "custom:kot"], "/kot: Kotlin and a custom row");
    eq(top("dataviewjs"), ["custom:dataviewjs"], "/dataviewjs: a custom row only");
    ok(top("no", { current: "py", noneLabel: "No language" }).includes("none"), "/no offers No language");
    ok(!top("no", { current: "", noneLabel: "No language" }).includes("none"), "…only when there is a language");
    ok(top("none", { current: "py" }).includes("none"), "/none");
    eq(rank("java")[0].ranges, [[0, 4]], "highlight java in JavaScript");
    eq(rank("jvs").find((r) => r.id === "javascript")?.ranges, [[0, 1], [2, 3], [4, 5]], "fuzzy runs");
    eq(rank("csharp")[0].note, "csharp", "an id the label does not show is the note");
    eq(rank("py")[0].note, "", "no note when the label shows the match");
    eq(top("go")[0], "go", "/go: Go first");
    eq(top("golan")[0], "go", "alias prefix");
    eq(rank("golan")[0].note, "golang");
    eq(top("rust", { current: "", recent: ["ruby"] })[0], "rust", "recency never beats a better tier");
    eq(top("ru", { current: "", recent: ["rust"] }).slice(0, 2), ["rust", "ruby"], "…but breaks a tie");
    eq(top("a b"), [], "a token with a space is no language");
    eq(top("x`y"), [], "…nor one with a backtick");
    eq(rank("DataviewJS").at(-1).id, "DataviewJS", "a custom row keeps the typed case");
    ok(rank("dataviewjs", { current: "dataviewjs" })[0].current, "typing the current custom language marks it current");
    // review2-WM-7: recent (and current) custom languages stay findable while typing.
    const RC = { current: "", recent: ["dataviewjs", "python"] };
    eq(top("", RC).slice(0, 2), ["custom:dataviewjs", "python"], "control: the empty list offers the recent custom language");
    eq(top("data", RC), ["custom:dataviewjs", "custom:data"], "/data: the recent dataviewjs first, the typed fragment last");
    eq(top("dataview", RC), ["custom:dataviewjs", "custom:dataview"], "/dataview");
    eq(top("dataviewj", RC), ["custom:dataviewjs", "custom:dataviewj"], "/dataviewj");
    eq(top("dataviewjs", RC), ["custom:dataviewjs"], "/dataviewjs: the recent row, no duplicate typed row");
    eq(top("DataviewJS", RC), ["custom:dataviewjs"], "…whatever the case, and it writes the stored token");
    eq(top("viewjs", RC), ["custom:dataviewjs", "custom:viewjs"], "substring");
    eq(top("dvjs", RC), ["custom:dataviewjs", "custom:dvjs"], "subsequence");
    rows = rank("data", RC);
    eq([rows[0].kind, rows[0].id, rows[0].label, rows[0].recent, rows[0].current, rows[0].score, rows[0].ranges],
      ["custom", "dataviewjs", "dataviewjs", true, false, 95, [[0, 4]]], "/data: the row, highlighted, prefix 90 + recent 5");
    eq(rank("viewjs", RC)[0].score, 65, "substring 60 + 5");
    eq(rank("dvjs", RC)[0].ranges, [[0, 1], [4, 5], [8, 10]], "fuzzy runs on a custom label");
    eq(top("py", RC)[0], "python", "a recent listed language is unchanged");
    eq(top("ja", { current: "", recent: ["jam"] }), ["custom:jam", "java", "javascript", "custom:ja"],
      "a recent custom prefix breaks the tie with listed prefixes, as a recent listed one does");
    eq(top("java", { current: "", recent: ["javafx"] })[0], "java", "…but never beats a better tier");
    eq(top("tikz", { current: "", recent: ["tikz", "TikZ", "dataviewjs"] }), ["custom:tikz"], "recents deduped case-insensitively");
    eq(top("zz", { current: "", recent: ["a1", "a2", "a3", "a4", "a5", "zz-late"] }), ["custom:zz"],
      `only the ${LANGUAGE_RECENT_CAP} recents the empty list shows`);
    eq(top("zzq", { current: "", recent: ["dataviewjs"] }), ["custom:zzq"], "a recent that does not match stays out");
    rows = rank("data", { current: "dataviewjs" });
    eq([top("data", { current: "dataviewjs" }), rows[0].current, rows[0].recent, rows[0].score],
      [["custom:dataviewjs", "custom:data"], true, false, 90], "the current custom language too, without the recent bonus");
    eq(top("data", { current: "dataviewjs", recent: ["dataviewjs"] }), ["custom:dataviewjs", "custom:data"], "current and recent: once");

    // pushRecentLanguage
    eq(pushRecentLanguage([], "js"), ["javascript"], "canonical");
    eq(pushRecentLanguage(["python", "javascript"], "JS"), ["javascript", "python"], "deduped, most recent first");
    eq(pushRecentLanguage(["a", "b", "c", "d", "e"], "f"), ["f", "a", "b", "c", "d"], "capped");
    eq(pushRecentLanguage(["dataviewjs"], "DataviewJS"), ["DataviewJS"], "a custom token as typed");
    eq(pushRecentLanguage(["python"], ""), ["python"], "No language is not remembered");

    // Storage helpers.
    const store = {};
    const storeApp = { loadLocalStorage: (k) => store[k] ?? null, saveLocalStorage: (k, v) => { store[k] = v; } };
    eq(LANGUAGE_RECENT_KEY, "nf-code-language-recent");
    eq(loadRecentLanguages(storeApp), []);
    saveRecentLanguages(storeApp, ["javascript", "dataviewjs"]);
    eq(loadRecentLanguages(storeApp), ["javascript", "dataviewjs"]);
    store[LANGUAGE_RECENT_KEY] = "garbage";
    eq(loadRecentLanguages(storeApp), [], "not an array");
    store[LANGUAGE_RECENT_KEY] = ["rust", 3, null, " ", "go", "a", "b", "c", "d"];
    eq(loadRecentLanguages(storeApp), ["rust", "go", "a", "b", "c"], "strings only, capped");
    eq(loadRecentLanguages({}), [], "no storage API");
    saveRecentLanguages({}, ["x"]);

    // The modal.
    const saved = [];
    const picked = [];
    const modalApp = { saveLocalStorage: (k, v) => saved.push([k, v]), loadLocalStorage: () => ["python"] };
    const modal = new LanguageSuggestModal(modalApp, { current: "js", recent: [], onPick: (v) => picked.push(v) });
    eq(modal.placeholder, "Search languages");
    eq(modal.instructions, [{ command: "↑↓", purpose: "navigate" }, { command: "esc", purpose: "dismiss" }]);
    eq(modal.limit, 60);
    eq(modal.getSuggestions("ts")[0].id, "typescript");
    eq(modal.getSuggestions("")[0].id, "javascript", "empty: the current language first");
    eq(modal.getSuggestions("").at(-1).label, "No language");
    const jsRow = modal.getSuggestions("")[0];
    modal.onChooseSuggestion(jsRow);
    eq(picked, [], "choosing the current language picks nothing");
    eq(saved, [[LANGUAGE_RECENT_KEY, ["javascript"]]], "…but is remembered");
    modal.onChooseSuggestion(modal.getSuggestions("typescript")[0]);
    eq(picked, ["typescript"]);
    eq(saved.at(-1), [LANGUAGE_RECENT_KEY, ["typescript", "javascript"]]);
    eq(modal.getSuggestions("").slice(0, 3).map((r) => r.id), ["javascript", "typescript", "bash"], "recents update in place");
    modal.onChooseSuggestion(modal.getSuggestions("")[modal.getSuggestions("").length - 1]);
    eq(picked.at(-1), "", "No language");
    eq(saved.length, 2, "No language is not remembered");
    const recentSeen = [];
    const custom = new LanguageSuggestModal(modalApp, { current: "", recent: [], onPick: (v) => picked.push(v), onRecent: (r) => recentSeen.push(r) });
    custom.onChooseSuggestion(custom.getSuggestions("dataviewjs")[0]);
    eq([picked.at(-1), recentSeen], ["dataviewjs", [["dataviewjs"]]], "a custom language, onRecent");
    // review2-WM-7 through the modal: part of a recent custom name, then Enter, writes the whole name.
    const wm7Saved = [];
    const wm7 = new LanguageSuggestModal({ saveLocalStorage: (k, v) => wm7Saved.push(v) },
      { current: "", recent: ["dataviewjs", "python"], onPick: (v) => picked.push(v) });
    const wm7Row = wm7.getSuggestions("dataview")[0];
    wm7.onChooseSuggestion(wm7Row);
    eq([picked.at(-1), wm7Saved], ["dataviewjs", [["dataviewjs", "python"]]], "/dataview + Enter: dataviewjs, recents unchanged");
    const wm7El = fakeEl();
    wm7.renderSuggestion(wm7.getSuggestions("data")[0], wm7El);
    eq([byClass(wm7El, "suggestion-title")[0].textContent, byClass(wm7El, "suggestion-title")[0].__matches],
      ["dataviewjs", [[0, 4]]], "the recent row shows its name with the typed part highlighted");
    eq(byClass(wm7El, "suggestion-note").map((x) => x.text), ["Recent"], "…and reads Recent");
    const wm7Typed = fakeEl();
    wm7.renderSuggestion(wm7.getSuggestions("data").at(-1), wm7Typed);
    eq([byClass(wm7Typed, "suggestion-title")[0].textContent, byClass(wm7Typed, "suggestion-note").map((x) => x.text)],
      ["data", ["Other language…"]], "the typed-token row below it keeps Other language…");
    const wm7Empty = fakeEl();
    wm7.renderSuggestion(wm7.getSuggestions("")[0], wm7Empty);
    eq(byClass(wm7Empty, "suggestion-note").map((x) => x.text), ["Recent"], "the empty list's recent custom row too");

    // renderSuggestion: Obsidian's suggestion markup.
    const render = (row) => { const el = fakeEl(); modal.renderSuggestion(row, el); return el; };
    const current = render(modal.getSuggestions("")[0]);
    ok(current.classes.has("mod-complex"), "mod-complex");
    eq(byClass(current, "suggestion-title").map((x) => x.textContent), ["JavaScript"]);
    eq(byClass(current, "suggestion-flair").length, 1, "one check on the current row");
    eq(byClass(current, "suggestion-flair")[0].__icon, "check");
    ok(byClass(current, "suggestion-flair")[0] === byClass(current, "suggestion-aux")[0].children[0], "flair inside suggestion-aux");
    eq(byClass(render(modal.getSuggestions("")[1]), "suggestion-flair").length, 0, "no check elsewhere");
    const yml = render(modal.getSuggestions("yml")[0]);
    eq(byClass(yml, "suggestion-note").map((x) => x.text), ["yml"], "the alias note");
    eq(byClass(yml, "suggestion-title")[0].__matches, [[0, 1], [2, 4]], "highlight ranges reach renderMatches");
    const customEl = render(modal.getSuggestions("dataviewjs").at(-1));
    eq(byClass(customEl, "suggestion-note").map((x) => x.text), ["Other language…"], "custom row note");
    eq(byClass(customEl, "suggestion-title")[0].__matches, null, "no ranges: null");
    eq(byClass(render(modal.getSuggestions("").at(-1)), "suggestion-title")[0].textContent, "No language");

    // "Other language…" (R2-W3-MAIN): given onOther, the unfiltered list ends with a hand-off row.
    const others = [];
    const withOther = new LanguageSuggestModal(modalApp, { current: "js", recent: [], onPick: (v) => picked.push(v), onOther: () => others.push(1) });
    const otherRow = withOther.getSuggestions("").at(-1);
    eq([otherRow.kind, otherRow.label, withOther.getSuggestions("").at(-2).label], ["other", "Other language…", "No language"], "Other language… after No language");
    ok(!withOther.getSuggestions("py").some((r) => r.kind === "other"), "a typed query has no hand-off row (the typed token is one)");
    ok(!modal.getSuggestions("").some((r) => r.kind === "other"), "no onOther, no row");
    const pickedBefore = picked.length, savedBefore = saved.length;
    withOther.onChooseSuggestion(otherRow);
    eq([others.length, picked.length - pickedBefore, saved.length - savedBefore], [1, 0, 0], "choosing it calls onOther only");
    const otherEl = render(otherRow);
    eq([byClass(otherEl, "suggestion-title")[0].textContent, byClass(otherEl, "suggestion-flair")[0].__icon], ["Other language…", "pencil"], "a pencil marks the hand-off");

    globalThis.__nfOpenedModals = [];
    const opened = openLanguagePicker(modalApp, "", () => {});
    ok(opened instanceof LanguageSuggestModal && globalThis.__nfOpenedModals[0] === opened, "openLanguagePicker opens it");
    eq(opened.getSuggestions("")[0].id, "python", "with the stored recents");
    delete globalThis.__nfOpenedModals;
  }

  // ── zh pass (after every EN assertion) ────────────────────────────────────
  globalThis.window = { localStorage: { getItem: (k) => (k === "language" ? "zh" : null) } };
  try {
    const Z = await import(pathToFileURL(outfile).href + "?zh");
    const names = [];
    Z.registerToggleFoldCommands({ addCommand: (c) => names.push(c.name) }, { view: () => null });
    eq(names, ["折叠全部折叠块", "展开全部折叠块", "折叠或展开全部折叠块"], "zh command names");
    eq([Z.TOC_SLASH_ENTRY.name, Z.TOC_SLASH_ENTRY.desc], ["目录", "链接到每个标题"], "zh TOC entry");
    eq(Z.searchSlashCommands([Z.TOC_SLASH_ENTRY], "目录", { columnLayout: true, toggleBlocks: true }).map((c) => c.id), ["toc"]);
    const i18nSource = await readFile(join(REPO, "src", "i18n.ts"), "utf8");
    if (i18nSource.includes('"Template · {name}"')) {
      const zhApp = templateApp().app;
      eq(Z.templateSlashEntries(zhApp).map((e) => e.name), ["模板 · Meeting", "模板 · 周报"], "zh template names");
      eq(Z.templateSlashEntries(templateApp({ folder: undefined }).app).map((e) => [e.name, e.desc]),
        [["模板", "从模板文件夹插入模板"]], "zh picker row");
      eq(Z.searchSlashCommands(Z.templateSlashEntries(zhApp), "模板", { columnLayout: true, toggleBlocks: true }).length, 2, "/模板 in zh");
      eq(Z.templateSlashEntries(templateApp({ paths: ["Templates/a $` b.md", "Templates/Budget $$.md"] }).app).map((e) => e.name),
        ["模板 · a $` b", "模板 · Budget $$"], "zh labels keep '$' sequences");
      const fake = templateApp({ lines: ["/x"], enabled: false });
      globalThis.__nfNotices = [];
      await Z.runTemplateEntry(fake.app, fake.editor, { line: 0, ch: 0 }, { line: 0, ch: 2 }, fake.app.vault.getAbstractFileByPath("Templates/Meeting.md"));
      eq(globalThis.__nfNotices, ["请先在「设置 → 模板」中设置模板文件夹"], "zh notice");
      delete globalThis.__nfNotices;
    } else {
      console.log("SKIP (pending R2-W2-I18N): zh template names");
    }
    if (i18nSource.includes('"Search languages"')) {
      const zhModal = new Z.LanguageSuggestModal({}, { current: "py", recent: [], onPick: () => {} });
      eq([zhModal.placeholder, zhModal.instructions.map((i) => i.purpose)], ["搜索语言", ["选择", "关闭"]], "zh picker");
      eq(zhModal.getSuggestions("").at(-1).label, "无语言", "zh No language");
      const el = fakeEl();
      zhModal.renderSuggestion(zhModal.getSuggestions("dataviewjs").at(-1), el);
      eq(byClass(el, "suggestion-note").map((x) => x.text), ["其他语言…"], "zh custom note");
      const zhRecent = new Z.LanguageSuggestModal({}, { current: "", recent: ["dataviewjs"], onPick: () => {} });
      const zhEl = fakeEl();
      zhRecent.renderSuggestion(zhRecent.getSuggestions("data")[0], zhEl);
      eq(byClass(zhEl, "suggestion-note").map((x) => x.text), ["最近使用"], "zh recent custom note");
      eq(Z.rankLanguages("无", { current: "py", noneLabel: "无语言" }).map((r) => r.kind), ["none", "custom"], "/无 finds 无语言");
    } else {
      console.log("SKIP (pending R2-W2-I18N): zh language picker");
    }
  } finally {
    delete globalThis.window;
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
console.log(`PASS writing modules: toggle fold, toc, templates, languages (${checks} checks)`);
