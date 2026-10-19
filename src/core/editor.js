import { Emitter } from './store.js';
import { History } from './history.js';
import { activePage, cloneObjects, createObject, createPage, descendantIds, getIn, indexPage, isContainer, isEffectivelyHidden, isEffectivelyLocked, moveObject, normalizePath, pathFromSubpaths, removeObjects, restoreContent, setIn, shapeToSubpaths, subpathsToWorld, snapshotContent, stepOrder, typeLabel, uniqueName, createDocument } from './document-model.js';
import { expandIds, moveBy, refreshAllGroups, resizeContent, rotateAbout, scaleObjects, selectionBounds } from './transform.js';
import { fitText } from './text-layout.js';
import { shortId } from '../utils/ids.js';
import { rotatePoint, unionRects, worldBounds } from '../utils/geometry.js';

/** Clipboard shared by every editor instance in this tab. */
const clipboard = { objects: [], assets: new Map(), pasteCount: 0 };

export class Editor extends Emitter {
  /**
   * @param {object} doc validated document
   * @param {import('../services/asset-store.js').AssetStore} assets
   */
  constructor(doc, assets) {
    super();
    this.doc = doc;
    this.assets = assets;
    this.history = new History();
    this.history.reset(snapshotContent(doc));
    this.rev = 0;
    this.selection = [];
    this.toolId = 'select';
    this.viewport = { zoom: 1, x: 0, y: 0 };
    this.activeRasterId = null;
    this.toolOptions = {
      fillTarget: 'fill',
      brush: { preset: 'hard', size: 24, opacity: 1, smoothing: 0.4, color: '#18181b', eraser: false },
      shape: { sides: 6, points: 5, innerRatio: 0.5 },
      gradientKind: 'linear',
      sampled: null,
    };
    this.isolateId = null;
    this.editingTextId = null;
  }

  /* ----------------------------- basics ----------------------------- */

  get page() {
    return activePage(this.doc);
  }

  get idx() {
    if (this._idxRev !== this.rev || this._idxPage !== this.page.id) {
      this._idx = indexPage(this.page);
      this._idxRev = this.rev;
      this._idxPage = this.page.id;
    }
    return this._idx;
  }

  get(id) {
    return this.idx.get(id) || null;
  }

  selectedObjects() {
    return this.selection.map((id) => this.get(id)).filter(Boolean);
  }

  /** Selected ids that can be edited (not locked, not hidden). */
  editableIds() {
    return this.selection.filter((id) => {
      const o = this.get(id);
      return o && !isEffectivelyLocked(o, this.idx) && !isEffectivelyHidden(o, this.idx);
    });
  }

  /* ----------------------------- change plumbing ----------------------------- */

  /**
   * Runs `fn` against the active page and records a history step.
   * `key` lets continuous edits (slider drags, nudges) merge into one undo step.
   */
  change(label, fn, { key = null } = {}) {
    const r = fn(this.page, this.doc);
    this._after(label, key);
    return r;
  }

  /** Applies a live edit (drag in progress) without recording history. */
  preview(fn) {
    fn(this.page, this.doc);
    refreshAllGroups(this.page);
    this.rev++;
    this.emit('change', { transient: true });
  }

  /** Records the current document state as one history step. */
  commit(label, key = null) {
    this._after(label, key);
  }

  _after(label, key) {
    const page = this.page;
    refreshAllGroups(page);
    this._cleanSelection();
    this.rev++;
    this.doc.updatedAt = new Date().toISOString();
    const recorded = this.history.record(label, snapshotContent(this.doc), key);
    this.emit('change', { label, committed: true, recorded });
    if (recorded) this.emit('history');
  }

  _cleanSelection() {
    const idx = indexPage(this.page);
    const keep = this.selection.filter((id) => idx.has(id));
    // drop children whose ancestor is also selected
    const set = new Set(keep);
    const out = keep.filter((id) => {
      let p = idx.get(id).parentId;
      let g = 0;
      while (p && g++ < 100) {
        if (set.has(p)) return false;
        p = idx.get(p) ? idx.get(p).parentId : null;
      }
      return true;
    });
    if (out.length !== this.selection.length || out.some((v, i) => v !== this.selection[i])) {
      this.selection = out;
      this.emit('selection');
    }
    if (this.isolateId && !idx.has(this.isolateId)) this.isolateId = null;
  }

