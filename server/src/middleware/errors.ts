import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors.js';
import { config } from '../config.js';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return res.status(400).json({ error: { code: 'validation_error', message: details[0]?.message ?? 'Invalid input.', details } });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  const anyErr = err as { type?: string; status?: number };
  if (anyErr?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'bad_json', message: 'Request body is not valid JSON.' } });
  }
  if (anyErr?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'too_large', message: 'Request body too large.' } });
  }
  // Unknown error: log server-side, never leak internals (stack traces, SQL) to the client.
  if (!config.isTest) console.error(`[${req.method} ${req.path}]`, err);
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong on our side. Please try again.' } });
}
