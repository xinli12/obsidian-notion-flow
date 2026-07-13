# Notion Flow — Obsidian plugin

[中文说明](README.zh.md)

Notion-style editing for Obsidian (desktop): drag-and-drop blocks, slash commands, a floating format toolbar, and cleaner WYSIWYG rendering in Live Preview. The UI is available in English and 简体中文, following your Obsidian language setting.

## Install

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](../../releases).
2. Open your vault folder, then `.obsidian/plugins/` (create `plugins` if missing; `.obsidian` may be hidden — press `Cmd+Shift+.` in Finder to show it).
3. Create a folder named `notion-flow` and copy the three files in.
4. In Obsidian: Settings → Community plugins → turn off Restricted mode if prompted → click the refresh icon → enable **Notion Flow**.
5. Make sure you're editing in **Live Preview** mode (Settings → Editor → Default editing mode).

## Features

**Drag-and-drop blocks** — hover any line and a ⋮⋮ handle appears in the left margin, with the whole block highlighted so you see exactly what you're grabbing. Drag it and a ghost preview follows your cursor; a dot-tipped line shows where it will land, and your mouse's **horizontal position picks the nesting depth**, stepping by your vault's indent unit (tabs or spaces, matching the Tab key) and clamped to valid markdown levels — blocks re-indent automatically. Dragging sideways without moving up or down re-indents the block in place. List items bring their nested children, callouts/quotes and code fences move as one unit (even code blocks inside lists), the view keeps scrolling while you hold a drag near the top or bottom edge, and `Esc` cancels a drag.

**Block menu** — *click* the ⋮⋮ handle without dragging: Turn into (text, headings, lists, to-do, quote), Duplicate, Copy text, Delete block.

**Keyboard blocks** — `Alt+↑`/`Alt+↓` move the block under the cursor over its neighbors (code fences move as one unit); `Alt+Shift+D` duplicates it. Rebindable in Hotkeys.

**Slash commands** — type `/` at the start of a line, after a space, or right after CJK text (no space needed), then keep typing to filter — English and Chinese keywords both work (`/h1`, `/表格`): headings, bulleted/numbered/to-do lists, quote, callout, toggle (foldable callout), code block, table, divider, image embed, internal link. Never triggers inside code blocks, and `/divider` keeps a blank line above so the previous line can't turn into a setext heading.

**Floating toolbar** — select text with the mouse or keyboard (Shift+arrows, `Cmd/Ctrl+A`) and a popup appears with bold, italic, strikethrough, **text color** (8-color palette), **highlight color** (default `==` plus 8 tints), inline code, link, and **clear formatting**. Buttons light up when the format is already applied; picking a new color on colored text recolors it in place, and the ⊘ swatch removes it. `Esc` dismisses the toolbar. Colors are written as inline HTML (`<span style="color:…">` / `<mark …>`) using Obsidian's theme palette variables, so they match your theme and flip automatically between light and dark mode.

Known limitation: text selected entirely *inside* a rendered widget (a callout preview, or double-clicking a colored word) is a DOM-only selection that Obsidian doesn't map to the editor, so the toolbar can't act on it — extend the selection past the widget boundary, or open the callout with its `</>` button first.

**Paste URLs as links** — pasting a URL over selected text turns it into `[text](url)`, like Notion.

**Nested blocks indent visually** — code fences and callouts nested inside list items shift right with their background to sit under their parent item, Notion-style, instead of hugging the left edge.

**Cleaner rendering** — in Live Preview: dimmed list markers, hidden `>` quote markers, softer dividers, rounded accent-colored checkboxes, faded completed to-dos, inline-code pills, and dimmed syntax tokens (`**`, `#`, etc.) on the line you're editing. Indentation guides are Obsidian's native ones — the plugin doesn't redraw them.

Every feature can be toggled in Settings → Notion Flow.

## Language / 语言

The plugin follows Obsidian's UI language (Settings → General → Language): English and 简体中文 are built in. Slash-command search accepts both English and Chinese keywords regardless of UI language. PRs adding more languages are welcome — see [`src/i18n.ts`](src/i18n.ts).

## Development

```bash
npm install --legacy-peer-deps   # obsidian pins an older @codemirror/state peer
npm run typecheck                # tsc -noEmit
npm test                         # bundles with stubs, runs test/run*.mjs
npm run build                    # emits main.js
```

Copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/notion-flow/` to test in Obsidian, then reload the plugin (or the app).

## License

[MIT](LICENSE)
