import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();

async function technicianAuth() {
  const hash = await bcrypt.hash('secret123', 4);
  await pool.query(`INSERT INTO technicians (full_name, phone, username, password_hash, role) VALUES ('Awa', '+2250100000001', 'awa-pannes', $1, 'technician')`, [hash]);
  const login = await request(app).post('/api/auth/technician/login').send({ username: 'awa-pannes', password: 'secret123' });
  expect(login.status).toBe(200);
  return { Authorization: `Bearer ${login.body.token as string}` };
}

const fiche = {
  category: 'Imprimantes',
  title: 'Imprimante thermique Zebra : étiquettes vides',
  cause: 'Pilote ou service d’impression bloqué.',
  solution: '1. Relancer le service Spooler. 2. Réinstaller le pilote Zebra. 3. Nettoyer la tête d’impression.',
  advanced: false,
};
const deepseek = (body: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const QUERY = 'etiquettes zebra vides';

describe('Base de pannes : l’IA rédige une fiche quand la base ne sait pas, puis la mémorise', () => {
  let ai: ReturnType<typeof vi.fn>;
  beforeAll(async () => {
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
    process.env.LEARNING_PROVIDERS = 'deepseek';
    process.env.DEEPSEEK_API_KEY = 'cle-test';
    ai = vi.fn(async () => deepseek(fiche));
    vi.stubGlobal('fetch', ai);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const k of ['LEARNING_PROVIDERS', 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY']) delete process.env[k];
  });
  afterAll(async () => {
    await pool.end();
  });

  it('cycle complet : recherche vide → IA → fiche enregistrée → relue sans IA → confirmée', async () => {
    const auth = await technicianAuth();

    const first = await request(app).get('/api/technician/pannes').query({ q: QUERY }).set(auth);
    expect(first.status).toBe(200);
    expect(first.body.ai).toEqual({ status: 'generated' });
    expect(first.body.results.filter((r: { origin: string }) => r.origin === 'ia')).toHaveLength(1);
    expect(first.body.results[0]).toMatchObject({ title: fiche.title, origin: 'ia', status: 'candidate' });
    expect(ai).toHaveBeenCalledTimes(1);
    expect(String((ai.mock.calls[0] as [string, RequestInit])[1].body)).toContain('<recherche_du_technicien>');

    // Même recherche : la base répond seule.
    const second = await request(app).get('/api/technician/pannes').query({ q: QUERY }).set(auth);
    expect(second.body.results[0]).toMatchObject({ title: fiche.title, origin: 'ia' });
    expect(second.body.ai).toEqual({ status: 'none' });
    expect(ai).toHaveBeenCalledTimes(1);

    // Le technicien confirme.
    const id = first.body.results[0].id as string;
    const reviewed = await request(app).post(`/api/technician/pannes/${id}/review`).set(auth).send({ verdict: 'trusted' });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.panne.status).toBe('trusted');
    expect((await request(app).get('/api/technician/pannes').query({ q: QUERY }).set(auth)).body.results[0].status).toBe('trusted');
  });

  it('une fiche écartée n’est plus servie', async () => {
    const auth = await technicianAuth();
    const first = await request(app).get('/api/technician/pannes').query({ q: QUERY }).set(auth);
    await request(app).post(`/api/technician/pannes/${first.body.results[0].id}/review`).set(auth).send({ verdict: 'retired' });
    ai.mockImplementation(async () => deepseek({ unknown: true, reason: 'Cas trop vague pour une fiche fiable.' }));
    const again = await request(app).get('/api/technician/pannes').query({ q: QUERY }).set(auth);
    expect(again.body.results.some((r: { origin: string }) => r.origin === 'ia')).toBe(false);
    expect(again.body.ai.status).toBe('unknown');
  });

  it('les fiches de départ répondent sans appeler l’IA', async () => {
    const auth = await technicianAuth();
    const res = await request(app).get('/api/technician/pannes').query({ q: 'outlook bloque sur traitement en cours' }).set(auth);
    expect(res.body.results.length).toBeGreaterThan(0);
    expect(res.body.results[0].origin).toBe('base');
    expect(ai).not.toHaveBeenCalled();
  });

  it('sans clé d’IA, le dit clairement au lieu de « aucune fiche »', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const auth = await technicianAuth();
    const res = await request(app).get('/api/technician/pannes').query({ q: QUERY }).set(auth);
    expect(res.body.results.every((r: { origin: string }) => r.origin === 'base')).toBe(true);
    expect(res.body.ai.status).toBe('not_configured');
    expect(res.body.ai.reason).toMatch(/DEEPSEEK_API_KEY/);
  });

  it('IA en panne : réponse propre, rien d’enregistré', async () => {
    ai.mockImplementation(async () => new Response('{}', { status: 500 }));
    const auth = await technicianAuth();
    const res = await request(app).get('/api/technician/pannes').query({ q: QUERY }).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.ai.status).toBe('unavailable');
    expect((await pool.query('SELECT count(*)::int AS n FROM learned_pannes')).rows[0].n).toBe(0);
  });

  it('refuse un visiteur non connecté', async () => {
    expect((await request(app).get('/api/technician/pannes').query({ q: QUERY })).status).toBe(401);
  });
});
