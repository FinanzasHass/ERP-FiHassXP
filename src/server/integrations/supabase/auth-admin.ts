import { createClient } from '@supabase/supabase-js';
import type { Config } from '../../config/env.js';
import { HttpError } from '../../middleware/errors.js';

export interface PrivilegedAuth {
  resolveUsername?(username: string): Promise<string | null>;
  ensureIdentity(id: string, email: string): Promise<void>;
  updateEmail(id: string, email: string): Promise<void>;
  logout(token: string): Promise<void>;
  recordVerifiedLogin(userId: string, sessionId: string, ip: string): Promise<void>;
}
// The client never escapes this module. No generic CRUD or generic RPC export.
export function createPrivilegedAuth(config: Pick<Config, 'SUPABASE_URL' | 'SUPABASE_SECRET_KEY'>): PrivilegedAuth {
  const client = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) },
  });
  return {
    async resolveUsername(username) {
      const {data,error}=await client.rpc('resolve_login_username',{login_name:username});
      if(error) throw new HttpError(503,'AUTH_UNAVAILABLE');
      return data as string | null;
    },
    async ensureIdentity(id, email) {
      const existing = await client.auth.admin.getUserById(id);
      if (existing.data.user) {
        if (existing.data.user.email?.toLowerCase() !== email.toLowerCase()) throw new HttpError(409, 'IDENTITY_CONFLICT');
        return;
      }
      if (existing.error && existing.error.status !== 404) throw new HttpError(503, 'AUTH_UNAVAILABLE');
      const created = await client.auth.admin.createUser({ id, email, email_confirm: false });
      if (created.error) {
        // A concurrent retry may have created exactly the reserved identity.
        const retry = await client.auth.admin.getUserById(id);
        if (retry.data.user?.email?.toLowerCase() === email.toLowerCase()) return;
        throw new HttpError(409, 'AUTH_PROVISIONING_CONFLICT');
      }
    },
    async updateEmail(id, email) {
      const { error } = await client.auth.admin.updateUserById(id, { email, email_confirm: false });
      if (error) throw new HttpError(409, 'AUTH_EMAIL_UPDATE_FAILED');
    },
    async logout(token) {
      const { error } = await client.auth.admin.signOut(token, 'global');
      if (error) throw new HttpError(503, 'AUTH_UNAVAILABLE');
    },
    async recordVerifiedLogin(userId, sessionId, ip) {
      const { error } = await client.rpc('record_authentication_success', { verified_user: userId, verified_session: sessionId, remote_ip: ip });
      if (error) throw new HttpError(503, 'LOGIN_AUDIT_UNAVAILABLE');
    },
  };
}
