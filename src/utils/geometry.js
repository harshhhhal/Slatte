/** Geometry helpers. All angles are degrees unless noted. */

export const DEG = Math.PI / 180;

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const round = (v, p = 2) => {
  const f = 10 ** p;
  return Math.round(v * f) / f;
};
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a, b, t) => a + (b - a) * t;

export function rotatePoint(p, c, deg) {
  const r = deg * DEG;
  const cos = Math.cos(r), sin = Math.sin(r);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

export function centerOf(o) {
  return { x: o.x + o.width / 2, y: o.y + o.height / 2 };
}

/** Object-local point (origin = top-left of unrotated box) to page coordinates. */
export function localToWorld(o, p) {
  const c = centerOf(o);
  return rotatePoint({ x: o.x + p.x, y: o.y + p.y }, c, o.rotation || 0);
}

/** Page point to object-local coordinates. */
export function worldToLocal(o, p) {
  const c = centerOf(o);
  const q = rotatePoint(p, c, -(o.rotation || 0));
  return { x: q.x - o.x, y: q.y - o.y };
}

export function cornersOf(o) {
  return [
    localToWorld(o, { x: 0, y: 0 }),
    localToWorld(o, { x: o.width, y: 0 }),
    localToWorld(o, { x: o.width, y: o.height }),
    localToWorld(o, { x: 0, y: o.height }),
  ];
}

export function aabb(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function worldBounds(o) {
  return aabb(cornersOf(o));
}

export function unionRects(rects) {
  if (!rects.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function rectsIntersect(a, b) {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

export function rectContains(r, p) {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

export function normRect(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/* ---------- Cubic Bézier helpers ---------- */

export function cubicAt(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/** De Casteljau split; returns [left, right], each [p0,p1,p2,p3]. */
export function splitCubic(p0, p1, p2, p3, t) {
  const m = (a, b) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
  const p01 = m(p0, p1), p12 = m(p1, p2), p23 = m(p2, p3);
  const p012 = m(p01, p12), p123 = m(p12, p23);
  const mid = m(p012, p123);
  return [[p0, p01, p012, mid], [mid, p123, p23, p3]];
}

/** Tight-ish bounds of a cubic by sampling. */
export function cubicBounds(p0, p1, p2, p3, steps = 24) {
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push(cubicAt(p0, p1, p2, p3, i / steps));
  return aabb(pts);
}

export function nearestOnCubic(p0, p1, p2, p3, pt, steps = 40) {
  let best = { t: 0, d: Infinity, point: p0 };
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const q = cubicAt(p0, p1, p2, p3, t);
    const d = dist(q, pt);
    if (d < best.d) best = { t, d, point: q };
  }
  // refine
  let lo = Math.max(0, best.t - 1 / steps), hi = Math.min(1, best.t + 1 / steps);
  for (let k = 0; k < 12; k++) {
    const t1 = lo + (hi - lo) / 3, t2 = hi - (hi - lo) / 3;
    const d1 = dist(cubicAt(p0, p1, p2, p3, t1), pt), d2 = dist(cubicAt(p0, p1, p2, p3, t2), pt);
    if (d1 < d2) hi = t2; else lo = t1;
  }
  const t = (lo + hi) / 2;
  const point = cubicAt(p0, p1, p2, p3, t);
  return { t, d: dist(point, pt), point };
}

export function snapAngle(deg, step = 15) {
  return Math.round(deg / step) * step;
}

export function normalizeAngle(deg) {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}
