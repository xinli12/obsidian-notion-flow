# Notion Flow

[简体中文](README.zh.md) · [English example note](examples/notion-flow-demo.md) · [中文示例文档](examples/notion-flow-demo.zh.md)

Notion-style block editing for Obsidian: move complete Markdown blocks, insert content with `/`, format text from a floating toolbar, and edit tables without losing the plain-text workflow.

> [!NOTE]
> Notion Flow improves editing inside Obsidian. It does not connect to, import from, export to, or sync with Notion.

## Highlights

- **Block controls:** drag paragraphs, headings, lists with children, quotes, Callouts, code fences, and tables. Click the handle for block actions, or click `+` to insert below.
- **Slash commands:** insert headings, lists, Callouts, toggles, code blocks, tables, columns, dividers, embeds, and internal links with English or Chinese search terms.
- **Columns:** put blocks side by side, Notion-style — insert with `/columns`, convert from the block menu, or drag a block to the right edge of another. Written as plain nested Callouts, so notes stay portable.
- **Comments:** select text and attach a note to it, Notion-style — yellow anchor, 💬 marker, click to read, edit, or resolve. Stored inside the note, invisible in other Markdown apps.
- **Formatting toolbar:** apply bold, italic, underline, strikethrough, text color, highlight, inline code, links, or clear formatting — including bold, italic, strikethrough, underline, and colors inside fenced code blocks.
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
- For quotes and Callouts, pick the Callout type, toggle folding, or turn a Callout back into a plain quote.
- For tables, add rows or columns on either side, set whole-table alignment or background, and format the source.

`+` inserts a fresh line below the current block and opens the slash menu.

### Slash commands

Type `/` (or fullwidth `／`) at the start of a line, after whitespace, or directly after CJK text. Search works with English and Chinese terms regardless of the interface language. Each menu row shows an icon, a name, a one-line description, and the syntax it writes; the commands you used most recently rise to the top of the unfiltered menu.

Available items include `/h1`, `/h2`, `/h3`, `/bullet`, `/number`, `/todo`, `/quote`, `/callout`, `/toggle`, `/cols2`, `/cols3`, `/code`, `/table`, `/divider`, `/image`, and `/link`.

Selecting **Table** with the pointer opens a grid for up to 10 × 10 cells. Drag in the grid, or use its arrow keys and press `Enter`. Pressing `Enter` directly on the slash result inserts the default 3 × 3 table. Slash commands do not open inside fenced code blocks.

### Text formatting

Select editor text to show the floating toolbar. It supports:

