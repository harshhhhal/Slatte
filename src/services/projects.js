import { createDocument, PAGE_PRESETS } from '../core/document-model.js';
import { AssetStore } from './asset-store.js';
import { storage } from './project-storage.js';
import { parseSlt } from './project-import.js';
import { uid } from '../utils/ids.js';
import { validateFile } from '../utils/file-validation.js';

/** Creates and stores an empty project, returning its id. */
export async function createProject({ name = 'Untitled design', preset = 'social-square', width, height } = {}) {
  const p = PAGE_PRESETS.find((x) => x.id === preset) || PAGE_PRESETS[0];
  const doc = createDocument(name, { width: width || p.width, height: height || p.height });
  await storage.save(doc, new AssetStore());
  return doc.id;
}

/** Imports a .slt file as a brand-new project (fresh id, so nothing is overwritten). */
export async function importProjectFile(file) {
  validateFile(file, 'slt');
  const { doc, assets, warnings } = await parseSlt(file);
  doc.id = uid();
  const now = new Date().toISOString();
  doc.createdAt = now;
  doc.updatedAt = now;
  const store = new AssetStore();
  for (const [id, blob] of assets) store.put(id, blob);
  await storage.save(doc, store);
  return { id: doc.id, warnings };
}

export async function duplicateProject(id) {
  const rec = await storage.load(id);
  if (!rec) return null;
  const doc = JSON.parse(JSON.stringify(rec.doc));
  doc.id = uid();
  doc.name = `${doc.name} copy`.slice(0, 120);
  const now = new Date().toISOString();
  doc.createdAt = now;
  doc.updatedAt = now;
  const store = new AssetStore();
  for (const [aid, blob] of rec.assets) store.put(aid, blob);
  await storage.save(doc, store);
  return doc.id;
}
