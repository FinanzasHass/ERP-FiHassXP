import type { Actor } from './permissions.js';
import type { PrivilegedAuth } from '../integrations/supabase/auth-admin.js';
import type { Profile } from '../../shared/contracts.js';
export async function provisionUser(actor: Actor, privileged: PrivilegedAuth, key: string, payload: Record<string, unknown>): Promise<Profile> {
  const job = await actor.db.rpc<{ request_id: string; user_id: string; status: string }>('begin_user_provisioning', { idempotency_key: key, payload });
  if (job.status !== 'complete') await privileged.ensureIdentity(job.user_id, payload.email as string);
  // If Auth or DB fails, the reservation persists; retry the SAME key + payload.
  // An Auth identity without a profile has no application access. Never delete on
  // ambiguous errors: another retry may already have committed the profile.
  return actor.db.rpc<Profile>('finish_user_provisioning', { idempotency_key: key });
}
