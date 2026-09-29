# Notion Flow

[简体中文](README.zh.md) · [English example note](examples/notion-flow-demo.md) · [中文示例文档](examples/notion-flow-demo.zh.md) · [Style sampler](examples/notion-flow-style-demo.md)

Notion-style block editing for Obsidian: move complete Markdown blocks, insert content with `/`, format text from a floating toolbar, edit tables, and give every note a designed palette and look — without losing the plain-text workflow.

> [!NOTE]
> Notion Flow improves editing inside Obsidian. It does not connect to, import from, export to, or sync with Notion.

## Highlights

- **Note style:** nine designed palettes and six looks restyle everything the plugin draws — callouts, headings, highlights, tables, quotes, lists, to-dos, dividers, toggles, columns, inline code, and code blocks — in light and dark mode. Preview them live with **Change note style…**. Display-only: your Markdown never changes.
- **Block controls:** drag paragraphs, headings, lists with children, quotes, Callouts, code fences, and tables. Click the handle for block actions — including **Block color** (text or background), **Move to…** and **Turn into page** — or click `+` to insert below.
- **Pages:** a Notion-style page icon and cover from the note's properties, and a page font, small text, and full width per note.
- **Multi-block selection:** drag a marquee from empty editor space (or Alt/Option-drag anywhere), then convert, copy, cut, paste over, duplicate, or delete the selected blocks in one step.
- **Slash commands:** a grouped menu that inserts headings, lists, Callouts, toggles, code blocks, tables (`/table4x6` sizes one directly), columns, dividers, equations, diagrams, images, videos, dates and times, internal links, a table of contents (`/toc`), and templates from your templates folder — with English or Chinese search terms, Callout types by name (`/tip`, `/warning`, `/提示`), and colors (`/red`, `/red background`).
- **Toggles:** fold any block away behind a Notion-style triangle — insert with `/toggle` or convert from the block menu — and collapse or expand every toggle at once. The open state is saved in the note, not in workspace state.
- **Columns:** put blocks side by side, Notion-style — insert with `/columns`, convert from the block menu, or drag a block to the right edge of another. Written as plain nested Callouts, so notes stay portable.
- **Comments:** select text and attach a note to it, Notion-style — yellow anchor, 💬 marker, and a hover card with **Edit** and **Resolve**, and **Show comments in this note** lists them all. Stored inside the note, invisible in other Markdown apps.
- **Formatting toolbar:** apply bold, italic, underline (`Cmd/Ctrl+U`), strikethrough, text color, highlight, inline code, or clear formatting — including bold, italic, strikethrough, underline, and colors inside fenced code blocks. Links are edited in a small card — `Cmd/Ctrl+K` opens it, for Markdown links and `[[wikilinks]]` alike, with note suggestions. The color buttons show the color under the caret, and `Cmd/Ctrl+Shift+H` re-applies the last highlight.
- **Table tools:** add, remove, move, duplicate, sort, align, color, format, and move tables; paste spreadsheet cells as a table; use faster keyboard navigation while editing raw Markdown tables.
- **Cleaner Live Preview:** refine tasks, quotes, dividers, inline code, Mermaid diagrams, nested blocks, and Markdown syntax visibility; empty headings, lists, to-dos, and quotes show a placeholder.
- **Canvas mind maps:** grow, fold, drag, and rearrange cards like a mind map that keeps itself tidy and moves smoothly — with tapered or elbow branch lines, boundaries around branches, task progress, a presentation mode, **+** buttons, card search, a minimap, one-click connections and relation lines, summary braces, markers and numbering, notes that open with a click and links that jump to a web page, a note or another card, card shapes, text sizes and line weights, designed color schemes (with dark variants) that can follow your note palette and your own saved schemes, a typing flow, a built-in guide, and notes that turn into maps and back — while notes, images, links, labeled cross-links, and free-form cards stay on the same canvas.

## Requirements

- Obsidian 1.13.0 or later — Callout colors rely on the CSS-color form of `--callout-color` that Obsidian 1.13 introduced, so this release requires Obsidian ≥ 1.13
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

1. Copy the [English](examples/notion-flow-demo.md) or [Chinese](examples/notion-flow-demo.zh.md) example note into your vault, or use **Settings → Notion Flow → Help & examples → Create tour notes in my vault**.
2. Open the copy in Live Preview.
3. Hover beside a block. Drag `⋮⋮` to move it, click `⋮⋮` for its menu, or click `+` to insert a new block below.
4. Type `/` at the start of a line and choose a block type.
5. Select text to open the formatting toolbar.
6. Click a rendered table cell to open the table toolbar.
7. Run **Change note style…** from the command palette and arrow through the palettes and looks; `Esc` puts everything back.

Most editing and appearance features can be configured under **Settings → Notion Flow**.

On first run a notice offers the **shortcut guide** — also under **Settings → Notion Flow → Keyboard shortcuts** and as the **Open shortcut guide** command. After an update, clicking the notice opens **What's new** inside Obsidian: the release's highlights with **Try it** buttons, **Create tour notes in my vault**, and **Release notes on GitHub**. **What's new** and **Create tour notes in my vault** are also under **Settings → Notion Flow → Help & examples**.

## Using Notion Flow

### Blocks

The drag handle treats Markdown structures as complete blocks. A list item moves with its nested children; a quote, Callout, code fence, or table moves as a unit. Move the pointer horizontally while dragging to choose a valid nesting level. Drag only sideways to re-indent in place, move near the top or bottom edge to auto-scroll, or press `Esc` to cancel.

Click the handle without dragging to open the block menu:

