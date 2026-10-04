import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { pool } from '../db/pool.js';

/**
 * Compte propriétaire défini par l'environnement (OWNER_USERNAME + OWNER_PASSWORD) : permet de se connecter en
 * administrateur/technicien depuis un téléphone sans accès à la base. Crée le compte, ou remet son mot de passe à
 * la valeur de l'environnement. À retirer de l'environnement une fois le mot de passe changé.
 */
/** Mots de passe de départ (anciennes migrations d'amorçage), publics dans l'historique du dépôt : à neutraliser. */
const LEAKED_SEED_HASHES = ['$2a$12$BOh8GU1qe8.UsPnY3WnQ9OPTnXaWrM50WJJZdKkwLK1P5BKpz8gKe', '$2a$12$vJBczV40Zj17RCWn/GzRj.c2ExyF66wJZkBCbj0sHpb1vD7SNm9O.'];

export async function ensureOwnerAccount(env: NodeJS.ProcessEnv = process.env): Promise<'created' | 'updated' | 'skipped'> {
  const username = env.OWNER_USERNAME?.trim();
  const password = env.OWNER_PASSWORD;
  if (!username || !password) return 'skipped';
  if (username.length < 3 || password.length < 10) {
    console.error('[compte] OWNER_USERNAME (3+) ou OWNER_PASSWORD (10+ caractères) trop court : ignoré.');
    return 'skipped';
  }
  const hash = await bcrypt.hash(password, 12);
  // Les comptes d'amorçage dont le mot de passe est resté celui du dépôt sont rendus inutilisables.
  const unusable = await bcrypt.hash(randomBytes(24).toString('base64url'), 12);
  await pool.query(`UPDATE technicians SET password_hash = $2 WHERE password_hash = ANY($1::text[]) AND username <> $3`, [LEAKED_SEED_HASHES, unusable, username]);
  const phone = (env.OWNER_PHONE?.trim() || `+22507${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`);
  const updated = await pool.query(`UPDATE technicians SET password_hash = $2, role = 'admin' WHERE username = $1`, [username, hash]);
  if (updated.rowCount) return 'updated';
  await pool.query(
    `INSERT INTO technicians (full_name, phone, username, password_hash, role) VALUES ($1, $2, $3, $4, 'admin')`,
    [env.OWNER_FULL_NAME?.trim() || 'Propriétaire', phone, username, hash],
  );
  return 'created';
}
