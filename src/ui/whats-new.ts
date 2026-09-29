import { Modal, Notice, TFile, normalizePath, setIcon, type App } from "obsidian";
import { t, tl } from "../i18n";
import { chordLabel, parseChord } from "../core/keys";
import { encodeCommentAttr } from "../core/comments";

/* What's new: a short, bilingual tour of a release — the update notice
 * opens it — plus a tour note and a mind-map canvas written into the vault
 * on request, so every feature can be tried on real Markdown. Nothing here
 * imports main.ts; the plugin passes in what runs commands and settings. */

export const RELEASES_URL = "https://github.com/xinli12/obsidian-notion-flow/releases/latest";

type Bilingual = { en: string; zh: string };

/** A row's "Try it": a command id (`notion-flow:…`) or the settings tab. */
export type WhatsNewAction = { command: string } | { settings: true };

export interface WhatsNewItem {
  id: string;
  /** Lucide id. */
  icon: string;
  title: Bilingual;
  /** One sentence; `{chord}` is replaced by the chord's key label. */
  body: Bilingual;
  chord?: string;
  action?: WhatsNewAction;
}

export interface WhatsNewOptions {
  version: string;
  onTour(): void;
  /** Run a command by id; false when it could not run (no note open). */
  run(commandId: string): boolean | void;
  /** Whether a command exists; defaults to the app's command registry. */
  available?(commandId: string): boolean;
  openSettings?(): void;
  releaseUrl?: string;
}

export interface WhatsNewRow {
  id: string;
  icon: string;
  title: string;
  body: string;
  action: { command?: string; settings?: boolean } | null;
}

/** This release's highlights, most visible first. */
export const WHATS_NEW_ITEMS: readonly WhatsNewItem[] = [
  {
    id: "note-style",
    icon: "palette",
    title: { en: "Note style: palettes and looks", zh: "笔记样式：配色与版式" },
    body: {
      en: "Nine palettes and six looks restyle callouts, headings, tables, quotes and code together.",
      zh: "九套配色、六种版式，一次统一标注、标题、表格、引用与代码。",
    },
    action: { settings: true },
  },
  {
    id: "style-switcher",
    icon: "wand-2",
    title: { en: "Change note style…", zh: "切换样式配色…" },
    body: {
      en: "Preview palettes and looks live from the command palette; Esc keeps your current style.",
      zh: "在命令面板里实时预览配色与版式，按 Esc 保留当前样式。",
    },
    action: { command: "notion-flow:change-note-style" },
  },
  {
    id: "link-card",
    icon: "link",
    title: { en: "Link card", zh: "链接卡片" },
    body: {
      en: "{chord} edits a link's text and destination in a small card, opens it or unlinks it.",
      zh: "{chord} 在小卡片里编辑链接文字与地址，也可打开或取消链接。",
    },
    chord: "Mod+K",
    action: { command: "notion-flow:insert-link" },
  },
  {
    id: "block-color",
    icon: "paint-bucket",
    title: { en: "Block color", zh: "块颜色" },
    body: {
      en: "Color a whole block's text or background from its ⋮⋮ menu, or type /red or /blue background.",
      zh: "在块的 ⋮⋮ 菜单中设置整块文字或背景颜色，或输入 /红色、/蓝色背景。",
    },
    action: { command: "notion-flow:open-block-menu" },
  },
  {
    id: "callout-icons",
    icon: "lightbulb",
    title: { en: "Callout icons", zh: "标注图标" },
    body: {
      en: "Click a callout's icon, then Icon…, to pick one of 24 icons or any emoji.",
      zh: "点击标注图标 → 图标…，可选 24 个图标或任意表情。",
    },
  },
  {
    id: "page-header",
    icon: "image",
    title: { en: "Page icon, cover and style", zh: "页面图标、封面与样式" },
    body: {
      en: "Hover above the title to add an emoji icon or a cover; ⋯ → Page style sets the font, small text and full width.",
      zh: "悬停在标题上方添加表情图标或封面；⋯ → 页面样式 可设字体、小号文字与全宽。",
    },
  },
  {
    id: "comments-list",
    icon: "messages-square",
    title: { en: "All comments in a note", zh: "本笔记的全部批注" },
    body: {
      en: "Show comments in this note lists them; Enter jumps, {chord} resolves.",
      zh: "「查看本笔记的批注」列出全部批注：Enter 跳转，{chord} 解决。",
    },
    chord: "Mod+Enter",
    action: { command: "notion-flow:show-comments" },
  },
  {
    id: "tables-captions",
    icon: "table",
    title: { en: "Tables and captions", zh: "表格与图注" },
    body: {
      en: "Steadier table editing, and captions that stay with their image, table or code block.",
      zh: "表格编辑更稳，图注始终跟随图片、表格或代码块。",
    },
  },
];

