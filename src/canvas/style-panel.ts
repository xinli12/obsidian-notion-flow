import { setIcon } from "obsidian";
import { t } from "../i18n";
import { APPEARANCE_PRESETS, PRESET_GROUPS, appearancePreset, presetColors, sameColors } from "./appearance";
import type {
  AppearancePreset, AppearancePresetId, CanvasFont, CanvasLineWeight, CanvasMapStyle, CanvasShape, CanvasTextScale, ColorSupport,
  PaletteColors, PaletteId,
} from "./appearance";
import { lineStyleFor } from "./lines";
import type { LineChoice, LineStyle } from "./lines";
import type { MapSpacing } from "./graph";
import { SCHEME_NAME_MAX, schemeAsPreset, suggestSchemeName } from "./schemes";
import type { CanvasUserScheme } from "./schemes";

/** What the panel shows for the map it styles; null when there is none. */
export interface StylePanelState {
  palette: PaletteId | null;
  theme: CanvasMapStyle;
  line: LineChoice;
  font: CanvasFont;
  shape: CanvasShape;
  weight: CanvasLineWeight;
  scale: CanvasTextScale;
  spacing: MapSpacing;
  /** Whether the one selected card has a boundary; null when none is selected. */
  boundary: boolean | null;
  /** Whether the selection can be summarised, or is a summary. */
  summary: boolean;
  /** Whether the map numbers its topics (1, 1.1, 1.2). */
  numbering: boolean;
  /** Whether the selected card's branch can be colored. */
  canColorBranch: boolean;
  canColor: boolean;
  canUncolor: boolean;
  /** The preset paired with the note palette, shown on maps without their own; null or absent when none is. */
  fallback?: AppearancePresetId | null;
  /** Whether the map has no palette of its own, so it shows the paired one. */
  follows?: boolean;
  /** Whether the map can follow the paired palette; false for the vivid look, which keeps its own colors. */
  canFollow?: boolean;
  /** The map's own colors while its palette is "custom". */
  custom?: PaletteColors | null;
  /** The schemes saved with "Save as my scheme". */
  schemes?: readonly CanvasUserScheme[];
  /** Whether the map shows colors that can be saved, and there is room for another scheme. */
  canSaveScheme?: boolean;
}

/** A look shown on the canvas without being saved. */
export interface StylePatch {
  palette?: AppearancePresetId;
  /** A saved scheme's raw colors, shown as the map's own. */
  colors?: PaletteColors;
  theme?: CanvasMapStyle;
  line?: LineChoice;
  font?: CanvasFont;
  shape?: CanvasShape;
  weight?: CanvasLineWeight;
  scale?: CanvasTextScale;
}

export interface StylePanelHost {
  state(): StylePanelState | null;
  preview(patch: StylePatch | null): void;
  applyPreset(id: AppearancePresetId, colorsOnly: boolean): void;
  /** Runs a canvas action by name, e.g. `theme-vivid` or `boundary`. */
  run(action: string): void;
  close(): void;
  support: ColorSupport;
  /** Apply a saved scheme by id, as one undoable step. */
  applyScheme?(id: string, colorsOnly: boolean): void;
  /** Save the map's colors and look as a scheme; false when there is nothing to save. */
  saveScheme?(name: string): boolean;
  deleteScheme?(id: string): void;
  /** Give the keyboard back to the canvas. */
  focusCanvas?(): void;
  /** Where the open sections are kept, when anywhere. */
  sections?: { load(): unknown; save(open: string[]): void };
}

/** The style panel's open sections, kept per device. */
export const STYLE_SECTIONS_KEY = "nf-canvas-style-open";
/** The sections below the color schemes that fold; only Look is open at first. */
const SECTION_KEYS = ["look", "lines", "shape", "font", "scale", "weight", "spacing", "branches"];
const OPEN_SECTIONS = ["look"];

/** Show or hide a panel part; a class's own display would outrank the bare [hidden] rule. */
function setShown(el: HTMLElement, shown: boolean) {
  el.hidden = !shown;
  if (shown) el.style.removeProperty("display");
  else el.style.setProperty("display", "none");
}

