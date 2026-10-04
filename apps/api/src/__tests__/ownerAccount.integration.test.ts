import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { ensureOwnerAccount } from '../utils/ownerAccount.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();

describe('Compte propriétaire défini par l\'environnement', () => {
  beforeAll(applyMigrations);
  beforeEach(truncateAll);
  afterAll(() => pool.end());

  it('neutralise les comptes d\'amorçage au mot de passe public et ne bute pas sur un téléphone déjà pris', async () => {
    await pool.query(`INSERT INTO technicians (full_name, phone, username, password_hash, role) VALUES ('Admin', '+2250700000001', 'admin', '$2a$12$BOh8GU1qe8.UsPnY3WnQ9OPTnXaWrM50WJJZdKkwLK1P5BKpz8gKe', 'admin')`);
    expect(await ensureOwnerAccount({ OWNER_USERNAME: 'franck', OWNER_PASSWORD: 'MotDePasse-123' })).toBe('created');
    const hash = (await pool.query(`SELECT password_hash FROM technicians WHERE username = 'admin'`)).rows[0].password_hash;
    expect(hash).not.toBe('$2a$12$BOh8GU1qe8.UsPnY3WnQ9OPTnXaWrM50WJJZdKkwLK1P5BKpz8gKe');
  });

  it('crée le compte, permet la connexion, puis remet le mot de passe à jour', async () => {
    expect(await ensureOwnerAccount({})).toBe('skipped');
    expect(await ensureOwnerAccount({ OWNER_USERNAME: 'franck', OWNER_PASSWORD: 'court' })).toBe('skipped');
    expect(await ensureOwnerAccount({ OWNER_USERNAME: 'franck', OWNER_PASSWORD: 'MotDePasse-123' })).toBe('created');
    const ok = await request(app).post('/api/auth/technician/login').send({ username: 'franck', password: 'MotDePasse-123' });
    expect(ok.status).toBe(200);
    expect(await ensureOwnerAccount({ OWNER_USERNAME: 'franck', OWNER_PASSWORD: 'Autre-Passe-456' })).toBe('updated');
    expect((await request(app).post('/api/auth/technician/login').send({ username: 'franck', password: 'MotDePasse-123' })).status).toBe(401);
    expect((await request(app).post('/api/auth/technician/login').send({ username: 'franck', password: 'Autre-Passe-456' })).status).toBe(200);
  });
});