  undo() {
    const r = this.history.undo();
    if (!r) return false;
    this._restore(r.json);
    this.emit('toast', { message: `Undid: ${r.label}`, kind: 'info' });
    return true;
  }

  redo() {
    const r = this.history.redo();
    if (!r) return false;
    this._restore(r.json);
    this.emit('toast', { message: `Redid: ${r.label}`, kind: 'info' });
    return true;
  }

  _restore(json) {
    restoreContent(this.doc, json);
    this.rev++;
    this.doc.updatedAt = new Date().toISOString();
    this._cleanSelection();
    this.emit('change', { committed: true, history: true });
    this.emit('history');
  }

  /* ----------------------------- selection ----------------------------- */

  select(ids, { add = false, toggle = false } = {}) {
    const idx = this.idx;
    ids = (Array.isArray(ids) ? ids : [ids]).filter((id) => idx.has(id));
    let next;
    if (toggle) {
      const set = new Set(this.selection);
      for (const id of ids) {
        if (set.has(id)) set.delete(id); else set.add(id);
      }
      next = [...set];
    } else if (add) next = [...new Set([...this.selection, ...ids])];
    else next = ids;
    const before = this.selection;
    this.selection = next;
    this._cleanSelection();
    if (before.length !== this.selection.length || before.some((v, i) => v !== this.selection[i])) this.emit('selection');
  }

  clearSelection() {
    if (!this.selection.length) return;
    this.selection = [];
    this.emit('selection');
  }

  selectAll() {
    const ids = this.page.objects
      .filter((o) => (o.parentId || null) === (this.isolateId || null) && o.visible && !o.locked)
      .map((o) => o.id);
    this.select(ids);
  }

  /** Outermost group ancestor (stops at frames and the isolation root). */
  topSelectable(id) {
    const idx = this.idx;
    let cur = idx.get(id);
    let guard = 0;
    while (cur && cur.parentId && guard++ < 100) {
      const p = idx.get(cur.parentId);
      if (!p || p.type !== 'group' || p.id === this.isolateId) break;
      cur = p;
    }
    return cur ? cur.id : id;
  }

  bounds(ids = this.selection) {
    return selectionBounds(this.page, ids);
  }

  setTool(id) {
    if (this.toolId === id) return;
    const prev = this.toolId;
    this.toolId = id;
    this.emit('tool', { id, prev });
  }

  /* ----------------------------- creation / deletion ----------------------------- */

  addObjects(objs, { select = true, label = 'Add', parentId } = {}) {
    this.change(label, (page) => {
      for (const o of objs) {
        if (parentId !== undefined) o.parentId = parentId;
        else if (this.isolateId && !o.parentId) o.parentId = this.isolateId;
        o.name = uniqueName(page, o.name);
        page.objects.push(o);
      }
    });
    if (select) this.select(objs.map((o) => o.id));
    return objs;
  }

  create(type, props = {}, opts = {}) {
    const o = createObject(type, props);
    this.addObjects([o], opts);
    return o;
  }

  deleteSelection() {
    const ids = this.editableIds();
    if (!ids.length) return false;
    this.change(ids.length > 1 ? `Delete ${ids.length} layers` : 'Delete layer', (page) => {
      removeObjects(page, ids);
    });
    return true;
  }

  duplicateSelection(offset = 20) {
    const ids = this.editableIds();
    if (!ids.length) return [];
    let rootIds = [];
    this.change('Duplicate', (page) => {
      const { objects, rootIds: roots } = cloneObjects(page, ids);
      rootIds = roots;
      for (const o of objects) {
        o.x += offset; o.y += offset;
        if (roots.includes(o.id)) o.name = uniqueName(page, o.name.replace(/ \d+$/, '') + ' copy');
      }
      // insert each clone right above its source for natural stacking
      page.objects.push(...objects);
    });
    this.select(rootIds);
    return rootIds;
  }

