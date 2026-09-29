// Every user-facing string in src goes through t("…") and must have a
// Simplified Chinese entry in src/i18n.ts. t() falls back to the English
// key, so a missing entry is invisible at runtime; this scan is what fails.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build, transformSync } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");

/* ---------- the i18n module, straight from the TypeScript source ---------- */
const i18nText = readFileSync(join(srcDir, "i18n.ts"), "utf8");
/** Load src/i18n.ts as a module. `lang` stubs window.localStorage("language")
 *  while it evaluates (DICT is fixed at load). LOADED_AS keeps each variant a
 *  distinct data: URL (Node caches modules by URL; esbuild drops comments). */
async function loadI18n(lang) {
  const { code } = transformSync(`${i18nText}\nexport { ZH };\nexport const LOADED_AS = ${JSON.stringify(String(lang))};\n`, { loader: "ts", format: "esm" });
  const hadWindow = "window" in globalThis;
  if (lang) globalThis.window = { localStorage: { getItem: (key) => (key === "language" ? lang : null) } };
  try {
    return await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  } finally {
    if (lang && !hadWindow) delete globalThis.window;
  }
}
const en = await loadI18n(null);
const zh = await loadI18n("zh");
const { ZH } = en;
assert(ZH && typeof ZH === "object" && Object.keys(ZH).length > 100, "ZH map loaded");
const hasZh = (key) => Object.prototype.hasOwnProperty.call(ZH, key);

/* ---------- source files ---------- */
export function walkTs(dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkTs(path, acc);
    else if (path.endsWith(".ts") && !path.endsWith(".d.ts") && name !== "i18n.ts") acc.push(path);
  }
  return acc;
}

/* ---------- literal extraction ---------- */
// One JS string literal: double-quoted, single-quoted, or a template with
// no substitutions. Escapes are tolerated inside all three.
const LITERAL = String.raw`("(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|` + "`" + String.raw`(?:[^` + "`" + String.raw`\\]|\\[\s\S])*` + "`)";
const LITERAL_RE = new RegExp(`^${LITERAL}$`);
const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

/** The runtime value of a literal token, with \", \', \n, \t and line
 * continuations resolved the way the engine resolves them. */
export function unquote(token) {
  const body = token.slice(1, -1);
  if (token[0] === "`" && body.includes("${")) return null;
  return body.replace(/\\(\r?\n|[\s\S])/g, (_, ch) => {
    if (ch === "n") return "\n";
    if (ch === "t") return "\t";
    if (ch === "\n" || ch === "\r\n") return "";
    return ch;
  });
}

/** The source with comments blanked out (newlines kept, so line numbers
 * survive). String literals are skipped, so a "//" inside a URL or a
 * regex (never preceded by whitespace) is not taken for a comment. */
export function stripComments(text) {
  let out = "", i = 0;
  while (i < text.length) {
    const ch = text[i], next = text[i + 1];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (ch === "/" && next === "/" && (i === 0 || /\s/.test(text[i - 1]))) {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? text.length : end;
      out += " ".repeat(stop - i);
      i = stop;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** The first `count` top-level arguments after `open` (the index of the
 * opening paren), as raw source text; stops at the call's closing paren. */
function leadingArgs(text, open, count) {
  const args = [];
  let depth = 0, start = open + 1, quote = null, i = open + 1;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) { args.push(text.slice(start, i)); break; }
      depth--;
    } else if (ch === "," && depth === 0) {
      args.push(text.slice(start, i));
      start = i + 1;
      if (args.length === count) break;
    }
  }
  return args.slice(0, count).map((arg) => arg.trim());
}

// Module-scope string constants (`const X = "…";` at column 0, the value
// may sit on the next line), so t(X) and settings rows given X resolve.
const CONST_DECL = new RegExp(String.raw`^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*` + LITERAL + String.raw`\s*;`, "gm");
export function topLevelConsts(text) {
  const consts = new Map();
  for (const m of text.matchAll(CONST_DECL)) {
    const value = unquote(m[2]);
    if (value != null) consts.set(m[1], value);
  }
  return consts;
}

// Settings-tab helpers and the argument positions that hold a name or a
// description (translated later by the helper). toggle/colorDropdown take
// the container first. dropdown/colorDropdown also take [value, label]
// option pairs whose labels go through t().
const SETTING_HELPERS = /this\.(toggle|colorDropdown|dropdown|heading|formatField|subheading)\(/g;
const HELPER_TEXT_ARGS = { toggle: [1, 2], colorDropdown: [1, 2], dropdown: [0, 1], heading: [0, 1], formatField: [0, 1], subheading: [0] };
const HELPER_OPTION_ARG = { dropdown: 3, colorDropdown: 4 };
const OPTION_PAIR = new RegExp(String.raw`\[\s*` + LITERAL + String.raw`\s*,\s*` + LITERAL + String.raw`\s*\]`, "g");
// Direct calls: t("…") in any of the three quote styles, spanning lines.
const T_CALL = new RegExp(String.raw`(?<![\w$.])t\(\s*` + LITERAL + String.raw`\s*[,)]`, "g");
// tn("1 block", "{n} blocks", n): both the singular and the plural are keys.
const TN_CALL = new RegExp(String.raw`(?<![\w$.])tn\(\s*` + LITERAL + String.raw`\s*,\s*` + LITERAL + String.raw`\s*,`, "g");
// t(NAME): resolved when NAME is a module-scope string constant; any other
// identifier is a parameter or local whose values other scanners cover.
const T_IDENT = /(?<![\w$.])t\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g;
// Command names built as data and translated later: "Canvas: …" (canvas
// COMMANDS tuples) and "Table: …" (table command list) go through t(name).
const PREFIXED = new RegExp(String.raw`(["'` + "`" + String.raw`])((?:Canvas|Table): (?:(?!\1)[^\\\n]|\\.)*)\1`, "g");
// Data that reaches t() when rendered: help rows ({ keys, words, desc }),
// menu presets ({ title }) and the canvas guide's tuples in help.ts
// ([keys[], text] rows under ["icon", "Title", rows] sections).
const DATA_PROP = new RegExp(String.raw`\b(?:desc|title):\s*` + LITERAL, "g");
const WORDS_PROP = /\bwords:\s*\[([^\]]*)\]/g;
const GUIDE_ROW = new RegExp(String.raw`\[\s*\[[^\[\]]*\]\s*,\s*` + LITERAL, "g");
const GUIDE_SECTION = new RegExp(String.raw`\[\s*` + LITERAL + String.raw`\s*,\s*` + LITERAL + String.raw`\s*,\s*\[`, "g");

/** Every static key `t()` can receive in one file, with the 1-based line
 * of each occurrence. Settings-row names/descriptions that are neither a
 * literal nor a module-scope string constant go to `unresolved`. */
