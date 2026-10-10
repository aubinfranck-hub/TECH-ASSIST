import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { pool } from './pool.js';

/**
 * Crée (ou réinitialise) un compte admin. Le mot de passe est généré et
 * affiché une seule fois en console — jamais stocké en clair ni committé.
 * Usage : npm run seed:admin --workspace apps/api -- <username> <telephone>
 */
async function run() {
  const [username, phone] = process.argv.slice(2);
  if (!username || !phone) {
    console.error('Usage: tsx src/db/seedAdmin.ts <username> <telephone>');
    process.exit(1);
  }

  const password = randomBytes(9).toString('base64url');
  const passwordHash = await bcrypt.hash(password, 12);

  await pool.query(
    `INSERT INTO technicians (full_name, phone, username, password_hash, role)
     VALUES ($1, $2, $3, $4, 'admin')
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin'`,
    ['Administrateur', phone, username, passwordHash],
  );

  console.log(`Compte admin '${username}' prêt.`);
  console.log(`Mot de passe (à noter, non réaffiché) : ${password}`);
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
