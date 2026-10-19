# `.slt` — Slatte project format

A `.slt` file is a ZIP archive (MIME `application/vnd.slatte.project+zip`).

```
manifest.json        required
project.json         required
assets/<id>.<ext>    images and painted layers (PNG/JPEG/WebP/GIF/BMP/SVG)
fonts/<id>.<ext>     custom fonts (TTF/OTF/WOFF/WOFF2), optional
previews/page-1.png  small preview of the first page, optional
```

Exports are deterministic: fixed entry timestamps, stable key order, assets sorted by id.

## manifest.json

```json
{
  "format": "slatte",
  "schemaVersion": 1,
  "application": "Slatte",
  "applicationVersion": "1.0.0",
  "projectId": "uuid",
  "projectName": "Poster draft",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "pages": 2
}
```

`format` must be `"slatte"`. A `schemaVersion` greater than the app supports is refused with a message asking you to update; older versions are migrated by `migrateDocument`.

## project.json

```
{
  id, name, schemaVersion, createdAt, updatedAt, activePageId,
  pages:   [{ id, name, width, height, background:{color,transparent}, guides:[], gridSettings:{size,show,snap}, objects:[…] }],
  assets:  { <assetId>: { id, name, mime, kind:'image'|'font', size, width, height, source, path } },
  fonts:   [{ id, family, source:'google'|'local'|'system', assetId, weights, category, license }],
  colorStyles: [{ id, name, color }],
  settings: { recentColors:[], snap, rulers }
}
```

Objects are a flat list per page in z-order (bottom first). `parentId` links children to a `group` or `frame`. All coordinates are absolute page pixels; `rotation` is degrees about the box centre.

Object `type` is one of `rectangle`, `roundedRectangle`, `ellipse`, `line`, `polygon`, `star`, `arrow`, `path`, `text`, `image`, `icon`, `group`, `rasterLayer`, `texture`, `frame`. Common fields: `id, name, x, y, width, height, rotation, opacity, blendMode (16 values), visible, locked, fill, stroke, effects{shadow, blur, outline}`. Paint objects carry `type: none|solid|linear|radial`, colour/opacity and gradient stops/geometry (relative to the object box).

Painted layers (`rasterLayer`) and images reference a PNG/JPEG by `assetId`; `assets[assetId].path` points at its archive entry.

## Validation on import

1. Size limit (300 MB archive, 600 MB uncompressed, ≤ 6000 entries).
2. Every entry name must be a safe relative path.
3. `manifest.json` and `project.json` must parse; `format` and `schemaVersion` are checked.
4. `project.json` is validated and normalised: unknown fields are dropped, numbers are clamped, unknown object types become inert `unsupported` placeholders, SVG/icon markup is re-sanitised.
5. Asset paths must be under `assets/` or `fonts/`; missing assets produce warnings and placeholders rather than failures.

Importing always creates a **new project** with a fresh id; nothing existing is overwritten.
