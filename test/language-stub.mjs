import { GFM, parser } from "@lezer/markdown";

// A real Markdown parse (GFM: strikethrough, tables) so tree-driven code
// paths — clear formatting, inline syntax groups — behave like in-app.
// Obsidian-specific nodes (Highlight "==") are not covered by this stub.
export const syntaxTree = (state) =>
  parser.configure([GFM]).parse(state.doc.toString());
