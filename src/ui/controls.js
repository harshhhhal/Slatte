import { h } from '../utils/dom.js';
import { icon } from '../core/icons.js';
import { normalizeHex } from '../utils/color.js';
import { clamp } from '../utils/geometry.js';
import { GRADIENT_PRESETS, gradientFromPreset } from '../core/document-model.js';

/** All controls return { el, set(value, mixed?) } so panels can sync them in place. */

const fmt = (v, dp = 2) => {
  if (!Number.isFinite(v)) return '';
  const r = Math.round(v * 10 ** dp) / 10 ** dp;
  return String(r);
};

export function row(label, ...controls) {
  return h('div.prop-row', label ? h('label.prop-label', label) : null, h('div.prop-controls', controls));
}

export function numberInput({ label, value = 0, min = -1e6, max = 1e6, step = 1, unit = '', dp = 2, onInput, onCommit, width }) {
  const input = h('input.num', {
    type: 'text', inputMode: 'decimal', autocomplete: 'off', spellcheck: false, 'aria-label': label, value: fmt(value, dp),
  });
  if (width) input.style.width = width;
  const wrap = h('label.num-wrap', { class: unit ? 'has-unit' : '' }, input, unit ? h('span.num-unit', unit) : null);
  let last = value;
  const apply = (v, commit) => {
    const c = clamp(v, min, max);
    last = c;
    if (onInput) onInput(c);
    if (commit && onCommit) onCommit(c);
  };
  input.addEventListener('input', () => {
    const v = parseFloat(input.value.replace(',', '.'));
    if (Number.isFinite(v)) apply(v, false);
  });
  input.addEventListener('change', () => {
    const v = parseFloat(input.value.replace(',', '.'));
    if (Number.isFinite(v)) { apply(v, true); input.value = fmt(clamp(v, min, max), dp); } else input.value = fmt(last, dp);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const cur = parseFloat(input.value) || 0;
      const k = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? step * 10 : e.altKey ? step / 10 : step);
      const v = clamp(Math.round((cur + k) * 1000) / 1000, min, max);
      input.value = fmt(v, dp);
      apply(v, true);
    } else if (e.key === 'Enter') input.blur();
    e.stopPropagation();
  });
  input.addEventListener('focus', () => setTimeout(() => input.select(), 0));
  return {
    el: wrap,
    input,
    set(v, mixed = false) {
      if (document.activeElement === input) return;
      last = v;
      if (mixed) { input.value = ''; input.placeholder = 'Mixed'; } else { input.value = fmt(v, dp); input.placeholder = ''; }
    },
  };
}

export function slider({ label, value = 0, min = 0, max = 100, step = 1, unit = '', dp = 0, onInput, onCommit }) {
  const range = h('input.range', { type: 'range', min, max, step, value, 'aria-label': label });
  const num = numberInput({ label: `${label} value`, value, min, max, step, unit, dp, width: '56px', onInput: (v) => { range.value = v; onInput && onInput(v); } });
  range.addEventListener('input', () => { const v = parseFloat(range.value); num.set(v); onInput && onInput(v); });
  range.addEventListener('change', () => onCommit && onCommit(parseFloat(range.value)));
  return {
    el: h('div.slider-wrap', range, num.el),
    set(v, mixed) { range.value = v; num.set(v, mixed); },
  };
}

export function colorInput({ label, value = '#000000', onInput, onCommit, allowNone = false }) {
  const swatch = h('input.color-swatch', { type: 'color', value: normalizeHex(value), 'aria-label': `${label} colour picker` });
  const hex = h('input.hex', { type: 'text', value: normalizeHex(value).toUpperCase(), 'aria-label': `${label} hex`, maxLength: 9, spellcheck: false, autocomplete: 'off' });
  const apply = (v, commit) => { if (onInput) onInput(v); if (commit && onCommit) onCommit(v); };
  swatch.addEventListener('input', () => { hex.value = swatch.value.toUpperCase(); apply(swatch.value, false); });
  swatch.addEventListener('change', () => apply(swatch.value, true));
  hex.addEventListener('change', () => {
    const v = normalizeHex(hex.value, null);
    if (!v) { hex.value = swatch.value.toUpperCase(); return; }
    swatch.value = v; hex.value = v.toUpperCase(); apply(v, true);
  });
  hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') hex.blur(); e.stopPropagation(); });
  return {
    el: h('div.color-input', swatch, hex),
    set(v, mixed) {
      const n = normalizeHex(v);
      swatch.value = n;
      if (document.activeElement !== hex) hex.value = mixed ? '' : n.toUpperCase();
      hex.placeholder = mixed ? 'Mixed' : '';
    },
  };
}

