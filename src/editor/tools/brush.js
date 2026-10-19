import { createObject, isEffectivelyHidden, isEffectivelyLocked, uniqueName } from '../../core/document-model.js';
import { worldToLocal } from '../../utils/geometry.js';
import { StrokePainter } from '../brush-engine.js';
import { RasterManager } from '../raster.js';
import { f2 } from './tool-utils.js';

/** Brush / pencil / eraser on raster paint layers (Canvas 2D). */
export function createBrushTool(id) {
  const eraser = id === 'eraser';
  let st = null;
  let pointer = null; // screen position for the brush ring

  const layerFor = (editor, stage) => {
    const sel = editor.selectedObjects();
    if (sel.length === 1 && sel[0].type === 'rasterLayer' && !isEffectivelyLocked(sel[0], editor.idx) && !isEffectivelyHidden(sel[0], editor.idx)) {
      editor.activeRasterId = sel[0].id;
      return sel[0];
    }
    const cur = editor.activeRasterId && editor.get(editor.activeRasterId);
    if (cur && cur.type === 'rasterLayer' && !cur.locked && cur.visible) return cur;
    // topmost existing raster layer
    const existing = [...editor.page.objects].reverse().find((o) => o.type === 'rasterLayer' && !o.locked && o.visible);
    if (existing && !eraser) { editor.activeRasterId = existing.id; return existing; }
    if (eraser) return existing || null;
    return createLayer(editor, stage);
  };

  const tool = {
    id,
    cursor: 'none',
    showHandles: false,
    wantsCoalesced: true,

    deactivate({ stage }) { st = null; pointer = null; stage.invalidate({ overlay: true }); },
    cancel({ stage }) { if (st) { abortStroke(st); st = null; stage.invalidate({ overlay: true }); } },

    pointerDown(ev, { editor, stage }) {
      const layer = layerFor(editor, stage);
      if (!layer) { editor.emit('toast', { message: 'Nothing to erase — this page has no paint layer yet.', kind: 'info' }); return; }
      const entry = stage.raster.entry(layer);
      const opts = editor.toolOptions.brush;
      entry.painting = true;
      const base = document.createElement('canvas');
      base.width = entry.canvas.width; base.height = entry.canvas.height;
      base.getContext('2d').drawImage(entry.canvas, 0, 0);
      const stroke = document.createElement('canvas');
      stroke.width = entry.canvas.width; stroke.height = entry.canvas.height;
      const sctx = stroke.getContext('2d');
      const pxScale = entry.canvas.width / layer.width;
      const preset = id === 'pencil' ? 'pencil' : opts.preset;
      const painter = new StrokePainter(sctx, {
        preset, size: opts.size, color: opts.color, smoothing: opts.smoothing, eraser, pxScale,
      });
      st = { layerId: layer.id, entry, base, stroke, painter, opts, eraser, layer, pen: ev.pointerType === 'pen' };
      pointer = ev.screen;
      addPoint(st, ev, editor);
    },

    pointerMove(ev, { editor, stage }) {
      pointer = ev.screen;
      if (st) addPoint(st, ev, editor);
      stage.invalidate({ overlay: true });
    },

    async pointerUp(ev, { editor, stage }, cancelled) {
      const s = st;
      st = null;
      if (!s) return;
      if (cancelled) { abortStroke(s); return; }
      const local = toLayerPx(s, ev.page);
      const r = s.painter.end(local.x, local.y, s.pen ? ev.pressure : null);
      if (r) composite(s, r);
      try {
        await stage.raster.commit(s.layerId, s.eraser ? 'Erase' : 'Paint stroke');
      } catch (err) {
        console.error(err);
        editor.emit('toast', { message: 'That stroke couldn’t be saved.', kind: 'error' });
      }
      stage.invalidate({ overlay: true });
    },

    hover(ev, { stage }) {
      pointer = ev.screen;
      stage.invalidate({ overlay: true });
    },

    keyDown(e, { editor }) {
      if (e.key === 'Escape') editor.setTool('select');
      const b = editor.toolOptions.brush;
      if (e.key === '[') { b.size = Math.max(1, Math.round(b.size * 0.85 - 1)); editor.emit('brush'); e.preventDefault(); }
      if (e.key === ']') { b.size = Math.min(400, Math.round(b.size * 1.18 + 1)); editor.emit('brush'); e.preventDefault(); }
    },

    overlay({ editor, stage }) {
      if (!pointer) return '';
      const r = (editor.toolOptions.brush.size / 2) * stage.zoom;
      return `<circle cx="${f2(pointer.x)}" cy="${f2(pointer.y)}" r="${f2(Math.max(2, r))}" class="ov-brush"/><circle cx="${f2(pointer.x)}" cy="${f2(pointer.y)}" r="1.5" class="ov-brush-dot"/>`;
    },
  };
  return tool;
}

function createLayer(editor, stage) {
  const page = editor.page;
  const scale = RasterManager.pixelScale(page.width, page.height);
  const o = createObject('rasterLayer', {
    name: uniqueName(page, 'Paint layer'), x: 0, y: 0, width: page.width, height: page.height, scale,
  });
  editor.change('Add paint layer', (pg) => { pg.objects.push(o); });
  editor.activeRasterId = o.id;
  stage.flush();
  return editor.get(o.id);
}

function toLayerPx(s, pagePt) {
  const o = s.layer;
  const l = worldToLocal(o, pagePt);
  const k = s.entry.canvas.width / Math.max(1e-6, o.width);
  const ky = s.entry.canvas.height / Math.max(1e-6, o.height);
  return { x: l.x * k, y: l.y * ky };
}

function addPoint(s, ev, editor) {
  const p = toLayerPx(s, ev.page);
  const pressure = s.pen ? ev.pressure : null;
  const r = s.painter.add(p.x, p.y, pressure, ev.raw && ev.raw.timeStamp);
  if (r) composite(s, r);
}

function composite(s, r) {
  const { ctx, canvas } = s.entry;
  const x = Math.max(0, r.x), y = Math.max(0, r.y);
  const w = Math.min(canvas.width - x, r.w), h = Math.min(canvas.height - y, r.h);
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(x, y, w, h);
  ctx.drawImage(s.base, x, y, w, h, x, y, w, h);
  ctx.globalAlpha = s.opts.opacity;
  if (s.eraser) ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(s.stroke, x, y, w, h, x, y, w, h);
  ctx.restore();
}

function abortStroke(s) {
  const { ctx } = s.entry;
  ctx.save();
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(s.base, 0, 0);
  ctx.restore();
  s.entry.painting = false;
}
