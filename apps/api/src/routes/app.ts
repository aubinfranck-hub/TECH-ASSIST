import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { consumeJoinCode } from '../utils/joinCodes.js';
import { pool } from '../db/pool.js';
import { requireAppInstall, signAppToken } from '../middleware/appAuth.js';
import { validateBody } from '../middleware/validate.js';
import { alertInBackground } from '../notify/technicianAlerts.js';
import { logAudit, type Db } from '../utils/audit.js';
import { isDisposableEmail, normalizeEmail } from '../utils/email.js';
import { freeLaunch, upgradeOffer } from '../utils/offers.js';
import { expireOverdueSessions } from '../utils/sessionClock.js';
import { encryptSecret } from '../utils/crypto.js';
import { consumeEmailCode, emailField, emailVerificationEnabled } from './emailVerification.js';
import {
  AssistantUnavailableError,
  MAX_HISTORY_TURNS,
  MAX_IMAGE_BASE64_CHARS,
  MAX_MESSAGE_CHARS,
  MAX_TURN_CHARS,
  askOfficeAssistant,
  imageMatchesMime,
} from '../assistant/officeAssistant.js';
import { TRAINING_STEPS, TRAINING_TRACK_IDS, findTrack } from '../assistant/trainingCatalog.js';
import { JEKO_METHODS, JekoError, createJekoPayment, jekoConfigured, type JekoMethod } from '../payments/jeko.js';
import { paymentLink } from './payments.js';
import { selfHostedRustdesk } from './remote.js';
import { contextFrom, memoryAnswer, searchLexique, usedFicheIds } from '../assistant/lexique.js';
import { enrichInBackground } from '../assistant/pannesLearning.js';
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
  /** Poste rattaché à une société dont l'abonnement est actif. */
  companyCovered: boolean;
  /** Forfait payé, pas encore démarré. */
  paidForfait: { orderId: string; name: string; scope: string; humanIncluded: boolean } | null;
  aiAgentAvailable: boolean;
}

