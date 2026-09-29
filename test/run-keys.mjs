import assert from "node:assert/strict";
import * as features from "./features.mjs";

const { keyLabel, chordLabel, commandShortcut, renderHelpSections, ShortcutsModal } = features;

/* The obsidian stub reports Platform.isMacOS = false, so labels are spelled out;
 * macOS labels are checked through the explicit `mac` parameter. */
assert.equal(keyLabel("Mod+B"), "Ctrl+B");
assert.equal(keyLabel("Alt+Shift+↑↓"), "Alt+Shift+↑↓");
assert.equal(keyLabel("Space"), "Space", "the Space word goes through t()");
assert.equal(keyLabel("Enter / Alt+Enter"), "Enter / Alt+Enter", "free text keeps its words (canvas guide)");
assert.equal(keyLabel("Mod+/"), "Ctrl+/");
assert.equal(keyLabel("Mod+Shift+H", true), "⌘⇧H", "keyLabel takes the platform too");
assert.equal(chordLabel(["Mod", "Shift"], "1"), "Ctrl+Shift+1");
assert.equal(chordLabel(["Mod"], "b"), "Ctrl+B", "single letters are shown upper-case");
assert.equal(chordLabel(["Alt", "Shift"], "ArrowUp"), "Alt+Shift+↑", "arrows become glyphs");
assert.equal(chordLabel([], "ArrowLeft"), "←");
assert.equal(chordLabel(["Mod"], "Enter"), "Ctrl+↩", "Enter becomes ↩");
assert.equal(chordLabel([], "Escape"), "Escape", "other keys keep their name");

/* One notation: tight glyphs on macOS, "+"-joined words elsewhere, in Obsidian's modifier order. */
assert.equal(chordLabel(["Mod", "Shift"], "h", true), "⌘⇧H");
assert.equal(chordLabel(["Shift", "Mod"], "H", true), "⌘⇧H", "canonical modifier order");
assert.equal(chordLabel(["Ctrl", "Alt"], "K", true), "⌃⌥K", "Ctrl is ⌃ on a Mac");
assert.equal(chordLabel(["Meta"], "K", false), "Win+K");
assert.equal(chordLabel(["Mod"], "Enter", true), "⌘↩");
assert.equal(chordLabel(["Mod", "Alt", "Shift"], "Enter", true), "⌘⌥⇧↩");
assert.equal(chordLabel(["Mod"], "+", true), "⌘+", "a plus key is kept");
assert.equal(chordLabel(["Mod"], " ", false), "Ctrl+Space");
assert.equal(chordLabel(["Mod", "Ctrl"], "B", false), "Ctrl+B", "Mod and Ctrl are one modifier off macOS");
assert.equal(chordLabel(["Mod", "Meta"], "B", true), "⌘B", "Mod and Meta are one modifier on macOS");
assert.equal(chordLabel(["Mod"], "\\", true), "⌘\\");

/* ---- commandShortcut: Obsidian's bindings first, a fallback only when it is free ---- */
const mgr = (custom, defaults) => ({
  getHotkeys: (id) => custom[id],
  getDefaultHotkeys: (id) => defaults[id],
  get customKeys() { return { ...custom }; },
  defaultKeys: defaults,
});
const hk = (modifiers, key) => ({ modifiers, key });
assert.equal(commandShortcut({}, "x", "Mod+B"), "Ctrl+B", "no hotkey manager: the labelled fallback");
assert.equal(commandShortcut(null, "x", "Mod+B"), "Ctrl+B");
assert.equal(commandShortcut({}, "x", null), null, "no fallback either: nothing to show");
assert.equal(commandShortcut({}, "x", "Mod+Enter"), "Ctrl+↩", "a string fallback reads like a bound chord");
assert.equal(commandShortcut({}, "x", "Mod++"), "Ctrl++");
assert.equal(commandShortcut(null, "x", hk(["Mod", "Alt"], "Enter")), "Ctrl+Alt+↩", "a Hotkey-object fallback");
assert.equal(commandShortcut({ hotkeyManager: {} }, "x", "Mod+K"), "Ctrl+K", "a manager with neither method: fallback");
assert.equal(commandShortcut({ hotkeyManager: { getHotkeys: () => { throw new Error("private"); } } }, "x", "Mod+K"), "Ctrl+K",
  "a throwing private API is contained");
assert.equal(commandShortcut({ hotkeyManager: { getHotkeys: () => { throw new Error("private"); } } }, "x", null), null);
assert.equal(commandShortcut({ hotkeyManager: mgr({}, { x: [hk(["Mod"], "b")] }) }, "x", null), "Ctrl+B", "a default binding");
assert.equal(commandShortcut({ hotkeyManager: mgr({ x: [hk(["Mod", "Shift"], "b")] }, { x: [hk(["Mod"], "b")] }) }, "x", "Mod+B"),
  "Ctrl+Shift+B", "a custom binding beats the default");
assert.equal(commandShortcut({ hotkeyManager: mgr({ x: [] }, { x: [hk(["Mod"], "b")] }) }, "x", "Mod+B"), null,
  "an explicitly unbound command shows no chord, not even its fallback");
