import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { applyMigrations, codeOf, truncateAll } from './testDb.js';

const app = createApp();

describe('sécurité : le client seul pilote sa session', () => {
  beforeAll(applyMigrations);
  beforeEach(truncateAll);
  afterAll(() => pool.end());

  async function staff(role: 'admin' | 'technician', name: string) {
    await pool.query(`INSERT INTO technicians (full_name, phone, username, password_hash, role) VALUES ($1, $2, $3, $4, $5)`, [name, `+2250${Math.floor(Math.random() * 1e8)}`, name, await bcrypt.hash('secret123', 4), role]);
    return (await request(app).post('/api/auth/technician/login').send({ username: name, password: 'secret123' })).body.token as string;
  }

  async function waitingSession() {
    const order = await pool.query(`INSERT INTO orders (plan_id, client_phone, amount_fcfa, status) VALUES ('assistance_rapide', '+2250700000099', 2000, 'paid') RETURNING id`);
    const s = await request(app).post(`/api/orders/${order.rows[0].id}/session`).send({ platform: 'windows' });
    return s.body.session as { id: string; session_code: string };
  }

  it('refuse consentement, arrêt et passage de main sans le code de session', async () => {
    const s = await waitingSession();
    const bad = '000000000';
    expect((await request(app).post(`/api/sessions/${s.id}/consent`).send({ stage: 'control' })).status).toBe(400);
    expect((await request(app).post(`/api/sessions/${s.id}/consent`).send({ stage: 'control', sessionCode: bad })).status).toBe(403);
    expect((await request(app).post(`/api/sessions/${s.id}/stop`).send({ stoppedBy: 'client', sessionCode: bad })).status).toBe(403);
    expect((await request(app).post(`/api/sessions/${s.id}/escalate`).send({ sessionCode: bad })).status).toBe(403);
    expect((await request(app).post(`/api/sessions/${s.id}/stop`).send({ stoppedBy: 'technician', sessionCode: s.session_code })).status).toBe(400);
    expect((await request(app).post(`/api/sessions/${s.id}/consent`).send({ stage: 'screen', sessionCode: await codeOf(s.id) })).status).toBe(200);
  });

  it('la file technicien ne montre jamais le code complet, et seul le technicien assigné peut terminer', async () => {
    const s = await waitingSession();
    await request(app).post(`/api/sessions/${s.id}/escalate`).send({ sessionCode: s.session_code });
    const a = await staff('technician', 'tec_a');
    const b = await staff('technician', 'tec_b');
    const queue = (await request(app).get('/api/technician/queue').set('Authorization', `Bearer ${a}`)).body.queue;
    expect(queue[0].session_code).toHaveLength(4);
    // Demande libre : personne ne peut la clore sans l'avoir prise en charge.
    expect((await request(app).post(`/api/technician/sessions/${s.id}/finish`).set('Authorization', `Bearer ${a}`)).status).toBe(403);
    await request(app).patch(`/api/technician/sessions/${s.id}/claim`).set('Authorization', `Bearer ${a}`);
    expect((await request(app).post(`/api/technician/sessions/${s.id}/finish`).set('Authorization', `Bearer ${b}`)).status).toBe(403);
    expect((await request(app).post(`/api/technician/sessions/${s.id}/finish`).set('Authorization', `Bearer ${a}`)).status).toBe(200);
  });
});
