import { h } from '../utils/dom.js';
import { icon, logoMark } from '../core/icons.js';
import { toggleTheme, getTheme } from '../core/theme.js';

const CAPABILITIES = [
  ['pen', 'Vector and raster'], ['text', 'Type that behaves'], ['layers', 'Layers you can trust'],
  ['pages', 'Many pages'], ['folder', 'Yours, on your device'], ['download', 'Export and keep'],
];

function heroPreview() {
  // A live preview assembled from the app's own HTML and CSS (not an image).
  const tools = ['select', 'rect', 'ellipse', 'pen', 'brush', 'text', 'image'].map((n, i) =>
    h('span.pv-tool', { class: i === 0 ? 'on' : '', html: icon(n, 16) }));
  return h('div.hero-preview', { 'aria-hidden': 'true' },
    h('div.pv-top', h('span.pv-dots', h('i'), h('i'), h('i')), h('span.pv-name', 'Poster draft'), h('span.pv-saved', 'Saved')),
    h('div.pv-body',
      h('div.pv-rail', tools),
      h('div.pv-stage',
        h('div.pv-page',
          h('div.pv-blob.b1'), h('div.pv-blob.b2'), h('div.pv-circle'),
          h('div.pv-title', 'Make\nsomething\nquiet.'),
          h('div.pv-sub', 'A clean space to make things'),
          h('div.pv-sel', ...['nw', 'ne', 'sw', 'se'].map((c) => h('i', { class: c }))))),
      h('div.pv-insp',
        h('div.pv-label', 'Fill'),
        h('div.pv-swatches', ...['#02c470', '#1f2937', '#f4d35e', '#7aa6ff', '#a7e8bd'].map((c) => h('i', { style: { background: c } }))),
        h('div.pv-label', 'Blend'), h('div.pv-field', 'Multiply'),
        h('div.pv-label', 'Opacity'), h('div.pv-slider', h('i')),
        h('div.pv-label', 'Shadow'), h('div.pv-field', 'Soft · 12 px'))));
}

export async function renderLanding(ctx) {
  const themeBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Toggle light and dark theme' });
  const paintTheme = () => {
    const dark = getTheme() === 'dark';
    themeBtn.innerHTML = icon(dark ? 'sun' : 'moon', 18);
    themeBtn.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
  };
  themeBtn.addEventListener('click', () => { toggleTheme(); paintTheme(); });
  paintTheme();

  /* ---------------- page ---------------- */
  const root = h('div.landing',
    h('a.skip', { href: '#main' }, 'Skip to content'),
    h('header.nav',
      h('a.brand', { href: '/', 'data-link': '', 'aria-label': 'Slatte home', html: `${logoMark(26)}<span>Slatte</span>` }),
      h('div.nav-actions', themeBtn)),
    h('main#main',
      h('section.hero',
        h('div.hero-copy',
          h('p.eyebrow', 'A little room to make'),
          h('h1', 'Make room for\nyour next idea.'),
          h('p.lede', 'A calm canvas for the things you imagine.'),
          h('div.hero-actions', h('a.btn.btn-primary.btn-lg', { href: '/app', 'data-link': '' }, 'Get started')),
          h('p.fine', 'Private by design · Saved as you go')),
        h('div.hero-visual', heroPreview(),
          h('div.hero-float.float-top', h('span.float-mark', '✳'), h('span', 'A fresh canvas')),
          h('div.hero-float.float-bottom', h('span.float-swatch'), h('span', 'Made your way')))),
      h('section.capabilities#capabilities', { 'aria-labelledby': 'cap-h' },
        h('div.block-head', h('h2#cap-h', 'Everything you need, nothing in the way.')),
        h('ul.cap-grid', CAPABILITIES.map(([ic, t]) => h('li.cap', h('span.cap-icon', { html: icon(ic, 22) }), h('h3', t)))))
      ),
    h('footer.footer',
      h('span', `© ${new Date().getFullYear()} Slatte`),
      h('span.muted', 'Open files are never uploaded. Fonts, icons and stock photos are fetched from public services only when you search for them.')));

  ctx.outlet.append(root);
  return {
    destroy() {},
  };
}
