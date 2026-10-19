import { h, debounce } from '../../utils/dom.js';
import { icon } from '../../core/icons.js';
import { createObject, TEXTURE_KINDS } from '../../core/document-model.js';
import { fonts, GOOGLE_FONTS, SYSTEM_FONTS } from '../../services/font-service.js';
import { LOCAL_ICONS, iconPreviewUrl, searchIcons } from '../../services/icon-service.js';
import { searchOpenverse } from '../../services/openverse-service.js';
import { addTextObject, insertLocalIcon, insertOpenverseImage, insertRemoteIcon } from '../../services/asset-import.js';
import { BRUSH_PRESETS, drawPresetPreview } from '../brush-engine.js';
import { textureDataUrl } from '../../services/texture-service.js';
import { describeError } from '../../utils/errors.js';
import { formatBytes } from '../../utils/file-validation.js';
import { iconButton } from '../../ui/controls.js';
import { confirmDialog, openDialog, toast } from '../../ui/ui.js';
import { localIconMarkup } from '../../services/icon-service.js';

const TABS = [
  { id: 'pages', icon: 'pages', label: 'Pages' },
  { id: 'elements', icon: 'shapes', label: 'Elements' },
  { id: 'icons', icon: 'smile', label: 'Icons' },
  { id: 'photos', icon: 'image', label: 'Photos' },
  { id: 'textures', icon: 'texture', label: 'Textures' },
  { id: 'brushes', icon: 'brush', label: 'Brushes' },
  { id: 'fonts', icon: 'type', label: 'Fonts' },
  { id: 'uploads', icon: 'folder', label: 'Uploads' },
];

function stateBox(kind, title, text, action) {
  return h('div.state', { class: `state-${kind}`, role: kind === 'error' ? 'alert' : null },
    h('p.state-title', title), text ? h('p', text) : null,
    action ? h('button.btn', { type: 'button', onclick: action.onClick }, action.label) : null);
}

const spinner = (label) => h('div.state.state-loading', { role: 'status' }, h('span.spin'), h('span', label));

