import type { SessionRepository } from '../repositories/session-repository.js';
import type { Profile, ResourceContext } from '../../shared/contracts.js';
import { HttpError } from '../middleware/errors.js';
export type Actor = { id: string; token: string; sessionId: string; profile: Profile; db: SessionRepository };
export async function hasPermission(actor: Actor, userId: string, code: string, companyId: string | null = null): Promise<boolean> {
  if (userId !== actor.id) throw new HttpError(403, 'IDENTITY_MISMATCH');
  return actor.db.rpc<boolean>('has_permission', { permission_code: code, company_id: companyId });
}
// Contract for future persisted resources. No payment/request endpoints are implemented.
// The repository must supply ResourceContext from the persisted record, never req.body.
export async function canReadRequest(actor: Actor, resource: ResourceContext, selectedCompany: string): Promise<boolean> {
  if (!await actor.db.rpc<boolean>('has_company_access', { target_company: resource.company_id })) return false;
  const conditions: [string, boolean][] = [
    ['request.view_own', resource.owner_id === actor.id],
    ['request.view_area', resource.area_id !== null && resource.area_id === actor.profile.area_id],
    ['request.view_company', resource.company_id === selectedCompany],
    ['request.view_all', true],
  ];
  for (const [code, matches] of conditions) if (matches && await hasPermission(actor, actor.id, code, resource.company_id)) return true;
  return false;
}
