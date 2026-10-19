import { h, Disposer } from '../utils/dom.js';
import { icon, logoMark } from '../core/icons.js';
import { toggleTheme, getTheme } from '../core/theme.js';
import { storage } from '../services/project-storage.js';
import { createProject, duplicateProject } from '../services/projects.js';
import { confirmDialog, toast, showMenu } from '../ui/ui.js';
import { describeError } from '../utils/errors.js';
import { openNewDesignDialog, presetGroups } from './picker.js';

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

  const projectList = h('ul.project-grid', { 'aria-label': 'Your projects' });
  const projectSection = h('section.app-projects#projects', h('div.app-section-head',
    h('div', h('p.eyebrow', 'Your work, all together'), h('h2', 'Recent projects'), h('p.section-note', 'Pick up where you left off.')),
    h('a.section-link', { href: '#templates' }, 'Browse canvases', h('span', { html: icon('arrow-right', 15) }))),
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
    h('main#main.app-main',
      h('section.app-welcome',
        h('div.app-welcome-copy', h('p.eyebrow', 'Your creative space'), h('h1', 'Good ideas\nstart somewhere.'),
          h('p', 'Make that somewhere yours.'),
          h('button.btn.btn-primary.btn-lg', { type: 'button', onclick: () => openNewDesignDialog(ctx) }, h('span', { html: icon('plus', 17) }), 'New design')),
        h('div.app-welcome-art', { 'aria-hidden': 'true' },
          h('div.welcome-paper.paper-back'), h('div.welcome-paper.paper-front', h('span', 'SLATTE / STUDIO'), h('i'), h('b'), h('em')),
          h('span.welcome-spark.spark-one', '✳'), h('span.welcome-spark.spark-two', '✳'))),
      projectSection,
      h('section.app-templates#templates', h('div.app-section-head', h('div', h('p.eyebrow', 'Start with a format'), h('h2', 'Find your canvas'), h('p.section-note', 'A good fit for every idea.')),
        h('button.btn', { type: 'button', onclick: () => openNewDesignDialog(ctx) }, 'Custom size')),
      h('div.app-template-groups', presetGroups((preset, button) => {
        button.disabled = true;
        createProject({ preset: preset.id, name: preset.name }).then((id) => openEditor(id)).catch((err) => {
          button.disabled = false;
          toast(describeError(err, 'Could not create the project.'), { kind: 'error' });
        });
      })))),
    h('footer.footer', h('span', `© ${new Date().getFullYear()} Slatte`), h('span.muted', 'Your projects stay on this device.')));
  ctx.outlet.append(root);
  loadProjects();
  return { destroy() { disposer.dispose(); urls.forEach((url) => URL.revokeObjectURL(url)); } };
}
