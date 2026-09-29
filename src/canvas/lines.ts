import type { MapLayout } from "./graph";

/**
 * How a map draws its branch lines. Canvas draws every connection as one
 * kind of curve; mind-map apps offer more, and each suits some structures:
 * tapered "organic" branches for mind maps, elbows for org charts and
 * outlines, straight lines for plain diagrams.
 */
export type LineStyle = "curve" | "elbow" | "straight" | "organic";
/** A map's choice: a style, or "auto" to follow its structure. */
export type LineChoice = LineStyle | "auto";
export const LINE_KEY = "nfLine";
export const LINE_CHOICES: readonly LineChoice[] = ["auto", "organic", "curve", "elbow", "straight"];

type Point = { x: number; y: number };
type Box = { minX: number; minY: number; maxX: number; maxY: number };

export function asLineChoice(value: unknown): LineChoice | null {
  return typeof value === "string" && (LINE_CHOICES as readonly string[]).includes(value) ? value as LineChoice : null;
}

/**
 * What "auto" draws: tapered branches where branches fan out (mind maps and
 * logic charts), elbows where they hang in rows (org charts, trees, and
 * timelines, whose spines stay straight because their elbows have no bend).
 */
export function lineStyleFor(choice: LineChoice, layout: MapLayout): LineStyle {
  if (choice !== "auto") return choice;
  return layout === "balanced" || layout === "left" || layout === "right" ? "organic" : "elbow";
}

/** Organic widths by depth: thick where a branch leaves the centre, fine at its tips. */
const ORGANIC_WIDTHS = [9, 3.6, 2.3, 1.7];

/** Widths at the parent and child ends of a tapered line whose parent is at `depth`. */
export function organicWidths(depth: number, scale = 1): [number, number] {
  const width = (d: number) => ORGANIC_WIDTHS[Math.min(Math.max(d, 0), ORGANIC_WIDTHS.length - 1)] * scale;
  return [width(depth), width(depth + 1)];
}

/** The middle of a card's side, where Canvas attaches a connection. */
export function anchor(box: Box, side: string): Point {
  switch (side) {
    case "top": return { x: (box.minX + box.maxX) / 2, y: box.minY };
    case "bottom": return { x: (box.minX + box.maxX) / 2, y: box.maxY };
    case "left": return { x: box.minX, y: (box.minY + box.maxY) / 2 };
    default: return { x: box.maxX, y: (box.minY + box.maxY) / 2 };
  }
}

export interface LineShape {
  /** What is drawn: a stroke, or a filled outline when `filled`. */
  d: string;
  /** The centre line, which the pointer can grab. */
  spine: string;
  filled: boolean;
}

const horizontal = (side: string) => side === "left" || side === "right";

/** The outward direction of a side. */
function outward(side: string): Point {
  switch (side) {
    case "left": return { x: -1, y: 0 };
    case "top": return { x: 0, y: -1 };
    case "bottom": return { x: 0, y: 1 };
    default: return { x: 1, y: 0 };
  }
}

