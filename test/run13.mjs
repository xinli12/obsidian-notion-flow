import { Text } from "@codemirror/state";
import { GFM, parser } from "@lezer/markdown";
import {
  collectInlineSyntaxGroups,
  isInlineSyntaxGroupBeingEdited,
  planConcealedBoundaryDelete,
  sourceOffsetFromVisibleOffset,
} from "./bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
};

const parsedText = "**bold** *italic* ~~strike~~ `code` [site](https://obsidian.md/)";
const parsedDoc = Text.of([parsedText]);
const parsedTree = parser.configure([GFM]).parse(parsedText);
const parsedGroups = collectInlineSyntaxGroups(parsedTree, parsedDoc);
const parsedMarkers = parsedGroups.flatMap((group) =>
  group.markers.map((marker) => parsedText.slice(marker.from, marker.to))
);
ok("standard tree: bold markers", parsedMarkers.filter((x) => x === "**").length === 2);
ok("standard tree: italic markers", parsedMarkers.filter((x) => x === "*").length === 2);
ok("standard tree: strike markers", parsedMarkers.filter((x) => x === "~~").length === 2);
ok("standard tree: code markers", parsedMarkers.filter((x) => x === "`").length === 2);
const parsedLinkFrom = parsedText.indexOf("[");
ok(
  "standard tree: Markdown links are excluded from conceal groups",
  parsedGroups.every(
    (group) =>
      group.to <= parsedLinkFrom &&
      group.markers.every((marker) => marker.to <= parsedLinkFrom)
  ),
  JSON.stringify(parsedGroups)
);

const parsedBold = parsedGroups[0];
const parsedItalic = parsedGroups[1];
const parsedStrike = parsedGroups[2];
const parsedCode = parsedGroups[3];
ok(
  "selection: selecting formatted text keeps bold markers concealed",
  !isInlineSyntaxGroupBeingEdited(parsedBold, [{ from: 0, to: 8 }])
);
for (const [name, group] of [
  ["italic", parsedItalic],
  ["strikethrough", parsedStrike],
  ["inline code", parsedCode],
]) {
  ok(
    `selection: selecting ${name} source keeps its markers concealed`,
    !isInlineSyntaxGroupBeingEdited(group, [
      { from: group.from, to: group.to },
    ])
  );
}
ok(
  "selection: selecting only the visible body keeps markers concealed",
  !isInlineSyntaxGroupBeingEdited(parsedBold, [{ from: 2, to: 6 }])
);
ok(
  "selection: marker-boundary endpoints do not reveal markers",
  !isInlineSyntaxGroupBeingEdited(parsedBold, [{ from: 1, to: 7 }])
);
ok(
  "selection: cross-format selection keeps all ordinary markers concealed",
  parsedGroups.every(
    (group) =>
      !isInlineSyntaxGroupBeingEdited(group, [
        { from: 0, to: parsedLinkFrom - 1 },
      ])
  )
);
ok(
  "selection: multiple non-empty ranges keep markers concealed",
  !isInlineSyntaxGroupBeingEdited(parsedBold, [
    { from: 0, to: 3 },
    { from: 5, to: 8 },
  ])
);
ok(
  "caret: entering an opening marker still reveals its source",
  isInlineSyntaxGroupBeingEdited(parsedBold, [{ from: 1, to: 1 }])
);
ok(
  "caret: entering a closing marker still reveals its source",
  isInlineSyntaxGroupBeingEdited(parsedBold, [{ from: 7, to: 7 }])
);
ok(
  "caret: visible formatted text keeps surrounding markers concealed",
  !isInlineSyntaxGroupBeingEdited(parsedBold, [{ from: 4, to: 4 }])
);
ok(
  "caret: a marker boundary remains concealed",
  !isInlineSyntaxGroupBeingEdited(parsedBold, [{ from: 2, to: 2 }])
);
ok(
  "caret: marker editing wins alongside a non-empty selection",
  isInlineSyntaxGroupBeingEdited(parsedBold, [
    { from: 0, to: 8 },
    { from: 1, to: 1 },
  ])
);

