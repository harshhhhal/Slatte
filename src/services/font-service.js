import { Emitter } from '../core/store.js';
import { invalidateTextCache } from '../core/text-layout.js';
import { UserError } from '../utils/errors.js';
import { blobToDataUrl } from './asset-store.js';
import { shortId } from '../utils/ids.js';

/**
 * Curated Google Fonts (loaded on demand through the official CSS API) plus
 * system fallbacks. Weights listed are static weights each family really ships.
 */
const G = (family, category, weights, italic = false) => ({ family, category, weights, italic, source: 'google' });

export const GOOGLE_FONTS = [
  G('Inter', 'sans-serif', [400, 500, 600, 700, 800]),
  G('Poppins', 'sans-serif', [300, 400, 500, 600, 700, 800], true),
  G('Montserrat', 'sans-serif', [300, 400, 500, 600, 700, 800], true),
  G('Roboto', 'sans-serif', [300, 400, 500, 700, 900], true),
  G('Open Sans', 'sans-serif', [300, 400, 600, 700, 800], true),
  G('Lato', 'sans-serif', [300, 400, 700, 900], true),
  G('Work Sans', 'sans-serif', [300, 400, 500, 600, 700, 800], true),
  G('DM Sans', 'sans-serif', [400, 500, 700], true),
  G('Manrope', 'sans-serif', [300, 400, 500, 600, 700, 800]),
  G('Space Grotesk', 'sans-serif', [300, 400, 500, 600, 700]),
  G('Outfit', 'sans-serif', [300, 400, 500, 600, 700, 800]),
  G('Plus Jakarta Sans', 'sans-serif', [300, 400, 500, 600, 700, 800], true),
  G('Nunito', 'sans-serif', [300, 400, 600, 700, 800], true),
  G('Raleway', 'sans-serif', [300, 400, 500, 600, 700, 800], true),
  G('Rubik', 'sans-serif', [300, 400, 500, 600, 700, 800], true),
  G('Karla', 'sans-serif', [300, 400, 500, 600, 700, 800], true),
  G('IBM Plex Sans', 'sans-serif', [300, 400, 500, 600, 700], true),
  G('Archivo', 'sans-serif', [300, 400, 500, 600, 700, 800], true),
  G('Barlow', 'sans-serif', [300, 400, 500, 600, 700, 800], true),
  G('Oswald', 'sans-serif', [300, 400, 500, 600, 700]),
  G('Playfair Display', 'serif', [400, 500, 600, 700, 800], true),
  G('Merriweather', 'serif', [300, 400, 700, 900], true),
  G('Lora', 'serif', [400, 500, 600, 700], true),
  G('Cormorant Garamond', 'serif', [300, 400, 500, 600, 700], true),
  G('DM Serif Display', 'serif', [400], true),
  G('Libre Baskerville', 'serif', [400, 700], true),
  G('EB Garamond', 'serif', [400, 500, 600, 700, 800], true),
  G('Source Serif 4', 'serif', [300, 400, 600, 700, 900], true),
  G('Fraunces', 'serif', [300, 400, 600, 700, 900], true),
  G('JetBrains Mono', 'monospace', [300, 400, 500, 700, 800], true),
  G('IBM Plex Mono', 'monospace', [300, 400, 500, 600, 700], true),
  G('Space Mono', 'monospace', [400, 700], true),
  G('Fira Code', 'monospace', [300, 400, 500, 600, 700]),
  G('Bebas Neue', 'display', [400]),
  G('Anton', 'display', [400]),
  G('Abril Fatface', 'display', [400]),
  G('Righteous', 'display', [400]),
  G('Pacifico', 'handwriting', [400]),
  G('Lobster', 'handwriting', [400]),
  G('Caveat', 'handwriting', [400, 500, 600, 700]),
  G('Dancing Script', 'handwriting', [400, 500, 600, 700]),
  G('Permanent Marker', 'handwriting', [400]),
];

