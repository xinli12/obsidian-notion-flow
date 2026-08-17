/*
 * Code inside a quote or Callout: colour, copyable text, and the column a
 * wrapped row resumes at.
 *
 * Obsidian's parser never recognises a fence inside a blockquote, so the
 * plugin both tokenizes those rows itself and declares their text column
 * instead of inheriting Obsidian's measured hanging indent. Neither is
 * visible to the other test files: the tokenizer is driven by the editor's
 * CodeMirror 5 shim (stood in for here), and the column is a line class.
 */
import { EditorState } from "@codemirror/state";
import {
  fenceBodyText,
  legacyCodeMirror,
  legacyTokenClass,
  makeCalloutEditPlugin,
  makeNestedIndentPlugin,
  quoteLevelSplit,
  resolveLegacyMode,
  scanFences,
  tokenizeCodeLines,
} from "./bundle.mjs";
import { Text } from "@codemirror/state";

let fail = 0;
let checks = 0;
const ok = (name, cond, extra = "") => {
  checks++;
  if (cond) return;
  fail++;
  console.log(`FAIL ${name}${extra ? " :: " + extra : ""}`);
};
const pass = (name) => {
  checks++;
  console.log(`PASS ${name}`);
};
const eq = (name, actual, expected) =>
  ok(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`
  );

/* ------------------------------------------------------------------ */
/* A stand-in for the editor's CodeMirror 5 shim                       */
/* ------------------------------------------------------------------ */

/** Enough of CodeMirror 5's StringStream for the toy modes below — the
 * same surface the real modes consume. */
class StringStream {
  constructor(text) {
    this.string = text;
    this.start = 0;
    this.pos = 0;
  }
  eol() {
    return this.pos >= this.string.length;
  }
  peek() {
    return this.string.charAt(this.pos) || null;
  }
  next() {
    return this.eol() ? null : this.string.charAt(this.pos++);
  }
  eatWhile(re) {
    let ate = false;
    while (!this.eol() && re.test(this.string.charAt(this.pos))) {
      this.pos++;
      ate = true;
    }
    return ate;
  }
  skipToEnd() {
    this.pos = this.string.length;
  }
}

const WORD = /[A-Za-z_]/;
const KEYWORDS = new Set(["def", "return", "while", "if"]);

/** Words, numbers and a state-carrying triple-quoted string, which is what
 * makes the cross-row tokenizing worth testing. */
const pythonish = {
  name: "python",
  startState: () => ({ inString: false }),
  token(stream, state) {
    if (state.inString) {
      while (!stream.eol()) {
        if (stream.string.startsWith('"""', stream.pos)) {
          stream.pos += 3;
          state.inString = false;
          break;
        }
        stream.pos++;
      }
      return "string";
    }
    if (stream.string.startsWith('"""', stream.pos)) {
      stream.pos += 3;
      state.inString = true;
      return "string";
    }
    const ch = stream.peek();
    if (WORD.test(ch ?? "")) {
      stream.eatWhile(WORD);
      const word = stream.string.slice(stream.start, stream.pos);
      return KEYWORDS.has(word) ? "keyword" : "variable-2";
    }
    if (/[0-9]/.test(ch ?? "")) {
      stream.eatWhile(/[0-9]/);
      return "number";
    }
    stream.next();
    return null;
  },
};

const nullMode = { name: "null", token: (stream) => (stream.skipToEnd(), null) };
/** A mode that consumes nothing — the shape that would hang the editor. */
const stuckMode = { name: "stuck", token: () => "keyword" };

const CM = {
  StringStream,
  findModeByName: (name) =>
    name === "py" ? { name: "python", mime: "text/x-python" } : null,
  getMode: (_config, spec) =>
    spec === "python" || spec === "text/x-python"
      ? pythonish
      : spec === "stuck"
        ? stuckMode
        : nullMode,
};

/* ------------------------------------------------------------------ */
/* 1. Reaching the editor's own modes                                  */
/* ------------------------------------------------------------------ */

ok("no CodeMirror on the window is not an error", legacyCodeMirror(null) === null);
ok("a shim without getMode is refused", legacyCodeMirror({ CodeMirror: {} }) === null);
ok(
  "a shim without StringStream is refused",
  legacyCodeMirror({ CodeMirror: { getMode: () => null } }) === null
);
ok("the real shim is accepted", legacyCodeMirror({ CodeMirror: CM }) === CM);

ok("a known language resolves", resolveLegacyMode(CM, "python") === pythonish);
ok("an alias resolves through the mode table", resolveLegacyMode(CM, "py") === pythonish);
ok("case is not significant", resolveLegacyMode(CM, "Python") === pythonish);
ok("an unknown language stays uncoloured", resolveLegacyMode(CM, "wat") === null);
ok("a fence with no language stays uncoloured", resolveLegacyMode(CM, "  ") === null);
pass("language resolution");

/* ------------------------------------------------------------------ */
/* 2. Token classes are the ones a native code block carries           */
/* ------------------------------------------------------------------ */

eq("no style is no class", legacyTokenClass(null), "");
eq("a style becomes a cm- class", legacyTokenClass("keyword"), "cm-keyword");
eq("compound styles keep every part", legacyTokenClass("string property"), "cm-string cm-property");
eq("a numbered token survives", legacyTokenClass("variable-2"), "cm-variable-2");
eq(
  "line-wide styles are dropped",
  legacyTokenClass("line-background keyword"),
  "cm-keyword"
);

/* ------------------------------------------------------------------ */
/* 3. Tokenizing carries state across rows                             */
/* ------------------------------------------------------------------ */

const rows = tokenizeCodeLines(CM, pythonish, [
  "def check(nums):",
  "",
  '    """doc',
  '    still doc"""',
  "    return 1",
]);
eq(
  "the first row is coloured word by word",
  rows[0].map((span) => [span.from, span.to, span.cls]),
  [
    [0, 3, "cm-keyword"],
    [4, 9, "cm-variable-2"],
    [10, 14, "cm-variable-2"],
  ]
);
eq("a blank row has no tokens", rows[1], []);
ok(
  "an unterminated string keeps colouring the row below it",
  rows[3].some((span) => span.cls === "cm-string"),
  JSON.stringify(rows[3])
);
ok(
  "the row after the string closes is code again",
  rows[4].some((span) => span.cls === "cm-keyword"),
  JSON.stringify(rows[4])
);
ok(
  "every span stays inside its row",
  rows.every((row, i) =>
    row.every((span) => span.from >= 0 && span.to <= ["def check(nums):", "", '    """doc', '    still doc"""', "    return 1"][i].length)
  )
);
// A mode that never advances would spin forever inside the view plugin.
const stuck = tokenizeCodeLines(CM, stuckMode, ["abc"]);
ok("a mode that consumes nothing still finishes", stuck.length === 1);
pass("tokenizing");

/* ------------------------------------------------------------------ */
/* 4. The code a copy button puts on the clipboard                     */
/* ------------------------------------------------------------------ */

const bodyOf = (lines) => {
  const doc = Text.of(lines);
  const fence = scanFences(doc)[0];
  return fenceBodyText(doc, fence);
};

eq(
  "a quoted fence sheds its markers, not its indentation",
  bodyOf(["> ```py", "> def f():", ">     return 1", "> ```"]),
  "def f():\n    return 1"
);
eq(
  "a Callout fence is the same",
  bodyOf(["> [!note] T", "> ```py", "> x = 1", "> ```"].slice(1)),
  "x = 1"
);
eq(
  "a fence in a list sheds the block's indentation only",
  bodyOf(["- item", "  ```py", "  def f():", "      return 1", "  ```"]),
  "def f():\n    return 1"
);
eq(
  "an unclosed fence copies what it has",
  bodyOf(["```py", "x = 1"]),
  "x = 1"
);
eq("an empty fence copies nothing", bodyOf(["```py", "```"]), "");
pass("copyable code");

