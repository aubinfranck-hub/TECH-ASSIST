import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { testOutbox } from '../utils/mailer.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();
let counter = 0;

async function registerWindows() {
  const email = `pcwin${++counter}@example.com`;
  testOutbox.length = 0;
  await request(app).post('/api/app/email-code').send({ email }).expect(200);
  const code = /: ([0-9]{6})/.exec(testOutbox[testOutbox.length - 1].text)![1];
  const res = await request(app)
    .post('/api/app/register')
    .send({ installId: `pcwin-${Date.now()}-${counter}-aaaaaaaaaaaa`, platform: 'windows', email, code, phone: '+2250700003333' });
  expect(res.status).toBe(201);
  return { Authorization: `Bearer ${res.body.token as string}` };
}

async function staff() {
  const passwordHash = await bcrypt.hash('secret123', 4);
  const { rows } = await pool.query(
    `INSERT INTO technicians (full_name, phone, username, password_hash, role)
     VALUES ('Agent PC', '+22500000077', 'agent_pcwin', $1, 'admin') ON CONFLICT (username) DO UPDATE SET role = 'admin' RETURNING id`,
    [passwordHash],
  );
  const login = await request(app).post('/api/auth/technician/login').send({ username: 'agent_pcwin', password: 'secret123' });
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

describe('PC Windows : l’agent partage l’écran avec le technicien (RustDesk)', () => {
  beforeAll(async () => {
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
    process.env.AI_AGENT_ENABLED = 'true';
  });
  afterEach(() => {
    delete process.env.AI_AGENT_ENABLED;
    delete process.env.RUSTDESK_ID_SERVER;
    delete process.env.RUSTDESK_RELAY_SERVER;
    delete process.env.RUSTDESK_PUBLIC_KEY;
  });
  afterAll(async () => {
    await pool.end();
  });

  it('sans serveur auto-hébergé : réseau public RustDesk, le cycle complet fonctionne', async () => {
    const auth = await registerWindows();
    const { sessionId, tech } = await paidSession(auth, 'assistance_rapide', 'humain');

    expect((await request(app).get(`/api/app/sessions/${sessionId}/remote-config`).set(auth)).body).toEqual({ custom: false });
    expect((await request(app).get('/api/technician/remote-config').set(tech.headers)).body).toEqual({ custom: false });

    await request(app).post(`/api/app/sessions/${sessionId}/remote`).set(auth).send({ remotePeerId: 'abc', remotePassword: 'x' }).expect(400);
    await request(app).post(`/api/app/sessions/${sessionId}/remote`).set(auth).send({ remotePeerId: '123456789', remotePassword: "x'; calc; '" }).expect(400);
    await request(app).post(`/api/app/sessions/${sessionId}/remote`).set(auth).send({ remotePeerId: '123456789', remotePassword: 'Abcd1234Ef' }).expect(201);

    // Un technicien simple, non assigné à la session, n'a pas les identifiants.
    const hash = await bcrypt.hash('secret123', 4);
    await pool.query(`INSERT INTO technicians (full_name, phone, username, password_hash, role) VALUES ('Autre', '+22500000066', 'autre_tech', $1, 'technician')`, [hash]);
    const other = await request(app).post('/api/auth/technician/login').send({ username: 'autre_tech', password: 'secret123' });
    await request(app).get(`/api/technician/sessions/${sessionId}/remote-credentials`).set({ Authorization: `Bearer ${other.body.token as string}` }).expect(403);
    await pool.query('UPDATE sessions SET technician_id = $2 WHERE id = $1', [sessionId, tech.id]);
    const creds = await request(app).get(`/api/technician/sessions/${sessionId}/remote-credentials`).set(tech.headers);
    expect(creds.status).toBe(200);
    expect(creds.body).toEqual({ remotePeerId: '123456789', remotePassword: 'Abcd1234Ef' });
    // Le mot de passe est chiffré au repos.
    const stored = await pool.query('SELECT remote_password_encrypted FROM sessions WHERE id = $1', [sessionId]);
    expect(String(stored.rows[0].remote_password_encrypted)).not.toContain('Abcd1234Ef');
    expect((await pool.query("SELECT 1 FROM audit_logs WHERE session_id = $1 AND action = 'session.agent_remote_shared'", [sessionId])).rowCount).toBe(1);
  });

  it('avec un serveur auto-hébergé : l’agent et le technicien reçoivent ses réglages', async () => {
    process.env.RUSTDESK_ID_SERVER = 'id.test.local';
    process.env.RUSTDESK_RELAY_SERVER = 'relay.test.local';
    process.env.RUSTDESK_PUBLIC_KEY = 'cle-publique-test-0123456789abcdef';
    const auth = await registerWindows();
    const { sessionId, tech } = await paidSession(auth, 'assistance_rapide', 'humain');
    const expected = { custom: true, idServer: 'id.test.local', relayServer: 'relay.test.local', key: 'cle-publique-test-0123456789abcdef' };
    expect((await request(app).get(`/api/app/sessions/${sessionId}/remote-config`).set(auth)).body).toEqual(expected);
    const techCfg = (await request(app).get('/api/technician/remote-config').set(tech.headers)).body;
    expect(techCfg).toMatchObject(expected);
    const decoded = JSON.parse(Buffer.from((techCfg.configString as string).split('').reverse().join(''), 'base64').toString('utf8'));
    expect(decoded).toEqual({ host: 'id.test.local', relay: 'relay.test.local', key: 'cle-publique-test-0123456789abcdef', api: '' });
  });

  it('le site (code de session) fonctionne aussi sans serveur auto-hébergé', async () => {
    const auth = await registerWindows();
    const { sessionId } = await paidSession(auth, 'assistance_rapide', 'humain');
    const { rows } = await pool.query('SELECT session_code FROM sessions WHERE id = $1', [sessionId]);
    const res = await request(app).get(`/api/sessions/${rows[0].session_code}/remote-bootstrap`);
    expect(res.status).toBe(200);
    expect(res.body.rustdesk).toBeNull();
    expect(res.body.windows.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('un autre client ne peut ni lire les réglages ni partager sur cette session', async () => {
    const owner = await registerWindows();
    const { sessionId } = await paidSession(owner, 'assistance_rapide', 'humain');
    const other = await registerWindows();
    await request(app).get(`/api/app/sessions/${sessionId}/remote-config`).set(other).expect(404);
    await request(app).post(`/api/app/sessions/${sessionId}/remote`).set(other).send({ remotePeerId: '123456789', remotePassword: 'Abcd1234Ef' }).expect(404);
  });

  it('offre IA seule (500 FCFA) : pas de prise en main par un technicien', async () => {
    const auth = await registerWindows();
    const { sessionId } = await paidSession(auth, 'diagnostic_express', 'ia');
    await request(app).get(`/api/app/sessions/${sessionId}/remote-config`).set(auth).expect(402);
    await request(app).post(`/api/app/sessions/${sessionId}/remote`).set(auth).send({ remotePeerId: '123456789', remotePassword: 'Abcd1234Ef' }).expect(402);
  });
});
