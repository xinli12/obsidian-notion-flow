/* Contrast gate for the note-style palettes, read straight from styles.css:
   every palette in light and dark, on the theme background (#fff / #1c1c1c)
   and on its own paper tone, keeps text, inks, highlights, Callout titles,
   table washes, inline code and code tokens readable (WCAG 2.x ratios).
   The shares (Callout fills, strips, table and cell alphas) are parsed from
   the stylesheet too, so retuning a token re-runs the gate on real values.
   It also pins the Classic palette: its inks equal main.ts PALETTE_INK, the
   dark set, ink = RGB triplet (the Callout colour rules rely on it) and the
   Settings gallery's Classic preview.
   Plain Node, reads only repo files. NF_STYLES=/path/to/copy.css checks a
   scratch copy of the stylesheet instead of the repo's. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cssPath = process.env.NF_STYLES || resolve(root, "styles.css");
const css = readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/* ---- stylesheet: flat rule blocks, merged per exact selector ---- */
function splitTop(list) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}
const blocks = [];
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const prelude = m[1].trim();
  if (prelude.startsWith("@") || /^(from|to|[\d.]+%)(\s*,\s*(from|to|[\d.]+%))*$/.test(prelude)) continue;
  const decl = {};
  for (const d of m[2].split(";")) {
    const i = d.indexOf(":");
    if (i > 0) decl[d.slice(0, i).trim()] = d.slice(i + 1).replace(/\s+/g, " ").trim();
  }
  blocks.push({ sels: splitTop(prelude), decl });
}
const get = (...sels) => Object.assign({}, ...sels.flatMap((sel) => blocks.filter((b) => b.sels.includes(sel)).map((b) => b.decl)));
const listFor = (sel) => blocks.find((b) => b.sels.includes(sel))?.sels ?? [];

