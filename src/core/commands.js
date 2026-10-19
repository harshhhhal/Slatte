/**
 * Command registry. Every user-facing action (menus, shortcuts, buttons) is a
 * command with an id, so shortcuts stay extensible and testable.
 *
 * `app` = { editor, stage, actions } where actions are provided by the editor page
 * (save, export dialog, file pickers ...).
 */

export const TOOL_SHORTCUTS = [
  ['select', 'V', 'Select'], ['direct', 'A', 'Direct select'], ['pen', 'P', 'Pen'], ['brush', 'B', 'Brush'],
  ['pencil', 'N', 'Pencil'], ['eraser', 'E', 'Eraser'], ['text', 'T', 'Text'], ['rectangle', 'R', 'Rectangle'],
  ['ellipse', 'O', 'Ellipse'], ['line', 'L', 'Line'], ['frame', 'F', 'Frame'], ['gradient', 'G', 'Gradient'],
  ['eyedropper', 'I', 'Eyedropper'], ['image', 'Shift+I', 'Image'], ['hand', 'H', 'Hand / pan'],
];

export function buildCommands(app) {
  const { editor: ed, stage, actions } = app;
  const list = [];
  const add = (id, label, keys, run, enabled) => list.push({ id, label, keys, run, enabled });

  add('undo', 'Undo', ['mod+z'], () => ed.undo(), () => ed.history.canUndo);
  add('redo', 'Redo', ['mod+shift+z', 'mod+y'], () => ed.redo(), () => ed.history.canRedo);
  add('save', 'Save project', ['mod+s'], () => actions.saveNow());
  add('open', 'Import file…', ['mod+o'], () => actions.importDialog());
  add('export', 'Export…', ['mod+shift+e'], () => actions.openExport());
  add('duplicate', 'Duplicate', ['mod+d'], () => ed.duplicateSelection(), () => ed.selection.length > 0);
  add('copy', 'Copy', ['mod+c'], () => ed.copy(), () => ed.selection.length > 0);
  add('cut', 'Cut', ['mod+x'], () => ed.cut(), () => ed.selection.length > 0);
  add('paste', 'Paste', ['mod+v'], () => ed.paste(), () => ed.hasClipboard());
  add('group', 'Group', ['mod+g'], () => ed.group(), () => ed.selection.length > 1);
  add('ungroup', 'Ungroup', ['mod+shift+g'], () => ed.ungroup(), () => ed.selectedObjects().some((o) => o.type === 'group'));
  add('selectAll', 'Select all', ['mod+a'], () => ed.selectAll());
  add('delete', 'Delete', ['delete', 'backspace'], () => ed.deleteSelection(), () => ed.selection.length > 0);
  add('escape', 'Deselect', ['escape'], () => {
    if (ed.toolId !== 'select') ed.setTool('select'); else ed.clearSelection();
  });
  add('front', 'Bring to front', ['mod+shift+]'], () => ed.order('front'));
  add('forward', 'Bring forward', ['mod+]'], () => ed.order('forward'));
  add('backward', 'Send backward', ['mod+['], () => ed.order('backward'));
  add('back', 'Send to back', ['mod+shift+['], () => ed.order('back'));
  add('lock', 'Lock / unlock', ['mod+shift+l'], () => { const o = ed.selectedObjects()[0]; if (o) ed.toggle(o.id, 'locked'); });
  add('hide', 'Show / hide', ['mod+shift+h'], () => { const o = ed.selectedObjects()[0]; if (o) ed.toggle(o.id, 'visible'); });
  add('zoomIn', 'Zoom in', ['mod+=', 'mod++'], () => stage.zoomBy(1.25));
  add('zoomOut', 'Zoom out', ['mod+-'], () => stage.zoomBy(0.8));
  add('zoom100', 'Zoom to 100%', ['mod+1'], () => stage.zoomAt(1));
  add('fitPage', 'Fit page', ['shift+1', 'mod+0'], () => stage.fitPage());
  add('fitSelection', 'Fit selection', ['shift+2'], () => stage.fitSelection());
  add('shortcuts', 'Keyboard shortcuts', ['?', 'shift+/'], () => actions.openShortcuts());
  add('toggleGrid', 'Show grid', ['mod+\''], () => ed.setPageProps({ 'gridSettings.show': !ed.page.gridSettings.show }));
  add('toggleRulers', 'Show rulers', ['shift+r'], () => { ed.doc.settings.rulers = !ed.doc.settings.rulers; ed.commit('Toggle rulers'); });
  add('toggleSnap', 'Snap to objects', [], () => { ed.doc.settings.snap = !ed.doc.settings.snap; ed.commit('Toggle snapping'); });
  add('combine', 'Combine paths', ['mod+alt+c'], () => ed.combinePaths());
  add('convertPath', 'Convert to path', [], () => { for (const id of ed.editableIds()) ed.convertToPath(id); });

  const nudge = (dx, dy) => () => ed.nudge(dx, dy);
  add('nudgeL', 'Nudge left', ['arrowleft'], nudge(-1, 0), () => ed.selection.length > 0);
  add('nudgeR', 'Nudge right', ['arrowright'], nudge(1, 0), () => ed.selection.length > 0);
  add('nudgeU', 'Nudge up', ['arrowup'], nudge(0, -1), () => ed.selection.length > 0);
  add('nudgeD', 'Nudge down', ['arrowdown'], nudge(0, 1), () => ed.selection.length > 0);
  add('nudgeL10', 'Nudge left ×10', ['shift+arrowleft'], nudge(-10, 0), () => ed.selection.length > 0);
  add('nudgeR10', 'Nudge right ×10', ['shift+arrowright'], nudge(10, 0), () => ed.selection.length > 0);
  add('nudgeU10', 'Nudge up ×10', ['shift+arrowup'], nudge(0, -10), () => ed.selection.length > 0);
  add('nudgeD10', 'Nudge down ×10', ['shift+arrowdown'], nudge(0, 10), () => ed.selection.length > 0);

  for (const [tool, key] of TOOL_SHORTCUTS) {
    const k = key.toLowerCase();
    add(`tool:${tool}`, `Tool: ${tool}`, [k], () => ed.setTool(tool));
  }
  return list;
}

