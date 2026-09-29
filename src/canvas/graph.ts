/** The open JSON Canvas shape: extra fields belong to Canvas and other plugins. */
export interface CanvasNodeData {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  [key: string]: unknown;
}

export interface CanvasEdgeData {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: string;
  toSide?: string;
  [key: string]: unknown;
}

export interface CanvasData {
  nodes: CanvasNodeData[];
  edges: CanvasEdgeData[];
  [key: string]: unknown;
}

export type Position = { x: number; y: number };
export type Direction = 'left' | 'right' | 'up' | 'down';
/**
 * How a card's children sit around it. The four directions stack the
 * children beside the card and centre it on them; 'list' hangs them below
 * it, indented past its middle, as in an outline; 'row' and 'column' line
 * them up after it, one block after another, as the events of a timeline.
 */
export type Flow = Direction | 'list' | 'row' | 'column';
/**
 * A map's structure: a mind map (both sides), a logic chart (right, left),
 * an org chart (down, up), a tree chart, or a timeline.
 */
export type MapLayout = Direction | 'balanced' | 'tree' | 'timeline' | 'timeline-vertical';
export type Side = 'left' | 'right' | 'top' | 'bottom';
export type EdgeSides = { fromSide: Side; toSide: Side };
export type Rectangle = Position & { width: number; height: number };
type Interval = { low: number; high: number };
type Box = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * A mind map is a tree whose root card names its layout. Both flags are
 * ordinary JSON Canvas extension fields: Canvas keeps them, other apps ignore
 * them, and removing them returns the cards to free placement.
 */
export const LAYOUT_KEY = 'nfLayout';
export const COLLAPSED_KEY = 'nfCollapsed';
/** Spacing lives on the root too; standard spacing is written as no field. */
export const SPACING_KEY = 'nfSpacing';
/** A framed branch: its card and everything below it sit inside a boundary. */
export const BOUNDARY_KEY = 'nfBoundary';
/**
 * A summary: a card that sums up a run of sibling branches. It hangs off
 * a brace drawn past those branches, and names its parent and the first and
 * last sibling it covers. It is not connected by an edge, so it never
 * becomes a child; the tidy layout places it.
 */
export const SUMMARY_KEY = 'nfSummary';
/**
 * A branch's own structure, stored on the branch card: its subtree follows
 * that layout instead of the map's, as in mind-map apps that mix an outline
 * or a timeline into a mind map. A balanced structure only fits a root.
 */
export const BRANCH_KEY = 'nfBranch';
/** How a card's children line up with it, stored on the root. */
export const ALIGN_KEY = 'nfAlign';
export type MapAlign = 'center' | 'start';
export const LAYOUTS: readonly MapLayout[] = ['balanced', 'right', 'left', 'down', 'up', 'tree', 'timeline', 'timeline-vertical'];

export type MapSpacing = 'compact' | 'standard' | 'roomy';
export const SPACINGS: readonly MapSpacing[] = ['compact', 'standard', 'roomy'];
type Gap = { main: number; cross: number };
export type MapGaps = {
  horizontal: Gap;
  vertical: Gap;
  /**
   * Outline lists: below the parent, indented past its middle. Canvas bends
   * every connection at least 70px out of each side, so a list's elbow
   * needs this much room to turn without looping back.
   */
  list: Gap & { indent: number };
  /** Timelines: events one after another along the line. */
  row: Gap;
  column: Gap;
  /** Room between a framed branch and its boundary. */
  boundary: number;
  /**
   * Summaries: room between the covered branches and their brace, the
   * brace's depth, the room between the brace's tip and the summary card,
   * and the margin a summary keeps from the branches beside its run.
   */
  summary: { brace: number; width: number; main: number; margin: number };
};

/** Main: parent to child. Cross: between neighbouring sibling branches. */
export const MAP_GAPS: MapGaps = {
  horizontal: { main: 72, cross: 20 },
  vertical: { main: 56, cross: 28 },
  list: { main: 44, cross: 12, indent: 110 },
  row: { main: 64, cross: 40 },
  column: { main: 48, cross: 28 },
  boundary: 14,
  summary: { brace: 10, width: 12, main: 18, margin: 8 },
};

const SPACING_GAPS: Record<MapSpacing, MapGaps> = {
  compact: {
    horizontal: { main: 48, cross: 10 }, vertical: { main: 40, cross: 16 },
    list: { main: 34, cross: 6, indent: 92 }, row: { main: 44, cross: 24 }, column: { main: 32, cross: 16 },
    boundary: 10,
    summary: { brace: 8, width: 10, main: 12, margin: 6 },
  },
  standard: MAP_GAPS,
  roomy: {
    horizontal: { main: 112, cross: 36 }, vertical: { main: 84, cross: 48 },
    list: { main: 60, cross: 20, indent: 140 }, row: { main: 96, cross: 64 }, column: { main: 72, cross: 44 },
    boundary: 18,
    summary: { brace: 14, width: 14, main: 24, margin: 12 },
  },
};

const HORIZONTAL_GAP = 96;
const VERTICAL_GAP = 72;
const SIBLING_GAP = 48;
const OBSTACLE_GAP = 24;

export function mapLayout(node: { [key: string]: unknown } | undefined): MapLayout | null {
  const value = node?.[LAYOUT_KEY];
  return typeof value === 'string' && (LAYOUTS as readonly string[]).includes(value)
    ? value as MapLayout : null;
}

export function branchLayout(node: { [key: string]: unknown } | undefined): MapLayout | null {
  const value = node?.[BRANCH_KEY];
  return typeof value === 'string' && value !== 'balanced' && (LAYOUTS as readonly string[]).includes(value)
    ? value as MapLayout : null;
}

export function mapAlign(node: { [key: string]: unknown } | undefined): MapAlign {
  return node?.[ALIGN_KEY] === 'start' ? 'start' : 'center';
}

export function isCollapsed(node: { [key: string]: unknown } | undefined): boolean {
  return node?.[COLLAPSED_KEY] === true;
}

export function hasBoundary(node: { [key: string]: unknown } | undefined): boolean {
  return node?.[BOUNDARY_KEY] === true;
}

export function mapSpacing(node: { [key: string]: unknown } | undefined): MapSpacing {
  const value = node?.[SPACING_KEY];
  return value === 'compact' || value === 'roomy' ? value : 'standard';
}

export function spacingGaps(spacing: MapSpacing): MapGaps {
  return SPACING_GAPS[spacing];
}

/** What a summary card records: its parent and the run of siblings it covers. */
export interface SummaryLink {
  parent: string;
  from: string;
  to: string;
}

export function summaryLink(node: { [key: string]: unknown } | undefined): SummaryLink | null {
  const value = node?.[SUMMARY_KEY] as Partial<SummaryLink> | undefined;
  if (!value || typeof value !== 'object') return null;
  const { parent, from, to } = value;
  if (typeof parent !== 'string' || typeof from !== 'string' || typeof to !== 'string') return null;
  return { parent, from, to };
}

export function isSummary(node: { [key: string]: unknown } | undefined): boolean {
  return summaryLink(node) !== null;
}

/** A summary as the map sees it: its run in reading order, on one side. */
export interface Summary extends SummaryLink {
  id: string;
  /** How the covered siblings hang off the parent; the brace goes past them. */
  flow: Flow;
}

/** The side of the covered branches a summary sits on: away from their parent. */
export function summarySide(flow: Flow): Side {
  switch (flow) {
    case 'left': return 'left';
    case 'down': case 'row': return 'bottom';
    case 'up': return 'top';
    default: return 'right';
  }
}

/**
 * Every valid summary on the canvas, by the card it summarises under. A
 * summary whose parent is not a map card, or whose run has no surviving
 * sibling, is left alone as an ordinary card. A run that lost one end
 * shrinks to the other; ends on different sides of a balanced root keep
 * the first.
 */
export function summaryIndex(data: CanvasData, forest: Forest): Map<string, Summary[]> {
  const index = new Map<string, Summary[]>();
  const orders = new Map<string, string[]>();
  const childrenOf = (parent: string) => {
    let list = orders.get(parent);
    if (!list) {
      list = orderedChildren(data, forest, parent);
      orders.set(parent, list);
    }
    return list;
  };
  for (const node of data.nodes) {
    const link = summaryLink(node);
    if (!link || node.type === 'group' || !forest.nodes.has(link.parent) || forest.nodes.has(node.id)) continue;
    const siblings = childrenOf(link.parent);
    let from = siblings.includes(link.from) ? link.from : siblings.includes(link.to) ? link.to : null;
    let to = siblings.includes(link.to) ? link.to : from;
    if (!from || !to) continue;
    const flow = forest.nodes.get(from)!.direction;
    if (forest.nodes.get(to)!.direction !== flow) to = from;
    if (siblings.indexOf(from) > siblings.indexOf(to)) [from, to] = [to, from];
    const list = index.get(link.parent) ?? [];
    list.push({ id: node.id, parent: link.parent, from, to, flow });
    index.set(link.parent, list);
  }
  for (const list of index.values()) {
    const at = (summary: Summary) => childrenOf(summary.parent).indexOf(summary.from);
    list.sort((a, b) => at(a) - at(b));
  }
  return index;
}

