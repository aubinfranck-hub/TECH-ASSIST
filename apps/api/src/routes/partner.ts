import { Router, type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { JEKO_METHODS, JekoError, createJekoPayment, jekoConfigured, type JekoMethod } from '../payments/jeko.js';
import { VIEWER_PLAN_ID, closeViewerOrderIfUnpaid, freeSeconds, graceSeconds, grantFreeSeconds, loadViewerSession, settleViewerSession, viewerView, type ViewerSessionRow } from '../partners/viewer.js';
import { logAudit } from '../utils/audit.js';
import { decryptSecret } from '../utils/crypto.js';
import { sendMail } from '../utils/mailer.js';
import { generateSessionCode } from '../utils/sessionCode.js';

/**
 * Espace des techniciens partenaires (D16). Un partenaire est un technicien indépendant qui utilise Tech Assist pour se connecter
 * au poste de ses PROPRES clients, au lieu de TeamViewer ou AnyDesk : 3 minutes gratuites par session, puis 500 FCFA la session.
 * Son compte est un compte « technicien » de rôle `partner` : aucune route du personnel ne l'accepte.
 */
export const partnerRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_OPEN_SESSIONS = 3;

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().regex(/^\+?[0-9]{8,15}$/, 'Numéro de téléphone invalide'),
  username: z.string().trim().min(3).max(60).regex(/^[a-zA-Z0-9._-]+$/, "L'identifiant ne peut contenir que des lettres, chiffres, point, tiret et tiret bas"),
  password: z.string().min(10, 'Le mot de passe doit faire au moins 10 caractères').max(200),
  businessName: z.string().trim().max(120).optional(),
});

/** Demande d'ouverture de compte partenaire : le compte reste fermé tant que l'administrateur ne l'a pas validé. */
partnerRouter.post('/partner/register', registerLimiter, validateBody(registerSchema), async (req, res) => {
  const body = req.body as z.infer<typeof registerSchema>;
  const hash = await bcrypt.hash(body.password, 12);
  try {
    const { rows } = await pool.query(
      `INSERT INTO technicians (full_name, phone, username, password_hash, role, is_active, approval_status, business_name)
       VALUES ($1, $2, $3, $4, 'partner', FALSE, 'pending', $5) RETURNING id`,
      [body.fullName, body.phone, body.username, hash, body.businessName || null],
    );
    await logAudit(pool, { actorType: 'system', actorId: rows[0].id, action: 'partner.registered', details: { username: body.username } });
    // Prévenir l'équipe : sans cela, la demande attendrait qu'un administrateur ouvre la page par hasard.
    const to = (process.env.TECH_ALERT_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const address of to) {
      sendMail({ to: address, subject: 'Tech Assist : nouvelle demande de compte partenaire', text: `${body.fullName}${body.businessName ? ` (${body.businessName})` : ''} demande un compte partenaire. À valider dans l'administration.` }).catch(() => undefined);
    }
    res.status(201).json({ received: true, message: "Demande reçue. Un administrateur la valide, puis vous pourrez vous connecter." });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return res.status(409).json({ error: 'Cet identifiant ou ce numéro est déjà utilisé.' });
    throw err;
  }
});

interface Partner {
  id: string;
  full_name: string;
  username: string;
  phone: string;
  business_name: string | null;
  totp_enabled: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      partner?: Partner;
    }
  }
}

/** Compte partenaire actif et validé (le jeton seul ne suffit pas : un compte suspendu est refusé tout de suite). */
async function loadPartner(req: Request, res: Response, next: NextFunction) {
  const { rows } = await pool.query(
    `SELECT id, full_name, username, phone, business_name, totp_enabled, is_active, approval_status FROM technicians WHERE id = $1 AND role = 'partner'`,
    [req.auth!.sub],
  );
  const partner = rows[0];
  if (!partner || !partner.is_active || partner.approval_status !== 'approved') return res.status(403).json({ error: "Ce compte partenaire n'est pas actif." });
  req.partner = partner;
  next();
}

const guard = [requireAuth('partner'), loadPartner];

partnerRouter.get('/partner/me', ...guard, async (req, res) => {
  const p = req.partner!;
  res.json({
    partner: { id: p.id, fullName: p.full_name, username: p.username, businessName: p.business_name, totpEnabled: p.totp_enabled },
    offer: await offerView(),
  });
});

async function offerView() {
  const plan = (await pool.query(`SELECT price_fcfa FROM pricing_plans WHERE id = $1 AND active = TRUE`, [VIEWER_PLAN_ID])).rows[0];
  return {
    freeSeconds: freeSeconds(),
    graceSeconds: graceSeconds(),
    priceFcfa: plan ? Number(plan.price_fcfa) : null,
    methods: jekoConfigured() ? JEKO_METHODS : [],
  };
}

