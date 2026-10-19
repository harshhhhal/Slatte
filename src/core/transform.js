import { centerOf, rotatePoint, unionRects, worldBounds, DEG } from '../utils/geometry.js';
import { descendantIds, indexPage, isContainer, refreshGroupBounds } from './document-model.js';
import { fitText } from './text-layout.js';

export function expandIds(page, ids) {
  const set = new Set();
  for (const id of ids) {
    set.add(id);
    descendantIds(page, id).forEach((d) => set.add(d));
  }
  return set;
}

/** Re-fits every group's box, deepest first. */
export function refreshAllGroups(page) {
  const idx = indexPage(page);
  const depth = (o) => {
    let d = 0, cur = o, g = 0;
    while (cur && cur.parentId && g++ < 100) { d++; cur = idx.get(cur.parentId); }
    return d;
  };
  const groups = page.objects.filter((o) => o.type === 'group').sort((a, b) => depth(b) - depth(a));
  for (const g of groups) refreshGroupBounds(page, g, idx);
}

export function moveBy(page, ids, dx, dy) {
  const set = expandIds(page, ids);
  for (const o of page.objects) {
    if (set.has(o.id)) { o.x += dx; o.y += dy; }
  }
}

/** Scales path geometry / text when an object's box changes. */
export function resizeContent(o, w, h) {
  w = Math.max(0, w); h = Math.max(0, h);
  if (o.type === 'path' && o.width > 1e-9 && o.height > 1e-9) {
    const sx = w / o.width, sy = h / o.height;
    for (const sp of o.subpaths) {
      for (const n of sp.nodes) {
        n.x *= sx; n.y *= sy; n.ix *= sx; n.iy *= sy; n.ox *= sx; n.oy *= sy;
      }
    }
  } else if (o.type === 'path' && (o.width <= 1e-9 || o.height <= 1e-9)) {
    // degenerate box (straight horizontal/vertical path): only scale the live axis
    const sx = o.width > 1e-9 ? w / o.width : 1, sy = o.height > 1e-9 ? h / o.height : 1;
    for (const sp of o.subpaths) {
      for (const n of sp.nodes) {
        n.x *= sx; n.y *= sy; n.ix *= sx; n.iy *= sy; n.ox *= sx; n.oy *= sy;
      }
    }
  }
  o.width = w;
  o.height = h;
}

export function scaleAbout(o, origin, sx, sy) {
  const c = centerOf(o);
  const nc = { x: origin.x + (c.x - origin.x) * sx, y: origin.y + (c.y - origin.y) * sy };
  const r = ((o.rotation % 180) + 180) % 180;
  const swap = Math.abs(r - 90) < 1e-6;
  const kw = swap ? sy : sx, kh = swap ? sx : sy;
  if (o.type === 'text') {
    const k = Math.abs(kh);
    o.fontSize = Math.max(1, o.fontSize * k);
    o.letterSpacing = (o.letterSpacing || 0) * k;
    if (!o.autoWidth) o.width = Math.max(4, o.width * Math.abs(kw));
    fitText(o);
  } else {
    resizeContent(o, o.width * Math.abs(kw), o.height * Math.abs(kh));
  }
  o.x = nc.x - o.width / 2;
  o.y = nc.y - o.height / 2;
}

export function scaleObjects(page, ids, origin, sx, sy) {
  const set = expandIds(page, ids);
  for (const o of page.objects) {
    if (set.has(o.id) && o.type !== 'group') scaleAbout(o, origin, sx, sy);
  }
  refreshAllGroups(page);
}

export function rotateAbout(o, pivot, deg) {
  const c = rotatePoint(centerOf(o), pivot, deg);
  o.rotation = (o.rotation || 0) + deg;
  o.x = c.x - o.width / 2;
  o.y = c.y - o.height / 2;
}

export function rotateObjects(page, ids, pivot, deg) {
  const set = expandIds(page, ids);
  for (const o of page.objects) {
    if (set.has(o.id) && o.type !== 'group' && o.type !== 'frame') rotateAbout(o, pivot, deg);
    else if (set.has(o.id) && o.type === 'frame') rotateAbout(o, pivot, 0);
  }
  refreshAllGroups(page);
}

/** World-space bounds for a selection of ids (containers expand to their leaves). */
export function selectionBounds(page, ids) {
  const set = expandIds(page, ids);
  const rects = page.objects.filter((o) => set.has(o.id) && !isContainer(o)).map(worldBounds);
  const frames = page.objects.filter((o) => set.has(o.id) && o.type === 'frame').map(worldBounds);
  return unionRects([...rects, ...frames]);
}

/**
 * Resizes a single non-container object by dragging one of its box handles.
 * handle = {hx,hy} with each in {-1,0,1}. `start` is a snapshot of {x,y,width,height,rotation}.
 */
export function resizeByHandle(o, start, handle, pointer, { keepRatio = false, fromCenter = false } = {}) {
  const c0 = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  const q = rotatePoint(pointer, c0, -(start.rotation || 0));
  const qx = q.x - c0.x, qy = q.y - c0.y;
  const hw = start.width / 2, hh = start.height / 2;
  let left = -hw, right = hw, top = -hh, bottom = hh;
  if (handle.hx > 0) right = qx; else if (handle.hx < 0) left = qx;
  if (handle.hy > 0) bottom = qy; else if (handle.hy < 0) top = qy;
  if (fromCenter) {
    if (handle.hx !== 0) { const e = Math.abs(handle.hx > 0 ? right : left); left = -e; right = e; }
    if (handle.hy !== 0) { const e = Math.abs(handle.hy > 0 ? bottom : top); top = -e; bottom = e; }
  }
  let w = Math.max(1, right - left), h = Math.max(1, bottom - top);
  if (keepRatio && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    if (handle.hx !== 0 && handle.hy !== 0) {
      const sw = w / start.width, sh = h / start.height;
      const s = Math.max(sw, sh);
      w = start.width * s; h = start.height * s;
    } else if (handle.hx !== 0) h = w / ratio;
    else w = h * ratio;
    // re-anchor edges after ratio correction
    if (!fromCenter) {
      if (handle.hx > 0) right = left + w; else if (handle.hx < 0) left = right - w;
      else { left = -w / 2; right = w / 2; }
      if (handle.hy > 0) bottom = top + h; else if (handle.hy < 0) top = bottom - h;
      else { top = -h / 2; bottom = h / 2; }
    } else {
      left = -w / 2; right = w / 2; top = -h / 2; bottom = h / 2;
    }
  }
  const ncLocal = { x: c0.x + (left + right) / 2, y: c0.y + (top + bottom) / 2 };
  const nc = rotatePoint(ncLocal, c0, start.rotation || 0);
  return { x: nc.x - w / 2, y: nc.y - h / 2, width: w, height: h };
}

export function degFromPoints(center, p) {
  return Math.atan2(p.y - center.y, p.x - center.x) / DEG;
}
