import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { generateSessionCode, SESSION_CODE_TTL_MINUTES } from '../utils/sessionCode.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { logAudit } from '../utils/audit.js';

export const sessionsRouter = Router();

const createSessionSchema = z.object({
  platform: z.enum(['web', 'windows', 'android']),
});

export type CreateSessionResult =
  | { ok: true; session: { id: string; session_code: string; status: string; code_expires_at: Date; duration_minutes: number } }
  | { ok: false; status: number; error: string };

/**
 * RS-03 : code de session à usage unique, généré côté serveur, expire en 10 min
 * si non utilisé, toujours lié à une commande payée. Partagé entre la commande
 * classique (particuliers) et les demandes d'aide PME (RP-03), qui passent
 * toutes deux par une commande — à 0 FCFA et déjà payée pour les PME couvertes
 * par un abonnement.
 */
export async function createSessionForOrder(orderId: string, platform: 'web' | 'windows' | 'android'): Promise<CreateSessionResult> {
  const orderResult = await pool.query(
    `SELECT o.id, o.status, p.duration_minutes
     FROM orders o JOIN pricing_plans p ON p.id = o.plan_id
     WHERE o.id = $1`,
    [orderId],
  );
  const order = orderResult.rows[0];
  if (!order) return { ok: false, status: 404, error: 'Commande introuvable' };
  if (order.status !== 'paid') {
    return { ok: false, status: 402, error: 'Paiement requis avant de démarrer une session' };
  }
  if (!order.duration_minutes) {
    return { ok: false, status: 400, error: 'Cette formule ne donne pas droit à une session assistée' };
  }

  let code = generateSessionCode();
  // Garantit l'unicité même en cas de collision improbable.
  for (let attempts = 0; attempts < 5; attempts++) {
    const clash = await pool.query('SELECT 1 FROM sessions WHERE session_code = $1', [code]);
    if (clash.rows.length === 0) break;
    code = generateSessionCode();
  }

  const { rows } = await pool.query(
    `INSERT INTO sessions (order_id, session_code, platform, code_expires_at, duration_minutes)
     VALUES ($1, $2, $3, now() + interval '${SESSION_CODE_TTL_MINUTES} minutes', $4)
     RETURNING id, session_code, status, code_expires_at, duration_minutes`,
    [orderId, code, platform, order.duration_minutes],
  );
  const session = rows[0];

  await logAudit(pool, {
    actorType: 'system',
    orderId,
    sessionId: session.id,
    action: 'session.created',
  });

  return { ok: true, session };
}

sessionsRouter.post(
  '/orders/:orderId/session',
  validateBody(createSessionSchema),
  async (req, res) => {
    const result = await createSessionForOrder(req.params.orderId, req.body.platform);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.status(201).json({ session: result.session });
  },
);

sessionsRouter.get('/sessions/:code', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, session_code, status, code_expires_at, duration_minutes,
            started_at, ends_at, consent_screen_at, consent_control_at, technician_id,
            remote_peer_id, remote_paired_at
     FROM sessions WHERE session_code = $1`,
    [req.params.code],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Session introuvable' });
  res.json({ session: rows[0] });
});

const consentSchema = z.object({ stage: z.enum(['screen', 'control']) });

/** RS-01 : consentement explicite en deux étapes distinctes (partage, puis contrôle). */
sessionsRouter.post('/sessions/:id/consent', validateBody(consentSchema), async (req, res) => {
  const column = req.body.stage === 'screen' ? 'consent_screen_at' : 'consent_control_at';
  const { rows } = await pool.query(
    `UPDATE sessions SET ${column} = now() WHERE id = $1 RETURNING id, ${column}`,
    [req.params.id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Session introuvable' });

  await logAudit(pool, {
    actorType: 'client',
    sessionId: req.params.id,
    action: `session.consent.${req.body.stage}`,
  });

  res.json({ session: rows[0] });
});

const stopSchema = z.object({ stoppedBy: z.enum(['client', 'technician', 'system', 'timeout']) });

/** RS-02 : bouton d'arrêt immédiat, effectif quel que soit qui l'actionne. */
sessionsRouter.post('/sessions/:id/stop', validateBody(stopSchema), async (req, res) => {
  // RS-10 : le mot de passe de connexion à distance ne survit pas à la session.
  const { rows } = await pool.query(
    `UPDATE sessions
     SET status = 'completed', stopped_at = now(), stopped_by = $2, remote_password_encrypted = NULL
     WHERE id = $1 AND status IN ('created', 'waiting_technician', 'active')
     RETURNING id, status, stopped_at`,
    [req.params.id, req.body.stoppedBy],
  );
  if (rows.length === 0) {
    return res.status(409).json({ error: 'Session déjà terminée ou introuvable' });
  }

  await logAudit(pool, {
    actorType: req.body.stoppedBy === 'client' ? 'client' : 'system',
    sessionId: req.params.id,
    action: 'session.stopped',
    details: { stoppedBy: req.body.stoppedBy },
  });

  res.json({ session: rows[0] });
});

/**
 * File d'attente technicien (RF-30). Les demandes PME (RP-03/RT-04) sont
 * signalées avec le nom de l'entreprise et la priorité, en tête de liste
 * pour les demandes urgentes.
 */
sessionsRouter.get('/technician/queue', requireAuth('technician', 'admin'), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.session_code, s.platform, s.created_at, s.duration_minutes,
            o.client_phone, o.client_name,
            c.name AS company_name, chr.priority AS company_priority
     FROM sessions s
     JOIN orders o ON o.id = s.order_id
     LEFT JOIN company_help_requests chr ON chr.session_id = s.id
     LEFT JOIN companies c ON c.id = chr.company_id
     WHERE s.status IN ('created', 'waiting_technician') AND s.technician_id IS NULL
     ORDER BY (chr.priority = 'urgent') DESC, s.created_at ASC`,
  );
  res.json({ queue: rows });
});

/** Sessions actives assignées au technicien connecté (console, après prise en charge). */
sessionsRouter.get('/technician/my-sessions', requireAuth('technician', 'admin'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.session_code, s.platform, s.status, s.ends_at,
            s.consent_screen_at, s.consent_control_at,
            o.client_phone, o.client_name
     FROM sessions s JOIN orders o ON o.id = s.order_id
     WHERE s.technician_id = $1 AND s.status = 'active'
     ORDER BY s.started_at ASC`,
    [req.auth!.sub],
  );
  res.json({ sessions: rows });
});

/** RF-30 : le technicien prend une demande de la file. */
sessionsRouter.patch('/technician/sessions/:id/claim', requireAuth('technician', 'admin'), async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE sessions
     SET technician_id = $2, status = 'active', started_at = now(),
         ends_at = now() + (duration_minutes || ' minutes')::interval
     WHERE id = $1 AND technician_id IS NULL
     RETURNING id, status, started_at, ends_at`,
    [req.params.id, req.auth!.sub],
  );
  if (rows.length === 0) {
    return res.status(409).json({ error: 'Session déjà prise en charge' });
  }

  await logAudit(pool, {
    actorType: 'technician',
    actorId: req.auth!.sub,
    sessionId: req.params.id,
    action: 'session.claimed',
  });

  res.json({ session: rows[0] });
});
