import { canvasToBlob } from '../services/asset-store.js';
import { loadImageElement } from '../services/image-service.js';

const MAX_PIXELS = 24e6;

/**
 * Owns the live Canvas 2D surface of every raster paint layer. The committed
 * pixels live in an asset (PNG); the canvas is the working copy while editing.
 * History stores asset ids only, so undo swaps the canvas content back in.
 */
export class RasterManager {
  constructor(editor) {
    this.editor = editor;
    /** layerId -> { canvas, ctx, assetId, loading } */
    this.layers = new Map();
  }

  static pixelScale(w, h) {
    const dpr = Math.min(2, Math.ceil(window.devicePixelRatio || 1));
    let s = dpr;
    while (s > 1 && w * h * s * s > MAX_PIXELS) s--;
    return s;
  }

  /** Returns the cache entry for a layer, (re)loading pixels if its asset changed. */
  entry(o) {
    let e = this.layers.get(o.id);
    const pw = Math.max(1, Math.round(o.width * (o.scale || 1))), ph = Math.max(1, Math.round(o.height * (o.scale || 1)));
    if (!e) {
      const canvas = document.createElement('canvas');
      canvas.width = pw; canvas.height = ph;
      canvas.className = 'raster-canvas';
      e = { canvas, ctx: canvas.getContext('2d', { willReadFrequently: false }), assetId: null, loading: null, painting: false };
      this.layers.set(o.id, e);
      if (o.assetId) this._load(e, o);
      else e.assetId = o.assetId || null;
    } else if (e.assetId !== (o.assetId || null) && !e.painting) {
      this._load(e, o);
    }
    return e;
  }

  async _load(e, o) {
    const target = o.assetId || null;
    e.assetId = target;
    const token = Symbol('load');
    e.loading = token;
    if (!target) {
      e.ctx.clearRect(0, 0, e.canvas.width, e.canvas.height);
      return;
    }
    const url = this.editor.assets.url(target);
    if (!url) return;
    try {
      const img = await loadImageElement(url);
      if (e.loading !== token || e.assetId !== target) return;
      e.canvas.width = img.naturalWidth;
      e.canvas.height = img.naturalHeight;
      e.ctx.clearRect(0, 0, e.canvas.width, e.canvas.height);
      e.ctx.drawImage(img, 0, 0);
    } catch {
      /* leave the canvas as-is; the layer stays usable */
    }
  }

  /** Writes the canvas back into an asset and points the layer at it. */
  async commit(layerId, label = 'Paint') {
    const e = this.layers.get(layerId);
    if (!e) return;
    const blob = await canvasToBlob(e.canvas, 'image/png');
    const id = this.editor.registerAsset(blob, {
      name: 'Paint layer.png', kind: 'raster', width: e.canvas.width, height: e.canvas.height,
    });
    e.assetId = id;
    e.painting = false;
    this.editor.change(label, (page) => {
      const o = page.objects.find((x) => x.id === layerId);
      if (o) o.assetId = id;
    });
  }

  isEmpty(layerId) {
    const e = this.layers.get(layerId);
    if (!e) return true;
    const d = e.ctx.getImageData(0, 0, e.canvas.width, e.canvas.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i]) return false;
    return true;
  }

  forget(id) {
    this.layers.delete(id);
  }

  dispose() {
    this.layers.clear();
  }
}
