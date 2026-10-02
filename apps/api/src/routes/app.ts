import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAppInstall, signAppToken } from '../middleware/appAuth.js';
import { validateBody } from '../middleware/validate.js';
import { logAudit, type Db } from '../utils/audit.js';
import { isDisposableEmail, normalizeEmail } from '../utils/email.js';
import { consumeEmailCode, emailField } from './emailVerification.js';
import {
  AssistantUnavailableError,
  MAX_HISTORY_TURNS,
  MAX_MESSAGE_CHARS,
  MAX_TURN_CHARS,
  askOfficeAssistant,
} from '../assistant/officeAssistant.js';
import { createSessionForOrder } from './sessions.js';

/**
 * Tout part de l'application installée (D9) : le site n'en est que le miroir.
 * Les droits (assistance offerte, abonnement) sont lus en base, jamais fournis
 * par l'application.
 */
export const appRouter = Router();

/** Formules internes : jamais commandables directement via POST /api/orders. */
export const FREE_OFFER_PLAN_ID = 'assistance_offerte';
export const SUBSCRIPTION_PLAN_ID = 'abonnement_mensuel';
export const SUBSCRIBER_PLAN_ID = 'assistance_abonne';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

const phoneSchema = z.string().regex(/^\+?[0-9]{8,15}$/, 'Numéro de téléphone invalide');

/**
 * Tant que AI_AGENT_ENABLED n'est pas à « true », une demande en mode « ia » est
 * honnêtement redirigée vers un technicien (voir createSessionForOrder).
 */
export function aiAgentAvailable(): boolean {
  return process.env.AI_AGENT_ENABLED === 'true';
}

interface Entitlements {
  freeOfferAvailable: boolean;
  subscription: { endsAt: Date } | null;
  aiAgentAvailable: boolean;
}

/** L'offre est unique par adresse email ET par empreinte d'appareil : la base s'en souvient. */
async function freeOfferUsed(db: Db, email: string, hardwareHash: string | null): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM app_installs
     WHERE free_offer_used_at IS NOT NULL
       AND (client_email = $1 OR ($2::text IS NOT NULL AND hardware_hash = $2))
     LIMIT 1`,
    [email, hardwareHash],
  );
  return rows.length > 0;
}

async function activeSubscription(db: Db, email: string) {
  const { rows } = await db.query(
    `SELECT ends_at FROM subscriptions
     WHERE client_email = $1 AND status = 'active' AND ends_at > now()
     ORDER BY ends_at DESC LIMIT 1`,
    [email],
  );
  return rows[0] ? { endsAt: rows[0].ends_at as Date } : null;
}

async function entitlementsFor(install: { email: string; hardwareHash: string | null }): Promise<Entitlements> {
  const [used, subscription] = await Promise.all([
    freeOfferUsed(pool, install.email, install.hardwareHash),
    activeSubscription(pool, install.email),
  ]);
  return { freeOfferAvailable: !used, subscription, aiAgentAvailable: aiAgentAvailable() };
}

const registerSchema = z.object({
  installId: z.string().min(16).max(100),
  platform: z.enum(['windows', 'android']),
  email: emailField,
  code: z.string().regex(/^[0-9]{6}$/, 'Le code comporte 6 chiffres'),
  phone: phoneSchema,
  name: z.string().max(120).optional(),
  hardwareHash: z.string().min(16).max(200).optional(),
});

/**
 * Inscription de l'installation : prouve l'adresse email par le code reçu, puis
 * enregistre l'appareil en base et remet à l'application un jeton.
 */
appRouter.post('/app/register', limiter, validateBody(registerSchema), async (req, res) => {
  const body = req.body as z.infer<typeof registerSchema>;
  const email = normalizeEmail(body.email);
  if (isDisposableEmail(email)) {
    return res.status(400).json({ error: 'Utilisez une adresse email personnelle ou professionnelle.' });
  }

  const existing = await pool.query('SELECT id, client_email FROM app_installs WHERE install_id = $1', [body.installId]);
  if (existing.rows[0] && existing.rows[0].client_email !== email) {
    return res.status(409).json({ error: 'Cette installation est déjà enregistrée avec une autre adresse email.' });
  }

  const verdict = await consumeEmailCode(email, body.code);
  if (verdict === 'too_many_attempts') {
    return res.status(429).json({ error: "Trop d'essais. Demandez un nouveau code." });
  }
  if (verdict !== 'ok') {
    return res.status(400).json({ error: 'Code invalide ou expiré.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO app_installs (install_id, platform, hardware_hash, client_email, client_phone, client_name)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (install_id) DO UPDATE
       SET client_phone = EXCLUDED.client_phone,
           client_name = COALESCE(EXCLUDED.client_name, app_installs.client_name),
           -- la première empreinte enregistrée reste liée à l'installation (on ne la remplace pas)
           hardware_hash = COALESCE(app_installs.hardware_hash, EXCLUDED.hardware_hash),
           last_seen_at = now()
       WHERE app_installs.client_email = EXCLUDED.client_email
     RETURNING id, platform, hardware_hash`,
    [body.installId, body.platform, body.hardwareHash ?? null, email, body.phone, body.name ?? null],
  );
  const install = rows[0];
  if (!install) {
    // Deux inscriptions simultanées avec la même installation et des emails différents.
    return res.status(409).json({ error: 'Cette installation est déjà enregistrée avec une autre adresse email.' });
  }
  await logAudit(pool, { actorType: 'client', actorId: email, action: 'app.registered', details: { platform: body.platform } });

  const entitlements = await entitlementsFor({ email, hardwareHash: install.hardware_hash });
  res.status(201).json({ token: signAppToken(install.id), entitlements });
});

