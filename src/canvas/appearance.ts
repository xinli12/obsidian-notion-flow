import { isRelation, orderedChildren } from "./graph";
import type { CanvasData, CanvasNodeData, Forest, MapSpacing } from "./graph";
import type { LineChoice } from "./lines";

/** Stored only on a map's root; automatic colors never become native colors. */
export const PALETTE_KEY = "nfPalette";
/** A map's typeface, stored on its root. */
export const FONT_KEY = "nfFont";

/** How a map's topics look; each map may pick its own, stored on its root. */
export type CanvasMapStyle = "clean" | "cards" | "vivid" | "minimal" | "pastel" | "gradient";
export const MAP_STYLES: readonly CanvasMapStyle[] = ["clean", "cards", "vivid", "minimal", "pastel", "gradient"];

export function asMapStyle(value: unknown): CanvasMapStyle | null {
  return typeof value === "string" && (MAP_STYLES as readonly string[]).includes(value) ? value as CanvasMapStyle : null;
}

/** Typefaces for a map's words; "default" follows the note font. */
export type CanvasFont = "default" | "sans" | "serif" | "kai";
export const CANVAS_FONTS: readonly CanvasFont[] = ["default", "sans", "serif", "kai"];

export function asCanvasFont(value: unknown): CanvasFont | null {
  return typeof value === "string" && (CANVAS_FONTS as readonly string[]).includes(value) ? value as CanvasFont : null;
}

/** The outline of a map's topic cards, stored on its root. */
export const SHAPE_KEY = "nfShape";
export type CanvasShape = "rounded" | "pill" | "square" | "underline";
export const CANVAS_SHAPES: readonly CanvasShape[] = ["rounded", "pill", "square", "underline"];

export function asCanvasShape(value: unknown): CanvasShape | null {
  return typeof value === "string" && (CANVAS_SHAPES as readonly string[]).includes(value) ? value as CanvasShape : null;
}

/** How heavy a map's branch lines are drawn, stored on its root. */
export const LINE_WEIGHT_KEY = "nfLineWeight";
export type CanvasLineWeight = "thin" | "normal" | "bold";
export const LINE_WEIGHTS: readonly CanvasLineWeight[] = ["thin", "normal", "bold"];
/** Stroke and taper multipliers per weight. */
export const LINE_WEIGHT_SCALE: Record<CanvasLineWeight, number> = { thin: 0.65, normal: 1, bold: 1.5 };

export function asLineWeight(value: unknown): CanvasLineWeight | null {
  return typeof value === "string" && (LINE_WEIGHTS as readonly string[]).includes(value) ? value as CanvasLineWeight : null;
}

/** The size of a map's words relative to the note font, stored on its root. */
export const TEXT_SCALE_KEY = "nfTextScale";
export type CanvasTextScale = "small" | "normal" | "large";
export const TEXT_SCALES: readonly CanvasTextScale[] = ["small", "normal", "large"];
export const TEXT_SCALE_FACTOR: Record<CanvasTextScale, number> = { small: 0.875, normal: 1, large: 1.2 };

export function asTextScale(value: unknown): CanvasTextScale | null {
  return typeof value === "string" && (TEXT_SCALES as readonly string[]).includes(value) ? value as CanvasTextScale : null;
}

export type PresetGroup = "soft" | "natural" | "bold" | "focus";
export const PRESET_GROUPS: readonly [PresetGroup, string][] = [
  ["soft", "Soft"], ["natural", "Natural"], ["bold", "Vibrant"], ["focus", "Focus"],
];

