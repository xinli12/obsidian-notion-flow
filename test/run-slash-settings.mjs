import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { SlashSuggest, SLASH_COMMANDS, CALLOUT_SLASH_COMMANDS, slashEntries, DEFAULT_SETTINGS, settingsAtDefaults, columnSlashCompletion, parseSlashTableSize, buildTableTemplate, formatSlashDate } from "./bundle.mjs";
import { searchSlashCommands, slashCommandEnabled } from "./features.mjs";

const settings = {
  slashCommands: true, columnLayout: false, toggleBlocks: false,
  slashRecent: ["toggle", "cols2", "code"],
};
let saves = 0;
const plugin = { settings, saveData: async () => { saves++; } };
const suggest = new SlashSuggest(plugin);
for (const query of ["", "toggle", "折叠", "分栏", "cols", "code"]) {
  const main = suggest.getSuggestions({ query });
  assert(!main.some((command) => ["toggle", "cols2", "cols3"].includes(command.id)));
  // A typed query lists exactly the ranking over the menu's full list.
  if (query) assert.deepEqual(main, searchSlashCommands(slashEntries(plugin), query, settings, settings.slashRecent));
}
assert(suggest.getSuggestions({ query: "折叠" }).some((command) => command.id === "toggle-callout"));
assert.equal(suggest.getSuggestions({ query: "" })[0].id, "code");
settings.toggleBlocks = true;
assert(suggest.getSuggestions({ query: "toggle" }).some((command) => command.id === "toggle"));
settings.toggleBlocks = false;
let writes = 0;
suggest.context = { editor: { replaceRange() { writes++; } }, start: {}, end: {} };
suggest.selectSuggestion(SLASH_COMMANDS.find((command) => command.id === "toggle"), {});
assert.equal(writes, 0, "stale menu result cannot execute after disabling");
assert.equal(slashCommandEnabled({ id: "toggle-callout" }, settings), true);

/* ---------- persisted recents ---------- */
settings.slashRecent = [];
let lines = ["/"];
const editor = {
  replaceRange() {}, getLine: (n) => lines[n] ?? "", setLine(n, text) { lines[n] = text; }, setCursor() {},
};
suggest.context = { editor, start: { line: 0, ch: 0 }, end: { line: 0, ch: 1 } };
suggest.selectSuggestion(SLASH_COMMANDS.find((command) => command.id === "h2"), {});
assert.deepEqual(settings.slashRecent, ["h2"]);
assert.equal(saves, 1, "recents are written to disk");
for (const id of ["h1", "bullet", "quote", "table", "divider", "code", "h1"]) {
  lines = ["/"];
  suggest.selectSuggestion(SLASH_COMMANDS.find((command) => command.id === id), {});
}
assert.deepEqual(settings.slashRecent, ["h1", "code", "divider", "table", "quote", "bullet"], "capped at six, most recent first, no duplicates");
assert.equal(suggest.getSuggestions({ query: "" })[0].id, "h1");

/* ---------- recents are state, not a preference ---------- */
{
  const fresh = { ...DEFAULT_SETTINGS };
  assert.equal(settingsAtDefaults(fresh), true);
  const host = { settings: fresh, saveData: async () => {} };
  const s = new SlashSuggest(host);
  lines = ["/"];
  s.context = { editor, start: { line: 0, ch: 0 }, end: { line: 0, ch: 1 } };
  s.selectSuggestion(SLASH_COMMANDS.find((command) => command.id === "h1"), {});
  assert.deepEqual(fresh.slashRecent, ["h1"]);
  assert.equal(settingsAtDefaults(fresh), true, "using a slash command does not light up Reset");
  assert.equal(settingsAtDefaults({ ...DEFAULT_SETTINGS, slashRecent: [] }), true, "a fresh array after load reads as default");
  assert.equal(settingsAtDefaults({ ...fresh, slashCommands: !DEFAULT_SETTINGS.slashCommands }), false, "a real preference change still does");
  console.log("PASS slash recents: ignored by the defaults check");
}

