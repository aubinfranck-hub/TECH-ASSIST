import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { testOutbox } from '../utils/mailer.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();
let counter = 0;

interface Registered {
  token: string;
  email: string;
}
async function register(): Promise<Registered> {
  const email = `offre${++counter}@example.com`;
  testOutbox.length = 0;
  await request(app).post('/api/app/email-code').send({ email });
  const code = /: ([0-9]{6})/.exec(testOutbox[testOutbox.length - 1]!.text)![1];
  const res = await request(app)
    .post('/api/app/register')
    .send({ installId: `install-offre-${Date.now()}-${++counter}-aaaaaaaa`, platform: 'windows', email, code, phone: '+2250700004444' });
  expect(res.status).toBe(201);
  return { token: res.body.token as string, email };
}
const auth = (r: Registered) => ({ Authorization: `Bearer ${r.token}` });

async function technicianToken() {
  await pool.query(
    `INSERT INTO technicians (full_name, phone, username, password_hash, role) VALUES ('Agent', '+22500000011', 'agent_offres', $1, 'admin') ON CONFLICT (username) DO NOTHING`,
    [await bcrypt.hash('secret123', 4)],
  );
  return (await request(app).post('/api/auth/technician/login').send({ username: 'agent_offres', password: 'secret123' })).body.token as string;
}

/** Commande un forfait, le fait confirmer par un technicien et démarre l'assistance. */
async function startForfait(r: Registered, planId: 'diagnostic_express' | 'assistance_rapide') {
  const tech = await technicianToken();
  const order = await request(app).post('/api/app/orders').set(auth(r)).send({ planId });
  expect(order.status).toBe(201);
  await request(app).post(`/api/orders/${order.body.order.id}/confirm-payment`).set('Authorization', `Bearer ${tech}`).expect(200);
  const started = await request(app).post('/api/app/assistance').set(auth(r)).send({ orderId: order.body.order.id, mode: 'ia' });
  expect(started.status).toBe(201);
  return { started, tech, sessionId: started.body.session.id as string };
}

/** Passage de main de l'agent ; l'alerte des techniciens part en tâche de fond : on la laisse finir avant la suite du test. */
const escalate = async (r: Registered, sessionId: string) => {
  const res = await request(app).post(`/api/app/sessions/${sessionId}/events`).set(auth(r)).send({ type: 'escalated', skill: 'conversation', message: 'Le problème dépasse l’IA' });
  await new Promise((done) => setTimeout(done, 150));
  return res;
};

