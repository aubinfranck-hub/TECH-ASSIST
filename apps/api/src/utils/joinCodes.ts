import { createHash, randomInt } from 'node:crypto';
import type { Db } from './audit.js';

/** Sans 0/O/1/I/L : le code est lu à voix haute ou recopié à la main. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;
const TTL_HOURS = 48;

export function normalizeJoinCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

export function isWellFormedJoinCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c));
}

function hashCode(code: string): string {
  return createHash('sha256').update(`join:${code}`).digest('hex');
}

function format(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export async function createJoinCode(db: Db, companyId: string): Promise<{ code: string; expiresAt: string }> {
  const code = Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  const { rows } = await db.query(
    `INSERT INTO company_join_codes (company_id, code_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(hours => $3)) RETURNING expires_at`,
    [companyId, hashCode(code), TTL_HOURS],
  );
  return { code: format(code), expiresAt: new Date(rows[0].expires_at).toISOString() };
}

/** Consomme le code (usage unique, atomique) et rend l'entreprise, ou null si invalide/expiré/déjà utilisé. */
export async function consumeJoinCode(db: Db, rawCode: string): Promise<{ companyId: string } | null> {
  const code = normalizeJoinCode(rawCode);
  if (!isWellFormedJoinCode(code)) return null;
  const { rows } = await db.query(
    `UPDATE company_join_codes SET consumed_at = now()
     WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > now()
     RETURNING company_id`,
    [hashCode(code)],
  );
  return rows[0] ? { companyId: rows[0].company_id as string } : null;
}
