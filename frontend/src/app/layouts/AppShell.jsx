import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation, useSearchParams } from 'react-router';
import * as RD from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useAuth } from '../../features/auth/AuthProvider.jsx';
import { Sidebar, SidebarNav } from './Sidebar.jsx';
import { Topbar } from './Topbar.jsx';
import { SearchDialog } from './SearchDialog.jsx';
import { Logo } from '../../components/brand/Logo.jsx';
import { PageLoader } from '../../components/feedback/PageLoader.jsx';
import { TaskDrawer } from '../../features/tasks/TaskDrawer.jsx';
import { filterNav, PLATFORM_NAV, WORKSPACE_NAV } from '../navigation.js';

const COLLAPSE_KEY = 'tf.sidebarCollapsed';
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * One shell for every signed-in page:
 *  ≥1024px  navy sidebar (collapsible) + top bar
 *  <1024px  top bar with a menu button that opens the navigation drawer
 * The task drawer is hosted here so any page can open a task with ?task=<id>.
 */
export function AppShell({ platform = false }) {
  const { canAny, workspace } = useAuth();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const groups = filterNav(platform ? PLATFORM_NAV : WORKSPACE_NAV, { canAny, workspace });
  const taskId = params.get('task');

  useEffect(() => setNavOpen(false), [location.pathname]);

  useEffect(() => {
    if (platform) return undefined;
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [platform]);

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* storage unavailable — keep in memory */
      }
      return !c;
    });

  const closeTask = () =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('task');
      return next;
    });

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only z-50 rounded bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:left-2 focus:top-2">
        Skip to content
      </a>
      <Sidebar groups={groups} collapsed={collapsed} onToggle={toggleCollapsed} platform={platform} />

      <RD.Root open={navOpen} onOpenChange={setNavOpen}>
        <RD.Portal>
          <RD.Overlay className="fixed inset-0 z-50 bg-ink/40 data-[state=open]:animate-fade-in lg:hidden" />
          <RD.Content className="fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col bg-brand-800 data-[state=open]:animate-slide-in-left lg:hidden">
            <RD.Title className="sr-only">Navigation</RD.Title>
            <RD.Description className="sr-only">Main navigation</RD.Description>
            <div className="flex h-14 items-center justify-between px-4">
              <Logo inverted />
              <RD.Close className="inline-flex h-10 w-10 items-center justify-center rounded-md text-brand-100 hover:bg-white/10" aria-label="Close navigation">
                <X size={18} />
              </RD.Close>
            </div>
            <SidebarNav groups={groups} onNavigate={() => setNavOpen(false)} />
          </RD.Content>
        </RD.Portal>
      </RD.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar platform={platform} onOpenNav={() => setNavOpen(true)} onOpenSearch={() => setSearchOpen(true)} showSearch={!platform && !!workspace} />
        <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-4 sm:px-6 sm:py-5">
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      {!platform && <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />}
      {!platform && workspace && <TaskDrawer taskId={taskId} onClose={closeTask} />}
    </div>
  );
}
