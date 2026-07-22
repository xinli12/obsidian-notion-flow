export class Plugin {}
export class Component { load(){} unload(){} }
export class MarkdownRenderer { static async render(){} }
export class PluginSettingTab {}
export class EditorSuggest { constructor(){} setInstructions(){} }
export class Setting { constructor(){} setName(){return this} setDesc(){return this} addToggle(){return this} }
export class Notice { constructor(){} }
export class Scope { constructor(){} register(){} }
export class Modal {
  constructor() { this.contentEl = null; }
  open() {}
  close() {}
}
export const setIcon = () => {};
export const requestUrl = async () => ({ status: 200, headers: {}, text: "" });
export const htmlToMarkdown = (html) => html;
export const editorLivePreviewField = {};
export class Menu {
  addItem(cb) { cb({ setTitle(){return this}, setIcon(){return this}, onClick(){return this} }); return this; }
  addSeparator() { return this; }
  showAtMouseEvent() {}
}
