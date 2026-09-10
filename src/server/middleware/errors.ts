import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}
export function databaseError(error: { code?: string }): never {
  if (error.code === '42501') throw new HttpError(403, 'ACCESS_DENIED');
  if (error.code === 'P0002') throw new HttpError(404, 'NOT_FOUND');
  if (error.code?.startsWith('23') || error.code === '40001' || error.code === '40P01') throw new HttpError(409, 'INTEGRITY_CONFLICT');
  if (error.code?.startsWith('22')) throw new HttpError(400, 'INVALID_INPUT');
  throw new HttpError(503, 'DATABASE_UNAVAILABLE');
}
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof ZodError) { res.status(400).json({ error: 'INVALID_INPUT' }); return; }
  if (error instanceof HttpError) { res.status(error.status).json({ error: error.code }); return; }
  if (typeof error === 'object' && error !== null && 'type' in error) {
    if (error.type === 'entity.parse.failed') { res.status(400).json({ error: 'INVALID_JSON' }); return; }
    if (error.type === 'entity.too.large') { res.status(413).json({ error: 'PAYLOAD_TOO_LARGE' }); return; }
  }
  // Deliberately no raw error, request, body, key, JWT or SDK response logging.
  res.status(500).json({ error: 'INTERNAL_ERROR' });
};
