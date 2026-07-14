# Notion Flow

[简体中文](README.zh.md) · [English example note](examples/notion-flow-demo.md) · [中文示例文档](examples/notion-flow-demo.zh.md)

Notion-style block editing for Obsidian: move complete Markdown blocks, insert content with `/`, format text from a floating toolbar, and edit tables without losing the plain-text workflow.

> [!NOTE]
> Notion Flow improves editing inside Obsidian. It does not connect to, import from, export to, or sync with Notion.

## Highlights

- **Block controls:** drag paragraphs, headings, lists with children, quotes, Callouts, code fences, and tables. Click the handle for block actions, or click `+` to insert below.
- **Slash commands:** insert headings, lists, Callouts, toggles, code blocks, tables, dividers, embeds, and internal links with English or Chinese search terms.
- **Formatting toolbar:** apply bold, italic, underline, strikethrough, text color, highlight, inline code, links, or clear formatting.
- **Table tools:** add, remove, align, color, format, and move tables; use faster keyboard navigation while editing raw Markdown tables.
- **Cleaner Live Preview:** refine tasks, quotes, dividers, inline code, nested blocks, and Markdown syntax visibility; list-marker cycles remain available independently.

## Requirements

- Obsidian 1.5.0 or later
- Obsidian desktop; mobile is not supported
- Live Preview for the complete editing experience
- No account, API key, or external service

## Installation

### From a published release

