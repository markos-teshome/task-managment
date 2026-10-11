import { queryClient } from '../lib/query.js';
import { api } from '../lib/api.js';

/**
 * Warm-up on intent (hover / keyboard focus), so a click shows the next page at once:
 *  - route code: the page's chunk is fetched before navigation (Vite shares it with the router's lazy import);
 *  - data: a project or task is fetched into the cache, used by the page or drawer if still fresh.
 * Both are cheap no-ops when already loaded.
 */
const ROUTES = {
  '/my-work': () => import('../features/tasks/MyWorkPage.jsx'),
  '/tasks': () => import('../features/tasks/TasksPage.jsx'),
  '/projects': () => import('../features/projects/ProjectsPage.jsx'),
  '/team': () => import('../features/team/TeamPage.jsx'),
  '/branches': () => import('../features/branches/BranchesPage.jsx'),
  '/roles': () => import('../features/roles/RolesPage.jsx'),
  '/activity': () => import('../features/activity/ActivityPage.jsx'),
  '/billing': () => import('../features/billing/BillingPage.jsx'),
  '/notifications': () => import('../features/notifications/NotificationsPage.jsx'),
  '/settings': () => import('../features/settings/SettingsPage.jsx'),
  '/': () => import('../features/dashboard/DashboardPage.jsx'),
};
const started = new Set();

export function preloadRoute(path) {
  const load = ROUTES[path];
  if (!load || started.has(path)) return;
  started.add(path);
  load().catch(() => started.delete(path)); // offline: try again next time
}

const STALE = 30_000;
export const prefetchProject = (id) => {
  if (!started.has('project')) {
    started.add('project');
    import('../features/projects/ProjectDetailPage.jsx').catch(() => started.delete('project'));
  }
  return queryClient.prefetchQuery({ queryKey: ['project', id], queryFn: () => api.get(`/projects/${id}`), staleTime: STALE });
};
export const prefetchTask = (id) => queryClient.prefetchQuery({ queryKey: ['task', id], queryFn: () => api.get(`/tasks/${id}`), staleTime: STALE });

/** Props for an element that should warm something up when the person shows intent. */
export const onIntent = (fn) => ({ onPointerEnter: fn, onFocus: fn });
