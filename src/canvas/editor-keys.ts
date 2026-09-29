/** A list item or task: `- `, `* `, `+ `, `1. ` or `1) `. */
const LIST_LINE = /^\s*(?:[-*+]|\d{1,9}[.)])\s/;
const QUOTE_LINE = /^\s*>/;
const TABLE_LINE = /^\s*\|/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;
const MATH_FENCE = /^\s*\$\$\s*$/;

/** The fence a line opens a code block with; a backtick run with backticks after it is inline code. */
function openingFence(line: string): string | null {
  const fence = FENCE.exec(line);
  return fence && !(fence[1][0] === "`" && fence[2].includes("`")) ? fence[1] : null;
}

/**
 * Whether Enter and Tab at `caret` belong to the Markdown being written
 * rather than to the card: a list item continues on Enter and indents on Tab,
 * a quote or callout continues, a table row is the table's, and code or maths
 * is written line by line — as is the fence that opens it.
 */
export function markdownOwnsKeys(text: string, caret: number): boolean {
  const at = Math.max(0, Math.min(caret, text.length));
  const start = at === 0 ? 0 : text.lastIndexOf("\n", at - 1) + 1;
  const end = text.indexOf("\n", at);
  const line = text.slice(start, end < 0 ? text.length : end);
  if (LIST_LINE.test(line) || QUOTE_LINE.test(line) || TABLE_LINE.test(line) || openingFence(line) || MATH_FENCE.test(line)) {
    return true;
  }
  // Inside a block opened on an earlier line and not closed before this one.
  let open: string | null = null;
  for (const earlier of text.slice(0, start).split("\n")) {
    if (open === "$$") {
      if (MATH_FENCE.test(earlier)) open = null;
      continue;
    }
    if (open) {
      const fence = FENCE.exec(earlier);
      if (fence && fence[1][0] === open[0] && fence[1].length >= open.length && !fence[2].trim()) open = null;
    } else open = openingFence(earlier) ?? (MATH_FENCE.test(earlier) ? "$$" : null);
  }
  return open !== null;
}

/** The words of a card without the blank lines and spaces left after them. */
export function withoutTrailingBlank(text: string): string {
  return text.replace(/\s+$/, "");
}

/** Links as written in a card: wikilinks and embeds, Markdown links, and bare or bracketed URLs. */
const LINKS = [/!?\[\[[^\]\n]+\]\]/g, /!?\[[^\]\n]*\]\([^)\n]+\)/g, /<?(?:https?|obsidian|file|mailto):[^\s<>)\]]+>?/gi];

/** The caret's line and its column in it. */
function caretLine(text: string, caret: number): { line: string; column: number } {
  const at = Math.max(0, Math.min(caret, text.length));
  const start = at === 0 ? 0 : text.lastIndexOf("\n", at - 1) + 1;
  const end = text.indexOf("\n", at);
  return { line: text.slice(start, end < 0 ? text.length : end), column: at - start };
}

/**
 * Whether the caret is on a link, its ends included: there Mod+Enter opens
 * the link, as everywhere in Obsidian, rather than finishing the card.
 */
export function linkAt(text: string, caret: number): boolean {
  const { line, column } = caretLine(text, caret);
  return LINKS.some((pattern) => [...line.matchAll(pattern)]
    .some((match) => column >= match.index! && column <= match.index! + match[0].length));
}

/**
 * Where the wikilink or Markdown link at the caret leads, its ends
 * included: `[[Target|Name]]` gives `Target`, `[Name](dest)` gives `dest`.
 * Null off such a link.
 */
export function linkTargetAt(text: string, caret: number): string | null {
  const { line, column } = caretLine(text, caret);
  const on = (match: RegExpMatchArray) => column >= match.index! && column <= match.index! + match[0].length;
  for (const match of line.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) if (on(match)) return match[1].split("|")[0].trim();
  for (const match of line.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) if (on(match)) return match[1].trim().replace(/^<(.*)>$/, "$1");
  return null;
}
