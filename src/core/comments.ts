/** Comment text → attribute-safe form. Only what would break the
 * attribute or the tag shape is escaped, so CJK text stays readable in
 * source. Newlines become &#10; to keep the tag on one line. */
export function encodeCommentAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r?\n/g, "&#10;");
}

/** Inverse of encodeCommentAttr. `&amp;` is decoded LAST, so encoded
 * literals ("&amp;#10;") can never double-decode. */
export function decodeCommentAttr(value: string): string {
  return value
    .replace(/&#10;/g, "\n")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** The full anchor markup for a comment on `selected`, or null when the
 * selection cannot carry one (empty, or spanning lines). */
export function buildCommentWrap(selected: string, comment: string): string | null {
  if (!selected || selected.includes("\n")) return null;
  const body = comment.trim();
  if (!body) return null;
  return `<span class="nf-cmt" data-nf-cmt="${encodeCommentAttr(body)}">${selected}</span>`;
}

