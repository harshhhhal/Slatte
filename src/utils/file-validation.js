import { UserError } from './errors.js';

export const LIMITS = {
  image: 40 * 1024 * 1024,
  svg: 8 * 1024 * 1024,
  font: 20 * 1024 * 1024,
  project: 300 * 1024 * 1024,
  projectUncompressed: 600 * 1024 * 1024,
};

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];
const FONT_EXT = ['ttf', 'otf', 'woff', 'woff2'];

export function extOf(name = '') {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

/** Classifies a File as 'slt' | 'image' | 'svg' | 'font' | 'unknown'. */
export function classifyFile(file) {
  const ext = extOf(file.name);
  const type = (file.type || '').toLowerCase();
  if (ext === 'slt') return 'slt';
  if (ext === 'svg' || type === 'image/svg+xml') return 'svg';
  if (IMAGE_EXT.includes(ext) || /^image\/(png|jpe?g|webp|gif|bmp)$/.test(type)) return 'image';
  if (FONT_EXT.includes(ext) || /^(font\/|application\/font)/.test(type)) return 'font';
  return 'unknown';
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Throws a UserError describing why the file cannot be used. */
export function validateFile(file, expected) {
  const kind = classifyFile(file);
  if (kind === 'unknown') {
    throw new UserError(
      `“${file.name}” isn’t a supported file type.`,
      'Use PNG, JPG, WebP, GIF, BMP, SVG, TTF/OTF/WOFF/WOFF2 or a .slt project.',
    );
  }
  if (expected && kind !== expected) {
    throw new UserError(`“${file.name}” is a ${kind.toUpperCase()} file, but a ${expected.toUpperCase()} file was expected.`);
  }
  const limit = kind === 'slt' ? LIMITS.project : LIMITS[kind];
  if (file.size > limit) {
    throw new UserError(
      `“${file.name}” is too large (${formatBytes(file.size)}).`,
      `The limit for this type is ${formatBytes(limit)}.`,
    );
  }
  if (file.size === 0) throw new UserError(`“${file.name}” is empty.`);
  return kind;
}

export function safeFileName(name, fallback = 'untitled') {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

/** Rejects ZIP entry names that could escape their folder. */
export function isSafeArchivePath(path) {
  if (typeof path !== 'string' || !path) return false;
  if (path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path)) return false;
  return !path.split('/').some((seg) => seg === '..' || seg === '.');
}

export const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  bmp: 'image/bmp', svg: 'image/svg+xml', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
};

export const EXT_BY_MIME = Object.fromEntries(Object.entries(MIME_BY_EXT).map(([k, v]) => [v, k]));
EXT_BY_MIME['image/jpeg'] = 'jpg';
