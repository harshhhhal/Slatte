/**
 * A tiny History API router. Routes map a path pattern to a view factory:
 *   { path: '/editor/:projectId', view: (ctx) => ({ destroy() {} }) }
 * Views mount themselves into `outlet` and return an object with `destroy()`.
 */
export class Router {
  constructor(routes, outlet, notFound) {
    this.routes = routes.map((r) => ({ ...r, ...compile(r.path) }));
    this.outlet = outlet;
    this.notFound = notFound;
    this.current = null;
    this._onPop = () => this.resolve();
    this._onClick = (e) => this._handleClick(e);
  }

  start() {
    window.addEventListener('popstate', this._onPop);
    document.addEventListener('click', this._onClick);
    this.resolve();
  }

  stop() {
    window.removeEventListener('popstate', this._onPop);
    document.removeEventListener('click', this._onClick);
    this._teardown();
  }

  navigate(path, { replace = false } = {}) {
    if (path === location.pathname + location.search) {
      this.resolve();
      return;
    }
    if (replace) history.replaceState({}, '', path);
    else history.pushState({}, '', path);
    this.resolve();
  }

  _handleClick(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[data-link]');
    if (!a) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    e.preventDefault();
    this.navigate(url.pathname + url.search + url.hash);
  }

  match(pathname) {
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        return { route: r, params };
      }
    }
    return null;
  }

  _teardown() {
    if (this.current && this.current.view && this.current.view.destroy) {
      try {
        this.current.view.destroy();
      } catch (err) {
        console.error('[slatte] view teardown failed', err);
      }
    }
    this.outlet.replaceChildren();
    this.current = null;
  }

  async resolve() {
    const token = Symbol('nav');
    this._token = token;
    const pathname = location.pathname.replace(/\/+$/, '') || '/';
    const hit = this.match(pathname);
    this._teardown();
    window.scrollTo(0, 0);
    const ctx = { router: this, params: hit ? hit.params : {}, outlet: this.outlet, path: pathname };
    const factory = hit ? hit.route.view : this.notFound;
    document.title = hit && hit.route.title ? hit.route.title : 'Slatte';
    const view = await factory(ctx);
    if (this._token !== token) {
      // A newer navigation happened while this view was loading.
      if (view && view.destroy) view.destroy();
      return;
    }
    this.current = { view, hit };
  }
}

function compile(path) {
  const keys = [];
  const src = path
    .replace(/\/+$/, '')
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { re: new RegExp(`^${src || '/'}$`), keys };
}
