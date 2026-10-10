import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();
// Plus petit PNG valide (1 pixel) : la signature est contrôlée côté serveur.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const gemini = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('Site : chat IA avec capture d’écran', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeAll(async () => {
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
    process.env.FREE_LAUNCH = 'true';
    process.env.AI_AGENT_ENABLED = 'true';
    process.env.GEMINI_API_KEY = 'cle-gemini-test';
    fetchMock = vi.fn(async () => gemini('Je vois une fenêtre Outlook. Cliquez sur Fichier.'));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FREE_LAUNCH;
    delete process.env.AI_AGENT_ENABLED;
    delete process.env.GEMINI_API_KEY;
  });
  afterAll(async () => {
    await pool.end();
  });

  it('l’image part à l’IA, n’est jamais conservée, et une fausse image est refusée', async () => {
    const start = await request(app).post('/api/assistance/start').send({ clientPhone: '+2250700005555', problem: 'Outlook plante', platform: 'web', requestedMode: 'ia' });
    expect(start.body.session.mode).toBe('ia');
    const { id, session_code: code } = start.body.session as { id: string; session_code: string };

    const res = await request(app).post(`/api/sessions/${id}/chat`).send({ sessionCode: code, message: 'Voici mon écran', image: { mime: 'image/png', data: PNG } });
    expect(res.status).toBe(200);
    expect(res.body.answer).toContain('Outlook');
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(JSON.stringify(sent)).toContain(PNG.slice(0, 40));
    // Aucune trace de l'image en base ou dans le journal.
    const stored = await pool.query(`SELECT body FROM session_messages WHERE session_id = $1`, [id]);
    expect(JSON.stringify(stored.rows)).not.toContain(PNG.slice(0, 40));
    const audit = await pool.query(`SELECT details FROM audit_logs WHERE session_id = $1 AND action = 'agent.chat'`, [id]);
    expect(audit.rows[0].details).toMatchObject({ image: true });
    expect(JSON.stringify(audit.rows)).not.toContain(PNG.slice(0, 40));

    const bad = await request(app).post(`/api/sessions/${id}/chat`).send({ sessionCode: code, message: 'Encore', image: { mime: 'image/png', data: Buffer.from('pas une image').toString('base64') } });
    expect(bad.status).toBe(400);
  });
});
