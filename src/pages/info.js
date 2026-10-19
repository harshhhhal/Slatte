import { h } from '../utils/dom.js';
import { icon, logoMark } from '../core/icons.js';
import { getTheme, toggleTheme } from '../core/theme.js';

function pageFrame(ctx, content) {
  const themeButton = h('button.icon-btn', { type: 'button', 'aria-label': 'Toggle light and dark theme' });
  const paintTheme = () => {
    const dark = getTheme() === 'dark';
    themeButton.innerHTML = icon(dark ? 'sun' : 'moon', 18);
    themeButton.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
  };
  themeButton.addEventListener('click', () => { toggleTheme(); paintTheme(); });
  paintTheme();

  const root = h('div.landing.info-page',
    h('a.skip', { href: '#main' }, 'Skip to content'),
    h('header.nav.info-nav',
      h('a.brand', { href: '/', 'data-link': '', 'aria-label': 'Slatte home', html: `${logoMark(26)}<span>Slatte</span>` }),
      h('div.nav-actions', themeButton, h('a.btn.btn-primary.info-start', { href: '/app', 'data-link': '' }, 'Open studio'))),
    h('main#main.info-main', content),
    h('footer.footer.info-footer',
      h('span', `© ${new Date().getFullYear()} Slatte`),
      h('nav.info-footer-links', { 'aria-label': 'More about Slatte' },
        h('a', { href: '/about', 'data-link': '' }, 'About'),
        h('a', { href: '/help', 'data-link': '' }, 'Help'),
        h('a', { href: 'https://github.com/harshhhhal/Slatte', target: '_blank', rel: 'noreferrer' }, 'GitHub'))));
  ctx.outlet.append(root);
  return { destroy() {} };
}

function workflowVisual() {
  const steps = [
    ['01', 'Choose', 'A canvas for your idea.', 'pages'],
    ['02', 'Create', 'Shape it with your tools.', 'pen'],
    ['03', 'Keep', 'Save here or export it.', 'download'],
  ];
  return h('div.info-workflow', { 'aria-label': 'Choose a canvas, create a design, then save or export it' },
    steps.map(([number, title, note, glyph], i) => h('div.info-step',
      h('span.info-step-no', number),
      h('span.info-step-icon', { html: icon(glyph, 19) }),
      h('strong', title), h('span.info-step-note', note),
      i < steps.length - 1 ? h('span.info-step-link', { 'aria-hidden': 'true' }, '→') : null)));
}

export function renderAbout(ctx) {
  document.title = 'About Slatte';
  return pageFrame(ctx,
    h('div.info-content.about-content',
      h('section.info-intro',
        h('p.eyebrow', 'ABOUT SLATTE'),
        h('h1', 'A calm place to make things.'),
        h('p.info-lede', 'Slatte is a small, browser-based design studio for posters, social graphics, and whatever you want to make next.'),
        workflowVisual()),
      h('section.info-about-grid', { 'aria-label': 'About the app' },
        h('article.info-note', h('span.info-note-icon', { html: icon('layers', 18) }), h('h2', 'Made for making'), h('p', 'Bring together type, shapes, images, paint, and multiple pages on one canvas.')),
        h('article.info-note', h('span.info-note-icon', { html: icon('folder', 18) }), h('h2', 'Yours by default'), h('p', 'Your projects stay in this browser. Export a Slatte project file when you want to keep a portable copy.'))),
      h('section.info-maker',
        h('div.info-maker-mark', { 'aria-hidden': 'true' }, logoMark(36)),
        h('div', h('p.eyebrow', 'THE MAKER'), h('h2', 'Built independently by Harshal.'), h('p', 'Slatte is an ongoing independent project, shaped around a simple idea: creative tools should feel clear and approachable.'),
          h('a.info-text-link', { href: 'https://github.com/harshhhhal/Slatte', target: '_blank', rel: 'noreferrer' }, 'Explore Slatte on GitHub ', h('span', '↗'))))));
}

function transferVisual() {
  return h('div.help-transfer', { 'aria-label': 'Your browser saves projects locally; export a project file to move it to another device' },
    h('div.help-transfer-node', h('span', { html: icon('folder', 20) }), h('strong', 'This browser'), h('small', 'Autosaved project')),
    h('div.help-transfer-arrow', h('span', 'Export .slt'), h('i'), h('span', 'Import')),
    h('div.help-transfer-node.portable', h('span', { html: icon('download', 20) }), h('strong', 'Your next device'), h('small', 'Portable project file')));
}

function helpItem(question, answer) {
  return h('details.help-item', h('summary', question), h('p', answer));
}

export function renderHelp(ctx) {
  document.title = 'Help — Slatte';
  return pageFrame(ctx,
    h('div.info-content.help-content',
      h('section.info-intro.help-intro',
        h('p.eyebrow', 'A HAND WHEN YOU NEED IT'),
        h('h1', 'Make yourself at home.'),
        h('p.info-lede', 'A few quick pointers to help you get from a blank canvas to a finished design.'),
        h('div.help-first-steps',
          h('span', { html: icon('plus', 17) }),
          h('p', h('strong', 'Start a design'), ' from the studio page, then pick a canvas size.'))),
      h('section.help-guide',
        h('div.help-guide-head', h('div', h('p.eyebrow', 'KEEP YOUR WORK'), h('h2', 'Your work stays with you.')), transferVisual())),
      h('section.help-questions', h('div.help-question-head', h('p.eyebrow', 'QUICK ANSWERS'), h('h2', 'A few useful things to know.')),
        helpItem('How do I add something to a design?', 'Choose a category from the vertical dock. Click an item to add it, or drag shapes, text, icons, photos, textures, fonts, and uploaded images onto the canvas.'),
        helpItem('How do I add or arrange pages?', 'Open the Pages control in the bottom dock to add a page. Page actions sit just above each canvas; every page stays visible side by side.'),
        helpItem('Where are my projects saved?', 'Slatte automatically saves projects in this browser. A project link only works in the browser that stores the project.'),
        helpItem('How do I move a project to another device?', 'Export a .slt project file, then import that file on the other device. The .slt file keeps your design editable.'),
        helpItem('Which formats can I export?', 'Use Export in the editor for PNG, JPEG, SVG, PDF, or an editable .slt project file.'),
        helpItem('Where can I find keyboard shortcuts?', 'Press ? while editing to open the shortcut reference. Use the top bar for undo, redo, and export.')),
      h('section.help-contact', h('span', { html: icon('info', 17) }), h('p', h('strong', 'Still stuck? '), 'Open an issue on GitHub and include what you were trying to do.'),
        h('a.info-text-link', { href: 'https://github.com/harshhhhal/Slatte/issues', target: '_blank', rel: 'noreferrer' }, 'Get help on GitHub ', h('span', '↗')))));
}
