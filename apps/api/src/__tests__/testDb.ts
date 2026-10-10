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
    TRUNCATE TABLE learned_pannes, technician_earnings, technician_payouts, learned_procedure_runs, learned_procedures, knowledge_gaps, learning_calls, audit_logs, diagnostics, sessions, subscriptions, email_verifications, orders, app_installs, technician_applications,
      pme_requests, visit_requests, technicians,
      company_help_requests, company_diagnostic_requests, company_devices, company_consents, company_users, companies
      RESTART IDENTITY CASCADE;
  `);
  // pricing_plans n'est pas tronquée (référencée par les tests) — mais les
  // lignes PME/visites peuvent avoir été modifiées par un test admin ; on les
  // remet à leur valeur de référence pour ne pas polluer les tests suivants.
  // La grille de rémunération est modifiable en admin : on la remet à ses montants de départ.
  await pool.query(`UPDATE technician_pay_rates SET amount_fcfa = 1000`);
  await pool.query(`
    UPDATE pricing_plans SET active = TRUE
    WHERE id IN ('pme_essentiel', 'pme_pro', 'pme_entreprise', 'diagnostic_express', 'assistance_rapide',
      'assistance_offerte', 'abonnement_mensuel', 'assistance_abonne');
  `);
}

/** Code secret d'une session (celui que seul le client connaît), pour les tests. */
export async function codeOf(sessionId: string): Promise<string> {
  const { rows } = await pool.query('SELECT session_code FROM sessions WHERE id = $1', [sessionId]);
  return rows[0].session_code as string;
}