export function collectKeys(source, { guide = false, unresolved = [] } = {}) {
  const text = stripComments(source);
  const consts = topLevelConsts(text);
  const found = [];
  const lineOf = (index) => text.slice(0, index).split("\n").length;
  const add = (token, index) => {
    const key = unquote(token);
    if (key != null) found.push({ key, line: lineOf(index) });
  };
  for (const m of text.matchAll(T_CALL)) add(m[1], m.index);
  for (const m of text.matchAll(TN_CALL)) { add(m[1], m.index); add(m[2], m.index); }
  for (const m of text.matchAll(T_IDENT)) {
    if (consts.has(m[1])) found.push({ key: consts.get(m[1]), line: lineOf(m.index) });
  }
  for (const m of text.matchAll(SETTING_HELPERS)) {
    const helper = m[1];
    const open = m.index + m[0].length - 1;
    const args = leadingArgs(text, open, 5);
    for (const at of HELPER_TEXT_ARGS[helper]) {
      const arg = args[at];
      if (arg === undefined || arg === "") continue;
      if (LITERAL_RE.test(arg)) add(arg, m.index);
      else if (IDENT_RE.test(arg) && consts.has(arg)) found.push({ key: consts.get(arg), line: lineOf(m.index) });
      else unresolved.push({ line: lineOf(m.index), call: `this.${helper}(…)`, arg });
    }
    const options = args[HELPER_OPTION_ARG[helper]];
    if (options?.startsWith("[")) {
      for (const pair of options.matchAll(OPTION_PAIR)) add(pair[2], m.index);
    }
  }
  for (const m of text.matchAll(PREFIXED)) add(`${m[1]}${m[2]}${m[1]}`, m.index);
  for (const m of text.matchAll(DATA_PROP)) add(m[1], m.index);
  for (const m of text.matchAll(WORDS_PROP)) {
    for (const w of m[1].matchAll(new RegExp(LITERAL, "g"))) add(w[1], m.index);
  }
  if (guide) {
    for (const m of text.matchAll(GUIDE_ROW)) add(m[1], m.index);
    for (const m of text.matchAll(GUIDE_SECTION)) add(m[2], m.index);
  }
  return found;
}

/* ---------- self-check of the extractor ---------- */
{
  const sample = [
    'a(t("plain"), t(\'single\'), t(`tick`), t("multi\\nline \\"quoted\\"", 1))',
    "t(\n  'spread'\n)",
    'this.toggle(this.containerEl, "Name", "Desc", "key");',
    'this.heading("Head", "Sub");',
    'this.dropdown("Drop", "Drop desc", "k", [["a", "A"]], { dependsOn: "x" });',
    'const cmds = [["Canvas: do it", "x"]]; const tbl = { name: "Table: sort" };',
    'const skip = t(`with ${sub}`); const notT = format("x"); const attr = t(name);',
    'const rows = [{ keys: [k("a")], desc: "Row text" }, { words: ["Word A", "Word B"], desc: dyn }];',
    'const preset = { title: "Small", width: 240 };',
    'const rows = tn("1 row", "{n} rows", count); const other = xtn("no", "no", 1);',
  ].join("\n");
  const keys = collectKeys(sample).map((entry) => entry.key);
  assert.deepEqual(keys.sort(), [
    "A", "Canvas: do it", "Desc", "Drop", "Drop desc", "Head", "Name", "Row text", "Small", "Sub",
    "Table: sort", "Word A", "Word B", 'multi\nline "quoted"', "plain", "single", "spread", "tick", "1 row", "{n} rows",
  ].sort());
  assert.equal(collectKeys("x\ny\nt(\"third\")")[0].line, 3, "line numbers are 1-based");
  const guide = 'const S = [["icon-name", "Guide title", [\n  [["Tab", "Enter"], "Row one", "keyboard"],\n  [["+"], "Row two"],\n]]];';
  assert.deepEqual(collectKeys(guide, { guide: true }).map((e) => e.key).sort(), ["Guide title", "Row one", "Row two"]);
  assert.deepEqual(collectKeys(guide).map((e) => e.key), [], "guide tuples are only read from the guide file");
  const commented = [
    '/** A destination followed by a title: `dest "title"`. */',
    '// t("commented out") and { desc: "dead" }',
    'const url = "https://x.test/a//b"; const re = /\\/\\//; t("live")',
    '/* block */ t("after block")',
  ].join("\n");
  assert.deepEqual(collectKeys(commented).map((e) => `${e.line}:${e.key}`), ["3:live", "4:after block"]);
  // Identifiers: module-scope constants resolve; settings rows fail on anything else.
  const idents = [
    "const ROW_DESC =",
    '  "Const desc";',
    'function f(label) { const inner = "not top"; t(label); t(inner); }',
    'this.dropdown("Drop two", ROW_DESC, "k", [["a", "Opt A"], ["b", "Opt B"]]);',
    'this.toggle(this.containerEl, "Tog", inner, "key");',
    'this.colorDropdown(this.containerEl, "Col", "Col desc", "k", [["x", "Lead X"]]);',
    'this.subheading("Sub head"); t(ROW_DESC);',
  ].join("\n");
  const unresolved = [];
  const got = collectKeys(idents, { unresolved }).map((e) => `${e.line}:${e.key}`).sort();
  assert.deepEqual(got, [
    "4:Const desc", "4:Drop two", "4:Opt A", "4:Opt B", "5:Tog", "6:Col", "6:Col desc", "6:Lead X",
    "7:Const desc", "7:Sub head",
  ].sort());
  assert.deepEqual(unresolved, [{ line: 5, call: "this.toggle(…)", arg: "inner" }]);
}

/* ---------- the helpers ---------- */
{
  assert.equal(typeof en.t, "function");
  assert.equal(typeof en.tn, "function", "tn() is exported");
  assert.equal(typeof en.tl, "function", "tl() is exported");
  assert.equal(en.tn("1 block selected", "{n} blocks selected", 1), "1 block selected");
  assert.equal(en.tn("1 block selected", "{n} blocks selected", 3), "3 blocks selected");
  assert.equal(en.tn("1 block selected", "{n} blocks selected", 0), "0 blocks selected");
  assert.equal(zh.tn("1 block selected", "{n} blocks selected", 1), "已选择 1 个块");
  assert.equal(zh.tn("1 block selected", "{n} blocks selected", 12), "已选择 12 个块");
  assert.equal(zh.tn("1 unknown", "{n} unknowns", 2), "2 unknowns", "missing keys fall back to English");
  assert.equal(en.tl({ en: "Rosé Pine", zh: "玫瑰松" }), "Rosé Pine");
  assert.equal(zh.tl({ en: "Rosé Pine", zh: "玫瑰松" }), "玫瑰松");
  assert.equal(zh.t("Palette"), "配色方案");
}

