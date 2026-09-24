import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();

describe('Amorçage du premier compte admin', () => {
  beforeAll(async () => {
    await applyMigrations();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('crée le premier admin quand aucun technicien n\'existe', async () => {
    const res = await request(app).post('/api/auth/technician/bootstrap-admin').send({
      fullName: 'Premier Admin',
      phone: '+2250700000199',
      username: 'premier_admin',
      password: 'motdepasse-solide',
    });
    expect(res.status).toBe(201);
    expect(res.body.technician.role).toBe('admin');

    const login = await request(app)
      .post('/api/auth/technician/login')
      .send({ username: 'premier_admin', password: 'motdepasse-solide' });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeDefined();
  });

  it('refuse de créer un second compte une fois qu\'un technicien existe déjà', async () => {
    const first = await request(app).post('/api/auth/technician/bootstrap-admin').send({
      fullName: 'Premier Admin',
      phone: '+2250700000198',
      username: 'admin_un',
      password: 'motdepasse-solide',
    });
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/auth/technician/bootstrap-admin').send({
      fullName: 'Second Admin',
      phone: '+2250700000197',
      username: 'admin_deux',
      password: 'autre-motdepasse',
    });
    expect(second.status).toBe(409);

    const count = await pool.query('SELECT count(*) FROM technicians');
    expect(Number(count.rows[0].count)).toBe(1);
  });
});