  copy() {
    const ids = this.editableIds().length ? this.editableIds() : this.selection;
    if (!ids.length) return false;
    const { objects } = cloneObjects(this.page, ids);
    clipboard.objects = objects;
    clipboard.assets = new Map();
    clipboard.pasteCount = 0;
    for (const o of objects) {
      if ((o.type === 'image' || o.type === 'rasterLayer') && o.assetId && this.assets.has(o.assetId)) {
        clipboard.assets.set(o.assetId, { blob: this.assets.get(o.assetId), meta: this.doc.assets[o.assetId] });
      }
    }
    this.emit('toast', { message: `Copied ${ids.length} ${ids.length === 1 ? 'layer' : 'layers'}`, kind: 'info' });
    return true;
  }

  cut() {
    if (this.copy()) this.deleteSelection();
  }

  paste() {
    if (!clipboard.objects.length) return false;
    clipboard.pasteCount++;
    const off = 20 * clipboard.pasteCount;
    const map = new Map(clipboard.objects.map((o) => [o.id, shortId('o')]));
    const objs = clipboard.objects.map((o) => {
      const c = JSON.parse(JSON.stringify(o));
      c.id = map.get(o.id);
      c.parentId = map.has(o.parentId) ? map.get(o.parentId) : null;
      if (!map.has(o.parentId)) { c.x += off; c.y += off; } else { c.x += off; c.y += off; }
      return c;
    });
    for (const [id, a] of clipboard.assets) {
      if (!this.assets.has(id)) {
        this.assets.put(id, a.blob);
        if (a.meta && !this.doc.assets[id]) this.doc.assets[id] = { ...a.meta };
      }
    }
    this.change('Paste', (page) => {
      for (const o of objs) {
        if (!o.parentId) o.name = uniqueName(page, o.name);
        page.objects.push(o);
      }
    });
    this.select(objs.filter((o) => !o.parentId).map((o) => o.id));
    return true;
  }

  hasClipboard() {
    return clipboard.objects.length > 0;
  }

  /* ----------------------------- grouping & order ----------------------------- */

  group() {
    const ids = this.editableIds();
    if (ids.length < 2) return false;
    let gid;
    this.change('Group', (page) => {
      const idx = indexPage(page);
      // keep stacking order by the first selected item's position
      const order = page.objects.filter((o) => ids.includes(o.id));
      const parentId = idx.get(ids[0]).parentId || null;
      const g = createObject('group', { name: uniqueName(page, 'Group'), parentId });
      gid = g.id;
      const first = page.objects.indexOf(order[0]);
      page.objects.splice(first, 0, g);
      for (const o of order) o.parentId = g.id;
      // children must stay contiguous & above the group record
      const keep = new Set(order.map((o) => o.id));
      const rest = page.objects.filter((o) => !keep.has(o.id));
      const at = rest.indexOf(g);
      page.objects = [...rest.slice(0, at + 1), ...order, ...rest.slice(at + 1)];
    });
    this.select([gid]);
    return true;
  }

  ungroup() {
    const groups = this.editableIds().map((id) => this.get(id)).filter((o) => o && o.type === 'group');
    if (!groups.length) return false;
    const freed = [];
    this.change('Ungroup', (page) => {
      for (const g of groups) {
        for (const o of page.objects) {
          if (o.parentId === g.id) { o.parentId = g.parentId || null; freed.push(o.id); }
        }
        page.objects = page.objects.filter((o) => o.id !== g.id);
      }
    });
    this.select(freed);
    return true;
  }

  order(mode) {
    const ids = this.editableIds();
    if (!ids.length) return false;
    const names = { front: 'Bring to front', back: 'Send to back', forward: 'Bring forward', backward: 'Send backward' };
    this.change(names[mode], (page) => stepOrder(page, ids, mode));
    return true;
  }

  moveLayer(id, parentId, index) {
    this.change('Reorder layers', (page) => {
      moveObject(page, id, parentId, index);
    });
  }

  /* ----------------------------- property editing ----------------------------- */

