import * as ops from '../path-ops.js';
import { h } from '../../utils/dom.js';
import { icon } from '../../core/icons.js';
import { BLEND_MODES, PAGE_PRESETS, TEXTURE_KINDS, hasFill, hasStroke, isContainer, getIn, typeLabel } from '../../core/document-model.js';
import { colorInput, iconButton, numberInput, paintEditor, row, section, segmented, selectInput, slider, toggle } from '../../ui/controls.js';
import { fonts } from '../../services/font-service.js';
import { BRUSH_PRESETS, drawPresetPreview } from '../brush-engine.js';
import { fitText } from '../../core/text-layout.js';
import { shortId } from '../../utils/ids.js';
import { normalizeHex } from '../../utils/color.js';


const same = (arr) => arr.every((v) => JSON.stringify(v) === JSON.stringify(arr[0]));

/** Context-sensitive property inspector. Only shows what the selection (or tool) needs. */
export function createInspector(app) {
  const { editor, stage } = app;
  const root = h('div.inspector');
  let key = '';
  let ctrls = [];
  let alignTo = 'auto';
  let ratioLock = false;
  let independentRadii = false;

  const reg = (fn) => { ctrls.push(fn); };
  const objs = () => editor.selectedObjects();
  const vals = (get) => objs().map(get);

  /* ------------------------------- helpers ------------------------------- */

  const prop = (label, getter, path, opts = {}, setter) => {
    const c = numberInput({
      label, value: 0, ...opts,
      onInput: (v) => (setter ? setter(v) : editor.setProp(path, opts.transform ? opts.transform(v) : v, { label: `Change ${label.toLowerCase()}` })),
    });
    reg(() => { const v = vals(getter); c.set(v[0], !same(v)); });
    return c;
  };

  const boxVals = () => {
    const sel = objs();
    if (sel.length === 1 && !isContainer(sel[0])) {
      const o = sel[0];
      return { x: o.x, y: o.y, width: o.width, height: o.height, rotation: o.rotation || 0 };
    }
    const b = editor.bounds();
    return b ? { x: b.x, y: b.y, width: b.width, height: b.height, rotation: 0 } : { x: 0, y: 0, width: 0, height: 0, rotation: 0 };
  };

  const boxField = (label, k, opts = {}) => {
    const c = numberInput({
      label, value: 0, dp: 1, ...opts,
      onInput: (v) => {
        const b = boxVals();
        if (ratioLock && (k === 'width' || k === 'height') && b.width > 0 && b.height > 0) {
          const ratio = b.width / b.height;
          if (k === 'width') editor.setBox({ width: v, height: v / ratio }); else editor.setBox({ height: v, width: v * ratio });
        } else editor.setBox({ [k]: v });
      },
    });
    reg(() => { const b = boxVals(); c.set(b[k]); });
    return c;
  };

  const withTargets = (getTargets) => (fnOrPatch, o = {}) => {
    editor.change(o.label || 'Edit', (page) => {
      for (const t of getTargets()) {
        const live = page.objects.find((x) => x.id === t.id);
        if (!live) continue;
        const target = o.path ? getIn(live, o.path) : live;
        if (typeof fnOrPatch === 'function') fnOrPatch(target, live); else Object.assign(target, fnOrPatch);
        if (live.type === 'text') fitText(live);
      }
    }, { key: o.key ? `${o.key}:${objs().map((x) => x.id).join(',')}` : null });
  };

  const styleTargets = () => editor.editableIds().map((id) => editor.get(id)).filter(Boolean);

  /* ------------------------------- sections ------------------------------- */

  const arrangeSection = () => {
    const mk = (name, label, fn) => iconButton({ name, label, onClick: fn });
    const al = h('div.btn-row', ['alignLeft:left:Align left', 'alignCenterH:center:Align centre', 'alignRight:right:Align right', 'alignTop:top:Align top', 'alignMiddle:middle:Align middle', 'alignBottom:bottom:Align bottom']
      .map((s) => { const [n, m, l] = s.split(':'); return mk(n, l, () => editor.align(m, alignTo)); }));
    const dist = h('div.btn-row',
      mk('distributeH', 'Distribute horizontally', () => { if (!editor.distribute('h')) editor.emit('toast', { message: 'Select three or more objects to distribute.', kind: 'info' }); }),
      mk('distributeV', 'Distribute vertically', () => { if (!editor.distribute('v')) editor.emit('toast', { message: 'Select three or more objects to distribute.', kind: 'info' }); }),
      h('span.btn-sep'),
      mk('toFront', 'Bring to front', () => editor.order('front')), mk('forward', 'Bring forward', () => editor.order('forward')),
      mk('backward', 'Send backward', () => editor.order('backward')), mk('toBack', 'Send to back', () => editor.order('back')));
    const target = segmented({
      label: 'Align to', options: [{ value: 'auto', label: 'Selection' }, { value: 'page', label: 'Page' }], value: alignTo, iconOnly: false,
      onChange: (v) => { alignTo = v; target.set(v); },
    });
    return section('Arrange', { key: 'arrange' }, al, dist, row('Align to', target.el));
  };

  const layoutSection = () => {
    const ratio = iconButton({ name: 'link', label: 'Lock proportions', pressed: ratioLock, onClick: () => { ratioLock = !ratioLock; ratio.setAttribute('aria-pressed', String(ratioLock)); } });
    const x = boxField('X', 'x'), y = boxField('Y', 'y'), w = boxField('Width', 'width', { min: 1 }), hh = boxField('Height', 'height', { min: 1 });
    const rot = boxField('Rotation', 'rotation', { min: -360, max: 360, unit: '°', dp: 1 });
    const multi = objs().length > 1 || isContainer(objs()[0]);
    return section('Layout', { key: 'layout' },
      h('div.grid2', row('X', x.el), row('Y', y.el)),
      h('div.grid2.with-lock', row('W', w.el), row('H', hh.el), ratio),
      multi ? h('p.hint', 'Rotating a selection turns each object around the selection centre.') : null,
      row('Rotate', rot.el));
  };

  const appearanceSection = () => {
    const first = objs()[0];
    const op = slider({ label: 'Opacity', value: 100, min: 0, max: 100, unit: '%', onInput: (v) => editor.setProp('opacity', v / 100, { label: 'Change opacity' }) });
    reg(() => { const v = vals((o) => Math.round(o.opacity * 100)); op.set(v[0], !same(v)); });
    const blend = selectInput({ label: 'Blend mode', options: BLEND_MODES.map((b) => ({ value: b.id, label: b.label })), value: first.blendMode, onChange: (v) => editor.setProp('blendMode', v, { label: 'Change blend mode' }) });
    reg(() => { const v = vals((o) => o.blendMode); blend.set(v[0]); });
    const items = [row('Opacity', op.el), row('Blend', blend.el)];
    const sel = objs();
    if (sel.every((o) => ['rectangle', 'roundedRectangle', 'frame', 'image'].includes(o.type))) {
      const rad = prop('Corner radius', (o) => o.radius || 0, 'radius', { min: 0, max: 5000, unit: 'px', dp: 0 }, (v) => editor.setProps({ radius: v, radii: null }, { label: 'Change corner radius', key: 'radius' }));
      items.push(row('Corners', rad.el));
      const ind = toggle({ label: 'Independent corners', value: independentRadii, onChange: (v) => { independentRadii = v; key = ''; refresh(); } });
      items.push(row('Per corner', ind.el));
      if (independentRadii) {
        const cr = [0, 1, 2, 3].map((i) => {
          const c = numberInput({
            label: ['Top left', 'Top right', 'Bottom right', 'Bottom left'][i], value: 0, min: 0, max: 5000, dp: 0,
            onInput: (v) => editor.setProp('radii', (() => { const base = (objs()[0].radii && objs()[0].radii.slice()) || Array(4).fill(objs()[0].radius || 0); base[i] = v; return base; })(), { label: 'Change corner radius', key: `radii${i}` }),
          });
          reg(() => { const o = objs()[0]; c.set((o.radii && o.radii[i]) ?? (o.radius || 0)); });
          return c;
        });
        items.push(h('div.grid4', cr.map((c) => c.el)));
      }
      if (sel.every((o) => o.type === 'frame')) {
        const clip = toggle({ label: 'Clip content', value: first.clip, onChange: (v) => editor.setProp('clip', v, { label: 'Toggle clipping' }) });
        reg(() => clip.set(objs()[0].clip));
        items.push(row('Clip content', clip.el));
      }
    }
    if (sel.every((o) => o.type === 'polygon')) {
      const c = prop('Sides', (o) => o.sides, 'sides', { min: 3, max: 60, dp: 0 });
      items.push(row('Sides', c.el));
    }
    if (sel.every((o) => o.type === 'star')) {
      items.push(row('Points', prop('Points', (o) => o.points, 'points', { min: 3, max: 60, dp: 0 }).el));
      items.push(row('Inner size', prop('Inner size', (o) => Math.round(o.innerRatio * 100), 'innerRatio', { min: 5, max: 95, unit: '%', dp: 0, transform: (v) => v / 100 }).el));
    }
    if (sel.every((o) => o.type === 'arrow')) {
      items.push(row('Head size', prop('Head size', (o) => Math.round(o.headRatio * 100), 'headRatio', { min: 10, max: 90, unit: '%', dp: 0, transform: (v) => v / 100 }).el));
    }
    return section('Appearance', { key: 'appearance' }, items);
  };

  const paintSection = (title, kind, allowNone) => {
    const api = {
      get: () => objs()[0][kind],
      set: (fnOrPatch, o = {}) => withTargets(styleTargets)(fnOrPatch, { ...o, path: kind }),
      refresh: () => { key = ''; refresh(); },
      remember: (hex) => editor.rememberColor(hex),
    };
    const pe = paintEditor({ label: title, api, allowNone, recent: () => editor.doc.settings.recentColors, styles: () => editor.doc.colorStyles.map((c) => c.color) });
    reg(() => pe.refresh());
    pe.refresh();
    const items = [pe.el];
    if (kind === 'stroke') {
      const sel = objs();
      items.push(row('Width', prop('Stroke width', (o) => o.stroke.width, 'stroke.width', { min: 0, max: 500, unit: 'px', dp: 1 }).el));
      const cap = selectInput({ label: 'Cap', options: [{ value: 'butt', label: 'Butt' }, { value: 'round', label: 'Round' }, { value: 'square', label: 'Square' }], value: sel[0].stroke.cap, onChange: (v) => editor.setProp('stroke.cap', v, { label: 'Change stroke cap' }) });
      const join = selectInput({ label: 'Join', options: [{ value: 'miter', label: 'Miter' }, { value: 'round', label: 'Round' }, { value: 'bevel', label: 'Bevel' }], value: sel[0].stroke.join, onChange: (v) => editor.setProp('stroke.join', v, { label: 'Change stroke join' }) });
      const dash = selectInput({ label: 'Dash', options: [{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }, { value: 'long', label: 'Long dash' }], value: sel[0].stroke.dash, onChange: (v) => editor.setProp('stroke.dash', v, { label: 'Change dash pattern' }) });
      reg(() => { const o = objs()[0]; cap.set(o.stroke.cap); join.set(o.stroke.join); dash.set(o.stroke.dash); });
      items.push(row('Cap', cap.el), row('Join', join.el), row('Dash', dash.el));
    }
    return section(title, { key: title.toLowerCase() }, items);
  };

  const textSection = () => {
    const first = objs()[0];
    const local = editor.doc.fonts;
    const cat = fonts.catalog(local);
    const familyOptions = [];
    const groups = ['uploaded', 'sans-serif', 'serif', 'monospace', 'display', 'handwriting'];
    for (const g of groups) {
      const items = cat.filter((f) => f.category === g);
      if (items.length) familyOptions.push(h('optgroup', { label: g === 'uploaded' ? 'Uploaded' : g.replace('-', ' ') }, items.map((f) => h('option', { value: f.family }, f.family))));
    }
    const fam = h('select.select', { 'aria-label': 'Font family' }, familyOptions);
    fam.value = first.fontFamily;
    if (fam.value !== first.fontFamily) fam.prepend(h('option', { value: first.fontFamily }, first.fontFamily));
    fam.value = first.fontFamily;
    const status = h('p.hint.font-status', { role: 'status' });
    const updateStatus = () => {
      const st = fonts.stateOf(objs()[0] && objs()[0].fontFamily);
      status.textContent = st === 'loading' ? 'Loading font…' : st === 'failed' ? 'This font couldn’t load; a fallback font is shown. Check your connection.' : '';
      status.classList.toggle('error', st === 'failed');
    };
    fam.addEventListener('keydown', (e) => e.stopPropagation());
    fam.addEventListener('change', async () => {
      const f = fam.value;
      const meta = fonts.info(f, local);
      const weights = meta ? meta.weights : [400, 700];
      const w = objs()[0].fontWeight;
      const nextW = weights.includes(w) ? w : weights.includes(400) ? 400 : weights[0];
      editor.setProps({ fontFamily: f, fontWeight: nextW }, { label: 'Change font' });
      status.textContent = 'Loading font…';
      await fonts.load(f);
      editor.setProps({ fontFamily: f }, { label: 'Change font', key: `font:${f}` });
      updateStatus();
      key = ''; refresh();
    });
    const meta = fonts.info(first.fontFamily, local) || { weights: [400, 700], italic: true };
    const wOpts = [...new Set([...meta.weights, first.fontWeight])].sort((a, b) => a - b);
    const WN = { 100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' };
    const weight = selectInput({ label: 'Font weight', options: wOpts.map((w) => ({ value: String(w), label: `${WN[w] || w}` })), value: String(first.fontWeight), onChange: (v) => editor.setProp('fontWeight', Number(v), { label: 'Change font weight' }) });
    const style = h('div.btn-row',
      iconButton({ name: 'italic', label: 'Italic', pressed: first.fontStyle === 'italic', onClick: (e) => { const on = objs()[0].fontStyle !== 'italic'; editor.setProp('fontStyle', on ? 'italic' : 'normal', { label: 'Toggle italic' }); } }),
      iconButton({ name: 'underline', label: 'Underline', pressed: first.underline, onClick: () => editor.setProp('underline', !objs()[0].underline, { label: 'Toggle underline' }) }),
      iconButton({ name: 'strike', label: 'Strikethrough', pressed: first.strike, onClick: () => editor.setProp('strike', !objs()[0].strike, { label: 'Toggle strikethrough' }) }));
    const align = segmented({ label: 'Text alignment', options: [{ value: 'left', label: 'Align left', icon: 'textLeft' }, { value: 'center', label: 'Align centre', icon: 'textCenter' }, { value: 'right', label: 'Align right', icon: 'textRight' }], value: first.align, onChange: (v) => editor.setProp('align', v, { label: 'Change alignment' }) });
    const size = prop('Font size', (o) => o.fontSize, 'fontSize', { min: 1, max: 2000, unit: 'px', dp: 1 });
    const lh = prop('Line height', (o) => o.lineHeight, 'lineHeight', { min: 0.5, max: 4, step: 0.05, dp: 2 });
    const ls = prop('Letter spacing', (o) => o.letterSpacing, 'letterSpacing', { min: -50, max: 200, step: 0.5, unit: 'px', dp: 1 });
    const auto = segmented({ label: 'Text box', options: [{ value: 'auto', label: 'Auto width' }, { value: 'fixed', label: 'Fixed width' }], value: first.autoWidth ? 'auto' : 'fixed', iconOnly: false, onChange: (v) => editor.setProps({ autoWidth: v === 'auto' }, { label: 'Change text box' }) });
    reg(() => {
      const o = objs()[0];
      fam.value = o.fontFamily; weight.set(String(o.fontWeight)); align.set(o.align); auto.set(o.autoWidth ? 'auto' : 'fixed');
      style.children[0].setAttribute('aria-pressed', String(o.fontStyle === 'italic'));
      style.children[1].setAttribute('aria-pressed', String(!!o.underline));
      style.children[2].setAttribute('aria-pressed', String(!!o.strike));
      updateStatus();
    });
    updateStatus();
    const edit = h('button.btn.btn-block', { type: 'button', onclick: () => { editor.setTool('text'); stage.tools.get('text').edit(objs()[0].id, stage._ctx()); } }, 'Edit text');
    return section('Text', { key: 'text' }, edit, row('Font', fam), status, row('Weight', weight.el), row('Size', size.el),
      h('div.grid2', row('Line', lh.el), row('Spacing', ls.el)), row('Style', style), row('Align', align.el), row('Box', auto.el));
  };

  const imageSection = () => {
    const o0 = objs()[0];
    const fit = selectInput({ label: 'Image fit', options: [{ value: 'cover', label: 'Fill (crop to box)' }, { value: 'contain', label: 'Fit (letterbox)' }, { value: 'stretch', label: 'Stretch' }], value: o0.fit, onChange: (v) => editor.setProp('fit', v, { label: 'Change image fit' }) });
    reg(() => fit.set(objs()[0].fit));
    const replace = h('button.btn.btn-block', { type: 'button', onclick: () => editor.emit('replace-image', objs()[0].id) }, 'Replace image…');
    const reset = h('button.btn.btn-block', {
      type: 'button',
      onclick: () => {
        const o = objs()[0];
        if (o.naturalWidth > 0) editor.setBox({ width: o.naturalWidth, height: o.naturalHeight });
      },
    }, 'Reset to natural size');
    const meta = editor.doc.assets[o0.assetId];
    const src = meta && meta.source && meta.source.provider === 'openverse'
      ? h('p.hint', `“${meta.source.title}” by ${meta.source.creator} · ${meta.source.license}`) : null;
    return section('Image', { key: 'image' }, row('Fit', fit.el), replace, reset, src);
  };

  const textureSection = () => {
    const o0 = objs()[0];
    const kind = selectInput({ label: 'Texture', options: TEXTURE_KINDS.map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) })), value: o0.kind, onChange: (v) => editor.setProp('kind', v, { label: 'Change texture' }) });
    reg(() => kind.set(objs()[0].kind));
    const col = colorInput({ label: 'Texture colour', value: o0.color, onInput: (v) => editor.setProp('color', v, { label: 'Change texture colour', key: 'texcolor' }) });
    reg(() => col.set(objs()[0].color));
    const shuffle = h('button.btn.btn-block', { type: 'button', onclick: () => editor.setProp('seed', Math.floor(Math.random() * 99999), { label: 'Shuffle texture' }) }, 'Shuffle pattern');
    return section('Texture', { key: 'texture' }, row('Pattern', kind.el), row('Colour', col.el),
      row('Scale', prop('Scale', (o) => o.scale, 'scale', { min: 2, max: 600, dp: 0 }).el),
      row('Intensity', prop('Intensity', (o) => Math.round(o.intensity * 100), 'intensity', { min: 0, max: 100, unit: '%', dp: 0, transform: (v) => v / 100 }).el),
      row('Density', prop('Density', (o) => Math.round(o.density * 100), 'density', { min: 0, max: 100, unit: '%', dp: 0, transform: (v) => v / 100 }).el), shuffle);
  };

  const iconSection = () => {
    const o = objs()[0];
    const s = o.source;
    return section('Icon', { key: 'icon' },
      h('p.hint', s ? `${s.name} · ${s.set || s.provider} · ${s.license}${s.author ? ` · ${s.author}` : ''}` : 'Imported vector graphic.'),
      h('p.hint', 'Colour comes from the Fill below. Icons from Iconify keep their original licence.'));
  };

  const effectSub = (title, path, toggled, children) => {
    const t = toggle({ label: `${title} enabled`, value: toggled, onChange: (v) => { editor.setProp(`effects.${path}.on`, v, { label: `${v ? 'Add' : 'Remove'} ${title.toLowerCase()}` }); key = ''; refresh(); } });
    return h('div.effect', h('div.effect-head', h('span', title), t.el), toggled ? h('div.effect-body', children) : null);
  };

  const effectsSection = () => {
    const e = objs()[0].effects;
    const shadow = effectSub('Drop shadow', 'shadow', e.shadow.on, (() => {
      const c = colorInput({ label: 'Shadow colour', value: e.shadow.color, onInput: (v) => editor.setProp('effects.shadow.color', v, { label: 'Change shadow colour', key: 'shc' }) });
      reg(() => c.set(objs()[0].effects.shadow.color));
      return [row('Colour', c.el),
        row('Opacity', prop('Shadow opacity', (o) => Math.round(o.effects.shadow.opacity * 100), 'effects.shadow.opacity', { min: 0, max: 100, unit: '%', dp: 0, transform: (v) => v / 100 }).el),
        row('Blur', prop('Shadow blur', (o) => o.effects.shadow.blur, 'effects.shadow.blur', { min: 0, max: 300, dp: 0 }).el),
        h('div.grid2', row('X', prop('Shadow X', (o) => o.effects.shadow.dx, 'effects.shadow.dx', { dp: 0 }).el), row('Y', prop('Shadow Y', (o) => o.effects.shadow.dy, 'effects.shadow.dy', { dp: 0 }).el))];
    })());
    const blur = effectSub('Blur', 'blur', e.blur.on, [row('Amount', prop('Blur amount', (o) => o.effects.blur.amount, 'effects.blur.amount', { min: 0, max: 100, dp: 1 }).el)]);
    const outline = effectSub('Outline', 'outline', e.outline.on, (() => {
      const c = colorInput({ label: 'Outline colour', value: e.outline.color, onInput: (v) => editor.setProp('effects.outline.color', v, { label: 'Change outline colour', key: 'olc' }) });
      reg(() => c.set(objs()[0].effects.outline.color));
      return [row('Colour', c.el), row('Width', prop('Outline width', (o) => o.effects.outline.width, 'effects.outline.width', { min: 0, max: 100, dp: 1 }).el)];
    })());
    return section('Effects', { key: 'effects', open: false }, shadow, blur, outline);
  };

  const pathSection = () => {
    const o = objs()[0];
    const direct = stage.tools.get('direct');
    const items = [];
    if (o.type !== 'path') {
      items.push(h('button.btn.btn-block', { type: 'button', onclick: () => editor.convertToPath(o.id) }, 'Convert to editable path'));
    } else {
      const sp = o.subpaths;
      const closed = sp.length === 1 && sp[0].closed;
      items.push(h('div.btn-row.wrap',
        h('button.btn', {
          type: 'button', disabled: sp.length !== 1,
          onclick: () => editor.change(closed ? 'Open path' : 'Close path', (page) => { page.objects.find((x) => x.id === o.id).subpaths[0].closed = !closed; }),
        }, closed ? 'Open path' : 'Close path'),
        h('button.btn', { type: 'button', onclick: () => { editor.setTool('direct'); } }, 'Edit nodes'),
        h('button.btn', { type: 'button', onclick: () => editor.setProp('fillRule', objs()[0].fillRule === 'evenodd' ? 'nonzero' : 'evenodd', { label: 'Change fill rule' }) }, o.fillRule === 'evenodd' ? 'Fill: even-odd' : 'Fill: non-zero')));
      if (editor.toolId === 'direct') {
        items.push(h('div.btn-row.wrap',
          h('button.btn', { type: 'button', onclick: () => nodeAction(o.id, direct, true) }, 'Smooth'),
          h('button.btn', { type: 'button', onclick: () => nodeAction(o.id, direct, false) }, 'Corner'),
          h('button.btn', { type: 'button', onclick: () => { direct.selectAllNodes(editor); stage.invalidate({ overlay: true }); } }, 'Select all')));
        items.push(h('p.hint', 'Drag nodes and handles. Double-click a path to add a node, double-click a node to switch smooth/corner. Delete removes selected nodes. Alt-drag a handle to break symmetry.'));
      }
    }
    return section('Path', { key: 'path' }, items);
  };

  const nodeAction = (id, direct, smooth) => {
    const ks = direct.selectedNodes();
    if (!ks.length) { editor.emit('toast', { message: 'Select one or more nodes first.', kind: 'info' }); return; }
    smoothNodes(id, ks, smooth);
  };

  const smoothNodes = (id, keys, smooth) => {
    
    editor.change(smooth ? 'Smooth nodes' : 'Corner nodes', (page) => {
      const live = page.objects.find((x) => x.id === id);
      for (const k of keys) {
        const [si, ni] = k.split(':').map(Number);
        const sp = live.subpaths[si];
        if (!sp || !sp.nodes[ni]) continue;
        if (smooth) ops.makeSmooth(sp, ni); else ops.makeCorner(sp, ni);
      }
    });
  };

  /* ------------------------------- tool sections ------------------------------- */

  const brushSection = () => {
    const b = editor.toolOptions.brush;
    const isEraser = editor.toolId === 'eraser';
    const presets = h('div.brush-grid', { role: 'radiogroup', 'aria-label': 'Brush preset' }, BRUSH_PRESETS.map((p) => {
      const cv = h('canvas', { width: 120, height: 34 });
      requestAnimationFrame(() => drawPresetPreview(cv, p, getComputedStyle(root).getPropertyValue('--text').trim() || '#18181b'));
      const btn = h('button.brush-btn', {
        type: 'button', role: 'radio', 'aria-checked': String(b.preset === p.id), title: p.name,
        onclick: () => { b.preset = p.id; editor.emit('brush'); presets.querySelectorAll('.brush-btn').forEach((x) => x.setAttribute('aria-checked', String(x === btn))); },
      }, cv, h('span', p.name));
      return btn;
    }));
    const size = slider({ label: 'Brush size', value: b.size, min: 1, max: 300, unit: 'px', onInput: (v) => { b.size = v; } });
    const op = slider({ label: 'Brush opacity', value: Math.round(b.opacity * 100), min: 1, max: 100, unit: '%', onInput: (v) => { b.opacity = v / 100; } });
    const sm = slider({ label: 'Smoothing', value: Math.round(b.smoothing * 100), min: 0, max: 100, unit: '%', onInput: (v) => { b.smoothing = v / 100; } });
    const col = colorInput({ label: 'Brush colour', value: b.color, onInput: (v) => { b.color = v; }, onCommit: (v) => editor.rememberColor(v) });
    reg(() => { size.set(b.size); });
    const newLayer = h('button.btn.btn-block', { type: 'button', onclick: () => editor.emit('new-paint-layer') }, 'New paint layer');
    return section(isEraser ? 'Eraser' : 'Brush', { key: 'brush' },
      !isEraser ? presets : null, row('Size', size.el), row('Opacity', op.el), row('Smooth', sm.el), !isEraser ? row('Colour', col.el) : null,
      h('p.hint', 'Paint lives on raster layers, separate from vector shapes. Pen pressure is used when your device provides it. [ and ] change the size.'), newLayer);
  };

  const sampleSection = () => {
    const seg = segmented({ label: 'Colour target', options: [{ value: 'fill', label: 'Fill' }, { value: 'stroke', label: 'Stroke' }], value: editor.toolOptions.fillTarget, iconOnly: false, onChange: (v) => { editor.toolOptions.fillTarget = v; seg.set(v); stage.invalidate({ overlay: true }); } });
    const last = editor.toolOptions.sampled;
    return section(editor.toolId === 'gradient' ? 'Gradient' : 'Eyedropper', { key: 'sample' }, row('Applies to', seg.el),
      editor.toolId === 'gradient'
        ? [row('Type', segmented({ label: 'Gradient type', options: [{ value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }], value: editor.toolOptions.gradientKind, iconOnly: false, onChange: (v) => { editor.toolOptions.gradientKind = v; key = ''; refresh(); } }).el),
          h('p.hint', 'Select a shape, then drag on the canvas to draw a gradient. Drag the handles to adjust it; edit stops below in the Fill section.')]
        : h('p.hint', last ? `Last sampled: ${last.toUpperCase()}. Click anywhere on the page to sample; hold Shift or Alt to apply to the stroke.` : 'Click anywhere on the page to sample a colour. Hold Shift or Alt to apply it to the stroke.'));
  };

  const shapeOptions = () => {
    const sh = editor.toolOptions.shape;
    const isPoly = editor.toolId === 'polygon', isStar = editor.toolId === 'star';
    return section(isPoly ? 'Polygon' : 'Star', { key: 'shapeopts' },
      isPoly ? row('Sides', numberInput({ label: 'Sides', value: sh.sides, min: 3, max: 60, dp: 0, onInput: (v) => { sh.sides = Math.round(v); } }).el) : null,
      isStar ? row('Points', numberInput({ label: 'Points', value: sh.points, min: 3, max: 60, dp: 0, onInput: (v) => { sh.points = Math.round(v); } }).el) : null,
      isStar ? row('Inner size', numberInput({ label: 'Inner size', value: Math.round(sh.innerRatio * 100), min: 5, max: 95, unit: '%', dp: 0, onInput: (v) => { sh.innerRatio = v / 100; } }).el) : null,
      h('p.hint', 'Drag on the page to draw. Hold Shift for equal sides, Alt to draw from the centre.'));
  };

  /* ------------------------------- page section ------------------------------- */

  const pageSection = () => {
    const page = editor.page;
    const name = h('input.text-input', { type: 'text', value: page.name, 'aria-label': 'Page name', maxLength: 80 });
    name.addEventListener('change', () => editor.setPageProps({ name: name.value.trim() || page.name }));
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); e.stopPropagation(); });
    const w = numberInput({ label: 'Page width', value: page.width, min: 1, max: 16000, dp: 0, unit: 'px', onInput: (v) => editor.setPageProps({ width: Math.round(v) }, { key: 'pw' }) });
    const hh = numberInput({ label: 'Page height', value: page.height, min: 1, max: 16000, dp: 0, unit: 'px', onInput: (v) => editor.setPageProps({ height: Math.round(v) }, { key: 'ph' }) });
    reg(() => { w.set(editor.page.width); hh.set(editor.page.height); });
    const presets = h('select.select', { 'aria-label': 'Size preset' },
      h('option', { value: '' }, 'Choose a preset…'),
      ...['Social', 'Presentation', 'Print', 'Screen'].map((g) => h('optgroup', { label: g }, PAGE_PRESETS.filter((p) => p.group === g).map((p) => h('option', { value: p.id }, `${p.name} — ${p.width}×${p.height}`)))));
    presets.addEventListener('keydown', (e) => e.stopPropagation());
    presets.addEventListener('change', () => {
      const p = PAGE_PRESETS.find((x) => x.id === presets.value);
      if (p) { editor.setPageProps({ width: p.width, height: p.height }, { key: null }); stage.fitPage(); }
      presets.value = '';
    });
    const bg = colorInput({ label: 'Page background', value: page.background.color, onInput: (v) => editor.setPageProps({ 'background.color': v }, { key: 'pbg' }), onCommit: (v) => editor.rememberColor(v) });
    reg(() => bg.set(editor.page.background.color));
    const transparent = toggle({ label: 'Transparent background', value: page.background.transparent, onChange: (v) => editor.setPageProps({ 'background.transparent': v }) });
    reg(() => transparent.set(editor.page.background.transparent));
    const gridShow = toggle({ label: 'Show grid', value: page.gridSettings.show, onChange: (v) => editor.setPageProps({ 'gridSettings.show': v }) });
    const gridSnap = toggle({ label: 'Snap to grid', value: page.gridSettings.snap, onChange: (v) => editor.setPageProps({ 'gridSettings.snap': v }) });
    const gridSize = numberInput({ label: 'Grid size', value: page.gridSettings.size, min: 2, max: 500, dp: 0, unit: 'px', onInput: (v) => editor.setPageProps({ 'gridSettings.size': Math.round(v) }, { key: 'gs' }) });
    const snap = toggle({ label: 'Snap to objects', value: editor.doc.settings.snap, onChange: (v) => { editor.doc.settings.snap = v; editor.commit('Toggle snapping'); } });
    const rulers = toggle({ label: 'Show rulers', value: !!editor.doc.settings.rulers, onChange: (v) => { editor.doc.settings.rulers = v; editor.commit('Toggle rulers'); } });
    const recent = editor.doc.settings.recentColors;
    const styles = editor.doc.colorStyles;
    const addStyle = h('button.btn.btn-block', {
      type: 'button',
      onclick: () => {
        const c = normalizeHex(editor.toolOptions.sampled || editor.toolOptions.brush.color);
        editor.change('Add colour style', (pg, doc) => { doc.colorStyles.push({ id: shortId('c'), name: c.toUpperCase(), color: c }); });
      },
    }, 'Save current colour as a style');
    return [
      section('Page', { key: 'page' }, row('Name', name), row('Preset', presets), h('div.grid2', row('W', w.el), row('H', hh.el)), row('Background', bg.el), row('Transparent', transparent.el)),
      section('Guides & snapping', { key: 'guides' }, row('Show grid', gridShow.el), row('Grid size', gridSize.el), row('Snap to grid', gridSnap.el), row('Snap to objects', snap.el), row('Rulers', rulers.el)),
      section('Colours', { key: 'colors', open: false },
        recent.length ? h('div.swatches', recent.map((c) => h('button.swatch', { type: 'button', style: { background: c }, title: c, 'aria-label': `Recent colour ${c}`, onclick: () => { editor.toolOptions.sampled = c; } }))) : h('p.hint', 'Colours you use appear here.'),
        styles.length ? h('div.swatches', styles.map((s) => h('button.swatch.style', {
          type: 'button', style: { background: s.color }, title: `${s.name} (click to apply, Alt-click to remove)`, 'aria-label': `Colour style ${s.name}`,
          onclick: (e) => {
            if (e.altKey) editor.change('Remove colour style', (pg, doc) => { doc.colorStyles = doc.colorStyles.filter((c) => c.id !== s.id); });
            else if (editor.editableIds().length) editor.setProp('fill.color', s.color, { label: 'Apply colour style' });
          },
        }))) : null, addStyle),
      h('div.empty-inspect', h('p.empty-title', 'Nothing selected'), h('p', 'Select an object to edit its properties, or choose a tool to start designing.')),
    ];
  };

  /* ------------------------------- build / sync ------------------------------- */

  const structure = () => {
    const sel = objs();
    const f = sel[0];
    return JSON.stringify([
      editor.toolId === 'direct' ? 'direct' : ['brush', 'pencil', 'eraser'].includes(editor.toolId) ? 'paint' : ['eyedropper', 'gradient'].includes(editor.toolId) ? editor.toolId : ['polygon', 'star'].includes(editor.toolId) ? editor.toolId : '',
      editor.toolId === 'gradient' ? editor.toolOptions.gradientKind : '',
      sel.map((o) => [o.id, o.type, o.type === 'path' ? o.subpaths.length + ':' + o.subpaths[0]?.closed : '', o.type === 'text' ? o.fontFamily : '']),
      f ? [f.effects.shadow.on, f.effects.blur.on, f.effects.outline.on, f.fill.type, f.stroke.type, f.type === 'image' ? f.assetId : ''] : editor.page.id,
      editor.doc.settings.recentColors.length, editor.doc.colorStyles.length, independentRadii,
    ]);
  };

  const build = () => {
    ctrls = [];
    root.replaceChildren();
    const sel = objs();
    const tool = editor.toolId;
    if (['brush', 'pencil', 'eraser'].includes(tool)) root.append(brushSection());
    if (['eyedropper', 'gradient'].includes(tool)) root.append(sampleSection());
    if (['polygon', 'star'].includes(tool)) root.append(shapeOptions());
    if (tool === 'pen') root.append(section('Pen', { key: 'pen' }, h('p.hint', 'Click for straight corners; click and drag to pull out curve handles. Click the first point to close. Enter finishes an open path; Esc finishes (or cancels a single point); Backspace removes the last point. Hold Ctrl/⌘ to skip snapping.')));
    if (!sel.length) {
      root.append(...pageSection());
    } else {
      const first = sel[0];
      const allSame = sel.every((o) => o.type === first.type);
      const header = h('div.sel-head', h('span.sel-type', { html: icon('layers', 15) }), h('span.sel-title', sel.length > 1 ? `${sel.length} layers` : `${typeLabel(first.type)}`), sel.every((o) => o.locked) ? h('span.badge', 'Locked') : null);
      root.append(header, arrangeSection(), layoutSection(), appearanceSection());
      if (allSame && first.type === 'text') root.append(textSection());
      if (allSame && first.type === 'image') root.append(imageSection());
      if (allSame && first.type === 'texture') root.append(textureSection());
      if (allSame && first.type === 'icon') root.append(iconSection());
      if (sel.length === 1 && !isContainer(first) && ['path', 'rectangle', 'roundedRectangle', 'ellipse', 'polygon', 'star', 'arrow', 'line'].includes(first.type)) root.append(pathSection());
      if (sel.every((o) => hasFill(o)) && !(first.type === 'texture')) root.append(paintSection(first.type === 'text' || first.type === 'icon' ? 'Fill' : 'Fill', 'fill', first.type !== 'text' && first.type !== 'icon'));
      if (sel.every((o) => hasStroke(o)) && first.type !== 'text') root.append(paintSection('Stroke', 'stroke', true));
      if (sel.every((o) => o.type !== 'rasterLayer' || true)) root.append(effectsSection());
      if (sel.length === 1 && first.type === 'rasterLayer') root.append(section('Paint layer', { key: 'rl' }, h('p.hint', 'Select the Brush or Eraser to paint on this layer. Paint layers support opacity and blend modes like any layer.'),
        h('button.btn.btn-block', { type: 'button', onclick: () => editor.setTool('brush') }, 'Paint on this layer')));
      if (sel.length === 1 && first.type === 'group') root.append(h('p.hint.pad', 'Double-click a group on the canvas to edit the objects inside it.'));
      if (sel.length > 1 && sel.every((o) => !isContainer(o))) {
        root.append(section('Combine', { key: 'combine' }, h('button.btn.btn-block', { type: 'button', onclick: () => editor.combinePaths() }, 'Combine into one compound path')));
      }
    }
    sync();
  };

  const sync = () => { for (const fn of ctrls) fn(); };

  const refresh = () => {
    const k = structure();
    if (k !== key) { key = k; build(); } else sync();
  };

  const offs = [
    editor.on('selection', refresh), editor.on('tool', refresh), editor.on('page', () => { key = ''; refresh(); }),
    editor.on('change', refresh), editor.on('nodes', () => { key = ''; refresh(); }), editor.on('colors', () => { key = ''; refresh(); }),
    editor.on('sample', () => { key = ''; refresh(); }),
    fonts.on('status', () => { key = ''; refresh(); }),
  ];
  refresh();
  return { el: root, refresh: () => { key = ''; refresh(); }, destroy: () => offs.forEach((o) => o()) };
}