export interface AppearancePreset {
  id: string;
  name: string;
  description: string;
  group: PresetGroup;
  theme: CanvasMapStyle;
  line: LineChoice;
  spacing: MapSpacing;
  /** A typeface of its own; without one, the map follows the note font. */
  font?: CanvasFont;
  /** A card outline of its own; without one, rounded cards. */
  shape?: CanvasShape;
  rootColor: string;
  branchColors: readonly string[];
  /**
   * Brighter tones for dark themes, where the light ones would sink: the same
   * hues, lighter and a little more saturated. Solid-fill looks stay medium so
   * their white words keep their contrast.
   */
  dark?: { rootColor: string; branchColors: readonly string[] };
  /**
   * Colors derived in CSS (from the theme's accent) where supported; the
   * literal colors above are the fallback and the swatches' stand-ins.
   */
  derived?: { rootColor: string; branchColors: readonly string[] };
  /** The derived colors' dark-theme tones; the root keeps the accent itself. */
  derivedDark?: { rootColor: string; branchColors: readonly string[] };
}

const ACCENT_TURNS = [0, 40, -40, 80, -80, 180];

/**
 * Tones are chosen in OKLCH: one lightness and chroma per palette, so no
 * branch outshouts the others, and medium enough to read as lines, borders
 * and tints in light and dark themes alike.
 */
