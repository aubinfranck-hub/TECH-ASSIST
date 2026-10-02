import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { validateBody } from '../middleware/validate.js';
import { logAudit } from '../utils/audit.js';
import { createSessionForOrder } from './sessions.js';

export const assistanceRouter = Router();

/** Formules internes : jamais commandables directement via POST /api/orders. */
export const FREE_OFFER_PLAN_ID = 'assistance_offerte';
export const SUBSCRIPTION_PLAN_ID = 'abonnement_mensuel';
export const SUBSCRIBER_PLAN_ID = 'assistance_abonne';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

const phoneSchema = z.string().regex(/^\+?[0-9]{8,15}$/, 'Numéro de téléphone invalide');

/**
 * Tant que l'agent IA n'est pas branché (AI_AGENT_ENABLED=true), une demande en
 * mode « ia » est honnêtement redirigée vers un technicien : le client n'est
 * jamais laissé devant un agent qui n'existe pas.
 */
export function aiAgentAvailable(): boolean {
  return process.env.AI_AGENT_ENABLED === 'true';
}

async function activeSubscription(phone: string) {
  const { rows } = await pool.query(
    `SELECT id, starts_at, ends_at FROM subscriptions
     WHERE client_phone = $1 AND status = 'active' AND ends_at > now()
     ORDER BY ends_at DESC LIMIT 1`,
    [phone],
  );
  return rows[0] as { id: string; starts_at: Date; ends_at: Date } | undefined;
}

async function freeOfferUsed(phone: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM orders WHERE client_phone = $1 AND plan_id = $2 AND status <> 'cancelled' LIMIT 1`,
    [phone, FREE_OFFER_PLAN_ID],
  );
  return rows.length > 0;
}

const eligibilitySchema = z.object({ clientPhone: phoneSchema });

/** Ce à quoi le client a droit : assistance offerte, abonnement en cours, agent IA disponible. */
assistanceRouter.post('/assistance/eligibility', limiter, validateBody(eligibilitySchema), async (req, res) => {
  const { clientPhone } = req.body as z.infer<typeof eligibilitySchema>;
  const [subscription, used] = await Promise.all([activeSubscription(clientPhone), freeOfferUsed(clientPhone)]);
  res.json({
    freeOfferAvailable: !used,
    subscription: subscription ? { endsAt: subscription.ends_at } : null,
    aiAgentAvailable: aiAgentAvailable(),
  });
});

const startSchema = z.object({
  clientPhone: phoneSchema,
  clientName: z.string().max(120).optional(),
  // L'agent IA est le mode par défaut ; le technicien humain reste un choix.
  mode: z.enum(['ia', 'humain']).default('ia'),
  platform: z.enum(['web', 'windows', 'android']).default('web'),
});

/**
 * Démarre une assistance couverte : 1re assistance offerte (une par numéro),
 * puis uniquement avec un abonnement actif. Couverture vérifiée ici, côté
 * serveur — le client ne choisit jamais lui-même une formule à 0 FCFA.
 */
assistanceRouter.post('/assistance', limiter, validateBody(startSchema), async (req, res) => {
  const { clientPhone, clientName, mode, platform } = req.body as z.infer<typeof startSchema>;

  const client = await pool.connect();
  let order: { id: string; status: string; amount_fcfa: number };
  let coverage: 'subscription' | 'free_offer';
  try {
    await client.query('BEGIN');
    // Sérialise les demandes d'un même numéro : pas de double offre gratuite en parallèle.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [clientPhone]);

    const subscription = await activeSubscription(clientPhone);
    let planId: string;
    if (subscription) {
      coverage = 'subscription';
      planId = SUBSCRIBER_PLAN_ID;
    } else if (!(await freeOfferUsed(clientPhone))) {
      coverage = 'free_offer';
      planId = FREE_OFFER_PLAN_ID;
    } else {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error: 'Votre assistance offerte a déjà été utilisée. Abonnez-vous pour continuer.',
        code: 'subscription_required',
        subscriptionPlanId: SUBSCRIPTION_PLAN_ID,
      });
    }

    const inserted = await client.query(
      `INSERT INTO orders (client_phone, client_name, plan_id, amount_fcfa, status, paid_at, platform, mode)
       VALUES ($1, $2, $3, 0, 'paid', now(), $4, $5)
       RETURNING id, status, amount_fcfa`,
      [clientPhone, clientName ?? null, planId, platform, mode],
    );
    order = inserted.rows[0];
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  const result = await createSessionForOrder(order.id, platform, mode);
  if (!result.ok) return res.status(result.status).json({ error: result.error });

  await logAudit(pool, {
    actorType: 'client',
    actorId: clientPhone,
    orderId: order.id,
    sessionId: result.session.id,
    action: 'assistance.started',
    details: { coverage, requestedMode: mode, mode: result.session.mode },
  });

  res.status(201).json({
    order,
    session: result.session,
    coverage,
    // true : l'agent IA a été demandé mais n'est pas encore actif, un technicien prend le relais.
    fallbackToHuman: mode === 'ia' && result.session.mode === 'humain',
  });
});

const subscribeSchema = z.object({
  clientPhone: phoneSchema,
  clientName: z.string().max(120).optional(),
  platform: z.enum(['web', 'windows', 'android']).default('web'),
});

/**
 * Abonnement mensuel : crée la commande à payer (Mobile Money, confirmation
 * manuelle D3) ; l'abonnement s'active quand le paiement est confirmé.
 */
assistanceRouter.post('/subscriptions', limiter, validateBody(subscribeSchema), async (req, res) => {
  const { clientPhone, clientName, platform } = req.body as z.infer<typeof subscribeSchema>;

  const planResult = await pool.query(
    'SELECT id, price_fcfa FROM pricing_plans WHERE id = $1 AND active = TRUE',
    [SUBSCRIPTION_PLAN_ID],
  );
  const plan = planResult.rows[0];
  if (!plan) return res.status(404).json({ error: 'Abonnement indisponible pour le moment' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderResult = await client.query(
      `INSERT INTO orders (client_phone, client_name, plan_id, amount_fcfa, platform)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, status, amount_fcfa, created_at`,
      [clientPhone, clientName ?? null, plan.id, plan.price_fcfa, platform],
    );
    const order = orderResult.rows[0];
    await client.query(
      `INSERT INTO subscriptions (client_phone, client_name, plan_id, order_id)
       VALUES ($1, $2, $3, $4)`,
      [clientPhone, clientName ?? null, plan.id, order.id],
    );
    await client.query('COMMIT');

    await logAudit(pool, {
      actorType: 'client',
      actorId: clientPhone,
      orderId: order.id,
      action: 'subscription.requested',
    });
    res.status(201).json({ order });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
});
