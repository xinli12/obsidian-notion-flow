import { measureCalloutMetrics } from "./bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " :: " + extra}`);
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));

/* ------------------------------------------------------------------ */
/* Minimal DOM good enough for measureCalloutMetrics                   */
/* ------------------------------------------------------------------ */

/* The measurement reads only rects, classes, data-callout and margins, so a
   hand-rolled node beats a full DOM here: the numbers under test stay visible
   in the fixture instead of being produced by a layout engine we would then
   have to trust. Only the selector shapes the code actually uses are
   supported. */
function el({ tag = "div", cls = [], callout, rect, margin, children = [] }) {
  const node = {
    tag,
    classes: new Set(cls),
    dataset: callout === undefined ? {} : { callout },
    margin: { top: 0, bottom: 0, ...(margin ?? {}) },
    children,
    getBoundingClientRect: () => ({
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      width: 0,
      height: 0,
      ...(rect ?? {}),
    }),
  };
  node.querySelector = (sel) => query(node, sel)[0] ?? null;
  node.querySelectorAll = (sel) => query(node, sel);
  Object.defineProperty(node, "firstElementChild", {
    get: () => node.children[0] ?? null,
  });
  Object.defineProperty(node, "lastElementChild", {
    get: () => node.children[node.children.length - 1] ?? null,
  });
  return node;
}

const matches = (node, compound) =>
  compound
    .split(".")
    .filter(Boolean)
    .every((part, i) =>
      i === 0 && !compound.startsWith(".")
        ? node.tag === part
        : node.classes.has(part)
    );

const descendants = (node) =>
  node.children.flatMap((c) => [c, ...descendants(c)]);

function query(node, sel) {
  if (sel.startsWith(":scope > ")) {
    const rest = sel.slice(":scope > ".length);
    return node.children.filter((c) => matches(c, rest));
  }
  const parts = sel.split(" ").filter(Boolean);
  let pool = descendants(node);
  for (let i = 0; i < parts.length; i++) {
    const hits = pool.filter((c) => matches(c, parts[i]));
    if (i === parts.length - 1) return hits;
    pool = hits.flatMap((h) => descendants(h));
  }
  return [];
}

globalThis.getComputedStyle = (node) => ({
  marginTop: `${node.margin?.top ?? 0}px`,
  marginBottom: `${node.margin?.bottom ?? 0}px`,
});

const view = (callouts) => ({ contentDOM: el({ children: callouts }) });

/* Obsidian's own default geometry, as dumped from the running app: the
   Callout box spans 651.8→1351.8 with 12px of vertical padding, body text sits
   at 690.8, and a nested code card runs 690.8→1336.8 with its text at 706.8.
   Those are the numbers edit mode has to reproduce. */
function defaultCallout({
  type = "warning",
  boxTop = 100,
  boxBottom = 300,
  titleTop = 112,
  titleMargin,
  lastMargin = { bottom: 16 },
  lastBottom = 272,
  withContent = true,
} = {}) {
  const para = el({
    tag: "p",
    cls: ["nf-para"],
    rect: { left: 690.8, right: 1336.8, top: 140, bottom: 160 },
  });
  const code = el({
    tag: "code",
    rect: { left: 706.8, right: 1320.8, top: 180, bottom: 260 },
  });
  const pre = el({
    tag: "pre",
    // Width matters: the measurement skips a block that is not laid out yet.
    rect: {
      left: 690.8,
      right: 1336.8,
      width: 646,
      top: 170,
      bottom: lastBottom,
    },
    margin: { top: 17, bottom: lastMargin.bottom ?? 0 },
    children: [code],
  });
  const title = el({
    cls: ["callout-title"],
    rect: { left: 675.8, right: 1339.8, top: titleTop, bottom: titleTop + 20 },
    margin: titleMargin,
  });
  const content = el({
    cls: ["callout-content"],
    rect: { left: 690.8, right: 1336.8, top: 132, bottom: 288 },
    children: [para, pre],
  });
  return el({
    cls: ["callout"],
    callout: type,
    rect: {
      left: 651.8,
      right: 1351.8,
      top: boxTop,
      bottom: boxBottom,
      width: 700,
    },
    children: withContent ? [title, content] : [title],
  });
}

