import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthPayload {
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

export function signAuthToken(payload: AuthPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: '12h' });
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
