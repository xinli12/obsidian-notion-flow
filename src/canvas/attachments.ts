import type { CanvasNodeData } from "./graph";

/**
 * A card's notes: Markdown kept out of sight until its icon is clicked, as
 * in mind-map apps. One note is stored as a string, several as a list.
 */
export const NOTE_KEY = "nfNote";
/**
 * A card's links, each followed by clicking its icon: a web address, a note
 * written as a wikilink (`[[Note#Heading]]`), or `#` and the id of another
 * card on the same canvas. One link is stored as a string, several as a list.
 */
export const LINK_KEY = "nfLink";

export type CardLink =
  | { kind: "url"; url: string }
  | { kind: "note"; linktext: string; path: string; subpath: string; display: string }
  | { kind: "card"; id: string };

/** A URL scheme, two letters at least so that a Windows drive is not one. */
const SCHEME = /^[a-z][a-z0-9+.-]+:/i;
/** Schemes that run code or carry a document of their own instead of opening a page. */
const BLOCKED = /^(?:javascript|vbscript|data|blob):/i;
const WIKILINK = /^!?\[\[([^\][]+)\]\]$/;
/** A card id a link can carry: letters, digits, dashes and underscores (Canvas makes hex ones). */
const CARD_ID = /^[\w-]+$/;

/** The name a note link shows: the note's name, and the heading or block it points into. */
function noteDisplay(path: string, subpath: string): string {
  const name = (path.split("/").pop() ?? path).replace(/\.md$/i, "");
  const heading = subpath.replace(/^#\^?/, "").trim();
  return name && heading ? `${name} › ${heading}` : name || heading;
}

/** A card's id after `#` or `#^`, when it could be one. */
function cardId(ref: string): string | null {
  const id = ref.replace(/^#\^?/, "").trim();
  return id && CARD_ID.test(id) ? id : null;
}

/**
 * A stored link as what it points at; anything unusable reads as no link.
 * A wikilink into this canvas itself (`[[#^id]]`, as a card's words link a
 * card) is a link to that card.
 */
export function parseCardLink(value: unknown): CardLink | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (text.startsWith("#")) {
    const id = cardId(text);
    return id ? { kind: "card", id } : null;
  }
  const wiki = WIKILINK.exec(text);
  if (!wiki && (text.includes("[[") || text.includes("]]"))) return null;
  if (wiki || !SCHEME.test(text)) {
    const inner = (wiki ? wiki[1] : text).trim();
    const bar = inner.indexOf("|");
    const linktext = (bar < 0 ? inner : inner.slice(0, bar)).trim();
    const alias = bar < 0 ? "" : inner.slice(bar + 1).trim();
    if (!linktext) return null;
    const hash = linktext.indexOf("#");
    const path = hash < 0 ? linktext : linktext.slice(0, hash);
    const subpath = hash < 0 ? "" : linktext.slice(hash);
    if (wiki && !path.trim()) {
      const id = cardId(subpath);
      return id ? { kind: "card", id } : null;
    }
    return { kind: "note", linktext, path, subpath, display: alias || noteDisplay(path, subpath) };
  }
  return BLOCKED.test(text) ? null : { kind: "url", url: text };
}

/** A field that holds one text or several, read as a list; anything else in it is left out. */
function storedList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * The node with a list field set: none removes the field, one is kept as a
 * string (as a card with one link or note always kept it), several as a list.
 */
function withList(node: CanvasNodeData, key: string, values: readonly string[]): CanvasNodeData {
  const next = { ...node };
  if (!values.length) delete next[key];
  else next[key] = values.length === 1 ? values[0] : [...values];
  return next;
}

/** Links as they should be kept: usable, trimmed, each once, in order. */
function cleanLinks(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value || seen.has(value) || !parseCardLink(value)) continue;
    seen.add(value);
    clean.push(value);
  }
  return clean;
}

/** A card's links as stored, in order; unusable and repeated ones are left out. */
export function linkValues(node: { [key: string]: unknown } | undefined): string[] {
  return cleanLinks(storedList(node?.[LINK_KEY]));
}

