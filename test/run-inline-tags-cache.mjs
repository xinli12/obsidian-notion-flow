import assert from "node:assert/strict";
import { Text } from "@codemirror/state";
import { cachedColorTagPairs, findColorTagPairs } from "./features.mjs";

const lines = ['<span style="color:red">hi</span> plain', "second <b>bold</b> end"];
const doc = Text.of(lines);
const first = cachedColorTagPairs(doc);
assert.equal(cachedColorTagPairs(doc), first, "the same document version returns the same array");
assert.deepEqual(first, findColorTagPairs(doc.toString()), "cached result equals a fresh scan");
assert.equal(first.length, 2);
assert.equal(doc.sliceString(first[1].open.from, first[1].open.to), "<b>", "offsets are document positions");
assert.equal(first[1].style, "font-weight:bold");

const twin = Text.of(lines);
assert.notEqual(cachedColorTagPairs(twin), first, "a different Text with equal content gets its own scan");
assert.deepEqual(cachedColorTagPairs(twin), first);

const edited = doc.replace(0, 0, Text.of(["x"]));
const after = cachedColorTagPairs(edited);
assert.notEqual(after, first, "an edit is a new version");
assert.equal(after[0].open.from, 1, "positions follow the edit");
assert.equal(cachedColorTagPairs(doc), first, "the old version stays cached alongside");
assert.deepEqual(cachedColorTagPairs(Text.of([""])), []);
console.log("PASS inline tag cache: memoised per document version, fresh per Text");