export function segmented({ label, options, value, onChange, iconOnly = true }) {
  const btns = options.map((o) => h('button.seg-btn', {
    type: 'button', 'aria-pressed': String(o.value === value), 'aria-label': o.label, title: o.label, dataset: { value: String(o.value) },
    onclick: () => { onChange(o.value); },
    html: o.icon ? icon(o.icon, 16) + (iconOnly ? '' : `<span>${o.label}</span>`) : `<span>${o.label}</span>`,
  }));
  const el = h('div.seg', { role: 'group', 'aria-label': label }, btns);
  return {
    el,
    set(v) { btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === String(v)))); },
  };
}

export function toggle({ label, value = false, onChange }) {
  const input = h('input', { type: 'checkbox', checked: value, 'aria-label': label, role: 'switch' });
  input.addEventListener('change', () => onChange(input.checked));
  return { el: h('label.switch', input, h('span.switch-track')), set(v) { input.checked = !!v; } };
}

export function selectInput({ label, options, value, onChange }) {
  const sel = h('select.select', { 'aria-label': label }, options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
  sel.addEventListener('change', () => onChange(sel.value));
  sel.addEventListener('keydown', (e) => e.stopPropagation());
  return { el: sel, set(v) { sel.value = v; } };
}

export function iconButton({ name, label, onClick, pressed, size = 16, disabled = false }) {
  return h('button.icon-btn', {
    type: 'button', 'aria-label': label, title: label, onclick: onClick, 'aria-pressed': pressed === undefined ? null : String(pressed), disabled,
    html: icon(name, size),
  });
}

export function section(title, { open = true, key, actions } = {}, ...children) {
  let isOpen = open;
  try {
    const saved = key ? sessionStorage.getItem(`slatte:sec:${key}`) : null;
    if (saved !== null) isOpen = saved === '1';
  } catch { /* ignore */ }
  const body = h('div.section-body', children);
  const btn = h('button.section-head', {
    type: 'button', 'aria-expanded': String(isOpen),
    onclick: () => {
      isOpen = !isOpen;
      btn.setAttribute('aria-expanded', String(isOpen));
      el.classList.toggle('closed', !isOpen);
      try { if (key) sessionStorage.setItem(`slatte:sec:${key}`, isOpen ? '1' : '0'); } catch { /* ignore */ }
    },
  }, h('span.section-title', title), h('span.section-chev', { html: icon('chevronDown', 14) }));
  const el = h('section.section', { class: isOpen ? '' : 'closed' }, h('div.section-bar', btn, actions || null), body);
  return el;
}

/* ------------------------------ paint editor ------------------------------ */

const cssGradient = (p) => {
  const stops = [...p.stops].sort((a, b) => a.offset - b.offset).map((s) => {
    const hx = s.color.replace('#', '');
    const r = parseInt(hx.slice(0, 2), 16), g = parseInt(hx.slice(2, 4), 16), b = parseInt(hx.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${s.opacity * (p.opacity ?? 1)}) ${Math.round(s.offset * 100)}%`;
  }).join(',');
  return `linear-gradient(90deg,${stops})`;
};

/**
 * Fill/stroke editor: none | solid | linear | radial with a stop editor.
 * `api.get()` returns the paint of the first selected object; `api.set(patch|fn, {key,label})` writes it.
 */
export function paintEditor({ label, api, allowNone = true, recent = () => [], styles = () => [] }) {
  const root = h('div.paint');
  let selectedStop = 0;
  let structKey = '';

  const kinds = [
    ...(allowNone ? [{ value: 'none', label: 'None', icon: 'clear' }] : []),
    { value: 'solid', label: 'Solid', icon: 'rect' },
    { value: 'linear', label: 'Linear gradient', icon: 'gradient' },
    { value: 'radial', label: 'Radial gradient', icon: 'ellipse' },
  ];

  const setKind = (k) => {
    const p = api.get();
    if (k === p.type) return;
    if (k === 'solid') api.set({ type: 'solid' }, { label: `${label} solid` });
    else if (k === 'none') api.set({ type: 'none' }, { label: `${label} none` });
    else {
      const hasStops = p.stops && p.stops.length >= 2 && (p.type === 'linear' || p.type === 'radial' || p.stops[1].color !== '#ffffff');
      const base = p.color || '#3b5bdb';
      const next = hasStops && (p.type === 'linear' || p.type === 'radial')
        ? { type: k }
        : gradientFromPreset({ name: 'c', stops: [[base, 0], ['#ffffff', 1]] }, k);
      api.set(next, { label: `${label} ${k} gradient` });
    }
  };

  const build = () => {
    const p = api.get();
    root.replaceChildren();
    const seg = segmented({ label: `${label} type`, options: kinds, value: p.type, onChange: setKind });
    root.append(h('div.prop-row', seg.el));
    if (p.type === 'solid') {
      const c = colorInput({
        label, value: p.color,
        onInput: (v) => api.set({ color: v }, { key: `${label}:color`, label: `Change ${label.toLowerCase()} colour` }),
        onCommit: (v) => api.remember && api.remember(v),
      });
      const op = slider({ label: `${label} opacity`, value: Math.round(p.opacity * 100), min: 0, max: 100, unit: '%', onInput: (v) => api.set({ opacity: v / 100 }, { key: `${label}:op`, label: `Change ${label.toLowerCase()} opacity` }) });
      root.append(row('Colour', c.el), row('Opacity', op.el));
      root._sync = (q) => { c.set(q.color); op.set(Math.round(q.opacity * 100)); };
      const swatches = [...new Set([...recent(), ...styles()])].slice(0, 12);
      if (swatches.length) {
        root.append(h('div.swatches', { role: 'group', 'aria-label': 'Recent colours' }, swatches.map((hex) => h('button.swatch', {
          type: 'button', style: { background: hex }, title: hex, 'aria-label': `Use ${hex}`,
          onclick: () => { api.set({ type: 'solid', color: hex }, { label: `Change ${label.toLowerCase()} colour` }); },
        }))));
      }
    } else if (p.type === 'linear' || p.type === 'radial') {
      const bar = h('div.grad-bar', { style: { background: cssGradient(p) } });
      const track = h('div.grad-track', { role: 'group', 'aria-label': 'Gradient stops' });
      const stopsEl = h('div.grad-stops', bar, track);
      p.stops.forEach((s, i) => {
        const m = h('button.grad-stop', {
          type: 'button', 'aria-label': `Stop ${i + 1} at ${Math.round(s.offset * 100)}%`, 'aria-pressed': String(i === selectedStop),
          style: { left: `${s.offset * 100}%`, background: s.color },
        });
        m.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          selectedStop = i;
          const rect = stopsEl.getBoundingClientRect();
          m.setPointerCapture(e.pointerId);
          const mv = (ev) => {
            const off = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
            api.set((q) => { q.stops[i].offset = off; }, { key: `${label}:stop:${i}`, label: 'Move gradient stop' });
            m.style.left = `${off * 100}%`;
          };
          const up = () => { m.removeEventListener('pointermove', mv); m.removeEventListener('pointerup', up); structKey = ''; api.refresh(); };
          m.addEventListener('pointermove', mv);
          m.addEventListener('pointerup', up);
          [...track.children].forEach((c, k) => c.setAttribute('aria-pressed', String(k === i)));
        });
        m.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            const d = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.01);
            api.set((q) => { q.stops[i].offset = clamp(q.stops[i].offset + d, 0, 1); }, { key: `${label}:stop:${i}`, label: 'Move gradient stop' });
          } else if ((e.key === 'Delete' || e.key === 'Backspace') && p.stops.length > 2) {
            e.preventDefault();
            api.set((q) => { q.stops.splice(i, 1); }, { label: 'Remove gradient stop' });
            selectedStop = 0;
          }
          e.stopPropagation();
        });
        track.append(m);
      });
      bar.addEventListener('dblclick', (e) => {
        const rect = bar.getBoundingClientRect();
        const off = clamp((e.clientX - rect.left) / rect.width, 0, 1);
        api.set((q) => {
          q.stops.push({ offset: off, color: q.stops[Math.min(selectedStop, q.stops.length - 1)].color, opacity: 1 });
          q.stops.sort((a, b) => a.offset - b.offset);
          selectedStop = q.stops.findIndex((s) => s.offset === off);
        }, { label: 'Add gradient stop' });
      });
      const st = p.stops[Math.min(selectedStop, p.stops.length - 1)];
      const sc = colorInput({ label: 'Stop colour', value: st.color, onInput: (v) => api.set((q) => { q.stops[selectedStop].color = v; }, { key: `${label}:stopc`, label: 'Change stop colour' }) });
      const so = slider({ label: 'Stop opacity', value: Math.round(st.opacity * 100), min: 0, max: 100, unit: '%', onInput: (v) => api.set((q) => { q.stops[selectedStop].opacity = v / 100; }, { key: `${label}:stopo`, label: 'Change stop opacity' }) });
      const sp = numberInput({ label: 'Stop position', value: Math.round(st.offset * 100), min: 0, max: 100, unit: '%', dp: 0, onInput: (v) => api.set((q) => { q.stops[selectedStop].offset = v / 100; }, { key: `${label}:stopp`, label: 'Move gradient stop' }) });
      const del = iconButton({ name: 'trash', label: 'Remove stop', disabled: p.stops.length <= 2, onClick: () => { api.set((q) => { q.stops.splice(selectedStop, 1); }, { label: 'Remove gradient stop' }); selectedStop = 0; } });
      root.append(h('div.prop-row.stack', stopsEl, h('p.hint', 'Double-click the bar to add a stop.')),
        row('Stop', sc.el, del), row('Position', sp.el), row('Opacity', so.el));
      if (p.type === 'linear') {
        const ang = Math.round(((Math.atan2(p.y2 - p.y1, p.x2 - p.x1) * 180) / Math.PI + 360) % 360);
        const a = numberInput({
          label: 'Angle', value: ang, min: 0, max: 360, unit: '°', dp: 0,
          onInput: (v) => api.set((q) => {
            const r = (v * Math.PI) / 180;
            q.x1 = 0.5 - Math.cos(r) / 2; q.y1 = 0.5 - Math.sin(r) / 2; q.x2 = 0.5 + Math.cos(r) / 2; q.y2 = 0.5 + Math.sin(r) / 2;
          }, { key: `${label}:angle`, label: 'Change gradient angle' }),
        });
        root.append(row('Angle', a.el));
        root._sync = (q) => { a.set(Math.round(((Math.atan2(q.y2 - q.y1, q.x2 - q.x1) * 180) / Math.PI + 360) % 360)); };
      } else {
        const r = numberInput({ label: 'Radius', value: Math.round(p.r * 100), min: 1, max: 500, unit: '%', dp: 0, onInput: (v) => api.set({ r: v / 100 }, { key: `${label}:radius`, label: 'Change gradient radius' }) });
        root.append(row('Radius', r.el));
        root._sync = (q) => r.set(Math.round(q.r * 100));
      }
      root.append(h('div.presets', { role: 'group', 'aria-label': 'Gradient presets' }, GRADIENT_PRESETS.map((pr) => {
        const g = gradientFromPreset(pr, p.type);
        return h('button.preset', {
          type: 'button', title: pr.name, 'aria-label': `${pr.name} gradient`, style: { background: cssGradient(g) },
          onclick: () => { selectedStop = 0; api.set({ stops: g.stops }, { label: `Apply ${pr.name} gradient` }); },
        });
      })));
    } else {
      root._sync = null;
    }
  };

  const key = (p) => `${p.type}:${p.type === 'linear' || p.type === 'radial' ? p.stops.length + ':' + selectedStop : ''}`;
  return {
    el: root,
    refresh() {
      const p = api.get();
      const k = key(p);
      if (k !== structKey) { structKey = k; build(); } else if (root._sync) {
        root._sync(p);
        const bar = root.querySelector('.grad-bar');
        if (bar) bar.style.background = cssGradient(p);
        root.querySelectorAll('.grad-stop').forEach((m, i) => { if (p.stops[i]) { m.style.background = p.stops[i].color; if (document.activeElement !== m) m.style.left = `${p.stops[i].offset * 100}%`; } });
      }
    },
  };
}
