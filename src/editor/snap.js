import { descendantIds, isContainer } from '../core/document-model.js';
import { worldBounds } from '../utils/geometry.js';

/** Collects snap lines (page edges/centres, other objects, grid) for one axis. */
function candidateLines(editor, excludeIds) {
  const page = editor.page;
  const ex = new Set();
  for (const id of excludeIds) {
    ex.add(id);
    descendantIds(page, id).forEach((d) => ex.add(d));
  }
  const xs = [{ v: 0, kind: 'page' }, { v: page.width / 2, kind: 'page' }, { v: page.width, kind: 'page' }];
  const ys = [{ v: 0, kind: 'page' }, { v: page.height / 2, kind: 'page' }, { v: page.height, kind: 'page' }];
  const boxes = [];
  for (const o of page.objects) {
    if (ex.has(o.id) || !o.visible || isContainer(o) || o.type === 'rasterLayer' || o.type === 'texture') continue;
    const b = worldBounds(o);
    boxes.push(b);
    xs.push({ v: b.x, kind: 'obj', b }, { v: b.x + b.width / 2, kind: 'obj', b }, { v: b.x + b.width, kind: 'obj', b });
    ys.push({ v: b.y, kind: 'obj', b }, { v: b.y + b.height / 2, kind: 'obj', b }, { v: b.y + b.height, kind: 'obj', b });
  }
  return { xs, ys, boxes };
}

function gridSnap(v, size) {
  return Math.round(v / size) * size;
}

/**
 * Snaps a moving rectangle. Returns the correction to apply and the guides to draw.
 * `thr` is in page units (callers divide the screen threshold by zoom).
 */
export function snapRect(editor, rect, excludeIds, thr) {
  const page = editor.page;
  const settings = editor.doc.settings;
  const out = { dx: 0, dy: 0, guides: [] };
  if (!settings.snap && !page.gridSettings.snap) return out;
  const { xs, ys } = candidateLines(editor, excludeIds);
  const mx = [rect.x, rect.x + rect.width / 2, rect.x + rect.width];
  const my = [rect.y, rect.y + rect.height / 2, rect.y + rect.height];
  let bestX = null, bestY = null;
  if (settings.snap) {
    for (const m of mx) for (const c of xs) {
      const d = c.v - m;
      if (Math.abs(d) <= thr && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, v: c.v };
    }
    for (const m of my) for (const c of ys) {
      const d = c.v - m;
      if (Math.abs(d) <= thr && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, v: c.v };
    }
  }
  if (page.gridSettings.snap && !bestX) {
    const g = gridSnap(rect.x, page.gridSettings.size) - rect.x;
    if (Math.abs(g) <= thr) bestX = { d: g, v: rect.x + g };
  }
  if (page.gridSettings.snap && !bestY) {
    const g = gridSnap(rect.y, page.gridSettings.size) - rect.y;
    if (Math.abs(g) <= thr) bestY = { d: g, v: rect.y + g };
  }
  if (bestX) { out.dx = bestX.d; out.guides.push({ axis: 'x', pos: bestX.v }); }
  if (bestY) { out.dy = bestY.d; out.guides.push({ axis: 'y', pos: bestY.v }); }
  return out;
}

/** Snaps a single point (used for resizing, drawing and path nodes). */
export function snapPoint(editor, p, excludeIds, thr) {
  const page = editor.page;
  const settings = editor.doc.settings;
  const out = { x: p.x, y: p.y, guides: [] };
  if (!settings.snap && !page.gridSettings.snap) return out;
  const { xs, ys } = candidateLines(editor, excludeIds);
  let bx = null, by = null;
  if (settings.snap) {
    for (const c of xs) { const d = c.v - p.x; if (Math.abs(d) <= thr && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, v: c.v }; }
    for (const c of ys) { const d = c.v - p.y; if (Math.abs(d) <= thr && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, v: c.v }; }
  }
  if (page.gridSettings.snap) {
    if (!bx) { const g = gridSnap(p.x, page.gridSettings.size); if (Math.abs(g - p.x) <= thr) bx = { d: g - p.x, v: g }; }
    if (!by) { const g = gridSnap(p.y, page.gridSettings.size); if (Math.abs(g - p.y) <= thr) by = { d: g - p.y, v: g }; }
  }
  if (bx) { out.x = bx.v; out.guides.push({ axis: 'x', pos: bx.v }); }
  if (by) { out.y = by.v; out.guides.push({ axis: 'y', pos: by.v }); }
  return out;
}
