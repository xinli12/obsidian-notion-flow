/**
 * Code-block languages: canonical ids (Prism names, which Obsidian
 * highlights), friendly labels and the aliases people actually type, so a
 * ```js fence reads "JavaScript" and picking JavaScript for it changes
 * nothing. Pure: no Obsidian, no i18n.
 */

export interface CodeLanguage { id: string; label: string; aliases: readonly string[] }

const language = (id: string, label: string, ...aliases: string[]): CodeLanguage =>
  Object.freeze({ id, label, aliases: Object.freeze(aliases) });

/** Ordered by `label.toLowerCase()` (codepoint order), which is also the picker's order. */
export const CODE_LANGUAGE_LIST: readonly CodeLanguage[] = Object.freeze([
  language("bash", "Bash", "sh", "zsh", "shell"),
  language("c", "C"),
  language("csharp", "C#", "cs", "c#"),
  language("cpp", "C++", "c++", "cc", "cxx", "hpp"),
  language("css", "CSS"),
  language("dart", "Dart"),
  language("diff", "Diff", "patch"),
  language("dockerfile", "Dockerfile", "docker"),
  language("elixir", "Elixir", "ex", "exs"),
  language("go", "Go", "golang"),
  language("graphql", "GraphQL", "gql"),
  language("haskell", "Haskell", "hs"),
  language("html", "HTML", "htm", "xhtml"),
  language("ini", "INI"),
  language("java", "Java"),
  language("javascript", "JavaScript", "js", "jsx", "mjs", "cjs"),
  language("json", "JSON"),
  language("kotlin", "Kotlin", "kt", "kts"),
  language("latex", "LaTeX", "tex"),
  language("lua", "Lua"),
  language("makefile", "Makefile", "make", "mk"),
  language("markdown", "Markdown", "md"),
  language("matlab", "MATLAB"),
  language("mermaid", "Mermaid"),
  language("objectivec", "Objective-C", "objc"),
  language("perl", "Perl", "pl"),
  language("php", "PHP"),
  language("powershell", "PowerShell", "ps1", "pwsh"),
  language("python", "Python", "py", "py3", "python3"),
  language("r", "R"),
  language("ruby", "Ruby", "rb"),
  language("rust", "Rust", "rs"),
  language("scala", "Scala"),
  language("scss", "SCSS"),
  language("sql", "SQL"),
  language("swift", "Swift"),
  language("toml", "TOML"),
  language("typescript", "TypeScript", "ts", "tsx", "mts", "cts"),
  language("xml", "XML"),
  language("yaml", "YAML", "yml"),
]);

/** alias → canonical id, derived from `CODE_LANGUAGE_LIST`. */
export const CODE_LANGUAGE_ALIASES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(CODE_LANGUAGE_LIST.flatMap((entry) => entry.aliases.map((alias) => [alias, entry.id])))
);

const BY_ID = new Map(CODE_LANGUAGE_LIST.map((entry) => [entry.id, entry]));

/** The canonical id of a fence language: aliases resolve, anything else is its trimmed lower-case self ("dataviewjs"). */
export function canonicalLanguage(token: string): string {
  const key = token.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(CODE_LANGUAGE_ALIASES, key) ? CODE_LANGUAGE_ALIASES[key] : key;
}

export function findLanguage(token: string): CodeLanguage | null {
  return BY_ID.get(canonicalLanguage(token)) ?? null;
}

/** What a language chip shows: the friendly label, or the token as written when it is not listed; "" for none. */
export function languageLabel(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return "";
  return findLanguage(trimmed)?.label ?? trimmed;
}

/** The fence language to write after picking `picked`, or null when it names the language already there. */
export function languageChange(current: string, picked: string): string | null {
  return canonicalLanguage(current) === canonicalLanguage(picked) ? null : picked.trim();
}

export interface LanguageChoice {
  /** "custom": a token the list does not know (typed, current or recent); "none": remove the language;
   * "other": the picker's hand-off to a free-text prompt (the picker adds it; rankLanguages never does). */
  kind: "language" | "custom" | "none" | "other";
  /** What to write into the fence: a canonical id, the custom token, or "" for none. */
  id: string;
  label: string;
  /** The alias or id that matched when the label itself does not show it ("yml" for YAML). */
  note: string;
  /** `[start, end)` highlight runs in `label`. */
  ranges: [number, number][];
  current: boolean;
  recent: boolean;
  score: number;
}

export interface LanguageRankContext {
  /** The fence's language as written ("" for none). */
  current: string;
  /** Most recent first: canonical ids or custom tokens. */
  recent?: readonly string[];
  /** The "No language" row's label (the UI passes it translated). */
  noneLabel?: string;
}

