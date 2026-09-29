import assert from "node:assert/strict";
import { EditorState, EditorSelection } from "@codemirror/state";
import { urlPasteAllowed, selectedUrlPaste } from "./bundle.mjs";

for (const [source, expected] of [
  ["normal TARGET", true], ["`TARGET`", false], ["``TARGET``", false],
  ["``a ` TARGET``", false], ["``a\nTARGET``", false],
  ["`closed` TARGET", true], ["\\`TARGET\\`", true],
  ["```js\nTARGET\n```", false], ["> ```js\n> TARGET\n> ```", false],
  ["- item\n  ```js\n  TARGET\n  ```", false],
  ["[label](TARGET)", false],
]) {
  const from = source.indexOf("TARGET");
  for (const select of [false, true]) {
    const state = EditorState.create({ doc: source, selection: { anchor: from, head: select ? from + 6 : from } });
    assert.equal(urlPasteAllowed(state), expected, `${source}: selected=${select}`);
    assert.equal(selectedUrlPaste(state, "https://example.com"), !select ? null : expected
      ? "[TARGET](https://example.com)" : "https://example.com", "code paste must explicitly replace, not fall through to host linking");
  }
}
assert.equal(urlPasteAllowed(EditorState.create({ doc: "plain", extensions: EditorState.readOnly.of(true) })), false);
assert.equal(urlPasteAllowed(EditorState.create({ doc: "abc", selection: EditorSelection.create([
  EditorSelection.cursor(0), EditorSelection.cursor(2),
]), extensions: EditorState.allowMultipleSelections.of(true) })), false);
console.log("PASS URL context: prose, code fences, nested code, matching backtick runs, multiline code and destinations");