export const SYSTEM_FONTS = [
  { family: 'Arial', category: 'sans-serif', weights: [400, 700], italic: true, source: 'system' },
  { family: 'Georgia', category: 'serif', weights: [400, 700], italic: true, source: 'system' },
  { family: 'Times New Roman', category: 'serif', weights: [400, 700], italic: true, source: 'system' },
  { family: 'Courier New', category: 'monospace', weights: [400, 700], italic: true, source: 'system' },
  { family: 'Verdana', category: 'sans-serif', weights: [400, 700], italic: true, source: 'system' },
];

const TIMEOUT_MS = 7000;

class FontService extends Emitter {
  constructor() {
    super();
    /** family → 'loading' | 'loaded' | 'failed' */
    this.status = new Map();
    this.local = new Map(); // family → { id, assetId, face }
    this.embedCache = new Map();
  }

  catalog(localFonts = []) {
    const loc = localFonts.map((f) => ({ family: f.family, category: 'uploaded', weights: [400, 700], italic: true, source: 'local' }));
    return [...loc, ...GOOGLE_FONTS, ...SYSTEM_FONTS];
  }

  info(family, localFonts = []) {
    return this.catalog(localFonts).find((f) => f.family === family) || null;
  }

  stateOf(family) {
    const f = this.info(family, [...this.local.keys()].map((k) => ({ family: k })));
    if (!f || f.source === 'system') return 'loaded';
    return this.status.get(family) || 'idle';
  }

  /** Loads a Google font family on demand. Resolves with the final status. */
  async load(family, weights, italic = true) {
    const meta = GOOGLE_FONTS.find((f) => f.family === family);
    if (!meta) return 'loaded';
    if (this.status.get(family) === 'loaded') return 'loaded';
    if (this.status.get(family) === 'loading') return this._pending.get(family);
    this.status.set(family, 'loading');
    this.emit('status', { family, status: 'loading' });
    this._pending ||= new Map();
    const p = this._loadGoogle(meta, weights, italic);
    this._pending.set(family, p);
    const s = await p;
    this._pending.delete(family);
    return s;
  }

