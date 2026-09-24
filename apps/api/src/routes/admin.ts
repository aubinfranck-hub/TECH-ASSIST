import { Router } from 'express';
import bcrypt from 'bcryptjs';
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

const createTechnicianSchema = z.object({
  fullName: z.string().min(2).max(120),
  phone: z.string().regex(/^\+?[0-9]{8,15}$/, 'Numéro de téléphone invalide'),
  username: z.string().min(3).max(60),
  password: z.string().min(8).max(200),
  role: z.enum(['technician', 'admin']).default('technician'),
});

/** Création de comptes technicien/admin en continu, au-delà de l'amorçage initial. */
adminRouter.post('/technicians', validateBody(createTechnicianSchema), async (req, res) => {
  const body = req.body as z.infer<typeof createTechnicianSchema>;
  const passwordHash = await bcrypt.hash(body.password, 12);

  try {
    const { rows } = await pool.query(
      `INSERT INTO technicians (full_name, phone, username, password_hash, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, username, role`,
      [body.fullName, body.phone, body.username, passwordHash, body.role],
    );
    await logAudit(pool, {
      actorType: 'admin',
      actorId: req.auth!.sub,
      action: 'technician.created',
      details: { createdTechnicianId: rows[0].id, role: body.role },
    });
    res.status(201).json({ technician: rows[0] });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return res.status(409).json({ error: 'Cet identifiant de connexion est déjà utilisé' });
    }
    throw err;
  }
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

/** RS-08 : récupération de compte — un admin peut réinitialiser la 2FA d'un technicien bloqué. */
adminRouter.post('/technicians/:id/2fa/reset', async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE technicians SET totp_secret = NULL, totp_enabled = FALSE, totp_pending_secret = NULL
     WHERE id = $1 RETURNING id, username`,
    [req.params.id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Technicien introuvable' });

  await logAudit(pool, {
    actorType: 'admin',
    actorId: req.auth!.sub,
    action: 'auth.totp_reset_by_admin',
    details: { technicianId: req.params.id },
  });

  res.json({ technician: rows[0] });
});

/** RP-01 : liste des entreprises PME, pour suivi commercial et support. */
adminRouter.get('/companies', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.phone, c.subscription_status, c.subscription_plan_id,
            p.name AS plan_name, t.full_name AS assigned_technician_name, c.created_at
     FROM companies c
     LEFT JOIN pricing_plans p ON p.id = c.subscription_plan_id
     LEFT JOIN technicians t ON t.id = c.assigned_technician_id
     ORDER BY c.created_at DESC`,
  );
  res.json({ companies: rows });
});

const createCompanySchema = z.object({
  name: z.string().min(2).max(200),
  phone: z.string().regex(/^\+?[0-9]{8,15}$/),
  email: z.string().email().optional(),
  subscriptionPlanId: z.string().min(1),
  adminFullName: z.string().min(2).max(120),
  adminPhone: z.string().regex(/^\+?[0-9]{8,15}$/),
  adminUsername: z.string().min(3).max(60),
});

/**
 * RP-01 : conversion d'une demande PME en espace entreprise — crée
 * l'entreprise et son premier compte administrateur (mot de passe généré,
 * affiché une seule fois, jamais stocké en clair).
 */
adminRouter.post('/companies', validateBody(createCompanySchema), async (req, res) => {
  const body = req.body as z.infer<typeof createCompanySchema>;

  const planCheck = await pool.query(
    `SELECT id FROM pricing_plans WHERE id = $1 AND segment = 'pme' AND active = TRUE`,
    [body.subscriptionPlanId],
  );
  if (planCheck.rows.length === 0) {
    return res.status(404).json({ error: 'Formule PME inconnue ou inactive' });
  }

  const password = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  const passwordHash = await bcrypt.hash(password, 12);

  // Transaction : l'entreprise et son premier compte admin sont créés
  // ensemble, ou pas du tout (pas d'entreprise orpheline sans compte).
  const client = await pool.connect();
  let companyId: string;
  try {
    await client.query('BEGIN');
    const companyResult = await client.query(
      `INSERT INTO companies (name, phone, email, subscription_plan_id, subscription_status)
       VALUES ($1, $2, $3, $4, 'trial') RETURNING id`,
      [body.name, body.phone, body.email ?? null, body.subscriptionPlanId],
    );
    companyId = companyResult.rows[0].id;

    await client.query(
      `INSERT INTO company_users (company_id, full_name, phone, username, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, 'admin')`,
      [companyId, body.adminFullName, body.adminPhone, body.adminUsername, passwordHash],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if ((err as { code?: string }).code === '23505') {
      return res.status(409).json({ error: 'Cet identifiant de connexion est déjà utilisé' });
    }
    throw err;
  } finally {
    client.release();
  }

  await logAudit(pool, { actorType: 'admin', actorId: req.auth!.sub, action: 'company.created', details: { companyId } });

  res.status(201).json({ companyId, adminUsername: body.adminUsername, adminPassword: password });
});

const updateCompanySchema = z.object({
  subscriptionPlanId: z.string().min(1).optional(),
  subscriptionStatus: z.enum(['trial', 'active', 'suspended', 'cancelled']).optional(),
  assignedTechnicianId: z.string().uuid().nullable().optional(),
});

adminRouter.patch('/companies/:id', validateBody(updateCompanySchema), async (req, res) => {
  const body = req.body as z.infer<typeof updateCompanySchema>;
  const { rows } = await pool.query(
    `UPDATE companies SET
       subscription_plan_id = COALESCE($2, subscription_plan_id),
       subscription_status = COALESCE($3, subscription_status),
       assigned_technician_id = CASE WHEN $4::boolean THEN $5::uuid ELSE assigned_technician_id END
     WHERE id = $1
     RETURNING id, subscription_plan_id, subscription_status, assigned_technician_id`,
    [
      req.params.id,
      body.subscriptionPlanId ?? null,
      body.subscriptionStatus ?? null,
      'assignedTechnicianId' in body,
      body.assignedTechnicianId ?? null,
    ],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Entreprise introuvable' });
  res.json({ company: rows[0] });
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