- **Turn into** opens a submenu — its title names the block's current type, as in **Turn into · Callout**, and each row shows its keyboard chord — to convert a block to text, a heading, a list, a to-do, or a quote, or to wrap it in a Callout, a toggle, or a code block. Wrapping in a Callout keeps the text as its content and leaves the caret on the empty title row; a plain quote keeps its own markers and only gains the header, so it is upgraded rather than nested one level deeper.
- A Callout, toggle, or multi-line quote turned into a heading or a list type keeps only its **title** as the new heading or item; its body is unwrapped — indented under a list item, or as plain rows after a heading. **Text** is a plain unwrap and **Quote** keeps a quote, so a list or code block inside a Callout survives being lifted out of it. With several blocks selected, every block converts in one step.
- **Block color** colors a whole block: nine text inks or nine backgrounds, plus **Default**; the current one is checked. Backgrounds tint every line of the block and follow the palette. Headings, tables, code blocks, images, and Callout headers have no block color (color a heading's words with the toolbar). The same colors are on the block-selection toolbar and in the slash menu (`/red`, `/red background`).
- Move the block up or down, duplicate it, copy its text, copy a link or an embed to it (a heading links by its text; any other block gets — or reuses — an Obsidian `^block-id`), or delete it. Menu rows carry their keyboard chords.
- **Move to…** moves the block into another note with Obsidian's core **Note composer**, and is hidden while that core plugin is off. **Turn into page** moves the block into a new note and leaves a link in its place.
- For Callouts, pick the **Callout type**, its **Callout color** (nine palette inks, independent of the type), an **Icon…**, or toggle **Foldable**. Choosing a type for a plain quote upgrades it to a Callout.
- For tables, add rows or columns on either side, set whole-table alignment or background, and format the source.
- For images, **Image size** offers 25 %, 50 %, 75 % and **Full column width**, each measured against the column the image sits in, plus **Original**; **Image alignment** sets **Align left**, **Align center**, or **Align right**, written as a word Obsidian understands in the embed (`![[image.png|center|480]]`). You can also drag the image's right edge with a live pixel readout; the width is written as Obsidian's own `![[image.png|480]]` suffix.

`+` inserts a fresh block below the current one and opens the slash menu. On a list item it adds the next item instead (a to-do adds a to-do); **Alt/Option-click** adds above. The menu and the **Insert block below** (`Cmd+Option+=` on macOS) / **Insert block above** (`Cmd+Option+Shift+=`) commands do the same from the keyboard — the way to write above a note that opens with a rendered Callout, table, or code block. On Windows and Linux they have no default chord (see [Commands and shortcuts](#commands-and-shortcuts)).

With **Empty-line hint** enabled, the empty line you are writing on carries a faint "Type / for commands", the way Notion labels an empty block. It is generated by the stylesheet rather than inserted, so it adds nothing to the note, cannot be selected or copied, and never appears inside a code block or on a line that already has text.

With **Shorthand while typing** enabled, the blocks Obsidian has no shorthand for grow out of a few characters the way `-` grows a list. Type `>!` and a space for a Callout, `>!tip` or `>!warning` (or `>!提示`) to pick the type, and add a trailing `+` or `-` to make it foldable — `>!toggle` writes a Notion-style toggle. `[]` and a space write a to-do. The full-width characters a Chinese keyboard types work too: `【】` and a space write a to-do (`【x】` a checked one), `》` and a space a quote, and `>！` or `》！` a Callout (`>！提示`). A Callout typed directly under a paragraph leaves a blank line above itself, so the paragraph is not swallowed. A shorthand only expands at the end of the line you are typing, never inside a fenced code block, and an unknown type stays literal, so `>!foo ` is left as written. One undo puts the characters back.

With **Block indentation with Tab** enabled, `Tab` and `Shift+Tab` step the block holding the caret through the same nesting levels a sideways drag offers, so a paragraph, heading, quote, or Callout tucks under the list item above it without reaching for the pointer. Only levels the drag would also accept are reachable — four spaces under a paragraph is an indented code block in Markdown, not a nested one, and Tab never writes it. A list item stays with Obsidian's own indent (it renumbers siblings, which this does not), a table cell with table navigation, and a code block with code indentation. Where a block has nowhere to go, `Tab` keeps its ordinary meaning.

With **Backspace removes list markers** enabled, `Backspace` at the start of a list or to-do item's text removes the marker first — the item becomes plain text at the same depth, keeping its indentation and any quote prefix, and a to-do sheds its box together with its bullet — and only a second `Backspace` joins the line above, as in Notion. At the start of a heading's text it removes the whole `#` run in one step, turning the heading back into a paragraph.

Press `Esc` while writing to select the block holding the caret — the keyboard's way into block selection. `↑` and `↓` then walk to the block above or below (blank seams are stepped over), `Shift+↑`/`↓` extend the selection, `Cmd/Ctrl+Alt/Option+=` inserts a block below the selection (`+Shift` above), `Enter` returns to writing at the end of it, and a second `Esc` clears it. In Vim mode the key stays Vim's, and a suggestion popup, menu, or modal keeps its own `Esc`.

Drag from empty space beside a line to frame-select several blocks. You can also hold Alt/Option and drag from anywhere in the editor. The floating block toolbar converts every selected ordinary block at once (tables, fenced code blocks, and multi-line quotes are skipped so their structure is not damaged), and offers copy and delete buttons. The selection also answers the keyboard: `Cmd/Ctrl+C` copies, `Cmd/Ctrl+X` cuts, `Cmd/Ctrl+V` replaces the selected blocks with the clipboard, `Cmd/Ctrl+D` duplicates them and selects the copy, `Cmd/Ctrl+A` grows the selection to the whole note, and `Backspace`/`Delete` removes them. Press `Esc` or use the × button to clear the selection. `Shift+click` a line to extend the selection to it, and grabbing any selected block's handle drags the whole selection as one span; after a drop or a keyboard move a brief landing flash shows where the blocks went. Every block-mode key is listed under [Commands and shortcuts](#commands-and-shortcuts).

### Slash commands

Type `/` (or fullwidth `／`) at the start of a line, after whitespace, or directly after CJK text. Search works with English and Chinese terms regardless of the interface language, and Chinese names also match their pinyin and initials (`/zw` → 正文, `/yjbt` → 一级标题, `/lianglan` → 两栏). Each menu row shows an icon, a name, a one-line description, and the syntax it writes.

The unfiltered menu is grouped — **Basic blocks**, **Lists**, **Callouts & toggles**, **Media & tables**, **Advanced**, and **Dates** — with up to three **Recent** entries on top. Date entries preview what they will write.

Available items include `/h1`, `/h2`, `/h3`, `/bullet`, `/number`, `/todo`, `/quote`, `/callout`, `/toggle`, `/cols2`, `/cols3`, `/code`, `/table`, `/divider`, `/image`, `/video`, and `/link`, plus **Text** (back to a plain paragraph), **Equation block** and **Inline equation** (LaTeX), **Diagram** (a Mermaid fence), and **Date**, **Time**, **Date and time**, **Tomorrow**, and **Yesterday**, which write the current date or time in the formats set under **Date format** and **Time format**.

Some entries appear only when you search for them:

- **Callout types by name:** `/tip`, `/warning`, or `/提示` offer **Callout · Tip** and friends — all thirteen of Obsidian's types.
- **Colors:** `/red` or `/红色` colors the block's text; `/red background`, `/红色背景`, or `/bg red` gives it a background (see **Block color** under [Blocks](#blocks)).

**Table of contents** (`/toc`) writes a `<!-- nf-toc -->` marker followed by a nested list of `[[#Heading]]` links. The links follow Obsidian's own heading-link rules, so a repeated heading links through its parent (`[[#Week 2#Notes|Notes]]`). In Live Preview the marker shows as a small **Table of contents** chip whose refresh button — like the **Refresh table of contents** command — rewrites the list in one undo step. In a note without headings, a notice says so.

**Templates.** With the core **Templates** plugin on and a template folder set, each template is its own entry, **Template · name**, inserted by Templates itself, so `{{date}}`, `{{title}}`, and properties work as they do there. With more than eight templates, one **Template** entry opens Obsidian's template picker, and searching still finds each file. Without a template folder, the **Template** entry runs Obsidian's own **Insert template**, which reports that no template folder is set; with core Templates off, it asks you to set one up.

Selecting **Table** — with the pointer or `Enter` — opens a grid for up to 10 × 10 cells. Drag in the grid, use its arrow keys, or type the size: a digit sets the columns and `Shift`+digit the rows (`0` is 10), then `Enter` inserts. Typing the size into the command, as in `/table4x6` (or a bare `/4x6`), skips the grid and inserts a 4-column, 6-row table directly. Slash commands do not open inside fenced code blocks.

### Text formatting

Select editor text to show the floating toolbar. It supports:

- Bold, italic, underline, strikethrough, and inline code. **Toggle underline** is `Cmd/Ctrl+U`; strikethrough and inline code keep Obsidian's own commands, which have no default chord.
- Text color and highlight palettes — nine low-chroma inks that follow the note palette, tuned separately for light and dark mode. The Text color and Highlight buttons show the color under the caret as a bar under the button, with the matching swatch checked, so picking another color or **Remove color** works from inside a colored run, even part-way through it. Each palette starts with a **Last used** swatch; `Cmd/Ctrl+Shift+H` (**Apply last used highlight**) and the **Apply last used text color** command re-apply them without opening the toolbar, and the **Text color…** and **Highlight color…** commands open the toolbar's color row from the keyboard
- LaTeX formulas take the same colors: a `$…$` or `$$…$$` in the selection is colored inside the delimiters (`\class{mjx-…}`), so it stays a formula instead of turning into literal dollar signs
- Markdown links and `[[wikilinks]]`, edited in a small card — from the link button, `Cmd/Ctrl+K` (Obsidian's Insert link chord, which opens this card while the floating toolbar is on; inside a code block Obsidian's own behavior runs), or the **Insert or edit link** command. The card has text and destination fields with note suggestions, **Open** (only for a destination that exists) and **Unlink**; a wikilink keeps its form, with its alias edited as the text, and a Markdown destination that contains spaces is wrapped in `<…>`
- Comments (💬) on the selection
- Clear formatting (`Cmd/Ctrl+\`): strips every format that touches the selection — bold/italic (`*` and `_` alike), strikethrough, highlight, inline code, and the colors/underline whose hidden HTML tags sit entirely outside the selection. Whole marker pairs are always removed together, so a partial selection never leaves a stray `**` or `</span>` behind. Comments are notes, not formatting — they survive.

Formatting a selection that spans several paragraphs or list items wraps each line separately, so markers never cross a block boundary. Inside a column, `Cmd/Ctrl+B`, `I`, `K`, `U`, and `\` act on that column only.

A toolbar button's tooltip shows its shortcut when one is bound, and a right-click hides the toolbar so Obsidian's context menu has room.

Pasting an `http://`, `https://`, or `obsidian://` URL over selected single-line text converts the selection to `[text](url)` when **Paste URLs as links** is enabled. With **Paste URLs with page titles** enabled, pasting a URL with nothing selected inserts it immediately and then upgrades it to `[page title](url)` once the title arrives in the background — the plain URL stays if the page cannot be reached, and pastes inside code are never touched.

Inside a fenced code block the toolbar switches to HTML tags (`<b>`, `<i>`, `<s>`, `<u>`, and the color spans), because Markdown markers stay literal text there. The tags are concealed in Live Preview and rendered as styled code in Reading view; the inline-code and link buttons are disabled since they have no meaning inside code. **Clear formatting** in a code block removes only these tags — literal `*` and `` ` `` characters in your code are never touched.

### Code blocks

With **Code block enhancements** enabled:

- `Enter` continues the current line's indentation, so a code block nested in a (deep) list keeps every new line aligned with the list's content column.
- `Backspace` at the start of a code line's text removes one whole indent level instead of one character.
- `Enter` at the end of a freshly typed, unclosed ` ``` ` line writes the closing fence and places the caret inside, so the fence never swallows the rest of the note.
- `Cmd/Ctrl+Shift+Enter` — the **Exit code block** command, rebindable under Hotkeys — exits below the block onto a correctly indented line, writing the missing closing fence first when needed. `↓` on the last line of a code block that ends the note makes a line below it, and `/code` inside a list stays indented under the item.
- Click the chevron in the language header to collapse or expand the code body. The state is saved in the note and survives reload and sync.
- Click the language name in that header to change it in a searchable language picker: about 40 languages with friendly names, aliases (`js` → JavaScript, `py` → Python), your recent picks first, **No language**, and any other token typed as-is. Picking the language the block already has (JavaScript for `js`) changes nothing. The chip stands in for the whole ` ```lang ` token in Live Preview, so this is where the language is edited — the rest of the info string (` ```js title=x `) is left untouched.
- The copy button in that header puts the block's code on the clipboard — without its quote markers or the indentation the surrounding list or Callout imposes, so it pastes as code. Reading view has Obsidian's own copy button; this is the Live Preview one.
- Code inside a quote or Callout is syntax-highlighted while you edit. Obsidian's editor never recognises a fence there — the rows arrive as one long run of plain text — so the plugin runs the vault's own language modes over them and emits the same token classes a top-level code block uses. The colors are your theme's, including this plugin's code themes.
- The block-handle menu can add or edit a caption. It stays visually attached below the code card and moves, duplicates, or deletes with the block.
- Image/embed blocks and tables offer the same **Add caption** action; the caption appears directly below the image or table and travels with it when the block is moved, duplicated, or deleted.

### Callouts and quotes

With **Callout and quote enhancements** enabled:

- `Enter` inside a quote or Callout continues the `>` marker; `Enter` on an empty `>` line at the **end** of the block exits it (one level at a time when nested), so two presses leave the Callout, Notion-style. On an empty `>` line with more of the block below it there is nothing to exit, so `Enter` simply adds another row and the block stays whole.
- `Backspace` at the start of a line's text removes one whole `>` marker instead of deleting it character by character — but only where leaving the block is what that means. On the **last** row of a quote or Callout it sheds one level, as before. On the container's **first** row it unwraps the whole block, since removing the marker from the title alone would strand every row under it. **Between** the two it joins the row onto the one above, the way `Backspace` at a line start behaves everywhere else. Structural rows the plugin writes itself — a `[!nf-cols]` header, the separator between two columns — absorb the key instead, so a column layout cannot be dismantled by a stray keystroke.
- Pasting multi-line text inside a quote or Callout prefixes every line so the block stays intact; rich text is converted to Markdown first, and file pastes keep Obsidian's normal handling.
- Clicking a rendered Callout places the caret at the click point and starts editing immediately, instead of Obsidian's select-the-whole-block first click. A drag still selects the block.
- While the caret is inside a Callout, editing stays inside its stable rendered look: structural `>` / `[!note]` tokens become an icon and fixed spacing instead of expanding into source, while the tint, corners, title, and text column stay put.
- In Live Preview, clicking a rendered Callout's icon opens its menu: Obsidian's thirteen built-in types, **Callout color**, **Icon…**, **Foldable**, and **Turn into quote**. The block handle menu offers the type, color, icon, and folding too, and there choosing a type for a plain quote upgrades it to a Callout.
- **Icon…** opens a searchable picker with 24 Lucide icons, a grid of emoji (your recent ones first), and **Default icon** to go back to the type's own. The choice is stored in the Callout's metadata — `nfi-<name>` for an icon (`> [!tip|nfi-rocket]`), or `nfi-emoji` with the emoji at the start of the title — which other apps ignore.
- **Callout color** tints a Callout with one of the nine palette inks regardless of its type. The color is stored as `> [!tip|nf-green]` metadata after the type — Obsidian and other apps ignore it, and a column width in the same slot is kept.
- **Callout style** — **Header strip**, **Flat (Notion-like)**, **Side rail**, **Soft card**, **Outlined**, **Icon only**, or **Gradient title** — now lives under [Note style](#note-style) → **Customize components**, and by default follows the look. Reading view never tints a Callout on hover, whichever style is chosen, and a title-only Callout has no divider under its title.
- While editing a code block, its opening fence becomes a compact language label and its closing fence collapses into the card edge, so focusing the block never exposes ``` source. Quote markers likewise use stable placeholders, keeping the text column from jumping.
- Code blocks and lists **inside a quote** render as you type. Obsidian's Live Preview leaves those rows as plain quote text — a fenced block keeps its raw ``` markers and a list shows a literal dash, even though Reading view renders both — so Notion Flow paints the code block's background and the list's bullets itself.

### Mermaid diagrams

With **Cleaner WYSIWYG rendering** enabled, rendered Mermaid diagrams use a theme-aware bordered canvas in Live Preview and Reading view. Flowcharts, sequence diagrams, subgraphs, notes, Gantt charts, and pie charts get clearer visual hierarchy. Wide diagrams retain readable labels and become horizontally scrollable instead of shrinking into a thumbnail; focus the diagram to scroll it with a keyboard or trackpad. Mermaid source remains unchanged.

### Columns

With **Columns** enabled, blocks can sit side by side, Notion-style:

- Type `/columns` (or `/分栏`) and pick **Two columns** or **Three columns**; the new row opens straight in the visual column editor, ready to type.
- Drag a block by its handle to the **right edge** of another top-level block — a vertical accent bar marks the target — and drop to place the two side by side. Dropping onto an existing column row appends one more column.
- Every rendered row shows a small column button near its top-right corner (full strength on hover) — one click opens **Add column**, **Column widths**, and **Unwrap columns**. The same items live in the block handle menu, which also offers **Turn into columns** for any top-level block.
- Drag the gutter between two columns to resize them in place; a live percentage readout follows the pointer and one undo restores the previous widths. Focus a gutter and use ←/→ for 1% steps (hold Shift for 5%), or double-click it to distribute the row evenly.
- Hover an individual column for its **⋯** menu: insert a column on either side, move the current column left/right, or delete it. Deleting a non-empty column asks for confirmation; deleting one side of a two-column row automatically unwraps the survivor.
- Pin a width with Callout metadata: `> > [!nf-col|30]` holds 30% of the row (valid values 10–90); unsized columns share the rest — or pick a preset from the block menu's **Column widths** submenu (equal, narrow left, narrow right). Pane-width responsive layout stacks the whole row below 560px, so three columns never fall into an awkward 2 + 1 wrap.
- **Unwrap columns** in the block menu flattens a row back into ordinary stacked blocks.
- An empty column shows a dashed **+** placeholder, so it stays visible and clickable; hovering a rendered row sketches each column's boundary.
- Click a rendered column to edit that column in place without exposing the row's structural `> >` prefixes. The active column becomes a clean editor while its siblings stay rendered for context; click another preview to switch, use the code button for raw source, or press `Esc` / the check button to finish. Undo and redo still belong to the main note. Inside a column, `Cmd/Ctrl+B`, `I`, `K`, `U`, and `\` act on that column only, and the typing shorthands and the `Backspace` rules work as they do in the note.
- Slash commands used **inside** a column (or any quote/Callout) keep the block's `>` markers, so an inserted code block, table, or Callout stays in its column.
- Columns are written as nested Callouts — `[!nf-cols]` wrapping `[!nf-col]` children — which render as ordinary nested quotes in any other Markdown app, so notes stay portable.
- Raw Source mode still exposes the portable `[!nf-cols]` / `[!nf-col]` syntax when you need it; its scaffolding rows read faint because they are structure, not prose.
- Column source is parsed as a real row/column model: fenced code that contains `[!nf-col]` is not mistaken for a new column, mixed tabs/spaces survive conversion, empty-column Enter/Backspace cannot remove structural markers, and code/table keyboard editing keeps the column prefix intact.

### Toggles

With **Toggles** enabled, any block can hide behind a triangle, Notion-style:

- Type `/toggle` (or `/折叠`) for a fresh toggle, or pick **Turn into** → **Toggle** from any block's handle menu — the block's first line becomes the title and the rest becomes the folded content.
- Click the triangle to fold or unfold. Unlike Obsidian's list folding, the open state is written back into the note (`+` open, `-` closed), so it survives a reload, sync, and every device.
- A toggle is prose behind a triangle, not a colored box: no tint, no border, no icon. Content holds anything — paragraphs, lists, code blocks, images, and further toggles.
- While the caret is inside, the `[!nf-toggle]±` scaffolding is replaced by the same triangle, so editing a toggle's body still looks like a toggle. Put the caret on the title row to edit the raw header.
- The block menu offers **Collapse** / **Expand** and **Collapse all in note** / **Expand all in note** for an existing toggle, and **Turn into** → **Quote** makes it a plain quote again.
- `Enter` on the empty last row of a new toggle leaves it, the way it leaves a quote.
- **Collapse all toggles**, **Expand all toggles**, and **Collapse or expand all toggles** set every toggle's and every foldable Callout's `+`/`-` in the note in one undoable edit. The last one is `Cmd+Option+T` on macOS; elsewhere it has no default, because `Ctrl+Alt` is AltGr on many keyboard layouts. The commands are offered only in notes that contain toggles or foldable Callouts.
- Written as a `[!nf-toggle]` Callout, which renders as an ordinary quote in any other Markdown app, so notes stay portable. For a folding box that keeps its Callout color, `/foldable callout` still writes `> [!note]-`.

### Comments

With **Comments** enabled, select text and annotate it, Notion-style:

- Add a comment from the floating toolbar's 💬 button, the **Add comment** command, or `Cmd/Ctrl+Shift+M`. Comments cover a single-line selection.
- The anchored text highlights in yellow with a small 💬 marker after it. Hover either one to read the comment on a small card with **Edit** and **Resolve** (with **Comment hover card** off, a plain tooltip shows the note instead); click the marker to open the editor, which quotes the anchored text and offers **Cancel**, **Save**, and **Resolve** (resolving removes the markup and keeps the text).
- In Reading view the anchor keeps its highlight and shows the comment on hover.
- **Show comments in this note** lists every comment in a searchable list — the anchored words and the comment. `Enter` jumps to the anchor and `Cmd/Ctrl+Enter` resolves the comment, keeping the list open. Run from Reading view, it switches to Live Preview first.
- Comments are stored inside the note as `<span class="nf-cmt" data-nf-cmt="…">text</span>` — in any other Markdown app the anchored text reads normally and the comment stays invisible. Clear formatting leaves comments in place; use Resolve on the comment marker to remove its markup.

### Tables

In Live Preview, the first click into a rendered cell shows a toolbar floating above the table with actions for rows, columns, column alignment, cell or table background, formatting, and deletion. Press `Alt+F10` to focus the toolbar, then use left and right arrows to move between its buttons. The toolbar's **…** button holds the rest: duplicate the row, move it up or down, move the column left or right, and sort the body rows by that column A→Z or Z→A (the header stays put and the caret follows its row).

In the editor's right-click menu, every table action sits under one **Table** submenu, while **Block menu…** stays at the top level.

The **Table editing enhancements** setting applies to raw `|` tables in Source mode or while a table is still unrendered:

- `Tab` / `Shift+Tab` move between editable cells.
- `Enter` moves to the same column in the next row.
- Navigation from the final cell appends a row.
- Typing a header such as `| Name | Quantity` and pressing `Tab` creates the delimiter and first body row.
- Pressing `Enter` on an empty final row removes it and leaves the table.

The same structural operations are available in the command palette — every table command is named **Table: …** (insert row above/below, insert column left/right, delete row/column, move row up/down, move column left/right, duplicate row, sort column ascending/descending) — and in the raw-table context menu. **Table: format** aligns columns using CJK-aware display widths.

With **Paste spreadsheet cells as a table** enabled, cells copied from Excel, Numbers, or Google Sheets — tab-separated text — pasted on an empty line become a Markdown table, and the caret lands below it; **Table: paste clipboard as table** in the command palette does the same on demand.

### Pages

Notion Flow gives a note a Notion-style page header and a per-note page style.

- **Page icon and cover.** Hover above a note's title for **Add icon** and **Add cover**. The icon is an emoji, picked from a grid of common emoji with your recent ones (**Remove icon** takes it away). **Add cover** puts a built-in gradient cover on the page at once; hover the cover for **Change cover** — the other gradients, which follow the palette, **Image from vault…**, and **Remove cover** — and, for an image, **Reposition**.
- The icon and cover are stored in the note's properties: `icon`, `cover` (an `[[image]]` link or a CSS color), `cover-style` (a gradient's id), and `cover-y` (an image's vertical position). Other tools that read `cover` still see an image. To keep these rows out of sight, set Obsidian's **Settings → Editor → Properties in document** to **Hidden**.
- The header is controlled by **Page icon and cover** (Appearance, on by default) and works in Live Preview and Reading view. It stays out of the way while the Banners, Pixel Banner, or Iconize plugin is enabled.
- **Page style.** The note's **More options** (⋯) menu has **Page style**: the font **Default**, **Serif**, **Mono**, or **Kai**, **Small text**, and **Full width**. The same choices are commands: **Page font: Default**, **Page font: Serif**, **Page font: Mono**, **Page font: Kai**, **Toggle small text**, and **Toggle full width**. They are written to the note's `cssclasses` property as `nf-serif`, `nf-mono`, `nf-kai`, `nf-small`, and `nf-wide`; any other classes there are kept.

### Canvas

Try the [Canvas example](examples/canvas-flow-demo.canvas) in your vault.

Enable **Canvas enhancements** under **Settings → Notion Flow** and open a `.canvas` file. The toolbar at the top is grouped by purpose: **New topic / Add child**, **Add sibling**, **Connect**; **Layout**, **Style**, **Markers**, **Note**, **Link**; fold, focus; find, present; **More** and the **?** guide. The buttons people reach for first carry their names (narrow panes show icons only). With nothing selected the first button is **New topic**, which starts a card in the middle of the view; with a card selected it becomes **Add child**, and **Focus** becomes **Show all** while a branch is focused. Canvas's floating menu above the selected card keeps only the most frequent actions (child, sibling, connect, fold, markers, note, link); the card's right-click menu and the command palette offer the same actions. The **?** at the toolbar's end opens the **Canvas guide**, which lists every key, gesture, and component.

**Mind maps.** Press `Tab` on a lone card — or click one of the **+** buttons around it — and it becomes the centre of a mind map with its first branch, growing the way you pulled it; **Layout** in the toolbar opens the layout panel (miniatures, like the style panel) and turns any card's tree into one of eight structures, and switching keeps the map's reading order:

- **Mind map** — branches on both sides of the centre.
- **Logic chart** (right or left) and **org chart** (down or up) — every branch grows one way.
- **Tree chart** — an indented outline hanging below the centre, like a file tree.
- **Timeline** — the centre starts a line, main branches are events along it, and each event's details are listed underneath. **Vertical timeline** runs the events down the page with details branching to the right.

The layout panel adds finer control: **This branch** gives the selected branch a structure of its own (logic chart, org chart, tree chart, timeline), which its subtree keeps inside any map — an outline or a timeline inside a mind map, as in XMind — stored in the branch card's `nfBranch` field; **Children** lines children up **centred** on their parent or **from the top**, stored in the centre card's `nfAlign` field; **Spacing** and **Free layout** live there too.
A map keeps itself tidy:

- **Grow from the keyboard or the mouse:** `Tab` adds a child, `Enter` the next card — a sibling below, or a main topic from the centre — and `Shift+Enter` a sibling above; the **+** at a topic's edge adds a child. New topics fit their text when you finish typing.
- **Typing flow:** while typing in a card, `Enter` finishes it and leaves it selected, so the next `Enter` adds the next card and `Tab` a child — type a word, `Enter`, `Enter`, type the next, and a whole tree goes down without touching the mouse, as in mind-map apps. `Shift+Enter` breaks the line; in a list, a quote, a table or code, `Enter` keeps writing there (end a list with `Enter` on its empty item, then `Enter` again finishes the card). `Tab` while typing finishes and starts a child at once, `Shift+Tab` takes a topic up a level and keeps typing in it, and `Esc` finishes from anywhere, as does `Cmd/Ctrl+Enter` (except on a link, which it opens). The toolbar stays usable while you type: a click on it finishes the topic first, then acts on it. A line break or blank lines left at the end are dropped. With a card selected, `Space` starts editing with the caret at the end and `F2` selects all the words so they can be replaced; a new card left empty vanishes when its editor closes and the card it grew from is selected again, so no blank cards are left behind. The editor's placeholder reads "Type a topic…". Input-method composition is never interrupted. **Canvas typing flow** can be turned off in the settings.
- **Comfortable editing:** a card is edited where it is, at the canvas zoom and in its own look — same size, color, type and alignment — so nothing jumps or zooms when editing starts. It grows only when its words need more room: a one-line topic widens with its line and then wraps, a card grows taller for more lines (away from its parent, toward open space), and it shrinks back as you delete. Closing the editor keeps that room: map topics are fitted to their text, and free cards keep the height they grew to, stopping short of the card below. Opening and closing an unchanged card preserves its size. Changed map text fits both dimensions with balanced wrapping and horizontal breathing room, a 480×640 limit and scrolling for long content; images, tables and code keep a wider reading area. Choose **Roomy / Compact / Preserve width** under **Card sizing** in settings.
- **Hierarchy typography:** the centre is larger and bolder, with size and weight stepping down through the branches. At the default 16px note size, topics use 24 / 20 / 17 / 16 / 15px, with deeper levels staying at 15px. Sizes follow your Obsidian note font setting and match while editing; rich notes use gentler size and weight. Moving a branch to a new level refits its cards to the new typography.
- **Color schemes:** the **Style** panel's **Color schemes** offers 23 designed schemes, each with a dark variant, in four groups — **Soft**: Soft mist, Sea salt, Sakura, Macaron, Morandi, Nordic, Rosé Pine; **Natural**: Forest, Sunset, Journal, Chinese classic, Dunhuang, Retro 70s; **Vibrant**: Vivid ideas, Aurora, Theme accent, Catppuccin pastel, Midnight neon, Candy pop; **Focus**: Quiet ink, Ink wash, Business, Clear contrast. Apply coordinated colors, card style, lines and spacing, or colors only. New branches inherit the scheme, manual colors take priority, and one undo restores the previous look. **No automatic colors** restores theme colors. **Save as my scheme** keeps the current map's colors and style under **My schemes** (remove one with **Delete scheme**); saved schemes live in the plugin settings. Every scheme is also a command, **Canvas: color scheme · …** followed by its name.
- **Maps follow the note palette:** with **Maps follow the note palette** on (the default), a map with no scheme of its own wears the scheme paired with your [note palette](#note-style), and the style panel pins a **Match note palette** tile first. This is display-only: nothing is written to the `.canvas` file, and a scheme you pick for a map always wins.
- **Empty canvas:** an empty canvas shows scheme tiles; clicking one starts a new map in that scheme.
- **Branch colors:** **Color this branch…** offers the map's own tones and your **Recent** picks above the stock **Canvas colors** (a written color does not follow later light/dark switches).
- **Fold branches:** the small circle on a card's branch line folds it (or `Mod+/`); a folded card shows how many cards it hides and looks like a small stack. Folding is saved in the file.
- **Drag like a mind map:** dragging a card carries its whole branch. Drop it past a sibling to reorder, or onto another card to move it there. Dragging a map's centre moves the whole map.
- **Delete safely:** deleting a card keeps its children — they move up to the nearest remaining card — and the card now in its place is selected, so the keyboard carries on.
- **Smooth motion:** cards glide to their new places when the map re-arranges, folds, or unfolds; unfolded cards grow out of the card that held them.
- **Every adjustment is one undo step** with the change that caused it, and undo is never re-arranged.
- **Styles:** each map picks its look from the toolbar's **Style** menu, or follows the default in the settings. **Clean** gives it a tinted centre, main branches as soft pills, and subtopics as plain words on tapering branch lines; **Cards** keeps every topic a card; **Vivid** fills the centre and main branches with solid color, giving each uncolored main branch the next palette color without writing it to the file; **Minimal** keeps only words and lines; **Pastel** uses soft color blocks without outlines; **Gradient** gives topics glowing gradient fills. **Color branches** writes one color per main branch, **Clear branch colors** removes them, and **Layout** also sets the map's spacing: compact, standard, or roomy.
- **Branch lines:** the **Style** menu also picks how a map draws its branches — **tapered** (thick where a branch leaves the centre, fine at its tips, as if drawn by hand), **curved** (Canvas's own), **elbow** (right angles with rounded bends; siblings share a trunk), or **straight**. **Automatic** tapers mind maps and logic charts and uses elbows for org charts, tree charts, and timelines. The line from the selected card back to the centre glows softly.
- **Boundaries:** **Style → Boundary** frames a branch in a soft, tinted outline, as in XMind. The map makes room for it and it follows the branch as it grows, folds, glides, or is dragged; boundaries can nest.
- **Show levels:** **More → Show 1/2/3 levels** folds a map down to its main branches (or the next levels) in one step; **Unfold all branches** opens everything again.

**Beyond mind maps.**

- **Connections:** select a card, click **Connect** in the toolbar (it is in the floating menu and the right-click menu too), then click the card to join it to; a dashed preview follows the pointer, and `Esc` or a click on empty canvas cancels. Select two or more cards (Shift+click) and **Connect** joins them in that order. Or, as in Canvas itself, hover a card's edge and drag the dot that appears onto another card. The new line is selected; double-click it to give it a label.
- **Relations:** a line between map cards (or between a map card and a free card) is a relation: drawn dashed, recorded in the line's `nfRelation` field, and never pulling a card into the map or changing its branches; a *labeled* connection is a relation too. A map can therefore point at notes, images, or cards anywhere on the canvas without being restructured. Free cards get ordinary arrows.
- **Markers:** the toolbar's **Markers** opens a picker with priorities 1–5 (one per card), status icons (done, in progress, blocked, attention, question, idea), six flags, a set of symbols, and an **Emoji** section (type any emoji; recent ones are kept, up to three per card). Select several cards to mark them together; the picker stays open so several markers can be set, and **Clear** removes them. Markers sit at a card's top-left corner, keep their size at any zoom, and are saved in the card's `nfMarkers` field.
- **Notes:** give any card a note that stays out of sight until you want it, as in XMind. Select a card and click **Note** (toolbar, floating menu or right-click menu), or press `F4`, and type — Markdown works, and the words are saved as you type; `Esc` or `Mod+Enter` closes the note, and the whole note is one undo step. A card with a note shows a small note icon at its lower right corner: click it to read the note beside the card, drawn as Obsidian draws a note — headings, lists, tasks, Callouts, tables, code, math, and links you can click (`Mod` shows a page preview); ticking a task ticks it in the note. Double-click the words or click the pencil to edit; the bin deletes the note. A card can carry several notes: `Shift+F4`, **Add another note** in the card menu, or the **+** at the top of the panel starts one more; the panel shows them one under the other, each with its own pencil and bin, and the icon shows how many there are. The notes follow their card as you pan and zoom and close when you click elsewhere or press `Esc`. Find (`Mod+F`) searches notes too, read-only canvases show them, and **Copy branch as outline** / **Export branch as note** keep them as quotes under their topics. Saved in the card's `nfNote` field (a string for one note, a list for several).
- **Links:** link a card to a web page, a note (or a heading in it), or another card on the same canvas. Select a card and click **Link** or press `Mod+K`: paste a URL, or type to search the vault's notes (`Note#` lists its headings) and the canvas's cards; `Enter` takes the first line. A card can have as many links as it needs: `Mod+K` adds one more, listing the card's links first — choose one to change or remove it. Each link shows its own icon at the card's lower right corner — a globe for a web page, a page for a note, a target for a card (past three, the last icon lists them all): click it to open the page in your browser, open the note (`Mod+click` for a new tab; hold `Mod` over the icon for a page preview), or jump to the card, unfolding its branch on the way. Right-click an icon to open, copy, edit or remove that link; outlines wrap the topic in its first link. Saved in the card's `nfLink` field (`https://…`, `[[Note#Heading]]`, or `#` and the card's id; a list for several).
- **Links to cards in a card's words:** while typing in a card, type `[[^` and a few words of another card's name — or press `Mod+Shift+K`, or right-click and choose **Link to a card…** — to write `[[#^id|Name]]` (selected words become the link's text). Click the link on the selected card, or press `Mod+Enter` on it while typing, to go to that card; the pointer on it rings the card it leads to. **Copy link to card** in the card menu copies one to paste into any card on the canvas. Outlines and exported notes keep just the name.
- **Numbering:** **More → Numbering** (also in the style panel's **Branches** section) shows topic numbers such as 1, 1.1, 1.2 in reading order, updated as the map changes; display-only, with the switch stored in the centre card's `nfNumbering` field.
- **Summaries (braces):** select one or more adjacent sibling branches and click **Summary** in the toolbar (also in the floating menu, the right-click menu, the style panel, and the command palette). A brace is drawn past those branches, its tip pointing at a new summary card, ready to type into. The brace spans the whole extent of the covered branches, children included; the summary card is centred on it and, when taller than the branches, makes room for itself. Folding the parent hides the brace and the summary, dragging the branch carries them, and deleting a covered branch shrinks the run. Select the summary card and click **Summary** again to remove it. A summary is recorded in the card's `nfSummary` field (the parent and the first and last branch it covers) and has no connection, so it never becomes a branch.
- **Card shape, text size, and line weight:** the **Style** panel gains **Card shape** (rounded, pill, square, underline), **Text size** (small, normal, large) and **Line weight** (thin, normal, bold), previewed on hover and stored per map; the settings hold the defaults. Some color schemes bring a shape of their own (Sakura and Macaron are pills, Quiet ink underlines, Business is square).
- **Canvas background:** the **Canvas background** setting switches between Obsidian's dots, fainter dots, and a plain background.
- **Notes in and out:** **Insert note as mind map** grows a map from a note's headings and lists, with the centre linking back to the note; **Export branch as note** writes a branch to a new note beside the canvas. Paste a Markdown list onto a map card to grow branches from it; **Turn list into branches** does the same for a card's own list; **Copy branch as outline** puts a branch on the clipboard as a nested list (file cards become links, tasks stay tasks).
- **Find any card:** `Mod+F` opens a find bar on the canvas: matching cards light up and the rest dim, the count reads *n of N (k folded)*, `Enter` / `Shift+Enter` step through the matches (folded ancestors unfold on the way), and `Esc` clears. **More → Find card** (`Mod+Shift+F`) is the searchable list, which also finds cards hidden in folded branches.
- **Minimap:** when part of the canvas is off screen, an overview appears in the corner; click or drag it to move around. Toggle it from the toolbar.
- **Free canvas alongside:** cards outside maps behave as before. A selected free card shows **+** on every side to add a card joined by an arrow, for flowcharts. **Layout → Free layout** returns a map to manual placement. Cards inside a group the map is not in stay in their group.
- **Focus a branch** to dim everything else; `Esc` or **Show all** leaves focus. Focus is a view state and is never saved.
- **Task progress:** a card whose branch holds tasks (`- [ ]`) shows a small ring with how many are done, counting folded cards and the tasks in notes that file cards show; a card with its own checklist shows its count too. Ticking a box updates the counts.
- **Present:** the toolbar's **Present** button (or the command) walks through a map branch by branch — the whole map, each main branch in reading order with the centre still lit, then the whole map again. With no map card selected it presents the whole canvas: groups, maps, and loose cards in reading order — unless the canvas holds a single map, which it presents branch by branch. `→`/`Space`/`PageDown` go forward, `←`/`Shift+Space`/`PageUp` back, `Home`/`End` to either end, `F` toggles full screen, and `Esc` leaves, returning the view to where it was. Clicking a card shows its stop. Presenting writes nothing, so read-only canvases can be presented too.

Maps are ordinary JSON Canvas: the structure lives in an `nfLayout` field on the centre card (with a non-standard spacing in `nfSpacing`, a chosen style in `nfTheme`, chosen branch lines in `nfLine`, and an automatic palette in `nfPalette`), folding in `nfCollapsed` on the folded card, a boundary in `nfBoundary` on the card it frames, markers in `nfMarkers` on the card, notes in `nfNote` and links in `nfLink` on the card, numbering in `nfNumbering` on the centre card, relations in `nfRelation` on the line, summaries in `nfSummary` on the summary card, and card shape, text size and line weight in `nfShape`, `nfTextScale` and `nfLineWeight` on the centre card. Canvas preserves these fields, and other apps ignore them; they draw every connection as an ordinary curve.

With **Canvas keyboard shortcuts** enabled, these keys work when one card is selected and you are not editing:

| Key | In a mind map | Elsewhere |
| --- | --- | --- |
| `Tab` / `Shift+Tab` | Add a child / select the parent | Same (a lone card starts a map) |
| `Enter` | Add a sibling below (a main topic from the centre) | Add a sibling beside a connected card, or a new card below a card of its own |
| `Shift+Enter` | Add a sibling above | — |
| `Alt/Option+Enter` | Add a sibling | Same as `Enter` |
| `F2` | Edit the card, all words selected | Edit the card |
| `Space` | Edit the card, caret at the end | Edit the card |
| `F4` | Open the card's note to write in it (with several, show them) | Same |
| `Shift+F4` | Add another note to the card | Same |
| `Mod+K` | Add a link to a web page, a note or another card | Same |
| `←` `→` / `↑` `↓` | Parent and child / the next card at the same level (tree charts: row by row; timelines: `←` `→` along the events, `↓` into the details) | Canvas's own nudge |
| `Alt/Option+`arrows | Move to the nearest card | Move to the nearest card |
| `Alt/Option+Shift+`arrows | Reorder among siblings | — |
| `Mod+/` | Fold or unfold | — |
| `Mod+[` / `Mod+]` | Outdent the card to its parent's level / indent it under the sibling before it; its branch goes along | — |
| `Shift+Delete` | Remove the whole branch (`Delete` keeps the children) | — |
| `Mod+F` | Find in map: a bar with the match count, next/previous, and dimmed non-matches (`Mod+Shift+F` opens the card search list) | Find a card |
| `Esc` | Leave branch focus | Leave branch focus |

Typing inside a text field or editor keeps its normal keyboard behavior; inside a card, `Esc` finishes editing. With **Canvas typing flow** on, `Enter` in a card finishes it (in a list, quote, table or code it keeps writing), `Shift+Enter` breaks the line, `Tab` finishes and adds a child, `Shift+Tab` takes a topic up a level and keeps typing in it, `Esc` finishes from anywhere, and a new card left empty is removed. **Keep mind maps tidy** and **Fit mind-map cards to their text** can be turned off separately; explicit actions such as `Tab`, folding, and pasting still arrange the map. **Canvas appearance** and **Mind-map style** control the card finish and mind-map styling; Canvas card colors remain intact.

### Note style

One **palette** and one **look** restyle everything Notion Flow draws in your notes. The palette sets the colors — text inks, highlights, Callouts, tables, list and quote accents, inline code, and code blocks; the look sets the shapes — how Callouts, headings, highlights, tables, quotes, bullets, to-dos, dividers, toggles, columns, and inline code are drawn. Combine any palette with any look. It is display-only: your Markdown never changes. Notes you have already colored re-skin too, because colors are stored as `var(--nf-red, #hex)` and `rgba(var(--nf-red-rgb, …), .18)`; with the plugin off, or in other apps, they fall back to the Classic colors. **Classic** + **Classic** is exactly the appearance before 1.6, and upgrading keeps your appearance: settings you had changed from their old defaults become your own per-component choices.

Everything is under **Settings → Notion Flow → Note style**: a **Palette** gallery and a **Note look** gallery, each card a live preview. With a palette other than Classic you can also set a **Paper background** — **Theme background**, **Note page** (the note area only), or **Whole app** (sidebars and dialogs too; designed for the default theme, so a community theme may only partly follow) — **Tinted headings** (headings 1–3 in a deep ink of the palette's key color), and **Links use the palette**. When the palette suggests a look, the gallery offers "Try the … look with this palette". Try every combination on one page with the [style sampler](examples/notion-flow-style-demo.md).

| Palette | 中文 | Character | Suggested look | Paired map scheme |
| --- | --- | --- | --- | --- |
| Classic | 经典 | Today's look: muted inks that follow your theme. | Classic | — |
| Notion | Notion 原味 | Warm near-black ink, clear hues and barely-there washes. | Soft cards | Soft mist |
| Nord | 北境 | Arctic frost and aurora: cool, calm, low-chroma. | Outline | Nordic |
| Morandi | 莫兰迪 | Grey-veiled, dusty tones; hues stay close together. | Minimal | Morandi |
| Paper & Ink | 纸墨 | Sepia ink on cream paper with highlighter washes, made for long-form writing. | Editorial | Journal |
| Rosé Pine | 玫瑰松 | Dawn and Moon: dusty rose, gold and pine. | Soft cards | Rosé Pine |
| Catppuccin | 猫咖 | Latte and Mocha: soothing pastels with a playful pop. | Gradient | Catppuccin pastel |
| Everforest | 常青森林 | Warm parchment and forest greens, easy on the eyes. | Soft cards | Forest |
| Chinese Classic | 国色 | Blue-and-white porcelain with a cinnabar seal on ivory paper. | Editorial | Chinese classic |

Every palette except Classic is tuned for contrast in light and dark mode: body text reaches at least 7:1, and every ink and Callout title at least 4.5:1. Morandi's hues are deliberately close together; for color-coded work, choose Notion or Nord.

| Look | 中文 | What it does |
| --- | --- | --- |
| Classic | 经典 | Today's look. |
| Editorial | 杂志 | Rail callouts, three-line tables, marker pen and ✦ breaks. |
| Soft cards | 柔和卡片 | Borderless cards, icon badges, tinted quotes. |
| Outline | 线框 | Outlined callouts, ruled headings, diamond bullets. |
| Minimal | 极简 | Boxless callouts, monochrome decoration. |
| Gradient | 渐变 | Gradient title strips and fading underlines. |

<details>
<summary>What each look sets</summary>

| Component | Classic | Editorial | Soft cards | Outline | Minimal | Gradient |
| --- | --- | --- | --- | --- | --- | --- |
| Callout style | Header strip | Side rail | Soft card | Outlined | Icon only | Gradient title |
| Heading accents | Unadorned | Editorial | Unadorned | Hairline rule | Unadorned | Fading underline |
| Highlight style | Flat fill | Marker pen | Flat fill | Underline band | Underline band | Marker pen |
| Table look | Rounded grid | Three-line table | Card | Rounded grid | Three-line table | Card |
| Quote style | Side bar | Pull quote | Tinted | Side bar | Side bar | Tinted |
| Bullet style | Dot | Dash | Dot | Diamond | Dash | Diamond |
| To-do checkbox | Rounded square | Ink square | Soft tick | Circle | Circle | Rounded square |
| Divider style | Fading hairline | Ornament ✦ | Three dots | Solid hairline | Three dots | Ornament ✦ |
| Toggle arrow | Chevron | Filled triangle | Filled triangle | Guide line | Guide line | Filled triangle |
| Column divider | No divider | Hairline divider | No divider | Hairline divider | No divider | Hairline divider |
| Inline code look | Soft pill | Text only | Tinted pill | Outlined pill | Text only | Tinted pill |
| Decoration color | Palette color | Palette color | Palette color | Palette color | Neutral gray | Palette color |

</details>

**Customize components.** Under the galleries, **Customize components** holds one row per component: **Callout style**, **Heading accents**, **Highlight style**, **Table look**, **Quote style**, **Bullet style**, **To-do checkbox**, **Divider style**, **Toggle arrow**, **Column divider**, **Inline code look**, and **Decoration color**. Each starts at **Follow look (…)**, which names what the current look uses; an explicit choice always wins over the look. While some components keep your own setting under a palette or look other than Classic, a note above the rows names them and offers **Follow the style for all**. The color settings under **Appearance** — **List marker color**, **Quote bar color**, **Inline code color**, **Table header background**, and **Code block theme** — gain **Follow palette** as their first option and default. **Code block theme** is a gallery of code cards; themes made for dark mode carry a **Dark only** badge.

**Change note style…** is a quick switcher in the command palette. Palettes and looks are listed in two groups and typing filters them. `↑` / `↓` preview each one live on the open notes, `Tab` switches between the groups, `Enter` applies the one you are on (a notice confirms it, as in "Note style: Nord · Outline"), and `Esc` restores what you had. It has no default hotkey; bind one under **Settings → Hotkeys**.

**Canvas.** With **Maps follow the note palette** on (Settings → Notion Flow → Canvas), a mind map with no color scheme of its own wears the scheme paired with the note palette (the last column above), and the style panel pins a **Match note palette** tile. It is display-only, and a map's own scheme always wins.

### Appearance

- **Cleaner WYSIWYG rendering** is display-only: it refines headings, tasks, dividers, inline code, quotes, and Mermaid diagrams without rewriting Markdown. Bullet and number styles by list depth are unaffected. Quote markers are concealed on inactive Live Preview lines and return on the active line.
- Both Live Preview and Reading view cycle styles across the full mixed-list depth: filled, hollow, and square bullets; decimal, lower-alpha, and lower-Roman numbers. The active Live Preview line still shows its editable Markdown number.
- Code fences, Callouts, and quotes dragged to any valid list depth use the real content level and stay aligned in source and rendered states.
- Colors follow the [note palette](#note-style) unless you pick one: the Appearance group opens with a live preview, and its color rows start at **Follow palette**.
- Headings, list items, to-dos, and quotes that are still empty show a faint placeholder ("Heading 1", "List", "To-do", "Quote"), like the empty-line hint, and typing `## ` no longer shifts the line.
- Wide Markdown tables become horizontally scrollable in Reading view.
- **Conceal inline Markdown syntax** (on by default) hides formatting markers until the caret enters their source. Markdown links remain visible and Source mode is unchanged.
- **Conceal heading markers while writing** extends that to a heading's `#` run on the line you are writing, not only after you leave it — so typing `## ` makes the line a heading the way Notion does, instead of leaving the markers sitting in front of the text. A marker with no heading text after it stays visible, since a lone `#` is a heading still being typed. Move the caret in front of the text to bring the marker back, or press `Backspace` there to remove the whole marker at once and return the line to a paragraph. The Markdown keeps the `#` either way.

## Commands and shortcuts

| Action | Default shortcut |
| --- | --- |
| Turn into text | `Cmd+Option+0` / `Ctrl+Shift+0` |
| Turn into Heading 1 / 2 / 3 | …`+1` / `+2` / `+3` |
| Turn into to-do | …`+4` |
| Turn into bulleted list | …`+5` |
| Turn into numbered list | …`+6` |
| Turn into quote | …`+9` |
| Turn into toggle | …`+7` |
| Turn into code block | …`+8` |
| Turn into Callout | …`+C` |
| Insert block below | `Cmd+Option+=` on macOS; — elsewhere |
| Insert block above | `Cmd+Option+Shift+=` on macOS; — elsewhere |
| Move block up | `Alt/Option+↑` |
| Move block down | `Alt/Option+↓` |
| Duplicate block | `Alt/Option+Shift+D` |
| Toggle underline | `Cmd/Ctrl+U` |
| Text color…, Highlight color… | — |
| Add comment | `Cmd/Ctrl+Shift+M` |
| Clear formatting | `Cmd/Ctrl+\` |
| Apply last used highlight | `Cmd/Ctrl+Shift+H` |
| Apply last used text color | — |
| Insert or edit link | `Cmd/Ctrl+K` in the editor opens the link card (Obsidian's Insert link chord); the command itself has no default key |
| Collapse or expand all toggles | `Cmd+Option+T` on macOS; — elsewhere |
| Collapse all toggles, Expand all toggles | — |
| Show comments in this note | — |
| Refresh table of contents | — |
| Change note style… | — |
| Page font: Default / Serif / Mono / Kai, Toggle small text, Toggle full width | — |
| Open block menu | `Cmd+Option+/` / `Ctrl+Shift+/` |
| Exit code block | `Cmd/Ctrl+Shift+Enter` |
| Open shortcut guide | — |
| Table: format, Repair nested Callout, Table: paste clipboard as table | — |
| Table: insert row above / below, insert column left / right, delete row / column | — |
| Table: move row up / down, move column left / right, duplicate row, sort column ascending / descending | — |
| Focus an open formatting/table toolbar | `Alt+F10` |

The turn-into chords convert the block holding the caret without leaving the keyboard — the same conversions the block handle menu offers, in Notion's own digit order, with Notion's own modifier per platform (`Ctrl+Shift` off macOS, because `Ctrl+Alt` is AltGr on European layouts and would claim the key that types `@`). The caret keeps its place in the text, so a conversion mid-sentence does not interrupt typing. A fenced code block, a table, and column scaffolding have no line prefix that could describe them, so the chords leave those blocks untouched. From a Callout's body row the chord retypes that row; from its header row it converts the whole Callout, matching what the handle would have selected.

The three wrap chords work the other way round: instead of retyping a line's prefix they put a container around the whole block — a Callout keeps the text as its content and leaves the caret on the empty title, a toggle keeps the first line as its title, and a code block fences the text with the caret where the language goes. They continue Notion's digit order (`7` toggle, `8` code) and give the Callout, which Notion has no block for, the letter of its own name. A block already of that kind is left alone: an existing Callout has the type menu, and a block containing a fence is never re-fenced.

**Insert block above** exists for the one place Live Preview leaves no room to type: a note that opens with a rendered Callout, table, or code block. Both insert commands open an empty block at the right indentation — inside a Callout it carries the container's markers — and then open the `/` menu, exactly like the `+` button in the left margin.

Changed in 1.6: the insert-block commands used `Cmd/Ctrl+Alt/Option+Enter`, which is Obsidian's own *Open link in new split* / *Open link in new window*, so on a link the chord opened a pane and elsewhere it did nothing. They now use `=` (think "add"): `Cmd+Option+=` and `Cmd+Option+Shift+=` on macOS. On Windows and Linux they have no default, because `Ctrl+Alt` is AltGr on many keyboard layouts and would swallow a character you type; bind them under **Settings → Hotkeys** if you want one. With blocks selected, `Cmd/Ctrl+Alt/Option+=` inserts on every platform, since nothing is typed there.

Block shortcuts can be changed under **Settings → Hotkeys**. **Settings → Notion Flow → Keyboard shortcuts** lists the chords and opens Hotkeys already filtered to Notion Flow, and **Open shortcut guide** shows every chord, block-mode key, and Markdown shorthand in one dialog.

**With blocks selected** — after `Esc`, a marquee, or an Alt-drag — the keys act on the whole selection:

| Key | With blocks selected |
| --- | --- |
| `↑` / `↓`, `Shift+↑` / `Shift+↓` | Walk to the block above or below / extend the selection |
| `Enter` / `Esc` | Return to writing at the end of the selection / clear it |
| `Alt/Option+↑` / `Alt/Option+↓` | Move the selected blocks up or down |
| `Tab` / `Shift+Tab` | Indent or outdent every selected block one level |
| `Cmd+Option+0…9` / `Ctrl+Shift+0…9`, `…+7`, `…+8`, `…+C` | Convert every selected block (text, headings, lists, to-do, quote), or wrap the selection in a toggle, a code block, or a Callout |
| `Cmd/Ctrl+Enter` | Add or remove the to-do box on every selected block |
| `Cmd/Ctrl+B` / `I` / `U` | Bold, italic, or underline every selected block |
| `Cmd/Ctrl+C` / `X` / `V` | Copy, cut, or replace the selection with the clipboard |
| `Cmd/Ctrl+D` / `Cmd/Ctrl+A` | Duplicate the selection and select the copy / select every block |
| `Cmd/Ctrl+Alt/Option+=`, `+Shift` | Insert a block below the selection / above it |
| `Backspace` / `Delete` | Delete the selected blocks |
| `Shift+click` | Extend the selection to the clicked line |
| Drag a selected block's handle | Move the whole selection; a landing flash marks where it went |

**Canvas commands.** Every mind-map action is also a command named **Canvas: …** — new topic, add child or sibling, connect cards, fold, focus, arrange as a mind map / logic chart / org chart / tree chart / timeline, color schemes (**Canvas: color scheme · …**) and map styles, **Canvas: color this branch…**, **Canvas: auto-color all branches**, markers, numbering, card notes and links, summary, boundary, **Canvas: find text in map**, **Canvas: jump to card…**, present, insert note as mind map, export branch as note, and more. None has a default hotkey; the Canvas key table above lists the keys that work while a card is selected.

## Settings and defaults

The settings tab is grouped into **Writing**, **Blocks**, **Structures**, **Keyboard shortcuts**, **Canvas**, **Default look** (the canvas's default map look), **Tables**, **Note style**, **Appearance**, **Help & examples**, and **About**. Long descriptions show their first sentence with the rest behind **Details**, in English and Chinese. A row that depends on another setting dims while that setting is off and says what it needs (**Empty-line hint** shows "Needs Slash commands"); the Canvas and Default look rows are hidden until **Canvas enhancements** is on, and **Paper background**, **Tinted headings**, and **Links use the palette** dim while the palette is Classic.

| Setting | Default | Controls |
| --- | --- | --- |
| Slash commands | On | `/` suggestion menu |
| Date format | `YYYY-MM-DD` | What `/date`, `/tomorrow`, and `/yesterday` write (moment.js tokens), with a live preview |
| Time format | `HH:mm` | What `/time` writes (moment.js tokens), with a live preview |
| Empty-line hint | On | A faint "Type / for commands" on the empty line holding the caret |
| Floating format toolbar | On | Text formatting, the link card, and the in-place table toolbar |
| Shorthand while typing | On | `>!` + space writes a Callout (`>!tip`, `>!warning`, trailing `+`/`-`), `[]` + space a to-do; the full-width `>！`, `》！`, `》`, and `【】` work too |
| Backspace removes list markers | On | `Backspace` at the start of a list item, to-do, or heading removes its marker in one step; a second press joins the line above |
| Paste URLs as links | On | URL-over-selection conversion |
| Paste URLs with page titles | On | Background title fetch turns a pasted bare URL into `[title](url)` |
| Paste spreadsheet cells as a table | On | Tab-separated text pasted on an empty line becomes a Markdown table |
| Drag-and-drop blocks | On | Handle, `+`, drag-and-drop, and block menu |
| Select blocks with Escape | On | `Escape` selects the block at the caret; `↑`/`↓` walk it, `Shift+↑`/`↓` extend, `Enter` resumes writing |
| Block indentation with Tab | On | `Tab` / `Shift+Tab` step a non-list block through the drag system's nesting levels |
| Callout and quote enhancements | On | Smart `Enter`/`Backspace` in quotes, quoted multi-line pastes, and the Callout icon menu |
| Code block enhancements | On | Indent-keeping `Enter`, indent-level `Backspace`, fence auto-close, and downward block exit |
| Columns | On | Notion-style side-by-side layout via nested `[!nf-cols]`/`[!nf-col]` Callouts |
| Toggles | On | Notion-style foldable blocks via `[!nf-toggle]` Callouts; the +/- marker saves the open state |
| Comments | On | Selection-anchored notes with yellow anchors, 💬 markers, hover cards, and the comments list |
| Comment hover card | On | A card with **Edit** and **Resolve** when hovering commented text; off, a plain tooltip |
| Canvas enhancements | On | Canvas toolbar, **+** card buttons, menu items, and commands for mind maps, layouts, connections, markers, card notes and links, numbering, folding, outlines, notes, search, branch focus, and the guide |
| Canvas keyboard shortcuts | On | Mind-map keys when one Canvas card is selected and not being edited |
| Canvas typing flow | On | While typing in a card, `Enter` finishes it (lists, quotes, tables and code keep `Enter`), `Shift+Enter` breaks the line, `Tab` finishes and adds a child; empty new cards are removed |
| Keep mind maps tidy | On | Re-arrange maps after edits, drags, deletions, and folding; drag branches together; drop to re-parent |
| Fit mind-map cards to their text | On | Fit both dimensions after text changes; preserve unchanged cards |
| Comfortable card editing | On | Edit cards in place at the canvas zoom; a card grows only for words that need room and keeps it when you finish |
| Card sizing | Roomy | Roomy, Compact, or Preserve width (fit height only) |
| Smooth mind-map motion | On | Cards glide into place; follows the system's reduced-motion setting |
| Canvas minimap | On | Overview in the corner whenever part of the canvas is off screen |
| Task progress on cards | On | Done/total rings on cards whose branch (or checklist) holds tasks |
| Canvas appearance | On | Rounded cards, soft shadows, clearer selection, and mind-map styling |
| Mind-map style | Clean | Default look for maps without their own: Clean, Cards, Vivid, Minimal, Pastel, or Gradient |
| Maps follow the note palette | On | Maps without a color scheme of their own wear the scheme paired with the note palette; nothing is written to the canvas |
| Mind-map branch lines | Automatic | Default branch lines for maps without their own: Automatic, Tapered, Curved, Elbow, or Straight |
| Mind-map typeface | Note font | Typeface for maps without their own: note font, sans, serif, or Kai (LXGW WenKai or the system Kaiti when installed) |
| Mind-map card shape | Rounded | Card outline for maps without their own: rounded, pill, square, or underline |
| Mind-map line weight | Normal | Branch line weight for maps without their own: thin, normal, or bold |
| Mind-map text size | Normal | Topic size for maps without their own: small, normal, or large |
| Canvas background | Dots | The pattern behind the canvas: dots, faint dots, or plain |
| Table editing enhancements | On | Raw-table keyboard navigation and editor context menu |
| Notion-style tables | On | Rounded table appearance, focus, hover, and spacing |
| Table header background | Follow palette | Header tint that follows the palette, theme default, none, or one of nine palette colors |
| Striped table rows | Off | Alternating body-row tint |
| Palette | Classic | Nine palettes that recolor text colors, highlights, Callouts, tables, list and quote accents, inline code, and code blocks |
| Paper background | Theme background | The palette's paper tone: Theme background, Note page, or Whole app |
| Tinted headings | Off | Headings 1–3 take a deep ink of the palette's key color |
| Links use the palette | Off | Links take the palette's blue ink instead of the accent color |
| Note look | Classic | Six looks that reshape Callouts, headings, highlights, tables, quotes, and other blocks |
| Customize components (12 rows) | Follow look | Callout style, Heading accents, Highlight style, Table look, Quote style, Bullet style, To-do checkbox, Divider style, Toggle arrow, Column divider, Inline code look, Decoration color |
| Cleaner WYSIWYG rendering | On | Display-only Live Preview and Reading-view refinements; never changes Markdown |
| Conceal HTML formatting tags | On | Hides plugin-generated formatting tags in Live Preview and renders them inside Reading-view code blocks |
| Conceal inline Markdown syntax | On | Hides supported inline Markdown markers in Live Preview |
| Conceal heading markers while writing | On | Hides a heading's `#` run on the active line too, so `## ` reads as a heading as you type |
| Page icon and cover | On | A Notion-style emoji icon and cover above the note's title, from its properties |
| List marker color | Follow palette | Follow palette, accent color, theme default, or one of nine palette colors |
| Quote bar color | Follow palette | Follow palette, text color, accent color, theme default, or one of nine palette colors |
| Inline code color | Follow palette | Follow palette, theme default, or one of nine palette colors, for `inline code` text |
| Code block theme | Follow palette | A gallery: Follow palette or one of eleven themes, among them Theme default and Obsidian adaptive; dark-only themes are marked |

The settings page also includes **Restore defaults**, the **shortcut guide** (**Open shortcut guide**), **Customize in Hotkeys**, **What's new**, **Create tour notes in my vault**, and **Release notes on GitHub**.

## What is written to Markdown

Most actions produce standard Markdown. Underline, text colors, and colored highlights use inline HTML, as does all formatting inside fenced code blocks (`<b>`, `<i>`, `<s>`, `<u>`, color spans). Colors are written as `var(--nf-NAME, #hex)` (and highlights as `rgba(var(--nf-NAME-rgb, …), .18)`), so they follow the note palette and the light/dark ink here and fall back to the plain Classic color anywhere the plugin's stylesheet is missing. Table, cell, and formula colors use small class markers rendered by Notion Flow's stylesheet. These markers remain in the note so colors survive sync and copy/paste, but their appearance outside Obsidian or without the plugin is not guaranteed.

The other stored forms:

- **Captions:** code and image captions use a readable `<small class="nf-caption">…</small>` row immediately after the block; the code row also carries its saved collapse state. Without Notion Flow the caption remains ordinary small HTML text and the collapse metadata is harmless.
- **Images:** a size is Obsidian's own `![[image.png|480]]` width, and an alignment is a `left`, `center`, or `right` word in the embed (`![[image.png|center|480]]`).
- **Callouts:** a Callout color is an `nf-<color>` token in the header's metadata (`> [!tip|nf-green]`), and a Callout icon an `nfi-<name>` token (`> [!tip|nfi-rocket]`), or `nfi-emoji` with the emoji at the start of the title; other apps ignore both.
- **Columns** are nested Callouts (`[!nf-cols]` / `[!nf-col]`), which degrade to ordinary nested quotes elsewhere; **toggles** are `[!nf-toggle]` Callouts with a `+`/`-` fold marker.
- **Comments** are spans with a data attribute — elsewhere the anchored text reads normally and the note stays invisible.
- **Block color:** a text color wraps each line of the block in a color span; a background is one empty marker, `<span class="nf-blk-blue"></span>`, at the end of the block's first line (before any `^block-id`).
- **Pages:** the page icon and cover are the `icon`, `cover`, `cover-style`, and `cover-y` properties, and the page style is `nf-serif`, `nf-mono`, `nf-kai`, `nf-small`, or `nf-wide` in the `cssclasses` property.
- **Table of contents:** `/toc` writes a `<!-- nf-toc -->` marker followed by a plain nested list of `[[#…]]` links. A `|` in a heading is shown as `｜` in the link text (Live Preview hides every `|` inside a wikilink), and a trailing block id (` ^id`) is not shown.

Palettes and looks write nothing to your notes — they are settings only. **Maps follow the note palette** writes nothing to `.canvas` files, and **Save as my scheme** is stored in the plugin settings.

Notion Flow does not upload note content. With **Paste URLs with page titles** enabled, pasting a link sends a single request to that URL to read its title; disable the setting to stay fully offline. Opening documentation or examples uses your browser, and **Copy text** uses the system clipboard.

## Troubleshooting and limitations

- **No block handle:** use desktop Live Preview and make sure **Drag-and-drop blocks** is enabled.
- **No table toolbar:** enable **Floating format toolbar**. **Table editing enhancements** controls raw-table keys and the context menu, not this toolbar.
- **No Canvas toolbar or branch shortcuts:** enable **Canvas enhancements** and select one card in a Canvas view; keyboard actions also need **Canvas keyboard shortcuts** and do not run while editing. Canvas uses Obsidian's internal API, so compatibility may need adjustment after an Obsidian update.
- **A card joined a mind map unexpectedly:** an unlabeled connection from a map card makes its target a branch. Give the connection a label to make it a relationship line instead, or connect from the other card.
- **`Tab` or `Enter` does not use Notion Flow navigation:** the enhanced key behavior applies only to raw Markdown tables, not Obsidian's rendered cell editor.
- **Toolbar cannot format a selection inside a rendered widget:** Obsidian may expose a DOM-only selection inside a rendered Callout or colored word. Open the widget's source or extend the selection into normal editor text.
- **An older nested Callout appears as code:** put the caret on its Callout source and run **Notion Flow: Repair nested Callout**. The change is undoable.
- **The insert-block chord does nothing or opens a split:** the chords changed in 1.6 — they are `Cmd+Option+=` / `Cmd+Option+Shift+=` on macOS and unbound elsewhere. Check **Settings → Hotkeys** for a custom binding.
- **No page icon or cover:** turn on **Page icon and cover**, turn off the Banners, Pixel Banner, or Iconize plugin, and use Live Preview or Reading view.
- **A palette only partly applies:** community themes may not follow **Paper background: Whole app**, which is designed for the default theme; try **Note page**. Palettes restyle only what Notion Flow draws — your theme still owns the rest.
- **The Template entry reports that no template folder is set:** turn on the core **Templates** plugin and set **Settings → Templates → Template folder location**.
- **Manual install is not detected:** verify the folder is exactly `.obsidian/plugins/notion-flow/`, contains all three release files, and restart Obsidian.

## Language

The interface follows Obsidian's language setting and includes English and Simplified Chinese. Slash-command search accepts both languages in either interface, and the Chinese names also match their pinyin and initials. Documentation and example buttons for both languages are available under **Settings → Notion Flow → Help & examples**.

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
