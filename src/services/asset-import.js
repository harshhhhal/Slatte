import { createObject, solid, uniqueName } from '../core/document-model.js';
import { classifyFile, validateFile } from '../utils/file-validation.js';
import { describeError, UserError } from '../utils/errors.js';
import { fonts } from './font-service.js';
import { prepareImage } from './image-service.js';
import { importSvgText } from './svg-import.js';
import { fitText } from '../core/text-layout.js';
import { fetchIcon, localIconMarkup } from './icon-service.js';
import { fetchOpenverseImage } from './openverse-service.js';
import { sanitizeSvg } from '../utils/svg-sanitize.js';
import { unionRects, worldBounds } from '../utils/geometry.js';

import { moveBy, scaleObjects } from '../core/transform.js';

/** Places objects so that their union is centred at `at` and fits the page. */
function placeCentered(editor, objs, at, maxFrac = 0.6, growSmall = false) {
  const page = editor.page;
  const target = at || { x: page.width / 2, y: page.height / 2 };
  const b = unionRects(objs.map(worldBounds));
  if (!b) return;
  let k = Math.min(1, (page.width * maxFrac) / Math.max(1, b.width), (page.height * maxFrac) / Math.max(1, b.height));
  const side = Math.max(b.width, b.height, 1);
  const pageSide = Math.min(page.width, page.height);
  // tiny SVGs (e.g. a 24-unit icon) are enlarged so they're usable on arrival
  if (growSmall && side < pageSide * 0.1) k = (pageSide * 0.25) / side;
  // objects are not yet in the page: operate on a temp page-like holder
  const holder = { objects: objs };
  if (k !== 1) scaleObjects(holder, objs.map((o) => o.id), { x: b.x, y: b.y }, k, k);
  const nb = unionRects(objs.map(worldBounds));
  moveBy(holder, objs.map((o) => o.id), target.x - (nb.x + nb.width / 2), target.y - (nb.y + nb.height / 2));
}

export async function placeImageBlob(editor, blob, meta, at) {
  const id = editor.registerAsset(blob, { name: meta.name, kind: 'image', width: meta.width, height: meta.height, source: meta.source || null });
  const o = createObject('image', {
    name: (meta.name || 'Image').replace(/\.[^.]+$/, '').slice(0, 60) || 'Image',
    assetId: id, width: meta.width, height: meta.height, naturalWidth: meta.width, naturalHeight: meta.height,
  });
  placeCentered(editor, [o], at);
  editor.addObjects([o], { label: 'Add image' });
  return o;
}

export async function importImageFile(editor, file, at) {
  const prep = await prepareImage(file);
  const o = await placeImageBlob(editor, prep.blob, { name: prep.name, width: prep.width, height: prep.height }, at);
  return { object: o, note: prep.note };
}

export async function importSvgFile(editor, file, at) {
  validateFile(file, 'svg');
  const text = await file.text();
  const res = importSvgText(text, file.name);
  const objs = res.objects;
  for (const o of objs) o.name = uniqueName(editor.page, o.name);
  placeCentered(editor, objs, at, 0.5, true);
  if (objs.length > 1) {
    editor.addObjects(objs, { label: 'Import SVG', select: false });
    editor.select(objs.map((o) => o.id));
    editor.group();
  } else editor.addObjects(objs, { label: 'Import SVG' });
  return { warnings: res.warnings, mode: res.mode };
}

export async function importFontFile(editor, file) {
  validateFile(file, 'font');
  const family = await fonts.addLocal(file, editor.assets, editor.doc);
  editor.commit('Add font');
  return family;
}

/** Routes any dropped/picked files to the right importer. Returns messages for the UI. */
export async function importFiles(editor, files, at, { onProject } = {}) {
  const messages = [];
  for (const file of files) {
    try {
      const kind = validateFile(file);
      if (kind === 'slt') {
        if (onProject) await onProject(file); else throw new UserError('Open .slt projects from the home page or the menu.');
      } else if (kind === 'image') {
        const r = await importImageFile(editor, file, at);
        if (r.note) messages.push({ kind: 'info', message: r.note });
      } else if (kind === 'svg') {
        const r = await importSvgFile(editor, file, at);
        for (const w of r.warnings) messages.push({ kind: 'warning', message: w });
      } else if (kind === 'font') {
        const family = await importFontFile(editor, file);
        messages.push({ kind: 'success', message: `Font “${family}” added to this project.` });
      }
    } catch (err) {
      messages.push({ kind: 'error', message: describeError(err, `“${file.name}” couldn’t be imported.`) });
    }
  }
  return messages;
}

/** Inserts a downloaded Iconify icon. */
export async function insertRemoteIcon(editor, icon, at = null) {
  const { svg, viewBox } = await fetchIcon(icon.prefix, icon.name);
  const size = Math.min(editor.page.width, editor.page.height) * 0.18;
  const ar = viewBox[2] / viewBox[3];
  const o = createObject('icon', {
    name: icon.name, svg, viewBox, width: ar >= 1 ? size : size * ar, height: ar >= 1 ? size / ar : size,
    source: { provider: 'iconify', prefix: icon.prefix, name: icon.name, license: icon.license, author: icon.author, set: icon.set },
    fill: solid('#18181b'),
  });
  placeCentered(editor, [o], at);
  editor.addObjects([o], { label: 'Add icon' });
  return o;
}

export function insertLocalIcon(editor, name, at = null) {
  const size = Math.min(editor.page.width, editor.page.height) * 0.18;
  const o = createObject('icon', {
    name, svg: localIconMarkup(name), viewBox: [0, 0, 24, 24], width: size, height: size,
    source: { provider: 'slatte', name, license: 'Original to Slatte', author: 'Slatte' }, fill: solid('#18181b'),
  });
  placeCentered(editor, [o], at);
  editor.addObjects([o], { label: 'Add icon' });
  return o;
}

export async function insertOpenverseImage(editor, item, at = null) {
  const blob = await fetchOpenverseImage(item);
  const prep = await prepareImage(new File([blob], `${item.title.slice(0, 40) || 'openverse'}.${(blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`, { type: blob.type }));
  return placeImageBlob(editor, prep.blob, {
    name: item.title, width: prep.width, height: prep.height,
    source: { provider: 'openverse', id: item.id, title: item.title, creator: item.creator, creatorUrl: item.creatorUrl, license: item.license, licenseUrl: item.licenseUrl, landingUrl: item.landingUrl },
  }, at);
}

export function addTextObject(editor, { text = 'Add a heading', size = 96, weight = 700, family = 'Inter' } = {}) {
  const page = editor.page;
  const o = createObject('text', { text, fontSize: size, fontWeight: weight, fontFamily: family, name: 'Text' });
  fitText(o);
  o.x = (page.width - o.width) / 2; o.y = (page.height - o.height) / 2;
  editor.addObjects([o], { label: 'Add text' });
  fonts.load(family).then(() => { editor.change('Update text', (pg) => { const l = pg.objects.find((x) => x.id === o.id); if (l) fitText(l); }); });
  return o;
}

export { classifyFile, sanitizeSvg };
