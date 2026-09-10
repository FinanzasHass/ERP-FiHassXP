import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { RuntimeConfig } from '../config/env.js';
import type { Authentication, Tokens } from '../services/authentication.js';
import type { PrivilegedAuth } from '../integrations/supabase/auth-admin.js';
import type { SessionRepository } from '../repositories/session-repository.js';
import { authenticate, getActor, requireAuth, requirePermission } from '../middleware/auth.js';
import * as admin from '../controllers/admin.js';
import * as v from '../validators/index.js';
import { HttpError } from '../middleware/errors.js';
import { z } from 'zod';
import { mastersRouter } from './masters.js';
export interface Dependencies {
  auth: Authentication; privileged: PrivilegedAuth;
  repository: (token: string) => SessionRepository;
}
export function apiRouter(_config: RuntimeConfig, deps: Dependencies) {
  const router = Router();
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'AUTH_RATE_LIMIT' } });
  const authenticated = requireAuth(deps.auth, deps.repository);
  const completeLogin = async (tokens: Tokens, ip: string) => {
    const actor = await authenticate(tokens.access_token, deps.auth, deps.repository);
    await deps.privileged.recordVerifiedLogin(actor.id, actor.sessionId, ip);
    return tokens;
  };
  router.post('/auth/login', authLimiter, async (req, res) => {
    const body = v.login.parse(req.body);
    const email=body.email.includes('@')?z.email().parse(body.email):await deps.privileged.resolveUsername?.(body.email);
    // Unknown usernames follow the same password-provider path and never expose email resolution.
    res.json(await completeLogin(await deps.auth.login(email??'unknown-account@invalid.invalid', body.password), req.ip ?? '127.0.0.1'));
  });
  router.post('/auth/refresh', authLimiter, async (req, res) => {
    const tokens = await deps.auth.refresh(v.refresh.parse(req.body).refresh_token);
    await authenticate(tokens.access_token, deps.auth, deps.repository);
    res.json(tokens);
  });
  router.post('/auth/recover', authLimiter, async (req, res) => {
    await deps.auth.recover(v.email.parse(req.body).email);
    res.status(202).json({ message: 'Si la cuenta existe, recibirá instrucciones.' });
  });
  router.post('/auth/verify', authLimiter, async (req, res) => {
    const body = v.verifyOtp.parse(req.body);
    res.json(await completeLogin(await deps.auth.verifyOtp(body.token_hash, body.type), req.ip ?? '127.0.0.1'));
  });
  router.use(authenticated);
  router.use(mastersRouter());
  router.get('/auth/workspace',async(req,res)=>res.json(await getActor(req).db.rpc('my_workspace',{})));
  router.get('/auth/me', async (req, res) => {
    const { company_id } = v.companyContext.parse(req.query);
    const actor = getActor(req);
    if (company_id && !await actor.db.rpc('has_company_access', { target_company: company_id })) throw new HttpError(403, 'COMPANY_ACCESS_DENIED');
    res.json({ profile: actor.profile, company_id: company_id ?? null, permissions: await actor.db.rpc('effective_permissions', { company_id: company_id ?? null }) });
  });
  router.post('/auth/logout', async (req, res) => { await deps.privileged.logout(getActor(req).token); res.sendStatus(204); });
  router.post('/auth/password', authLimiter, async (req, res) => { await deps.auth.updatePassword(getActor(req).token, v.password.parse(req.body).password); res.sendStatus(204); });
  router.get('/auth/companies', async (req, res) => {
    const actor = getActor(req);
    res.json(await actor.db.list('user_companies', v.pageQuery.parse(req.query), { user_id: actor.id, active: 'true' }));
  });
  router.get('/users', requirePermission('user.view'), admin.list('profiles'));
  router.post('/users', requirePermission('user.create'), admin.createUser(deps.privileged));
  router.get('/users/:id', requirePermission('user.view'), async (req, res) => {
    const profile = await getActor(req).db.profile(v.uuid.parse(req.params.id));
    if (!profile) throw new HttpError(404, 'NOT_FOUND');
    res.json(profile);
  });
  router.patch('/users/:id', requirePermission('user.edit'), admin.updateUser);
  router.put('/users/:id/status', requirePermission('user.disable'), async (req, res) => {
    const body = z.object({ status: z.enum(['active', 'inactive', 'blocked']) }).strict().parse(req.body);
    res.json(await getActor(req).db.rpc('admin_set_profile_status', { target_user: v.uuid.parse(req.params.id), new_status: body.status }));
  });
  router.patch('/users/:id/email', requirePermission('user.edit'), admin.updateEmail(deps.privileged));
  router.get('/users/:id/roles', requirePermission('user.view'), admin.listUserRelation('user_roles'));
  router.put('/users/:id/roles', requirePermission('role.assign'), admin.setRole);
  router.get('/users/:id/companies', requirePermission('company.assign'), admin.listUserRelation('user_companies'));
  router.put('/users/:id/companies', requirePermission('company.assign'), admin.setMembership);
  router.get('/users/:id/overrides', requirePermission('permission.assign'), admin.listUserRelation('user_permission_overrides'));
  router.put('/users/:id/overrides', requirePermission('permission.assign'), admin.setOverride);
  for (const [path, kind, table] of [['areas', 'area', 'areas'], ['positions', 'position', 'positions'], ['companies', 'company', 'companies'], ['roles', 'role', 'roles']] as const) {
    router.get(`/${path}`, requirePermission(`${kind}.view`), admin.list(table));
    router.post(`/${path}`, requirePermission(`${kind}.create`), admin.saveEntity(kind));
    router.patch(`/${path}/:id`, requirePermission(`${kind}.edit`), admin.saveEntity(kind));
  }
  router.get('/permissions', requirePermission('role.view'), admin.list('permissions'));
  router.get('/roles/:id/permissions', requirePermission('role.view'), admin.readRolePermissions);
  router.put('/roles/:id/permissions', requirePermission('permission.assign'), admin.setRolePermissions);
  router.get('/audit', async (req, res, next) => {
    const query = v.pageQuery.parse(req.query);
    if (query.category === 'finance') {
      if (!query.company_id) throw new HttpError(400, 'COMPANY_CONTEXT_REQUIRED');
      return requirePermission('audit.finance_view', () => query.company_id!)(req, res, next);
    }
    return requirePermission('audit.view')(req, res, next);
  }, admin.list('audit_logs'));
  router.get('/settings', requirePermission('settings.manage'), admin.list('system_settings'));
  router.patch('/settings', requirePermission('settings.manage'), admin.updateSettings);
  return router;
}
