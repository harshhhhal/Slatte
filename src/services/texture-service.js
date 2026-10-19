/** Procedural textures drawn with Canvas 2D. Deterministic for a given seed. */

function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const cache = new Map();

export function textureKey(o) {
  return [o.kind, Math.round(o.width), Math.round(o.height), o.scale, o.intensity, o.density, o.color, o.seed, o.wave].join('|');
}

/** Returns a data URL; the canvas is capped at 2048px on its longest side. */
export function textureDataUrl(o) {
  const key = textureKey(o);
  const hit = cache.get(key);
  if (hit) return hit;
  const maxSide = 2048;
  const k = Math.min(1, maxSide / Math.max(o.width, o.height, 1));
  const w = Math.max(1, Math.round(o.width * k)), h = Math.max(1, Math.round(o.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h, o, k);
  const url = c.toDataURL('image/png');
  if (cache.size > 40) cache.clear();
  cache.set(key, url);
  return url;
}

function draw(ctx, w, h, o, k) {
  const r = rng(o.seed || 1);
  const scale = Math.max(2, o.scale) * k;
  const col = o.color || '#000000';
  const inten = o.intensity;
  ctx.fillStyle = col;
  ctx.strokeStyle = col;
  switch (o.kind) {
    case 'noise': case 'paper': {
      const img = ctx.createImageData(w, h);
      const rgb = [parseInt(col.slice(1, 3), 16), parseInt(col.slice(3, 5), 16), parseInt(col.slice(5, 7), 16)];
      const grain = o.kind === 'paper' ? Math.max(1, Math.round(scale / 20)) : 1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const gx = Math.floor(x / grain), gy = Math.floor(y / grain);
          const rr = rng((gx * 73856093) ^ (gy * 19349663) ^ (o.seed * 83492791));
          let v = rr();
          if (o.kind === 'paper') v = v * 0.6 + 0.4 * Math.sin(x / (scale * 0.7) + Math.sin(y / scale) * 2) * 0.5 + 0.2;
          const i = (y * w + x) * 4;
          img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2];
          img.data[i + 3] = Math.max(0, Math.min(255, v * 255 * inten * (o.density * 1.4)));
        }
      }
      ctx.putImageData(img, 0, 0);
      break;
    }
    case 'dots': case 'halftone': {
      const step = scale;
      for (let y = step / 2, row = 0; y < h + step; y += step, row++) {
        for (let x = step / 2 + (o.kind === 'halftone' && row % 2 ? step / 2 : 0); x < w + step; x += step) {
          let rad = (step / 2) * (0.25 + o.density * 0.7);
          if (o.kind === 'halftone') rad *= 0.3 + 0.7 * ((x / w + y / h) / 2);
          ctx.globalAlpha = Math.max(0.05, inten);
          ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
        }
      }
      break;
    }
    case 'grid': {
      ctx.globalAlpha = Math.max(0.05, inten);
      ctx.lineWidth = Math.max(0.5, scale * 0.03 * (0.5 + o.density * 2));
      for (let x = 0; x <= w; x += scale) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y <= h; y += scale) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      break;
    }
    case 'stripes': {
      ctx.globalAlpha = Math.max(0.05, inten);
      const sw = scale * (0.2 + o.density * 0.6);
      for (let x = -h; x < w + h; x += scale) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + sw, 0); ctx.lineTo(x + sw + h, h); ctx.lineTo(x + h, h); ctx.closePath(); ctx.fill();
      }
      break;
    }
    case 'crosshatch': {
      ctx.globalAlpha = Math.max(0.05, inten);
      ctx.lineWidth = Math.max(0.5, scale * 0.04);
      for (let x = -h; x < w + h; x += scale) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + h, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + h, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      break;
    }
    case 'checker': {
      ctx.globalAlpha = Math.max(0.05, inten);
      for (let y = 0, j = 0; y < h; y += scale, j++) for (let x = 0, i = 0; x < w; x += scale, i++) if ((i + j) % 2 === 0) ctx.fillRect(x, y, scale, scale);
      break;
    }
    case 'waves': {
      ctx.globalAlpha = Math.max(0.05, inten);
      ctx.lineWidth = Math.max(0.6, scale * 0.06);
      const amp = scale * (0.15 + o.density * 0.5);
      for (let y = 0; y < h + scale; y += scale) {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 4) {
          const yy = y + Math.sin((x / scale) * Math.PI * 2 + (o.wave || 0)) * amp;
          if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      break;
    }
    default: {
      for (let i = 0; i < 200; i++) ctx.fillRect(r() * w, r() * h, 1, 1);
    }
  }
  ctx.globalAlpha = 1;
}
