import { isRelation, orderedChildren } from "./graph";
import type { CanvasData, CanvasNodeData, Forest } from "./graph";
import { outlineAttachments, withoutCardLinks } from "./attachments";

/** One card of an outline: its Markdown text and the cards below it. */
export interface OutlineItem {
  text: string;
  children: OutlineItem[];
}

export interface Outline {
  /** Text before the first heading or list item. */
  lead: string;
  items: OutlineItem[];
  /** Unindented paragraphs after the outline, kept with the lead. */
  trail: string;
}

const LIST = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const HEADING = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^[ \t]*(`{3,}|~{3,})/;
const TASK = /^\[[ xX]\][ \t]/;

function columns(indent: string): number {
  let width = 0;
  for (const ch of indent) width += ch === "\t" ? 4 - (width % 4) : 1;
  return width;
}

/** Remove up to `width` columns of leading whitespace. */
function dedent(line: string, width: number): string {
  let used = 0;
  let i = 0;
  while (i < line.length && used < width && (line[i] === " " || line[i] === "\t")) {
    used += line[i] === "\t" ? 4 - (used % 4) : 1;
    i++;
  }
  return line.slice(i);
}

/**
 * Read headings and (nested) list items as a tree. Headings nest by level,
 * list items by indentation and below the nearest heading. Indented or
 * directly following lines continue the item above them, and fenced code
 * stays inside its item. Returns null when there is no outline.
 */
export function parseOutline(markdown: string): Outline | null {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const lead: string[] = [];
  const trail: string[] = [];
  const items: OutlineItem[] = [];
  const stack: { key: number; item: OutlineItem; content: number }[] = [];
  // Closures below update this, so keep it out of control-flow narrowing.
  const state: { current: { item: OutlineItem; content: number } | null } = { current: null };
  let headingKey = 0;
  let blank = false;
  let fence: string | null = null;

  const add = (key: number, text: string, content: number) => {
    while (stack.length && stack[stack.length - 1].key >= key) stack.pop();
    const item: OutlineItem = { text, children: [] };
    (stack.length ? stack[stack.length - 1].item.children : items).push(item);
    stack.push({ key, item, content });
    state.current = { item, content };
    blank = false;
  };
  const extend = (target: { item: OutlineItem; content: number }, line: string) => {
    const text = dedent(line, target.content);
    target.item.text += target.item.text ? `${blank ? "\n\n" : "\n"}${text}` : text;
    blank = false;
  };

  for (const line of lines) {
    if (fence !== null) {
      if (state.current) extend(state.current, line); else lead.push(line);
      if (line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (!line.trim()) {
      blank = true;
      if (!items.length) lead.push(line);
      continue;
    }
    const opening = FENCE.exec(line);
    const heading = HEADING.exec(line);
    const list = LIST.exec(line);
    if (heading && !opening) {
      headingKey = heading[1].length * 1000;
      add(headingKey, line.trim(), 0);
      continue;
    }
    if (list && !opening) {
      const indent = columns(list[1]);
      const body = list[3] ?? "";
      // Tasks keep their marker so the card still renders a checkbox.
      const text = TASK.test(body) ? `- ${body}` : body;
      add(headingKey + 1 + indent, text, indent + list[2].length + 1);
      continue;
    }
    if (opening) fence = opening[1];
    const target = state.current;
    if (!target) lead.push(line);
    else if (!blank || columns(/^[ \t]*/.exec(line)![0]) >= target.content) extend(target, line);
    else trail.push(line);
  }
  if (!items.length) return null;
  return { lead: lead.join("\n").trim(), items, trail: trail.join("\n").trim() };
}

export function countOutline(items: OutlineItem[]): number {
  let count = 0;
  const pending = [...items];
  while (pending.length) {
    const item = pending.pop()!;
    count++;
    pending.push(...item.children);
  }
  return count;
}

/** The Markdown a card contributes to an outline. */
export function cardText(node: CanvasNodeData): string {
  switch (node.type) {
    case "text": return typeof node.text === "string" ? node.text : "";
    case "file": {
      const file = typeof node.file === "string" ? node.file : "";
      const subpath = typeof node.subpath === "string" ? node.subpath : "";
      return file ? `[[${file.replace(/\.md$/i, "")}${subpath}]]` : "";
    }
    case "link": return typeof node.url === "string" ? node.url : "";
    case "group": return typeof node.label === "string" ? node.label : "";
    default: return "";
  }
}

function freeChildren(data: CanvasData, id: string, seen: Set<string>): string[] {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const children: string[] = [];
  for (const edge of data.edges) {
    if (edge.fromNode !== id || isRelation(edge) || seen.has(edge.toNode)) continue;
    const child = nodes.get(edge.toNode);
    if (!child || child.type === "group") continue;
    seen.add(child.id);
    children.push(child.id);
  }
  return children.sort((a, b) => nodes.get(a)!.y - nodes.get(b)!.y || nodes.get(a)!.x - nodes.get(b)!.x);
}

/**
 * A branch as a nested Markdown list, in reading order. Mind maps use their
 * tree (folded cards included); other cards follow unlabelled connections.
 * A card's links go with its words and its notes hang under it as a quote;
 * links to other cards in its words keep only their names.
 */
export function branchOutline(data: CanvasData, forest: Forest, rootId: string): { markdown: string; count: number } {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  if (!nodes.has(rootId)) return { markdown: "", count: 0 };
  const inMap = forest.nodes.has(rootId);
  const seen = new Set([rootId]);
  const lines: string[] = [];
  const pending: [string, number][] = [[rootId, 0]];
  let count = 0;
  while (pending.length) {
    const [id, depth] = pending.pop()!;
    count++;
    const indent = "\t".repeat(depth);
    const node = nodes.get(id)!;
    const text = withoutCardLinks(cardText(node)).split("\n").filter((line) => line.trim());
    const { first, note } = outlineAttachments((text.shift() ?? "").replace(/^#{1,6}[ \t]+/, ""), node);
    lines.push(/^[-*+] \[[ xX]\] /.test(first) ? indent + first : `${indent}- ${first}`);
    for (const line of [...text, ...note]) lines.push(`${indent}  ${line}`);
    const children = inMap ? orderedChildren(data, forest, id) : freeChildren(data, id, seen);
    for (let i = children.length - 1; i >= 0; i--) pending.push([children[i], depth + 1]);
  }
  return { markdown: lines.join("\n"), count };
}

/** A card's text as a map topic: its hierarchy comes from the map, not heading marks. */
export function topicText(text: string): string {
  return text.replace(/^#{1,6}[ \t]+/, "");
}

/**
 * A note as a mind map: the note is its central topic, linked so the map
 * leads back to it, and its headings and lists are the branches. A note with
 * one top-level heading uses that heading as the topic's name.
 */
export function noteOutline(markdown: string, link: string): { root: string; items: OutlineItem[] } | null {
  const body = markdown.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "");
  const outline = parseOutline(body);
  if (!outline) return null;
  const safe = (text: string) => text.replace(/[[\]|]/g, " ").replace(/\s+/g, " ").trim();
  if (!outline.lead && !outline.trail && outline.items.length === 1) {
    const [top] = outline.items;
    const [first, ...rest] = top.text.split("\n");
    const title = safe(first.replace(/^#{1,6}[ \t]+/, "").replace(/^[-*+][ \t]+\[[ xX]\][ \t]+/, ""));
    const note = rest.join("\n").trim();
    const root = `[[${link}${title ? `|${title}` : ""}]]${note ? `\n\n${note}` : ""}`;
    return { root, items: top.children };
  }
  const items = [...outline.items];
  if (outline.lead) items.unshift({ text: outline.lead, children: [] });
  if (outline.trail) items.push({ text: outline.trail, children: [] });
  return { root: `[[${link}]]`, items };
}

/** A file name from a card's words, safe on every platform. */
export function noteFileName(label: string, fallback: string): string {
  const name = label.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80).trim();
  return name.replace(/^\.+/, "") || fallback;
}
