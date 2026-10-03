import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { generateSessionCode, SESSION_CODE_TTL_MINUTES } from '../utils/sessionCode.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { alertInBackground } from '../notify/technicianAlerts.js';
import { logAudit, type Db } from '../utils/audit.js';
import { humanIncludedFor, upgradeOffer } from '../utils/offers.js';
import { progressView, STALE_PROGRESS_SECONDS } from '../utils/taskProgress.js';
import { creditEarningSafely } from '../partners/earnings.js';
import { closeViewerOrderIfUnpaid, settleViewerSession } from '../partners/viewer.js';

export const sessionsRouter = Router();

const createSessionSchema = z.object({
  platform: z.enum(['web', 'windows', 'android']),
});

export type SessionMode = 'ia' | 'humain';

export type CreateSessionResult =
  | { ok: true; session: { id: string; session_code: string; status: string; code_expires_at: Date; duration_minutes: number; mode: SessionMode; human_included: boolean } }
  | { ok: false; status: number; error: string };

/**
 * RS-03 : code de session à usage unique, généré côté serveur, expire en 10 min
 * si non utilisé, toujours lié à une commande payée. Partagé entre la commande
 * classique (particuliers) et les demandes d'aide PME (RP-03), qui passent
 * toutes deux par une commande — à 0 FCFA et déjà payée pour les PME couvertes
 * par un abonnement.
 */
export async function createSessionForOrder(
  orderId: string,
  platform: 'web' | 'windows' | 'android',
  requestedMode: SessionMode = 'humain',
  /** Client de transaction : la session est alors créée ou annulée avec le reste (ex. offerte + commande). */
  db: Db = pool,
): Promise<CreateSessionResult> {
  // L'agent IA n'est appliqué que s'il est réellement activé (AI_AGENT_ENABLED) ;
  // sinon la demande est servie par un technicien (file d'attente classique).
  const mode: SessionMode = requestedMode === 'ia' && process.env.AI_AGENT_ENABLED === 'true' ? 'ia' : 'humain';
  const orderResult = await db.query(
    `SELECT o.id, o.status, p.duration_minutes, p.metadata
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
    const clash = await db.query('SELECT 1 FROM sessions WHERE session_code = $1', [code]);
    if (clash.rows.length === 0) break;
    code = generateSessionCode();
  }

  const { rows } = await db.query(
    `INSERT INTO sessions (order_id, session_code, platform, code_expires_at, duration_minutes, mode, requested_mode, human_included)
     VALUES ($1, $2, $3, now() + interval '${SESSION_CODE_TTL_MINUTES} minutes', $4, $5, $6, $7)
     RETURNING id, session_code, status, code_expires_at, duration_minutes, mode, human_included`,
    [orderId, code, platform, order.duration_minutes, mode, requestedMode, humanIncludedFor(order.metadata)],
  );
  const session = rows[0];

  await logAudit(db, {
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
    // Les commandes créées par l'application (offerte, abonné) ont leur session créée par l'application,
    // une seule fois : cette route publique ne doit pas pouvoir en fabriquer d'autres.
    const owner = await pool.query('SELECT app_install_id FROM orders WHERE id = $1', [req.params.orderId]);
    if (owner.rows[0]?.app_install_id) {
      return res.status(403).json({ error: "Cette assistance se démarre depuis l'application Tech Assist." });
    }
    const result = await createSessionForOrder(req.params.orderId, req.body.platform);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.status(201).json({ session: result.session });
  },
);

sessionsRouter.get('/sessions/:code', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, session_code, status, code_expires_at, duration_minutes,
            started_at, ends_at, consent_screen_at, consent_control_at, technician_id,
            remote_peer_id, remote_paired_at, mode, requested_mode, kind
     FROM sessions WHERE session_code = $1`,
    [req.params.code],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Session introuvable' });
  const { kind, ...session } = rows[0];
  // Session d'un partenaire : la fenêtre du client qui interroge la session fait aussi respecter la coupure des impayés.
  if (kind === 'viewer') {
    const settled = await settleViewerSession(pool, session.id);
    if (settled) session.status = settled.status;
  }
  res.json({ session });
});

/**
 * « Passer à un technicien » : le client peut quitter l'agent IA à tout moment ;
 * la session rejoint alors la file d'attente des techniciens.
 */
