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
      pme_requests, visit_requests, technicians RESTART IDENTITY CASCADE;
  `);
}
