import { z } from "zod";

const schema = z.object({
  APP_ENV: z.enum(['development','demo','staging']).default('development'),
  ACCOUNTING_AUTO_GENERATE: z.literal('false').default('false'),
  ACCOUNTING_AUTO_POST: z.literal('false').default('false'),
  PRODUCTION_ACCOUNTING_RULES: z.literal('false').default('false'),
  SUPABASE_URL: z
    .url()
    .refine(
      (v) =>
        new URL(v).protocol === "https:" ||
        ["localhost", "127.0.0.1"].includes(new URL(v).hostname),
    ),
  SUPABASE_PUBLISHABLE_KEY: z.string().startsWith("sb_publishable_").min(20),
  SUPABASE_SECRET_KEY: z.string().startsWith("sb_secret_").min(20),
  ATTACHMENT_ENCRYPTION_KEY: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
  ATTACHMENT_ENCRYPTION_ACTIVE_VERSION: z
    .string()
    .regex(/^V[1-9][0-9]*$/)
    .default("V1"),
  ATTACHMENT_ENCRYPTION_KEYS: z
    .record(z.string(), z.string().regex(/^[a-fA-F0-9]{64}$/))
    .default({}),
  APP_ORIGIN: z.url().refine((v) => new URL(v).origin === v),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
});
export type Config = z.infer<typeof schema>;
export type RuntimeConfig = Omit<Config, "SUPABASE_SECRET_KEY">;
export function readConfig(source: NodeJS.ProcessEnv): Config {
  if (
    Object.entries(source).some(
      ([name, value]) =>
        /^(VITE_|PUBLIC_CLIENT_)/.test(name) &&
        (name.includes("SECRET") ||
          name.includes("ENCRYPTION_KEY") ||
          (value &&
            (value === source.SUPABASE_SECRET_KEY ||
              value === source.ATTACHMENT_ENCRYPTION_KEY))),
    )
  ) {
    throw new Error("Una variable de cliente contiene configuración privada.");
  }
  const keys = Object.fromEntries(
    Object.entries(source)
      .filter(([k]) => /^ATTACHMENT_ENCRYPTION_KEY_V[1-9][0-9]*$/.test(k))
      .map(([k, v]) => [k.replace("ATTACHMENT_ENCRYPTION_KEY_", ""), v]),
  );
  if (
    keys.V1 &&
    source.ATTACHMENT_ENCRYPTION_KEY &&
    keys.V1 !== source.ATTACHMENT_ENCRYPTION_KEY
  )
    throw new Error("La clave V1 y su alias legacy deben coincidir.");
  if (
    Object.entries(source).some(
      ([k, v]) =>
        /^(VITE_|PUBLIC_CLIENT_)/.test(k) &&
        v &&
        Object.values(keys).includes(v),
    )
  )
    throw new Error("Una variable de cliente contiene configuración privada.");
  const result = schema.safeParse({
    ...source,
    ATTACHMENT_ENCRYPTION_KEYS: keys,
  });
  if (!result.success)
    throw new Error(
      "Configuración inválida. Revisar .env.example; los valores no se muestran.",
    );
  if (
    result.data.NODE_ENV === "production" &&
    !result.data.APP_ORIGIN.startsWith("https://")
  )
    throw new Error("APP_ORIGIN requiere HTTPS en producción.");
  return result.data;
}
