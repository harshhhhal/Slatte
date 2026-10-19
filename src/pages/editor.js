import { h, pickFiles, Disposer } from '../utils/dom.js';
import { icon, logoMark } from '../core/icons.js';
import { toggleTheme, getTheme } from '../core/theme.js';
import { validateDocument, createObject, uniqueName } from '../core/document-model.js';
import { Editor } from '../core/editor.js';
import { Shortcuts, formatKeys } from '../core/shortcuts.js';
import { buildCommands } from '../core/commands.js';
import { Stage } from '../editor/stage.js';
import { RasterManager } from '../editor/raster.js';
import { createSelectTool } from '../editor/tools/select.js';
import { createDirectTool } from '../editor/tools/direct.js';
import { createShapeTool, SHAPE_TOOLS } from '../editor/tools/shapes.js';
import { createPenTool } from '../editor/tools/pen.js';
import { createBrushTool } from '../editor/tools/brush.js';
import { createTextTool } from '../editor/tools/text.js';
import { createGradientTool } from '../editor/tools/gradient.js';
import { createEyedropperTool } from '../editor/tools/eyedropper.js';
import { createHandTool, createImageTool } from '../editor/tools/simple.js';
import { createToolRail } from '../editor/panels/toolrail.js';
import { createLeftPanel } from '../editor/panels/leftpanel.js';
import { createInspector } from '../editor/panels/properties.js';
import { createLayersPanel } from '../editor/panels/layers.js';
import { openExportDialog, openShortcutsDialog, openNewPageDialog } from '../editor/dialogs.js';
import { AssetStore } from '../services/asset-store.js';
import { storage } from '../services/project-storage.js';
import { AutoSave } from '../services/autosave.js';
import { fonts } from '../services/font-service.js';
import { importFiles } from '../services/asset-import.js';
import { prepareImage } from '../services/image-service.js';
import { importProjectFile } from '../services/projects.js';
import { toast, confirmDialog, showMenu, announce } from '../ui/ui.js';
import { describeError } from '../utils/errors.js';
import { renderNotFound } from './not-found.js';

const NARROW = '(max-width: 900px)';
const LS = 'slatte:layout';

function loadLayout() {
  try {
    const v = JSON.parse(localStorage.getItem(LS) || '{}');
    return { left: Number(v.left) || 280, right: Number(v.right) || 300, leftOpen: v.leftOpen, rightOpen: v.rightOpen };
  } catch {
    return { left: 280, right: 300 };
  }
}

function saveLayout(l) {
  try { localStorage.setItem(LS, JSON.stringify(l)); } catch { /* storage unavailable */ }
}

