export { splitCubic } from '../utils/geometry.js';

export function segmentPointsFor(a, b) {
  return [
    { x: a.x, y: a.y },
    { x: a.x + a.ox, y: a.y + a.oy },
    { x: b.x + b.ix, y: b.y + b.iy },
    { x: b.x, y: b.y },
  ];
}
