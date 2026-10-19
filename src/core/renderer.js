import { DASHES, childrenOf, indexPage, pathData, shapeToSubpaths, isContainer } from './document-model.js';
import { esc } from '../utils/dom.js';
import { familyCss, layoutText } from './text-layout.js';
import { safeIconMarkup } from '../utils/svg-sanitize.js';
import { textureDataUrl } from '../services/texture-service.js';

const n = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
};

/**
 * Renders a page's objects to SVG markup. The same function powers the live
 * stage and the SVG/PNG/JPEG/PDF exporters, so what you see is what you export.
 *
 * opts: { live, resolve(assetId)->url|null, hideIds:Set, hitPad:number }
 */
export function renderPageParts(doc, page, opts = {}) {
  const ctx = {
    doc, page, idx: indexPage(page), live: !!opts.live, resolve: opts.resolve || (() => null),
    hideIds: opts.hideIds || new Set(), hitPad: opts.hitPad || 8, defs: [], rasters: [], warnings: new Set(),
  };
  const body = childrenOf(page, null).map((o) => emit(o, ctx)).join('');
  return { defs: ctx.defs.join(''), body, rasters: ctx.rasters, warnings: [...ctx.warnings] };
}

export function buildPageSvg(doc, page, opts = {}) {
  const { defs, body, rasters, warnings } = renderPageParts(doc, page, opts);
  const w = page.width, h = page.height;
  const bg = !page.background.transparent || opts.forceBackground
    ? `<rect width="${w}" height="${h}" fill="${esc(opts.forceBackground || page.background.color)}"/>` : '';
  const font = opts.fontCss ? `<style><![CDATA[${opts.fontCss}]]></style>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="isolation:isolate"><defs>${font}${defs}</defs>${bg}${body}</svg>`;
  return { svg, rasters, warnings };
}

/** Font families referenced by a page's text objects. */
export function pageFontFamilies(page) {
  const s = new Set();
  for (const o of page.objects) if (o.type === 'text' && o.visible) s.add(o.fontFamily);
  return [...s];
}

/* ------------------------------------------------------------------ */

function paintAttrs(paint, key, w, h, ctx, kind) {
  // kind: 'fill' | 'stroke'
  const a = (v) => ` ${kind}="${v}"`;
  if (!paint || paint.type === 'none') return a('none');
  if (paint.type === 'solid') {
    return a(esc(paint.color)) + (paint.opacity < 1 ? ` ${kind}-opacity="${n(paint.opacity)}"` : '');
  }
  const id = `gr-${key}-${kind}`;
  const stops = [...paint.stops].sort((x, y) => x.offset - y.offset)
    .map((s) => `<stop offset="${n(s.offset)}" stop-color="${esc(s.color)}" stop-opacity="${n(s.opacity * (paint.opacity ?? 1))}"/>`).join('');
  if (paint.type === 'linear') {
    ctx.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n((Number.isFinite(paint.x1) ? paint.x1 : 0) * w)}" y1="${n((Number.isFinite(paint.y1) ? paint.y1 : 0.5) * h)}" x2="${n((Number.isFinite(paint.x2) ? paint.x2 : 1) * w)}" y2="${n((Number.isFinite(paint.y2) ? paint.y2 : 0.5) * h)}">${stops}</linearGradient>`);
  } else {
    ctx.defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n((Number.isFinite(paint.cx) ? paint.cx : 0.5) * w)}" cy="${n((Number.isFinite(paint.cy) ? paint.cy : 0.5) * h)}" r="${n(Math.max(0.0001, Number.isFinite(paint.r) ? paint.r : 0.5) * Math.max(w, h))}">${stops}</radialGradient>`);
  }
  return a(`url(#${id})`);
}

function strokeAttrs(o, ctx, extraWidth = 0) {
  const s = o.stroke;
  if (!s || s.type === 'none' || !(s.width > 0)) return ' stroke="none"';
  let out = paintAttrs(s, o.id, o.width, o.height, ctx, 'stroke');
  out += ` stroke-width="${n(s.width + extraWidth)}" stroke-linecap="${s.cap}" stroke-linejoin="${s.join}"`;
  const dash = DASHES[s.dash];
  if (dash) {
    const k = Math.max(1, s.width / 2);
    out += ` stroke-dasharray="${dash.split(' ').map((v) => n(parseFloat(v) * (s.dash === 'dotted' ? Math.max(0.5, s.width / 2) : k))).join(' ')}"`;
  }
  return out;
}

