import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { testOutbox } from '../utils/mailer.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();
let counter = 0;

async function registerAndroid() {
  const email = `droid${++counter}@example.com`;
  testOutbox.length = 0;
  await request(app).post('/api/app/email-code').send({ email }).expect(200);
  const code = /: ([0-9]{6})/.exec(testOutbox[testOutbox.length - 1].text)![1];
  const res = await request(app)
    .post('/api/app/register')
    .send({ installId: `droid-${Date.now()}-${counter}-aaaaaaaaaaaa`, platform: 'android', email, code, phone: '+2250700003333' });
  expect(res.status).toBe(201);
  return { Authorization: `Bearer ${res.body.token as string}` };
}

async function staff() {
  const passwordHash = await bcrypt.hash('secret123', 4);
  const { rows } = await pool.query(
    `INSERT INTO technicians (full_name, phone, username, password_hash, role)
     VALUES ('Agent Droid', '+22500000088', 'agent_droid', $1, 'admin') ON CONFLICT (username) DO UPDATE SET role = 'admin' RETURNING id`,
    [passwordHash],
  );
  const login = await request(app).post('/api/auth/technician/login').send({ username: 'agent_droid', password: 'secret123' });
  return { id: rows[0].id as string, headers: { Authorization: `Bearer ${login.body.token as string}` } };
}

async function paidSession(auth: Record<string, string>, planId: 'diagnostic_express' | 'assistance_rapide', mode: 'ia' | 'humain') {
  const tech = await staff();
  const order = await request(app).post('/api/app/orders').set(auth).send({ planId });
  await request(app).post(`/api/orders/${order.body.order.id}/confirm-payment`).set(tech.headers).expect(200);
  const started = await request(app).post('/api/app/assistance').set(auth).send({ orderId: order.body.order.id, mode });
  expect(started.status).toBe(201);
  return { sessionId: started.body.session.id as string, tech };
}

describe('Téléphone Android : prise en main via RustDesk (serveur Tech Assist)', () => {
  beforeAll(async () => {
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
    process.env.AI_AGENT_ENABLED = 'true';
    process.env.RUSTDESK_ID_SERVER = 'id.test.local';
    process.env.RUSTDESK_PUBLIC_KEY = 'cle-publique-test';
  });
  afterEach(() => {
    delete process.env.AI_AGENT_ENABLED;
    delete process.env.RUSTDESK_ID_SERVER;
    delete process.env.RUSTDESK_PUBLIC_KEY;
  });
  afterAll(async () => {
    await pool.end();
  });

  it('le client reçoit les réglages du serveur, partage son ID, et seul le technicien assigné lit les identifiants', async () => {
    const auth = await registerAndroid();
    const { sessionId, tech } = await paidSession(auth, 'assistance_rapide', 'humain');

    const cfg = await request(app).get(`/api/app/sessions/${sessionId}/android-remote`).set(auth);
    expect(cfg.status).toBe(200);
    expect(cfg.body).toMatchObject({ idServer: 'id.test.local', key: 'cle-publique-test' });

    await request(app).post(`/api/app/sessions/${sessionId}/android-remote`).set(auth).send({ remotePeerId: 'abc', remotePassword: 'x' }).expect(400);
    await request(app).post(`/api/app/sessions/${sessionId}/android-remote`).set(auth).send({ remotePeerId: '123 456 789', remotePassword: 'mdp12345' }).expect(400);
    await request(app).post(`/api/app/sessions/${sessionId}/android-remote`).set(auth).send({ remotePeerId: '123456789', remotePassword: 'mdp12345' }).expect(201);

    await pool.query('UPDATE sessions SET technician_id = $2 WHERE id = $1', [sessionId, tech.id]);
    const creds = await request(app).get(`/api/technician/sessions/${sessionId}/remote-credentials`).set(tech.headers);
    expect(creds.status).toBe(200);
    expect(creds.body).toEqual({ remotePeerId: '123456789', remotePassword: 'mdp12345' });
    const audit = await pool.query("SELECT 1 FROM audit_logs WHERE session_id = $1 AND action = 'session.android_remote_shared'", [sessionId]);
    expect(audit.rowCount).toBe(1);
  });

  it("un autre client ne peut ni lire les réglages ni partager sur cette session", async () => {
    const owner = await registerAndroid();
    const { sessionId } = await paidSession(owner, 'assistance_rapide', 'humain');
    const other = await registerAndroid();
    await request(app).get(`/api/app/sessions/${sessionId}/android-remote`).set(other).expect(404);
    await request(app).post(`/api/app/sessions/${sessionId}/android-remote`).set(other).send({ remotePeerId: '123456789', remotePassword: 'mdp12345' }).expect(404);
  });

  it("offre IA seule (500 FCFA) : pas de prise en main par un technicien", async () => {
    const auth = await registerAndroid();
    const { sessionId } = await paidSession(auth, 'diagnostic_express', 'ia');
    await request(app).get(`/api/app/sessions/${sessionId}/android-remote`).set(auth).expect(402);
    await request(app).post(`/api/app/sessions/${sessionId}/android-remote`).set(auth).send({ remotePeerId: '123456789', remotePassword: 'mdp12345' }).expect(402);
  });
});