/* ---------- note style keys (R2-W2 item 1): defaults and state keys ---------- */
{
  for (const key of ["calloutStyle", "listMarkerColor", "quoteBarColor", "inlineCodeColor", "tableHeaderColor", "codeTheme"]) {
    assert.equal(DEFAULT_SETTINGS[key], "auto", `${key} defaults to auto`);
  }
  assert.equal(DEFAULT_SETTINGS.palette, "classic");
  assert.equal(DEFAULT_SETTINGS.look, "classic");
  assert.equal(DEFAULT_SETTINGS.styleSchema, 1);
  assert.equal(DEFAULT_SETTINGS.canvasFollowPalette, true);
  assert.ok(Array.isArray(DEFAULT_SETTINGS.canvasUserSchemes) && DEFAULT_SETTINGS.canvasUserSchemes.length === 0);
  assert.ok(!("canvasFallbackPalette" in DEFAULT_SETTINGS), "the derived key is no default");
  assert.equal(settingsAtDefaults({ ...DEFAULT_SETTINGS }), true);
  assert.equal(settingsAtDefaults({ ...DEFAULT_SETTINGS, slashRecent: [], canvasUserSchemes: [], canvasFallbackPalette: null }), true,
    "fresh arrays and the derived key read as default");
  assert.equal(settingsAtDefaults({ ...DEFAULT_SETTINGS, canvasUserSchemes: [] }), true, "canvasUserSchemes is a state key");
  assert.equal(settingsAtDefaults({ ...DEFAULT_SETTINGS, styleSchema: 0 }), true, "styleSchema is a state key");
  assert.equal(settingsAtDefaults({ ...DEFAULT_SETTINGS, palette: "nord" }), false, "a palette is a preference");
  assert.equal(settingsAtDefaults({ ...DEFAULT_SETTINGS, calloutStyle: "header" }), false, "a pinned callout style is a preference");
  console.log("PASS note style: auto defaults, state keys");
}

/* ---------- pinyin and abbreviations against the real command list ---------- */
assert.equal(searchSlashCommands(SLASH_COMMANDS, "hd1", settings)[0].id, "h1");
assert.equal(searchSlashCommands(SLASH_COMMANDS, "bg", settings)[0].id, "table");
assert.equal(searchSlashCommands(SLASH_COMMANDS, "biaoge", settings)[0].id, "table");
assert.equal(searchSlashCommands(SLASH_COMMANDS, "wxlb", settings)[0].id, "bullet");
assert.equal(searchSlashCommands(SLASH_COMMANDS, "yy", settings)[0].id, "quote");
assert(SLASH_COMMANDS.every((command) => command.pinyin || ["toggle-callout"].includes(command.id)), "every entry carries pinyin");

/* ---------- column editor completion source ---------- */
const columnContext = (text) => ({ state: EditorState.create({ doc: text }), pos: text.length });
const result = columnSlashCompletion(plugin, columnContext("/tab"), (view) => view);
assert(result && result.options.length > 0, "column source answers /tab");
assert.equal(result.filter, false, "ranked here, not re-sorted by CodeMirror");
assert.equal(result.from, 0);
assert(result.options.some((option) => option.nf?.id === "table" && option.label === SLASH_COMMANDS.find((c) => c.id === "table").name));
assert.equal(result.options[0].nf.id, "table", "prefix match leads");
assert.equal(result.options[0].detail, SLASH_COMMANDS.find((c) => c.id === "table").desc);
assert.equal(columnSlashCompletion(plugin, columnContext("/hd1"), (view) => view).options[0].nf.id, "h1");
assert.equal(columnSlashCompletion(plugin, columnContext("/bg"), (view) => view).options[0].nf.id, "table");
assert.equal(columnSlashCompletion(plugin, columnContext("no slash"), (view) => view), null);
assert(!columnSlashCompletion(plugin, columnContext("/")).options.some((option) => option.nf.id === "cols2"), "column source honours feature gates");
settings.slashCommands = false;
assert.equal(columnSlashCompletion(plugin, columnContext("/tab"), (view) => view), null);
settings.slashCommands = true;

