import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { logAudit } from '../utils/audit.js';

export const adminRouter = Router();
adminRouter.use(requireAuth('admin'));

adminRouter.get('/orders', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const { rows } = await pool.query(
    `SELECT o.id, o.client_phone, o.client_name, o.status, o.amount_fcfa, o.platform, o.created_at, o.paid_at,
            p.name AS plan_name
     FROM orders o JOIN pricing_plans p ON p.id = o.plan_id
     WHERE $1::text IS NULL OR o.status = $1
     ORDER BY o.created_at DESC LIMIT 200`,
    [status ?? null],
  );
  res.json({ orders: rows });
});

const refundSchema = z.object({ reason: z.string().min(3).max(500) });

/** RF-42 : remboursements et litiges journalisés. */
adminRouter.post('/orders/:id/refund', validateBody(refundSchema), async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE orders SET status = 'refunded' WHERE id = $1 AND status = 'paid' RETURNING id, status`,
    [req.params.id],
  );
  if (rows.length === 0) return res.status(409).json({ error: 'Commande non remboursable' });

  await logAudit(pool, {
    actorType: 'admin',
    actorId: req.auth!.sub,
    orderId: req.params.id,
    action: 'order.refunded',
    details: { reason: req.body.reason },
  });

  res.json({ order: rows[0] });
});

const planUpsertSchema = z.object({
  name: z.string().min(1).max(120),
  segment: z.enum(['particulier', 'pme']),
  priceFcfa: z.number().int().min(0),
  durationMinutes: z.number().int().positive().optional(),
  description: z.string().max(1000).default(''),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

/** RF-41 : tarifs paramétrables sans redéploiement. */
adminRouter.put('/pricing/:id', validateBody(planUpsertSchema), async (req, res) => {
  const body = req.body as z.infer<typeof planUpsertSchema>;
  const { rows } = await pool.query(
    `INSERT INTO pricing_plans (id, name, segment, price_fcfa, duration_minutes, description, active, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, segment = EXCLUDED.segment, price_fcfa = EXCLUDED.price_fcfa,
       duration_minutes = EXCLUDED.duration_minutes, description = EXCLUDED.description,
       active = EXCLUDED.active, sort_order = EXCLUDED.sort_order, updated_at = now()
     RETURNING *`,
    [req.params.id, body.name, body.segment, body.priceFcfa, body.durationMinutes ?? null, body.description, body.active, body.sortOrder],
  );

  await logAudit(pool, {
    actorType: 'admin',
    actorId: req.auth!.sub,
    action: 'pricing.updated',
    details: { planId: req.params.id },
  });

  res.json({ plan: rows[0] });
});

adminRouter.get('/technician-applications', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, full_name, phone, skills, status, created_at FROM technician_applications ORDER BY created_at DESC`,
  );
  res.json({ applications: rows });
});

adminRouter.get('/pme-requests', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, company_name, contact_name, phone, email, computers_count, status, created_at FROM pme_requests ORDER BY created_at DESC`,
  );
  res.json({ requests: rows });
});

adminRouter.get('/visit-requests', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, full_name, phone, address, zone, description, status, created_at FROM visit_requests ORDER BY created_at DESC`,
  );
  res.json({ requests: rows });
});

/** RS-06 : consultation du journal d'audit. */
adminRouter.get('/audit-logs', async (req, res) => {
  const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
  const { rows } = await pool.query(
    `SELECT id, actor_type, actor_id, session_id, order_id, action, details, created_at
     FROM audit_logs WHERE $1::uuid IS NULL OR session_id = $1
     ORDER BY created_at DESC LIMIT 500`,
    [sessionId ?? null],
  );
  res.json({ logs: rows });
});