assert.equal(commandShortcut({ hotkeyManager: mgr({}, {}) }, "x", "Mod+E"), "Ctrl+E", "unbound and the fallback is free");
const preview = { "markdown:toggle-preview": [hk(["Mod"], "E")] };
assert.equal(commandShortcut({ hotkeyManager: mgr({}, preview) }, "editor:toggle-code", "Mod+E"), null,
  "a fallback another command owns by default is not advertised");
assert.equal(commandShortcut({ hotkeyManager: mgr(preview, {}) }, "editor:toggle-code", "Mod+E"), null,
  "nor one it owns by a custom binding");
assert.equal(commandShortcut({ hotkeyManager: mgr({ "markdown:toggle-preview": [] }, preview) }, "editor:toggle-code", "Mod+E"),
  "Ctrl+E", "a default freed by an empty custom list no longer counts");
assert.equal(commandShortcut({ hotkeyManager: mgr({}, { other: [hk(["Ctrl"], "e")] }) }, "x", "Mod+E"), null,
  "Mod is Ctrl off macOS when comparing chords");
assert.equal(commandShortcut({ hotkeyManager: mgr({}, { other: [hk(["Meta"], "e")] }) }, "x", "Mod+E"), "Ctrl+E",
  "Meta is not Mod off macOS");
assert.equal(commandShortcut({ hotkeyManager: mgr({}, { x: [{ modifiers: ["Mod"], code: "KeyE" }] }) }, "x", null), "Ctrl+E",
  "a code-only hotkey is labelled by its key");
assert.equal(commandShortcut({ hotkeyManager: mgr({}, { x: [{ modifiers: ["Alt"], code: "Digit1" }] }) }, "x", null), "Alt+1");
assert.equal(commandShortcut({ hotkeyManager: mgr({}, { x: [{ modifiers: ["Mod"] }, hk(["Alt"], "k")] }) }, "x", null), "Alt+K",
  "an entry without a key is skipped");
assert.equal(commandShortcut({ hotkeyManager: mgr({}, { other: [{ modifiers: ["Mod"], code: "KeyE" }] }) }, "x", "Mod+E"), null,
  "a code-only binding of another command takes the chord too");
const withCommands = (known) => ({ hotkeyManager: mgr({}, preview), commands: { findCommand: (id) => (known.includes(id) ? { id } : undefined) } });
assert.equal(commandShortcut(withCommands([]), "editor:toggle-code", "Mod+E"), "Ctrl+E",
  "a command that no longer exists does not own its chord");
assert.equal(commandShortcut(withCommands(["markdown:toggle-preview"]), "editor:toggle-code", "Mod+E"), null);
assert.equal(commandShortcut({ hotkeyManager: mgr({}, { x: [hk(["Mod"], "E")] }) }, "y", "Mod+E"), null,
  "the lookup is per command id");
const asked = [];
const spyManager = { getHotkeys: (id) => { asked.push(id); return undefined; }, getDefaultHotkeys: () => [hk([], "F1")] };
assert.equal(commandShortcut({ hotkeyManager: spyManager }, "nf:help", null), "F1");
assert.deepEqual(asked, ["nf:help"], "the command id is what gets looked up");
const bound = { hotkeyManager: { getHotkeys(id) { return this.keys[id]; }, keys: { x: [hk(["Mod"], "j")] } } };
assert.equal(commandShortcut(bound, "x", null), "Ctrl+J", "manager methods are called on the manager (never detached)");

/* parseChord and chordTakenByOther, when the feature entry re-exports them. */
if (features.parseChord) {
  const { parseChord } = features;
  assert.deepEqual(parseChord("Mod+Shift+H"), { modifiers: ["Mod", "Shift"], key: "H" });
  assert.deepEqual(parseChord("Mod++"), { modifiers: ["Mod"], key: "+" });
  assert.deepEqual(parseChord("Escape"), { modifiers: [], key: "Escape" });
}
if (features.chordTakenByOther) {
  const { chordTakenByOther } = features;
  assert.equal(chordTakenByOther({ hotkeyManager: mgr({}, { x: [hk(["Mod"], "E")] }) }, "Mod+E", "x"), false,
    "a command's own default does not count");
  assert.equal(chordTakenByOther({}, "Mod+E", "x"), false, "no manager: nothing is known to be taken");
  const meta = { hotkeyManager: mgr({}, { other: [hk(["Meta"], "E")] }) };
  assert.equal(chordTakenByOther(meta, "Mod+E", "x", true), true, "Mod is Meta on macOS");
  assert.equal(chordTakenByOther(meta, "Mod+E", "x", false), false);
}

