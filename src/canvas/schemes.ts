import { asCanvasFont, asCanvasShape, asMapStyle, cssPalette, paletteColorsFrom } from "./appearance";
import type { AppearancePreset, CanvasFont, CanvasMapStyle, CanvasShape, PaletteColors } from "./appearance";
import { asLineChoice } from "./lines";
import type { LineChoice } from "./lines";
import { SPACINGS } from "./graph";
import type { MapSpacing } from "./graph";

/** How many schemes of their own a person may keep; the Save button stops there. */
export const USER_SCHEME_LIMIT = 36;
export const SCHEME_NAME_MAX = 40;

/**
 * A map look someone saved from "Save as my scheme": raw colors (lowercase
 * hex or JSON Canvas digits) and the look they were shown with. Kept in the
 * plugin's settings, never in a canvas; applying one copies its colors onto
 * the map's root, so the map keeps them after the scheme is deleted.
 */
export interface CanvasUserScheme extends PaletteColors {
  id: string;
  name: string;
  theme: CanvasMapStyle;
  line: LineChoice;
  spacing: MapSpacing;
  font?: CanvasFont;
  shape?: CanvasShape;
}

/** Settings data → valid schemes: drops malformed entries and duplicate ids, trims names to SCHEME_NAME_MAX, caps at the limit. */
export function userSchemesFrom(value: unknown): CanvasUserScheme[] {
  if (!Array.isArray(value)) return [];
  const schemes: CanvasUserScheme[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    if (schemes.length >= USER_SCHEME_LIMIT) break;
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const colors = paletteColorsFrom(entry);
    const theme = asMapStyle(entry.theme);
    const line = asLineChoice(entry.line);
    const spacing = SPACINGS.find((value) => value === entry.spacing);
    if (typeof entry.id !== "string" || !entry.id || ids.has(entry.id) || typeof entry.name !== "string"
      || !colors || !theme || !line || !spacing) continue;
    const name = entry.name.trim().slice(0, SCHEME_NAME_MAX);
    if (!name) continue;
    ids.add(entry.id);
    const scheme: CanvasUserScheme = { id: entry.id, name, ...colors, theme, line, spacing };
    const font = asCanvasFont(entry.font);
    const shape = asCanvasShape(entry.shape);
    if (font && font !== "default") scheme.font = font;
    if (shape && shape !== "rounded") scheme.shape = shape;
    schemes.push(scheme);
  }
  return schemes;
}

/** A scheme drawn like a preset (for presetThumbnail and presetColors), colors as CSS. */
export function schemeAsPreset(scheme: CanvasUserScheme): AppearancePreset {
  const preset: AppearancePreset = {
    id: scheme.id, name: scheme.name, description: "", group: "soft",
    theme: scheme.theme, line: scheme.line, spacing: scheme.spacing,
    ...cssPalette(scheme),
  };
  if (scheme.font) preset.font = scheme.font;
  if (scheme.shape) preset.shape = scheme.shape;
  return preset;
}

/** `${base} ${n}` with the first n ≥ 1 not taken. */
export function suggestSchemeName(base: string, taken: readonly string[]): string {
  const names = new Set(taken.map((name) => name.trim()));
  let n = 1;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** "u" and the time in base 36, suffixed until no saved scheme has it. */
export function newSchemeId(taken: readonly string[], now = Date.now()): string {
  const ids = new Set(taken);
  const base = `u${Math.max(0, Math.floor(now)).toString(36)}`;
  let id = base;
  for (let n = 1; ids.has(id); n++) id = `${base}-${n}`;
  return id;
}