/* ------------------------------------------------------------------ */
/* 5. The column a wrapped row resumes at                              */
/* ------------------------------------------------------------------ */

const ALL_ON = {
  calloutEditing: true,
  codeBlockEditing: true,
  toggleBlocks: true,
  columnLayout: true,
};

/** Line classes the edit pass puts on each row, with the caret at `anchor`. */
const classesAt = (lines, anchor) => {
  const doc = lines.join("\n");
  const state = EditorState.create({
    doc,
    selection: { anchor: Math.min(anchor, doc.length) },
  });
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    contentDOM: { clientWidth: 700, style: { setProperty() {} } },
    dom: { closest: (sel) => (String(sel).includes("is-live-preview") ? {} : null) },
  };
  const Cls = makeCalloutEditPlugin({ settings: ALL_ON, app: {} });
  const instance = Object.create(Cls.prototype);
  const byLine = new Map();
  for (const range of instance.build.call(instance, view)) {
    if (range.kind !== "line") continue;
    const n = state.doc.lineAt(range.from).number;
    const cls = range.spec?.attributes?.class ?? "";
    byLine.set(n, `${byLine.get(n) ?? ""} ${cls}`.trim());
  }
  return byLine;
};

const CALLOUT = [
  "> [!example] Two Sum",
  "> A long paragraph that wraps in a narrow pane.",
  "> - a list row whose wrap belongs after the bullet",
  "> ```py",
  "> x = 1",
  "> ```",
  "> tail",
];
const inside = classesAt(CALLOUT, CALLOUT[0].length + 4);
const hangs = (n) => (inside.get(n) ?? "").includes("nf-co-hang");
ok("the header row declares its column", hangs(1), inside.get(1));
ok("a prose row declares its column", hangs(2), inside.get(2));
ok("a list row leaves its column to be measured", !hangs(3), inside.get(3));
ok("the fence opener declares no column", !hangs(4), inside.get(4));
ok("a code row declares no column", !hangs(5), inside.get(5));
ok("the fence closer declares no column", !hangs(6), inside.get(6));
ok("the last prose row declares its column", hangs(7), inside.get(7));