/** The summaries of a map: those hanging under any of its cards. */
export function mapSummaries(forest: Forest, index: Map<string, Summary[]>, rootId: string): Summary[] {
  return mapMembers(forest, rootId).flatMap(id => index.get(id) ?? []);
}

/**
 * A relation names a relationship between cards and never adopts a card
 * into a map: a labelled connection, or one the connect tool marked
 * (`nfRelation`) so that it can stay unlabelled.
 */
export function isRelation(edge: CanvasEdgeData): boolean {
  return edge.nfRelation === true || (typeof edge.label === 'string' && edge.label.trim() !== '');
}

function isHorizontal(direction: Direction): boolean {
  return direction === 'left' || direction === 'right';
}

export function sidesFor(flow: Flow): EdgeSides {
  // JSON Canvas names the vertical sides top/bottom, while the keyboard and
  // layout API use up/down. Keep this translation at the data boundary.
  switch (flow) {
    case 'right': case 'row': return { fromSide: 'right', toSide: 'left' };
    case 'left': return { fromSide: 'left', toSide: 'right' };
    case 'down': case 'column': return { fromSide: 'bottom', toSide: 'top' };
    case 'up': return { fromSide: 'top', toSide: 'bottom' };
    // An outline's trunk drops from the parent and turns into each child.
    case 'list': return { fromSide: 'bottom', toSide: 'left' };
  }
}

/** The axis along which siblings in this flow are ordered. */
/** The axis siblings stack along: across the flow that leads to them. */
export function crossAxis(flow: Flow): 'x' | 'y' {
  return flow === 'up' || flow === 'down' || flow === 'row' ? 'x' : 'y';
}

/**
 * Where a card's children go, from its map's layout, the card's depth, and
 * how the card itself hangs off its parent. Branch flows are inherited; a
 * timeline's events carry lists (horizontal) or logic charts (vertical).
 */
export function childFlow(layout: MapLayout, depth: number, attachment: Flow): Flow {
  switch (layout) {
    case 'tree': return 'list';
    case 'timeline': return depth === 0 ? 'row' : 'list';
    case 'timeline-vertical': return depth === 0 ? 'column' : 'right';
    case 'balanced': return depth === 0 ? 'right' : attachment;
    default: return depth === 0 ? layout : attachment;
  }
}

function validRectangle(node: Rectangle): boolean {
  return Number.isFinite(node.x) && Number.isFinite(node.y)
    && Number.isFinite(node.width) && Number.isFinite(node.height)
    && node.width > 0 && node.height > 0;
}

function center(node: Rectangle): Position {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

function nodeIndex(data: CanvasData): Map<string, CanvasNodeData> {
  return new Map(data.nodes.filter(node => node.type !== 'group').map(node => [node.id, node]));
}

function outgoingIndex(data: CanvasData, nodes: Map<string, CanvasNodeData>): Map<string, CanvasEdgeData[]> {
  const outgoing = new Map<string, CanvasEdgeData[]>();
  for (const edge of data.edges) {
    if (!nodes.has(edge.fromNode) || !nodes.has(edge.toNode)) continue;
    const edges = outgoing.get(edge.fromNode) ?? [];
    edges.push(edge);
    outgoing.set(edge.fromNode, edges);
  }
  return outgoing;
}

function contains(group: Rectangle, node: Rectangle): boolean {
  return node.x >= group.x && node.y >= group.y
    && node.x + node.width <= group.x + group.width
    && node.y + node.height <= group.y + group.height;
}

function isGrouped(groups: CanvasNodeData[], node: CanvasNodeData): boolean {
  return groups.some(group => validRectangle(group) && contains(group, node));
}

/** Directed reachability; groups are containers, never graph vertices. */
export function buildBranch(data: CanvasData, rootId: string): Set<string> {
  const nodes = nodeIndex(data);
  const branch = new Set<string>();
  if (!nodes.has(rootId)) return branch;
  const outgoing = outgoingIndex(data, nodes);
  const pending = [rootId];
  while (pending.length) {
    const id = pending.pop()!;
    if (branch.has(id)) continue;
    branch.add(id);
    for (const edge of outgoing.get(id) ?? []) {
      if (!branch.has(edge.toNode)) pending.push(edge.toNode);
    }
  }
  return branch;
}

/** Parallel edges from one parent are fine; different parents are ambiguous. */
export function findParent(data: CanvasData, id: string): string | null {
  const nodes = nodeIndex(data);
  if (!nodes.has(id)) return null;
  let parent: string | null = null;
  for (const edge of data.edges) {
    if (edge.toNode !== id || edge.fromNode === id || !nodes.has(edge.fromNode)) continue;
    if (parent !== null && parent !== edge.fromNode) return null;
    parent = edge.fromNode;
  }
  return parent;
}

/* ------------------------------------------------------------------ */
/* Mind-map forest                                                     */
/* ------------------------------------------------------------------ */

export interface TreeNode {
  id: string;
  root: string;
  parent: string | null;
  /** The connection that makes this card a child; null for a root. */
  edge: string | null;
  depth: number;
  /** How this card hangs off its parent; a root's equals its flow. */
  direction: Flow;
  /** Where this card's children go. A balanced root's go both ways. */
  flow: Flow;
  /** The structure this card's subtree follows, and how deep it is in it. */
  structure: MapLayout;
  level: number;
  children: string[];
}

export interface Forest {
  roots: string[];
  nodes: Map<string, TreeNode>;
  edges: Set<string>;
}

interface Candidate {
  index: number;
  source: string;
  target: string;
  direction: Flow;
  previous: number;
  geometry: number;
  sides: number;
  depth: number;
}

class Heap<T> {
  private items: T[] = [];
  constructor(private less: (a: T, b: T) => boolean) {}
  get size(): number { return this.items.length; }
  push(item: T): void {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(items[i], items[parent])) break;
      [items[i], items[parent]] = [items[parent], items[i]];
      i = parent;
    }
  }
  pop(): T | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length && last !== undefined) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let best = i;
        if (left < items.length && this.less(items[left], items[best])) best = left;
        if (right < items.length && this.less(items[right], items[best])) best = right;
        if (best === i) break;
        [items[i], items[best]] = [items[best], items[i]];
        i = best;
      }
    }
    return top;
  }
}

function slotMatches(parent: Rectangle, child: Rectangle, flow: Flow, gaps: MapGaps): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) <= 1.5;
  switch (flow) {
    case 'list': return near(child.x, parent.x + parent.width / 2 + gaps.list.indent) && child.y >= parent.y + parent.height;
    case 'row': return near(center(child).y, center(parent).y) && child.x >= parent.x + parent.width;
    case 'column': return near(center(child).x, center(parent).x) && child.y >= parent.y + parent.height;
  }
  const { main } = gaps[isHorizontal(flow) ? 'horizontal' : 'vertical'];
  const expected = flow === 'right' ? parent.x + parent.width + main
    : flow === 'left' ? parent.x - main - child.width
      : flow === 'down' ? parent.y + parent.height + main
        : parent.y - main - child.height;
  return near(isHorizontal(flow) ? child.x : child.y, expected);
}

/**
 * Find every mind map on a canvas. Each root card with a layout claims the
 * cards reachable through its unlabelled outgoing connections.
 *
 * Canvas has only one kind of connection, so a card reached twice must pick
 * one tree parent. The choice prefers the connection a tidy layout would
 * draw — the child sits in its parent's slot, then the sides agree — before
 * the shallower parent and the older connection. Adding a cross-link to an
 * arranged map therefore never restructures it. `rects` may supply the
 * geometry from before a gesture so that dragging does not change parents,
 * and `previous` the parents from the last look, which win any tie.
 */
