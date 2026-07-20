import {
  unwrapColumnsLines,
  setColumnWidths,
  countColumns,
  buildColumnsWrap,
  parseColumnsSource,
  insertColumnAt,
  moveColumnTo,
  removeColumnAt,
  columnPercentsFromWidths,
  columnInnerSource,
  replaceColumnBody,
  removeQuoteLevels,
  projectColumnTextChange,
} from "./bundle.mjs";

let fail = 0;
const check = (name, got, expected) => {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: got ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`
  );
};

const TWO_COL = [
  "> [!nf-cols]",
  "> > [!nf-col]",
  "> > left one",
  "> >",
  "> > left two",
  ">",
  "> > [!nf-col|30]",
  "> > right",
];

/* ---------- countColumns ---------- */
check("count basic", countColumns(TWO_COL), 2);
check("count non-columns", countColumns(["plain", "> quote"]), 0);

/* ---------- unwrapColumnsLines ---------- */
check(
  "unwrap two columns",
  unwrapColumnsLines(TWO_COL),
  ["left one", "", "left two", "", "right"]
);
check(
  "unwrap keeps nested quote markers",
  unwrapColumnsLines([
    "> [!nf-cols]",
    "> > [!nf-col]",
    "> > > inner quote",
    ">",
    "> > [!nf-col]",
    "> > plain",
  ]),
  ["> inner quote", "", "plain"]
);
check(
  "unwrap drops empty columns",
  unwrapColumnsLines([
    "> [!nf-cols]",
    "> > [!nf-col]",
    "> > only",
    ">",
    "> > [!nf-col]",
    "> > ",
  ]),
  ["only"]
);
check("unwrap rejects non-columns", unwrapColumnsLines(["> [!note] x", "> y"]), null);
check(
  "unwrap keeps a nested columns row intact",
  unwrapColumnsLines([
    "> [!nf-cols]",
    "> > [!nf-col]",
    "> > plain",
    ">",
    "> > [!nf-col]",
    "> > > [!nf-cols]",
    "> > > > [!nf-col]",
    "> > > > a",
    "> > >",
    "> > > > [!nf-col]",
    "> > > > b",
  ]),
  [
    "plain",
    "",
    "> [!nf-cols]",
    "> > [!nf-col]",
    "> > a",
    ">",
    "> > [!nf-col]",
    "> > b",
  ]
);
check(
  "unwrap of a wrap round-trips",
  unwrapColumnsLines(buildColumnsWrap(["a", "", "b"], ["c"])),
  ["a", "", "b", "", "c"]
);

/* ---------- setColumnWidths ---------- */
check(
  "widths set 30/flex",
  setColumnWidths(
    ["> [!nf-cols]", "> > [!nf-col]", "> > a", ">", "> > [!nf-col]", "> > b"],
    [30, null]
  ),
  ["> [!nf-cols]", "> > [!nf-col|30]", "> > a", ">", "> > [!nf-col]", "> > b"]
);
check(
  "widths clear existing",
  setColumnWidths(TWO_COL, [null, null])[6],
  "> > [!nf-col]"
);
check(
  "widths leave extra columns alone",
  setColumnWidths(
    ["> [!nf-cols]", "> > [!nf-col]", ">", "> > [!nf-col|20]"],
    [50]
  )[3],
  "> > [!nf-col|20]"
);
check(
  "widths skip nested column rows",
  setColumnWidths(
    ["> [!nf-cols]", "> > [!nf-col]", "> > > [!nf-cols]", "> > > > [!nf-col]"],
    [40]
  )[3],
  "> > > > [!nf-col]"
);

/* ---------- parsed structural operations ---------- */
check("parser finds direct columns", parseColumnsSource(TWO_COL)?.columns.length, 2);
check("parser keeps first width", parseColumnsSource(TWO_COL)?.columns[0].width, null);
check("parser reads second width", parseColumnsSource(TWO_COL)?.columns[1].width, 30);
check(
  "insert column in the middle",
  insertColumnAt(TWO_COL, 1),
  [
    "> [!nf-cols]",
    "> > [!nf-col]",
    "> > left one",
    "> >",
    "> > left two",
    ">",
    "> > [!nf-col]",
    "> > ",
    ">",
    "> > [!nf-col|30]",
    "> > right",
  ]
);
check(
  "move left column to the right",
  moveColumnTo(TWO_COL, 0, 1),
  [
    "> [!nf-cols]",
    "> > [!nf-col|30]",
    "> > right",
    ">",
    "> > [!nf-col]",
    "> > left one",
    "> >",
    "> > left two",
  ]
);
check("remove from two columns unwraps survivor", removeColumnAt(TWO_COL, 0), ["right"]);
check(
  "nested wrapper parses at arbitrary quote depth",
  parseColumnsSource([
    "> > > [!nf-cols]",
    "> > > > [!nf-col]",
    "> > > > a",
    "> > >",
    "> > > > [!nf-col|40]",
    "> > > > b",
  ])?.columns.map((column) => column.width),
  [null, 40]
);
const projected = columnInnerSource(parseColumnsSource(TWO_COL), 0);
check("inner projection hides structure", projected?.lines, ["left one", "", "left two"]);
check("inner projection records source prefix", projected?.origins[0].sourceCh, 4);
check(
  "replace body reapplies structure",
  replaceColumnBody(TWO_COL, 1, ["new", "> nested quote"]),
  [
    "> [!nf-cols]",
    "> > [!nf-col]",
    "> > left one",
    "> >",
    "> > left two",
    ">",
    "> > [!nf-col|30]",
    "> > new",
    "> > > nested quote",
  ]
);
check(
  "nested unwrap removes structural levels, not ancestors",
  removeQuoteLevels("  > > > > value", 3, 2),
  "  > > value"
);
check(
  "fenced fake header is column content",
  countColumns([
    "> [!nf-cols]",
    "> > [!nf-col]",
    "> > ```md",
    "> > [!nf-col]",
    "> > ```",
    ">",
    "> > [!nf-col]",
    "> > right",
  ]),
  2
);
check(
  "indented fake header is column content",
  countColumns([
    "> [!nf-cols]",
    "> > [!nf-col]",
    "> >     [!nf-col]",
    ">",
    "> > [!nf-col]",
  ]),
  2
);
const preservedSeams = [
  "> [!nf-cols]",
  "> > [!nf-col]",
  "> > a",
  ">",
  "> ",
  "> > [!nf-col]",
  "> > b",
  ">",
];
check(
  "no-op move preserves noncanonical seams and tail",
  moveColumnTo(preservedSeams, 0, 0),
  preservedSeams
);

