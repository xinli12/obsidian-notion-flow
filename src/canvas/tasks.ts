import { descendants } from "./graph";
import type { CanvasData, Forest } from "./graph";

export interface TaskCount {
  done: number;
  total: number;
}

/**
 * Results by input text, for words that are read again on every refresh.
 * The newest `limit` texts are kept, so a long session cannot grow it.
 */
export class TextCache<T> {
  private entries = new Map<string, T>();

  constructor(private compute: (text: string) => T, private limit = 2000) {}

  get(text: string): T {
    const hit = this.entries.get(text);
    if (hit !== undefined) return hit;
    const value = this.compute(text);
    this.entries.set(text, value);
    if (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value as string);
    return value;
  }

  get size(): number {
    return this.entries.size;
  }

  clear() {
    this.entries.clear();
  }
}

// A Markdown task: "- [ ] …", "* [x] …", "1. [ ] …", also inside quotes.
const TASK = /^[ \t>]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[(.)\](?:[ \t]|$)/;
const FENCE = /^[ \t>]*(`{3,}|~{3,})/;

/**
 * Tasks in a card's Markdown. "[x]" is done and "[-]" cancelled, which
 * counts toward nothing; any other mark ("[ ]", "[/]" in progress, …) is
 * still to do. Code blocks are skipped.
 */
export function countTasks(markdown: string): TaskCount {
  const count = { done: 0, total: 0 };
  let fence: string | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const opener = FENCE.exec(line);
    if (opener) {
      if (!fence) fence = opener[1][0];
      else if (opener[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const task = TASK.exec(line);
    if (!task || task[1] === "-") continue;
    count.total++;
    if (task[1] === "x" || task[1] === "X") count.done++;
  }
  return count;
}

/**
 * Progress to show on cards: a map card with children sums the tasks in
 * its whole branch, folded parts included; any other card with two or
 * more tasks shows its own, since one task's checkbox already speaks for
 * itself. `own` gives a card's own tasks, for cards whose Markdown lives
 * elsewhere (a note on a file card).
 */
export function taskProgress(
  data: CanvasData, forest: Forest, own: (id: string) => TaskCount | null = () => null,
): Map<string, TaskCount> {
  const counts = new Map<string, TaskCount>();
  for (const node of data.nodes) {
    const count = own(node.id) ?? (node.type === "text" ? countTasks(String(node.text ?? "")) : null);
    if (count?.total) counts.set(node.id, count);
  }
  const progress = new Map<string, TaskCount>();
  for (const node of data.nodes) {
    const info = forest.nodes.get(node.id);
    const mine = counts.get(node.id);
    if (info?.children.length) {
      const sum = { done: mine?.done ?? 0, total: mine?.total ?? 0 };
      for (const id of descendants(forest, node.id)) {
        const count = counts.get(id);
        if (!count) continue;
        sum.done += count.done;
        sum.total += count.total;
      }
      if (sum.total) progress.set(node.id, sum);
    } else if (mine && mine.total >= 2) {
      progress.set(node.id, mine);
    }
  }
  return progress;
}
