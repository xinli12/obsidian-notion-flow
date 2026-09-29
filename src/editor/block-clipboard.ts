import type { EditorView } from "@codemirror/view";
import type { EditorOperationScope } from "./operation-scope";

interface BlockClipboardHost {
  view: EditorView;
  operations: EditorOperationScope;
  identity(): unknown;
  /** Replaced on every selection change, including clearing/reselecting. */
  selection(): unknown;
  available(): boolean;
  clipboard: Pick<Clipboard, "readText" | "writeText">;
  failed(): void;
}

/** One pending destructive clipboard action per block controller. Capture
 * the original selection before awaiting permissions/the OS pasteboard. */
export class BlockClipboard {
  private revision = 0;
  constructor(private host: BlockClipboardHost) {}

  private capture() {
    const revision = ++this.revision;
    const selection = this.host.selection();
    return this.host.operations.capture(this.host.view, () => this.host.identity(), {
      valid: () => revision === this.revision && selection === this.host.selection() && this.host.available(),
    });
  }

  async copy(text: string, commit: () => void) {
    const operation = this.capture();
    try {
      if (!operation.isCurrent()) return;
      await this.host.clipboard.writeText(text);
      if (operation.isCurrent()) commit();
    } catch {
      if (operation.isCurrent()) this.host.failed();
    } finally {
      operation.finish();
    }
  }

  async paste(commit: (text: string) => void) {
    const operation = this.capture();
    try {
      if (!operation.isCurrent()) return;
      const text = await this.host.clipboard.readText();
      if (text && operation.isCurrent()) commit(text);
    } catch {
      if (operation.isCurrent()) this.host.failed();
    } finally {
      operation.finish();
    }
  }

  destroy() { this.revision++; }
}
