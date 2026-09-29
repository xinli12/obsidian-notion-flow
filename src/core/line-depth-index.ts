/** Count enclosing line ranges once, rather than walking every ancestor
 * again for each visible line. The start line is not its own descendant. */
export function buildLineDepthIndex(
  lineCount: number,
  ranges: Iterable<{ startLine: number; endLine: number }>
): Int32Array {
  const depths = new Int32Array(lineCount + 2);
  for (const range of ranges) {
    if (range.endLine <= range.startLine) continue;
    depths[range.startLine + 1]++;
    depths[range.endLine + 1]--;
  }
  for (let line = 1; line <= lineCount; line++) depths[line] += depths[line - 1];
  return depths;
}

/** The same count for the lines [from, to) only, indexed by `line - from`.
 * Ranges are clipped to the window: a caller that knows no range from
 * outside it reaches in (a list segment, see listNestingDepth) builds just
 * the part of the note it reads, instead of the whole note per keystroke. */
export function buildLineDepthIndexRange(
  from: number,
  to: number,
  ranges: Iterable<{ startLine: number; endLine: number }>
): Int32Array {
  const size = Math.max(0, to - from);
  const depths = new Int32Array(size + 1);
  for (const range of ranges) {
    const first = Math.max(range.startLine + 1, from);
    const last = Math.min(range.endLine, to - 1);
    if (first > last) continue;
    depths[first - from]++;
    depths[last - from + 1]--;
  }
  for (let i = 1; i < size; i++) depths[i] += depths[i - 1];
  return depths;
}
