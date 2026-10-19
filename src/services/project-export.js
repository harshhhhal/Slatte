import JSZip from 'jszip';
import { APP_VERSION, SCHEMA_VERSION, collectAssetIds } from '../core/document-model.js';
import { EXT_BY_MIME } from '../utils/file-validation.js';

/**
 * Serialises a project into a .slt archive (a ZIP):
 *   manifest.json, project.json, assets/<id>.<ext>, fonts/<id>.<ext>, previews/page-1.png
 * Deterministic: fixed timestamps, stable key order, assets sorted by id.
 */
export async function buildSltBlob(doc, assetStore, { includeFonts = true, preview = null } = {}) {
  const zip = new JSZip();
  const fixed = new Date(Date.UTC(2020, 0, 1));
  const copy = JSON.parse(JSON.stringify(doc));
  const used = collectAssetIds(copy);
  const fontAssetIds = new Set((copy.fonts || []).map((f) => f.assetId).filter(Boolean));
  const warnings = [];

  if (!includeFonts) {
    for (const f of copy.fonts) {
      if (f.assetId) { fontAssetIds.delete(f.assetId); f.assetId = null; }
    }
    copy.fonts = copy.fonts.filter((f) => f.source !== 'local');
  }

  const ids = [...used].filter((id) => copy.assets[id]).sort();
  for (const id of ids) {
    const meta = copy.assets[id];
    if (!includeFonts && meta.kind === 'font') { delete copy.assets[id]; continue; }
    const blob = assetStore.get(id);
    if (!blob) {
      warnings.push(`Asset “${meta.name}” is missing and could not be included.`);
      continue;
    }
    const ext = EXT_BY_MIME[meta.mime] || 'bin';
    const folder = meta.kind === 'font' ? 'fonts' : 'assets';
    const path = `${folder}/${id}.${ext}`;
    meta.path = path;
    zip.file(path, blob, { date: fixed, binary: true });
  }
  // Assets without a blob keep metadata but no path.
  for (const id of Object.keys(copy.assets)) {
    if (!used.has(id)) delete copy.assets[id];
  }

  const manifest = {
    format: 'slatte',
    schemaVersion: SCHEMA_VERSION,
    application: 'Slatte',
    applicationVersion: APP_VERSION,
    projectId: doc.id,
    projectName: doc.name,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    pages: doc.pages.length,
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2), { date: fixed });
  zip.file('project.json', JSON.stringify(copy, null, 2), { date: fixed });
  if (preview) zip.file('previews/page-1.png', preview, { date: fixed, binary: true });

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.slatte.project+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  return { blob, warnings };
}
