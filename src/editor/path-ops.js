import { splitCubic, segmentPointsFor } from './path-geometry.js';

/** Pure editing operations over structured subpaths (local coordinates). */

export function makeSmooth(sp, i) {
  const ns = sp.nodes;
  const n = ns[i];
  const count = ns.length;
  const prev = sp.closed || i > 0 ? ns[(i - 1 + count) % count] : null;
  const next = sp.closed || i < count - 1 ? ns[(i + 1) % count] : null;
  if (!prev && !next) return;
  const a = prev || n, b = next || n;
  let tx = b.x - a.x, ty = b.y - a.y;
  const tl = Math.hypot(tx, ty) || 1;
  tx /= tl; ty /= tl;
  const lenIn = prev ? Math.hypot(n.x - prev.x, n.y - prev.y) / 3 : 0;
  const lenOut = next ? Math.hypot(next.x - n.x, next.y - n.y) / 3 : 0;
  n.ix = -tx * lenIn; n.iy = -ty * lenIn;
  n.ox = tx * lenOut; n.oy = ty * lenOut;
  n.mode = 'smooth';
}

export function makeCorner(sp, i) {
  const n = sp.nodes[i];
  n.ix = n.iy = n.ox = n.oy = 0;
  n.mode = 'corner';
}

export function toggleNodeMode(sp, i) {
  const n = sp.nodes[i];
  const hasHandles = n.ix || n.iy || n.ox || n.oy;
  if (n.mode === 'smooth' && hasHandles) makeCorner(sp, i);
  else makeSmooth(sp, i);
}

/** Inserts a node on segment `seg` (from node seg to seg+1) at parameter t. Returns the new node index. */
export function insertNode(sp, seg, t) {
  const ns = sp.nodes;
  const a = ns[seg], b = ns[(seg + 1) % ns.length];
  const [p0, p1, p2, p3] = segmentPointsFor(a, b);
  const [l, r] = splitCubic(p0, p1, p2, p3, t);
  const curved = a.ox || a.oy || b.ix || b.iy;
  const node = {
    x: l[3].x, y: l[3].y,
    ix: curved ? l[2].x - l[3].x : 0, iy: curved ? l[2].y - l[3].y : 0,
    ox: curved ? r[1].x - r[0].x : 0, oy: curved ? r[1].y - r[0].y : 0,
    mode: curved ? 'smooth' : 'corner',
  };
  if (curved) {
    a.ox = l[1].x - a.x; a.oy = l[1].y - a.y;
    b.ix = r[2].x - b.x; b.iy = r[2].y - b.y;
  }
  ns.splice(seg + 1, 0, node);
  return seg + 1;
}

/** Removes nodes by "sp:idx" keys. Returns subpaths without empty ones. */
export function removeNodes(subpaths, keys) {
  const out = [];
  subpaths.forEach((sp, si) => {
    const kept = sp.nodes.filter((_, ni) => !keys.has(`${si}:${ni}`));
    if (kept.length) out.push({ ...sp, nodes: kept, closed: sp.closed && kept.length > 2 });
  });
  return out;
}

export function segmentCount(sp) {
  return sp.closed ? sp.nodes.length : Math.max(0, sp.nodes.length - 1);
}
