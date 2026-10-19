import { h, pickFiles, Disposer } from '../utils/dom.js';
import { icon, logoMark } from '../core/icons.js';
import { toggleTheme, getTheme } from '../core/theme.js';
import { storage } from '../services/project-storage.js';
import { createProject, importProjectFile, duplicateProject } from '../services/projects.js';
import { confirmDialog, toast, showMenu } from '../ui/ui.js';
import { describeError, UserError } from '../utils/errors.js';

const CAPABILITIES = [
  ['pen', 'Vector and raster, side by side', 'Shapes, a real pen tool with Bézier handles, and paint layers with eight brushes that respond to pressure.'],
  ['text', 'Type that behaves', 'Curated Google Fonts, your own font files, alignment, spacing and tidy line wrapping.'],
  ['layers', 'Layers you can trust', 'Groups, frames, locking, search, sixteen blend modes, shadows, blur and outlines.'],
  ['pages', 'Many pages, one project', 'Artboards for every size you need. Export one, or all of them at once.'],
  ['folder', 'Yours, on your device', 'Projects save in your browser as you work. Nothing is uploaded unless you choose to.'],
  ['download', 'Export and keep', 'PNG, JPEG, SVG and PDF, plus .slt: an editable project file you can reopen anywhere.'],
];

function relTime(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString();
}

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
        h('div.pv-swatches', ...['#ff6b4a', '#1f2937', '#f4d35e', '#7aa6ff', '#a7e8bd'].map((c) => h('i', { style: { background: c } }))),
        h('div.pv-label', 'Blend'), h('div.pv-field', 'Multiply'),
        h('div.pv-label', 'Opacity'), h('div.pv-slider', h('i')),
        h('div.pv-label', 'Shadow'), h('div.pv-field', 'Soft · 12 px'))));
}

