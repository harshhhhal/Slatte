/**
 * Procedural brush presets. Each preset draws "dabs" onto a stroke canvas; the
 * painting tool composites that stroke canvas onto the layer with the stroke
 * opacity, so overlapping dabs never exceed the chosen opacity.
 *
 * Presets are plain data ({ id, name, spacing, ... }) plus a dab function, so
 * future user-defined brushes can be stored as versioned preset objects.
 */

export const BRUSH_PRESET_VERSION = 1;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BRUSH_PRESETS = [
  {
    id: 'hard', name: 'Hard round', spacing: 0.1, pressureSize: true,
    dab(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); },
  },
  {
    id: 'soft', name: 'Soft round', spacing: 0.08, pressureSize: true,
    dab(ctx, x, y, r, c) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(c, 0.55));
      g.addColorStop(0.55, rgba(c, 0.25));
      g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c;
    },
  },
  {
    id: 'pencil', name: 'Pencil', spacing: 0.12, pressureSize: false, sizeScale: 0.45,
    dab(ctx, x, y, r, c, rand) {
      const n = Math.max(6, Math.round(r * 2.2));
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * r;
        ctx.globalAlpha = 0.35 + rand() * 0.55;
        ctx.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, 1.1, 1.1);
      }
      ctx.globalAlpha = 1;
    },
  },
  {
    id: 'ink', name: 'Ink', spacing: 0.05, pressureSize: true, speedTaper: true,
    dab(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); },
  },
  {
    id: 'marker', name: 'Marker', spacing: 0.12, pressureSize: false,
    dab(ctx, x, y, r) {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(Math.PI / 4);
      ctx.fillRect(-r * 0.35, -r, r * 0.7, r * 2);
      ctx.restore();
    },
  },
  {
    id: 'grain', name: 'Grain', spacing: 0.2, pressureSize: true,
    dab(ctx, x, y, r, c, rand) {
      const n = Math.max(10, Math.round(r * r * 0.35));
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * r;
        const s = 0.8 + rand() * 1.6;
        ctx.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, s, s);
      }
    },
  },
  {
    id: 'dry', name: 'Dry brush', spacing: 0.18, pressureSize: true,
    dab(ctx, x, y, r, c, rand) {
      const bristles = Math.max(6, Math.round(r * 0.9));
      for (let i = 0; i < bristles; i++) {
        const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * r;
        ctx.globalAlpha = 0.25 + rand() * 0.6;
        ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.6 + rand() * Math.max(0.8, r * 0.08), 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  },
  {
    id: 'halftone', name: 'Halftone stamp', spacing: 0.25, pressureSize: true,
    dab(ctx, x, y, r) {
      const cell = Math.max(4, r * 0.55);
      const x0 = Math.floor((x - r) / cell) * cell, y0 = Math.floor((y - r) / cell) * cell;
      for (let gy = y0; gy <= y + r; gy += cell) {
        for (let gx = x0 + (Math.round(gy / cell) % 2 ? cell / 2 : 0); gx <= x + r; gx += cell) {
          const d = Math.hypot(gx - x, gy - y);
          if (d > r) continue;
          const dotR = cell * 0.46 * (1 - (d / r) * 0.75);
          ctx.beginPath(); ctx.arc(gx, gy, dotR, 0, Math.PI * 2); ctx.fill();
        }
      }
    },
  },
];

export const BRUSH_BY_ID = Object.fromEntries(BRUSH_PRESETS.map((p) => [p.id, p]));

function rgba(hex, a) {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

/** Draws a stroke into a stroke canvas, producing dirty rectangles for compositing. */
export class StrokePainter {
  constructor(strokeCtx, opts) {
    this.ctx = strokeCtx;
    this.preset = BRUSH_BY_ID[opts.preset] || BRUSH_PRESETS[0];
    this.size = opts.size;
    this.color = opts.eraser ? '#000000' : opts.color;
    this.smoothing = opts.smoothing;
    this.rand = mulberry((Math.random() * 1e9) | 0);
    this.last = null;
    this.smooth = null;
    this.carry = 0;
    this.lastTime = 0;
    this.pxScale = opts.pxScale || 1;
    strokeCtx.fillStyle = this.color;
    strokeCtx.strokeStyle = this.color;
  }

  radiusFor(pressure, speed) {
    let size = this.size * (this.preset.sizeScale || 1) * this.pxScale;
    if (this.preset.pressureSize && pressure != null) size *= 0.35 + 0.65 * pressure;
    if (this.preset.speedTaper) size *= Math.max(0.45, 1 - Math.min(1, speed / 2200));
    return Math.max(0.5, size / 2);
  }

  /** Adds a point (canvas pixels). Returns the dirty rect or null. */
  add(x, y, pressure, time = performance.now()) {
    if (!this.smooth) {
      this.smooth = { x, y };
      this.last = { x, y, r: this.radiusFor(pressure, 0), p: pressure };
      this.lastTime = time;
      this.preset.dab(this.ctx, x, y, this.last.r, this.color, this.rand);
      return this._rect(x, y, x, y, this.last.r);
    }
    const k = 1 - Math.min(0.92, this.smoothing * 0.9);
    this.smooth = { x: this.smooth.x + (x - this.smooth.x) * k, y: this.smooth.y + (y - this.smooth.y) * k };
    return this._to(this.smooth.x, this.smooth.y, pressure, time);
  }

  /** Finishes the stroke so it reaches the final pointer position. */
  end(x, y, pressure, time = performance.now()) {
    if (!this.smooth || this.smoothing === 0) return null;
    return this._to(x, y, pressure, time);
  }

  _to(x, y, pressure, time) {
    const a = this.last;
    const dx = x - a.x, dy = y - a.y;
    const dist = Math.hypot(dx, dy);
    const dt = Math.max(1, time - this.lastTime);
    const speed = (dist / dt) * 1000;
    const r1 = this.radiusFor(pressure, speed);
    if (dist < 0.01) return null;
    const spacing = Math.max(0.6, (this.preset.spacing * Math.max(a.r, r1)) * 2);
    let travelled = this.carry;
    let minX = Math.min(a.x, x), minY = Math.min(a.y, y), maxX = Math.max(a.x, x), maxY = Math.max(a.y, y);
    while (travelled + spacing <= dist) {
      travelled += spacing;
      const t = travelled / dist;
      const r = a.r + (r1 - a.r) * t;
      this.preset.dab(this.ctx, a.x + dx * t, a.y + dy * t, r, this.color, this.rand);
    }
    this.carry = travelled - dist;
    if (this.carry < 0) this.carry = Math.max(0, spacing + this.carry);
    this.last = { x, y, r: r1, p: pressure };
    this.lastTime = time;
    return this._rect(minX, minY, maxX, maxY, Math.max(a.r, r1));
  }

  _rect(x0, y0, x1, y1, r) {
    const pad = r + 2;
    return { x: Math.floor(x0 - pad), y: Math.floor(y0 - pad), w: Math.ceil(x1 - x0 + pad * 2), h: Math.ceil(y1 - y0 + pad * 2) };
  }
}

/** Draws a preview swatch of a preset onto a small canvas. */
export function drawPresetPreview(canvas, preset, color = '#18181b') {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const w = canvas.width, h = canvas.height;
  const p = new StrokePainter(ctx, { preset: preset.id, size: Math.min(h * 0.55, 18), color, smoothing: 0, pxScale: 1 });
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    p.add(8 + t * (w - 16), h / 2 + Math.sin(t * Math.PI * 2) * h * 0.22, 0.4 + Math.sin(t * Math.PI) * 0.6, i * 16);
  }
}
