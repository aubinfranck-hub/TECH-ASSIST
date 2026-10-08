import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();

describe('Site : parcours client complet (démarrer → discuter → demander un technicien)', () => {
  beforeAll(async () => {
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
    process.env.FREE_LAUNCH = 'true';
  });
  afterEach(() => {
    delete process.env.FREE_LAUNCH;
  });
  afterAll(async () => {
    await pool.end();
  });

  async function technicianAuth() {
    const hash = await bcrypt.hash('secret123', 4);
    await pool.query(`INSERT INTO technicians (full_name, phone, username, password_hash, role) VALUES ('Awa', '+2250100000009', 'awa-web', $1, 'technician')`, [hash]);
    const login = await request(app).post('/api/auth/technician/login').send({ username: 'awa-web', password: 'secret123' });
    return { Authorization: `Bearer ${login.body.token as string}` };
  }

  it('le client démarre depuis le site, écrit dans sa session, demande un technicien qui le voit dans sa file', async () => {
    const start = await request(app).post('/api/assistance/start').send({ clientPhone: '+2250700001234', clientName: 'Awa', problem: 'Mon PC est très lent', platform: 'web', requestedMode: 'humain' });
    expect(start.status).toBe(201);
    const { id, session_code: code } = start.body.session as { id: string; session_code: string };
    expect(code).toMatch(/^\d{9}$/);

    // Le client retrouve sa session par son code.
    expect((await request(app).get(`/api/sessions/${code}`)).body.session).toMatchObject({ session_code: code, mode: 'humain' });

    // Il écrit au technicien depuis le site (ce chemin était cassé : le code de session n'était jamais reconnu).
    const msg = await request(app).post(`/api/sessions/${id}/messages`).send({ sessionCode: code, message: 'Merci de m’aider vite' });
    expect(msg.status).toBeLessThan(300);
    const list = await request(app).get(`/api/sessions/${id}/messages`).query({ sessionCode: code });
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body.messages)).toContain('Mon PC est très lent');

    // Il demande un technicien : la demande apparaît dans la file.
    const esc = await request(app).post(`/api/sessions/${id}/escalate`).send({ sessionCode: code });
    expect(esc.status).toBe(200);
    const auth = await technicianAuth();
    const queue = await request(app).get('/api/technician/queue').set(auth);
    expect(queue.body.queue.map((q: { id: string }) => q.id)).toContain(id);

    // Sans le lancement gratuit, le site répond « paiement requis » (le formulaire l'explique au client).
    delete process.env.FREE_LAUNCH;
    expect((await request(app).post('/api/assistance/start').send({ clientPhone: '+2250700001235', platform: 'web' })).status).toBe(402);
    process.env.FREE_LAUNCH = 'true';

    // Un téléphone invalide est refusé proprement.
    expect((await request(app).post('/api/assistance/start').send({ clientPhone: 'abc', platform: 'web' })).status).toBe(400);
  });
});
