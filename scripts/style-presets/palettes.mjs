// Notion Flow — note-style palette presets: the single source of the palette tokens.
// `npm run gen:styles` (gen.mjs) builds the token block in styles.css from this file.
// Its only inputs sit next to it: source-calm.json (inks/washes for notion/paper/morandi,
// already verified) and source-curated.json (AA-ensured inks for nord/rose-pine/catppuccin/
// everforest/guose; their WASH SOURCES are re-solved here with the calm method so that the
// alpha already stored in notes (0.18, yellow 0.20) lands on a designed pastel). Both JSONs
// also hold rejected candidates (graphite, celadon, nippon); they are kept verbatim.
// Nothing here reads a scratch path. Classic is not generated: it must never change.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const CALM = require('./source-calm.json');
const CUR = require('./source-curated.json');
const cur = id => CUR.find ? CUR.find(p => p.id === id) : Object.values(CUR).find(p => p.id === id);

export const HUES = ['gray', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'];
export const BG = { light: '#ffffff', dark: '#1c1c1c' };
// Obsidian 1.13 default ramps (app.css) — used to derive ramps for palettes without one.
export const OBS_RAMP = {
  light: { '00': '#ffffff', '05': '#fcfcfc', '10': '#fafafa', '20': '#f6f6f6', '25': '#efefef', '30': '#e4e4e4', '35': '#dadada', '40': '#bdbdbd', '50': '#ababab', '60': '#707070', '70': '#5c5c5c', '100': '#222222' },
  dark: { '00': '#1c1c1c', '05': '#212121', '10': '#232323', '20': '#282828', '25': '#2e2e2e', '30': '#333333', '35': '#3f3f3f', '40': '#555555', '50': '#666666', '60': '#999999', '70': '#b3b3b3', '100': '#dadada' },
};

const calm = (id, mode) => {
  const m = CALM[id][mode];
  return { ink: m.ink, washSrc: Object.fromEntries(HUES.map(h => [h, m.washSrc[h].split(',').map(Number)])) };
};
const curInk = (id, mode) => cur(id)[mode].ink;
const curCode = (id, mode) => { const c = cur(id)[mode].code; const { background, ...rest } = c; return { bg: background, ...rest }; };
const curRamp = (id, mode) => cur(id)[mode].paper;
const calmCode = (id, mode) => CALM[id][mode].code;

// washSpec for re-solved palettes: hue source (canonical tint colour) + target chroma
const curTintHex = (id, mode) => cur(id)[mode].tint;

export const PALETTES = [
  {
    id: 'notion', nameEn: 'Notion', nameZh: 'Notion 原味', group: 'calm',
    descEn: 'Warm near-black ink, clear hues and barely-there washes.', descZh: '暖黑正文、清透墨色与极浅底色。',
    look: 'soft', canvas: 'mist', inkHues: ['red', 'blue', 'green', 'purple'],
    light: {
      ...calm('notion', 'light'),
      text: '#37352f', heading: '#37352f', muted: '#73726e',
      listMarker: '#37352f', quoteBar: '#37352f', quoteWidth: '3px', decor: '#37352f',
      inlineCode: '#b83a35', inlineCodeBg: 'rgba(135, 131, 120, 0.13)',
      thead: '#f7f6f3', stripe: 'rgba(135, 131, 120, 0.06)', hr: '#e9e9e7', border: '#e9e9e7',
      link: 'blue', headingTint: [0.40, 0.075, 237], paper: '#ffffff', code: calmCode('notion', 'light'),
    },
    dark: {
      ...calm('notion', 'dark'),
      text: '#d4d4d4', heading: '#e6e6e6', muted: '#9b9b9b',
      listMarker: '#d4d4d4', quoteBar: '#d4d4d4', quoteWidth: '3px', decor: '#d4d4d4',
      inlineCode: '#ff8a80', inlineCodeBg: 'rgba(135, 131, 120, 0.18)',
      thead: '#232323', stripe: 'rgba(255, 255, 255, 0.025)', hr: '#373737', border: '#373737',
      link: 'blue', headingTint: [0.86, 0.05, 237], paper: '#191919', code: calmCode('notion', 'dark'),
    },
  },
  {
    id: 'nord', nameEn: 'Nord', nameZh: '北境', group: 'calm',
    descEn: 'Arctic frost and aurora: cool, calm, low-chroma.', descZh: '极地霜蓝与极光，冷静克制。',
    look: 'outline', canvas: 'nord', inkHues: ['red', 'blue', 'green', 'purple'],
    washTint: 'nord', washC: { light: 0.024, dark: 0.036 },
    light: {
      ink: curInk('nord', 'light'),
      text: '#2e3440', heading: '#2e3440', muted: '#4c566a',
      listMarker: '#5e81ac', quoteBar: '#6c8baa', quoteWidth: '2px', decor: '#5e81ac',
      inlineCode: 'cyan', inlineCodeBg: '#e5e9f0',
      thead: '#e5e9f0', stripe: 'rgba(94, 129, 172, 0.05)', hr: '#e5e9f0', border: '#d8dee9',
      link: '#476993', headingTint: '#2c496c', ramp: curRamp('nord', 'light'), code: curCode('nord', 'light'),
    },
    dark: {
      ink: curInk('nord', 'dark'),
      text: '#d8dee9', heading: '#e5e9f0', muted: '#a4b0c8',
      listMarker: '#88c0d0', quoteBar: '#81a1c1', quoteWidth: '2px', decor: '#88c0d0',
      inlineCode: 'cyan', inlineCodeBg: '#2e3440',
      thead: '#2b303b', stripe: 'rgba(136, 192, 208, 0.04)', hr: '#3b4252', border: '#434c5e',
      link: '#88c0d0', headingTint: '#b6e3f0', ramp: curRamp('nord', 'dark'), code: curCode('nord', 'dark'),
    },
  },
  {
    id: 'morandi', nameEn: 'Morandi', nameZh: '莫兰迪', group: 'calm',
    descEn: 'Grey-veiled, dusty tones; hues stay close together.', descZh: '蒙上一层灰的柔和色调，色相彼此接近。',
    look: 'minimal', canvas: 'morandi', inkHues: ['red', 'blue', 'green', 'purple'],
    light: {
      ...calm('morandi', 'light'),
      text: '#393533', heading: '#2d2927', muted: '#736c68',
      listMarker: '#9a8a86', quoteBar: '#9c8c88', quoteWidth: '2px', decor: '#9a8a86',
      inlineCode: '#8f4f57', inlineCodeBg: 'rgba(150, 120, 115, 0.12)',
      thead: '#f3f0ee', stripe: 'rgba(140, 120, 115, 0.045)', hr: '#e7e1de', border: '#e4dedb',
      link: 'blue', headingTint: [0.40, 0.035, 350], paper: '#f8f6f4', code: calmCode('morandi', 'light'),
    },
    dark: {
      ...calm('morandi', 'dark'),
      text: '#d9d3cf', heading: '#e8e2de', muted: '#a0978f',
      listMarker: '#8a7f7b', quoteBar: '#776b69', quoteWidth: '2px', decor: '#8a7f7b',
      inlineCode: '#d9a0a6', inlineCodeBg: 'rgba(170, 140, 135, 0.14)',
      thead: '#252221', stripe: 'rgba(200, 180, 175, 0.035)', hr: '#373230', border: '#383331',
      link: 'blue', headingTint: [0.86, 0.03, 350], paper: '#1f1d1c', code: calmCode('morandi', 'dark'),
    },
  },
  {
    id: 'paper', nameEn: 'Paper & Ink', nameZh: '纸墨', group: 'calm',
    descEn: 'Sepia ink on cream paper with highlighter washes, made for long-form writing.', descZh: '暖褐墨色、米白纸张与荧光笔底色，适合长文写作。',
    look: 'editorial', canvas: 'journal', inkHues: ['red', 'blue', 'green', 'purple'],
    light: {
      ...calm('paper', 'light'),
      text: '#2f2a24', heading: '#2a211a', muted: '#6f665b',
      listMarker: '#9a8b79', quoteBar: '#a98750', quoteWidth: '2px', decor: '#a98750',
      inlineCode: '#a14a1f', inlineCodeBg: 'rgba(184, 140, 90, 0.14)',
      thead: '#f5f0e7', stripe: 'rgba(160, 130, 90, 0.05)', hr: '#e7dfd2', border: '#e4dccf',
      link: 'blue', headingTint: [0.36, 0.05, 45], paper: '#fbf9f4', code: calmCode('paper', 'light'),
    },
    dark: {
      ...calm('paper', 'dark'),
      text: '#ddd6cb', heading: '#ece6dc', muted: '#a39a8d',
      listMarker: '#8f8475', quoteBar: '#a8874f', quoteWidth: '2px', decor: '#a8874f',
      inlineCode: '#e59b6f', inlineCodeBg: 'rgba(184, 140, 90, 0.16)',
      thead: '#262320', stripe: 'rgba(200, 170, 130, 0.035)', hr: '#39342e', border: '#3a352f',
      link: 'blue', headingTint: [0.87, 0.04, 60], paper: '#1d1b18', code: calmCode('paper', 'dark'),
    },
  },
  {
    id: 'rose-pine', nameEn: 'Rosé Pine', nameZh: '玫瑰松', group: 'expressive',
    descEn: 'Dawn and Moon: dusty rose, gold and pine.', descZh: '晨曦与月夜：灰玫瑰、琥珀金与松石。',
    look: 'soft', canvas: 'rose-pine', inkHues: ['red', 'yellow', 'blue', 'purple'],
    washTint: 'rose-pine', washC: { light: 0.030, dark: 0.042 },
    light: {
      ink: curInk('rose-pine', 'light'),
      text: '#575279', heading: '#575279', muted: '#6e6a86',
      listMarker: '#c97572', quoteBar: '#907aa9', quoteWidth: '2px', decor: '#c97572',
      inlineCode: 'red', inlineCodeBg: '#f4ede8',
      thead: '#f4ede8', stripe: 'rgba(215, 130, 126, 0.05)', hr: '#ebe2da', border: '#dfdad9',
      link: '#286983', headingTint: '#56426b', ramp: curRamp('rose-pine', 'light'), code: curCode('rose-pine', 'light'),
    },
    dark: {
      ink: curInk('rose-pine', 'dark'),
      text: '#e0def4', heading: '#e0def4', muted: '#a8a4c2',
      listMarker: '#ea9a97', quoteBar: '#c4a7e7', quoteWidth: '2px', decor: '#ea9a97',
      inlineCode: 'red', inlineCodeBg: '#2a273f',
      thead: '#2a273f', stripe: 'rgba(234, 154, 151, 0.04)', hr: '#312e49', border: '#393552',
      link: '#9ccfd8', headingTint: '#cebfe1', ramp: curRamp('rose-pine', 'dark'), code: curCode('rose-pine', 'dark'),
    },
  },
  {
    id: 'catppuccin', nameEn: 'Catppuccin', nameZh: '猫咖', group: 'expressive',
    descEn: 'Latte and Mocha: soothing pastels with a playful pop.', descZh: '拿铁与摩卡：温柔粉彩，带一点俏皮。',
    look: 'gradient', canvas: 'catppuccin', inkHues: ['red', 'blue', 'green', 'purple'],
    washTint: 'catppuccin', washC: { light: 0.040, dark: 0.050 },
    light: {
      ink: curInk('catppuccin', 'light'),
      text: '#4c4f69', heading: '#4c4f69', muted: '#6c6f85',
      listMarker: '#8839ef', quoteBar: '#6c80f6', quoteWidth: '2px', decor: '#8839ef',
      inlineCode: 'pink', inlineCodeBg: '#eff1f5',
      thead: '#e6e9ef', stripe: 'rgba(114, 135, 253, 0.05)', hr: '#dce0e8', border: '#ccd0da',
      link: '#2961cf', headingTint: '#4e416b', ramp: curRamp('catppuccin', 'light'), code: curCode('catppuccin', 'light'),
    },
    dark: {
      ink: curInk('catppuccin', 'dark'),
      text: '#cdd6f4', heading: '#cdd6f4', muted: '#a6adc8',
      listMarker: '#cba6f7', quoteBar: '#b4befe', quoteWidth: '2px', decor: '#cba6f7',
      inlineCode: 'pink', inlineCodeBg: '#313244',
      thead: '#262637', stripe: 'rgba(180, 190, 254, 0.04)', hr: '#313244', border: '#45475a',
      link: '#89b4fa', headingTint: '#c9bbdd', ramp: curRamp('catppuccin', 'dark'), code: curCode('catppuccin', 'dark'),
    },
  },
  {
    id: 'everforest', nameEn: 'Everforest', nameZh: '常青森林', group: 'expressive',
    descEn: 'Warm parchment and forest greens, easy on the eyes.', descZh: '暖调羊皮纸配森林绿，久读不累。',
    look: 'soft', canvas: 'forest', inkHues: ['red', 'orange', 'green', 'cyan'],
    washTint: 'everforest', washC: { light: 0.036, dark: 0.040 },
    light: {
      ink: curInk('everforest', 'light'),
      text: '#526068', heading: '#3a4a3f', muted: '#5f6b64',
      listMarker: '#7a8b02', quoteBar: '#2b9f75', quoteWidth: '2px', decor: '#7a8b02',
      inlineCode: 'orange', inlineCodeBg: '#f4f0d9',
      thead: '#f4f0d9', stripe: 'rgba(141, 161, 1, 0.05)', hr: '#efebd4', border: '#e0dcc7',
      link: '#227959', headingTint: '#2e5432', ramp: { ...curRamp('everforest', 'light'), '100': '#526068' }, code: curCode('everforest', 'light'),
    },
    dark: {
      ink: curInk('everforest', 'dark'),
      text: '#dfd2b5', heading: '#e8dcc0', muted: '#a3aea6',
      listMarker: '#a7c080', quoteBar: '#83c092', quoteWidth: '2px', decor: '#a7c080',
      inlineCode: 'orange', inlineCodeBg: '#343f44',
      thead: '#272e33', stripe: 'rgba(167, 192, 128, 0.04)', hr: '#343f44', border: '#3d484d',
      link: '#8bc89a', headingTint: '#d3e1be', ramp: { ...curRamp('everforest', 'dark'), '100': '#dfd2b5' }, code: curCode('everforest', 'dark'),
    },
  },
  {
    id: 'guose', nameEn: 'Chinese Classic', nameZh: '国色', group: 'expressive',
    descEn: 'Blue-and-white porcelain with a cinnabar seal on ivory paper.', descZh: '青花瓷与朱砂印：靛青、石绿、朱砂，象牙宣纸底。',
    look: 'editorial', canvas: 'guose', inkHues: ['red', 'blue', 'green', 'yellow'],
    washTint: 'guose', washC: { light: 0.034, dark: 0.046 },
    light: {
      ink: curInk('guose', 'light'),
      text: '#2c2f36', heading: '#23303a', muted: '#50616d',
      listMarker: '#c3272b', quoteBar: '#177cb0', quoteWidth: '2px', decor: '#c3272b',
      inlineCode: 'blue', inlineCodeBg: '#f5efe3',
      thead: '#f5efe3', stripe: 'rgba(23, 124, 176, 0.04)', hr: '#efe8da', border: '#e8e0cf',
      link: '#1b709e', headingTint: '#23526f', ramp: curRamp('guose', 'light'), code: curCode('guose', 'light'),
    },
    dark: {
      ink: curInk('guose', 'dark'),
      text: '#e3e0d8', heading: '#ece9e1', muted: '#a9b0bd',
      listMarker: '#fc765b', quoteBar: '#4c8dae', quoteWidth: '2px', decor: '#fc765b',
      inlineCode: 'blue', inlineCodeBg: '#252833',
      thead: '#252833', stripe: 'rgba(76, 141, 174, 0.05)', hr: '#2b2f3b', border: '#333846',
      link: '#79bbdd', headingTint: '#9dc3d8', ramp: curRamp('guose', 'dark'), code: curCode('guose', 'dark'),
    },
  },
];

export { curTintHex };
