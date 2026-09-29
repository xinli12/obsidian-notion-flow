/* Note style: palettes × looks (DESIGN-SPEC §6.1). The single, pure source
 * of the model: the palette and look registries, the resolution of
 * "palette × look × per-component override", the exact body classes and
 * inline body properties applyCleanClass writes, the one-shot settings
 * migration and the Canvas pairing.
 *
 * Deliberately imports nothing (no obsidian, no i18n, no canvas): the i18n
 * dictionary would evaluate at import time, and every consumer (main.ts,
 * the settings gallery, the switcher, Canvas, the tests) must be able to
 * load this module on its own. Labels are i18n KEYS, translated by the
 * caller with t(); names and descriptions are Bilingual (tl()).
 *
 * Every export is total: missing keys, wrong types and unknown ids resolve
 * to "auto" (or "classic" for palette and look) instead of throwing, since
 * computeBodyStyle runs inside onload(). */

export type PaletteId = "classic" | "notion" | "nord" | "morandi" | "paper" | "rose-pine" | "catppuccin" | "everforest" | "guose";
export type LookId = "classic" | "editorial" | "soft" | "outline" | "minimal" | "gradient";
export type ComponentKey = "calloutStyle" | "headingStyle" | "highlightStyle" | "tableLook" | "quoteStyle" | "bulletStyle"
  | "checkboxStyle" | "dividerStyle" | "toggleStyle" | "columnStyle" | "inlineCodeStyle" | "decorColor";
export type ColorKey = "listMarkerColor" | "quoteBarColor" | "inlineCodeColor" | "tableHeaderColor" | "codeTheme";
export interface Bilingual { en: string; zh: string }
export interface PaletteDef {
  id: PaletteId; name: Bilingual; desc: Bilingual; group: "default" | "calm" | "expressive";
  suggestedLook: LookId; canvasPreset: string | null;
  /** The 4 hues shown in the palette's mini preview. */
  inkHues: readonly [string, string, string, string];
  /** 9 inks gray…pink per mode, for the switcher dots (generated tokens; Classic = today's inks). */
  swatch: { light: readonly string[]; dark: readonly string[] };
}
export interface LookDef { id: LookId; name: Bilingual; desc: Bilingual; recipe: Record<ComponentKey, string> }
export type NoteStyleSettings = { palette: string; look: string; paletteSurface: string; paletteHeadings: boolean; paletteLinks: boolean }
  & Record<ComponentKey | ColorKey, string>;
export interface StyleEnv { paletteText(hue: string): string; paletteTint(hue: string, alpha: number): string; codeThemes: readonly string[] }
/** `null` means removeProperty. */
export interface BodyStyle { classes: string[]; vars: Record<string, string | null> }

type Gate = "nf-clean" | "nf-tables" | "nf-toggles" | "nf-columns" | "nf-callout-menu" | null;
interface ComponentDef {
  /** Explicit values, without "auto"; the first is the Classic recipe value. */
  values: readonly string[];
  /** Feature class the CSS is scoped under (the UI dims the row while it is off). */
  gate: Gate;
  /** i18n key. */
  label: string;
  /** value → i18n key. */
  optionLabels: Record<string, string>;
}

export const STYLE_HUES = ["gray", "red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"] as const;
/** §3.2 order; also the settings UI order. */
export const COMPONENT_KEYS: readonly ComponentKey[] = [
  "calloutStyle", "headingStyle", "highlightStyle", "tableLook", "quoteStyle", "bulletStyle",
  "checkboxStyle", "dividerStyle", "toggleStyle", "columnStyle", "inlineCodeStyle", "decorColor",
];
/** UI and override order, after the components. */
export const COLOR_KEYS: readonly ColorKey[] = ["listMarkerColor", "quoteBarColor", "inlineCodeColor", "tableHeaderColor", "codeTheme"];
/** Explicit values of the colour keys, without "auto" (codeTheme uses CODE_THEME_IDS). */
export const COLOR_VALUES: Record<Exclude<ColorKey, "codeTheme">, readonly string[]> = {
  listMarkerColor: ["accent", "default", ...STYLE_HUES],
  quoteBarColor: ["text", "accent", "default", ...STYLE_HUES],
  inlineCodeColor: ["default", ...STYLE_HUES],
  tableHeaderColor: ["default", "none", ...STYLE_HUES],
};
/** Existing i18n keys of the colour settings rows. */
export const COLOR_KEY_LABELS: Record<ColorKey, string> = {
  listMarkerColor: "List marker color",
  quoteBarColor: "Quote bar color",
  inlineCodeColor: "Inline code color",
  tableHeaderColor: "Table header background",
  codeTheme: "Code block theme",
};
/** Same ids and order as CODE_THEMES in main.ts (drift-tested). */
export const CODE_THEME_IDS = [
  "default", "obsidian", "github", "vscode", "one-dark", "catppuccin", "tokyo-night", "gruvbox", "dracula", "nord", "solarized",
] as const;
/** The pre-style defaults; stored equal values migrate to "auto" (§4.4). */
export const LEGACY_STYLE_DEFAULTS = {
  calloutStyle: "header",
  listMarkerColor: "accent",
  quoteBarColor: "text",
  inlineCodeColor: "red",
  tableHeaderColor: "default",
  codeTheme: "default",
} as const;
export const STYLE_SCHEMA = 1;

