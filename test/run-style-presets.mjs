/* The note-style model (src/features/style-presets.ts) and its token
   generator (scripts/style-presets/gen.mjs): migration, the Classic
   invariant against a port of the pre-style applyCleanClass, each look's
   class set, explicit-wins, an exhaustive class/var sweep, registry
   integrity against the generator, and the self-tightening checks that
   wait for the Canvas, i18n and CSS packages. Expected values are written
   out literally; none is derived from the module under test. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import {
  STYLE_HUES, COMPONENT_KEYS, COLOR_KEYS, COLOR_VALUES, COLOR_KEY_LABELS, CODE_THEME_IDS, LEGACY_STYLE_DEFAULTS, STYLE_SCHEMA,
  NOTE_STYLE_DEFAULTS, PALETTES, LOOKS, COMPONENTS, NOTE_STYLE_CLASSES, NOTE_STYLE_VARS,
  resolveNoteStyle, computeBodyStyle, overriddenKeys, followAll, withPreview, migrateStyleSettings, canvasPaletteFor,
  applyBodyStyle, clearBodyStyle, APPEARANCE_PRESETS,
} from "./features.mjs";
import { generate, extractBlock, normalizeBody, renderBody, replaceBlock, START, END, HEADER } from "../scripts/style-presets/gen.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mainTs = readFileSync(resolve(root, "src/main.ts"), "utf8");
const i18nTs = readFileSync(resolve(root, "src/i18n.ts"), "utf8");
const styles = readFileSync(resolve(root, "styles.css"), "utf8");

let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const noThrow = (fn, message) => { assert.doesNotThrow(fn, message); checks++; };
const sorted = (list) => [...list].sort();
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));

/* ---------- test env: mirrors main.ts exactly ---------- */
const INK = {};
for (const m of mainTs.matchAll(/(\w+): \{ hex: "(#[0-9a-f]{6})", rgb: "([\d,]+)" \}/g)) INK[m[1]] = { hex: m[2], rgb: m[3] };
eq(Object.keys(INK), ["gray", "red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"], "PALETTE_INK parsed from main.ts");
const paletteText = (h) => `var(--nf-${h}, ${INK[h].hex})`;
const paletteTint = (h, a) => `rgba(var(--nf-${h}-rgb, ${INK[h].rgb}), ${a})`;
const env = { paletteText, paletteTint, codeThemes: CODE_THEME_IDS };
const style = (s) => computeBodyStyle(s, env);
const withDefaults = (s) => ({ ...NOTE_STYLE_DEFAULTS, ...s });

/* ---------- oracle: a line-by-line port of the pre-style applyCleanClass ---------- */
const HUES_LIT = ["gray", "red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"];
const CODE_THEMES_LIT = ["default", "obsidian", "github", "vscode", "one-dark", "catppuccin", "tokyo-night", "gruvbox", "dracula", "nord", "solarized"];
const LEGACY_LIT = { calloutStyle: "header", listMarkerColor: "accent", quoteBarColor: "text", inlineCodeColor: "red", tableHeaderColor: "default", codeTheme: "default" };
const VARS_LIT = ["--nf-list-marker", "--nf-quote-bar", "--nf-inline-code", "--nf-table-header-bg", "--nf-co-title-bottom", "--nf-decor-src"];
function legacyBodyStyle(saved) {
  const s = { ...LEGACY_LIT, ...saved }; // loadSettings: { ...DEFAULT_SETTINGS, ...saved }
  const classes = new Set();
  const vars = Object.fromEntries(VARS_LIT.map((v) => [v, null]));
  if (s.calloutStyle === "flat") { classes.add("nf-callout-flat"); vars["--nf-co-title-bottom"] = "6px"; }
  const c = s.tableHeaderColor;
  if (c !== "default") classes.add("nf-thead-tint");
  if (c === "none") vars["--nf-table-header-bg"] = "transparent";
  else if (HUES_LIT.includes(c)) vars["--nf-table-header-bg"] = paletteTint(c, 0.16);
  const lm = s.listMarkerColor;
  if (lm !== "default") classes.add("nf-list-color");
  if (lm === "accent") vars["--nf-list-marker"] = "var(--interactive-accent)";
  else if (HUES_LIT.includes(lm)) vars["--nf-list-marker"] = paletteText(lm);
  const qb = s.quoteBarColor;
  if (qb !== "default") classes.add("nf-quote-color");
  if (qb === "text") vars["--nf-quote-bar"] = "var(--text-normal)";
  else if (qb === "accent") vars["--nf-quote-bar"] = "var(--interactive-accent)";
  else if (HUES_LIT.includes(qb)) vars["--nf-quote-bar"] = paletteText(qb);
  const ic = s.inlineCodeColor;
  if (HUES_LIT.includes(ic)) { classes.add("nf-code-color"); vars["--nf-inline-code"] = paletteText(ic); }
  const codeTheme = CODE_THEMES_LIT.includes(s.codeTheme) ? s.codeTheme : "default";
  for (const theme of CODE_THEMES_LIT) if (theme !== "default" && codeTheme === theme) classes.add(`nf-code-theme-${theme}`);
  return { classes: sorted(classes), vars };
}
/** `var(--nf-style-…, X)` → X (balanced parens), as when no palette class defines --nf-style-*. */
function dropStyleFallbacks(str) {
  if (typeof str !== "string") return str;
  let out = str, from = 0, i;
  while ((i = out.indexOf("var(--nf-style-", from)) >= 0) {
    let depth = 0, j = i + 3, comma = -1;
    for (; j < out.length; j++) {
      if (out[j] === "(") depth++;
      else if (out[j] === ")") { if (--depth === 0) break; }
      else if (out[j] === "," && depth === 1 && comma < 0) comma = j;
    }
    if (comma < 0) { from = j; continue; }
    out = out.slice(0, i) + out.slice(comma + 1, j).trim() + out.slice(j + 1);
  }
  return out;
}
eq(dropStyleFallbacks("var(--nf-style-inline-code, var(--nf-red, #b5554d))"), "var(--nf-red, #b5554d)", "dropStyleFallbacks: nested fallback");
eq(dropStyleFallbacks("var(--nf-style-thead)"), "var(--nf-style-thead)", "dropStyleFallbacks: no fallback is kept");
eq(dropStyleFallbacks(null), null, "dropStyleFallbacks: null");
const resolvedVars = (vars) => Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, dropStyleFallbacks(v)]));

