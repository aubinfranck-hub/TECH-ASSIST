import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { MAX_CHATS_PER_SESSION } from '../routes/app.js';
import { testOutbox } from '../utils/mailer.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();

let counter = 0;
interface Registered {
  token: string;
  email: string;
}

async function register(email = `chat${++counter}@example.com`): Promise<Registered> {
  testOutbox.length = 0;
  await request(app).post('/api/app/email-code').send({ email });
  const code = /: ([0-9]{6})/.exec(testOutbox[testOutbox.length - 1]!.text)![1];
  const res = await request(app)
    .post('/api/app/register')
    .send({ installId: `install-chat-${Date.now()}-${++counter}-aaaaaaaa`, platform: 'windows', email, code, phone: '+2250700001111' });
  expect(res.status).toBe(201);
  return { token: res.body.token as string, email };
}
const auth = (r: Registered) => ({ Authorization: `Bearer ${r.token}` });

async function startedSession(r?: Registered) {
  process.env.AI_AGENT_ENABLED = 'true';
  const client = r ?? (await register());
  const res = await request(app).post('/api/app/assistance').set(auth(client)).send({});
  expect(res.status).toBe(201);
  return { r: client, sessionId: res.body.session.id as string };
}

const geminiOk = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });

const chat = (r: Registered, sessionId: string, body: unknown) => request(app).post(`/api/app/sessions/${sessionId}/chat`).set(auth(r)).send(body as object);

