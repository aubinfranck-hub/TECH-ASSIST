import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';

export interface AuthPayload {
  kind: 'technician';
  sub: string; // technician id
  role: 'technician' | 'admin' | 'partner';
  username: string;
  /** Jeton d'appareil (application Windows/Android) : identifiant de l'appareil, revérifié en base à chaque requête. */
  device?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET manquant');
  return secret;
}

export function signAuthToken(payload: Omit<AuthPayload, 'kind'>): string {
  return jwt.sign({ ...payload, kind: 'technician' } satisfies AuthPayload, getSecret(), { expiresIn: '12h' });
}

/** Jeton longue durée d'une application technicien, lié à un appareil révocable (table technician_devices). */
export const DEVICE_TOKEN_DAYS = 30;
export function signDeviceToken(payload: Omit<AuthPayload, 'kind' | 'device'>, deviceId: string): string {
  return jwt.sign({ ...payload, kind: 'technician', device: deviceId } satisfies AuthPayload, getSecret(), { expiresIn: `${DEVICE_TOKEN_DAYS}d` });
}

export interface PreAuthPayload {
  sub: string;
  stage: 'totp_pending';
}

/**
 * RS-08 : jeton intermédiaire entre mot de passe et code TOTP — courte durée
 * de vie, aucun claim `role`, donc inutilisable sur les routes protégées
 * même s'il fuite (requireAuth rejette faute de rôle reconnu).
 */
export function signPreAuthToken(technicianId: string): string {
  return jwt.sign({ sub: technicianId, stage: 'totp_pending' } satisfies PreAuthPayload, getSecret(), {
    expiresIn: '5m',
  });
}

export function verifyPreAuthToken(token: string): PreAuthPayload {
  const payload = jwt.verify(token, getSecret()) as PreAuthPayload;
  if (payload.stage !== 'totp_pending') throw new Error('Jeton invalide');
  return payload;
}

export function requireAuth(...roles: Array<AuthPayload['role']>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentification requise' });
    }
    let payload: AuthPayload;
    try {
      payload = jwt.verify(header.slice('Bearer '.length), getSecret()) as AuthPayload;
    } catch {
      return res.status(401).json({ error: 'Session invalide ou expirée' });
    }
    // Un jeton d'un autre espace (ex : compte entreprise) ne doit jamais
    // passer ici, même si son claim `role` porte accidentellement le même nom.
    if (payload.kind !== 'technician') {
      return res.status(401).json({ error: 'Jeton invalide pour cet espace' });
    }
    if (roles.length > 0 && !roles.includes(payload.role)) {
      return res.status(403).json({ error: 'Accès refusé pour ce rôle' });
    }
    if (payload.device) {
      // Jeton d'appareil : longue durée, donc revérifié à chaque fois (appareil révoqué ou technicien désactivé = refus immédiat).
      try {
        const { rows } = await pool.query(
          `SELECT 1 FROM technician_devices d JOIN technicians t ON t.id = d.technician_id
           WHERE d.id = $1 AND d.technician_id = $2 AND d.revoked_at IS NULL AND t.is_active`,
          [payload.device, payload.sub],
        );
        if (rows.length === 0) return res.status(401).json({ error: 'Appareil révoqué ou compte désactivé', code: 'device_revoked' });
        void pool.query(`UPDATE technician_devices SET last_seen_at = now() WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < now() - interval '5 minutes')`, [payload.device]).catch(() => undefined);
      } catch {
        return res.status(503).json({ error: 'Vérification impossible, réessayez' });
      }
    }
    req.auth = payload;
    next();
  };
}