/* ---------- visual-editor source projection ---------- */
const applyProjectedChange = (source, change) =>
  change == null
    ? null
    : source.slice(0, change.from) + change.insert + source.slice(change.to);
const twoColSource = TWO_COL.join("\n");
const firstInner = "left one\n\nleft two";
const withInsertedLine = "left one\nnew line\n\nleft two";
const insertedSource = applyProjectedChange(
  twoColSource,
  projectColumnTextChange(twoColSource, 0, firstInner, withInsertedLine)
);
check(
  "visual edit inserts structural prefixes for new lines",
  columnInnerSource(parseColumnsSource(insertedSource?.split("\n") ?? []), 0)?.doc.toString(),
  withInsertedLine
);
const joinedInner = "left oneleft two";
const joinedSource = applyProjectedChange(
  twoColSource,
  projectColumnTextChange(twoColSource, 0, firstInner, joinedInner)
);
check(
  "visual edit deleting line breaks also removes hidden prefixes",
  columnInnerSource(parseColumnsSource(joinedSource?.split("\n") ?? []), 0)?.doc.toString(),
  joinedInner
);
check(
  "visual edit rejects stale projected text",
  projectColumnTextChange(twoColSource, 0, "stale", "changed"),
  null
);

/* ---------- measured width normalization ---------- */
check("pixel widths become percentages", columnPercentsFromWidths([300, 700]), [30, 70]);
check("extreme widths respect metadata bounds", columnPercentsFromWidths([1, 19]), [10, 90]);
check("equal thirds total exactly 100", columnPercentsFromWidths([1, 1, 1]), [34, 33, 33]);
check("empty width list stays empty", columnPercentsFromWidths([]), []);

if (fail > 0) {
  console.error(`${fail} FAILED`);
  process.exit(1);
}
console.log("ALL PASS");