/** L'offre est unique par adresse email ET par empreinte d'appareil : la base s'en souvient. */
/** Ce poste est rattaché à une société dont l'abonnement est actif : l'assistance est couverte. */
async function companyCovers(db: Db, installId: string): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM company_devices d JOIN companies c ON c.id = d.company_id
     WHERE d.app_install_id = $1 AND c.subscription_status = 'active' LIMIT 1`,
    [installId],
  );
  return (r.rowCount ?? 0) > 0;
}

async function freeOfferUsed(db: Db, email: string, hardwareHash: string | null): Promise<boolean> {
  if (freeLaunch()) return false;
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

async function entitlementsFor(install: { id?: string; email: string; hardwareHash: string | null }): Promise<Entitlements> {
  const [used, subscription, companyCovered] = await Promise.all([
    freeOfferUsed(pool, install.email, install.hardwareHash),
    activeSubscription(pool, install.email),
    install.id ? companyCovers(pool, install.id) : Promise.resolve(false),
  ]);
  // Forfait payé et pas encore utilisé : le client peut démarrer son assistance (ex. après avoir fermé le programme).
  const paid = install.id
    ? await pool.query(
        `SELECT o.id, p.name, p.metadata->>'scope' AS scope, COALESCE((p.metadata->>'humanIncluded')::boolean, TRUE) AS human_included
         FROM orders o JOIN pricing_plans p ON p.id = o.plan_id
         WHERE o.app_install_id = $1 AND o.status = 'paid' AND o.amount_fcfa > 0
           AND p.metadata ? 'scope' AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.order_id = o.id)
         ORDER BY o.paid_at DESC NULLS LAST LIMIT 1`,
        [install.id],
      )
    : { rows: [] };
  const paidForfait = paid.rows[0] ? { orderId: paid.rows[0].id as string, name: paid.rows[0].name as string, scope: paid.rows[0].scope as string, humanIncluded: freeLaunch() || paid.rows[0].human_included === true } : null;
  return { freeOfferAvailable: !used, subscription, companyCovered, paidForfait, aiAgentAvailable: aiAgentAvailable() };
}

const registerSchema = z.object({
  installId: z.string().min(16).max(100),
  platform: z.enum(['windows', 'android']),
  email: emailField,
  code: z.string().regex(/^[0-9]{6}$/, 'Le code comporte 6 chiffres').optional(),
  phone: phoneSchema.optional(), // facultatif : l'email suffit pour commencer
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

  if (emailVerificationEnabled()) {
    if (!body.code) return res.status(400).json({ error: 'Le code reçu par email est nécessaire.' });
    const verdict = await consumeEmailCode(email, body.code);
    if (verdict === 'too_many_attempts') {
      return res.status(429).json({ error: "Trop d'essais. Demandez un nouveau code." });
    }
    if (verdict !== 'ok') {
      return res.status(400).json({ error: 'Code invalide ou expiré.' });
    }
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
    [body.installId, body.platform, body.hardwareHash ?? null, email, body.phone ?? '', body.name ?? null],
  );
  const install = rows[0];
  if (!install) {
    // Deux inscriptions simultanées avec la même installation et des emails différents.
    return res.status(409).json({ error: 'Cette installation est déjà enregistrée avec une autre adresse email.' });
  }
  await logAudit(pool, { actorType: 'client', actorId: email, action: 'app.registered', details: { platform: body.platform } });

  const entitlements = await entitlementsFor({ id: install.id, email, hardwareHash: install.hardware_hash });
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

const joinSchema = z.object({
  code: z.string().min(8).max(20),
  deviceName: z.string().trim().min(1).max(120),
});

/**
 * Rattache ce PC à l'espace entreprise qui a généré le code (usage unique, 48 h). Un poste ne peut appartenir
 * qu'à une entreprise ; le rattachement est journalisé.
 */
appRouter.post('/app/company/join', limiter, requireAppInstall, validateBody(joinSchema), async (req, res) => {
  const install = req.appInstall!;
  const body = req.body as z.infer<typeof joinSchema>;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const already = await client.query('SELECT 1 FROM company_devices WHERE app_install_id = $1', [install.id]);
    if (already.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ce PC est déjà rattaché à une entreprise.' });
    }
    const joined = await consumeJoinCode(client, body.code);
    if (!joined) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Code invalide, expiré ou déjà utilisé. Demandez un nouveau code à votre administrateur.' });
    }
    // Forfait entreprise : le nombre de postes est celui du forfait choisi.
    const limit = await client.query(
      `SELECT (p.metadata->>'maxDevices')::int AS max_devices,
              (SELECT count(*)::int FROM company_devices d WHERE d.company_id = c.id) AS devices
       FROM companies c LEFT JOIN pricing_plans p ON p.id = c.subscription_plan_id WHERE c.id = $1`,
      [joined.companyId],
    );
    const { max_devices: maxDevices, devices } = limit.rows[0] ?? {};
    if (maxDevices !== null && maxDevices !== undefined && devices >= maxDevices) {
      await client.query('ROLLBACK'); // le code n'est pas consommé : l'annulation le restitue
      return res.status(409).json({
        error: `Le forfait de votre entreprise couvre ${maxDevices} poste${maxDevices > 1 ? 's' : ''} et ${maxDevices > 1 ? 'ils sont tous rattachés' : 'il est déjà rattaché'}. Demandez à votre administrateur de passer à un forfait plus grand.`,
        code: 'device_limit',
      });
    }
    const inserted = await client.query(
      `INSERT INTO company_devices (company_id, device_name, platform, app_install_id, last_seen_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (company_id, device_name) DO NOTHING
       RETURNING id`,
      [joined.companyId, body.deviceName, install.platform, install.id],
    );
    if (inserted.rows.length === 0) {
      await client.query('ROLLBACK'); // le code n'est pas consommé : l'annulation le restitue
      return res.status(409).json({ error: 'Un poste portant ce nom existe déjà dans votre entreprise.' });
    }
    const company = await client.query('SELECT name FROM companies WHERE id = $1', [joined.companyId]);
    await client.query('COMMIT');
    await logAudit(pool, { actorType: 'client', actorId: install.email, action: 'company.device_joined', details: { companyId: joined.companyId } });
    return res.status(201).json({ companyName: company.rows[0]?.name ?? '' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
});

const heartbeatSchema = z.object({
  diskFreePercent: z.number().int().min(0).max(100).optional(),
  memoryUsedPercent: z.number().int().min(0).max(100).optional(),
  antivirusOk: z.boolean().optional(),
  osUpToDate: z.boolean().optional(),
});

/** Santé du poste, envoyée par le programme : alimente la vue de parc de l'entreprise. 404 si le PC n'est rattaché à aucune entreprise. */
appRouter.post('/app/company/heartbeat', limiter, requireAppInstall, validateBody(heartbeatSchema), async (req, res) => {
  const body = req.body as z.infer<typeof heartbeatSchema>;
  const { rowCount } = await pool.query(
    `UPDATE company_devices SET disk_free_percent = $2, memory_used_percent = $3, antivirus_ok = $4, os_up_to_date = $5, last_seen_at = now()
     WHERE app_install_id = $1`,
    [req.appInstall!.id, body.diskFreePercent ?? null, body.memoryUsedPercent ?? null, body.antivirusOk ?? null, body.osUpToDate ?? null],
  );
  if (!rowCount) return res.status(404).json({ error: "Ce PC n'est rattaché à aucune entreprise." });
  res.status(202).json({ received: true });
});

/** Demande de diagnostic en attente pour ce PC (valable 7 jours). Le programme la montre à l'utilisateur, qui accepte ou refuse. */
appRouter.get('/app/company/requests', limiter, requireAppInstall, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.kind, c.name AS company_name FROM company_diagnostic_requests r
     JOIN company_devices d ON d.id = r.device_id JOIN companies c ON c.id = r.company_id
     WHERE d.app_install_id = $1 AND r.status = 'pending' AND r.created_at > now() - interval '7 days'
     ORDER BY r.created_at ASC LIMIT 1`,
    [req.appInstall!.id],
  );
  res.json({ request: rows[0] ? { id: rows[0].id, kind: rows[0].kind, companyName: rows[0].company_name } : null });
});