const HUE_LABELS: Record<string, string> = {
  gray: "Gray", red: "Red", orange: "Orange", yellow: "Yellow", green: "Green",
  cyan: "Cyan", blue: "Blue", purple: "Purple", pink: "Pink",
};

/* ---------- registries ---------- */

/** Gallery and switcher order: Classic, then calm, then expressive (§2.1). */
export const PALETTES: readonly PaletteDef[] = [
  {
    id: "classic", name: { en: "Classic", zh: "经典" }, group: "default",
    desc: { en: "Today's look: muted inks that follow your theme.", zh: "当前外观：低饱和墨色，跟随主题。" },
    suggestedLook: "classic", canvasPreset: null, inkHues: ["red", "blue", "green", "purple"],
    swatch: {
      light: ["#7c7b77", "#b5554d", "#b87333", "#a9822f", "#4e8060", "#43868c", "#4a7ca6", "#7f62a3", "#a85480"],
      dark: ["#9a9a95", "#ce7a73", "#c98b52", "#c2a45c", "#6fa98a", "#6ba5a8", "#7b9fc9", "#a183c9", "#c482a5"],
    },
  },
  {
    id: "notion", name: { en: "Notion", zh: "Notion 原味" }, group: "calm",
    desc: { en: "Warm near-black ink, clear hues and barely-there washes.", zh: "暖黑正文、清透墨色与极浅底色。" },
    suggestedLook: "soft", canvasPreset: "mist", inkHues: ["red", "blue", "green", "purple"],
    swatch: {
      light: ["#696764", "#b13630", "#a54f00", "#916308", "#377552", "#1c7676", "#1a6c96", "#7a509c", "#a33b73"],
      dark: ["#a5a4a2", "#ee6e67", "#de8f57", "#dcaf61", "#65b587", "#57b6b6", "#50a8dd", "#b386e4", "#e274aa"],
    },
  },
  {
    id: "nord", name: { en: "Nord", zh: "北境" }, group: "calm",
    desc: { en: "Arctic frost and aurora: cool, calm, low-chroma.", zh: "极地霜蓝与极光，冷静克制。" },
    suggestedLook: "outline", canvasPreset: "nord", inkHues: ["red", "blue", "green", "purple"],
    swatch: {
      light: ["#576176", "#9b414c", "#93503a", "#806322", "#556c3e", "#336a79", "#43658e", "#74567d", "#8e4c5c"],
      dark: ["#bbc6dd", "#f0939c", "#e7a38b", "#e2c283", "#a8c391", "#9ed6e7", "#97b9da", "#c8aad1", "#e9a0b0"],
    },
  },
  {
    id: "morandi", name: { en: "Morandi", zh: "莫兰迪" }, group: "calm",
    desc: { en: "Grey-veiled, dusty tones; hues stay close together.", zh: "蒙上一层灰的柔和色调，色相彼此接近。" },
    suggestedLook: "minimal", canvasPreset: "morandi", inkHues: ["red", "blue", "green", "purple"],
    swatch: {
      light: ["#6a615e", "#895150", "#835a3d", "#766438", "#506a50", "#426a6c", "#48637f", "#68597a", "#7e5267"],
      dark: ["#afa5a2", "#cd9491", "#cba182", "#cbb98f", "#96b296", "#88b2b4", "#90abc7", "#afa0c3", "#c699ad"],
    },
  },
  {
    id: "paper", name: { en: "Paper & Ink", zh: "纸墨" }, group: "calm",
    desc: {
      en: "Sepia ink on cream paper with highlighter washes, made for long-form writing.",
      zh: "暖褐墨色、米白纸张与荧光笔底色，适合长文写作。",
    },
    suggestedLook: "editorial", canvasPreset: "journal", inkHues: ["red", "blue", "green", "purple"],
    swatch: {
      light: ["#6c655c", "#9c3e2c", "#9a4f16", "#8a620c", "#486c3b", "#286f6b", "#365f8b", "#734c7e", "#924160"],
      dark: ["#aea69d", "#e18a77", "#dc9c6b", "#dab975", "#91b684", "#79b8b4", "#85abd6", "#bd98c9", "#d98ea7"],
    },
  },
  {
    id: "rose-pine", name: { en: "Rosé Pine", zh: "玫瑰松" }, group: "expressive",
    desc: { en: "Dawn and Moon: dusty rose, gold and pine.", zh: "晨曦与月夜：灰玫瑰、琥珀金与松石。" },
    suggestedLook: "soft", canvasPreset: "rose-pine", inkHues: ["red", "yellow", "blue", "purple"],
    swatch: {
      light: ["#66627f", "#983f55", "#9a5229", "#905a01", "#436e52", "#2d6d6f", "#296987", "#7a4fa3", "#924b75"],
      dark: ["#a8a4c2", "#f08aa5", "#e9a679", "#f6c177", "#a3c9aa", "#9ccfd8", "#65afd2", "#c4a7e7", "#e69dc6"],
    },
  },
  {
    id: "catppuccin", name: { en: "Catppuccin", zh: "猫咖" }, group: "expressive",
    desc: { en: "Latte and Mocha: soothing pastels with a playful pop.", zh: "拿铁与摩卡：温柔粉彩，带一点俏皮。" },
    suggestedLook: "gradient", canvasPreset: "catppuccin", inkHues: ["red", "blue", "green", "purple"],
    swatch: {
      light: ["#5d606f", "#ac2135", "#a83f02", "#8d5604", "#267015", "#106b71", "#1f57c4", "#733cc4", "#9a3885"],
      dark: ["#979db6", "#f38ba8", "#fab387", "#f9e2af", "#a6e3a1", "#94e2d5", "#89b4fa", "#cba6f7", "#f5c2e7"],
    },
  },
  {
    id: "everforest", name: { en: "Everforest", zh: "常青森林" }, group: "expressive",
    desc: { en: "Warm parchment and forest greens, easy on the eyes.", zh: "暖调羊皮纸配森林绿，久读不累。" },
    suggestedLook: "soft", canvasPreset: "forest", inkHues: ["red", "orange", "green", "cyan"],
    swatch: {
      light: ["#5c685b", "#b33736", "#9e4a01", "#875f02", "#5e6c03", "#197353", "#266a90", "#715899", "#9c4380"],
      dark: ["#afbab2", "#fb9899", "#feb08e", "#ddbe81", "#abc484", "#8bc89a", "#8ec4bc", "#c2afe7", "#e2a7c3"],
    },
  },
  {
    id: "guose", name: { en: "Chinese Classic", zh: "国色" }, group: "expressive",
    desc: { en: "Blue-and-white porcelain with a cinnabar seal on ivory paper.", zh: "青花瓷与朱砂印：靛青、石绿、朱砂，象牙宣纸底。" },
    suggestedLook: "editorial", canvasPreset: "guose", inkHues: ["red", "blue", "green", "yellow"],
    swatch: {
      light: ["#5b696b", "#b33920", "#9c5220", "#816504", "#037736", "#417368", "#036491", "#8647aa", "#ae3854"],
      dark: ["#a5b4b7", "#fc765b", "#f5965b", "#ddba58", "#6ac982", "#6dc4ad", "#79bbdd", "#c3a3d5", "#f68296"],
    },
  },
];

