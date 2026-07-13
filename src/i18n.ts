/**
 * Minimal i18n: `t(key)` returns the translation for the current Obsidian
 * UI language, falling back to the English key itself. Obsidian stores the
 * UI language in `localStorage("language")` (unset = English), so language
 * is fixed per app session — dictionaries can be resolved once at load.
 */

const ZH: Record<string, string> = {
  // Settings tab
  "Drag-and-drop blocks": "块拖拽",
  "Show a drag handle in the left margin to reorder paragraphs, headings, lists, quotes, and code blocks.":
    "在左侧边距显示拖拽手柄,可重新排列段落、标题、列表、引用和代码块。",
  "Slash commands": "斜杠命令",
  "Type / to insert headings, lists, callouts, tables, and more.":
    "输入 / 快速插入标题、列表、标注、表格等。",
  "Floating format toolbar": "浮动格式工具栏",
  "Show a formatting popup when you select text.": "选中文本时弹出格式工具栏。",
  "Paste URLs as links": "粘贴 URL 生成链接",
  "Pasting a URL over selected text turns it into [text](url).":
    "选中文本后粘贴 URL,自动生成 [文本](链接)。",
  "Cleaner WYSIWYG rendering": "更简洁的所见即所得渲染",
  "Softer markdown syntax in Live Preview: rounded bullets, hidden quote markers, styled dividers.":
    "在实时预览中弱化 Markdown 语法:圆点列表符、隐藏引用标记、美化分割线。",

  // Command palette
  "Move block up": "上移块",
  "Move block down": "下移块",
  "Duplicate block": "复制块",

  // Block menu
  Text: "正文",
  "Heading 1": "一级标题",
  "Heading 2": "二级标题",
  "Heading 3": "三级标题",
  "Bulleted list": "无序列表",
  "Numbered list": "有序列表",
  "To-do": "待办",
  Quote: "引用",
  Duplicate: "创建副本",
  "Copy text": "复制文本",
  "Delete block": "删除块",

  // Drag affordances
  "Insert block below": "在下方插入块",
  "{n} lines": "{n} 行",

  // Floating toolbar
  Bold: "加粗",
  Italic: "斜体",
  Strikethrough: "删除线",
  "Inline code": "行内代码",
  Link: "链接",
  "Text color": "文字颜色",
  "Highlight color": "高亮颜色",
  "Clear formatting": "清除格式",
  "Default highlight (==)": "默认高亮(==)",
  "Remove color": "移除颜色",

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