function effectsAttrs(o, ctx, region) {
  const e = o.effects;
  const sh = e.shadow.on, bl = e.blur.on;
  if (!sh && !bl) return '';
  const id = `fx-${o.id}`;
  const parts = [];
  let last = 'SourceGraphic';
  if (bl) {
    parts.push(`<feGaussianBlur in="${last}" stdDeviation="${n(e.blur.amount)}" result="b"/>`);
    last = 'b';
  }
  if (sh) {
    parts.push(`<feDropShadow in="${last}" dx="${n(e.shadow.dx)}" dy="${n(e.shadow.dy)}" stdDeviation="${n(e.shadow.blur / 2)}" flood-color="${esc(e.shadow.color)}" flood-opacity="${n(e.shadow.opacity)}"/>`);
  }
  const pad = (bl ? e.blur.amount * 3 : 0) + (sh ? e.shadow.blur * 2 + Math.abs(e.shadow.dx) + Math.abs(e.shadow.dy) : 0) + 20;
  ctx.defs.push(`<filter id="${id}" filterUnits="userSpaceOnUse" x="${n(region.x - pad)}" y="${n(region.y - pad)}" width="${n(region.w + pad * 2)}" height="${n(region.h + pad * 2)}" color-interpolation-filters="sRGB">${parts.join('')}</filter>`);
  return ` filter="url(#${id})"`;
}

function wrapperAttrs(o, ctx, transform, region) {
  let a = '';
  if (ctx.live) a += ` data-oid="${esc(o.id)}"`;
  if (transform) a += ` transform="${transform}"`;
  if (o.opacity < 1) a += ` opacity="${n(o.opacity)}"`;
  let style = '';
  if (o.blendMode && o.blendMode !== 'normal') style += `mix-blend-mode:${o.blendMode};`;
  if (ctx.live && (o.locked || o.type === 'rasterLayer')) style += 'pointer-events:none;';
  if (ctx.hideIds.has(o.id)) style += 'visibility:hidden;';
  if (style) a += ` style="${style}"`;
  a += effectsAttrs(o, ctx, region);
  return a;
}

function geometry(o) {
  return pathData(shapeToSubpaths(o));
}

function hitPath(o, ctx, d) {
  if (!ctx.live) return '';
  const unfilled = !o.fill || o.fill.type === 'none' || o.fill.opacity === 0;
  if (!unfilled) return '';
  return `<path d="${d}" fill="none" stroke="transparent" stroke-width="${Math.max(ctx.hitPad, (o.stroke && o.stroke.width) || 0)}" pointer-events="stroke"/>`;
}

function outlineUnder(o, ctx, d) {
  const ol = o.effects.outline;
  if (!ol.on || !(ol.width > 0)) return '';
  const base = o.stroke && o.stroke.type !== 'none' ? o.stroke.width : 0;
  return `<path d="${d}" fill="none" stroke="${esc(ol.color)}" stroke-width="${n(base + ol.width * 2)}" stroke-linejoin="round" stroke-linecap="round"/>`;
}

function textElement(o, l, fillStr, strokeStr, extra = '') {
  const w = o.width;
  const x = o.align === 'center' ? w / 2 : o.align === 'right' ? w : 0;
  const anchor = o.align === 'center' ? 'middle' : o.align === 'right' ? 'end' : 'start';
  const deco = [o.underline ? 'underline' : '', o.strike ? 'line-through' : ''].filter(Boolean).join(' ');
  const tspans = l.lines.map((ln, i) => `<tspan x="${n(x)}" y="${n(l.baseline + i * l.lineHeight)}">${esc(ln.text) || '&#8203;'}</tspan>`).join('');
  return `<text font-family="${esc(familyCss(o.fontFamily))}" font-size="${n(o.fontSize)}" font-weight="${o.fontWeight}" font-style="${o.fontStyle}" letter-spacing="${n(o.letterSpacing || 0)}" text-anchor="${anchor}"${deco ? ` text-decoration="${deco}"` : ''} style="white-space:pre"${fillStr}${strokeStr}${extra}>${tspans}</text>`;
}

function missingPlaceholder(o) {
  return `<rect width="${n(o.width)}" height="${n(o.height)}" fill="#e9ecef"/><path d="M0 0L${n(o.width)} ${n(o.height)}M${n(o.width)} 0L0 ${n(o.height)}" stroke="#adb5bd" stroke-width="2"/>`;
}