// With the caret outside, the Callout is a rendered widget and owns its own
// layout: no source row should be claiming a column.
const outside = classesAt([...CALLOUT, "", "elsewhere"], CALLOUT.join("\n").length + 6);
ok(
  "a closed Callout declares no columns",
  ![...outside.values()].some((cls) => cls.includes("nf-co-hang")),
  JSON.stringify([...outside])
);

// A plain quote has no Callout box, so its rows keep Obsidian's own indent.
const quoted = classesAt(["> plain quote", "> second row"], 3);
ok(
  "a plain quote is untouched",
  ![...quoted.values()].some((cls) => cls.includes("nf-co-hang")),
  JSON.stringify([...quoted])
);

// A toggle strips the Callout box, so its rows have no inset to hang from.
const toggle = classesAt(["> [!nf-toggle]+ T", "> body"], 20);
ok(
  "a toggle declares no column",
  ![...toggle.values()].some((cls) => cls.includes("nf-co-hang")),
  JSON.stringify([...toggle])
);
pass("wrapped-row column");

/* ------------------------------------------------------------------ */
/* 6. The decorations that carry the colour onto the rows              */
/* ------------------------------------------------------------------ */

/** One pass of the nested-block decoration builder, with the editor's
 * CodeMirror shim stood in for. */
const paint = (lines) => {
  const state = EditorState.create({ doc: lines.join("\n") });
  const view = {
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
    dom: { ownerDocument: { defaultView: { CodeMirror: CM } } },
  };
  const Cls = makeNestedIndentPlugin({ settings: ALL_ON, app: {} });
  const instance = Object.create(Cls.prototype);
  instance.view = view;
  instance.fences = scanFences(state.doc);
  instance.codeSpans = new Map();
  return { ranges: collect(instance.build.call(instance, view)), state };
};

/** The nested-block pass builds a real RangeSet (the plugin's other pass
 * returns an array), so flatten it into the same shape. */
function collect(set) {
  const out = [];
  for (const it = set.iter(); it.value; it.next()) {
    out.push({ from: it.from, to: it.to, kind: it.value.kind, spec: it.value.spec });
  }
  return out;
}

