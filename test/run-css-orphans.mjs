/* Static checks over styles.css: canvas classes the code sets but no rule
   styles, selector hygiene (a pseudo-element inside :is()/:where() drops the
   whole rule silently), and guards that keep fixed visual bugs fixed.
   Plain Node, reads only repo files. NF_STYLES=/path/to/copy.css checks a
   scratch copy of the stylesheet instead of the repo's. */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cssPath = process.env.NF_STYLES || resolve(root, "styles.css");
const css = readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/* Top-level comma split that ignores commas inside :is(…) / :not(…) etc. */
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
/* The arguments of every :is( / :where( / :not( / :has( in one selector. */
function pseudoArgs(selector) {
  const out = [];
  const re = /:(is|where|not|has)\(/g;
  let m;
  while ((m = re.exec(selector))) {
    let depth = 1, i = m.index + m[0].length;
    const start = i;
    while (i < selector.length && depth) {
      if (selector[i] === "(") depth++;
      else if (selector[i] === ")") depth--;
      i++;
    }
    out.push([m[1], selector.slice(start, i - 1)]);
  }
  return out;
}
/* Flat rule blocks. Rules nested in @media still match (the at-rule prelude
   never reaches a closing brace); @keyframes steps and @property are skipped. */
function parseRules(text) {
  const rules = [];
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const prelude = m[1].trim();
    if (prelude.startsWith("@") || /^(from|to|[\d.]+%)(\s*,\s*(from|to|[\d.]+%))*$/.test(prelude)) continue;
    const decls = m[2].split(";").map((d) => d.replace(/\s+/g, " ").trim()).filter(Boolean);
    rules.push({ selectors: splitTop(prelude), decls, body: decls.join("; ") });
  }
  return rules;
}
const rules = parseRules(css);
const rulesWith = (test) => rules.filter((r) => r.selectors.some((s) => (typeof test === "string" ? s.includes(test) : test.test(s))));
const hasDecl = (rule, re) => rule.decls.some((d) => re.test(d));

/* ---- lint: no pseudo-element inside :is() / :where() ---- */
const pseudoInIs = [];
for (const rule of rules) {
  for (const s of rule.selectors) {
    for (const [kind, inner] of pseudoArgs(s)) if ((kind === "is" || kind === "where") && inner.includes("::")) pseudoInIs.push(s);
  }
}
assert.deepEqual(pseudoInIs, [], "a pseudo-element inside :is()/:where() makes the browser drop the whole rule");

/* ---- guards: fixed visual bugs stay fixed ---- */
/* empty-hint-inline: a truly empty line lifts its hint out of flow, so the
   caret's row keeps its height instead of wrapping the hint under the <br>. */
const hintRules = rulesWith(".nf-empty-hint:has(> br:only-child)::after");
assert.ok(hintRules.length > 0, "the empty-line hint has an out-of-flow rule for <br>-only lines");
assert.ok(hintRules.some((r) => hasDecl(r, /^position: absolute$/)), "the <br>-only empty-line hint is position: absolute");

/* plugin-buttons-transparent: Obsidian's button:not(.clickable-icon) (0,1,1)
   outranks single-class plugin selectors, so every paint/state rule of the
   toolbar buttons and swatches carries `button` + its container. */
assert.ok(rulesWith(/\.nf-toolbar button\.nf-toolbar-btn\.is-active/).length > 0, "the active toolbar button state is raised");
assert.ok(rulesWith(/\.nf-toolbar button\.nf-swatch\b/).length > 0, "the swatch paint is raised");
for (const [selector, name] of [
  [/^\.nf-toolbar button\.nf-toolbar-btn$/, "resting toolbar button"],
  [/^\.nf-toolbar button\.nf-swatch$/, "resting swatch"],
  [/^\.nf-table-picker button\.nf-table-picker-cell$/, "resting table-picker cell"],
  [/^button\.nf-rendered-code-fold$/, "Reading-view code fold"],
]) {
  const found = rulesWith(selector);
  assert.ok(found.length > 0, `${name}: raised paint rule exists`);
  assert.ok(found.some((r) => hasDecl(r, /^box-shadow: none$|^box-shadow: inset/)), `${name}: clears Obsidian's button shadow`);
  assert.ok(found.some((r) => hasDecl(r, /^background(-color)?: /)), `${name}: sets its own background`);
}
for (const rule of rulesWith(/\.nf-(toolbar-btn|swatch)\b/)) {
  for (const s of rule.selectors) {
    if (!/\.nf-(toolbar-btn|swatch)\b/.test(s) || /^\.nf-(toolbar-btn|swatch)[\w-]*( svg)?$/.test(s)) continue;
    if (/^\.nf-toolbar-btn:disabled$/.test(s)) continue;
    if (/(^|\s)button\.nf-/.test(s) || /\.nf-toolbar\b.*\bbutton\b/.test(s)) continue;
    assert.fail(`toolbar paint/state selector is not raised past Obsidian's button rules: ${s}`);
  }
}
for (const rule of rulesWith(/^\.nf-(toolbar-btn|swatch)$/)) {
  assert.ok(!rule.decls.some((d) => /^(background|background-color|box-shadow|color):/.test(d)), `the (0,1,0) base rule owns geometry only: ${rule.selectors.join(", ")}`);
}

/* toggle-looks: entering a toggle paints no Callout card or title strip;
   the empty-toggle hint is Live Preview only; toggles without a fold element
   get a stand-in chevron keyed on a DIRECT child fold (the descendant form
   would see a nested Callout's fold and drop the chevron). */
assert.ok(
  rulesWith(/\.nf-co-edit\.nf-co-toggle::after$/).some((r) => hasDecl(r, /^content: none$/)),
  "toggle edit rows clear the Callout card pseudo-element",
);
const emptyToggleHint = rulesWith(/\.callout\[data-callout="nf-toggle"\].*:not\(:has\(> \.callout-content\)\)::after$/);
assert.ok(emptyToggleHint.length > 0, "the empty-toggle hint rule exists");
for (const rule of emptyToggleHint) {
  for (const s of rule.selectors) assert.ok(s.includes(".is-live-preview"), `the empty-toggle hint is Live Preview only: ${s}`);
}
const standIn = rulesWith(/\.callout\[data-callout="nf-toggle"\] > \.callout-title:not\(:has\(.*\.callout-fold\)\)::before$/);
assert.ok(standIn.some((r) => hasDecl(r, /^content: ""$/)), "fold-less toggles get a stand-in chevron");
for (const rule of standIn) {
  for (const s of rule.selectors) assert.ok(s.includes(":not(:has(> .callout-fold))"), `the stand-in chevron keys on the direct-child fold: ${s}`);
}

/* block-menu-selectors: Obsidian appends every Menu to <body>, so rules
   under the host (.nf-block-menu-anchor .menu) never match; the menu is
   styled through the class tagBlockMenu() puts on it. Disabled rows keep
   Obsidian's faint ink, and reduced motion silences the menu and the
   selection toolbar entrances. */
assert.deepEqual(rulesWith(".nf-block-menu-anchor .menu").flatMap((r) => r.selectors), [], "no dead .nf-block-menu-anchor .menu selectors");
assert.ok(
  rulesWith(/^\.menu\.nf-block-menu \.menu-item\.is-disabled$/).some((r) => hasDecl(r, /^color: var\(--text-faint\)$/)),
  "disabled block-menu rows keep the faint ink",
);
assert.ok(
  rulesWith(/^\.nf-block-menu-anchor$/).some((r) => hasDecl(r, /^width: 0$/) && hasDecl(r, /^height: 0$/) && !hasDecl(r, /^inset: 0$/)),
  "the block-menu host is a 0x0 point, not a full-window layer",
);
{
  const silenced = rulesWith(/^\.menu\.nf-block-menu$/).filter((r) => hasDecl(r, /^animation: none$/));
  assert.ok(silenced.some((r) => r.selectors.includes(".nf-block-selection-toolbar")), "reduced motion stops the block menu and the selection toolbar entrances");
}
assert.ok(rulesWith(/(^|\s)\.nf-settings\)? \.nf-help-key$|:is\([^)]*\.nf-settings[^)]*\) \.nf-help-key$/).length > 0, "the Block chords chips are styled in Settings");

/* reading-heading-spacing: Reading view wraps each block in its own div, so
   a heading :first-child reset matched every heading and flattened all
   lead-ins; the level margins key on the section's wrapper instead. */
assert.deepEqual(
  rulesWith(/\.markdown-reading-view :is\(h1, h2, h3, h4, h5, h6\):first-child$/).flatMap((r) => r.selectors),
  [],
  "no Reading-view heading :first-child reset (it matches every wrapped heading)",
);
assert.ok(
  rulesWith(/^body\.nf-clean \.markdown-reading-view \.markdown-preview-section > div > :is\(h1, h2, h3, h4, h5, h6\)$/).some((r) => hasDecl(r, /^margin-block: var\(--nf-h3-space\) var\(--nf-h-after\)$/)),
  "Reading-view headings take their level margins from the section wrapper",
);

/* callout-edit-no-jump: the flat title padding published on body belongs to
   the title row only, and the title row's leading beats line-height
   snippets (they use !important on .cm-line); toggles keep their own. */
assert.ok(
  rulesWith(/\.nf-co-first:not\(\.nf-co-toggle\)$/).some((r) => hasDecl(r, /^line-height: 1\.35 !important$/)),
  "the Callout title row's 1.35 leading wins over note-wide snippets",
);
assert.ok(
  rulesWith(/:not\(\.nf-co-first\)$/).some((r) => hasDecl(r, /^--nf-co-title-bottom: 0px$/)),
  "rows other than the title take no title padding",
);
assert.deepEqual(
  rules.filter((r) => hasDecl(r, /^line-height: 1\.35 !important$/)).flatMap((r) => r.selectors).filter((s) => /\.nf-co-first\b/.test(s) && !s.includes(":not(.nf-co-toggle)")),
  [],
  "the !important title leading never reaches toggle titles",
);
/* A nested box's last row that also closes its parents carries their bottom
   air, for Callouts and toggles alike. */
