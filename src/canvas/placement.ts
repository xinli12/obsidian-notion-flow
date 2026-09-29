/**
 * Where the canvas's floating panels go, and how the view moves to make room
 * for them. Pure geometry: screen boxes in CSS pixels, views as a centre in
 * canvas units plus Canvas's zoom (the log2 of its scale).
 */

/** A box in canvas units. */
export interface Box { minX: number; minY: number; maxX: number; maxY: number }
/** What Canvas shows: the canvas point at the middle of the wrapper, and log2 of the scale. */
export interface ViewState { x: number; y: number; zoom: number }
export interface ScreenRect { left: number; top: number; right: number; bottom: number }
export type Side = "right" | "left" | "below" | "above";

/**
 * A view (centre + log2 zoom) that shows `box` inside the area minus `insets`
 * (screen px) with `pad` px to spare, zooming OUT only (never in) and never
 * below `minZoom`; null when `box` already fits there.
 */
export function roomyView(box: Box, view: ViewState, area: { width: number; height: number },
  insets: { top: number; right: number; bottom: number; left: number }, pad = 24, minZoom = -4): ViewState | null {
  const scale = 2 ** view.zoom;
  const { width, height } = area;
  const fits = box.minX >= view.x - width / 2 / scale + (insets.left + pad) / scale
    && box.maxX <= view.x + width / 2 / scale - (insets.right + pad) / scale
    && box.minY >= view.y - height / 2 / scale + (insets.top + pad) / scale
    && box.maxY <= view.y + height / 2 / scale - (insets.bottom + pad) / scale;
  if (fits) return null;
  const freeWidth = width - insets.left - insets.right - 2 * pad;
  const freeHeight = height - insets.top - insets.bottom - 2 * pad;
  if (!(freeWidth > 0) || !(freeHeight > 0)) return null;
  const needed = Math.min(scale, freeWidth / Math.max(box.maxX - box.minX, 1e-6), freeHeight / Math.max(box.maxY - box.minY, 1e-6));
  // Out as far as needed, but not past the floor, and never in.
  const next = Math.min(scale, Math.max(2 ** minZoom, needed));
  return {
    x: (box.minX + box.maxX) / 2 - (insets.left - insets.right) / 2 / next,
    y: (box.minY + box.maxY) / 2 - (insets.top - insets.bottom) / 2 / next,
    zoom: Math.log2(next),
  };
}

/** Whether two views are the same to within one screen pixel and 0.001 zoom. */
export function sameView(a: ViewState, b: ViewState, scale: number): boolean {
  return Math.abs(a.x - b.x) * scale <= 1 && Math.abs(a.y - b.y) * scale <= 1 && Math.abs(a.zoom - b.zoom) <= 0.001;
}

/**
 * Where a popover of `size` goes beside `card`: the side away from
 * `awayFromX` first, then the other side, below, above; failing all, the
 * side it overhangs least. `bounds` is where it may be (screen px), and the
 * result is always clamped into it, so a card scrolled out of view leaves its
 * popover at the nearest edge (as Canvas's own card menu does) instead of
 * following it out of the wrapper.
 */
export function anchorBeside(card: ScreenRect, awayFromX: number, size: { width: number; height: number },
  bounds: ScreenRect, gap = 12): { left: number; top: number; side: Side } {
  const { width, height } = size;
  const cx = (card.left + card.right) / 2;
  const cy = (card.top + card.bottom) / 2;
  const clampX = (x: number) => Math.max(bounds.left, Math.min(x, bounds.right - width));
  const clampY = (y: number) => Math.max(bounds.top, Math.min(y, bounds.bottom - height));
  const room: Record<Side, number> = {
    right: bounds.right - card.right - gap,
    left: card.left - gap - bounds.left,
    below: bounds.bottom - card.bottom - gap,
    above: card.top - gap - bounds.top,
  };
  const need = (side: Side) => side === "right" || side === "left" ? width : height;
  const place = (side: Side) => {
    switch (side) {
      case "right": return { left: card.right + gap, top: clampY(cy - height / 2), side };
      case "left": return { left: card.left - gap - width, top: clampY(cy - height / 2), side };
      case "below": return { left: clampX(cx - width / 2), top: card.bottom + gap, side };
      case "above": return { left: clampX(cx - width / 2), top: card.top - gap - height, side };
    }
  };
  const away: Side = cx >= awayFromX ? "right" : "left";
  const order: Side[] = [away, away === "right" ? "left" : "right", "below", "above"];
  const clamped = (side: Side) => {
    const spot = place(side);
    return { left: clampX(spot.left), top: clampY(spot.top), side };
  };
  // A side "fits" by the room between the card and the far edge; for an
  // on-screen card that placement is already inside, and the clamp is a no-op.
  for (const side of order) if (room[side] >= need(side)) return clamped(side);
  return clamped(order.reduce((best, next) => room[next] - need(next) > room[best] - need(best) ? next : best));
}

/** How far (px, ≥ 0) to pan a map left so it clears a side panel; 0 when they do not overlap. */
export function panelShift(map: ScreenRect, panel: ScreenRect, wrapper: ScreenRect, margin = 24): number {
  if (map.bottom <= panel.top || map.top >= panel.bottom) return 0;
  const overlap = map.right - panel.left;
  if (overlap <= 0) return 0;
  // The map's own left edge stays on screen.
  const shift = Math.round(Math.max(0, Math.min(overlap + margin, map.left - (wrapper.left + margin))));
  return shift < 2 ? 0 : shift;
}