/** Gallery and switcher order (§3.1). A recipe is the value each component
 * takes while its own setting is "auto". */
export const LOOKS: readonly LookDef[] = [
  {
    id: "classic", name: { en: "Classic", zh: "经典" }, desc: { en: "Today's look.", zh: "当前外观。" },
    recipe: {
      calloutStyle: "header", headingStyle: "plain", highlightStyle: "block", tableLook: "grid", quoteStyle: "bar",
      bulletStyle: "dot", checkboxStyle: "rounded", dividerStyle: "fade", toggleStyle: "chevron", columnStyle: "plain",
      inlineCodeStyle: "pill", decorColor: "palette",
    },
  },
  {
    id: "editorial", name: { en: "Editorial", zh: "杂志" },
    desc: { en: "Rail callouts, three-line tables, marker pen and ✦ breaks.", zh: "色条标注 · 三线表 · 荧光笔" },
    recipe: {
      calloutStyle: "rail", headingStyle: "editorial", highlightStyle: "marker", tableLook: "ruled", quoteStyle: "pull",
      bulletStyle: "dash", checkboxStyle: "ink", dividerStyle: "ornament", toggleStyle: "triangle", columnStyle: "divided",
      inlineCodeStyle: "ink", decorColor: "palette",
    },
  },
  {
    id: "soft", name: { en: "Soft cards", zh: "柔和卡片" },
    desc: { en: "Borderless cards, icon badges, tinted quotes.", zh: "无框卡片 · 图标徽章 · 淡色引用" },
    recipe: {
      calloutStyle: "card", headingStyle: "plain", highlightStyle: "block", tableLook: "card", quoteStyle: "tint",
      bulletStyle: "dot", checkboxStyle: "soft", dividerStyle: "dots", toggleStyle: "triangle", columnStyle: "plain",
      inlineCodeStyle: "tint", decorColor: "palette",
    },
  },
  {
    id: "outline", name: { en: "Outline", zh: "线框" },
    desc: { en: "Outlined callouts, ruled headings, diamond bullets.", zh: "描边标注 · 细线标题 · 菱形符号" },
    recipe: {
      calloutStyle: "outline", headingStyle: "rule", highlightStyle: "underline", tableLook: "grid", quoteStyle: "bar",
      bulletStyle: "diamond", checkboxStyle: "circle", dividerStyle: "hairline", toggleStyle: "guide", columnStyle: "divided",
      inlineCodeStyle: "outline", decorColor: "palette",
    },
  },
  {
    id: "minimal", name: { en: "Minimal", zh: "极简" },
    desc: { en: "Boxless callouts, monochrome decoration.", zh: "无框标注 · 单色装饰" },
    recipe: {
      calloutStyle: "minimal", headingStyle: "plain", highlightStyle: "underline", tableLook: "ruled", quoteStyle: "bar",
      bulletStyle: "dash", checkboxStyle: "circle", dividerStyle: "dots", toggleStyle: "guide", columnStyle: "plain",
      inlineCodeStyle: "ink", decorColor: "neutral",
    },
  },
  {
    id: "gradient", name: { en: "Gradient", zh: "渐变" },
    desc: { en: "Gradient title strips and fading underlines.", zh: "渐变标题栏 · 渐隐下划线" },
    recipe: {
      calloutStyle: "gradient", headingStyle: "fade", highlightStyle: "marker", tableLook: "card", quoteStyle: "tint",
      bulletStyle: "diamond", checkboxStyle: "rounded", dividerStyle: "ornament", toggleStyle: "triangle", columnStyle: "divided",
      inlineCodeStyle: "tint", decorColor: "palette",
    },
  },
];