  /** Sets a dotted property path (e.g. "fill.color") on every editable selected object. */
  setProp(path, value, { label, key, ids } = {}) {
    const targets = (ids || this.editableIds()).map((id) => this.get(id)).filter(Boolean);
    if (!targets.length) return;
    const lab = label || `Change ${path.split('.').pop()}`;
    this.change(lab, (page) => {
      for (const o of targets) {
        const live = page.objects.find((x) => x.id === o.id);
        if (!live) continue;
        this._applyProp(live, path, value);
      }
    }, { key: key || `prop:${path}:${targets.map((t) => t.id).join(',')}` });
  }

  _applyProp(o, path, value) {
    if (path === 'name' || path === 'visible' || path === 'locked') { o[path] = value; return; }
    const targets = isContainer(o) && o.type === 'group' && !['opacity', 'blendMode', 'effects'].some((p) => path.startsWith(p))
      ? this.page.objects.filter((c) => descendantIds(this.page, o.id).includes(c.id) && !isContainer(c)) : [o];
    for (const t of targets) {
      setIn(t, path, value);
      if (t.type === 'text' && /^(text|font|lineHeight|letterSpacing|autoWidth|width)/.test(path)) {
        if (path === 'width') t.autoWidth = false;
        fitText(t);
      }
    }
  }

  /** Applies several property assignments atomically. */
  setProps(patch, opts = {}) {
    const targets = (opts.ids || this.editableIds()).map((id) => this.get(id)).filter(Boolean);
    if (!targets.length) return;
    this.change(opts.label || 'Edit', (page) => {
      for (const o of targets) {
        const live = page.objects.find((x) => x.id === o.id);
        if (!live) continue;
        for (const [k, v] of Object.entries(patch)) this._applyProp(live, k, v);
      }
    }, { key: opts.key || null });
  }

  /** Sets position/size of the selection (inspector fields). */
  setBox(patch, { key } = {}) {
    const ids = this.editableIds();
    if (!ids.length) return;
    const sel = ids.map((id) => this.get(id));
    const single = sel.length === 1 && !isContainer(sel[0]) ? sel[0] : null;
    this.change('Resize', (page) => {
      if (single) {
        const o = page.objects.find((x) => x.id === single.id);
        if ('width' in patch || 'height' in patch) {
          const w = Math.max(1, 'width' in patch ? patch.width : o.width);
          const h = Math.max(1, 'height' in patch ? patch.height : o.height);
          if (o.type === 'text') {
            o.autoWidth = false; o.width = w; fitText(o);
          } else resizeContent(o, w, h);
        }
        if ('x' in patch) o.x = patch.x;
        if ('y' in patch) o.y = patch.y;
        if ('rotation' in patch) o.rotation = patch.rotation;
        return;
      }
      const b = selectionBounds(page, ids);
      if (!b) return;
      if ('width' in patch || 'height' in patch) {
        const sx = 'width' in patch && b.width > 0 ? Math.max(1, patch.width) / b.width : 1;
        const sy = 'height' in patch && b.height > 0 ? Math.max(1, patch.height) / b.height : 1;
        scaleObjects(page, ids, { x: b.x, y: b.y }, sx, sy);
      }
      const nb = selectionBounds(page, ids);
      const dx = 'x' in patch ? patch.x - nb.x : 0;
      const dy = 'y' in patch ? patch.y - nb.y : 0;
      if (dx || dy) moveBy(page, ids, dx, dy);
      if ('rotation' in patch) {
        const pv = { x: nb.x + nb.width / 2, y: nb.y + nb.height / 2 };
        for (const o of page.objects) {
          if (expandIds(page, ids).has(o.id) && !isContainer(o)) rotateAbout(o, pv, patch.rotation);
        }
      }
    }, { key: key || `box:${Object.keys(patch).join(',')}:${ids.join(',')}` });
  }

  nudge(dx, dy) {
    const ids = this.editableIds();
    if (!ids.length) return;
    this.change('Move', (page) => moveBy(page, ids, dx, dy), { key: `nudge:${ids.join(',')}` });
  }

  /* ----------------------------- alignment ----------------------------- */