export async function renderEditor(ctx) {
  const projectId = ctx.params.projectId;
  const loading = h('div.editor-loading', { role: 'status' }, h('span.spin'), h('span', 'Opening project…'));
  ctx.outlet.append(loading);

  /* ------------------------------ load ------------------------------ */
  let rec;
  try {
    rec = await storage.load(projectId);
  } catch (err) {
    console.error(err);
    loading.remove();
    return renderNotFound(ctx, describeError(err, 'We couldn’t read this project from your browser’s storage.'), { title: 'Can’t open project' });
  }
  if (!rec) {
    loading.remove();
    return renderNotFound(ctx, 'This project isn’t stored in this browser. A project link only works on the device that created it. Open a .slt file to bring a project here.', { title: 'Project not found' });
  }
  let doc, warnings;
  try {
    ({ doc, warnings } = validateDocument(rec.doc));
  } catch (err) {
    console.error(err);
    loading.remove();
    return renderNotFound(ctx, describeError(err, 'This project’s data is damaged and couldn’t be opened.'), { title: 'Can’t open project' });
  }
  doc.id = projectId;
  const assets = new AssetStore();
  for (const [id, blob] of rec.assets) assets.put(id, blob, { persisted: true });
  await fonts.prepareDocument(doc, assets);
  loading.remove();
  document.title = `${doc.name} — Slatte`;

  /* ------------------------------ core objects ------------------------------ */
  const d = new Disposer();
  const editor = new Editor(doc, assets);
  const autosave = new AutoSave(editor);
  let stage;
  let closing = false;

  const handleFiles = async (files, at) => {
    const msgs = await importFiles(editor, files, at, { onProject: openProjectFile });
    for (const m of msgs) toast(m.message, { kind: m.kind, duration: m.kind === 'error' ? 8000 : undefined });
  };

  async function openProjectFile(file) {
    const ok = await confirmDialog({ title: 'Open this project?', message: `“${file.name}” opens as a new project. Your current project is saved first.`, confirmLabel: 'Open' });
    if (!ok) return;
    await autosave.flush();
    const { id, warnings: w } = await importProjectFile(file);
    if (w.length) toast(`Opened with notices: ${w[0]}`, { kind: 'warning', duration: 9000 });
    ctx.router.navigate(`/editor/${id}`);
  }

  stage = new Stage(editor, { onDropFiles: (files, at) => handleFiles(files, at).catch((e) => toast(describeError(e), { kind: 'error' })) });
  for (const t of [
    createSelectTool(), createDirectTool(), ...SHAPE_TOOLS.map(createShapeTool), createPenTool(),
    createBrushTool('brush'), createBrushTool('pencil'), createBrushTool('eraser'),
    createTextTool(), createImageTool(), createGradientTool(), createEyedropperTool(), createHandTool(),
  ]) stage.registerTool(t);

  const importDialog = async (kind) => {
    const accept = kind === 'image' ? 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml,.svg'
      : kind === 'font' ? '.ttf,.otf,.woff,.woff2'
        : '.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.ttf,.otf,.woff,.woff2,.slt';
    const files = await pickFiles({ accept, multiple: true });
    if (!files.length) return;
    try { await handleFiles(files); } catch (err) { toast(describeError(err), { kind: 'error' }); }
  };

  const actions = {
    saveNow: async () => {
      await autosave.flush({ thumb: true });
      if (autosave.status === 'saved') toast('Saved to this browser', { kind: 'success', duration: 1800 });
    },
    importDialog,
    openExport: () => openExportDialog(editor),
    openShortcuts: () => openShortcutsDialog(),
    newPageDialog: () => openNewPageDialog(editor),
  };
  const app = { editor, stage, actions };
  const commands = buildCommands(app);
  const shortcuts = new Shortcuts(commands);
  shortcuts.attach();
  d.add(() => shortcuts.detach());

  /* ------------------------------ editor events ------------------------------ */
  d.add(editor.on('toast', (t) => toast(t.message, { kind: t.kind || 'info' })));
  d.add(editor.on('request-image-import', () => importDialog('image')));
  d.add(editor.on('new-paint-layer', () => {
    const page = editor.page;
    const o = createObject('rasterLayer', {
      name: uniqueName(page, 'Paint layer'), x: 0, y: 0, width: page.width, height: page.height, scale: RasterManager.pixelScale(page.width, page.height),
    });
    editor.change('Add paint layer', (pg) => { pg.objects.push(o); });
    editor.activeRasterId = o.id;
    editor.select([o.id]);
    editor.setTool('brush');
    announce('Paint layer added');
  }));
  d.add(editor.on('replace-image', async (id) => {
    const files = await pickFiles({ accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp' });
    if (!files.length) return;
    try {
      const prep = await prepareImage(files[0]);
      const assetId = editor.registerAsset(prep.blob, { name: prep.name, kind: 'image', width: prep.width, height: prep.height });
      editor.change('Replace image', (pg) => {
        const o = pg.objects.find((x) => x.id === id);
        if (!o) return;
        o.assetId = assetId;
        const ar = prep.width / prep.height;
        o.naturalWidth = prep.width; o.naturalHeight = prep.height;
        o.height = o.width / ar;
      });
    } catch (err) {
      toast(describeError(err, 'That image couldn’t be used.'), { kind: 'error' });
    }
  }));
  d.add(editor.on('page', () => { stage.fitPage(); }));
  if (warnings.length) toast(`Opened with ${warnings.length} notice${warnings.length === 1 ? '' : 's'}: ${warnings[0]}`, { kind: 'warning', duration: 9000 });

  /* ------------------------------ top bar ------------------------------ */
  const nameInput = h('input.project-name', { type: 'text', value: doc.name, 'aria-label': 'Project name', maxLength: 120, spellcheck: 'false' });
  const commitName = () => {
    const v = nameInput.value.trim();
    if (!v) { nameInput.value = editor.doc.name; return; }
    if (v !== editor.doc.name) { editor.rename(v); document.title = `${v} — Slatte`; }
  };
  nameInput.addEventListener('blur', commitName);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameInput.blur();
    if (e.key === 'Escape') { nameInput.value = editor.doc.name; nameInput.blur(); }
  });

  const saveText = h('span.save-text');
  const saveBtn = h('button.save-status', { type: 'button', 'aria-live': 'polite' }, saveText);
  const paintSave = () => {
    const s = autosave.status;
    saveBtn.dataset.state = s;
    const label = { saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved changes', error: 'Not saved — retry' }[s];
    saveText.textContent = label;
    saveBtn.title = s === 'error' && autosave.error ? autosave.error : s === 'saved' ? 'Saved in this browser' : 'Click to save now';
    saveBtn.innerHTML = `${icon(s === 'error' ? 'warning' : s === 'saved' ? 'check' : 'save', 14)}`;
    saveBtn.append(saveText);
  };
  saveBtn.addEventListener('click', () => actions.saveNow());
  d.add(autosave.on('status', ({ status, error }) => {
    paintSave();
    if (status === 'error') toast(error || 'Saving failed.', { kind: 'error', action: { label: 'Retry', onClick: () => autosave.flush() }, duration: 9000 });
  }));
  paintSave();

  const undoBtn = h('button.icon-btn', { type: 'button', 'aria-label': `Undo (${formatKeys('mod+Z')})`, title: `Undo (${formatKeys('mod+Z')})`, html: icon('undo', 18), onclick: () => editor.undo() });
  const redoBtn = h('button.icon-btn', { type: 'button', 'aria-label': `Redo (${formatKeys('mod+Shift+Z')})`, title: `Redo (${formatKeys('mod+Shift+Z')})`, html: icon('redo', 18), onclick: () => editor.redo() });
  const paintHistory = () => { undoBtn.disabled = !editor.history.canUndo; redoBtn.disabled = !editor.history.canRedo; };
  d.add(editor.on('history', paintHistory));
  paintHistory();

  const themeBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Toggle light and dark theme' });
  const paintTheme = () => { themeBtn.innerHTML = icon(getTheme() === 'dark' ? 'sun' : 'moon', 18); };
  themeBtn.addEventListener('click', () => { toggleTheme(); paintTheme(); });
  paintTheme();

  const leftToggle = h('button.icon-btn.panel-toggle', { type: 'button', 'aria-label': 'Toggle assets panel', 'aria-pressed': 'true', html: icon('panelLeft', 18) });
  const rightToggle = h('button.icon-btn.panel-toggle', { type: 'button', 'aria-label': 'Toggle properties panel', 'aria-pressed': 'true', html: icon('panelRight', 18) });

  const moreBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'More actions', 'aria-haspopup': 'menu', html: icon('more', 18) });
  moreBtn.addEventListener('click', () => {
    const s = editor.doc.settings;
    showMenu(moreBtn, [
      { label: 'Import files…', icon: 'upload', shortcut: formatKeys('mod+O'), onClick: () => importDialog() },
      { label: 'Save now', icon: 'save', shortcut: formatKeys('mod+S'), onClick: () => actions.saveNow() },
      { label: 'Add page…', icon: 'pages', onClick: () => actions.newPageDialog() },
      { separator: true },
      { label: 'Show rulers', checked: !!s.rulers, onClick: () => run('toggleRulers') },
      { label: 'Show grid', checked: !!editor.page.gridSettings.show, onClick: () => run('toggleGrid') },
      { label: 'Snap to objects', checked: s.snap !== false, onClick: () => run('toggleSnap') },
      { separator: true },
      { label: 'Fit page', icon: 'fit', shortcut: formatKeys('Shift+1'), onClick: () => stage.fitPage() },
      { label: 'Keyboard shortcuts', icon: 'keyboard', shortcut: '?', onClick: () => actions.openShortcuts() },
      { separator: true },
      { label: 'All projects', icon: 'home', onClick: () => goHome() },
    ], { align: 'end' });
  });
  const run = (id) => { const c = shortcuts.find(id); if (c) c.run(); };
  const goHome = async () => { await autosave.flush({ thumb: true }); ctx.router.navigate('/'); };

  const exportBtn = h('button.btn.btn-primary.export-btn', { type: 'button', onclick: () => actions.openExport() }, h('span', { html: icon('download', 16) }), h('span.export-label', 'Export'));

  const topbar = h('header.topbar',
    h('a.brand.brand-mini', { href: '/', 'data-link': '', 'aria-label': 'All projects', title: 'All projects', html: logoMark(24) }),
    leftToggle,
    h('div.topbar-name', nameInput, saveBtn),
    h('div.topbar-spacer'),
    h('div.topbar-actions', undoBtn, redoBtn, themeBtn, exportBtn, moreBtn, rightToggle));
  topbar.querySelector('.brand-mini').addEventListener('click', (e) => {
    // flush before the router unmounts so a quick exit never loses the last edit
    if (e.defaultPrevented || e.button !== 0) return;
    autosave.flush({ thumb: true });
  });

  /* ------------------------------ panels ------------------------------ */
  const rail = createToolRail(editor);
  const left = createLeftPanel(app);
  const inspector = createInspector(app);
  const layers = createLayersPanel(editor);
  d.add(() => { rail.destroy(); left.destroy(); inspector.destroy(); layers.destroy(); });

  const tabs = [['design', 'Design', inspector.el], ['layers', 'Layers', layers.el]];
  const tabBar = h('div.tabbar.tabbar-text', { role: 'tablist', 'aria-label': 'Right panel' });
  const panes = new Map();
  const showRight = (id) => {
    for (const [tid, , el] of tabs) {
      const on = tid === id;
      panes.get(tid).setAttribute('aria-selected', String(on));
      panes.get(tid).tabIndex = on ? 0 : -1;
      el.inert = !on;
      el.classList.toggle('active-panel-tab', on);
    }
    if (id === 'layers') layers.render();
    else inspector.refresh();
  };
  for (const [tid, label] of tabs) {
    const b = h('button.tab', { type: 'button', role: 'tab', id: `rtab-${tid}`, 'aria-selected': 'false', onclick: () => showRight(tid) }, label);
    b.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const next = tabs[(tabs.findIndex((t) => t[0] === tid) + 1) % tabs.length][0]; showRight(next); panes.get(next).focus(); }
    });
    panes.set(tid, b);
    tabBar.append(b);
  }
  for (const [tid, , el] of tabs) { el.setAttribute('role', 'tabpanel'); el.setAttribute('aria-labelledby', `rtab-${tid}`); }

  const leftPanel = h('aside.leftpanel.panel', { 'aria-label': 'Assets and pages' }, left.el);
  const rightPanel = h('aside.rightpanel.panel', { 'aria-label': 'Properties' }, tabBar, h('div.right-body', inspector.el, layers.el));
  showRight('design');

  /* ------------------------------ status bar ------------------------------ */
  const coord = h('span.status-item.coord', { 'aria-label': 'Pointer position' }, '—');
  const selInfo = h('span.status-item.selinfo');
  const zoomLabel = h('button.zoom-label', { type: 'button', 'aria-label': 'Zoom level', 'aria-haspopup': 'menu' }, '100%');
  const pageInfo = h('span.status-item.pageinfo');
  const zoomMenu = () => showMenu(zoomLabel, [
    ...[0.25, 0.5, 1, 2, 4].map((z) => ({ label: `${z * 100}%`, onClick: () => stage.zoomAt(z) })),
    { separator: true },
    { label: 'Fit page', shortcut: formatKeys('Shift+1'), onClick: () => stage.fitPage() },
    { label: 'Fit selection', shortcut: formatKeys('Shift+2'), onClick: () => stage.fitSelection() },
  ], { side: 'top', align: 'end' });
  zoomLabel.addEventListener('click', zoomMenu);
  const zbtn = (name, label, fn) => h('button.icon-btn.sm', { type: 'button', 'aria-label': label, title: label, html: icon(name, 14), onclick: fn });
  const tgl = (name, label, get, fn) => {
    const b = h('button.icon-btn.sm', { type: 'button', 'aria-label': label, title: label, html: icon(name, 14), 'aria-pressed': 'false' });
    b.addEventListener('click', fn);
    b.sync = () => b.setAttribute('aria-pressed', String(!!get()));
    return b;
  };
  const rulerBtn = tgl('ruler', 'Rulers', () => editor.doc.settings.rulers, () => run('toggleRulers'));
  const gridBtn = tgl('grid', 'Grid', () => editor.page.gridSettings.show, () => run('toggleGrid'));
  const snapBtn = tgl('magnet', 'Snapping', () => editor.doc.settings.snap !== false, () => run('toggleSnap'));
  const statusbar = h('footer.statusbar',
    h('div.status-left', pageInfo, selInfo),
    h('div.status-mid', coord),
    h('div.status-right', rulerBtn, gridBtn, snapBtn,
      zbtn('minus', 'Zoom out', () => stage.zoomBy(0.8)), zoomLabel, zbtn('plus', 'Zoom in', () => stage.zoomBy(1.25)), zbtn('fit', 'Fit page', () => stage.fitPage())));
  const paintStatus = () => {
    zoomLabel.textContent = `${Math.round(editor.viewport.zoom * 100)}%`;
    const p = editor.page;
    pageInfo.textContent = `${p.name} · ${p.width} × ${p.height}`;
    const b = editor.selection.length ? editor.bounds() : null;
    selInfo.textContent = b ? `${editor.selection.length} selected · ${Math.round(b.width)} × ${Math.round(b.height)}` : '';
    for (const x of [rulerBtn, gridBtn, snapBtn]) x.sync();
  };
  d.add(editor.on('viewport', paintStatus));
  d.add(editor.on('selection', paintStatus));
  d.add(editor.on('change', paintStatus));
  d.add(editor.on('page', paintStatus));
  d.add(editor.on('pointer', (p) => { coord.textContent = p ? `${Math.round(p.x)}, ${Math.round(p.y)}` : '—'; }));

  /* ------------------------------ layout: collapse + resize ------------------------------ */
  const narrow = matchMedia(NARROW);
  const layout = loadLayout();
  const state = { leftOpen: narrow.matches ? false : layout.leftOpen !== false, rightOpen: narrow.matches ? false : layout.rightOpen !== false };

  const resizer = (side) => {
    const el = h('div.resizer', {
      role: 'separator', 'aria-orientation': 'vertical', tabindex: 0,
      'aria-label': side === 'left' ? 'Resize assets panel' : 'Resize properties panel',
    });
    const set = (w) => {
      layout[side] = Math.max(220, Math.min(480, Math.round(w)));
      root.style.setProperty(`--${side}-w`, `${layout[side]}px`);
      el.setAttribute('aria-valuenow', String(layout[side]));
      saveLayout({ ...layout, ...state });
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const x0 = e.clientX, w0 = layout[side];
      const move = (ev) => set(w0 + (side === 'left' ? ev.clientX - x0 : x0 - ev.clientX));
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
    el.addEventListener('keydown', (e) => {
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      set(layout[side] + (side === 'left' ? dir : -dir) * 16);
    });
    el.setAttribute('aria-valuenow', String(layout[side]));
    el.setAttribute('aria-valuemin', '220');
    el.setAttribute('aria-valuemax', '480');
    return el;
  };

  const stageWrap = h('main.stage-wrap', { id: 'main' }, stage.el);
  const scrim = h('div.scrim', { onclick: () => { state.leftOpen = false; state.rightOpen = false; applyLayout(); } });
  const root = h('div.editor-app',
    h('a.skip', { href: '#main' }, 'Skip to canvas'),
    topbar,
    h('div.workspace', leftPanel, resizer('left'), stageWrap, rail.el, resizer('right'), rightPanel, scrim),
    statusbar);
  root.style.setProperty('--left-w', `${layout.left}px`);
  root.style.setProperty('--right-w', `${layout.right}px`);

  function applyLayout() {
    root.classList.toggle('show-left', state.leftOpen);
    root.classList.toggle('show-right', state.rightOpen);
    root.classList.toggle('narrow', narrow.matches);
    leftToggle.setAttribute('aria-pressed', String(state.leftOpen));
    rightToggle.setAttribute('aria-pressed', String(state.rightOpen));
    leftPanel.inert = !state.leftOpen;
    rightPanel.inert = !state.rightOpen;
    saveLayout({ ...layout, ...(narrow.matches ? { leftOpen: layout.leftOpen, rightOpen: layout.rightOpen } : state) });
    requestAnimationFrame(() => stage._resize());
  }
  leftToggle.addEventListener('click', () => { state.leftOpen = !state.leftOpen; if (narrow.matches && state.leftOpen) state.rightOpen = false; applyLayout(); });
  rightToggle.addEventListener('click', () => { state.rightOpen = !state.rightOpen; if (narrow.matches && state.rightOpen) state.leftOpen = false; applyLayout(); });
  const onNarrow = () => { state.leftOpen = !narrow.matches; state.rightOpen = !narrow.matches; applyLayout(); };
  narrow.addEventListener('change', onNarrow);
  d.add(() => narrow.removeEventListener('change', onNarrow));

  // On small screens, selecting a tool or object closes drawers so the canvas is usable.
  d.add(editor.on('tool', () => { if (narrow.matches && (state.leftOpen || state.rightOpen)) { state.leftOpen = false; state.rightOpen = false; applyLayout(); } }));

  ctx.outlet.append(root);
  applyLayout();
  stage.start();
  paintStatus();
  for (const el of [leftPanel, rightPanel]) el.hidden = false;

  /* ------------------------------ lifecycle ------------------------------ */
  d.listen(window, 'beforeunload', (e) => {
    if (autosave.status !== 'saved') { e.preventDefault(); e.returnValue = ''; }
  });
  d.listen(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') autosave.flush(); });
  if (storage.volatile) toast('Your browser is blocking local storage, so this project won’t survive closing the tab. Export a .slt backup.', { kind: 'warning', duration: 12000 });

  window.__slatte = Object.assign(window.__slatte || {}, { app, autosave });

  return {
    app,
    destroy() {
      if (closing) return;
      closing = true;
      d.dispose();
      narrow.removeEventListener('change', onNarrow);
      const finish = () => { stage.destroy(); autosave.dispose(); assets.dispose(); };
      autosave.flush({ thumb: true }).catch(() => {}).finally(finish);
      root.remove();
      if (window.__slatte) { delete window.__slatte.app; delete window.__slatte.autosave; }
    },
  };
}
