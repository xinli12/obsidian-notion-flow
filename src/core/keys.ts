import { Platform } from "obsidian";
import { t } from "../i18n";

/* Key labels shared by the canvas guide, the shortcuts modal and tooltips,
 * so a chord reads the same everywhere it is shown. */

/** Keys as they are pressed here: Mod becomes ⌘ or Ctrl. Free text such as
 * "Enter / Alt+Enter" keeps its words; only modifier names are replaced. */
export function keyLabel(key: string, mac = Platform.isMacOS): string {
  return key.replace(/\bMod\b/g, mac ? "⌘" : "Ctrl").replace(/\bAlt\b/g, mac ? "⌥" : "Alt")
    .replace(/\bShift\b/g, mac ? "⇧" : "Shift").replace(/\bSpace\b/g, t("Space")).replace(/\+/g, mac ? "" : "+");
}

/** Keys that read better as a glyph than as their event name. */
const KEY_GLYPHS: Record<string, string> = {
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  Up: "↑", Down: "↓", Left: "←", Right: "→",
  Enter: "↩",
};

/** Modifiers in the order Obsidian prints them, with their labels. */
const MODIFIER_ORDER = ["Mod", "Ctrl", "Meta", "Alt", "Shift"] as const;
const MAC_MODIFIERS: Record<string, string> = { Mod: "⌘", Ctrl: "⌃", Meta: "⌘", Alt: "⌥", Shift: "⇧" };
const OTHER_MODIFIERS: Record<string, string> = { Mod: "Ctrl", Ctrl: "Ctrl", Meta: "Win", Alt: "Alt", Shift: "Shift" };

/** A chord in parts, the shape of Obsidian's Hotkey (which may carry the
 * physical `code` instead of `key`). */
export interface ChordParts { modifiers: readonly string[]; key?: string; code?: string }
/** "Mod+Shift+H", or an Obsidian Hotkey. */
export type ChordSpec = string | ChordParts;

/** "Mod+Shift+H" → {modifiers:["Mod","Shift"], key:"H"}; "Mod++" → key "+". */
export function parseChord(chord: string): ChordParts {
  const plusKey = chord === "+" || chord.endsWith("++");
  const cut = plusKey ? chord.length - 1 : chord.lastIndexOf("+") + 1;
  const key = chord.slice(cut);
  const modifiers = chord.slice(0, cut).split("+").filter(Boolean);
  return { modifiers, key };
}

/** A chord from its parts, as Obsidian's hotkey settings name them:
 * chordLabel(["Mod", "Shift"], "1") is "⌘⇧1" on a Mac, "Ctrl+Shift+1" elsewhere.
 * Modifiers follow Obsidian's order whatever order they come in. */
export function chordLabel(modifiers: readonly string[], key: string, mac = Platform.isMacOS): string {
  const names = mac ? MAC_MODIFIERS : OTHER_MODIFIERS;
  const parts: string[] = [];
  for (const modifier of MODIFIER_ORDER) {
    // Mod and Meta are both ⌘ on a Mac, Mod and Ctrl both Ctrl elsewhere.
    if (modifiers.includes(modifier) && !parts.includes(names[modifier])) parts.push(names[modifier]);
  }
  parts.push(key === " " || key === "Space" ? t("Space")
    : KEY_GLYPHS[key] ?? (key.length === 1 ? key.toUpperCase() : key));
  return parts.join(mac ? "" : "+");
}

/** The key a physical `code` stands for: KeyE → E, Digit1 → 1. */
function stripCode(code: string): string {
  if (code.startsWith("Key") && code.length === 4) return code.charAt(3);
  if (code.startsWith("Digit") && code.length === 6) return code.charAt(5);
  return code;
}

function hotkeyKey(h: Partial<ChordParts> | null | undefined): string | null {
  const key = typeof h?.code === "string" && h.code ? stripCode(h.code) : h?.key;
  return typeof key === "string" && key ? key : null;
}

/** An Obsidian Hotkey as a label, or null for an entry without a key. */
function hotkeyText(h: ChordParts | null | undefined, mac = Platform.isMacOS): string | null {
  const key = hotkeyKey(h);
  return key && h ? chordLabel(Array.isArray(h.modifiers) ? h.modifiers : [], key, mac) : null;
}

/** A hotkey reduced the way Obsidian matches it: Mod resolved for the
 * platform, modifiers sorted, the key compared without case. */
function compiledChord(h: Partial<ChordParts> | null | undefined, mac: boolean): string | null {
  const key = hotkeyKey(h);
  if (!key || !h) return null;
  const modifiers = Array.isArray(h.modifiers) ? h.modifiers : [];
  const resolved = [...new Set(modifiers.map((m) => (m === "Mod" ? (mac ? "Meta" : "Ctrl") : m)))].sort();
  return resolved.join(",") + "|" + key.toLowerCase();
}