export function createLeftPanel(app) {
  const { editor } = app;
  const root = h('div.leftpanel-inner');
  let tab = 'elements';
  const tabBar = h('div.tabbar', { role: 'tablist', 'aria-label': 'Asset categories' });
  const title = h('h2.panel-title');
  const body = h('div.panel-body', { role: 'tabpanel' });
  const cleanups = [];
  const mem = { icons: { q: '' }, photos: { q: '' } };

  const tabBtns = TABS.map((t) => {
    const b = h('button.tab', {
      type: 'button', role: 'tab', 'aria-label': t.label, title: t.label, 'aria-selected': 'false', dataset: { tab: t.id },
      onclick: () => show(t.id), html: icon(t.icon, 18),
    });
    tabBar.append(b);
    return b;
  });
  tabBar.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex((t) => t.id === tab);
    const n = TABS[(i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length];
    show(n.id);
    tabBtns[TABS.indexOf(n)].focus();
  });
  root.append(tabBar, title, body);

  function show(id) {
    cleanups.splice(0).forEach((c) => c());
    tab = id;
    tabBtns.forEach((b) => { const on = b.dataset.tab === id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    const meta = TABS.find((t) => t.id === id);
    title.textContent = meta.label;
    title.classList.remove('title-entered');
    body.replaceChildren();
    body.classList.remove('tab-entered');
    body.scrollTop = 0;
    const r = builders[id]();
    if (r) body.append(r);
    requestAnimationFrame(() => {
      body.classList.add('tab-entered');
      title.classList.add('title-entered');
    });
  }

  const search = (placeholder, value, onInput) => {
    const input = h('input.search', { type: 'search', placeholder, 'aria-label': placeholder, value: value || '' });
    const d = debounce(() => onInput(input.value), 350);
    input.addEventListener('input', d);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { d.cancel(); onInput(input.value); } e.stopPropagation(); });
    return input;
  };

  /* ------------------------------- pages ------------------------------- */

  const pagesTab = () => {
    const list = h('ul.page-list', { 'aria-label': 'Pages' });
    const render = () => {
      list.replaceChildren(...editor.doc.pages.map((p, i) => {
        const active = p.id === editor.doc.activePageId;
        const nameEl = h('span.page-name', p.name);
        const li = h('li.page-item', { class: active ? 'active' : '' },
          h('button.page-btn', { type: 'button', 'aria-current': active ? 'page' : null, onclick: () => editor.setActivePage(p.id) },
            h('span.page-num', String(i + 1)), h('span.page-meta', nameEl, h('span.page-size', `${p.width} × ${p.height}`))),
          h('div.page-acts',
            iconButton({ name: 'chevronUp', label: `Move ${p.name} up`, disabled: i === 0, size: 14, onClick: () => editor.movePage(p.id, i - 1) }),
            iconButton({ name: 'chevronDown', label: `Move ${p.name} down`, disabled: i === editor.doc.pages.length - 1, size: 14, onClick: () => editor.movePage(p.id, i + 1) }),
            iconButton({ name: 'copy', label: `Duplicate ${p.name}`, size: 14, onClick: () => editor.duplicatePage(p.id) }),
            iconButton({
              name: 'trash', label: `Delete ${p.name}`, size: 14, disabled: editor.doc.pages.length <= 1,
              onClick: async () => { if (await confirmDialog({ title: 'Delete page?', message: `“${p.name}” and everything on it will be removed. You can undo this.`, confirmLabel: 'Delete page', danger: true })) editor.removePage(p.id); },
            })));
        nameEl.addEventListener('dblclick', () => {
          const inp = h('input.rename', { type: 'text', value: p.name, 'aria-label': 'Page name', maxLength: 80 });
          nameEl.replaceWith(inp); inp.focus(); inp.select();
          const done = (ok) => { if (!inp.isConnected) return; if (ok && inp.value.trim()) editor.setPageProps({ name: inp.value.trim() }, { id: p.id, key: null }); else render(); };
          inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); e.stopPropagation(); });
          inp.addEventListener('blur', () => done(true));
        });
        return li;
      }));
    };
    render();
    cleanups.push(editor.on('page', render), editor.on('change', (e) => { if (e && e.committed) render(); }));
    return h('div', list, h('button.btn.btn-block', { type: 'button', onclick: () => app.actions.newPageDialog() }, 'Add page…'),
      h('p.hint', 'Each page is an independent artboard with its own size, background and layers. Double-click a name to rename it.'));
  };

  /* ------------------------------- elements ------------------------------- */

  const insertShape = (kind) => {
    const page = editor.page;
    const s = Math.min(page.width, page.height) * 0.25;
    const map = {
      rectangle: ['rectangle', {}], roundedRectangle: ['roundedRectangle', {}], ellipse: ['ellipse', {}],
      triangle: ['polygon', { sides: 3, name: 'Triangle' }], polygon: ['polygon', { sides: 6 }], star: ['star', {}], arrow: ['arrow', { height: s * 0.6 }],
      line: ['line', { height: 0, width: s * 1.5 }],
    };
    const [type, props] = map[kind];
    const o = createObject(type, { width: s, height: s, ...props });
    o.x = (page.width - o.width) / 2; o.y = (page.height - o.height) / 2;
    editor.addObjects([o], { label: `Add ${kind}` });
  };

  const elementsTab = () => {
    const shapes = [
      ['rectangle', 'rect', 'Rectangle'], ['roundedRectangle', 'rounded', 'Rounded'], ['ellipse', 'ellipse', 'Ellipse'], ['triangle', 'triangle', 'Triangle'],
      ['polygon', 'polygon', 'Polygon'], ['star', 'star', 'Star'], ['arrow', 'arrow', 'Arrow'], ['line', 'line', 'Line'],
    ];
    const grid = h('div.tile-grid', shapes.map(([k, ic, label]) => h('button.tile', { type: 'button', title: `Add ${label.toLowerCase()}`, 'aria-label': `Add ${label.toLowerCase()}`, onclick: () => insertShape(k) }, h('span', { html: icon(ic, 30) }), h('span.tile-label', label))));
    const texts = h('div.text-presets',
      h('button.text-preset.t1', { type: 'button', onclick: () => addTextObject(editor, { text: 'Add a heading', size: Math.round(editor.page.width / 12), weight: 700 }) }, 'Add a heading'),
      h('button.text-preset.t2', { type: 'button', onclick: () => addTextObject(editor, { text: 'Add a subheading', size: Math.round(editor.page.width / 22), weight: 600 }) }, 'Add a subheading'),
      h('button.text-preset.t3', { type: 'button', onclick: () => addTextObject(editor, { text: 'Add a little bit of body text', size: Math.round(editor.page.width / 38), weight: 400 }) }, 'Add a little bit of body text'));
    return h('div', h('h3.sub', 'Shapes'), grid, h('h3.sub', 'Text'), texts,
      h('p.hint', 'Tip: pick a tool from the rail and drag on the page for precise placement.'));
  };

  /* ------------------------------- icons ------------------------------- */

  const iconsTab = () => {
    const results = h('div.results');
    const local = h('div.tile-grid.small', LOCAL_ICONS.map((i) => h('button.tile.icon-tile', {
      type: 'button', title: i.label, 'aria-label': `Add ${i.label} icon`, onclick: () => insertLocalIcon(editor, i.name),
      html: `<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">${localIconMarkup(i.name)}</svg>`,
    })));
    let seq = 0;
    const run = async (q) => {
      mem.icons.q = q;
      const my = ++seq;
      if (!q.trim()) { results.replaceChildren(); return; }
      results.replaceChildren(spinner('Searching icons…'));
      try {
        const { icons, total } = await searchIcons(q);
        if (my !== seq) return;
        if (!icons.length) { results.replaceChildren(stateBox('empty', 'No matching icons', `Nothing found for “${q}”. Try a simpler word.`)); return; }
        const grid = h('div.tile-grid.small', icons.map((ic) => h('button.tile.icon-tile', {
          type: 'button', title: `${ic.name} — ${ic.set} (${ic.license})`, 'aria-label': `Add ${ic.name} icon from ${ic.set}`,
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try { await insertRemoteIcon(editor, ic); } catch (err) { toast(describeError(err), { kind: 'error', action: { label: 'Retry', onClick: () => btn.click() } }); } finally { btn.disabled = false; }
          },
        }, h('img', { src: iconPreviewUrl(ic.prefix, ic.name), alt: '', loading: 'lazy', width: 26, height: 26 }))));
        results.replaceChildren(grid, h('p.hint', `${total} results from Iconify. Each set has its own licence — hover an icon to see it; details are saved with the icon.`));
      } catch (err) {
        if (my !== seq) return;
        results.replaceChildren(stateBox('error', 'Couldn’t search icons', describeError(err), { label: 'Retry', onClick: () => run(q) }));
      }
    };
    const box = search('Search icons (e.g. arrow, heart)', mem.icons.q, run);
    if (mem.icons.q) run(mem.icons.q);
    return h('div', box, results, h('h3.sub', 'Built-in (works offline)'), local);
  };

  /* ------------------------------- photos ------------------------------- */

  const photosTab = () => {
    const results = h('div.results');
    let seq = 0;
    const run = async (q, page = 1, append = false) => {
      mem.photos.q = q;
      const my = ++seq;
      if (!q.trim()) { results.replaceChildren(); return; }
      if (!append) results.replaceChildren(spinner('Searching openly licensed images…'));
      try {
        const { results: items, pages } = await searchOpenverse(q, page);
        if (my !== seq) return;
        if (!items.length && !append) { results.replaceChildren(stateBox('empty', 'No images found', `Nothing found for “${q}”.`)); return; }
        const grid = append ? results.querySelector('.photo-grid') : h('div.photo-grid');
        for (const it of items) {
          grid.append(h('figure.photo', h('button.photo-btn', {
            type: 'button', title: `Add “${it.title}”`, 'aria-label': `Add image ${it.title} by ${it.creator}`,
            onclick: async (e) => {
              const b = e.currentTarget;
              b.disabled = true; b.classList.add('busy');
              try { await insertOpenverseImage(editor, it); toast('Image added. Credit is saved in Uploads.', { kind: 'success' }); } catch (err) { toast(describeError(err), { kind: 'error', action: { label: 'Retry', onClick: () => b.click() } }); } finally { b.disabled = false; b.classList.remove('busy'); }
            },
          }, h('img', { src: it.thumbnail, alt: it.title, loading: 'lazy' })),
          h('figcaption', h('span.cap-title', it.title), h('span.cap-meta', `${it.creator} · ${it.license}`))));
        }
        if (!append) results.replaceChildren(grid);
        results.querySelector('.more')?.remove();
        if (page < pages) results.append(h('button.btn.btn-block.more', { type: 'button', onclick: () => run(q, page + 1, true) }, 'Load more'));
        if (!results.querySelector('.hint')) results.append(h('p.hint', 'Results come from Openverse. Always check each image’s licence at its source before publishing; credits are stored with the image.'));
      } catch (err) {
        if (my !== seq) return;
        results.replaceChildren(stateBox('error', 'Couldn’t load images', describeError(err), { label: 'Retry', onClick: () => run(q, page, append) }));
      }
    };
    const box = search('Search free photos & art', mem.photos.q, (q) => run(q));
    if (mem.photos.q) run(mem.photos.q);
    return h('div', h('button.btn.btn-block', { type: 'button', onclick: () => app.actions.importDialog('image') }, 'Upload from this device…'), box, results);
  };

  /* ------------------------------- textures ------------------------------- */

  const texturesTab = () => {
    const page = editor.page;
    const tiles = TEXTURE_KINDS.map((k) => {
      const o = createObject('texture', { kind: k, width: 160, height: 100, scale: k === 'paper' || k === 'noise' ? 40 : 14, intensity: 0.6, density: 0.5 });
      let url = '';
      try { url = textureDataUrl(o); } catch { /* ignore */ }
      return h('button.tile.tex-tile', {
        type: 'button', title: `Add ${k} texture`, 'aria-label': `Add ${k} texture`,
        onclick: () => {
          const t = createObject('texture', {
            kind: k, x: 0, y: 0, width: page.width, height: page.height, scale: k === 'paper' || k === 'noise' ? 60 : Math.max(12, Math.round(page.width / 60)),
            intensity: 0.45, density: 0.5, name: `${k[0].toUpperCase()}${k.slice(1)} texture`, blendMode: ['paper', 'noise'].includes(k) ? 'multiply' : 'normal',
          });
          editor.addObjects([t], { label: `Add ${k} texture` });
        },
      }, h('span.tex-prev', { style: { backgroundImage: url ? `url(${url})` : 'none' } }), h('span.tile-label', k[0].toUpperCase() + k.slice(1)));
    });
    return h('div', h('div.tile-grid.tex', tiles),
      h('button.btn.btn-block', { type: 'button', onclick: () => app.actions.importDialog('image') }, 'Use your own texture image…'),
      h('p.hint', 'Textures are generated locally and saved as editable parameters. They export with your design; try the Multiply blend mode for paper grain.'));
  };

  /* ------------------------------- brushes ------------------------------- */

  const brushesTab = () => {
    const b = editor.toolOptions.brush;
    const grid = h('div.brush-grid', BRUSH_PRESETS.map((p) => {
      const cv = h('canvas', { width: 120, height: 34 });
      requestAnimationFrame(() => drawPresetPreview(cv, p, getComputedStyle(root).getPropertyValue('--text').trim() || '#18181b'));
      return h('button.brush-btn', {
        type: 'button', 'aria-label': `${p.name} brush`, title: p.name,
        onclick: () => { b.preset = p.id; editor.setTool('brush'); editor.emit('brush'); },
      }, cv, h('span', p.name));
    }));
    return h('div', grid,
      h('button.btn.btn-block', { type: 'button', onclick: () => editor.emit('new-paint-layer') }, 'New paint layer'),
      h('p.hint', 'Choose a preset to start painting. Adjust size, opacity and colour in the Design panel. Strokes go onto raster paint layers and can be undone.'));
  };

  /* ------------------------------- fonts ------------------------------- */

  const fontsTab = () => {
    const list = h('ul.font-list');
    let q = '';
    const render = () => {
      const cat = fonts.catalog(editor.doc.fonts).filter((f) => f.family.toLowerCase().includes(q.toLowerCase()));
      if (!cat.length) { list.replaceChildren(h('li', stateBox('empty', 'No matching fonts', `Nothing found for “${q}”.`))); return; }
      list.replaceChildren(...cat.map((f) => {
        const st = fonts.stateOf(f.family);
        const nameEl = h('span.font-name', { style: { fontFamily: st === 'loaded' ? `"${f.family}"` : 'inherit' } }, f.family);
        const li = h('li.font-item',
          h('button.font-btn', {
            type: 'button', title: `Use ${f.family}`,
            onclick: async () => {
              li.classList.add('loading');
              const status = await fonts.load(f.family);
              li.classList.remove('loading');
              if (status === 'failed') { toast(`“${f.family}” couldn’t load. A fallback font will be shown.`, { kind: 'warning' }); }
              const sel = editor.selectedObjects().filter((o) => o.type === 'text');
              if (sel.length) {
                const meta = fonts.info(f.family, editor.doc.fonts);
                const w = sel[0].fontWeight;
                editor.setProps({ fontFamily: f.family, fontWeight: meta && !meta.weights.includes(w) ? (meta.weights.includes(400) ? 400 : meta.weights[0]) : w }, { label: 'Change font' });
              } else addTextObject(editor, { text: f.family, family: f.family, size: Math.round(editor.page.width / 16), weight: 400 });
              render();
            },
            onpointerenter: () => { if (f.source === 'google' && fonts.stateOf(f.family) === 'idle') fonts.load(f.family).then(render); },
          }, nameEl, h('span.font-cat', f.category)),
          st === 'failed' ? h('span.badge.err', 'Offline') : st === 'loading' ? h('span.spin') : null);
        return li;
      }));
    };
    cleanups.push(fonts.on('status', render));
    render();
    return h('div', search('Search fonts', '', (v) => { q = v; render(); }),
      h('button.btn.btn-block', { type: 'button', onclick: () => app.actions.importDialog('font') }, 'Upload a font file…'),
      list,
      h('p.hint', `${GOOGLE_FONTS.length} Google Fonts load on demand; ${SYSTEM_FONTS.length} system fonts work offline. Click a font to apply it to the selected text, or to add new text.`));
  };

  /* ------------------------------- uploads ------------------------------- */

  const uploadsTab = () => {
    const wrap = h('div');
    const render = () => {
      wrap.replaceChildren();
      wrap.append(h('button.btn.btn-block', { type: 'button', onclick: () => app.actions.importDialog() }, 'Import files…'));
      const assets = Object.values(editor.doc.assets).filter((a) => a.kind === 'image' || a.kind === 'font');
      if (!assets.length) {
        wrap.append(stateBox('empty', 'No local assets', 'Images, SVGs and fonts you import appear here. You can also drag files onto the canvas.'));
        return;
      }
      const grid = h('div.asset-list');
      for (const a of assets) {
        const url = a.kind === 'image' ? editor.assets.url(a.id) : null;
        const credit = a.source && a.source.provider === 'openverse' ? a.source : null;
        grid.append(h('div.asset',
          a.kind === 'image' && url ? h('img', { src: url, alt: '', width: 48, height: 48 }) : h('span.asset-ic', { html: icon(a.kind === 'font' ? 'type' : 'image', 20) }),
          h('div.asset-info', h('span.asset-name', { title: a.name }, a.name), h('span.asset-meta', `${a.kind === 'font' ? 'Font' : `${a.width}×${a.height}`} · ${formatBytes(a.size)}`),
            credit ? h('span.asset-credit', `Credit: ${credit.creator} · ${credit.license}`) : null),
          a.kind === 'image' ? iconButton({ name: 'plus', label: `Insert ${a.name}`, size: 15, onClick: () => insertExisting(a) }) : null));
      }
      wrap.append(grid);
      const credits = assets.filter((a) => a.source && a.source.provider === 'openverse');
      if (credits.length) {
        wrap.append(h('button.btn.btn-block', {
          type: 'button',
          onclick: () => {
            const text = credits.map((a) => `“${a.source.title}” by ${a.source.creator} — ${a.source.license}${a.source.landingUrl ? ` — ${a.source.landingUrl}` : ''}`).join('\n');
            openDialog({ title: 'Image credits', body: h('textarea.credits', { readOnly: true, rows: 8, value: text }), actions: [{ label: 'Copy', primary: true, closes: false, onClick: () => navigator.clipboard.writeText(text).then(() => toast('Credits copied', { kind: 'success' })).catch(() => toast('Select the text and copy it manually.', { kind: 'info' })) }, { label: 'Close' }] });
          },
        }, 'View attribution list'));
      }
    };
    const insertExisting = (a) => {
      const page = editor.page;
      const k = Math.min(1, (page.width * 0.6) / a.width, (page.height * 0.6) / a.height);
      const o = createObject('image', { name: a.name.replace(/\.[^.]+$/, ''), assetId: a.id, width: a.width * k, height: a.height * k, naturalWidth: a.width, naturalHeight: a.height });
      o.x = (page.width - o.width) / 2; o.y = (page.height - o.height) / 2;
      editor.addObjects([o], { label: 'Add image' });
    };
    render();
    cleanups.push(editor.on('change', (e) => { if (e && e.committed && !e.history) render(); }));
    return wrap;
  };

  const builders = { pages: pagesTab, elements: elementsTab, icons: iconsTab, photos: photosTab, textures: texturesTab, brushes: brushesTab, fonts: fontsTab, uploads: uploadsTab };
  show(tab);
  return { el: root, show, destroy: () => cleanups.splice(0).forEach((c) => c()) };
}