function view(row: ViewerSessionRow) {
  const v = viewerView(row);
  return {
    id: row.id,
    code: v.state === 'ended' ? null : row.session_code,
    label: row.viewer_label,
    state: v.state,
    freeLeft: v.freeLeft,
    cutIn: v.cutIn,
    amountFcfa: Number(row.amount_fcfa),
    paid: row.order_status === 'paid',
    createdAt: row.created_at,
    codeExpiresAt: row.code_expires_at,
    clientPaired: Boolean(row.remote_paired_at),
    clientConsented: Boolean(row.consent_control_at),
  };
}

const createSchema = z.object({ label: z.string().trim().max(120).optional() });

/** Ouvre une session : le partenaire donne le code à son client, qui l'ouvre, autorise, puis la connexion est possible. */
partnerRouter.post('/partner/viewer-sessions', ...guard, validateBody(createSchema), async (req, res) => {
  const p = req.partner!;
  if (!p.totp_enabled) {
    return res.status(403).json({ code: 'two_factor_required', error: 'Activez la double authentification avant de vous connecter au poste d’un client.' });
  }
  const open = await pool.query(
    `SELECT count(*)::int AS n FROM sessions WHERE kind = 'viewer' AND technician_id = $1 AND status IN ('created', 'waiting_technician', 'active')`,
    [p.id],
  );
  if (open.rows[0].n >= MAX_OPEN_SESSIONS) return res.status(409).json({ code: 'too_many_open', error: `Vous avez déjà ${MAX_OPEN_SESSIONS} sessions ouvertes. Terminez-en une d’abord.` });
  const plan = (await pool.query(`SELECT id, price_fcfa, metadata FROM pricing_plans WHERE id = $1 AND active = TRUE`, [VIEWER_PLAN_ID])).rows[0];
  if (!plan) return res.status(503).json({ error: 'Les sessions partenaires sont indisponibles pour le moment.' });

  const label = (req.body as z.infer<typeof createSchema>).label || null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let code = generateSessionCode();
    for (let i = 0; i < 5; i++) {
      if ((await client.query('SELECT 1 FROM sessions WHERE session_code = $1', [code])).rows.length === 0) break;
      code = generateSessionCode();
    }
    // La commande de 500 FCFA existe dès l'ouverture mais n'est due que si la session dépasse la durée gratuite ; sinon elle est annulée.
    const order = (
      await client.query(
        `INSERT INTO orders (client_phone, client_name, plan_id, amount_fcfa, platform, mode)
         VALUES ($1, $2, $3, $4, 'web', 'humain') RETURNING id`,
        [p.phone, p.full_name, plan.id, plan.price_fcfa],
      )
    ).rows[0];
    const session = (
      await client.query(
        `INSERT INTO sessions (order_id, session_code, platform, code_expires_at, duration_minutes, mode, requested_mode, human_included, kind, viewer_label, technician_id)
         VALUES ($1, $2, 'web', now() + interval '10 minutes', $3, 'humain', 'humain', TRUE, 'viewer', $4, $5) RETURNING id`,
        [order.id, code, Number(plan.metadata?.maxMinutes ?? 120), label, p.id],
      )
    ).rows[0];
    await logAudit(client, { actorType: 'technician', actorId: p.id, sessionId: session.id, orderId: order.id, action: 'viewer.created', details: { label } });
    await client.query('COMMIT');
    const row = await loadViewerSession(pool, session.id);
    res.status(201).json({ session: view(row!) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
});

partnerRouter.get('/partner/viewer-sessions', ...guard, async (req, res) => {
  const { rows } = await pool.query(`SELECT id FROM sessions WHERE kind = 'viewer' AND technician_id = $1 ORDER BY created_at DESC LIMIT 30`, [req.partner!.id]);
  const sessions: ReturnType<typeof view>[] = [];
  for (const r of rows) {
    const row = await settleViewerSession(pool, r.id);
    if (row) sessions.push(view(row));
  }
  res.json({ sessions });
});

async function ownedViewer(req: Request, res: Response): Promise<ViewerSessionRow | null> {
  const id = String(req.params.id);
  if (!UUID.test(id)) {
    res.status(404).json({ error: 'Session introuvable' });
    return null;
  }
  const row = await settleViewerSession(pool, id);
  if (!row || row.technician_id !== req.partner!.id) {
    res.status(404).json({ error: 'Session introuvable' });
    return null;
  }
  return row;
}

partnerRouter.get('/partner/viewer-sessions/:id', ...guard, async (req, res) => {
  const row = await ownedViewer(req, res);
  if (row) res.json({ session: view(row) });
});

/**
 * Remise des identifiants de connexion (RustDesk). La durée gratuite démarre à la PREMIÈRE remise. Passé ce délai sans paiement,
 * plus rien n'est remis et la session est coupée à l'issue du délai de grâce. Le client a dû autoriser le contrôle (RS-01).
 */
partnerRouter.post('/partner/viewer-sessions/:id/connect', ...guard, async (req, res) => {
  const row = await ownedViewer(req, res);
  if (!row) return;
  let v = viewerView(row);
  if (v.state === 'ended') return res.status(409).json({ code: 'ended', error: 'Cette session est terminée.' });
  if (v.state === 'waiting_client') return res.status(409).json({ code: 'waiting_client', error: "Votre client n'a pas encore ouvert le code et autorisé le contrôle." });

  let current = row;
  if (v.state === 'ready') {
    const grant = await grantFreeSeconds(pool, { partnerId: req.partner!.id, sessionId: row.id, peerId: row.remote_peer_id });
    await pool.query(`UPDATE sessions SET viewer_connected_at = now(), viewer_free_seconds = $2 WHERE id = $1 AND viewer_connected_at IS NULL`, [row.id, grant.seconds]);
    current = (await loadViewerSession(pool, row.id))!;
    await logAudit(pool, { actorType: 'technician', actorId: req.partner!.id, sessionId: row.id, action: 'viewer.connected', details: { freeSeconds: grant.seconds, ...(grant.reason ? { noFreeBecause: grant.reason } : {}) } });
    v = viewerView(current);
  }
  if (v.state === 'payment_required') {
    return res.status(402).json({
      code: 'payment_required',
      error: 'La durée gratuite est terminée. Payez la session pour continuer.',
      amountFcfa: Number(current.amount_fcfa),
      cutIn: v.cutIn,
    });
  }

  const secret = await pool.query(`SELECT remote_peer_id, remote_password_encrypted FROM sessions WHERE id = $1`, [row.id]);
  const s = secret.rows[0];
  if (!current.consent_control_at) return res.status(403).json({ error: "Le client n'a pas encore autorisé le contrôle" });
  if (!s?.remote_peer_id || !s.remote_password_encrypted) return res.status(409).json({ error: "Le client n'a pas encore appairé son outil" });
  await logAudit(pool, { actorType: 'technician', actorId: req.partner!.id, sessionId: row.id, action: 'session.remote_credentials_viewed', details: { viewer: true } });
  res.json({ remotePeerId: s.remote_peer_id, remotePassword: decryptSecret(s.remote_password_encrypted), state: v.state, freeLeft: v.freeLeft });
});

const paySchema = z.object({ method: z.enum(JEKO_METHODS) });

/** Paiement de la session (Jèko). Possible à tout moment : pendant la durée gratuite pour ne pas être interrompu. */
partnerRouter.post('/partner/viewer-sessions/:id/pay', ...guard, validateBody(paySchema), async (req, res) => {
  const row = await ownedViewer(req, res);
  if (!row) return;
  const v = viewerView(row);
  if (v.state === 'ended') return res.status(409).json({ code: 'ended', error: 'Cette session est terminée.' });
  if (v.state === 'paid') return res.status(409).json({ code: 'already_paid', error: 'Cette session est déjà payée.' });
  if (!jekoConfigured()) {
    return res.status(503).json({
      error: 'Paiement en ligne indisponible pour le moment.',
      reference: row.order_id.slice(0, 8).toUpperCase(),
      instructions: process.env.PAYMENT_INSTRUCTIONS ?? "Envoyez le montant par Mobile Money au numéro indiqué par notre équipe en précisant la référence ; un administrateur confirmera la réception.",
    });
  }
  try {
    const payment = await createJekoPayment({ orderId: row.order_id, amountFcfa: Number(row.amount_fcfa), method: (req.body as z.infer<typeof paySchema>).method as JekoMethod });
    res.json({ url: payment.redirectUrl });
  } catch (err) {
    if (err instanceof JekoError) return res.status(502).json({ error: err.message });
    throw err;
  }
});

/** Fin de la session par le partenaire : l'accès est coupé tout de suite. */
partnerRouter.post('/partner/viewer-sessions/:id/stop', ...guard, async (req, res) => {
  const row = await ownedViewer(req, res);
  if (!row) return;
  const ended = await pool.query(
    `UPDATE sessions SET status = 'completed', stopped_at = now(), stopped_by = 'technician', remote_password_encrypted = NULL
     WHERE id = $1 AND kind = 'viewer' AND status IN ('created', 'waiting_technician', 'active') RETURNING id`,
    [row.id],
  );
  if (!ended.rows[0]) return res.status(409).json({ code: 'ended', error: 'Cette session est déjà terminée.' });
  await closeViewerOrderIfUnpaid(pool, row.id);
  await logAudit(pool, { actorType: 'technician', actorId: req.partner!.id, sessionId: row.id, action: 'session.stopped', details: { stoppedBy: 'technician', viewer: true } });
  res.json({ stopped: true });
});
