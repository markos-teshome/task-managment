import { Prisma } from '@prisma/client';
import { AppError, Errors } from '../errors/AppError.js';
import { recordInternalError } from '../../lib/errorLog.js';

export function notFoundHandler(req, _res, next) {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `Route ${req.method} ${req.path} does not exist.`));
}

/** Translates known database errors into safe API errors; never forwards Prisma/SQL text. */
function fromPrisma(err) {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return Errors.conflict('A record with these details already exists.');
    if (err.code === 'P2025') return Errors.notFound();
    if (err.code === 'P2003') return Errors.badRequest('A referenced record does not exist.');
  }
  return null;
}

export function errorHandler(err, req, res, _next) {
  let error = err instanceof AppError ? err : fromPrisma(err);

  if (!error && err?.type === 'entity.parse.failed') error = Errors.badRequest('Malformed JSON body.');
  if (!error && err?.type === 'entity.too.large') error = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request is too large.');

  if (!error) {
    // Unexpected: log full detail server-side, return a generic message.
    req.log?.error({ err }, 'Unhandled error');
    // Route pattern (e.g. /api/v1/projects/:id), not the URL: ids and query strings stay out of the record.
    recordInternalError({ method: req.method, route: `${req.baseUrl}${req.route?.path ?? ''}`, name: err?.name, requestId: req.id });
    error = new AppError(500, 'INTERNAL_ERROR', 'Something went wrong on our side. Please try again.');
  }

  res.status(error.status).json({
    success: false,
    error: { code: error.code, message: error.message, ...(error.details && { details: error.details }) },
  });
}