/** The per-component settings rows (§3.2). Label keys are the §9 strings;
 * avoid the generic Soft/Dots/Plain/Rounded/Square/Underline/Look keys,
 * whose existing Chinese means something else. */
export const COMPONENTS: Record<ComponentKey, ComponentDef> = {
  calloutStyle: {
    values: ["header", "flat", "rail", "card", "outline", "minimal", "gradient"], gate: "nf-callout-menu", label: "Callout style",
    optionLabels: {
      header: "Header strip", flat: "Flat (Notion-like)", rail: "Side rail", card: "Soft card",
      outline: "Outlined", minimal: "Icon only", gradient: "Gradient title",
    },
  },
  headingStyle: {
    values: ["plain", "rule", "bar", "fade", "editorial"], gate: "nf-clean", label: "Heading accents",
    optionLabels: { plain: "Unadorned", rule: "Hairline rule", bar: "Accent bar", fade: "Fading underline", editorial: "Editorial" },
  },
  highlightStyle: {
    values: ["block", "marker", "underline"], gate: null, label: "Highlight style",
    optionLabels: { block: "Flat fill", marker: "Marker pen", underline: "Underline band" },
  },
  tableLook: {
    values: ["grid", "ruled", "card"], gate: "nf-tables", label: "Table look",
    optionLabels: { grid: "Rounded grid", ruled: "Three-line table", card: "Card" },
  },
  quoteStyle: {
    values: ["bar", "pull", "tint"], gate: "nf-clean", label: "Quote style",
    optionLabels: { bar: "Side bar", pull: "Pull quote", tint: "Tinted" },
  },
  bulletStyle: {
    values: ["dot", "dash", "diamond"], gate: null, label: "Bullet style",
    optionLabels: { dot: "Dot", dash: "Dash", diamond: "Diamond" },
  },
  checkboxStyle: {
    values: ["rounded", "circle", "ink", "soft"], gate: "nf-clean", label: "To-do checkbox",
    optionLabels: { rounded: "Rounded square", circle: "Circle", ink: "Ink square", soft: "Soft tick" },
  },
  dividerStyle: {
    values: ["fade", "hairline", "dots", "ornament"], gate: "nf-clean", label: "Divider style",
    optionLabels: { fade: "Fading hairline", hairline: "Solid hairline", dots: "Three dots", ornament: "Ornament ✦" },
  },
  toggleStyle: {
    values: ["chevron", "triangle", "guide"], gate: "nf-toggles", label: "Toggle arrow",
    optionLabels: { chevron: "Chevron", triangle: "Filled triangle", guide: "Guide line" },
  },
  columnStyle: {
    values: ["plain", "divided"], gate: "nf-columns", label: "Column divider",
    optionLabels: { plain: "No divider", divided: "Hairline divider" },
  },
  inlineCodeStyle: {
    values: ["pill", "tint", "outline", "ink"], gate: "nf-clean", label: "Inline code look",
    optionLabels: { pill: "Soft pill", tint: "Tinted pill", outline: "Outlined pill", ink: "Text only" },
  },
  decorColor: {
    // "palette" (no class) is an explicit value too: it is the Classic
    // recipe value, so a user can pin it against Minimal's "neutral". It
    // reads "Palette color", not "Follow palette": the auto option already
    // says "Follow look (…)".
    values: ["palette", "accent", "neutral", ...STYLE_HUES], gate: null, label: "Decoration color",
    optionLabels: { palette: "Palette color", accent: "Accent color", neutral: "Neutral gray", ...HUE_LABELS },
  },
};

