/** Consistent success envelope: { success: true, data, meta? } */
export const ok = (res, data, meta, status = 200) =>
  res.status(status).json(meta ? { success: true, data, meta } : { success: true, data });

export const created = (res, data) => ok(res, data, undefined, 201);

/**
 * Build pagination arguments + response meta from validated `page` / `pageSize` query values.
 * Callers count with the same `where` as the page query (same tenant and permission scope).
 */
export const paginate = ({ page, pageSize }) => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
  meta: (total) => {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return { page, pageSize, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 };
  },
});

/**
 * Makes an ordering total by appending the primary key, so rows with equal sort values (same due date,
 * same timestamp, same name) keep one fixed order across pages: no repeats, no gaps.
 */
export const stableOrder = (orderBy, direction = 'asc') => [...[orderBy].flat(), { id: direction }];

export const fullName = (user) => (user ? `${user.firstName} ${user.lastName}`.trim() : null);

/** Slug for organization URLs/identifiers. */
export const slugify = (value) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'org';

/** Calendar-day helpers (task/project dates are DATE columns, i.e. UTC midnight). */
export const startOfTodayUtc = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};
export const addDays = (date, days) => new Date(date.getTime() + days * 86_400_000);