// Obsidian's HyperMD tree exposes formatting leaves directly under Document.
const flatText = "**b** [site](https://obsidian.md/) ==h==";
const flatDoc = Text.of([flatText]);
const token = (name, value, from = flatText.indexOf(value)) => ({
  name,
  from,
  to: from + value.length,
});
const linkOpen = flatText.indexOf("[");
const linkClose = flatText.indexOf("]", linkOpen);
const destOpen = flatText.indexOf("(", linkClose);
const destClose = flatText.lastIndexOf(")");
const highlightOpen = flatText.indexOf("==");
const flatNodes = [
  token("formatting_formatting-strong_strong", "**", 0),
  token("formatting_formatting-strong_strong", "**", 3),
  token("formatting_formatting-link_link", "[", linkOpen),
  token("formatting_formatting-link_link", "]", linkClose),
  token("formatting_formatting-link-string_string_url", "(", destOpen),
  token("formatting_formatting-link-string_string_url", ")", destClose),
  token("formatting_formatting-highlight_highlight", "==", highlightOpen),
  token("formatting_formatting-highlight_highlight", "==", highlightOpen + 3),
];
const flatTree = {
  length: flatText.length,
  iterate({ enter }) {
    for (const node of flatNodes) enter({ node });
  },
};
const flatGroups = collectInlineSyntaxGroups(flatTree, flatDoc);
const flatMarkers = flatGroups.flatMap((group) =>
  group.markers.map((marker) => flatText.slice(marker.from, marker.to))
);
ok("Obsidian tree: strong markers", flatMarkers.filter((x) => x === "**").length === 2);
ok("Obsidian tree: highlight markers", flatMarkers.filter((x) => x === "==").length === 2);
ok(
  "Obsidian tree: Markdown links are excluded from conceal groups",
  flatGroups.every(
    (group) =>
      (group.to <= linkOpen || group.from > destClose) &&
      group.markers.every(
        (marker) => marker.to <= linkOpen || marker.from > destClose
      )
  ),
  JSON.stringify(flatGroups)
);

// Shortcut/reference and inline links must both remain untouched.
const adjacentLinksText = "[ref] and [next](https://obsidian.md/)";
const adjacentLinksDoc = Text.of([adjacentLinksText]);
const firstOpen = adjacentLinksText.indexOf("[");
const firstClose = adjacentLinksText.indexOf("]", firstOpen);
const secondOpen = adjacentLinksText.indexOf("[", firstClose);
const secondClose = adjacentLinksText.indexOf("]", secondOpen);
const secondDestOpen = adjacentLinksText.indexOf("(", secondClose);
const secondDestClose = adjacentLinksText.lastIndexOf(")");
const adjacentLinksNodes = [
  token("formatting_formatting-link_link", "[", firstOpen),
  token("formatting_formatting-link_link", "]", firstClose),
  token("formatting_formatting-link_link", "[", secondOpen),
  token("formatting_formatting-link_link", "]", secondClose),
  token("formatting_formatting-link-string_string_url", "(", secondDestOpen),
  token("formatting_formatting-link-string_string_url", ")", secondDestClose),
];
const adjacentLinksTree = {
  length: adjacentLinksText.length,
  iterate({ enter }) {
    for (const node of adjacentLinksNodes) enter({ node });
  },
};
const adjacentLinksGroups = collectInlineSyntaxGroups(
  adjacentLinksTree,
  adjacentLinksDoc
);
ok(
  "Obsidian tree: reference and inline links both remain visible",
  adjacentLinksGroups.length === 0,
  JSON.stringify(adjacentLinksGroups)
);

// An image uses similar brackets but must keep its source intact.
const imageText = "![alt](image.png)";
const imageDoc = Text.of([imageText]);
const imageNodes = [
  token("formatting_formatting-link_link", "[", 1),
  token("formatting_formatting-link_link", "]", 5),
  token("formatting_formatting-link-string_string_url", "(", 6),
  token("formatting_formatting-link-string_string_url", ")", imageText.length - 1),
];
const imageTree = {
  length: imageText.length,
  iterate({ enter }) {
    for (const node of imageNodes) enter({ node });
  },
};
ok(
  "image syntax remains visible",
  collectInlineSyntaxGroups(imageTree, imageDoc).length === 0
);

