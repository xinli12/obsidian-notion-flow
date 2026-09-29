import { requestUrl, type Editor, type EditorPosition } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { buildTitledLink, extractHtmlTitle } from "../core/url-links";
import { EditorOperationScope, type EditorOperation } from "../editor/operation-scope";

interface TitleOptions {
  operations: EditorOperationScope;
  enabled(): boolean;
  view(editor: Editor): EditorView | null;
  identity(view: EditorView): string;
}

/** Latest request at a paste position owns the upgrade. The operation
 * scope also rejects file switches, closed editors and plugin teardown. */
export class PastedUrlTitles {
  private pending = new WeakMap<Editor, Map<string, EditorOperation>>();
  constructor(private options: TitleOptions) {}

  async linkify(editor: Editor, url: string, at: EditorPosition) {
    const view = this.options.view(editor);
    if (!view || !this.options.enabled()) return;
    let requests = this.pending.get(editor);
    if (!requests) this.pending.set(editor, requests = new Map());
    const key = `${at.line}:${at.ch}`;
    requests.get(key)?.cancel();
    const operation = this.options.operations.capture(view, () => this.options.identity(view), {
      sameDocument: false,
      valid: () => this.options.enabled() && this.options.view(editor) === view,
    });
    requests.set(key, operation);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!operation.isCurrent()) return;
      const res = await Promise.race([
        requestUrl({ url, throw: false }),
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 8000); }),
      ]);
      if (!res || res.status < 200 || res.status >= 300 || !operation.isCurrent()) return;
      const type = String(res.headers?.["content-type"] ?? "").toLowerCase();
      if (type && !type.includes("html")) return;
      const title = extractHtmlTitle(res.text ?? "");
      const link = title ? buildTitledLink(url, title) : null;
      if (!link || (editor.getLine(at.line) ?? "").slice(at.ch, at.ch + url.length) !== url) return;
      editor.replaceRange(link, at, { line: at.line, ch: at.ch + url.length });
    } catch {
      // Offline, timed out or detached: keep the already-pasted URL.
    } finally {
      clearTimeout(timer);
      operation.finish();
      if (requests.get(key) === operation) requests.delete(key);
    }
  }
}
