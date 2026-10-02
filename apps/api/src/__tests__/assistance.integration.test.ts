import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { applyMigrations, truncateAll } from './testDb.js';

const app = createApp();
const PHONE = '+2250700001111';

async function technicianToken(role: 'technician' | 'admin' = 'admin') {
  const passwordHash = await bcrypt.hash('secret123', 4);
  await pool.query(
    `INSERT INTO technicians (full_name, phone, username, password_hash, role)
     VALUES ('Agent Test', '+22500000009', 'agent_test', $1, $2)
     ON CONFLICT (username) DO NOTHING`,
    [passwordHash, role],
  );
  const login = await request(app)
    .post('/api/auth/technician/login')
    .send({ username: 'agent_test', password: 'secret123' });
  return login.body.token as string;
}

/** Souscrit et fait confirmer le paiement : l'abonnement devient actif. */
async function subscribe(phone = PHONE) {
  const token = await technicianToken();
  const sub = await request(app).post('/api/subscriptions').send({ clientPhone: phone });
  expect(sub.status).toBe(201);
  const confirm = await request(app)
    .post(`/api/orders/${sub.body.order.id}/confirm-payment`)
    .set('Authorization', `Bearer ${token}`);
  expect(confirm.status).toBe(200);
  return { token, order: sub.body.order, confirm };
}

