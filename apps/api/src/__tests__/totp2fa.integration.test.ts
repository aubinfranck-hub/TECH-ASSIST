import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { generateTotpCode } from '../utils/totp.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();

async function createTechnicianAccount(username: string) {
  const passwordHash = await bcrypt.hash('secret123', 4);
  const { rows } = await pool.query(
    `INSERT INTO technicians (full_name, phone, username, password_hash, role)
     VALUES ('2FA Test', '+22500000002', $1, $2, 'technician') RETURNING id`,
    [username, passwordHash],
  );
  return rows[0].id as string;
}

async function login(username: string) {
  const res = await request(app).post('/api/auth/technician/login').send({ username, password: 'secret123' });
  return res;
}

describe('2FA technicien (RS-08)', () => {
  beforeAll(async () => {
    await applyMigrations();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('se connecte normalement sans 2FA activée', async () => {
    await createTechnicianAccount('sans_2fa');
    const res = await login('sans_2fa');
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.requiresTotp).toBeUndefined();
  });

  it('active la 2FA, puis exige le second facteur à la connexion suivante', async () => {
    await createTechnicianAccount('avec_2fa');
    const firstLogin = await login('avec_2fa');
    const token = firstLogin.body.token as string;

    const setup = await request(app)
      .post('/api/auth/technician/2fa/setup')
      .set('Authorization', `Bearer ${token}`);
    expect(setup.status).toBe(200);
    const secret = setup.body.secret as string;

    const badEnable = await request(app)
      .post('/api/auth/technician/2fa/enable')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '000000' });
    expect(badEnable.status).toBe(401);

    const enable = await request(app)
      .post('/api/auth/technician/2fa/enable')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: generateTotpCode(secret) });
    expect(enable.status).toBe(200);
    expect(enable.body.enabled).toBe(true);

    const secondLogin = await login('avec_2fa');
    expect(secondLogin.status).toBe(200);
    expect(secondLogin.body.requiresTotp).toBe(true);
    expect(secondLogin.body.token).toBeUndefined();
    const preAuthToken = secondLogin.body.preAuthToken as string;

    const badTotp = await request(app)
      .post('/api/auth/technician/login/totp')
      .send({ preAuthToken, code: '111111' });
    expect(badTotp.status).toBe(401);

    const totpLogin = await request(app)
      .post('/api/auth/technician/login/totp')
      .send({ preAuthToken, code: generateTotpCode(secret) });
    expect(totpLogin.status).toBe(200);
    expect(totpLogin.body.token).toBeDefined();
  });

  it('interdit d\'utiliser le jeton pré-auth 2FA sur une route protégée', async () => {
    await createTechnicianAccount('preauth_test');
    const firstLogin = await login('preauth_test');
    const token = firstLogin.body.token as string;
    const setup = await request(app)
      .post('/api/auth/technician/2fa/setup')
      .set('Authorization', `Bearer ${token}`);
    await request(app)
      .post('/api/auth/technician/2fa/enable')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: generateTotpCode(setup.body.secret) });

    const secondLogin = await login('preauth_test');
    const preAuthToken = secondLogin.body.preAuthToken as string;

    const res = await request(app)
      .get('/api/technician/queue')
      .set('Authorization', `Bearer ${preAuthToken}`);
    // Rejeté dès la vérification d'audience du jeton (401), avant même le contrôle de rôle.
    expect(res.status).toBe(401);
  });

  it('permet à un admin de réinitialiser la 2FA d\'un technicien bloqué', async () => {
    const passwordHash = await bcrypt.hash('secret123', 4);
    await pool.query(
      `INSERT INTO technicians (full_name, phone, username, password_hash, role)
       VALUES ('Admin', '+22500000003', 'admin_2fa', $1, 'admin')`,
      [passwordHash],
    );
    const adminLogin = await login('admin_2fa');
    const adminToken = adminLogin.body.token as string;

    const techId = await createTechnicianAccount('bloque');
    const techLogin = await login('bloque');
    const techToken = techLogin.body.token as string;
    const setup = await request(app)
      .post('/api/auth/technician/2fa/setup')
      .set('Authorization', `Bearer ${techToken}`);
    await request(app)
      .post('/api/auth/technician/2fa/enable')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ code: generateTotpCode(setup.body.secret) });

    const reset = await request(app)
      .post(`/api/admin/technicians/${techId}/2fa/reset`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reset.status).toBe(200);

    const loginAfterReset = await login('bloque');
    expect(loginAfterReset.body.requiresTotp).toBeUndefined();
    expect(loginAfterReset.body.token).toBeDefined();
  });
});
