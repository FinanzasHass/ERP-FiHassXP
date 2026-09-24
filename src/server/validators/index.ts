import { z } from 'zod';
export const uuid = z.uuid();
export const companyContext = z.object({ company_id: uuid.optional() }).strict();
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  company_id: uuid.optional(), user_id: uuid.optional(),
  category: z.enum(['authentication', 'security', 'administration', 'finance', 'system']).optional(),
  area_id:uuid.optional(),position_id:uuid.optional(),status:z.enum(['active','inactive','blocked']).optional(),
  from:z.iso.date().optional(),to:z.iso.date().optional(),action:z.string().max(100).optional(),entity_type:z.string().max(100).optional(),entity_id:z.string().max(100).optional(),
  search:z.string().max(100).regex(/^[\p{L}\p{N}\s@_.-]*$/u).optional(),code:z.string().max(50).optional(),name:z.string().max(150).optional(),category_id:uuid.optional(),active:z.enum(['true','false']).optional(),project_id:uuid.optional(),
}).strict();
const name = z.string().trim().min(1).max(150);
const description = z.string().max(2000).nullable().optional();
const organization = {
  area_id: uuid.nullable().optional(), position_id: uuid.nullable().optional(), manager_id: uuid.nullable().optional(),
};
export const profileCreate = z.object({
  email: z.email().max(254).transform(v => v.toLowerCase()),
  full_name: z.string().trim().min(1).max(200),
  username: z.string().regex(/^[A-Za-z0-9_.-]{3,50}$/),
  status: z.enum(['active', 'inactive', 'blocked']).default('inactive'), ...organization,
}).strict();
export const profileUpdate = profileCreate.omit({ email: true }).partial().refine(v => Object.keys(v).length > 0);
export const entitySchemas = {
  area: z.object({ name, code: z.string().regex(/^[A-Za-z0-9_-]{2,50}$/), description, active: z.boolean().optional() }).strict(),
  position: z.object({ name, area_id: uuid.nullable().optional(), description, hierarchy_level: z.number().int().min(0).nullable().optional(), active: z.boolean().optional() }).strict(),
  company: z.object({ legal_name: z.string().trim().min(1).max(200), code: z.string().regex(/^[A-Za-z0-9_-]{2,50}$/), tax_id: z.string().trim().min(1).max(30), country_code: z.string().regex(/^[A-Z]{2}$/), active: z.boolean().optional() }).strict(),
  role: z.object({ name, code: z.string().regex(/^[a-z][a-z0-9_]{1,49}$/), description, active: z.boolean().optional() }).strict(),
};
export const assignment = z.object({ role_id: uuid, company_id: uuid.nullable(), assign: z.boolean() }).strict();
export const membership = z.object({ company_id: uuid, active: z.boolean() }).strict();
export const override = z.object({ permission_id: uuid, company_id: uuid.nullable(), effect: z.enum(['allow', 'deny', 'inherit']), reason: z.string().trim().min(1).max(2000) }).strict();
export const rolePermissions = z.object({ permission_ids: z.array(uuid).max(500) }).strict();
export const settings = z.object({ system_name: z.string().trim().min(1).max(100).optional(), timezone: z.string().min(1).max(100).optional() }).strict().refine(v => Object.keys(v).length > 0);
export const login = z.object({ email: z.string().trim().min(3).max(254), password: z.string().min(1).max(1024) }).strict();
export const refresh = z.object({ refresh_token: z.string().min(1).max(8192) }).strict();
export const email = z.object({ email: z.email().max(254) }).strict();
export const password = z.object({ password: z.string().min(12).max(128) }).strict();
export const temporaryPassword = z.object({ password: z.string().min(12).max(128) }).strict();
export const userCreate = profileCreate.extend({ temporary_password: z.string().min(12).max(128) }).strict();
export const verifyOtp = z.object({ token_hash: z.string().min(1).max(1024), type: z.enum(['invite', 'recovery']) }).strict();