function num(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function pt(p: Point): string {
  return `${num(p.x)} ${num(p.y)}`;
}

/**
 * The line from `from` to `to` in a style. `widths` are a tapered line's
 * widths at either end. A curve is the tapered line's centre, stroked:
 * Canvas's own curve reaches further the further apart its ends are, so an
 * outer branch bulges past its inner siblings and crosses them near the
 * parent; here the reach is horizontal (or vertical) distance alone, so
 * siblings leave side by side and fan out without braiding.
 */
export function linePath(
  style: LineStyle, from: Point, fromSide: string, to: Point, toSide: string, widths: [number, number] = [2, 2],
): LineShape {
  const straight = `M${pt(from)} L${pt(to)}`;
  if (style === "straight" || (Math.abs(from.x - to.x) < 0.05 && Math.abs(from.y - to.y) < 0.05)) {
    return { d: straight, spine: straight, filled: false };
  }
  if (style === "elbow") {
    const d = roundedPolyline(elbowPoints(from, fromSide, to, toSide), 12);
    return { d, spine: d, filled: false };
  }
  const [c1, c2] = controls(from, fromSide, to, toSide);
  const spine = `M${pt(from)} C${pt(c1)} ${pt(c2)} ${pt(to)}`;
  if (style === "curve") return { d: spine, spine, filled: false };
  return { d: taper(from, c1, c2, to, widths), spine, filled: true };
}

/**
 * Right angles only. Lines between two sides facing the same way turn
 * halfway, so a card's children share one vertical (or horizontal) trunk;
 * lines that leave one way and arrive another turn once.
 */
function elbowPoints(a: Point, fromSide: string, b: Point, toSide: string): Point[] {
  const ah = horizontal(fromSide);
  const bh = horizontal(toSide);
  if (ah && bh) {
    const x = (a.x + b.x) / 2;
    return [a, { x, y: a.y }, { x, y: b.y }, b];
  }
  if (!ah && !bh) {
    const y = (a.y + b.y) / 2;
    return [a, { x: a.x, y }, { x: b.x, y }, b];
  }
  return ah ? [a, { x: b.x, y: a.y }, b] : [a, { x: a.x, y: b.y }, b];
}

/** A polyline whose bends are rounded off by up to `radius`. */
export function roundedPolyline(points: Point[], radius: number): string {
  const pts = points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > 0.05);
  let d = `M${pt(pts[0])}`;
  let pen = pt(pts[0]);
  for (let i = 1; i < pts.length - 1; i++) {
    const [prev, p, next] = [pts[i - 1], pts[i], pts[i + 1]];
    const l1 = Math.hypot(prev.x - p.x, prev.y - p.y);
    const l2 = Math.hypot(next.x - p.x, next.y - p.y);
    const cross = (p.x - prev.x) * (next.y - p.y) - (p.y - prev.y) * (next.x - p.x);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    // Straight through: no bend to round.
    if (Math.abs(cross) < 1e-6 || r < 0.5) continue;
    const enter = pt({ x: p.x + (prev.x - p.x) / l1 * r, y: p.y + (prev.y - p.y) / l1 * r });
    const leave = pt({ x: p.x + (next.x - p.x) / l2 * r, y: p.y + (next.y - p.y) / l2 * r });
    // Two bends back to back meet where one ends and the next begins.
    if (enter !== pen) d += ` L${enter}`;
    d += ` Q${pt(p)} ${leave}`;
    pen = leave;
  }
  return `${d} L${pt(pts[pts.length - 1])}`;
}

/** Control points that leave and enter each card square to its side. */
function controls(a: Point, fromSide: string, b: Point, toSide: string): [Point, Point] {
  const reach = (side: string) => Math.max(12, Math.abs(horizontal(side) ? b.x - a.x : b.y - a.y) * 0.5);
  const da = outward(fromSide);
  const db = outward(toSide);
  const k1 = reach(fromSide);
  const k2 = reach(toSide);
  return [{ x: a.x + da.x * k1, y: a.y + da.y * k1 }, { x: b.x + db.x * k2, y: b.y + db.y * k2 }];
}

function bezier(a: Point, c1: Point, c2: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
  };
}

function tangent(a: Point, c1: Point, c2: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: 3 * u * u * (c1.x - a.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (b.x - c2.x),
    y: 3 * u * u * (c1.y - a.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (b.y - c2.y),
  };
}

const TAPER_SAMPLES = 24;

/**
 * The outline of a curve that thins from `start` to `end` width: a branch
 * that grows out of its parent, as drawn by hand. It narrows quickly after
 * leaving the parent and settles to its end width.
 */
function taper(a: Point, c1: Point, c2: Point, b: Point, [start, end]: [number, number]): string {
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i <= TAPER_SAMPLES; i++) {
    const t = i / TAPER_SAMPLES;
    const p = bezier(a, c1, c2, b, t);
    let d = tangent(a, c1, c2, b, t);
    let length = Math.hypot(d.x, d.y);
    if (length < 1e-9) {
      d = { x: b.x - a.x, y: b.y - a.y };
      length = Math.hypot(d.x, d.y) || 1;
    }
    const eased = 1 - (1 - t) ** 3;
    const half = (start + (end - start) * eased) / 2;
    const nx = -d.y / length * half;
    const ny = d.x / length * half;
    left.push({ x: p.x + nx, y: p.y + ny });
    right.push({ x: p.x - nx, y: p.y - ny });
  }
  return `M${left.map(pt).join(" L")} L${right.reverse().map(pt).join(" L")} Z`;
}