export const APPEARANCE_PRESETS = [
  {
    id: "mist", name: "Soft mist", group: "soft",
    description: "Muted lavender, sage and rose with generous space.",
    theme: "clean", line: "curve", spacing: "roomy", rootColor: "#61668C",
    branchColors: ["#7286B1", "#71977A", "#AF7881", "#AA8D61", "#5E92A1", "#967B9E"],
    dark: {
      rootColor: "#B0B8F8",
      branchColors: ["#96B2EC", "#89C699", "#E69CA8", "#D9B175", "#6BC2DA", "#CBA0D7"],
    },
  },
  {
    id: "ocean", name: "Sea salt", group: "soft",
    description: "Clear blues and teals for knowledge maps.",
    theme: "clean", line: "curve", spacing: "standard", rootColor: "#1171A0",
    branchColors: ["#268BB6", "#1D989A", "#5F80BC", "#479B83", "#7B79AE", "#3D9BAC"],
    dark: {
      rootColor: "#71C8FE",
      branchColors: ["#48C0F6", "#2ACDD0", "#87B2FF", "#5FCEAE", "#ABA9EF", "#4ECBE2"],
    },
  },
  {
    id: "sakura", name: "Sakura", group: "soft",
    description: "Petal-soft blocks in rose, lilac and celadon.",
    theme: "pastel", line: "organic", spacing: "standard", shape: "pill", rootColor: "#AD5D7C",
    branchColors: ["#C5788D", "#9876AE", "#619CB3", "#67A490", "#C99A70", "#817FB5"],
    dark: {
      rootColor: "#FF9AC0",
      branchColors: ["#F692AE", "#C699E3", "#71C1E0", "#77C9AF", "#ECB079", "#A8A5EC"],
    },
  },
  {
    id: "macaron", name: "Macaron", group: "soft",
    description: "Sweet pastel blocks for playful brainstorming.",
    theme: "pastel", line: "curve", spacing: "roomy", shape: "pill", rootColor: "#C0628E",
    branchColors: ["#DB87A8", "#E3A072", "#DAC871", "#77C4A3", "#6DB5DA", "#AD98D5"],
    dark: {
      rootColor: "#FE9AC6",
      branchColors: ["#EF8AB3", "#F29E63", "#D4BE52", "#66CCA3", "#5FBEED", "#BA9EEB"],
    },
  },
  {
    id: "morandi", name: "Morandi", group: "soft",
    description: "Dusty, grey-veiled tones on quiet cards.",
    theme: "cards", line: "curve", spacing: "roomy", rootColor: "#765C56",
    branchColors: ["#A38382", "#83917C", "#728A99", "#A18F77", "#8A7A8D", "#758F8B"],
    dark: {
      rootColor: "#DEB2A8",
      branchColors: ["#D9A7A6", "#A7BD9C", "#92B8D0", "#D0B48E", "#BFA5C3", "#94BEB7"],
    },
  },
  {
    id: "nord", name: "Nordic", group: "soft",
    description: "The Nord palette on calm cards with rounded elbows.",
    theme: "cards", line: "elbow", spacing: "standard", rootColor: "#5E81AC",
    branchColors: ["#81A1C1", "#88C0D0", "#A3BE8C", "#B48EAD", "#D08770", "#EBCB8B"],
    dark: {
      rootColor: "#92C1FB",
      branchColors: ["#7FB1E3", "#70C7DF", "#A3C485", "#CE97C5", "#ED9073", "#E0B865"],
    },
  },
  {
    id: "forest", name: "Forest", group: "natural",
    description: "Leaf greens and warm earth, framed in soft cards.",
    theme: "cards", line: "organic", spacing: "roomy", rootColor: "#2E6849",
    branchColors: ["#51895E", "#7D8F50", "#458880", "#A98649", "#898248", "#528295"],
    dark: {
      rootColor: "#85D2A5",
      branchColors: ["#7BC58C", "#ABC370", "#68C4B9", "#E1B262", "#C0B76A", "#6EBDDC"],
    },
  },
  {
    id: "sunset", name: "Sunset", group: "natural",
    description: "Terracotta, amber and rose for warm project boards.",
    theme: "cards", line: "curve", spacing: "roomy", rootColor: "#AD4D3C",
    branchColors: ["#C76749", "#CE9042", "#BD687D", "#C38057", "#986694", "#C1A04C"],
    dark: {
      rootColor: "#FEA28F",
      branchColors: ["#F59171", "#F2AC57", "#F48BA4", "#F59E68", "#D390CD", "#E1B850"],
    },
  },
  {
    id: "journal", name: "Journal", group: "natural",
    description: "Kraft, sage and dusty blue in a handwritten face.",
    theme: "pastel", line: "organic", spacing: "roomy", font: "kai", rootColor: "#875F3F",
    branchColors: ["#A87B5D", "#738F6D", "#5E86A0", "#B17277", "#B69B5A", "#877999"],
    dark: {
      rootColor: "#EAB083",
      branchColors: ["#E0A47C", "#94C28B", "#77B9E3", "#EC999F", "#DCB964", "#BDA2DE"],
    },
  },
  {
    id: "vivid", name: "Vivid ideas", group: "bold",
    description: "Solid, colorful topics for brainstorming and presenting.",
    theme: "vivid", line: "organic", spacing: "standard", rootColor: "#4657BD",
    branchColors: ["#CE5053", "#D78C29", "#38964D", "#0D98A4", "#1F7DCF", "#955DBC"],
    dark: {
      rootColor: "#5A6EDC",
      branchColors: ["#D85356", "#CA7F08", "#399D50", "#019FAC", "#1E83DA", "#9C61C6"],
    },
  },
  {
    id: "aurora", name: "Aurora", group: "bold",
    description: "Glowing gradients from teal to violet to magenta.",
    theme: "gradient", line: "organic", spacing: "standard", rootColor: "#4461BE",
    branchColors: ["#00A8A2", "#0593BF", "#5473D2", "#9763CC", "#C6589C", "#44B782"],
    dark: {
      rootColor: "#5272D6",
      branchColors: ["#02A8A2", "#059AC7", "#5878DD", "#9E67D6", "#D05BA3", "#29AB74"],
    },
  },
  {
    id: "accent", name: "Theme accent", group: "bold",
    description: "Harmonies of your Obsidian accent color.",
    theme: "clean", line: "organic", spacing: "standard", rootColor: "#3D8BD9",
    branchColors: ["#3D8BD9", "#5A73C9", "#1E9BB0", "#7D66C0", "#2BA184", "#C57B3E"],
    dark: {
      rootColor: "#8BC3FF",
      branchColors: ["#7BBAFF", "#8EAAFE", "#26CCE8", "#B19DF8", "#47D2AE", "#F8A360"],
    },
    derived: {
      rootColor: "var(--interactive-accent)",
      branchColors: ACCENT_TURNS.map((turn) => `oklch(from var(--interactive-accent) 0.6 clamp(0.07, c, 0.13) calc(h + ${turn}))`),
    },
    derivedDark: {
      rootColor: "var(--interactive-accent)",
      branchColors: ACCENT_TURNS.map((turn) => `oklch(from var(--interactive-accent) 0.78 clamp(0.09, c, 0.13) calc(h + ${turn}))`),
    },
  },
  {
    id: "ink", name: "Quiet ink", group: "focus",
    description: "Restrained slate and straight lines for focused outlines.",
    theme: "minimal", line: "straight", spacing: "compact", shape: "underline", rootColor: "#3A4350",
    branchColors: ["#54657A", "#566D75", "#4C6A69", "#636076", "#5A6F63", "#786555"],
    dark: {
      rootColor: "#B3BFCE",
      branchColors: ["#96ADCB", "#96B7C3", "#8AB4B4", "#AAA7C6", "#9CB9A8", "#C7AB95"],
    },
  },
  {
    id: "inkwash", name: "Ink wash", group: "focus",
    description: "Brush-like ink with a cinnabar seal, in a calligraphic face.",
    theme: "minimal", line: "organic", spacing: "roomy", font: "kai", rootColor: "#AF2B25",
    branchColors: ["#413C36", "#4A545D", "#3C4C43", "#6A554E", "#42414A", "#49595B"],
    dark: {
      rootColor: "#E36558",
      branchColors: ["#C9C3BC", "#A2B4C3", "#A8BEB1", "#C2A398", "#BDBCCA", "#9CB7BA"],
    },
  },
  {
    id: "business", name: "Business", group: "focus",
    description: "Navy, steel and a touch of gold for plans and reports.",
    theme: "cards", line: "elbow", spacing: "compact", font: "sans", shape: "square", rootColor: "#1D3E66",
    branchColors: ["#2E65A0", "#367F96", "#387E7F", "#60697B", "#BD8F41", "#4F7A63"],
    dark: {
      rootColor: "#78A1D6",
      branchColors: ["#6FA2DB", "#69B0C9", "#6DB3B3", "#959FB2", "#D7A85B", "#84B198"],
    },
  },
  // Paired with the note palettes of the same names (Rosé Pine, Catppuccin, 国色).
  {
    id: "rose-pine", name: "Rosé Pine", group: "soft",
    description: "Dusty rose, gold and pine from the Rosé Pine palette.",
    theme: "clean", line: "organic", spacing: "roomy", rootColor: "#286983",
    branchColors: ["#B4637A", "#AA732C", "#B76562", "#4D8B96", "#8B75A4", "#608C6E"],
    dark: { rootColor: "#C4A7E7", branchColors: ["#FF90AD", "#E1AD63", "#EF9F9C", "#8FC1CA", "#C5A8E8", "#9DC3A2"] },
  },
  {
    id: "catppuccin", name: "Catppuccin pastel", group: "bold",
    description: "Latte by day, Mocha by night: candy pastel blocks.",
    theme: "pastel", line: "curve", spacing: "standard", shape: "pill", rootColor: "#8839EF",
    branchColors: ["#4E82E5", "#21979E", "#499C38", "#D25F2A", "#C15AA6", "#BB7403"],
    dark: { rootColor: "#CBA6F7", branchColors: ["#A2C6FE", "#88D5C9", "#9AD795", "#F9B286", "#E4B2D7", "#D8C290"] },
  },
  {
    id: "guose", name: "Chinese classic", group: "natural",
    description: "Indigo root, cinnabar, malachite and gamboge in a serif face.",
    theme: "clean", line: "organic", spacing: "standard", font: "serif", rootColor: "#177CB0",
    branchColors: ["#C65A53", "#319751", "#B16F05", "#9B65BD", "#4C8E81", "#C06322"],
    dark: { rootColor: "#79BBDD", branchColors: ["#FF9780", "#6ED087", "#E8AB3E", "#CDA5E4", "#5ACFB2", "#FD9C5E"] },
  },
  // Five with a character of their own: a mural, a night canvas, colors that
  // stay apart for color-blind readers, candy and the seventies.
  {
    id: "dunhuang", name: "Dunhuang", group: "natural",
    description: "Mural ochre, malachite and lapis on a warm ground.",
    theme: "pastel", line: "organic", spacing: "roomy", shape: "pill", rootColor: "#7A3B2E",
    branchColors: ["#B5533C", "#4E8D7C", "#3E5E9C", "#C2913E", "#D0795E", "#6F6A63"],
    dark: { rootColor: "#FEA28E", branchColors: ["#FB947B", "#72C7B0", "#8CB4FE", "#E2A948", "#FB9576", "#B9B3AC"] },
  },
  {
    id: "neon", name: "Midnight neon", group: "bold",
    description: "Dark-first neon branches that glow on a night canvas.",
    theme: "gradient", line: "organic", spacing: "standard", rootColor: "#5B3FD9",
    branchColors: ["#0891B2", "#65A30D", "#DB2777", "#CA8A04", "#2563EB", "#EA580C"],
    dark: { rootColor: "#8B7BFF", branchColors: ["#22D3EE", "#A3E635", "#F472B6", "#FACC15", "#60A5FA", "#FB923C"] },
  },
  {
    // The Okabe–Ito set; its dark tones keep the set's spread of lightness, so
    // blue and sky blue stay apart under deuteranopia too.
    id: "okabe", name: "Clear contrast", group: "focus",
    description: "Okabe–Ito colors that stay distinct for color-blind readers.",
    theme: "cards", line: "elbow", spacing: "standard", rootColor: "#1F2937",
    branchColors: ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#D55E00"],
    dark: { rootColor: "#E5E7EB", branchColors: ["#3E99DC", "#E69F00", "#3FBE91", "#CC79A7", "#7FCFFE", "#E57432"] },
  },
  {
    id: "candy", name: "Candy pop", group: "bold",
    description: "Bright candy blocks in pill shapes.",
    theme: "pastel", line: "curve", spacing: "roomy", shape: "pill", rootColor: "#E0457B",
    branchColors: ["#FF7A9A", "#FFA94D", "#F5C83B", "#4CC9A0", "#4DABF7", "#9775FA"],
    dark: { rootColor: "#FE9CB5", branchColors: ["#FA8FA6", "#EDA153", "#D4B045", "#4CCEA4", "#6DBBFE", "#B6A4FF"] },
  },
  {
    id: "retro", name: "Retro 70s", group: "natural",
    description: "Rust, mustard and teal in a serif face.",
    theme: "cards", line: "elbow", spacing: "standard", font: "serif", shape: "square", rootColor: "#4A2E23",
    branchColors: ["#C8553D", "#E09F3E", "#6A8D3A", "#2A7F8E", "#8E4A6B", "#B0703C"],
    dark: { rootColor: "#F0AB90", branchColors: ["#FC947D", "#E6A64B", "#9BC467", "#59C6DA", "#F092BE", "#F29E5B"] },
  },
] as const satisfies readonly AppearancePreset[];

