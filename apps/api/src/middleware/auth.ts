import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthPayload {
  kind: 'technician';
  sub: string; // technician id
  role: 'technician' | 'admin';
  username: string;
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
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentification requise' });
    }
    try {
      const token = header.slice('Bearer '.length);
      const payload = jwt.verify(token, getSecret()) as AuthPayload;
      // Un jeton d'un autre espace (ex : compte entreprise) ne doit jamais
      // passer ici, même si son claim `role` porte accidentellement le même nom.
      if (payload.kind !== 'technician') {
        return res.status(401).json({ error: 'Jeton invalide pour cet espace' });
      }
      if (roles.length > 0 && !roles.includes(payload.role)) {
        return res.status(403).json({ error: 'Accès refusé pour ce rôle' });
      }
      req.auth = payload;
      next();
    } catch {
      return res.status(401).json({ error: 'Session invalide ou expirée' });
    }
  };
}
