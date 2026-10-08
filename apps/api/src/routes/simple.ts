import { createHash } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAppInstall, signAppToken } from '../middleware/appAuth.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { creditConfirmations, rememberResolved } from '../assistant/pannesLearning.js';
import { freeLaunch } from '../utils/offers.js';
import { isDisposableEmail, normalizeEmail } from '../utils/email.js';
import { logAudit } from '../utils/audit.js';

/**
 * Parcours « comme AnyDesk » : l'exe démarre sans inscription (aucun e-mail, aucun téléphone), le client reçoit un NUMÉRO D'AIDE à
 * donner au technicien, et ses coordonnées ne sont demandées que s'il appelle un technicien.
 */
export const simpleRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === 'test' });
/** Seuls les ÉCHECS comptent : deviner des numéros d'aide est limité, un numéro juste ne coûte rien. */
const guessLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true, skip: () => process.env.NODE_ENV === 'test' });

/** Adresse fictive, non livrable, propre à une installation anonyme (la colonne est obligatoire en base). */
export const ANONYMOUS_DOMAIN = 'anonyme.techassist.invalid';
export const isAnonymousEmail = (email: string) => email.endsWith(`@${ANONYMOUS_DOMAIN}`);
const anonymousEmail = (installId: string) => `anonyme-${createHash('sha256').update(installId).digest('hex').slice(0, 24)}@${ANONYMOUS_DOMAIN}`;

const anonymousSchema = z.object({
  installId: z.string().min(16).max(100),
  platform: z.enum(['windows', 'android']),
  hardwareHash: z.string().min(16).max(200).optional(),
});

simpleRouter.post('/app/anonymous', limiter, validateBody(anonymousSchema), async (req, res) => {
  const body = req.body as z.infer<typeof anonymousSchema>;
  const existing = await pool.query('SELECT id, client_email FROM app_installs WHERE install_id = $1', [body.installId]);
  // Une installation déjà inscrite avec un vrai e-mail se reconnecte par son code, jamais en anonyme.
  if (existing.rows[0] && !isAnonymousEmail(existing.rows[0].client_email) && existing.rows[0].client_email !== anonymousEmail(body.installId)) {
    return res.status(409).json({ error: 'Cette installation est déjà enregistrée.', code: 'registered' });
  }
  const { rows } = await pool.query(
    `INSERT INTO app_installs (install_id, platform, hardware_hash, client_email, client_phone)
     VALUES ($1, $2, $3, $4, '')
     ON CONFLICT (install_id) DO UPDATE SET hardware_hash = COALESCE(app_installs.hardware_hash, EXCLUDED.hardware_hash), last_seen_at = now()
     RETURNING id`,
    [body.installId, body.platform, body.hardwareHash ?? null, anonymousEmail(body.installId)],
  );
  res.status(201).json({ token: signAppToken(rows[0].id), anonymous: true, freeLaunch: freeLaunch() });
});

const contactSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().regex(/^\+?[0-9]{8,15}$/, 'Numéro de téléphone invalide').optional(),
  name: z.string().trim().max(120).optional(),
});

/** Coordonnées données au moment d'appeler un technicien : il peut ainsi rappeler. Remplacent l'adresse fictive. */
simpleRouter.post('/app/contact', limiter, requireAppInstall, validateBody(contactSchema), async (req, res) => {
  const body = req.body as z.infer<typeof contactSchema>;
  const install = req.appInstall!;
  const email = normalizeEmail(body.email);
  if (isDisposableEmail(email)) return res.status(400).json({ error: 'Utilisez une adresse email personnelle ou professionnelle.' });
  await pool.query(
    `UPDATE app_installs SET client_email = $2, client_phone = COALESCE($3, client_phone), client_name = COALESCE($4, client_name) WHERE id = $1`,
    [install.id, email, body.phone ?? null, body.name ?? null],
  );
  // Les demandes en cours de cette installation affichent ces coordonnées au technicien.
  await pool.query(
    `UPDATE orders SET client_email = $2, client_phone = COALESCE($3, client_phone), client_name = COALESCE($4, client_name)
     WHERE app_install_id = $1 AND status IN ('paid', 'pending_payment')`,
    [install.id, email, body.phone ?? null, body.name ?? null],
  );
  await logAudit(pool, { actorType: 'client', actorId: email, action: 'app.contact_given', details: { phone: Boolean(body.phone) } });
  res.json({ saved: true });
});

