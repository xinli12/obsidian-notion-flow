/** A card size measured without resizing or saving the live Canvas node. */
export interface MeasuredCard {
  width: number;
  height: number;
}

const PREVIEW = ".canvas-node-content.markdown-embed > .markdown-embed-content > .markdown-preview-view";
const SLACK = 6;
const WIDTH_SLACK = 12;
const WIDTH_STEP = 24;
const HEIGHT_COST = 4;
/** What a fitted card adds to its words: room below them, and room for a few more letters. */
export const FIT_SLACK = { height: SLACK, width: WIDTH_SLACK };
/**
 * The spare width of a card drawn without a box: only enough to keep its
 * words on their lines, since the gap shows between them and the line that
 * leaves the card.
 */
export const HUG_SLACK = 2;
/**
 * A width fit keeps a line on one line only while that is cheaper than two:
 * the height cost of the second line buys this many lines' height of width.
 */
export const ONE_LINE_REACH = 2 * HEIGHT_COST;

/**
 * Measure the existing rendered Markdown in the card's own CSS scope. A
 * detached/offscreen card whose preview has not been rendered cannot be fit.
 * `width` is the available width. A width fit balances the rendered width and
 * height, allowing a long topic to wrap instead of stretching into a thin strip.
 * Extra horizontal room keeps the result away from its next wrapping boundary.
 * With `sample`, the clone holds that one paragraph instead of the card's own
 * words, so a blank card (whose preview renders nothing) measures the height
 * a line of its type takes.
 */
