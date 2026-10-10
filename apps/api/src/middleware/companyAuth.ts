import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

/** RP-08 : deux rôles côté entreprise. `kind: 'company'` évite toute confusion
 * avec les jetons technicien/admin (même secret JWT, formes de payload distinctes). */
export interface CompanyAuthPayload {
  kind: 'company';
  sub: string; // company_user id
  companyId: string;
  role: 'admin' | 'employee';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      companyAuth?: CompanyAuthPayload;
    }
  }
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET manquant');
  return secret;
}

export function signCompanyToken(payload: Omit<CompanyAuthPayload, 'kind'>): string {
  return jwt.sign({ ...payload, kind: 'company' } satisfies CompanyAuthPayload, getSecret(), { expiresIn: '12h' });
}

export function requireCompanyAuth(...roles: Array<CompanyAuthPayload['role']>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentification requise' });
    }
    try {
      const token = header.slice('Bearer '.length);
      const payload = jwt.verify(token, getSecret()) as CompanyAuthPayload;
      if (payload.kind !== 'company') {
        return res.status(401).json({ error: 'Jeton invalide pour cet espace' });
      }
      if (roles.length > 0 && !roles.includes(payload.role)) {
        return res.status(403).json({ error: 'Accès refusé pour ce rôle' });
      }
      req.companyAuth = payload;
      next();
    } catch {
      return res.status(401).json({ error: 'Session invalide ou expirée' });
    }
  };
}
