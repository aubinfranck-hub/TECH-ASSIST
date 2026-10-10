import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { testOutbox } from '../utils/mailer.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();
let counter = 0;

interface Client {
  token: string;
  email: string;
  sessionId: string;
}

/** Un client inscrit, avec son assistance offerte démarrée. */
async function newClient(): Promise<Client> {
  const email = `appr${++counter}@example.com`;
  testOutbox.length = 0;
  await request(app).post('/api/app/email-code').send({ email });
  const code = /: ([0-9]{6})/.exec(testOutbox[testOutbox.length - 1]!.text)![1];
  const reg = await request(app)
    .post('/api/app/register')
    .send({ installId: `install-appr-${Date.now()}-${++counter}-aaaaaaaa`, platform: 'windows', email, code, phone: '+2250700002222' });
  expect(reg.status).toBe(201);
  const token = reg.body.token as string;
  const started = await request(app).post('/api/app/assistance').set('Authorization', `Bearer ${token}`).send({});
  expect(started.status).toBe(201);
  return { token, email, sessionId: started.body.session.id as string };
}
const auth = (c: Client) => ({ Authorization: `Bearer ${c.token}` });

const solve = (c: Client, query: string, extra: Record<string, unknown> = {}) =>
  request(app).post(`/api/app/sessions/${c.sessionId}/knowledge/solve`).set(auth(c)).send({ query, windowsBuild: '10.0.22631', catalogVersion: 1, ...extra });
const outcome = (c: Client, procedureId: string, result: string, sessionId = c.sessionId) =>
  request(app).post(`/api/app/sessions/${sessionId}/knowledge/${procedureId}/outcome`).set(auth(c)).send({ result });

const procedure = (patch: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  title: 'Étiquettes Zebra vides',
  summary: "Le service d'impression est arrêté, les étiquettes sortent vides.",
  keywords: ['zebra', 'etiquette', 'imprimante'],
  verifyQuestion: 'Les étiquettes sortent-elles correctement ?',
  checks: [{ id: 'c1', tool: 'service_status', args: { name: 'Spooler' }, expect: { fact: 'status', op: 'eq', value: 'running' }, problem: "Le service d'impression est arrêté." }],
  fixes: [{ id: 'f1', tool: 'service_start', args: { name: 'Spooler' }, why: 'Il faut que ce service tourne pour imprimer.' }],
  advice: [],
  ...patch,
});

const deepseek = (body: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });

const CASE = "mon étiqueteuse zebra imprime des étiquettes vides";

