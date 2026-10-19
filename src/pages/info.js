import { h } from '../utils/dom.js';
import { icon, logoMark } from '../core/icons.js';
import { getTheme, toggleTheme } from '../core/theme.js';

const GITHUB = 'https://github.com/harshhhhal/Slatte';

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
      h('nav.info-nav-links', { 'aria-label': 'Main navigation' },
        h('a', { href: '/about', 'data-link': '', 'aria-current': location.pathname === '/about' ? 'page' : null }, 'About'),
        h('a', { href: '/help', 'data-link': '', 'aria-current': location.pathname === '/help' ? 'page' : null }, 'Help')),
      h('div.nav-actions', themeButton, h('a.btn.btn-primary.info-start', { href: '/app', 'data-link': '' }, 'Get started'))),
    h('main#main.info-main', content),
    h('footer.footer.info-footer',
      h('a.info-footer-brand', { href: '/', 'data-link': '', html: `${logoMark(20)}<span>Slatte</span>` }),
      h('span.info-footer-note', 'A little room to make.'),
      h('a.info-footer-github', { href: GITHUB, target: '_blank', rel: 'noreferrer' }, 'Made independently ↗')));
  ctx.outlet.append(root);
  return { destroy() {} };
}

function posterStack() {
  return h('div.info-art', { 'aria-hidden': 'true' },
    h('div.info-art-orbit'),
    h('div.info-poster.poster-back', h('span', '01 / POSTER'), h('strong', 'Make\nroom.'), h('i')),
    h('div.info-poster.poster-mid', h('span', '02 / SOCIAL'), h('strong', 'Stay\ncurious.'), h('i')),
    h('div.info-poster.poster-front', h('span', 'SLATTE / STUDIO'), h('strong', 'Aa'), h('i')));
}

function aboutFeature(iconName, title, text) {
  return h('article.about-feature',
    h('div.about-feature-top', h('span.about-feature-icon', { html: icon(iconName, 19) }), h('span.about-feature-index', '0' + (iconName === 'pages' ? '1' : iconName === 'pen' ? '2' : '3'))),
    h('h3', title), h('p', text));
}

export function renderAbout(ctx) {
  document.title = 'About — Slatte';
  return pageFrame(ctx,
    h('div.info-content.about-content',
      h('section.info-hero about-hero',
        h('div.info-hero-copy', h('p.eyebrow', 'A CREATIVE STUDIO ON THE WEB'),
          h('h1', 'Good ideas deserve room.'),
          h('p.info-lede', 'Slatte is a design studio you can open in your browser. Make posters, social graphics, and whatever the idea needs.'),
          h('a.btn.btn-primary.info-hero-cta', { href: '/app', 'data-link': '' }, 'Make something ', h('span', '↗'))),
        posterStack()),
      h('section.about-principles', { 'aria-label': 'What Slatte is made for' },
        h('div.about-section-intro', h('p.eyebrow', 'THE STUDIO'), h('h2', 'One canvas. Room for every idea.')),
        h('div.about-feature-grid',
          aboutFeature('pages', 'Room to explore', 'Keep multiple artboards side by side and move between ideas without losing your place.'),
          aboutFeature('pen', 'Tools that work together', 'Combine type, shapes, images, and paint on the same canvas.'),
          aboutFeature('download', 'Ready to take with you', 'Export finished work, or save an editable project file to move it elsewhere.'))),
      h('section.about-maker',
        h('div.about-maker-brand', h('span.about-maker-mark', { html: logoMark(30) }), h('span', 'AN INDEPENDENT PROJECT')),
        h('div.about-maker-copy', h('h2', 'Made by Harshal.'),
          h('p', 'Slatte is built around a simple belief: creative tools should make it easier to begin.'),
          h('a.info-text-link', { href: GITHUB, target: '_blank', rel: 'noreferrer' }, 'Follow the project ', h('span', '↗'))))));
}

function helpArt() {
  return h('div.help-art', { 'aria-hidden': 'true' },
    h('div.help-art-glow'),
    h('div.help-art-sheet.help-sheet-back', h('span', 'YOUR WORKSPACE'), h('i.help-back-shape')),
    h('div.help-art-sheet.help-sheet-front',
      h('span', 'SLATTE / FIELD NOTES'), h('strong', 'Start\nanywhere.'),
      h('div.help-art-rule'), h('div.help-art-tools', h('i', 'T'), h('i', '◯'), h('i', '↗'))),
    h('div.help-art-note', h('span', '01'), h('strong', 'Choose a tool'), h('i')),
    h('span.help-art-spark', '✳'));
}

