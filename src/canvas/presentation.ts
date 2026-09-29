import { setIcon } from "obsidian";
import { descendants, mapMembers, orderedChildren, summaryIndex } from "./graph";
import type { CanvasData, CanvasNodeData, Forest } from "./graph";

type Box = { minX: number; minY: number; maxX: number; maxY: number };

/** One stop of a presentation. */
export interface Step {
  /** Cards the view frames. */
  frame: string[];
  /** Cards shown in full; the rest fade back. */
  spotlight: string[];
  /** The card that names the stop. */
  title: string | null;
}

function boxOf(nodes: CanvasNodeData[]): Box | null {
  if (!nodes.length) return null;
  return {
    minX: Math.min(...nodes.map((node) => node.x)),
    minY: Math.min(...nodes.map((node) => node.y)),
    maxX: Math.max(...nodes.map((node) => node.x + node.width)),
    maxY: Math.max(...nodes.map((node) => node.y + node.height)),
  };
}

function inside(outer: CanvasNodeData, inner: CanvasNodeData): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

/**
 * Items in reading order: rows from top to bottom — an item joins a row
 * when its middle lies within the row's first item — each read left to right.
 */
export function readingOrder<T extends { box: Box }>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => a.box.minY - b.box.minY || a.box.minX - b.box.minX);
  const rows: T[][] = [];
  for (const item of sorted) {
    const row = rows[rows.length - 1];
    const middle = (item.box.minY + item.box.maxY) / 2;
    if (row && middle <= row[0].box.maxY) row.push(item);
    else rows.push([item]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.box.minX - b.box.minX));
}

/**
 * A mind map, told branch by branch: the whole map, then each main branch
 * in reading order with the centre still in the light, then the whole map
 * again to close.
 */
export function mapSteps(data: CanvasData, forest: Forest, hidden: Set<string>, rootId: string): Step[] {
  const exists = new Set(data.nodes.map((node) => node.id));
  const shown = (id: string) => exists.has(id) && !hidden.has(id);
  // A branch's summaries are told with it.
  const summaries = summaryIndex(data, forest);
  const withSummaries = (ids: string[]) => ids.flatMap((id) => [id, ...(summaries.get(id) ?? []).map((summary) => summary.id)]).filter(shown);
  const members = withSummaries(mapMembers(forest, rootId));
  if (!members.length) return [];
  const overview: Step = { frame: members, spotlight: members, title: rootId };
  const steps = [overview];
  for (const child of orderedChildren(data, forest, rootId)) {
    if (!shown(child)) continue;
    const branch = withSummaries([child, ...descendants(forest, child)]);
    steps.push({ frame: branch, spotlight: [rootId, ...branch], title: child });
  }
  if (steps.length > 1) steps.push({ ...overview });
  return steps;
}

/**
 * A whole canvas, told as slides: everything, then each group, mind map,
 * and loose card in reading order, and everything again to close. A group's
 * slide holds what lies in it; a mind map is told branch by branch. A canvas
 * that is one map is told exactly as that map; one card or group needs no
 * slides beyond the overview.
 */
export function canvasSteps(data: CanvasData, forest: Forest, hidden: Set<string>): Step[] {
  const visible = data.nodes.filter((node) => !hidden.has(node.id));
  if (!visible.length) return [];
  const groups = visible.filter((node) => node.type === "group");
  const grouped = (node: CanvasNodeData) => groups.some((group) => group !== node && inside(group, node));
  const items: { box: Box; steps: Step[]; map?: string }[] = [];
  for (const group of groups) {
    if (grouped(group)) continue;
    const members = visible.filter((node) => node === group || inside(group, node)).map((node) => node.id);
    items.push({ box: boxOf([group])!, steps: [{ frame: [group.id], spotlight: members, title: group.id }] });
  }
  const byId = new Map(visible.map((node) => [node.id, node]));
  for (const root of forest.roots) {
    const node = byId.get(root);
    if (!node || grouped(node)) continue;
    const members = mapMembers(forest, root).filter((id) => byId.has(id));
    const steps = mapSteps(data, forest, hidden, root);
    if (steps.length) items.push({ box: boxOf(members.map((id) => byId.get(id)!))!, steps, map: root });
  }
  // A summary is told with the branches it sums up, when its map is told: it is no loose card.
  const toldMaps = new Set(items.map((item) => item.map));
  const summarised = new Set([...summaryIndex(data, forest).values()].flat()
    .filter((summary) => toldMaps.has(forest.nodes.get(summary.parent)?.root)).map((summary) => summary.id));
  for (const node of visible) {
    if (node.type === "group" || forest.nodes.has(node.id) || grouped(node) || summarised.has(node.id)) continue;
    items.push({ box: boxOf([node])!, steps: [{ frame: [node.id], spotlight: [node.id], title: node.id }] });
  }
  const ordered = readingOrder(items);
  if (ordered.length === 1 && ordered[0].map) return ordered[0].steps;
  const all = visible.map((node) => node.id);
  const overview: Step = { frame: all, spotlight: all, title: null };
  if (ordered.length < 2) return [overview];
  // Among other items a map keeps its overview and branches; the canvas closes.
  const told = ordered.flatMap((item) => item.map && item.steps.length > 1 ? item.steps.slice(0, -1) : item.steps);
  return [overview, ...told, { ...overview }];
}

