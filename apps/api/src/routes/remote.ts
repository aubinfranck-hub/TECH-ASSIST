import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { logAudit } from '../utils/audit.js';
import { decryptSecret, encryptSecret } from '../utils/crypto.js';

export const remoteRouter = Router();

/**
 * L2/D1 : identifiants publics du serveur RustDesk auto-hébergé (pas un
 * secret — c'est l'équivalent d'une adresse de serveur), pour que le client
 * configure son client RustDesk portable (Réseau > Serveur ID/Relais/Clé).
 */
remoteRouter.get('/remote-config', (_req, res) => {
  const idServer = process.env.RUSTDESK_ID_SERVER;
  const relayServer = process.env.RUSTDESK_RELAY_SERVER;
  const key = process.env.RUSTDESK_PUBLIC_KEY;

  if (!idServer || !relayServer || !key) {
    return res.status(503).json({ error: "Serveur d'assistance à distance pas encore configuré" });
  }

  res.json({ idServer, relayServer, key });
});

const pairSchema = z.object({
  remotePeerId: z.string().min(1).max(50),
  remotePassword: z.string().min(1).max(200),
});

/**
 * Le client, après avoir lancé son client RustDesk portable et l'avoir
 * pointé sur notre serveur (via /remote-config), communique son ID et un
 * mot de passe temporaire — appairage avec notre code de session.
 */
remoteRouter.post('/sessions/:id/pair', validateBody(pairSchema), async (req, res) => {
  const { remotePeerId, remotePassword } = req.body as z.infer<typeof pairSchema>;

  const sessionResult = await pool.query('SELECT id, status FROM sessions WHERE id = $1', [req.params.id]);
  const session = sessionResult.rows[0];
  if (!session) return res.status(404).json({ error: 'Session introuvable' });
  if (!['created', 'waiting_technician', 'active'].includes(session.status)) {
    return res.status(409).json({ error: 'Cette session ne peut plus être appairée' });
  }

  const { rows } = await pool.query(
    `UPDATE sessions
     SET remote_peer_id = $2, remote_password_encrypted = $3, remote_paired_at = now()
     WHERE id = $1
     RETURNING id, remote_paired_at`,
    [req.params.id, remotePeerId, encryptSecret(remotePassword)],
  );

  await logAudit(pool, {
    actorType: 'client',
    sessionId: req.params.id,
    action: 'session.paired',
    details: { remoteProvider: 'rustdesk' },
  });

  res.status(201).json({ session: rows[0] });
});

/**
 * RS-01/RS-09 : le technicien assigné ne voit les identifiants de connexion
 * qu'après avoir pris la session en charge ET après le consentement
 * "contrôle" explicite du client — jamais avant, jamais un autre technicien.
 */
remoteRouter.get(
  '/technician/sessions/:id/remote-credentials',
  requireAuth('technician', 'admin'),
  async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, status, technician_id, consent_control_at, remote_peer_id, remote_password_encrypted
       FROM sessions WHERE id = $1`,
      [req.params.id],
    );
    const session = rows[0];
    if (!session) return res.status(404).json({ error: 'Session introuvable' });

    const isAssignedTechnician = session.technician_id === req.auth!.sub;
    if (req.auth!.role !== 'admin' && !isAssignedTechnician) {
      return res.status(403).json({ error: 'Cette session est assignée à un autre technicien' });
    }
    if (!session.consent_control_at) {
      return res.status(403).json({ error: 'Le client n\'a pas encore autorisé le contrôle' });
    }
    if (!session.remote_peer_id || !session.remote_password_encrypted) {
      return res.status(409).json({ error: 'Le client n\'a pas encore appairé son outil' });
    }

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
  },
);
