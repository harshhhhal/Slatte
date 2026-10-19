import { cloneObjects, isEffectivelyHidden, isEffectivelyLocked, uniqueName, isContainer } from '../../core/document-model.js';
import { resizeByHandle, rotateObjects, scaleObjects, moveBy, degFromPoints } from '../../core/transform.js';
import { fitText } from '../../core/text-layout.js';
import { normRect, rectsIntersect, worldBounds, snapAngle, normalizeAngle } from '../../utils/geometry.js';
import { captureObjects, restoreObjects, dragDistance, DRAG_SLOP, f2 } from './tool-utils.js';
import { snapRect, snapPoint } from '../snap.js';

const HIT = 9;

export function createSelectTool() {
  let st = null; // drag state
  let hoverCursor = null;

  const hitHandle = (stage, p) => {
    const fr = stage.selectionFrame();
    if (!fr || fr.locked) return null;
    if (fr.canRotate && Math.hypot(p.x - fr.rotate.x, p.y - fr.rotate.y) <= HIT) return { kind: 'rotate', fr };
    for (const hd of fr.handles) if (Math.abs(p.x - hd.x) <= HIT && Math.abs(p.y - hd.y) <= HIT) return { kind: 'resize', handle: hd, fr };
    return null;
  };

  const tool = {
    id: 'select',
    cursor: 'default',

    activate({ editor }) { },
    deactivate({ stage }) { st = null; stage.setGuides([]); stage.setCursor(null); },
    cancel({ editor, stage }) {
      if (st && st.snap) editor.preview((page) => restoreObjects(page, st.snap));
      st = null;
      stage.setGuides([]);
    },

    pointerDown(ev, { editor, stage }) {
      const handle = hitHandle(stage, ev.screen);
      const page = editor.page;
      if (handle) {
        const ids = editor.editableIds();
        const snap = captureObjects(page, ids);
        const objs = ids.map((i) => editor.get(i));
        const single = objs.length === 1 && !isContainer(objs[0]) ? objs[0] : null;
        if (handle.kind === 'rotate') {
          const b = editor.bounds(ids);
          const pivot = single ? { x: single.x + single.width / 2, y: single.y + single.height / 2 } : { x: b.x + b.width / 2, y: b.y + b.height / 2 };
          st = { mode: 'rotate', ids, snap, pivot, startAngle: degFromPoints(pivot, ev.page), single, startRot: single ? single.rotation : 0, moved: false };
        } else {
          const b = editor.bounds(ids);
          st = {
            mode: 'resize', ids, snap, handle: handle.handle, single, bounds: b,
            start: single ? { x: single.x, y: single.y, width: single.width, height: single.height, rotation: single.rotation, fontSize: single.fontSize, autoWidth: single.autoWidth } : null,
            moved: false,
          };
        }
        return;
      }
      const hitId = stage.objectIdAt(ev.target);
      if (hitId) {
        const top = editor.topSelectable(hitId);
        const obj = editor.get(top);
        if (!obj || isEffectivelyLocked(obj, editor.idx) || isEffectivelyHidden(obj, editor.idx)) {
          st = { mode: 'marquee', start: ev.page, startScreen: ev.screen, additive: ev.shift, base: [...editor.selection], moved: false };
          if (!ev.shift) editor.clearSelection();
          return;
        }
        if (ev.shift) {
          editor.select([top], { toggle: true });
          if (!editor.selection.includes(top)) { st = null; return; }
        } else if (!editor.selection.includes(top)) editor.select([top]);
        const ids = editor.editableIds();
        st = {
          mode: 'move', ids, snap: captureObjects(page, ids), start: ev.page, startScreen: ev.screen,
          startBounds: editor.bounds(ids), moved: false, duplicated: false, alt: ev.alt,
        };
        return;
      }
      // empty canvas → marquee
      st = { mode: 'marquee', start: ev.page, startScreen: ev.screen, additive: ev.shift, base: [...editor.selection], moved: false };
      if (!ev.shift) editor.clearSelection();
    },

    pointerMove(ev, { editor, stage }) {
      if (!st) return;
      const thr = 6 / editor.viewport.zoom;
      if (st.mode === 'move') {
        if (!st.moved && dragDistance(ev.screen, st.startScreen) < DRAG_SLOP) return;
        if (!st.moved && st.alt && !st.duplicated) {
          // Alt-drag: duplicate and drag the copies
          editor.preview((page) => {
            const { objects, rootIds } = cloneObjects(page, editor.selection);
            for (const o of objects) if (rootIds.includes(o.id)) o.name = uniqueName(page, o.name.replace(/ \d+$/, '') + ' copy');
            page.objects.push(...objects);
            editor.selection = rootIds;
          });
          editor.emit('selection');
          st.ids = editor.selection.slice();
          st.snap = captureObjects(editor.page, st.ids);
          st.duplicated = true;
        }
        st.moved = true;
        let dx = ev.page.x - st.start.x, dy = ev.page.y - st.start.y;
        if (ev.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        const b = st.startBounds;
        const sn = ev.mod ? { dx: 0, dy: 0, guides: [] } : snapRect(editor, { x: b.x + dx, y: b.y + dy, width: b.width, height: b.height }, st.ids, thr);
        dx += sn.dx; dy += sn.dy;
        stage.setGuides(sn.guides);
        editor.preview((page) => {
          restoreObjects(page, st.snap);
          moveBy(page, st.ids, dx, dy);
        });
        return;
      }
      if (st.mode === 'resize') {
        st.moved = true;
        const { handle } = st;
        const sp = snapPoint(editor, ev.page, st.ids, thr);
        const p = ev.mod ? ev.page : { x: sp.x, y: sp.y };
        stage.setGuides(ev.mod ? [] : sp.guides);
        if (st.single) {
          const o0 = st.single;
          const isText = o0.type === 'text';
          let nb;
          if (isText) {
            nb = resizeByHandle(o0, st.start, handle, p, { keepRatio: handle.hx !== 0 && handle.hy !== 0, fromCenter: ev.alt });
          } else {
            const ratioDefault = o0.type === 'image';
            nb = resizeByHandle(o0, st.start, handle, p, { keepRatio: ev.shift !== ratioDefault, fromCenter: ev.alt });
          }
          editor.preview((pg) => {
            restoreObjects(pg, st.snap);
            const o = pg.objects.find((x) => x.id === o0.id);
            if (isText) {
              if (handle.hx !== 0 && handle.hy === 0) {
                o.autoWidth = false; o.width = Math.max(8, nb.width); fitText(o); o.x = nb.x; o.y = st.start.y;
              } else if (handle.hx !== 0 && handle.hy !== 0) {
                const k = nb.width / Math.max(1, st.start.width);
                o.fontSize = Math.max(1, st.start.fontSize * k);
                o.letterSpacing = (o.letterSpacing || 0) * k;
                if (!st.start.autoWidth) o.width = Math.max(8, nb.width);
                fitText(o); o.x = nb.x; o.y = nb.y;
              }
            } else {
              // reuse the shared content scaler so path nodes follow the box
              const sx = nb.width / Math.max(1e-6, o.width), sy = nb.height / Math.max(1e-6, o.height);
              scaleBoxContent(o, sx, sy);
              o.width = nb.width; o.height = nb.height; o.x = nb.x; o.y = nb.y;
            }
          });
        } else {
          const b = st.bounds;
          const hx = handle.hx, hy = handle.hy;
          let left = b.x, right = b.x + b.width, top = b.y, bottom = b.y + b.height;
          if (hx > 0) right = p.x; else if (hx < 0) left = p.x;
          if (hy > 0) bottom = p.y; else if (hy < 0) top = p.y;
          if (ev.alt) {
            const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
            if (hx) { const e = Math.abs((hx > 0 ? right : left) - cx); left = cx - e; right = cx + e; }
            if (hy) { const e = Math.abs((hy > 0 ? bottom : top) - cy); top = cy - e; bottom = cy + e; }
          }
          let sx = b.width > 0 ? (right - left) / b.width : 1, sy = b.height > 0 ? (bottom - top) / b.height : 1;
          if (hx === 0) sx = 1;
          if (hy === 0) sy = 1;
          if (ev.shift && hx && hy) { const s = Math.max(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx || 1) * s; sy = Math.sign(sy || 1) * s; }
          sx = Math.max(0.01, Math.abs(sx)); sy = Math.max(0.01, Math.abs(sy));
          const origin = ev.alt ? { x: b.x + b.width / 2, y: b.y + b.height / 2 }
            : { x: hx > 0 ? b.x : hx < 0 ? b.x + b.width : b.x + b.width / 2, y: hy > 0 ? b.y : hy < 0 ? b.y + b.height : b.y + b.height / 2 };
          editor.preview((pg) => {
            restoreObjects(pg, st.snap);
            scaleObjects(pg, st.ids, origin, sx, sy);
          });
        }
        return;
      }
      if (st.mode === 'rotate') {
        st.moved = true;
        let delta = degFromPoints(st.pivot, ev.page) - st.startAngle;
        if (ev.shift) {
          const target = snapAngle(st.startRot + delta, 15);
          delta = target - st.startRot;
        }
        editor.preview((pg) => {
          restoreObjects(pg, st.snap);
          if (st.single) {
            const o = pg.objects.find((x) => x.id === st.single.id);
            o.rotation = normalizeAngle(st.startRot + delta);
          } else rotateObjects(pg, st.ids, st.pivot, delta);
        });
        return;
      }
      if (st.mode === 'marquee') {
        if (!st.moved && dragDistance(ev.screen, st.startScreen) < DRAG_SLOP) return;
        st.moved = true;
        st.rect = normRect(st.start, ev.page);
        const r = st.rect;
        const hits = marqueeHits(editor, r);
        editor.select(st.additive ? [...new Set([...st.base, ...hits])] : hits);
        const a = stage.pageToScreen(r.x, r.y), c = stage.pageToScreen(r.x + r.width, r.y + r.height);
        stage.extraOverlay = `<rect x="${f2(a.x)}" y="${f2(a.y)}" width="${f2(c.x - a.x)}" height="${f2(c.y - a.y)}" class="ov-marquee"/>`;
        stage.invalidate({ overlay: true });
      }
    },

    pointerUp(ev, { editor, stage }, cancelled) {
      const s = st;
      st = null;
      stage.setGuides([]);
      stage.extraOverlay = '';
      stage.invalidate({ overlay: true });
      if (!s) return;
      if (s.mode === 'marquee') return;
      if (cancelled) { editor.preview((pg) => restoreObjects(pg, s.snap)); return; }
      if (!s.moved) return;
      const labels = { move: s.duplicated ? 'Duplicate' : 'Move', resize: 'Resize', rotate: 'Rotate' };
      editor.commit(labels[s.mode]);
    },

    hover(ev, { editor, stage }) {
      const h = hitHandle(stage, ev.screen);
      let cursor = 'default';
      if (h) cursor = h.kind === 'rotate' ? 'grab' : h.handle.cursor;
      else {
        const id = stage.objectIdAt(ev.target);
        const top = id ? editor.topSelectable(id) : null;
        if (top !== stage.hoverId) { stage.hoverId = top; stage.invalidate({ overlay: true }); }
        if (top) cursor = 'move';
      }
      if (cursor !== hoverCursor) { hoverCursor = cursor; stage.setCursor(cursor === 'default' ? null : cursor); }
    },

    dblClick(ev, { editor, stage }) {
      const id = stage.objectIdAt(ev.target);
      if (!id) return;
      const o = editor.get(id);
      if (!o) return;
      if (o.type === 'text') {
        editor.select([o.id]);
        editor.setTool('text');
        stage.tools.get('text').edit(o.id, stage._ctx());
        return;
      }
      const top = editor.topSelectable(id);
      const topObj = editor.get(top);
      if (topObj && topObj.type === 'group') {
        editor.isolateId = topObj.id;
        editor.select([id]);
        return;
      }
      if (['path', 'rectangle', 'roundedRectangle', 'ellipse', 'polygon', 'star', 'arrow', 'line'].includes(o.type)) {
        editor.select([o.id]);
        editor.setTool('direct');
      }
    },

    keyDown(e, { editor, stage }) {
      if (e.key === 'Escape') {
        if (st) { tool.cancel({ editor, stage }); return; }
        if (editor.isolateId) { editor.isolateId = null; editor.emit('selection'); return; }
      }
    },
  };
  return tool;
}

/** Scales a shape's inner geometry (path nodes) when its box changes. */
function scaleBoxContent(o, sx, sy) {
  if (o.type !== 'path') return;
  for (const sp of o.subpaths) {
    for (const n of sp.nodes) {
      n.x *= sx; n.y *= sy; n.ix *= sx; n.iy *= sy; n.ox *= sx; n.oy *= sy;
    }
  }
}

function marqueeHits(editor, r) {
  const page = editor.page;
  const ids = new Set();
  for (const o of page.objects) {
    if (!o.visible || o.locked || o.type === 'rasterLayer') continue;
    if (isEffectivelyHidden(o, editor.idx) || isEffectivelyLocked(o, editor.idx)) continue;
    if (isContainer(o) && o.type === 'group') continue;
    if ((o.parentId || null) !== (editor.isolateId || null) && !o.parentId) { /* top-level still allowed */ }
    if (rectsIntersect(worldBounds(o), r)) ids.add(editor.topSelectable(o.id));
  }
  return [...ids];
}