export type AppearancePresetId = typeof APPEARANCE_PRESETS[number]["id"];
/** Stored on a map's root next to nfPalette: "custom" — a user's own colors (from "My schemes"). */
export const PALETTE_COLORS_KEY = "nfPaletteColors";
export const CUSTOM_PALETTE = "custom";
/**
 * `none` suppresses the vivid theme's default palette as well; `custom` shows
 * the colors stored on the root itself.
 */
export type PaletteId = AppearancePresetId | "none" | typeof CUSTOM_PALETTE;

export function asPaletteId(value: unknown): PaletteId | null {
  if (value === "none" || value === CUSTOM_PALETTE) return value;
  return typeof value === "string" && APPEARANCE_PRESETS.some(preset => preset.id === value)
    ? value as AppearancePresetId : null;
}

/** A palette's own colors: a root and six branches, with dark-theme tones where it has them. */
export interface PaletteColors {
  rootColor: string;
  branchColors: readonly string[];
  dark?: { rootColor: string; branchColors: readonly string[] };
}

/** A stored color as it may be written: a JSON Canvas digit, or a lowercase hex color. */
function rawColor(value: unknown): string | null {
  if (!safeCanvasColor(value)) return null;
  return (value as string).toLowerCase();
}

function rawSet(value: unknown): { rootColor: string; branchColors: string[] } | null {
  if (!value || typeof value !== "object") return null;
  const { rootColor, branchColors } = value as { rootColor?: unknown; branchColors?: unknown };
  const root = rawColor(rootColor);
  if (!root || !Array.isArray(branchColors) || branchColors.length !== 6) return null;
  const branches = branchColors.map(rawColor);
  return branches.every((color): color is string => color !== null) ? { rootColor: root, branchColors: branches } : null;
}

