/**
 * An expected, user-facing error. Anything that is not an AppError is treated as an
 * internal failure and its details are never sent to the client.
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const Errors = {
  badRequest: (message = 'The request is invalid.', code = 'BAD_REQUEST') => new AppError(400, code, message),
  validation: (details) =>
    new AppError(422, 'VALIDATION_ERROR', 'Some fields are invalid. Please check and try again.', details),
  unauthenticated: (message = 'Please sign in to continue.', code = 'UNAUTHENTICATED') =>
    new AppError(401, code, message),
  forbidden: (message = 'You do not have permission to perform this action.', code = 'FORBIDDEN') =>
    new AppError(403, code, message),
  // Used for cross-tenant and invisible resources alike, so IDs cannot be probed.
  notFound: (resource = 'Resource') => new AppError(404, 'NOT_FOUND', `${resource} not found.`),
  conflict: (message, code = 'CONFLICT') => new AppError(409, code, message),
  planLimit: (code, message) => new AppError(402, code, message),
  tooMany: (message = 'Too many attempts. Please wait a moment and try again.', code = 'RATE_LIMITED') =>
    new AppError(429, code, message),
};