/* ---------- dictionary hygiene ---------- */
{
  // A repeated key silently replaces the earlier entry (esbuild only warns).
  const body = stripComments(i18nText.slice(i18nText.indexOf("const ZH"), i18nText.indexOf("\n};")));
  const seen = new Map();
  const KEY_LINE = new RegExp(String.raw`^\s*(` + LITERAL + String.raw`|[A-Za-z_$][\w$]*)\s*:`, "gm");
  for (const m of body.matchAll(KEY_LINE)) {
    const key = LITERAL_RE.test(m[1]) ? unquote(m[1]) : m[1];
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const dupes = [...seen].filter(([, n]) => n > 1).map(([key]) => key);
  assert.deepEqual(dupes, [], `duplicate ZH keys: ${JSON.stringify(dupes)}`);
  for (const key of Object.keys(ZH)) assert.equal(key, key.normalize("NFC"), `ZH key is NFC: ${JSON.stringify(key)}`);
}

/* ---------- pinned values ---------- */
// Exact Chinese agreed with the packages that use these keys in this round.
const PINNED = {
  "1 block": "1 个块",
  "1 block selected": "已选择 1 个块",
  "Copied 1 block.": "已复制 1 个块。",
  "Skipped 1 block with no level to move to.": "已跳过 1 个无法调整层级的块。",
  "Skipped 1 structural block.": "已跳过 1 个结构块。",
  "Flat puts the title inside a Notion-like box; Header strip keeps Obsidian's coloured title bar.": "扁平：标题与正文同在一个类 Notion 的浅色框里；带标题栏：保留 Obsidian 的彩色标题条。",
  "Paste a URL or search notes": "粘贴网址或搜索笔记",
  "Spaces are wrapped in <…>": "空格会用 <…> 包裹",
  "↵ Save · ⇧↵ New line": "↵ 保存 · ⇧↵ 换行",
  "Rosé Pine": "玫瑰松",
  "Catppuccin pastel": "猫咖粉彩",
  "Chinese classic": "国色",
  "Dusty rose, gold and pine from the Rosé Pine palette.": "晨曦与月夜的灰玫瑰、琥珀金与松石。",
  "Latte by day, Mocha by night: candy pastel blocks.": "拿铁配日、摩卡配夜：糖果粉彩色块。",
  "Indigo root, cinnabar, malachite and gamboge in a serif face.": "靛青为根，朱砂、石绿、藤黄分支，宋体字。",
  Vibrant: "缤纷",
  "Vivid ideas": "多彩",
  Vivid: "鲜明",
};
for (const [key, value] of Object.entries(PINNED)) assert.equal(ZH[key], value, `pinned ZH for ${JSON.stringify(key)}`);

// Round 2, wave 2 (R2-W2-I18N): exact Chinese for the keys the wave-2 packages call, the hand-offs and the
// wave-1 carry-over (Blocks C and D in src/i18n.ts). Wording agreed with the lead; do not reword here.
// Checked before the twin and contract checks below, so a changed or deleted key fails as "pinned ZH for …".
const PINNED_W2 = {
  "Toggle underline": "切换下划线",
  "Text color…": "文字颜色…",
  "Highlight color…": "高亮颜色…",
  "Alt-click adds above": "按住 Alt 点击可在上方添加",
  "Dunhuang": "敦煌",
  "Midnight neon": "午夜霓虹",
  "Clear contrast": "清晰对比",
  "Candy pop": "糖果",
  "Retro 70s": "复古",
  "Mural ochre, malachite and lapis on a warm ground.": "壁画赭石、石绿与青金，暖调底色。",
  "Dark-first neon branches that glow on a night canvas.": "为深色而设计的霓虹分支，在夜间白板上格外醒目。",
  "Okabe–Ito colors that stay distinct for color-blind readers.": "Okabe–Ito 配色，色觉障碍读者也能清楚区分。",
  "Bright candy blocks in pill shapes.": "胶囊形状的明快糖果色块。",
  "Rust, mustard and teal in a serif face.": "铁锈红、芥末黄与水鸭青，配宋体字。",
  "Canvas: color scheme · {name}": "白板：配色方案 · {name}",
  "Save as my scheme": "存为我的配色",
  "My schemes": "我的配色",
  "Delete scheme": "删除配色",
  "Scheme name": "配色名称",
  "Map scheme": "导图配色",
  "Canvas colors": "白板颜色",
  "A written color does not follow later light/dark switches": "写入的颜色不会随之后的明暗模式切换而变化",
  "Select a branch to lay it out on its own": "选中一个分支即可单独调整其布局",
  "Canvas: color this branch…": "白板：为此分支上色…",
  "Canvas: auto-color all branches": "白板：为全部分支自动上色",
  "Canvas: find text in map": "白板：在导图中查找文字",
  "Canvas: jump to card…": "白板：跳转到卡片…",
  "Collapse all toggles": "折叠全部折叠块",
  "Expand all toggles": "展开全部折叠块",
  "Collapse or expand all toggles": "折叠或展开全部折叠块",
  "Table of contents": "目录",
  "Links to every heading": "链接到每个标题",
  "Refresh table of contents": "刷新目录",
  "No headings in this note": "此笔记没有标题",
  "Template": "模板",
  "Template · {name}": "模板 · {name}",
  "Insert a template from your templates folder": "从模板文件夹插入模板",
  "Set a template folder in Settings → Templates first": "请先在「设置 → 模板」中设置模板文件夹",
  "Search languages": "搜索语言",
  "Show comments in this note": "查看本笔记的批注",
  "Search comments": "搜索批注",
  "No comments in this note": "此笔记没有批注",
  "Jump to comment": "跳转到批注",
  "Resolve comment": "解决批注",
  "Page style": "页面样式",
  "Page font: Default": "页面字体：默认",
  "Page font: Serif": "页面字体：宋体",
  "Page font: Mono": "页面字体：等宽",
  "Page font: Kai": "页面字体：楷体",
  "Small text": "小号文字",
  "Full width": "全宽",
  "Toggle small text": "切换小号文字",
  "Toggle full width": "切换全宽",
  "Add icon": "添加图标",
  "Add cover": "添加封面",
  "Change cover": "更换封面",
  "Remove cover": "移除封面",
  "Remove icon": "移除图标",
  "Image from vault…": "从库中选择图片…",
  "Reposition": "调整位置",
  "Page icon and cover": "页面图标与封面",
  "Hover above a note's title to add an emoji icon or a cover. Stored in the icon, cover and cover-style properties.": "悬停在笔记标题上方即可添加表情图标或封面，保存在 icon、cover 和 cover-style 属性中。",
  "Background color": "背景颜色",
  "{color} background": "{color}背景",
  "Block color": "块颜色",
  "Icon": "图标",
  "Icon…": "图标…",
  "Default icon": "默认图标",
  "Search icons": "搜索图标",
  "What's new in Notion Flow {version}": "Notion Flow {version} 新功能",
  "Try it": "试一试",
  "Create tour notes in my vault": "在库中创建导览笔记",
  "Release notes on GitHub": "在 GitHub 查看发布说明",
  "Tour notes created in {folder}": "已在 {folder} 中创建导览笔记",
  "Dark only": "仅深色",
  "Preview": "预览",
  // R2-W1-CANVAS: the editing status line. Its entry sits in the wave-1 block of src/i18n.ts (one copy only).
  "Editing · Enter done · Tab child · Shift+Tab up · Shift+Enter new line": "编辑中 · Enter 完成 · Tab 子主题 · Shift+Tab 升级 · Shift+Enter 换行",
  // Hand-offs (R2-W2-SURFMOD, R2-W2-STYLEUI) and the old-form commands of the five wave-2 canvas presets.
  "Mono": "等宽",
  "{label} ({value})": "{label}（{value}）",
  // wave-1 carry-over (R2-W1-CANVAS): newStrings that were only covered through a US twin or CONTRACT presence.
  "Match note palette": "跟随笔记配色",
  "Branch color": "分支颜色",
  "Clear color": "清除颜色",
  "Select a card in a mind map to color its branch.": "选中思维导图中的一张卡片，即可为它所在的分支上色。",
  "Color this branch…": "为此分支上色…",
  "Color schemes, looks, branch lines, typeface, spacing, and boundaries": "配色方案、外观、连线、字体、间距和外框",
  "Solid, colorful topics for brainstorming and presenting.": "实色填充的多彩主题，适合头脑风暴与演示。",
  "Harmonies of your Obsidian accent color.": "由 Obsidian 强调色自动派生的和谐配色。",
};
for (const [key, value] of Object.entries(PINNED_W2)) assert.equal(ZH[key], value, `pinned ZH for ${JSON.stringify(key)}`);

// Plural pairs: each singular reads like its plural with {n} = 1.
const PLURALS = [
  ["1 block", "{n} blocks"],
  ["1 block selected", "{n} blocks selected"],
  ["Copied 1 block.", "Copied {n} blocks."],
  ["Skipped 1 block with no level to move to.", "Skipped {n} blocks with no level to move to."],
  ["Skipped 1 structural block.", "Skipped {n} structural blocks."],
  ["1 component keeps your own setting and does not follow the style: {list}", "{n} components keep your own setting and do not follow the style: {list}"],
];
for (const [one, many] of PLURALS) assert.equal(ZH[one], ZH[many]?.replace("{n}", "1"), `singular of ${JSON.stringify(many)}`);
for (const key of Object.keys(ZH).filter((k) => /\{n\} (?:\w+ )?blocks\b/.test(k))) {
  assert(PLURALS.some(([, many]) => many === key), `"{n} … blocks" key without a singular: ${JSON.stringify(key)}`);
}

// Canvas: the style panel names a group, a preset and a look; no two share a word.
// (Preset commands are one key since wave 2: "Canvas: color scheme · {name}".)
assert.equal(new Set([ZH.Vibrant, ZH["Vivid ideas"], ZH.Vivid]).size, 3, "Vibrant / Vivid ideas / Vivid are distinct in ZH");

// US spelling: every key spelled "colour" has a "color" twin with the same Chinese,
// so call sites can switch in any order.
for (const key of Object.keys(ZH).filter((k) => /colour/i.test(k))) {
  const twin = key.replace(/olour/g, "olor");
  assert.equal(ZH[twin], ZH[key], `US twin for ${JSON.stringify(key.slice(0, 60))}`);
}

// Keys reserved for later packages (DESIGN-SPEC §9 note style): present now,
// reached once the settings gallery and switcher land.
const CONTRACT = [
  "Note style",
  "One palette and one look for everything the plugin draws in your notes. Display only: your Markdown never changes.",
  "Palette", "Paper background", "Theme background", "Note page", "Whole app",
  "Designed for the default theme; a community theme may only partly follow.",
  "Tinted headings", "Links use the palette", "Note look", "Try the {look} look with this palette", "Apply",
  "{n} components keep your own setting and do not follow the style: {list}",
  "1 component keeps your own setting and does not follow the style: {list}",
  "Follow the style for all", "Customize components", "{n} changed", "Follow look ({value})", "Follow palette",
  "Side rail", "Soft card", "Outlined", "Icon only", "Gradient title",
  "Heading accents", "Unadorned", "Hairline rule", "Accent bar", "Fading underline", "Editorial",
  "Highlight style", "Flat fill", "Marker pen", "Underline band",
  "Table look", "Rounded grid", "Three-line table", "Card",
  "Quote style", "Side bar", "Pull quote", "Tinted",
  "Bullet style", "Dot", "Dash", "Diamond",
  "To-do checkbox", "Rounded square", "Circle", "Ink square", "Soft tick",
  "Divider style", "Fading hairline", "Solid hairline", "Three dots", "Ornament ✦",
  "Toggle arrow", "Chevron", "Filled triangle", "Guide line",
  "Column divider", "No divider", "Hairline divider",
  "Inline code look", "Soft pill", "Tinted pill", "Outlined pill", "Text only",
  "Decoration color", "Accent color", "Neutral gray", "Palette color",
  "Change note style…", "Search palettes and looks", "preview", "apply", "switch group", "restore",
  "Note style: {palette} · {look}",
  "Maps follow the note palette",
  "Mind maps without a palette of their own use the one paired with the note palette. Nothing is written to the canvas.",
  "Match note palette",
];
const contractMissing = CONTRACT.filter((key) => !hasZh(key));
assert.deepEqual(contractMissing, [], "note-style contract keys have ZH");

/* ---------- ZH glossary (R2-W2-I18N) ---------- */
// settings-06: one Chinese word per concept, as in Notion's and XMind's Chinese UIs. Values only; keys stay English.
//   Duplicate → 创建副本 (创建块副本 / 创建行副本)   Turn into → 转为   Callout → 标注 (Latin only as 标注（Callout）)
//   mind-map items → 主题 / 子主题 / 同级主题 / 父主题   Resolve → 解决   block selection → 块选择
//   full-width ，（） next to Chinese; UI names quoted with 「」.
const GLOSSARY = {
  Duplicate: "创建副本",
  "Duplicate block": "创建块副本",
  "Duplicate row": "创建行副本",
  "Table: duplicate row": "表格：创建行副本",
  "Turn into": "转为",
  "Turn into text": "转为正文",
  "Turn into Callout": "转为标注（Callout）",
  "Repair nested Callout": "修复列表内标注（Callout）",
  Callout: "标注",
  "Add child": "子主题",
  "Add sibling": "同级主题",
  "Add sibling above": "在上方新建同级主题",
  "Go to parent": "选中父主题",
  Resolve: "解决",
  "Show a styled card with Edit and Resolve when hovering commented text.": "悬停批注文字时显示带「编辑」「解决」的卡片。",
  "Block selection": "块选择",
};
for (const [key, value] of Object.entries(GLOSSARY)) assert.equal(ZH[key], value, `glossary ZH for ${JSON.stringify(key)}`);

// Banned variants, checked on ZH values only (keys stay English).
const BANNED = [
  [/转换为/, "Turn into is 转为"],
  [/再制/, "Duplicate is 创建副本"],
  [/复制块(?!链接)/, "Duplicate block is 创建块副本 (复制块链接 = Copy link to block is fine)"],
  [/复制行/, "Duplicate row is 创建行副本"],
  [/(子|同级|父)节点/, "mind-map items are 主题 / 子主题 / 同级主题 / 父主题"],
  [/解除批注|「解除」/, "Resolve is 解决 (解决批注)"],
  [/[一-龥],/, "full-width ， after Chinese"],
  [/,(?=[一-龥])/, "full-width ， before Chinese"],
  [/[一-龥]\(/, "full-width （ after Chinese"],
  [/(?<!（)Callout/, "Callout is 标注; Latin only as 标注（Callout）"],
  [/[“”]/, "UI names are quoted with 「」"],
];
const banned = (value) => BANNED.filter(([re]) => re.test(value)).map(([, rule]) => rule);
// The patterns themselves: correct wording passes, each old variant fails.
for (const ok of ["复制块链接", "创建块副本", "转为标注（Callout）", "选中文本后粘贴 URL，自动生成 [文本](链接)。", "解决批注", "「编辑」「解决」", "默认高亮（==）"]) {
  assert.deepEqual(banned(ok), [], `glossary pattern over-matches ${ok}`);
}
for (const bad of ["转换为正文", "再制", "复制块", "表格：复制行", "新建子节点", "同级节点", "返回父节点", "解除批注", "带「编辑」「解除」", "手柄,可", "URL,自动", "默认高亮(==)", "修复列表内 Callout", "“Obsidian 自适应”"]) {
  assert(banned(bad).length > 0, `glossary pattern misses ${bad}`);
}
const violations = [];
for (const [key, value] of Object.entries(ZH)) {
  for (const rule of banned(value)) violations.push(`  ${rule}: ${JSON.stringify(key.length > 70 ? key.slice(0, 67) + "…" : key)} => ${JSON.stringify(value.length > 60 ? value.slice(0, 57) + "…" : value)}`);
}
assert.equal(violations.length, 0, `${violations.length} ZH value(s) break the glossary:\n${violations.join("\n")}`);

// Structure: prefixes and concept words follow their English key.
const STRUCTURE = [
  [/^Canvas: /, (v) => v.startsWith("白板："), "Canvas: → 白板："],
  [/^Table: /, (v) => v.startsWith("表格："), "Table: → 表格："],
  [/^Turn into\b/, (v) => v.startsWith("转为"), "Turn into → 转为…"],
  [/duplicat/i, (v) => v.includes("副本"), "duplicate → …副本"],
  [/\bresolve\b/i, (v) => v.includes("解决"), "resolve → 解决"],
  [/callout/i, (v) => v.includes("标注"), "callout → 标注"],
];
const misfits = [];
for (const [key, value] of Object.entries(ZH)) {
  for (const [re, ok, rule] of STRUCTURE) if (re.test(key) && !ok(value)) misfits.push(`  ${rule}: ${JSON.stringify(key.slice(0, 70))} => ${JSON.stringify(value.slice(0, 60))}`);
}
assert.equal(misfits.length, 0, `${misfits.length} ZH value(s) do not follow their key:\n${misfits.join("\n")}`);

// Placeholders survive translation: {n}, {name}, {color}, {version} … appear in both, same set.
const placeholders = (s) => [...s.matchAll(/\{[A-Za-z]+\}/g)].map((m) => m[0]).sort().join(" ");
for (const [key, value] of Object.entries(ZH)) {
  assert.equal(placeholders(value), placeholders(key), `placeholders of ${JSON.stringify(key.slice(0, 70))}`);
}

// Chords survive translation byte for byte, so a later keyLabel() expansion after t() (R2-W2-MAIN) works in both languages.
const CHORD = /(?:Mod|Cmd\/Ctrl|Ctrl\/Cmd|Alt|Shift)(?:\+(?:Mod|Alt|Shift|Ctrl))*\+(?:Enter|Tab|Space|Backspace|Delete|Esc|F\d+|[A-Z0-9]|\/|\[|\])(?![A-Za-z])/g;
for (const [key, value] of Object.entries(ZH)) {
  for (const m of key.matchAll(CHORD)) assert(value.includes(m[0]), `chord ${m[0]} kept in the ZH of ${JSON.stringify(key.slice(0, 70))}`);
}

/* ---------- round 2, wave 3 (R2-W3-I18N) ---------- */
// Exact Chinese for the keys the wave-3 packages call (Block E in src/i18n.ts, pinned by the lead), plus every
// Block F key the final sweep kept because a call site uses it. Do not reword here.
const PINNED_W3 = {
  "Basic blocks": "基础块",
  "Lists": "列表",
  "Callouts & toggles": "标注与折叠块",
  "Media & tables": "媒体与表格",
  "Advanced": "高级",
  "Dates": "日期",
  "Callout · {type}": "标注 · {type}",
  "Move to…": "移动到…",
  "Turn into page": "转为页面",
  "Collapse all in note": "折叠本页全部",
  "Expand all in note": "展开本页全部",
  "{n}% width": "{n}% 宽度",
  "Full column width": "整栏宽度",
  "Bullet and number styles by list depth are unaffected.": "不影响按层级变化的项目符号和编号样式。",
  "Preview: {value}": "预览：{value}",
  "Table: paste clipboard as table": "表格：将剪贴板粘贴为表格",
  "Table: format": "表格：格式化",
  "the style panel (canvas toolbar → Style)": "「样式」面板（白板工具栏 → 样式）",
  "Settings → Hotkeys": "设置 → 快捷键",
  // Existing keys wave 3 leans on: Card sizing's EN option becomes "Roomy" (stored value stays "comfortable"),
  // and the code-theme option loses its one-sided (recommended) tag (settings-16).
  Roomy: "宽松",
  "Obsidian adaptive": "Obsidian 自适应",
  // Block F keys that are reached on the merged tree (the wave-3 sweep deleted the unreached ones).
  "Apply display-only polish to quotes, dividers, headings, tasks, inline code, and Mermaid diagrams in Live Preview and Reading view. Bullet and number styles by list depth are unaffected. Your Markdown is never changed.": "只优化实时预览和阅读视图中的引用、分割线、标题、任务、行内代码与 Mermaid 图表外观。不影响按层级变化的项目符号和编号样式，也不会修改 Markdown 内容。",
  "Roomy adds breathing room; Compact keeps topics small and needs Canvas appearance; Preserve width keeps your chosen width and fits only the height. Applies when text changes or you fit cards to content.": "宽松：卡片更易读易点；紧凑：节省空间，需开启「白板外观」；保留手动宽度：只调整高度。修改文字或使用「卡片贴合内容」时生效。",
  "Needs Drag-and-drop blocks": "需要开启块拖拽",
  "Heading 4": "四级标题",
  "Heading 5": "五级标题",
  "Heading 6": "六级标题",
  "List": "列表",
  // Keys the wave-3 sweep added for R2-W3-MAIN's call sites ("Round 2, wave 3 sweep" in src/i18n.ts).
  "Nothing to color in this block": "此块没有可上色的内容",
  "Untitled": "未命名",
  "The note changed, so the block was left in place.": "笔记已更改，块保留在原处。",
  "Could not create the page.": "无法创建页面。",
  "Image alignment": "图片对齐",
  "Needs Comments": "需要开启批注",
  "Chords for turning, wrapping, inserting, moving and selecting blocks. All are rebindable under {path}.": "用于转换、包裹、插入、移动和选择块的组合键，均可在「{path}」中重新绑定。",
  "The look of maps that have not picked their own in {panel}. Clean: a tinted central topic, soft pills for main branches, plain words for subtopics. Cards: every topic keeps its card. Vivid: solid colorful topics. Minimal: words and lines only. Pastel: soft color blocks without outlines. Gradient: glowing gradient topics. Cards that hold files, images, or links always stay cards.": "未在{panel}中单独设置样式的导图使用此样式。简洁：中心主题着色，主干为柔和的圆角块，子主题为纯文字。卡片：每个主题都保留卡片外框。鲜明：实色填充的彩色主题。极简：只有文字和连线。柔彩：无描边的柔和色块。渐变：带光晕的渐变主题。含文件、图片或链接的卡片始终保持卡片样式。",
  "How maps draw their branches unless they pick their own in {panel}. Automatic: tapered branches for mind maps and logic charts, right-angled elbows for org charts, trees, and timelines.": "未在{panel}中单独设置连线的导图使用此样式。自动：思维导图和逻辑图用渐细的有机连线，组织结构图、树状图和时间轴用圆角折线。",
  "The typeface of maps that have not picked their own in {panel}. Note font follows Obsidian's text font; Kai uses LXGW WenKai or the system Kaiti when installed.": "未在{panel}中单独设置字体的导图使用此字体。跟随笔记：使用 Obsidian 的正文字体；楷体：优先使用已安装的霞鹜文楷，其次为系统楷体。",
  "The outline of topic cards in maps that have not picked their own in {panel}: rounded corners, pills, square corners, or words on an underline.": "未在{panel}中单独设置形状的导图使用此形状：圆角、胶囊、直角，或只在文字下方画一条线。",
  "At the start of a list item, to-do or heading, Backspace removes its marker in one step.": "在列表项、待办或标题开头按退格，一步移除其标记。",
  "Highlights of this release, and hands-on tour notes you can add to your vault.": "本版本的新功能，以及可以添加到库中的上手导览笔记。",
  // Canvas count singulars (w1c-canvas-count-singular-keys; picked by cardCount() in src/canvas/enhancements.ts).
  "Copied 1 card as a Markdown outline.": "已将 1 张卡片复制为 Markdown 大纲。",
  "Created 1 card from the list.": "已从列表生成 1 张卡片。",
  "Pasted 1 card as a branch.": "已粘贴为 1 张分支卡片。",
  "Unfold 1 card: {names}": "展开 1 张卡片：{names}",
  "Mapped 1 card from the note.": "已由笔记生成 1 张卡片。",
  "Exported 1 card to {path}.": "已将 1 张卡片导出到 {path}。",
};
for (const [key, value] of Object.entries(PINNED_W3)) assert.equal(ZH[key], value, `pinned ZH for ${JSON.stringify(key)}`);

// Canvas counts: each singular reads like its plural with {count} = 1.
const CARD_PLURALS = [
  ["Copied 1 card as a Markdown outline.", "Copied {count} cards as a Markdown outline."],
  ["Created 1 card from the list.", "Created {count} cards from the list."],
  ["Pasted 1 card as a branch.", "Pasted {count} cards as branches."],
  ["Unfold 1 card: {names}", "Unfold {count} cards: {names}"],
  ["Mapped 1 card from the note.", "Mapped {count} cards from the note."],
  ["Exported 1 card to {path}.", "Exported {count} cards to {path}."],
];
for (const [one, many] of CARD_PLURALS) {
  assert(hasZh(many), `canvas count plural has ZH: ${JSON.stringify(many)}`);
  assert.equal(ZH[one], ZH[many].replace("{count}", "1"), `singular of ${JSON.stringify(many)}`);
}

// settings-16 copy, on ZH values: no one-sided (recommended) tag, Hotkeys live under 设置 → 快捷键, the canvas
// style panel has one name, and no "list cycles" jargon.
const BANNED_W3 = [
  [/（推荐）|\(推荐\)/, "no one-sided (recommended) tag: the English option has none"],
  [/Obsidian → 快捷键/, "Hotkeys are under 设置 → 快捷键"],
  [/「样式」菜单/, "the canvas Style menu is the style panel: 「样式」面板（白板工具栏 → 样式）"],
  [/列表循环/, "say 按层级变化的项目符号和编号样式, not 列表循环"],
];
const bannedW3 = (value) => BANNED_W3.filter(([re]) => re.test(value)).map(([, rule]) => rule);
for (const ok of ["Obsidian 自适应", "均可在「设置 → 快捷键」中重新绑定。", "未在「样式」面板（白板工具栏 → 样式）中", "不影响按层级变化的项目符号和编号样式"]) {
  assert.deepEqual(bannedW3(ok), [], `wave-3 pattern over-matches ${ok}`);
}
for (const bad of ["Obsidian 自适应（推荐）", "「Obsidian → 快捷键」", "未在「样式」菜单中", "列表循环独立保持启用"]) {
  assert(bannedW3(bad).length > 0, `wave-3 pattern misses ${bad}`);
}
const violationsW3 = [];
for (const [key, value] of Object.entries(ZH)) {
  for (const rule of bannedW3(value)) violationsW3.push(`  ${rule}: ${JSON.stringify(key.slice(0, 70))} => ${JSON.stringify(value.slice(0, 60))}`);
}
assert.equal(violationsW3.length, 0, `${violationsW3.length} ZH value(s) break the wave-3 copy rules:\n${violationsW3.join("\n")}`);

// Pinned fragments: a key that carries one of these English phrases carries its Chinese, so the full settings
// descriptions R2-W3-MAIN rewrites read the same as the pinned words.
const PANEL_ZH = "「样式」面板（白板工具栏 → 样式）";
const FRAGMENTS = [
  ["Settings → Hotkeys", "设置 → 快捷键"],
  ["the style panel (canvas toolbar → Style)", PANEL_ZH],
  ["Bullet and number styles by list depth are unaffected", "不影响按层级变化的项目符号和编号样式"],
];
const fragmentMisses = [];
for (const [key, value] of Object.entries(ZH)) {
  for (const [en, zhText] of FRAGMENTS) if (key.includes(en) && !value.includes(zhText)) fragmentMisses.push(`  ${JSON.stringify(key.slice(0, 70))} lacks ${zhText}`);
  // The Default-look settings rows name the panel the same way, whatever their English says.
  if (/style panel|Style menu/.test(key) && /their own/.test(key) && !value.includes(PANEL_ZH)) fragmentMisses.push(`  ${JSON.stringify(key.slice(0, 70))} lacks ${PANEL_ZH}`);
}
// Rows that take the pinned words as a placeholder (the settings tab substitutes {panel} / {path} after t()) compose
// to the same Chinese, quoted once.
const COMPOSED = [
  [/their own in \{panel\}/, "{panel}", "the style panel (canvas toolbar → Style)", PANEL_ZH],
  [/rebindable under \{path\}/, "{path}", "Settings → Hotkeys", "「设置 → 快捷键」"],
];
for (const [key, value] of Object.entries(ZH)) {
  for (const [re, slot, fill, zhText] of COMPOSED) {
    if (!re.test(key)) continue;
    const full = value.split(slot).join(ZH[fill]);
    if (!full.includes(zhText) || /「「|」」/.test(full)) fragmentMisses.push(`  ${JSON.stringify(key.slice(0, 70))} composes to ${JSON.stringify(full.slice(0, 40))}, not ${zhText}`);
  }
}
assert.equal(fragmentMisses.length, 0, `${fragmentMisses.length} ZH value(s) miss a pinned fragment:\n${fragmentMisses.join("\n")}`);

// Names composed at runtime from data tables read fully in Chinese: "Callout · {type}" takes CALLOUT_TYPES labels,
// "{color} background" / "{color} text" take COLOR_LABELS values. The scan cannot see these, so read the tables.
const sources = walkTs(srcDir).map((file) => stripComments(readFileSync(file, "utf8")));
function tableValues(name, closer, valueRe) {
  for (const text of sources) {
    const at = text.search(new RegExp(String.raw`\bconst\s+${name}\b`));
    if (at < 0) continue;
    const end = text.indexOf(closer, at);
    return [...text.slice(at, end < 0 ? undefined : end).matchAll(valueRe)].map((m) => unquote(m[1]));
  }
  return [];
}
const calloutLabels = tableValues("CALLOUT_TYPES", "\n];", new RegExp(String.raw`\blabel:\s*` + LITERAL, "g"));
const colorLabels = tableValues("COLOR_LABELS", "\n};", new RegExp(String.raw`:\s*` + LITERAL, "g"));
assert(calloutLabels.length >= 10, `CALLOUT_TYPES labels found (${calloutLabels.length}); if the table moved or was renamed, update tableValues()`);
assert(colorLabels.length >= 9, `COLOR_LABELS values found (${colorLabels.length}); if the table moved or was renamed, update tableValues()`);
assert.deepEqual(calloutLabels.filter((k) => !hasZh(k)), [], "every CALLOUT_TYPES label has ZH (Callout · {type})");
assert.deepEqual(colorLabels.filter((k) => !hasZh(k)), [], "every COLOR_LABELS value has ZH ({color} background / {color} text)");
assert.equal(ZH["Callout · {type}"].replace("{type}", ZH.Tip), "标注 · 提示", "Callout · Tip composes");

// Swept keys stay gone (the final sweep fills this list; see sweep.mjs --delete).
const REMOVED_W3 = [
  "The typeface of maps that have not picked their own in the style panel. Note font follows Obsidian's text font; Kai uses LXGW WenKai or the system Kaiti when installed.",
  "Colour schemes, looks, branch lines, typeface, spacing, and boundaries",
  "Canvas: colour branch",
  "Branch colour",
  "Clear colour",
  "Select a card in a mind map to colour its branch.",
  "The outline of topic cards in maps that have not picked their own in the style panel: rounded corners, pills, square corners, or words on an underline.",
  "Canvas: Soft mist preset",
  "Canvas: Sea salt preset",
  "Canvas: Sakura preset",
  "Canvas: Macaron preset",
  "Canvas: Forest preset",
  "Canvas: Sunset preset",
  "Canvas: Journal preset",
  "Canvas: Nordic preset",
  "Canvas: Morandi preset",
  "Canvas: Vivid ideas preset",
  "Canvas: Aurora preset",
  "Canvas: Theme accent preset",
  "Canvas: Quiet ink preset",
  "Canvas: Ink wash preset",
  "Canvas: Business preset",
  "Comfortable",
  "Comfortable adds breathing room; Compact keeps topics small; Preserve width keeps your chosen width and fits only the height. Applies when text changes or you fit cards to content.",
  "Grow ideas, arrange branches, and keep their wider context.",
  "The look of maps that have not picked their own in the canvas toolbar's style panel. Clean: a tinted central topic, soft pills for main branches, plain words for subtopics. Cards: every topic keeps its card. Vivid: solid colourful topics. Minimal: words and lines only. Pastel: soft colour blocks without outlines. Gradient: glowing gradient topics. Cards that hold files, images, or links always stay cards.",
  "Canvas: find card",
  "Canvas: color branches",
  "How maps draw their branches unless they pick their own from the Style menu. Automatic: tapered branches for mind maps and logic charts, right-angled elbows for org charts, trees, and timelines.",
  "Editing",
  "Core controls for writing, inserting, formatting, and moving blocks.",
  "Combine table editing, visual styling, header tint, and stripes independently.",
  "Tune Markdown rendering and colors without changing the meaning of your notes.",
  "Enter saves · Shift+Enter breaks the line",
  "Apply display-only polish to quotes, dividers, headings, tasks, inline code, and Mermaid diagrams in Live Preview and Reading view. List cycles stay enabled independently. Your Markdown is never changed.",
  "Open documentation and guided example notes in English or Chinese.",
  "Plugin version, source code, and issue reporting.",
  "Destinations with spaces are wrapped in <…>",
  "At the start of a list or to-do item, Backspace turns it back into plain text in one step.",
  "Paste as table",
  "Colour this branch…",
  "Pick a colour from the toolbar first",
  "Behaviour",
  "Chords for turning, wrapping, inserting, moving and selecting blocks. All are rebindable under Obsidian → Hotkeys.",
  "Shortcut guide",
  "Canvas: find in map",
  "Canvas: Rosé Pine preset",
  "Canvas: Catppuccin pastel preset",
  "Canvas: Chinese classic preset",
  "Canvas: Dunhuang preset",
  "Canvas: Midnight neon preset",
  "Canvas: Clear contrast preset",
  "Canvas: Candy pop preset",
  "Canvas: Retro 70s preset",
  "Editing · Enter next · Tab child · Shift+Tab up · Esc done",
  "The look of maps that have not picked their own in the style panel (canvas toolbar → Style). Clean: a tinted central topic, soft pills for main branches, plain words for subtopics. Cards: every topic keeps its card. Vivid: solid colorful topics. Minimal: words and lines only. Pastel: soft color blocks without outlines. Gradient: glowing gradient topics. Cards that hold files, images, or links always stay cards.",
  "How maps draw their branches unless they pick their own in the style panel (canvas toolbar → Style). Automatic: tapered branches for mind maps and logic charts, right-angled elbows for org charts, trees, and timelines.",
  "The typeface of maps that have not picked their own in the style panel (canvas toolbar → Style). Note font follows Obsidian's text font; Kai uses LXGW WenKai or the system Kaiti when installed.",
  "The outline of topic cards in maps that have not picked their own in the style panel (canvas toolbar → Style): rounded corners, pills, square corners, or words on an underline.",
  "Chords for turning, wrapping, inserting, moving and selecting blocks. All are rebindable under Settings → Hotkeys.",
  "Needs Canvas enhancements",
  "Needs Canvas appearance",
  "Templates",
  "Color",
  "{color} text",
  "Align",
  "Canvas: color branch",
  "The look of maps that have not picked their own in the canvas toolbar's style panel. Clean: a tinted central topic, soft pills for main branches, plain words for subtopics. Cards: every topic keeps its card. Vivid: solid colorful topics. Minimal: words and lines only. Pastel: soft color blocks without outlines. Gradient: glowing gradient topics. Cards that hold files, images, or links always stay cards.",
  "Mind map, logic chart, org chart, tree chart, timeline, and spacing",
  "Solid, colourful topics for brainstorming and presenting.",
  "Harmonies of your Obsidian accent colour.",
  "Unfold {count} cards",
  "Show 1 level",
  "Markdown syntax",
  "Choose whether inline formatting source should stay visible in Live Preview.",
  "Caption",
];
for (const key of REMOVED_W3) assert(!hasZh(key), `swept key is back in ZH: ${JSON.stringify(key)}`);
// Once nothing builds the old per-preset command names, none may linger in the dictionary.
const presetTemplate = /`Canvas: \$\{[^`]*\} preset`/;
const buildsOldPresetNames = sources.some((text) => presetTemplate.test(text))
  || readdirSync(join(root, "test")).filter((n) => /^run-canvas-.*\.mjs$/.test(n)).some((n) => presetTemplate.test(readFileSync(join(root, "test", n), "utf8")));
if (!buildsOldPresetNames) {
  assert.deepEqual(Object.keys(ZH).filter((key) => /^Canvas: .+ preset$/.test(key)), [], "old 'Canvas: <name> preset' keys are swept once no template builds them");
}

// Inline bilingual pairs: tl({ en: "…", zh: "…" }) and { en: "…", zh: "…" } records read through tl() never touch
// ZH, so they are not keys here. Their Chinese follows the same rules: present, same placeholders, chords kept byte
// for byte, and no banned glossary variant. Pairs built from templates with ${…} are skipped.
const BILINGUAL = new RegExp(String.raw`\ben:\s*` + LITERAL + String.raw`\s*,\s*zh:\s*` + LITERAL, "g");
const pairs = [];
for (const [i, file] of walkTs(srcDir).entries()) {
  for (const m of sources[i].matchAll(BILINGUAL)) {
    const enText = unquote(m[1]), zhText = unquote(m[2]);
    if (enText != null && zhText != null) pairs.push({ en: enText, zh: zhText, at: `${relative(root, file)}:${sources[i].slice(0, m.index).split("\n").length}` });
  }
}
assert(pairs.length >= 40, `bilingual { en, zh } pairs found (${pairs.length}); if their form changed, update BILINGUAL`);
const pairMisses = [];
for (const { en: enText, zh: zhText, at } of pairs) {
  const show = `${at} ${JSON.stringify(enText.slice(0, 50))}`;
  if (zhText.trim() === "") pairMisses.push(`  ${show}: empty zh`);
  if (placeholders(zhText) !== placeholders(enText)) pairMisses.push(`  ${show}: placeholders ${placeholders(zhText) || "none"} vs ${placeholders(enText) || "none"}`);
  for (const m of enText.matchAll(CHORD)) if (!zhText.includes(m[0])) pairMisses.push(`  ${show}: chord ${m[0]} not kept`);
  for (const rule of banned(zhText)) pairMisses.push(`  ${show}: ${rule}`);
}
assert.equal(pairMisses.length, 0, `${pairMisses.length} bilingual pair(s) break the ZH rules:\n${pairMisses.join("\n")}`);

/* ---------- the scan ---------- */
const files = walkTs(srcDir);
assert(files.length > 5, "src/**/*.ts found");
const missing = new Map(); // key -> first file:line
const reached = new Map(); // key -> first file:line
const unresolved = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const guide = file.endsWith(join("canvas", "help.ts"));
  const where = [];
  for (const { key, line } of collectKeys(text, { guide, unresolved: where })) {
    const at = `${relative(root, file)}:${line}`;
    if (!reached.has(key)) reached.set(key, at);
    if (!hasZh(key) && !missing.has(key)) missing.set(key, at);
  }
  for (const u of where) unresolved.push(`  ${relative(root, file)}:${u.line}  ${u.call} gets ${JSON.stringify(u.arg)}`);
}

// The note-style registry keeps i18n keys as data (COMPONENTS[k].label and
// optionLabels); load it when it exists and check those keys too.
const registry = join(srcDir, "features", "style-presets.ts");
if (existsSync(registry)) {
  let mod = null;
  try {
    const out = await build({ entryPoints: [registry], bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" });
    mod = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
  } catch (error) {
    console.log(`WARN style-presets.ts did not load for the i18n check (${String(error.message).split("\n")[0]}); its keys were not checked`);
  }
  if (mod?.COMPONENTS) {
    for (const [component, def] of Object.entries(mod.COMPONENTS)) {
      for (const key of [def.label, ...Object.values(def.optionLabels ?? {})]) {
        const at = `src/features/style-presets.ts (COMPONENTS.${component})`;
        if (!reached.has(key)) reached.set(key, at);
        if (!hasZh(key) && !missing.has(key)) missing.set(key, at);
      }
    }
  }
}

if (unresolved.length > 0) {
  assert.fail(`${unresolved.length} settings row name/description(s) are neither a string literal nor a module-scope string constant, so their ZH cannot be checked:\n${unresolved.join("\n")}`);
}
if (missing.size > 0) {
  const report = [...missing].map(([key, where]) => `  ${where}  ${JSON.stringify(key)}`).join("\n");
  assert.fail(`${missing.size} t() key(s) have no Simplified Chinese entry in src/i18n.ts:\n${report}`);
}

// Call sites use the US spelling (the wave-3 sweep removed the British keys they replaced).
const british = [...reached].filter(([key]) => /colour/i.test(key));
assert.deepEqual(british.map(([key, where]) => `${where} ${key}`), [], "call sites use the US color keys");

// Keys in ZH that no static literal reaches are only a warning: many are
// composed at runtime (`${name} style`, preset names, help rows).
const contract = new Set([...CONTRACT, ...Object.keys(PINNED_W2), ...Object.keys(PINNED_W3)]);
const unreached = Object.keys(ZH).filter((key) => !reached.has(key) && !contract.has(key));
if (unreached.length > 0) {
  console.log(`WARN ${unreached.length} ZH key(s) not reached by a static t() literal (may be composed at runtime):`);
  for (const key of unreached) console.log(`  ${JSON.stringify(key.length > 90 ? key.slice(0, 87) + "…" : key)}`);
}
const waiting = CONTRACT.filter((key) => !reached.has(key)).length;
if (waiting > 0) console.log(`INFO ${waiting} note-style contract key(s) are not used yet (expected until the settings gallery and switcher land)`);
const waitingW2 = Object.keys(PINNED_W2).filter((key) => !reached.has(key)).length;
if (waitingW2 > 0) console.log(`INFO ${waitingW2} wave-2 key(s) are not used yet (expected until their modules are wired)`);
const waitingW3 = Object.keys(PINNED_W3).filter((key) => !reached.has(key)).length;
if (waitingW3 > 0) console.log(`INFO ${waitingW3} wave-3 key(s) are not used yet (expected until their call sites land)`);
console.log(`PASS i18n coverage: ${reached.size} keys in ${files.length} files all have ZH entries`);