export const THEME_OPTIONS: [CanvasMapStyle, string, string][] = [
  ["clean", "Clean", "sparkles"],
  ["cards", "Cards", "rectangle-horizontal"],
  ["vivid", "Vivid", "paint-bucket"],
  ["minimal", "Minimal", "type"],
  ["pastel", "Pastel", "cloud"],
  ["gradient", "Gradient", "rainbow"],
];
export const LINE_OPTIONS: [LineChoice, string, string][] = [
  ["auto", "Automatic", "wand-sparkles"],
  ["organic", "Tapered", "brush"],
  ["curve", "Curved", "spline"],
  ["elbow", "Elbow", "route"],
  ["straight", "Straight", "slash"],
];
export const FONT_OPTIONS: [CanvasFont, string][] = [
  ["default", "Note font"], ["sans", "Sans"], ["serif", "Serif"], ["kai", "Kai"],
];
export const SHAPE_OPTIONS: [CanvasShape, string, string][] = [
  ["rounded", "Rounded", "square-round-corner"], ["pill", "Pill", "rectangle-horizontal"], ["square", "Square", "square"], ["underline", "Underline", "minus"],
];
export const WEIGHT_OPTIONS: [CanvasLineWeight, string][] = [
  ["thin", "Thin"], ["normal", "Normal"], ["bold", "Bold"],
];
export const SCALE_OPTIONS: [CanvasTextScale, string][] = [
  ["small", "Small"], ["normal", "Normal"], ["large", "Large"],
];
const SPACING_OPTIONS: [MapSpacing, string][] = [
  ["compact", "Compact"], ["standard", "Standard"], ["roomy", "Roomy"],
];

const SVG_NS = "http://www.w3.org/2000/svg";
let gradientIds = 0;

/**
 * A miniature map in a preset's colors, shapes and lines: a centre, three
 * main branches and a detail each, drawn the way the preset draws them.
 */
