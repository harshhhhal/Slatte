import { Emitter } from '../core/store.js';
import { storage } from './project-storage.js';
import { debounce } from '../utils/dom.js';
import { canvasToBlob } from './asset-store.js';
import { renderPageCanvas } from './project-render.js';
import { describeError } from '../utils/errors.js';

/**
 * Debounced autosave. A revision counter guards consistency: the project is
 * only reported as "saved" when the revision that was written is still the
 * current one.
 */
export class AutoSave extends Emitter {
  constructor(editor) {
    super();
    this.editor = editor;
    this.status = 'saved';
    this.savedRev = editor.rev;
    this.lastThumb = 0;
    this.writing = null;
    this.error = null;
    this.run = debounce(() => this.flush(), 700);
    this._off = editor.on('change', (e) => {
      if (e && e.committed && editor.rev !== this.savedRev) {
        this._set('unsaved');
        this.run();
      }
    });
  }

  _set(status, error = null) {
    this.status = status;
    this.error = error;
    this.emit('status', { status, error });
  }

  async flush({ thumb = false } = {}) {
    this.run.cancel();
    if (this.writing) { await this.writing; if (this.editor.rev === this.savedRev) return; }
    const ed = this.editor;
    if (ed.rev === this.savedRev && !thumb) return;
    const rev = ed.rev;
    this._set('saving');
    this.writing = (async () => {
      try {
        let thumbBlob;
        if (thumb || Date.now() - this.lastThumb > 30000) {
          try {
            const page = ed.doc.pages[0];
            const { canvas } = await renderPageCanvas(ed.doc, page, ed.assets, {
              scale: Math.min(1, 360 / Math.max(page.width, page.height)),
              background: page.background.transparent ? '#ffffff' : page.background.color,
            });
            thumbBlob = await canvasToBlob(canvas, 'image/jpeg', 0.8);
            this.lastThumb = Date.now();
          } catch { /* thumbnails are optional */ }
        }
        await storage.save(ed.doc, ed.assets, { thumb: thumbBlob });
        this.savedRev = rev;
        this._set(ed.rev === rev ? 'saved' : 'unsaved');
        if (ed.rev !== rev) this.run();
      } catch (err) {
        console.error('[slatte] save failed', err);
        this._set('error', describeError(err, 'Saving failed. Export a backup (.slt) to keep your work.'));
      } finally {
        this.writing = null;
      }
    })();
    await this.writing;
  }

  dispose() {
    this._off();
    this.run.cancel();
  }
}
