import { renderPageParts } from '../core/renderer.js';
import { RasterManager } from './raster.js';
import { Disposer, h, rafThrottle } from '../utils/dom.js';
import { clamp, localToWorld, rotatePoint, DEG } from '../utils/geometry.js';
import { createObject, isContainer } from '../core/document-model.js';
import { fonts } from '../services/font-service.js';
import { fitText, invalidateTextCache } from '../core/text-layout.js';
import { icon } from '../core/icons.js';
import { confirmDialog, toast } from '../ui/ui.js';
import { insertLocalIcon, insertOpenverseImage, insertRemoteIcon } from '../services/asset-import.js';

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 32;

export const HANDLES = [
  { id: 'nw', hx: -1, hy: -1, cursor: 'nwse-resize' }, { id: 'n', hx: 0, hy: -1, cursor: 'ns-resize' },
  { id: 'ne', hx: 1, hy: -1, cursor: 'nesw-resize' }, { id: 'e', hx: 1, hy: 0, cursor: 'ew-resize' },
  { id: 'se', hx: 1, hy: 1, cursor: 'nwse-resize' }, { id: 's', hx: 0, hy: 1, cursor: 'ns-resize' },
  { id: 'sw', hx: -1, hy: 1, cursor: 'nesw-resize' }, { id: 'w', hx: -1, hy: 0, cursor: 'ew-resize' },
];

const f = (n) => Math.round(n * 100) / 100;

/**
 * The design stage: owns the pannable/zoomable viewport, renders the active page
 * as SVG, hosts the screen-space overlay, and routes pointer input to the active tool.
 */
export class Stage {
  constructor(editor, { onDropFiles } = {}) {
    this.editor = editor;
    this.onDropFiles = onDropFiles;
    this.disposer = new Disposer();
    this.raster = new RasterManager(editor);
    this.tools = new Map();
    this.hoverId = null;
    this.guides = [];
    this.spaceDown = false;
    this.pointers = new Map();
    this.gesture = null;
    this.pan = null;
    this.pagePositions = new Map();
    this.pageSvgs = new Map();
    this.pageActions = new Map();
    this.width = 0;
    this.height = 0;
    this.dirty = { render: true, overlay: true };
    this.hideIds = new Set();
    this.extraOverlay = '';
    this.el = this._build();
    this._bind();
  }

  _build() {
    this.world = h('div.stage-world');
    this.overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.overlay.setAttribute('class', 'stage-overlay');
    this.overlay.setAttribute('aria-hidden', 'true');
    this.rulerX = h('canvas.ruler.ruler-x');
    this.rulerY = h('canvas.ruler.ruler-y');
    this.rulerCorner = h('div.ruler-corner');
    this.overlayHost = h('div.stage-ui');
    return h('div.stage', { tabindex: 0, role: 'application', 'aria-label': 'Design canvas' },
      this.world, this.overlay, this.rulerX, this.rulerY, this.rulerCorner, this.overlayHost);
  }

  /* ------------------------------ lifecycle ------------------------------ */

  _bind() {
    const d = this.disposer;
    const ed = this.editor;
    this.scheduler = rafThrottle(() => this._flush());
    d.add(ed.on('change', () => this.invalidate({ render: true, overlay: true })));
    d.add(ed.on('page', () => this.invalidate({ render: true, overlay: true })));
    d.add(ed.on('selection', () => this.invalidate({ overlay: true })));
    d.add(ed.on('tool', ({ id, prev }) => this._switchTool(id, prev)));
    d.add(ed.on('viewport', () => this.invalidate({ render: true, overlay: true })));
    d.add(fonts.on('status', () => { invalidateTextCache(); this.invalidate({ render: true, overlay: true }); }));
    const ro = new ResizeObserver(() => this._resize());
    ro.observe(this.el);
    d.add(() => ro.disconnect());

    d.listen(this.el, 'pointerdown', (e) => this._down(e));
    d.listen(this.el, 'pointermove', (e) => this._move(e));
    d.listen(this.el, 'pointerup', (e) => this._up(e));
    d.listen(this.el, 'pointercancel', (e) => this._up(e, true));
    d.listen(this.el, 'dblclick', (e) => this._dbl(e));
    d.listen(this.el, 'wheel', (e) => this._wheel(e), { passive: false });
    d.listen(this.el, 'contextmenu', (e) => e.preventDefault());
    d.listen(this.el, 'dragover', (e) => { if (e.dataTransfer && ([...e.dataTransfer.types].includes('Files') || [...e.dataTransfer.types].includes('application/x-slatte-element'))) { e.preventDefault(); this.el.classList.add('drop-target'); } });
    d.listen(this.el, 'dragleave', () => this.el.classList.remove('drop-target'));
    d.listen(this.el, 'drop', (e) => this._drop(e));
    d.listen(window, 'keydown', (e) => this._keyDown(e));
    d.listen(window, 'keyup', (e) => this._keyUp(e));
    d.listen(window, 'blur', () => { this.spaceDown = false; this._cursor(); });
  }

