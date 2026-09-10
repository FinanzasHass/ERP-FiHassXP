import { readConfig } from './config/env.js';
import { createApp } from './app.js';
import { createAuthentication } from './services/authentication.js';
import { createPrivilegedAuth } from './integrations/supabase/auth-admin.js';
import { createSessionRepository } from './repositories/session-repository.js';
try {
  const config = readConfig(process.env);
  const { SUPABASE_SECRET_KEY, ...runtime } = config;
  const app = createApp(runtime, {
    auth: createAuthentication(runtime), privileged: createPrivilegedAuth({ SUPABASE_URL: runtime.SUPABASE_URL, SUPABASE_SECRET_KEY }),
    repository: token => createSessionRepository(runtime, token),
  });
  const server = app.listen(config.PORT, '0.0.0.0', () => console.info('API disponible.'));
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
} catch { console.error('No se pudo iniciar la API. Revisar configuración y runtime.'); process.exitCode = 1; }