export function presetThumbnail(doc: Document, preset: AppearancePreset, support: ColorSupport): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.setAttribute("viewBox", "0 0 132 68");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("nf-canvas-style-thumb");
  const colors = presetColors(preset, support);
  const theme = preset.theme;
  const line: LineStyle = lineStyleFor(preset.line, "right");
  const ground = "var(--background-primary)";
  const mix = (color: string, amount: number, base = ground) => `color-mix(in oklch, ${color} ${amount}%, ${base})`;
  const add = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>, style: Record<string, string> = {}) => {
    const el = doc.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    for (const [key, value] of Object.entries(style)) el.style.setProperty(key, value);
    svg.append(el);
    return el;
  };
  const gradient = (color: string) => {
    const id = `nf-thumb-${++gradientIds}`;
    const defs = add("defs", {});
    const def = doc.createElementNS(SVG_NS, "linearGradient");
    def.setAttribute("id", id);
    def.setAttribute("x1", "0");
    def.setAttribute("y1", "0");
    def.setAttribute("x2", "1");
    def.setAttribute("y2", "1");
    for (const [offset, value] of [["0", mix(color, 90, "black")], ["1", support.relative
      ? `oklch(from ${color} calc(l + 0.02) c calc(h + 38))` : mix(color, 72, "#a78bfa")]]) {
      const stop = doc.createElementNS(SVG_NS, "stop");
      stop.setAttribute("offset", offset);
      stop.style.setProperty("stop-color", value);
      def.append(stop);
    }
    defs.append(def);
    return `url(#${id})`;
  };

  const root = { x: 6, y: 25, w: 36, h: 18 };
  const branchY = [7, 27, 47];
  const branch = (y: number) => ({ x: 62, y, w: 30, h: 14 });
  const leaf = (y: number) => ({ x: 104, y: y + 2, w: 22, h: 10 });

  const drawLine = (from: { x: number; y: number }, to: { x: number; y: number }, color: string, width: number) => {
    const stroke = theme === "pastel" ? mix(color, 72) : color;
    const middle = (from.x + to.x) / 2;
    let d: string;
    if (line === "straight") d = `M${from.x},${from.y} L${to.x},${to.y}`;
    else if (line === "elbow") {
      const r = Math.min(4, Math.abs(to.y - from.y) / 2);
      const dir = Math.sign(to.y - from.y);
      d = r ? `M${from.x},${from.y} H${middle - r} Q${middle},${from.y} ${middle},${from.y + dir * r} V${to.y - dir * r} Q${middle},${to.y} ${middle + r},${to.y} H${to.x}`
        : `M${from.x},${from.y} H${to.x}`;
    } else d = `M${from.x},${from.y} C${middle},${from.y} ${middle},${to.y} ${to.x},${to.y}`;
    add("path", { d, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" },
      { stroke, "stroke-width": String(line === "organic" ? width * 1.5 : width) });
  };
  const ink = (box: { x: number; y: number; w: number; h: number }, color: string, strong: boolean, align: "center" | "start") => {
    const width = box.w * (strong ? 0.62 : 0.56);
    const x = align === "center" ? box.x + (box.w - width) / 2 : box.x + 2;
    add("rect", { x, y: box.y + box.h / 2 - (strong ? 1.6 : 1.2), width, height: strong ? 3.2 : 2.4, rx: 1.2 }, { fill: color });
  };
  const box = (b: { x: number; y: number; w: number; h: number }, level: 0 | 1 | 2, color: string) => {
    const radius = level === 0 ? 7 : level === 1 ? 5 : 4;
    const textDeep = `color-mix(in oklch, ${color} 45%, var(--text-normal))`;
    const plainInk = "var(--text-muted)";
    switch (theme) {
      case "clean":
        if (level === 2) return ink(b, plainInk, false, "start");
        add("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: radius },
          { fill: mix(color, level === 0 ? 16 : 14), stroke: level === 0 ? color : mix(color, 65, "transparent"), "stroke-width": level === 0 ? "1.4" : "1" });
        return ink(b, textDeep, level === 0, "center");
      case "cards":
        add("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: radius },
          { fill: level === 0 ? mix(color, 12) : ground, stroke: level === 0 ? color : mix(color, 40, "var(--background-modifier-border)"), "stroke-width": level === 0 ? "1.4" : "0.8" });
        if (level) add("rect", { x: b.x + 0.4, y: b.y + 2, width: 1.6, height: b.h - 4, rx: 0.8 }, { fill: color });
        return ink(b, level === 0 ? textDeep : plainInk, level === 0, "center");
      case "vivid":
        if (level === 2) {
          add("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: radius }, { fill: mix(color, 12), stroke: mix(color, 50, "transparent"), "stroke-width": "0.8" });
          return ink(b, plainInk, false, "center");
        }
        add("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: radius }, { fill: mix(color, level === 0 ? 88 : 94, "black") });
        return ink(b, "#fff", true, "center");
      case "minimal":
        return ink(b, level === 2 ? plainInk : mix(color, level === 0 ? 88 : 75, "var(--text-normal)"), level < 2, level === 0 ? "center" : "start");
      case "pastel":
        add("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: radius + 1 }, { fill: mix(color, level === 0 ? 34 : level === 1 ? 26 : 18) });
        return ink(b, textDeep, level === 0, "center");
      case "gradient":
        if (level === 2) {
          add("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: radius }, { fill: mix(color, 12), stroke: mix(color, 38, "transparent"), "stroke-width": "0.7" });
          return ink(b, plainInk, false, "center");
        }
        add("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: radius + 1 }, { fill: gradient(color) });
        return ink(b, "#fff", true, "center");
    }
  };

  const edgeOut = (b: { x: number; y: number; w: number; h: number }) => ({ x: b.x + b.w, y: b.y + b.h / 2 });
  const edgeIn = (b: { x: number; y: number; w: number; h: number }) => ({ x: b.x, y: b.y + b.h / 2 });
  branchY.forEach((y, index) => {
    const color = colors.branchColors[index % colors.branchColors.length];
    drawLine(edgeOut(root), edgeIn(branch(y)), color, theme === "minimal" ? 1 : theme === "vivid" || theme === "gradient" ? 2 : 1.6);
    drawLine(edgeOut(branch(y)), edgeIn(leaf(y)), color, theme === "minimal" ? 0.8 : 1.3);
  });
  box(root, 0, colors.rootColor);
  branchY.forEach((y, index) => {
    const color = colors.branchColors[index % colors.branchColors.length];
    box(branch(y), 1, color);
    box(leaf(y), 2, color);
  });
  return svg;
}

/**
 * A strip of six dots in a palette's branch colors, under a tile's
 * miniature, which draws only three. It sizes itself without CSS.
 */
export function paletteDots(doc: Document, colors: readonly string[]): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.setAttribute("class", "nf-canvas-style-dots");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("viewBox", "0 0 132 8");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "8");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  for (let index = 0; index < 6 && colors.length; index++) {
    const dot = doc.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", String(66 + (index - 2.5) * 13));
    dot.setAttribute("cy", "4");
    dot.setAttribute("r", "3");
    dot.style.setProperty("fill", colors[index % colors.length]);
    // A light tone still shows on a white ground.
    dot.style.setProperty("stroke", "var(--background-modifier-border)");
    dot.style.setProperty("stroke-width", ".6");
    svg.append(dot);
  }
  return svg;
}

/**
 * The style panel: presets as live miniatures, then the map's look, lines,
 * typeface and spacing. Hovering a choice previews it on the canvas; a click
 * applies it as one undoable step. The panel floats over the canvas's corner
 * so the map stays in view.
 */
export class StylePanel {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private empty: HTMLElement;
  private colorsOnly: HTMLInputElement;
  private tiles = new Map<AppearancePresetId, HTMLButtonElement>();
  private options = new Map<string, HTMLButtonElement>();
  private boundary: HTMLButtonElement;
  private summary: HTMLButtonElement;
  private numbering: HTMLButtonElement;
  private colorBranch: HTMLButtonElement;
  private color: HTMLButtonElement;
  private uncolor: HTMLButtonElement;
  private paletteOff: HTMLButtonElement;
  private previewing = false;
  /** The schemes section, and the first group heading the pinned tile goes before. */
  private presetsEl: HTMLElement;
  private presetsStart: Node | null = null;
  private matchGrid: HTMLElement | null = null;
  private matchTile: HTMLButtonElement | null = null;
  private matchFor: string | null = null;
  /** "My schemes": their tiles, the Save button and the name field it opens. */
  private mine: HTMLElement;
  private mineGrid: HTMLElement;
  private saveRow: HTMLElement;
  private saveButton: HTMLButtonElement;
  private schemeForm: HTMLElement;
  private schemeName: HTMLInputElement;
  private schemeTiles = new Map<string, { tile: HTMLButtonElement; scheme: CanvasUserScheme }>();
  private schemesKey: string | null = null;
  private schemeNames: string[] = [];
  /** The folding sections that are open. */
  private openSections: Set<string>;

  constructor(private doc: Document, private host: StylePanelHost) {
    const saved = host.sections?.load();
    this.openSections = new Set(Array.isArray(saved) && saved.every((key) => SECTION_KEYS.includes(key)) ? saved as string[] : OPEN_SECTIONS);
    const el = this.el = doc.createElement("div");
    el.className = "nf-canvas-style-panel nf-canvas-ui";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", t("Map style"));
    // Canvas pans, zooms and selects on these; inside the panel they belong to it.
    for (const name of ["pointerdown", "mousedown", "dblclick", "wheel", "contextmenu", "click"]) {
      el.addEventListener(name, (evt) => evt.stopPropagation());
    }
    // A click leaves the keyboard with the canvas, so Delete, Tab and the
    // arrows keep acting on the selected card; Tab still reaches the panel.
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
    title.textContent = t("Map style");
    const close = this.iconButton("x", t("Close"), () => this.host.close());
    close.classList.add("nf-canvas-style-close");
    head.append(title, close);

    this.empty = doc.createElement("div");
    this.empty.className = "nf-canvas-style-empty";
    this.empty.textContent = t("Select a card in a mind map to style it.");

    this.body = doc.createElement("div");
    this.body.className = "nf-canvas-style-body";

    // Presets
    const presets = this.section(t("Color schemes"));
    const toggle = doc.createElement("label");
    toggle.className = "nf-canvas-style-switch";
    this.colorsOnly = doc.createElement("input");
    this.colorsOnly.type = "checkbox";
    const toggleText = doc.createElement("span");
    toggleText.textContent = t("Colors only");
    toggle.append(this.colorsOnly, toggleText);
    toggle.title = t("Apply colors only; keep style, lines and spacing");
    presets.head.append(toggle);
    this.presetsEl = presets.el;
    // The schemes someone saved come first, after the note palette's tile.
    this.mine = doc.createElement("div");
    this.mine.className = "nf-canvas-style-mine";
    const mineHeading = doc.createElement("div");
    mineHeading.className = "nf-canvas-style-group";
    mineHeading.textContent = t("My schemes");
    this.mineGrid = doc.createElement("div");
    this.mineGrid.className = "nf-canvas-style-tiles nf-canvas-style-mine-tiles";
    this.mineGrid.addEventListener("pointerleave", () => this.endPreview());
    setShown(this.mineGrid, false);
    this.saveRow = doc.createElement("div");
    this.saveRow.className = "nf-canvas-style-actions";
    this.saveButton = this.textButton("bookmark-plus", t("Save as my scheme"), () => this.openSchemeForm());
    this.saveRow.append(this.saveButton);
    this.schemeForm = doc.createElement("div");
    this.schemeForm.className = "nf-canvas-style-scheme-form";
    this.schemeName = doc.createElement("input");
    this.schemeName.type = "text";
    this.schemeName.className = "nf-canvas-style-scheme-name";
    this.schemeName.maxLength = SCHEME_NAME_MAX;
    this.schemeName.placeholder = t("Scheme name");
    this.schemeName.setAttribute("aria-label", t("Scheme name"));
    this.schemeName.spellcheck = false;
    this.schemeName.addEventListener("keydown", (evt) => {
      // Keys typed into the name stay with it; Canvas and the panel never see them.
      evt.stopPropagation();
      if (evt.isComposing || evt.keyCode === 229) return;
      if (evt.key === "Enter") {
        evt.preventDefault();
        this.submitScheme();
      } else if (evt.key === "Escape") {
        // Only the field closes, not the panel.
        evt.preventDefault();
        this.closeSchemeForm();
      }
    });
    this.schemeForm.append(this.schemeName,
      this.textButton("check", t("Save"), () => this.submitScheme()),
      this.textButton("x", t("Cancel"), () => this.closeSchemeForm()));
    setShown(this.schemeForm, false);
    this.mine.append(mineHeading, this.mineGrid, this.saveRow, this.schemeForm);
    presets.el.append(this.mine);
    this.presetsStart = this.mine;
    setShown(this.mine, !!this.host.saveScheme);
    for (const [group, label] of PRESET_GROUPS) {
      const members = APPEARANCE_PRESETS.filter((preset) => preset.group === group);
      if (!members.length) continue;
      const heading = doc.createElement("div");
      heading.className = "nf-canvas-style-group";
      heading.textContent = t(label);
      const grid = doc.createElement("div");
      grid.className = "nf-canvas-style-tiles";
      for (const preset of members) grid.append(this.tile(preset));
      grid.addEventListener("pointerleave", () => this.endPreview());
      presets.el.append(heading, grid);
    }

    const looks = this.section(t("Look"), "look");
    looks.el.append(this.segmented("theme", THEME_OPTIONS.map(([value, label, icon]) => [value, t(label), icon]), 3,
      (value) => ({ theme: value as CanvasMapStyle })));
    const lines = this.section(t("Branch lines"), "lines");
    lines.el.append(this.segmented("line", LINE_OPTIONS.map(([value, label, icon]) => [value, t(label), icon]), 5,
      (value) => ({ line: value as LineChoice }), true));
    const shapes = this.section(t("Card shape"), "shape");
    shapes.el.append(this.segmented("shape", SHAPE_OPTIONS.map(([value, label, icon]) => [value, t(label), icon]), 4,
      (value) => ({ shape: value as CanvasShape })));
    const fonts = this.section(t("Typeface"), "font");
    fonts.el.append(this.segmented("font", FONT_OPTIONS.map(([value, label]) => [value, t(label), null]), 4,
      (value) => ({ font: value as CanvasFont })));
    const sizes = this.section(t("Text size"), "scale");
    sizes.el.append(this.segmented("scale", SCALE_OPTIONS.map(([value, label]) => [value, t(label), null]), 3,
      (value) => ({ scale: value as CanvasTextScale })));
    const weightsRow = this.section(t("Line weight"), "weight");
    weightsRow.el.append(this.segmented("weight", WEIGHT_OPTIONS.map(([value, label]) => [value, t(label), null]), 3,
      (value) => ({ weight: value as CanvasLineWeight })));
    const spacing = this.section(t("Spacing"), "spacing");
    spacing.el.append(this.segmented("spacing", SPACING_OPTIONS.map(([value, label]) => [value, t(label), null]), 3, null));

    const more = this.section(t("Branches"), "branches");
    const row = doc.createElement("div");
    row.className = "nf-canvas-style-actions";
    this.boundary = this.textButton("square-dashed", t("Boundary"), () => this.host.run("boundary"));
    this.summary = this.textButton("braces", t("Summary"), () => this.host.run("summary"));
    this.numbering = this.textButton("list-ordered", t("Numbering"), () => this.host.run("numbering"));
    this.colorBranch = this.textButton("palette", t("Color this branch…"), () => this.host.run("colorBranch"));
    this.color = this.textButton("palette", t("Write colors to cards"), () => this.host.run("colors"));
    this.uncolor = this.textButton("eraser", t("Clear card colors"), () => this.host.run("uncolor"));
    this.paletteOff = this.textButton("paintbrush", t("No automatic colors"), () => this.host.run("palette-off"));
    this.color.title = t("Color branches");
    row.append(this.boundary, this.summary, this.numbering, this.colorBranch, this.color, this.uncolor, this.paletteOff);
    more.el.append(row);

    el.append(head, this.empty, this.body);
    this.sync();
  }

  /**
   * A titled section. With a key it folds: a click on its head opens or
   * closes it, and which sections are open is kept for next time.
   */
  private section(label: string, key?: string) {
    const section = this.doc.createElement("section");
    section.className = "nf-canvas-style-section";
    const head = this.doc.createElement("div");
    head.className = "nf-canvas-style-section-head";
    const title = this.doc.createElement("span");
    title.textContent = label;
    head.append(title);
    section.append(head);
    this.body.append(section);
    if (!key) return { el: section, head, section };
    const body = this.doc.createElement("div");
    body.className = "nf-canvas-style-section-body";
    section.dataset.section = key;
    head.classList.add("is-collapsible");
    const toggle = this.iconButton("chevron-down", label, () => {});
    toggle.classList.add("nf-canvas-style-section-toggle");
    head.append(toggle);
    section.append(body);
    const show = (open: boolean) => {
      setShown(body, open);
      toggle.setAttribute("aria-expanded", String(open));
      section.classList.toggle("is-collapsed", !open);
    };
    show(this.openSections.has(key));
    head.addEventListener("click", () => {
      const open = !this.openSections.has(key);
      if (open) this.openSections.add(key); else this.openSections.delete(key);
      show(open);
      this.host.sections?.save(SECTION_KEYS.filter((name) => this.openSections.has(name)));
    });
    return { el: body, head, section };
  }

  private iconButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = this.doc.createElement("button");
    button.type = "button";
    button.className = "clickable-icon";
    button.setAttribute("aria-label", label);
    setIcon(button, icon);
    button.addEventListener("click", onClick);
    return button;
  }

  private textButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = this.doc.createElement("button");
    button.type = "button";
    button.className = "nf-canvas-style-action";
    const glyph = this.doc.createElement("span");
    glyph.className = "nf-canvas-style-glyph";
    setIcon(glyph, icon);
    const text = this.doc.createElement("span");
    text.textContent = label;
    button.append(glyph, text);
    button.addEventListener("click", onClick);
    return button;
  }

  /** A tile's picture: the miniature map, and all six branch colors under it. */
  private tileFace(preset: AppearancePreset): [SVGSVGElement, SVGSVGElement] {
    return [presetThumbnail(this.doc, preset, this.host.support),
      paletteDots(this.doc, presetColors(preset, this.host.support).branchColors)];
  }

  private tile(preset: AppearancePreset): HTMLButtonElement {
    const button = this.doc.createElement("button");
    button.type = "button";
    button.className = "nf-canvas-style-tile";
    button.dataset.preset = preset.id;
    button.setAttribute("aria-pressed", "false");
    // The visible name leads the accessible name (voice control matches
    // it); the description follows, and Obsidian's tooltip shows both.
    button.setAttribute("aria-label", `${t(preset.name)} · ${t(preset.description)}`);
    const name = this.doc.createElement("span");
    name.className = "nf-canvas-style-tile-name";
    name.textContent = t(preset.name);
    if (preset.font && preset.font !== "default") name.classList.add(`nf-font-sample-${preset.font}`);
    button.append(...this.tileFace(preset), name);
    const patch = (): StylePatch => this.colorsOnly.checked ? { palette: preset.id as AppearancePresetId }
      : { palette: preset.id as AppearancePresetId, theme: preset.theme, line: preset.line, font: preset.font ?? "default", shape: preset.shape ?? "rounded" };
    button.addEventListener("pointerenter", () => this.startPreview(patch()));
    button.addEventListener("focus", () => this.startPreview(patch()));
    button.addEventListener("blur", () => this.endPreview());
    button.addEventListener("click", () => {
      this.endPreview();
      this.host.applyPreset(preset.id as AppearancePresetId, this.colorsOnly.checked);
    });
    this.tiles.set(preset.id as AppearancePresetId, button);
    return button;
  }

  /**
   * The pinned first tile while the note palette pairs a preset with maps
   * that have none: it shows that preset, and a click lets the map follow it
   * again by removing the map's own palette.
   */
  private syncMatch(fallback: AppearancePresetId | null) {
    if (fallback === this.matchFor) return;
    this.matchFor = fallback;
    // A tile that goes away cannot end its own preview.
    if (this.matchTile) this.endPreview();
    this.matchGrid?.remove();
    this.matchGrid = this.matchTile = null;
    const preset = appearancePreset(fallback);
    if (!preset) return;
    const grid = this.doc.createElement("div");
    grid.className = "nf-canvas-style-tiles nf-canvas-style-match";
    const button = this.doc.createElement("button");
    button.type = "button";
    button.className = "nf-canvas-style-tile nf-canvas-style-tile-match";
    button.dataset.preset = "match";
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", `${t("Match note palette")} · ${t(preset.name)}`);
    const name = this.doc.createElement("span");
    name.className = "nf-canvas-style-tile-name";
    name.textContent = t("Match note palette");
    // A second line names the scheme the note palette pairs with.
    const sub = this.doc.createElement("span");
    sub.className = "nf-canvas-style-tile-sub";
    sub.textContent = t(preset.name);
    name.append(sub);
    button.append(...this.tileFace(preset), name);
    const patch: StylePatch = { palette: preset.id as AppearancePresetId };
    // Where it cannot follow, it previews nothing it could not do.
    button.addEventListener("pointerenter", () => { if (!button.disabled) this.startPreview(patch); });
    button.addEventListener("focus", () => { if (!button.disabled) this.startPreview(patch); });
    button.addEventListener("blur", () => this.endPreview());
    button.addEventListener("click", () => {
      this.endPreview();
      if (!button.disabled) this.host.run("palette-follow");
    });
    grid.addEventListener("pointerleave", () => this.endPreview());
    grid.append(button);
    this.presetsEl.insertBefore(grid, this.presetsStart);
    this.matchGrid = grid;
    this.matchTile = button;
  }

  /** The saved schemes' tiles, drawn again only when the list changes. */
  private syncSchemes(schemes: readonly CanvasUserScheme[]) {
    const key = JSON.stringify(schemes);
    if (key === this.schemesKey) return;
    this.schemesKey = key;
    this.schemeNames = schemes.map((scheme) => scheme.name);
    // A tile that goes away cannot end its own preview.
    if (this.schemeTiles.size) this.endPreview();
    // Drawing the tiles again detaches the focused one (a Delete from the
    // keyboard, say), which would leave the keyboard on the page body.
    const active = this.doc.activeElement;
    const wrap = active && this.mineGrid.contains(active) ? active.closest(".nf-canvas-style-tile-wrap") : null;
    const focused = wrap ? {
      id: wrap.querySelector<HTMLElement>(".nf-canvas-style-tile")?.dataset.scheme,
      index: Array.prototype.indexOf.call(this.mineGrid.children, wrap) as number,
      onDelete: !!active?.closest(".nf-canvas-style-tile-delete"),
    } : null;
    this.schemeTiles.clear();
    this.mineGrid.replaceChildren(...schemes.map((scheme) => this.schemeTile(scheme)));
    setShown(this.mineGrid, schemes.length > 0);
    if (focused) this.refocusScheme(schemes, focused);
  }

  /**
   * Back onto the same scheme's tile or ✕ when it is still there, else the
   * one now in its place, else Save; with that unavailable, the canvas.
   */
  private refocusScheme(schemes: readonly CanvasUserScheme[], was: { id?: string; index: number; onDelete: boolean }) {
    const at = schemes.findIndex((scheme) => scheme.id === was.id);
    const index = at >= 0 ? at : Math.min(was.index, schemes.length - 1);
    const tile = index >= 0 ? this.schemeTiles.get(schemes[index].id)?.tile : undefined;
    const target = tile && was.onDelete ? tile.parentElement?.querySelector<HTMLButtonElement>(".nf-canvas-style-tile-delete") ?? tile : tile;
    for (const candidate of [target, this.saveButton]) {
      if (!candidate || candidate.disabled) continue;
      candidate.focus();
      if (this.doc.activeElement === candidate) return;
    }
    this.host.focusCanvas?.();
  }

  private schemeTile(scheme: CanvasUserScheme): HTMLElement {
    const wrap = this.doc.createElement("div");
    wrap.className = "nf-canvas-style-tile-wrap";
    const button = this.doc.createElement("button");
    button.type = "button";
    button.className = "nf-canvas-style-tile";
    button.dataset.scheme = scheme.id;
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", scheme.name);
    const name = this.doc.createElement("span");
    name.className = "nf-canvas-style-tile-name";
    // Someone's own words: text, never markup.
    name.textContent = scheme.name;
    const preset = schemeAsPreset(scheme);
    if (preset.font && preset.font !== "default") name.classList.add(`nf-font-sample-${preset.font}`);
    button.append(...this.tileFace(preset), name);
    const colors: PaletteColors = scheme.dark
      ? { rootColor: scheme.rootColor, branchColors: scheme.branchColors, dark: scheme.dark }
      : { rootColor: scheme.rootColor, branchColors: scheme.branchColors };
    const patch = (): StylePatch => this.colorsOnly.checked ? { colors }
      : { colors, theme: scheme.theme, line: scheme.line, font: scheme.font ?? "default", shape: scheme.shape ?? "rounded" };
    button.addEventListener("pointerenter", () => this.startPreview(patch()));
    button.addEventListener("focus", () => this.startPreview(patch()));
    button.addEventListener("blur", () => this.endPreview());
    button.addEventListener("click", () => {
      this.endPreview();
      this.host.applyScheme?.(scheme.id, this.colorsOnly.checked);
    });
    button.addEventListener("keydown", (evt) => {
      if (evt.key !== "Delete" && evt.key !== "Backspace") return;
      // Canvas would take the key for the selected card.
      evt.preventDefault();
      evt.stopPropagation();
      this.endPreview();
      this.host.deleteScheme?.(scheme.id);
    });
    const remove = this.iconButton("x", t("Delete scheme"), () => {
      this.endPreview();
      this.host.deleteScheme?.(scheme.id);
    });
    remove.classList.add("nf-canvas-style-tile-delete");
    wrap.append(button, remove);
    this.schemeTiles.set(scheme.id, { tile: button, scheme });
    return wrap;
  }

  private openSchemeForm() {
    if (this.saveButton.disabled) return;
    setShown(this.saveRow, false);
    setShown(this.schemeForm, true);
    this.schemeName.classList.remove("is-invalid");
    this.schemeName.value = suggestSchemeName(t("Map scheme"), this.schemeNames);
    this.schemeName.focus();
    this.schemeName.select?.();
  }

  private closeSchemeForm() {
    const focused = this.schemeForm.contains(this.doc.activeElement);
    setShown(this.schemeForm, false);
    setShown(this.saveRow, true);
    if (focused) this.saveButton.focus();
  }

  private submitScheme() {
    if (!this.host.saveScheme?.(this.schemeName.value)) {
      this.schemeName.classList.add("is-invalid");
      return;
    }
    setShown(this.schemeForm, false);
    setShown(this.saveRow, true);
    this.host.focusCanvas?.();
  }

  private segmented(kind: string, options: [string, string, string | null][], columns: number,
    patch: ((value: string) => StylePatch) | null, iconOnly = false): HTMLElement {
    const group = this.doc.createElement("div");
    group.className = "nf-canvas-style-options";
    group.style.setProperty("--nf-columns", String(columns));
    group.setAttribute("role", "group");
    for (const [value, label, icon] of options) {
      const button = this.doc.createElement("button");
      button.type = "button";
      button.className = "nf-canvas-style-option";
      button.dataset.kind = kind;
      button.dataset.value = value;
      button.setAttribute("aria-pressed", "false");
      if (icon) {
        const glyph = this.doc.createElement("span");
        glyph.className = "nf-canvas-style-glyph";
        setIcon(glyph, icon);
        button.append(glyph);
      }
      if (iconOnly) {
        button.setAttribute("aria-label", label);
        button.classList.add("is-icon");
      } else {
        const text = this.doc.createElement("span");
        text.textContent = label;
        if (kind === "font" && value !== "default") text.classList.add(`nf-font-sample-${value}`);
        button.append(text);
      }
      if (patch) {
        button.addEventListener("pointerenter", () => this.startPreview(patch(value)));
        button.addEventListener("focus", () => this.startPreview(patch(value)));
        button.addEventListener("blur", () => this.endPreview());
      }
      button.addEventListener("click", () => {
        this.endPreview();
        this.host.run(`${kind === "spacing" ? "" : `${kind}-`}${value}`);
      });
      this.options.set(`${kind}:${value}`, button);
      group.append(button);
    }
    if (patch) group.addEventListener("pointerleave", () => this.endPreview());
    return group;
  }

  private startPreview(patch: StylePatch) {
    if (!this.host.state()) return;
    this.previewing = true;
    this.host.preview(patch);
  }

  private endPreview() {
    if (!this.previewing) return;
    this.previewing = false;
    this.host.preview(null);
  }

  /** Show the current map's choices; called after every canvas render. */
  sync() {
    const state = this.host.state();
    this.el.classList.toggle("is-empty", !state);
    this.body.inert = !state;
    if (!state) {
      this.endPreview();
      return;
    }
    this.syncMatch(state.fallback ?? null);
    if (this.matchTile) {
      const pressed = String(!!state.follows && !!state.fallback);
      if (this.matchTile.getAttribute("aria-pressed") !== pressed) this.matchTile.setAttribute("aria-pressed", pressed);
      // The vivid look keeps its own colors, so the paired palette would not show: say so rather than preview it.
      const blocked = state.canFollow === false;
      if (this.matchTile.disabled !== blocked) {
        this.matchTile.disabled = blocked;
        if (blocked) this.endPreview();
        const preset = appearancePreset(state.fallback);
        const name = `${t("Match note palette")} · ${t(preset?.name ?? "")}`;
        this.matchTile.setAttribute("aria-label", blocked ? `${name} · ${t("The Vivid look keeps its own colors")}` : name);
      }
    }
    for (const [id, tile] of this.tiles) {
      const pressed = String(state.palette === id);
      if (tile.getAttribute("aria-pressed") !== pressed) tile.setAttribute("aria-pressed", pressed);
    }
    // Before the tiles: a deleted last tile hands the focus to Save when it can take it.
    this.saveButton.disabled = !state.canSaveScheme;
    this.syncSchemes(state.schemes ?? []);
    for (const { tile, scheme } of this.schemeTiles.values()) {
      const pressed = String(state.palette === "custom" && sameColors(state.custom ?? null, scheme));
      if (tile.getAttribute("aria-pressed") !== pressed) tile.setAttribute("aria-pressed", pressed);
    }
    const current: Record<string, string> = {
      theme: state.theme, line: state.line, font: state.font, spacing: state.spacing,
      shape: state.shape, weight: state.weight, scale: state.scale,
    };
    for (const [key, button] of this.options) {
      const [kind, value] = key.split(":");
      const pressed = String(current[kind] === value);
      if (button.getAttribute("aria-pressed") !== pressed) button.setAttribute("aria-pressed", pressed);
    }
    this.boundary.disabled = state.boundary === null;
    this.boundary.setAttribute("aria-pressed", String(!!state.boundary));
    this.summary.disabled = !state.summary;
    this.numbering.setAttribute("aria-pressed", String(state.numbering));
    this.colorBranch.disabled = !state.canColorBranch;
    this.color.disabled = !state.canColor;
    this.uncolor.disabled = !state.canUncolor;
    this.paletteOff.disabled = state.palette === "none";
  }

  destroy() {
    this.endPreview();
    this.el.remove();
  }
}