  registerTool(tool) {
    this.tools.set(tool.id, tool);
  }

  get tool() {
    return this.tools.get(this.editor.toolId);
  }

  _ctx() {
    return { editor: this.editor, stage: this };
  }

  _switchTool(id, prev) {
    const p = this.tools.get(prev);
    if (p && p.deactivate) p.deactivate(this._ctx());
    const t = this.tools.get(id);
    if (t && t.activate) t.activate(this._ctx());
    this.hoverId = null;
    this.guides = [];
    this.extraOverlay = '';
    this._cursor();
    this.invalidate({ overlay: true });
  }

  start() {
    const t = this.tool;
    if (t && t.activate) t.activate(this._ctx());
    this._resize();
    this._cursor();
  }

  destroy() {
    const t = this.tool;
    if (t && t.deactivate) t.deactivate(this._ctx());
    this.disposer.dispose();
    this.raster.dispose();
  }

  /* ------------------------------ viewport ------------------------------ */

  get zoom() { return this.editor.viewport.zoom; }

  _resize() {
    const r = this.el.getBoundingClientRect();
    const first = this.width === 0;
    this.width = r.width;
    this.height = r.height;
    this.overlay.setAttribute('width', r.width);
    this.overlay.setAttribute('height', r.height);
    if (first && r.width > 0) this.fitAllPages(false);
    this.invalidate({ overlay: true });
  }

  screenToPage(sx, sy) {
    const v = this.editor.viewport;
    const pos = this.pagePositions.get(this.editor.page.id) || { x: 0, y: 0 };
    return { x: (sx - v.x) / v.zoom - pos.x, y: (sy - v.y) / v.zoom - pos.y };
  }

  pageToScreen(px, py) {
    const v = this.editor.viewport;
    const pos = this.pagePositions.get(this.editor.page.id) || { x: 0, y: 0 };
    return { x: (px + pos.x) * v.zoom + v.x, y: (py + pos.y) * v.zoom + v.y };
  }

  clientToStage(cx, cy) {
    const r = this.el.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
  }

  setViewport(patch) {
    Object.assign(this.editor.viewport, patch);
    this.editor.viewport.zoom = clamp(this.editor.viewport.zoom, MIN_ZOOM, MAX_ZOOM);
    this.editor.emit('viewport');
  }

