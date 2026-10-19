import { shortId, uid } from '../utils/ids.js';
import { UserError } from '../utils/errors.js';
import { aabb, cubicBounds, localToWorld, rotatePoint, unionRects, worldBounds, DEG } from '../utils/geometry.js';

export const SCHEMA_VERSION = 1;
export const APP_VERSION = '1.0.0';

export const OBJECT_TYPES = [
  'rectangle', 'roundedRectangle', 'ellipse', 'line', 'polygon', 'star', 'arrow', 'path',
  'text', 'image', 'icon', 'group', 'rasterLayer', 'texture', 'frame',
];

export const BLEND_MODES = [
  ['normal', 'Normal', 'source-over'],
  ['multiply', 'Multiply', 'multiply'],
  ['screen', 'Screen', 'screen'],
  ['overlay', 'Overlay', 'overlay'],
  ['darken', 'Darken', 'darken'],
  ['lighten', 'Lighten', 'lighten'],
  ['color-dodge', 'Color Dodge', 'color-dodge'],
  ['color-burn', 'Color Burn', 'color-burn'],
  ['hard-light', 'Hard Light', 'hard-light'],
  ['soft-light', 'Soft Light', 'soft-light'],
  ['difference', 'Difference', 'difference'],
  ['exclusion', 'Exclusion', 'exclusion'],
  ['hue', 'Hue', 'hue'],
  ['saturation', 'Saturation', 'saturation'],
  ['color', 'Color', 'color'],
  ['luminosity', 'Luminosity', 'luminosity'],
].map(([id, label, canvas]) => ({ id, label, canvas }));

export const BLEND_IDS = new Set(BLEND_MODES.map((b) => b.id));
export const TEXTURE_KINDS = ['paper', 'noise', 'dots', 'grid', 'halftone', 'stripes', 'crosshatch', 'checker', 'waves'];

export const ACCENT = '#3b5bdb';
export const INK = '#18181b';

/* ------------------------------------------------------------------ */
/* Paints, strokes, effects                                            */
/* ------------------------------------------------------------------ */

export function makePaint(over = {}) {
  const color = over.color || '#000000';
  return {
    type: 'solid',
    color,
    opacity: 1,
    stops: [
      { offset: 0, color, opacity: 1 },
      { offset: 1, color: '#ffffff', opacity: 1 },
    ],
    x1: 0, y1: 0.5, x2: 1, y2: 0.5,
    cx: 0.5, cy: 0.5, r: 0.5,
    ...over,
  };
}

export const noPaint = (color = '#000000') => makePaint({ type: 'none', color });
export const solid = (color, opacity = 1) => makePaint({ type: 'solid', color, opacity });

export function makeStroke(over = {}) {
  return { ...makePaint({ type: 'none', color: '#111111' }), width: 2, cap: 'butt', join: 'miter', dash: 'solid', ...over };
}

export function makeEffects() {
  return {
    shadow: { on: false, color: '#000000', opacity: 0.35, blur: 12, dx: 0, dy: 6 },
    blur: { on: false, amount: 4 },
    outline: { on: false, color: '#000000', width: 2 },
  };
}

export const GRADIENT_PRESETS = [
  { name: 'Dusk', stops: [['#3b5bdb', 0], ['#e64980', 1]] },
  { name: 'Mint', stops: [['#12b886', 0], ['#a5d8ff', 1]] },
  { name: 'Sunrise', stops: [['#ff922b', 0], ['#ffd43b', 1]] },
  { name: 'Ink', stops: [['#18181b', 0], ['#495057', 1]] },
  { name: 'Fade', stops: [['#3b5bdb', 0], ['#3b5bdb', 1]], fade: true },
  { name: 'Rose', stops: [['#f783ac', 0], ['#ffe3e3', 1]] },
];

export function gradientFromPreset(preset, type = 'linear') {
  const stops = preset.stops.map(([color, offset], i) => ({
    offset, color, opacity: preset.fade && i === 1 ? 0 : 1,
  }));
  return makePaint({ type, color: stops[0].color, stops });
}

export const DASHES = {
  solid: '',
  dashed: '12 8',
  dotted: '2 7',
  long: '24 10',
};

/* ------------------------------------------------------------------ */
/* Objects                                                             */
/* ------------------------------------------------------------------ */

const TYPE_LABEL = {
  rectangle: 'Rectangle', roundedRectangle: 'Rounded rectangle', ellipse: 'Ellipse', line: 'Line',
  polygon: 'Polygon', star: 'Star', arrow: 'Arrow', path: 'Path', text: 'Text', image: 'Image', icon: 'Icon',
  group: 'Group', rasterLayer: 'Paint layer', texture: 'Texture', frame: 'Frame', unsupported: 'Unsupported',
};

export function typeLabel(type) {
  return TYPE_LABEL[type] || 'Object';
}