sessionsRouter.post('/sessions/:id/escalate', async (req, res) => {
  // Offre « IA seule » : le technicien n'en fait pas partie (le complément se paie depuis l'application).
  const current = await pool.query(`SELECT human_included FROM sessions WHERE id = $1 AND status IN ('created', 'waiting_technician', 'active')`, [req.params.id]);
  if (current.rows[0] && current.rows[0].human_included === false) {
    return res.status(402).json({
      code: 'human_not_included',
      error: "Votre offre « Assistance IA » ne comprend pas de technicien. Passez à « IA + technicien » depuis l'application pour qu'il prenne le relais.",
      upgrade: await upgradeOffer(),
    });
  }
  const { rows } = await pool.query(
    `UPDATE sessions SET mode = 'humain'
     WHERE id = $1 AND status IN ('created', 'waiting_technician', 'active')
     RETURNING id, mode, status`,
    [req.params.id],
  );
  if (rows.length === 0) {
    return res.status(409).json({ error: 'Session terminée ou introuvable' });
  }

  await logAudit(pool, {
    actorType: 'client',
    sessionId: req.params.id,
    action: 'session.escalated_to_human',
  });
  alertInBackground(req.params.id!);

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
  // Session partenaire arrêtée sans paiement : rien n'est dû. Assistance avec technicien : son gain est crédité.
  await closeViewerOrderIfUnpaid(pool, req.params.id!);
  await creditEarningSafely(pool, req.params.id!);

  res.json({ session: rows[0] });
});

/**
 * File d'attente technicien (RF-30). Les demandes PME (RP-03/RT-04) sont
 * signalées avec le nom de l'entreprise et la priorité, en tête de liste
 * pour les demandes urgentes.
 */
sessionsRouter.get('/technician/queue', requireAuth('technician', 'admin'), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.session_code, s.platform, s.created_at, s.duration_minutes, s.human_requested_at,
            s.requested_mode, o.client_phone, o.client_name,
            c.name AS company_name, chr.priority AS company_priority
     FROM sessions s
     JOIN orders o ON o.id = s.order_id
     LEFT JOIN company_help_requests chr ON chr.session_id = s.id
     LEFT JOIN companies c ON c.id = chr.company_id
     WHERE s.status IN ('created', 'waiting_technician') AND s.technician_id IS NULL
       AND s.mode = 'humain'
     ORDER BY (chr.priority = 'urgent') DESC, s.created_at ASC`,
  );
  res.json({ queue: rows });
});

/** Sessions actives assignées au technicien connecté (console, après prise en charge). */
sessionsRouter.get('/technician/my-sessions', requireAuth('technician', 'admin'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.session_code, s.platform, s.status, s.ends_at,
            s.consent_screen_at, s.consent_control_at,
            o.client_phone, o.client_name,
            s.task_progress, EXTRACT(EPOCH FROM (now() - s.task_progress_at)) AS progress_age
     FROM sessions s JOIN orders o ON o.id = s.order_id
     WHERE s.technician_id = $1 AND s.status = 'active'
     ORDER BY s.started_at ASC`,
    [req.auth!.sub],
  );
  // En un coup d'œil : ce que l'agent fait en ce moment sur le PC du client (détail dans le dossier de la demande).
  res.json({
    sessions: rows.map(({ task_progress, progress_age, ...s }) => {
      const view = progressView(task_progress, progress_age);
      const running = view?.items.find((t) => t.state === 'running');
      return { ...s, agent_task: running && view!.ageSeconds < STALE_PROGRESS_SECONDS ? running.title : null };
    }),
  });
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
  // Le client le voit tout de suite dans la fenêtre de l'agent.
  const name = (await pool.query('SELECT full_name FROM technicians WHERE id = $1', [req.auth!.sub])).rows[0]?.full_name as string | undefined;
  const first = name?.trim().split(/\s+/)[0] ?? 'Un technicien';
  await pool.query(`INSERT INTO session_messages (session_id, sender, technician_id, body) VALUES ($1, 'system', $2, $3)`, [
    req.params.id,
    req.auth!.sub,
    `${first}, technicien Tech Assist, a pris votre demande. Écrivez-lui ici : il voit tout ce que j'ai fait.`,
  ]);

  res.json({ session: rows[0] });
});