const PAINTED = [
  "> [!note] Boxed",
  "> ```py",
  "> def check(nums):",
  ">     return 1",
  "> ```",
  "> tail",
];
const painted = paint(PAINTED);
const marks = painted.ranges.filter((r) => r.kind === "mark");
const textOf = (range) => painted.state.doc.sliceString(range.from, range.to);
const keyword = marks.find((r) => (r.spec?.class ?? "").includes("cm-keyword"));
ok("a quoted fence gets token marks", marks.length > 0);
ok("the keyword is the keyword", keyword && textOf(keyword) === "def", keyword && textOf(keyword));
ok(
  "no mark reaches into the quote markers",
  marks.every((r) => {
    const line = painted.state.doc.lineAt(r.from);
    const prefix = line.text.match(/^\s*>+\s?/)?.[0].length ?? 0;
    return r.from >= line.from + prefix;
  })
);
ok(
  "no mark leaves its row",
  marks.every((r) => r.to <= painted.state.doc.lineAt(r.from).to)
);
ok(
  "the fence rows themselves are never coloured as code",
  marks.every((r) => {
    const n = painted.state.doc.lineAt(r.from).number;
    return n !== 1 && n !== 2 && n !== 5 && n !== 6;
  })
);
// RangeSetBuilder throws on unsorted input, so reaching here at all proves
// the line decorations and these marks interleave correctly. Assert the
// order too, so a future reordering fails here rather than in the editor.
const positions = painted.ranges.map((r) => r.from);
ok(
  "decorations are built in document order",
  positions.every((p, i) => i === 0 || positions[i - 1] <= p)
);

// Without the shim (or with a language it does not know) the rows must
// still paint their code card — just without colour.
const bare = (() => {
  const state = EditorState.create({ doc: PAINTED.join("\n") });
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
  return collect(instance.build.call(instance, view));
})();
ok(
  "no shim means no colour, not no code block",
  bare.every((r) => r.kind !== "mark") &&
    bare.some((r) => (r.spec?.attributes?.class ?? "").includes("nf-qcode"))
);
pass("highlight decorations");

/* ------------------------------------------------------------------ */
/* 7. Which side of the Callout a ">" level is on                      */
/* ------------------------------------------------------------------ */

// `> [!note]` + `> > text`: the second level is a quote INSIDE the box.
eq(
  "an extra level under a top-level Callout is inside it",
  quoteLevelSplit(2, 1, 1),
  { outer: 0, callouts: 1, inner: 1 }
);
// `> > [!note]` + `> > text`: the first level quotes the box itself.
eq(
  "a Callout written inside a quote keeps that level outside",
  quoteLevelSplit(2, 1, 2),
  { outer: 1, callouts: 1, inner: 0 }
);
eq(
  "a plain Callout row splits into nothing but the box",
  quoteLevelSplit(1, 1, 1),
  { outer: 0, callouts: 1, inner: 0 }
);
eq(
  "nested Callouts are all box, no quote",
  quoteLevelSplit(2, 2, 1),
  { outer: 0, callouts: 2, inner: 0 }
);
eq(
  "both sides at once",
  quoteLevelSplit(4, 1, 2),
  { outer: 1, callouts: 1, inner: 2 }
);
eq(
  "a row shallower than its header does not go negative",
  quoteLevelSplit(1, 1, 2),
  { outer: 1, callouts: 1, inner: 0 }
);

const QUOTED = [
  "> [!note] Boxed",
  "> body",
  "> > inner quote",
  "> tail",
];
const insideBox = classesAt(QUOTED, QUOTED[0].length + 3);
ok(
  "a quote nested in a Callout is marked",
  (insideBox.get(3) ?? "").includes("nf-co-quote"),
  insideBox.get(3)
);
ok(
  "an ordinary Callout row is not",
  !(insideBox.get(2) ?? "").includes("nf-co-quote"),
  insideBox.get(2)
);

// The same shape with the Callout itself quoted: no row is inside a quote.
const BOX_IN_QUOTE = ["> > [!note] Boxed", "> > body", "> > more"];
const quotedBox = classesAt(BOX_IN_QUOTE, BOX_IN_QUOTE[0].length + 3);
ok(
  "a Callout inside a quote marks none of its rows",
  ![...quotedBox.values()].some((cls) => cls.includes("nf-co-quote")),
  JSON.stringify([...quotedBox])
);
pass("quote levels inside vs outside the box");

console.log(fail === 0 ? `ALL PASS (${checks} checks)` : `${fail} FAILED`);
process.exit(fail ? 1 : 0);