export function buildForest(
  data: CanvasData, rects: Map<string, Rectangle> = new Map(), previous: Map<string, string> = new Map(),
): Forest {
  const nodes = nodeIndex(data);
  const rect = (id: string): Rectangle => rects.get(id) ?? nodes.get(id)!;
  const groups = data.nodes.filter(node => node.type === 'group' && validRectangle(node));
  const membership = new Map<string, string[]>();
  const groupsOf = (id: string): string[] => {
    let ids = membership.get(id);
    if (!ids) {
      ids = groups.filter(group => contains(group, rect(id))).map(group => group.id);
      membership.set(id, ids);
    }
    return ids;
  };
  const outgoing = new Map<string, number[]>();
  data.edges.forEach((edge, index) => {
    if (edge.fromNode === edge.toNode || !nodes.has(edge.fromNode) || !nodes.has(edge.toNode)
      || isRelation(edge)) return;
    const list = outgoing.get(edge.fromNode) ?? [];
    list.push(index);
    outgoing.set(edge.fromNode, list);
  });

  const forest: Forest = { roots: [], nodes: new Map(), edges: new Set() };
  const layouts = new Map<string, MapLayout>();
  for (const node of data.nodes) {
    const layout = mapLayout(node);
    if (!layout || !nodes.has(node.id) || layouts.has(node.id) || !validRectangle(rect(node.id))) continue;
    layouts.set(node.id, layout);
    forest.roots.push(node.id);
    const flow = childFlow(layout, 0, 'right');
    forest.nodes.set(node.id, {
      id: node.id, root: node.id, parent: null, edge: null, depth: 0, direction: flow, flow, structure: layout, level: 0, children: [],
    });
  }

  const heap = new Heap<Candidate>((a, b) => (a.previous - b.previous || a.geometry - b.geometry
    || a.sides - b.sides || a.depth - b.depth || a.index - b.index) < 0);
  const offer = (source: string) => {
    const info = forest.nodes.get(source)!;
    // A card inside a group the root is not in stays with its group.
    const rootGroups = new Set(groupsOf(info.root));
    const sourceRect = rect(source);
    for (const index of outgoing.get(source) ?? []) {
      const edge = data.edges[index];
      const target = edge.toNode;
      if (forest.nodes.has(target) || layouts.has(target)) continue;
      const targetRect = rect(target);
      if (!validRectangle(targetRect) || groupsOf(target).some(group => !rootGroups.has(group))) continue;
      const direction: Flow = layouts.get(source) === 'balanced'
        ? center(targetRect).x < center(sourceRect).x ? 'left' : 'right'
        : info.flow;
      const sides = sidesFor(direction);
      heap.push({
        index, source, target, direction, depth: info.depth,
        previous: previous.get(target) === source ? 0 : 1,
        geometry: slotMatches(sourceRect, targetRect, direction, spacingGaps(mapSpacing(nodes.get(info.root)))) ? 0 : 1,
        sides: (!edge.fromSide || edge.fromSide === sides.fromSide)
          && (!edge.toSide || edge.toSide === sides.toSide) ? 0 : 1,
      });
    }
  };
  for (const root of forest.roots) offer(root);
  while (heap.size) {
    const candidate = heap.pop()!;
    if (forest.nodes.has(candidate.target)) continue;
    const parent = forest.nodes.get(candidate.source)!;
    const edgeId = data.edges[candidate.index].id;
    // A branch with a structure of its own starts a new count of levels.
    const own = branchLayout(nodes.get(candidate.target));
    const structure = own ?? parent.structure;
    const level = own ? 0 : parent.level + 1;
    forest.nodes.set(candidate.target, {
      id: candidate.target, root: parent.root, parent: parent.id, edge: edgeId,
      depth: parent.depth + 1, direction: candidate.direction,
      flow: childFlow(structure, level, candidate.direction), structure, level, children: [],
    });
    parent.children.push(candidate.target);
    forest.edges.add(edgeId);
    offer(candidate.target);
  }
  return forest;
}

/** Every card below `id` in its map, folded or not, in depth-first order. */
export function descendants(forest: Forest, id: string): string[] {
  const result: string[] = [];
  const pending = [...(forest.nodes.get(id)?.children ?? [])].reverse();
  while (pending.length) {
    const next = pending.pop()!;
    result.push(next);
    const children = forest.nodes.get(next)?.children ?? [];
    for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
  }
  return result;
}

/** Cards below a folded card. Folding outside a map has no effect. */
export function hiddenNodes(data: CanvasData, forest: Forest): Set<string> {
  const byId = new Map(data.nodes.map(node => [node.id, node]));
  const hidden = new Set<string>();
  for (const [id, info] of forest.nodes) {
    if (!info.children.length || !isCollapsed(byId.get(id))) continue;
    for (const child of descendants(forest, id)) hidden.add(child);
  }
  return hidden;
}

/** A map's cards: its root and every descendant. */
export function mapMembers(forest: Forest, rootId: string): string[] {
  return forest.nodes.has(rootId) ? [rootId, ...descendants(forest, rootId)] : [];
}

function crossCenter(node: Rectangle, flow: Flow): number {
  return crossAxis(flow) === 'y' ? node.y + node.height / 2 : node.x + node.width / 2;
}

/**
 * Children in reading order: along the cross axis, so dragging a card past a
 * sibling reorders it. A balanced root reads clockwise from twelve o'clock:
 * right side top to bottom, then left side bottom to top.
 */
export function orderedChildren(data: CanvasData, forest: Forest, id: string): string[] {
  const info = forest.nodes.get(id);
  if (!info) return [];
  const nodes = nodeIndex(data);
  const order = new Map(data.nodes.map((node, index) => [node.id, index]));
  const children = info.children.filter(child => nodes.has(child));
  const byCross = (a: string, b: string) => {
    const direction = forest.nodes.get(a)!.direction;
    return crossCenter(nodes.get(a)!, direction) - crossCenter(nodes.get(b)!, direction)
      || order.get(a)! - order.get(b)!;
  };
  if (info.parent === null && mapLayout(nodes.get(id)) === 'balanced') {
    const right = children.filter(child => forest.nodes.get(child)!.direction === 'right').sort(byCross);
    const left = children.filter(child => forest.nodes.get(child)!.direction === 'left').sort(byCross);
    return [...right, ...left.reverse()];
  }
  return children.sort(byCross);
}

/* ------------------------------------------------------------------ */
/* Tidy layout                                                         */
/* ------------------------------------------------------------------ */

export interface MapLayoutPlan {
  /** New positions for every card of the map, hidden ones included. */
  positions: Map<string, Position>;
  /** Attachment sides for every tree connection of the map. */
  edgeSides: Map<string, EdgeSides>;
}

export interface MapLayoutOptions {
  /** Layout to plan instead of the one stored on the root. */
  layout?: MapLayout;
  /** Spacing to plan instead of the one stored on the root. */
  spacing?: MapSpacing;
  /** Alignment to plan instead of the one stored on the root. */
  align?: MapAlign;
  /** Redistribute a balanced root's branches; otherwise each keeps its side. */
  rebalance?: boolean;
  /**
   * Sibling order to keep, by card: when a map changes structure, its
   * reading order carries over instead of being read off the old positions.
   */
  order?: Map<string, number>;
}

function union(box: Box, x: number, y: number, block: Box) {
  box.minX = Math.min(box.minX, x + block.minX);
  box.minY = Math.min(box.minY, y + block.minY);
  box.maxX = Math.max(box.maxX, x + block.maxX);
  box.maxY = Math.max(box.maxY, y + block.maxY);
}

const EMPTY_BOX = (): Box => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

/**
 * Stack child blocks along the cross axis and centre the parent between its
 * first and last child. Offsets are relative to the parent's top-left.
 */
function stackChildren(
  parent: Rectangle, children: string[], direction: Direction, gaps: MapGaps,
  rect: (id: string) => Rectangle, blocks: Map<string, Box>, offsets: Map<string, Position>, align: MapAlign = 'center',
): Box {
  const horizontal = isHorizontal(direction);
  const { main, cross } = gaps[horizontal ? 'horizontal' : 'vertical'];
  const placed: { id: string; x: number; y: number }[] = [];
  let cursor = 0;
  for (const id of children) {
    const child = rect(id);
    const block = blocks.get(id)!;
    const crossOffset = cursor - (horizontal ? block.minY : block.minX);
    const mainOffset = direction === 'right' ? parent.width + main
      : direction === 'left' ? -main - child.width
        : direction === 'down' ? parent.height + main
          : -main - child.height;
    placed.push(horizontal ? { id, x: mainOffset, y: crossOffset } : { id, x: crossOffset, y: mainOffset });
    cursor += (horizontal ? block.maxY - block.minY : block.maxX - block.minX) + cross;
  }
  const middle = (entry: { id: string; x: number; y: number }) => horizontal
    ? entry.y + rect(entry.id).height / 2 : entry.x + rect(entry.id).width / 2;
  // Centred: the parent sits between its first and last child. From the
  // start: the first child's card lines up with the parent's leading edge.
  const shift = align === 'start' ? -(horizontal ? placed[0].y : placed[0].x)
    : (horizontal ? parent.height : parent.width) / 2 - (middle(placed[0]) + middle(placed[placed.length - 1])) / 2;
  const box = EMPTY_BOX();
  for (const entry of placed) {
    if (horizontal) entry.y += shift; else entry.x += shift;
    offsets.set(entry.id, { x: entry.x, y: entry.y });
    union(box, entry.x, entry.y, blocks.get(entry.id)!);
  }
  return box;
}

