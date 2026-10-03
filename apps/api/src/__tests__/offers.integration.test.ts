import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { testOutbox } from '../utils/mailer.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();
let counter = 0;

interface Registered {
  token: string;
}
const auth = (r: Registered) => ({ Authorization: `Bearer ${r.token}` });

async function register(): Promise<Registered> {
  const email = `offre${++counter}@example.com`;
  testOutbox.length = 0;
  await request(app).post('/api/app/email-code').send({ email }).expect(200);
  const code = /: ([0-9]{6})/.exec(testOutbox[testOutbox.length - 1].text)![1];
  const res = await request(app)
    .post('/api/app/register')
    .send({ installId: `offer-${Date.now()}-${counter}-aaaaaaaaaaaa`, platform: 'windows', email, code, phone: '+2250700002222' });
  expect(res.status).toBe(201);
  return { token: res.body.token as string };
}

async function staffToken(): Promise<string> {
  const passwordHash = await bcrypt.hash('secret123', 4);
  await pool.query(
    `INSERT INTO technicians (full_name, phone, username, password_hash, role)
     VALUES ('Agent Offres', '+22500000077', 'agent_offres', $1, 'admin') ON CONFLICT (username) DO NOTHING`,
    [passwordHash],
  );
  const login = await request(app).post('/api/auth/technician/login').send({ username: 'agent_offres', password: 'secret123' });
  return login.body.token as string;
}

/** Commande payée (confirmée par le personnel) d'un forfait à l'usage : renvoie l'identifiant de commande. */
async function paidOrder(r: Registered, planId: 'diagnostic_express' | 'assistance_rapide'): Promise<string> {
  const staff = await staffToken();
  const order = await request(app).post('/api/app/orders').set(auth(r)).send({ planId });
  expect(order.status).toBe(201);
  await request(app).post(`/api/orders/${order.body.order.id}/confirm-payment`).set('Authorization', `Bearer ${staff}`).expect(200);
  return order.body.order.id as string;
}

