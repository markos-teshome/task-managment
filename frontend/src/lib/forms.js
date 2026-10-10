import { z } from 'zod';

/** Client-side rules mirror the API's, so users see problems before submitting. The API re-validates. */
export const rules = {
  email: z.string().trim().min(1, 'Enter your email address').email('Enter a valid email address'),
  password: z
    .string()
    .min(8, 'Use at least 8 characters')
    .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Include at least one letter and one number'),
  name: z.string().trim().min(1, 'Required').max(60, 'Too long'),
  // Same rules as the API: spaces collapsed, 2–80 characters, letters or numbers, no control characters or < >.
  organizationName: z
    .string()
    .transform((v) => v.trim().replace(/\s+/g, ' '))
    .pipe(
      z
        .string()
        .min(2, 'Organization name is too short')
        .max(80, 'Organization name is too long')
        .refine((v) => /[\p{L}\p{N}]/u.test(v), 'Use letters or numbers')
        .refine((v) => !/[\p{Cc}<>]/u.test(v), 'Remove the < > characters'),
    ),
};

/** Copies 422 field errors from the API onto react-hook-form fields. Returns true if any matched. */
export function applyServerErrors(form, err) {
  const fields = err?.fieldErrors ?? {};
  let matched = false;
  for (const [field, message] of Object.entries(fields)) {
    if (field in form.getValues()) {
      form.setError(field, { message });
      matched = true;
    }
  }
  return matched;
}

/** "" → null for optional fields sent to the API. */
export const emptyToNull = (v) => (v === '' || v === undefined ? null : v);
