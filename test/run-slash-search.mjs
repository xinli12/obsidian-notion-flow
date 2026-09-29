import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Self-bundled, so the new exports are reachable without test/feature-entry.ts.
const REPO = fileURLToPath(new URL("..", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "notion-flow-slash-search-"));
let M;
try {
  const outfile = join(directory, "slash-search.mjs");
  await build({
    stdin: {
      contents: 'export * from "./src/core/slash-search"; export { TOC_SLASH_ENTRY } from "./src/features/toc";',
      resolveDir: REPO, loader: "ts",
    },
    bundle: true, format: "esm", platform: "node", outfile, logLevel: "silent",
  });
  M = await import(pathToFileURL(outfile).href);
} finally {
  await rm(directory, { recursive: true, force: true });
}
const {
  scoreSlashCommand, searchSlashCommands, slashPrefixMatch, slashMatchTier, slashExactMatch,
  SLASH_STRONG_TIER, SLASH_FUZZY_TIER, TOC_SLASH_ENTRY,
} = M;

const commands = [
  { id: "h1", name: "Heading 1", keywords: "title 标题", pinyin: "biaoti bt" },
  { id: "table", name: "Table", keywords: "grid 表格", pinyin: "biaoge bg" },
  { id: "bullet", name: "Bulleted list", keywords: "ul unordered 列表 无序列表", pinyin: "wuxuliebiao wxlb" },
  { id: "todo", name: "To-do list", keywords: "task checkbox 待办 任务", pinyin: "daiban db" },
];
const [h1, , , todo] = commands;
const features = { columnLayout: true, toggleBlocks: true };
const ids = (query, recent = []) => searchSlashCommands(commands, query, features, recent).map((c) => c.id);

// Tiers, from exact id prefix down to fuzzy across every field.
assert.equal(scoreSlashCommand(h1, "h1"), 100);
assert.equal(scoreSlashCommand(h1, "H1"), 100, "queries are case-insensitive");
assert.equal(scoreSlashCommand(h1, "head"), 90);
assert.equal(scoreSlashCommand(h1, "标题"), 80, "keyword word prefix");
assert.equal(scoreSlashCommand(h1, "bt"), 80, "pinyin initials are a word prefix");
assert.equal(scoreSlashCommand(h1, "itl"), 60, "substring of a keyword");
assert.equal(scoreSlashCommand(todo, "tdo"), 40, "fuzzy inside one word");
assert.equal(scoreSlashCommand(h1, "hd1"), 30, "fuzzy across id and name");
const code = { id: "code", name: "Code block", keywords: "fence snippet 代码" };
assert.equal(scoreSlashCommand(code, "cblk"), 30, "abbreviating the visible name works");
assert.equal(scoreSlashCommand(code, "cols"), 0, "letters scattered over keywords are not a match");
assert.equal(scoreSlashCommand(code, "snpt"), 40, "…but a dropped letter inside a keyword is");
assert.equal(scoreSlashCommand(h1, "zzz"), 0);
assert.equal(scoreSlashCommand(h1, ""), 0, "an empty query ranks nothing");
assert.equal(scoreSlashCommand(todo, "tdo", ["todo"]), 55, "recency adds 15");
assert.equal(scoreSlashCommand(todo, "zzz", ["todo"]), 0, "recency never turns a miss into a hit");
assert.equal(scoreSlashCommand({ id: "x", name: "X", keywords: "" }, "x"), 100, "pinyin is optional");

// Fuzzy and pinyin queries surface the intended command first.
assert.equal(ids("hd1")[0], "h1");
assert.equal(ids("bg")[0], "table");
assert.equal(ids("blt")[0], "bullet");
assert.equal(ids("tdo")[0], "todo");
assert.equal(ids("biaoge")[0], "table");
assert.equal(ids("wxlb")[0], "bullet");
assert.deepEqual(ids("zzz"), [], "misses are filtered out");
assert.deepEqual(ids("tdo"), ["todo"]);
assert.deepEqual(ids("blt"), ["bullet", "table"], "looser fuzzy matches trail");

// Equal scores keep the menu's own order; recency breaks the tie.
assert.deepEqual(ids("list"), ["bullet", "todo"]);
assert.deepEqual(ids("list", ["todo"]), ["todo", "bullet"]);
assert.deepEqual(ids("li", ["todo", "bullet"]), ["bullet", "todo"], "both recent: menu order again");
assert.deepEqual(ids("bl", ["bullet"]), ["table", "bullet"], "a recent fuzzy hit still trails a substring match");