describe('Assistance : mode IA/humain, 1re assistance offerte, abonnement mensuel', () => {
  beforeAll(async () => {
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterEach(() => {
    delete process.env.AI_AGENT_ENABLED;
  });
  afterAll(async () => {
    await pool.end();
  });

  it('offre la première assistance, gratuitement, sans paiement', async () => {
    const res = await request(app).post('/api/assistance').send({ clientPhone: PHONE, mode: 'humain' });
    expect(res.status).toBe(201);
    expect(res.body.coverage).toBe('free_offer');
    expect(res.body.order.amount_fcfa).toBe(0);
    expect(res.body.order.status).toBe('paid');
    expect(res.body.session.session_code).toMatch(/^[0-9]{9}$/);
  });

  it('refuse une 2e assistance sans abonnement (402) et propose l\'abonnement', async () => {
    await request(app).post('/api/assistance').send({ clientPhone: PHONE });
    const second = await request(app).post('/api/assistance').send({ clientPhone: PHONE });
    expect(second.status).toBe(402);
    expect(second.body.code).toBe('subscription_required');
    expect(second.body.subscriptionPlanId).toBe('abonnement_mensuel');
  });

  it('ne donne l\'offre gratuite qu\'une fois, même avec deux demandes simultanées', async () => {
    const [a, b] = await Promise.all([
      request(app).post('/api/assistance').send({ clientPhone: PHONE }),
      request(app).post('/api/assistance').send({ clientPhone: PHONE }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 402]);
  });

  it('l\'offre est par numéro : un autre numéro a sa propre assistance offerte', async () => {
    await request(app).post('/api/assistance').send({ clientPhone: PHONE });
    const other = await request(app).post('/api/assistance').send({ clientPhone: '+2250700002222' });
    expect(other.status).toBe(201);
  });

  it('l\'abonnement est à 10 000 FCFA et reste inactif tant que le paiement n\'est pas confirmé', async () => {
    await request(app).post('/api/assistance').send({ clientPhone: PHONE }); // consomme l'offre
    const sub = await request(app).post('/api/subscriptions').send({ clientPhone: PHONE });
    expect(sub.status).toBe(201);
    expect(sub.body.order.amount_fcfa).toBe(10000);
    expect(sub.body.order.status).toBe('pending_payment');

    const stillBlocked = await request(app).post('/api/assistance').send({ clientPhone: PHONE });
    expect(stillBlocked.status).toBe(402);
  });

  it('active l\'abonnement 30 jours à la confirmation du paiement, puis les assistances sont couvertes', async () => {
    await request(app).post('/api/assistance').send({ clientPhone: PHONE }); // consomme l'offre
    const { confirm } = await subscribe();

    const days =
      (new Date(confirm.body.subscription.ends_at).getTime() - new Date(confirm.body.subscription.starts_at).getTime()) /
      86_400_000;
    expect(Math.round(days)).toBe(30);

    const first = await request(app).post('/api/assistance').send({ clientPhone: PHONE });
    const second = await request(app).post('/api/assistance').send({ clientPhone: PHONE });
    expect(first.status).toBe(201);
    expect(first.body.coverage).toBe('subscription');
    expect(second.status).toBe(201); // illimité pendant la période
  });

  it('refuse l\'assistance quand l\'abonnement est expiré', async () => {
    await request(app).post('/api/assistance').send({ clientPhone: PHONE });
    await subscribe();
    await pool.query(`UPDATE subscriptions SET ends_at = now() - interval '1 day'`);
    const res = await request(app).post('/api/assistance').send({ clientPhone: PHONE });
    expect(res.status).toBe(402);
  });

  it('un renouvellement avant l\'échéance prolonge la période au lieu de la raccourcir', async () => {
    await subscribe();
    const { confirm } = await subscribe();
    const days = (new Date(confirm.body.subscription.ends_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(59);
  });

  it('interdit de commander les formules internes via /api/orders (pas de contournement)', async () => {
    for (const planId of ['assistance_offerte', 'assistance_abonne', 'abonnement_mensuel']) {
      const res = await request(app).post('/api/orders').send({ clientPhone: PHONE, planId });
      expect(res.status).toBe(400);
    }
  });

  it('masque les formules internes du catalogue public', async () => {
    const res = await request(app).get('/api/pricing');
    const ids = res.body.plans.map((p: { id: string }) => p.id);
    expect(ids).toContain('abonnement_mensuel');
    expect(ids).not.toContain('assistance_offerte');
    expect(ids).not.toContain('assistance_abonne');
  });

  it('IA demandée mais agent non activé : repli honnête sur un technicien, visible dans la file', async () => {
    const res = await request(app).post('/api/assistance').send({ clientPhone: PHONE, mode: 'ia' });
    expect(res.status).toBe(201);
    expect(res.body.session.mode).toBe('humain');
    expect(res.body.fallbackToHuman).toBe(true);

    const token = await technicianToken('technician');
    const queue = await request(app).get('/api/technician/queue').set('Authorization', `Bearer ${token}`);
    expect(queue.body.queue).toHaveLength(1);
    expect(queue.body.queue[0].requested_mode).toBe('ia');
  });

  it('IA par défaut quand l\'agent est activé : la session n\'entre pas dans la file des techniciens', async () => {
    process.env.AI_AGENT_ENABLED = 'true';
    const res = await request(app).post('/api/assistance').send({ clientPhone: PHONE }); // mode par défaut
    expect(res.status).toBe(201);
    expect(res.body.session.mode).toBe('ia');
    expect(res.body.fallbackToHuman).toBe(false);

    const token = await technicianToken('technician');
    const queue = await request(app).get('/api/technician/queue').set('Authorization', `Bearer ${token}`);
    expect(queue.body.queue).toHaveLength(0);
  });

  it('« Passer à un technicien » : la session IA rejoint la file des techniciens', async () => {
    process.env.AI_AGENT_ENABLED = 'true';
    const res = await request(app).post('/api/assistance').send({ clientPhone: PHONE, mode: 'ia' });
    const escalate = await request(app).post(`/api/sessions/${res.body.session.id}/escalate`);
    expect(escalate.status).toBe(200);
    expect(escalate.body.session.mode).toBe('humain');

    const token = await technicianToken('technician');
    const queue = await request(app).get('/api/technician/queue').set('Authorization', `Bearer ${token}`);
    expect(queue.body.queue).toHaveLength(1);
  });

  it('indique les droits du client : offre dispo, puis abonnement en cours', async () => {
    const before = await request(app).post('/api/assistance/eligibility').send({ clientPhone: PHONE });
    expect(before.body.freeOfferAvailable).toBe(true);
    expect(before.body.subscription).toBeNull();

    await request(app).post('/api/assistance').send({ clientPhone: PHONE });
    await subscribe();
    const after = await request(app).post('/api/assistance/eligibility').send({ clientPhone: PHONE });
    expect(after.body.freeOfferAvailable).toBe(false);
    expect(after.body.subscription.endsAt).toBeTruthy();
  });

  it('valide le numéro de téléphone', async () => {
    const res = await request(app).post('/api/assistance').send({ clientPhone: 'abc' });
    expect(res.status).toBe(400);
  });
});
