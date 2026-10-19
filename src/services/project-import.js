import JSZip from 'jszip';
import { SCHEMA_VERSION, validateDocument } from '../core/document-model.js';
import { LIMITS, MIME_BY_EXT, extOf, isSafeArchivePath } from '../utils/file-validation.js';
import { UserError } from '../utils/errors.js';

const MAX_ENTRIES = 6000;

/**
 * Reads and validates a .slt archive.
 * @param {Blob|ArrayBuffer|Uint8Array} input
 * @returns {Promise<{doc:object, assets:Map<string,Blob>, warnings:string[]}>}
 */
export async function parseSlt(input) {
  const size = input.size ?? input.byteLength ?? 0;
  if (size > LIMITS.project) throw new UserError('This project file is too large to open.', 'The limit is 300 MB.');
  let zip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch {
    throw new UserError('This file isn’t a valid Slatte project.', 'It may be damaged or not a .slt archive.');
  }
  const names = Object.keys(zip.files);
  if (names.length > MAX_ENTRIES) throw new UserError('This archive contains too many files to be a Slatte project.');
  for (const n of names) {
    if (!isSafeArchivePath(n.replace(/\/$/, ''))) {
      throw new UserError('This project contains unsafe file paths and was not opened.');
    }
  }
  let total = 0;
  const readBytes = async (name) => {
    const f = zip.file(name);
    if (!f) return null;
    const bytes = await f.async('uint8array');
    total += bytes.byteLength;
    if (total > LIMITS.projectUncompressed) throw new UserError('This project expands to an unreasonable size and was not opened.');
    return bytes;
  };
  const readJson = async (name) => {
    const bytes = await readBytes(name);
    if (!bytes) throw new UserError(`The project is missing ${name}.`, 'It may be damaged.');
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new UserError(`${name} in this project is damaged.`);
    }
  };

  const manifest = await readJson('manifest.json');
  if (!manifest || manifest.format !== 'slatte') throw new UserError('This archive is not a Slatte project.');
  if (!Number.isFinite(manifest.schemaVersion)) throw new UserError('This project has no version information.');
  if (manifest.schemaVersion > SCHEMA_VERSION) {
    throw new UserError('This project was made with a newer version of Slatte.', 'Update the app to open it.');
  }
  const project = await readJson('project.json');
  const { doc, warnings } = validateDocument(project);

  const assets = new Map();
  for (const [id, meta] of Object.entries(doc.assets)) {
    const path = meta.path;
    if (!path || !/^(assets|fonts)\//.test(path) || !isSafeArchivePath(path)) {
      warnings.push(`Asset “${meta.name}” has no valid file in the archive.`);
      delete meta.path;
      continue;
    }
    const bytes = await readBytes(path);
    if (!bytes) {
      warnings.push(`Asset “${meta.name}” is missing from the archive.`);
      delete meta.path;
      continue;
    }
    const ext = extOf(path);
    const mime = MIME_BY_EXT[ext] || meta.mime;
    assets.set(id, new Blob([bytes], { type: mime }));
    meta.mime = mime;
    meta.size = bytes.byteLength;
  }
  // References to assets that do not exist.
  for (const p of doc.pages) {
    for (const o of p.objects) {
      if ((o.type === 'image' || o.type === 'rasterLayer') && o.assetId && !assets.has(o.assetId)) {
        warnings.push(`“${o.name}” refers to a missing image and will appear as a placeholder.`);
      }
    }
  }
  return { doc, assets, warnings };
}
