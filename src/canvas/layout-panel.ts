import { setIcon } from "obsidian";
import { t } from "../i18n";
import type { MapAlign, MapLayout, MapSpacing } from "./graph";

/** What the panel shows for the map it arranges; null when there is none. */
export interface LayoutPanelState {
  layout: MapLayout;
  /**
   * The selected branch's own structure, "inherit" when it follows the map,
   * or null when no branch (a root, a free card, nothing) is selected.
   */
  branch: MapLayout | "inherit" | null;
  align: MapAlign;
  spacing: MapSpacing;
  canRelease: boolean;
}

/** An arrangement shown on the canvas as ghosts without being saved. */
export interface LayoutPatch {
  layout?: MapLayout;
  branch?: MapLayout | "inherit";
  align?: MapAlign;
  spacing?: MapSpacing;
}

export interface LayoutPanelHost {
  state(): LayoutPanelState | null;
  /**
   * Shows where the cards would go under this choice; null ends the preview,
   * and `keepView` keeps whatever the preview zoomed out to (a choice was made).
   */
  preview(patch: LayoutPatch | null, keepView?: boolean): void;
  /** Runs a canvas action by name, e.g. `down`, `branch-tree`, `align-start`, `compact`. */
  run(action: string): void;
  close(): void;
}

/** The structures a whole map can take, with their names and icons. */
export const STRUCTURE_OPTIONS: [MapLayout, string, string][] = [
  ["balanced", "Mind map", "git-fork"],
  ["right", "Logic chart (right)", "arrow-right"],
  ["left", "Logic chart (left)", "arrow-left"],
  ["down", "Org chart (down)", "arrow-down"],
  ["up", "Org chart (up)", "arrow-up"],
  ["tree", "Tree chart", "list-tree"],
  ["timeline", "Timeline", "git-commit-horizontal"],
  ["timeline-vertical", "Vertical timeline", "git-commit-vertical"],
];
/** The structures one branch can take; a branch grows one way, so no balanced. */
export const BRANCH_OPTIONS: [MapLayout | "inherit", string, string][] = [
  ["inherit", "Follow the map", "corner-down-right"],
  ...STRUCTURE_OPTIONS.filter(([value]) => value !== "balanced"),
];
export const ALIGN_OPTIONS: [MapAlign, string, string][] = [
  ["center", "Centred", "align-vertical-justify-center"],
  ["start", "From the top", "align-vertical-justify-start"],
];
/** Short names for the tiles, which have little room; the full names are their tooltips. */
export const SHORT_NAMES: Record<MapLayout, string> = {
  balanced: "Mind map", right: "Rightward", left: "Leftward", down: "Downward", up: "Upward",
  tree: "Tree chart", timeline: "Timeline", "timeline-vertical": "Vertical",
};
/** The same short names for a branch's own structure, which fit its narrow buttons. */
export const BRANCH_SHORT: Record<MapLayout | "inherit", string> = { inherit: "Default", ...SHORT_NAMES };

/** A short visible name leads; the full one follows in the name read out and shown as the tooltip. */
function accessibleName(short: string, full?: string): string {
  return full && full !== short ? `${short} · ${full}` : short;
}
export const SPACING_OPTIONS: [MapSpacing, string][] = [
  ["compact", "Compact"], ["standard", "Standard"], ["roomy", "Roomy"],
];

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * A miniature of a structure: a centre and a few branches laid out the way
 * that structure lays them out, in the theme's colors.
 */
