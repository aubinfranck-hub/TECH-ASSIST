import 'express-async-errors';

import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { adminRouter } from './routes/admin.js';
import { companyRouter } from './routes/company.js';
import { companyAuthRouter } from './routes/companyAuth.js';
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
  // CORS_ORIGIN='*' doit rester une vraie autorisation universelle : passer
  // ['*'] (résultat de .split(',')) à la bibliothèque cors ne fait PAS ça —
  // elle compare l'en-tête Origin littéralement à la chaîne "*", qu'aucun
  // navigateur n'envoie jamais, donc tout serait bloqué silencieusement.
  const corsOriginEnv = process.env.CORS_ORIGIN;
  const corsOrigin = !corsOriginEnv || corsOriginEnv === '*' ? '*' : corsOriginEnv.split(',');
  app.use(
    cors({
      origin: corsOrigin,
      credentials: false,
    }),
  );
  app.use(express.json({ limit: '200kb' }));

  // RS-11 : plafond général par IP, tous endpoints confondus. Les endpoints
  // sensibles ont en plus leur propre limiteur, posé localement dans leur
  // router (voir commentaire plus bas).
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
  // Pas de front-end servi ici (voir apps/web) — réponse minimale pour que
  // le contrôle de santé par défaut d'un hébergeur (GET /) ne signale pas
  // le service comme en échec faute de configuration d'un chemin dédié.
  app.get('/', (_req, res) => {
    res.json({ service: 'tech-assist-api', status: 'ok' });
  });

  // Les limiteurs stricts sont posés route par route, à l'intérieur de
  // chaque router (voir orders.ts, diagnostics.ts, leads.ts,
  // technicianAuth.ts, companyAuth.ts) — jamais ici sur un préfixe partagé
  // comme '/api'. Plusieurs routers (diagnostics, sessions, remote, leads)
  // sont montés sur ce même préfixe générique : un middleware posé ici
  // s'exécuterait pour TOUTE requête /api/*, même celles destinées à un
  // autre router, avant même que ce dernier ne détermine s'il a une route
  // correspondante. Concrètement, ça avait fait partager le même quota à
  // la file technicien (interrogée toutes les 5s) et à la connexion —
  // épuisant celui-ci et bloquant des actions sans rapport (2FA, login).
  app.use('/api/health', healthRouter);
  app.use('/api/pricing', pricingRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api', diagnosticsRouter);
  app.use('/api', sessionsRouter);
  app.use('/api', remoteRouter);
  app.use('/api/auth', technicianAuthRouter);
  app.use('/api/auth', companyAuthRouter);
  app.use('/api', leadsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/company', companyRouter);

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
