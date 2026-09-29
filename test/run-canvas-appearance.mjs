import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'notion-flow-appearance-'));
try {
  const source = file => JSON.stringify(fileURLToPath(new URL(`../src/canvas/${file}`, import.meta.url)));
  const entry = join(directory, 'entry.ts');
  await writeFile(entry, `export * from ${source('appearance.ts')};\nexport { buildForest } from ${source('graph.ts')};\n`);
  const outfile = join(directory, 'appearance.mjs');
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' });
  const {
    APPEARANCE_PRESETS, PRESET_GROUPS, asPaletteId, appearancePreset, safeCanvasColor, planAutoColors, buildForest,
    presetColors, colorSupport, asMapStyle, asCanvasFont, isRichText, MAP_STYLES, CANVAS_FONTS,
    PALETTE_COLORS_KEY, CUSTOM_PALETTE, paletteColorsFrom, cssPalette, customPalette, sameColors,
  } = await import(pathToFileURL(outfile).href);
  const zh = await readFile(new URL('../src/i18n.ts', import.meta.url), 'utf8');
  const translated = (key) => zh.includes(`${JSON.stringify(key)}:`) || zh.includes(`\n  ${key}:`);
  // OKLCH lightness of a hex colour: sRGB -> linear -> LMS cube root -> L.
  const oklchL = (hex) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  };
  const node = (id, x, y, extra = {}) => ({ id, type: 'text', x, y, width: 180, height: 60, text: id, ...extra });
  const edge = (fromNode, toNode, extra = {}) => ({ id: `${fromNode}-${toNode}`, fromNode, toNode, ...extra });
  const data = {
    nodes: [
      node('root', 0, 0, { nfLayout: 'right', nfPalette: 'mist' }),
      node('first', 300, 0), node('second', 300, 300), node('third', 300, 600),
      node('first-child', 600, 0), node('first-grandchild', 900, 0),
      node('loose', 0, 1200),
    ],
    edges: [edge('root', 'first'), edge('root', 'second'), edge('root', 'third'), edge('first', 'first-child'), edge('first-child', 'first-grandchild'), edge('root', 'loose', { label: 'Related' })],
  };
  // Automatic colours carry the dark variant: compare with the planned CSS values.
  const palette = presetColors(appearancePreset('mist'));
  const before = structuredClone(data);
  const plan = planAutoColors(data, buildForest(data));
  assert.equal(APPEARANCE_PRESETS.length, 23);
  assert.equal(new Set(APPEARANCE_PRESETS.map(preset => preset.id)).size, 23);
  // The five of round two, exactly as designed, after the eighteen before them.
  assert.deepEqual(APPEARANCE_PRESETS.slice(18).map(preset => preset.id), ['dunhuang', 'neon', 'okabe', 'candy', 'retro']);
  assert.deepEqual(appearancePreset('dunhuang'), {
    id: 'dunhuang', name: 'Dunhuang', group: 'natural', description: 'Mural ochre, malachite and lapis on a warm ground.',
    theme: 'pastel', line: 'organic', spacing: 'roomy', shape: 'pill', rootColor: '#7A3B2E',
    branchColors: ['#B5533C', '#4E8D7C', '#3E5E9C', '#C2913E', '#D0795E', '#6F6A63'],
    dark: { rootColor: '#FEA28E', branchColors: ['#FB947B', '#72C7B0', '#8CB4FE', '#E2A948', '#FB9576', '#B9B3AC'] },
  });
  assert.deepEqual(appearancePreset('neon'), {
    id: 'neon', name: 'Midnight neon', group: 'bold', description: 'Dark-first neon branches that glow on a night canvas.',
    theme: 'gradient', line: 'organic', spacing: 'standard', rootColor: '#5B3FD9',
    branchColors: ['#0891B2', '#65A30D', '#DB2777', '#CA8A04', '#2563EB', '#EA580C'],
    dark: { rootColor: '#8B7BFF', branchColors: ['#22D3EE', '#A3E635', '#F472B6', '#FACC15', '#60A5FA', '#FB923C'] },
  });
  assert.deepEqual(appearancePreset('okabe'), {
    id: 'okabe', name: 'Clear contrast', group: 'focus', description: 'Okabe\u2013Ito colors that stay distinct for color-blind readers.',
    theme: 'cards', line: 'elbow', spacing: 'standard', rootColor: '#1F2937',
    branchColors: ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00'],
    dark: { rootColor: '#E5E7EB', branchColors: ['#3E99DC', '#E69F00', '#3FBE91', '#CC79A7', '#7FCFFE', '#E57432'] },
  });
  assert.deepEqual(appearancePreset('candy'), {
    id: 'candy', name: 'Candy pop', group: 'bold', description: 'Bright candy blocks in pill shapes.',
    theme: 'pastel', line: 'curve', spacing: 'roomy', shape: 'pill', rootColor: '#E0457B',
    branchColors: ['#FF7A9A', '#FFA94D', '#F5C83B', '#4CC9A0', '#4DABF7', '#9775FA'],
    dark: { rootColor: '#FE9CB5', branchColors: ['#FA8FA6', '#EDA153', '#D4B045', '#4CCEA4', '#6DBBFE', '#B6A4FF'] },
  });
  assert.deepEqual(appearancePreset('retro'), {
    id: 'retro', name: 'Retro 70s', group: 'natural', description: 'Rust, mustard and teal in a serif face.',
    theme: 'cards', line: 'elbow', spacing: 'standard', font: 'serif', shape: 'square', rootColor: '#4A2E23',
    branchColors: ['#C8553D', '#E09F3E', '#6A8D3A', '#2A7F8E', '#8E4A6B', '#B0703C'],
    dark: { rootColor: '#F0AB90', branchColors: ['#FC947D', '#E6A64B', '#9BC467', '#59C6DA', '#F092BE', '#F29E5B'] },
  });
  assert.deepEqual(Object.fromEntries(PRESET_GROUPS.map(([group]) => [group, APPEARANCE_PRESETS.filter(preset => preset.group === group).length])),
    { soft: 7, natural: 6, bold: 6, focus: 4 });
  assert.ok(translated('Canvas: color scheme · {name}'), 'the preset commands have a Chinese name');
  for (const id of ['mist', 'ocean', 'forest', 'sunset', 'ink', 'sakura', 'vivid', 'nord']) {
    assert.ok(appearancePreset(id), `preset ids saved by earlier versions still resolve: ${id}`);
  }
  for (const preset of APPEARANCE_PRESETS) {
    assert.ok(preset.name && preset.description);
    assert.ok(translated(preset.name) && translated(preset.description), `${preset.id} has a Chinese name and description`);
    assert.ok(PRESET_GROUPS.some(([group]) => group === preset.group));
    assert.ok(MAP_STYLES.includes(preset.theme));
    assert.ok(preset.font === undefined || CANVAS_FONTS.includes(preset.font));
    assert.ok(safeCanvasColor(preset.rootColor));
    assert.ok(preset.branchColors.length >= 6);
    assert.ok(preset.branchColors.every(color => safeCanvasColor(color)), `${preset.id}: literal hex fallbacks`);
    assert.ok(preset.dark, `${preset.id} has a designed dark variant`);
    assert.ok(safeCanvasColor(preset.dark.rootColor));
    assert.equal(preset.dark.branchColors.length, 6);
    assert.equal(preset.dark.branchColors.length, preset.branchColors.length);
    assert.ok(preset.dark.branchColors.every(color => safeCanvasColor(color)), `${preset.id}: literal dark hex`);
    // Luminous tones on dark grounds; solid fills stay medium for their white words.
    const solid = preset.theme === 'vivid' || preset.theme === 'gradient';
    let [low, high] = solid ? [0.55, 0.70] : [0.64, 0.86];
    // Exception: Midnight neon is dark-first and luminous by design; its
    // gradient topics take dark ink (auto-ink) instead of white words.
    if (preset.id === 'neon') [low, high] = [0.64, 0.87];
    for (const color of [preset.dark.rootColor, ...preset.dark.branchColors]) {
      const l = oklchL(color);
      // Exception: Clear contrast's dark centre is a neutral near-white (#E5E7EB, L ≈ 0.93).
      const top = preset.id === 'okabe' && color === preset.dark.rootColor ? 0.95 : high;
      assert.ok(l >= low && l <= top, `${preset.id} dark ${color}: OKLCH L ${l.toFixed(3)} within [${low}, ${top}]`);
    }
  }
  for (const [, label] of PRESET_GROUPS) assert.ok(translated(label), `group ${label} is translated`);
  for (const group of PRESET_GROUPS) assert.ok(APPEARANCE_PRESETS.some(preset => preset.group === group[0]), 'no empty group');
  assert.equal(plan.nodes.get('root'), palette.rootColor);
  assert.equal(plan.nodes.get('first'), palette.branchColors[0]);
  assert.equal(plan.nodes.get('second'), palette.branchColors[1]);
  assert.equal(plan.nodes.get('third'), palette.branchColors[2]);
  assert.equal(plan.nodes.get('first-grandchild'), palette.branchColors[0]);
  assert.equal(plan.edges.get('first-first-child'), palette.branchColors[0]);
  assert.equal(plan.nodes.has('loose'), false, 'labelled relationships do not adopt or colour cards');
  assert.equal(plan.edges.has('root-loose'), false);
  assert.deepEqual(data, before, 'presets never overwrite native JSON Canvas colours');

  const manual = structuredClone(data);
  manual.nodes.find(item => item.id === 'root').color = '6';
  manual.nodes.find(item => item.id === 'first-child').color = '#D89560';
  manual.edges.find(item => item.id === 'root-second').color = '2';
  const manualPlan = planAutoColors(manual, buildForest(manual));
  assert.equal(manualPlan.nodes.has('root'), false);
  assert.equal(manualPlan.nodes.get('first'), palette.branchColors[0], 'manual root colour leaves main branch accents distinct');
  assert.equal(manualPlan.nodes.has('first-child'), false);
  assert.equal(manualPlan.nodes.get('first-grandchild'), '#D89560', 'a manual branch accent is inherited by its descendants');
  assert.equal(manualPlan.edges.get('first-first-child'), '#D89560', 'an automatic line matches its manually coloured child');
  assert.equal(manualPlan.edges.has('root-second'), false, 'manual edge colours are preserved');

  const additions = structuredClone(data);
  additions.nodes.push(node('new-branch', 300, 900), node('new-leaf', 600, 900));
  additions.edges.push(edge('root', 'new-branch'), edge('new-branch', 'new-leaf'));
  const additionPlan = planAutoColors(additions, buildForest(additions));
  assert.equal(additionPlan.nodes.get('new-branch'), palette.branchColors[3]);
  assert.equal(additionPlan.nodes.get('new-leaf'), palette.branchColors[3], 'future descendants receive the palette without persisted native colours');
  assert.equal(additionPlan.nodes.get('first'), plan.nodes.get('first'));
  additions.nodes[0].nfPalette = 'forest';
  const switched = planAutoColors(additions, buildForest(additions));
  assert.equal(switched.nodes.get('first-grandchild'), presetColors(appearancePreset('forest')).branchColors[0], 'changing presets recolours the whole automatic branch');

  assert.equal(safeCanvasColor('1'), 'var(--canvas-color-1)');
  assert.equal(safeCanvasColor('#AbC'), '#AbC');
  assert.equal(safeCanvasColor('#aBbCde'), '#aBbCde');
  for (const invalid of [undefined, null, 1, {}, '0', '7', '12', 'red', 'var(--text-normal)', '#123456; color:red', 'url(https://example.com)', 'rgb(1,2,3)', '#12345', '#123456\n']) {
    assert.equal(safeCanvasColor(invalid), null, `unsafe or unsupported colour: ${String(invalid)}`);
  }
  const invalidManual = structuredClone(data);
  invalidManual.nodes.find(item => item.id === 'first-child').color = 'url(https://example.com)';
  const safePlan = planAutoColors(invalidManual, buildForest(invalidManual));
  assert.equal(safePlan.nodes.has('first-child'), false, 'an unsupported manual value is still not overwritten');
  assert.equal(safePlan.nodes.get('first-grandchild'), palette.branchColors[0], 'unsafe manual values never flow into descendant CSS');
  assert.equal(safePlan.edges.get('first-first-child'), palette.branchColors[0]);

  const noPreset = structuredClone(data);
  delete noPreset.nodes[0].nfPalette;
  assert.equal(planAutoColors(noPreset, buildForest(noPreset)).nodes.size, 0);
  const vivid = planAutoColors(noPreset, buildForest(noPreset), new Set(['root']));
  assert.equal(vivid.nodes.has('root'), false, 'legacy vivid keeps its native root accent');
  assert.equal(vivid.nodes.get('first'), 'var(--canvas-color-1)');
  assert.equal(vivid.nodes.get('second'), 'var(--canvas-color-2)');
  noPreset.nodes[0].nfPalette = 'none';
  assert.equal(asPaletteId('none'), 'none');
  assert.equal(appearancePreset('none'), null);
  assert.equal(planAutoColors(noPreset, buildForest(noPreset), new Set(['root'])).nodes.size, 0, 'explicit none disables legacy vivid as well');
  for (const invalid of ['missing', 'constructor', '__proto__', {}, null, 3]) {
    assert.equal(asPaletteId(invalid), null);
    assert.equal(appearancePreset(invalid), null);
  }
  noPreset.nodes[0].nfPalette = 'missing';
  assert.equal(planAutoColors(noPreset, buildForest(noPreset)).nodes.size, 0);
  assert.equal(planAutoColors(noPreset, buildForest(noPreset), new Set(['root'])).nodes.get('first'), 'var(--canvas-color-1)', 'unknown palette metadata safely falls back to the current theme');

  // Dark variants and derived colours are chosen by what the engine supports.
  const ink = appearancePreset('ink');
  const modern = { lightDark: true, relative: true };
  const legacy = { lightDark: false, relative: false };
  assert.equal(presetColors(ink, modern).rootColor, `light-dark(${ink.rootColor}, ${ink.dark.rootColor})`);
  assert.equal(presetColors(ink, modern).branchColors[2], `light-dark(${ink.branchColors[2]}, ${ink.dark.branchColors[2]})`);
  assert.equal(presetColors(ink, legacy), ink, 'engines without light-dark() use the light tones');
  const accent = appearancePreset('accent');
  assert.equal(presetColors(accent, modern).rootColor, 'var(--interactive-accent)');
  assert.match(presetColors(accent, modern).branchColors[1],
    /^light-dark\(oklch\(from var\(--interactive-accent\) 0\.6 .* calc\(h \+ 40\)\), oklch\(from var\(--interactive-accent\) 0\.78 .* calc\(h \+ 40\)\)\)$/,
    'derived accent harmonies switch to their dark tones');
  assert.match(presetColors(accent, { lightDark: false, relative: true }).branchColors[1], /^oklch\(from var\(--interactive-accent\) .* calc\(h \+ 40\)\)$/);
  assert.equal(presetColors(accent, { lightDark: false, relative: true }), accent.derived, 'no light-dark(): derived light tones');
  assert.equal(presetColors(accent, { lightDark: true, relative: false }).rootColor, `light-dark(${accent.rootColor}, ${accent.dark.rootColor})`, 'no relative colours: literal fallback, dark variant included');
  const ocean = appearancePreset('ocean');
  assert.equal(presetColors(ocean, legacy), ocean, 'engines without light-dark() keep the light literals');
  assert.equal(presetColors(ocean, modern).branchColors[0], `light-dark(${ocean.branchColors[0]}, ${ocean.dark.branchColors[0]})`);
  const inkMap = structuredClone(data);
  inkMap.nodes[0].nfPalette = 'ink';
  assert.equal(planAutoColors(inkMap, buildForest(inkMap)).nodes.get('first'), presetColors(ink, modern).branchColors[0]);
  assert.equal(planAutoColors(inkMap, buildForest(inkMap), new Set(), legacy).nodes.get('first'), ink.branchColors[0]);
  assert.deepEqual(colorSupport(undefined), legacy);
  assert.deepEqual(colorSupport({ supports: (_, value) => value.startsWith('light-dark') }), { lightDark: true, relative: false });
  assert.deepEqual(colorSupport({ supports: () => { throw new Error('no'); } }), legacy);

  // Clear contrast stays distinct for color-blind readers: Machado 2009
  // severity-1 simulation on linear sRGB, then OKLab distance × 100.
  {
    const MACHADO = {
      deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
      protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    };
    const linear = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const oklab = ([r, g, b]) => {
      const [l, m, s] = [
        0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
        0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
        0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b,
      ].map(Math.cbrt);
      return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
    };
    const simulate = (hex, matrix) => {
      const v = linear(hex);
      return matrix.map(row => Math.min(1, Math.max(0, row[0] * v[0] + row[1] * v[1] + row[2] * v[2])));
    };
    const worst = (colors, matrix) => {
      const labs = colors.map(color => oklab(simulate(color, matrix)));
      let min = Infinity;
      for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) min = Math.min(min, Math.hypot(...labs[i].map((v, k) => v - labs[j][k])) * 100);
      return min;
    };
    const okabe = appearancePreset('okabe');
    for (const [kind, matrix] of Object.entries(MACHADO)) {
      for (const [mode, colors] of [['light', okabe.branchColors], ['dark', okabe.dark.branchColors]]) {
        const distance = worst(colors, matrix);
        assert.ok(distance >= 5, `okabe ${mode} under ${kind}: closest pair ΔE ${distance.toFixed(1)} ≥ 5`);
      }
    }
    assert.ok(worst(appearancePreset('vivid').branchColors, MACHADO.deutan) < 5, 'the check tells a palette that is not safe (Vivid) apart');
  }

  // A map's own colors (from "My schemes"): validated raw values, drawn as CSS.
  {
    assert.equal(PALETTE_COLORS_KEY, 'nfPaletteColors');
    assert.equal(CUSTOM_PALETTE, 'custom');
    assert.equal(asPaletteId('custom'), 'custom');
    assert.equal(appearancePreset('custom'), null);
    const raw = { rootColor: '#AABBCC', branchColors: ['1', '#123456', '#ABCDEF', '4', '#FFF', '6'] };
    assert.deepEqual(paletteColorsFrom(raw), { rootColor: '#aabbcc', branchColors: ['1', '#123456', '#abcdef', '4', '#fff', '6'] }, 'hex is lowercased');
    for (const bad of [
      { ...raw, branchColors: raw.branchColors.slice(0, 5) }, { ...raw, rootColor: 'var(--x)' }, { ...raw, rootColor: 'red' },
      { ...raw, branchColors: ['#12345', ...raw.branchColors.slice(1)] }, { ...raw, branchColors: [...raw.branchColors, '1'] },
      'custom', null, undefined, 3, [], { branchColors: raw.branchColors },
    ]) assert.equal(paletteColorsFrom(bad), null, `rejected: ${JSON.stringify(bad)}`);
    const withDark = { ...raw, dark: { rootColor: '#DDEEFF', branchColors: ['#111111', '2', '3', '4', '5', '#222222'] } };
    assert.deepEqual(paletteColorsFrom(withDark).dark, { rootColor: '#ddeeff', branchColors: ['#111111', '2', '3', '4', '5', '#222222'] });
    assert.deepEqual(paletteColorsFrom({ ...raw, dark: { rootColor: 'url(x)', branchColors: [] } }), paletteColorsFrom(raw), 'a bad dark set is dropped, the rest kept');
    const css = cssPalette(paletteColorsFrom(withDark));
    assert.equal(css.branchColors[0], 'var(--canvas-color-1)', 'digits become Canvas colors');
    assert.equal(css.branchColors[1], '#123456');
    assert.equal(css.dark.branchColors[1], 'var(--canvas-color-2)');
    assert.equal(customPalette({ id: 'r', nfPaletteColors: raw }), null, 'colors without nfPalette: "custom" are ignored');
    assert.deepEqual(customPalette({ id: 'r', nfPalette: 'custom', nfPaletteColors: raw }), cssPalette(paletteColorsFrom(raw)));
    assert.equal(sameColors(paletteColorsFrom(raw), paletteColorsFrom({ ...raw, rootColor: '#aabbcc' })), true);
    assert.equal(sameColors(paletteColorsFrom(raw), paletteColorsFrom(withDark)), false, 'dark tones count');
    assert.equal(sameColors(null, paletteColorsFrom(raw)), false);

    const own = structuredClone(data);
    own.nodes[0].nfPalette = 'custom';
    own.nodes[0].nfPaletteColors = withDark;
    const ownInput = structuredClone(own);
    const ownPlan = planAutoColors(own, buildForest(own), new Set(), modern);
    const shown = presetColors(cssPalette(paletteColorsFrom(withDark)), modern);
    assert.equal(ownPlan.nodes.get('root'), 'light-dark(#aabbcc, #ddeeff)', 'the root takes its own color, with its dark tone');
    assert.equal(ownPlan.nodes.get('first'), shown.branchColors[0]);
    assert.equal(ownPlan.nodes.get('first'), 'light-dark(var(--canvas-color-1), #111111)');
    assert.equal(ownPlan.nodes.get('second'), shown.branchColors[1]);
    assert.equal(ownPlan.nodes.get('first-grandchild'), shown.branchColors[0], 'descendants inherit it');
    assert.equal(planAutoColors(own, buildForest(own), new Set(), legacy).nodes.get('first'), 'var(--canvas-color-1)', 'light tones without light-dark()');
    assert.deepEqual(own, ownInput, 'nothing is written');
    const lightOnly = structuredClone(data);
    lightOnly.nodes[0].nfPalette = 'custom';
    lightOnly.nodes[0].nfPaletteColors = raw;
    assert.equal(planAutoColors(lightOnly, buildForest(lightOnly), new Set(), modern).nodes.get('second'), '#123456', 'no dark set, no light-dark()');
    const stray = structuredClone(data);
    stray.nodes[0].nfPalette = 'ocean';
    stray.nodes[0].nfPaletteColors = raw;
    assert.equal(planAutoColors(stray, buildForest(stray)).nodes.get('first'), presetColors(appearancePreset('ocean')).branchColors[0], 'a preset ignores stray colors');
    const broken = structuredClone(data);
    broken.nodes[0].nfPalette = 'custom';
    broken.nodes[0].nfPaletteColors = { rootColor: 'red', branchColors: [] };
    assert.equal(planAutoColors(broken, buildForest(broken)).nodes.size, 0, 'invalid custom colors: no palette');
    assert.equal(planAutoColors(broken, buildForest(broken), new Set(['root'])).nodes.get('first'), 'var(--canvas-color-1)', 'or vivid for vivid maps');
    assert.equal(planAutoColors(broken, buildForest(broken), new Set(), modern, 'nord').nodes.size, 0, 'and never the paired palette');
  }

  // Stored style values are validated before they become classes.
  for (const theme of ['clean', 'cards', 'vivid', 'minimal', 'pastel', 'gradient']) assert.equal(asMapStyle(theme), theme);
  for (const invalid of ['Clean', 'fancy', '', null, 3, 'constructor']) assert.equal(asMapStyle(invalid), null);
  for (const font of ['default', 'sans', 'serif', 'kai']) assert.equal(asCanvasFont(font), font);
  for (const invalid of ['mono', 'Kai', '', null, {}]) assert.equal(asCanvasFont(invalid), null);

  // Topics centre and balance their words; notes keep reading alignment.
  for (const topic of ['中心主题', 'A short topic', '访谈 12 位核心用户', '  padded  ', '#tag at start', '-dash', '1.5x faster']) {
    assert.equal(isRichText(topic), false, `topic: ${topic}`);
  }
  for (const note of ['line one\nline two', '## Heading', '- item', '* item', '1. first', '> quote', '```js\nx\n```', '| a | b |', '![[image.png]]', '- [ ] task']) {
    assert.equal(isRichText(note), true, `note: ${JSON.stringify(note)}`);
  }

  console.log('PASS canvas appearance: twenty-three presets in four groups, translations, dark and derived colours, colour-blind-safe Clear contrast, a map\'s own colours, future branches, inheritance, manual colours, display-only switching, and safe fallback');
} finally {
  await rm(directory, { recursive: true, force: true });
}
