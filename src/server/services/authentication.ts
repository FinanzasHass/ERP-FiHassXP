import { createClient, type Session } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Config } from '../config/env.js';
import { HttpError } from '../middleware/errors.js';
export type Tokens = { access_token: string; refresh_token: string; expires_in: number };
export interface Authentication {
  verify(token: string): Promise<{ id: string; sessionId: string }>;
  login(email: string, password: string): Promise<Tokens>;
  refresh(token: string): Promise<Tokens>;
  recover(email: string): Promise<void>;
  verifyOtp(tokenHash: string, type: 'invite' | 'recovery'): Promise<Tokens>;
  updatePassword(token: string, password: string): Promise<void>;
}
export function createAuthentication(config: Pick<Config, 'SUPABASE_URL' | 'SUPABASE_PUBLISHABLE_KEY' | 'APP_ORIGIN'>): Authentication {
  const client = () => createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) },
  });
  const tokens = (session: Session | null): Tokens => {
    if (!session) throw new HttpError(401, 'INVALID_CREDENTIALS');
    return { access_token: session.access_token, refresh_token: session.refresh_token, expires_in: session.expires_in };
  };
  return {
    async verify(token) {
      const { data, error } = await client().auth.getUser(token);
      if (error || !data.user) throw new HttpError(401, 'INVALID_TOKEN');
      // Decode only AFTER Supabase has authenticated the token. No authorization from metadata.
      try {
        const claims = z.object({ sub: z.uuid(), session_id: z.uuid(), exp: z.number() }).parse(JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()));
        if (claims.sub !== data.user.id || claims.exp <= Date.now() / 1000) throw new Error();
        return { id: data.user.id, sessionId: claims.session_id };
      } catch { throw new HttpError(401, 'INVALID_TOKEN'); }
    },
    async login(email, password) {
      const { data, error } = await client().auth.signInWithPassword({ email, password });
      if (error) throw new HttpError(401, 'INVALID_CREDENTIALS');
      return tokens(data.session);
    },
    async refresh(token) {
      const { data, error } = await client().auth.refreshSession({ refresh_token: token });
      if (error) throw new HttpError(401, 'INVALID_TOKEN');
      return tokens(data.session);
    },
    async recover(email) {
      // Same response for unknown identities and provider failures, avoiding enumeration.
      await client().auth.resetPasswordForEmail(email, { redirectTo: `${config.APP_ORIGIN}/auth/callback` }).catch(() => undefined);
    },
    async verifyOtp(token_hash, type) {
      const { data, error } = await client().auth.verifyOtp({ token_hash, type });
      if (error) throw new HttpError(401, 'INVALID_TOKEN');
      return tokens(data.session);
    },
    async updatePassword(token, password) {
      const response = await fetch(`${config.SUPABASE_URL}/auth/v1/user`, {
        method: 'PUT', headers: { apikey: config.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }), signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new HttpError(400, 'PASSWORD_UPDATE_FAILED');
    },
  };
}
