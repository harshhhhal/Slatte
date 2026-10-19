import { sanitizeSvg } from '../utils/svg-sanitize.js';
import { createObject, makeStroke, noPaint, pathFromSubpaths, solid } from '../core/document-model.js';
import { parseColor } from '../utils/color.js';
import { UserError } from '../utils/errors.js';

/* ----------------------------- path data parser ----------------------------- */

class Scanner {
  constructor(s) { this.s = s; this.i = 0; }
  ws() { while (this.i < this.s.length && /[\s,]/.test(this.s[this.i])) this.i++; }
  eof() { this.ws(); return this.i >= this.s.length; }
  peekCmd() { this.ws(); const c = this.s[this.i]; return c && /[A-Za-z]/.test(c) ? c : null; }
  num() {
    this.ws();
    const re = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
    re.lastIndex = this.i;
    const m = re.exec(this.s);
    if (!m) throw new Error('number expected');
    this.i = re.lastIndex;
    return parseFloat(m[0]);
  }
  flag() {
    this.ws();
    const c = this.s[this.i];
    if (c !== '0' && c !== '1') throw new Error('flag expected');
    this.i++;
    return c === '1';
  }
  hasNum() {
    this.ws();
    return /[-+.\d]/.test(this.s[this.i] || '');
  }
}

function arcToCubics(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];
  const sinp = Math.sin((phi * Math.PI) / 180), cosp = Math.cos((phi * Math.PI) / 180);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cosp * dx + sinp * dy, y1p = -sinp * dx + cosp * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const sign = fa === fs ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cosp * cxp - sinp * cyp + (x1 + x2) / 2, cy = sinp * cxp + cosp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dth > 0) dth -= 2 * Math.PI;
  if (fs && dth < 0) dth += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9));
  const out = [];
  const delta = dth / segs;
  const t = (4 / 3) * Math.tan(delta / 4);
  let a = th1;
  for (let i = 0; i < segs; i++) {
    const cosA = Math.cos(a), sinA = Math.sin(a), cosB = Math.cos(a + delta), sinB = Math.sin(a + delta);
    const p = (px, py) => [cosp * rx * px - sinp * ry * py + cx, sinp * rx * px + cosp * ry * py + cy];
    const [c1x, c1y] = p(cosA - t * sinA, sinA + t * cosA);
    const [c2x, c2y] = p(cosB + t * sinB, sinB - t * cosB);
    const [ex, ey] = p(cosB, sinB);
    out.push([c1x, c1y, c2x, c2y, ex, ey]);
    a += delta;
  }
  return out;
}

/** Parses SVG path data into structured subpaths (absolute coordinates). */
export function parsePathData(d) {
  const sc = new Scanner(d);
  const subs = [];
  let cur = null;
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let lastC = null, lastQ = null;
  let cmd = null;
  const node = (x, y) => ({ x, y, ix: 0, iy: 0, ox: 0, oy: 0, mode: 'corner' });
  const start = (x, y) => { cur = { closed: false, nodes: [node(x, y)] }; subs.push(cur); };
  const cubic = (c1x, c1y, c2x, c2y, x, y) => {
    if (!cur) start(cx, cy);
    const a = cur.nodes[cur.nodes.length - 1];
    a.ox = c1x - a.x; a.oy = c1y - a.y;
    const n = node(x, y);
    n.ix = c2x - x; n.iy = c2y - y;
    cur.nodes.push(n);
    lastC = [c2x, c2y];
    cx = x; cy = y;
  };
  const line = (x, y) => {
    if (!cur) start(cx, cy);
    cur.nodes.push(node(x, y));
    cx = x; cy = y;
  };
  while (!sc.eof()) {
    const c = sc.peekCmd();
    if (c) { cmd = c; sc.i++; } else if (!cmd) throw new Error('bad path');
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'Z') {
      if (cur) {
        cur.closed = true;
        const f = cur.nodes[0], l = cur.nodes[cur.nodes.length - 1];
        if (cur.nodes.length > 1 && Math.abs(f.x - l.x) < 1e-6 && Math.abs(f.y - l.y) < 1e-6) {
          f.ix = l.ix; f.iy = l.iy;
          cur.nodes.pop();
        }
      }
      cx = sx; cy = sy; cur = null; lastC = lastQ = null;
      continue;
    }
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    if (C === 'M') {
      const x = sc.num() + ox, y = sc.num() + oy;
      start(x, y); cx = sx = x; cy = sy = y;
      cmd = rel ? 'l' : 'L';
      lastC = lastQ = null;
    } else if (C === 'L') {
      line(sc.num() + ox, sc.num() + oy); lastC = lastQ = null;
    } else if (C === 'H') {
      line(sc.num() + ox, cy); lastC = lastQ = null;
    } else if (C === 'V') {
      line(cx, sc.num() + oy); lastC = lastQ = null;
    } else if (C === 'C') {
      const a = [sc.num() + ox, sc.num() + oy, sc.num() + ox, sc.num() + oy, sc.num() + ox, sc.num() + oy];
      cubic(...a); lastQ = null;
    } else if (C === 'S') {
      const r1 = lastC ? [2 * cx - lastC[0], 2 * cy - lastC[1]] : [cx, cy];
      const a = [sc.num() + ox, sc.num() + oy, sc.num() + ox, sc.num() + oy];
      cubic(r1[0], r1[1], ...a); lastQ = null;
    } else if (C === 'Q') {
      const qx = sc.num() + ox, qy = sc.num() + oy, x = sc.num() + ox, y = sc.num() + oy;
      cubic(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y);
      lastQ = [qx, qy]; lastC = null;
    } else if (C === 'T') {
      const q = lastQ ? [2 * cx - lastQ[0], 2 * cy - lastQ[1]] : [cx, cy];
      const x = sc.num() + ox, y = sc.num() + oy;
      cubic(cx + (2 / 3) * (q[0] - cx), cy + (2 / 3) * (q[1] - cy), x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y), x, y);
      lastQ = q; lastC = null;
    } else if (C === 'A') {
      const rx = sc.num(), ry = sc.num(), rot = sc.num(), fa = sc.flag(), fs = sc.flag();
      const x = sc.num() + ox, y = sc.num() + oy;
      for (const seg of arcToCubics(cx, cy, rx, ry, rot, fa, fs, x, y)) cubic(...seg);
      lastC = lastQ = null;
    } else throw new Error(`unsupported command ${cmd}`);
  }
  return subs;
}