function typeDefaults(type) {
  switch (type) {
    case 'rectangle':
      return { fill: solid(ACCENT), stroke: makeStroke(), radius: 0, radii: null };
    case 'roundedRectangle':
      return { fill: solid(ACCENT), stroke: makeStroke(), radius: 24, radii: null };
    case 'ellipse':
      return { fill: solid(ACCENT), stroke: makeStroke() };
    case 'line':
      return { fill: noPaint(), stroke: makeStroke({ type: 'solid', color: INK, width: 4, cap: 'round' }), dir: 'down' };
    case 'polygon':
      return { fill: solid(ACCENT), stroke: makeStroke(), sides: 6 };
    case 'star':
      return { fill: solid(ACCENT), stroke: makeStroke(), points: 5, innerRatio: 0.5 };
    case 'arrow':
      return { fill: solid(ACCENT), stroke: makeStroke(), headRatio: 0.4 };
    case 'path':
      return {
        fill: noPaint(ACCENT), stroke: makeStroke({ type: 'solid', color: INK, width: 3, cap: 'round', join: 'round' }),
        subpaths: [], fillRule: 'nonzero',
      };
    case 'text':
      return {
        fill: solid(INK), stroke: makeStroke(), text: 'Text', fontFamily: 'Inter', fontWeight: 400, fontStyle: 'normal',
        fontSize: 48, lineHeight: 1.2, letterSpacing: 0, align: 'left', underline: false, strike: false, autoWidth: true,
        width: 120, height: 58,
      };
    case 'image':
      return { fill: noPaint(), stroke: makeStroke(), assetId: null, fit: 'cover', naturalWidth: 0, naturalHeight: 0 };
    case 'icon':
      return { fill: solid(INK), stroke: makeStroke(), svg: '', viewBox: [0, 0, 24, 24], source: null };
    case 'group':
      return { fill: noPaint(), stroke: makeStroke() };
    case 'frame':
      return { fill: solid('#ffffff'), stroke: makeStroke(), clip: true, radius: 0 };
    case 'rasterLayer':
      return { fill: noPaint(), stroke: makeStroke(), assetId: null, scale: 1 };
    case 'texture':
      return {
        fill: noPaint(), stroke: makeStroke(), kind: 'paper', scale: 40, intensity: 0.5, density: 0.5, color: '#000000',
        seed: 1, wave: 0,
      };
    default:
      return { fill: noPaint(), stroke: makeStroke() };
  }
}

export function createObject(type, props = {}) {
  const base = {
    id: shortId('o'),
    type,
    name: typeLabel(type),
    x: 0, y: 0, width: 100, height: 100,
    rotation: 0, opacity: 1, visible: true, locked: false,
    blendMode: 'normal', parentId: null, transform: null, metadata: {},
    effects: makeEffects(),
    ...typeDefaults(type),
  };
  const obj = { ...base, ...props };
  if (props.fill) obj.fill = { ...base.fill, ...props.fill };
  if (props.stroke) obj.stroke = { ...base.stroke, ...props.stroke };
  if (props.effects) obj.effects = mergeEffects(base.effects, props.effects);
  return obj;
}

function mergeEffects(base, over) {
  return {
    shadow: { ...base.shadow, ...(over.shadow || {}) },
    blur: { ...base.blur, ...(over.blur || {}) },
    outline: { ...base.outline, ...(over.outline || {}) },
  };
}

export const isContainer = (o) => !!o && (o.type === 'group' || o.type === 'frame');
export const hasFill = (o) => !!o && !['image', 'group', 'rasterLayer', 'line'].includes(o.type);
export const hasStroke = (o) => !!o && !['group', 'rasterLayer', 'icon', 'texture'].includes(o.type);
export const isShape = (o) => !!o && ['rectangle', 'roundedRectangle', 'ellipse', 'line', 'polygon', 'star', 'arrow'].includes(o.type);

/* ------------------------------------------------------------------ */
/* Document & pages                                                    */
/* ------------------------------------------------------------------ */

export const PAGE_PRESETS = [
  { id: 'social-square', name: 'Social post', group: 'Social', width: 1080, height: 1080 },
  { id: 'social-portrait', name: 'Portrait post', group: 'Social', width: 1080, height: 1350 },
  { id: 'story', name: 'Story / Reel', group: 'Social', width: 1080, height: 1920 },
  { id: 'banner', name: 'Banner', group: 'Social', width: 1500, height: 500 },
  { id: 'thumb', name: 'Video thumbnail', group: 'Social', width: 1280, height: 720 },
  { id: 'slide', name: 'Presentation 16:9', group: 'Presentation', width: 1920, height: 1080 },
  { id: 'a4', name: 'A4 document', group: 'Print', width: 794, height: 1123 },
  { id: 'poster', name: 'Poster 18 × 24 in', group: 'Print', width: 1728, height: 2304 },
  { id: 'card', name: 'Business card', group: 'Print', width: 1050, height: 600 },
  { id: 'desktop', name: 'Desktop screen', group: 'Screen', width: 1440, height: 900 },
  { id: 'mobile', name: 'Mobile screen', group: 'Screen', width: 390, height: 844 },
];

export function createPage(opts = {}) {
  return {
    id: shortId('p'),
    name: opts.name || 'Page 1',
    width: opts.width || 1080,
    height: opts.height || 1080,
    background: { color: '#ffffff', transparent: false, ...(opts.background || {}) },
    objects: [],
    guides: [],
    gridSettings: { size: 20, show: false, snap: false },
  };
}

