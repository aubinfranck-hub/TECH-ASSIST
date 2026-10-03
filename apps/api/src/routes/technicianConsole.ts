import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { pushPublicKey, sendPush } from '../notify/push.js';
import { balanceFor, creditEarningSafely } from '../partners/earnings.js';
import { logAudit } from '../utils/audit.js';
import { progressView } from '../utils/taskProgress.js';

/**
 * Console du technicien (téléphone ou ordinateur) : permanence et alertes, détail d'une demande avec ce que l'agent a
 * constaté et fait, discussion avec le client, fin de l'assistance.
 */
export const technicianConsoleRouter = Router();
technicianConsoleRouter.use('/technician', requireAuth('technician', 'admin'));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const firstName = (full: string | null | undefined) => (full ? full.trim().split(/\s+/)[0] ?? null : null);

// --- Permanence et alertes ---

technicianConsoleRouter.get('/technician/alerts', async (req, res) => {
  const me = (await pool.query('SELECT full_name, on_duty, alert_email FROM technicians WHERE id = $1', [req.auth!.sub])).rows[0];
  if (!me) return res.status(404).json({ error: 'Compte introuvable' });
  const devices = (await pool.query('SELECT count(*)::int AS n FROM technician_push_subscriptions WHERE technician_id = $1', [req.auth!.sub])).rows[0].n as number;
  res.json({
    name: me.full_name,
    onDuty: me.on_duty,
    alertEmail: me.alert_email,
    devices,
    push: { available: pushPublicKey() !== null, publicKey: pushPublicKey() },
  });
});

const alertsSchema = z
  .object({ onDuty: z.boolean().optional(), alertEmail: z.union([z.string().trim().toLowerCase().email().max(254), z.literal('')]).nullable().optional() })
  .refine((v) => v.onDuty !== undefined || v.alertEmail !== undefined, { message: 'Rien à modifier' });

technicianConsoleRouter.patch('/technician/alerts', validateBody(alertsSchema), async (req, res) => {
  const body = req.body as z.infer<typeof alertsSchema>;
  const { rows } = await pool.query(
    `UPDATE technicians SET on_duty = COALESCE($2, on_duty),
       alert_email = CASE WHEN $3::boolean THEN NULLIF($4, '') ELSE alert_email END
     WHERE id = $1 RETURNING on_duty, alert_email`,
    [req.auth!.sub, body.onDuty ?? null, body.alertEmail !== undefined, body.alertEmail ?? null],
  );
  await logAudit(pool, { actorType: 'technician', actorId: req.auth!.sub, action: 'technician.alerts_updated', details: { onDuty: rows[0].on_duty } });
  res.json({ onDuty: rows[0].on_duty, alertEmail: rows[0].alert_email });
});

const subscribeSchema = z.object({
  endpoint: z.string().url().max(1000).startsWith('https://'),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(10).max(100) }),
});

