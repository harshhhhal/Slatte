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

  const featureItems = CAPABILITIES.map(([ic, title]) => h('li.cap',
    h('span.cap-icon', { html: icon(ic, 22) }), h('h3', title)));
  const featureTrack = h('ul.cap-track', featureItems);
  const featureDeck = h('div.cap-carousel', { role: 'region', 'aria-label': 'Slatte features', tabindex: 0 }, featureTrack);
  let activeFeature = 0;
  let featureTimer;
  let dragStart;
  let manualPause = false;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const syncFeatureDeck = () => {
    featureItems.forEach((item, index) => {
      let offset = (index - activeFeature + CAPABILITIES.length) % CAPABILITIES.length;
      if (offset > CAPABILITIES.length / 2) offset -= CAPABILITIES.length;
      item.dataset.position = reducedMotion.matches ? 'static' : String(offset);
      item.setAttribute('aria-hidden', String(!reducedMotion.matches && Math.abs(offset) > 2));
    });
  };
  const stopFeatureDeck = () => { clearInterval(featureTimer); featureTimer = undefined; };
  const startFeatureDeck = () => {
    stopFeatureDeck();
    if (reducedMotion.matches || document.hidden || manualPause) return;
    featureTimer = setInterval(() => {
      activeFeature = (activeFeature + 1) % CAPABILITIES.length;
      syncFeatureDeck();
    }, 4400);
  };
  const manualStep = (direction) => {
    manualPause = true;
    stopFeatureDeck();
    activeFeature = (activeFeature + direction + CAPABILITIES.length) % CAPABILITIES.length;
    syncFeatureDeck();
  };
  featureDeck.addEventListener('wheel', (event) => {
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (Math.abs(delta) < 12) return;
    event.preventDefault();
    manualStep(delta > 0 ? 1 : -1);
  }, { passive: false });
  featureDeck.addEventListener('pointerdown', (event) => {
    dragStart = event.clientX;
    featureDeck.setPointerCapture(event.pointerId);
  });
  featureDeck.addEventListener('pointerup', (event) => {
    if (dragStart === undefined) return;
    const distance = dragStart - event.clientX;
    dragStart = undefined;
    if (Math.abs(distance) > 36) manualStep(distance > 0 ? 1 : -1);
  });
  featureDeck.addEventListener('pointercancel', () => { dragStart = undefined; });
  featureDeck.addEventListener('mouseleave', () => { manualPause = false; startFeatureDeck(); });
  featureDeck.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      manualStep(event.key === 'ArrowRight' ? 1 : -1);
    }
  });
  featureDeck.addEventListener('focusout', () => { manualPause = false; startFeatureDeck(); });
  document.addEventListener('visibilitychange', startFeatureDeck);
  const onMotionChange = () => { syncFeatureDeck(); startFeatureDeck(); };
  reducedMotion.addEventListener('change', onMotionChange);
  syncFeatureDeck();

  /* ---------------- page ---------------- */
  const root = h('div.landing',
    h('a.skip', { href: '#main' }, 'Skip to content'),
    h('header.nav',
      h('a.brand', { href: '/', 'data-link': '', 'aria-label': 'Slatte home', html: `${logoMark(26)}<span>Slatte</span>` }),
      h('div.nav-actions', themeBtn)),
    h('main#main',
      h('section.hero',
        h('div.hero-copy',
          h('h1', 'Make room for\nyour next idea.'),
          h('p.lede', 'A calm canvas for the things you imagine.'),
          h('div.hero-actions', h('a.btn.btn-primary.btn-lg', { href: '/app', 'data-link': '' }, 'Get started'))),
        h('div.hero-visual', heroPreview(),
          h('div.hero-float.float-top', h('span.float-mark', '✳'), h('span', 'A fresh canvas')),
          h('div.hero-float.float-bottom', h('span.float-swatch'), h('span', 'Made your way')))),
      h('section.capabilities#capabilities', { 'aria-labelledby': 'cap-h' },
        h('div.block-head', h('h2#cap-h', 'Tools for your\nnext good idea.')),
        featureDeck),
      h('section.make-strip', { 'aria-labelledby': 'make-h' },
        h('div.make-copy',
          h('h2#make-h', 'Make posters, social graphics, and more.')),
        h('div.make-gallery', { 'aria-label': 'Examples of designs you can create' },
          h('article.make-card.make-poster', h('span.make-card-kicker', '01 / POSTER'), h('span.make-poster-title', 'A little\nmore color'), h('i.make-poster-orb'), h('i.make-poster-line')),
          h('article.make-card.make-social', h('span.make-card-kicker', '02 / SOCIAL'), h('i.make-social-sun'), h('span.make-social-title', 'Stay curious'), h('i.make-social-wave')),
          h('article.make-card.make-type', h('span.make-card-kicker', '03 / TYPE'), h('span.make-type-mark', 'Aa'), h('span.make-type-note', 'Words in\ngood form'))))
      ),
    h('footer.footer',
      h('span', `© ${new Date().getFullYear()} Slatte`),
      h('span.muted', 'Made for ideas, built for your device.')));

  ctx.outlet.append(root);
  startFeatureDeck();
  return {
    destroy() {
      stopFeatureDeck();
      document.removeEventListener('visibilitychange', startFeatureDeck);
      reducedMotion.removeEventListener('change', onMotionChange);
    },
  };
}
