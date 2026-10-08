import 'express-async-errors';

import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { adminRouter } from './routes/admin.js';
import { appRouter } from './routes/app.js';
import { companyRouter } from './routes/company.js';
import { companyAuthRouter } from './routes/companyAuth.js';
import { diagnosticsRouter } from './routes/diagnostics.js';
import { emailVerificationRouter } from './routes/emailVerification.js';
import { healthRouter } from './routes/health.js';
import { humanRelayRouter } from './routes/humanRelay.js';
import { knowledgeAdminRouter, knowledgeRouter } from './routes/knowledge.js';
import { leadsRouter } from './routes/leads.js';
import { ordersRouter } from './routes/orders.js';
import { paymentsRouter } from './routes/payments.js';
import { pricingRouter } from './routes/pricing.js';
import { remoteRouter } from './routes/remote.js';
import { ttsRouter } from './routes/tts.js';
import { partnerRouter } from './routes/partner.js';
import { adminPartnersRouter } from './routes/adminPartners.js';
import { sessionsRouter } from './routes/sessions.js';
import { technicianAuthRouter } from './routes/technicianAuth.js';
import { technicianConsoleRouter } from './routes/technicianConsole.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Derrière le proxy de l'hébergeur (Render), sinon req.ip serait toujours celui du proxy et les limiteurs
  // seraient partagés par TOUS les clients. Nombre de proxys de confiance : TRUST_PROXY (1 par défaut).
  const trustProxy = Number(process.env.TRUST_PROXY ?? 1);
  app.set('trust proxy', Number.isInteger(trustProxy) && trustProxy >= 0 ? trustProxy : 1);
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
  // Seule la route de chat accepte une capture d'écran jointe (réduite par l'agent, 800 000 caractères au plus en base64).
  app.use('/api/app/sessions/:id/chat', express.json({ limit: '1mb' }));
  app.use('/api/sessions/:id/chat', express.json({ limit: '1mb' }));
  // Corps brut conservé : la signature du prestataire de paiement se vérifie sur les octets exacts reçus.
  app.use(express.json({ limit: '200kb', verify: (req, _res, buf) => { (req as unknown as { rawBody?: Buffer }).rawBody = buf; } }));

  // RS-11 : plafond général par IP, tous endpoints confondus. Les endpoints
  // sensibles ont en plus leur propre limiteur, posé localement dans leur
  // router (voir commentaire plus bas).
  // Désactivée en environnement de test pour ne pas polluer les suites (IP partagée par supertest).
  const isTest = process.env.NODE_ENV === 'test';
  const POLLED = ['/api/technician/', '/api/admin/', '/api/company/', '/api/partner/', '/api/app/'];
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false,
      // Les pages ouvertes interrogent le serveur en continu (file, messages, identifiants, session : jusqu'à ~90 requêtes/min
      // côté technicien). Ces routes sont authentifiées (ou ont leur propre limiteur ciblé) : sous un quota global de 300 requêtes
      // par 15 min, tout se bloquait en 429 au bout de quelques minutes, connexion comprise.
      skip: (req) => isTest || POLLED.some((p) => req.path.startsWith(p)) || (req.method === 'GET' && (req.path.startsWith('/api/sessions/') || req.path.startsWith('/api/orders/'))),
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
  app.use('/api', emailVerificationRouter);
  app.use('/api', paymentsRouter);
  app.use('/api', appRouter);
  app.use('/api', knowledgeRouter);
  app.use('/api', partnerRouter);
  app.use('/api', diagnosticsRouter);
  app.use('/api', humanRelayRouter);
  app.use('/api', sessionsRouter);
  app.use('/api', technicianConsoleRouter);
  app.use('/api', remoteRouter);
  app.use('/api', ttsRouter);
  app.use('/api/auth', technicianAuthRouter);
  app.use('/api/auth', companyAuthRouter);
  app.use('/api', leadsRouter);
  app.use('/api/admin/knowledge', knowledgeAdminRouter);
  app.use('/api/admin', adminPartnersRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/company', companyRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Ressource introuvable' });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error & { type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // Erreurs du lecteur de corps de requête : ce sont des erreurs du client, pas du serveur.
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Requête trop volumineuse' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Requête illisible' });
    console.error(err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  });

  return app;
}