export const SHORTCUT_GROUPS = [
  { title: 'General', items: [
    ['Undo', 'mod+Z'], ['Redo', 'mod+Shift+Z'], ['Save project', 'mod+S'], ['Import file', 'mod+O'], ['Export', 'mod+Shift+E'],
    ['Copy / cut / paste', 'mod+C / X / V'], ['Duplicate', 'mod+D'], ['Select all', 'mod+A'], ['Delete', 'Delete'],
    ['Deselect / cancel', 'Esc'], ['This reference', '?'],
  ] },
  { title: 'Layers', items: [
    ['Group', 'mod+G'], ['Ungroup', 'mod+Shift+G'], ['Bring forward / back', 'mod+] / ['], ['To front / back', 'mod+Shift+] / ['],
    ['Lock / hide', 'mod+Shift+L / H'], ['Combine paths', 'mod+Alt+C'],
  ] },
  { title: 'Tools', items: TOOL_SHORTCUTS.map(([, k, n]) => [n, k]) },
  { title: 'View', items: [
    ['Zoom in / out', 'mod+= / mod+-'], ['Zoom 100%', 'mod+1'], ['Fit page', 'Shift+1'], ['Fit selection', 'Shift+2'],
    ['Pan', 'Space + drag'], ['Zoom with wheel', 'mod + scroll'], ['Show grid', 'mod+\''], ['Show rulers', 'Shift+R'],
  ] },
  { title: 'Editing', items: [
    ['Nudge', 'Arrow keys'], ['Nudge ×10', 'Shift + Arrow'], ['Constrain proportions / angle', 'Hold Shift'],
    ['Scale from centre', 'Hold Alt'], ['Duplicate while dragging', 'Alt + drag'], ['Brush size', '[ and ]'],
    ['Finish pen path', 'Enter'], ['Remove last pen point', 'Backspace'], ['Add / convert node', 'Double-click path / node'],
  ] },
];
