import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { logAudit } from '../utils/audit.js';
import { validateBody } from '../middleware/validate.js';
import { markOrderPaid } from '../payments/markPaid.js';
import { requireAuth } from '../middleware/auth.js';

export const ordersRouter = Router();

// Limite dédiée à la création de commande (action publique, non
// authentifiée) — n'affecte pas les GET authentifiés du même router,
// interrogés régulièrement par la console technicien (voir app.ts).
const createOrderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

const createOrderSchema = z.object({
  clientPhone: z
    .string()
    .regex(/^\+?[0-9]{8,15}$/, 'Numéro de téléphone invalide'),
  clientName: z.string().max(120).optional(),
  planId: z.string().min(1),
  platform: z.enum(['web', 'windows', 'android']).default('web'),
});

/** RF-02 : commande sans création de compte lourde (téléphone suffit). */
ordersRouter.post('/', createOrderLimiter, validateBody(createOrderSchema), async (req, res) => {
  const { clientPhone, clientName, planId, platform } = req.body as z.infer<typeof createOrderSchema>;

  const planResult = await pool.query(
    'SELECT id, price_fcfa, metadata FROM pricing_plans WHERE id = $1 AND active = TRUE',
    [planId],
  );
  const plan = planResult.rows[0];
  if (!plan) {
    return res.status(404).json({ error: 'Formule inconnue ou inactive' });
  }
  // L'offre gratuite, l'abonnement et la couverture abonné ont leurs propres
  // routes (/api/assistance, /api/subscriptions) qui vérifient les droits :
  // les commander ici permettrait de contourner ces vérifications.
  if (plan.metadata?.subscription || plan.metadata?.freePerPhone || plan.metadata?.coveredBySubscription) {
    return res.status(400).json({ error: 'Cette formule se commande depuis la page Assistance.' });
  }

  const { rows } = await pool.query(
    `INSERT INTO orders (client_phone, client_name, plan_id, amount_fcfa, platform)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, status, amount_fcfa, created_at`,
    [clientPhone, clientName ?? null, plan.id, plan.price_fcfa, platform],
  );
  const order = rows[0];

  await logAudit(pool, {
    actorType: 'client',
    actorId: clientPhone,
    orderId: order.id,
    action: 'order.created',
    details: { planId },
  });

  res.status(201).json({ order });
});

/** RF-03 : commandes en attente de confirmation, visibles par tout technicien (pas seulement l'admin). */
ordersRouter.get('/pending-payment', requireAuth('technician', 'admin'), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT o.id, o.client_phone, o.client_name, o.status, o.amount_fcfa, o.created_at,
            p.name AS plan_name
     FROM orders o JOIN pricing_plans p ON p.id = o.plan_id
     WHERE o.status = 'pending_payment'
     ORDER BY o.created_at ASC LIMIT 100`,
  );
  res.json({ orders: rows });
});

ordersRouter.get('/:id', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT o.id, o.status, o.amount_fcfa, o.platform, o.created_at, o.paid_at,
            p.id AS plan_id, p.name AS plan_name, p.duration_minutes
     FROM orders o JOIN pricing_plans p ON p.id = o.plan_id
     WHERE o.id = $1`,
    [req.params.id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Commande introuvable' });
  res.json({ order: rows[0] });
});

/**
 * TA[DECIDER][D3] Pas d'agrégateur Mobile Money branché : un technicien/admin
 * confirme manuellement la réception du paiement (déjà pratiqué ainsi, cf. cahier des charges).
 * À remplacer par un webhook signé dès que D3 est tranché (RF-03).
 */
ordersRouter.post(
  '/:id/confirm-payment',
  requireAuth('technician', 'admin'),
  async (req, res) => {
    const result = await markOrderPaid(req.params.id, { technicianId: req.auth!.sub });
    if (!result.ok) return res.status(409).json({ error: 'Commande déjà traitée ou introuvable' });
    res.json({ order: result.order, subscription: result.subscription });
  },
);
