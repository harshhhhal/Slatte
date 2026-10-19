import { UserError } from '../utils/errors.js';
import { canvasToBlob } from './asset-store.js';
import { MIME_BY_EXT, extOf, validateFile } from '../utils/file-validation.js';

const MAX_SIDE = 6000;

export function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode'));
    img.src = url;
  });
}

/**
 * Validates and decodes an image file. GIF/BMP and oversized images are
 * re-encoded as PNG (first frame / capped at 6000px). Returns a normalised blob.
 */
export async function prepareImage(file) {
  validateFile(file, 'image');
  const ext = extOf(file.name);
  const url = URL.createObjectURL(file);
  try {
    let img;
    try {
      img = await loadImageElement(url);
    } catch {
      throw new UserError(`“${file.name}” couldn’t be decoded as an image.`, 'The file may be damaged or in an unsupported format.');
    }
    let w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) throw new UserError(`“${file.name}” has no readable image data.`);
    const flatten = ext === 'gif' || ext === 'bmp' || Math.max(w, h) > MAX_SIDE;
    let blob = file;
    let note = '';
    if (flatten) {
      const k = Math.min(1, MAX_SIDE / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.round(w * k); c.height = Math.round(h * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      blob = await canvasToBlob(c, 'image/png');
      if (k < 1) note = `“${file.name}” was reduced to ${c.width}×${c.height}px to keep the editor responsive.`;
      else if (ext === 'gif') note = `“${file.name}” is animated; only its first frame was imported.`;
      w = c.width; h = c.height;
    } else if (!blob.type) {
      blob = new Blob([file], { type: MIME_BY_EXT[ext] || 'image/png' });
    }
    return { blob, width: w, height: h, name: file.name, mime: blob.type || 'image/png', note };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Reads an image blob's pixel dimensions. */
export async function imageSize(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImageElement(url);
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}
