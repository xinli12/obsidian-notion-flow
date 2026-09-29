/**
 * Colors as the page draws them. A palette's tones are CSS (theme variables,
 * light-dark(), colors relative to the accent) that cannot be written to a
 * card; these turn one into the literal #rrggbb it shows now.
 */

/** "rgb(1, 2, 3)" / "rgb(1 2 3 / 1)" / "rgba(...)" / "#abc" / "#aabbcc" → [r,g,b,a(0–1)] or null. */
export function parseRgb(value: string): [number, number, number, number] | null {
  const text = value.trim().toLowerCase();
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/.exec(text);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit) : hex[1].match(/../g)!;
    const [r, g, b] = digits.map((pair) => parseInt(pair, 16));
    return [r, g, b, 1];
  }
  const match = /^rgba?\(\s*([^)]*)\)$/.exec(text);
  if (!match) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) return null;
  const channel = (part: string) => part.endsWith("%") ? parseFloat(part) * 2.55 : parseFloat(part);
  const alpha = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  const rgba: [number, number, number, number] = [channel(parts[0]), channel(parts[1]), channel(parts[2]), alpha];
  return rgba.every((number) => Number.isFinite(number)) ? rgba : null;
}

/** "#rrggbb", lowercase, each channel clamped and rounded. */
export function rgbHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0")).join("")}`;
}

/** One 2D context per document, to read colors the computed style leaves unconverted (oklch). */
const painters = new WeakMap<Document, CanvasRenderingContext2D | null>();

function painter(doc: Document): CanvasRenderingContext2D | null {
  if (painters.has(doc)) return painters.get(doc)!;
  let context: CanvasRenderingContext2D | null = null;
  try {
    const canvas = doc.createElement("canvas");
    canvas.width = canvas.height = 1;
    context = typeof canvas.getContext === "function" ? canvas.getContext("2d", { willReadFrequently: true }) : null;
  } catch {
    context = null;
  }
  painters.set(doc, context);
  return context;
}

/**
 * A CSS color as it renders inside `host` (theme variables, light-dark(),
 * relative colors) → "#rrggbb"; null if not opaque or unknown. `scheme`
 * forces light-dark() to one side.
 */
export function resolveColor(host: HTMLElement, css: string, scheme?: "light" | "dark"): string | null {
  try {
    const doc = host.ownerDocument;
    const view = doc?.defaultView;
    if (!doc || typeof view?.getComputedStyle !== "function") return null;
    // The binding's observer ignores whatever carries nf-canvas-ui, so the probe is no canvas change.
    const probe = doc.createElement("span");
    probe.className = "nf-canvas-ui";
    probe.style.setProperty("position", "absolute");
    probe.style.setProperty("visibility", "hidden");
    probe.style.setProperty("pointer-events", "none");
    probe.style.setProperty("color", css);
    if (scheme) probe.style.setProperty("color-scheme", scheme);
    host.append(probe);
    let value: string | undefined;
    try {
      value = view.getComputedStyle(probe).color;
    } finally {
      probe.remove();
    }
    if (!value) return null;
    let rgba = parseRgb(value);
    if (!rgba) {
      // A color the style leaves in its own space, e.g. oklch(…): paint it and read the pixel.
      const context = painter(doc);
      if (!context) return null;
      // A value the context cannot read leaves the stand-in, which is no answer.
      const standIn = "#010203";
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = standIn;
      context.fillStyle = value;
      if (String(context.fillStyle).toLowerCase() === standIn) return null;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      rgba = [r, g, b, a / 255];
    }
    return rgba[3] < 1 ? null : rgbHex(rgba[0], rgba[1], rgba[2]);
  } catch {
    return null;
  }
}