  align(mode, to = 'auto') {
    const ids = this.editableIds();
    if (!ids.length) return;
    const page = this.page;
    const sel = selectionBounds(page, ids);
    const ref = to === 'page' || (to === 'auto' && ids.length === 1)
      ? { x: 0, y: 0, width: page.width, height: page.height } : sel;
    const targets = to === 'page' || ids.length === 1 ? ids.map((id) => [id]) : ids.map((id) => [id]);
    this.change('Align', (pg) => {
      const objs = new Map(pg.objects.map((o) => [o.id, o]));
      for (const [id] of targets) {
        const b = selectionBounds(pg, [id]);
        if (!b || !objs.has(id)) continue;
        let dx = 0, dy = 0;
        if (mode === 'left') dx = ref.x - b.x;
        if (mode === 'center') dx = ref.x + ref.width / 2 - (b.x + b.width / 2);
        if (mode === 'right') dx = ref.x + ref.width - (b.x + b.width);
        if (mode === 'top') dy = ref.y - b.y;
        if (mode === 'middle') dy = ref.y + ref.height / 2 - (b.y + b.height / 2);
        if (mode === 'bottom') dy = ref.y + ref.height - (b.y + b.height);
        if (dx || dy) moveBy(pg, [id], dx, dy);
      }
    });
  }

  distribute(axis) {
    const ids = this.editableIds();
    if (ids.length < 3) return false;
    this.change('Distribute', (pg) => {
      const items = ids.map((id) => ({ id, b: selectionBounds(pg, [id]) }));
      const hx = axis === 'h';
      items.sort((a, b) => (hx ? a.b.x - b.b.x : a.b.y - b.b.y));
      const first = items[0].b, last = items[items.length - 1].b;
      const total = items.reduce((s, i) => s + (hx ? i.b.width : i.b.height), 0);
      const span = hx ? last.x + last.width - first.x : last.y + last.height - first.y;
      const gap = (span - total) / (items.length - 1);
      let cursor = hx ? first.x : first.y;
      for (const it of items) {
        const cur = hx ? it.b.x : it.b.y;
        const d = cursor - cur;
        if (Math.abs(d) > 1e-6) moveBy(pg, [it.id], hx ? d : 0, hx ? 0 : d);
        cursor += (hx ? it.b.width : it.b.height) + gap;
      }
    });
    return true;
  }

  /* ----------------------------- paths ----------------------------- */

  /** Converts a basic shape into an editable path (keeps appearance). */
  convertToPath(id, { record = true } = {}) {
    const o = this.get(id);
    if (!o || o.type === 'path') return o;
    if (!['rectangle', 'roundedRectangle', 'ellipse', 'line', 'polygon', 'star', 'arrow'].includes(o.type)) return null;
    const apply = () => {
      const live = this.page.objects.find((x) => x.id === id);
      live.subpaths = JSON.parse(JSON.stringify(shapeToSubpaths(live)));
      live.type = 'path';
      live.fillRule = 'nonzero';
      for (const k of ['radius', 'radii', 'sides', 'points', 'innerRatio', 'headRatio', 'dir']) delete live[k];
      if (live.name === typeLabel(o.type)) live.name = 'Path';
      normalizePath(live);
    };
    if (record) this.change('Convert to path', apply); else apply();
    return this.get(id);
  }

  combinePaths() {
    const ids = this.editableIds();
    const objs = ids.map((i) => this.get(i)).filter((o) => o && !isContainer(o) && o.type !== 'text' && o.type !== 'image');
    if (objs.length < 2) return false;
    let newId;
    this.change('Combine paths', (page) => {
      const subpaths = [];
      for (const o of objs) {
        const live = page.objects.find((x) => x.id === o.id);
        subpaths.push(...subpathsToWorld(live));
      }
      const top = objs[objs.length - 1];
      const path = pathFromSubpaths(subpaths, { fill: top.fill, stroke: top.stroke, name: uniqueName(page, 'Compound path'), fillRule: 'evenodd' });
      newId = path.id;
      const at = Math.max(...objs.map((o) => page.objects.findIndex((x) => x.id === o.id)));
      page.objects.splice(at + 1, 0, path);
      removeObjects(page, objs.map((o) => o.id));
    });
    this.select([newId]);
    return true;
  }

  /* ----------------------------- pages ----------------------------- */

