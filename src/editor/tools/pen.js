import { ACCENT, noPaint, pathData, pathFromSubpaths, solid, uniqueName } from '../../core/document-model.js';
import { snapPoint } from '../snap.js';
import { DRAG_SLOP, dragDistance, f2 } from './tool-utils.js';

/** Screen-space path data for a list of in-progress nodes. */
function screenPath(stage, nodes, closed, extraTo) {
  const z = stage.zoom;
  const sn = nodes.map((n) => {
    const p = stage.pageToScreen(n.x, n.y);
    return { x: p.x, y: p.y, ix: n.ix * z, iy: n.iy * z, ox: n.ox * z, oy: n.oy * z };
  });
  let d = pathData([{ closed, nodes: sn }]);
  if (extraTo && sn.length) {
    const a = sn[sn.length - 1];
    const q = stage.pageToScreen(extraTo.x, extraTo.y);
    d += `M${f2(a.x)} ${f2(a.y)}C${f2(a.x + a.ox)} ${f2(a.y + a.oy)} ${f2(q.x)} ${f2(q.y)} ${f2(q.x)} ${f2(q.y)}`;
  }
  return d;
}

export function createPenTool() {
  let b = null; // { nodes: [], closed }
  let drag = null; // { index, startScreen, moved }
  let hover = null; // page point
  let nearFirst = false;

  const reset = (stage) => { b = null; drag = null; hover = null; nearFirst = false; if (stage) { stage.setGuides([]); stage.invalidate({ overlay: true }); } };

  const finish = (editor, stage, closed) => {
    if (!b || b.nodes.length < 2) { reset(stage); return false; }
    const sp = { closed, nodes: b.nodes.map((n) => ({ ...n })) };
    const page = editor.page;
    const obj = pathFromSubpaths([sp], {
      name: uniqueName(page, 'Path'),
      fill: closed ? solid(ACCENT) : noPaint(ACCENT),
    });
    reset(stage);
    editor.addObjects([obj], { label: closed ? 'Draw closed path' : 'Draw path' });
    return true;
  };

  const isNearFirst = (stage, p) => {
    if (!b || b.nodes.length < 2) return false;
    const a = stage.pageToScreen(b.nodes[0].x, b.nodes[0].y);
    const q = stage.pageToScreen(p.x, p.y);
    return Math.hypot(a.x - q.x, a.y - q.y) < 10;
  };

  return {
    id: 'pen',
    cursor: 'crosshair',
    showHandles: false,

    deactivate({ editor, stage }) {
      if (b && b.nodes.length >= 2) finish(editor, stage, false); else reset(stage);
    },
    cancel({ stage }) { reset(stage); },

    pointerDown(ev, { editor, stage }) {
      if (!b) b = { nodes: [], closed: false };
      const thr = 6 / editor.viewport.zoom;
      if (isNearFirst(stage, ev.page)) {
        finish(editor, stage, true);
        return;
      }
      const sp = ev.mod ? { x: ev.page.x, y: ev.page.y, guides: [] } : snapPoint(editor, ev.page, [], thr);
      b.nodes.push({ x: sp.x, y: sp.y, ix: 0, iy: 0, ox: 0, oy: 0, mode: 'corner' });
      drag = { index: b.nodes.length - 1, startScreen: ev.screen, moved: false };
      stage.invalidate({ overlay: true });
    },

    pointerMove(ev, { editor, stage }) {
      if (!b || !drag) return;
      if (!drag.moved && dragDistance(ev.screen, drag.startScreen) < DRAG_SLOP) return;
      drag.moved = true;
      const n = b.nodes[drag.index];
      const ox = ev.page.x - n.x, oy = ev.page.y - n.y;
      n.ox = ox; n.oy = oy;
      if (ev.alt) {
        n.mode = 'corner';
        if (!n._altInit) { n.ix = 0; n.iy = 0; n._altInit = true; }
      } else { n.ix = -ox; n.iy = -oy; n.mode = 'smooth'; }
      stage.invalidate({ overlay: true });
    },

    pointerUp() {
      if (drag && b && b.nodes[drag.index]) delete b.nodes[drag.index]._altInit;
      drag = null;
    },

    hover(ev, { editor, stage }) {
      if (!b) { stage.setGuides([]); return; }
      const thr = 6 / editor.viewport.zoom;
      const sp = ev.mod ? { x: ev.page.x, y: ev.page.y, guides: [] } : snapPoint(editor, ev.page, [], thr);
      hover = { x: sp.x, y: sp.y };
      nearFirst = isNearFirst(stage, ev.page);
      stage.setGuides(sp.guides);
      stage.invalidate({ overlay: true });
    },

    keyDown(e, { editor, stage }) {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(editor, stage, false);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (b && b.nodes.length >= 2) finish(editor, stage, false);
        else if (b) reset(stage);
        else editor.setTool('select');
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && b) {
        e.preventDefault();
        b.nodes.pop();
        if (!b.nodes.length) reset(stage); else stage.invalidate({ overlay: true });
      }
    },

    overlay({ stage }) {
      if (!b) return '';
      const out = [];
      const d = screenPath(stage, b.nodes, false, hover && !drag ? hover : null);
      out.push(`<path d="${d}" class="ov-pen-path"/>`);
      const z = stage.zoom;
      b.nodes.forEach((n, i) => {
        const p = stage.pageToScreen(n.x, n.y);
        if (n.ox || n.oy) {
          out.push(`<line x1="${f2(p.x + n.ix * z)}" y1="${f2(p.y + n.iy * z)}" x2="${f2(p.x + n.ox * z)}" y2="${f2(p.y + n.oy * z)}" class="ov-hline"/>`);
          out.push(`<circle cx="${f2(p.x + n.ox * z)}" cy="${f2(p.y + n.oy * z)}" r="3.5" class="ov-hdot"/>`);
          out.push(`<circle cx="${f2(p.x + n.ix * z)}" cy="${f2(p.y + n.iy * z)}" r="3.5" class="ov-hdot"/>`);
        }
        const first = i === 0;
        out.push(`<rect x="${f2(p.x - (first && nearFirst ? 6 : 4))}" y="${f2(p.y - (first && nearFirst ? 6 : 4))}" width="${first && nearFirst ? 12 : 8}" height="${first && nearFirst ? 12 : 8}" class="ov-node${i === b.nodes.length - 1 ? ' sel' : ''}${first && nearFirst ? ' close' : ''}"/>`);
      });
      return out.join('');
    },
  };
}