export function createDocument(name = 'Untitled', pageOpts = {}) {
  const now = new Date().toISOString();
  const page = createPage({ name: 'Page 1', ...pageOpts });
  return {
    id: uid(),
    name,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    activePageId: page.id,
    pages: [page],
    assets: {},
    fonts: [],
    colorStyles: [],
    settings: { recentColors: [], snap: true, rulers: false },
  };
}

export function getPage(doc, id) {
  return doc.pages.find((p) => p.id === id) || null;
}

export function activePage(doc) {
  return getPage(doc, doc.activePageId) || doc.pages[0];
}

export function indexPage(page) {
  const m = new Map();
  for (const o of page.objects) m.set(o.id, o);
  return m;
}

export function childrenOf(page, parentId) {
  return page.objects.filter((o) => (o.parentId || null) === (parentId || null));
}

export function descendantIds(page, id) {
  const out = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const o of page.objects) {
      if (o.parentId === cur) {
        out.push(o.id);
        stack.push(o.id);
      }
    }
  }
  return out;
}

export function ancestorIds(page, id, idx = indexPage(page)) {
  const out = [];
  let cur = idx.get(id);
  let guard = 0;
  while (cur && cur.parentId && guard++ < 100) {
    out.push(cur.parentId);
    cur = idx.get(cur.parentId);
  }
  return out;
}

/** Leaves (non-container objects) beneath the given ids, in page order. */
export function leafObjects(page, ids) {
  const wanted = new Set();
  for (const id of ids) {
    wanted.add(id);
    descendantIds(page, id).forEach((d) => wanted.add(d));
  }
  return page.objects.filter((o) => wanted.has(o.id) && !isContainer(o));
}

export function removeObjects(page, ids) {
  const kill = new Set();
  for (const id of ids) {
    kill.add(id);
    descendantIds(page, id).forEach((d) => kill.add(d));
  }
  const parents = new Set();
  const idx = indexPage(page);
  for (const id of ids) {
    const o = idx.get(id);
    if (o && o.parentId && !kill.has(o.parentId)) parents.add(o.parentId);
  }
  page.objects = page.objects.filter((o) => !kill.has(o.id));
  parents.forEach((p) => refreshBoundsUp(page, p));
  return kill;
}

/** Deep-clones the objects (and descendants) with fresh ids. */
export function cloneObjects(page, ids) {
  const keep = new Set();
  for (const id of ids) {
    keep.add(id);
    descendantIds(page, id).forEach((d) => keep.add(d));
  }
  const src = page.objects.filter((o) => keep.has(o.id));
  const map = new Map(src.map((o) => [o.id, shortId('o')]));
  const clones = src.map((o) => {
    const c = JSON.parse(JSON.stringify(o));
    c.id = map.get(o.id);
    c.parentId = map.has(o.parentId) ? map.get(o.parentId) : o.parentId;
    return c;
  });
  const roots = ids.map((i) => map.get(i)).filter(Boolean);
  return { objects: clones, rootIds: roots };
}

export function reorderSiblings(page, parentId, newOrderIds) {
  const slots = [];
  const set = new Set(newOrderIds);
  page.objects.forEach((o, i) => {
    if (set.has(o.id)) slots.push(i);
  });
  const idx = indexPage(page);
  slots.forEach((slot, i) => {
    page.objects[slot] = idx.get(newOrderIds[i]);
  });
}

/** Moves one object to a parent and a sibling index (0 = bottom). */
export function moveObject(page, id, newParentId, index) {
  const idx = indexPage(page);
  const obj = idx.get(id);
  if (!obj) return false;
  if (newParentId && (newParentId === id || descendantIds(page, id).includes(newParentId))) return false;
  const oldParent = obj.parentId || null;
  obj.parentId = newParentId || null;
  const siblings = childrenOf(page, newParentId).map((o) => o.id).filter((i) => i !== id);
  const at = Math.max(0, Math.min(siblings.length, index));
  siblings.splice(at, 0, id);
  reorderSiblings(page, newParentId, siblings);
  if (oldParent) refreshBoundsUp(page, oldParent);
  if (newParentId) refreshBoundsUp(page, newParentId);
  return true;
}

export function stepOrder(page, ids, mode) {
  // Group selected ids by parent and reorder each sibling list.
  const idx = indexPage(page);
  const byParent = new Map();
  for (const id of ids) {
    const o = idx.get(id);
    if (!o) continue;
    const p = o.parentId || null;
    if (!byParent.has(p)) byParent.set(p, new Set());
    byParent.get(p).add(id);
  }
  for (const [parent, sel] of byParent) {
    let list = childrenOf(page, parent).map((o) => o.id);
    const picked = list.filter((i) => sel.has(i));
    if (mode === 'front') list = [...list.filter((i) => !sel.has(i)), ...picked];
    else if (mode === 'back') list = [...picked, ...list.filter((i) => !sel.has(i))];
    else if (mode === 'forward') {
      for (let i = list.length - 2; i >= 0; i--) {
        if (sel.has(list[i]) && !sel.has(list[i + 1])) [list[i], list[i + 1]] = [list[i + 1], list[i]];
      }
    } else if (mode === 'backward') {
      for (let i = 1; i < list.length; i++) {
        if (sel.has(list[i]) && !sel.has(list[i - 1])) [list[i], list[i - 1]] = [list[i - 1], list[i]];
      }
    }
    reorderSiblings(page, parent, list);
  }
}

