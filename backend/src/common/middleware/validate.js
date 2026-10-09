import { Errors } from '../errors/AppError.js';

/**
 * Validates body/query/params with Zod and exposes the parsed values on `req.valid`.
 * Handlers read only from `req.valid`, so unvalidated input never reaches a service.
 * Body schemas are `.strict()`, which rejects unknown fields (mass-assignment protection:
 * a client cannot sneak in `organizationId`, `roleId`, `status`, ... where they are not allowed).
 */
export const validate = (schemas) => (req, _res, next) => {
  req.valid = req.valid ?? {};
  const details = [];

  for (const part of ['params', 'query', 'body']) {
    if (!schemas[part]) continue;
    const result = schemas[part].safeParse(req[part] ?? {});
    if (result.success) {
      req.valid[part] = result.data;
    } else {
      for (const issue of result.error.issues) {
        details.push({
          field: issue.path.join('.') || part,
          message: issue.code === 'unrecognized_keys' ? `Unknown field(s): ${issue.keys.join(', ')}` : issue.message,
        });
      }
    }
  }

  if (details.length) {
    // A malformed route id is indistinguishable from a missing resource.
    if (details.every((d) => schemas.params && Object.keys(schemas.params.shape ?? {}).includes(d.field))) {
      return next(Errors.notFound());
    }
    return next(Errors.validation(details));
  }
  next();
};
