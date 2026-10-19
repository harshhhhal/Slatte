import { h } from '../utils/dom.js';
import { icon } from '../core/icons.js';

/* ------------------------------ toasts ------------------------------ */

let toastHost = null;

function host() {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = h('div.toasts', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' });
    document.body.append(toastHost);
  }
  return toastHost;
}

const TOAST_ICON = { info: 'info', success: 'success', warning: 'warning', error: 'error' };

/**
 * Brief, non-blocking message. Icon + text (never colour alone).
 * `action` = { label, onClick } adds a button (e.g. Retry).
 */
export function toast(message, { kind = 'info', duration, action } = {}) {
  const ms = duration ?? (kind === 'error' ? 7000 : action ? 8000 : 3500);
  const el = h('div.toast', { class: `toast-${kind}` },
    h('span.toast-icon', { html: icon(TOAST_ICON[kind] || 'info', 16) }),
    h('span.toast-text', message),
    action ? h('button.toast-action', { type: 'button', onclick: () => { action.onClick(); remove(); } }, action.label) : null,
    h('button.toast-close', { type: 'button', 'aria-label': 'Dismiss', onclick: () => remove(), html: icon('x', 14) }));
  const parent = host();
  parent.append(el);
  while (parent.children.length > 4) parent.firstChild.remove();
  let timer = setTimeout(remove, ms);
  function remove() {
    clearTimeout(timer);
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 160);
  }
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => { timer = setTimeout(remove, 1800); });
  return { dismiss: remove };
}

/* ------------------------------ dialogs ------------------------------ */

/**
 * Accessible modal built on <dialog>. Returns { el, body, close }.
 * options: { title, body (Node), actions: [{label, primary, onClick, closes}], wide, onClose }
 */
export function openDialog({ title, body, actions = [], wide = false, onClose, description } = {}) {
  const dlg = h('dialog.dialog', { class: wide ? 'wide' : '', 'aria-labelledby': 'dlg-title' });
  const close = (result) => {
    if (dlg.open) dlg.close(result);
  };
  const head = h('header.dialog-head',
    h('h2#dlg-title', title),
    h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: () => close('cancel'), html: icon('x', 18) }));
  const bodyWrap = h('div.dialog-body', description ? h('p.dialog-desc', description) : null, body);
  const foot = actions.length ? h('footer.dialog-foot', actions.map((a) => h('button.btn', {
    type: 'button', class: a.primary ? 'btn-primary' : a.danger ? 'btn-danger' : '', disabled: !!a.disabled,
    onclick: async () => {
      let keep = false;
      if (a.onClick) keep = (await a.onClick({ close })) === false;
      if (a.closes !== false && !keep) close(a.label);
    },
  }, a.label))) : null;
  dlg.append(head, bodyWrap);
  if (foot) dlg.append(foot);
  dlg.addEventListener('close', () => { dlg.remove(); if (onClose) onClose(dlg.returnValue); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close('cancel'); });
  document.body.append(dlg);
  dlg.showModal();
  return { el: dlg, body: bodyWrap, foot, close };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    openDialog({
      title,
      body: h('p', message),
      actions: [
        { label: 'Cancel', onClick: () => { answered = true; resolve(false); } },
        { label: confirmLabel, primary: !danger, danger, onClick: () => { answered = true; resolve(true); } },
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

/* ------------------------------ menus ------------------------------ */

let openMenuEl = null;
let openMenuCleanup = null;

export function closeMenu() {
  if (openMenuCleanup) openMenuCleanup();
  openMenuEl = null;
  openMenuCleanup = null;
}

/**
 * Popover menu anchored to an element.
 * items: { label, icon, shortcut, onClick, disabled, checked, separator, header }
 */
export function showMenu(anchor, items, { align = 'start', side = 'bottom' } = {}) {
  closeMenu();
  const menu = h('div.popmenu', { role: 'menu' });
  const buttons = [];
  for (const it of items) {
    if (it.separator) { menu.append(h('div.popmenu-sep', { role: 'separator' })); continue; }
    if (it.header) { menu.append(h('div.popmenu-head', it.header)); continue; }
    const b = h('button.popmenu-item', {
      type: 'button', role: it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem', disabled: !!it.disabled,
      'aria-checked': it.checked !== undefined ? String(!!it.checked) : null,
      onclick: () => { closeMenu(); if (it.onClick) it.onClick(); },
    },
    h('span.popmenu-icon', { html: it.checked ? icon('check', 16) : it.icon ? icon(it.icon, 16) : '' }),
    h('span.popmenu-label', it.label),
    it.shortcut ? h('kbd.popmenu-kbd', it.shortcut) : null);
    buttons.push(b);
    menu.append(b);
  }
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = align === 'end' ? r.right - mw : side === 'right' ? r.right + 6 : r.left;
  let top = side === 'right' ? r.top : r.bottom + 6;
  left = Math.max(8, Math.min(window.innerWidth - mw - 8, left));
  if (top + mh > window.innerHeight - 8) top = Math.max(8, side === 'right' ? window.innerHeight - mh - 8 : r.top - mh - 6);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  const onDown = (e) => { if (!menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeMenu(); };
  const onKey = (e) => {
    const enabled = buttons.filter((b) => !b.disabled);
    const i = enabled.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); anchor.focus && anchor.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); (enabled[(i + 1) % enabled.length] || enabled[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (enabled[(i - 1 + enabled.length) % enabled.length] || enabled[0]).focus(); }
  };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', closeMenu);
  openMenuEl = menu;
  openMenuCleanup = () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', closeMenu);
    menu.remove();
  };
  const first = buttons.find((b) => !b.disabled);
  if (first) first.focus({ preventScroll: true });
  return menu;
}

export function isMenuOpen() {
  return !!openMenuEl;
}

/** Visually hidden live-region announcer for screen readers. */
let live = null;
export function announce(text) {
  if (!live || !live.isConnected) {
    live = h('div.sr-only', { 'aria-live': 'polite', role: 'status' });
    document.body.append(live);
  }
  live.textContent = '';
  setTimeout(() => { live.textContent = text; }, 30);
}