- Bold, italic, underline, strikethrough, and inline code
- Text color and highlight palettes
- Markdown links
- Comments (💬) on the selection
- Clear formatting (`Cmd/Ctrl+\`): strips every format that touches the selection — bold/italic (`*` and `_` alike), strikethrough, highlight, inline code, and the colors/underline whose hidden HTML tags sit entirely outside the selection. Whole marker pairs are always removed together, so a partial selection never leaves a stray `**` or `</span>` behind. Comments are notes, not formatting — they survive.

Pasting an `http://`, `https://`, or `obsidian://` URL over selected single-line text converts the selection to `[text](url)` when **Paste URLs as links** is enabled. With **Paste URLs with page titles** enabled, pasting a URL with nothing selected inserts it immediately and then upgrades it to `[page title](url)` once the title arrives in the background — the plain URL stays if the page cannot be reached, and pastes inside code are never touched.

Inside a fenced code block the toolbar switches to HTML tags (`<b>`, `<i>`, `<s>`, `<u>`, and the color spans), because Markdown markers stay literal text there. The tags are concealed in Live Preview and rendered as styled code in Reading view; the inline-code and link buttons are disabled since they have no meaning inside code. **Clear formatting** in a code block removes only these tags — literal `*` and `` ` `` characters in your code are never touched.

### Code blocks

With **Code block enhancements** enabled:

- `Enter` continues the current line's indentation, so a code block nested in a (deep) list keeps every new line aligned with the list's content column.
- `Backspace` at the start of a code line's text removes one whole indent level instead of one character.
- `Enter` at the end of a freshly typed, unclosed ` ``` ` line writes the closing fence and places the caret inside, so the fence never swallows the rest of the note.
- `Cmd/Ctrl+Shift+Enter` — the **Exit code block** command, rebindable under Hotkeys — exits below the block onto a correctly indented line, writing the missing closing fence first when needed.

### Callouts and quotes

With **Callout and quote enhancements** enabled:

- `Enter` inside a quote or Callout continues the `>` marker; `Enter` on an empty `>` line exits the block (one level at a time when nested), so two presses at the end leave the Callout, Notion-style.
- `Backspace` at the start of a line's text removes one whole `>` marker instead of deleting it character by character.
- Pasting multi-line text inside a quote or Callout prefixes every line so the block stays intact; rich text is converted to Markdown first, and file pastes keep Obsidian's normal handling.
- Clicking a rendered Callout places the caret at the click point and starts editing immediately, instead of Obsidian's select-the-whole-block first click. A drag still selects the block.
- While the caret is inside a Callout, its source lines keep the rendered look: type-colored background, rounded corners, and a colored title row.
- In Live Preview, clicking a rendered Callout's icon opens a type menu with Obsidian's thirteen built-in types, a **Foldable** toggle, and **Turn into quote**. The same controls appear in the block handle menu, where choosing a type for a plain quote upgrades it to a Callout.
- With **Cleaner WYSIWYG rendering** on, idle code-fence rows hide their ``` markers (the language flair still names the block), and quote markers stay quiet even on the active line.

### Columns

With **Columns** enabled, blocks can sit side by side, Notion-style:

- Type `/columns` (or `/分栏`) and pick **Two columns** or **Three columns**.
- Drag a block by its handle to the **right edge** of another top-level block — a vertical accent bar marks the target — and drop to place the two side by side. Dropping onto an existing column row appends one more column.
- Every rendered row shows a small column button near its top-right corner (full strength on hover) — one click opens **Add column**, **Column widths**, and **Unwrap columns**. The same items live in the block handle menu, which also offers **Turn into columns** for any top-level block.
- Drag the gutter between two columns to resize them in place; a live percentage readout follows the pointer and one undo restores the previous widths. Focus a gutter and use ←/→ for 1% steps (hold Shift for 5%), or double-click it to distribute the row evenly.
- Hover an individual column for its **⋯** menu: insert a column on either side, move the current column left/right, or delete it. Deleting a non-empty column asks for confirmation; deleting one side of a two-column row automatically unwraps the survivor.
- Pin a width with Callout metadata: `> > [!nf-col|30]` holds 30% of the row (valid values 10–90); unsized columns share the rest — or pick a preset from the block menu's **Column widths** submenu (equal, narrow left, narrow right). Pane-width responsive layout stacks the whole row below 560px, so three columns never fall into an awkward 2 + 1 wrap.
- **Unwrap columns** in the block menu flattens a row back into ordinary stacked blocks.
- An empty column shows a dashed **+** placeholder, so it stays visible and clickable; hovering a rendered row sketches each column's boundary.
- Click a rendered column to edit that column in place without exposing the row's structural `> >` prefixes. The active column becomes a clean editor while its siblings stay rendered for context; click another preview to switch, use the code button for raw source, or press `Esc` / the check button to finish. Undo and redo still belong to the main note.
- Slash commands used **inside** a column (or any quote/Callout) keep the block's `>` markers, so an inserted code block, table, or Callout stays in its column.
- Columns are written as nested Callouts — `[!nf-cols]` wrapping `[!nf-col]` children — which render as ordinary nested quotes in any other Markdown app, so notes stay portable.
- Raw Source mode still exposes the portable `[!nf-cols]` / `[!nf-col]` syntax when you need it; its scaffolding rows read faint because they are structure, not prose.
- Column source is parsed as a real row/column model: fenced code that contains `[!nf-col]` is not mistaken for a new column, mixed tabs/spaces survive conversion, empty-column Enter/Backspace cannot remove structural markers, and code/table keyboard editing keeps the column prefix intact.

### Comments

With **Comments** enabled, select text and annotate it, Notion-style:

- Add a comment from the floating toolbar's 💬 button, the **Add comment** command, or `Cmd/Ctrl+Shift+M`. Comments cover a single-line selection.
- The anchored text highlights in yellow with a small 💬 marker after it. Hover either one to read the comment; click the marker to edit it or **Resolve** it (resolving removes the markup and keeps the text).
- In Reading view the anchor keeps its highlight and shows the comment on hover.
- Comments are stored inside the note as `<span class="nf-cmt" data-nf-cmt="…">text</span>` — in any other Markdown app the anchored text reads normally and the comment stays invisible. **Clear formatting** also removes comment markup from the selection.

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
| Add comment | `Cmd/Ctrl+Shift+M` |
| Clear formatting | `Cmd/Ctrl+\` |
| Focus an open formatting/table toolbar | `Alt+F10` |

Block shortcuts can be changed under Obsidian's **Hotkeys** settings. The command palette also provides table row/column operations, **Format table**, and **Repair nested Callout**.

## Settings and defaults

| Setting | Default | Controls |
| --- | --- | --- |
| Drag-and-drop blocks | On | Handle, `+`, drag-and-drop, and block menu |
| Slash commands | On | `/` suggestion menu |
| Floating format toolbar | On | Text formatting and the in-place table toolbar |
| Paste URLs as links | On | URL-over-selection conversion |
| Paste URLs with page titles | On | Background title fetch turns a pasted bare URL into `[title](url)` |
| Callout and quote enhancements | On | Smart `Enter`/`Backspace` in quotes, quoted multi-line pastes, and the Callout type menu |
| Code block enhancements | On | Indent-keeping `Enter`, indent-level `Backspace`, fence auto-close, and downward block exit |
| Columns | On | Notion-style side-by-side layout via nested `[!nf-cols]`/`[!nf-col]` Callouts |
| Comments | On | Selection-anchored notes with yellow anchors, 💬 markers, and hover tooltips |
| Table editing enhancements | On | Raw-table keyboard navigation and editor context menu |
| Notion-style tables | On | Rounded table appearance, focus, hover, and spacing |
| Table header background | Theme default | Header tint, none, or one of eight palette colors |
| Striped table rows | Off | Alternating body-row tint |
| Cleaner WYSIWYG rendering | On | Display-only Live Preview and Reading-view refinements; never changes Markdown |
| Conceal HTML formatting tags | On | Hides plugin-generated formatting tags in Live Preview and renders them inside Reading-view code blocks |
| List marker color | Accent | Accent, theme default, or one of eight palette colors |
| Quote bar color | Text color | Neutral ink, accent, theme default, or one of eight palette colors |
| Inline code color | Red | Notion-style ink for `inline code`, theme default, or one of eight palette colors |
| Conceal inline Markdown syntax | On | Hides supported inline Markdown markers in Live Preview |

The settings page also includes **Restore defaults**.

## What is written to Markdown

Most actions produce standard Markdown. Underline, text colors, and colored highlights use inline HTML, as does all formatting inside fenced code blocks (`<b>`, `<i>`, `<s>`, `<u>`, color spans). Columns are nested Callouts (`[!nf-cols]` / `[!nf-col]`), which degrade to ordinary nested quotes elsewhere. Comments are spans with a data attribute — elsewhere the anchored text reads normally and the note stays invisible. Table and cell colors use small class markers rendered by Notion Flow's stylesheet. These markers remain in the note so colors survive sync and copy/paste, but their appearance outside Obsidian or without the plugin is not guaranteed.

Notion Flow does not upload note content. With **Paste URLs with page titles** enabled, pasting a link sends a single request to that URL to read its title; disable the setting to stay fully offline. Opening documentation or examples uses your browser, and **Copy text** uses the system clipboard.

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
