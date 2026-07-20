import {
  encodeCommentAttr,
  decodeCommentAttr,
  buildCommentWrap,
  findColorTagPairs,
} from "./bundle.mjs";

let fail = 0;
const check = (name, got, expected) => {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: got ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`
  );
};

/* ---------- attribute encoding ---------- */
check("encode plain CJK untouched", encodeCommentAttr("这里要再想一下"), "这里要再想一下");
check(
  "encode escapes attribute breakers",
  encodeCommentAttr('a "b" <c> & d'),
  "a &quot;b&quot; &lt;c&gt; &amp; d"
);
check("encode newline", encodeCommentAttr("a\nb"), "a&#10;b");
check("encode crlf", encodeCommentAttr("a\r\nb"), "a&#10;b");

const roundtrip = (s) => decodeCommentAttr(encodeCommentAttr(s));
check("roundtrip quotes+cjk", roundtrip('说 "引号" & <标签>'), '说 "引号" & <标签>');
check("roundtrip multi-line", roundtrip("line1\nline2"), "line1\nline2");
check(
  "roundtrip literal entity text",
  roundtrip("write &#10; and &quot; literally"),
  "write &#10; and &quot; literally"
);
check("decode never double-decodes", decodeCommentAttr("&amp;quot;"), "&quot;");

/* ---------- buildCommentWrap ---------- */
check(
  "wrap basic",
  buildCommentWrap("anchor", "note"),
  '<span class="nf-cmt" data-nf-cmt="note">anchor</span>'
);
check(
  "wrap escapes the note",
  buildCommentWrap("x", 'say "hi"'),
  '<span class="nf-cmt" data-nf-cmt="say &quot;hi&quot;">x</span>'
);
check("wrap trims empty note", buildCommentWrap("x", "   "), null);
check("wrap rejects empty selection", buildCommentWrap("", "note"), null);
check("wrap rejects multi-line selection", buildCommentWrap("a\nb", "note"), null);

/* ---------- findColorTagPairs recognizes comment anchors ---------- */
{
  const text = 'before <span class="nf-cmt" data-nf-cmt="想一下 &quot;这里&quot;">anchored</span> after';
  const pairs = findColorTagPairs(text);
  check("comment pair found", pairs.length, 1);
  check("comment raw value captured", pairs[0].comment, "想一下 &quot;这里&quot;");
  check("comment pair carries no style", pairs[0].style, null);
  check(
    "comment inner range",
    text.slice(pairs[0].open.to, pairs[0].close.from),
    "anchored"
  );
  check("comment decodes", decodeCommentAttr(pairs[0].comment), '想一下 "这里"');
}
{
  // A color span nested inside the anchor still pairs correctly.
  const text =
    '<span class="nf-cmt" data-nf-cmt="n"><span style="color:red">c</span>x</span>';
  const pairs = findColorTagPairs(text);
  check("nested pair count", pairs.length, 2);
  const comment = pairs.find((p) => p.comment != null);
  const color = pairs.find((p) => p.comment == null);
  check("nested comment wraps whole", text.slice(comment.open.to, comment.close.from), '<span style="color:red">c</span>x');
  check("nested color style kept", color.style, "color:red");
}
{
  // Non-comment tags keep comment: null.
  const pairs = findColorTagPairs("<u>x</u>");
  check("plain tag comment is null", pairs[0].comment, null);
}
{
  // A double quote cannot appear raw inside the attribute — the shape
  // simply does not match, so nothing is concealed or clickable.
  const pairs = findColorTagPairs('<span class="nf-cmt" data-nf-cmt="a"b">x</span>');
  check("raw quote breaks the shape", pairs.length, 0);
}

if (fail > 0) {
  console.error(`${fail} FAILED`);
  process.exit(1);
}
console.log("ALL PASS");
