import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { RuntimeConfig } from './config/env.js';
import { apiRouter, type Dependencies } from './routes/api.js';
import { errorHandler, HttpError } from './middleware/errors.js';

export function createApp(config: RuntimeConfig, deps: Dependencies, clientDirectory = path.resolve('dist/client')) {
  const app = express();
  app.disable('x-powered-by');
  // Explicit BEFORE req.ip, rate limiting and audit. One Render ingress only.
  app.set('trust proxy', config.TRUST_PROXY_HOPS === 0 ? false : config.TRUST_PROXY_HOPS);
  app.use(helmet());
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/health', (_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use('/api', rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'RATE_LIMIT' } }));
  app.use('/api', (req, _res, next) => {
    const origin = req.header('origin');
    if (origin && origin !== config.APP_ORIGIN) throw new HttpError(403, 'ORIGIN_NOT_ALLOWED');
    next();
  });
  app.use('/api/cost-centers/import', express.json({ limit: '256kb', strict: true }));
  app.use('/api', express.json({ limit: '32kb', strict: true }));
  app.use('/api', apiRouter(config, deps));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
  app.use(express.static(clientDirectory, { dotfiles: 'deny', index: false, fallthrough: true }));
  // Explicit known SPA routes only. Missing assets/endpoints never become index.html.
  app.get(['/', '/login', '/auth/callback', '/app', '/app/dashboard', '/app/companies', '/app/areas', '/app/positions', '/app/users', '/app/roles', '/app/audit', '/app/settings', '/app/cost-centers', '/app/projects', '/app/currencies', '/app/future/:module'], (_req, res) => {
    const index = path.join(clientDirectory, 'index.html');
    if (!existsSync(index)) { res.status(503).json({ error: 'CLIENT_BUILD_REQUIRED' }); return; }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
  app.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
  app.use(errorHandler);
  return app;
}
