/**
 * Permission catalog — the single source of truth. Synchronised into the `permissions`
 * table on startup, so adding a permission is a code change, never a manual DB edit.
 */
export const PERMISSION_CATALOG = [
  { key: 'ORG_MANAGE', group: 'Organization', label: 'Manage', description: 'Edit organization settings' },

  { key: 'USER_VIEW', group: 'Team', label: 'View', description: 'See team members' },
  { key: 'USER_CREATE', group: 'Team', label: 'Invite', description: 'Invite new members' },
  { key: 'USER_UPDATE', group: 'Team', label: 'Edit', description: "Change members' roles and status" },
  { key: 'USER_DELETE', group: 'Team', label: 'Remove', description: 'Remove members from the organization' },

  { key: 'ROLE_VIEW', group: 'Roles', label: 'View', description: 'See roles and their permissions' },
  { key: 'ROLE_CREATE', group: 'Roles', label: 'Create', description: 'Create custom roles' },
  { key: 'ROLE_UPDATE', group: 'Roles', label: 'Edit', description: 'Change role permissions' },
  { key: 'ROLE_DELETE', group: 'Roles', label: 'Delete', description: 'Delete custom roles' },

  { key: 'PROJECT_VIEW', group: 'Projects', label: 'View own', description: 'See projects they are a member of' },
  { key: 'PROJECT_VIEW_ALL', group: 'Projects', label: 'View all', description: 'See every project in the organization' },
  { key: 'PROJECT_CREATE', group: 'Projects', label: 'Create', description: 'Create projects' },
  { key: 'PROJECT_UPDATE', group: 'Projects', label: 'Edit', description: 'Edit projects and their team' },
  { key: 'PROJECT_DELETE', group: 'Projects', label: 'Delete', description: 'Delete projects permanently' },

  { key: 'TASK_VIEW', group: 'Tasks', label: 'View', description: 'See tasks in visible projects' },
  { key: 'TASK_CREATE', group: 'Tasks', label: 'Create', description: 'Create tasks' },
  { key: 'TASK_UPDATE', group: 'Tasks', label: 'Edit', description: 'Edit any task in visible projects' },
  { key: 'TASK_DELETE', group: 'Tasks', label: 'Delete', description: 'Delete tasks' },
  { key: 'TASK_ASSIGN', group: 'Tasks', label: 'Assign', description: 'Assign tasks to members' },

  { key: 'SUBSCRIPTION_VIEW', group: 'Subscription', label: 'View', description: 'See plan and usage' },
  { key: 'SUBSCRIPTION_MANAGE', group: 'Subscription', label: 'Manage', description: 'Change or cancel the plan' },

  { key: 'BILLING_VIEW', group: 'Billing', label: 'View', description: 'See payment history' },
  { key: 'BILLING_MANAGE', group: 'Billing', label: 'Manage', description: 'Make payments' },

  { key: 'ACTIVITY_VIEW', group: 'Activity', label: 'View', description: 'See the activity history' },
];

export const PERMISSIONS = Object.fromEntries(PERMISSION_CATALOG.map((p) => [p.key, p.key]));
export const ALL_PERMISSION_KEYS = PERMISSION_CATALOG.map((p) => p.key);

const P = PERMISSIONS;

/**
 * Default roles created for every new organization.
 * Boundaries follow the brief: employees never touch billing, managers never touch the
 * subscription, admins manage people but have no owner authority (billing, plan, roles, org).
 */
export const SYSTEM_ROLES = [
  {
    key: 'OWNER',
    name: 'Owner',
    description: 'Full control of the organization, including billing and roles.',
    permissions: ALL_PERMISSION_KEYS,
  },
  {
    key: 'ADMIN',
    name: 'Admin',
    description: 'Manages people and work. No billing, plan or role authority.',
    permissions: [
      P.USER_VIEW, P.USER_CREATE, P.USER_UPDATE, P.USER_DELETE,
      P.ROLE_VIEW,
      P.PROJECT_VIEW, P.PROJECT_VIEW_ALL, P.PROJECT_CREATE, P.PROJECT_UPDATE, P.PROJECT_DELETE,
      P.TASK_VIEW, P.TASK_CREATE, P.TASK_UPDATE, P.TASK_DELETE, P.TASK_ASSIGN,
      P.SUBSCRIPTION_VIEW, P.BILLING_VIEW,
      P.ACTIVITY_VIEW,
    ],
  },
  {
    key: 'MANAGER',
    name: 'Manager',
    description: 'Plans projects, assigns and monitors tasks.',
    permissions: [
      P.USER_VIEW,
      P.PROJECT_VIEW, P.PROJECT_VIEW_ALL, P.PROJECT_CREATE, P.PROJECT_UPDATE,
      P.TASK_VIEW, P.TASK_CREATE, P.TASK_UPDATE, P.TASK_DELETE, P.TASK_ASSIGN,
      P.ACTIVITY_VIEW,
    ],
  },
  {
    key: 'EMPLOYEE',
    name: 'Employee',
    description: 'Works on assigned tasks in their projects.',
    permissions: [P.PROJECT_VIEW, P.TASK_VIEW],
  },
];

export const OWNER_ROLE_KEY = 'OWNER';