describe('Mémoire de procédures : le serveur apprend, puis n’appelle plus l’IA', () => {
  let ai: ReturnType<typeof vi.fn>;
  let next: () => unknown;

  beforeAll(async () => {
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
    process.env.AI_AGENT_ENABLED = 'true';
    process.env.LEARNING_PROVIDERS = 'deepseek';
    process.env.DEEPSEEK_API_KEY = 'cle-deepseek-test';
    next = () => procedure();
    ai = vi.fn(async () => deepseek(next()));
    vi.stubGlobal('fetch', ai); // supertest utilise le module http, pas fetch
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const k of ['AI_AGENT_ENABLED', 'LEARNING_PROVIDERS', 'DEEPSEEK_API_KEY', 'LEARNING_MAX_AI_PER_SESSION', 'LEARNING_PROMOTE_AFTER']) delete process.env[k];
  });
  afterAll(async () => {
    await pool.end();
  });

  it('cycle complet : l’IA compose, deux postes confirment, le troisième est servi SANS appel d’IA', async () => {
    const [a, b, c] = [await newClient(), await newClient(), await newClient()];

    // 1. Cas inconnu : l'IA est appelée une fois, la procédure est mémorisée comme « candidate ».
    const first = await solve(a, CASE);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'generated', trust: 'candidate' });
    expect(first.body.procedure.fixes[0]).toMatchObject({ tool: 'service_start', args: { name: 'Spooler' } });
    expect(ai).toHaveBeenCalledTimes(1);
    expect(String((ai.mock.calls[0] as [string, RequestInit])[1].body)).toContain('<demande_du_client>');
    const id = first.body.procedureId as string;
    expect((await pool.query('SELECT status, source, uses FROM learned_procedures WHERE id = $1', [id])).rows[0]).toMatchObject({ status: 'candidate', source: 'ai:deepseek', uses: 1 });
    expect((await pool.query('SELECT provider, ok FROM learning_calls')).rows).toEqual([{ provider: 'deepseek', ok: true }]);

    // 2. Le client A est dépanné : un succès, pas encore assez pour être « trusted ».
    expect((await outcome(a, id, 'resolved')).body).toEqual({ recorded: true, status: 'candidate' });

    // 3. Le client B a le même problème : servi depuis la mémoire, aucun appel d'IA.
    const second = await solve(b, CASE);
    expect(second.body).toMatchObject({ status: 'memory', trust: 'candidate', procedureId: id });
    expect(ai).toHaveBeenCalledTimes(1);
    expect((await outcome(b, id, 'resolved')).body).toEqual({ recorded: true, status: 'trusted' });

    // 4. Procédure confirmée sur deux postes : « trusted », et l'IA n'est plus jamais consultée pour ce cas.
    const third = await solve(c, CASE);
    expect(third.body).toMatchObject({ status: 'memory', trust: 'trusted', procedureId: id });
    expect(ai).toHaveBeenCalledTimes(1);
    expect((await pool.query(`SELECT count(*)::int AS n FROM learning_calls`)).rows[0].n).toBe(1);
    expect((await pool.query(`SELECT uses FROM learned_procedures WHERE id = $1`, [id])).rows[0].uses).toBe(3);
  });

  it('un même poste ne compte qu’une fois, même s’il confirme plusieurs fois', async () => {
    const a = await newClient();
    const id = (await solve(a, CASE)).body.procedureId as string;
    await outcome(a, id, 'resolved');
    const again = await outcome(a, id, 'resolved');
    expect(again.body.status).toBe('candidate');
    expect((await pool.query('SELECT count(*)::int AS n FROM learned_procedure_runs WHERE procedure_id = $1', [id])).rows[0].n).toBe(1);
  });

  it('une procédure ne reçoit de résultat que de la part d’une session à laquelle elle a été servie', async () => {
    const [a, b] = [await newClient(), await newClient()];
    const id = (await solve(a, CASE)).body.procedureId as string;
    const stranger = await outcome(b, id, 'resolved'); // B ne l'a jamais reçue
    expect(stranger.status).toBe(404);
    expect((await outcome(a, '00000000-0000-4000-8000-000000000000', 'resolved')).status).toBe(404);
    expect((await outcome(b, id, 'resolved', a.sessionId)).status).toBe(404); // la session d'un autre
  });

  it('une procédure qui échoue sur deux postes est écartée ; l’IA est alors rappelée avec la piste à éviter', async () => {
    const [a, b, c] = [await newClient(), await newClient(), await newClient()];
    const id = (await solve(a, CASE)).body.procedureId as string;
    await solve(b, CASE);
    await outcome(a, id, 'not_resolved');
    expect((await outcome(b, id, 'not_resolved')).body.status).toBe('retired');

    // Piste nouvelle : l'IA est rappelée en connaissant l'échec précédent.
    next = () => procedure({ title: 'Cache Zebra vidé', fixes: [{ id: 'f1', tool: 'service_restart', args: { name: 'Spooler' }, why: 'Relancer le spouleur règle les files bloquées.' }] });
    const retry = await solve(c, CASE);
    expect(retry.body).toMatchObject({ status: 'generated' });
    expect(retry.body.procedureId).not.toBe(id);
    expect(ai).toHaveBeenCalledTimes(2);
    expect(String((ai.mock.calls[1] as [string, RequestInit])[1].body)).toContain('pistes_deja_essayees_sans_succes');
    expect(String((ai.mock.calls[1] as [string, RequestInit])[1].body)).toContain('Étiquettes Zebra vides');

    // Si l'IA recompose exactement la piste écartée, rien de nouveau : un manque est noté, la piste n'est pas rejouée.
    const d = await newClient();
    next = () => procedure();
    const same = await solve(d, 'zebra imprime étiquettes vides depuis hier soir sur le poste');
    expect(same.body.status).toBe('unsupported');
    expect((await pool.query(`SELECT count(*)::int AS n FROM knowledge_gaps`)).rows[0].n).toBe(1);
  });

  it('un cas hors catalogue est noté comme un manque (comptabilisé), sans rien mémoriser', async () => {
    const [a, b] = [await newClient(), await newClient()];
    next = () => ({ unsupported: true, reason: 'Demande de configurer un pilote d’imprimante réseau Zebra' });
    const res = await solve(a, 'installer le pilote de mon imprimante zebra réseau');
    expect(res.body).toEqual({ status: 'unsupported', reason: 'Demande de configurer un pilote d’imprimante réseau Zebra' });
    await solve(b, 'installer le pilote de mon imprimante zebra réseau');
    const gaps = (await pool.query(`SELECT occurrences, status FROM knowledge_gaps`)).rows;
    expect(gaps).toEqual([{ occurrences: 2, status: 'open' }]);
    expect((await pool.query(`SELECT count(*)::int AS n FROM learned_procedures`)).rows[0].n).toBe(0);
  });

  it('une réponse d’IA hors catalogue n’est jamais mémorisée ni transmise', async () => {
    const a = await newClient();
    next = () => procedure({ fixes: [{ id: 'f1', tool: 'run_command', args: { cmd: 'Remove-Item C:\\ -Recurse' }, why: 'Nettoyer' }] });
    const res = await solve(a, CASE);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('learning_unavailable');
    expect(JSON.stringify(res.body)).not.toContain('Remove-Item');
    expect((await pool.query(`SELECT count(*)::int AS n FROM learned_procedures`)).rows[0].n).toBe(0);
  });

  it('une procédure altérée en base n’est jamais servie', async () => {
    const [a, b] = [await newClient(), await newClient()];
    const id = (await solve(a, CASE)).body.procedureId as string;
    await pool.query(`UPDATE learned_procedures SET procedure = jsonb_set(procedure, '{fixes,0,tool}', '"run_command"') WHERE id = $1`, [id]);
    const res = await solve(b, CASE);
    // La ligne altérée n'est pas servie : l'IA est rappelée, et la procédure revalidée remplace le contenu altéré.
    expect(ai).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(res.body.procedure)).not.toContain('run_command');
    const stored = (await pool.query(`SELECT procedure FROM learned_procedures WHERE id = $1`, [id])).rows[0].procedure;
    expect(JSON.stringify(stored)).not.toContain('run_command');
  });

  it('la mémoire apprend les formulations voisines quand l’IA retombe sur la même procédure', async () => {
    const [a, b, c] = [await newClient(), await newClient(), await newClient()];
    const id = (await solve(a, CASE)).body.procedureId as string;
    await outcome(a, id, 'resolved');
    const variant = 'zebra étiquette blanche papier bloqué rouleau';
    // Formulation trop éloignée : l'IA est rappelée, retombe sur la même procédure, qui retient cette formulation.
    const viaAi = await solve(b, variant);
    expect(viaAi.body).toMatchObject({ status: 'memory', procedureId: id });
    expect(ai).toHaveBeenCalledTimes(2);
    // Désormais retrouvée sans IA.
    const viaMemory = await solve(c, variant);
    expect(viaMemory.body).toMatchObject({ status: 'memory', procedureId: id });
    expect(ai).toHaveBeenCalledTimes(2);
  });

  it('plafonne le coût : au plus LEARNING_MAX_AI_PER_SESSION appels d’IA par session', async () => {
    process.env.LEARNING_MAX_AI_PER_SESSION = '1';
    const a = await newClient();
    expect((await solve(a, CASE)).status).toBe(200);
    next = () => ({ unsupported: true, reason: 'Autre cas hors du catalogue des opérations' });
    const limited = await solve(a, 'mon scanner fujitsu bloque les documents épais');
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('learning_limit');
    expect(ai).toHaveBeenCalledTimes(1);
  });

  it('réponses sobres : phrase trop courte, version du catalogue différente, session étrangère, sans jeton', async () => {
    const [a, b] = [await newClient(), await newClient()];
    expect((await solve(a, 'bonjour')).body).toEqual({ status: 'needs_detail' });
    const old = await solve(a, CASE, { catalogVersion: 0 });
    expect(old.status).toBe(409);
    expect(old.body.code).toBe('catalog_mismatch');
    expect((await request(app).post(`/api/app/sessions/${a.sessionId}/knowledge/solve`).set(auth(b)).send({ query: CASE, catalogVersion: 1 })).status).toBe(404);
    expect((await request(app).post(`/api/app/sessions/${a.sessionId}/knowledge/solve`).send({ query: CASE, catalogVersion: 1 })).status).toBe(401);
    expect((await request(app).post(`/api/app/sessions/${a.sessionId}/knowledge/solve`).set(auth(a)).send({ query: CASE })).status).toBe(400);
    expect(ai).not.toHaveBeenCalled();
  });

  it('sans aucune clé d’IA : la mémoire fonctionne encore, les cas inconnus répondent « indisponible »', async () => {
    const [a, b] = [await newClient(), await newClient()];
    const id = (await solve(a, CASE)).body.procedureId as string;
    delete process.env.DEEPSEEK_API_KEY;
    expect((await solve(b, CASE)).body).toMatchObject({ status: 'memory', procedureId: id });
    const unknown = await solve(b, 'mon scanner fujitsu bloque les documents épais');
    expect(unknown.status).toBe(503);
  });

  it('PROMOTE_AFTER règle le nombre de postes nécessaires', async () => {
    process.env.LEARNING_PROMOTE_AFTER = '1';
    const a = await newClient();
    const id = (await solve(a, CASE)).body.procedureId as string;
    expect((await outcome(a, id, 'resolved')).body.status).toBe('trusted');
  });

  describe('administration', () => {
    async function adminToken() {
      await pool.query(`INSERT INTO technicians (full_name, phone, username, password_hash, role) VALUES ('Admin', '+22500000021', 'admin_appr', $1, 'admin') ON CONFLICT (username) DO NOTHING`, [await bcrypt.hash('secret123', 4)]);
      await pool.query(`INSERT INTO technicians (full_name, phone, username, password_hash, role) VALUES ('Tech', '+22500000022', 'tech_appr', $1, 'technician') ON CONFLICT (username) DO NOTHING`, [await bcrypt.hash('secret123', 4)]);
      const login = async (username: string) => (await request(app).post('/api/auth/technician/login').send({ username, password: 'secret123' })).body.token as string;
      return { admin: await login('admin_appr'), tech: await login('tech_appr') };
    }

    it('liste, valide et écarte ; une procédure validée ne change plus d’état selon les clients', async () => {
      const { admin, tech } = await adminToken();
      const [a, b, c] = [await newClient(), await newClient(), await newClient()];
      const id = (await solve(a, CASE)).body.procedureId as string;

      const list = await request(app).get('/api/admin/knowledge').set('Authorization', `Bearer ${admin}`);
      expect(list.status).toBe(200);
      expect(list.body.procedures).toMatchObject([{ id, status: 'candidate', source: 'ai:deepseek', successes: 0, failures: 0 }]);
      expect((await request(app).get('/api/admin/knowledge').set('Authorization', `Bearer ${tech}`)).status).toBe(403);
      expect((await request(app).get('/api/admin/knowledge')).status).toBe(401);

      const approved = await request(app).post(`/api/admin/knowledge/${id}/approve`).set('Authorization', `Bearer ${admin}`);
      expect(approved.status).toBe(200);
      expect(approved.body.procedure).toMatchObject({ id, status: 'trusted' });
      // Validée : deux échecs de clients ne l'écartent plus.
      await solve(b, CASE);
      await solve(c, CASE);
      await outcome(b, id, 'not_resolved');
      expect((await outcome(c, id, 'not_resolved')).body.status).toBe('trusted');

      const retired = await request(app).post(`/api/admin/knowledge/${id}/retire`).set('Authorization', `Bearer ${admin}`);
      expect(retired.body.procedure.status).toBe('retired');
      expect((await request(app).post(`/api/admin/knowledge/not-a-uuid/approve`).set('Authorization', `Bearer ${admin}`)).status).toBe(404);
      expect((await pool.query(`SELECT action FROM audit_logs WHERE action LIKE 'knowledge.%' ORDER BY action`)).rows.map((r) => r.action)).toEqual(['knowledge.approve', 'knowledge.retire']);
    });

    it('liste les capacités qui manquent, par fréquence', async () => {
      const { admin } = await adminToken();
      const a = await newClient();
      next = () => ({ unsupported: true, reason: 'Demande de configurer un pilote d’imprimante réseau Zebra' });
      await solve(a, 'installer le pilote de mon imprimante zebra réseau');
      const gaps = await request(app).get('/api/admin/knowledge/gaps').set('Authorization', `Bearer ${admin}`);
      expect(gaps.body.gaps).toMatchObject([{ sample_query: 'installer le pilote de mon imprimante zebra réseau', occurrences: 1, status: 'open' }]);
      const done = await request(app).post(`/api/admin/knowledge/gaps/${gaps.body.gaps[0].id}/status`).set('Authorization', `Bearer ${admin}`).send({ status: 'done' });
      expect(done.status).toBe(200);
    });
  });

  it('journalise ce qui a été servi (jamais les clés)', async () => {
    const a = await newClient();
    await solve(a, CASE);
    const rows = (await pool.query(`SELECT details FROM audit_logs WHERE action = 'agent.knowledge'`)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].details).toMatchObject({ status: 'generated', provider: 'deepseek' });
    expect(JSON.stringify(rows)).not.toContain('cle-deepseek-test');
  });
});
