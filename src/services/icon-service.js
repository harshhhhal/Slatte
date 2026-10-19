import { ICONS } from '../core/icons.js';
import { sanitizeSvg } from '../utils/svg-sanitize.js';
import { UserError } from '../utils/errors.js';

const API = 'https://api.iconify.design';
const cache = new Map();
const TIMEOUT = 8000;

async function getJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Searches the Iconify API (https://iconify.design/docs/api/).
 * @returns {Promise<{icons:{prefix:string,name:string,license:string,author:string}[], total:number}>}
 */
export async function searchIcons(query, limit = 48) {
  const q = query.trim();
  if (!q) return { icons: [], total: 0 };
  const key = `s:${q}:${limit}`;
  if (cache.has(key)) return cache.get(key);
  let data;
  try {
    data = await getJson(`${API}/search?query=${encodeURIComponent(q)}&limit=${limit}`);
  } catch {
    throw new UserError('Icon search is unavailable right now.', 'Check your connection and try again. The built-in icons still work offline.');
  }
  const cols = data.collections || {};
  const icons = (data.icons || []).map((full) => {
    const [prefix, name] = full.split(':');
    const c = cols[prefix] || {};
    return { prefix, name, license: (c.license && (c.license.title || c.license.spdx)) || 'See collection', author: (c.author && c.author.name) || '', set: c.name || prefix };
  });
  const res = { icons, total: data.total || icons.length };
  cache.set(key, res);
  return res;
}

export function iconPreviewUrl(prefix, name) {
  return `${API}/${prefix}/${name}.svg?height=48`;
}

/** Fetches an icon and converts it into insertable, sanitised vector markup. */
export async function fetchIcon(prefix, name) {
  const key = `i:${prefix}:${name}`;
  if (cache.has(key)) return cache.get(key);
  let text;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT);
    const res = await fetch(`${API}/${prefix}/${name}.svg`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error('http');
    text = await res.text();
  } catch {
    throw new UserError('That icon couldn’t be downloaded.', 'Check your connection and try again.');
  }
  const s = sanitizeSvg(text);
  const out = { svg: s.inner, viewBox: s.viewBox };
  cache.set(key, out);
  return out;
}

/** Original, offline icon set built from the editor's own interface icons. */
export const LOCAL_ICONS = [
  'star', 'smile', 'arrow', 'heart', 'sun', 'moon', 'eye', 'lock', 'folder', 'image', 'text', 'pen', 'brush', 'layers', 'grid',
  'download', 'upload', 'search', 'check', 'x', 'plus', 'home', 'link', 'save', 'info', 'warning', 'texture', 'magnet',
].filter((n) => ICONS[n] || n === 'heart').map((name) => ({ name, label: name }));

const HEART = '<path d="M12 20s-7-4.4-9-9.2C1.8 7.5 3.6 4.5 6.6 4.5c1.9 0 3.4 1 5.4 3 2-2 3.5-3 5.4-3 3 0 4.8 3 3.6 6.3C19 15.6 12 20 12 20z"/>';

export function localIconMarkup(name) {
  const body = name === 'heart' ? HEART : ICONS[name];
  return `<g fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
}