/** What R2-W2 spreads into DEFAULT_SETTINGS: Classic × Classic, all auto. */
export const NOTE_STYLE_DEFAULTS: NoteStyleSettings & { canvasFollowPalette: boolean; styleSchema: number } = {
  palette: "classic",
  look: "classic",
  paletteSurface: "theme",
  paletteHeadings: false,
  paletteLinks: false,
  calloutStyle: "auto",
  headingStyle: "auto",
  highlightStyle: "auto",
  tableLook: "auto",
  quoteStyle: "auto",
  bulletStyle: "auto",
  checkboxStyle: "auto",
  dividerStyle: "auto",
  toggleStyle: "auto",
  columnStyle: "auto",
  inlineCodeStyle: "auto",
  decorColor: "auto",
  listMarkerColor: "auto",
  quoteBarColor: "auto",
  inlineCodeColor: "auto",
  tableHeaderColor: "auto",
  codeTheme: "auto",
  canvasFollowPalette: true,
  styleSchema: STYLE_SCHEMA,
};

/* ---------- body output ---------- */

/** Every class computeBodyStyle can emit (§5.1); remove these before each
 * apply and on unload. Written out, not derived, so the sweep test catches
 * a typo on either side. */
export const NOTE_STYLE_CLASSES: readonly string[] = [
  "nf-palette",
  "nf-palette-notion", "nf-palette-nord", "nf-palette-morandi", "nf-palette-paper",
  "nf-palette-rose-pine", "nf-palette-catppuccin", "nf-palette-everforest", "nf-palette-guose",
  "nf-palette-page", "nf-palette-app", "nf-palette-headings", "nf-palette-links",
  "nf-callout-flat", "nf-callout-rail", "nf-callout-card", "nf-callout-outline", "nf-callout-minimal", "nf-callout-gradient",
  "nf-lk-h-rule", "nf-lk-h-bar", "nf-lk-h-fade", "nf-lk-h-editorial",
  "nf-lk-hl-marker", "nf-lk-hl-underline",
  "nf-lk-tbl-ruled", "nf-lk-tbl-card",
  "nf-lk-q-pull", "nf-lk-q-tint",
  "nf-lk-bullet-dash", "nf-lk-bullet-diamond",
  "nf-lk-check-circle", "nf-lk-check-ink", "nf-lk-check-soft",
  "nf-lk-hr-hairline", "nf-lk-hr-dots", "nf-lk-hr-ornament",
  "nf-lk-toggle-triangle", "nf-lk-toggle-guide",
  "nf-lk-cols-divided",
  "nf-lk-icode-tint", "nf-lk-icode-outline", "nf-lk-icode-ink",
  "nf-decor-accent", "nf-decor-neutral", "nf-decor-hue",
  "nf-list-color", "nf-quote-color", "nf-code-color", "nf-thead-tint",
  // Only under a palette: an explicit "Theme default" steps its code colours aside.
  "nf-code-theme-default",
  ...CODE_THEME_IDS.filter((id) => id !== "default").map((id) => `nf-code-theme-${id}`),
];
/** The inline <body> properties (§5.2), in write order. */
export const NOTE_STYLE_VARS: readonly string[] = [
  "--nf-list-marker", "--nf-quote-bar", "--nf-inline-code", "--nf-table-header-bg", "--nf-co-title-bottom", "--nf-decor-src",
];

/** value → body classes per component; the recipe's Classic value adds none.
 * A table rather than `nf-lk-…-${v}` so a misspelt class shows in the sweep. */
