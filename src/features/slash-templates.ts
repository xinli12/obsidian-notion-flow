import { Notice, normalizePath } from "obsidian";
import type { App, Editor, EditorPosition, TFile } from "obsidian";
import { t } from "../i18n";
import { SLASH_STRONG_TIER } from "../core/slash-search";
import type { SlashSearchEntry } from "../core/slash-search";

/**
 * Templates from the slash menu, through Obsidian's core Templates plugin:
 * one row per template in its folder, inserted by the plugin's own
 * `insertTemplate`, so `{{date}}`, `{{title}}` and properties behave exactly
 * as in "Insert template". Without a usable folder a single "Template" row
 * runs the core command, which opens Obsidian's picker or its own notice.
 */

/** Core Templates' "Insert template". Obsidian registers core-plugin commands without a plugin prefix (1.13.7). */
export const TEMPLATE_INSERT_COMMAND = "insert-template";
/** Up to this many templates are listed in the unfiltered menu; more stay searchable behind one picker row. */
export const TEMPLATE_INLINE_LIMIT = 8;

export interface TemplateSlashEntry extends SlashSearchEntry {
  kind: "template";
  desc: string;
  icon: string;
  /** null: the picker row (runs the core command). */
  templateFile: TFile | null;
}

/** The part of the core Templates plugin instance this module uses. */
export interface TemplatesInstance {
  options?: { folder?: unknown };
  insertTemplate?: (file: TFile) => Promise<void>;
}

interface InternalPlugins {
  getEnabledPluginById?(id: string): unknown;
  plugins?: Record<string, { enabled?: boolean; instance?: unknown } | undefined>;
}
interface CommandRegistry {
  executeCommandById?(id: string): boolean;
  findCommand?(id: string): unknown;
}
/** A vault node, duck-typed: a folder has `children`, a note has `extension` "md". */
interface VaultNode { extension?: string; children?: unknown }

/** The enabled core Templates instance, or null when the plugin is off or lacks `insertTemplate`. */
export function templatesInstance(app: App): TemplatesInstance | null {
  const internal = (app as unknown as { internalPlugins?: InternalPlugins }).internalPlugins;
  if (!internal) return null;
  const instance = typeof internal.getEnabledPluginById === "function"
    ? internal.getEnabledPluginById("templates")
    : internal.plugins?.templates?.enabled ? internal.plugins.templates.instance : null;
  if (!instance || typeof (instance as TemplatesInstance).insertTemplate !== "function") return null;
  return instance as TemplatesInstance;
}

/** The template folder's path and node, when it is set, is not the vault root (Obsidian refuses it) and exists. */
function templateFolder(app: App): { path: string; node: VaultNode } | null {
  const raw = templatesInstance(app)?.options?.folder;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const path = normalizePath(raw);
  if (path === "/") return null;
  const node = app.vault.getAbstractFileByPath(path) as unknown as VaultNode | null;
  return node && Array.isArray(node.children) ? { path, node } : null;
}

/** Every `.md` under `folder`, recursively, sorted by path as Obsidian's own picker sorts them. */
function templateFilesIn(folder: VaultNode): TFile[] {
  const files: TFile[] = [];
  const walk = (node: VaultNode) => {
    for (const child of node.children as VaultNode[]) {
      if (!child) continue;
      if (Array.isArray(child.children)) walk(child);
      else if (child.extension === "md") files.push(child as unknown as TFile);
    }
  };
  walk(folder);
  return files.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }));
}

/** The templates core Templates would offer; null = no usable folder. */
export function listTemplateFiles(app: App): TFile[] | null {
  const folder = templateFolder(app);
  return folder ? templateFilesIn(folder.node) : null;
}

/** Chinese and Japanese runs: written without spaces between words. */
const RE_CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu;

/**
 * The words a template is found by: its name and folders split at spaces,
 * punctuation and camelCase ("meeting-notes" → notes, "DailyLog" → log),
 * plus every tail of a Chinese or Japanese run ("项目周报" → 周报). Template
 * rows list only for a word-prefix match (`minTier`), so a word inside a
 * name must be a word of its own to be found.
 */