/* ---------- more blocks: text, equations, diagram, video, dates ---------- */
const byId = (id) => SLASH_COMMANDS.find((command) => command.id === id);
assert.equal(byId("text").linePrefix, "", "Text turns the line back into a paragraph");
assert.equal(searchSlashCommands(SLASH_COMMANDS, "公式", settings)[0].id, "math");
assert.equal(searchSlashCommands(SLASH_COMMANDS, "mermaid", settings)[0].id, "mermaid");
assert.equal(searchSlashCommands(SLASH_COMMANDS, "gs", settings)[0].id, "math");
assert(searchSlashCommands(SLASH_COMMANDS, "行内公式", settings).some((command) => command.id === "inline-math"));
assert.equal(searchSlashCommands(SLASH_COMMANDS, "视频", settings)[0].id, "video");
assert.equal(searchSlashCommands(SLASH_COMMANDS, "今天", settings)[0].id, "date");
assert.equal(searchSlashCommands(SLASH_COMMANDS, "wb", settings)[0].id, "text");
assert(byId("math").block && byId("math").needsBlank, "an equation block wants a blank line above");
assert.equal(byId("mermaid").insert.split("\n")[0], "```mermaid");
assert.equal(byId("table").hint, "⊞");
for (const id of ["date", "time", "datetime", "tomorrow", "yesterday"]) {
  const out = byId(id).resolve({ dateFormat: "YYYY-MM-DD", timeFormat: "HH:mm" });
  assert(out.endsWith("‸"), `${id} lands the caret after the text`);
}
assert.match(byId("date").resolve({ dateFormat: "YYYY-MM-DD", timeFormat: "HH:mm" }), /^\d{4}-\d{2}-\d{2}‸$/);
assert.match(byId("time").resolve({ dateFormat: "YYYY-MM-DD", timeFormat: "HH:mm" }), /^\d{2}:\d{2}‸$/);
assert.match(byId("datetime").resolve({ dateFormat: "YYYY-MM-DD", timeFormat: "HH:mm" }), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}‸$/);
assert.match(byId("date").resolve({}), /^\d{4}-\d{2}-\d{2}‸$/, "missing formats fall back to the defaults");
{
  const today = Number(formatSlashDate("YYYYMMDD"));
  const tomorrow = Number(formatSlashDate("YYYYMMDD", 1));
  const yesterday = Number(formatSlashDate("YYYYMMDD", -1));
  assert(tomorrow > today && yesterday < today, "day offsets move the date");
}
// An editor whose replaceRange really writes, for checks on what lands.
const writer = {
  getLine: (n) => lines[n] ?? "",
  setLine(n, text) { lines[n] = text; },
  setCursor() {},
  replaceRange(text, from, to) {
    const head = lines[from.line].slice(0, from.ch);
    const tail = lines[to.line].slice(to.ch);
    lines.splice(from.line, to.line - from.line + 1, ...(head + text + tail).split("\n"));
  },
};
{
  // The resolved text is what the snippet writer inserts, in both surfaces.
  lines = ["/date"];
  suggest.context = { editor: writer, start: { line: 0, ch: 0 }, end: { line: 0, ch: 5 } };
  suggest.selectSuggestion(byId("date"), {});
  assert.match(lines[0], /^\d{4}-\d{2}-\d{2}$/, "the date replaces the trigger");
  const dated = { ...settings, dateFormat: "DD.MM.YYYY", timeFormat: "HH:mm" };
  lines = ["/date"];
  SlashSuggest.insertSnippetInto(writer, { line: 0, ch: 0 }, { line: 0, ch: 5 }, byId("date"), undefined, dated);
  assert.match(lines[0], /^\d{2}\.\d{2}\.\d{4}$/, "the configured format is used");
}

