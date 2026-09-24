import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { logAudit } from '../utils/audit.js';
import { decryptSecret, encryptSecret } from '../utils/crypto.js';

export const remoteRouter = Router();

function bootstrapSecret(): string {
  const secret = process.env.REMOTE_BOOTSTRAP_SECRET ?? process.env.JWT_SECRET;
  if (!secret) throw new Error('REMOTE_BOOTSTRAP_SECRET ou JWT_SECRET manquant');
  return secret;
}

function makeBootstrapToken(sessionId: string, sessionCode: string): string {
  return createHmac('sha256', bootstrapSecret()).update(sessionId + ':' + sessionCode).digest('base64url');
}

function validBootstrapToken(sessionId: string, sessionCode: string, token: string): boolean {
  const expected = makeBootstrapToken(sessionId, sessionCode);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

remoteRouter.get('/remote-config', (_req, res) => {
  const idServer = process.env.RUSTDESK_ID_SERVER;
  const relayServer = process.env.RUSTDESK_RELAY_SERVER;
  const key = process.env.RUSTDESK_PUBLIC_KEY;
  if (!idServer || !relayServer || !key) {
    return res.status(503).json({ error: "Serveur d'assistance à distance pas encore configuré" });
  }
  res.json({ idServer, relayServer, key });
});

remoteRouter.get('/sessions/:code/remote-bootstrap', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, session_code, status, code_expires_at, remote_paired_at FROM sessions WHERE session_code = $1',
    [req.params.code],
  );
  const session = rows[0];
  if (!session) return res.status(404).json({ error: 'Session introuvable' });
  if (new Date(session.code_expires_at).getTime() <= Date.now()) return res.status(410).json({ error: 'Le code de session a expiré' });
  if (!['created', 'waiting_technician', 'active'].includes(session.status)) return res.status(409).json({ error: 'Cette session ne peut plus être appairée' });
  if (session.remote_paired_at) return res.status(409).json({ error: 'Cette session est déjà appairée' });

  const idServer = process.env.RUSTDESK_ID_SERVER;
  const relayServer = process.env.RUSTDESK_RELAY_SERVER;
  const key = process.env.RUSTDESK_PUBLIC_KEY;
  if (!idServer || !relayServer || !key) return res.status(503).json({ error: "Serveur d'assistance à distance pas encore configuré" });

  res.json({
    sessionId: session.id,
    bootstrapToken: makeBootstrapToken(session.id, session.session_code),
    rustdesk: { idServer, relayServer, key },
    windows: {
      version: '1.4.9',
      url: 'https://github.com/rustdesk/rustdesk/releases/download/1.4.9/rustdesk-1.4.9-x86_64.exe',
      sha256: 'eaedeb0088e687bf46f7c46a9c6ea5493ce51f3134dfd6acbedb47b5b9136274',
    },
  });
});

const pairSchema = z.object({
  remotePeerId: z.string().min(1).max(50),
  remotePassword: z.string().min(1).max(200),
  bootstrapToken: z.string().min(20).max(200),
});

remoteRouter.post('/sessions/:id/pair', validateBody(pairSchema), async (req, res) => {
  const { remotePeerId, remotePassword, bootstrapToken } = req.body as z.infer<typeof pairSchema>;
  const sessionResult = await pool.query(
    'SELECT id, session_code, status, code_expires_at, remote_paired_at FROM sessions WHERE id = $1',
    [req.params.id],
  );
  const session = sessionResult.rows[0];
  if (!session) return res.status(404).json({ error: 'Session introuvable' });
  if (!['created', 'waiting_technician', 'active'].includes(session.status)) return res.status(409).json({ error: 'Cette session ne peut plus être appairée' });
  if (new Date(session.code_expires_at).getTime() <= Date.now()) return res.status(410).json({ error: 'Le code de session a expiré' });
  if (session.remote_paired_at) return res.status(409).json({ error: 'Cette session est déjà appairée' });
  if (!validBootstrapToken(session.id, session.session_code, bootstrapToken)) return res.status(403).json({ error: 'Jeton d’appairage invalide ou expiré' });

  const { rows } = await pool.query(
    'UPDATE sessions SET remote_peer_id = $2, remote_password_encrypted = $3, remote_paired_at = now() WHERE id = $1 AND remote_paired_at IS NULL RETURNING id, remote_paired_at',
    [req.params.id, remotePeerId, encryptSecret(remotePassword)],
  );
  if (!rows[0]) return res.status(409).json({ error: 'Session déjà appairée' });

  await logAudit(pool, {
    actorType: 'client',
    sessionId: req.params.id,
    action: 'session.paired',
    details: { remoteProvider: 'rustdesk', method: 'bootstrap' },
  });

  res.status(201).json({ session: rows[0] });
});

remoteRouter.get('/technician/sessions/:id/remote-credentials', requireAuth('technician', 'admin'), async (req, res) => {
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
