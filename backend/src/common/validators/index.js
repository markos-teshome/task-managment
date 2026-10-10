import { z } from 'zod';

/** Shared, reusable field validators. */
export const id = z.string().uuid({ message: 'Invalid identifier' });

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email({ message: 'Enter a valid email address' });

// bcrypt only uses the first 72 bytes, so longer passwords are rejected rather than silently truncated.
export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Password is too long')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain letters and numbers');

export const personName = z.string().trim().min(1, 'Required').max(60);

/** Spaces collapsed; must contain a letter or digit; no control characters. */
export const organizationName = z
  .string()
  .transform((v) => v.trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(2, 'Organization name is too short')
      .max(80, 'Organization name is too long')
      .refine((v) => /[\p{L}\p{N}]/u.test(v), 'Organization name must contain letters or numbers')
      .refine((v) => !/[\p{Cc}<>]/u.test(v), 'Organization name contains characters that are not allowed'),
  );

export const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** YYYY-MM-DD → Date at UTC midnight (matches DATE columns). */
export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .transform((v) => new Date(`${v}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'Invalid date');

export const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

export const searchTerm = z.string().trim().max(100).optional();

export const idParam = z.object({ id });
