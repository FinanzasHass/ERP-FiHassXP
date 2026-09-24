import type { RequestHandler } from 'express';
import { getActor } from '../middleware/auth.js';
import * as v from '../validators/index.js';
import type { PrivilegedAuth } from '../integrations/supabase/auth-admin.js';
import { provisionUser } from '../services/provisioning.js';
import { HttpError } from '../middleware/errors.js';
export const list = (table: string): RequestHandler => async (req, res) => {
  const q = v.pageQuery.parse(req.query);
  const filters: Record<string, string> = {};
  if (q.company_id) {
    if (table === 'companies') filters.id = q.company_id;
    else if (['user_roles','user_companies','user_permission_overrides','audit_logs'].includes(table)) filters.company_id = q.company_id;
    else if(table !== 'profiles') throw new HttpError(400, 'UNSUPPORTED_FILTER');
  }
  if (q.user_id) filters[table === 'profiles' ? 'id' : 'user_id'] = q.user_id;
  if (q.category && table === 'audit_logs') filters.category = q.category;
  if(table==='profiles') for(const key of ['area_id','position_id','status'] as const) if(q[key]) filters[key]=q[key];
  if(table==='audit_logs') for(const key of ['action','entity_type','entity_id'] as const) if(q[key]) filters[key]=q[key];
  res.json(await getActor(req).db.list(table, q, filters));
};
export const listUserRelation = (table: string): RequestHandler => async (req, res) => {
  const id = v.uuid.parse(req.params.id);
  const q = v.pageQuery.parse(req.query);
  const filters: Record<string, string> = { user_id: id };
  if (q.company_id) filters.company_id = q.company_id;
  res.json(await getActor(req).db.list(table, q, filters));
};
export const saveEntity = (kind: keyof typeof v.entitySchemas): RequestHandler => async (req, res) => {
  const id = req.params.id ? v.uuid.parse(req.params.id) : null;
  const schema = id ? v.entitySchemas[kind].partial() : v.entitySchemas[kind];
  const payload = schema.parse(req.body);
  if (Object.keys(payload).length === 0) throw new HttpError(400, 'INVALID_INPUT');
  res.status(id ? 200 : 201).json(await getActor(req).db.rpc('admin_save_entity', { entity_kind: kind, entity_id: id, payload }));
};
export const createUser = (privileged: PrivilegedAuth): RequestHandler => async (req, res) => {
  const key = v.uuid.parse(req.header('Idempotency-Key'));
  const actor=getActor(req);
  const {temporary_password,...profile}=v.userCreate.parse(req.body);
  const created=await provisionUser(actor, privileged, key, profile);
  await actor.db.rpc('admin_require_temporary_password',{target_user:created.id});
  await privileged.updatePassword(created.id,temporary_password);
  res.status(201).json(created);
};
export const updateUser: RequestHandler = async (req, res) => {
  res.json(await getActor(req).db.rpc('admin_update_profile', { target_user: v.uuid.parse(req.params.id), payload: v.profileUpdate.parse(req.body) }));
};
export const setRole: RequestHandler = async (req, res) => {
  const body = v.assignment.parse(req.body);
  await getActor(req).db.rpc('admin_set_user_role', { target_user: v.uuid.parse(req.params.id), target_role: body.role_id, target_company: body.company_id, assign: body.assign });
  res.sendStatus(204);
};
export const setMembership: RequestHandler = async (req, res) => {
  const body = v.membership.parse(req.body);
  await getActor(req).db.rpc('admin_set_membership', { target_user: v.uuid.parse(req.params.id), target_company: body.company_id, is_active: body.active });
  res.sendStatus(204);
};
export const setOverride: RequestHandler = async (req, res) => {
  const body = v.override.parse(req.body);
  await getActor(req).db.rpc('admin_set_override', { target_user: v.uuid.parse(req.params.id), target_permission: body.permission_id, target_company: body.company_id, new_effect: body.effect, change_reason: body.reason });
  res.sendStatus(204);
};
export const setRolePermissions: RequestHandler = async (req, res) => {
  const body = v.rolePermissions.parse(req.body);
  await getActor(req).db.rpc('admin_set_role_permissions', { target_role: v.uuid.parse(req.params.id), permission_ids: body.permission_ids });
  res.sendStatus(204);
};
export const readRolePermissions: RequestHandler = async (req, res) => {
  res.json(await getActor(req).db.list('role_permissions', v.pageQuery.parse(req.query), { role_id: v.uuid.parse(req.params.id) }));
};
export const updateSettings: RequestHandler = async (req, res) => {
  res.json(await getActor(req).db.rpc('admin_update_settings', { payload: v.settings.parse(req.body) }));
};
export const updateEmail = (privileged: PrivilegedAuth): RequestHandler => async (req, res) => {
  const id = v.uuid.parse(req.params.id);
  // User identity administration is exclusively a permission-guarded server action.
  if (id === getActor(req).id) throw new HttpError(403, 'SELF_IDENTITY_CHANGE_FORBIDDEN');
  const newEmail = v.email.parse(req.body).email.toLowerCase();
  await getActor(req).db.rpc('prepare_email_change', { target_user: id, new_email: newEmail });
  await privileged.updateEmail(id, newEmail);
  res.sendStatus(204);
};
export const setTemporaryPassword = (privileged: PrivilegedAuth): RequestHandler => async (req, res) => {
  const actor = getActor(req);
  const id = v.uuid.parse(req.params.id);
  if (id === actor.id) throw new HttpError(403, 'SELF_IDENTITY_CHANGE_FORBIDDEN');
  const { password } = v.temporaryPassword.parse(req.body);
  // Mark the one-time requirement and revoke old sessions first. Neither this
  // RPC nor audit receives the password itself.
  await actor.db.rpc('admin_require_temporary_password', { target_user: id });
  await privileged.updatePassword(id, password);
  res.sendStatus(204);
};
