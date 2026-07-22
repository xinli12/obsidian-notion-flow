import { mermaidViewport } from "./bundle.mjs";

let fail = 0;
const check = (name, got, expected) => {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}: got ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`
  );
};

check(
  "ordinary Mermaid diagram stays fitted",
  mermaidViewport(800, 600, 700),
  { wide: false, width: 700 }
);
check(
  "wide Mermaid diagram gets a readable scroll width",
  mermaidViewport(1200, 400, 600),
  { wide: true, width: 1162 }
);
check(
  "very wide Mermaid diagram is capped",
  mermaidViewport(4000, 300, 900),
  { wide: true, width: 1600 }
);
check(
  "invalid dimensions fall back safely",
  mermaidViewport(800, 0, 0),
  { wide: false, width: 1 }
);

if (fail) process.exit(1);
