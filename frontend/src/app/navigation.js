import {
  Activity, Building2, CreditCard, FolderKanban, Gauge, LayoutDashboard, ListChecks, Receipt, Settings, ShieldCheck, SquareCheck, Users, Wallet,
} from 'lucide-react';

/**
 * Navigation, grouped by purpose. Each item declares the permissions that make it useful;
 * items the user cannot use are not shown (the API still enforces access on its own).
 * `any`: at least one permission required. No `any`: everyone in the workspace.
 */
export const WORKSPACE_NAV = [
  {
    label: 'Workspace',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/my-work', label: 'My Work', icon: SquareCheck, any: ['TASK_VIEW'] },
      { to: '/projects', label: 'Projects', icon: FolderKanban, any: ['PROJECT_VIEW', 'PROJECT_VIEW_ALL'] },
      { to: '/tasks', label: 'Tasks', icon: ListChecks, any: ['TASK_VIEW'] },
    ],
  },
  {
    label: 'Organization',
    items: [
      { to: '/team', label: 'Team', icon: Users, any: ['USER_VIEW'] },
      { to: '/roles', label: 'Roles & permissions', icon: ShieldCheck, any: ['ROLE_VIEW'] },
      { to: '/activity', label: 'Activity', icon: Activity, any: ['ACTIVITY_VIEW'] },
    ],
  },
  {
    label: 'Account',
    items: [
      { to: '/billing', label: 'Plan & billing', icon: CreditCard, any: ['SUBSCRIPTION_VIEW', 'BILLING_VIEW'] },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export const PLATFORM_NAV = [
  {
    label: 'Platform',
    items: [
      { to: '/platform', label: 'Overview', icon: Gauge, end: true },
      { to: '/platform/organizations', label: 'Organizations', icon: Building2 },
      { to: '/platform/plans', label: 'Plans & pricing', icon: Wallet },
      { to: '/platform/payments', label: 'Payments', icon: Receipt },
    ],
  },
];

export const filterNav = (groups, canAny) =>
  groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.any || canAny(...i.any)) }))
    .filter((g) => g.items.length);
