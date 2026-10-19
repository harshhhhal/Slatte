import './styles/index.css';
import { initTheme } from './core/theme.js';
import { Router } from './core/router.js';
import { UUID_RE } from './utils/ids.js';
import { renderLanding } from './pages/landing.js';
import { renderEditor } from './pages/editor.js';
import { renderApp } from './pages/app.js';
import { renderNotFound } from './pages/not-found.js';
import { renderAbout, renderHelp } from './pages/info.js';

initTheme();

const outlet = document.getElementById('app');

const routes = [
  { path: '/', title: 'Slatte — a clean space to make things', view: renderLanding },
  { path: '/about', title: 'About Slatte', view: renderAbout },
  { path: '/help', title: 'Help — Slatte', view: renderHelp },
  { path: '/app', title: 'Your projects and templates — Slatte', view: renderApp },
  { path: '/templates', title: 'Your projects and templates — Slatte', view: (ctx) => { ctx.router.navigate('/app', { replace: true }); return { destroy() {} }; } },
  {
    path: '/editor/:projectId',
    title: 'Editor — Slatte',
    view: (ctx) => (UUID_RE.test(ctx.params.projectId) ? renderEditor(ctx) : renderNotFound(ctx, 'That project link isn’t valid.')),
  },
];

const router = new Router(routes, outlet, (ctx) => renderNotFound(ctx));
window.__slatte = { router };
router.start();

window.addEventListener('unhandledrejection', (e) => {
  console.error('[slatte] unhandled rejection', e.reason);
});