/** A chord as this platform prints it: ⌘K, Ctrl+K, ⌘↩. */
function chordText(chord: string): string {
  const { modifiers, key } = parseChord(chord);
  return chordLabel(modifiers, key ?? "");
}

/** The rows the modal shows, in the UI language: a command row keeps its
 * Try it only while `available(command)`, the settings row only when the
 * host can open the settings. */
export function whatsNewRows(options: WhatsNewOptions, available: (id: string) => boolean): WhatsNewRow[] {
  return WHATS_NEW_ITEMS.map((item) => {
    let body = tl(item.body);
    if (item.chord) body = body.replace("{chord}", chordText(item.chord));
    let action: WhatsNewRow["action"] = null;
    if (item.action && "command" in item.action) {
      if (available(item.action.command)) action = { command: item.action.command };
    } else if (item.action?.settings && options.openSettings) {
      action = { settings: true };
    }
    return { id: item.id, icon: item.icon, title: tl(item.title), body, action };
  });
}

type CommandRegistry = { findCommand?(id: string): { checkCallback?(checking: boolean): unknown } | undefined };
const registryOf = (app: App) => (app as unknown as { commands?: CommandRegistry }).commands;

function registryHas(app: App, commandId: string): boolean {
  return !!registryOf(app)?.findCommand?.(commandId);
}

/** Whether a command can run right now, the test the command palette
 * uses. executeCommandById cannot tell: it reports success even when an
 * editor command found no editor and did nothing. */
function commandReady(app: App, commandId: string): boolean {
  const command = registryOf(app)?.findCommand?.(commandId);
  if (!command?.checkCallback) return true;
  try {
    return !!command.checkCallback(true);
  } catch {
    return false;
  }
}

/** The release's highlights, each with a Try it where its command exists,
 * then the tour and the release notes. */
export class WhatsNewModal extends Modal {
  constructor(app: App, private readonly options: WhatsNewOptions) {
    super(app);
  }

  onOpen(): void {
    const { options } = this;
    const heading = t("What's new in Notion Flow {version}").replace("{version}", options.version);
    // setTitle arrived in Obsidian 1.5; older builds still have the bare title element.
    if (typeof this.setTitle === "function") this.setTitle(heading);
    else this.titleEl?.setText(heading);
    this.modalEl.addClass("nf-whats-new-modal");
    const available = (id: string) => options.available?.(id) ?? registryHas(this.app, id);
    const list = this.contentEl.createDiv({ cls: "nf-whats-new-list" });
    for (const row of whatsNewRows(options, available)) {
      const rowEl = list.createDiv({ cls: "nf-whats-new-row" });
      rowEl.setAttribute("data-id", row.id);
      setIcon(rowEl.createDiv({ cls: "nf-whats-new-icon" }), row.icon);
      const text = rowEl.createDiv({ cls: "nf-whats-new-text" });
      text.createDiv({ cls: "nf-whats-new-title", text: row.title });
      text.createDiv({ cls: "nf-whats-new-body", text: row.body });
      const action = row.action;
      if (action) {
        const tryIt = rowEl.createEl("button", { cls: "nf-whats-new-try", text: t("Try it"), attr: { type: "button" } });
        tryIt.addEventListener("click", () => this.tryIt(action));
      }
    }
    const footer = this.contentEl.createDiv({ cls: "nf-whats-new-footer" });
    const tour = footer.createEl("button", {
      cls: "mod-cta nf-whats-new-tour",
      text: t("Create tour notes in my vault"),
      attr: { type: "button" },
    });
    tour.addEventListener("click", () => {
      // The tour opens in a new tab, which this dialog would cover.
      this.close();
      try {
        options.onTour();
      } catch (error) {
        console.error("Notion Flow: the tour failed", error);
      }
    });
    const releases = footer.createEl("button", {
      cls: "nf-whats-new-release",
      text: t("Release notes on GitHub"),
      attr: { type: "button" },
    });
    releases.addEventListener("click", () => {
      const win = this.contentEl.ownerDocument?.defaultView ?? window;
      win.open(options.releaseUrl ?? RELEASES_URL, "_blank", "noopener,noreferrer");
    });
  }

  /** Close first, then run on the next frame: the editor has its focus
   * back by then, which editor commands need. */
  private tryIt(action: NonNullable<WhatsNewRow["action"]>) {
    const win = this.contentEl.ownerDocument?.defaultView ?? window;
    this.close();
    win.requestAnimationFrame(() => {
      try {
        if (action.settings) {
          this.options.openSettings?.();
          return;
        }
        const command = action.command;
        if (command && (!commandReady(this.app, command) || this.options.run(command) === false)) {
          new Notice(tl({ en: "Open a note first, then try again.", zh: "请先打开一篇笔记，再试一次。" }));
        }
      } catch (error) {
        console.error("Notion Flow: Try it failed", error);
      }
    });
  }