/**
 * Raw stored colors (lowercase hex or "1"–"6"), validated; null unless the
 * root and exactly six branches are all safe. A bad `dark` is dropped, not fatal.
 */
export function paletteColorsFrom(value: unknown): PaletteColors | null {
  const light = rawSet(value);
  if (!light) return null;
  const dark = rawSet((value as { dark?: unknown }).dark);
  return dark ? { ...light, dark } : light;
}

/** The same colors as CSS: digits become var(--canvas-color-N). Never store this form. */
export function cssPalette(colors: PaletteColors): PaletteColors {
  const css = (color: string) => safeCanvasColor(color) ?? color;
  const set = (value: { rootColor: string; branchColors: readonly string[] }) =>
    ({ rootColor: css(value.rootColor), branchColors: value.branchColors.map(css) });
  return colors.dark ? { ...set(colors), dark: set(colors.dark) } : set(colors);
}

/** A root's own colors when its palette is "custom", as CSS; else null. */
export function customPalette(root: CanvasNodeData | undefined): PaletteColors | null {
  if (root?.[PALETTE_KEY] !== CUSTOM_PALETTE) return null;
  const colors = paletteColorsFrom(root[PALETTE_COLORS_KEY]);
  return colors ? cssPalette(colors) : null;
}

/** Whether two palettes store the same raw colors, dark tones included. */
export function sameColors(a: PaletteColors | null, b: PaletteColors | null): boolean {
  if (!a || !b) return false;
  const key = (colors: PaletteColors) => JSON.stringify([colors.rootColor, colors.branchColors,
    colors.dark ? [colors.dark.rootColor, colors.dark.branchColors] : null]);
  return key(a) === key(b);
}