/* ---------- table picker from the keyboard, and the size argument ---------- */
assert.deepEqual(parseSlashTableSize("table4x6"), { query: "table", size: { cols: 4, rows: 6 } });
assert.deepEqual(parseSlashTableSize("table4×6"), { query: "table", size: { cols: 4, rows: 6 } });
assert.deepEqual(parseSlashTableSize("表格3*2"), { query: "表格", size: { cols: 3, rows: 2 } });
assert.deepEqual(parseSlashTableSize("4x6"), { query: "table", size: { cols: 4, rows: 6 } }, "a bare size means the table");
assert.deepEqual(parseSlashTableSize("table40x0"), { query: "table", size: { cols: 10, rows: 1 } }, "sizes clamp to 1..10");
assert.deepEqual(parseSlashTableSize("h1"), { query: "h1", size: null });
assert.deepEqual(parseSlashTableSize("table"), { query: "table", size: null });
{
  const tableCmd = byId("table");
  const pickerCalls = [];
  suggest.openTablePicker = (_editor, _start, _end, cmd, anchor) => pickerCalls.push({ cmd, anchor });
  const ownerDocument = {};
  const cmEditor = {
    ...writer,
    cm: {
      state: { selection: { main: { head: 3 } } },
      coordsAtPos: (pos) => (pos === 3 ? { left: 40, right: 41, top: 100, bottom: 118 } : null),
      dom: { ownerDocument, getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    },
  };
  lines = ["/table"];
  suggest.context = { editor: cmEditor, start: { line: 0, ch: 0 }, end: { line: 0, ch: 6 } };
  assert.equal(suggest.getSuggestions({ query: "table" })[0].id, "table");
  suggest.selectSuggestion(tableCmd, { key: "Enter" });
  assert.equal(pickerCalls.length, 1, "Enter opens the picker");
  assert.deepEqual(pickerCalls[0].anchor, { doc: ownerDocument, rect: null, x: 40, y: 122 }, "anchored under the caret");
  assert.deepEqual(lines, ["/table"], "nothing inserted until the picker confirms");

  const item = { closest: (sel) => (sel === ".suggestion-item" ? { getBoundingClientRect: () => "row-rect" } : null), ownerDocument };
  suggest.selectSuggestion(tableCmd, { clientX: 10, clientY: 20, target: item });
  assert.deepEqual(pickerCalls[1].anchor, { doc: ownerDocument, rect: "row-rect", x: 10, y: 20 }, "a click anchors beside its row");

  // "/table4x6" bypasses the picker and inserts a 4-column, 6-row table.
  lines = ["/table4x6"];
  suggest.context = { editor: cmEditor, start: { line: 0, ch: 0 }, end: { line: 0, ch: 9 } };
  assert.equal(suggest.getSuggestions({ query: "table4x6" })[0].id, "table");
  suggest.selectSuggestion(tableCmd, { key: "Enter" });
  assert.equal(pickerCalls.length, 2, "a typed size needs no picker");
  assert.equal(lines.length, 7, "header, delimiter and five body rows");
  assert(lines.every((row) => row.split("|").length - 1 === 5), "four columns in every row");
  assert.equal(lines.join("\n"), buildTableTemplate(6, 4).replace("‸", ""));
  assert.equal(suggest.tableSize, null, "the size is consumed");

  // The column editor takes the same argument.
  const column = columnSlashCompletion(plugin, columnContext("/table4x6"), (view) => view);
  assert.equal(column.options[0].nf.id, "table", "the size is stripped before ranking");
  assert.equal(column.from, 0);
  assert.equal(columnSlashCompletion(plugin, columnContext("/4x6"), (view) => view).options[0].nf.id, "table");
}
/* ---------- a stale context: Enter inside Obsidian's 50 ms trigger debounce ---------- */
{
  // Positions become offsets as line start + ch, the way CodeMirror reads
  // them, so a stale `end` really does reach into the next line here.
  const offsetWriter = (cursor) => {
    const offset = (p) => lines.slice(0, p.line).reduce((n, line) => n + line.length + 1, 0) + p.ch;
    return {
      getLine: (n) => lines[n] ?? "",
      setLine(n, text) { lines[n] = text; },
      setCursor() {},
      getCursor: () => cursor,
      replaceRange(text, from, to = from) {
        const doc = lines.join("\n");
        lines = (doc.slice(0, offset(from)) + text + doc.slice(offset(to))).split("\n");
      },
    };
  };
  // An IME commit turned "/biaoge" (7 chars) into "/表格" (3); the menu
  // still holds the old context when Enter lands.
  lines = ["/表格", "next line here"];
  const staleTop = suggest.getSuggestions({ query: "biaoge" })[0];
  suggest.context = { editor: offsetWriter({ line: 0, ch: 3 }), start: { line: 0, ch: 0 }, end: { line: 0, ch: 7 }, query: "biaoge" };
  suggest.selectSuggestion(staleTop, { key: "Enter" });
  assert.equal(lines.at(-1), "next line here", "the next line survives a stale end");
  assert.match(lines[0], /^\|/, "the fresh query's top item (Table) is inserted");
  assert(!lines.some((line) => /^(- |> )/.test(line)), "no list or quote prefix from a stale pick");
  assert(!lines.join("\n").includes("表格"), "the whole fresh trigger is replaced");

  // "/" then "todo" typed fast: the context still says "to".
  lines = ["/todo", "next line here"];
  suggest.context = { editor: offsetWriter({ line: 0, ch: 5 }), start: { line: 0, ch: 0 }, end: { line: 0, ch: 3 }, query: "to" };
  suggest.selectSuggestion(byId("todo"), { key: "Enter" });
  assert.deepEqual(lines, ["- [ ] ", "next line here"], "the trigger as it stands now is removed, no \"do\" left behind");

  // Same query, but an `end` past the line's end: clamped to the line.
  lines = ["/quote", "next line here"];
  suggest.context = { editor: offsetWriter({ line: 0, ch: 20 }), start: { line: 0, ch: 0 }, end: { line: 0, ch: 20 }, query: "quote" };
  suggest.selectSuggestion(byId("quote"), { key: "Enter" });
  assert.deepEqual(lines, ["> ", "next line here"], "nothing is deleted past the line end");

  // The slash is gone (or the trigger moved lines): nothing is written,
  // and a host without close() does not throw.
  lines = ["quote", "next line here"];
  suggest.context = { editor: offsetWriter({ line: 0, ch: 5 }), start: { line: 0, ch: 0 }, end: { line: 0, ch: 6 }, query: "quote" };
  suggest.selectSuggestion(byId("quote"), { key: "Enter" });
  assert.deepEqual(lines, ["quote", "next line here"], "no trigger, no write");
  lines = ["/quote", "/h1"];
  suggest.context = { editor: offsetWriter({ line: 1, ch: 3 }), start: { line: 0, ch: 0 }, end: { line: 0, ch: 6 }, query: "quote" };
  suggest.selectSuggestion(byId("quote"), { key: "Enter" });
  assert.deepEqual(lines, ["/quote", "/h1"], "a trigger on another line is not this menu's");
  let closed = 0;
  suggest.close = () => { closed++; };
  lines = ["no trigger"];
  suggest.context = { editor: offsetWriter({ line: 0, ch: 10 }), start: { line: 0, ch: 0 }, end: { line: 0, ch: 3 }, query: "abc" };
  suggest.selectSuggestion(byId("quote"), { key: "Enter" });
  assert.equal(closed, 1, "the stale menu is closed");
  delete suggest.close;
  console.log("PASS slash stale context: re-read at pick time, clamped to the trigger line");
}
/* ---------- review-MA-2: a stale default highlight takes the fresh top ---------- */
{
  const saved = { recent: settings.slashRecent, cols: settings.columnLayout, toggles: settings.toggleBlocks };
  settings.columnLayout = true;
  settings.toggleBlocks = true;
  const writer = (cursor) => {
    const offset = (p) => lines.slice(0, p.line).reduce((n, line) => n + line.length + 1, 0) + p.ch;
    return {
      getLine: (n) => lines[n] ?? "",
      setLine(n, text) { lines[n] = text; },
      setCursor() {},
      getCursor: () => cursor,
      replaceRange(text, from, to = from) {
        const doc = lines.join("\n");
        lines = (doc.slice(0, offset(from)) + text + doc.slice(offset(to))).split("\n");
      },
    };
  };
  /** Obsidian showed the list for `stale`; the document already says `now`. */
  const staleEnter = (stale, now, pick = (list) => list[0], evt = { key: "Enter" }) => {
    lines = [`/${now}`, "next"];
    const shown = suggest.getSuggestions({ query: stale });
    const chosen = pick(shown);
    suggest.context = { editor: writer({ line: 0, ch: now.length + 1 }), start: { line: 0, ch: 0 }, end: { line: 0, ch: stale.length + 1 }, query: stale };
    suggest.selectSuggestion(chosen, evt);
    return { chosen: chosen.id, fresh: searchSlashCommands(slashEntries(plugin), now, settings, settings.slashRecent)[0].id, lines: [...lines] };
  };
  settings.slashRecent = [];
  const im = staleEnter("i", "im");
  assert.equal(im.fresh, "image", "the fresh top for /im is Image");
  assert.notEqual(im.chosen, "image", "and the stale default highlight for /i is something else");
  assert.equal(lines[0], "![[]]", `/im + Enter inserts Image, not ${im.chosen}: ${JSON.stringify(im.lines)}`);
  assert.equal(lines[1], "next");
  const co = staleEnter("c", "co");
  assert.equal(co.fresh, "cols2");
  assert.notEqual(co.chosen, "cols2");
  assert.match(lines[0], /^> \[!nf-cols\]/, `/co + Enter inserts columns, not a ${co.chosen}: ${JSON.stringify(co.lines)}`);
  // "/h" right after "/": the stale top is the most recent command.
  settings.slashRecent = ["inline-math"];
  const h = staleEnter("", "h");
  assert.equal(h.chosen, "inline-math");
  assert.deepEqual(lines, ["# ", "next"], `/h + Enter is Heading 1, not the recent $$: ${JSON.stringify(h.lines)}`);
  settings.slashRecent = [];
  // A real choice stands: an item arrowed to (not the top) …
  const arrowed = staleEnter("c", "co", (list) => list.find((c) => c.id === "code"));
  assert.equal(lines[0], "```", `an arrowed-to item that still matches is kept: ${JSON.stringify(arrowed.lines)}`);
  // … and a click, even on the top item. (/b lists Bulleted list first,
  // /bi Heading 1 — "biaoti" — with Bulleted list still listed.)
  const click = staleEnter("b", "bi", (list) => list[0], { clientX: 5, clientY: 5 });
  assert.deepEqual([click.chosen, click.fresh], ["bullet", "h1"]);
  assert.equal(lines[0], "- ", `a clicked item stays the one clicked: ${JSON.stringify(click.lines)}`);
  staleEnter("b", "bi");
  assert.equal(lines[0], "# ", "while Enter on that same default highlight takes /bi's top");
  // The same query as shown: Enter takes what was highlighted.
  lines = ["/im", "next"];
  const same = suggest.getSuggestions({ query: "im" });
  suggest.context = { editor: writer({ line: 0, ch: 3 }), start: { line: 0, ch: 0 }, end: { line: 0, ch: 3 }, query: "im" };
  suggest.selectSuggestion(same[0], { key: "Enter" });
  assert.equal(lines[0], "![[]]", "an up-to-date list is unaffected");
  settings.slashRecent = saved.recent;
  settings.columnLayout = saved.cols;
  settings.toggleBlocks = saved.toggles;
  console.log("PASS review-MA-2: Enter on a stale default highlight applies the fresh query's top item; real choices stand");
}

/* ---------- item 20: pinyin for every Chinese slash name ---------- */
{
  const { readFileSync } = await import("node:fs");
  const { transformSync } = await import("esbuild");
  const i18nText = readFileSync(new URL("../src/i18n.ts", import.meta.url), "utf8");
  const { code } = transformSync(`${i18nText}\nexport { ZH };\n`, { loader: "ts", format: "esm" });
  const { ZH } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  /** Each Chinese name, and the full and initials pinyin it must answer to. */
  const REQUIRED = {
    "正文": ["zhengwen", "zw"],
    "一级标题": ["yijibiaoti", "yjbt"],
    "二级标题": ["erjibiaoti", "ejbt"],
    "三级标题": ["sanjibiaoti", "sjbt"],
    "无序列表": ["wuxuliebiao", "wxlb"],
    "有序列表": ["youxuliebiao", "yxlb"],
    "待办列表": ["daibanliebiao", "dblb"],
    "引用": ["yinyong", "yy"],
    "标注": ["biaozhu", "bz"],
    "折叠块": ["zhediekuai", "zdk"],
    "可折叠标注": ["kezhediebiaozhu", "kzdbz"],
    "两栏": ["lianglan", "ll"],
    "三栏": ["sanlan", "sl"],
    "代码块": ["daimakuai", "dmk"],
    "表格": ["biaoge", "bg"],
    "公式块": ["gongshikuai", "gsk"],
    "行内公式": ["hangneigongshi", "hngs"],
    "图表": ["tubiao", "tb"],
    "分割线": ["fengexian", "fgx"],
    "图片 / 嵌入": ["tupian", "qianru"],
    "视频": ["shipin", "sp"],
    "内部链接": ["neibulianjie", "nblj"],
    "日期": ["riqi", "rq"],
    "时间": ["shijian", "sj"],
    "日期和时间": ["riqiheshijian", "rqhsj"],
    "明天": ["mingtian", "mt"],
    "昨天": ["zuotian", "zt"],
    "目录": ["mulu", "ml"],
  };
  for (const command of SLASH_COMMANDS) {
    const zhName = ZH[command.name];
    assert.ok(zhName, `${command.id}: "${command.name}" has a Chinese name`);
    const need = REQUIRED[zhName];
    assert.ok(need, `${command.id} (${zhName}) needs a row in REQUIRED: a new entry must bring its pinyin`);
    const tokens = (command.pinyin ?? "").split(/\s+/);
    for (const token of need) assert.ok(tokens.includes(token), `${command.id} (${zhName}) answers to "${token}": ${command.pinyin}`);
  }
  // Ranked as the Chinese UI lists them: each shorthand finds its entry first.
  // The Callout types rank with the rest ("tishi" is the tip Callout's
  // now; the generic Callout no longer claims 提示).
  const zhType = (command) => {
    const entry = command.hint.match(/\[!(\w+)\]/)[1];
    const label = { note: "Note", abstract: "Abstract", info: "Info", todo: "To-do", tip: "Tip", success: "Success", question: "Question",
      warning: "Warning", failure: "Failure", danger: "Danger", bug: "Bug", example: "Example", quote: "Quote" }[entry];
    return (ZH["Callout · {type}"] ?? "标注 · {type}").replace("{type}", ZH[label] ?? label);
  };
  const zhCommands = [
    ...SLASH_COMMANDS.map((command) => ({ ...command, name: ZH[command.name] })),
    ...CALLOUT_SLASH_COMMANDS.map((command) => ({ ...command, name: zhType(command) })),
  ];
  const all = { columnLayout: true, toggleBlocks: true };
  const expect = { zw: "text", zhengwen: "text", yjbt: "h1", yiji: "h1", liang: "cols2", lianglan: "cols2", sanlan: "cols3",
    kzd: "toggle-callout", kezhedie: "toggle-callout", dmk: "code", daimakuai: "code", nblj: "wikilink", neibu: "wikilink",
    tishi: "callout-tip", biaozhu: "callout", dblb: "todo", gsk: "math", rqhsj: "datetime", mulu: "toc" };
  for (const [query, id] of Object.entries(expect)) {
    const top = searchSlashCommands(zhCommands, query, all, [])[0]?.id;
    assert.equal(top, id, `/${query} lists ${id} first (got ${top})`);
  }
  console.log("PASS item 20: every Chinese slash name answers to its pinyin and initials");
}
console.log("PASS slash settings: feature gates, persisted recents, pinyin ranking, column source, more blocks, table sizes and stale selection");
