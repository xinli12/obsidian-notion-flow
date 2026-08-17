/* Source ownership and atomic async Markdown previews. */
import {
  commitStagedRender,
  sourcePathForEditorView,
} from "./bundle.mjs";

let fail = 0;
const check = (name, got, expected) => {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: got ${JSON.stringify(got)}` +
      (ok ? "" : ` expected ${JSON.stringify(expected)}`)
  );
};

/* A non-active split must resolve through the MarkdownView that owns its
 * CodeMirror instance, never through workspace-wide active-file state. */
const activeEditor = {};
const backgroundEditor = {};
const workspace = {
  getActiveFile() {
    throw new Error("source-path resolution must not read the active file");
  },
  getLeavesOfType(type) {
    check("source path asks for Markdown leaves", type, "markdown");
    return [
      {
        view: {
          editor: { cm: activeEditor },
          file: { path: "active/note.md" },
        },
      },
      {
        view: {
          editor: { cm: backgroundEditor },
          file: { path: "background/note.md" },
        },
      },
    ];
  },
};

check(
  "non-active split uses its owning MarkdownView file",
  sourcePathForEditorView(workspace, backgroundEditor),
  "background/note.md"
);
check(
  "active split still resolves normally",
  sourcePathForEditorView(workspace, activeEditor),
  "active/note.md"
);
check(
  "an editor without a MarkdownView has no guessed source path",
  sourcePathForEditorView(workspace, {}),
  ""
);

/* Minimal DOM doubles keep the staging contract observable without hiding
 * it behind jsdom: visible children may change only after a valid render. */
const ownerDocument = {
  createElement() {
    return {
      ownerDocument,
      className: "",
      childNodes: [],
      querySelector(selector) {
        return this.childNodes.find((node) => node.selector === selector) ?? null;
      },
    };
  },
};
const container = () => ({
  ownerDocument,
  childNodes: ["old"],
  replaceChildren(...nodes) {
    this.childNodes = nodes;
  },
});

let finishRender;
const visible = container();
const rendering = commitStagedRender(
  visible,
  async (staging) => {
    staging.childNodes.push("new");
    await new Promise((resolve) => {
      finishRender = resolve;
    });
  },
  { stagingClass: "preview-stage" }
);
await Promise.resolve();
check("pending render keeps the old DOM visible", visible.childNodes, ["old"]);
finishRender();
check("successful render commits", await rendering, true);
check("successful render replaces once complete", visible.childNodes, ["new"]);

const rejected = container();
check(
  "rejected render reports no commit",
  await commitStagedRender(rejected, async (staging) => {
    staging.childNodes.push("broken");
    throw new Error("renderer failed");
  }),
  false
);
check("rejected render preserves old DOM", rejected.childNodes, ["old"]);

const stale = container();
check(
  "superseded render reports no commit",
  await commitStagedRender(
    stale,
    async (staging) => staging.childNodes.push("stale"),
    { shouldCommit: () => false }
  ),
  false
);
check("superseded render preserves old DOM", stale.childNodes, ["old"]);

const invalid = container();
check(
  "invalid nested Callout reports no commit",
  await commitStagedRender(
    invalid,
    async (staging) => staging.childNodes.push({ selector: ".paragraph" }),
    { validate: (staging) => !!staging.querySelector(".callout") }
  ),
  false
);
check("invalid nested Callout preserves old DOM", invalid.childNodes, ["old"]);

if (fail) process.exit(1);
