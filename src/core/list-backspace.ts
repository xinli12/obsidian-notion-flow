/**
 * Backspace at the content start of a list item. Notion removes the marker
 * first, so the item becomes plain text at the same depth (indentation and
 * quote prefixes stay), and only a second Backspace joins the line above.
 * Editors that merge lines immediately lose the position in the list.
 */

const RE_LIST_MARKER = /^([ \t]*)((?:>[ \t]?)*)([-*+]|\d+[.)])[ \t](\[[ xX]\][ \t])?/;

/** The marker range to delete when the caret sits exactly after a list or
 * task marker at column `headCol` of `lineText`, else null. Task boxes go
 * together with their bullet: `- [ ] ` becomes an empty line in one step. */
export function listMarkerBackspacePlan(
  lineText: string,
  headCol: number
): { from: number; to: number } | null {
  const m = RE_LIST_MARKER.exec(lineText);
  if (!m || headCol !== m[0].length) return null;
  return { from: m[1].length + m[2].length, to: m[0].length };
}