/** A card's links, in order. */
export function linksOf(node: { [key: string]: unknown } | undefined): CardLink[] {
  return linkValues(node).map((value) => parseCardLink(value)!);
}

/** A card's first link. */
export function linkOf(node: { [key: string]: unknown } | undefined): CardLink | null {
  return linksOf(node)[0] ?? null;
}

/** A card's notes with words in them, in order. */
export function notesOf(node: { [key: string]: unknown } | undefined): string[] {
  return storedList(node?.[NOTE_KEY]).filter((note) => note.trim().length > 0);
}

/** A card's notes as one text, for finding words in them. */
export function noteOf(node: { [key: string]: unknown } | undefined): string {
  return notesOf(node).join("\n\n");
}

/** Whether a card carries a note with any words in it. */
export function hasNote(node: { [key: string]: unknown } | undefined): boolean {
  return notesOf(node).length > 0;
}

/**
 * The node as it should be saved with these notes: blank ones are dropped,
 * trailing space too, and without any the field goes.
 */
export function withNotes(node: CanvasNodeData, notes: readonly string[]): CanvasNodeData {
  const clean = notes.map((note) => note.replace(/\s+$/, "")).filter((note) => note.trim());
  return withList(node, NOTE_KEY, clean);
}

/** The node with this as its only note; blank words remove every note. */
export function withNote(node: CanvasNodeData, text: string): CanvasNodeData {
  return withNotes(node, [text]);
}

/** Whether two cards keep the same notes. */
export function sameNotes(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((note, index) => note === b[index]);
}

/** The node as it should be saved with these links: unusable and repeated ones are dropped, none removes the field. */
export function withLinks(node: CanvasNodeData, values: readonly string[]): CanvasNodeData {
  return withList(node, LINK_KEY, cleanLinks(values));
}

/** The node with this as its only link; null or an unusable link removes every link. */
export function withLink(node: CanvasNodeData, value: string | null): CanvasNodeData {
  return withLinks(node, value === null ? [] : [value]);
}

/**
 * The node with its `index`-th link replaced by `value`, or taken away with
 * null; past the last link, `value` is added after the others. A link the
 * card already has elsewhere is kept once, where it was first.
 */
export function withLinkAt(node: CanvasNodeData, index: number, value: string | null): CanvasNodeData {
  const values = linkValues(node);
  if (index >= 0 && index < values.length) {
    if (value === null) values.splice(index, 1);
    else values[index] = value;
  } else if (value !== null) values.push(value);
  return withLinks(node, values);
}

