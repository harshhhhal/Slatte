/**
 * Snapshot history. Each entry is the serialised document content. Binary data
 * (images, raster layers, fonts) lives in the asset store and is referenced only
 * by id, so entries stay small and never duplicate asset bytes.
 */
export class History {
  constructor(limit = 200) {
    this.limit = limit;
    this.stack = [];
    this.index = -1;
  }

  reset(json, label = 'Open') {
    this.stack = [{ label, json, key: null, time: 0 }];
    this.index = 0;
  }

  get current() {
    return this.stack[this.index] || null;
  }

  /**
   * Records a new state. When `key` matches the previous entry and it was recorded
   * recently, the previous entry is replaced so continuous edits (colour sliders,
   * nudging) form a single undo step. Returns false when nothing changed.
   */
  record(label, json, key = null, now = Date.now()) {
    const cur = this.current;
    if (cur && cur.json === json) return false;
    const top = this.index === this.stack.length - 1;
    if (key && top && cur && cur.key === key && now - cur.time < 900 && this.index > 0) {
      cur.json = json;
      cur.time = now;
      return true;
    }
    this.stack.length = this.index + 1;
    this.stack.push({ label, json, key, time: now });
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
    return true;
  }

  get canUndo() {
    return this.index > 0;
  }

  get canRedo() {
    return this.index < this.stack.length - 1;
  }

  undo() {
    if (!this.canUndo) return null;
    const undone = this.stack[this.index];
    this.index--;
    return { json: this.stack[this.index].json, label: undone.label };
  }

  redo() {
    if (!this.canRedo) return null;
    this.index++;
    return { json: this.stack[this.index].json, label: this.stack[this.index].label };
  }
}
