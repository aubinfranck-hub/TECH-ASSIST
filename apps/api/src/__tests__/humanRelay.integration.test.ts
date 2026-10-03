import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Les notifications du téléphone sont simulées : aucun appel réseau.
const pushSent: { endpoint: string; payload: { title: string; body: string; url: string } }[] = [];
let pushOutcome: 'sent' | 'gone' | 'failed' = 'sent';
vi.mock('../notify/push.js', () => ({
  pushPublicKey: () => 'BPUBLICKEY',
  sendPush: async (sub: { endpoint: string }, payload: { title: string; body: string; url: string }) => {
    pushSent.push({ endpoint: sub.endpoint, payload });
    return pushOutcome;
  },
}));

import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { flushAlerts } from '../notify/technicianAlerts.js';
import { testOutbox } from '../utils/mailer.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();

let counter = 0;

async function registerClient(name = 'Awa Koné') {
  const email = `client${++counter}@example.com`;
  testOutbox.length = 0;
  await request(app).post('/api/app/email-code').send({ email });
  const code = /: ([0-9]{6})/.exec(testOutbox[testOutbox.length - 1]!.text)![1];
  const res = await request(app)
    .post('/api/app/register')
    .send({ installId: `install-${Date.now()}-${++counter}-aaaaaaaaaaaa`, platform: 'windows', email, code, phone: '+2250700001111', name });
  expect(res.status).toBe(201);
  testOutbox.length = 0;
  return { auth: { Authorization: `Bearer ${res.body.token as string}` }, email };
}

async function startSession(client: { auth: Record<string, string> }) {
  const res = await request(app).post('/api/app/assistance').set(client.auth).send({});
  expect(res.status).toBe(201);
  return res.body.session.id as string;
}

