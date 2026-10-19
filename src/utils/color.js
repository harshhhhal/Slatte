/** Small colour helpers (sRGB, hex based). */

const NAMED = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
  yellow: '#ffff00', orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', gray: '#808080',
  grey: '#808080', cyan: '#00ffff', magenta: '#ff00ff', transparent: '#000000',
  lime: '#00ff00', navy: '#000080', teal: '#008080', maroon: '#800000', olive: '#808000',
  silver: '#c0c0c0', brown: '#a52a2a', gold: '#ffd700', aqua: '#00ffff', fuchsia: '#ff00ff',
};

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function normalizeHex(input, fallback = '#000000') {
  if (typeof input !== 'string') return fallback;
  let s = input.trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  if (/^#[0-9a-f]{3}$/.test(s)) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  if (/^#[0-9a-f]{8}$/.test(s)) s = s.slice(0, 7);
  if (/^[0-9a-f]{6}$/.test(s)) s = '#' + s;
  return /^#[0-9a-f]{6}$/.test(s) ? s : fallback;
}

export function hexToRgb(hex) {
  const h = normalizeHex(hex);
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
}

export function rgbToHex(r, g, b) {
  const p = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${p(r)}${p(g)}${p(b)}`;
}

/** Parses #hex, rgb()/rgba() and a few names. Returns { hex, alpha } or null. */
export function parseColor(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (s === 'none') return null;
  if (s === 'transparent') return { hex: '#000000', alpha: 0 };
  const m = s.match(/^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    const ch = (v) => (v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v));
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { hex: rgbToHex(ch(m[1]), ch(m[2]), ch(m[3])), alpha: clamp(a, 0, 1) };
  }
  if (/^#[0-9a-f]{8}$/.test(s)) {
    return { hex: s.slice(0, 7), alpha: parseInt(s.slice(7, 9), 16) / 255 };
  }
  if (/^#[0-9a-f]{4}$/.test(s)) {
    const full = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    return { hex: full, alpha: parseInt(s[4] + s[4], 16) / 255 };
  }
  const hex = normalizeHex(s, null);
  return hex ? { hex, alpha: 1 } : null;
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

export function contrastText(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111111' : '#ffffff';
}

export function formatRgb(hex) {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${r}, ${g}, ${b})`;
}
