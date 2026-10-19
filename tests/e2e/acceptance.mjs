/**
 * End-to-end acceptance run against a built app (npm run build && npm run preview).
 *   BASE_URL=http://localhost:4173 node tests/e2e/acceptance.mjs
 * Needs Playwright (npm i -D playwright) and a Chromium build.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright/index.mjs')); }

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'slatte-e2e-'));
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|ERR_INTERNET|Failed to load resource|net::/.test(m.text())) errors.push(m.text()); });

const state = () => page.evaluate(() => { const e = window.__slatte.app.editor; return { n: e.page.objects.length, types: e.page.objects.map((o) => o.type), sel: e.selection.slice(), tool: e.toolId, pages: e.doc.pages.length, doc: e.doc.name }; });
const evalEd = (fn, arg) => page.evaluate(`(${fn.toString()})(window.__slatte.app.editor, ${JSON.stringify(arg ?? null)})`);
const stageBox = () => page.locator('.stage').boundingBox();
const at = async (fx, fy) => { const b = await stageBox(); return [b.x + b.width * fx, b.y + b.height * fy]; };
const drag = async (a, b) => { const [x1, y1] = await at(...a), [x2, y2] = await at(...b); await page.mouse.move(x1, y1); await page.mouse.down(); await page.mouse.move(x2, y2, { steps: 6 }); await page.mouse.up(); };
const download = async (trigger) => { const [d] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), trigger()]); const p = path.join(OUT, d.suggestedFilename()); await d.saveAs(p); return p; };

// AT-001 landing, create project
await page.goto(BASE + '/');
check('AT-001 landing renders hero and CTA', await page.locator('h1').first().innerText() === 'A clean space to make things.');
await page.click('button:has-text("New design")');
await page.waitForURL(/\/editor\/[0-9a-f-]{36}/);
await page.waitForSelector('.stage');
const projectUrl = page.url();
check('AT-002 editor opens at /editor/:uuid', /\/editor\/[0-9a-f-]{36}$/.test(projectUrl));

// shapes
await page.keyboard.press('r'); await drag([0.3, 0.2], [0.45, 0.35]);
await page.keyboard.press('o'); await drag([0.55, 0.2], [0.7, 0.35]);
let s = await state();
check('AT-003 rectangle and ellipse can be drawn', s.types.join() === 'rectangle,ellipse');

// pen
await page.keyboard.press('p');
for (const f of [[0.3, 0.55], [0.45, 0.55], [0.38, 0.7]]) { const [x, y] = await at(...f); await page.mouse.click(x, y); }
{ const [x, y] = await at(0.3, 0.55); await page.mouse.click(x, y); }
await page.keyboard.press('Enter');
s = await state();
check('AT-004 pen tool creates a path', s.types.includes('path'));

// text
await page.keyboard.press('t'); { const [x, y] = await at(0.6, 0.65); await page.mouse.click(x, y); }
await page.keyboard.type('Hello Slatte'); await page.keyboard.press('Escape');
const txt = await evalEd((e) => e.page.objects.find((o) => o.type === 'text')?.text);
check('AT-005 text can be added and edited', txt === 'Hello Slatte', txt);

// brush
await page.keyboard.press('b'); await drag([0.2, 0.85], [0.5, 0.9]); await page.waitForTimeout(300);
s = await state();
check('AT-006 brush paints onto a raster layer', s.types.includes('rasterLayer'));
const hasPaint = await evalEd((e) => { const l = e.page.objects.find((o) => o.type === 'rasterLayer'); return !!(l && l.assetId); });
check('AT-006b painted stroke is committed as an asset', hasPaint);

// select, blend mode, undo/redo
await page.keyboard.press('v'); { const [x, y] = await at(0.37, 0.27); await page.mouse.click(x, y); }
await evalEd((e) => e.setProp('blendMode', 'multiply'));
check('AT-007 blend mode applies', await evalEd((e) => e.selectedObjects()[0].blendMode) === 'multiply');
await page.waitForTimeout(150);
const svgHasBlend = await page.evaluate(() => /mix-blend-mode:\s*multiply/.test(document.querySelector('.page-svg').innerHTML));
check('AT-007b blend mode is rendered', svgHasBlend);
await page.keyboard.press('Control+z');
check('AT-008 undo reverts blend', await evalEd((e) => e.page.objects.find((o) => o.type === 'rectangle').blendMode) !== 'multiply');
await page.keyboard.press('Control+Shift+z');
check('AT-008b redo reapplies blend', await evalEd((e) => e.page.objects.find((o) => o.type === 'rectangle').blendMode) === 'multiply');

// group / align
await page.keyboard.press('Control+a'); await page.keyboard.press('Control+g');
check('AT-009 group works', (await evalEd((e) => e.page.objects.filter((o) => o.type === 'group').length)) === 1);
await page.keyboard.press('Control+Shift+g');
check('AT-009b ungroup works', (await evalEd((e) => e.page.objects.filter((o) => o.type === 'group').length)) === 0);

// pages
await page.keyboard.press('Escape');
await evalEd((e) => e.addPage({ name: 'Second', width: 800, height: 600 }));
check('AT-010 multiple pages', (await state()).pages === 2);
await evalEd((e) => e.setActivePage(e.doc.pages[0].id));

// theme
await page.click('button[aria-label="Toggle light and dark theme"]');
check('AT-011 theme toggles', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
await page.click('button[aria-label="Toggle light and dark theme"]');

// rename + autosave + reload
await page.fill('.project-name', 'Acceptance run'); await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__slatte.autosave.status === 'saved', null, { timeout: 8000 });
await page.reload(); await page.waitForSelector('.stage');
s = await state();
check('AT-012 refresh reloads the project from IndexedDB', s.n >= 5 && s.doc === 'Acceptance run', JSON.stringify({ n: s.n, doc: s.doc }));

// exports
const exportAs = async (fmt) => {
  await page.click('.export-btn');
  await page.click(`.fmt[data-fmt="${fmt}"]`);
  const f = await download(async () => { await page.click('dialog button:has-text("Export")'); });
  await page.waitForTimeout(300);
  if (await page.locator('dialog[open]').count()) { await page.keyboard.press('Escape'); }
  await page.waitForSelector('dialog', { state: 'detached', timeout: 5000 });
  return f;
};
const png = await exportAs('png');
const pngBytes = fs.readFileSync(png);
check('AT-013 PNG export is a valid PNG', pngBytes.slice(1, 4).toString() === 'PNG' && pngBytes.length > 2000, `${pngBytes.length} bytes`);
const svg = fs.readFileSync(await exportAs('svg'), 'utf8');
check('AT-014 SVG export is well-formed and has content', svg.startsWith('<svg') || svg.includes('<svg'), `${svg.length} chars`);
const pdf = fs.readFileSync(await exportAs('pdf'));
check('AT-015 PDF export has a PDF header', pdf.slice(0, 5).toString() === '%PDF-');
const jpg = fs.readFileSync(await exportAs('jpeg'));
check('AT-015b JPEG export has JPEG magic', jpg[0] === 0xff && jpg[1] === 0xd8);
const sltPath = await exportAs('slt');
check('AT-016 .slt export is a zip', fs.readFileSync(sltPath).slice(0, 2).toString() === 'PK');

// import .slt as new project
await page.goto(BASE + '/');
await page.waitForSelector('.project-card');
const before = await page.locator('.project-card').count();
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('button:has-text("Open .slt file")')]);
await chooser.setFiles(sltPath);
await page.waitForURL(/\/editor\//, { timeout: 15000 });
await page.waitForSelector('.stage');
s = await state();
check('AT-016b .slt round-trips into a new project', s.n >= 5 && page.url() !== projectUrl, `n=${s.n}`);
const paintOk = await evalEd((e) => { const l = e.page.objects.find((o) => o.type === 'rasterLayer'); return !!(l && e.assets.has(l.assetId)); });
check('AT-016c embedded paint asset survives round-trip', paintOk);

// malformed import
const bad = path.join(OUT, 'bad.slt'); fs.writeFileSync(bad, 'not a zip');
await page.goto(BASE + '/');
const [c2] = await Promise.all([page.waitForEvent('filechooser'), page.click('button:has-text("Open .slt file")')]);
await c2.setFiles(bad);
await page.waitForSelector('.toast-error', { timeout: 5000 });
check('AT-017 malformed .slt shows a friendly error', /valid Slatte project/i.test(await page.locator('.toast-error').first().innerText()));
check('AT-017b app still usable after bad import', (await page.locator('.project-card').count()) >= before);

// routing
await page.goto(BASE + '/editor/00000000-0000-4000-8000-000000000000');
await page.waitForSelector('.notfound');
check('AT-018 unknown project id shows not-found state', /not found/i.test(await page.locator('.notfound h1').innerText()));
await page.goto(BASE + '/no/such/page');
await page.waitForSelector('.notfound');
check('AT-018b unknown route shows not-found state', true);

// responsive
await page.setViewportSize({ width: 390, height: 800 });
await page.goto(projectUrl);
await page.waitForSelector('.stage');
check('AT-019 mobile layout has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await page.screenshot({ path: path.join(OUT, 'mobile.png') });

check('no uncaught errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed. Artifacts: ${OUT}`);
process.exit(failed.length ? 1 : 0);
