export { EditorOperationScope, operationLifecycle } from "../src/editor/operation-scope";
export { BlockClipboard } from "../src/editor/block-clipboard";
export { CommentController } from "../src/features/comments";
export { CommentPopover } from "../src/ui/comment-popover";
export { searchSlashCommands, slashCommandEnabled, scoreSlashCommand, slashPrefixMatch } from "../src/core/slash-search";
export { listMarkerBackspacePlan } from "../src/core/list-backspace";
export {
  enclosingMarkdownLink, isValidLinkDest, normalizeLinkDest, rewriteMarkdownLink, unlinkMarkdownLink,
  codeSpanRanges, linkCardTarget, markdownLinksOnLine, wikiLinksOnLine, enclosingWikiLink, wikiLinkFields,
} from "../src/core/markdown-links";
export { LinkPopover } from "../src/ui/link-popover";
export { cachedColorTagPairs, findColorTagPairs } from "../src/core/inline-tags";
export { guard, guardAsync } from "../src/editor/safe-build";
export { tsvToMarkdownTable } from "../src/core/tsv-table";
export { keyLabel, chordLabel, commandShortcut, chordTakenByOther, parseChord } from "../src/core/keys";
export { renderHelpSections } from "../src/ui/help-sections";
export { ShortcutsModal } from "../src/ui/shortcuts-modal";
export {
  STYLE_HUES, COMPONENT_KEYS, COLOR_KEYS, COLOR_VALUES, COLOR_KEY_LABELS, CODE_THEME_IDS, LEGACY_STYLE_DEFAULTS, STYLE_SCHEMA,
  NOTE_STYLE_DEFAULTS, PALETTES, LOOKS, COMPONENTS, NOTE_STYLE_CLASSES, NOTE_STYLE_VARS,
  resolveNoteStyle, computeBodyStyle, overriddenKeys, followAll, withPreview, migrateStyleSettings, canvasPaletteFor,
  applyBodyStyle, clearBodyStyle,
} from "../src/features/style-presets";
export { APPEARANCE_PRESETS } from "../src/canvas/appearance";
export { languageLabel, canonicalLanguage } from "../src/core/code-languages";
export { whatsNewRows, WHATS_NEW_ITEMS } from "../src/ui/whats-new";
export { createCaptionEditingExtensions, captionJoinGuard, clampCaptionDeletion } from "../src/editor/caption-lifecycle";