const COMPONENT_CLASSES: Record<Exclude<ComponentKey, "decorColor">, Record<string, readonly string[]>> = {
  calloutStyle: {
    header: [],
    flat: ["nf-callout-flat"],
    // Rail, card, outline and minimal reuse the flat geometry (the in-place
    // editor's measured insets depend on it); gradient keeps the header's.
    rail: ["nf-callout-rail", "nf-callout-flat"],
    card: ["nf-callout-card", "nf-callout-flat"],
    outline: ["nf-callout-outline", "nf-callout-flat"],
    minimal: ["nf-callout-minimal", "nf-callout-flat"],
    gradient: ["nf-callout-gradient"],
  },
  headingStyle: {
    plain: [], rule: ["nf-lk-h-rule"], bar: ["nf-lk-h-bar"], fade: ["nf-lk-h-fade"], editorial: ["nf-lk-h-editorial"],
  },
  highlightStyle: { block: [], marker: ["nf-lk-hl-marker"], underline: ["nf-lk-hl-underline"] },
  tableLook: { grid: [], ruled: ["nf-lk-tbl-ruled"], card: ["nf-lk-tbl-card"] },
  quoteStyle: { bar: [], pull: ["nf-lk-q-pull"], tint: ["nf-lk-q-tint"] },
  bulletStyle: { dot: [], dash: ["nf-lk-bullet-dash"], diamond: ["nf-lk-bullet-diamond"] },
  checkboxStyle: { rounded: [], circle: ["nf-lk-check-circle"], ink: ["nf-lk-check-ink"], soft: ["nf-lk-check-soft"] },
  dividerStyle: { fade: [], hairline: ["nf-lk-hr-hairline"], dots: ["nf-lk-hr-dots"], ornament: ["nf-lk-hr-ornament"] },
  toggleStyle: { chevron: [], triangle: ["nf-lk-toggle-triangle"], guide: ["nf-lk-toggle-guide"] },
  columnStyle: { plain: [], divided: ["nf-lk-cols-divided"] },
  inlineCodeStyle: { pill: [], tint: ["nf-lk-icode-tint"], outline: ["nf-lk-icode-outline"], ink: ["nf-lk-icode-ink"] },
};

/* ---------- normalisation ---------- */

type Loose = Record<string, unknown>;
type StyleKey = ComponentKey | ColorKey;
interface Normalized {
  palette: PaletteId;
  look: LookDef;
  surface: "theme" | "page" | "app";
  headings: boolean;
  links: boolean;
  /** Stored value when valid, else "auto". */
  values: Record<StyleKey, string>;
}

const isRecord = (value: unknown): value is Loose => typeof value === "object" && value !== null;
const paletteById = (id: unknown) => PALETTES.find((p) => p.id === id);
const lookById = (id: unknown) => LOOKS.find((l) => l.id === id);
const validValues = (key: StyleKey, codeThemes: readonly string[]): readonly string[] =>
  key === "codeTheme" ? codeThemes
    : (COMPONENTS as Record<string, ComponentDef>)[key]?.values ?? COLOR_VALUES[key as Exclude<ColorKey, "codeTheme">];

/** The one validation every export goes through: unknown ids → classic,
 * any invalid or non-string style value → "auto". */
function normalize(input: unknown, codeThemes: readonly string[] = CODE_THEME_IDS): Normalized {
  const s: Loose = isRecord(input) ? input : {};
  const values = {} as Record<StyleKey, string>;
  for (const key of [...COMPONENT_KEYS, ...COLOR_KEYS]) {
    const v = s[key];
    values[key] = typeof v === "string" && v !== "auto" && validValues(key, codeThemes).includes(v) ? v : "auto";
  }
  return {
    palette: paletteById(s.palette)?.id ?? "classic",
    look: lookById(s.look) ?? LOOKS[0],
    surface: s.paletteSurface === "page" ? "page" : s.paletteSurface === "app" ? "app" : "theme",
    headings: s.paletteHeadings === true,
    links: s.paletteLinks === true,
    values,
  };
}

/** A usable env even when the caller passes none: the Classic light inks
 * as fallbacks, exactly as main.ts's paletteTextColor / paletteTint. */
function envOf(env: unknown): StyleEnv {
  const e: Loose = isRecord(env) ? env : {};
  const ink = (hue: string) => PALETTES[0].swatch.light[STYLE_HUES.indexOf(hue as typeof STYLE_HUES[number])];
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
  return {
    paletteText: typeof e.paletteText === "function" ? e.paletteText as StyleEnv["paletteText"]
      : (hue) => (ink(hue) ? `var(--nf-${hue}, ${ink(hue)})` : `var(--nf-${hue})`),
    paletteTint: typeof e.paletteTint === "function" ? e.paletteTint as StyleEnv["paletteTint"]
      : (hue, alpha) => (ink(hue) ? `rgba(var(--nf-${hue}-rgb, ${rgb(ink(hue))}), ${alpha})` : `rgba(var(--nf-${hue}-rgb), ${alpha})`),
    codeThemes: Array.isArray(e.codeThemes) ? e.codeThemes as readonly string[] : CODE_THEME_IDS,
  };
}

const isHue = (v: string) => (STYLE_HUES as readonly string[]).includes(v);

/* ---------- resolution ---------- */

/** Normalised palette and look, and each component's effective value with
 * where it came from ("user" iff the stored value is a valid non-auto one). */
export function resolveNoteStyle(s: NoteStyleSettings): {
  palette: PaletteId; look: LookId;
  components: Record<ComponentKey, { value: string; source: "look" | "user" }>;
} {
  const n = normalize(s);
  const components = {} as Record<ComponentKey, { value: string; source: "look" | "user" }>;
  for (const key of COMPONENT_KEYS) {
    const own = n.values[key];
    components[key] = own !== "auto" ? { value: own, source: "user" } : { value: n.look.recipe[key], source: "look" };
  }
  return { palette: n.palette, look: n.look.id, components };
}