const helpedSchema = z.object({ helped: z.boolean() });

/** « Cette réponse vous aide-t-elle ? » : si oui, la solution entre au lexique (à relire par un technicien). */
simpleRouter.post('/app/sessions/:id/chat/feedback', limiter, requireAppInstall, validateBody(helpedSchema), async (req, res) => {
  if (!UUID.test(req.params.id!)) return res.status(404).json({ error: 'Session introuvable' });
  const owned = await pool.query(`SELECT s.id FROM sessions s JOIN orders o ON o.id = s.order_id WHERE s.id = $1 AND o.app_install_id = $2`, [req.params.id, req.appInstall!.id]);
  if (!owned.rows[0]) return res.status(404).json({ error: 'Session introuvable' });
  if (!(req.body as z.infer<typeof helpedSchema>).helped) return res.json({ remembered: false });
  const last = await pool.query(`SELECT details FROM audit_logs WHERE session_id = $1 AND action = 'agent.chat' ORDER BY id DESC LIMIT 1`, [req.params.id]);
  const d = last.rows[0]?.details as { question?: string; answerFull?: string; answer?: string; usedIds?: string[] } | undefined;
  const id = d?.question && (d.answerFull ?? d.answer) ? await rememberResolved(d.question, (d.answerFull ?? d.answer)!) : null;
  // Les fiches de l'IA qui ont servi à cette réponse reçoivent la confirmation de ce client (2 clients différents : elles deviennent de confiance).
  const promoted = Array.isArray(d?.usedIds) ? await creditConfirmations(d.usedIds, req.appInstall!.id).catch(() => 0) : 0;
  res.json({ remembered: id !== null, promoted });
});

const byCodeSchema = z.object({ code: z.string().regex(/^\d{9}$/, 'Le numéro comporte 9 chiffres') });

/**
 * Le technicien tape le numéro d'aide que le client lui a donné (comme AnyDesk) : la demande passe en « technicien » et il peut la
 * prendre en charge. Le client voit alors la demande d'autorisation dans son exe (RustDesk redemande « Accepter »).
 */
simpleRouter.post('/technician/sessions/by-code', guessLimiter, requireAuth('technician', 'admin'), validateBody(byCodeSchema), async (req, res) => {
  const { code } = req.body as z.infer<typeof byCodeSchema>;
  const { rows } = await pool.query(
    `SELECT id, status, technician_id, human_included FROM sessions
     WHERE session_code = $1 AND kind = 'assistance' AND status IN ('created', 'waiting_technician', 'active')`,
    [code],
  );
  const session = rows[0];
  if (!session) return res.status(404).json({ error: 'Aucune demande ouverte avec ce numéro.' });
  if (session.technician_id && session.technician_id !== req.auth!.sub && req.auth!.role !== 'admin') {
    return res.status(409).json({ error: 'Cette demande est suivie par un autre technicien.' });
  }
  if (session.human_included === false) {
    return res.status(402).json({ error: "L'offre de ce client ne comprend pas de technicien (offre « IA seule »)." });
  }
  await pool.query(
    `UPDATE sessions SET mode = 'humain', status = CASE WHEN status = 'created' THEN 'waiting_technician' ELSE status END,
       human_requested_at = COALESCE(human_requested_at, now()) WHERE id = $1`,
    [session.id],
  );
  await logAudit(pool, { actorType: 'technician', actorId: req.auth!.sub, sessionId: session.id, action: 'technician.joined_by_code' });
  res.json({ id: session.id });
});
