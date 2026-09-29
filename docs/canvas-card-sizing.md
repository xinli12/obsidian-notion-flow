# Canvas card sizing

`src/canvas/sizing.ts` contains the size policy without reading or changing the DOM. All saved card dimensions use Canvas coordinates.

## Content fitting

Call `fittedCardSize({ before, measured, fitWidth, mode, empty, depth, grow })` after measuring the rendered preview. `measured` includes the full card padding and any small rounding allowance; the policy does not add padding again.

| Mode | Ordinary card minimum | Root minimum | Fitted maximum | Width behavior |
| --- | --- | --- | --- | --- |
| `comfortable` | 112 × 52 | 160 × 64 | 480 × 640 | Fit only when `fitWidth` is true |
| `compact` | 80 × 36 | 112 × 48 | 480 × 640 | Fit only when `fitWidth` is true |
| `preserve` | Height 52 | Height 64 | Height 640 | Keep the original width |

The root is identified by `depth: 0`. An omitted depth is an ordinary card. Explicit width preservation keeps a valid original width exactly, even outside the automatic-fit limits. Content measurements are rounded up to whole pixels to avoid clipping fractional text heights.

An empty card uses the appropriate minimum height and, when width fitting is enabled, minimum width. A zero, negative, or non-finite measurement falls back to the corresponding original dimension. If that original dimension is also invalid, the policy uses the mode minimum. Invalid measurements must not shrink a hidden or detached card.

Width fitting measures a bounded set of candidate widths in the rendered Markdown's CSS scope, balancing width against height. A medium topic may wrap to a few lines rather than forming a long thin strip. The chosen layout receives 12 local pixels of horizontal breathing room, and height is read again at that final width. Rich media keep the bounded reading width; candidates with horizontal overflow are rejected. The clone retains the real scrollbar gutter, and the measured sizer height plus both vertical insets protects against flex overflow omitting bottom padding.

With `grow`, used for free (non-map) cards after their text changes, the card keeps its width and any height it already has, and only gains height for overflowing words, up to 640 (a card already taller keeps its own height). The binding also stops that growth `24` units short of the next card below it, or of the bottom of a group holding it (`roomBelow` in `graph.ts`), so a growing card never covers another.

An editor closing queues a fit after the preview has had time to render. If its preview is unavailable, the fit retries up to five times, 120 ms apart. The original text, dimensions and history step remain attached to the request, so undo, another action or a manual resize can invalidate it. Successful delayed fits still join the original edit's undo step.

## Editing in place

A card is edited where it is: at the canvas zoom, in its own look, and at exactly its own size when the editor opens — no minimum panel, no zoom compensation, no offset — so nothing jumps or scales when editing starts.

```ts
const box = editorSurfaceSize(cardSize, neededSize, widthLimit);
```

All three sizes are in local Canvas coordinates. The box never goes below the card. It grows only for words that need more room: taller up to 640, and — only when `widthLimit` is positive, for a card that is width-fitted afterwards — wider up to `min(widthLimit, 480)`. A card already larger than a limit keeps its own size. Never save the box to the card or use it for map layout.

`src/canvas/editor-surface.ts` observes the native CodeMirror editor inside its iframe and computes `neededSize` so that the editor matches what the card will be once the editor closes:

- **Height.** The card keeps its height while its words fit, give or take the 6 units a fitted card keeps spare (so a card sized a pixel tight by hand does not grow as its editor opens). Beyond that it takes the height of a card fitted to its words: CodeMirror's full content height (including offscreen lines and widgets), the topic inset or Canvas's full 16-unit spacers, the card's borders, and the fit's 6 units of slack. Deleting words shrinks it back to the card.
- **Width.** Only a map topic that is fitted afterwards (`canvasAutoFit`, not *Preserve width*) widens, and only if each of its lines fitted on one line of the card when editing began. It then widens with its longest line (measured with the editor's resolved font on a 2D canvas), plus 12 units of room, as far as a width fit keeps a line whole — `ONE_LINE_REACH` (8) lines' height of width, from `measureCard`'s cost model — and wraps past that.
- **Direction.** `EditorGeometry.anchor` keeps the side facing the card's line in place: a topic left of its parent grows leftwards, one above or below grows both ways (and one above grows upwards), a centre grows both ways, everything else grows right and down.

A map topic's editor also takes its preview's resolved inset, alignment (plain topics only) and colour, and a topic shorter than its card is centred vertically as on the card; the first heading of any card starts at the top without a note's heading lead-in. The editor's page is made see-through so the card's own background shows. Composition pauses resizing until confirmation.

Input, composition, content mutation and resize listeners are removed when editing ends, the node/file is replaced, or the plugin unloads. Native editor initialization retries are bounded. Keys are bound as soon as Canvas constructs the editor — before it is moved into its iframe — so no early `Enter` or `Tab` reaches the editor unhandled.

Run `node test/run-canvas-sizing.mjs` and `node test/run-canvas-editor-surface.mjs` to check the policy and the surface. The repository test runner discovers both automatically.


## Hierarchy typography

`src/canvas/typography.ts` supplies bounded ratios relative to Obsidian's note font size. Plain topics at depths 0 / 1 / 2 / 3 / 4+ use 1.5 / 1.25 / 1.0625 / 1 / 0.9375 and weights 700 / 600 / 500 / 400 / 400. Rich notes use 1.25 / 1.125 / 1.0625 / 1 / 0.9375, with a 500-weight centre and ordinary 400-weight body elsewhere. CSS enforces a 14px floor. The ratios are display-only and never modify Markdown or add saved node fields.

Refresh applies the policy to map text cards only when Canvas appearance is enabled. Changing levels or moving between maps applies the new style before measuring affected cards within the structural action's history step. Releasing a map preserves card widths while adjusting height for ordinary text. Automatic fits still honor the auto-fit setting and preserve-width mode. Undo and redo restore saved geometry while refreshing display variables.

The native editor lives in a separate document, so `CanvasEditorSurface` copies the preview's resolved font size, weight, family, line height, letter spacing, colour, inset, alignment and card heading proportions into its scroller before CodeMirror measures (a polished free card takes only its heading proportions). These temporary variables are removed when the preview is unavailable, appearance turns off, or editing ends. Typography synchronization remains active when the comfortable editing surface is disabled; in that mode it applies no temporary dimensions or comfort styling. Typography and editor-surface regression tests cover the depth policy and both documents' style lifecycle.
