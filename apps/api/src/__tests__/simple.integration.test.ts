import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();
const FICHE = { category: 'Imprimantes', title: 'Imprimante réseau hors ligne après coupure', cause: 'Adresse IP changée.', solution: '1. Redémarrer la box. 2. Réinstaller l’imprimante avec sa nouvelle adresse IP.', advanced: false };
const gemini = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('Parcours simple comme AnyDesk : numéro d’aide, sans inscription', () => {
  beforeAll(async () => {
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
    process.env.FREE_LAUNCH = 'true';
    process.env.AI_AGENT_ENABLED = 'true';
    process.env.GEMINI_API_KEY = 'cle-test';
    process.env.LEARNING_PROVIDERS = 'gemini';
    // Le même « Gemini » répond au chat (texte) et à la composition d'une fiche (JSON demandé).
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => (init.body.includes('responseMimeType') ? gemini(JSON.stringify(FICHE)) : gemini('Redémarrez la box, puis réinstallez l’imprimante avec sa nouvelle adresse.'))));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const k of ['FREE_LAUNCH', 'AI_AGENT_ENABLED', 'GEMINI_API_KEY', 'LEARNING_PROVIDERS']) delete process.env[k];
  });
  afterAll(async () => {
    await pool.end();
  });

  async function exe(installId = `install-anon-${Date.now()}-${Math.random().toString(36).slice(2)}-aaaa`) {
    const res = await request(app).post('/api/app/anonymous').send({ installId, platform: 'windows', hardwareHash: 'h'.repeat(40) });
    expect(res.status).toBe(201);
    const auth = { Authorization: `Bearer ${res.body.token as string}` };
    const start = await request(app).post('/api/app/assistance').set(auth).send({});
    expect(start.status).toBe(201);
    return { auth, installId, sessionId: start.body.session.id as string, code: start.body.session.session_code as string };
  }
  async function tech() {
    const hash = await bcrypt.hash('secret123', 4);
    await pool.query(`INSERT INTO technicians (full_name, phone, username, password_hash, role) VALUES ('Awa Koné', '+2250100000088', 'awa-simple', $1, 'technician')`, [hash]);
    const login = await request(app).post('/api/auth/technician/login').send({ username: 'awa-simple', password: 'secret123' });
    return { Authorization: `Bearer ${login.body.token as string}` };
  }

  it('l’exe démarre sans e-mail ni téléphone et reçoit un numéro d’aide à 9 chiffres', async () => {
    const c = await exe();
    expect(c.code).toMatch(/^\d{9}$/);
    const install = await pool.query(`SELECT client_email, client_phone FROM app_installs`);
    expect(install.rows[0].client_email).toMatch(/@anonyme\.techassist\.invalid$/);
    expect(install.rows[0].client_phone).toBe('');
  });

  it('une installation déjà inscrite avec un vrai e-mail ne peut pas être reprise en anonyme', async () => {
    const installId = 'install-reelle-aaaaaaaaaaaaaaaa';
    await pool.query(`INSERT INTO app_installs (install_id, platform, client_email, client_phone) VALUES ($1, 'windows', 'vrai@example.com', '')`, [installId]);
    const res = await request(app).post('/api/app/anonymous').send({ installId, platform: 'windows' });
    expect(res.status).toBe(409);
  });

  it('le technicien tape le numéro : la demande passe en « technicien » ; faux numéro refusé', async () => {
    const c = await exe();
    const t = await tech();
    expect((await request(app).post('/api/technician/sessions/by-code').set(t).send({ code: '000000000' })).status).toBe(404);
    expect((await request(app).post('/api/technician/sessions/by-code').set(t).send({ code: 'abc' })).status).toBe(400);
    expect((await request(app).post('/api/technician/sessions/by-code')).status).toBe(401);
    const found = await request(app).post('/api/technician/sessions/by-code').set(t).send({ code: c.code });
    expect(found.status).toBe(200);
    expect(found.body.id).toBe(c.sessionId);
    expect((await request(app).get('/api/technician/queue').set(t)).body.queue.map((q: { id: string }) => q.id)).toContain(c.sessionId);

    // Le technicien prend en charge : l'exe du client le voit (c'est ce qui déclenche sa demande d'autorisation).
    expect((await request(app).patch(`/api/technician/sessions/${c.sessionId}/claim`).set(t)).status).toBe(200);
    const poll = await request(app).get(`/api/app/sessions/${c.sessionId}/messages`).set(c.auth);
    expect(poll.body.state).toMatchObject({ claimed: true, technician: 'Awa' });
  });

  it('les coordonnées ne sont demandées qu’au moment d’appeler un technicien ; le technicien les voit', async () => {
    const c = await exe();
    const t = await tech();
    expect((await request(app).post('/api/app/contact').send({ email: 'a@example.com' })).status).toBe(401);
    expect((await request(app).post('/api/app/contact').set(c.auth).send({ email: 'pas-un-email' })).status).toBe(400);
    expect((await request(app).post('/api/app/contact').set(c.auth).send({ email: 'Awa.Kone@Example.com', phone: '+2250700112233', name: 'Awa' })).status).toBe(200);
    await request(app).post('/api/technician/sessions/by-code').set(t).send({ code: c.code });
    const detail = await request(app).get(`/api/technician/sessions/${c.sessionId}`).set(t);
    expect(JSON.stringify(detail.body)).toContain('+2250700112233');
  });

  it('le lexique se met à jour : l’IA répond ET enregistre une fiche « à vérifier » quand il ne savait rien', async () => {
    const c = await exe();
    const chat = await request(app).post(`/api/app/sessions/${c.sessionId}/chat`).set(c.auth).send({ message: 'Mon thermostat connecté Zorglub refuse tout appairage violet', history: [] });
    expect(chat.status).toBe(200);
    expect(chat.body.answer).toContain('Redémarrez la box');
    // Enrichissement en arrière-plan.
    let rows: { title: string; status: string; source: string; created_by: string | null }[] = [];
    for (let i = 0; i < 30 && rows.length === 0; i++) {
      rows = (await pool.query(`SELECT title, status, source, created_by FROM learned_pannes`)).rows;
      if (rows.length === 0) await new Promise((r) => setTimeout(r, 100));
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: FICHE.title, status: 'candidate', source: 'ai:gemini', created_by: null });
  });

  it('« Cette réponse vous aide ? » oui : la solution entre au lexique ; non : rien n’est retenu', async () => {
    const c = await exe();
    await request(app).post(`/api/app/sessions/${c.sessionId}/chat`).set(c.auth).send({ message: 'Ma clé USB bleue ne marche plus', history: [] });
    expect((await request(app).post(`/api/app/sessions/${c.sessionId}/chat/feedback`).set(c.auth).send({ helped: false })).body).toEqual({ remembered: false });
    const yes = await request(app).post(`/api/app/sessions/${c.sessionId}/chat/feedback`).set(c.auth).send({ helped: true });
    expect(yes.body).toMatchObject({ remembered: true });
    const row = await pool.query(`SELECT status, source, title FROM learned_pannes WHERE source = 'client:resolved'`);
    expect(row.rows[0]).toMatchObject({ status: 'candidate' });
    expect(row.rows[0].title).toContain('clé USB bleue');
    // Une autre installation ne peut pas agir sur cette session.
    const other = await exe();
    expect((await request(app).post(`/api/app/sessions/${c.sessionId}/chat/feedback`).set(other.auth).send({ helped: true })).status).toBe(404);
  });
});
