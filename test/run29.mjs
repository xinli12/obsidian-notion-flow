import { EditorState } from "@codemirror/state";
import {
  buildBlockCaption,
  codeCaptionMeta,
  fenceExitPlan,
  getBlockRange,
  imageCaptionMeta,
  isImageBlockLine,
  parseBlockCaption,
  scanFences,
} from "./bundle.mjs";

let failures = 0;
const equal = (name, got, expected) => {
  const pass = JSON.stringify(got) === JSON.stringify(expected);
  if (!pass) failures++;
  console.log(
    `${pass ? "PASS" : "FAIL"} ${name}` +
      (pass ? "" : ` :: got ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`)
  );
};
const docOf = (source) => EditorState.create({ doc: source }).doc;

equal(
  "code caption serializes portable HTML and fold state",
  buildBlockCaption("code", 'Result <A> & "B"', true),
  '<small class="nf-caption" data-nf-kind="code" data-nf-collapsed="true">Result &lt;A&gt; &amp; &quot;B&quot;</small>'
);
equal(
  "caption parser restores entities and quote prefix",
  parseBlockCaption(
    '> <small class="nf-caption" data-nf-kind="image">A &amp; B</small>'
  ),
  {
    kind: "image",
    caption: "A & B",
    collapsed: false,
    prefix: "> ",
    // The text slice between the two tags: Live Preview hides the tags and
    // edits exactly this range in place.
    bodyFrom: 49,
    bodyTo: 58,
  }
);
equal(
  "empty expanded code metadata disappears",
  buildBlockCaption("code", "", false),
  null
);
equal(
  "empty collapsed code metadata persists",
  buildBlockCaption("code", "", true),
  '<small class="nf-caption" data-nf-kind="code" data-nf-collapsed="true"></small>'
);

{
  const doc = docOf([
    "```ts",
    "const answer = 42;",
    "```",
    '<small class="nf-caption" data-nf-kind="code">The answer</small>',
    "after",
  ].join("\n"));
  const fences = scanFences(doc);
  equal("code metadata is found after the closer", codeCaptionMeta(doc, fences[0]), {
    kind: "code",
    caption: "The answer",
    collapsed: false,
    prefix: "",
    bodyFrom: 46,
    bodyTo: 56,
    lineNo: 4,
  });
  equal("fence and caption drag as one block", getBlockRange(doc, 2, fences), {
    startLine: 1,
    endLine: 4,
  });
  equal("caption resolves back to its fence block", getBlockRange(doc, 4, fences), {
    startLine: 1,
    endLine: 4,
  });
}

{
  const doc = docOf([
    "![[diagram.png]]",
    '<small class="nf-caption" data-nf-kind="image">System map</small>',
    "after",
  ].join("\n"));
  equal("wiki image is a media block", isImageBlockLine(doc.line(1).text), true);
  equal("image caption metadata is found", imageCaptionMeta(doc, 1), {
    kind: "image",
    caption: "System map",
    collapsed: false,
    prefix: "",
    bodyFrom: 47,
    bodyTo: 57,
    lineNo: 2,
  });
  equal("image and caption drag as one block", getBlockRange(doc, 2), {
    startLine: 1,
    endLine: 2,
  });
}

{
  const doc = docOf([
    "```js",
    "run();",
    "```",
    '<small class="nf-caption" data-nf-kind="code">Example</small>',
    "",
    "after",
  ].join("\n"));
  const plan = fenceExitPlan(doc, doc.line(2).to);
  equal(
    "code exit skips its metadata and reuses the following blank",
    plan && doc.lineAt(plan.cursor).number,
    5
  );
}

if (failures) process.exit(1);