/* The horizontal numbers are the already-proven ones; they are asserted here
   so the vertical work cannot regress them. */
{
  const m = measureCalloutMetrics(view([defaultCallout()]), null);
  eq("content inset measured off the rendered body text", m.contentInset, 39);
  eq("card trailing inset", m.codeEnd, 15);
  eq("card text padding", m.codePad, 16);
  eq("code gap from the block's own margin", m.codeGap, 17);
}

/* The fix under test: the Callout's own vertical air is measured, not the 8px
   edit mode used to assume, and Obsidian's default is 12px. */
{
  const m = measureCalloutMetrics(view([defaultCallout()]), null);
  eq("top air measured off the title row", m.topAir, 12);
  eq("bottom air excludes the last block's margin", m.bottomAir, 12);
}

/* Excluding the child's own margin is the whole point: edit mode adds that
   back per block (codeGap), so counting it here would double it. */
{
  const noMargin = measureCalloutMetrics(
    view([defaultCallout({ lastMargin: { bottom: 0 }, lastBottom: 288 })]),
    null
  );
  eq("bottom air with a flush last block", noMargin.bottomAir, 12);
  const themed = measureCalloutMetrics(
    view([defaultCallout({ titleTop: 117, titleMargin: { top: 5 } })]),
    null
  );
  eq("top air excludes a themed title margin", themed.topAir, 12);
}

/* A theme with roomier padding is followed, not clamped to the default. */
{
  const m = measureCalloutMetrics(
    view([
      defaultCallout({ titleTop: 124, lastBottom: 260, boxBottom: 300 }),
    ]),
    null
  );
  eq("roomy theme top air", m.topAir, 24);
  eq("roomy theme bottom air", m.bottomAir, 24);
}

/* The plugin's own structural Callouts are stripped of padding on purpose, so
   measuring one would publish the wrong air for ordinary Callouts. */
{
  const structural = ["nf-cols", "nf-col", "nf-toggle"];
  for (const type of structural) {
    const m = measureCalloutMetrics(
      view([defaultCallout({ type, titleTop: 100, boxBottom: 272 })]),
      null
    );
    ok(`${type} is not measured`, m === null, JSON.stringify(m));
  }
  // A real Callout alongside them still gets measured.
  const mixed = measureCalloutMetrics(
    view([
      defaultCallout({ type: "nf-toggle", titleTop: 100, boxBottom: 272 }),
      defaultCallout(),
    ]),
    null
  );
  eq("a real Callout beside structural ones wins", mixed.topAir, 12);
}

/* Merge rules: a Callout with no content element (collapsed) cannot supply
   bottom air, and the previous measurement has to stand rather than snapping
   back to the default. */
{
  const previous = {
    contentInset: 39,
    codeEnd: 15,
    codePad: 16,
    codeGap: 17,
    topAir: 12,
    bottomAir: 12,
  };
  const collapsed = measureCalloutMetrics(
    view([defaultCallout({ withContent: false })]),
    previous
  );
  eq("collapsed Callout keeps the last bottom air", collapsed.bottomAir, 12);
  eq("collapsed Callout still updates top air", collapsed.topAir, 12);
  ok(
    "no Callout at all measures nothing",
    measureCalloutMetrics(view([]), previous) === null
  );
}

/* An absurd number means the layout was sampled mid-flight; the previous
   value is safer than publishing it. */
{
  const previous = {
    contentInset: 39,
    codeEnd: 15,
    codePad: 16,
    codeGap: 17,
    topAir: 12,
    bottomAir: 12,
  };
  const m = measureCalloutMetrics(
    view([defaultCallout({ titleTop: 400, boxBottom: 1200 })]),
    previous
  );
  eq("out-of-range top air is rejected", m.topAir, 12);
  eq("out-of-range bottom air is rejected", m.bottomAir, 12);
}

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
