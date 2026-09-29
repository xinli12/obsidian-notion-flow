/** What the search reads from a slash command (main.ts's `SlashCommand` carries these fields and more). */
export interface SlashSearchEntry {
  id: string;
  name: string;
  keywords: string;
  pinyin?: string;
  /** Listed only for a query that matches it (and among recents), never in the unfiltered menu. */
  queryOnly?: boolean;
  /** Menu section ("basic", "list", "container", "media", "advanced", "date", "template"); search never reorders by it. */
  group?: string;
  /** A query must match at this tier or above to list the entry (templates use `SLASH_STRONG_TIER`: their
   * fixed keywords would otherwise answer every fragment of "template", such as /em, /lat or /pla). */
  minTier?: number;
}
interface Features { columnLayout: boolean; toggleBlocks: boolean }

/** A match at this tier or above is deliberate: an id, name, keyword or pinyin prefix. */
export const SLASH_STRONG_TIER = 80;
/** Fuzzy matches (characters in order) score at or below this tier. */
export const SLASH_FUZZY_TIER = 40;

export function slashCommandEnabled(command: Pick<SlashSearchEntry, "id">, features: Features): boolean {
  if (command.id === "toggle") return features.toggleBlocks !== false;
  if (command.id.startsWith("cols")) return features.columnLayout !== false;
  return true;
}

/** @deprecated Use `scoreSlashCommand`; the numeric score covers the
 * prefix tiers and adds fuzzy, pinyin and recency ranking. */
export function slashPrefixMatch(command: SlashSearchEntry, query: string): boolean {
  const q = query.toLowerCase();
  return command.id.startsWith(q) || command.name.toLowerCase().startsWith(q) ||
    command.keywords.toLowerCase().split(" ").some((word) => word.startsWith(q));
}

/** Every character of `q` occurs in `text`, in order (leftmost greedy
 * search, which finds an embedding whenever one exists). */
function isSubsequence(q: string, text: string): boolean {
  let i = 0;
  for (let j = 0; j < text.length && i < q.length; j++) {
    if (text[j] === q[i]) i++;
  }
  return i === q.length;
}

/**
 * How well `command` answers `query`, before recency (0 = no match; an empty
 * query matches nothing, callers keep their recency order for it). Tiers: id
 * prefix 100, name prefix 90, prefix of any name/keyword/pinyin word 80,
 * substring of the joined fields 60, fuzzy (characters in order) inside one
 * word of any field 40, fuzzy across the id and name 30. Pinyin lets a
 * Chinese name be typed without switching input methods ("bg" → 表格), and
 * the fuzzy tiers forgive dropped letters ("tdo" → todo, "hd1" → Heading 1).
 * Cross-word fuzzy stays on what the menu shows: over long keyword lists
 * almost any short query finds its letters somewhere, which buries the real
 * matches in noise.
 */
export function slashMatchTier(command: SlashSearchEntry, query: string): number {
  const q = query.toLowerCase();
  if (!q) return 0;
  const id = command.id.toLowerCase();
  const name = command.name.toLowerCase();
  const fields = `${name} ${command.keywords} ${command.pinyin ?? ""}`.toLowerCase();
  const haystack = `${id} ${fields}`;
  if (id.startsWith(q)) return 100;
  if (name.startsWith(q)) return 90;
  if (fields.split(/\s+/).some((word) => word.startsWith(q))) return 80;
  if (haystack.includes(q)) return 60;
  if (haystack.split(/\s+/).some((word) => isSubsequence(q, word))) return 40;
  if (isSubsequence(q, `${id} ${name}`)) return 30;
  return 0;
}

/** `slashMatchTier` plus 15 when the id is in `recent`; recency never turns
 * a miss into a hit. A one-number summary only: `searchSlashCommands` does
 * not rank by it, because +15 let a recent name prefix (90) outrank another
 * command's id prefix (100), so "/table" chose a recently used "Table of
 * contents". */
export function scoreSlashCommand(command: SlashSearchEntry, query: string, recent: readonly string[] = []): number {
  const tier = slashMatchTier(command, query);
  return tier > 0 && recent.includes(command.id) ? tier + 15 : tier;
}

/** The query names `command` outright: its id, its (current-language)
 * name or one of its pinyin words, case-insensitive ("table", "表格",
 * "biaoge"). */
export function slashExactMatch(command: SlashSearchEntry, query: string): boolean {
  const q = query.toLowerCase();
  if (!q) return false;
  return command.id.toLowerCase() === q || command.name.toLowerCase() === q ||
    (command.pinyin ?? "").toLowerCase().split(/\s+/).includes(q);
}

/** Shared ordering and feature gates for main and embedded editors. With a
 * query, matches below a command's own `minTier` are dropped first; the rest
 * are ranked by an exact match (`slashExactMatch`) first, then by tier, then
 * recently used before not, then the menu's own order. Recency reorders only
 * inside a tier, so "/table" stays on Table after "/toc" was used ("Table of
 * contents" is only a name prefix). Once any command matches deliberately
 * (tier ≥ `SLASH_STRONG_TIER`) the fuzzy ones (≤ `SLASH_FUZZY_TIER`) are
 * dropped: "/toc" shows the table of contents, not "Foldable callout"
 * because t-o-c occurs inside "toggle-callout". When nothing matches
 * deliberately, fuzzy hits stay ("hd1" → Heading 1). Recency never rescues
 * a dropped match. Without a query, recently used commands lead and
 * `queryOnly` entries are left out unless they are among the recents. */
export function searchSlashCommands<T extends SlashSearchEntry>(
  commands: readonly T[], query: string, features: Features, recent: readonly string[] = []
): T[] {
  const all = commands.filter((command) => slashCommandEnabled(command, features));
  const q = query.toLowerCase();
  if (!q) {
    const boosted = recent.map((id) => all.find((command) => command.id === id))
      .filter((command): command is T => command != null);
    return [...boosted, ...all.filter((command) => !command.queryOnly && !recent.includes(command.id))];
  }
  const scored = all
    .map((command, index) => ({
      command, index, tier: slashMatchTier(command, q),
      exact: slashExactMatch(command, q) ? 1 : 0,
      recent: recent.includes(command.id) ? 1 : 0,
    }))
    .filter((entry) => entry.tier > 0 && entry.tier >= (entry.command.minTier ?? 0));
  const strong = scored.some((entry) => entry.tier >= SLASH_STRONG_TIER);
  return scored
    .filter((entry) => !strong || entry.tier > SLASH_FUZZY_TIER)
    .sort((a, b) => b.exact - a.exact || b.tier - a.tier || b.recent - a.recent || a.index - b.index)
    .map((entry) => entry.command);
}
