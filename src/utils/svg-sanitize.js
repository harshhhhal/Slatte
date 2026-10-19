import { UserError } from './errors.js';

/**
 * Whitelist-based SVG sanitiser. Imported SVG is never inserted as trusted markup:
 * it is parsed, rebuilt from allowed elements/attributes only, and re-serialised.
 */

const ELEMENTS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'defs',
  'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'use', 'title', 'desc', 'symbol',
]);

const CANON = {
  lineargradient: 'linearGradient', radialgradient: 'radialGradient', clippath: 'clipPath',
};

const ATTRS = new Set([
  'id', 'class', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'points',
  'fill', 'fill-opacity', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'transform',
  'viewbox', 'preserveaspectratio', 'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform',
  'fx', 'fy', 'spreadmethod', 'clip-path', 'mask', 'display', 'visibility', 'color', 'href', 'xlink:href',
  'maskunits', 'maskcontentunits', 'clippathunits',
]);

const SAFE_STYLE_PROPS = new Set([
  'fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-dashoffset', 'fill-rule', 'stop-color', 'stop-opacity', 'display', 'color',
]);

function cleanStyle(value) {
  const out = [];
  for (const decl of String(value).split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if (!SAFE_STYLE_PROPS.has(prop)) continue;
    if (/url\s*\(\s*(?!["']?#)/i.test(val) || /expression|javascript|@import/i.test(val)) continue;
    out.push(`${prop}:${val}`);
  }
  return out.join(';');
}

function safeValue(name, value) {
  const v = String(value);
  if (/javascript:|data:|<|vbscript:/i.test(v) && name !== 'd') return false;
  if ((name === 'href' || name === 'xlink:href') && !/^#[\w-]+$/.test(v.trim())) return false;
  if (/url\s*\(/i.test(v) && !/^url\(\s*['"]?#[\w-]+['"]?\s*\)$/i.test(v.trim())) return false;
  return true;
}

function walk(src, dst, doc, stats, depth = 0) {
  if (depth > 60) return;
  for (const child of src.childNodes) {
    if (child.nodeType !== 1) continue;
    const name = child.localName.toLowerCase();
    if (!ELEMENTS.has(name)) {
      stats.dropped.add(child.localName);
      continue;
    }
    const el = doc.createElementNS('http://www.w3.org/2000/svg', CANON[name] || name);
    for (const attr of child.attributes) {
      const an = attr.name.toLowerCase();
      if (an === 'style') {
        const s = cleanStyle(attr.value);
        if (s) el.setAttribute('style', s);
        continue;
      }
      if (an.startsWith('on')) continue;
      if (!ATTRS.has(an)) continue;
      if (!safeValue(an, attr.value)) continue;
      const outName = an === 'viewbox' ? 'viewBox' : an === 'preserveaspectratio' ? 'preserveAspectRatio'
        : an === 'gradientunits' ? 'gradientUnits' : an === 'gradienttransform' ? 'gradientTransform'
          : an === 'spreadmethod' ? 'spreadMethod' : an === 'maskunits' ? 'maskUnits'
            : an === 'maskcontentunits' ? 'maskContentUnits' : an === 'clippathunits' ? 'clipPathUnits' : an;
      if (outName === 'xlink:href') el.setAttribute('href', attr.value.trim());
      else el.setAttribute(outName, attr.value);
    }
    dst.append(el);
    walk(child, el, doc, stats, depth + 1);
  }
}

/**
 * Sanitises SVG source text.
 * @returns {{svg:string, inner:string, viewBox:number[], width:number, height:number, dropped:string[]}}
 */
export function sanitizeSvg(text) {
  if (typeof text !== 'string' || text.length > 8 * 1024 * 1024) throw new UserError('That SVG is too large or unreadable.');
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = parsed.documentElement;
  if (!root || root.localName !== 'svg' || parsed.querySelector('parsererror')) {
    throw new UserError('That file isn’t a valid SVG.', 'Check that it opens in another viewer.');
  }
  const doc = document.implementation.createDocument('http://www.w3.org/2000/svg', 'svg', null);
  const out = doc.documentElement;
  const stats = { dropped: new Set() };
  walk(root, out, doc, stats);
  // root attributes
  let vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const w = parseFloat(root.getAttribute('width')) || 0;
  const h = parseFloat(root.getAttribute('height')) || 0;
  if (vb.length !== 4 || vb.some((n) => !Number.isFinite(n)) || vb[2] <= 0 || vb[3] <= 0) vb = [0, 0, w || 100, h || 100];
  const ser = new XMLSerializer();
  const inner = [...out.childNodes].map((n) => ser.serializeToString(n)).join('').replace(/ xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
  return {
    inner, viewBox: vb, width: w || vb[2], height: h || vb[3], dropped: [...stats.dropped],
    root: out,
  };
}

const sanitizedMarkup = new Map();

/**
 * Re-sanitises stored icon markup at render time so a tampered project file can
 * never inject script or external references.
 */
export function safeIconMarkup(inner) {
  if (!inner) return '';
  let hit = sanitizedMarkup.get(inner);
  if (hit !== undefined) return hit;
  try {
    const r = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`);
    hit = r.inner;
  } catch {
    hit = '';
  }
  if (sanitizedMarkup.size > 400) sanitizedMarkup.clear();
  sanitizedMarkup.set(inner, hit);
  return hit;
}
