export type Box = { minX: number; minY: number; maxX: number; maxY: number };

/** The viewport parts of a live Canvas the minimap reads and drives. */
export interface MinimapHost {
  wrapperEl: HTMLElement;
  canvasEl: HTMLElement;
  x: number;
  y: number;
  tx: number;
  ty: number;
  getViewportBBox(): Box;
  markViewportChanged(): void;
  panTo?(x: number, y: number): void;
}

export function minimapSupported(value: unknown): value is MinimapHost {
  const c = value as Partial<MinimapHost> | undefined;
  return !!c && !!c.canvasEl && typeof c.canvasEl.setAttribute === "function"
    && typeof c.getViewportBBox === "function" && typeof c.markViewportChanged === "function"
    && typeof c.x === "number" && typeof c.y === "number";
}

export interface MinimapFrame {
  /** World bounds shown, and how they map to minimap pixels. */
  bounds: Box;
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Fit the content and the viewport together into the minimap, keeping their
 * proportions and centring them, so the viewport frame is always visible.
 */
export function minimapFrame(content: Box | null, viewport: Box, width: number, height: number, padding = 8): MinimapFrame {
  const bounds = content ? {
    minX: Math.min(content.minX, viewport.minX), minY: Math.min(content.minY, viewport.minY),
    maxX: Math.max(content.maxX, viewport.maxX), maxY: Math.max(content.maxY, viewport.maxY),
  } : { ...viewport };
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.max(1e-6, Math.min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY));
  return {
    bounds, scale,
    offsetX: (width - spanX * scale) / 2,
    offsetY: (height - spanY * scale) / 2,
  };
}

export function toMinimap(frame: MinimapFrame, x: number, y: number): { x: number; y: number } {
  return { x: (x - frame.bounds.minX) * frame.scale + frame.offsetX, y: (y - frame.bounds.minY) * frame.scale + frame.offsetY };
}

export function fromMinimap(frame: MinimapFrame, x: number, y: number): { x: number; y: number } {
  return { x: (x - frame.offsetX) / frame.scale + frame.bounds.minX, y: (y - frame.offsetY) / frame.scale + frame.bounds.minY };
}

/** Whether everything is already on screen, so the minimap would add nothing. */
export function fitsViewport(content: Box | null, viewport: Box): boolean {
  return !content || (content.minX >= viewport.minX && content.minY >= viewport.minY
    && content.maxX <= viewport.maxX && content.maxY <= viewport.maxY);
}

export interface MinimapItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** A Canvas color: "1"–"6" or a hex value. */
  color?: string;
  kind: "group" | "card" | "root";
  muted?: boolean;
}

const SVG = "http://www.w3.org/2000/svg";
const WIDTH = 200;
const HEIGHT = 132;
/** How long the minimap shows after a jump, when it would otherwise stay hidden. */
const PEEK_MS = 1500;

/**
 * An overview of the whole canvas in a corner: every card, the part on
 * screen, and a way to get anywhere with one click or drag. It appears only
 * when something is off screen.
 */
export class Minimap {
  readonly el: HTMLElement;
  private svg: SVGSVGElement;
  private itemsEl: SVGGElement;
  private viewportEl: SVGRectElement;
  private items: MinimapItem[] = [];
  private key: string | null = null;
  /** Each card's mark, so a selection can be shown without redrawing. */
  private rects = new Map<string, SVGRectElement>();
  private selection = new Set<string>();
  private peekTimer = 0;
  private content: Box | null = null;
  private frame: MinimapFrame | null = null;
  /** The frame is held still while the viewport is dragged across it. */
  private held: MinimapFrame | null = null;
  private pointerId: number | null = null;
  private observer: MutationObserver;
  private pending = 0;
  private readonly win: Window & typeof globalThis;

