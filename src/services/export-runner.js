import JSZip from 'jszip';
import { renderJpeg, renderPageSvg, renderPdf, renderPng } from './project-render.js';
import { buildSltBlob } from './project-export.js';
import { safeFileName } from '../utils/file-validation.js';
import { canvasToBlob } from './asset-store.js';
import { renderPageCanvas } from './project-render.js';

export const EXPORT_FORMATS = [
  { id: 'png', label: 'PNG image', ext: 'png', mime: 'image/png' },
  { id: 'jpeg', label: 'JPEG image', ext: 'jpg', mime: 'image/jpeg' },
  { id: 'svg', label: 'SVG vector', ext: 'svg', mime: 'image/svg+xml' },
  { id: 'pdf', label: 'PDF document', ext: 'pdf', mime: 'application/pdf' },
  { id: 'slt', label: 'Slatte project (.slt)', ext: 'slt', mime: 'application/vnd.slatte.project+zip' },
];

/**
 * Produces an export file from the current document.
 * opts: { format, scope: 'page'|'all', scale, quality, transparent, embedFonts, includeFonts }
 * Resolves with { blob, filename, warnings }.
 */
export async function runExport(editor, opts, onProgress = () => {}) {
  const { doc, assets } = editor;
  const fmt = EXPORT_FORMATS.find((f) => f.id === opts.format);
  const base = safeFileName(doc.name);
  const pages = opts.scope === 'all' || opts.format === 'slt' ? doc.pages : [editor.page];
  const warnings = [];

  if (opts.format === 'slt') {
    onProgress(0.1);
    let preview = null;
    try {
      const { canvas } = await renderPageCanvas(doc, doc.pages[0], assets, { scale: Math.min(1, 480 / doc.pages[0].width), background: doc.pages[0].background.transparent ? '#ffffff' : doc.pages[0].background.color });
      preview = await canvasToBlob(canvas, 'image/png');
    } catch { /* preview is optional */ }
    const { blob, warnings: w } = await buildSltBlob(doc, assets, { includeFonts: opts.includeFonts !== false, preview });
    onProgress(1);
    return { blob, filename: `${base}.slt`, warnings: w };
  }

  if (opts.format === 'pdf') {
    const r = await renderPdf(doc, pages, assets, { scale: opts.scale || 2, onProgress });
    return { blob: r.blob, filename: `${base}.pdf`, warnings: r.warnings };
  }

  const files = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    let blob;
    if (opts.format === 'png') {
      const r = await renderPng(doc, page, assets, { scale: opts.scale || 1, transparent: !!opts.transparent });
      blob = r.blob; warnings.push(...r.warnings);
    } else if (opts.format === 'jpeg') {
      const r = await renderJpeg(doc, page, assets, { scale: opts.scale || 1, quality: opts.quality ?? 0.92 });
      blob = r.blob; warnings.push(...r.warnings);
    } else {
      const r = await renderPageSvg(doc, page, assets, { transparent: !!opts.transparent, embedFonts: opts.embedFonts !== false });
      blob = new Blob([r.svg], { type: 'image/svg+xml' }); warnings.push(...r.warnings);
    }
    files.push({ blob, name: pages.length > 1 ? `${base}-${i + 1}-${safeFileName(page.name)}.${fmt.ext}` : `${base}.${fmt.ext}` });
    onProgress((i + 1) / pages.length);
  }
  const uniqueWarnings = [...new Set(warnings)];
  if (files.length === 1) return { blob: files[0].blob, filename: files[0].name, warnings: uniqueWarnings };
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.blob);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  return { blob, filename: `${base}-${fmt.ext}.zip`, warnings: uniqueWarnings };
}
