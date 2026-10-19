import { buildPageSvg, pageFontFamilies } from '../core/renderer.js';
import { fonts } from './font-service.js';
import { blobToDataUrl, canvasToBlob } from './asset-store.js';
import { loadImageElement } from './image-service.js';
import { UserError } from '../utils/errors.js';

const MAX_SIDE = 16384;
const MAX_AREA = 120e6;

/**
 * Renders a page to a self-contained SVG string (images and fonts embedded).
 * Returns warnings that describe anything that may look different elsewhere.
 */
export async function renderPageSvg(doc, page, assets, { transparent = false, embedFonts = true } = {}) {
  const warnings = [];
  const urls = new Map();
  for (const o of page.objects) {
    if (o.visible && (o.type === 'image' || o.type === 'rasterLayer') && o.assetId && !urls.has(o.assetId)) {
      const blob = assets.get(o.assetId);
      if (blob) urls.set(o.assetId, await blobToDataUrl(blob));
      else warnings.push(`“${o.name}” is missing its image and was drawn as a placeholder.`);
    }
  }
  let fontCss = '';
  if (embedFonts) {
    const res = await fonts.embedCss(pageFontFamilies(page), doc, assets);
    fontCss = res.css;
    if (res.missing.length) warnings.push(`Couldn’t embed ${res.missing.join(', ')}; text may fall back to a system font in the exported file.`);
  }
  const p = transparent ? { ...page, background: { ...page.background, transparent: true } } : page;
  const out = buildPageSvg(doc, p, { resolve: (id) => urls.get(id) || null, fontCss });
  if (page.objects.some((o) => o.visible && (o.effects.shadow.on || o.effects.blur.on))) {
    warnings.push('Shadows and blurs use SVG filters; some design apps rasterize them when opening an SVG.');
  }
  if (page.objects.some((o) => o.visible && o.blendMode !== 'normal')) {
    warnings.push('Blend modes use CSS mix-blend-mode in SVG; browsers show them, but many non-browser tools ignore them.');
  }
  if (page.objects.some((o) => o.visible && o.type === 'rasterLayer')) {
    warnings.push('Paint layers are embedded as raster images.');
  }
  const svg = out.svg;
  validateSvg(svg);
  return { svg, warnings };
}

export function validateSvg(svg) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new UserError('The generated SVG was not valid.', 'Please report this project so it can be fixed.');
  if (doc.querySelector('script, foreignObject')) throw new UserError('The SVG contained disallowed elements and was not exported.');
  return true;
}

export function clampScale(page, scale) {
  let s = scale;
  s = Math.min(s, MAX_SIDE / Math.max(page.width, page.height));
  s = Math.min(s, Math.sqrt(MAX_AREA / (page.width * page.height)));
  return Math.max(0.05, s);
}

/** Rasterises a page to a canvas using the SVG renderer. */
export async function renderPageCanvas(doc, page, assets, { scale = 1, transparent = false, background = null } = {}) {
  const warnings = [];
  const s = clampScale(page, scale);
  if (s < scale - 1e-6) warnings.push(`The ${scale}× scale was reduced to ${s.toFixed(2)}× to stay within browser canvas limits.`);
  const { svg, warnings: w } = await renderPageSvg(doc, page, assets, { transparent });
  warnings.push(...w);
  const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    let img;
    try {
      img = await loadImageElement(blobUrl);
    } catch {
      throw new UserError('The browser couldn’t draw this page.', 'Try exporting at a lower scale.');
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(page.width * s));
    canvas.height = Math.max(1, Math.round(page.height * s));
    const ctx = canvas.getContext('2d');
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { canvas, warnings };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

export async function renderPng(doc, page, assets, { scale = 1, transparent = false } = {}) {
  const bg = transparent ? null : (page.background.transparent ? null : null);
  const { canvas, warnings } = await renderPageCanvas(doc, page, assets, { scale, transparent, background: bg });
  return { blob: await canvasToBlob(canvas, 'image/png'), warnings, width: canvas.width, height: canvas.height };
}

export async function renderJpeg(doc, page, assets, { scale = 1, quality = 0.92, background = '#ffffff' } = {}) {
  const { canvas, warnings } = await renderPageCanvas(doc, page, assets, { scale, background: page.background.transparent ? background : page.background.color });
  return { blob: await canvasToBlob(canvas, 'image/jpeg', quality), warnings, width: canvas.width, height: canvas.height };
}

/* ------------------------------ PDF ------------------------------ */

const enc = new TextEncoder();

/** Minimal PDF 1.4 writer: one full-page JPEG image per page. */
export function buildPdf(pages) {
  const chunks = [];
  let pos = 0;
  const push = (x) => {
    const b = typeof x === 'string' ? enc.encode(x) : x;
    chunks.push(b);
    pos += b.length;
  };
  const offsets = [];
  const N = 2 + pages.length * 3;
  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const obj = (n, body) => { offsets[n] = pos; push(`${n} 0 obj\n${body}\nendobj\n`); };
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  pages.forEach((p, i) => {
    const pn = 3 + i * 3, cn = pn + 1, im = pn + 2;
    const pw = +(p.width * 0.75).toFixed(2), ph = +(p.height * 0.75).toFixed(2);
    obj(pn, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${cn} 0 R >>`);
    const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    obj(cn, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    offsets[im] = pos;
    push(`${im} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.pxWidth} /Height ${p.pxHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
    push(p.jpeg);
    push('\nendstream\nendobj\n');
  });
  const xref = pos;
  let x = `xref\n0 ${N + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= N; n++) x += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(x);
  push(`trailer\n<< /Size ${N + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export async function renderPdf(doc, pageList, assets, { scale = 2, onProgress } = {}) {
  const warnings = [];
  const data = [];
  for (let i = 0; i < pageList.length; i++) {
    const page = pageList[i];
    const { blob, warnings: w, width, height } = await renderJpeg(doc, page, assets, { scale, quality: 0.93 });
    warnings.push(...w);
    data.push({ width: page.width, height: page.height, pxWidth: width, pxHeight: height, jpeg: new Uint8Array(await blob.arrayBuffer()) });
    if (onProgress) onProgress((i + 1) / pageList.length);
  }
  warnings.push('PDF pages are embedded as high-resolution images, so text is not selectable.');
  return { blob: new Blob([buildPdf(data)], { type: 'application/pdf' }), warnings: [...new Set(warnings)] };
}