async function technician(username: string, opts: { role?: 'technician' | 'admin'; name?: string; alertEmail?: string | null; onDuty?: boolean } = {}) {
  const hash = await bcrypt.hash('secret123', 4);
  await pool.query(
    `INSERT INTO technicians (full_name, phone, username, password_hash, role, alert_email, on_duty)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [opts.name ?? `Tech ${username}`, `+2250000${Math.floor(Math.random() * 1e6)}`, username, hash, opts.role ?? 'technician', opts.alertEmail ?? null, opts.onDuty ?? true],
  );
  const login = await request(app).post('/api/auth/technician/login').send({ username, password: 'secret123' });
  expect(login.status).toBe(200);
  return { auth: { Authorization: `Bearer ${login.body.token as string}` } };
}

const subscribe = (t: { auth: Record<string, string> }, endpoint: string) =>
  request(app).post('/api/technician/push/subscribe').set(t.auth).send({ endpoint, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(16) } });

const escalate = (c: { auth: Record<string, string> }, sessionId: string, message = 'Le client demande un technicien') =>
  request(app).post(`/api/app/sessions/${sessionId}/events`).set(c.auth).send({ type: 'escalated', skill: 'conversation', message });

describe('Passage de main : alerte des techniciens, console, discussion avec le client', () => {
  beforeAll(async () => {
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
    pushSent.length = 0;
    pushOutcome = 'sent';
    process.env.AI_AGENT_ENABLED = 'true';
    process.env.PUBLIC_WEB_URL = 'https://tech-assist.example';
    delete process.env.TECH_ALERT_EMAILS;
    delete process.env.ALERT_WEBHOOK_URL;
  });
  afterEach(() => {
    delete process.env.AI_AGENT_ENABLED;
    delete process.env.TECH_ALERT_EMAILS;
    delete process.env.ALERT_WEBHOOK_URL;
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await pool.end();
  });

  describe('alertes', () => {
    it('prévient les techniciens de permanence (téléphone et email), une seule fois par demande', async () => {
      const a = await technician('awa', { alertEmail: 'awa@example.com' });
      await subscribe(a, 'https://push.example/awa-phone');
      const c = await registerClient();
      const sessionId = await startSession(c);
      process.env.TECH_ALERT_EMAILS = 'franck@example.com';

      expect((await escalate(c, sessionId)).status).toBe(201);
      await flushAlerts();

      expect(pushSent).toHaveLength(1);
      expect(pushSent[0]!.endpoint).toBe('https://push.example/awa-phone');
      expect(pushSent[0]!.payload.title).toMatch(/demande un technicien/i);
      expect(pushSent[0]!.payload.body).toContain('Awa Koné');
      expect(pushSent[0]!.payload.url).toBe(`https://tech-assist.example/technicien?session=${sessionId}`);
      expect(testOutbox.map((m) => m.to).sort()).toEqual(['awa@example.com', 'franck@example.com']);
      expect(testOutbox[0]!.text).toContain(`/technicien?session=${sessionId}`);

      // Le bouton et l'agent signalent la même demande : pas de second dérangement.
      await escalate(c, sessionId);
      await flushAlerts();
      expect(pushSent).toHaveLength(1);

      const audit = await pool.query(`SELECT details FROM audit_logs WHERE session_id = $1 AND action = 'technicians.alerted'`, [sessionId]);
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0].details).toMatchObject({ pushed: 1, emailed: 2, recipients: 1 });
    });

    it("n'alerte pas un technicien hors permanence, mais prévient toujours ceux de permanence", async () => {
      const off = await technician('off', { onDuty: false, alertEmail: 'off@example.com' });
      await subscribe(off, 'https://push.example/off');
      const on = await technician('on');
      await subscribe(on, 'https://push.example/on');
      const c = await registerClient();
      const sessionId = await startSession(c);
      await escalate(c, sessionId);
      await flushAlerts();
      expect(pushSent.map((p) => p.endpoint)).toEqual(['https://push.example/on']);
      expect(testOutbox.map((m) => m.to)).not.toContain('off@example.com');
    });

    it('le bouton « parler à un technicien » du site alerte aussi', async () => {
      const t = await technician('awa');
      await subscribe(t, 'https://push.example/awa');
      const c = await registerClient();
      const sessionId = await startSession(c);
      const res = await request(app).post(`/api/sessions/${sessionId}/escalate`);
      expect(res.status).toBe(200);
      await flushAlerts();
      expect(pushSent).toHaveLength(1);
    });

    it('un appareil désinscrit est retiré ; un webhook peut relayer vers WhatsApp, Telegram…', async () => {
      const t = await technician('awa');
      await subscribe(t, 'https://push.example/dead');
      const calls: { url: string; body: string }[] = [];
      vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
        calls.push({ url, body: init.body });
        return { ok: true };
      });
      process.env.ALERT_WEBHOOK_URL = 'https://hooks.example/alert';
      pushOutcome = 'gone';
      const c = await registerClient();
      const sessionId = await startSession(c);
      await escalate(c, sessionId);
      await flushAlerts();
      const left = await pool.query('SELECT 1 FROM technician_push_subscriptions');
      expect(left.rows).toHaveLength(0);
      expect(calls).toHaveLength(1);
      expect(JSON.parse(calls[0]!.body).text).toContain('demande un technicien');
    });

    it("l'échec d'un envoi ne bloque jamais la demande du client", async () => {
      const t = await technician('awa');
      await subscribe(t, 'https://push.example/awa');
      pushOutcome = 'failed';
      const c = await registerClient();
      const sessionId = await startSession(c);
      expect((await escalate(c, sessionId)).status).toBe(201);
      await flushAlerts();
      const s = await pool.query('SELECT mode, human_requested_at FROM sessions WHERE id = $1', [sessionId]);
      expect(s.rows[0].mode).toBe('humain');
      expect(s.rows[0].human_requested_at).not.toBeNull();
    });
  });

  describe('réglages du technicien', () => {
    it('lit et modifie la permanence et l\'email d\'alerte', async () => {
      const t = await technician('awa', { name: 'Awa Traoré' });
      const before = await request(app).get('/api/technician/alerts').set(t.auth);
      expect(before.body).toMatchObject({ name: 'Awa Traoré', onDuty: true, devices: 0, push: { available: true, publicKey: 'BPUBLICKEY' } });
      const off = await request(app).patch('/api/technician/alerts').set(t.auth).send({ onDuty: false, alertEmail: 'Awa@Example.com' });
      expect(off.body).toEqual({ onDuty: false, alertEmail: 'awa@example.com' });
      const cleared = await request(app).patch('/api/technician/alerts').set(t.auth).send({ alertEmail: '' });
      expect(cleared.body.alertEmail).toBeNull();
      expect(cleared.body.onDuty).toBe(false);
      expect((await request(app).patch('/api/technician/alerts').set(t.auth).send({})).status).toBe(400);
      expect((await request(app).patch('/api/technician/alerts').set(t.auth).send({ alertEmail: 'pas-un-email' })).status).toBe(400);
    });

    it('refuse les abonnements non sécurisés et exige une connexion', async () => {
      const t = await technician('awa');
      const bad = await request(app).post('/api/technician/push/subscribe').set(t.auth).send({ endpoint: 'http://insecure.example/x', keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(16) } });
      expect(bad.status).toBe(400);
      expect((await request(app).get('/api/technician/alerts')).status).toBe(401);
      expect((await request(app).post('/api/technician/push/test')).status).toBe(401);
    });

    it('envoie une notification d\'essai sur ses appareils', async () => {
      const t = await technician('awa');
      await subscribe(t, 'https://push.example/one');
      await subscribe(t, 'https://push.example/two');
      const res = await request(app).post('/api/technician/push/test').set(t.auth);
      expect(res.body).toEqual({ devices: 2, sent: 2 });
      await request(app).post('/api/technician/push/unsubscribe').set(t.auth).send({ endpoint: 'https://push.example/one' });
      expect((await request(app).get('/api/technician/alerts').set(t.auth)).body.devices).toBe(1);
    });
  });

  describe('demande, détail et discussion', () => {
    async function setup() {
      const c = await registerClient();
      const sessionId = await startSession(c);
      await request(app).post(`/api/app/sessions/${sessionId}/events`).set(c.auth).send({ type: 'user_request', skill: 'conversation', message: "Mon PC se met en veille et je dois faire Ctrl Alt Suppr" });
      await request(app).post(`/api/app/sessions/${sessionId}/events`).set(c.auth).send({ type: 'diagnosed', skill: 'power', message: "Mise en veille prolongée activée" });
      await escalate(c, sessionId, 'Le client demande un technicien');
      await flushAlerts();
      return { c, sessionId };
    }

    it("la demande arrive dans la file, avec ce que l'agent a constaté", async () => {
      const t = await technician('awa');
      const { sessionId } = await setup();
      const queue = await request(app).get('/api/technician/queue').set(t.auth);
      expect(queue.body.queue.map((q: { id: string }) => q.id)).toEqual([sessionId]);
      expect(queue.body.queue[0].human_requested_at).not.toBeNull();

      const detail = await request(app).get(`/api/technician/sessions/${sessionId}`).set(t.auth);
      expect(detail.status).toBe(200);
      expect(detail.body.client).toMatchObject({ name: 'Awa Koné', phone: '+2250700001111' });
      expect(detail.body.client.email).toMatch(/@example\.com$/);
      const lines = detail.body.timeline.map((e: { text: string }) => e.text);
      expect(lines).toContain("Le client a écrit : « Mon PC se met en veille et je dois faire Ctrl Alt Suppr »");
      expect(lines).toContain('Diagnostic (power) : Mise en veille prolongée activée');
      expect(lines.some((l: string) => l.startsWith('Passage de main'))).toBe(true);
      expect(detail.body.session).toMatchObject({ status: 'created', mine: false, canWrite: false });
    });

    it('prise en charge : le client voit le technicien, ils discutent, puis la demande est terminée', async () => {
      const t = await technician('awa', { name: 'Awa Traoré' });
      await subscribe(t, 'https://push.example/awa-phone');
      const { c, sessionId } = await setup();
      pushSent.length = 0;

      // Avant la prise en charge, le technicien ne peut pas écrire.
      const early = await request(app).post(`/api/technician/sessions/${sessionId}/messages`).set(t.auth).send({ body: 'Bonjour' });
      expect(early.status).toBe(409);

      let poll = await request(app).get(`/api/app/sessions/${sessionId}/messages`).set(c.auth);
      expect(poll.body.state).toEqual({ status: 'created', requested: true, claimed: false, technician: null });

      expect((await request(app).patch(`/api/technician/sessions/${sessionId}/claim`).set(t.auth)).status).toBe(200);
      poll = await request(app).get(`/api/app/sessions/${sessionId}/messages`).set(c.auth);
      expect(poll.body.state).toMatchObject({ status: 'active', claimed: true, technician: 'Awa' });
      expect(poll.body.messages[0]).toMatchObject({ sender: 'system' });
      expect(poll.body.messages[0].body).toContain('Awa');
      let last = poll.body.messages.at(-1).id as number;

      expect((await request(app).post(`/api/technician/sessions/${sessionId}/messages`).set(t.auth).send({ body: 'Bonjour, je regarde votre PC.' })).status).toBe(201);
      poll = await request(app).get(`/api/app/sessions/${sessionId}/messages?after=${last}`).set(c.auth);
      expect(poll.body.messages).toHaveLength(1);
      expect(poll.body.messages[0]).toMatchObject({ sender: 'technician', body: 'Bonjour, je regarde votre PC.', name: 'Awa' });
      last = poll.body.messages[0].id;

      expect((await request(app).post(`/api/app/sessions/${sessionId}/messages`).set(c.auth).send({ body: 'Merci, je suis là.' })).status).toBe(201);
      const seen = await request(app).get(`/api/technician/sessions/${sessionId}/messages?after=${last}`).set(t.auth);
      expect(seen.body.messages.map((m: { sender: string; body: string }) => [m.sender, m.body])).toEqual([['client', 'Merci, je suis là.']]);
      await flushAlerts();
      expect(pushSent.filter((p) => p.payload.title === 'Le client vous a répondu')).toHaveLength(1);

      expect((await request(app).post(`/api/technician/sessions/${sessionId}/finish`).set(t.auth)).status).toBe(200);
      poll = await request(app).get(`/api/app/sessions/${sessionId}/messages?after=${last}`).set(c.auth);
      expect(poll.body.state.status).toBe('completed');
      expect(poll.body.messages.at(-1)).toMatchObject({ sender: 'system' });
      expect((await request(app).post(`/api/app/sessions/${sessionId}/messages`).set(c.auth).send({ body: 'Encore là ?' })).status).toBe(409);
      expect((await request(app).post(`/api/technician/sessions/${sessionId}/finish`).set(t.auth)).status).toBe(409);
    });

    it("une demande prise par un technicien n'est plus visible des autres, sauf de l'administrateur", async () => {
      const awa = await technician('awa');
      const bob = await technician('bob');
      const boss = await technician('boss', { role: 'admin' });
      const { sessionId } = await setup();
      await request(app).patch(`/api/technician/sessions/${sessionId}/claim`).set(awa.auth);
      expect((await request(app).get(`/api/technician/sessions/${sessionId}`).set(bob.auth)).status).toBe(403);
      expect((await request(app).post(`/api/technician/sessions/${sessionId}/messages`).set(bob.auth).send({ body: 'je prends' })).status).toBe(403);
      expect((await request(app).post(`/api/technician/sessions/${sessionId}/finish`).set(bob.auth)).status).toBe(403);
      expect((await request(app).get(`/api/technician/sessions/${sessionId}`).set(boss.auth)).status).toBe(200);
      expect((await request(app).get(`/api/technician/sessions/${sessionId}`).set(awa.auth)).body.session).toMatchObject({ mine: true, canWrite: true });
    });

    it("un client ne lit ni n'écrit dans la session d'un autre", async () => {
      const { sessionId } = await setup();
      const other = await registerClient('Autre');
      expect((await request(app).get(`/api/app/sessions/${sessionId}/messages`).set(other.auth)).status).toBe(404);
      expect((await request(app).post(`/api/app/sessions/${sessionId}/messages`).set(other.auth).send({ body: 'intrus' })).status).toBe(404);
      expect((await request(app).get('/api/app/sessions/pas-un-uuid/messages').set(other.auth)).status).toBe(404);
      expect((await request(app).get(`/api/app/sessions/${sessionId}/messages`)).status).toBe(401);
    });

    it('refuse un message vide ou trop long', async () => {
      const t = await technician('awa');
      const { c, sessionId } = await setup();
      await request(app).patch(`/api/technician/sessions/${sessionId}/claim`).set(t.auth);
      expect((await request(app).post(`/api/app/sessions/${sessionId}/messages`).set(c.auth).send({ body: '   ' })).status).toBe(400);
      expect((await request(app).post(`/api/app/sessions/${sessionId}/messages`).set(c.auth).send({ body: 'x'.repeat(1001) })).status).toBe(400);
      expect((await request(app).post(`/api/technician/sessions/${sessionId}/messages`).set(t.auth).send({ body: '' })).status).toBe(400);
    });
  });

  describe("avancement des tâches de l'agent", () => {
    const tasks = {
      complete: false,
      items: [
        { id: 'phase:scan', title: 'Analyse de votre ordinateur', state: 'done', min: 60, max: 150, seconds: 74 },
        { id: 'dism|Réparer Windows', title: 'Réparer les fichiers de Windows (DISM)', state: 'running', min: 600, max: 2400, elapsed: 192 },
        { id: 'sfc|Vérifier', title: 'Vérifier les fichiers système', state: 'pending', min: 600, max: 1800 },
      ],
    };
    const put = (c: { auth: Record<string, string> }, sessionId: string, body: unknown) =>
      request(app).put(`/api/app/sessions/${sessionId}/progress`).set(c.auth).send(body as object);
    async function claimed() {
      const t = await technician('awa');
      const c = await registerClient();
      const sessionId = await startSession(c);
      await request(app).patch(`/api/technician/sessions/${sessionId}/claim`).set(t.auth);
      return { t, c, sessionId };
    }

    it("le technicien voit ce que l'agent fait en ce moment, dans le dossier, la discussion et sa liste", async () => {
      const { t, c, sessionId } = await claimed();
      const before = await request(app).get(`/api/technician/sessions/${sessionId}`).set(t.auth);
      expect(before.body.progress).toBeNull();

      expect((await put(c, sessionId, tasks)).status).toBe(200);

      const detail = await request(app).get(`/api/technician/sessions/${sessionId}`).set(t.auth);
      expect(detail.body.progress).toMatchObject({ complete: false, items: tasks.items });
      expect(detail.body.progress.ageSeconds).toBeLessThan(5);
      const poll = await request(app).get(`/api/technician/sessions/${sessionId}/messages?after=0`).set(t.auth);
      expect(poll.body.progress.items).toHaveLength(3);
      const mine = await request(app).get('/api/technician/my-sessions').set(t.auth);
      expect(mine.body.sessions[0]).toMatchObject({ id: sessionId, agent_task: 'Réparer les fichiers de Windows (DISM)' });
      expect(mine.body.sessions[0]).not.toHaveProperty('task_progress');
    });

    it("l'état le plus récent remplace le précédent", async () => {
      const { t, c, sessionId } = await claimed();
      await put(c, sessionId, tasks);
      await put(c, sessionId, { complete: true, items: [{ id: 'a', title: 'Tout est fait', state: 'done', min: 5, max: 60, seconds: 9 }] });
      const detail = await request(app).get(`/api/technician/sessions/${sessionId}`).set(t.auth);
      expect(detail.body.progress.complete).toBe(true);
      expect(detail.body.progress.items).toHaveLength(1);
      expect((await request(app).get('/api/technician/my-sessions').set(t.auth)).body.sessions[0].agent_task).toBeNull();
    });

    it("sans nouvelles de l'agent depuis plusieurs minutes, l'ancienneté le dit et la liste n'affiche plus de tâche en cours", async () => {
      const { t, c, sessionId } = await claimed();
      await put(c, sessionId, tasks);
      await pool.query(`UPDATE sessions SET task_progress_at = now() - interval '10 minutes' WHERE id = $1`, [sessionId]);
      const detail = await request(app).get(`/api/technician/sessions/${sessionId}`).set(t.auth);
      expect(detail.body.progress.ageSeconds).toBeGreaterThanOrEqual(600);
      expect((await request(app).get('/api/technician/my-sessions').set(t.auth)).body.sessions[0].agent_task).toBeNull();
    });

    it("refuse un état mal formé, une session d'un autre client et l'absence d'identification", async () => {
      const { c, sessionId } = await claimed();
      expect((await put(c, sessionId, { complete: false, items: [{ id: 'a', title: 'x', state: 'explose', min: 1, max: 2 }] })).status).toBe(400);
      expect((await put(c, sessionId, { complete: false, items: [{ id: 'a', title: 'x', state: 'running', min: -1, max: 2 }] })).status).toBe(400);
      expect((await put(c, sessionId, { complete: false })).status).toBe(400);
      expect((await put(c, sessionId, { complete: false, items: Array.from({ length: 61 }, (_, i) => ({ id: String(i), title: 't', state: 'pending', min: 1, max: 2 })) })).status).toBe(400);
      const other = await registerClient('Autre');
      expect((await put(other, sessionId, tasks)).status).toBe(404);
      expect((await put(c, 'pas-un-uuid', tasks)).status).toBe(404);
      expect((await request(app).put(`/api/app/sessions/${sessionId}/progress`).send(tasks)).status).toBe(401);
    });

    it("un technicien ne voit pas l'avancement d'une demande suivie par un autre", async () => {
      const { c, sessionId } = await claimed();
      await put(c, sessionId, tasks);
      const bob = await technician('bob');
      expect((await request(app).get(`/api/technician/sessions/${sessionId}`).set(bob.auth)).status).toBe(403);
      expect((await request(app).get(`/api/technician/sessions/${sessionId}/messages`).set(bob.auth)).status).toBe(403);
    });
  });
});