  constructor(private host: MinimapHost, label: string) {
    const doc = host.wrapperEl.ownerDocument;
    this.win = doc.defaultView as Window & typeof globalThis;
    this.el = doc.createElement("div");
    this.el.className = "nf-canvas-minimap nf-canvas-ui is-idle";
    this.svg = doc.createElementNS(SVG, "svg") as SVGSVGElement;
    // Named for screen readers through the SVG itself: an aria-label on the
    // container would make Obsidian pop a tooltip over it on every hover.
    this.svg.setAttribute("role", "img");
    const title = doc.createElementNS(SVG, "title");
    title.textContent = label;
    this.svg.append(title);
    this.svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
    this.svg.setAttribute("width", String(WIDTH));
    this.svg.setAttribute("height", String(HEIGHT));
    this.itemsEl = doc.createElementNS(SVG, "g") as SVGGElement;
    this.viewportEl = doc.createElementNS(SVG, "rect") as SVGRectElement;
    this.viewportEl.setAttribute("class", "nf-canvas-minimap-viewport");
    this.viewportEl.setAttribute("rx", "3");
    this.svg.append(this.itemsEl, this.viewportEl);
    this.el.append(this.svg);
    for (const event of ["mousedown", "click", "dblclick", "contextmenu"]) {
      this.el.addEventListener(event, (evt) => {
        evt.stopPropagation();
        evt.preventDefault();
      });
    }
    this.el.addEventListener("pointerdown", this.onPointerDown);
    this.el.addEventListener("pointermove", this.onPointerMove);
    this.el.addEventListener("pointerup", this.onPointerUp);
    this.el.addEventListener("pointercancel", this.onPointerUp);
    host.wrapperEl.append(this.el);
    // Canvas moves its viewport by rewriting one transform; follow it.
    this.observer = new this.win.MutationObserver(() => this.syncSoon());
    this.observer.observe(host.canvasEl, { attributes: true, attributeFilter: ["style"] });
  }

  /** Cards to show; `key` changes whenever any of them does. */
  setItems(items: MinimapItem[], key: string) {
    if (key === this.key) return;
    this.key = key;
    this.items = items;
    let content: Box | null = null;
    for (const item of items) {
      if (!content) content = { minX: item.x, minY: item.y, maxX: item.x + item.width, maxY: item.y + item.height };
      else {
        content.minX = Math.min(content.minX, item.x);
        content.minY = Math.min(content.minY, item.y);
        content.maxX = Math.max(content.maxX, item.x + item.width);
        content.maxY = Math.max(content.maxY, item.y + item.height);
      }
    }
    this.content = content;
    this.frame = null;
    this.drawItems();
    this.sync();
  }

  /** The cards selected on the canvas, marked on the overview too. */
  setSelection(ids: Set<string>) {
    this.selection = new Set(ids);
    for (const [id, rect] of this.rects) rect.classList.toggle("is-selected", ids.has(id));
  }

  /** Show the minimap for a moment after a jump, even while everything fits on screen. */
  peek(duration = PEEK_MS) {
    this.el.classList.add("is-peek");
    if (this.peekTimer) this.win.clearTimeout(this.peekTimer);
    this.peekTimer = this.win.setTimeout(() => {
      this.peekTimer = 0;
      this.el.classList.remove("is-peek");
    }, duration);
  }

  private syncSoon() {
    if (this.pending) return;
    this.pending = this.win.requestAnimationFrame(() => {
      this.pending = 0;
      this.sync();
    });
  }

  sync() {
    const viewport = this.host.getViewportBBox();
    if (![viewport.minX, viewport.minY, viewport.maxX, viewport.maxY].every(Number.isFinite)) return;
    const idle = fitsViewport(this.content, viewport) && this.pointerId === null;
    this.el.classList.toggle("is-idle", idle);
    if (idle && this.frame) return;
    const frame = this.held ?? minimapFrame(this.content, viewport, WIDTH, HEIGHT);
    if (!this.frame || !sameFrame(frame, this.frame)) {
      this.frame = frame;
      // Cards are drawn in canvas units; one transform fits them in.
      this.itemsEl.setAttribute("transform",
        `translate(${fixed(frame.offsetX)} ${fixed(frame.offsetY)}) scale(${frame.scale}) translate(${-frame.bounds.minX} ${-frame.bounds.minY})`);
    }
    const a = toMinimap(frame, viewport.minX, viewport.minY);
    const b = toMinimap(frame, viewport.maxX, viewport.maxY);
    // Clip to the minimap so a far-away viewport still shows as a frame.
    const x = Math.max(-2, Math.min(WIDTH, a.x));
    const y = Math.max(-2, Math.min(HEIGHT, a.y));
    this.viewportEl.setAttribute("x", fixed(x));
    this.viewportEl.setAttribute("y", fixed(y));
    this.viewportEl.setAttribute("width", fixed(Math.max(2, Math.min(WIDTH + 2, b.x) - x)));
    this.viewportEl.setAttribute("height", fixed(Math.max(2, Math.min(HEIGHT + 2, b.y) - y)));
  }

