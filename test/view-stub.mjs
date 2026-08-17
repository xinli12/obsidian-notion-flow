export const ViewPlugin = { fromClass: (c) => c };
export class EditorView {}
export class WidgetType {}
export class ViewUpdate {}
/* Decorations are recorded rather than rendered. The ranges a build pass
 * produces ARE what a block looks like while it is being edited, so tests
 * assert on them directly: kind, span, and the widget that replaces it. */
const decoration = (kind) => (spec) => ({
  kind,
  spec,
  range: (from, to) => ({ kind, spec, from, to: to ?? from }),
});
export const Decoration = {
  line: decoration("line"),
  replace: decoration("replace"),
  mark: decoration("mark"),
  widget: decoration("widget"),
  set: (ranges, sort) => {
    const list = Array.isArray(ranges) ? ranges.slice() : [];
    if (sort) list.sort((a, b) => a.from - b.from || a.to - b.to);
    list.size = list.length;
    return list;
  },
  none: Object.assign([], { size: 0 }),
};
export class DecorationSet {}
export const keymap = { of: (bindings) => bindings };
export function runScopeHandlers() { return false; }
