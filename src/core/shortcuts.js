import { isMac } from '../utils/dom.js';

/** Turns a KeyboardEvent into a combo string like "mod+shift+z". */
export function comboOf(e) {
  const parts = [];
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod) parts.push('mod');
  if (e.altKey) parts.push('alt');
  // Physical keys for punctuation that changes with Shift or keyboard layout.
  const byCode = { BracketLeft: '[', BracketRight: ']', Quote: "'", Equal: '=', Minus: '-' };
  if (byCode[e.code] && (mod || e.altKey)) {
    if (e.shiftKey) parts.push('shift');
    parts.push(byCode[e.code]);
    return parts.join('+');
  }
  let key = e.key === ' ' ? 'space' : e.key.toLowerCase();
  // Shift is part of the character for symbols (e.g. "?"), explicit for letters/digits/arrows.
  const symbolic = e.key.length === 1 && !/[a-z0-9]/i.test(e.key);
  if (e.shiftKey && !symbolic) parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

function typing(target) {
  return target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
}

/**
 * Global keyboard shortcut dispatcher. Ignores keystrokes aimed at text fields
 * (except Save), skips events a tool already handled, and ignores key repeat
 * for everything except nudging and deleting.
 */
export class Shortcuts {
  constructor(commands) {
    this.map = new Map();
    this.commands = commands;
    for (const c of commands) for (const k of c.keys) this.map.set(k, c);
    this._onKey = (e) => this.handle(e);
  }

  attach() {
    window.addEventListener('keydown', this._onKey);
  }

  detach() {
    window.removeEventListener('keydown', this._onKey);
  }

  handle(e) {
    if (e.defaultPrevented || e.isComposing) return;
    if (document.querySelector('dialog[open]')) return;
    const combo = comboOf(e);
    const isTyping = typing(e.target);
    if (isTyping && combo !== 'mod+s') return;
    if (e.key === 'Escape' && document.querySelector('.popmenu')) return;
    const cmd = this.map.get(combo);
    if (!cmd) return;
    if (cmd.enabled && !cmd.enabled()) {
      // Still swallow Backspace/Delete/arrows so the browser never navigates or scrolls.
      if (/^(delete|backspace|arrow)/.test(combo)) e.preventDefault();
      return;
    }
    const repeatable = /^(shift\+)?arrow/.test(combo) || combo === 'delete' || combo === 'backspace';
    if (e.repeat && !repeatable) { e.preventDefault(); return; }
    e.preventDefault();
    cmd.run();
  }

  find(id) {
    return this.commands.find((c) => c.id === id);
  }
}

export function formatKeys(keys) {
  return String(keys)
    .replace(/mod/gi, isMac ? '⌘' : 'Ctrl')
    .replace(/alt/gi, isMac ? '⌥' : 'Alt')
    .replace(/shift/gi, isMac ? '⇧' : 'Shift');
}