/* ---- colour maths (WCAG luminance, OKLab mixing, alpha compositing) ---- */
const hex2rgb = (h) => { h = h.replace("#", ""); if (h.length === 3) h = [...h].map((x) => x + x).join(""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const rgb2hex = (a) => "#" + a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const s2l = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const l2s = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const lum = (rgb) => { const [r, g, b] = rgb.map(s2l); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const toRgb = (x) => (typeof x === "string" ? hex2rgb(x) : x);
/* A composited colour is compared as the 8-bit pixel the browser paints. */
const pixel = (x) => toRgb(x).map((v) => Math.round(Math.max(0, Math.min(255, v))));
const contrast = (a, b) => { const A = lum(pixel(a)), B = lum(pixel(b)); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
function rgb2oklch(rgb) {
  const [r, g, b] = rgb.map(s2l);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}
function oklch2rgb(L, C, H) {
  const h = (H * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(l2s);
}
/** alpha compositing: src at alpha over bg (sRGB, as the browser blends) */
const over = (src, alpha, bg) => toRgb(src).map((v, i) => toRgb(bg)[i] * (1 - alpha) + v * alpha);
/** CSS color-mix(in oklab, a pct, b) for opaque colours */
function mixOklab(a, pct, b) {
  const lab = (x) => { const [L, C, H] = rgb2oklch(toRgb(x)); const h = (H * Math.PI) / 180; return [L, C * Math.cos(h), C * Math.sin(h)]; };
  const A = lab(a), B = lab(b);
  const [L, x, y] = A.map((v, i) => v * pct + B[i] * (1 - pct));
  return rgb2hex(oklch2rgb(L, Math.hypot(x, y), ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360));
}
const triplet = (s) => s.split(",").map((v) => Number(v.trim()));
const pct = (v, what) => { const m = /^([\d.]+)%$/.exec(v ?? ""); assert.ok(m, `${what} is a percentage in styles.css (got ${v})`); return Number(m[1]) / 100; };
const num = (v, what) => { assert.ok(v !== undefined && /^[\d.]+$/.test(v), `${what} is a number in styles.css (got ${v})`); return Number(v); };
/** a token value → opaque RGB: #hex, "r, g, b", rgba() composited over the surface, var(--nf-<hue>) */
function resolveColour(value, tokens, surface) {
  let v = value.trim();
  const ref = /^var\(--nf-([a-z]+)\)$/.exec(v);
  if (ref) v = tokens[`--nf-${ref[1]}`];
  assert.ok(v, `colour ${value} resolves`);
  if (v.startsWith("#")) return hex2rgb(v);
  const n = v.match(/[\d.]+/g).map(Number);
  return n.length === 4 ? over(n.slice(0, 3), n[3], surface) : n;
}

/* ---- palettes and their shares ---- */
const HUES = ["gray", "red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"];
const EXPECTED_IDS = ["notion", "nord", "morandi", "paper", "rose-pine", "catppuccin", "everforest", "guose"];
const ids = [...new Set(blocks.flatMap((b) => b.sels).map((s) => /^body\.nf-palette-([a-z-]+)$/.exec(s)?.[1]).filter(Boolean))]
  .filter((id) => !["page", "app", "headings", "links"].includes(id));
assert.deepEqual([...ids].sort(), [...EXPECTED_IDS].sort(), "styles.css defines exactly the eight note-style palettes");
for (const id of ids) {
  assert.ok(listFor(`body.nf-palette-${id}`).includes(`.nf-palette-preview[data-palette="${id}"]`), `${id}: the light block also feeds the gallery preview`);
  assert.ok(listFor(`body.theme-dark.nf-palette-${id}`).includes(`.theme-dark .nf-palette-preview[data-palette="${id}"]`), `${id}: the dark block also feeds the gallery preview`);
}

const pal = { light: get("body.nf-palette"), dark: get("body.nf-palette", "body.theme-dark.nf-palette") };
const grad = {
  light: get("body.nf-palette.nf-callout-menu.nf-callout-gradient"),
  dark: get("body.nf-palette.nf-callout-menu.nf-callout-gradient", "body.theme-dark.nf-palette.nf-callout-menu.nf-callout-gradient"),
};
const titleMixBlock = blocks.find((b) => b.sels.some((s) => s.startsWith("body.nf-palette.nf-callout-menu.nf-callout-gradient :is(")) && b.decl["--nf-co-title-mix"]);
assert.ok(titleMixBlock, "the gradient look's title mix is declared under a palette");
const titleMix = pct(titleMixBlock.decl["--nf-co-title-mix"], "--nf-co-title-mix");
/* Light table / cell / comment alphas are the var() fallbacks of the Classic rules. */
const fallback = (name) => {
  const m = new RegExp(`var\\(--nf-a-${name}, ([\\d.]+)\\)`).exec(css);
  assert.ok(m, `the Classic rules read --nf-a-${name} with a fallback`);
  return Number(m[1]);
};
const SH = {};
for (const mode of ["light", "dark"]) {
  const T = pal[mode], G = grad[mode], D = mode === "dark" ? get("body.theme-dark.nf-palette") : {};
  const alpha = (name) => (mode === "dark" ? num(D[`--nf-a-${name}`], `dark --nf-a-${name}`) : fallback(name));
  SH[mode] = {
    box: pct(T["--nf-co-fill"], `${mode} --nf-co-fill`),
    strip: pct(T["--nf-co-strip"], `${mode} --nf-co-strip`),
    card: pct(T["--nf-co-fill-card"], `${mode} --nf-co-fill-card`),
    rail: pct(T["--nf-co-fill-rail"], `${mode} --nf-co-fill-rail`),
    gfill: pct(G["--nf-co-fill"], `${mode} gradient --nf-co-fill`),
    gpeak: pct(G["--nf-co-grad"], `${mode} gradient --nf-co-grad`),
    thead: alpha("thead"),
    cell: alpha("cell"),
    cellYellow: alpha("cell-yellow"),
  };
}
const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));
assert.deepEqual(round(SH.light), { box: 0.14, strip: 0.049, card: 0.16, rail: 0.1, gfill: 0.07, gpeak: 0.26, thead: 0.22, cell: 0.25, cellYellow: 0.28 }, "light palette shares (DESIGN-SPEC §5.3)");
assert.deepEqual(round(SH.dark), { box: 0.1, strip: 0.035, card: 0.12, rail: 0.08, gfill: 0.06, gpeak: 0.22, thead: 0.16, cell: 0.2, cellYellow: 0.2 }, "dark palette shares (DESIGN-SPEC §5.3)");
assert.equal(titleMix, 0.7, "the gradient title is pulled 30% toward the text under a palette");

/* ---- the gate ---- */
const BG = { light: "#ffffff", dark: "#1c1c1c" };
const fails = [], mins = {}, rows = [];
let pairs = 0;
function check(label, value, min, where, row) {
  pairs++;
  if (!mins[label] || value < mins[label].v) mins[label] = { v: value, where };
  if (row && (!row[label] || value < row[label].v)) row[label] = { v: value, where };
  if (value < min - 1e-9) fails.push(`${where}: ${label} ${value.toFixed(2)} < ${min}`);
}
for (const id of ids) {
  for (const mode of ["light", "dark"]) {
    const T = get(mode === "light" ? `body.nf-palette-${id}` : `body.theme-dark.nf-palette-${id}`);
    const S = SH[mode], row = {};
    for (const [label, surface] of [["theme", BG[mode]], ["paper", T["--nf-style-paper"]]]) {
      const where = `${id}/${mode}/${label}`, bg = hex2rgb(surface), text = T["--nf-style-text"];
      check("text", contrast(text, bg), 7, where, row);
      check("heading", contrast(T["--nf-style-heading"], bg), 7, where);
      check("heading-tint", contrast(T["--nf-style-heading-tint"], bg), 7, where);
      check("muted", contrast(T["--nf-style-muted"], bg), 4.5, where);
      check("link", contrast(T["--nf-style-link"], bg), 4.5, where);
      check("decor-ink", contrast(T["--nf-style-decor-ink"], bg), 4.5, where);
      for (const k of ["list-marker", "quote-bar", "decor"]) check(k, contrast(T[`--nf-style-${k}`], bg), 3, where);
      for (const h of HUES) {
        const w = `${where}/${h}`, ink = T[`--nf-${h}`], src = triplet(T[`--nf-${h}-rgb`]);
        const hl = over(src, h === "yellow" ? 0.2 : 0.18, bg);
        check("ink", contrast(ink, bg), 4.5, w, row);
        check("ink on own highlight", contrast(ink, hl), 4.5, w, row);
        check("text on highlight", contrast(text, hl), 4.5, w);
        check("text on cell wash", contrast(text, over(src, h === "yellow" ? S.cellYellow : S.cell, bg)), 4.5, w);
        check("text on tinted header", contrast(text, over(src, S.thead, bg)), 4.5, w);
        check("title on strip", contrast(ink, over(src, S.strip, over(src, S.box, bg))), 4.5, w, row);
        check("title on card", contrast(ink, over(src, S.card, bg)), 4.5, w);
        check("gradient title", contrast(mixOklab(ink, titleMix, text), over(src, S.gpeak, over(src, S.gfill, bg))), 4.5, w, row);
        check("text on card fill", contrast(text, over(src, S.card, bg)), 4.5, w);
        check("text on rail fill", contrast(text, over(src, S.rail, bg)), 4.5, w);
      }
      const pill = resolveColour(T["--nf-style-inline-code-bg"], T, bg);
      check("inline code", contrast(resolveColour(T["--nf-style-inline-code"], T, bg), pill), 4.5, where, row);
      check("text on thead", contrast(text, resolveColour(T["--nf-style-thead"], T, bg)), 4.5, where);
    }
    const codeBg = T["--nf-style-code-bg"];
    const tokens = Object.entries(T).filter(([k]) => k.startsWith("--nf-style-code-") && k !== "--nf-style-code-bg");
    assert.ok(tokens.length >= 8 && codeBg, `${id}/${mode}: code tokens and background are defined`);
    for (const [k, v] of tokens) check("code token", contrast(v, codeBg), 4.5, `${id}/${mode}/${k.slice(16)}`, row);
    rows.push([`${id}/${mode}`, row]);
  }
}

/* ---- Classic: the inks notes store, the dark set, ink = triplet ---- */
const mainTs = readFileSync(resolve(root, "src/main.ts"), "utf8");
const inkAt = mainTs.indexOf("const PALETTE_INK");
assert.ok(inkAt >= 0, "src/main.ts declares PALETTE_INK");
const INK = Object.fromEntries([...mainTs.slice(inkAt, mainTs.indexOf("};", inkAt)).matchAll(/(\w+): \{ hex: "(#[0-9a-f]{6})", rgb: "([\d,]+)" \}/g)].map((m) => [m[1], { hex: m[2], rgb: m[3] }]));
assert.deepEqual(Object.keys(INK), HUES, "PALETTE_INK lists the nine hues");
const DARK = {
  gray: ["#9a9a95", "154,154,149"], red: ["#ce7a73", "206,122,115"], orange: ["#c98b52", "201,139,82"],
  yellow: ["#c2a45c", "194,164,92"], green: ["#6fa98a", "111,169,138"], cyan: ["#6ba5a8", "107,165,168"],
  blue: ["#7b9fc9", "123,159,201"], purple: ["#a183c9", "161,131,201"], pink: ["#c482a5", "196,130,165"],
};
const classic = { light: get("body"), dark: get("body.theme-dark") };
const norm = (s) => (s ?? "").replace(/\s+/g, "");
for (const h of HUES) {
  assert.equal(classic.light[`--nf-${h}`], INK[h].hex, `Classic light --nf-${h} = PALETTE_INK`);
  assert.equal(norm(classic.light[`--nf-${h}-rgb`]), INK[h].rgb, `Classic light --nf-${h}-rgb = PALETTE_INK`);
  assert.equal(classic.dark[`--nf-${h}`], DARK[h][0], `Classic dark --nf-${h} = DESIGN-SPEC §2.3`);
  assert.equal(norm(classic.dark[`--nf-${h}-rgb`]), DARK[h][1], `Classic dark --nf-${h}-rgb = DESIGN-SPEC §2.3`);
  for (const mode of ["light", "dark"]) {
    assert.equal(hex2rgb(classic[mode][`--nf-${h}`]).join(","), norm(classic[mode][`--nf-${h}-rgb`]), `Classic ${mode} ${h}: ink = triplet (the Callout colour rules rely on it)`);
  }
}
const galleryClassic = { light: get('.nf-palette-preview[data-palette="classic"]'), dark: get('.theme-dark .nf-palette-preview[data-palette="classic"]') };
for (const mode of ["light", "dark"]) {
  for (const h of HUES) {
    assert.equal(galleryClassic[mode][`--nf-${h}`], classic[mode][`--nf-${h}`], `gallery Classic ${mode} --nf-${h} = the Classic ink`);
    assert.equal(norm(galleryClassic[mode][`--nf-${h}-rgb`]), norm(classic[mode][`--nf-${h}-rgb`]), `gallery Classic ${mode} --nf-${h}-rgb = the Classic triplet`);
  }
}

/* ---- R2-W2-CSS ---- */
/* code-theme-light-chrome: the fixed-dark code themes (One Dark, Dracula,
   Nord) keep their dark card in light mode, so the chrome ink is a share of
   the card's own ink: the language label (text) reads at 4.5:1, the caret
   (--code-normal) at 3:1, and code text on the selection wash at 4:1. */
{
  const chromeBlock = blocks.find((b) => b.decl["--nf-code-chrome"]);
  assert.ok(chromeBlock, "the fixed-dark code themes define --nf-code-chrome");
  for (const id of ["one-dark", "dracula", "nord"]) {
    assert.ok(chromeBlock.sels.some((s) => s.includes(`.nf-code-theme-${id}`)), `--nf-code-chrome covers ${id}`);
  }
  const chromeM = /^color-mix\(in srgb, var\(--code-normal\) (\d+)%, var\(--code-background\)\)$/.exec(chromeBlock.decl["--nf-code-chrome"]);
  assert.ok(chromeM, `--nf-code-chrome mixes the card's ink into its background (got ${chromeBlock.decl["--nf-code-chrome"]})`);
  const selM = /^color-mix\(in srgb, var\(--code-normal\) (\d+)%, transparent\)$/.exec(chromeBlock.decl["--nf-code-selection"] ?? "");
  assert.ok(selM, "--nf-code-selection is a wash of the card's ink");
  const chromeP = Number(chromeM[1]) / 100, selA = Number(selM[1]) / 100;
  const lines = [];
  for (const id of ["one-dark", "dracula", "nord"]) {
    const t = get(`body.nf-code-theme-${id} .markdown-source-view`);
    assert.ok(t["--code-background"] && t["--code-normal"], `${id} defines --code-background and --code-normal`);
    const bg = t["--code-background"], ink = t["--code-normal"];
    const chrome = over(ink, chromeP, bg), sel = over(ink, selA, bg);
    const c = { chrome: contrast(chrome, bg), caret: contrast(ink, bg), selected: contrast(ink, sel) };
    assert.ok(c.chrome >= 4.5, `${id}: code chrome ${c.chrome.toFixed(2)}:1 on the card (needs 4.5)`);
    assert.ok(c.caret >= 3, `${id}: caret ${c.caret.toFixed(2)}:1 on the card (needs 3)`);
    assert.ok(c.selected >= 4, `${id}: code text on the selection ${c.selected.toFixed(2)}:1 (needs 4)`);
    lines.push(`${id} chrome ${c.chrome.toFixed(2)} caret ${c.caret.toFixed(2)} selected ${c.selected.toFixed(2)}`);
  }
  console.log(`code chrome (${chromeM[1]}% ink, ${selM[1]}% selection): ${lines.join("; ")}`);
}

/* canvas dark (canvas-dark-tints-and-panels, w1c-new-presets-dark): every
   mind-map preset's dark tones, through the dark tints styles.css declares.
   Clean and cards cards mix the topic into Obsidian's dark ground; pastel
   topics mix toward a dark tone of their own hue and write in a luminous
   one. Words keep 4.5:1 on every fill (a root, 24px bold, 3:1); clean and
   pastel cards stand 1.5:1 off the canvas under the presets that use those
   looks. */
{
  const GROUND = "#1e1e1e"; // Obsidian's dark --background-primary / --canvas-background
  const TEXT = "#dadada"; // Obsidian's dark --text-normal
  /* color-mix(in oklch, a p, b): shorter hue arc; a hue-less grey takes the other side's hue. */
  const lch = (x) => (Array.isArray(x) && x.length === 3 && x[0] <= 1.01 ? x : rgb2oklch(toRgb(x)));
  const mixOklch = (a, p, b) => {
    const A = lch(a), B = lch(b);
    let ha = A[2], hb = B[2];
    if (A[1] < 0.0004) ha = hb;
    if (B[1] < 0.0004) hb = ha;
    let d = hb - ha;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return [A[0] * p + B[0] * (1 - p), A[1] * p + B[1] * (1 - p), (ha + d * (1 - p) + 360) % 360];
  };
  const paint = (x) => oklch2rgb(...lch(x));
  const darkTints = blocks.find((b) => b.sels.includes(".theme-dark .canvas-wrapper.nf-canvas-polished .canvas-node.nf-canvas-map-text"))?.decl ?? {};
  const tint = (name) => pct(darkTints[name], `dark ${name}`);
  const T = { root: tint("--nf-tint-root"), branch: tint("--nf-tint-branch"), cardRoot: tint("--nf-tint-card-root"), card: tint("--nf-tint-card") };
  const softOf = (sel) => pct(get(sel)["--nf-soft"], `${sel} --nf-soft`);
  const SOFT = {
    root: softOf(".canvas-wrapper.nf-canvas-polished .canvas-node.nf-theme-pastel.nf-canvas-map-root.nf-canvas-map-text"),
    branch: softOf(".canvas-wrapper.nf-canvas-polished .canvas-node.nf-theme-pastel.nf-canvas-map-branch.nf-canvas-map-text"),
    sub: softOf(".canvas-wrapper.nf-canvas-polished .canvas-node.nf-theme-pastel.nf-canvas-map-text"),
  };
  assert.ok(/0\.34 calc\(c \* 0\.8\) h/.test(css) && /oklch\(from var\(--nf-topic\) 0\.9 0\.05 h\)/.test(css), "the dark pastel ground (0.34, 0.8C) and luminous ink (0.9, 0.05) are the ones modelled here");
  const appearance = readFileSync(resolve(root, "src/canvas/appearance.ts"), "utf8");
  const presets = [...appearance.matchAll(/id: "([a-z-]+)"[\s\S]*?theme: "(\w+)"[\s\S]*?(?<![A-Za-z])dark: \{\s*rootColor: "(#[0-9A-Fa-f]{6})",\s*branchColors: \[([^\]]*)\]/g)]
    .map((m) => ({ id: m[1], theme: m[2], root: m[3], branches: [...m[4].matchAll(/"(#[0-9A-Fa-f]{6})"/g)].map((x) => x[1]) }));
  assert.ok(presets.length >= 15, `at least 15 mind-map presets carry dark tones (found ${presets.length})`);
  for (const id of ["rose-pine", "catppuccin", "guose"]) assert.ok(presets.some((p) => p.id === id), `the wave-1 preset ${id} is checked`);
  const worst = {};
  const note = (key, v, where) => { if (!worst[key] || v < worst[key].v) worst[key] = { v, where }; };
  const fails2 = [];
  for (const p of presets) {
    for (const [level, colour] of [["root", p.root], ...p.branches.map((c) => ["branch", c])]) {
      const root = level === "root";
      const H = lch(colour);
      const looks = {
        clean: [mixOklch(colour, root ? T.root : T.branch, GROUND), mixOklch(colour, root ? 0.42 : 0.32, TEXT)],
        cards: [mixOklch(colour, root ? T.cardRoot : T.card, GROUND), root ? mixOklch(colour, 0.42, TEXT) : TEXT],
      };
      for (const [soft, s] of root ? [["root", SOFT.root]] : [["branch", SOFT.branch], ["sub", SOFT.sub]]) {
        looks[`pastel ${soft}`] = [mixOklch(colour, s, [0.34, H[1] * 0.8, H[2]]), [0.9, 0.05, H[2]]];
      }
      for (const [look, [fill, ink]] of Object.entries(looks)) {
        const where = `${p.id} ${level} ${colour} ${look}`;
        // A root topic is 1.5x the text size at weight 700: large text, 3:1.
        const text = contrast(paint(ink), paint(fill)), bar = root ? 3 : 4.5;
        note(`${look.split(" ")[0]} ${root ? "root" : "branch"} text`, text, where);
        if (text < bar) fails2.push(`${where}: text ${text.toFixed(2)}:1 (needs ${bar})`);
        if (look.startsWith(p.theme) && p.theme !== "cards") {
          const off = contrast(paint(fill), GROUND);
          note(`${p.theme} card/canvas`, off, where);
          if (off < 1.5) fails2.push(`${where}: card vs canvas ${off.toFixed(2)}:1`);
        }
      }
    }
  }
  assert.deepEqual(fails2, [], "dark mind-map cards: words at 4.5:1 (roots, large, 3:1), clean and pastel cards 1.5:1 off the canvas");
  console.log(`canvas dark (${presets.length} presets; tints ${[T.root, T.branch, T.cardRoot, T.card].map((x) => Math.round(x * 100) + "%").join("/")}): ` +
    Object.entries(worst).map(([k, r]) => `${k} ${r.v.toFixed(2)} (${r.where.split(" ").slice(0, 2).join(" ")})`).join("; "));
}

/* review-css-6: the Classic gallery card washes its mini Callout at
   Classic's 7% in dark mode too (the later .theme-dark .nf-mini 12% is
   (0,2,0); the dark Classic block, (0,3,0), restates 7%). */
{
  const light = get('.nf-palette-preview[data-palette="classic"]')["--nf-mini-co-pct"];
  const dark = get('.theme-dark .nf-palette-preview[data-palette="classic"]')["--nf-mini-co-pct"];
  assert.equal(light, "7%", "the Classic gallery card washes at 7% in light");
  assert.equal(dark, "7%", "the Classic gallery card washes at 7% in dark (it inherited .theme-dark .nf-mini's 12%)");
}

/* ---- R2-W3-CSS ---- */
/* block-colour-and-callout-icons-css (U2.3): a block background is the
   hue's wash source at --nf-a-blk over the page. The alphas stay at or
   under the stored highlight alpha (0.18), and body text keeps 4.5:1 on
   every hue's block tint, Classic and every palette, light and dark, on
   the theme ground and on the palette's paper. */
{
  const raw = readFileSync(cssPath, "utf8");
  const at = raw.indexOf("/* ---------- Block colour (backgrounds) ---------- */");
  assert.ok(at >= 0, "styles.css has the Block colour section");
  const sec = raw.slice(at, raw.indexOf("/* ---------- ", at + 20)).replace(/\/\*[\s\S]*?\*\//g, "");
  const alphaIn = (sel) => {
    const m = new RegExp(`(?:^|\\})\\s*${sel.replace(/\./g, "\\.")}\\s*\\{[^}]*--nf-a-blk:\\s*([\\d.]+)`).exec(sec);
    assert.ok(m, `--nf-a-blk is declared on ${sel} in the Block colour section`);
    return Number(m[1]);
  };
  const A = { light: alphaIn("body"), dark: alphaIn("body.theme-dark") };
  for (const mode of ["light", "dark"]) assert.ok(A[mode] <= 0.18, `${mode} --nf-a-blk ${A[mode]} stays at or under the highlight alpha 0.18`);
  const TEXT = { light: "#222222", dark: "#dadada" }; // Obsidian's --color-base-100
  const worstBlk = {};
  const failsBlk = [];
  const gate = (name, text, src, alpha, ground, where) => {
    pairs++;
    const v = contrast(text, over(src, alpha, ground));
    if (!worstBlk[name] || v < worstBlk[name].v) worstBlk[name] = { v, where };
    if (v < 4.5) failsBlk.push(`${where}: ${v.toFixed(2)}`);
  };
  for (const mode of ["light", "dark"]) {
    for (const h of HUES) gate(`classic/${mode}`, TEXT[mode], triplet(classic[mode][`--nf-${h}-rgb`]), A[mode], BG[mode], `classic/${mode}/${h}`);
  }
  for (const id of ids) {
    for (const mode of ["light", "dark"]) {
      const T = get(mode === "light" ? `body.nf-palette-${id}` : `body.theme-dark.nf-palette-${id}`);
      for (const ground of [BG[mode], T["--nf-style-paper"]]) {
        for (const h of HUES) gate(`${id}/${mode}`, T["--nf-style-text"], triplet(T[`--nf-${h}-rgb`]), A[mode], ground, `${id}/${mode}/${ground}/${h}`);
      }
    }
  }
  assert.deepEqual(failsBlk, [], "body text keeps 4.5:1 on every block tint");
  const cl = (m) => worstBlk[`classic/${m}`].v.toFixed(1);
  console.log(`block tints (alpha ${A.light} light / ${A.dark} dark): Classic min ${cl("light")} light / ${cl("dark")} dark; ` +
    Object.entries(worstBlk).filter(([k]) => !k.startsWith("classic")).map(([k, r]) => `${k} ${r.v.toFixed(1)}`).join(", "));
}

/* editor-hints-css (U2.2): a tinted slash-menu chip. The glyph is the
   group's --color-* pulled toward the text colour in OKLab, on a chip of
   the same hue at a low sRGB alpha; it keeps the 3:1 non-text minimum for
   every tinted group, light and dark, at rest (chip over the menu's
   --background-primary) and on the selected row (chip over the hover
   wash). Obsidian 1.13.7 app.css defaults: --color-blue / -green / -orange
   / -purple, --color-base-00 (the menu ground via --suggestion-background
   → --background-primary), --color-base-100 (--text-normal), and
   --background-modifier-hover = color-mix(in oklch, var(--mono-100) 6.7%,
   transparent) with --mono-100 black (light) / white (dark). */
{
  const TINTS = {
    light: { list: "#086ddd", media: "#08b94e", container: "#ec7500", date: "#7852ee" },
    dark: { list: "#027aff", media: "#44cf6e", container: "#e9973f", date: "#a882ff" },
  };
  const GROUND = { light: "#ffffff", dark: "#1c1c1c" };
  const TEXT = { light: "#222222", dark: "#dadada" };
  const MONO = { light: "#000000", dark: "#ffffff" };
  const HOVER = 0.067;
  const inkM = /--nf-slash-ink:\s*color-mix\(in oklab, var\(--nf-slash-tint\) (\d+)%, var\(--text-normal\)\)/.exec(css);
  const chipM = /background-color:\s*color-mix\(in srgb, var\(--nf-slash-tint\) (\d+)%, transparent\)/.exec(css);
  assert.ok(inkM && chipM, "styles.css declares the slash chip ink (--nf-slash-ink, oklab mix) and its tinted chip (srgb mix with transparent)");
  const inkPct = Number(inkM[1]) / 100, chipPct = Number(chipM[1]) / 100;
  for (const [group, token] of [["list", "--color-blue"], ["media", "--color-green"], ["container", "--color-orange"], ["date", "--color-purple"]]) {
    const re = new RegExp(`\\.nf-slash-item\\[data-nf-group="${group}"\\][^{]*\\{[^}]*--nf-slash-tint:\\s*var\\(${token}\\)`);
    assert.ok(re.test(css), `the ${group} group tints its chip with ${token}`);
  }
  const table = [];
  let worst = null;
  for (const mode of ["light", "dark"]) {
    for (const [group, tint] of Object.entries(TINTS[mode])) {
      const ink = mixOklab(tint, inkPct, TEXT[mode]);
      for (const [state, ground] of [["rest", GROUND[mode]], ["selected", over(MONO[mode], HOVER, GROUND[mode])]]) {
        pairs++;
        const v = contrast(ink, over(tint, chipPct, ground));
        table.push(`${mode}/${group}/${state} ${v.toFixed(2)}`);
        if (!worst || v < worst.v) worst = { v, where: `${mode}/${group}/${state}` };
        if (v < 3 - 1e-9) fails.push(`slash chip ${mode}/${group}/${state}: ${v.toFixed(2)} < 3`);
      }
    }
  }
  console.log(`slash chips (ink ${Math.round(inkPct * 100)}% oklab, chip ${Math.round(chipPct * 100)}%): min ${worst.v.toFixed(2)} @ ${worst.where}; ${table.join(", ")}`);
}

/* settings-and-toolbar-polish-css (U2.4): the Highlight button's bar is the
   run's own wash (main.ts BG_COLORS: the hue at 0.18, yellow 0.2), stacked
   as N layers so it reads on the toolbar card: at least 1.5:1 against the
   card for every Classic hue, light and dark (a single layer, the old 2px
   bar, is listed for comparison). The card is --nf-pop-bg: the page at 94%
   in light (#ffffff), Obsidian's --menu-background (#282828) at 94% over
   the page (#1c1c1c) in dark. */
{
  const m = /\.nf-color-btn:has\(svg\.lucide-highlighter\)::after\s*\{([^}]*)\}/.exec(css);
  assert.ok(m, "styles.css draws the Highlight button's bar");
  const layers = (m[1].match(/linear-gradient\(var\(--nf-current-color\), var\(--nf-current-color\)\)/g) || []).length + (/,\s*var\(--nf-current-color, var\(--interactive-accent\)\)\s*;/.test(m[1]) ? 1 : 0);
  assert.ok(layers >= 3, `the bar stacks the wash (${layers} layers)`);
  const CARD = { light: "#ffffff", dark: rgb2hex(over("#282828", 0.94, "#1c1c1c")) };
  const table = [];
  let worst = null;
  for (const mode of ["light", "dark"]) {
    for (const h of HUES) {
      const a = h === "yellow" ? 0.2 : 0.18;
      let g = CARD[mode];
      for (let i = 0; i < layers; i++) g = over(triplet(classic[mode][`--nf-${h}-rgb`]), a, g);
      const one = contrast(over(triplet(classic[mode][`--nf-${h}-rgb`]), a, CARD[mode]), CARD[mode]);
      const v = contrast(g, CARD[mode]);
      pairs++;
      table.push(`${mode}/${h} ${v.toFixed(2)} (1 layer ${one.toFixed(2)})`);
      if (!worst || v < worst.v) worst = { v, where: `${mode}/${h}` };
      if (v < 1.5) fails.push(`highlight bar ${mode}/${h}: ${v.toFixed(2)} < 1.5 against the toolbar`);
    }
  }
  console.log(`highlight bar (${layers} layers): min ${worst.v.toFixed(2)} @ ${worst.where}; ${table.join(", ")}`);
}

/* ---- report ---- */
const f = (r) => (r ? `${r.v.toFixed(2)}${/\/(\w+)$/.test(r.where) && HUES.includes(r.where.split("/").pop()) ? ` ${r.where.split("/").pop()}` : ""}` : "-");
const cols = ["text", "ink", "ink on own highlight", "title on strip", "gradient title", "inline code", "code token"];
const table = [["palette/mode", "text", "ink", "own hl", "strip", "gradient", "icode", "code"], ...rows.map(([name, r]) => [name, ...cols.map((c) => f(r[c]))])];
const widths = table[0].map((_, i) => Math.max(...table.map((r) => r[i].length)));
if (fails.length || process.env.NF_CONTRAST_REPORT) {
  console.log(table.map((r) => r.map((c, i) => c.padEnd(widths[i])).join("  ")).join("\n"));
  console.log("\nminimum per check:");
  for (const [k, r] of Object.entries(mins)) console.log(`  ${k.padEnd(22)} ${r.v.toFixed(2)}  @ ${r.where}`);
}
if (fails.length) {
  console.error(`\nFAIL style-contrast: ${fails.length} of ${pairs} pairs below the bar:\n` + fails.map((x) => "  " + x).join("\n"));
  process.exit(1);
}
const m = (k) => mins[k].v.toFixed(2);
console.log(`PASS style-contrast: ${pairs} pairs, 0 failures (min text ${m("text")}, ink ${m("ink")}, own highlight ${m("ink on own highlight")}, strip ${m("title on strip")}, gradient ${m("gradient title")}, inline code ${m("inline code")}, code ${m("code token")})`);
