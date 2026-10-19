import { isContainer, gradientFromPreset } from '../../core/document-model.js';
import { worldToLocal, localToWorld } from '../../utils/geometry.js';
import { f2 } from './tool-utils.js';

/**
 * Gradient tool: drag on a selected shape to create a gradient; drag the on-canvas
 * handles to change its direction/radius. Stops are edited in the inspector.
 */
export function createGradientTool() {
  let st = null;

  const target = (editor) => {
    if (editor.selection.length !== 1) return null;
    const o = editor.get(editor.selection[0]);
    if (!o || isContainer(o) && o.type === 'group') return null;
    return o;
  };
  const kindKey = (editor) => (editor.toolOptions.fillTarget === 'stroke' ? 'stroke' : 'fill');

  const toLocalN = (o, p) => {
    const l = worldToLocal(o, p);
    return { x: l.x / Math.max(1, o.width), y: l.y / Math.max(1, o.height) };
  };
  const toScreen = (stage, o, nx, ny) => {
    const w = localToWorld(o, { x: nx * o.width, y: ny * o.height });
    return stage.pageToScreen(w.x, w.y);
  };

  const tool = {
    id: 'gradient',
    cursor: 'crosshair',
    showHandles: false,

    deactivate() { st = null; },
    cancel() { st = null; },

    pointerDown(ev, { editor, stage }) {
      let o = target(editor);
      const key = kindKey(editor);
      if (o) {
        const p = o[key];
        if (p.type === 'linear' || p.type === 'radial') {
          const pts = p.type === 'linear'
            ? [['p1', toScreen(stage, o, p.x1, p.y1)], ['p2', toScreen(stage, o, p.x2, p.y2)]]
            : [['c', toScreen(stage, o, p.cx, p.cy)], ['r', toScreen(stage, o, p.cx + p.r * Math.max(o.width, o.height) / Math.max(1, o.width), p.cy)]];
          for (const [name, s] of pts) {
            if (Math.hypot(s.x - ev.screen.x, s.y - ev.screen.y) <= 9) { st = { mode: 'handle', which: name, id: o.id, moved: false }; return; }
          }
        }
      }
      const hitId = stage.objectIdAt(ev.target);
      if (hitId && (!o || !stageHits(stage, ev, o))) {
        editor.select([editor.topSelectable(hitId)]);
        o = target(editor);
        if (!o) return;
      }
      if (!o) return;
      st = { mode: 'create', id: o.id, start: ev.page, moved: false, key };
    },

    pointerMove(ev, { editor }) {
      if (!st) return;
      const o = editor.get(st.id);
      if (!o) return;
      const key = kindKey(editor);
      if (st.mode === 'create') {
        if (Math.hypot(ev.page.x - st.start.x, ev.page.y - st.start.y) < 3 / editor.viewport.zoom) return;
        st.moved = true;
        const a = toLocalN(o, st.start), b = toLocalN(o, ev.page);
        editor.preview((page) => {
          const live = page.objects.find((x) => x.id === st.id);
          const cur = live[key];
          if (cur.type !== 'linear' && cur.type !== 'radial') {
            const base = cur.type === 'none' ? '#3b5bdb' : cur.color;
            const preset = { name: 'Custom', stops: [[base, 0], ['#ffffff', 1]] };
            live[key] = { ...live[key], ...gradientFromPreset(preset, editor.toolOptions.gradientKind) };
          }
          const g = live[key];
          if (g.type === 'linear') { g.x1 = a.x; g.y1 = a.y; g.x2 = b.x; g.y2 = b.y; } else {
            g.cx = a.x; g.cy = a.y;
            g.r = Math.hypot((b.x - a.x) * live.width, (b.y - a.y) * live.height) / Math.max(live.width, live.height, 1);
          }
        });
        return;
      }
      if (st.mode === 'handle') {
        st.moved = true;
        const n = toLocalN(o, ev.page);
        editor.preview((page) => {
          const g = page.objects.find((x) => x.id === st.id)[key];
          if (st.which === 'p1') { g.x1 = n.x; g.y1 = n.y; } else if (st.which === 'p2') { g.x2 = n.x; g.y2 = n.y; } else if (st.which === 'c') { g.cx = n.x; g.cy = n.y; } else {
            const live = page.objects.find((x) => x.id === st.id);
            g.r = Math.hypot((n.x - g.cx) * live.width, (n.y - g.cy) * live.height) / Math.max(live.width, live.height, 1);
          }
        });
      }
    },

    pointerUp(ev, { editor }) {
      const s = st;
      st = null;
      if (s && s.moved) editor.commit('Edit gradient');
    },

    keyDown(e, { editor }) {
      if (e.key === 'Escape') editor.setTool('select');
    },

    overlay({ editor, stage }) {
      const o = target(editor);
      if (!o) return '';
      const p = o[kindKey(editor)];
      if (p.type === 'linear') {
        const a = toScreen(stage, o, p.x1, p.y1), b = toScreen(stage, o, p.x2, p.y2);
        return `<line x1="${f2(a.x)}" y1="${f2(a.y)}" x2="${f2(b.x)}" y2="${f2(b.y)}" class="ov-grad-line"/><circle cx="${f2(a.x)}" cy="${f2(a.y)}" r="6" class="ov-grad-dot start"/><circle cx="${f2(b.x)}" cy="${f2(b.y)}" r="6" class="ov-grad-dot"/>`;
      }
      if (p.type === 'radial') {
        const c = toScreen(stage, o, p.cx, p.cy);
        const e = toScreen(stage, o, p.cx + (p.r * Math.max(o.width, o.height)) / Math.max(1, o.width), p.cy);
        return `<line x1="${f2(c.x)}" y1="${f2(c.y)}" x2="${f2(e.x)}" y2="${f2(e.y)}" class="ov-grad-line"/><circle cx="${f2(c.x)}" cy="${f2(c.y)}" r="6" class="ov-grad-dot start"/><circle cx="${f2(e.x)}" cy="${f2(e.y)}" r="6" class="ov-grad-dot"/>`;
      }
      return '';
    },
  };
  return tool;
}

function stageHits(stage, ev, o) {
  const id = stage.objectIdAt(ev.target);
  return id === o.id;
}