function templateWords(names: readonly string[]): string[] {
  const words = new Set<string>();
  for (const name of names) {
    for (const word of name.split(/\s+/)) if (word) words.add(word);
    for (const part of name.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2").split(/[^\p{L}\p{M}\p{N}]+/u)) if (part) words.add(part);
    for (const run of name.match(RE_CJK_RUN) ?? []) {
      for (let i = 0; i < run.length; i++) words.add(run.slice(i));
    }
  }
  return [...words];
}

/* Template rows carry the same fixed keywords ("template templates") and
 * file ids ("template:…/x.md"), whose substrings would list every row for
 * /em, /lat, /pla, /at or /md; `minTier` keeps them to deliberate matches. */
function pickerEntry(): TemplateSlashEntry {
  return {
    id: "template",
    name: t("Template"),
    desc: t("Insert a template from your templates folder"),
    icon: "file-plus",
    keywords: "template templates 模板",
    pinyin: "muban mb",
    group: "template",
    queryOnly: false,
    minTier: SLASH_STRONG_TIER,
    kind: "template",
    templateFile: null,
  };
}

function fileEntry(file: TFile, folderPath: string, queryOnly: boolean): TemplateSlashEntry {
  const inside = file.path.startsWith(`${folderPath}/`) ? file.path.slice(folderPath.length + 1) : file.path;
  const folders = inside.split("/").slice(0, -1);
  return {
    id: `template:${file.path}`,
    // A replacer function: "$&", "$$" or "$'" in a file name are text, not replacement patterns.
    name: t("Template · {name}").replace("{name}", () => file.basename),
    desc: file.path.replace(/\.md$/i, ""),
    icon: "file-plus",
    keywords: [...templateWords([file.basename, ...folders]), "template templates 模板"].join(" ").toLowerCase(),
    pinyin: "muban mb",
    group: "template",
    queryOnly,
    minTier: SLASH_STRONG_TIER,
    kind: "template",
    templateFile: file,
  };
}

function noFolderNotice() {
  new Notice(t("Set a template folder in Settings → Templates first"));
}

function activeEditor(app: App): Editor | null {
  return app.workspace.activeEditor?.editor ?? null;
}

/**
 * The slash rows for the core Templates plugin. Given an `editor` that is not
 * the workspace's active editor (a column editor, a hover popover), nothing:
 * `insertTemplate` always writes into the active editor.
 */
export function templateSlashEntries(app: App, editor?: Editor): TemplateSlashEntry[] {
  if (editor && activeEditor(app) !== editor) return [];
  const folder = templateFolder(app);
  const files = folder ? templateFilesIn(folder.node) : [];
  if (!folder || files.length === 0) return [pickerEntry()];
  const queryOnly = files.length > TEMPLATE_INLINE_LIMIT;
  const entries = files.map((file) => fileEntry(file, folder.path, queryOnly));
  return queryOnly ? [pickerEntry(), ...entries] : entries;
}

export function isTemplateSlashEntry(value: unknown): value is TemplateSlashEntry {
  return value != null && (value as { kind?: unknown }).kind === "template";
}

/** Quote markers at the start of a line ("> ", "> > "): kept, the template starts inside the quote. */
const RE_QUOTE_HEAD = /^[ \t]*(?:>[ \t]?)+/;
/** What may stand before the query besides quote markers without being text:
 * indentation and one bare list or task marker ("- ", "1. ", "\t- [ ] "). */
const RE_BARE_CONTAINER = /^\s*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[.\][ \t]+)?)?$/;

/**
 * Replace the slash query `from`–`to` (one line) with a template. The query
 * goes first, since `insertTemplate` writes at the selection. A bare list or
 * task marker and indentation before it go too, so the template's first line
 * starts at column 0 ("- /meet" leaves no empty bullet, "\t- /meet" no
 * indented "## Meeting"); quote markers stay. A query typed after real text
 * ("中文/meet", "- 中文/meet") moves the template to a fresh line below, as
 * block slash entries do. `file` null runs the core command (Obsidian's
 * picker, or its own "no folder" notice). False when nothing was inserted:
 * another editor is active, or core Templates is off (our notice, query kept).
 */
export async function runTemplateEntry(
  app: App, editor: Editor, from: EditorPosition, to: EditorPosition, file: TFile | null
): Promise<boolean> {
  if (activeEditor(app) !== editor || from.line !== to.line) return false;
  const commands = (app as unknown as { commands?: CommandRegistry }).commands;
  const instance = file ? templatesInstance(app) : null;
  const commandMissing = !file && (typeof commands?.executeCommandById !== "function" ||
    (typeof commands.findCommand === "function" && !commands.findCommand(TEMPLATE_INSERT_COMMAND)));
  if ((file && !instance) || commandMissing) {
    noFolderNotice();
    return false;
  }
  const length = editor.getLine(from.line).length;
  const start = { line: from.line, ch: Math.min(from.ch, length) };
  editor.replaceRange("", start, { line: to.line, ch: Math.max(start.ch, Math.min(to.ch, length)) });
  const head = editor.getLine(start.line).slice(0, start.ch);
  const quote = head.match(RE_QUOTE_HEAD)?.[0] ?? "";
  if (RE_BARE_CONTAINER.test(head.slice(quote.length))) {
    editor.replaceRange("", { line: start.line, ch: quote.length }, start);
    editor.setCursor({ line: start.line, ch: quote.length });
  } else {
    editor.replaceRange("\n", start);
    editor.setCursor({ line: start.line + 1, ch: 0 });
  }
  if (file && instance?.insertTemplate) {
    await instance.insertTemplate(file);
    return true;
  }
  const ok = commands?.executeCommandById?.(TEMPLATE_INSERT_COMMAND) === true;
  if (!ok) noFolderNotice();
  return ok;
}
