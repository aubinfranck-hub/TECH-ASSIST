import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', '..', 'migrations');

export async function applyMigrations() {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    await pool.query(sql);
  }
}

export async function truncateAll() {
  await pool.query(`
    TRUNCATE TABLE audit_logs, diagnostics, sessions, orders, technician_applications,
      pme_requests, visit_requests, technicians,
      company_help_requests, company_devices, company_consents, company_users, companies
      RESTART IDENTITY CASCADE;
  `);
  // pricing_plans n'est pas tronquée (référencée par les tests) — mais les
  // lignes PME/visites peuvent avoir été modifiées par un test admin ; on les
  // remet à leur valeur de référence pour ne pas polluer les tests suivants.
  await pool.query(`
    UPDATE pricing_plans SET active = TRUE
    WHERE id IN ('pme_essentiel', 'pme_pro', 'pme_entreprise', 'diagnostic_express', 'assistance_rapide', 'session_maintenance');
  `);
}