technicianConsoleRouter.post('/technician/push/subscribe', validateBody(subscribeSchema), async (req, res) => {
  const body = req.body as z.infer<typeof subscribeSchema>;
  await pool.query(
    `INSERT INTO technician_push_subscriptions (technician_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET technician_id = EXCLUDED.technician_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [req.auth!.sub, body.endpoint, body.keys.p256dh, body.keys.auth],
  );
  res.status(201).json({ subscribed: true });
});

technicianConsoleRouter.post('/technician/push/unsubscribe', validateBody(z.object({ endpoint: z.string().max(1000) })), async (req, res) => {
  await pool.query('DELETE FROM technician_push_subscriptions WHERE technician_id = $1 AND endpoint = $2', [req.auth!.sub, req.body.endpoint]);
  res.json({ subscribed: false });
});

/** Essai : une notification sur les appareils du technicien, pour vérifier que les alertes arrivent bien. */
technicianConsoleRouter.post('/technician/push/test', async (req, res) => {
  const subs = (await pool.query('SELECT id, endpoint, p256dh, auth FROM technician_push_subscriptions WHERE technician_id = $1', [req.auth!.sub])).rows as {
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }[];
  const url = `${(process.env.PUBLIC_WEB_URL ?? '').replace(/\/$/, '')}/technicien`;
  const results = await Promise.all(subs.map((s) => sendPush(s, { title: 'Tech Assist : essai', body: 'Les alertes arrivent bien sur cet appareil.', url })));
  const gone = subs.filter((_, i) => results[i] === 'gone').map((s) => s.id);
  if (gone.length) await pool.query('DELETE FROM technician_push_subscriptions WHERE id = ANY($1::uuid[])', [gone]);
  res.json({ devices: subs.length, sent: results.filter((r) => r === 'sent').length });
});

// --- Détail d'une demande ---

interface Detail {
  id: string;
  session_code: string;
  status: string;
  platform: string;
  mode: string;
  created_at: Date;
  started_at: Date | null;
  ends_at: Date | null;
  human_requested_at: Date | null;
  technician_id: string | null;
  technician_name: string | null;
  consent_screen_at: Date | null;
  consent_control_at: Date | null;
  client_name: string | null;
  client_phone: string;
  client_email: string | null;
  task_progress: unknown;
  /** Il y a combien de secondes l'agent a donné de ses nouvelles (null : jamais). */
  progress_age: string | number | null;
}

async function loadDetail(id: string): Promise<Detail | undefined> {
  if (!UUID.test(id)) return undefined;
  const { rows } = await pool.query(
    `SELECT s.id, s.session_code, s.status, s.platform, s.mode, s.created_at, s.started_at, s.ends_at, s.human_requested_at,
            s.technician_id, t.full_name AS technician_name, s.consent_screen_at, s.consent_control_at,
            o.client_name, o.client_phone, COALESCE(a.client_email, o.client_email) AS client_email,
            s.task_progress, EXTRACT(EPOCH FROM (now() - s.task_progress_at)) AS progress_age
     FROM sessions s JOIN orders o ON o.id = s.order_id
     LEFT JOIN app_installs a ON a.id = o.app_install_id
     LEFT JOIN technicians t ON t.id = s.technician_id
     WHERE s.id = $1`,
    [id],
  );
  return rows[0];
}

/** Un technicien voit les demandes libres et les siennes ; l'administrateur voit tout. */
function canSee(d: Detail, req: { auth?: { sub: string; role: string } }): boolean {
  return req.auth!.role === 'admin' || d.technician_id === null || d.technician_id === req.auth!.sub;
}

const canWrite = (d: Detail, req: { auth?: { sub: string; role: string } }) =>
  d.status === 'active' && (d.technician_id === req.auth!.sub || (req.auth!.role === 'admin' && d.technician_id !== null));

type Entry = { at: Date; kind: 'client' | 'agent' | 'technician' | 'system'; text: string };

const clip = (s: unknown, n = 300) => (typeof s === 'string' ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : '');

/** Journal de l'agent et de la session, en phrases lisibles par un technicien. */
function timelineEntry(row: { action: string; details: Record<string, unknown>; created_at: Date }): Entry | null {
  const d = row.details ?? {};
  const msg = clip(d.message);
  const skill = clip(d.skill, 60);
  const base = (kind: Entry['kind'], text: string): Entry => ({ at: row.created_at, kind, text });
  switch (row.action) {
    case 'agent.user_request':
      return base('client', `Le client a écrit : « ${msg} »`);
    case 'agent.diagnosed':
      return base('agent', `Diagnostic${skill ? ` (${skill})` : ''} : ${msg}`);
    case 'agent.action_proposed':
      return base('agent', `Action proposée : ${msg || clip(d.action, 60)}`);
    case 'agent.action_approved':
      return base('agent', `Accord du client : ${msg || clip(d.action, 60)}`);
    case 'agent.action_declined':
      return base('agent', `Refusé ou non réalisé : ${msg || clip(d.action, 60)}`);
    case 'agent.action_done':
      return base('agent', `Fait : ${msg || clip(d.action, 60)}`);
    case 'agent.action_failed':
      return base('agent', `Échec : ${msg || clip(d.action, 60)}`);
    case 'agent.verified':
      return base('agent', `Vérification : ${msg}`);
    case 'agent.escalated':
      return base('agent', `Passage de main : ${msg || 'technicien demandé'}`);
    case 'agent.chat':
      return base('agent', `Question posée à l'assistant : « ${clip(d.question, 200)} »`);
    case 'client.message':
      return null; // déjà dans la discussion
    case 'session.created':
      return base('system', 'Assistance démarrée');
    case 'session.claimed':
      return base('technician', 'Prise en charge par un technicien');
    case 'session.stopped':
      return base('system', `Assistance terminée (${clip(d.stoppedBy, 20) || 'fin'})`);
    default:
      return row.action.startsWith('agent.') ? base('agent', `${row.action.slice(6)} : ${msg}`) : null;
  }
}

technicianConsoleRouter.get('/technician/sessions/:id', async (req, res) => {
  const d = await loadDetail(req.params.id!);
  if (!d) return res.status(404).json({ error: 'Demande introuvable' });
  if (!canSee(d, req)) return res.status(403).json({ error: 'Cette demande est suivie par un autre technicien.' });

  const log = await pool.query(
    `SELECT action, details, created_at FROM audit_logs WHERE session_id = $1 ORDER BY created_at ASC, id ASC LIMIT 300`,
    [d.id],
  );
  const timeline = log.rows.map(timelineEntry).filter((e): e is Entry => e !== null);
  const messages = await pool.query(
    `SELECT m.id, m.sender, m.body, m.created_at, t.full_name FROM session_messages m LEFT JOIN technicians t ON t.id = m.technician_id
     WHERE m.session_id = $1 ORDER BY m.id ASC LIMIT 200`,
    [d.id],
  );
  res.json({
    session: {
      id: d.id,
      code: String(d.session_code).slice(-4),
      status: d.status,
      platform: d.platform,
      mode: d.mode,
      createdAt: d.created_at,
      requestedAt: d.human_requested_at,
      startedAt: d.started_at,
      endsAt: d.ends_at,
      technician: firstName(d.technician_name),
      mine: d.technician_id === req.auth!.sub,
      canWrite: canWrite(d, req),
      consentScreen: d.consent_screen_at !== null,
      consentControl: d.consent_control_at !== null,
    },
    client: { name: d.client_name, phone: d.client_phone, email: d.client_email },
    progress: progressView(d.task_progress, d.progress_age),
    timeline,
    messages: messages.rows.map((m) => ({ id: Number(m.id), sender: m.sender, body: m.body, at: m.created_at, name: m.sender === 'technician' ? firstName(m.full_name) : null })),
  });
});

technicianConsoleRouter.get('/technician/sessions/:id/messages', async (req, res) => {
  const d = await loadDetail(req.params.id!);
  if (!d) return res.status(404).json({ error: 'Demande introuvable' });
  if (!canSee(d, req)) return res.status(403).json({ error: 'Cette demande est suivie par un autre technicien.' });
  const after = Math.max(0, Number.parseInt(String(req.query.after ?? '0'), 10) || 0);
  const { rows } = await pool.query(
    `SELECT m.id, m.sender, m.body, m.created_at, t.full_name FROM session_messages m LEFT JOIN technicians t ON t.id = m.technician_id
     WHERE m.session_id = $1 AND m.id > $2 ORDER BY m.id ASC LIMIT 100`,
    [d.id, after],
  );
  res.json({
    status: d.status,
    canWrite: canWrite(d, req),
    progress: progressView(d.task_progress, d.progress_age),
    messages: rows.map((m) => ({ id: Number(m.id), sender: m.sender, body: m.body, at: m.created_at, name: m.sender === 'technician' ? firstName(m.full_name) : null })),
  });
});

const messageSchema = z.object({ body: z.string().trim().min(1).max(1000) });

technicianConsoleRouter.post('/technician/sessions/:id/messages', validateBody(messageSchema), async (req, res) => {
  const d = await loadDetail(req.params.id!);
  if (!d) return res.status(404).json({ error: 'Demande introuvable' });
  if (!canSee(d, req)) return res.status(403).json({ error: 'Cette demande est suivie par un autre technicien.' });
  if (!canWrite(d, req)) return res.status(409).json({ error: "Prenez d'abord la demande en charge (ou elle est terminée)." });
  const { rows } = await pool.query(
    `INSERT INTO session_messages (session_id, sender, technician_id, body) VALUES ($1, 'technician', $2, $3) RETURNING id`,
    [d.id, req.auth!.sub, (req.body as z.infer<typeof messageSchema>).body],
  );
  res.status(201).json({ id: Number(rows[0].id) });
});

/** Fin de l'assistance par le technicien : le client en est informé dans sa fenêtre, l'accès à distance est coupé. */
technicianConsoleRouter.post('/technician/sessions/:id/finish', async (req, res) => {
  const d = await loadDetail(req.params.id!);
  if (!d) return res.status(404).json({ error: 'Demande introuvable' });
  // Seul le technicien qui a pris la demande (ou un administrateur) peut la terminer : une demande libre se prend d'abord en charge.
  if (req.auth!.role !== 'admin' && d.technician_id !== req.auth!.sub) return res.status(403).json({ error: 'Cette demande est suivie par un autre technicien ou n’est pas encore prise en charge.' });
  const { rows } = await pool.query(
    `UPDATE sessions SET status = 'completed', stopped_at = now(), stopped_by = 'technician', remote_password_encrypted = NULL
     WHERE id = $1 AND status IN ('created','waiting_technician','active') RETURNING id`,
    [d.id],
  );
  if (rows.length === 0) return res.status(409).json({ error: 'Assistance déjà terminée.' });
  await pool.query(`INSERT INTO session_messages (session_id, sender, body) VALUES ($1, 'system', $2)`, [
    d.id,
    "Le technicien a terminé l'assistance. Merci de votre confiance !",
  ]);
  await logAudit(pool, { actorType: 'technician', actorId: req.auth!.sub, sessionId: d.id, action: 'session.stopped', details: { stoppedBy: 'technician' } });
  // L'assistance terminée avec un technicien lui crédite son gain (à valider par l'administrateur).
  await creditEarningSafely(pool, d.id);
  res.json({ finished: true });
});

// --- Gains : ce que le technicien a gagné, ce qui est validé, ce qui lui a été versé ---

const KIND_LABELS: Record<string, string> = {
  ia_technicien: 'Assistance IA + technicien',
  complement: 'Technicien ajouté à une assistance IA',
  entreprise: "Assistance d'une entreprise",
};

technicianConsoleRouter.get('/technician/earnings', async (req, res) => {
  const me = (await pool.query('SELECT payout_phone, payout_operator FROM technicians WHERE id = $1', [req.auth!.sub])).rows[0];
  const [balance, lines, payouts] = await Promise.all([
    balanceFor(pool, req.auth!.sub),
    pool.query(
      `SELECT e.id, e.kind, e.amount_fcfa, e.status, e.created_at, e.approved_at, s.session_code
       FROM technician_earnings e JOIN sessions s ON s.id = e.session_id
       WHERE e.technician_id = $1 AND e.status <> 'cancelled' ORDER BY e.created_at DESC LIMIT 50`,
      [req.auth!.sub],
    ),
    pool.query(`SELECT id, amount_fcfa, reference, paid_at FROM technician_payouts WHERE technician_id = $1 ORDER BY paid_at DESC LIMIT 20`, [req.auth!.sub]),
  ]);
  res.json({
    balance,
    payout: { phone: me?.payout_phone ?? null, operator: me?.payout_operator ?? null },
    earnings: lines.rows.map((r) => ({ id: r.id, label: KIND_LABELS[r.kind] ?? r.kind, amountFcfa: r.amount_fcfa, status: r.status, createdAt: r.created_at, approvedAt: r.approved_at, code: String(r.session_code).slice(-4) })),
    payouts: payouts.rows.map((r) => ({ id: r.id, amountFcfa: r.amount_fcfa, reference: r.reference, paidAt: r.paid_at })),
  });
});

const payoutProfileSchema = z.object({
  phone: z.string().regex(/^\+?[0-9]{8,15}$/, 'Numéro de téléphone invalide'),
  operator: z.enum(['wave', 'orange', 'mtn', 'moov', 'djamo']),
});

/** Numéro Mobile Money sur lequel l'équipe verse les gains. */
technicianConsoleRouter.put('/technician/payout-profile', validateBody(payoutProfileSchema), async (req, res) => {
  const body = req.body as z.infer<typeof payoutProfileSchema>;
  await pool.query('UPDATE technicians SET payout_phone = $2, payout_operator = $3 WHERE id = $1', [req.auth!.sub, body.phone, body.operator]);
  await logAudit(pool, { actorType: 'technician', actorId: req.auth!.sub, action: 'technician.payout_profile_updated', details: { operator: body.operator } });
  res.json({ payout: { phone: body.phone, operator: body.operator } });
});
