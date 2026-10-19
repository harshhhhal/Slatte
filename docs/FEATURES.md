# Feature status

## Supported
- Routes `/`, `/templates`, `/editor/:uuid`; History API navigation; not-found states; reload restores from IndexedDB.
- Landing page with live (HTML/CSS) preview, recent projects with thumbnails, duplicate/delete (with confirmation), open `.slt`, light/dark theme.
- Editor: top bar (name, save status, undo/redo, theme, export, menu), tool rail with flyouts, left panel (Pages, Elements, Icons, Photos, Textures, Brushes, Fonts, Uploads), stage with zoom/pan/rulers/grid/guides, inspector + layers tabs, status bar; collapsible and resizable panels; drawers on small screens.
- Tools: select, direct select (move nodes/handles, add/remove nodes, smooth/corner), rectangle, rounded rectangle, ellipse, line, triangle, polygon, star, arrow, frame, pen, pencil, brush, eraser, text, image, gradient, eyedropper, hand.
- Brushes: hard, soft, pencil, ink, marker, grain, dry, halftone; size/opacity/smoothing; pen pressure where the device provides it.
- Layers: group/ungroup, lock, hide, rename, reorder (drag or commands), search, type filter, isolate groups.
- Appearance: solid/linear/radial fills and strokes with stop editor, stroke width/cap/join/dash, 16 blend modes, opacity, drop shadow, blur, outline, corner radii (per corner).
- Align/distribute, snapping to objects/page/grid, smart guides, nudge, duplicate (Alt-drag), copy/cut/paste, constrain with Shift, scale from centre with Alt.
- Text: font family/weight/style/size, line height, letter spacing, alignment, auto/fixed width, curated Google Fonts (lazy-loaded), uploaded fonts.
- Import: `.slt`, PNG/JPEG/WebP/GIF/BMP, SVG (sanitised; paths imported as editable vectors, complex SVG kept as a sanitised icon), TTF/OTF/WOFF/WOFF2; drag-and-drop and file picker.
- Export: PNG (1–3×, transparent), JPEG, SVG (fonts embedded), PDF, `.slt`; multi-page exports as a zip (PDF as one file).
- Autosave with visible status, retry on failure, quota messaging, in-memory fallback.
- Keyboard shortcuts with in-app reference (`?`); focus-visible styles, ARIA roles/labels, live-region announcements, reduced-motion support.

## Partial
- **PDF** pages are embedded as JPEG images, so text is not selectable and files are larger than a vector PDF. Use SVG for vector output.
- **Frames** clip their children and can be resized/moved, but cannot be rotated.
- **Direct select** edits `path` objects; other shapes must first be converted ("Convert to editable path").
- **Gradient tool** handles linear and radial gradients on one object at a time; gradient strokes use the same editor.
- **Textures** are procedural patterns (no bundled photographic textures).
- **SVG import** converts paths/basic shapes; SVGs using gradients, clipping, masks or filters fall back to a single sanitised vector object.
- **Locked objects and paint layers** can't be picked on the canvas; select them in the Layers panel.
- **Browser coverage**: automated runs used Chromium. Safari/Firefox are expected to work but were not tested. Pen pressure and tilt need hardware that reports them.
- **Fonts and photos** need network access; offline you get system fonts, the built-in icon set and your own uploads.

## Not supported
- Cloud sync, sharing links, collaboration.
- Vector boolean operations beyond "combine paths" (compound paths).
- Text on a path, rich text with mixed styles in one box, OpenType feature controls.
- Non-destructive filters/adjustment layers; CMYK/colour profiles.
- Animated export, video, or GIF.
