// OKLCH <-> sRGB, WCAG contrast, alpha-tint solver
export const hex2rgb = h => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map(x => x + x).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
export const rgb2hex = a => '#' + a.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const s2l = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const l2s = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
export const lum = rgb => { const [r, g, b] = rgb.map(s2l); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const A = lum(typeof a === 'string' ? hex2rgb(a) : a), B = lum(typeof b === 'string' ? hex2rgb(b) : b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
export function oklch2rgb(L, C, H) {
  const h = H * Math.PI / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b, m_ = L - 0.1055613458 * a - 0.0638541728 * b, s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  return [r, g, bb].map(l2s);
}
export function rgb2oklch(rgb) {
  const [r, g, b] = rgb.map(s2l);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180 / Math.PI + 360) % 360];
}
export const inGamut = rgb => rgb.every(v => v >= -0.5 && v <= 255.5);
/** OKLCH, reducing chroma until in gamut */
export function ok(L, C, H) { let c = C; let rgb = oklch2rgb(L, c, H); while (!inGamut(rgb) && c > 0) { c -= 0.002; rgb = oklch2rgb(L, c, H); } return rgb.map(v => Math.round(Math.max(0, Math.min(255, v)))); }
export const over = (src, alpha, bg) => src.map((v, i) => bg[i] * (1 - alpha) + v * alpha);
/** source triplet so that src@alpha over bg == target (clamped) */
export const solveTint = (target, alpha, bg) => target.map((t, i) => Math.round(Math.max(0, Math.min(255, (t - bg[i] * (1 - alpha)) / alpha))));
export const mix = (a, pct, b) => a.map((v, i) => v * pct + b[i] * (1 - pct));
/** CSS color-mix(in oklab, a pct, b) for opaque sRGB hex inputs */
export function mixOklab(aHex, pct, bHex) {
  const toLab = hex => { const [L, C, H] = rgb2oklch(hex2rgb(hex)); const h = H * Math.PI / 180; return [L, C * Math.cos(h), C * Math.sin(h)]; };
  const A = toLab(aHex), B = toLab(bHex);
  const [L, a, b] = A.map((v, i) => v * pct + B[i] * (1 - pct));
  const C = Math.hypot(a, b), H = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  return rgb2hex(oklch2rgb(L, C, H));
}
