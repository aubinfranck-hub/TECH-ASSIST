import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAppInstall } from '../middleware/appAuth.js';
import { validateBody } from '../middleware/validate.js';
import { inBackground, pingAssignedTechnician } from '../notify/technicianAlerts.js';
import { logAudit } from '../utils/audit.js';

/**
 * Côté application : après un passage de main, la fenêtre de l'agent reste ouverte et dialogue avec le technicien.
 * L'agent interroge régulièrement cette route (messages du technicien, état de la demande) et y dépose les réponses du client.
 */
export const humanRelayRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const limiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 400,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

const sendLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

interface OwnedSession {
  id: string;
  order_id: string;
  status: string;
  technician_id: string | null;
  human_requested_at: Date | null;
  technician_name: string | null;
}

/** La session doit appartenir à CETTE installation, via sa commande. */
async function ownedSession(sessionId: string, installId: string): Promise<OwnedSession | undefined> {
  if (!UUID.test(sessionId)) return undefined;
  const { rows } = await pool.query(
    `SELECT s.id, s.order_id, s.status, s.technician_id, s.human_requested_at, t.full_name AS technician_name
     FROM sessions s JOIN orders o ON o.id = s.order_id LEFT JOIN technicians t ON t.id = s.technician_id
     WHERE s.id = $1 AND o.app_install_id = $2`,
    [sessionId, installId],
  );
  return rows[0];
}

const firstName = (full: string | null) => (full ? full.trim().split(/\s+/)[0] ?? null : null);

/** État de la demande et nouveaux messages (après l'identifiant `after`). */
humanRelayRouter.get('/app/sessions/:id/messages', limiter, requireAppInstall, async (req, res) => {
  const session = await ownedSession(req.params.id!, req.appInstall!.id);
  if (!session) return res.status(404).json({ error: 'Session introuvable' });
  const after = Math.max(0, Number.parseInt(String(req.query.after ?? '0'), 10) || 0);
  const { rows } = await pool.query(
    `SELECT m.id, m.sender, m.body, m.created_at, t.full_name
     FROM session_messages m LEFT JOIN technicians t ON t.id = m.technician_id
     WHERE m.session_id = $1 AND m.id > $2 ORDER BY m.id ASC LIMIT 50`,
    [session.id, after],
  );
  res.json({
    state: {
      status: session.status,
      requested: session.human_requested_at !== null,
      claimed: session.technician_id !== null,
      technician: firstName(session.technician_name),
    },
    messages: rows.map((m) => ({ id: Number(m.id), sender: m.sender, body: m.body, at: m.created_at, name: m.sender === 'technician' ? firstName(m.full_name) : null })),
  });
});

const messageSchema = z.object({ body: z.string().trim().min(1).max(1000) });

/** Réponse du client au technicien. */
humanRelayRouter.post('/app/sessions/:id/messages', sendLimiter, requireAppInstall, validateBody(messageSchema), async (req, res) => {
  const session = await ownedSession(req.params.id!, req.appInstall!.id);
  if (!session) return res.status(404).json({ error: 'Session introuvable' });
  if (!['created', 'waiting_technician', 'active'].includes(session.status)) {
    return res.status(409).json({ error: 'Cette assistance est terminée.' });
  }
  const { body } = req.body as z.infer<typeof messageSchema>;
  const { rows } = await pool.query(`INSERT INTO session_messages (session_id, sender, body) VALUES ($1, 'client', $2) RETURNING id`, [session.id, body]);
  await logAudit(pool, { actorType: 'client', actorId: req.appInstall!.email, sessionId: session.id, orderId: session.order_id, action: 'client.message' });
  if (session.technician_id) inBackground(pingAssignedTechnician(session.id, session.technician_id, body));
  res.status(201).json({ id: Number(rows[0].id) });
});