export const LANGUAGE_RECENT_CAP = 5;
/** A typed token that can be a fence language: one word, no backtick or tilde. */
const RE_CUSTOM_TOKEN = /^[^\s`~]+$/;

/** Positions of `q` in `text` as a subsequence (leftmost greedy), merged into runs; null when absent. */
function subsequenceRuns(q: string, text: string): [number, number][] | null {
  const runs: [number, number][] = [];
  let i = 0;
  for (let j = 0; j < text.length && i < q.length; j++) {
    if (text[j] !== q[i]) continue;
    i++;
    const last = runs[runs.length - 1];
    if (last && last[1] === j) last[1] = j + 1;
    else runs.push([j, j + 1]);
  }
  return i === q.length ? runs : null;
}

function highlight(q: string, label: string): [number, number][] {
  const lower = label.toLowerCase();
  const at = lower.indexOf(q);
  if (at >= 0) return [[at, at + q.length]];
  return subsequenceRuns(q, lower) ?? [];
}

/** Match tier of `q` (trimmed, lower-case) against one language: 100 id or alias, 90 label or id prefix,
 * 80 alias prefix, 60 label or id substring, 40 subsequence of the label, 0 none; with the alias shown. */
function languageTier(q: string, entry: CodeLanguage): { tier: number; via: string } {
  const label = entry.label.toLowerCase();
  if (entry.id === q) return { tier: 100, via: entry.id };
  const alias = entry.aliases.find((a) => a === q);
  if (alias) return { tier: 100, via: alias };
  if (label.startsWith(q) || entry.id.startsWith(q)) return { tier: 90, via: entry.id };
  const aliasPrefix = entry.aliases.find((a) => a.startsWith(q));
  if (aliasPrefix) return { tier: 80, via: aliasPrefix };
  if (label.includes(q) || entry.id.includes(q)) return { tier: 60, via: entry.id };
  if (subsequenceRuns(q, label)) return { tier: 40, via: "" };
  return { tier: 0, via: "" };
}

/**
 * The picker's rows. Empty query: the current language first (so a stray
 * Enter changes nothing), then recents, then every language, then "No
 * language" when the fence has one. Typed query: languages by tier (+5 when
 * recent, ties in list order), then the current and recent custom tokens it
 * matches (equal 100, prefix 90, substring 60, subsequence 40, +5 when
 * recent), "No language" when it matches, and a custom row for the typed
 * token unless it names a listed language or one of those tokens outright.
 */
export function rankLanguages(query: string, ctx: LanguageRankContext): LanguageChoice[] {
  const current = ctx.current.trim();
  const currentId = canonicalLanguage(current);
  const recent = (ctx.recent ?? []).map((token) => token.trim()).filter(Boolean);
  const recentIds = new Set(recent.map(canonicalLanguage));
  const noneLabel = ctx.noneLabel ?? "No language";
  const row = (token: string, extra: Partial<LanguageChoice> = {}): LanguageChoice => {
    const entry = findLanguage(token);
    const id = entry ? entry.id : token;
    return {
      kind: entry ? "language" : "custom", id, label: entry ? entry.label : token, note: "", ranges: [],
      current: !!current && canonicalLanguage(id) === currentId, recent: recentIds.has(canonicalLanguage(id)), score: 0,
      ...extra,
    };
  };
  const none = (extra: Partial<LanguageChoice> = {}): LanguageChoice => ({
    kind: "none", id: "", label: noneLabel, note: "", ranges: [], current: false, recent: false, score: 0, ...extra,
  });

  const q = query.trim().toLowerCase();
  if (!q) {
    const rows: LanguageChoice[] = [];
    const seen = new Set<string>();
    const add = (token: string) => {
      const key = canonicalLanguage(token);
      if (!key || seen.has(key)) return;
      seen.add(key);
      rows.push(row(token));
    };
    if (current) add(current);
    recent.slice(0, LANGUAGE_RECENT_CAP).forEach(add);
    CODE_LANGUAGE_LIST.forEach((entry) => add(entry.id));
    if (current) rows.push(none());
    return rows;
  }

  const scored: LanguageChoice[] = [];
  let exact = false;
  CODE_LANGUAGE_LIST.forEach((entry) => {
    const { tier, via } = languageTier(q, entry);
    if (tier === 0) return;
    if (tier === 100) exact = true;
    const labelShows = entry.label.toLowerCase().includes(q);
    const choice = row(entry.id, { note: labelShows ? "" : via, ranges: highlight(q, entry.label) });
    choice.score = tier + (choice.recent ? 5 : 0);
    scored.push(choice);
  });
  // The current and recent custom languages stay findable while typing, as they are listed in the empty
  // query: "data" offers a recent dataviewjs rather than only the fragment "data".
  const seenCustom = new Set<string>();
  [current, ...recent.slice(0, LANGUAGE_RECENT_CAP)].forEach((token) => {
    const key = token.toLowerCase();
    if (!key || findLanguage(token) || seenCustom.has(key)) return;
    seenCustom.add(key);
    const tier = key === q ? 100 : key.startsWith(q) ? 90 : key.includes(q) ? 60 : subsequenceRuns(q, key) ? 40 : 0;
    if (tier === 0) return;
    if (tier === 100) exact = true;
    const choice = row(token, { ranges: highlight(q, token) });
    choice.score = tier + (choice.recent ? 5 : 0);
    scored.push(choice);
  });
  if (current) {
    const label = noneLabel.toLowerCase();
    const tier = label.startsWith(q) || "none".startsWith(q) ? 90 : label.includes(q) ? 60 : 0;
    if (tier) scored.push(none({ score: tier, ranges: label.includes(q) ? highlight(q, noneLabel) : [] }));
  }
  // Stable: ties keep list order, which is label order.
  scored.sort((a, b) => b.score - a.score);
  const typed = query.trim();
  // Neither a listed language nor a current or recent custom one (none scored 100), so `row` makes it a custom row.
  if (!exact && RE_CUSTOM_TOKEN.test(typed)) scored.push(row(typed));
  return scored;
}

/** `token` first in the recent list: canonical for listed languages, custom tokens as typed, deduped, capped. */
export function pushRecentLanguage(recent: readonly string[], token: string): string[] {
  const trimmed = token.trim();
  if (!trimmed) return [...recent];
  const key = canonicalLanguage(trimmed);
  const entry = findLanguage(trimmed)?.id ?? trimmed;
  return [entry, ...recent.filter((item) => canonicalLanguage(item) !== key)].slice(0, LANGUAGE_RECENT_CAP);
}
