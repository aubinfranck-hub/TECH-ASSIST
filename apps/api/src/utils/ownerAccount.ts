import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';

/**
 * Compte propriétaire défini par l'environnement (OWNER_USERNAME + OWNER_PASSWORD) : permet de se connecter en
 * administrateur/technicien depuis un téléphone sans accès à la base. Crée le compte, ou remet son mot de passe à
 * la valeur de l'environnement. À retirer de l'environnement une fois le mot de passe changé.
 */
export async function ensureOwnerAccount(env: NodeJS.ProcessEnv = process.env): Promise<'created' | 'updated' | 'skipped'> {
  const username = env.OWNER_USERNAME?.trim();
  const password = env.OWNER_PASSWORD;
  if (!username || !password) return 'skipped';
  if (username.length < 3 || password.length < 10) {
    console.error('[compte] OWNER_USERNAME (3+) ou OWNER_PASSWORD (10+ caractères) trop court : ignoré.');
    return 'skipped';
  }
  const hash = await bcrypt.hash(password, 12);
  const phone = (env.OWNER_PHONE ?? '+2250700000001').trim();
  const updated = await pool.query(`UPDATE technicians SET password_hash = $2, role = 'admin' WHERE username = $1`, [username, hash]);
  if (updated.rowCount) return 'updated';
  await pool.query(
    `INSERT INTO technicians (full_name, phone, username, password_hash, role) VALUES ($1, $2, $3, $4, 'admin')`,
    [env.OWNER_FULL_NAME?.trim() || 'Propriétaire', phone, username, hash],
  );
  return 'created';
}