/** The viewport controls of a live Canvas the stage drives. */
export interface StageHost {
  wrapperEl: HTMLElement;
  canvasRect?: { width: number; height: number };
  x?: number;
  y?: number;
  zoom?: number;
  tx?: number;
  ty?: number;
  tZoom?: number;
  zoomCenter?: unknown;
  markViewportChanged?(): void;
  zoomToBbox?(box: Box): void;
  onResize?(): void;
  deselectAll?(): void;
}

export interface StageLabels {
  /** The caption of a stop that shows everything. */
  overview: string;
  previous: string;
  next: string;
  fullscreen: string;
  exit: string;
  stage: string;
}

/** Room kept for the stage bar below the framed cards, in screen pixels. */
const BAR_ROOM = 72;
/** Closest a stop zooms in: a little past life size, for small branches. */
const MAX_SCALE = 1.5;

/**
 * Presenting a canvas: the view glides from stop to stop, what the stop is
 * about stays in the light, and a small bar shows where you are. Nothing is
 * written to the canvas; leaving returns the view to where it was.
 */
export class Stage {
  readonly el: HTMLElement;
  index = 0;
  private count: HTMLElement;
  private caption: HTMLElement;
  private previousButton: HTMLButtonElement;
  private nextButton: HTMLButtonElement;
  private saved: { x: number; y: number; zoom: number } | null = null;
  private overview: string;
  private fullscreen = false;
  private frame = 0;
  private readonly doc: Document;

  constructor(
    private host: StageHost,
    private steps: Step[],
    /** What framing these cards takes, as they are now: null once they are gone. */
    private extent: (ids: string[]) => Box | null,
    /** The text a stop's title card shows. */
    private titleOf: (id: string) => string,
    labels: StageLabels,
    /** Called whenever the stop changes, so the canvas can re-light its cards. */
    private changed: () => void,
    /** Called once the stage wants to close, from its bar or a key. */
    private close: () => void,
  ) {
    const doc = host.wrapperEl.ownerDocument;
    this.doc = doc;
    this.overview = labels.overview;
    this.el = doc.createElement("div");
    this.el.className = "nf-canvas-stage nf-canvas-ui";
    this.el.setAttribute("role", "toolbar");
    this.el.setAttribute("aria-label", labels.stage);
    const button = (label: string, icon: string, onClick: () => void) => {
      const el = doc.createElement("button");
      el.type = "button";
      el.className = "nf-canvas-stage-button";
      el.setAttribute("aria-label", label);
      setIcon(el, icon);
      el.addEventListener("click", (evt) => {
        evt.stopPropagation();
        onClick();
      });
      return el;
    };
    this.previousButton = button(labels.previous, "chevron-left", () => this.go(this.index - 1));
    this.nextButton = button(labels.next, "chevron-right", () => this.go(this.index + 1));
    this.count = doc.createElement("span");
    this.count.className = "nf-canvas-stage-count";
    this.caption = doc.createElement("span");
    this.caption.className = "nf-canvas-stage-title";
    const divider = doc.createElement("span");
    divider.className = "nf-canvas-stage-divider";
    this.el.append(
      this.previousButton, this.count, this.nextButton, this.caption, divider,
      button(labels.fullscreen, "maximize-2", () => this.toggleFullscreen()),
      button(labels.exit, "x", () => this.close()),
    );
    for (const event of ["pointerdown", "mousedown", "dblclick", "wheel"]) {
      this.el.addEventListener(event, (evt) => evt.stopPropagation());
    }
  }

  get length(): number {
    return this.steps.length;
  }

  /** The cards in the light at this stop. */
  get spotlight(): Set<string> {
    return new Set(this.steps[this.index]?.spotlight ?? []);
  }

  start(at = 0) {
    const host = this.host;
    if (typeof host.x === "number" && typeof host.y === "number" && typeof host.zoom === "number") {
      this.saved = { x: host.x, y: host.y, zoom: host.zoom };
    }
    host.deselectAll?.();
    host.wrapperEl.append(this.el);
    this.doc.addEventListener("fullscreenchange", this.onFullscreen);
    this.go(at);
  }

