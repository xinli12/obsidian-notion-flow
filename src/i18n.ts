/**
 * Minimal i18n: `t(key)` returns the translation for the current Obsidian
 * UI language, falling back to the English key itself. Obsidian stores the
 * UI language in `localStorage("language")` (unset = English), so language
 * is fixed per app session — dictionaries can be resolved once at load.
 */

const ZH: Record<string, string> = {
  // Settings tab
  Editing: "编辑",
  "Core controls for writing, inserting, formatting, and moving blocks.":
    "用于书写、插入、格式化和移动内容块的核心控制。",
  "Drag-and-drop blocks": "块拖拽",
  "Show a drag handle in the left margin to reorder paragraphs, headings, lists, quotes, callouts, tables, and code blocks.":
    "在左侧边距显示拖拽手柄,可重新排列段落、标题、列表、引用、标注、表格和代码块。",
  Tables: "表格",
  "Combine table editing, visual styling, header tint, and stripes independently.":
    "表格编辑、视觉样式、表头底色和斑马纹可以独立组合。",
  Appearance: "外观",
  "Tune Markdown rendering and colors without changing the meaning of your notes.":
    "调整 Markdown 渲染与颜色，不改变笔记含义。",
  "Slash commands": "斜杠命令",
  "Type / to insert headings, lists, callouts, tables, and more.":
    "输入 / 快速插入标题、列表、标注、表格等。",
  "Floating format toolbar": "浮动格式工具栏",
  "Show text formatting on selection and table actions when a cell is active.":
    "选中文本时显示格式工具,激活单元格时显示表格操作。",
  "Paste URLs as links": "粘贴 URL 生成链接",
  "Pasting a URL over selected text turns it into [text](url).":
    "选中文本后粘贴 URL,自动生成 [文本](链接)。",
  "Paste URLs with page titles": "粘贴 URL 自动获取标题",
  "Pasting a URL with nothing selected fetches the page title in the background and turns the URL into [title](url). The plain URL stays when the page cannot be reached; code contexts are never touched.":
    "未选中文本时粘贴 URL，会在后台获取网页标题并生成 [标题](链接)；无法访问网页时保留原始 URL；代码环境不受影响。",
  "Callout and quote enhancements": "标注与引用编辑增强",
  'Enter continues the block and exits on an empty line, Backspace at the text start removes a ">" marker, multi-line pastes stay inside the block, a Callout keeps its rendered look while you edit inside it, and clicking its icon opens the type menu.':
    "按 Enter 自动续行、在空引用行按 Enter 退出块；在正文开头按 Backspace 移除一层 \">\" 标记；多行粘贴保持在块内；编辑标注时保留其渲染外观；点击标注图标可切换类型。",
  Columns: "分栏",
  'Notion-style side-by-side layout. Insert with "/columns", pick "Turn into columns" from a block menu, or drag a block to the right edge of another. Written as nested [!nf-cols]/[!nf-col] callouts — plain quotes in any other Markdown app. "[!nf-col|30]" pins a column to 30% width.':
    "Notion 式并排分栏。可通过斜杠命令「/分栏」插入、在块菜单选择「转为分栏」，或将块拖到另一个块的右缘创建。以嵌套的 [!nf-cols]/[!nf-col] 标注语法书写，在其他 Markdown 应用中显示为普通引用；「[!nf-col|30]」可将栏宽固定为 30%。",
  Comments: "批注",
  'Select text and add a note to it — from the toolbar 💬 button, the "Add comment" command, or Cmd/Ctrl+Shift+M. The anchor highlights in yellow with a 💬 marker; click the marker to read, edit, or resolve. Comments are stored inside the note and stay invisible in other Markdown apps.':
    "选中文本即可添加批注——通过工具栏 💬 按钮、「添加批注」命令或 Cmd/Ctrl+Shift+M。锚文本以黄色高亮并带 💬 标记；点击标记可查看、编辑或解除批注。批注保存在笔记内部，在其他 Markdown 应用中不可见。",
  "Add comment": "添加批注",
  Comment: "批注",
  "Write a comment…": "输入批注内容…",
  "Enter saves · Shift+Enter breaks the line": "Enter 保存 · Shift+Enter 换行",
  Save: "保存",
  Resolve: "解除批注",
  "Select some text to comment on.": "先选中要批注的文本。",
  "Comments cover a single line of text.": "批注目前仅支持单行选区。",
  "Code block enhancements": "代码块编辑增强",
  'In fenced code blocks, Enter keeps the current line\'s indentation (so blocks nested in lists stay aligned), Backspace at the text start removes one indent level, Enter after an unclosed ``` writes the closing fence, and Cmd/Ctrl+Shift+Enter (the "Exit code block" command) exits below the block.':
    "在代码块内：按 Enter 续行时保持当前缩进（列表内嵌套的代码块不再错位）；在代码文本开头按 Backspace 回退一级缩进；在未闭合的 ``` 行按 Enter 自动补全闭合围栏；按 Cmd/Ctrl+Shift+Enter（「跳出代码块」命令）跳出代码块。",
  "Cleaner WYSIWYG rendering": "更简洁的所见即所得渲染",
  "Apply display-only polish to quotes, dividers, headings, tasks, inline code, and Mermaid diagrams in Live Preview and Reading view. List cycles stay enabled independently. Your Markdown is never changed.":
    "只优化实时预览和阅读视图中的引用、分割线、标题、任务、行内代码与 Mermaid 图表外观；列表循环独立保持启用，且不会修改 Markdown 内容。",
  "Table editing enhancements": "表格编辑增强",
  "In tables, Tab and Enter move between cells, and new rows are added automatically at the end.":
    "在表格中,Tab 和 Enter 在单元格间移动,到达末尾时自动新增行。",
  "Notion-style tables": "Notion 风格表格",
  "Rounded outer border, clearer focus and hover states, and comfortable cell spacing.":
    "表格采用圆角外框、更清晰的焦点与悬停状态，以及舒适的单元格间距。",
  "Table header background": "表格表头底色",
  "Background tint of table header rows.": "表头行的背景色。",
  "Theme default": "主题默认",
  None: "无",
  "List marker color": "列表符号颜色",
  "Color of bullets and list numbers.": "无序圆点与有序编号的颜色。",
  "Quote bar color": "引用条颜色",
  "Color of the vertical bar beside quote blocks.": "引用块左侧竖条的颜色。",
  "Inline code color": "行内代码颜色",
  "Ink of `inline code` text, Notion-style. Fenced code blocks are unaffected.":
    "`行内代码` 文本的颜色，Notion 风格；不影响代码块。",
  "Code block theme": "代码块主题",
  "Syntax colors for fenced code blocks in Live Preview and Reading view. Obsidian adaptive is designed for the default theme and follows light/dark mode.":
    "设置实时预览和阅读视图中围栏代码块的语法配色；“Obsidian 自适应”专为默认主题设计，并会跟随明暗模式。",
  GitHub: "GitHub",
  "Obsidian adaptive": "Obsidian 自适应（推荐）",
  "VS Code": "VS Code",
  "One Dark": "One Dark",
  Catppuccin: "Catppuccin",
  "Tokyo Night": "Tokyo Night",
  Gruvbox: "Gruvbox",
  Dracula: "Dracula",
  Nord: "Nord",
  Solarized: "Solarized",
  "Accent color": "强调色",
  "Striped table rows": "表格斑马纹",
  "Shade every other table row.": "表格隔行着色。",
  "Conceal HTML formatting tags": "隐藏 HTML 格式标签",
  "Hide the raw <span>, <mark>, <u>, <b>, <i>, and <s> tags written by the formatting tools in Live Preview, and render them as styled text inside code blocks in Reading view.":
    "在实时预览中隐藏格式工具生成的 <span>、<mark>、<u>、<b>、<i>、<s> 原始标签，并在阅读视图中将代码块内的这些标签渲染为带样式的文本。",
  "Markdown syntax": "Markdown 语法",
  "Choose whether inline formatting source should stay visible in Live Preview.":
    "选择是否在实时预览中显示行内格式的源代码标记。",
  "Conceal inline Markdown syntax": "隐藏行内 Markdown 标记",
  "Hide the non-text markers in **bold**, *italic*, ~~strikethrough~~, `inline code`, and ==highlight==. Links stay fully visible and editable. A marker reappears only when the caret enters its source; Source mode is unchanged.":
    "隐藏 **粗体**、*斜体*、~~删除线~~、`行内代码` 和 ==高亮== 中的非文本标记；链接始终完整显示并可直接编辑。仅当光标进入标记源码时临时显示，源码模式不受影响。",
  "Help & examples": "帮助与示例",
  "Open documentation and guided example notes in English or Chinese.":
    "打开中英文使用文档和引导示例。",
  Documentation: "使用文档",
  "Complete setup, feature, keyboard, and troubleshooting guide.":
    "查看完整的安装、功能、快捷键和故障排查指南。",
  "Example notes": "示例文档",
  "Hands-on tours you can copy into your vault.":
    "可复制到库中直接操作的上手示例。",
  About: "关于",
  "Plugin version, source code, and issue reporting.":
    "插件版本、源代码与问题反馈。",
  "Open source under the MIT license.": "基于 MIT 许可证开源。",
  "Report an issue": "反馈问题",
  Cancel: "取消",
  "Restore defaults": "恢复默认设置",
  "Reset every Notion Flow option to its original value.":
    "将所有 Notion Flow 选项恢复为初始值。",
  "Reset all Notion Flow settings to their defaults?":
    "确定要将所有 Notion Flow 设置恢复为默认值吗？",
  "Notion Flow settings restored.": "Notion Flow 设置已恢复。",
  Gray: "灰",
  Red: "红",
  Orange: "橙",
  Yellow: "黄",
  Green: "绿",
  Cyan: "青",
  Blue: "蓝",
  Purple: "紫",
  Pink: "粉",

  // Command palette
  "Exit code block": "跳出代码块",
  "Move block up": "上移块",
  "Move block down": "下移块",
  "Duplicate block": "复制块",
  "Repair nested Callout": "修复列表内 Callout",

  // Block menu
  Text: "正文",
  "Heading 1": "一级标题",
  "Heading 2": "二级标题",
  "Heading 3": "三级标题",
  "Bulleted list": "无序列表",
  "Numbered list": "有序列表",
  "To-do": "待办",
  Quote: "引用",
  "Turn into": "转换为",
  Duplicate: "创建副本",
  "Copy text": "复制文本",
  "Delete block": "删除块",
  "Add row at top": "在顶部添加行",
  "Add row at bottom": "在底部添加行",
  "Add column on left": "在左侧添加列",
  "Add column on right": "在右侧添加列",
  "Table alignment": "整表对齐",
  "Format table": "格式化表格",
  "Insert row above": "在上方插入行",
  "Insert row below": "在下方插入行",
  "Insert column left": "在左侧插入列",
  "Insert column right": "在右侧插入列",
  "Delete row": "删除行",
  "Delete column": "删除列",
  "Align left": "左对齐",
  "Align center": "居中对齐",
  "Align right": "右对齐",
  "Default alignment": "默认对齐",
  "Cell background": "单元格底色",
  "Table background": "表格底色",
  "Callout type": "标注类型",
  Foldable: "可折叠",
  "Turn into quote": "转换为引用",
  "Turn into columns": "转为分栏",
  "Add column": "添加一栏",
  "Two columns": "两栏",
  "Three columns": "三栏",
  "Column widths": "栏宽",
  "Equal widths": "均分",
  "Narrow left (30%)": "左窄（30%）",
  "Narrow right (30%)": "右窄（30%）",
  "Unwrap columns": "拆开分栏",
  "Column options": "分栏选项",
  "Resize columns": "调整栏宽",
  "Drag to resize; double-click to distribute evenly":
    "拖动调整栏宽；双击恢复均分",
  "Column actions": "当前栏操作",
  "Add column left": "在左侧添加一栏",
  "Add column right": "在右侧添加一栏",
  "Move column left": "向左移动此栏",
  "Move column right": "向右移动此栏",
  "Delete this column": "删除此栏",
  "Delete this column and all of its content?": "删除此栏及其中的全部内容？",
  "Edit column source": "编辑分栏源码",
  "Finish column editing": "完成分栏编辑",
  "Editing column": "正在编辑此栏",
  "Edit this column": "编辑此栏",

  // Slash menu descriptions
  "Big section heading": "大节标题",
  "Medium section heading": "中节标题",
  "Small section heading": "小节标题",
  "Plain list with bullets": "无序圆点列表",
  "List with numbering": "有序编号列表",
  "Tasks with checkboxes": "带复选框的任务",
  "Quoted text with a bar": "带引用条的文本",
  "Colored info box": "彩色信息框",
  "Collapsible content": "可折叠的内容",
  "Blocks side by side": "块并排显示",
  "Fenced code with highlighting": "带语法高亮的代码",
  "Rows and columns": "行与列",
  "Horizontal rule": "水平分割线",
  "Embed an image or file": "嵌入图片或附件",
  "Link to another note": "链接到其他笔记",
  Note: "笔记",
  Abstract: "摘要",
  Info: "信息",
  Tip: "提示",
  Success: "成功",
  Question: "问题",
  Warning: "警告",
  Failure: "失败",
  Danger: "危险",
  Bug: "漏洞",
  Example: "示例",

  // Drag affordances
  "Insert block below": "在下方插入块",
  "Drag block": "拖拽块",
  "Drag table": "拖拽整张表格",
  "{n} lines": "{n} 行",
  "Empty line": "空行",
  "Block selection": "块框选",
  "Clear block selection": "清除块选择",
  "{n} blocks selected": "已选择 {n} 个块",
  "Skipped {n} structural blocks.": "已跳过 {n} 个结构块。",
  Copy: "复制",
  Delete: "删除",
  "Copied {n} blocks.": "已复制 {n} 个块。",

  // Floating toolbar
  "Formatting toolbar": "格式工具栏",
  "Table actions": "表格操作",
  "Scrollable table": "可横向滚动的表格",
  "Mermaid diagram": "Mermaid 图表",
  "Scrollable Mermaid diagram": "可横向滚动的 Mermaid 图表",
  Bold: "加粗",
  Italic: "斜体",
  Underline: "下划线",
  Strikethrough: "删除线",
  "Inline code": "行内代码",
  Link: "链接",
  "Text color": "文字颜色",
  "Highlight color": "高亮颜色",
  "Clear formatting": "清除格式",
  "Default highlight (==)": "默认高亮(==)",
  "Remove color": "移除颜色",
  "Choose table size": "选择表格大小",
  "Table size": "表格大小",
  "Columns × rows": "列 × 行",
  "Drag or use arrow keys, then press Enter": "拖动选择，或使用方向键后按 Enter 插入",

  // Slash menu
  "To-do list": "待办列表",
  Callout: "标注",
  "Toggle (foldable callout)": "折叠块(可折叠标注)",
  "Code block": "代码块",
  Table: "表格",
  Divider: "分割线",
  "Image / embed": "图片 / 嵌入",
  "Internal link": "内部链接",
  navigate: "选择",
  insert: "插入",
  dismiss: "关闭",
};

function currentLang(): string {
  if (typeof window === "undefined") return "en";
  try {
    return window.localStorage.getItem("language") ?? "en";
  } catch {
    return "en";
  }
}

// Simplified Chinese also serves zh-TW until a traditional dict exists.
const DICT: Record<string, string> | null = currentLang().startsWith("zh") ? ZH : null;

export function t(key: string): string {
  return DICT?.[key] ?? key;
}
