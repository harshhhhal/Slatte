import { createObject, uniqueName } from '../../core/document-model.js';
import { fitText, familyCss } from '../../core/text-layout.js';
import { fonts } from '../../services/font-service.js';
import { h } from '../../utils/dom.js';
import { localToWorld } from '../../utils/geometry.js';
import { DRAG_SLOP, dragDistance } from './tool-utils.js';

/** Text tool with an in-place HTML editor layered over the SVG text. */
export function createTextTool() {
  let st = null; // drag-to-create state
  let session = null; // active editing session
  let ctxRef = null;

  const place = () => {
    if (!session) return;
    const { editor, stage } = ctxRef;
    const o = editor.get(session.id);
    if (!o) { end(false); return; }
    const z = stage.zoom;
    const origin = localToWorld(o, { x: 0, y: 0 });
    const s = stage.pageToScreen(origin.x, origin.y);
    const ta = session.ta;
    ta.style.left = `${s.x}px`;
    ta.style.top = `${s.y}px`;
    ta.style.width = `${Math.max(24, o.width * z + (o.autoWidth ? 12 : 0))}px`;
    ta.style.height = `${Math.max(o.fontSize * o.lineHeight * z, o.height * z)}px`;
    ta.style.transform = `rotate(${o.rotation || 0}deg)`;
    ta.style.fontFamily = familyCss(o.fontFamily);
    ta.style.fontSize = `${o.fontSize * z}px`;
    ta.style.fontWeight = o.fontWeight;
    ta.style.fontStyle = o.fontStyle;
    ta.style.lineHeight = `${o.lineHeight}`;
    ta.style.letterSpacing = `${(o.letterSpacing || 0) * z}px`;
    ta.style.textAlign = o.align;
    ta.style.color = o.fill.type === 'solid' ? o.fill.color : '#000';
    ta.style.whiteSpace = o.autoWidth ? 'pre' : 'pre-wrap';
    ta.style.textDecoration = [o.underline ? 'underline' : '', o.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none';
  };

  const end = (keep = true) => {
    if (!session) return;
    const { editor, stage } = ctxRef;
    const s = session;
    session = null;
    s.unsub.forEach((u) => u());
    s.ta.remove();
    stage.hideObject(null);
    editor.editingTextId = null;
    const o = editor.get(s.id);
    if (!o) return;
    const empty = !o.text.trim();
    if (empty && keep !== 'force') {
      editor.preview((page) => { page.objects = page.objects.filter((x) => x.id !== s.id); });
      if (!s.isNew) { /* an existing text box emptied: removal must be recorded */ editor.commit('Delete text'); }
      editor.clearSelection();
      return;
    }
    if (s.isNew) editor.commit('Add text');
    else if (o.text !== s.before) editor.commit('Edit text', `text:${s.id}`);
  };

  const begin = (id, isNew) => {
    const { editor, stage } = ctxRef;
    if (session) end(true);
    const o = editor.get(id);
    if (!o) return;
    editor.select([id]);
    editor.editingTextId = id;
    const ta = h('textarea.text-editor', { spellcheck: false, 'aria-label': 'Edit text', value: o.text });
    stage.overlayHost.append(ta);
    session = { id, ta, isNew, before: o.text, unsub: [] };
    stage.hideObject(id);
    const onInput = () => {
      editor.preview((page) => {
        const live = page.objects.find((x) => x.id === id);
        live.text = ta.value;
        fitText(live);
      });
      place();
    };
    ta.addEventListener('input', onInput);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(true); editor.setTool('select'); }
      e.stopPropagation();
    });
    ta.addEventListener('blur', () => setTimeout(() => { if (session && session.ta === ta) end(true); }, 0));
    session.unsub.push(editor.on('viewport', place));
    session.unsub.push(editor.on('change', () => place()));
    place();
    requestAnimationFrame(() => { ta.focus({ preventScroll: true }); if (isNew) ta.select(); else ta.setSelectionRange(0, ta.value.length); });
    // Make sure the font is ready so measurement is right.
    fonts.load(o.fontFamily).then(() => { fitText(editor.get(id) || o); place(); });
  };

  const tool = {
    id: 'text',
    cursor: 'text',
    showHandles: false,

    activate(ctx) { ctxRef = ctx; },
    deactivate() { if (session) end(true); st = null; },
    cancel() { st = null; },
    edit(id, ctx) { ctxRef = ctx || ctxRef; begin(id, false); },
    isEditing() { return !!session; },
    finish() { end(true); },

    pointerDown(ev, ctx) {
      ctxRef = ctx;
      const { editor, stage } = ctx;
      if (session) { end(true); }
      const hitId = stage.objectIdAt(ev.target);
      const hit = hitId && editor.get(hitId);
      if (hit && hit.type === 'text' && !hit.locked) {
        // Defer so the blur from the old editor does not steal focus.
        st = null;
        setTimeout(() => begin(hit.id, false), 0);
        return;
      }
      st = { start: ev.page, startScreen: ev.screen, drag: false };
    },

    pointerMove(ev, { editor, stage }) {
      if (!st) return;
      if (dragDistance(ev.screen, st.startScreen) < DRAG_SLOP) return;
      st.drag = true;
      const x0 = Math.min(st.start.x, ev.page.x), w = Math.abs(ev.page.x - st.start.x);
      const y0 = Math.min(st.start.y, ev.page.y), hh = Math.abs(ev.page.y - st.start.y);
      const a = stage.pageToScreen(x0, y0);
      stage.extraOverlay = `<rect x="${a.x}" y="${a.y}" width="${w * stage.zoom}" height="${hh * stage.zoom}" class="ov-marquee"/>`;
      st.rect = { x: x0, y: y0, width: w, height: hh };
      stage.invalidate({ overlay: true });
    },

    pointerUp(ev, { editor, stage }, cancelled) {
      const s = st;
      st = null;
      stage.extraOverlay = '';
      stage.invalidate({ overlay: true });
      if (!s || cancelled) return;
      const props = { text: '', name: 'Text' };
      const o = createObject('text', props);
      if (s.drag && s.rect && s.rect.width > 20) {
        o.autoWidth = false; o.x = s.rect.x; o.y = s.rect.y; o.width = s.rect.width;
      } else { o.x = s.start.x; o.y = s.start.y - o.fontSize * 0.6; }
      fitText(o);
      editor.preview((page) => {
        o.name = uniqueName(page, 'Text');
        if (editor.isolateId) o.parentId = editor.isolateId;
        page.objects.push(o);
      });
      begin(o.id, true);
    },

    keyDown(e, { editor }) {
      if (e.key === 'Escape') { if (!session) editor.setTool('select'); }
    },
  };
  return tool;
}
