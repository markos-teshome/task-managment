import {
  Activity, Building2, CreditCard, FolderKanban, Gauge, HeartPulse, LayoutDashboard, ListChecks, MapPin, Receipt, Repeat, ScrollText,
  Settings, ShieldCheck, SquareCheck, Users, Wallet,
} from 'lucide-react';

/**
 * Navigation, grouped by purpose. Each item declares what makes it useful; items the user cannot use are
 * not shown (the API still enforces access on its own).
 *  `any`:  at least one of these permissions.
 *  `when`: a check on the signed-in workspace (e.g. people who manage a branch without BRANCH_VIEW).
 *  Neither: everyone in the workspace.
 */
export const WORKSPACE_NAV = [
  {
    label: 'Workspace',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/my-work', label: 'My Work', icon: SquareCheck, any: ['TASK_VIEW'] },
      { to: '/projects', label: 'Projects', icon: FolderKanban, any: ['PROJECT_VIEW', 'PROJECT_VIEW_ALL'] },
      { to: '/tasks', label: 'Tasks', icon: ListChecks, any: ['TASK_VIEW'] },
    ],
  },
  {
    label: 'Organization',
    items: [
      { to: '/team', label: 'Team', icon: Users, any: ['USER_VIEW'] },
      {
        to: '/branches',
        label: 'Branches',
        icon: MapPin,
        when: ({ canAny, workspace }) => canAny('BRANCH_VIEW', 'BRANCH_MANAGE') || workspace?.myBranches?.length > 0,
      },
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

/** The platform console has its own navigation and identity; nothing here reaches tenant data. */
export const PLATFORM_NAV = [
  {
    label: 'Platform',
    items: [
      { to: '/platform', label: 'Overview', icon: Gauge, end: true },
      { to: '/platform/organizations', label: 'Organizations', icon: Building2 },
      { to: '/platform/subscriptions', label: 'Subscriptions', icon: Repeat },
      { to: '/platform/payments', label: 'Payments', icon: Receipt },
      { to: '/platform/plans', label: 'Plans', icon: Wallet },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/platform/activity', label: 'Admin activity', icon: ScrollText },
      { to: '/platform/health', label: 'System health', icon: HeartPulse },
    ],
  },
];

export const filterNav = (groups, auth) =>
  groups
    .map((g) => ({ ...g, items: g.items.filter((i) => (i.any ? auth.canAny(...i.any) : true) && (i.when ? i.when(auth) : true)) }))
    .filter((g) => g.items.length);