/** Droits actuels de cette installation (offre disponible, abonnement en cours). */
appRouter.get('/app/me', requireAppInstall, async (req, res) => {
  const install = req.appInstall!;
  res.json({
    email: install.email,
    platform: install.platform,
    entitlements: await entitlementsFor(install),
  });
});

const startSchema = z.object({
  // L'agent IA est le mode par défaut ; le technicien humain reste un choix.
  mode: z.enum(['ia', 'humain']).default('ia'),
});

/**
 * Démarre une assistance couverte : 1re assistance offerte (une par email/appareil),
 * puis uniquement avec un abonnement actif. Couverture vérifiée ici, côté serveur.
 */
appRouter.post('/app/assistance', limiter, requireAppInstall, validateBody(startSchema), async (req, res) => {
  const install = req.appInstall!;
  const { mode } = req.body as z.infer<typeof startSchema>;

  const client = await pool.connect();
  let order: { id: string; status: string; amount_fcfa: number };
  let session: Extract<Awaited<ReturnType<typeof createSessionForOrder>>, { ok: true }>['session'];
  let coverage: 'subscription' | 'free_offer';
  try {
    await client.query('BEGIN');
    // Sérialise les demandes d'un même email ou d'un même appareil : pas de double offre en parallèle.
    // Verrous pris dans un ordre fixe pour éviter les interblocages.
    const lockKeys = [install.email, install.hardwareHash ?? ''].filter(Boolean).sort();
    for (const key of lockKeys) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
    }

    // Toutes les lectures passent par `client` : une seule connexion par requête (pas d'attente croisée sur le pool).
    const subscription = await activeSubscription(client, install.email);
    let planId: string;
    if (subscription) {
      coverage = 'subscription';
      planId = SUBSCRIBER_PLAN_ID;
    } else if (!(await freeOfferUsed(client, install.email, install.hardwareHash))) {
      coverage = 'free_offer';
      planId = FREE_OFFER_PLAN_ID;
      await client.query('UPDATE app_installs SET free_offer_used_at = now() WHERE id = $1', [install.id]);
    } else {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error: 'Votre assistance offerte a déjà été utilisée. Abonnez-vous pour continuer.',
        code: 'subscription_required',
        subscriptionPlanId: SUBSCRIPTION_PLAN_ID,
      });
    }

    const inserted = await client.query(
      `INSERT INTO orders (client_phone, client_name, client_email, app_install_id, plan_id, amount_fcfa, status, paid_at, platform, mode)
       VALUES ($1, $2, $3, $4, $5, 0, 'paid', now(), $6, $7)
       RETURNING id, status, amount_fcfa`,
      [install.phone, install.name, install.email, install.id, planId, install.platform, mode],
    );
    order = inserted.rows[0];

    // La session est créée dans la même transaction : si elle échoue, l'offerte n'est pas consommée.
    const created = await createSessionForOrder(order.id, install.platform, mode, client);
    if (!created.ok) {
      await client.query('ROLLBACK');
      return res.status(created.status).json({ error: created.error });
    }
    session = created.session;
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  await logAudit(pool, {
    actorType: 'client',
    actorId: install.email,
    orderId: order.id,
    sessionId: session.id,
    action: 'assistance.started',
    details: { coverage, requestedMode: mode, mode: session.mode },
  });

  res.status(201).json({
    order,
    session,
    coverage,
    // true : l'agent IA a été demandé mais n'est pas activé, un technicien prend le relais.
    fallbackToHuman: mode === 'ia' && session.mode === 'humain',
  });
});