// Empty query: recents first (unknown ids ignored), then the original order.
assert.deepEqual(ids(""), ["h1", "table", "bullet", "todo"]);
assert.deepEqual(ids("", ["todo", "missing"]), ["todo", "h1", "table", "bullet"]);

// Feature gates still apply before ranking.
const gated = [{ id: "cols2", name: "Two columns", keywords: "columns" }, { id: "callout", name: "Callout", keywords: "" }];
assert.deepEqual(searchSlashCommands(gated, "c", { columnLayout: false, toggleBlocks: true }).map((c) => c.id), ["callout"]);
assert.deepEqual(searchSlashCommands(gated, "c", features).map((c) => c.id), ["cols2", "callout"]);

// The deprecated prefix helper keeps its behaviour for the remaining caller.
assert.equal(slashPrefixMatch(h1, "hea"), true);
assert.equal(slashPrefixMatch(h1, "标"), true);
assert.equal(slashPrefixMatch(h1, "bt"), false, "prefix helper knows nothing of pinyin");

// ── Noise rule, query-only entries and group passthrough ────────────────────
assert.equal(SLASH_STRONG_TIER, 80);
assert.equal(SLASH_FUZZY_TIER, 40);
assert.equal(slashMatchTier(h1, "hd1"), 30, "the base tier has no recency");
assert.equal(scoreSlashCommand(h1, "hd1"), 30);
assert.equal(scoreSlashCommand(todo, "tdo", ["todo"]), 55, "recency still adds 15");
assert.equal(slashMatchTier(todo, "tdo"), 40);

// A static slice of main.ts's SLASH_COMMANDS (EN names, the pinyin R2-W2-MAIN
// adds) plus the TOC entry and one query-only per-type Callout entry.
const EN = [
  { id: "h1", name: "Heading 1", keywords: "h1 title 标题 一级标题", pinyin: "yijibiaoti yjbt biaoti bt1", group: "basic" },
  { id: "h2", name: "Heading 2", keywords: "h2 subtitle 标题 二级标题", pinyin: "erjibiaoti ejbt biaoti bt2", group: "basic" },
  { id: "bullet", name: "Bulleted list", keywords: "ul unordered 列表 无序列表", pinyin: "wuxuliebiao wxlb", group: "list" },
  { id: "todo", name: "To-do list", keywords: "task checkbox 待办 任务 复选框", pinyin: "daiban db", group: "list" },
  { id: "quote", name: "Quote", keywords: "blockquote 引用", pinyin: "yinyong yy", group: "basic" },
  { id: "callout", name: "Callout", keywords: "note info admonition 标注 提示", pinyin: "biaozhu bz tishi ts", group: "container" },
  { id: "toggle", name: "Toggle", keywords: "fold collapse toggle 折叠 折叠块 收起 展开", pinyin: "zhedie zd", group: "container" },
  { id: "toggle-callout", name: "Foldable callout", keywords: "fold collapse callout 折叠 标注", pinyin: "kezhediebiaozhu kzdbz zhedie zd", group: "container" },
  { id: "cols2", name: "Two columns", keywords: "columns cols layout 分栏 两栏 栏 布局 并排", pinyin: "lianglan ll fenlan fl", group: "container" },
  { id: "code", name: "Code block", keywords: "fence snippet 代码 代码块", pinyin: "daimakuai dmk daima dm", group: "advanced" },
  { id: "table", name: "Table", keywords: "grid 表格", pinyin: "biaoge bg", group: "advanced" },
  { id: "math", name: "Equation block", keywords: "equation latex tex math 公式 数学 方程", pinyin: "gongshikuai gsk gongshi gs", group: "advanced" },
  { id: "datetime", name: "Date and time", keywords: "datetime timestamp now 日期 时间 日期时间", pinyin: "riqishijian rqsj", group: "date" },
  TOC_SLASH_ENTRY,
  { id: "callout-warning", name: "Callout · Warning", keywords: "warning caution attention 警告", pinyin: "jinggao jg", queryOnly: true, group: "container" },
];
const ZH_NAMES = {
  h1: "一级标题", h2: "二级标题", bullet: "无序列表", todo: "待办列表", quote: "引用", callout: "标注", toggle: "折叠块",
  "toggle-callout": "可折叠标注", cols2: "两栏", code: "代码块", table: "表格", math: "公式块", datetime: "日期和时间", toc: "目录",
  "callout-warning": "标注 · 警告",
};
const ZH = EN.map((c) => ({ ...c, name: ZH_NAMES[c.id] }));
const find = (list, query, recent = [], gates = features) => searchSlashCommands(list, query, gates, recent).map((c) => c.id);