  async _loadGoogle(meta, _weights, italic) {
    const ws = meta.weights;
    const fam = encodeURIComponent(meta.family).replace(/%20/g, '+');
    let spec;
    if (meta.italic && italic) {
      const combos = [];
      for (const i of [0, 1]) for (const w of ws) combos.push(`${i},${w}`);
      spec = `${fam}:ital,wght@${combos.join(';')}`;
    } else if (ws.length > 1 || ws[0] !== 400) spec = `${fam}:wght@${ws.join(';')}`;
    else spec = fam;
    const href = `https://fonts.googleapis.com/css2?family=${spec}&display=swap`;
    let status = 'failed';
    try {
      await new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.slatteFont = meta.family;
        link.onload = resolve;
        link.onerror = () => { link.remove(); reject(new Error('stylesheet')); };
        document.head.append(link);
        setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
      });
      await Promise.race([
        Promise.all([document.fonts.load(`400 16px "${meta.family}"`), document.fonts.load(`700 16px "${meta.family}"`)]),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
      ]);
      status = document.fonts.check(`16px "${meta.family}"`) ? 'loaded' : 'failed';
    } catch {
      status = 'failed';
    }
    this.status.set(meta.family, status);
    if (status === 'loaded') invalidateTextCache();
    this.emit('status', { family: meta.family, status });
    return status;
  }

  /** Registers an uploaded font file for use in the current project. */
  async addLocal(file, assets, doc) {
    const family = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/["'<>;{}]/g, '').trim().slice(0, 60) || 'Custom font';
    const buf = await file.arrayBuffer();
    const face = new FontFace(family, buf);
    try {
      await face.load();
    } catch {
      throw new UserError(`“${file.name}” couldn’t be read as a font.`, 'Try a different TTF, OTF, WOFF or WOFF2 file.');
    }
    document.fonts.add(face);
    const ext = (file.name.split('.').pop() || 'ttf').toLowerCase();
    const mime = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' }[ext] || 'font/ttf';
    const blob = new Blob([buf], { type: mime });
    const assetId = assets.add(blob);
    doc.assets[assetId] = { id: assetId, name: file.name, mime, kind: 'font', size: blob.size, width: 0, height: 0, source: null };
    const existing = doc.fonts.find((f) => f.family === family);
    if (existing) { existing.assetId = assetId; } else {
      doc.fonts.push({ id: shortId('f'), family, source: 'local', assetId, weights: [400], category: 'uploaded', license: 'Uploaded by you' });
    }
    this.local.set(family, { assetId, face });
    this.status.set(family, 'loaded');
    invalidateTextCache();
    this.emit('status', { family, status: 'loaded' });
    return family;
  }

  /** Makes every font used by a document available (called when a project opens). */
  async prepareDocument(doc, assets) {
    const jobs = [];
    for (const f of doc.fonts) {
      if (f.source === 'local' && f.assetId && assets.has(f.assetId) && !this.local.has(f.family)) {
        jobs.push((async () => {
          try {
            const face = new FontFace(f.family, await assets.get(f.assetId).arrayBuffer());
            await face.load();
            document.fonts.add(face);
            this.local.set(f.family, { assetId: f.assetId, face });
            this.status.set(f.family, 'loaded');
          } catch {
            this.status.set(f.family, 'failed');
          }
        })());
      }
    }
    const used = new Set();
    for (const p of doc.pages) for (const o of p.objects) if (o.type === 'text') used.add(o.fontFamily);
    for (const fam of used) if (GOOGLE_FONTS.some((g) => g.family === fam)) jobs.push(this.load(fam));
    await Promise.allSettled(jobs);
    invalidateTextCache();
  }

  /**
   * Builds @font-face CSS with embedded data URLs so exported SVG/PNG/PDF keep
   * their typography. Best effort: returns { css, missing[] }.
   */
  async embedCss(families, doc, assets) {
    const css = [];
    const missing = [];
    for (const fam of families) {
      const local = doc.fonts.find((f) => f.family === fam && f.assetId && assets.has(f.assetId));
      if (local) {
        const url = await blobToDataUrl(assets.get(local.assetId));
        css.push(`@font-face{font-family:"${fam}";src:url(${url});font-weight:100 900;font-style:normal normal;}`);
        continue;
      }
      const meta = GOOGLE_FONTS.find((f) => f.family === fam);
      if (!meta) continue;
      try {
        css.push(await this._embedGoogle(meta));
      } catch {
        missing.push(fam);
      }
    }
    return { css: css.join('\n'), missing };
  }

  async _embedGoogle(meta) {
    if (this.embedCache.has(meta.family)) return this.embedCache.get(meta.family);
    const fam = encodeURIComponent(meta.family).replace(/%20/g, '+');
    const combos = [];
    for (const i of meta.italic ? [0, 1] : [0]) for (const w of meta.weights) combos.push(meta.italic ? `${i},${w}` : `${w}`);
    const spec = meta.italic ? `${fam}:ital,wght@${combos.join(';')}` : `${fam}:wght@${combos.join(';')}`;
    const res = await fetch(`https://fonts.googleapis.com/css2?family=${spec}&display=swap`);
    if (!res.ok) throw new Error('css');
    let text = await res.text();
    // Embed only latin subsets to keep exports compact: drop faces whose unicode-range is not latin.
    const blocks = text.split('@font-face').slice(1).map((b) => '@font-face' + b);
    const keep = blocks.filter((b) => /unicode-range:[^;]*U\+0000-00FF/i.test(b) || !/unicode-range/i.test(b));
    text = keep.join('\n');
    const need = [...new Set([...text.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
    for (const u of need) {
      const r = await fetch(u);
      if (!r.ok) throw new Error('font');
      const data = await blobToDataUrl(await r.blob());
      text = text.split(u).join(data);
    }
    this.embedCache.set(meta.family, text);
    return text;
  }
}

export const fonts = new FontService();
