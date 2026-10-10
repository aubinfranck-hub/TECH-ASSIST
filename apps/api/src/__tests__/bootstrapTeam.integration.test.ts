import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();

function team(overrides: Partial<{ adminUsername: string; techUsername: string }> = {}) {
  return {
    admin: {
      fullName: 'Admin Test',
      phone: '+2250700000201',
      username: overrides.adminUsername ?? 'admin_boot',
      password: 'motdepasse-admin',
    },
    technician: {
      fullName: 'Technicien Test',
      phone: '+2250700000202',
      username: overrides.techUsername ?? 'tech_boot',
      password: 'motdepasse-tech',
    },
  };
}

describe('Amorçage combiné admin + technicien', () => {
  beforeAll(async () => {
    await applyMigrations();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('crée un admin et un technicien en une seule fois', async () => {
    const res = await request(app).post('/api/auth/technician/bootstrap-team').send(team());
    expect(res.status).toBe(201);
    expect(res.body.admin.role).toBe('admin');
    expect(res.body.technician.role).toBe('technician');

    const adminLogin = await request(app)
      .post('/api/auth/technician/login')
      .send({ username: 'admin_boot', password: 'motdepasse-admin' });
    expect(adminLogin.status).toBe(200);

    const techLogin = await request(app)
      .post('/api/auth/technician/login')
      .send({ username: 'tech_boot', password: 'motdepasse-tech' });
    expect(techLogin.status).toBe(200);
  });

  it('refuse deux identifiants identiques', async () => {
    const res = await request(app)
      .post('/api/auth/technician/bootstrap-team')
      .send(team({ techUsername: 'admin_boot' }));
    expect(res.status).toBe(400);

    const count = await pool.query('SELECT count(*) FROM technicians');
    expect(Number(count.rows[0].count)).toBe(0);
  });

  it('refuse de rejouer l\'amorçage une fois un compte existant, sans laisser de compte partiel', async () => {
    const passwordHash = await bcrypt.hash('x', 4);
    await pool.query(
      `INSERT INTO technicians (full_name, phone, username, password_hash, role)
       VALUES ('Existant', '+2250700000200', 'deja_la', $1, 'technician')`,
      [passwordHash],
    );

    const res = await request(app).post('/api/auth/technician/bootstrap-team').send(team());
    expect(res.status).toBe(409);

    const count = await pool.query('SELECT count(*) FROM technicians');
    expect(Number(count.rows[0].count)).toBe(1); // seulement le compte préexistant
  });

  it('un admin peut créer d\'autres comptes techniciens ensuite (POST /admin/technicians)', async () => {
    await request(app).post('/api/auth/technician/bootstrap-team').send(team());
    const login = await request(app)
      .post('/api/auth/technician/login')
      .send({ username: 'admin_boot', password: 'motdepasse-admin' });
    const token = login.body.token as string;

    const created = await request(app)
      .post('/api/admin/technicians')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Un Autre', phone: '+2250700000203', username: 'tech_deux', password: 'motdepasse-deux' });
    expect(created.status).toBe(201);
    expect(created.body.technician.role).toBe('technician');

    const dup = await request(app)
      .post('/api/admin/technicians')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Encore Un Autre', phone: '+2250700000204', username: 'tech_deux', password: 'autre-motdepasse' });
    expect(dup.status).toBe(409);
  });
});