/* ---------- 1. migration ---------- */
const FIXTURE = { // the user's data.json style keys (no calloutStyle), plus unrelated keys
  cleanRendering: true, slashRecent: ["h1", "todo"], tableStripes: false,
  listMarkerColor: "accent", quoteBarColor: "accent", inlineCodeColor: "pink", codeTheme: "github", tableHeaderColor: "default",
};
const FIXTURE_PATCH = { calloutStyle: "auto", listMarkerColor: "auto", tableHeaderColor: "auto", styleSchema: 1 };
eq(migrateStyleSettings(null), {}, "migrate(null)");
eq(migrateStyleSettings(undefined), {}, "migrate(undefined)");
eq(migrateStyleSettings("x"), {}, "migrate(non-object)");
eq(migrateStyleSettings({ ...LEGACY_LIT }), {
  calloutStyle: "auto", listMarkerColor: "auto", quoteBarColor: "auto", inlineCodeColor: "auto", tableHeaderColor: "auto", codeTheme: "auto", styleSchema: 1,
}, "all six legacy defaults → auto");
{
  const before = structuredClone(FIXTURE);
  eq(migrateStyleSettings(FIXTURE), FIXTURE_PATCH, "the user's data.json → exactly the §4.4 patch");
  eq(FIXTURE, before, "migration does not mutate its input");
}
eq(migrateStyleSettings({ ...FIXTURE, calloutStyle: "header" }), FIXTURE_PATCH, "§4.4 variant with calloutStyle: header");
{
  const migrated = { ...FIXTURE, ...migrateStyleSettings(FIXTURE) };
  eq(migrateStyleSettings(migrated), {}, "second run is a no-op (styleSchema gate)");
  eq(migrateStyleSettings({ ...migrated, listMarkerColor: "accent" }), {}, "an explicit accent chosen after migration survives");
}
eq(migrateStyleSettings({ ...LEGACY_LIT, styleSchema: "1" }), {}, "styleSchema '1' counts as migrated");
eq(migrateStyleSettings({ listMarkerColor: undefined, calloutStyle: "flat" }), {
  listMarkerColor: "auto", quoteBarColor: "auto", inlineCodeColor: "auto", tableHeaderColor: "auto", codeTheme: "auto", styleSchema: 1,
}, "undefined counts as missing; flat stays an override");
for (const input of [FIXTURE, { ...LEGACY_LIT, foo: 1 }, { calloutStyle: "flat", palette: "nord" }]) {
  const extra = Object.keys(migrateStyleSettings(input)).filter((k) => !(k in LEGACY_LIT) && k !== "styleSchema");
  eq(extra, [], "no non-style key appears in a patch");
}

/* ---------- 2. Classic invariant ---------- */
const LEGACY_VALID = {
  calloutStyle: ["header", "flat"],
  listMarkerColor: ["accent", "default", ...HUES_LIT],
  quoteBarColor: ["text", "accent", "default", ...HUES_LIT],
  inlineCodeColor: ["default", ...HUES_LIT],
  tableHeaderColor: ["default", "none", ...HUES_LIT],
  codeTheme: CODE_THEMES_LIT,
};
const classicCases = [{ ...FIXTURE }];
for (const [key, values] of Object.entries(LEGACY_VALID)) for (const v of values) classicCases.push({ ...LEGACY_LIT, [key]: v });
for (const original of classicCases) {
  const migrated = withDefaults({ ...original, ...migrateStyleSettings(original) });
  const got = style(migrated);
  const want = legacyBodyStyle(original);
  const label = JSON.stringify(pick(original, Object.keys(LEGACY_LIT)));
  eq(sorted(got.classes), want.classes, `Classic invariant classes ${label}`);
  eq(resolvedVars(got.vars), want.vars, `Classic invariant vars ${label}`);
}
eq(sorted(style(withDefaults({ ...LEGACY_LIT, ...migrateStyleSettings({ ...LEGACY_LIT }) })).classes),
  ["nf-code-color", "nf-list-color", "nf-quote-color"], "all legacy defaults emit exactly the three colour classes");
{
  const fx = style(withDefaults({ ...FIXTURE, ...FIXTURE_PATCH }));
  eq(sorted(fx.classes), ["nf-code-color", "nf-code-theme-github", "nf-list-color", "nf-quote-color"], "fixture classes");
  eq(fx.vars["--nf-list-marker"], "var(--nf-style-list-marker, var(--interactive-accent))", "fixture: list marker is the auto string");
  eq(fx.vars["--nf-quote-bar"], "var(--interactive-accent)", "fixture: explicit accent quote bar");
  eq(fx.vars["--nf-inline-code"], "var(--nf-pink, #a85480)", "fixture: explicit pink inline code");
}