interface HotkeyManagerLike {
  getHotkeys?(id: string): unknown;
  getDefaultHotkeys?(id: string): unknown;
  customKeys?: Record<string, unknown>;
  defaultKeys?: Record<string, unknown>;
}
interface AppLike {
  hotkeyManager?: HotkeyManagerLike;
  commands?: { findCommand?(id: string): unknown };
}

function managerOf(app: unknown): HotkeyManagerLike | null {
  const manager = (app as AppLike | null | undefined)?.hotkeyManager;
  return manager && (typeof manager.getHotkeys === "function" || typeof manager.getDefaultHotkeys === "function")
    ? manager : null;
}

/** Whether Obsidian gives `chord` to a command other than `id`. Its hotkey
 * scope handles a bound chord before any editor keymap, so a plugin default
 * that another command owns would never reach the plugin. Custom bindings
 * replace a command's defaults (an empty list frees them), and a command
 * that no longer exists does not count, as in Obsidian's own dispatch. */
export function chordTakenByOther(app: unknown, chord: ChordSpec, id: string, mac = Platform.isMacOS): boolean {
  const manager = (app as AppLike | null | undefined)?.hotkeyManager;
  if (!manager) return false;
  const wanted = compiledChord(typeof chord === "string" ? parseChord(chord) : chord, mac);
  if (!wanted) return false;
  const commands = (app as AppLike).commands;
  const owns = (other: string, list: unknown) =>
    other !== id && Array.isArray(list) &&
    list.some((h) => compiledChord(h as Partial<ChordParts> | null, mac) === wanted) &&
    (typeof commands?.findCommand !== "function" || !!commands.findCommand(other));
  const custom = manager.customKeys ?? {};
  for (const other of Object.keys(custom)) if (owns(other, custom[other])) return true;
  const defaults = manager.defaultKeys ?? {};
  for (const other of Object.keys(defaults)) {
    if (Object.prototype.hasOwnProperty.call(custom, other)) continue;
    if (owns(other, defaults[other])) return true;
  }
  return false;
}

/** The hotkey Obsidian currently has for a command, as parts with a plain
 * `key` (a physical `code` is read as its key), so the chord a tooltip
 * names and the one `aria-keyshortcuts` announces cannot disagree. A
 * command the person unbound (an empty list) has none. Without a binding
 * it is the plugin's own `fallback`, but only while no other command owns
 * that chord; when the (private) hotkey manager is missing the fallback is
 * taken as is, or null without one. */
export function commandHotkey(app: unknown, id: string, fallback: ChordSpec | null): ChordParts | null {
  const parts = (h: ChordSpec | null | undefined): ChordParts | null => {
    const chord = typeof h === "string" ? parseChord(h) : h;
    const key = hotkeyKey(chord);
    return key && chord ? { modifiers: Array.isArray(chord.modifiers) ? [...chord.modifiers] : [], key } : null;
  };
  try {
    const manager = managerOf(app);
    if (manager) {
      const bound = manager.getHotkeys?.(id) ?? manager.getDefaultHotkeys?.(id);
      if (Array.isArray(bound)) {
        for (const h of bound) {
          const chord = parts(h as ChordParts);
          if (chord) return chord;
        }
        return null;
      }
      if (!fallback) return null;
      return chordTakenByOther(app, fallback, id) ? null : parts(fallback);
    }
  } catch {
    /* private API: fall back to the plugin default */
  }
  return parts(fallback);
}

/** The hotkey Obsidian currently has for a command, labelled like every
 * other chord the plugin prints, so a guide follows what the person
 * actually assigned — see commandHotkey for which chord that is. */
export function commandShortcut(app: unknown, id: string, fallback: ChordSpec | null): string | null {
  return hotkeyText(commandHotkey(app, id, fallback));
}

/** A chord written in prose — `Mod+Shift+Enter`, `Cmd/Ctrl+Shift+M`,
 * `Alt+F10` — ending in a real key. Word keys must end there (so
 * `Alt+arrows` is left alone), and a chord never starts mid-word. */
const RE_PROSE_CHORD =
  /(?<![A-Za-z])(?:(?:Mod|Ctrl|Alt|Shift)\+)+(?:(?:Enter|Tab|Escape|Backspace|Delete|Space|F\d{1,2}|Arrow(?:Up|Down|Left|Right)|[A-Za-z0-9])(?![A-Za-z0-9])|[/\\[\],.;'=-])/g;

/** Settings prose with its chords printed the way every other chord in the
 * plugin is (`⌘⇧↩` on a Mac, `Ctrl+Shift+↩` elsewhere). `Cmd/Ctrl+` reads
 * as `Mod+` first; a phrase that names no real key ("Alt+arrows") stays. */
export function expandProseChords(text: string, mac = Platform.isMacOS): string {
  return text
    .replace(/\bCmd\/Ctrl\+/g, "Mod+")
    .replace(RE_PROSE_CHORD, (token) => {
      const { modifiers, key } = parseChord(token);
      return key ? chordLabel(modifiers, key, mac) : token;
    });
}
