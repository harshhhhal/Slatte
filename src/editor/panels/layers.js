import { h, debounce } from '../../utils/dom.js';
import { icon, typeIconName } from '../../core/icons.js';
import { childrenOf, isContainer, typeLabel, descendantIds } from '../../core/document-model.js';
import { iconButton, selectInput } from '../../ui/controls.js';

const FILTERS = [
  ['all', 'All types'], ['text', 'Text'], ['image', 'Images'], ['path', 'Paths'], ['shapes', 'Shapes'],
  ['rasterLayer', 'Paint'], ['group', 'Groups'], ['icon', 'Icons'],
];
const SHAPES = ['rectangle', 'roundedRectangle', 'ellipse', 'line', 'polygon', 'star', 'arrow'];

/** Layer tree: select, rename, hide, lock, group, reorder by drag, search and filter. */
export function createLayersPanel(editor) {
  const root = h('div.layers');
  let query = '';
  let filter = 'all';
  let dragId = null;
  const collapsed = new Set();

  const search = h('input.search', { type: 'search', placeholder: 'Search layers', 'aria-label': 'Search layers' });
  const filterSel = selectInput({ label: 'Filter by type', className: 'small', options: FILTERS.map(([value, label]) => ({ value, label })), value: filter,
    onChange: (value) => { filter = value; render(); } });
  const list = h('ul.layer-list', { role: 'tree', 'aria-label': 'Layers', 'aria-multiselectable': 'true' });
  const empty = h('div.empty', h('p.empty-title', 'No layers yet'), h('p', 'Draw a shape, add text or import an image to get started.'));
  const footer = h('div.layers-foot',
    iconButton({ name: 'group', label: 'Group selection', onClick: () => editor.group() }),
    iconButton({ name: 'ungroup', label: 'Ungroup', onClick: () => editor.ungroup() }),
    iconButton({ name: 'copy', label: 'Duplicate', onClick: () => editor.duplicateSelection() }),
    iconButton({ name: 'brush', label: 'New paint layer', onClick: () => editor.emit('new-paint-layer') }),
    h('span.spacer'),
    iconButton({ name: 'trash', label: 'Delete', onClick: () => editor.deleteSelection() }));
  root.append(h('div.layers-tools', search, filterSel.el), list, empty, footer);

  const matches = (o) => {
    if (query && !o.name.toLowerCase().includes(query.toLowerCase())) return false;
    if (filter === 'all') return true;
    if (filter === 'shapes') return SHAPES.includes(o.type);
    return o.type === filter;
  };

  const rowFor = (o, depth, idx) => {
    const selected = editor.selection.includes(o.id);
    const hidden = !o.visible, locked = o.locked;
    const container = isContainer(o);
    const isCollapsed = collapsed.has(o.id);
    const li = h('li.layer', {
      role: 'treeitem', 'aria-selected': String(selected), 'aria-level': depth + 1, draggable: 'true', dataset: { id: o.id },
      class: [selected ? 'selected' : '', hidden ? 'is-hidden' : '', locked ? 'is-locked' : ''].join(' '),
      style: { '--depth': depth },
    });
    const chev = container
      ? h('button.layer-chev', {
        type: 'button', 'aria-label': isCollapsed ? 'Expand' : 'Collapse', 'aria-expanded': String(!isCollapsed),
        onclick: (e) => { e.stopPropagation(); if (collapsed.has(o.id)) collapsed.delete(o.id); else collapsed.add(o.id); render(); },
        html: icon(isCollapsed ? 'chevronRight' : 'chevronDown', 14),
      })
      : h('span.layer-chev-space');
    const name = h('span.layer-name', { title: `${o.name} · ${typeLabel(o.type)}` }, o.name);
    const row = h('div.layer-row', { tabindex: 0 },
      chev,
      h('span.layer-type', { html: icon(typeIconName(o.type), 16) }),
      name,
      h('button.layer-act', {
        type: 'button', 'aria-label': hidden ? `Show ${o.name}` : `Hide ${o.name}`, 'aria-pressed': String(hidden), title: hidden ? 'Show' : 'Hide',
        onclick: (e) => { e.stopPropagation(); editor.toggle(o.id, 'visible'); }, html: icon(hidden ? 'eyeOff' : 'eye', 15),
      }),
      h('button.layer-act', {
        type: 'button', 'aria-label': locked ? `Unlock ${o.name}` : `Lock ${o.name}`, 'aria-pressed': String(locked), title: locked ? 'Unlock' : 'Lock',
        onclick: (e) => { e.stopPropagation(); editor.toggle(o.id, 'locked'); }, html: icon(locked ? 'lock' : 'unlock', 15),
      }));
    li.append(row);
    row.addEventListener('click', (e) => {
      if (e.shiftKey && editor.selection.length) {
        const flat = [...list.querySelectorAll('.layer')].map((l) => l.dataset.id);
        const a = flat.indexOf(editor.selection[editor.selection.length - 1]), b = flat.indexOf(o.id);
        if (a >= 0 && b >= 0) editor.select(flat.slice(Math.min(a, b), Math.max(a, b) + 1));
      } else if (e.metaKey || e.ctrlKey) editor.select([o.id], { toggle: true });
      else editor.select([o.id]);
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editor.select([o.id]); }
      if (e.key === 'F2') { e.preventDefault(); startRename(o, name); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const rows = [...list.querySelectorAll('.layer-row')];
        const i = rows.indexOf(row);
        const n = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
        if (n) n.focus();
      }
    });
    name.addEventListener('dblclick', (e) => { e.stopPropagation(); startRename(o, name); });
    // drag & drop reorder
    li.addEventListener('dragstart', (e) => {
      dragId = o.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', o.id);
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => { dragId = null; li.classList.remove('dragging'); list.querySelectorAll('.drop-before,.drop-after,.drop-into').forEach((n) => n.classList.remove('drop-before', 'drop-after', 'drop-into')); });
    li.addEventListener('dragover', (e) => {
      if (!dragId || dragId === o.id) return;
      e.preventDefault();
      const r = li.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      li.classList.toggle('drop-before', y < (container ? 0.3 : 0.5));
      li.classList.toggle('drop-after', y >= (container ? 0.7 : 0.5));
      li.classList.toggle('drop-into', container && y >= 0.3 && y < 0.7);
    });
    li.addEventListener('dragleave', () => li.classList.remove('drop-before', 'drop-after', 'drop-into'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      const into = li.classList.contains('drop-into'), before = li.classList.contains('drop-before');
      li.classList.remove('drop-before', 'drop-after', 'drop-into');
      if (!dragId || dragId === o.id) return;
      const page = editor.page;
      if (descendantIds(page, dragId).includes(o.id)) return;
      if (into) {
        editor.moveLayer(dragId, o.id, childrenOf(page, o.id).length);
      } else {
        const parent = o.parentId || null;
        const sibs = childrenOf(page, parent).map((x) => x.id).filter((i) => i !== dragId);
        const at = sibs.indexOf(o.id);
        // list is displayed top-first, so "before" in the UI means higher z-index
        editor.moveLayer(dragId, parent, before ? at + 1 : at);
      }
      dragId = null;
    });
    return li;
  };

  const startRename = (o, nameEl) => {
    const input = h('input.rename', { type: 'text', value: o.name, 'aria-label': 'Layer name', maxLength: 120 });
    nameEl.replaceWith(input);
    input.focus(); input.select();
    const done = (commit) => {
      if (!input.isConnected) return;
      const v = input.value.trim();
      if (commit && v && v !== o.name) editor.setProp('name', v, { ids: [o.id], label: 'Rename layer', key: null });
      else render();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); e.stopPropagation(); });
    input.addEventListener('blur', () => done(true));
  };

  const walk = (parentId, depth, out) => {
    const kids = childrenOf(editor.page, parentId).slice().reverse();
    for (const o of kids) {
      const self = matches(o);
      const sub = [];
      if (isContainer(o) && !collapsed.has(o.id)) walk(o.id, depth + 1, sub);
      else if (isContainer(o) && (query || filter !== 'all')) walk(o.id, depth + 1, sub);
      if (self || sub.length) {
        out.push(rowFor(o, depth));
        out.push(...sub);
      }
    }
  };

  const render = () => {
    const items = [];
    walk(null, 0, items);
    list.replaceChildren(...items);
    const none = editor.page.objects.length === 0;
    empty.hidden = !none;
    list.hidden = none;
    if (!none && !items.length) {
      list.replaceChildren(h('li.layer-none', 'No layers match your search.'));
      list.hidden = false;
    }
    footer.querySelectorAll('button')[1].disabled = !editor.selectedObjects().some((o) => o.type === 'group');
    footer.querySelectorAll('button')[0].disabled = editor.selection.length < 2;
    root.dataset.count = String(editor.page.objects.length);
  };

  const renderSoon = debounce(render, 16);
  const offs = [
    editor.on('change', renderSoon),
    editor.on('selection', () => {
      renderSoon();
      // reveal selected layers: expand collapsed ancestors
      let changed = false;
      for (const id of editor.selection) {
        let p = editor.get(id) && editor.get(id).parentId;
        while (p) { if (collapsed.delete(p)) changed = true; p = editor.get(p) && editor.get(p).parentId; }
      }
      if (changed) render();
      requestAnimationFrame(() => { const el = list.querySelector('.layer.selected'); if (el) el.scrollIntoView({ block: 'nearest' }); });
    }),
    editor.on('page', render),
  ];
  search.addEventListener('input', () => { query = search.value; render(); });
  search.addEventListener('keydown', (e) => e.stopPropagation());
  render();
  return { el: root, render, destroy: () => offs.forEach((o) => o()) };
}