const answerSchema = z.object({
  status: z.enum(['done', 'declined']),
  worst: z.enum(['critical', 'fixable', 'watch', 'ok', 'unknown']).optional(),
  summary: z.string().max(3000).optional(),
});

appRouter.post('/app/company/requests/:id/answer', limiter, requireAppInstall, validateBody(answerSchema), async (req, res) => {
  const body = req.body as z.infer<typeof answerSchema>;
  const { rowCount } = await pool.query(
    `UPDATE company_diagnostic_requests r SET status = $3, summary = $4, worst = $5, answered_at = now()
     FROM company_devices d
     WHERE r.id::text = $1 AND r.status = 'pending' AND d.id = r.device_id AND d.app_install_id = $2`,
    [req.params.id, req.appInstall!.id, body.status, body.status === 'done' ? (body.summary ?? '') : null, body.status === 'done' ? (body.worst ?? 'unknown') : null],
  );
  if (!rowCount) return res.status(404).json({ error: 'Demande introuvable ou déjà traitée.' });
  await logAudit(pool, { actorType: 'client', actorId: req.appInstall!.email, action: 'company.diagnostic_answered', details: { status: body.status } });
  res.json({ ok: true });
});

const startSchema = z.object({
  // L'agent IA est le mode par défaut ; le technicien humain reste un choix.
  mode: z.enum(['ia', 'humain']).default('ia'),
  /** Forfait déjà payé (voir POST /app/orders) : démarre l'assistance correspondante. */
  orderId: z.string().regex(/^[0-9a-f-]{36}$/i).optional(),
});

const orderSchema = z.object({ planId: z.string().min(1).max(60) });

