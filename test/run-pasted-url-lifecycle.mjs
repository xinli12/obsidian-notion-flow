import assert from 'node:assert/strict';
import Plugin from './bundle.mjs';
globalThis.window = globalThis;
globalThis.document = { body: { classList: { remove() {} }, style: { removeProperty() {} } } };
const url = 'https://example.com';
const response = title => ({ status: 200, headers: { 'content-type': 'text/html' }, text: `<title>${title}</title>` });
function fixture() {
  const pending = [];
  globalThis.__nfRequestUrl = () => new Promise(resolve => pending.push(resolve));
  const cm = { dom: { isConnected: true } };
  const writes = [];
  const editor = { cm, text: url, getLine() { return this.text; }, replaceRange(link) { this.text = link; writes.push(link); } };
  const leaf = { view: { editor, file: { path: 'A.md' } } };
  const plugin = new Plugin();
  plugin.settings = { ...plugin.settings, pasteUrlTitles: true };
  plugin.app = { workspace: { getLeavesOfType: () => [leaf] } };
  const start = () => plugin.linkifyPastedUrl(editor, url, { line: 0, ch: 0 });
  return { pending, plugin, editor, leaf, cm, writes, start };
}
for (const [name, invalidate] of [
  ['other file', f => { f.leaf.view.file.path = 'B.md'; }],
  ['closed editor', f => { f.cm.dom.isConnected = false; }],
  ['replaced editor', f => { f.editor.cm = { dom: { isConnected: true } }; }],
  ['edited URL', f => { f.editor.text = 'keep this edit'; }],
  ['setting disabled', f => { f.plugin.settings.pasteUrlTitles = false; }],
  ['plugin unloaded', f => { f.plugin.onunload(); }],
]) {
  const f = fixture();
  const job = f.start();
  invalidate(f);
  f.pending[0](response('Title'));
  await job;
  assert.deepEqual(f.writes, [], name);
}
{
  const f = fixture();
  const job = f.start();
  f.pending[0](response('Title'));
  await job;
  assert.deepEqual(f.writes, [`[Title](${url})`]);
}
{
  const f = fixture();
  const first = f.start();
  const second = f.start();
  f.pending[0](response('Stale'));
  await first;
  assert.deepEqual(f.writes, []);
  f.pending[1](response('Current'));
  await second;
  assert.deepEqual(f.writes, [`[Current](${url})`]);
}
delete globalThis.__nfRequestUrl;
console.log('PASS pasted URL lifecycle: file identity, editor replacement, disposal, setting changes and request ordering');
