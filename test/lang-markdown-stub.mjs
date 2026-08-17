// The visual-column editor installs a real Markdown language in Obsidian.
// Pure model tests supply their own parser through language-stub.mjs and do
// not mount EditorViews, so an inert extension keeps this bundle DOM-free.
export const markdown = () => [];