function helpItem(question, answer, keywords = '') {
  return h('details.help-item', { 'data-search': `${question} ${answer} ${keywords}`.toLowerCase() },
    h('summary', question), h('div.help-answer', h('div.help-answer-inner', h('p', answer))));
}

function faqGroup(title, items) {
  return h('section.help-faq-group', { 'aria-label': title }, h('h3', title), ...items);
}

export function renderHelp(ctx) {
  document.title = 'Help — Slatte';
  const questions = h('div.help-faq-groups',
    faqGroup('Getting started', [
      helpItem('How do I start a design?', 'Open the studio, choose a canvas preset or enter a custom size, then add elements from the vertical tool dock.', 'new canvas size'),
      helpItem('Can I work on more than one page?', 'Yes. Add pages from the Pages control in the bottom dock. Artboards stay arranged horizontally so you can view and edit them together.', 'pages artboards'),
      helpItem('How do I add shapes, text, or images?', 'Choose a tool or asset from the left dock, then drag it onto an artboard. You can also click a tool and draw directly on the canvas.', 'drag drop tools elements assets'),
    ]),
    faqGroup('Projects & files', [
      helpItem('Where are my projects saved?', 'Slatte is a deployed web app. Projects are autosaved in the browser storage for the site you are using, so they remain available when you return to that browser.', 'autosave browser online deployed cloud'),
      helpItem('How do I open my project on another device?', 'From the Projects page, export an editable .slt project file. Open Slatte on the other device and import that file.', 'transfer move import export'),
      helpItem('What can I export?', 'Export finished designs as PNG, JPEG, SVG, or PDF. Choose the Slatte project format when you need to keep the design editable.', 'download formats image'),
    ]),
    faqGroup('Editing', [
      helpItem('Where are the brush options?', 'Select the brush in the bottom dock. Brush presets and paint controls appear in its sub-dock.', 'paint brush presets'),
      helpItem('How do I change an object precisely?', 'Select it, then use the Design pane. Hover over a numeric value and scroll to adjust it in small steps.', 'size position rotate opacity'),
      helpItem('Where can I find keyboard shortcuts?', 'Press ? in the editor to open the shortcut reference.', 'keys shortcuts help'),
    ]));
  const search = h('input.help-search-input', { type: 'search', placeholder: 'Search answers…', 'aria-label': 'Search help answers' });
  const empty = h('p.help-empty', { hidden: true }, 'No answers match that search. Try another word.');
  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    let total = 0;
    questions.querySelectorAll('.help-faq-group').forEach((group) => {
      let matches = 0;
      group.querySelectorAll('.help-item').forEach((item) => {
        const show = !query || item.dataset.search.includes(query);
        item.hidden = !show;
        if (show) matches += 1;
      });
      group.hidden = matches === 0;
      total += matches;
    });
    empty.hidden = total !== 0;
  });

  return pageFrame(ctx,
    h('div.info-content.help-content',
      h('section.info-hero help-hero',
        h('div.info-hero-copy', h('p.eyebrow', 'A LITTLE HELP, RIGHT HERE'),
          h('h1', 'Make your next move.'),
          h('p.info-lede', 'Quick answers for the canvas, your projects, and the tools in Slatte.'),
          h('a.info-text-link.help-back-link', { href: '/app', 'data-link': '' }, 'Back to the studio ', h('span', '↗'))),
        helpArt()),
      h('section.help-library', h('div.help-library-head', h('div', h('p.eyebrow', 'HELP DESK'), h('h2', 'Find your answer.')),
        h('label.help-search', h('span', { html: icon('search', 17) }), search)),
        questions, empty),
      h('section.help-contact',
        h('span.help-contact-icon', { html: icon('info', 19) }),
        h('div.help-contact-copy', h('p.eyebrow', 'NEED A HAND?'), h('h2', 'Talk to the maker.'), h('p', 'Share a bug, a question, or an idea for Slatte.')),
        h('a.btn.info-contact-btn', { href: 'https://github.com/harshhhhal/Slatte/issues', target: '_blank', rel: 'noreferrer' }, 'Get in touch ', h('span', '↗')))));
}
