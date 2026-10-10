import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const QUESTION = 'mon casque bluetooth zorglub ne capte plus ma voix';
const FICHE = {
  category: 'Son',
  title: 'Casque Bluetooth zorglub : le micro ne capte plus la voix',
  cause: 'Le casque est connecté en mode écouteurs seuls (sans micro).',
  solution: "1. Ouvrez Paramètres > Système > Son > Entrée.\n2. Choisissez le micro du casque.\n3. Si absent, retirez puis rajoutez le casque Bluetooth.",
  advanced: false,
};

describe('Boucle d’apprentissage : DeepSeek trouve, la mémoire retient, plus d’IA ensuite', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeAll(async () => {
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
    process.env.FREE_LAUNCH = 'true';
    process.env.AI_AGENT_ENABLED = 'true';
    process.env.DEEPSEEK_API_KEY = 'ds-test';
    fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { response_format?: unknown };
      // Appel de rédaction de fiche (mode JSON) ou réponse de chat (texte).
      return ok({ choices: [{ finish_reason: 'stop', message: { content: body.response_format ? JSON.stringify(FICHE) : "Choisissez le micro du casque dans Paramètres > Système > Son > Entrée." } }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const k of ['FREE_LAUNCH', 'AI_AGENT_ENABLED', 'DEEPSEEK_API_KEY']) delete process.env[k];
  });
  afterAll(async () => {
    await pool.end();
  });

  async function exe(n: number) {
    const res = await request(app).post('/api/app/anonymous').send({ installId: `install-loop-${n}-aaaaaaaaaaaaaaaa`, platform: 'windows', hardwareHash: String(n).repeat(40) });
    expect(res.status).toBe(201);
    const auth = { Authorization: `Bearer ${res.body.token as string}` };
    const start = await request(app).post('/api/app/assistance').set(auth).send({});
    expect(start.status).toBe(201);
    return { auth, sessionId: start.body.session.id as string };
  }
  const ask = (c: Awaited<ReturnType<typeof exe>>) => request(app).post(`/api/app/sessions/${c.sessionId}/chat`).set(c.auth).send({ message: QUESTION });
  const helped = (c: Awaited<ReturnType<typeof exe>>) => request(app).post(`/api/app/sessions/${c.sessionId}/chat/feedback`).set(c.auth).send({ helped: true });
  /** Fiches rédigées par l'IA (les retours bruts de clients « client:resolved » sont comptés à part). */
  async function fiches() {
    return (await pool.query(`SELECT title, status, source, cardinality(confirmed_by) AS n FROM learned_pannes WHERE source LIKE 'ai:%'`)).rows;
  }
  async function waitForFiche() {
    for (let i = 0; i < 50; i++) {
      if ((await fiches()).length > 0) return;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error('fiche jamais enregistrée');
  }

  it('1er client : DeepSeek répond et rédige une fiche ; 2 clients confirment ; le 4e est servi par la mémoire SANS appel d’IA', async () => {
    // 1. Cas inconnu : DeepSeek répond (appel DeepSeek, pas Gemini) et la fiche est rédigée en arrière-plan.
    const a = await exe(1);
    const first = await ask(a);
    expect(first.status).toBe(200);
    expect(first.body.answer).toContain('Paramètres > Système > Son');
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://api.deepseek.com/chat/completions');
    await waitForFiche();
    expect(await fiches()).toEqual([expect.objectContaining({ status: 'candidate', source: 'ai:deepseek', n: 0 })]);

    // 2. Deux autres clients reçoivent la réponse construite avec la fiche, et confirment « résolu » : elle devient de confiance.
    const b = await exe(2);
    await ask(b);
    expect((await helped(b)).body.promoted).toBe(0);
    expect(await fiches()).toEqual([expect.objectContaining({ status: 'candidate', n: 1 })]);
    await helped(b); // la même installation ne compte qu'une fois
    expect(await fiches()).toEqual([expect.objectContaining({ status: 'candidate', n: 1 })]);
    const c = await exe(3);
    await ask(c);
    expect((await helped(c)).body.promoted).toBe(1);
    expect(await fiches()).toEqual([expect.objectContaining({ status: 'trusted', n: 2 })]);

    // 3. Le 4e client : réponse de la mémoire, aucun appel d'IA.
    const callsBefore = fetchMock.mock.calls.length;
    const d = await exe(4);
    const served = await ask(d);
    expect(served.status).toBe(200);
    expect(served.body.answer).toContain('Choisissez le micro du casque');
    expect(served.body.answer).toContain('déjà réglé le même problème');
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('une fiche née du texte d’un client (« résolu ») n’est jamais promue automatiquement', async () => {
    const a = await exe(1);
    await ask(a);
    await waitForFiche();
    await pool.query(`UPDATE learned_pannes SET source = 'client:resolved'`);
    for (const n of [2, 3, 4]) {
      const c = await exe(n);
      await ask(c);
      await helped(c);
    }
    const rows = (await pool.query(`SELECT status, source FROM learned_pannes`)).rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === 'candidate')).toBe(true);
  });

  it('DeepSeek en panne : Gemini prend le relais pour le chat', async () => {
    process.env.GEMINI_API_KEY = 'gm-test';
    fetchMock.mockImplementation(async (url: unknown) =>
      String(url).includes('deepseek') ? new Response('{}', { status: 402 }) : ok({ candidates: [{ content: { parts: [{ text: 'Réponse de secours de Gemini.' }] } }] }),
    );
    const a = await exe(1);
    const res = await ask(a);
    expect(res.body.answer).toBe('Réponse de secours de Gemini.');
    delete process.env.GEMINI_API_KEY;
  });

  it('/api/ai/status : DeepSeek indiqué configuré, sans jamais exposer la clé', async () => {
    const res = await request(app).get('/api/ai/status');
    expect(res.status).toBe(200);
    expect(res.body.providers).toEqual([expect.objectContaining({ provider: 'deepseek', ok: true })]);
    expect(JSON.stringify(res.body)).not.toContain('ds-test');
  });
});
