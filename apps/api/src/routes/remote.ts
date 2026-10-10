import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { logAudit } from '../utils/audit.js';
import { expireOverdueSessions } from '../utils/sessionClock.js';
import { decryptSecret, encryptSecret } from '../utils/crypto.js';

export const remoteRouter = Router();

// Le code de session est un secret temporaire : cette limite empêche de le
// deviner à grande échelle. Elle couvre aussi le jeton d'appairage émis après
// un code valide et la route qui enregistre les identifiants RustDesk.
const remoteBootstrapLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

const remotePairLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

function bootstrapSecret(): string {
  const secret = process.env.REMOTE_BOOTSTRAP_SECRET ?? process.env.JWT_SECRET;
  if (!secret) throw new Error('REMOTE_BOOTSTRAP_SECRET ou JWT_SECRET manquant');
  return secret;
}

function makeBootstrapToken(sessionId: string, sessionCode: string): string {
  return createHmac('sha256', bootstrapSecret()).update(sessionId + ':' + sessionCode).digest('base64url');
}

/** Une session ouverte garde le droit de s'appairer au-delà des 10 minutes du code : le client peut attendre longtemps un technicien. */
const PAIRING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
function pairingWindowClosed(session: { code_expires_at: Date | string; created_at: Date | string }): boolean {
  if (new Date(session.code_expires_at).getTime() > Date.now()) return false;
  return Date.now() - new Date(session.created_at).getTime() > PAIRING_MAX_AGE_MS;
}

function validBootstrapToken(sessionId: string, sessionCode: string, token: string): boolean {
  const expected = makeBootstrapToken(sessionId, sessionCode);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Client Windows RustDesk épinglé (version + empreinte) : l'agent et le site vérifient l'empreinte avant de le lancer. */
export const RUSTDESK_WINDOWS = {
  version: '1.4.9',
  url: 'https://github.com/rustdesk/rustdesk/releases/download/1.4.9/rustdesk-1.4.9-x86_64.exe',
  sha256: 'eaedeb0088e687bf46f7c46a9c6ea5493ce51f3134dfd6acbedb47b5b9136274',
};

/**
 * Serveur RustDesk auto-hébergé (D1), s'il est configuré. Sinon `null` : RustDesk utilise alors son réseau public par défaut,
 * ce qui permet à l'assistance de fonctionner dès maintenant, sans serveur à héberger (voir docs/lot-l2-remote.md).
 */
export function selfHostedRustdesk(): { idServer: string; relayServer: string; key: string } | null {
  const idServer = process.env.RUSTDESK_ID_SERVER?.trim();
  const key = process.env.RUSTDESK_PUBLIC_KEY?.trim();
  if (!idServer || !key) return null;
  return { idServer, relayServer: process.env.RUSTDESK_RELAY_SERVER?.trim() || idServer, key };
}

/** Chaîne d'import RustDesk (menu Réseau → importer la configuration du serveur) : JSON {host, relay, key, api} en base64, à l'envers. */
export function rustdeskConfigString(server: { idServer: string; relayServer: string; key: string }): string {
  const json = JSON.stringify({ host: server.idServer, relay: server.relayServer, key: server.key, api: '' });
  return Buffer.from(json, 'utf8').toString('base64').split('').reverse().join('');
}

remoteRouter.get('/remote-config', (_req, res) => {
  const server = selfHostedRustdesk();
  if (!server) return res.status(503).json({ error: "Serveur d'assistance à distance pas encore configuré" });
  res.json(server);
});

/** Réglages à saisir une fois dans le RustDesk du technicien (inutile avec le réseau public RustDesk). */
remoteRouter.get('/technician/remote-config', requireAuth('technician', 'admin'), (_req, res) => {
  const server = selfHostedRustdesk();
  res.json(server ? { custom: true, ...server, configString: rustdeskConfigString(server), windows: RUSTDESK_WINDOWS } : { custom: false, windows: RUSTDESK_WINDOWS });
});

remoteRouter.get('/sessions/:code/remote-bootstrap', remoteBootstrapLimiter, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, session_code, status, code_expires_at, created_at, remote_paired_at FROM sessions WHERE session_code = $1',
    [req.params.code],
  );
  const session = rows[0];
  if (!session) return res.status(404).json({ error: 'Session introuvable' });
  if (pairingWindowClosed(session)) return res.status(410).json({ error: 'Le code de session a expiré' });
  if (!['created', 'waiting_technician', 'active'].includes(session.status)) return res.status(409).json({ error: 'Cette session ne peut plus être appairée' });
  if (session.remote_paired_at) return res.status(409).json({ error: 'Cette session est déjà appairée' });

  res.json({
    sessionId: session.id,
    bootstrapToken: makeBootstrapToken(session.id, session.session_code),
    // null : réseau public RustDesk (aucun serveur auto-hébergé configuré).
    rustdesk: selfHostedRustdesk(),
    windows: RUSTDESK_WINDOWS,
  });
});

