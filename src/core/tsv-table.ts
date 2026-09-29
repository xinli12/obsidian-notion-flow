/* Tab-separated text (a spreadsheet selection, a copied SQL result) pasted
 * into a note becomes a Markdown table. The checks are deliberately strict:
 * a paste is only a table when every line has the same number of tabs and
 * the cells look like data, so tab-indented code or prose keeps pasting as
 * text. */

export interface TsvTableOptions {
  /** Pretty-printer applied to the finished table (main.ts passes formatTable). */
  format?: (md: string) => string;
}

/** One cell as it goes into a pipe row: trimmed, newlines folded, pipes
 * escaped (already-escaped pipes stay single). */
function tableCell(cell: string): string {
  return cell.replace(/[\r\n]+/g, " ").trim().replace(/\\?\|/g, "\\|");
}

/**
 * Convert TSV text to a Markdown table, or null when the text is not a
 * table: fewer than two lines, no tabs, an uneven tab count, no row with two
 * filled cells, or a single-tab block where every line starts with the tab
 * (indented code or prose, not a column with a blank cell). The first line
 * is the header.
 */
export function tsvToMarkdownTable(text: string, opts: TsvTableOptions = {}): string | null {
  const lines = text.split(/\r?\n/).filter((line) => line.includes("\t") || line.trim() !== "");
  if (lines.length < 2) return null;
  const tabs = lines.map((line) => line.split("\t").length - 1);
  if (tabs[0] < 1 || tabs.some((count) => count !== tabs[0])) return null;
  if (tabs[0] === 1 && lines.every((line) => line.startsWith("\t"))) return null;
  const rows = lines.map((line) => line.split("\t").map(tableCell));
  if (!rows.some((cells) => cells.filter((cell) => cell !== "").length >= 2)) return null;
  const row = (cells: string[]) => "| " + cells.join(" | ") + " |";
  const md = [row(rows[0]), row(Array(tabs[0] + 1).fill("---")), ...rows.slice(1).map(row)].join("\n");
  return opts.format ? opts.format(md) : md;
}

/** Clipboard HTML written by a spreadsheet app. Their tables are plain
 * grids with no header markup, which Obsidian's HTML conversion turns into
 * an empty header row above the real one, so the TSV path wins there. */
const SPREADSHEET_HTML = [
  /ProgId[^>]*Excel\.Sheet/i,
  /google-sheets-html-origin/i,
  /<meta[^>]+(?:LibreOffice|Numbers)/i,
];

/**
 * Whether a paste that also carries `text/html` should still take the TSV
 * table path. No HTML table: yes (today's path). A table with header markup
 * (`<th>`/`<thead>`) converts correctly in Obsidian, and plain text that is
 * not TSV has nothing better to offer: no. Spreadsheet clipboards (Excel,
 * Google Sheets, LibreOffice, Numbers): yes. Any other web table keeps
 * Obsidian's conversion when its cells hold links, images or line breaks,
 * which the TSV text would flatten.
 */
export function preferTsvOverHtml(html: string | null | undefined, plain: string): boolean {
  if (!html) return true;
  const start = html.search(/<table[\s>]/i);
  if (start < 0) return true;
  if (/<(?:th|thead)[\s>]/i.test(html)) return false;
  if (tsvToMarkdownTable(plain) == null) return false;
  if (SPREADSHEET_HTML.some((re) => re.test(html))) return true;
  const end = html.search(/<\/table\s*>/i);
  const table = html.slice(start, end > start ? end : undefined);
  return !/<(?:a|img|br)[\s>/]/i.test(table);
}