/**
 * An outline: child blocks one below another, indented past the parent's
 * middle. A framed child keeps its indent; its boundary reaches back into it.
 */
function stackList(
  parent: Rectangle, children: string[], gaps: MapGaps,
  blocks: Map<string, Box>, offsets: Map<string, Position>, pad: (id: string) => number,
): Box {
  const { main, cross, indent } = gaps.list;
  const x = parent.width / 2 + indent;
  let cursor = parent.height + main;
  const box = EMPTY_BOX();
  for (const id of children) {
    const block = blocks.get(id)!;
    const offset = { x: x - Math.min(0, block.minX + pad(id)), y: cursor - block.minY };
    offsets.set(id, offset);
    union(box, offset.x, offset.y, block);
    cursor += block.maxY - block.minY + cross;
  }
  return box;
}

/**
 * A timeline: child blocks one after another, each card centred on the
 * parent's line — to the right in a row, downward in a column — so the
 * connections overlap into a single spine.
 */
function stackSequence(
  parent: Rectangle, children: string[], flow: 'row' | 'column', gaps: MapGaps,
  rect: (id: string) => Rectangle, blocks: Map<string, Box>, offsets: Map<string, Position>,
): Box {
  const { main, cross } = gaps[flow];
  let cursor = (flow === 'row' ? parent.width : parent.height) + main;
  const box = EMPTY_BOX();
  for (const id of children) {
    const child = rect(id);
    const block = blocks.get(id)!;
    const offset = flow === 'row'
      ? { x: cursor - block.minX, y: (parent.height - child.height) / 2 }
      : { x: (parent.width - child.width) / 2, y: cursor - block.minY };
    offsets.set(id, offset);
    union(box, offset.x, offset.y, block);
    cursor += (flow === 'row' ? block.maxX - block.minX : block.maxY - block.minY) + cross;
  }
  return box;
}

function crossGap(flow: Flow, gaps: MapGaps): number {
  if (flow === 'list') return gaps.list.cross;
  if (flow === 'row' || flow === 'column') return gaps[flow].cross;
  return gaps[isHorizontal(flow) ? 'horizontal' : 'vertical'].cross;
}

function measure(
  visible: string[], kids: Map<string, string[]>, flowOf: (id: string) => Flow,
  rect: (id: string) => Rectangle, gaps: MapGaps, pad: (id: string) => number = () => 0,
  summaries: Map<string, Summary[]> = new Map(), align: MapAlign = 'center',
): { blocks: Map<string, Box>; offsets: Map<string, Position> } {
  const blocks = new Map<string, Box>();
  const offsets = new Map<string, Position>();
  // Reverse breadth-first order visits children before parents without
  // recursion, so very deep maps cannot exhaust the call stack.
  for (let i = visible.length - 1; i >= 0; i--) {
    const id = visible[i];
    const node = rect(id);
    const block: Box = { minX: 0, minY: 0, maxX: node.width, maxY: node.height };
    const groups = new Map<Flow, string[]>();
    for (const child of kids.get(id) ?? []) {
      const flow = flowOf(child);
      const list = groups.get(flow);
      if (list) list.push(child); else groups.set(flow, [child]);
    }
    for (const [flow, children] of groups) {
      const covering = (summaries.get(id) ?? []).filter(summary => children.includes(summary.from));
      const vertical = crossAxis(flow) === 'y';
      const run = (summary: Summary) => {
        const from = children.indexOf(summary.from);
        return [from, Math.max(from, children.indexOf(summary.to))] as const;
      };
      // A summary taller than the branches it covers takes its room from
      // the last of them, so the branches after it are not overlapped.
      for (const summary of covering) {
        const [from, to] = run(summary);
        let covered = (to - from) * crossGap(flow, gaps);
        for (let k = from; k <= to; k++) {
          const b = blocks.get(children[k])!;
          covered += vertical ? b.maxY - b.minY : b.maxX - b.minX;
        }
        const card = rect(summary.id);
        const need = (vertical ? card.height : card.width) + 2 * gaps.summary.margin;
        if (need <= covered) continue;
        const last = blocks.get(children[to])!;
        if (vertical) last.maxY += need - covered; else last.maxX += need - covered;
      }
      const box = flow === 'list' ? stackList(node, children, gaps, blocks, offsets, pad)
        : flow === 'row' || flow === 'column' ? stackSequence(node, children, flow, gaps, rect, blocks, offsets)
          : stackChildren(node, children, flow, gaps, rect, blocks, offsets, align);
      union(block, 0, 0, box);
      // Past the covered branches: the brace, then the summary, centred on the run.
      for (const summary of covering) {
        const [from, to] = run(summary);
        const side = summarySide(flow);
        let main = side === 'right' || side === 'bottom' ? -Infinity : Infinity;
        let low = Infinity;
        let high = -Infinity;
        for (let k = from; k <= to; k++) {
          const offset = offsets.get(children[k])!;
          const b = blocks.get(children[k])!;
          low = Math.min(low, vertical ? offset.y + b.minY : offset.x + b.minX);
          high = Math.max(high, vertical ? offset.y + b.maxY : offset.x + b.maxX);
          main = side === 'right' ? Math.max(main, offset.x + b.maxX) : side === 'left' ? Math.min(main, offset.x + b.minX)
            : side === 'bottom' ? Math.max(main, offset.y + b.maxY) : Math.min(main, offset.y + b.minY);
        }
        const card = rect(summary.id);
        const reach = gaps.summary.brace + gaps.summary.width + gaps.summary.main;
        const middle = (low + high) / 2;
        const offset = side === 'right' ? { x: main + reach, y: middle - card.height / 2 }
          : side === 'left' ? { x: main - reach - card.width, y: middle - card.height / 2 }
            : side === 'bottom' ? { x: middle - card.width / 2, y: main + reach }
              : { x: middle - card.width / 2, y: main - reach - card.height };
        offsets.set(summary.id, offset);
        union(block, offset.x, offset.y, { minX: 0, minY: 0, maxX: card.width, maxY: card.height });
      }
    }
    // A framed branch takes the room its boundary needs on every side.
    const room = pad(id);
    if (room) {
      block.minX -= room;
      block.minY -= room;
      block.maxX += room;
      block.maxY += room;
    }
    blocks.set(id, block);
  }
  return { blocks, offsets };
}

/**
 * Plan a tidy layout for one map. The root stays where it is; folded
 * branches move with the card that folds them so they reopen in place.
 * Cards outside the map and every other property are never touched.
 */
