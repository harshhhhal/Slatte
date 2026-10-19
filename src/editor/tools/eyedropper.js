import { buildPageSvg, pageFontFamilies } from '../../core/renderer.js';
import { fonts } from '../../services/font-service.js';
import { blobToDataUrl } from '../../services/asset-store.js';
import { loadImageElement } from '../../services/image-service.js';
import { hexToRgb, rgbToHex, formatRgb } from '../../utils/color.js';
import { f2 } from './tool-utils.js';

/**
 * Samples a colour from the *rendered* page (not the editor UI). The page is
 * rasterised once per document revision; if pixel access is blocked we fall back
 * to the fill colour of the object under the pointer.
 */
export function createEyedropperTool() {
  let cache = null; // { rev, pageId, canvas, scale }
  let hoverSample = null;
  let building = null;

  const rasterize = async (editor) => {
    const key = `${editor.rev}:${editor.page.id}`;
    if (cache && cache.key === key) return cache;
    if (building && building.key === key) return building.promise;
    const promise = (async () => {
      const page = editor.page;
      const doc = editor.doc;
      const ids = new Set();
      for (const o of page.objects) if (o.assetId) ids.add(o.assetId);
      const urls = new Map();
      for (const id of ids) urls.set(id, await blobToDataUrl(editor.assets.get(id) || new Blob()).catch(() => null));
      const { css } = await fonts.embedCss(pageFontFamilies(page), doc, editor.assets).catch(() => ({ css: '' }));
      const { svg } = buildPageSvg(doc, page, { resolve: (id) => urls.get(id) || null, fontCss: css });
      const scale = Math.min(1, 2400 / Math.max(page.width, page.height));
      const img = await loadImageElement(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(page.width * scale));
      canvas.height = Math.max(1, Math.round(page.height * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (page.background.transparent) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      cache = { key, canvas, ctx, scale };
      return cache;
    })();
    building = { key, promise };
    try { return await promise; } finally { building = null; }
  };

  const sample = async (editor, page) => {
    const p = editor.page;
    if (page.x < 0 || page.y < 0 || page.x > p.width || page.y > p.height) return null;
    try {
      const c = await rasterize(editor);
      const d = c.ctx.getImageData(Math.floor(page.x * c.scale), Math.floor(page.y * c.scale), 1, 1).data;
      return rgbToHex(d[0], d[1], d[2]);
    } catch {
      return null;
    }
  };

  const apply = (editor, hex, target) => {
    editor.rememberColor(hex);
    const ids = editor.editableIds();
    editor.toolOptions.sampled = hex;
    editor.emit('sample', hex);
    if (ids.length) {
      editor.setProp(`${target}.color`, hex, { label: `Set ${target} colour` });
      editor.setProp(`${target}.type`, 'solid', { label: `Set ${target} colour` });
    }
    editor.emit('toast', { message: `Sampled ${hex.toUpperCase()} · ${formatRgb(hex)}`, kind: 'success' });
  };

  return {
    id: 'eyedropper',
    cursor: 'crosshair',
    showHandles: false,

    activate({ editor }) { rasterize(editor).catch(() => {}); },
    deactivate({ stage }) { hoverSample = null; stage.extraOverlay = ''; },

    async pointerDown(ev, { editor, stage }) {
      const target = ev.alt || ev.shift ? 'stroke' : editor.toolOptions.fillTarget === 'stroke' ? 'stroke' : 'fill';
      let hex = await sample(editor, ev.page);
      if (!hex) {
        const id = stage.objectIdAt(ev.target);
        const o = id && editor.get(id);
        if (o && o.fill && o.fill.type === 'solid') hex = o.fill.color;
        else if (o && o.stroke && o.stroke.type === 'solid') hex = o.stroke.color;
        if (hex) editor.emit('toast', { message: 'Pixel sampling isn’t available here; used the object’s colour instead.', kind: 'warning' });
      }
      if (!hex) { editor.emit('toast', { message: 'Click inside the page to sample a colour.', kind: 'info' }); return; }
      apply(editor, hex, target);
    },

    async hover(ev, { editor, stage }) {
      const hex = await sample(editor, ev.page);
      if (hex === (hoverSample && hoverSample.hex) && hoverSample && Math.abs(hoverSample.x - ev.screen.x) < 1) return;
      hoverSample = hex ? { hex, x: ev.screen.x, y: ev.screen.y } : null;
      stage.invalidate({ overlay: true });
    },

    overlay() {
      if (!hoverSample) return '';
      const { hex, x, y } = hoverSample;
      const { r, g, b } = hexToRgb(hex);
      return `<g transform="translate(${f2(x + 16)} ${f2(y + 16)})"><rect width="124" height="38" rx="6" class="ov-chip"/><rect x="6" y="6" width="26" height="26" rx="4" fill="${hex}" stroke="rgba(0,0,0,.25)"/><text x="40" y="17" class="ov-chip-text">${hex.toUpperCase()}</text><text x="40" y="30" class="ov-chip-sub">rgb(${r}, ${g}, ${b})</text></g>`;
    },

    keyDown(e, { editor }) { if (e.key === 'Escape') editor.setTool('select'); },
  };
}
