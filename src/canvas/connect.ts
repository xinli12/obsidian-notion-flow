import type { CanvasData, EdgeSides, Forest, Position, Rectangle, Side } from "./graph";

/**
 * A connection drawn with the connect tool between cards of a mind map. It
 * names a relationship and never makes one card the other's child, so a
 * map keeps its structure however many cross-links it gains. Labelled
 * connections are relations too (see isRelation in graph.ts).
 */
export const RELATION_KEY = "nfRelation";

/** How a connection is drawn: an ordinary arrow, or a relation line. */
export type ConnectionKind = "arrow" | "relation";

function centre(rect: Rectangle): Position {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * The sides a connection leaves and enters, from where the cards are: the
 * facing sides along the axis the cards are further apart on.
 */
export function connectionSides(from: Rectangle, to: Rectangle): EdgeSides {
  const a = centre(from);
  const b = centre(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { fromSide: "right", toSide: "left" } : { fromSide: "left", toSide: "right" };
  }
  return dy >= 0 ? { fromSide: "bottom", toSide: "top" } : { fromSide: "top", toSide: "bottom" };
}

/** The side of `rect` that faces `point`. */
export function sideToward(rect: Rectangle, point: Position): EdgeSides["fromSide"] {
  return connectionSides(rect, { x: point.x, y: point.y, width: 0, height: 0 }).fromSide;
}

/**
 * Whether the two cards are already joined, in either direction. A second
 * connection between the same cards would only draw over the first.
 */
export function alreadyConnected(data: CanvasData, a: string, b: string): boolean {
  return data.edges.some((edge) => (edge.fromNode === a && edge.toNode === b) || (edge.fromNode === b && edge.toNode === a));
}

/** A connection ready to be given an id and imported. */
export interface ConnectionEdge {
  fromNode: string;
  toNode: string;
  fromSide: Side;
  toSide: Side;
  [key: string]: unknown;
}

export interface ConnectionPlan {
  edge: ConnectionEdge;
  kind: ConnectionKind;
}

/**
 * The connection the connect tool makes from one card to another: a plain
 * arrow between free cards, a relation line whenever either card belongs to
 * a mind map. Null when there is nothing to connect: the same card, a
 * missing card, a group, or a pair that is already connected.
 */
export function planConnection(data: CanvasData, forest: Forest, fromId: string, toId: string): ConnectionPlan | null {
  if (fromId === toId) return null;
  const from = data.nodes.find((node) => node.id === fromId);
  const to = data.nodes.find((node) => node.id === toId);
  if (!from || !to || from.type === "group" || to.type === "group") return null;
  if (alreadyConnected(data, fromId, toId)) return null;
  const relation = forest.nodes.has(fromId) || forest.nodes.has(toId);
  const edge: ConnectionEdge = { fromNode: fromId, toNode: toId, ...connectionSides(from, to) };
  if (relation) edge[RELATION_KEY] = true;
  return { edge, kind: relation ? "relation" : "arrow" };
}

/**
 * Connect several cards in the order they were selected, each to the next,
 * skipping pairs that are already connected.
 */
export function planChain(data: CanvasData, forest: Forest, ids: readonly string[]): ConnectionPlan[] {
  const plans: ConnectionPlan[] = [];
  let seen: CanvasData = data;
  for (let index = 0; index + 1 < ids.length; index++) {
    const plan = planConnection(seen, forest, ids[index], ids[index + 1]);
    if (!plan) continue;
    plans.push(plan);
    seen = { ...seen, edges: [...seen.edges, { id: `pending-${index}`, ...plan.edge }] };
  }
  return plans;
}

/** A dashed preview curve from a card's side to the pointer, in canvas units. */
export function previewPath(from: Position, fromSide: EdgeSides["fromSide"], to: Position): string {
  const reach = Math.max(40, Math.min(120, Math.hypot(to.x - from.x, to.y - from.y) / 2));
  const out = fromSide === "right" ? { x: reach, y: 0 } : fromSide === "left" ? { x: -reach, y: 0 }
    : fromSide === "bottom" ? { x: 0, y: reach } : { x: 0, y: -reach };
  const c1 = { x: from.x + out.x, y: from.y + out.y };
  const c2 = { x: to.x - out.x / 2, y: to.y - out.y / 2 };
  const round = (value: number) => Math.round(value * 10) / 10;
  return `M${round(from.x)} ${round(from.y)} C${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(to.x)} ${round(to.y)}`;
}