export function planMapLayout(
  data: CanvasData, forest: Forest, rootId: string, options: MapLayoutOptions = {},
): MapLayoutPlan | null {
  const nodes = nodeIndex(data);
  const root = nodes.get(rootId);
  const info = forest.nodes.get(rootId);
  if (!root || !info || info.parent !== null || !validRectangle(root)) return null;
  const layout = options.layout ?? mapLayout(root) ?? 'right';
  const gaps = spacingGaps(options.spacing ?? mapSpacing(root));
  const align = options.align ?? mapAlign(root);
  const rect = (id: string): Rectangle => nodes.get(id)!;
  const order = new Map(data.nodes.map((node, index) => [node.id, index]));
  const collapsed = (id: string) => isCollapsed(nodes.get(id)) && forest.nodes.get(id)!.children.length > 0;
  const balanced = layout === 'balanced';
  // The structure a card's children follow: its nearest ancestor's own
  // (a branch with a structure of its own), else the map's; and the card's
  // level within that structure.
  const structures = new Map<string, { structure: MapLayout; level: number }>();
  const structureOf = (id: string): { structure: MapLayout; level: number } => {
    let found = structures.get(id);
    if (found) return found;
    const own = id === rootId ? null : branchLayout(nodes.get(id));
    const parent = forest.nodes.get(id)!.parent;
    found = id === rootId ? { structure: layout, level: 0 }
      : own ? { structure: own, level: 0 }
        : (({ structure, level }) => ({ structure, level: level + 1 }))(structureOf(parent!));
    structures.set(id, found);
    return found;
  };
  const pad = (id: string) => hasBoundary(nodes.get(id)) ? gaps.boundary : 0;
  const summaries = new Map<string, Summary[]>();
  for (const [parent, list] of summaryIndex(data, forest)) {
    if (forest.nodes.get(parent)!.root === rootId) summaries.set(parent, list.filter(summary => validRectangle(rect(summary.id))));
  }

  // Sides for a balanced root's branches.
  const rootChildren = collapsed(rootId) ? [] : info.children.filter(id => nodes.has(id));
  const side = new Map<string, Direction>();
  if (balanced && !options.rebalance) {
    const middle = center(root).x;
    for (const child of rootChildren) side.set(child, center(rect(child)).x < middle ? 'left' : 'right');
  }

  // How every card of the map hangs off its parent, folded ones included.
  const attach = new Map<string, Flow>();
  const rootFlow = childFlow(layout, 0, 'right');
  const flowOf = (id: string): Flow => {
    if (id === rootId) return rootFlow;
    const { structure, level } = structureOf(id);
    return childFlow(structure, level, attach.get(id)!);
  };
  const assign = () => {
    const pending = [rootId];
    for (let i = 0; i < pending.length; i++) {
      const id = pending[i];
      for (const child of forest.nodes.get(id)!.children) {
        if (!nodes.has(child)) continue;
        attach.set(child, id === rootId && balanced
          ? side.get(child) ?? (forest.nodes.get(child)!.direction === 'left' ? 'left' : 'right')
          : flowOf(id));
        pending.push(child);
      }
    }
  };
  assign();

  // Visible cards in breadth-first order with their children sorted.
  const kids = new Map<string, string[]>();
  const visible: string[] = [rootId];
  const rank = options.order;
  const byRank = (a: string, b: string) => rank ? (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || 0 : 0;
  const byCross = (flow: Flow) => (a: string, b: string) =>
    byRank(a, b) || crossCenter(rect(a), flow) - crossCenter(rect(b), flow) || order.get(a)! - order.get(b)!;
  for (let i = 0; i < visible.length; i++) {
    const id = visible[i];
    const children = id === rootId ? [...rootChildren]
      : collapsed(id) ? [] : forest.nodes.get(id)!.children.filter(child => nodes.has(child));
    if (!(id === rootId && balanced)) children.sort(byCross(flowOf(id)));
    kids.set(id, children);
    visible.push(...children);
  }

  if (balanced && options.rebalance && rootChildren.length) {
    // Split the clockwise reading order where both sides are closest in size.
    const c = center(root);
    const angle = (id: string) => {
      const p = center(rect(id));
      const value = Math.atan2(p.x - c.x, c.y - p.y);
      return value < 0 ? value + 2 * Math.PI : value;
    };
    const clockwise = [...rootChildren].sort((a, b) => byRank(a, b) || angle(a) - angle(b) || order.get(a)! - order.get(b)!);
    for (const child of clockwise) side.set(child, 'right');
    assign();
    const provisional = measure(visible, kids, id => attach.get(id)!, rect, gaps, pad, summaries, align);
    const spans = clockwise.map(id => {
      const block = provisional.blocks.get(id)!;
      return block.maxY - block.minY + gaps.horizontal.cross;
    });
    const total = spans.reduce((sum, span) => sum + span, 0);
    let split = clockwise.length;
    let best = Infinity;
    let prefix = total;
    for (let k = clockwise.length; k >= 0; k--) {
      const score = Math.abs(prefix - (total - prefix));
      if (score < best) { best = score; split = k; }
      if (k > 0) prefix -= spans[k - 1];
    }
    const right = clockwise.slice(0, split);
    const left = clockwise.slice(split).reverse();
    for (const child of left) side.set(child, 'left');
    for (const child of right) side.set(child, 'right');
    kids.set(rootId, [...right, ...left]);
    // Every card below a root branch follows that branch's side.
    assign();
  } else if (balanced) {
    kids.set(rootId, [
      ...rootChildren.filter(id => side.get(id) === 'right').sort(byCross('right')),
      ...rootChildren.filter(id => side.get(id) === 'left').sort(byCross('left')),
    ]);
  }

  const { offsets } = measure(visible, kids, id => attach.get(id)!, rect, gaps, pad, summaries, align);
  const exact = new Map<string, Position>([[rootId, { x: root.x, y: root.y }]]);
  for (const id of visible) {
    const origin = exact.get(id)!;
    for (const child of kids.get(id)!) {
      const offset = offsets.get(child)!;
      exact.set(child, { x: origin.x + offset.x, y: origin.y + offset.y });
    }
    for (const summary of summaries.get(id) ?? []) {
      const offset = offsets.get(summary.id);
      if (offset) exact.set(summary.id, { x: origin.x + offset.x, y: origin.y + offset.y });
    }
  }

  const positions = new Map<string, Position>();
  for (const [id, position] of exact) positions.set(id, { x: Math.round(position.x), y: Math.round(position.y) });
  const edgeSides = new Map<string, EdgeSides>();
  for (const id of visible) {
    const tree = forest.nodes.get(id)!;
    if (tree.edge) edgeSides.set(tree.edge, sidesFor(attach.get(id)!));
    if (!collapsed(id)) continue;
    // Folded branches keep their shape and travel with their card, and
    // keep growing the way their visible card grows.
    const dx = positions.get(id)!.x - rect(id).x;
    const dy = positions.get(id)!.y - rect(id).y;
    for (const hidden of [id, ...descendants(forest, id)]) {
      if (!nodes.has(hidden)) continue;
      // The summaries of a folded branch travel with it as well.
      for (const summary of summaries.get(hidden) ?? []) {
        positions.set(summary.id, { x: rect(summary.id).x + dx, y: rect(summary.id).y + dy });
      }
      if (hidden === id) continue;
      const hiddenInfo = forest.nodes.get(hidden)!;
      positions.set(hidden, { x: rect(hidden).x + dx, y: rect(hidden).y + dy });
      if (hiddenInfo.edge) edgeSides.set(hiddenInfo.edge, sidesFor(attach.get(hidden)!));
    }
  }
  return { positions, edgeSides };
}

/** The summaries that folded branches hide: their parent, or a covered sibling, is hidden. */
export function hiddenSummaries(index: Map<string, Summary[]>, hidden: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const [parent, list] of index) {
    for (const summary of list) {
      if (hidden.has(parent) || hidden.has(summary.from) || hidden.has(summary.to)) result.add(summary.id);
    }
  }
  return result;
}

/** A brace past a run of branches, and the line from its tip to the summary card. */
export interface SummaryBrace {
  id: string;
  side: Side;
  /** The brace's ends, along the run. */
  start: Position;
  end: Position;
  /** Where the brace points, and the summary card's edge it points to. */
  tip: Position;
  target: Position;
}

/**
 * The braces of a map's summaries, from where the cards are now: each
 * spans the visible extent of the branches it covers (and its own card's
 * height, when that is larger), a little past them on their outer side,
 * with its tip toward the summary card. `rect` may supply live geometry.
 */
