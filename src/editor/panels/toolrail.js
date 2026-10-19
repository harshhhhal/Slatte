import { h } from '../../utils/dom.js';
import { icon } from '../../core/icons.js';
import { formatKeys } from '../../core/shortcuts.js';
import { BRUSH_PRESETS, drawPresetPreview } from '../brush-engine.js';

const TOOLS = [
  { id: 'select', icon: 'select', label: 'Select', key: 'V' },
  { id: 'direct', icon: 'direct', label: 'Direct select', key: 'A' },
  { id: 'frame', icon: 'frame', label: 'Frame', key: 'F' },
  {
    group: 'shapes', label: 'Shapes', items: [
      { id: 'rectangle', icon: 'rect', label: 'Rectangle', key: 'R' },
      { id: 'roundedRectangle', icon: 'rounded', label: 'Rounded rectangle' },
      { id: 'ellipse', icon: 'ellipse', label: 'Ellipse', key: 'O' },
      { id: 'line', icon: 'line', label: 'Line', key: 'L' },
      { id: 'triangle', icon: 'triangle', label: 'Triangle' },
      { id: 'polygon', icon: 'polygon', label: 'Polygon' },
      { id: 'star', icon: 'star', label: 'Star' },
      { id: 'arrow', icon: 'arrow', label: 'Arrow' },
    ],
  },
  { id: 'pen', icon: 'pen', label: 'Pen', key: 'P' },
  {
    group: 'paint', label: 'Paint', items: [
      { id: 'brush', icon: 'brush', label: 'Brush', key: 'B' },
      { id: 'pencil', icon: 'pencil', label: 'Pencil', key: 'N' },
      { id: 'eraser', icon: 'eraser', label: 'Eraser', key: 'E' },
    ],
  },
  { id: 'text', icon: 'text', label: 'Text', key: 'T' },
  { id: 'gradient', icon: 'gradient', label: 'Gradient', key: 'G' },
  { id: 'hand', icon: 'hand', label: 'Hand', key: 'H' },
];

/** Compact tool dock with a horizontal sub-dock for grouped tools. */
export function createToolRail(editor) {
  const nav = h('nav.toolrail', { 'aria-label': 'Tools' });
  const subdock = h('div.tool-subdock', { 'aria-label': 'Tool options', hidden: true });
  const buttons = new Map();
  const lastInGroup = { shapes: 'rectangle', paint: 'brush' };
  let openGroup = null;

  const activate = (id) => editor.setTool(id);

  const label = (t) => `${t.label}${t.key ? ` (${formatKeys(t.key)})` : ''}`;

  const closeSubdock = () => {
    openGroup = null;
    subdock.hidden = true;
    subdock.replaceChildren();
    for (const { btn, group } of buttons.values()) if (group) {
      btn.classList.remove('expanded');
      btn.setAttribute('aria-expanded', 'false');
    }
  };

  const renderSubdock = (group) => {
    const items = group.items.map((item) => h('button.subtool-btn', {
      type: 'button', title: label(item), 'aria-label': label(item), 'aria-pressed': String(editor.toolId === item.id),
      class: editor.toolId === item.id ? 'active' : '',
      onclick: () => {
        lastInGroup[group.group] = item.id;
        activate(item.id);
        if (group.group === 'paint' && item.id === 'brush') renderSubdock(group);
        else closeSubdock();
      },
    }, h('span.subtool-icon', { html: icon(item.icon, 18) }), h('span.subtool-label', item.label)));
    const presets = group.group === 'paint' && editor.toolId === 'brush'
      ? h('div.subdock-brushes', { role: 'radiogroup', 'aria-label': 'Brush presets' }, BRUSH_PRESETS.map((preset) => {
        const canvas = h('canvas', { width: 52, height: 20, 'aria-hidden': 'true' });
        requestAnimationFrame(() => drawPresetPreview(canvas, preset, getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#18181b'));
        return h('button.subdock-brush', {
          type: 'button', role: 'radio', 'aria-checked': String(editor.toolOptions.brush.preset === preset.id),
          title: preset.name, 'aria-label': preset.name,
          onclick: () => {
            editor.toolOptions.brush.preset = preset.id;
            editor.emit('brush');
            activate('brush');
            renderSubdock(group);
          },
        }, canvas, h('span.subdock-brush-label', preset.name));
      }))
      : null;
    subdock.classList.toggle('with-brush-presets', !!presets);
    subdock.replaceChildren(...items, ...(presets ? [presets] : []));
  };

  const showSubdock = (group) => {
    if (openGroup === group.group) { closeSubdock(); return; }
    openGroup = group.group;
    renderSubdock(group);
    subdock.hidden = false;
    for (const { btn, group: meta } of buttons.values()) if (meta) {
      const expanded = meta.group === group.group;
      btn.classList.toggle('expanded', expanded);
      btn.setAttribute('aria-expanded', String(expanded));
    }
  };

  for (const t of TOOLS) {
    if (t.group) {
      const first = t.items.find((i) => i.id === lastInGroup[t.group]);
      const btn = h('button.tool-btn.has-flyout', { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-label': t.label, title: t.label });
      const corner = h('span.flyout-mark', { html: icon('chevronRight', 8) });
      btn.append(h('span.tool-icon'), corner);
      const refresh = () => {
        const cur = t.items.find((i) => i.id === lastInGroup[t.group]) || first;
        btn.querySelector('.tool-icon').innerHTML = icon(cur.icon, 20);
        btn.title = label(cur);
        btn.setAttribute('aria-label', `${cur.label}. More ${t.label.toLowerCase()} tools`);
      };
      btn.addEventListener('click', () => showSubdock(t));
      btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); showSubdock(t); } });
      refresh();
      buttons.set(t.group, { btn, group: t });
      nav.append(btn);
    } else {
      const btn = h('button.tool-btn', { type: 'button', 'aria-label': t.label, title: label(t), onclick: () => activate(t.id), html: icon(t.icon, 20) });
      buttons.set(t.id, { btn, tool: t });
      nav.append(btn);
    }
    if (['frame', 'pen', 'gradient'].includes(t.id)) nav.append(h('div.rail-sep', { role: 'separator' }));
  }

  const sync = () => {
    for (const [key, { btn, group }] of buttons) {
      let on;
      if (group) {
        const hit = group.items.find((i) => i.id === editor.toolId);
        on = !!hit;
        if (hit) { lastInGroup[group.group] = hit.id; btn.querySelector('.tool-icon').innerHTML = icon(hit.icon, 20); btn.title = label(hit); }
      } else on = editor.toolId === key;
      btn.setAttribute('aria-pressed', String(on));
      btn.classList.toggle('active', on);
    }
  };
  const off = editor.on('tool', sync);
  const onPointerDown = (e) => { if (!nav.contains(e.target) && !subdock.contains(e.target)) closeSubdock(); };
  const onKeyDown = (e) => { if (e.key === 'Escape' && openGroup) { e.stopPropagation(); closeSubdock(); } };
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  sync();
  return { el: nav, subdock, destroy: () => { off(); closeSubdock(); document.removeEventListener('pointerdown', onPointerDown, true); document.removeEventListener('keydown', onKeyDown, true); } };
}
