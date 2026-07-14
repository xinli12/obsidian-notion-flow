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
  "Cleaner WYSIWYG rendering": "更简洁的所见即所得渲染",
  "Apply display-only polish to quotes, dividers, headings, tasks, and inline code in Live Preview and Reading view. List cycles stay enabled independently. Your Markdown is never changed.":
    "只优化实时预览和阅读视图中的引用、分割线、标题、任务与行内代码外观；列表循环独立保持启用，且不会修改 Markdown 内容。",
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
  "Accent color": "强调色",
  "Striped table rows": "表格斑马纹",
  "Shade every other table row.": "表格隔行着色。",
  "Conceal HTML formatting tags": "隐藏 HTML 格式标签",
  "Hide the raw <span>, <mark>, and <u> tags written by the formatting tools in Live Preview.":
    "在实时预览中隐藏格式工具生成的 <span>、<mark> 和 <u> 原始标签。",
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
  Red: "红",
  Orange: "橙",
  Yellow: "黄",
  Green: "绿",
  Cyan: "青",
  Blue: "蓝",
  Purple: "紫",
  Pink: "粉",

  // Command palette
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

  // Drag affordances
  "Insert block below": "在下方插入块",
  "Drag block": "拖拽块",
  "Drag table": "拖拽整张表格",
  "{n} lines": "{n} 行",
  "Empty line": "空行",

  // Floating toolbar
  "Formatting toolbar": "格式工具栏",
  "Table actions": "表格操作",
  "Scrollable table": "可横向滚动的表格",
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
