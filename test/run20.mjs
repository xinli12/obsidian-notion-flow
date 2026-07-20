import { intersectingTagRanges } from "./bundle.mjs";

let fail = 0;
const check = (name, got, expected) => {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: got ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`
  );
};

/* Selection fully inside the anchored text — the concealed-tags case that
 * used to clear nothing. Tags sit OUTSIDE the selection and must go. */
{
  const text = 'a <span style="color:red">red text</span> b';
  const open = { from: 2, to: text.indexOf(">") + 1 };
  const close = { from: text.indexOf("</span>"), to: text.indexOf("</span>") + 7 };
  const mid = open.to + 2; // inside "red text"
  check(
    "selection inside colored text removes both tags",
    intersectingTagRanges(text, mid, mid + 3),
    [open, close]
  );
  check(
    "selection before the pair removes nothing",
    intersectingTagRanges(text, 0, 1),
    []
  );
  check(
    "selection after the pair removes nothing",
    intersectingTagRanges(text, text.length - 1, text.length),
    []
  );
  check(
    "partial overlap still removes the whole pair",
    intersectingTagRanges(text, 0, open.to + 1),
    [open, close]
  );
}

/* Nested pairs: every intersecting pair loses both tags. */
{
  const text = "<u><b>x</b></u>";
  check(
    "nested pairs all removed",
    intersectingTagRanges(text, 6, 7).length,
    4
  );
}

/* Comment anchors are content, not formatting. */
{
  const text = '<span class="nf-cmt" data-nf-cmt="note">anchored</span>';
  check("comment pair survives", intersectingTagRanges(text, 41, 45), []);
}
{
  // A color span nested inside a comment anchor is still formatting.
  const text =
    '<span class="nf-cmt" data-nf-cmt="n"><span style="color:red">c</span>x</span>';
  const got = intersectingTagRanges(text, 62, 63); // inside "c"
  check("color inside comment is cleared, comment kept", got.length, 2);
  check(
    "cleared tags are the color pair",
    text.slice(got[0].from, got[0].to).startsWith('<span style="color:'),
    true
  );
}

if (fail > 0) {
  console.error(`${fail} FAILED`);
  process.exit(1);
}
console.log("ALL PASS");