describe('Offres : IA seule (500) / IA + technicien (2 000) / complément', () => {
  beforeAll(async () => {
    await applyMigrations();
    process.env.AI_AGENT_ENABLED = 'true';
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterEach(() => {
    delete process.env.FREE_LAUNCH;
  });
  afterAll(async () => {
    delete process.env.AI_AGENT_ENABLED;
    await pool.end();
  });

  it('les tarifs publics : deux forfaits particuliers (500 IA seule, 2 000 IA + technicien), ni l’ancien à 5 000 ni le complément', async () => {
    const { plans } = (await request(app).get('/api/pricing')).body as { plans: { id: string; name: string; segment: string; price_fcfa: number; metadata: Record<string, unknown> }[] };
    const particuliers = plans.filter((p) => p.segment === 'particulier' && p.metadata.scope); // (l'ancien abonnement mensuel n'est plus mis en avant)
    expect(particuliers.map((p) => [p.id, p.name, p.price_fcfa, p.metadata.humanIncluded])).toEqual([
      ['diagnostic_express', 'Assistance IA', 500, false],
      ['assistance_rapide', 'Assistance IA + technicien', 2000, true],
    ]);
    expect(plans.map((p) => p.id)).not.toContain('session_maintenance');
    expect(plans.map((p) => p.id)).not.toContain('complement_technicien');
    for (const p of plans.filter((x) => x.segment === 'pme')) expect(p.metadata.humanIncluded).toBe(true);
  });

  it('on ne commande ni l’ancien forfait à 5 000 ni le complément directement', async () => {
    const r = await register();
    for (const planId of ['session_maintenance', 'complement_technicien']) {
      expect((await request(app).post('/api/app/orders').set(auth(r)).send({ planId })).status).toBe(404);
    }
    const legacy = await request(app).post('/api/orders').send({ clientPhone: '+2250700000099', planId: 'complement_technicien', platform: 'web' });
    expect(legacy.status).toBe(400);
  });

  it('forfait 500 : la session ne comprend PAS de technicien ; le complément est annoncé', async () => {
    const r = await register();
    const { started } = await startForfait(r, 'diagnostic_express');
    expect(started.body.humanIncluded).toBe(false);
    expect(started.body.session.human_included).toBe(false);
    expect(started.body.upgrade).toEqual({ planId: 'complement_technicien', priceFcfa: 1500 });
    expect(started.body.scope).toBe('full'); // l'IA fait tout, avec l'accord du client
  });

  it('forfait 500 : un passage de main est enregistré mais personne n’est alerté, la session reste à l’IA', async () => {
    const r = await register();
    const { sessionId, tech } = await startForfait(r, 'diagnostic_express');
    const res = await escalate(r, sessionId);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ recorded: true, humanIncluded: false, upgrade: { priceFcfa: 1500 } });
    const row = (await pool.query('SELECT mode, human_requested_at FROM sessions WHERE id = $1', [sessionId])).rows[0];
    expect(row.mode).toBe('ia');
    expect(row.human_requested_at).toBeNull();
    expect((await request(app).get('/api/technician/queue').set('Authorization', `Bearer ${tech}`)).body.queue).toEqual([]);
    // la demande reste dans le journal
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE session_id = $1 AND action = 'agent.escalated'", [sessionId])).rows[0].n).toBe(1);
  });

  it('forfait 500 : la route publique « passer à un technicien » est refusée de la même façon', async () => {
    const r = await register();
    const { sessionId } = await startForfait(r, 'diagnostic_express');
    const res = await request(app).post(`/api/sessions/${sessionId}/escalate`);
    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ code: 'human_not_included', upgrade: { priceFcfa: 1500 } });
    expect((await pool.query('SELECT mode FROM sessions WHERE id = $1', [sessionId])).rows[0].mode).toBe('ia');
  });

  it('forfait 2 000 : technicien inclus, le passage de main alerte et met la session en file', async () => {
    const r = await register();
    const { started, sessionId, tech } = await startForfait(r, 'assistance_rapide');
    expect(started.body.humanIncluded).toBe(true);
    expect(started.body.upgrade).toBeUndefined();
    expect((await escalate(r, sessionId)).body).toEqual({ recorded: true });
    expect((await pool.query('SELECT mode FROM sessions WHERE id = $1', [sessionId])).rows[0].mode).toBe('humain');
    expect((await request(app).get('/api/technician/queue').set('Authorization', `Bearer ${tech}`)).body.queue).toHaveLength(1);
  });

  it('assistance offerte, abonné, entreprise : technicien inclus', async () => {
    const r = await register();
    const free = await request(app).post('/api/app/assistance').set(auth(r)).send({ mode: 'ia' });
    expect(free.body.coverage).toBe('free_offer');
    expect(free.body.humanIncluded).toBe(true);
    expect(free.body.session.human_included).toBe(true);
  });

  describe('complément « ajouter un technicien »', () => {
    it('commande à 1 500, retrouvée au lieu d’être empilée ; payée → la session comprend un technicien → le passage de main passe', async () => {
      const r = await register();
      const { sessionId, tech } = await startForfait(r, 'diagnostic_express');
      const up = await request(app).post(`/api/app/sessions/${sessionId}/upgrade`).set(auth(r));
      expect(up.status).toBe(201);
      expect(up.body.order.amount_fcfa).toBe(1500);
      expect(up.body.payment).toMatchObject({ amountFcfa: 1500 });
      expect(up.body.payment.reference).toHaveLength(8);

      const again = await request(app).post(`/api/app/sessions/${sessionId}/upgrade`).set(auth(r));
      expect(again.body.order.id).toBe(up.body.order.id);
      expect((await pool.query("SELECT count(*)::int AS n FROM orders WHERE upgrade_session_id = $1", [sessionId])).rows[0].n).toBe(1);

      // avant paiement : toujours pas de technicien
      expect((await escalate(r, sessionId)).body.humanIncluded).toBe(false);
      expect((await request(app).get(`/api/app/orders/${up.body.order.id}`).set(auth(r))).body.order.status).toBe('pending_payment');

      await request(app).post(`/api/orders/${up.body.order.id}/confirm-payment`).set('Authorization', `Bearer ${tech}`).expect(200);
      expect((await request(app).get(`/api/app/orders/${up.body.order.id}`).set(auth(r))).body.order.status).toBe('paid');
      expect((await pool.query('SELECT human_included FROM sessions WHERE id = $1', [sessionId])).rows[0].human_included).toBe(true);
      expect((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE session_id = $1 AND action = 'session.human_added'", [sessionId])).rows[0].n).toBe(1);

      // maintenant le passage de main alerte vraiment
      expect((await escalate(r, sessionId)).body).toEqual({ recorded: true });
      expect((await pool.query('SELECT mode FROM sessions WHERE id = $1', [sessionId])).rows[0].mode).toBe('humain');
      expect((await request(app).get('/api/technician/queue').set('Authorization', `Bearer ${tech}`)).body.queue).toHaveLength(1);
    });

    it('le complément ne s’achète pas deux fois : session déjà avec technicien → 409', async () => {
      const r = await register();
      const { sessionId } = await startForfait(r, 'assistance_rapide');
      const up = await request(app).post(`/api/app/sessions/${sessionId}/upgrade`).set(auth(r));
      expect(up.status).toBe(409);
      expect(up.body.code).toBe('already_included');
    });

    it('la session d’un autre client, une session inconnue ou terminée : refusé', async () => {
      const r = await register();
      const other = await register();
      const { sessionId } = await startForfait(r, 'diagnostic_express');
      expect((await request(app).post(`/api/app/sessions/${sessionId}/upgrade`).set(auth(other))).status).toBe(404);
      expect((await request(app).post('/api/app/sessions/pas-un-uuid/upgrade').set(auth(r))).status).toBe(404);
      expect((await request(app).post('/api/app/sessions/00000000-0000-4000-8000-000000000000/upgrade').set(auth(r))).status).toBe(404);
      expect((await request(app).post(`/api/app/sessions/${sessionId}/upgrade`)).status).toBe(401);
      await pool.query("UPDATE sessions SET status = 'completed' WHERE id = $1", [sessionId]);
      expect((await request(app).post(`/api/app/sessions/${sessionId}/upgrade`).set(auth(r))).status).toBe(409);
    });

    it('une commande de complément en attente ne se mélange pas avec la commande d’un forfait', async () => {
      const r = await register();
      const { sessionId } = await startForfait(r, 'diagnostic_express');
      const up = await request(app).post(`/api/app/sessions/${sessionId}/upgrade`).set(auth(r));
      const forfait = await request(app).post('/api/app/orders').set(auth(r)).send({ planId: 'assistance_rapide' });
      expect(forfait.body.order.id).not.toBe(up.body.order.id);
      const upgrade = (await pool.query('SELECT plan_id, amount_fcfa FROM orders WHERE id = $1', [up.body.order.id])).rows[0];
      expect(upgrade).toMatchObject({ plan_id: 'complement_technicien', amount_fcfa: 1500 });
    });

    it('le prix du complément se lit en base (modifiable en admin) et un complément désactivé est indisponible', async () => {
      const r = await register();
      const { sessionId } = await startForfait(r, 'diagnostic_express');
      await pool.query("UPDATE pricing_plans SET price_fcfa = 1000 WHERE id = 'complement_technicien'");
      expect((await request(app).post(`/api/app/sessions/${sessionId}/upgrade`).set(auth(r))).body.order.amount_fcfa).toBe(1000);
      await pool.query("UPDATE pricing_plans SET active = FALSE WHERE id = 'complement_technicien'");
      await pool.query("UPDATE orders SET status = 'cancelled' WHERE upgrade_session_id IS NOT NULL").catch(() => undefined);
      expect((await request(app).post(`/api/app/sessions/${sessionId}/upgrade`).set(auth(r))).status).toBe(404);
      await pool.query("UPDATE pricing_plans SET active = TRUE, price_fcfa = 1500 WHERE id = 'complement_technicien'");
    });
  });

  it('lancement gratuit : un technicien reste disponible pour tous, même sur le forfait 500', async () => {
    process.env.FREE_LAUNCH = 'true';
    const r = await register();
    const { started, sessionId } = await startForfait(r, 'diagnostic_express');
    expect(started.body.humanIncluded).toBe(true);
    expect((await escalate(r, sessionId)).body).toEqual({ recorded: true });
    expect((await pool.query('SELECT mode FROM sessions WHERE id = $1', [sessionId])).rows[0].mode).toBe('humain');
  });

  it('les droits vus par l’application : un forfait payé non démarré dit s’il comprend un technicien', async () => {
    const r = await register();
    const tech = await technicianToken();
    const order = await request(app).post('/api/app/orders').set(auth(r)).send({ planId: 'diagnostic_express' });
    await request(app).post(`/api/orders/${order.body.order.id}/confirm-payment`).set('Authorization', `Bearer ${tech}`).expect(200);
    const me = await request(app).get('/api/app/me').set(auth(r));
    expect(me.body.entitlements.paidForfait).toMatchObject({ scope: 'full', humanIncluded: false });
  });

  it('assistance offerte déjà utilisée : seuls les deux forfaits sont proposés', async () => {
    const r = await register();
    await request(app).post('/api/app/assistance').set(auth(r)).send({ mode: 'ia' }).expect(201);
    const refused = await request(app).post('/api/app/assistance').set(auth(r)).send({ mode: 'ia' });
    expect(refused.status).toBe(402);
    expect(refused.body.forfaitPlanIds).toEqual(['diagnostic_express', 'assistance_rapide']);
  });
});