describe('Offres : droits selon ce qui est payé (IA seule, IA + technicien), minutes du forfait', () => {
  beforeAll(async () => {
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterEach(() => {
    delete process.env.AI_AGENT_ENABLED;
    delete process.env.FREE_LAUNCH;
  });
  afterAll(async () => {
    await pool.end();
  });

  it('500 FCFA : l\'agent IA démarre, l\'horloge du forfait court, aucun technicien dans la file', async () => {
    process.env.AI_AGENT_ENABLED = 'true';
    const r = await register();
    const orderId = await paidOrder(r, 'diagnostic_express');
    const started = await request(app).post('/api/app/assistance').set(auth(r)).send({ orderId, mode: 'ia' });
    expect(started.status).toBe(201);
    expect(started.body.session.mode).toBe('ia');
    const row = (await pool.query('SELECT started_at, ends_at, duration_minutes FROM sessions WHERE id = $1', [started.body.session.id])).rows[0];
    expect(row.started_at).not.toBeNull();
    expect(new Date(row.ends_at).getTime() - new Date(row.started_at).getTime()).toBe(row.duration_minutes * 60_000);

    const staff = await staffToken();
    const queue = await request(app).get('/api/technician/queue').set('Authorization', `Bearer ${staff}`);
    expect(queue.body.queue).toHaveLength(0);
  });

  it('500 FCFA : demander un technicien est refusé avec le complément à payer, et le forfait n\'est pas consommé', async () => {
    process.env.AI_AGENT_ENABLED = 'true';
    const r = await register();
    const orderId = await paidOrder(r, 'diagnostic_express');
    const refused = await request(app).post('/api/app/assistance').set(auth(r)).send({ orderId, mode: 'humain' });
    expect(refused.status).toBe(402);
    expect(refused.body.code).toBe('human_not_included');
    expect(refused.body.upgrade.priceFcfa).toBe(1500);
    expect((await pool.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n).toBe(0);

    const retry = await request(app).post('/api/app/assistance').set(auth(r)).send({ orderId, mode: 'ia' });
    expect(retry.status).toBe(201);
  });

  it('500 FCFA : si l\'agent IA est indisponible, personne ne bascule en douce sur un technicien', async () => {
    const r = await register();
    process.env.AI_AGENT_ENABLED = 'true';
    const orderId = await paidOrder(r, 'diagnostic_express');
    delete process.env.AI_AGENT_ENABLED; // l'agent tombe après le paiement
    const unavailable = await request(app).post('/api/app/assistance').set(auth(r)).send({ orderId, mode: 'ia' });
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.code).toBe('ai_unavailable');
    const staff = await staffToken();
    expect((await request(app).get('/api/technician/queue').set('Authorization', `Bearer ${staff}`)).body.queue).toHaveLength(0);
    // Le forfait reste utilisable quand l'agent revient.
    process.env.AI_AGENT_ENABLED = 'true';
    expect((await request(app).post('/api/app/assistance').set(auth(r)).send({ orderId, mode: 'ia' })).status).toBe(201);
  });

  it('2 000 FCFA : le technicien est dans la file, garde au moins 10 minutes, et le forfait se termine à son heure', async () => {
    const r = await register();
    const orderId = await paidOrder(r, 'assistance_rapide');
    const started = await request(app).post('/api/app/assistance').set(auth(r)).send({ orderId, mode: 'humain' });
    expect(started.status).toBe(201);
    expect(started.body.humanIncluded).toBe(true);
    const sessionId = started.body.session.id as string;
    const code = started.body.session.session_code as string;

    const staff = await staffToken();
    const queue = await request(app).get('/api/technician/queue').set('Authorization', `Bearer ${staff}`);
    expect(queue.body.queue.map((q: { id: string }) => q.id)).toContain(sessionId);

    const claim = await request(app).patch(`/api/technician/sessions/${sessionId}/claim`).set('Authorization', `Bearer ${staff}`);
    expect(claim.status).toBe(200);
    const minutes = (new Date(claim.body.session.ends_at).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(59);

    // Les minutes sont écoulées : la session est terminée côté serveur, au premier regard du client.
    await pool.query(`UPDATE sessions SET ends_at = now() - interval '1 minute' WHERE id = $1`, [sessionId]);
    const after = await request(app).get(`/api/sessions/${code}`);
    expect(after.body.session.status).toBe('completed');
    const row = (await pool.query('SELECT stopped_by, remote_password_encrypted FROM sessions WHERE id = $1', [sessionId])).rows[0];
    expect(row.stopped_by).toBe('timeout');
    expect(row.remote_password_encrypted).toBeNull();
  });

  it('un technicien ne peut pas prendre une session dont le forfait n\'inclut pas de technicien', async () => {
    process.env.AI_AGENT_ENABLED = 'true';
    const r = await register();
    const orderId = await paidOrder(r, 'diagnostic_express');
    const started = await request(app).post('/api/app/assistance').set(auth(r)).send({ orderId, mode: 'ia' });
    const sessionId = started.body.session.id as string;
    // Même si la session est forcée en file « humain » (cas anormal), la prise en charge reste refusée.
    await pool.query(`UPDATE sessions SET mode = 'humain' WHERE id = $1`, [sessionId]);
    const staff = await staffToken();
    const claim = await request(app).patch(`/api/technician/sessions/${sessionId}/claim`).set('Authorization', `Bearer ${staff}`);
    expect(claim.status).toBe(409);
    expect((await request(app).get('/api/technician/queue').set('Authorization', `Bearer ${staff}`)).body.queue).toHaveLength(0);
  });

  it('lancement gratuit : un technicien reste disponible pour tous et aucune limite de durée n\'est appliquée', async () => {
    process.env.FREE_LAUNCH = 'true';
    const r = await register();
    const orderId = await paidOrder(r, 'diagnostic_express');
    const started = await request(app).post('/api/app/assistance').set(auth(r)).send({ orderId, mode: 'humain' });
    expect(started.status).toBe(201);
    expect(started.body.humanIncluded).toBe(true);
    const sessionId = started.body.session.id as string;
    const staff = await staffToken();
    expect((await request(app).get('/api/technician/queue').set('Authorization', `Bearer ${staff}`)).body.queue.map((q: { id: string }) => q.id)).toContain(sessionId);
    await request(app).patch(`/api/technician/sessions/${sessionId}/claim`).set('Authorization', `Bearer ${staff}`).expect(200);
    await pool.query(`UPDATE sessions SET ends_at = now() - interval '5 minutes' WHERE id = $1`, [sessionId]);
    const after = await request(app).get(`/api/sessions/${started.body.session.session_code}`);
    expect(after.body.session.status).toBe('active');
  });
});