export function summaryBraces(
  data: CanvasData, forest: Forest, hidden: Set<string> = new Set(),
  rect: (id: string) => Rectangle | undefined = (() => {
    const nodes = nodeIndex(data);
    return (id: string) => nodes.get(id);
  })(),
): Map<string, SummaryBrace> {
  const braces = new Map<string, SummaryBrace>();
  const index = summaryIndex(data, forest);
  if (!index.size) return braces;
  const nodes = nodeIndex(data);
  const concealed = hiddenSummaries(index, hidden);
  const extents = new Map<string, Box | null>();
  const extent = (id: string): Box | null => {
    if (extents.has(id)) return extents.get(id)!;
    const own = rect(id);
    let box: Box | null = own && validRectangle(own) && !hidden.has(id)
      ? { minX: own.x, minY: own.y, maxX: own.x + own.width, maxY: own.y + own.height } : null;
    if (box && !(isCollapsed(nodes.get(id)) && forest.nodes.get(id)!.children.length)) {
      for (const child of forest.nodes.get(id)?.children ?? []) {
        const inner = extent(child);
        if (!inner) continue;
        box.minX = Math.min(box.minX, inner.minX);
        box.minY = Math.min(box.minY, inner.minY);
        box.maxX = Math.max(box.maxX, inner.maxX);
        box.maxY = Math.max(box.maxY, inner.maxY);
      }
    }
    extents.set(id, box);
    return box;
  };
  for (const [parent, list] of index) {
    const siblings = orderedChildren(data, forest, parent);
    const gaps = spacingGaps(mapSpacing(nodes.get(forest.nodes.get(parent)!.root)));
    for (const summary of list) {
      const card = rect(summary.id);
      if (concealed.has(summary.id) || !card || !validRectangle(card)) continue;
      const from = siblings.indexOf(summary.from);
      const to = Math.max(from, siblings.indexOf(summary.to));
      const box = EMPTY_BOX();
      for (let k = from; k <= to; k++) {
        const inner = extent(siblings[k]);
        if (!inner) continue;
        box.minX = Math.min(box.minX, inner.minX);
        box.minY = Math.min(box.minY, inner.minY);
        box.maxX = Math.max(box.maxX, inner.maxX);
        box.maxY = Math.max(box.maxY, inner.maxY);
      }
      if (!Number.isFinite(box.minX)) continue;
      const side = summarySide(summary.flow);
      const vertical = side === 'left' || side === 'right';
      // A summary card taller than its run stretches the brace to itself.
      const low = Math.min(vertical ? box.minY : box.minX, (vertical ? card.y : card.x) + gaps.summary.margin);
      const high = Math.max(vertical ? box.maxY : box.maxX, (vertical ? card.y + card.height : card.x + card.width) - gaps.summary.margin);
      const middle = (low + high) / 2;
      const line = side === 'right' ? box.maxX + gaps.summary.brace : side === 'left' ? box.minX - gaps.summary.brace
        : side === 'bottom' ? box.maxY + gaps.summary.brace : box.minY - gaps.summary.brace;
      const depth = (side === 'right' || side === 'bottom' ? 1 : -1) * gaps.summary.width;
      const at = (main: number, cross: number): Position => vertical ? { x: main, y: cross } : { x: cross, y: main };
      const target = side === 'right' ? { x: card.x, y: card.y + card.height / 2 }
        : side === 'left' ? { x: card.x + card.width, y: card.y + card.height / 2 }
          : side === 'bottom' ? { x: card.x + card.width / 2, y: card.y }
            : { x: card.x + card.width / 2, y: card.y + card.height };
      braces.set(summary.id, {
        id: summary.id, side, start: at(line, low), end: at(line, high), tip: at(line + depth, middle), target,
      });
    }
  }
  return braces;
}

/** An SVG path for a brace: two arms curving into a spine, with a tip in the middle. */
export function bracePath(brace: SummaryBrace, sharpness = 1): string {
  const vertical = brace.side === 'left' || brace.side === 'right';
  const main = (p: Position) => vertical ? p.x : p.y;
  const cross = (p: Position) => vertical ? p.y : p.x;
  const at = (m: number, c: number) => vertical ? `${round(m)} ${round(c)}` : `${round(c)} ${round(m)}`;
  const line = main(brace.start);
  const depth = main(brace.tip) - line;
  const spine = line + depth / 2;
  const low = cross(brace.start);
  const high = cross(brace.end);
  const middle = (low + high) / 2;
  const r = Math.min(Math.abs(depth) / 2 * sharpness, (high - low) / 4);
  return [
    `M${at(line, low)}`,
    `Q${at(spine, low)} ${at(spine, low + r)}`,
    `L${at(spine, middle - r)}`,
    `Q${at(spine, middle)} ${at(line + depth, middle)}`,
    `Q${at(spine, middle)} ${at(spine, middle + r)}`,
    `L${at(spine, high - r)}`,
    `Q${at(spine, high)} ${at(line, high)}`,
  ].join(' ');
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The boundaries of a map's framed branches: each frames its card and the
 * visible cards below it, and any boundary inside it, with the map's padding
 * to spare. `rect` may supply live geometry, as cards glide.
 */
export function boundaryBoxes(
  data: CanvasData, forest: Forest, hidden: Set<string> = new Set(),
  rect: (id: string) => Rectangle | undefined = (() => {
    const nodes = nodeIndex(data);
    return (id: string) => nodes.get(id);
  })(),
): Map<string, Box> {
  const nodes = nodeIndex(data);
  const boxes = new Map<string, Box>();
  const framed = [...forest.nodes.keys()].filter(id => hasBoundary(nodes.get(id)) && !hidden.has(id));
  if (!framed.length) return boxes;
  const summaries = summaryIndex(data, forest);
  const concealed = hiddenSummaries(summaries, hidden);
  // Visible cards, parents before children, then measured children first.
  const order: string[] = [];
  for (const root of forest.roots) {
    if (!framed.some(id => forest.nodes.get(id)!.root === root)) continue;
    const pending = [root];
    for (let i = 0; i < pending.length; i++) {
      const id = pending[i];
      if (hidden.has(id) || !nodes.has(id)) continue;
      order.push(id);
      pending.push(...forest.nodes.get(id)!.children);
    }
  }
  const extents = new Map<string, Box>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const own = rect(id);
    if (!own || !validRectangle(own)) continue;
    const box: Box = { minX: own.x, minY: own.y, maxX: own.x + own.width, maxY: own.y + own.height };
    for (const child of forest.nodes.get(id)!.children) {
      const extent = extents.get(child);
      if (!extent) continue;
      box.minX = Math.min(box.minX, extent.minX);
      box.minY = Math.min(box.minY, extent.minY);
      box.maxX = Math.max(box.maxX, extent.maxX);
      box.maxY = Math.max(box.maxY, extent.maxY);
    }
    // The summaries under a framed branch sit inside its boundary too.
    for (const summary of summaries.get(id) ?? []) {
      const card = rect(summary.id);
      if (!card || !validRectangle(card) || concealed.has(summary.id)) continue;
      box.minX = Math.min(box.minX, card.x);
      box.minY = Math.min(box.minY, card.y);
      box.maxX = Math.max(box.maxX, card.x + card.width);
      box.maxY = Math.max(box.maxY, card.y + card.height);
    }
    if (hasBoundary(nodes.get(id))) {
      const room = spacingGaps(mapSpacing(nodes.get(forest.nodes.get(id)!.root))).boundary;
      box.minX -= room;
      box.minY -= room;
      box.maxX += room;
      box.maxY += room;
      boxes.set(id, { ...box });
    }
    extents.set(id, box);
  }
  return boxes;
}

/**
 * Show a map down to `level` (1: the main branches): cards above that depth
 * unfold, cards at it fold, and deeper cards keep their state for when their
 * branch opens again. Returns the cards to fold and to unfold.
 */
export function planLevels(
  data: CanvasData, forest: Forest, rootId: string, level: number,
): { fold: string[]; unfold: string[] } {
  const nodes = nodeIndex(data);
  const fold: string[] = [];
  const unfold: string[] = [];
  for (const id of mapMembers(forest, rootId)) {
    const info = forest.nodes.get(id)!;
    const node = nodes.get(id);
    if (!node || !info.children.length || info.depth > level) continue;
    if (info.depth < level && isCollapsed(node)) unfold.push(id);
    if (info.depth === level && !isCollapsed(node)) fold.push(id);
  }
  return { fold, unfold };
}

/* ------------------------------------------------------------------ */
/* Growing a map                                                       */
/* ------------------------------------------------------------------ */

export interface MapInsertion {
  parentId: string;
  direction: Flow;
  x: number;
  y: number;
}

/**
 * A provisional slot for a new card: next to its parent, and ordered right
 * after the selected card (sibling), right before it ('before'), or after
 * the last child (child). `side` picks the side of a balanced root for a
 * child. The tidy layout then settles it and its neighbours.
 */
