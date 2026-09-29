import { App, Modal } from "obsidian";
import { t } from "../i18n";
import { HelpSection, renderHelpSections } from "./help-sections";

/**
 * The editor's keyboard guide: a modal listing the plugin's shortcuts and
 * the words in its menus, section by section. The sections are data the
 * caller assembles (main.ts knows the commands and their current hotkeys),
 * so this module depends on nothing but the renderer.
 */
export class ShortcutsModal extends Modal {
  /** `onCustomize`: the footer becomes a "Customize in Hotkeys" button
   * that closes the guide and runs it (the plugin opens Obsidian's Hotkeys
   * tab filtered to its commands); without it the footer is a note. */
  constructor(
    app: App,
    private readonly sections: HelpSection[],
    private readonly footer?: string,
    private readonly onCustomize?: () => void
  ) {
    super(app);
    // A guide is read, not filled in: Obsidian would otherwise focus its
    // first control — the footer button — so Enter would leave for Hotkeys.
    (this as unknown as { hasInitialInputFocus?: boolean }).hasInitialInputFocus = false;
  }

  onOpen(): void {
    const title = t("Keyboard shortcuts");
    // setTitle arrived in Obsidian 1.5; older builds still have the bare title element.
    if (typeof this.setTitle === "function") this.setTitle(title);
    else this.titleEl?.setText(title);
    this.modalEl.classList.add("nf-help-modal");
    renderHelpSections(this.contentEl, this.sections, "nf-help");
    const doc = this.contentEl.ownerDocument;
    const footer = doc.createElement("p");
    footer.className = "nf-help-footer";
    const customize = this.onCustomize;
    if (customize) {
      const button = doc.createElement("button");
      button.textContent = t("Customize in Hotkeys");
      button.addEventListener("click", () => {
        this.close();
        customize();
      });
      footer.append(button);
    } else {
      footer.textContent = this.footer ?? t("Change these under Settings → Hotkeys.");
    }
    this.contentEl.append(footer);
  }

  onClose(): void {
    this.contentEl.replaceChildren();
  }
}
