import { h, download } from '../utils/dom.js';
import { icon } from '../core/icons.js';
import { PAGE_PRESETS } from '../core/document-model.js';
import { EXPORT_FORMATS, runExport } from '../services/export-runner.js';
import { SHORTCUT_GROUPS } from '../core/commands.js';
import { formatKeys } from '../core/shortcuts.js';
import { colorInput, numberInput, row, segmented, slider, toggle } from '../ui/controls.js';
import { openDialog, toast, announce } from '../ui/ui.js';
import { describeError } from '../utils/errors.js';
import { formatBytes } from '../utils/file-validation.js';

export function openExportDialog(editor) {
  const state = { format: 'png', scope: 'page', scale: 2, quality: 0.92, transparent: false, embedFonts: true, includeFonts: true };
  const settings = h('div.export-settings');
  const note = h('p.hint.export-note');
  const progressWrap = h('div.progress', { hidden: true, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('div.progress-bar'));
  const status = h('p.export-status', { role: 'status', 'aria-live': 'polite' });
  const warningsEl = h('ul.export-warnings');
  let busy = false;

  const fmtButtons = h('div.fmt-grid', { role: 'radiogroup', 'aria-label': 'Export format' }, EXPORT_FORMATS.map((f) => h('button.fmt', {
    type: 'button', role: 'radio', 'aria-checked': String(f.id === state.format), dataset: { fmt: f.id },
    onclick: () => { state.format = f.id; render(); },
  }, h('span.fmt-name', f.id.toUpperCase()), h('span.fmt-desc', f.label.replace(/^[A-Z]+ /, '')))));

  const render = () => {
    fmtButtons.querySelectorAll('.fmt').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.fmt === state.format)));
    settings.replaceChildren();
    const f = state.format;
    const multi = editor.doc.pages.length > 1;
    if (f !== 'slt' && multi) {
      settings.append(row('Pages', segmented({ label: 'Pages to export', options: [{ value: 'page', label: `Current (${editor.page.name})` }, { value: 'all', label: `All ${editor.doc.pages.length}` }], value: state.scope, iconOnly: false, onChange: (v) => { state.scope = v; render(); } }).el));
    }
    if (f === 'png' || f === 'jpeg' || f === 'pdf') {
      settings.append(row(f === 'pdf' ? 'Quality' : 'Scale', segmented({ label: 'Scale', options: [1, 2, 3].map((n) => ({ value: n, label: `${n}×` })), value: state.scale, iconOnly: false, onChange: (v) => { state.scale = v; render(); } }).el));
      const p = editor.page;
      settings.append(h('p.hint', `Output size: ${Math.round(p.width * state.scale)} × ${Math.round(p.height * state.scale)} px`));
    }
    if (f === 'png' || f === 'svg') {
      const t = toggle({ label: 'Transparent background', value: state.transparent, onChange: (v) => { state.transparent = v; } });
      settings.append(row('Transparent', t.el));
    }
    if (f === 'jpeg') {
      const q = slider({ label: 'JPEG quality', value: Math.round(state.quality * 100), min: 30, max: 100, unit: '%', onInput: (v) => { state.quality = v / 100; } });
      settings.append(row('Quality', q.el), h('p.hint', 'JPEG has no transparency; transparent pages are placed on white.'));
    }
    if (f === 'svg') {
      const t = toggle({ label: 'Embed fonts', value: state.embedFonts, onChange: (v) => { state.embedFonts = v; } });
      settings.append(row('Embed fonts', t.el));
    }
    if (f === 'slt') {
      const t = toggle({ label: 'Include custom fonts', value: state.includeFonts, onChange: (v) => { state.includeFonts = v; } });
      settings.append(row('Include fonts', t.el), h('p.hint', 'Saves every page, layer, effect and embedded asset in one portable file you can re-open later. Only include fonts you’re licensed to share.'));
    }
    note.textContent = {
      png: 'Pixel-perfect image of your design, rendered from the document (not a screenshot).',
      jpeg: 'Smaller files for photos and sharing. No transparency.',
      svg: 'Editable vector file. Text, shapes, gradients and effects are preserved; paint layers and images are embedded.',
      pdf: 'Pages are embedded as high-resolution images, so text isn’t selectable. Use SVG for vector output.',
      slt: 'Your editable project: portable and self-contained.',
    }[f];
  };

  const setProgress = (v) => {
    progressWrap.hidden = false;
    progressWrap.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    progressWrap.firstChild.style.width = `${Math.round(v * 100)}%`;
  };

  const go = async (dlg) => {
    if (busy) return false;
    busy = true;
    warningsEl.replaceChildren();
    status.textContent = 'Preparing export…';
    announce('Preparing export');
    setProgress(0.02);
    dlg.foot.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      const res = await runExport(editor, state, setProgress);
      download(res.blob, res.filename);
      setProgress(1);
      status.textContent = `Exported ${res.filename} (${formatBytes(res.blob.size)}).`;
      toast(`Exported ${res.filename}`, { kind: 'success' });
      announce(`Exported ${res.filename}`);
      for (const w of res.warnings) warningsEl.append(h('li', h('span', { html: icon('warning', 14) }), w));
      dlg.foot.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      const closeBtn = dlg.foot.querySelector('button:not(.btn-primary)');
      if (closeBtn) closeBtn.textContent = 'Done';
      if (!res.warnings.length) setTimeout(() => dlg.close('done'), 900);
    } catch (err) {
      console.error(err);
      status.textContent = '';
      progressWrap.hidden = true;
      warningsEl.append(h('li.err', h('span', { html: icon('error', 14) }), describeError(err, 'The export failed. Try a lower scale or another format.')));
      dlg.foot.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    } finally {
      busy = false;
    }
    return false;
  };

  const dlg = openDialog({
    title: 'Export',
    wide: true,
    body: h('div.export', fmtButtons, settings, note, progressWrap, status, warningsEl),
    actions: [
      { label: 'Cancel' },
      { label: 'Export', primary: true, onClick: () => go(dlg) },
    ],
  });
  render();
  return dlg;
}