/* ---- help sections: a minimal DOM fixture ---- */
class Element {
  constructor(doc, tag) {
    this.ownerDocument = doc; this.tag = tag; this.className = ""; this.textContent = ""; this.children = [];
    this.classList = { add: (cls) => { this.className = (this.className + " " + cls).trim(); } };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren() { this.children = []; }
  setText(text) { this.textContent = text; }
  addEventListener(type, listener) { (this.listeners ??= {})[type] = listener; }
}
const doc = { createElement: (tag) => new Element(doc, tag) };
const container = new Element(doc, "div");
renderHelpSections(container, [
  { title: "Formatting", rows: [
    { keys: ["Mod+B", "Mod+I"], desc: "Bold, italic" },
    { words: ["Turn into"], keys: ["Mod+/"], desc: "Change the block type" },
    { desc: "A row of prose only" },
  ] },
  { title: "Blocks", rows: [] },
], "nf-help");
assert.equal(container.children.length, 2);
const [formatting, blocks] = container.children;
assert.equal(formatting.tag, "section");
assert.equal(formatting.className, "nf-help-section");
assert.equal(formatting.children[0].className, "nf-help-heading");
assert.equal(formatting.children[0].textContent, "Formatting");
assert.equal(formatting.children.length, 4, "heading plus three rows");
const [, bold, turnInto, prose] = formatting.children;
assert.equal(bold.className, "nf-help-row");
const [keysCell, textCell] = bold.children;
assert.equal(keysCell.className, "nf-help-keys");
assert.deepEqual(keysCell.children.map((k) => [k.tag, k.className, k.textContent]), [
  ["kbd", "nf-help-key", "Ctrl+B"], ["kbd", "nf-help-key", "Ctrl+I"],
], "chords are labelled <kbd>s");
assert.equal(textCell.className, "nf-help-text");
assert.equal(textCell.textContent, "Bold, italic");
assert.deepEqual(turnInto.children[0].children.map((k) => [k.tag, k.className, k.textContent]), [
  ["kbd", "nf-help-key", "Ctrl+/"], ["span", "nf-help-word", "Turn into"],
], "keys come first, then words as spans");
assert.equal(prose.children[0].children.length, 0, "a row may have neither keys nor words");
assert.equal(blocks.children.length, 1, "an empty section still shows its heading");

/* ---- the modal fills its content from the sections ---- */
const modal = new ShortcutsModal({}, [{ title: "Blocks", rows: [{ keys: ["Mod+D"], desc: "Duplicate" }] }]);
modal.modalEl = new Element(doc, "div");
modal.titleEl = new Element(doc, "div");
modal.contentEl = new Element(doc, "div");
// The stub Modal may carry setTitle (Obsidian 1.5+); hide it to exercise
// the bare title element older builds have.
modal.setTitle = undefined;
modal.onOpen();
assert.equal(modal.modalEl.className, "nf-help-modal");
assert.equal(modal.titleEl.textContent, "Keyboard shortcuts", "without setTitle the title element is written");
{
  const titled = new ShortcutsModal({}, []);
  let title = null;
  titled.setTitle = (text) => { title = text; return titled; };
  titled.modalEl = new Element(doc, "div");
  titled.titleEl = new Element(doc, "div");
  titled.contentEl = new Element(doc, "div");
  titled.onOpen();
  assert.equal(title, "Keyboard shortcuts", "with setTitle the title goes through it");
}
assert.equal(modal.contentEl.children.length, 2, "one section and the footer");
assert.equal(modal.contentEl.children[0].className, "nf-help-section");
const footer = modal.contentEl.children[1];
assert.equal(footer.tag, "p");
assert.equal(footer.className, "nf-help-footer");
assert.equal(footer.textContent, "Change these under Settings → Hotkeys.");
modal.onClose();
assert.equal(modal.contentEl.children.length, 0, "closing empties the content");
const custom = new ShortcutsModal({}, [], "Custom footer");
custom.modalEl = new Element(doc, "div");
custom.titleEl = new Element(doc, "div");
custom.contentEl = new Element(doc, "div");
custom.onOpen();
assert.equal(custom.contentEl.children[0].textContent, "Custom footer", "a caller's footer replaces the default");
{
  // R2-W2-MAIN item 19: with onCustomize the footer is a button that closes
  // the guide and opens the Hotkeys tab.
  let opened = 0, closed = 0;
  const guide = new ShortcutsModal({}, [], "Note", () => { opened++; });
  guide.close = () => { closed++; };
  guide.modalEl = new Element(doc, "div");
  guide.titleEl = new Element(doc, "div");
  guide.contentEl = new Element(doc, "div");
  guide.onOpen();
  const foot = guide.contentEl.children[0];
  assert.equal(foot.className, "nf-help-footer");
  const [button] = foot.children;
  assert.equal(button?.tag, "button", "the footer holds a button");
  assert.equal(button.textContent, "Customize in Hotkeys");
  button.listeners.click();
  assert.deepEqual([closed, opened], [1, 1], "a click closes the guide, then opens Hotkeys");
}
console.log("PASS keys: one chord notation (macOS and elsewhere), bound/unbound/taken command hotkeys, help sections and the shortcuts modal" + (features.chordTakenByOther ? "" : " (parseChord/chordTakenByOther not re-exported: tested through commandShortcut)"));