export function layoutThumbnail(doc: Document, layout: MapLayout): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.setAttribute("viewBox", "0 0 132 68");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("nf-canvas-style-thumb", "nf-canvas-layout-thumb");
  const add = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>, cls: string) => {
    const el = doc.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    el.setAttribute("class", cls);
    svg.append(el);
    return el;
  };
  type Box = { x: number; y: number; w: number; h: number };
  const box = (b: Box, kind: "root" | "branch" | "leaf") => add("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: kind === "root" ? 5 : 3 }, `nf-thumb-${kind}`);
  const line = (d: string) => add("path", { d, fill: "none" }, "nf-thumb-line");
  const right = (b: Box) => ({ x: b.x + b.w, y: b.y + b.h / 2 });
  const left = (b: Box) => ({ x: b.x, y: b.y + b.h / 2 });
  const top = (b: Box) => ({ x: b.x + b.w / 2, y: b.y });
  const bottom = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h });
  const curve = (a: { x: number; y: number }, b: { x: number; y: number }, horizontal = true) => horizontal
    ? `M${a.x},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x},${b.y}`
    : `M${a.x},${a.y} C${a.x},${(a.y + b.y) / 2} ${b.x},${(a.y + b.y) / 2} ${b.x},${b.y}`;
  switch (layout) {
    case "balanced": {
      const root: Box = { x: 48, y: 26, w: 36, h: 16 };
      const rights: Box[] = [{ x: 100, y: 8, w: 26, h: 11 }, { x: 100, y: 28, w: 26, h: 11 }, { x: 100, y: 48, w: 26, h: 11 }];
      const lefts: Box[] = [{ x: 6, y: 16, w: 26, h: 11 }, { x: 6, y: 40, w: 26, h: 11 }];
      for (const b of rights) { line(curve(right(root), left(b))); box(b, "branch"); }
      for (const b of lefts) { line(curve(left(root), right(b))); box(b, "branch"); }
      box(root, "root");
      break;
    }
    case "right": case "left": {
      const mirror = layout === "left";
      const root: Box = { x: mirror ? 90 : 6, y: 26, w: 36, h: 16 };
      const branches: Box[] = [{ y: 5, h: 11 }, { y: 28, h: 11 }, { y: 51, h: 11 }].map((b) => ({ ...b, x: mirror ? 44 : 62, w: 26 }));
      const leaves: Box[] = [{ y: 2, h: 8 }, { y: 13, h: 8 }, { y: 53, h: 8 }].map((b) => ({ ...b, x: mirror ? 8 : 104, w: 22 }));
      for (const b of branches) { line(curve(mirror ? left(root) : right(root), mirror ? right(b) : left(b))); }
      line(curve(mirror ? left(branches[0]) : right(branches[0]), mirror ? right(leaves[0]) : left(leaves[0])));
      line(curve(mirror ? left(branches[0]) : right(branches[0]), mirror ? right(leaves[1]) : left(leaves[1])));
      line(curve(mirror ? left(branches[2]) : right(branches[2]), mirror ? right(leaves[2]) : left(leaves[2])));
      for (const b of branches) box(b, "branch");
      for (const b of leaves) box(b, "leaf");
      box(root, "root");
      break;
    }
    case "down": case "up": {
      const mirror = layout === "up";
      const root: Box = { x: 48, y: mirror ? 48 : 4, w: 36, h: 14 };
      const branches: Box[] = [{ x: 8 }, { x: 52 }, { x: 96 }].map((b) => ({ ...b, y: mirror ? 24 : 30, w: 28, h: 11 }));
      const leaves: Box[] = [{ x: 40 }, { x: 64 }].map((b) => ({ ...b, y: mirror ? 4 : 52, w: 20, h: 9 }));
      for (const b of branches) line(curve(mirror ? top(root) : bottom(root), mirror ? bottom(b) : top(b), false));
      for (const b of leaves) line(curve(mirror ? top(branches[1]) : bottom(branches[1]), mirror ? bottom(b) : top(b), false));
      for (const b of branches) box(b, "branch");
      for (const b of leaves) box(b, "leaf");
      box(root, "root");
      break;
    }
    case "tree": {
      const root: Box = { x: 8, y: 4, w: 36, h: 14 };
      const items: Box[] = [{ y: 24, x: 36, w: 30, h: 10, kind: "branch" }, { y: 38, x: 60, w: 26, h: 8, kind: "leaf" }, { y: 50, x: 60, w: 26, h: 8, kind: "leaf" }]
        .map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
      const second: Box = { x: 36, y: 61, w: 30, h: 6 };
      const trunk = (from: Box, to: Box) => `M${from.x + 8},${from.y + from.h} V${to.y + to.h / 2} H${to.x}`;
      line(trunk(root, items[0]));
      line(trunk(root, second));
      line(trunk(items[0], items[1]));
      line(trunk(items[0], items[2]));
      box(items[0], "branch");
      box(items[1], "leaf");
      box(items[2], "leaf");
      box(second, "branch");
      box(root, "root");
      break;
    }
    case "timeline": {
      const y = 22;
      const root: Box = { x: 4, y: y - 8, w: 22, h: 16 };
      const events: Box[] = [{ x: 38 }, { x: 70 }, { x: 102 }].map((b) => ({ ...b, y: y - 6, w: 24, h: 12 }));
      line(`M${root.x + root.w},${y} H130`);
      for (const b of events) { line(`M${b.x + 4},${b.y + b.h} V${b.y + b.h + 8} H${b.x + 14}`); box({ x: b.x + 14, y: b.y + b.h + 4, w: 14, h: 7 }, "leaf"); }
      for (const b of events) box(b, "branch");
      box(root, "root");
      break;
    }
    case "timeline-vertical": {
      const x = 30;
      const root: Box = { x: x - 12, y: 3, w: 24, h: 12 };
      const events: Box[] = [{ y: 22 }, { y: 39 }, { y: 56 }].map((b) => ({ ...b, x: x - 12, w: 24, h: 10 }));
      line(`M${x},${root.y + root.h} V66`);
      for (const b of events) { line(`M${b.x + b.w},${b.y + b.h / 2} H${b.x + b.w + 10}`); box({ x: b.x + b.w + 10, y: b.y + 1, w: 22, h: 8 }, "leaf"); }
      for (const b of events) box(b, "branch");
      box(root, "root");
      break;
    }
  }
  return svg;
}