/** Commande d'un forfait à l'usage (500 / 2 000 / 5 000 FCFA) ; payée par Mobile Money, confirmée par un technicien. */
appRouter.post('/app/orders', limiter, requireAppInstall, validateBody(orderSchema), async (req, res) => {
  const install = req.appInstall!;
  const { planId } = req.body as z.infer<typeof orderSchema>;
  const planResult = await pool.query(
    `SELECT id, name, price_fcfa, metadata FROM pricing_plans
     WHERE id = $1 AND active = TRUE AND segment = 'particulier' AND price_fcfa > 0 AND duration_minutes IS NOT NULL`,
    [planId],
  );
  const plan = planResult.rows[0];
  if (!plan || plan.metadata?.subscription || plan.metadata?.coveredBySubscription || plan.metadata?.freePerPhone || plan.metadata?.viewerSession) {
    return res.status(404).json({ error: 'Forfait inconnu' });
  }
  // Offre « IA seule » : on ne la vend pas tant que l'agent IA est indisponible (le client paierait sans pouvoir l'utiliser).
  if (plan.metadata?.humanIncluded === false && !freeLaunch() && !aiAgentAvailable()) {
    return res.status(503).json({ code: 'ai_unavailable', error: "L'assistance IA n'est pas disponible pour le moment. Réessayez plus tard ou choisissez l'offre avec technicien." });
  }
  // Une seule commande en attente à la fois : évite l'empilement de demandes de paiement.
  const pending = await pool.query(
    `SELECT id FROM orders WHERE app_install_id = $1 AND status = 'pending_payment' AND upgrade_session_id IS NULL AND created_at > now() - interval '2 hours'`,
    [install.id],
  );
  const reuse = pending.rows[0];
  let order;
  if (reuse) {
    const upd = await pool.query(
      `UPDATE orders SET plan_id = $2, amount_fcfa = $3 WHERE id = $1
       RETURNING id, status, amount_fcfa, plan_id, created_at`,
      [reuse.id, plan.id, plan.price_fcfa],
    );
    order = upd.rows[0];
  } else {
    const ins = await pool.query(
      `INSERT INTO orders (client_phone, client_name, client_email, app_install_id, plan_id, amount_fcfa, platform, mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'ia') RETURNING id, status, amount_fcfa, plan_id, created_at`,
      [install.phone, install.name, install.email, install.id, plan.id, plan.price_fcfa, install.platform],
    );
    order = ins.rows[0];
    await logAudit(pool, { actorType: 'client', actorId: install.email, orderId: order.id, action: 'order.created', details: { planId } });
  }
  res.status(201).json({
    order,
    plan: { id: plan.id, name: plan.name, scope: plan.metadata?.scope ?? 'fix' },
    payment: paymentBlock(order, Number(plan.price_fcfa), install.email, 'Un technicien confirme la réception, puis votre assistance démarre.'),
  });
});

/** Informations de paiement d'une commande (lien, méthodes Jèko, consignes manuelles) : même format pour un forfait et pour un complément. */
function paymentBlock(order: { id: string; amount_fcfa: number }, amountFcfa: number, email: string, afterPayment: string) {
  return {
    amountFcfa,
    reference: String(order.id).slice(0, 8).toUpperCase(),
    // Paiement automatique : le client paie sur le lien, le prestataire confirme, l'assistance démarre seule.
    url: paymentLink(order, email),
    // Jèko : le client choisit sa méthode, puis POST /app/orders/:id/pay donne le lien de paiement.
    automatic: jekoConfigured() || Boolean(process.env.PAYMENT_WEBHOOK_SECRET && process.env.PAYMENT_LINK_TEMPLATE),
    methods: jekoConfigured() ? JEKO_METHODS : [],
    instructions:
      process.env.PAYMENT_INSTRUCTIONS ?? `Envoyez le montant par Mobile Money au numéro indiqué par notre équipe en précisant la référence. ${afterPayment}`,
  };
}

const UPGRADE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Offre « IA seule » : l'agent a besoin d'un technicien. Le client peut payer le complément (une fois, pour CETTE assistance) ;
 * dès le paiement confirmé, la session comprend un technicien. Même paiement que les forfaits (Jèko ou confirmation manuelle).
 */
appRouter.post('/app/sessions/:id/upgrade', limiter, requireAppInstall, async (req, res) => {
  const install = req.appInstall!;
  if (!UPGRADE_UUID.test(req.params.id!)) return res.status(404).json({ error: 'Session introuvable' });
  const owned = await pool.query(
    `SELECT s.id, s.status, s.human_included FROM sessions s JOIN orders o ON o.id = s.order_id
     WHERE s.id = $1 AND o.app_install_id = $2`,
    [req.params.id, install.id],
  );
  const session = owned.rows[0];
  if (!session) return res.status(404).json({ error: 'Session introuvable' });
  if (!['created', 'waiting_technician', 'active'].includes(session.status)) return res.status(409).json({ error: 'Cette assistance est terminée.' });
  if (session.human_included) return res.status(409).json({ error: 'Un technicien fait déjà partie de votre assistance.', code: 'already_included' });
  const offer = await upgradeOffer();
  if (!offer) return res.status(404).json({ error: 'Ce complément est indisponible pour le moment.' });

  // Une seule demande de complément en attente par assistance : on la retrouve au lieu d'en empiler.
  const pending = await pool.query(
    `SELECT id, status, amount_fcfa, created_at FROM orders WHERE upgrade_session_id = $1 AND status = 'pending_payment' ORDER BY created_at DESC LIMIT 1`,
    [session.id],
  );
  let order = pending.rows[0];
  if (!order) {
    const ins = await pool.query(
      `INSERT INTO orders (client_phone, client_name, client_email, app_install_id, plan_id, amount_fcfa, platform, mode, upgrade_session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'ia', $8) RETURNING id, status, amount_fcfa, created_at`,
      [install.phone, install.name, install.email, install.id, offer.planId, offer.priceFcfa, install.platform, session.id],
    );
    order = ins.rows[0];
    await logAudit(pool, { actorType: 'client', actorId: install.email, orderId: order.id, sessionId: session.id, action: 'order.upgrade_requested', details: { planId: offer.planId } });
  }
  res.status(201).json({
    order,
    plan: { id: offer.planId, name: 'Ajouter un technicien à mon assistance' },
    payment: paymentBlock(order, offer.priceFcfa, install.email, 'Un technicien confirme la réception, puis il pourra prendre le relais.'),
  });
});

