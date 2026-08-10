// Error taxonomy (design §5.5). Note the deliberate 200s: staleness and
// unresolvability are normal states of a periodically-refreshed public dataset,
// not errors — modelling them as errors pushes clients into exception handling
// for the common case.

import type { Context } from 'hono';

export interface ApiError {
  code: string;
  message: string;
  fields?: Record<string, string>;
}

export function validationError(c: Context, fields: Record<string, string>) {
  return c.json({ error: { code: 'validation', message: 'Invalid request', fields } }, 400);
}

export function notFound(c: Context, message = 'Not found', suggestions: unknown[] = []) {
  return c.json({ error: { code: 'not_found', message }, suggestions }, 404);
}

export function rateLimited(c: Context, retryAfterSeconds: number) {
  c.header('Retry-After', String(retryAfterSeconds));
  return c.json({ error: { code: 'rate_limited', message: 'Too many requests' } }, 429);
}

export function internalError(c: Context, correlationId: string) {
  return c.json(
    { error: { code: 'internal', message: 'Something went wrong', correlationId } },
    500,
  );
}