export function planMapInsertion(
  data: CanvasData, forest: Forest, selectedId: string, kind: 'child' | 'sibling' | 'before',
  width: number, height: number, side?: 'left' | 'right',
): MapInsertion | null {
  const nodes = nodeIndex(data);
  const selected = forest.nodes.get(selectedId);
  if (!selected || !nodes.has(selectedId)) return null;
  const parentId = kind === 'child' ? selectedId : selected.parent;
  if (!parentId || !nodes.has(parentId)) return null;
  const parent = nodes.get(parentId)!;
  const parentInfo = forest.nodes.get(parentId)!;
  const balancedRoot = parentInfo.parent === null && mapLayout(parent) === 'balanced';
  let direction = parentInfo.flow;
  if (kind !== 'child') {
    direction = selected.direction;
  } else if (balancedRoot && side) {
    direction = side;
  } else if (balancedRoot) {
    // Grow the lighter side of a balanced map.
    let right = 0;
    let left = 0;
    for (const child of parentInfo.children) {
      const size = 1 + descendants(forest, child).length;
      if (forest.nodes.get(child)!.direction === 'left') left += size; else right += size;
    }
    direction = left < right ? 'left' : 'right';
  }
  const siblings = parentInfo.children
    .filter(id => nodes.has(id) && forest.nodes.get(id)!.direction === direction)
    .map(id => crossCenter(nodes.get(id)!, direction));
  const crossTarget = kind === 'sibling' ? crossCenter(nodes.get(selectedId)!, direction) + 1
    : kind === 'before' ? crossCenter(nodes.get(selectedId)!, direction) - 1
      : siblings.length ? Math.max(...siblings) + 1 : null;
  const gaps = spacingGaps(mapSpacing(nodes.get(parentInfo.root)));
  const middle = center(parent);
  switch (direction) {
    case 'list': return {
      parentId, direction, x: parent.x + parent.width / 2 + gaps.list.indent,
      y: crossTarget !== null ? crossTarget - height / 2 : parent.y + parent.height + gaps.list.main,
    };
    case 'row': return {
      parentId, direction, y: middle.y - height / 2,
      x: crossTarget !== null ? crossTarget - width / 2 : parent.x + parent.width + gaps.row.main,
    };
    case 'column': return {
      parentId, direction, x: middle.x - width / 2,
      y: crossTarget !== null ? crossTarget - height / 2 : parent.y + parent.height + gaps.column.main,
    };
  }
  const target = crossTarget ?? crossCenter(parent, direction);
  const { main } = gaps[isHorizontal(direction) ? 'horizontal' : 'vertical'];
  if (isHorizontal(direction)) {
    return {
      parentId, direction, y: target - height / 2,
      x: direction === 'right' ? parent.x + parent.width + main : parent.x - main - width,
    };
  }
  return {
    parentId, direction, x: target - width / 2,
    y: direction === 'down' ? parent.y + parent.height + main : parent.y - main - height,
  };
}

/**
 * Move a card one place among its siblings on the same side. Returns the
 * provisional position that sorts it past its neighbour, or null at an end.
 */
export function planSiblingMove(data: CanvasData, forest: Forest, id: string, step: -1 | 1): Position | null {
  const nodes = nodeIndex(data);
  const info = forest.nodes.get(id);
  if (!info?.parent || !nodes.has(id)) return null;
  // Screen order, not reading order: a balanced root reads its left side
  // bottom-up, but "up" must still move the card up.
  const siblings = orderedChildren(data, forest, info.parent)
    .filter(sibling => forest.nodes.get(sibling)!.direction === info.direction)
    .sort((a, b) => crossCenter(nodes.get(a)!, info.direction) - crossCenter(nodes.get(b)!, info.direction));
  const index = siblings.indexOf(id);
  const neighbour = siblings[index + step];
  if (index < 0 || !neighbour) return null;
  const node = nodes.get(id)!;
  const target = crossCenter(nodes.get(neighbour)!, info.direction) + step;
  return crossAxis(info.direction) === 'y'
    ? { x: node.x, y: target - node.height / 2 }
    : { x: target - node.width / 2, y: node.y };
}

/** Rainbow branches: each first-level branch takes the next palette color. */
export function planBranchColors(
  data: CanvasData, forest: Forest, rootId: string,
  palette: readonly string[] = ['1', '2', '3', '4', '5', '6'],
): { nodes: Map<string, string>; edges: Map<string, string> } {
  const nodes = new Map<string, string>();
  const edges = new Map<string, string>();
  orderedChildren(data, forest, rootId).forEach((child, index) => {
    const color = palette[index % palette.length];
    for (const id of [child, ...descendants(forest, child)]) {
      nodes.set(id, color);
      const edge = forest.nodes.get(id)!.edge;
      if (edge) edges.set(edge, color);
    }
  });
  return { nodes, edges };
}

/**
 * One color for one branch: the card, everything below it, the connection
 * leading into each of those cards, and the summaries hanging under them.
 * Null clears the color instead.
 */
export function planBranchColor(
  data: CanvasData, forest: Forest, id: string, color: string | null,
): { nodes: Map<string, string | null>; edges: Map<string, string | null> } {
  const nodes = new Map<string, string | null>();
  const edges = new Map<string, string | null>();
  if (!forest.nodes.has(id)) return { nodes, edges };
  const members = [id, ...descendants(forest, id)];
  const summaries = summaryIndex(data, forest);
  for (const member of members) {
    nodes.set(member, color);
    const edge = forest.nodes.get(member)!.edge;
    if (edge) edges.set(edge, color);
    for (const summary of summaries.get(member) ?? []) nodes.set(summary.id, color);
  }
  return { nodes, edges };
}

/** The key that leads into a flow's children: [natural, when that one moves across]. */
const FORWARD: Record<Flow, [Direction, Direction]> = {
  right: ['right', 'right'], left: ['left', 'left'], down: ['down', 'down'], up: ['up', 'up'],
  list: ['right', 'down'], row: ['right', 'down'], column: ['down', 'right'],
};
const OPPOSITE: Record<Direction, Direction> = { left: 'right', right: 'left', up: 'down', down: 'up' };

/**
 * Arrow-key navigation by structure, as in mind-map apps. One key leads into
 * the children (the child nearest the card's middle) and its opposite back
 * to the parent; the keys along the siblings move across — to the nearest
 * card at the same depth on the same side, a sibling or past them a cousin,
 * and in an outline to the next or previous row. Where a key would both
 * move across and lead in or out, moving across wins and the other key
 * takes over: a timeline's events go ←/→ along the line, ↓ into their
 * details and ↑ back to the start.
 */
