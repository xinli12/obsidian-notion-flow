/** Card dimensions are always in Canvas coordinates, before its zoom transform. */
export interface CardSize {
  width: number;
  height: number;
}

export type CanvasCardSizeMode = 'comfortable' | 'compact' | 'preserve';

export interface FitCardSizeOptions {
  before: CardSize;
  /** The complete rendered card box, including padding and any rounding slack. */
  measured: CardSize;
  fitWidth: boolean;
  mode: CanvasCardSizeMode;
  empty?: boolean;
  /** Only depth 0 is a root; an omitted depth is an ordinary card. */
  depth?: number;
  /**
   * Only ever taller: a free card keeps its width and the room it was given,
   * and gains height for words that overflow it, up to the height limit.
   */
  grow?: boolean;
  /**
   * The topic draws no box (plain words or an underline), so its card hugs
   * its words: a narrow minimum width, and its line leaves where they end.
   * The height minimum stays, so it is still easy to click. An empty topic
   * keeps the ordinary minimum, for a placeholder that can be read.
   */
  boxless?: boolean;
}

/** The narrowest card that draws no box around its words. */
export const BOXLESS_MIN_WIDTH = 40;

const MAX_CARD = { width: 480, height: 640 };

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Apply a sizing policy after measuring rendered content. Manual widths survive
 * ordinary editing; only an explicit width fit (except in preserve mode) changes
 * them. Invalid measurements leave that dimension as it was, so hidden or
 * detached cards never collapse because their DOM reports zero.
 */
export function fittedCardSize(options: FitCardSizeOptions): CardSize {
  const { before, measured, fitWidth, mode, empty, depth } = options;
  const compact = mode === 'compact';
  const root = depth === 0;
  const minimum = compact
    ? { width: root ? 112 : 80, height: root ? 48 : 36 }
    : { width: root ? 160 : 112, height: root ? 64 : 52 };
  if (options.boxless && !empty && !root) minimum.width = BOXLESS_MIN_WIDTH;
  const previous = {
    width: positive(before.width) ? before.width : minimum.width,
    height: positive(before.height) ? before.height : minimum.height,
  };
  const fit = (value: number, old: number, min: number, max: number): number =>
    empty ? min : positive(value) ? clamp(Math.ceil(value), min, max) : old;

  if (options.grow) {
    return {
      width: previous.width,
      height: !empty && positive(measured.height) && measured.height > previous.height
        ? Math.min(Math.ceil(measured.height), Math.max(previous.height, MAX_CARD.height)) : previous.height,
    };
  }
  return {
    width: fitWidth && mode !== 'preserve'
      ? fit(measured.width, previous.width, minimum.width, MAX_CARD.width)
      : previous.width,
    height: fit(measured.height, previous.height, minimum.height, MAX_CARD.height),
  };
}

/**
 * The box a new, blank topic opens at: what an empty topic fits to at this
 * depth. The binding then gives it the height of one line of its own type.
 */
export function blankTopicSize(mode: CanvasCardSizeMode, depth: number): CardSize {
  return fittedCardSize({
    before: { width: 0, height: 0 }, measured: { width: 0, height: 0 },
    fitWidth: true, mode: mode === 'preserve' ? 'comfortable' : mode, empty: true, depth,
  });
}

/**
 * The box a card takes while it is typed in, in canvas units. It starts as
 * the card itself, so opening an editor moves, scales and resizes nothing,
 * and it keeps the canvas zoom: the words stay the size they are on the card.
 * It grows only for words that need more room — taller up to the card-height
 * limit, and wider up to `widthLimit` (at most the card-width limit) where
 * the card is fitted to its words afterwards. A card already larger than a
 * limit keeps its own size. Never persist this box: it is not the card's
 * geometry.
 */
export function editorSurfaceSize(card: CardSize, needed: CardSize, widthLimit = 0): CardSize {
  const own = { width: positive(card.width) ? card.width : 112, height: positive(card.height) ? card.height : 52 };
  const grow = (need: number, size: number, limit: number): number =>
    positive(need) && need > size ? Math.min(Math.ceil(need), Math.max(size, limit)) : size;
  return {
    width: grow(needed.width, own.width, Math.min(positive(widthLimit) ? widthLimit : 0, MAX_CARD.width)),
    height: grow(needed.height, own.height, MAX_CARD.height),
  };
}