for (const [ui, list] of [["en", EN], ["zh", ZH]]) {
  assert.deepEqual(find(list, "toc"), ["toc"], `${ui} /toc: no fuzzy t…o…c inside toggle-callout, two columns, equation`);
  assert.deepEqual(find(list, "code"), ["code"], `${ui} /code: Foldable callout (tier 30) is dropped`);
  assert.deepEqual(find(list, "todo"), ["todo"], `${ui} /todo`);
  assert.deepEqual(find(list, "table"), ui === "en" ? ["table", "toc"] : ["table"],
    `${ui} /table: the EN TOC's name prefix is deliberate`);
  assert.deepEqual(find(list, "bt"), ["h1", "h2"], `${ui} /bt: pinyin (tier 80) drops the fuzzy tail`);
  assert.deepEqual(find(list, "dm"), ["code", "callout"], `${ui} /dm: "admonition" is a substring (60) and stays`);
  assert.deepEqual(find(list, "ll"), ["cols2", "bullet", "callout", "toggle", "toggle-callout", "callout-warning"],
    `${ui} /ll: 两栏 (pinyin 80) leads, the substring 60s trail`);
  assert.deepEqual(find(list, "warning"), ["callout-warning"], `${ui} /warning finds the query-only entry`);
  assert.deepEqual(find(list, "目录"), ["toc"]);
  assert.deepEqual(find(list, "mulu"), ["toc"]);
  assert.ok(!find(list, "").includes("callout-warning"), `${ui}: query-only entries stay out of the unfiltered menu`);
  assert.equal(find(list, "").length, list.length - 1, `${ui}: the unfiltered menu keeps every other entry`);
}
// fix-table-toc-ranking: recency reorders only inside a tier, and an exact
// id / name / pinyin match leads. Once /toc was used, "/table" (and "/tab")
// must still open the table picker, not insert a table of contents.
assert.deepEqual(find(EN, "table", ["toc"]), ["table", "toc"], "en /table after /toc: Table first");
assert.deepEqual(find(EN, "tab", ["toc"]), ["table", "toc"], "en /tab after /toc: the id prefix (100) beats a recent name prefix (90)");
assert.deepEqual(find(EN, "toc", ["table"]), ["toc"], "en /toc after /table");
assert.deepEqual(find(EN, "toc", ["toc"]), ["toc"], "en /toc after /toc");
assert.deepEqual(find(EN, "list", ["todo"]), ["todo", "bullet"], "recency still breaks a tie inside a tier");
assert.deepEqual(find(EN, "callout", ["callout-warning"]).slice(0, 2), ["callout", "callout-warning"],
  "an exact id outranks a recent id prefix of the same tier");
for (const recent of [[], ["toc"], ["table"], ["toc", "table"]]) {
  assert.equal(find(ZH, "表格", recent)[0], "table", `zh /表格 with recent ${recent}`);
  assert.equal(find(ZH, "目录", recent)[0], "toc", `zh /目录 with recent ${recent}`);
  assert.equal(find(ZH, "biaoge", recent)[0], "table", `zh /biaoge with recent ${recent}`);
  assert.equal(find(ZH, "mulu", recent)[0], "toc", `zh /mulu with recent ${recent}`);
  assert.equal(find(EN, "table", recent)[0], "table", `en /table with recent ${recent}`);
}
assert.equal(slashExactMatch(EN.find((c) => c.id === "table"), "TABLE"), true, "exact is case-insensitive");
assert.equal(slashExactMatch(ZH.find((c) => c.id === "table"), "表格"), true, "the zh name");
assert.equal(slashExactMatch(EN.find((c) => c.id === "table"), "bg"), true, "a pinyin word");
assert.equal(slashExactMatch(EN.find((c) => c.id === "toc"), "table"), false, "a name prefix is not exact");
assert.equal(slashExactMatch(EN.find((c) => c.id === "toc"), ""), false, "an empty query is never exact");
assert.deepEqual(find(EN, "hd1"), ["h1"], "nothing strong: tier 30 is kept");
assert.deepEqual(find(EN, "cblk"), ["code"], "nothing strong: tier 30 is kept");
assert.deepEqual(find(ZH, "jg"), ["callout-warning"], "the query-only entry's pinyin");
assert.deepEqual(find(ZH, "标注"), ["callout", "callout-warning", "toggle-callout"], "ties keep menu order: the generic Callout first");
assert.deepEqual(find(EN, "toc", ["math"]), ["toc"], "recency never rescues a dropped fuzzy match");
assert.deepEqual(find(EN, "", ["callout-warning"]).slice(0, 3), ["callout-warning", "h1", "h2"],
  "a recently used query-only entry shows among the recents");
