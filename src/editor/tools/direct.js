import { normalizePath, pathData, subpathsToWorld, shapeToSubpaths, isContainer } from '../../core/document-model.js';
import { nearestOnCubic, normRect, DEG } from '../../utils/geometry.js';
import { captureObjects, restoreObjects, DRAG_SLOP, dragDistance, f2 } from './tool-utils.js';
import { insertNode, removeNodes, segmentCount, toggleNodeMode } from '../path-ops.js';
import { segmentPointsFor } from '../path-geometry.js';

const HIT = 8;

/**
 * Direct selection: edit individual nodes and Bézier handles of paths.
 * Basic shapes are converted to editable paths the first time a node is changed.
 */
export function createDirectTool() {
  let sel = new Set(); // "sp:idx"
  let selObj = null;
  let st = null;

  const target = (editor) => {
    if (editor.selection.length !== 1) return null;
    const o = editor.get(editor.selection[0]);
    if (!o || isContainer(o) || !['path', 'rectangle', 'roundedRectangle', 'ellipse', 'line', 'polygon', 'star', 'arrow'].includes(o.type)) return null;
    if (selObj !== o.id) { sel = new Set(); selObj = o.id; }
    return o;
  };

  const worldNodes = (o) => subpathsToWorld(o);

  const toLocalDelta = (o, dx, dy) => {
    const r = -(o.rotation || 0) * DEG;
    return { x: dx * Math.cos(r) - dy * Math.sin(r), y: dx * Math.sin(r) + dy * Math.cos(r) };
  };

  const hitNodes = (stage, o, p) => {
    const wn = worldNodes(o);
    for (let si = 0; si < wn.length; si++) {
      for (let ni = 0; ni < wn[si].nodes.length; ni++) {
        const n = wn[si].nodes[ni];
        const s = stage.pageToScreen(n.x, n.y);
        if (Math.abs(s.x - p.x) <= HIT && Math.abs(s.y - p.y) <= HIT) return { si, ni, key: `${si}:${ni}` };
      }
    }
    return null;
  };

  const hitHandles = (stage, o, p) => {
    const z = stage.zoom;
    const wn = worldNodes(o);
    for (const key of sel) {
      const [si, ni] = key.split(':').map(Number);
      const n = wn[si] && wn[si].nodes[ni];
      if (!n) continue;
      const s = stage.pageToScreen(n.x, n.y);
      if ((n.ox || n.oy) && Math.hypot(s.x + n.ox * z - p.x, s.y + n.oy * z - p.y) <= HIT) return { si, ni, which: 'out' };
      if ((n.ix || n.iy) && Math.hypot(s.x + n.ix * z - p.x, s.y + n.iy * z - p.y) <= HIT) return { si, ni, which: 'in' };
    }
    return null;
  };

  const hitSegment = (stage, editor, o, screenP) => {
    const pg = stage.screenToPage(screenP.x, screenP.y);
    const local = (() => {
      const r = -(o.rotation || 0) * DEG;
      const cx = o.x + o.width / 2, cy = o.y + o.height / 2;
      const dx = pg.x - cx, dy = pg.y - cy;
      return { x: dx * Math.cos(r) - dy * Math.sin(r) + o.width / 2, y: dx * Math.sin(r) + dy * Math.cos(r) + o.height / 2 };
    })();
    const subs = shapeToSubpaths(o);
    const thr = 8 / stage.zoom;
    let best = null;
    subs.forEach((sp, si) => {
      for (let i = 0; i < segmentCount(sp); i++) {
        const [p0, p1, p2, p3] = segmentPointsFor(sp.nodes[i], sp.nodes[(i + 1) % sp.nodes.length]);
        const r = nearestOnCubic(p0, p1, p2, p3, local);
        if (r.d <= thr && (!best || r.d < best.d)) best = { si, seg: i, t: r.t, d: r.d };
      }
    });
    return best;
  };

  const ensurePath = (editor, id) => {
    const o = editor.get(id);
    if (o && o.type !== 'path') editor.preview(() => editor.convertToPath(id, { record: false }));
  };

  const finishEdit = (editor, id, label) => {
    editor.preview((page) => {
      const o = page.objects.find((x) => x.id === id);
      if (o && o.type === 'path') normalizePath(o);
    });
    editor.commit(label);
  };

  const tool = {
    id: 'direct',
    cursor: 'default',
    showSelection: false,

    activate({ editor }) { selObj = null; sel = new Set(); target(editor); },
    deactivate({ stage }) { st = null; sel = new Set(); stage.extraOverlay = ''; },
    cancel({ editor }) {
      if (st && st.snap) editor.preview((page) => restoreObjects(page, st.snap));
      st = null;
    },

    pointerDown(ev, { editor, stage }) {
      const o = target(editor);
      if (o) {
        const h = hitHandles(stage, o, ev.screen);
        if (h) {
          ensurePath(editor, o.id);
          st = { mode: 'handle', ...h, id: o.id, snap: captureObjects(editor.page, [o.id]), moved: false };
          return;
        }
        const nh = hitNodes(stage, o, ev.screen);
        if (nh) {
          if (ev.shift) { if (sel.has(nh.key)) sel.delete(nh.key); else sel.add(nh.key); } else if (!sel.has(nh.key)) sel = new Set([nh.key]);
          st = { mode: 'node', id: o.id, start: ev.page, startScreen: ev.screen, snap: null, moved: false, converted: false };
          stage.invalidate({ overlay: true });
          editor.emit('nodes');
          return;
        }
      }
      const hitId = stage.objectIdAt(ev.target);
      if (hitId) {
        const picked = editor.get(hitId);
        if (picked && (!o || picked.id !== o.id)) { editor.select([picked.id]); sel = new Set(); selObj = null; target(editor); editor.emit('nodes'); stage.invalidate({ overlay: true }); }
        else if (!ev.shift) { sel = new Set(); editor.emit('nodes'); }
        st = null;
        return;
      }
      if (!ev.shift) { sel = new Set(); editor.emit('nodes'); }
      st = { mode: 'marquee', start: ev.page, startScreen: ev.screen, base: new Set(sel), moved: false, additive: ev.shift };
      if (!o) editor.clearSelection();
      stage.invalidate({ overlay: true });
    },

    pointerMove(ev, { editor, stage }) {
      if (!st) return;
      const o = editor.get(st.id || selObj);
      if (st.mode === 'node') {
        if (!st.moved && dragDistance(ev.screen, st.startScreen) < DRAG_SLOP) return;
        if (!st.converted) {
          ensurePath(editor, st.id);
          st.snap = captureObjects(editor.page, [st.id]);
          st.converted = true;
        }
        st.moved = true;
        const dx = ev.page.x - st.start.x, dy = ev.page.y - st.start.y;
        editor.preview((page) => {
          restoreObjects(page, st.snap);
          const live = page.objects.find((x) => x.id === st.id);
          const dl = toLocalDelta(live, dx, dy);
          for (const key of sel) {
            const [si, ni] = key.split(':').map(Number);
            const n = live.subpaths[si] && live.subpaths[si].nodes[ni];
            if (n) { n.x += dl.x; n.y += dl.y; }
          }
        });
        return;
      }
      if (st.mode === 'handle' && o) {
        st.moved = true;
        const live0 = o;
        const r = -(live0.rotation || 0) * DEG;
        const cx = live0.x + live0.width / 2, cy = live0.y + live0.height / 2;
        const dx = ev.page.x - cx, dy = ev.page.y - cy;
        const lx = dx * Math.cos(r) - dy * Math.sin(r) + live0.width / 2;
        const ly = dx * Math.sin(r) + dy * Math.cos(r) + live0.height / 2;
        editor.preview((page) => {
          const live = page.objects.find((x) => x.id === st.id);
          const n = live.subpaths[st.si].nodes[st.ni];
          const vx = lx - n.x, vy = ly - n.y;
          if (st.which === 'out') {
            n.ox = vx; n.oy = vy;
            if (ev.alt) n.mode = 'corner';
            else if (n.mode === 'smooth') {
              const len = Math.hypot(n.ix, n.iy), vl = Math.hypot(vx, vy) || 1;
              n.ix = -vx / vl * len; n.iy = -vy / vl * len;
            }
          } else {
            n.ix = vx; n.iy = vy;
            if (ev.alt) n.mode = 'corner';
            else if (n.mode === 'smooth') {
              const len = Math.hypot(n.ox, n.oy), vl = Math.hypot(vx, vy) || 1;
              n.ox = -vx / vl * len; n.oy = -vy / vl * len;
            }
          }
        });
        return;
      }
      if (st.mode === 'marquee') {
        if (!st.moved && dragDistance(ev.screen, st.startScreen) < DRAG_SLOP) return;
        st.moved = true;
        const r = normRect(st.start, ev.page);
        const ob = editor.get(selObj);
        if (ob) {
          const next = new Set(st.additive ? st.base : []);
          worldNodes(ob).forEach((sp, si) => sp.nodes.forEach((n, ni) => {
            if (n.x >= r.x && n.x <= r.x + r.width && n.y >= r.y && n.y <= r.y + r.height) next.add(`${si}:${ni}`);
          }));
          sel = next;
          editor.emit('nodes');
        }
        const a = stage.pageToScreen(r.x, r.y), c = stage.pageToScreen(r.x + r.width, r.y + r.height);
        stage.extraOverlay = `<rect x="${f2(a.x)}" y="${f2(a.y)}" width="${f2(c.x - a.x)}" height="${f2(c.y - a.y)}" class="ov-marquee"/>`;
        stage.invalidate({ overlay: true });
      }
    },

    pointerUp(ev, { editor, stage }, cancelled) {
      const s = st;
      st = null;
      stage.extraOverlay = '';
      stage.invalidate({ overlay: true });
      if (!s) return;
      if (cancelled && s.snap) { editor.preview((page) => restoreObjects(page, s.snap)); return; }
      if ((s.mode === 'node' || s.mode === 'handle') && s.moved) finishEdit(editor, s.id, s.mode === 'node' ? 'Move nodes' : 'Adjust curve');
    },

    hover(ev, { editor, stage }) {
      const o = target(editor);
      let c = 'default';
      if (o) {
        if (hitHandles(stage, o, ev.screen) || hitNodes(stage, o, ev.screen)) c = 'pointer';
      }
      stage.setCursor(c === 'default' ? null : c);
    },

    dblClick(ev, { editor, stage }) {
      const o = target(editor);
      if (!o) return;
      const nh = hitNodes(stage, o, ev.screen);
      if (nh) {
        ensurePath(editor, o.id);
        editor.preview((page) => {
          const live = page.objects.find((x) => x.id === o.id);
          toggleNodeMode(live.subpaths[nh.si], nh.ni);
        });
        finishEdit(editor, o.id, 'Change node type');
        return;
      }
      const sg = hitSegment(stage, editor, o, ev.screen);
      if (sg) {
        ensurePath(editor, o.id);
        let idx = 0;
        editor.preview((page) => {
          const live = page.objects.find((x) => x.id === o.id);
          idx = insertNode(live.subpaths[sg.si], sg.seg, sg.t);
        });
        sel = new Set([`${sg.si}:${idx}`]);
        finishEdit(editor, o.id, 'Add node');
        editor.emit('nodes');
      }
    },

    keyDown(e, { editor, stage }) {
      const o = target(editor);
      if (e.key === 'Escape') {
        e.preventDefault();
        if (st) { tool.cancel({ editor }); return; }
        if (sel.size) { sel = new Set(); editor.emit('nodes'); stage.invalidate({ overlay: true }); } else editor.setTool('select');
        return;
      }
      if (!o) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) {
        e.preventDefault();
        ensurePath(editor, o.id);
        const keys = new Set(sel);
        sel = new Set();
        editor.preview((page) => {
          const live = page.objects.find((x) => x.id === o.id);
          live.subpaths = removeNodes(live.subpaths, keys);
        });
        const live = editor.get(o.id);
        if (!live.subpaths.length) { editor.deleteSelection(); return; }
        finishEdit(editor, o.id, 'Delete nodes');
        editor.emit('nodes');
        return;
      }
      if (e.key.startsWith('Arrow') && sel.size) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        ensurePath(editor, o.id);
        editor.preview((page) => {
          const live = page.objects.find((x) => x.id === o.id);
          const dl = toLocalDelta(live, dx, dy);
          for (const key of sel) {
            const [si, ni] = key.split(':').map(Number);
            const n = live.subpaths[si] && live.subpaths[si].nodes[ni];
            if (n) { n.x += dl.x; n.y += dl.y; }
          }
        });
        editor.change('Nudge nodes', (page) => { const live = page.objects.find((x) => x.id === o.id); normalizePath(live); }, { key: `nodenudge:${o.id}` });
      }
    },

    /** API used by the inspector. */
    selectedNodes() { return [...sel]; },
    clearNodes() { sel = new Set(); },
    selectAllNodes(editor) {
      const o = target(editor);
      if (!o) return;
      sel = new Set();
      shapeToSubpaths(o).forEach((sp, si) => sp.nodes.forEach((_, ni) => sel.add(`${si}:${ni}`)));
    },

    overlay({ editor, stage }) {
      const o = target(editor);
      if (!o) return '';
      const z = stage.zoom;
      const wn = worldNodes(o);
      const out = [];
      const sn = wn.map((sp) => ({
        closed: sp.closed,
        nodes: sp.nodes.map((n) => {
          const p = stage.pageToScreen(n.x, n.y);
          return { x: p.x, y: p.y, ix: n.ix * z, iy: n.iy * z, ox: n.ox * z, oy: n.oy * z };
        }),
      }));
      out.push(`<path d="${pathData(sn)}" class="ov-path-outline"/>`);
      wn.forEach((sp, si) => sp.nodes.forEach((n, ni) => {
        const p = stage.pageToScreen(n.x, n.y);
        const selected = sel.has(`${si}:${ni}`);
        if (selected) {
          if (n.ox || n.oy) {
            out.push(`<line x1="${f2(p.x)}" y1="${f2(p.y)}" x2="${f2(p.x + n.ox * z)}" y2="${f2(p.y + n.oy * z)}" class="ov-hline"/><circle cx="${f2(p.x + n.ox * z)}" cy="${f2(p.y + n.oy * z)}" r="4" class="ov-hdot"/>`);
          }
          if (n.ix || n.iy) {
            out.push(`<line x1="${f2(p.x)}" y1="${f2(p.y)}" x2="${f2(p.x + n.ix * z)}" y2="${f2(p.y + n.iy * z)}" class="ov-hline"/><circle cx="${f2(p.x + n.ix * z)}" cy="${f2(p.y + n.iy * z)}" r="4" class="ov-hdot"/>`);
          }
        }
        const smooth = n.mode === 'smooth';
        out.push(smooth
          ? `<circle cx="${f2(p.x)}" cy="${f2(p.y)}" r="5" class="ov-node${selected ? ' sel' : ''}"/>`
          : `<rect x="${f2(p.x - 4.5)}" y="${f2(p.y - 4.5)}" width="9" height="9" class="ov-node${selected ? ' sel' : ''}"/>`);
      }));
      return out.join('');
    },
  };
  return tool;
}
