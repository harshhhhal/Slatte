import { collectAssetIds } from '../core/document-model.js';
import { UserError } from '../utils/errors.js';

/**
 * IndexedDB persistence.
 *  - projects: { id, doc }
 *  - meta:     { id, name, createdAt, updatedAt, pages, objects, size, thumb }
 *  - assets:   { key: `${projectId}/${assetId}`, projectId, assetId, blob }
 * Falls back to a volatile in-memory backend when IndexedDB is unavailable
 * (some private-browsing modes). `storage.volatile` tells the UI.
 */

const DB_NAME = 'slatte';
const DB_VERSION = 1;

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new DOMException('Transaction aborted', 'AbortError'));
  });
}

class IdbBackend {
  constructor(db) {
    this.db = db;
    this.volatile = false;
  }

  static open() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        return reject(e);
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('assets')) {
          const s = db.createObjectStore('assets', { keyPath: 'key' });
          s.createIndex('projectId', 'projectId');
        }
      };
      req.onsuccess = () => resolve(new IdbBackend(req.result));
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
  }

  async listMeta() {
    const tx = this.db.transaction('meta');
    return wrap(tx.objectStore('meta').getAll());
  }

  async getMeta(id) {
    return wrap(this.db.transaction('meta').objectStore('meta').get(id));
  }

  async getProject(id) {
    return wrap(this.db.transaction('projects').objectStore('projects').get(id));
  }

  async getAssets(projectId) {
    const tx = this.db.transaction('assets');
    return wrap(tx.objectStore('assets').index('projectId').getAll(projectId));
  }

  async write({ project, meta, putAssets, deleteAssetKeys }) {
    const tx = this.db.transaction(['projects', 'meta', 'assets'], 'readwrite');
    const assets = tx.objectStore('assets');
    for (const a of putAssets) assets.put(a);
    for (const k of deleteAssetKeys) assets.delete(k);
    tx.objectStore('projects').put(project);
    tx.objectStore('meta').put(meta);
    await txDone(tx);
  }

  async remove(id, assetKeys) {
    const tx = this.db.transaction(['projects', 'meta', 'assets'], 'readwrite');
    tx.objectStore('projects').delete(id);
    tx.objectStore('meta').delete(id);
    for (const k of assetKeys) tx.objectStore('assets').delete(k);
    await txDone(tx);
  }

  async assetKeys(projectId) {
    const tx = this.db.transaction('assets');
    return wrap(tx.objectStore('assets').index('projectId').getAllKeys(projectId));
  }
}

class MemoryBackend {
  constructor() {
    this.volatile = true;
    this.projects = new Map();
    this.metas = new Map();
    this.assets = new Map();
  }

  async listMeta() { return [...this.metas.values()]; }
  async getMeta(id) { return this.metas.get(id); }
  async getProject(id) { return this.projects.get(id); }
  async getAssets(pid) { return [...this.assets.values()].filter((a) => a.projectId === pid); }
  async write({ project, meta, putAssets, deleteAssetKeys }) {
    putAssets.forEach((a) => this.assets.set(a.key, a));
    deleteAssetKeys.forEach((k) => this.assets.delete(k));
    this.projects.set(project.id, project);
    this.metas.set(meta.id, meta);
  }
  async remove(id, keys) {
    this.projects.delete(id);
    this.metas.delete(id);
    keys.forEach((k) => this.assets.delete(k));
  }
  async assetKeys(pid) { return [...this.assets.values()].filter((a) => a.projectId === pid).map((a) => a.key); }
}

class ProjectStorage {
  constructor() {
    this._backend = null;
  }

  async backend() {
    if (!this._backend) {
      try {
        this._backend = await IdbBackend.open();
      } catch (err) {
        console.warn('[slatte] IndexedDB unavailable, using in-memory storage', err);
        this._backend = new MemoryBackend();
      }
    }
    return this._backend;
  }

  get volatile() {
    return !!(this._backend && this._backend.volatile);
  }

  async list() {
    const b = await this.backend();
    const metas = await b.listMeta();
    return metas.sort((a, c) => String(c.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async exists(id) {
    const b = await this.backend();
    return !!(await b.getProject(id));
  }

  /** @returns {Promise<{doc:object, assets:Map<string,Blob>}|null>} */
  async load(id) {
    const b = await this.backend();
    const rec = await b.getProject(id);
    if (!rec) return null;
    const rows = await b.getAssets(id);
    return { doc: rec.doc, assets: new Map(rows.map((r) => [r.assetId, r.blob])) };
  }

  /**
   * Writes the document and any new assets. Resolves only after the transaction
   * completes, so callers can safely mark the project as saved.
   */
  async save(doc, assetStore, { thumb } = {}) {
    const b = await this.backend();
    const keep = collectAssetIds(doc);
    const putAssets = [];
    for (const id of keep) {
      if (assetStore.has(id) && !assetStore.persisted.has(id)) {
        putAssets.push({ key: `${doc.id}/${id}`, projectId: doc.id, assetId: id, blob: assetStore.get(id) });
      }
    }
    const existing = await b.assetKeys(doc.id);
    const keepKeys = new Set([...keep].map((a) => `${doc.id}/${a}`));
    const deleteAssetKeys = existing.filter((k) => !keepKeys.has(k));
    let objects = 0;
    for (const p of doc.pages) objects += p.objects.length;
    const prev = await b.getMeta(doc.id);
    const meta = {
      id: doc.id, name: doc.name, createdAt: doc.createdAt, updatedAt: doc.updatedAt,
      pages: doc.pages.length, objects, thumb: thumb || (prev && prev.thumb) || null,
    };
    try {
      await b.write({ project: { id: doc.id, doc }, meta, putAssets, deleteAssetKeys });
    } catch (err) {
      if (err && (err.name === 'QuotaExceededError' || /quota/i.test(String(err.message)))) {
        const e = new UserError('Your browser has no storage space left for this project.', 'Export a backup (.slt), then free up space or delete old projects.');
        e.cause = err;
        throw e;
      }
      throw err;
    }
    for (const a of putAssets) assetStore.persisted.add(a.assetId);
    for (const k of deleteAssetKeys) assetStore.persisted.delete(k.split('/')[1]);
  }

  async remove(id) {
    const b = await this.backend();
    await b.remove(id, await b.assetKeys(id));
  }

  async rename(id, name) {
    const b = await this.backend();
    const rec = await b.getProject(id);
    if (!rec) return;
    rec.doc.name = name;
    const meta = await b.getMeta(id);
    await b.write({ project: rec, meta: { ...meta, name }, putAssets: [], deleteAssetKeys: [] });
  }
}

export const storage = new ProjectStorage();
