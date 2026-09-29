import type { EditorView } from "@codemirror/view";
import { editorSurfaceSize } from "./sizing";
import type { CardSize } from "./sizing";
import { FIT_SLACK, ONE_LINE_REACH } from "./measurement";

const PROPERTIES = ["--nf-editor-width", "--nf-editor-height", "--nf-editor-x", "--nf-editor-y"];
// A topic's words keep their place when its editor opens: the same type,
// color and leading, and the same inset inside the card. A one-line topic
// also keeps its alignment (see syncTypography).
const TOPIC_PROPERTIES = [
  "font-size", "font-weight", "font-family", "line-height", "letter-spacing", "color", "text-align",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
] as const;
/** What only a topic of plain words keeps: a note's lists and headings edit as they do anywhere. */
const PLAIN_ONLY = new Set<string>(["text-align"]);
// These are the card-specific heading proportions. Native Markdown retains
// its own heading weights, emphasis and other syntax styling.
const HEADING_PROPERTIES = [
  "--h1-size", "--h2-size", "--h3-size", "--h4-size", "--h5-size", "--h6-size",
  "--h1-line-height", "--h2-line-height", "--h3-line-height",
] as const;
const TYPOGRAPHY_PROPERTIES = [
  ...TOPIC_PROPERTIES.map(name => [name, `--nf-topic-${name}`] as const),
  ...HEADING_PROPERTIES.map(name => [name, name] as const),
];
const HEADING_NAMES = new Set<string>(HEADING_PROPERTIES);
/** The most room Canvas gives a card's words above and below them. */
const NATIVE_INSET = 16;

/** How the editor of one card may grow; its binding knows the card's place in a map. */
export interface EditorGeometry {
  /** The card's saved size, in canvas units. */
  size: CardSize;
  /** The card is fitted to its words afterwards, so it may widen while each line still fits on one. */
  widen: boolean;
  /**
   * What stays put as the card grows, from 0 (its left or top edge) through
   * 0.5 (its centre) to 1 (its right or bottom edge): the side facing the
   * line it hangs from, so a topic grows away from its parent.
   */
  anchor: { x: number; y: number };
  /** The spare width a fitted card keeps beside its words; a card with no box keeps less. */
  room?: number;
}

/**
 * The native editor lives in an iframe: wrapper observers cannot see typing.
 * While a text card is typed in, this keeps the editor in the card's own box
 * and type, and lets the card grow in place — never zooming, never moving to
 * a panel of its own — only when its words need more room.
 */
export class CanvasEditorSurface {
  private cm: EditorView | null = null;
  private observer: MutationObserver | null = null;
  private resize: ResizeObserver | null = null;
  private frame = 0;
  private readyTimer = 0;
  private readyAttempts = 0;
  private disposed = false;
  private text: string | null = null;
  private font = "";
  private longest = 0;
  /** Whether every line of the card fitted on one line when editing began: only then does it widen. */
  private oneLine: boolean | null = null;
  private context: CanvasRenderingContext2D | null = null;
  /** The editor document's page, made see-through so the card's own color shows. */
  private page: { el: HTMLElement; background: string } | null = null;
  private win: Window & typeof globalThis;

  constructor(
    private el: HTMLElement,
    private native: () => EditorView | undefined,
    private geometry: () => EditorGeometry,
    private comfortable: () => boolean = () => true,
    /** Called once the native editor exists, with the editor itself. */
    private onEditor: (cm: EditorView) => void = () => {},
  ) {
    this.win = el.ownerDocument.defaultView!;
    el.addEventListener("load", this.update, true);
    if (this.win.ResizeObserver) this.resize = new this.win.ResizeObserver(this.update);
    // The editor opens at exactly the card's box: nothing moves or grows yet.
    if (this.comfortable()) this.apply(geometry().size);
    // Canvas builds its editor at once and moves it into the iframe a moment
    // later; binding now leaves no gap for an early Enter or Tab.
    const cm = native();
    if (cm?.dom && cm.contentDOM && typeof cm.requestMeasure === "function") this.bind(cm);
    this.update();
  }

