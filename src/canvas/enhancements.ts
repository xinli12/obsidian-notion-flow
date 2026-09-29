import { Component, Keymap, MarkdownRenderer, Menu, Notice, Plugin, Scope, TFile, setIcon } from "obsidian";
import type { App, HoverParent, KeymapEventHandler, PaneType } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { t } from "../i18n";
import {
  ALIGN_KEY, BOUNDARY_KEY, BRANCH_KEY, COLLAPSED_KEY, LAYOUT_KEY, SPACING_KEY, SUMMARY_KEY, boundaryBoxes, bracePath,
  branchLayout, buildBranch, buildForest, crossAxis, descendants, findDirectionalNeighbor, findNewNodePosition, findParent,
  hasBoundary, hiddenNodes, hiddenSummaries, isCollapsed, isRelation, isSummary, mapAlign, mapLayout, mapMembers, mapNeighbor,
  mapSpacing, orderedChildren, planBranchColor, planBranchColors, planFreeCard, planLevels, planMapInsertion, planMapLayout,
  planSiblingMove, roomBelow, sidesFor, spacingGaps, summaryBraces, summaryIndex, summaryLink,
} from "./graph";
import type {
  CanvasData, CanvasEdgeData, CanvasNodeData, Direction, Flow, Forest, MapAlign, MapInsertion, MapLayout, MapLayoutPlan,
  MapSpacing, Position, Rectangle, Summary, TreeNode,
} from "./graph";
import { Minimap, minimapSupported } from "./minimap";
import type { MinimapItem } from "./minimap";
import { LINE_KEY, anchor, asLineChoice, linePath, lineStyleFor, organicWidths } from "./lines";
import type { LineChoice, LineStyle } from "./lines";
import { MOTION_LIMIT, MOTION_MS, Motion } from "./motion";
import { branchOutline, countOutline, noteFileName, noteOutline, parseOutline, topicText } from "./outline";
import type { OutlineItem } from "./outline";
import { Stage, canvasSteps, mapSteps } from "./presentation";
import type { StageHost } from "./presentation";
import { CardSearchModal, FindBar, NotePickerModal, cardLabel, cardTitle, findCards, plainText } from "./search";
import type { CardHit } from "./search";
import { TextCache, countTasks, taskProgress } from "./tasks";
import type { TaskCount } from "./tasks";
import {
  APPEARANCE_PRESETS, CANVAS_FONTS, CANVAS_SHAPES, CUSTOM_PALETTE, FONT_KEY, LINE_WEIGHT_KEY, LINE_WEIGHT_SCALE, MAP_STYLES,
  PALETTE_COLORS_KEY, PALETTE_KEY, SHAPE_KEY, TEXT_SCALE_FACTOR, TEXT_SCALE_KEY, appearancePreset, asCanvasFont, asCanvasShape,
  asLineWeight, asMapStyle, asPaletteId, asTextScale, colorSupport, customPalette, isRichText, paletteColorsFrom, planAutoColors,
  presetColors, safeCanvasColor,
} from "./appearance";
import type {
  AppearancePreset, AppearancePresetId, AutoColorPlan, CanvasFont, CanvasLineWeight, CanvasMapStyle, CanvasShape, CanvasTextScale,
  ColorSupport, PaletteColors,
} from "./appearance";
import { USER_SCHEME_LIMIT, SCHEME_NAME_MAX, newSchemeId, suggestSchemeName, userSchemesFrom } from "./schemes";
import type { CanvasUserScheme } from "./schemes";
import { resolveColor } from "./color-probe";
import { BranchColorPanel, RECENT_COLOR_KEY } from "./color-panel";
import { STYLE_SECTIONS_KEY, StylePanel, paletteDots, presetThumbnail } from "./style-panel";
import type { StylePanelState, StylePatch } from "./style-panel";
import { BOXLESS_MIN_WIDTH, blankTopicSize, fittedCardSize } from "./sizing";
import type { CanvasCardSizeMode } from "./sizing";
import { HUG_SLACK, measureCard } from "./measurement";
import { CanvasEditorSurface } from "./editor-surface";
import type { EditorGeometry } from "./editor-surface";
import { linkAt, linkTargetAt, markdownOwnsKeys, withoutTrailingBlank } from "./editor-keys";
import { applyTopicTypography, clearTopicTypography } from "./typography";
import { MarkerPanel, NUMBERING_KEY, RECENT_EMOJI_KEY, hasNumbering, markerBadge, markerById, markersOf, toggleMarker, topicNumbers, withMarkers } from "./markers";
import { connectionSides, planChain, planConnection, previewPath, sideToward } from "./connect";
import { HelpPanel, keyLabel } from "./help";
import { LayoutPanel } from "./layout-panel";
import type { LayoutPanelState, LayoutPatch } from "./layout-panel";
import { anchorBeside, panelShift, roomyView, sameView } from "./placement";
import type { ScreenRect, ViewState } from "./placement";
import {
  cardLinkText, cardRefOf, hasNote, linkValues, linkableCardId, linksOf, noteOf, notesOf, sameLinks, sameNotes, withLinkAt,
  withLinks, withNotes,
} from "./attachments";
import type { CardLink } from "./attachments";
import { NotePanel } from "./note-panel";
import type { ScreenBox } from "./note-panel";
import { CardLinkModal } from "./link-picker";
import type { LinkableCard } from "./link-picker";
import { CardLinkSuggest } from "./card-links";

export type { CanvasMapStyle } from "./appearance";
/** A map's look, stored on its root. */
export const THEME_KEY = "nfTheme";
/** Link icons a card shows at most; past that, the last one lists them all. */
const LINK_CHIPS = 3;
/** How long a canvas stays empty before the onboarding panel shows, in ms: a file being read has no cards yet. */
const EMPTY_PANEL_DELAY = 400;
/** Page previews of the notes cards link to, listed under this name in the Page preview settings. */
export const HOVER_SOURCE = "notion-flow";

export interface CanvasSettings {
  canvasEnhancements: boolean;
  canvasAppearance: boolean;
  canvasKeyboard: boolean;
  /** While typing in a card, Enter finishes it and Shift+Enter breaks the line; Tab finishes and adds a child. */
  canvasEditorKeys?: boolean;
  /** Keep mind maps tidy after edits, drags, deletions, and folding. */
  canvasAutoLayout: boolean;
  /** Fit mind-map text cards to their text when editing ends. */
  canvasAutoFit: boolean;
  /** A card grows in place while it is typed in, and keeps the room its words need. */
  canvasComfortableEdit?: boolean;
  canvasCardSize?: string;
  /** Glide cards to their new places instead of jumping. */
  canvasAnimation?: boolean;
  /** Show an overview of the canvas when part of it is off screen. */
  canvasMinimap?: boolean;
  /** How mind-map topics look: filled root and plain subtopics, or cards throughout. */
  canvasMapStyle?: string;
  /** How mind-map branch lines are drawn, for maps without a style of their own. */
  canvasLineStyle?: string;
  /** The typeface of maps without one of their own. */
  canvasFont?: string;
  /** The card outline, line weight and text size of maps without their own. */
  canvasShape?: string;
  canvasLineWeight?: string;
  canvasTextScale?: string;
  /** The dot pattern behind the canvas: dots, faint dots, or none. */
  canvasBackground?: string;
  /** Show how many of a branch's tasks are done. */
  canvasTaskProgress?: boolean;
  /** The preset paired with the note palette, for maps without a palette of their own; display only, never stored in a canvas. Supplied by the plugin, not a saved setting. */
  canvasFallbackPalette?: string | null;
  /** The schemes saved with "Save as my scheme"; always read through userSchemesFrom. */
  canvasUserSchemes?: unknown;
}

// Canvas has no public editing API. Keep its checked, optional integration
// behind one adapter; no prototype patches and no direct vault writes. The
// one instance override — a map connection's path — is removed on unload.
interface LiveNode {
  id: string;
  nodeEl: HTMLElement;
  x?: number;
  y?: number;
  canvas?: unknown;
  isEditing?: boolean;
  child?: { getMode?(): string; editMode?: { cm?: EditorView }; showPreview?(save?: boolean): void };
  getData(): CanvasNodeData;
  moveTo(pos: { x: number; y: number }): void;
  resize?(size: { width: number; height: number }): void;
  onResizeDblclick?(evt: { preventDefault(): void }, side: string): void;
  attach?(): void;
  render?(): void;
  startEditing?(): void;
  setIsEditing?(editing: boolean): void;
}
interface EdgeEnd {
  node?: { getBBox?(): Box };
  side?: string;
}
interface LiveEdge {
  getData(): CanvasEdgeData;
  setData(data: CanvasEdgeData): void;
  lineGroupEl?: SVGElement;
  lineEndGroupEl?: SVGElement;
  labelElement?: { wrapperEl: HTMLElement };
  from?: EdgeEnd;
  to?: EdgeEnd;
  /** What Canvas draws, and the wider invisible path the pointer grabs. */
  path?: { display?: SVGElement; interaction?: SVGElement };
  updatePath?(): void;
  select?(): void;
}
export interface LiveCanvas {
  wrapperEl: HTMLElement;
  nodes: Map<string, LiveNode>;
  edges: Map<string, LiveEdge>;
  selection: Set<LiveNode | LiveEdge>;
  readonly?: boolean;
  isDragging?: boolean;
  /** Screen pixels per canvas unit. */
  scale?: number;
  /** The dot grid's spacing at this zoom, in canvas units. */
  gridSpacing?: number;
  getData(): CanvasData;
  importData(data: CanvasData, clear: boolean): unknown;
  /** Save soon; with `false`, without recording an undo step. */
  requestSave(pushHistory?: boolean): void;
  requestPushHistory: { run(): void; cancel?(): void };
  history: { data: CanvasData[]; current: number };
  pushHistory(data: CanvasData): void;
  overrideHistory?(): void;
  selectOnly(item: LiveNode | LiveEdge): void;
  selectAll?(items: Iterable<LiveNode>): void;
  deselect?(item: LiveNode | LiveEdge): void;
  removeEdge?(edge: LiveEdge): void;
  removeNode?(node: LiveNode): void;
  posFromEvt?(evt: { clientX: number; clientY: number }): { x: number; y: number };
  zoomToBbox?(box: Box): void;
  panIntoView?(box: Box): void;
  getViewportBBox?(): Box;
  /** The view shown now: the canvas point at the wrapper's middle, and the log2 of the scale. */
  x?: number;
  y?: number;
  zoom?: number;
  /** The view Canvas glides toward once `markViewportChanged` is called. */
  tx?: number;
  ty?: number;
  tZoom?: number;
  zoomCenter?: unknown;
  markViewportChanged?(): void;
  /** Canvas's snapping choices, shared with the core plugin, which saves them. */
  options?: { snapToObjects?: boolean; snapToGrid?: boolean };
  /** The native floating menu above the selection. */
  menu?: { menuEl?: HTMLElement; render?(rebuild: boolean): void };
  /** What Canvas last saved, replaced on every save. */
  data?: unknown;
  /** The SVG layer that holds the connections, in canvas coordinates. */
  edgeContainerEl?: SVGElement;
  /** The plane the cards sit on; panning and zooming change its transform. */
  canvasEl?: HTMLElement;
  deselectAll?(): void;
}
interface CanvasView {
  canvas?: LiveCanvas;
  scope?: Scope | null;
  file?: { path: string } | null;
}
type Box = { minX: number; minY: number; maxX: number; maxY: number };
type ScopeKey = KeymapEventHandler & { key: string | null; modifiers: string | null; func: (evt: KeyboardEvent, ctx: unknown) => unknown };

export type Action =
  | "child" | "sibling" | "siblingBefore" | "parent" | "edit" | MapLayout | "release"
  | "fold" | "foldAll" | "unfoldAll" | "focus" | "reset" | "colors" | "uncolor" | `theme-${CanvasMapStyle}` | "outline"
  | "explode" | "fit" | "selectBranch" | "moveUp" | "moveDown"
  | "search" | "find" | "minimap" | "insertNote" | "exportNote" | MapSpacing
  | `line-${LineChoice}` | "boundary" | `level-${1 | 2 | 3}` | "present"
  | "presets" | `preset-${AppearancePresetId}` | "palette-off" | "palette-follow" | `font-${CanvasFont}`
  | "connect" | "markers" | "numbering" | "help" | "newTopic" | "summary"
  | `shape-${CanvasShape}` | `weight-${CanvasLineWeight}` | `scale-${CanvasTextScale}`
  | `branch-${MapLayout | "inherit"}` | `align-${MapAlign}`
  | "deleteBranch" | "outdent" | "indent" | "colorBranch" | "presentFrom"
  | "note" | "addNote" | "link" | "openLink" | "removeLink" | "removeNote" | "insertCardLink" | "copyCardLink";
type KeyAction = "child" | "sibling" | "siblingBefore" | "parent" | "reset" | "edit" | "fold" | "search" | "find"
  | Direction | "moveUp" | "moveDown" | "deleteBranch" | "outdent" | "indent" | "note" | "addNote" | "link";

/**
 * A new card of its own, or a new topic where cards are not fitted to their
 * words: one line of text, wide enough to type into. A topic that is fitted
 * opens at the size it becomes (newTopicBox).
 */
const TOPIC = { width: 240, height: 60 };
/** The schemes the empty canvas offers to start a map in: one per look, each with designed dark tones. */
export const STARTER_PRESETS = ["mist", "sakura", "nord", "guose", "vivid", "aurora"] as const satisfies readonly AppearancePresetId[];
/** One line of words, Latin and CJK, for measuring the height a one-line topic takes. */
const ONE_LINE_SAMPLE = "Mg国";
const FREE_CARD = { width: 260, height: 120 };
/** A free card's editor grows only downwards, and only in height. */
const FREE_EDITOR = { widen: false, anchor: { x: 0, y: 0 } };

const LAYOUT_MENU: [MapLayout, string, string][] = [
  ["balanced", "Mind map", "git-fork"],
  ["right", "Logic chart (right)", "arrow-right"],
  ["left", "Logic chart (left)", "arrow-left"],
  ["down", "Org chart (down)", "arrow-down"],
  ["up", "Org chart (up)", "arrow-up"],
  ["tree", "Tree chart", "list-tree"],
  ["timeline", "Timeline", "git-commit-horizontal"],
  ["timeline-vertical", "Vertical timeline", "git-commit-vertical"],
];
const LAYOUT_NAMES: Record<MapLayout, string> = {
  balanced: "Both sides", right: "Rightward", left: "Leftward", down: "Downward", up: "Upward",
  tree: "Tree chart", timeline: "Timeline", "timeline-vertical": "Vertical timeline",
};
/** Tapered lines weigh as much as each look's cards. */
const LINE_WEIGHT: Record<CanvasMapStyle, number> = { clean: 1, cards: 0.9, vivid: 1.25, minimal: 0.7, pastel: 1.1, gradient: 1.2 };
const LEVELS = [1, 2, 3] as const;
const SIDES: Record<"left" | "right" | "top" | "bottom", Direction> = {
  left: "left", right: "right", top: "up", bottom: "down",
};

export function supportedCanvas(value: unknown): value is LiveCanvas {
  const c = value as LiveCanvas | undefined;
  const win = c?.wrapperEl?.ownerDocument?.defaultView;
  return !!c && !!win && !!c.wrapperEl?.classList &&
    Array.isArray(c.history?.data) && Number.isInteger(c.history.current) &&
    [c.nodes?.get, c.nodes?.has, c.nodes?.values, c.nodes?.[Symbol.iterator],
      c.edges?.get, c.edges?.has, c.edges?.values, c.selection?.values,
      c.wrapperEl.addEventListener, c.wrapperEl.querySelectorAll,
      win.requestAnimationFrame, win.cancelAnimationFrame, win.MutationObserver,
      win.setTimeout, win.clearTimeout, win.crypto?.getRandomValues].every((fn) => typeof fn === "function") &&
    [c.getData, c.importData, c.requestSave, c.pushHistory, c.selectOnly,
      c.requestPushHistory?.run].every((fn) => typeof fn === "function");
}

/** Isolate one action from pending native typing/moving and rapid repeats. */
export function canvasTransaction(canvas: LiveCanvas, change: () => void): void {
  canvas.requestPushHistory.run();
  // Native saves already record the pre-action state. Duplicating it would
  // make consecutive undo steps appear to do nothing. Blank canvases need a seed.
  if (canvas.history.data.length === 0) canvas.pushHistory(canvas.getData());
  try {
    change();
  } finally {
    canvas.requestSave();
    canvas.requestPushHistory.run();
  }
}

/**
 * Follow-up work for a change the user just made (a drag, a deletion, an
 * edit). When that change is still waiting to enter the undo history, the
 * adjustment joins its step, so one undo reverts both. Otherwise it becomes
 * its own step. `change` returns false when it altered nothing.
 */
export function canvasAdjustment(canvas: LiveCanvas, change: () => boolean, amendLatest = false): boolean {
  const history = canvas.history;
  const top = history.data[history.current];
  canvas.requestPushHistory.run();
  const amend = (amendLatest || history.data[history.current] !== top)
    && typeof canvas.overrideHistory === "function" && typeof canvas.requestPushHistory.cancel === "function";
  if (!amend && history.data.length === 0) canvas.pushHistory(canvas.getData());
  let changed = true;
  try {
    changed = change();
  } finally {
    if (changed && amend) {
      canvas.requestPushHistory.cancel!();
      canvas.overrideHistory!();
    } else if (changed) {
      canvas.requestSave();
      canvas.requestPushHistory.run();
    }
  }
  return changed;
}

export function canvasKeyAction(evt: Pick<KeyboardEvent,
  "key" | "altKey" | "shiftKey" | "ctrlKey" | "metaKey" | "isComposing" | "repeat"
>): KeyAction | null {
  if (evt.isComposing) return null;
  if ((evt.ctrlKey || evt.metaKey) && !(evt.ctrlKey && evt.metaKey) && !evt.altKey) {
    if (evt.repeat) return null;
    // Mod+F finds in place; Mod+Shift+F opens the card search with its list.
    if (evt.shiftKey) return evt.key === "f" || evt.key === "F" ? "search" : null;
    if (evt.key === "/") return "fold";
    if (evt.key === "[") return "outdent";
    if (evt.key === "]") return "indent";
    // Mod+K links the card, as it links words in a note.
    if (evt.key === "k" || evt.key === "K") return "link";
    return evt.key === "f" || evt.key === "F" ? "find" : null;
  }
  if (evt.ctrlKey || evt.metaKey) return null;
  const arrows: Record<string, Direction> = {
    ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
  };
  if (evt.altKey && evt.shiftKey) {
    if (evt.key === "ArrowUp" || evt.key === "ArrowLeft") return "moveUp";
    if (evt.key === "ArrowDown" || evt.key === "ArrowRight") return "moveDown";
    return null;
  }
  if (evt.altKey) {
    if (evt.key === "Enter") return evt.repeat ? null : "sibling";
    return arrows[evt.key] ?? null;
  }
  if (evt.repeat) return null;
  if (evt.key === "Enter" && evt.shiftKey) return "siblingBefore";
  if ((evt.key === "Delete" || evt.key === "Backspace") && evt.shiftKey) return "deleteBranch";
  if (evt.key === "Escape" && !evt.shiftKey) return "reset";
  if (evt.key === "Tab") return evt.shiftKey ? "parent" : "child";
  if ((evt.key === "F2" || evt.key === " ") && !evt.shiftKey) return "edit";
  // F4 edits the card's note, as in XMind; Shift+F4 adds another.
  if (evt.key === "F4") return evt.shiftKey ? "addNote" : "note";
  return null;
}

/** Positions, sizes, and structure — everything the tidy layout reads. */
export function canvasSignature(data: CanvasData): string {
  const parts: string[] = [];
  for (const node of data.nodes) {
    parts.push(`n${node.id}|${node.x}|${node.y}|${node.width}|${node.height}|${String(node[LAYOUT_KEY] ?? "")}|${isCollapsed(node) ? 1 : 0}|${hasBoundary(node) ? 1 : 0}`);
  }
  for (const edge of data.edges) {
    parts.push(`e${edge.id}|${edge.fromNode}|${edge.toNode}|${isRelation(edge) ? 1 : 0}`);
  }
  // Canvas sorts nodes by z-order, which changes whenever a card is selected.
  return parts.sort().join("\n");
}

/** Compare saved content as well as geometry; selection can reorder nodes. */
function canvasStateSignature(data: CanvasData, omitTextFor?: string): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)]));
    }
    return value;
  };
  return JSON.stringify(stable({
    ...data,
    nodes: data.nodes.map((node) => node.id === omitTextFor ? { ...node, text: undefined } : node)
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...data.edges].sort((a, b) => a.id.localeCompare(b.id)),
  }));
}

/**
 * What turning a card's list into branches would do: the text the card
 * keeps and the cards below it. A single heading or item with a list under
 * it becomes the card's title. Null when no card would be created.
 */
function explodeText(markdown: string): { text: string; items: OutlineItem[] } | null {
  const outline = parseOutline(markdown);
  if (!outline) return null;
  let items = outline.items;
  let text = [outline.lead, outline.trail].filter(Boolean).join("\n\n");
  if (!text && items.length === 1) {
    text = items[0].text;
    items = items[0].children;
  }
  return items.length ? { text, items } : null;
}

function toggle(el: Element | undefined, cls: string, enabled: boolean) {
  if (el && el.classList.contains(cls) !== enabled) el.classList.toggle(cls, enabled);
}

function isEditingNode(node: LiveNode): boolean {
  // Native embedded-editor Escape destroys editMode but leaves isEditing
  // stale until the next pointer interaction. Its actual mode is authoritative.
  return !!node.isEditing && node.child?.getMode?.() !== "preview";
}

/**
 * The part of a topic that stays put while its editor grows: the side facing
 * its line, so it grows away from its parent; a centre grows both ways.
 */
function editorAnchor(info: TreeNode): EditorGeometry["anchor"] {
  if (info.parent === null) return { x: 0.5, y: 0 };
  switch (info.direction) {
    case "left": return { x: 1, y: 0 };
    case "up": return { x: 0.5, y: 1 };
    case "down": case "column": return { x: 0.5, y: 0 };
    default: return { x: 0, y: 0 };
  }
}

function boxOf(nodes: Rectangle[], margin = 0): Box | null {
  if (!nodes.length) return null;
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const node of nodes) {
    box.minX = Math.min(box.minX, node.x - margin);
    box.minY = Math.min(box.minY, node.y - margin);
    box.maxX = Math.max(box.maxX, node.x + node.width + margin);
    box.maxY = Math.max(box.maxY, node.y + node.height + margin);
  }
  return box;
}

function withoutKeys(data: CanvasNodeData, ...keys: string[]): CanvasNodeData {
  const copy = { ...data };
  for (const key of keys) delete copy[key];
  return copy;
}

/**
 * A number of cards in words: `one` (its own key, "Created 1 card…") for a
 * single card, otherwise `many` with {count} filled in. Both arrive
 * translated.
 */
export function cardCount(one: string, many: string, count: number): string {
  return count === 1 ? one : many.replace("{count}", String(count));
}

/** How a map looks, as a preset or a saved scheme gives it. */
type Look = { theme: CanvasMapStyle; line: LineChoice; spacing: MapSpacing; font?: CanvasFont; shape?: CanvasShape };

/**
 * A map's root with a palette, and with a look also its style, lines,
 * spacing, typeface and card shape: what the Style panel stores. Only a
 * custom palette carries colors of its own.
 */
export function withLook(root: CanvasNodeData, palette: { id: string; colors?: PaletteColors }, look: Look | null): CanvasNodeData {
  let next: CanvasNodeData = { ...root, [PALETTE_KEY]: palette.id };
  next = palette.colors ? { ...next, [PALETTE_COLORS_KEY]: palette.colors } : withoutKeys(next, PALETTE_COLORS_KEY);
  if (look) {
    next = { ...next, [THEME_KEY]: look.theme, [LINE_KEY]: look.line, [SPACING_KEY]: look.spacing };
    // A look brings its typeface and card shape; one without keeps the defaults.
    next = look.font && look.font !== "default" ? { ...next, [FONT_KEY]: look.font } : withoutKeys(next, FONT_KEY);
    next = look.shape && look.shape !== "rounded" ? { ...next, [SHAPE_KEY]: look.shape } : withoutKeys(next, SHAPE_KEY);
  }
  return next;
}

/** Visual properties a replacement connection inherits. */
function edgeStyle(edge: CanvasEdgeData | undefined): Partial<CanvasEdgeData> {
  if (!edge) return {};
  const style: Partial<CanvasEdgeData> = {};
  for (const key of ["color", "fromEnd", "toEnd"]) if (edge[key] !== undefined) style[key] = edge[key];
  return style;
}

interface Snapshot {
  data: CanvasData;
  forest: Forest;
  hidden: Set<string>;
}

interface Gesture {
  pointerId: number;
  start: Map<string, Rectangle>;
  forest: Forest;
  hidden: Set<string>;
  /** Each card's summaries, which travel with its branch. */
  summaries: Map<string, Summary[]>;
  followers: Set<string>;
  point: { clientX: number; clientY: number } | null;
  target: string | null;
  driver: string | null;
  moved: boolean;
  frame: number;
}

interface Pending {
  drop?: { id: string; target: string };
  deleted?: Snapshot & { at: number; selected: string[] };
  rects?: Map<string, Rectangle>;
  fit: Set<string>;
  fitVersion?: Map<string, { text: string; width: number; height: number }>;
  fitEdit?: Map<string, EditHistory>;
  fitRetries?: Map<string, number>;
  /** A delayed preview can still join this step, while it remains current. */
  fitStep?: Map<string, CanvasData>;
  /** New cards left empty when their editor closed; they are taken away. */
  removeEmpty?: Set<string>;
}

interface EditHistory {
  index: number;
  step: CanvasData | undefined;
  /** A pre-existing redo entry must not be mistaken for a fresh text edit. */
  next: CanvasData | undefined;
}

/** Buttons that live on a card: the fold badge and the "+" handles. */
interface NodeControls {
  fold: HTMLButtonElement | null;
  adds: Map<string, HTMLButtonElement>;
}

/** How a map connection is drawn in place of Canvas's own curve. */
interface LineSpec {
  style: LineStyle;
  widths: [number, number];
}

/**
 * What render() works out from the maps' structure and looks alone, kept
 * from one refresh to the next while neither changes.
 */
interface RenderPlan {
  key: string;
  themes: Map<string, CanvasMapStyle>;
  lines: Map<string, LineStyle>;
  shapes: Map<string, CanvasShape>;
  weights: Map<string, number>;
  scales: Map<string, number>;
  fonts: Map<string, CanvasFont>;
  summaries: Map<string, Summary[]>;
  summaryOf: Map<string, Summary>;
  colors: AutoColorPlan;
  numbers: Map<string, string>;
  boundaryColors: Map<string, string>;
}

/** The fields on a map's root that a plan reads, beyond the geometry in its signature. */
const ROOT_LOOK_KEYS = [THEME_KEY, PALETTE_KEY, PALETTE_COLORS_KEY, LINE_KEY, FONT_KEY, SHAPE_KEY, LINE_WEIGHT_KEY, TEXT_SCALE_KEY, NUMBERING_KEY];

/** The find bar while open: its words, the matches, and the one shown now. */
interface Finding {
  bar: FindBar;
  query: string;
  matches: string[];
  found: Set<string>;
  current: string | null;
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** Canvas draws a group's label above its box; this much room shows it. */
const GROUP_LABEL_ROOM = 40;
/** How strongly a boundary tints what it frames, in percent; styles.css fills it the same. */
const BOUNDARY_TINT = 7;

type ToolbarKey = Action | "layout" | "style" | "more";

/** A card's task progress badge: a ring that fills, and "done/total". */
interface ProgressBadge {
  el: HTMLElement;
  bar: SVGElement | null;
  label: HTMLElement;
}

class CanvasBinding {
  private toolbar: HTMLElement;
  private status: HTMLElement;
  private buttons = new Map<ToolbarKey, HTMLButtonElement>();
  private observer: MutationObserver | null = null;
  private frame = 0;
  /** A refresh held back while the canvas is being panned, zoomed or dragged. */
  private refreshTimer = 0;
  private lastRefreshAt = 0;
  private lastWheelAt = 0;
  /** What the last render drew from; the same state again is left as drawn. */
  private lastKey: string | null = null;
  /** Each decorated element to its card's or connection's id: Canvas taking one off screen and back is not a change. */
  private decorated = new WeakMap<Element, string>();
  /** The notes shown as file cards; only their changes count their tasks again. */
  private filePaths = new Set<string>();
  private noteVersion = 0;
  /** A number for each editor seen, so the key tells one editor from the next. */
  private editorIds = new WeakMap<object, number>();
  private nextEditorId = 1;
  private settleTimer = 0;
  private flashTimer = 0;
  private disposed = false;
  /** The cards whose branches are in focus; one for a single card, more for a selection. */
  private focusIds = new Set<string>();
  private path: string | undefined;
  private keys: KeymapEventHandler[] = [];
  private controls = new Map<string, NodeControls>();
  private menuGroup: HTMLElement | null = null;
  private editing = new Set<string>();
  private editorSurfaces = new Map<LiveNode, CanvasEditorSurface>();
  /** How each open editor may grow, from the card's place in its map at the last refresh. */
  private editorShapes = new Map<LiveNode, Omit<EditorGeometry, "size">>();
  private editText = new Map<string, string>();
  private editHistory = new Map<string, EditHistory>();
  /** Cards this session created, whose first fit joins their creation step. */
  private created = new Set<string>();
  /** The card each of those grew from: the keyboard goes back to it if the new one is left empty. */
  private createdFrom = new Map<string, string>();
  private lastSignature: string | null = null;
  private pending: Pending = { fit: new Set() };
  private gesture: Gesture | null = null;
  private dropTarget: HTMLElement | null = null;
  /** Ids handed out for cards and connections not yet imported. */
  private reserved = new Set<string>();
  /** Set while refresh() reads the canvas, which it never changes. */
  private cached: Snapshot | null = null;
  /** Each map card's parent when last seen, to keep ties stable. */
  private parents = new Map<string, string>();
  /** The undo step that created the cards in `created`. */
  private createdStep: CanvasData | undefined;
  /** Where cards moved by the current action started, for the animation. */
  private moves = new Map<string, Position>();
  private motion: Motion;
  private minimap: Minimap | null = null;
  /** The card under the pointer, give or take the reach of its buttons. */
  private hovered: LiveNode | null = null;
  private hoverPoint: { clientX: number; clientY: number } | null = null;
  private hoverFrame = 0;
  /** Map connections drawn in a line style, and the edges carrying the override. */
  private lineSpecs = new Map<LiveEdge, LineSpec>();
  private patchedEdges = new Set<LiveEdge>();
  /** Boundaries behind framed branches, drawn in the connections' SVG layer. */
  private boundaryLayer: SVGGElement | null = null;
  private boundaryRects = new Map<string, SVGRectElement>();
  private boundarySource: { data: CanvasData; forest: Forest; hidden: Set<string> } | null = null;
  private progress = new Map<string, ProgressBadge>();
  /** A presentation in progress, and the keys it holds. */
  private stage: Stage | null = null;
  private stageScope: Scope | null = null;
  /** While a card is typed in: the scope that lets Mod+Enter finish it before any hotkey takes the key. */
  private editScope: Scope | null = null;
  /**
   * The card being typed in, only while the toolbar is drawn: its buttons
   * act on it as if it were selected and done (a click finishes it first).
   */
  private toolbarEditing: LiveNode | null = null;
  /** The style panel while open, the map it last showed, and a look being previewed. */
  private panel: StylePanel | null = null;
  private panelRoot: string | null = null;
  private stylePreview: { root: string; patch: StylePatch } | null = null;
  /** Files whose overflowing cards were already refitted once after opening. */
  private healed = new Set<string>();
  private healTimer = 0;
  /** The onboarding panel waits this out, in case the canvas file is still being read. */
  private emptyTimer = 0;
  /** The connect tool in progress: the card it starts from, and its preview line. */
  private connecting: { from: string; line: SVGPathElement; target: string | null } | null = null;
  private connectTarget: HTMLElement | null = null;
  private markerPanel: MarkerPanel | null = null;
  private helpPanel: HelpPanel | null = null;
  private layoutPanel: LayoutPanel | null = null;
  private find: Finding | null = null;
  /** Task counts and plain words by card text, which every refresh reads again. */
  private taskCounts = new TextCache(countTasks);
  private cardWords = new TextCache(plainText);
  /** The last render's plan, reused while the maps' structure and looks stand. */
  private plan: RenderPlan | null = null;
  /** The branch color picker while open. */
  private colorPanel: BranchColorPanel | null = null;
  /** The last map tones read off the page, by palette and light or dark: a render then costs one compare. */
  private toneCache: { key: string; tones: string[] } | null = null;
  /** An arrangement hovered in the layout panel, drawn as ghosts, and its layer. */
  private layoutPreview: { root: string; patch: LayoutPatch } | null = null;
  private previewTimer = 0;
  private ghostLayer: SVGGElement | null = null;
  /** Where a layout preview zoomed out from, and to: the view returns when the preview ends untouched. */
  private previewView: { from: ViewState; to: ViewState } | null = null;
  private previewViewTimer = 0;
  /** Where opening the style or layout panel panned the map from, and to. */
  private panelPan: { from: ViewState; to: ViewState } | null = null;
  /** The marker or color popover follows its card, frame by frame while the view glides. */
  private anchorFrame = 0;
  /** Canvas's object snapping as it was before a map card's drag turned it off. */
  private snapHold: { previous: boolean | undefined } | null = null;
  private snapTimer = 0;
  /** Cards and connections gliding into the card that folds them, before they hide. */
  private folding = new Set<string>();
  private foldTimer = 0;
  /** While a card is dragged: where it would land among its siblings, and its old connection. */
  private insertBar: { group: SVGGElement; line: SVGElement } | null = null;
  private staleEdge: LiveEdge | null = null;
  /** What is going on now (connecting, a focus, several cards), shown under the toolbar at any pane width. */
  private hint: HTMLElement;
  /** The panel that says how to begin, while the canvas is empty. */
  private empty: HTMLElement | null = null;
  /** Each toolbar button's plain name; its tooltip adds the shortcut. */
  private names = new Map<ToolbarKey, string>();
  /** The number and markers at each card's corner. */
  private badges = new Map<string, { el: HTMLElement; key: string }>();
  /** The text of the toolbar's labelled buttons, and each button's icon. */
  private labels = new Map<ToolbarKey, HTMLElement>();
  private glyphs = new Map<ToolbarKey, HTMLElement>();
  /** Card editors whose Enter and Tab finish the card, with the handler on each. */
  private editorKeys = new Map<EditorView, (evt: KeyboardEvent) => void>();
  /** Where the caret goes when an editor opened from the keyboard is ready. */
  private editCaret: { id: string; mode: "end" | "all" } | null = null;
  /** Braces of summaries, drawn in the connections' SVG layer. */
  private braceLayer: SVGGElement | null = null;
  private braces = new Map<string, { brace: SVGPathElement; tail: SVGPathElement }>();
  private braceSource: { data: CanvasData; forest: Forest; hidden: Set<string> } | null = null;
  /** The note and link icons at each card's lower right corner. */
  private chips = new Map<string, { el: HTMLElement; key: string }>();
  /** The card a link under the pointer leads to, lit while the pointer is on the link. */
  private litCard: string | null = null;
  /** The icon a press began on, and the one under the pointer. */
  private chipPress: HTMLElement | null = null;
  private chipHover: HTMLElement | null = null;
  /** Where the pointer last moved, and over what, for the icons Canvas's resize handles cover. */
  private hoverEvent: PointerEvent | null = null;
  /**
   * The note panel while open: its card, the notes as they were when
   * editing began (null while only reading) and the list the words typed go
   * into, what keeps the panel beside the card, and a frame waiting to place it.
   */
  private note: {
    id: string; panel: NotePanel; before: string[] | null; base: string[]; watchers: { disconnect(): void }[]; frame: number;
  } | null = null;
  /** Owns what a drawn note loads (embeds, plugins' renderers); replaced with each drawing. */
  private noteComponent: Component | null = null;
  private noteWords = new TextCache(plainText);
  private readonly hoverParent: HoverParent = { hoverPopover: null };
  private readonly support: ColorSupport;
  private readonly win: Window & typeof globalThis;

  constructor(
    readonly view: CanvasView,
    readonly canvas: LiveCanvas,
    private settings: () => CanvasSettings,
    private app: App | undefined,
    private toggleMinimap: () => void,
    /** Persist settings changed from the canvas itself (the schemes someone saves). */
    private saveSettings: (patch: Partial<CanvasSettings>) => void = () => {},
  ) {
    const wrapper = canvas.wrapperEl;
    const doc = wrapper.ownerDocument;
    this.win = doc.defaultView!;
    this.support = colorSupport(this.win.CSS);
    this.path = view.file?.path;
    this.motion = new Motion(this.win, (node) => this.canvas.nodes.get((node as LiveNode).id) === node,
      MOTION_MS, () => this.syncBoundaryGeometry());
    wrapper.classList.add("nf-canvas-enhanced");
    this.toolbar = doc.createElement("div");
    this.toolbar.className = "nf-canvas-toolbar";
    this.toolbar.setAttribute("role", "toolbar");
    this.toolbar.setAttribute("aria-label", t("Canvas enhancements"));
    // Grow · structure · view · tools · more. The buttons people reach for
    // first carry their names; the rest show them on hover. Some buttons
    // change with the selection: the first starts a topic when nothing is
    // selected, and Focus becomes Show all while a branch is focused.
    const groups: [ToolbarKey, string, string, boolean][][] = [
      [["child", "Add child", "corner-down-right", true], ["sibling", "Add sibling", "list-plus", true], ["connect", "Connect", "spline", true]],
      [["layout", "Layout", "network", true], ["style", "Style", "palette", true], ["markers", "Markers", "flag", true],
        ["note", "Note", "sticky-note", false], ["link", "Link", "link", false], ["summary", "Summary", "braces", false]],
      [["fold", "Fold branch", "chevrons-down-up", false], ["focus", "Focus branch", "focus", false]],
      [["search", "Find card", "search", false], ["present", "Present", "presentation", false]],
      [["more", "More", "more-horizontal", false], ["help", "Guide", "circle-help", false]],
    ];
    groups.forEach((group, index) => {
      group.forEach(([action, label, icon, labelled], position) => {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = `nf-canvas-action ${labelled ? "nf-canvas-action-labelled" : "nf-canvas-action-icon"}`;
        if (index > 0 && position === 0) button.classList.add("nf-canvas-action-separated");
        if (action === "more") button.classList.add("nf-canvas-action-menu");
        button.dataset.action = action;
        button.setAttribute("aria-label", t(label));
        button.setAttribute("data-tooltip-position", "bottom");
        this.names.set(action, t(label));
        const glyph = doc.createElement("span");
        glyph.className = "nf-canvas-action-glyph";
        glyph.dataset.icon = icon;
        setIcon(glyph, icon);
        button.append(glyph);
        this.glyphs.set(action, glyph);
        if (labelled) {
          const text = doc.createElement("span");
          text.className = "nf-canvas-action-text";
          text.textContent = t(label);
          button.append(text);
          this.labels.set(action, text);
        }
        button.addEventListener("click", (evt) => {
          evt.stopPropagation();
          // A card being typed in is finished first, the way Enter finishes
          // it, so the button acts on the card as typed. A blank new topic
          // only finishes: nothing grows from a blank. The guide leaves the
          // typing alone.
          if (action !== "help") {
            const node = this.toolbarTarget();
            const cm = node && isEditingNode(node) ? node.child?.editMode?.cm : undefined;
            if (node && cm && typeof node.child?.showPreview === "function") {
              // An input method's open composition is not words yet: finishing
              // now would keep its raw keystrokes. The click waits for it.
              if (cm.composing) return;
              this.motion.finish();
              const text = this.finishEditing(node, cm);
              if (!text && (action === "child" || action === "sibling")) {
                this.canvas.wrapperEl.focus();
                return;
              }
              // A new topic left blank goes now rather than a moment later, and
              // its card is selected again: the action is for that card, not
              // for one about to vanish.
              if (!text && this.pending.removeEmpty?.delete(node.id)) this.removeEmptyCards(new Set([node.id]));
            }
          }
          const target = this.toolbarAction(action);
          if (target === "layout") this.toggleLayoutPanel();
          else if (target === "style") this.toggleStylePanel();
          else if (target === "more") this.moreMenu().showAtMouseEvent(evt);
          else this.run(target);
        });
        this.buttons.set(action, button);
        this.toolbar.append(button);
      });
    });
    this.status = doc.createElement("span");
    this.status.className = "nf-canvas-status";
    this.status.setAttribute("role", "status");
    this.toolbar.append(this.status);
    // Keep toolbar gestures out of Canvas pan/marquee handlers. A click
    // leaves the keyboard with the canvas, so Tab, Enter and Escape keep
    // acting on the selected card afterwards; the buttons still take focus
    // from the keyboard.
    for (const event of ["pointerdown", "mousedown", "dblclick"]) {
      this.toolbar.addEventListener(event, (evt) => {
        evt.stopPropagation();
        if (event === "mousedown" && (evt.target as Element).closest?.("button")) evt.preventDefault();
      });
    }
    // What is going on now, in a pill under the toolbar: unlike the status,
    // no pane is too narrow to show it.
    this.hint = doc.createElement("div");
    this.hint.className = "nf-canvas-hint nf-canvas-ui is-empty";
    this.hint.setAttribute("aria-live", "polite");
    wrapper.append(this.toolbar, this.hint);
    wrapper.addEventListener("pointerup", this.schedule);
    wrapper.addEventListener("keyup", this.schedule);
    wrapper.addEventListener("pointerdown", this.onPointerDown, true);
    // The note and link icons answer their own clicks, before Canvas reads
    // them as a resize, a selection, an edit, or its card menu.
    wrapper.addEventListener("click", this.onChipClick, true);
    wrapper.addEventListener("dblclick", this.onChipDblclick, true);
    wrapper.addEventListener("contextmenu", this.onChipMenu, true);
    // So do links to other cards written in a card's words or its notes.
    wrapper.addEventListener("click", this.onCardLinkClick, true);
    wrapper.addEventListener("auxclick", this.onCardLinkClick, true);
    wrapper.addEventListener("mouseover", this.onCardLinkOver, true);
    wrapper.addEventListener("mouseout", this.onCardLinkOut, true);
    // Escape belongs to the native editor and global scope. A DOM listener
    // handles only focus-mode reset after those scopes have had their chance.
    wrapper.addEventListener("keydown", this.onKeydown, true);
    wrapper.addEventListener("contextmenu", this.onBeforeDelete, true);
    wrapper.addEventListener("cut", this.onBeforeDelete, true);
    wrapper.addEventListener("paste", this.onPaste);
    wrapper.addEventListener("pointermove", this.onHover);
    wrapper.addEventListener("pointerleave", this.onHoverEnd);
    wrapper.addEventListener("wheel", this.onWheel, { passive: true });
    const Observer = this.win.MutationObserver;
    this.observer = new Observer((records) => {
      // Canvas adds a connection's label a moment after its line, and the
      // same state would otherwise be left as drawn: draw it again, so the
      // label gets its look on the first open too.
      for (const record of records) {
        if (record.type !== "childList") continue;
        for (const added of Array.from(record.addedNodes ?? [])) {
          const el = added as Element;
          const label = el.classList?.contains?.("canvas-path-label-wrapper") ? el : el.querySelector?.(".canvas-path-label-wrapper");
          if (label && !this.decorated.has(label)) this.lastKey = null;
        }
      }
      if (records.some((record) => {
        if (this.toolbar.contains(record.target)) return false;
        // Our own badges, bars, and boundaries changing are not canvas changes.
        if ((record.target as Element).closest?.(".nf-canvas-ui")) return false;
        if (record.type === "childList") {
          // Adding or moving our own card buttons is not a canvas change,
          // nor is Canvas taking a card off screen and bringing it back.
          const changed = [...Array.from(record.addedNodes ?? []), ...Array.from(record.removedNodes ?? [])];
          return !changed.length || !changed.every((node) => {
            const list = (node as Element).classList;
            return list?.contains?.("nf-canvas-ui") || list?.contains?.("nf-canvas-fold") || this.stillShown(node as Element);
          });
        }
        const el = record.target as Element;
        return ["is-selected", "is-focused", "is-editing", "mod-readonly"].some((cls) =>
          (record.oldValue ?? "").split(" ").includes(cls) !== el.classList.contains(cls));
      })) this.schedule();
    });
    this.observer.observe(wrapper, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ["class"], attributeOldValue: true,
    });
    const scope = view.scope;
    if (scope) {
      for (const [mods, key] of [
        [[], "Tab"], [["Shift"], "Tab"], [["Alt"], "Enter"], [["Shift"], "Enter"], [[], "F2"], [[], " "],
        [["Mod"], "/"], [["Mod"], "F"], [["Mod", "Shift"], "F"], [["Mod"], "["], [["Mod"], "]"], [["Mod"], "K"], [[], "F4"],
        [["Shift"], "F4"], [["Shift"], "Delete"], [["Shift"], "Backspace"],
        [["Alt"], "ArrowLeft"], [["Alt"], "ArrowRight"], [["Alt"], "ArrowUp"], [["Alt"], "ArrowDown"],
        [["Alt", "Shift"], "ArrowLeft"], [["Alt", "Shift"], "ArrowRight"],
        [["Alt", "Shift"], "ArrowUp"], [["Alt", "Shift"], "ArrowDown"],
      ] as const) {
        this.keys.push(scope.register([...mods], key, (evt) => this.onKey(evt)));
      }
      // Canvas binds plain arrows and nothing to Enter. Inside a mind map
      // they walk the map and add a sibling, as in mind-map apps; elsewhere
      // they stay native. Scopes stop at the first handler for a key, so
      // ours goes first and hands other cases to the native handler.
      const keys = (scope as unknown as { keys?: ScopeKey[] }).keys;
      if (Array.isArray(keys)) {
        for (const key of ["Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
          const handler = scope.register([], key, (evt, ctx) => this.onMapKey(evt, ctx, handler as ScopeKey)) as ScopeKey;
          const index = keys.indexOf(handler);
          if (index > 0) {
            keys.splice(index, 1);
            keys.unshift(handler);
          }
          this.keys.push(handler);
        }
      }
    }
    this.refresh();
  }

  private schedule = () => {
    if (this.frame || this.refreshTimer || this.disposed) return;
    // While the canvas is panned, zoomed or dragged its own frames come
    // first: a refresh that just ran is followed at a walking pace.
    const now = Date.now();
    if (now - this.lastRefreshAt < 50 && (this.canvas.isDragging || now - this.lastWheelAt < 100)) {
      this.refreshTimer = this.win.setTimeout(() => {
        this.refreshTimer = 0;
        if (!this.disposed) this.refresh();
      }, 50);
      return;
    }
    this.frame = this.win.requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.disposed) this.refresh();
    });
  };

  private onWheel = () => {
    this.lastWheelAt = Date.now();
    // An open marker or color popover follows its card as the view moves.
    this.anchorSoon();
  };

  /** Whether an element is still the face of a card or connection the canvas has. */
  private stillShown(el: Element): boolean {
    const id = this.decorated.get(el);
    if (id === undefined) return false;
    if (this.canvas.nodes.get(id)?.nodeEl === el) return true;
    const edge = this.canvas.edges.get(id);
    return !!edge && (edge.lineGroupEl === el || edge.lineEndGroupEl === el || edge.labelElement?.wrapperEl === el);
  }

  /** A note changed elsewhere: a canvas showing it as a file card counts its tasks again. */
  noteChanged(path: string) {
    if (!this.filePaths.has(path) || this.disposed) return;
    this.noteVersion++;
    this.refresh();
  }

  private active(): boolean {
    return !this.disposed && this.settings().canvasEnhancements && this.view.canvas === this.canvas;
  }

  private snapshot(): Snapshot {
    if (this.cached) return this.cached;
    const data = this.canvas.getData();
    return { data, ...this.forest(data) };
  }

  /** The maps on the canvas; ambiguous parents stay as they were. */
  private forest(data: CanvasData, rects?: Map<string, Rectangle>): { forest: Forest; hidden: Set<string> } {
    const forest = buildForest(data, rects, this.parents);
    this.parents = new Map([...forest.nodes].flatMap(([id, info]) => info.parent ? [[id, info.parent]] : []));
    const hidden = hiddenNodes(data, forest);
    // A summary of folded branches folds away with them.
    for (const id of hiddenSummaries(summaryIndex(data, forest), hidden)) hidden.add(id);
    return { forest, hidden };
  }

  private selected(): LiveNode | null {
    if (this.canvas.selection.size !== 1) return null;
    const item = this.canvas.selection.values().next().value as LiveNode | undefined;
    if (!item || this.canvas.nodes.get(item.id) !== item) return null;
    if (isEditingNode(item) && item !== this.toolbarEditing) return null;
    return item.getData().type === "group" ? null : item;
  }

  /** What the toolbar acts on: the selected card, or the one card being typed in. */
  private toolbarTarget(): LiveNode | null {
    const selected = this.selected();
    if (selected) return selected;
    if (this.canvas.selection.size !== 1) return null;
    const item = this.canvas.selection.values().next().value as LiveNode | undefined;
    if (!item || this.canvas.nodes.get(item.id) !== item || !isEditingNode(item)) return null;
    return item.getData().type === "group" ? null : item;
  }

  private selectedNodes(): LiveNode[] {
    return [...this.canvas.selection].filter((item): item is LiveNode =>
      "id" in item && this.canvas.nodes.get((item as LiveNode).id) === item);
  }

  /* ---------------------------------------------------------------- */
  /* Keyboard                                                          */
  /* ---------------------------------------------------------------- */

  private onKeydown = (evt: KeyboardEvent) => {
    if (evt.key === "Escape" && !evt.repeat && (this.connecting || this.note || this.markerPanel || this.colorPanel || this.find)
      && !this.keyTargetIsTyping(evt)) {
      // Escape leaves the connect tool, then closes a card's note, the
      // marker picker, the color picker or the find bar, before it can end
      // a branch focus.
      if (this.connecting) this.cancelConnecting();
      else if (this.note) {
        this.closeNote();
        this.canvas.wrapperEl.focus();
      } else if (this.markerPanel) this.closeMarkerPanel();
      else if (this.colorPanel) this.closeColorPanel();
      else this.closeFind();
      evt.preventDefault();
      evt.stopPropagation();
      return;
    }
    if (evt.key === "Escape" && this.onKey(evt) === false) {
      evt.preventDefault();
      evt.stopPropagation();
    }
    // Shift+Delete removes a whole branch itself, leaving no orphans to re-attach.
    if ((evt.key === "Delete" || evt.key === "Backspace") && !evt.repeat && !evt.shiftKey && this.keyTargetIsFree(evt)) {
      this.onBeforeDelete();
    }
  };

  /** Remember the maps before Canvas deletes cards, to re-attach orphans. */
  private onBeforeDelete = () => {
    if (!this.active() || this.canvas.readonly || !this.settings().canvasAutoLayout
      || !this.canvas.selection.size) return;
    this.motion.finish();
    const snapshot = this.snapshot();
    if (snapshot.forest.roots.length) {
      this.pending.deleted = { ...snapshot, at: Date.now(), selected: this.selectedNodes().map((node) => node.id) };
    }
  };

  /** Whether the key went to a text field or editor, where Escape is theirs. */
  private keyTargetIsTyping(evt: KeyboardEvent): boolean {
    const target = evt.target as Element | null;
    const typing = "input, textarea, select, [contenteditable=true], .cm-editor, .metadata-container, .inline-title, .menu, .modal";
    return !!target?.closest?.(typing);
  }

  private keyTargetIsFree(evt: KeyboardEvent): boolean {
    const target = evt.target as Element | null;
    const active = this.canvas.wrapperEl.ownerDocument.activeElement;
    const interactive = "input, textarea, select, button, [contenteditable=true], .cm-editor, .metadata-container, .inline-title, .nf-canvas-toolbar, .nf-canvas-style-panel, .nf-canvas-marker-panel, .nf-canvas-help-panel, .nf-canvas-note-panel, .nf-canvas-find, .menu, .modal";
    if (target?.closest?.(interactive) || active?.closest(interactive)) return false;
    // Scope can remain active while an unrelated overlay has DOM focus.
    return !active || active === this.canvas.wrapperEl.ownerDocument.body || this.canvas.wrapperEl.contains(active);
  }

  private onKey(evt: KeyboardEvent): false | undefined {
    if (!this.active() || !this.settings().canvasKeyboard || evt.defaultPrevented) return;
    if (!this.keyTargetIsFree(evt)) return;
    const action = canvasKeyAction(evt);
    if (!action) return;
    this.motion.finish();
    if (action === "reset") {
      if (!this.focusIds.size) return;
      this.run("reset");
      return false;
    }
    if (action === "search" || action === "find") return this.run(action) ? false : undefined;
    const selected = this.selected();
    if (!selected) return;
    // F4 opens the card's note to type in, as in XMind; on a note being read, it starts editing.
    if (action === "note") return this.canRun("note") && this.openNote(selected.id, "edit") ? false : undefined;
    if (action === "addNote") return this.canRun("addNote") && this.openNote(selected.id, "add") ? false : undefined;
    if (action === "left" || action === "right" || action === "up" || action === "down") {
      return this.navigate(selected, action, false) ? false : undefined;
    }
    // F2 selects the words to replace them; Space puts the caret after them.
    if (action === "edit") this.editCaret = { id: selected.id, mode: evt.key === "F2" ? "all" : "end" };
    return this.run(action) ? false : undefined;
  }

  /** Plain arrows and Enter: mind-map keys inside a map, native elsewhere. */
  private onMapKey(evt: KeyboardEvent, ctx: unknown, handler: ScopeKey): unknown {
    // Keys in a panel move between its choices, not the cards; Enter on
    // an onboarding button presses it.
    if ((evt.target as Element | null)?.closest?.(".nf-canvas-style-panel, .nf-canvas-marker-panel, .nf-canvas-help-panel, .nf-canvas-note-panel, .nf-canvas-find, .nf-canvas-empty")) return undefined;
    if (this.active() && this.settings().canvasKeyboard && !evt.defaultPrevented && !evt.isComposing
        && this.keyTargetIsFree(evt)) {
      this.motion.finish();
      const selected = this.selected();
      const inMap = selected && this.snapshot().forest.nodes.has(selected.id);
      if (selected && evt.key === "Enter" && !evt.repeat) {
        // Enter adds the next card, as in mind-map apps: a sibling in a map
        // or beside a free card, and below a card of its own the next card of
        // its own. A map's centre has no siblings, so it gains a main topic;
        // a card that grows neither way, such as a summary, opens instead.
        if (this.canRun("sibling")) return this.run("sibling") ? false : undefined;
        if (inMap && this.canRun("child")) return this.run("child") ? false : undefined;
        if (this.run("edit")) return false;
      } else if (inMap && evt.key.startsWith("Arrow")) {
        const direction = evt.key.slice(5).toLowerCase() as Direction;
        if (this.navigate(selected!, direction, true)) return false;
      }
    }
    const keys = (this.view.scope as unknown as { keys?: ScopeKey[] } | null)?.keys ?? [];
    const native = keys.find((key) => key !== handler && key.key === handler.key && key.modifiers === handler.modifiers);
    return native?.func(evt, ctx);
  }

  private navigate(selected: LiveNode, direction: Direction, withinMap: boolean): boolean {
    const { data, forest, hidden } = this.snapshot();
    const branch = this.focusBranch(data);
    let id: string | null;
    if (withinMap && forest.nodes.has(selected.id)) {
      // Inside a map, arrows follow its structure. With nowhere to go the
      // key is still spent: nudging a card in a tidy map means nothing.
      id = mapNeighbor(data, forest, selected.id, direction, hidden);
      if (id && branch && !branch.has(id)) id = null;
      if (!id) return true;
    } else {
      let visible = data.nodes.filter((node) => !hidden.has(node.id));
      if (branch) visible = visible.filter((node) => branch.has(node.id));
      id = findDirectionalNeighbor({ ...data, nodes: visible }, selected.id, direction);
    }
    const node = id ? this.canvas.nodes.get(id) : undefined;
    if (!node) return false;
    this.canvas.selectOnly(node);
    this.reveal([node.id]);
    this.refresh();
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  canRun(action: Action): boolean {
    if (!this.active()) return false;
    if (action === "reset") return this.canvas.nodes.size > 0 || this.focusIds.size > 0;
    if (action === "search") return this.canvas.nodes.size > 0 && !!this.app;
    // Finding writes nothing, so a read-only canvas can be searched too.
    if (action === "find") return !this.stage && (this.canvas.nodes.size > 0 || !!this.find);
    if (action === "minimap") return minimapSupported(this.canvas);
    // Presenting writes nothing, so a read-only canvas can be presented too.
    if (action === "present") return !!this.stage || this.canvas.nodes.size > 0;
    if (action === "presentFrom") return !this.stage && !!this.selected();
    if (action === "help") return true;
    // Reading a note and following a link write nothing, so a read-only canvas allows them too.
    if (action === "note") {
      if (this.note) return true;
      const node = this.selected();
      return !!node && (this.noteEditable() || hasNote(node.getData()));
    }
    if (action === "openLink") return linkValues(this.selected()?.getData()).length > 0;
    // A card's link copied to paste into another card's words; nothing on the canvas changes.
    if (action === "copyCardLink") {
      const node = this.selected();
      return !!node && node.getData().type !== "group" && linkableCardId(node.id);
    }
    const readOnlySafe = action === "focus" || action === "parent" || action === "outline" || action === "selectBranch"
      || action === "exportNote";
    if (this.canvas.readonly && !readOnlySafe) return false;
    // The connect tool joins the selected cards; the marker picker marks them.
    if (action === "connect") return !!this.connecting || this.markableNodes().length > 0;
    if (action === "markers") return !!this.markerPanel || this.markableNodes().length > 0;
    // Links and notes belong to one card at a time.
    if (action === "link") return !!this.selected() && !!this.app;
    if (action === "addNote") {
      const node = this.selected();
      return !!node && node.getData().type !== "group" && this.noteEditable();
    }
    if (action === "removeLink") return linkValues(this.selected()?.getData()).length > 0;
    if (action === "removeNote") return hasNote(this.selected()?.getData());
    // A link to another card goes into the words of the card being typed in.
    if (action === "insertCardLink") return !!this.app && !!this.typingCard();
    // The color picker colors the selected card's branch.
    if (action === "colorBranch") {
      const selected = this.selected();
      return !!this.colorPanel || (!!selected && this.snapshot().forest.nodes.has(selected.id));
    }
    if (action === "numbering" || action.startsWith("shape-") || action.startsWith("weight-") || action.startsWith("scale-")) {
      return !!this.styleRoot();
    }
    if (action === "newTopic") return !this.selectedNodes().some((node) => node.getData().type !== "group");
    if (action === "summary") return this.selectedSummaries().length > 0 || this.summaryRun() !== null;
    // Fold, Focus and Boundary act on every selected card at once.
    if (action === "fold") {
      const { forest } = this.snapshot();
      return this.selectedMapNodes().some((node) => (forest.nodes.get(node.id)?.children.length ?? 0) > 0);
    }
    if (action === "boundary") return this.selectedMapNodes().length > 0;
    if (action === "focus") return this.focusTargets().length > 0;
    if (action.startsWith("align-")) return !!this.styleRoot();
    if (action.startsWith("branch-")) {
      const selected = this.selected();
      const info = selected ? this.snapshot().forest.nodes.get(selected.id) : undefined;
      return !!info && info.parent !== null;
    }
    if (action === "fit") {
      return this.selectedNodes().some((node) => node.getData().type === "text" && !isEditingNode(node));
    }
    if (action === "insertNote") return !!this.app;
    // The style panel opens on any canvas; style actions change the selected
    // card's map, or with nothing selected the map the panel shows.
    if (action === "presets") return true;
    if (action.startsWith("preset-")) return !!appearancePreset(action.slice(7)) && !!this.styleRoot();
    if (action === "palette-off" || action.startsWith("theme-") || action.startsWith("line-") || action.startsWith("font-")
      || action === "compact" || action === "standard" || action === "roomy") return !!this.styleRoot();
    if (action === "palette-follow") {
      // The vivid look keeps its own colors: the paired palette would never show on it.
      const rootId = this.styleRoot();
      const root = rootId ? this.canvas.nodes.get(rootId)?.getData() : undefined;
      return !!root && !!this.fallbackPreset() && this.themeOf(root) !== "vivid";
    }
    if (action === "colors" || action === "uncolor") {
      const root = this.styleRoot();
      if (!root) return false;
      const { data, forest } = this.snapshot();
      if (action === "colors") return forest.nodes.get(root)!.children.length > 0;
      const members = new Set(mapMembers(forest, root));
      return data.nodes.some((item) => members.has(item.id) && !!item.color)
        || data.edges.some((edge) => forest.edges.has(edge.id) && !!edge.color && members.has(edge.toNode));
    }
    const node = this.selected();
    if (!node) return false;
    const { data, forest } = this.snapshot();
    const info = forest.nodes.get(node.id);
    const nodeData = node.getData();
    // A summary is a card of its own: it is edited, fitted or taken away, not grown.
    if (isSummary(nodeData) && forest.nodes.has(summaryLink(nodeData)!.parent)
      && !(["edit", "fit", "exportNote"] as string[]).includes(action)) return false;
    switch (action) {
      case "child": return true;
      // A free card's sibling shares its parent; a card of its own gets the next card below it.
      case "sibling": return info ? info.parent !== null : true;
      case "parent": return info ? info.parent !== null : !!findParent(data, node.id);
      case "siblingBefore": return !!info && info.parent !== null;
      case "exportNote": return !!this.app && (nodeData.type !== "group");
      case "edit": return typeof node.startEditing === "function"
        && (nodeData.type === "text" || (nodeData.type === "file" && /\.md$/i.test(String(nodeData.file ?? ""))));
      case "release": return !!info;
      case "foldAll": case "unfoldAll":
        return !!info && forest.nodes.get(info.root)!.children.length > 0;
      case "deleteBranch": return !!info && typeof this.canvas.removeNode === "function";
      // Up a level: a card below a main branch. Down a level: under the sibling before it.
      case "outdent": return !!info?.parent && forest.nodes.get(info.parent)?.parent !== null;
      case "indent": return this.previousSibling(data, forest, node.id) !== null;
      case "level-1": case "level-2": case "level-3": {
        if (!info) return false;
        const { fold, unfold } = planLevels(data, forest, info.root, Number(action.slice(6)));
        return fold.length + unfold.length > 0;
      }
      case "moveUp": case "moveDown":
        return !!planSiblingMove(data, forest, node.id, action === "moveUp" ? -1 : 1);
      case "explode": return nodeData.type === "text" && !!explodeText(String(nodeData.text ?? ""));
      case "selectBranch":
        return info ? info.children.length > 0 : buildBranch(data, node.id).size > 1;
      default: return true;
    }
  }

  run(action: Action): boolean {
    if (!this.canRun(action)) return false;
    this.motion.finish();
    if (action.startsWith("preset-")) return this.applyPreset(action.slice(7) as AppearancePresetId);
    let ok = true;
    switch (action) {
      case "reset":
        this.focusIds.clear();
        this.refresh();
        this.zoom(new Set([...this.canvas.nodes.keys()].filter((id) =>
          !this.canvas.nodes.get(id)!.nodeEl.classList.contains("nf-canvas-hidden"))));
        break;
      case "child": case "sibling": ok = this.addCard(action); break;
      case "siblingBefore": ok = this.addCard("before"); break;
      case "search": this.openSearch(); return true;
      case "find": this.openFind(); return true;
      case "minimap": this.toggleMinimap(); return true;
      case "insertNote": this.pickNote(); return true;
      case "exportNote": this.exportNote(); return true;
      case "compact": case "standard": case "roomy": ok = this.setSpacing(action); break;
      case "parent": ok = this.selectParent(); break;
      case "edit": {
        const node = this.selected()!;
        node.startEditing!();
        this.refresh();
        return true;
      }
      case "presets": this.toggleStylePanel(true); return true;
      case "markers": this.toggleMarkerPanel(); return true;
      // These take the keyboard (the note's editor, the link picker, another pane) or give it back themselves.
      case "note": return this.toggleNote(this.selected()?.id ?? null);
      case "addNote": return this.openNote(this.selected()!.id, "add");
      case "link": return this.pickLink(this.selected()!.id);
      case "openLink": return this.openLinks(this.selected()!.id);
      case "removeLink": ok = this.setLinks(this.selected()!.id, []); break;
      case "removeNote": ok = this.setNotes(this.selected()!.id, []); break;
      case "insertCardLink": return this.pickCardLink();
      case "copyCardLink": return this.copyCardLink(this.selected()!.id);
      case "colorBranch": this.toggleColorPanel(); return true;
      case "help": this.toggleHelpPanel(); return true;
      case "connect": ok = this.connect(); break;
      case "numbering": ok = this.toggleNumbering(); break;
      case "newTopic": return this.newTopic();
      case "summary": return this.toggleSummary();
      case "shape-rounded": case "shape-pill": case "shape-square": case "shape-underline":
        ok = this.setShape(action.slice(6) as CanvasShape); break;
      case "weight-thin": case "weight-normal": case "weight-bold":
        ok = this.setLineWeight(action.slice(7) as CanvasLineWeight); break;
      case "scale-small": case "scale-normal": case "scale-large":
        ok = this.setTextScale(action.slice(6) as CanvasTextScale); break;
      case "align-center": case "align-start": ok = this.setAlign(action.slice(6) as MapAlign); break;
      case "branch-inherit": ok = this.setBranch(null); break;
      case "branch-balanced": ok = false; break;
      case "branch-right": case "branch-left": case "branch-down": case "branch-up": case "branch-tree":
      case "branch-timeline": case "branch-timeline-vertical":
        ok = this.setBranch(action.slice(7) as MapLayout); break;
      case "palette-off": ok = this.disablePalette(); break;
      case "palette-follow": ok = this.followNotePalette(); break;
      case "release": ok = this.release(); break;
      case "fold": ok = this.toggleFold(this.selectedMapNodes().map((node) => node.id)); break;
      case "foldAll": case "unfoldAll": ok = this.foldAll(action === "foldAll"); break;
      case "focus": {
        // Focusing the branches already in focus shows everything again.
        const ids = this.focusTargets().map((node) => node.id);
        const same = ids.length === this.focusIds.size && ids.every((id) => this.focusIds.has(id));
        this.focusIds = new Set(same ? [] : ids);
        this.refresh();
        const branch = this.focusBranch(this.canvas.getData());
        if (branch) this.zoom(branch);
        break;
      }
      case "deleteBranch": ok = this.deleteBranch(this.selected()!.id); break;
      case "outdent": ok = this.outdent(); break;
      case "indent": ok = this.indent(); break;
      case "colors": ok = this.colorBranches(); break;
      case "uncolor": ok = this.uncolorBranches(); break;
      case "theme-clean": case "theme-cards": case "theme-vivid": case "theme-minimal": case "theme-pastel": case "theme-gradient":
        ok = this.setTheme(action.slice(6) as CanvasMapStyle); break;
      case "line-auto": case "line-organic": case "line-curve": case "line-elbow": case "line-straight":
        ok = this.setLine(action.slice(5) as LineChoice); break;
      case "font-default": case "font-sans": case "font-serif": case "font-kai":
        ok = this.setFont(action.slice(5) as CanvasFont); break;
      case "boundary": ok = this.toggleBoundary(); break;
      case "level-1": case "level-2": case "level-3": ok = this.showLevels(Number(action.slice(6))); break;
      case "present": return this.stage ? (this.stopPresenting(), true) : this.present();
      case "presentFrom": return this.present(this.selected()!.id);
      case "outline": this.copyOutline(); break;
      case "explode": ok = this.explode(); break;
      case "fit": ok = this.fitSelection(); break;
      case "selectBranch": ok = this.selectBranch(); break;
      case "moveUp": case "moveDown": ok = this.moveAmongSiblings(action === "moveUp" ? -1 : 1); break;
      default: ok = LAYOUT_MENU.some(([layout]) => layout === action) && this.arrange(action as MapLayout); break;
    }
    if (action !== "outline" && action !== "child" && action !== "sibling" && action !== "siblingBefore") {
      this.canvas.wrapperEl.focus();
    }
    return ok;
  }

  /** A map's look: its own, or the default from the settings. */
  private themeOf(root: CanvasNodeData | undefined): CanvasMapStyle {
    return asMapStyle(root?.[THEME_KEY]) ?? asMapStyle(this.settings().canvasMapStyle) ?? "clean";
  }

  /** The preset paired with the note palette, shown on maps that never chose one; null when none is. */
  private fallbackPreset(): AppearancePresetId | null {
    return (appearancePreset(this.settings().canvasFallbackPalette)?.id as AppearancePresetId | undefined) ?? null;
  }

  /**
   * The palette a map shows: its preset, its own colors, or the paired one
   * when it never chose; null for none, and for vivid maps' own colors.
   * Mirrors planAutoColors.
   */
  private shownPalette(root: CanvasNodeData | undefined): (PaletteColors & Pick<AppearancePreset, "derived" | "derivedDark">) | null {
    if (!root) return null;
    const own = root[PALETTE_KEY];
    if (own === "none") return null;
    return appearancePreset(own) ?? customPalette(root)
      ?? (own === undefined && this.themeOf(root) !== "vivid" ? appearancePreset(this.fallbackPreset()) : null);
  }

  /** The schemes saved with "Save as my scheme". */
  private userSchemes(): CanvasUserScheme[] {
    return userSchemesFrom(this.settings().canvasUserSchemes);
  }

  /** A map's typeface: its own, or the default from the settings. */
  private fontOf(root: CanvasNodeData | undefined): CanvasFont {
    return asCanvasFont(root?.[FONT_KEY]) ?? asCanvasFont(this.settings().canvasFont) ?? "default";
  }

  /**
   * The map that style actions change: the selected card's, else the one the
   * style panel last showed, else the canvas's only map.
   */
  private styleRoot(): string | null {
    const { forest } = this.snapshot();
    const selected = this.selected();
    const info = selected ? forest.nodes.get(selected.id) : undefined;
    if (info) return info.root;
    if (selected) {
      // A summary belongs to its parent's map.
      const link = summaryLink(selected.getData());
      const parent = link ? forest.nodes.get(link.parent) : undefined;
      return parent ? parent.root : null;
    }
    if (this.panel && this.panelRoot && forest.nodes.get(this.panelRoot)?.parent === null) return this.panelRoot;
    return forest.roots.length === 1 ? forest.roots[0] : null;
  }

  /** A map's lines: its own choice, or the default from the settings. */
  private lineChoiceOf(root: CanvasNodeData | undefined): LineChoice {
    return asLineChoice(root?.[LINE_KEY]) ?? asLineChoice(this.settings().canvasLineStyle) ?? "auto";
  }

  private shapeOf(root: CanvasNodeData | undefined): CanvasShape {
    return asCanvasShape(root?.[SHAPE_KEY]) ?? asCanvasShape(this.settings().canvasShape) ?? "rounded";
  }

  private weightOf(root: CanvasNodeData | undefined): CanvasLineWeight {
    return asLineWeight(root?.[LINE_WEIGHT_KEY]) ?? asLineWeight(this.settings().canvasLineWeight) ?? "normal";
  }

  private textScaleOf(root: CanvasNodeData | undefined): CanvasTextScale {
    return asTextScale(root?.[TEXT_SCALE_KEY]) ?? asTextScale(this.settings().canvasTextScale) ?? "normal";
  }

  /** Store one of a map's looks on its root; the default value removes the field. */
  private setRootChoice(key: string, value: string, fallback: string, refit: boolean): boolean {
    const rootId = this.styleRoot();
    if (!rootId) return false;
    const rootData = this.canvas.nodes.get(rootId)!.getData();
    const next = value === fallback ? withoutKeys(rootData, key) : { ...rootData, [key]: value };
    if (JSON.stringify(next) === JSON.stringify(rootData)) return true;
    canvasTransaction(this.canvas, () => {
      this.updateNode(next);
      if (refit) this.fitStyledMap(rootId);
      if (refit && this.settings().canvasAutoLayout) this.tidy([rootId]);
    });
    this.syncSignature();
    this.refresh();
    this.playMoves();
    return true;
  }

  private setShape(shape: CanvasShape): boolean {
    return this.setRootChoice(SHAPE_KEY, shape, "rounded", true);
  }

  private setLineWeight(weight: CanvasLineWeight): boolean {
    return this.setRootChoice(LINE_WEIGHT_KEY, weight, "normal", false);
  }

  private setTextScale(scale: CanvasTextScale): boolean {
    return this.setRootChoice(TEXT_SCALE_KEY, scale, "normal", true);
  }

  /* ---------------------------------------------------------------- */
  /* Style panel                                                       */
  /* ---------------------------------------------------------------- */

  /** Open or close the style panel; `open` forces a state. */
  toggleStylePanel(open = !this.panel) {
    if (!open) {
      this.closeStylePanel();
      return;
    }
    if (this.panel || !this.active()) return;
    this.closeMarkerPanel();
    this.closeColorPanel();
    this.closeHelpPanel();
    // One side panel takes the other's place, and the map stays where the first one moved it.
    this.closeLayoutPanel(false);
    const doc = this.canvas.wrapperEl.ownerDocument;
    this.panelRoot = this.styleRoot();
    this.panel = new StylePanel(doc, {
      support: this.support,
      state: () => this.panelState(),
      preview: (patch) => this.previewStyle(patch),
      applyPreset: (id, colorsOnly) => {
        if (this.canRun(`preset-${id}`)) this.applyPreset(id, colorsOnly);
      },
      applyScheme: (id, colorsOnly) => {
        if (!this.canvas.readonly) this.applyScheme(id, colorsOnly);
      },
      saveScheme: (name) => this.saveScheme(name),
      deleteScheme: (id) => this.deleteScheme(id),
      focusCanvas: () => this.canvas.wrapperEl.focus(),
      // Which sections are open is kept per device, like the recent colors.
      sections: {
        load: () => typeof this.app?.loadLocalStorage === "function" ? this.app.loadLocalStorage(STYLE_SECTIONS_KEY) : null,
        save: (open) => { if (typeof this.app?.saveLocalStorage === "function") this.app.saveLocalStorage(STYLE_SECTIONS_KEY, open); },
      },
      run: (action) => {
        const known = action as Action;
        if (this.canRun(known)) this.run(known);
        this.refresh();
      },
      close: () => {
        this.closeStylePanel();
        this.canvas.wrapperEl.focus();
      },
    });
    this.canvas.wrapperEl.append(this.panel.el);
    this.refresh();
    if (this.panel) this.makeRoom(this.panel.el);
  }

  /** Close the style panel; the map comes back from under it unless `restore` is false (another panel takes its place). */
  private closeStylePanel(restore = true) {
    if (!this.panel) return;
    this.panel.destroy();
    this.panel = null;
    this.stylePreview = null;
    this.unpan(restore);
    if (!this.disposed) this.refresh();
  }

  /** What the panel shows: the map that style actions would change. */
  private panelState(): StylePanelState | null {
    if (this.canvas.readonly) return null;
    const rootId = this.styleRoot();
    const root = rootId ? this.canvas.nodes.get(rootId)?.getData() : undefined;
    if (!rootId || !root) return null;
    const selected = this.selected();
    const inMap = !!selected && this.snapshot().forest.nodes.get(selected.id)?.root === rootId;
    return {
      palette: asPaletteId(root[PALETTE_KEY]),
      theme: this.themeOf(root),
      line: this.lineChoiceOf(root),
      font: this.fontOf(root),
      shape: this.shapeOf(root),
      weight: this.weightOf(root),
      scale: this.textScaleOf(root),
      spacing: mapSpacing(root),
      boundary: inMap ? hasBoundary(selected!.getData()) : null,
      summary: this.canRun("summary"),
      numbering: hasNumbering(root),
      canColorBranch: this.canRun("colorBranch"),
      canColor: this.canRun("colors"),
      canUncolor: this.canRun("uncolor"),
      fallback: this.fallbackPreset(),
      follows: root[PALETTE_KEY] === undefined && this.themeOf(root) !== "vivid",
      canFollow: this.canRun("palette-follow"),
      custom: root[PALETTE_KEY] === CUSTOM_PALETTE ? paletteColorsFrom(root[PALETTE_COLORS_KEY]) : null,
      schemes: this.userSchemes(),
      canSaveScheme: this.canSaveScheme(rootId, root),
    };
  }

  /**
   * Whether "Save as my scheme" has something to save: the map shows a
   * palette, the vivid look's colors, or colors set by hand on the root or
   * a main branch; and there is room for one more. Never probes colors.
   */
  private canSaveScheme(rootId: string, root: CanvasNodeData): boolean {
    if (this.userSchemes().length >= USER_SCHEME_LIMIT) return false;
    if (this.shownPalette(root) || (root[PALETTE_KEY] !== "none" && this.themeOf(root) === "vivid")) return true;
    if (safeCanvasColor(root.color)) return true;
    const { data, forest } = this.snapshot();
    const byId = new Map(data.nodes.map((node) => [node.id, node]));
    return orderedChildren(data, forest, rootId).slice(0, 6).some((id) => !!safeCanvasColor(byId.get(id)?.color));
  }

  /** Show a look on the panel's map without saving it; null ends the preview. */
  private previewStyle(patch: StylePatch | null) {
    const rootId = patch ? this.styleRoot() : null;
    const next = patch && rootId ? { root: rootId, patch } : null;
    if (JSON.stringify(next) === JSON.stringify(this.stylePreview)) return;
    this.stylePreview = next;
    this.schedule();
  }

  /** The canvas as the preview shows it: the root carries the previewed choices. */
  private previewed(data: CanvasData): CanvasData {
    const preview = this.stylePreview;
    if (!preview) return data;
    const { patch } = preview;
    return {
      ...data,
      nodes: data.nodes.map((node) => {
        if (node.id !== preview.root) return node;
        let next: CanvasNodeData = { ...node };
        if (patch.palette) next = { ...withoutKeys(next, PALETTE_COLORS_KEY), [PALETTE_KEY]: patch.palette };
        if (patch.colors) next = { ...next, [PALETTE_KEY]: CUSTOM_PALETTE, [PALETTE_COLORS_KEY]: patch.colors };
        if (patch.theme) next[THEME_KEY] = patch.theme;
        if (patch.line) next[LINE_KEY] = patch.line;
        if (patch.font) next = patch.font === "default" ? withoutKeys(next, FONT_KEY) : { ...next, [FONT_KEY]: patch.font };
        if (patch.shape) next = patch.shape === "rounded" ? withoutKeys(next, SHAPE_KEY) : { ...next, [SHAPE_KEY]: patch.shape };
        if (patch.weight) next = patch.weight === "normal" ? withoutKeys(next, LINE_WEIGHT_KEY) : { ...next, [LINE_WEIGHT_KEY]: patch.weight };
        if (patch.scale) next = patch.scale === "normal" ? withoutKeys(next, TEXT_SCALE_KEY) : { ...next, [TEXT_SCALE_KEY]: patch.scale };
        return next;
      }),
    };
  }

  private moreMenu(): Menu {
    const menu = new Menu();
    const entries: ([Action, string, string] | null)[] = [
      ["parent", "Go to parent", "corner-left-up"],
      ["siblingBefore", "Add sibling above", "list-start"],
      ["outdent", "Outdent", "indent-decrease"],
      ["indent", "Indent", "indent-increase"],
      ["selectBranch", "Select branch", "box-select"],
      ["deleteBranch", "Delete branch", "trash-2"],
      null,
      ["foldAll", "Fold all branches", "chevrons-down-up"],
      ...LEVELS.map((level): [Action, string, string] => [`level-${level}`, `Show ${level} level${level > 1 ? "s" : ""}`, "list-collapse"]),
      ["unfoldAll", "Unfold all branches", "chevrons-up-down"],
      ["fit", "Fit cards to content", "scan"],
      null,
      ["summary", "Summary", "braces"],
      ["numbering", "Numbering", "list-ordered"],
      ["boundary", "Boundary", "square-dashed"],
      ["minimap", "Minimap", "map"],
      ["search", "Find a card…", "search"],
      ["presentFrom", "Present from here", "play"],
      null,
      ["explode", "Turn list into branches", "list-tree"],
      ["insertNote", "Insert note as mind map", "file-input"],
      ["outline", "Copy branch as outline", "clipboard-copy"],
      ["exportNote", "Export branch as note", "file-output"],
    ];
    const framed = this.selectedMapNodes();
    const root = this.styleRoot();
    const checked: Partial<Record<Action, boolean>> = {
      numbering: !!root && hasNumbering(this.canvas.nodes.get(root)?.getData()),
      boundary: framed.length > 0 && framed.every((node) => hasBoundary(node.getData())),
      minimap: !!this.settings().canvasMinimap,
    };
    for (const entry of entries) {
      if (!entry) {
        menu.addSeparator();
        continue;
      }
      const [action, label, icon] = entry;
      menu.addItem((item) => {
        item.setTitle(t(label)).setIcon(icon).onClick(() => this.run(action));
        item.setDisabled?.(!this.canRun(action));
        if (action in checked) item.setChecked?.(!!checked[action]);
      });
    }
    return menu;
  }

  /** Items for Canvas's own card menu. */
  fillNodeMenu(menu: Menu) {
    const card = this.selected()?.getData();
    const notes = notesOf(card).length;
    const links = linkValues(card).length;
    // A card with notes shows them and can take another; one without starts its first.
    const noteEntries: [Action, string, string][] = notes
      ? [["note", notes > 1 ? "Show notes" : "Show note", "sticky-note"], ["addNote", "Add another note", "sticky-note"]]
      : [["addNote", "Add note", "sticky-note"]];
    const entries: [Action, string, string][] = [
      ["child", "New child card", "corner-down-right"],
      ["sibling", "New sibling card", "list-plus"],
      ["outdent", "Outdent", "indent-decrease"],
      ["indent", "Indent", "indent-increase"],
      ["connect", "Connect to another card", "spline"],
      ["markers", "Markers…", "flag"],
      ...noteEntries,
      ["link", links ? "Add another link…" : "Add link…", "link"],
      ["openLink", links > 1 ? "Open link…" : "Open link", "arrow-up-right"],
      ["removeLink", links > 1 ? "Remove all links" : "Remove link", "unlink"],
      ["copyCardLink", "Copy link to card", "locate-fixed"],
      ["colorBranch", "Color this branch…", "palette"],
      ["summary", "Add or remove summary", "braces"],
      ["fold", "Fold or unfold branch", "chevrons-down-up"],
      ["boundary", "Add or remove boundary", "square-dashed"],
      ["numbering", "Number the topics", "list-ordered"],
      ["explode", "Turn list into branches", "list-tree"],
      ["outline", "Copy branch as outline", "clipboard-copy"],
      ["exportNote", "Export branch as note", "file-output"],
      ["presentFrom", "Present from here", "play"],
      ["deleteBranch", "Delete branch", "trash-2"],
    ];
    for (const [action, label, icon] of entries) {
      if (!this.canRun(action)) continue;
      menu.addItem((item) => {
        item.setTitle(t(label)).setIcon(icon).onClick(() => this.run(action));
        (item as unknown as { setSection?(section: string): unknown }).setSection?.("canvas");
      });
    }
  }

  private newId(): string {
    let id: string;
    do {
      const bytes = new Uint8Array(8);
      this.win.crypto.getRandomValues(bytes);
      id = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    } while (this.canvas.nodes.has(id) || this.canvas.edges.has(id) || this.reserved.has(id));
    this.reserved.add(id);
    return id;
  }

  private updateNode(data: CanvasNodeData) {
    this.canvas.importData({ nodes: [data], edges: [] }, false);
  }

  /** Remember where a card started, before this action first moves it. */
  private track(id: string, from?: Position) {
    if (this.moves.has(id)) return;
    const position = from ?? this.canvas.nodes.get(id)?.getData();
    if (position) this.moves.set(id, { x: position.x, y: position.y });
  }

  /** Apply a tidy plan; returns whether anything moved. */
  private applyPlan(plan: MapLayoutPlan): boolean {
    let changed = false;
    for (const [id, position] of plan.positions) {
      const node = this.canvas.nodes.get(id);
      if (!node) continue;
      const current = node.getData();
      if (current.x === position.x && current.y === position.y) continue;
      this.track(id, current);
      node.moveTo(position);
      changed = true;
    }
    for (const [id, sides] of plan.edgeSides) {
      const edge = this.canvas.edges.get(id);
      if (!edge || typeof edge.setData !== "function") continue;
      const current = edge.getData();
      if (current.fromSide === sides.fromSide && current.toSide === sides.toSide) continue;
      edge.setData({ ...current, ...sides });
      changed = true;
    }
    return changed;
  }

  private animates(): boolean {
    if (!this.settings().canvasAnimation) return false;
    return !this.win.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  }

  /**
   * Replay the cards this action moved as one short glide. Call it once the
   * action is saved and recorded, and after refresh() has hidden folded cards.
   */
  private playMoves() {
    const moves = this.moves;
    this.moves = new Map();
    if (!moves.size || !this.animates() || this.disposed) return;
    const saved = this.canvas.data;
    const entries: [LiveNode, Position][] = [];
    for (const [id, from] of moves) {
      const node = this.canvas.nodes.get(id);
      if (node && !node.nodeEl.classList.contains("nf-canvas-hidden")) entries.push([node, from]);
    }
    this.motion.play(entries, () => this.landed(saved));
  }

  /**
   * Cards have landed. If Canvas saved in the meantime, that save and its
   * undo step caught cards mid-way; record where they really are.
   */
  private landed(saved: unknown) {
    if (this.disposed) return;
    if ("data" in this.canvas && this.canvas.data !== saved && typeof this.canvas.overrideHistory === "function") {
      this.canvas.requestPushHistory.run();
      this.canvas.overrideHistory();
    }
    this.schedule();
  }

  /** Tidy every map, or only the listed roots. */
  private tidy(roots?: Iterable<string>, rects?: Map<string, Rectangle>): boolean {
    const data = this.canvas.getData();
    const { forest } = this.forest(data, rects);
    let changed = false;
    for (const root of roots ? [...roots] : forest.roots) {
      const plan = planMapLayout(data, forest, root);
      if (plan) changed = this.applyPlan(plan) || changed;
    }
    return changed;
  }

  /**
   * A new card next to `from`: a child, a sibling below, or a sibling above
   * ('before'). In a map the tidy layout places it; a lone card becomes a map
   * growing toward `layout`, and its sibling is the next card of its own
   * below it; other cards grow in open space.
   */
  private addCard(
    kind: "child" | "sibling" | "before", from: LiveNode = this.selected()!,
    options: { side?: "left" | "right"; layout?: MapLayout } = {},
  ): boolean {
    const selected = from;
    const { data, forest } = this.snapshot();
    const info = forest.nodes.get(selected.id);
    const selectedData = selected.getData();
    const standalone = !data.edges.some((edge) => edge.fromNode === selected.id || edge.toNode === selected.id);
    const startsMap = !info && kind === "child" && standalone;
    const layout = options.layout ?? "right";
    const id = this.newId();
    let parentId: string;
    let reveal: string[];
    if (info || startsMap) {
      // Mind map: a provisional slot, then the tidy layout settles it.
      let planData = data;
      let planForest = forest;
      if (startsMap) {
        planData = { ...data, nodes: data.nodes.map((node) => node.id === selected.id ? { ...node, [LAYOUT_KEY]: layout } : node) };
        planForest = this.forest(planData).forest;
      }
      // The new topic opens at the size it becomes, so its editor is the card.
      const depth = (planForest.nodes.get(selected.id)?.depth ?? 0) + (kind === "child" ? 1 : 0);
      const box = this.newTopicBox(depth);
      const slot = planMapInsertion(planData, planForest, selected.id, kind, box.width, box.height, options.side);
      if (!slot) return false;
      parentId = slot.parentId;
      const parent = this.canvas.nodes.get(parentId)!.getData();
      const color = parent.color ? { color: parent.color } : {};
      const node: CanvasNodeData = {
        id, type: "text", text: "", x: Math.round(slot.x), y: Math.round(slot.y), ...box, ...color,
      };
      const edge: CanvasEdgeData = {
        id: this.newId(), fromNode: parentId, toNode: id, ...sidesFor(slot.direction), toEnd: "none", ...color,
      };
      const root = info ? info.root : selected.id;
      canvasTransaction(this.canvas, () => {
        if (startsMap) this.updateNode({ ...selectedData, [LAYOUT_KEY]: layout });
        if (kind === "child" && isCollapsed(parent)) this.updateNode(withoutKeys(parent, COLLAPSED_KEY));
        this.canvas.importData({ nodes: [node], edges: [edge] }, false);
        this.reserved.clear();
        if (startsMap) this.fitHierarchyChanges(forest, new Set([id]));
        // Its final height, before the layout places it: one undo step.
        this.settleBlankTopic(id);
        this.tidy([root]);
      });
      // The new card appears in place; only its neighbours glide aside.
      this.moves.delete(id);
      reveal = [id];
    } else if (kind === "sibling" && !findParent(data, selected.id)) {
      // Nothing to share a parent with: the next card goes below, as wide as
      // this one and not joined to it, so Enter lists cards as it lists topics.
      const size = {
        width: Math.min(400, Math.max(160, selectedData.width)),
        height: Math.min(FREE_CARD.height, Math.max(TOPIC.height, selectedData.height)),
      };
      const position = planFreeCard(data, selected.id, "down", size.width, size.height);
      if (!position) return false;
      canvasTransaction(this.canvas, () => this.canvas.importData({
        nodes: [{ id, type: "text", text: "", x: position.x, y: position.y, ...size }], edges: [],
      }, false));
      this.reserved.clear();
      reveal = [selected.id, id];
    } else {
      const position = findNewNodePosition(data, selected.id, kind === "child" ? "child" : "sibling", FREE_CARD.width, FREE_CARD.height);
      if (!position) {
        new Notice(t("Choose a card outside groups with an unambiguous parent."));
        return false;
      }
      parentId = position.parentId;
      reveal = [parentId, id];
      this.importFreeCard(id, parentId, position);
    }
    this.startEditing(id, reveal, selected.id);
    return true;
  }

  /** Import a free card joined to `parentId` by an arrow, in one undo step. */
  private importFreeCard(id: string, parentId: string, position: Position & { fromSide: string; toSide: string }) {
    const parent = this.canvas.nodes.get(parentId)!.getData();
    const color = parent.color ? { color: parent.color } : {};
    const node: CanvasNodeData = {
      id, type: "text", text: "", x: position.x, y: position.y, ...FREE_CARD, ...color,
    };
    const edge: CanvasEdgeData = {
      id: this.newId(), fromNode: parent.id, toNode: id,
      fromSide: position.fromSide, toSide: position.toSide, toEnd: "arrow", ...color,
    };
    canvasTransaction(this.canvas, () => this.canvas.importData({ nodes: [node], edges: [edge] }, false));
    this.reserved.clear();
  }

  /** Select a card this action created, grown from the card `from`, and open its editor. */
  private startEditing(id: string, reveal: string[], from?: string) {
    const live = this.canvas.nodes.get(id);
    this.createdStep = this.canvas.history.data[this.canvas.history.current];
    if (live) {
      this.created.add(id);
      if (from) this.createdFrom.set(id, from);
      this.canvas.selectOnly(live);
      this.reveal(reveal);
      live.attach?.();
      live.render?.();
      live.startEditing?.();
    }
    this.syncSignature();
    this.refresh();
    this.playMoves();
  }

  /**
   * Whether a new topic opens at the size it becomes: only where it is
   * fitted to its words afterwards and its editor grows with them meanwhile.
   * Elsewhere a narrow start would keep its words wrapped.
   */
  private fitsNewTopics(): boolean {
    const settings = this.settings();
    return !!settings.canvasAutoFit && this.sizeMode() !== "preserve" && settings.canvasComfortableEdit !== false;
  }

  /** Where a new blank topic starts: the card it becomes, or Canvas's room where cards are not fitted to their words. */
  private newTopicBox(depth: number): { width: number; height: number } {
    return this.fitsNewTopics() ? blankTopicSize(this.sizeMode(), depth) : { ...TOPIC };
  }

  /**
   * Inside the creating action's transaction, before its layout: a blank topic
   * takes the height of one line of its own type, so its editor opens at the
   * card it becomes. Nothing where topics keep Canvas's room, or while the
   * card cannot be measured yet.
   */
  private settleBlankTopic(id: string) {
    if (!this.fitsNewTopics()) return;
    const node = this.canvas.nodes.get(id);
    if (!node || node.getData().type !== "text" || isEditingNode(node) || typeof node.resize !== "function") return;
    node.attach?.();
    node.render?.();
    // The render draws the theme, typeface and shape classes the measure
    // needs. This import is the action's own, not a native edit to settle.
    this.syncSignature();
    this.refresh();
    const depth = this.snapshot().forest.nodes.get(id)?.depth;
    if (this.settings().canvasAppearance && depth !== undefined) applyTopicTypography(node.nodeEl, depth, false);
    const before = node.getData();
    // A blank card's preview renders nothing: measure one line of its type instead.
    const line = measureCard(node.nodeEl, before.width, before.width, false, undefined, ONE_LINE_SAMPLE);
    if (!line) return;
    const { height } = fittedCardSize({ before, measured: line, fitWidth: false, mode: this.sizeMode(), depth });
    if (height === before.height) return;
    node.resize({ width: before.width, height });
    node.render?.();
  }

  /**
   * A "+" handle: grow a card from `id` toward `side`. A map card gains a
   * child, a lone card starts a map growing that way, and a connected free
   * card gains a new card joined by an arrow.
   */
  grow(id: string, side: keyof typeof SIDES): boolean {
    if (!this.active() || this.canvas.readonly) return false;
    this.motion.finish();
    const node = this.canvas.nodes.get(id);
    if (!node || isEditingNode(node) || node.getData().type === "group") return false;
    this.canvas.selectOnly(node);
    const { data, forest } = this.snapshot();
    const direction = SIDES[side];
    const info = forest.nodes.get(id);
    if (info) {
      const balancedRoot = info.parent === null && mapLayout(node.getData()) === "balanced";
      const sideways = direction === "left" || direction === "right" ? direction : undefined;
      return this.addCard("child", node, balancedRoot && sideways ? { side: sideways } : {});
    }
    const standalone = !data.edges.some((edge) => edge.fromNode === id || edge.toNode === id);
    if (standalone) return this.addCard("child", node, { layout: direction });
    const position = planFreeCard(data, id, direction, FREE_CARD.width, FREE_CARD.height);
    if (!position) return false;
    const created = this.newId();
    this.importFreeCard(created, id, position);
    this.startEditing(created, [id, created], id);
    return true;
  }

  /** Change the gaps of the selected card's map. */
  private setSpacing(spacing: MapSpacing): boolean {
    const rootId = this.styleRoot();
    if (!rootId) return false;
    const rootData = this.canvas.nodes.get(rootId)!.getData();
    if (mapSpacing(rootData) === spacing) return true;
    canvasTransaction(this.canvas, () => {
      this.updateNode(spacing === "standard" ? withoutKeys(rootData, SPACING_KEY) : { ...rootData, [SPACING_KEY]: spacing });
      this.tidy([rootId]);
    });
    this.syncSignature();
    this.refresh();
    this.playMoves();
    return true;
  }

  private selectParent(): boolean {
    const selected = this.selected()!;
    const { data, forest } = this.snapshot();
    const id = forest.nodes.get(selected.id)?.parent ?? findParent(data, selected.id);
    const parent = id ? this.canvas.nodes.get(id) : undefined;
    if (!parent) return false;
    // Explicitly returning to a parent can leave the focused branch.
    if (this.focusBranch(data)?.has(parent.id) === false) this.focusIds.clear();
    this.canvas.selectOnly(parent);
    this.reveal([parent.id]);
    this.refresh();
    return true;
  }

  /** Make the selected card's tree a mind map with this layout. */
  private arrange(layout: MapLayout): boolean {
    const selected = this.selected()!;
    const { data, forest } = this.snapshot();
    const rootId = forest.nodes.get(selected.id)?.root ?? selected.id;
    const rootData = this.canvas.nodes.get(rootId)!.getData();
    const marked = { ...data, nodes: data.nodes.map((node) => node.id === rootId ? { ...node, [LAYOUT_KEY]: layout } : node) };
    // A new structure keeps the map's reading order: siblings read top to
    // bottom become a timeline left to right, not an order read off positions.
    const order = forest.nodes.has(rootId) && mapLayout(rootData) !== layout ? this.readingOrder(data, forest, rootId) : undefined;
    const plan = this.planArrange(marked, rootId, layout, order);
    if (!plan) return false;
    const unchanged = rootData[LAYOUT_KEY] === layout && [...plan.positions].every(([id, position]) => {
      const node = this.canvas.nodes.get(id)?.getData();
      return node && node.x === position.x && node.y === position.y;
    }) && [...plan.edgeSides].every(([id, sides]) => {
      const edge = this.canvas.edges.get(id)?.getData();
      return edge && edge.fromSide === sides.fromSide && edge.toSide === sides.toSide;
    });
    if (!unchanged) {
      canvasTransaction(this.canvas, () => {
        if (rootData[LAYOUT_KEY] !== layout) this.updateNode({ ...rootData, [LAYOUT_KEY]: layout });
        const resized = this.fitHierarchyChanges(forest);
        // The hierarchy's type sizes can change the card boxes. Lay out those
        // new boxes, keeping the reading order captured before this action.
        const fittedPlan = resized
          ? planMapLayout(this.canvas.getData(), this.snapshot().forest, rootId, { layout, rebalance: layout === "balanced", order })
          : plan;
        this.applyPlan(fittedPlan ?? plan);
      });
      this.syncSignature();
    }
    const ids = new Set(plan.positions.keys());
    if (!this.frameBeside(ids)) this.zoom(ids);
    this.refresh();
    this.playMoves();
    return true;
  }

  /** The order a map's siblings read in now, by card, before a change moves them. */
  private readingOrder(data: CanvasData, forest: Forest, rootId: string): Map<string, number> {
    const order = new Map<string, number>();
    for (const id of mapMembers(forest, rootId)) {
      orderedChildren(data, forest, id).forEach((child, index) => order.set(child, index));
    }
    return order;
  }

  /**
   * The tidy plan for a map whose root or branch was changed in `data`:
   * with `layout`, the whole map takes that structure; without, it keeps
   * the one stored. The preview and the change itself share this plan.
   */
  private planArrange(data: CanvasData, rootId: string, layout: MapLayout | null, order?: Map<string, number>): MapLayoutPlan | null {
    const { forest } = this.forest(data);
    return planMapLayout(data, forest, rootId, layout ? { layout, rebalance: layout === "balanced", order } : { order });
  }

  /** Return a map's cards to free placement. */
  private release(): boolean {
    const selected = this.selected()!;
    const { forest } = this.snapshot();
    const rootId = forest.nodes.get(selected.id)!.root;
    canvasTransaction(this.canvas, () => {
      for (const id of mapMembers(forest, rootId)) {
        const data = this.canvas.nodes.get(id)?.getData();
        if (data && (data[LAYOUT_KEY] !== undefined || data[COLLAPSED_KEY] !== undefined)) {
          this.updateNode(withoutKeys(data, LAYOUT_KEY, COLLAPSED_KEY));
        }
      }
      this.fitHierarchyChanges(forest);
    });
    this.syncSignature();
    this.refresh();
    new Notice(t("The map’s cards now stay where you put them."));
    return true;
  }

  /**
   * Fold the branches of these cards, or unfold them: they fold while any
   * of them is open, and unfold once all are folded, as one undo step.
   */
  toggleFold(ids: string[]): boolean {
    if (this.canvas.readonly) return false;
    this.motion.finish();
    this.finishFolding(false);
    const { forest, hidden } = this.snapshot();
    const targets = [...new Set(ids)].map((id) => this.canvas.nodes.get(id))
      .filter((node): node is LiveNode => !!node && (forest.nodes.get(node.id)?.children.length ?? 0) > 0);
    if (!targets.length) return false;
    const folding = targets.some((node) => !isCollapsed(node.getData()));
    const changes = targets.filter((node) => isCollapsed(node.getData()) !== folding);
    const roots = new Set(changes.map((node) => forest.nodes.get(node.id)!.root));
    if (folding) this.foldAway(changes.map((node) => node.id), forest, hidden);
    canvasTransaction(this.canvas, () => {
      for (const node of changes) {
        const data = node.getData();
        this.updateNode(folding ? { ...data, [COLLAPSED_KEY]: true } : withoutKeys(data, COLLAPSED_KEY));
      }
      this.tidy(roots);
    });
    this.syncSignature();
    this.refresh();
    if (!folding) {
      // Unfolded cards grow out of the card that held them.
      this.growRevealed(hidden);
      const shown = this.snapshot().hidden;
      this.reveal([...changes.map((node) => node.id), ...[...hidden].filter((id) => !shown.has(id))]);
    }
    this.playMoves();
    return true;
  }

  private foldAll(fold: boolean): boolean {
    const selected = this.selected()!;
    const { data, forest, hidden } = this.snapshot();
    const rootId = forest.nodes.get(selected.id)!.root;
    const byId = new Map(data.nodes.map((node) => [node.id, node]));
    // Folding keeps the root's own branches visible.
    const targets = fold ? forest.nodes.get(rootId)!.children : mapMembers(forest, rootId);
    const changes = targets.map((id) => byId.get(id)!).filter((node) => fold
      ? forest.nodes.get(node.id)!.children.length > 0 && !isCollapsed(node)
      : node[COLLAPSED_KEY] !== undefined);
    if (!changes.length) return true;
    this.finishFolding(false);
    if (fold) this.foldAway(changes.map((node) => node.id), forest, hidden);
    canvasTransaction(this.canvas, () => {
      for (const node of changes) this.updateNode(fold ? { ...node, [COLLAPSED_KEY]: true } : withoutKeys(node, COLLAPSED_KEY));
      this.tidy([rootId]);
    });
    this.syncSignature();
    this.refresh();
    this.playMoves();
    return true;
  }

  private colorBranches(): boolean {
    const rootId = this.styleRoot();
    if (!rootId) return false;
    const { data, forest } = this.snapshot();
    const plan = planBranchColors(data, forest, rootId);
    const nodes = data.nodes.filter((node) => plan.nodes.has(node.id) && node.color !== plan.nodes.get(node.id))
      .map((node) => ({ ...node, color: plan.nodes.get(node.id)! }));
    const edges = data.edges.filter((edge) => plan.edges.has(edge.id) && edge.color !== plan.edges.get(edge.id));
    if (!nodes.length && !edges.length) return true;
    canvasTransaction(this.canvas, () => {
      if (nodes.length) this.canvas.importData({ nodes, edges: [] }, false);
      for (const edge of edges) this.canvas.edges.get(edge.id)?.setData({ ...edge, color: plan.edges.get(edge.id)! });
    });
    this.syncSignature();
    return true;
  }

  private applyPreset(id: AppearancePresetId, colorsOnly = false): boolean {
    const preset = appearancePreset(id);
    const rootId = this.styleRoot();
    if (!preset || !rootId) return false;
    return this.applyLook(rootId, { id }, colorsOnly ? null : preset);
  }

  /** Give the map a saved scheme: its colors are copied onto the root, so they stay after the scheme goes. */
  private applyScheme(schemeId: string, colorsOnly = false): boolean {
    const scheme = this.userSchemes().find((item) => item.id === schemeId);
    const rootId = this.styleRoot();
    if (!scheme || !rootId) return false;
    const colors: PaletteColors = scheme.dark
      ? { rootColor: scheme.rootColor, branchColors: [...scheme.branchColors], dark: { rootColor: scheme.dark.rootColor, branchColors: [...scheme.dark.branchColors] } }
      : { rootColor: scheme.rootColor, branchColors: [...scheme.branchColors] };
    return this.applyLook(rootId, { id: CUSTOM_PALETTE, colors }, colorsOnly ? null : scheme);
  }

  /**
   * Store a palette on a map's root, and with a look its style, lines,
   * spacing, typeface and card shape: one undoable step, and none when
   * nothing changes. Only a custom palette carries colors of its own.
   */
  private applyLook(rootId: string, palette: { id: string; colors?: PaletteColors }, look: Look | null): boolean {
    this.motion.finish();
    if (this.canvas.readonly) return false;
    const root = this.canvas.nodes.get(rootId)!.getData();
    const next = withLook(root, palette, look);
    if (JSON.stringify(root) === JSON.stringify(next)) return true;
    const restyled = !!look && (this.themeOf(root) !== look.theme || this.fontOf(root) !== this.fontOf(next)
      || this.shapeOf(root) !== this.shapeOf(next));
    canvasTransaction(this.canvas, () => {
      this.updateNode(next);
      if (restyled) this.fitStyledMap(rootId);
      if (look && this.settings().canvasAutoLayout) this.tidy([rootId]);
    });
    this.syncSignature();
    this.refresh();
    this.playMoves();
    if (restyled) this.refitWhenFontsLoad(rootId);
    return true;
  }

  /**
   * The colors a map shows now, as values that can be stored (hex or
   * "1"–"6"): its palette, with the colors set by hand on the root and the
   * main branches over it. Accent harmonies are read off the page as hex.
   */
  private captureColors(rootId: string): PaletteColors | null {
    const { data, forest } = this.snapshot();
    const byId = new Map(data.nodes.map((node) => [node.id, node]));
    const root = byId.get(rootId);
    if (!root) return null;
    const wrapper = this.canvas.wrapperEl;
    const accent = () => resolveColor(wrapper, "var(--interactive-accent)") ?? "#3d8bd9";
    const shown = this.shownPalette(root);
    let base: { rootColor: string; branchColors: string[]; dark?: { rootColor: string; branchColors: string[] } } | null = null;
    if (shown?.derived && this.support.relative) {
      // The tones for the mode shown now: light-dark() picks them like the map does.
      const css = presetColors(shown, this.support);
      const resolved = [css.rootColor, ...css.branchColors].map((color) => resolveColor(wrapper, color));
      if (resolved.every((color): color is string => !!color)) base = { rootColor: resolved[0], branchColors: resolved.slice(1, 7) };
    }
    if (!base && shown) {
      const own = root[PALETTE_KEY] === CUSTOM_PALETTE ? paletteColorsFrom(root[PALETTE_COLORS_KEY]) : null;
      const source = own ?? shown;
      const lower = (set: { rootColor: string; branchColors: readonly string[] }) =>
        ({ rootColor: set.rootColor.toLowerCase(), branchColors: set.branchColors.slice(0, 6).map((color) => color.toLowerCase()) });
      base = source.dark ? { ...lower(source), dark: lower(source.dark) } : lower(source);
    }
    if (!base && root[PALETTE_KEY] !== "none" && this.themeOf(root) === "vivid") {
      // What vivid draws: the accent at the centre, Canvas's six colors on the branches.
      base = { rootColor: accent(), branchColors: ["1", "2", "3", "4", "5", "6"] };
    }
    // Colors set by hand win over the palette, in light and dark alike.
    const own = (value: unknown) => safeCanvasColor(value) ? (value as string).toLowerCase() : null;
    const rootOwn = own(root.color);
    const branchOwn = orderedChildren(data, forest, rootId).slice(0, 6).map((id) => own(byId.get(id)?.color));
    if (!base && !rootOwn && !branchOwn.some(Boolean)) return null;
    base ??= { rootColor: accent(), branchColors: ["1", "2", "3", "4", "5", "6"] };
    const overlay = (set: { rootColor: string; branchColors: string[] }) => ({
      rootColor: rootOwn ?? set.rootColor,
      branchColors: set.branchColors.map((color, index) => branchOwn[index] ?? color),
    });
    return base.dark ? { ...overlay(base), dark: overlay(base.dark) } : overlay(base);
  }

  /**
   * Save the map's colors and look as one of "My schemes". Only the settings
   * change: nothing is written to the canvas and no undo step is recorded.
   */
  private saveScheme(name: string): boolean {
    const rootId = this.styleRoot();
    const root = rootId ? this.canvas.nodes.get(rootId)?.getData() : undefined;
    const list = this.userSchemes();
    if (!rootId || !root || list.length >= USER_SCHEME_LIMIT) return false;
    const colors = this.captureColors(rootId);
    if (!colors) return false;
    const scheme: CanvasUserScheme = {
      id: newSchemeId(list.map((item) => item.id)),
      name: name.trim().slice(0, SCHEME_NAME_MAX) || suggestSchemeName(t("Map scheme"), list.map((item) => item.name)),
      ...colors,
      theme: this.themeOf(root), line: this.lineChoiceOf(root), spacing: mapSpacing(root),
    };
    const font = this.fontOf(root);
    const shape = this.shapeOf(root);
    if (font !== "default") scheme.font = font;
    if (shape !== "rounded") scheme.shape = shape;
    this.saveSettings({ canvasUserSchemes: [...list, scheme] });
    this.refresh();
    return true;
  }

  /** Forget a saved scheme; maps that use it keep its colors, which live on their roots. */
  private deleteScheme(id: string) {
    const list = this.userSchemes();
    const next = list.filter((item) => item.id !== id);
    if (next.length === list.length) return;
    this.saveSettings({ canvasUserSchemes: next });
    this.refresh();
  }

  private disablePalette(): boolean {
    const rootId = this.styleRoot();
    if (!rootId) return false;
    const root = this.canvas.nodes.get(rootId)!.getData();
    if (root[PALETTE_KEY] === "none" && root[PALETTE_COLORS_KEY] === undefined) return true;
    canvasTransaction(this.canvas, () => this.updateNode({ ...withoutKeys(root, PALETTE_COLORS_KEY), [PALETTE_KEY]: "none" }));
    this.syncSignature();
    this.refresh();
    return true;
  }

  /**
   * Let a map follow the note palette again: its own palette is removed, so
   * the paired preset shows through. One undoable step; none when it follows.
   */
  private followNotePalette(): boolean {
    const rootId = this.styleRoot();
    if (!rootId) return false;
    const root = this.canvas.nodes.get(rootId)!.getData();
    if (root[PALETTE_KEY] === undefined && root[PALETTE_COLORS_KEY] === undefined) return true;
    canvasTransaction(this.canvas, () => this.updateNode(withoutKeys(root, PALETTE_KEY, PALETTE_COLORS_KEY)));
    this.syncSignature();
    this.refresh();
    return true;
  }

  /** Take the palette off a map's cards and branch lines. */
  private uncolorBranches(): boolean {
    const rootId = this.styleRoot();
    if (!rootId) return false;
    const { data, forest } = this.snapshot();
    const members = new Set(mapMembers(forest, rootId));
    const nodes = data.nodes.filter((node) => members.has(node.id) && node.color).map((node) => withoutKeys(node, "color"));
    const edges = data.edges.filter((edge) => forest.edges.has(edge.id) && members.has(edge.toNode) && edge.color);
    if (!nodes.length && !edges.length) return true;
    canvasTransaction(this.canvas, () => {
      if (nodes.length) this.canvas.importData({ nodes, edges: [] }, false);
      for (const edge of edges) {
        const plain = { ...edge };
        delete plain.color;
        this.canvas.edges.get(edge.id)?.setData(plain);
      }
    });
    this.syncSignature();
    this.refresh();
    return true;
  }

  /** Give the selected card's map its own look, stored on its root. */
  private setTheme(theme: CanvasMapStyle): boolean {
    const rootId = this.styleRoot();
    if (!rootId) return false;
    const rootData = this.canvas.nodes.get(rootId)!.getData();
    if (rootData[THEME_KEY] === theme) return true;
    canvasTransaction(this.canvas, () => {
      this.updateNode({ ...rootData, [THEME_KEY]: theme });
      this.fitStyledMap(rootData.id);
      if (this.settings().canvasAutoLayout) this.tidy([rootData.id]);
    });
    this.syncSignature();
    this.refresh();
    this.playMoves();
    return true;
  }

  /** Set the map's typeface; the default follows the note font and is not stored. */
  private setFont(font: CanvasFont): boolean {
    const rootId = this.styleRoot();
    if (!rootId) return false;
    const rootData = this.canvas.nodes.get(rootId)!.getData();
    const next = font === "default" ? withoutKeys(rootData, FONT_KEY) : { ...rootData, [FONT_KEY]: font };
    if (JSON.stringify(next) === JSON.stringify(rootData)) return true;
    canvasTransaction(this.canvas, () => {
      this.updateNode(next);
      this.fitStyledMap(rootId);
      if (this.settings().canvasAutoLayout) this.tidy([rootId]);
    });
    this.syncSignature();
    this.refresh();
    this.playMoves();
    // A typeface the page has not drawn yet may still be loading; measure
    // again once it has arrived, as part of the same step.
    this.refitWhenFontsLoad(rootId);
    return true;
  }

  private refitWhenFontsLoad(rootId: string) {
    const fonts = this.canvas.wrapperEl.ownerDocument?.fonts;
    if (!fonts || fonts.status === "loaded" || !this.settings().canvasAutoFit) return;
    const path = this.view.file?.path;
    const step = this.canvas.history.data[this.canvas.history.current];
    void fonts.ready.then(() => {
      if (!this.active() || this.canvas.readonly || this.view.file?.path !== path || !this.canvas.nodes.has(rootId)) return;
      // Only while the step that changed the face is still the latest one.
      if (this.canvas.history.data[this.canvas.history.current] !== step) return;
      canvasAdjustment(this.canvas, () => {
        let changed = false;
        for (const id of mapMembers(this.snapshot().forest, rootId)) changed = this.fitNode(id, true) || changed;
        if (changed && this.settings().canvasAutoLayout) this.tidy([rootId]);
        return changed;
      }, true);
      this.syncSignature();
      this.refresh();
      this.playMoves();
    });
  }

  /** A new font or border changes wrapping; measure with the new look active. */
  private fitStyledMap(rootId: string) {
    if (!this.settings().canvasAutoFit) return;
    this.refresh();
    const { forest } = this.snapshot();
    for (const id of mapMembers(forest, rootId)) this.fitNode(id, true);
  }

  /** Refit changed levels inside the structural action's own history step. */
  private fitHierarchyChanges(before: Forest, created?: ReadonlySet<string>): boolean {
    const settings = this.settings();
    if (!settings.canvasAutoFit || !settings.canvasAppearance) return false;
    const after = this.snapshot().forest;
    const ids = [...new Set([...before.nodes.keys(), ...after.nodes.keys()])].filter((id) => {
      const previous = before.nodes.get(id);
      const current = after.nodes.get(id);
      return !created?.has(id) && this.canvas.nodes.get(id)?.getData().type === "text"
        && (previous?.depth !== current?.depth || previous?.root !== current?.root);
    });
    if (!ids.length) return false;
    // Root padding and inherited map typefaces change with the hierarchy too.
    this.refresh();
    let changed = false;
    for (const id of ids) changed = this.fitNode(id, after.nodes.has(id)) || changed;
    return changed;
  }

  /** Draw the selected card's map with these branch lines, stored on its root. */
  private setLine(choice: LineChoice): boolean {
    const rootId = this.styleRoot();
    if (!rootId) return false;
    const rootData = this.canvas.nodes.get(rootId)!.getData();
    if (rootData[LINE_KEY] === choice) return true;
    canvasTransaction(this.canvas, () => this.updateNode({ ...rootData, [LINE_KEY]: choice }));
    this.syncSignature();
    this.refresh();
    return true;
  }

  /** Frame each selected card's branch in a boundary, or take its boundary away. */
  private toggleBoundary(): boolean {
    const nodes = this.selectedMapNodes();
    if (!nodes.length) return false;
    const { forest } = this.snapshot();
    const roots = new Set(nodes.map((node) => forest.nodes.get(node.id)!.root));
    canvasTransaction(this.canvas, () => {
      for (const node of nodes) {
        const data = node.getData();
        this.updateNode(hasBoundary(data) ? withoutKeys(data, BOUNDARY_KEY) : { ...data, [BOUNDARY_KEY]: true });
      }
      this.tidy(roots);
    });
    this.syncSignature();
    this.refresh();
    this.playMoves();
    return true;
  }

  /** Show the selected card's map down to a level, folding what lies deeper. */
  private showLevels(level: number): boolean {
    const selected = this.selected()!;
    const { data, forest, hidden } = this.snapshot();
    const info = forest.nodes.get(selected.id)!;
    const rootId = info.root;
    const { fold, unfold } = planLevels(data, forest, rootId, level);
    const byId = new Map(data.nodes.map((node) => [node.id, node]));
    this.finishFolding(false);
    this.foldAway(fold, forest, hidden);
    canvasTransaction(this.canvas, () => {
      for (const id of fold) this.updateNode({ ...byId.get(id)!, [COLLAPSED_KEY]: true });
      for (const id of unfold) this.updateNode(withoutKeys(byId.get(id)!, COLLAPSED_KEY));
      this.tidy([rootId]);
    });
    this.syncSignature();
    // A selected card now folded away hands the selection to its ancestor at that level.
    let keep = selected.id;
    while (forest.nodes.get(keep)!.depth > level) keep = forest.nodes.get(keep)!.parent!;
    const kept = this.canvas.nodes.get(keep);
    if (kept && keep !== selected.id) this.canvas.selectOnly(kept);
    this.refresh();
    this.growRevealed(hidden);
    this.playMoves();
    return true;
  }

  /**
   * Cards that were folded away and are now shown grow out of the card that
   * held them, instead of sliding in from where they were hidden.
   */
  private growRevealed(hiddenBefore: Set<string>) {
    const { forest, hidden } = this.snapshot();
    for (const id of hiddenBefore) {
      if (hidden.has(id)) continue;
      let holder = forest.nodes.get(id)?.parent ?? null;
      while (holder && hiddenBefore.has(holder)) holder = forest.nodes.get(holder)?.parent ?? null;
      const from = holder ? this.canvas.nodes.get(holder)?.getData() : undefined;
      const card = this.canvas.nodes.get(id)?.getData();
      if (!from || !card) continue;
      this.moves.set(id, {
        x: Math.round(from.x + from.width / 2 - card.width / 2),
        y: Math.round(from.y + from.height / 2 - card.height / 2),
      });
    }
  }

  /**
   * Cards about to fold away glide into the card that holds them before
   * they hide: each carries the way to the holder's centre, in canvas
   * units, for the CSS to move its inner container along, and stays shown
   * until the motion is over. Their saved positions never change. Too many
   * cards, or no animation, hide at once.
   */
  private foldAway(holders: string[], forest: Forest, hidden: Set<string>) {
    if (!this.animates()) return;
    for (const holder of holders) {
      const from = this.canvas.nodes.get(holder)?.getData();
      if (!from) continue;
      const cx = from.x + from.width / 2;
      const cy = from.y + from.height / 2;
      for (const id of descendants(forest, holder)) {
        if (hidden.has(id) || this.folding.has(id)) continue;
        const node = this.canvas.nodes.get(id);
        const rect = node?.getData();
        if (!node || !rect || !node.nodeEl.style) continue;
        node.nodeEl.style.setProperty("--nf-fold-dx", `${Math.round(cx - rect.x - rect.width / 2)}px`);
        node.nodeEl.style.setProperty("--nf-fold-dy", `${Math.round(cy - rect.y - rect.height / 2)}px`);
        node.nodeEl.classList.add("nf-canvas-folding");
        this.folding.add(id);
        const edgeId = forest.nodes.get(id)?.edge;
        const edge = edgeId ? this.canvas.edges.get(edgeId) : undefined;
        if (!edgeId || !edge) continue;
        for (const el of [edge.lineGroupEl, edge.lineEndGroupEl]) el?.classList.add("nf-canvas-folding");
        this.folding.add(edgeId);
      }
    }
    if (!this.folding.size) return;
    if (this.folding.size > MOTION_LIMIT) {
      this.finishFolding(false);
      return;
    }
    this.foldTimer = this.win.setTimeout(() => {
      this.foldTimer = 0;
      this.finishFolding(true);
    }, MOTION_MS);
  }

  /** Land the folding cards: they hide now, as the saved data has them. */
  private finishFolding(refresh: boolean) {
    if (this.foldTimer) this.win.clearTimeout(this.foldTimer);
    this.foldTimer = 0;
    if (!this.folding.size) return;
    for (const id of this.folding) {
      const node = this.canvas.nodes.get(id);
      if (node) {
        node.nodeEl.classList.remove("nf-canvas-folding");
        node.nodeEl.style?.removeProperty("--nf-fold-dx");
        node.nodeEl.style?.removeProperty("--nf-fold-dy");
      }
      const edge = this.canvas.edges.get(id);
      if (edge) for (const el of [edge.lineGroupEl, edge.lineEndGroupEl]) el?.classList.remove("nf-canvas-folding");
    }
    this.folding.clear();
    if (refresh && !this.disposed) this.refresh();
  }

  /* ---------------------------------------------------------------- */
  /* Presenting                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Present the selected card's map branch by branch, or with no map card
   * selected, the whole canvas group by group. Given a card, the talk
   * opens at the stop about it.
   */
  present(fromId?: string): boolean {
    if (!this.active() || this.stage) return false;
    this.motion.finish();
    this.closeFind();
    this.closeNote();
    const { data, forest, hidden } = this.snapshot();
    const selected = fromId ? this.canvas.nodes.get(fromId) ?? null : this.selected();
    const info = selected ? forest.nodes.get(selected.id) : undefined;
    const steps = info ? mapSteps(data, forest, hidden, info.root) : canvasSteps(data, forest, hidden);
    if (!steps.length) return false;
    const stage = new Stage(
      this.canvas as unknown as StageHost, steps,
      (ids) => this.stageExtent(ids),
      (id) => {
        const node = this.canvas.nodes.get(id);
        return node ? cardTitle(node.getData(), 60) : "";
      },
      {
        overview: t("Overview"), previous: t("Previous"), next: t("Next"), fullscreen: t("Full screen"),
        exit: t("Stop presenting"), stage: t("Presentation"),
      },
      () => this.refresh(),
      () => this.stopPresenting(),
    );
    this.stage = stage;
    this.canvas.wrapperEl.classList.add("nf-canvas-presenting");
    for (const event of ["pointerdown", "mousedown", "click", "dblclick", "contextmenu"]) {
      this.canvas.wrapperEl.addEventListener(event, this.onStagePointer, true);
    }
    this.holdStageKeys();
    stage.start(fromId ? Math.max(0, stage.stepOf(fromId)) : 0);
    this.canvas.wrapperEl.focus();
    return true;
  }

  /**
   * What a stop frames: its cards as they are now, a group's label above
   * its box, and the boundaries around framed branches.
   */
  private stageExtent(ids: string[]): Box | null {
    const nodes = ids.map((id) => this.canvas.nodes.get(id)?.getData()).filter((node): node is CanvasNodeData => !!node);
    const box = boxOf(nodes);
    if (!box) return null;
    if (nodes.some((node) => node.type === "group")) {
      box.minY = Math.min(box.minY, ...nodes.filter((node) => node.type === "group").map((node) => node.y - GROUP_LABEL_ROOM));
    }
    const source = this.boundarySource;
    if (source) {
      const frames = boundaryBoxes(source.data, source.forest, source.hidden, (id) => this.canvas.nodes.get(id)?.getData());
      for (const id of ids) {
        const frame = frames.get(id);
        if (!frame) continue;
        box.minX = Math.min(box.minX, frame.minX);
        box.minY = Math.min(box.minY, frame.minY);
        box.maxX = Math.max(box.maxX, frame.maxX);
        box.maxY = Math.max(box.maxY, frame.maxY);
      }
    }
    return box;
  }

  stopPresenting() {
    const stage = this.stage;
    if (!stage) return;
    this.stage = null;
    this.releaseStageKeys();
    for (const event of ["pointerdown", "mousedown", "click", "dblclick", "contextmenu"]) {
      this.canvas.wrapperEl.removeEventListener(event, this.onStagePointer, true);
    }
    this.canvas.wrapperEl.classList.remove("nf-canvas-presenting");
    stage.destroy();
    if (!this.disposed) {
      this.refresh();
      this.canvas.wrapperEl.focus();
    }
  }

  /**
   * While presenting, the keys walk the stops. A scope of its own keeps
   * Canvas's keys (delete, nudge, edit) away from the cards on stage;
   * app-wide hotkeys still work.
   */
  private holdStageKeys() {
    const keymap = this.app?.keymap;
    if (!keymap || typeof keymap.pushScope !== "function") {
      this.win.addEventListener("keydown", this.onStageKey, true);
      return;
    }
    const scope = new Scope(this.app!.scope);
    scope.register(null, null, (evt) => this.stageKey(evt) ? false : undefined);
    keymap.pushScope(scope);
    this.stageScope = scope;
  }

  private releaseStageKeys() {
    this.win.removeEventListener("keydown", this.onStageKey, true);
    if (this.stageScope) this.app?.keymap?.popScope(this.stageScope);
    this.stageScope = null;
  }

  private stageKey(evt: KeyboardEvent): boolean {
    if (!this.stage || evt.isComposing || evt.ctrlKey || evt.metaKey || evt.altKey) return false;
    if (evt.shiftKey && evt.key !== " ") return false;
    return this.stage.handleKey(evt.key, evt.shiftKey);
  }

  private onStageKey = (evt: KeyboardEvent) => {
    if (this.stageKey(evt)) {
      evt.preventDefault();
      evt.stopPropagation();
    }
  };

  /**
   * The cards on stage are for looking at: a click shows the stop about a
   * card, a click on empty canvas walks on (back with Shift), and nothing
   * starts a drag, an edit, a selection, or a menu. The wheel still pans
   * and zooms, and the middle button still pans.
   */
  private onStagePointer = (evt: Event) => {
    const stage = this.stage;
    const target = evt.target as Element | null;
    if (!stage || target?.closest?.(".nf-canvas-stage")) return;
    const pointer = evt as MouseEvent;
    const primary = evt.type === "click" || evt.type === "dblclick" || evt.type === "contextmenu" || pointer.button === 0;
    if (!primary) return;
    evt.stopPropagation();
    evt.preventDefault();
    if (evt.type !== "click") return;
    const nodeEl = target?.closest?.(".canvas-node");
    if (!nodeEl) {
      // The second click of a double click is not a step of its own.
      if (!(pointer.detail > 1) && !target?.closest?.(".nf-canvas-ui")) stage.go(stage.index + (pointer.shiftKey ? -1 : 1));
      return;
    }
    for (const [id, node] of this.canvas.nodes) {
      if (node.nodeEl !== nodeEl) continue;
      const index = stage.stepOf(id);
      if (index >= 0 && index !== stage.index) stage.go(index);
      break;
    }
  };

  private copyOutline() {
    const selected = this.selected()!;
    const { data, forest } = this.snapshot();
    const { markdown, count } = branchOutline(data, forest, selected.id);
    const clipboard = this.win.navigator?.clipboard;
    if (!clipboard?.writeText) {
      new Notice(t("Could not access the clipboard."));
      return;
    }
    clipboard.writeText(markdown).then(
      () => new Notice(cardCount(t("Copied 1 card as a Markdown outline."), t("Copied {count} cards as a Markdown outline."), count)),
      () => new Notice(t("Could not access the clipboard.")),
    );
  }

  /** Grow cards from an outline below `parentId`, then tidy its map. */
  private insertOutline(parentId: string, items: OutlineItem[], forest: Forest, data: CanvasData): string[] {
    const parent = this.canvas.nodes.get(parentId)!.getData();
    const rootId = forest.nodes.get(parentId)?.root ?? parentId;
    const color = parent.color ? { color: parent.color } : {};
    const slot = planMapInsertion(data, forest, parentId, "child", TOPIC.width, TOPIC.height);
    const direction = slot?.direction ?? "right";
    const horizontal = direction === "left" || direction === "right";
    const origin = slot ?? { x: parent.x + parent.width, y: parent.y };
    const base = horizontal ? origin.y + TOPIC.height / 2 : origin.x + TOPIC.width / 2;
    const nodes: CanvasNodeData[] = [];
    const edges: CanvasEdgeData[] = [];
    // Provisional slots only fix the reading order; the tidy layout places them.
    const pending: [OutlineItem, string, number][] = items.map((item, index) => [item, parentId, base + index]);
    while (pending.length) {
      const [item, from, cross] = pending.shift()!;
      const id = this.newId();
      const height = TOPIC.height + 24 * (item.text.split("\n").length - 1);
      nodes.push({
        id, type: "text", text: topicText(item.text), width: TOPIC.width, height, ...color,
        x: Math.round(horizontal ? origin.x : cross - TOPIC.width / 2),
        y: Math.round(horizontal ? cross - height / 2 : origin.y),
      });
      edges.push({ id: this.newId(), fromNode: from, toNode: id, ...sidesFor(direction), toEnd: "none", ...color });
      item.children.forEach((child, index) => pending.push([child, id, cross + index]));
    }
    if (isCollapsed(parent)) this.updateNode(withoutKeys(parent, COLLAPSED_KEY));
    this.canvas.importData({ nodes, edges }, false);
    this.reserved.clear();
    this.tidy([rootId]);
    return nodes.map((node) => node.id);
  }

  /** Expand the selected card's Markdown list into child cards. */
  private explode(): boolean {
    const selected = this.selected()!;
    const nodeData = selected.getData();
    const { text, items } = explodeText(String(nodeData.text ?? ""))!;
    let created: string[] = [];
    canvasTransaction(this.canvas, () => {
      const update: CanvasNodeData = { ...nodeData, text };
      const { forest } = this.snapshot();
      if (!forest.nodes.has(selected.id)) update[LAYOUT_KEY] = "right";
      this.updateNode(update);
      const after = this.snapshot();
      created = this.insertOutline(selected.id, items, after.forest, after.data);
    });
    this.afterInsert(selected.id, created);
    // The card now holds only its title: fit its height too.
    if (this.settings().canvasAutoFit) this.queueFit(selected.id);
    new Notice(cardCount(t("Created 1 card from the list."), t("Created {count} cards from the list."), countOutline(items)));
    return true;
  }

  private onPaste = (evt: ClipboardEvent) => {
    if (!this.active() || this.canvas.readonly || evt.defaultPrevented) return;
    this.motion.finish();
    const selected = this.selected();
    const clipboard = evt.clipboardData;
    if (!selected || !clipboard) return;
    // Cards, files, and images keep Canvas's own paste.
    if (Array.from(clipboard.types ?? []).some((type) => type !== "text/plain" && type !== "text/html")) return;
    const { data, forest } = this.snapshot();
    if (!forest.nodes.has(selected.id)) return;
    const outline = parseOutline(clipboard.getData("text/plain"));
    if (!outline) return;
    evt.preventDefault();
    evt.stopPropagation();
    const lead = [outline.lead, outline.trail].filter(Boolean).join("\n\n");
    const items = lead ? [{ text: lead, children: outline.items }] : outline.items;
    let created: string[] = [];
    canvasTransaction(this.canvas, () => { created = this.insertOutline(selected.id, items, forest, data); });
    this.afterInsert(selected.id, created);
    new Notice(cardCount(t("Pasted 1 card as a branch."), t("Pasted {count} cards as branches."), countOutline(items)));
  };

  /** Fit freshly rendered cards to their text, as part of the same step. */
  private afterInsert(parentId: string, ids: string[]) {
    this.createdStep = this.canvas.history.data[this.canvas.history.current];
    this.syncSignature();
    this.refresh();
    this.reveal([parentId, ...ids]);
    this.playMoves();
    if (!ids.length || !this.settings().canvasAutoFit) return;
    for (const id of ids) {
      // Canvas renders only cards near the viewport; a card must be
      // rendered before its text can be measured.
      const node = this.canvas.nodes.get(id);
      node?.attach?.();
      node?.render?.();
      this.queueFit(id);
      this.created.add(id);
    }
    this.settleSoon(150, true);
  }

  /**
   * Fit a text card; null means its Markdown preview is not measurable yet.
   * With `grow`, the card only gains height, keeping its width and any room
   * it already has, and never so much that it reaches the card below it.
   */
  private fitNode(id: string, width: boolean, grow = false): boolean | null {
    const node = this.canvas.nodes.get(id);
    if (!node || node.getData().type !== "text" || typeof node.resize !== "function"
      || isEditingNode(node)) return false;
    const before = node.getData();
    const empty = !String(before.text ?? "").trim();
    if (!node.nodeEl.isConnected) {
      node.attach?.();
      node.render?.();
    }
    const mode = this.sizeMode();
    const fitWidth = width && mode !== "preserve";
    const info = this.snapshot().forest.nodes.get(id);
    const depth = info?.depth;
    if (this.settings().canvasAppearance && depth !== undefined) {
      applyTopicTypography(node.nodeEl, depth, isRichText(String(before.text ?? "")));
    } else clearTopicTypography(node.nodeEl);
    // The measuring clone takes the same minimum as the fit, or plain words would measure a box.
    const boxless = this.isBoxless(info, empty);
    const min = boxless ? BOXLESS_MIN_WIDTH
      : depth === 0 ? (mode === "compact" ? 112 : 160) : (mode === "compact" ? 80 : 112);
    const measured = empty ? before
      : measureCard(node.nodeEl, fitWidth ? 480 : before.width, min, fitWidth, boxless ? HUG_SLACK : undefined);
    if (!measured) return null;
    const after = fittedCardSize({ before, measured, fitWidth, mode, depth, empty, grow, boxless });
    if (grow) after.height = Math.max(before.height, Math.min(after.height, roomBelow(this.canvas.getData(), id)));
    if (after.width === before.width && after.height === before.height) return false;
    node.resize(after);
    node.render?.();
    return true;
  }

  /**
   * A topic drawn as plain words or on an underline, with no box around it:
   * Clean below the main branches, Minimal below the centre, and the
   * underline outline below the centre. Its card hugs its words, so its line
   * leaves where they end. An empty topic keeps its box-sized placeholder.
   */
  private isBoxless(info: TreeNode | undefined, empty: boolean): boolean {
    if (!info || empty || info.depth === 0 || !this.settings().canvasAppearance) return false;
    const rootData = this.canvas.nodes.get(info.root)?.getData();
    const theme = this.themeOf(rootData);
    return this.shapeOf(rootData) === "underline" || theme === "minimal" || (theme === "clean" && info.depth >= 2);
  }

  /**
   * Once per file, after it opens: refit map cards whose words no longer fit
   * — after a new typeface, text size, or theme changed how they wrap — so no
   * topic hides behind a scrollbar. Empty topics stored as hairlines grow back
   * to a placeholder that can be clicked, and words fitted to a box before
   * their look drew none hug them. One undoable step; nothing when all fit;
   * hairline repairs alone add no step.
   */
  private healOverflow() {
    this.healTimer = 0;
    const path = this.view.file?.path;
    if (!path || this.healed.has(path) || this.disposed) return;
    const settings = this.settings();
    if (!this.active() || this.canvas.readonly || !settings.canvasAppearance || !settings.canvasAutoFit) return;
    // Busy: the next refresh (every edit, drag, or selection has one) asks again.
    if (this.gesture || this.canvas.isDragging || this.motion.active || [...this.canvas.nodes.values()].some(isEditingNode)) return;
    this.healed.add(path);
    const { forest } = this.snapshot();
    const mode = this.sizeMode();
    const compact = mode === "compact";
    const cramped: string[] = [];
    const hairline: string[] = [];
    const legacyWide: string[] = [];
    for (const [id, info] of forest.nodes) {
      const node = this.canvas.nodes.get(id);
      const data = node?.getData();
      if (!node || !data || data.type !== "text" || node.nodeEl.classList.contains("nf-canvas-hidden")) continue;
      if (!String(data.text ?? "").trim()) {
        // The same minimum heights as fittedCardSize.
        const minHeight = info.depth === 0 ? (compact ? 48 : 64) : (compact ? 36 : 52);
        if (data.height < minHeight) hairline.push(id);
        continue;
      }
      if (!node.nodeEl.isConnected) continue;
      if (this.cramped(node)) cramped.push(id);
      // Exactly the box minimum of earlier fits, on words that draw no box.
      else if (mode !== "preserve" && data.width === (compact ? 80 : 112) && this.isBoxless(info, false)) legacyWide.push(id);
    }
    const heal = [...cramped, ...legacyWide, ...hairline];
    if (!heal.length) return;
    const roots = new Set(heal.map((id) => forest.nodes.get(id)!.root));
    canvasAdjustment(this.canvas, () => {
      let changed = false;
      for (const id of heal) changed = this.fitNode(id, true) || changed;
      if (changed && settings.canvasAutoLayout) changed = this.tidy(roots) || changed;
      return changed;
    }, !cramped.length && !legacyWide.length);
    this.syncSignature();
    this.refresh();
    this.playMoves();
  }

  private sizeMode(): CanvasCardSizeMode {
    const mode = this.settings().canvasCardSize;
    return mode === "compact" || mode === "preserve" ? mode : "comfortable";
  }

  /**
   * Follow the native draft while leaving saved geometry and undo untouched.
   * Every text card being typed in gets a surface: it binds Enter and Tab,
   * carries a topic's type into the editor and, with comfortable editing,
   * lets the card grow in place. `shape` is how it may grow, from its place
   * in its map.
   */
  private updateEditor(node: LiveNode, editing: boolean, shape?: Omit<EditorGeometry, "size">) {
    const enabled = editing && !this.canvas.readonly && node.getData().type === "text";
    toggle(node.nodeEl, "nf-canvas-editing", enabled && this.settings().canvasComfortableEdit !== false);
    const surface = this.editorSurfaces.get(node);
    if (!enabled) {
      surface?.destroy();
      this.editorSurfaces.delete(node);
      this.editorShapes.delete(node);
      if (!this.editorSurfaces.size) this.releaseEditKeys();
      return;
    }
    if (shape) this.editorShapes.set(node, shape);
    if (surface) surface.update();
    else this.editorSurfaces.set(node, new CanvasEditorSurface(node.nodeEl, () => node.child?.editMode?.cm,
      () => ({ size: node.getData(), ...(this.editorShapes.get(node) ?? FREE_EDITOR) }),
      () => this.settings().canvasComfortableEdit !== false, (cm) => this.bindEditorKeys(node, cm)));
  }

  /**
   * Enter finishes a card and leaves it selected, so the next Enter adds the
   * card after it and Tab a child, as in mind-map apps; Tab finishes and
   * adds a child at once. The binding is made as soon as the editor exists,
   * so no early key reaches it unhandled.
   */
  private bindEditorKeys(node: LiveNode, cm: EditorView) {
    if (this.editorKeys.has(cm) || typeof cm.contentDOM?.addEventListener !== "function") return;
    const handler = (evt: KeyboardEvent) => this.onEditorKey(node, cm, evt);
    cm.contentDOM.addEventListener("keydown", handler, true);
    this.editorKeys.set(cm, handler);
    const { data, forest } = this.snapshot();
    const topic = forest.nodes.has(node.id) || isSummary(data.nodes.find((item) => item.id === node.id));
    // The keyboard opened this editor: the caret goes where the key said.
    const caret = this.editCaret;
    if (caret?.id === node.id) {
      this.editCaret = null;
      const length = cm.state?.doc?.length ?? 0;
      if (typeof cm.dispatch === "function") {
        try {
          cm.dispatch({ selection: caret.mode === "all" ? { anchor: 0, head: length } : { anchor: length } });
        } catch (error) {
          console.error("Notion Flow: could not place the caret", error);
        }
      }
      cm.focus?.();
    }
    // An empty topic asks for a topic, not for a block.
    const placeholder = cm.contentDOM.querySelector?.(".cm-placeholder");
    if (placeholder && topic) placeholder.textContent = t("Type a topic…");
    // So does the note editor's empty-line hint, which reads its words from
    // this property; the card's frame does not inherit the translated one.
    if (topic) cm.scrollDOM?.style?.setProperty?.("--nf-empty-hint", JSON.stringify(t("Type a topic…")));
    this.holdEditKeys();
  }

  private unbindEditorKeys() {
    for (const [cm, handler] of this.editorKeys) cm.contentDOM?.removeEventListener?.("keydown", handler, true);
    this.editorKeys.clear();
  }

  /**
   * Mod+Enter finishes the card from anywhere, a list or code included.
   * Hotkeys bound to it (Obsidian's "open link in new tab" and this plugin's
   * own) take the key in Obsidian's keymap before the editor sees it, so a
   * scope of ours goes on top while a card is typed in. Its one handler
   * takes every key, so all but Mod+Enter, and Mod+Enter on a link, fall
   * through to the scope below: the workspace's, which hands keys to the
   * view in front, and then the app's hotkeys.
   */
  private holdEditKeys() {
    const keymap = this.app?.keymap;
    if (this.editScope || !keymap || typeof keymap.pushScope !== "function") return;
    const below = (this.app!.workspace as unknown as { scope?: Scope } | undefined)?.scope ?? this.view.scope ?? this.app!.scope;
    const scope = new Scope(below);
    scope.register(null, null, (evt) => {
      // Mod+Shift+K links another card from the words being typed, as Mod+K links a note or a page.
      if ((evt.key === "k" || evt.key === "K") && evt.shiftKey && !evt.altKey && evt.metaKey !== evt.ctrlKey && !evt.isComposing) {
        const typing = this.typingCard();
        const target = evt.target as Node | null;
        if (evt.repeat || !typing || !target || !typing.cm.dom?.contains?.(target) || !this.canRun("insertCardLink")) return undefined;
        this.pickCardLink();
        return false;
      }
      if (evt.key !== "Enter" || evt.shiftKey || evt.altKey || evt.metaKey === evt.ctrlKey || evt.isComposing || evt.repeat) return undefined;
      if (!this.active() || this.canvas.readonly) return undefined;
      const node = [...this.editorSurfaces.keys()].find((item) => isEditingNode(item) && this.canvas.nodes.get(item.id) === item);
      const cm = node?.child?.editMode?.cm;
      if (!node || !cm || typeof node.child?.showPreview !== "function") return undefined;
      // Only while typing in that card: another pane keeps its own Mod+Enter.
      const target = evt.target as Node | null;
      if (!target || !cm.dom?.contains?.(target)) return undefined;
      const doc = cm.state.doc.toString();
      const head = cm.state.selection?.main.head ?? doc.length;
      // On a link to a card, the card is finished and the linked card shown,
      // as a click on the link does; Obsidian would open this canvas again.
      const href = linkTargetAt(doc, head);
      const card = href === null ? null : this.cardOfHref(href);
      if (card !== null) {
        try {
          this.motion.finish();
          this.finishEditing(node, cm);
          if (card) this.goToCard(card);
          else new Notice(t("The linked card is no longer on this canvas."));
        } catch (error) {
          console.error("Notion Flow: could not follow the card link", error);
        }
        return false;
      }
      if (this.settings().canvasEditorKeys === false) return undefined;
      // On a link, Obsidian opens it, as it does everywhere else.
      if (linkAt(doc, head)) return undefined;
      try {
        this.motion.finish();
        this.finishEditing(node, cm);
        this.canvas.wrapperEl.focus();
      } catch (error) {
        console.error("Notion Flow: could not finish the card", error);
      }
      return false;
    });
    keymap.pushScope(scope);
    this.editScope = scope;
  }

  private releaseEditKeys() {
    if (this.editScope) this.app?.keymap?.popScope(this.editScope);
    this.editScope = null;
  }

  /**
   * Keys while typing in a text card. Enter finishes it; Shift+Enter breaks
   * the line, and in a list, a quote, a table or code Enter and Tab stay the
   * editor's. Tab finishes the card and starts a child, and Shift+Tab takes
   * a topic up a level. Esc finishes from anywhere, as does Mod+Enter when no
   * hotkey takes it first (Obsidian's own and this plugin's bind it by default).
   * Esc is taken here, ahead of the note editor's own Escape, which would
   * select the caret's block inside the card and leave the card open.
   */
  private onEditorKey(node: LiveNode, cm: EditorView, evt: KeyboardEvent) {
    // 229 is a key an input method is still composing with, whatever else it says.
    if (evt.isComposing || evt.keyCode === 229 || cm.composing || evt.repeat || evt.defaultPrevented || evt.altKey) return;
    if (!this.active() || this.canvas.readonly || this.settings().canvasEditorKeys === false) return;
    if (this.canvas.nodes.get(node.id) !== node || !isEditingNode(node) || typeof node.child?.showPreview !== "function") return;
    const docs = [this.canvas.wrapperEl.ownerDocument, cm.dom?.ownerDocument];
    // A suggestion popup owns Enter, Tab and Esc while it is open.
    const popup = () => docs.some((doc) => doc?.querySelector?.(".suggestion-container, .cm-tooltip-autocomplete"));
    const anywhere = evt.key === "Enter" && !evt.shiftKey && evt.metaKey !== evt.ctrlKey;
    if (evt.key === "Escape") {
      // Vim's Escape leaves insert mode; the card closes as Canvas closes it.
      if (evt.shiftKey || evt.ctrlKey || evt.metaKey || popup() || this.vimMode()) return;
    } else if (!anywhere) {
      if ((evt.key !== "Enter" && evt.key !== "Tab") || evt.ctrlKey || evt.metaKey) return;
      if (evt.key === "Enter" && evt.shiftKey) return;
      if (popup()) return;
      const doc = cm.state.doc.toString();
      if (markdownOwnsKeys(doc, cm.state.selection?.main.head ?? doc.length)) return;
      // Outside a map there is no level to go up: Shift+Tab stays the editor's.
      if (evt.key === "Tab" && evt.shiftKey && !this.snapshot().forest.nodes.has(node.id)) return;
    }
    evt.preventDefault();
    evt.stopPropagation();
    this.motion.finish();
    const text = this.finishEditing(node, cm);
    if (evt.key === "Enter" || evt.key === "Escape") {
      this.canvas.wrapperEl.focus();
      return;
    }
    if (evt.shiftKey) {
      this.outdentFromEditor(node);
      return;
    }
    // An empty card only finishes: nothing grows from a blank.
    if (!text || !this.canRun("child") || !this.run("child")) this.canvas.wrapperEl.focus();
  }

  /** Whether Obsidian's editors take Vim keys. */
  private vimMode(): boolean {
    const vault = this.app?.vault as unknown as { getConfig?: (key: string) => unknown } | undefined;
    return vault?.getConfig?.call(vault, "vimMode") === true;
  }

  /** Close a card's editor from the keyboard, the card still selected. Returns its words, if any. */
  private finishEditing(node: LiveNode, cm: EditorView): string {
    const doc = cm.state.doc.toString();
    const text = withoutTrailingBlank(doc);
    // The line break that ended a list or a paragraph is not part of the card.
    if (text.length < doc.length && typeof cm.dispatch === "function") {
      try {
        cm.dispatch({ changes: { from: text.length, to: doc.length } });
      } catch (error) {
        console.error("Notion Flow: could not trim the card", error);
      }
    }
    node.child!.showPreview!(true);
    // Canvas clears its own editing flag on the next click; the card is done now.
    node.setIsEditing?.(false);
    this.refresh();
    return text.trim() ? text : "";
  }

  /**
   * Shift+Tab while typing: the topic moves up a level and typing goes on
   * in it; a main branch, which cannot, hands the typing to its parent.
   */
  private outdentFromEditor(node: LiveNode) {
    let target: LiveNode | null = null;
    if (this.canRun("outdent") && this.run("outdent")) target = node;
    else if (this.canRun("parent") && this.selectParent()) target = this.selected();
    if (target && this.selected() === target && this.canRun("edit")) {
      this.editCaret = { id: target.id, mode: "end" };
      this.run("edit");
    } else this.canvas.wrapperEl.focus();
  }

  private fitSelection(): boolean {
    const nodes = this.selectedNodes().filter((node) => node.getData().type === "text");
    canvasAdjustment(this.canvas, () => {
      let changed = false;
      for (const node of nodes) changed = this.fitNode(node.id, true) || changed;
      if (this.settings().canvasAutoLayout) changed = this.tidy() || changed;
      return changed;
    });
    this.syncSignature();
    this.refresh();
    this.playMoves();
    return true;
  }

  private selectBranch(): boolean {
    const selected = this.selected()!;
    const { data, forest, hidden } = this.snapshot();
    const ids = forest.nodes.has(selected.id)
      ? [selected.id, ...descendants(forest, selected.id)]
      : [...buildBranch(data, selected.id)];
    const nodes = ids.filter((id) => !hidden.has(id)).map((id) => this.canvas.nodes.get(id)!).filter(Boolean);
    if (typeof this.canvas.selectAll !== "function") return false;
    this.canvas.selectAll(nodes);
    this.refresh();
    return true;
  }

  private moveAmongSiblings(step: -1 | 1): boolean {
    const selected = this.selected()!;
    const { data, forest } = this.snapshot();
    const position = planSiblingMove(data, forest, selected.id, step);
    if (!position) return false;
    const rootId = forest.nodes.get(selected.id)!.root;
    canvasTransaction(this.canvas, () => {
      this.track(selected.id);
      selected.moveTo({ x: Math.round(position.x), y: Math.round(position.y) });
      this.tidy([rootId], new Map(data.nodes.map((node) => [node.id, node])));
    });
    this.syncSignature();
    this.reveal([selected.id]);
    this.refresh();
    this.playMoves();
    return true;
  }

  /** The sibling read before `id` on its side of the parent, or null for the first. */
  private previousSibling(data: CanvasData, forest: Forest, id: string): string | null {
    const info = forest.nodes.get(id);
    if (!info?.parent) return null;
    const siblings = orderedChildren(data, forest, info.parent)
      .filter((sibling) => forest.nodes.get(sibling)!.direction === info.direction);
    return siblings[siblings.indexOf(id) - 1] ?? null;
  }

  /** Move the selected card, with its branch, up a level: right after its parent. */
  private outdent(): boolean {
    const selected = this.selected()!;
    const { data, forest } = this.snapshot();
    const info = forest.nodes.get(selected.id);
    const parent = info?.parent ? forest.nodes.get(info.parent) : undefined;
    if (!parent?.parent) return false;
    const { width, height } = selected.getData();
    const slot = planMapInsertion(data, forest, parent.id, "sibling", width, height);
    return !!slot && this.restructure(selected.id, parent.parent, slot, forest);
  }

  /** Move the selected card, with its branch, under the sibling before it. */
  private indent(): boolean {
    const selected = this.selected()!;
    const { data, forest } = this.snapshot();
    const previous = this.previousSibling(data, forest, selected.id);
    if (!previous) return false;
    const { width, height } = selected.getData();
    const slot = planMapInsertion(data, forest, previous, "child", width, height);
    return !!slot && this.restructure(selected.id, previous, slot, forest);
  }

  /** Hang a card from another card of its map and tidy the map, as one undo step. */
  private restructure(id: string, targetId: string, slot: MapInsertion, forest: Forest): boolean {
    const root = forest.nodes.get(targetId)?.root;
    if (!root) return false;
    let moved = false;
    canvasTransaction(this.canvas, () => {
      moved = this.moveUnder(id, targetId, slot, forest);
      if (moved) this.tidy([root]);
    });
    if (!moved) return false;
    this.syncSignature();
    this.reveal([id]);
    this.refresh();
    this.playMoves();
    return true;
  }

  /**
   * Delete a card and everything below it, with the summaries that covered
   * any of them, as one undo step; then select the card now in its place.
   */
  private deleteBranch(id: string): boolean {
    const remove = typeof this.canvas.removeNode === "function" ? this.canvas.removeNode.bind(this.canvas) : null;
    if (!remove || this.canvas.readonly) return false;
    const snapshot = this.snapshot();
    const { data, forest } = snapshot;
    const info = forest.nodes.get(id);
    if (!info) return false;
    const removing = new Set([id, ...descendants(forest, id)]);
    for (const list of summaryIndex(data, forest).values()) {
      for (const summary of list) {
        if (removing.has(summary.parent) || removing.has(summary.from) || removing.has(summary.to)) removing.add(summary.id);
      }
    }
    const nodes = [...removing].map((item) => this.canvas.nodes.get(item)).filter((node): node is LiveNode => !!node);
    // The branch goes whole: there are no orphans to re-attach.
    this.pending.deleted = undefined;
    canvasTransaction(this.canvas, () => {
      for (const node of nodes) {
        for (const edge of [...this.canvas.edges.values()]) {
          const { fromNode, toNode } = edge.getData();
          if (fromNode === node.id || toNode === node.id) this.removeEdges([edge]);
        }
        remove(node);
        this.created.delete(node.id);
      }
      this.tidy([info.root]);
    });
    this.selectAfterDelete({ ...snapshot, selected: [id] });
    this.syncSignature();
    this.refresh();
    this.playMoves();
    new Notice(t("Deleted {n} cards").replace("{n}", String(nodes.length)));
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* Keeping maps tidy after native changes                           */
  /* ---------------------------------------------------------------- */

  private settleSoon(delay = 0, amendLatest = false) {
    // A pointer release or layout refresh must not shorten the wait for the
    // Markdown preview which replaced an editor.
    if (this.settleTimer && delay === 0 && this.pending.fit.size) return;
    if (this.settleTimer) this.win.clearTimeout(this.settleTimer);
    this.settleTimer = this.win.setTimeout(() => {
      this.settleTimer = 0;
      this.settle(amendLatest);
    }, delay);
  }

  private queueFit(id: string, editHistory?: EditHistory) {
    const data = this.canvas.nodes.get(id)?.getData();
    if (!data) return;
    this.pending.fit.add(id);
    this.pending.fitRetries?.delete(id);
    this.pending.fitStep?.delete(id);
    this.pending.fitEdit?.delete(id);
    (this.pending.fitVersion ??= new Map()).set(id, {
      text: String(data.text ?? ""), width: data.width, height: data.height,
    });
    if (editHistory) (this.pending.fitEdit ??= new Map()).set(id, editHistory);
  }

  private editedStep(id: string, editHistory?: EditHistory): CanvasData | undefined {
    const data = this.canvas.nodes.get(id)?.getData();
    if (!data) return;
    const history = this.canvas.history;
    const top = history.data[history.current];
    const previous = history.data[history.current - 1];
    // Native typing can already have entered history during a pause before
    // Escape. Join that exact text-only step rather than adding a size-only
    // undo. Never merge into another card's edit, a resize, or a restored redo.
    if (editHistory?.step && history.current > editHistory.index
      && history.data[editHistory.index] === editHistory.step
      && history.data[editHistory.index + 1] !== editHistory.next
      && top && previous
      && String(previous.nodes.find((node) => node.id === id)?.text ?? "") !== String(data.text ?? "")
      && canvasStateSignature(top) === canvasStateSignature(this.canvas.getData())
      && canvasStateSignature(top, id) === canvasStateSignature(previous, id)) {
      return top;
    }
  }

  private settle(amendLatest = false) {
    if (!this.active() || this.canvas.readonly) {
      this.pending = { fit: new Set() };
      return;
    }
    // A drag or resize in progress settles when the pointer is released.
    if (this.gesture || this.canvas.isDragging) return;
    // Typing (including IME composition) never moves the surrounding map.
    if ([...this.canvas.nodes.values()].some(isEditingNode)) {
      this.fitBesideTyping();
      return;
    }
    // Let gliding cards land first; a new layout mid-glide would jolt them.
    if (this.motion.active) {
      this.settleSoon(MOTION_MS / 2, amendLatest);
      return;
    }
    const pending = this.pending;
    this.pending = { fit: new Set() };
    if (pending.removeEmpty?.size) this.removeEmptyCards(pending.removeEmpty);
    const hadFits = pending.fit.size > 0;
    // An undo, redo, deletion, or manual resize may have overtaken this delayed
    // measurement. Never fit a restored state or overwrite its redo history.
    for (const id of pending.fit) {
      const editedStep = this.editedStep(id, pending.fitEdit?.get(id));
      if (editedStep) (pending.fitStep ??= new Map()).set(id, editedStep);
      const expected = pending.fitVersion?.get(id);
      const current = this.canvas.nodes.get(id)?.getData();
      const step = pending.fitStep?.get(id);
      if (!current || expected && (expected.text !== String(current.text ?? "")
        || expected.width !== current.width || expected.height !== current.height)
        || step && (this.canvas.history.data[this.canvas.history.current] !== step
          || canvasStateSignature(this.canvas.getData()) !== canvasStateSignature(step))) pending.fit.delete(id);
    }
    if (hadFits && !pending.fit.size && !pending.drop && !pending.deleted) {
      this.syncSignature();
      return;
    }
    const settings = this.settings();
    // Fitting cards that were just created, with nothing in between, is
    // part of creating them.
    const history = this.canvas.history;
    if (pending.fit.size && [...pending.fit].every((id) => this.created.has(id))
      && history.data[history.current] === this.createdStep && this.createdStep) amendLatest = true;
    if (pending.fit.size && [...pending.fit].every((id) => pending.fitStep?.get(id) === history.data[history.current])
      && history.data[history.current]) amendLatest = true;
    const beforeStep = history.data[history.current];
    const deferred = new Set<string>();
    const adjusted = canvasAdjustment(this.canvas, () => {
      let changed = false;
      if (settings.canvasAutoLayout && pending.drop) changed = this.reparent(pending.drop, pending.rects) || changed;
      // A deletion settles within a frame or two; an old snapshot is stale.
      if (settings.canvasAutoLayout && pending.deleted && Date.now() - pending.deleted.at < 2000) {
        changed = this.reattachOrphans(pending.deleted) || changed;
      }
      const mapped = this.snapshot().forest;
      for (const id of pending.fit) {
        // A map card fits its words both ways; a free card only gains height.
        const inMap = mapped.nodes.has(id);
        if (inMap ? !settings.canvasAutoFit : settings.canvasComfortableEdit === false) continue;
        const fit = this.fitNode(id, inMap, !inMap);
        if (fit === null) deferred.add(id);
        else changed = fit || changed;
      }
      // Wait for the new card box before moving its neighbours. Other canvas
      // gestures can still settle even when one Markdown preview is pending.
      const awaitingPreview = [...deferred].some((id) => (pending.fitRetries?.get(id) ?? 0) < 5);
      if (settings.canvasAutoLayout && (!awaitingPreview || pending.drop || pending.deleted)) {
        changed = this.tidy(undefined, pending.rects) || changed;
      }
      return changed;
    }, amendLatest);
    const settledStep = history.data[history.current];
    for (const id of deferred) {
      const retries = pending.fitRetries?.get(id) ?? 0;
      if (retries >= 5) continue;
      this.pending.fit.add(id);
      (this.pending.fitRetries ??= new Map()).set(id, retries + 1);
      const expected = pending.fitVersion?.get(id);
      if (expected) (this.pending.fitVersion ??= new Map()).set(id, expected);
      // Preserve the original edit's history slot across an asynchronous
      // render, but never amend a different action, an undo, or a redo.
      if (settledStep && (amendLatest || adjusted || settledStep !== beforeStep)) {
        (this.pending.fitStep ??= new Map()).set(id, settledStep);
      }
    }
    // A card left empty is still new: it narrows once it has words.
    for (const id of pending.fit) {
      if (!deferred.has(id) && String(this.canvas.nodes.get(id)?.getData().text ?? "").trim()) this.created.delete(id);
    }
    if (this.pending.fit.size) this.settleSoon(120);
    this.syncSignature();
    if (settings.canvasAutoLayout && pending.deleted) this.selectAfterDelete(pending.deleted);
    this.refresh();
    this.playMoves();
  }

  /**
   * A card finished to grow a child or a sibling (Tab, or a toolbar button
   * while typing) would keep its old box while the new card is typed in, and
   * words added to a card that hugs them wrap and clip there. Such a card
   * grows taller at once, as far as the room below it allows, into the step
   * that made the new card, so one undo takes both away. Only taller: Canvas
   * resizes from the top left, so a wider card would reach across the gap
   * into its own parent (a branch hanging left) or under the card being typed
   * (one hanging right). Its width is fitted with the tidy once the typing
   * ends. Only cards whose words overflow their box: a card that will narrow
   * waits, and nothing moves until the typing ends.
   */
  private fitBesideTyping() {
    const history = this.canvas.history;
    const top = history.data[history.current];
    if (!top || top !== this.createdStep || !this.settings().canvasAutoFit || !this.pending.fit.size) return;
    if (this.motion.active) {
      this.settleSoon(MOTION_MS / 2);
      return;
    }
    const { forest } = this.snapshot();
    const due = [...this.pending.fit].filter((id) => {
      const node = this.canvas.nodes.get(id);
      const current = node?.getData();
      const expected = this.pending.fitVersion?.get(id);
      return !!node && !!current && !isEditingNode(node) && forest.nodes.has(id) && current.type === "text"
        && (!expected || expected.text === String(current.text ?? "") && expected.width === current.width
          && expected.height === current.height)
        && this.cramped(node);
    });
    if (!due.length) return;
    const grown: string[] = [];
    canvasAdjustment(this.canvas, () => {
      let changed = false;
      for (const id of due) {
        const fit = this.fitNode(id, false, true);
        if (fit === null) continue;
        grown.push(id);
        changed = fit || changed;
      }
      return changed;
    }, true);
    for (const id of grown) {
      // Still due its full fit once the typing ends, from the box it has now.
      const data = this.canvas.nodes.get(id)?.getData();
      if (data) this.pending.fitVersion?.set(id, { text: String(data.text ?? ""), width: data.width, height: data.height });
      this.pending.fitStep?.delete(id);
    }
    // The amended step stands for the new card's creation from here on.
    this.createdStep = history.data[history.current];
    this.syncSignature();
    this.refresh();
  }

  /** Whether a card's rendered words overflow its box, as when they wrap in a box fitted to fewer. */
  private cramped(node: LiveNode): boolean {
    const preview = node.nodeEl.querySelector<HTMLElement>(".markdown-preview-view");
    return !!preview && preview.clientHeight > 0 && preview.scrollHeight > preview.clientHeight + 2;
  }

  /**
   * A card this session created and that was left empty is taken away when
   * its editor closes, so Escape on a fresh topic leaves no blank behind.
   * The card it grew from, else the one it hung from, is selected, so the
   * keyboard carries on where it was.
   */
  private removeEmptyCards(ids: Set<string>) {
    const remove = typeof this.canvas.removeNode === "function" ? this.canvas.removeNode.bind(this.canvas) : null;
    if (!remove) return;
    const { data, forest } = this.snapshot();
    const nodes = [...ids].map((id) => this.canvas.nodes.get(id)).filter((node): node is LiveNode => !!node
      && node.getData().type === "text" && !String(node.getData().text ?? "").trim() && !isEditingNode(node));
    if (!nodes.length) return;
    const selected = new Set(this.selectedNodes().map((node) => node.id));
    const byId = new Map(data.nodes.map((node) => [node.id, node]));
    const homes = nodes.map((node) => {
      const from = this.createdFrom.get(node.id);
      return from && this.canvas.nodes.has(from) ? from
        : forest.nodes.get(node.id)?.parent ?? summaryLink(byId.get(node.id))?.parent ?? findParent(data, node.id);
    });
    canvasTransaction(this.canvas, () => {
      for (const node of nodes) {
        for (const edge of [...this.canvas.edges.values()]) {
          const { fromNode, toNode } = edge.getData();
          if (fromNode === node.id || toNode === node.id) this.removeEdges([edge]);
        }
        remove(node);
        this.created.delete(node.id);
        this.createdFrom.delete(node.id);
      }
      this.tidy();
    });
    nodes.forEach((node, index) => {
      const home = homes[index] ? this.canvas.nodes.get(homes[index]!) : undefined;
      if (selected.has(node.id) && home && !this.canvas.selection.size) this.canvas.selectOnly(home);
    });
    this.syncSignature();
  }

  /**
   * After deleting one map card, select the card now in its place — its
   * first child, which moved up — else its next sibling, the one before it,
   * or its parent, so the keyboard can carry on from there.
   */
  private selectAfterDelete(before: Snapshot & { selected: string[] }) {
    if (before.selected.length !== 1 || this.canvas.selection.size) return;
    const [id] = before.selected;
    const info = before.forest.nodes.get(id);
    if (!info?.parent || this.canvas.nodes.has(id)) return;
    const siblings = orderedChildren(before.data, before.forest, info.parent);
    const index = siblings.indexOf(id);
    const candidates = [
      ...orderedChildren(before.data, before.forest, id),
      ...siblings.slice(index + 1), ...siblings.slice(0, index).reverse(), info.parent,
    ];
    for (const candidate of candidates) {
      const node = this.canvas.nodes.get(candidate);
      if (!node || node.nodeEl.classList.contains("nf-canvas-hidden")) continue;
      this.canvas.selectOnly(node);
      return;
    }
  }

  private syncSignature() {
    this.lastSignature = canvasSignature(this.canvas.getData());
  }

  /** Drop a dragged card onto another map card to make it that card's child. */
  private reparent(drop: { id: string; target: string }, rects?: Map<string, Rectangle>): boolean {
    const data = this.canvas.getData();
    const { forest } = this.forest(data, rects);
    const info = forest.nodes.get(drop.id);
    const target = forest.nodes.get(drop.target);
    const node = this.canvas.nodes.get(drop.id);
    if (!info || !target || !node || info.parent === drop.target
      || drop.id === drop.target || descendants(forest, drop.id).includes(drop.target)) return false;
    const slot = planMapInsertion(data, forest, drop.target, "child", node.getData().width, node.getData().height);
    return !!slot && this.moveUnder(drop.id, drop.target, slot, forest);
  }

  /**
   * Hang a map card from `targetId` at the planned slot, in the step that is
   * open: its old connection goes, the new one keeps that one's look, and a
   * folded target unfolds. The tidy layout then settles the neighbours.
   */
  private moveUnder(id: string, targetId: string, slot: MapInsertion, forest: Forest): boolean {
    const info = forest.nodes.get(id);
    const node = this.canvas.nodes.get(id);
    const target = this.canvas.nodes.get(targetId);
    if (!info || !node || !target) return false;
    const oldEdge = info.edge ? this.canvas.edges.get(info.edge) : undefined;
    const style = edgeStyle(oldEdge?.getData());
    if (oldEdge) this.removeEdges([oldEdge]);
    // A map root dropped onto another map joins it.
    const nodeData = node.getData();
    if (info.parent === null) this.updateNode(withoutKeys(nodeData, LAYOUT_KEY));
    const targetData = target.getData();
    if (isCollapsed(targetData)) this.updateNode(withoutKeys(targetData, COLLAPSED_KEY));
    this.track(id);
    node.moveTo({ x: Math.round(slot.x), y: Math.round(slot.y) });
    this.canvas.importData({ nodes: [], edges: [{
      toEnd: "none", ...style, id: this.newId(), fromNode: targetId, toNode: id, ...sidesFor(slot.direction),
    }] }, false);
    this.reserved.clear();
    // A refit at its new level keeps the card's corner; the slot placed its
    // centre, which decides its place among the new siblings.
    const placed = node.getData();
    this.fitHierarchyChanges(forest);
    const fitted = node.getData();
    if (fitted.width !== placed.width || fitted.height !== placed.height) {
      node.moveTo({
        x: Math.round(placed.x + (placed.width - fitted.width) / 2),
        y: Math.round(placed.y + (placed.height - fitted.height) / 2),
      });
    }
    return true;
  }

  private removeEdges(edges: LiveEdge[]) {
    if (typeof this.canvas.removeEdge === "function") {
      for (const edge of edges) this.canvas.removeEdge(edge);
      return;
    }
    const ids = new Set(edges.map((edge) => edge.getData().id));
    const data = this.canvas.getData();
    this.canvas.importData({ ...data, edges: data.edges.filter((edge) => !ids.has(edge.id)) }, true);
  }

  /**
   * Deleting a map card keeps its children: they move up to the nearest
   * remaining ancestor instead of floating away as loose cards.
   */
  private reattachOrphans(before: Snapshot): boolean {
    const data = this.canvas.getData();
    const existing = new Set(data.nodes.map((node) => node.id));
    const parented = new Set(data.edges.map((edge) => edge.toNode));
    const oldEdges = new Map(before.data.edges.map((edge) => [edge.id, edge]));
    const edges: CanvasEdgeData[] = [];
    for (const [id, info] of before.forest.nodes) {
      if (existing.has(id)) continue;
      let ancestor = info.parent;
      while (ancestor && !existing.has(ancestor)) ancestor = before.forest.nodes.get(ancestor)?.parent ?? null;
      if (!ancestor) continue;
      for (const child of info.children) {
        if (!existing.has(child) || parented.has(child)) continue;
        const childInfo = before.forest.nodes.get(child)!;
        edges.push({
          toEnd: "none", ...edgeStyle(oldEdges.get(childInfo.edge ?? "")),
          id: this.newId(), fromNode: ancestor, toNode: child,
        });
        parented.add(child);
      }
    }
    this.reserved.clear();
    if (edges.length) this.canvas.importData({ nodes: [], edges }, false);
    // A summary whose parent went hangs under the ancestor its run moved to.
    const relinked: CanvasNodeData[] = [];
    for (const node of data.nodes) {
      const link = summaryLink(node);
      if (!link || existing.has(link.parent) || !before.forest.nodes.has(link.parent)) continue;
      let ancestor = before.forest.nodes.get(link.parent)!.parent;
      while (ancestor && !existing.has(ancestor)) ancestor = before.forest.nodes.get(ancestor)?.parent ?? null;
      relinked.push(ancestor && (existing.has(link.from) || existing.has(link.to))
        ? { ...node, [SUMMARY_KEY]: { ...link, parent: ancestor } } : withoutKeys(node, SUMMARY_KEY));
    }
    if (relinked.length) this.canvas.importData({ nodes: relinked, edges: [] }, false);
    const resized = this.fitHierarchyChanges(before.forest);
    return edges.length > 0 || resized || relinked.length > 0;
  }

  /* ---------------------------------------------------------------- */
  /* Dragging a map card carries its branch                            */
  /* ---------------------------------------------------------------- */

  private onPointerDown = (evt: PointerEvent) => {
    this.endGesture();
    // A press that left no pointerup behind (a second finger, a lost release) gives snapping back first.
    if (this.snapHold) this.releaseSnapping();
    this.motion.finish();
    // A press on a note or link icon is the icon's alone: no drag, resize or selection starts.
    const chip = evt.button === 0 && this.active() ? this.chipAt(evt) : null;
    this.chipPress = chip;
    if (chip) {
      evt.preventDefault();
      evt.stopImmediatePropagation();
      return;
    }
    if (!this.active() || this.canvas.readonly || this.stage || evt.button !== 0 || evt.isPrimary === false) return;
    const target = evt.target as Element | null;
    if (target?.closest?.(".nf-canvas-toolbar, .nf-canvas-ui, .nf-canvas-fold")) return;
    // A click elsewhere puts the marker or color picker away, as with any popover.
    if (this.markerPanel) this.closeMarkerPanel();
    if (this.colorPanel) this.closeColorPanel();
    if (this.connecting) {
      // The click ends the connection on the card it lands on; the empty
      // canvas cancels it. Canvas must not select or drag meanwhile.
      evt.stopPropagation();
      evt.preventDefault();
      this.finishConnecting(this.cardAt(evt, new Set([this.connecting.from])));
      return;
    }
    this.pending.rects = undefined;
    const data = this.canvas.getData();
    const { forest, hidden } = this.forest(data);
    // A map card's drag shows its own guides (the drop target, the insertion bar); Canvas's
    // snap guides would cover them and park the card over its target. This capture listener
    // runs before Canvas reads the option.
    const hit = this.cardAt(evt, new Set());
    if (hit && forest.nodes.has(hit) && !target?.closest?.(".canvas-node-connection-point")) this.holdSnapping();
    this.gesture = {
      pointerId: evt.pointerId, forest, hidden, summaries: summaryIndex(data, forest),
      start: new Map(data.nodes.map((node) => [node.id, { x: node.x, y: node.y, width: node.width, height: node.height }])),
      followers: new Set(), point: null, target: null, driver: null, moved: false, frame: 0,
    };
    this.win.addEventListener("pointermove", this.onGestureMove, true);
    this.win.addEventListener("pointerup", this.onGestureEnd, true);
    this.win.addEventListener("pointercancel", this.onGestureEnd, true);
  };

  private onGestureMove = (evt: PointerEvent) => {
    const gesture = this.gesture;
    if (!gesture || evt.pointerId !== gesture.pointerId) return;
    gesture.point = { clientX: evt.clientX, clientY: evt.clientY };
    if (!gesture.frame) {
      gesture.frame = this.win.requestAnimationFrame(() => {
        gesture.frame = 0;
        if (this.gesture === gesture) this.followGesture();
      });
    }
  };

  private onGestureEnd = (evt: PointerEvent) => {
    const gesture = this.gesture;
    if (!gesture || evt.pointerId !== gesture.pointerId) return;
    try {
      if (evt.type === "pointerup") {
        gesture.point = { clientX: evt.clientX, clientY: evt.clientY };
        // Canvas has applied every move by now; its own pointerup listener,
        // which records the drag in the undo history, runs after this one.
        this.followGesture();
        if (gesture.moved) this.pending.rects = gesture.start;
        if (gesture.driver && gesture.target) this.pending.drop = { id: gesture.driver, target: gesture.target };
      }
      this.endGesture();
      this.schedule();
      // Work deferred during the gesture (a fit, a drop) runs once Canvas has
      // finished handling this pointerup.
      if (this.pending.fit.size || this.pending.drop) this.settleSoon();
    } finally {
      // Canvas's own pointerup, after this one, still places the card with
      // the options as they are: snapping comes back once it is done.
      if (this.snapHold && !this.snapTimer) this.snapTimer = this.win.setTimeout(this.releaseSnapping, 0);
    }
  };

  /** Canvas's object snapping off for one map card's drag: never saved, and given back when the drag ends. */
  private holdSnapping() {
    const options = this.canvas.options;
    if (!options || typeof options !== "object") return;
    // A quick second press must not have the first drag's release turn snapping on mid-drag.
    if (this.snapTimer) this.win.clearTimeout(this.snapTimer);
    this.snapTimer = 0;
    if (!this.snapHold) {
      this.snapHold = { previous: options.snapToObjects };
      options.snapToObjects = false;
    }
    this.canvas.wrapperEl.classList.add("nf-canvas-map-drag");
    this.win.addEventListener("blur", this.releaseSnapping);
  }

  private releaseSnapping = () => {
    if (this.snapTimer) this.win.clearTimeout(this.snapTimer);
    this.snapTimer = 0;
    const hold = this.snapHold;
    this.snapHold = null;
    const options = this.canvas.options;
    try {
      // Only our own change is undone: a choice made in Canvas's menu meanwhile stands.
      if (hold && options && options.snapToObjects === false) {
        if (hold.previous === undefined) delete options.snapToObjects;
        else options.snapToObjects = hold.previous;
      }
    } finally {
      this.canvas.wrapperEl.classList.remove("nf-canvas-map-drag");
      this.win.removeEventListener("blur", this.releaseSnapping);
    }
  };

  private endGesture() {
    const gesture = this.gesture;
    if (!gesture) return;
    if (gesture.frame) this.win.cancelAnimationFrame(gesture.frame);
    this.gesture = null;
    this.setDropTarget(null);
    this.setInsertBar(null);
    this.setStaleEdge(null);
    this.win.removeEventListener("pointermove", this.onGestureMove, true);
    this.win.removeEventListener("pointerup", this.onGestureEnd, true);
    this.win.removeEventListener("pointercancel", this.onGestureEnd, true);
  }

  /** Move the branches of dragged map cards along with them. */
  private followGesture() {
    const gesture = this.gesture;
    // Whatever moved — a card dragged, a card resized — its boundary follows.
    this.syncBoundaryGeometry();
    if (!gesture || !this.settings().canvasAutoLayout || !this.active()) return;
    const { forest, start, followers } = gesture;
    const drivers = new Set<string>();
    for (const [id, rect] of start) {
      if (!forest.nodes.has(id) || followers.has(id)) continue;
      const current = this.canvas.nodes.get(id)?.getData();
      // Pure translations only: resizing a card is not a drag.
      if (current && (current.x !== rect.x || current.y !== rect.y)
        && current.width === rect.width && current.height === rect.height) drivers.add(id);
    }
    if (!drivers.size) return;
    gesture.moved = true;
    for (const driver of drivers) {
      const from = start.get(driver)!;
      const now = this.canvas.nodes.get(driver)!.getData();
      const carry = (id: string) => {
        const node = this.canvas.nodes.get(id);
        const origin = start.get(id);
        if (!node || !origin) return;
        const x = origin.x + now.x - from.x;
        const y = origin.y + now.y - from.y;
        const current = node.getData();
        if (current.x !== x || current.y !== y) node.moveTo({ x, y });
        followers.add(id);
      };
      for (const id of [driver, ...descendants(forest, driver)]) {
        if (id !== driver) {
          if (drivers.has(id)) continue;
          // The nearest dragged ancestor carries a card.
          let ancestor = forest.nodes.get(id)!.parent;
          while (ancestor && !drivers.has(ancestor)) ancestor = forest.nodes.get(ancestor)!.parent;
          if (ancestor !== driver) continue;
          carry(id);
        }
        // A branch's summaries travel with it.
        for (const summary of gesture.summaries.get(id) ?? []) if (!drivers.has(summary.id)) carry(summary.id);
      }
    }
    this.syncBoundaryGeometry();
    // One dragged card can be dropped onto another map card.
    gesture.driver = drivers.size === 1 ? [...drivers][0] : null;
    let target: string | null = null;
    if (gesture.driver && gesture.point && typeof this.canvas.posFromEvt === "function") {
      const point = this.canvas.posFromEvt(gesture.point);
      const moving = new Set([gesture.driver, ...descendants(forest, gesture.driver)]);
      let best = Infinity;
      for (const [id] of forest.nodes) {
        if (moving.has(id) || gesture.hidden.has(id)) continue;
        const rect = this.canvas.nodes.get(id)?.getData();
        if (!rect || point.x < rect.x || point.y < rect.y
          || point.x > rect.x + rect.width || point.y > rect.y + rect.height) continue;
        const area = rect.width * rect.height;
        if (area < best) { best = area; target = id; }
      }
    }
    // The card's own parent is where it already hangs: a drop there re-links
    // nothing, so it is no target. What that drop does — reorder the card
    // among its siblings by where it lies — is what the bar between them says.
    if (target && gesture.driver && target === forest.nodes.get(gesture.driver)?.parent) target = null;
    gesture.target = target;
    this.setDropTarget(target ? this.canvas.nodes.get(target)?.nodeEl ?? null : null);
    this.syncInsertion(gesture, target);
  }

  /**
   * Where the dragged card would land: a bar between the siblings it is
   * moving between, or at the slot under the card it hovers; meanwhile its
   * old connection dims. Nothing while it stays in its own slot, where the
   * drop only snaps it back. One card at a time, and never across a mind
   * map's centre, where the side it lands on is decided at the drop.
   */
  private syncInsertion(gesture: Gesture, target: string | null) {
    const bar = gesture.driver ? this.insertionBar(gesture, target) : null;
    this.setInsertBar(bar);
    const info = gesture.driver ? gesture.forest.nodes.get(gesture.driver) : undefined;
    this.setStaleEdge(bar && info?.edge ? this.canvas.edges.get(info.edge) ?? null : null);
  }

  private insertionBar(gesture: Gesture, target: string | null): [number, number, number, number] | null {
    const { forest, hidden } = gesture;
    const driver = gesture.driver!;
    const info = forest.nodes.get(driver);
    const rect = this.canvas.nodes.get(driver)?.getData();
    if (!info || !rect) return null;
    const live = (ids: Iterable<string>): CanvasData => ({
      nodes: [...ids].flatMap((id) => { const node = this.canvas.nodes.get(id)?.getData(); return node ? [node] : []; }), edges: [],
    });
    const across = (flow: Flow, x: number, y: number, from: number, to: number): [number, number, number, number] =>
      crossAxis(flow) === "y" ? [from, y, to, y] : [x, from, x, to];
    if (target) {
      const targetInfo = forest.nodes.get(target);
      if (!targetInfo) return null;
      const slot = planMapInsertion(live([target, ...targetInfo.children, targetInfo.root]), forest, target, "child", rect.width, rect.height);
      if (!slot) return null;
      const horizontal = crossAxis(slot.direction) === "y";
      return across(slot.direction, slot.x + rect.width / 2, slot.y + rect.height / 2,
        horizontal ? slot.x : slot.y, horizontal ? slot.x + rect.width : slot.y + rect.height);
    }
    const parentId = info.parent;
    const parentInfo = parentId ? forest.nodes.get(parentId) : undefined;
    const parent = parentId ? this.canvas.nodes.get(parentId)?.getData() : undefined;
    if (!parentId || !parentInfo || !parent) return null;
    const flow = info.direction;
    const axis = crossAxis(flow);
    const centre = (box: Rectangle) => axis === "y" ? box.y + box.height / 2 : box.x + box.width / 2;
    const start = (box: Rectangle) => axis === "y" ? box.y : box.x;
    const end = (box: Rectangle) => axis === "y" ? box.y + box.height : box.x + box.width;
    const mainStart = (box: Rectangle) => axis === "y" ? box.x : box.y;
    const mainEnd = (box: Rectangle) => axis === "y" ? box.x + box.width : box.y + box.height;
    if (parentInfo.parent === null && mapLayout(parent) === "balanced") {
      const side = rect.x + rect.width / 2 < parent.x + parent.width / 2 ? "left" : "right";
      if (side !== flow) return null;
    }
    const siblings = parentInfo.children
      .filter((id) => id !== driver && !hidden.has(id) && forest.nodes.get(id)!.direction === flow)
      .flatMap((id) => { const box = this.canvas.nodes.get(id)?.getData(); return box ? [box] : []; })
      .sort((a, b) => centre(a) - centre(b));
    if (!siblings.length) return null;
    const index = siblings.filter((box) => centre(box) < centre(rect)).length;
    // Still between the neighbours it started between: the drop changes
    // nothing, so there is nothing to announce.
    const origin = gesture.start.get(driver);
    if (origin && siblings.filter((box) => centre(box) < centre(origin)).length === index) return null;
    const before = siblings[index - 1];
    const after = siblings[index];
    const gaps = spacingGaps(mapSpacing(this.canvas.nodes.get(parentInfo.root)?.getData()));
    const gap = (flow === "list" || flow === "row" || flow === "column" ? gaps[flow] : gaps[axis === "y" ? "horizontal" : "vertical"]).cross;
    const at = before && after ? (end(before) + start(after)) / 2 : before ? end(before) + gap / 2 : start(after) - gap / 2;
    const near = [before, after].filter((box): box is CanvasNodeData => !!box);
    const from = Math.min(...near.map(mainStart));
    const to = Math.max(...near.map(mainEnd));
    return across(flow, at, at, from, to);
  }

  private setInsertBar(coords: [number, number, number, number] | null) {
    const container = this.canvas.edgeContainerEl;
    const doc = this.canvas.wrapperEl.ownerDocument;
    if (!coords || !container || typeof doc.createElementNS !== "function") {
      this.insertBar?.group.remove();
      this.insertBar = null;
      return;
    }
    let bar = this.insertBar;
    if (!bar) {
      const group = doc.createElementNS(SVG_NS, "g") as SVGGElement;
      group.setAttribute("class", "nf-canvas-insert nf-canvas-ui");
      const line = doc.createElementNS(SVG_NS, "line");
      line.setAttribute("class", "nf-canvas-insert-bar");
      group.append(line);
      bar = this.insertBar = { group, line };
    }
    // Next to the boundaries, below the connections.
    const boundaries = this.boundaryLayer;
    const reference = boundaries && boundaries.parentNode === container ? boundaries.nextSibling : container.firstChild;
    if (bar.group.parentNode !== container) container.insertBefore(bar.group, reference);
    (["x1", "y1", "x2", "y2"] as const).forEach((name, index) => {
      const text = String(Math.round(coords[index] * 10) / 10);
      if (bar!.line.getAttribute(name) !== text) bar!.line.setAttribute(name, text);
    });
  }

  private setStaleEdge(edge: LiveEdge | null) {
    if (this.staleEdge === edge) return;
    for (const el of [this.staleEdge?.lineGroupEl, this.staleEdge?.lineEndGroupEl]) el?.classList.remove("nf-canvas-drag-stale");
    for (const el of [edge?.lineGroupEl, edge?.lineEndGroupEl]) el?.classList.add("nf-canvas-drag-stale");
    this.staleEdge = edge;
  }

  private setDropTarget(el: HTMLElement | null) {
    if (this.dropTarget === el) return;
    this.dropTarget?.classList.remove("nf-canvas-drop-target");
    el?.classList.add("nf-canvas-drop-target");
    this.dropTarget = el;
  }

  /* ---------------------------------------------------------------- */
  /* Hover                                                             */
  /* ---------------------------------------------------------------- */

  // Canvas lays its resize handles over the card under the pointer, so the
  // card itself rarely gets :hover. Track it here instead, with enough reach
  // for the pointer to travel out to the card's buttons.
  private onHover = (evt: PointerEvent) => {
    if (evt.pointerType === "touch") return;
    this.hoverPoint = { clientX: evt.clientX, clientY: evt.clientY };
    this.hoverEvent = evt;
    if (!this.hoverFrame) {
      this.hoverFrame = this.win.requestAnimationFrame(() => {
        this.hoverFrame = 0;
        this.updateHover();
      });
    }
  };

  private onHoverEnd = () => {
    this.hoverPoint = null;
    this.hoverEvent = null;
    this.setHovered(null);
    this.syncChipHover();
  };

  private updateHover() {
    const point = this.hoverPoint;
    this.syncChipHover();
    if (point && this.connecting) this.updateConnecting(point);
    if (!point || !this.active() || this.gesture || this.canvas.isDragging
      || typeof this.canvas.posFromEvt !== "function") {
      this.setHovered(null);
      return;
    }
    const pos = this.canvas.posFromEvt(point);
    // Card buttons are sized in screen pixels: 36px of reach at any zoom.
    const reach = 36 / Math.sqrt(this.canvas.scale || 1);
    // The nearest card wins; over overlapping cards, the smaller one.
    let best: LiveNode | null = null;
    let bestDistance = Infinity;
    let bestArea = Infinity;
    for (const node of this.canvas.nodes.values()) {
      if (!this.controls.has(node.id)) continue;
      const rect = node.getData();
      const dx = Math.max(rect.x - pos.x, 0, pos.x - rect.x - rect.width);
      const dy = Math.max(rect.y - pos.y, 0, pos.y - rect.y - rect.height);
      const distance = Math.hypot(dx, dy);
      if (distance > reach) continue;
      const area = rect.width * rect.height;
      if (distance < bestDistance || (distance === bestDistance && area < bestArea)) {
        best = node;
        bestDistance = distance;
        bestArea = area;
      }
    }
    this.setHovered(best);
  }

  private setHovered(node: LiveNode | null) {
    if (this.hovered === node) return;
    this.hovered?.nodeEl.classList.remove("nf-canvas-hover");
    node?.nodeEl.classList.add("nf-canvas-hover");
    this.hovered = node;
  }

  /* ---------------------------------------------------------------- */
  /* View                                                              */
  /* ---------------------------------------------------------------- */

  private zoom(ids: Set<string>) {
    const box = boxOf([...ids].map((id) => this.canvas.nodes.get(id)?.getData())
      .filter((node): node is CanvasNodeData => !!node), 60);
    if (box) this.canvas.zoomToBbox?.(box);
  }

  /**
   * Scroll cards into view without changing the zoom level. When they do not
   * all fit, the last of them — the card just made or reached — does.
   */
  private reveal(ids: string[]) {
    const boxFor = (list: string[]) => boxOf(list.map((id) => this.canvas.nodes.get(id)?.getData())
      .filter((node): node is CanvasNodeData => !!node), 40);
    // Canvas pads what it pans to by its grid, and zooms out for a box that
    // then does not fit: only ask it for what fits as it is.
    const view = this.canvas.getViewportBBox?.();
    const pad = 2 * (this.canvas.gridSpacing ?? 20);
    const fits = (box: Box) => !view || (box.maxX - box.minX + pad <= view.maxX - view.minX
      && box.maxY - box.minY + pad <= view.maxY - view.minY);
    let box = boxFor(ids);
    if (box && !fits(box) && ids.length > 1) box = boxFor(ids.slice(-1));
    if (!box || !fits(box)) return;
    if (typeof this.canvas.panIntoView === "function") this.canvas.panIntoView(box);
    else this.canvas.zoomToBbox?.(box);
  }

  /** A small round button that lives on a card and never starts a drag. */
  private cardButton(className: string, onClick: () => void): HTMLButtonElement {
    const button = this.canvas.wrapperEl.ownerDocument.createElement("button");
    button.type = "button";
    button.className = `${className} nf-canvas-ui`;
    button.tabIndex = -1;
    for (const event of ["pointerdown", "mousedown", "dblclick"]) {
      button.addEventListener(event, (evt) => evt.stopPropagation());
    }
    button.addEventListener("click", (evt) => {
      evt.stopPropagation();
      evt.preventDefault();
      onClick();
    });
    return button;
  }

  /**
   * The fold badge on a card with children, and "+" handles: on a map leaf,
   * toward where its children would grow; on the selected free card, on
   * every side.
   */
  private updateControls(node: LiveNode, info: TreeNode | undefined, data: CanvasNodeData | undefined,
    forest: Forest, canvasData: CanvasData, rootLayout: MapLayout | null, selectedId: string | null) {
    const id = node.id;
    let controls = this.controls.get(id);
    // Buttons sit where the card's children leave it.
    const sideOf = (flow: Flow) => flow === "down" || flow === "list" || flow === "column" ? "bottom"
      : flow === "up" ? "top" : flow === "row" ? "right" : flow;

    // Fold badge
    if (info && info.children.length && data) {
      controls ??= this.newControls(id);
      let badge = controls.fold;
      if (!badge) {
        badge = this.cardButton("nf-canvas-fold", () => this.toggleFold([id]));
        badge.setAttribute("data-tooltip-position", "top");
        controls.fold = badge;
      }
      if (badge.parentElement !== node.nodeEl) node.nodeEl.append(badge);
      const collapsed = isCollapsed(data);
      let side: string = sideOf(info.flow);
      if (info.parent === null && rootLayout === "balanced") {
        side = info.children.some((child) => forest.nodes.get(child)?.direction === "right") ? "right" : "left";
      }
      const count = collapsed ? descendants(forest, id).length : 0;
      const text = collapsed ? String(count) : "";
      if (badge.textContent !== text) badge.textContent = text;
      if (badge.dataset.side !== side) badge.dataset.side = side;
      toggle(badge, "is-collapsed", collapsed);
      // A folded badge names the topics it hides: the first few children.
      let label = t("Fold branch");
      if (collapsed) {
        const byId = new Map(canvasData.nodes.map((item) => [item.id, item]));
        const children = orderedChildren(canvasData, forest, id);
        const names = children.slice(0, 3).map((child) => cardTitle(byId.get(child)!, 24)).filter(Boolean);
        label = cardCount(t("Unfold 1 card: {names}"), t("Unfold {count} cards: {names}"), count)
          .replace("{names}", names.join(", ") + (children.length > 3 ? "…" : ""));
      }
      if (badge.getAttribute("aria-label") !== label) badge.setAttribute("aria-label", label);
    } else if (controls?.fold) {
      controls.fold.remove();
      controls.fold = null;
    }

    // "+" handles
    const sides: string[] = [];
    if (data && data.type !== "group" && !this.canvas.readonly && !isEditingNode(node)) {
      if (info && !info.children.length) {
        if (info.parent === null && rootLayout === "balanced") sides.push("left", "right");
        else sides.push(sideOf(info.flow));
      } else if (!info && selectedId === id) sides.push("top", "right", "bottom", "left");
    }
    if (sides.length) controls ??= this.newControls(id);
    if (controls) {
      for (const [side, button] of controls.adds) {
        if (!sides.includes(side)) {
          button.remove();
          controls.adds.delete(side);
        }
      }
      for (const side of sides) {
        let button = controls.adds.get(side);
        if (!button) {
          button = this.cardButton("nf-canvas-add", () => this.grow(id, side as keyof typeof SIDES));
          button.dataset.side = side;
          setIcon(button, "plus");
          button.setAttribute("aria-label", info ? t("Add child") : t("Add a connected card"));
          button.setAttribute("data-tooltip-position", "top");
          controls.adds.set(side, button);
        }
        toggle(button, "is-free", !info);
        if (button.parentElement !== node.nodeEl) node.nodeEl.append(button);
      }
      if (!controls.fold && !controls.adds.size) this.controls.delete(id);
    }
  }

  private newControls(id: string): NodeControls {
    const controls: NodeControls = { fold: null, adds: new Map() };
    this.controls.set(id, controls);
    return controls;
  }

  private removeControls(id: string) {
    const controls = this.controls.get(id);
    if (!controls) return;
    controls.fold?.remove();
    for (const button of controls.adds.values()) button.remove();
    this.controls.delete(id);
  }

  /**
   * Mind-map actions in Canvas's floating menu above the selected card, next
   * to delete, color, and zoom — where the eye already is.
   */
  private syncMenu(selected: LiveNode | null) {
    const menu = this.canvas.menu;
    const menuEl = menu?.menuEl;
    // Several map cards selected: only what acts on all of them.
    const group = selected ? [] : this.selectedMapNodes();
    const multi = !selected && group.length > 1;
    const show = !!menuEl && !this.canvas.readonly
      && ((!!selected && !isEditingNode(selected) && selected.getData().type !== "group") || multi);
    if (!show) {
      if (this.menuGroup && !menuEl?.contains(this.menuGroup)) this.menuGroup = null;
      this.menuGroup?.remove();
      this.menuGroup = null;
      return;
    }
    let injected = false;
    if (!this.menuGroup || this.menuGroup.parentElement !== menuEl) {
      // Canvas rebuilds its menu whenever the selection changes.
      this.menuGroup = this.buildMenuGroup();
      menuEl!.append(this.menuGroup);
      injected = true;
    }
    const shared: (Action | "layout")[] = ["fold", "connect", "markers"];
    for (const button of Array.from(this.menuGroup.querySelectorAll("button")) as HTMLButtonElement[]) {
      const action = button.dataset.action as Action | "layout";
      const visible = (!multi || shared.includes(action)) && this.canRun(action === "layout" ? "right" : action);
      if (button.hidden !== !visible) button.hidden = !visible;
      if (action === "fold") {
        const folded = this.foldedSelection();
        const icon = folded ? "chevrons-up-down" : "chevrons-down-up";
        if (button.dataset.icon !== icon) {
          button.dataset.icon = icon;
          setIcon(button, icon);
        }
        const label = folded ? t("Unfold branch") : t("Fold branch");
        const name = this.settings().canvasKeyboard ? `${label} (${keyLabel("Mod+/")})` : label;
        if (button.getAttribute("aria-label") !== name) button.setAttribute("aria-label", name);
      }
    }
    // Canvas centres its menu by measuring it; measure again with our buttons.
    if (injected) menu?.render?.(false);
  }

  private buildMenuGroup(): HTMLElement {
    const doc = this.canvas.wrapperEl.ownerDocument;
    const group = doc.createElement("div");
    group.className = "nf-canvas-menu-group nf-canvas-ui";
    // The most frequent actions only; the toolbar holds the rest.
    const entries: [Action | "layout", string, string, string][] = [
      ["child", "Add child", "corner-down-right", "Tab"],
      ["sibling", "Add sibling", "list-plus", "Enter"],
      ["connect", "Connect", "spline", ""],
      ["fold", "Fold branch", "chevrons-down-up", "Mod+/"],
      ["markers", "Markers", "flag", ""],
      ["note", "Note", "sticky-note", "F4"],
      ["link", "Link", "link", "Mod+K"],
    ];
    for (const [action, label, icon, key] of entries) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "clickable-icon nf-canvas-menu-action";
      button.dataset.action = action;
      button.setAttribute("aria-label", key && this.settings().canvasKeyboard ? `${t(label)} (${keyLabel(key)})` : t(label));
      setIcon(button, icon);
      button.addEventListener("click", (evt) => {
        evt.stopPropagation();
        if (action === "layout") this.toggleLayoutPanel();
        else this.run(action);
      });
      group.append(button);
    }
    return group;
  }

  /* ---------------------------------------------------------------- */
  /* Toolbar, connect tool, markers, numbering, guide                  */
  /* ---------------------------------------------------------------- */

  /**
   * What a toolbar button does now: the first grows the selected card, or
   * starts a topic when none is selected; Focus shows all while focused.
   */
  private toolbarAction(key: ToolbarKey): Action | "layout" | "style" | "more" {
    if (key === "child" && !this.selected() && this.canRun("newTopic")) return "newTopic";
    if (key === "focus" && this.focusIds.size) return "reset";
    // The Find button opens the bar; the card search with its list is on the More menu.
    if (key === "search") return "find";
    return key;
  }

  /**
   * Set a toolbar button's name and icon, touching the DOM only on change.
   * The name carries the shortcut as it is typed here, so the one tooltip
   * Obsidian draws from it says both.
   */
  private setButtonFace(key: ToolbarKey, label: string, icon: string | null, shortcut?: string) {
    const button = this.buttons.get(key);
    if (!button) return;
    const face = shortcut ? `${label} · ${keyLabel(shortcut)}` : label;
    if (button.getAttribute("aria-label") !== face) button.setAttribute("aria-label", face);
    const text = this.labels.get(key);
    if (text && text.textContent !== label) text.textContent = label;
    const glyph = this.glyphs.get(key);
    if (icon && glyph && glyph.dataset.icon !== icon) {
      glyph.dataset.icon = icon;
      setIcon(glyph, icon);
    }
  }

  /** The selected cards that can be connected or marked. */
  private markableNodes(): LiveNode[] {
    return this.selectedNodes().filter((node) => node.getData().type !== "group"
      && (!isEditingNode(node) || node === this.toolbarEditing));
  }

  /** The selected map cards: members of a map, not groups, not being edited. */
  private selectedMapNodes(): LiveNode[] {
    const { forest } = this.snapshot();
    return this.markableNodes().filter((node) => forest.nodes.has(node.id));
  }

  /** The selected cards a branch focus can start from: any card but a summary. */
  private focusTargets(): LiveNode[] {
    const { forest } = this.snapshot();
    return this.markableNodes().filter((node) => {
      const link = summaryLink(node.getData());
      return !link || !forest.nodes.has(link.parent);
    });
  }

  /** The cards of every focused branch together, or null while nothing is focused. */
  private focusBranch(data: CanvasData): Set<string> | null {
    if (!this.focusIds.size) return null;
    const branch = new Set<string>();
    for (const id of this.focusIds) for (const member of buildBranch(data, id)) branch.add(member);
    return branch;
  }

  /** Whether the fold button would unfold: every selected branch is folded. */
  private foldedSelection(): boolean {
    const { forest } = this.snapshot();
    const branches = this.selectedMapNodes().filter((node) => (forest.nodes.get(node.id)?.children.length ?? 0) > 0);
    return branches.length > 0 && branches.every((node) => isCollapsed(node.getData()));
  }

  /**
   * A fresh topic in the middle of the view, ready to type into. With a
   * preset, the centre of a new map in that scheme, stored on it as the Style
   * panel stores one; without, a card of its own.
   */
  private newTopic(presetId?: AppearancePresetId): boolean {
    if (this.canvas.readonly) return false;
    const preset = presetId ? appearancePreset(presetId) : null;
    if (presetId && !preset) return false;
    const size = preset ? this.newTopicBox(0) : TOPIC;
    const viewport = this.canvas.getViewportBBox?.();
    const known = !!viewport && [viewport.minX, viewport.minY, viewport.maxX, viewport.maxY].every(Number.isFinite);
    const centre = known ? { x: (viewport!.minX + viewport!.maxX) / 2, y: (viewport!.minY + viewport!.maxY) / 2 } : { x: 0, y: 0 };
    const box: Rectangle = { x: Math.round(centre.x - size.width / 2), y: Math.round(centre.y - size.height / 2), ...size };
    // Step down until the card sits in open space.
    const data = this.canvas.getData();
    const covered = (rect: Rectangle) => data.nodes.some((node) => node.type !== "group"
      && node.x < rect.x + rect.width && node.x + node.width > rect.x && node.y < rect.y + rect.height && node.y + node.height > rect.y);
    for (let tries = 0; tries < 40 && covered(box); tries++) box.y += size.height + 24;
    const id = this.newId();
    const card: CanvasNodeData = { id, type: "text", text: "", ...box };
    // One step: the card, its scheme (a map root from the start, so it is
    // drawn in its look while typed in) and its one-line height.
    canvasTransaction(this.canvas, () => {
      this.canvas.importData({ nodes: [preset ? withLook({ ...card, [LAYOUT_KEY]: "right" }, { id: preset.id }, preset) : card], edges: [] }, false);
      if (preset) this.settleBlankTopic(id);
    });
    this.reserved.clear();
    this.startEditing(id, [id]);
    return true;
  }

  /** An onboarding tile: the centre of a new map in a designed scheme, ready to type into. */
  private startMap(id: AppearancePresetId): boolean {
    if (!this.active() || !this.canRun("newTopic")) return false;
    this.motion.finish();
    // The tile leaves with the panel: the keyboard stays with the canvas,
    // and the new card's editor takes it from there.
    this.canvas.wrapperEl.focus();
    return this.newTopic(id);
  }

  /**
   * Join the selected cards in the order they were selected, or with one
   * card selected, start the connect tool: the next card clicked is joined
   * to it. Map cards are joined by relation lines, which leave the
   * structure alone; free cards by ordinary arrows.
   */
  private connect(): boolean {
    if (this.connecting) {
      this.cancelConnecting();
      return true;
    }
    const nodes = this.markableNodes();
    if (!nodes.length) return false;
    if (nodes.length === 1) return this.startConnecting(nodes[0].id);
    const { data, forest } = this.snapshot();
    const plans = planChain(data, forest, nodes.map((node) => node.id));
    if (!plans.length) {
      new Notice(t("These cards are already connected."));
      return false;
    }
    const edges = plans.map((plan): CanvasEdgeData => ({ id: this.newId(), ...plan.edge }));
    canvasTransaction(this.canvas, () => this.canvas.importData({ nodes: [], edges }, false));
    this.reserved.clear();
    this.syncSignature();
    this.refresh();
    new Notice(t("Connected {count} cards.").replace("{count}", String(nodes.length)));
    return true;
  }

  private startConnecting(from: string): boolean {
    const container = this.canvas.edgeContainerEl;
    const doc = this.canvas.wrapperEl.ownerDocument;
    if (!container || typeof doc.createElementNS !== "function" || typeof this.canvas.posFromEvt !== "function") {
      new Notice(t("Hover a card’s edge and drag the dot that appears onto another card to connect them."));
      return false;
    }
    this.closeMarkerPanel();
    const line = doc.createElementNS(SVG_NS, "path") as SVGPathElement;
    line.setAttribute("class", "nf-canvas-connect-line nf-canvas-ui");
    container.append(line);
    this.connecting = { from, line, target: null };
    this.canvas.wrapperEl.classList.add("nf-canvas-connecting");
    if (this.hoverPoint) this.updateConnecting(this.hoverPoint);
    this.refresh();
    return true;
  }

  private cancelConnecting() {
    if (this.dropConnecting() && !this.disposed) this.refresh();
  }

  private dropConnecting(): boolean {
    const connecting = this.connecting;
    if (!connecting) return false;
    this.connecting = null;
    connecting.line.remove();
    this.setConnectTarget(null);
    this.canvas.wrapperEl.classList.remove("nf-canvas-connecting");
    return true;
  }

  /** The smallest visible card under the pointer, other than `except`. */
  private cardAt(point: { clientX: number; clientY: number }, except: Set<string>): string | null {
    if (typeof this.canvas.posFromEvt !== "function") return null;
    const pos = this.canvas.posFromEvt(point);
    let best: string | null = null;
    let bestArea = Infinity;
    for (const [id, node] of this.canvas.nodes) {
      if (except.has(id) || node.nodeEl.classList.contains("nf-canvas-hidden")) continue;
      const rect = node.getData();
      if (rect.type === "group" || pos.x < rect.x || pos.y < rect.y
        || pos.x > rect.x + rect.width || pos.y > rect.y + rect.height) continue;
      const area = rect.width * rect.height;
      if (area < bestArea) {
        best = id;
        bestArea = area;
      }
    }
    return best;
  }

  /** Draw the preview from the source card to the pointer, or to the card under it. */
  private updateConnecting(point: { clientX: number; clientY: number }) {
    const connecting = this.connecting;
    const source = connecting ? this.canvas.nodes.get(connecting.from)?.getData() : undefined;
    if (!connecting || !source || typeof this.canvas.posFromEvt !== "function") return;
    const pos = this.canvas.posFromEvt(point);
    const targetId = this.cardAt(point, new Set([connecting.from]));
    const target = targetId ? this.canvas.nodes.get(targetId)?.getData() : undefined;
    connecting.target = target ? targetId : null;
    this.setConnectTarget(target ? this.canvas.nodes.get(targetId!)!.nodeEl : null);
    const box = (rect: Rectangle) => ({ minX: rect.x, minY: rect.y, maxX: rect.x + rect.width, maxY: rect.y + rect.height });
    const sides = target ? connectionSides(source, target) : null;
    const fromSide = sides ? sides.fromSide : sideToward(source, pos);
    const end = target && sides ? anchor(box(target), sides.toSide) : pos;
    const d = previewPath(anchor(box(source), fromSide), fromSide, end);
    if (connecting.line.getAttribute("d") !== d) connecting.line.setAttribute("d", d);
  }

  private setConnectTarget(el: HTMLElement | null) {
    if (this.connectTarget === el) return;
    this.connectTarget?.classList.remove("nf-canvas-connect-target");
    el?.classList.add("nf-canvas-connect-target");
    this.connectTarget = el;
  }

  /** End the connect tool on a card, joining it to the source, or on nothing. */
  private finishConnecting(target: string | null) {
    const connecting = this.connecting;
    if (!connecting) return;
    const from = connecting.from;
    this.cancelConnecting();
    if (!target) return;
    const { data, forest } = this.snapshot();
    const plan = planConnection(data, forest, from, target);
    if (!plan) {
      new Notice(t("These cards are already connected."));
      return;
    }
    const edge: CanvasEdgeData = { id: this.newId(), ...plan.edge };
    canvasTransaction(this.canvas, () => this.canvas.importData({ nodes: [], edges: [edge] }, false));
    this.reserved.clear();
    // The new line is selected, so its label and color are a click away.
    const live = this.canvas.edges.get(edge.id);
    if (live && typeof live.select === "function") this.canvas.selectOnly(live);
    this.syncSignature();
    this.refresh();
  }

  toggleMarkerPanel(open = !this.markerPanel) {
    if (!open) {
      this.closeMarkerPanel();
      return;
    }
    if (this.markerPanel || !this.active()) return;
    this.closeStylePanel();
    this.closeColorPanel();
    this.closeHelpPanel();
    this.closeLayoutPanel();
    this.cancelConnecting();
    this.markerPanel = new MarkerPanel(this.canvas.wrapperEl.ownerDocument, {
      state: () => this.markerState(),
      toggle: (id) => { this.setMarkers((current) => toggleMarker(current, id)); },
      clear: () => { this.setMarkers(() => []); },
      close: () => {
        this.closeMarkerPanel();
        this.canvas.wrapperEl.focus();
      },
      // Kept per device with Obsidian's own local storage, where it exists.
      recentEmoji: {
        load: () => typeof this.app?.loadLocalStorage === "function" ? this.app.loadLocalStorage(RECENT_EMOJI_KEY) : null,
        save: (ids) => { if (typeof this.app?.saveLocalStorage === "function") this.app.saveLocalStorage(RECENT_EMOJI_KEY, ids); },
      },
    });
    this.canvas.wrapperEl.append(this.markerPanel.el);
    this.refresh();
  }

  private closeMarkerPanel() {
    if (!this.markerPanel) return;
    this.markerPanel.destroy();
    this.markerPanel = null;
    if (!this.disposed) this.refresh();
  }

  /** Put away the tools that belong to one file, without a refresh. */
  private dropTools() {
    this.closeNote(false, false);
    this.dropConnecting();
    this.dropFind();
    this.markerPanel?.destroy();
    this.markerPanel = null;
    this.colorPanel?.destroy();
    this.colorPanel = null;
    this.clearLayoutPreview();
    // The view belonged to what was shown: nothing is put back.
    this.forgetPreviewView();
    this.panelPan = null;
    if (this.anchorFrame) this.win.cancelAnimationFrame(this.anchorFrame);
    this.anchorFrame = 0;
    this.helpPanel?.destroy();
    this.helpPanel = null;
    this.layoutPanel?.destroy();
    this.layoutPanel = null;
  }

  /* ---------------------------------------------------------------- */
  /* Layout panel                                                      */
  /* ---------------------------------------------------------------- */

  toggleLayoutPanel(open = !this.layoutPanel) {
    if (!open) {
      this.closeLayoutPanel();
      return;
    }
    if (this.layoutPanel || !this.active()) return;
    this.closeStylePanel(false);
    this.closeMarkerPanel();
    this.closeColorPanel();
    this.closeHelpPanel();
    this.layoutPanel = new LayoutPanel(this.canvas.wrapperEl.ownerDocument, {
      state: () => this.layoutPanelState(),
      preview: (patch, keepView) => this.previewLayout(patch, keepView),
      run: (action) => {
        const known = action as Action;
        if (this.canRun(known)) this.run(known);
        this.refresh();
      },
      close: () => {
        this.closeLayoutPanel();
        this.canvas.wrapperEl.focus();
      },
    });
    this.canvas.wrapperEl.append(this.layoutPanel.el);
    this.refresh();
    if (this.layoutPanel) this.makeRoom(this.layoutPanel.el);
  }

  private closeLayoutPanel(restore = true) {
    if (!this.layoutPanel) return;
    this.layoutPanel.destroy();
    this.layoutPanel = null;
    this.clearLayoutPreview();
    // The panel is gone: a preview's zoom and the panel's pan unwind now, in that order.
    if (this.previewViewTimer) this.settlePreviewView();
    this.unpan(restore);
    if (!this.disposed) this.refresh();
  }

  /* ---------------------------------------------------------------- */
  /* Panels and the view                                               */
  /* ---------------------------------------------------------------- */

  /** The view Canvas is showing or gliding toward; null where Canvas does not say. */
  private targetView(): ViewState | null {
    const { tx, ty, tZoom } = this.canvas;
    return typeof tx === "number" && typeof ty === "number" && typeof tZoom === "number" ? { x: tx, y: ty, zoom: tZoom } : null;
  }

  /** Glide to a view, as Canvas's own zoom to fit does. */
  private moveView(view: ViewState) {
    const c = this.canvas;
    c.tx = view.x;
    c.ty = view.y;
    c.tZoom = view.zoom;
    c.zoomCenter = null;
    c.markViewportChanged?.();
  }

  /** Undo a move of ours, unless the view was moved since (the target compares, as the glide may still run). */
  private restoreView(move: { from: ViewState; to: ViewState }) {
    const now = this.targetView();
    const zoom = this.canvas.zoom;
    if (!now || typeof zoom !== "number" || !sameView(now, move.to, 2 ** zoom)) return;
    this.moveView(move.from);
  }

  /**
   * Where a canvas box is on screen: as shown now, or with `at`, as it will
   * be once the view gets there. Null where Canvas cannot say.
   */
  private screenBox(box: Box | null, at?: ViewState | null): ScreenRect | null {
    const c = this.canvas;
    if (!box || typeof c.getViewportBBox !== "function" || typeof c.wrapperEl.getBoundingClientRect !== "function") return null;
    const wr = c.wrapperEl.getBoundingClientRect();
    if (!(wr.width > 0) || !(wr.height > 0)) return null;
    let k: number, minX: number, minY: number;
    if (at) {
      // Canvas's view is centred on its x and y.
      k = 2 ** at.zoom;
      minX = at.x - wr.width / 2 / k;
      minY = at.y - wr.height / 2 / k;
    } else {
      const view = c.getViewportBBox();
      k = wr.width / (view.maxX - view.minX);
      minX = view.minX;
      minY = view.minY;
    }
    if (!Number.isFinite(k) || !(k > 0)) return null;
    return {
      left: wr.left + (box.minX - minX) * k, top: wr.top + (box.minY - minY) * k,
      right: wr.left + (box.maxX - minX) * k, bottom: wr.top + (box.maxY - minY) * k,
    };
  }

  /**
   * Where a side panel comes to rest on screen. It scales in from its top
   * right corner, so just after opening its drawn left edge is a few pixels
   * right of where it settles; the offset width, which no transform changes,
   * gives that edge.
   */
  private sidePanelRect(el: HTMLElement): ScreenRect {
    const drawn = el.getBoundingClientRect();
    const width = el.offsetWidth;
    return width > 0 ? { left: Math.min(drawn.left, drawn.right - width), top: drawn.top, right: drawn.right, bottom: drawn.bottom } : drawn;
  }

  /** The canvas box of a map's cards, less those folded away. */
  private visibleMapBox(rootId: string): Box | null {
    const { data, forest, hidden } = this.snapshot();
    const members = new Set(mapMembers(forest, rootId));
    return boxOf(data.nodes.filter((node) => members.has(node.id) && !hidden.has(node.id)));
  }

  /**
   * A side panel opened over the map it styles: pan the map left, out from
   * under the panel, as far as the map's own left edge allows. Closing the
   * panel pans back; a panel taking the other's place keeps the pan.
   */
  private makeRoom(panelEl: HTMLElement) {
    const c = this.canvas;
    const now = this.targetView();
    const rootId = this.styleRoot();
    if (!now || !rootId || typeof c.markViewportChanged !== "function" || typeof panelEl.getBoundingClientRect !== "function") return;
    const map = this.screenBox(this.visibleMapBox(rootId), now);
    if (!map) return;
    const wr = c.wrapperEl.getBoundingClientRect();
    const pr = this.sidePanelRect(panelEl);
    // A panel across most of a narrow pane leaves nowhere to pan to.
    if (pr.right - pr.left > wr.width / 2) return;
    const shift = panelShift(map, pr, wr);
    if (!shift) return;
    const from = this.panelPan?.from ?? now;
    this.moveView({ ...now, x: now.x + shift / 2 ** now.zoom });
    this.panelPan = { from, to: this.targetView() ?? now };
  }

  /**
   * With a side panel open, show cards where the panel leaves room: zoom out
   * or pan only as far as they need (a view a layout preview already zoomed
   * out to stays). Canvas's own fit would centre them under the panel. False
   * without a panel, or where Canvas does not say where things are.
   */
  private frameBeside(ids: Set<string>): boolean {
    const c = this.canvas;
    const panel = (this.layoutPanel ?? this.panel)?.el;
    const from = this.targetView();
    if (!panel || !from || typeof c.markViewportChanged !== "function"
      || typeof c.wrapperEl.getBoundingClientRect !== "function" || typeof panel.getBoundingClientRect !== "function") return false;
    const wr = c.wrapperEl.getBoundingClientRect();
    const pr = this.sidePanelRect(panel);
    // A panel across most of a narrow pane leaves no side to show them beside.
    if (!(wr.width > 0) || !(wr.height > 0) || pr.right - pr.left > wr.width / 2) return false;
    const box = boxOf([...ids].map((id) => c.nodes.get(id)?.getData()).filter((node): node is CanvasNodeData => !!node), 16);
    if (!box) return false;
    // The same room the preview made, so what it showed is still what shows.
    const target = roomyView(box, from, { width: wr.width, height: wr.height },
      { top: 60, right: Math.max(8, wr.right - pr.left + 8), bottom: 8, left: 8 });
    if (target) this.moveView(target);
    return true;
  }

  /** The side panel closed: the map comes back from under it, unless `restore` is false or the view moved since. */
  private unpan(restore: boolean) {
    if (!restore) return;
    const pan = this.panelPan;
    this.panelPan = null;
    if (pan) this.restoreView(pan);
  }

  /**
   * The marker or color popover sits beside the card(s) it acts on, on the
   * side away from the map's middle, so they stay in view; with nothing to
   * act on it goes back under the toolbar.
   */
  private anchorPopover() {
    const el = (this.markerPanel ?? this.colorPanel)?.el;
    if (!el) return;
    const c = this.canvas;
    const { forest } = this.snapshot();
    const selected = this.selected();
    const cards = this.markerPanel ? this.markableNodes() : selected && forest.nodes.has(selected.id) ? [selected] : [];
    const card = cards.length ? this.screenBox(boxOf(cards.map((node) => node.getData()))) : null;
    // Offsets, not the drawn box, which the entrance animation scales.
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    if (!card || !(size.width > 0) || !(size.height > 0)) {
      if (el.classList.contains("is-anchored")) {
        el.style.inset = "";
        el.style.translate = "";
        el.classList.remove("is-anchored");
        delete el.dataset.side;
      }
      return;
    }
    const wr = c.wrapperEl.getBoundingClientRect();
    const root = forest.nodes.get(cards[0].id)?.root;
    const map = root ? this.screenBox(this.visibleMapBox(root)) : null;
    const awayFromX = map ? (map.left + map.right) / 2 : wr.left + wr.width / 2;
    // Clear of the toolbar above and Canvas's controls on the right.
    const at = anchorBeside(card, awayFromX, size, { left: wr.left + 8, top: wr.top + 60, right: wr.right - 56, bottom: wr.bottom - 8 });
    // The physical shorthand beats the stylesheet's logical, centred placement in either direction.
    const inset = `${Math.round(at.top - wr.top)}px auto auto ${Math.round(at.left - wr.left)}px`;
    if (el.style.inset !== inset) el.style.inset = inset;
    if (el.style.translate !== "none") el.style.translate = "none";
    if (!el.classList.contains("is-anchored")) el.classList.add("is-anchored");
    if (el.dataset.side !== at.side) el.dataset.side = at.side;
    // While Canvas glides to a new view, follow the card frame by frame.
    const { x, y, zoom, tx, ty, tZoom } = c;
    const gliding = typeof x === "number" && typeof y === "number" && typeof zoom === "number"
      && typeof tx === "number" && typeof ty === "number" && typeof tZoom === "number"
      && ((Math.abs(x - tx) + Math.abs(y - ty)) * 2 ** zoom > 0.5 || Math.abs(zoom - tZoom) > 0.001);
    if (gliding) this.anchorSoon();
  }

  private anchorSoon() {
    if (this.anchorFrame || this.disposed || !(this.markerPanel ?? this.colorPanel)) return;
    this.anchorFrame = this.win.requestAnimationFrame(() => {
      this.anchorFrame = 0;
      if (!this.disposed) this.anchorPopover();
    });
  }

  /**
   * Show where a choice in the layout panel would put the cards, as ghost
   * outlines behind the map, without saving anything. The first ghosts
   * wait a moment, so a pointer crossing the panel draws nothing. Ending
   * the preview with `keepView` keeps what it zoomed out to.
   */
  private previewLayout(patch: LayoutPatch | null, keepView = false) {
    const rootId = patch ? this.styleRoot() : null;
    const next = patch && rootId ? { root: rootId, patch } : null;
    if (!next) {
      this.clearLayoutPreview(keepView);
      return;
    }
    // Another choice within the grace goes on with the same preview, and the view it zoomed out to.
    if (this.previewViewTimer) this.win.clearTimeout(this.previewViewTimer);
    this.previewViewTimer = 0;
    if (JSON.stringify(next) === JSON.stringify(this.layoutPreview)) return;
    this.layoutPreview = next;
    if (this.ghostLayer) {
      this.drawLayoutPreview();
    } else if (!this.previewTimer) {
      this.previewTimer = this.win.setTimeout(() => {
        this.previewTimer = 0;
        this.drawLayoutPreview();
      }, 80);
    }
  }

  private clearLayoutPreview(keepView = false) {
    if (this.previewTimer) this.win.clearTimeout(this.previewTimer);
    this.previewTimer = 0;
    this.layoutPreview = null;
    this.ghostLayer?.remove();
    this.ghostLayer = null;
    this.canvas.wrapperEl.classList.remove("nf-canvas-previewing");
    this.markPreviewStill(null);
    if (!this.previewView) return;
    if (keepView) this.forgetPreviewView();
    // A moment's grace: a pointer crossing to the next row of choices keeps the view as it is.
    else if (!this.previewViewTimer) this.previewViewTimer = this.win.setTimeout(() => this.settlePreviewView(), 150);
  }

  /** The preview is over: the view goes back where it was, unless someone moved it meanwhile. */
  private settlePreviewView() {
    const moved = this.previewView;
    this.forgetPreviewView();
    if (moved) this.restoreView(moved);
  }

  private forgetPreviewView() {
    if (this.previewViewTimer) this.win.clearTimeout(this.previewViewTimer);
    this.previewViewTimer = 0;
    this.previewView = null;
  }

  /** The canvas as the layout preview would arrange it, planned like the change itself. */
  private planLayoutPreview(): { plan: MapLayoutPlan; byId: Map<string, CanvasNodeData> } | null {
    const preview = this.layoutPreview;
    if (!preview) return null;
    const { data, forest } = this.snapshot();
    if (!forest.nodes.has(preview.root)) return null;
    const { patch } = preview;
    const selected = this.selected();
    const info = selected ? forest.nodes.get(selected.id) : undefined;
    const branchId = info && info.parent !== null && info.root === preview.root ? selected!.id : null;
    const patched: CanvasData = {
      ...data,
      nodes: data.nodes.map((node) => {
        if (node.id === preview.root) {
          let next: CanvasNodeData = { ...node };
          if (patch.layout) next[LAYOUT_KEY] = patch.layout;
          if (patch.align) next = patch.align === "center" ? withoutKeys(next, ALIGN_KEY) : { ...next, [ALIGN_KEY]: patch.align };
          if (patch.spacing) next = patch.spacing === "standard" ? withoutKeys(next, SPACING_KEY) : { ...next, [SPACING_KEY]: patch.spacing };
          return next;
        }
        if (node.id === branchId && patch.branch) {
          return patch.branch === "inherit" ? withoutKeys(node, BRANCH_KEY) : { ...node, [BRANCH_KEY]: patch.branch };
        }
        return node;
      }),
    };
    const order = this.readingOrder(data, forest, preview.root);
    const plan = this.planArrange(patched, preview.root, patch.layout ?? null, order);
    return plan ? { plan, byId: new Map(patched.nodes.map((node) => [node.id, node])) } : null;
  }

  private drawLayoutPreview() {
    const container = this.canvas.edgeContainerEl;
    const doc = this.canvas.wrapperEl.ownerDocument;
    const planned = this.active() && container && typeof doc.createElementNS === "function" ? this.planLayoutPreview() : null;
    if (!planned) {
      this.ghostLayer?.remove();
      this.ghostLayer = null;
      this.canvas.wrapperEl.classList.remove("nf-canvas-previewing");
      this.markPreviewStill(null);
      return;
    }
    let layer = this.ghostLayer;
    if (!layer) {
      layer = doc.createElementNS(SVG_NS, "g") as SVGGElement;
      layer.setAttribute("class", "nf-canvas-ghosts nf-canvas-ui");
      this.ghostLayer = layer;
    }
    // Its own layer, first of all: behind the boundaries and the connections.
    if (layer.parentNode !== container) container!.insertBefore(layer, container!.firstChild);
    for (const ghost of Array.from(layer.children)) ghost.remove();
    let drawn = 0;
    // Each ghost is named after its card, in canvas units, so the words scale with the map.
    const labels: SVGTextElement[] = [];
    // Cards the arrangement leaves where they are get no ghost, so they stay at full ink while the rest fade.
    const still = new Set<string>();
    for (const [id, position] of planned.plan.positions) {
      const node = planned.byId.get(id);
      if (!node) continue;
      if (node.x === position.x && node.y === position.y) {
        still.add(id);
        continue;
      }
      if (++drawn > MOTION_LIMIT) break;
      const ghost = doc.createElementNS(SVG_NS, "rect");
      ghost.setAttribute("class", "nf-canvas-ghost");
      ghost.setAttribute("x", String(Math.round(position.x)));
      ghost.setAttribute("y", String(Math.round(position.y)));
      ghost.setAttribute("width", String(node.width));
      ghost.setAttribute("height", String(node.height));
      ghost.setAttribute("rx", "8");
      layer.append(ghost);
      const title = cardTitle(node, 18);
      if (!title) continue;
      const label = doc.createElementNS(SVG_NS, "text") as SVGTextElement;
      label.setAttribute("class", "nf-canvas-ghost-label");
      label.setAttribute("x", String(Math.round(position.x + node.width / 2)));
      label.setAttribute("y", String(Math.round(position.y + node.height / 2)));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("dominant-baseline", "central");
      label.setAttribute("font-size", "15");
      label.setAttribute("fill", "currentColor");
      label.textContent = title;
      labels.push(label);
    }
    // Over every outline, so no ghost hides another's name.
    layer.append(...labels);
    // The live map fades while ghosts show, so the arrangement to come reads first.
    this.canvas.wrapperEl.classList.toggle("nf-canvas-previewing", drawn > 0);
    this.markPreviewStill(drawn > 0 ? still : null);
    if (drawn && !this.previewView) this.fitPreview(planned, this.layoutPreview!.root);
  }

  /** Marks the plan members the previewed arrangement does not move (null clears every mark). */
  private markPreviewStill(ids: Set<string> | null) {
    for (const el of Array.from(this.canvas.wrapperEl.querySelectorAll(".nf-canvas-preview-still"))) {
      if (!ids) el.classList.remove("nf-canvas-preview-still");
    }
    if (!ids) return;
    for (const node of this.canvas.nodes.values()) {
      node.nodeEl?.classList.toggle("nf-canvas-preview-still", ids.has(node.id));
    }
  }

  /**
   * Once per preview, when the arrangement would not fit beside the panel:
   * zoom out only as far as it takes, and pan, so the map as it stands and
   * as it would be both show. The view comes back when the preview ends.
   */
  private fitPreview(planned: { plan: MapLayoutPlan; byId: Map<string, CanvasNodeData> }, rootId: string) {
    const c = this.canvas;
    const panel = this.layoutPanel?.el;
    const from = this.targetView();
    if (!from || !panel || typeof c.markViewportChanged !== "function" || typeof c.getViewportBBox !== "function"
      || typeof c.wrapperEl.getBoundingClientRect !== "function" || typeof panel.getBoundingClientRect !== "function") return;
    const rects: Rectangle[] = [];
    for (const [id, position] of planned.plan.positions) {
      const node = planned.byId.get(id);
      if (node) rects.push({ x: position.x, y: position.y, width: node.width, height: node.height });
    }
    const shown = this.visibleMapBox(rootId);
    if (shown) rects.push({ x: shown.minX, y: shown.minY, width: shown.maxX - shown.minX, height: shown.maxY - shown.minY });
    const box = boxOf(rects, 16);
    const wr = c.wrapperEl.getBoundingClientRect();
    const pr = this.sidePanelRect(panel);
    if (!box || !(wr.width > 0) || !(wr.height > 0)) return;
    // Where the view is heading, in case it is still gliding from the panel's own pan.
    const target = roomyView(box, from, { width: wr.width, height: wr.height },
      { top: 60, right: Math.max(8, wr.right - pr.left + 8), bottom: 8, left: 8 });
    if (!target) return;
    this.moveView(target);
    this.previewView = { from, to: this.targetView() ?? target };
  }

  /** What the layout panel shows: the map that layout actions would change. */
  private layoutPanelState(): LayoutPanelState | null {
    if (this.canvas.readonly) return null;
    const rootId = this.styleRoot();
    const root = rootId ? this.canvas.nodes.get(rootId)?.getData() : undefined;
    if (!rootId || !root) return null;
    const selected = this.selected();
    const info = selected ? this.snapshot().forest.nodes.get(selected.id) : undefined;
    return {
      layout: mapLayout(root) ?? "right",
      branch: info && info.parent !== null ? branchLayout(selected!.getData()) ?? "inherit" : null,
      align: mapAlign(root),
      spacing: mapSpacing(root),
      canRelease: this.canRun("release"),
    };
  }

  /**
   * Change one card of a map and lay the map out again, keeping its reading
   * order: a new structure reads its branches off the old order, not off
   * where the cards happened to be.
   */
  private rearrange(rootId: string, changes: CanvasNodeData[]): boolean {
    const { data, forest } = this.snapshot();
    const order = this.readingOrder(data, forest, rootId);
    canvasTransaction(this.canvas, () => {
      for (const change of changes) this.updateNode(change);
      const plan = this.planArrange(this.canvas.getData(), rootId, null, order);
      if (plan) this.applyPlan(plan);
    });
    this.syncSignature();
    this.refresh();
    this.playMoves();
    return true;
  }

  /** Give the selected branch a structure of its own, or return it to the map's. */
  private setBranch(layout: MapLayout | null): boolean {
    const selected = this.selected();
    const info = selected ? this.snapshot().forest.nodes.get(selected.id) : undefined;
    if (!selected || !info || info.parent === null) return false;
    const data = selected.getData();
    if ((branchLayout(data) ?? null) === layout) return true;
    return this.rearrange(info.root, [layout ? { ...data, [BRANCH_KEY]: layout } : withoutKeys(data, BRANCH_KEY)]);
  }

  /** Line a map's children up with their parents: centred, or from the top. */
  private setAlign(align: MapAlign): boolean {
    const rootId = this.styleRoot();
    if (!rootId) return false;
    const root = this.canvas.nodes.get(rootId)!.getData();
    if (mapAlign(root) === align) return true;
    return this.rearrange(rootId, [align === "center" ? withoutKeys(root, ALIGN_KEY) : { ...root, [ALIGN_KEY]: align }]);
  }

  /** The markers on all of the selected cards, on some of them, and how many are selected. */
  private markerState(): { all: Set<string>; some: Set<string>; count: number } {
    const nodes = this.markableNodes();
    const all = new Set<string>();
    const some = new Set<string>();
    nodes.forEach((node, index) => {
      const ids = markersOf(node.getData());
      for (const id of ids) some.add(id);
      if (index === 0) for (const id of ids) all.add(id);
      else for (const id of [...all]) if (!ids.includes(id)) all.delete(id);
    });
    return { all, some, count: nodes.length };
  }

  /** Change the markers of every selected card, as one undoable step. */
  private setMarkers(change: (current: string[]) => string[]): boolean {
    const nodes = this.markableNodes();
    if (!nodes.length || this.canvas.readonly) return false;
    const updates = nodes.map((node) => withMarkers(node.getData(), change(markersOf(node.getData()))))
      .filter((next, index) => JSON.stringify(next) !== JSON.stringify(nodes[index].getData()));
    if (!updates.length) return true;
    canvasTransaction(this.canvas, () => this.canvas.importData({ nodes: updates, edges: [] }, false));
    this.syncSignature();
    this.refresh();
    return true;
  }

  /** Number the topics of the selected card's map, or stop numbering them. */
  private toggleNumbering(): boolean {
    const rootId = this.styleRoot();
    if (!rootId) return false;
    const root = this.canvas.nodes.get(rootId)!.getData();
    canvasTransaction(this.canvas, () => {
      this.updateNode(hasNumbering(root) ? withoutKeys(root, NUMBERING_KEY) : { ...root, [NUMBERING_KEY]: true });
    });
    this.syncSignature();
    this.refresh();
    return true;
  }

  /**
   * The run of siblings the selection would summarise: every selected card
   * must hang from the same parent on the same side. Null when a summary is
   * selected instead (the action then takes it away) or nothing fits.
   */
  private summaryRun(): { parent: string; from: string; to: string; root: string } | null {
    const nodes = this.markableNodes();
    if (!nodes.length) return null;
    const { data, forest } = this.snapshot();
    const infos = nodes.map((node) => forest.nodes.get(node.id));
    if (infos.some((info) => !info || info.parent === null)) return null;
    const first = infos[0]!;
    if (infos.some((info) => info!.parent !== first.parent || info!.direction !== first.direction)) return null;
    const siblings = orderedChildren(data, forest, first.parent!).filter((id) => forest.nodes.get(id)!.direction === first.direction);
    const places = nodes.map((node) => siblings.indexOf(node.id)).filter((place) => place >= 0);
    if (!places.length) return null;
    return { parent: first.parent!, from: siblings[Math.min(...places)], to: siblings[Math.max(...places)], root: first.root };
  }

  /** The selected summaries, when the selection is summaries. */
  private selectedSummaries(): LiveNode[] {
    const { forest } = this.snapshot();
    return this.markableNodes().filter((node) => {
      const link = summaryLink(node.getData());
      return !!link && forest.nodes.has(link.parent);
    });
  }

  /**
   * Summarise the selected run of branches with a brace and a card past
   * them, and start typing into it; or take the selected summaries away.
   */
  private toggleSummary(): boolean {
    if (this.canvas.readonly) return false;
    const summaries = this.selectedSummaries();
    if (summaries.length) {
      if (typeof this.canvas.removeNode !== "function") return false;
      const { data, forest } = this.snapshot();
      const homes = summaries.map((node) => summaryLink(node.getData())!.parent);
      const roots = new Set(homes.map((id) => forest.nodes.get(id)!.root));
      canvasTransaction(this.canvas, () => {
        for (const node of summaries) {
          for (const edge of [...this.canvas.edges.values()]) {
            const { fromNode, toNode } = edge.getData();
            if (fromNode === node.id || toNode === node.id) this.removeEdges([edge]);
          }
          this.canvas.removeNode!(node);
        }
        this.tidy(roots);
      });
      const home = this.canvas.nodes.get(homes[0]);
      if (home && data.nodes.some((item) => item.id === homes[0])) this.canvas.selectOnly(home);
      this.syncSignature();
      this.refresh();
      this.playMoves();
      return true;
    }
    const run = this.summaryRun();
    if (!run) return false;
    const { data, forest } = this.snapshot();
    const existing = (summaryIndex(data, forest).get(run.parent) ?? []).find((summary) => summary.from === run.from && summary.to === run.to);
    if (existing) {
      // One summary per run: the existing one is selected instead.
      const node = this.canvas.nodes.get(existing.id);
      if (node) this.canvas.selectOnly(node);
      this.refresh();
      return true;
    }
    const byId = new Map(data.nodes.map((node) => [node.id, node]));
    const first = byId.get(run.from)!;
    const color = first.color ? { color: first.color } : {};
    const id = this.newId();
    // A provisional spot beside the run; the tidy layout settles it.
    const node: CanvasNodeData = {
      id, type: "text", text: "", x: Math.round(first.x + first.width + 80), y: Math.round(first.y), ...TOPIC,
      [SUMMARY_KEY]: { parent: run.parent, from: run.from, to: run.to }, ...color,
    };
    canvasTransaction(this.canvas, () => {
      this.canvas.importData({ nodes: [node], edges: [] }, false);
      this.reserved.clear();
      this.tidy([run.root]);
    });
    this.moves.delete(id);
    this.startEditing(id, [id]);
    return true;
  }

  /** The number and markers at a card's corner; nothing when it has neither. */
  private updateBadges(node: LiveNode, markers: string[], number: string | null) {
    let badges = this.badges.get(node.id);
    if (!number && !markers.length) {
      badges?.el.remove();
      this.badges.delete(node.id);
      return;
    }
    const doc = this.canvas.wrapperEl.ownerDocument;
    if (!badges) {
      const el = doc.createElement("div");
      el.className = "nf-canvas-badges nf-canvas-ui";
      badges = { el, key: "" };
      this.badges.set(node.id, badges);
    }
    const key = `${number ?? ""}|${markers.join(",")}`;
    if (badges.key !== key) {
      badges.key = key;
      while (badges.el.firstChild) (badges.el.firstChild as ChildNode).remove();
      if (number) {
        const pill = doc.createElement("span");
        pill.className = "nf-canvas-number";
        pill.textContent = number;
        badges.el.append(pill);
      }
      for (const id of markers) {
        const marker = markerById(id);
        if (marker) badges.el.append(markerBadge(doc, marker));
      }
      const names = markers.map((id) => markerById(id)?.label).filter((label): label is string => !!label).map((label) => t(label));
      badges.el.setAttribute("aria-label", [number ? t("Topic {number}").replace("{number}", number) : "", ...names].filter(Boolean).join(" · "));
    }
    if (badges.el.parentElement !== node.nodeEl) node.nodeEl.append(badges.el);
  }

  /* ---------------------------------------------------------------- */
  /* Notes and links on cards                                          */
  /* ---------------------------------------------------------------- */

  /** What a card's link icon shows: an icon for its kind, the name it leads to, and whether that is gone. */
  private linkFace(link: CardLink, byId: Map<string, CanvasNodeData>): { icon: string; title: string; label: string; broken: boolean } {
    if (link.kind === "url") {
      const short = link.url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
      const title = short.length > 60 ? `${short.slice(0, 60)}…` : short;
      return { icon: "globe", title, label: t("Open {target}").replace("{target}", title), broken: false };
    }
    if (link.kind === "note") return { icon: "file-text", title: link.display, label: t("Open note: {name}").replace("{name}", link.display), broken: false };
    const target = byId.get(link.id);
    if (!target) return { icon: "locate-fixed", title: t("Missing card"), label: t("The linked card is no longer on this canvas."), broken: true };
    const title = cardTitle(target, 40) || t("Card");
    return { icon: "locate-fixed", title, label: t("Go to card: {name}").replace("{name}", title), broken: false };
  }

  /**
   * The note and link icons at a card's lower right corner; nothing when it
   * has neither. One icon holds all of a card's notes, with their count when
   * there are several; each link has an icon of its own, and past
   * LINK_CHIPS the last icon lists them all.
   */
  private updateChips(node: LiveNode, data: CanvasNodeData | undefined, byId: Map<string, CanvasNodeData>) {
    const card = data && data.type !== "group" ? data : undefined;
    const notes = notesOf(card).length;
    const links = linksOf(card);
    let chips = this.chips.get(node.id);
    if (!notes && !links.length) {
      chips?.el.remove();
      this.chips.delete(node.id);
      return;
    }
    const doc = this.canvas.wrapperEl.ownerDocument;
    if (!chips) {
      const el = doc.createElement("div");
      el.className = "nf-canvas-chips nf-canvas-ui";
      chips = { el, key: "" };
      this.chips.set(node.id, chips);
    }
    const shown = links.length > LINK_CHIPS ? links.slice(0, LINK_CHIPS - 1) : links;
    const faces = shown.map((link) => this.linkFace(link, byId));
    const more = links.length - shown.length;
    const key = [notes, ...faces.map((face, index) => `${shown[index].kind}|${face.icon}|${face.label}|${face.broken ? 1 : 0}`), more].join("|");
    if (chips.key !== key) {
      chips.key = key;
      while (chips.el.firstChild) (chips.el.firstChild as ChildNode).remove();
      if (notes) {
        const chip = this.chip("note", "sticky-note", notes > 1 ? t("Show {n} notes").replace("{n}", String(notes)) : t("Show note"));
        if (notes > 1) this.chipCount(chip, String(notes));
        chips.el.append(chip);
      }
      shown.forEach((link, index) => {
        const face = faces[index];
        const chip = this.chip("link", face.icon, face.label);
        chip.dataset.kind = link.kind;
        chip.dataset.index = String(index);
        if (face.broken) chip.classList.add("is-broken");
        chips!.el.append(chip);
      });
      if (more) {
        const chip = this.chip("more", null, t("{n} more links").replace("{n}", String(more)));
        this.chipCount(chip, `+${more}`);
        chips.el.append(chip);
      }
    }
    if (chips.el.parentElement !== node.nodeEl) node.nodeEl.append(chips.el);
  }

  private chip(kind: "note" | "link" | "more", icon: string | null, label: string): HTMLButtonElement {
    const button = this.canvas.wrapperEl.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "nf-canvas-chip";
    button.dataset.chip = kind;
    button.tabIndex = -1;
    button.setAttribute("aria-label", label);
    button.setAttribute("data-tooltip-position", "top");
    if (icon) setIcon(button, icon);
    return button;
  }

  /** A number on an icon: how many notes it holds, or how many more links it lists. */
  private chipCount(chip: HTMLElement, text: string) {
    const count = this.canvas.wrapperEl.ownerDocument.createElement("span");
    count.className = "nf-canvas-chip-count";
    count.textContent = text;
    chip.classList.add("has-count");
    chip.append(count);
  }

  /** Which of its card's links a link icon stands for. */
  private chipIndex(chip: Element): number {
    const index = Number((chip as HTMLElement).dataset?.index ?? 0);
    return Number.isInteger(index) && index >= 0 ? index : 0;
  }

  /**
   * The note or link icon a pointer event is on. Canvas lays its resize
   * handles over the card's edge, where the icons sit, so the event may be
   * the handle's: the icon under it counts, and nothing else does.
   */
  private chipAt(evt: { target: EventTarget | null; clientX: number; clientY: number }): HTMLElement | null {
    if (!this.chips.size) return null;
    const target = evt.target as Element | null;
    const direct = target?.closest?.(".nf-canvas-chip") as HTMLElement | null;
    if (direct) return this.canvas.wrapperEl.contains(direct) ? direct : null;
    if (!target?.closest?.(".canvas-node-interaction-layer")) return null;
    const doc = this.canvas.wrapperEl.ownerDocument;
    if (typeof doc.elementsFromPoint !== "function") return null;
    for (const el of doc.elementsFromPoint(evt.clientX, evt.clientY)) {
      if (el.closest(".canvas-node-interaction-layer")) continue;
      const chip = el.closest(".nf-canvas-chip") as HTMLElement | null;
      return chip && this.canvas.wrapperEl.contains(chip) ? chip : null;
    }
    return null;
  }

  private cardOfChip(chip: Element): string | null {
    for (const [id, chips] of this.chips) if (chips.el.contains(chip)) return this.canvas.nodes.has(id) ? id : null;
    return null;
  }

  /**
   * The icon under the pointer takes the pointer from the resize handles
   * over it, so it shows its own cursor and tooltip; a link to a note
   * offers its page preview, with Mod held as for any link.
   */
  private syncChipHover() {
    const evt = this.hoverEvent;
    const chip = evt && !this.gesture && !this.canvas.isDragging ? this.chipAt(evt) : null;
    if (chip === this.chipHover) return;
    this.chipHover?.classList.remove("is-hover");
    chip?.classList.add("is-hover");
    this.chipHover = chip;
    toggle(this.canvas.wrapperEl, "nf-canvas-chip-hover", !!chip);
    if (!chip || !evt || chip.dataset.chip !== "link" || chip.dataset.kind !== "note") return;
    const id = this.cardOfChip(chip);
    const link = id ? linksOf(this.canvas.nodes.get(id)?.getData())[this.chipIndex(chip)] : undefined;
    if (link?.kind === "note") this.hoverLink(link.linktext, chip, evt);
  }

  private onChipClick = (evt: MouseEvent) => {
    // A press released outside the window leaves no click; a click from the keyboard has no press.
    const pressed = evt.detail > 0 ? this.chipPress : null;
    this.chipPress = null;
    const chip = this.chipAt(evt);
    if (!pressed && !chip) return;
    evt.preventDefault();
    evt.stopImmediatePropagation();
    // The second click of a double click does not undo the first.
    if (chip && (!pressed || chip === pressed) && !(evt.detail > 1)) this.activateChip(chip, evt);
  };

  private onChipDblclick = (evt: MouseEvent) => {
    if (!this.chipAt(evt)) return;
    // Not a card edit, a new card, or Canvas fitting the card to its words.
    evt.preventDefault();
    evt.stopImmediatePropagation();
  };

  private onChipMenu = (evt: MouseEvent) => {
    const chip = this.chipAt(evt);
    if (!chip) return;
    evt.preventDefault();
    evt.stopImmediatePropagation();
    const id = this.cardOfChip(chip);
    if (!id || !this.active()) return;
    if (chip.dataset.chip === "more") {
      this.linksMenu(id).showAtMouseEvent(evt);
      return;
    }
    const menu = new Menu();
    const add = (title: string, icon: string, run: () => unknown) => menu.addItem((item) => item.setTitle(t(title)).setIcon(icon).onClick(() => { run(); }));
    const editable = this.noteEditable();
    if (chip.dataset.chip === "note") {
      const count = notesOf(this.canvas.nodes.get(id)?.getData()).length;
      add(count > 1 ? "Show notes" : "Show note", "sticky-note", () => this.openNote(id, "view"));
      if (editable) {
        if (count === 1) add("Edit note", "pencil", () => this.openNote(id, "edit"));
        add("Add another note", "plus", () => this.openNote(id, "add"));
        add(count > 1 ? "Delete all notes" : "Delete note", "trash-2", () => this.setNotes(id, []));
      }
    } else {
      const index = this.chipIndex(chip);
      const link = linksOf(this.canvas.nodes.get(id)?.getData())[index];
      if (!link) return;
      add("Open link", "arrow-up-right", () => this.followLink(id, undefined, index));
      if (link.kind === "note") add("Open in new tab", "file-plus", () => this.followLink(id, "tab", index));
      if (link.kind !== "card") add("Copy link", "copy", () => this.copyLink(link));
      if (editable) {
        add("Edit link…", "link", () => this.pickLink(id, index));
        add("Remove link", "unlink", () => this.setLinkAt(id, index, null));
      }
    }
    menu.showAtMouseEvent(evt);
  };

  /** A click on an icon: the notes open beside their card, a link is followed, the last icon lists the links. */
  private activateChip(chip: HTMLElement, evt: MouseEvent) {
    const id = this.cardOfChip(chip);
    if (!id || !this.active()) return;
    if (chip.dataset.chip === "more") {
      this.linksMenu(id).showAtMouseEvent(evt);
      return;
    }
    if (chip.dataset.chip !== "note") {
      this.followLink(id, evt, this.chipIndex(chip));
      return;
    }
    if (this.note?.id === id) {
      this.closeNote();
      this.canvas.wrapperEl.focus();
      return;
    }
    // The card is selected, so the keys and the toolbar act on it while its note is open.
    const node = this.canvas.nodes.get(id)!;
    if (!this.stage && !(this.canvas.selection.size === 1 && this.canvas.selection.has(node))) this.canvas.selectOnly(node);
    this.openNote(id, "view");
  }

  /** A card's links in a menu, each followed when chosen (Mod for a new tab), and one more to add. */
  private linksMenu(id: string): Menu {
    const menu = new Menu();
    const byId = new Map(this.snapshot().data.nodes.map((node) => [node.id, node]));
    linksOf(this.canvas.nodes.get(id)?.getData()).forEach((link, index) => {
      const face = this.linkFace(link, byId);
      menu.addItem((item) => item.setTitle(face.title).setIcon(face.icon).onClick((evt) => { this.followLink(id, evt, index); }));
    });
    if (this.app && !this.canvas.readonly && !this.stage) {
      menu.addSeparator();
      menu.addItem((item) => item.setTitle(t("Add another link…")).setIcon("link").onClick(() => { this.pickLink(id); }));
    }
    return menu;
  }

  /** Open link: the card's one link, or with several a menu of them under the card's icons. */
  private openLinks(id: string): boolean {
    if (linkValues(this.canvas.nodes.get(id)?.getData()).length <= 1) return this.followLink(id);
    const anchor = this.chips.get(id)?.el ?? this.canvas.nodes.get(id)?.nodeEl;
    const box = typeof anchor?.getBoundingClientRect === "function" ? anchor.getBoundingClientRect() : null;
    this.linksMenu(id).showAtPosition(box ? { x: box.left, y: box.bottom } : { x: 0, y: 0 }, this.canvas.wrapperEl.ownerDocument);
    return true;
  }

  /** Follow one of a card's links: the card on this canvas, the note in a pane, the page in the browser. */
  private followLink(id: string, how?: MouseEvent | KeyboardEvent | PaneType | boolean, index = 0): boolean {
    const link = linksOf(this.canvas.nodes.get(id)?.getData())[index];
    if (!link || !this.active()) return false;
    if (link.kind === "card") return this.goToCard(link.id);
    if (link.kind === "url") {
      if (typeof this.win.open === "function") this.win.open(link.url, "_blank", "noopener,noreferrer");
      return true;
    }
    const app = this.app;
    if (!app) return false;
    // Mod opens a new tab, as with any link; a plain click keeps the pane.
    const pane = typeof how === "string" || typeof how === "boolean" ? how : Keymap.isModEvent(how ?? null);
    void app.workspace.openLinkText(link.linktext, this.view.file?.path ?? "", pane);
    return true;
  }

  /** Go to a card a link leads to; on stage, to the stop that shows it. */
  private goToCard(target: string): boolean {
    if (!this.canvas.nodes.has(target)) {
      new Notice(t("The linked card is no longer on this canvas."));
      return false;
    }
    this.closeNote();
    if (this.stage) {
      const index = this.stage.stepOf(target);
      if (index >= 0) this.stage.go(index);
      return index >= 0;
    }
    return this.jumpTo(target);
  }

  private copyLink(link: CardLink) {
    const text = link.kind === "url" ? link.url : link.kind === "note" ? `[[${link.linktext}]]` : "";
    const clipboard = this.win.navigator?.clipboard;
    if (!text || !clipboard?.writeText) {
      new Notice(t("Could not access the clipboard."));
      return;
    }
    clipboard.writeText(text).then(() => new Notice(t("Link copied.")), () => new Notice(t("Could not access the clipboard.")));
  }

  /** Obsidian's page preview for a link, when Mod is held or the preview settings say so. */
  private hoverLink(linktext: string, targetEl: HTMLElement, evt: MouseEvent) {
    if (!linktext) return;
    this.app?.workspace.trigger("hover-link", {
      event: evt, source: HOVER_SOURCE, hoverParent: this.hoverParent, targetEl, linktext, sourcePath: this.view.file?.path ?? "",
    });
  }

  /** Where each card sits, to tell cards of one name apart: its map's centre, or its group. */
  private cardContexts(data: CanvasData, forest: Forest): Map<string, string> {
    const byId = new Map(data.nodes.map((node) => [node.id, node]));
    const groups = data.nodes.filter((node) => node.type === "group");
    const contexts = new Map<string, string>();
    for (const node of data.nodes) {
      const info = forest.nodes.get(node.id);
      let context = "";
      if (info && info.root !== node.id) context = cardTitle(byId.get(info.root)!);
      else if (node.type !== "group") {
        const group = groups.find((candidate) => candidate.id !== node.id
          && node.x >= candidate.x && node.y >= candidate.y
          && node.x + node.width <= candidate.x + candidate.width && node.y + node.height <= candidate.y + candidate.height);
        if (group) context = cardTitle(group);
      }
      contexts.set(node.id, context);
    }
    return contexts;
  }

  /** The cards a link can lead to, in reading order, each with where it sits; never the card itself. */
  private linkableCards(exclude: string | null): LinkableCard[] {
    const { data, forest } = this.snapshot();
    const contexts = this.cardContexts(data, forest);
    return data.nodes
      .filter((item) => item.id !== exclude && item.type !== "group")
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((item) => ({ id: item.id, title: cardTitle(item, 60), context: contexts.get(item.id) ?? "" }))
      .filter((card) => card.title);
  }

  /**
   * Open the link picker for a card: with `index`, to change or remove that
   * link; without, to add one more — a web address, a note or heading, or
   * another card. Adding lists the card's links first, to edit one of them.
   */
  private pickLink(id: string, index?: number): boolean {
    const app = this.app;
    const node = this.canvas.nodes.get(id);
    if (!app || !node || this.canvas.readonly) return false;
    const byId = new Map(this.snapshot().data.nodes.map((item) => [item.id, item]));
    const values = linkValues(node.getData());
    const links = linksOf(node.getData());
    const editing = index !== undefined && index >= 0 && index < values.length ? index : null;
    const link = editing === null ? null : links[editing];
    const sourcePath = this.view.file?.path ?? "";
    const modal = new CardLinkModal(app, {
      files: app.vault.getFiles().filter((file) => file.path !== sourcePath),
      recent: app.workspace.getLastOpenFiles(),
      cards: this.linkableCards(id),
      linktext: (file) => app.metadataCache.fileToLinktext(file, sourcePath, true),
      headings: (file) => app.metadataCache.getFileCache(file)?.headings ?? [],
      current: editing === null ? null : values[editing],
      currentLabel: link ? this.linkFace(link, byId).title : "",
      links: values.map((value, at) => ({ value, label: this.linkFace(links[at], byId).title })),
    }, link?.kind === "url" ? link.url : link?.kind === "note" ? link.linktext : "", (value) => {
      if (editing !== null) this.setLinkAt(id, editing, value);
      else if (value !== null) this.addLink(id, value);
    }, (value) => {
      // One of the card's links, chosen while adding: that link opens to be changed.
      const at = linkValues(this.canvas.nodes.get(id)?.getData()).indexOf(value);
      if (at >= 0) this.pickLink(id, at);
    });
    modal.open();
    return true;
  }

  /** Give a card these links, in order, as one undoable step; none takes them all away. */
  private setLinks(id: string, values: readonly string[]): boolean {
    const node = this.canvas.nodes.get(id);
    if (!node || this.canvas.readonly || !this.active()) return false;
    return this.writeLinks(node, withLinks(node.getData(), values));
  }

  /** One more link for a card, after the others, as one undoable step; a link it has already adds nothing. */
  private addLink(id: string, value: string): boolean {
    const node = this.canvas.nodes.get(id);
    if (!node || this.canvas.readonly || !this.active()) return false;
    const values = linkValues(node.getData());
    if (values.includes(value.trim())) {
      new Notice(t("The card already has this link."));
      return true;
    }
    return this.writeLinks(node, withLinkAt(node.getData(), values.length, value));
  }

  /** Change a card's `index`-th link, or with null take it away, as one undoable step. */
  private setLinkAt(id: string, index: number, value: string | null): boolean {
    const node = this.canvas.nodes.get(id);
    if (!node || this.canvas.readonly || !this.active()) return false;
    return this.writeLinks(node, withLinkAt(node.getData(), index, value));
  }

  private writeLinks(node: LiveNode, next: CanvasNodeData): boolean {
    if (sameLinks(next, node.getData())) return true;
    canvasTransaction(this.canvas, () => this.updateNode(next));
    this.refresh();
    return true;
  }

  /**
   * Give a card these notes, or with none take them away, as one undoable
   * step. Its open notes close first, unless `keepOpen` (a task ticked in one).
   */
  private setNotes(id: string, notes: readonly string[], keepOpen = false): boolean {
    if (!keepOpen && this.note?.id === id) this.closeNote();
    const node = this.canvas.nodes.get(id);
    if (!node || !this.noteEditable() || !this.active()) return false;
    const data = node.getData();
    const next = withNotes(data, notes);
    if (sameNotes(notesOf(next), notesOf(data))) return true;
    canvasTransaction(this.canvas, () => this.updateNode(next));
    this.refresh();
    return true;
  }

  private noteEditable(): boolean {
    return !this.canvas.readonly && !this.stage;
  }

  /** The Note button: open the selected card's notes, or put the open ones away. */
  private toggleNote(id: string | null): boolean {
    if (this.note && (id === null || this.note.id === id)) {
      this.closeNote();
      this.canvas.wrapperEl.focus();
      return true;
    }
    return !!id && this.openNote(id, "view");
  }

  /**
   * Open a card's notes beside it: to read them; with "edit" to type in its
   * note when it has one (several are read, each edited on its own); with
   * "add" to start another. A card without notes starts its first. On a
   * read-only canvas notes are only read.
   */
  private openNote(id: string, mode: "view" | "edit" | "add"): boolean {
    const node = this.canvas.nodes.get(id);
    if (!node || node.getData().type === "group" || !this.active()) return false;
    const editable = this.noteEditable();
    const count = notesOf(node.getData()).length;
    if ((!editable && !count) || (!editable && mode === "add")) return false;
    // The note to type in: a new one, the only one, or none while several are read.
    const write = !editable ? null : mode === "add" || !count ? count : mode === "edit" && count === 1 ? 0 : null;
    if (this.note?.id === id) {
      if (mode === "add") this.note.panel.add();
      else if (write !== null) this.note.panel.setMode("edit", write);
      return true;
    }
    this.closeNote(false);
    const doc = this.canvas.wrapperEl.ownerDocument;
    const panel = new NotePanel(doc, {
      title: () => {
        const data = this.canvas.nodes.get(id)?.getData();
        return data ? cardTitle(data, 60) : "";
      },
      // While a note is written, the notes keep the places they had: one emptied on the way still holds its own.
      notes: () => this.note?.id === id && this.note.before !== null ? [...this.note.base] : notesOf(this.canvas.nodes.get(id)?.getData()),
      editable: () => this.noteEditable(),
      render: (items) => this.renderNotes(items),
      follow: (link, evt) => this.followNoteLink(link, evt),
      hover: (link, evt) => this.hoverLink(link.getAttribute("data-href") ?? link.getAttribute("href") ?? "", link, evt),
      rewrite: (index, text) => {
        const at = this.finishNoteEdit(index);
        const notes = notesOf(this.canvas.nodes.get(id)?.getData());
        if (at < 0 || at >= notes.length) return;
        notes[at] = text;
        this.setNotes(id, notes, true);
      },
      editing: () => this.beginNoteEdit(),
      input: (index, text) => this.typeNote(id, index, text),
      done: () => this.commitNote(),
      remove: (index) => this.removeNote(id, index),
      close: () => {
        this.closeNote();
        this.canvas.wrapperEl.focus();
      },
    }, "view");
    // The panel follows its card as the canvas pans and zooms, and as the card moves or the pane resizes.
    const watchers: { disconnect(): void }[] = [];
    const Observer = this.win.MutationObserver;
    for (const target of [this.canvas.canvasEl, node.nodeEl]) {
      if (!target) continue;
      const observer = new Observer(this.placeNoteSoon);
      observer.observe(target, { attributes: true, attributeFilter: ["style", "class"] });
      watchers.push(observer);
    }
    const Resize = (this.win as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (typeof Resize === "function") {
      const resize = new Resize(this.placeNoteSoon);
      resize.observe(panel.el);
      resize.observe(this.canvas.wrapperEl);
      watchers.push(resize);
    }
    this.note = { id, panel, before: null, base: [], watchers, frame: 0 };
    this.canvas.wrapperEl.append(panel.el);
    doc.addEventListener("pointerdown", this.onNoteOutside, true);
    if (write !== null) panel.setMode("edit", write);
    this.placeNote();
    this.refresh();
    return true;
  }

  /**
   * Put the notes away, keeping what was typed as one undo step. `refresh`
   * is false when a render is already under way; `keep` is false when the
   * canvas has moved on to another file (or is going away), whose card of
   * the same id must not take the words. They reached the card as typed.
   */
  private closeNote(refresh = true, keep = true) {
    const note = this.note;
    if (!note) return;
    // Words still being composed are kept too.
    const draft = keep ? note.panel.draft : null;
    if (draft !== null) this.typeNote(note.id, draft.index, draft.text);
    if (keep) this.commitNote();
    this.note = null;
    for (const watcher of note.watchers) watcher.disconnect();
    if (note.frame) this.win.cancelAnimationFrame(note.frame);
    this.canvas.wrapperEl.ownerDocument.removeEventListener("pointerdown", this.onNoteOutside, true);
    this.noteComponent?.unload();
    this.noteComponent = null;
    note.panel.destroy();
    if (refresh && !this.disposed) this.refresh();
  }

  /**
   * Editing starts: the notes as they are now are what one undo brings
   * back, and the list the words typed go into, each note in its place.
   */
  private beginNoteEdit() {
    const note = this.note;
    if (!note || note.before !== null) return;
    note.before = notesOf(this.canvas.nodes.get(note.id)?.getData());
    note.base = [...note.before];
    this.canvas.requestPushHistory.run();
    // A blank history would take the first words for the canvas's starting point.
    if (this.canvas.history.data.length === 0) this.canvas.pushHistory(this.canvas.getData());
  }

  /**
   * The words as they are typed go onto the card and into the file at
   * once, as Canvas keeps a card's own words; the undo step waits for the
   * editing to end, so it takes all of them. They go into the note's place
   * in the list editing began with, where a note emptied on the way keeps
   * its place, so the others never shift; past the last one, a new note.
   */
  private typeNote(id: string, index: number, text: string) {
    const node = this.canvas.nodes.get(id);
    if (!node || !this.noteEditable()) return;
    const note = this.note;
    const notes = note?.id === id && note.before !== null ? note.base : notesOf(node.getData());
    if (index < notes.length) notes[index] = text;
    else notes.push(text);
    const data = node.getData();
    const next = withNotes(data, notes);
    if (sameNotes(notesOf(next), notesOf(data))) return;
    this.canvas.importData({ nodes: [next], edges: [] }, false);
    this.canvas.requestSave(false);
  }

  /** What was typed since editing began becomes one undo step. */
  private commitNote() {
    const note = this.note;
    if (!note || note.before === null) return;
    const before = note.before;
    note.before = null;
    note.base = [];
    const node = this.canvas.nodes.get(note.id);
    if (!node) return;
    const now = notesOf(node.getData());
    if (sameNotes(now, before)) return;
    const history = this.canvas.history;
    this.canvas.requestPushHistory.run();
    // A save of Canvas's own may have recorded the words already.
    const recorded = history.data[history.current]?.nodes?.find((item) => item.id === note.id);
    if (recorded && sameNotes(notesOf(recorded), now)) return;
    this.canvas.requestSave();
    this.canvas.requestPushHistory.run();
  }

  /**
   * The note being written is kept, its words their own undo step, and the
   * notes are read again. Returns where the note the panel showed at
   * `index` now is among the card's notes: one emptied on the way is gone.
   */
  private finishNoteEdit(index: number): number {
    const note = this.note;
    if (!note || note.panel.mode !== "edit") return index;
    const at = note.before !== null ? note.base.slice(0, index).filter((text) => text.trim()).length : index;
    this.commitNote();
    note.panel.setMode("view");
    return at;
  }

  /**
   * Delete one of a card's notes as one undo step, the notes staying open
   * while any are left. The note being written goes as if its words were
   * typed away, so undo brings it back as it was before any editing.
   */
  private removeNote(id: string, index: number) {
    const note = this.note;
    if (!note || note.id !== id || !this.noteEditable()) return;
    const panel = note.panel;
    if (panel.editingIndex === index) {
      this.beginNoteEdit();
      panel.forget();
      this.typeNote(id, index, "");
      this.commitNote();
      panel.setMode("view");
    } else {
      // A note being written keeps its words first, as its own step.
      const at = this.finishNoteEdit(index);
      const notes = notesOf(this.canvas.nodes.get(id)?.getData());
      if (at < 0 || at >= notes.length) return;
      notes.splice(at, 1);
      this.setNotes(id, notes, true);
    }
    if (!hasNote(this.canvas.nodes.get(id)?.getData())) {
      this.closeNote();
      this.canvas.wrapperEl.focus();
    }
  }

  /** Keep the open notes with their card: gone, folded away, typed in, or left for another card, they close. */
  private syncNote(hidden: Set<string>) {
    const note = this.note;
    if (!note) return;
    const node = this.canvas.nodes.get(note.id);
    const reading = note.panel.mode === "view";
    const elsewhere = this.selectedNodes().length > 0 && !this.selectedNodes().some((item) => item.id === note.id);
    if (!node || hidden.has(note.id) || isEditingNode(node) || (reading && (elsewhere || !hasNote(node.getData())))) {
      this.closeNote(false);
      return;
    }
    note.panel.sync();
    this.placeNoteSoon();
  }

  private placeNoteSoon = () => {
    const note = this.note;
    if (!note || note.frame || this.disposed) return;
    note.frame = this.win.requestAnimationFrame(() => {
      note.frame = 0;
      if (this.note === note) this.placeNote();
    });
  };

  /** Hang the notes under their card, or keep them out of sight while the card is off screen. */
  private placeNote() {
    const note = this.note;
    const node = note ? this.canvas.nodes.get(note.id) : undefined;
    const wrapper = this.canvas.wrapperEl;
    if (!note || !node || typeof wrapper.getBoundingClientRect !== "function") return;
    const bounds = wrapper.getBoundingClientRect();
    const el = node.nodeEl;
    let anchor: ScreenBox | null = null;
    if (el.isConnected && !el.classList.contains("nf-canvas-hidden")) {
      const card = el.getBoundingClientRect();
      // The icons hang below the card's edge; the notes clear them.
      const chips = this.chips.get(note.id)?.el;
      const below = chips?.isConnected ? chips.getBoundingClientRect().bottom : card.bottom;
      anchor = { left: card.left, top: card.top, right: card.right, bottom: Math.max(card.bottom, below) };
      const shown = anchor.right > bounds.left && anchor.left < bounds.right && anchor.bottom > bounds.top && anchor.top < bounds.bottom;
      if (!shown) anchor = null;
    }
    note.panel.place(anchor, bounds, { w: this.win.innerWidth, h: this.win.innerHeight });
  }

  /** A press anywhere but the notes (or an icon, which toggles them) puts them away. */
  private onNoteOutside = (evt: PointerEvent) => {
    const note = this.note;
    if (!note) return;
    const target = evt.target as Element | null;
    if (target && note.panel.el.contains(target)) return;
    if (this.chipAt(evt)) return;
    // The Note buttons toggle it themselves; menus, suggestions and dialogs opened over it are part of it.
    if (target?.closest?.('[data-action="note"], .menu, .suggestion-container, .modal-container')) return;
    this.closeNote();
  };

  /** Draw notes' Markdown as Obsidian draws a note; without an app, as plain words. */
  private renderNotes(items: readonly { markdown: string; el: HTMLElement }[]) {
    this.noteComponent?.unload();
    this.noteComponent = null;
    const app = this.app;
    if (!app) {
      for (const { markdown, el } of items) {
        el.classList.add("is-plain");
        el.textContent = markdown;
      }
      return;
    }
    const component = this.noteComponent = new Component();
    component.load();
    for (const { markdown, el } of items) {
      MarkdownRenderer.render(app, markdown, el, this.view.file?.path ?? "", component)
        .then(() => this.placeNoteSoon(), (error: unknown) => console.error("Notion Flow: could not draw the card's note", error));
    }
  }

  /** Links in a note: cards and notes open as links do in Obsidian, tags search; web links open on their own. */
  private followNoteLink(link: HTMLAnchorElement, evt: MouseEvent): boolean {
    const card = this.cardLinkTarget(link);
    if (card !== null) {
      if (card) this.goToCard(card);
      else new Notice(t("The linked card is no longer on this canvas."));
      return true;
    }
    const app = this.app;
    if (!app) return false;
    if (link.classList.contains("internal-link")) {
      const href = link.getAttribute("data-href") ?? link.getAttribute("href");
      if (!href) return false;
      void app.workspace.openLinkText(href, this.view.file?.path ?? "", Keymap.isModEvent(evt));
      return true;
    }
    if (link.classList.contains("tag")) {
      const plugins = (app as unknown as { internalPlugins?: { getEnabledPluginById?(id: string): { openGlobalSearch?(query: string): void } | null } }).internalPlugins;
      plugins?.getEnabledPluginById?.("global-search")?.openGlobalSearch?.(`tag:${link.getAttribute("href") ?? link.textContent ?? ""}`);
      return true;
    }
    return false;
  }

  /* ---------------------------------------------------------------- */
  /* Links to cards in a card's words                                  */
  /* ---------------------------------------------------------------- */

  /**
   * The card a link drawn in a card's words or notes leads to:
   * `[[#^id|Name]]` and `[Name](#^id)` draw as internal links to a block of
   * this canvas, which Obsidian cannot follow. The card's id; "" for a link
   * to a card that is gone; null when the link is not to a card here.
   */
  private cardLinkTarget(link: Element): string | null {
    if (!link.classList?.contains("internal-link")) return null;
    return this.cardOfHref(link.getAttribute("data-href") ?? link.getAttribute("href") ?? "");
  }

  /** The card a link's target names, as cardLinkTarget reads it. */
  private cardOfHref(href: string): string | null {
    const ref = cardRefOf(href);
    if (!ref) return null;
    const here = this.view.file?.path ?? "";
    if (ref.path) {
      // A path names this canvas only when it leads here.
      const dest = this.app?.metadataCache?.getFirstLinkpathDest?.(ref.path, here);
      if (!dest || dest.path !== here) return null;
    }
    if (this.canvas.nodes.has(ref.id)) return ref.id;
    // A block of a canvas can only be a card; a heading might be anything.
    return href.includes("#^") ? "" : null;
  }

  /**
   * A click on a link to a card, in a card's words or its notes, goes to
   * that card as a link icon does, before Canvas or Obsidian read it: they
   * know no links to cards, and Obsidian would open the canvas again.
   */
  private onCardLinkClick = (evt: MouseEvent) => {
    if (!this.active() || (evt.type === "auxclick" && evt.button !== 1)) return;
    const link = (evt.target as Element | null)?.closest?.(".internal-link") ?? null;
    if (!link || !this.canvas.wrapperEl.contains(link)) return;
    const target = this.cardLinkTarget(link);
    if (target === null) return;
    evt.preventDefault();
    evt.stopImmediatePropagation();
    this.lightCard(null);
    if (target) this.goToCard(target);
    else new Notice(t("The linked card is no longer on this canvas."));
  };

  /**
   * The pointer on a link to a card lights the card it leads to, in place of
   * Obsidian's page preview, which would show the whole canvas.
   */
  private onCardLinkOver = (evt: MouseEvent) => {
    const link = (evt.target as Element | null)?.closest?.(".internal-link") ?? null;
    const target = link && this.active() && this.canvas.wrapperEl.contains(link) ? this.cardLinkTarget(link) : null;
    if (target === null) return;
    evt.stopPropagation();
    this.lightCard(target || null);
  };

  private onCardLinkOut = (evt: MouseEvent) => {
    if (!this.litCard) return;
    const from = (evt.target as Element | null)?.closest?.(".internal-link") ?? null;
    const to = (evt.relatedTarget as Element | null)?.closest?.(".internal-link") ?? null;
    if (from && from === to) return;
    this.lightCard(null);
  };

  private lightCard(id: string | null) {
    if (this.litCard === id) return;
    if (this.litCard) this.canvas.nodes.get(this.litCard)?.nodeEl.classList.remove("nf-canvas-link-target");
    this.litCard = id;
    if (id) this.canvas.nodes.get(id)?.nodeEl.classList.add("nf-canvas-link-target");
  }

  /** The text card being typed in, with its editor. */
  private typingCard(): { node: LiveNode; cm: EditorView } | null {
    for (const node of this.editorSurfaces.keys()) {
      const cm = node.child?.editMode?.cm;
      if (cm && isEditingNode(node) && this.canvas.nodes.get(node.id) === node) return { node, cm };
    }
    return null;
  }

  /** Whether the vault writes Markdown links rather than wikilinks. */
  private markdownLinks(): boolean {
    const vault = this.app?.vault as unknown as { getConfig?: (key: string) => unknown } | undefined;
    return vault?.getConfig?.call(vault, "useMarkdownLinks") === true;
  }

  /** Whether a card on this canvas is being typed in with this editor, where a link to another card can go. */
  typingWith(cm: unknown): boolean {
    return !!cm && this.active() && !this.canvas.readonly && this.typingCard()?.cm === cm;
  }

  /**
   * The cards the words of the card being typed in with this editor can
   * link to; null when no card on this canvas is typed in with it.
   */
  cardLinkChoices(cm: unknown): { cards: LinkableCard[]; markdown: boolean } | null {
    if (!this.typingWith(cm)) return null;
    const typing = this.typingCard()!;
    return { cards: this.linkableCards(typing.node.id).filter((card) => linkableCardId(card.id)), markdown: this.markdownLinks() };
  }

  /**
   * Link another card from the words of the card being typed in: pick it by
   * its name, and `[[#^id|Name]]` goes in at the caret, or over the words
   * selected, which become the link's text.
   */
  private pickCardLink(): boolean {
    const app = this.app;
    const typing = this.typingCard();
    if (!app || !typing) return false;
    const { node, cm } = typing;
    const cards = this.linkableCards(node.id).filter((card) => linkableCardId(card.id));
    if (!cards.length) {
      new Notice(t("There is no other card on this canvas to link to."));
      return true;
    }
    const { from, to } = cm.state.selection.main;
    const hits: CardHit[] = cards.map((card) => ({ id: card.id, label: card.title, context: card.context, hidden: false }));
    new CardSearchModal(app, hits, (hit) => this.insertCardLink(node, from, to, hit), t("Link to a card…")).open();
    return true;
  }

  private insertCardLink(node: LiveNode, from: number, to: number, hit: CardHit) {
    const cm = node.child?.editMode?.cm;
    if (!cm || !isEditingNode(node) || this.canvas.nodes.get(node.id) !== node || typeof cm.dispatch !== "function") return;
    const length = cm.state.doc.length;
    const start = Math.min(from, length);
    const end = Math.min(Math.max(to, start), length);
    // Selected words name the link, when a link's text can hold them.
    const words = cm.state.doc.sliceString(start, end).trim();
    const text = cardLinkText(hit.id, words && !/[\n[\]|]/.test(words) ? words : hit.label, this.markdownLinks());
    cm.dispatch({ changes: { from: start, to: end, insert: text }, selection: { anchor: start + text.length }, userEvent: "input" });
    cm.focus();
  }

  /** Copy a link to the card, to paste into another card's words: a click on it there comes here. */
  private copyCardLink(id: string): boolean {
    const node = this.canvas.nodes.get(id);
    if (!node || !linkableCardId(id)) return false;
    const text = cardLinkText(id, cardTitle(node.getData(), 60) || t("Card"), this.markdownLinks());
    const clipboard = this.win.navigator?.clipboard;
    if (!clipboard?.writeText) {
      new Notice(t("Could not access the clipboard."));
      return false;
    }
    clipboard.writeText(text).then(() => new Notice(t("Card link copied: paste it into another card's words.")),
      () => new Notice(t("Could not access the clipboard.")));
    return true;
  }

  toggleHelpPanel(open = !this.helpPanel) {
    if (!open) {
      this.closeHelpPanel();
      return;
    }
    if (this.helpPanel || !this.active()) return;
    this.closeStylePanel();
    this.closeMarkerPanel();
    this.closeColorPanel();
    this.closeLayoutPanel();
    const settings = this.settings();
    this.helpPanel = new HelpPanel(this.canvas.wrapperEl.ownerDocument, {
      close: () => {
        this.closeHelpPanel();
        this.canvas.wrapperEl.focus();
      },
    }, { keyboard: settings.canvasKeyboard, editorKeys: settings.canvasEditorKeys !== false });
    this.canvas.wrapperEl.append(this.helpPanel.el);
    this.refresh();
  }

  private closeHelpPanel() {
    if (!this.helpPanel) return;
    this.helpPanel.destroy();
    this.helpPanel = null;
    if (!this.disposed) this.refresh();
  }

  /* ---------------------------------------------------------------- */
  /* Branch color                                                     */
  /* ---------------------------------------------------------------- */

  toggleColorPanel(open = !this.colorPanel) {
    if (!open) {
      this.closeColorPanel();
      return;
    }
    if (this.colorPanel || !this.active()) return;
    this.closeStylePanel();
    this.closeMarkerPanel();
    this.closeHelpPanel();
    this.closeLayoutPanel();
    this.cancelConnecting();
    // Tones built on page variables (the accent, Canvas's digits) change with
    // the accent, theme or a snippet, none of which the cache key sees: read
    // them afresh for each opening, and only once per opening.
    this.toneCache = null;
    this.colorPanel = new BranchColorPanel(this.canvas.wrapperEl.ownerDocument, {
      state: () => this.colorPanelState(),
      pick: (color) => { this.setBranchColor(color); },
      close: () => {
        this.closeColorPanel();
        this.canvas.wrapperEl.focus();
      },
      // Kept per device with Obsidian's own local storage, where it exists.
      recent: {
        load: () => typeof this.app?.loadLocalStorage === "function" ? this.app.loadLocalStorage(RECENT_COLOR_KEY) : null,
        save: (list) => { if (typeof this.app?.saveLocalStorage === "function") this.app.saveLocalStorage(RECENT_COLOR_KEY, list); },
      },
    });
    this.canvas.wrapperEl.append(this.colorPanel.el);
    this.refresh();
  }

  private closeColorPanel() {
    if (!this.colorPanel) return;
    this.colorPanel.destroy();
    this.colorPanel = null;
    if (!this.disposed) this.refresh();
  }

  /** The color the selected branch card carries, and its map's tones; null without a map card. */
  private colorPanelState(): { color: string | null; tones: string[] } | null {
    if (this.canvas.readonly) return null;
    const selected = this.selected();
    const info = selected ? this.snapshot().forest.nodes.get(selected.id) : undefined;
    if (!selected || !info) return null;
    const color = selected.getData().color;
    return { color: typeof color === "string" && color ? color : null, tones: this.schemeTones(info.root) };
  }

  /**
   * The branch tones of the palette a map shows, as #rrggbb for the mode
   * shown now, without repeats: what a card can be given to match its map.
   * None for a map without a palette, or with vivid's own colors.
   */
  private schemeTones(rootId: string): string[] {
    const palette = this.shownPalette(this.canvas.nodes.get(rootId)?.getData());
    if (!palette) return [];
    const css = presetColors(palette, this.support).branchColors;
    // Reading a color off the page costs a style pass; the same palette in the same mode reads the same.
    const key = `${css.join("|")}|${this.canvas.wrapperEl.ownerDocument.body?.classList.contains("theme-dark") ?? false}`;
    if (this.toneCache?.key === key) return this.toneCache.tones;
    const tones: string[] = [];
    for (const color of css) {
      const hex = resolveColor(this.canvas.wrapperEl, color);
      if (hex && !tones.includes(hex)) tones.push(hex);
    }
    this.toneCache = { key, tones };
    return tones;
  }

  /**
   * Color the selected card's branch: the card, everything below it, the
   * lines into them and their summaries, as one undo step. Null clears it.
   */
  private setBranchColor(color: string | null): boolean {
    const selected = this.selected();
    const { data, forest } = this.snapshot();
    if (!selected || !forest.nodes.has(selected.id) || this.canvas.readonly) return false;
    const plan = planBranchColor(data, forest, selected.id, color);
    const nodes = data.nodes.filter((node) => plan.nodes.has(node.id) && (node.color ?? null) !== plan.nodes.get(node.id))
      .map((node) => color === null ? withoutKeys(node, "color") : { ...node, color });
    const edges = data.edges.filter((edge) => plan.edges.has(edge.id) && (edge.color ?? null) !== plan.edges.get(edge.id));
    if (!nodes.length && !edges.length) return true;
    canvasTransaction(this.canvas, () => {
      if (nodes.length) this.canvas.importData({ nodes, edges: [] }, false);
      for (const edge of edges) {
        const next = { ...edge };
        if (color === null) delete next.color; else next.color = color;
        this.canvas.edges.get(edge.id)?.setData(next);
      }
    });
    this.syncSignature();
    this.refresh();
    return true;
  }

  /**
   * With nothing on the canvas, a panel says how to begin: a topic to grow
   * with Tab, a free card by double-clicking, or the guide. It leaves with
   * the first card, and never shows on a read-only canvas or on stage.
   */
  private syncEmpty() {
    const show = this.canvas.nodes.size === 0 && !this.canvas.readonly && !this.stage;
    if (!show) {
      if (this.emptyTimer) this.win.clearTimeout(this.emptyTimer);
      this.emptyTimer = 0;
      this.empty?.remove();
      this.empty = null;
      return;
    }
    if (this.empty) {
      // The schemes follow the map look, which can be turned off meanwhile.
      if (this.empty.dataset.schemes !== String(this.settings().canvasAppearance !== false)) {
        this.empty.remove();
        this.empty = this.buildEmpty();
      }
      if (this.empty.parentElement !== this.canvas.wrapperEl) this.canvas.wrapperEl.append(this.empty);
      return;
    }
    // A canvas is bound before its file is read, so it has no cards for a
    // moment; the panel comes only once the canvas has stayed empty.
    this.emptyTimer ||= this.win.setTimeout(() => {
      this.emptyTimer = 0;
      if (this.disposed || this.canvas.nodes.size !== 0 || this.canvas.readonly || this.stage) return;
      this.empty = this.buildEmpty();
      this.canvas.wrapperEl.append(this.empty);
      if (!this.status.textContent) this.status.textContent = t("Click New topic to start");
    }, EMPTY_PANEL_DELAY);
  }

  private buildEmpty(): HTMLElement {
    const doc = this.canvas.wrapperEl.ownerDocument;
    const panel = doc.createElement("div");
    panel.className = "nf-canvas-empty nf-canvas-ui";
    const title = doc.createElement("div");
    title.className = "nf-canvas-empty-title";
    title.textContent = t("Start a mind map");
    const text = doc.createElement("p");
    text.className = "nf-canvas-empty-text";
    // The key reads as a key, as it is typed here.
    t("Double-click the canvas for a free card, or start a topic and press Tab for children.").split("Tab").forEach((part, index) => {
      if (index) {
        const key = doc.createElement("kbd");
        key.className = "nf-canvas-empty-key";
        key.textContent = keyLabel("Tab");
        text.append(key);
      }
      if (part) {
        const words = doc.createElement("span");
        words.textContent = part;
        text.append(words);
      }
    });
    const actions = doc.createElement("div");
    actions.className = "nf-canvas-empty-actions";
    // The buttons alone keep their clicks from Canvas; a double-click on
    // the panel's empty parts still makes a free card, as the words say.
    const guard = (button: HTMLButtonElement, onClick: () => void) => {
      for (const event of ["pointerdown", "mousedown", "dblclick"]) button.addEventListener(event, (evt) => evt.stopPropagation());
      button.addEventListener("click", (evt) => {
        evt.stopPropagation();
        onClick();
      });
      return button;
    };
    const action = (label: string, primary: boolean, onClick: () => void) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = primary ? "nf-canvas-empty-action mod-cta" : "nf-canvas-empty-action";
      button.textContent = label;
      return guard(button, onClick);
    };
    actions.append(action(t("New topic"), true, () => this.run("newTopic")), action(t("Open the guide"), false, () => this.toggleHelpPanel(true)));
    panel.append(title, text, actions);
    // Or start a map in a designed scheme; without the map look it would not show.
    const schemes = this.settings().canvasAppearance !== false;
    panel.dataset.schemes = String(schemes);
    if (schemes) {
      const section = doc.createElement("div");
      section.className = "nf-canvas-empty-schemes";
      const label = doc.createElement("div");
      label.className = "nf-canvas-empty-schemes-label";
      label.textContent = t("Color schemes");
      const tiles = doc.createElement("div");
      tiles.className = "nf-canvas-style-tiles nf-canvas-empty-tiles";
      tiles.setAttribute("role", "group");
      tiles.setAttribute("aria-label", t("Color schemes"));
      for (const id of STARTER_PRESETS) {
        const preset = appearancePreset(id);
        if (!preset) continue;
        const tile = doc.createElement("button");
        tile.type = "button";
        tile.className = "nf-canvas-style-tile nf-canvas-empty-tile";
        tile.dataset.preset = id;
        // As on the Style panel: the name leads, and Obsidian's tooltip shows the description too.
        tile.setAttribute("aria-label", `${t(preset.name)} · ${t(preset.description)}`);
        const thumb = presetThumbnail(doc, preset, this.support);
        // The stylesheet sizes it; these keep it small without one.
        thumb.setAttribute("width", "96");
        thumb.setAttribute("height", "50");
        const name = doc.createElement("span");
        name.className = "nf-canvas-style-tile-name";
        name.textContent = t(preset.name);
        if (preset.font && preset.font !== "default") name.classList.add(`nf-font-sample-${preset.font}`);
        tile.append(thumb, paletteDots(doc, presetColors(preset, this.support).branchColors), name);
        tiles.append(guard(tile, () => this.startMap(id)));
      }
      section.append(label, tiles);
      panel.append(section);
    }
    return panel;
  }

  /* ---------------------------------------------------------------- */
  /* Branch lines, boundaries, and task progress                       */
  /* ---------------------------------------------------------------- */

  /** Draw a map connection in a line style; null leaves Canvas's own line. */
  private shapeEdge(edge: LiveEdge, spec: LineSpec | null) {
    const current = this.lineSpecs.get(edge) ?? null;
    if (current === spec || (current && spec && current.style === spec.style
      && current.widths[0] === spec.widths[0] && current.widths[1] === spec.widths[1])) return;
    if (spec) {
      if (!this.patchEdge(edge)) return;
      this.lineSpecs.set(edge, spec);
    } else {
      this.lineSpecs.delete(edge);
    }
    // Canvas builds a connection's path the first time it draws it, which
    // it does only near the view; until then there is nothing to redraw,
    // and its first drawing will already take the override.
    if (edge.path) edge.updatePath?.();
  }

  /**
   * Canvas redraws a connection whenever either card moves, through the
   * connection's updatePath. An override on this one connection lets Canvas
   * draw as usual, then redraws the path in the map's style.
   */
  private patchEdge(edge: LiveEdge): boolean {
    if (this.patchedEdges.has(edge)) return true;
    const native = edge.updatePath;
    if (typeof native !== "function" || Object.prototype.hasOwnProperty.call(edge, "updatePath")) return false;
    const draw = (target: LiveEdge) => this.drawLine(target);
    edge.updatePath = function (this: LiveEdge) {
      native.call(this);
      draw(this);
    };
    this.patchedEdges.add(edge);
    return true;
  }

  private unpatchEdge(edge: LiveEdge) {
    if (!this.patchedEdges.delete(edge)) return;
    this.lineSpecs.delete(edge);
    delete (edge as { updatePath?: unknown }).updatePath;
    if (!edge.path || !this.canvas.edges.has(edge.getData().id)) return;
    try {
      edge.updatePath?.();
    } catch (error) {
      console.error("Notion Flow: could not restore a connection", error);
    }
  }

  private drawLine(edge: LiveEdge) {
    const spec = this.lineSpecs.get(edge);
    const { from, to } = edge;
    const display = edge.path?.display;
    const interaction = edge.path?.interaction;
    if (!spec || this.disposed || !display || !interaction
      || typeof from?.node?.getBBox !== "function" || typeof to?.node?.getBBox !== "function") return;
    const fromSide = from.side ?? "right";
    const toSide = to.side ?? "left";
    const shape = linePath(spec.style, anchor(from.node.getBBox(), fromSide), fromSide,
      anchor(to.node.getBBox(), toSide), toSide, spec.widths);
    display.setAttribute("d", shape.d);
    interaction.setAttribute("d", shape.spine);
  }

  /**
   * Draw the boundaries of framed branches behind the connections, in the
   * canvas's own coordinates, so they pan and zoom with the cards.
   */
  private syncBoundaries(data: CanvasData, byId: Map<string, CanvasNodeData>, forest: Forest, hidden: Set<string>,
    colors: Map<string, string>, faded: (id: string) => boolean) {
    const container = this.canvas.edgeContainerEl;
    const doc = this.canvas.wrapperEl.ownerDocument;
    const appearance = this.settings().canvasAppearance;
    const framed = new Set(appearance && container && typeof doc.createElementNS === "function"
      ? [...forest.nodes.keys()].filter((id) => !hidden.has(id) && hasBoundary(byId.get(id)))
      : []);
    if (!framed.size) {
      this.boundaryLayer?.remove();
      this.boundaryLayer = null;
      this.boundaryRects.clear();
      this.boundarySource = null;
      return;
    }
    this.boundarySource = { data, forest, hidden };
    let layer = this.boundaryLayer;
    if (!layer) {
      layer = doc.createElementNS(SVG_NS, "g") as SVGGElement;
      layer.setAttribute("class", "nf-canvas-boundaries nf-canvas-ui");
      this.boundaryLayer = layer;
    }
    // Behind every connection: first in their layer.
    if (layer.parentNode !== container || container!.firstChild !== layer) container!.insertBefore(layer, container!.firstChild);
    for (const [id, rect] of this.boundaryRects) {
      if (framed.has(id)) continue;
      rect.remove();
      this.boundaryRects.delete(id);
    }
    for (const id of framed) {
      let rect = this.boundaryRects.get(id);
      if (!rect) {
        rect = doc.createElementNS(SVG_NS, "rect") as SVGRectElement;
        this.boundaryRects.set(id, rect);
        layer.append(rect);
      }
      const cls = `nf-canvas-boundary${faded(id) ? " is-faded" : ""}`;
      if (rect.getAttribute("class") !== cls) rect.setAttribute("class", cls);
      const color = colors.get(id) ?? "var(--interactive-accent)";
      if (rect.style.getPropertyValue("--nf-boundary") !== color) rect.style.setProperty("--nf-boundary", color);
    }
    this.syncBoundaryGeometry();
  }

  /** Fit the boundaries and braces to where the cards are now, as they glide or are dragged. */
  private syncBoundaryGeometry() {
    this.syncBraceGeometry();
    const source = this.boundarySource;
    if (!source || !this.boundaryRects.size) return;
    const boxes = boundaryBoxes(source.data, source.forest, source.hidden, (id) => this.canvas.nodes.get(id)?.getData());
    for (const [id, rect] of this.boundaryRects) {
      const box = boxes.get(id);
      if (!box) continue;
      const attrs: [string, number][] = [
        ["x", box.minX], ["y", box.minY], ["width", box.maxX - box.minX], ["height", box.maxY - box.minY],
      ];
      for (const [name, value] of attrs) {
        const text = String(Math.round(value * 10) / 10);
        if (rect.getAttribute(name) !== text) rect.setAttribute(name, text);
      }
      if (rect.getAttribute("rx") !== "18") rect.setAttribute("rx", "18");
    }
  }

  /**
   * Draw the braces of summaries in the connections' SVG layer, above the
   * boundaries and below the lines, so they pan and zoom with the cards.
   */
  private syncBraces(data: CanvasData, forest: Forest, hidden: Set<string>, summaries: Map<string, Summary>,
    colors: Map<string, string>, faded: (id: string) => boolean) {
    const container = this.canvas.edgeContainerEl;
    const doc = this.canvas.wrapperEl.ownerDocument;
    const shown = this.settings().canvasAppearance && container && typeof doc.createElementNS === "function"
      ? [...summaries.values()].filter((summary) => !hidden.has(summary.id)) : [];
    if (!shown.length) {
      this.braceLayer?.remove();
      this.braceLayer = null;
      this.braces.clear();
      this.braceSource = null;
      return;
    }
    this.braceSource = { data, forest, hidden };
    let layer = this.braceLayer;
    if (!layer) {
      layer = doc.createElementNS(SVG_NS, "g") as SVGGElement;
      layer.setAttribute("class", "nf-canvas-braces nf-canvas-ui");
      this.braceLayer = layer;
    }
    // Right after the boundaries, when there are any; else first.
    const boundaries = this.boundaryLayer && this.boundaryLayer.parentNode === container ? this.boundaryLayer : null;
    const placed = layer.parentNode === container && (boundaries ? layer.previousSibling === boundaries : container!.firstChild === layer);
    if (!placed) container!.insertBefore(layer, boundaries ? boundaries.nextSibling : container!.firstChild);
    const wanted = new Set(shown.map((summary) => summary.id));
    for (const [id, parts] of this.braces) {
      if (wanted.has(id)) continue;
      parts.brace.remove();
      parts.tail.remove();
      this.braces.delete(id);
    }
    for (const summary of shown) {
      let parts = this.braces.get(summary.id);
      if (!parts) {
        parts = {
          brace: doc.createElementNS(SVG_NS, "path") as SVGPathElement,
          tail: doc.createElementNS(SVG_NS, "path") as SVGPathElement,
        };
        this.braces.set(summary.id, parts);
        layer.append(parts.tail, parts.brace);
      }
      const dim = faded(summary.id) || faded(summary.parent);
      const cls = `nf-canvas-brace${dim ? " is-faded" : ""}`;
      if (parts.brace.getAttribute("class") !== cls) parts.brace.setAttribute("class", cls);
      const tailCls = `nf-canvas-brace-tail${dim ? " is-faded" : ""}`;
      if (parts.tail.getAttribute("class") !== tailCls) parts.tail.setAttribute("class", tailCls);
      const color = colors.get(summary.id) ?? "var(--interactive-accent)";
      for (const el of [parts.brace, parts.tail]) {
        if (el.style.getPropertyValue("--nf-brace") !== color) el.style.setProperty("--nf-brace", color);
      }
    }
    this.syncBraceGeometry();
  }

  /** Redraw the braces where the cards are now, as they glide or are dragged. */
  private syncBraceGeometry() {
    const source = this.braceSource;
    if (!source || !this.braces.size) return;
    const braces = summaryBraces(source.data, source.forest, source.hidden, (id) => this.canvas.nodes.get(id)?.getData());
    for (const [id, parts] of this.braces) {
      const brace = braces.get(id);
      if (!brace) continue;
      const d = bracePath(brace);
      if (parts.brace.getAttribute("d") !== d) parts.brace.setAttribute("d", d);
      const round = (value: number) => Math.round(value * 10) / 10;
      const tail = `M${round(brace.tip.x)} ${round(brace.tip.y)} L${round(brace.target.x)} ${round(brace.target.y)}`;
      if (parts.tail.getAttribute("d") !== tail) parts.tail.setAttribute("d", tail);
    }
  }

  /** Tasks in the note a file card shows, from Obsidian's index. */
  private fileTasks(node: CanvasNodeData | undefined): TaskCount | null {
    const app = this.app;
    if (!app || node?.type !== "file" || typeof node.file !== "string" || !/\.md$/i.test(node.file)) return null;
    const file = app.vault.getAbstractFileByPath(node.file);
    if (!(file instanceof TFile)) return null;
    const count = { done: 0, total: 0 };
    for (const item of app.metadataCache.getFileCache(file)?.listItems ?? []) {
      if (item.task === undefined || item.task === "-") continue;
      count.total++;
      if (item.task === "x" || item.task === "X") count.done++;
    }
    return count;
  }

  /** A card's task progress: a ring that fills, and "done/total". */
  private updateProgress(node: LiveNode, count: TaskCount | undefined) {
    let badge = this.progress.get(node.id);
    if (!count) {
      badge?.el.remove();
      this.progress.delete(node.id);
      return;
    }
    const doc = this.canvas.wrapperEl.ownerDocument;
    if (!badge) {
      const el = doc.createElement("div");
      el.className = "nf-canvas-progress nf-canvas-ui";
      let bar: SVGElement | null = null;
      if (typeof doc.createElementNS === "function") {
        const svg = doc.createElementNS(SVG_NS, "svg");
        svg.setAttribute("viewBox", "0 0 16 16");
        svg.setAttribute("aria-hidden", "true");
        const track = doc.createElementNS(SVG_NS, "circle");
        bar = doc.createElementNS(SVG_NS, "circle");
        for (const circle of [track, bar]) {
          circle.setAttribute("cx", "8");
          circle.setAttribute("cy", "8");
          circle.setAttribute("r", "6");
          circle.setAttribute("pathLength", "100");
        }
        track.setAttribute("class", "nf-canvas-progress-track");
        bar.setAttribute("class", "nf-canvas-progress-bar");
        svg.append(track, bar);
        el.append(svg);
      }
      const label = doc.createElement("span");
      el.append(label);
      badge = { el, bar, label };
      this.progress.set(node.id, badge);
    }
    if (badge.el.parentElement !== node.nodeEl) node.nodeEl.append(badge.el);
    const text = `${count.done}/${count.total}`;
    if (badge.label.textContent !== text) badge.label.textContent = text;
    const state = count.done === count.total ? "done" : count.done ? "partial" : "open";
    if (badge.el.dataset.state !== state) badge.el.dataset.state = state;
    const dash = `${Math.round(count.done / count.total * 100)} 100`;
    if (badge.bar && badge.bar.getAttribute("stroke-dasharray") !== dash) badge.bar.setAttribute("stroke-dasharray", dash);
    const label = t("{done} of {total} tasks done").replace("{done}", String(count.done)).replace("{total}", String(count.total));
    if (badge.el.getAttribute("aria-label") !== label) badge.el.setAttribute("aria-label", label);
  }

  /** Keep the minimap in step with the setting and the cards. */
  private syncMinimap(data: CanvasData, forest: Forest, hidden: Set<string>, branch: Set<string> | null, signature: string,
    auto: Map<string, string>) {
    const wanted = !!this.settings().canvasMinimap && minimapSupported(this.canvas);
    if (!wanted) {
      this.minimap?.destroy();
      this.minimap = null;
      return;
    }
    this.minimap ??= new Minimap(this.canvas as unknown as ConstructorParameters<typeof Minimap>[0], t("Minimap"));
    const items: MinimapItem[] = [];
    for (const node of data.nodes) {
      if (hidden.has(node.id)) continue;
      items.push({
        id: node.id, x: node.x, y: node.y, width: node.width, height: node.height,
        // A map's automatic palette shows in the overview as well.
        color: typeof node.color === "string" && node.color ? node.color : auto.get(node.id),
        kind: node.type === "group" ? "group" : forest.nodes.get(node.id)?.parent === null ? "root" : "card",
        muted: !!branch && !branch.has(node.id),
      });
    }
    this.minimap.setItems(items, `${signature}\n${[...hidden].join()}\n${[...this.focusIds].join()}\n${items.map((item) => item.color ?? "").join()}`);
  }

  /* ---------------------------------------------------------------- */
  /* Finding cards                                                     */
  /* ---------------------------------------------------------------- */

  private openSearch() {
    if (!this.app) return;
    const { data, forest, hidden } = this.snapshot();
    // A card's context names its map by the central topic's first line, or its group.
    const contexts = this.cardContexts(data, forest);
    const hits: CardHit[] = [];
    for (const node of data.nodes) {
      const label = cardLabel(node);
      if (!label) continue;
      let context = contexts.get(node.id) ?? "";
      if (hidden.has(node.id)) context = context ? `${context} · ${t("in a folded branch")}` : t("in a folded branch");
      hits.push({ id: node.id, label: label.length > 160 ? `${label.slice(0, 160)}…` : label, context, hidden: hidden.has(node.id) });
    }
    new CardSearchModal(this.app, hits, (hit) => this.jumpTo(hit.id), t("Find a card…")).open();
  }

  /** Open the find bar, or bring the keyboard back to it with its words offered. */
  private openFind() {
    if (this.find) {
      this.find.bar.focus(true);
      return;
    }
    this.closeMarkerPanel();
    this.closeColorPanel();
    const bar = new FindBar(this.canvas.wrapperEl.ownerDocument, {
      search: (query) => this.findQuery(query),
      step: (delta) => this.findStep(delta),
      close: () => {
        this.closeFind();
        this.canvas.wrapperEl.focus();
      },
    });
    this.find = { bar, query: "", matches: [], found: new Set(), current: null };
    this.canvas.wrapperEl.append(bar.el);
    this.refresh();
    bar.focus();
  }

  /**
   * The words changed: the first match in view is selected and brought on
   * screen, without unfolding, zooming or taking the keyboard from the box.
   * With every match folded away none is current, so Enter shows the first.
   */
  private findQuery(query: string) {
    const find = this.find;
    if (!find || find.query === query) return;
    find.query = query;
    const { data, hidden } = this.snapshot();
    const matches = this.findMatches(data);
    find.current = matches.find((id) => !hidden.has(id)) ?? null;
    const node = find.current ? this.canvas.nodes.get(find.current) : undefined;
    if (node) {
      this.canvas.selectOnly(node);
      this.reveal([node.id]);
      // Selecting must not take the keyboard from the box.
      find.bar.focus();
    }
    this.refresh();
  }

  /** Enter and Shift+Enter walk the matches, unfolding and framing each in turn. */
  private findStep(delta: 1 | -1) {
    const find = this.find;
    if (!find) return;
    const matches = this.findMatches(this.snapshot().data);
    if (!matches.length) return;
    const at = find.current ? matches.indexOf(find.current) : -1;
    const next = at < 0 ? (delta > 0 ? 0 : matches.length - 1) : (at + delta + matches.length) % matches.length;
    find.current = matches[next];
    this.jumpTo(matches[next], false);
    find.bar.focus();
  }

  /** The cards the find bar's words match, folded ones included, in reading order; a card's note counts as its words. */
  private findMatches(data: CanvasData): string[] {
    const query = this.find?.query ?? "";
    if (!query.trim()) return [];
    return findCards(data.nodes, query, (node) => {
      const words = node.type === "text" ? this.cardWords.get(String(node.text ?? "")) : cardLabel(node);
      const note = noteOf(node);
      return note ? `${words}\n${this.noteWords.get(note)}` : words;
    });
  }

  private closeFind() {
    if (!this.find) return;
    this.dropFind();
    if (!this.disposed) this.refresh();
  }

  /** Take the find bar away and unlight its matches, without a refresh. */
  private dropFind() {
    const find = this.find;
    if (!find) return;
    find.bar.destroy();
    this.find = null;
    for (const id of find.found) this.canvas.nodes.get(id)?.nodeEl.classList.remove("nf-canvas-found");
    this.canvas.wrapperEl.classList.remove("nf-canvas-finding");
  }

  /**
   * Show a card: unfold what hides it, leave a focus it is outside, select
   * and frame it. The keyboard goes to the canvas unless `focus` says to
   * leave it where it is, as when the find bar walks its matches.
   */
  jumpTo(id: string, focus = true): boolean {
    if (!this.active() || !this.canvas.nodes.has(id)) return false;
    this.motion.finish();
    const { data, forest, hidden } = this.snapshot();
    if (hidden.has(id) && !this.canvas.readonly) {
      const byId = new Map(data.nodes.map((node) => [node.id, node]));
      const folded: CanvasNodeData[] = [];
      for (let ancestor = forest.nodes.get(id)?.parent ?? null; ancestor; ancestor = forest.nodes.get(ancestor)?.parent ?? null) {
        const node = byId.get(ancestor);
        if (node && isCollapsed(node)) folded.push(node);
      }
      if (folded.length) {
        canvasTransaction(this.canvas, () => {
          for (const node of folded) this.updateNode(withoutKeys(node, COLLAPSED_KEY));
          this.tidy([forest.nodes.get(id)!.root]);
        });
        this.syncSignature();
      }
    }
    if (this.focusBranch(this.canvas.getData())?.has(id) === false) this.focusIds.clear();
    const node = this.canvas.nodes.get(id)!;
    this.canvas.selectOnly(node);
    this.refresh();
    // Frame where the card lands, before it glides there.
    const box = boxOf([node.getData()], 240);
    if (box) this.canvas.zoomToBbox?.(box);
    this.playMoves();
    this.flash(node);
    // The overview shows where the card lies, even when it would be hidden.
    this.minimap?.peek();
    if (focus) this.canvas.wrapperEl.focus();
    return true;
  }

  /** Briefly ring a card so the eye finds it after a jump. */
  private flash(node: LiveNode) {
    const el = node.nodeEl;
    el.classList.remove("nf-canvas-found");
    // Restart the animation on a card flashed moments ago.
    void el.offsetWidth;
    el.classList.add("nf-canvas-found");
    if (this.flashTimer) this.win.clearTimeout(this.flashTimer);
    this.flashTimer = this.win.setTimeout(() => {
      this.flashTimer = 0;
      // A match of the find bar stays lit after its ring.
      if (!this.find?.found.has(node.id)) el.classList.remove("nf-canvas-found");
    }, 1600);
  }

  /* ---------------------------------------------------------------- */
  /* Notes and maps                                                    */
  /* ---------------------------------------------------------------- */

  private pickNote() {
    if (!this.app) return;
    new NotePickerModal(this.app, (file) => void this.insertNote(file), t("Choose a note to map…")).open();
  }

  /** Grow a new map from a note's headings and lists, linked back to the note. */
  async insertNote(file: TFile): Promise<boolean> {
    const app = this.app;
    if (!app || !this.active() || this.canvas.readonly) return false;
    const markdown = await app.vault.cachedRead(file);
    if (!this.active()) return false;
    const link = app.metadataCache.fileToLinktext(file, this.view.file?.path ?? "", true);
    const outline = noteOutline(markdown, link);
    if (!outline) {
      new Notice(t("This note has no headings or lists to map."));
      return false;
    }
    this.motion.finish();
    const before = this.canvas.getData();
    const rootId = this.newId();
    const viewport = this.canvas.getViewportBBox?.();
    const content = boxOf(before.nodes.filter((node) => node.type !== "group"));
    // Start at the left of the view, or right of everything when no view is known.
    const origin = viewport && [viewport.minX, viewport.minY, viewport.maxX, viewport.maxY].every(Number.isFinite)
      ? { x: viewport.minX + (viewport.maxX - viewport.minX) * 0.15, y: (viewport.minY + viewport.maxY) / 2 - TOPIC.height / 2 }
      : content ? { x: content.maxX + 240, y: content.minY } : { x: 0, y: 0 };
    let created: string[] = [];
    canvasTransaction(this.canvas, () => {
      this.canvas.importData({ nodes: [{
        id: rootId, type: "text", text: outline.root, x: Math.round(origin.x), y: Math.round(origin.y),
        ...TOPIC, [LAYOUT_KEY]: "right",
      }], edges: [] }, false);
      this.reserved.clear();
      const after = this.snapshot();
      created = this.insertOutline(rootId, outline.items, after.forest, after.data);
      // A map that lands on other cards moves below everything instead.
      const members = [rootId, ...created].map((id) => this.canvas.nodes.get(id)?.getData())
        .filter((node): node is CanvasNodeData => !!node);
      const box = boxOf(members, 24);
      const overlaps = box && content && before.nodes.some((node) => node.x < box.maxX && node.x + node.width > box.minX
        && node.y < box.maxY && node.y + node.height > box.minY);
      if (box && content && overlaps) {
        const dx = content.minX - box.minX;
        const dy = content.maxY + 160 - box.minY;
        for (const node of members) this.canvas.nodes.get(node.id)?.moveTo({ x: node.x + dx, y: node.y + dy });
      }
    });
    // Cards are born in place; there is nothing to glide from.
    this.moves.clear();
    this.afterInsert(rootId, created);
    if (this.settings().canvasAutoFit) this.queueFit(rootId);
    const root = this.canvas.nodes.get(rootId);
    if (root) this.canvas.selectOnly(root);
    this.zoom(new Set([rootId, ...created]));
    this.refresh();
    new Notice(cardCount(t("Mapped 1 card from the note."), t("Mapped {count} cards from the note."), countOutline(outline.items) + 1));
    return true;
  }

  /** Write the selected branch to a new note beside the canvas and open it. */
  private async exportNote(): Promise<void> {
    const app = this.app;
    const selected = this.selected();
    if (!app || !selected) return;
    const { data, forest } = this.snapshot();
    const { markdown, count } = branchOutline(data, forest, selected.id);
    const folder = this.view.file?.path.includes("/") ? this.view.file.path.replace(/\/[^/]*$/, "") : "";
    const name = noteFileName(cardTitle(selected.getData(), 80), t("Mind map"));
    let path = "";
    for (let index = 0; index < 1000; index++) {
      path = `${folder ? `${folder}/` : ""}${name}${index ? ` ${index}` : ""}.md`;
      if (!app.vault.getAbstractFileByPath(path)) break;
    }
    try {
      const file = await app.vault.create(path, `${markdown}\n`);
      await app.workspace.getLeaf("tab").openFile(file);
      new Notice(cardCount(t("Exported 1 card to {path}."), t("Exported {count} cards to {path}."), count).replace("{path}", file.path));
    } catch (error) {
      console.error("Notion Flow: could not export the branch", error);
      new Notice(t("Could not create the note."));
    }
  }

  refresh() {
    // A presentation ends when its canvas is no longer the one in front.
    const front = (this.app?.workspace as { activeLeaf?: { view?: unknown } | null } | undefined)?.activeLeaf?.view;
    if (this.stage && (this.path !== this.view.file?.path || (front !== undefined && front !== this.view))) {
      this.stopPresenting();
    }
    if (this.path !== this.view.file?.path) {
      if (this.settleTimer) this.win.clearTimeout(this.settleTimer);
      this.settleTimer = 0;
      this.path = this.view.file?.path;
      this.focusIds.clear();
      this.lastSignature = null;
      this.lastKey = null;
      this.pending = { fit: new Set() };
      for (const node of this.editorSurfaces.keys()) this.updateEditor(node, false);
      this.releaseEditKeys();
      this.editing.clear();
      this.editText.clear();
      this.editHistory.clear();
      this.created.clear();
      this.createdFrom.clear();
      this.createdStep = undefined;
      this.parents.clear();
      this.taskCounts.clear();
      this.cardWords.clear();
      this.noteWords.clear();
      this.plan = null;
      this.motion.finish();
      this.finishFolding(false);
      this.dropTools();
    }
    for (const node of this.editorSurfaces.keys()) {
      if (this.canvas.nodes.get(node.id) !== node) this.updateEditor(node, false);
    }
    for (const id of [...this.focusIds]) if (!this.canvas.nodes.has(id)) this.focusIds.delete(id);
    const path = this.view.file?.path;
    if (path && !this.healed.has(path) && !this.healTimer) {
      // Let Canvas render the cards' words before checking that they fit.
      this.healTimer = this.win.setTimeout(() => this.healOverflow(), 700);
    }
    this.lastRefreshAt = Date.now();
    this.cached = this.snapshot();
    try {
      // The same state again is left as it was drawn.
      const key = this.renderKey(this.cached.data);
      if (key !== null && key === this.lastKey) return;
      this.lastKey = null;
      this.render(this.cached);
      this.lastKey = key;
    } finally {
      this.cached = null;
    }
  }

  /**
   * Everything render() draws from, as one string: an unchanged key means
   * the last render still stands. Null while a tool is in use, cards are
   * gliding or a follow-up is pending, when every refresh draws.
   */
  private renderKey(data: CanvasData): string | null {
    const pending = this.pending;
    if (this.stage || this.panel || this.layoutPanel || this.markerPanel || this.colorPanel || this.helpPanel || this.connecting
      || this.motion.active || pending.fit.size || pending.drop || pending.deleted || pending.removeEmpty?.size) return null;
    const selection: string[] = [];
    for (const item of this.canvas.selection) selection.push("id" in item ? (item as LiveNode).id : item.getData().id);
    const editing: string[] = [];
    for (const [id, node] of this.canvas.nodes) {
      if (!isEditingNode(node)) continue;
      // A card that left and re-entered editing between two frames has a new editor to bind.
      const cm = node.child?.editMode?.cm as object | undefined;
      let editor = cm ? this.editorIds.get(cm) : 0;
      if (cm && !editor) this.editorIds.set(cm, editor = this.nextEditorId++);
      editing.push(`${id}:${editor ?? 0}`);
    }
    const menuEl = this.canvas.menu?.menuEl;
    return [
      canvasStateSignature(data),
      selection.sort().join(),
      [...this.focusIds].sort().join(),
      editing.sort().join(),
      [...this.folding].sort().join(),
      JSON.stringify(this.settings()),
      JSON.stringify(this.stylePreview),
      this.canvas.readonly ? "r" : "",
      this.gesture || this.canvas.isDragging ? "d" : "",
      // Canvas rebuilding its floating menu drops our buttons from it.
      menuEl ? (this.menuGroup ? (this.menuGroup.parentElement === menuEl ? "m" : "x") : "-") : "",
      String(this.noteVersion),
      this.find ? JSON.stringify([this.find.query, this.find.current]) : "",
    ].join("|");
  }

  /**
   * The looks a plan is drawn from, beyond the geometry in the signature:
   * every card's and connection's color, the summaries, each map's own
   * choices, and the defaults from the settings.
   */
  private lookKey(shown: CanvasData, forest: Forest): string {
    const settings = this.settings();
    const roots = new Set(forest.roots);
    const parts: string[] = [];
    for (const node of shown.nodes) {
      let part = `n${node.id}|${String(node.color ?? "")}|${node[SUMMARY_KEY] ? JSON.stringify(node[SUMMARY_KEY]) : ""}`;
      if (roots.has(node.id)) {
        // A map's own colors are an object; its text, not "[object Object]", tells one from the next.
        part += `|${ROOT_LOOK_KEYS.map((key) => {
          const value = node[key];
          return typeof value === "object" && value ? JSON.stringify(value) : String(value ?? "");
        }).join("|")}`;
      }
      parts.push(part);
    }
    for (const edge of shown.edges) parts.push(`e${edge.id}|${String(edge.color ?? "")}`);
    // Canvas keeps its nodes in z-order, which changes with every selection.
    parts.sort();
    parts.push([settings.canvasMapStyle, settings.canvasLineStyle, settings.canvasFont, settings.canvasShape,
      settings.canvasLineWeight, settings.canvasTextScale, settings.canvasFallbackPalette].map((value) => String(value ?? "")).join("|"));
    return parts.join("\n");
  }

  /**
   * The part of a render that follows from structure and looks alone: each
   * map's style, its summaries, the palette colors, topic numbers and
   * boundary colors. Selection, editing, focus and words change far more
   * often than these, so the last plan is kept while its inputs stand.
   */
  private planRender(shown: CanvasData, forest: Forest, signature: string): RenderPlan {
    const key = `${signature}\n${this.lookKey(shown, forest)}`;
    if (this.plan?.key === key) return this.plan;
    const byId = new Map(shown.nodes.map((node) => [node.id, node]));
    // Each map's look, and for vivid maps a palette color per main branch
    // for cards and lines that have none — shown, never written.
    const themes = new Map<string, CanvasMapStyle>();
    const lines = new Map<string, LineStyle>();
    const shapes = new Map<string, CanvasShape>();
    const weights = new Map<string, number>();
    const scales = new Map<string, number>();
    const fonts = new Map<string, CanvasFont>();
    for (const rootId of forest.roots) {
      const theme = this.themeOf(byId.get(rootId));
      themes.set(rootId, theme);
      lines.set(rootId, lineStyleFor(this.lineChoiceOf(byId.get(rootId)), mapLayout(byId.get(rootId)) ?? "right"));
      shapes.set(rootId, this.shapeOf(byId.get(rootId)));
      weights.set(rootId, LINE_WEIGHT_SCALE[this.weightOf(byId.get(rootId))]);
      scales.set(rootId, TEXT_SCALE_FACTOR[this.textScaleOf(byId.get(rootId))]);
      fonts.set(rootId, this.fontOf(byId.get(rootId)));
    }
    // Summaries hang under map cards without being branches; each takes
    // the look, color and words of the run it sums up.
    const summaries = summaryIndex(shown, forest);
    const summaryOf = new Map<string, Summary>();
    for (const list of summaries.values()) for (const summary of list) summaryOf.set(summary.id, summary);
    const colors = planAutoColors(shown, forest, new Set([...themes].filter(([, theme]) => theme === "vivid").map(([id]) => id)),
      this.support, this.fallbackPreset());
    const auto = colors.nodes;
    const boundaryColors = new Map<string, string>();
    for (const [id, info] of forest.nodes) {
      const color = byId.get(id)?.color;
      const own = safeCanvasColor(color);
      const rootColor = byId.get(info.root)?.color;
      boundaryColors.set(id, own ?? auto.get(id) ?? safeCanvasColor(rootColor) ?? "var(--interactive-accent)");
    }
    for (const summary of summaryOf.values()) {
      boundaryColors.set(summary.id, safeCanvasColor(byId.get(summary.id)?.color) ?? boundaryColors.get(summary.from) ?? "var(--interactive-accent)");
    }
    const numbers = topicNumbers(shown, forest);
    return this.plan = { key, themes, lines, shapes, weights, scales, fonts, summaries, summaryOf, colors, numbers, boundaryColors };
  }

  /**
   * Enable, press and name the toolbar's buttons for what is selected now.
   * While a card is typed in, render() lets this pass see it as selected.
   */
  private syncToolbar(settings: CanvasSettings) {
    const folded = this.foldedSelection();
    for (const [key, button] of this.buttons) {
      const action = this.toolbarAction(key);
      if (action === "more") {
        button.disabled = !this.selected() && !this.canRun("fit") && !this.canRun("insertNote") && !this.canRun("numbering")
          && !this.canRun("search");
      }
      else button.disabled = !this.canRun(action === "layout" ? "right" : action === "style" ? "presets" : action);
      const pressed = key === "style" ? !!this.panel : key === "focus" ? this.focusIds.size > 0 : key === "present" ? !!this.stage
        : key === "connect" ? !!this.connecting : key === "markers" ? !!this.markerPanel : key === "help" ? !!this.helpPanel
          : key === "layout" ? !!this.layoutPanel : key === "fold" ? folded : key === "search" ? !!this.find
            : key === "note" ? !!this.note : null;
      if (pressed !== null) button.setAttribute("aria-pressed", String(pressed));
      const shortcut = settings.canvasKeyboard
        ? ({ child: "Tab", sibling: "Enter / Alt+Enter", fold: "Mod+/", find: "Mod+F", search: "Mod+Shift+F", note: "F4", link: "Mod+K" } as Partial<Record<string, string>>)[action]
        : undefined;
      button.setAttribute("aria-keyshortcuts", shortcut ?? "");
      // Buttons that change with the selection say what they will do now.
      const face: [string, string] | null = key === "child" ? (action === "newTopic" ? ["New topic", "square-plus"] : ["Add child", "corner-down-right"])
        : key === "focus" ? (action === "reset" ? ["Show all", "maximize"] : ["Focus branch", "focus"])
          : key === "fold" ? (folded ? ["Unfold branch", "chevrons-up-down"] : ["Fold branch", "chevrons-down-up"])
            : key === "connect" ? (this.connecting ? ["Cancel connecting", "spline"] : ["Connect", "spline"]) : null;
      this.setButtonFace(key, face ? t(face[0]) : this.names.get(key) ?? "", face ? face[1] : null, shortcut);
    }
  }

  private render({ data, forest, hidden }: Snapshot) {
    const settings = this.settings();
    const appearance = settings.canvasAppearance;
    toggle(this.canvas.wrapperEl, "nf-canvas-polished", appearance);
    toggle(this.canvas.wrapperEl, "nf-canvas-compact", this.sizeMode() === "compact");
    // A look previewed from the style panel is drawn, never saved.
    const shown = this.previewed(data);
    const byId = new Map(shown.nodes.map((node) => [node.id, node]));
    const signature = canvasSignature(data);
    // What follows from structure and looks is planned once per change of
    // either; the rest of a render applies it to whatever else changed.
    const { themes, lines, shapes, weights, scales, fonts, summaryOf, colors, numbers, boundaryColors }
      = this.planRender(shown, forest, signature);
    const background = settings.canvasBackground;
    toggle(this.canvas.wrapperEl, "nf-canvas-bg-plain", background === "plain");
    toggle(this.canvas.wrapperEl, "nf-canvas-bg-faint", background === "faint");
    const auto = colors.nodes;
    const themeClasses = MAP_STYLES.map((theme) => `nf-theme-${theme}`);
    const fontClasses = CANVAS_FONTS.map((font) => `nf-font-${font}`);
    const shapeClasses = CANVAS_SHAPES.map((shape) => `nf-shape-${shape}`);
    const setVar = (style: CSSStyleDeclaration, name: string, value: string | null) => {
      if (value && style.getPropertyValue(name) !== value) style.setProperty(name, value);
      else if (!value && style.getPropertyValue(name)) style.removeProperty(name);
    };
    const paint = (el: Element | undefined, theme: CanvasMapStyle | null, color: string | null, root?: string) => {
      if (!el) return;
      for (const cls of themeClasses) toggle(el, cls, cls === `nf-theme-${theme}`);
      toggle(el, "nf-canvas-auto-color", !!color);
      const style = (el as HTMLElement).style;
      if (!style) return;
      setVar(style, "--nf-auto", color);
      // A map's line weight and text size, as multipliers the CSS applies.
      const weight = root ? weights.get(root) ?? 1 : 1;
      const scale = root ? scales.get(root) ?? 1 : 1;
      setVar(style, "--nf-line-scale", weight !== 1 ? String(weight) : null);
      setVar(style, "--nf-map-scale", scale !== 1 ? String(scale) : null);
    };

    // Folded cards are hidden, so they must not stay selected either:
    // Canvas would otherwise move or delete them unseen.
    for (const item of [...this.canvas.selection]) {
      if ("id" in item && hidden.has((item as LiveNode).id)) this.canvas.deselect?.(item);
    }

    const selected = this.selected();
    const branch = this.focusBranch(data);
    // On stage, the cards of the current stop stay in the light instead.
    const spotlight = this.stage?.spotlight ?? null;
    // While the find bar has words, its matches are lit and the rest dimmed.
    const find = this.find;
    const matches = find ? this.findMatches(data) : [];
    const found = new Set(matches);
    if (find) {
      find.matches = matches;
      find.found = found;
      if (find.current !== null && !found.has(find.current)) find.current = null;
    }
    toggle(this.canvas.wrapperEl, "nf-canvas-finding", !!find);
    const dimmed = !!find && found.size > 0;
    const muted = (id: string) => spotlight ? false : (!!branch && !branch.has(id)) || (dimmed && !found.has(id));
    const offstage = (id: string) => !!spotlight && !spotlight.has(id);
    // Each card's own tasks: a note's from Obsidian's index, a text card's counted once per text.
    const ownTasks = (id: string): TaskCount | null => {
      const node = byId.get(id);
      return node?.type === "text" ? this.taskCounts.get(String(node.text ?? "")) : this.fileTasks(node);
    };
    const progress = appearance && settings.canvasTaskProgress !== false
      ? taskProgress(data, forest, ownTasks) : new Map<string, TaskCount>();
    // The way from the selected card back to its map's centre.
    const trail = new Set<string>();
    for (let info = selected ? forest.nodes.get(selected.id) : undefined; info?.edge;
      info = info.parent ? forest.nodes.get(info.parent) : undefined) trail.add(info.edge);
    // What lies behind a card inside boundaries: each boundary tints the
    // canvas a little (as its fill does), so words that mask the lines
    // behind them wear the same tint instead of a plain patch.
    const under = (id: string): string | null => {
      if (!appearance) return null;
      let tint: string | null = null;
      const chain: string[] = [];
      for (let at = forest.nodes.get(id); at; at = at.parent ? forest.nodes.get(at.parent) : undefined) chain.push(at.id);
      for (const framed of chain.reverse()) {
        if (!hasBoundary(byId.get(framed))) continue;
        tint = `color-mix(in srgb, ${boundaryColors.get(framed)} ${BOUNDARY_TINT}%, ${tint ?? "var(--canvas-background, var(--background-primary))"})`;
      }
      return tint;
    };
    const editingNow = new Set<string>();
    this.filePaths = new Set(data.nodes.flatMap((node) =>
      node.type === "file" && typeof node.file === "string" && /\.md$/i.test(node.file) ? [node.file] : []));
    for (const [id, node] of this.canvas.nodes) {
      this.decorated.set(node.nodeEl, id);
      const info = forest.nodes.get(id);
      const summary = summaryOf.get(id);
      // A summary belongs to its parent's map and reads as a deep topic.
      const root = info?.root ?? (summary ? forest.nodes.get(summary.parent)?.root : undefined);
      const member = (!!info || !!summary) && appearance;
      const depth = info ? info.depth : 2;
      const el = node.nodeEl;
      toggle(el, "nf-canvas-muted", muted(id));
      // The ring of a card jumped to is its own; only the find bar lights cards for longer.
      if (find) toggle(el, "nf-canvas-found", found.has(id));
      toggle(el, "nf-canvas-offstage", offstage(id));
      toggle(el, "nf-canvas-root", this.focusIds.has(id));
      // A card folding away stays in view until it has glided into its holder.
      toggle(el, "nf-canvas-hidden", hidden.has(id) && !this.folding.has(id));
      toggle(el, "nf-canvas-map-node", member);
      toggle(el, "nf-canvas-map-root", info?.depth === 0 && appearance);
      toggle(el, "nf-canvas-map-branch", info?.depth === 1 && appearance);
      toggle(el, "nf-canvas-map-sub", !!info && info.depth >= 2 && appearance);
      toggle(el, "nf-canvas-summary", !!summary && appearance);
      const text = byId.get(id)?.type === "text" ? String(byId.get(id)?.text ?? "") : null;
      toggle(el, "nf-canvas-text", appearance && text !== null);
      toggle(el, "nf-canvas-map-text", member && text !== null);
      toggle(el, "nf-canvas-map-empty", member && text !== null && !text.trim());
      toggle(el, "nf-canvas-map-rich", member && text !== null && isRichText(text));
      if (member && text !== null) applyTopicTypography(el, depth, isRichText(text));
      else clearTopicTypography(el);
      // Which way the card hangs from its parent: words lean toward their line.
      const hang = info && appearance && info.parent !== null ? info.direction : null;
      if (hang) {
        if (el.dataset.nfHang !== hang) el.dataset.nfHang = hang;
      } else if (el.dataset.nfHang) delete el.dataset.nfHang;
      const font = member && root ? fonts.get(root) ?? "default" : "default";
      for (const cls of fontClasses) toggle(el, cls, font !== "default" && cls === `nf-font-${font}`);
      const shape = member && root ? shapes.get(root) ?? "rounded" : "rounded";
      for (const cls of shapeClasses) toggle(el, cls, shape !== "rounded" && cls === `nf-shape-${shape}`);
      toggle(el, "nf-canvas-folded", !!info?.children.length && isCollapsed(byId.get(id)));
      const tint = info && !hidden.has(id) ? under(id) : summary && !hidden.has(id) ? under(summary.parent) : null;
      if (tint) {
        if (el.style.getPropertyValue("--nf-under") !== tint) el.style.setProperty("--nf-under", tint);
      } else if (el.style.getPropertyValue("--nf-under")) el.style.removeProperty("--nf-under");
      // A summary without a color of its own borrows the first branch it covers.
      const own = byId.get(id)?.color;
      const borrowed = summary && !own ? auto.get(summary.from) ?? safeCanvasColor(byId.get(summary.from)?.color) ?? null : null;
      paint(el, member && root ? themes.get(root)! : null,
        member && !own ? auto.get(id) ?? borrowed : null, member ? root : undefined);
      this.updateControls(node, info, byId.get(id), forest, data,
        info ? mapLayout(byId.get(info.root)) : null, selected?.id ?? null);
      this.updateProgress(node, hidden.has(id) ? undefined : progress.get(id));
      this.updateBadges(node, hidden.has(id) ? [] : markersOf(byId.get(id)), hidden.has(id) ? null : numbers.get(id) ?? null);
      this.updateChips(node, hidden.has(id) ? undefined : byId.get(id), byId);
      const editing = isEditingNode(node);
      this.updateEditor(node, editing, info ? {
        widen: !!settings.canvasAutoFit && this.sizeMode() !== "preserve", anchor: editorAnchor(info),
        // Words with no box around them grow the way they are fitted: snugly.
        ...(editing && this.isBoxless(info, false) ? { room: HUG_SLACK } : {}),
      } : FREE_EDITOR);
      if (editing) {
        editingNow.add(id);
        if (!this.editText.has(id)) {
          this.editText.set(id, String(byId.get(id)?.text ?? ""));
          const history = this.canvas.history;
          this.editHistory.set(id, {
            index: history.current, step: history.data[history.current], next: history.data[history.current + 1],
          });
        }
      }
    }
    for (const id of [...this.controls.keys()]) {
      if (!this.canvas.nodes.has(id)) this.removeControls(id);
    }
    for (const [id, badge] of [...this.progress]) {
      if (this.canvas.nodes.has(id)) continue;
      badge.el.remove();
      this.progress.delete(id);
    }
    for (const [id, badge] of [...this.badges]) {
      if (this.canvas.nodes.has(id)) continue;
      badge.el.remove();
      this.badges.delete(id);
    }
    for (const [id, chips] of [...this.chips]) {
      if (this.canvas.nodes.has(id)) continue;
      chips.el.remove();
      this.chips.delete(id);
    }
    const live = new Set<LiveEdge>();
    for (const edge of this.canvas.edges.values()) {
      live.add(edge);
      const edgeData = edge.getData();
      if (edge.lineGroupEl) this.decorated.set(edge.lineGroupEl, edgeData.id);
      if (edge.lineEndGroupEl) this.decorated.set(edge.lineEndGroupEl, edgeData.id);
      if (edge.labelElement?.wrapperEl) this.decorated.set(edge.labelElement.wrapperEl, edgeData.id);
      const edgeMuted = muted(edgeData.fromNode) || muted(edgeData.toNode);
      const edgeOffstage = offstage(edgeData.fromNode) || offstage(edgeData.toNode);
      const concealed = (hidden.has(edgeData.fromNode) || hidden.has(edgeData.toNode)) && !this.folding.has(edgeData.id);
      const tree = forest.edges.has(edgeData.id) && appearance;
      const child = tree ? forest.nodes.get(edgeData.toNode)! : undefined;
      const trunk = child?.depth === 1;
      const edgeTheme = child ? themes.get(child.root)! : null;
      const edgeColor = tree ? colors.edges.get(edgeData.id) ?? null : null;
      const style = child ? lines.get(child.root)! : null;
      for (const el of [edge.lineGroupEl, edge.lineEndGroupEl, edge.labelElement?.wrapperEl]) {
        toggle(el, "nf-canvas-muted", edgeMuted);
        toggle(el, "nf-canvas-offstage", edgeOffstage);
        toggle(el, "nf-canvas-hidden", concealed);
        toggle(el, "nf-canvas-map-edge", tree);
        toggle(el, "nf-canvas-map-trunk", trunk);
        toggle(el, "nf-canvas-trail", tree && trail.has(edgeData.id));
        toggle(el, "nf-canvas-relation", appearance && isRelation(edgeData));
        for (const kind of ["organic", "curve", "elbow", "straight"] as const) toggle(el, `nf-line-${kind}`, style === kind);
        paint(el, edgeTheme, edgeColor, child?.root);
      }
      this.shapeEdge(edge, child && style ? {
        style,
        widths: style === "organic" ? organicWidths(child.depth - 1, LINE_WEIGHT[edgeTheme!] * (weights.get(child.root) ?? 1)) : [0, 0],
      } : null);
    }
    // Connections that are gone need no override; forget them.
    for (const edge of [...this.patchedEdges]) {
      if (live.has(edge)) continue;
      this.patchedEdges.delete(edge);
      this.lineSpecs.delete(edge);
    }
    this.syncBoundaries(data, byId, forest, hidden, boundaryColors, (id) => muted(id) || offstage(id));
    this.syncBraces(shown, forest, hidden, summaryOf, boundaryColors, (id) => muted(id) || offstage(id));

    // A map card just left editing: fit it to its new text. A new card
    // left without words is taken away again.
    for (const id of this.editing) {
      if (editingNow.has(id)) continue;
      const text = String(byId.get(id)?.text ?? "");
      const changed = this.editText.get(id) !== text;
      this.editText.delete(id);
      // A map card fits its new words; a free card takes the room they need.
      if (changed && (forest.nodes.has(id) ? settings.canvasAutoFit
        : settings.canvasComfortableEdit !== false && !summaryOf.has(id))) this.queueFit(id, this.editHistory.get(id));
      this.editHistory.delete(id);
      if (this.created.has(id) && byId.has(id) && !text.trim() && settings.canvasEditorKeys !== false && !this.canvas.readonly
        && typeof this.canvas.removeNode === "function") {
        (this.pending.removeEmpty ??= new Set()).add(id);
      }
      // Let Canvas render the preview before measuring it.
      if (changed || this.pending.fit.size || this.pending.drop || this.pending.deleted || this.pending.removeEmpty?.size) this.settleSoon(80);
    }
    this.editing = editingNow;

    // Cards gliding into place are not an edit; their landing is compared.
    if (!this.motion.active) {
      if (this.lastSignature === null) this.lastSignature = signature;
      else if (signature !== this.lastSignature && !this.gesture && !this.canvas.isDragging) {
        this.lastSignature = signature;
        // Undo and redo restore a recorded state; only fresh edits settle.
        const top = this.canvas.history.data[this.canvas.history.current];
        const recorded = !!top && canvasSignature(top) === signature;
        if (!recorded && settings.canvasAutoLayout && !this.canvas.readonly
          && (forest.roots.length || this.pending.deleted)) this.settleSoon();
      }
      this.syncMinimap(data, forest, hidden, branch, signature, auto);
    }
    this.minimap?.setSelection(new Set(this.selectedNodes().map((node) => node.id)));

    const selectedInfo = selected ? forest.nodes.get(selected.id) : undefined;
    // The open note follows its card, or closes with it, before the toolbar says whether it is open.
    this.syncNote(hidden);
    // While a card is typed in, the buttons are drawn as if it were selected
    // and done; only this pass sees it so, and nothing else can run meanwhile.
    const typing = this.toolbarTarget();
    const typingNode = typing && isEditingNode(typing) ? typing : null;
    this.toolbarEditing = typingNode;
    try {
      this.syncToolbar(settings);
    } finally {
      this.toolbarEditing = null;
    }
    this.syncMenu(selected);
    this.markerPanel?.sync();
    this.colorPanel?.sync();
    this.anchorPopover();
    if (this.layoutPanel) {
      if (this.canvas.readonly) this.closeLayoutPanel();
      else this.layoutPanel.sync();
    }
    if (this.panel) {
      if (this.canvas.readonly) this.closeStylePanel();
      else {
        // The panel follows the map of whatever card is selected.
        const shownRoot = selected ? forest.nodes.get(selected.id)?.root : undefined;
        if (shownRoot) this.panelRoot = shownRoot;
        this.panel.sync();
      }
    }
    // What is going on now goes in the pill, which every pane width shows;
    // the status keeps the passive summary: which map, its structure and size.
    const picked = this.markableNodes().length;
    const mode = this.connecting ? t("Click the card to connect to · Esc cancels")
      : branch ? `${t("Branch focus")}: ${branch.size}`
        : picked > 1 ? t("{n} cards selected · Fold, Focus and Connect act on all of them").replace("{n}", String(picked)) : "";
    if (this.hint.textContent !== mode) this.hint.textContent = mode;
    toggle(this.hint, "is-empty", !mode);
    // Several cards of one map are summed up as that map.
    const roots = picked > 1 ? this.selectedMapNodes().map((node) => forest.nodes.get(node.id)!.root) : [];
    const shared = roots.length === picked && roots.every((root) => root === roots[0]) ? roots[0] : undefined;
    const summaryRoot = selectedInfo?.root ?? shared ?? (typingNode ? forest.nodes.get(typingNode.id)?.root : undefined);
    let status: string;
    if (typingNode && settings.canvasEditorKeys !== false) {
      status = t("Editing · Enter done · Tab child · Shift+Tab up · Shift+Enter new line");
    } else if (summaryRoot) {
      const layout = mapLayout(byId.get(summaryRoot)) ?? "right";
      status = `${t("Mind map")} · ${t(LAYOUT_NAMES[layout])} · ${mapMembers(forest, summaryRoot).length}`;
    } else if (selected && settings.canvasKeyboard) status = t("Enter: next card · Tab: child");
    else if (selected) status = t("Select one card to grow or arrange a branch");
    else if (picked > 1) status = "";
    else if (this.canvas.nodes.size === 0) status = this.empty ? t("Click New topic to start") : "";
    else status = t("Select a card, or start a new topic");
    if (this.status.textContent !== status) this.status.textContent = status;
    this.syncEmpty();
    if (find) {
      let folded = 0;
      for (const id of matches) if (hidden.has(id)) folded++;
      find.bar.sync({ query: find.query, total: matches.length, index: find.current ? matches.indexOf(find.current) + 1 : 0, folded });
    }
  }

  destroy() {
    this.disposed = true;
    this.stopPresenting();
    this.panel?.destroy();
    this.panel = null;
    this.stylePreview = null;
    this.dropTools();
    this.releaseSnapping();
    this.unbindEditorKeys();
    this.releaseEditKeys();
    for (const badge of this.badges.values()) badge.el.remove();
    this.badges.clear();
    for (const chips of this.chips.values()) chips.el.remove();
    this.chips.clear();
    this.chipPress = null;
    this.chipHover = null;
    this.lightCard(null);
    this.hoverEvent = null;
    if (this.healTimer) this.win.clearTimeout(this.healTimer);
    if (this.emptyTimer) this.win.clearTimeout(this.emptyTimer);
    this.motion.finish();
    this.finishFolding(false);
    this.endGesture();
    this.observer?.disconnect();
    if (this.frame) this.win.cancelAnimationFrame(this.frame);
    if (this.refreshTimer) this.win.clearTimeout(this.refreshTimer);
    if (this.settleTimer) this.win.clearTimeout(this.settleTimer);
    if (this.flashTimer) this.win.clearTimeout(this.flashTimer);
    if (this.hoverFrame) this.win.cancelAnimationFrame(this.hoverFrame);
    this.setHovered(null);
    for (const key of this.keys) key.scope.unregister(key);
    const wrapper = this.canvas.wrapperEl;
    wrapper.removeEventListener("pointerup", this.schedule);
    wrapper.removeEventListener("keyup", this.schedule);
    wrapper.removeEventListener("pointerdown", this.onPointerDown, true);
    wrapper.removeEventListener("click", this.onChipClick, true);
    wrapper.removeEventListener("dblclick", this.onChipDblclick, true);
    wrapper.removeEventListener("contextmenu", this.onChipMenu, true);
    wrapper.removeEventListener("click", this.onCardLinkClick, true);
    wrapper.removeEventListener("auxclick", this.onCardLinkClick, true);
    wrapper.removeEventListener("mouseover", this.onCardLinkOver, true);
    wrapper.removeEventListener("mouseout", this.onCardLinkOut, true);
    wrapper.removeEventListener("keydown", this.onKeydown, true);
    wrapper.removeEventListener("contextmenu", this.onBeforeDelete, true);
    wrapper.removeEventListener("cut", this.onBeforeDelete, true);
    wrapper.removeEventListener("paste", this.onPaste);
    wrapper.removeEventListener("pointermove", this.onHover);
    wrapper.removeEventListener("pointerleave", this.onHoverEnd);
    wrapper.removeEventListener("wheel", this.onWheel);
    for (const id of [...this.controls.keys()]) this.removeControls(id);
    for (const badge of this.progress.values()) badge.el.remove();
    this.progress.clear();
    for (const edge of [...this.patchedEdges]) this.unpatchEdge(edge);
    this.boundaryLayer?.remove();
    this.boundaryLayer = null;
    this.boundaryRects.clear();
    this.boundarySource = null;
    this.braceLayer?.remove();
    this.braceLayer = null;
    this.braces.clear();
    this.braceSource = null;
    this.menuGroup?.remove();
    this.menuGroup = null;
    this.minimap?.destroy();
    this.minimap = null;
    const classes = ["nf-canvas-muted", "nf-canvas-offstage", "nf-canvas-root", "nf-canvas-hidden", "nf-canvas-map-node",
      "nf-canvas-map-root", "nf-canvas-map-branch", "nf-canvas-map-sub", "nf-canvas-map-text", "nf-canvas-map-empty", "nf-canvas-folded",
      "nf-canvas-map-edge", "nf-canvas-map-trunk", "nf-canvas-trail", "nf-line-organic", "nf-line-curve", "nf-line-elbow", "nf-line-straight",
      "nf-canvas-drop-target", "nf-canvas-found", "nf-canvas-editing", "nf-canvas-auto-color", "nf-canvas-folding", "nf-canvas-drag-stale",
      "nf-canvas-text", "nf-canvas-map-rich", "nf-canvas-relation", "nf-canvas-connect-target", "nf-canvas-summary", "nf-canvas-preview-still",
      ...MAP_STYLES.map((theme) => `nf-theme-${theme}`), ...CANVAS_FONTS.map((font) => `nf-font-${font}`),
      ...CANVAS_SHAPES.map((shape) => `nf-shape-${shape}`)];
    for (const el of Array.from(wrapper.querySelectorAll(classes.map((cls) => `.${cls}`).join(", ")))) {
      el.classList.remove(...classes);
    }
    for (const node of this.editorSurfaces.keys()) this.updateEditor(node, false);
    // Offscreen Canvas nodes may currently be detached from the wrapper.
    for (const node of this.canvas.nodes.values()) {
      this.updateEditor(node, false);
      clearTopicTypography(node.nodeEl);
      node.nodeEl.classList.remove(...classes);
      node.nodeEl.style?.removeProperty("--nf-auto");
      node.nodeEl.style?.removeProperty("--nf-under");
      node.nodeEl.style?.removeProperty("--nf-line-scale");
      node.nodeEl.style?.removeProperty("--nf-map-scale");
      if (node.nodeEl.dataset?.nfHang) delete node.nodeEl.dataset.nfHang;
    }
    for (const edge of this.canvas.edges.values()) {
      for (const el of [edge.lineGroupEl, edge.lineEndGroupEl, edge.labelElement?.wrapperEl]) {
        el?.classList.remove(...classes);
        (el as HTMLElement | undefined)?.style?.removeProperty("--nf-auto");
        (el as HTMLElement | undefined)?.style?.removeProperty("--nf-line-scale");
      }
    }
    wrapper.classList.remove("nf-canvas-enhanced", "nf-canvas-polished", "nf-canvas-compact", "nf-canvas-connecting",
      "nf-canvas-bg-plain", "nf-canvas-bg-faint", "nf-canvas-finding", "nf-canvas-chip-hover", "nf-canvas-previewing", "nf-canvas-map-drag");
    this.empty?.remove();
    this.empty = null;
    this.hint.remove();
    this.toolbar.remove();
  }
}

/** Each command's name, translated once when the plugin loads; a function builds one from parts. */
const COMMANDS: [Action, string | (() => string)][] = [
  ["presets", "Canvas: open style panel"],
  // "Color scheme · Nordic": searching for 配色 or "color scheme" finds every preset.
  ...APPEARANCE_PRESETS.map((preset): [Action, () => string] =>
    [`preset-${preset.id}`, () => t("Canvas: color scheme · {name}").replace("{name}", t(preset.name))]),
  ["palette-off", "Canvas: turn off automatic colors"],
  ["newTopic", "Canvas: new topic"],
  ["child", "Canvas: add child"], ["sibling", "Canvas: add sibling"],
  ["connect", "Canvas: connect cards"],
  ["markers", "Canvas: markers"], ["numbering", "Canvas: number the topics"],
  ["note", "Canvas: add or show card note"], ["addNote", "Canvas: add another note to the card"],
  ["removeNote", "Canvas: delete card notes"],
  ["link", "Canvas: add or edit card link"], ["openLink", "Canvas: open card link"], ["removeLink", "Canvas: remove card links"],
  ["insertCardLink", "Canvas: link to another card in the card's words…"], ["copyCardLink", "Canvas: copy link to card"],
  ["colorBranch", "Canvas: color this branch…"],
  ["help", "Canvas: open the guide"],
  ["siblingBefore", "Canvas: add sibling above"],
  ["parent", "Canvas: go to parent"],
  ["outdent", "Canvas: outdent card"], ["indent", "Canvas: indent card"],
  ["deleteBranch", "Canvas: delete branch"],
  ["balanced", "Canvas: arrange as mind map"],
  ["right", "Canvas: arrange branch to the right"], ["left", "Canvas: arrange branch to the left"],
  ["down", "Canvas: arrange branch downward"], ["up", "Canvas: arrange branch upward"],
  ["tree", "Canvas: arrange as tree chart"],
  ["timeline", "Canvas: arrange as timeline"], ["timeline-vertical", "Canvas: arrange as vertical timeline"],
  ["release", "Canvas: return map to free layout"],
  ["branch-inherit", "Canvas: branch follows the map's structure"],
  ["branch-right", "Canvas: branch as logic chart (right)"], ["branch-left", "Canvas: branch as logic chart (left)"],
  ["branch-down", "Canvas: branch as org chart (down)"], ["branch-up", "Canvas: branch as org chart (up)"],
  ["branch-tree", "Canvas: branch as tree chart"], ["branch-timeline", "Canvas: branch as timeline"],
  ["branch-timeline-vertical", "Canvas: branch as vertical timeline"],
  ["align-center", "Canvas: centre children on their parents"], ["align-start", "Canvas: line children up from the top"],
  ["fold", "Canvas: fold or unfold branch"],
  ["foldAll", "Canvas: fold all branches"], ["unfoldAll", "Canvas: unfold all branches"],
  ["moveUp", "Canvas: move card up among siblings"], ["moveDown", "Canvas: move card down among siblings"],
  ["colors", "Canvas: auto-color all branches"], ["uncolor", "Canvas: clear branch colors"],
  ["theme-clean", "Canvas: clean map style"], ["theme-cards", "Canvas: cards map style"],
  ["theme-vivid", "Canvas: vivid map style"], ["theme-minimal", "Canvas: minimal map style"],
  ["theme-pastel", "Canvas: pastel map style"], ["theme-gradient", "Canvas: gradient map style"],
  ["font-default", "Canvas: map typeface follows the note font"], ["font-sans", "Canvas: sans typeface for the map"],
  ["font-serif", "Canvas: serif typeface for the map"], ["font-kai", "Canvas: Kai typeface for the map"],
  ["line-auto", "Canvas: automatic branch lines"], ["line-organic", "Canvas: tapered branch lines"],
  ["line-curve", "Canvas: curved branch lines"], ["line-elbow", "Canvas: elbow branch lines"],
  ["line-straight", "Canvas: straight branch lines"],
  ["boundary", "Canvas: add or remove boundary"],
  ["summary", "Canvas: add or remove summary"],
  ["shape-rounded", "Canvas: rounded cards"], ["shape-pill", "Canvas: pill cards"],
  ["shape-square", "Canvas: square cards"], ["shape-underline", "Canvas: underlined topics"],
  ["weight-thin", "Canvas: thin branch lines"], ["weight-normal", "Canvas: normal branch lines"], ["weight-bold", "Canvas: bold branch lines"],
  ["scale-small", "Canvas: smaller map text"], ["scale-normal", "Canvas: normal map text"], ["scale-large", "Canvas: larger map text"],
  ["level-1", "Canvas: show 1 level"], ["level-2", "Canvas: show 2 levels"], ["level-3", "Canvas: show 3 levels"],
  ["present", "Canvas: start or stop presenting"],
  ["presentFrom", "Canvas: present from this card"],
  ["selectBranch", "Canvas: select branch"],
  ["fit", "Canvas: fit cards to content"],
  ["explode", "Canvas: turn list into branches"],
  ["outline", "Canvas: copy branch as outline"],
  ["focus", "Canvas: focus branch"], ["reset", "Canvas: show all"],
  ["find", "Canvas: find text in map"],
  ["search", "Canvas: jump to card…"],
  ["minimap", "Canvas: show or hide minimap"],
  ["insertNote", "Canvas: insert note as mind map"],
  ["exportNote", "Canvas: export branch as note"],
];

export class CanvasEnhancements {
  private bindings = new Map<CanvasView, CanvasBinding>();
  private stopped = false;
  constructor(
    private plugin: Plugin,
    private settings: () => CanvasSettings,
    /** Persist a setting changed from the canvas itself (the minimap toggle). */
    private save: (patch: Partial<CanvasSettings>) => void = () => {},
  ) {
    const workspace = plugin.app.workspace;
    // Notes that cards link to preview on hover like any link, with the Page preview settings' Mod rule.
    plugin.registerHoverLinkSource?.(HOVER_SOURCE, { display: "Notion Flow", defaultMod: true });
    plugin.registerEvent(workspace.on("layout-change", () => this.refresh()));
    plugin.registerEvent(workspace.on("active-leaf-change", () => this.refresh()));
    // File cards count the tasks in their notes; those change elsewhere.
    const metadata = plugin.app.metadataCache;
    if (metadata?.on) plugin.registerEvent(metadata.on("changed", (file) => this.refresh(file)));
    // Canvas's card menu is emitted on the workspace but is not typed.
    const on = workspace.on as unknown as (name: string, callback: (menu: Menu, node: LiveNode) => void) => ReturnType<typeof workspace.on>;
    plugin.registerEvent(on.call(workspace, "canvas:node-menu", (menu, node) => {
      for (const binding of this.bindings.values()) {
        if (binding.canvas.nodes.get(node?.id) === node) binding.fillNodeMenu(menu);
      }
    }));
    // Typing `[[^` in a card lists the canvas's cards to link. Obsidian asks
    // its own suggestions first, and its link suggestion takes every `[[`,
    // so this one goes ahead of it; it answers only in a card being typed in.
    const suggest = new CardLinkSuggest(plugin.app, { cardsFor: (editor) => this.cardLinkChoices(editor) });
    if (typeof plugin.registerEditorSuggest === "function") {
      plugin.registerEditorSuggest(suggest);
      const suggests = (workspace as unknown as { editorSuggest?: { suggests?: unknown[] } }).editorSuggest?.suggests;
      const at = Array.isArray(suggests) ? suggests.indexOf(suggest) : -1;
      if (at > 0) {
        suggests!.splice(at, 1);
        suggests!.unshift(suggest);
      }
    }
    // A card's editor menu offers the same, under Obsidian's own Add link.
    plugin.registerEvent(workspace.on("editor-menu", (menu, editor) => {
      const binding = this.bindingTypingWith(editor);
      if (!binding) return;
      menu.addItem((item) => item.setSection("selection-link").setTitle(t("Link to a card…")).setIcon("locate-fixed")
        .onClick(() => { binding.run("insertCardLink"); }));
    }));
    workspace.onLayoutReady(() => this.refresh());
    for (const [action, name] of COMMANDS) {
      plugin.addCommand({ id: `canvas-${action}`, name: typeof name === "function" ? name() : t(name), checkCallback: (checking) => {
        if (!this.settings().canvasEnhancements) return false;
        const view = workspace.activeLeaf?.view as CanvasView | undefined;
        const binding = view ? this.bindings.get(view) : undefined;
        if (!binding?.canRun(action)) return false;
        if (!checking) binding.run(action);
        return true;
      } });
    }
  }

  private toggleMinimap = () => {
    this.save({ canvasMinimap: !this.settings().canvasMinimap });
    this.refresh();
  };

  /** The canvas whose card is being typed in with this editor, if any. */
  private bindingTypingWith(editor: unknown): CanvasBinding | null {
    if (!this.settings().canvasEnhancements) return null;
    const cm = (editor as { cm?: unknown } | null)?.cm;
    for (const binding of this.bindings.values()) if (binding.typingWith(cm)) return binding;
    return null;
  }

  /** The cards a link typed into a card can lead to, for the editor it is typed with. */
  private cardLinkChoices(editor: unknown): { cards: LinkableCard[]; markdown: boolean } | null {
    return this.bindingTypingWith(editor)?.cardLinkChoices((editor as { cm?: unknown }).cm) ?? null;
  }

  /** Bind every canvas pane and refresh it; given a changed note, only the canvases showing it as a card. */
  refresh(file?: { path: string } | null) {
    if (this.stopped) return;
    if (file) {
      for (const binding of this.bindings.values()) binding.noteChanged(file.path);
      return;
    }
    const views = new Set(this.plugin.app.workspace.getLeavesOfType("canvas")
      .map((leaf) => leaf.view as CanvasView));
    for (const [view, binding] of this.bindings) {
      if (!views.has(view) || !this.settings().canvasEnhancements || view.canvas !== binding.canvas) {
        binding.destroy();
        this.bindings.delete(view);
      }
    }
    if (!this.settings().canvasEnhancements) return;
    for (const view of views) {
      if (!this.bindings.has(view) && supportedCanvas(view.canvas)) {
        this.bindings.set(view, new CanvasBinding(view, view.canvas, this.settings, this.plugin.app, this.toggleMinimap, this.save));
      } else this.bindings.get(view)?.refresh();
    }
  }

  destroy() {
    this.stopped = true;
    for (const binding of this.bindings.values()) binding.destroy();
    this.bindings.clear();
  }
}
