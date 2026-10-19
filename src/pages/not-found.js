import { h } from '../utils/dom.js';
import { logoMark } from '../core/icons.js';

/** Shared "not found / can't open" state. */
export function renderNotFound(ctx, message = 'We couldn’t find that page.', { title = 'Nothing here' } = {}) {
  document.title = `${title} — Slatte`;
  const el = h('main.notfound', { id: 'main' },
    h('a.brand', { href: '/', 'data-link': '', html: `${logoMark(28)}<span>Slatte</span>` }),
    h('h1', title),
    h('p', message),
    h('div.row-actions',
      h('a.btn.btn-primary', { href: '/', 'data-link': '' }, 'Back to your projects'),
      h('a.btn', { href: '/templates', 'data-link': '' }, 'Start a new design')));
  ctx.outlet.append(el);
  return { destroy() {} };
}