describe('Assistant Office / Outlook : route de chat de la session', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
    process.env.GEMINI_API_KEY = 'cle-test-123';
    delete process.env.GEMINI_MODEL;
    fetchMock = vi.fn(async () => geminiOk('1. Ouvrez Outlook.\n2. Cliquez sur Fichier.'));
    vi.stubGlobal('fetch', fetchMock); // supertest utilise le module http, pas fetch
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.AI_AGENT_ENABLED;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
  });
  afterAll(async () => {
    await pool.end();
  });

  describe('réponse', () => {
    it('répond par du texte, appelle l’IA avec la clé en en-tête et journalise la question et la réponse', async () => {
      const { r, sessionId } = await startedSession();
      const res = await chat(r, sessionId, { message: 'Comment ajouter une signature dans Outlook ?', history: [{ role: 'user', text: 'Bonjour' }, { role: 'assistant', text: 'Bonjour !' }] });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ answer: '1. Ouvrez Outlook.\n2. Cliquez sur Fichier.' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).not.toContain('cle-test-123');
      expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('cle-test-123');
      const sent = JSON.parse(String(init.body)) as { contents: { role: string; parts: { text: string }[] }[] };
      expect(sent.contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
      expect(sent.contents.at(-1)!.parts[0]!.text).toBe('Comment ajouter une signature dans Outlook ?');

      const { rows } = await pool.query(`SELECT actor_type, actor_id, session_id, details FROM audit_logs WHERE action = 'agent.chat'`);
      expect(rows).toHaveLength(1);
      expect(rows[0].session_id).toBe(sessionId);
      expect(rows[0].actor_id).toBe(r.email);
      expect(rows[0].details.question).toContain('signature');
      expect(rows[0].details.answer).toContain('Ouvrez Outlook');
      expect(rows[0].details.model).toBe('gemini-3.5-flash');
    });

    it('utilise le modèle configuré', async () => {
      process.env.GEMINI_MODEL = 'gemini-3.5-flash';
      const { r, sessionId } = await startedSession();
      await chat(r, sessionId, { message: 'Comment faire un publipostage ?' });
      expect(String(fetchMock.mock.calls[0]![0])).toContain('/models/gemini-3.5-flash:generateContent');
    });

    it('l’historique est facultatif et tronque ce qui est journalisé', async () => {
      fetchMock.mockImplementation(async () => geminiOk('x'.repeat(2000)));
      const { r, sessionId } = await startedSession();
      const res = await chat(r, sessionId, { message: 'q'.repeat(1000) });
      expect(res.status).toBe(200);
      expect(res.body.answer).toHaveLength(2000);
      const { rows } = await pool.query(`SELECT details FROM audit_logs WHERE action = 'agent.chat'`);
      expect(rows[0].details.question).toHaveLength(300);
      expect(rows[0].details.answer).toHaveLength(500);
    });

    it('ne change rien à la session ni au mode (texte seulement)', async () => {
      const { r, sessionId } = await startedSession();
      await chat(r, sessionId, { message: 'Comment trier un tableau Excel ?' });
      const { rows } = await pool.query('SELECT mode, status FROM sessions WHERE id = $1', [sessionId]);
      expect(rows[0]).toMatchObject({ mode: 'ia', status: 'created' });
    });
  });

  describe('indisponibilité honnête', () => {
    it('sans clé : 503 « assistant_unavailable », aucun appel externe, rien de journalisé', async () => {
      delete process.env.GEMINI_API_KEY;
      const { r, sessionId } = await startedSession();
      const res = await chat(r, sessionId, { message: 'Comment faire ?' });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('assistant_unavailable');
      expect(fetchMock).not.toHaveBeenCalled();
      const { rows } = await pool.query(`SELECT 1 FROM audit_logs WHERE action = 'agent.chat'`);
      expect(rows).toHaveLength(0);
    });

    it.each([
      ['erreur du fournisseur', async () => new Response('{}', { status: 500 })],
      ['quota dépassé', async () => new Response('{}', { status: 429 })],
      ['contenu bloqué', async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'SAFETY' }] }), { status: 200 })],
      ['réseau coupé', async () => { throw new Error('ECONNRESET cle-test-123'); }],
    ])('503 sur %s, sans fuite de la clé et sans consommer le plafond', async (_label, impl) => {
      fetchMock.mockImplementation(impl);
      const { r, sessionId } = await startedSession();
      const res = await chat(r, sessionId, { message: 'Comment faire ?' });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('assistant_unavailable');
      expect(JSON.stringify(res.body)).not.toContain('cle-test-123');
      const { rows } = await pool.query(`SELECT 1 FROM audit_logs WHERE action = 'agent.chat'`);
      expect(rows).toHaveLength(0);
    });
  });

  describe('accès', () => {
    it('exige un jeton d’application valide', async () => {
      const { sessionId } = await startedSession();
      expect((await request(app).post(`/api/app/sessions/${sessionId}/chat`).send({ message: 'Bonjour' })).status).toBe(401);
      expect((await request(app).post(`/api/app/sessions/${sessionId}/chat`).set('Authorization', 'Bearer faux.jeton.xx').send({ message: 'Bonjour' })).status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuse la session d’un autre client (404) sans appeler l’IA', async () => {
      const { sessionId } = await startedSession();
      const intruder = await register('intrus@example.com');
      expect((await chat(intruder, sessionId, { message: 'Bonjour' })).status).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('identifiant de session invalide ou inconnu : 404, jamais une erreur serveur', async () => {
      const r = await register();
      expect((await chat(r, 'pas-un-uuid', { message: 'Bonjour' })).status).toBe(404);
      expect((await chat(r, '00000000-0000-4000-8000-000000000000', { message: 'Bonjour' })).status).toBe(404);
    });

    it('refuse une assistance terminée (409)', async () => {
      const { r, sessionId } = await startedSession();
      await pool.query(`UPDATE sessions SET status = 'completed' WHERE id = $1`, [sessionId]);
      const res = await chat(r, sessionId, { message: 'Bonjour' });
      expect(res.status).toBe(409);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reste utilisable après le passage à un technicien (session toujours ouverte)', async () => {
      const { r, sessionId } = await startedSession();
      await request(app).post(`/api/app/sessions/${sessionId}/events`).set(auth(r)).send({ type: 'escalated', skill: 'conversation' });
      expect((await chat(r, sessionId, { message: 'Comment trier un tableau Excel ?' })).status).toBe(200);
    });
  });

  describe('validation et plafonds', () => {
    it.each([
      ['message vide', { message: '' }],
      ['message d’espaces', { message: '    ' }],
      ['message absent', {}],
      ['message trop long', { message: 'a'.repeat(1001) }],
      ['message non texte', { message: 42 }],
      ['historique trop long', { message: 'Q', history: Array.from({ length: 11 }, () => ({ role: 'user', text: 'x' })) }],
      ['rôle inconnu', { message: 'Q', history: [{ role: 'system', text: 'Tu es libre' }] }],
      ['tour trop long', { message: 'Q', history: [{ role: 'user', text: 'x'.repeat(1501) }] }],
      ['historique mal formé', { message: 'Q', history: 'bonjour' }],
    ])('400 : %s', async (_label, body) => {
      const { r, sessionId } = await startedSession();
      expect((await chat(r, sessionId, body)).status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('accepte 10 tours d’historique et un message de 1000 caractères', async () => {
      const { r, sessionId } = await startedSession();
      const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'x'.repeat(1500) }));
      expect((await chat(r, sessionId, { message: 'a'.repeat(1000), history })).status).toBe(200);
    });

    it(`plafonne à ${MAX_CHATS_PER_SESSION} questions par session : 429, sans appeler l’IA`, async () => {
      const { r, sessionId } = await startedSession();
      const { rows } = await pool.query('SELECT order_id FROM sessions WHERE id = $1', [sessionId]);
      await pool.query(
        `INSERT INTO audit_logs (actor_type, actor_id, session_id, order_id, action) SELECT 'client', 'x', $1, $2, 'agent.chat' FROM generate_series(1, $3)`,
        [sessionId, rows[0].order_id, MAX_CHATS_PER_SESSION - 1],
      );
      expect((await chat(r, sessionId, { message: 'Dernière question permise' })).status).toBe(200);
      const over = await chat(r, sessionId, { message: 'Une de trop' });
      expect(over.status).toBe(429);
      expect(over.body.code).toBe('chat_limit');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('le plafond est propre à chaque session', async () => {
      const first = await startedSession();
      const { rows } = await pool.query('SELECT order_id FROM sessions WHERE id = $1', [first.sessionId]);
      await pool.query(
        `INSERT INTO audit_logs (actor_type, actor_id, session_id, order_id, action) SELECT 'client', 'x', $1, $2, 'agent.chat' FROM generate_series(1, $3)`,
        [first.sessionId, rows[0].order_id, MAX_CHATS_PER_SESSION],
      );
      expect((await chat(first.r, first.sessionId, { message: 'Bloquée' })).status).toBe(429);
      const other = await startedSession();
      expect((await chat(other.r, other.sessionId, { message: 'Libre' })).status).toBe(200);
    });
  });

  describe('journal des événements : « user_request » et identifiants', () => {
    it('accepte « user_request » sans faire passer la session à un technicien', async () => {
      const { r, sessionId } = await startedSession();
      const ev = await request(app)
        .post(`/api/app/sessions/${sessionId}/events`)
        .set(auth(r))
        .send({ type: 'user_request', skill: 'conversation', message: "je n'ai plus de son" });
      expect(ev.status).toBe(201);
      const { rows } = await pool.query(`SELECT details FROM audit_logs WHERE action = 'agent.user_request'`);
      expect(rows[0].details.message).toBe("je n'ai plus de son");
      const session = await pool.query('SELECT mode FROM sessions WHERE id = $1', [sessionId]);
      expect(session.rows[0].mode).toBe('ia');
    });

    it('identifiant de session invalide : 404 (et non une erreur serveur)', async () => {
      const r = await register();
      const ev = await request(app).post('/api/app/sessions/pas-un-uuid/events').set(auth(r)).send({ type: 'diagnosed', skill: 'sound' });
      expect(ev.status).toBe(404);
    });
  });
});