/** The exact body classes and inline properties for the settings (§3.2,
 * §4.3, §5.1). Classic × Classic × all auto reproduces the pre-style
 * applyCleanClass output once `var(--nf-style-*, X)` falls back to X. */
export function computeBodyStyle(s: NoteStyleSettings, env: StyleEnv): BodyStyle {
  const e = envOf(env);
  const n = normalize(s, e.codeThemes);
  const classes: string[] = [];
  const vars: Record<string, string | null> = Object.fromEntries(NOTE_STYLE_VARS.map((v) => [v, null]));
  const add = (list: readonly string[]) => {
    for (const cls of list) if (!classes.includes(cls)) classes.push(cls);
  };
  const effective = (key: ComponentKey) => (n.values[key] !== "auto" ? n.values[key] : n.look.recipe[key]);

  // 1. Palette: nothing at all under Classic, whatever the surface and toggles.
  if (n.palette !== "classic") {
    add(["nf-palette", `nf-palette-${n.palette}`]);
    if (n.surface !== "theme") add([`nf-palette-${n.surface}`]);
    if (n.headings) add(["nf-palette-headings"]);
    if (n.links) add(["nf-palette-links"]);
  }

  // 2–3. Callout, then the components. Gates are not applied: the CSS is
  // already scoped under the feature class.
  for (const key of COMPONENT_KEYS) {
    if (key === "decorColor") continue;
    add(COMPONENT_CLASSES[key][effective(key)] ?? []);
  }
  if (classes.includes("nf-callout-flat")) vars["--nf-co-title-bottom"] = "6px";

  // 4. Decoration colour.
  const decor = effective("decorColor");
  if (decor === "accent") add(["nf-decor-accent"]);
  else if (decor === "neutral") add(["nf-decor-neutral"]);
  else if (isHue(decor)) {
    add(["nf-decor-hue"]);
    vars["--nf-decor-src"] = e.paletteText(decor);
  }

  // 5. Colour keys (§4.3). Explicit values write exactly what they wrote
  // before palettes; auto points at the palette token with today's value
  // as the fallback.
  const lm = n.values.listMarkerColor;
  if (lm !== "default") {
    add(["nf-list-color"]);
    vars["--nf-list-marker"] = lm === "auto" ? "var(--nf-style-list-marker, var(--interactive-accent))"
      : lm === "accent" ? "var(--interactive-accent)" : e.paletteText(lm);
  }
  const qb = n.values.quoteBarColor;
  if (qb !== "default") {
    add(["nf-quote-color"]);
    vars["--nf-quote-bar"] = qb === "auto" ? "var(--nf-style-quote-bar, var(--text-normal))"
      : qb === "text" ? "var(--text-normal)" : qb === "accent" ? "var(--interactive-accent)" : e.paletteText(qb);
  }
  const ic = n.values.inlineCodeColor;
  if (ic !== "default") {
    add(["nf-code-color"]);
    vars["--nf-inline-code"] = ic === "auto" ? `var(--nf-style-inline-code, ${e.paletteText("red")})` : e.paletteText(ic);
  }
  // Never nf-thead-tint for auto: the ruled and card table looks clear or
  // tint the header through :not(.nf-thead-tint).
  const th = n.values.tableHeaderColor;
  if (th === "auto") {
    if (n.palette !== "classic") vars["--nf-table-header-bg"] = "var(--nf-style-thead)";
  } else if (th === "none") {
    add(["nf-thead-tint"]);
    vars["--nf-table-header-bg"] = "transparent";
  } else if (isHue(th)) {
    add(["nf-thead-tint"]);
    vars["--nf-table-header-bg"] = e.paletteTint(th, 0.16);
  }
  // An explicit "Theme default" is a choice too: under a palette it takes
  // Obsidian's own code colours back (the palette's code colours key on the
  // absence of every nf-code-theme-* class). Under Classic there is nothing
  // to step aside from, so it adds nothing, as before palettes.
  const code = n.values.codeTheme;
  if (code === "default") {
    if (n.palette !== "classic") add(["nf-code-theme-default"]);
  } else if (code !== "auto") add([`nf-code-theme-${code}`]);

  return { classes, vars };
}

/** Keys whose stored value is valid and not "auto", in UI order. A value
 * equal to the recipe still counts: it is pinned. */
export function overriddenKeys(s: NoteStyleSettings): Array<ComponentKey | ColorKey> {
  const n = normalize(s);
  return [...COMPONENT_KEYS, ...COLOR_KEYS].filter((key) => n.values[key] !== "auto");
}

/** "Follow the style for all": every component and colour key back to
 * auto. Never touches palette, look, surface, headings or links. */
export function followAll(): Partial<NoteStyleSettings> {
  return Object.fromEntries([...COMPONENT_KEYS, ...COLOR_KEYS].map((key) => [key, "auto"])) as Partial<NoteStyleSettings>;
}

