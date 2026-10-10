/** Feature flags a plan can grant. Checked through the entitlement service, never inline. */
export const FEATURES = {
  DATA_EXPORT: 'DATA_EXPORT', // export tasks as CSV
};

export const FREE_PLAN_CODE = 'FREE';

/** Name of the branch every organization starts with. */
export const DEFAULT_BRANCH_NAME = 'Head Office';

/** Billing period for paid plans. Monthly only — kept deliberately simple. */
export const BILLING_PERIOD_DAYS = 30;

/**
 * Default plans inserted when missing. After that they belong to the platform owner,
 * who can change prices and limits from the platform console — startup never overwrites them.
 */
export const DEFAULT_PLANS = [
  {
    code: 'FREE',
    name: 'Free',
    description: 'For small teams getting started.',
    priceCents: 0,
    maxUsers: 3,
    maxProjects: 3,
    // Branch limits are not in the brief: assumed defaults, editable by the platform admin.
    maxBranches: 1,
    features: [],
    sortOrder: 1,
  },
  {
    code: 'PROFESSIONAL',
    name: 'Professional',
    description: 'For growing teams that need more people and projects.',
    priceCents: 1500_00,
    maxUsers: 15,
    maxProjects: 25,
    maxBranches: 5,
    features: [],
    sortOrder: 2,
  },
  {
    code: 'BUSINESS',
    name: 'Business',
    description: 'For larger organizations with no limits.',
    priceCents: 4500_00,
    maxUsers: null,
    maxProjects: null,
    maxBranches: null,
    features: [FEATURES.DATA_EXPORT],
    sortOrder: 3,
  },
];