const pairSchema = z.object({
  remotePeerId: z.string().min(1).max(50),
  remotePassword: z.string().min(1).max(200),
  bootstrapToken: z.string().min(20).max(200),
});

remoteRouter.post('/sessions/:id/pair', remotePairLimiter, validateBody(pairSchema), async (req, res) => {
  const { remotePeerId, remotePassword, bootstrapToken } = req.body as z.infer<typeof pairSchema>;
  const sessionResult = await pool.query(
    'SELECT id, session_code, status, code_expires_at, created_at, remote_paired_at FROM sessions WHERE id = $1',
    [req.params.id],
  );
  const session = sessionResult.rows[0];
  if (!session) return res.status(404).json({ error: 'Session introuvable' });
  if (!['created', 'waiting_technician', 'active'].includes(session.status)) return res.status(409).json({ error: 'Cette session ne peut plus être appairée' });
  if (pairingWindowClosed(session)) return res.status(410).json({ error: 'Le code de session a expiré' });
  if (session.remote_paired_at) return res.status(409).json({ error: 'Cette session est déjà appairée' });
  if (!validBootstrapToken(session.id, session.session_code, bootstrapToken)) return res.status(403).json({ error: 'Jeton d’appairage invalide ou expiré' });

  const { rows } = await pool.query(
    // Comme AnyDesk : lancer l'outil sur son PC, c'est donner son accord (RustDesk redemande « Accepter » à chaque connexion).
    `UPDATE sessions SET remote_peer_id = $2, remote_password_encrypted = $3, remote_paired_at = now(),
       consent_screen_at = COALESCE(consent_screen_at, now()), consent_control_at = COALESCE(consent_control_at, now())
     WHERE id = $1 AND remote_paired_at IS NULL RETURNING id, remote_paired_at`,
    [req.params.id, remotePeerId, encryptSecret(remotePassword)],
  );
  if (!rows[0]) return res.status(409).json({ error: 'Session déjà appairée' });

  await logAudit(pool, {
    actorType: 'client',
    sessionId: req.params.id,
    action: 'session.paired',
    details: { remoteProvider: 'rustdesk', method: 'bootstrap', consentImplied: true },
  });

  res.status(201).json({ session: rows[0] });
});

remoteRouter.get('/technician/sessions/:id/remote-credentials', requireAuth('technician', 'admin'), async (req, res) => {
  await expireOverdueSessions(pool);
  const { rows } = await pool.query(
    'SELECT id, status, technician_id, consent_control_at, remote_peer_id, remote_password_encrypted FROM sessions WHERE id = $1',
    [req.params.id],
  );
  const session = rows[0];
  if (!session) return res.status(404).json({ error: 'Session introuvable' });

  const isAssignedTechnician = session.technician_id === req.auth!.sub;
  if (req.auth!.role !== 'admin' && !isAssignedTechnician) return res.status(403).json({ error: 'Cette session est assignée à un autre technicien' });
  if (!session.consent_control_at) return res.status(403).json({ error: "Le client n'a pas encore autorisé le contrôle" });
  if (!session.remote_peer_id || !session.remote_password_encrypted) return res.status(409).json({ error: "Le client n'a pas encore appairé son outil" });

  await logAudit(pool, {
    actorType: 'technician',
    actorId: req.auth!.sub,
    sessionId: req.params.id,
    action: 'session.remote_credentials_viewed',
  });

  res.json({
    remotePeerId: session.remote_peer_id,
    remotePassword: decryptSecret(session.remote_password_encrypted),
  });
});