/* ---------- 3. each look × all auto (Classic palette) ---------- */
const COLOR3 = ["nf-list-color", "nf-quote-color", "nf-code-color"];
const LOOK_CLASSES = {
  classic: [[], null],
  editorial: [["nf-callout-rail", "nf-callout-flat", "nf-lk-h-editorial", "nf-lk-hl-marker", "nf-lk-tbl-ruled", "nf-lk-q-pull", "nf-lk-bullet-dash", "nf-lk-check-ink", "nf-lk-hr-ornament", "nf-lk-toggle-triangle", "nf-lk-cols-divided", "nf-lk-icode-ink"], "6px"],
  soft: [["nf-callout-card", "nf-callout-flat", "nf-lk-tbl-card", "nf-lk-q-tint", "nf-lk-check-soft", "nf-lk-hr-dots", "nf-lk-toggle-triangle", "nf-lk-icode-tint"], "6px"],
  outline: [["nf-callout-outline", "nf-callout-flat", "nf-lk-h-rule", "nf-lk-hl-underline", "nf-lk-bullet-diamond", "nf-lk-check-circle", "nf-lk-hr-hairline", "nf-lk-toggle-guide", "nf-lk-cols-divided", "nf-lk-icode-outline"], "6px"],
  minimal: [["nf-callout-minimal", "nf-callout-flat", "nf-lk-hl-underline", "nf-lk-tbl-ruled", "nf-lk-bullet-dash", "nf-lk-check-circle", "nf-lk-hr-dots", "nf-lk-toggle-guide", "nf-lk-icode-ink", "nf-decor-neutral"], "6px"],
  gradient: [["nf-callout-gradient", "nf-lk-h-fade", "nf-lk-hl-marker", "nf-lk-tbl-card", "nf-lk-q-tint", "nf-lk-bullet-diamond", "nf-lk-hr-ornament", "nf-lk-toggle-triangle", "nf-lk-cols-divided", "nf-lk-icode-tint"], null],
};
for (const [look, [cls, titleBottom]] of Object.entries(LOOK_CLASSES)) {
  const out = style(withDefaults({ look }));
  eq(sorted(out.classes), sorted([...cls, ...COLOR3]), `look ${look}: class set`);
  eq(out.vars["--nf-co-title-bottom"], titleBottom, `look ${look}: --nf-co-title-bottom`);
  eq(out.vars["--nf-decor-src"], null, `look ${look}: no decor source`);
}
eq(style(withDefaults({ look: "minimal", decorColor: "palette" })).classes.filter((c) => c.startsWith("nf-decor-")), [], "Minimal + explicit palette decor → no nf-decor-*");

/* ---------- 4. explicit wins ---------- */
{
  const ed = style(withDefaults({ look: "editorial", calloutStyle: "flat" })).classes;
  ok(ed.includes("nf-callout-flat") && !ed.includes("nf-callout-rail"), "Editorial + flat → flat, not rail");
  const nordDefault = style(withDefaults({ palette: "nord", tableHeaderColor: "default" }));
  eq(nordDefault.vars["--nf-table-header-bg"], null, "nord + explicit default header → removed");
  ok(!nordDefault.classes.includes("nf-thead-tint"), "nord + explicit default header → no nf-thead-tint");
  eq(style(withDefaults({ palette: "nord" })).vars["--nf-table-header-bg"], "var(--nf-style-thead)", "nord + auto header → palette token");
  ok(!style(withDefaults({ palette: "nord" })).classes.includes("nf-thead-tint"), "auto header never tints");
  eq(style(withDefaults({})).vars["--nf-table-header-bg"], null, "classic + auto header → removed");
  eq(style(withDefaults({ look: "gradient", calloutStyle: "rail" })).vars["--nf-co-title-bottom"], "6px", "explicit rail under Gradient → flat geometry");
  eq(style(withDefaults({ look: "soft", calloutStyle: "gradient" })).classes.filter((c) => c.startsWith("nf-callout-")), ["nf-callout-gradient"], "explicit gradient under Soft → header geometry");
  const custom = { ...NOTE_STYLE_DEFAULTS, calloutStyle: "flat", headingStyle: "bar", decorColor: "cyan", listMarkerColor: "green", codeTheme: "nord" };
  const styleKeys = [...COMPONENT_KEYS, ...COLOR_KEYS];
  for (const palette of PALETTES.map((p) => p.id)) for (const look of LOOKS.map((l) => l.id)) {
    const next = withPreview(custom, { palette, look });
    eq(pick(next, styleKeys), pick(custom, styleKeys), `withPreview(${palette}, ${look}) leaves the 17 keys alone`);
    ok(next.palette === palette && next.look === look && next !== custom, `withPreview(${palette}, ${look}) returns a new object`);
  }
  eq(custom.palette, "classic", "withPreview never mutates its input");
  eq(withPreview({ ...custom, palette: "nord", look: "soft" }, {}).palette, "nord", "withPreview keeps the palette when none is given");
}

/* ---------- 5. palette classes ---------- */
for (const paletteSurface of ["theme", "page", "app"]) for (const paletteHeadings of [false, true]) for (const paletteLinks of [false, true]) {
  const cls = style(withDefaults({ paletteSurface, paletteHeadings, paletteLinks })).classes;
  eq(cls.filter((c) => c.startsWith("nf-palette")), [], `classic × ${paletteSurface}/${paletteHeadings}/${paletteLinks} → no palette class`);
}
eq(style(withDefaults({ palette: "nord", paletteSurface: "page", paletteHeadings: true, paletteLinks: true })).classes.filter((c) => c.startsWith("nf-palette")),
  ["nf-palette", "nf-palette-nord", "nf-palette-page", "nf-palette-headings", "nf-palette-links"], "nord + page + headings + links");
eq(style(withDefaults({ palette: "guose", paletteSurface: "app" })).classes.filter((c) => c.startsWith("nf-palette")),
  ["nf-palette", "nf-palette-guose", "nf-palette-app"], "app surface");
eq(style(withDefaults({ palette: "nord", paletteHeadings: "yes", paletteLinks: 1 })).classes.filter((c) => c.startsWith("nf-palette")),
  ["nf-palette", "nf-palette-nord"], "headings/links count only when === true");
eq(style(withDefaults({ palette: "custom", paletteSurface: "page" })), style(withDefaults({})), "garbage palette id → Classic output");
eq(style(withDefaults({ look: "fancy" })), style(withDefaults({})), "garbage look id → Classic output");