  update = () => {
    if (this.disposed || this.frame) return;
    this.frame = this.win.requestAnimationFrame(() => {
      this.frame = 0;
      if (this.disposed) return;
      const cm = this.native();
      if (!cm?.dom || !cm.scrollDOM || typeof cm.requestMeasure !== "function") {
        // Its iframe can load before CodeMirror is constructed, and the outer
        // canvas cannot observe that construction. Keep this wait bounded.
        if (!this.readyTimer && this.readyAttempts++ < 5) {
          this.readyTimer = this.win.setTimeout(() => {
            this.readyTimer = 0;
            this.update();
          }, 80);
        }
        return;
      }
      if (this.readyTimer) this.win.clearTimeout(this.readyTimer);
      this.readyTimer = 0;
      if (cm !== this.cm) this.bind(cm);
      this.syncTypography(cm);
      const comfortable = this.comfortable();
      cm.scrollDOM.classList.toggle("nf-canvas-native-editor", comfortable);
      this.syncPage(cm, comfortable);
      if (!comfortable) {
        this.clearSize();
        // Font hierarchy also applies to the ordinary, unexpanded editor.
        cm.requestMeasure();
        return;
      }
      // Canvas keeps a little room above and below a card's words, sized by
      // the card's height. Tied to the card, not to the growing editor, it
      // is the same while the card grows as on the card itself.
      const inset = `${Math.min(NATIVE_INSET, Math.max(0, (this.geometry().size.height - 30) / 10))}px`;
      if (cm.scrollDOM.style.getPropertyValue("--nf-editor-inset") !== inset) cm.scrollDOM.style.setProperty("--nf-editor-inset", inset);
      // CodeMirror's measure phase includes offscreen lines and rendered
      // widgets. DOM scrollHeight alone includes the viewport's minimum height
      // and cannot shrink after deletion.
      cm.requestMeasure({ key: this, read: () => this.measure(cm), write: (size) => {
        if (!this.disposed && this.comfortable() && cm === this.cm && size) this.apply(size);
      } });
    });
  };

  private bind(cm: EditorView) {
    this.unbind();
    this.cm = cm;
    for (const event of ["input", "compositionend", "keyup"]) cm.dom.addEventListener(event, this.update);
    this.observer = new this.win.MutationObserver(this.update);
    this.observer.observe(cm.contentDOM, { subtree: true, childList: true, characterData: true });
    this.resize?.observe(cm.contentDOM);
    // An editor not yet moved into its iframe is measured once it arrives.
    if (cm.dom.isConnected) cm.requestMeasure();
    this.onEditor(cm);
  }

  /** Copy the card's resolved type into the iframe, which cannot inherit it. */
  private syncTypography(cm: EditorView) {
    // Map topics carry their whole type; any polished card its compact headings.
    const topic = !!this.el.style.getPropertyValue("--nf-size");
    const card = topic || this.el.classList.contains("nf-canvas-text");
    const preview = card ? this.el.querySelector<HTMLElement>(".markdown-preview-view") : null;
    const style = preview ? this.win.getComputedStyle(preview) : null;
    const enabled = topic && !!style && parseFloat(style.fontSize) > 0;
    const plain = enabled && !this.el.classList.contains("nf-canvas-map-rich");
    cm.scrollDOM.classList.toggle("nf-canvas-topic-editor", enabled);
    cm.scrollDOM.classList.toggle("nf-canvas-card-headings", !!style);
    for (const [name, property] of TYPOGRAPHY_PROPERTIES) {
      const value = !style ? ""
        : HEADING_NAMES.has(name) ? style.getPropertyValue(name)
          : enabled && (plain || !PLAIN_ONLY.has(name)) ? style.getPropertyValue(name) : "";
      if (value && cm.scrollDOM.style.getPropertyValue(property) !== value) cm.scrollDOM.style.setProperty(property, value);
      else if (!value && cm.scrollDOM.style.getPropertyValue(property)) cm.scrollDOM.style.removeProperty(property);
    }
    // A topic shorter than its card sits in the middle of it, in the editor
    // as on the card.
    const sizer = plain && typeof preview!.querySelector === "function"
      ? preview!.querySelector<HTMLElement>(":scope > .markdown-preview-sizer") : null;
    const centred = !!sizer && /center/.test(this.win.getComputedStyle(sizer).justifyContent);
    cm.scrollDOM.classList.toggle("nf-canvas-topic-centred", centred);
  }

  /** The editor's page is opaque; with it see-through, the card keeps its own color while typed in. */
  private syncPage(cm: EditorView, clear: boolean) {
    const body = clear ? cm.dom.ownerDocument.body : null;
    if (this.page && this.page.el !== body) {
      if (this.page.background) this.page.el.style.setProperty("background-color", this.page.background);
      else this.page.el.style.removeProperty("background-color");
      this.page = null;
    }
    if (body && !this.page) {
      this.page = { el: body, background: body.style.getPropertyValue("background-color") };
      body.style.setProperty("background-color", "transparent");
    }
  }

