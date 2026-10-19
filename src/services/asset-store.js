import { shortId } from '../utils/ids.js';

/**
 * In-memory store of binary assets for the open project. Documents reference
 * assets by stable id; blob URLs are created lazily and revoked on dispose.
 */
export class AssetStore {
  constructor() {
    this.blobs = new Map();
    this.urls = new Map();
    this.persisted = new Set();
  }

  has(id) {
    return this.blobs.has(id);
  }

  get(id) {
    return this.blobs.get(id) || null;
  }

  put(id, blob, { persisted = false } = {}) {
    this.blobs.set(id, blob);
    const old = this.urls.get(id);
    if (old) {
      URL.revokeObjectURL(old);
      this.urls.delete(id);
    }
    if (persisted) this.persisted.add(id);
    else this.persisted.delete(id);
    return id;
  }

  add(blob) {
    return this.put(shortId('a'), blob);
  }

  url(id) {
    if (!this.blobs.has(id)) return null;
    let u = this.urls.get(id);
    if (!u) {
      u = URL.createObjectURL(this.blobs.get(id));
      this.urls.set(id, u);
    }
    return u;
  }

  async dataUrl(id) {
    const blob = this.blobs.get(id);
    if (!blob) return null;
    return blobToDataUrl(blob);
  }

  /** Drops assets that are not in `keep` (used after saving). */
  retain(keep) {
    for (const id of [...this.blobs.keys()]) {
      if (!keep.has(id)) this.delete(id);
    }
  }

  delete(id) {
    this.blobs.delete(id);
    this.persisted.delete(id);
    const u = this.urls.get(id);
    if (u) URL.revokeObjectURL(u);
    this.urls.delete(id);
  }

  dispose() {
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
    this.blobs.clear();
    this.persisted.clear();
  }
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas could not be encoded.'))), type, quality);
  });
}
