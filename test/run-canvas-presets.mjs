import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { edgeData, fakeDocument, fixture as canvasFixture, nodeData } from './canvas-fixture.mjs';

// Exercise the controller's real preset actions and transaction boundaries,
// without duplicating the full DOM fixture used by run-canvas-enhancements.
const directory = await mkdtemp(join(tmpdir(), 'notion-flow-presets-'));
try {
  const source = fileURLToPath(new URL('../src/canvas/enhancements.ts', import.meta.url));
  const outfile = join(directory, 'presets.mjs');
  await build({
    stdin: { contents: `${await readFile(source, 'utf8')}\nexport { CanvasBinding };\nexport { buildForest } from './graph';\nexport { APPEARANCE_PRESETS, PRESET_GROUPS, appearancePreset, planAutoColors, presetColors } from './appearance';\nexport { StylePanel } from './style-panel';\nexport { USER_SCHEME_LIMIT, SCHEME_NAME_MAX, userSchemesFrom, suggestSchemeName, newSchemeId, schemeAsPreset } from './schemes';\nexport { cssPalette } from './appearance';`, loader: 'ts', resolveDir: dirname(source) },
    bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
    alias: { obsidian: fileURLToPath(new URL('./obsidian-stub.mjs', import.meta.url)) },
  });
  const {
    CanvasBinding, CanvasEnhancements, buildForest, APPEARANCE_PRESETS, PRESET_GROUPS, appearancePreset, planAutoColors, presetColors, StylePanel,
    USER_SCHEME_LIMIT, SCHEME_NAME_MAX, userSchemesFrom, suggestSchemeName, newSchemeId, schemeAsPreset, cssPalette,
  } = await import(pathToFileURL(outfile).href);
  const node = (id, x, y, extra = {}) => ({ id, type: 'text', text: id, x, y, width: 220, height: 80, ...extra });
  const initial = {
    metadata: { custom: 'keep canvas metadata' },
    nodes: [
      node('root', 0, 0, { nfLayout: 'right', color: '#AABBCC', nfTheme: 'minimal', nfLine: 'straight', custom: 'keep node metadata' }),
      node('child', 300, 0, { color: '3' }), node('leaf', 600, 0),
      node('other-root', 0, 900, { nfLayout: 'balanced', nfPalette: 'forest' }),
    ],
    edges: [{ id: 'root-child', fromNode: 'root', toNode: 'child', color: '#445566' }, { id: 'child-leaf', fromNode: 'child', toNode: 'leaf' }],
  };
  function fixture() {
    let state = structuredClone(initial);
    let pending = null;
    let selectedId = 'leaf';
    const settings = { canvasAutoLayout: true };
    const calls = { tidy: 0, refresh: 0, finishes: 0 };
    const canvas = {
      nodes: new Map(), readonly: false, history: { data: [structuredClone(state)], current: 0 }, wrapperEl: { focus() {} },
      getData: () => structuredClone(state),
      importData(data) {
        for (const replacement of data.nodes) state.nodes = state.nodes.map(item => item.id === replacement.id ? structuredClone(replacement) : item);
      },
      requestSave() { pending = structuredClone(state); },
      requestPushHistory: {
        run() {
          if (!pending) return;
          canvas.history.data.splice(canvas.history.current + 1);
          canvas.history.data.push(pending);
          canvas.history.current++;
          pending = null;
        },
      },
      pushHistory(data) { canvas.history.data.push(structuredClone(data)); canvas.history.current = canvas.history.data.length - 1; },
      undo() { if (canvas.history.current > 0) state = structuredClone(canvas.history.data[--canvas.history.current]); },
      redo() { if (canvas.history.current + 1 < canvas.history.data.length) state = structuredClone(canvas.history.data[++canvas.history.current]); },
    };
    for (const item of state.nodes) canvas.nodes.set(item.id, { id: item.id, getData: () => structuredClone(state.nodes.find(current => current.id === item.id)) });
    const binding = Object.create(CanvasBinding.prototype);
    Object.assign(binding, {
      canvas, settings: () => settings, selected: () => canvas.nodes.get(selectedId), active: () => true,
      snapshot: () => ({ data: canvas.getData(), forest: buildForest(canvas.getData()) }),
      motion: { finish() { calls.finishes++; } },
      tidy(roots) { assert.deepEqual([...roots], ['root']); calls.tidy++; },
      syncSignature() {}, refresh() { calls.refresh++; }, playMoves() {},
    });
    return { canvas, binding, calls, settings, select: id => { selectedId = id; }, root: () => canvas.nodes.get('root').getData() };
  }

  const f = fixture();
  assert.equal(f.binding.run('preset-mist'), true, 'a descendant applies the preset to its map root');
  assert.equal(f.root().nfPalette, 'mist');
  assert.equal(f.root().nfTheme, 'clean');
  assert.equal(f.root().nfLine, 'curve');
  assert.equal(f.root().nfSpacing, 'roomy');
  assert.equal(f.calls.tidy, 1, 'new spacing is laid out when auto layout is enabled');
  assert.equal(f.canvas.history.current, 1, 'preset is one undo step');
  assert.equal(f.root().color, '#AABBCC');
  assert.equal(f.root().custom, 'keep node metadata');
  assert.deepEqual(f.canvas.getData().metadata, initial.metadata);
  assert.deepEqual(f.canvas.getData().nodes.slice(1), initial.nodes.slice(1), 'manual child colours and unrelated maps are unchanged');
  assert.deepEqual(f.canvas.getData().edges, initial.edges, 'presets do not write native edge colours');
  f.canvas.undo();
  assert.deepEqual(f.canvas.getData(), initial, 'one undo restores all previous style choices');
  f.canvas.redo();
  assert.equal(f.root().nfPalette, 'mist');
  const repeatedHistory = f.canvas.history.current;
  f.binding.run('preset-mist');
  assert.equal(f.canvas.history.current, repeatedHistory, 'reapplying the same preset is a no-op');

  const colorsOnly = fixture();
  assert.equal(colorsOnly.binding.applyPreset('sunset', true), true);
  assert.deepEqual(colorsOnly.root(), { ...initial.nodes[0], nfPalette: 'sunset' }, 'colours-only mode keeps lines, shape, spacing and geometry');
  assert.equal(colorsOnly.calls.tidy, 0);
  assert.equal(colorsOnly.canvas.history.current, 1);
  colorsOnly.canvas.undo();
  assert.deepEqual(colorsOnly.canvas.getData(), initial);

  const freeLayout = fixture();
  freeLayout.settings.canvasAutoLayout = false;
  freeLayout.binding.run('preset-nord');
  assert.equal(freeLayout.root().nfSpacing, 'standard');
  assert.equal(freeLayout.calls.tidy, 0, 'a preset respects disabled auto layout');
  assert.deepEqual(freeLayout.canvas.getData().nodes.map(({ x, y }) => [x, y]), initial.nodes.map(({ x, y }) => [x, y]));

  for (const preset of APPEARANCE_PRESETS) {
    const example = fixture();
    assert.equal(example.binding.run(`preset-${preset.id}`), true);
    assert.equal(example.root().nfPalette, preset.id);
    assert.equal(example.root().nfTheme, preset.theme);
    assert.equal(example.root().nfLine, preset.line);
    assert.equal(example.root().nfSpacing, preset.spacing);
    assert.equal(example.root().nfFont, preset.font, 'a preset brings its typeface, or none');
    const beforeOff = example.canvas.getData();
    assert.equal(example.binding.run('palette-off'), true);
    assert.deepEqual(example.root(), { ...beforeOff.nodes[0], nfPalette: 'none' }, 'turning off automatic colours preserves other style choices');
    assert.equal(example.canvas.history.current, 2);
    example.binding.run('palette-off');
    assert.equal(example.canvas.history.current, 2, 'turning off twice does not create an empty undo step');
    example.canvas.undo();
    assert.deepEqual(example.canvas.getData(), beforeOff, 'undo restores the automatic palette');
  }

  const readOnly = fixture();
  readOnly.canvas.readonly = true;
  assert.equal(readOnly.binding.run('preset-mist'), false);
  assert.equal(readOnly.binding.run('palette-off'), false);
  assert.deepEqual(readOnly.canvas.getData(), initial);
  assert.equal(readOnly.canvas.history.current, 0);
  assert.equal(fixture().binding.applyPreset('unknown'), false, 'unrecognised preset ids cannot change a canvas');

  /* ---- the style panel's preset tiles: the visible name leads the accessible name ---- */
  {
    const doc = fakeDocument();
    const panel = new StylePanel(doc, {
      state: () => null, preview() {}, applyPreset() {}, run() {}, close() {},
      support: { lightDark: true, relative: true },
    });
    const tiles = panel.el.querySelectorAll('.nf-canvas-style-tile');
    assert.equal(tiles.length, APPEARANCE_PRESETS.length, 'one tile per preset, and no pinned tile without a map');
    for (const preset of APPEARANCE_PRESETS) {
      const tile = tiles.find((item) => item.dataset.preset === preset.id);
      assert.equal(tile.getAttribute('aria-label'), `${preset.name} · ${preset.description}`, `${preset.id}: the name, then its description`);
      assert.equal(tile.querySelector('.nf-canvas-style-tile-name').textContent, preset.name, 'the visible name matches the accessible one');
    }
    panel.destroy();
  }

  /* ---- twenty-three presets: three paired with the note palettes, five of round two ---- */
  assert.equal(APPEARANCE_PRESETS.length, 23);
  assert.deepEqual(appearancePreset('rose-pine'), {
    id: 'rose-pine', name: 'Rosé Pine', group: 'soft',
    description: 'Dusty rose, gold and pine from the Rosé Pine palette.',
    theme: 'clean', line: 'organic', spacing: 'roomy', rootColor: '#286983',
    branchColors: ['#B4637A', '#AA732C', '#B76562', '#4D8B96', '#8B75A4', '#608C6E'],
    dark: { rootColor: '#C4A7E7', branchColors: ['#FF90AD', '#E1AD63', '#EF9F9C', '#8FC1CA', '#C5A8E8', '#9DC3A2'] },
  });
  assert.deepEqual(appearancePreset('catppuccin'), {
    id: 'catppuccin', name: 'Catppuccin pastel', group: 'bold',
    description: 'Latte by day, Mocha by night: candy pastel blocks.',
    theme: 'pastel', line: 'curve', spacing: 'standard', shape: 'pill', rootColor: '#8839EF',
    branchColors: ['#4E82E5', '#21979E', '#499C38', '#D25F2A', '#C15AA6', '#BB7403'],
    dark: { rootColor: '#CBA6F7', branchColors: ['#A2C6FE', '#88D5C9', '#9AD795', '#F9B286', '#E4B2D7', '#D8C290'] },
  });
  assert.deepEqual(appearancePreset('guose'), {
    id: 'guose', name: 'Chinese classic', group: 'natural',
    description: 'Indigo root, cinnabar, malachite and gamboge in a serif face.',
    theme: 'clean', line: 'organic', spacing: 'standard', font: 'serif', rootColor: '#177CB0',
    branchColors: ['#C65A53', '#319751', '#B16F05', '#9B65BD', '#4C8E81', '#C06322'],
    dark: { rootColor: '#79BBDD', branchColors: ['#FF9780', '#6ED087', '#E8AB3E', '#CDA5E4', '#5ACFB2', '#FD9C5E'] },
  });
  assert.deepEqual(Object.fromEntries(PRESET_GROUPS.map(([group]) => [group, APPEARANCE_PRESETS.filter((preset) => preset.group === group).length])),
    { soft: 7, natural: 6, bold: 6, focus: 4 });

  /* ---- the note palette's paired preset colours maps that never chose one ---- */
  const modern = { lightDark: true, relative: true };
  const legacy = { lightDark: false, relative: false };
  {
    const roots = ['absent', 'none', 'explicit', 'vivid', 'unknown'];
    const own = { absent: {}, none: { nfPalette: 'none' }, explicit: { nfPalette: 'forest' }, vivid: {}, unknown: { nfPalette: 'missing' } };
    const data = {
      nodes: roots.flatMap((id, index) => [
        node(id, 0, index * 1000, { nfLayout: 'right', ...own[id] }), node(`${id}-1`, 300, index * 1000 - 100), node(`${id}-2`, 300, index * 1000 + 100),
      ]),
      edges: roots.flatMap((id) => [1, 2].map((n) => ({ id: `${id}-e${n}`, fromNode: id, toNode: `${id}-${n}`, fromSide: 'right', toSide: 'left' }))),
    };
    const input = structuredClone(data);
    const forest = buildForest(data);
    const vivid = new Set(['vivid']);
    const plan = planAutoColors(data, forest, vivid, modern, 'nord');
    const nord = presetColors(appearancePreset('nord'), modern);
    const forestColors = presetColors(appearancePreset('forest'), modern);
    assert.equal(plan.nodes.get('absent'), nord.rootColor, 'a map without a palette takes the paired one');
    assert.equal(plan.nodes.get('absent-1'), nord.branchColors[0]);
    assert.equal(plan.nodes.get('absent-2'), nord.branchColors[1]);
    assert.equal(plan.edges.get('absent-e1'), nord.branchColors[0], 'and so do its lines');
    for (const id of ['none', 'none-1', 'unknown', 'unknown-1']) assert.equal(plan.nodes.has(id), false, `${id}: no colours`);
    assert.equal(plan.edges.has('none-e1') || plan.edges.has('unknown-e1'), false);
    assert.equal(plan.nodes.get('explicit'), forestColors.rootColor, 'an explicit palette wins');
    assert.equal(plan.nodes.get('explicit-1'), forestColors.branchColors[0]);
    assert.equal(plan.nodes.has('vivid'), false, 'a vivid map keeps its own palette');
    assert.equal(plan.nodes.get('vivid-1'), 'var(--canvas-color-1)');
    assert.equal(plan.nodes.get('vivid-2'), 'var(--canvas-color-2)');
    const without = planAutoColors(data, forest, vivid, modern);
    for (const fallback of [null, 'none', 'bogus']) {
      assert.deepEqual(planAutoColors(data, forest, vivid, modern, fallback), without, `a fallback of ${fallback} changes nothing`);
    }
    assert.equal(without.nodes.has('absent'), false);
    assert.deepEqual(data, input, 'nothing is written');
  }

  /* ---- in a live canvas: shown, never saved, and redrawn when the pairing changes ---- */
  {
    const data = { nodes: [nodeData('r', 0, 0, { nfLayout: 'right' }), nodeData('a', 400, -200), nodeData('b', 400, 200)],
      edges: [edgeData('ra', 'r', 'a'), edgeData('rb', 'r', 'b')] };
    const live = canvasFixture(CanvasEnhancements, data);
    live.manager.refresh(); live.doc.flush();
    const saved = live.canvas.getData();
    const step = live.canvas.history.current;
    const auto = (id) => live.canvas.nodes.get(id).nodeEl.style.getPropertyValue('--nf-auto');
    assert.equal(auto('r'), '', 'no pairing, no colours');
    live.settings.canvasFallbackPalette = 'nord';
    live.manager.refresh(); live.doc.flush();
    const nord = presetColors(appearancePreset('nord'), legacy);
    assert.equal(auto('r'), nord.rootColor, 'the centre takes the paired root colour');
    assert.equal(auto('a'), nord.branchColors[0]);
    assert.equal(live.canvas.nodes.get('a').nodeEl.classList.contains('nf-canvas-auto-color'), true);
    assert.equal(live.canvas.edges.get('ra').lineGroupEl.style.getPropertyValue('--nf-auto'), nord.branchColors[0]);
    assert.equal(live.canvas.history.current, step, 'no undo step');
    assert.deepEqual(live.canvas.getData(), saved, 'and nothing is written');
    live.settings.canvasFallbackPalette = 'mist';
    live.manager.refresh(); live.doc.flush();
    assert.equal(auto('r'), presetColors(appearancePreset('mist'), legacy).rootColor, 'a new pairing redraws at once');
    live.settings.canvasFallbackPalette = null;
    live.manager.refresh(); live.doc.flush();
    assert.equal(auto('r'), '', 'no pairing takes the colours away');
    assert.equal(live.canvas.nodes.get('a').nodeEl.classList.contains('nf-canvas-auto-color'), false);
    assert.deepEqual(live.canvas.getData(), saved);
    live.manager.destroy();
  }

  /* ---- "Match note palette": the map follows the note palette again ---- */
  {
    const follow = fixture();
    assert.equal(follow.binding.canRun('palette-follow'), false, 'nothing to follow without a pairing');
    follow.settings.canvasFallbackPalette = 'nord';
    follow.select('other-root');
    assert.equal(follow.binding.canRun('palette-follow'), true);
    const before = follow.canvas.getData();
    assert.equal(follow.binding.run('palette-follow'), true);
    const other = () => follow.canvas.nodes.get('other-root').getData();
    assert.equal('nfPalette' in other(), false, 'the map’s own palette is removed');
    assert.equal(other().nfLayout, 'balanced', 'and nothing else');
    assert.equal(follow.canvas.history.current, 1, 'in one undo step');
    follow.canvas.undo();
    assert.deepEqual(follow.canvas.getData(), before, 'undo brings it back');
    follow.select('leaf');
    assert.equal(follow.binding.run('palette-follow'), true, 'a map that already follows');
    assert.equal(follow.canvas.history.current, 0, 'records nothing');
    // The vivid look keeps its own colors, so the paired palette would never show on it: nothing to follow.
    const vivid = { ...other(), nfTheme: 'vivid' };
    follow.canvas.importData({ nodes: [vivid], edges: [] });
    follow.select('other-root');
    assert.equal(follow.binding.canRun('palette-follow'), false, 'a vivid map cannot follow');
    assert.equal(follow.binding.run('palette-follow'), false);
    assert.equal(other().nfPalette, 'forest', 'and keeps its own palette');
    follow.settings.canvasFallbackPalette = 'bogus';
    follow.canvas.importData({ nodes: [{ ...vivid, nfTheme: 'clean' }], edges: [] });
    assert.equal(follow.binding.canRun('palette-follow'), false, 'an unknown pairing is none');
  }
  {
    const doc = fakeDocument();
    const runs = [];
    const previews = [];
    let state = {
      palette: null, theme: 'clean', line: 'auto', font: 'default', shape: 'rounded', weight: 'normal', scale: 'normal', spacing: 'standard',
      boundary: null, summary: false, numbering: false, canColorBranch: false, canColor: false, canUncolor: false, fallback: 'nord', follows: true,
    };
    const panel = new StylePanel(doc, {
      state: () => state, preview: (patch) => previews.push(patch), applyPreset() {}, run: (action) => runs.push(action), close() {},
      support: modern,
    });
    const matches = () => panel.el.querySelectorAll('.nf-canvas-style-tile-match');
    assert.equal(matches().length, 1, 'one pinned tile');
    const match = matches()[0];
    assert.equal(match.getAttribute('aria-pressed'), 'true', 'current while the map follows');
    assert.equal(match.querySelector('.nf-canvas-style-tile-name').textContent, 'Match note paletteNordic', 'the name, then the paired scheme');
    assert.equal(match.querySelector('.nf-canvas-style-tile-name').querySelector('.nf-canvas-style-tile-sub').textContent, 'Nordic',
      'on a second line of its own');
    assert.equal(match.getAttribute('aria-label'), 'Match note palette · Nordic', 'it names the paired scheme');
    assert.equal(match.dataset.preset, 'match');
    assert.equal(panel.el.querySelectorAll('.nf-canvas-style-tile').length, APPEARANCE_PRESETS.length + 1);
    const section = match.parentElement.parentElement;
    const firstGroup = section.children.find((child) => child.classList.contains('nf-canvas-style-group'));
    assert.ok(section.children.indexOf(match.parentElement) < section.children.indexOf(section.querySelector('.nf-canvas-style-mine')), 'before my schemes');
    assert.ok(section.children.indexOf(section.querySelector('.nf-canvas-style-mine')) < section.children.indexOf(firstGroup), 'which come before the first group');
    assert.equal(section.querySelector('.nf-canvas-style-mine').hidden, true, 'without a way to save them, no schemes of one’s own');
    assert.equal(panel.el.querySelectorAll('[aria-pressed="true"]').filter((item) => item.classList.contains('nf-canvas-style-tile')).length, 1,
      'no scheme tile is pressed with it');
    match.dispatch('pointerenter');
    assert.deepEqual(previews.at(-1), { palette: 'nord' }, 'hovering shows the paired colours');
    match.dispatch('click');
    assert.deepEqual(previews.at(-1), null, 'the preview ends');
    assert.deepEqual(runs, ['palette-follow']);
    // On a vivid map the tile says why it cannot follow, and neither previews nor runs.
    state = { ...state, theme: 'vivid', follows: false, canFollow: false };
    panel.sync();
    assert.equal(match.disabled, true, 'a vivid map cannot follow');
    assert.equal(match.getAttribute('aria-label'), 'Match note palette · Nordic · The Vivid look keeps its own colors');
    const previewed = previews.length;
    match.dispatch('pointerenter');
    assert.equal(previews.length, previewed, 'no preview of colors it would not show');
    match.dispatch('click');
    assert.deepEqual(runs, ['palette-follow'], 'and no run');
    state = { ...state, theme: 'clean', follows: true, canFollow: true };
    panel.sync();
    assert.equal(match.disabled, false);
    assert.equal(match.getAttribute('aria-label'), 'Match note palette · Nordic');
    state = { ...state, palette: 'sakura', follows: false };
    panel.sync();
    assert.equal(match.getAttribute('aria-pressed'), 'false', 'a map with its own scheme does not follow');
    assert.equal(panel.el.querySelectorAll('.nf-canvas-style-tile').find((item) => item.dataset.preset === 'sakura').getAttribute('aria-pressed'), 'true');
    state = { ...state, fallback: 'mist' };
    panel.sync();
    assert.equal(matches().length, 1, 'a new pairing replaces the tile');
    assert.equal(matches()[0].getAttribute('aria-label'), 'Match note palette · Soft mist');
    assert.equal(matches()[0].querySelector('.nf-canvas-style-tile-sub').textContent, 'Soft mist', 'the second line follows the pairing');
    state = { ...state, fallback: null };
    panel.sync();
    assert.equal(matches().length, 0, 'no pairing, no tile');
    assert.equal(panel.el.querySelectorAll('.nf-canvas-style-tile-sub').length, 0, 'and no second line');
    panel.destroy();
  }

  /* ---- my schemes: settings data, applying one, and the panel's tiles and form ---- */
  const s1 = {
    id: 's1', name: 'Warm', rootColor: '#aa3311', branchColors: ['#112233', '2', '#334455', '4', '#556677', '6'],
    dark: { rootColor: '#ffbb99', branchColors: ['#aabbcc', '2', '#ccddee', '4', '#ddeeff', '6'] },
    theme: 'cards', line: 'elbow', spacing: 'roomy', font: 'serif', shape: 'square',
  };
  const s2 = { id: 's2', name: 'Plain', rootColor: '1', branchColors: ['1', '2', '3', '4', '5', '6'], theme: 'clean', line: 'curve', spacing: 'standard' };
  {
    assert.deepEqual(userSchemesFrom([s1, s2]), [s1, s2], 'valid schemes pass through');
    for (const junk of [undefined, null, 'x', {}, 3]) assert.deepEqual(userSchemesFrom(junk), []);
    assert.deepEqual(userSchemesFrom([
      { ...s1, theme: 'glossy' }, { ...s1, branchColors: s1.branchColors.slice(0, 5) }, { ...s1, name: 7 }, { ...s1, id: '' },
      { ...s1, line: 'zigzag' }, { ...s1, spacing: 'huge' }, { ...s1, rootColor: 'var(--x)' }, null, 'scheme', { ...s1, name: '   ' },
    ]), [], 'malformed entries are dropped');
    assert.deepEqual(userSchemesFrom([s1, { ...s2, id: 's1' }, s2]).map((item) => item.id), ['s1', 's2'], 'a repeated id is dropped');
    assert.equal(userSchemesFrom([{ ...s1, name: 'n'.repeat(60) }])[0].name.length, SCHEME_NAME_MAX, 'names are trimmed to 40');
    assert.equal(SCHEME_NAME_MAX, 40);
    assert.equal(userSchemesFrom(Array.from({ length: 50 }, (_, i) => ({ ...s2, id: `x${i}` }))).length, USER_SCHEME_LIMIT, 'at most 36');
    assert.equal(USER_SCHEME_LIMIT, 36);
    assert.deepEqual(userSchemesFrom([{ ...s2, font: 'default', shape: 'rounded', rootColor: '#ABCDEF' }])[0],
      { ...s2, rootColor: '#abcdef' }, 'default face and shape are not kept; hex is lowercased');
    assert.equal(userSchemesFrom([{ ...s1, dark: { rootColor: 'bad' } }])[0].dark, undefined, 'a bad dark set is dropped');
    assert.equal(suggestSchemeName('Map scheme', ['Map scheme 1']), 'Map scheme 2');
    assert.equal(suggestSchemeName('Map scheme', []), 'Map scheme 1');
    assert.equal(suggestSchemeName('Map scheme', ['Map scheme 2', 'Other']), 'Map scheme 1', 'the first free number');
    assert.equal(newSchemeId([], 36 ** 3), 'u1000');
    assert.equal(newSchemeId(['u1000', 'u1000-1'], 36 ** 3), 'u1000-2', 'suffixed until unique');
    const preset = schemeAsPreset(s2);
    assert.equal(preset.branchColors[0], 'var(--canvas-color-1)', 'drawn with CSS colors');
    assert.equal(preset.theme, 'clean');
    assert.equal(preset.description, '');
    assert.equal(schemeAsPreset(s1).font, 'serif');
    assert.deepEqual(presetColors(schemeAsPreset(s1)).branchColors[1], 'light-dark(var(--canvas-color-2), var(--canvas-color-2))');
  }
  {
    const f = fixture();
    f.settings.canvasUserSchemes = [s1, s2];
    const before = f.canvas.getData();
    assert.equal(f.binding.applyScheme('s1'), true);
    const root = f.root();
    assert.equal(root.nfPalette, 'custom');
    assert.deepEqual(root.nfPaletteColors, { rootColor: s1.rootColor, branchColors: s1.branchColors, dark: s1.dark }, 'the exact raw colours go on the root');
    assert.deepEqual([root.nfTheme, root.nfLine, root.nfSpacing, root.nfFont, root.nfShape], ['cards', 'elbow', 'roomy', 'serif', 'square'], 'and the look');
    assert.equal(root.color, '#AABBCC', 'the root keeps its own colour');
    assert.equal(f.canvas.history.current, 1, 'one undo step');
    assert.equal(f.calls.tidy, 1);
    f.canvas.undo();
    assert.deepEqual(f.canvas.getData(), before, 'undo restores it');
    f.canvas.redo();
    assert.equal(f.binding.applyScheme('s1'), true);
    assert.equal(f.canvas.history.current, 1, 'applying it again records nothing');
    assert.equal(f.binding.run('preset-mist'), true);
    assert.equal('nfPaletteColors' in f.root(), false, 'a preset takes the colours away');
    assert.equal(f.root().nfPalette, 'mist');
    assert.equal(f.binding.applyScheme('s2'), true);
    assert.equal(f.root().nfPaletteColors.dark, undefined, 'a scheme without dark tones stores none');
    assert.equal(f.binding.run('palette-off'), true);
    assert.equal('nfPaletteColors' in f.root(), false, 'so does turning automatic colours off');
    assert.equal(f.root().nfPalette, 'none');
    f.settings.canvasFallbackPalette = 'nord';
    f.binding.applyScheme('s2');
    assert.equal(f.binding.run('palette-follow'), true);
    assert.equal('nfPaletteColors' in f.root() || 'nfPalette' in f.root(), false, 'and following the note palette');
    assert.equal(f.binding.applyScheme('missing'), false, 'an unknown scheme changes nothing');

    const only = fixture();
    only.settings.canvasUserSchemes = [s1];
    assert.equal(only.binding.applyScheme('s1', true), true);
    assert.deepEqual(only.root(), { ...initial.nodes[0], nfPalette: 'custom', nfPaletteColors: { rootColor: s1.rootColor, branchColors: s1.branchColors, dark: s1.dark } },
      'colours only: just the two palette keys');
    assert.equal(only.calls.tidy, 0);

    const locked = fixture();
    locked.settings.canvasUserSchemes = [s1];
    locked.canvas.readonly = true;
    assert.equal(locked.binding.applyScheme('s1'), false);
    assert.deepEqual(locked.canvas.getData(), initial, 'a read-only canvas is left alone');
  }
  {
    const doc = fakeDocument();
    const calls = { apply: [], remove: [], save: [], close: 0, focus: 0 };
    const previews = [];
    let state = {
      palette: 'custom', theme: 'clean', line: 'auto', font: 'default', shape: 'rounded', weight: 'normal', scale: 'normal', spacing: 'standard',
      boundary: null, summary: false, numbering: false, canColorBranch: false, canColor: false, canUncolor: false,
      custom: { rootColor: s2.rootColor, branchColors: s2.branchColors }, schemes: [s1, s2], canSaveScheme: true,
    };
    let saves = true;
    const panel = new StylePanel(doc, {
      state: () => state, preview: (patch) => previews.push(patch), applyPreset() {}, run() {}, close: () => { calls.close++; },
      applyScheme: (id, colorsOnly) => calls.apply.push([id, colorsOnly]), deleteScheme: (id) => calls.remove.push(id),
      saveScheme: (name) => { calls.save.push(name); return saves; }, focusCanvas: () => { calls.focus++; },
      support: modern,
    });
    // A real checkbox starts unchecked; the stand-in element has no default.
    panel.el.querySelector('.nf-canvas-style-switch').querySelector('input').checked = false;
    const mine = panel.el.querySelector('.nf-canvas-style-mine');
    assert.ok(mine, 'my schemes have a block');
    assert.equal(mine.hidden, false);
    assert.equal(mine.querySelector('.nf-canvas-style-group').textContent, 'My schemes');
    const section = mine.parentElement;
    const firstGroup = section.children.find((child) => child.classList.contains('nf-canvas-style-group'));
    assert.ok(section.children.indexOf(mine) < section.children.indexOf(firstGroup), 'before the built-in groups');
    const wraps = mine.querySelectorAll('.nf-canvas-style-tile-wrap');
    assert.equal(wraps.length, 2, 'one tile per saved scheme');
    const grid = mine.querySelector('.nf-canvas-style-mine-tiles');
    assert.equal(grid.hidden, false);
    const tile = (id) => mine.querySelectorAll('.nf-canvas-style-tile').find((item) => item.dataset.scheme === id);
    assert.equal(tile('s1').getAttribute('aria-label'), 'Warm');
    assert.equal(tile('s1').querySelector('.nf-canvas-style-tile-name').textContent, 'Warm');
    assert.ok(tile('s1').querySelector('.nf-canvas-style-thumb'), 'drawn like a preset');
    assert.equal(tile('s1').getAttribute('aria-pressed'), 'false');
    assert.equal(tile('s2').getAttribute('aria-pressed'), 'true', 'the scheme whose colours the map carries is marked');
    tile('s1').dispatch('pointerenter');
    assert.deepEqual(previews.at(-1), { colors: { rootColor: s1.rootColor, branchColors: s1.branchColors, dark: s1.dark },
      theme: 'cards', line: 'elbow', font: 'serif', shape: 'square' }, 'hovering previews its colours and look');
    tile('s1').dispatch('click');
    assert.equal(previews.at(-1), null, 'a click ends the preview');
    assert.deepEqual(calls.apply, [['s1', false]]);
    panel.el.querySelector('.nf-canvas-style-switch').querySelector('input').checked = true;
    tile('s2').dispatch('pointerenter');
    assert.deepEqual(previews.at(-1), { colors: { rootColor: s2.rootColor, branchColors: s2.branchColors } }, 'colours only previews colours only');
    tile('s2').dispatch('click');
    assert.deepEqual(calls.apply.at(-1), ['s2', true]);
    panel.el.querySelector('.nf-canvas-style-switch').querySelector('input').checked = false;
    wraps[0].querySelector('.nf-canvas-style-tile-delete').dispatch('click');
    assert.deepEqual(calls.remove, ['s1'], 'its ✕ deletes it');
    assert.equal(wraps[0].querySelector('.nf-canvas-style-tile-delete').getAttribute('aria-label'), 'Delete scheme');
    tile('s2').dispatch('keydown', { key: 'Delete' });
    assert.deepEqual(calls.remove, ['s1', 's2'], 'and so does Delete on a focused tile');
    // Deleting from the keyboard redraws the tiles; the focus stays in the panel.
    tile('s1').focus();
    state = { ...state, schemes: [s2] };
    panel.sync();
    assert.equal(mine.querySelectorAll('.nf-canvas-style-tile-wrap').length, 1, 'the list follows the settings');
    assert.ok(doc.activeElement === tile('s2'), 'a tile deleted from the keyboard hands the focus to the one now in its place');
    const saveButton = mine.querySelectorAll('.nf-canvas-style-action').find((button) => button.textContent === 'Save as my scheme');
    tile('s2').parentElement.querySelector('.nf-canvas-style-tile-delete').focus();
    state = { ...state, schemes: [] };
    panel.sync();
    assert.equal(grid.hidden, true, 'no schemes, no grid');
    assert.equal(grid.style.getPropertyValue('display'), 'none', 'hidden even where a class lays the grid out');
    assert.ok(doc.activeElement === saveButton, 'the last one deleted hands the focus to Save');
    {
      // A scheme that stays keeps the focus on its own tile (or ✕) as the others go.
      const s3 = { ...s2, id: 's3', name: 'Third' };
      state = { ...state, schemes: [s1, s2, s3] };
      panel.sync();
      tile('s3').focus();
      state = { ...state, schemes: [s3] };
      panel.sync();
      assert.ok(doc.activeElement === tile('s3'), 'the same scheme’s tile, wherever it moved');
      tile('s3').parentElement.querySelector('.nf-canvas-style-tile-delete').focus();
      state = { ...state, schemes: [s1, s3] };
      panel.sync();
      assert.ok(doc.activeElement === tile('s3').parentElement.querySelector('.nf-canvas-style-tile-delete'), 'or its ✕');
      // Nothing left to take it in the panel: back to the canvas.
      const focusBefore = calls.focus;
      tile('s1').focus();
      state = { ...state, schemes: [], canSaveScheme: false };
      panel.sync();
      assert.equal(calls.focus, focusBefore + 1, 'with Save unavailable, the canvas takes the focus');
      calls.focus = focusBefore;
      state = { ...state, canSaveScheme: true };
      panel.sync();
      // Focus elsewhere is left alone.
      doc.activeElement = doc.body;
      state = { ...state, schemes: [s1] };
      panel.sync();
      assert.ok(doc.activeElement === doc.body, 'a redraw without the focus in the tiles moves no focus');
      state = { ...state, schemes: [] };
      panel.sync();
    }

    // Saving: an inline name field.
    const save = mine.querySelectorAll('.nf-canvas-style-action').find((button) => button.textContent === 'Save as my scheme');
    const form = mine.querySelector('.nf-canvas-style-scheme-form');
    const input = form.querySelector('.nf-canvas-style-scheme-name');
    assert.equal(form.hidden, true, 'the form waits for the button');
    assert.equal(input.getAttribute('aria-label'), 'Scheme name');
    assert.equal(input.maxLength, 40);
    assert.equal(save.disabled, false);
    state = { ...state, schemes: [{ ...s2, name: 'Map scheme 1' }] };
    panel.sync();
    save.dispatch('click');
    assert.equal(form.hidden, false, 'Save as my scheme opens the name field');
    assert.equal(save.parentElement.hidden, true, 'in place of the button');
    assert.equal(input.value, 'Map scheme 2', 'with a name that is not taken');
    assert.equal(doc.activeElement, input);
    input.value = 'Mine';
    input.dispatch('keydown', { key: 'Enter', isComposing: true });
    assert.deepEqual(calls.save, [], 'Enter while composing is the IME’s');
    input.dispatch('keydown', { key: 'Enter', keyCode: 229 });
    assert.deepEqual(calls.save, []);
    saves = false;
    input.dispatch('keydown', { key: 'Enter' });
    assert.deepEqual(calls.save, ['Mine']);
    assert.equal(form.hidden, false, 'a save that fails keeps the field');
    assert.equal(input.classList.contains('is-invalid'), true);
    saves = true;
    const enter = input.dispatch('keydown', { key: 'Enter' });
    assert.equal(enter.defaultPrevented, true);
    assert.deepEqual(calls.save, ['Mine', 'Mine']);
    assert.equal(form.hidden, true, 'a save closes the field');
    assert.equal(save.parentElement.hidden, false);
    assert.equal(calls.focus, 1, 'and gives the keyboard back to the canvas');
    save.dispatch('click');
    const escape = input.dispatch('keydown', { key: 'Escape' });
    assert.equal(escape.defaultPrevented, true);
    assert.equal(form.hidden, true, 'Escape closes the field');
    assert.equal(calls.close, 0, 'but not the panel');
    save.dispatch('click');
    form.querySelectorAll('.nf-canvas-style-action').find((button) => button.textContent === 'Cancel').dispatch('click');
    assert.equal(form.hidden, true, 'Cancel closes it too');
    save.dispatch('click');
    input.value = 'By click';
    form.querySelectorAll('.nf-canvas-style-action').find((button) => button.textContent === 'Save').dispatch('click');
    assert.deepEqual(calls.save.at(-1), 'By click');
    state = { ...state, canSaveScheme: false };
    panel.sync();
    assert.equal(save.disabled, true, 'nothing to save, or no room: the button is off');
    panel.destroy();
  }

  /* ---- tiles show all six colours; the sections below the schemes fold ---- */
  {
    const doc = fakeDocument();
    const saves = [];
    let loaded;
    const make = () => new StylePanel(doc, {
      state: () => ({
        palette: null, theme: 'clean', line: 'auto', font: 'default', shape: 'rounded', weight: 'normal', scale: 'normal', spacing: 'standard',
        boundary: null, summary: false, numbering: false, canColorBranch: false, canColor: false, canUncolor: false, fallback: 'nord', follows: true,
        schemes: [s1], canSaveScheme: true,
      }),
      preview() {}, applyPreset() {}, run() {}, close() {}, saveScheme: () => true,
      sections: { load: () => loaded, save: (open) => saves.push(open) },
      support: modern,
    });
    const panel = make();
    const tiles = panel.el.querySelectorAll('.nf-canvas-style-tile');
    assert.equal(tiles.length, APPEARANCE_PRESETS.length + 2, 'presets, the pinned tile and a saved scheme');
    for (const tile of tiles) {
      const strips = tile.querySelectorAll('.nf-canvas-style-dots');
      assert.equal(strips.length, 1, `${tile.dataset.preset ?? tile.dataset.scheme}: one strip of dots`);
      assert.equal(strips[0].getAttribute('viewBox'), '0 0 132 8');
      assert.equal(strips[0].getAttribute('aria-hidden'), 'true');
      const dots = strips[0].querySelectorAll('circle');
      assert.equal(dots.length, 6, 'six dots');
      const preset = tile.dataset.scheme ? schemeAsPreset(s1) : appearancePreset(tile.dataset.preset === 'match' ? 'nord' : tile.dataset.preset);
      assert.deepEqual(dots.map((dot) => dot.style.getPropertyValue('fill')), [...presetColors(preset, modern).branchColors].slice(0, 6),
        `${preset.id}: the branch colours, dark tones included`);
    }
    const sections = panel.el.querySelectorAll('.nf-canvas-style-section');
    const byKey = (key) => sections.find((section) => section.dataset.section === key);
    const keys = ['look', 'lines', 'shape', 'font', 'scale', 'weight', 'spacing', 'branches'];
    assert.deepEqual(sections.map((section) => section.dataset.section).filter(Boolean), keys, 'every section below the schemes folds');
    assert.equal(sections[0].dataset.section, undefined, 'the schemes do not');
    const toggle = (key) => byKey(key).querySelector('.nf-canvas-style-section-toggle');
    const body = (key) => byKey(key).querySelector('.nf-canvas-style-section-body');
    for (const key of keys) {
      assert.equal(toggle(key).getAttribute('aria-expanded'), String(key === 'look'), `${key}: only Look is open at first`);
      assert.equal(body(key).hidden, key !== 'look');
      assert.ok(byKey(key).querySelector('.nf-canvas-style-section-head').classList.contains('is-collapsible'));
    }
    assert.equal(toggle('spacing').getAttribute('aria-label'), 'Spacing');
    assert.ok(body('spacing').querySelector('.nf-canvas-style-options'), 'the choices sit in the folding body');
    byKey('spacing').querySelector('.nf-canvas-style-section-head').dispatch('click');
    assert.deepEqual(saves.at(-1), ['look', 'spacing'], 'opening one keeps the open set');
    assert.equal(body('spacing').hidden, false);
    assert.equal(toggle('spacing').getAttribute('aria-expanded'), 'true');
    byKey('look').querySelector('.nf-canvas-style-section-head').dispatch('click');
    assert.deepEqual(saves.at(-1), ['spacing']);
    assert.equal(body('look').hidden, true);
    assert.equal(body('look').style.getPropertyValue('display'), 'none');
    panel.destroy();
    loaded = ['branches'];
    const again = make();
    const open = (p) => p.el.querySelectorAll('.nf-canvas-style-section-toggle').filter((item) => item.getAttribute('aria-expanded') === 'true')
      .map((item) => item.closest('.nf-canvas-style-section').dataset.section);
    assert.deepEqual(open(again), ['branches'], 'the saved set opens');
    again.destroy();
    for (const junk of [['look', 'nonsense'], 'look', 3, null]) {
      loaded = junk;
      const fresh = make();
      assert.deepEqual(open(fresh), ['look'], `junk (${JSON.stringify(junk)}) falls back to Look`);
      fresh.destroy();
    }
  }

  /* ---- the commands: 配色 / "color scheme" finds every preset ---- */
  {
    const live = canvasFixture(CanvasEnhancements, { nodes: [nodeData('r', 0, 0)], edges: [] });
    assert.equal(live.commands.get('canvas-preset-dunhuang').name, 'Canvas: color scheme · Dunhuang');
    for (const preset of APPEARANCE_PRESETS) {
      assert.equal(live.commands.get(`canvas-preset-${preset.id}`).name, `Canvas: color scheme · ${preset.name}`, `${preset.id}: named as a colour scheme`);
    }
    assert.equal(live.commands.get('canvas-colorBranch').name, 'Canvas: color this branch\u2026');
    assert.equal(live.commands.get('canvas-colors').name, 'Canvas: auto-color all branches');
    assert.equal(live.commands.get('canvas-find').name, 'Canvas: find text in map');
    assert.equal(live.commands.get('canvas-search').name, 'Canvas: jump to card\u2026');
    live.manager.destroy();
  }

  console.log('PASS canvas preset actions: one-step undo, metadata preservation, every scheme and its typeface, colours-only mode, layout settings, read-only safety, tile names, twenty-three presets, maps that follow the note palette, my schemes (data, apply, tiles, the name field) and the renamed commands');
} finally {
  await rm(directory, { recursive: true, force: true });
}