export function mapNeighbor(
  data: CanvasData, forest: Forest, id: string, key: Direction, hidden: Set<string> = new Set(),
): string | null {
  const nodes = nodeIndex(data);
  const info = forest.nodes.get(id);
  if (!info || !nodes.has(id)) return null;
  const shown = (other: string) => nodes.has(other) && !hidden.has(other);
  const nearestChild = (flow: Flow) => {
    const middle = crossCenter(nodes.get(id)!, flow);
    let best: string | null = null;
    let distance = Infinity;
    for (const child of info.children) {
      if (!shown(child) || forest.nodes.get(child)!.direction !== flow) continue;
      const gap = Math.abs(crossCenter(nodes.get(child)!, flow) - middle);
      if (gap < distance) { distance = gap; best = child; }
    }
    return best;
  };
  const balancedRoot = info.parent === null && mapLayout(nodes.get(id)) === 'balanced';
  if (balancedRoot) return isHorizontal(key) ? nearestChild(key) : null;
  if (info.parent === null) return FORWARD[info.flow].includes(key) ? nearestChild(info.flow) : null;
  const across: Direction[] = crossAxis(info.direction) === 'y' ? ['up', 'down'] : ['left', 'right'];
  const pick = ([natural, other]: [Direction, Direction]) => across.includes(natural) ? other : natural;
  if (key === pick(FORWARD[info.flow])) return nearestChild(info.flow);
  const [natural, other] = FORWARD[info.direction];
  if (key === pick([OPPOSITE[natural], OPPOSITE[other]])) return shown(info.parent) ? info.parent : null;
  if (!across.includes(key)) return null;
  const sign = key === 'up' || key === 'left' ? -1 : 1;
  let best: string | null = null;
  if (info.direction === 'list') {
    // An outline reads row by row, from the card its list hangs from.
    let top = info;
    while (top.direction === 'list' && top.parent) top = forest.nodes.get(top.parent)!;
    const rows: string[] = [];
    const pending = [top.id];
    while (pending.length) {
      const next = pending.pop()!;
      rows.push(next);
      const children = orderedChildren(data, forest, next).filter(shown);
      for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
    }
    best = rows[rows.indexOf(id) + sign] ?? null;
  } else {
    // Across: the nearest card at this depth, on this side, in that direction.
    const here = crossCenter(nodes.get(id)!, info.direction);
    let distance = Infinity;
    for (const [candidate, otherInfo] of forest.nodes) {
      if (candidate === id || otherInfo.root !== info.root || otherInfo.depth !== info.depth
        || otherInfo.direction !== info.direction || !shown(candidate)) continue;
      const delta = (crossCenter(nodes.get(candidate)!, info.direction) - here) * sign;
      if (delta > 0 && delta < distance) { distance = delta; best = candidate; }
    }
  }
  // Before a timeline's first event comes the card the line starts from.
  if (!best && sign < 0 && (info.direction === 'row' || info.direction === 'column') && shown(info.parent)) {
    return info.parent;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Free canvas                                                         */
/* ------------------------------------------------------------------ */

/**
 * Find the nearest vertical translation outside every collision interval.
 * A shared boundary is safe: rectangles retain OBSTACLE_GAP of clearance.
 */
function nearestFreeOffset(intervals: Interval[]): number {
  intervals.sort((a, b) => a.low - b.low || a.high - b.high);
  const merged: Interval[] = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (previous && interval.low < previous.high) previous.high = Math.max(previous.high, interval.high);
    else merged.push({ ...interval });
  }
  for (const interval of merged) {
    if (interval.low < 0 && interval.high > 0) {
      return -interval.low < interval.high ? interval.low : interval.high;
    }
  }
  return 0;
}

/** Rectangles with x and y exchanged, to reuse the vertical search sideways. */
function transpose(node: Rectangle): Rectangle {
  return { x: node.y, y: node.x, width: node.height, height: node.width };
}

/** Offsets along y at which `moving` would collide; `axis: 'x'` searches sideways. */
function collisionIntervals(moving: Rectangle[], obstacles: Rectangle[], axis: 'x' | 'y' = 'y'): Interval[] {
  if (axis === 'x') return collisionIntervals(moving.map(transpose), obstacles.map(transpose));
  const intervals: Interval[] = [];
  for (const node of moving) {
    for (const obstacle of obstacles) {
      if (node.x + node.width + OBSTACLE_GAP <= obstacle.x
        || obstacle.x + obstacle.width + OBSTACLE_GAP <= node.x) continue;
      intervals.push({
        low: obstacle.y - OBSTACLE_GAP - node.y - node.height,
        high: obstacle.y + obstacle.height + OBSTACLE_GAP - node.y,
      });
    }
  }
  return intervals;
}

function growthDirection(data: CanvasData, node: CanvasNodeData): 'left' | 'right' {
  const parentId = findParent(data, node.id);
  if (!parentId) {
    // A root has no incoming edge to describe its orientation. Continue on
    // the existing children’s side when they agree.
    const nodes = nodeIndex(data);
    let direction: 'left' | 'right' | undefined;
    for (const edge of data.edges) {
      if (edge.fromNode !== node.id || edge.toNode === node.id) continue;
      const child = nodes.get(edge.toNode);
      if (!child || !validRectangle(child)) continue;
      const delta = child.x + child.width / 2 - node.x - node.width / 2;
      const side = edge.fromSide === 'left' || edge.fromSide === 'right' ? edge.fromSide
        : delta < 0 ? 'left' : delta > 0 ? 'right' : undefined;
      if (!side || (direction !== undefined && side !== direction)) return 'right';
      direction = side;
    }
    return direction ?? 'right';
  }
  const edge = data.edges.find(candidate => candidate.fromNode === parentId && candidate.toNode === node.id);
  if (edge?.toSide === 'left') return 'right';
  if (edge?.toSide === 'right') return 'left';
  if (edge?.fromSide === 'left' || edge?.fromSide === 'right') return edge.fromSide;
  const parent = data.nodes.find(candidate => candidate.id === parentId)!;
  return node.x + node.width / 2 < parent.x + parent.width / 2 ? 'left' : 'right';
}

/**
 * Place a new card in open space on a free canvas; never alter a group
 * implicitly. Mind maps use planMapInsertion and their tidy layout instead.
 */
export function findNewNodePosition(
  data: CanvasData,
  parentId: string,
  kind: 'child' | 'sibling',
  width = 260,
  height = 120,
): (Position & EdgeSides & { parentId: string }) | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const nodes = nodeIndex(data);
  const groups = data.nodes.filter(node => node.type === 'group');
  const selected = nodes.get(parentId);
  if (!selected || !validRectangle(selected) || isGrouped(groups, selected)) return null;
  const sourceId = kind === 'sibling' ? findParent(data, parentId) : parentId;
  const parent = sourceId ? nodes.get(sourceId) : undefined;
  if (!parent || !validRectangle(parent) || isGrouped(groups, parent)) return null;
  const direction = growthDirection(data, kind === 'sibling' ? selected : parent);
  const x = direction === 'right' ? parent.x + parent.width + HORIZONTAL_GAP
    : parent.x - HORIZONTAL_GAP - width;
  let y = parent.y + (parent.height - height) / 2;
  if (kind === 'sibling') y = selected.y + selected.height + SIBLING_GAP;
  else {
    const children = (outgoingIndex(data, nodes).get(parent.id) ?? [])
      .map(edge => nodes.get(edge.toNode)!)
      .filter(child => child.id !== parent.id && validRectangle(child)
        && (direction === 'right' ? child.x >= parent.x + parent.width : child.x + child.width <= parent.x));
    if (children.length) y = children.reduce((bottom, child) => Math.max(bottom, child.y + child.height), -Infinity) + SIBLING_GAP;
  }
  const proposed = { x, y, width, height };
  const obstacles = data.nodes.filter(validRectangle);
  y += nearestFreeOffset(collisionIntervals([proposed], obstacles));
  return { x, y, parentId: parent.id, ...sidesFor(direction) };
}

/**
 * A new free card beside `fromId`, in any direction: centred on it, then
 * slid along the other axis into open space. Groups that hold the source
 * card are not obstacles, so a card grows inside its own group.
 */
export function planFreeCard(
  data: CanvasData, fromId: string, direction: Direction, width = 260, height = 120,
): (Position & EdgeSides) | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const source = data.nodes.find(node => node.id === fromId);
  if (!source || !validRectangle(source)) return null;
  const horizontal = isHorizontal(direction);
  const position = horizontal ? {
    x: direction === 'right' ? source.x + source.width + HORIZONTAL_GAP : source.x - HORIZONTAL_GAP - width,
    y: source.y + (source.height - height) / 2,
  } : {
    x: source.x + (source.width - width) / 2,
    y: direction === 'down' ? source.y + source.height + VERTICAL_GAP : source.y - VERTICAL_GAP - height,
  };
  const obstacles = data.nodes.filter(node => validRectangle(node)
    && !(node.type === 'group' && contains(node, source)));
  const offset = nearestFreeOffset(collisionIntervals([{ ...position, width, height }], obstacles, horizontal ? 'y' : 'x'));
  if (horizontal) position.y += offset; else position.x += offset;
  return { x: Math.round(position.x), y: Math.round(position.y), ...sidesFor(direction) };
}

/**
 * How tall a card can grow downwards, from its top edge, before it would
 * reach a card below it (keeping `gap` between them) or cross the bottom of
 * the group that holds it. Infinity when nothing is in the way.
 */
export function roomBelow(data: CanvasData, id: string, gap = 24): number {
  const card = data.nodes.find(node => node.id === id);
  if (!card || !validRectangle(card)) return Infinity;
  let room = Infinity;
  for (const other of data.nodes) {
    if (other.id === id || !validRectangle(other)) continue;
    if (other.type === 'group') {
      if (contains(other, card)) room = Math.min(room, other.y + other.height - gap / 2 - card.y);
      continue;
    }
    // Only a card wholly below this one's bottom edge is in the way of growing.
    const across = other.x < card.x + card.width && other.x + other.width > card.x;
    if (across && other.y >= card.y + card.height) room = Math.min(room, other.y - gap - card.y);
  }
  return room;
}

/** Navigate by card centers, preferring cards aligned with the requested axis. */
export function findDirectionalNeighbor(
  data: CanvasData,
  id: string,
  direction: Direction,
): string | null {
  const nodes = nodeIndex(data);
  const source = nodes.get(id);
  if (!source || !validRectangle(source)) return null;
  const horizontal = isHorizontal(direction);
  const sign = direction === 'left' || direction === 'up' ? -1 : 1;
  let bestId: string | null = null;
  let bestScore = Infinity;
  for (const node of nodes.values()) {
    if (node.id === id || !validRectangle(node)) continue;
    const dx = node.x + node.width / 2 - source.x - source.width / 2;
    const dy = node.y + node.height / 2 - source.y - source.height / 2;
    const forward = (horizontal ? dx : dy) * sign;
    if (forward <= 0) continue;
    const cross = Math.abs(horizontal ? dy : dx);
    const score = forward + cross * 2;
    if (score < bestScore) {
      bestScore = score;
      bestId = node.id;
    }
  }
  return bestId;
}