/** Whether two cards keep the same links, in the same order. */
export function sameLinks(a: { [key: string]: unknown } | undefined, b: { [key: string]: unknown } | undefined): boolean {
  const left = linkValues(a);
  const right = linkValues(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** How a link to a note is stored. */
export function noteLinkValue(linktext: string): string {
  return `[[${linktext.replace(/^\[\[|\]\]$/g, "").trim()}]]`;
}

/** How a link to another card is stored. */
export function cardLinkValue(id: string): string {
  return `#${id}`;
}

/** Whether a card's id can be written into a link. */
export function linkableCardId(id: string): boolean {
  return CARD_ID.test(id);
}

/**
 * A link to a card as it is written into a card's words: `[[#^id|Name]]`,
 * a link to a block of this canvas, or `[Name](#^id)` where the vault writes
 * Markdown links. The name is only the link's text; the id finds the card.
 */
export function cardLinkText(id: string, name: string, markdown = false): string {
  const label = name.replace(/[[\]|\r\n]+/g, " ").replace(/\s+/g, " ").trim() || id;
  return markdown ? `[${label}](#^${id})` : `[[#^${id}|${label}]]`;
}

/**
 * The card a link in a card's words names: `#^id` or `#id`, and the path
 * before it, which is empty for this canvas. Null when it names no card.
 */
export function cardRefOf(href: string): { path: string; id: string } | null {
  const text = href.trim();
  const hash = text.indexOf("#");
  if (hash < 0) return null;
  const id = cardId(text.slice(hash));
  return id ? { path: text.slice(0, hash).trim(), id } : null;
}

/**
 * A card's words with its links to other cards written as their names,
 * for outlines and notes, where the cards of this canvas cannot be reached.
 */
export function withoutCardLinks(text: string): string {
  return text
    .replace(/\[\[#\^?[\w-]+\|([^\]\n]+)\]\]/g, "$1")
    .replace(/\[\[#\^?([\w-]+)\]\]/g, "$1")
    .replace(/(?<!!)\[([^\]\n]*)\]\(#\^?[\w-]+\)/g, "$1");
}

/**
 * The web address typed text means, if any: a URL with its scheme, or a
 * bare `www.` or domain address, which gets `https://`. `explicit` says
 * whether the text left no doubt; a bare domain could also be a file name.
 */
export function webAddress(text: string): { url: string; explicit: boolean } | null {
  let value = text.trim();
  if (value.startsWith("<") && value.endsWith(">")) value = value.slice(1, -1).trim();
  if (!value || /\s/.test(value)) return null;
  if (SCHEME.test(value)) return BLOCKED.test(value) || /^[a-z][a-z0-9+.-]*:\d/i.test(value) ? null : { url: value, explicit: true };
  if (/^www\.[^./]+\.[^/]/i.test(value)) return { url: `https://${value}`, explicit: true };
  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}(?::\d{2,5})?(?:[/?#]\S*)?$/i.test(value)) return { url: `https://${value}`, explicit: false };
  return null;
}

// A task list item, in a list, a quote or a Callout; fenced code holds none.
const TASK_ITEM = /^([ \t>]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)(.)(\](?:[ \t]|$))/;
const FENCE = /^[ \t>]*(`{3,}|~{3,})/;

/**
 * The note with its `index`-th task ticked or cleared, counting tasks in
 * the order a rendered note shows their checkboxes; null when there is no
 * such task. A task marked with anything but a space counts as done.
 */
export function toggleTask(markdown: string, index: number): string | null {
  const lines = markdown.split("\n");
  let fence: string | null = null;
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const opening = FENCE.exec(lines[i]);
    if (fence !== null) {
      if (opening && opening[1][0] === fence[0] && opening[1].length >= fence.length) fence = null;
      continue;
    }
    if (opening) {
      fence = opening[1];
      continue;
    }
    const task = TASK_ITEM.exec(lines[i]);
    if (!task || seen++ !== index) continue;
    lines[i] = `${task[1]}${task[2] === " " ? "x" : " "}${task[3]}${lines[i].slice(task[0].length)}`;
    return lines.join("\n");
  }
  return null;
}

/**
 * A card's notes and links in an outline: the first link wraps the topic's
 * words when they are plain (`[Topic](url)`, `[[Note|Topic]]`), and the
 * rest follow them; the notes hang under the item as a quote, one paragraph
 * each. Links between cards mean nothing outside the canvas and are left out.
 */
export function outlineAttachments(first: string, node: { [key: string]: unknown }): { first: string; note: string[] } {
  const links = linksOf(node).filter((link) => link.kind !== "card");
  const plain = !!first.trim() && !/[[\]()|<>\x60]/.test(first) && !/^[-*+] \[[ xX]\] /.test(first);
  // Spaces and brackets would end a Markdown destination early.
  const dest = (url: string) => /[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url;
  let line = first;
  links.forEach((link, index) => {
    if (index === 0 && plain) line = link.kind === "url" ? `[${first}](${dest(link.url)})` : `[[${link.linktext}|${first}]]`;
    else line = `${line} ${link.kind === "url" ? `[↗](${dest(link.url)})` : `[[${link.linktext}]]`}`.trimStart();
  });
  const note: string[] = [];
  notesOf(node).forEach((text, index) => {
    if (index > 0) note.push(">");
    for (const row of text.replace(/\s+$/, "").split("\n")) note.push(row ? `> ${row}` : ">");
  });
  return { first: line, note };
}