  onClose(): void {
    this.contentEl.replaceChildren();
  }
}

/* ---------- The tour, written into the vault ---------- */

/** The folder the tour files go in (UI language). */
export function tourFolder(): string {
  return normalizePath(tl({ en: "Notion Flow tour", zh: "Notion Flow 导览" }));
}

const TOUR_NOTE_NAME: Bilingual = { en: "Notion Flow tour.md", zh: "Notion Flow 导览.md" };
const TOUR_CANVAS_NAME: Bilingual = { en: "Mind map.canvas", zh: "思维导图.canvas" };

function tourNote(): string {
  const comment = (note: string, words: string) =>
    `<span class="nf-cmt" data-nf-cmt="${encodeCommentAttr(note)}">${words}</span>`;
  // The file is synced and read on every platform: write the chords the
  // same way everywhere, not as this machine prints them (⌘⇧M, Ctrl+Shift+M).
  const addComment = "Cmd/Ctrl+Shift+M";
  const resolve = "Cmd/Ctrl+Enter";
  const en = `---
icon: 🧭
cover-style: aurora
---
Everything below is ordinary Markdown: edit it, color it, move it around. Nothing breaks.

## 1. Blocks

Hover a block: ⋮⋮ appears on its left, + beside it.

- Drag ⋮⋮ to move a block; click it for the block menu: **Turn into**, duplicate, delete and **Block color**.
- Click + to add a block below.
- Try it on this list item.

## 2. Slash menu

Type / at the start of a line, then keep typing to filter: /h2, /todo, /callout, /toggle, /table, /toc. Enter inserts.

- [ ] Type /todo on the next line

## 3. Color

Select words and pick a color in the floating toolbar. A whole block takes a text color or a background from its ⋮⋮ menu, like this paragraph. <span class="nf-blk-blue"></span>

## 4. Callouts

> [!tip|nf-green nfi-rocket] Callouts with icons
> Click a callout's icon to change its type or color; **Icon…** picks one of 24 icons or any emoji.

## 5. Comments

Select words and press ${addComment} to ${comment("Comments live in the note itself, as plain HTML.", "comment on them")}. Hover the yellow words to read the note. **Show comments in this note** lists every comment: Enter jumps to it, ${resolve} resolves it.

## 6. Page icon, cover and style

The 🧭 and the color band above the title are this page's icon and cover. Hover above the title to add, change or remove them. ⋯ → **Page style** sets the font (Serif, Mono, Kai), small text and full width for one note.

## 7. Note style

Settings → Notion Flow → **Note style** picks one of nine palettes and six looks for callouts, headings, tables, quotes and code. **Change note style…** in the command palette previews them live; Esc keeps your current style.

## 8. Canvas mind maps

Open [[Mind map.canvas]]. Select a card and press Tab to add a child. While you type in a card, Enter finishes it; then Enter adds the next card and Tab adds a child. Shift+Enter breaks a line.

## 9. Shortcuts

**Open shortcut guide** in the command palette lists every key and slash word.
`;
  const zh = `---
icon: 🧭
cover-style: aurora
---
下面都是普通的 Markdown：随意编辑、上色、挪动，不会弄坏任何东西。

## 1. 块

把鼠标移到一个块上：左侧出现 ⋮⋮，旁边还有 +。

- 拖动 ⋮⋮ 移动块；点击它打开块菜单：**转为**、创建副本、删除和**块颜色**。
- 点击 + 在下方添加新块。
- 就在这个列表项上试试。

## 2. 斜杠菜单

在行首输入 /，继续输入即可筛选：/h2、/todo、/callout、/toggle、/table、/toc，按 Enter 插入。

- [ ] 在下一行输入 /todo

## 3. 颜色

选中文字，在浮动工具栏里挑一个颜色。整个块也可以从 ⋮⋮ 菜单设置文字颜色或背景，就像这一段。 <span class="nf-blk-blue"></span>

## 4. 标注

> [!tip|nf-green nfi-rocket] 带图标的标注
> 点击标注的图标可以更换类型或颜色；**图标…** 可选 24 个图标或任意表情。

## 5. 批注

选中文字后按 ${addComment} 即可${comment("批注就保存在笔记里，是普通的 HTML。", "添加批注")}。把鼠标移到黄色文字上就能看到批注内容。**查看本笔记的批注** 会列出全部批注：Enter 跳转，${resolve} 解决。

## 6. 页面图标、封面与样式

标题上方的 🧭 和彩色横幅就是本页的图标与封面。悬停在标题上方即可添加、更换或移除。⋯ → **页面样式** 可为单篇笔记设置字体（宋体、等宽、楷体）、小号文字与全宽。

## 7. 笔记样式

设置 → Notion Flow → **笔记样式** 提供九套配色、六种版式，统一标注、标题、表格、引用与代码。命令面板中的 **切换样式配色…** 可实时预览，按 Esc 保留当前样式。

## 8. 白板思维导图

打开 [[思维导图.canvas]]。选中卡片后按 Tab 新建子主题。在卡片里输入时，Enter 结束编辑；之后再按 Enter 新建下一张卡片，按 Tab 新建子主题。Shift+Enter 换行。

## 9. 快捷键

在命令面板中运行 **打开快捷键指南**，可查看全部按键与斜杠命令。
`;
  return tl({ en, zh });
}

