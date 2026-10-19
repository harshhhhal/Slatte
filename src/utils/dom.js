/** Tiny DOM helpers. */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * h('div.class#id', { onclick, dataset:{}, style:{}, attr... }, ...children)
 * Children may be strings, nodes, arrays or null.
 */
export function h(tag, props, ...children) {
  let name = tag;
  const classes = [];
  let id = null;
  const m = tag.match(/^[a-zA-Z0-9]+/);
  name = m ? m[0] : 'div';
  const rest = tag.slice(name.length);
  rest.replace(/([.#])([\w-]+)/g, (_, t, v) => {
    if (t === '.') classes.push(v);
    else id = v;
    return '';
  });
  const el = document.createElement(name);
  if (classes.length) el.className = classes.join(' ');
  if (id) el.id = id;
  if (props && typeof props === 'object' && !(props instanceof Node) && !Array.isArray(props)) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.classList.add(...String(v).split(/\s+/).filter(Boolean));
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el && k !== 'list' && k !== 'form' && typeof v !== 'object') {
        try { el[k] = v; } catch { el.setAttribute(k, v); }
      } else el.setAttribute(k, v === true ? '' : v);
    }
  } else if (props != null) {
    children.unshift(props);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  return el;
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

export function debounce(fn, ms) {
  let t = null;
  const d = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...a); }, ms);
  };
  d.flush = (...a) => { if (t) { clearTimeout(t); t = null; fn(...a); } };
  d.cancel = () => { clearTimeout(t); t = null; };
  d.pending = () => t !== null;
  return d;
}

export function rafThrottle(fn) {
  let queued = false;
  let lastArgs;
  const t = (...a) => {
    lastArgs = a;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(...lastArgs); });
  };
  return t;
}

/** Collects listeners so a view can detach everything on destroy. */
export class Disposer {
  constructor() { this.fns = []; }
  add(fn) { this.fns.push(fn); return fn; }
  listen(target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    this.fns.push(() => target.removeEventListener(type, handler, opts));
  }
  dispose() {
    const fns = this.fns;
    this.fns = [];
    for (const f of fns.reverse()) {
      try { f(); } catch (e) { console.error(e); }
    }
  }
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    let done = false;
    input.addEventListener('change', () => {
      done = true;
      resolve([...input.files]);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      if (!done) resolve([]);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}