  setActivePage(id) {
    if (this.doc.activePageId === id || !this.doc.pages.some((p) => p.id === id)) return;
    this.doc.activePageId = id;
    this.selection = [];
    this.isolateId = null;
    this.rev++;
    this.emit('selection');
    this.emit('page');
    this.emit('change', { committed: true, pageSwitch: true });
  }

  addPage({ name, width, height, background } = {}) {
    const page = createPage({ name: name || `Page ${this.doc.pages.length + 1}`, width, height, background });
    this.doc.pages.push(page);
    this.doc.activePageId = page.id;
    this.selection = [];
    this._after('Add page', null);
    this.emit('page');
    return page;
  }

  duplicatePage(id = this.page.id) {
    const src = this.doc.pages.find((p) => p.id === id);
    if (!src) return null;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = shortId('p');
    copy.name = `${src.name} copy`;
    const map = new Map(copy.objects.map((o) => [o.id, shortId('o')]));
    for (const o of copy.objects) {
      o.id = map.get(o.id);
      if (o.parentId) o.parentId = map.get(o.parentId) || null;
    }
    const at = this.doc.pages.findIndex((p) => p.id === id);
    this.doc.pages.splice(at + 1, 0, copy);
    this.doc.activePageId = copy.id;
    this.selection = [];
    this._after('Duplicate page', null);
    this.emit('page');
    return copy;
  }

  removePage(id) {
    if (this.doc.pages.length <= 1) return false;
    const at = this.doc.pages.findIndex((p) => p.id === id);
    if (at < 0) return false;
    this.doc.pages.splice(at, 1);
    if (this.doc.activePageId === id) {
      this.doc.activePageId = this.doc.pages[Math.max(0, at - 1)].id;
      this.selection = [];
    }
    this._after('Delete page', null);
    this.emit('page');
    return true;
  }

  movePage(id, toIndex) {
    const at = this.doc.pages.findIndex((p) => p.id === id);
    if (at < 0) return;
    const [p] = this.doc.pages.splice(at, 1);
    this.doc.pages.splice(Math.max(0, Math.min(this.doc.pages.length, toIndex)), 0, p);
    this._after('Reorder pages', null);
  }

  setPageProps(patch, { id = this.page.id, key } = {}) {
    const p = this.doc.pages.find((x) => x.id === id);
    if (!p) return;
    this.change('Page settings', () => {
      for (const [k, v] of Object.entries(patch)) setIn(p, k, v);
    }, { key: key || `page:${Object.keys(patch).join(',')}` });
  }

  rename(name) {
    this.doc.name = name;
    this.rev++;
    this.doc.updatedAt = new Date().toISOString();
    this.emit('change', { committed: true, meta: true });
    this.emit('meta');
  }

  /* ----------------------------- colours & assets ----------------------------- */

  rememberColor(hex) {
    const list = this.doc.settings.recentColors;
    const i = list.indexOf(hex);
    if (i >= 0) list.splice(i, 1);
    list.unshift(hex);
    list.length = Math.min(list.length, 12);
    this.emit('colors');
  }

  registerAsset(blob, meta) {
    const id = this.assets.add(blob);
    this.doc.assets[id] = {
      id, name: meta.name || 'asset', mime: blob.type || meta.mime || 'application/octet-stream', kind: meta.kind || 'image',
      size: blob.size, width: meta.width || 0, height: meta.height || 0, source: meta.source || null,
    };
    return id;
  }

  /** Union rect of all page content (for "fit content"). */
  contentBounds() {
    const rects = this.page.objects.filter((o) => !isContainer(o) && o.visible).map(worldBounds);
    return unionRects(rects);
  }

  /** Mirrors the visible-state of an object (eye / lock toggles). */
  toggle(id, prop) {
    const o = this.get(id);
    if (!o) return;
    this.change(prop === 'visible' ? (o.visible ? 'Hide layer' : 'Show layer') : (o.locked ? 'Unlock layer' : 'Lock layer'), (page) => {
      const live = page.objects.find((x) => x.id === id);
      live[prop] = !live[prop];
    });
  }

  dispose() {
    this.clear();
  }
}

export function newEditorDocument(name = 'Untitled', pageOpts) {
  return createDocument(name, pageOpts);
}

export { getIn, rotatePoint };