/* ----------------------------- element conversion ----------------------------- */

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

function parseTransform(str) {
  let m = [1, 0, 0, 1, 0, 0];
  if (!str) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let r;
  while ((r = re.exec(str))) {
    const a = r[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let t;
    switch (r[1]) {
      case 'matrix': t = a.length === 6 ? a : [1, 0, 0, 1, 0, 0]; break;
      case 'translate': t = [1, 0, 0, 1, a[0] || 0, a[1] || 0]; break;
      case 'scale': t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const rad = ((a[0] || 0) * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
        t = [c, s, -s, c, 0, 0];
        if (a.length === 3) t = mul(mul([1, 0, 0, 1, a[1], a[2]], t), [1, 0, 0, 1, -a[1], -a[2]]);
        break;
      }
      case 'skewX': t = [1, 0, Math.tan(((a[0] || 0) * Math.PI) / 180), 1, 0, 0]; break;
      default: t = [1, Math.tan(((a[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    }
    m = mul(m, t);
  }
  return m;
}

function applyMatrix(subs, m) {
  for (const sp of subs) {
    for (const n of sp.nodes) {
      const x = m[0] * n.x + m[2] * n.y + m[4], y = m[1] * n.x + m[3] * n.y + m[5];
      const ix = m[0] * n.ix + m[2] * n.iy, iy = m[1] * n.ix + m[3] * n.iy;
      const ox = m[0] * n.ox + m[2] * n.oy, oy = m[1] * n.ox + m[3] * n.oy;
      n.x = x; n.y = y; n.ix = ix; n.iy = iy; n.ox = ox; n.oy = oy;
    }
  }
  return subs;
}

const K = 0.5522847498;
function rectSubs(x, y, w, h, rx, ry) {
  const nd = (px, py, ix = 0, iy = 0, ox = 0, oy = 0) => ({ x: px, y: py, ix, iy, ox, oy, mode: 'corner' });
  rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
  if (!rx && !ry) return [{ closed: true, nodes: [nd(x, y), nd(x + w, y), nd(x + w, y + h), nd(x, y + h)] }];
  const nodes = [
    nd(x + rx, y, -rx * K, 0), nd(x + w - rx, y, 0, 0, rx * K, 0), nd(x + w, y + ry, 0, -ry * K), nd(x + w, y + h - ry, 0, 0, 0, ry * K),
    nd(x + w - rx, y + h, rx * K, 0), nd(x + rx, y + h, 0, 0, -rx * K, 0), nd(x, y + h - ry, 0, ry * K), nd(x, y + ry, 0, 0, 0, -ry * K),
  ];
  return [{ closed: true, nodes }];
}
function ellipseSubs(cx, cy, rx, ry) {
  const nd = (px, py, ix, iy, ox, oy) => ({ x: px, y: py, ix, iy, ox, oy, mode: 'smooth' });
  return [{
    closed: true,
    nodes: [
      nd(cx, cy - ry, -rx * K, 0, rx * K, 0), nd(cx + rx, cy, 0, -ry * K, 0, ry * K),
      nd(cx, cy + ry, rx * K, 0, -rx * K, 0), nd(cx - rx, cy, 0, ry * K, 0, -ry * K),
    ],
  }];
}
function polySubs(points, closed) {
  const nums = String(points).split(/[\s,]+/).filter(Boolean).map(Number);
  const nodes = [];
  for (let i = 0; i + 1 < nums.length; i += 2) nodes.push({ x: nums[i], y: nums[i + 1], ix: 0, iy: 0, ox: 0, oy: 0, mode: 'corner' });
  return nodes.length ? [{ closed, nodes }] : [];
}

function styleOf(el, inherited) {
  const s = { ...inherited };
  const style = {};
  for (const decl of (el.getAttribute('style') || '').split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) style[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
  }
  for (const k of ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'color']) {
    const v = style[k] ?? el.getAttribute(k);
    if (v != null && v !== '') s[k] = v;
  }
  return s;
}

function paintFrom(value, color, opacity) {
  if (value == null) return null;
  const v = String(value).trim();
  if (v === 'none') return noPaint();
  if (/^url\(/i.test(v)) throw new Error('gradient');
  const c = v === 'currentColor' ? parseColor(color || '#000000') : parseColor(v);
  if (!c) return noPaint();
  return solid(c.hex, c.alpha * opacity);
}

/**
 * Imports SVG text. When every element can be represented as an editable path the
 * result is a list of path objects; otherwise the sanitised SVG is kept as a
 * single vector icon object so nothing is silently dropped.
 * @returns {{objects:object[], mode:'paths'|'icon', warnings:string[], width:number, height:number}}
 */
export function importSvgText(text, name = 'SVG') {
  const sanitized = sanitizeSvg(text);
  const warnings = [];
  if (sanitized.dropped.length) warnings.push(`Removed unsupported or unsafe elements: ${sanitized.dropped.join(', ')}.`);
  const [vx, vy, vw, vh] = sanitized.viewBox;

  const asIcon = (reason) => {
    if (reason) warnings.push(reason);
    const icon = createObject('icon', { name: name.replace(/\.svg$/i, ''), svg: sanitized.inner, viewBox: sanitized.viewBox, width: vw, height: vh });
    icon.fill = solid('#18181b');
    return { objects: [icon], mode: 'icon', warnings, width: vw, height: vh };
  };

  const unsupported = sanitized.root.querySelector('lineargradient,radialgradient,clippath,mask,use,symbol,linearGradient,radialGradient,clipPath');
  if (unsupported) return asIcon('This SVG uses gradients, clipping or masks, so it was imported as one vector object (still scalable and recolourable where it uses currentColor).');

  const objects = [];
  let failed = false;
  const visit = (el, matrix, inherited) => {
    for (const child of el.children) {
      const tag = child.localName;
      const style = styleOf(child, inherited);
      const m = mul(matrix, parseTransform(child.getAttribute('transform')));
      if (tag === 'g') { visit(child, m, style); continue; }
      if (tag === 'defs' || tag === 'title' || tag === 'desc') continue;
      const n = (a, d = 0) => parseFloat(child.getAttribute(a)) || d;
      let subs = [];
      try {
        if (tag === 'path') subs = parsePathData(child.getAttribute('d') || '');
        else if (tag === 'rect') subs = rectSubs(n('x'), n('y'), n('width'), n('height'), n('rx', n('ry')), n('ry', n('rx')));
        else if (tag === 'circle') subs = ellipseSubs(n('cx'), n('cy'), n('r'), n('r'));
        else if (tag === 'ellipse') subs = ellipseSubs(n('cx'), n('cy'), n('rx'), n('ry'));
        else if (tag === 'line') subs = [{ closed: false, nodes: [{ x: n('x1'), y: n('y1'), ix: 0, iy: 0, ox: 0, oy: 0, mode: 'corner' }, { x: n('x2'), y: n('y2'), ix: 0, iy: 0, ox: 0, oy: 0, mode: 'corner' }] }];
        else if (tag === 'polyline') subs = polySubs(child.getAttribute('points'), false);
        else if (tag === 'polygon') subs = polySubs(child.getAttribute('points'), true);
        else continue;
      } catch { failed = true; continue; }
      if (!subs.length) continue;
      applyMatrix(subs, m);
      let fill, stroke;
      try {
        const op = parseFloat(style.opacity ?? 1);
        fill = paintFrom(style.fill ?? '#000000', style.color, parseFloat(style['fill-opacity'] ?? 1) * (Number.isFinite(op) ? op : 1));
        stroke = paintFrom(style.stroke ?? 'none', style.color, parseFloat(style['stroke-opacity'] ?? 1) * (Number.isFinite(op) ? op : 1));
      } catch { failed = true; continue; }
      const sw = parseFloat(style['stroke-width'] ?? 1) * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      const strokeObj = stroke.type === 'none' ? makeStroke({ type: 'none' }) : makeStroke({
        ...stroke, width: sw || 1, cap: ['butt', 'round', 'square'].includes(style['stroke-linecap']) ? style['stroke-linecap'] : 'butt',
        join: ['miter', 'round', 'bevel'].includes(style['stroke-linejoin']) ? style['stroke-linejoin'] : 'miter',
      });
      const p = pathFromSubpaths(subs, { fill, stroke: strokeObj, name: tag.charAt(0).toUpperCase() + tag.slice(1), fillRule: style['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero' });
      objects.push(p);
    }
  };
  visit(sanitized.root, [1, 0, 0, 1, -vx, -vy], {});
  if (failed) return asIcon('Some path data could not be converted to editable paths, so the SVG was imported as one vector object.');
  if (!objects.length) throw new UserError('That SVG has no drawable shapes.', 'It may only contain text or images, which Slatte can’t import yet.');
  return { objects, mode: 'paths', warnings, width: vw, height: vh };
}