assert.equal(find(EN, "", ["callout-warning"]).length, EN.length, "…once, and not again in the menu body");

// Group passthrough: search never reorders by group.
const co = searchSlashCommands(EN, "co", features);
assert.deepEqual(co.map((c) => c.id), ["cols2", "code", "toggle", "toggle-callout", "toc"]);
assert.deepEqual(co.map((c) => c.group), co.map((c) => EN.find((e) => e.id === c.id).group), "groups travel untouched");
const ungrouped = EN.map(({ group, ...rest }) => rest);
assert.deepEqual(searchSlashCommands(ungrouped, "co", features).map((c) => c.id), co.map((c) => c.id),
  "the ranking is the same without groups");

// Feature gates apply to query-only entries too.
const cols9 = { id: "cols9", name: "Nine columns", keywords: "columns", queryOnly: true };
assert.deepEqual(searchSlashCommands([cols9], "nine", { columnLayout: false, toggleBlocks: true }), []);
assert.deepEqual(searchSlashCommands([cols9], "nine", features).map((c) => c.id), ["cols9"]);
assert.deepEqual(searchSlashCommands([cols9], "", { columnLayout: false, toggleBlocks: true }, ["cols9"]), [],
  "a gated query-only entry is not revived by recency");

// minTier: an entry lists only for a match at its own tier or above (templates use SLASH_STRONG_TIER).
const tpl = { id: "template:Templates/Meeting.md", name: "Template · Meeting", keywords: "meeting template templates 模板",
  pinyin: "muban mb", minTier: SLASH_STRONG_TIER, group: "template" };
const withTpl = [...EN, tpl];
assert.equal(slashMatchTier(tpl, "em"), 60, "the tier itself is unchanged");
for (const q of ["em", "lat", "at", "md", "pla", "tmpl"]) {
  assert.ok(!find(withTpl, q).includes(tpl.id), `/${q}: below minTier, left out`);
  assert.deepEqual(find(withTpl, q), find(EN, q), `/${q}: the other rows are untouched`);
}
for (const q of ["meet", "templ", "template", "模板", "mb", "muban"]) {
  assert.ok(find(withTpl, q).includes(tpl.id), `/${q}: at or above minTier, listed`);
}
assert.ok(!find(withTpl, "em", [tpl.id]).includes(tpl.id), "recency never rescues an entry below its minTier");
assert.equal(find(withTpl, "").at(-1), tpl.id, "minTier does not apply to the unfiltered menu");
assert.deepEqual(find([{ ...tpl, minTier: SLASH_FUZZY_TIER }], "tmpl"), [tpl.id], "a lower minTier admits fuzzy matches");
assert.deepEqual(find([{ ...tpl, minTier: 0 }], "em"), [tpl.id], "minTier 0: every match, as without one");
assert.deepEqual(find([{ ...tpl, minTier: 101 }], "template"), [], "above every tier: never listed for a query");
// A left-out entry does not count as a deliberate match: the fuzzy rows it would have dropped stay.
const gatedOut = { id: "b", name: "Bee", keywords: "hd1x", minTier: 90 };
assert.equal(slashMatchTier(gatedOut, "hd1"), 80, "control: a keyword prefix, below this minTier");
assert.deepEqual(find([h1, gatedOut], "hd1"), ["h1"], "…so Heading 1's fuzzy match (30) is not dropped as noise");

console.log("PASS slash search: score tiers, fuzzy and pinyin ranking, recency, stable ties and gates; " +
  "noise rule, query-only entries and group passthrough; minTier; exact matches lead and recency stays inside a tier");
