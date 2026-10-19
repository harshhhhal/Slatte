import { h } from '../utils/dom.js';
import { PAGE_PRESETS } from '../core/document-model.js';
import { createProject } from '../services/projects.js';
import { openDialog, toast } from '../ui/ui.js';
import { selectInput } from '../ui/controls.js';
import { describeError } from '../utils/errors.js';

function shape(p) {
  const ratio = p.width / p.height;
  const width = ratio >= 1 ? 58 : Math.max(18, Math.round(58 * ratio));
  const height = ratio >= 1 ? Math.max(18, Math.round(58 / ratio)) : 58;
  return h('span.size-shape', { style: { width: `${width}px`, height: `${height}px` } });
}

function presetCards(presets, onChoose) {
  return h('ul.size-grid', presets.map((preset) => {
    const button = h('button.size-card', { type: 'button' }, shape(preset),
      h('span.size-name', preset.name), h('span.size-dim', `${preset.width} x ${preset.height} px`));
    button.addEventListener('click', () => onChoose(preset, button));
    return h('li', button);
  }));
}

export function presetGroups(onChoose) {
  const groups = [...new Set(PAGE_PRESETS.map((preset) => preset.group))];
  return groups.map((group) => h('section.size-group', { 'aria-label': group },
    h('h3', group), presetCards(PAGE_PRESETS.filter((preset) => preset.group === group), onChoose)));
}

export function openNewDesignDialog(ctx) {
  const width = h('input.text-input', { type: 'number', min: 0.01, step: 'any', value: 1200, 'aria-label': 'Custom width' });
  const height = h('input.text-input', { type: 'number', min: 0.01, step: 'any', value: 800, 'aria-label': 'Custom height' });
  const unitFactors = { px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72 };
  let selectedUnit = 'px';
  const unit = selectInput({ label: 'Measurement unit', className: 'unit-select', value: selectedUnit,
    options: [['px', 'px'], ['in', 'in'], ['cm', 'cm'], ['mm', 'mm'], ['pt', 'pt']].map(([value, label]) => ({ value, label })),
    onChange: (nextUnit) => {
    const oldFactor = unitFactors[selectedUnit];
    const newFactor = unitFactors[nextUnit];
    const convert = (input) => {
      const px = Number(input.value) * oldFactor;
      input.value = String(Number((px / newFactor).toFixed(3)));
    };
    convert(width);
    convert(height);
    selectedUnit = nextUnit;
  } });
  const error = h('p.field-error', { role: 'alert' });
  const groups = [...new Set(PAGE_PRESETS.map((preset) => preset.group))];
  const presets = h('div.picker-presets');
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
  const choose = (preset, button) => start({ preset: preset.id, name: preset.name }, button);
  let selectedGroup = groups[0];
  const renderPresets = (group, direction = '') => {
    selectedGroup = group;
    presets.classList.remove('slide-next', 'slide-previous');
    presets.replaceChildren(presetCards(PAGE_PRESETS.filter((preset) => preset.group === group), choose));
    if (!direction) return;
    presets.classList.add(direction);
    presets.querySelector('.size-grid')?.addEventListener('animationend', () => {
      presets.classList.remove(direction);
    }, { once: true });
  };
  renderPresets(selectedGroup);
  const tabs = h('div.picker-tabs', { role: 'tablist', 'aria-label': 'Canvas categories' }, groups.map((group, index) => {
    const tab = h('button.picker-tab', { type: 'button', role: 'tab', 'aria-selected': index === 0, class: index === 0 ? 'active' : '' }, group);
    tab.addEventListener('click', () => {
      const previousIndex = groups.indexOf(selectedGroup);
      const nextIndex = groups.indexOf(group);
      for (const item of tabs.children) {
        const active = item === tab;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
      }
      renderPresets(group, nextIndex > previousIndex ? 'slide-next' : 'slide-previous');
    });
    return tab;
  }));
  const customCreate = h('button.btn.btn-primary', { type: 'button', onclick: (event) => {
    const factor = unitFactors[selectedUnit];
    const w = Math.round(Number(width.value) * factor), hh = Math.round(Number(height.value) * factor);
    if (!(w >= 1 && w <= 16000 && hh >= 1 && hh <= 16000)) {
      error.textContent = 'Keep each dimension between 1 and 16,000 px.';
      return;
    }
    error.textContent = '';
    start({ width: w, height: hh, name: 'Untitled design' }, event.currentTarget);
  } }, 'Create');
  const body = h('div.template-picker',
    tabs,
    presets,
    h('section.custom-group', h('div.custom-heading', h('h3', 'Custom size')),
      h('div.custom-size', h('label', 'Width', width), h('span.custom-times', 'x'), h('label', 'Height', height),
        h('label.unit-field', 'Units', unit), customCreate),
      error));
  modal = openDialog({ title: 'Choose a canvas', body, wide: true });
  modal.el.classList.add('template-dialog');
  return modal;
}