/**
 * Abonnement mensuel : crée la commande à payer (Mobile Money, confirmation
 * manuelle D3) ; l'abonnement s'active quand le paiement est confirmé.
 */
appRouter.post('/app/subscribe', limiter, requireAppInstall, async (req, res) => {
  const install = req.appInstall!;

  const planResult = await pool.query('SELECT id, price_fcfa FROM pricing_plans WHERE id = $1 AND active = TRUE', [
    SUBSCRIPTION_PLAN_ID,
  ]);
  const plan = planResult.rows[0];
  if (!plan) return res.status(404).json({ error: 'Abonnement indisponible pour le moment' });

  const client = await pool.connect();
  let order: { id: string; status: string; amount_fcfa: number; created_at: Date };
  try {
    await client.query('BEGIN');
    const orderResult = await client.query(
      `INSERT INTO orders (client_phone, client_name, client_email, app_install_id, plan_id, amount_fcfa, platform)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, status, amount_fcfa, created_at`,
      [install.phone, install.name, install.email, install.id, plan.id, plan.price_fcfa, install.platform],
    );
    order = orderResult.rows[0];
    await client.query(
      `INSERT INTO subscriptions (client_phone, client_name, client_email, plan_id, order_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [install.phone, install.name, install.email, plan.id, order.id],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  // Après libération de la connexion : jamais de seconde connexion demandée en tenant la première.
  await logAudit(pool, { actorType: 'client', actorId: install.email, orderId: order.id, action: 'subscription.requested' });
  res.status(201).json({ order });
});

const EVENT_TYPES = [
  'diagnosed',
  'action_proposed',
  'action_approved',
  'action_declined',
  'action_done',
  'action_failed',
  'verified',
  'escalated',
  /** Ce que le client a demandé dans la conversation (journal lisible par le technicien). */
  'user_request',
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const eventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  skill: z.string().max(60),
  action: z.string().max(60).optional(),
  message: z.string().max(500).optional(),
  details: z.record(z.unknown()).optional(),
});

/**
 * L'agent rend compte de chaque étape (diagnostic, action proposée, accord ou
 * refus du client, résultat). Tout est journalisé : le client et la plateforme
 * peuvent relire exactement ce que l'agent a fait sur la machine.
 */
appRouter.post('/app/sessions/:id/events', limiter, requireAppInstall, validateBody(eventSchema), async (req, res) => {
  const install = req.appInstall!;
  const body = req.body as z.infer<typeof eventSchema>;
  if (!UUID.test(req.params.id!)) return res.status(404).json({ error: 'Session introuvable' });

  // La session doit appartenir à CETTE installation, via sa commande.
  const owned = await pool.query(
    `SELECT s.id, s.order_id FROM sessions s JOIN orders o ON o.id = s.order_id
     WHERE s.id = $1 AND o.app_install_id = $2`,
    [req.params.id, install.id],
  );
  if (!owned.rows[0]) return res.status(404).json({ error: 'Session introuvable' });

  const details = JSON.stringify(body.details ?? {});
  if (details.length > 4000) return res.status(413).json({ error: 'Détails trop volumineux' });

  await logAudit(pool, {
    actorType: 'client',
    actorId: install.email,
    sessionId: req.params.id,
    orderId: owned.rows[0].order_id,
    action: `agent.${body.type}`,
    details: { skill: body.skill, action: body.action, message: body.message, ...(body.details ?? {}) },
  });

  // Quand l'agent passe la main, la session rejoint la file des techniciens.
  if (body.type === 'escalated') {
    await pool.query(`UPDATE sessions SET mode = 'humain' WHERE id = $1 AND status IN ('created','waiting_technician','active')`, [
      req.params.id,
    ]);
  }
  res.status(201).json({ recorded: true });
});

const chatSchema = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(MAX_TURN_CHARS) }))
    .max(MAX_HISTORY_TURNS)
    .default([]),
});

/** Chaque appel coûte de l'IA : plafond par session (en plus de la limite par adresse IP). */
export const MAX_CHATS_PER_SESSION = 40;

const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

/**
 * Questions d'usage (Office, Outlook, Windows) posées pendant une assistance. La réponse est du TEXTE :
 * elle n'est jamais exécutée par l'agent. Sans clé d'IA configurée, la route répond 503 et l'agent propose
 * honnêtement un technicien. Les questions et réponses sont journalisées : le technicien relit la conversation.
 */
appRouter.post('/app/sessions/:id/chat', chatLimiter, requireAppInstall, validateBody(chatSchema), async (req, res) => {
  const install = req.appInstall!;
  const body = req.body as z.infer<typeof chatSchema>;
  if (!UUID.test(req.params.id!)) return res.status(404).json({ error: 'Session introuvable' });

  // La session doit appartenir à CETTE installation, via sa commande, et ne pas être terminée.
  const owned = await pool.query(
    `SELECT s.id, s.status, s.order_id FROM sessions s JOIN orders o ON o.id = s.order_id
     WHERE s.id = $1 AND o.app_install_id = $2`,
    [req.params.id, install.id],
  );
  const session = owned.rows[0];
  if (!session) return res.status(404).json({ error: 'Session introuvable' });
  if (!['created', 'waiting_technician', 'active'].includes(session.status)) {
    return res.status(409).json({ error: 'Cette assistance est terminée.' });
  }

  // Plafond approximatif sous forte concurrence (la limite par IP borne l'écart).
  const used = await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE session_id = $1 AND action = 'agent.chat'`, [session.id]);
  if (used.rows[0].n >= MAX_CHATS_PER_SESSION) {
    return res.status(429).json({
      code: 'chat_limit',
      error: "Vous avez atteint la limite de questions pour cette assistance : un technicien peut prendre le relais.",
    });
  }

  let answer: { text: string; model: string };
  try {
    answer = await askOfficeAssistant(body.message, body.history);
  } catch (err) {
    if (!(err instanceof AssistantUnavailableError)) throw err;
    console.error(`[assistant] indisponible : ${err.message}`);
    return res.status(503).json({ code: 'assistant_unavailable', error: "L'assistant en ligne n'est pas disponible pour le moment." });
  }

  await logAudit(pool, {
    actorType: 'client',
    actorId: install.email,
    sessionId: session.id,
    orderId: session.order_id,
    action: 'agent.chat',
    details: { question: body.message.slice(0, 300), answer: answer.text.slice(0, 500), model: answer.model },
  });
  res.json({ answer: answer.text });
});
