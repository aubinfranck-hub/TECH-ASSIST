import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();

describe('supervision admin', () => {
  beforeAll(applyMigrations);
  beforeEach(truncateAll);
  afterAll(() => pool.end());

  it('renvoie les chiffres du jour et refuse un non-admin', async () => {
    const hash = await bcrypt.hash('secret123', 4);
    await pool.query(
      `INSERT INTO technicians (full_name, phone, username, password_hash, role) VALUES ('Admin', '+22500000000', 'adm', $1, 'admin'), ('Tech', '+22500000001', 'tec', $1, 'technician')`,
      [hash],
    );
    const login = async (u: string) => (await request(app).post('/api/auth/technician/login').send({ username: u, password: 'secret123' })).body.token as string;
    const res = await request(app).get('/api/admin/overview').set('Authorization', `Bearer ${await login('adm')}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ active: 0, waiting: 0, today: 0, paidToday: 0, alerts: [] });
    expect(Array.isArray(res.body.recent)).toBe(true);
    const denied = await request(app).get('/api/admin/overview').set('Authorization', `Bearer ${await login('tec')}`);
    expect(denied.status).toBe(403);
  });
});