/**
 * The layout panel: the map's structure as miniatures, the selected
 * branch's own structure, how children line up, and the spacing. A click
 * applies a choice as one undoable step; like the style panel, it floats
 * over the canvas's corner so the map stays in view.
 */
export class LayoutPanel {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private empty: HTMLElement;
  private tiles = new Map<MapLayout, HTMLButtonElement>();
  private options = new Map<string, HTMLButtonElement>();
  private branchSection: HTMLElement;
  /** The branch structures, shown only while a branch is selected. */
  private branchBody: HTMLElement;
  /** What the section says instead, for a root, a free card or nothing. */
  private branchNone: HTMLElement;
  private release: HTMLButtonElement;
  private previewing = false;

  constructor(private doc: Document, private host: LayoutPanelHost) {
    const el = this.el = doc.createElement("div");
    el.className = "nf-canvas-style-panel nf-canvas-layout-panel nf-canvas-ui";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", t("Layout"));
    for (const name of ["pointerdown", "mousedown", "dblclick", "wheel", "contextmenu", "click"]) {
      el.addEventListener(name, (evt) => evt.stopPropagation());
    }
    el.addEventListener("mousedown", (evt) => {
      if ((evt.target as Element).closest("button")) evt.preventDefault();
    });
    el.addEventListener("keydown", (evt) => {
      if (evt.key !== "Escape") return;
      evt.preventDefault();
      evt.stopPropagation();
      this.host.close();
    });

    const head = doc.createElement("div");
    head.className = "nf-canvas-style-head";
    const title = doc.createElement("div");
    title.className = "nf-canvas-style-title";
    title.textContent = t("Layout");
    const close = doc.createElement("button");
    close.type = "button";
    close.className = "clickable-icon nf-canvas-style-close";
    close.setAttribute("aria-label", t("Close"));
    setIcon(close, "x");
    close.addEventListener("click", () => this.host.close());
    head.append(title, close);

    this.empty = doc.createElement("div");
    this.empty.className = "nf-canvas-style-empty";
    this.empty.textContent = t("Select a card in a mind map to arrange it.");

    this.body = doc.createElement("div");
    this.body.className = "nf-canvas-style-body";

    const structures = this.section(t("Structure"));
    const grid = doc.createElement("div");
    grid.className = "nf-canvas-style-tiles nf-canvas-layout-tiles";
    for (const [value, label] of STRUCTURE_OPTIONS) grid.append(this.tile(value, t(SHORT_NAMES[value]), t(label)));
    grid.addEventListener("pointerleave", () => this.endPreview());
    structures.el.append(grid);

    const branch = this.section(t("This branch"));
    this.branchSection = branch.el;
    // A plain wrapper carries `hidden`: the options grid's own display would outrank it.
    this.branchBody = doc.createElement("div");
    this.branchBody.append(this.segmented("branch",
      BRANCH_OPTIONS.map(([value, label, icon]) => [value, t(BRANCH_SHORT[value]), icon, t(label)]), 4));
    const hint = doc.createElement("div");
    hint.className = "nf-canvas-style-hint";
    hint.textContent = t("A branch with a structure of its own keeps it inside any map.");
    this.branchBody.append(hint);
    this.branchNone = doc.createElement("div");
    this.branchNone.className = "nf-canvas-style-hint";
    this.branchNone.textContent = t("Select a branch to lay it out on its own");
    branch.el.append(this.branchBody, this.branchNone);

    const align = this.section(t("Children"));
    align.el.append(this.segmented("align", ALIGN_OPTIONS.map(([value, label, icon]) => [value, t(label), icon]), 2));

    const spacing = this.section(t("Spacing"));
    spacing.el.append(this.segmented("spacing", SPACING_OPTIONS.map(([value, label]) => [value, t(label), null]), 3));

    const free = this.section(t("Free placement"));
    const row = doc.createElement("div");
    row.className = "nf-canvas-style-actions";
    this.release = doc.createElement("button");
    this.release.type = "button";
    this.release.className = "nf-canvas-style-action";
    const glyph = doc.createElement("span");
    glyph.className = "nf-canvas-style-glyph";
    setIcon(glyph, "move");
    const text = doc.createElement("span");
    text.textContent = t("Free layout");
    this.release.append(glyph, text);
    this.release.title = t("The map's cards then stay where you put them.");
    this.release.addEventListener("click", () => this.host.run("release"));
    row.append(this.release);
    free.el.append(row);

    el.append(head, this.empty, this.body);
    this.sync();
  }