/* ---------- 6. decorColor hue ---------- */
{
  const pink = style(withDefaults({ decorColor: "pink" }));
  ok(pink.classes.includes("nf-decor-hue"), "decor pink → nf-decor-hue");
  eq(pink.vars["--nf-decor-src"], "var(--nf-pink, #a85480)", "decor pink → --nf-decor-src");
  const accent = style(withDefaults({ decorColor: "accent" }));
  ok(accent.classes.includes("nf-decor-accent"), "decor accent → nf-decor-accent");
  eq(accent.vars["--nf-decor-src"], null, "decor accent → no decor source");
  ok(style(withDefaults({ look: "minimal", decorColor: "accent" })).classes.filter((c) => c.startsWith("nf-decor-")).join() === "nf-decor-accent", "explicit accent beats Minimal's neutral");
}

/* ---------- 7. codeTheme ---------- */
const codeThemeClasses = (codeTheme) => style(withDefaults({ codeTheme })).classes.filter((c) => c.startsWith("nf-code-theme-"));
eq(codeThemeClasses("auto"), [], "codeTheme auto → none");
eq(codeThemeClasses("github"), ["nf-code-theme-github"], "codeTheme github");
eq(codeThemeClasses("default"), [], "explicit default under Classic → none");
{
  const underNord = (codeTheme) => style(withDefaults({ palette: "nord", codeTheme })).classes.filter((c) => c.startsWith("nf-code-theme-"));
  eq(underNord("default"), ["nf-code-theme-default"], "explicit default under a palette → nf-code-theme-default (the palette's code colours step aside)");
  eq(underNord("auto"), [], "Follow palette under a palette → none (the palette's code colours apply)");
  eq(underNord("github"), ["nf-code-theme-github"], "an explicit theme under a palette → its own class only");
  ok(/body\.nf-code-theme-default\b/.test(styles), "styles.css has the nf-code-theme-default rule the class needs");
}
eq(codeThemeClasses("bogus"), [], "bogus → none");
eq(computeBodyStyle(withDefaults({ codeTheme: "github" }), { ...env, codeThemes: ["default", "nord"] }).classes.filter((c) => c.startsWith("nf-code-theme-")), [],
  "a theme outside env.codeThemes is ignored");

/* ---------- 8. exhaustive sweep ---------- */
{
  const union = new Set();
  let n = 0;
  const sweep = (s, label) => {
    const out = style(s);
    n++;
    for (const cls of out.classes) {
      assert.ok(NOTE_STYLE_CLASSES.includes(cls), `${label}: ${cls} is not in NOTE_STYLE_CLASSES`);
      union.add(cls);
    }
    assert.equal(new Set(out.classes).size, out.classes.length, `${label}: duplicate classes ${out.classes}`);
    assert.deepEqual(Object.keys(out.vars), VARS_LIT, `${label}: vars keys`);
    for (const [k, v] of Object.entries(out.vars)) assert.ok(v === null || (typeof v === "string" && v !== ""), `${label}: ${k} = ${JSON.stringify(v)}`);
  };
  for (const palette of PALETTES.map((p) => p.id)) for (const look of LOOKS.map((l) => l.id))
    for (const paletteSurface of ["theme", "page", "app"]) for (const paletteHeadings of [false, true]) for (const paletteLinks of [false, true])
      sweep(withDefaults({ palette, look, paletteSurface, paletteHeadings, paletteLinks }), `a ${palette}/${look}/${paletteSurface}`);
  for (const palette of ["classic", "guose"]) for (const key of COMPONENT_KEYS)
    for (const v of [...COMPONENTS[key].values, "auto", "bogus"]) sweep(withDefaults({ palette, [key]: v }), `b ${palette}/${key}=${v}`);
  for (const palette of ["classic", "nord"]) for (const key of COLOR_KEYS) {
    const values = key === "codeTheme" ? CODE_THEME_IDS : COLOR_VALUES[key];
    for (const v of [...values, "auto", "bogus", 7, null]) sweep(withDefaults({ palette, [key]: v }), `c ${palette}/${key}=${v}`);
  }
  for (const codeTheme of CODE_THEME_IDS) sweep(withDefaults({ codeTheme }), `d ${codeTheme}`);
  checks += n;
  eq(sorted(union), sorted(NOTE_STYLE_CLASSES), "the sweep emits every NOTE_STYLE_CLASSES entry (no dead entries)");
  eq(NOTE_STYLE_CLASSES.length, 61, "61 note-style classes");
  eq(new Set(NOTE_STYLE_CLASSES).size, 61, "no duplicate note-style classes");
  eq([...NOTE_STYLE_VARS], VARS_LIT, "NOTE_STYLE_VARS order");
  const block = mainTs.match(/const CODE_THEMES = \[([\s\S]*?)\] as const;/);
  ok(block, "CODE_THEMES found in main.ts");
  eq([...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]), [...CODE_THEME_IDS], "CODE_THEME_IDS matches main.ts CODE_THEMES");
  eq([...CODE_THEME_IDS], CODE_THEMES_LIT, "CODE_THEME_IDS literal");
}

