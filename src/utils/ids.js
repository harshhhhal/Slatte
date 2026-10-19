/** Collision-resistant identifiers. */
export function uid(prefix = '') {
  let id;
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    id = crypto.randomUUID();
  } else {
    id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
  return prefix ? `${prefix}_${id}` : id;
}

/** Short id for objects (still unique within a document in practice). */
export function shortId(prefix = 'o') {
  return `${prefix}_${uid().replace(/-/g, '').slice(0, 12)}`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
