import { h } from '../utils/dom.js';
import { icon, logoMark } from '../core/icons.js';
import { PAGE_PRESETS } from '../core/document-model.js';
import { createProject } from '../services/projects.js';
import { toast } from '../ui/ui.js';
import { describeError } from '../utils/errors.js';
import { toggleTheme, getTheme } from '../core/theme.js';

/** Start screen: choose a canvas size (or a custom one) and open a fresh project. */
export function renderTemplates(ctx) {
  const groups = [...new Set(PAGE_PRESETS.map((p) => p.group))];
  const start = async (opts, btn) => {
    if (btn) btn.disabled = true;
    try {
      const id = await createProject(opts);
      ctx.router.navigate(`/editor/${id}`);
    } catch (err) {
      console.error(err);
      toast(describeError(err, 'Couldn’t create the project.'), { kind: 'error' });
      if (btn) btn.disabled = false;
    }
  };

  const shape = (p) => {
    const r = p.width / p.height;
    const w = r >= 1 ? 64 : Math.round(64 * r), hh = r >= 1 ? Math.round(64 / r) : 64;
    return h('span.size-shape', { style: { width: `${w}px`, height: `${hh}px` } });
  };

  const cw = h('input.text-input', { type: 'number', min: 1, max: 16000, value: 1200, 'aria-label': 'Custom width in pixels' });
  const ch = h('input.text-input', { type: 'number', min: 1, max: 16000, value: 800, 'aria-label': 'Custom height in pixels' });
  const customBtn = h('button.btn.btn-primary', { type: 'button' }, 'Create');
  const err = h('p.field-error', { role: 'alert' });
  customBtn.addEventListener('click', () => {
    const w = Math.round(Number(cw.value)), hh = Math.round(Number(ch.value));
    if (!(w >= 1 && w <= 16000 && hh >= 1 && hh <= 16000)) { err.textContent = 'Enter a width and height between 1 and 16000 px.'; return; }
    err.textContent = '';
    start({ width: w, height: hh, name: 'Untitled design' }, customBtn);
  });

  const themeBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Toggle light and dark theme', html: icon(getTheme() === 'dark' ? 'sun' : 'moon', 18) });
  themeBtn.addEventListener('click', () => { toggleTheme(); themeBtn.innerHTML = icon(getTheme() === 'dark' ? 'sun' : 'moon', 18); });

  const root = h('div.landing.templates',
    h('header.nav',
      h('a.brand', { href: '/', 'data-link': '', 'aria-label': 'Slatte home', html: `${logoMark(26)}<span>Slatte</span>` }),
      h('div.nav-actions', themeBtn, h('a.btn', { href: '/', 'data-link': '' }, 'Your projects'))),
    h('main#main.page-narrow',
      h('h1', 'Choose a size'),
      h('p.lede', 'You can add more pages in other sizes later.'),
      groups.map((g) => h('section.size-group', { 'aria-label': g },
        h('h2', g),
        h('ul.size-grid', PAGE_PRESETS.filter((p) => p.group === g).map((p) => {
          const b = h('button.size-card', { type: 'button' }, shape(p), h('span.size-name', p.name), h('span.size-dim', `${p.width} × ${p.height} px`));
          b.addEventListener('click', () => start({ preset: p.id, name: p.name }, b));
          return h('li', b);
        })))),
      h('section.size-group', { 'aria-label': 'Custom size' },
        h('h2', 'Custom'),
        h('div.custom-size', h('label', 'Width', cw), h('span', '×'), h('label', 'Height', ch), h('span.muted', 'px'), customBtn),
        err)));
  ctx.outlet.append(root);
  return { destroy() {} };
}
