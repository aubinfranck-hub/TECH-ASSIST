import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireCompanyAuth } from '../middleware/companyAuth.js';
import { validateBody } from '../middleware/validate.js';
import { logAudit } from '../utils/audit.js';
import { createSessionForOrder } from './sessions.js';

export const companyRouter = Router();
companyRouter.use(requireCompanyAuth());

/** RP-01 : informations de l'espace entreprise (abonnement, technicien attitré). */
companyRouter.get('/me', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.phone, c.email, c.subscription_status,
            p.id AS plan_id, p.name AS plan_name, p.price_fcfa, p.metadata,
            t.full_name AS assigned_technician_name
     FROM companies c
     LEFT JOIN pricing_plans p ON p.id = c.subscription_plan_id
     LEFT JOIN technicians t ON t.id = c.assigned_technician_id
     WHERE c.id = $1`,
    [req.companyAuth!.companyId],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Entreprise introuvable' });
  res.json({ company: rows[0], role: req.companyAuth!.role });
});

/** RP-08 : gestion des comptes employés (réservé aux administrateurs de l'entreprise). */
companyRouter.get('/users', requireCompanyAuth('admin'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, full_name, phone, username, role, is_active, created_at
     FROM company_users WHERE company_id = $1 ORDER BY created_at ASC`,
    [req.companyAuth!.companyId],
  );
  res.json({ users: rows });
});

const createUserSchema = z.object({
  fullName: z.string().min(2).max(120),
  phone: z.string().regex(/^\+?[0-9]{8,15}$/),
  username: z.string().min(3).max(60),
  password: z.string().min(8).max(200),
  role: z.enum(['admin', 'employee']).default('employee'),
});

companyRouter.post('/users', requireCompanyAuth('admin'), validateBody(createUserSchema), async (req, res) => {
  const body = req.body as z.infer<typeof createUserSchema>;
  const passwordHash = await bcrypt.hash(body.password, 12);
  const { rows } = await pool.query(
    `INSERT INTO company_users (company_id, full_name, phone, username, password_hash, role)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, full_name, username, role`,
    [req.companyAuth!.companyId, body.fullName, body.phone, body.username, passwordHash, body.role],
  );
  res.status(201).json({ user: rows[0] });
});

/** RP-04 : consentement écrit du dirigeant avant toute installation d'agent permanent. */
companyRouter.post('/consent', requireCompanyAuth('admin'), async (req, res) => {
  const { rows } = await pool.query(
    `INSERT INTO company_consents (company_id, signed_by_company_user_id)
     VALUES ($1, $2) RETURNING id, signed_at`,
    [req.companyAuth!.companyId, req.companyAuth!.sub],
  );
  await logAudit(pool, {
    actorType: 'admin',
    actorId: req.companyAuth!.sub,
    action: 'company.consent_signed',
    details: { companyId: req.companyAuth!.companyId },
  });
  res.status(201).json({ consent: rows[0] });
});