export function measureCard(
  nodeEl: HTMLElement, width: number, minWidth: number, fitWidth: boolean, room = WIDTH_SLACK, sample?: string,
): MeasuredCard | null {
  const parent = nodeEl.parentElement;
  const win = nodeEl.ownerDocument?.defaultView;
  if (!nodeEl.isConnected || !parent || !win || !Number.isFinite(width) || width <= 0
    || typeof nodeEl.cloneNode !== "function") return null;
  const source = nodeEl.querySelector<HTMLElement>(PREVIEW);
  const sourceSizer = source?.querySelector<HTMLElement>(":scope > .markdown-preview-sizer");
  if (!source || !sourceSizer || (!sourceSizer.childElementCount && sample === undefined)) return null;

  const clone = nodeEl.cloneNode(true) as HTMLElement;
  clone.classList.add("nf-canvas-ui", "nf-canvas-measuring");
  clone.classList.remove("is-editing", "is-selected", "is-focused", "is-dragging",
    "nf-canvas-hidden", "nf-canvas-offstage", "nf-canvas-muted", "nf-canvas-editing");
  clone.setAttribute("aria-hidden", "true");
  clone.setAttribute("inert", "");
  clone.removeAttribute("id");
  for (const child of Array.from(clone.querySelectorAll("[id]"))) child.removeAttribute("id");
  for (const child of Array.from(clone.querySelectorAll(".is-editing"))) child.classList.remove("is-editing");

  const container = clone.querySelector<HTMLElement>(".canvas-node-container");
  const preview = clone.querySelector<HTMLElement>(PREVIEW);
  const sizer = preview?.querySelector<HTMLElement>(":scope > .markdown-preview-sizer");
  if (!container || !preview || !sizer) return null;
  const set = (el: HTMLElement, values: Record<string, string>) => {
    for (const [name, value] of Object.entries(values)) el.style.setProperty(name, value, "important");
  };
  set(clone, {
    position: "fixed", left: "-100000px", top: "0", transform: "none",
    visibility: "hidden", opacity: "0", "pointer-events": "none", "z-index": "-1",
    display: "block", height: "1px", "min-height": "0", "max-height": "none",
    "min-width": "0", "max-width": "none",
    // Measure at the maximum vertical inset, including on legacy tiny cards.
    // Growing the result must not then increase the padding and clip its text.
    "--canvas-node-height": "640px",
  });
  set(container, {
    width: "100%", height: "100%", "min-width": "0", "max-width": "none",
    "min-height": "0", "max-height": "none", transform: "none",
  });
  set(preview, {
    display: "flex", height: "1px", "min-height": "0", "max-height": "none",
    // Keep the native scrollbar gutter: dropping a stable gutter gives this
    // clone more text width than the fitted card and misses a wrapped line.
    "overflow-y": "hidden",
  });
  set(sizer, { "min-height": "0", "padding-bottom": "0" });
  if (sample !== undefined) {
    // The shape Canvas renders a one-line card in: the pusher, then
    // <div class="el-p"><p dir="auto">…</p></div>. A blank card has neither,
    // and without the pusher Obsidian keeps the paragraph's top margin.
    const doc = clone.ownerDocument;
    let pusher = Array.from(sizer.children).find((child) => child.classList.contains("markdown-preview-pusher"));
    if (!pusher) {
      pusher = doc.createElement("div");
      pusher.className = "markdown-preview-pusher";
      pusher.setAttribute("style", "width: 1px; height: 0.1px; margin-bottom: 0px;");
    }
    const block = doc.createElement("div");
    block.className = "el-p";
    const paragraph = doc.createElement("p");
    paragraph.setAttribute("dir", "auto");
    paragraph.textContent = sample;
    block.append(paragraph);
    sizer.replaceChildren(pusher, block);
  }

  try {
    parent.appendChild(clone);
    const measurements = new Map<number, { height: number; overflow: boolean }>();
    const sizeAt = (candidate: number) => {
      const previous = measurements.get(candidate);
      clone.style.setProperty("width", `${candidate}px`, "important");
      clone.style.setProperty("--canvas-node-width", `${candidate}px`);
      if (previous) return previous;
      const previewStyle = win.getComputedStyle(preview);
      const inset = (parseFloat(previewStyle.paddingTop) || 0) + (parseFloat(previewStyle.paddingBottom) || 0);
      // In a height-constrained flex box, scrollHeight can end at the overflowing
      // child's bottom and omit the parent's trailing padding. Measure the
      // complete sizer plus both insets as well, so fitting retains that space.
      const contentHeight = sizer.scrollHeight;
      const height = Math.max(preview.scrollHeight,
        Number.isFinite(contentHeight) ? contentHeight + inset : 0);
      const result = {
        height,
        overflow: Number.isFinite(preview.scrollWidth) && preview.scrollWidth > preview.clientWidth + 1,
      };
      measurements.set(candidate, result);
      return result;
    };
    // A preserved fractional width must never be measured at a wider integer:
    // even half a pixel can hide a wrapped line at the saved width.
    const maximum = Math.max(1, Math.floor(width));
    const minimum = Number.isFinite(minWidth) ? Math.min(maximum, Math.max(1, Math.ceil(minWidth))) : maximum;
    const baseline = sizeAt(maximum);
    if (!Number.isFinite(baseline.height) || baseline.height <= 0 || preview.clientWidth <= 0) return null;
    // Images shrink with their container, while code and tables can overflow
    // horizontally without gaining height. Height alone cannot find their
    // useful width: keep the bounded reading width for these rich cards.
    const rich = sizer.querySelector("img, video, audio, iframe, canvas, table, pre, svg:not(.svg-icon), .internal-embed, .math-block, .mermaid");
    let fittedWidth = maximum;
    if (fitWidth && !rich && minimum < maximum) {
      const lower = Math.max(1, minimum - room);
      const withRoom = (value: number) => Math.min(maximum, Math.max(minimum, value + room));
      const cost = (value: number, height: number) => withRoom(value) + HEIGHT_COST * height;
      let bestWidth = maximum;
      let best = baseline;
      const step = Math.max(WIDTH_STEP, Math.ceil((maximum - lower) / 16));
      // Compare actual wrapping at a small bounded set of widths. Charging for
      // both dimensions keeps short labels on one line, allows medium topics a
      // few lines, and gives long notes the available reading width. Rich media
      // are excluded above because their height is not monotonic with width.
      for (let candidate = lower; candidate < maximum; candidate += step) {
        const current = sizeAt(candidate);
        if (!Number.isFinite(current.height) || current.height <= 0 || current.overflow) continue;
        const nextCost = cost(candidate, current.height);
        const bestCost = cost(bestWidth, best.height);
        if (best.overflow || nextCost < bestCost || nextCost === bestCost && current.height < best.height) {
          bestWidth = candidate;
          best = current;
        }
      }
      // Refine only the chosen wrapping layout, then leave room for a few more
      // letters. Sampling and refinement never resize the live Canvas node.
      let lo = lower;
      let hi = bestWidth;
      if (best.overflow) lo = hi;
      while (lo < hi) {
        const middle = Math.floor((lo + hi) / 2);
        const current = sizeAt(middle);
        if (Number.isFinite(current.height) && current.height > 0
          && current.height <= best.height && !current.overflow) hi = middle;
        else lo = middle + 1;
      }
      fittedWidth = withRoom(hi);
    }
    const { height } = sizeAt(fittedWidth);
    if (!Number.isFinite(height) || height <= 0) return null;
    const style = win.getComputedStyle(container);
    const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
    return { width: fittedWidth, height: Math.ceil(height + border + SLACK) };
  } finally {
    clone.remove();
  }
}