/** The children of the tour's mind map: its keys, one per card. */
const TOUR_CANVAS_CARDS: readonly Bilingual[] = [
  { en: "Tab adds a child", zh: "Tab 新建子主题" },
  { en: "Enter: finish, then next card", zh: "Enter 完成，再按一次新建下一张" },
  { en: "Shift+Enter breaks a line", zh: "Shift+Enter 换行" },
];

/** A small mind map: a root and three children, the root carrying the
 * plugin's layout so it opens as a map. */
function tourCanvas(): string {
  const card = (id: string, text: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
    id,
    type: "text",
    text,
    x,
    y,
    width: 260,
    height: 60,
    ...extra,
  });
  const children = TOUR_CANVAS_CARDS.map(tl);
  const ids = ["6e66746f75720001", "6e66746f75720002", "6e66746f75720003"];
  const root = "6e66746f75720000";
  const nodes = [
    card(root, "Notion Flow", 0, 0, { nfLayout: "right" }),
    ...children.map((text, i) => card(ids[i], text, 360, (i - 1) * 100, { color: "5" })),
  ];
  const edges = ids.map((id, i) => ({
    id: `6e66746f7572e00${i + 1}`,
    fromNode: root,
    fromSide: "right",
    toNode: id,
    toSide: "left",
  }));
  return JSON.stringify({ nodes, edges }, null, "\t");
}

/** The tour files, paths under tourFolder(): the note first, then the canvas. */
export function tourFiles(): { path: string; content: string }[] {
  const folder = tourFolder();
  return [
    { path: normalizePath(`${folder}/${tl(TOUR_NOTE_NAME)}`), content: tourNote() },
    { path: normalizePath(`${folder}/${tl(TOUR_CANVAS_NAME)}`), content: tourCanvas() },
  ];
}

/**
 * Write the tour note and its canvas (an existing file is never
 * overwritten), say so when anything was created, and open the note in a
 * new tab. Returns the note, or null when it could not be written.
 */
export async function createTourNote(app: App): Promise<TFile | null> {
  try {
    const folder = tourFolder();
    if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
    let created = 0;
    let note: TFile | null = null;
    for (const [index, file] of tourFiles().entries()) {
      let existing = app.vault.getAbstractFileByPath(file.path);
      if (!existing) {
        existing = await app.vault.create(file.path, file.content);
        created++;
      }
      if (index === 0 && existing instanceof TFile) note = existing;
    }
    if (created > 0) new Notice(t("Tour notes created in {folder}").replace("{folder}", folder));
    if (note) await app.workspace.getLeaf("tab").openFile(note);
    return note;
  } catch (error) {
    console.error("Notion Flow: creating the tour notes failed", error);
    new Notice(tl({ en: "Could not create the tour notes.", zh: "无法创建导览笔记。" }));
    return null;
  }
}

/** Make a Notice read as a link: pointer, an arrow after the message, and
 * a click that hides it and runs `onClick`. */
export function noticeLink(notice: Notice, onClick: () => void): void {
  const parts = notice as unknown as { containerEl?: HTMLElement; noticeEl?: HTMLElement; messageEl?: HTMLElement };
  const box = parts.containerEl ?? parts.noticeEl;
  if (!box) return;
  box.addClass("nf-notice-link");
  box.style.cursor = "pointer";
  box.setAttribute("role", "button");
  (parts.messageEl ?? parts.noticeEl ?? box).createSpan({ cls: "nf-notice-arrow", text: " →" });
  box.addEventListener("click", () => {
    try {
      notice.hide();
      onClick();
    } catch (error) {
      console.error("Notion Flow: the notice action failed", error);
    }
  });
}