export function appearancePreset(value: unknown): AppearancePreset | null {
  return APPEARANCE_PRESETS.find(preset => preset.id === value) ?? null;
}

/** What the browser can draw: `light-dark()` and relative colors are recent. */
export interface ColorSupport {
  lightDark: boolean;
  relative: boolean;
}
export const MODERN_COLORS: ColorSupport = { lightDark: true, relative: true };

export function colorSupport(css: { supports?(property: string, value: string): boolean } | undefined): ColorSupport {
  const test = (value: string) => { try { return !!css?.supports?.("color", value); } catch { return false; } };
  return { lightDark: test("light-dark(#000, #fff)"), relative: test("oklch(from #fff l c h)") };
}

/**
 * A preset's colors as CSS: derived ones where supported, and a dark-theme
 * variant switched by the theme's own color scheme.
 */
export function presetColors(preset: PaletteColors & Pick<AppearancePreset, "derived" | "derivedDark">,
  support: ColorSupport = MODERN_COLORS): { rootColor: string; branchColors: readonly string[] } {
  if (preset.derived && support.relative) {
    const derivedDark = preset.derivedDark;
    if (!derivedDark || !support.lightDark) return preset.derived;
    return {
      rootColor: preset.derived.rootColor,
      branchColors: preset.derived.branchColors.map((color, index) =>
        `light-dark(${color}, ${derivedDark.branchColors[index % derivedDark.branchColors.length]})`),
    };
  }
  const dark = preset.dark;
  if (!dark || !support.lightDark) return preset;
  return {
    rootColor: `light-dark(${preset.rootColor}, ${dark.rootColor})`,
    branchColors: preset.branchColors.map((color, index) =>
      `light-dark(${color}, ${dark.branchColors[index % dark.branchColors.length]})`),
  };
}

/** Only JSON Canvas palette numbers and literal hex colors may enter our CSS. */
export function safeCanvasColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 1 && /^[1-6]$/.test(value)) return `var(--canvas-color-${value})`;
  return (value.length === 4 || value.length === 7) && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value) ? value : null;
}