/* ---------- 9. registry integrity ---------- */
eq(PALETTES.map((p) => p.id), ["classic", "notion", "nord", "morandi", "paper", "rose-pine", "catppuccin", "everforest", "guose"], "palette order");
eq(LOOKS.map((l) => l.id), ["classic", "editorial", "soft", "outline", "minimal", "gradient"], "look order");
eq(PALETTES.map((p) => [p.name.en, p.name.zh, p.group, p.suggestedLook, p.canvasPreset]), [
  ["Classic", "经典", "default", "classic", null],
  ["Notion", "Notion 原味", "calm", "soft", "mist"],
  ["Nord", "北境", "calm", "outline", "nord"],
  ["Morandi", "莫兰迪", "calm", "minimal", "morandi"],
  ["Paper & Ink", "纸墨", "calm", "editorial", "journal"],
  ["Rosé Pine", "玫瑰松", "expressive", "soft", "rose-pine"],
  ["Catppuccin", "猫咖", "expressive", "gradient", "catppuccin"],
  ["Everforest", "常青森林", "expressive", "soft", "forest"],
  ["Chinese Classic", "国色", "expressive", "editorial", "guose"],
], "palette names, groups, suggested looks, canvas presets");
eq(PALETTES.map((p) => p.inkHues.join(",")), [
  "red,blue,green,purple", "red,blue,green,purple", "red,blue,green,purple", "red,blue,green,purple", "red,blue,green,purple",
  "red,yellow,blue,purple", "red,blue,green,purple", "red,orange,green,cyan", "red,blue,green,yellow",
], "palette ink hues");
eq(LOOKS.map((l) => [l.name.en, l.name.zh]), [
  ["Classic", "经典"], ["Editorial", "杂志"], ["Soft cards", "柔和卡片"], ["Outline", "线框"], ["Minimal", "极简"], ["Gradient", "渐变"],
], "look names");
eq(PALETTES[0].desc, { en: "Today's look: muted inks that follow your theme.", zh: "当前外观：低饱和墨色，跟随主题。" }, "classic description");
eq(LOOKS[1].desc, { en: "Rail callouts, three-line tables, marker pen and ✦ breaks.", zh: "色条标注 · 三线表 · 荧光笔" }, "editorial description");
for (const def of [...PALETTES, ...LOOKS]) {
  for (const text of [def.name, def.desc]) {
    ok(typeof text.en === "string" && text.en.trim() && typeof text.zh === "string" && text.zh.trim(), `${def.id}: Bilingual complete`);
    ok(/[一-鿿]/.test(text.zh), `${def.id}: zh is Chinese (${text.zh})`);
  }
}
for (const p of PALETTES) {
  ok(LOOKS.some((l) => l.id === p.suggestedLook), `${p.id}: suggestedLook is a look`);
  eq(p.inkHues.length, 4, `${p.id}: 4 ink hues`);
  ok(p.inkHues.every((h) => STYLE_HUES.includes(h)), `${p.id}: ink hues are hues`);
  for (const mode of ["light", "dark"]) {
    eq(p.swatch[mode].length, 9, `${p.id}: 9 ${mode} swatches`);
    ok(p.swatch[mode].every((hex) => /^#[0-9a-f]{6}$/.test(hex)), `${p.id}: ${mode} swatches are #rrggbb`);
  }
}
eq([...STYLE_HUES], HUES_LIT, "STYLE_HUES");
eq([...COMPONENT_KEYS], ["calloutStyle", "headingStyle", "highlightStyle", "tableLook", "quoteStyle", "bulletStyle", "checkboxStyle", "dividerStyle", "toggleStyle", "columnStyle", "inlineCodeStyle", "decorColor"], "COMPONENT_KEYS");
eq([...COLOR_KEYS], ["listMarkerColor", "quoteBarColor", "inlineCodeColor", "tableHeaderColor", "codeTheme"], "COLOR_KEYS");
eq(Object.fromEntries(Object.entries(COLOR_VALUES).map(([k, v]) => [k, [...v]])), {
  listMarkerColor: ["accent", "default", ...HUES_LIT], quoteBarColor: ["text", "accent", "default", ...HUES_LIT],
  inlineCodeColor: ["default", ...HUES_LIT], tableHeaderColor: ["default", "none", ...HUES_LIT],
}, "COLOR_VALUES");
eq(COLOR_KEY_LABELS, {
  listMarkerColor: "List marker color", quoteBarColor: "Quote bar color", inlineCodeColor: "Inline code color",
  tableHeaderColor: "Table header background", codeTheme: "Code block theme",
}, "COLOR_KEY_LABELS");
eq({ ...LEGACY_STYLE_DEFAULTS }, LEGACY_LIT, "LEGACY_STYLE_DEFAULTS");
eq(STYLE_SCHEMA, 1, "STYLE_SCHEMA");
eq({ ...NOTE_STYLE_DEFAULTS }, {
  palette: "classic", look: "classic", paletteSurface: "theme", paletteHeadings: false, paletteLinks: false,
  calloutStyle: "auto", headingStyle: "auto", highlightStyle: "auto", tableLook: "auto", quoteStyle: "auto", bulletStyle: "auto",
  checkboxStyle: "auto", dividerStyle: "auto", toggleStyle: "auto", columnStyle: "auto", inlineCodeStyle: "auto", decorColor: "auto",
  listMarkerColor: "auto", quoteBarColor: "auto", inlineCodeColor: "auto", tableHeaderColor: "auto", codeTheme: "auto",
  canvasFollowPalette: true, styleSchema: 1,
}, "NOTE_STYLE_DEFAULTS");
const RECIPES_LIT = { // §3.1, one row per component: classic editorial soft outline minimal gradient
  calloutStyle: "header rail card outline minimal gradient", headingStyle: "plain editorial plain rule plain fade",
  highlightStyle: "block marker block underline underline marker", tableLook: "grid ruled card grid ruled card",
  quoteStyle: "bar pull tint bar bar tint", bulletStyle: "dot dash dot diamond dash diamond",
  checkboxStyle: "rounded ink soft circle circle rounded", dividerStyle: "fade ornament dots hairline dots ornament",
  toggleStyle: "chevron triangle triangle guide guide triangle", columnStyle: "plain divided plain divided plain divided",
  inlineCodeStyle: "pill ink tint outline ink tint", decorColor: "palette palette palette palette neutral palette",
};
for (const key of COMPONENT_KEYS) eq(LOOKS.map((l) => l.recipe[key]).join(" "), RECIPES_LIT[key], `recipes: ${key}`);
const COMPONENTS_LIT = {
  calloutStyle: ["nf-callout-menu", "Callout style", { header: "Header strip", flat: "Flat (Notion-like)", rail: "Side rail", card: "Soft card", outline: "Outlined", minimal: "Icon only", gradient: "Gradient title" }],
  headingStyle: ["nf-clean", "Heading accents", { plain: "Unadorned", rule: "Hairline rule", bar: "Accent bar", fade: "Fading underline", editorial: "Editorial" }],
  highlightStyle: [null, "Highlight style", { block: "Flat fill", marker: "Marker pen", underline: "Underline band" }],
  tableLook: ["nf-tables", "Table look", { grid: "Rounded grid", ruled: "Three-line table", card: "Card" }],
  quoteStyle: ["nf-clean", "Quote style", { bar: "Side bar", pull: "Pull quote", tint: "Tinted" }],
  bulletStyle: [null, "Bullet style", { dot: "Dot", dash: "Dash", diamond: "Diamond" }],
  checkboxStyle: ["nf-clean", "To-do checkbox", { rounded: "Rounded square", circle: "Circle", ink: "Ink square", soft: "Soft tick" }],
  dividerStyle: ["nf-clean", "Divider style", { fade: "Fading hairline", hairline: "Solid hairline", dots: "Three dots", ornament: "Ornament ✦" }],
  toggleStyle: ["nf-toggles", "Toggle arrow", { chevron: "Chevron", triangle: "Filled triangle", guide: "Guide line" }],
  columnStyle: ["nf-columns", "Column divider", { plain: "No divider", divided: "Hairline divider" }],
  inlineCodeStyle: ["nf-clean", "Inline code look", { pill: "Soft pill", tint: "Tinted pill", outline: "Outlined pill", ink: "Text only" }],
  decorColor: [null, "Decoration color", {
    palette: "Palette color", accent: "Accent color", neutral: "Neutral gray", gray: "Gray", red: "Red", orange: "Orange", yellow: "Yellow",
    green: "Green", cyan: "Cyan", blue: "Blue", purple: "Purple", pink: "Pink",
  }],
};
eq(Object.keys(COMPONENTS), [...COMPONENT_KEYS], "COMPONENTS keys in order");
for (const key of COMPONENT_KEYS) {
  const def = COMPONENTS[key];
  const [gate, label, optionLabels] = COMPONENTS_LIT[key];
  eq([def.gate, def.label, def.optionLabels], [gate, label, optionLabels], `COMPONENTS.${key}: gate, label, option labels`);
  eq([...def.values], Object.keys(optionLabels), `COMPONENTS.${key}: values in order`);
  eq(def.values[0], LOOKS[0].recipe[key], `COMPONENTS.${key}: first value is the Classic recipe`);
  ok(LOOKS.every((l) => def.values.includes(l.recipe[key])), `COMPONENTS.${key}: every recipe value is a value`);
  ok(!def.values.includes("auto"), `COMPONENTS.${key}: no auto among values`);
  const generic = ["Soft", "Dots", "Plain", "Rounded", "Square", "Underline", "Look"];
  ok(![def.label, ...Object.values(def.optionLabels)].some((k) => generic.includes(k)), `COMPONENTS.${key}: no generic i18n key`);
}

// Generator cross-check: the registry swatches and metadata are the generated tokens.
const gen = generate();
for (const p of PALETTES.slice(1)) {
  const g = gen.out[p.id];
  ok(g, `generator has ${p.id}`);
  for (const mode of ["light", "dark"]) eq([...p.swatch[mode]], STYLE_HUES.map((h) => g[mode].ink[h]), `${p.id}: ${mode} swatch = generated inks`);
  eq([p.name.en, p.name.zh, p.desc.en, p.desc.zh], [g.nameEn, g.nameZh, g.descEn, g.descZh], `${p.id}: name/desc = generator`);
  eq([p.group, p.suggestedLook, p.canvasPreset], [g.group, g.look, g.canvas], `${p.id}: group/look/canvas = generator`);
  eq([...p.inkHues], g.inkHues, `${p.id}: inkHues = generator`);
}
eq(Object.keys(gen.out), PALETTES.slice(1).map((p) => p.id), "the generator covers exactly the 8 non-classic palettes, in order");
eq([...PALETTES[0].swatch.light], HUES_LIT.map((h) => INK[h].hex), "Classic light swatch = main.ts PALETTE_INK");
{
  const at = styles.indexOf("Writing palette");
  ok(at >= 0, "styles.css Writing palette block");
  const darkAt = styles.indexOf("body.theme-dark {", at);
  const dark = styles.slice(darkAt, styles.indexOf("}", darkAt));
  const darkInk = Object.fromEntries([...dark.matchAll(/--nf-(\w+): (#[0-9a-f]{6});/g)].map((m) => [m[1], m[2]]));
  eq([...PALETTES[0].swatch.dark], HUES_LIT.map((h) => darkInk[h]), "Classic dark swatch = styles.css body.theme-dark inks");
}

// Canvas pairing presets (self-tightening while R2-W1-CANVAS lands).
{
  const ids = APPEARANCE_PRESETS.map((p) => p.id);
  for (const id of ["mist", "nord", "morandi", "journal", "forest"]) ok(ids.includes(id), `canvas preset ${id} exists`);
  const pending = ["rose-pine", "catppuccin", "guose"];
  const present = pending.filter((id) => ids.includes(id));
  if (present.length === 0) console.log(`SKIP (pending R2-W1-CANVAS): canvas presets ${pending.join(", ")} not added yet`);
  else eq(present, pending, "the three new canvas presets land together");
  for (const p of PALETTES) if (p.canvasPreset && (present.length || !pending.includes(p.canvasPreset))) ok(ids.includes(p.canvasPreset), `${p.id}: canvas preset ${p.canvasPreset} exists`);
}

// i18n (self-tightening while R2-W1-I18N lands).
{
  const { code } = transformSync(`${i18nTs}\nexport { ZH };\n`, { loader: "ts", format: "esm" });
  const { ZH } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  ok(ZH && Object.keys(ZH).length > 100, "ZH loaded");
  if (Object.prototype.hasOwnProperty.call(ZH, "Note style")) {
    const keys = new Set(["Follow palette", ...Object.values(COLOR_KEY_LABELS)]);
    for (const def of Object.values(COMPONENTS)) for (const k of [def.label, ...Object.values(def.optionLabels)]) keys.add(k);
    const missing = [...keys].filter((k) => !Object.prototype.hasOwnProperty.call(ZH, k));
    eq(missing, [], "every note-style label key has a ZH entry");
  } else console.log("SKIP (pending R2-W1-I18N): note-style ZH keys");
}

/* ---------- 10. overriddenKeys / followAll ---------- */
eq(overriddenKeys(NOTE_STYLE_DEFAULTS), [], "defaults override nothing");
const migratedFixture = withDefaults({ ...FIXTURE, ...migrateStyleSettings(FIXTURE) });
eq(overriddenKeys(migratedFixture), ["quoteBarColor", "inlineCodeColor", "codeTheme"], "migrated fixture overrides, in UI order");
{
  const followed = { ...migratedFixture, palette: "nord", look: "soft", paletteSurface: "page", ...followAll() };
  eq(overriddenKeys(followed), [], "followAll clears every override");
  eq([followed.palette, followed.look, followed.paletteSurface], ["nord", "soft", "page"], "followAll leaves palette/look/surface");
  const all = followAll();
  eq(Object.keys(all).length, 17, "followAll has 17 keys");
  ok(Object.values(all).every((v) => v === "auto"), "followAll: all auto");
  eq(sorted(Object.keys(all)), sorted([...COMPONENT_KEYS, ...COLOR_KEYS]), "followAll keys");
  ok(!("palette" in all || "look" in all || "paletteSurface" in all || "paletteHeadings" in all || "paletteLinks" in all), "followAll never touches the axes");
  ok(followAll() !== followAll(), "followAll returns a fresh object");
}
eq(overriddenKeys(withDefaults({ headingStyle: "bogus", listMarkerColor: "chartreuse", codeTheme: "nope", tableLook: 3 })), [], "invalid values are not overrides");
eq(overriddenKeys(withDefaults({ look: "editorial", calloutStyle: "rail", codeTheme: "default", decorColor: "palette" })),
  ["calloutStyle", "decorColor", "codeTheme"], "an explicit value equal to the recipe is pinned");
{
  const r = resolveNoteStyle(withDefaults({ look: "outline", tableLook: "card", palette: "paper" }));
  eq([r.palette, r.look], ["paper", "outline"], "resolveNoteStyle axes");
  eq(r.components.tableLook, { value: "card", source: "user" }, "resolveNoteStyle: user override");
  eq(r.components.headingStyle, { value: "rule", source: "look" }, "resolveNoteStyle: from the look");
  eq(Object.keys(r.components), [...COMPONENT_KEYS], "resolveNoteStyle covers every component");
  eq(resolveNoteStyle(withDefaults({ look: "minimal", bulletStyle: "zigzag" })).components.bulletStyle, { value: "dash", source: "look" }, "invalid → look");
}

/* ---------- extras: totality ---------- */
const CLASSIC_AUTO = {
  classes: ["nf-list-color", "nf-quote-color", "nf-code-color"],
  vars: {
    "--nf-list-marker": "var(--nf-style-list-marker, var(--interactive-accent))",
    "--nf-quote-bar": "var(--nf-style-quote-bar, var(--text-normal))",
    "--nf-inline-code": "var(--nf-style-inline-code, var(--nf-red, #b5554d))",
    "--nf-table-header-bg": null, "--nf-co-title-bottom": null, "--nf-decor-src": null,
  },
};
eq(computeBodyStyle({}, env), CLASSIC_AUTO, "computeBodyStyle({}) = Classic all-auto");
eq(style(NOTE_STYLE_DEFAULTS), CLASSIC_AUTO, "defaults = Classic all-auto");
noThrow(() => computeBodyStyle({ palette: 5, look: null, calloutStyle: {} }, env), "garbage types");
eq(computeBodyStyle({ palette: 5, look: null, calloutStyle: {} }, env), CLASSIC_AUTO, "garbage types → Classic all-auto");
noThrow(() => computeBodyStyle(null, undefined), "computeBodyStyle(null, undefined)");
eq(computeBodyStyle(undefined, {}), CLASSIC_AUTO, "a missing env falls back to the Classic inks");
eq(computeBodyStyle(withDefaults({ tableHeaderColor: "blue", decorColor: "cyan" }), null).vars, {
  ...CLASSIC_AUTO.vars, "--nf-table-header-bg": "rgba(var(--nf-blue-rgb, 74,124,166), 0.16)", "--nf-decor-src": "var(--nf-cyan, #43868c)",
}, "fallback env = main.ts paletteTint / paletteTextColor");
noThrow(() => resolveNoteStyle({}), "resolveNoteStyle({})");
noThrow(() => resolveNoteStyle(null), "resolveNoteStyle(null)");
noThrow(() => overriddenKeys({}), "overriddenKeys({})");
eq(overriddenKeys(undefined), [], "overriddenKeys(undefined)");
noThrow(() => canvasPaletteFor({}), "canvasPaletteFor({})");
eq(canvasPaletteFor(null), null, "canvasPaletteFor(null)");
noThrow(() => migrateStyleSettings("x"), "migrateStyleSettings('x')");
eq(migrateStyleSettings([1, 2]), {}, "migrate(array)");
noThrow(() => withPreview(null, null), "withPreview(null, null)");

/* ---------- extras: canvasPaletteFor ---------- */
eq(canvasPaletteFor({ palette: "notion", canvasFollowPalette: true }), "mist", "notion → mist");
eq(canvasPaletteFor({ palette: "paper", canvasFollowPalette: true }), "journal", "paper → journal");
eq(canvasPaletteFor({ palette: "everforest", canvasFollowPalette: true }), "forest", "everforest → forest");
eq(canvasPaletteFor({ palette: "nord", canvasFollowPalette: false }), null, "not following → null");
eq(canvasPaletteFor({ palette: "nord", canvasFollowPalette: "yes" }), null, "follow counts only when === true");
eq(canvasPaletteFor({ palette: "classic", canvasFollowPalette: true }), null, "classic → null");
eq(canvasPaletteFor({ palette: "custom", canvasFollowPalette: true }), null, "unknown → null");

/* ---------- extras: applyBodyStyle / clearBodyStyle ---------- */
function fakeBody(classes, props = {}) {
  const set = new Set(classes), map = new Map(Object.entries(props)), log = [];
  return {
    set, map, log,
    classList: {
      contains: (c) => set.has(c),
      add: (...cs) => { for (const c of cs) { log.push(`+${c}`); set.add(c); } },
      remove: (...cs) => { for (const c of cs) { log.push(`-${c}`); set.delete(c); } },
    },
    style: {
      setProperty: (n, v) => { log.push(`set ${n}`); map.set(n, String(v)); },
      removeProperty: (n) => { log.push(`rm ${n}`); const v = map.get(n) ?? ""; map.delete(n); return v; },
      getPropertyValue: (n) => map.get(n) ?? "",
    },
  };
}
{
  const body = fakeBody(["theme-dark", "nf-clean", "nf-lk-h-rule", "nf-list-color"], { "--nf-co-title-bottom": "6px", "--nf-empty-hint": '"x"' });
  const target = style(withDefaults({ palette: "nord", look: "outline", headingStyle: "plain", decorColor: "pink" }));
  applyBodyStyle(body, target);
  ok(body.set.has("theme-dark") && body.set.has("nf-clean"), "foreign classes are kept");
  ok(!body.set.has("nf-lk-h-rule"), "a stale note-style class is removed");
  eq(sorted([...body.set].filter((c) => NOTE_STYLE_CLASSES.includes(c))), sorted(target.classes), "body classes = the computed classes");
  ok(!body.log.includes("-nf-list-color") && !body.log.includes("+nf-list-color"), "an unchanged class is not toggled");
  ok(!body.log.includes("set --nf-co-title-bottom") && !body.log.includes("rm --nf-co-title-bottom"), "an unchanged property is not rewritten");
  for (const v of VARS_LIT) eq(body.map.get(v) ?? null, target.vars[v], `property ${v}`);
  eq(body.map.get("--nf-empty-hint"), '"x"', "a foreign property is kept");
  body.log.length = 0;
  applyBodyStyle(body, target);
  eq(body.log, [], "re-applying the same style touches nothing");
  applyBodyStyle(body, style(NOTE_STYLE_DEFAULTS));
  eq(sorted([...body.set]), sorted(["theme-dark", "nf-clean", ...CLASSIC_AUTO.classes]), "back to Classic");
  eq(body.map.get("--nf-decor-src"), undefined, "a null var is removed");
  clearBodyStyle(body);
  eq(sorted([...body.set]), ["nf-clean", "theme-dark"], "clearBodyStyle leaves only foreign classes");
  eq([...body.map.keys()], ["--nf-empty-hint"], "clearBodyStyle removes every NF style var");
  noThrow(() => applyBodyStyle(fakeBody([]), null), "applyBodyStyle(body, null)");
  const bare = fakeBody(["nf-callout-flat"]);
  delete bare.style.getPropertyValue;
  applyBodyStyle(bare, style(withDefaults({ look: "soft" })));
  eq(bare.map.get("--nf-co-title-bottom"), "6px", "works without getPropertyValue");
}

/* ---------- generator ---------- */
eq(gen.fails, [], "generate(): no contrast failures");
eq(gen.report.length, 3376, "generate(): 3376 contrast pairs");
ok(gen.summary.includes("Pairs checked: 3376") && gen.summary.trimEnd().endsWith("Failures: 0"), "generate(): summary");
eq(normalizeBody(renderBody(gen.css)), normalizeBody(gen.css), "normalizeBody drops the generator header");
eq(normalizeBody(`\r\n${HEADER}\r\nbody { --x: 1; }\r\n`), "body { --x: 1; }", "normalizeBody: CRLF, header, trim");
{
  const code = (fn) => { try { fn(); } catch (error) { return error.code; } return "no throw"; };
  eq(code(() => extractBlock("a { }")), "MARKERS", "extractBlock: 0 markers");
  eq(code(() => extractBlock(`${START}\n${START}\nx\n${END}`)), "MARKERS", "extractBlock: 2 start markers");
  eq(code(() => extractBlock(`${START}\nx\n${END}\n${END}`)), "MARKERS", "extractBlock: 2 end markers");
  eq(code(() => extractBlock(`${END}\nx\n${START}`)), "MARKERS", "extractBlock: end before start");
  const text = `a { color: red; }\n\n${START}\n  stale\n\n${END}\n\nb { color: blue; }\n`;
  eq(extractBlock(text).body, "\n  stale\n\n", "extractBlock: body strictly between the markers");
  const next = replaceBlock(text, "c { --y: 2; }\n\n");
  eq(next, `a { color: red; }\n\n${START}\n${HEADER}\nc { --y: 2; }\n${END}\n\nb { color: blue; }\n`, "replaceBlock keeps everything outside the markers");
  eq(replaceBlock(next, "c { --y: 2; }\n"), next, "replaceBlock is idempotent");
}

/* ---------- styles.css (self-tightening while R2-W1-CSS lands) ---------- */
if (styles.includes(START)) {
  eq(normalizeBody(extractBlock(styles).body), normalizeBody(gen.css), "styles.css token block is up to date (run npm run gen:styles)");
} else console.log("SKIP (pending R2-W1-CSS): token block");
if (styles.includes("/* ---------- Note style: palettes & looks ---------- */")) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  const uncovered = NOTE_STYLE_CLASSES.filter((cls) => !new RegExp(`\\.${esc(cls)}(?![\\w-])`).test(styles));
  eq(uncovered, [], "every note-style class has CSS");
} else console.log("SKIP (pending R2-W1-CSS): CSS coverage");

console.log(`PASS run-style-presets (${checks} checks)`);
