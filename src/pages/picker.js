import { h } from '../utils/dom.js';
import { PAGE_PRESETS } from '../core/document-model.js';
import { createProject } from '../services/projects.js';
import { openDialog, toast } from '../ui/ui.js';
import { describeError } from '../utils/errors.js';

function shape(p) {
  const ratio = p.width / p.height;
  const width = ratio >= 1 ? 58 : Math.max(18, Math.round(58 * ratio));
  const height = ratio >= 1 ? Math.max(18, Math.round(58 / ratio)) : 58;
  return h('span.size-shape', { style: { width: `${width}px`, height: `${height}px` } });
}

export function presetGroups(onChoose) {
  const groups = [...new Set(PAGE_PRESETS.map((preset) => preset.group))];
  return groups.map((group) => h('section.size-group', { 'aria-label': group },
    h('h3', group),
    h('ul.size-grid', PAGE_PRESETS.filter((preset) => preset.group === group).map((preset) => {
      const button = h('button.size-card', { type: 'button' }, shape(preset),
        h('span.size-name', preset.name), h('span.size-dim', `${preset.width} × ${preset.height} px`));
      button.addEventListener('click', () => onChoose(preset, button));
      return h('li', button);
    }))));
}

export function openNewDesignDialog(ctx) {
  const width = h('input.text-input', { type: 'number', min: 1, max: 16000, value: 1200, 'aria-label': 'Custom width in pixels' });
  const height = h('input.text-input', { type: 'number', min: 1, max: 16000, value: 800, 'aria-label': 'Custom height in pixels' });
  const error = h('p.field-error', { role: 'alert' });
  let modal;
  const start = async (options, button) => {
    if (button) button.disabled = true;
    try {
      const id = await createProject(options);
      modal.close('created');
      ctx.router.navigate(`/editor/${id}`);
    } catch (err) {
      console.error(err);
      toast(describeError(err, 'Could not create the project.'), { kind: 'error' });
      if (button) button.disabled = false;
    }
  };
  const body = h('div.template-picker',
    h('p.picker-hint', 'Pick a starting size. You can add more pages later.'),
    presetGroups((preset, button) => start({ preset: preset.id, name: preset.name }, button)),
    h('section.size-group.custom-group', h('h3', 'Custom size'),
      h('div.custom-size', h('label', 'Width', width), h('span', '×'), h('label', 'Height', height), h('span.muted', 'px'),
        h('button.btn.btn-primary', { type: 'button', onclick: (event) => {
          const w = Math.round(Number(width.value)), hh = Math.round(Number(height.value));
          if (!(w >= 1 && w <= 16000 && hh >= 1 && hh <= 16000)) {
            error.textContent = 'Enter a width and height between 1 and 16000 px.';
            return;
          }
          error.textContent = '';
          start({ width: w, height: hh, name: 'Untitled design' }, event.currentTarget);
        } }, 'Create')),
      error));
  modal = openDialog({ title: 'Choose your canvas', body, wide: true });
  modal.el.classList.add('template-dialog');
  return modal;
}