  /** Go to a stop; past either end stays at the end. */
  go(index: number) {
    const next = Math.min(Math.max(index, 0), this.steps.length - 1);
    this.index = next;
    const step = this.steps[next];
    this.count.textContent = `${next + 1} / ${this.steps.length}`;
    // How far along the talk is, for the bar's progress track.
    this.el.style.setProperty("--nf-stage-progress", String(Math.round((next + 1) / Math.max(1, this.steps.length) * 1000) / 1000));
    // Every stop has a caption, in a fixed width, so the bar never shifts
    // under a pointer clicking through it.
    this.caption.textContent = (step?.title ? this.titleOf(step.title) : "") || this.overview;
    this.previousButton.disabled = next === 0;
    this.nextButton.disabled = next === this.steps.length - 1;
    this.changed();
    this.show();
  }

  /** The stop about a card: the closest one that frames it, the earliest of equals. */
  stepOf(id: string): number {
    let best = -1;
    this.steps.forEach((step, index) => {
      if (step.frame.includes(id) && (best < 0 || step.frame.length < this.steps[best].frame.length)) best = index;
    });
    return best;
  }

  /** Frame the current stop. */
  show() {
    const step = this.steps[this.index];
    const box = step ? this.extent(step.frame) : null;
    if (box) this.frameBox(box);
  }

  private frameBox(box: Box) {
    const host = this.host;
    const rect = host.canvasRect;
    if (!rect?.width || !rect.height || typeof host.markViewportChanged !== "function" || typeof host.tZoom !== "number") {
      host.zoomToBbox?.(box);
      return;
    }
    const width = Math.max(1, box.maxX - box.minX);
    const height = Math.max(1, box.maxY - box.minY);
    const room = Math.max(1, rect.height - BAR_ROOM);
    const scale = Math.min(MAX_SCALE, Math.max(1 / 16, Math.min(rect.width / (width * 1.12), room / (height * 1.12))));
    host.tx = (box.minX + box.maxX) / 2;
    // Centre the cards in the room above the bar.
    host.ty = (box.minY + box.maxY) / 2 + BAR_ROOM / 2 / scale;
    host.tZoom = Math.log2(scale);
    host.zoomCenter = null;
    host.markViewportChanged();
  }

  handleKey(key: string, shift = false): boolean {
    switch (key) {
      case "ArrowRight": case "ArrowDown": case "PageDown": case "Enter":
        this.go(this.index + 1);
        return true;
      case " ":
        this.go(this.index + (shift ? -1 : 1));
        return true;
      case "ArrowLeft": case "ArrowUp": case "PageUp": case "Backspace":
        this.go(this.index - 1);
        return true;
      case "Home": this.go(0); return true;
      case "End": this.go(this.steps.length - 1); return true;
      case "f": case "F": this.toggleFullscreen(); return true;
      case "Escape": this.close(); return true;
    }
    return false;
  }

  toggleFullscreen() {
    const doc = this.doc as Document & { fullscreenElement?: Element | null; exitFullscreen?(): Promise<void> };
    if (doc.fullscreenElement) {
      void doc.exitFullscreen?.()?.catch?.(() => {});
      return;
    }
    const request = (this.host.wrapperEl as HTMLElement & { requestFullscreen?(): Promise<void> }).requestFullscreen;
    if (typeof request !== "function") return;
    this.fullscreen = true;
    void request.call(this.host.wrapperEl)?.catch?.(() => { this.fullscreen = false; });
  }

  private onFullscreen = () => {
    const doc = this.doc as Document & { fullscreenElement?: Element | null };
    this.fullscreen = doc.fullscreenElement === this.host.wrapperEl;
    this.el.classList.toggle("is-fullscreen", this.fullscreen);
    // The canvas measures itself on resize; reframe once it has.
    const win = this.doc.defaultView;
    if (!win) return;
    if (this.frame) win.cancelAnimationFrame(this.frame);
    this.frame = win.requestAnimationFrame(() => {
      this.frame = 0;
      this.host.onResize?.();
      this.show();
    });
  };

  /** Take the bar down and return the view to where it was. */
  destroy() {
    this.doc.removeEventListener("fullscreenchange", this.onFullscreen);
    const win = this.doc.defaultView;
    if (this.frame) win?.cancelAnimationFrame(this.frame);
    this.frame = 0;
    const doc = this.doc as Document & { fullscreenElement?: Element | null; exitFullscreen?(): Promise<void> };
    if (doc.fullscreenElement === this.host.wrapperEl) {
      // Leaving full screen resizes the canvas again, after the stage is gone.
      const resized = () => {
        doc.removeEventListener("fullscreenchange", resized);
        win?.requestAnimationFrame(() => this.host.onResize?.());
      };
      doc.addEventListener("fullscreenchange", resized);
      void doc.exitFullscreen?.()?.catch?.(() => doc.removeEventListener("fullscreenchange", resized));
    }
    this.el.remove();
    const host = this.host;
    if (this.saved && typeof host.markViewportChanged === "function" && typeof host.tZoom === "number") {
      host.tx = this.saved.x;
      host.ty = this.saved.y;
      host.tZoom = this.saved.zoom;
      host.zoomCenter = null;
      host.markViewportChanged();
    }
  }
}