function emit(o, ctx) {
  if (!o.visible) return '';
  const w = o.width, h = o.height;
  const tf = `translate(${n(o.x)} ${n(o.y)})${o.rotation ? ` rotate(${n(o.rotation)} ${n(w / 2)} ${n(h / 2)})` : ''}`;
  const localRegion = { x: 0, y: 0, w, h };

  if (o.type === 'group') {
    const kids = childrenOf(ctx.page, o.id).map((k) => emit(k, ctx)).join('');
    if (!kids) return '';
    return `<g${wrapperAttrs(o, ctx, '', { x: o.x, y: o.y, w, h })}>${kids}</g>`;
  }

  if (o.type === 'frame') {
    const d = geometry(o);
    const kids = childrenOf(ctx.page, o.id).map((k) => emit(k, ctx)).join('');
    const cid = `cl-${o.id}`;
    if (o.clip) ctx.defs.push(`<clipPath id="${cid}"><path d="${d}" transform="translate(${n(o.x)} ${n(o.y)})"/></clipPath>`);
    const bg = `<g transform="translate(${n(o.x)} ${n(o.y)})"><path d="${d}"${paintAttrs(o.fill, o.id, w, h, ctx, 'fill')}${strokeAttrs(o, ctx)}/></g>`;
    return `<g${wrapperAttrs(o, ctx, '', { x: o.x, y: o.y, w, h })}>${bg}<g${o.clip ? ` clip-path="url(#${cid})"` : ''}>${kids}</g></g>`;
  }

  let inner = '';
  switch (o.type) {
    case 'rectangle': case 'roundedRectangle': case 'ellipse': case 'line': case 'polygon': case 'star': case 'arrow': case 'path': {
      const d = geometry(o);
      if (!d) return '';
      const fillRule = o.type === 'path' && o.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '';
      const closedFill = o.type === 'line' ? ' fill="none"' : paintAttrs(o.fill, o.id, w, h, ctx, 'fill');
      inner = outlineUnder(o, ctx, d) + `<path d="${d}"${closedFill}${fillRule}${strokeAttrs(o, ctx)}/>` + hitPath(o, ctx, d);
      break;
    }
    case 'text': {
      const l = layoutText(o);
      const fillStr = paintAttrs(o.fill, o.id, w, h, ctx, 'fill');
      const strokeStr = strokeAttrs(o, ctx);
      let under = '';
      const ol = o.effects.outline;
      if (ol.on && ol.width > 0) {
        under = textElement(o, l, ' fill="none"', ` stroke="${esc(ol.color)}" stroke-width="${n(ol.width * 2)}" stroke-linejoin="round"`);
      }
      inner = (ctx.live ? `<rect width="${n(w)}" height="${n(h)}" fill="transparent"/>` : '') + under + textElement(o, l, fillStr, strokeStr);
      break;
    }
    case 'image': {
      const url = o.assetId ? ctx.resolve(o.assetId) : null;
      const d = geometry({ ...o, type: 'rectangle', radius: o.radius || 0 });
      if (!url) { inner = missingPlaceholder(o); break; }
      const cid = `ci-${o.id}`;
      ctx.defs.push(`<clipPath id="${cid}"><path d="${d}"/></clipPath>`);
      const par = o.fit === 'contain' ? 'xMidYMid meet' : o.fit === 'stretch' ? 'none' : 'xMidYMid slice';
      inner = `<image href="${esc(url)}" x="0" y="0" width="${n(w)}" height="${n(h)}" preserveAspectRatio="${par}" clip-path="url(#${cid})"/>`
        + (o.stroke && o.stroke.type !== 'none' ? `<path d="${d}" fill="none"${strokeAttrs(o, ctx)}/>` : '');
      break;
    }
    case 'icon': {
      const vb = o.viewBox || [0, 0, 24, 24];
      const markup = safeIconMarkup(o.svg);
      const color = o.fill.type === 'none' ? 'transparent' : o.fill.color;
      inner = (ctx.live ? `<rect width="${n(w)}" height="${n(h)}" fill="transparent"/>` : '')
        + `<svg x="0" y="0" width="${n(w)}" height="${n(h)}" viewBox="${vb.map(n).join(' ')}" preserveAspectRatio="xMidYMid meet" color="${esc(color)}" overflow="hidden"${o.fill.opacity < 1 ? ` opacity="${n(o.fill.opacity)}"` : ''}>${markup}</svg>`;
      break;
    }
    case 'texture': {
      if (!(w > 0 && h > 0)) return '';
      let url = '';
      try { url = textureDataUrl(o); } catch { return ''; }
      inner = `<image href="${url}" x="0" y="0" width="${n(w)}" height="${n(h)}" preserveAspectRatio="none"/>`;
      break;
    }
    case 'rasterLayer': {
      if (ctx.live) {
        ctx.rasters.push(o.id);
        inner = `<foreignObject data-raster="${esc(o.id)}" x="0" y="0" width="${n(w)}" height="${n(h)}" style="overflow:visible"></foreignObject>`;
      } else {
        const url = o.assetId ? ctx.resolve(o.assetId) : null;
        if (!url) return '';
        inner = `<image href="${esc(url)}" x="0" y="0" width="${n(w)}" height="${n(h)}" preserveAspectRatio="none"/>`;
      }
      break;
    }
    default:
      return '';
  }
  return `<g${wrapperAttrs(o, ctx, tf, localRegion)}>${inner}</g>`;
}

export { isContainer };
