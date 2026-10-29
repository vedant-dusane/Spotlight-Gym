/** An error that is safe to show to the client. Everything else becomes a generic 500. */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found.`);
export const forbidden = (message = 'You do not have permission to do that.') => new AppError(403, 'FORBIDDEN', message);
export const conflict = (code, message) => new AppError(409, code, message);
export const badRequest = (message, details) => new AppError(400, 'VALIDATION_ERROR', message, details);

/** Express 4 does not catch rejected promises; this forwards them to the error handler. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