/** The settings a preview renders: another palette and/or look, nothing else. */
export function withPreview(s: NoteStyleSettings, p: { palette?: string; look?: string }): NoteStyleSettings {
  const base = (isRecord(s) ? s : {}) as NoteStyleSettings;
  const next: { palette?: string; look?: string } = isRecord(p) ? p : {};
  return { ...base, palette: next.palette ?? base.palette, look: next.look ?? base.look };
}

/** One-shot migration patch (§4.4), gated by styleSchema. Stored legacy
 * defaults and missing keys become "auto" (identical under Classic); any
 * other stored value is kept as an explicit override. Pure. */
export function migrateStyleSettings(saved: Record<string, unknown> | null): Record<string, unknown> {
  if (!isRecord(saved) || Array.isArray(saved)) return {};
  if (Number(saved.styleSchema) >= STYLE_SCHEMA) return {};
  const patch: Record<string, unknown> = {};
  for (const [key, legacy] of Object.entries(LEGACY_STYLE_DEFAULTS)) {
    if (!(key in saved) || saved[key] === undefined || saved[key] === legacy) patch[key] = "auto";
  }
  patch.styleSchema = STYLE_SCHEMA;
  return patch;
}

/** Validation patch for loaded settings, so every stored value is one the
 * settings UI can show: an unknown palette or look id → "classic", a
 * surface other than theme/page/app → "theme", a non-boolean toggle → its
 * default, a component, colour or code-theme value outside "auto" and the
 * key's values → "auto", and a non-array `canvasUserSchemes` → []. Keys
 * that are already valid are absent from the patch. Pure; never throws. */
export function normalizeStyleSettings(s: Record<string, unknown>): Record<string, unknown> {
  const src: Loose = isRecord(s) ? s : {};
  const patch: Loose = {};
  if (!paletteById(src.palette)) patch.palette = "classic";
  if (!lookById(src.look)) patch.look = "classic";
  if (src.paletteSurface !== "theme" && src.paletteSurface !== "page" && src.paletteSurface !== "app") {
    patch.paletteSurface = "theme";
  }
  for (const key of ["paletteHeadings", "paletteLinks", "canvasFollowPalette"] as const) {
    if (typeof src[key] !== "boolean") patch[key] = NOTE_STYLE_DEFAULTS[key];
  }
  for (const key of [...COMPONENT_KEYS, ...COLOR_KEYS]) {
    const v = src[key];
    if (v !== "auto" && !(typeof v === "string" && validValues(key, CODE_THEME_IDS).includes(v))) patch[key] = "auto";
  }
  if (!Array.isArray(src.canvasUserSchemes)) patch.canvasUserSchemes = [];
  return patch;
}

/** The Canvas preset paired with the note palette (§8), or null when maps
 * do not follow it or the palette is Classic. */
export function canvasPaletteFor(s: { palette: string; canvasFollowPalette: boolean }): string | null {
  if (!isRecord(s) || s.canvasFollowPalette !== true) return null;
  const palette = paletteById(s.palette);
  return palette && palette.id !== "classic" ? palette.canvasPreset : null;
}

/* ---------- DOM ---------- */

/** Structural <body>-like target, so this module needs no DOM types beyond these. */
export interface StyleTarget {
  classList: { contains(token: string): boolean; add(...tokens: string[]): void; remove(...tokens: string[]): void };
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): unknown; getPropertyValue?(name: string): string };
}

/** Write a BodyStyle onto a body. Only the differences are touched, so an
 * unchanged class or property causes no style recalculation. */
export function applyBodyStyle(body: StyleTarget, style: BodyStyle): void {
  const want = new Set(Array.isArray(style?.classes) ? style.classes : []);
  for (const cls of NOTE_STYLE_CLASSES) {
    if (!want.has(cls) && body.classList.contains(cls)) body.classList.remove(cls);
  }
  for (const cls of want) if (!body.classList.contains(cls)) body.classList.add(cls);
  const vars: Loose = isRecord(style?.vars) ? style.vars : {};
  for (const name of NOTE_STYLE_VARS) {
    const value = vars[name];
    const current = body.style.getPropertyValue?.(name);
    if (typeof value === "string" && value !== "") {
      if (current !== value) body.style.setProperty(name, value);
    } else if (current !== "") {
      body.style.removeProperty(name);
    }
  }
}

/** Remove every note-style class and property (unload, restore). */
export function clearBodyStyle(body: {
  classList: Pick<StyleTarget["classList"], "remove">;
  style: Pick<StyleTarget["style"], "removeProperty">;
}): void {
  // remove() is a no-op for an absent class, so no contains() check: a
  // window being torn down (or a minimal body) need not support it.
  for (const cls of NOTE_STYLE_CLASSES) body.classList.remove(cls);
  for (const name of NOTE_STYLE_VARS) body.style.removeProperty(name);
}
