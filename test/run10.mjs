// Drag-and-drop seam sealing: moving a block must never change the meaning
// of its neighbors — callouts must not swallow what lands next to them or
// merge with each other, and removing a block must not fuse the blocks
// that surrounded it.
import { EditorState, Text } from "@codemirror/state";
import { getBlockRange, scanFences, moveBlock } from "./bundle.mjs";

let fail = 0;
const check = (name, got, expected) => {
  const ok = got === expected;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) console.log(`--- got ---\n${got}\n--- expected ---\n${expected}`);
};

const move = (docLines, blockLine, targetLine) => {
  let state = EditorState.create({ doc: Text.of(docLines) });
  const view = {
    get state() {
      return state;
    },
    dispatch(s) {
      state = state.update(s).state;
    },
  };
  const block = getBlockRange(state.doc, blockLine, scanFences(state.doc));
  moveBlock(view, block, targetLine);
  return state.doc.toString();
};

// Callout dropped directly above a paragraph: blank line keeps the
// paragraph out of the callout (lazy continuation).
check(
  "callout above paragraph gets sealed below",
  move(["para one", "", "> [!note] hi", "> body", "", "para two"], 3, 1),
  "> [!note] hi\n> body\n\npara one\n\npara two"
);

// Paragraph dropped directly below a callout: blank line keeps it from
// being absorbed.
check(
  "paragraph below callout gets sealed above",
  move(["> [!note] hi", "> body", "", "middle", "", "para"], 6, 3),
  "> [!note] hi\n> body\n\npara\n\nmiddle\n"
);

// Callout dropped against another callout: blank line prevents merging
// into a single callout.
check(
  "adjacent callouts do not merge",
  move(["> [!a] one", "", "text", "", "> [!b] two"], 5, 2),
  "> [!a] one\n\n> [!b] two\n\ntext\n"
);

// List item dropped directly above a paragraph: blank line keeps the
// paragraph from becoming part of the item.
check(
  "list item above paragraph gets sealed below",
  move(["para", "", "- item", "", "tail"], 3, 5),
  "para\n\n- item\n\ntail"
);

// Reordering within a list stays tight — no blank lines sprayed in.
check(
  "list reorder stays tight",
  move(["- a", "- b", "- c"], 3, 1),
  "- c\n- a\n- b"
);

// Paragraph dropped against another paragraph stays a separate block.
check(
  "paragraph above paragraph gets sealed below",
  move(["alpha", "", "beta", "", "gamma"], 5, 3),
  "alpha\n\ngamma\n\nbeta\n"
);

// `tail` is a legal lazy continuation of the list paragraph, so it rides
// with the list item; removing that whole block still leaves the callout
// separated from the following paragraph.
check(
  "source seam: callout stays separate from moved list paragraph",
  move(["> note", "- item", "tail", "", "end"], 2, 6),
  "> note\n\nend\n- item\ntail"
);

// Removing a fence from between two paragraphs leaves a blank line so the
// paragraphs stay separate blocks.
check(
  "source seam: paragraphs do not fuse",
  move(["para1", "```", "code", "```", "para2", "", "end"], 2, 8),
  "para1\n\npara2\n\nend\n```\ncode\n```"
);

process.exit(fail ? 1 : 0);
