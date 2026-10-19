import { UserError } from '../utils/errors.js';

const API = 'https://api.openverse.org/v1';
const TIMEOUT = 9000;

/**
 * Anonymous Openverse image search (https://api.openverse.org/v1/). Anonymous
 * access is rate-limited; no API secret is ever shipped in this frontend.
 */
export async function searchOpenverse(query, page = 1) {
  const q = query.trim();
  if (!q) return { results: [], total: 0, pages: 0 };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  let res;
  try {
    res = await fetch(`${API}/images/?q=${encodeURIComponent(q)}&page_size=24&page=${page}&mature=false`, { signal: ctrl.signal });
  } catch {
    throw new UserError('Image search is unavailable right now.', 'Check your connection, then retry. Importing images from your computer still works.');
  } finally {
    clearTimeout(t);
  }
  if (res.status === 429) throw new UserError('Openverse is limiting anonymous requests right now.', 'Wait a minute and retry.');
  if (!res.ok) throw new UserError('Image search didn’t respond as expected.', 'Please retry in a moment.');
  const data = await res.json();
  const results = (data.results || []).map((r) => ({
    id: r.id,
    title: r.title || 'Untitled',
    creator: r.creator || 'Unknown creator',
    creatorUrl: r.creator_url || '',
    license: `${String(r.license || '').toUpperCase()}${r.license_version ? ' ' + r.license_version : ''}`.trim(),
    licenseUrl: r.license_url || '',
    landingUrl: r.foreign_landing_url || '',
    thumbnail: r.thumbnail || '',
    url: r.url || '',
    width: r.width || 0,
    height: r.height || 0,
    provider: r.provider || r.source || '',
    attribution: r.attribution || '',
  }));
  return { results, total: data.result_count || results.length, pages: data.page_count || 1 };
}

/** Downloads the Openverse-hosted thumbnail (CORS-enabled) as a Blob. */
export async function fetchOpenverseImage(item) {
  const src = item.thumbnail || `${API}/images/${item.id}/thumb/`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(src, { signal: ctrl.signal });
    if (!res.ok) throw new Error('http');
    const blob = await res.blob();
    if (!/^image\//.test(blob.type)) throw new Error('type');
    return blob;
  } catch {
    throw new UserError('That image couldn’t be downloaded.', 'Retry, or open its source page and import the file yourself.');
  } finally {
    clearTimeout(t);
  }
}