  zoomAt(newZoom, anchor = { x: this.width / 2, y: this.height / 2 }) {
    const v = this.editor.viewport;
    const z = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);
    const px = (anchor.x - v.x) / v.zoom, py = (anchor.y - v.y) / v.zoom;
    this.setViewport({ zoom: z, x: anchor.x - px * z, y: anchor.y - py * z });
  }

  zoomBy(factor, anchor) {
    this.zoomAt(this.zoom * factor, anchor);
  }

  fitRect(rect, pad = 56) {
    if (!rect || !this.width) return;
    const availW = Math.max(40, this.width - pad * 2), availH = Math.max(40, this.height - pad * 2);
    const z = clamp(Math.min(availW / Math.max(1, rect.width), availH / Math.max(1, rect.height)), MIN_ZOOM, MAX_ZOOM);
    this.setViewport({
      zoom: z,
      x: (this.width - rect.width * z) / 2 - rect.x * z,
      y: (this.height - rect.height * z) / 2 - rect.y * z,
    });
  }

  fitPage() {
    const p = this.editor.page;
    const pos = this.pagePositions.get(p.id) || { x: 0, y: 0 };
    this.fitRect({ x: pos.x, y: pos.y, width: p.width, height: p.height });
  }

  fitAllPages() {
    const pages = this.editor.doc.pages;
    if (!pages.length) return;
    const positions = this._layoutPages();
    const minX = Math.min(...pages.map((p) => positions.get(p.id).x));
    const minY = Math.min(...pages.map((p) => positions.get(p.id).y));
    const maxX = Math.max(...pages.map((p) => positions.get(p.id).x + p.width));
    const maxY = Math.max(...pages.map((p) => positions.get(p.id).y + p.height));
    this.fitRect({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, 48);
  }

  _layoutPages() {
    const pages = this.editor.doc.pages;
    const maxHeight = Math.max(1, ...pages.map((p) => p.height));
    const positions = new Map();
    let x = 0;
    for (const page of pages) {
      positions.set(page.id, { x, y: (maxHeight - page.height) / 2 });
      x += page.width + Math.max(48, Math.min(120, page.width * 0.08));
    }
    this.pagePositions = positions;
    return positions;
  }

  fitSelection() {
    const b = this.editor.selection.length ? this.editor.bounds() : null;
    if (b) this.fitRect(b, 90); else this.fitPage();
  }

  /* ------------------------------ rendering ------------------------------ */

  invalidate({ render = false, overlay = false } = {}) {
    if (render) this.dirty.render = true;
    if (overlay) this.dirty.overlay = true;
    this.scheduler();
  }

  _flush() {
    if (this.dirty.render) this._renderPage();
    if (this.dirty.overlay) this._renderOverlay();
    this.dirty.render = false;
    this.dirty.overlay = false;
  }

  /** Forces an immediate synchronous draw (used by tests and exports). */
  flush() {
    this.dirty.render = true;
    this.dirty.overlay = true;
    this._flush();
  }

  _renderPage() {
    const ed = this.editor;
    const v = ed.viewport;
    this.world.style.transform = `translate(${f(v.x)}px, ${f(v.y)}px) scale(${v.zoom})`;
    const pages = ed.doc.pages;
    const positions = this._layoutPages();
    const current = new Set(pages.map((p) => p.id));
    for (const [id, svg] of this.pageSvgs) if (!current.has(id)) { svg.remove(); this.pageSvgs.delete(id); }
    for (const page of pages) {
      let svg = this.pageSvgs.get(page.id);
      if (!svg) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'page-svg');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', page.name);
        svg.dataset.pageId = page.id;
        this.pageSvgs.set(page.id, svg);
        this.world.append(svg);
      }
      const pos = positions.get(page.id);
      svg.style.left = `${pos.x}px`;
      svg.style.top = `${pos.y}px`;
      svg.setAttribute('width', page.width);
      svg.setAttribute('height', page.height);
      svg.setAttribute('viewBox', `0 0 ${page.width} ${page.height}`);
      svg.setAttribute('aria-label', page.name);
      const parts = renderPageParts(ed.doc, page, {
        live: true,
        resolve: (id) => ed.assets.url(id),
        hideIds: this.hideIds,
        hitPad: Math.min(40, 12 / v.zoom),
      });
      const bg = page.background.transparent ? '' : `<rect class="page-bg" width="${page.width}" height="${page.height}" fill="${page.background.color}"/>`;
      svg.classList.toggle('is-transparent', !!page.background.transparent);
      svg.classList.toggle('active-page', page.id === ed.page.id);
      svg.innerHTML = `<defs>${parts.defs}</defs>${bg}${parts.body}`;
      for (const id of parts.rasters) {
        const o = ed.get(id);
        const host = svg.querySelector(`foreignObject[data-raster="${CSS.escape(id)}"]`);
        if (o && host) host.append(this.raster.entry(o).canvas);
      }
    }
    this.svg = this.pageSvgs.get(ed.page.id) || null;
    this._renderPageActions();
    // forget canvases of layers that no longer exist
    for (const id of [...this.raster.layers.keys()]) if (!ed.get(id)) this.raster.forget(id);
    this._renderRulers();
  }

  _renderPageActions() {
    const { editor: ed } = this;
    const pages = ed.doc.pages;
    const activeIds = new Set(pages.map((page) => page.id));
    for (const [id, toolbar] of this.pageActions) if (!activeIds.has(id)) {
      toolbar.remove();
      this.pageActions.delete(id);
    }
    const button = (name, label, onClick) => h('button.page-action', {
      type: 'button', title: label, 'aria-label': label, html: icon(name, 14),
      onclick: (event) => { event.stopPropagation(); onClick(); },
    });
    pages.forEach((page, index) => {
      let toolbar = this.pageActions.get(page.id);
      if (!toolbar) {
        toolbar = h('div.artboard-actions', { 'aria-label': `Actions for ${page.name}` });
        this.pageActions.set(page.id, toolbar);
        this.overlayHost.append(toolbar);
      }
      toolbar.setAttribute('aria-label', `Actions for ${page.name}`);
      toolbar.replaceChildren(
        button('chevronLeft', 'Move page left', () => {
          const at = ed.doc.pages.findIndex((p) => p.id === page.id);
          if (at > 0) ed.movePage(page.id, at - 1);
        }),
        button('chevronRight', 'Move page right', () => {
          const at = ed.doc.pages.findIndex((p) => p.id === page.id);
          if (at >= 0 && at < ed.doc.pages.length - 1) ed.movePage(page.id, at + 1);
        }),
        button('copy', 'Duplicate page', () => ed.duplicatePage(page.id)),
        button('trash', 'Delete page', async () => {
          if (ed.doc.pages.length <= 1) return;
          if (await confirmDialog({ title: 'Delete page?', message: `“${page.name}” and everything on it will be removed. You can undo this.`, confirmLabel: 'Delete page', danger: true })) ed.removePage(page.id);
        }),
      );
      const pos = this.pagePositions.get(page.id) || { x: 0, y: 0 };
      const left = (pos.x + page.width) * ed.viewport.zoom + ed.viewport.x - toolbar.offsetWidth;
      const top = pos.y * ed.viewport.zoom + ed.viewport.y - toolbar.offsetHeight - 8;
      toolbar.style.left = `${f(left)}px`;
      toolbar.style.top = `${f(top)}px`;
      toolbar.querySelectorAll('.page-action').forEach((btn, actionIndex) => {
        btn.disabled = (actionIndex === 0 && index === 0) || (actionIndex === 1 && index === pages.length - 1) || (actionIndex === 3 && pages.length <= 1);
      });
    });
  }

  /* ------------------------------ overlay ------------------------------ */

  /** Oriented frame of the current selection in screen coordinates. */
  selectionFrame() {
    const ed = this.editor;
    const objs = ed.selectedObjects();
    if (!objs.length) return null;
    let box;
    let single = false;
    if (objs.length === 1 && !isContainer(objs[0])) {
      const o = objs[0];
      box = { x: o.x, y: o.y, width: o.width, height: o.height, rotation: o.rotation || 0 };
      single = true;
    } else {
      const b = ed.bounds();
      if (!b) return null;
      box = { x: b.x, y: b.y, width: b.width, height: b.height, rotation: 0 };
    }
    const toScreen = (lx, ly) => {
      const w = localToWorld(box, { x: lx, y: ly });
      return this.pageToScreen(w.x, w.y);
    };
    const corners = [toScreen(0, 0), toScreen(box.width, 0), toScreen(box.width, box.height), toScreen(0, box.height)];
    const handles = HANDLES.map((hd) => ({ ...hd, ...toScreen(((hd.hx + 1) / 2) * box.width, ((hd.hy + 1) / 2) * box.height) }));
    const top = toScreen(box.width / 2, 0);
    const up = rotatePoint({ x: 0, y: -1 }, { x: 0, y: 0 }, box.rotation);
    const rotate = { x: top.x + up.x * 26, y: top.y + up.y * 26 };
    const locked = ed.editableIds().length === 0;
    const hasFrame = ed.selectedObjects().some((o) => o.type === 'frame');
    return { box, corners, handles, rotate, top, single, locked, canRotate: !hasFrame };
  }

  outlinePolygon(o) {
    const pts = [[0, 0], [o.width, 0], [o.width, o.height], [0, o.height]]
      .map(([x, y]) => localToWorld(o, { x, y }))
      .map((p) => this.pageToScreen(p.x, p.y));
    return pts.map((p) => `${f(p.x)},${f(p.y)}`).join(' ');
  }

  _renderOverlay() {
    const ed = this.editor;
    const parts = [];
    const page = ed.page;
    // grid
    if (page.gridSettings.show) {
      const step = page.gridSettings.size * ed.viewport.zoom;
      if (step >= 6) {
        const p0 = this.pageToScreen(0, 0), p1 = this.pageToScreen(page.width, page.height);
        const d = [];
        for (let x = 0; x <= page.width + 0.01; x += page.gridSettings.size) { const sx = f(this.pageToScreen(x, 0).x); d.push(`M${sx} ${f(p0.y)}V${f(p1.y)}`); }
        for (let y = 0; y <= page.height + 0.01; y += page.gridSettings.size) { const sy = f(this.pageToScreen(0, y).y); d.push(`M${f(p0.x)} ${sy}H${f(p1.x)}`); }
        parts.push(`<path d="${d.join('')}" class="ov-grid"/>`);
      }
    }
    // hover
    if (this.hoverId && !ed.selection.includes(this.hoverId)) {
      const o = ed.get(this.hoverId);
      if (o && !isContainer(o)) parts.push(`<polygon points="${this.outlinePolygon(o)}" class="ov-hover"/>`);
      else if (o) {
        const b = ed.bounds([o.id]);
        if (b) {
          const a = this.pageToScreen(b.x, b.y), c = this.pageToScreen(b.x + b.width, b.y + b.height);
          parts.push(`<rect x="${f(a.x)}" y="${f(a.y)}" width="${f(c.x - a.x)}" height="${f(c.y - a.y)}" class="ov-hover"/>`);
        }
      }
    }
    // selection
    const tool = this.tool;
    const showSel = !tool || tool.showSelection !== false;
    if (showSel) {
      const fr = this.selectionFrame();
      if (fr) {
        const poly = fr.corners.map((p) => `${f(p.x)},${f(p.y)}`).join(' ');
        parts.push(`<polygon points="${poly}" class="ov-sel${fr.locked ? ' locked' : ''}"/>`);
        if (!fr.locked && (!tool || tool.showHandles !== false)) {
          if (fr.canRotate) {
            parts.push(`<line x1="${f(fr.top.x)}" y1="${f(fr.top.y)}" x2="${f(fr.rotate.x)}" y2="${f(fr.rotate.y)}" class="ov-stem"/>`);
            parts.push(`<circle cx="${f(fr.rotate.x)}" cy="${f(fr.rotate.y)}" r="5" class="ov-rot"/>`);
          }
          for (const hd of fr.handles) {
            parts.push(`<rect x="${f(hd.x - 4.5)}" y="${f(hd.y - 4.5)}" width="9" height="9" rx="1.5" class="ov-handle"/>`);
          }
          // size badge
          const b = fr.box;
          const lab = `${Math.round(b.width)} × ${Math.round(b.height)}`;
          const bx = (fr.corners[2].x + fr.corners[3].x) / 2, by = Math.max(fr.corners[2].y, fr.corners[3].y) + 22;
          parts.push(`<g class="ov-badge" transform="translate(${f(bx)} ${f(by)})"><rect x="${-(lab.length * 3.6 + 8)}" y="-11" width="${lab.length * 7.2 + 16}" height="20" rx="4"/><text text-anchor="middle" y="3">${lab}</text></g>`);
        }
      }
    }
    // snapping guides
    for (const g of this.guides) {
      if (g.axis === 'x') { const x = f(this.pageToScreen(g.pos, 0).x); parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${this.height}" class="ov-guide"/>`); }
      else { const y = f(this.pageToScreen(0, g.pos).y); parts.push(`<line x1="0" y1="${y}" x2="${this.width}" y2="${y}" class="ov-guide"/>`); }
    }
    // tool overlay (marquee, pen, nodes, gradient handles ...)
    if (tool && tool.overlay) parts.push(tool.overlay(this._ctx()) || '');
    if (this.extraOverlay) parts.push(this.extraOverlay);
    this.overlay.innerHTML = parts.join('');
  }

  setGuides(g) {
    const same = JSON.stringify(g) === JSON.stringify(this.guides);
    this.guides = g;
    if (!same) this.invalidate({ overlay: true });
  }

  /* ------------------------------ rulers ------------------------------ */

  _renderRulers() {
    const on = !!this.editor.doc.settings.rulers;
    this.el.classList.toggle('has-rulers', on);
    for (const c of [this.rulerX, this.rulerY, this.rulerCorner]) c.hidden = !on;
    if (!on) return;
    const dpr = window.devicePixelRatio || 1;
    const size = 20;
    const dark = document.documentElement.dataset.theme === 'dark';
    const cs = getComputedStyle(this.el);
    const bg = cs.getPropertyValue('--panel').trim() || (dark ? '#1c1c1f' : '#fff');
    const fg = cs.getPropertyValue('--text-muted').trim() || '#888';
    const line = cs.getPropertyValue('--border').trim() || '#ccc';
    const v = this.editor.viewport;
    const activePos = this.pagePositions.get(this.editor.page.id) || { x: 0, y: 0 };
    const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
    const step = nice.find((s) => s * v.zoom >= 56) || 5000;
    const sub = step / (step >= 100 ? 10 : step >= 20 ? 5 : step >= 5 ? 5 : 2);
    const draw = (canvas, horizontal) => {
      const len = horizontal ? this.width : this.height;
      canvas.width = (horizontal ? len : size) * dpr;
      canvas.height = (horizontal ? size : len) * dpr;
      canvas.style.width = `${horizontal ? len : size}px`;
      canvas.style.height = `${horizontal ? size : len}px`;
      const g = canvas.getContext('2d');
      g.scale(dpr, dpr);
      g.fillStyle = bg;
      g.fillRect(0, 0, horizontal ? len : size, horizontal ? size : len);
      g.strokeStyle = line;
      g.fillStyle = fg;
      g.font = '10px system-ui, sans-serif';
      const offset = horizontal ? activePos.x : activePos.y;
      const origin = (horizontal ? v.x : v.y) + offset * v.zoom;
      const startVal = Math.floor((-origin / v.zoom) / sub) * sub;
      for (let val = startVal; val * v.zoom + origin < len; val += sub) {
        const pos = Math.round((val + offset) * v.zoom + (horizontal ? v.x : v.y)) + 0.5;
        const major = Math.abs(val % step) < 1e-6;
        g.beginPath();
        if (horizontal) { g.moveTo(pos, size); g.lineTo(pos, major ? 6 : 14); } else { g.moveTo(size, pos); g.lineTo(major ? 6 : 14, pos); }
        g.stroke();
        if (major) {
          if (horizontal) g.fillText(String(Math.round(val)), pos + 3, 12);
          else { g.save(); g.translate(11, pos + 3); g.rotate(-Math.PI / 2); g.fillText(String(Math.round(val)), 0, 0); g.restore(); }
        }
      }
    };
    draw(this.rulerX, true);
    draw(this.rulerY, false);
  }

  /* ------------------------------ input ------------------------------ */

  _norm(e) {
    const s = this.clientToStage(e.clientX, e.clientY);
    const p = this.screenToPage(s.x, s.y);
    return {
      page: p, screen: s, client: { x: e.clientX, y: e.clientY },
      shift: e.shiftKey, alt: e.altKey, mod: e.ctrlKey || e.metaKey, button: e.button, buttons: e.buttons,
      pointerType: e.pointerType, pressure: e.pressure || 0.5, pointerId: e.pointerId, target: e.target, raw: e, detail: e.detail,
      tiltX: e.tiltX || 0, tiltY: e.tiltY || 0,
    };
  }

  /** Finds the object under a pointer event target. */
  objectIdAt(target) {
    const el = target && target.closest ? target.closest('[data-oid]') : null;
    return el && this.svg.contains(el) ? el.getAttribute('data-oid') : null;
  }

  _isPanGesture(e) {
    return this.editor.toolId === 'hand' || this.spaceDown || e.button === 1 || (e.button === 0 && e.buttons === 4);
  }

  _down(e) {
    if (e.target.closest && e.target.closest('.stage-ui')) return;
    const artboard = e.target.closest && e.target.closest('.page-svg');
    if (artboard && artboard.dataset.pageId && artboard.dataset.pageId !== this.editor.page.id) {
      this.editor.setActivePage(artboard.dataset.pageId);
      this.svg = artboard;
    }
    this.el.focus({ preventScroll: true });
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (e.pointerType === 'touch' && this.pointers.size === 2) {
      this._beginGesture();
      return;
    }
    if (this.gesture) return;
    try { this.el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (this._isPanGesture(e)) {
      e.preventDefault();
      this.pan = { x: e.clientX, y: e.clientY, vx: this.editor.viewport.x, vy: this.editor.viewport.y, id: e.pointerId };
      this.el.classList.add('panning');
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const t = this.tool;
    if (t && t.pointerDown) {
      this.active = e.pointerId;
      t.pointerDown(this._norm(e), this._ctx());
    }
  }

  _move(e) {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (this.gesture) { this._updateGesture(); return; }
    if (this.pan && this.pan.id === e.pointerId) {
      this.setViewport({ x: this.pan.vx + e.clientX - this.pan.x, y: this.pan.vy + e.clientY - this.pan.y });
      return;
    }
    const t = this.tool;
    const ev = this._norm(e);
    this.editor.emit('pointer', ev.page);
    if (!t) return;
    if (this.active === e.pointerId && t.pointerMove) {
      // coalesced events give smoother brush strokes
      const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (list.length > 1 && t.wantsCoalesced) for (const ce of list) t.pointerMove(this._norm(ce), this._ctx());
      else t.pointerMove(ev, this._ctx());
    } else if (t.hover) t.hover(ev, this._ctx());
  }

  _up(e, cancelled = false) {
    this.pointers.delete(e.pointerId);
    if (this.gesture) {
      if (this.pointers.size < 2) { this.gesture = null; }
      return;
    }
    if (this.pan && this.pan.id === e.pointerId) {
      this.pan = null;
      this.el.classList.remove('panning');
      return;
    }
    try { this.el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    const t = this.tool;
    if (this.active === e.pointerId) {
      this.active = null;
      if (t && t.pointerUp) t.pointerUp(this._norm(e), this._ctx(), cancelled);
    }
  }

  _dbl(e) {
    if (e.target.closest && e.target.closest('.stage-ui')) return;
    const t = this.tool;
    if (t && t.dblClick) t.dblClick(this._norm(e), this._ctx());
  }

  _wheel(e) {
    e.preventDefault();
    const s = this.clientToStage(e.clientX, e.clientY);
    if (e.ctrlKey || e.metaKey) {
      const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
      this.zoomBy(k, s);
    } else {
      const unit = e.deltaMode === 1 ? 16 : 1;
      const v = this.editor.viewport;
      this.setViewport({ x: v.x - (e.shiftKey ? e.deltaY : e.deltaX) * unit, y: v.y - (e.shiftKey ? 0 : e.deltaY) * unit });
    }
  }

  _beginGesture() {
    const t = this.tool;
    if (t && t.cancel) t.cancel(this._ctx());
    this.active = null;
    this.pan = null;
    const pts = [...this.pointers.values()];
    const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const v = this.editor.viewport;
    this.gesture = { cx, cy, dist, zoom: v.zoom, x: v.x, y: v.y };
  }

  _updateGesture() {
    const g = this.gesture;
    const pts = [...this.pointers.values()];
    if (!g || pts.length < 2) return;
    const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const z = clamp(g.zoom * (dist / Math.max(1, g.dist)), MIN_ZOOM, MAX_ZOOM);
    const r = this.el.getBoundingClientRect();
    // page point under the start centre stays under the current centre
    const px = (g.cx - r.left - g.x) / g.zoom, py = (g.cy - r.top - g.y) / g.zoom;
    this.setViewport({ zoom: z, x: cx - r.left - px * z, y: cy - r.top - py * z });
  }

  _drop(e) {
    this.el.classList.remove('drop-target');
    if (!e.dataTransfer) return;
    e.preventDefault();
    const artboard = e.target.closest && e.target.closest('.page-svg');
    if (artboard?.dataset.pageId && artboard.dataset.pageId !== this.editor.page.id) {
      this.editor.setActivePage(artboard.dataset.pageId);
      this.svg = artboard;
    }
    const s = this.clientToStage(e.clientX, e.clientY);
    if ([...e.dataTransfer.types].includes('application/x-slatte-element')) {
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/x-slatte-element'));
        const page = this.editor.page;
        if (data.kind === 'shape') {
          const side = Math.min(page.width, page.height) * 0.25;
          const map = {
            rectangle: ['rectangle', {}], roundedRectangle: ['roundedRectangle', {}], ellipse: ['ellipse', {}],
            triangle: ['polygon', { sides: 3, name: 'Triangle' }], polygon: ['polygon', { sides: 6 }],
            star: ['star', {}], arrow: ['arrow', { height: side * 0.6 }], line: ['line', { height: 0, width: side * 1.5 }],
          };
          const [type, props] = map[data.shape] || map.rectangle;
          const obj = createObject(type, { width: side, height: side, ...props });
          obj.x = s.x - obj.width / 2; obj.y = s.y - obj.height / 2;
          this.editor.addObjects([obj], { label: `Add ${data.shape || 'shape'}` });
        } else if (data.kind === 'text' || data.kind === 'font') {
          const family = data.family || 'Inter';
          const obj = createObject('text', { text: data.text || family, fontSize: data.size || Math.round(page.width / 18), fontWeight: data.weight || 400, fontFamily: family, name: 'Text' });
          fitText(obj);
          obj.x = s.x - obj.width / 2; obj.y = s.y - obj.height / 2;
          this.editor.addObjects([obj], { label: 'Add text' });
          fonts.load(family).then(() => this.editor.change('Update text', (p) => { const found = p.objects.find((o) => o.id === obj.id); if (found) fitText(found); }));
        } else if (data.kind === 'local-icon') {
          insertLocalIcon(this.editor, data.name, s);
        } else if (data.kind === 'remote-icon') {
          insertRemoteIcon(this.editor, data.icon, s).catch((err) => toast(err.message || 'Could not add that icon.', { kind: 'error' }));
        } else if (data.kind === 'openverse-image') {
          insertOpenverseImage(this.editor, data.item, s).catch((err) => toast(err.message || 'Could not add that image.', { kind: 'error' }));
        } else if (data.kind === 'asset-image') {
          const asset = this.editor.doc.assets[data.assetId];
          if (asset) {
            const scale = Math.min(1, (page.width * 0.6) / Math.max(1, asset.width), (page.height * 0.6) / Math.max(1, asset.height));
            const obj = createObject('image', { name: asset.name || 'Image', assetId: asset.id, width: asset.width * scale, height: asset.height * scale, naturalWidth: asset.width, naturalHeight: asset.height });
            obj.x = s.x - obj.width / 2; obj.y = s.y - obj.height / 2;
            this.editor.addObjects([obj], { label: 'Add image' });
          }
        } else if (data.kind === 'texture') {
          const size = Math.min(page.width, page.height) * 0.5;
          const obj = createObject('texture', { kind: data.texture, x: s.x - size / 2, y: s.y - size / 2, width: size, height: size, scale: ['paper', 'noise'].includes(data.texture) ? 60 : Math.max(12, Math.round(page.width / 60)), intensity: 0.45, density: 0.5, name: `${data.texture[0].toUpperCase()}${data.texture.slice(1)} texture`, blendMode: ['paper', 'noise'].includes(data.texture) ? 'multiply' : 'normal' });
          this.editor.addObjects([obj], { label: 'Add texture' });
        } else if (data.kind === 'brush') {
          this.editor.toolOptions.brush.preset = data.preset;
          this.editor.setTool('brush');
          this.editor.emit('brush');
        }
      } catch { /* ignore invalid internal drag payloads */ }
      return;
    }
    if (!e.dataTransfer.files || !e.dataTransfer.files.length) return;
    if (this.onDropFiles) this.onDropFiles([...e.dataTransfer.files], this.screenToPage(s.x, s.y));
  }

  _typing(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  _keyDown(e) {
    if (e.code === 'Space' && !this._typing(e) && !e.repeat) {
      this.spaceDown = true;
      e.preventDefault();
      this._cursor();
      return;
    }
    if (this._typing(e)) return;
    const t = this.tool;
    if (t && t.keyDown) t.keyDown(e, this._ctx());
  }

  _keyUp(e) {
    if (e.code === 'Space') { this.spaceDown = false; this._cursor(); }
    const t = this.tool;
    if (!this._typing(e) && t && t.keyUp) t.keyUp(e, this._ctx());
  }

  setCursor(c) {
    this._cursorOverride = c;
    this._cursor();
  }

  _cursor() {
    let c = this._cursorOverride;
    if (this.spaceDown || this.editor.toolId === 'hand') c = this.pan ? 'grabbing' : 'grab';
    else if (!c) {
      const t = this.tool;
      c = (t && t.cursor) || 'default';
    }
    this.el.style.cursor = c;
  }

  /** Hide the SVG of an object while an HTML editor sits on top of it. */
  hideObject(id) {
    if (id) this.hideIds.add(id); else this.hideIds.clear();
    this.invalidate({ render: true });
  }
}

export { DEG };
