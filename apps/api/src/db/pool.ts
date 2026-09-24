import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL manquant (voir .env.example)');
}

export const pool = new Pool({ connectionString });