function hasManualColor(value: unknown): boolean {
  // Even an unrecognised color belongs to the user or another plugin. Never
  // replace it, and never interpolate it into our own CSS or descendant tints.
  return value !== undefined && value !== null && value !== "";
}

export interface AutoColorPlan {
  /** CSS accents for uncolored cards only, including preset roots. */
  nodes: Map<string, string>;
  /** CSS accents for uncolored tree connections only. */
  edges: Map<string, string>;
}

/**
 * Resolve display-only accents. The saved canvas remains unchanged, so changing
 * or removing a palette immediately changes existing and newly added branches.
 * A main branch gets the next palette color in reading order; its descendants
 * inherit it until a valid manual card color starts a local override. A manual
 * root color does not collapse the main branches into one color.
 *
 * `vividRoots` preserves the original vivid theme for roots without a preset.
 * Unknown metadata falls back to that theme; `none` explicitly disables it.
 *
 * `fallbackPalette`, the preset paired with the note palette, colors the
 * maps that never chose: roots with no palette key at all and a look other
 * than vivid. An explicit preset, `none`, an unknown value and vivid roots
 * keep their own colors. Like every color here, it is only shown.
 */
export function planAutoColors(
  data: CanvasData, forest: Forest, vividRoots: ReadonlySet<string> = new Set(),
  support: ColorSupport = MODERN_COLORS, fallbackPalette: string | null = null,
): AutoColorPlan {
  const plan: AutoColorPlan = { nodes: new Map(), edges: new Map() };
  const byId = new Map(data.nodes.filter(node => node.type !== "group").map(node => [node.id, node]));
  const effective = new Map<string, string>();
  const visited = new Set<string>();
  const paint = (node: CanvasNodeData, automatic: string) => {
    const color = safeCanvasColor(node.color) ?? automatic;
    effective.set(node.id, color);
    if (!hasManualColor(node.color)) plan.nodes.set(node.id, color);
    return color;
  };

  // Null for null, "none" and unknown ids.
  const fallback = appearancePreset(fallbackPalette);
  for (const rootId of forest.roots) {
    const root = byId.get(rootId);
    if (!root || asPaletteId(root[PALETTE_KEY]) === "none") continue;
    const own = root[PALETTE_KEY];
    // An explicit preset, then the root's own colors, then the paired one.
    const preset = appearancePreset(own) ?? customPalette(root)
      ?? (own === undefined && !vividRoots.has(rootId) ? fallback : null);
    if (!preset && !vividRoots.has(rootId)) continue;
    const colors = preset ? presetColors(preset, support) : null;
    visited.add(rootId);
    if (colors) paint(root, colors.rootColor);
    const branches = orderedChildren(data, forest, rootId);
    for (let index = 0; index < branches.length; index++) {
      const color = colors
        ? colors.branchColors[index % colors.branchColors.length]
        : `var(--canvas-color-${index % 6 + 1})`;
      const pending: { id: string; color: string }[] = [{ id: branches[index], color }];
      while (pending.length) {
        const next = pending.pop()!;
        if (visited.has(next.id)) continue;
        visited.add(next.id);
        const node = byId.get(next.id);
        const info = forest.nodes.get(next.id);
        if (!node || !info || info.root !== rootId) continue;
        const inherited = paint(node, next.color);
        for (const child of info.children) pending.push({ id: child, color: inherited });
      }
    }
  }

  for (const edge of data.edges) {
    if (!forest.edges.has(edge.id) || isRelation(edge) || hasManualColor(edge.color)) continue;
    const color = effective.get(edge.toNode);
    if (color) plan.edges.set(edge.id, color);
  }
  return plan;
}

/**
 * Words that are a topic rather than a note: one paragraph without block
 * syntax. Topics are centred and balanced; notes keep reading alignment.
 */
export function isRichText(text: string): boolean {
  const trimmed = text.trim();
  return /\n/.test(trimmed) || /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|\||!\[|<)/.test(trimmed);
}
