/* trailingParagraphPlan: the click-below-the-note affordance.
 * A note that ends with a structural block gets a real paragraph; one that
 * already ends somewhere the caret can go is left alone. */
import { Text } from "@codemirror/state";
import { trailingParagraphPlan } from "./bundle.mjs";

const apply = (lines) => {
  const doc = Text.of(lines);
  const plan = trailingParagraphPlan(doc);
  if (!plan) return null;
  const text = doc.toString();
  const after =
    text.slice(0, plan.from) + plan.insert + text.slice(plan.to);
  return { after, cursor: plan.cursor, atEnd: plan.cursor === after.length };
};

const cases = [
  [
    "code block at EOF gets a paragraph",
    ["text", "```js", "code();", "```"],
    "text\n```js\ncode();\n```\n",
  ],
  [
    "unclosed fence at EOF still gets a paragraph",
    ["```js", "code();"],
    "```js\ncode();\n",
  ],
  [
    "fence in a list keeps the item's column",
    ["- item", "  ```js", "  code();", "  ```"],
    "- item\n  ```js\n  code();\n  ```\n  ",
  ],
  [
    "fence inside a Callout leaves the Callout",
    ["> [!note]", "> ```js", "> code();", "> ```"],
    "> [!note]\n> ```js\n> code();\n> ```\n",
  ],
  ["table at EOF", ["| a | b |", "| - | - |", "| 1 | 2 |"], "| a | b |\n| - | - |\n| 1 | 2 |\n"],
  ["callout at EOF", ["> [!note] Hi", "> body"], "> [!note] Hi\n> body\n"],
  ["heading at EOF", ["# Title"], "# Title\n"],
  ["horizontal rule at EOF", ["text", "---"], "text\n---\n"],
  ["image at EOF", ["![[pic.png]]"], "![[pic.png]]\n"],
  [
    "caption row at EOF",
    ["```js", "x", "```", '<small class="nf-caption" data-nf-kind="code">Fig</small>'],
    '```js\nx\n```\n<small class="nf-caption" data-nf-kind="code">Fig</small>\n',
  ],
];

const nulls = [
  ["blank last line", ["text", "```js", "x", "```", ""]],
  ["plain paragraph", ["hello", "world"]],
  ["list item", ["- one", "- two"]],
  ["empty document", [""]],
];

let fail = 0;
for (const [name, lines, expected] of cases) {
  const got = apply(lines);
  const ok = got !== null && got.after === expected && got.atEnd;
  if (!ok) fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}${
      ok ? "" : `: got ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`
    }`
  );
}
for (const [name, lines] of nulls) {
  const got = apply(lines);
  const ok = got === null;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} no plan: ${name}${ok ? "" : ` got ${JSON.stringify(got)}`}`);
}
if (fail === 0) console.log("ALL PASS");
process.exit(fail);
