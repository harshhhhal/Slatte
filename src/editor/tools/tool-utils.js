import { expandIds } from '../../core/transform.js';

/** Captures JSON copies of the given objects (and descendants) so a drag can restart from the original each frame. */
export function captureObjects(page, ids) {
  const set = expandIds(page, ids);
  const snap = new Map();
  for (const o of page.objects) if (set.has(o.id)) snap.set(o.id, JSON.stringify(o));
  return snap;
}

export function restoreObjects(page, snap) {
  for (let i = 0; i < page.objects.length; i++) {
    const s = snap.get(page.objects[i].id);
    if (s) page.objects[i] = JSON.parse(s);
  }
}

export const f2 = (n) => Math.round(n * 100) / 100;

export function dragDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Screen-space distance threshold (px) before a press becomes a drag. */
export const DRAG_SLOP = 3;

/** Id of the topmost visible, unlocked frame containing a page point (new shapes drawn there join it). */
export function frameAt(editor, pt, excludeId = null) {
  const objs = editor.page.objects;
  for (let i = objs.length - 1; i >= 0; i--) {
    const o = objs[i];
    if (o.type !== 'frame' || o.id === excludeId || !o.visible || o.locked) continue;
    if (pt.x >= o.x && pt.x <= o.x + o.width && pt.y >= o.y && pt.y <= o.y + o.height) return o.id;
  }
  return null;
}
