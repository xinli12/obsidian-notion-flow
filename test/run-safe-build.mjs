import assert from "node:assert/strict";
import { guard, guardAsync } from "./features.mjs";

const errors = [];
const original = console.error;
console.error = (...args) => errors.push(args);
try {
  const boom = () => { throw new Error("bad line"); };

  assert.equal(guard("plain", () => "fallback", () => "value"), "value", "the builder's own result passes through");
  assert.equal(errors.length, 0, "a clean run logs nothing");

  assert.equal(guard("deco", () => "fallback", boom), "fallback", "a throw yields the fallback");
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], "Notion Flow: deco", "the label names the failing builder");
  assert.equal(errors[0][1].message, "bad line", "the error itself is logged");

  assert.equal(guard("deco", () => 0, boom), 0, "later throws still fall back…");
  assert.equal(guard("deco", () => 1, () => { throw new Error("other"); }), 1);
  assert.equal(errors.length, 1, "…but the same label logs only once per session");

  assert.deepEqual(guard("other", () => [], boom), [], "each label gets its own line");
  assert.equal(errors.length, 2);
  assert.equal(errors[1][0], "Notion Flow: other");

  let fallbacks = 0;
  guard("counting", () => { fallbacks++; return null; }, () => 7);
  assert.equal(fallbacks, 0, "the fallback is not built when the builder succeeds");

  /* ---- guardAsync: rAF / timer callbacks ---- */
  let ran = 0;
  const wrapped = guardAsync("frame", (time) => { ran += time; });
  wrapped(2);
  wrapped(3);
  assert.equal(ran, 5, "arguments reach the callback and nothing is logged");
  assert.equal(errors.length, 2);

  const failing = guardAsync("frame-fail", boom);
  assert.doesNotThrow(() => failing(), "a throw inside the callback is contained");
  failing();
  assert.equal(errors.length, 3, "logged once for the label");
  assert.equal(errors[2][0], "Notion Flow: frame-fail");

  const rejecting = guardAsync("frame-async", async () => { throw new Error("later"); });
  rejecting();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(errors.length, 4, "a rejected promise is reported too");
  assert.equal(errors[3][1].message, "later");
} finally {
  console.error = original;
}
console.log("PASS safe build: fallback on throw, one console line per label, callbacks contained");
