/* HTML formatting and comment anchors must share one conceal policy. */
import { EditorState } from "@codemirror/state";
import {
  concealBoundaryProtectionEnabled,
  concealedTagPairs,
  planConcealedBoundaryDelete,
} from "./bundle.mjs";

let fail = 0;
const check = (name, got, expected) => {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: got ${JSON.stringify(got)}` +
      (ok ? "" : ` expected ${JSON.stringify(expected)}`)
  );
};

const comment =
  '<span class="nf-cmt" data-nf-cmt="note">comment</span>';
const html = "<u>html</u>";
const source = `${comment} ${html}`;
const policy = (commenting, concealHtml, concealMarkdown = false) => ({
  commenting,
  concealHtml,
  concealMarkdown,
});
const kinds = (pairs) =>
  pairs.map((pair) => (pair.comment != null ? "comment" : "html"));
const ranges = (pairs) =>
  pairs.flatMap((pair) => [pair.open, pair.close]);

const commentOnly = concealedTagPairs(source, policy(true, false));
const htmlOnly = concealedTagPairs(source, policy(false, true));
const both = concealedTagPairs(source, policy(true, true));
const neither = concealedTagPairs(source, policy(false, false));

check(
  "commenting alone conceals only the comment anchor",
  kinds(commentOnly),
  ["comment"]
);
check(
  "HTML conceal alone leaves comments visible",
  kinds(htmlOnly),
  ["html"]
);
check("both settings conceal both pair kinds", kinds(both), ["comment", "html"]);
check("both settings off conceal nothing", kinds(neither), []);

check(
  "commenting alone enables boundary protection",
  concealBoundaryProtectionEnabled(policy(true, false)),
  true
);
check(
  "HTML conceal alone enables boundary protection",
  concealBoundaryProtectionEnabled(policy(false, true)),
  true
);
check(
  "Markdown conceal alone enables boundary protection",
  concealBoundaryProtectionEnabled(policy(false, false, true)),
  true
);
check(
  "no conceal setting leaves the delete keymap inactive",
  concealBoundaryProtectionEnabled(policy(false, false)),
  false
);

const doc = EditorState.create({ doc: source }).doc;
const commentPair = commentOnly[0];
const htmlPair = htmlOnly[0];

const commentBackspace = planConcealedBoundaryDelete(
  doc,
  commentPair.close.to,
  -1,
  ranges(commentOnly)
);
check(
  "comment-only Backspace skips the hidden closing tag",
  commentBackspace && {
    deleted: source.slice(commentBackspace.from, commentBackspace.to),
    to: commentBackspace.to,
  },
  { deleted: "t", to: commentPair.close.from }
);
check(
  "visible comment tag is not treated as an HTML atomic boundary",
  planConcealedBoundaryDelete(
    doc,
    commentPair.close.to,
    -1,
    ranges(htmlOnly)
  ),
  null
);

const commentDelete = planConcealedBoundaryDelete(
  doc,
  commentPair.open.from,
  1,
  ranges(commentOnly)
);
check(
  "comment-only Delete skips the hidden opening tag",
  commentDelete && {
    deleted: source.slice(commentDelete.from, commentDelete.to),
    from: commentDelete.from,
  },
  { deleted: "c", from: commentPair.open.to }
);

const htmlBackspace = planConcealedBoundaryDelete(
  doc,
  htmlPair.close.to,
  -1,
  ranges(htmlOnly)
);
check(
  "HTML-only Backspace still protects an ordinary hidden tag",
  htmlBackspace && {
    deleted: source.slice(htmlBackspace.from, htmlBackspace.to),
    to: htmlBackspace.to,
  },
  { deleted: "l", to: htmlPair.close.from }
);
check(
  "comment-only ranges do not protect a visible ordinary HTML tag",
  planConcealedBoundaryDelete(
    doc,
    htmlPair.close.to,
    -1,
    ranges(commentOnly)
  ),
  null
);

if (fail) process.exit(1);
