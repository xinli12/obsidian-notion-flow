import { EditorState } from "@codemirror/state";
import { getBlockRange, moveBlock } from "./bundle.mjs";

function makeView(text) {
  let state = EditorState.create({ doc: text });
  return {
    get state() { return state; },
    dispatch(spec) { state = state.update(spec).state; },
  };
}

const base = "# Title\n\nfirst para\n\n- item A\n  - child\n- item B\n\nlast para";

let fail = 0;
function check(name, hoverLine, targetLine, expected) {
  const v = makeView(base);
  const block = getBlockRange(v.state.doc, hoverLine);
  moveBlock(v, block, targetLine);
  const got = v.state.doc.toString();
  const ok = got === expected;
  if (!ok) { fail++; console.log(`FAIL ${name}\n--- got ---\n${got}\n--- expected ---\n${expected}`); }
  else console.log(`PASS ${name}`);
}

// Move "first para" (line 3) below "- item B" (insert before line 8, the blank)
check("para down", 3, 8,
  "# Title\n\n\n- item A\n  - child\n- item B\nfirst para\n\nlast para");

// Move "- item A"+child (lines 5-6) to end (line 10 > doc.lines 9)
check("list to end", 5, 10,
  "# Title\n\nfirst para\n\n- item B\n\nlast para\n- item A\n  - child");

// Move "last para" (line 9) to top (line 1)
check("last para to top", 9, 1,
  "last para\n# Title\n\nfirst para\n\n- item A\n  - child\n- item B\n");

// Drop inside own range = no-op
check("no-op drop", 5, 6, base);

process.exit(fail);