export function openShortcutsDialog() {
  const row = ([name, keys]) => h('div.sc-row', h('dt', name), h('dd', String(keys).split(' / ').map((k) => h('kbd', formatKeys(k)))));
  const body = h('div.shortcuts', SHORTCUT_GROUPS.map((g) => h('section', h('h3', g.title), h('dl', g.items.map(row)))));
  return openDialog({ title: 'Keyboard shortcuts', body, wide: true, actions: [{ label: 'Close', primary: true }] });
}

export function openNewPageDialog(editor) {
  const first = PAGE_PRESETS[0];
  const st = { name: `Page ${editor.doc.pages.length + 1}`, width: first.width, height: first.height, color: '#ffffff' };
  const name = h('input.text-input', { type: 'text', value: st.name, 'aria-label': 'Page name', maxLength: 80 });
  name.addEventListener('input', () => { st.name = name.value; });
  const w = numberInput({ label: 'Width', value: st.width, min: 1, max: 16000, dp: 0, unit: 'px', onInput: (v) => { st.width = Math.round(v); } });
  const hh = numberInput({ label: 'Height', value: st.height, min: 1, max: 16000, dp: 0, unit: 'px', onInput: (v) => { st.height = Math.round(v); } });
  const grid = h('div.preset-grid', PAGE_PRESETS.map((p) => h('button.preset-card', {
    type: 'button', onclick: () => { st.width = p.width; st.height = p.height; w.set(p.width); hh.set(p.height); },
  }, h('span.preset-name', p.name), h('span.preset-size', `${p.width} × ${p.height}`))));
  const color = colorInput({ label: 'Background', value: st.color, onInput: (v) => { st.color = v; } });
  return openDialog({
    title: 'Add page',
    body: h('div.newpage', row('Name', name), grid, h('div.grid2', row('Width', w.el), row('Height', hh.el)), row('Background', color.el)),
    wide: true,
    actions: [
      { label: 'Cancel' },
      { label: 'Add page', primary: true, onClick: () => { editor.addPage({ name: st.name.trim() || undefined, width: st.width, height: st.height, background: { color: st.color } }); } },
    ],
  });
}