  private measure(cm: EditorView): CardSize | null {
    if (this.disposed || !this.comfortable() || cm !== this.cm || cm.composing || !cm.dom.isConnected) return null;
    const { size, widen, room = FIT_SLACK.width } = this.geometry();
    const win = cm.dom.ownerDocument.defaultView!;
    const px = (value: string) => parseFloat(value) || 0;
    const scroller = win.getComputedStyle(cm.scrollDOM);
    const container = this.el.querySelector<HTMLElement>(".canvas-node-container");
    const frame = container ? this.win.getComputedStyle(container) : null;
    // Room above and below the words: a topic's inset, or Canvas's own room,
    // tied to the card's height while it keeps its size (see update) and at
    // its fullest on a card fitted to its words.
    const topic = cm.scrollDOM.classList.contains("nf-canvas-topic-editor");
    const inset = topic ? px(scroller.paddingTop) + px(scroller.paddingBottom)
      : 2 * px(cm.scrollDOM.style.getPropertyValue("--nf-editor-inset"));
    const borderY = frame ? px(frame.borderTopWidth) + px(frame.borderBottomWidth) : 0;
    const tight = cm.contentHeight + inset + borderY;
    let needed = 0;
    let limit = 0;
    if (widen) {
      const style = win.getComputedStyle(cm.contentDOM);
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const text = cm.state.doc.toString();
      const key = `${font}/${style.letterSpacing}`;
      if (text !== this.text || key !== this.font) {
        this.text = text;
        this.font = key;
        this.context ??= this.el.ownerDocument.createElement("canvas").getContext("2d");
        const context = this.context;
        if (context) {
          context.font = font;
          if ("letterSpacing" in context) context.letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
        }
        let longest = 0;
        // Past the width limit a card wraps anyway; so do long drafts.
        for (const line of text.slice(0, 20000).split("\n", 200)) {
          longest = Math.max(longest, context?.measureText(line.replace(/\t/g, "    ")).width
            ?? line.length * cm.defaultCharacterWidth);
        }
        this.longest = longest;
      }
      // The stable scrollbar gutter takes its room whether a scrollbar shows or not.
      const gutter = Math.max(0, cm.scrollDOM.offsetWidth - cm.scrollDOM.clientWidth || 0);
      const chrome = px(scroller.paddingLeft) + px(scroller.paddingRight) + gutter
        + (frame ? px(frame.borderLeftWidth) + px(frame.borderRightWidth) : 0);
      needed = this.longest + chrome;
      limit = ONE_LINE_REACH * cm.defaultLineHeight + chrome + FIT_SLACK.width;
    }
    // The card keeps its size while its words fit, give or take the room a
    // fitted card keeps spare, so a card sized a pixel tight by hand does not
    // grow as its editor opens. Beyond that it takes the height of a card
    // fitted to its words, so closing the editor moves nothing further.
    const height = tight <= size.height + FIT_SLACK.height ? 0
      : cm.contentHeight + (topic ? inset : 2 * NATIVE_INSET) + borderY + FIT_SLACK.height;
    // A card whose words already wrapped when editing began keeps its width.
    // A one-line card widens with its line as far as a fitted card keeps a
    // line whole; past that, the line wraps as it will on the card.
    this.oneLine ??= needed <= size.width + 1;
    const width = this.oneLine && needed > size.width + 1 ? needed + room : 0;
    return editorSurfaceSize(size, { width, height }, limit);
  }

  private apply(size: CardSize) {
    if (!this.comfortable()) return;
    const { size: card, anchor } = this.geometry();
    const offset = (grown: number, own: number, part: number) =>
      Number.isFinite(grown - own) && grown > own ? -(grown - own) * part : 0;
    const values = [`${size.width}px`, `${size.height}px`,
      `${offset(size.width, card.width, anchor.x)}px`, `${offset(size.height, card.height, anchor.y)}px`];
    let changed = false;
    PROPERTIES.forEach((name, index) => {
      if (this.el.style.getPropertyValue(name) !== values[index]) {
        changed = true;
        this.el.style.setProperty(name, values[index]);
      }
    });
    // A width change rewraps the native editor on its next measure pass. Read
    // its height again at that final width, without touching selection or undo.
    if (changed && this.cm) { this.cm.requestMeasure(); this.update(); }
  }

  private unbind() {
    this.observer?.disconnect();
    this.observer = null;
    if (this.cm) {
      this.resize?.unobserve(this.cm.contentDOM);
      this.cm.scrollDOM.classList.remove("nf-canvas-native-editor", "nf-canvas-topic-editor", "nf-canvas-topic-centred",
        "nf-canvas-card-headings");
      for (const [, property] of TYPOGRAPHY_PROPERTIES) this.cm.scrollDOM.style.removeProperty(property);
      this.cm.scrollDOM.style.removeProperty("--nf-editor-inset");
      this.syncPage(this.cm, false);
      for (const event of ["input", "compositionend", "keyup"]) this.cm.dom.removeEventListener(event, this.update);
    }
    this.cm = null;
  }

  private clearSize() {
    for (const name of PROPERTIES) {
      if (this.el.style.getPropertyValue(name)) this.el.style.removeProperty(name);
    }
  }

  destroy() {
    this.disposed = true;
    if (this.frame) this.win.cancelAnimationFrame(this.frame);
    if (this.readyTimer) this.win.clearTimeout(this.readyTimer);
    this.unbind();
    this.resize?.disconnect();
    this.el.removeEventListener("load", this.update, true);
    this.clearSize();
  }
}
