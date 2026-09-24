import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { logAudit } from '../utils/audit.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';

export const ordersRouter = Router();

const createOrderSchema = z.object({
  clientPhone: z
    .string()
    .regex(/^\+?[0-9]{8,15}$/, 'Numéro de téléphone invalide'),
  clientName: z.string().max(120).optional(),
  planId: z.string().min(1),
  platform: z.enum(['web', 'windows', 'android']).default('web'),
});

/** RF-02 : commande sans création de compte lourde (téléphone suffit). */
ordersRouter.post('/', validateBody(createOrderSchema), async (req, res) => {
  const { clientPhone, clientName, planId, platform } = req.body as z.infer<typeof createOrderSchema>;

  const planResult = await pool.query(
    'SELECT id, price_fcfa FROM pricing_plans WHERE id = $1 AND active = TRUE',
    [planId],
  );
  const plan = planResult.rows[0];
  if (!plan) {
    return res.status(404).json({ error: 'Formule inconnue ou inactive' });
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
            p.name AS plan_name, p.duration_minutes
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
    const { rows } = await pool.query(
      `UPDATE orders SET status = 'paid', paid_at = now(), paid_by_technician_id = $2
       WHERE id = $1 AND status = 'pending_payment'
       RETURNING id, status, paid_at`,
      [req.params.id, req.auth!.sub],
    );
    if (rows.length === 0) {
      return res.status(409).json({ error: 'Commande déjà traitée ou introuvable' });
    }

    await logAudit(pool, {
      actorType: 'technician',
      actorId: req.auth!.sub,
      orderId: req.params.id,
      action: 'order.payment_confirmed',
    });

    res.json({ order: rows[0] });
  },
);
