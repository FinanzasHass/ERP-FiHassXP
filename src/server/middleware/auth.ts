import type { RequestHandler, Request } from 'express';
import type { Authentication } from '../services/authentication.js';
import type { SessionRepository } from '../repositories/session-repository.js';
import { hasPermission, type Actor } from '../services/permissions.js';
import { HttpError } from './errors.js';
declare global { namespace Express { interface Request { actor?: Actor } } }
export function getActor(req: Request): Actor {
  if (!req.actor) throw new HttpError(401, 'AUTHENTICATION_REQUIRED');
  return req.actor;
}
export async function authenticate(token: string, auth: Authentication, repository: (token: string) => SessionRepository): Promise<Actor> {
  const identity = await auth.verify(token);
  const db = repository(token);
  const profile = await db.profile(identity.id);
  if (!profile || profile.status !== 'active') throw new HttpError(403, 'PROFILE_DISABLED');
  return { ...identity, token, db, profile };
}
export function requireAuth(auth: Authentication, repository: (token: string) => SessionRepository): RequestHandler {
  return async (req, _res, next) => {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ') || header.length > 16384) throw new HttpError(401, 'AUTHENTICATION_REQUIRED');
    req.actor = await authenticate(header.slice(7), auth, repository);
    next();
  };
}
export function requirePermission(code: string, context?: (req: Request) => string | null): RequestHandler {
  return async (req, _res, next) => {
    const actor = getActor(req);
    if (!await hasPermission(actor, actor.id, code, context?.(req) ?? null)) throw new HttpError(403, 'ACCESS_DENIED');
    next();
  };
}
