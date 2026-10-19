/** Text measuring and line breaking shared by the live renderer and exporters. */

let _ctx = null;
function ctx() {
  if (!_ctx) {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas');
    _ctx = c.getContext('2d');
  }
  return _ctx;
}

const SERIFISH = /(serif|garamond|baskerville|playfair|lora|merriweather|fraunces|georgia|times|cormorant|abril|libre baskerville)/i;
const MONOISH = /(mono|code|courier|consolas)/i;

export function familyCss(family) {
  const f = String(family || 'Inter').replace(/["'\\<>;{}]/g, '');
  const generic = MONOISH.test(f) ? 'monospace' : SERIFISH.test(f) && !/sans/i.test(f) ? 'serif' : 'sans-serif';
  return `"${f}", ${generic}`;
}

export function fontShorthand(o) {
  return `${o.fontStyle === 'italic' ? 'italic ' : ''}${o.fontWeight || 400} ${o.fontSize}px ${familyCss(o.fontFamily)}`;
}

const cache = new Map();
let cacheEpoch = 0;

/** Call after a font finishes loading so measurements are redone. */
export function invalidateTextCache() {
  cache.clear();
  cacheEpoch++;
}

export function textEpoch() {
  return cacheEpoch;
}

function lineWidth(c, text, ls) {
  return c.measureText(text).width + ls * [...text].length;
}

/**
 * @returns {{lines:{text:string,width:number}[], width:number, height:number, lineHeight:number, baseline:number}}
 */
export function layoutText(o) {
  const key = [o.text, o.fontFamily, o.fontWeight, o.fontStyle, o.fontSize, o.lineHeight, o.letterSpacing, o.autoWidth ? 'a' : o.width].join('|');
  const hit = cache.get(key);
  if (hit) return hit;
  const c = ctx();
  c.font = fontShorthand(o);
  const ls = o.letterSpacing || 0;
  const maxW = o.autoWidth ? Infinity : Math.max(1, o.width);
  const lines = [];
  for (const para of String(o.text || '').split('\n')) {
    if (maxW === Infinity || para === '') {
      lines.push({ text: para, width: lineWidth(c, para, ls) });
      continue;
    }
    const words = para.split(/(\s+)/).filter((w) => w !== '');
    let cur = '';
    const push = (t) => lines.push({ text: t, width: lineWidth(c, t, ls) });
    for (const word of words) {
      const trial = cur + word;
      if (cur === '' || lineWidth(c, trial.trimEnd(), ls) <= maxW) {
        cur = trial;
        // break very long words
        while (lineWidth(c, cur, ls) > maxW && [...cur].length > 1) {
          let n = [...cur];
          let k = n.length - 1;
          while (k > 1 && lineWidth(c, n.slice(0, k).join(''), ls) > maxW) k--;
          push(n.slice(0, k).join(''));
          cur = n.slice(k).join('');
        }
      } else {
        push(cur.trimEnd());
        cur = /^\s+$/.test(word) ? '' : word;
      }
    }
    push(cur.trimEnd());
  }
  const lh = o.fontSize * (o.lineHeight || 1.2);
  const m = c.measureText('Hg');
  const asc = m.fontBoundingBoxAscent || o.fontSize * 0.8;
  const desc = m.fontBoundingBoxDescent || o.fontSize * 0.2;
  const baseline = (lh - (asc + desc)) / 2 + asc;
  const width = lines.reduce((a, l) => Math.max(a, l.width), 0);
  const res = { lines, width, height: lines.length * lh, lineHeight: lh, baseline };
  if (cache.size > 800) cache.clear();
  cache.set(key, res);
  return res;
}

/** Recomputes a text object's box from its content. */
export function fitText(o) {
  const l = layoutText(o);
  if (o.autoWidth) o.width = Math.max(4, Math.ceil(l.width + Math.abs(o.letterSpacing || 0) * 0));
  o.height = Math.max(o.fontSize * (o.lineHeight || 1.2), l.height);
  return l;
}
