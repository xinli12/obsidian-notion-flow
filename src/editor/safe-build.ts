import { Notice } from "obsidian";
import { t } from "../i18n";

/* An error boundary for decoration builders and other per-update work.
 *
 * CodeMirror disables a ViewPlugin whose update() throws, silently and for
 * the rest of the editor's life, so one bad line in a document used to turn
 * a whole feature off with no trace. guard() keeps the plugin alive: the
 * failing builder yields its fallback (usually an empty decoration set) for
 * that update, the error reaches the console once per label so it can be
 * reported, and one Notice per session tells the person something is off. */

/** Labels already reported this session: the console gets each once. */
const reportedLabels = new Set<string>();
let noticeShown = false;

function report(label: string, err: unknown): void {
  if (!reportedLabels.has(label)) {
    reportedLabels.add(label);
    console.error("Notion Flow: " + label, err);
  }
  if (noticeShown) return;
  noticeShown = true;
  try {
    new Notice(t("Notion Flow hit an error; some decorations are paused this session. See the developer console."), 8000);
  } catch {
    /* no UI here (tests, teardown): the console line is enough */
  }
}

/** Run `fn`; on a throw, log it once per label, show one Notice per session
 * and return `fallback()` instead, so the caller keeps working. */
export function guard<T>(label: string, fallback: () => T, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    report(label, err);
    return fallback();
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | null)?.then === "function";
}

/** Wrap a callback that runs later (requestAnimationFrame, setTimeout,
 * event handlers) so a throw, or a rejected promise it returns, is reported
 * the same way instead of surfacing as an uncaught error. */
export function guardAsync<A extends unknown[]>(
  label: string,
  fn: (...args: A) => void | PromiseLike<void>
): (...args: A) => void {
  return (...args: A) => {
    try {
      const result = fn(...args);
      if (isThenable(result)) result.then(undefined, (err: unknown) => report(label, err));
    } catch (err) {
      report(label, err);
    }
  };
}