  private section(label: string) {
    const el = this.doc.createElement("section");
    el.className = "nf-canvas-style-section";
    const head = this.doc.createElement("div");
    head.className = "nf-canvas-style-section-head";
    const title = this.doc.createElement("span");
    title.textContent = label;
    head.append(title);
    el.append(head);
    this.body.append(el);
    return { el, head };
  }

  private tile(layout: MapLayout, label: string, title: string): HTMLButtonElement {
    const button = this.doc.createElement("button");
    button.type = "button";
    button.className = "nf-canvas-style-tile";
    button.dataset.layout = layout;
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", accessibleName(label, title));
    const name = this.doc.createElement("span");
    name.className = "nf-canvas-style-tile-name";
    name.textContent = label;
    button.append(layoutThumbnail(this.doc, layout), name);
    button.addEventListener("pointerenter", () => this.startPreview({ layout }));
    button.addEventListener("focus", () => this.startPreview({ layout }));
    button.addEventListener("blur", () => this.endPreview());
    button.addEventListener("click", () => {
      // The map takes this shape now: whatever the preview zoomed out to stays.
      this.endPreview(true);
      this.host.run(layout);
    });
    this.tiles.set(layout, button);
    return button;
  }

  /** A row of choices, each `[value, short label, icon, full name]`. */
  private segmented(kind: string, options: [string, string, string | null, string?][], columns: number): HTMLElement {
    const group = this.doc.createElement("div");
    group.className = "nf-canvas-style-options";
    group.style.setProperty("--nf-columns", String(columns));
    group.setAttribute("role", "group");
    for (const [value, label, icon, full] of options) {
      const button = this.doc.createElement("button");
      button.type = "button";
      button.className = "nf-canvas-style-option";
      button.dataset.kind = kind;
      button.dataset.value = value;
      button.setAttribute("aria-pressed", "false");
      if (full) button.setAttribute("aria-label", accessibleName(label, full));
      if (icon) {
        const glyph = this.doc.createElement("span");
        glyph.className = "nf-canvas-style-glyph";
        setIcon(glyph, icon);
        button.append(glyph);
      }
      const text = this.doc.createElement("span");
      text.textContent = label;
      button.append(text);
      const patch = (): LayoutPatch => ({ [kind]: value }) as LayoutPatch;
      button.addEventListener("pointerenter", () => this.startPreview(patch()));
      button.addEventListener("focus", () => this.startPreview(patch()));
      button.addEventListener("blur", () => this.endPreview());
      button.addEventListener("click", () => {
        this.endPreview(true);
        this.host.run(kind === "spacing" ? value : `${kind}-${value}`);
      });
      this.options.set(`${kind}:${value}`, button);
      group.append(button);
    }
    group.addEventListener("pointerleave", () => this.endPreview());
    return group;
  }

  private startPreview(patch: LayoutPatch) {
    if (!this.host.state()) return;
    this.previewing = true;
    this.host.preview(patch);
  }

  private endPreview(keepView = false) {
    if (!this.previewing) return;
    this.previewing = false;
    this.host.preview(null, keepView);
  }

  /** Show the current map's choices; called after every canvas render. */
  sync() {
    const state = this.host.state();
    this.el.classList.toggle("is-empty", !state);
    this.body.inert = !state;
    if (!state) return;
    for (const [layout, tile] of this.tiles) {
      const pressed = String(state.layout === layout);
      if (tile.getAttribute("aria-pressed") !== pressed) tile.setAttribute("aria-pressed", pressed);
    }
    const current: Record<string, string | null> = { branch: state.branch, align: state.align, spacing: state.spacing };
    for (const [key, button] of this.options) {
      const [kind, value] = key.split(":");
      const pressed = String(current[kind] === value);
      if (button.getAttribute("aria-pressed") !== pressed) button.setAttribute("aria-pressed", pressed);
      if (kind === "branch") button.disabled = state.branch === null;
    }
    this.branchSection.classList.toggle("is-unavailable", state.branch === null);
    this.branchBody.hidden = state.branch === null;
    this.branchNone.hidden = state.branch !== null;
    this.release.disabled = !state.canRelease;
  }

  destroy() {
    this.endPreview();
    this.el.remove();
  }
}
