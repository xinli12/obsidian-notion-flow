import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { nodeData, edgeData, keyEvent, fixture } from './canvas-fixture.mjs';

// A card's notes (read by clicking their icon) and links (followed by
// clicking their icons), several of each, and links to other cards written
// into a card's words: the stored fields, the link picker's lines, outlines,
// typing `[[^`, and the canvas controller — icons, the note panel, undo,
// and following links.
const directory = await mkdtemp(join(tmpdir(), 'notion-flow-canvas-notes-links-'));
try {
  const outfile = join(directory, 'bundle.mjs');
  await build({
    stdin: {
      contents: [
        `export * from './src/canvas/enhancements.ts';`,
        `export * from './src/canvas/attachments.ts';`,
        `export { linkChoices, CardLinkModal } from './src/canvas/link-picker.ts';`,
        `export { cardLinkTrigger, matchCards, CardLinkSuggest } from './src/canvas/card-links.ts';`,
        `export { linkTargetAt } from './src/canvas/editor-keys.ts';`,
        `export { CardSearchModal } from './src/canvas/search.ts';`,
        `export { branchOutline } from './src/canvas/outline.ts';`,
        `export { buildForest } from './src/canvas/graph.ts';`,
        `export { MarkdownRenderer } from 'obsidian';`,
      ].join('\n'),
      resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts',
    },
    bundle: true, alias: { obsidian: fileURLToPath(new URL('./obsidian-stub.mjs', import.meta.url)) },
    format: 'esm', platform: 'node', outfile, logLevel: 'silent',
  });
  const {
    CanvasEnhancements, CardLinkModal, CardSearchModal, MarkdownRenderer, NOTE_KEY, LINK_KEY, parseCardLink, linkOf, linksOf, linkValues,
    noteOf, notesOf, withNote, withNotes, withLink, withLinks, withLinkAt, cardLinkText, cardRefOf, withoutCardLinks, webAddress,
    outlineAttachments, toggleTask, linkChoices, cardLinkTrigger, matchCards, CardLinkSuggest, branchOutline, buildForest, linkTargetAt,
  } = await import(pathToFileURL(outfile).href);

  /* ---------- stored links ---------- */
  assert.deepEqual(parseCardLink('https://example.com/a?b=1'), { kind: 'url', url: 'https://example.com/a?b=1' });
  assert.deepEqual(parseCardLink(' mailto:me@example.com '), { kind: 'url', url: 'mailto:me@example.com' });
  assert.equal(parseCardLink('obsidian://open?vault=V&file=N').kind, 'url');
  for (const code of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,hi', 'vbscript:x']) assert.equal(parseCardLink(code), null, `${code} never runs`);
  assert.deepEqual(parseCardLink('[[Project plan#Goals|the plan]]'),
    { kind: 'note', linktext: 'Project plan#Goals', path: 'Project plan', subpath: '#Goals', display: 'the plan' });
  assert.deepEqual(parseCardLink('[[Folder/Note.md]]'), { kind: 'note', linktext: 'Folder/Note.md', path: 'Folder/Note.md', subpath: '', display: 'Note' });
  assert.equal(parseCardLink('[[Note#^block1]]').display, 'Note › block1');
  assert.equal(parseCardLink('![[Embedded]]').linktext, 'Embedded');
  assert.equal(parseCardLink('Plain name').kind, 'note', 'a bare name reads as a note, as in a wikilink');
  assert.deepEqual(parseCardLink('#abc123'), { kind: 'card', id: 'abc123' });
  assert.deepEqual(parseCardLink('#^abc123'), { kind: 'card', id: 'abc123' }, 'a block of this canvas is a card');
  assert.deepEqual(parseCardLink('[[#^abc123|Budget]]'), { kind: 'card', id: 'abc123' }, 'a card link copied from a card’s words links that card');
  for (const bad of ['', '   ', '#', '# a b', '[[broken', 'x]]', '[[]]', '[[|alias]]', '[[#two words]]', 42, null, undefined, {}]) assert.equal(parseCardLink(bad), null, `${JSON.stringify(bad)} is no link`);
  assert.equal(linkOf({ [LINK_KEY]: '#x' }).kind, 'card');
  assert.equal(linkOf(undefined), null);

  /* ---------- several links on one card ---------- */
  {
    const base = nodeData('a');
    assert.deepEqual(linkValues({ [LINK_KEY]: 'https://a.example' }), ['https://a.example'], 'one link is a string, as it always was');
    assert.deepEqual(linkValues({ [LINK_KEY]: ['https://a.example', ' [[Plan]] ', 'https://a.example', 'javascript:x', 7, '#b'] }),
      ['https://a.example', '[[Plan]]', '#b'], 'several are a list: trimmed, each once, the unusable left out');
    assert.deepEqual(linksOf({ [LINK_KEY]: ['#b', '[[Plan]]'] }).map((link) => link.kind), ['card', 'note']);
    assert.equal(linkOf({ [LINK_KEY]: ['#b', '[[Plan]]'] }).id, 'b', 'the first link leads');
    assert.equal(withLinks(base, ['https://a.example'])[LINK_KEY], 'https://a.example', 'one link is kept as a string');
    assert.deepEqual(withLinks(base, ['https://a.example', '[[Plan]]', 'https://a.example'])[LINK_KEY], ['https://a.example', '[[Plan]]']);
    assert.equal(LINK_KEY in withLinks({ ...base, [LINK_KEY]: ['#b', '#c'] }, []), false, 'no links remove the field');
    const two = withLinks(base, ['#b', '#c']);
    assert.deepEqual(withLinkAt(two, 1, '[[Plan]]')[LINK_KEY], ['#b', '[[Plan]]'], 'a link changes in its place');
    assert.equal(withLinkAt(two, 0, null)[LINK_KEY], '#c', 'one taken away leaves the other, as a string');
    assert.deepEqual(withLinkAt(two, 2, 'https://x.example')[LINK_KEY], ['#b', '#c', 'https://x.example'], 'past the last, a link is added');
    assert.equal(withLinkAt(two, 1, '#b')[LINK_KEY], '#b', 'a link the card has already is kept once');
    assert.equal(withLink(two, '#d')[LINK_KEY], '#d', 'withLink makes it the only one');
    assert.equal(withLink(base, 'https://x.example').x, base.x, 'the rest of the card is untouched');
  }

  /* ---------- stored notes, several on one card ---------- */
  {
    const base = nodeData('a');
    assert.equal(withNote(base, '   \n ')[NOTE_KEY], undefined, 'blank words store no note');
    assert.equal(withNote(base, 'Line\n\n  ')[NOTE_KEY], 'Line', 'trailing blank lines are dropped');
    assert.equal(withNote(base, '  - indented\n')[NOTE_KEY], '  - indented', 'leading indentation is kept');
    assert.equal(NOTE_KEY in withNote({ ...base, [NOTE_KEY]: 'old' }, ''), false, 'emptying a note removes the field');
    assert.equal(noteOf({ [NOTE_KEY]: 7 }), '', 'a note is text or nothing');
    assert.deepEqual(notesOf({ [NOTE_KEY]: ['First', '  ', 'Second', 3] }), ['First', 'Second'], 'several notes are a list; blank ones do not count');
    assert.deepEqual(withNotes(base, ['First\n', '', 'Second'])[NOTE_KEY], ['First', 'Second']);
    assert.equal(withNotes(base, ['Only', ' '])[NOTE_KEY], 'Only', 'one note is kept as a string');
    assert.equal(noteOf({ [NOTE_KEY]: ['First', 'Second'] }), 'First\n\nSecond', 'the find bar reads them all');
    assert.equal(withLink(base, ' https://x.example ')[LINK_KEY], 'https://x.example');
    assert.equal(withLink(base, 'javascript:x')[LINK_KEY], undefined, 'an unusable link is not stored');
    assert.equal(LINK_KEY in withLink({ ...base, [LINK_KEY]: 'https://x.example' }, null), false);
  }

  /* ---------- links to cards in a card's words ---------- */
  assert.equal(cardLinkText('abc123', 'Budget'), '[[#^abc123|Budget]]', 'a link to a block of this canvas, named by the card');
  assert.equal(cardLinkText('abc123', 'Budget', true), '[Budget](#^abc123)', 'or a Markdown link where the vault writes those');
  assert.equal(cardLinkText('abc123', 'Risks [draft] | v2\nmore'), '[[#^abc123|Risks draft v2 more]]', 'the name drops what a link’s text cannot hold');
  assert.equal(cardLinkText('abc123', '  '), '[[#^abc123|abc123]]');
  assert.deepEqual(cardRefOf('#^abc123'), { path: '', id: 'abc123' });
  assert.deepEqual(cardRefOf('#abc123'), { path: '', id: 'abc123' });
  assert.deepEqual(cardRefOf('Maps/Plan.canvas#^abc123'), { path: 'Maps/Plan.canvas', id: 'abc123' });
  for (const bad of ['Note', '#^two words', '#', '']) assert.equal(cardRefOf(bad), null, `${bad} names no card`);
  assert.equal(withoutCardLinks('See [[#^b|Risks]] and [the plan](#^root), [[#^c]]; keep [[Note#Goals|goals]] and ![pic](#^x)'),
    'See Risks and the plan, c; keep [[Note#Goals|goals]] and ![pic](#^x)', 'outside the canvas a card link is its name');

  // The link at the caret, as Mod+Enter reads it while a card is typed in.
  assert.equal(linkTargetAt('See [[#^b|the risks]] now', 8), '#^b');
  assert.equal(linkTargetAt('See [[#^b|the risks]] now', 4), '#^b', 'its ends included');
  assert.equal(linkTargetAt('See [[#^b|the risks]] now', 23), null, 'past it, no link');
  assert.equal(linkTargetAt('A [plan](#^root) and [site](<https://x.example/a b>)', 5), '#^root');
  assert.equal(linkTargetAt('A [plan](#^root) and [site](<https://x.example/a b>)', 30), 'https://x.example/a b');
  assert.equal(linkTargetAt('one\n[[Note#Goals|g]]', 8), 'Note#Goals', 'on its own line');

  /* ---------- ticking a task in a note ---------- */
  assert.equal(toggleTask('- [ ] a\n- [x] b', 0), '- [x] a\n- [x] b');
  assert.equal(toggleTask('- [ ] a\n- [x] b', 1), '- [ ] a\n- [ ] b');
  assert.equal(toggleTask('- [ ] a', 1), null, 'no such task');
  assert.equal(toggleTask('```\n- [ ] code\n```\n- [ ] real', 0), '```\n- [ ] code\n```\n- [x] real', 'tasks in code are not tasks');
  assert.equal(toggleTask('> - [ ] quoted\n1. [/] half', 1), '> - [ ] quoted\n1. [ ] half', 'a task marked with anything but a space is done');
  assert.equal(toggleTask('\t- [ ] nested', 0), '\t- [x] nested');
  assert.equal(toggleTask('- [ ]', 0), '- [x]', 'an empty task too');
  assert.equal(toggleTask('- [ ]x', 0), null, 'the box needs space after it');

  /* ---------- web addresses typed into the picker ---------- */
  assert.deepEqual(webAddress('https://a.example/c'), { url: 'https://a.example/c', explicit: true });
  assert.deepEqual(webAddress('<https://a.example>'), { url: 'https://a.example', explicit: true });
  assert.deepEqual(webAddress('www.example.com'), { url: 'https://www.example.com', explicit: true });
  assert.deepEqual(webAddress('example.com/docs'), { url: 'https://example.com/docs', explicit: false }, 'a bare domain might be a file name');
  for (const text of ['Project plan', 'javascript:alert(1)', 'localhost:3000', 'a b.com', '']) assert.equal(webAddress(text), null, text);

  /* ---------- outlines carry links and notes ---------- */
  assert.deepEqual(outlineAttachments('Topic', { [LINK_KEY]: 'https://x.example', [NOTE_KEY]: 'Why\n\nBecause' }),
    { first: '[Topic](https://x.example)', note: ['> Why', '>', '> Because'] });
  assert.equal(outlineAttachments('Topic', { [LINK_KEY]: '[[Plan#Goals]]' }).first, '[[Plan#Goals|Topic]]');
  assert.equal(outlineAttachments('[[File]]', { [LINK_KEY]: 'https://x.example' }).first, '[[File]] [↗](https://x.example)', 'link syntax is never nested');
  assert.equal(outlineAttachments('- [ ] task', { [LINK_KEY]: 'https://x.example' }).first, '- [ ] task [↗](https://x.example)', 'a task stays a task');
  assert.equal(outlineAttachments('Topic', { [LINK_KEY]: '#card' }).first, 'Topic', 'links between cards stay on the canvas');
  assert.equal(outlineAttachments('Topic', { [LINK_KEY]: 'https://x.example/a b' }).first, '[Topic](<https://x.example/a b>)');
  assert.deepEqual(outlineAttachments('Topic', {}), { first: 'Topic', note: [] });
  assert.deepEqual(outlineAttachments('Topic', { [LINK_KEY]: ['#card', 'https://x.example', '[[Plan]]'], [NOTE_KEY]: ['One', 'Two\nlines'] }),
    { first: '[Topic](https://x.example) [[Plan]]', note: ['> One', '>', '> Two', '> lines'] },
    'the first link wraps the words and the rest follow; each note is a paragraph of the quote');
  {
    const data = { nodes: [
      nodeData('root', 0, 0, { nfLayout: 'right', text: 'Root', [NOTE_KEY]: 'Centre note' }),
      nodeData('a', 400, 0, { text: 'A, see [[#^root|the root]]', [LINK_KEY]: 'https://a.example' }),
    ], edges: [edgeData('e', 'root', 'a')] };
    assert.equal(branchOutline(data, buildForest(data), 'root').markdown, '- Root\n  > Centre note\n\t- [A, see the root](https://a.example)',
      'Copy branch as outline and Export branch as note keep links and notes, and card links as their names');
  }

  /* ---------- the link picker's lines ---------- */
  {
    const files = [
      { path: 'Projects/Project plan.md', basename: 'Project plan', extension: 'md' },
      { path: 'Reading.md', basename: 'Reading', extension: 'md' },
      { path: 'img/diagram.png', basename: 'diagram', extension: 'png' },
      { path: 'notes.md', basename: 'notes', extension: 'md' },
    ];
    const sources = (extra = {}) => ({
      files, recent: ['Reading.md', 'Reading.md', 'gone.md'],
      cards: [{ id: 'c1', title: 'Budget', context: 'Plan' }, { id: 'c2', title: 'Risks', context: 'Plan' }],
      linktext: (file) => file.extension === 'md' ? file.basename : file.path,
      headings: (file) => file.basename === 'Project plan' ? [{ heading: 'Goals' }, { heading: 'Risks [draft] | v2' }] : [],
      current: null, currentLabel: '', ...extra,
    });
    const lines = (query, extra) => linkChoices(query, sources(extra)).map((choice) => [choice.kind, choice.value, choice.title]);
    assert.deepEqual(lines(''), [['file', '[[Reading]]', 'Reading'], ['card', '#c1', 'Budget'], ['card', '#c2', 'Risks']],
      'nothing typed: the notes opened lately, then the canvas’s cards');
    const current = { current: '[[Reading]]', currentLabel: 'Reading' };
    assert.deepEqual(lines('', current)[0], ['keep', '[[Reading]]', 'Reading'], 'the link being edited comes first');
    assert.deepEqual(lines('', current).at(-1), ['remove', null, 'Remove link'], 'and it can be removed, from the last line');
    assert.deepEqual(lines('https://new.example'), [['url', 'https://new.example', 'https://new.example']], 'a web address leaves no doubt');
    assert.deepEqual(lines('www.new.example', current), [['url', 'https://www.new.example', 'https://www.new.example'], ['remove', null, 'Remove link']]);
    const plan = lines('proj');
    assert.deepEqual(plan[0], ['file', '[[Project plan]]', 'Project plan'], 'notes match by name');
    assert.deepEqual(plan.at(-1), ['new', '[[proj]]', 'proj'], 'or a new note of the name typed');
    assert.deepEqual(lines('Project plan#go'), [['heading', '[[Project plan#Goals]]', 'Goals']], 'Note# lists its headings');
    assert.deepEqual(lines('Project plan#').map((line) => line[1]), ['[[Project plan#Goals]]', '[[Project plan#Risks draft v2]]'],
      'heading links drop the characters a link cannot hold');
    assert.ok(lines('bud').some(([kind, value]) => kind === 'card' && value === '#c1'), 'cards match by their words');
    assert.equal(lines('Reading').some(([kind]) => kind === 'new'), false, 'an existing note is not offered as new');
    assert.equal(lines('notes.md').some(([kind]) => kind === 'new'), false, 'nor is a file named with its extension');
    assert.deepEqual(lines('notes.md').find(([kind]) => kind === 'url'), ['url', 'https://notes.md', 'https://notes.md'], 'a bare domain is offered after the notes');
    assert.equal(lines('[[Reading]]')[0][1], '[[Reading]]', 'typed wikilink brackets are looked through');
    assert.deepEqual(lines('diag')[0], ['attachment', '[[img/diagram.png]]', 'diagram.png'], 'other files are files, not notes');
    assert.deepEqual(lines('#^c2'), [['card', '#c2', 'Risks']], 'a card named by its id');
    assert.deepEqual(lines('[[#^c1|Budget]]'), [['card', '#c1', 'Budget']], 'a card link copied from a card’s words finds its card');

    // Adding one more to a card that has links: its links first, to edit; what it links already is marked.
    const adding = { links: [{ value: '[[Reading]]', label: 'Reading' }, { value: '#c2', label: 'Risks' }] };
    assert.deepEqual(lines('', adding), [['edit', '[[Reading]]', 'Reading'], ['edit', '#c2', 'Risks'], ['card', '#c1', 'Budget']],
      'the card’s links come first, and are not listed again below');
    assert.equal(linkChoices('Read', sources(adding)).find((choice) => choice.value === '[[Reading]]')?.linked, true, 'a note linked already is marked');
    assert.equal(linkChoices('Risk', sources(adding)).find((choice) => choice.value === '#c2')?.linked, true, 'and so is a card');
    assert.equal(linkChoices('bud', sources(adding)).find((choice) => choice.value === '#c1')?.linked, undefined);
    assert.equal(linkChoices('', sources({ ...adding, ...current })).some((choice) => choice.kind === 'edit'), false, 'editing one link lists no others to edit');

    const chosen = [];
    const edited = [];
    const modal = new CardLinkModal({}, sources(current), 'Reading', (value) => chosen.push(value), (value) => edited.push(value));
    assert.equal(modal.limit, 30);
    modal.onChooseSuggestion(modal.getSuggestions('https://x.example')[0]);
    modal.onChooseSuggestion(modal.getSuggestions('')[0]);
    modal.onChooseSuggestion(modal.getSuggestions('').at(-1));
    assert.deepEqual(chosen, ['https://x.example', null], 'keeping the link changes nothing; Remove link passes null');
    const add = new CardLinkModal({}, sources(adding), '', (value) => chosen.push(value), (value) => edited.push(value));
    add.onChooseSuggestion(add.getSuggestions('')[1]);
    assert.deepEqual(edited, ['#c2'], 'one of the card’s links, chosen while adding, opens for editing');
    assert.equal(chosen.length, 2, 'and adds nothing');
  }

  /* ---------- typing a link to a card: [[^ ---------- */
  {
    assert.deepEqual(cardLinkTrigger('See [[^'), { start: 4, query: '' });
    assert.deepEqual(cardLinkTrigger('See [[^Bud'), { start: 4, query: 'Bud' });
    assert.deepEqual(cardLinkTrigger('[[#ris'), { start: 0, query: 'ris' }, 'a heading of this canvas is a card too');
    assert.deepEqual(cardLinkTrigger('[[#^two words'), { start: 0, query: 'two words' });
    for (const text of ['[[Note', '[[^^all blocks', '[[##all headings', '[[^done]] and', '[[^a|b', 'no link', '[[^a#b'])
      assert.equal(cardLinkTrigger(text), null, `${text} stays Obsidian’s`);
    const cards = [{ id: 'r', title: 'Plan', context: '' }, { id: 'b', title: 'Budget', context: 'Plan' }, { id: 'k', title: 'Risks', context: 'Plan' }];
    const fuzzy = (query) => (text) => text.toLowerCase().includes(query.toLowerCase()) ? { score: -text.length } : null;
    assert.deepEqual(matchCards(cards, '', 2, fuzzy).map((card) => card.id), ['r', 'b'], 'no words: the first cards');
    assert.deepEqual(matchCards(cards, 'plan', 30, fuzzy).map((card) => card.id), ['r', 'k', 'b'], 'a card named so first, then cards that sit there, best first');
    assert.deepEqual(matchCards(cards, 'zzz', 30, fuzzy), [], 'nothing found, nothing offered');

    const asked = [];
    const suggest = new CardLinkSuggest({}, { cardsFor: (editor) => { asked.push(editor); return editor.ours ? { cards, markdown: false } : null; } });
    let line = 'See [[^bud]]';
    const editor = {
      ours: true,
      getLine: () => line,
      getRange: (from, to) => line.slice(from.ch, to.ch),
      replaceRange(text, from, to) { line = line.slice(0, from.ch) + text + line.slice(to.ch); },
      setCursor(pos) { this.cursor = pos; },
    };
    const canvasFile = { extension: 'canvas' };
    const info = suggest.onTrigger({ line: 0, ch: 10 }, editor, canvasFile);
    assert.deepEqual(info, { start: { line: 0, ch: 4 }, end: { line: 0, ch: 10 }, query: 'bud' }, 'in a card being typed in, [[^ asks for a card');
    assert.equal(suggest.onTrigger({ line: 0, ch: 10 }, editor, { extension: 'md' }), null, 'a note keeps Obsidian’s block links');
    assert.equal(suggest.onTrigger({ line: 0, ch: 10 }, { ...editor, ours: false }, canvasFile), null, 'as does any editor but a card’s');
    assert.equal(suggest.onTrigger({ line: 0, ch: 3 }, editor, canvasFile), null);
    suggest.context = { editor, ...info };
    suggest.close = () => { suggest.closed = true; };
    const offered = suggest.getSuggestions(suggest.context);
    assert.ok(offered.some((card) => card.id === 'b'));
    suggest.selectSuggestion(cards[1]);
    assert.equal(line, 'See [[#^b|Budget]]', 'the link takes the brackets Obsidian closed as they were typed');
    assert.deepEqual(editor.cursor, { line: 0, ch: 18 }, 'the caret goes after it');
    assert.equal(suggest.closed, true);
  }

  /* ---------- the canvas: icons, the note panel, following links ---------- */
  const map = () => ({ nodes: [
    nodeData('root', 0, 0, { nfLayout: 'right', text: 'Plan' }),
    nodeData('a', 400, -200, { text: 'Budget', [NOTE_KEY]: 'Keep it **lean**', [LINK_KEY]: 'https://example.com/budget' }),
    nodeData('b', 400, 200, { text: 'Risks', [LINK_KEY]: '[[Risk register#Top risks]]' }),
    nodeData('a1', 800, -200, { text: 'Detail', [LINK_KEY]: '#b' }),
    nodeData('free', 0, 900, { text: 'Loose' }),
  ], edges: [edgeData('e-a', 'root', 'a'), edgeData('e-b', 'root', 'b'), edgeData('e-a1', 'a', 'a1')] });
  const files = [{ path: 'Risk register.md', basename: 'Risk register', extension: 'md' }];
  const setup = (data = map(), extra = {}) => {
    const f = fixture(CanvasEnhancements, data, {
      vault: { getFiles: () => files },
      metadataCache: { fileToLinktext: (file) => file.basename, getFileCache: () => ({ headings: [{ heading: 'Top risks' }] }) },
      ...extra,
    });
    f.opened = [];
    f.windows = [];
    f.hovers = [];
    f.copied = [];
    f.workspace.openLinkText = (...args) => { f.opened.push(args); };
    f.workspace.getLastOpenFiles = () => ['Risk register.md'];
    f.workspace.trigger = (name, info) => { f.hovers.push([name, info]); };
    f.doc.defaultView.open = (...args) => { f.windows.push(args); };
    f.doc.defaultView.navigator = { clipboard: { writeText: (text) => { f.copied.push(text); return Promise.resolve(); } } };
    f.doc.flush();
    return f;
  };
  const chipsOf = (f, id) => f.canvas.nodes.get(id).nodeEl.querySelector('.nf-canvas-chips');
  const chip = (f, id, kind, index = 0) => chipsOf(f, id)?.querySelectorAll('.nf-canvas-chip').filter((el) => el.dataset.chip === kind)[index];
  const panelOf = (f) => f.canvas.wrapperEl.querySelector('.nf-canvas-note-panel');
  const part = (f, cls) => panelOf(f)?.querySelector(cls);
  const parts = (f, cls) => panelOf(f)?.querySelectorAll(cls) ?? [];
  const press = (f, el, extra = {}) => {
    const event = { target: el, button: 0, isPrimary: true, pointerId: 1, clientX: 0, clientY: 0, detail: 1, ...extra };
    const down = f.canvas.wrapperEl.dispatch('pointerdown', event);
    const click = f.canvas.wrapperEl.dispatch('click', event);
    f.doc.flush();
    return { down, click };
  };
  const tb = (f, label) => f.canvas.wrapperEl.querySelector('.nf-canvas-toolbar').querySelectorAll('button')
    .find((item) => (item.getAttribute('aria-label') ?? '').split(' · ')[0] === label);
  // How many undo steps there are, and which one is current.
  const step = (f) => [f.canvas.history.data.length, f.canvas.history.current];
  const type = (f, text, index = 0) => {
    const input = parts(f, '.nf-canvas-note-input')[index];
    input.value = text;
    input.dispatch('input', {});
    f.doc.flush();
  };
  const menuTitles = () => globalThis.__nfShownMenus.at(-1).items.map((item) => item.title);
  const rendered = [];
  MarkdownRenderer.render = async (app, markdown, el) => { rendered.push(markdown); el.textContent = markdown; };

  {
    const f = setup();
    assert.deepEqual(chipsOf(f, 'a').querySelectorAll('.nf-canvas-chip').map((el) => el.dataset.chip), ['note', 'link'], 'a card shows its note, then its link');
    assert.ok(chipsOf(f, 'a').classList.contains('nf-canvas-ui'), 'the icons are the plugin’s, not a canvas change');
    assert.equal(chip(f, 'a', 'note').getAttribute('aria-label'), 'Show note', 'the note waits behind its icon');
    assert.equal(chip(f, 'a', 'note').classList.contains('has-count'), false, 'one note, no count');
    assert.equal(chip(f, 'a', 'link').dataset.kind, 'url');
    assert.equal(chip(f, 'a', 'link').getAttribute('aria-label'), 'Open example.com/budget');
    assert.equal(chip(f, 'b', 'link').dataset.kind, 'note');
    assert.equal(chip(f, 'b', 'link').getAttribute('aria-label'), 'Open note: Risk register › Top risks');
    assert.equal(chip(f, 'a1', 'link').getAttribute('aria-label'), 'Go to card: Risks');
    assert.ok(!chipsOf(f, 'root'), 'a card with neither has no icons');
    assert.ok(!chipsOf(f, 'free'));

    // Folding hides the icons with their card.
    f.canvas.selectOnly(f.canvas.nodes.get('a')); f.doc.flush();
    f.command('fold'); f.doc.flush();
    assert.ok(!chipsOf(f, 'a1'), 'a folded card takes its icons with it');
    f.command('fold'); f.doc.flush();
    assert.ok(chip(f, 'a1', 'link'));

    // Clicking the note icon shows the note beside its card, and selects the card.
    f.canvas.selectOnly(f.canvas.nodes.get('root')); f.doc.flush();
    const history = step(f);
    const { down, click } = press(f, chip(f, 'a', 'note'));
    assert.ok(down.defaultPrevented && click.defaultPrevented, 'the icon keeps its press from Canvas (no drag, resize or selection)');
    assert.ok(panelOf(f), 'the note opens');
    assert.equal([...f.canvas.selection][0]?.id, 'a', 'its card is selected');
    assert.equal(part(f, '.nf-canvas-note-title').textContent, 'Budget');
    assert.equal(part(f, '.nf-canvas-note-body').textContent, 'Keep it **lean**', 'the note is drawn as Markdown');
    assert.equal(rendered.at(-1), 'Keep it **lean**');
    assert.equal(part(f, '.nf-canvas-note-body').hidden, false);
    assert.equal(part(f, '.nf-canvas-note-input'), null, 'read first, edit on request');
    assert.equal(part(f, '.nf-canvas-note-tools').hidden, false, 'with its own Edit and Delete');
    assert.equal(part(f, '.nf-canvas-note-add').hidden, false, 'and Add in the head');
    assert.equal(tb(f, 'Note').getAttribute('aria-pressed'), 'true');
    press(f, chip(f, 'a', 'note'));
    assert.ok(!panelOf(f), 'the icon closes it again');
    assert.deepEqual(step(f), history, 'reading changes nothing');

    // A double click is one click, not open-then-close.
    press(f, chip(f, 'a', 'note'));
    press(f, chip(f, 'a', 'note'), { detail: 2 });
    assert.ok(panelOf(f));
    const dbl = f.canvas.wrapperEl.dispatch('dblclick', { target: chip(f, 'a', 'note'), clientX: 0, clientY: 0 });
    assert.ok(dbl.defaultPrevented, 'no card edit, new card or native fit from a double click on an icon');

    // Esc with the keyboard on the canvas closes it; a click elsewhere does too.
    f.canvas.wrapperEl.focus();
    f.canvas.wrapperEl.dispatch('keydown', keyEvent('Escape', f.canvas.wrapperEl));
    f.doc.flush();
    assert.ok(!panelOf(f), 'Esc closes the note first');
    assert.equal([...f.canvas.selection][0]?.id, 'a', 'and keeps the card selected');
    press(f, chip(f, 'a', 'note'));
    for (const handler of f.doc.listeners.get('pointerdown') ?? []) handler({ target: part(f, '.nf-canvas-note-body'), clientX: 0, clientY: 0 });
    assert.ok(panelOf(f), 'a press inside the note keeps it');
    for (const handler of [...(f.doc.listeners.get('pointerdown') ?? [])]) handler({ target: f.canvas.nodes.get('root').nodeEl, clientX: 0, clientY: 0 });
    f.doc.flush();
    assert.ok(!panelOf(f), 'a press elsewhere puts it away');

    // Another card selected closes a note being read.
    press(f, chip(f, 'a', 'note'));
    f.canvas.selectOnly(f.canvas.nodes.get('root')); f.doc.flush();
    assert.ok(!panelOf(f), 'the note leaves with its card’s selection');
    f.manager.destroy();
  }

  /* ---------- writing a note: saved as typed, one undo step ---------- */
  {
    const f = setup();
    f.canvas.selectOnly(f.canvas.nodes.get('free')); f.doc.flush();
    assert.equal(f.command('note', true), true);
    assert.equal(f.command('removeNote', true), false, 'nothing to delete yet');
    f.command('note'); f.doc.flush();
    assert.ok(panelOf(f), 'the Note button opens the note');
    assert.ok(part(f, '.nf-canvas-note-input'), 'a card without a note starts in the editor');
    assert.ok(f.doc.activeElement === part(f, '.nf-canvas-note-input'), 'ready to type');
    const steps = step(f);
    const saves = f.canvas.saves;
    const input = part(f, '.nf-canvas-note-input');
    input.value = 'First line'; input.dispatch('input', {});
    input.value = 'First line\nSecond'; input.dispatch('input', {});
    assert.equal(f.canvas.nodes.get('free').getData()[NOTE_KEY], 'First line\nSecond', 'the words reach the card as they are typed');
    assert.ok(f.canvas.saves > saves, 'and the file');
    assert.deepEqual(step(f), steps, 'but no undo step per keystroke');
    input.value = 'First line\nSecond\t'; input.dispatch('input', { isComposing: true });
    assert.equal(f.canvas.nodes.get('free').getData()[NOTE_KEY], 'First line\nSecond', 'an input method’s composition is left alone');
    const tab = input.dispatch('keydown', { key: 'Tab', shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, isComposing: false });
    assert.ok(tab.defaultPrevented, 'Tab indents instead of leaving the editor');
    input.dispatch('keydown', { key: 'Escape', isComposing: false });
    f.doc.flush();
    assert.ok(!panelOf(f), 'Esc keeps the words and closes');
    assert.ok(f.doc.activeElement === f.canvas.wrapperEl, 'the keyboard goes back to the canvas');
    assert.deepEqual(step(f), [steps[0] + 1, steps[1] + 1], 'the whole note is one undo step');
    assert.ok(chip(f, 'free', 'note'), 'the card now shows its note icon');
    f.canvas.undo(); f.manager.refresh(); f.doc.flush();
    assert.equal(f.canvas.nodes.get('free').getData()[NOTE_KEY], undefined, 'undo takes the note away');
    assert.ok(!chipsOf(f, 'free'));
    f.canvas.redo(); f.manager.refresh(); f.doc.flush();
    assert.equal(noteOf(f.canvas.nodes.get('free').getData()), 'First line\nSecond', 'redo brings it back, trailing space dropped');

    // F4 edits a note; Mod+Enter keeps the words and closes; Done shows the note again.
    f.canvas.wrapperEl.focus();
    f.canvas.selectOnly(f.canvas.nodes.get('free')); f.doc.flush();
    assert.equal(f.scope.dispatch(keyEvent('F4', f.canvas.wrapperEl)), false, 'F4 is the note key');
    f.doc.flush();
    assert.equal(part(f, '.nf-canvas-note-input').value, 'First line\nSecond', 'the editor holds the note');
    part(f, '.nf-canvas-note-input').value = 'Rewritten'; part(f, '.nf-canvas-note-input').dispatch('input', {});
    part(f, '.nf-canvas-note-done').dispatch('click', {});
    f.doc.flush();
    assert.ok(panelOf(f), 'Done keeps the note open');
    assert.equal(part(f, '.nf-canvas-note-input'), null, 'and shows it');
    assert.equal(part(f, '.nf-canvas-note-body').textContent, 'Rewritten');
    part(f, '.nf-canvas-note-list').dispatch('dblclick', { target: part(f, '.nf-canvas-note-body') });
    assert.ok(part(f, '.nf-canvas-note-input'), 'double-clicking the words edits them');
    part(f, '.nf-canvas-note-input').dispatch('keydown', { key: 'Enter', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false });
    f.doc.flush();
    assert.ok(!panelOf(f), 'Mod+Enter keeps the words and closes, as in XMind');
    f.canvas.undo(); f.manager.refresh(); f.doc.flush();
    assert.equal(noteOf(f.canvas.nodes.get('free').getData()), 'First line\nSecond', 'undo brings back the note as it was');

    // Deleting a note being edited is one step back to the note before the edit.
    f.canvas.selectOnly(f.canvas.nodes.get('free')); f.doc.flush();
    f.canvas.wrapperEl.focus();
    f.scope.dispatch(keyEvent('F4', f.canvas.wrapperEl)); f.doc.flush();
    part(f, '.nf-canvas-note-input').value = 'Scribbles'; part(f, '.nf-canvas-note-input').dispatch('input', {});
    const before = step(f);
    part(f, '.nf-canvas-note-foot').querySelector('.nf-canvas-note-delete').dispatch('click', {});
    f.doc.flush();
    assert.ok(!panelOf(f), 'its last note gone, the panel goes');
    assert.equal(f.canvas.nodes.get('free').getData()[NOTE_KEY], undefined, 'the note is deleted');
    assert.equal(step(f)[1], before[1] + 1, 'in one step');
    f.canvas.undo(); f.manager.refresh(); f.doc.flush();
    assert.equal(noteOf(f.canvas.nodes.get('free').getData()), 'First line\nSecond', 'undo restores the note, not the scribbles');

    // A new note left empty adds nothing.
    f.canvas.selectOnly(f.canvas.nodes.get('root')); f.doc.flush();
    const quiet = step(f);
    f.command('note'); f.doc.flush();
    part(f, '.nf-canvas-note-close').dispatch('click', {});
    f.doc.flush();
    assert.deepEqual(step(f), quiet, 'no step for a note never written');
    assert.ok(!chipsOf(f, 'root'));

    // Starting to edit the card's own words puts its note away.
    f.canvas.selectOnly(f.canvas.nodes.get('free')); f.doc.flush();
    f.command('note'); f.doc.flush();
    assert.ok(panelOf(f));
    f.canvas.nodes.get('free').startEditing(); f.doc.flush();
    assert.ok(!panelOf(f), 'editing the card closes its note');
    f.manager.destroy();
    assert.equal(f.canvas.wrapperEl.querySelectorAll('.nf-canvas-chips').length, 0, 'unloading removes every icon');
  }

  /* ---------- several notes on one card ---------- */
  {
    const f = setup();
    const notes = () => notesOf(f.canvas.nodes.get('a').getData());
    f.canvas.selectOnly(f.canvas.nodes.get('a')); f.doc.flush();
    f.canvas.wrapperEl.focus();
    // Shift+F4 adds another note, after the ones there are.
    assert.equal(f.scope.dispatch(keyEvent('F4', f.canvas.wrapperEl, { shiftKey: true })), false, 'Shift+F4 adds a note');
    f.doc.flush();
    assert.equal(parts(f, '.nf-canvas-note-item').length, 2, 'the note there is shown, with a new one under it');
    assert.equal(part(f, '.nf-canvas-note-body').textContent, 'Keep it **lean**');
    assert.equal(part(f, '.nf-canvas-note-input').value, '', 'the new note starts empty');
    assert.ok(f.doc.activeElement === part(f, '.nf-canvas-note-input'));
    const start = step(f);
    type(f, 'Second thought');
    assert.deepEqual(f.canvas.nodes.get('a').getData()[NOTE_KEY], ['Keep it **lean**', 'Second thought'], 'two notes are stored as a list');
    assert.deepEqual(step(f), start, 'no step while typing');
    part(f, '.nf-canvas-note-done').dispatch('click', {}); f.doc.flush();
    assert.deepEqual(step(f), [start[0] + 1, start[1] + 1], 'the new note is one undo step');
    assert.deepEqual(parts(f, '.nf-canvas-note-body').map((el) => el.textContent), ['Keep it **lean**', 'Second thought'], 'both are shown, in order');
    assert.equal(chip(f, 'a', 'note').getAttribute('aria-label'), 'Show 2 notes', 'one icon holds them all');
    assert.equal(chip(f, 'a', 'note').querySelector('.nf-canvas-chip-count').textContent, '2', 'with their count');
    assert.ok(chip(f, 'a', 'note').classList.contains('has-count'));

    // Each note is edited on its own; the others stay as drawn.
    parts(f, '.nf-canvas-note-edit')[1].dispatch('click', {}); f.doc.flush();
    assert.equal(part(f, '.nf-canvas-note-input').value, 'Second thought', 'Edit opens that note');
    assert.equal(parts(f, '.nf-canvas-note-item')[1].classList.contains('is-editing'), true);
    assert.equal(parts(f, '.nf-canvas-note-body')[0].hidden, false, 'the first stays in view');
    type(f, '');
    assert.equal(f.canvas.nodes.get('a').getData()[NOTE_KEY], 'Keep it **lean**', 'emptied as it is typed, it leaves the field');
    type(f, 'Second, rewritten');
    assert.deepEqual(notes(), ['Keep it **lean**', 'Second, rewritten'], 'typed again, it comes back in its own place');
    // Taking up another note keeps the first one's words as their own step.
    const mid = step(f);
    parts(f, '.nf-canvas-note-list')[0].dispatch('dblclick', { target: parts(f, '.nf-canvas-note-body')[0] }); f.doc.flush();
    assert.equal(step(f)[1], mid[1] + 1, 'the rewrite is kept as a step');
    assert.equal(part(f, '.nf-canvas-note-input').value, 'Keep it **lean**', 'and the first note is written next');
    type(f, '');
    type(f, 'Lean');
    assert.deepEqual(notes(), ['Lean', 'Second, rewritten'], 'emptying a note on the way never shifts the others');
    // The panel's + while writing: the words so far are kept, then a new note.
    part(f, '.nf-canvas-note-add').dispatch('click', {}); f.doc.flush();
    type(f, 'Third');
    assert.deepEqual(notes(), ['Lean', 'Second, rewritten', 'Third']);
    assert.equal(parts(f, '.nf-canvas-note-item').length, 3);
    // Esc keeps it and closes; each note was its own step.
    part(f, '.nf-canvas-note-input').dispatch('keydown', { key: 'Escape', isComposing: false }); f.doc.flush();
    assert.ok(!panelOf(f));
    f.canvas.undo(); f.manager.refresh(); f.doc.flush();
    assert.deepEqual(notes(), ['Lean', 'Second, rewritten'], 'undo takes back the last note alone');
    f.canvas.undo(); f.manager.refresh(); f.doc.flush();
    assert.deepEqual(notes(), ['Keep it **lean**', 'Second, rewritten'], 'then the first note’s rewrite');

    // F4 on several notes reads them: which one to write is the reader's choice.
    f.canvas.selectOnly(f.canvas.nodes.get('a')); f.doc.flush();
    f.canvas.wrapperEl.focus();
    f.scope.dispatch(keyEvent('F4', f.canvas.wrapperEl)); f.doc.flush();
    assert.ok(panelOf(f) && !part(f, '.nf-canvas-note-input'), 'F4 shows several notes to read');

    // Deleting one note keeps the panel with the rest, as one step.
    const del = step(f);
    parts(f, '.nf-canvas-note-tools')[0].querySelector('.nf-canvas-note-delete').dispatch('click', {}); f.doc.flush();
    assert.deepEqual(notes(), ['Second, rewritten'], 'that note alone is deleted');
    assert.equal(step(f)[1], del[1] + 1, 'in one step');
    assert.ok(panelOf(f), 'the panel stays with the note left');
    assert.deepEqual(parts(f, '.nf-canvas-note-body').map((el) => el.textContent), ['Second, rewritten']);
    assert.equal(chip(f, 'a', 'note').classList.contains('has-count'), false, 'one note left, no count');
    f.canvas.undo(); f.manager.refresh(); f.doc.flush();
    assert.deepEqual(notes(), ['Keep it **lean**', 'Second, rewritten'], 'undo brings it back in its place');

    // Deleting another note while one is written keeps the words first.
    if (panelOf(f)) { part(f, '.nf-canvas-note-close').dispatch('click', {}); f.doc.flush(); }
    f.canvas.selectOnly(f.canvas.nodes.get('a')); f.doc.flush();
    f.command('note'); f.doc.flush();
    parts(f, '.nf-canvas-note-edit')[1].dispatch('click', {}); f.doc.flush();
    type(f, 'Second, again');
    parts(f, '.nf-canvas-note-tools')[0].querySelector('.nf-canvas-note-delete').dispatch('click', {}); f.doc.flush();
    assert.deepEqual(notes(), ['Second, again'], 'the other note goes, the words written stay');
    assert.equal(part(f, '.nf-canvas-note-input'), null, 'and the notes are read again');
    f.canvas.undo(); f.manager.refresh(); f.doc.flush();
    assert.deepEqual(notes(), ['Keep it **lean**', 'Second, again'], 'the deletion is its own step');

    // The note icon's menu for several notes, and ticking a task in the second one.
    globalThis.__nfShownMenus = [];
    f.canvas.wrapperEl.dispatch('contextmenu', { target: chip(f, 'a', 'note'), clientX: 0, clientY: 0 });
    assert.deepEqual(menuTitles(), ['Show notes', 'Add another note', 'Delete all notes']);
    globalThis.__nfShownMenus.at(-1).items.at(-1).click(); f.doc.flush();
    assert.equal(NOTE_KEY in f.canvas.nodes.get('a').getData(), false, 'Delete all notes');
    f.canvas.undo(); f.manager.refresh(); f.doc.flush();
    assert.equal(notes().length, 2, 'in one undo step');

    // The card's right-click menu offers another note; the find bar reads every note.
    const binding = f.manager.bindings.get(f.view);
    const titles = [];
    f.canvas.selectOnly(f.canvas.nodes.get('a')); f.doc.flush();
    binding.fillNodeMenu({ addItem(cb) { const item = { setTitle(title) { titles.push(title); return this; }, setIcon() { return this; }, onClick() { return this; }, setSection() { return this; } }; cb(item); return this; } });
    assert.ok(titles.includes('Show notes') && titles.includes('Add another note'), titles.join(', '));
    f.command('find'); f.doc.flush();
    const find = f.canvas.wrapperEl.querySelector('.nf-canvas-find-input');
    find.value = 'again'; find.dispatch('input', {}); f.doc.flush();
    assert.ok(f.canvas.nodes.get('a').nodeEl.classList.contains('nf-canvas-found'), 'words in any note find the card');
    f.manager.destroy();
  }

  /* ---------- writing one note while acting on another ---------- */
  {
    // Checkboxes as Obsidian draws them, one per task line.
    const plain = MarkdownRenderer.render;
    MarkdownRenderer.render = async (app, markdown, el) => {
      for (const line of markdown.split('\n')) {
        const row = el.ownerDocument.createElement('div');
        row.textContent = line;
        if (/^\s*[-*] \[.\]/.test(line)) {
          const box = el.ownerDocument.createElement('input');
          box.className = 'task-list-item-checkbox';
          row.append(box);
        }
        el.append(row);
      }
    };
    const data = map();
    data.nodes.find((node) => node.id === 'a')[NOTE_KEY] = ['Alpha', '- [ ] beta task', 'Gamma'];
    const f = setup(data);
    const notes = () => notesOf(f.canvas.nodes.get('a').getData());
    const reopen = () => {
      if (panelOf(f)) { part(f, '.nf-canvas-note-close').dispatch('click', {}); f.doc.flush(); }
      f.canvas.selectOnly(f.canvas.nodes.get('a')); f.doc.flush();
      f.command('note'); f.doc.flush();
    };
    reopen();
    // The first note emptied while written, then the third taken up: it is Gamma that opens.
    parts(f, '.nf-canvas-note-edit')[0].dispatch('click', {}); f.doc.flush();
    type(f, '');
    assert.deepEqual(notes(), ['- [ ] beta task', 'Gamma'], 'an emptied note leaves the card as it is typed away');
    assert.equal(parts(f, '.nf-canvas-note-item').length, 3, 'but keeps its place in the panel while written');
    parts(f, '.nf-canvas-note-edit')[2].dispatch('click', {}); f.doc.flush();
    assert.equal(part(f, '.nf-canvas-note-input').value, 'Gamma', 'the note shown there opens, not a new one');
    type(f, 'Gamma 2');
    part(f, '.nf-canvas-note-done').dispatch('click', {}); f.doc.flush();
    assert.deepEqual(notes(), ['- [ ] beta task', 'Gamma 2']);
    f.canvas.undo(); f.manager.refresh(); f.doc.flush();
    f.canvas.undo(); f.manager.refresh(); f.doc.flush();
    assert.deepEqual(notes(), ['Alpha', '- [ ] beta task', 'Gamma'], 'two steps: the emptied note, then the rewrite');

    // Ticking a task in another note while one is written keeps both.
    reopen();
    parts(f, '.nf-canvas-note-edit')[0].dispatch('click', {}); f.doc.flush();
    type(f, 'Alpha 2');
    const box = parts(f, '.nf-canvas-note-body')[1].querySelector('.task-list-item-checkbox');
    part(f, '.nf-canvas-note-list').dispatch('click', { target: box }); f.doc.flush();
    assert.deepEqual(notes(), ['Alpha 2', '- [x] beta task', 'Gamma'], 'the words typed and the tick');
    assert.equal(part(f, '.nf-canvas-note-input'), null, 'the tick ends the writing first, so no later word undoes it');
    f.canvas.undo(); f.manager.refresh(); f.doc.flush();
    assert.deepEqual(notes(), ['Alpha 2', '- [ ] beta task', 'Gamma'], 'the tick is its own step');
    f.canvas.undo(); f.manager.refresh(); f.doc.flush();
    assert.deepEqual(notes(), ['Alpha', '- [ ] beta task', 'Gamma']);

    // Deleting another note while the one written is emptied deletes the right one.
    reopen();
    parts(f, '.nf-canvas-note-edit')[0].dispatch('click', {}); f.doc.flush();
    type(f, '');
    parts(f, '.nf-canvas-note-tools')[2].querySelector('.nf-canvas-note-delete').dispatch('click', {}); f.doc.flush();
    assert.deepEqual(notes(), ['- [ ] beta task'], 'Gamma goes; the emptied Alpha was already gone');
    f.canvas.undo(); f.manager.refresh(); f.doc.flush();
    assert.deepEqual(notes(), ['- [ ] beta task', 'Gamma']);
    f.manager.destroy();
    MarkdownRenderer.render = plain;
  }

  /* ---------- another file in the same pane; a press that never became a click ---------- */
  {
    const f = setup();
    f.canvas.selectOnly(f.canvas.nodes.get('free')); f.doc.flush();
    f.command('note'); f.doc.flush();
    const input = part(f, '.nf-canvas-note-input');
    input.value = 'Half written'; input.dispatch('input', {});
    assert.equal(f.canvas.nodes.get('free').getData()[NOTE_KEY], 'Half written', 'typed into the first file');
    // Canvas shows another file, whose cards happen to share ids (a copied canvas does).
    f.view.file = { path: 'copy.canvas' };
    f.canvas.importData({ nodes: [nodeData('free', 0, 900, { text: 'Loose' })], edges: [] }, true);
    input.value = 'Half written, and more'; // never typed into the new file
    f.manager.refresh(); f.doc.flush();
    assert.ok(!panelOf(f), 'the note goes with its file');
    assert.equal(f.canvas.nodes.get('free').getData()[NOTE_KEY], undefined, 'and never lands on the new file’s card of the same id');
    f.manager.destroy();
  }
  {
    const f = setup();
    // Pressed on an icon, released outside the window: no click came.
    f.canvas.wrapperEl.dispatch('pointerdown', { target: chip(f, 'a', 'note'), button: 0, isPrimary: true, pointerId: 1, clientX: 0, clientY: 0 });
    const button = f.canvas.wrapperEl.querySelector('.nf-canvas-toolbar').querySelectorAll('button')[0];
    const typed = f.canvas.wrapperEl.dispatch('click', { target: button, detail: 0, clientX: 0, clientY: 0 });
    assert.equal(typed.defaultPrevented, false, 'a click from the keyboard is never taken for the icon');
    f.canvas.wrapperEl.dispatch('pointerdown', { target: chip(f, 'a', 'note'), button: 0, isPrimary: true, pointerId: 1, clientX: 0, clientY: 0 });
    const dragged = f.canvas.wrapperEl.dispatch('click', { target: f.canvas.nodes.get('root').nodeEl, detail: 1, clientX: 0, clientY: 0 });
    assert.ok(dragged.defaultPrevented, 'a press begun on an icon and let go elsewhere clicks nothing else');
    assert.ok(!panelOf(f), 'nor the icon');
    f.manager.destroy();
  }

  /* ---------- following links ---------- */
  {
    const f = setup();
    press(f, chip(f, 'a', 'link'));
    assert.deepEqual(f.windows.at(-1), ['https://example.com/budget', '_blank', 'noopener,noreferrer'], 'a web link opens in the browser');
    press(f, chip(f, 'b', 'link'));
    assert.deepEqual(f.opened.at(-1), ['Risk register#Top risks', 'test.canvas', false], 'a note link opens like any link, in this pane');
    press(f, chip(f, 'b', 'link'), { metaKey: true });
    assert.equal(f.opened.at(-1)[2], 'tab', 'Mod+click opens a new tab');
    const zooms = f.canvas.zooms.length;
    press(f, chip(f, 'a1', 'link'));
    assert.equal([...f.canvas.selection][0]?.id, 'b', 'a card link selects the card it points at');
    assert.equal(f.canvas.zooms.length, zooms + 1, 'and brings it into view');

    // A link into a folded branch unfolds it on the way.
    f.canvas.selectOnly(f.canvas.nodes.get('a')); f.doc.flush();
    f.command('fold'); f.doc.flush();
    f.canvas.importData({ nodes: [{ ...f.canvas.nodes.get('free').getData(), [LINK_KEY]: '#a1' }], edges: [] }, false); f.manager.refresh(); f.doc.flush();
    press(f, chip(f, 'free', 'link'));
    assert.equal(f.canvas.nodes.get('a').getData().nfCollapsed, undefined, 'the folded branch opens');
    assert.equal([...f.canvas.selection][0]?.id, 'a1');

    // A link to a card that is gone says so, and goes nowhere.
    f.canvas.importData({ nodes: [{ ...f.canvas.nodes.get('free').getData(), [LINK_KEY]: '#gone' }], edges: [] }, false); f.manager.refresh(); f.doc.flush();
    assert.ok(chip(f, 'free', 'link').classList.contains('is-broken'));
    assert.equal(chip(f, 'free', 'link').getAttribute('aria-label'), 'The linked card is no longer on this canvas.');
    const selected = [...f.canvas.selection][0];
    press(f, chip(f, 'free', 'link'));
    assert.equal([...f.canvas.selection][0]?.id, selected?.id, 'nothing moves');

    // The command follows the selected card's link.
    f.canvas.selectOnly(f.canvas.nodes.get('a')); f.doc.flush();
    assert.equal(f.command('openLink', true), true);
    f.command('openLink');
    assert.equal(f.windows.at(-1)[0], 'https://example.com/budget');
    f.canvas.selectOnly(f.canvas.nodes.get('root')); f.doc.flush();
    assert.equal(f.command('openLink', true), false, 'no link, nothing to open');

    // Hovering a note link offers Obsidian's page preview; the icon takes the pointer from Canvas's resize handles.
    f.canvas.wrapperEl.dispatch('pointermove', { target: chip(f, 'b', 'link'), clientX: 0, clientY: 0, pointerType: 'mouse' });
    f.doc.flush();
    assert.ok(f.canvas.wrapperEl.classList.contains('nf-canvas-chip-hover'), 'the resize handles stand aside over an icon');
    assert.ok(chip(f, 'b', 'link').classList.contains('is-hover'));
    const [name, info] = f.hovers.at(-1);
    assert.equal(name, 'hover-link');
    assert.equal(info.linktext, 'Risk register#Top risks');
    assert.equal(info.source, 'notion-flow');
    assert.equal(info.sourcePath, 'test.canvas');
    f.canvas.wrapperEl.dispatch('pointermove', { target: f.canvas.nodes.get('root').nodeEl, clientX: 0, clientY: 0, pointerType: 'mouse' });
    f.doc.flush();
    assert.equal(f.canvas.wrapperEl.classList.contains('nf-canvas-chip-hover'), false, 'and take it back after');

    // The icon's own menu.
    globalThis.__nfShownMenus = [];
    const menu = f.canvas.wrapperEl.dispatch('contextmenu', { target: chip(f, 'b', 'link'), clientX: 0, clientY: 0 });
    assert.ok(menu.defaultPrevented, 'not Canvas’s card menu');
    assert.deepEqual(menuTitles(), ['Open link', 'Open in new tab', 'Copy link', 'Edit link…', 'Remove link']);
    globalThis.__nfShownMenus.at(-1).items[1].click();
    assert.equal(f.opened.at(-1)[2], 'tab');
    globalThis.__nfShownMenus.at(-1).items.at(-1).click();
    f.doc.flush();
    assert.equal(f.canvas.nodes.get('b').getData()[LINK_KEY], undefined, 'Remove link takes it away');
    f.canvas.undo(); f.manager.refresh(); f.doc.flush();
    assert.equal(f.canvas.nodes.get('b').getData()[LINK_KEY], '[[Risk register#Top risks]]', 'in one undo step');
    f.canvas.wrapperEl.dispatch('contextmenu', { target: chip(f, 'a', 'note'), clientX: 0, clientY: 0 });
    assert.deepEqual(menuTitles(), ['Show note', 'Edit note', 'Add another note', 'Delete note']);
    f.manager.destroy();
  }

  /* ---------- several links on one card ---------- */
  {
    const data = map();
    const a = data.nodes.find((node) => node.id === 'a');
    a[LINK_KEY] = ['https://example.com/budget', '[[Risk register#Top risks]]'];
    const f = setup(data);
    const links = () => f.canvas.nodes.get('a').getData()[LINK_KEY];
    assert.deepEqual(chipsOf(f, 'a').querySelectorAll('.nf-canvas-chip').map((el) => `${el.dataset.chip}${el.dataset.index ?? ''}`), ['note', 'link0', 'link1'],
      'each link has an icon of its own, in order');
    assert.equal(chip(f, 'a', 'link', 1).getAttribute('aria-label'), 'Open note: Risk register › Top risks');
    press(f, chip(f, 'a', 'link', 1));
    assert.deepEqual(f.opened.at(-1), ['Risk register#Top risks', 'test.canvas', false], 'the second icon follows the second link');
    press(f, chip(f, 'a', 'link', 0));
    assert.equal(f.windows.at(-1)[0], 'https://example.com/budget');
    f.canvas.wrapperEl.dispatch('pointermove', { target: chip(f, 'a', 'link', 1), clientX: 0, clientY: 0, pointerType: 'mouse' });
    f.doc.flush();
    assert.equal(f.hovers.at(-1)[1].linktext, 'Risk register#Top risks', 'each note link offers its own preview');

    // Its menu acts on its own link.
    globalThis.__nfShownMenus = [];
    f.canvas.wrapperEl.dispatch('contextmenu', { target: chip(f, 'a', 'link', 1), clientX: 0, clientY: 0 });
    globalThis.__nfShownMenus.at(-1).items.at(-1).click(); f.doc.flush();
    assert.equal(links(), 'https://example.com/budget', 'Remove link takes that link alone');
    f.canvas.undo(); f.manager.refresh(); f.doc.flush();
    assert.deepEqual(links(), ['https://example.com/budget', '[[Risk register#Top risks]]'], 'in one undo step');

    // Mod+K adds one more link, and a link it has already adds nothing.
    globalThis.__nfOpenedModals = [];
    globalThis.__nfNotices = [];
    f.canvas.selectOnly(f.canvas.nodes.get('a')); f.doc.flush();
    f.canvas.wrapperEl.focus();
    f.scope.dispatch(keyEvent('k', f.canvas.wrapperEl, { metaKey: true }));
    let picker = globalThis.__nfOpenedModals.at(-1);
    assert.ok(picker instanceof CardLinkModal);
    assert.equal(picker.initial, '', 'adding starts with nothing typed');
    assert.deepEqual(picker.getSuggestions('').slice(0, 2).map((choice) => [choice.kind, choice.title]),
      [['edit', 'example.com/budget'], ['edit', 'Risk register › Top risks']], 'the card’s links come first, to edit');
    const steps = step(f);
    picker.onChooseSuggestion(picker.getSuggestions('#^b')[0]); f.doc.flush();
    assert.deepEqual(links(), ['https://example.com/budget', '[[Risk register#Top risks]]', '#b'], 'a card link goes after the others');
    assert.equal(step(f)[1], steps[1] + 1, 'one undo step');
    f.scope.dispatch(keyEvent('k', f.canvas.wrapperEl, { metaKey: true }));
    picker = globalThis.__nfOpenedModals.at(-1);
    const again = picker.getSuggestions('Risk').find((choice) => choice.value === '#b');
    assert.equal(again.linked, true, 'what the card links already is marked');
    picker.onChooseSuggestion(again); f.doc.flush();
    assert.equal(links().length, 3, 'and choosing it adds nothing');
    assert.equal(globalThis.__nfNotices.at(-1), 'The card already has this link.');

    // Choosing one of its links while adding opens it to change, in its place.
    picker.onChooseSuggestion(picker.getSuggestions('')[1]);
    const edit = globalThis.__nfOpenedModals.at(-1);
    assert.notEqual(edit, picker);
    assert.equal(edit.initial, 'Risk register#Top risks', 'the link, ready to change');
    assert.equal(edit.getSuggestions('')[0].kind, 'keep');
    edit.onChooseSuggestion(edit.getSuggestions('https://risks.example')[0]); f.doc.flush();
    assert.deepEqual(links(), ['https://example.com/budget', 'https://risks.example', '#b'], 'the link changes in its place');

    // Past three links, the last icon lists them all.
    f.canvas.importData({ nodes: [{ ...f.canvas.nodes.get('a').getData(), [LINK_KEY]: [...links(), '[[Other]]'] }], edges: [] }, false);
    f.canvas.pushHistory(f.canvas.getData());
    f.manager.refresh(); f.doc.flush();
    assert.deepEqual(chipsOf(f, 'a').querySelectorAll('.nf-canvas-chip').map((el) => el.dataset.chip), ['note', 'link', 'link', 'more']);
    assert.equal(chip(f, 'a', 'more').getAttribute('aria-label'), '2 more links');
    assert.equal(chip(f, 'a', 'more').textContent, '+2');
    globalThis.__nfShownMenus = [];
    press(f, chip(f, 'a', 'more'));
    assert.deepEqual(menuTitles(), ['example.com/budget', 'risks.example', 'Risks', 'Other', 'Add another link…'], 'every link, then one more');
    globalThis.__nfShownMenus.at(-1).items[3].click({ metaKey: true });
    assert.deepEqual(f.opened.at(-1), ['Other', 'test.canvas', 'tab'], 'chosen with Mod, a note opens in a new tab');
    globalThis.__nfShownMenus.at(-1).items[2].click({});
    assert.equal([...f.canvas.selection][0]?.id, 'b', 'a card link goes to its card');

    // Open link with several: the same list, under the card's icons; Remove link takes them all.
    f.canvas.selectOnly(f.canvas.nodes.get('a')); f.doc.flush();
    const shown = globalThis.__nfShownMenus.length;
    assert.equal(f.command('openLink'), true);
    assert.equal(globalThis.__nfShownMenus.length, shown + 1, 'a menu of the links');
    assert.ok(globalThis.__nfShownMenus.at(-1).position, 'shown where the icons are');
    const binding = f.manager.bindings.get(f.view);
    const titles = [];
    binding.fillNodeMenu({ addItem(cb) { const item = { setTitle(title) { titles.push(title); return this; }, setIcon() { return this; }, onClick() { return this; }, setSection() { return this; } }; cb(item); return this; } });
    assert.ok(['Add another link…', 'Open link…', 'Remove all links', 'Copy link to card'].every((title) => titles.includes(title)), titles.join(', '));
    f.command('removeLink'); f.doc.flush();
    assert.equal(LINK_KEY in f.canvas.nodes.get('a').getData(), false, 'every link goes');
    assert.equal(chipsOf(f, 'a').querySelectorAll('.nf-canvas-chip').length, 1, 'the note stays');
    f.canvas.undo(); f.manager.refresh(); f.doc.flush();
    assert.equal(links().length, 4, 'in one step');
    f.manager.destroy();
  }

  /* ---------- linking a card ---------- */
  {
    const f = setup();
    globalThis.__nfOpenedModals = [];
    f.canvas.selectOnly(f.canvas.nodes.get('free')); f.doc.flush();
    assert.equal(f.command('removeLink', true), false);
    f.canvas.wrapperEl.focus();
    assert.equal(f.scope.dispatch(keyEvent('k', f.canvas.wrapperEl, { metaKey: true })), false, 'Mod+K links the card');
    const picker = globalThis.__nfOpenedModals.at(-1);
    assert.ok(picker instanceof CardLinkModal);
    const risks = picker.getSuggestions('Risk').find((choice) => choice.kind === 'file');
    assert.deepEqual([risks.value, risks.title], ['[[Risk register]]', 'Risk register'], 'notes come from the vault, linked the shortest way');
    assert.ok(picker.getSuggestions('Risk').some((choice) => choice.kind === 'card' && choice.value === '#b' && choice.detail === 'Plan'), 'cards come with their map');
    assert.equal(picker.getSuggestions('').some((choice) => choice.value === '#free'), false, 'a card never links to itself');
    const steps = step(f);
    picker.onChooseSuggestion(picker.getSuggestions('https://new.example')[0]);
    f.doc.flush();
    assert.equal(f.canvas.nodes.get('free').getData()[LINK_KEY], 'https://new.example');
    assert.equal(step(f)[1], steps[1] + 1, 'one undo step');
    assert.equal(chip(f, 'free', 'link').dataset.kind, 'url');

    // Its link, chosen while adding, opens ready to change; Remove link there takes it away.
    f.canvas.wrapperEl.focus();
    f.command('link');
    const adding = globalThis.__nfOpenedModals.at(-1);
    assert.equal(adding.getSuggestions('')[0].kind, 'edit');
    adding.onChooseSuggestion(adding.getSuggestions('')[0]);
    const again = globalThis.__nfOpenedModals.at(-1);
    assert.equal(again.initial, 'https://new.example');
    assert.equal(again.getSuggestions('')[0].kind, 'keep');
    again.onChooseSuggestion(again.getSuggestions('').at(-1));
    f.doc.flush();
    assert.equal(f.canvas.nodes.get('free').getData()[LINK_KEY], undefined, 'Remove link');

    // The card's right-click menu, the floating menu and the toolbar offer both.
    const binding = f.manager.bindings.get(f.view);
    const titles = [];
    binding.fillNodeMenu({ addItem(cb) { const item = { setTitle(title) { titles.push(title); return this; }, setIcon() { return this; }, onClick() { return this; }, setSection() { return this; } }; cb(item); return this; } });
    assert.ok(titles.includes('Add note') && titles.includes('Add link…'));
    assert.equal(titles.includes('Open link'), false, 'no link, no Open link');
    f.canvas.selectOnly(f.canvas.nodes.get('a')); f.doc.flush();
    titles.length = 0;
    binding.fillNodeMenu({ addItem(cb) { const item = { setTitle(title) { titles.push(title); return this; }, setIcon() { return this; }, onClick() { return this; }, setSection() { return this; } }; cb(item); return this; } });
    assert.ok(['Show note', 'Add another note', 'Add another link…', 'Open link', 'Remove link', 'Copy link to card'].every((title) => titles.includes(title)), titles.join(', '));
    assert.equal(tb(f, 'Note').disabled, false);
    assert.equal(tb(f, 'Link').disabled, false);
    for (const id of ['note', 'addNote', 'removeNote', 'link', 'openLink', 'removeLink', 'copyCardLink']) assert.equal(f.command(id, true), true, `the ${id} command`);
    assert.equal(f.command('insertCardLink', true), false, 'links into words wait for a card being typed in');
    f.command('removeNote'); f.doc.flush();
    assert.equal(f.canvas.nodes.get('a').getData()[NOTE_KEY], undefined);
    f.manager.destroy();
  }

  /* ---------- ticking a task in a note being read ---------- */
  {
    // Checkboxes as Obsidian draws them, one per task line.
    MarkdownRenderer.render = async (app, markdown, el) => {
      rendered.push(markdown);
      for (const line of markdown.split('\n')) {
        const row = el.ownerDocument.createElement('div');
        row.textContent = line;
        if (/^\s*[-*] \[.\]/.test(line)) {
          const box = el.ownerDocument.createElement('input');
          box.className = 'task-list-item-checkbox';
          row.append(box);
        }
        el.append(row);
      }
    };
    const data = map();
    const original = '- [ ] one\n- [x] two\n- [ ] three';
    data.nodes.find((node) => node.id === 'free')[NOTE_KEY] = ['Before', original];
    const f = setup(data);
    f.canvas.selectOnly(f.canvas.nodes.get('free')); f.doc.flush();
    f.command('note'); f.doc.flush();
    const boxes = () => parts(f, '.nf-canvas-note-body')[1].querySelectorAll('.task-list-item-checkbox');
    const list = () => part(f, '.nf-canvas-note-list');
    assert.equal(boxes().length, 3);
    const at = step(f);
    assert.ok(panelOf(f).dispatch('mousedown', { target: boxes()[2] }).defaultPrevented, 'a task box takes no keyboard focus');
    boxes()[2].focus();
    const click = list().dispatch('click', { target: boxes()[2] });
    assert.ok(click.defaultPrevented, 'the box never flips on its own');
    f.doc.flush();
    assert.deepEqual(notesOf(f.canvas.nodes.get('free').getData()), ['Before', '- [ ] one\n- [x] two\n- [x] three'], 'ticking a box ticks the task in its own note');
    assert.equal(step(f)[1], at[1] + 1, 'as one undo step');
    assert.ok(panelOf(f), 'and the notes stay open');
    assert.equal(rendered.at(-1), '- [ ] one\n- [x] two\n- [x] three', 'drawn again as it now is');
    assert.ok(f.doc.activeElement === panelOf(f), 'what had the keyboard went with the old drawing: the panel keeps it, so Esc still closes');
    f.canvas.undo(); f.manager.refresh(); f.doc.flush();
    assert.deepEqual(notesOf(f.canvas.nodes.get('free').getData()), ['Before', original]);
    f.canvas.readonly = true; f.manager.refresh(); f.doc.flush();
    const locked = list().dispatch('click', { target: boxes()[0] });
    assert.ok(locked.defaultPrevented);
    assert.deepEqual(notesOf(f.canvas.nodes.get('free').getData()), ['Before', original], 'a read-only note keeps its tasks');
    assert.equal(panelOf(f).getAttribute('aria-label'), null, 'no aria-label on the panel, whose tooltip would follow the pointer');
    assert.equal(panelOf(f).getAttribute('aria-labelledby'), part(f, '.nf-canvas-note-title').id, 'it is named by its title');
    f.manager.destroy();
    MarkdownRenderer.render = async (app, markdown, el) => { rendered.push(markdown); el.textContent = markdown; };
  }

  /* ---------- the find bar reads notes; read-only canvases read them too ---------- */
  {
    const f = setup();
    f.command('find'); f.doc.flush();
    const input = f.canvas.wrapperEl.querySelector('.nf-canvas-find-input');
    input.value = 'lean'; input.dispatch('input', {}); f.doc.flush();
    assert.ok(f.canvas.nodes.get('a').nodeEl.classList.contains('nf-canvas-found'), 'words in a note find its card');
    f.manager.destroy();
  }
  {
    const f = setup();
    f.canvas.readonly = true; f.manager.refresh(); f.doc.flush();
    press(f, chip(f, 'a', 'note'));
    assert.ok(panelOf(f), 'a read-only canvas shows notes');
    assert.equal(part(f, '.nf-canvas-note-tools').hidden, true, 'without Edit or Delete');
    assert.equal(part(f, '.nf-canvas-note-add').hidden, true, 'or Add');
    part(f, '.nf-canvas-note-list').dispatch('dblclick', { target: part(f, '.nf-canvas-note-body') });
    assert.equal(part(f, '.nf-canvas-note-input'), null, 'and double-clicking does not edit');
    f.canvas.selectOnly(f.canvas.nodes.get('free')); f.doc.flush();
    assert.equal(f.command('note', true), false, 'no note to add on a read-only canvas');
    assert.equal(f.command('addNote', true), false);
    assert.equal(f.command('link', true), false);
    assert.equal(f.command('copyCardLink', true), true, 'copying a card’s link writes nothing');
    press(f, chip(f, 'a1', 'link'));
    assert.equal([...f.canvas.selection][0]?.id, 'b', 'links are followed');
    f.manager.destroy();
  }

  /* ---------- links to cards in a card's words ---------- */
  {
    const data = map();
    data.nodes.find((node) => node.id === 'free').text = 'See [[#^b|the risks]]';
    const f = setup(data, {
      vault: { getFiles: () => files, getConfig: (key) => key === 'useMarkdownLinks' ? f.markdownLinks : undefined },
      metadataCache: {
        fileToLinktext: (file) => file.basename, getFileCache: () => ({ headings: [] }),
        getFirstLinkpathDest: (path) => path === 'test.canvas' ? { path: 'test.canvas' } : null,
      },
    });
    // A link as Obsidian draws it in the card: an internal link to a block of this canvas.
    const anchor = (id, href, text = 'x') => {
      const el = f.doc.createElement('a');
      el.className = 'internal-link';
      el.setAttribute('data-href', href);
      el.textContent = text;
      f.canvas.nodes.get(id).nodeEl.querySelector('.markdown-preview-sizer').append(el);
      return el;
    };
    const toRisks = anchor('free', '#^b', 'the risks');
    const zooms = f.canvas.zooms.length;
    const click = f.canvas.wrapperEl.dispatch('click', { target: toRisks, button: 0, detail: 1, clientX: 0, clientY: 0 });
    f.doc.flush();
    assert.ok(click.defaultPrevented, 'the click is the plugin’s, not Obsidian’s, which would open the canvas again');
    assert.equal([...f.canvas.selection][0]?.id, 'b', 'a click on a card link goes to the card');
    assert.equal(f.canvas.zooms.length, zooms + 1, 'and brings it into view');
    assert.equal(f.opened.length, 0);
    const middle = f.canvas.wrapperEl.dispatch('auxclick', { target: toRisks, button: 1, detail: 1, clientX: 0, clientY: 0 });
    assert.ok(middle.defaultPrevented, 'so does a middle click, which would open a new tab of this canvas');
    globalThis.__nfNotices = [];
    const gone = anchor('free', '#^gone');
    f.canvas.selectOnly(f.canvas.nodes.get('free')); f.doc.flush();
    assert.ok(f.canvas.wrapperEl.dispatch('click', { target: gone, button: 0, detail: 1, clientX: 0, clientY: 0 }).defaultPrevented);
    assert.equal(globalThis.__nfNotices.at(-1), 'The linked card is no longer on this canvas.', 'a link to a card that is gone says so');
    assert.equal([...f.canvas.selection][0]?.id, 'free', 'and goes nowhere');
    const note = anchor('free', 'Risk register');
    assert.equal(f.canvas.wrapperEl.dispatch('click', { target: note, button: 0, detail: 1, clientX: 0, clientY: 0 }).defaultPrevented, false, 'other links stay Obsidian’s');
    const heading = anchor('free', '#Top');
    assert.equal(f.canvas.wrapperEl.dispatch('click', { target: heading, button: 0, detail: 1, clientX: 0, clientY: 0 }).defaultPrevented, false, 'a heading that is no card too');
    const pathLink = anchor('free', 'test.canvas#^a1');
    f.canvas.wrapperEl.dispatch('click', { target: pathLink, button: 0, detail: 1, clientX: 0, clientY: 0 }); f.doc.flush();
    assert.equal([...f.canvas.selection][0]?.id, 'a1', 'a link naming this canvas by its path goes to the card too');

    // The pointer on a card link lights the card it leads to, instead of a page preview.
    const hovers = f.hovers.length;
    f.canvas.wrapperEl.dispatch('mouseover', { target: toRisks });
    assert.ok(f.canvas.nodes.get('b').nodeEl.classList.contains('nf-canvas-link-target'), 'the linked card is lit');
    f.canvas.wrapperEl.dispatch('mouseout', { target: toRisks, relatedTarget: f.canvas.nodes.get('free').nodeEl });
    assert.equal(f.canvas.nodes.get('b').nodeEl.classList.contains('nf-canvas-link-target'), false, 'until the pointer leaves the link');
    assert.equal(f.hovers.length, hovers);

    // A card link in a note goes there too.
    f.canvas.selectOnly(f.canvas.nodes.get('a')); f.doc.flush();
    f.command('note'); f.doc.flush();
    const inNote = f.doc.createElement('a');
    inNote.className = 'internal-link';
    inNote.setAttribute('data-href', '#^b');
    part(f, '.nf-canvas-note-body').append(inNote);
    f.canvas.wrapperEl.dispatch('click', { target: inNote, button: 0, detail: 1, clientX: 0, clientY: 0 }); f.doc.flush();
    assert.equal([...f.canvas.selection][0]?.id, 'b');
    assert.ok(!panelOf(f), 'leaving the note behind');

    // Copy link to card, to paste into another card's words.
    f.canvas.selectOnly(f.canvas.nodes.get('b')); f.doc.flush();
    assert.equal(f.command('copyCardLink'), true);
    assert.equal(f.copied.at(-1), '[[#^b|Risks]]');
    f.markdownLinks = true;
    f.command('copyCardLink');
    assert.equal(f.copied.at(-1), '[Risks](#^b)', 'as a Markdown link where the vault writes those');
    f.markdownLinks = false;
    f.manager.destroy();
  }

  /* ---------- linking another card while typing in a card ---------- */
  {
    const data = map();
    const pushed = [];
    const f = setup(data, { keymap: { pushScope(scope) { pushed.push(scope); }, popScope(scope) { pushed.splice(pushed.indexOf(scope), 1); } } });
    // A card's editor as Canvas builds it: CodeMirror, its words, a selection.
    const editor = (id, text, from = text.length, to = from) => {
      const node = f.canvas.nodes.get(id);
      const dom = f.doc.createElement('div');
      const scrollDOM = f.doc.createElement('div');
      const contentDOM = f.doc.createElement('div');
      dom.append(scrollDOM); scrollDOM.append(contentDOM);
      const cm = {
        dom, scrollDOM, contentDOM, composing: false, defaultLineHeight: 20, defaultCharacterWidth: 8, contentHeight: 20,
        get text() { return text; },
        state: {
          get doc() { return { toString: () => text, get length() { return text.length; }, sliceString: (a, b) => text.slice(a, b) }; },
          get selection() { return { main: { from, to, head: to, anchor: from } }; },
        },
        requestMeasure(spec) { if (spec?.read) spec.write(spec.read()); },
        focus() { f.doc.activeElement = contentDOM; },
        dispatch({ changes, selection }) {
          if (changes) text = text.slice(0, changes.from) + (changes.insert ?? '') + text.slice(changes.to);
          if (selection) from = to = selection.anchor;
        },
      };
      node.child = { getMode: () => 'source', editMode: { cm }, showPreview() { node.child.editMode = null; } };
      node.setIsEditing = (value) => { node.isEditing = value; };
      node.isEditing = true; node.nodeEl.classList.add('is-editing');
      f.canvas.selectOnly(node);
      f.manager.refresh(); f.doc.flush();
      return cm;
    };
    const cm = editor('free', 'See  now', 4);
    assert.equal(f.command('insertCardLink', true), true, 'while a card is typed in, it can link another');
    // [[^ in that card's editor lists the canvas's other cards.
    const suggest = f.workspace.editorSuggest.suggests[0];
    assert.ok(suggest instanceof CardLinkSuggest, 'the card suggestion goes ahead of Obsidian’s link suggestion');
    assert.deepEqual(f.workspace.editorSuggest.suggests[1], { native: 'link' });
    const choices = f.manager.cardLinkChoices({ cm });
    assert.deepEqual(choices.cards.map((card) => card.id), ['a', 'a1', 'root', 'b'], 'every other card, in reading order');
    assert.equal(choices.cards.find((card) => card.id === 'b').context, 'Plan', 'each with its map');
    assert.equal(f.manager.cardLinkChoices({ cm: {} }), null, 'another editor gets nothing');
    // The picker, from the command, Mod+Shift+K or the editor's menu.
    globalThis.__nfOpenedModals = [];
    f.command('insertCardLink');
    let picker = globalThis.__nfOpenedModals.at(-1);
    assert.ok(picker instanceof CardSearchModal);
    assert.equal(picker.getItems().some((hit) => hit.id === 'free'), false, 'never the card itself');
    picker.onChooseItem(picker.getItems().find((hit) => hit.id === 'b'));
    assert.equal(cm.text, 'See [[#^b|Risks]] now', 'the link goes in at the caret, named by the card');
    assert.equal(f.doc.activeElement, cm.contentDOM, 'and the keyboard stays in the card');
    assert.ok(pushed.length, 'a scope of the plugin holds the keys while a card is typed in');
    // That card is finished; another is typed in, some of its words selected.
    const free = f.canvas.nodes.get('free');
    free.isEditing = false; free.child = undefined; free.nodeEl.classList.remove('is-editing');
    f.manager.refresh(); f.doc.flush();
    assert.equal(f.command('insertCardLink', true), false, 'with no card typed in, there is nowhere to put a link');
    const cm2 = editor('root', 'Watch the risks here', 6, 15);
    const scope = pushed.at(-1);
    assert.equal(scope.handleKey({ ...keyEvent('K', cm2.contentDOM, { metaKey: true, shiftKey: true }) }), false, 'Mod+Shift+K opens the picker');
    picker = globalThis.__nfOpenedModals.at(-1);
    picker.onChooseItem(picker.getItems().find((hit) => hit.id === 'b'));
    assert.equal(cm2.text, 'Watch [[#^b|the risks]] here', 'the selected words become the link’s text');
    assert.equal(scope.handleKey({ ...keyEvent('K', f.canvas.wrapperEl, { metaKey: true, shiftKey: true }) }), undefined, 'outside the card’s editor the key is not ours');
    // Mod+Enter on a card link finishes the card and shows the linked one; Obsidian would open the canvas again.
    const cm3 = editor('root', 'See [[#^b|Risks]]', 8);
    const followScope = pushed.at(-1);
    let shown = cm3;
    f.canvas.nodes.get('root').child.showPreview = () => { shown = null; f.canvas.nodes.get('root').child.editMode = null; };
    f.canvas.nodes.get('root').child.getMode = () => shown ? 'source' : 'preview';
    assert.equal(followScope.handleKey(keyEvent('Enter', cm3.contentDOM, { metaKey: true })), false, 'Mod+Enter on a card link is the plugin’s');
    f.doc.flush();
    assert.equal(shown, null, 'the card is finished');
    assert.equal([...f.canvas.selection][0]?.id, 'b', 'and the linked card shown');
    assert.equal(f.opened.length, 0, 'nothing opened in a pane');
    const cm4 = editor('root', 'See [[Risk register]]', 8);
    assert.equal(pushed.at(-1).handleKey(keyEvent('Enter', cm4.contentDOM, { metaKey: true })), undefined, 'a link to a note stays Obsidian’s to open');
    let added = null;
    f.workspace.emit('editor-menu', { addItem(cb) { const item = { setSection(section) { this.section = section; return this; }, setTitle(title) { this.title = title; return this; }, setIcon() { return this; }, onClick(fn) { this.click = fn; return this; } }; cb(item); added = item; return this; } }, { cm: cm4 });
    assert.equal(added?.title, 'Link to a card…', 'the card editor’s menu offers it');
    assert.equal(added.section, 'selection-link', 'beside Obsidian’s own Add link');
    added.click();
    assert.ok(globalThis.__nfOpenedModals.at(-1) instanceof CardSearchModal, 'and it opens the card picker');
    f.workspace.emit('editor-menu', { addItem() { assert.fail('a note’s editor menu is left alone'); } }, { cm: {} });
    f.manager.destroy();
  }

  console.log('PASS canvas notes and links: several of each, stored fields, picker lines, outlines, [[^ card links, icons, the note panel, undo, and following links');
} finally {
  await rm(directory, { recursive: true, force: true });
}