assert.equal(
  rulesWith(/\.nf-co-nested\.nf-co-last.*:not\(:has\(\+ \.cm-line:is\(\.nf-co-edit, \.nf-co-code\)\)\)$/).filter((r) => hasDecl(r, /^--nf-co-air-bottom: calc\(/)).length,
  2,
  "rows that close a nested box and its parents stand for every closed level's air",
);

/* columns-and-callout-chrome: the column slash menu is found by its own
   class (it lives under <body>, out of the paint-contained row); the
   preview renders soft breaks once; the editor root makes room for the
   active column's ring without narrowing the columns; the row button hides
   at rest; and the Callout chevron is pushed right only in Reading view,
   where no edit-block button sits on it. */
assert.deepEqual(rulesWith(".nf-column-editor-host .cm-tooltip").flatMap((r) => r.selectors), [], "no column slash selectors under the paint-contained host");
assert.ok(rulesWith(".cm-tooltip.cm-tooltip-autocomplete.nf-column-slash").length > 0, "the column slash menu is dressed by its class");
{
  const silenced = rulesWith(/^\.menu\.nf-block-menu$/).filter((r) => hasDecl(r, /^animation: none$/));
  assert.ok(silenced.some((r) => r.selectors.some((s) => s.includes(".nf-column-slash"))), "reduced motion stops the column slash menu entrance");
}
assert.ok(rulesWith(/^body\.nf-columns \.nf-column-preview$/).some((r) => hasDecl(r, /^white-space: normal$/)), "column previews do not break soft line breaks twice");
{
  const root = rulesWith(/^body\.nf-columns \.nf-columns-editor$/);
  assert.ok(root.some((r) => hasDecl(r, /^width: calc\(100% \+ 16px\)$/) && hasDecl(r, /^padding-inline: 8px$/)), "the columns editor reaches 8px past the text on each side");
  assert.ok(
    rulesWith(/\.cm-content > \.nf-columns-editor$/).some((r) => hasDecl(r, /^margin-inline: -8px !important$/)),
    "the ring room survives Obsidian's .cm-content > * { margin: 0 !important }",
  );
}
assert.ok(rulesWith(/^\.nf-cols-menu$/).some((r) => hasDecl(r, /^opacity: 0$/) && hasDecl(r, /^pointer-events: none$/)), "the row options button is hidden at rest");
/* The row's hover cluster (column menu, row menu, Obsidian's edit button)
   reads as one group of equal pills; the column menu takes the cluster
   size through custom properties, so the coarse-pointer sizes still win. */
assert.ok(
  rulesWith(/\.callout\[data-callout="nf-cols"\]\) > \.embed-actions > \.edit-block-button$/).some((r) => hasDecl(r, /^background-color: var\(--embed-actions-background/)),
  "the edit-block button on a columns row wears the cluster's pill",
);
for (const rule of rulesWith(/> \.nf-col-menu$/)) {
  assert.ok(!rule.decls.some((d) => /^(min-)?(width|height):/.test(d)), `raised column-menu rules size through --nf-col-menu-*: ${rule.selectors.join(", ")}`);
}
{
  const pushed = rules.filter((r) => hasDecl(r, /^margin-inline-start: auto$/) && r.selectors.some((s) => /\.callout-fold$/.test(s)));
  assert.ok(pushed.length > 0, "Reading view keeps the right-aligned Callout chevron");
  for (const r of pushed) {
    for (const s of r.selectors) {
      assert.ok(s.includes(".markdown-reading-view") && !s.includes(".is-live-preview"), `the chevron is pushed right in Reading view only: ${s}`);
    }
  }
}

/* note-style-callout-tokens: Callout paint reads share tokens so a note
   style re-skins every layer; the only literal left between "Polished
   Callouts" and "Columns" is the fold-hover mix. */
const raw = readFileSync(cssPath, "utf8");
const section = (from, to) => {
  const a = raw.indexOf(from);
  assert.ok(a >= 0, `styles.css has the section ${from}`);
  const b = raw.indexOf(to, a + from.length);
  return raw.slice(a, b < 0 ? raw.length : b);
};
{
  const callouts = section("/* ---------- Polished Callouts", "/* ---------- Columns").replace(/\/\*[\s\S]*?\*\//g, "");
  const literals = [...callouts.matchAll(/color-mix\(\s*in srgb,\s*var\(--(?:callout-color|nf-co-parent-color)[^)]*\)\)?\s*([\d.]+)%/g)].map((m) => m[1]);
  assert.deepEqual(literals, ["12"], "Callout paint uses --nf-co-* shares; only the fold-hover 12% stays literal");
  assert.ok(
    rulesWith(/^body$/).some((r) => hasDecl(r, /^--nf-co-fill: 7%$/) && hasDecl(r, /^--nf-co-edge: 20%$/) && hasDecl(r, /^--nf-co-strip: 3\.5%$/)),
    "the Classic Callout shares are declared on body",
  );
  assert.ok(rulesWith(/^\.callout$/).some((r) => hasDecl(r, /^--nf-co-surface: initial$/)), "a nested Callout never inherits its parent's fill source");
  for (const hue of ["gray", "red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"]) {
    assert.ok(
      rulesWith(new RegExp(`^\\.callout\\[data-callout-metadata~="nf-${hue}"\\]$`)).some((r) => hasDecl(r, new RegExp(`^--callout-color: var\\(--nf-${hue}\\)$`)) && hasDecl(r, new RegExp(`^--nf-co-surface: rgb\\(var\\(--nf-${hue}-rgb\\)\\)$`))),
      `|nf-${hue} Callouts take the ink for edges and the triplet for the fill`,
    );
  }
  const tables = section("/* ---------- Per-table / per-cell backgrounds", "/* ---------- List-contained").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.deepEqual([...tables.matchAll(/rgba\(var\(--nf-\w+-rgb\), [\d.]+\)/g)].map((m) => m[0]), [], "table and cell washes read --nf-a-* tokens");
  assert.ok(rulesWith(/span\.nf-cmt\[data-nf-cmt\]$/).some((r) => hasDecl(r, /--nf-a-comment, 0\.16/)), "the comment wash reads --nf-a-comment");
}

/* note-style-section: palettes and looks live in one section after every
   section they override (equal specificity wins by order); every visible
   rule is scoped under a palette, look or decoration class, so Classic (no
   class) renders exactly as before; the generated token block sits between
   exactly one pair of markers. */
{
  const HEAD = "/* ---------- Note style: palettes & looks ---------- */";
  const at = raw.indexOf(HEAD);
  assert.ok(at >= 0, "the Note style section exists");
  for (const before of ["/* ---------- Writing palette", "/* ---------- Polished Callouts", "/* ---------- Callout colour", "/* ---------- In-place Callout editing", "/* ---------- Columns", "/* ---------- Toggles", "/* ---------- Comments", "/* ---------- Tables", "/* ---------- Per-table / per-cell backgrounds"]) {
    const i = raw.indexOf(before);
    assert.ok(i >= 0 && i < at, `the Note style section comes after ${before.slice(15)}`);
  }
  assert.ok(raw.indexOf("/* ---------- Settings tab") > at, "the Note style section comes before Settings tab");
  const body = section(HEAD, "/* ---------- Settings tab");
  const START = "/* @generated note-style tokens:start */", END = "/* @generated note-style tokens:end */";
  assert.equal(raw.split(START).length - 1, 1, "exactly one generated-block start marker");
  assert.equal(raw.split(END).length - 1, 1, "exactly one generated-block end marker");
  assert.ok(body.includes(START) && body.indexOf(START) < body.indexOf(END), "the generated block sits inside the Note style section, start before end");
  const SCOPE = /\.nf-palette\b|\.nf-palette-[a-z-]+|\.nf-callout-(rail|card|outline|minimal|gradient)\b|\.nf-lk-|\.nf-decor-/;
  const unscoped = [];
  for (const rule of parseRules(body.replace(/\/\*[\s\S]*?\*\//g, ""))) {
    if (rule.decls.every((d) => d.startsWith("--"))) continue;
    for (const s of rule.selectors) if (!SCOPE.test(s)) unscoped.push(s);
  }
  assert.deepEqual(unscoped, [], "every visible Note style rule is scoped under nf-palette* / nf-callout-<look> / nf-lk-* / nf-decor-*");
  const ids = [...body.matchAll(/^body\.nf-palette-([a-z-]+),$/gm)].map((m) => m[1]);
  assert.deepEqual(ids, ["notion", "nord", "morandi", "paper", "rose-pine", "catppuccin", "everforest", "guose"], "one generated light block per palette");
  /* The fold-less toggle's stand-in chevron follows the triangle look. */
  assert.ok(
    rulesWith(/^body\.nf-toggles\.nf-lk-toggle-triangle \.callout\[data-callout="nf-toggle"\] > \.callout-title:not\(:has\(> \.callout-fold\)\)::before$/).some((r) => hasDecl(r, /^mask-image: url\(/)),
    "the triangle look reshapes the stand-in chevron too",
  );
  assert.ok(rulesWith(/^\.nf-gallery$/).length > 0 && rulesWith(/^\.theme-dark \.nf-palette-preview\[data-palette="classic"\]$/).length > 0, "the Settings gallery is styled");
}
/* The style module's class list and this stylesheet agree both ways
   (skipped until src/features/style-presets.ts exists). */
{
  const presets = resolve(root, "src/features/style-presets.ts");
  if (existsSync(presets)) {
    const src = readFileSync(presets, "utf8");
    const list = src.slice(src.indexOf("export const NOTE_STYLE_CLASSES"), src.indexOf("];", src.indexOf("export const NOTE_STYLE_CLASSES")));
    const classes = new Set([...list.matchAll(/"(nf-[a-z0-9-]+)"/g)].map((m) => m[1]));
    if (list.includes("CODE_THEME_IDS")) {
      const ids = src.slice(src.indexOf("export const CODE_THEME_IDS"), src.indexOf("]", src.indexOf("export const CODE_THEME_IDS")));
      for (const m of ids.matchAll(/"([a-z0-9-]+)"/g)) if (m[1] !== "default") classes.add(`nf-code-theme-${m[1]}`);
    }
    assert.ok(classes.size > 40, "NOTE_STYLE_CLASSES parsed");
    const selectorClasses = new Set();
    for (const rule of rules) for (const s of rule.selectors) for (const m of s.matchAll(/\.(nf-[a-z0-9-]+)/g)) selectorClasses.add(m[1]);
    assert.deepEqual([...classes].filter((c) => !selectorClasses.has(c)), [], "every NOTE_STYLE_CLASSES class has at least one rule");
    const NOT_BODY = new Map([
      ["nf-palette-preview", "the Settings gallery's mini previews carry the palette tokens themselves"],
    ]);
    const strays = [...selectorClasses].filter((c) => /^nf-(lk|decor)-|^nf-palette(-|$)|^nf-callout-(rail|card|outline|minimal|gradient)$/.test(c) && !classes.has(c) && !NOT_BODY.has(c));
    assert.deepEqual(strays, [], "every note-style class the stylesheet keys on is one the style module sets");
  } else console.log("SKIP (pending R2-W1-STYLEMOD): NOTE_STYLE_CLASSES cross-check");
}

/* dark-popover-lift: dark popovers sit on the menu surface, raised above
   the page, and neither mode stacks a second heavy shadow layer. */
assert.ok(
  rulesWith(/^body\.theme-dark$/).some((r) => hasDecl(r, /^--nf-pop-bg: color-mix\(in srgb, var\(--menu-background/)),
  "dark popovers use the menu surface, not the page colour",
);
assert.ok(
  rulesWith(/^body$/).some((r) => hasDecl(r, /^--nf-pop-shadow: var\(--shadow-l\)$/)),
  "the light popover shadow is the theme's one shadow layer",
);

/* ---- R2-W2-CSS ---- */
/* link-comment-card-chrome: Save (mod-cta) is the only filled button on the
   link and comment cards; every other button is a ghost that keeps a focus
   outline (box-shadow: none also clears Obsidian's ring); Unlink is a
   ghost with error ink; the link hint keeps wrapping (it doubles as the
   red validation message); the words a link card is about keep a
   selection tint snapshotted on body. */
{
  const ghosts = rulesWith(/^\.nf-link-pop-actions button:not\(\.mod-cta\)$/);
  assert.ok(
    ghosts.some((r) => hasDecl(r, /^background-color: transparent$/) && hasDecl(r, /^box-shadow: none$/) && r.selectors.includes(".nf-cmt-card .nf-cmt-card-actions button")),
    "link and comment card secondaries are transparent ghosts",
  );
  for (const sel of [".nf-link-pop-actions button:not(.mod-cta)", ".nf-cmt-pop-actions button:not(.mod-cta)", ".nf-cmt-card .nf-cmt-card-actions button"]) {
    assert.ok(
      rules.some((r) => r.selectors.includes(`${sel}:focus-visible`) && hasDecl(r, /^outline: 2px solid var\(--interactive-accent\)$/)),
      `a ghost button keeps a keyboard focus outline: ${sel}`,
    );
  }
  assert.ok(rules.some((r) => r.selectors.includes(".nf-link-pop-actions button.mod-warning") && hasDecl(r, /^color: var\(--text-error\)$/)), "Unlink is a ghost with error ink");
  assert.ok(!rules.some((r) => r.selectors.includes(".nf-link-pop-actions button.mod-warning") && hasDecl(r, /^background-color: var\(--background-modifier-error/)), "Unlink is not a filled red button");
  assert.ok(rules.some((r) => r.selectors.includes(".nf-cmt-pop .nf-cmt-hint") && hasDecl(r, /^white-space: nowrap$/) && hasDecl(r, /^text-overflow: ellipsis$/)), "the comment hint stays on one line");
  assert.deepEqual(
    rulesWith(/\.nf-link-pop \.nf-link-hint$/).filter((r) => hasDecl(r, /^white-space: nowrap$/)).flatMap((r) => r.selectors),
    [],
    "the link hint keeps wrapping: it doubles as the red error message",
  );
  assert.ok(rulesWith(/^body$/).some((r) => hasDecl(r, /^--nf-link-pending-bg: var\(--text-selection\)$/)), "the pending-link tint is snapshotted on body");
  assert.ok(rulesWith(/\.nf-link-pending$/).some((r) => hasDecl(r, /^background-color: var\(--nf-link-pending-bg\)$/)), "the pending-link words wear the tint");
}

/* lint: a relative selector (one starting with >, + or ~) is only valid
   inside :has(); inside :is()/:where() the browser drops the whole rule. */
{
  const relativeInIs = [];
  for (const rule of rules) {
    for (const s of rule.selectors) {
      for (const [kind, inner] of pseudoArgs(s)) {
        if ((kind === "is" || kind === "where") && splitTop(inner).some((arg) => /^[>+~]/.test(arg))) relativeInIs.push(s);
      }
    }
  }
  assert.deepEqual(relativeInIs, [], "a relative selector (> + ~) inside :is()/:where() makes the browser drop the whole rule");
}

/* table-and-caption-surfaces: the picker's focus is its own accent edge,
   not a second frame; tables of nine or more columns drop the 80px floor
   and never break a word, and a table that still does not fit scrolls with
   edge shadows driven by a scroll timeline; the toolbar's main and table
   rows start at the same left edge; captions sit 3px under their block in
   Reading view. */
{
  const picker = rulesWith(/^\.nf-table-picker:focus-visible$/);
  assert.ok(picker.length > 0 && picker.every((r) => hasDecl(r, /^outline: none$/)), "the table picker's focus draws no outline");
  assert.ok(!picker.some((r) => hasDecl(r, /^outline: 2px/)), "the table picker has no 2px focus frame");
  const NINE = ":not(:has(tr > :nth-child(9)))";
  const floors = rules.filter((r) => hasDecl(r, /^min-width: (80|56)px$/) && r.selectors.some((s) => /\btable\b/.test(s)));
  assert.ok(floors.length >= 2, "the table cell floors (80px, and 56px on narrow panes) exist");
  for (const r of floors) {
    for (const s of r.selectors) assert.ok(s.includes(NINE), `a table cell floor spares tables of nine or more columns: ${s}`);
  }
  const wide = rules.filter((r) => r.selectors.some((s) => s.replace(NINE, "").includes(":has(tr > :nth-child(9))")));
  assert.ok(wide.length > 0 && wide.every((r) => hasDecl(r, /^overflow-wrap: break-word$/)), "tables of nine or more columns never break a word to fit");
  assert.match(css, /@property --nf-scroll-start\s*\{/, "--nf-scroll-start is a registered (animatable) property");
  assert.match(css, /@property --nf-scroll-end\s*\{/, "--nf-scroll-end is a registered (animatable) property");
  for (const scroller of [".nf-table-scroll", ".cm-table-widget"]) {
    const found = rulesWith(new RegExp(`\\${scroller}$`)).filter((r) => hasDecl(r, /^animation-timeline: scroll\(self inline\)$/));
    assert.ok(found.length > 0, `${scroller} runs the edge-shadow scroll timeline`);
    for (const r of found) {
      const a = r.decls.findIndex((d) => /^animation: /.test(d)), t = r.decls.findIndex((d) => /^animation-timeline: /.test(d));
      assert.ok(a >= 0 && t > a, `animation-timeline comes after the animation shorthand (which resets it): ${r.selectors.join(", ")}`);
    }
  }
  assert.deepEqual(
    rulesWith(".nf-toolbar-main").filter((r) => hasDecl(r, /^justify-content: center$/)).flatMap((r) => r.selectors),
    [],
    "the toolbar's main row starts at the left edge, like the table row under it",
  );
  assert.ok(rulesWith(/p\.nf-image-caption-block > br$/).some((r) => hasDecl(r, /^display: none$/)), "an image caption's <br> adds no line box");
  const seams = rules.filter((r) => hasDecl(r, /^margin-block: 0$/) && r.selectors.some((s) => /caption-block|small\.nf-caption/.test(s) && s.includes(".markdown-reading-view")));
  assert.ok(seams.length > 0, "Reading-view caption paragraphs lose their margins");
  for (const r of seams) {
    for (const s of r.selectors) assert.ok(s.startsWith("body.nf-clean .markdown-reading-view p"), `the caption margin reset outranks the clean paragraph margins: ${s}`);
  }
  assert.ok(
    rulesWith(/^\.markdown-rendered p:is\(\.nf-code-caption-block, \.nf-image-caption-block, \.nf-table-caption-block\)$/).some((r) => hasDecl(r, /^margin-block: 0$/)),
    "rendered Callouts in Live Preview take the same seam (the reset outranks Obsidian's .markdown-rendered p)",
  );
  assert.deepEqual(
    rulesWith("table.nf-captioned-table").filter((r) => hasDecl(r, /^margin-block-end: 3px$/)).flatMap((r) => r.selectors),
    [],
    "a captioned table adds no 3px of its own: the caption's margin is the seam",
  );
}

/* block-selection-look: selection, drop line and landing flash read five
   body tokens (a palette or look restyles them there), and the drag ghost
   is opaque so the line under it never shows through. */
{
  const TOKENS = ["--nf-block-selection-bg", "--nf-block-selection-ring", "--nf-drop-indicator", "--nf-drop-indicator-halo", "--nf-land-from"];
  assert.ok(
    rulesWith(/^body$/).some((r) => TOKENS.every((t) => hasDecl(r, new RegExp(`^${t}: `)))),
    "one body rule defines the five block-selection tokens",
  );
  const marks = rulesWith(/^\.nf-multi-block-highlight$/);
  assert.ok(marks.some((r) => hasDecl(r, /^background: var\(--nf-block-selection-bg\)$/) && hasDecl(r, /^outline: 1px solid var\(--nf-block-selection-ring\)$/)), "the selection mark reads the selection tokens");
  assert.deepEqual(
    rulesWith(".nf-multi-block-highlight").filter((r) => r.body.includes("color-mix(in srgb, var(--interactive-accent)")).flatMap((r) => r.selectors),
    [],
    "no selection-mark rule hard-wires the accent mix",
  );
  const land = css.match(/@keyframes nf-land\s*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/);
  assert.ok(land && land[1].includes("var(--nf-land-from") && land[1].includes("var(--nf-block-selection-bg"), "the landing flash starts at --nf-land-from and settles into the selection tint");
  for (const sel of [".nf-drop-indicator", ".nf-drop-indicator::before", ".nf-col-indicator", ".nf-col-indicator::before"]) {
    const found = rulesWith(new RegExp(`^${sel.replace(/[.:]/g, (m) => "\\" + m)}$`));
    assert.ok(found.some((r) => hasDecl(r, /^background-color: var\(--nf-drop-indicator\)$/)), `${sel} reads --nf-drop-indicator`);
  }
  assert.deepEqual(
    rulesWith(/^\.nf-drag-ghost$/).filter((r) => hasDecl(r, /^opacity:/)).flatMap((r) => r.selectors),
    [],
    "the drag ghost is opaque (element opacity let the text under it show)",
  );
}

/* A declaration's value, and a small evaluator for the px geometry the
   edit-row rules compute: var() resolves from `vars` (else its fallback),
   em is 16px, and calc/min/max are plain arithmetic. Enough to replay the
   row shapes main.ts emits against the stylesheet's formulas. */
const declValue = (rule, prop) => {
  const d = rule.decls.find((x) => x.startsWith(`${prop}:`));
  return d ? d.slice(prop.length + 1).replace(/\s*!important$/, "").trim() : null;
};
function calcPx(expr, vars) {
  const sub = (s) => {
    let out = "";
    for (let i = 0; i < s.length; ) {
      if (!s.startsWith("var(", i)) { out += s[i++]; continue; }
      let depth = 1, j = i + 4, comma = -1;
      for (; j < s.length && depth; j++) {
        if (s[j] === "(") depth++;
        else if (s[j] === ")") depth--;
        else if (s[j] === "," && depth === 1 && comma < 0) comma = j;
      }
      const inner = s.slice(i + 4, j - 1);
      const name = (comma < 0 ? inner : s.slice(i + 4, comma)).trim();
      if (name in vars) out += `(${vars[name]})`;
      else if (comma >= 0) out += `(${sub(s.slice(comma + 1, j - 1))})`;
      else throw new Error(`calcPx: ${name} has no value and no fallback`);
      i = j;
    }
    return out;
  };
  const js = sub(expr)
    .replace(/\bcalc\(/g, "(")
    .replace(/\bmax\(/g, "Math.max(")
    .replace(/\bmin\(/g, "Math.min(")
    .replace(/(\d*\.?\d+)px\b/g, "$1")
    .replace(/(\d*\.?\d+)em\b/g, "($1*16)");
  assert.ok(/^(?:[\d\s.+\-*/(),]|Math\.max|Math\.min)*$/.test(js), `calcPx: cannot evaluate ${js}`);
  return Math.round(Function(`return (${js});`)() * 10) / 10;
}

/* lp-reading-parity: inline-code ink reaches every rendered surface; the
   to-do pair is the one measured off Obsidian 1.13.7; one quote level
   costs --nf-quote-inset in every surface (no quote-depth 0.7em left);
   quoted code is a real card; a folded quoted block keeps its quote bar. */
{
  assert.ok(
    rulesWith(/^body\.nf-code-color \.markdown-rendered :not\(pre\) > code$/).some((r) => hasDecl(r, /^color: var\(--nf-inline-code\)$/)),
    "inline-code ink follows the setting in every rendered surface (.markdown-rendered), not only Reading view",
  );
  assert.deepEqual(rulesWith("nf-code-color .markdown-reading-view :not(pre) > code").flatMap((r) => r.selectors), [], "the inline-code ink is not scoped to Reading view");
  const clean = rulesWith(/^body\.nf-clean$/);
  assert.ok(clean.some((r) => hasDecl(r, /^--nf-list-check: calc\(var\(--font-text-size, 16px\) \* 0\.46\)$/)), "the to-do checkbox sits at the measured 0.46 of the text size");
  assert.ok(clean.some((r) => hasDecl(r, /^--nf-list-task-col: calc\(var\(--font-text-size, 16px\) \* 1\.8\)$/)), "the to-do text column is the measured 1.8 of the text size");
  assert.ok(clean.some((r) => hasDecl(r, /^--nf-quote-inset: 16px$/)), "body.nf-clean defines the shared quote inset (16px)");
  const depth07 = css.match(/depth[^;{}]*\*\s*0\.7em|0\.7em\s*\*\s*var\(--nf-prefix-depth/g) || [];
  assert.deepEqual(depth07, [], "no quote level is still charged a literal 0.7em (use var(--nf-quote-inset, 0.7em))");
  const prefix = rulesWith(/\.is-live-preview \.nf-quote-prefix$/);
  assert.ok(prefix.some((r) => /--nf-quote-inset/.test(declValue(r, "width") || "")), "the quote-marker gap spends --nf-quote-inset per level");
  assert.ok(rules.some((r) => /--nf-quote-inset/.test(declValue(r, "--nf-co-quote-step") || "")), "a quote inside a Callout steps by --nf-quote-inset");
  const rendered = rulesWith(/^body\.nf-clean \.markdown-rendered blockquote$/);
  assert.ok(rendered.some((r) => /--nf-quote-inset/.test(declValue(r, "padding-inline") || "")), "every rendered blockquote is inset by --nf-quote-inset");
  assert.deepEqual(
    rulesWith(/blockquote$/).filter((r) => hasDecl(r, /^padding-inline: var\(--size-4-6\)/)).flatMap((r) => r.selectors),
    [],
    "no blockquote keeps the old --size-4-6 inset (Reading sat 15px right of Live Preview)",
  );
  assert.deepEqual(
    rulesWith(/nf-lk-q-pull .*blockquote::before$/).filter((r) => (declValue(r, "inset-inline-end") || "").includes("--size-4-6")).flatMap((r) => r.selectors),
    [],
    "the pull-quote glyph ends on the shared quote column",
  );
  const folded = rulesWith(/\.cm-line\.HyperMD-quote\.nf-caption-line-collapsed::before$/);
  assert.ok(folded.some((r) => hasDecl(r, /^border-inline-start: /) && hasDecl(r, /^background: none$/)), "a folded quoted code row keeps its quote bar (no card on ::before)");
  assert.ok(rulesWith(/\.nf-qcode:not\(\.nf-co-code\):not\(\.nf-nested-block\) \.nf-quote-prefix$/).some((r) => hasDecl(r, /^width: var\(--nf-code-hang\)$/)), "quoted code text sits one code padding inside its card");
  assert.ok(rulesWith(/\.nf-qcode:not\(\.nf-co-code\):not\(\.nf-nested-block\)::after$/).some((r) => hasDecl(r, /^inset-inline-start: var\(--nf-qcode-card\)$/)), "a quoted code card starts on the quote's text column");
  const qcodeHang = rulesWith(/^body\.nf-clean \.markdown-source-view\.is-live-preview \.cm-line\.nf-qcode$/).find((r) => declValue(r, "--nf-qcode-card"));
  assert.ok(qcodeHang, "the quoted code card column is declared on .cm-line.nf-qcode");
  const card = calcPx(declValue(qcodeHang, "--nf-qcode-card"), { "--nf-quote-inset": "16px", "--nf-prefix-depth": 1 });
  const hang = calcPx(declValue(qcodeHang, "--nf-code-hang").replace("var(--nf-qcode-card)", `${card}px`), {});
  assert.deepEqual([card, hang], [16, 32], "quoted code: card on the quote column (16px), text 16px inside it (Reading's <pre> padding)");
}

/* Toggle edit rows (review-css-1 / review-MB-5 / w1c-toggle-hang-rekey,
   review-css-2 / w1c-quote-in-toggle-bar, w1c-toggle-in-callout-bottom-edge):
   the hang and the quote bar read main.ts's toggle contract
   (--nf-co-toggle-boxes / --nf-co-toggle-depth on .nf-co-toggle-hang rows),
   so a wrapped row resumes on the column the gap widget sets. Replayed
   below with the counts main.ts writes for each shape. */
{
  const HANG = /\.cm-line\.nf-co-edit\.nf-co-toggle\.nf-co-toggle-hang$/;
  const hangRule = rulesWith(HANG).find((r) => declValue(r, "--nf-row-hang"));
  assert.ok(hangRule, "the toggle hang is keyed on .nf-co-toggle.nf-co-toggle-hang (0,8,1), above the generic .nf-co-hang rule");
  const expr = declValue(hangRule, "--nf-row-hang");
  assert.ok(/--nf-co-toggle-boxes/.test(expr) && /--nf-co-toggle-depth/.test(expr) && !/--nf-co-depth/.test(expr), "the toggle hang reads the toggle contract, not --nf-co-depth");
  assert.deepEqual(
    rules.filter((r) => r.selectors.some((s) => /\.nf-co-toggle\.nf-co-hang$/.test(s)) && declValue(r, "--nf-row-hang")).flatMap((r) => r.selectors),
    [],
    "the old --nf-co-depth toggle hang is gone",
  );
  assert.deepEqual(
    rulesWith(/\.cm-line\.nf-co-toggle(:not\(\.nf-co-first\)|\.nf-co-first) \.nf-callout-prefix/).flatMap((r) => r.selectors),
    [],
    "the dead toggle .nf-callout-prefix width rules are gone (toggle rows use .nf-toggle-prefix, width set inline)",
  );
  const T = 23.2, base = { "--nf-toggle-content-inset": `${T}px`, "--nf-co-inset": "39px", "--nf-co-quote-step": "16px", "--nf-quote-inset": "16px" };
  // gap widget (VisualStructureGapWidget, kind "toggle"): callouts*39 + toggles*T + inner*step
  const shapes = [
    ["top-level toggle body", { "--nf-co-toggle-boxes": 0, "--nf-co-toggle-depth": 1 }, T],
    ["toggle in a Callout", { "--nf-co-toggle-boxes": 1, "--nf-co-toggle-depth": 1 }, 39 + T],
    ["toggle in a toggle (was 62.2)", { "--nf-co-toggle-boxes": 0, "--nf-co-toggle-depth": 2 }, 2 * T],
    ["quote in the inner toggle", { "--nf-co-toggle-boxes": 0, "--nf-co-toggle-depth": 2, "--nf-co-quote-depth": 1 }, 2 * T + 16],
  ];
  for (const [name, vars, gap] of shapes) {
    assert.equal(calcPx(expr, { ...base, ...vars }), Math.round(gap * 10) / 10, `toggle hang = gap widget column: ${name}`);
  }
  const bar = rulesWith(/\.nf-co-edit\.nf-co-quote\.nf-co-toggle-hang:not\(\.nf-co-nested\)::before$/).find((r) => declValue(r, "inset-inline-start"));
  assert.ok(bar && hasDecl(bar, /!important$/), "a quote inside a toggle places its bar from the toggle contract (important, over the Callout bar rule)");
  const barX = (vars) => calcPx(declValue(bar, "inset-inline-start"), { ...base, "--nf-nest": "16px", ...vars });
  assert.equal(barX({ "--nf-co-toggle-boxes": 0, "--nf-co-toggle-depth": 1, "--nf-co-quote-depth": 1 }), T, "the quote bar in a toggle stands on the toggle's content column (was 39px)");
  assert.equal(barX({ "--nf-co-toggle-boxes": 1, "--nf-co-toggle-depth": 1, "--nf-co-quote-depth": 1 }), 39 + T, "the quote bar in a toggle in a Callout");
  assert.ok(
    rules.some((r) => r.selectors.some((s) => /:has\(\.cm-quote\) \+ \.cm-line\.nf-co-edit\.nf-co-quote$/.test(s)) && hasDecl(r, /^--nf-co-gap-top: var\(--p-spacing, 1rem\)$/)),
    "a quote after a paragraph in a Callout/toggle keeps the rendered blockquote's top margin",
  );
  const top = rulesWith(/\.cm-line\.nf-co-nested\.nf-co-first\.nf-co-toggle-hang$/).find((r) => declValue(r, "--nf-co-nested-gap-top"));
  assert.ok(top, "a nested toggle's top gap is decided from the toggle contract");
  assert.equal(calcPx(declValue(top, "--nf-co-nested-gap-top"), { "--nf-co-toggle-boxes": 0 }), 0, "a toggle straight inside a toggle opens with no box margin (it opened 12px low)");
  assert.equal(calcPx(declValue(top, "--nf-co-nested-gap-top"), { "--nf-co-toggle-boxes": 1 }), 12, "a toggle inside a Callout keeps the 0.75em box margin");
  const edge = rulesWith(/\.cm-line\.nf-co-edit\.nf-co-toggle\.nf-co-nested\.nf-co-last:not\(:has\(\+ \.cm-line:is\(\.nf-co-edit, \.nf-co-code\)\)\)::before$/);
  assert.ok(edge.some((r) => hasDecl(r, /^border-block-end: /) && hasDecl(r, /^border-end-start-radius: /)), "a toggle's last row closes the Callout around it (bottom edge and corners)");
  assert.ok(rulesWith(/\.cm-line\.nf-co-edit\.nf-co-toggle::after$/).some((r) => hasDecl(r, /^content: none$/)), "a toggle still paints no card of its own");
}

/* review-css-3 / review-css-4: bottom air is counted in BOXES (a rendered
   toggle has none), and a nested Callout's card ends above its parents'
   air while the parent layer closes with its own edge. */
{
  const LAST = ".cm-line.nf-co-edit.nf-co-nested.nf-co-last";
  const TAIL = ":not(:has(+ .cm-line:is(.nf-co-edit, .nf-co-code)))";
  const box = rules.find((r) => r.selectors.some((s) => s.endsWith(`${LAST}:not(.nf-co-toggle)${TAIL}`)) && declValue(r, "--nf-co-air-bottom"));
  const tog = rules.find((r) => r.selectors.some((s) => s.endsWith(`${LAST}.nf-co-toggle${TAIL}`)) && declValue(r, "--nf-co-air-bottom"));
  assert.ok(box && tog, "both nested last-row air rules exist");
  const air = (r, vars) => calcPx(declValue(r, "--nf-co-air-bottom"), { "--nf-co-bottom": "13px", ...vars });
  assert.equal(air(tog, { "--nf-co-depth": 2, "--nf-co-toggle-boxes": 0 }), 0, "a toggle inside a toggle adds no Callout air (was 13px)");
  assert.equal(air(tog, { "--nf-co-depth": 2, "--nf-co-toggle-boxes": 1 }), 13, "a toggle inside a Callout still closes the Callout's air");
  assert.equal(air(tog, { "--nf-co-depth": 2 }), 13, "without the toggle counts (list rows) a toggle keeps today's air");
  assert.equal(air(box, { "--nf-co-depth": 2 }), 26, "a Callout inside a Callout closes both boxes");
  assert.equal(air(box, { "--nf-co-depth": 2, "--nf-co-boxes": 1 }), 13, "once main.ts publishes --nf-co-boxes, a Callout inside a toggle gets its own air only");
  const after = rules.find((r) => r.selectors.some((s) => s.endsWith(`${LAST}:not(.nf-co-toggle)${TAIL}::after`)) && declValue(r, "inset-block-end"));
  assert.ok(after, "the inner card's bottom is set on the closing row");
  assert.equal(
    calcPx(declValue(after, "inset-block-end"), { "--nf-co-depth": 2, "--nf-co-bottom": "13px", "--nf-co-nested-gap-bottom": "0.15em" }),
    15.4,
    "the inner card ends above the parent's 13px of air (it used to stretch over it)",
  );
  assert.ok(
    rules.some((r) => r.selectors.some((s) => s.endsWith(`${LAST}:not(.nf-co-toggle)${TAIL}::before`)) && hasDecl(r, /^border-block-end: /)),
    "the parent layer closes with its own bottom edge",
  );
}

/* w1c-list-code-card-align: a list item's code card starts on the item's
   text column (as Reading's <pre> does). The shift is a text-indent against
   the measured hang, never padding off --nf-nest: syncLineLayers measures
   the text into --nf-nest, so padding from it would grow on every pass. */
{
  const lc = rulesWith(/\.cm-line\.nf-nested-block\.HyperMD-codeblock:not\(\.nf-qcode\)$/);
  const ti = lc.map((r) => declValue(r, "text-indent")).find(Boolean) || "";
  assert.ok(/--nf-list-col/.test(ti) && /var\(--nf-fence-lead, 2ch\)/.test(ti) && /- var\(--nf-row-hang/.test(ti), "list code rows shift onto the item's text column by text-indent");
  assert.deepEqual(lc.filter((r) => /--nf-nest/.test(declValue(r, "padding-inline-start") || "")).flatMap((r) => r.selectors), [], "no list-code padding is derived from the measured --nf-nest (feedback loop)");
}

/* code-theme-light-chrome: under One Dark / Dracula / Nord the chip, fold
   arrow, copy button, folded chips, caret and selection take the card's
   own ink (a light page's ink vanished on the dark card); every other
   theme leaves the tokens undefined and falls back to today's inks. */
{
  const chip = rules.filter((r) => r.selectors.some((s) => /\.is-live-preview \.nf-visual-code-fence span$/.test(s)) && r.decls.some((d) => /^color: .*!important$/.test(d)));
  assert.ok(chip.length > 0 && chip.every((r) => /var\(--nf-code-chrome, var\(--text-muted\)\)/.test(declValue(r, "color"))), "the never-faded chip rule reads --nf-code-chrome (fallback --text-muted), still !important");
  assert.ok(
    rules.some((r) => r.selectors.some((s) => /\.cm-line:is\(\.HyperMD-codeblock, \.nf-qcode\)$/.test(s)) && hasDecl(r, /^caret-color: var\(--code-normal\)$/)),
    "code rows under a fixed-dark code theme draw the caret in the card's ink",
  );
  assert.ok(
    rules.some((r) => r.selectors.some((s) => /\.cm-line:is\(\.HyperMD-codeblock, \.nf-qcode\)::selection$/.test(s)) && hasDecl(r, /^background-color: var\(--nf-code-selection\)$/)),
    "code rows under a fixed-dark code theme select with the card's ink wash",
  );
  const tokenRule = rules.find((r) => declValue(r, "--nf-code-chrome"));
  assert.ok(tokenRule && ["one-dark", "dracula", "nord"].every((id) => tokenRule.selectors.some((s) => s.includes(`.nf-code-theme-${id}`))), "the chrome tokens are defined for exactly the fixed-dark themes");
  assert.ok(!tokenRule.selectors.some((s) => /nf-code-theme-(github|obsidian|catppuccin|solarized)/.test(s)), "themes with a light card keep the page's chrome inks");
  for (const [re, name] of [
    [/\.is-live-preview \.nf-visual-code-fence$/, "chip"],
    [/button\.nf-rendered-code-fold$/, "fold arrow"],
    [/\.nf-block-caption\.is-code-collapsed$/, "folded chip"],
    [/\.cm-line\.nf-caption-line-collapsed$/, "folded caption row"],
  ]) {
    assert.ok(rulesWith(re).some((r) => /^var\(--nf-code-chrome, var\(--text-(muted|faint)\)\)$/.test(declValue(r, "color") || "")), `${name} ink reads --nf-code-chrome with today's fallback`);
  }
  assert.ok(
    rulesWith(/\.nf-block-caption\.is-code-collapsed$/).some((r) => /var\(--nf-code-chrome-border, var\(--background-modifier-border\)\)/.test(declValue(r, "border") || "")),
    "a folded chip's frame follows the card under a fixed-dark code theme (the page border read as a white ring)",
  );
  for (const re of [/button\.nf-visual-code-language:hover$/, /button\.nf-rendered-code-fold:hover$/, /\.nf-code-copy:hover$/]) {
    const hov = rulesWith(re);
    assert.ok(hov.some((r) => /--nf-code-chrome-hover, var\(--text-normal\)/.test(declValue(r, "color") || "") && /--nf-code-chrome-hover-bg, var\(--background-modifier-hover\)/.test(declValue(r, "background") || "")), `hover reads the chrome hover tokens: ${re}`);
  }
}

/* w1c-code-theme-default-rule: an explicit "Theme default" code theme has
   a rule of its own (so NOTE_STYLE_CLASSES may list it), and the palette's
   code colours step aside for any nf-code-theme-* class, this one included. */
{
  assert.ok(rulesWith(/^body\.nf-code-theme-default /).length > 0, "body.nf-code-theme-default has a rule");
  // The notes' code colours (the Settings gallery's samples are not notes).
  const paletteCode = rules.filter((r) => hasDecl(r, /^--code-background: /) && r.selectors.some((s) => s.startsWith("body.nf-palette") && /markdown-(source|reading)-view/.test(s)));
  assert.ok(paletteCode.length > 0, "the palette sets code colours");
  for (const r of paletteCode) {
    for (const s of r.selectors) assert.ok(s.includes(':not([class*="nf-code-theme-"])'), `palette code colours step aside for an explicit code theme: ${s}`);
  }
}

/* canvas-dark-tints-and-panels: tint strengths are tokens with livelier
   dark values; coloured pastel topics in the dark mix toward a dark tone
   of their own hue; vivid and gradient topics pick dark ink on luminous
   fills; snap guides, Canvas's card menu and the live map step aside for
   a map drag, an open marker/colour panel and a layout preview. */
{
  const TINTS = { "--nf-tint-root": "14%", "--nf-tint-branch": "8%", "--nf-tint-card-root": "10%", "--nf-tint-card": "5%" };
  const base = rulesWith(/^\.canvas-wrapper\.nf-canvas-polished \.canvas-node\.nf-canvas-map-text$/);
  const dark = rulesWith(/^\.theme-dark \.canvas-wrapper\.nf-canvas-polished \.canvas-node\.nf-canvas-map-text$/);
  for (const [token, light] of Object.entries(TINTS)) {
    assert.ok(base.some((r) => declValue(r, token) === light), `${token} defaults to today's light share (${light}), so light maps do not move`);
    const d = dark.map((r) => declValue(r, token)).find(Boolean);
    assert.ok(d && parseFloat(d) > parseFloat(light), `${token} is raised on a dark canvas (got ${d})`);
  }
  const literal = rules.filter((r) => r.selectors.some((s) => /nf-theme-(clean|cards)/.test(s)) && /var\(--nf-topic\) (14|8|10|5)%, var\(--(nf-ground|background-primary)\)/.test(r.body));
  assert.deepEqual(literal.flatMap((r) => r.selectors), [], "no clean/cards tint still hard-codes its share (use the --nf-tint-* tokens)");
  const pastel = rules.filter((r) => r.selectors.some((s) => s.startsWith(".theme-dark ") && s.includes(".nf-theme-pastel") && s.includes(":is(.is-themed, .nf-canvas-auto-color)") && s.endsWith(".canvas-node-container")));
  assert.ok(pastel.some((r) => /oklch\(from var\(--nf-topic\) 0\.34 /.test(declValue(r, "background-color") || "")), "dark coloured pastel topics mix toward a dark tone of their own hue");
  for (const r of pastel) for (const s of r.selectors) {
    for (const keep of [".nf-shape-underline", ".nf-canvas-summary", ".nf-canvas-map-empty"]) assert.ok(s.includes(keep), `the dark pastel ground leaves ${keep} cards their own ground: ${s}`);
  }
  const supports = [...css.matchAll(/@supports \(color: oklch\(from red clamp\([^{]*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("\n");
  const vivid = /nf-theme-vivid:is\(\.nf-canvas-map-root, \.nf-canvas-map-branch\)\.nf-canvas-map-text \{\s*--nf-ink: oklch\(from var\(--nf-fill\) clamp\(0\.2, \((0\.\d+) - l\)/.exec(supports);
  assert.ok(vivid && Number(vivid[1]) <= 0.64, `vivid topics turn to dark ink on luminous fills (threshold ${vivid && vivid[1]}, needs <= 0.64)`);
  assert.ok(/nf-theme-gradient:is\(\.nf-canvas-map-root, \.nf-canvas-map-branch\)\.nf-canvas-map-text \{\s*--nf-ink: oklch\(from var\(--nf-topic\) clamp\(/.test(supports), "gradient topics get the same auto-ink (inside @supports)");
  assert.ok(rulesWith(/^\.canvas-wrapper\.nf-canvas-map-drag \.canvas-snaps$/).some((r) => hasDecl(r, /^display: none$/)), "no snap guides while a map card is dragged");
  assert.ok(rulesWith(/^\.canvas-wrapper:has\(> \.nf-canvas-marker-panel\) \.canvas-menu-container$/).some((r) => hasDecl(r, /^visibility: hidden$/)), "Canvas's card menu stays behind an open marker/colour panel");
  assert.ok(rulesWith(/^\.canvas-wrapper\.nf-canvas-previewing \.canvas-menu-container$/).some((r) => hasDecl(r, /^visibility: hidden$/)), "Canvas's card menu steps aside during a layout preview");
  // (R2-W3-CSS review2-css-w2-4: cards that keep their place are exempt.)
  const fade = rulesWith(/^\.canvas-wrapper\.nf-canvas-previewing /).find((r) => r.selectors.includes(".canvas-wrapper.nf-canvas-previewing .canvas .canvas-node:not(.nf-canvas-preview-still)"));
  assert.ok(fade && hasDecl(fade, /^opacity: 0\.3$/) && fade.selectors.some((s) => s.endsWith("svg.canvas-edges > g:not(.nf-canvas-ghosts)")), "a layout preview fades the live map (cards and lines, not the ghosts)");
  assert.ok(rulesWith(/^\.canvas-wrapper\.nf-canvas-previewing \.nf-canvas-ghosts rect$/).some((r) => hasDecl(r, /^opacity: 0\.9$/)), "the ghosts come up while previewing");
  const label = rulesWith(/\.nf-canvas-ghosts text\.nf-canvas-ghost-label$/);
  assert.ok(label.some((r) => hasDecl(r, /^text-anchor: middle$/) && hasDecl(r, /^paint-order: stroke$/) && hasDecl(r, /^pointer-events: none$/)), "ghost labels are centred, haloed and click-through");
  assert.ok(!rules.some((r) => r.selectors.some((s) => s.includes("nf-canvas-previewing")) && hasDecl(r, /^transition/)), "the preview fade is instant (nothing for the reduced-motion list)");
}

/* w1c-match-tile + the style panel's wave-2 parts: the match tile spans the
   panel with its name beside the miniature; its sub-line is a line of its
   own; a saved tile's delete button sits in its corner; sections fold with
   a turning chevron. */
{
  assert.ok(rulesWith(/\.nf-canvas-style-tiles\.nf-canvas-style-match$/).some((r) => hasDecl(r, /^grid-template-columns: minmax\(0, 1fr\)$/)), "the match tile's grid is one full-width column");
  const matchName = rulesWith(/button\.nf-canvas-style-tile-match > \.nf-canvas-style-tile-name$/);
  assert.ok(matchName.some((r) => hasDecl(r, /^white-space: normal$/) && hasDecl(r, /^min-width: 0$/)), "the match tile's name wraps inside the tile (Obsidian buttons are nowrap)");
  assert.ok(rulesWith(/\.nf-canvas-style-tile-sub$/).some((r) => hasDecl(r, /^display: block$/)), "the match tile's sub-line is its own line");
  const del = rulesWith(/button\.nf-canvas-style-tile-delete$/);
  assert.ok(del.some((r) => hasDecl(r, /^position: absolute$/) && hasDecl(r, /^opacity: 0$/)), "a saved tile's delete button sits in its corner, hidden at rest");
  assert.ok(rulesWith(/\.nf-canvas-style-tile-wrap:is\(:hover, :focus-within\) \.nf-canvas-style-tile-delete$/).some((r) => hasDecl(r, /^opacity: 1$/)), "the delete button shows on hover and keyboard focus");
  assert.ok(rulesWith(/\.nf-canvas-style-tile-wrap$/).some((r) => hasDecl(r, /^position: relative$/)), "the tile wrap anchors the delete button");
  assert.ok(rulesWith(/\.nf-canvas-style-section-toggle\[aria-expanded="false"\] svg$/).some((r) => hasDecl(r, /^rotate: -90deg$/)), "a folded section's chevron points sideways");
  assert.ok(rulesWith(/\.nf-canvas-style-scheme-form$/).some((r) => hasDecl(r, /^display: flex$/)), "the scheme name field and its buttons share one row");
}

/* w1c-toggle-row-end-padding, w1c-chord-grid-kbd-width and the wave-2
   CSS requests (STYLEUI, MAIN, SURFMOD). */
{
  const END = /\.cm-line\.nf-co-edit\.nf-co-toggle$/;
  const togEnd = rulesWith(END).find((r) => declValue(r, "padding-inline-end"));
  assert.ok(togEnd, "toggle edit rows set their own end padding");
  const endPx = (vars) => calcPx(declValue(togEnd, "padding-inline-end"), { "--nf-co-code-end": "15px", ...vars });
  assert.equal(endPx({ "--nf-co-toggle-boxes": 0, "--nf-co-depth": 1 }), 0, "a top-level toggle row has no end padding (the rendered toggle has none; it had 15px)");
  assert.equal(endPx({ "--nf-co-toggle-boxes": 1, "--nf-co-depth": 2 }), 15, "a toggle in a Callout keeps the Callout's 15px");
  assert.equal(endPx({ "--nf-co-depth": 1 }), 0, "without the toggle count a top-level toggle still gets none");
  const kbd = rulesWith(/\.nf-chord-grid > \* > kbd$/);
  assert.ok(kbd.some((r) => hasDecl(r, /^min-width: 5em$/) && hasDecl(r, /^box-sizing: border-box$/)), "chord chips share one width so their labels line up");
  // (R2-W3-CSS: every heading now opens its own SettingGroup card, so the
  // 26px :not(:first-child) heading rhythm matched nothing and was dropped.)
  assert.ok(rulesWith(/\.setting-item-heading(:first-child)?$/).every((r) => !r.selectors.some((s) => s.includes(":not(:first-child)"))), "no :not(:first-child) heading margin (the group cards give the rhythm)");
  assert.ok(rulesWith(/^\.nf-style-hint$/).some((r) => hasDecl(r, /^display: flex$/)), "the style suggestion hint is styled");
  assert.ok(rulesWith(/\[aria-checked="true"\] \.nf-look-thumb\[data-look="editorial"\] \.t-kicker$/).some((r) => hasDecl(r, /^right: 34px$/)), "a checked Editorial card moves its kicker clear of the badge");
  for (const cls of ["nf-setting-dot", "nf-settings-preview", "nf-code-sample", "nf-code-badge", "nf-sw-group-header", "nf-sw-dots"]) {
    assert.ok(rules.some((r) => r.selectors.some((s) => s.includes(`.${cls}`))), `${cls} (STYLEUI) is styled`);
  }
  assert.ok(rulesWith(/^body\.nf-palette \.markdown-source-view \.cm-content$/).some((r) => hasDecl(r, /^color: var\(--text-normal\)$/)), "Live Preview text takes the palette ink (color was inherited from <body>)");
  assert.ok(rulesWith(/^\.nf-page-header$/).some((r) => hasDecl(r, /^display: flow-root$/)), "the page header is a flow-root (its cover's negative margin never collapses through)");
  assert.ok(rulesWith(/^\.nf-page-header:not\(\.has-cover\):not\(\.has-icon\) \.nf-page-controls$/).some((r) => hasDecl(r, /^position: absolute$/)), "a note without icon or cover does not shift down");
  assert.ok(rulesWith(/^\.nf-icon-picker$/).some((r) => hasDecl(r, /^position: fixed$/)), "the icon picker is positioned by CSS (the script sets only left/top)");
  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{[^{}]*\.nf-link-pop\[data-placement="below"\],([^{}]*)\{\s*animation: none;/);
  assert.ok(reduced && reduced[1].includes(".nf-icon-picker[data-placement=\"below\"]"), "the icon picker opens without motion under reduced motion");
  for (const cls of ["nf-serif", "nf-kai", "nf-mono", "nf-small", "nf-wide"]) {
    assert.ok(rules.some((r) => r.selectors.some((s) => s.includes(`.markdown-preview-view.${cls}`))), `page style ${cls} is styled in both views`);
  }
}

/* ---- R2-W3-CSS ---- */
let w3Checks = 0, w3Modules = 0, w3Allowed = 0;
const w3 = (ok, message) => { w3Checks++; assert.ok(ok, message); };

/* review2-css-w2-2: an -rgb triplet only works when something defines it.
   Obsidian 1.13.7's app.css defines exactly these (no
   --interactive-accent-rgb, so the icon picker's current cell was
   transparent); the plugin's own --nf-*-rgb are declared in this sheet. */
{
  const OBSIDIAN_RGB = new Set([
    "--color-red-rgb", "--color-orange-rgb", "--color-yellow-rgb", "--color-green-rgb", "--color-cyan-rgb",
    "--color-blue-rgb", "--color-purple-rgb", "--color-pink-rgb",
    "--background-modifier-error-rgb", "--background-modifier-success-rgb", "--text-highlight-bg-rgb",
    "--mono-rgb-0", "--mono-rgb-100",
  ]);
  const declared = new Set([...css.matchAll(/(--nf-[\w-]*-rgb)\s*:/g)].map((m) => m[1]));
  const read = new Set([...css.matchAll(/var\((--[\w-]*-rgb(?:-\d+)?)\b/g)].map((m) => m[1]));
  const undefinedRgb = [...read].filter((name) => (name.startsWith("--nf-") ? !declared.has(name) : !OBSIDIAN_RGB.has(name)));
  w3(undefinedRgb.length === 0, `-rgb triplets nothing defines (the declaration is invalid and paints nothing): ${undefinedRgb.join(", ")}`);
  w3(!/rgba?\(\s*var\(--[\w-]+-rgb\)\s*\//.test(css), "rgb(var(--x-rgb) / a) is invalid: the triplets are comma-separated, use rgba(var(--x-rgb), a)");
  const active = rulesWith(/\.nf-icon-picker button\.nf-icon-picker-cell\.is-active$/);
  w3(active.some((r) => /var\(--interactive-accent\)/.test(declValue(r, "background") || declValue(r, "background-color") || "")), "the icon picker's current cell is tinted from --interactive-accent");
}

/* review2-css-w2-3 / review2-styleui-5: the 'Theme default' code card shows
   what picking it does. While the style module emits no
   nf-code-theme-default, "default" under a palette keeps the palette's code
   colours, so the card maps it like "auto"; once the class is emitted (the
   approved opt-out), the palette steps aside and the card must not map it. */
{
  const presets = resolve(root, "src/features/style-presets.ts");
  const gallery = rules.filter((r) => hasDecl(r, /^--code-background: var\(--nf-style-code-bg\)$/) && r.selectors.some((s) => s.includes(".nf-code-sample")));
  w3(gallery.length > 0 && gallery.every((r) => r.selectors.every((s) => s.startsWith("body.nf-palette "))), "the code gallery maps palette code colours only under a palette");
  w3(gallery.some((r) => r.selectors.some((s) => s.includes('[data-code-theme="auto"]'))), "the Follow palette card shows the palette's code colours");
  const mapsDefault = gallery.some((r) => r.selectors.some((s) => s.includes('[data-code-theme="default"]')));
  if (existsSync(presets)) {
    const src = readFileSync(presets, "utf8");
    const at = src.indexOf("export const NOTE_STYLE_CLASSES");
    const list = at < 0 ? "" : src.slice(at, src.indexOf("];", at));
    const emits = list.includes('"nf-code-theme-default"') || (list.includes("CODE_THEME_IDS") && !/!==\s*"default"/.test(list));
    w3(
      mapsDefault === !emits,
      emits
        ? 'style-presets.ts now emits nf-code-theme-default: drop [data-code-theme="default"] from the body.nf-palette .nf-code-sample rule (the card would show palette colours the notes no longer use)'
        : 'style-presets.ts emits no nf-code-theme-default yet: "Theme default" under a palette keeps the palette code colours, so its card must map them too',
    );
  } else console.log("SKIP (no src/features/style-presets.ts): code-card default mapping cross-check");
}

/* review2-css-w2-4: a layout preview fades the live map but not the cards
   that keep their place (no ghost marks them). */
{
  const fades = rules.filter((r) => hasDecl(r, /^opacity: 0\.3$/) && r.selectors.some((s) => s.includes("nf-canvas-previewing")));
  const cardSelectors = fades.flatMap((r) => r.selectors).filter((s) => /\.canvas-node\b/.test(s));
  w3(cardSelectors.length > 0 && cardSelectors.every((s) => s.endsWith(".canvas-node:not(.nf-canvas-preview-still)")), `the preview fade exempts cards that stay put: ${cardSelectors.join(" | ")}`);
  const enh = resolve(root, "src/canvas/enhancements.ts");
  if (existsSync(enh) && !readFileSync(enh, "utf8").includes("nf-canvas-preview-still")) {
    console.log("NOTE (pending R2-W3-CANVAS): drawLayoutPreview does not set nf-canvas-preview-still yet, so the root still fades");
  }
}

/* review2-css-w2-5: every read of the fixed-dark chrome tokens has a
   fallback or sits under the note views that define them (canvas cards and
   hover previews match .markdown-rendered but never get the tokens). */
{
  const bare = /var\(--nf-code-(chrome|selection)[\w-]*\)/;
  const unscoped = rules
    .filter((r) => r.decls.some((d) => bare.test(d) && !/^--nf-code-/.test(d)))
    .flatMap((r) => r.selectors)
    .filter((s) => !/\.markdown-(source|reading)-view/.test(s));
  w3(unscoped.length === 0, `--nf-code-chrome* read without a fallback outside the note views: ${unscoped.join(" | ")}`);
  const copy = rulesWith(/button\.copy-code-button(:hover)?$/).filter((r) => r.selectors.some((s) => s.includes("nf-code-theme-")));
  w3(copy.length >= 2, "the fixed-dark copy-button rules exist");
}

/* review2-css-w2-6 / R2-W3-MODFIX-B styleui-6: Settings' "Inline code
   colour: Theme default" dot paints var(--code-normal); every list that
   gives notes a --code-normal names the dot too, as its own selector (in the
   :is() it would raise the notes' specificity). */
{
  const DOT = '.nf-setting-dot[data-key="inlineCodeColor"]';
  let lists = 0;
  for (const r of rules.filter((x) => hasDecl(x, /^--code-normal: /))) {
    for (const s of r.selectors) {
      const m = /^(body(?:\.theme-dark)?\.nf-code-theme-[a-z-]+) \.markdown-reading-view$/.exec(s);
      if (!m) continue;
      lists++;
      w3(r.selectors.includes(`${m[1]} ${DOT}`), `${m[1]}: the inline-code dot takes the theme's --code-normal`);
    }
  }
  w3(lists >= 16, `every code-theme list was checked (${lists}; 10 light + 6 dark)`);
  const palette = rules.filter((r) => hasDecl(r, /^--code-normal: var\(--nf-style-code-normal\)$/) && r.selectors.some((s) => /markdown-(source|reading)-view/.test(s)));
  w3(palette.length > 0 && palette.every((r) => r.selectors.includes(`body.nf-palette:not([class*="nf-code-theme-"]) ${DOT}`)), "under a palette (Follow palette) the dot takes the palette's code ink");
  w3(!rules.some((r) => r.selectors.some((s) => s.includes(":is(") && s.includes("markdown-reading-view") && s.includes(".nf-setting-dot"))), "the dot never joins the notes' :is() (it would raise their specificity)");
  const preview = resolve(root, "src/ui/settings-preview.ts");
  if (existsSync(preview)) {
    const src = readFileSync(preview, "utf8");
    const at = src.indexOf("const DEFAULT_DOT");
    w3(at >= 0 && /inlineCodeColor: "var\(--code-normal\)"/.test(src.slice(at, src.indexOf("};", at))), "settings-preview.ts paints the Theme default inline-code dot with var(--code-normal)");
    w3(/"data-key"|dataset\.key|data-key/.test(src), "colorDot marks the dot with data-key");
  } else console.log("SKIP (no src/ui/settings-preview.ts): inline-code dot cross-check");
}

/* review2-styleui-1: the Classic palette card shows Classic under any body
   palette: it resets every page token the mini previews read, and each read
   has a fallback (today's Classic value) for `initial` to fall to. */
{
  const classic = rules.find((r) => r.selectors.length === 1 && r.selectors[0] === '.nf-palette-preview[data-palette="classic"]');
  w3(classic, "the Classic preview token block exists");
  const reads = new Map();
  for (const r of rules.filter((x) => x.selectors.some((s) => /\.nf-(mini|look-thumb)\b/.test(s)))) {
    for (const m of r.body.matchAll(/var\((--nf-style-[\w-]+)(,?)/g)) reads.set(m[1], (reads.get(m[1]) ?? true) && m[2] === ",");
  }
  w3(reads.size >= 10, `the mini previews' page tokens were found (${reads.size})`);
  for (const [token, fallback] of reads) {
    w3(declValue(classic, token) === "initial", `the Classic card resets ${token} (else it shows the body palette's)`);
    w3(fallback, `every mini-preview read of ${token} has a Classic fallback`);
  }
}

/* review2-styleui-7: the switcher's saved check beats Obsidian's (0,3,0)
   .suggestion-item.mod-complex .suggestion-flair (muted, --icon-opacity). */
{
  const flair = rulesWith(/^\.nf-sw-row\.suggestion-item\.mod-complex \.suggestion-flair$/);
  w3(flair.some((r) => hasDecl(r, /^color: var\(--interactive-accent\)$/) && hasDecl(r, /^opacity: 1$/)), "the saved row's check is accent-coloured at full opacity");
  w3(rulesWith(/^\.nf-sw-row \.suggestion-flair$/).length === 0, "no (0,2,0) flair rule that Obsidian's outranks");
}

/* block-colour-and-callout-icons-css (U1.4): a block background is one
   opaque tint per hue, painted on every Live Preview line of the block and
   on the owning Reading-view p / li / blockquote. It never changes a box's
   size (no reflow), never lands on a heading or a Callout edit row (those
   are tinted inside their Callout card, fixcss-main-css-requests-rest), and
   the rejected single-line prototype (.cm-line:has(span.nf-blk-…)) stays
   gone. */
const HUES9 = ["gray", "red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"];
{
  for (const hue of HUES9) {
    const decl = new RegExp(`^--nf-blk-rgb: var\\(--nf-${hue}-rgb\\)$`);
    w3(rules.some((r) => r.selectors.includes(`.nf-blk-${hue}`) && hasDecl(r, decl)), `Live Preview lines of a ${hue} block take the ${hue} wash source`);
    w3(rules.some((r) => r.selectors.some((s) => s.startsWith(".markdown-rendered ") && s.includes(`:has(> span.nf-blk-${hue})`) && s.includes(`:has(> p:first-of-type > span.nf-blk-${hue})`)) && hasDecl(r, decl)), `Reading view: a ${hue} marker tints its p / li / blockquote (a loose item's paragraph included)`);
  }
  const lp = rules.filter((r) => r.selectors.some((s) => s.includes(".cm-line.nf-blk-bg")));
  w3(lp.length >= 3, "the Live Preview block-tint rules exist");
  for (const r of lp) {
    for (const s of r.selectors) w3(s.includes(":not(.nf-co-edit)") && s.includes(":not(.HyperMD-header)"), `a Live Preview block tint skips Callout edit rows and headings: ${s}`);
    w3(!r.decls.some((d) => /^(margin|padding|height|min-height|max-height)\b/.test(d)), `a Live Preview block tint never changes a row's size: ${r.selectors.join(", ")}`);
  }
  const TINT = /^--nf-blk-tint: color-mix\(in srgb, rgb\(var\(--nf-blk-rgb\)\) calc\(var\(--nf-a-blk\) \* 100%\), var\(--background-primary\)\)$/;
  w3(lp.some((r) => hasDecl(r, TINT) && hasDecl(r, /^background-color: var\(--nf-blk-tint\)$/) && hasDecl(r, /^box-shadow: var\(--nf-blk-edge\)$/)), "Live Preview paints an opaque mix over the page, background plus edge shadows (no darker seams)");
  /* Rows are positioned and painted in order: a row's shadow reaching up
     would cover the quote bar or code card of the row above. Only the
     block's first row reaches up, only its last row reaches down. */
  const edges = lp.filter((r) => declValue(r, "--nf-blk-edge"));
  w3(edges.length === 4, `four row shapes (middle, first, last, both): ${edges.length}`);
  for (const r of edges) {
    const s = r.selectors.join(" ");
    const shadows = splitTop(declValue(r, "--nf-blk-edge"));
    w3(shadows.every((sh) => / 0 0 var\(--nf-blk-tint\)$/.test(sh)), `row shadows are offsets, never spreads (a spread reaches up): ${s}`);
    const up = shadows.some((sh) => /^\S+ calc\(-1 \* var\(--nf-blk-pad\)\) 0 0 /.test(sh) || /^calc\(-1 \* var\(--nf-blk-pad\)\) calc\(-1 \* var\(--nf-blk-pad\)\)/.test(sh));
    const down = shadows.some((sh) => /^(calc\(-1 \* var\(--nf-blk-pad\)\)|var\(--nf-blk-pad\)) var\(--nf-blk-pad\) 0 0 /.test(sh));
    w3(up === s.includes(".nf-blk-first"), `only the first row reaches up: ${s}`);
    w3(down === s.includes(".nf-blk-last"), `only the last row reaches down: ${s}`);
  }
  const rv = rules.filter((r) => r.selectors.some((s) => s.startsWith(".markdown-rendered ")) && hasDecl(r, /^background-color: var\(--nf-blk-tint\)$/));
  w3(rv.length === 1 && hasDecl(rv[0], TINT) && rv[0].selectors.filter((s) => /^\.markdown-rendered p\b/.test(s)).every((s) => s.includes(":not(li > p, blockquote > p)")), "Reading view paints the block, not a paragraph inside its item or quote");
  w3(rv.length === 1 && ["p", "li", "blockquote"].every((tag) => rv[0].selectors.some((s) => s.startsWith(`.markdown-rendered ${tag}`))), "the Reading paint rule names p, li and blockquote as separate selectors (one :is() would lift the item above its reach-back rule)");
  const reach = rules.find((r) => r.selectors.length === 1 && /^\.markdown-rendered li:is\(/.test(r.selectors[0]) && hasDecl(r, /--nf-blk-hang/));
  w3(reach && rv[0].selectors.includes(reach.selectors[0]) && rules.indexOf(reach) > rules.indexOf(rv[0]), "the item's reach-back shadow has the paint rule's weight and comes after it");
  w3(rulesWith(/nf-lk-q-tint .*\.cm-line\.HyperMD-quote/).length >= 3 && rulesWith(/nf-lk-q-tint .*\.cm-line\.HyperMD-quote/).every((r) => r.selectors.every((s) => !/\.cm-line\.HyperMD-quote/.test(s) || s.includes(":not(.nf-blk-bg)"))), "the tinted-quote look leaves block-coloured quote lines to their block tint");
  w3(rules.some((r) => r.selectors.some((s) => /^\.markdown-rendered li:is\(/.test(s)) && hasDecl(r, /calc\(-1 \* var\(--nf-blk-hang, 3ch\)\) 0 0 var\(--nf-blk-pad\)/)), "a tinted rendered item reaches back over its hanging marker");
  w3(rules.some((r) => r.selectors.includes("body.nf-clean .markdown-rendered ul > li") && hasDecl(r, /^--nf-blk-hang: var\(--nf-list-col\)$/)), "under clean rendering the bullet column is One list column's");
  w3(!rules.some((r) => r.selectors.some((s) => s.includes(".cm-line:has(span.nf-blk-"))), "no .cm-line:has(span.nf-blk-…) (it tints only the marker's own line)");
  w3(!rules.some((r) => r.selectors.some((s) => /\.nf-blk-/.test(s) && /\bh[1-6]\b|HyperMD-header(?!\))/.test(s.replace(/:not\(\.HyperMD-header\)/g, "")))), "no block-tint rule targets a heading");
}

/* U1.5: one --callout-icon rule per CALLOUT_ICONS name (the module's list
   when present), nothing else sets an nfi- icon, and nfi-emoji hides the
   glyph in the rendered box and in the in-place editor's lead. */
{
  const FIXED = "lightbulb sparkles rocket star flag target pin bookmark book-open graduation-cap brain code-2 link calendar clock check-circle-2 alert-triangle info help-circle flame heart coffee map-pin quote".split(" ");
  const pickerTs = resolve(root, "src/ui/callout-icon-picker.ts");
  let names = FIXED;
  if (existsSync(pickerTs)) {
    const src = readFileSync(pickerTs, "utf8");
    const at = src.indexOf("export const CALLOUT_ICONS");
    names = [...src.slice(at, src.indexOf("];", at)).matchAll(/name: "([a-z0-9-]+)"/g)].map((m) => m[1]);
    w3(names.length === 24, `CALLOUT_ICONS parsed (${names.length} names)`);
  } else console.log("SKIP (no src/ui/callout-icon-picker.ts): CALLOUT_ICONS cross-check, using the spec's 24 names");
  const iconRules = rules.filter((r) => r.selectors.some((s) => s.includes('[data-callout-metadata~="nfi-')) && hasDecl(r, /^--callout-icon:/));
  for (const name of names) {
    const own = iconRules.filter((r) => r.selectors.length === 1 && r.selectors[0] === `.callout[data-callout-metadata~="nfi-${name}"]`);
    w3(own.length === 1 && hasDecl(own[0], new RegExp(`^--callout-icon: lucide-${name}$`)), `nfi-${name} shows lucide-${name}`);
  }
  w3(iconRules.length === names.length, `no other nfi- rule sets --callout-icon (${iconRules.length} rules, ${names.length} names)`);
  const hide = rules.filter((r) => r.selectors.some((s) => s.includes('[data-callout-metadata~="nfi-emoji"]') && /\.callout-icon$/.test(s)) && hasDecl(r, /^display: none$/));
  w3(hide.length >= 2 && hide.some((r) => r.selectors.every((s) => s.startsWith("body.nf-callout-menu"))), "nfi-emoji hides the icon, also past Polished Callouts' inline-flex");
  w3(rulesWith(/\.nf-visual-callout-lead\.is-emoji$/).some((r) => hasDecl(r, /^min-width: 0$/) && hasDecl(r, /^gap: 0$/)), "an emoji Callout's editor lead keeps no icon slot (no jump on entry)");
  w3(rulesWith(/\.nf-visual-callout-lead\.is-emoji > \.callout-icon$/).some((r) => hasDecl(r, /^display: none$/)), "an emoji Callout's editor lead hides its icon");
  w3(!/data-callout-metadata~="nf-icon-/.test(css), "icon tokens are nfi-, never nf-icon- (the colour writer replaces any nf- token)");
}

/* U1.6: the icon picker speaks the popover language, its grid follows the
   module's column count, its cells are raised ghosts with their own focus
   outline; colour swatches in DOM menus are filled. */
{
  const card = rulesWith(/^\.nf-icon-picker$/);
  for (const token of ["--nf-pop-bg", "--nf-pop-border-color", "--nf-pop-radius", "--nf-pop-shadow"]) {
    w3(card.some((r) => r.body.includes(`var(${token})`)), `the icon picker uses ${token}`);
  }
  w3(rulesWith(/\.nf-icon-picker-grid$/).some((r) => hasDecl(r, /^grid-template-columns: repeat\(var\(--nf-icon-cols, 6\)/)), "the picker grid lays out --nf-icon-cols columns");
  const pickerTs = resolve(root, "src/ui/callout-icon-picker.ts");
  if (existsSync(pickerTs)) w3(/setProperty\("--nf-icon-cols"/.test(readFileSync(pickerTs, "utf8")), "the picker module sets --nf-icon-cols on each grid (the arrow keys' column count)");
  const cell = rulesWith(/^\.nf-icon-picker button\.nf-icon-picker-cell$/);
  w3(cell.some((r) => hasDecl(r, /^box-shadow: none$/) && hasDecl(r, /^background-color: transparent$/)), "picker cells are raised ghosts");
  w3(rulesWith(/^\.nf-icon-picker button\.nf-icon-picker-cell:focus-visible$/).some((r) => hasDecl(r, /^outline: 2px solid var\(--interactive-accent\)$/)), "picker cells keep a focus outline");
  w3(rulesWith(/^\.nf-icon-picker button\.nf-icon-picker-cell:hover$/).length > 0 && rulesWith(/^\.nf-icon-picker button\.nf-icon-picker-default:hover$/).length > 0, "picker cells and the Default button have their own hover");
  w3(rules.some((r) => r.selectors.some((s) => /\.nf-menu-swatch svg$/.test(s)) && hasDecl(r, /^fill: color-mix\(in srgb, currentColor 22%, transparent\)$/)), "text and Callout colour swatches are filled discs");
  w3(rules.some((r) => r.selectors.some((s) => /\.nf-menu-swatch\.is-bg svg$/.test(s)) && hasDecl(r, /^fill: color-mix\(in srgb, currentColor 45%, transparent\)$/)), "background swatches are filled squares");
  const local = css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*\.nf-icon-picker,\s*\.nf-icon-picker\[data-placement="below"\] \{\s*animation: none;/);
  w3(local, "the icon picker's own reduced-motion block stops its entrance");
}

/* page-surfaces-css (U1.7): page style classes style the two view roots
   only, small text never self-references --font-text-size, and its list
   geometry re-uses One list column's multipliers at 0.875. */
{
  for (const cls of ["nf-serif", "nf-kai", "nf-mono"]) {
    const uses = rules.filter((r) => r.selectors.some((s) => new RegExp(`\\.${cls}\\b`).test(s)));
    w3(uses.length > 0 && uses.every((r) => r.selectors.every((s) => /^\.markdown-(source|preview)-view\.nf-(serif|kai|mono)$/.test(s)) && hasDecl(r, /^--font-text: /)), `${cls} sets --font-text on the two view roots only`);
    w3(!rules.some((r) => r.selectors.some((s) => new RegExp(`body[.\\w-]*\\.${cls}\\b`).test(s))), `${cls} is never a body class`);
  }
  w3(!rules.some((r) => r.decls.some((d) => /^--font-text-size:.*var\(--font-text-size/.test(d))), "no --font-text-size self-reference (a cycle computes to invalid)");
  const small = rules.find((r) => r.selectors.includes(".markdown-source-view.nf-small .cm-scroller") && r.selectors.includes(".markdown-preview-view.nf-small"));
  w3(small && declValue(small, "font-size") === "calc(var(--font-text-size) * 0.875)", "small text is 87.5% on the scroller (Live Preview) and the preview root");
  const clean = rules.find((r) => r.selectors.length === 1 && r.selectors[0] === "body.nf-clean" && declValue(r, "--nf-list-col"));
  const smallList = rulesWith(/:is\(\.markdown-source-view, \.markdown-preview-view\)\.nf-small$/).find((r) => declValue(r, "--nf-list-col"));
  w3(clean && smallList, "One list column and its small-text twin exist");
  const multiplier = (v) => Number(/^calc\(var\(--font-text-size, 16px\) \* ([\d.]+)\)$/.exec(declValue(clean, v) ?? "")?.[1]);
  for (const v of ["--nf-list-col", "--nf-list-dot", "--nf-check-size"]) {
    const sm = /^calc\(var\(--font-text-size, 16px\) \* 0\.875 \* ([\d.]+)\)$/.exec(declValue(smallList, v) ?? "");
    w3(multiplier(v) > 0 && sm && Number(sm[1]) === multiplier(v), `small text re-evaluates ${v} with One list column's multiplier (${multiplier(v)} vs ${sm?.[1]})`);
  }
  /* The task pair is fixed px (the <input>'s 13.33px margins) plus a share
     of the text size: evaluated at 16px it must land on the measured
     body.nf-clean values, so the two stay one geometry. */
  for (const v of ["--nf-list-task-col", "--nf-list-check"]) {
    const m = /^calc\(([\d.]+)px ([+-]) var\(--font-text-size, 16px\) \* 0\.875 \* ([\d.]+)\)$/.exec(declValue(smallList, v) ?? "");
    const at = (size) => m && Number(m[1]) + (m[2] === "+" ? 1 : -1) * size * Number(m[3]);
    w3(m && Math.abs(at(16) - 16 * multiplier(v)) < 0.05, `small text's ${v} is One list column's at 16px (${at(16)?.toFixed(3)} vs ${16 * multiplier(v)})`);
  }
  w3(rulesWith(/\.nf-small\s+\.cm-line:not\(\.cm-active\) \.nf-ordered-list-marker::after$/).some((r) => hasDecl(r, /^font-size: calc\(var\(--font-text-size, 1rem\) \* 0\.875\)$/)), "Live Preview's drawn list numbers shrink with small text");
  w3(rules.some((r) => r.selectors.includes(".markdown-source-view.nf-wide") && r.selectors.includes(".markdown-preview-view.nf-wide") && hasDecl(r, /^--file-line-width: 100%$/)), "full width lifts the readable line cap in both views");
}

/* U1.8: the page header's parts, fixed cover height, hover-only controls
   with their reduced-motion twin, the tab emoji past Obsidian's hide rule;
   the notice link (its arrow is the module's own span) and What's new. */
{
  for (const sel of [/^\.nf-page-header$/, /^\.nf-page-cover$/, /^\.nf-page-cover-img$/, /^\.nf-page-icon$/, /^\.nf-page-controls$/, /^\.nf-page-cover-actions$/, /button\.nf-page-ghost$/, /button\.nf-page-ghost:focus-visible$/, /\.nf-page-cover\.is-repositioning$/, /^\.nf-page-icon:focus-visible$/]) {
    w3(rulesWith(sel).length > 0, `page header rule ${sel}`);
  }
  w3(rulesWith(/^\.nf-page-header$/).some((r) => hasDecl(r, /^--nf-page-cover-h: 200px$/)) && rulesWith(/^\.nf-page-cover$/).some((r) => hasDecl(r, /^height: var\(--nf-page-cover-h\)$/)), "the cover band has a fixed 200px height (a loading image never resizes a Reading section)");
  w3(rulesWith(/^\.nf-page-header\.has-cover \.nf-page-icon$/).some((r) => hasDecl(r, /^margin-top: -40px$/)), "the icon overlaps the cover by 40px");
  w3(rulesWith(/^\.nf-page-controls$/).some((r) => hasDecl(r, /^opacity: 0$/)), "the page controls rest invisible");
  const shown = rules.filter((r) => hasDecl(r, /^opacity: 1$/) && r.selectors.some((s) => s.endsWith(".nf-page-controls")));
  w3(shown.some((r) => r.selectors.some((s) => s.includes(".inline-title:hover"))) && shown.some((r) => r.selectors.includes(".nf-page-controls:focus-within")), "hovering the title (or keyboard focus) shows the page controls");
  w3(/@media \(prefers-reduced-motion: reduce\) \{\s*\.nf-page-controls,\s*\.nf-page-cover-actions \{\s*transition: none;/.test(css), "reduced motion: the page controls appear without a fade");
  const tab = rulesWith(/\.nf-has-page-icon \.workspace-tab-header-inner-icon$/);
  w3(tab.some((r) => r.selectors.some((s) => s.startsWith(".workspace .mod-root ") && s.includes(".nf-has-page-icon")) && hasDecl(r, /^display: flex$/)), "a page icon shows in its tab, past Obsidian's (0,5,0) hide rule");
  w3(rulesWith(/\.nf-notice-link$/).some((r) => hasDecl(r, /^cursor: pointer$/)), "a link notice shows the pointer");
  const pseudo = rules.filter((r) => r.selectors.some((s) => /\.nf-notice-link\b.*::?(before|after)$/.test(s)) && r.decls.some((d) => /^content: (?!none|""|'')/.test(d)));
  w3(pseudo.length === 0, "no CSS arrow on a link notice (the module appends it; a second would double it)");
  w3(rulesWith(/\.nf-notice-link \.nf-notice-arrow$/).some((r) => hasDecl(r, /^white-space: pre$/) && hasDecl(r, /^display: inline-block$/)), "the notice arrow keeps its leading space as an inline-block");
  w3(rulesWith(/^\.modal\.nf-whats-new-modal$/).some((r) => hasDecl(r, /^width: min\(560px, /)), "What's new is at most 560px wide");
  w3(rulesWith(/^\.nf-whats-new-row$/).some((r) => hasDecl(r, /^grid-template-columns: 32px minmax\(0, 1fr\) auto$/)), "What's new rows align on a 32px icon column");
  w3(rulesWith(/\.nf-whats-new-list$/).some((r) => hasDecl(r, /^overflow-y: auto$/) && hasDecl(r, /^min-height: 0$/)), "What's new scrolls its list, not the page or its footer");
  w3(rulesWith(/button\.nf-whats-new-release:focus-visible$/).some((r) => hasDecl(r, /^outline: 2px solid var\(--interactive-accent\)$/)), "the release-notes link keeps a focus outline");
}

/* U1.9: every nf- class the wave-2 surface modules set (class contexts
   only) is styled or allowlisted with the reason; every allowlist entry is
   still used. */
{
  const W3_ALLOW = new Map([
    ["nf-pop", "marker class; the icon picker's chrome is .nf-icon-picker's"],
    ["nf-page-ghost-label", "label text inside the styled button.nf-page-ghost; it inherits the button's ink"],
    ["nf-whats-new-tour", "a mod-cta button: Obsidian's primary button carries the look"],
    ["nf-gallery-palettes", "modifier of the styled .nf-gallery grid"],
    ["nf-gallery-looks", "modifier of the styled .nf-gallery grid"],
    ["nf-setting-note", "a note appended to a setting's description; it inherits .setting-item-description"],
    ["nf-sw-group", "role=group wrapper; its .nf-sw-group-header is styled"],
    ["nf-comments-list", "hook on the comments list modal; its rows are Obsidian's native mod-complex suggestion rows"],
    ["nf-style-section", "wrapper of the Note style section inside a native .setting-group; the group cards give its rhythm"],
  ]);
  const FILES = ["src/ui/callout-icon-picker.ts", "src/ui/whats-new.ts", "src/ui/style-gallery.ts", "src/ui/style-switcher.ts", "src/ui/settings-preview.ts", "src/features/page-header.ts", "src/features/page-style.ts", "src/features/block-color.ts", "src/features/comments-list.ts"];
  const selectorClasses = new Set();
  for (const rule of rules) for (const s of rule.selectors) for (const m of s.matchAll(/\.(nf-[a-z0-9-]+)/g)) selectorClasses.add(m[1]);
  const found = new Map();
  let present = 0;
  for (const file of FILES) {
    const path = resolve(root, file);
    if (!existsSync(path)) {
      console.log(`SKIP (no ${file}): module class scan`);
      continue;
    }
    present++;
    const src = stripComments(readFileSync(path, "utf8"));
    const add = (text) => {
      for (const t of text.split(/\s+/)) if (/^nf-[a-z0-9-]+$/.test(t) && !t.endsWith("-")) found.set(t, found.get(t) ?? file);
    };
    const Q = String.raw`(["'\x60])((?:(?!\1)[^\\]|\\.)*?)\1`;
    for (const m of src.matchAll(new RegExp(String.raw`\bcls:\s*` + Q, "g"))) add(m[2]);
    for (const m of src.matchAll(/\bcls:\s*\[([^\]]*)\]/g)) for (const q of m[1].matchAll(new RegExp(Q, "g"))) add(q[2]);
    for (const m of src.matchAll(new RegExp(String.raw`\bclassName\s*=\s*` + Q, "g"))) add(m[2]);
    for (const m of src.matchAll(new RegExp(String.raw`\b(?:addClass|removeClass|toggleClass)\??\.?\(\s*` + Q, "g"))) add(m[2]);
    for (const m of src.matchAll(new RegExp(String.raw`\bclassList\.(?:add|remove|toggle)\??\.?\(\s*` + Q, "g"))) add(m[2]);
  }
  const orphaned = [...found.keys()].filter((c) => !selectorClasses.has(c) && !W3_ALLOW.has(c)).map((c) => `${c} (${found.get(c)})`);
  w3(orphaned.length === 0, `module classes with no rule: style them or allowlist them with the reason: ${orphaned.join(", ")}`);
  if (present === FILES.length) for (const name of W3_ALLOW.keys()) w3(found.has(name), `W3_ALLOW entry ${name} is no longer set by a module: remove it`);
  w3(found.size >= 50 || present < FILES.length, `module classes were collected (${found.size})`);
  w3Modules = found.size;
  w3Allowed = W3_ALLOW.size;
}

/* w1c-palette-page-scope: nothing in src/ sets nf-palette-page-scope, so
   the element-level paper opt-in was dropped; it comes back only with a
   caller. */
{
  const callers = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, name.name);
      if (name.isDirectory()) walk(path);
      else if (name.name.endsWith(".ts") && readFileSync(path, "utf8").includes("nf-palette-page-scope")) callers.push(path);
    }
  };
  walk(resolve(root, "src"));
  w3(callers.length > 0 || !css.includes("nf-palette-page-scope"), "no rule keys on nf-palette-page-scope while no code sets it");
  /* (lead) a preset name in a 3-column style tile wraps to two lines
     instead of being clipped ("Catppuccin pastel"). */
  const name = rulesWith(/\.nf-canvas-style-tiles:not\(\.nf-canvas-layout-tiles\) > button\.nf-canvas-style-tile:not\(\.nf-canvas-style-tile-match\) > \.nf-canvas-style-tile-name$/);
  w3(name.some((r) => hasDecl(r, /^white-space: normal$/) && hasDecl(r, /^-webkit-line-clamp: 2$/) && hasDecl(r, /^overflow: hidden$/)), "preset tile names wrap to two lines, then ellipsize");
}

/* w2c-code-fold-chevron-overlap: an open captioned code block keeps a strip
   for its fold chevron (absolute at 7px, 18px tall) above the first code
   row; the collapsed 34px bar keeps its own padding. Reading view replaces
   the strip with a gutter (fixcss-reading-code-header, R2-W3-FIXCSS). */
{
  const fold = rulesWith(/^pre\.nf-captioned-code > \.nf-rendered-code-fold$/).find((r) => declValue(r, "inset-block-start"));
  const open = rulesWith(/^pre\.nf-captioned-code:not\(\.nf-rendered-code-collapsed\)$/).find((r) => declValue(r, "padding-block-start"));
  w3(fold && open, "the fold chevron and the open block's top strip are both declared");
  w3(calcPx(declValue(open, "padding-block-start"), {}) >= calcPx(declValue(fold, "inset-block-start"), {}) + 18, "an open captioned code block starts its code below the fold chevron (it covered the first glyph)");
  w3(!rulesWith(/pre\.nf-captioned-code\.nf-rendered-code-collapsed$/).some((r) => declValue(r, "padding-block-start") || declValue(r, "padding")), "the collapsed bar keeps Obsidian's padding (its 34px layout is unchanged)");
}

/* w2c-lp-callout-table-padding: only Obsidian's table widget has the
   .table-cell-wrapper (and the add-row rails): cell padding 0 and the
   stretched width are scoped to it, so a table in a rendered Callout in
   Live Preview is padded and sized as in Reading view. */
{
  const zero = rules.filter((r) => hasDecl(r, /^padding: 0$/) && r.selectors.some((s) => /is-live-preview .*table :is\(th, td\)$/.test(s)));
  w3(zero.length > 0 && zero.every((r) => r.selectors.every((s) => s.includes(".cm-table-widget table"))), "LP table cells lose their padding only in the table widget (rendered Callout tables have no wrapper)");
  const wide = rules.filter((r) => hasDecl(r, /^width: 100%$/) && r.selectors.some((s) => /^body\.nf-tables \.markdown-source-view\.is-live-preview .*table$/.test(s)));
  w3(wide.length > 0 && wide.every((r) => r.selectors.every((s) => s.includes(".cm-table-widget table"))), "only the LP table widget stretches to the editor width");
}

/* w2c-toggle-list-last-air: a quoted list row in an open Callout/toggle
   stands for a rendered <li> (--list-spacing above and below), and the
   first item after a paragraph keeps the collapsed paragraph/list margin. */
{
  const sum = rules.find((r) => r.selectors.some((s) => s.endsWith(":is(.cm-line.nf-co-edit, .cm-line.nf-co-code)")) && declValue(r, "padding-block-start"));
  w3(sum && /--nf-co-list-top/.test(declValue(sum, "padding-block-start")) && /--nf-co-list-bottom/.test(declValue(sum, "padding-block-end")), "the edit-row padding sum carries the list-item padding");
  const li = rulesWith(/\.cm-line\.nf-co-edit\.nf-qlist$/).find((r) => declValue(r, "--nf-co-list-top"));
  w3(li && /--list-spacing/.test(declValue(li, "--nf-co-list-top")) && /--list-spacing/.test(declValue(li, "--nf-co-list-bottom") || ""), "a quoted list row is padded like a rendered <li>");
  const gap = rules.find((r) => r.selectors.some((s) => /:has\(\.cm-quote\) \+ \.cm-line\.nf-co-edit\.nf-qlist:not\(\.nf-co-quote\)$/.test(s)));
  w3(gap && calcPx(declValue(gap, "--nf-co-list-top"), { "--p-spacing": "16px", "--list-spacing": "1.2px" }) === 17.2, "the first item after a paragraph opens with the paragraph gap plus its own padding (it rose 17.2px)");
  w3(!rulesWith(/\.cm-line\.nf-co-content-first\.nf-qlist$/).some((r) => /0\.45em/.test(declValue(r, "--nf-co-content-gap-top") || "")), "a list that opens a Callout no longer adds its padding twice (0.45em)");
}

/* w1c-parent-toggle-paint / w2c-parent-toggle-extra-acceptance: rows whose
   parent is a toggle (main.ts: nf-co-parent-toggle + --nf-co-toggle-boxes /
   --nf-co-toggle-depth) place the block on the toggle's content column and
   paint no layer for the toggle. Replayed for '> [!nf-toggle]+ T /
   > > [!note] N' (counts 0 / 1) and the same inside a Callout (1 / 1). */
{
  const main = resolve(root, "src/main.ts");
  if (existsSync(main)) {
    const src = readFileSync(main, "utf8");
    w3(src.includes('" nf-co-parent-toggle"') && src.includes("--nf-co-toggle-boxes:") && src.includes("--nf-co-toggle-depth:"), "main.ts still marks parent-toggle rows and writes the toggle counts");
  } else console.log("SKIP (no src/main.ts): parent-toggle contract");
  const ROW = /^body\.nf-callout-menu \.markdown-source-view\.is-live-preview :is\(\.cm-line\.nf-co-edit, \.cm-line\.nf-co-code\)\.nf-co-parent-toggle$/;
  const row = rulesWith(ROW).find((r) => declValue(r, "--nf-co-block-start"));
  w3(row && declValue(row, "--nf-co-parent-is-box"), "parent-toggle rows declare their block column and whether a box encloses the toggle");
  const T = 23.2, base = { "--nf-toggle-content-inset": `${T}px`, "--nf-co-inset": "39px", "--nf-co-quote-step": "16px", "--nf-quote-inset": "16px", "--nf-nest": "16px", "--nf-co-plain-depth": 0 };
  const shape = (boxes, toggles) => {
    const vars = { ...base, "--nf-co-toggle-boxes": boxes, "--nf-co-toggle-depth": toggles };
    vars["--nf-co-parent-is-box"] = calcPx(declValue(row, "--nf-co-parent-is-box"), vars);
    vars["--nf-co-block-start"] = `${calcPx(declValue(row, "--nf-co-block-start"), vars)}px`;
    vars["--nf-co-block-text"] = `${calcPx(declValue(row, "--nf-co-block-text"), vars)}px`;
    return vars;
  };
  const inToggle = shape(0, 1), inBoxedToggle = shape(1, 1);
  const box = rulesWith(/\.cm-line\.nf-co-edit\.nf-co-parent-toggle:not\(\.nf-co-toggle\)::after$/).find((r) => declValue(r, "inset-inline-start"));
  w3(box && calcPx(declValue(box, "inset-inline-start"), inToggle) === T, "a Callout in a toggle starts its box on the toggle's content column (it started 39px in)");
  w3(box && calcPx(declValue(box, "inset-inline-end"), inToggle) === 0, "...and ends where the toggle does (a toggle has no end padding)");
  w3(box && calcPx(declValue(box, "inset-inline-start"), inBoxedToggle) === 39 + T, "a Callout in a toggle in a Callout starts one content inset further in");
  const prefix = rulesWith(/\.cm-line\.nf-co-parent-toggle \.nf-callout-prefix$/).find((r) => declValue(r, "width"));
  w3(prefix && calcPx(declValue(prefix, "width"), { ...inToggle, "--nf-prefix-inner-depth": 0 }) === Math.round((T + 39) * 10) / 10, "its text column is the toggle column plus one content inset (it was 78px: +15.8px on entry)");
  const hang = rulesWith(/\.cm-line\.nf-co-edit\.nf-co-hang\.nf-co-parent-toggle:not\(\.nf-co-toggle\)$/).find((r) => declValue(r, "--nf-row-hang"));
  w3(hang && calcPx(declValue(hang, "--nf-row-hang"), { ...inToggle, "--nf-co-quote-depth": 0 }) === calcPx(declValue(prefix, "width"), { ...inToggle, "--nf-prefix-inner-depth": 0 }), "wrapped rows resume on the gap widget's column");
  const lead = rulesWith(/\.cm-line\.nf-co-parent-toggle \.nf-visual-callout-lead$/).find((r) => declValue(r, "margin-inline-start"));
  w3(lead && calcPx(declValue(lead, "margin-inline-start"), inToggle) === Math.round((14 + T) * 10) / 10, "the header icon keeps its rendered place in the toggle");
  const layer = rulesWith(/\.cm-line\.nf-co-edit\.nf-co-nested\.nf-co-parent-toggle::before$/).find((r) => declValue(r, "opacity"));
  w3(layer && declValue(layer, "opacity") === "var(--nf-co-parent-is-box)" && inToggle["--nf-co-parent-is-box"] === 0 && inBoxedToggle["--nf-co-parent-is-box"] === 1, "no parent layer is painted for a toggle; a Callout around the toggle still is");
  const tint = rulesWith(/:is\(\.cm-line\.nf-co-edit, \.cm-line\.nf-co-code\)\.nf-co-nested\.nf-co-parent-toggle$/).find((r) => declValue(r, "background-color"));
  w3(tint && /calc\(var\(--nf-co-parent-is-box\) \* 100%\)/.test(declValue(tint, "background-color")) && hasDecl(tint, /!important$/), "the row tint of a toggle parent is transparent (over the nested rows' !important tint)");
  const bar = rulesWith(/\.cm-line\.nf-co-edit\.nf-co-quote\.nf-co-nested\.nf-co-parent-toggle::before$/).find((r) => declValue(r, "border-inline-start"));
  w3(bar && declValue(bar, "z-index") === "auto" && /--blockquote-border-color/.test(declValue(bar, "border-inline-start")), "a quote on such a row gets its bar back, above the box, in the quote colour");
  w3(bar && calcPx(declValue(bar, "inset-inline-start"), { ...inToggle, "--nf-co-quote-depth": 1 }) === Math.round((T + 39) * 10) / 10, "the bar of a quote in a Callout in a toggle stands on the Callout's text column");
  const tbar = rulesWith(/\.cm-line\.nf-co-edit\.nf-co-quote\.nf-co-toggle\.nf-co-nested\.nf-co-parent-toggle::before$/).find((r) => declValue(r, "inset-inline-start"));
  w3(tbar && calcPx(declValue(tbar, "inset-inline-start"), { ...shape(0, 2), "--nf-co-quote-depth": 1 }) === Math.round(2 * T * 10) / 10, "the bar of a quote in a toggle in a toggle stands on the inner toggle's column (a grey line crossed the text)");
  const air = rulesWith(/:is\(\.cm-line\.nf-co-edit, \.cm-line\.nf-co-code\)\.nf-co-parent-toggle:not\(\.nf-co-toggle\)$/).find((r) => declValue(r, "--nf-co-boxes"));
  w3(air && calcPx(declValue(air, "--nf-co-boxes"), inToggle) === 1, "a Callout in a toggle closes only its own box's air (it opened 13px taller)");
  const top = rulesWith(/\.nf-co-nested\.nf-co-first\.nf-co-content-first\.nf-co-parent-toggle:not\(\.nf-co-toggle\)$/).find((r) => declValue(r, "--nf-co-nested-gap-top"));
  w3(top && calcPx(declValue(top, "--nf-co-nested-gap-top"), inToggle) === 2 && calcPx(declValue(top, "--nf-co-nested-gap-top"), inBoxedToggle) === 12, "a Callout that opens a toggle keeps the toggle's 2px, inside a box the 0.75em (it opened 12px low)");
  const card = rulesWith(/\.cm-line\.nf-co-code\.nf-qcode\.nf-co-parent-toggle:not\(\.nf-co-toggle\)::after$/).find((r) => declValue(r, "inset-inline-start"));
  w3(card && calcPx(declValue(card, "inset-inline-start"), inToggle) === Math.round((T + 39) * 10) / 10, "a fence in that Callout puts its card on the Callout's text column");
}

/* w1c-toggle-code-card / w2c-toggle-code-card-rules: a fence straight inside
   an open toggle (main.ts: nf-co-toggle-code + the two counts) puts its card,
   language chip and wrapped rows on the rendered <pre>'s columns, measured on
   the fixture: the <pre> starts T (one toggle inset) right of the content
   edge in a top-level toggle, 39 + T in a toggle in a Callout, 2T in a toggle
   in a toggle, T + 16 inside a quote in the toggle; it ends flush with a
   toggle and one end inset in per Callout box; the code sits 16px inside. */
{
  const main = resolve(root, "src/main.ts");
  if (existsSync(main)) w3(readFileSync(main, "utf8").includes('" nf-co-toggle-code"'), "main.ts still marks fence rows inside a toggle");
  else console.log("SKIP (no src/main.ts): toggle-code contract");
  const P = "body.nf-callout-menu .markdown-source-view.is-live-preview .cm-line.nf-co-code.nf-co-toggle-code";
  const colRule = rules.find((r) => r.selectors.includes(P) && declValue(r, "--nf-co-toggle-column"));
  const card = rules.find((r) => r.selectors.includes(`${P}.nf-qcode::after`) && declValue(r, "inset-inline-start"));
  const chip = rules.find((r) => r.selectors.includes(`${P} .nf-visual-code-fence`) && declValue(r, "margin-inline-start"));
  const wrap = rulesWith(/^body\.nf-clean \.markdown-source-view\.is-live-preview \.cm-line\.nf-qcode\.nf-co-code\.nf-co-toggle-code:not\(\.nf-nested-block\)$/).find((r) => declValue(r, "--nf-code-hang"));
  w3(colRule && card && chip && wrap, "toggle code rows declare their column, card, chip and wrap");
  const T = 23.2, r1 = (v) => Math.round(v * 10) / 10;
  const shape = (boxes, toggles, quote = 0) => {
    const vars = { "--nf-toggle-content-inset": `${T}px`, "--nf-co-inset": "39px", "--nf-co-quote-step": "16px", "--nf-quote-inset": "16px", "--nf-nest": "16px", "--nf-co-code-end": "15px", "--nf-co-code-pad": "16px", "--nf-co-plain-depth": 0, "--nf-co-toggle-boxes": boxes, "--nf-co-toggle-depth": toggles, "--nf-co-quote-depth": quote };
    vars["--nf-co-toggle-column"] = `${calcPx(declValue(colRule, "--nf-co-toggle-column"), vars)}px`;
    return vars;
  };
  for (const [name, [boxes, toggles, quote], pre, end] of [
    ["top-level toggle", [0, 1, 0], T, 0],
    ["toggle in a Callout", [1, 1, 0], 39 + T, 15],
    ["toggle in a toggle", [0, 2, 0], 2 * T, 0],
    ["quote in a toggle", [0, 1, 1], T + 16, 0],
  ]) {
    const v = shape(boxes, toggles, quote);
    w3(calcPx(declValue(card, "inset-inline-start"), v) === r1(pre), `${name}: the card starts where the rendered <pre> does (it started one 39px box in)`);
    w3(calcPx(declValue(card, "inset-inline-end"), v) === end, `${name}: the card ends where the rendered <pre> does`);
    w3(calcPx(declValue(chip, "margin-inline-start"), v) === r1(pre + 16), `${name}: the language chip sits on the code column`);
    w3(calcPx(declValue(wrap, "--nf-code-hang"), v) === r1(pre + 16), `${name}: wrapped code rows resume on the code column`);
    w3(calcPx(declValue(wrap, "padding-inline-end"), v) === end + 16, `${name}: code wraps one code padding before the card's end`);
  }
}

/* w2c-lp-callout-folded-code-double: the Live Preview fallback chip for a
   folded code caption stands down once the caption is bound to its <pre>
   (paragraph .nf-code-caption-block): the <pre> is then the 34px bar, as in
   Reading view. A folded block in a rendered Callout showed both. */
{
  const main = resolve(root, "src/main.ts");
  if (existsSync(main)) w3(/captionBlock\.classList\.add\("nf-code-caption-block"\)/.test(readFileSync(main, "utf8")), "main.ts still marks a bound code caption's paragraph");
  else console.log("SKIP (no src/main.ts): bound caption contract");
  const chip = rules.filter((r) => r.selectors.some((s) => /\.nf-rendered-caption\[data-nf-kind="code"\]\[data-nf-collapsed="true"\]/.test(s)));
  w3(chip.length >= 3, "the folded-caption fallback chip, its prefix and its hover are declared");
  w3(chip.every((r) => r.selectors.every((s) => !/\[data-nf-collapsed="true"\]/.test(s) || s.includes(".nf-code-caption-block > .nf-rendered-caption"))), "every folded-caption fallback rule skips a caption bound to its code block");
}

/* w2c-blank-container-row-height: a blank ">" row in an open Callout or
   toggle (only CodeMirror's caret buffers and the gap widget in it) is as
   tall as the collapsed margin it stands for, not a 27.2px text line, and
   the block after it adds only what its own margin has beyond that. */
{
  const BLANK = ".cm-line.nf-co-edit:not(.nf-co-first, .nf-co-meta):not(:has(> :not(.cm-widgetBuffer, .nf-visual-prefix)))";
  const row = rules.find((r) => r.selectors.some((s) => s.endsWith(BLANK)) && declValue(r, "line-height"));
  w3(row && row.selectors.every((s) => s.includes(".mod-cm6")) && hasDecl(row, /^line-height: .*!important$/), "blank container rows set their height over note-wide line-height snippets (.mod-cm6, !important)");
  w3(row && calcPx(declValue(row, "line-height"), { "--p-spacing": "16px" }) === 16 && calcPx(declValue(row, "line-height"), { "--p-spacing": "0px" }) === 8, "a blank row is one paragraph gap tall (16px, was 27.2px), never under half a line");
  const buf = rules.find((r) => r.selectors.some((s) => s.endsWith(`${BLANK} > .cm-widgetBuffer`)));
  w3(buf && declValue(buf, "vertical-align") === "top", "the caret buffers on a blank row do not stretch its line box (text-top made it 18.5px)");
  const nested = rules.find((r) => r.selectors.some((s) => s.endsWith(`${BLANK} + .cm-line.nf-co-nested.nf-co-first`)));
  w3(nested && calcPx(declValue(nested, "--nf-co-nested-gap-top"), { "--p-spacing": "16px" }) === 0, "a box after a blank row adds none of its 0.75em (the blank row is the collapsed margin)");
  const afterPara = rules.findIndex((r) => r.selectors.some((s) => s.endsWith("+ .cm-line.nf-co-nested.nf-co-first")) && /max\(0\.75em/.test(declValue(r, "--nf-co-nested-gap-top") || ""));
  w3(afterPara >= 0 && rules.indexOf(nested) > afterPara, "...and wins the tie with the after-a-paragraph rule by coming later");
  const fence = rules.find((r) => r.selectors.some((s) => s.endsWith(`${BLANK} + .cm-line.nf-co-code.nf-visual-fence-open`)));
  w3(fence && calcPx(declValue(fence, "--nf-co-gap-top"), { "--p-spacing": "16px", "--nf-co-code-gap": "17px" }) === 1, "a code card after a blank row adds only what its gap has beyond the paragraph gap");
}

/* w2c-callout-radius-edit: the edit rows round their layers like the
   rendered box (--nf-radius-block, not Obsidian's 4px on body); the card and
   rail looks keep theirs through body; nothing outside the edit rows moves. */
{
  const rendered = rules.find((r) => r.selectors.some((s) => /^body\.nf-callout-menu :is\(\.markdown-source-view\.is-live-preview, \.markdown-reading-view\)\s+\.callout:not\(\[data-callout="nf-cols"\]\):not\(\[data-callout="nf-col"\]\):not\(\[data-callout="nf-toggle"\]\)$/.test(s)) && declValue(r, "--callout-radius"));
  const rows = rules.filter((r) => declValue(r, "--callout-radius") && r.selectors.some((s) => s.includes(".cm-line.nf-co-")));
  w3(rendered && rows.length === 1 && declValue(rows[0], "--callout-radius") === declValue(rendered, "--callout-radius"), "the edit rows take the rendered box's corner radius (they inherited Obsidian's 4px)");
  w3(rows.length === 1 && rows[0].selectors.every((s) => s.startsWith("body.nf-callout-menu:not(.nf-callout-card, .nf-callout-rail) .markdown-source-view.is-live-preview")), "...except under the card and rail looks, whose body radius the rows inherit");
  for (const look of ["card", "rail"]) {
    w3(rules.some((r) => r.selectors.includes(`body.nf-callout-menu.nf-callout-${look}`) && declValue(r, "--callout-radius")), `the ${look} look still sets its radius on body`);
  }
  w3(!rules.some((r) => r.selectors.includes("body.nf-callout-menu") && declValue(r, "--callout-radius")), "the radius is not moved on body (Callouts in canvas cards and hover previews keep Obsidian's)");
}

/* w1c-rail-minimal-nested-code-spine: a code row in a nested Callout paints
   the parent's layer and the child's on one ::before, so the rail and
   minimal looks draw a spine / thread for each, in each box's colour (one
   spine at the parent's edge in the child's colour, before). A toggle's
   code rows in a Callout keep the parent's, in the parent's colour. */
{
  const NEST = ".cm-line.nf-co-code.nf-co-nested:not(.nf-co-toggle, .nf-co-parent-toggle)::before";
  const railSpine = rules.find((r) => r.selectors.some((s) => s.startsWith("body.nf-callout-menu.nf-callout-rail ") && s.endsWith(".cm-line.nf-co-code.nf-co-nested:not(.nf-co-parent-toggle)::before")) && r.selectors.some((s) => s.endsWith(".cm-line.nf-co-code.nf-co-nested.nf-co-toggle::before")));
  w3(railSpine && /^inset 3px 0 0 var\(--nf-co-parent-color/.test(declValue(railSpine, "box-shadow")), "rail: a nested code row's edge spine is the parent's, in the parent's colour");
  const railChild = rules.find((r) => r.selectors.some((s) => s.startsWith("body.nf-callout-menu.nf-callout-rail ") && s.endsWith(NEST)) && declValue(r, "background"));
  const railBg = railChild && declValue(railChild, "background");
  w3(railBg && /^linear-gradient\(\s*var\(--callout-color[^)]*\)\),\s*var\(--callout-color[^)]*\)\)\s*\)\s*var\(--nf-co-inset, 39px\) var\(--nf-co-nested-gap-top, 0px\) \/\s*3px/.test(railBg), "rail: the child's own spine sits one content inset in, 3px wide, in the child's colour");
  w3(railBg && (railBg.match(/linear-gradient\(/g) || []).length === 3 && /--nf-co-parent-surface/.test(railBg), "rail: the child and parent tints stay under the spine");
  const minChild = rules.find((r) => r.selectors.some((s) => s.startsWith("body.nf-callout-menu.nf-callout-minimal ") && s.endsWith(NEST)) && declValue(r, "background"));
  const minBg = minChild && declValue(minChild, "background");
  w3(minBg && /--callout-color[\s\S]*calc\(var\(--nf-co-inset, 39px\) \+ 21px\)[\s\S]*--nf-co-parent-color[\s\S]*no-repeat 21px 0 \/ 2px 100%$/.test(minBg), "minimal: the child's thread 21px into its box in its colour, the parent's 21px into its layer in its colour");
  /* The same one-pseudo-element trap in every look: the parent layer's
     edges are the parent's colour, the child's edges are layers, and a
     child box that closes while its parent goes on draws its own bottom
     edge instead of closing (and rounding) the parent's layer. */
  const base = rules.find((r) => r.selectors.includes("body.nf-callout-menu .markdown-source-view.is-live-preview .cm-line.nf-co-code.nf-co-nested::before") && declValue(r, "background"));
  const baseBg = base && declValue(base, "background");
  w3(base && /--nf-co-parent-color/.test(declValue(base, "border-inline-color") || ""), "a nested code row's parent layer has the parent's edge colour (it had the child's)");
  w3(baseBg && (baseBg.match(/linear-gradient\(/g) || []).length === 5 && /calc\(var\(--nf-co-inset, 39px\) - 1px\) var\(--nf-co-nested-gap-top, 0px\) \/\s*1px/.test(baseBg) && /right calc\(var\(--nf-co-code-end, 15px\) - 1px\) top/.test(baseBg) && /var\(--nf-co-child-close, 0px\)/.test(baseBg), "a nested code row draws the child's side edges (and its closing edge) as layers");
  const close = rules.find((r) => r.selectors.some((s) => s.endsWith(".cm-line.nf-co-code.nf-co-nested.nf-co-last:not(.nf-co-toggle, .nf-co-parent-toggle):has(+ .cm-line:is(.nf-co-edit, .nf-co-code))::before")));
  w3(close && declValue(close, "--nf-co-child-close") === "1px" && declValue(close, "border-block-end") === "0" && declValue(close, "border-end-start-radius") === "0", "a child that closes on a code row with its parent going on closes itself, not the parent's layer");
  const minToggle = rules.find((r) => r.selectors.some((s) => s.startsWith("body.nf-callout-menu.nf-callout-minimal ") && s.endsWith(".cm-line.nf-co-code.nf-co-toggle.nf-co-nested::before")) && declValue(r, "background"));
  w3(minToggle && /--nf-co-parent-color[\s\S]*no-repeat 21px 0 \/ 2px 100%$/.test(declValue(minToggle, "background")) && minToggle.selectors.every((s) => s.includes(".mod-cm6")), "minimal: a toggle's code rows in a Callout keep the parent's thread (the toggle's fill rule, one class heavier, erased it)");
}

/* w2c-list-code-residuals: a list item's code lands on Reading's column
   for every lead. The fence indent past the item's own indent is 2ch for
   "- " (the default); the decoration names any other in --nf-fence-lead
   (3ch for "1. ", 4ch for "10. ", a tab stop for a tab) and sets
   --nf-list-ol: 1 under an ordered item, whose column is 3ch of the text
   font. Replayed with a 14px code font (1ch = 8.43px): the code text must
   sit on item column + 16px for each lead. Each tab level takes the text
   font's tab stop (it was 2.25em of the code font, 4.5px short per level);
   the two lengths are registered, so they compute on .cm-content and not
   in the code font. */
{
  const LC = ".cm-line.nf-nested-block.HyperMD-codeblock:not(.nf-qcode)";
  const lc = rules.find((r) => r.selectors.some((s) => s.startsWith("body.nf-clean .markdown-source-view.is-live-preview") && s.endsWith(LC)) && declValue(r, "text-indent"));
  const ti = lc ? declValue(lc, "text-indent") : "";
  w3(/var\(--nf-list-ol, 0\) \* \(var\(--nf-list-ol-col\) - var\(--nf-list-col\)\)/.test(ti) && /- var\(--nf-fence-lead, 2ch\)/.test(ti), "list code reads the decoration's lead and ordered flag (defaults: a bullet's 2ch lead)");
  const CH = 8.43, TAB = 36, vars = { "--nf-list-col": "23.2px", "--nf-list-ol-col": "26.9px", "--nf-row-hang": "39.2px", "--nf-list-indent-text": `${TAB}px` };
  const textX = (lead, ol) => {
    const px = lead && lead.replace(/(\d*\.?\d+)ch\b/g, (m, n) => `${n * CH}px`).replace("var(--nf-list-indent-text)", `${TAB}px`);
    const extra = { ...(lead ? { "--nf-fence-lead": px } : {}), ...(ol ? { "--nf-list-ol": "1" } : {}) };
    const indent = calcPx(ti.replace(/(\d*\.?\d+)ch\b/g, (m, n) => `${n * CH}px`), { ...vars, ...extra });
    const ws = lead == null ? 2 * CH : /^\d+ch$/.test(lead) ? parseInt(lead, 10) * CH : TAB;
    return Math.round((39.2 + indent + ws) * 10) / 10;
  };
  w3(ti && textX(null, false) === 39.2, `a bullet's (and a to-do's) code keeps the item column + 16px (${ti && textX(null, false)})`);
  w3(ti && textX("3ch", true) === 42.9 && textX("4ch", true) === 42.9, `"1. " and "10. " code sits on the ordered column + 16px (${ti && textX("3ch", true)}, ${ti && textX("4ch", true)})`);
  w3(ti && textX("var(--nf-list-indent-text)", false) === 39.2, `a tab-indented fence under a bullet keeps the item column + 16px (${ti && textX("var(--nf-list-indent-text)", false)})`);
  const tab = rules.find((r) => r.selectors.some((s) => s.startsWith("body.nf-clean .markdown-source-view.is-live-preview") && s.endsWith(`${LC} .cm-indent`)));
  w3(tab && declValue(tab, "tab-size") === "var(--nf-list-indent-text)" && tab.decls.length === 1, "a list-code row's tab levels take the text font's tab stop, and nothing else about the indent box changes");
  w3(!rules.some((r) => declValue(r, "tab-size") && r.selectors.some((s) => /\.cm-line\.nf-nested-block\.HyperMD-codeblock(:not\(\.nf-qcode\))?$/.test(s))), "the code's own tabs keep their stops (only the .cm-indent boxes change)");
  for (const [name, value] of [["--nf-list-ol-col", "3ch"], ["--nf-list-indent-text", "var(--list-indent)"]]) {
    w3(new RegExp(`@property ${name} \\{\\s*syntax: "<length>";\\s*inherits: true;`).test(css), `${name} is a registered length (an unregistered em/ch would resolve in the code font)`);
    w3(rules.some((r) => r.selectors.includes("body.nf-clean .markdown-source-view.is-live-preview .cm-content") && declValue(r, name) === value), `${name} is computed on .cm-content, in the text font`);
  }
}

/* w2c-col-resizer-focus: a gutter focused by a click (focus() after a
   pointerup that did not drag) is not :focus-visible in Chromium until a
   key is pressed, yet the arrows already resize it. Its accent bar follows
   :focus, and the divided look's resting hairline yields to it. */
{
  const GUTTER = 'body.nf-columns .callout[data-callout="nf-cols"] > .callout-content > .nf-col-resizer';
  const shown = rules.find((r) => r.selectors.includes(`${GUTTER}:focus::before`) && declValue(r, "opacity") === "1");
  const accent = rules.find((r) => r.selectors.includes(`${GUTTER}:focus::before`) && declValue(r, "background-color") === "var(--interactive-accent)");
  w3(shown && accent, "a focused gutter shows its accent bar whether or not the focus is :focus-visible");
  const divided = rules.find((r) => r.selectors.includes('body.nf-columns.nf-lk-cols-divided .callout[data-callout="nf-cols"] > .callout-content > .nf-col-resizer:is(:focus, .is-resizing)::before'));
  w3(divided && declValue(divided, "background-color") === "var(--interactive-accent)" && declValue(divided, "width") === "3px", "under the divided look a focused or dragged gutter still turns into the accent bar (one class above the look's hairline)");
}

/* w2c-canvas-status-ellipsis: the toolbar status takes the room the row
   has (the editing keys ran past a fixed 280px and were cut at "Shift+T…"
   with space to spare), and still shrinks, ellipsizes and never wraps. */
{
  const status = rules.find((r) => r.selectors.includes(".canvas-wrapper.nf-canvas-enhanced .nf-canvas-status") && declValue(r, "max-width"));
  w3(status && declValue(status, "max-width") === "min(480px, 40cqi)", "the canvas status is capped by the pane (40cqi) and 480px, not a fixed 280px");
  w3(status && declValue(status, "min-width") === "0" && /^0 1 /.test(declValue(status, "flex") || "") && declValue(status, "white-space") === "nowrap" && declValue(status, "text-overflow") === "ellipsis", "...and still shrinks first and ends in an ellipsis on one line");
  const bar = rules.find((r) => r.selectors.includes(".canvas-wrapper.nf-canvas-enhanced .nf-canvas-toolbar") && declValue(r, "display") === "flex");
  w3(bar && !declValue(bar, "flex-wrap") && !rules.some((r) => r.selectors.some((x) => x.endsWith(".nf-canvas-toolbar")) && declValue(r, "flex-wrap") && declValue(r, "flex-wrap") !== "nowrap"), "the canvas toolbar stays one row");
}

/* w2c-folded-code-card-in-card: a folded code row outside a quote is the
   card (its ::before), so the caption chip in it loses its own frame and
   fill but keeps its box (the text does not move). In a quote the row's
   ::before is the quote bar and the chip stays the card. */
{
  const CHIP = ".markdown-source-view.is-live-preview .cm-line.nf-caption-line-collapsed:not(.HyperMD-quote) .nf-block-caption.is-code-collapsed";
  const flat = rules.find((r) => r.selectors.includes(CHIP));
  w3(flat && declValue(flat, "border-color") === "transparent" && declValue(flat, "background") === "none", "a folded row's caption chip draws no second frame inside the row's card");
  w3(flat && flat.decls.length === 2, "...and keeps its border width and padding, so the chrome and caption do not move");
  const card = rules.find((r) => r.selectors.includes(".markdown-source-view.is-live-preview .nf-block-caption.is-code-collapsed") && declValue(r, "background"));
  w3(card && /--code-background/.test(declValue(card, "background")) && /solid/.test(declValue(card, "border") || ""), "the chip is still the card where the row is not (a folded block in a quote)");
}

/* lead-canvas-tile-ellipsis: a scheme name in the 3-column style panel
   wraps to two lines and ends in an ellipsis past them (English "Catppuccin
   pastel" was clipped); the tiles in a row stack from the top, so a
   one-line name's miniature stays level with its two-line neighbours'. */
{
  const name = rules.find((r) => r.selectors.includes(".nf-canvas-style-panel .nf-canvas-style-tiles:not(.nf-canvas-layout-tiles) > button.nf-canvas-style-tile:not(.nf-canvas-style-tile-match) > .nf-canvas-style-tile-name"));
  w3(name && declValue(name, "-webkit-line-clamp") === "2" && declValue(name, "display") === "-webkit-box" && declValue(name, "white-space") === "normal" && declValue(name, "overflow") === "hidden", "a scheme tile's name wraps to two lines and clamps with an ellipsis");
  const top = rules.find((r) => r.selectors.includes(".nf-canvas-style-panel button.nf-canvas-style-tile:not(.nf-canvas-style-tile-match)"));
  w3(top && declValue(top, "justify-content") === "flex-start", "scheme tiles stack from the top (Obsidian centres button content, which dropped one-line tiles 8px)");
}

/* editor-hints-css (U1.1–U1.3): the empty slash menu's group labels ride in
   their row's top margin (out of flow, click-through), chips are tinted
   for exactly four groups, column sections read as labels, descriptions
   cannot widen the menu, and a typed block's placeholder is its
   data-nf-hint, never on a Callout edit row. */
{
  const label = rules.find((r) => r.selectors.some((s) => s.endsWith(".nf-slash-item > .nf-slash-group")));
  w3(label && declValue(label, "position") === "absolute" && declValue(label, "pointer-events") === "none" && declValue(label, "bottom") === "100%", "a group label sits out of flow above its row and lets clicks through");
  const rows = rules.filter((r) => r.selectors.some((s) => /\.nf-slash-item(\.nf-slash-has-group|:has\(> \.nf-slash-group\))(:first-child)?$/.test(s)));
  w3(rows.length >= 2 && rows.every((r) => declValue(r, "margin-top") && !declValue(r, "padding-top") && !declValue(r, "padding") && !declValue(r, "padding-block")), "a labelled row makes room with a top MARGIN, never padding (padding would put the label inside the selected highlight)");
  w3(rows.every((r) => declValue(r, "scroll-margin-top")), "arrowing up to a labelled row scrolls its label into view too");
  const main = resolve(root, "src/main.ts");
  if (existsSync(main)) {
    const src = readFileSync(main, "utf8");
    if (rows.some((r) => r.selectors.some((s) => s.includes(".nf-slash-has-group")))) w3(src.includes('el.addClass("nf-slash-has-group")'), "main.ts still marks a labelled slash row .nf-slash-has-group");
    w3(src.includes('cls: "nf-slash-group"') && /iconEl\.dataset\.nfGroup = /.test(src) && /icon\.dataset\.nfGroup = /.test(src) && src.includes('"nf-slash-desc nf-slash-preview"'), "main.ts still emits the group label, data-nf-group on both menus' icons, and the date preview class");
  } else console.log("SKIP (no src/main.ts): slash-menu class cross-check");
  const TINTS = { list: "--color-blue", media: "--color-green", container: "--color-orange", date: "--color-purple" };
  const tinted = {};
  for (const r of rules) {
    const v = declValue(r, "--nf-slash-tint");
    if (!v) continue;
    for (const s of r.selectors) {
      const g = /\[data-nf-group="([a-z]+)"\]$/.exec(s)?.[1];
      if (g) tinted[g] = v;
    }
  }
  w3(JSON.stringify(Object.keys(tinted).sort()) === JSON.stringify(Object.keys(TINTS).sort()), `exactly list, media, container and date are tinted (got ${Object.keys(tinted).join(", ")})`);
  for (const [g, token] of Object.entries(TINTS)) w3(tinted[g] === `var(${token})`, `the ${g} chips take ${token}`);
  w3(!rules.some((r) => r.selectors.some((s) => /data-nf-group="(basic|advanced|template)"/.test(s))), "basic, advanced and template chips stay neutral (no rule names them)");
  const chip = rules.find((r) => declValue(r, "--nf-slash-ink"));
  w3(chip && chip.selectors.some((s) => s.startsWith(".nf-slash-icon:is(")) && chip.selectors.some((s) => s.startsWith(".nf-slash-item:is(")), "the tint paints the chip from the row (main menu) and from the icon alone (column completion)");
  const section = rules.find((r) => r.selectors.some((s) => s.endsWith(".nf-column-slash > ul > completion-section")));
  w3(section && declValue(section, "display") === "block" && declValue(section, "border") === "0" && declValue(section, "opacity") === "1", "the column completion's sections read as labels (no list-item, silver rule or 0.7 fade)");
  const desc = rules.find((r) => r.selectors.includes(".nf-slash-item .nf-slash-desc"));
  w3(desc && /^\d+px$/.test(declValue(desc, "max-width") || "") && parseInt(declValue(desc, "max-width"), 10) <= 256, "a slash description is capped, so a date preview never widens the shrink-to-fit menu past ~380px");
  const HINT = ".nf-empty-hint[data-nf-hint]";
  const content = rules.filter((r) => declValue(r, "content") === "attr(data-nf-hint)");
  w3(content.length === 1 && content[0].selectors.every((s) => s.includes(HINT) && s.includes(":not(.nf-co-edit)") && s.endsWith("::after")), "a typed block's placeholder is its data-nf-hint, drawn after the line and never on a Callout edit row");
  w3(content.length === 1 && !declValue(content[0], "font-size") && !declValue(content[0], "font-weight"), "the placeholder takes its row's own font (a heading's is heading-sized)");
  const unguarded = rules.flatMap((r) => r.selectors).filter((s) => s.includes("[data-nf-hint]") && s.endsWith("::after") && !s.includes(":not(.nf-co-edit)"));
  w3(unguarded.length === 0, `every [data-nf-hint]::after rule spares the Callout card (its ::after): ${unguarded.join(" | ")}`);
  w3(!rules.some((r) => r.decls.some((d) => /^--font-text-size:.*var\(--font-text-size/.test(d))), "no --font-text-size declaration reads itself (a cycle voids the text size)");
  if (existsSync(main)) w3(readFileSync(main, "utf8").includes('"data-nf-hint": label'), "main.ts still puts the placeholder text in data-nf-hint");
}

/* review2-css-w2-1 (c): a Callout that closes a toggle closes no box for
   it (the toggle renders none); with a Callout box around the toggle, that
   box is the parent layer and keeps its closing edge. main.ts publishes
   --nf-co-boxes on every row, so the air counts boxes, not depth. */
{
  const LAST = ".cm-line.nf-co-edit.nf-co-nested.nf-co-last.nf-co-parent-toggle:not(.nf-co-toggle):not(:has(+ .cm-line:is(.nf-co-edit, .nf-co-code)))::before";
  const edge = rules.find((r) => r.selectors.some((s) => s.endsWith(LAST)));
  w3(edge && calcPx(declValue(edge, "border-block-end-width"), { "--nf-co-parent-is-box": 0 }) === 0 && calcPx(declValue(edge, "border-end-start-radius"), { "--nf-co-parent-is-box": 0 }) === 0 && calcPx(declValue(edge, "border-end-end-radius"), { "--nf-co-parent-is-box": 0 }) === 0, "a Callout closing a toggle draws no bottom edge or radii for the toggle");
  w3(edge && calcPx(declValue(edge, "border-block-end-width"), { "--nf-co-parent-is-box": 1 }) === 1, "...but a Callout box around the toggle still closes on that row");
  const general = rules.findIndex((r) => r.selectors.some((s) => s.endsWith(".cm-line.nf-co-edit.nf-co-nested.nf-co-last:not(.nf-co-toggle):not(:has(+ .cm-line:is(.nf-co-edit, .nf-co-code)))::before")) && /solid/.test(declValue(r, "border-block-end") || ""));
  w3(general >= 0 && rules.indexOf(edge) > general, "the toggle exception comes after the nested last-row edge it narrows");
  const main = resolve(root, "src/main.ts");
  if (existsSync(main)) w3(readFileSync(main, "utf8").includes("`--nf-co-boxes:${"), "main.ts publishes --nf-co-boxes on the edit rows (the air rules count boxes with it)");
}

/* w2c-qlist-lead-css: a quoted bullet's lead (marker + spaces) is floored at
   the list column after the editing indent, as the rendered <li> places its
   text; to-do rows keep the natural lead (their checkbox has its own
   measured column), and ordered rows stay on 3ch. */
{
  const LEAD = "body.nf-clean .markdown-source-view.is-live-preview .cm-line.nf-qlist-ul:not(.nf-qlist-task) .nf-qlist-lead";
  const lead = rules.find((r) => r.selectors.includes(LEAD));
  w3(lead && declValue(lead, "display") === "inline-block" && declValue(lead, "box-sizing") === "border-box" && declValue(lead, "min-width") === "var(--nf-list-col)", "a quoted bullet's lead is floored at the list column (its text sat 13.8px left of the rendered item)");
  w3(lead && /--list-indent-editing/.test(declValue(lead, "padding-inline-start") || "") && declValue(lead, "white-space") === "pre" && declValue(lead, "text-indent") === "0", "...after the editing indent, keeping its spaces and no inherited hang");
  w3(!rules.some((r) => declValue(r, "min-width") && r.selectors.some((s) => s.includes(".nf-qlist-lead") && !s.includes(":not(.nf-qlist-task)"))), "no floor reaches a quoted to-do's lead (its checkbox would move 13.8px)");
  const main = resolve(root, "src/main.ts");
  if (existsSync(main)) {
    const src = readFileSync(main, "utf8");
    w3(src.includes('class: "nf-qlist-lead"') && src.includes('" nf-qlist-task"') && src.includes('"nf-qlist nf-qlist-ul"'), "main.ts still emits the quoted-list lead, the bullet row and the to-do row classes");
  } else console.log("SKIP (no src/main.ts): quoted-list class cross-check");
}

/* w2c-toc-chip-css: the resting TOC marker is a quiet label that keeps its
   row a body line tall, with a ghost refresh button that out-ranks
   Obsidian's button rules and draws its own focus ring. */
{
  const chip = rules.find((r) => r.selectors.some((s) => s.endsWith(".cm-line .nf-toc-chip")));
  w3(chip && declValue(chip, "display") === "inline-flex" && declValue(chip, "line-height") === "1" && declValue(chip, "color") === "var(--text-muted)" && declValue(chip, "font-size") === "var(--font-ui-small)", "the TOC chip is a muted, small, line-height 1 label (it grew its row by 5px)");
  const BTN = ".nf-toc-chip button.nf-toc-chip-refresh";
  const btn = rules.find((r) => r.selectors.some((s) => s.endsWith(BTN)));
  w3(btn && declValue(btn, "height") === "auto" && declValue(btn, "box-shadow") === "none" && declValue(btn, "background-color") === "transparent", "the refresh button drops Obsidian's 30px filled button box");
  w3(btn && btn.selectors.every((s) => (s.match(/\./g) || []).length >= 3), "the refresh button's selector out-ranks button:not(.clickable-icon) (0,1,1)");
  const hover = rules.find((r) => r.selectors.some((s) => s.endsWith(`${BTN}:hover`)));
  w3(hover && declValue(hover, "background-color") === "var(--background-modifier-hover)" && declValue(hover, "box-shadow") === "none", "the refresh button's hover is a quiet wash, not Obsidian's raised button");
  const focus = rules.find((r) => r.selectors.some((s) => s.endsWith(`${BTN}:focus-visible`)));
  w3(focus && /^2px solid /.test(declValue(focus, "outline") || ""), "the refresh button draws its own focus ring (box-shadow: none cleared Obsidian's)");
  const still = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([^{}]*\{[^{}]*\}\s*)+\}/g)].map((m) => m[0]);
  w3(still.some((block) => block.includes(BTN) && /transition: none/.test(block)), "the refresh button's transition stops under reduced motion");
  const main = resolve(root, "src/main.ts");
  if (existsSync(main)) {
    const src = readFileSync(main, "utf8");
    w3(["nf-toc-chip", "nf-toc-chip-icon", "nf-toc-chip-label", "nf-toc-chip-refresh"].every((c) => src.includes(`className = "${c}"`)), "main.ts still builds the TOC chip from these classes");
  } else console.log("SKIP (no src/main.ts): TOC chip class cross-check");
}

/* image-align-css (U1.10): an image's alt word aligns its ROW in Live
   Preview (the embed stays inline, so CodeMirror measures the same height)
   and its <p> in Reading view; the caption follows; list and quote rows
   stay put in both views; the native corner drag wears the corner cursor. */
{
  const ALIGN = { center: "center", right: "end", left: "start" };
  const forms = (w) => [`[alt~="${w}"]`, `[alt^="${w}|"]`, `[alt$="|${w}"]`, `[alt*="|${w}|"]`, `[alt*="|${w} "]`, `[alt*=" ${w}|"]`];
  for (const [word, value] of Object.entries(ALIGN)) {
    const own = rules.filter((r) => declValue(r, "text-align") === value && r.selectors.some((s) => s.includes(`[alt~="${word}"]`)));
    w3(own.length === 1, `one text-align: ${value} rule for the "${word}" alt word (${own.length})`);
    const r = own[0];
    if (!r) continue;
    const lp = r.selectors.filter((s) => s.includes(".markdown-source-view.is-live-preview"));
    const rv = r.selectors.filter((s) => s.includes(".markdown-rendered"));
    w3(lp.some((s) => / \.cm-line:not\(\.HyperMD-list-line\):not\(\.HyperMD-quote\):has\(> \.image-embed img:is\(/.test(s) && !s.includes("+")), `Live Preview aligns a "${word}" image's row, never a list or quote row (their marker would move)`);
    w3(lp.some((s) => s.endsWith("+ .cm-line.nf-caption-line-image")), `the caption row under a "${word}" image follows it`);
    w3(rv.length === 1 && rv[0].includes("p:not(li p, blockquote p):has(> .image-embed > img:is(") && rv[0].includes(", > img:is("), `Reading view aligns a "${word}" image's <p> (wikilink and Markdown images), not one in a list or quote`);
    for (const s of r.selectors) w3(forms(word).every((f) => s.split(f).length - 1 >= 1), `the "${word}" selector accepts the word between spaces, pipes or the ends, as imageAlignOf does: ${s.slice(0, 60)}…`);
    w3(r.selectors.every((s) => s.startsWith("body.nf-clean ")), `"${word}" alignment belongs to clean rendering`);
  }
  const MARGIN = { center: "auto", right: "auto 0", left: "0 auto" };
  for (const [word, value] of Object.entries(MARGIN)) {
    w3(rules.some((r) => declValue(r, "margin-inline") === value && r.selectors.length === 1 && r.selectors[0].includes(`[alt~="${word}"]`) && r.selectors[0].endsWith(") img") && r.selectors[0].includes("p:not(li p, blockquote p)")), `a captioned (block) "${word}" image in Reading view is placed by margin-inline: ${value}`);
  }
  w3(!rules.some((r) => declValue(r, "display") === "block" && r.selectors.some((s) => s.includes(".markdown-source-view") && /\.image-embed$/.test(s))), "no Live Preview .image-embed turns block (its widget buffers would each add a line)");
  const edge = rules.findIndex((r) => r.selectors.includes(".nf-image-resizing img") && declValue(r, "cursor") === "ew-resize");
  const corner = rules.findIndex((r) => declValue(r, "cursor") === "nwse-resize" && r.selectors.some((s) => /^\.image-embed\.nf-image-resizing:is\(\.is-corner, :has\(\.image-resize-corner:active\)\)$/.test(s)) && r.selectors.some((s) => s.endsWith(":active)) img")));
  w3(corner >= 0 && corner > edge && edge >= 0, "a native corner drag shows the corner's nwse-resize cursor on the embed and its img, after the edge drag's ew-resize");
  const main = resolve(root, "src/main.ts");
  if (existsSync(main)) {
    const src = readFileSync(main, "utf8");
    w3(src.includes('embed.classList.add("nf-image-resizing", "is-corner")'), "main.ts still marks a native corner drag with nf-image-resizing + is-corner");
    w3(src.includes('const IMAGE_ALIGNS: readonly string[] = ["left", "center", "right"]'), "main.ts still writes the left / center / right alt words");
    w3(/rowAlign === "right" \|\| rowAlign === "end"/.test(src) && /rowAlign === "center"/.test(src), "the edge drag reads the row's text-align as this sheet writes it (end for right)");
  } else console.log("SKIP (no src/main.ts): image alignment cross-check");
}

/* settings-and-toolbar-polish-css (U1.11): Settings stays native 1.13
   groups; a dimmed row's "Needs …" chip is a legible pill and nothing else
   shows it; hidden rows leave no stray divider; disclosures ring on focus;
   the STYLEUI dots and preview card keep their shape. */
{
  const main = resolve(root, "src/main.ts");
  const src = existsSync(main) ? readFileSync(main, "utf8") : null;
  if (src) {
    w3(src.includes('setting.nameEl.createSpan({ cls: "nf-setting-needs"') && src.includes('toggleClass("nf-setting-dependent", state === "dim")') && src.includes("row.needsEl?.toggle(state === \"dim\")"), "main.ts still puts the Needs chip in the row name and shows it exactly while the row is dimmed");
    w3(!src.includes("nf-setting-subheading") && !rules.some((r) => r.selectors.some((s) => s.includes("nf-setting-subheading"))), "no sub-heading class is emitted, and none is styled (every heading opens its own group)");
  } else console.log("SKIP (no src/main.ts): settings class cross-check");
  const chip = rules.find((r) => r.selectors.includes(".nf-settings .setting-item-name .nf-setting-needs"));
  w3(chip && declValue(chip, "display") === "inline-block" && declValue(chip, "border-radius") === "999px" && declValue(chip, "background-color") === "var(--background-modifier-hover)" && declValue(chip, "color") === "var(--text-muted)" && declValue(chip, "white-space") === "nowrap", "the Needs chip is a muted, one-line pill");
  w3(rules.some((r) => r.selectors.includes(".nf-settings .setting-item:not(.nf-setting-dependent) .nf-setting-needs") && declValue(r, "display") === "none"), "only a dimmed row shows its Needs chip");
  w3(!rules.some((r) => declValue(r, "opacity") && r.selectors.some((s) => /\.nf-setting-dependent$/.test(s))), "a dimmed row fades its parts, not itself (opacity on the row would fade the chip that explains it)");
  w3(rules.some((r) => r.selectors.includes(".nf-settings .nf-setting-dependent .setting-item-name") && /^color-mix\(in srgb, var\(--text-normal\) 55%, transparent\)$/.test(declValue(r, "color") || "")) && rules.some((r) => r.selectors.includes(".nf-settings .nf-setting-dependent :is(.setting-item-description, .setting-item-control)") && declValue(r, "opacity") === "0.55"), "...its name at 55% ink, its description and control at 55% opacity");
  const VISIBLE = ':not([style*="display: none"])';
  w3(rules.some((r) => r.selectors.some((s) => s.startsWith(".nf-settings .setting-group .setting-items > .setting-item:not(.setting-item-heading)") && s.endsWith(`:nth-child(1 of ${VISIBLE})::before`)) && declValue(r, "content") === "none"), "a card whose first rows are hidden opens without a divider");
  w3(rules.some((r) => r.selectors.some((s) => s.endsWith(`:nth-last-child(1 of ${VISIBLE})`)) && declValue(r, "border-bottom-left-radius") === "var(--setting-items-radius)"), "...and closes on its last visible row's rounded corners");
  w3(rules.some((r) => r.selectors.some((s) => /:is\(\.nf-setting-details, \.nf-style-custom\) > summary:focus-visible$/.test(s)) && /^2px solid /.test(declValue(r, "outline") || "")), "the Details / Customize summaries ring on keyboard focus");
  const dot = rules.find((r) => r.selectors.includes(".nf-setting-dot") && declValue(r, "width"));
  w3(dot && declValue(dot, "width") === "14px" && declValue(dot, "height") === "14px" && declValue(dot, "border-radius") === "50%", "a colour dot is a 14px disc");
  w3(rules.some((r) => r.selectors.includes(".nf-setting-dot.is-none") && /dashed/.test(declValue(r, "border") || "")), "the 'none' dot is dashed");
  const preview = rules.find((r) => r.selectors.includes(".nf-settings .markdown-reading-view.nf-settings-preview"));
  w3(preview && declValue(preview, "pointer-events") === "none" && declValue(preview, "max-height") && declValue(preview, "overflow") === "hidden", "the preview card is clipped and inert");
}

/* U1.12: every fixed code theme's token lists name its own gallery card,
   without the body class (the card shows its theme whatever is active);
   the dark twin names the .theme-dark card. */
{
  let light = 0, dark = 0;
  for (const r of rules) {
    for (const s of r.selectors) {
      let m = /^body\.nf-code-theme-([a-z-]+) \.markdown-source-view$/.exec(s);
      if (m) { light++; w3(r.selectors.includes(`.nf-code-sample[data-code-theme="${m[1]}"]`), `the ${m[1]} card takes the ${m[1]} code tokens`); }
      m = /^body\.theme-dark\.nf-code-theme-([a-z-]+) \.markdown-source-view$/.exec(s);
      if (m) { dark++; w3(r.selectors.includes(`.theme-dark .nf-code-sample[data-code-theme="${m[1]}"]`), `the ${m[1]} card takes the dark ${m[1]} tokens in dark mode`); }
    }
  }
  w3(light >= 10 && dark >= 6, `every code-theme list was checked (${light} light, ${dark} dark)`);
  w3(!rules.some((r) => r.selectors.some((s) => /body\.nf-code-theme-[a-z-]+ \.nf-code-sample/.test(s))), "no card selector waits for its body class");
  const presets = resolve(root, "src/features/style-presets.ts");
  if (existsSync(presets)) {
    const src = readFileSync(presets, "utf8");
    const at = src.indexOf("export const CODE_THEME_IDS");
    const ids = [...src.slice(at, src.indexOf("]", at)).matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).filter((id) => id !== "default");
    w3(ids.length === 10, `CODE_THEME_IDS parsed (${ids.length} fixed themes)`);
    for (const id of ids) w3(rules.some((r) => r.selectors.includes(`.nf-code-sample[data-code-theme="${id}"]`) && declValue(r, "--code-keyword")), `the ${id} gallery card has token colours`);
  } else console.log("SKIP (no src/features/style-presets.ts): code-card id cross-check");
}

/* U1.13: the palette row marks the current colour with an accent check
   badge (never the old halo), the Last-used chip's separator costs no
   width, and the Text / Highlight buttons stay neutral with a legible bar. */
{
  const badge = rules.find((r) => r.selectors.includes(".nf-toolbar button.nf-swatch.is-active::before") && declValue(r, "background-color"));
  w3(badge && declValue(badge, "background-color") === "var(--interactive-accent)" && declValue(badge, "border-radius") === "50%", "the current swatch wears an accent badge");
  const box = rules.find((r) => r.selectors.includes(".nf-toolbar button.nf-swatch.is-active::before") && r.selectors.includes(".nf-toolbar button.nf-swatch.is-active::after"));
  w3(box && declValue(box, "width") === "12px" && declValue(box, "height") === "12px" && declValue(box, "top") === "-4px" && declValue(box, "pointer-events") === "none", "the badge is 12px and overhangs by 4px, inside the palette row's 4px top padding");
  w3(rules.some((r) => r.selectors.includes(".nf-toolbar button.nf-swatch.is-active::after") && /mask: url\("data:image\/svg\+xml/.test(r.body) && declValue(r, "background-color") === "var(--text-on-accent)"), "the badge carries a check in the accent's own ink");
  const active = rules.filter((r) => r.selectors.includes(".nf-toolbar button.nf-swatch.is-active"));
  w3(active.length === 1 && !/0 0 0 2px hsla\(/.test(active[0].body) && declValue(active[0], "border-color") === "var(--background-modifier-border)", "the current swatch has no halo ring (it read as hover)");
  w3(rules.some((r) => r.selectors.includes(".nf-swatch") && declValue(r, "position") === "relative"), "a swatch positions its badge");
  const pseudo = rules.flatMap((r) => r.selectors).filter((s) => /\.nf-swatch[\w.:()-]*::?(before|after)$/.test(s) && !s.startsWith(".nf-toolbar button.nf-swatch.is-active::"));
  w3(pseudo.length === 0, `no other swatch rule uses the badge's pseudo-elements: ${pseudo.join(" | ")}`);
  w3(rules.some((r) => r.selectors.some((s) => s.includes(".nf-color-btn.is-active")) && declValue(r, "color") === "var(--text-normal)"), "an active Text / Highlight button keeps a neutral icon");
  w3(rules.some((r) => r.selectors.some((s) => s.endsWith(".nf-color-btn:has(svg.lucide-highlighter)::after")) && declValue(r, "height") === "4px"), "the highlight bar is 4px of stacked wash");
  w3(!rules.some((r) => r.selectors.some((s) => /\.nf-toolbar-palette\s*>?\s*\.nf-toolbar-sep$/.test(s)) && declValue(r, "display") === "none"), "the Last-used separator is never hidden");
  w3(rules.some((r) => r.selectors.includes(".nf-toolbar-palette > .nf-toolbar-sep") && declValue(r, "margin-inline") === "0"), "the Last-used separator adds no width (the row gap spaces it)");
  const main = resolve(root, "src/main.ts");
  if (existsSync(main)) {
    const src = readFileSync(main, "utf8");
    const last = src.indexOf('cls: "nf-swatch nf-swatch-last"');
    w3(last >= 0 && src.indexOf('this.palRow.createDiv({ cls: "nf-toolbar-sep" })', last) - last < 1200, "main.ts puts a separator right after the Last-used chip");
    w3(src.includes('this.colorBtn.addClass("nf-color-btn")') && src.includes('this.bgBtn.addClass("nf-color-btn")') && src.includes('"highlighter", t("Highlight color")'), "main.ts marks both colour buttons, the highlight one with the highlighter icon");
  } else console.log("SKIP (no src/main.ts): toolbar class cross-check");
}

/* main-css-requests (R2-W3-MAIN, stage A): a Callout's edit-row title keeps
   the rendered title's weight and tracking (it thinned and drifted 3.4px
   along its length on entry); the tinted-quote look washes a quote nested
   in a list from its bar, not across the list's marker gutter. */
{
  const rendered = rules.find((r) => r.selectors.some((s) => s.endsWith('.callout:not([data-callout="nf-cols"]):not([data-callout="nf-col"]):not([data-callout="nf-toggle"]) > .callout-title .callout-title-inner')) && declValue(r, "font-weight"));
  const edit = rules.find((r) => r.selectors.includes("body.nf-callout-menu .markdown-source-view.is-live-preview .cm-line.nf-co-first:not(.nf-co-toggle):not(.nf-co-meta) span.cm-quote"));
  w3(rendered && edit && declValue(edit, "font-weight") === declValue(rendered, "font-weight") && declValue(edit, "letter-spacing") === declValue(rendered, "letter-spacing"), `the edit title matches the rendered title (${edit && declValue(edit, "font-weight")} / ${rendered && declValue(rendered, "font-weight")})`);
  const def = rules.find((r) => r.selectors.includes("body.nf-callout-menu .markdown-source-view.is-live-preview .nf-visual-callout-default-title"));
  w3(def && rendered && declValue(def, "font-weight") === declValue(rendered, "font-weight"), "an untitled Callout's default title under edit has the rendered weight too");
  const NQ = ".cm-line.nf-nested-quote.HyperMD-quote:not(.HyperMD-callout):not(.nf-co-edit):not(.nf-inline-list-quote):not(.nf-blk-bg)";
  const base = rules.find((r) => r.selectors.length === 1 && r.selectors[0].startsWith("body.nf-clean.nf-lk-q-tint ") && r.selectors[0].endsWith(NQ));
  const bar = rules.find((r) => r.selectors.includes(".markdown-source-view.is-live-preview .cm-line.nf-nested-quote::before"));
  w3(base && bar && declValue(base, "--nf-nq-tint-at") === declValue(bar, "inset-inline-start").replace(/\s*!important$/, ""), "the nested quote's wash starts where its bar is drawn");
  w3(base && declValue(base, "background-color") === "transparent" && declValue(base, "border-image-slice") === "0 fill" && declValue(base, "border-image-width") === "0" && /transparent max\(var\(--nf-nq-tint-at\), 0px\), var\(--nf-quote-wash\) max\(var\(--nf-nq-tint-at\), 0px\)/.test(declValue(base, "border-image-source") || ""), "the nested wash is one border-image fill, clear over the marker gutter");
  w3(base && /max\(calc\(-1 \* var\(--nf-nq-tint-at\)\), 0px\)$/.test(declValue(base, "border-image-outset") || ""), "...reaching left of a continuation row whose box is shifted past its bar");
  const up = rules.find((r) => r.selectors.some((s) => s.endsWith(`+ ${NQ}`) && s.includes("nf-lk-q-tint")));
  const down = rules.find((r) => r.selectors.some((s) => s.endsWith(`${NQ}:has(+ .cm-line:not(.HyperMD-quote))`) && s.includes("nf-lk-q-tint")));
  w3(up && declValue(up, "--nf-nq-up") === "0.25em" && declValue(up, "box-shadow") === "none" && down && declValue(down, "--nf-nq-down") === "0.25em" && declValue(down, "box-shadow") === "none", "the first and last nested rows breathe 0.25em through the outset, not the top-level quote's full-width shadows");
  w3(rules.filter((r) => declValue(r, "--nf-nq-tint-at")).length === 1 && !rules.some((r) => declValue(r, "--nf-quote-inset") && r.selectors.some((s) => s.includes("nf-nested-quote"))), "the wash offset has its own name (--nf-quote-inset is a layout term: reusing it moved the text 4px)");
}

/* ---- R2-W3-FIXCSS ---- */
/* fixcss-nested-callout-code-light: in light mode a code card on a Callout's
   tint is lifted toward white and edged with a hairline in its own ink (the
   GitHub card, #f6f8fa, vanished on a nested Callout's tint). Light cards
   only, so a fixed-dark palette keeps its card; toggles and columns have no
   tint; top-level code and dark mode never match. The edit rows draw the
   same card, so entering the Callout does not change it. */
{
  const ON_TINT = '.callout:not([data-callout="nf-toggle"], [data-callout="nf-cols"], [data-callout="nf-col"]) pre';
  const ROWS = ".markdown-source-view.is-live-preview .cm-line.nf-co-code.nf-qcode";
  const vars = rules.find((r) => declValue(r, "--nf-co-card-bg"));
  w3(vars && vars.selectors.some((s) => s.endsWith(ON_TINT)) && vars.selectors.some((s) => s.endsWith(ROWS)), "one rule defines the lifted card for rendered <pre>s and edit rows on a tint");
  const bg = vars && declValue(vars, "--nf-co-card-bg");
  w3(bg && /^oklch\( from var\(--code-background\) calc\(l \+ \(1 - l\) \* 0\.6 \* var\(--nf-co-card-on-tint\) \* clamp\(0, \(l - 0\.7\) \* 1000, 1\)\) c h \)$/.test(bg), `the card is lifted 60% toward white, light cards only (got ${bg})`);
  w3(vars && /^color-mix\( in srgb, var\(--code-normal\) calc\(var\(--nf-co-card-on-tint\) \* 10%\), transparent \)$/.test(declValue(vars, "--nf-co-card-edge") || ""), "the hairline is 10% of the card's own ink");
  w3(vars && declValue(vars, "--nf-co-card-on-tint") === "1", "a card on a tint is fully lifted");
  w3(rules.some((r) => r.selectors.some((s) => s.endsWith(`${ROWS}.nf-co-toggle-code`)) && declValue(r, "--nf-co-card-on-tint") === "min(1, var(--nf-co-toggle-boxes, 0))"), "a toggle's code rows lift only when a Callout box is around the toggle");
  const paint = rules.filter((r) => r.decls.some((d) => /var\(--nf-co-card-(bg|edge)\)/.test(d)));
  const sels = [...new Set(paint.flatMap((r) => r.selectors).concat(vars ? vars.selectors : []))];
  w3(sels.length >= 5 && sels.every((s) => s.startsWith("body:not(.theme-dark)")), `the lifted card is light-mode only: ${sels.filter((s) => !s.startsWith("body:not(.theme-dark)")).join(" | ")}`);
  w3(sels.every((s) => s.endsWith(ON_TINT) || s.includes(".nf-co-code.nf-q")), "no top-level <pre> or code row is repainted");
  const pre = paint.find((r) => r.selectors.some((s) => s.endsWith(ON_TINT)) && declValue(r, "background-color"));
  w3(pre && declValue(pre, "background-color") === "var(--nf-co-card-bg)" && declValue(pre, "box-shadow") === "inset 0 0 0 1px var(--nf-co-card-edge)", "a rendered <pre> on a tint takes the card and an inset hairline (no layout)");
  const row = (tail) => paint.find((r) => r.selectors.some((s) => s.endsWith(tail)));
  const sides = row(".cm-line.nf-co-code.nf-qcode::after");
  w3(sides && declValue(sides, "background") === "var(--nf-co-card-bg)" && declValue(sides, "border-inline") === "1px solid var(--nf-co-card-edge)", "every edit row paints the card and its side edges");
  w3(declValue(row(".cm-line.nf-co-code.nf-qcode-begin::after") ?? { decls: [] }, "border-block-start") === "1px solid var(--nf-co-card-edge)" && declValue(row(".cm-line.nf-co-code.nf-qcode-end::after") ?? { decls: [] }, "border-block-end") === "1px solid var(--nf-co-card-edge)", "the opener row draws the top edge and the closer row the bottom edge");
}

/* fixcss-reading-code-header: in Reading view a captioned code block has no
   header strip (it held only the chevron). The chevron sits in a gutter
   beside the first code row, centred on the <pre>'s own line box, and a
   folded bar is one empty row tall, so the chevron neither covers a glyph
   nor moves when the block folds. Live Preview keeps the strip: a rendered
   Callout's code does not move when the caret enters it. */
{
  w3(/@property --nf-code-row \{\s*syntax: "<length>";\s*inherits: true;\s*initial-value: 21px;\s*\}/.test(css), "the row height is a registered length (resolved on the <pre>, not in the button's font)");
  w3(rulesWith(/^\.markdown-reading-view pre\.nf-captioned-code$/).some((r) => declValue(r, "--nf-code-row") === "1lh"), "the row height is the <pre>'s own line box");
  const base = rulesWith(/^pre\.nf-captioned-code > \.nf-rendered-code-fold$/).find((r) => declValue(r, "inset-inline-start"));
  const fold = rulesWith(/^\.markdown-reading-view pre\.nf-captioned-code > \.nf-rendered-code-fold$/).find((r) => declValue(r, "inset-block-start"));
  const open = rulesWith(/^\.markdown-reading-view pre\.nf-captioned-code:not\(\.nf-rendered-code-collapsed\)$/).find((r) => declValue(r, "padding-inline-start"));
  const bar = rulesWith(/^\.markdown-reading-view pre\.nf-captioned-code\.nf-rendered-code-collapsed$/).find((r) => declValue(r, "min-height"));
  w3(base && fold && open && bar, "the Reading gutter, the open padding and the folded bar are declared");
  if (base && fold && open && bar) {
    const left = calcPx(declValue(base, "inset-inline-start"), {});
    w3(calcPx(declValue(open, "padding-inline-start"), {}) >= left + 18 + 5, "the code's text column clears the chevron with air to spare");
    w3(calcPx(declValue(open, "padding-block-start"), {}) === 12, "an open block keeps Obsidian's 12px top padding (no strip)");
    for (const row of [21, 24, 27.2, 30]) {
      const vars = { "--nf-code-row": `${row}px` };
      const top = calcPx(declValue(fold, "inset-block-start"), vars);
      w3(Math.abs(top + 9 - (12 + row / 2)) < 0.05, `the chevron is centred on a ${row}px first row`);
      w3(Math.abs(calcPx(declValue(bar, "min-height"), vars) / 2 - (top + 9)) < 0.05, `a folded bar centres the chevron where the open block had it (${row}px rows)`);
    }
  }
  w3(!rules.some((r) => r.selectors.some((s) => /\.markdown-source-view[^,]*pre\.nf-captioned-code/.test(s)) && (declValue(r, "padding-block-start") || declValue(r, "padding-inline-start"))), "Live Preview's rendered Callouts keep the strip");
}

/* fixcss-main-css-requests-rest (MAIN's conditional C3 request): a tinted
   paragraph inside a Callout being edited keeps its tint. The row is
   isolated and its card is its own ::after, so the tint is painted as
   extra layers of that card, one content inset left and one end inset
   right of the text (the card's own edges), pad past the text, rounded
   like Reading's; a blank neighbour row draws the pad the paragraph's own
   row has no room for. Never on the minimal look (its thread is that
   layer's background), never on a title, quote, list or toggle row, and it
   never changes a row's size. */
{
  const EX = ":not(.nf-co-first, .nf-co-quote, .nf-qlist, .nf-co-toggle, .nf-co-parent-toggle, .nf-co-meta, .HyperMD-header)";
  const co = rules.filter((r) => r.selectors.some((s) => s.includes(".cm-line.nf-co-edit.nf-blk-bg")));
  w3(co.length >= 7, `the Callout edit-row tint rules exist (${co.length})`);
  for (const r of co) for (const s of r.selectors) {
    w3(s.startsWith("body.nf-callout-menu:not(.nf-callout-minimal) .markdown-source-view.is-live-preview"), `a Callout tint rule skips the minimal look: ${s}`);
    w3(s.includes(EX) || s.includes(`:not(.nf-co-last, ${EX.slice(5)}`), `a Callout tint rule is for paragraph rows only: ${s}`);
  }
  w3(co.every((r) => !r.decls.some((d) => /^(margin|padding|height|min-height|max-height|inset|border)/.test(d))), "the Callout tint never changes a row's size or its card's edges");
  const vars = co.find((r) => declValue(r, "--nf-blk-l") && r.selectors.every((s) => !s.includes("::after")));
  const TINT = "color-mix(in srgb, rgb(var(--nf-blk-rgb)) calc(var(--nf-a-blk) * 100%), var(--background-primary))";
  w3(vars && declValue(vars, "--nf-blk-tint") === TINT, "the Callout tint is the same opaque mix as every other block tint");
  const paint = co.find((r) => r.selectors.some((s) => s.endsWith(`.cm-line.nf-co-edit.nf-blk-bg${EX}::after`)) && declValue(r, "background-image"));
  w3(paint && splitTop(declValue(paint, "background-image")).length === 7 && splitTop(declValue(paint, "background-position")).length === 7 && splitTop(declValue(paint, "background-size")).length === 7 && declValue(paint, "background-repeat") === "no-repeat", "the tint is seven layers of the card (four corners, two bands, the body), never its shorthand");
  if (vars) {
    const V = { "--nf-co-inset": "39px", "--nf-co-code-end": "15px", "--nf-blk-pad": "4px" };
    /* The card starts one content inset left of the text and ends one end
       inset right of it; layers sit in its padding box (1px edges). */
    const l = calcPx(declValue(vars, "--nf-blk-l"), V), r = calcPx(declValue(vars, "--nf-blk-r"), V);
    w3(1 + l === 39 - 4 && 1 + r === 15 - 4, `the tint reaches the pad past the text on both sides (l ${l}, r ${r})`);
  }
  const first = co.find((r) => r.selectors.some((s) => s.includes(".nf-blk-first") && !s.includes("+")) && declValue(r, "--nf-blk-t"));
  w3(first && /var\(--nf-co-air-top, 0px\) \+ var\(--nf-co-gap-top, 0px\) \+ var\(--nf-co-content-gap-top, 0px\) \+ var\(--nf-co-list-top, 0px\) - var\(--nf-blk-pad\)/.test(declValue(first, "--nf-blk-t")) && declValue(first, "--nf-blk-rt") === "calc(var(--nf-radius-inline, 4px) + var(--nf-blk-pad))", "the first row starts the tint a pad above its text, rounded like Reading's");
  const up = rules.find((r) => r.selectors.some((s) => /:has\(\+ \.cm-line\.nf-co-edit\.nf-blk-bg\.nf-blk-first:not\(.*\)\)::after$/.test(s)) && declValue(r, "background-position"));
  w3(up && splitTop(declValue(up, "background-position")).every((p) => /bottom var\(--nf-blk-at\)$/.test(p)), "the row above a tinted paragraph draws its top pad, anchored to its own bottom edge");
  const both = rules.find((r) => r.selectors.some((s) => /\+ \.cm-line\.nf-co-edit:not\(\.nf-co-first, \.nf-blk-bg, \.HyperMD-header\):has\(\+ .*\)::after$/.test(s)) && declValue(r, "background-image"));
  w3(both && splitTop(declValue(both, "background-image")).length === 6 && /--nf-blk-tint-prev.*--nf-blk-tint-next/.test(declValue(both, "background-image")), "a blank row between two tinted paragraphs draws both pads, each in its own hue");
  for (const hue of HUES9) {
    w3(rules.some((r) => r.selectors.includes(`.markdown-source-view.is-live-preview .cm-line.nf-co-edit:has(+ .cm-line.nf-blk-first.nf-blk-${hue})`) && declValue(r, "--nf-blk-rgb-next") === `var(--nf-${hue}-rgb)`), `the row above a ${hue} paragraph takes its hue`);
    w3(rules.some((r) => r.selectors.includes(`.markdown-source-view.is-live-preview .cm-line.nf-blk-last.nf-blk-${hue} + .cm-line.nf-co-edit`) && declValue(r, "--nf-blk-rgb-prev") === `var(--nf-${hue}-rgb)`), `the row below a ${hue} paragraph takes its hue`);
  }
}

/* fixcss-list-code-residuals (CSS half): a list fence's language chip sits
   on the code's column whatever the lead. Obsidian's nobullet hanging pad
   on the lead's last box (14px) put it right of the code with a space
   lead only; body rows never end in that box. */
{
  const pad = rules.find((r) => r.selectors.includes("body.nf-clean .markdown-source-view.is-live-preview .cm-line.nf-nested-block.nf-visual-fence-open.HyperMD-list-line-nobullet:not(.nf-qcode) > .cm-hmd-list-indent > .cm-indent-spacing:last-child"));
  w3(pad && declValue(pad, "padding-inline-start") === "0" && pad.decls.length === 1, "a list fence's opener drops the nobullet hanging pad, so its chip stands on the code's column");
  w3(!rules.some((r) => r.selectors.some((s) => /\.cm-indent-spacing/.test(s) && !/nf-visual-fence-open/.test(s))), "no other row's lead box is touched (body rows keep Obsidian's geometry)");
}

/* fixcss-canvas-status: while a card is being edited, the typing keys leave
   the toolbar row (the Chinese keys were cut at a 1280px window) and show
   in the mode hint's slot, in the hint's look, at any pane width; the row
   keeps them only while the hint or the find bar holds that slot. */
{
  const SEL = ".canvas-wrapper.nf-canvas-enhanced:has(.canvas-node.is-editing):not(.nf-canvas-finding, :has(.nf-canvas-find), :has(.nf-canvas-hint:not(:empty, .is-empty))) .nf-canvas-status";
  const pill = rules.find((r) => r.selectors.includes(SEL));
  const hint = rules.find((r) => r.selectors.includes(".canvas-wrapper.nf-canvas-enhanced .nf-canvas-hint") && declValue(r, "inset-block-start"));
  const bar = rules.find((r) => r.selectors.includes(".canvas-wrapper.nf-canvas-enhanced .nf-canvas-toolbar") && declValue(r, "inset-block-start"));
  w3(pill && declValue(pill, "position") === "absolute" && declValue(pill, "display") === "block" && declValue(pill, "max-width") === "calc(100cqi - 32px)" && !declValue(pill, "white-space"), "the editing keys are a pill under the toolbar, shown at any width, still one ellipsized line");
  /* The pill sits in the hint's slot: toolbar top + its 1px border + 100%
     of its padding box + 7px = the hint's top (the 38px toolbar). */
  if (pill && hint && bar) {
    const top = calcPx(declValue(bar, "inset-block-start"), {}) + 1 + 36 + calcPx(declValue(pill, "inset-block-start").replace("100%", "0px"), {});
    w3(top === calcPx(declValue(hint, "inset-block-start"), {}), `the editing pill takes the mode hint's slot (${top}px)`);
  }
  for (const prop of ["border", "border-radius", "background", "box-shadow", "color", "padding", "pointer-events"]) {
    w3(pill && hint && declValue(pill, prop) === declValue(hint, prop), `the editing pill wears the hint's ${prop}`);
  }
}

/* ---- canvas: every nf-canvas-* class the code sets has a rule ---- */
/* A class the canvas code sets but no selector mentions is either styled
   through something else (listed here with the reason) or an orphan: the
   element renders with Obsidian's defaults, as the find bar once did. */
const ALLOW = new Map([
  ["nf-canvas-ui", "JS hook: closest('.nf-canvas-ui') keeps canvas keys out of the plugin's own panels"],
  ["nf-canvas-ghost", "styled as .nf-canvas-ghosts rect"],
  ["nf-canvas-insert-bar", "styled as .nf-canvas-insert line"],
  ["nf-canvas-layout-panel", "modifier on .nf-canvas-style-panel, which carries the look"],
  ["nf-canvas-menu-action", "a clickable-icon inside the styled .nf-canvas-menu-group"],
  ["nf-canvas-search-item", "FuzzySuggest item hook; its .nf-canvas-search-context child is styled"],
  ["nf-canvas-empty-action", "Obsidian button / mod-cta inside the styled .nf-canvas-empty-actions"],
  ["nf-canvas-style-open", "not a class: localStorage key of the style panel's open sections (STYLE_SECTIONS_KEY)"],
  ["nf-canvas-color-recent", "not a class: storage key of the colour panel's recent colours (RECENT_COLOR_KEY)"],
]);
const styled = new Set();
for (const rule of rules) for (const s of rule.selectors) for (const m of s.matchAll(/\.(nf-canvas-[a-z0-9-]+)/g)) styled.add(m[1]);
/* The source with comments blanked out, as run-i18n-coverage reads it: an
   apostrophe in a comment ("a card's note") would otherwise open a string
   and hide the literals after it. String literals are kept whole. */
function stripComments(text) {
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
const canvasDir = resolve(root, "src/canvas");
const used = new Map();
if (existsSync(canvasDir)) {
  for (const file of readdirSync(canvasDir).filter((name) => name.endsWith(".ts")).sort()) {
    const src = stripComments(readFileSync(resolve(canvasDir, file), "utf8"));
    for (const literal of src.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      for (const m of literal[2].matchAll(/(?<![\w-])(nf-canvas-[a-z0-9-]+)(?![\w-])/g)) {
        const name = m[1];
        if (name.endsWith("-")) continue; // template prefix such as nf-canvas-minimap-${…}
        if (!used.has(name)) used.set(name, new Set());
        used.get(name).add(file);
      }
    }
  }
}
const orphans = [...used.keys()].filter((name) => !styled.has(name) && !ALLOW.has(name)).sort();
assert.deepEqual(
  orphans.map((name) => `${name} (${[...used.get(name)].join(", ")})`),
  [],
  "canvas classes set in src/canvas with no rule in styles.css: style them or add them to ALLOW with the reason",
);
for (const name of ALLOW.keys()) assert.ok(used.has(name), `ALLOW entry ${name} is no longer used in src/canvas: remove it`);
for (const name of ["nf-canvas-topic-centred", "nf-canvas-find", "nf-canvas-find-input", "nf-canvas-find-count", "nf-canvas-emoji-option", "nf-canvas-empty-key"]) {
  assert.ok(styled.has(name), `${name} is styled`);
}
/* The find bar floats in the mode hint's slot, and the hint steps aside. */
assert.ok(rulesWith(/\.nf-canvas-enhanced \.nf-canvas-find$/).some((r) => hasDecl(r, /^position: absolute$/)), "the find bar is a floating pill");
assert.ok(rulesWith(/\.nf-canvas-finding.*\.nf-canvas-hint$/).some((r) => hasDecl(r, /^display: none$/)), "the mode hint hides while finding");
/* Selection never reads as a card's own border: a gap ring, then the accent. */
const selectedTheme = rulesWith(/:is\(\.nf-theme-clean, \.nf-theme-cards,.*\)\.nf-canvas-map-text:is\(\.is-selected, \.is-focused\) \.canvas-node-container$/);
assert.ok(selectedTheme.some((r) => hasDecl(r, /^box-shadow: 0 0 0 2px var\(--nf-ground.*0 0 0 4px var\(--interactive-accent\)$/)), "clean/cards/minimal selection is a double ring");
/* Uncoloured topics mix in oklab (a grey's missing hue renders pink in oklch). */
assert.ok(rulesWith(/\.nf-theme-clean\.nf-canvas-map-branch\.nf-canvas-map-text:not\(\.is-themed, \.nf-canvas-auto-color/).some((r) => hasDecl(r, /in oklab/)), "uncoloured clean branches are tinted in oklab");

console.log(`PASS css-orphans: ${used.size} canvas classes, ${used.size - ALLOW.size} styled, ${ALLOW.size} allowlisted; ${rules.length} rules; lint clean; R2-W3: ${w3Checks} checks, ${w3Modules} module classes, ${w3Allowed} allowlisted`);