const paySchema = z.object({ method: z.enum(JEKO_METHODS) });

/** Crée le paiement Jèko de la commande avec la méthode choisie (Wave, Orange, MTN, Moov, Djamo) ; renvoie le lien. */
appRouter.post('/app/orders/:id/pay', limiter, requireAppInstall, validateBody(paySchema), async (req, res) => {
  const install = req.appInstall!;
  if (!jekoConfigured()) return res.status(503).json({ error: 'Paiement en ligne indisponible pour le moment.' });
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Commande introuvable' });
  const { rows } = await pool.query(
    `SELECT id, amount_fcfa FROM orders WHERE id = $1 AND app_install_id = $2 AND status = 'pending_payment'`,
    [req.params.id, install.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Commande introuvable ou déjà payée' });
  try {
    const payment = await createJekoPayment({ orderId: rows[0].id, amountFcfa: Number(rows[0].amount_fcfa), method: (req.body as z.infer<typeof paySchema>).method as JekoMethod });
    res.json({ url: payment.redirectUrl });
  } catch (err) {
    if (err instanceof JekoError) return res.status(502).json({ error: err.message });
    throw err;
  }
});

/** Suivi d'une commande (le client attend la confirmation du paiement). */
appRouter.get('/app/orders/:id', limiter, requireAppInstall, async (req, res) => {
  const install = req.appInstall!;
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Commande introuvable' });
  const { rows } = await pool.query(
    `SELECT o.id, o.status, o.amount_fcfa, o.plan_id, p.name AS plan_name, p.metadata->>'scope' AS scope,
            EXISTS (SELECT 1 FROM sessions s WHERE s.order_id = o.id) AS used
     FROM orders o JOIN pricing_plans p ON p.id = o.plan_id
     WHERE o.id = $1 AND o.app_install_id = $2`,
    [req.params.id, install.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Commande introuvable' });
  res.json({ order: rows[0] });
});

/**
 * Démarre une assistance couverte : 1re assistance offerte (une par email/appareil),
 * puis uniquement avec un abonnement actif. Couverture vérifiée ici, côté serveur.
 */
appRouter.post('/app/assistance', limiter, requireAppInstall, validateBody(startSchema), async (req, res) => {
  const install = req.appInstall!;
  const { mode, orderId } = req.body as z.infer<typeof startSchema>;

  const client = await pool.connect();
  let order: { id: string; status: string; amount_fcfa: number };
  let session: Extract<Awaited<ReturnType<typeof createSessionForOrder>>, { ok: true }>['session'];
  let coverage: 'subscription' | 'company' | 'free_offer' | 'paid_forfait';
  let scope: string | null = null;
  try {
    await client.query('BEGIN');
    // Sérialise les demandes d'un même email ou d'un même appareil : pas de double offre en parallèle.
    // Verrous pris dans un ordre fixe pour éviter les interblocages.
    const lockKeys = [install.email, install.hardwareHash ?? ''].filter(Boolean).sort();
    for (const key of lockKeys) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
    }

    // Toutes les lectures passent par `client` : une seule connexion par requête (pas d'attente croisée sur le pool).
    let paidOrder: { id: string; plan_id: string; scope: string | null } | undefined;
    if (orderId) {
      const found = await client.query(
        `SELECT o.id, o.plan_id, p.metadata->>'scope' AS scope
         FROM orders o JOIN pricing_plans p ON p.id = o.plan_id
         WHERE o.id = $1 AND o.app_install_id = $2 AND o.status = 'paid'
           AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.order_id = o.id)
         FOR UPDATE OF o`,
        [orderId, install.id],
      );
      paidOrder = found.rows[0];
      if (!paidOrder) {
        await client.query('ROLLBACK');
        return res.status(402).json({ error: 'Forfait non payé ou déjà utilisé.', code: 'payment_required' });
      }
    }

    const subscription = paidOrder ? null : await activeSubscription(client, install.email);
    let planId: string;
    if (paidOrder) {
      coverage = 'paid_forfait';
      planId = paidOrder.plan_id;
      scope = paidOrder.scope;
    } else if (subscription) {
      coverage = 'subscription';
      planId = SUBSCRIBER_PLAN_ID;
    } else if (await companyCovers(client, install.id)) {
      coverage = 'company';
      planId = SUBSCRIBER_PLAN_ID;
    } else if (!(await freeOfferUsed(client, install.email, install.hardwareHash))) {
      coverage = 'free_offer';
      planId = FREE_OFFER_PLAN_ID;
      if (!freeLaunch()) await client.query('UPDATE app_installs SET free_offer_used_at = now() WHERE id = $1', [install.id]);
    } else {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error: 'Votre assistance offerte a déjà été utilisée. Choisissez un forfait pour continuer.',
        code: 'subscription_required',
        subscriptionPlanId: SUBSCRIPTION_PLAN_ID,
        forfaitPlanIds: ['diagnostic_express', 'assistance_rapide'],
      });
    }

    if (paidOrder) {
      const existing = await client.query('UPDATE orders SET mode = $2 WHERE id = $1 RETURNING id, status, amount_fcfa', [paidOrder.id, mode]);
      order = existing.rows[0];
    } else {
      const inserted = await client.query(
        `INSERT INTO orders (client_phone, client_name, client_email, app_install_id, plan_id, amount_fcfa, status, paid_at, platform, mode)
         VALUES ($1, $2, $3, $4, $5, 0, 'paid', now(), $6, $7)
         RETURNING id, status, amount_fcfa`,
        [install.phone, install.name, install.email, install.id, planId, install.platform, mode],
      );
      order = inserted.rows[0];
    }

    // La session est créée dans la même transaction : si elle échoue, l'offerte n'est pas consommée.
    const created = await createSessionForOrder(order.id, install.platform, mode, client);
    if (!created.ok) {
      await client.query('ROLLBACK');
      return res.status(created.status).json({
        error: created.error,
        ...(created.code ? { code: created.code } : {}),
        ...(created.code === 'human_not_included' ? { upgrade: await upgradeOffer() } : {}),
      });
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
    // Portée de l'assistance : diagnostic (aucune modification), fix (un problème précis) ou full (jusqu'à résolution).
    scope: scope ?? 'full',
    // true : l'agent IA a été demandé mais n'est pas activé, un technicien prend le relais.
    fallbackToHuman: mode === 'ia' && session.mode === 'humain',
    // Un technicien fait-il partie de cette assistance ? (offre « IA seule » : non, sauf complément payé)
    humanIncluded: session.human_included,
    ...(session.human_included ? {} : { upgrade: await upgradeOffer() }),
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  await expireOverdueSessions(pool);
  const install = req.appInstall!;
  const body = req.body as z.infer<typeof eventSchema>;
  if (!UUID.test(req.params.id!)) return res.status(404).json({ error: 'Session introuvable' });

  // La session doit appartenir à CETTE installation, via sa commande.
  const owned = await pool.query(
    `SELECT s.id, s.order_id, s.human_included FROM sessions s JOIN orders o ON o.id = s.order_id
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
    details: { ...(body.details ?? {}), skill: body.skill, action: body.action, message: body.message },
  });

  // Offre « IA seule » : pas de technicien. Le serveur ne prévient personne et le dit ; l'agent propose le complément au client.
  if (body.type === 'escalated' && owned.rows[0].human_included === false) {
    return res.status(201).json({ recorded: true, humanIncluded: false, upgrade: await upgradeOffer() });
  }
  // Quand l'agent passe la main, la session rejoint la file des techniciens.
  if (body.type === 'escalated') {
    await pool.query(`UPDATE sessions SET mode = 'humain' WHERE id = $1 AND status IN ('created','waiting_technician','active')`, [
      req.params.id,
    ]);
    alertInBackground(req.params.id!, body.message);
  }
  res.status(201).json({ recorded: true });
});

/** Session téléphone appartenant à cette installation (via sa commande), encore ouverte. */
async function ownedOpenAndroidSession(sessionId: string, installId: string) {
  if (!UUID.test(sessionId)) return null;
  const { rows } = await pool.query(
    `SELECT s.id, s.order_id, s.human_included FROM sessions s JOIN orders o ON o.id = s.order_id
     WHERE s.id = $1 AND o.app_install_id = $2 AND s.platform = 'android' AND s.status IN ('created','waiting_technician','active')`,
    [sessionId, installId],
  );
  return rows[0] ?? null;
}

/** Réglages du serveur d'assistance à distance, à saisir une fois dans l'application RustDesk du téléphone. */
appRouter.get('/app/sessions/:id/android-remote', limiter, requireAppInstall, async (req, res) => {
  await expireOverdueSessions(pool);
  const session = await ownedOpenAndroidSession(req.params.id!, req.appInstall!.id);
  if (!session) return res.status(404).json({ error: 'Session introuvable' });
  if (session.human_included === false) return res.status(402).json({ error: 'human_not_included' });
  const idServer = process.env.RUSTDESK_ID_SERVER;
  const key = process.env.RUSTDESK_PUBLIC_KEY;
  if (!idServer || !key) return res.status(503).json({ error: "Le contrôle à distance n'est pas encore disponible." });
  res.json({ idServer, relayServer: process.env.RUSTDESK_RELAY_SERVER ?? idServer, key });
});

/** Session de cette installation (n'importe quelle plateforme), encore ouverte. */
async function ownedOpenSession(sessionId: string, installId: string) {
  if (!UUID.test(sessionId)) return null;
  const { rows } = await pool.query(
    `SELECT s.id, s.order_id, s.human_included FROM sessions s JOIN orders o ON o.id = s.order_id
     WHERE s.id = $1 AND o.app_install_id = $2 AND s.status IN ('created','waiting_technician','active')`,
    [sessionId, installId],
  );
  return rows[0] ?? null;
}

/**
 * Prise en main du PC par l'agent Windows : réglages du serveur RustDesk (`custom: false` = réseau public RustDesk).
 * L'agent épingle lui-même la version et l'empreinte du client RustDesk : le serveur ne lui dit jamais quoi télécharger.
 */
appRouter.get('/app/sessions/:id/remote-config', limiter, requireAppInstall, async (req, res) => {
  await expireOverdueSessions(pool);
  const session = await ownedOpenSession(req.params.id!, req.appInstall!.id);
  if (!session) return res.status(404).json({ error: 'Session introuvable' });
  if (session.human_included === false) return res.status(402).json({ error: 'human_not_included' });
  const server = selfHostedRustdesk();
  res.json(server ? { custom: true, ...server } : { custom: false });
});

/**
 * L'agent a préparé RustDesk sur le PC, après l'accord explicite du client (affiché dans l'agent) : il envoie l'identifiant
 * et le mot de passe. Le mot de passe est chiffré ; le technicien ne le voit qu'une fois assigné à la session.
 */
appRouter.post('/app/sessions/:id/remote', limiter, requireAppInstall, validateBody(z.object({
  remotePeerId: z.string().trim().regex(/^\d{6,12}$/, "L'identifiant RustDesk comporte uniquement des chiffres"),
  remotePassword: z.string().trim().regex(/^[A-Za-z0-9]{6,64}$/, 'Mot de passe invalide'),
})), async (req, res) => {
  await expireOverdueSessions(pool);
  const session = await ownedOpenSession(req.params.id!, req.appInstall!.id);
  if (!session) return res.status(404).json({ error: 'Session introuvable' });
  if (session.human_included === false) return res.status(402).json({ error: 'human_not_included' });
  const body = req.body as { remotePeerId: string; remotePassword: string };
  await pool.query(
    `UPDATE sessions SET remote_peer_id = $2, remote_password_encrypted = $3, remote_paired_at = now(),
       consent_control_at = COALESCE(consent_control_at, now()), consent_screen_at = COALESCE(consent_screen_at, now())
     WHERE id = $1`,
    [session.id, body.remotePeerId, encryptSecret(body.remotePassword)],
  );
  await logAudit(pool, {
    actorType: 'client',
    actorId: req.appInstall!.email,
    sessionId: session.id,
    orderId: session.order_id,
    action: 'session.agent_remote_shared',
    details: { remoteProvider: 'rustdesk', platform: 'windows' },
  });
  res.status(201).json({ shared: true });
});

const androidRemoteSchema = z.object({
  remotePeerId: z.string().trim().regex(/^\d{6,12}$/, "L'identifiant RustDesk comporte uniquement des chiffres"),
  remotePassword: z.string().trim().min(4).max(64),
});

/**
 * Le client donne l'identifiant et le mot de passe affichés par RustDesk sur son téléphone : c'est son accord
 * explicite pour la prise en main. Le mot de passe est chiffré ; le technicien ne le voit qu'une fois assigné.
 */
appRouter.post('/app/sessions/:id/android-remote', limiter, requireAppInstall, validateBody(androidRemoteSchema), async (req, res) => {
  await expireOverdueSessions(pool);
  const session = await ownedOpenAndroidSession(req.params.id!, req.appInstall!.id);
  if (!session) return res.status(404).json({ error: 'Session introuvable' });
  if (session.human_included === false) return res.status(402).json({ error: 'human_not_included' });
  const body = req.body as z.infer<typeof androidRemoteSchema>;
  await pool.query(
    `UPDATE sessions SET remote_peer_id = $2, remote_password_encrypted = $3, remote_paired_at = now(),
       consent_control_at = COALESCE(consent_control_at, now()), consent_screen_at = COALESCE(consent_screen_at, now())
     WHERE id = $1`,
    [session.id, body.remotePeerId, encryptSecret(body.remotePassword)],
  );
  await logAudit(pool, {
    actorType: 'client',
    actorId: req.appInstall!.email,
    sessionId: session.id,
    orderId: session.order_id,
    action: 'session.android_remote_shared',
    details: { remoteProvider: 'rustdesk', platform: 'android' },
  });
  res.status(201).json({ shared: true });
});

const chatSchema = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
  /** Le problème tel que le client l'a décrit (quand `message` est une consigne de l'agent) : sert à chercher au lexique et à apprendre. */
  topic: z.string().trim().min(3).max(200).optional(),
  /** Mode formation : identifiants d'un catalogue fermé (le texte des consignes vient du serveur). */
  lesson: z
    .object({
      track: z.enum(TRAINING_TRACK_IDS),
      level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
      step: z.enum(TRAINING_STEPS),
      index: z.number().int().min(1).max(50),
    })
    .optional(),
  image: z.object({ mime: z.enum(['image/png', 'image/jpeg']), data: z.string().min(1).max(MAX_IMAGE_BASE64_CHARS) }).optional(),
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

  if (body.image && !imageMatchesMime(body.image)) {
    return res.status(400).json({ error: "L'image jointe n'est pas une capture PNG ou JPEG valide." });
  }

  // Le lexique d'abord ; une fiche confirmée par des clients répond SANS appeler l'IA. Sinon l'IA répond ET enrichit le lexique pour la prochaine fois.
  const subject = body.topic ?? body.message;
  const lexique = body.lesson ? { entries: [], confident: true } : await searchLexique(subject).catch(() => ({ entries: [], confident: true }));
  // Pas de réponse mémorisée au 2e tour d'une conversation : le client a déjà reçu la fiche et il faut autre chose.
  const remembered = body.lesson || body.image || body.history.length > 0 ? null : memoryAnswer(lexique.entries);
  let answer: { text: string; model: string };
  if (remembered) {
    answer = { text: remembered.text, model: 'memoire' };
  } else {
    try {
      answer = await askOfficeAssistant(body.message, body.history, {
        image: body.image,
        context: contextFrom(lexique.entries),
        platform: install.platform === 'android' ? 'android' : 'windows',
        lesson: body.lesson ? { track: findTrack(body.lesson.track)!, level: body.lesson.level, step: body.lesson.step, index: body.lesson.index } : undefined,
      });
    } catch (err) {
      if (!(err instanceof AssistantUnavailableError)) throw err;
      console.error(`[assistant] indisponible : ${err.message}`);
      return res.status(503).json({ code: 'assistant_unavailable', error: "L'assistant en ligne n'est pas disponible pour le moment." });
    }
  }

  await logAudit(pool, {
    actorType: 'client',
    actorId: install.email,
    sessionId: session.id,
    orderId: session.order_id,
    action: 'agent.chat',
    details: {
      question: subject.slice(0, 300),
      answer: answer.text.slice(0, 500),
      usedIds: remembered ? [remembered.id] : usedFicheIds(lexique.entries),
      answerFull: answer.text.slice(0, 2500),
      model: answer.model,
      ...(body.lesson ? { lesson: body.lesson } : {}),
      ...(body.image ? { image: true } : {}), // l'image elle-même n'est jamais conservée
    },
  });
  if (!lexique.confident && !body.lesson && subject.trim().length >= 6) void enrichInBackground(subject);
  res.json({ answer: answer.text });
});
