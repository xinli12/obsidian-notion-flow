import { ViewPlugin, type EditorView } from "@codemirror/view";

export interface EditorOperation {
  isCurrent(): boolean;
  finish(): void;
  cancel(): void;
}

interface OperationOptions {
  /** Titles may survive unrelated typing; destructive edits may not. */
  sameDocument?: boolean;
  valid?(): boolean;
  onCancel?(): void;
}

/** Own deferred edits and UI for one plugin instance. File identity and
 * immutable document identity are separate: an editor can be reused by a
 * different note, including one with identical text at identical offsets. */
export class EditorOperationScope {
  private pending = new Map<EditorOperation, EditorView>();
  private disposed = false;

  capture(view: EditorView, identity: () => unknown, options: OperationOptions = {}): EditorOperation {
    const owner = identity();
    const doc = options.sameDocument === false ? null : view.state.doc;
    let active = !this.disposed && !!owner;
    const finish = () => { active = false; this.pending.delete(operation); };
    const operation: EditorOperation = {
      isCurrent: () => {
        if (!active) return false;
        if (this.disposed || !view.dom.isConnected || identity() !== owner ||
          (doc !== null && view.state.doc !== doc) || options.valid?.() === false) {
          operation.cancel();
          return false;
        }
        return true;
      },
      finish,
      cancel: () => {
        if (!active) return;
        finish();
        options.onCancel?.();
      },
    };
    if (active) this.pending.set(operation, view);
    return operation;
  }

  check(view?: EditorView) {
    for (const [operation, owner] of this.pending) {
      if (!view || owner === view) operation.isCurrent();
    }
  }

  cancelOwner(view: EditorView) {
    for (const [operation, owner] of this.pending) {
      if (owner === view) operation.cancel();
    }
  }

  dispose() {
    this.disposed = true;
    for (const operation of this.pending.keys()) operation.cancel();
  }
}

/** Close stale popovers immediately on edits, file replacement or teardown. */
export function operationLifecycle(scope: EditorOperationScope) {
  return ViewPlugin.fromClass(class {
    constructor(private view: EditorView) {}
    update() { scope.check(this.view); }
    destroy() { scope.cancelOwner(this.view); }
  });
}
