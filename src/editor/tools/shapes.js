import { createObject, typeLabel, uniqueName } from '../../core/document-model.js';
import { normRect, snapAngle } from '../../utils/geometry.js';
import { snapPoint } from '../snap.js';
import { DRAG_SLOP, dragDistance, frameAt } from './tool-utils.js';

/** Maps tool ids to the object type they create and any extra props. */
const KINDS = {
  rectangle: { type: 'rectangle' },
  roundedRectangle: { type: 'roundedRectangle' },
  ellipse: { type: 'ellipse' },
  line: { type: 'line' },
  triangle: { type: 'polygon', props: () => ({ sides: 3, name: 'Triangle' }) },
  polygon: { type: 'polygon', props: (ed) => ({ sides: ed.toolOptions.shape.sides }) },
  star: { type: 'star', props: (ed) => ({ points: ed.toolOptions.shape.points, innerRatio: ed.toolOptions.shape.innerRatio }) },
  arrow: { type: 'arrow' },
  frame: { type: 'frame', props: () => ({ name: 'Frame' }) },
};

export const SHAPE_TOOLS = Object.keys(KINDS);

export function createShapeTool(id) {
  const kind = KINDS[id];
  let st = null;

  const build = (editor) => {
    const extra = kind.props ? kind.props(editor) : {};
    return createObject(kind.type, { ...extra });
  };

  return {
    id,
    cursor: 'crosshair',
    showHandles: false,

    deactivate({ stage }) { st = null; stage.setGuides([]); },
    cancel({ editor, stage }) {
      if (st && st.created) editor.preview((page) => { page.objects = page.objects.filter((o) => o.id !== st.obj.id); });
      st = null;
      stage.setGuides([]);
    },

    pointerDown(ev, { editor }) {
      const thr = 6 / editor.viewport.zoom;
      const sp = snapPoint(editor, ev.page, [], thr);
      st = { start: { x: sp.x, y: sp.y }, startScreen: ev.screen, obj: build(editor), created: false };
    },

    pointerMove(ev, { editor, stage }) {
      if (!st) return;
      if (!st.created && dragDistance(ev.screen, st.startScreen) < DRAG_SLOP) return;
      const thr = 6 / editor.viewport.zoom;
      const sp = snapPoint(editor, ev.page, [], thr);
      stage.setGuides(sp.guides);
      let p = { x: sp.x, y: sp.y };
      const s = st.start;
      if (id === 'line' && ev.shift) {
        const ang = snapAngle((Math.atan2(p.y - s.y, p.x - s.x) * 180) / Math.PI, 45) * Math.PI / 180;
        const len = Math.hypot(p.x - s.x, p.y - s.y);
        p = { x: s.x + Math.cos(ang) * len, y: s.y + Math.sin(ang) * len };
      }
      let r;
      if (ev.alt) {
        const dx = p.x - s.x, dy = p.y - s.y;
        r = { x: s.x - Math.abs(dx), y: s.y - Math.abs(dy), width: Math.abs(dx) * 2, height: Math.abs(dy) * 2 };
      } else r = normRect(s, p);
      if (ev.shift && id !== 'line') {
        const side = Math.max(r.width, r.height);
        if (ev.alt) r = { x: s.x - side / 2, y: s.y - side / 2, width: side, height: side };
        else {
          r = { x: p.x < s.x ? s.x - side : s.x, y: p.y < s.y ? s.y - side : s.y, width: side, height: side };
        }
      }
      const obj = st.obj;
      obj.x = r.x; obj.y = r.y; obj.width = Math.max(id === 'line' ? 0 : 1, r.width); obj.height = Math.max(id === 'line' ? 0 : 1, r.height);
      if (id === 'line') obj.dir = (p.x - s.x) * (p.y - s.y) >= 0 ? 'down' : 'up';
      editor.preview((page) => {
        if (!st.created) {
          obj.name = uniqueName(page, obj.name);
          obj.parentId = editor.isolateId || frameAt(editor, st.start, obj.id) || null;
          page.objects.push(obj);
          st.created = true;
        } else {
          const live = page.objects.find((o) => o.id === obj.id);
          if (live) Object.assign(live, { x: obj.x, y: obj.y, width: obj.width, height: obj.height, dir: obj.dir });
        }
      });
    },

    pointerUp(ev, { editor, stage }, cancelled) {
      const s = st;
      st = null;
      stage.setGuides([]);
      if (!s) return;
      if (cancelled) { editor.preview((page) => { page.objects = page.objects.filter((o) => o.id !== s.obj.id); }); return; }
      if (!s.created) {
        // a simple click drops a default-sized shape centred on the pointer
        const size = id === 'line' ? 240 : 200;
        const obj = s.obj;
        obj.width = id === 'line' ? size : size; obj.height = id === 'line' ? 0 : id === 'arrow' ? 120 : size;
        obj.x = s.start.x - obj.width / 2; obj.y = s.start.y - obj.height / 2;
        editor.change(`Add ${typeLabel(obj.type).toLowerCase()}`, (page) => {
          obj.name = uniqueName(page, obj.name);
          obj.parentId = editor.isolateId || frameAt(editor, s.start, obj.id) || null;
          page.objects.push(obj);
        });
        editor.select([obj.id]);
      } else {
        editor.commit(`Add ${typeLabel(s.obj.type).toLowerCase()}`);
        editor.select([s.obj.id]);
      }
      editor.setTool('select');
    },

    keyDown(e, { editor, stage }) {
      if (e.key === 'Escape') {
        if (st) this.cancel({ editor, stage }); else editor.setTool('select');
      }
    },
  };
}
