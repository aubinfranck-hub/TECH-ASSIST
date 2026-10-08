import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { lexiqueContext } from '../assistant/lexique.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();
const gemini = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('Lexique unifié : un seul endroit pour tout ce que Tech Assist sait', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeAll(async () => {
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
    process.env.FREE_LAUNCH = 'true';
    process.env.AI_AGENT_ENABLED = 'true';
    process.env.GEMINI_API_KEY = 'cle-test';
    fetchMock = vi.fn(async () => gemini('Débranchez la clé USB, attendez dix secondes, rebranchez-la sur un autre port, puis redémarrez le poste.'));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const k of ['FREE_LAUNCH', 'AI_AGENT_ENABLED', 'GEMINI_API_KEY']) delete process.env[k];
  });
  afterAll(async () => {
    await pool.end();
  });

  async function tech() {
    const hash = await bcrypt.hash('secret123', 4);
    await pool.query(`INSERT INTO technicians (full_name, phone, username, password_hash, role) VALUES ('Awa', '+2250100000077', 'awa-lex', $1, 'technician')`, [hash]);
    const login = await request(app).post('/api/auth/technician/login').send({ username: 'awa-lex', password: 'secret123' });
    return { Authorization: `Bearer ${login.body.token as string}` };
  }

  it('« résolu » dans le chat client : la solution entre au lexique (à relire), visible du technicien, pas redonnée aux autres clients avant relecture', async () => {
    const start = await request(app).post('/api/assistance/start').send({ clientPhone: '+2250700006666', problem: 'Ma clé USB bleue ne marche plus', platform: 'web', requestedMode: 'ia' });
    const { id, session_code: code } = start.body.session as { id: string; session_code: string };
    const chat = await request(app).post(`/api/sessions/${id}/chat`).send({ sessionCode: code, message: 'Ma clé USB bleue ne marche plus', initial: true });
    expect(chat.status).toBe(200);

    const done = await request(app).post(`/api/sessions/${id}/ai-feedback`).send({ sessionCode: code, result: 'resolved' });
    expect(done.body.status).toBe('resolved');
    const rows = await pool.query(`SELECT title, status, source FROM learned_pannes`);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ status: 'candidate', source: 'client:resolved' });

    // Le technicien la retrouve dans le lexique, étiquetée « retour client ».
    const auth = await tech();
    const found = await request(app).get('/api/technician/pannes').query({ q: 'clé USB bleue ne marche plus' }).set(auth);
    expect(found.body.results[0]).toMatchObject({ origin: 'client', status: 'candidate' });

    // Non relue : jamais redonnée à un autre client.
    expect(await lexiqueContext('clé USB bleue ne marche plus')).toBe('');
    // Relue et confirmée : elle sert de contexte à l'IA.
    const review = await request(app).post(`/api/technician/pannes/${found.body.results[0].id}/review`).set(auth).send({ verdict: 'trusted' });
    expect(review.status).toBe(200);
    expect(await lexiqueContext('clé USB bleue ne marche plus')).toContain('Fiche du lexique');
  });

  it('une procédure apprise apparaît aussi dans le lexique du technicien', async () => {
    await pool.query(
      `INSERT INTO learned_procedures (title, tokens, procedure, proc_hash, catalog_version, status, source)
       VALUES ('Étiquettes Zebra vides', ARRAY['etiqu','zebra','vides'], $1::jsonb, 'h1', 1, 'trusted', 'ai:test')`,
      [JSON.stringify({ schemaVersion: 1, title: 'Étiquettes Zebra vides', summary: "Le service d'impression est arrêté.", keywords: ['zebra', 'etiquette', 'imprimante'], verifyQuestion: 'Les étiquettes sortent-elles ?', checks: [], fixes: [{ id: 'f1', tool: 'service_start', args: { name: 'Spooler' }, why: "Relancer le service d'impression." }], advice: ['Vérifiez le rouleau.'] })],
    );
    const auth = await tech();
    const res = await request(app).get('/api/technician/pannes').query({ q: 'etiquettes zebra vides' }).set(auth);
    const proc = res.body.results.find((r: { origin: string }) => r.origin === 'procedure');
    expect(proc).toMatchObject({ title: 'Étiquettes Zebra vides', status: 'trusted' });
    expect(proc.solution).toContain("Relancer le service d'impression.");
    expect(res.body.ai.status).toBe('none'); // le lexique sait : l'IA n'est pas appelée
  });
});
