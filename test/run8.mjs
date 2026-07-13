import { buildPasteLink } from "./bundle.mjs";
let fail = 0;
const ok = (name, cond, extra="") => { if (!cond) fail++; console.log(`${cond?"PASS":"FAIL"} ${name}${cond?"":" :: "+extra}`); };

ok("wraps selection", buildPasteLink("my notes", "https://example.com/x") === "[my notes](https://example.com/x)");
ok("trims clip whitespace", buildPasteLink("a", "  https://e.co  ") === "[a](https://e.co)");
ok("obsidian:// works", buildPasteLink("note", "obsidian://open?vault=x") === "[note](obsidian://open?vault=x)");
ok("non-url passes through", buildPasteLink("a", "hello world") === null);
ok("empty selection passes through", buildPasteLink("", "https://e.co") === null);
ok("url-over-url passes through", buildPasteLink("https://a.com", "https://b.com") === null);
ok("multiline selection passes through", buildPasteLink("a\nb", "https://e.co") === null);
ok("ftp not treated as url", buildPasteLink("a", "ftp://x") === null);

console.log(fail === 0 ? "ALL PASS" : `${fail} FAILURES`);
process.exit(fail);
