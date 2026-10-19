/** Hand (pan) and Image (opens the file picker, then returns to Select). */

export function createHandTool() {
  return {
    id: 'hand',
    cursor: 'grab',
    showHandles: false,
    keyDown(e, { editor }) { if (e.key === 'Escape') editor.setTool('select'); },
  };
}

export function createImageTool() {
  return {
    id: 'image',
    cursor: 'default',
    activate({ editor }) {
      // The editor page owns file dialogs; the tool just asks for one and steps aside.
      editor.emit('request-image-import');
      queueMicrotask(() => editor.setTool('select'));
    },
  };
}
