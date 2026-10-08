import bcrypt from 'bcryptjs';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { flushAlerts } from '../notify/technicianAlerts.js';
import { connectedCount, resetHub } from '../notify/technicianHub.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();
let server: Server;
let port = 0;

interface Frame {
  event: string;
  data: Record<string, unknown>;
}

/** Ouvre le flux comme le fait une application : en-tête Authorization, lecture continue. */
function openStream(token: string): { frames: Frame[]; status: Promise<number>; close: () => void; waitFor: (event: string, ms?: number) => Promise<Frame> } {
  const frames: Frame[] = [];
  let buffer = '';
  let resolveStatus!: (n: number) => void;
  const status = new Promise<number>((r) => (resolveStatus = r));
  const req = httpRequest({ host: '127.0.0.1', port, path: '/api/technician/stream', headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' } }, (res) => {
    resolveStatus(res.statusCode ?? 0);
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(raw)?.[1];
        const data = /^data: (.+)$/m.exec(raw)?.[1];
        if (ev && data) frames.push({ event: ev, data: JSON.parse(data) as Record<string, unknown> });
      }
    });
  });
  req.on('error', () => undefined);
  req.end();
  const waitFor = async (event: string, ms = 3000): Promise<Frame> => {
    const start = Date.now();
    for (;;) {
      const f = frames.find((x) => x.event === event);
      if (f) return f;
      if (Date.now() - start > ms) throw new Error(`événement « ${event} » jamais reçu (reçus : ${frames.map((x) => x.event).join(', ') || 'aucun'})`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  return { frames, status, close: () => req.destroy(), waitFor };
}

async function technician(username: string, opts: { onDuty?: boolean } = {}) {
  const hash = await bcrypt.hash('secret123', 4);
  await pool.query(`INSERT INTO technicians (full_name, phone, username, password_hash, role, on_duty) VALUES ($1, $2, $3, $4, 'technician', $5)`, [`Tech ${username}`, `+2250000${Math.floor(Math.random() * 1e6)}`, username, hash, opts.onDuty ?? true]);
  const login = await request(app).post('/api/auth/technician/login').send({ username, password: 'secret123' });
  expect(login.status).toBe(200);
  const session = login.body.token as string;
  const dev = await request(app).post('/api/auth/technician/device-token').set('Authorization', `Bearer ${session}`).send({ label: 'Test', platform: 'android' });
  expect(dev.status).toBe(201);
  return { session, device: dev.body.deviceToken as string, deviceId: dev.body.deviceId as string };
}

let n = 0;
async function clientAsksForTechnician() {
  const res = await request(app).post('/api/app/anonymous').send({ installId: `install-stream-${++n}-aaaaaaaaaaaaaaaa`, platform: 'windows', hardwareHash: String(n).repeat(40) });
  const auth = { Authorization: `Bearer ${res.body.token as string}` };
  const start = await request(app).post('/api/app/assistance').set(auth).send({});
  const sessionId = start.body.session.id as string;
  const esc = await request(app).post(`/api/app/sessions/${sessionId}/events`).set(auth).send({ type: 'escalated', skill: 'conversation', message: 'Mon micro ne marche toujours pas' });
  expect(esc.status).toBe(201);
  await flushAlerts();
  return sessionId;
}

describe('Applications technicien : jeton d’appareil et flux temps réel', () => {
  beforeAll(async () => {
    await applyMigrations();
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    port = (server.address() as AddressInfo).port;
  });
  beforeEach(async () => {
    await truncateAll();
    resetHub();
    process.env.AI_AGENT_ENABLED = 'true';
  });
  afterEach(() => {
    resetHub();
    delete process.env.AI_AGENT_ENABLED;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await pool.end();
  });

  describe('jeton d’appareil', () => {
    it('longue durée, lié à l’appareil, accepté partout où le technicien l’est', async () => {
      const t = await technician('awa');
      const queue = await request(app).get('/api/technician/queue').set('Authorization', `Bearer ${t.device}`);
      expect(queue.status).toBe(200);
      const list = await request(app).get('/api/auth/technician/devices').set('Authorization', `Bearer ${t.device}`);
      expect(list.body.devices).toHaveLength(1);
      expect(list.body.current).toBe(t.deviceId);
    });

    it('un jeton d’appareil ne peut pas en fabriquer un autre (il faut une vraie connexion)', async () => {
      const t = await technician('awa');
      const res = await request(app).post('/api/auth/technician/device-token').set('Authorization', `Bearer ${t.device}`).send({ label: 'Pirate', platform: 'windows' });
      expect(res.status).toBe(403);
    });

    it('appareil révoqué : refus immédiat', async () => {
      const t = await technician('awa');
      const rev = await request(app).delete(`/api/auth/technician/devices/${t.deviceId}`).set('Authorization', `Bearer ${t.session}`);
      expect(rev.status).toBe(200);
      const res = await request(app).get('/api/technician/queue').set('Authorization', `Bearer ${t.device}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('device_revoked');
      // La connexion normale du même technicien n'est pas touchée.
      expect((await request(app).get('/api/technician/queue').set('Authorization', `Bearer ${t.session}`)).status).toBe(200);
    });

    it('technicien désactivé : tous ses appareils cessent de fonctionner tout de suite', async () => {
      const t = await technician('awa');
      await pool.query(`UPDATE technicians SET is_active = FALSE WHERE username = 'awa'`);
      expect((await request(app).get('/api/technician/queue').set('Authorization', `Bearer ${t.device}`)).status).toBe(401);
    });

    it('au plus 10 appareils actifs : les plus anciens sont révoqués', async () => {
      const t = await technician('awa');
      for (let i = 0; i < 11; i++) await request(app).post('/api/auth/technician/device-token').set('Authorization', `Bearer ${t.session}`).send({ label: `Tel ${i}`, platform: 'android' });
      const active = await pool.query(`SELECT count(*)::int AS n FROM technician_devices WHERE revoked_at IS NULL`);
      expect(active.rows[0].n).toBe(10);
    });

    it('un technicien ne peut pas révoquer l’appareil d’un autre', async () => {
      const a = await technician('awa');
      const b = await technician('kofi');
      const res = await request(app).delete(`/api/auth/technician/devices/${a.deviceId}`).set('Authorization', `Bearer ${b.session}`);
      expect(res.status).toBe(404);
    });
  });

  describe('flux temps réel', () => {
    it('refuse sans jeton valide', async () => {
      const s = openStream('pas-un-jeton');
      expect(await s.status).toBe(401);
      s.close();
    });

    it('une demande de client arrive en même temps chez tous les techniciens de permanence ; pas chez celui qui est hors permanence', async () => {
      const a = await technician('awa');
      const b = await technician('kofi');
      const off = await technician('yao', { onDuty: false });
      const sa = openStream(a.device);
      const sb = openStream(b.device);
      const so = openStream(off.device);
      await Promise.all([sa.waitFor('hello'), sb.waitFor('hello'), so.waitFor('hello')]);
      expect(connectedCount()).toBe(3);

      const sessionId = await clientAsksForTechnician();
      const [ra, rb] = await Promise.all([sa.waitFor('request'), sb.waitFor('request')]);
      expect((ra.data.request as { id: string }).id).toBe(sessionId);
      expect((rb.data.request as { id: string }).id).toBe(sessionId);
      expect(ra.data.request).toMatchObject({ platform: 'windows', reason: 'Mon micro ne marche toujours pas' });
      await new Promise((r) => setTimeout(r, 150));
      expect(so.frames.some((f) => f.event === 'request')).toBe(false);
      [sa, sb, so].forEach((s) => s.close());
    });

    it('le premier qui prend la demande l’obtient ; les autres reçoivent « taken » (et le second reçoit 409)', async () => {
      const a = await technician('awa');
      const b = await technician('kofi');
      const sa = openStream(a.device);
      const sb = openStream(b.device);
      await Promise.all([sa.waitFor('hello'), sb.waitFor('hello')]);
      const sessionId = await clientAsksForTechnician();
      await sb.waitFor('request');

      const first = await request(app).patch(`/api/technician/sessions/${sessionId}/claim`).set('Authorization', `Bearer ${a.device}`);
      expect(first.status).toBe(200);
      const taken = await sb.waitFor('taken');
      expect(taken.data).toMatchObject({ sessionId, by: 'Tech' });
      const second = await request(app).patch(`/api/technician/sessions/${sessionId}/claim`).set('Authorization', `Bearer ${b.device}`);
      expect(second.status).toBe(409);
      [sa, sb].forEach((s) => s.close());
    });

    it('à la connexion, l’application reçoit la file d’attente (rattrape ce qu’une coupure a fait manquer)', async () => {
      const sessionId = await clientAsksForTechnician();
      const a = await technician('awa');
      const s = openStream(a.device);
      const snap = await s.waitFor('snapshot');
      expect((snap.data.queue as { id: string }[]).map((q) => q.id)).toEqual([sessionId]);
      s.close();
    });

    it('un appareil révoqué est coupé : il ne peut plus ouvrir le flux', async () => {
      const a = await technician('awa');
      await pool.query(`UPDATE technician_devices SET revoked_at = now()`);
      const s = openStream(a.device);
      expect(await s.status).toBe(401);
      s.close();
    });

    it('la connexion fermée est retirée du concentrateur', async () => {
      const a = await technician('awa');
      const s = openStream(a.device);
      await s.waitFor('hello');
      expect(connectedCount()).toBe(1);
      s.close();
      for (let i = 0; i < 40 && connectedCount() > 0; i++) await new Promise((r) => setTimeout(r, 25));
      expect(connectedCount()).toBe(0);
    });
  });
});
