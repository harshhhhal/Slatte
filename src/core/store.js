/** Minimal typed-ish event emitter used across the app. */
export class Emitter {
  constructor() {
    this._handlers = new Map();
  }

  on(event, fn) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const set = this._handlers.get(event);
    if (set) set.delete(fn);
  }

  emit(event, payload) {
    const set = this._handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[slatte] handler for "${event}" failed`, err);
      }
    }
  }

  clear() {
    this._handlers.clear();
  }
}

/** Observable value container for small bits of UI state. */
export class Store extends Emitter {
  constructor(initial) {
    super();
    this.state = initial;
  }

  set(patch) {
    const prev = this.state;
    this.state = { ...prev, ...patch };
    this.emit('change', { state: this.state, prev });
  }
}