/** World bounds of any object. For containers this is the stored union. */
export function boundsOf(o) {
  return worldBounds(o);
}

export function refreshGroupBounds(page, group, idx = indexPage(page)) {
  const kids = page.objects.filter((o) => o.parentId === group.id);
  if (!kids.length) return;
  const rects = kids.map((k) => worldBounds(k));
  const u = unionRects(rects);
  group.x = u.x; group.y = u.y; group.width = u.width; group.height = u.height;
  group.rotation = 0;
}

export function refreshBoundsUp(page, startId) {
  const idx = indexPage(page);
  let cur = idx.get(startId);
  let guard = 0;
  while (cur && guard++ < 100) {
    if (cur.type === 'group') refreshGroupBounds(page, cur, idx);
    cur = cur.parentId ? idx.get(cur.parentId) : null;
  }
}

/** Visible, unlocked chain check (ancestors included). */
export function isEffectivelyLocked(o, idx) {
  let cur = o;
  let guard = 0;
  while (cur && guard++ < 100) {
    if (cur.locked) return true;
    cur = cur.parentId ? idx.get(cur.parentId) : null;
  }
  return false;
}

export function isEffectivelyHidden(o, idx) {
  let cur = o;
  let guard = 0;
  while (cur && guard++ < 100) {
    if (!cur.visible) return true;
    cur = cur.parentId ? idx.get(cur.parentId) : null;
  }
  return false;
}

export function getIn(obj, path) {
  let cur = obj;
  for (const k of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

export function setIn(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

export function uniqueName(page, base) {
  const names = new Set(page.objects.map((o) => o.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/* ------------------------------------------------------------------ */
/* Vector geometry: shapes → subpaths, subpaths → path data            */
/* ------------------------------------------------------------------ */

const KAPPA = 0.5522847498;

const node = (x, y, ix = 0, iy = 0, ox = 0, oy = 0, mode = 'corner') => ({ x, y, ix, iy, ox, oy, mode });

export function polygonPoints(o) {
  const w = o.width, h = o.height;
  const cx = w / 2, cy = h / 2;
  if (o.type === 'polygon') {
    const n = Math.max(3, Math.round(o.sides || 3));
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      pts.push({ x: cx + Math.cos(a) * cx, y: cy + Math.sin(a) * cy });
    }
    return pts;
  }
  if (o.type === 'star') {
    const n = Math.max(3, Math.round(o.points || 5));
    const ratio = Math.min(0.95, Math.max(0.05, o.innerRatio ?? 0.5));
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / n;
      const k = i % 2 === 0 ? 1 : ratio;
      pts.push({ x: cx + Math.cos(a) * cx * k, y: cy + Math.sin(a) * cy * k });
    }
    return pts;
  }
  if (o.type === 'arrow') {
    const hr = Math.min(0.9, Math.max(0.1, o.headRatio ?? 0.4));
    const hx = w * (1 - hr);
    return [
      { x: 0, y: h * 0.3 }, { x: hx, y: h * 0.3 }, { x: hx, y: 0 }, { x: w, y: cy },
      { x: hx, y: h }, { x: hx, y: h * 0.7 }, { x: 0, y: h * 0.7 },
    ];
  }
  return [];
}

export function cornerRadii(o) {
  const max = Math.min(o.width, o.height) / 2;
  const clampR = (r) => Math.max(0, Math.min(max, r || 0));
  if (Array.isArray(o.radii) && o.radii.length === 4) return o.radii.map(clampR);
  const r = clampR(o.radius);
  return [r, r, r, r];
}

/** Local-coordinate subpaths for any basic shape. */
export function shapeToSubpaths(o) {
  const w = o.width, h = o.height;
  switch (o.type) {
    case 'rectangle':
    case 'roundedRectangle':
    case 'frame':
    case 'image':
    case 'texture':
    case 'rasterLayer': {
      const [tl, tr, br, bl] = cornerRadii(o);
      if (tl + tr + br + bl === 0) {
        return [{ closed: true, nodes: [node(0, 0), node(w, 0), node(w, h), node(0, h)] }];
      }
      const nodes = [];
      const add = (x, y, ix, iy, ox, oy) => nodes.push(node(x, y, ix, iy, ox, oy, 'corner'));
      // clockwise starting after top-left corner
      add(tl, 0, 0, 0, 0, 0);
      add(w - tr, 0, 0, 0, tr * KAPPA, 0);
      if (tr) add(w, tr, -0, -tr * KAPPA, 0, 0);
      add(w, h - br, 0, 0, 0, br * KAPPA);
      if (br) add(w - br, h, br * KAPPA, 0, 0, 0);
      add(bl, h, 0, 0, -bl * KAPPA, 0);
      if (bl) add(0, h - bl, 0, bl * KAPPA, 0, 0);
      add(0, tl, 0, 0, 0, -tl * KAPPA);
      if (tl) add(tl, 0, -tl * KAPPA, 0, 0, 0);
      return [{ closed: true, nodes: dedupeNodes(nodes) }];
    }
    case 'ellipse': {
      const rx = w / 2, ry = h / 2;
      return [{
        closed: true,
        nodes: [
          node(rx, 0, -rx * KAPPA, 0, rx * KAPPA, 0, 'smooth'),
          node(w, ry, 0, -ry * KAPPA, 0, ry * KAPPA, 'smooth'),
          node(rx, h, rx * KAPPA, 0, -rx * KAPPA, 0, 'smooth'),
          node(0, ry, 0, ry * KAPPA, 0, -ry * KAPPA, 'smooth'),
        ],
      }];
    }
    case 'line':
      return [{ closed: false, nodes: o.dir === 'up' ? [node(0, h), node(w, 0)] : [node(0, 0), node(w, h)] }];
    case 'polygon':
    case 'star':
    case 'arrow':
      return [{ closed: true, nodes: polygonPoints(o).map((p) => node(p.x, p.y)) }];
    case 'path':
      return o.subpaths;
    default:
      return [];
  }
}

function dedupeNodes(nodes) {
  // Remove consecutive duplicates that appear when a radius is 0.
  const out = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.x - n.x) < 1e-6 && Math.abs(prev.y - n.y) < 1e-6) {
      prev.ox = n.ox || prev.ox; prev.oy = n.oy || prev.oy;
      continue;
    }
    out.push({ ...n });
  }
  const f = out[0], l = out[out.length - 1];
  if (out.length > 1 && Math.abs(f.x - l.x) < 1e-6 && Math.abs(f.y - l.y) < 1e-6) {
    f.ix = l.ix || f.ix; f.iy = l.iy || f.iy;
    out.pop();
  }
  return out;
}

const f2 = (n) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
};

