import 'express-async-errors';

import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { adminRouter } from './routes/admin.js';
import { diagnosticsRouter } from './routes/diagnostics.js';
import { healthRouter } from './routes/health.js';
import { leadsRouter } from './routes/leads.js';
import { ordersRouter } from './routes/orders.js';
import { pricingRouter } from './routes/pricing.js';
import { remoteRouter } from './routes/remote.js';
import { sessionsRouter } from './routes/sessions.js';
import { technicianAuthRouter } from './routes/technicianAuth.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN?.split(',') ?? '*',
      credentials: false,
    }),
  );
  app.use(express.json({ limit: '200kb' }));

  // RS-11 : limitation de débit générale + plus stricte sur les endpoints sensibles.
  // Désactivée en environnement de test pour ne pas polluer les suites (IP partagée par supertest).
  const isTest = process.env.NODE_ENV === 'test';
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false,
      skip: () => isTest,
    }),
  );
  const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTest,
  });

  app.use('/api/health', healthRouter);
  app.use('/api/pricing', pricingRouter);
  app.use('/api/orders', strictLimiter, ordersRouter);
  app.use('/api', strictLimiter, diagnosticsRouter);
  app.use('/api', sessionsRouter);
  app.use('/api', remoteRouter);
  app.use('/api/auth', strictLimiter, technicianAuthRouter);
  app.use('/api', strictLimiter, leadsRouter);
  app.use('/api/admin', adminRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Ressource introuvable' });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  });

  return app;
}