Use this option when the [Releases page](https://github.com/xinli12/obsidian-notion-flow/releases) contains a published version. If it does not, use the source-build instructions below.

1. Download `main.js`, `manifest.json`, and `styles.css` from the same release.
2. Create `<vault>/.obsidian/plugins/notion-flow/`.
3. Copy the three files into that folder.
4. Restart Obsidian.
5. Open **Settings → Community plugins**, turn on community plugins if needed, and enable **Notion Flow**.

### Build from source

Node.js 18 or later is required; CI uses Node.js 20.

```bash
git clone https://github.com/xinli12/obsidian-notion-flow.git
cd obsidian-notion-flow
npm install --legacy-peer-deps
npm run build
```

Copy the generated `main.js` together with `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/notion-flow/`, restart Obsidian, then enable the plugin under **Settings → Community plugins**.

Set **Settings → Editor → Default editing mode** to **Live Preview**, or switch the current note to Live Preview from its view menu.

## Quick start

1. Copy the [English](examples/notion-flow-demo.md) or [Chinese](examples/notion-flow-demo.zh.md) example note into your vault.
2. Open the copy in Live Preview.
3. Hover beside a block. Drag `⋮⋮` to move it, click `⋮⋮` for its menu, or click `+` to insert a new block below.
4. Type `/` at the start of a line and choose a block type.
5. Select text to open the formatting toolbar.
6. Click a rendered table cell to open the table toolbar.

Most editing and appearance features can be configured under **Settings → Notion Flow**.

## Using Notion Flow

### Blocks

The drag handle treats Markdown structures as complete blocks. A list item moves with its nested children; a quote, Callout, code fence, or table moves as a unit. Move the pointer horizontally while dragging to choose a valid nesting level. Drag only sideways to re-indent in place, move near the top or bottom edge to auto-scroll, or press `Esc` to cancel.

Click the handle without dragging to open the block menu:

- Convert a one-line block to text, a heading, a list, a to-do, or a quote.
- Duplicate, copy, or delete the complete block.
- For tables, add rows or columns on either side, set whole-table alignment or background, and format the source.

`+` inserts a fresh line below the current block and opens the slash menu.

### Slash commands

Type `/` at the start of a line, after whitespace, or directly after CJK text. Search works with English and Chinese terms regardless of the interface language.

Available items include `/h1`, `/h2`, `/h3`, `/bullet`, `/number`, `/todo`, `/quote`, `/callout`, `/toggle`, `/code`, `/table`, `/divider`, `/image`, and `/link`.

Selecting **Table** with the pointer opens a grid for up to 10 × 10 cells. Drag in the grid, or use its arrow keys and press `Enter`. Pressing `Enter` directly on the slash result inserts the default 3 × 3 table. Slash commands do not open inside fenced code blocks.

### Text formatting

Select editor text to show the floating toolbar. It supports:

- Bold, italic, underline, strikethrough, and inline code
- Text color and highlight palettes
- Markdown links
- Clear formatting

Pasting an `http://`, `https://`, or `obsidian://` URL over selected single-line text converts the selection to `[text](url)` when **Paste URLs as links** is enabled.

### Tables

In Live Preview, click a rendered cell to show actions for rows, columns, column alignment, cell or table background, formatting, and deletion. Press `Alt+F10` to focus the toolbar, then use left and right arrows to move between its buttons.

The **Table editing enhancements** setting applies to raw `|` tables in Source mode or while a table is still unrendered:

- `Tab` / `Shift+Tab` move between editable cells.
- `Enter` moves to the same column in the next row.
- Navigation from the final cell appends a row.
- Typing a header such as `| Name | Quantity` and pressing `Tab` creates the delimiter and first body row.
- Pressing `Enter` on an empty final row removes it and leaves the table.

The same structural operations are available in the command palette and the raw-table context menu. **Format table** aligns columns using CJK-aware display widths.

### Appearance

- **Cleaner WYSIWYG rendering** is display-only: it refines headings, tasks, dividers, inline code, and quotes without rewriting Markdown. List cycles stay enabled independently. Quote markers are concealed on inactive Live Preview lines and return on the active line.
- Both Live Preview and Reading view cycle styles across the full mixed-list depth: filled, hollow, and square bullets; decimal, lower-alpha, and lower-Roman numbers. The active Live Preview line still shows its editable Markdown number.
- Code fences, Callouts, and quotes dragged to any valid list depth use the real content level and stay aligned in source and rendered states.
- **Notion-style tables**, header tint, and striped rows can be configured independently.
- Wide Markdown tables become horizontally scrollable in Reading view.
- **Conceal inline Markdown syntax** optionally hides formatting markers until the caret enters their source. Markdown links remain visible and Source mode is unchanged.

## Commands and shortcuts

| Action | Default shortcut |
| --- | --- |
| Move block up | `Alt/Option+↑` |
| Move block down | `Alt/Option+↓` |
| Duplicate block | `Alt/Option+Shift+D` |
| Focus an open formatting/table toolbar | `Alt+F10` |

Block shortcuts can be changed under Obsidian's **Hotkeys** settings. The command palette also provides table row/column operations, **Format table**, and **Repair nested Callout**.

## Settings and defaults

| Setting | Default | Controls |
| --- | --- | --- |
| Drag-and-drop blocks | On | Handle, `+`, drag-and-drop, and block menu |
| Slash commands | On | `/` suggestion menu |
| Floating format toolbar | On | Text formatting and the in-place table toolbar |
| Paste URLs as links | On | URL-over-selection conversion |
| Table editing enhancements | On | Raw-table keyboard navigation and editor context menu |
| Notion-style tables | On | Rounded table appearance, focus, hover, and spacing |
| Table header background | Theme default | Header tint, none, or one of eight palette colors |
| Striped table rows | Off | Alternating body-row tint |
| Cleaner WYSIWYG rendering | On | Display-only Live Preview and Reading-view refinements; never changes Markdown |
| Conceal HTML formatting tags | On | Hides plugin-generated formatting tags in Live Preview |
| List marker color | Accent | Accent, theme default, or one of eight palette colors |
| Quote bar color | Text color | Neutral ink, accent, theme default, or one of eight palette colors |
| Conceal inline Markdown syntax | Off | Hides supported inline Markdown markers in Live Preview |

The settings page also includes **Restore defaults**.

## What is written to Markdown

Most actions produce standard Markdown. Underline, text colors, and colored highlights use inline HTML. Table and cell colors use small class markers rendered by Notion Flow's stylesheet. These markers remain in the note so colors survive sync and copy/paste, but their appearance outside Obsidian or without the plugin is not guaranteed.

Notion Flow does not upload note content. Opening documentation or examples uses your browser, and **Copy text** uses the system clipboard.

## Troubleshooting and limitations

- **No block handle:** use desktop Live Preview and make sure **Drag-and-drop blocks** is enabled.
- **No table toolbar:** enable **Floating format toolbar**. **Table editing enhancements** controls raw-table keys and the context menu, not this toolbar.
- **`Tab` or `Enter` does not use Notion Flow navigation:** the enhanced key behavior applies only to raw Markdown tables, not Obsidian's rendered cell editor.
- **Toolbar cannot format a selection inside a rendered widget:** Obsidian may expose a DOM-only selection inside a rendered Callout or colored word. Open the widget's source or extend the selection into normal editor text.
- **An older nested Callout appears as code:** put the caret on its Callout source and run **Notion Flow: Repair nested Callout**. The change is undoable.
- **Manual install is not detected:** verify the folder is exactly `.obsidian/plugins/notion-flow/`, contains all three release files, and restart Obsidian.

## Language

The interface follows Obsidian's language setting and includes English and Simplified Chinese. Slash-command search accepts both languages in either interface. Documentation and example buttons for both languages are available under **Settings → Notion Flow → Help & examples**.

## Development

```bash
npm install --legacy-peer-deps
npm run typecheck
npm test
npm run build
```

For local testing, copy `main.js`, `manifest.json`, and `styles.css` into a test vault's `.obsidian/plugins/notion-flow/` folder and reload the plugin.

## License

[MIT](LICENSE)