/** RP-05 : inventaire du parc. */
companyRouter.get('/devices', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, device_name, platform, disk_free_percent, memory_used_percent,
            antivirus_ok, os_up_to_date, last_seen_at
     FROM company_devices WHERE company_id = $1 ORDER BY device_name ASC`,
    [req.companyAuth!.companyId],
  );
  res.json({ devices: rows });
});

const deviceHeartbeatSchema = z.object({
  deviceName: z.string().min(1).max(120),
  platform: z.enum(['windows', 'android']),
  diskFreePercent: z.number().int().min(0).max(100).optional(),
  memoryUsedPercent: z.number().int().min(0).max(100).optional(),
  antivirusOk: z.boolean().optional(),
  osUpToDate: z.boolean().optional(),
});

/**
 * RP-05 : enregistrement/mise à jour d'un poste. Destiné à être appelé par
 * l'agent permanent PME (TA[MANQUANT] : agent Windows non construit dans cet
 * environnement — endpoint prêt à le recevoir) ; utilisable aussi à la main
 * depuis la console pour amorcer l'inventaire.
 */
companyRouter.post('/devices/heartbeat', validateBody(deviceHeartbeatSchema), async (req, res) => {
  const body = req.body as z.infer<typeof deviceHeartbeatSchema>;
  await pool.query(
    `INSERT INTO company_devices (company_id, device_name, platform, disk_free_percent, memory_used_percent, antivirus_ok, os_up_to_date, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (company_id, device_name) DO UPDATE SET
       platform = EXCLUDED.platform,
       disk_free_percent = EXCLUDED.disk_free_percent,
       memory_used_percent = EXCLUDED.memory_used_percent,
       antivirus_ok = EXCLUDED.antivirus_ok,
       os_up_to_date = EXCLUDED.os_up_to_date,
       last_seen_at = now()`,
    [
      req.companyAuth!.companyId,
      body.deviceName,
      body.platform,
      body.diskFreePercent ?? null,
      body.memoryUsedPercent ?? null,
      body.antivirusOk ?? null,
      body.osUpToDate ?? null,
    ],
  );
  res.status(202).json({ received: true });
});

const helpRequestSchema = z.object({
  description: z.string().min(5).max(2000),
  priority: z.enum(['normal', 'urgent']).default('normal'),
  deviceId: z.string().uuid().optional(),
  platform: z.enum(['web', 'windows', 'android']).default('web'),
});

/**
 * RP-03 : bouton "Demander de l'aide" — crée immédiatement une session
 * assistée (réutilise le moteur commande/session existant : commande à 0
 * FCFA, marquée payée d'office car couverte par l'abonnement).
 */
companyRouter.post('/help-requests', validateBody(helpRequestSchema), async (req, res) => {
  const body = req.body as z.infer<typeof helpRequestSchema>;

  const companyResult = await pool.query(
    `SELECT c.id, c.phone, c.name, c.subscription_plan_id, c.subscription_status,
            u.full_name AS requester_name, u.phone AS requester_phone
     FROM companies c JOIN company_users u ON u.id = $2
     WHERE c.id = $1`,
    [req.companyAuth!.companyId, req.companyAuth!.sub],
  );
  const company = companyResult.rows[0];
  if (!company) return res.status(404).json({ error: 'Entreprise introuvable' });
  if (company.subscription_status !== 'active' && company.subscription_status !== 'trial') {
    return res.status(403).json({ error: 'Abonnement suspendu ou résilié' });
  }
  if (!company.subscription_plan_id) {
    return res.status(409).json({ error: "Aucune formule d'abonnement associée à cette entreprise" });
  }

  const orderResult = await pool.query(
    `INSERT INTO orders (client_phone, client_name, plan_id, amount_fcfa, status, platform, paid_at)
     VALUES ($1, $2, $3, 0, 'paid', $4, now())
     RETURNING id`,
    [company.requester_phone, company.requester_name, company.subscription_plan_id, body.platform],
  );
  const orderId = orderResult.rows[0].id;

  const sessionResult = await createSessionForOrder(orderId, body.platform);
  if (!sessionResult.ok) {
    return res.status(sessionResult.status).json({ error: sessionResult.error });
  }

  const { rows } = await pool.query(
    `INSERT INTO company_help_requests (company_id, company_user_id, device_id, description, priority, status, session_id)
     VALUES ($1, $2, $3, $4, $5, 'open', $6)
     RETURNING id, status, priority, created_at`,
    [req.companyAuth!.companyId, req.companyAuth!.sub, body.deviceId ?? null, body.description, body.priority, sessionResult.session.id],
  );

  res.status(201).json({ helpRequest: rows[0], session: sessionResult.session });
});

companyRouter.get('/help-requests', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT chr.id, chr.description, chr.priority, chr.status, chr.created_at, chr.resolved_at,
            s.session_code, s.status AS session_status
     FROM company_help_requests chr
     LEFT JOIN sessions s ON s.id = chr.session_id
     WHERE chr.company_id = $1
     ORDER BY chr.created_at DESC LIMIT 100`,
    [req.companyAuth!.companyId],
  );
  res.json({ helpRequests: rows });
});

/**
 * RP-07 : rapport mensuel dirigeant, calculé à la volée (pas de table dédiée) —
 * demandes traitées, temps de résolution moyen, postes à risque (RP-05).
 */
companyRouter.get('/report', requireCompanyAuth('admin'), async (req, res) => {
  const [requestsStats, riskyDevices] = await Promise.all([
    pool.query(
      `SELECT
         count(*) FILTER (WHERE created_at >= date_trunc('month', now())) AS requests_this_month,
         count(*) FILTER (WHERE status = 'resolved' AND created_at >= date_trunc('month', now())) AS resolved_this_month,
         avg(extract(epoch FROM (resolved_at - created_at))) FILTER (WHERE resolved_at IS NOT NULL) AS avg_resolution_seconds
       FROM company_help_requests WHERE company_id = $1`,
      [req.companyAuth!.companyId],
    ),
    pool.query(
      `SELECT device_name, disk_free_percent, antivirus_ok, os_up_to_date
       FROM company_devices
       WHERE company_id = $1 AND (disk_free_percent < 10 OR antivirus_ok = FALSE OR os_up_to_date = FALSE)`,
      [req.companyAuth!.companyId],
    ),
  ]);

  res.json({
    requestsThisMonth: Number(requestsStats.rows[0].requests_this_month),
    resolvedThisMonth: Number(requestsStats.rows[0].resolved_this_month),
    avgResolutionSeconds: requestsStats.rows[0].avg_resolution_seconds
      ? Number(requestsStats.rows[0].avg_resolution_seconds)
      : null,
    riskyDevices: riskyDevices.rows,
  });
});
