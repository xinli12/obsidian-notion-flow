import type { Text } from "@codemirror/state";

/* Only the plugin's own exact shapes are matched, and style values are
 * restricted to a charset that cannot smuggle URLs or extra CSS
 * properties into the decoration (no ':', ';', '/' or quotes). The bare
 * <b>/<i>/<s> tags are what the toolbar writes inside fenced code blocks,
 * where Markdown markers would stay literal text. Comment anchors carry
 * their note in data-nf-cmt — the value is display-only text (tooltip,
 * modal, title attribute), never style or markup, so its charset only
 * excludes what would break the attribute itself. The empty class-only
 * spans are markers — a table's (nf-tbl / nf-cell) and a block
 * background's (nf-blk, src/features/block-color.ts) — so they pair with a
 * null style and are concealed and cleared like any other tag. */
const RE_NF_TAG =
  /<span style="color:([-\w(),.%# ]{1,64})">|<mark style="background:([-\w(),.%# ]{1,64});color:inherit">|<span class="nf-cmt" data-nf-cmt="([^"<>]*)">|<span class="nf-(?:cell|tbl|blk)-[a-z]{1,12}">|<[ubis]>|<\/(?:span|mark|u|b|i|s)>/g;

/** Rendered style for each bare formatting tag the plugin understands. */
const BARE_TAG_STYLES: Record<string, string> = {
  u: "text-decoration:underline",
  b: "font-weight:bold",
  i: "font-style:italic",
  s: "text-decoration:line-through",
};

export interface TagPair {
  open: { from: number; to: number };
  close: { from: number; to: number };
  /** Inline style re-applied to the inner text, or null (table and block
   *  background markers). */
  style: string | null;
  /** Raw (still attribute-encoded) comment text of an nf-cmt anchor. */
  comment: string | null;
}

/**
 * `[from, to]` with each end moved out of any tag it sits inside, in the
 * direction that shrinks the range, or null when nothing is left. Hidden
 * tags are never meant to be part of a selection: a double-click at a
 * widget's edge can still select the concealed `>` of `</span>`, and
 * wrapping or recolouring that would write `</span<span …>>` into the
 * note.
 */
export function clampRangeOutOfTags(
  pairs: readonly TagPair[],
  from: number,
  to: number
): { from: number; to: number } | null {
  let start = from;
  let end = to;
  // Moving an end out of one tag can land it inside a neighbour's
  // (`</u></b>`), so settle before answering.
  for (let changed = true, rounds = 0; changed && rounds < 8; rounds++) {
    changed = false;
    for (const pair of pairs) {
      let next = start;
      if (next > pair.open.from && next < pair.open.to) next = pair.open.to;
      else if (next >= pair.close.from && next < pair.close.to) next = pair.close.to;
      let nextEnd = end;
      if (nextEnd > pair.close.from && nextEnd < pair.close.to) nextEnd = pair.close.from;
      else if (nextEnd > pair.open.from && nextEnd <= pair.open.to) nextEnd = pair.open.from;
      if (next !== start || nextEnd !== end) {
        start = next;
        end = nextEnd;
        changed = true;
      }
    }
  }
  return start < end ? { from: start, to: end } : null;
}

/** Convert an offset measured in rendered/visible text back to its source
 * position while skipping concealed source ranges. */
export function sourceOffsetFromVisibleOffset(
  start: number,
  end: number,
  visibleOffset: number,
  hiddenRanges: readonly { from: number; to: number }[]
): number {
  let source = start;
  let remaining = Math.max(0, visibleOffset);
  const hidden = hiddenRanges
    .map((range) => ({
      from: Math.max(start, range.from),
      to: Math.min(end, range.to),
    }))
    .filter((range) => range.from < range.to)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  for (const range of hidden) {
    if (range.to <= source) continue;
    const visible = Math.max(0, range.from - source);
    if (remaining < visible || (remaining === visible && visible > 0)) {
      return Math.min(end, source + remaining);
    }
    remaining -= visible;
    source = range.to;
  }
  return Math.min(end, source + remaining);
}

/** All well-formed plugin color tag pairs in `text` (offsets into it). */
export function findColorTagPairs(text: string): TagPair[] {
  const pairs: TagPair[] = [];
  type Open = {
    from: number;
    to: number;
    el: "span" | "mark" | "u" | "b" | "i" | "s";
    style: string | null;
    comment: string | null;
  };
  const stack: Open[] = [];
  RE_NF_TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_NF_TAG.exec(text))) {
    const from = m.index;
    const to = from + m[0].length;
    if (m[0].startsWith("</")) {
      const el = m[0].slice(2, -1) as Open["el"];
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].el !== el) continue;
        const open = stack.splice(i, 1)[0];
        pairs.push({
          open: { from: open.from, to: open.to },
          close: { from, to },
          style: open.style,
          comment: open.comment,
        });
        break;
      }
    } else {
      const bare = /^<([ubis])>$/.exec(m[0])?.[1];
      stack.push({
        from,
        to,
        el: bare
          ? (bare as Open["el"])
          : m[0].startsWith("<mark")
            ? "mark"
            : "span",
        style: bare
          ? BARE_TAG_STYLES[bare]
          : m[1]
            ? `color:${m[1]}`
            : m[2]
              ? `background:${m[2]}`
              : null,
        comment: m[3] ?? null,
      });
    }
  }
  return pairs;
}

/**
 * `findColorTagPairs` over the whole document, memoised per document
 * version. Toolbar state, hotkeys and decoration passes each asked for the
 * full text and re-scanned it on every keystroke; documents are immutable,
 * so one scan per version serves them all. Keyed by the Text (not a single
 * slot) so split panes and column sub-editors asking about different
 * documents never evict each other — mirrors cachedFences in main.ts.
 */
const pairCache = new WeakMap<Text, TagPair[]>();
export function cachedColorTagPairs(doc: Text): TagPair[] {
  let pairs = pairCache.get(doc);
  if (!pairs) {
    pairs = findColorTagPairs(doc.toString());
    pairCache.set(doc, pairs);
  }
  return pairs;
}

export interface HtmlConcealPolicy {
  concealHtml: boolean;
  commenting: boolean;
}

/** Comment anchors and ordinary formatting tags have independent settings.
 * Keep this decision shared by decorations, atomic ranges, and boundary
 * deletion so no source token is protected unless it is actually hidden. */
export function shouldConcealTagPair(
  pair: Pick<TagPair, "comment">,
  policy: HtmlConcealPolicy
): boolean {
  return pair.comment != null ? policy.commenting : policy.concealHtml;
}

/** The exact tag pairs hidden by the current HTML/comment settings. */
export function concealedTagPairs(
  text: string,
  policy: HtmlConcealPolicy
): TagPair[] {
  return findColorTagPairs(text).filter((pair) =>
    shouldConcealTagPair(pair, policy)
  );
}

/** Whether the boundary-delete keymap has any concealed syntax to protect. */
export function concealBoundaryProtectionEnabled(
  policy: HtmlConcealPolicy & { concealMarkdown: boolean }
): boolean {
  return policy.concealMarkdown || policy.concealHtml || policy.commenting;
}

