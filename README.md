# Slatte — a clean space to make things

Slatte is a responsive, **local-first** graphic design editor that runs entirely in the browser. It is written in plain HTML5, CSS3 and vanilla JavaScript (ES modules), built with Vite. There is no React, Vue or Angular, and no server: projects live in your browser's IndexedDB and move between devices as `.slt` files.

```
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve dist/ at http://localhost:4173
npm test           # unit tests (pure modules)
npm run test:e2e   # browser acceptance run (needs Playwright + Chromium, and `npm run preview` running)
```

Requires Node 18+. The only runtime dependency is [`jszip`](https://stuk.github.io/jszip/) (for `.slt` files and multi-page exports).

## Deploying

`dist/` is a static site. Single-page-app rewrites are already configured:

- **Vercel**: `vercel.json` rewrites everything to `/index.html`.
- **Netlify / Cloudflare Pages**: `public/_redirects` (`/* /index.html 200`) is copied into `dist/`.
- Any other host: serve `index.html` for unknown paths.

Routes: `/` (landing and your projects), `/templates` (choose a size), `/editor/:projectId` (UUID). A project URL is **not** a share link: it only opens on the browser that holds the project. Use **Export → .slt** to move a project. Unknown routes and unknown/invalid project ids show a not-found page.

## What's in the box

See [`docs/FEATURES.md`](docs/FEATURES.md) for the full supported / partial / not-supported list, and [`docs/slt-format.md`](docs/slt-format.md) for the file format.

Highlights: select / direct-select / shape / pen (Bézier) / pencil / brush / eraser (8 procedural brushes, pen pressure) / text / image / gradient / eyedropper / frame tools; multi-page artboards; layers with groups, lock, hide, search and drag-reorder; 16 blend modes; solid, linear and radial fills and strokes; shadow, blur and outline effects; align, distribute, snapping, guides, rulers and grid; undo/redo with coalesced drags; autosave; export to PNG, JPEG, SVG, PDF and `.slt`; import of `.slt`, images, SVG (sanitised) and fonts.

Press `?` in the editor for the keyboard shortcut reference.

## Architecture

```
src/
  main.js                 router bootstrap
  pages/                  landing, templates, editor (assembly), not-found
  core/                   document model, Editor (selection, commands, history), renderer, router, shortcuts
  editor/                 Stage (viewport, input, overlay), tools/, panels/, brush engine, raster layers
  services/               IndexedDB storage, autosave, .slt import/export, rendering & export, fonts, icons, Openverse
  ui/, utils/             dialogs, menus, controls, validation, sanitiser, geometry
tests/                    unit tests and the e2e acceptance run
```

- **Document model** (`core/document-model.js`) is plain JSON, separate from the DOM. Every object stores absolute page coordinates. `validateDocument` clamps and normalises anything loaded from storage or a file, and `migrateDocument` upgrades older schema versions.
- **Rendering**: vectors are SVG, painted layers are Canvas 2D. The live stage and every exporter share one renderer (`core/renderer.js`), so exports match the canvas.
- **History** stores JSON snapshots of document content (assets are referenced by id only). Continuous edits (drags, sliders, nudges) share a key and coalesce into one undo step.
- **Persistence**: IndexedDB (`projects`, `meta`, `assets` stores) with debounced autosave. If IndexedDB is unavailable the app falls back to memory and warns you. The theme is the only thing in `localStorage` (plus panel sizes).

## External services

All optional; the editor works offline without them (curated system fonts, a built-in icon set, procedural textures).

| Service | Used for | When |
|---|---|---|
| `fonts.googleapis.com` / `fonts.gstatic.com` | Google Fonts CSS and font files | when a Google font is chosen or a project that uses one is opened |
| `api.iconify.design` | icon search and SVG download | only when you search or insert icons |
| `api.openverse.org` | openly licensed image search (anonymous, no key) | only when you search photos; thumbnails/images load from their source hosts |

No analytics, no accounts, no uploads. Openverse results carry licence/creator info, which is stored with the image and shown in the Uploads tab.

## Security notes

- Imported SVG is parsed with an allow-list sanitiser: scripts, event handlers, `foreignObject`, external references and `javascript:` URLs are removed and reported.
- `.slt` import validates every path (no absolute paths, `..`, backslashes), caps entry counts and total decompressed size, validates the project JSON, and never evaluates anything from the archive.
- File type/size limits: images 40 MB, SVG 8 MB, fonts 20 MB, `.slt` 300 MB (600 MB uncompressed).

## Known limitations

See the "Partial" and "Not supported" sections of [`docs/FEATURES.md`](docs/FEATURES.md). The important ones: PDF export embeds each page as an image (not selectable text), frames cannot be rotated, and automated tests were run in Chromium only.
