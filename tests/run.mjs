// Unit tests for the pure (DOM-free) modules. Run: npm test
import assert from 'node:assert/strict';
import { createDocument, validateDocument, migrateDocument, snapshotContent, restoreContent, createObject, pathData, shapeToSubpaths, collectAssetIds, SCHEMA_VERSION, BLEND_MODES } from '../src/core/document-model.js';
import { History } from '../src/core/history.js';
import { Router } from '../src/core/router.js';
import { isSafeArchivePath, classifyFile, safeFileName, formatBytes } from '../src/utils/file-validation.js';
import { normalizeHex, hexToRgb, rgbToHex } from '../src/utils/color.js';
import { snapAngle, normalizeAngle, worldBounds, rotatePoint } from '../src/utils/geometry.js';
import { Emitter } from '../src/core/store.js';
import { UUID_RE } from '../src/utils/ids.js';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); } catch (e) { fail++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};

console.log('document model');
test('createDocument yields a valid document', () => {
  const { doc, warnings } = validateDocument(createDocument('X'));
  assert.equal(doc.pages.length, 1);
  assert.equal(doc.schemaVersion, SCHEMA_VERSION);
  assert.ok(Array.isArray(warnings));
});
test('16 blend modes are available', () => assert.equal(BLEND_MODES.length, 16));
test('validateDocument rejects non-objects', () => {
  assert.throws(() => validateDocument(null));
  assert.throws(() => validateDocument('x'));
  assert.throws(() => validateDocument({}));
});
test('validateDocument clamps hostile values and drops unknown types safely', () => {
  const d = createDocument('Bad');
  d.pages[0].objects.push({ id: 'a', type: 'rectangle', x: 'NaN', y: 1e99, width: -5, height: 10, opacity: 7 });
  d.pages[0].objects.push({ id: 'b', type: 'totally-unknown' });
  const { doc } = validateDocument(JSON.parse(JSON.stringify(d)));
  for (const o of doc.pages[0].objects) {
    for (const k of ['x', 'y', 'width', 'height']) assert.ok(Number.isFinite(o[k]), `${k} finite`);
    assert.ok(o.opacity <= 1 && o.opacity >= 0);
  }
});
test('snapshot/restore round-trips content', () => {
  const d = createDocument('S');
  d.pages[0].objects.push(createObject('rectangle', { width: 10, height: 10 }));
  const snap = snapshotContent(d);
  d.pages[0].objects.length = 0;
  restoreContent(d, snap);
  assert.equal(d.pages[0].objects.length, 1);
});
test('shape subpaths serialise to SVG path data', () => {
  const o = createObject('ellipse', { width: 100, height: 60 });
  const dstr = pathData(shapeToSubpaths(o));
  assert.match(dstr, /^M/);
  assert.match(dstr, /C/);
});
test('collectAssetIds finds images', () => {
  const d = createDocument('A');
  d.pages[0].objects.push(createObject('image', { assetId: 'a1', width: 1, height: 1 }));
  assert.ok(collectAssetIds(d).has('a1'));
});
test('migrateDocument rejects future schema versions', () => {
  assert.throws(() => migrateDocument({ schemaVersion: SCHEMA_VERSION + 5, pages: [] }));
});

console.log('history');
test('undo/redo walk snapshots', () => {
  const h = new History();
  h.reset('0');
  h.record('a', '1'); h.record('b', '2');
  assert.equal(h.undo().json, '1');
  assert.equal(h.undo().json, '0');
  assert.equal(h.canUndo, false);
  assert.equal(h.redo().json, '1');
});
test('same-key edits coalesce into one step', () => {
  const h = new History();
  h.reset('0');
  h.record('drag', '1', 'k'); h.record('drag', '2', 'k'); h.record('drag', '3', 'k');
  assert.equal(h.undo().json, '0');
  assert.equal(h.canUndo, false);
});
test('recording after undo drops the redo branch', () => {
  const h = new History();
  h.reset('0'); h.record('a', '1'); h.undo(); h.record('b', 'x');
  assert.equal(h.canRedo, false);
});

console.log('router');
test('matches static and parametrised routes', () => {
  const r = new Router([{ path: '/' }, { path: '/editor/:projectId' }, { path: '/templates' }], { replaceChildren() {} }, null);
  assert.equal(r.match('/').route.path, '/');
  assert.equal(r.match('/templates').route.path, '/templates');
  assert.equal(r.match('/editor/abc').params.projectId, 'abc');
  assert.equal(r.match('/editor'), null);
  assert.equal(r.match('/nope/x'), null);
});
test('UUID validation', () => {
  assert.ok(UUID_RE.test('3230efb6-7f72-4121-a768-7a8f335daedd'));
  assert.ok(!UUID_RE.test('../../etc/passwd'));
});

console.log('files & archives');
test('rejects traversal and absolute archive paths', () => {
  for (const p of ['../x', 'a/../../x', '/abs', 'C:\\x', 'a\\b', 'assets/../../x', '']) assert.equal(isSafeArchivePath(p), false, p);
  for (const p of ['manifest.json', 'assets/a1.png', 'fonts/f.woff2']) assert.equal(isSafeArchivePath(p), true, p);
});
test('classifies files by type', () => {
  assert.equal(classifyFile({ name: 'a.PNG', type: '' }), 'image');
  assert.equal(classifyFile({ name: 'a.svg', type: 'image/svg+xml' }), 'svg');
  assert.equal(classifyFile({ name: 'a.woff2', type: '' }), 'font');
  assert.equal(classifyFile({ name: 'p.slt', type: '' }), 'slt');
  assert.equal(classifyFile({ name: 'x.exe', type: '' }), 'unknown');
});
test('safeFileName strips unsafe characters', () => {
  assert.ok(!/[\\/:*?"<>|]/.test(safeFileName('a/b:c*?.png')));
  assert.ok(safeFileName('').length > 0);
});
test('formatBytes', () => assert.match(formatBytes(1536), /1\.5/));

console.log('colour & geometry');
test('hex normalisation', () => {
  assert.equal(normalizeHex('#abc'), '#aabbcc');
  assert.equal(normalizeHex('ff0000'), '#ff0000');
  assert.equal(normalizeHex('nope', null), null);
});
test('hex/rgb round trip', () => assert.equal(rgbToHex(...Object.values(hexToRgb('#12ab34'))), '#12ab34'));
test('angle helpers', () => {
  assert.equal(snapAngle(44, 15), 45);
  assert.equal(normalizeAngle(370), 10);
});
test('rotated bounds are larger than the box', () => {
  const b = worldBounds({ x: 0, y: 0, width: 100, height: 100, rotation: 45 });
  assert.ok(b.width > 140 && b.width < 142);
});
test('rotatePoint rotates 90°', () => {
  const p = rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, 90);
  assert.ok(Math.abs(p.x) < 1e-9 && Math.abs(p.y - 1) < 1e-9);
});
test('emitter isolates handler errors', () => {
  const e = new Emitter(); let ok = false;
  const orig = console.error; console.error = () => {};
  e.on('x', () => { throw new Error('boom'); }); e.on('x', () => { ok = true; });
  e.emit('x'); console.error = orig;
  assert.ok(ok);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