export function pathData(subpaths) {
  const parts = [];
  for (const sp of subpaths) {
    const ns = sp.nodes;
    if (!ns.length) continue;
    parts.push(`M${f2(ns[0].x)} ${f2(ns[0].y)}`);
    const count = sp.closed ? ns.length : ns.length - 1;
    for (let i = 0; i < count; i++) {
      const a = ns[i], b = ns[(i + 1) % ns.length];
      if (!a.ox && !a.oy && !b.ix && !b.iy) parts.push(`L${f2(b.x)} ${f2(b.y)}`);
      else {
        parts.push(`C${f2(a.x + a.ox)} ${f2(a.y + a.oy)} ${f2(b.x + b.ix)} ${f2(b.y + b.iy)} ${f2(b.x)} ${f2(b.y)}`);
      }
    }
    if (sp.closed) parts.push('Z');
  }
  return parts.join('');
}

export function segmentPoints(a, b) {
  return [
    { x: a.x, y: a.y },
    { x: a.x + a.ox, y: a.y + a.oy },
    { x: b.x + b.ix, y: b.y + b.iy },
    { x: b.x, y: b.y },
  ];
}

export function subpathsBounds(subpaths) {
  const rects = [];
  for (const sp of subpaths) {
    const ns = sp.nodes;
    if (ns.length === 1) rects.push({ x: ns[0].x, y: ns[0].y, width: 0, height: 0 });
    const count = sp.closed ? ns.length : ns.length - 1;
    for (let i = 0; i < count; i++) {
      const [p0, p1, p2, p3] = segmentPoints(ns[i], ns[(i + 1) % ns.length]);
      rects.push(cubicBounds(p0, p1, p2, p3));
    }
  }
  return unionRects(rects) || { x: 0, y: 0, width: 0, height: 0 };
}

/**
 * Recomputes a path's box from its nodes and re-origins the nodes so that the
 * visual result (including rotation) is unchanged.
 */
export function normalizePath(o) {
  const b = subpathsBounds(o.subpaths);
  const oldCenter = { x: o.x + o.width / 2, y: o.y + o.height / 2 };
  const q = { x: o.x + b.x + b.width / 2, y: o.y + b.y + b.height / 2 };
  const nc = rotatePoint(q, oldCenter, o.rotation || 0);
  for (const sp of o.subpaths) {
    for (const n of sp.nodes) { n.x -= b.x; n.y -= b.y; }
  }
  o.width = b.width;
  o.height = b.height;
  o.x = nc.x - b.width / 2;
  o.y = nc.y - b.height / 2;
}

/** Subpaths in page coordinates (rotation applied). */
export function subpathsToWorld(o) {
  return shapeToSubpaths(o).map((sp) => ({
    closed: sp.closed,
    nodes: sp.nodes.map((n) => {
      const p = localToWorld(o, { x: n.x, y: n.y });
      const rot = (dx, dy) => {
        const r = (o.rotation || 0) * DEG;
        return [dx * Math.cos(r) - dy * Math.sin(r), dx * Math.sin(r) + dy * Math.cos(r)];
      };
      const [ix, iy] = rot(n.ix, n.iy);
      const [ox, oy] = rot(n.ox, n.oy);
      return { x: p.x, y: p.y, ix, iy, ox, oy, mode: n.mode || 'corner' };
    }),
  }));
}

export function pathFromSubpaths(subpaths, props = {}) {
  const o = createObject('path', { subpaths: JSON.parse(JSON.stringify(subpaths)), ...props });
  o.x = 0; o.y = 0; o.width = 1; o.height = 1; o.rotation = 0;
  normalizePath(o);
  return o;
}

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

