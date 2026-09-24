import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();

async function createAdmin() {
  const passwordHash = await bcrypt.hash('secret123', 4);
  await pool.query(
    `INSERT INTO technicians (full_name, phone, username, password_hash, role)
     VALUES ('Admin Test', '+22500000000', 'admin_test', $1, 'admin')`,
    [passwordHash],
  );
  const login = await request(app)
    .post('/api/auth/technician/login')
    .send({ username: 'admin_test', password: 'secret123' });
  return login.body.token as string;
}

async function createTechnician() {
  const passwordHash = await bcrypt.hash('secret123', 4);
  await pool.query(
    `INSERT INTO technicians (full_name, phone, username, password_hash, role)
     VALUES ('Tech Test', '+22500000001', 'tech_test', $1, 'technician')`,
    [passwordHash],
  );
  const login = await request(app)
    .post('/api/auth/technician/login')
    .send({ username: 'tech_test', password: 'secret123' });
  return login.body.token as string;
}

describe('Tech Assist API — parcours commande → paiement → diagnostic/session', () => {
  beforeAll(async () => {
    await applyMigrations();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('expose les tarifs sans authentification', async () => {
    const res = await request(app).get('/api/pricing');
    expect(res.status).toBe(200);
    expect(res.body.plans.length).toBeGreaterThanOrEqual(3);
  });

  it('bloque le diagnostic tant que la commande n\'est pas payée', async () => {
    const orderRes = await request(app)
      .post('/api/orders')
      .send({ clientPhone: '+2250700000001', planId: 'diagnostic_express', platform: 'web' });
    expect(orderRes.status).toBe(201);
    const orderId = orderRes.body.order.id;

    const blocked = await request(app)
      .post(`/api/orders/${orderId}/diagnostic`)
      .send({ platform: 'windows', problemDescription: 'Mon PC est lent', answers: {} });
    expect(blocked.status).toBe(402);
  });

  it('autorise le diagnostic après confirmation de paiement par un technicien authentifié', async () => {
    const token = await createAdmin();

    const orderRes = await request(app)
      .post('/api/orders')
      .send({ clientPhone: '+2250700000002', planId: 'diagnostic_express', platform: 'web' });
    const orderId = orderRes.body.order.id;

    const unauth = await request(app).post(`/api/orders/${orderId}/confirm-payment`);
    expect(unauth.status).toBe(401);

    const confirm = await request(app)
      .post(`/api/orders/${orderId}/confirm-payment`)
      .set('Authorization', `Bearer ${token}`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.order.status).toBe('paid');

    const diag = await request(app)
      .post(`/api/orders/${orderId}/diagnostic`)
      .send({ platform: 'windows', problemDescription: 'Mon PC rame beaucoup', answers: {} });
    expect(diag.status).toBe(201);
    expect(diag.body.diagnostic.source).toBe('local_engine');
  });

  it('empêche la création d\'une session tant que la commande n\'est pas payée', async () => {
    const orderRes = await request(app)
      .post('/api/orders')
      .send({ clientPhone: '+2250700000003', planId: 'assistance_rapide', platform: 'web' });
    const orderId = orderRes.body.order.id;

    const res = await request(app).post(`/api/orders/${orderId}/session`).send({ platform: 'web' });
    expect(res.status).toBe(402);
  });

  it('crée une session au code unique après paiement, avec expiration à 10 minutes', async () => {
    const token = await createAdmin();
    const orderRes = await request(app)
      .post('/api/orders')
      .send({ clientPhone: '+2250700000004', planId: 'assistance_rapide', platform: 'web' });
    const orderId = orderRes.body.order.id;

    await request(app).post(`/api/orders/${orderId}/confirm-payment`).set('Authorization', `Bearer ${token}`);

    const sessionRes = await request(app).post(`/api/orders/${orderId}/session`).send({ platform: 'web' });
    expect(sessionRes.status).toBe(201);
    expect(sessionRes.body.session.session_code).toMatch(/^[0-9]{9}$/);

    const expiresAt = new Date(sessionRes.body.session.code_expires_at).getTime();
    const now = Date.now();
    expect(expiresAt - now).toBeLessThanOrEqual(10 * 60 * 1000 + 5000);
    expect(expiresAt - now).toBeGreaterThan(9 * 60 * 1000);
  });

  it('permet au client d\'arrêter la session à tout moment (RS-02)', async () => {
    const token = await createAdmin();
    const orderRes = await request(app)
      .post('/api/orders')
      .send({ clientPhone: '+2250700000005', planId: 'assistance_rapide', platform: 'web' });
    const orderId = orderRes.body.order.id;
    await request(app).post(`/api/orders/${orderId}/confirm-payment`).set('Authorization', `Bearer ${token}`);
    const sessionRes = await request(app).post(`/api/orders/${orderId}/session`).send({ platform: 'web' });
    const sessionId = sessionRes.body.session.id;

    const stop = await request(app).post(`/api/sessions/${sessionId}/stop`).send({ stoppedBy: 'client' });
    expect(stop.status).toBe(200);
    expect(stop.body.session.status).toBe('completed');

    const stopAgain = await request(app).post(`/api/sessions/${sessionId}/stop`).send({ stoppedBy: 'client' });
    expect(stopAgain.status).toBe(409);
  });

  it('place les nouvelles sessions dans la file d\'attente technicien', async () => {
    const token = await createAdmin();
    const orderRes = await request(app)
      .post('/api/orders')
      .send({ clientPhone: '+2250700000006', planId: 'session_maintenance', platform: 'web' });
    const orderId = orderRes.body.order.id;
    await request(app).post(`/api/orders/${orderId}/confirm-payment`).set('Authorization', `Bearer ${token}`);
    await request(app).post(`/api/orders/${orderId}/session`).send({ platform: 'web' });

    const queue = await request(app).get('/api/technician/queue').set('Authorization', `Bearer ${token}`);
    expect(queue.status).toBe(200);
    expect(queue.body.queue.length).toBe(1);
  });

  it('permet à un technicien (pas seulement un admin) de voir et confirmer les paiements en attente', async () => {
    const techToken = await createTechnician();

    const orderRes = await request(app)
      .post('/api/orders')
      .send({ clientPhone: '+2250700000007', planId: 'diagnostic_express', platform: 'web' });
    const orderId = orderRes.body.order.id;

    const pending = await request(app)
      .get('/api/orders/pending-payment')
      .set('Authorization', `Bearer ${techToken}`);
    expect(pending.status).toBe(200);
    expect(pending.body.orders.some((o: { id: string }) => o.id === orderId)).toBe(true);

    const confirm = await request(app)
      .post(`/api/orders/${orderId}/confirm-payment`)
      .set('Authorization', `Bearer ${techToken}`);
    expect(confirm.status).toBe(200);
  });

  it('interdit à un technicien (non-admin) l\'accès aux routes admin', async () => {
    const techToken = await createTechnician();
    const res = await request(app).get('/api/admin/orders').set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(403);
  });

  describe('Appairage RustDesk (Lot L2)', () => {
    async function createActiveSession(techToken: string) {
      const orderRes = await request(app)
        .post('/api/orders')
        .send({ clientPhone: '+2250700000008', planId: 'assistance_rapide', platform: 'windows' });
      const orderId = orderRes.body.order.id;
      await request(app).post(`/api/orders/${orderId}/confirm-payment`).set('Authorization', `Bearer ${techToken}`);
      const sessionRes = await request(app).post(`/api/orders/${orderId}/session`).send({ platform: 'windows' });
      const sessionId = sessionRes.body.session.id;
      await request(app)
        .patch(`/api/technician/sessions/${sessionId}/claim`)
        .set('Authorization', `Bearer ${techToken}`);
      return sessionId;
    }

    it('renvoie 503 si le serveur RustDesk n\'est pas configuré', async () => {
      const res = await request(app).get('/api/remote-config');
      expect(res.status).toBe(503);
    });

    it('refuse de livrer les identifiants tant que le client n\'a pas consenti au contrôle', async () => {
      const techToken = await createAdmin();
      const sessionId = await createActiveSession(techToken);

      await request(app).post(`/api/sessions/${sessionId}/pair`).send({
        remotePeerId: '123456789',
        remotePassword: 'motdepasse-temp',
      });

      const blocked = await request(app)
        .get(`/api/technician/sessions/${sessionId}/remote-credentials`)
        .set('Authorization', `Bearer ${techToken}`);
      expect(blocked.status).toBe(403);

      await request(app).post(`/api/sessions/${sessionId}/consent`).send({ stage: 'screen' });
      await request(app).post(`/api/sessions/${sessionId}/consent`).send({ stage: 'control' });

      const allowed = await request(app)
        .get(`/api/technician/sessions/${sessionId}/remote-credentials`)
        .set('Authorization', `Bearer ${techToken}`);
      expect(allowed.status).toBe(200);
      expect(allowed.body.remotePeerId).toBe('123456789');
      expect(allowed.body.remotePassword).toBe('motdepasse-temp');
    });

    it('interdit à un technicien non assigné de voir les identifiants', async () => {
      const adminToken = await createAdmin();
      const otherTechToken = await createTechnician();
      const sessionId = await createActiveSession(adminToken);

      await request(app).post(`/api/sessions/${sessionId}/pair`).send({
        remotePeerId: '999999999',
        remotePassword: 'secret',
      });
      await request(app).post(`/api/sessions/${sessionId}/consent`).send({ stage: 'screen' });
      await request(app).post(`/api/sessions/${sessionId}/consent`).send({ stage: 'control' });

      const res = await request(app)
        .get(`/api/technician/sessions/${sessionId}/remote-credentials`)
        .set('Authorization', `Bearer ${otherTechToken}`);
      expect(res.status).toBe(403);
    });

    it('purge le mot de passe de connexion à distance quand la session est arrêtée (RS-10)', async () => {
      const techToken = await createAdmin();
      const sessionId = await createActiveSession(techToken);
      await request(app).post(`/api/sessions/${sessionId}/pair`).send({
        remotePeerId: '111111111',
        remotePassword: 'secret',
      });
      await request(app).post(`/api/sessions/${sessionId}/consent`).send({ stage: 'screen' });
      await request(app).post(`/api/sessions/${sessionId}/consent`).send({ stage: 'control' });

      await request(app).post(`/api/sessions/${sessionId}/stop`).send({ stoppedBy: 'client' });

      const res = await request(app)
        .get(`/api/technician/sessions/${sessionId}/remote-credentials`)
        .set('Authorization', `Bearer ${techToken}`);
      expect(res.status).toBe(409);
    });
  });
});