  private drawItems() {
    const doc = this.el.ownerDocument;
    const rects: SVGRectElement[] = [];
    this.rects = new Map();
    // Groups first, so cards draw over them.
    const ordered = [...this.items.filter((item) => item.kind === "group"), ...this.items.filter((item) => item.kind !== "group")];
    for (const item of ordered) {
      const rect = doc.createElementNS(SVG, "rect") as SVGRectElement;
      rect.setAttribute("x", String(item.x));
      rect.setAttribute("y", String(item.y));
      rect.setAttribute("width", String(item.width));
      rect.setAttribute("height", String(item.height));
      rect.setAttribute("rx", item.kind === "group" ? "16" : "10");
      const classes = [`nf-canvas-minimap-${item.kind}`];
      if (item.muted) classes.push("is-muted");
      if (this.selection.has(item.id)) classes.push("is-selected");
      if (item.color && /^[1-6]$/.test(item.color)) classes.push(`mod-canvas-color-${item.color}`, "is-themed");
      else if (item.color) {
        classes.push("is-themed");
        rect.style.setProperty("--canvas-color", item.color);
      }
      rect.setAttribute("class", classes.join(" "));
      rects.push(rect);
      this.rects.set(item.id, rect);
    }
    this.itemsEl.replaceChildren(...rects);
  }

  private point(evt: PointerEvent): { x: number; y: number } | null {
    const frame = this.held ?? this.frame;
    if (!frame) return null;
    const box = this.svg.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    const x = (evt.clientX - box.left) * (WIDTH / box.width);
    const y = (evt.clientY - box.top) * (HEIGHT / box.height);
    return fromMinimap(frame, x, y);
  }

  private onPointerDown = (evt: PointerEvent) => {
    evt.stopPropagation();
    if (evt.button !== 0 || this.el.classList.contains("is-idle")) return;
    evt.preventDefault();
    this.held = this.frame;
    const target = this.point(evt);
    if (!target) return;
    this.pointerId = evt.pointerId;
    this.el.setPointerCapture?.(evt.pointerId);
    this.el.classList.add("is-dragging");
    // A click glides there with Canvas's own easing.
    this.host.tx = target.x;
    this.host.ty = target.y;
    this.host.markViewportChanged();
  };

  private onPointerMove = (evt: PointerEvent) => {
    if (evt.pointerId !== this.pointerId) return;
    evt.stopPropagation();
    const target = this.point(evt);
    if (!target) return;
    // A drag follows the pointer exactly.
    if (typeof this.host.panTo === "function") this.host.panTo(target.x, target.y);
    else {
      this.host.tx = target.x;
      this.host.ty = target.y;
      this.host.markViewportChanged();
    }
  };

  private onPointerUp = (evt: PointerEvent) => {
    if (evt.pointerId !== this.pointerId) return;
    evt.stopPropagation();
    this.el.releasePointerCapture?.(evt.pointerId);
    this.pointerId = null;
    this.held = null;
    this.el.classList.remove("is-dragging");
    this.frame = null;
    this.sync();
  };

  destroy() {
    this.observer.disconnect();
    if (this.pending) this.win.cancelAnimationFrame(this.pending);
    if (this.peekTimer) this.win.clearTimeout(this.peekTimer);
    this.peekTimer = 0;
    this.el.remove();
  }
}

function fixed(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function sameFrame(a: MinimapFrame, b: MinimapFrame): boolean {
  return a.scale === b.scale && a.offsetX === b.offsetX && a.offsetY === b.offsetY
    && a.bounds.minX === b.bounds.minX && a.bounds.minY === b.bounds.minY;
}