export function collectAssetIds(doc) {
  const ids = new Set();
  for (const p of doc.pages) {
    for (const o of p.objects) {
      if ((o.type === 'image' || o.type === 'rasterLayer') && o.assetId) ids.add(o.assetId);
    }
  }
  for (const f of doc.fonts || []) if (f.assetId) ids.add(f.assetId);
  return ids;
}

/* ------------------------------------------------------------------ */
/* Validation & migration                                              */
/* ------------------------------------------------------------------ */

const MIGRATIONS = {
  // Example: 1: (doc) => { ...upgrade to schema 2...; doc.schemaVersion = 2; return doc; }
};

export function migrateDocument(doc) {
  if (!doc || typeof doc !== 'object') throw new UserError('This project file is damaged.', 'Try another backup.');
  let v = Number(doc.schemaVersion);
  if (!Number.isFinite(v) || v < 1) throw new UserError('This project has no valid version information.');
  if (v > SCHEMA_VERSION) {
    throw new UserError(
      'This project was created with a newer version of Slatte.',
      'Open it with an up-to-date copy of the app.',
    );
  }
  while (v < SCHEMA_VERSION) {
    const fn = MIGRATIONS[v];
    if (!fn) throw new UserError(`No migration path from schema version ${v}.`);
    doc = fn(doc);
    v = doc.schemaVersion;
  }
  return doc;
}

const num = (v, d, min = -1e7, max = 1e7) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : d);
const str = (v, d = '', max = 5000) => (typeof v === 'string' ? v.slice(0, max) : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const HEX = /^#[0-9a-fA-F]{6}$/;
const color = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);

function cleanPaint(p, base) {
  p = p && typeof p === 'object' ? p : {};
  const out = {
    type: ['none', 'solid', 'linear', 'radial'].includes(p.type) ? p.type : base.type,
    color: color(p.color, base.color),
    opacity: num(p.opacity, base.opacity, 0, 1),
    x1: num(p.x1, base.x1, -10, 10), y1: num(p.y1, base.y1, -10, 10),
    x2: num(p.x2, base.x2, -10, 10), y2: num(p.y2, base.y2, -10, 10),
    cx: num(p.cx, base.cx, -10, 10), cy: num(p.cy, base.cy, -10, 10), r: num(p.r, base.r, 0, 20),
    stops: (Array.isArray(p.stops) ? p.stops : base.stops).slice(0, 24).map((s) => ({
      offset: num(s && s.offset, 0, 0, 1), color: color(s && s.color, '#000000'), opacity: num(s && s.opacity, 1, 0, 1),
    })),
  };
  if (out.stops.length < 2) out.stops = base.stops.map((s) => ({ ...s }));
  return out;
}

function cleanStroke(s, base) {
  const paint = cleanPaint(s, base);
  s = s && typeof s === 'object' ? s : {};
  return {
    ...paint,
    width: num(s.width, base.width, 0, 500),
    cap: ['butt', 'round', 'square'].includes(s.cap) ? s.cap : base.cap,
    join: ['miter', 'round', 'bevel'].includes(s.join) ? s.join : base.join,
    dash: Object.prototype.hasOwnProperty.call(DASHES, s.dash) ? s.dash : base.dash,
  };
}

function cleanSubpaths(sps) {
  if (!Array.isArray(sps)) return [];
  return sps.slice(0, 2000).map((sp) => ({
    closed: !!(sp && sp.closed),
    nodes: (Array.isArray(sp && sp.nodes) ? sp.nodes : []).slice(0, 50000).map((n) => ({
      x: num(n && n.x, 0), y: num(n && n.y, 0), ix: num(n && n.ix, 0), iy: num(n && n.iy, 0),
      ox: num(n && n.ox, 0), oy: num(n && n.oy, 0), mode: n && n.mode === 'smooth' ? 'smooth' : 'corner',
    })),
  })).filter((sp) => sp.nodes.length);
}

/**
 * Validates and normalises a raw object. Unknown object types are preserved as
 * visible placeholders so nothing is silently discarded.
 */