ok(
  "visible offset skips opening markdown marker",
  sourceOffsetFromVisibleOffset(0, 8, 0, [
    { from: 0, to: 2 },
    { from: 6, to: 8 },
  ]) === 2
);
ok(
  "visible offset maps inside formatted text",
  sourceOffsetFromVisibleOffset(0, 8, 3, [
    { from: 0, to: 2 },
    { from: 6, to: 8 },
  ]) === 5
);

const applyDeletePlan = (text, plan) =>
  plan ? text.slice(0, plan.from) + text.slice(plan.to) : text;
const boundaryText = "a**bold**z";
const boundaryDoc = Text.of([boundaryText]);
ok(
  "Backspace skips opening marker and deletes visible grapheme",
  applyDeletePlan(
    boundaryText,
    planConcealedBoundaryDelete(boundaryDoc, 3, -1, [
      { from: 1, to: 3 },
      { from: 7, to: 9 },
    ])
  ) === "**bold**z"
);
ok(
  "Delete skips closing marker and deletes visible grapheme",
  applyDeletePlan(
    boundaryText,
    planConcealedBoundaryDelete(boundaryDoc, 7, 1, [
      { from: 1, to: 3 },
      { from: 7, to: 9 },
    ])
  ) === "a**bold**"
);
const edgeText = "**bold**";
const edgeDoc = Text.of([edgeText]);
ok(
  "Backspace at concealed document start is a safe no-op",
  planConcealedBoundaryDelete(edgeDoc, 2, -1, [
    { from: 0, to: 2 },
    { from: 6, to: 8 },
  ])?.from === 0 &&
    planConcealedBoundaryDelete(edgeDoc, 2, -1, [
      { from: 0, to: 2 },
      { from: 6, to: 8 },
    ])?.to === 0
);
const mixedText = "x<u>**text**</u>y";
const mixedDoc = Text.of([mixedText]);
const mixedRanges = [
  { from: 1, to: 4 },
  { from: 4, to: 6 },
  { from: 10, to: 12 },
  { from: 12, to: 16 },
];
ok(
  "Backspace skips adjacent HTML and Markdown ranges",
  applyDeletePlan(
    mixedText,
    planConcealedBoundaryDelete(mixedDoc, 6, -1, mixedRanges)
  ) === "<u>**text**</u>y"
);
ok(
  "Delete skips adjacent Markdown and HTML ranges",
  applyDeletePlan(
    mixedText,
    planConcealedBoundaryDelete(mixedDoc, 10, 1, mixedRanges)
  ) === "x<u>**text**</u>"
);
const emojiText = "🙂**b**";
ok(
  "boundary deletion removes one complete grapheme",
  applyDeletePlan(
    emojiText,
    planConcealedBoundaryDelete(Text.of([emojiText]), 4, -1, [
      { from: 2, to: 4 },
      { from: 5, to: 7 },
    ])
  ) === "**b**"
);

// Adjacent closing/opening markers share a source position but belong to
// opposite deletion directions; do not merge them into one inaccessible span.
const touchingText = "**a****b**";
const touchingDoc = Text.of([touchingText]);
const touchingRanges = [
  { from: 0, to: 2 },
  { from: 3, to: 5 },
  { from: 5, to: 7 },
  { from: 8, to: 10 },
];
const touchingBackspace = planConcealedBoundaryDelete(
  touchingDoc,
  5,
  -1,
  touchingRanges
);
const touchingDelete = planConcealedBoundaryDelete(
  touchingDoc,
  5,
  1,
  touchingRanges
);
ok(
  "Backspace protects a shared marker boundary",
  touchingBackspace?.from === 2 && touchingBackspace?.to === 3,
  JSON.stringify(touchingBackspace)
);
ok(
  "Delete protects a shared marker boundary",
  touchingDelete?.from === 7 && touchingDelete?.to === 8,
  JSON.stringify(touchingDelete)
);

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILURES`);
process.exit(fail);
