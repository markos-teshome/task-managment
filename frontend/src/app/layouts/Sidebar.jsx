import { NavLink, Link } from 'react-router';
import { PanelLeftClose, PanelLeftOpen, Sparkles } from 'lucide-react';
import { Logo } from '../../components/brand/Logo.jsx';
import { cn } from '../../lib/cn.js';
import { useAuth } from '../../features/auth/AuthProvider.jsx';
import { onIntent, preloadRoute } from '../preload.js';

/** Navy sidebar: structure in brand navy, the active item marked with the yellow accent. */
export function SidebarNav({ groups, collapsed = false, onNavigate }) {
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-3 [scrollbar-width:thin]">
      {groups.map((group) => (
        <div key={group.label} className="mb-4 last:mb-0">
          {collapsed ? (
            <div className="mx-2 mb-2 h-px bg-white/10" aria-hidden="true" />
          ) : (
            <p className="mb-1 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-brand-300">{group.label}</p>
          )}
          <ul className="space-y-0.5">
            {group.items.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  onClick={onNavigate}
                  {...onIntent(() => preloadRoute(to))}
                  title={collapsed ? label : undefined}
                  aria-label={collapsed ? label : undefined}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex h-10 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors lg:h-8',
                      collapsed && 'justify-center px-0',
                      isActive ? 'bg-white/10 text-white' : 'text-brand-100/80 hover:bg-white/5 hover:text-white',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-accent-500" aria-hidden="true" />}
                      <Icon size={16} className={cn('shrink-0', isActive ? 'text-accent-400' : 'text-brand-200/70 group-hover:text-brand-100')} aria-hidden="true" />
                      {!collapsed && <span className="truncate">{label}</span>}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Compact plan indicator; owners get a one-click path to upgrade when close to the limit. */
function PlanStatus({ collapsed }) {
  const { workspace, can } = useAuth();
  if (!workspace || collapsed) return null;
  const { plan, usage } = workspace;
  const atLimit = plan.maxUsers !== null && usage.users >= plan.maxUsers;
  const canSee = can('SUBSCRIPTION_VIEW');
  if (!canSee) return null;
  return (
    <Link to="/billing" className="mx-2 mb-2 block rounded-md bg-white/5 px-2.5 py-2 text-[12px] text-brand-100 transition-colors hover:bg-white/10">
      <span className="flex items-center justify-between gap-2">
        <span className="font-semibold text-white">{plan.name} plan</span>
        {atLimit && <Sparkles size={13} className="text-accent-400" aria-hidden="true" />}
      </span>
      <span className="mt-0.5 block text-brand-200">
        {usage.users}
        {plan.maxUsers !== null ? ` / ${plan.maxUsers}` : ''} members
        {atLimit && <span className="text-accent-400"> · limit reached</span>}
      </span>
    </Link>
  );
}

export function Sidebar({ groups, collapsed, onToggle, platform = false }) {
  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col bg-brand-800 transition-[width] duration-200 lg:flex',
        collapsed ? 'w-[60px]' : 'w-[232px]',
      )}
    >
      <div className={cn('flex h-14 shrink-0 items-center', collapsed ? 'justify-center' : 'px-4')}>
        <Link to={platform ? '/platform' : '/'} aria-label={collapsed ? (platform ? 'Platform overview' : 'TeamFlow overview') : undefined}>
          <Logo collapsed={collapsed} inverted />
        </Link>
      </div>
      {platform && !collapsed && (
        <p className="mx-4 -mt-1 mb-1 inline-flex w-fit items-center rounded bg-accent-500 px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.12em] text-brand-900">
          Platform console
        </p>
      )}
      <SidebarNav groups={groups} collapsed={collapsed} />
      {!platform && <PlanStatus collapsed={collapsed} />}
      <div className={cn('border-t border-white/10 p-2', collapsed && 'flex justify-center')}>
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex h-8 items-center gap-2 rounded-md px-2.5 text-[12.5px] text-brand-200 hover:bg-white/5 hover:text-white"
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          {!collapsed && 'Collapse'}
        </button>
      </div>
    </aside>
  );
}
