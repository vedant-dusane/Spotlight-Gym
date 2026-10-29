import { badRequest } from '../errors.js';

/** Validates req[source] with a zod schema and replaces it with the parsed (typed, trimmed) value. */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source] ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.') || source, message: i.message }));
    return next(badRequest(details[0]?.message ? `Invalid input: ${details[0].message}` : 'Invalid input.', details));
  }
  req[source] = result.data;
  return next();
};
