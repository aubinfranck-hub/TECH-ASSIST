import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';

/** Identité d'une installation de l'application (jamais un technicien ni une entreprise). */
export interface AppInstall {
  id: string;
  platform: 'windows' | 'android';
  email: string;
  phone: string;
  name: string | null;
  hardwareHash: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      appInstall?: AppInstall;
    }
  }
}

const AUDIENCE = 'tech-assist-app';

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET manquant');
  return secret;
}

/** Jeton longue durée remis à l'application après inscription ; l'audience le rend inutilisable ailleurs. */
export function signAppToken(appInstallId: string): string {
  return jwt.sign({ kind: 'app', sub: appInstallId }, getSecret(), { expiresIn: '180d', audience: AUDIENCE });
}

/**
 * Exige un jeton d'application valide ET recharge l'installation depuis la base :
 * les droits (offre gratuite, abonnement) ne viennent jamais du jeton lui-même.
 */
export async function requireAppInstall(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Application non enregistrée' });
  }
  let sub: string;
  try {
    const payload = jwt.verify(header.slice('Bearer '.length), getSecret(), { audience: AUDIENCE }) as {
      kind?: string;
      sub?: string;
    };
    if (payload.kind !== 'app' || !payload.sub) throw new Error('jeton invalide');
    sub = payload.sub;
  } catch {
    return res.status(401).json({ error: 'Session application invalide ou expirée' });
  }

  const { rows } = await pool.query(
    `UPDATE app_installs SET last_seen_at = now() WHERE id = $1
     RETURNING id, platform, client_email, client_phone, client_name, hardware_hash`,
    [sub],
  );
  const row = rows[0];
  if (!row) return res.status(401).json({ error: 'Installation inconnue' });

  req.appInstall = {
    id: row.id,
    platform: row.platform,
    email: row.client_email,
    phone: row.client_phone,
    name: row.client_name,
    hardwareHash: row.hardware_hash,
  };
  next();
}