export function normalizeObject(raw, warnings) {
  if (!raw || typeof raw !== 'object') throw new UserError('A layer in this project is damaged.');
  let type = raw.type;
  let metadata = raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {};
  if (!OBJECT_TYPES.includes(type)) {
    warnings.push(`Layer “${str(raw.name, 'Untitled', 80)}” uses an unsupported type (${str(type, '?', 30)}); it was kept as a placeholder.`);
    metadata = { ...metadata, original: JSON.parse(JSON.stringify(raw)) };
    type = 'rectangle';
    raw = { ...raw, type, fill: { type: 'none' }, stroke: { type: 'solid', color: '#e03131', width: 2, dash: 'dashed' } };
  }
  const def = createObject(type);
  const o = {
    id: str(raw.id, '', 80) || shortId('o'),
    type,
    name: str(raw.name, def.name, 120) || def.name,
    x: num(raw.x, 0), y: num(raw.y, 0),
    width: num(raw.width, def.width, 0, 1e6), height: num(raw.height, def.height, 0, 1e6),
    rotation: num(raw.rotation, 0, -3600, 3600),
    opacity: num(raw.opacity, 1, 0, 1),
    visible: bool(raw.visible, true), locked: bool(raw.locked, false),
    blendMode: BLEND_IDS.has(raw.blendMode) ? raw.blendMode : 'normal',
    parentId: typeof raw.parentId === 'string' ? raw.parentId : null,
    transform: null,
    metadata,
    fill: cleanPaint(raw.fill, def.fill),
    stroke: cleanStroke(raw.stroke, def.stroke),
    effects: {
      shadow: {
        on: bool(raw.effects?.shadow?.on, false), color: color(raw.effects?.shadow?.color, '#000000'),
        opacity: num(raw.effects?.shadow?.opacity, 0.35, 0, 1), blur: num(raw.effects?.shadow?.blur, 12, 0, 500),
        dx: num(raw.effects?.shadow?.dx, 0, -2000, 2000), dy: num(raw.effects?.shadow?.dy, 6, -2000, 2000),
      },
      blur: { on: bool(raw.effects?.blur?.on, false), amount: num(raw.effects?.blur?.amount, 4, 0, 200) },
      outline: {
        on: bool(raw.effects?.outline?.on, false), color: color(raw.effects?.outline?.color, '#000000'),
        width: num(raw.effects?.outline?.width, 2, 0, 200),
      },
    },
  };
  switch (type) {
    case 'rectangle': case 'roundedRectangle': case 'frame':
      o.radius = num(raw.radius, def.radius, 0, 1e5);
      o.radii = Array.isArray(raw.radii) && raw.radii.length === 4 ? raw.radii.map((r) => num(r, 0, 0, 1e5)) : null;
      if (type === 'frame') o.clip = bool(raw.clip, true);
      break;
    case 'line': o.dir = raw.dir === 'up' ? 'up' : 'down'; break;
    case 'polygon': o.sides = num(raw.sides, 6, 3, 100); break;
    case 'star': o.points = num(raw.points, 5, 3, 100); o.innerRatio = num(raw.innerRatio, 0.5, 0.05, 0.95); break;
    case 'arrow': o.headRatio = num(raw.headRatio, 0.4, 0.1, 0.9); break;
    case 'path': o.subpaths = cleanSubpaths(raw.subpaths); o.fillRule = raw.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'; break;
    case 'text':
      o.text = str(raw.text, '', 100000);
      o.fontFamily = str(raw.fontFamily, 'Inter', 120).replace(/["'<>;{}]/g, '') || 'Inter';
      o.fontWeight = num(raw.fontWeight, 400, 100, 900);
      o.fontStyle = raw.fontStyle === 'italic' ? 'italic' : 'normal';
      o.fontSize = num(raw.fontSize, 48, 1, 5000);
      o.lineHeight = num(raw.lineHeight, 1.2, 0.5, 10);
      o.letterSpacing = num(raw.letterSpacing, 0, -100, 500);
      o.align = ['left', 'center', 'right'].includes(raw.align) ? raw.align : 'left';
      o.underline = bool(raw.underline, false); o.strike = bool(raw.strike, false);
      o.autoWidth = bool(raw.autoWidth, true);
      break;
    case 'image':
      o.assetId = str(raw.assetId, '', 120) || null;
      o.fit = ['cover', 'contain', 'stretch'].includes(raw.fit) ? raw.fit : 'cover';
      o.naturalWidth = num(raw.naturalWidth, 0, 0, 1e6); o.naturalHeight = num(raw.naturalHeight, 0, 0, 1e6);
      break;
    case 'icon':
      o.svg = str(raw.svg, '', 400000);
      o.viewBox = Array.isArray(raw.viewBox) && raw.viewBox.length === 4 ? raw.viewBox.map((v) => num(v, 0)) : [0, 0, 24, 24];
      if (!(o.viewBox[2] > 0 && o.viewBox[3] > 0)) o.viewBox = [0, 0, 24, 24];
      o.source = raw.source && typeof raw.source === 'object' ? JSON.parse(JSON.stringify(raw.source)) : null;
      break;
    case 'rasterLayer':
      o.assetId = str(raw.assetId, '', 120) || null; o.scale = num(raw.scale, 1, 0.1, 8);
      break;
    case 'texture':
      o.kind = TEXTURE_KINDS.includes(raw.kind) ? raw.kind : 'paper';
      o.scale = num(raw.scale, 40, 2, 2000); o.intensity = num(raw.intensity, 0.5, 0, 1); o.density = num(raw.density, 0.5, 0, 1);
      o.color = color(raw.color, '#000000'); o.seed = num(raw.seed, 1, 0, 1e6); o.wave = num(raw.wave, 0, 0, 100);
      break;
    default: break;
  }
  return o;
}

/**
 * Validates untrusted document data and returns a clean copy.
 * @returns {{doc: object, warnings: string[]}}
 */
export function validateDocument(input) {
  const warnings = [];
  const raw = migrateDocument(input);
  if (!Array.isArray(raw.pages) || !raw.pages.length) throw new UserError('This project has no pages.');
  if (raw.pages.length > 200) throw new UserError('This project has too many pages.');
  const seenPages = new Set();
  const pages = raw.pages.map((p, i) => {
    if (!p || typeof p !== 'object') throw new UserError('A page in this project is damaged.');
    let id = str(p.id, '', 80) || shortId('p');
    if (seenPages.has(id)) id = shortId('p');
    seenPages.add(id);
    const seen = new Set();
    const objects = [];
    for (const rawObj of Array.isArray(p.objects) ? p.objects.slice(0, 100000) : []) {
      const o = normalizeObject(rawObj, warnings);
      if (seen.has(o.id)) {
        warnings.push(`Duplicate layer id “${o.id}” was repaired.`);
        o.id = shortId('o');
      }
      seen.add(o.id);
      objects.push(o);
    }
    const ids = new Set(objects.map((o) => o.id));
    for (const o of objects) {
      if (o.parentId && (!ids.has(o.parentId) || o.parentId === o.id)) {
        warnings.push(`Layer “${o.name}” lost its parent and was moved to the page.`);
        o.parentId = null;
      }
    }
    // break parent cycles
    const idx = new Map(objects.map((o) => [o.id, o]));
    for (const o of objects) {
      let cur = o, guard = 0;
      while (cur && cur.parentId && guard++ < 200) cur = idx.get(cur.parentId);
      if (guard >= 200) { o.parentId = null; warnings.push(`Layer “${o.name}” had a circular parent and was repaired.`); }
    }
    return {
      id,
      name: str(p.name, `Page ${i + 1}`, 120) || `Page ${i + 1}`,
      width: num(p.width, 1080, 1, 16000), height: num(p.height, 1080, 1, 16000),
      background: { color: color(p.background?.color, '#ffffff'), transparent: bool(p.background?.transparent, false) },
      objects,
      guides: Array.isArray(p.guides) ? p.guides.slice(0, 200).map((g) => ({ axis: g && g.axis === 'y' ? 'y' : 'x', pos: num(g && g.pos, 0) })) : [],
      gridSettings: {
        size: num(p.gridSettings?.size, 20, 1, 1000), show: bool(p.gridSettings?.show, false), snap: bool(p.gridSettings?.snap, false),
      },
    };
  });
  const assets = {};
  if (raw.assets && typeof raw.assets === 'object') {
    for (const [id, a] of Object.entries(raw.assets)) {
      if (!a || typeof a !== 'object') continue;
      assets[id] = {
        id,
        name: str(a.name, 'asset', 200),
        mime: str(a.mime, 'application/octet-stream', 80),
        kind: ['image', 'font', 'raster', 'texture'].includes(a.kind) ? a.kind : 'image',
        size: num(a.size, 0, 0, 1e10),
        width: num(a.width, 0, 0, 1e6), height: num(a.height, 0, 0, 1e6),
        source: a.source && typeof a.source === 'object' ? JSON.parse(JSON.stringify(a.source)) : null,
        path: typeof a.path === 'string' ? a.path : undefined,
      };
    }
  }
  const fonts = (Array.isArray(raw.fonts) ? raw.fonts : []).slice(0, 200).map((f) => ({
    id: str(f && f.id, '', 80) || shortId('f'),
    family: str(f && f.family, '', 120).replace(/["'<>;{}]/g, ''),
    source: f && f.source === 'local' ? 'local' : 'google',
    assetId: str(f && f.assetId, '', 120) || null,
    weights: Array.isArray(f && f.weights) ? f.weights.map((w) => num(w, 400, 100, 900)).slice(0, 12) : [400],
    category: str(f && f.category, 'sans-serif', 30),
    license: str(f && f.license, '', 200),
  })).filter((f) => f.family);
  const activePageId = pages.some((p) => p.id === raw.activePageId) ? raw.activePageId : pages[0].id;
  const doc = {
    id: str(raw.id, '', 80) || uid(),
    name: str(raw.name, 'Untitled', 200) || 'Untitled',
    schemaVersion: SCHEMA_VERSION,
    createdAt: str(raw.createdAt, new Date().toISOString(), 40),
    updatedAt: str(raw.updatedAt, new Date().toISOString(), 40),
    activePageId,
    pages,
    assets,
    fonts,
    colorStyles: (Array.isArray(raw.colorStyles) ? raw.colorStyles : []).slice(0, 500).map((c) => ({
      id: str(c && c.id, '', 80) || shortId('c'), name: str(c && c.name, 'Color', 80), color: color(c && c.color, '#000000'),
    })),
    settings: {
      recentColors: (Array.isArray(raw.settings?.recentColors) ? raw.settings.recentColors : []).map((c) => color(c, null)).filter(Boolean).slice(0, 16),
      snap: bool(raw.settings?.snap, true),
      rulers: bool(raw.settings?.rulers, false),
    },
  };
  // Re-fit group bounds so stored boxes are trustworthy.
  for (const p of doc.pages) {
    const containers = p.objects.filter((o) => o.type === 'group');
    for (let pass = 0; pass < 4; pass++) for (const g of containers) refreshGroupBounds(p, g);
  }
  return { doc, warnings };
}

/** Plain JSON-safe copy of the parts of the document tracked by history. */
export function snapshotContent(doc) {
  return JSON.stringify({
    pages: doc.pages, activePageId: doc.activePageId, assets: doc.assets, fonts: doc.fonts,
    colorStyles: doc.colorStyles, settings: doc.settings,
  });
}

export function restoreContent(doc, json) {
  const c = JSON.parse(json);
  doc.pages = c.pages;
  doc.activePageId = c.activePageId;
  doc.assets = c.assets;
  doc.fonts = c.fonts;
  doc.colorStyles = c.colorStyles;
  doc.settings = c.settings;
}

export { aabb };