export async function renderLanding(ctx) {
  const d = new Disposer();
  const urls = [];
  const goEditor = (id) => ctx.router.navigate(`/editor/${id}`);

  const themeBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Toggle light and dark theme' });
  const paintTheme = () => {
    const dark = getTheme() === 'dark';
    themeBtn.innerHTML = icon(dark ? 'sun' : 'moon', 18);
    themeBtn.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
  };
  themeBtn.addEventListener('click', () => { toggleTheme(); paintTheme(); });
  paintTheme();

  const busyBtns = new Set();
  const withBusy = (btn, fn) => async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    try { await fn(); } catch (err) { if (!(err instanceof UserError)) console.error(err); toast(describeError(err, 'Something went wrong.'), { kind: 'error' }); } finally { btn.disabled = false; }
  };

  const newBtn = h('button.btn.btn-primary.btn-lg', { type: 'button' }, h('span', { html: icon('plus', 18) }), 'New design');
  newBtn.addEventListener('click', withBusy(newBtn, async () => goEditor(await createProject())));
  const openBtn = h('button.btn.btn-lg', { type: 'button' }, h('span', { html: icon('folder', 18) }), 'Open .slt file');
  const openProject = withBusy(openBtn, async () => {
    const [file] = await pickFiles({ accept: '.slt,application/vnd.slatte.project+zip,application/zip' });
    if (!file) return;
    const { id, warnings } = await importProjectFile(file);
    if (warnings.length) toast(`Opened with ${warnings.length} notice${warnings.length === 1 ? '' : 's'}: ${warnings[0]}`, { kind: 'warning', duration: 9000 });
    goEditor(id);
  });
  openBtn.addEventListener('click', openProject);
  busyBtns.add(newBtn); busyBtns.add(openBtn);

  /* ---------------- recent projects ---------------- */
  const recentList = h('ul.project-grid', { 'aria-label': 'Recent projects' });
  const recentSection = h('section.recent', { id: 'projects', 'aria-labelledby': 'recent-h' },
    h('div.block-head', h('h2#recent-h', 'Your projects'), h('p.muted', 'Saved in this browser.')),
    recentList);

  const loadRecent = async () => {
    recentList.replaceChildren(h('li.state.state-loading', { role: 'status' }, h('span.spin'), h('span', 'Loading projects…')));
    let metas = [];
    try {
      metas = await storage.list();
    } catch (err) {
      recentList.replaceChildren(h('li.state.state-error', { role: 'alert' }, h('p.state-title', 'Couldn’t read your projects'), h('p', describeError(err)),
        h('button.btn', { type: 'button', onclick: loadRecent }, 'Try again')));
      return;
    }
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    if (!metas.length) {
      recentList.replaceChildren(h('li.state.state-empty',
        h('p.state-title', 'No projects yet'),
        h('p', 'Start a design and it will appear here. Projects stay on this device.'),
        h('button.btn.btn-primary', { type: 'button', onclick: () => newBtn.click() }, 'Start your first design')));
      return;
    }
    recentList.replaceChildren(...metas.map((m) => card(m)));
    if (storage.volatile) recentList.before(h('p.banner.warning', { role: 'status' }, 'This browser is blocking local storage, so projects will be lost when you close the tab. Export a .slt file to keep your work.'));
  };

  const card = (m) => {
    let thumb;
    if (m.thumb instanceof Blob) {
      const u = URL.createObjectURL(m.thumb);
      urls.push(u);
      thumb = h('img', { src: u, alt: '', loading: 'lazy' });
    } else thumb = h('span.thumb-empty', { html: icon('image', 28) });
    const more = h('button.icon-btn.card-more', { type: 'button', 'aria-label': `More actions for ${m.name}`, 'aria-haspopup': 'menu', html: icon('more', 18) });
    more.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      showMenu(more, [
        { label: 'Open', icon: 'folder', onClick: () => goEditor(m.id) },
        { label: 'Duplicate', icon: 'copy', onClick: async () => { try { await duplicateProject(m.id); await loadRecent(); toast('Project duplicated', { kind: 'success' }); } catch (err) { toast(describeError(err), { kind: 'error' }); } } },
        { separator: true },
        { label: 'Delete…', icon: 'trash', onClick: async () => {
          const ok = await confirmDialog({ title: 'Delete project?', message: `“${m.name}” and its images will be removed from this browser. This can’t be undone.`, confirmLabel: 'Delete', danger: true });
          if (!ok) return;
          try { await storage.remove(m.id); await loadRecent(); toast('Project deleted', { kind: 'info' }); } catch (err) { toast(describeError(err), { kind: 'error' }); }
        } },
      ], { align: 'end' });
    });
    return h('li.project-card',
      h('a.project-link', { href: `/editor/${m.id}`, 'data-link': '', 'aria-label': `Open ${m.name}` },
        h('div.project-thumb', thumb),
        h('div.project-meta', h('span.project-name', m.name), h('span.project-sub', `${m.pages} page${m.pages === 1 ? '' : 's'} · ${m.objects} layer${m.objects === 1 ? '' : 's'} · ${relTime(m.updatedAt)}`))),
      more);
  };

  /* ---------------- page ---------------- */
  const root = h('div.landing',
    h('a.skip', { href: '#main' }, 'Skip to content'),
    h('header.nav',
      h('a.brand', { href: '/', 'data-link': '', 'aria-label': 'Slatte home', html: `${logoMark(26)}<span>Slatte</span>` }),
      h('nav.nav-links', { 'aria-label': 'Primary' },
        h('a', { href: '#projects' }, 'Projects'),
        h('a', { href: '#capabilities' }, 'Capabilities'),
        h('a', { href: '/templates', 'data-link': '' }, 'Sizes')),
      h('div.nav-actions', themeBtn, h('a.btn.btn-primary', { href: '/templates', 'data-link': '' }, 'Start designing'))),
    h('main#main',
      h('section.hero',
        h('div.hero-copy',
          h('p.eyebrow', 'Local-first design editor'),
          h('h1', 'A clean space to make things.'),
          h('p.lede', 'Draw, type and paint in a calm, fast editor that runs in your browser. Your work stays on your device until you decide otherwise.'),
          h('div.hero-actions', newBtn, openBtn),
          h('p.fine', 'No account. No upload. Works offline once loaded.')),
        heroPreview()),
      recentSection,
      h('section.capabilities#capabilities', { 'aria-labelledby': 'cap-h' },
        h('div.block-head', h('h2#cap-h', 'Everything you need, nothing in the way.')),
        h('ul.cap-grid', CAPABILITIES.map(([ic, t, p]) => h('li.cap', h('span.cap-icon', { html: icon(ic, 22) }), h('h3', t), h('p', p))))),
      h('section.cta',
        h('h2', 'Ready when you are.'),
        h('p', 'Pick a size and start. Slatte saves as you go.'),
        h('a.btn.btn-primary.btn-lg', { href: '/templates', 'data-link': '' }, 'Choose a size'))),
    h('footer.footer',
      h('span', `© ${new Date().getFullYear()} Slatte`),
      h('span.muted', 'Open files are never uploaded. Fonts, icons and stock photos are fetched from public services only when you search for them.')));

  ctx.outlet.append(root);
  loadRecent();
  return {
    destroy() { d.dispose(); urls.forEach((u) => URL.revokeObjectURL(u)); },
  };
}
