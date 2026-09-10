import { z } from 'zod';

const schema = z.object({
  SUPABASE_URL: z.url().refine(v => new URL(v).protocol === 'https:' || ['localhost', '127.0.0.1'].includes(new URL(v).hostname)),
  SUPABASE_PUBLISHABLE_KEY: z.string().startsWith('sb_publishable_').min(20),
  SUPABASE_SECRET_KEY: z.string().startsWith('sb_secret_').min(20),
  APP_ORIGIN: z.url().refine(v => new URL(v).origin === v),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
});
export type Config = z.infer<typeof schema>;
export type RuntimeConfig = Omit<Config, 'SUPABASE_SECRET_KEY'>;
export function readConfig(source: NodeJS.ProcessEnv): Config {
  if (Object.entries(source).some(([name, value]) => /^(VITE_|PUBLIC_CLIENT_)/.test(name)
    && (name.includes('SECRET') || (value && value === source.SUPABASE_SECRET_KEY)))) {
    throw new Error('Una variable de cliente contiene configuración privada.');
  }
  const result = schema.safeParse(source);
  if (!result.success) throw new Error('Configuración inválida. Revisar .env.example; los valores no se muestran.');
  if (result.data.NODE_ENV === 'production' && !result.data.APP_ORIGIN.startsWith('https://')) throw new Error('APP_ORIGIN requiere HTTPS en producción.');
  return result.data;
}
