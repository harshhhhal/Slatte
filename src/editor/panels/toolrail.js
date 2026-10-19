import { h } from '../../utils/dom.js';
import { icon } from '../../core/icons.js';
import { showMenu } from '../../ui/ui.js';
import { formatKeys } from '../../core/shortcuts.js';

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
  { id: 'eyedropper', icon: 'eyedropper', label: 'Eyedropper', key: 'I' },
  { id: 'hand', icon: 'hand', label: 'Hand', key: 'H' },
];

/** Compact vertical tool rail. Grouped tools open a flyout on re-click, long-press or the corner mark. */
export function createToolRail(editor) {
  const nav = h('nav.toolrail', { 'aria-label': 'Tools' });
  const buttons = new Map();
  const lastInGroup = { shapes: 'rectangle', paint: 'brush' };

  const activate = (id) => editor.setTool(id);

  const label = (t) => `${t.label}${t.key ? ` (${formatKeys(t.key)})` : ''}`;

  for (const t of TOOLS) {
    if (t.group) {
      const first = t.items.find((i) => i.id === lastInGroup[t.group]);
      const btn = h('button.tool-btn.has-flyout', { type: 'button', 'aria-haspopup': 'menu', 'aria-label': t.label, title: t.label });
      const corner = h('span.flyout-mark', { html: icon('chevronRight', 8) });
      btn.append(h('span.tool-icon'), corner);
      const refresh = () => {
        const cur = t.items.find((i) => i.id === lastInGroup[t.group]) || first;
        btn.querySelector('.tool-icon').innerHTML = icon(cur.icon, 20);
        btn.title = label(cur);
        btn.setAttribute('aria-label', `${cur.label}. More ${t.label.toLowerCase()} tools`);
      };
      const openFlyout = () => showMenu(btn, t.items.map((i) => ({
        label: i.label, icon: i.icon, shortcut: i.key ? formatKeys(i.key) : '',
        checked: editor.toolId === i.id ? true : undefined,
        onClick: () => { lastInGroup[t.group] = i.id; refresh(); activate(i.id); },
      })), { side: 'right' });
      let timer = null, long = false;
      btn.addEventListener('pointerdown', () => { long = false; timer = setTimeout(() => { long = true; openFlyout(); }, 420); });
      btn.addEventListener('pointerup', () => clearTimeout(timer));
      btn.addEventListener('pointerleave', () => clearTimeout(timer));
      btn.addEventListener('click', (e) => {
        if (long) { long = false; return; }
        const inGroup = t.items.some((i) => i.id === editor.toolId);
        if (e.target.closest('.flyout-mark') || inGroup) openFlyout(); else activate(lastInGroup[t.group]);
      });
      btn.addEventListener('contextmenu', (e) => { e.preventDefault(); openFlyout(); });
      btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { e.preventDefault(); openFlyout(); } });
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
  sync();
  return { el: nav, destroy: off };
}
