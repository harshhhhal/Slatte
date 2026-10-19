import { h, Disposer } from '../utils/dom.js';
import { icon, logoMark } from '../core/icons.js';
import { toggleTheme, getTheme } from '../core/theme.js';
import { storage } from '../services/project-storage.js';
import { duplicateProject } from '../services/projects.js';
import { confirmDialog, toast, showMenu } from '../ui/ui.js';
import { describeError } from '../utils/errors.js';
import { openNewDesignDialog } from './picker.js';

function relTime(iso) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  const seconds = Math.max(0, (Date.now() - time) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)} d ago`;
  return new Date(time).toLocaleDateString();
}

export async function renderApp(ctx) {
  const disposer = new Disposer();
  const urls = [];
  const openEditor = (id) => ctx.router.navigate(`/editor/${id}`);
  const themeButton = h('button.icon-btn', { type: 'button', 'aria-label': 'Toggle light and dark theme' });
  const paintTheme = () => {
    const dark = getTheme() === 'dark';
    themeButton.innerHTML = icon(dark ? 'sun' : 'moon', 18);
    themeButton.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
  };
  themeButton.addEventListener('click', () => { toggleTheme(); paintTheme(); });
  paintTheme();

  const welcome = h('section.app-welcome',
    h('div.app-welcome-copy',
      h('p.eyebrow', 'YOUR CREATIVE SPACE'),
      h('h1', 'Make something worth keeping.'),
      h('p', 'Pick up where you left off, or start with a fresh canvas.'),
      h('button.btn.btn-primary', { type: 'button', onclick: () => openNewDesignDialog(ctx) }, h('span', { html: icon('plus', 16) }), 'New design')),
    h('div.app-welcome-art', { 'aria-hidden': 'true' },
      h('span.welcome-paper.paper-back'),
      h('div.welcome-paper.paper-front', h('span', 'SLATTE / STUDIO'), h('i'), h('b'), h('em')),
      h('span.welcome-spark.spark-one', '✳'), h('span.welcome-spark.spark-two', '✳')));
  const projectCount = h('span.app-project-count', '0 projects');
  const projectList = h('ul.project-grid', { 'aria-label': 'Your projects' });
  const projectSection = h('section.app-projects#projects', h('div.app-section-head',
    h('div', h('p.eyebrow', 'YOUR WORK, ALL TOGETHER'), h('h2', 'Recent projects')),
    projectCount),
    projectList);

  const loadProjects = async () => {
    projectList.replaceChildren(h('li.state.state-loading', { role: 'status' }, h('span.spin'), h('span', 'Loading projects…')));
    let projects;
    try { projects = await storage.list(); }
    catch (err) {
      projectList.replaceChildren(h('li.state.state-error', { role: 'alert' }, h('p.state-title', 'Could not read your projects'), h('p', describeError(err)),
        h('button.btn', { type: 'button', onclick: loadProjects }, 'Try again')));
      return;
    }
    projectCount.textContent = `${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`;
    urls.splice(0).forEach((url) => URL.revokeObjectURL(url));
    if (!projects.length) {
      projectList.replaceChildren(h('li.state.state-empty', h('p.state-title', 'Your next idea starts here'),
        h('p', 'Create a canvas and it will show up here.'),
        h('button.btn.btn-primary', { type: 'button', onclick: () => openNewDesignDialog(ctx) }, 'Create a design')));
      return;
    }
    projectList.replaceChildren(...projects.map((project) => {
      const thumbnail = project.thumb instanceof Blob
        ? h('img', { src: URL.createObjectURL(project.thumb), alt: '', loading: 'lazy' })
        : h('span.thumb-empty', { html: icon('image', 28) });
      if (project.thumb instanceof Blob) urls.push(thumbnail.src);
      const more = h('button.icon-btn.card-more', { type: 'button', 'aria-label': `More actions for ${project.name}`, 'aria-haspopup': 'menu', html: icon('more', 18) });
      more.addEventListener('click', (event) => {
        event.preventDefault(); event.stopPropagation();
        showMenu(more, [
          { label: 'Open', icon: 'folder', onClick: () => openEditor(project.id) },
          { label: 'Duplicate', icon: 'copy', onClick: async () => { try { await duplicateProject(project.id); await loadProjects(); toast('Project duplicated', { kind: 'success' }); } catch (err) { toast(describeError(err), { kind: 'error' }); } } },
          { separator: true },
          { label: 'Delete…', icon: 'trash', onClick: async () => {
            const okay = await confirmDialog({ title: 'Delete project?', message: `“${project.name}” and its images will be removed from this browser. This cannot be undone.`, confirmLabel: 'Delete', danger: true });
            if (!okay) return;
            try { await storage.remove(project.id); await loadProjects(); toast('Project deleted', { kind: 'info' }); } catch (err) { toast(describeError(err), { kind: 'error' }); }
          } },
        ], { align: 'end' });
      });
      return h('li.project-card', h('a.project-link', { href: `/editor/${project.id}`, 'data-link': '', 'aria-label': `Open ${project.name}` },
        h('div.project-thumb', thumbnail), h('div.project-meta', h('span.project-name', project.name),
          h('span.project-sub', `${project.pages} page${project.pages === 1 ? '' : 's'} · ${project.objects} layer${project.objects === 1 ? '' : 's'} · ${relTime(project.updatedAt)}`))), more);
    }));
    if (storage.volatile) projectSection.prepend(h('p.banner.warning', { role: 'status' }, 'This browser blocks local storage. Export a .slt file to keep your work.'));
  };

  const root = h('div.landing.app-home',
    h('header.nav.app-nav', h('a.brand', { href: '/', 'data-link': '', 'aria-label': 'Slatte home', html: `${logoMark(26)}<span>Slatte</span>` }),
      h('div.nav-actions', themeButton)),
    h('main#main.app-main', welcome, projectSection),
    h('footer.footer', h('span', `© ${new Date().getFullYear()} Slatte`), h('span.muted', 'Your projects stay on this device.')));
  ctx.outlet.append(root);
  loadProjects();
  return { destroy() { disposer.dispose(); urls.forEach((url) => URL.revokeObjectURL(url)); } };
}
